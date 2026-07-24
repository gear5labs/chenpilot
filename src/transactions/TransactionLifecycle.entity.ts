import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// ── Operation types ────────────────────────────────────────────────────────────

export type LifecycleOperationType = "swap" | "soroban" | "delayed_job";

// ── State machine ──────────────────────────────────────────────────────────────
//
//  All three operation types share the same state space.
//  Not every state is reachable by every type (see VALID_TRANSITIONS).
//
//  swap:        intent → simulating → executing → submitting → submitted → confirmed
//                                                                        ↘ failed
//  soroban:     intent → simulating → executing → confirmed
//                                              ↘ failed
//  delayed_job: intent → pending → waiting → submitting → submitted → confirmed
//                                                        ↘ failed
//                                  ↘ cancelled (from any non-terminal state)

export type LifecycleState =
  | "intent"       // User request received, not yet acted on
  | "simulating"   // Dry-run / fee estimation in progress
  | "executing"    // Building and signing the transaction
  | "pending"      // Delayed job created, waiting for trigger time
  | "waiting"      // Waiting for fee/congestion condition
  | "submitting"   // Submitting to the network
  | "submitted"    // Accepted by the network, awaiting ledger close
  | "confirmed"    // Included in a ledger (terminal ✓)
  | "failed"       // Unrecoverable error (terminal ✗)
  | "cancelled";   // Explicitly cancelled by user (terminal ✗)

// Allowed transitions per operation type.
// Key = current state, value = set of reachable next states.
export const VALID_TRANSITIONS: Record<LifecycleState, Set<LifecycleState>> = {
  intent:     new Set(["simulating", "executing", "pending", "failed", "cancelled"]),
  simulating: new Set(["executing", "failed", "cancelled"]),
  executing:  new Set(["submitting", "confirmed", "failed", "cancelled"]),
  pending:    new Set(["waiting", "submitting", "cancelled", "failed"]),
  waiting:    new Set(["submitting", "cancelled", "failed"]),
  submitting: new Set(["submitted", "failed", "cancelled"]),
  submitted:  new Set(["confirmed", "failed"]),
  confirmed:  new Set(),   // terminal
  failed:     new Set(),   // terminal
  cancelled:  new Set(),   // terminal
};

export const TERMINAL_STATES = new Set<LifecycleState>(["confirmed", "failed", "cancelled"]);

// ── Entity ─────────────────────────────────────────────────────────────────────

@Entity("transaction_lifecycle")
@Index(["userId", "createdAt"])
@Index(["operationType", "state"])
export class TransactionLifecycle {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  userId!: string;

  @Column({ type: "varchar" })
  operationType!: LifecycleOperationType;

  @Column({ type: "varchar", default: "intent" })
  state!: LifecycleState;

  /** Correlation handle — txHash once known, planId for agent plans, delayedTx id, etc. */
  @Column({ type: "varchar", nullable: true })
  @Index()
  correlationId!: string | null;

  /** Arbitrary JSON snapshot of the operation payload at intent time */
  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;

  /** Arbitrary JSON metadata updated at each transition (fee estimates, ledger, errors…) */
  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  /** Human-readable reason for the last transition (especially failures) */
  @Column({ type: "text", nullable: true })
  lastTransitionReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
