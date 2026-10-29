/**
 * Discord Notification Handler
 * Platform-specific delivery handler for Discord notifications
 */

import {
  PlatformDeliveryHandler,
  NotificationMessage,
  DeliveryResult,
  DeliveryPlatform,
  DeliveryStatus,
} from '../core.js';
import { splitNotificationContent, PLATFORM_LIMITS } from '../messageSplitter.js';

const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  total: 6000,
} as const;

const CONFIDENTIAL_LABEL = /(?:private[\s_-]?key|secret|password|passphrase|mnemonic|seed(?:[\s_-]?phrase)?|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)/i;

function redactConfidentialLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:private[\s_-]?key|secret|password|passphrase|mnemonic|seed(?:[\s_-]?phrase)?|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\s*[:=]/i.test(line))
    .join('\n');
}

function boundEmbed(embed: NonNullable<NotificationMessage['embed']>): {
  embed: NonNullable<NotificationMessage['embed']>;
  overflow: string[];
} {
  let used = 0;
  const overflow: string[] = [];
  const fit = (label: string, value: string, limit: number): string => {
    const available = Math.max(0, Math.min(limit, DISCORD_EMBED_LIMITS.total - used));
    const kept = value.slice(0, available);
    used += kept.length;
    if (kept.length < value.length) overflow.push(`${label}: ${value.slice(kept.length)}`);
    return kept;
  };

  const title = embed.title ? fit('Title', redactConfidentialLines(embed.title), DISCORD_EMBED_LIMITS.title) : undefined;
  const description = embed.description
    ? fit('Description', redactConfidentialLines(embed.description), DISCORD_EMBED_LIMITS.description)
    : undefined;
  const fields: NonNullable<NotificationMessage['embed']>['fields'] = [];

  for (const field of embed.fields ?? []) {
    const name = redactConfidentialLines(field.name);
    const value = redactConfidentialLines(field.value);
    if (CONFIDENTIAL_LABEL.test(name)) continue;

    if (fields.length >= DISCORD_EMBED_LIMITS.fields || used >= DISCORD_EMBED_LIMITS.total) {
      overflow.push(`${name}: ${value}`);
      continue;
    }

    const safeName = fit('Field name', name, DISCORD_EMBED_LIMITS.fieldName);
    const safeValue = fit(name || 'Field', value, DISCORD_EMBED_LIMITS.fieldValue);
    if (safeName && safeValue) fields.push({ name: safeName, value: safeValue, inline: field.inline });
    else if (value) overflow.push(`${name}: ${value}`);
  }

  return {
    embed: {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(embed.color !== undefined ? { color: embed.color } : {}),
      ...(fields.length ? { fields } : {}),
    },
    overflow,
  };
}

/**
 * Discord notification handler
 */
export class DiscordNotificationHandler implements PlatformDeliveryHandler {
  platform = DeliveryPlatform.DISCORD;
  private discordAdapter: any;
  private available: boolean;
  private latency: number;
  private errorCount: number;
  private totalRequests: number;

  constructor(discordAdapter: any) {
    this.discordAdapter = discordAdapter;
    this.available = !!discordAdapter;
    this.latency = 0;
    this.errorCount = 0;
    this.totalRequests = 0;
  }

  /**
   * Deliver notification to Discord
   */
  async deliver(message: NotificationMessage): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      this.totalRequests++;

      if (!this.discordAdapter) {
        throw new Error('Discord adapter not available');
      }

      const safeContent = redactConfidentialLines(message.content);
      const boundedEmbed = message.embed ? boundEmbed(message.embed) : undefined;
      const contentWithOverflow = [safeContent, ...(boundedEmbed?.overflow ?? [])]
        .filter(Boolean)
        .join('\n');
      const { chunks } = splitNotificationContent(
        { ...message, content: contentWithOverflow },
        PLATFORM_LIMITS.discord,
      );
      const send = typeof this.discordAdapter.sendNotification === 'function'
        ? (text: string, embed: unknown) => this.discordAdapter.sendNotification(message.userId, text, embed)
        : typeof this.discordAdapter.sendMessage === 'function'
          ? (text: string, embed: unknown) => this.discordAdapter.sendMessage(message.userId, text, embed)
          : null;

      if (!send) {
        throw new Error('Discord adapter does not have sendNotification method');
      }

      // Only attach the bounded embed to the first chunk; later chunks preserve overflow order.
      for (let i = 0; i < chunks.length; i++) {
        const result = await send(chunks[i], i === 0 ? boundedEmbed?.embed : undefined);
        if (result === false) throw new Error('Discord rejected notification delivery');
      }

      this.latency = Date.now() - startTime;

      return {
        success: true,
        platform: DeliveryPlatform.DISCORD,
        attempt: 1,
        duration: this.latency,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.errorCount++;
      this.latency = Date.now() - startTime;

      return {
        success: false,
        platform: DeliveryPlatform.DISCORD,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'DISCORD_DELIVERY_ERROR',
        attempt: 1,
        duration: this.latency,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check if handler is available
   */
  isAvailable(): boolean {
    return this.available && !!this.discordAdapter;
  }

  /**
   * Get handler health status
   */
  getHealth(): {
    available: boolean;
    latency?: number;
    errorRate?: number;
  } {
    const errorRate = this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0;

    return {
      available: this.available,
      latency: this.latency || undefined,
      errorRate: errorRate || undefined,
    };
  }

  /**
   * Set adapter availability
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /**
   * Reset error counters
   */
  resetErrors(): void {
    this.errorCount = 0;
    this.totalRequests = 0;
  }
}
