/**
 * Terminal outcome of a confirmation-polling session.
 *
 * Every value is a plain, serialisable object so it can be returned from
 * `awaitConfirmation`, stored in metadata, or forwarded over the wire without
 * further conversion.
 *
 * ## Discriminated union
 *
 * The `status` field is the discriminant.  Consumers should switch on it:
 *
 * ```ts
 * const outcome = await finalizationManager.awaitConfirmation(
 *   txId, txHash, ledger, hash, provider,
 *   { signal: controller.signal }
 * );
 *
 * switch (outcome.status) {
 *   case "confirmed": // proceed with side effects
 *   case "timeout":    // re-simulate or re-submit
 *   case "cancelled": // user or parent cancelled — clean up
 *   case "orphaned":   // reorg detected — reconciliation handles this
 * }
 * ```
 */

export interface PollConfirmed {
  status: "confirmed";
  transactionId: string;
  txHash: string;
  /** How many ledgers closed on top of the observed ledger before finality. */
  confirmationDepth: number;
  /** Ledger sequence where the transaction was observed. */
  ledgerSequence: number;
}

export interface PollTimeout {
  status: "timeout";
  transactionId: string;
  txHash: string;
  /** The deadline that was in effect, in ms since epoch. */
  deadlineMs: number;
  /** How many ledgers of depth had accumulated when the deadline hit. */
  lastConfirmationDepth: number;
}

export interface PollCancelled {
  status: "cancelled";
  transactionId: string;
  txHash: string;
  /** Why the poll was cancelled (e.g. "abort signal", "shutdown"). */
  reason: string;
}

export interface PollOrphaned {
  status: "orphaned";
  transactionId: string;
  txHash: string;
  /** How many ledgers were rolled back during the reorg. */
  reorgDepth: number;
}

export type PollOutcome =
  | PollConfirmed
  | PollTimeout
  | PollCancelled
  | PollOrphaned;
