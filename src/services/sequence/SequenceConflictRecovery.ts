import * as StellarSdk from "@stellar/stellar-sdk";
import {
  SequenceLeaseService,
  LeaseConsumeError,
  LeaseValidationError,
  LeaseAcquisitionError,
} from "./SequenceLease.service";
import logger from "../../config/logger";

export type RecoveryOutcome =
  | { status: "RECOVERED"; newSequence: number; newFencingToken: number }
  | { status: "EXHAUSTED"; reason: string; lastError?: Error }
  | { status: "NOT_RECOVERABLE"; reason: string };

export interface SequenceConflictRecoveryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  maxTotalTimeMs?: number;
  refreshOnChainSequence?: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 500;
export const DEFAULT_MAX_TOTAL_TIME_MS = 10_000;

export class SequenceConflictRecovery {
  private readonly leaseService: SequenceLeaseService;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxTotalTimeMs: number;
  private readonly refreshOnChainSequence: boolean;

  constructor(
    leaseService: SequenceLeaseService,
    options: SequenceConflictRecoveryOptions = {},
  ) {
    this.leaseService = leaseService;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxTotalTimeMs = options.maxTotalTimeMs ?? DEFAULT_MAX_TOTAL_TIME_MS;
    this.refreshOnChainSequence = options.refreshOnChainSequence ?? true;
  }

  async recover(
    accountPublicKey: string,
    ownerId: string,
    horizonServer?: StellarSdk.Horizon.Server,
    ttlMs: number = 60_000,
  ): Promise<RecoveryOutcome> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.maxTotalTimeMs) {
        logger.warn("Sequence conflict recovery exhausted total time budget", {
          accountPublicKey,
          attempt,
          elapsedMs: elapsed,
          maxTotalTimeMs: this.maxTotalTimeMs,
        });
        return {
          status: "EXHAUSTED",
          reason: `Recovery exceeded total time budget of ${this.maxTotalTimeMs}ms`,
          lastError,
        };
      }

      logger.info("Sequence conflict recovery attempt", {
        accountPublicKey,
        attempt,
        maxAttempts: this.maxAttempts,
        elapsedMs: elapsed,
      });

      try {
        if (this.refreshOnChainSequence && horizonServer) {
          try {
            const account = await horizonServer.loadAccount(accountPublicKey);
            const onChainSeq = Number(account.sequenceNumber());
            logger.info("Refreshed on-chain sequence during recovery", {
              accountPublicKey,
              onChainSequence: onChainSeq,
            });
          } catch (err) {
            logger.warn("Failed to refresh on-chain sequence during recovery", {
              accountPublicKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const result = await this.leaseService.acquireLease(
          accountPublicKey,
          ownerId,
          ttlMs,
          horizonServer,
        );

        await this.leaseService.validateLease(result.lease.id, result.fencingToken);

        logger.info("Sequence conflict recovery succeeded", {
          accountPublicKey,
          attempt,
          newSequence: result.sequenceNumber,
          newFencingToken: result.fencingToken,
          leaseId: result.lease.id,
        });

        return {
          status: "RECOVERED",
          newSequence: result.sequenceNumber,
          newFencingToken: result.fencingToken,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        logger.warn("Sequence conflict recovery attempt failed", {
          accountPublicKey,
          attempt,
          error: lastError.message,
        });

        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryDelayMs);
        }
      }
    }

    return {
      status: "EXHAUSTED",
      reason: `Recovery exhausted after ${this.maxAttempts} attempts`,
      lastError,
    };
  }

  static classifyError(error: unknown): {
    isSequenceConflict: boolean;
    isSupersededLease: boolean;
    isExpiredLease: boolean;
    isNotFound: boolean;
  } {
    if (!(error instanceof Error)) {
      return {
        isSequenceConflict: false,
        isSupersededLease: false,
        isExpiredLease: false,
        isNotFound: false,
      };
    }

    const message = error.message.toLowerCase();
    const isSupersededLease =
      error instanceof LeaseConsumeError &&
      error.reason === "superseded";
    const isExpiredLease =
      error instanceof LeaseConsumeError &&
      error.reason === "expired";
    const isNotFound =
      error instanceof LeaseConsumeError &&
      error.reason === "not_found";

    const isSequenceConflict =
      isSupersededLease ||
      isExpiredLease ||
      isNotFound ||
      message.includes("tx_bad_seq") ||
      message.includes("bad_sequence") ||
      message.includes("sequence") ||
      message.includes("superseded") ||
      message.includes("expired");

    return {
      isSequenceConflict,
      isSupersededLease,
      isExpiredLease,
      isNotFound,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const sequenceConflictRecovery = new SequenceConflictRecovery(
  new SequenceLeaseService(),
);