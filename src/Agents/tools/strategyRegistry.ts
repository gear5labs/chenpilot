import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Payload for the Strategy Registry tool.
 */
interface StrategyRegistryPayload extends Record<string, unknown> {
  action:
    | "vote"
    | "revoke_vote"
    | "get_strategy"
    | "is_verified"
    | "policy_preview";
  poolId?: string;
  aiAgent?: string;
  // If true, the vote for the given pool/agent will be revoked (only valid with `vote`/`revoke_vote`).
  revokeVote?: boolean;
}

/** Regex to validate Stellar pool IDs */
const POOL_ID_REGEX = /^[0-9a-f]{64}$/i;

/** Actions that require a live strategy-registry contract client. */
const CONTRACT_ACTIONS = new Set([
  "vote",
  "revoke_vote",
  "get_strategy",
  "is_verified",
]);

/**
 * Tool for interacting with the Yield-Aggregator Strategy Registry.
 *
 * Only `policy_preview` is implemented: it evaluates the off-chain policy
 * rules without touching the registry contract. Contract-backed actions
 * (`vote`, `revoke_vote`, `get_strategy`, `is_verified`) fail explicitly
 * rather than reporting a fabricated on-chain outcome.
 */
export class StrategyRegistryTool extends BaseTool<StrategyRegistryPayload> {
  metadata: ToolMetadata = {
    name: "strategy_registry",
    description:
      "Interact with the Yield‑Aggregator Strategy Registry. Currently supports off-chain policy previews only; contract actions are not implemented.",
    parameters: {
      action: {
        type: "string",
        description:
          "Action to perform: 'policy_preview' is supported; 'vote', 'revoke_vote', 'get_strategy' and 'is_verified' require the registry contract client and currently return not-implemented",
        required: true,
        enum: [
          "vote",
          "revoke_vote",
          "get_strategy",
          "is_verified",
          "policy_preview",
        ],
      },
      poolId: {
        type: "string",
        description: "64‑character hexadecimal Stellar AMM liquidity pool ID",
        required: false,
        pattern: "^[0-9a-f]{64}$",
      },
      aiAgent: {
        type: "string",
        description:
          "The public key of the AI agent casting the vote (required for 'vote')",
        required: false,
      },
      revokeVote: {
        type: "boolean",
        description: "If true, the existing vote will be revoked instead of added",
        required: false,
        default: false,
      },
    },
    examples: ["policy_preview pool 0123... with agent GAB..."],
    category: "stellar",
    version: "1.0.0",
    riskLevel: "medium",
    capabilities: ["governance"],
    permissions: ["user"],
  };

  /**
   * Validate the strategy registry payload
   * @param payload - The payload with action, poolId, and aiAgent
   * @returns Validation result with errors array
   */
  validate(payload: StrategyRegistryPayload): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    if (!payload.action) {
      errors.push("Missing required parameter: action");
    }
    if (
      payload.action === "vote" ||
      payload.action === "revoke_vote" ||
      payload.action === "policy_preview"
    ) {
      if (!payload.poolId) errors.push("Missing poolId for this action");
      if (!payload.aiAgent) errors.push("Missing aiAgent for this action");
    }
    if (payload.poolId && !POOL_ID_REGEX.test(payload.poolId)) {
      errors.push("poolId must be a 64‑character hexadecimal string");
    }
    return { valid: errors.length === 0, errors };
  }

  /** Core execution logic */
  async execute(payload: StrategyRegistryPayload): Promise<ToolResult> {
    const validation = this.validate(payload);
    if (!validation.valid) {
      return this.createErrorResult(
        "strategy_registry",
        validation.errors.join(", ")
      );
    }

    const { action, poolId, aiAgent } = payload;

    if (CONTRACT_ACTIONS.has(action)) {
      return this.createErrorResult(
        "strategy_registry",
        `Action '${action}' is not implemented: no strategy registry contract client is available`,
        {},
        "not_implemented",
        "NOT_IMPLEMENTED"
      );
    }

    if (action === "policy_preview") {
      const policy = this.evaluateOffChainPolicy(poolId, aiAgent);
      return this.createSuccessResult("strategy_registry.policy_preview", {
        poolId,
        aiAgent,
        allowed: policy.allowed,
        reason: policy.reason,
      });
    }

    return this.createErrorResult("strategy_registry", "Invalid action");
  }

  /**
   * Evaluate off-chain policy rules for voting approval
   * @param poolId - The pool ID to vote on
   * @param aiAgent - The AI agent public key
   * @returns Policy evaluation result
   */
  private evaluateOffChainPolicy(
    poolId?: string,
    aiAgent?: string
  ): { allowed: boolean; reason: string } {
    if (!poolId || !POOL_ID_REGEX.test(poolId)) {
      return { allowed: false, reason: "Invalid poolId" };
    }
    if (!aiAgent || !StellarSdk.StrKey.isValidEd25519PublicKey(aiAgent)) {
      return { allowed: false, reason: "Invalid aiAgent public key" };
    }
    return { allowed: true, reason: "Policy checks passed" };
  }
}

export const strategyRegistryTool = new StrategyRegistryTool();
