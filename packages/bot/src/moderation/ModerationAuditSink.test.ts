import { describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonLinesAuditSink, ModerationPolicyEngine } from './index';
import type { ModerationAuditEntry, ModerationEvent } from './types';

const entry: ModerationAuditEntry = {
  action: 'MODERATION_WARN',
  platform: 'discord',
  userId: 'user-1',
  ruleId: 'test-rule',
  decision: 'warn',
  strikes: 1,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const event: ModerationEvent = {
  platform: 'discord',
  userId: 'user-1',
  content: 'violation',
  timestamp: 1,
};

describe('moderation audit sinks', () => {
  it('persists JSONL records so a new sink instance can append after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chenpilot-audit-'));
    const filePath = join(directory, 'moderation', 'audit.jsonl');
    try {
      await new JsonLinesAuditSink(filePath).record(entry);
      await new JsonLinesAuditSink(filePath).record({ ...entry, messageId: 'message-2' });

      const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual(entry);
      expect(JSON.parse(lines[1]).messageId).toBe('message-2');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the moderation decision when an audit sink fails', async () => {
    const engine = new ModerationPolicyEngine({
      rules: [{
        id: 'test-rule',
        description: 'Test violation',
        evaluate: () => ({ violation: true, reason: 'test' }),
      }],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [{ record: () => { throw new Error('sink unavailable'); } }],
    });

    await expect(engine.moderate(event)).resolves.toMatchObject({
      decision: 'warn',
      ruleId: 'test-rule',
    });
  });
});