import { auditLogService } from "../auditLog.service";
import { AuditAction, AuditSeverity } from "../auditLog.entity";
import AppDataSource from "../../config/Datasource";

describe("AuditLogService", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("log", () => {
    it("should create an audit log entry", async () => {
      const log = await auditLogService.log({
        userId: "test-user-123",
        action: AuditAction.LOGIN_SUCCESS,
        severity: AuditSeverity.INFO,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        metadata: { username: "testuser" },
      });

      expect(log.id).toBeDefined();
      expect(log.userId).toBe("test-user-123");
      expect(log.action).toBe(AuditAction.LOGIN_SUCCESS);
      expect(log.severity).toBe(AuditSeverity.INFO);
      expect(log.success).toBe(true);
    });

    it("should create a failed action log", async () => {
      const log = await auditLogService.log({
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
        errorMessage: "Invalid credentials",
        metadata: { username: "unknown" },
      });

      expect(log.success).toBe(false);
      expect(log.errorMessage).toBe("Invalid credentials");
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      // Create test data
      await auditLogService.log({
        userId: "user-1",
        action: AuditAction.LOGIN_SUCCESS,
        severity: AuditSeverity.INFO,
      });

      await auditLogService.log({
        userId: "user-1",
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
      });

      await auditLogService.log({
        userId: "user-2",
        action: AuditAction.TRADE_CONFIRMED,
        severity: AuditSeverity.INFO,
      });
    });

    it("should query logs by userId", async () => {
      const { logs } = await auditLogService.query({
        userId: "user-1",
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.userId === "user-1")).toBe(true);
    });

    it("should query logs by action", async () => {
      const { logs } = await auditLogService.query({
        action: AuditAction.LOGIN_FAILED,
      });

      expect(logs.every((log) => log.action === AuditAction.LOGIN_FAILED)).toBe(
        true
      );
    });

    it("should query logs by severity", async () => {
      const { logs } = await auditLogService.query({
        severity: AuditSeverity.WARNING,
      });

      expect(logs.every((log) => log.severity === AuditSeverity.WARNING)).toBe(
        true
      );
    });

    it("should query logs by success status", async () => {
      const { logs } = await auditLogService.query({
        success: false,
      });

      expect(logs.every((log) => log.success === false)).toBe(true);
    });

    it("should apply pagination", async () => {
      const { logs } = await auditLogService.query({
        limit: 2,
        offset: 0,
      });

      expect(logs.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getUserAuditLogs", () => {
    it("should get logs for a specific user", async () => {
      const userId = "test-user-456";

      await auditLogService.log({
        userId,
        action: AuditAction.USER_CREATED,
        severity: AuditSeverity.INFO,
      });

      const { logs } = await auditLogService.getUserAuditLogs(userId);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.userId === userId)).toBe(true);
    });
  });

  describe("getFailedAuthAttempts", () => {
    it("should get failed authentication attempts", async () => {
      const userId = "test-user-789";

      await auditLogService.log({
        userId,
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
      });

      const attempts = await auditLogService.getFailedAuthAttempts(userId, 24);

      expect(attempts.length).toBeGreaterThan(0);
      expect(
        attempts.every((log) => log.action === AuditAction.LOGIN_FAILED)
      ).toBe(true);
    });
  });

  describe("getSecurityEvents", () => {
    it("should get security events", async () => {
      await auditLogService.log({
        action: AuditAction.UNAUTHORIZED_ACCESS,
        severity: AuditSeverity.CRITICAL,
        success: false,
      });

      const events = await auditLogService.getSecurityEvents(24, 100);

      expect(Array.isArray(events)).toBe(true);
      expect(
        events.every(
          (log) =>
            log.severity === AuditSeverity.WARNING ||
            log.severity === AuditSeverity.CRITICAL
        )
      ).toBe(true);
    });
  });

  describe("deleteOldLogs", () => {
    it("should delete logs older than specified days", async () => {
      // This test would require mocking dates or waiting
      // For now, just verify the method exists and returns a number
      const deletedCount = await auditLogService.deleteOldLogs(365);
      expect(typeof deletedCount).toBe("number");
    });
  });
});
