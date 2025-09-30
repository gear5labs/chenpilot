import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { atomiqService } from "../../services/AtomiqService";
import { walletService } from "../../services/WalletService";

interface SwapStatePayload extends Record<string, unknown> {
  operation: "get_swap_status" | "get_refundable_swaps" | "get_claimable_swaps" | "refund_swap" | "claim_swap";
  swapId?: string;
  chain?: "STARKNET";
}

export class SwapStateManagerTool extends BaseTool<SwapStatePayload> {
  metadata: ToolMetadata = {
    name: "swap_state_manager_tool",
    description: "Manage and monitor cross-chain swap states, handle refunds and claims",
    parameters: {
      operation: {
        type: "string",
        description: "The swap state management operation to perform",
        required: true,
        enum: ["get_swap_status", "get_refundable_swaps", "get_claimable_swaps", "refund_swap", "claim_swap"],
      },
      swapId: {
        type: "string",
        description: "Swap ID for status checking, refunding, or claiming",
        required: false,
      },
      chain: {
        type: "string",
        description: "Blockchain to check for refundable/claimable swaps",
        required: false,
        enum: ["STARKNET"],
      },
    },
    examples: [
      "Check status of swap abc123",
      "Get all refundable swaps",
      "Get all claimable swaps on Starknet",
      "Refund swap abc123",
      "Claim swap abc123",
    ],
    category: "trading",
    version: "1.0.0",
  };

  async execute(payload: SwapStatePayload, userId: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();

      switch (payload.operation) {
        case "get_swap_status":
          return this.getSwapStatus(payload.swapId, userId);
        case "get_refundable_swaps":
          return this.getRefundableSwaps(payload.chain || "STARKNET", userId);
        case "get_claimable_swaps":
          return this.getClaimableSwaps(payload.chain || "STARKNET", userId);
        case "refund_swap":
          return this.refundSwap(payload.swapId, userId);
        case "claim_swap":
          return this.claimSwap(payload.swapId, userId);
        default:
          return this.createErrorResult(
            "swap_state_operation",
            `Unknown operation: ${payload.operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult(
        "swap_state_operation",
        `Swap state operation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getSwapStatus(swapId?: string, userId?: string): Promise<ToolResult> {
    try {
      if (!swapId) {
        return this.createErrorResult(
          "swap_status",
          "Swap ID is required for status checking"
        );
      }

      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      const swap = await swapper.getSwapById(swapId);
      
      if (!swap) {
        return this.createErrorResult(
          "swap_status",
          `Swap with ID ${swapId} not found`
        );
      }

      const state = swap.getState();
      const stateDescription = this.getStateDescription(state);

      return this.createSuccessResult("swap_status", {
        swapId: swapId,
        state: state,
        stateDescription: stateDescription,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "swap_status",
        `Failed to get swap status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getRefundableSwaps(chain: string, userId: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      
      // Get user's address (you'll need to implement this based on your wallet system)
      const userAddress = await this.getUserAddress(userId);
      
      if (!userAddress) {
        return this.createErrorResult(
          "refundable_swaps",
          "Unable to get user address"
        );
      }
      
      const refundableSwaps = await swapper.getRefundableSwaps(chain, userAddress);
      
      const swapDetails = refundableSwaps.map((swap: any) => ({
        swapId: swap.getId(),
        state: swap.getState(),
        stateDescription: this.getStateDescription(swap.getState()),
        createdAt: new Date().toISOString(), // You might want to store this in your database
      }));

      return this.createSuccessResult("refundable_swaps", {
        chain: chain,
        count: refundableSwaps.length,
        swaps: swapDetails,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "refundable_swaps",
        `Failed to get refundable swaps: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getClaimableSwaps(chain: string, userId: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      
      // Get user's address (you'll need to implement this based on your wallet system)
      const userAddress = await this.getUserAddress(userId);
      
      if (!userAddress) {
        return this.createErrorResult(
          "claimable_swaps",
          "Unable to get user address"
        );
      }
      
      const claimableSwaps = await swapper.getClaimableSwaps(chain, userAddress);
      
      const swapDetails = claimableSwaps.map((swap: any) => ({
        swapId: swap.getId(),
        state: swap.getState(),
        stateDescription: this.getStateDescription(swap.getState()),
        createdAt: new Date().toISOString(), // You might want to store this in your database
      }));

      return this.createSuccessResult("claimable_swaps", {
        chain: chain,
        count: claimableSwaps.length,
        swaps: swapDetails,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "claimable_swaps",
        `Failed to get claimable swaps: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async refundSwap(swapId?: string, userId?: string): Promise<ToolResult> {
    try {
      if (!swapId) {
        return this.createErrorResult(
          "refund_swap",
          "Swap ID is required for refunding"
        );
      }

      if (!userId) {
        return this.createErrorResult(
          "refund_swap",
          "User ID is required for refunding"
        );
      }

      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      const swap = await swapper.getSwapById(swapId);
      
      if (!swap) {
        return this.createErrorResult(
          "refund_swap",
          `Swap with ID ${swapId} not found`
        );
      }

      // Get signer for the user
      const signer = await this.getUserSigner(userId);
      
      if (!signer) {
        return this.createErrorResult(
          "refund_swap",
          "Unable to get user signer"
        );
      }
      
      // Attempt to refund the swap
      await swap.refund(signer);

      return this.createSuccessResult("refund_swap", {
        swapId: swapId,
        status: "refunded",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "refund_swap",
        `Failed to refund swap: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async claimSwap(swapId?: string, userId?: string): Promise<ToolResult> {
    try {
      if (!swapId) {
        return this.createErrorResult(
          "claim_swap",
          "Swap ID is required for claiming"
        );
      }

      if (!userId) {
        return this.createErrorResult(
          "claim_swap",
          "User ID is required for claiming"
        );
      }

      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      const swap = await swapper.getSwapById(swapId);
      
      if (!swap) {
        return this.createErrorResult(
          "claim_swap",
          `Swap with ID ${swapId} not found`
        );
      }

      // Get signer for the user
      const signer = await this.getUserSigner(userId);
      
      if (!signer) {
        return this.createErrorResult(
          "claim_swap",
          "Unable to get user signer"
        );
      }
      
      // Attempt to claim the swap
      await swap.claim(signer);

      return this.createSuccessResult("claim_swap", {
        swapId: swapId,
        status: "claimed",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "claim_swap",
        `Failed to claim swap: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private getStateDescription(state: number): string {
    // Map swap states to human-readable descriptions
    const stateMap: Record<number, string> = {
      [-3]: "Refunded",
      [-2]: "Quote Expired",
      [-1]: "Quote Soft Expired",
      0: "Created",
      1: "Committed",
      2: "Soft Claimed",
      3: "Claimed",
      4: "Refundable",
    };
    
    return stateMap[state] || `Unknown State (${state})`;
  }

      private async getUserAddress(userId: string): Promise<string> {
        try {
          return await walletService.getUserAddress(userId);
        } catch (error) {
          console.error("Failed to get user address:", error);
          throw new Error("Unable to get user address");
        }
      }

      private async getUserSigner(userId: string): Promise<any | null> {
        try {
          const { StarknetSigner, StarknetKeypairWallet } = await import("@atomiqlabs/chain-starknet");
          const config = await import("../../config/config");
          
          const userAccountData = await walletService.getUserAccountData(userId);
          
          if (!walletService.validatePrivateKey(userAccountData.privateKey)) {
            throw new Error("Invalid private key format for user wallet");
          }
          
          const starknetSigner = new StarknetSigner(
            new StarknetKeypairWallet(config.default.node_url, userAccountData.privateKey)
          );
          
          return starknetSigner;
        } catch (error) {
          console.error("Failed to create user signer:", error);
          return null;
        }
      }
}

export const swapStateManagerTool = new SwapStateManagerTool();
