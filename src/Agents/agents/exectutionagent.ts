import { swapTool } from "../tools/swap";
import { walletTool } from "../tools/wallet";
import { WorkflowPlan } from "../types";

export class ExecutionAgent {
  async run(plan: WorkflowPlan, userId: string) {
    const results: unknown[] = [];

    for (const step of plan.workflow) {
      switch (step.action) {
        case "swap":
          results.push(await swapTool.execute(step.payload, userId));
          break;
        case "wallet_balance":
          results.push(await walletTool.getBalance(step.payload,userId));
          break;
        case "transfer":
          results.push(await walletTool.transfer(step.payload, userId));
          break;
        default:
          results.push({ error: `Unknown action: ${(step as any).action}` });
      }
    }

    return { success: true, results };
  }
}

export const executionAgent = new ExecutionAgent();
