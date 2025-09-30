import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { atomiqService } from "../../services/AtomiqService";
import { StarknetSigner, StarknetKeypairWallet } from "@atomiqlabs/chain-starknet";
import { walletService } from "../../services/WalletService";
import { bitcoinWalletService } from "../../services/BitcoinWalletService";
import { Account } from "starknet";
import config from "../../config/config";

interface CrossChainSwapPayload extends Record<string, unknown> {
  from: "BTC" | "STRK";
  to: "BTC" | "STRK";
  amount: number;
  exactIn: boolean;
  destinationAddress?: string;
  bitcoinAddress?: string;
}

export class CrossChainSwapTool extends BaseTool<CrossChainSwapPayload> {
  metadata: ToolMetadata = {
    name: "cross_chain_swap_tool",
    description: "Cross-chain swaps between Bitcoin and Starknet using Atomiq protocol",
    parameters: {
      from: {
        type: "string",
        description: "Source token for the swap",
        required: true,
        enum: ["BTC", "STRK"],
      },
      to: {
        type: "string",
        description: "Destination token for the swap",
        required: true,
        enum: ["BTC", "STRK"],
      },
      amount: {
        type: "number",
        description: "Amount to swap (in smallest unit: sats for BTC, wei for STRK)",
        required: true,
        min: 0,
      },
      exactIn: {
        type: "boolean",
        description: "Whether the amount is exact input (true) or exact output (false)",
        required: true,
      },
      destinationAddress: {
        type: "string",
        description: "Destination address for the swap (optional, uses user's address if not provided)",
        required: false,
      },
      bitcoinAddress: {
        type: "string",
        description: "Bitcoin address for BTC swaps (optional)",
        required: false,
      },
    },
    examples: [
      "Swap 0.01 BTC to STRK",
      "Convert 1000 STRK to BTC",
      "Exchange 50000 sats to STRK",
    ],
    category: "trading",
    version: "1.0.0",
  };

  async execute(payload: CrossChainSwapPayload, userId: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      const tokens = atomiqService.getSupportedTokens();

      // Validate swap direction
      if (payload.from === payload.to) {
        return this.createErrorResult(
          "cross_chain_swap",
          "Source and destination tokens cannot be the same"
        );
      }

      // Convert amount to BigInt (assuming amount is in smallest units)
      const amountBigInt = BigInt(Math.floor(payload.amount));

      if (payload.from === "BTC" && payload.to === "STRK") {
        return this.executeBtcToStrkSwap(amountBigInt, payload, userId, swapper, tokens);
      } else if (payload.from === "STRK" && payload.to === "BTC") {
        return this.executeStrkToBtcSwap(amountBigInt, payload, userId, swapper, tokens);
      } else {
        return this.createErrorResult(
          "cross_chain_swap",
          "Unsupported swap pair. Only BTC ↔ STRK swaps are supported."
        );
      }
    } catch (error) {
      return this.createErrorResult(
        "cross_chain_swap",
        `Cross-chain swap failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async executeBtcToStrkSwap(
    amount: bigint,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
      // Create swap: BTC -> STRK 
      const swap = await swapper.swap(
        tokens.BTC, // Swap from BTC
        tokens.STRK, // Into specified destination token
        amount,
        payload.exactIn, // Whether we define an input or output amount
        undefined, // Source address for the swap, not used for swaps from BTC
        payload.destinationAddress || starknetSigner.getAddress(), // Destination address
        {
          gasAmount: BigInt("1000000000000000000") 
        }
      );

      // Get swap details
      const input = swap.getInputWithoutFee().toString();
      const fee = swap.getFee().amountInSrcToken.toString();
      const inputWithFees = swap.getInput().toString();
      const output = swap.getOutput().toString();
      const expiry = swap.getQuoteExpiry();

      // Get pricing info
      const priceInfo = swap.getPriceInfo();
      const swapPrice = priceInfo.swapPrice;
      const marketPrice = priceInfo.marketPrice;
      const difference = priceInfo.difference;

      return this.createSuccessResult("btc_to_strk_swap_quote", {
        swapId: swap.getId(),
        from: "BTC",
        to: "STRK",
        inputAmount: input,
        outputAmount: output,
        fee: fee,
        totalInput: inputWithFees,
        swapPrice: swapPrice,
        marketPrice: marketPrice,
        priceDifference: difference,
        expiry: new Date(expiry).toISOString(),
        bitcoinAddress: swap.getAddress(),
        qrCodeData: swap.getHyperlink(),
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "btc_to_strk_swap",
        `BTC to STRK swap failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async executeStrkToBtcSwap(
    amount: bigint,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
          // Get Bitcoin address for the user if not provided
          let bitcoinAddress: string;
          if (payload.bitcoinAddress) {
            bitcoinAddress = payload.bitcoinAddress;
          } else {
            const bitcoinWalletData = await bitcoinWalletService.getBitcoinAddress(userId);
            bitcoinAddress = bitcoinWalletData.address;
          }

          // Create swap: STRK -> BTC 
          const swap = await swapper.swap(
            tokens.STRK, // From specified source token
            tokens.BTC, // Swap to BTC
            amount,
            payload.exactIn,
            starknetSigner.getAddress(), // Source address and smart chain signer
            bitcoinAddress // Destination of the swap
          );

      // Get swap details
      const input = swap.getInputWithoutFee().toString();
      const fee = swap.getFee().amountInSrcToken.toString();
      const inputWithFees = swap.getInput().toString();
      const output = swap.getOutput().toString();
      const expiry = swap.getQuoteExpiry();

      // Get pricing info
      const priceInfo = swap.getPriceInfo();
      const swapPrice = priceInfo.swapPrice;
      const marketPrice = priceInfo.marketPrice;
      const difference = priceInfo.difference;

      return this.createSuccessResult("strk_to_btc_swap_quote", {
        swapId: swap.getId(),
        from: "STRK",
        to: "BTC",
        inputAmount: input,
        outputAmount: output,
        fee: fee,
        totalInput: inputWithFees,
        swapPrice: swapPrice,
        marketPrice: marketPrice,
        priceDifference: difference,
        expiry: new Date(expiry).toISOString(),
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "strk_to_btc_swap",
        `STRK to BTC swap failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getStarknetSigner(userId: string): Promise<StarknetSigner> {
    try {
      // Get user's wallet data from the wallet service
      const userAccountData = await walletService.getUserAccountData(userId);
      
      // Validate the private key format
      if (!walletService.validatePrivateKey(userAccountData.privateKey)) {
        throw new Error("Invalid private key format for user wallet");
      }
      
      // Create StarknetSigner using the user's private key
      const starknetSigner = new StarknetSigner(
        new StarknetKeypairWallet(config.node_url, userAccountData.privateKey)
      );
      
      // Update last used timestamp
      userAccountData.lastUsed = new Date();
      
      return starknetSigner;
    } catch (error) {
      console.error("Failed to create Starknet signer:", error);
      throw new Error(`Starknet signer creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export const crossChainSwapTool = new CrossChainSwapTool();
