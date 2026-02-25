import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import accountsData from "../../Auth/accounts.json";
import logger from "../../config/logger";
import stellarPriceService from "../../services/stellarPrice.service";
import { flashSwapRiskAnalyzer } from "../../services/flashSwapRiskAnalyzer";

interface SwapPayload extends Record<string, unknown> {
  from: string;
  to: string;
  amount: number;
}

interface StellarAccountData {
  userId: string;
  secretKey: string;
  publicKey: string;
}

// Stellar asset definitions
const STELLAR_ASSETS: Record<string, StellarSdk.Asset> = {
  XLM: StellarSdk.Asset.native(),
  USDC: new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" // Stellar USDC issuer (Circle)
  ),
  USDT: new StellarSdk.Asset(
    "USDT",
    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V" // Stellar USDT issuer
  ),
};

export class SwapTool extends BaseTool<SwapPayload> {
  metadata: ToolMetadata = {
    name: "swap_tool",
    description: "Swap tokens on the Stellar DEX using path payments",
    parameters: {
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount to swap",
        required: true,
        min: 0,
      },
    },
    examples: [
      "Swap 100 XLM to USDC",
      "Convert 50 USDC to XLM",
      "Exchange 10 USDT for XLM",
    ],
    category: "trading",
    version: "1.0.0",
  };

  private server: StellarSdk.Horizon.Server;

  constructor() {
    super();
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  private getStellarAccount(userId: string): StellarSdk.Keypair {
    const accounts = accountsData as StellarAccountData[];
    const accountData = accounts.find((a) => a.userId === userId);

    if (!accountData) {
      throw new Error(`Stellar account not found for user: ${userId}`);
    }

    return StellarSdk.Keypair.fromSecret(accountData.secretKey);
  }

  async execute(payload: SwapPayload, userId: string): Promise<ToolResult> {
    try {
      // Validate tokens
      if (payload.from === payload.to) {
        return this.createErrorResult(
          "swap",
          "Source and destination tokens must be different"
        );
      }

      const sourceAsset = STELLAR_ASSETS[payload.from];
      const destAsset = STELLAR_ASSETS[payload.to];

      if (!sourceAsset || !destAsset) {
        return this.createErrorResult(
          "swap",
          "Invalid token symbol. Supported: XLM, USDC, USDT"
        );
      }

      // Get price quote (with caching)
      const priceQuote = await stellarPriceService.getPrice(
        payload.from,
        payload.to,
        payload.amount
      );

      logger.info("Price quote obtained", {
        price: priceQuote.price,
        estimatedOutput: priceQuote.estimatedOutput,
        cached: priceQuote.cached,
        path: priceQuote.path,
      });

      // Analyze swap risk for sandwich attacks
      logger.info("Analyzing swap risk", { userId, amount: payload.amount });
      const riskAnalysis = await flashSwapRiskAnalyzer.analyzeSwapRisk({
        fromAsset: sourceAsset,
        toAsset: destAsset,
        amount: payload.amount,
      });

      // Notify user of risks
      if (riskAnalysis.riskLevel === "critical") {
        return this.createErrorResult(
          "swap",
          `CRITICAL RISK: Swap blocked due to high sandwich attack risk (${(riskAnalysis.sandwichAttackRisk * 100).toFixed(1)}%). ${riskAnalysis.warnings.join(". ")}. Recommendations: ${riskAnalysis.recommendations.join(". ")}`
        );
      }

      if (riskAnalysis.riskLevel === "high") {
        logger.warn("High risk swap detected", { userId, riskAnalysis });
      }

      // Get user's Stellar keypair
      const sourceKeypair = this.getStellarAccount(userId);
      const sourcePublicKey = sourceKeypair.publicKey();

      logger.info("Initiating swap", {
        userId,
        amount: payload.amount,
        from: payload.from,
        to: payload.to,
        riskLevel: riskAnalysis.riskLevel,
      });

      // Load source account to get sequence number
      const sourceAccount = await this.server.loadAccount(sourcePublicKey);

      // Convert amount to Stellar format (7 decimal places)
      const sendAmount = payload.amount.toFixed(7);

      // Calculate minimum destination amount with 1% slippage tolerance
      const minDestAmount = (priceQuote.estimatedOutput * 0.99).toFixed(7);

      // Build transaction with path payment strict send
      // This automatically finds the best path through Stellar's DEX
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: sourceAsset,
            sendAmount: sendAmount,
            destination: sourcePublicKey, // Send to self (swap)
            destAsset: destAsset,
            destMin: minDestAmount, // Minimum acceptable amount with slippage
          })
        )
        .setTimeout(30)
        .build();

      // Sign transaction
      transaction.sign(sourceKeypair);

      // Submit to Stellar network
      const result = await this.server.submitTransaction(transaction);

      return this.createSuccessResult("swap", {
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        estimatedOutput: priceQuote.estimatedOutput,
        price: priceQuote.price,
        txHash: result.hash,
        timestamp: new Date().toISOString(),
        ledger: result.ledger,
        successful: result.successful,
        riskAnalysis: {
          riskLevel: riskAnalysis.riskLevel,
          sandwichAttackRisk: riskAnalysis.sandwichAttackRisk,
          warnings: riskAnalysis.warnings,
          recommendations: riskAnalysis.recommendations,
        },
      });
    } catch (error) {
      let errorMessage = "Unknown error";

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Handle specific Stellar errors
      if (typeof error === "object" && error !== null) {
        const stellarError = error as {
          response?: {
            data?: {
              extras?: {
                result_codes?: {
                  operations?: string[];
                };
              };
            };
          };
        };
        if (stellarError.response?.data?.extras?.result_codes) {
          const codes = stellarError.response.data.extras.result_codes;
          if (codes.operations?.includes("op_no_trust")) {
            errorMessage = `No trustline exists for ${payload.to}. Please establish a trustline first.`;
          } else if (codes.operations?.includes("op_underfunded")) {
            errorMessage = `Insufficient ${payload.from} balance for swap`;
          } else if (codes.operations?.includes("op_too_few_offers")) {
            errorMessage = `No liquidity path found for ${payload.from} → ${payload.to} swap`;
          }
        }
      }

      return this.createErrorResult("swap", `Swap failed: ${errorMessage}`);
    }
  }
}

export const swapTool = new SwapTool();
