import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { atomiqService } from "../../services/AtomiqService";
import { walletService } from "../../services/WalletService";
import { Account, RpcProvider } from "starknet";
import config from "../../config/config";
import { container } from "tsyringe";
import { AuthService } from "../../Auth/auth.service";
import { StarknetSigner, StarknetKeypairWallet  } from "@atomiqlabs/chain-starknet";

export interface CrossChainSwapPayload extends Record<string, unknown> {
  operation: "quote" | "swap";
  from: "BTC" | "STRK";
  to: "BTC" | "STRK";
  amount: number;
  exactIn: boolean;
  bitcoinAddress?: string; // Optional - Bitcoin address for receiving BTC
}

export class CrossChainSwapTool extends BaseTool<CrossChainSwapPayload> {
  metadata: ToolMetadata = {
    name: "cross_chain_swap",
    description: "Execute cross-chain swaps between Bitcoin and Starknet using Atomiq protocol",
    parameters: {
      operation: {
        type: "string",
        description: "Operation to perform: quote or swap",
        required: true,
        enum: ["quote", "swap"],
      },
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["BTC", "STRK"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["BTC", "STRK"],
      },
      amount: {
        type: "number",
        description: "Amount to swap",
        required: true,
        min: 0,
      },
      exactIn: {
        type: "boolean",
        description: "Whether to specify exact input amount",
        required: true,
      },
      bitcoinAddress: {
        type: "string",
        description: "Bitcoin address to receive BTC (optional)",
        required: false,
      },
    },
    examples: [
      "Swap 5 STRK to BTC",
      "Convert 0.001 BTC to STRK",
    ],
    category: "trading",
    version: "1.0.0",
  };

  private authService: AuthService;

  constructor() {
    super();
    this.authService = container.resolve(AuthService);
  }

  async execute(payload: CrossChainSwapPayload, userId: string): Promise<ToolResult> {
    try {
      console.log(`CrossChainSwapTool.execute called with userId: ${userId}`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));

      // Validate payload
      if (!payload.operation || !payload.from || !payload.to || !payload.amount) {
        return this.createErrorResult(
          "cross_chain_swap",
          "Missing required parameters: operation, from, to, amount"
        );
      }

      if (payload.from === payload.to) {
        return this.createErrorResult(
          "cross_chain_swap",
          "Source and destination tokens cannot be the same"
        );
      }

      // Check if Atomiq service is properly initialized
      if (!atomiqService.isInitialized()) {
        return this.createErrorResult(
          "cross_chain_swap",
          "Swap service is not available due to network connectivity issues. Please try again later or contact support."
        );
      }

      // Get Atomiq swapper and tokens
      const swapper = atomiqService.getSwapper();
      const tokens = atomiqService.getTokens();

      // Convert amount to BigInt based on swap direction
      // For STRK → BTC: exactIn = false, amount should be in BTC units (sats)
      // For BTC → STRK: exactIn = true, amount should be in BTC units (sats)
      let amountBigInt: bigint;
      const exactIn = payload.from === "BTC";
      
      if (payload.from === "STRK" && payload.to === "BTC") {
        // STRK → BTC with exactIn = false: amount should be in BTC units (sats)
        amountBigInt = BigInt(Math.floor(payload.amount * 10**8));
      } else if (payload.from === "BTC" && payload.to === "STRK") {
        // BTC → STRK with exactIn = true: amount should be in BTC units (sats)
        amountBigInt = BigInt(Math.floor(payload.amount * 10**8));
      } else {
        return this.createErrorResult(
          "cross_chain_swap",
          "Unsupported swap pair. Only BTC ↔ STRK swaps are supported."
        );
      }
      
      console.log(`Converting ${payload.amount} ${payload.from} to ${amountBigInt.toString()} smallest units`);
      console.log(`Using exactIn: ${exactIn}`);

      // Handle quote vs swap operations
      if (payload.operation === "quote") {
        if (payload.from === "BTC" && payload.to === "STRK") {
          return this.getBtcToStrkQuote(amountBigInt, exactIn, payload, userId, swapper, tokens);
        } else if (payload.from === "STRK" && payload.to === "BTC") {
          return this.getStrkToBtcQuote(amountBigInt, exactIn, payload, userId, swapper, tokens);
        } else {
          return this.createErrorResult(
            "cross_chain_swap",
            "Unsupported swap pair. Only BTC ↔ STRK swaps are supported."
          );
        }
      } else if (payload.operation === "swap") {
        if (payload.from === "BTC" && payload.to === "STRK") {
          return this.executeBtcToStrkSwap(amountBigInt, exactIn, payload, userId, swapper, tokens);
        } else if (payload.from === "STRK" && payload.to === "BTC") {
          return this.executeStrkToBtcSwap(amountBigInt, exactIn, payload, userId, swapper, tokens);
        } else {
          return this.createErrorResult(
            "cross_chain_swap",
            "Unsupported swap pair. Only BTC ↔ STRK swaps are supported."
          );
        }
      } else {
        return this.createErrorResult(
          "cross_chain_swap",
          "Invalid operation. Must be 'quote' or 'swap'."
        );
      }
    } catch (error) {
      console.error("CrossChainSwapTool execution failed:", error);
      return this.createErrorResult(
        "cross_chain_swap",
        `Cross-chain swap failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async executeBtcToStrkSwap(
    amount: bigint,
    exactIn: boolean,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      console.log(`Executing BTC → STRK swap for user: ${userId}`);
      
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
      console.log(`Attempting to create swap with parameters:`);
      console.log(`- From token (BTC): ${tokens.BITCOIN.BTC}`);
      console.log(`- To token (STRK): ${tokens.STARKNET.STRK}`);
      console.log(`- Amount: ${amount.toString()}`);
      console.log(`- ExactIn: ${exactIn}`);
      console.log(`- Destination address: ${starknetSigner.getAddress()}`);

      // Create swap: BTC -> STRK following documentation exactly
      const swap = await swapper.swap(
        tokens.BITCOIN.BTC, // Swap from BTC
        tokens.STARKNET.STRK, // Into specified destination token
        amount,
        exactIn, // Whether we define an input or output amount
        undefined, // Source address for the swap, not used for swaps from BTC
        starknetSigner.getAddress(), // Destination address
        {
          gasAmount: BigInt("1000000000000000000") // We can also request a gas drop on the destination chain (here requesting 1 STRK)
        }
      );

      console.log(`Swap created successfully with ID: ${swap.getId()}`);

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
        bitcoinAddress: swap.getAddress(), // Get the bitcoin address to send BTC to
        qrCodeData: swap.getHyperlink(), // Data that can be displayed in the form of QR code
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("BTC to STRK swap failed:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      
      // Check if it's a specific type of error
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("not initialized")) {
        return this.createErrorResult(
          "btc_to_strk_swap",
          "Swap service is not properly initialized. Please try again later."
        );
      } else if (errorMessage.includes("network") || errorMessage.includes("timeout") || errorMessage.includes("fetch failed")) {
        return this.createErrorResult(
          "btc_to_strk_swap",
          "Network connectivity issue. The swap service cannot reach external intermediaries. Please try again later."
        );
      } else if (errorMessage.includes("OutOfBoundsError")) {
        return this.createErrorResult(
          "btc_to_strk_swap",
          "The swap amount is outside the supported range. Please try a different amount."
        );
      }
      
      return this.createErrorResult(
        "btc_to_strk_swap",
        `BTC to STRK swap failed: ${errorMessage}`
      );
    }
  }

  private async executeStrkToBtcSwap(
    amount: bigint,
    exactIn: boolean,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      console.log(`Executing STRK → BTC swap for user: ${userId}`);
      
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
      // Use provided Bitcoin address or let Atomiq generate one
      const bitcoinAddress = payload.bitcoinAddress;
      
      console.log(`Attempting to create swap with parameters:`);
      console.log(`- From token (STRK): ${tokens.STARKNET.STRK}`);
      console.log(`- To token (BTC): ${tokens.BITCOIN.BTC}`);
      console.log(`- Amount: ${amount.toString()}`);
      console.log(`- ExactIn: ${exactIn}`);
      console.log(`- Source address: ${starknetSigner.getAddress()}`);
      console.log(`- Bitcoin address: ${bitcoinAddress}`);

      // Create swap: STRK -> BTC following documentation exactly
          const swap = await swapper.swap(
        tokens.STARKNET.STRK, // From specified source token
        tokens.BITCOIN.BTC, // Swap to BTC
            amount,
        exactIn,
            starknetSigner.getAddress(), // Source address and smart chain signer
            bitcoinAddress // Destination of the swap
          );

      console.log(`Swap created successfully with ID: ${swap.getId()}`);

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
        bitcoinAddress: bitcoinAddress,
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("STRK to BTC swap failed:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      
      // Check if it's a Bitcoin address validation error from Atomiq
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("invalid") && errorMessage.includes("address")) {
        return this.createErrorResult(
          "strk_to_btc_swap",
          "Sorry, the Bitcoin address you provided is not valid for the current network. Since we're using testnet, please provide a testnet Bitcoin address (starting with 'tb1' or '2' or 'm' or 'n'). Mainnet addresses (starting with 'bc1' or '1' or '3') are not supported in testnet mode."
        );
      }
      
      return this.createErrorResult(
        "strk_to_btc_swap",
        `STRK to BTC swap failed: ${errorMessage}`
      );
    }
  }

  // Quote methods
  private async getBtcToStrkQuote(
    amount: bigint,
    exactIn: boolean,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      console.log(`Getting BTC → STRK quote for user: ${userId}`);
      
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
      console.log(`Getting quote with parameters:`);
      console.log(`- From token (BTC): ${tokens.BITCOIN.BTC}`);
      console.log(`- To token (STRK): ${tokens.STARKNET.STRK}`);
      console.log(`- Amount: ${amount.toString()}`);
      console.log(`- ExactIn: ${exactIn}`);
      console.log(`- Destination address: ${starknetSigner.getAddress()}`);

      // Create swap quote: BTC -> STRK 
      const swap = await swapper.swap(
        tokens.BITCOIN.BTC, // Swap from BTC
        tokens.STARKNET.STRK, // Into specified destination token
        amount,
        exactIn, // Whether we define an input or output amount
        undefined, // Source address for the swap, not used for swaps from BTC
        starknetSigner.getAddress(), // Destination address
        {
          gasAmount: BigInt("1000000000000000000") // We can also request a gas drop on the destination chain (here requesting 1 STRK)
        }
      );

      console.log(`Quote created successfully with ID: ${swap.getId()}`);

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

      return this.createSuccessResult("btc_to_strk_quote", {
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
        bitcoinAddress: swap.getAddress(), // Get the bitcoin address to send BTC to
        qrCodeData: swap.getHyperlink(), // Data that can be displayed in the form of QR code
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("BTC to STRK quote failed:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      
      // Check if it's a specific type of error
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("not initialized")) {
        return this.createErrorResult(
          "btc_to_strk_quote",
          "Swap service is not properly initialized. Please try again later."
        );
      } else if (errorMessage.includes("network") || errorMessage.includes("timeout") || errorMessage.includes("fetch failed")) {
        return this.createErrorResult(
          "btc_to_strk_quote",
          "Network connectivity issue. The swap service cannot reach external intermediaries. Please try again later."
        );
      } else if (errorMessage.includes("OutOfBoundsError")) {
        return this.createErrorResult(
          "btc_to_strk_quote",
          "The swap amount is outside the supported range. Please try a different amount."
        );
      }
      
      return this.createErrorResult(
        "btc_to_strk_quote",
        `BTC to STRK quote failed: ${errorMessage}`
      );
    }
  }

  private async getStrkToBtcQuote(
    amount: bigint,
    exactIn: boolean,
    payload: CrossChainSwapPayload,
    userId: string,
    swapper: any,
    tokens: any
  ): Promise<ToolResult> {
    try {
      console.log(`Getting STRK → BTC quote for user: ${userId}`);
      
      // Get Starknet signer for the user
      const starknetSigner = await this.getStarknetSigner(userId);
      
      // Use provided Bitcoin address or let Atomiq generate one
      const bitcoinAddress = payload.bitcoinAddress;
      
      console.log(`Getting quote with parameters:`);
      console.log(`- From token (STRK): ${tokens.STARKNET.STRK}`);
      console.log(`- To token (BTC): ${tokens.BITCOIN.BTC}`);
      console.log(`- Amount: ${amount.toString()}`);
      console.log(`- ExactIn: ${exactIn}`);
      console.log(`- Source address: ${starknetSigner.getAddress()}`);
      console.log(`- Bitcoin address: ${bitcoinAddress}`);

      // Create swap quote: STRK -> BTC 
      const swap = await swapper.swap(
        tokens.STARKNET.STRK, // From specified source token
        tokens.BITCOIN.BTC, // Swap to BTC
        amount,
        exactIn,
        starknetSigner.getAddress(), // Source address and smart chain signer
        bitcoinAddress // Destination of the swap
      );

      console.log(`Quote created successfully with ID: ${swap.getId()}`);

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

      return this.createSuccessResult("strk_to_btc_quote", {
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
        bitcoinAddress: bitcoinAddress,
        status: "quote_created",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("STRK to BTC quote failed:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      
      // Check if it's a Bitcoin address validation error from Atomiq
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("invalid") && errorMessage.includes("address")) {
        return this.createErrorResult(
          "strk_to_btc_quote",
          "Sorry, the Bitcoin address you provided is not valid for the current network. Since we're using testnet, please provide a testnet Bitcoin address (starting with 'tb1' or '2' or 'm' or 'n'). Mainnet addresses (starting with 'bc1' or '1' or '3') are not supported in testnet mode."
        );
      }
      
      return this.createErrorResult(
        "strk_to_btc_quote",
        `STRK to BTC quote failed: ${errorMessage}`
      );
    }
  }


  private async getStarknetSigner(userId: string): Promise<any> {
    try {
      console.log(`Creating Starknet signer for user: ${userId}`);

      // Get user's wallet data from the wallet service
      console.log(`Getting user account data for: ${userId}`);
      const userAccountData = await walletService.getUserAccountData(userId);
      console.log(`User account data retrieved, address: ${userAccountData.address}`);
      
      // Validate the private key format
      console.log(`Validating private key: ${userAccountData.privateKey}`);
      if (!walletService.validatePrivateKey(userAccountData.privateKey)) {
        console.error(`Private key validation failed for: ${userAccountData.privateKey}`);
        throw new Error("Invalid private key format for user wallet");
      }
      console.log("Private key validation passed");
      
      // Create RpcProvider from the URL
      console.log(`Creating RpcProvider with URL: ${config.node_url}`);
      const rpcProvider = new RpcProvider({ nodeUrl: config.node_url });
      
      // Create StarknetSigner using the user's private key following documentation exactly
      console.log("Creating StarknetKeypairWallet...");
      const keypairWallet = new StarknetKeypairWallet(rpcProvider, userAccountData.privateKey);
      console.log("Creating StarknetSigner...");
      const starknetSigner = new StarknetSigner(keypairWallet);
      console.log("StarknetSigner created successfully");
      
      return starknetSigner;
    } catch (error) {
      console.error("Failed to create Starknet signer:", error);
      throw new Error(`Starknet signer creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export const crossChainSwapTool = new CrossChainSwapTool();