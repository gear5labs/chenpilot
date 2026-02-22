import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import { WorkflowPlan, WorkflowStep } from "../types";
import { memoryStore } from "../memory/memory";
import { parseSorobanIntent } from "../planner/sorobanIntent";
import logger from "../../config/logger";

export class IntentAgent {
  private initialized = false;

  async handle(input: string, userId: string) {
    if (!this.initialized) {
      await toolAutoDiscovery.initialize();
      this.initialized = true;
    }

    const isValid = await validateQuery(input, userId);
    if (!isValid) {
      return { success: false, error: "Invalid request format" };
    }

    const workflow = await this.planWorkflow(input, userId);
    logger.info("Workflow planned", { workflow, userId });
    if (!workflow.workflow.length) {
      return { success: false, error: "Could not determine workflow" };
    }
    return executionAgent.run(workflow, userId, input);
  }

  private async planWorkflow(
    input: string,
    userId: string
  ): Promise<WorkflowPlan> {
    const startTime = Date.now();
    let promptVersionId: string | undefined;

    try {
      const sorobanWorkflow = parseSorobanIntent(input);
      if (sorobanWorkflow) {
        memoryStore.add(userId, `User: ${input}`);
        return sorobanWorkflow;
      }

      const promptVersion = await promptGenerator.generateIntentPrompt();
      promptVersionId = (promptVersion as any).id;

      const prompt = (typeof promptVersion === "string"
        ? promptVersion
        : promptVersion
      )
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId);

      const parsed = await agentLLM.callLLM(userId, prompt, "", true);
      const steps: WorkflowStep[] = Array.isArray(parsed?.workflow)
        ? parsed.workflow
        : [];

      if (promptVersionId) {
        const { promptVersionService } = await import(
          "../registry/PromptVersionService"
        );
        await promptVersionService.trackMetric(
          promptVersionId,
          steps.length > 0,
          userId,
          Date.now() - startTime
        );
      }

      memoryStore.add(userId, `User: ${input}`);
      return { workflow: steps };
    } catch (err) {
      if (promptVersionId) {
        const { promptVersionService } = await import(
          "../registry/PromptVersionService"
        );
        await promptVersionService.trackMetric(
          promptVersionId,
          false,
          userId,
          Date.now() - startTime
        );
      }
      logger.error("LLM workflow parsing failed", { error: err, userId });
      return { workflow: [] };
    }
  }
}

export const intentAgent = new IntentAgent();
