import crypto from "crypto";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import { sha256Hex, stableStringify } from "../utils/canonicalJson";

/**
 * Append-only audit trail for manual corrections to transaction-related
 * state: quarantine resolutions, dispute outcomes, and operator repairs.
 *
 * Rows are insert-only — a correction never overwrites the record it
 * amends; it preserves `previous_state`, `new_state`, and the
 * `source_evidence` the decision was based on, plus a SHA-256 over the
 * canonical evidence payload so later tampering is detectable.
 */

export type TransactionCorrectionType =
  | "quarantine_resolution"
  | "dispute_resolution"
  | "manual_repair"
  | "other";

export interface TransactionCorrectionInput {
  /** Reconciliation report this correction was triggered by, if any. */
  reportId?: string;
  /** Stable identifier of the corrected entity (chain identity, dispute tx, …). */
  entityId?: string;
  txHash?: string;
  correctionType: TransactionCorrectionType | string;
  previousState?: unknown;
  newState?: unknown;
  /** The evidence the correction was based on (activity snapshot, dispute evidence, …). */
  sourceEvidence?: unknown;
  correctedBy?: string;
  reason?: string;
}

export interface TransactionCorrection {
  id: string;
  reportId: string | null;
  entityId: string | null;
  txHash: string | null;
  correctionType: string;
  previousState: unknown;
  newState: unknown;
  sourceEvidence: unknown;
  correctedBy: string | null;
  reason: string | null;
  evidenceSha256: string;
  createdAt: string;
}

/**
 * Hash of the canonical evidence payload. Covers the state transition and
 * the source evidence so any later edit to either is detectable.
 */
export function correctionEvidenceHash(input: {
  previousState?: unknown;
  newState?: unknown;
  sourceEvidence?: unknown;
}): string {
  return sha256Hex(
    stableStringify({
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      sourceEvidence: input.sourceEvidence ?? null,
    })
  );
}

/**
 * Persist a manual-correction record. Best-effort: returns null (and logs)
 * when the database is unavailable or the insert fails — callers must not
 * let audit persistence break the correction flow itself.
 */
export async function recordTransactionCorrection(
  input: TransactionCorrectionInput
): Promise<TransactionCorrection | null> {
  try {
    const db = AppDataSource.isInitialized ? AppDataSource : null;
    if (!db) return null;

    const id = crypto.randomUUID();
    const evidenceSha256 = correctionEvidenceHash(input);

    const rows = await db.query(
      `INSERT INTO transaction_corrections
        (id, report_id, entity_id, tx_hash, correction_type,
         previous_state, new_state, source_evidence,
         corrected_by, reason, evidence_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, report_id as "reportId", entity_id as "entityId",
                 tx_hash as "txHash", correction_type as "correctionType",
                 previous_state as "previousState", new_state as "newState",
                 source_evidence as "sourceEvidence", corrected_by as "correctedBy",
                 reason, evidence_sha256 as "evidenceSha256",
                 created_at as "createdAt"`,
      [
        id,
        input.reportId ?? null,
        input.entityId ?? null,
        input.txHash ?? null,
        input.correctionType,
        input.previousState != null ? JSON.stringify(input.previousState) : null,
        input.newState != null ? JSON.stringify(input.newState) : null,
        input.sourceEvidence != null
          ? JSON.stringify(input.sourceEvidence)
          : null,
        input.correctedBy ?? null,
        input.reason ?? null,
        evidenceSha256,
      ]
    );

    return (rows?.[0] as TransactionCorrection) ?? null;
  } catch (err) {
    logger.warn("Failed to record transaction correction", {
      correctionType: input.correctionType,
      entityId: input.entityId,
      err,
    });
    return null;
  }
}
