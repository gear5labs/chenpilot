import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { atomiqService } from "../../services/AtomiqService";
import { bitcoinWalletService } from "../../services/BitcoinWalletService";

interface BitcoinWalletPayload extends Record<string, unknown> {
  operation: "get_balance" | "get_address";
  address?: string;
}

export class BitcoinWalletTool extends BaseTool<BitcoinWalletPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_wallet_tool",
    description: "Bitcoin wallet operations including balance checking and address validation",
    parameters: {
      operation: {
        type: "string",
        description: "The Bitcoin wallet operation to perform",
        required: true,
        enum: ["get_balance", "get_address"],
      },
      address: {
        type: "string",
        description: "Bitcoin address to check balance for (optional, uses default if not provided)",
        required: false,
      },
    },
    examples: [
      "Check my Bitcoin balance",
      "Get Bitcoin address for receiving funds",
      "Check balance for address bc1q...",
    ],
    category: "wallet",
    version: "1.0.0",
  };

  async execute(payload: BitcoinWalletPayload, userId: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();

      switch (payload.operation) {
        case "get_balance":
          return this.getBitcoinBalance(payload.address, userId);
        case "get_address":
          return this.getBitcoinAddress(userId);
        default:
          return this.createErrorResult(
            "bitcoin_wallet_operation",
            `Unknown operation: ${payload.operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_wallet_operation",
        `Bitcoin wallet operation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getBitcoinBalance(address?: string, userId?: string): Promise<ToolResult> {
    try {
      if (!atomiqService.isInitialized()) {
        await atomiqService.initialize();
      }

      const swapper = atomiqService.getSwapper();
      
      // Use provided address or get user's Bitcoin address
      let bitcoinAddress: string;
      if (address) {
        bitcoinAddress = address;
      } else if (userId) {
        const bitcoinWalletData = await bitcoinWalletService.getBitcoinAddress(userId);
        bitcoinAddress = bitcoinWalletData.address;
      } else {
        throw new Error("Either address or userId must be provided");
      }
      
      // Get real Bitcoin balance using Atomiq SDK
      const { balance, feeRate } = await swapper.Utils.getBitcoinSpendableBalance(
        bitcoinAddress,
        "STARKNET"
      );

      return this.createSuccessResult("bitcoin_balance", {
        address: bitcoinAddress,
        balance: `${Number(balance) / 10 ** 8} BTC`,
        feeRate: `${feeRate} sat/vB`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_balance",
        `Failed to get Bitcoin balance: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getBitcoinAddress(userId: string): Promise<ToolResult> {
    try {
      // Get Bitcoin address from Bitcoin wallet service
      const bitcoinWalletData = await bitcoinWalletService.getBitcoinAddress(userId);
      
      return this.createSuccessResult("bitcoin_address", {
        address: bitcoinWalletData.address,
        type: "bech32",
        network: bitcoinWalletData.network,
        createdAt: bitcoinWalletData.createdAt.toISOString(),
        lastUsed: bitcoinWalletData.lastUsed.toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_address",
        `Failed to get Bitcoin address: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

export const bitcoinWalletTool = new BitcoinWalletTool();
