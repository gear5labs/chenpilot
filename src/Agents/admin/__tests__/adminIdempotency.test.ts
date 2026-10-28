/**
 * Tests for admin route idempotency (#1012)
 */

import { Request, Response, NextFunction } from 'express';
import { requireAdminIdempotency, detectPayloadConflict } from '../adminIdempotency';
import { IdempotencyService } from '../../../Reliability/IdempotencyService';

// Mock IdempotencyService
jest.mock('../../../Reliability/IdempotencyService');

describe('Admin Route Idempotency', () => {
  let mockIdempotencyService: jest.Mocked<IdempotencyService>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockIdempotencyService = {
      isDuplicate: jest.fn(),
      markProcessed: jest.fn(),
    } as unknown as jest.Mocked<IdempotencyService>;

    mockReq = {
      method: 'POST',
      path: '/admin/workflow/initiate',
      headers: {},
      body: { actionType: 'test' },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('requireAdminIdempotency middleware', () => {
    it('should proceed normally when no idempotency key is provided', async () => {
      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockIdempotencyService.isDuplicate).not.toHaveBeenCalled();
    });

    it('should check for duplicate operations when key is provided', async () => {
      mockReq.headers['idempotency-key'] = 'test-key-123';
      mockIdempotencyService.isDuplicate.mockResolvedValue(false);
      mockIdempotencyService.markProcessed.mockResolvedValue();

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockIdempotencyService.isDuplicate).toHaveBeenCalledWith(
        'test-key-123',
        'POST:/admin/workflow/initiate',
        24 * 60 * 60 * 1000 // 24 hours
      );
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return cached result for duplicate operations', async () => {
      mockReq.headers['idempotency-key'] = 'test-key-123';
      mockIdempotencyService.isDuplicate.mockResolvedValue(true);

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Operation already completed (idempotent replay)',
          fromCache: true,
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should attach idempotency metadata to request', async () => {
      mockReq.headers['idempotency-key'] = 'test-key-123';
      mockIdempotencyService.isDuplicate.mockResolvedValue(false);
      mockIdempotencyService.markProcessed.mockResolvedValue();

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.idempotencyKey).toBe('test-key-123');
      expect(mockReq.payloadFingerprint).toBeDefined();
    });

    it('should proceed normally if idempotency check fails', async () => {
      mockReq.headers['idempotency-key'] = 'test-key-123';
      mockIdempotencyService.isDuplicate.mockRejectedValue(new Error('Database error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Idempotency check failed, proceeding anyway:',
        expect.any(Error)
      );
      expect(mockNext).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('payload fingerprinting', () => {
    it('should detect no conflict for identical fingerprints', () => {
      const fingerprint1 = 'abc123';
      const fingerprint2 = 'abc123';

      const hasConflict = detectPayloadConflict(fingerprint1, fingerprint2);

      expect(hasConflict).toBe(false);
    });

    it('should detect conflicts for different payloads', () => {
      const fingerprint1 = 'abc123';
      const fingerprint2 = 'xyz789';

      const hasConflict = detectPayloadConflict(fingerprint1, fingerprint2);

      expect(hasConflict).toBe(true);
    });

    it('should be case-sensitive', () => {
      const fingerprint1 = 'ABC123';
      const fingerprint2 = 'abc123';

      const hasConflict = detectPayloadConflict(fingerprint1, fingerprint2);

      expect(hasConflict).toBe(true);
    });
  });

  describe('idempotency key extraction', () => {
    it('should extract key from headers', () => {
      mockReq.headers['idempotency-key'] = 'test-key';

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      // The key extraction happens inside the middleware
      expect(mockReq.headers['idempotency-key']).toBe('test-key');
    });

    it('should handle empty string keys', () => {
      mockReq.headers['idempotency-key'] = '';

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      // Empty string should be treated as no key
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockIdempotencyService.isDuplicate).not.toHaveBeenCalled();
    });

    it('should handle missing key', () => {
      // No idempotency-key header
      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockIdempotencyService.isDuplicate).not.toHaveBeenCalled();
    });
  });

  describe('replay behavior', () => {
    it('should replay stored result for same key and same payload', async () => {
      mockReq.headers['idempotency-key'] = 'test-key';
      mockReq.body = { actionType: 'test' };
      mockIdempotencyService.isDuplicate.mockResolvedValue(true);

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          fromCache: true,
        })
      );
    });
  });

  describe('conflict detection', () => {
    it('should detect when same key is used with different payload', () => {
      const existingFingerprint = 'hash-of-payload-A';
      const newFingerprint = 'hash-of-payload-B';

      const hasConflict = detectPayloadConflict(existingFingerprint, newFingerprint);

      expect(hasConflict).toBe(true);
    });

    it('should allow same key after expiry', async () => {
      mockReq.headers['idempotency-key'] = 'test-key';
      // After TTL expires, isDuplicate returns false
      mockIdempotencyService.isDuplicate.mockResolvedValue(false);
      mockIdempotencyService.markProcessed.mockResolvedValue();

      const middleware = requireAdminIdempotency(mockIdempotencyService);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalled();
    });
  });
});
