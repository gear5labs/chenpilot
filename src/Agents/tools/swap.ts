import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

interface SwapPayload extends Record<string, unknown> {
  from: string;
  to: string;
  amount: number;
  crossChain?: boolean;
  bitcoinAddress?: string;
}

export class SwapTool extends BaseTool<SwapPayload> {
  metadata: ToolMetadata = {
    name: "swap_tool",
    description: "Swap tokens between different cryptocurrencies",
    parameters: {
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["STRK", "ETH", "DAI", "USDC", "USDT", "BTC"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["STRK", "ETH", "DAI", "USDC", "USDT", "BTC"],
      },
      amount: {
        type: "number",
        description: "Amount to swap",
        required: true,
        min: 0,
      },
      crossChain: {
        type: "boolean",
        description: "Whether this is a cross-chain swap (BTC ↔ other tokens)",
        required: false,
      },
      bitcoinAddress: {
        type: "string",
        description: "Bitcoin address for BTC swaps",
        required: false,
      },
    },
    examples: [
      "Swap 100 STRK to ETH",
      "Convert 50 DAI to USDC",
      "Exchange 0.5 ETH for STRK",
      "Swap 0.01 BTC to STRK",
      "Convert 1000 STRK to BTC",
    ],
    category: "trading",
    version: "1.0.0",
  };

  async execute(payload: SwapPayload, userId: string): Promise<ToolResult> {
    try {
      // Check if this is a cross-chain swap involving BTC
      const isBtcSwap = payload.from === "BTC" || payload.to === "BTC";
      
      if (isBtcSwap) {
        // Import and use the cross-chain swap tool for BTC swaps
        const { crossChainSwapTool } = await import("./crossChainSwap");
        return crossChainSwapTool.execute({
          from: payload.from as "BTC" | "STRK",
          to: payload.to as "BTC" | "STRK",
          amount: payload.amount,
          exactIn: true, // Default to exact input
          bitcoinAddress: payload.bitcoinAddress,
        }, userId);
      }

      // Handle regular Starknet token swaps (existing logic)
      console.log(
        `User ${userId} swapping ${payload.amount} ${payload.from} → ${payload.to}`
      );

      // Simulate swap processing time
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return this.createSuccessResult("swap", {
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        txHash: "0xMOCKSWAP123",
        timestamp: new Date().toISOString(),
      });
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
