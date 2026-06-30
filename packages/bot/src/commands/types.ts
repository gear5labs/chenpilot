/**
 * Shared Bot Command Framework — Core Types
 *
 * Defines the platform-agnostic contract that every bot command must implement.
 * Adapters (Discord, Telegram) translate their native events into a
 * `CommandContext` and delegate execution to the shared registry, so business
 * logic, validation, and guards never need to be duplicated.
 *
 * Execution pipeline per command invocation:
 *
 *   1. Adapter normalises the incoming event → CommandContext
 *   2. CommandRegistry.dispatch() looks up the handler
 *   3. Framework applies guards in order (flood → rate-limit → dm-only → role)
 *   4. CommandHandler.execute() runs the shared business logic
 *   5. Metrics are recorded via CommandMetricsCollector
 *   6. Adapter sends the reply using ctx.reply()
 */

// ─── Platform ─────────────────────────────────────────────────────────────────

export type Platform = "discord" | "telegram";
export type SupportedCurrency = "USD" | "XLM" | "BTC";
export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = ["USD", "XLM", "BTC"];

// ─── Normalised command context ───────────────────────────────────────────────

/**
 * The single object every command receives instead of a raw Discord Message or
 * Telegraf Context.  Adapters are responsible for constructing this.
 */
export interface CommandContext {
  /** Canonical command name, e.g. "ping", "trustline". No prefix. */
  command: string;
  /** Positional arguments that followed the command token. */
  args: string[];
  /** Platform-normalised user ID (string on both sides). */
  userId: string;
  /** Platform the command arrived from. */
  platform: Platform;
  /** True when the message was sent in a DM / private chat. */
  isDM: boolean;
  /**
   * Send a reply to the user.  Adapters format the string for their platform
   * before sending (markdown vs HTML).
   */
  reply(text: string): Promise<void>;
  /**
   * Optional: roles the user holds — used by the role guard.
   * Absent on Telegram (Telegram has no server roles).
   */
  roles?: string[];
  /** Raw platform event for cases where platform-specific behaviour is unavoidable. */
  raw: unknown;
}

// ─── Command reply formatter ──────────────────────────────────────────────────

/**
 * Commands return a `CommandReply` instead of calling ctx.reply() directly.
 * This lets the framework and tests inspect what the command wants to say
 * without coupling it to a live platform.
 */
export interface CommandReply {
  /** Plain text / markdown content of the reply.  Adapters re-format as needed. */
  text: string;
  /**
   * When true the reply is only visible to the invoking user (Discord ephemeral,
   * Telegram can only approximate this, so it's informational).
   */
  ephemeral?: boolean;
}

// ─── Command handler ──────────────────────────────────────────────────────────

/**
 * A CommandHandler encapsulates the shared business logic for one command.
 */
export interface CommandHandler {
  /**
   * Canonical name — must match what the adapter passes in ctx.command.
   * Also used as the metric label and the slash-command name on Discord.
   */
  readonly name: string;

  /**
   * Short description shown in /help listings and slash-command registrations.
   */
  readonly description: string;

  /**
   * Which platforms this command is available on.
   * Defaults to both if absent.
   */
  readonly platforms?: Platform[];

  /** Set true to restrict this command to DMs / private chats. */
  readonly dmOnly?: boolean;

  /**
   * Minimum Discord role names required to use this command.
   * Empty / absent means no role gate.
   */
  readonly requiredRoles?: string[];

  /**
   * Use the strict (3 req/min) rate limiter instead of the default (10 req/min).
   */
  readonly strictRateLimit?: boolean;

  /**
   * Execute the command.
   * Should throw on unrecoverable errors — the framework catches and replies
   * with a generic error message.
   */
  execute(ctx: CommandContext): Promise<CommandReply>;
}

// ─── Guard result ─────────────────────────────────────────────────────────────

export interface GuardResult {
  /** Pass = true means execution continues. */
  passed: boolean;
  /** Human-readable rejection reason sent back to the user when passed = false. */
  reason?: string;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface CommandMetrics {
  command: string;
  platform: Platform;
  userId: string;
  executionTimeMs: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

// ─── Registry options ─────────────────────────────────────────────────────────

export interface CommandRegistryOptions {
  backendUrl?: string;
  debounceMs?: number;
}
