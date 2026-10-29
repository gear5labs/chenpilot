/**
 * Admin Route Request Body Validation Schemas
 * Runtime schema validation for all administrative routes
 */

import { z } from 'zod';

/**
 * Helper to validate request body and reject unknown properties
 */
export function validateRequestBody<T>(schema: z.ZodSchema<T>, body: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.strict().safeParse(body);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { success: false, error: `Invalid request body: ${errorDetails}` };
  }
  return { success: true, data: result.data };
}

/**
 * Workflow Policy Update Schema
 */
export const updatePolicySchema = z.object({
  allowedIpRanges: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
  approverRoles: z.array(z.string()).optional(),
  ttlMinutes: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

/**
 * Workflow Initiation Schema
 */
export const initiateWorkflowSchema = z.object({
  actionType: z.string(),
  payload: z.record(z.unknown()).optional().default({}),
  metadata: z.record(z.unknown()).optional(),
  ttlMinutes: z.number().int().positive().optional(),
});

/**
 * Workflow Approval/Rejection Schema
 */
export const workflowDecisionSchema = z.object({
  comment: z.string().optional(),
});

/**
 * Admin Agent Routes Schemas
 */
export const updateStepPayloadSchema = z.object({
  resultOverride: z.record(z.unknown()).optional(),
});

export const promptUpdateSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

export const promptCreateSchema = z.object({
  name: z.string(),
  content: z.string(),
  version: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

/**
 * Governance Routes Schemas
 */
export const toolEnableSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
});

/**
 * Experiment Routes Schemas
 */
export const experimentCreateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const experimentUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
});

/**
 * Simulation Routes Schemas
 */
export const simulationRunSchema = z.object({
  scenario: z.string(),
  parameters: z.record(z.unknown()).optional(),
  iterations: z.number().int().positive().optional(),
});
