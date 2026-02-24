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
