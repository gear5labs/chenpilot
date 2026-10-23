/**
 * Capability Policy Evaluator
 * Runtime policy evaluation, per-user/per-session authorization checks against
 * tool risk tiers and required approvals, returning structured remediation errors on denial.
 */

import { CapabilityRegistry, RiskTier, ToolMetadata } from "./CapabilityRegistry";
import { capabilityAuditLogger, CapabilityAuditLogger } from "./CapabilityAuditLogger";

export interface EvaluationContext {
  userId: string;
  sessionId: string;
  approvalsProvided?: number;
  userRoles?: string[];
  isSafeMode?: boolean;
}

export interface EvaluationResult {
  allowed: boolean;
  toolName: string;
  riskTier: RiskTier;
  error?: {
    code: string;
    message: string;
    remediation: string;
  };
}

export class CapabilityPolicyEvaluator {
  private registry: CapabilityRegistry;
  private auditLogger: CapabilityAuditLogger;

  constructor(registry: CapabilityRegistry, auditLogger: CapabilityAuditLogger = capabilityAuditLogger) {
    this.registry = registry;
    this.auditLogger = auditLogger;
  }

  public evaluate(toolName: string, context: EvaluationContext): EvaluationResult {
    const tool = this.registry.getTool(toolName);

    if (!tool) {
      const result: EvaluationResult = {
        allowed: false,
        toolName,
        riskTier: "high",
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool '${toolName}' is not registered in the capability registry.`,
          remediation: "Verify the tool name or request tool registration from an administrator.",
        },
      };

      this.auditLogger.log({
        toolName,
        userId: context.userId,
        sessionId: context.sessionId,
        action: "denied",
        reason: result.error.message,
        riskTier: result.riskTier,
        requiredApprovals: 0,
        providedApprovals: context.approvalsProvided || 0,
        network: "unknown",
      });

      return result;
    }

    // Check emergency lockout or individual tool lock
    if (this.registry.isToolLocked(toolName)) {
      const result: EvaluationResult = {
        allowed: false,
        toolName,
        riskTier: tool.riskTier,
        error: {
          code: "EMERGENCY_LOCKOUT_ACTIVE",
          message: `Tool '${toolName}' is currently locked due to emergency lockout or security restrictions.`,
          remediation: "Wait for system security lock to be lifted or contact administrator.",
        },
      };

      this.auditLogger.log({
        toolName,
        userId: context.userId,
        sessionId: context.sessionId,
        action: "denied",
        reason: result.error.message,
        riskTier: tool.riskTier,
        requiredApprovals: tool.requiredApprovals,
        providedApprovals: context.approvalsProvided || 0,
        network: tool.network,
      });

      return result;
    }

    // Safe-mode check: if safe mode override is active, block high/critical risk tools unless overridden
    const isSafeMode = context.isSafeMode || this.registry.isSafeModeOverrideActive();
    if (isSafeMode && (tool.riskTier === "high" || tool.riskTier === "critical")) {
      const result: EvaluationResult = {
        allowed: false,
        toolName,
        riskTier: tool.riskTier,
        error: {
          code: "SAFE_MODE_RESTRICTION",
          message: `Tool '${toolName}' with risk tier '${tool.riskTier}' is restricted while safe-mode is active.`,
          remediation: "Disable safe-mode or obtain explicit administrative override authorization.",
        },
      };

      this.auditLogger.log({
        toolName,
        userId: context.userId,
        sessionId: context.sessionId,
        action: "denied",
        reason: result.error.message,
        riskTier: tool.riskTier,
        requiredApprovals: tool.requiredApprovals,
        providedApprovals: context.approvalsProvided || 0,
        network: tool.network,
      });

      return result;
    }

    // Check required approvals
    const providedApprovals = context.approvalsProvided || 0;
    if (providedApprovals < tool.requiredApprovals) {
      const result: EvaluationResult = {
        allowed: false,
        toolName,
        riskTier: tool.riskTier,
        error: {
          code: "INSUFFICIENT_APPROVALS",
          message: `Tool '${toolName}' requires ${tool.requiredApprovals} approvals, but only ${providedApprovals} were provided.`,
          remediation: `Obtain at least ${tool.requiredApprovals - providedApprovals} additional administrative approvals before invoking this tool.`,
        },
      };

      this.auditLogger.log({
        toolName,
        userId: context.userId,
        sessionId: context.sessionId,
        action: "denied",
        reason: result.error.message,
        riskTier: tool.riskTier,
        requiredApprovals: tool.requiredApprovals,
        providedApprovals,
        network: tool.network,
      });

      return result;
    }

    // Approved
    this.auditLogger.log({
      toolName,
      userId: context.userId,
      sessionId: context.sessionId,
      action: "approved",
      riskTier: tool.riskTier,
      requiredApprovals: tool.requiredApprovals,
      providedApprovals,
      network: tool.network,
    });

    return {
      allowed: true,
      toolName,
      riskTier: tool.riskTier,
    };
  }
}
