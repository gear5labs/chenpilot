import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { container } from "tsyringe";
import { AtomiqService } from "../../services/AtomiqService";
import { memoryStore } from "../memory/memory";
import { authenticate } from "../../Auth/auth";
import { UnauthorizedError } from "../../utils/error";

interface AtomiqPayload extends Record<string, unknown> {
  operation: string;
  fromAsset?: string;
  toAsset?: string;
  amount?: number;
  fromChain?: string;
  toChain?: string;
  userAddress?: string;
  swapId?: string;
  slippageTolerance?: number;
  minAmountOut?: number;
  recipientAddress?: string;
  chain?: string;
  address?: string;
  bitcoinAddress?: string;
  destinationChain?: string;
  signer?: any;
  token?: any;
}

export class AtomiqTool extends BaseTool<AtomiqPayload> {
  metadata: ToolMetadata = {
    name: "atomiq_tool",
    description: "Cross-chain swap operations via Atomiq - Bitcoin to Starknet swaps, Lightning Network swaps, and cross-chain transactions",
    parameters: {
      operation: {
        type: "string",
        description: "The operation to perform (e.g., 'create_swap', 'get_swap_by_id', 'get_refundable_swaps', 'get_spendable_balance', 'parse_address', 'get_bitcoin_spendable_balance', 'get_swap_limits')",
        required: true,
        enum: [
          "create_swap", "get_swap_by_id", "get_refundable_swaps",
          "get_spendable_balance", "parse_address", "get_bitcoin_spendable_balance", "get_swap_limits"
        ],
      },
      fromAsset: {
        type: "string",
        description: "The asset symbol to swap from (e.g., 'BTC', 'STRK')",
        required: false,
      },
      toAsset: {
        type: "string",
        description: "The asset symbol to swap to (e.g., 'BTC', 'STRK')",
        required: false,
      },
      amount: {
        type: "number",
        description: "The amount of asset for the swap",
        required: false,
      },
      fromChain: {
        type: "string",
        description: "The blockchain to swap from (e.g., 'bitcoin', 'starknet')",
        required: false,
      },
      toChain: {
        type: "string",
        description: "The blockchain to swap to (e.g., 'bitcoin', 'starknet')",
        required: false,
      },
      userAddress: {
        type: "string",
        description: "The user's wallet address",
        required: false,
      },
      swapId: {
        type: "string",
        description: "The ID of the swap",
        required: false,
      },
      slippageTolerance: {
        type: "number",
        description: "Slippage tolerance for swaps (e.g., 0.01 for 1%)",
        required: false,
      },
      minAmountOut: {
        type: "number",
        description: "Minimum amount out for swaps",
        required: false,
      },
      recipientAddress: {
        type: "string",
        description: "The recipient address for the swapped assets",
        required: false,
      },
      chain: {
        type: "string",
        description: "The blockchain chain (e.g., 'bitcoin', 'starknet')",
        required: false,
      },
      address: {
        type: "string",
        description: "The wallet address",
        required: false,
      },
      bitcoinAddress: {
        type: "string",
        description: "The Bitcoin address",
        required: false,
      },
      destinationChain: {
        type: "string",
        description: "The destination chain for Bitcoin spendable balance",
        required: false,
      },
      signer: {
        type: "object",
        description: "The signer object for spendable balance (e.g., a wallet instance)",
        required: false,
      },
      token: {
        type: "object",
        description: "The token object for spendable balance (e.g., Atomiq.Tokens.BITCOIN.BTC)",
        required: false,
      },
    },
    examples: [
      "Create a swap from 0.001 BTC to STRK",
      "Get swap by ID 'swap123'",
      "Get refundable swaps for user 'user123'",
      "Get claimable swaps for user 'user123'",
      "Get spendable balance for signer and token",
      "Parse Bitcoin address 'bc1q...'",
      "Get Bitcoin spendable balance for address 'bc1q...'",
      "Get swap limits for BTC to STRK"
    ],
    category: "cross_chain",
    version: "1.0.0",
  };

  private atomiqService = container.resolve(AtomiqService);

  async execute(payload: AtomiqPayload, userId: string): Promise<ToolResult> {
    const { operation, fromAsset, toAsset, amount, fromChain, toChain, userAddress, swapId, slippageTolerance, minAmountOut, recipientAddress, chain, address, bitcoinAddress, destinationChain, signer, token } = payload;

    try {
      // Authenticate user for operations requiring a connected wallet
      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError("Invalid credentials or user not authenticated.");
      }

      switch (operation) {
        case "create_swap":
          return await this.createSwap(payload);
        case "get_swap_by_id":
          return await this.getSwapById(payload);
        case "get_refundable_swaps":
          return await this.getRefundableSwaps(payload);
        case "get_spendable_balance":
          return await this.getSpendableBalance(payload);
        case "parse_address":
          return await this.parseAddress(payload);
        case "get_bitcoin_spendable_balance":
          return await this.getBitcoinSpendableBalance(payload);
        case "get_swap_limits":
          return await this.getSwapLimits(payload);
        default:
          return this.createErrorResult("atomiq_tool", `Unknown operation: ${operation}`);
      }
    } catch (error) {
      memoryStore.add(userId, `Error in AtomiqTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return this.createErrorResult("atomiq_tool", (error as Error).message);
    }
  }

  private async createSwap(payload: AtomiqPayload): Promise<ToolResult> {
    // Handle userAddress if it's an object (from address tool result)
    let userAddress = payload.userAddress;
    if (typeof userAddress === 'object' && userAddress !== null) {
      userAddress = (userAddress as any).address || (userAddress as any).userAddress;
    }
    
    if (!payload.fromAsset || !payload.toAsset || !payload.amount || !userAddress || !payload.recipientAddress) {
      return this.createErrorResult("atomiq_swap", "From asset, to asset, amount, user address, and recipient address are required for swap");
    }

    try {
      // Map asset names to SDK tokens
      let srcToken, dstToken;
      
      if (payload.fromAsset === "BTC" && payload.toAsset === "STRK") {
        srcToken = this.atomiqService.tokens.BITCOIN.BTC;
        dstToken = this.atomiqService.tokens.STARKNET.STRK;
      } else if (payload.fromAsset === "STRK" && payload.toAsset === "BTC") {
        srcToken = this.atomiqService.tokens.STARKNET.STRK;
        dstToken = this.atomiqService.tokens.BITCOIN.BTC;
      } else if (payload.fromAsset === "BTC" && payload.toAsset === "BTCLN") {
        srcToken = this.atomiqService.tokens.BITCOIN.BTC;
        dstToken = this.atomiqService.tokens.BITCOIN.BTCLN;
      } else if (payload.fromAsset === "STRK" && payload.toAsset === "BTCLN") {
        srcToken = this.atomiqService.tokens.STARKNET.STRK;
        dstToken = this.atomiqService.tokens.BITCOIN.BTCLN;
      } else {
        return this.createErrorResult("atomiq_swap", `Unsupported asset pair: ${payload.fromAsset} -> ${payload.toAsset}`);
      }

      const swap = await this.atomiqService.createSwap(
        srcToken,
        dstToken,
        BigInt(payload.amount),
        true, // exactIn = true
        userAddress as string,
        payload.recipientAddress
      );

      return this.createSuccessResult("atomiq_swap", {
        swapId: swap.getId(),
        fromAsset: payload.fromAsset,
        toAsset: payload.toAsset,
        amount: payload.amount,
        userAddress: userAddress,
        recipientAddress: payload.recipientAddress,
        swap: swap,
        message: `Swap created: ${payload.amount} ${payload.fromAsset} to ${payload.toAsset}`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_swap", `Failed to create swap: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getSwapById(payload: AtomiqPayload): Promise<ToolResult> {
    if (!payload.swapId) {
      return this.createErrorResult("atomiq_swap", "Swap ID is required");
    }

    try {
      const swap = await this.atomiqService.getSwapById(payload.swapId);
      return this.createSuccessResult("atomiq_swap", {
        swapId: payload.swapId,
        swap: swap,
        message: `Swap details for ${payload.swapId}`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_swap", `Failed to get swap: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getRefundableSwaps(payload: AtomiqPayload): Promise<ToolResult> {
    if (!payload.chain || !payload.address) {
      return this.createErrorResult("atomiq_refundable_swaps", "Chain and address are required");
    }

    try {
      const refundableSwaps = await this.atomiqService.getRefundableSwaps(payload.chain, payload.address);
      return this.createSuccessResult("atomiq_refundable_swaps", {
        chain: payload.chain,
        address: payload.address,
        refundableSwaps: refundableSwaps,
        count: refundableSwaps.length,
        message: `Found ${refundableSwaps.length} refundable swaps for ${payload.address} on ${payload.chain}`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_refundable_swaps", `Failed to get refundable swaps: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }


  private async getSpendableBalance(payload: AtomiqPayload): Promise<ToolResult> {
    if (!payload.signer || !payload.token) {
      return this.createErrorResult("atomiq_spendable_balance", "Signer and token are required");
    }

    try {
      const spendableBalance = await this.atomiqService.getSpendableBalance(payload.signer, payload.token);
      return this.createSuccessResult("atomiq_spendable_balance", {
        spendableBalance: spendableBalance,
        message: `Spendable balance retrieved`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_spendable_balance", `Failed to get spendable balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async parseAddress(payload: AtomiqPayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult("atomiq_parse_address", "Address is required");
    }

    try {
      const parsedAddress = await this.atomiqService.parseAddress(payload.address);
      return this.createSuccessResult("atomiq_parse_address", {
        address: payload.address,
        parsedAddress: parsedAddress,
        message: `Address parsed successfully`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_parse_address", `Failed to parse address: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getBitcoinSpendableBalance(payload: AtomiqPayload): Promise<ToolResult> {
    if (!payload.bitcoinAddress || !payload.destinationChain) {
      return this.createErrorResult("atomiq_bitcoin_spendable_balance", "Bitcoin address and destination chain are required");
    }

    try {
      const bitcoinSpendable = await this.atomiqService.getBitcoinSpendableBalance(payload.bitcoinAddress, payload.destinationChain);
      return this.createSuccessResult("atomiq_bitcoin_spendable_balance", {
        bitcoinAddress: payload.bitcoinAddress,
        destinationChain: payload.destinationChain,
        bitcoinSpendable: bitcoinSpendable,
        message: `Bitcoin spendable balance retrieved for ${payload.bitcoinAddress}`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_bitcoin_spendable_balance", `Failed to get Bitcoin spendable balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getSwapLimits(payload: AtomiqPayload): Promise<ToolResult> {
    try {
      const limits = this.atomiqService.getSwapLimits(
        this.atomiqService.tokens.STARKNET.STRK,
        this.atomiqService.tokens.BITCOIN.BTC
      );
      return this.createSuccessResult("atomiq_limits", {
        limits: limits,
        message: `Swap limits retrieved`
      });
    } catch (error) {
      return this.createErrorResult("atomiq_limits", `Failed to get swap limits: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const atomiqTool = new AtomiqTool();