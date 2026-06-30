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

// ─── CoreVault contract event types ─────────────────────────────────────────
//
// Canonical event shape emitted by core_vault:
//   topics[0] = contract abbreviation  ("vault")
//   topics[1] = action                  ("init" | "upg_prop" | "upg_cncl" | "upg_done" | "adm_xfer" | "deposit" | "force_exit_req" | "force_exit_done" | "backend_status")
//   data      = named struct with version, ledger, actor, and action-specific fields
//
// Replaying these events in ledger order fully reconstructs contract state.

export type VaultEventTopic =
  | "init"
  | "upg_prop"
  | "upg_cncl"
  | "upg_done"
  | "adm_xfer"
  | "deposit"
  | "force_exit_req"
  | "force_exit_done"
  | "backend_status";

export interface VaultEventBase {
  topic: VaultEventTopic;
  contractId: string;
  version: number;
  ledger: number;
  actor: string;
}

export interface VaultEventInit extends VaultEventBase {
  topic: "init";
  admin: string;
  vaultToken: string;
  txHash: string;
}

export interface VaultEventUpgradeProposed extends VaultEventBase {
  topic: "upg_prop";
  admin: string;
  newWasmHash: string;
  unlockLedger: number;
  txHash: string;
}

export interface VaultEventUpgradeCancelled extends VaultEventBase {
  topic: "upg_cncl";
  admin: string;
  txHash: string;
}

export interface VaultEventUpgradeApplied extends VaultEventBase {
  topic: "upg_done";
  newWasmHash: string;
  txHash: string;
}

export interface VaultEventAdminTransferred extends VaultEventBase {
  topic: "adm_xfer";
  oldAdmin: string;
  newAdmin: string;
  txHash: string;
}

export interface VaultEventDeposit extends VaultEventBase {
  topic: "deposit";
  user: string;
  amount: number;
  txHash: string;
}

export interface VaultEventForceExitReq extends VaultEventBase {
  topic: "force_exit_req";
  user: string;
  amount: number;
  eligibleAt: number;
  txHash: string;
}

export interface VaultEventForceExitDone extends VaultEventBase {
  topic: "force_exit_done";
  user: string;
  amount: number;
  txHash: string;
}

export interface VaultEventBackendStatus extends VaultEventBase {
  topic: "backend_status";
  online: boolean;
  txHash: string;
}

export type VaultEvent =
  | VaultEventInit
  | VaultEventUpgradeProposed
  | VaultEventUpgradeCancelled
  | VaultEventUpgradeApplied
  | VaultEventAdminTransferred
  | VaultEventDeposit
  | VaultEventForceExitReq
  | VaultEventForceExitDone
  | VaultEventBackendStatus;

// ─── Typed data shapes decoded from XDR ─────────────────────────────────────

interface VaultEvtInit {
  version: number;
  ledger: number;
  actor: string;
  admin: string;
  vault_token: string;
}
interface VaultEvtUpgProp {
  version: number;
  ledger: number;
  actor: string;
  new_wasm_hash: string;
  unlock_ledger: number;
}
interface VaultEvtUpgCncl {
  version: number;
  ledger: number;
  actor: string;
}
interface VaultEvtUpgDone {
  version: number;
  ledger: number;
  actor: string;
  new_wasm_hash: string;
}
interface VaultEvtAdmXfer {
  version: number;
  ledger: number;
  actor: string;
  old_admin: string;
  new_admin: string;
}
interface VaultEvtDeposit {
  version: number;
  ledger: number;
  actor: string;
  user: string;
  amount: number;
}
interface VaultEvtForceExitReq {
  version: number;
  ledger: number;
  actor: string;
  user: string;
  amount: number;
  eligible_at: number;
}
interface VaultEvtForceExitDone {
  version: number;
  ledger: number;
  actor: string;
  user: string;
  amount: number;
}
interface VaultEvtBackendStatus {
  version: number;
  ledger: number;
  actor: string;
  online: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}
function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : Boolean(v ?? false);
}

/**
 * Parse a raw SorobanEvent from core_vault into a typed VaultEvent.
 * topics[0] = "vault", topics[1] = action, topics[2] = contract_id, data = named struct.
 * Returns null for unrecognised topics.
 */
export function parseVaultEvent(event: SorobanEvent): VaultEvent | null {
  // Soroban topic layout: ["vault", "<action>", "<contract_id>"]
  const action = event.topics[1] as VaultEventTopic | undefined;
  const contractId = str(event.topics[2]);
  const { ledger, transactionHash: txHash } = event;
  const d = event.data as Record<string, unknown> | null;

  switch (action) {
    case "init": {
      const data = d as VaultEvtInit | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        admin: str(data?.admin),
        vaultToken: str(data?.vault_token),
        txHash,
      };
    }
    case "upg_prop": {
      const data = d as VaultEvtUpgProp | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        admin: str(data?.actor),
        newWasmHash: str(data?.new_wasm_hash),
        unlockLedger: num(data?.unlock_ledger),
        txHash,
      };
    }
    case "upg_cncl": {
      const data = d as VaultEvtUpgCncl | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        admin: str(data?.actor),
        txHash,
      };
    }
    case "upg_done": {
      const data = d as VaultEvtUpgDone | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        newWasmHash: str(data?.new_wasm_hash),
        txHash,
      };
    }
    case "adm_xfer": {
      const data = d as VaultEvtAdmXfer | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        oldAdmin: str(data?.old_admin),
        newAdmin: str(data?.new_admin),
        txHash,
      };
    }
    case "deposit": {
      const data = d as VaultEvtDeposit | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        user: str(data?.user),
        amount: num(data?.amount),
        txHash,
      };
    }
    case "force_exit_req": {
      const data = d as VaultEvtForceExitReq | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        user: str(data?.user),
        amount: num(data?.amount),
        eligibleAt: num(data?.eligible_at),
        txHash,
      };
    }
    case "force_exit_done": {
      const data = d as VaultEvtForceExitDone | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        user: str(data?.user),
        amount: num(data?.amount),
        txHash,
      };
    }
    case "backend_status": {
      const data = d as VaultEvtBackendStatus | null;
      return {
        topic: action,
        contractId,
        version: num(data?.version),
        ledger,
        actor: str(data?.actor),
        online: bool(data?.online),
        txHash,
      };
    }
    default:
      return null;
  }
}

// ─── State reconstruction ────────────────────────────────────────────────────

export interface VaultState {
  admin: string | null;
  pendingUpgrade: { newWasmHash: string; unlockLedger: number } | null;
  currentWasmHash: string | null;
  backendOnline: boolean | null;
  deposits: Record<string, number>;
  forceExits: Record<string, { amount: number; eligibleAt: number } | null>;
}

/**
 * Replay vault events (sorted ascending by ledger) to reconstruct contract state.
 * No ledger queries needed — the event stream is the source of truth.
 */
export function reconstructVaultState(events: VaultEvent[]): VaultState {
  const state: VaultState = {
    admin: null,
    pendingUpgrade: null,
    currentWasmHash: null,
    backendOnline: true,
    deposits: {},
    forceExits: {},
  };

  for (const e of events) {
    switch (e.topic) {
      case "init":
        state.admin = e.admin;
        break;
      case "upg_prop":
        state.pendingUpgrade = {
          newWasmHash: e.newWasmHash,
          unlockLedger: e.unlockLedger,
        };
        break;
      case "upg_cncl":
        state.pendingUpgrade = null;
        break;
      case "upg_done":
        state.currentWasmHash = e.newWasmHash;
        state.pendingUpgrade = null;
        break;
      case "adm_xfer":
        state.admin = e.newAdmin;
        break;
      case "deposit":
        state.deposits[e.user] = (state.deposits[e.user] || 0) + e.amount;
        break;
      case "force_exit_req":
        state.forceExits[e.user] = { amount: e.amount, eligibleAt: e.eligibleAt };
        break;
      case "force_exit_done":
        delete state.deposits[e.user];
        state.forceExits[e.user] = null;
        break;
      case "backend_status":
        state.backendOnline = e.online;
        break;
    }
  }

  return state;
}
