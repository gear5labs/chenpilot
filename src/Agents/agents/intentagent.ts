import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import { WorkflowPlan, WorkflowStep } from "../types";
import { memoryStore } from "../memory/memory";
import { parseSorobanIntent } from "../planner/sorobanIntent";
import logger from "../../config/logger";
import { randomUUID } from "crypto";

export class IntentAgent {
  private initialized = false;

  async handle(input: string, userId: string) {
    const traceId = randomUUID();
    logger.info("Intent agent started", { traceId, userId, input });

    if (!this.initialized) {
      await toolAutoDiscovery.initialize();
      this.initialized = true;
    }

    const isValid = await validateQuery(input, userId);
    if (!isValid) {
      logger.warn("Invalid request format", { traceId, userId });
      return { success: false, error: "Invalid request format" };
    }

    const workflow = await this.planWorkflow(input, userId, traceId);
    logger.info("Workflow planned", { traceId, workflow, userId });
    if (!workflow.workflow.length) {
      logger.warn("Empty workflow", { traceId, userId });
      return { success: false, error: "Could not determine workflow" };
    }
    return executionAgent.run(workflow, userId, input, traceId);
  }

  private async planWorkflow(
    input: string,
    userId: string,
    traceId: string
  ): Promise<WorkflowPlan> {
    try {
      const sorobanWorkflow = parseSorobanIntent(input);
      if (sorobanWorkflow) {
        logger.info("Soroban workflow detected", { traceId, userId });
        memoryStore.add(userId, `User: ${input}`);
        return sorobanWorkflow;
      }

      const prompt = promptGenerator
        .generateIntentPrompt()
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId);

      const parsed = await agentLLM.callLLM(
        userId,
        prompt,
        "",
        true,
        undefined,
        traceId
      );
      const steps: WorkflowStep[] = Array.isArray(
        (parsed as Record<string, unknown>)?.workflow
      )
        ? ((parsed as Record<string, unknown>).workflow as WorkflowStep[])
        : [];
      memoryStore.add(userId, `User: ${input}`);
      return { workflow: steps };
    } catch (err) {
      logger.error("LLM workflow parsing failed", {
        traceId,
        error: err,
        userId,
      });
      return { workflow: [] };
    }
  }
}

export const intentAgent = new IntentAgent();
