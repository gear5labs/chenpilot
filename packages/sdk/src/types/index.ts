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
