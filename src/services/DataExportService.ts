import { randomUUID } from "crypto";
import { Repository } from "typeorm";
import { User } from "../Auth/user.entity";
import { Contact } from "../Contacts/contact.entity";
import { RefreshToken } from "../Auth/refreshToken.entity";
import AppDataSource from "../config/Datasource";
import { memoryStore } from "../Agents/memory/memory";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

export interface ExportScope {
  userId?: string;
  categories?: string[];
}

export interface ExportJob {
  id: string;
  userId: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  data?: UserProfileExport;
  error?: string;
}

export class ExportOwnershipError extends Error {
  constructor(
    message: string,
    public readonly details: {
      exportId?: string;
      requestedUserId?: string;
      authenticatedUserId: string;
    }
  ) {
    super(message);
    this.name = "ExportOwnershipError";
  }
}

export interface UserProfileExport {
  exportMetadata: {
    exportDate: string;
    exportVersion: string;
    userId: string;
  };
  profile: {
    id: string;
    name: string;
    email?: string;
    address: string;
    tokenType: string;
    role: string;
    isDeployed: boolean;
    isFunded: boolean;
    isEmailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  contacts: Array<{
    id: string;
    name: string;
    address: string;
    tokenType: string;
    createdAt: string;
    updatedAt: string;
  }>;
  conversationHistory: {
    totalEntries: number;
    entries: string[];
  };
  sessions: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    isRevoked: boolean;
    revokedReason?: string;
  }>;
  statistics: {
    totalContacts: number;
    totalSessions: number;
    totalConversationEntries: number;
    accountAge: string;
  };
}

export class DataExportService {
  private exportJobs = new Map<string, ExportJob>();

  private get userRepository(): Repository<User> {
    return AppDataSource.getRepository(User);
  }

  private get contactRepository(): Repository<Contact> {
    return AppDataSource.getRepository(Contact);
  }

  private get refreshTokenRepository(): Repository<RefreshToken> {
    return AppDataSource.getRepository(RefreshToken);
  }

  async exportUserData(
    userId: string,
    requestedScope?: ExportScope
  ): Promise<UserProfileExport> {
    if (requestedScope?.userId && requestedScope.userId !== userId) {
      logger.warn("Cross-user export scope access attempt denied", {
        authenticatedUserId: userId,
        requestedUserId: requestedScope.userId,
      });

      await auditLogService.log({
        userId,
        action: AuditAction.PERMISSION_DENIED,
        severity: AuditSeverity.WARNING,
        resource: "profile_export",
        metadata: {
          requestedUserId: requestedScope.userId,
          authenticatedUserId: userId,
          reason: "cross_user_export_scope_denied",
        },
      });

      throw new ExportOwnershipError(
        "Requested export scope must match the authenticated principal",
        {
          requestedUserId: requestedScope.userId,
          authenticatedUserId: userId,
        }
      );
    }

    logger.info("Starting user data export", { userId });

    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }

      const contacts = await this.getContactsByUserId(userId);
      const conversationHistory = this.getConversationHistory(userId);
      const sessions = await this.getUserSessions(userId);

      const accountAge = this.calculateAccountAge(user.createdAt);

      const exportData: UserProfileExport = {
        exportMetadata: {
          exportDate: new Date().toISOString(),
          exportVersion: "1.0.0",
          userId: user.id,
        },
        profile: {
          id: user.id,
          name: user.name,
          email: user.email,
          address: user.address,
          tokenType: user.tokenType,
          role: user.role,
          isDeployed: user.isDeployed,
          isFunded: user.isFunded,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        contacts: contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          address: contact.address,
          tokenType: contact.tokenType,
          createdAt: contact.createdAt.toISOString(),
          updatedAt: contact.updatedAt.toISOString(),
        })),
        conversationHistory: {
          totalEntries: conversationHistory.length,
          entries: conversationHistory,
        },
        sessions: sessions.map((session) => ({
          id: session.id,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isRevoked: session.isRevoked,
          revokedReason: session.revokedReason,
        })),
        statistics: {
          totalContacts: contacts.length,
          totalSessions: sessions.length,
          totalConversationEntries: conversationHistory.length,
          accountAge,
        },
      };

      logger.info("User data export completed successfully", {
        userId,
        contactsCount: contacts.length,
        conversationEntriesCount: conversationHistory.length,
        sessionsCount: sessions.length,
      });

      await auditLogService.log({
        userId,
        action: AuditAction.DATA_EXPORT,
        severity: AuditSeverity.INFO,
        resource: "profile_export",
        metadata: {
          exportVersion: exportData.exportMetadata.exportVersion,
          dataCategories: {
            profile: true,
            contacts: contacts.length > 0,
            conversationHistory: conversationHistory.length > 0,
            sessions: sessions.length > 0,
          },
          counts: {
            contacts: contacts.length,
            conversationEntries: conversationHistory.length,
            sessions: sessions.length,
          },
        },
      });

      return exportData;
    } catch (error) {
      logger.error("Failed to export user data", { userId, error });
      throw error;
    }
  }

  private async getContactsByUserId(userId: string): Promise<Contact[]> {
    return this.contactRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  private getConversationHistory(userId: string): string[] {
    return memoryStore.get(userId);
  }

  private async getUserSessions(userId: string): Promise<RefreshToken[]> {
    return this.refreshTokenRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  private calculateAccountAge(createdAt: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Less than 1 day";
    } else if (diffDays === 1) {
      return "1 day";
    } else if (diffDays < 30) {
      return `${diffDays} days`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return months === 1 ? "1 month" : `${months} months`;
    } else {
      const years = Math.floor(diffDays / 365);
      const remainingMonths = Math.floor((diffDays % 365) / 30);
      if (remainingMonths === 0) {
        return years === 1 ? "1 year" : `${years} years`;
      }
      return `${years} year${years > 1 ? "s" : ""} and ${remainingMonths} month${remainingMonths > 1 ? "s" : ""}`;
    }
  }

  async exportUserDataAsJSON(userId: string): Promise<string> {
    const exportData = await this.exportUserData(userId);
    return JSON.stringify(exportData, null, 2);
  }

  async exportUserDataAsBuffer(userId: string): Promise<Buffer> {
    const jsonString = await this.exportUserDataAsJSON(userId);
    return Buffer.from(jsonString, "utf-8");
  }

  async requestAsyncExport(
    userId: string,
    requestedScope?: ExportScope
  ): Promise<ExportJob> {
    if (requestedScope?.userId && requestedScope.userId !== userId) {
      logger.warn("Cross-user async export scope attempt denied", {
        authenticatedUserId: userId,
        requestedUserId: requestedScope.userId,
      });

      await auditLogService.log({
        userId,
        action: AuditAction.PERMISSION_DENIED,
        severity: AuditSeverity.WARNING,
        resource: "profile_export/async_request",
        metadata: {
          requestedUserId: requestedScope.userId,
          authenticatedUserId: userId,
          reason: "cross_user_export_scope_denied",
        },
      });

      throw new ExportOwnershipError(
        "Requested export scope must match the authenticated principal",
        {
          requestedUserId: requestedScope.userId,
          authenticatedUserId: userId,
        }
      );
    }

    const exportId = randomUUID();
    const exportData = await this.exportUserData(userId);

    const job: ExportJob = {
      id: exportId,
      userId,
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      data: exportData,
    };

    this.exportJobs.set(exportId, job);
    return job;
  }

  async getExportJob(
    exportId: string,
    principalUserId?: string
  ): Promise<ExportJob | null> {
    const job = this.exportJobs.get(exportId) || null;
    if (!job) {
      return null;
    }

    if (principalUserId && job.userId !== principalUserId) {
      logger.warn("Cross-user export ID retrieval attempt denied", {
        exportId,
        exportOwnerId: job.userId,
        authenticatedUserId: principalUserId,
      });

      await auditLogService.log({
        userId: principalUserId,
        action: AuditAction.PERMISSION_DENIED,
        severity: AuditSeverity.WARNING,
        resource: `export_job/${exportId}`,
        metadata: {
          exportId,
          exportOwnerId: job.userId,
          authenticatedUserId: principalUserId,
          reason: "cross_user_export_id_access_denied",
        },
      });

      throw new ExportOwnershipError(
        "Access denied: You do not own this export",
        {
          exportId,
          requestedUserId: job.userId,
          authenticatedUserId: principalUserId,
        }
      );
    }

    return job;
  }

  async getExportData(
    exportId: string,
    principalUserId: string
  ): Promise<UserProfileExport> {
    const job = await this.getExportJob(exportId, principalUserId);
    if (!job) {
      throw new Error("Export not found");
    }
    if (!job.data) {
      throw new Error("Export data is not ready");
    }
    return job.data;
  }

  async getExportBuffer(
    exportId: string,
    principalUserId: string
  ): Promise<Buffer> {
    const data = await this.getExportData(exportId, principalUserId);
    return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
  }

  clearUserExports(userId: string): void {
    for (const [id, job] of this.exportJobs.entries()) {
      if (job.userId === userId) {
        this.exportJobs.delete(id);
      }
    }
  }
}
