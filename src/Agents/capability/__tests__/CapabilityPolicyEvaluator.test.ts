import { CapabilityRegistry, ToolMetadata } from "../CapabilityRegistry";
import { CapabilityPolicyEvaluator } from "../CapabilityPolicyEvaluator";
import { CapabilityAuditLogger } from "../CapabilityAuditLogger";

describe("CapabilityPolicyEvaluator", () => {
  let registry: CapabilityRegistry;
  let auditLogger: CapabilityAuditLogger;
  let evaluator: CapabilityPolicyEvaluator;

  beforeEach(() => {
    registry = new CapabilityRegistry();
    auditLogger = new CapabilityAuditLogger();
    evaluator = new CapabilityPolicyEvaluator(registry, auditLogger);
  });

  const sampleTool: ToolMetadata = {
    name: "execute_swap",
    scope: "defi:swap",
    network: "stellar",
    riskTier: "medium",
    requiredApprovals: 1,
  };

  const highRiskTool: ToolMetadata = {
    name: "admin_withdrawal",
    scope: "admin:vault",
    network: "bitcoin",
    riskTier: "critical",
    requiredApprovals: 3,
  };

  it("should deny unregistered tools with TOOL_NOT_FOUND error and audit log", () => {
    const result = evaluator.evaluate("unknown_tool", {
      userId: "user_123",
      sessionId: "session_abc",
    });

    expect(result.allowed).toBe(false);
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
    expect(result.error?.remediation).toBeDefined();

    const logs = auditLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("denied");
    expect(logs[0].toolName).toBe("unknown_tool");
  });

  it("should allow tool execution when approvals and policy requirements are met", () => {
    registry.registerTool(sampleTool);

    const result = evaluator.evaluate("execute_swap", {
      userId: "user_123",
      sessionId: "session_abc",
      approvalsProvided: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();

    const logs = auditLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("approved");
    expect(logs[0].toolName).toBe("execute_swap");
  });

  it("should deny tool execution when insufficient approvals are provided", () => {
    registry.registerTool(sampleTool);

    const result = evaluator.evaluate("execute_swap", {
      userId: "user_123",
      sessionId: "session_abc",
      approvalsProvided: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.error?.code).toBe("INSUFFICIENT_APPROVALS");
    expect(result.error?.remediation).toContain("additional administrative approvals");

    const logs = auditLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("denied");
    expect(logs[0].requiredApprovals).toBe(1);
    expect(logs[0].providedApprovals).toBe(0);
  });

  it("should block high/critical risk tools when safe mode is active", () => {
    registry.registerTool(highRiskTool);

    const result = evaluator.evaluate("admin_withdrawal", {
      userId: "user_123",
      sessionId: "session_abc",
      approvalsProvided: 3,
      isSafeMode: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.error?.code).toBe("SAFE_MODE_RESTRICTION");
    expect(result.error?.remediation).toContain("safe-mode");

    const logs = auditLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("denied");
  });

  it("should block tool invocation when emergency lockout is active", () => {
    registry.registerTool(sampleTool);
    registry.setEmergencyLockout(true);

    const result = evaluator.evaluate("execute_swap", {
      userId: "user_123",
      sessionId: "session_abc",
      approvalsProvided: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.error?.code).toBe("EMERGENCY_LOCKOUT_ACTIVE");
    expect(result.error?.remediation).toBeDefined();

    const logs = auditLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("denied");
  });
});
