import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Status of a submitted transaction relative to the indexer cursor.
 *
 * A transaction is considered "missing from the indexer" when it has been
 * submitted to the network (and may even have been accepted) but the
 * indexer's cursor has not yet advanced past the ledger that should contain
 * it.  This entity tracks the gap so that operators and reconciliation
 * jobs can detect, monitor, and resolve indexing lag.
 */
export type IndexedTransactionGapStatus =
  | "PENDING"   // Submitted but not yet observed by the indexer
  | "RESOLVED"  // Indexer has caught up; transaction found in indexed events
  | "STALE";    // Indexer cursor has advanced past expected ledger without finding it

@Entity("indexed_transaction_gap")
@Index(["status", "firstCheckedAt"])
@Index(["transactionHash"], { unique: true })
@Index(["sourceAccount", "sequenceNumber"])
export class IndexedTransactionGap {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Hash of the submitted transaction (deterministic over the signed envelope). */
  @Column({ type: "varchar", length: 64 })
  transactionHash!: string;

  /** Stellar source account that signed the transaction. */
  @Column({ type: "varchar", length: 64 })
  sourceAccount!: string;

  /** Sequence number used by the submission. */
  @Column({ type: "bigint" })
  sequenceNumber!: number;

  /** Timestamp (ISO-8601) when the transaction was submitted to the network. */
  @Column({ type: "timestamp" })
  submittedAt!: Date;

  /** The ledger sequence where the transaction is expected to appear. */
  @Column({ type: "bigint", nullable: true })
  expectedLedger!: number | null;

  /** Indexer cursor ledger position at the time the gap was first detected. */
  @Column({ type: "bigint", nullable: true })
  indexerCursorLedger!: number | null;

  /** Current gap status. */
  @Column({ type: "varchar", length: 16, default: "PENDING" })
  status!: IndexedTransactionGapStatus;

  /** When the gap was first detected. */
  @Column({ type: "timestamp" })
  firstCheckedAt!: Date;

  /** When the gap status was last updated. */
  @Column({ type: "timestamp" })
  lastCheckedAt!: Date;

  /** Reason for the current status (e.g. "indexer_lag", "reorg", "not_found"). */
  @Column({ type: "text", nullable: true })
  lastReason!: string | null;

  /** Number of times the gap has been checked against the indexer. */
  @Column({ type: "integer", default: 0 })
  checkCount!: number;

  /** Matching transaction_submission row, if any. */
  @Column({ type: "varchar", nullable: true })
  submissionId!: string | null;

  /** Matching transaction_lifecycle row, if any. */
  @Column({ type: "varchar", nullable: true })
  lifecycleId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
