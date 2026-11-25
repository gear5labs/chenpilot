import { Repository } from "typeorm";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import { IndexedTransactionGap, IndexedTransactionGapStatus } from "./IndexedTransactionGap.entity";
import type { TransactionSubmission } from "./submission/TransactionSubmission.entity";

export interface IndexedTransactionGapOptions {
  staleThresholdLedgers?: number;
  maxCheckCount?: number;
}

export interface IndexedTransactionGapCheckResult {
  gap: IndexedTransactionGap;
  resolved: boolean;
  stale: boolean;
}

export class IndexedTransactionGapService {
  private get repo(): Repository<IndexedTransactionGap> {
    return AppDataSource.getRepository(IndexedTransactionGap);
  }

  private readonly staleThresholdLedgers: number;
  private readonly maxCheckCount: number;

  constructor(options: IndexedTransactionGapOptions = {}) {
    this.staleThresholdLedgers = options.staleThresholdLedgers ?? 10;
    this.maxCheckCount = options.maxCheckCount ?? 5;
  }

  async registerGap(
    transactionHash: string,
    sourceAccount: string,
    sequenceNumber: number,
    submittedAt: Date,
    expectedLedger: number | null,
    indexerCursorLedger: number | null,
    submissionId: string | null = null,
    lifecycleId: string | null = null,
  ): Promise<IndexedTransactionGap> {
    const existing = await this.repo.findOne({
      where: { transactionHash },
    });

    if (existing) {
      logger.info("IndexedTransactionGap already exists, returning existing", {
        transactionHash,
        gapId: existing.id,
        status: existing.status,
      });
      return existing;
    }

    const gap = this.repo.create({
      transactionHash,
      sourceAccount,
      sequenceNumber,
      submittedAt,
      expectedLedger,
      indexerCursorLedger,
      status: "PENDING",
      firstCheckedAt: new Date(),
      lastCheckedAt: new Date(),
      lastReason: null,
      checkCount: 0,
      submissionId,
      lifecycleId,
    });

    const saved = await this.repo.save(gap);

    logger.info("IndexedTransactionGap created", {
      gapId: saved.id,
      transactionHash,
      sourceAccount,
      sequenceNumber,
      expectedLedger,
      indexerCursorLedger,
    });

    return saved;
  }

  async checkGap(
    gapId: string,
    indexerCursorLedger: number,
  ): Promise<IndexedTransactionGapCheckResult> {
    const gap = await this.repo.findOne({ where: { id: gapId } });

    if (!gap) {
      throw new Error(`IndexedTransactionGap ${gapId} not found`);
    }

    gap.checkCount += 1;
    gap.lastCheckedAt = new Date();
    gap.indexerCursorLedger = indexerCursorLedger;

    let resolved = false;
    let stale = false;

    if (gap.expectedLedger !== null) {
      const ledgerLag = indexerCursorLedger - gap.expectedLedger;

      if (ledgerLag >= 0) {
        if (ledgerLag > this.staleThresholdLedgers || gap.checkCount >= this.maxCheckCount) {
          gap.status = "STALE";
          gap.lastReason = `Indexer cursor ${indexerCursorLedger} is ${ledgerLag} ledgers past expected ${gap.expectedLedger} without resolving transaction`;
          stale = true;
        } else {
          gap.lastReason = `Indexer cursor ${indexerCursorLedger} is ${ledgerLag} ledgers past expected ${gap.expectedLedger}, still within stale threshold`;
        }
      } else {
        gap.lastReason = `Indexer cursor ${indexerCursorLedger} has not yet reached expected ledger ${gap.expectedLedger}`;
      }
    } else {
      const ledgersSinceSubmission = indexerCursorLedger - (gap.indexerCursorLedger ?? 0);
      if (ledgersSinceSubmission > this.staleThresholdLedgers) {
        gap.status = "STALE";
        gap.lastReason = `No expected ledger set; ${ledgersSinceSubmission} ledgers have passed since gap registration`;
        stale = true;
      }
    }

    const saved = await this.repo.save(gap);

    logger.info("IndexedTransactionGap checked", {
      gapId: saved.id,
      transactionHash: saved.transactionHash,
      status: saved.status,
      checkCount: saved.checkCount,
      resolved,
      stale,
    });

    return { gap: saved, resolved, stale };
  }

  async markResolved(
    gapId: string,
    reason: string = "indexer_caught_up",
  ): Promise<IndexedTransactionGap> {
    const gap = await this.repo.findOne({ where: { id: gapId } });

    if (!gap) {
      throw new Error(`IndexedTransactionGap ${gapId} not found`);
    }

    gap.status = "RESOLVED";
    gap.lastReason = reason;
    gap.lastCheckedAt = new Date();

    const saved = await this.repo.save(gap);

    logger.info("IndexedTransactionGap resolved", {
      gapId: saved.id,
      transactionHash: saved.transactionHash,
      reason,
    });

    return saved;
  }

  async findPending(): Promise<IndexedTransactionGap[]> {
    return this.repo.find({
      where: { status: "PENDING" },
      order: { firstCheckedAt: "ASC" },
    });
  }

  async findStale(): Promise<IndexedTransactionGap[]> {
    return this.repo.find({
      where: { status: "STALE" },
      order: { lastCheckedAt: "ASC" },
    });
  }

  async findResolved(): Promise<IndexedTransactionGap[]> {
    return this.repo.find({
      where: { status: "RESOLVED" },
      order: { lastCheckedAt: "DESC" },
    });
  }

  async findByTransactionHash(
    transactionHash: string,
  ): Promise<IndexedTransactionGap | null> {
    return this.repo.findOne({ where: { transactionHash } });
  }

  async registerFromSubmission(
    submission: TransactionSubmission,
    indexerCursorLedger: number | null,
  ): Promise<IndexedTransactionGap> {
    return this.registerGap(
      submission.transactionHash,
      submission.sourceAccount,
      Number(submission.sequenceNumber),
      submission.submittedAt ?? new Date(),
      submission.ledger ?? null,
      indexerCursorLedger,
      submission.id,
      submission.lifecycleId ?? null,
    );
  }
}

export const indexedTransactionGapService = new IndexedTransactionGapService();
