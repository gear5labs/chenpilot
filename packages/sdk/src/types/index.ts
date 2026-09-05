/** Supported blockchains for cross-chain operations */
export enum ChainId {
  BITCOIN = "bitcoin",
  STELLAR = "stellar",
  STARKNET = "starknet",
}

/** Represents a user's token balance on a specific chain */
export interface WalletBalance {
  address: string;
  symbol: string;
  amount: string;
  chainId: ChainId;
}

/** Parameters required to initiate a cross-chain swap */
export interface CrossChainSwapRequest {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  amount: string;
  destinationAddress: string;
}

/** Standard response format from the AI Agent */
export interface AgentResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

// ─── Abort handling types ────────────────────────────────────────────────────

/**
 * Structural subset of the DOM `AbortSignal` used across the SDK so callers can
 * pass either a native `AbortSignal` or a minimal compatible stub (for tests
 * and non-DOM runtimes).
 */
export interface AbortSignalLike {
  /** Whether the signal has already been aborted. */
  readonly aborted: boolean;
  /** Optional abort event wiring. Native AbortSignal implements both. */
  addEventListener?: (
    type: "abort",
    listener: () => void,
    options?: { once?: boolean }
  ) => void;
  removeEventListener?: (type: "abort", listener: () => void) => void;
  /** Optional direct handler used as a fallback when listeners are unavailable. */
  onabort?: ((...args: never[]) => void) | null;
}

/** Options accepted by every abortable SDK operation. */
export interface AbortableOperationOptions {
  /** Optional external signal to cancel the operation. */
  signal?: AbortSignalLike;
  /** Optional call-level timeout in milliseconds. */
  timeoutMs?: number;
}

// ─── Agent client request types ──────────────────────────────────────────────

/** Common options forwarded to every AgentClient operation. */
export interface RequestOptions {
  /** User id the agent operates on behalf of. */
  userId: string;
  /** Optional caller-supplied idempotency key. */
  idempotencyKey?: string;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum retry attempts. */
  maxRetries?: number;
  /** Delay between retries in milliseconds. */
  retryDelayMs?: number;
  /** Optional external signal to cancel the operation. */
  signal?: AbortSignalLike;
}

/** Simulation payload for the AI agent. */
export interface SimulationRequest {
  [key: string]: unknown;
}

/** Simulation result. */
export type SimulationResult = AgentResponse;

/** Execution payload for the AI agent. */
export interface ExecutionRequest {
  [key: string]: unknown;
}

/** Execution result. */
export type ExecutionResult = AgentResponse;

/** Vault operation payload for the AI agent. */
export interface VaultOperationRequest {
  [key: string]: unknown;
}

/** Vault operation result. */
export type VaultOperationResult = AgentResponse;

/** Recovery and cleanup actions available during cross-chain flows */
export enum RecoveryAction {
  RETRY_MINT = "retry_mint",
  REFUND_LOCK = "refund_lock",
  MANUAL_INTERVENTION = "manual_intervention",
}

/** Context information required for executing recovery actions */
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

/** Outcome of a recovery action */
export interface RecoveryResult {
  actionTaken: RecoveryAction;
  success: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

/** Interface for handling retry operations in the recovery engine */
export interface RetryHandler {
  retryMint: (context: RecoveryContext) => Promise<RecoveryResult>;
}

/** Interface for handling refund operations in the recovery engine */
export interface RefundHandler {
  refundLock: (context: RecoveryContext) => Promise<RecoveryResult>;
}

/** Configuration options for the RecoveryEngine */
export interface RecoveryEngineOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  retryHandler?: RetryHandler;
  refundHandler?: RefundHandler;
  /** Optional signal applied to cleanup/retry backoff delays by default. */
  signal?: AbortSignalLike;
}

// ─── Rate limiter types ──────────────────────────────────────────────────────

/** Configuration for the token bucket rate limiter. */
export interface RateLimiterConfig {
  /** Requests allowed per second (default: 1). */
  requestsPerSecond?: number;
  /** Maximum burst size, in requests (default: 1). */
  burstSize?: number;
  /** Enable per-endpoint rate limiting (default: false). Useful for tracking separate limits per API endpoint. */
  perEndpoint?: boolean;
}

/** Rate limit check result. */
export interface RateLimitCheckResult {
  /** Whether the request is allowed under current rate limit. */
  allowed: boolean;
  /** Milliseconds to wait before retrying if not allowed (0 if allowed). */
  retryAfterMs: number;
  /** Current available tokens in the bucket. */
  tokensAvailable: number;
}

/** Rate limiter status snapshot. */
export interface RateLimiterStatus {
  /** Total requests checked by this limiter. */
  totalChecks: number;
  /** Requests that were rate-limited. */
  limitedRequests: number;
  /** Current tokens available globally. */
  tokensAvailable: number;
  /** Per-endpoint token availability (if perEndpoint is enabled). */
  perEndpointTokens?: Record<string, number>;
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
  /** Optional external signal that stops the subscription and releases listeners. */
  signal?: AbortSignalLike;
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
  /** Optional request timeout in milliseconds. */
  timeout?: number;
  /** Optional external signal to cancel the check. */
  signal?: AbortSignalLike;
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

// ─── Stellar Metadata types ──────────────────────────────────────────────────

/** Configuration for the metadata manager */
export interface MetadataManagerConfig {
  /** Horizon URL (defaults to public network) */
  horizonUrl?: string;
  /** Network passphrase (defaults to public network) */
  networkPassphrase?: string;
  /** Base fee in stroops */
  baseFee?: number;
  /** Optional external signal applied to every network call made by this manager. */
  signal?: AbortSignalLike;
}

/** Parameters for setting metadata on an account */
export interface MetadataSetParams {
  /** Stellar account address */
  accountId: string;
  /** Metadata key (alphanumeric, underscores, hyphens; max 128 chars) */
  key: string;
  /** Metadata value (max 4KB as string) */
  value: string;
  /** Optional metadata type/category */
  type?: string;
  /** Optional expiration timestamp (unix seconds) */
  expiresAt?: number;
}

/** Parameters for retrieving metadata */
export interface MetadataGetParams {
  /** Stellar account address */
  accountId: string;
  /** Metadata key to retrieve */
  key: string;
}

/** Retrieved metadata entry */
export interface MetadataEntry {
  /** Metadata key */
  key: string;
  /** Metadata value */
  value: string;
  /** Optional metadata type/category */
  type?: string;
  /** Creation timestamp (unix seconds) */
  createdAt: number;
  /** Last update timestamp (unix seconds) */
  updatedAt: number;
  /** Optional expiration timestamp (unix seconds) */
  expiresAt?: number;
}

/** Response from listing metadata */
export interface MetadataListResponse {
  /** Stellar account address */
  accountId: string;
  /** Array of metadata entries */
  metadata: MetadataEntry[];
  /** Total metadata entries for account */
  total: number;
  /** Whether more results are available (for pagination) */
  hasMore: boolean;
}

/** Capability identifier for a contract */
export type ContractCapability = string;

/** Metadata for a specific contract version */
export interface ContractVersionMetadata {
  /** Semantic version, e.g., "1.2.3" */
  version: string;
  /** Optional description of this version */
  description?: string;
  /** Capabilities supported by this version */
  capabilities: ContractCapability[];
  /** Arbitrary compatibility metadata */
  metadata?: Record<string, unknown>;
}

/** Compatibility metadata for a contract across versions */
export interface ContractCompatibilityMetadata {
  /** Contract identifier (Stellar contract ID) */
  contractId: string;
  /** List of supported versions */
  versions: ContractVersionMetadata[];
  /** Default version to use when none specified */
  defaultVersion?: string;
}

/** Failure classification types */
export enum FailureType {
  CONNECTION = "connection",
  AUTHENTICATION = "authentication",
  HARDWARE_WALLET = "hardware_wallet",
  NETWORK = "network",
  TRANSACTION = "transaction",
  CROSS_CHAIN = "cross_chain",
  UNKNOWN = "unknown",
}

/** Structured retry guidance for the client */
export interface RetryGuidance {
  shouldRetry: boolean;
  retryAfterMs?: number;
  maxRetries: number;
  currentAttempt: number;
  backoffStrategy?: "fixed" | "exponential" | "exponential_with_jitter";
}

/** User/Operator recovery instructions */
export interface RecoveryInstructions {
  userActions: string[];
  operatorActions?: string[];
  nextSteps: string[];
}

/** Structured failure analysis result */
export interface FailureAnalysis {
  type: FailureType;
  isRecoverable: boolean;
  requiresManualIntervention: boolean;
  retryGuidance?: RetryGuidance;
  recoveryInstructions: RecoveryInstructions;
  metadata?: Record<string, unknown>;
}

/** Fee bump retry strategy for resource-limit exhaustion */
export type FeeBumpStrategy = "conservative" | "moderate" | "aggressive";

/** Soroban resource limits for a transaction invocation */
export interface ResourceLimits {
  cpuInstructions: number;
  readBytes: number;
  writeBytes: number;
  readLedgerEntries: number;
  writeLedgerEntries: number;
  txSizeByte: number;
}

/** Parsed resource exhaustion error from a Soroban RPC response */
export interface TransactionResourceError {
  resource: keyof ResourceLimits;
  required: number;
  limit: number;
  message: string;
}

/** Information passed to the onBump callback */
export interface FeeBumpAttemptInfo {
  attempt: number;
  previousLimits: ResourceLimits;
  newLimits: ResourceLimits;
  error: TransactionResourceError;
}

/** Configuration for the fee bumping engine */
export interface FeeBumpConfig {
  strategy?: FeeBumpStrategy;
  maxAttempts?: number;
  initialLimits?: ResourceLimits;
  onBump?: (info: FeeBumpAttemptInfo) => void;
  /** Optional signal that aborts the entire bump-and-retry loop. */
  signal?: AbortSignalLike;
}

/** Result of a fee bumping attempt */
export interface FeeBumpResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  finalLimits: ResourceLimits;
  attempts: Array<{
    attempt: number;
    limits: ResourceLimits;
    error?: string;
  }>;
  estimatedFee: number;
}