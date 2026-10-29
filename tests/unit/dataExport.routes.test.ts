import crypto from "crypto";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { User } from "../../src/Auth/user.entity";
import { Contact } from "../../src/Contacts/contact.entity";
import { RefreshToken } from "../../src/Auth/refreshToken.entity";
import AppDataSource from "../../src/config/Datasource";
import { memoryStore } from "../../src/Agents/memory/memory";
import { auditLogService } from "../../src/AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../../src/AuditLog/auditLog.entity";
import { erasureReporter } from "../../src/lifecycle/erasureReporter";

let mockCurrentUser: { userId: string; name: string; role: string; username?: string } | null = {
  userId: "user-123",
  name: "testuser",
  username: "testuser",
  role: "user",
};

jest.mock("../../src/Auth/auth.middleware", () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) => {
    if (!mockCurrentUser) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    (req as Request & { user: typeof mockCurrentUser }).user = mockCurrentUser;
    next();
  },
}));

jest.mock("../../src/config/Datasource");
jest.mock("../../src/Agents/memory/memory");
jest.mock("../../src/config/logger");
jest.mock("../../src/AuditLog/auditLog.service", () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue({ id: "audit-1" }),
  },
}));
jest.mock("../../src/lifecycle/erasureReporter", () => ({
  erasureReporter: {
    getReceipt: jest.fn(),
    verifyReceipt: jest.fn().mockReturnValue(true),
    generateReport: jest.fn().mockResolvedValue({ reportId: "report-1" }),
    generateReceipt: jest.fn().mockResolvedValue({ receiptId: "receipt-1" }),
  },
}));
jest.mock("../../src/lifecycle/deletionCoordinator", () => ({
  deletionCoordinator: {
    eraseUser: jest.fn().mockResolvedValue({
      stepsCompleted: ["db.user"],
      stepsFailed: [],
      cryptoErasurePerformed: true,
    }),
  },
}));

import dataExportRoutes from "../../src/services/dataExport.routes";

describe("Data Export Routes - Ownership & Authorization", () => {
  let app: express.Express;
  let mockUserRepository: Record<string, unknown>;
  let mockContactRepository: Record<string, unknown>;
  let mockRefreshTokenRepository: Record<string, unknown>;

  const mockUser123: Partial<User> = {
    id: "user-123",
    name: "testuser",
    email: "test@example.com",
    address: "GTEST123",
    tokenType: "XLM",
    role: "user",
    isDeployed: true,
    isFunded: true,
    isEmailVerified: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-15"),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCurrentUser = {
      userId: "user-123",
      name: "testuser",
      username: "testuser",
      role: "user",
    };

    mockUserRepository = {
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === "user-123") return Promise.resolve(mockUser123);
        return Promise.resolve(null);
      }),
    };

    mockContactRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockRefreshTokenRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === User) return mockUserRepository;
      if (entity === Contact) return mockContactRepository;
      if (entity === RefreshToken) return mockRefreshTokenRepository;
      return null;
    });

    (memoryStore.get as jest.Mock).mockReturnValue([]);

    app = express();
    app.use(express.json());
    app.use("/export", dataExportRoutes);
  });

  describe("Request-Time Scope Verification", () => {
    it("should allow GET /export/profile when no scope specified (defaults to authenticated principal)", async () => {
      const res = await request(app).get("/export/profile");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.id).toBe("user-123");
    });

    it("should allow GET /export/profile when requested userId matches authenticated principal", async () => {
      const res = await request(app).get("/export/profile?userId=user-123");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.id).toBe("user-123");
    });

    it("should deny GET /export/profile with 403 and audit when requested scope is cross-user", async () => {
      const res = await request(app).get("/export/profile?userId=victim-456");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Forbidden");

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          metadata: expect.objectContaining({
            requestedUserId: "victim-456",
            authenticatedUserId: "user-123",
            reason: "cross_user_export_scope_denied",
          }),
        })
      );
    });

    it("should deny GET /export/download with 403 and audit on cross-user scope in query", async () => {
      const res = await request(app).get("/export/download?user_id=victim-456");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
        })
      );
    });

    it("should deny GET /export/metadata with 403 and audit on cross-user scope in query", async () => {
      const res = await request(app).get("/export/metadata?userId=victim-456");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
        })
      );
    });

    it("should deny POST /export with 403 and audit on cross-user scope in body", async () => {
      const res = await request(app)
        .post("/export")
        .send({ userId: "victim-456" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          metadata: expect.objectContaining({
            requestedUserId: "victim-456",
            authenticatedUserId: "user-123",
          }),
        })
      );
    });
  });

  describe("Asynchronous Export Paths & Cross-User Export ID Access", () => {
    let createdExportId: string;

    beforeEach(async () => {
      // User 123 creates an async export
      const createRes = await request(app).post("/export").send();
      expect(createRes.status).toBe(202);
      expect(createRes.body.success).toBe(true);
      expect(createRes.body.data.exportId).toBeDefined();
      createdExportId = createRes.body.data.exportId;
    });

    it("should allow the owner to retrieve async export status by exportId", async () => {
      const res = await request(app).get(`/export/status/${createdExportId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.exportId).toBe(createdExportId);
      expect(res.body.data.status).toBe("completed");
    });

    it("should allow the owner to download async export by exportId", async () => {
      const res = await request(app).get(`/export/download/${createdExportId}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.headers["content-disposition"]).toContain(createdExportId);
      const parsed = JSON.parse(res.text);
      expect(parsed.profile.id).toBe("user-123");
    });

    it("should deny cross-user access to GET /export/status/:exportId and audit the denial", async () => {
      // Switch authenticated principal to attacker-999
      mockCurrentUser = {
        userId: "attacker-999",
        name: "attacker",
        username: "attacker",
        role: "user",
      };
      (auditLogService.log as jest.Mock).mockClear();

      const res = await request(app).get(`/export/status/${createdExportId}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Forbidden");

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "attacker-999",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          resource: `export_job/${createdExportId}`,
          metadata: expect.objectContaining({
            exportId: createdExportId,
            exportOwnerId: "user-123",
            authenticatedUserId: "attacker-999",
            reason: "cross_user_export_id_access_denied",
          }),
        })
      );
    });

    it("should deny cross-user access to GET /export/download/:exportId and audit the denial", async () => {
      // Switch authenticated principal to attacker-999
      mockCurrentUser = {
        userId: "attacker-999",
        name: "attacker",
        username: "attacker",
        role: "user",
      };
      (auditLogService.log as jest.Mock).mockClear();

      const res = await request(app).get(`/export/download/${createdExportId}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "attacker-999",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
        })
      );
    });
  });

  describe("Erasure Receipt Retrieval Path & Cross-User Access", () => {
    const ownerUserId = "user-123";
    const ownerSubjectHash = crypto.createHash("sha256").update(ownerUserId).digest("hex");

    const mockReceipt = {
      receiptId: "receipt-abc-123",
      subjectIdHash: ownerSubjectHash,
      erasedAt: new Date().toISOString(),
      stepsCompleted: ["db.user"],
      stepsFailed: [],
      cryptoErasurePerformed: true,
      dataClassesCovered: ["user_profile"],
      retentionExceptions: [],
      receiptHash: "mock-hash",
      signature: "mock-sig",
    };

    beforeEach(() => {
      (erasureReporter.getReceipt as jest.Mock).mockImplementation((id: string) => {
        if (id === "receipt-abc-123") return Promise.resolve(mockReceipt);
        return Promise.resolve(null);
      });
    });

    it("should allow the owner to retrieve their erasure receipt", async () => {
      const res = await request(app).get("/export/erasure-receipt/receipt-abc-123");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receiptId).toBe("receipt-abc-123");
    });

    it("should deny cross-user access to erasure receipt and audit the denial", async () => {
      // Attacker tries to retrieve User 123's receipt
      mockCurrentUser = {
        userId: "attacker-999",
        name: "attacker",
        username: "attacker",
        role: "user",
      };
      (auditLogService.log as jest.Mock).mockClear();

      const res = await request(app).get("/export/erasure-receipt/receipt-abc-123");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Forbidden: You do not own this erasure receipt");

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "attacker-999",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          metadata: expect.objectContaining({
            receiptId: "receipt-abc-123",
            authenticatedUserId: "attacker-999",
            reason: "cross_user_erasure_receipt_access_denied",
          }),
        })
      );
    });
  });

  describe("Boundary & Failure Cases", () => {
    it("should return 401 Unauthorized when authentication is missing", async () => {
      mockCurrentUser = null;

      const profileRes = await request(app).get("/export/profile");
      expect(profileRes.status).toBe(401);

      const asyncRes = await request(app).post("/export");
      expect(asyncRes.status).toBe(401);

      const statusRes = await request(app).get("/export/status/some-id");
      expect(statusRes.status).toBe(401);

      const downloadRes = await request(app).get("/export/download/some-id");
      expect(downloadRes.status).toBe(401);

      const receiptRes = await request(app).get("/export/erasure-receipt/some-id");
      expect(receiptRes.status).toBe(401);
    });

    it("should return 404 Not Found for non-existent export ID on status retrieval", async () => {
      const res = await request(app).get("/export/status/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Export not found");
    });

    it("should return 404 Not Found for non-existent export ID on download", async () => {
      const res = await request(app).get("/export/download/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Export not found");
    });

    it("should return 404 Not Found for non-existent erasure receipt ID", async () => {
      (erasureReporter.getReceipt as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get("/export/erasure-receipt/missing-receipt-uuid");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Receipt not found");
    });
  });
});
