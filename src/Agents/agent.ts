import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config";
import { memoryStore } from "./memory/memory";
import logger from "../config/logger";
import {
  LLMTokenUsage,
  recordLLMUsage,
} from "../observability/agentPlanMetrics";
import {
  ModelFallbackOrchestrator,
  LLMCallContext,
} from "./models/ModelFallbackOrchestrator";
import { CapabilityRequirement, PlanVersion } from "./models/ModelCapability";
import { v4 as uuidv4 } from "uuid";

const client = new Anthropic({
  apiKey: config.apiKey,
});

// Initialize fallback orchestrator
const fallbackOrchestrator = new ModelFallbackOrchestrator(client, {
  maxRetries: config.models.maxRetries,
  baseDelayMs: 1000,
  exponentialBackoff: true,
  tryDifferentModels: true,
});

export class AgentLLM {
  async callLLM(
    agentId: string,
    prompt: string,
    userInput: string,
    asJson = true,
    timeoutMs?: number | string,
    traceId?: string,
    options?: {
      userId?: string;
      requirements?: CapabilityRequirement;
    }
  ): Promise<unknown> {
    const actualTimeoutMs =
      typeof timeoutMs === "string" ? undefined : timeoutMs;
    const actualTraceId =
      typeof timeoutMs === "string" ? timeoutMs : traceId || "";

    const timeout = actualTimeoutMs || config.agent.timeouts.llmCall;
    const memoryContext = memoryStore.get(agentId).join("\n");
    const safeUserInput = userInput.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fullPrompt = `${
      memoryContext ? "Previous context:\n" + memoryContext + "\n\n" : ""
    }${prompt}\n\n<user_input>\n${safeUserInput}\n</user_input>`;

    logger.debug("Starting LLM call with fallback orchestration", {
      agentId,
      timeout,
      asJson,
      traceId: actualTraceId,
      useFallback: config.models.verifyEquivalence,
    });

    // Use fallback orchestrator if enabled
    if (config.models.verifyEquivalence) {
      const callContext: LLMCallContext = {
        callId: uuidv4(),
        agentId,
        userId: options?.userId,
        userInput: safeUserInput,
        requirements: options?.requirements || {
          minPlanVersion: PlanVersion.V1_WORKFLOW,
          minQualityScore: config.models.minQualityScore,
        },
        preferredModelId: config.models.primary,
        strategy: config.models.selectionStrategy as any,
        fallbackChainName: "default",
        maxRetries: config.models.maxRetries,
        timeoutMs: timeout,
      };

      try {
        const result = await fallbackOrchestrator.executeCall(callContext, fullPrompt, {
          asJson,
          maxTokens: 4096,
        });

        // Record usage
        const usage: LLMTokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          provider: "anthropic",
          model: result.modelId,
        };
        recordLLMUsage(actualTraceId || agentId, usage);

        // Log fallback decision
        if (result.usedFallback) {
          logger.warn("Used fallback model for LLM call", {
            agentId,
            primaryModel: config.models.primary,
            usedModel: result.modelId,
            validationScore: result.validation.qualityScore,
            decisionCount: result.decisionLog.length,
          });
        }

        // Log validation warnings
        if (!result.validation.valid) {
          logger.warn("LLM output validation failed", {
            agentId,
            modelId: result.modelId,
            errors: result.validation.errors.map(e => e.message),
            qualityScore: result.validation.qualityScore,
          });
        }

        // Attach usage metadata
        if (result.content && typeof result.content === "object") {
          Object.defineProperty(result.content, "llmUsage", {
            value: usage,
            enumerable: false,
            configurable: true,
          });
        }

        return result.content;
      } catch (error) {
        logger.error("Fallback orchestration failed", {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Legacy path: direct call without fallback (if verification disabled)
    logger.debug("Using legacy direct LLM call (fallback disabled)");
    
    const message = await client.messages.create({
      model: config.models.primary,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: fullPrompt + (asJson ? "\n\nPlease respond with valid JSON only." : ""),
        },
      ],
    });

    const usage: LLMTokenUsage = {
      inputTokens: message.usage?.input_tokens || 0,
      outputTokens: message.usage?.output_tokens || 0,
      totalTokens:
        (message.usage?.input_tokens || 0) +
        (message.usage?.output_tokens || 0),
      provider: "anthropic",
      model: config.models.primary,
    };

    recordLLMUsage(actualTraceId || agentId, usage);

    const content =
      message.content[0].type === "text" ? message.content[0].text : "{}";

    if (asJson) {
      try {
        const parsed = JSON.parse(content) as unknown;
        if (parsed && typeof parsed === "object") {
          Object.defineProperty(parsed, "llmUsage", {
            value: usage,
            enumerable: false,
            configurable: true,
          });
        }
        return parsed;
      } catch (err) {
        logger.error("JSON parse error", { error: err, rawContent: content });
        return {};
      }
    }

    return content;
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics() {
    return fallbackOrchestrator.getMetrics();
  }
}

export const agentLLM = new AgentLLM();
