import crypto from "node:crypto";
import logger from "../config/logger";
import { DriftItem, DriftSeverity } from "./reconciliation.service";
import {
  OperatorActor,
  ReconciliationCase,
  ReconciliationWorkspaceService,
} from "./reconciliationWorkspace.service";

/**
 * Supported external wallet activity ingestion sources.
 */
export type WalletHistorySource =
  | "horizon"
  | "starknet_rpc"
  | "external_export"
  | "manual_batch"
  | "indexer";

export type NetworkType = "mainnet" | "testnet";

export type ActivityStatus = "confirmed" | "failed";

export type ReconciliationLinkStatus =
  | "unmatched"
  | "matched"
  | "quarantined"
  | "dismissed";

export type QuarantineReason =
  | "MULTIPLE_CANDIDATE_MATCHES"
  | "AMBIGUOUS_UNHASHED_CANDIDATE"
  | "AMOUNT_MISMATCH"
  | "ASSET_MISMATCH"
  | "PARTICIPANT_MISMATCH"
  | "STATUS_CONFLICT";

/**
 * Chen Pilot workflow categories that can originate a transaction which is then
 * broadcast externally (signed and submitted outside the platform).
 */
export type OriginatingWorkflowType =
  | "batch_payout"
  | "portfolio_rebalance"
  | "multi_signature"
  | "wallet_allowance"
  | "agent_plan"
  | "manual";

/**
 * Evidence used to attribute an externally observed broadcast to its workflow.
 */
export type WorkflowLinkStrategy =
  | "tx_hash"
  | "memo"
  | "memo_workflow_id"
  | "amount_wallet_window";

export type WorkflowLinkStatus = "unlinked" | "linked" | "ambiguous";

/**
 * Declaration from an originating workflow that a transaction was (or is about
 * to be) broadcast externally. Registration happens before the hash is observed,
 * so `txHash` is optional and weaker correlation signals (memo, amount, wallet,
 * broadcast time) can be supplied instead.
 */
export interface WorkflowBroadcastIntent {
  workflowId: string;
  workflowType: OriginatingWorkflowType;
  userId: string;
  network?: NetworkType;
  chainId?: string;
  txHash?: string;
  operationIndex?: number;
  sourceAddress?: string;
  targetAddress?: string;
  amount?: string | number;
  asset?: string;
  memo?: string;
  broadcastAt?: Date | string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Attribution record describing how an external activity was linked back to the
 * workflow that originated it.
 */
export interface WorkflowBroadcastLink {
  workflowId: string;
  workflowType: OriginatingWorkflowType;
  userId: string;
  strategy: WorkflowLinkStrategy;
  confidence: number;
  linkedAt: Date;
}

/**
 * Consolidated attribution view for a single originating workflow.
 */
export interface WorkflowBroadcastAudit {
  workflowId: string;
  pending: WorkflowBroadcastIntent[];
  linkedActivities: NormalizedExternalActivity[];
  ambiguousActivities: NormalizedExternalActivity[];
}

/**
 * Registered broadcast intent plus internal observation bookkeeping.
 */
interface RegisteredWorkflowBroadcast {
  key: string;
  intent: WorkflowBroadcastIntent;
  registeredAt: Date;
  observedChainIdentity?: string;
  observedAt?: Date;
}

/**
 * Audit provenance record capturing origin metadata and cryptographic payload checksum.
 */
export interface ImportProvenance {
  importId: string;
  source: WalletHistorySource;
  importedAt: Date;
  importedBy: string;
  network: NetworkType;
  rawPayloadChecksum: string;
  metadata?: Record<string, unknown>;
}

/**
 * Raw external transaction input from wallet history, Horizon, RPC or CSV.
 */
export interface RawExternalTransaction {
  txHash: string;
  operationIndex?: number;
  sourceAddress: string;
  targetAddress?: string;
  amount: string | number;
  asset?: string;
  timestamp?: string | number | Date;
  status?: string;
  memo?: string;
  operationType?: string;
  chainId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Fully normalized external transaction representation ready for deduplication and reconciliation.
 */
export interface NormalizedExternalActivity {
  chainIdentity: string;
  network: NetworkType;
  chainId: string;
  txHash: string;
  operationIndex: number;
  sourceAddress: string;
  targetAddress: string;
  amount: string;
  asset: string;
  timestamp: Date;
  status: ActivityStatus;
  memo?: string;
  operationType: string;
  provenance: ImportProvenance;
  linkStatus: ReconciliationLinkStatus;
  linkedInternalRecordId?: string;
  quarantineReason?: QuarantineReason;
  quarantineDetails?: Record<string, unknown>;
  lastReconciledAt?: Date;
  /**
   * Attribution of this externally broadcast transaction to the workflow that
   * originated it. Defaults to `unlinked` when no registered workflow matches.
   */
  workflowLinkStatus: WorkflowLinkStatus;
  workflowLink?: WorkflowBroadcastLink;
  workflowCandidateIds?: string[];
}

/**
 * Internal Chen Pilot transaction record to reconcile against.
 */
export interface InternalTransactionRecord {
  id: string;
  txHash?: string;
  userId: string;
  walletAddress?: string;
  amount: string;
  asset: string;
  status: string;
  sourceAddress?: string;
  targetAddress?: string;
  createdAt: Date;
}

/**
 * Configuration options for external wallet activity ingestion and reconciliation.
 */
export interface IngestOptions {
  source: WalletHistorySource;
  network: NetworkType;
  chainId?: string;
  importedBy: string;
  rawTransactions: RawExternalTransaction[];
  internalRecords?: InternalTransactionRecord[];
  /**
   * Originating workflows whose externally broadcast transactions may appear in
   * this batch. Intents are registered (idempotently) and remain pending until
   * an observed hash is attributed to them.
   */
  workflowIntents?: WorkflowBroadcastIntent[];
  timeToleranceMs?: number;
  amountToleranceEpsilon?: number;
  importId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Itemized ingestion and reconciliation batch result.
 */
export interface ImportBatchResult {
  importId: string;
  totalIngested: number;
  newlyImported: number;
  deduplicated: number;
  matched: number;
  quarantined: number;
  unmatched: number;
  /** Activities attributed to an originating workflow during this batch. */
  workflowLinked: number;
  /** Activities that matched multiple workflows and require operator review. */
  workflowAmbiguous: number;
  errors: Array<{
    itemIndex: number;
    error: string;
    rawItem: unknown;
  }>;
  activities: NormalizedExternalActivity[];
}

/**
 * Notification payload emitted for quarantined or notable reconciliation events.
 */
export interface ExternalReconciliationNotification {
  type:
    | "quarantine_alert"
    | "unmatched_external_activity"
    | "workflow_broadcast_linked"
    | "workflow_link_ambiguous";
  chainIdentity: string;
  txHash: string;
  amount: string;
  asset: string;
  quarantineReason?: QuarantineReason;
  importedBy: string;
  occurredAt: Date;
  /** Populated for workflow attribution notifications. */
  workflowId?: string;
  workflowType?: OriginatingWorkflowType;
  linkStrategy?: WorkflowLinkStrategy;
  /** Populated when multiple workflows claim the same external activity. */
  candidateWorkflowIds?: string[];
}

export type ReconciliationNotificationHandler = (
  notification: ExternalReconciliationNotification
) => void | Promise<void>;

/**
 * Service for ingesting external wallet activity, enforcing provenance, stable deduplication,
 * ambiguous match quarantining, and idempotent reconciliation against internal records.
 */
export class ExternalWalletReconciliationService {
  private activities = new Map<string, NormalizedExternalActivity>();
  private notificationHandlers: ReconciliationNotificationHandler[] = [];
  private workflowBroadcasts = new Map<string, RegisteredWorkflowBroadcast>();

  /**
   * Register a notification handler for alerts.
   */
  public onNotification(handler: ReconciliationNotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  /**
   * Register (or refresh) a workflow that expects an externally broadcast
   * transaction so a later ingestion can attribute the observed hash back to it.
   *
   * Registration is idempotent per workflow/network/hash/operation coordinates,
   * so retrying a workflow step does not create phantom attributions.
   */
  public registerWorkflowBroadcast(
    intent: WorkflowBroadcastIntent
  ): WorkflowBroadcastIntent {
    this.assertWorkflowIntent(intent);

    const key = this.buildWorkflowBroadcastKey(intent);
    const existing = this.workflowBroadcasts.get(key);
    const normalized = this.normalizeWorkflowIntent(intent);

    this.workflowBroadcasts.set(key, {
      key,
      intent: normalized,
      registeredAt: existing?.registeredAt ?? new Date(),
      observedChainIdentity: existing?.observedChainIdentity,
      observedAt: existing?.observedAt,
    });

    logger.info("Workflow broadcast intent registered", {
      workflowId: normalized.workflowId,
      workflowType: normalized.workflowType,
      txHash: normalized.txHash,
    });

    return this.cloneWorkflowIntent(normalized);
  }

  /**
   * List broadcast intents that have not yet been attributed to an observed
   * external activity (or all intents when `includeObserved` is set).
   */
  public getPendingWorkflowBroadcasts(
    filters: {
      workflowId?: string;
      userId?: string;
      network?: NetworkType;
      includeObserved?: boolean;
    } = {}
  ): WorkflowBroadcastIntent[] {
    return [...this.workflowBroadcasts.values()]
      .filter(
        (registered) => filters.includeObserved || !registered.observedChainIdentity
      )
      .filter(
        (registered) =>
          !filters.workflowId ||
          registered.intent.workflowId === filters.workflowId
      )
      .filter(
        (registered) => !filters.userId || registered.intent.userId === filters.userId
      )
      .filter(
        (registered) =>
          !filters.network || registered.intent.network === filters.network
      )
      .map((registered) => this.cloneWorkflowIntent(registered.intent));
  }

  /**
   * Retrieve every external activity attributed to a given originating workflow.
   */
  public getActivitiesForWorkflow(
    workflowId: string
  ): NormalizedExternalActivity[] {
    return [...this.activities.values()]
      .filter((act) => act.workflowLink?.workflowId === workflowId)
      .map((act) => this.cloneActivity(act));
  }

  /**
   * Consolidated attribution audit for an originating workflow: what is still
   * pending observation, what has been linked, and what needs operator review.
   */
  public getWorkflowBroadcastAudit(workflowId: string): WorkflowBroadcastAudit {
    return {
      workflowId,
      pending: this.getPendingWorkflowBroadcasts({ workflowId }),
      linkedActivities: this.getActivitiesForWorkflow(workflowId),
      ambiguousActivities: [...this.activities.values()]
        .filter(
          (act) =>
            act.workflowLinkStatus === "ambiguous" &&
            !!act.workflowCandidateIds?.includes(workflowId)
        )
        .map((act) => this.cloneActivity(act)),
    };
  }

  /**
   * Drop broadcast intents for a workflow (e.g. the workflow was cancelled or
   * its external broadcast was abandoned). Returns the number removed.
   */
  public unregisterWorkflowBroadcast(workflowId: string, txHash?: string): number {
    const cleanHash = txHash ? txHash.trim().toLowerCase() : undefined;
    let removed = 0;

    for (const [key, registered] of this.workflowBroadcasts.entries()) {
      if (registered.intent.workflowId !== workflowId) continue;
      if (
        cleanHash &&
        (registered.intent.txHash ?? "").trim().toLowerCase() !== cleanHash
      ) {
        continue;
      }
      this.workflowBroadcasts.delete(key);
      removed++;
    }

    return removed;
  }

  /**
   * Derive a stable, deterministic chain identity across networks and multi-op transactions.
   */
  public buildChainIdentity(
    network: NetworkType,
    chainId: string,
    txHash: string,
    operationIndex: number = 0
  ): string {
    const cleanHash = txHash.trim().toLowerCase();
    const cleanChainId = (chainId || "stellar").trim().toLowerCase();
    return `${network}:${cleanChainId}:${cleanHash}:${operationIndex}`;
  }

  /**
   * Ingest and normalize wallet-history sources, deduplicating via stable chain identities
   * and linking matching transactions against internal records.
   */
  public async ingestAndReconcile(
    options: IngestOptions
  ): Promise<ImportBatchResult> {
    const importId = options.importId || crypto.randomUUID();
    const timeToleranceMs = options.timeToleranceMs ?? 10 * 60 * 1000; // 10 minutes
    const amountEpsilon = options.amountToleranceEpsilon ?? 1e-6;
    const chainId = options.chainId || (options.network === "mainnet" ? "stellar-mainnet" : "stellar-testnet");

    const result: ImportBatchResult = {
      importId,
      totalIngested: options.rawTransactions.length,
      newlyImported: 0,
      deduplicated: 0,
      matched: 0,
      quarantined: 0,
      unmatched: 0,
      workflowLinked: 0,
      workflowAmbiguous: 0,
      errors: [],
      activities: [],
    };

    const internalRecords = options.internalRecords || [];

    // Attach any inline workflow intents to the registry before matching so that
    // re-imported (deduplicated) activities can be attributed retroactively.
    for (const intent of options.workflowIntents ?? []) {
      try {
        this.registerWorkflowBroadcast(intent);
      } catch (err) {
        logger.warn("Skipping invalid workflow broadcast intent", {
          workflowId: intent?.workflowId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (let i = 0; i < options.rawTransactions.length; i++) {
      const raw = options.rawTransactions[i];

      // Validate mandatory fields
      if (!raw || typeof raw !== "object") {
        result.errors.push({
          itemIndex: i,
          error: "Transaction record must be a non-null object",
          rawItem: raw,
        });
        continue;
      }

      if (!raw.txHash || typeof raw.txHash !== "string" || !raw.txHash.trim()) {
        result.errors.push({
          itemIndex: i,
          error: "Missing required txHash",
          rawItem: raw,
        });
        continue;
      }

      const parsedAmount = parseFloat(String(raw.amount));
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        result.errors.push({
          itemIndex: i,
          error: `Invalid transaction amount: ${raw.amount}`,
          rawItem: raw,
        });
        continue;
      }

      const opIndex = raw.operationIndex ?? 0;
      const chainIdentity = this.buildChainIdentity(
        options.network,
        raw.chainId || chainId,
        raw.txHash,
        opIndex
      );

      // Provenance calculation
      const payloadString = JSON.stringify(raw);
      const rawPayloadChecksum = crypto
        .createHash("sha256")
        .update(payloadString)
        .digest("hex");

      const provenance: ImportProvenance = {
        importId,
        source: options.source,
        importedAt: new Date(),
        importedBy: options.importedBy,
        network: options.network,
        rawPayloadChecksum,
        metadata: options.metadata,
      };

      const existing = this.activities.get(chainIdentity);

      if (existing) {
        // Idempotent re-import handling
        result.deduplicated++;

        // If previously unmatched, attempt reconciliation linkage if internal records are now present
        if (existing.linkStatus === "unmatched" && internalRecords.length > 0) {
          const matchResult = this.evaluateLinkage(
            existing,
            internalRecords,
            timeToleranceMs,
            amountEpsilon
          );
          existing.linkStatus = matchResult.linkStatus;
          existing.linkedInternalRecordId = matchResult.linkedInternalRecordId;
          existing.quarantineReason = matchResult.quarantineReason;
          existing.quarantineDetails = matchResult.quarantineDetails;
          existing.lastReconciledAt = new Date();
          this.activities.set(chainIdentity, existing);

          if (existing.linkStatus === "matched") result.matched++;
          else if (existing.linkStatus === "quarantined") {
            result.quarantined++;
            this.emitNotification({
              type: "quarantine_alert",
              chainIdentity: existing.chainIdentity,
              txHash: existing.txHash,
              amount: existing.amount,
              asset: existing.asset,
              quarantineReason: existing.quarantineReason,
              importedBy: options.importedBy,
              occurredAt: new Date(),
            });
          } else {
            result.unmatched++;
          }
        } else {
          if (existing.linkStatus === "matched") result.matched++;
          else if (existing.linkStatus === "quarantined") result.quarantined++;
          else result.unmatched++;
        }

        // Re-attempt workflow attribution on every re-import until the observed
        // hash has been bound to its originating workflow.
        if (existing.workflowLinkStatus !== "linked") {
          this.attributeWorkflowLink(existing, timeToleranceMs, amountEpsilon, result, {
            importedBy: options.importedBy,
          });
          existing.lastReconciledAt = new Date();
          this.activities.set(chainIdentity, existing);
        }

        result.activities.push(this.cloneActivity(existing));
        continue;
      }

      // New activity normalization
      const normalizedStatus: ActivityStatus =
        String(raw.status).toLowerCase() === "failed" ? "failed" : "confirmed";

      const normalizedTimestamp = raw.timestamp
        ? new Date(raw.timestamp)
        : new Date();

      const normalized: NormalizedExternalActivity = {
        chainIdentity,
        network: options.network,
        chainId: raw.chainId || chainId,
        txHash: raw.txHash.trim(),
        operationIndex: opIndex,
        sourceAddress: raw.sourceAddress || "unknown",
        targetAddress: raw.targetAddress || "unknown",
        amount: parsedAmount.toString(),
        asset: (raw.asset || "XLM").trim().toUpperCase(),
        timestamp: isNaN(normalizedTimestamp.getTime())
          ? new Date()
          : normalizedTimestamp,
        status: normalizedStatus,
        memo: raw.memo,
        operationType: raw.operationType || "payment",
        provenance,
        linkStatus: "unmatched",
        workflowLinkStatus: "unlinked",
      };

      // Perform reconciliation linkage
      const matchResult = this.evaluateLinkage(
        normalized,
        internalRecords,
        timeToleranceMs,
        amountEpsilon
      );

      normalized.linkStatus = matchResult.linkStatus;
      normalized.linkedInternalRecordId = matchResult.linkedInternalRecordId;
      normalized.quarantineReason = matchResult.quarantineReason;
      normalized.quarantineDetails = matchResult.quarantineDetails;

      // Attribute the observed broadcast to the workflow that originated it.
      this.attributeWorkflowLink(normalized, timeToleranceMs, amountEpsilon, result, {
        importedBy: options.importedBy,
      });
      normalized.lastReconciledAt = new Date();

      this.activities.set(chainIdentity, normalized);
      result.newlyImported++;

      if (normalized.linkStatus === "matched") {
        result.matched++;
      } else if (normalized.linkStatus === "quarantined") {
        result.quarantined++;
        this.emitNotification({
          type: "quarantine_alert",
          chainIdentity: normalized.chainIdentity,
          txHash: normalized.txHash,
          amount: normalized.amount,
          asset: normalized.asset,
          quarantineReason: normalized.quarantineReason,
          importedBy: options.importedBy,
          occurredAt: new Date(),
        });
      } else {
        result.unmatched++;
      }

      result.activities.push(this.cloneActivity(normalized));
    }

    logger.info("External wallet activity ingestion completed", {
      importId,
      total: result.totalIngested,
      newlyImported: result.newlyImported,
      deduplicated: result.deduplicated,
      matched: result.matched,
      quarantined: result.quarantined,
      unmatched: result.unmatched,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Evaluate matching rules between normalized external activity and internal records.
   * Quarantines ambiguous matches or discrepancies.
   */
  private evaluateLinkage(
    activity: NormalizedExternalActivity,
    internalRecords: InternalTransactionRecord[],
    timeToleranceMs: number,
    amountEpsilon: number
  ): {
    linkStatus: ReconciliationLinkStatus;
    linkedInternalRecordId?: string;
    quarantineReason?: QuarantineReason;
    quarantineDetails?: Record<string, unknown>;
  } {
    if (!internalRecords.length) {
      return { linkStatus: "unmatched" };
    }

    const cleanTxHash = activity.txHash.toLowerCase();
    const parsedExtAmount = parseFloat(activity.amount);

    // 1. Direct txHash exact matches
    const exactHashMatches = internalRecords.filter(
      (rec) => rec.txHash && rec.txHash.trim().toLowerCase() === cleanTxHash
    );

    if (exactHashMatches.length === 1) {
      const match = exactHashMatches[0];
      const parsedIntAmount = parseFloat(match.amount);

      // Verify amount consistency
      if (Math.abs(parsedExtAmount - parsedIntAmount) > amountEpsilon) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "AMOUNT_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalAmount: activity.amount,
            internalAmount: match.amount,
            delta: Math.abs(parsedExtAmount - parsedIntAmount),
          },
        };
      }

      // Verify asset consistency
      if (
        match.asset &&
        match.asset.trim().toUpperCase() !== activity.asset.trim().toUpperCase()
      ) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "ASSET_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalAsset: activity.asset,
            internalAsset: match.asset,
          },
        };
      }

      // Verify status consistency
      const internalFailed =
        match.status.toLowerCase() === "failed" ||
        match.status.toLowerCase() === "cancelled";
      const externalFailed = activity.status === "failed";
      if (internalFailed !== externalFailed) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "STATUS_CONFLICT",
          quarantineDetails: {
            internalRecordId: match.id,
            externalStatus: activity.status,
            internalStatus: match.status,
          },
        };
      }

      // Verify participant consistency if specified
      if (
        (match.sourceAddress &&
          match.sourceAddress.toLowerCase() !== activity.sourceAddress.toLowerCase()) ||
        (match.targetAddress &&
          match.targetAddress.toLowerCase() !== activity.targetAddress.toLowerCase())
      ) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "PARTICIPANT_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalSource: activity.sourceAddress,
            internalSource: match.sourceAddress,
            externalTarget: activity.targetAddress,
            internalTarget: match.targetAddress,
          },
        };
      }

      return {
        linkStatus: "matched",
        linkedInternalRecordId: match.id,
      };
    } else if (exactHashMatches.length > 1) {
      // Multiple internal records claim the exact same txHash
      return {
        linkStatus: "quarantined",
        quarantineReason: "MULTIPLE_CANDIDATE_MATCHES",
        quarantineDetails: {
          candidateInternalIds: exactHashMatches.map((m) => m.id),
          count: exactHashMatches.length,
          explanation: "Multiple internal transaction records mapped to single txHash",
        },
      };
    }

    // 2. Fuzzy / Inexact candidates lookup (by wallet address, amount, asset, within time window)
    const fuzzyCandidates = internalRecords.filter((rec) => {
      // Must match asset
      if (
        rec.asset &&
        rec.asset.trim().toUpperCase() !== activity.asset.trim().toUpperCase()
      ) {
        return false;
      }

      // Must match amount within epsilon
      const parsedIntAmount = parseFloat(rec.amount);
      if (Math.abs(parsedExtAmount - parsedIntAmount) > amountEpsilon) {
        return false;
      }

      // Wallet address check (source, target, or general wallet address)
      const walletMatches =
        (rec.walletAddress &&
          (rec.walletAddress.toLowerCase() === activity.sourceAddress.toLowerCase() ||
            rec.walletAddress.toLowerCase() === activity.targetAddress.toLowerCase())) ||
        (rec.sourceAddress &&
          rec.sourceAddress.toLowerCase() === activity.sourceAddress.toLowerCase()) ||
        (rec.targetAddress &&
          rec.targetAddress.toLowerCase() === activity.targetAddress.toLowerCase());

      if (!walletMatches) {
        return false;
      }

      // Time proximity window check
      if (rec.createdAt) {
        const deltaMs = Math.abs(
          new Date(rec.createdAt).getTime() - activity.timestamp.getTime()
        );
        if (deltaMs > timeToleranceMs) {
          return false;
        }
      }

      return true;
    });

    if (fuzzyCandidates.length > 1) {
      return {
        linkStatus: "quarantined",
        quarantineReason: "MULTIPLE_CANDIDATE_MATCHES",
        quarantineDetails: {
          candidateInternalIds: fuzzyCandidates.map((c) => c.id),
          count: fuzzyCandidates.length,
          explanation:
            "Multiple candidate internal transactions match amount, asset, and timeframe without distinct txHash",
        },
      };
    } else if (fuzzyCandidates.length === 1) {
      // Single candidate found by amount & wallet, but lacks cryptographic txHash confirmation
      // Quarantine to protect ledger invariants and require operator review
      return {
        linkStatus: "quarantined",
        quarantineReason: "AMBIGUOUS_UNHASHED_CANDIDATE",
        quarantineDetails: {
          candidateInternalId: fuzzyCandidates[0].id,
          explanation:
            "Candidate internal transaction matches amount and time window but lacks on-chain txHash link",
        },
      };
    }

    return { linkStatus: "unmatched" };
  }

  /**
   * Attribute an observed external broadcast to its originating workflow, update
   * batch counters, and notify subscribers when the attribution changes.
   */
  private attributeWorkflowLink(
    activity: NormalizedExternalActivity,
    timeToleranceMs: number,
    amountEpsilon: number,
    result: ImportBatchResult,
    context: { importedBy: string }
  ): void {
    const previousStatus = activity.workflowLinkStatus;
    const attribution = this.evaluateWorkflowLinkage(
      activity,
      [...this.workflowBroadcasts.values()],
      timeToleranceMs,
      amountEpsilon
    );

    if (attribution.status === "unlinked") {
      return;
    }

    if (attribution.status === "ambiguous") {
      activity.workflowLinkStatus = "ambiguous";
      activity.workflowLink = undefined;
      activity.workflowCandidateIds = attribution.candidateWorkflowIds;
      result.workflowAmbiguous++;

      // Only alert once per observed hash while the ambiguity persists.
      if (previousStatus !== "ambiguous") {
        this.emitNotification({
          type: "workflow_link_ambiguous",
          chainIdentity: activity.chainIdentity,
          txHash: activity.txHash,
          amount: activity.amount,
          asset: activity.asset,
          importedBy: context.importedBy,
          occurredAt: new Date(),
          candidateWorkflowIds: attribution.candidateWorkflowIds,
        });
      }
      return;
    }

    activity.workflowLinkStatus = "linked";
    activity.workflowLink = attribution.link;
    activity.workflowCandidateIds = undefined;
    result.workflowLinked++;

    attribution.registeredBroadcast.observedChainIdentity = activity.chainIdentity;
    attribution.registeredBroadcast.observedAt = new Date();

    this.emitNotification({
      type: "workflow_broadcast_linked",
      chainIdentity: activity.chainIdentity,
      txHash: activity.txHash,
      amount: activity.amount,
      asset: activity.asset,
      importedBy: context.importedBy,
      occurredAt: new Date(),
      workflowId: attribution.link.workflowId,
      workflowType: attribution.link.workflowType,
      linkStrategy: attribution.link.strategy,
    });

    logger.info("External broadcast linked to originating workflow", {
      workflowId: attribution.link.workflowId,
      workflowType: attribution.link.workflowType,
      chainIdentity: activity.chainIdentity,
      txHash: activity.txHash,
      strategy: attribution.link.strategy,
      confidence: attribution.link.confidence,
    });
  }

  /**
   * Resolve the originating workflow for an observed external activity using
   * progressively weaker correlation signals: known tx hash, memo (exact or
   * workflow id), then amount/asset/wallet/time proximity.
   *
   * Attribution never blocks ledger reconciliation: a workflow match is reported
   * independently of whether the activity matched an internal record.
   */
  private evaluateWorkflowLinkage(
    activity: NormalizedExternalActivity,
    broadcasts: RegisteredWorkflowBroadcast[],
    timeToleranceMs: number,
    amountEpsilon: number
  ):
    | {
        status: "linked";
        link: WorkflowBroadcastLink;
        registeredBroadcast: RegisteredWorkflowBroadcast;
      }
    | { status: "ambiguous"; candidateWorkflowIds: string[] }
    | { status: "unlinked" } {
    // A broadcast intent can only be attributed to one observed activity, but it
    // is re-evaluated idempotently against the very same chain identity.
    const eligible = broadcasts.filter(
      (registered) =>
        !registered.observedChainIdentity ||
        registered.observedChainIdentity === activity.chainIdentity
    );

    if (!eligible.length) {
      return { status: "unlinked" };
    }

    const chainCompatible = eligible.filter((registered) => {
      if (registered.intent.network && registered.intent.network !== activity.network) {
        return false;
      }
      if (
        registered.intent.chainId &&
        registered.intent.chainId.trim().toLowerCase() !==
          activity.chainId.trim().toLowerCase()
      ) {
        return false;
      }
      if (
        registered.intent.operationIndex !== undefined &&
        registered.intent.operationIndex !== activity.operationIndex
      ) {
        return false;
      }
      return true;
    });

    // 1. Cryptographic match on the broadcast hash itself.
    const cleanHash = activity.txHash.trim().toLowerCase();
    const hashMatches = chainCompatible.filter(
      (registered) =>
        !!registered.intent.txHash &&
        registered.intent.txHash.trim().toLowerCase() === cleanHash
    );
    const hashResolution = this.resolveWorkflowCandidates(hashMatches, "tx_hash", 1);
    if (hashResolution) return hashResolution;

    // 2. Correlation memo: exact equality first, workflow id embedded next.
    const memo = activity.memo?.trim();
    if (memo) {
      const exactMemoMatches = chainCompatible.filter(
        (registered) =>
          !!registered.intent.memo && registered.intent.memo.trim() === memo
      );
      const memoResolution = this.resolveWorkflowCandidates(
        exactMemoMatches,
        "memo",
        0.95
      );
      if (memoResolution) return memoResolution;

      const workflowIdMemoMatches = chainCompatible.filter((registered) =>
        memo.includes(registered.intent.workflowId)
      );
      const memoIdResolution = this.resolveWorkflowCandidates(
        workflowIdMemoMatches,
        "memo_workflow_id",
        0.9
      );
      if (memoIdResolution) return memoIdResolution;
    }

    // 3. Fallback proximity: amount + asset + wallet + broadcast time window.
    const proximityMatches = chainCompatible.filter((registered) => {
      const intent = registered.intent;

      if (intent.amount !== undefined) {
        const parsedIntentAmount = parseFloat(String(intent.amount));
        if (
          isNaN(parsedIntentAmount) ||
          Math.abs(parseFloat(activity.amount) - parsedIntentAmount) > amountEpsilon
        ) {
          return false;
        }
      }

      if (
        intent.asset &&
        intent.asset.trim().toUpperCase() !== activity.asset.trim().toUpperCase()
      ) {
        return false;
      }

      // Without a wallet anchor the intent is too weak to attribute safely.
      const sourceMatches =
        !!intent.sourceAddress &&
        intent.sourceAddress.trim().toLowerCase() ===
          activity.sourceAddress.trim().toLowerCase();
      const targetMatches =
        !!intent.targetAddress &&
        intent.targetAddress.trim().toLowerCase() ===
          activity.targetAddress.trim().toLowerCase();
      if (!sourceMatches && !targetMatches) {
        return false;
      }

      if (intent.broadcastAt) {
        const broadcastAt = new Date(intent.broadcastAt);
        if (
          !isNaN(broadcastAt.getTime()) &&
          Math.abs(broadcastAt.getTime() - activity.timestamp.getTime()) >
            timeToleranceMs
        ) {
          return false;
        }
      }

      return true;
    });

    return (
      this.resolveWorkflowCandidates(
        proximityMatches,
        "amount_wallet_window",
        0.7
      ) ?? { status: "unlinked" }
    );
  }

  /**
   * Convert candidate broadcast intents into a single attribution or an
   * ambiguity signal that requires operator review.
   */
  private resolveWorkflowCandidates(
    candidates: RegisteredWorkflowBroadcast[],
    strategy: WorkflowLinkStrategy,
    confidence: number
  ):
    | {
        status: "linked";
        link: WorkflowBroadcastLink;
        registeredBroadcast: RegisteredWorkflowBroadcast;
      }
    | { status: "ambiguous"; candidateWorkflowIds: string[] }
    | undefined {
    if (!candidates.length) {
      return undefined;
    }

    const workflowIds = [...new Set(candidates.map((c) => c.intent.workflowId))];

    if (workflowIds.length > 1) {
      return { status: "ambiguous", candidateWorkflowIds: workflowIds };
    }

    const match = candidates.find(
      (candidate) => candidate.intent.workflowId === workflowIds[0]
    );

    if (!match) {
      return undefined;
    }

    return {
      status: "linked",
      registeredBroadcast: match,
      link: {
        workflowId: match.intent.workflowId,
        workflowType: match.intent.workflowType,
        userId: match.intent.userId,
        strategy,
        confidence,
        linkedAt: new Date(),
      },
    };
  }

  private assertWorkflowIntent(intent: WorkflowBroadcastIntent): void {
    if (!intent || typeof intent !== "object") {
      throw new Error("Workflow broadcast intent must be a non-null object");
    }
    if (!intent.workflowId || !intent.workflowId.trim()) {
      throw new Error("Workflow broadcast intent requires a workflowId");
    }
    if (!intent.userId || !intent.userId.trim()) {
      throw new Error("Workflow broadcast intent requires a userId");
    }
    if (!intent.workflowType) {
      throw new Error("Workflow broadcast intent requires a workflowType");
    }
  }

  private normalizeWorkflowIntent(
    intent: WorkflowBroadcastIntent
  ): WorkflowBroadcastIntent {
    const broadcastAt = intent.broadcastAt ? new Date(intent.broadcastAt) : undefined;

    return {
      ...intent,
      workflowId: intent.workflowId.trim(),
      userId: intent.userId.trim(),
      txHash: intent.txHash?.trim(),
      chainId: intent.chainId?.trim(),
      sourceAddress: intent.sourceAddress?.trim(),
      targetAddress: intent.targetAddress?.trim(),
      asset: intent.asset?.trim().toUpperCase(),
      memo: intent.memo?.trim(),
      broadcastAt:
        broadcastAt && !isNaN(broadcastAt.getTime()) ? broadcastAt : undefined,
      metadata: intent.metadata ? { ...intent.metadata } : undefined,
    };
  }

  /**
   * Deterministic identity used for idempotent intent registration.
   */
  private buildWorkflowBroadcastKey(intent: WorkflowBroadcastIntent): string {
    const network = intent.network ?? "any";
    const hash = intent.txHash?.trim().toLowerCase() ?? "nohash";
    const operationIndex = intent.operationIndex ?? 0;
    return `${intent.workflowId}::${network}::${hash}::${operationIndex}`;
  }

  private cloneWorkflowIntent(
    intent: WorkflowBroadcastIntent
  ): WorkflowBroadcastIntent {
    return {
      ...intent,
      broadcastAt:
        intent.broadcastAt instanceof Date
          ? new Date(intent.broadcastAt)
          : intent.broadcastAt,
      metadata: intent.metadata ? { ...intent.metadata } : undefined,
    };
  }

  /**
   * Retrieve unmatched external activities, exposing them for review.
   */
  public getUnmatchedActivities(filters: {
    walletAddress?: string;
    network?: NetworkType;
    source?: WalletHistorySource;
    importId?: string;
  } = {}): NormalizedExternalActivity[] {
    return [...this.activities.values()]
      .filter((act) => act.linkStatus === "unmatched")
      .filter(
        (act) =>
          !filters.walletAddress ||
          act.sourceAddress.toLowerCase() === filters.walletAddress.toLowerCase() ||
          act.targetAddress.toLowerCase() === filters.walletAddress.toLowerCase()
      )
      .filter((act) => !filters.network || act.network === filters.network)
      .filter((act) => !filters.source || act.provenance.source === filters.source)
      .filter((act) => !filters.importId || act.provenance.importId === filters.importId)
      .map((act) => this.cloneActivity(act));
  }

  /**
   * Retrieve quarantined activities for operator triage.
   */
  public getQuarantinedMatches(filters: {
    walletAddress?: string;
    reason?: QuarantineReason;
    importId?: string;
  } = {}): NormalizedExternalActivity[] {
    return [...this.activities.values()]
      .filter((act) => act.linkStatus === "quarantined")
      .filter(
        (act) =>
          !filters.walletAddress ||
          act.sourceAddress.toLowerCase() === filters.walletAddress.toLowerCase() ||
          act.targetAddress.toLowerCase() === filters.walletAddress.toLowerCase()
      )
      .filter((act) => !filters.reason || act.quarantineReason === filters.reason)
      .filter((act) => !filters.importId || act.provenance.importId === filters.importId)
      .map((act) => this.cloneActivity(act));
  }

  /**
   * Retrieve all activities for a given stable chain identity.
   */
  public getActivity(chainIdentity: string): NormalizedExternalActivity | undefined {
    const act = this.activities.get(chainIdentity);
    return act ? this.cloneActivity(act) : undefined;
  }

  /**
   * Operator resolution of quarantined activity.
   */
  public resolveQuarantinedMatch(
    chainIdentity: string,
    resolution: "link" | "dismiss" | "keep_unmatched",
    targetInternalRecordId?: string,
    actor?: OperatorActor
  ): NormalizedExternalActivity {
    if (actor) {
      this.assertOperator(actor);
    }

    const activity = this.activities.get(chainIdentity);
    if (!activity) {
      throw new Error(`Activity with chain identity '${chainIdentity}' not found`);
    }

    if (activity.linkStatus !== "quarantined") {
      throw new Error(`Activity '${chainIdentity}' is not currently in quarantined status`);
    }

    if (resolution === "link") {
      if (!targetInternalRecordId) {
        throw new Error("Target internal record ID required to link quarantined activity");
      }
      activity.linkStatus = "matched";
      activity.linkedInternalRecordId = targetInternalRecordId;
      activity.quarantineReason = undefined;
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "manual_link",
      };
    } else if (resolution === "dismiss") {
      activity.linkStatus = "dismissed";
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "dismissed",
      };
    } else {
      activity.linkStatus = "unmatched";
      activity.quarantineReason = undefined;
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "marked_unmatched",
      };
    }

    activity.lastReconciledAt = new Date();
    this.activities.set(chainIdentity, activity);
    return this.cloneActivity(activity);
  }

  /**
   * Convert unmatched activities, quarantined matches and workflow broadcasts
   * awaiting observation into standard DriftItems for reconciliation reports.
   */
  public toDriftItems(
    options: { now?: Date; unobservedBroadcastToleranceMs?: number } = {}
  ): DriftItem[] {
    const driftItems: DriftItem[] = [];
    const now = options.now ?? new Date();
    const unobservedToleranceMs =
      options.unobservedBroadcastToleranceMs ?? 30 * 60 * 1000;

    for (const act of this.activities.values()) {
      const workflowSuffix = act.workflowLink
        ? ` [origin workflow: ${act.workflowLink.workflowType}/${act.workflowLink.workflowId} via ${act.workflowLink.strategy}]`
        : "";

      if (act.linkStatus === "unmatched") {
        driftItems.push({
          type: "external_activity_unmatched",
          severity: "major" as DriftSeverity,
          entityId: act.chainIdentity,
          backendValue: null,
          onChainValue: {
            txHash: act.txHash,
            amount: act.amount,
            asset: act.asset,
            sourceAddress: act.sourceAddress,
            targetAddress: act.targetAddress,
            provenance: act.provenance,
            workflowLink: act.workflowLink ?? null,
          },
          description: `External on-chain transaction ${act.txHash} has no internal Chen Pilot matching record (source: ${act.provenance.source})${workflowSuffix}`,
          repairAction: `Review external activity ${act.chainIdentity} and link or acknowledge as third-party transaction`,
          detectedAt: act.timestamp.toISOString(),
        });
      } else if (act.linkStatus === "quarantined") {
        driftItems.push({
          type: "external_activity_quarantined",
          severity: "critical" as DriftSeverity,
          entityId: act.chainIdentity,
          backendValue: act.quarantineDetails ?? null,
          onChainValue: {
            txHash: act.txHash,
            amount: act.amount,
            asset: act.asset,
            status: act.status,
            workflowLink: act.workflowLink ?? null,
          },
          description: `External transaction ${act.txHash} quarantined during reconciliation: ${act.quarantineReason}${workflowSuffix}`,
          repairAction: `Investigate reconciliation quarantine for ${act.chainIdentity} (${act.quarantineReason})`,
          detectedAt: act.timestamp.toISOString(),
        });
      }
    }

    // Workflows that declared an external broadcast but whose hash was never
    // observed on-chain stay pending for operator follow-up.
    for (const registered of this.workflowBroadcasts.values()) {
      if (registered.observedChainIdentity) continue;

      const broadcastAt =
        registered.intent.broadcastAt instanceof Date
          ? registered.intent.broadcastAt
          : registered.registeredAt;

      if (now.getTime() - broadcastAt.getTime() < unobservedToleranceMs) {
        continue;
      }

      driftItems.push({
        type: "workflow_broadcast_unobserved",
        severity: "major" as DriftSeverity,
        entityId: registered.intent.workflowId,
        backendValue: {
          workflowId: registered.intent.workflowId,
          workflowType: registered.intent.workflowType,
          userId: registered.intent.userId,
          txHash: registered.intent.txHash ?? null,
          memo: registered.intent.memo ?? null,
          registeredAt: registered.registeredAt.toISOString(),
        },
        onChainValue: null,
        description: `Workflow ${registered.intent.workflowId} (${registered.intent.workflowType}) expected an externally broadcast transaction that has not been observed on-chain`,
        repairAction: `Verify the external broadcast for workflow ${registered.intent.workflowId} and reconcile or cancel the workflow`,
        detectedAt: broadcastAt.toISOString(),
      });
    }

    return driftItems;
  }

  /**
   * Export unmatched and quarantined items directly into ReconciliationCases
   * within ReconciliationWorkspaceService for formal operator investigations.
   */
  public exportToReconciliationCases(
    workspaceService: ReconciliationWorkspaceService,
    reportId: string = crypto.randomUUID()
  ): ReconciliationCase[] {
    const driftItems = this.toDriftItems();
    const syntheticReport = {
      id: reportId,
      userId: "system",
      scope: { transactions: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: driftItems.length > 0 ? ("drifted" as const) : ("clean" as const),
      summary: {
        total: driftItems.length,
        critical: driftItems.filter((d) => d.severity === "critical").length,
        major: driftItems.filter((d) => d.severity === "major").length,
        minor: 0,
        none: 0,
      },
      driftItems,
    };

    return workspaceService.createCasesFromReport(syntheticReport);
  }

  /**
   * Emit notification to registered subscribers.
   */
  private emitNotification(notification: ExternalReconciliationNotification): void {
    for (const handler of this.notificationHandlers) {
      try {
        handler(notification);
      } catch (err) {
        logger.warn("Notification handler threw an error", { err });
      }
    }
  }

  private assertOperator(actor: OperatorActor): void {
    if (!actor.roles.includes("operator") && !actor.roles.includes("admin")) {
      throw new Error("Operator permission required");
    }
  }

  private cloneActivity(
    act: NormalizedExternalActivity
  ): NormalizedExternalActivity {
    return {
      ...act,
      timestamp: new Date(act.timestamp),
      lastReconciledAt: act.lastReconciledAt
        ? new Date(act.lastReconciledAt)
        : undefined,
      provenance: {
        ...act.provenance,
        importedAt: new Date(act.provenance.importedAt),
        metadata: act.provenance.metadata
          ? { ...act.provenance.metadata }
          : undefined,
      },
      quarantineDetails: act.quarantineDetails
        ? { ...act.quarantineDetails }
        : undefined,
      workflowLink: act.workflowLink
        ? { ...act.workflowLink, linkedAt: new Date(act.workflowLink.linkedAt) }
        : undefined,
      workflowCandidateIds: act.workflowCandidateIds
        ? [...act.workflowCandidateIds]
        : undefined,
    };
  }
}

export const externalWalletReconciliationService =
  new ExternalWalletReconciliationService();
