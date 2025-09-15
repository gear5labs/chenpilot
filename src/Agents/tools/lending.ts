import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

interface LendingPayload extends Record<string, unknown> {
  token: string;
  amount: number;
  duration?: number; 
  interestRate?: number; 
}

export class LendingTool extends BaseTool<LendingPayload> {
  metadata: ToolMetadata = {
    name: "lending_tool",
    description: "Lend tokens to earn interest through DeFi protocols",
    parameters: {
      token: {
        type: "string",
        description: "Token symbol to lend",
        required: true,
        enum: ["STRK", "ETH", "DAI", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount to lend",
        required: true,
        min: 0,
      },
      duration: {
        type: "number",
        description: "Lending duration in days",
        required: false,
        min: 1,
        max: 365,
      },
      interestRate: {
        type: "number",
        description: "Expected annual interest rate (optional)",
        required: false,
        min: 0,
        max: 100,
      },
    },
    examples: [
      "Lend 1000 USDC for 30 days",
      "Lend 50 ETH to earn interest",
      "Lend 5000 DAI for 90 days at 5% APY",
    ],
    category: "lending",
    version: "1.0.0",
  };

  async execute(payload: LendingPayload, userId: string): Promise<ToolResult> {
    try {
      // Mock lending logic - replace with actual DeFi integration
      console.log(
        `User ${userId} lending ${payload.amount} ${payload.token} for ${
          payload.duration || 30
        } days`
      );

      // Simulate lending processing time
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const estimatedReturn = this.calculateEstimatedReturn(
        payload.amount,
        payload.duration || 30,
        payload.interestRate || 5
      );

      return this.createSuccessResult("lending", {
        token: payload.token,
        amount: payload.amount,
        duration: payload.duration || 30,
        interestRate: payload.interestRate || 5,
        estimatedReturn,
        txHash: "0xMOCKLENDING123",
        timestamp: new Date().toISOString(),
        protocol: "MockLendingProtocol",
      });
    } catch (error) {
      return this.createErrorResult(
        "lending",
        `Lending failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private calculateEstimatedReturn(
    amount: number,
    duration: number,
    interestRate: number
  ): number {
    // Simple interest calculation: amount * rate * (duration / 365)
    return amount * (interestRate / 100) * (duration / 365);
  }
}

export const lendingTool = new LendingTool();
