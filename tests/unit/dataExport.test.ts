import { DataExportService, ExportOwnershipError } from "../../src/services/DataExportService";
import { User } from "../../src/Auth/user.entity";
import { Contact } from "../../src/Contacts/contact.entity";
import { RefreshToken } from "../../src/Auth/refreshToken.entity";
import { memoryStore } from "../../src/Agents/memory/memory";
import AppDataSource from "../../src/config/Datasource";
import { auditLogService } from "../../src/AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../../src/AuditLog/auditLog.entity";

jest.mock("../../src/config/Datasource");
jest.mock("../../src/Agents/memory/memory");
jest.mock("../../src/config/logger");
jest.mock("../../src/AuditLog/auditLog.service", () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue({ id: "audit-1" }),
  },
}));

describe("DataExportService", () => {
  let dataExportService: DataExportService;
  let mockUserRepository: Record<string, unknown>;
  let mockContactRepository: Record<string, unknown>;
  let mockRefreshTokenRepository: Record<string, unknown>;

  beforeEach(() => {
    mockUserRepository = {
      findOne: jest.fn(),
    };

    mockContactRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockRefreshTokenRepository = {
      find: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === User) return mockUserRepository;
      if (entity === Contact) return mockContactRepository;
      if (entity === RefreshToken) return mockRefreshTokenRepository;
      return null;
    });

    dataExportService = new DataExportService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("exportUserData", () => {
    it("should export complete user profile data", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        email: "test@example.com",
        address: "GTEST123ADDRESS",
        tokenType: "XLM",
        role: "user",
        isDeployed: true,
        isFunded: true,
        isEmailVerified: true,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-15"),
      };

      const mockContacts: Partial<Contact>[] = [
        {
          id: "contact-1",
          name: "Alice",
          address: "GALICE123",
          tokenType: "XLM",
          createdAt: new Date("2024-01-05"),
          updatedAt: new Date("2024-01-05"),
        },
        {
          id: "contact-2",
          name: "Bob",
          address: "GBOB456",
          tokenType: "USDC",
          createdAt: new Date("2024-01-10"),
          updatedAt: new Date("2024-01-10"),
        },
      ];

      const mockSessions: Partial<RefreshToken>[] = [
        {
          id: "session-1",
          createdAt: new Date("2024-01-01"),
          expiresAt: new Date("2024-02-01"),
          isRevoked: false,
        },
        {
          id: "session-2",
          createdAt: new Date("2024-01-10"),
          expiresAt: new Date("2024-02-10"),
          isRevoked: true,
          revokedReason: "User logout",
        },
      ];

      const mockConversationHistory = [
        "User: Check my balance",
        "Agent: Your balance is 1000 XLM",
        "User: Swap 100 XLM to USDC",
      ];

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue(mockContacts);
      mockRefreshTokenRepository.find.mockResolvedValue(mockSessions);
      (memoryStore.get as jest.Mock).mockReturnValue(mockConversationHistory);

      const result = await dataExportService.exportUserData("user-123");

      expect(result).toBeDefined();
      expect(mockContactRepository.find).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        order: { createdAt: "DESC" },
      });
      expect(result.exportMetadata.userId).toBe("user-123");
      expect(result.exportMetadata.exportVersion).toBe("1.0.0");
      expect(result.profile.id).toBe("user-123");
      expect(result.profile.name).toBe("testuser");
      expect(result.profile.email).toBe("test@example.com");
      expect(result.contacts).toHaveLength(2);
      expect(result.conversationHistory.totalEntries).toBe(3);
      expect(result.sessions).toHaveLength(2);
      expect(result.statistics.totalContacts).toBe(2);
      expect(result.statistics.totalSessions).toBe(2);
      expect(result.statistics.totalConversationEntries).toBe(3);
    });

    it("should handle user with no contacts", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123");

      expect(result.contacts).toHaveLength(0);
      expect(result.statistics.totalContacts).toBe(0);
      expect(result.conversationHistory.totalEntries).toBe(0);
    });

    it("should throw error when user not found", async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        dataExportService.exportUserData("nonexistent-user")
      ).rejects.toThrow("User not found");
    });

    it("should calculate account age correctly", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        updatedAt: new Date(),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123");

      expect(result.statistics.accountAge).toContain("month");
    });

    it("should sanitize sensitive data (no private keys)", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        pk: "SECRET_PRIVATE_KEY",
        encryptedPrivateKey: "ENCRYPTED_KEY",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123");
      const jsonString = JSON.stringify(result);

      expect(jsonString).not.toContain("SECRET_PRIVATE_KEY");
      expect(jsonString).not.toContain("ENCRYPTED_KEY");
      expect(jsonString).not.toContain("pk");
      expect(jsonString).not.toContain("encryptedPrivateKey");
    });

    it("should include session revocation details", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      const mockSessions: Partial<RefreshToken>[] = [
        {
          id: "session-1",
          createdAt: new Date("2024-01-01"),
          expiresAt: new Date("2024-02-01"),
          isRevoked: true,
          revokedReason: "Security breach",
        },
      ];

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue(mockSessions);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123");

      expect(result.sessions[0].isRevoked).toBe(true);
      expect(result.sessions[0].revokedReason).toBe("Security breach");
    });
  });

  describe("exportUserDataAsJSON", () => {
    it("should return formatted JSON string", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const jsonString =
        await dataExportService.exportUserDataAsJSON("user-123");

      expect(typeof jsonString).toBe("string");
      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString);
      expect(parsed.exportMetadata).toBeDefined();
      expect(parsed.profile).toBeDefined();
      expect(parsed.contacts).toBeDefined();
    });

    it("should format JSON with proper indentation", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const jsonString =
        await dataExportService.exportUserDataAsJSON("user-123");

      expect(jsonString).toContain("\n");
      expect(jsonString).toContain("  ");
    });
  });

  describe("exportUserDataAsBuffer", () => {
    it("should return Buffer with UTF-8 encoding", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const buffer = await dataExportService.exportUserDataAsBuffer("user-123");

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);

      const jsonString = buffer.toString("utf-8");
      expect(() => JSON.parse(jsonString)).not.toThrow();
    });
  });

  describe("Data Integrity", () => {
    it("should preserve ISO date format in export", async () => {
      const testDate = new Date("2024-01-15T10:30:00Z");
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: testDate,
        updatedAt: testDate,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123");

      expect(result.profile.createdAt).toBe(testDate.toISOString());
      expect(result.profile.updatedAt).toBe(testDate.toISOString());
    });

    it("should handle large conversation history", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      const largeHistory = Array.from({ length: 1000 }, (_, i) => `Entry ${i}`);

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue(largeHistory);

      const result = await dataExportService.exportUserData("user-123");

      expect(result.conversationHistory.totalEntries).toBe(1000);
      expect(result.conversationHistory.entries).toHaveLength(1000);
    });
  });

  describe("Ownership & Scope Verification at Request Time", () => {
    it("should allow export when requested scope matches authenticated principal", async () => {
      const mockUser: Partial<User> = {
        id: "user-123",
        name: "testuser",
        address: "GTEST123",
        tokenType: "XLM",
        role: "user",
        isDeployed: false,
        isFunded: false,
        isEmailVerified: false,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);

      const result = await dataExportService.exportUserData("user-123", {
        userId: "user-123",
      });
      expect(result.profile.id).toBe("user-123");
    });

    it("should reject export with ExportOwnershipError when requested scope mismatches principal", async () => {
      await expect(
        dataExportService.exportUserData("user-123", {
          userId: "victim-user",
        })
      ).rejects.toThrow(ExportOwnershipError);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          metadata: expect.objectContaining({
            requestedUserId: "victim-user",
            authenticatedUserId: "user-123",
            reason: "cross_user_export_scope_denied",
          }),
        })
      );
    });
  });

  describe("Asynchronous Export & Cross-User Export ID Access", () => {
    const mockUserA: Partial<User> = {
      id: "user-A",
      name: "alice",
      address: "GALICE",
      tokenType: "XLM",
      role: "user",
      isDeployed: true,
      isFunded: true,
      isEmailVerified: true,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    };

    beforeEach(() => {
      mockUserRepository.findOne.mockImplementation(({ where }) => {
        if (where.id === "user-A") return Promise.resolve(mockUserA);
        return Promise.resolve(null);
      });
      mockContactRepository.find.mockResolvedValue([]);
      mockRefreshTokenRepository.find.mockResolvedValue([]);
      (memoryStore.get as jest.Mock).mockReturnValue([]);
    });

    it("should allow a user to initiate an async export and retrieve it by exportId", async () => {
      const job = await dataExportService.requestAsyncExport("user-A");
      expect(job.id).toBeDefined();
      expect(job.userId).toBe("user-A");
      expect(job.status).toBe("completed");

      const retrieved = await dataExportService.getExportJob(job.id, "user-A");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(job.id);
      expect(retrieved?.userId).toBe("user-A");

      const data = await dataExportService.getExportData(job.id, "user-A");
      expect(data.profile.id).toBe("user-A");

      const buffer = await dataExportService.getExportBuffer(job.id, "user-A");
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("should reject async export request when requested scope mismatches principal and audit denial", async () => {
      await expect(
        dataExportService.requestAsyncExport("user-A", { userId: "user-B" })
      ).rejects.toThrow(ExportOwnershipError);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-A",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          metadata: expect.objectContaining({
            requestedUserId: "user-B",
            authenticatedUserId: "user-A",
            reason: "cross_user_export_scope_denied",
          }),
        })
      );
    });

    it("should deny cross-user export ID retrieval and audit the denied request", async () => {
      const job = await dataExportService.requestAsyncExport("user-A");
      (auditLogService.log as jest.Mock).mockClear();

      // User B attempts to access User A's export ID
      await expect(
        dataExportService.getExportJob(job.id, "user-B")
      ).rejects.toThrow(ExportOwnershipError);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-B",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
          resource: `export_job/${job.id}`,
          metadata: expect.objectContaining({
            exportId: job.id,
            exportOwnerId: "user-A",
            authenticatedUserId: "user-B",
            reason: "cross_user_export_id_access_denied",
          }),
        })
      );
    });

    it("should deny cross-user data and buffer retrieval and audit the denial", async () => {
      const job = await dataExportService.requestAsyncExport("user-A");
      (auditLogService.log as jest.Mock).mockClear();

      await expect(
        dataExportService.getExportData(job.id, "user-B")
      ).rejects.toThrow(ExportOwnershipError);

      await expect(
        dataExportService.getExportBuffer(job.id, "user-B")
      ).rejects.toThrow(ExportOwnershipError);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-B",
          action: AuditAction.PERMISSION_DENIED,
          severity: AuditSeverity.WARNING,
        })
      );
    });

    it("should return null for non-existent export ID (boundary case)", async () => {
      const result = await dataExportService.getExportJob("non-existent-uuid", "user-A");
      expect(result).toBeNull();
    });

    it("should clear user exports upon request (data hygiene)", async () => {
      const job = await dataExportService.requestAsyncExport("user-A");
      expect(await dataExportService.getExportJob(job.id, "user-A")).not.toBeNull();

      dataExportService.clearUserExports("user-A");
      expect(await dataExportService.getExportJob(job.id, "user-A")).toBeNull();
    });
  });
});
