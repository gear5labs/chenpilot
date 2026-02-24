import { WorkflowPlan } from "../types";
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { memoryStore } from "../memory/memory";
import { responseAgent } from "./responseagent";
import logger from "../../config/logger";
import { withTimeout, TimeoutError } from "../../utils/timeout";
import config from "../../config/config";
export class ExecutionAgent {
  async run(plan: WorkflowPlan, userId: string, input: string, timeoutMs?: number) {
    const timeout = timeoutMs || config.agent.timeouts.agentExecution;
    const startTime = Date.now();

    logger.info("Starting agent execution", { userId, timeout, stepCount: plan.workflow.length });

    try {
      return await withTimeout(
        this.executeWorkflow(plan, userId, input, startTime, timeout),
        {
          timeoutMs: timeout,
          operation: `Agent execution for user ${userId}`,
          onTimeout: () => {
            logger.error("Agent execution timeout", { userId, timeout, elapsed: Date.now() - startTime });
          },
        }
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error("Agent execution timed out", { userId, timeout });
        return {
          success: false,
          error: `Agent execution timed out after ${timeout}ms`,
        };
      }
      throw error;
    }
  }

  private async executeWorkflow(
    plan: WorkflowPlan,
    userId: string,
    input: string,
    startTime: number,
    totalTimeout: number
  ) {
    const results: ToolResult[] = [];

    for (const step of plan.workflow) {
      const elapsed = Date.now() - startTime;
      const remainingTime = totalTimeout - elapsed;

      if (remainingTime <= 0) {
        throw new TimeoutError(
          "Execution timeout reached before completing all steps",
          "workflow_execution",
          totalTimeout
        );
      }

      try {
        logger.info("Executing tool", { action: step.action, userId, remainingTime });
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId,
          Math.min(remainingTime, config.agent.timeouts.toolExecution)
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
    logger.info("Workflow execution completed", { userId, hasResponse: !!res?.response, duration: Date.now() - startTime });
    return { success: true, data: res?.response };
  }
}

export const executionAgent = new ExecutionAgent();
