/**
 * Socket Subscription Payload Validation
 * Validates subscription payloads before processing to prevent malformed data from reaching business logic
 */

import { z } from 'zod';

/**
 * Maximum payload sizes for subscription payloads (in characters)
 */
const MAX_TRANSACTION_ID_LENGTH = 64;
const MAX_BOT_ID_LENGTH = 64;
const MAX_PAYLOAD_SIZE = 1024;

/**
 * Validate transaction ID format
 * Transaction IDs should be alphanumeric with optional hyphens
 */
const transactionIdSchema = z
  .string()
  .max(MAX_TRANSACTION_ID_LENGTH)
  .regex(/^[a-zA-Z0-9\-_]*$/, 'Transaction ID must be alphanumeric with optional hyphens and underscores')
  .optional();

/**
 * Validate bot ID format
 * Bot IDs should be alphanumeric with optional hyphens
 */
const botIdSchema = z
  .string()
  .max(MAX_BOT_ID_LENGTH)
  .regex(/^[a-zA-Z0-9\-_]*$/, 'Bot ID must be alphanumeric with optional hyphens and underscores')
  .optional();

/**
 * Validate subscription payload size
 */
const validatePayloadSize = (payload: unknown, maxSize: number): boolean => {
  if (typeof payload === 'string') {
    return payload.length <= maxSize;
  }
  if (typeof payload === 'object' && payload !== null) {
    return JSON.stringify(payload).length <= maxSize;
  }
  return true;
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  code: string;
}

/**
 * Validate transaction subscription payload
 */
export function validateTransactionSubscription(transactionId: unknown): ValidationResult {
  // Check payload size
  if (!validatePayloadSize(transactionId, MAX_PAYLOAD_SIZE)) {
    return {
      valid: false,
      error: 'Transaction ID exceeds maximum allowed size',
      code: 'PAYLOAD_TOO_LARGE',
    };
  }

  // Validate schema
  const result = transactionIdSchema.safeParse(transactionId);

  if (!result.success) {
    return {
      valid: false,
      error: result.error.errors[0]?.message || 'Invalid transaction ID format',
      code: 'INVALID_PAYLOAD_FORMAT',
    };
  }

  return { valid: true, code: 'VALID' };
}

/**
 * Validate bot alert subscription payload
 */
export function validateBotAlertSubscription(botId: unknown): ValidationResult {
  // Check payload size
  if (!validatePayloadSize(botId, MAX_PAYLOAD_SIZE)) {
    return {
      valid: false,
      error: 'Bot ID exceeds maximum allowed size',
      code: 'PAYLOAD_TOO_LARGE',
    };
  }

  // Validate schema
  const result = botIdSchema.safeParse(botId);

  if (!result.success) {
    return {
      valid: false,
      error: result.error.errors[0]?.message || 'Invalid bot ID format',
      code: 'INVALID_PAYLOAD_FORMAT',
    };
  }

  return { valid: true, code: 'VALID' };
}

/**
 * Generic subscription payload validator
 */
export function validateSubscriptionPayload(
  type: 'transactions' | 'bot-alerts',
  payload: unknown
): ValidationResult {
  switch (type) {
    case 'transactions':
      return validateTransactionSubscription(payload);
    case 'bot-alerts':
      return validateBotAlertSubscription(payload);
    default:
      return {
        valid: false,
        error: 'Unknown subscription type',
        code: 'UNKNOWN_SUBSCRIPTION_TYPE',
      };
  }
}
