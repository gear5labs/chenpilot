import {
  handleInvalidPlannerOutputFallback,
  getSanitizedDenialRationale,
  exportBoundedSupportTrace,
  IdempotentToolExecutionManager,
  PolicyDenialClass,
} from "../plannerSafety";

describe("Planner Safety, Policy Rationale & Idempotent Invocations (#1090, #1091, #1092, #1095)", () => {
  // --------------------------------------------------------------------------
  // #1090: Deterministic fallback for invalid planner output
  // --------------------------------------------------------------------------
  describe("#1090: Handle invalid planner output fallback", () => {
    it("should return non-executable failure on malformed JSON", () => {
      const res = handleInvalidPlannerOutputFallback("invalid json content {{{", 1);
      expect(res.isExecutable).toBe(false);
      expect(res.failureReason).toBe("MALFORMED_OUTPUT");
      expect(res.retryAllowed).toBe(true);
    });

    it("should detect unknown tool and request clarification", () => {
      const res = handleInvalidPlannerOutputFallback(JSON.stringify({ not_a_tool: true }), 1);
      expect(res.isExecutable).toBe(false);
      expect(res.failureReason).toBe("UNKNOWN_TOOL");
    });

    it("should disallow retry once maximum attempts are reached", () => {
      const res = handleInvalidPlannerOutputFallback("malformed", 3, 3);
      expect(res.retryAllowed).toBe(false);
      expect(res.failureReason).toBe("EXCEEDED_RETRIES");
    });
  });

  // --------------------------------------------------------------------------
  // #1091: User-visible rationale for denied execution plans
  // --------------------------------------------------------------------------
  describe("#1091: Preserve user-visible rationale for policy denial", () => {
    it("should return clean and non-empty rationale for all denial classes without leaking internal tags", () => {
      for (const denial of Object.values(PolicyDenialClass)) {
        const msg = getSanitizedDenialRationale(denial);
        expect(msg.length).toBeGreaterThan(10);
        expect(msg).not.toContain("CLASS_");
        expect(msg).not.toContain("DENIAL_");
      }
    });
  });

  // --------------------------------------------------------------------------
  // #1092: Bounded planner trace export for support cases
  // --------------------------------------------------------------------------
  describe("#1092: Bounded support trace export", () => {
    it("should redact secret keys and arguments in exported trace", () => {
      const trace = exportBoundedSupportTrace("trace-123", "DENIED", PolicyDenialClass.UNAUTHORIZED_CAPABILITY, [
        {
          tool: "sorobanTransfer",
          args: { secretKey: "SBEXAMPLEKEY12345", amount: "500", memo: "test" },
          decision: "DENIED",
        },
      ]);

      expect(trace.traceId).toBe("trace-123");
      expect(trace.sanitizedRationale).toContain("requires elevated permissions");
      expect(trace.steps[0].redactedArgsSummary.secretKey).toBe("[REDACTED_SECRET]");
      expect(trace.steps[0].redactedArgsSummary.amount).toBe("500");
    });
  });

  // --------------------------------------------------------------------------
  // #1095: Duplicate tool invocation prevention
  // --------------------------------------------------------------------------
  describe("#1095: Idempotent tool execution", () => {
    it("should return cached result without calling underlying function twice", async () => {
      const manager = new IdempotentToolExecutionManager();
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return { txHash: "0xabcdef" };
      };

      const first = await manager.executeIdempotent("key-1", { to: "alice", amount: 10 }, fn);
      expect(first.cached).toBe(false);
      expect(callCount).toBe(1);

      const second = await manager.executeIdempotent("key-1", { to: "alice", amount: 10 }, fn);
      expect(second.cached).toBe(true);
      expect(second.result.txHash).toBe("0xabcdef");
      expect(callCount).toBe(1); // not incremented!
    });

    it("should throw error when conflicting payload is used with same idempotency key", async () => {
      const manager = new IdempotentToolExecutionManager();
      await manager.executeIdempotent("key-2", { to: "alice" }, async () => "ok");

      await expect(
        manager.executeIdempotent("key-2", { to: "bob" }, async () => "ok")
      ).rejects.toThrow("Idempotency conflict");
    });
  });
});
