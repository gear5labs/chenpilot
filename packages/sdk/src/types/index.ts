export enum ChainId {
  BITCOIN = "bitcoin",
  STELLAR = "stellar",
  STARKNET = "starknet",
}

export interface WalletBalance {
  address: string;
  symbol: string;
  amount: string;
  chainId: ChainId;
}

export interface CrossChainSwapRequest {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  amount: string;
  destinationAddress: string;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

// Recovery / Cleanup types for cross-chain flows
export enum RecoveryAction {
  RETRY_MINT = "retry_mint",
  REFUND_LOCK = "refund_lock",
  MANUAL_INTERVENTION = "manual_intervention",
}

export interface RecoveryContext {
  // Unique id for the BTC lock transaction
  lockTxId: string;
  // Lock details (addresses, script, amount, timestamps)
  lockDetails?: Record<string, unknown>;
  // Target mint tx id (if any)
  mintTxId?: string;
  // Amount and asset info
  amount: string;
  fromChain: ChainId;
  toChain: ChainId;
  destinationAddress: string;
  metadata?: Record<string, unknown>;
}

export interface RecoveryResult {
  actionTaken: RecoveryAction;
  success: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface RetryHandler {
  retryMint: (context: RecoveryContext) => Promise<RecoveryResult>;
}

export interface RefundHandler {
  refundLock: (context: RecoveryContext) => Promise<RecoveryResult>;
}

export interface RecoveryEngineOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  retryHandler?: RetryHandler;
  refundHandler?: RefundHandler;
}

// ─── Soroban execution logs ──────────────────────────────────────────────────

export type SorobanNetwork = "testnet" | "mainnet";

export interface GetExecutionLogsParams {
  /** Transaction hash returned from a Soroban contract call. */
  txHash: string;
  network: SorobanNetwork;
  /** Override the default RPC URL for the selected network. */
  rpcUrl?: string;
}

/** A single contract event emitted during transaction execution. */
export interface ExecutionLogEntry {
  /** Position of the event within the transaction result. */
  index: number;
  /** Bech32m contract address, or null for system events. */
  contractId: string | null;
  /** "contract" | "system" | "diagnostic" */
  type: string;
  /** Decoded topic values. */
  topics: unknown[];
  /** Decoded data value. */
  data: unknown;
}

/** Formatted execution log for a Soroban transaction. */
export interface ExecutionLog {
  txHash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  /** Ledger sequence number the transaction was included in, if known. */
  ledger: number | null;
  /** Unix timestamp (seconds) of ledger close, if known. */
  createdAt: number | null;
  /** Decoded return value of the contract call, if available. */
  returnValue: unknown | null;
  /** Contract events emitted during execution. */
  events: ExecutionLogEntry[];
  /** Human-readable error description for FAILED or NOT_FOUND transactions. */
  errorMessage: string | null;
}

// ─── Soroban event subscription types ────────────────────────────────────────

/** Configuration for subscribing to Soroban contract events. */
export interface EventSubscriptionConfig {
  /** Network to subscribe to ("testnet" | "mainnet"). */
  network: "testnet" | "mainnet";
  /** Optional RPC URL override. */
  rpcUrl?: string;
  /** Contract ID(s) to subscribe to. */
  contractIds: string[];
  /** Optional topic filter (at least one topic must match). */
  topicFilter?: string[];
  /** Polling interval in milliseconds (default: 5000). Only used in polling mode. */
  pollingIntervalMs?: number;
  /** Start from a specific ledger sequence (default: latest). */
  startLedger?: number;
}

/** A single Soroban contract event. */
export interface SorobanEvent {
  /** Transaction hash that emitted the event. */
  transactionHash: string;
  /** Contract ID that emitted the event. */
  contractId: string;
  /** Event topics (usually human-readable identifiers). */
  topics: string[];
  /** Event data (typically a serialized value). */
  data: unknown;
  /** Ledger sequence the event was included in. */
  ledger: number;
  /** Unix timestamp of ledger close. */
  createdAt: number;
}

/** Callback handler for received events. */
export type EventHandler = (event: SorobanEvent) => Promise<void> | void;

/** Callback handler for subscription errors. */
export type ErrorHandler = (error: Error) => Promise<void> | void;

/** Event subscription lifecycle. */
export interface EventSubscription {
  /** Stop the subscription and clean up resources. */
  unsubscribe(): Promise<void>;
  /** Current subscription status. */
  isActive(): boolean;
  /** Last ledger that was checked. */
  getLastLedger(): number | null;
}

// ─── Network Status types ────────────────────────────────────────────────────

/** Configuration for network status checks. */
export interface NetworkStatusConfig {
  /** Network to check ("testnet" | "mainnet"). */
  network: "testnet" | "mainnet";
  /** Optional RPC URL override. */
  rpcUrl?: string;
  /** Optional Horizon URL override. */
  horizonUrl?: string;
}

/** Network health information. */
export interface NetworkHealth {
  /** Whether the network is reachable and responding. */
  isHealthy: boolean;
  /** Response time in milliseconds. */
  responseTimeMs: number;
  /** Latest ledger sequence. */
  latestLedger: number;
  /** Error message if unhealthy. */
  error?: string;
}

/** Ledger latency information. */
export interface LedgerLatency {
  /** Current ledger sequence. */
  currentLedger: number;
  /** Time since last ledger close (seconds). */
  timeSinceLastLedgerSec: number;
  /** Average ledger close time (seconds). */
  averageLedgerTimeSec: number;
  /** Whether latency is within normal range. */
  isNormal: boolean;
}

/** Protocol version information. */
export interface ProtocolVersion {
  /** Current protocol version. */
  version: number;
  /** Core version string. */
  coreVersion: string;
  /** Network passphrase. */
  networkPassphrase: string;
}

/** Complete network status. */
export interface NetworkStatus {
  /** Network health information. */
  health: NetworkHealth;
  /** Ledger latency information. */
  latency: LedgerLatency;
  /** Protocol version information. */
  protocol: ProtocolVersion;
  /** Timestamp of the check. */
  checkedAt: number;
}
