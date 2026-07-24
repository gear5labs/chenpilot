// chenpilot/src/Agents/agents/intentagent.ts
import { validateQuery } from "../validationService";
import { agentPlanner } from "../planner/AgentPlanner";
import { planExecutor } from "../planner/PlanExecutor";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import logger from "../../config/logger";
import { randomUUID } from "crypto";
import { userPreferencesService } from "../../Auth/userPreferences.service";
import { RiskLevel } from "../../Auth/userPreferences.entity";
import { experimentService } from "../experiment/experiment.service";
import { ExperimentType } from "../experiment/experiment.entity";

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

    // Fetch user preferences
    let userPreferences;
    try {
      userPreferences =
        await userPreferencesService.getPreferencesForAgent(userId);
    } catch (error) {
      logger.warn("Failed to load user preferences, using defaults", {
        userId,
        error,
      });
    }

    const workflow = await this.planWorkflow(
      input,
      userId,
      traceId,
      userPreferences
    );
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
    traceId: string,
    userPreferences?: {
      riskLevel: RiskLevel;
      preferredAssets: string[];
      autoApproveSmallTransactions: boolean;
      smallTransactionThreshold: number;
      defaultSlippage: number | null;
    }
  ): Promise<WorkflowPlan> {
    const startTime = Date.now();
    let promptVersionId: string | undefined;
    let experimentId: string | undefined;
    let variantId: string | undefined;

    try {
      const sorobanWorkflow = parseSorobanIntent(input);
      if (sorobanWorkflow) {
        logger.info("Soroban workflow detected", { traceId, userId });
        memoryStore.add(userId, `User: ${input}`);
        return sorobanWorkflow;
      }

      // Check for active experiments
      const activeExperiments = await experimentService.getActiveExperiments(
        ExperimentType.AB_PROMPT
      );
      let selectedPrompt;

      if (activeExperiments.length > 0) {
        const experiment = activeExperiments[0];
        experimentId = experiment.id;
        variantId =
          (await experimentService.selectVariant(experimentId, userId)) ||
          undefined;

        const variant = experiment.variants.find((v) => v.id === variantId);
        if (variant?.promptVersionId) {
          selectedPrompt = await AppDataSource.getRepository(
            PromptVersion
          ).findOne({ where: { id: variant.promptVersionId } });
        }
      }

      const promptVersion =
        selectedPrompt || (await promptGenerator.generateIntentPrompt());
      promptVersionId = (promptVersion as Record<string, unknown>).id as string;

      // Build user preferences context for the prompt
      const userConstraints = userPreferences
        ? `\n\nUSER_CONSTRAINTS:\n- Risk Level: ${userPreferences.riskLevel}\n- Preferred Assets: ${userPreferences.preferredAssets.join(", ")}\n- Auto-approve small transactions (< ${userPreferences.smallTransactionThreshold}): ${userPreferences.autoApproveSmallTransactions ? "enabled" : "disabled"}\n- Default Slippage: ${userPreferences.defaultSlippage ?? "0.5"}%\n\nIMPORTANT: You MUST respect these user constraints when generating the workflow.`
        : "";

      const prompt = (
        typeof promptVersion === "string" ? promptVersion : promptVersion
      )
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId)
        .replace("{{USER_CONSTRAINTS}}", userConstraints);

      const parsed = await agentLLM.callLLM(
    try {
      // Use the new durable planner and executor
      const plan = await agentPlanner.createPlan({
        userId,
        userInput: input,
        userPreferences,
      });

      if (promptVersionId) {
        const { promptVersionService } =
          await import("../registry/PromptVersionService");
        await promptVersionService.trackMetric(
          promptVersionId,
          steps.length > 0,
          userId,
          Date.now() - startTime
        );

        // Record experiment metric if applicable
        if (experimentId && variantId) {
          await experimentService.recordMetric({
            experimentId,
            variantId,
            userId,
            traceId,
            success: steps.length > 0,
            responseTimeMs: Date.now() - startTime,
            metrics: { stepsCount: steps.length },
          });
        }
      }
      logger.info("Plan created", { traceId, planId: plan.planId, userId });

      const result = await planExecutor.executePlan(plan, userId, {
        durable: true,
      });

      return {
        success: true,
        data: {
          message: "Execution started",
          executionId: result.executionId,
          planId: result.planId,
          status: result.status,
        },
      };
    } catch (error) {
      logger.error("Failed to handle intent", { traceId, error, userId });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to process request",
      };
    }
  }
}

export const intentAgent = new IntentAgent();
