// chenpilot/src/Agents/planner/__tests__/plannerBoundedRecovery.test.ts
import {
  AgentPlanner,
  PlannerContext,
  PlannerRecoveryError,
} from "../AgentPlanner";
import { agentLLM } from "../../agent";
import { toolRegistry } from "../../registry/ToolRegistry";
import { planHashService } from "../planHash";
import {
  securityAuditor,
  SecurityEventType,
} from "../../../Security/promptIsolation/SecurityAuditor";

// Mock dependencies
jest.mock("../../agent");
jest.mock("../../registry/ToolRegistry");
jest.mock("../planHash");
jest.mock("../../../config/logger");

describe("AgentPlanner - Bounded Recovery for Invalid Planner Responses (#1224)", () => {
  let planner: AgentPlanner;
  let auditSpy: jest.SpyInstance;

  const validTools = [
    { name: "swap", description: "Swap tokens" },
    { name: "transfer", description: "Transfer tokens" },
    { name: "balance", description: "Check balance" },
  ];

  beforeEach(() => {
    planner = new AgentPlanner();
    jest.resetAllMocks();
    (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue(validTools);
    (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
      "mock-hash-123"
    );
    auditSpy = jest
      .spyOn(securityAuditor, "logSecurityEvent")
      .mockImplementation();
  });

  afterEach(() => {
    auditSpy.mockRestore();
  });

  // ============================================================
  // SUCCESS CONDITIONS
  // ============================================================
  describe("Success Conditions - Automatic Recovery", () => {
    it("should recover when first attempt has missing workflow array and second attempt succeeds", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "swap 100 USDC to XLM",
      };

      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({ invalid: "not a workflow" })
        .mockResolvedValueOnce({
          workflow: [
            {
              action: "swap",
              payload: { from: "USDC", to: "XLM", amount: 100 },
            },
          ],
        });

      const plan = await planner.createPlan(context);

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2);
      expect(plan).toBeDefined();
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].action).toBe("swap");
      expect(plan.planHash).toBe("mock-hash-123");
    });

    it("should recover when first attempt has malformed step object or invalid action", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "transfer 50 XLM",
      };

      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({
          workflow: [{ action: "", payload: {} }], // invalid empty action string
        })
        .mockResolvedValueOnce({
          workflow: [
            { action: "transfer", payload: { asset: "XLM", amount: 50 } },
          ],
        });

      const plan = await planner.createPlan(context);

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2);
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].action).toBe("transfer");
    });

    it("should recover when first attempt fails plan authorization (unauthorized tool)", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "run operation",
        constraints: {
          allowedTools: ["transfer"],
        },
      };

      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }], // 'swap' not in allowedTools
        })
        .mockResolvedValueOnce({
          workflow: [{ action: "transfer", payload: { amount: 10 } }],
        });

      const plan = await planner.createPlan(context);

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2);
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].action).toBe("transfer");
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.UNAUTHORIZED_TOOL_REJECTED,
          threatCategory: "UNAUTHORIZED_TOOL_SELECTION",
        })
      );
    });

    it("should pass recovery instruction and previous error to LLM on retry", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "swap 100 USDC to XLM",
      };

      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({ bad: "output" })
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }],
        });

      await planner.createPlan(context);

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2);
      // Second call prompt must include recovery instructions
      const secondCallPrompt = (agentLLM.callLLM as jest.Mock).mock.calls[1][1];
      const secondCallInput = (agentLLM.callLLM as jest.Mock).mock.calls[1][2];
      expect(secondCallPrompt).toContain("IMPORTANT RECOVERY INSTRUCTION");
      expect(secondCallPrompt).toContain("missing workflow array");
      expect(secondCallInput).toContain("Recovery notice");
    });

    it("should succeed on the final allowed attempt (attempt === maxRetries)", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "check balance",
        recoveryPolicy: {
          maxRetries: 2,
        },
      };

      // Fails on attempt 0 and attempt 1; succeeds on attempt 2 (3 attempts total)
      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ workflow: "not-an-array" })
        .mockResolvedValueOnce({
          workflow: [{ action: "balance", payload: {} }],
        });

      const plan = await planner.createPlan(context);

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(3);
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].action).toBe("balance");
    });
  });

  // ============================================================
  // FAILURE CONDITIONS
  // ============================================================
  describe("Failure Conditions - Exhausted Retries", () => {
    it("should throw PlannerRecoveryError with terminal metadata when default retries are exhausted", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "swap 100 USDC to XLM",
      };

      // Always return invalid response
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ notWorkflow: true });

      let thrownError: unknown;
      try {
        await planner.createPlan(context);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(PlannerRecoveryError);
      const recoveryError = thrownError as PlannerRecoveryError;
      expect(recoveryError.isTerminal).toBe(true);
      expect(recoveryError.maxRetries).toBe(2);
      expect(recoveryError.attempts).toBe(3); // Initial attempt + 2 retries = 3
      expect(recoveryError.lastError).toContain("missing workflow array");
      expect(recoveryError.message).toContain(
        "recovery retries exhausted after 2 retries (3 total attempts)"
      );

      // Verify safe terminal plan attached to error
      expect(recoveryError.safeTerminalPlan).toBeDefined();
      expect(recoveryError.safeTerminalPlan.totalSteps).toBe(0);
      expect(recoveryError.safeTerminalPlan.steps).toHaveLength(0);
      expect(recoveryError.safeTerminalPlan.isTerminal).toBe(true);
      expect(recoveryError.safeTerminalPlan.riskLevel).toBe("low");
      expect(recoveryError.safeTerminalPlan.planHash).toBe("mock-hash-123");

      // Verify security audit log for exhausted recovery
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          threatCategory: "PLANNER_RECOVERY_EXHAUSTED",
          action: "planner_bounded_recovery",
        })
      );
    });

    it("should return safe terminal plan without throwing when terminalResultMode is 'safe_terminal_plan'", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "swap 100 USDC to XLM",
        recoveryPolicy: {
          maxRetries: 1,
          terminalResultMode: "safe_terminal_plan",
        },
      };

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ invalid: true });

      const plan = await planner.createPlan(context);

      expect(plan).toBeDefined();
      expect(plan.isTerminal).toBe(true);
      expect(plan.totalSteps).toBe(0);
      expect(plan.steps).toEqual([]);
      expect(plan.riskLevel).toBe("low");
      expect(plan.requiresApproval).toBe(false);
      expect(plan.terminalReason).toContain("missing workflow array");
      expect(plan.summary).toContain(
        "Deterministic safe terminal plan: recovery exhausted after 2 attempts"
      );
    });
  });

  // ============================================================
  // BOUNDARY CONDITIONS
  // ============================================================
  describe("Boundary Conditions - Retry Limits and Delays", () => {
    it("should handle maxRetries = 0 by failing immediately after 1 attempt", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "transfer 10 XLM",
        recoveryPolicy: {
          maxRetries: 0,
        },
      };

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ invalid: true });

      await expect(planner.createPlan(context)).rejects.toThrow(
        PlannerRecoveryError
      );
      expect(agentLLM.callLLM).toHaveBeenCalledTimes(1);
    });

    it("should clamp maxRetries exceeding upper ceiling (e.g. 10) to MAX_RECOVERY_RETRIES_LIMIT (5)", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "transfer 10 XLM",
        recoveryPolicy: {
          maxRetries: 10,
        },
      };

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ invalid: true });

      let thrownError: unknown;
      try {
        await planner.createPlan(context);
      } catch (err) {
        thrownError = err;
      }

      const recoveryError = thrownError as PlannerRecoveryError;
      // 1 initial + 5 retries = 6 total attempts
      expect(agentLLM.callLLM).toHaveBeenCalledTimes(6);
      expect(recoveryError.maxRetries).toBe(5);
      expect(recoveryError.attempts).toBe(6);
    });

    it("should safely clamp negative maxRetries to 0", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "transfer 10 XLM",
        recoveryPolicy: {
          maxRetries: -3,
        },
      };

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ invalid: true });

      await expect(planner.createPlan(context)).rejects.toThrow(
        PlannerRecoveryError
      );
      expect(agentLLM.callLLM).toHaveBeenCalledTimes(1);
    });

    it("should fallback to constraints.maxRetries when recoveryPolicy.maxRetries is not set", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "transfer 10 XLM",
        constraints: {
          maxRetries: 1,
        },
      };

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ invalid: true });

      await expect(planner.createPlan(context)).rejects.toThrow(
        PlannerRecoveryError
      );
      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    it("should observe retryDelayMs backoff between retry attempts", async () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "swap 10 USDC to XLM",
        recoveryPolicy: {
          maxRetries: 1,
          retryDelayMs: 50,
        },
      };

      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({ bad: true })
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }],
        });

      const startTime = Date.now();
      await planner.createPlan(context);
      const elapsed = Date.now() - startTime;

      expect(agentLLM.callLLM).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("should generate deterministic safe terminal plan with createSafeTerminalPlan", () => {
      const context: PlannerContext = {
        userId: "user-1",
        userInput: "test input",
      };

      const terminalPlan = planner.createSafeTerminalPlan(
        context,
        "Test failure reason",
        3
      );

      expect(terminalPlan).toBeDefined();
      expect(terminalPlan.isTerminal).toBe(true);
      expect(terminalPlan.terminalReason).toBe("Test failure reason");
      expect(terminalPlan.totalSteps).toBe(0);
      expect(terminalPlan.steps).toHaveLength(0);
      expect(terminalPlan.riskLevel).toBe("low");
      expect(terminalPlan.requiresApproval).toBe(false);
      expect(terminalPlan.planHash).toBe("mock-hash-123");
    });
  });
});
