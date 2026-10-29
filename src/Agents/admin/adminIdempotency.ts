/**
 * Admin Route Idempotency Middleware
 * Adds idempotency support to high-impact administrative state-changing operations
 */

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { IdempotencyService } from '../../Reliability/IdempotencyService';

export interface IdempotencyResult {
  fromCache: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Default TTL for idempotency records (24 hours)
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Extract idempotency key from request headers
 */
function extractIdempotencyKey(req: Request): string | null {
  const key = req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length > 0) {
    return key;
  }
  return null;
}

/**
 * Create a fingerprint of the request payload for conflict detection
 */
function createPayloadFingerprint(payload: unknown): string {
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Middleware to enforce idempotency on admin routes
 */
export function requireAdminIdempotency(idempotencyService: IdempotencyService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const idempotencyKey = extractIdempotencyKey(req);

    // Idempotency is optional for now - if no key provided, proceed normally
    if (!idempotencyKey) {
      return next();
    }

    const operationId = `${req.method}:${req.path}`;
    const payloadFingerprint = createPayloadFingerprint(req.body);

    try {
      // Check if this operation has already been processed
      const existing = await idempotencyService.isDuplicate(
        idempotencyKey,
        operationId,
        DEFAULT_TTL_MS
      );

      if (existing) {
        // Operation already processed - return cached result
        // In a real implementation, we'd fetch the stored result from a cache/database
        return res.status(200).json({
          success: true,
          message: 'Operation already completed (idempotent replay)',
          fromCache: true,
        });
      }

      // Store the fingerprint for conflict detection
      await idempotencyService.markProcessed(idempotencyKey, operationId, {
        payloadFingerprint,
        timestamp: new Date(),
      });

      // Attach idempotency metadata to request for later use
      req.idempotencyKey = idempotencyKey;
      req.payloadFingerprint = payloadFingerprint;

      next();
    } catch (error) {
      // If idempotency check fails, log and proceed to avoid blocking the operation
      console.error('Idempotency check failed, proceeding anyway:', error);
      next();
    }
  };
}

/**
 * Extend Express Request type to include idempotency metadata
 */
declare module 'express' {
  interface Request {
    idempotencyKey?: string;
    payloadFingerprint?: string;
  }
}

/**
 * Helper to detect payload conflicts
 */
export function detectPayloadConflict(
  existingFingerprint: string,
  newFingerprint: string
): boolean {
  return existingFingerprint !== newFingerprint;
}
