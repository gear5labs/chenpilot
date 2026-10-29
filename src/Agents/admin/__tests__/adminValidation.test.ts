/**
 * Tests for admin route request body schema validation (#1011)
 */

import { z } from 'zod';
import {
  validateRequestBody,
  updatePolicySchema,
  initiateWorkflowSchema,
  workflowDecisionSchema,
  updateStepPayloadSchema,
  promptUpdateSchema,
  promptCreateSchema,
  toolEnableSchema,
  experimentCreateSchema,
  simulationRunSchema,
} from '../adminValidation';

describe('Admin Route Request Body Validation', () => {
  describe('validateRequestBody helper', () => {
    it('should validate correct data', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });
      const result = validateRequestBody(schema, { name: 'test', count: 5 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'test', count: 5 });
      }
    });

    it('should reject invalid data', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });
      const result = validateRequestBody(schema, { name: 'test', count: 'invalid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid request body');
      }
    });

    it('should reject unknown properties', () => {
      const schema = z.object({
        name: z.string(),
      });
      const result = validateRequestBody(schema, { name: 'test', unknown: 'field' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('unknown');
      }
    });
  });

  describe('updatePolicySchema', () => {
    it('should accept valid policy update', () => {
      const result = validateRequestBody(updatePolicySchema, {
        allowedIpRanges: ['192.168.1.1'],
        requireApproval: true,
        ttlMinutes: 60,
      });
      expect(result.success).toBe(true);
    });

    it('should accept partial updates', () => {
      const result = validateRequestBody(updatePolicySchema, {
        enabled: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid ip range format', () => {
      const result = validateRequestBody(updatePolicySchema, {
        allowedIpRanges: [123], // should be string
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative ttl', () => {
      const result = validateRequestBody(updatePolicySchema, {
        ttlMinutes: -10,
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(updatePolicySchema, {
        allowedIpRanges: ['192.168.1.1'],
        unknownField: 'should not be here',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('initiateWorkflowSchema', () => {
    it('should accept valid workflow initiation', () => {
      const result = validateRequestBody(initiateWorkflowSchema, {
        actionType: 'test_action',
        payload: { data: 'test' },
        metadata: { source: 'api' },
        ttlMinutes: 30,
      });
      expect(result.success).toBe(true);
    });

    it('should accept minimal required fields', () => {
      const result = validateRequestBody(initiateWorkflowSchema, {
        actionType: 'test_action',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload).toEqual({});
      }
    });

    it('should reject missing actionType', () => {
      const result = validateRequestBody(initiateWorkflowSchema, {
        payload: { data: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(initiateWorkflowSchema, {
        actionType: 'test_action',
        extraField: 'not allowed',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('workflowDecisionSchema', () => {
    it('should accept valid decision with comment', () => {
      const result = validateRequestBody(workflowDecisionSchema, {
        comment: 'Approved for testing',
      });
      expect(result.success).toBe(true);
    });

    it('should accept decision without comment', () => {
      const result = validateRequestBody(workflowDecisionSchema, {});
      expect(result.success).toBe(true);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(workflowDecisionSchema, {
        comment: 'test',
        decision: 'approved', // unknown field
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateStepPayloadSchema', () => {
    it('should accept valid step update', () => {
      const result = validateRequestBody(updateStepPayloadSchema, {
        resultOverride: { value: 'new result' },
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty update', () => {
      const result = validateRequestBody(updateStepPayloadSchema, {});
      expect(result.success).toBe(true);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(updateStepPayloadSchema, {
        resultOverride: { value: 'test' },
        unknown: 'field',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('promptUpdateSchema', () => {
    it('should accept valid prompt update', () => {
      const result = validateRequestBody(promptUpdateSchema, {
        name: 'updated-prompt',
        content: 'New content',
        version: '2.0',
        description: 'Updated description',
        parameters: { temperature: 0.7 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept partial update', () => {
      const result = validateRequestBody(promptUpdateSchema, {
        content: 'Updated content only',
      });
      expect(result.success).toBe(true);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(promptUpdateSchema, {
        content: 'test',
        id: 'should-not-be-here',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('promptCreateSchema', () => {
    it('should accept valid prompt creation', () => {
      const result = validateRequestBody(promptCreateSchema, {
        name: 'new-prompt',
        content: 'Prompt content',
        version: '1.0',
        description: 'A new prompt',
        parameters: { temperature: 0.5 },
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = validateRequestBody(promptCreateSchema, {
        name: 'test',
        // missing content and version
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(promptCreateSchema, {
        name: 'test',
        content: 'content',
        version: '1.0',
        extraField: 'not allowed',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('toolEnableSchema', () => {
    it('should accept valid tool enable', () => {
      const result = validateRequestBody(toolEnableSchema, {
        enabled: true,
        reason: 'Testing tool',
      });
      expect(result.success).toBe(true);
    });

    it('should accept tool enable without reason', () => {
      const result = validateRequestBody(toolEnableSchema, {
        enabled: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing enabled field', () => {
      const result = validateRequestBody(toolEnableSchema, {
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(toolEnableSchema, {
        enabled: true,
        unknown: 'field',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('experimentCreateSchema', () => {
    it('should accept valid experiment creation', () => {
      const result = validateRequestBody(experimentCreateSchema, {
        name: 'test-experiment',
        description: 'Testing new feature',
        config: { variants: ['A', 'B'] },
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(result.success).toBe(true);
    });

    it('should accept minimal required fields', () => {
      const result = validateRequestBody(experimentCreateSchema, {
        name: 'test-experiment',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing name', () => {
      const result = validateRequestBody(experimentCreateSchema, {
        description: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(experimentCreateSchema, {
        name: 'test',
        unknown: 'field',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('simulationRunSchema', () => {
    it('should accept valid simulation run', () => {
      const result = validateRequestBody(simulationRunSchema, {
        scenario: 'load-test',
        parameters: { concurrency: 10 },
        iterations: 1000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept minimal required fields', () => {
      const result = validateRequestBody(simulationRunSchema, {
        scenario: 'stress-test',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing scenario', () => {
      const result = validateRequestBody(simulationRunSchema, {
        iterations: 100,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative iterations', () => {
      const result = validateRequestBody(simulationRunSchema, {
        scenario: 'test',
        iterations: -10,
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown properties', () => {
      const result = validateRequestBody(simulationRunSchema, {
        scenario: 'test',
        unknown: 'field',
      });
      expect(result.success).toBe(false);
    });
  });
});
