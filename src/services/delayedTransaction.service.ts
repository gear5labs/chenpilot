import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import { transactionLifecycleService } from "../transactions/TransactionLifecycle.service";
import { durableOperationService } from "../Reliability/DurableOperationService";

/**
 * Delay strategy for transaction submission
 */
export type DelayStrategy = 
  | "scheduled"
  | "fee_based"
  | "congestion_based";

/**
 * Configuration for delayed transaction submission
 */
export interface DelayedTransactionConfig {
  strategy: DelayStrategy;
  scheduledAt?: number;
  maxFee?: number;
  targetFee?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Status of a delayed transaction
 */
export type DelayedTransactionStatus = 
  | "pending"
  | "waiting_for_fee"
  | "waiting_for_congestion"
  | "submitting"
  | "submitted"
  | "failed"
  | "cancelled";

/**
 * Delayed transaction record
 */
export interface DelayedTransaction {
  id: string;
  userId: string;
  transactionXdr: string;
  config: DelayedTransactionConfig;
  status: DelayedTransactionStatus;
  createdAt: number;
  submittedAt?: number;
  txHash?: string;
  error?: string;
  retries: number;
  /** Unified lifecycle record ID */
  lifecycleId?: string;
}

/**
 * Network fee info
 */
export interface NetworkFeeInfo {
  /**
   * Current fee in stroops per operation
   */
  fee: number;
  
  /**
   * Last updated timestamp
   */
  lastUpdated: number;
  
  /**
   * Number of pending transactions in the network
   */
  pendingTxCount?: number;
}

/**
 * Service for managing delayed transaction submission
 * Service for managing delayed transaction submission using Durable Operations
 */
export class DelayedTransactionService {
  private server: StellarSdk.Horizon.Server;
  private readonly DEFAULT_MAX_FEE = 100000;
  private readonly DEFAULT_TARGET_FEE = 5000;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    
    // Register handler for delayed transactions
    durableOperationService.registerHandler("delayed_transaction", async (payload) => {
      return this.executeTransaction(payload.transactionXdr);
    });
  }

  /**
   * Initialize the delayed transaction service
   */
  async initialize(): Promise<void> {
    logger.info("Delayed transaction service initialized with durable framework");
  }

  /**
   * Create a delayed transaction
   */
  async createDelayedTransaction(
    userId: string,
    transactionXdr: string,
    config: DelayedTransactionConfig
  ): Promise<any> {
    this.validateConfig(config);

    try {
      StellarSdk.Transaction.fromXDR(transactionXdr, StellarSdk.Networks.TESTNET);
    } catch (error) {
      throw new Error(`Invalid transaction XDR: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    const delayedTx: DelayedTransaction = {
      id: this.generateId(),
      userId,
      transactionXdr,
      config,
      status: "pending",
      createdAt: Date.now(),
      retries: 0,
    };

    // Create unified lifecycle record at intent state
    try {
      const lifecycle = await transactionLifecycleService.create(
        userId,
        "delayed_job",
        { strategy: config.strategy, scheduledAt: config.scheduledAt },
        delayedTx.id
      );
      delayedTx.lifecycleId = lifecycle.id;
    } catch (err) {
      logger.warn("Failed to create lifecycle record for delayed transaction", { id: delayedTx.id, err });
    }

    // Set initial status based on strategy
    if (config.strategy === "scheduled" && config.scheduledAt) {
      if (config.scheduledAt <= Date.now()) {
        delayedTx.status = "submitting";
      } else {
        delayedTx.status = "pending";
      }
    } else if (config.strategy === "fee_based") {
      delayedTx.status = "waiting_for_fee";
    } else if (config.strategy === "congestion_based") {
      delayedTx.status = "waiting_for_congestion";
    }

    // Advance lifecycle to match initial status
    if (delayedTx.lifecycleId) {
      try {
        if (delayedTx.status === "submitting") {
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "pending");
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "submitting");
        } else if (delayedTx.status === "waiting_for_fee" || delayedTx.status === "waiting_for_congestion") {
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "pending");
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "waiting");
        } else {
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "pending");
        }
      } catch (err) {
        logger.warn("Failed to advance lifecycle for delayed transaction", { id: delayedTx.id, err });
      }
    }

    this.pendingDelayedTxs.set(delayedTx.id, delayedTx);
    
    logger.info(`Created delayed transaction ${delayedTx.id} with strategy ${config.strategy}`);
    
    // If already ready to submit, try immediately
    if (delayedTx.status === "submitting") {
      this.submitTransaction(delayedTx.id);
    }
    return durableOperationService.execute({
      category: "delayed_transaction",
      payload: { userId, transactionXdr },
      scheduledAt: config.strategy === "scheduled" ? new Date(config.scheduledAt!) : undefined,
      conditions: config.strategy !== "scheduled" ? config : undefined,
      maxRetries: config.maxRetries,
    });
  }

  private async executeTransaction(xdr: string): Promise<any> {
    const tx = StellarSdk.Transaction.fromXDR(xdr, StellarSdk.Networks.TESTNET);
    const result = await this.server.submitTransaction(tx);
    return {
      hash: result.hash,
      ledger: result.ledger,
      envelopeXdr: result.envelope_xdr,
    };
  }

  private validateConfig(config: DelayedTransactionConfig): void {
    if (!config.strategy) {
      throw new Error("Delay strategy is required");
    }

    if (config.strategy === "scheduled") {
      if (!config.scheduledAt) throw new Error("scheduledAt is required for 'scheduled' strategy");
      if (config.scheduledAt < Date.now()) throw new Error("scheduledAt must be in the future");
    }
  }
}

export const delayedTransactionService = new DelayedTransactionService();


  /**
   * Check if network congestion is acceptable
   */
  private async isNetworkCongestionAcceptable(): Promise<boolean> {
    // Simple congestion check - can be enhanced with more sophisticated logic
    const feeInfo = await this.getCurrentFee();
    
    // Consider network uncongested if fee is below 10000 stroops (0.001 XLM)
    return feeInfo.fee <= 10000;
  }

  /**
   * Get current network fee
   */
  private async getCurrentFee(): Promise<NetworkFeeInfo> {
    // Check cache
    if (this.lastFeeInfo && Date.now() - this.lastFeeInfo.lastUpdated < this.FEE_CACHE_TTL) {
      return this.lastFeeInfo;
    }

    try {
      // Get latest fee from Horizon
      const response = await this.server.feeStats().call();
      
      this.lastFeeInfo = {
        fee: response.fee_charged.max_fee || 100,
        lastUpdated: Date.now(),
        pendingTxCount: response.operations_in_queue_total || 0,
      };
      
      return this.lastFeeInfo;
    } catch (error) {
      logger.error("Error fetching fee stats:", error);
      
      // Return default fee if unable to fetch
      return {
        fee: 100,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Submit a delayed transaction
   */
  private async submitTransaction(id: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const delayedTx = this.pendingDelayedTxs.get(id);
    if (!delayedTx) {
      return { success: false, error: "Transaction not found" };
    }

    delayedTx.status = "submitting";

    // Advance lifecycle to submitting if not already there
    if (delayedTx.lifecycleId) {
      try {
        const record = await transactionLifecycleService.findById(delayedTx.lifecycleId);
        if (record && record.state !== "submitting" && record.state !== "submitted" && record.state !== "confirmed" && record.state !== "failed" && record.state !== "cancelled") {
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "submitting");
        }
      } catch (err) {
        logger.warn("Failed to advance lifecycle to submitting", { id, err });
      }
    }
    
    try {
      const networkPassphrase = config.stellar.networkPassphrase;
      const tx = StellarSdk.Transaction.fromXDR(delayedTx.transactionXdr, networkPassphrase);
      
      const response = await this.server.submitTransaction(tx);
      
      delayedTx.status = "submitted";
      delayedTx.submittedAt = Date.now();
      delayedTx.txHash = response.hash;

      if (delayedTx.lifecycleId) {
        try {
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "submitted", {
            correlationId: response.hash,
            metadata: { txHash: response.hash },
          });
          await transactionLifecycleService.transition(delayedTx.lifecycleId, "confirmed");
        } catch (err) {
          logger.warn("Failed to advance lifecycle to confirmed", { id, err });
        }
      }
      
      logger.info(`Successfully submitted delayed transaction ${id}: ${response.hash}`);
      
      return { success: true, txHash: response.hash };
    } catch (error) {
      delayedTx.retries++;
      const maxRetries = delayedTx.config.maxRetries || 3;
      
      if (delayedTx.retries >= maxRetries) {
        delayedTx.status = "failed";
        delayedTx.error = error instanceof Error ? error.message : "Unknown error";
        if (delayedTx.lifecycleId) {
          try {
            await transactionLifecycleService.fail(delayedTx.lifecycleId, delayedTx.error);
          } catch (err) {
            logger.warn("Failed to advance lifecycle to failed", { id, err });
          }
        }
        logger.error(`Delayed transaction ${id} failed after ${maxRetries} retries`);
      } else {
        if (delayedTx.config.strategy === "fee_based") {
          delayedTx.status = "waiting_for_fee";
        } else if (delayedTx.config.strategy === "congestion_based") {
          delayedTx.status = "waiting_for_congestion";
        } else {
          delayedTx.status = "pending";
        }
        logger.warn(`Delayed transaction ${id} failed, retry ${delayedTx.retries}/${maxRetries}`);
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  /**
   * Cancel a delayed transaction
   */
  cancelTransaction(id: string, userId: string): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);
    
    if (!delayedTx) {
      return false;
    }

    if (delayedTx.userId !== userId) {
      return false;
    }

    if (delayedTx.status === "submitted") {
      return false;
    }

    delayedTx.status = "cancelled";

    if (delayedTx.lifecycleId) {
      transactionLifecycleService.cancel(delayedTx.lifecycleId, "Cancelled by user").catch((err) => {
        logger.warn("Failed to cancel lifecycle for delayed transaction", { id, err });
      });
    }

    logger.info(`Cancelled delayed transaction ${id}`);
    
    return true;
  }

  /**
   * Get a delayed transaction by ID
   */
  getTransaction(id: string): DelayedTransaction | undefined {
    return this.pendingDelayedTxs.get(id);
  }

  /**
   * Get all pending delayed transactions for a user
   */
  getUserTransactions(userId: string): DelayedTransaction[] {
    return Array.from(this.pendingDelayedTxs.values()).filter(
      (tx) => tx.userId === userId && tx.status !== "submitted" && tx.status !== "failed" && tx.status !== "cancelled"
    );
  }

  /**
   * Update a scheduled transaction time
   */
  rescheduleTransaction(id: string, userId: string, newScheduledAt: number): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);
    
    if (!delayedTx) {
      return false;
    }

    if (delayedTx.userId !== userId) {
      return false;
    }

    if (delayedTx.config.strategy !== "scheduled") {
      return false;
    }

    if (newScheduledAt < Date.now()) {
      return false;
    }

    delayedTx.config.scheduledAt = newScheduledAt;
    delayedTx.status = "pending";
    
    logger.info(`Rescheduled delayed transaction ${id} to ${new Date(newScheduledAt).toISOString()}`);
    
    return true;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `delayed_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopChecking();
    this.pendingDelayedTxs.clear();
  }
}

// Export singleton instance
export const delayedTransactionService = new DelayedTransactionService();
