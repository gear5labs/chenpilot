import { Repository } from "typeorm";
import { Request } from "express";
import AppDataSource from "../config/Datasource";
import { AuditLog, AuditAction, AuditSeverity } from "./auditLog.entity";
import logger from "../config/logger";

export interface CreateAuditLogParams {
  userId?: string;
  action: AuditAction;
  severity?: AuditSeverity;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
  success?: boolean;
}

export interface AuditLogQuery {
  userId?: string;
  action?: AuditAction;
  severity?: AuditSeverity;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export class AuditLogService {
  private auditLogRepository: Repository<AuditLog>;

  constructor() {
    this.auditLogRepository = AppDataSource.getRepository(AuditLog);
  }

  /**
   * Create an audit log entry
   */
  async log(params: CreateAuditLogParams): Promise<AuditLog> {
    try {
      const auditLog = this.auditLogRepository.create({
        userId: params.userId,
        action: params.action,
        severity: params.severity || AuditSeverity.INFO,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        resource: params.resource,
        metadata: params.metadata,
        errorMessage: params.errorMessage,
        success: params.success !== undefined ? params.success : true,
      });

      const saved = await this.auditLogRepository.save(auditLog);

      // Also log to application logger for redundancy
      logger.info("Audit log created", {
        auditLogId: saved.id,
        action: params.action,
        userId: params.userId,
        severity: params.severity,
      });

      return saved;
    } catch (error) {
      // If audit logging fails, log the error but don't throw
      logger.error("Failed to create audit log", {
        error,
        params,
      });
      throw error;
    }
  }

  /**
   * Log from Express request context
   */
  async logFromRequest(
    req: Request,
    action: AuditAction,
    options: Partial<CreateAuditLogParams> = {}
  ): Promise<AuditLog> {
    const ipAddress = this.extractIpAddress(req);
    const userAgent = req.headers["user-agent"];
    const userId = req.user?.userId;

    return this.log({
      userId,
      action,
      ipAddress,
      userAgent,
      ...options,
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(params: AuditLogQuery): Promise<{
    logs: AuditLog[];
    total: number;
  }> {
    const queryBuilder = this.auditLogRepository.createQueryBuilder("audit");

    if (params.userId) {
      queryBuilder.andWhere("audit.userId = :userId", {
        userId: params.userId,
      });
    }

    if (params.action) {
      queryBuilder.andWhere("audit.action = :action", {
        action: params.action,
      });
    }

    if (params.severity) {
      queryBuilder.andWhere("audit.severity = :severity", {
        severity: params.severity,
      });
    }

    if (params.success !== undefined) {
      queryBuilder.andWhere("audit.success = :success", {
        success: params.success,
      });
    }

    if (params.startDate) {
      queryBuilder.andWhere("audit.createdAt >= :startDate", {
        startDate: params.startDate,
      });
    }

    if (params.endDate) {
      queryBuilder.andWhere("audit.createdAt <= :endDate", {
        endDate: params.endDate,
      });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    queryBuilder.orderBy("audit.createdAt", "DESC").skip(offset).take(limit);

    const logs = await queryBuilder.getMany();

    return { logs, total };
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ logs: AuditLog[]; total: number }> {
    return this.query({ userId, limit, offset });
  }

  /**
   * Get failed authentication attempts
   */
  async getFailedAuthAttempts(
    userId?: string,
    hours = 24
  ): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const result = await this.query({
      userId,
      action: AuditAction.LOGIN_FAILED,
      startDate,
      success: false,
    });

    return result.logs;
  }

  /**
   * Get security events
   */
  async getSecurityEvents(hours = 24, limit = 100): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const queryBuilder = this.auditLogRepository
      .createQueryBuilder("audit")
      .where("audit.createdAt >= :startDate", { startDate })
      .andWhere("audit.severity IN (:...severities)", {
        severities: [AuditSeverity.WARNING, AuditSeverity.CRITICAL],
      })
      .orderBy("audit.createdAt", "DESC")
      .limit(limit);

    return queryBuilder.getMany();
  }

  /**
   * Extract IP address from request
   */
  private extractIpAddress(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.socket.remoteAddress ||
      "unknown"
    );
  }

  /**
   * Delete old audit logs (for cleanup/retention policy)
   */
  async deleteOldLogs(daysToKeep = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .where("createdAt < :cutoffDate", { cutoffDate })
      .execute();

    logger.info("Deleted old audit logs", {
      deletedCount: result.affected,
      cutoffDate,
    });

    return result.affected || 0;
  }
}

export const auditLogService = new AuditLogService();
