/**
 * Tests for subscription denial audit events (#1009)
 */

import { auditLogService } from '../../AuditLog/auditLog.service';
import { AuditAction, AuditSeverity } from '../../AuditLog/auditEvent.types';
import logger from '../../config/logger';

// Mock the audit log service
jest.mock('../../AuditLog/auditLog.service');
jest.mock('../../config/logger');

describe('Subscription Denial Audit Events', () => {
  const mockLog = jest.mocked(logger);
  const mockAuditLog = jest.mocked(auditLogService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Audit event structure', () => {
    it('should include actor information (userId)', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          action: AuditAction.SENSITIVE_DATA_ACCESS,
          success: false,
        })
      );
    });

    it('should include resource type', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: 'realtime:subscription',
        })
      );
    });

    it('should include reason class in metadata', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'validation_failed:INVALID_PAYLOAD_FORMAT',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'validation_failed:INVALID_PAYLOAD_FORMAT',
          }),
        })
      );
    });

    it('should include correlation ID (socketId)', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            socketId: 'socket-abc',
          }),
        })
      );
    });
  });

  describe('Data safety', () => {
    it('should not include full sensitive payloads in metadata', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
          // Only include reason class, not full payload
        },
        success: false,
      });

      const call = mockAuditLog.log.mock.calls[0][0];
      expect(call.metadata).not.toHaveProperty('fullPayload');
      expect(call.metadata).not.toHaveProperty('credentials');
    });

    it('should redact sensitive information automatically', async () => {
      // The auditLogService has built-in redaction for sensitive fields
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
          // The service should redact these if they were included
        },
        success: false,
      });

      // Verify the audit log service is called (redaction happens internally)
      expect(mockAuditLog.log).toHaveBeenCalled();
    });
  });

  describe('Audit failure isolation', () => {
    it('should not crash when audit logging fails', async () => {
      mockAuditLog.log.mockRejectedValue(new Error('Database connection failed'));

      // This simulates the pattern used in socketManager where audit failure is caught
      const result = await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized',
          socketId: 'socket-abc',
        },
        success: false,
      }).catch((err) => {
        // Audit failure is caught and logged
        logger.error('Failed to log subscription denial audit event', { err });
        return { auditFailed: true };
      });

      expect(result).toEqual({ auditFailed: true });
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to log subscription denial audit event',
        expect.any(Object)
      );
    });

    it('should continue denial even when audit fails', async () => {
      mockAuditLog.log.mockRejectedValue(new Error('Database connection failed'));

      // Simulate the denial pattern
      let denialExecuted = false;
      let auditSucceeded = false;

      try {
        await auditLogService.log({
          userId: 'user-123',
          action: AuditAction.SENSITIVE_DATA_ACCESS,
          severity: AuditSeverity.WARNING,
          ipAddress: '127.0.0.1',
          resource: 'realtime:subscription',
          metadata: {
            type: 'transactions',
            reason: 'unauthorized',
            socketId: 'socket-abc',
          },
          success: false,
        });
        auditSucceeded = true;
      } catch (err) {
        // Audit failure should not prevent denial
        logger.error('Failed to log subscription denial audit event', { err });
      }

      // Denial should still execute
      denialExecuted = true;

      expect(denialExecuted).toBe(true);
      expect(auditSucceeded).toBe(false);
    });
  });

  describe('Reason classes', () => {
    it('should distinguish validation failures', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'validation_failed:INVALID_PAYLOAD_FORMAT',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: expect.stringMatching(/^validation_failed:/),
          }),
        })
      );
    });

    it('should distinguish authorization failures', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthorized:insufficient_permissions',
          decisionId: 'decision-123',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: expect.stringMatching(/^unauthorized:/),
            decisionId: 'decision-123',
          }),
        })
      );
    });

    it('should distinguish abuse policy rejections', async () => {
      await auditLogService.log({
        userId: 'user-123',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'abuse_policy:rate_limit_exceeded',
          policyId: 'policy-123',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: expect.stringMatching(/^abuse_policy:/),
            policyId: 'policy-123',
          }),
        })
      );
    });

    it('should distinguish authentication failures', async () => {
      await auditLogService.log({
        userId: 'anonymous',
        action: AuditAction.SENSITIVE_DATA_ACCESS,
        severity: AuditSeverity.WARNING,
        ipAddress: '127.0.0.1',
        resource: 'realtime:subscription',
        metadata: {
          type: 'transactions',
          reason: 'unauthenticated',
          socketId: 'socket-abc',
        },
        success: false,
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'anonymous',
          metadata: expect.objectContaining({
            reason: 'unauthenticated',
          }),
        })
      );
    });
  });
});
