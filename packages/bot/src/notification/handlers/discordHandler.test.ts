import { describe, expect, it, jest } from '@jest/globals';
import {
  DeliveryPlatform,
  NotificationPriority,
  NotificationType,
  type NotificationMessage,
} from '../core';
import { DiscordNotificationHandler } from './discordHandler';

function makeMessage(content: string, overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'notification-1',
    userId: 'user-1',
    type: NotificationType.ANNOUNCEMENT,
    priority: NotificationPriority.NORMAL,
    platforms: [DeliveryPlatform.DISCORD],
    content,
    createdAt: 1,
    ...overrides,
  };
}

function createHandler() {
  const sends: Array<{ content: string; embed: unknown }> = [];
  const adapter = {
    sendNotification: jest.fn(async (_userId: string, content: string, embed?: unknown) => {
      sends.push({ content, embed });
      return true;
    }),
  };
  return { handler: new DiscordNotificationHandler(adapter), sends };
}

describe('DiscordNotificationHandler', () => {
  it('accepts the exact content limit and splits the next character', async () => {
    const exact = createHandler();
    expect((await exact.handler.deliver(makeMessage('x'.repeat(2000)))).success).toBe(true);
    expect(exact.sends.map((send) => send.content)).toEqual(['x'.repeat(2000)]);

    const over = createHandler();
    expect((await over.handler.deliver(makeMessage('x'.repeat(2001)))).success).toBe(true);
    expect(over.sends.map((send) => send.content)).toEqual(['x'.repeat(2000), 'x']);
  });

  it('delivers multipart transaction details in order and attaches the embed once', async () => {
    const { handler, sends } = createHandler();
    const message = makeMessage(`Hash: tx-123\n${'x'.repeat(2100)}`, {
      type: NotificationType.TRANSACTION,
      embed: { title: 'Transaction', fields: [{ name: 'Status', value: 'Confirmed' }] },
    });

    expect((await handler.deliver(message)).success).toBe(true);
    expect(sends.map((send) => send.content)).toEqual([
      'Hash: tx-123',
      'x'.repeat(2000),
      'x'.repeat(100),
    ]);
    expect(sends[0].embed).toMatchObject({ title: 'Transaction' });
    expect(sends.slice(1).every((send) => send.embed === undefined)).toBe(true);
  });

  it('redacts confidential content and embed fields', async () => {
    const { handler, sends } = createHandler();
    await handler.deliver(makeMessage('Amount: 10 XLM\nSecret: hidden-value\nStatus: paid', {
      embed: {
        title: 'Payment',
        fields: [
          { name: 'Public status', value: 'paid' },
          { name: 'API Key', value: 'also-hidden' },
        ],
      },
    }));

    expect(sends[0].content).toBe('Amount: 10 XLM\nStatus: paid');
    expect(JSON.stringify(sends[0].embed)).not.toContain('also-hidden');
    expect(JSON.stringify(sends)).not.toContain('hidden-value');
  });

  it('keeps oversized embed overflow in message chunks and bounds the embed payload', async () => {
    const { handler, sends } = createHandler();
    const fields = Array.from({ length: 26 }, (_, index) => ({
      name: `Field ${index + 1}`,
      value: `value-${index + 1}-${'v'.repeat(1100)}`,
    }));
    await handler.deliver(makeMessage('Details', {
      embed: { description: 'd'.repeat(4100), fields },
    }));

    const embed = sends[0].embed as {
      description?: string;
      fields?: Array<{ name: string; value: string }>;
    };
    expect(embed.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.fields?.length).toBeLessThanOrEqual(25);
    expect((embed.description?.length ?? 0) + (embed.fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    )).toBeLessThanOrEqual(6000);

    const deliveredText = sends.map((send) => send.content).join('\n');
    expect(deliveredText).toContain('Field 26:');
    expect(deliveredText).toContain('value-1-');
  });
});