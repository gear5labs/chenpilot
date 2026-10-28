/**
 * Tests for socket subscription payload validation (#1005)
 */

import {
  validateTransactionSubscription,
  validateBotAlertSubscription,
  validateSubscriptionPayload,
} from '../socketValidation';

describe('Socket Subscription Payload Validation', () => {
  describe('validateTransactionSubscription', () => {
    it('should accept valid transaction IDs', () => {
      const result = validateTransactionSubscription('tx-12345');
      expect(result.valid).toBe(true);
      expect(result.code).toBe('VALID');
    });

    it('should accept transaction IDs with underscores', () => {
      const result = validateTransactionSubscription('tx_12345_abc');
      expect(result.valid).toBe(true);
    });

    it('should accept undefined (optional)', () => {
      const result = validateTransactionSubscription(undefined);
      expect(result.valid).toBe(true);
    });

    it('should reject transaction IDs with special characters', () => {
      const result = validateTransactionSubscription('tx@12345');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD_FORMAT');
      expect(result.error).toContain('alphanumeric');
    });

    it('should reject transaction IDs with spaces', () => {
      const result = validateTransactionSubscription('tx 12345');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD_FORMAT');
    });

    it('should reject transaction IDs exceeding max length', () => {
      const longId = 't'.repeat(65);
      const result = validateTransactionSubscription(longId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('should accept transaction IDs at max length boundary', () => {
      const maxId = 't'.repeat(64);
      const result = validateTransactionSubscription(maxId);
      expect(result.valid).toBe(true);
    });

    it('should reject non-string types', () => {
      const result = validateTransactionSubscription(12345 as any);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD_FORMAT');
    });

    it('should reject null', () => {
      const result = validateTransactionSubscription(null as any);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateBotAlertSubscription', () => {
    it('should accept valid bot IDs', () => {
      const result = validateBotAlertSubscription('bot-12345');
      expect(result.valid).toBe(true);
      expect(result.code).toBe('VALID');
    });

    it('should accept bot IDs with underscores', () => {
      const result = validateBotAlertSubscription('bot_12345_abc');
      expect(result.valid).toBe(true);
    });

    it('should accept undefined (optional)', () => {
      const result = validateBotAlertSubscription(undefined);
      expect(result.valid).toBe(true);
    });

    it('should reject bot IDs with special characters', () => {
      const result = validateBotAlertSubscription('bot@12345');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD_FORMAT');
    });

    it('should reject bot IDs exceeding max length', () => {
      const longId = 'b'.repeat(65);
      const result = validateBotAlertSubscription(longId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('should accept bot IDs at max length boundary', () => {
      const maxId = 'b'.repeat(64);
      const result = validateBotAlertSubscription(maxId);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateSubscriptionPayload', () => {
    it('should route to transaction validator', () => {
      const result = validateSubscriptionPayload('transactions', 'tx-123');
      expect(result.valid).toBe(true);
    });

    it('should route to bot-alerts validator', () => {
      const result = validateSubscriptionPayload('bot-alerts', 'bot-123');
      expect(result.valid).toBe(true);
    });

    it('should reject unknown subscription types', () => {
      const result = validateSubscriptionPayload('unknown' as any, 'test');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('UNKNOWN_SUBSCRIPTION_TYPE');
    });
  });
});
