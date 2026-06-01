import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import { QueueJob } from "../jobs/job.entity";
import { jobQueueService } from "../jobs/jobQueue.service";
import { TransactionEventBridge } from "../Gateway/eventBridges";

export type DelayStrategy =
  | "scheduled"
  | "fee_based"
  | "congestion_based";

export interface DelayedTransactionConfig {
  strategy: DelayStrategy;
  scheduledAt?: number;
  maxFee?: number;
  targetFee?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export type DelayedTransactionStatus =
  | "pending"
  | "waiting_for_fee"
  | "waiting_for_congestion"
  | "submitting"
  | "submitted"
  | "failed"
  | "cancelled";

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
}

export class DelayedTransactionService {
  async initialize(): Promise<void> {
    logger.info("Delayed transaction service initialized with durable job queue");
  }

  async createDelayedTransaction(
    userId: string,
    transactionXdr: string,
    delayedConfig: DelayedTransactionConfig,
  ): Promise<DelayedTransaction> {
    this.validateConfig(delayedConfig);

    try {
      StellarSdk.Transaction.fromXDR(
        transactionXdr,
        config.stellar.networkPassphrase,
      );
    } catch (error) {
      throw new Error(
        `Invalid transaction XDR: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }

    const initialAvailableAt =
      delayedConfig.strategy === "scheduled" && delayedConfig.scheduledAt
        ? new Date(delayedConfig.scheduledAt)
        : new Date();

    const job = await jobQueueService.enqueue({
      queue: "transactions",
      jobType: "delayed_transaction.submit",
      userId,
      availableAt: initialAvailableAt,
      maxAttempts: delayedConfig.maxRetries ?? 3,
      metadata: { strategy: delayedConfig.strategy },
      payload: {
        userId,
        transactionXdr,
        config: delayedConfig,
      },
    });

    TransactionEventBridge.notifyTransactionCreated(job.id, job.id, userId);

    return this.mapJobToDelayedTransaction(job);
  }

  async cancelTransaction(id: string, userId: string): Promise<boolean> {
    const cancelled = await jobQueueService.cancelJob(id, userId);
    if (cancelled) {
      logger.info("Cancelled delayed transaction", { id, userId });
    }
    return cancelled;
  }

  async getTransaction(id: string): Promise<DelayedTransaction | undefined> {
    const job = await jobQueueService.getJob(id);
    if (!job || job.jobType !== "delayed_transaction.submit") {
      return undefined;
    }

    return this.mapJobToDelayedTransaction(job);
  }

  async getUserTransactions(userId: string): Promise<DelayedTransaction[]> {
    const jobs = await jobQueueService.getJobsForUser(
      userId,
      "delayed_transaction.submit",
    );

    return jobs
      .map((job) => this.mapJobToDelayedTransaction(job))
      .filter(
        (transaction) =>
          !["submitted", "failed", "cancelled"].includes(transaction.status),
      );
  }

  async rescheduleTransaction(
    id: string,
    userId: string,
    newScheduledAt: number,
  ): Promise<boolean> {
    if (newScheduledAt < Date.now()) {
      return false;
    }

    const job = await jobQueueService.getJob(id);
    if (!job || job.userId !== userId) {
      return false;
    }

    const payload = job.payload as {
      userId: string;
      transactionXdr: string;
      config: DelayedTransactionConfig;
    };

    if (payload.config.strategy !== "scheduled") {
      return false;
    }

    if (job.status === "completed" || job.status === "dead_letter" || job.status === "cancelled") {
      return false;
    }

    payload.config.scheduledAt = newScheduledAt;
    job.payload = payload;
    job.availableAt = new Date(newScheduledAt);
    job.status = "pending";
    job.leaseExpiresAt = null;
    job.leasedBy = null;

    await jobQueueService.saveJob(job);
    logger.info("Rescheduled delayed transaction", {
      id,
      userId,
      newScheduledAt,
    });
    return true;
  }

  destroy(): void {
    logger.info("Delayed transaction service shutdown complete");
  }

  private validateConfig(delayedConfig: DelayedTransactionConfig): void {
    if (!delayedConfig.strategy) {
      throw new Error("Delay strategy is required");
    }

    if (
      delayedConfig.strategy === "scheduled" &&
      (!delayedConfig.scheduledAt || delayedConfig.scheduledAt < Date.now())
    ) {
      throw new Error("scheduledAt must be provided in the future");
    }
  }

  private mapJobToDelayedTransaction(job: QueueJob): DelayedTransaction {
    const payload = job.payload as {
      userId: string;
      transactionXdr: string;
      config: DelayedTransactionConfig;
    };

    return {
      id: job.id,
      userId: payload.userId,
      transactionXdr: payload.transactionXdr,
      config: payload.config,
      status: this.mapStatus(job),
      createdAt: job.createdAt.getTime(),
      submittedAt: job.completedAt?.getTime(),
      txHash: job.result?.txHash as string | undefined,
      error: job.lastError ?? undefined,
      retries: job.attempts,
    };
  }

  private mapStatus(job: QueueJob): DelayedTransactionStatus {
    if (job.status === "completed") {
      return "submitted";
    }

    if (job.status === "dead_letter") {
      return "failed";
    }

    if (job.status === "cancelled") {
      return "cancelled";
    }

    if (job.status === "leased") {
      return "submitting";
    }

    const strategy = (job.payload as { config?: DelayedTransactionConfig }).config?.strategy;
    if (strategy === "fee_based") {
      return "waiting_for_fee";
    }

    if (strategy === "congestion_based") {
      return "waiting_for_congestion";
    }

    return "pending";
  }
}

export const delayedTransactionService = new DelayedTransactionService();
