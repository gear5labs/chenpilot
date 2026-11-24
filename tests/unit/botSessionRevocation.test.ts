/**
 * Tests for bot-linked session revocation.
 *
 * Covers:
 * - Direct revocation of all bot conversational sessions
 * - Revocation with JWT session cascade
 * - Platform-scoped revocation
 * - Cascade on bot identity unlink
 * - Failure: identity not found on unlink
 * - Boundary: zero active sessions
 * - Boundary: revokeJwtSessions=false does not touch JWT tokens
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockBotIdentityRepo = {
  findOne: jest.fn(),
  remove: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockUserRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockBotSessionRepo = {
  update: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn((entity: unknown) => {
      const name = (entity as { name?: string }).name;
      if (name === "BotIdentity") return mockBotIdentityRepo;
      if (name === "BotSession") return mockBotSessionRepo;
      return mockUserRepo;
    }),
  },
}));

jest.mock("../../src/AuditLog/auditLog.service", () => ({
  __esModule: true,
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocks are set up
import { BotIdentityService } from "../../src/Auth/botIdentity.service";
import { AuditAction } from "../../src/AuditLog/auditLog.entity";
import { BotPlatform } from "../../src/Auth/botIdentity.entity";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeIdentity(userId: string, platform: BotPlatform) {
  return {
    id: `id-${userId}-${platform}`,
    userId,
    platform,
    platformUserId: `tg-${userId}`,
    platformUsername: "testuser",
    isActive: true,
    lastLinkedAt: new Date(),
    lastUsedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BotIdentityService — revokeAllBotLinkedSessions", () => {
  let service: BotIdentityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BotIdentityService();

    // Default: deactivateUserSessions returns 0
    mockBotSessionRepo.update.mockResolvedValue({ affected: 0 });
  });

  describe("Success cases", () => {
    it("deactivates bot conversational sessions only (default)", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 3 });

      const result = await service.revokeAllBotLinkedSessions("user-1");

      expect(result.botSessionsDeactivated).toBe(3);
      expect(result.jwtSessionsRevoked).toBe(0);

      // Bot sessions were deactivated
      expect(mockBotSessionRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      );

      // Audit log recorded the revocation
      const { auditLogService } = await import("../../src/AuditLog/auditLog.service");
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.BOT_SESSIONS_REVOKED,
          severity: "warning",
          metadata: expect.objectContaining({
            botSessionsDeactivated: 3,
            jwtSessionsRevoked: 0,
            revokeJwtSessions: false,
          }),
        })
      );
    });

    it("also revokes JWT sessions when revokeJwtSessions=true", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 2 });

      const result = await service.revokeAllBotLinkedSessions("user-1", {
        revokeJwtSessions: true,
      });

      expect(result.botSessionsDeactivated).toBe(2);
      expect(result.jwtSessionsRevoked).toBeGreaterThan(0);
    });

    it("supports platform-scoped revocation", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.revokeAllBotLinkedSessions("user-1", {
        platform: BotPlatform.TELEGRAM,
      });

      expect(result.botSessionsDeactivated).toBe(1);

      // The update query should include platform filter
      const updateCall = mockBotSessionRepo.update.mock.calls[0];
      expect(updateCall[1]).toEqual({ isActive: false });
      // The `where` clause is the first argument — it should contain platform
      expect(updateCall[0]).toEqual(
        expect.objectContaining({
          userId: "user-1",
          isActive: true,
          platform: BotPlatform.TELEGRAM,
        })
      );
    });

    it("revokes sessions for all platforms when no platform specified", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 5 });

      const result = await service.revokeAllBotLinkedSessions("user-1", {});

      expect(result.botSessionsDeactivated).toBe(5);

      // The where clause should NOT include a platform filter
      const updateCall = mockBotSessionRepo.update.mock.calls[0];
      expect(updateCall[0]).toEqual({
        userId: "user-1",
        isActive: true,
      });
    });
  });

  describe("Boundary conditions", () => {
    it("returns zero counts when there are no active sessions", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 0 });

      const result = await service.revokeAllBotLinkedSessions("user-1");

      expect(result.botSessionsDeactivated).toBe(0);
      expect(result.jwtSessionsRevoked).toBe(0);
    });

    it("revokeJwtSessions=false does not touch JWT tokens", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.revokeAllBotLinkedSessions("user-1", {
        revokeJwtSessions: false,
      });

      expect(result.jwtSessionsRevoked).toBe(0);
    });

    it("works with both platform filter and revokeJwtSessions", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 2 });

      const result = await service.revokeAllBotLinkedSessions("user-1", {
        platform: BotPlatform.DISCORD,
        revokeJwtSessions: true,
      });

      expect(result.botSessionsDeactivated).toBe(2);
      expect(result.jwtSessionsRevoked).toBeGreaterThan(0);
    });
  });

  describe("Audit logging", () => {
    it("always logs the BOT_SESSIONS_REVOKED audit action", async () => {
      mockBotSessionRepo.update.mockResolvedValue({ affected: 0 });

      await service.revokeAllBotLinkedSessions("user-1");

      const { auditLogService } = await import("../../src/AuditLog/auditLog.service");
      const calls = (auditLogService.log as jest.Mock).mock.calls.filter(
        (c: unknown[]) => c[0]?.action === AuditAction.BOT_SESSIONS_REVOKED
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toMatchObject({
        userId: "user-1",
        action: AuditAction.BOT_SESSIONS_REVOKED,
        severity: "warning",
      });
    });
  });
});

describe("BotIdentityService — unlinkBotIdentity cascade", () => {
  let service: BotIdentityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BotIdentityService();
    mockBotSessionRepo.update.mockResolvedValue({ affected: 0 });
  });

  describe("Success cases", () => {
    it("removes the identity and deactivates bot sessions", async () => {
      const identity = makeIdentity("user-1", BotPlatform.TELEGRAM);
      mockBotIdentityRepo.findOne.mockResolvedValue(identity);
      mockBotIdentityRepo.remove.mockResolvedValue(identity);
      mockBotSessionRepo.update.mockResolvedValue({ affected: 2 });

      await service.unlinkBotIdentity("user-1", BotPlatform.TELEGRAM);

      // Identity was found and removed
      expect(mockBotIdentityRepo.findOne).toHaveBeenCalledWith({
        where: { userId: "user-1", platform: BotPlatform.TELEGRAM },
      });
      expect(mockBotIdentityRepo.remove).toHaveBeenCalledWith(identity);

      // Bot sessions were deactivated (cascade)
      expect(mockBotSessionRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          isActive: true,
          platform: BotPlatform.TELEGRAM,
        }),
        { isActive: false }
      );

      // Both audit actions were logged
      const { auditLogService } = await import("../../src/AuditLog/auditLog.service");
      const logCalls = (auditLogService.log as jest.Mock).mock.calls;
      const revokedCall = logCalls.find(
        (c: unknown[]) => c[0]?.action === AuditAction.BOT_SESSIONS_REVOKED
      );
      const unlinkedCall = logCalls.find(
        (c: unknown[]) => c[0]?.action === AuditAction.BOT_IDENTITY_UNLINKED
      );
      expect(revokedCall).toBeDefined();
      expect(unlinkedCall).toBeDefined();
    });

    it("cascade is platform-scoped — only sessions for that platform are deactivated", async () => {
      const identity = makeIdentity("user-1", BotPlatform.DISCORD);
      mockBotIdentityRepo.findOne.mockResolvedValue(identity);
      mockBotIdentityRepo.remove.mockResolvedValue(identity);
      mockBotSessionRepo.update.mockResolvedValue({ affected: 1 });

      await service.unlinkBotIdentity("user-1", BotPlatform.DISCORD);

      // Verify the deactivate query includes platform filter
      const updateCall = mockBotSessionRepo.update.mock.calls[0];
      expect(updateCall[0]).toEqual(
        expect.objectContaining({
          userId: "user-1",
          platform: BotPlatform.DISCORD,
        })
      );
    });
  });

  describe("Failure cases", () => {
    it("throws when the bot identity is not found", async () => {
      mockBotIdentityRepo.findOne.mockResolvedValue(null);

      await expect(
        service.unlinkBotIdentity("user-1", BotPlatform.TELEGRAM)
      ).rejects.toThrow("Bot identity not found");

      // No sessions should be deactivated
      expect(mockBotSessionRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("Boundary conditions", () => {
    it("unlink with zero active bot sessions still succeeds and logs", async () => {
      const identity = makeIdentity("user-1", BotPlatform.TELEGRAM);
      mockBotIdentityRepo.findOne.mockResolvedValue(identity);
      mockBotIdentityRepo.remove.mockResolvedValue(identity);
      mockBotSessionRepo.update.mockResolvedValue({ affected: 0 });

      await service.unlinkBotIdentity("user-1", BotPlatform.TELEGRAM);

      // Identity was still removed
      expect(mockBotIdentityRepo.remove).toHaveBeenCalled();

      // Audit still logged both actions
      const { auditLogService } = await import("../../src/AuditLog/auditLog.service");
      const logCalls = (auditLogService.log as jest.Mock).mock.calls;
      expect(
        logCalls.some((c: unknown[]) => c[0]?.action === AuditAction.BOT_SESSIONS_REVOKED)
      ).toBe(true);
      expect(
        logCalls.some((c: unknown[]) => c[0]?.action === AuditAction.BOT_IDENTITY_UNLINKED)
      ).toBe(true);
    });
  });
});
