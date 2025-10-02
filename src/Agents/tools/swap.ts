import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

interface SwapPayload extends Record<string, unknown> {
  from: "STRK" | "BTC";
  to: "STRK" | "BTC";
  amount: number;
  bitcoinAddress?: string;
}

export class SwapTool extends BaseTool<SwapPayload> {
  metadata: ToolMetadata = {
    name: "swap_tool",
    description: "Cross-chain swaps between STRK and BTC using Atomiq protocol",
    parameters: {
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["STRK", "BTC"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["STRK", "BTC"],
      },
      amount: {
        type: "number",
        description: "Amount to swap",
        required: true,
        min: 0,
      },
      bitcoinAddress: {
        type: "string",
        description: "Bitcoin address to receive BTC (optional - will use default testnet address if not provided)",
        required: false,
      },
    },
    examples: [
      "Swap 100 STRK to BTC",
      "Convert 0.01 BTC to STRK",
      "Exchange 500 STRK for BTC",
      "Swap 0.005 BTC to STRK",
    ],
    category: "trading",
    version: "1.0.0",
  };

  async execute(payload: SwapPayload, userId: string): Promise<ToolResult> {
    try {
      console.log(`SwapTool.execute called with userId: ${userId}`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
      
      // Validate that this is a BTC ↔ STRK swap
      if (payload.from === payload.to) {
        return this.createErrorResult(
          "swap",
          "Source and destination tokens cannot be the same"
        );
      }

      if (!["BTC", "STRK"].includes(payload.from) || !["BTC", "STRK"].includes(payload.to)) {
        return this.createErrorResult(
          "swap",
          "Only STRK ↔ BTC swaps are supported"
        );
      }

      console.log(`Processing ${payload.from} → ${payload.to} swap for user: ${userId}`);
      
      // Delegate to CrossChainSwapTool for all BTC ↔ STRK swaps
      const { crossChainSwapTool } = await import("./crossChainSwap");
      
      const result = await crossChainSwapTool.execute({
        operation: "swap", // Default to swap operation
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        exactIn: payload.from === "BTC", // Set based on swap direction
        bitcoinAddress: payload.bitcoinAddress,
      }, userId);
      
      console.log(`CrossChainSwapTool result:`, result);
      return result;
    } catch (error) {
      return this.createErrorResult(
        "swap",
        `Swap failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

export const swapTool = new SwapTool();
