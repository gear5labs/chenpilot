import * as crypto from "crypto";

export enum PolicyDenialClass {
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  UNAUTHORIZED_CAPABILITY = "UNAUTHORIZED_CAPABILITY",
  HIGH_RISK_DESTINATION = "HIGH_RISK_DESTINATION",
  INSUFFICIENT_SIGNER_WEIGHT = "INSUFFICIENT_SIGNER_WEIGHT",
  SPENDING_LIMIT_EXCEEDED = "SPENDING_LIMIT_EXCEEDED",
}

export interface PlanningFailure {
  isExecutable: false;
  failureReason: "MALFORMED_OUTPUT" | "UNKNOWN_TOOL" | "MISSING_ARGUMENTS" | "EXCEEDED_RETRIES";
  clarificationPrompt: string;
  retryAllowed: boolean;
  attemptNumber: number;
}

export interface SupportTraceStep {
  toolId: string;
  decisionClass: string;
  redactedArgsSummary: Record<string, string>;
  timestamp: number;
}

export interface SupportTraceExport {
  traceId: string;
  planStatus: "EXECUTED" | "DENIED" | "FAILED";
  sanitizedRationale?: string;
  steps: SupportTraceStep[];
}

/**
 * Deterministic fallback behavior when planner output is invalid (#1090)
 */
export function handleInvalidPlannerOutputFallback(
  rawOutput: string,
  attemptNumber: number,
  maxRetries: number = 3
): PlanningFailure {
  let failureReason: PlanningFailure["failureReason"] = "MALFORMED_OUTPUT";
  let prompt = "The generated plan could not be processed due to formatting errors. Please specify your intent clearly.";

  try {
    const parsed = JSON.parse(rawOutput);
    if (!parsed.tool || typeof parsed.tool !== "string") {
      failureReason = "UNKNOWN_TOOL";
      prompt = "No recognized execution tool was selected in the plan. Please specify which action you wish to take.";
    } else if (!parsed.arguments || typeof parsed.arguments !== "object") {
      failureReason = "MISSING_ARGUMENTS";
      prompt = `Missing required parameters for action '${parsed.tool}'. Please provide the necessary transaction details.`;
    }
  } catch {
    failureReason = "MALFORMED_OUTPUT";
  }

  if (attemptNumber >= maxRetries) {
    failureReason = "EXCEEDED_RETRIES";
    prompt = "Maximum planning attempts exceeded. Please restart the request with simplified instructions.";
  }

  return {
    isExecutable: false,
    failureReason,
    clarificationPrompt: prompt,
    retryAllowed: attemptNumber < maxRetries,
    attemptNumber,
  };
}

/**
 * Maps internal denial classes to safe, actionable user messages (#1091)
 */
export function getSanitizedDenialRationale(denialClass: PolicyDenialClass): string {
  switch (denialClass) {
    case PolicyDenialClass.RATE_LIMIT_EXCEEDED:
      return "Transaction frequency limit reached. Please wait a few moments before trying again.";
    case PolicyDenialClass.UNAUTHORIZED_CAPABILITY:
      return "The requested action requires elevated permissions not granted to your account role.";
    case PolicyDenialClass.HIGH_RISK_DESTINATION:
      return "This transfer destination cannot be processed due to automated safety safeguards.";
    case PolicyDenialClass.INSUFFICIENT_SIGNER_WEIGHT:
      return "The proposed multi-sig transaction lacks the threshold signatures required to proceed.";
    case PolicyDenialClass.SPENDING_LIMIT_EXCEEDED:
      return "Transaction amount exceeds your designated safety budget limit.";
    default:
      return "The requested execution plan was rejected by governance security policy.";
  }
}

/**
 * Scoped and redacted planner trace export for support cases (#1092)
 */
export function exportBoundedSupportTrace(
  traceId: string,
  planStatus: "EXECUTED" | "DENIED" | "FAILED",
  denialClass?: PolicyDenialClass,
  rawSteps: Array<{ tool: string; args: Record<string, unknown>; decision: string }> = []
): SupportTraceExport {
  const steps: SupportTraceStep[] = rawSteps.map((s) => {
    const redactedArgsSummary: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.args)) {
      if (typeof v === "string" && (k.toLowerCase().includes("key") || k.toLowerCase().includes("secret") || v.startsWith("S"))) {
        redactedArgsSummary[k] = "[REDACTED_SECRET]";
      } else {
        redactedArgsSummary[k] = typeof v === "object" ? "[OBJECT]" : String(v).slice(0, 30);
      }
    }
    return {
      toolId: s.tool,
      decisionClass: s.decision,
      redactedArgsSummary,
      timestamp: Date.now(),
    };
  });

  return {
    traceId,
    planStatus,
    sanitizedRationale: denialClass ? getSanitizedDenialRationale(denialClass) : undefined,
    steps,
  };
}

/**
 * Idempotent tool execution manager preventing duplicate execution (#1095)
 */
export class IdempotentToolExecutionManager {
  private cache: Map<string, { payloadHash: string; result: any }> = new Map();

  private hashPayload(payload: any): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  async executeIdempotent<T>(
    idempotencyKey: string,
    payload: any,
    fn: () => Promise<T>
  ): Promise<{ result: T; cached: boolean }> {
    const currentHash = this.hashPayload(payload);
    const existing = this.cache.get(idempotencyKey);

    if (existing) {
      if (existing.payloadHash !== currentHash) {
        throw new Error(`Idempotency conflict: key '${idempotencyKey}' was previously invoked with a different payload.`);
      }
      return { result: existing.result, cached: true };
    }

    const res = await fn();
    this.cache.set(idempotencyKey, { payloadHash: currentHash, result: res });
    return { result: res, cached: false };
  }
}
