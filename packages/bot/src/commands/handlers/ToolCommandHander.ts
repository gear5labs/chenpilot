import { CapabilityRegistry } from "../../../../src/Agents/capability/CapabilityRegistry";
import { CapabilityPolicyEvaluator, EvaluationContext } from "../../../../src/Agents/capability/CapabilityPolicyEvaluator";

export interface ToolCommandRequest {
  toolName: string;
  userId: string;
  sessionId: string;
  payload: Record<string, unknown>;
  approvalsProvided?: number;
  isSafeMode?: boolean;
}

export interface ToolCommandResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    remediation: string;
  };
}

export class ToolCommandHandler {
  private registry: CapabilityRegistry;
  private evaluator: CapabilityPolicyEvaluator;

  constructor(registry: CapabilityRegistry, evaluator?: CapabilityPolicyEvaluator) {
    this.registry = registry;
    this.evaluator = evaluator || new CapabilityPolicyEvaluator(registry);
  }

  public async handleToolCommand(request: ToolCommandRequest, executeFn: () => Promise<unknown>): Promise<ToolCommandResponse> {
    const context: EvaluationContext = {
      userId: request.userId,
      sessionId: request.sessionId,
      approvalsProvided: request.approvalsProvided,
      isSafeMode: request.isSafeMode,
    };

    const evaluation = this.evaluator.evaluate(request.toolName, context);

    if (!evaluation.allowed) {
      return {
        success: false,
        error: evaluation.error || {
          code: "POLICY_DENIED",
          message: `Tool execution for '${request.toolName}' was denied by capability policy.`,
          remediation: "Check required approvals, safe-mode status, and tool permissions.",
        },
      };
    }

    try {
      const data = await executeFn();
      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "TOOL_EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          remediation: "Inspect tool payload and parameters, then retry.",
        },
      };
    }
  }
}
