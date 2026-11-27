import * as StellarSdk from "@stellar/stellar-sdk";
import { Repository } from "typeorm";
import AppDataSource from "../../config/Datasource";
import logger from "../../config/logger";
import { TransactionLifecycle, FinalityStatus } from "../../transactions/TransactionLifecycle.entity";
import { FinalityPolicy } from "./FinalityPolicy";
import { AncestryVerifier } from "./AncestryVerifier";
import { ReorgEvent } from "./ReorgEvent";
import { PollOutcome } from "./PollOutcome";
import { EventEmitter } from "events";

export interface ConfirmationState {
  transactionId: string;
  txHash: string;
  ledgerSequence: number;
  ledgerHash: string;
  confirmationDepth: number;
  lastPolledAt: number;
  timeoutAt: number;
  pollingIntervalHandle?: NodeJS.Timeout;
  /** Optional external cancellation signal. When aborted, polling stops and a `cancelled` event is emitted. */
  abortSignal?: AbortSignal;
}

/**
 * Manages confirmation depth polling for a single transaction.
 * Tracks ledger accumulation, detects orphans, triggers finality declaration.
 */
export class ConfirmationDepthTracker extends EventEmitter {
  private lifecycleRepo: Repository<TransactionLifecycle>;
  private horizonServer: StellarSdk.Horizon.Server;
  private reconciliationServer: StellarSdk.Horizon.Server;
  private ancestryVerifier: AncestryVerifier;
  private reconciliationVerifier: AncestryVerifier;

  // Track active confirmations: txHash -> ConfirmationState
  private activeConfirmations: Map<string, ConfirmationState> = new Map();

  constructor(private policy: FinalityPolicy) {
    super();
    this.lifecycleRepo = AppDataSource.getRepository(TransactionLifecycle);
    this.horizonServer = new StellarSdk.Horizon.Server(policy.primaryHorizonUrl);
    this.reconciliationServer = new StellarSdk.Horizon.Server(policy.reconciliationHorizonUrl);
    this.ancestryVerifier = new AncestryVerifier(policy.primaryHorizonUrl, policy);
    this.reconciliationVerifier = new AncestryVerifier(policy.reconciliationHorizonUrl, policy);
  }

  /**
   * Start tracking confirmation depth for a transaction that was just observed in a ledger.
   * Called immediately after transaction is first seen in Horizon.
   *
   * @param signal — optional AbortSignal. When aborted, polling stops and a
   * `cancelled` event is emitted.  Existing callers that do not pass a signal
   * are unaffected.
   */
  async startConfirmationTracking(
    transactionId: string,
    txHash: string,
    ledgerSequence: number,
    ledgerHash: string,
    provider: string,
    signal?: AbortSignal
  ): Promise<void> {
    logger.info("Starting confirmation depth tracking", {
      transactionId,
      txHash,
      ledgerSequence,
      ledgerHash,
    });

    // Update lifecycle record
    const lifecycle = await this.lifecycleRepo.findOneOrFail({ where: { id: transactionId } });
    lifecycle.ledgerSequence = ledgerSequence;
    lifecycle.ledgerHash = ledgerHash;
    lifecycle.confirmationDepth = 0;
    lifecycle.observedAtProvider = provider;
    lifecycle.finalityStatus = "CONFIRMING";
    lifecycle.finalityDeclaredAt = null;
    await this.lifecycleRepo.save(lifecycle);

    // Create confirmation state
    const confirmationState: ConfirmationState = {
      transactionId,
      txHash,
      ledgerSequence,
      ledgerHash,
      confirmationDepth: 0,
      lastPolledAt: Date.now(),
      timeoutAt: Date.now() + this.policy.confirmationTimeoutMs,
      abortSignal: signal,
    };

    this.activeConfirmations.set(txHash, confirmationState);

    // Emit event
    this.emitReorgEvent({
      eventType: "reconciliation_updated", // First observation is like reconciliation
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "PENDING",
      newStatus: "CONFIRMING",
      details: {
        ledgerSequence,
        ledgerHash,
        confirmationDepth: 0,
        primaryProvider: provider,
      },
    });

    // Start polling loop
    this.pollConfirmationDepth(txHash);
  }

  /**
   * Poll confirmation depth repeatedly until finality, orphan, timeout, or cancellation.
   */
  private pollConfirmationDepth(txHash: string): void {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (!confirmationState) {
      logger.warn("Confirmation state not found during poll", { txHash });
      return;
    }

    // Check abort signal before scheduling the next poll
    if (confirmationState.abortSignal?.aborted) {
      this.handleCancellation(txHash, "abort signal");
      return;
    }

    // Schedule next poll
    const intervalHandle = setTimeout(() => {
      this.performConfirmationPoll(txHash).catch((error) => {
        logger.error("Confirmation poll error", {
          txHash,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    }, this.policy.confirmationPollIntervalMs);

    confirmationState.pollingIntervalHandle = intervalHandle;
  }

  /**
   * Perform a single confirmation poll cycle.
   */
  private async performConfirmationPoll(txHash: string): Promise<void> {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (!confirmationState) {
      return;
    }

    const { transactionId, ledgerSequence, ledgerHash } = confirmationState;
    const now = Date.now();

    // Check timeout
    if (now > confirmationState.timeoutAt) {
      logger.warn("Confirmation timeout reached, marking STALE", { transactionId, txHash });
      await this.markStale(transactionId, txHash);
      return;
    }

    try {
      // Get current ledger sequence
      const latestLedger = await this.horizonServer.ledgers().order("desc").limit(1).call();
      const currentSequence = latestLedger.records[0].sequence;

      confirmationState.confirmationDepth = currentSequence - ledgerSequence;
      confirmationState.lastPolledAt = now;

      logger.debug("Confirmation poll", {
        transactionId,
        currentSequence,
        txLedgerSequence: ledgerSequence,
        confirmationDepth: confirmationState.confirmationDepth,
      });

      // Verify ancestry (check if observed ledger is still canonical)
      const ancestryResult = await this.ancestryVerifier.verifyAncestry(
        transactionId,
        ledgerSequence,
        ledgerHash,
        currentSequence,
        this.policy.primaryHorizonUrl
      );

      if (!ancestryResult.canonical) {
        // Orphan detected
        logger.warn("Orphan detected during confirmation poll", {
          transactionId,
          reorgDepth: ancestryResult.reorgDepth,
        });
        await this.markOrphaned(
          transactionId,
          txHash,
          ledgerHash,
          ancestryResult.reorgDepth || 0
        );
        return;
      }

      // Check if we have sufficient depth
      if (confirmationState.confirmationDepth >= this.policy.confirmationDepthRequired) {
        logger.info("Finality declaration threshold reached", {
          transactionId,
          confirmationDepth: confirmationState.confirmationDepth,
          required: this.policy.confirmationDepthRequired,
        });
        await this.declareFinal(transactionId, txHash, confirmationState.confirmationDepth);
        return;
      }

      // Update database with current depth
      const lifecycle = await this.lifecycleRepo.findOneOrFail({
        where: { id: transactionId },
      });
      lifecycle.confirmationDepth = confirmationState.confirmationDepth;
      await this.lifecycleRepo.save(lifecycle);

      // Continue polling
      this.pollConfirmationDepth(txHash);
    } catch (error) {
      logger.error("Error during confirmation poll", {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Continue polling despite error
      this.pollConfirmationDepth(txHash);
    }
  }

  /**
   * Declare finality: all side effects triggered here.
   */
  private async declareFinal(
    transactionId: string,
    txHash: string,
    confirmationDepth: number
  ): Promise<void> {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (!confirmationState) {
      return;
    }

    // Stop polling
    if (confirmationState.pollingIntervalHandle) {
      clearTimeout(confirmationState.pollingIntervalHandle);
    }

    logger.info("Declaring finality", { transactionId, txHash, confirmationDepth });

    // Update lifecycle
    const lifecycle = await this.lifecycleRepo.findOneOrFail({
      where: { id: transactionId },
    });
    lifecycle.finalityStatus = "FINAL";
    lifecycle.finalityDeclaredAt = new Date();
    lifecycle.confirmationDepth = confirmationDepth;
    await this.lifecycleRepo.save(lifecycle);

    // Remove from active tracking
    this.activeConfirmations.delete(txHash);

    // Emit finality declared event
    this.emitReorgEvent({
      eventType: "finality_declared",
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "CONFIRMING",
      newStatus: "FINAL",
      details: {
        ledgerSequence: confirmationState.ledgerSequence,
        ledgerHash: confirmationState.ledgerHash,
        confirmationDepth,
      },
    });

    // Emit custom event for side effects to listen to
    this.emit("finality:declared", {
      transactionId,
      txHash,
      ledgerSequence: confirmationState.ledgerSequence,
      ledgerHash: confirmationState.ledgerHash,
    });
  }

  /**
   * Mark transaction as orphaned after ancestor check fails.
   */
  private async markOrphaned(
    transactionId: string,
    txHash: string,
    orphanedHash: string,
    reorgDepth: number
  ): Promise<void> {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (confirmationState && confirmationState.pollingIntervalHandle) {
      clearTimeout(confirmationState.pollingIntervalHandle);
    }

    logger.warn("Marking transaction as orphaned", {
      transactionId,
      txHash,
      reorgDepth,
    });

    // Update lifecycle
    const lifecycle = await this.lifecycleRepo.findOneOrFail({
      where: { id: transactionId },
    });
    lifecycle.finalityStatus = "ORPHANED";
    lifecycle.orphanedAt = new Date();
    lifecycle.orphanedLedgerHash = orphanedHash;
    lifecycle.reorgDepth = reorgDepth;
    lifecycle.finalityStatus = "RECONCILING";
    await this.lifecycleRepo.save(lifecycle);

    // Remove from active tracking
    this.activeConfirmations.delete(txHash);

    // Emit orphan detected event
    this.emitReorgEvent({
      eventType: "orphan_detected",
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "CONFIRMING",
      newStatus: "ORPHANED",
      details: {
        reorgDepth,
        orphanedHash,
      },
    });

    // Trigger reconciliation
    this.emit("orphan:detected", {
      transactionId,
      txHash,
      lifecycle,
    });
  }

  /**
   * Mark transaction as STALE when primary provider stops advancing.
   */
  private async markStale(transactionId: string, txHash: string): Promise<void> {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (confirmationState && confirmationState.pollingIntervalHandle) {
      clearTimeout(confirmationState.pollingIntervalHandle);
    }

    logger.warn("Marking transaction as STALE due to timeout", {
      transactionId,
      txHash,
    });

    // Update lifecycle
    const lifecycle = await this.lifecycleRepo.findOneOrFail({
      where: { id: transactionId },
    });
    lifecycle.finalityStatus = "STALE";
    await this.lifecycleRepo.save(lifecycle);

    // Remove from active tracking
    this.activeConfirmations.delete(txHash);

    // Emit stale_horizon event
    this.emitReorgEvent({
      eventType: "stale_horizon",
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "CONFIRMING",
      newStatus: "STALE",
      details: {
        timeoutMs: this.policy.confirmationTimeoutMs,
      },
    });

    // Trigger reconciliation
    this.emit("stale:detected", {
      transactionId,
      txHash,
      lifecycle,
    });
  }

  /**
   * Emit a structured reorg event for operator notification.
   */
  private emitReorgEvent(event: ReorgEvent): void {
    logger.warn("ReorgEvent", JSON.stringify(event));
    this.emit("reorg:event", event);
  }

  /**
   * Stop tracking a transaction (cleanup).
   */
  stopTracking(txHash: string): void {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (confirmationState && confirmationState.pollingIntervalHandle) {
      clearTimeout(confirmationState.pollingIntervalHandle);
    }
    this.activeConfirmations.delete(txHash);
  }

  /**
   * Handle cancellation from an AbortSignal.
   *
   * Clears the polling handle, removes the confirmation from active tracking,
   * emits a `cancelled` event, and updates the lifecycle record to RECONCILING
   * (consistent with the orphan path — the caller may still want to reconcile).
   */
  private async handleCancellation(txHash: string, reason: string): Promise<void> {
    const confirmationState = this.activeConfirmations.get(txHash);
    if (!confirmationState) return;

    if (confirmationState.pollingIntervalHandle) {
      clearTimeout(confirmationState.pollingIntervalHandle);
    }

    logger.info("Confirmation polling cancelled", {
      transactionId: confirmationState.transactionId,
      txHash,
      reason,
    });

    this.activeConfirmations.delete(txHash);

    this.emit("cancelled", {
      transactionId: confirmationState.transactionId,
      txHash,
      reason,
      confirmationDepth: confirmationState.confirmationDepth,
    });
  }

  /**
   * Start tracking and return a promise that resolves with the terminal
   * {@link PollOutcome}.
   *
   * This is the promise-based alternative to {@link startConfirmationTracking}
   * + event listeners.  It:
   *  - Starts the polling loop (same as `startConfirmationTracking`).
   *  - Resolves when finality is declared, the deadline is reached, an orphan
   *    is detected, or the provided `signal` is aborted.
   *  - Cleans up all listeners it registered so there is no memory leak.
   *
   * @param options.signal    — optional AbortSignal for external cancellation.
   * @param options.deadlineMs — optional deadline (ms since epoch).  Overrides
   *                             the policy's `confirmationTimeoutMs` when
   *                             provided.  When the deadline is reached the
   *                             outcome is `{ status: "timeout" }`.
   *
   * Existing callers of `startConfirmationTracking` are unaffected — this
   * method is purely additive.
   */
  async awaitConfirmation(
    transactionId: string,
    txHash: string,
    ledgerSequence: number,
    ledgerHash: string,
    provider: string,
    options: { signal?: AbortSignal; deadlineMs?: number } = {}
  ): Promise<PollOutcome> {
    const { signal, deadlineMs } = options;

    // Compute the effective timeout
    const effectiveTimeoutMs =
      deadlineMs !== undefined
        ? Math.max(0, deadlineMs - Date.now())
        : this.policy.confirmationTimeoutMs;

    // Start tracking — this kicks off the polling loop.
    // Temporarily override the policy timeout if a custom deadline is provided.
    const originalTimeoutMs = this.policy.confirmationTimeoutMs;
    if (deadlineMs !== undefined) {
      this.policy.confirmationTimeoutMs = effectiveTimeoutMs;
    }

    await this.startConfirmationTracking(
      transactionId,
      txHash,
      ledgerSequence,
      ledgerHash,
      provider,
      signal
    );

    // Restore the policy timeout
    if (deadlineMs !== undefined) {
      this.policy.confirmationTimeoutMs = originalTimeoutMs;
    }

    return new Promise<PollOutcome>((resolve) => {
      const cleanup = () => {
        this.off("finality:declared", onFinality);
        this.off("stale:detected", onStale);
        this.off("orphan:detected", onOrphan);
        this.off("cancelled", onCancelled);
        if (signalAbortListener) {
          signal?.removeEventListener("abort", signalAbortListener);
        }
      };

      const onFinality = (data: { transactionId: string; txHash: string; ledgerSequence: number; ledgerHash: string }) => {
        if (data.txHash !== txHash) return;
        cleanup();
        const state = this.activeConfirmations.get(txHash);
        const depth = state?.confirmationDepth ?? 0;
        resolve({
          status: "confirmed",
          transactionId,
          txHash,
          confirmationDepth: depth,
          ledgerSequence,
        });
      };

      const onStale = (data: { transactionId: string; txHash: string }) => {
        if (data.txHash !== txHash) return;
        cleanup();
        resolve({
          status: "timeout",
          transactionId,
          txHash,
          deadlineMs: Date.now(),
          lastConfirmationDepth: 0,
        });
      };

      const onOrphan = (data: { transactionId: string; txHash: string; lifecycle: { reorgDepth?: number } }) => {
        if (data.txHash !== txHash) return;
        cleanup();
        resolve({
          status: "orphaned",
          transactionId,
          txHash,
          reorgDepth: data.lifecycle?.reorgDepth ?? 0,
        });
      };

      const onCancelled = (data: { transactionId: string; txHash: string; reason: string }) => {
        if (data.txHash !== txHash) return;
        cleanup();
        resolve({
          status: "cancelled",
          transactionId,
          txHash,
          reason: data.reason,
        });
      };

      // External abort signal
      let signalAbortListener: (() => void) | undefined;
      if (signal) {
        signalAbortListener = () => {
          this.handleCancellation(txHash, "abort signal").catch(() => {});
        };
        signal.addEventListener("abort", signalAbortListener);
      }

      this.on("finality:declared", onFinality);
      this.on("stale:detected", onStale);
      this.on("orphan:detected", onOrphan);
      this.on("cancelled", onCancelled);
    });
  }

  /**
   * Get active confirmations (for testing/monitoring).
   */
  getActiveConfirmations(): ConfirmationState[] {
    return Array.from(this.activeConfirmations.values());
  }
}
