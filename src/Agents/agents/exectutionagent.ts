import { WorkflowPlan } from "../types";
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";

export class ExecutionAgent {
  async run(plan: WorkflowPlan, userId: string) {
    const results: ToolResult[] = [];

    for (const step of plan.workflow) {
      try {
        // Use the tool registry to execute the action
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId
        );
        results.push(result);
      } catch (error) {
        // Handle tool execution errors
        const errorResult: ToolResult = {
          action: step.action,
          status: "error",
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: { payload: step.payload },
        };
        results.push(errorResult);
      }
    }

    return { success: true, results };
  }
}

export const executionAgent = new ExecutionAgent();
