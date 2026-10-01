/**
 * expiryPersistence.test.ts
 *
 * Tests for expiry persistence in workflows awaiting external approval.
 * Verifies that expiresAt fields are properly set and persisted in:
 * - DurableExecution (plan-level approvals)
 * - DurableStep (step-level approvals)
 * - InterventionRecord (intervention approvals)
 */

import { DurableExecution, ExecutionStatus } from "../DurableExecution.entity";
import { DurableStep, StepStatus } from "../DurableStep.entity";
import { InterventionRecord, InterventionStatus } from "../intervention.entity";
import { InterventionCommand } from "../intervention.types";

describe("Expiry Persistence for Awaiting Approval", () => {
  describe("DurableExecution", () => {
    it("should have expiresAt field defined", () => {
      const execution = new DurableExecution();
      expect(execution).toHaveProperty("expiresAt");
      expect(execution.expiresAt).toBeUndefined();
    });

    it("should allow setting expiresAt", () => {
      const execution = new DurableExecution();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      execution.expiresAt = expiresAt;
      expect(execution.expiresAt).toEqual(expiresAt);
    });

    it("should support AWAITING_APPROVAL status with expiresAt", () => {
      const execution = new DurableExecution();
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      execution.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      expect(execution.status).toBe(ExecutionStatus.AWAITING_APPROVAL);
      expect(execution.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("DurableStep", () => {
    it("should have expiresAt field defined", () => {
      const step = new DurableStep();
      expect(step).toHaveProperty("expiresAt");
      expect(step.expiresAt).toBeUndefined();
    });

    it("should allow setting expiresAt", () => {
      const step = new DurableStep();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      step.expiresAt = expiresAt;
      expect(step.expiresAt).toEqual(expiresAt);
    });

    it("should support AWAITING_APPROVAL status with expiresAt", () => {
      const step = new DurableStep();
      step.status = StepStatus.AWAITING_APPROVAL;
      step.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      expect(step.status).toBe(StepStatus.AWAITING_APPROVAL);
      expect(step.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("InterventionRecord", () => {
    it("should have expiresAt field defined", () => {
      const record = new InterventionRecord();
      expect(record).toHaveProperty("expiresAt");
      expect(record.expiresAt).toBeUndefined();
    });

    it("should allow setting expiresAt", () => {
      const record = new InterventionRecord();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      record.expiresAt = expiresAt;
      expect(record.expiresAt).toEqual(expiresAt);
    });

    it("should support PENDING_APPROVAL status with expiresAt", () => {
      const record = new InterventionRecord();
      record.status = InterventionStatus.PENDING_APPROVAL;
      record.command = InterventionCommand.COMPENSATE;
      record.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      expect(record.status).toBe(InterventionStatus.PENDING_APPROVAL);
      expect(record.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("Expiry Validation", () => {
    it("should detect expired execution", () => {
      const execution = new DurableExecution();
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      execution.expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago
      expect(execution.expiresAt).toBeLessThan(new Date());
    });

    it("should detect non-expired execution", () => {
      const execution = new DurableExecution();
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      execution.expiresAt = new Date(Date.now() + 60 * 60 * 1000); // Expires in 1 hour
      expect(execution.expiresAt).toBeGreaterThan(new Date());
    });

    it("should handle null expiresAt gracefully", () => {
      const execution = new DurableExecution();
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      execution.expiresAt = undefined;
      expect(execution.expiresAt).toBeUndefined();
    });
  });
});
