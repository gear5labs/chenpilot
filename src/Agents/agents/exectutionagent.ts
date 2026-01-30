import { WorkflowPlan } from "../types";
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { memoryStore } from "../memory/memory";
import { responseAgent } from "./responseagent";
import logger from "../../config/logger";
export class ExecutionAgent {
  async run(plan: WorkflowPlan, userId: string, input: string) {
    const results: ToolResult[] = [];

    for (const step of plan.workflow) {
      try {
        logger.info("Executing tool", { action: step.action, userId });
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId
        );
        results.push(result);
      } catch (error) {
        logger.error("Tool execution failed", { action: step.action, error, userId });
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
    const summarizedResults = results.map((r) => ({
      action: r.action,
      status: r.status,
      error: r.error ?? null,

      payload: r.data?.payload
        ? JSON.stringify(r.data.payload).slice(0, 80) + "..."
        : undefined,
    }));

    memoryStore.add(userId, `LLM: ${JSON.stringify(summarizedResults)}`);
    const res: { response: string } = await responseAgent.format(
      results,
      userId,
      input
    );
    logger.info("Workflow execution completed", { userId, hasResponse: !!res?.response });
    return { success: true, data: res?.response };
  }
}

export const executionAgent = new ExecutionAgent();
