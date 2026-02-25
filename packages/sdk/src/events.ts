import {
  EventSubscriptionConfig,
  SorobanEvent,
  EventHandler,
  ErrorHandler,
  EventSubscription,
} from "./types";

// ─── Internal RPC types ─────────────────────────────────────────────────────

interface RpcEvent {
  type?: string;
  contractId?: string;
  topic?: unknown[];
  value?: unknown;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const DEFAULT_POLLING_INTERVAL_MS = 5000;

// ─── Event subscription implementation ──────────────────────────────────────

/**
 * High-level API for subscribing to Soroban contract events.
 *
 * Polls the Soroban RPC at regular intervals to fetch new events from
 * specified contracts and invoke handlers for matching events.
 *
 * @example
 * ```typescript
 * const subscription = subscribeToEvents({
 *   network: "testnet",
 *   contractIds: ["CABC1234..."],
 *   topicFilter: ["transfer"],
 * });
 *
 * subscription.on("event", (event) => {
 *   console.log("Transfer event:", event.topics, event.data);
 * });
 *
 * subscription.on("error", (err) => {
 *   console.error("Subscription error:", err);
 * });
 *
 * // Later...
 * await subscription.unsubscribe();
 * ```
 */
export class SorobanEventSubscription implements EventSubscription {
  private config: EventSubscriptionConfig;
  private rpcUrl: string;
  private isActive_: boolean = false;
  private lastLedger_: number | null = null;
  private pollingHandle_: NodeJS.Timeout | null = null;
  private eventHandlers: Set<EventHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private processedTransactions: Set<string> = new Set();

  constructor(config: EventSubscriptionConfig) {
    if (!config.contractIds || config.contractIds.length === 0) {
      throw new Error("At least one contractId is required");
    }

    this.config = config;
    this.rpcUrl = config.rpcUrl || DEFAULT_RPC_URLS[config.network];

    if (!this.rpcUrl) {
      throw new Error(`Unknown network: ${config.network}`);
    }
  }

  /**
   * Register a handler to be called when a matching event is received.
   */
  on(event: "event", handler: EventHandler): this;
  on(event: "error", handler: ErrorHandler): this;
  on(event: string, handler: EventHandler | ErrorHandler): this {
    if (event === "event") {
      this.eventHandlers.add(handler as EventHandler);
    } else if (event === "error") {
      this.errorHandlers.add(handler as ErrorHandler);
    }
    return this;
  }

  /**
   * Remove a handler.
   */
  off(event: "event", handler: EventHandler): this;
  off(event: "error", handler: ErrorHandler): this;
  off(event: string, handler: EventHandler | ErrorHandler): this {
    if (event === "event") {
      this.eventHandlers.delete(handler as EventHandler);
    } else if (event === "error") {
      this.errorHandlers.delete(handler as ErrorHandler);
    }
    return this;
  }

  /**
   * Start polling for events.
   */
  async subscribe(): Promise<void> {
    if (this.isActive_) {
      return; // Already subscribed
    }

    this.isActive_ = true;
    const interval =
      this.config.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

    // Run once immediately
    await this.poll();

    // Then set up polling
    this.pollingHandle_ = setInterval(() => {
      this.poll().catch((err) => this.emitError(err));
    }, interval);
  }

  /**
   * Stop polling and clean up resources.
   */
  async unsubscribe(): Promise<void> {
    if (!this.isActive_) {
      return;
    }

    this.isActive_ = false;

    if (this.pollingHandle_) {
      clearInterval(this.pollingHandle_);
      this.pollingHandle_ = null;
    }

    this.eventHandlers.clear();
    this.errorHandlers.clear();
  }

  /**
   * Get the current subscription status.
   */
  isActive(): boolean {
    return this.isActive_;
  }

  /**
   * Get the last ledger that was checked.
   */
  getLastLedger(): number | null {
    return this.lastLedger_;
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      // In a real implementation, this would call an RPC method like
      // getLedgerEvents (if available) or iterate through recent ledgers.
      // For now, we use a simulation approach.

      const events = await this.fetchRecentEvents();

      for (const event of events) {
        await this.emitEvent(event);
      }
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async fetchRecentEvents(): Promise<SorobanEvent[]> {
    // This is a placeholder. In production, you would:
    // 1. Query the RPC for recent ledgers
    // 2. Fetch transactions from those ledgers
    // 3. Filter by contract ID and extract events

    // For now, return empty to demonstrate the interface
    return [];
  }

  private async emitEvent(event: SorobanEvent): Promise<void> {
    // Avoid duplicate processing
    if (this.processedTransactions.has(event.transactionHash)) {
      return;
    }
    this.processedTransactions.add(event.transactionHash);

    // Apply topic filter if configured
    if (this.config.topicFilter && this.config.topicFilter.length > 0) {
      const hasMatchingTopic = event.topics.some((topic) =>
        this.config.topicFilter!.some((filter) => topic.includes(filter))
      );

      if (!hasMatchingTopic) {
        return;
      }
    }

    // Invoke all registered handlers
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        void handler(error);
      } catch {
        // Ignore errors in error handlers
      }
    }
  }
}

/**
 * Subscribe to Soroban contract events.
 *
 * Creates and starts an event subscription for the specified contracts.
 *
 * @param config - Subscription configuration
 * @returns Active subscription object
 *
 * @example
 * ```typescript
 * const subscription = subscribeToEvents({
 *   network: "testnet",
 *   contractIds: ["CABC1234567890"],
 *   pollingIntervalMs: 3000,
 * });
 *
 * subscription.on("event", (event) => {
 *   console.log("Event received:", event);
 * });
 *
 * await subscription.subscribe(); // Start polling
 * ```
 */
export async function subscribeToEvents(
  config: EventSubscriptionConfig
): Promise<EventSubscription> {
  const subscription = new SorobanEventSubscription(config);
  await subscription.subscribe();
  return subscription;
}

/**
 * Parse a raw RPC event into a structured SorobanEvent.
 *
 * @param raw - Raw event from RPC
 * @param contractId - Contract that emitted the event
 * @param transactionHash - Transaction hash
 * @param ledger - Ledger sequence
 * @param createdAt - Ledger close time
 * @returns Parsed event
 */
export function parseEvent(
  raw: RpcEvent,
  contractId: string,
  transactionHash: string,
  ledger: number,
  createdAt: number
): SorobanEvent {
  return {
    transactionHash,
    contractId,
    topics: Array.isArray(raw.topic)
      ? (raw.topic as unknown[]).map((t) =>
          typeof t === "string" ? t : JSON.stringify(t)
        )
      : [],
    data: raw.value ?? null,
    ledger,
    createdAt,
  };
}
