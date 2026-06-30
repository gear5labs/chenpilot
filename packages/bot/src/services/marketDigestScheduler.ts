/**
 * Market Digest Scheduler
 *
 * A platform-agnostic scheduler that drives daily market overview digests.
 * Instead of hard-coding the posting logic inside a bot adapter, callers
 * register `DigestTarget` objects that know how to post to their own
 * channel/chat.  The scheduler owns the clock and the retry semantics.
 *
 * Usage (in index.ts):
 *
 *   const scheduler = new MarketDigestScheduler();
 *   scheduler.addTarget(discordBot.createDigestTarget());
 *   scheduler.addTarget(telegramBot.createDigestTarget());
 *   scheduler.start();
 *
 * Operator controls (env vars):
 *   MARKET_DIGEST_ENABLED        — "true" / "false" (default: "false")
 *   MARKET_DIGEST_TIME           — "HH:MM" UTC (default: "09:00")
 *   MARKET_DIGEST_RETRY_ATTEMPTS — max post retries per target (default: 3)
 *   MARKET_DIGEST_RETRY_DELAY_MS — ms between retries (default: 30000)
 */

import { MarketOverviewService, MarketOverviewData } from "../marketOverview";

// ─── Public interface ────────────────────────────────────────────────────────

/**
 * A named posting target (one Discord channel, one Telegram chat, etc.).
 * Adapters implement this to hook into the scheduler without knowing its
 * internals.
 */
export interface DigestTarget {
  /** Human-readable label used in logs (e.g. "discord:#market-updates"). */
  label: string;
  /**
   * Called by the scheduler when it is time to post.
   * Should resolve when the message has been delivered (or reject on failure).
   */
  post(data: MarketOverviewData): Promise<void>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ENABLED = process.env.MARKET_DIGEST_ENABLED === "true";
const DIGEST_TIME = process.env.MARKET_DIGEST_TIME || "09:00"; // HH:MM UTC
const MAX_RETRY_ATTEMPTS = Number(
  process.env.MARKET_DIGEST_RETRY_ATTEMPTS || "3"
);
const RETRY_DELAY_MS = Number(
  process.env.MARKET_DIGEST_RETRY_DELAY_MS || "30000"
);
/** 24 h in ms */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class MarketDigestScheduler {
  private targets: DigestTarget[] = [];
  private readonly marketService: MarketOverviewService;
  private nextTimeout?: ReturnType<typeof setTimeout>;
  private dailyInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(marketService?: MarketOverviewService) {
    this.marketService = marketService ?? new MarketOverviewService();
  }

  // ── Target registration ────────────────────────────────────────────────────

  addTarget(target: DigestTarget): this {
    this.targets.push(target);
    return this;
  }

  removeTarget(label: string): this {
    this.targets = this.targets.filter((t) => t.label !== label);
    return this;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the scheduler.  Safe to call multiple times — subsequent calls are
   * no-ops while it is already running.
   */
  start(): void {
    if (this.running) return;

    if (!ENABLED) {
      console.log("ℹ️ Market digest scheduler disabled (MARKET_DIGEST_ENABLED != true)");
      return;
    }

    if (this.targets.length === 0) {
      console.warn("⚠️ Market digest scheduler: no targets registered, skipping start");
      return;
    }

    this.running = true;
    const delayMs = this.msUntilNextSchedule();
    const nextPost = new Date(Date.now() + delayMs);

    console.log(
      `📅 Market digest scheduler started — next post at ${nextPost.toUTCString()} ` +
        `(${Math.round(delayMs / 60_000)} min), targets: ${this.targets.map((t) => t.label).join(", ")}`
    );

    // Fire at the precise daily time, then repeat every 24 h.
    this.nextTimeout = setTimeout(() => {
      void this.runAll();
      this.dailyInterval = setInterval(() => void this.runAll(), DAILY_INTERVAL_MS);
    }, delayMs);
  }

  /**
   * Stop the scheduler and clear all pending timers.
   */
  stop(): void {
    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }
    if (this.dailyInterval) {
      clearInterval(this.dailyInterval);
      this.dailyInterval = undefined;
    }
    this.running = false;
    console.log("🛑 Market digest scheduler stopped");
  }

  /**
   * Immediately trigger a digest post to all registered targets, bypassing
   * the schedule.  Useful for operator-initiated on-demand posts or testing.
   */
  async postNow(): Promise<void> {
    console.log("📊 Market digest: on-demand post requested");
    await this.runAll();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Compute milliseconds until the next occurrence of DIGEST_TIME in UTC.
   */
  private msUntilNextSchedule(): number {
    const [hours, minutes] = DIGEST_TIME.split(":").map(Number);
    const now = new Date();
    const next = new Date();
    next.setUTCHours(hours, minutes, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  /**
   * Fetch market data once and fan it out to all targets.
   */
  private async runAll(): Promise<void> {
    console.log("📊 Market digest: fetching market data …");
    let data: MarketOverviewData;

    try {
      data = await this.marketService.fetchMarketOverview();
    } catch (err) {
      console.error("❌ Market digest: failed to fetch market data", err);
      return;
    }

    await Promise.allSettled(
      this.targets.map((target) => this.postWithRetry(target, data))
    );
  }

  /**
   * Attempt to post to a single target with exponential-like retry.
   */
  private async postWithRetry(
    target: DigestTarget,
    data: MarketOverviewData
  ): Promise<void> {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        await target.post(data);
        console.log(`✅ Market digest posted to ${target.label}`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(
          `❌ Market digest post to ${target.label} failed (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}):`,
          err
        );
        if (attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    console.error(
      `❌ Market digest: gave up posting to ${target.label} after ${MAX_RETRY_ATTEMPTS} attempts`,
      lastErr
    );
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const marketDigestScheduler = new MarketDigestScheduler();

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
