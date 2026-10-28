import * as StellarSdk from "@stellar/stellar-sdk";
import {
  BuildPreviewInput,
  TransactionPreview,
  PreviewDecision,
  RiskSeverity,
} from "./types";
import { buildTransactionPreview } from "./transactionPreview";
import { recordPreviewAudit, PreviewAuditSink } from "./previewAudit";
import { renderPreviewText, RenderOptions } from "./renderPreview";

/**
 * Anti-phishing and explainability engine for transaction previews.
 * Provides structured decoding, risk highlighting, intent comparison, and audit trail.
 */
export class AntiPhishingPreviewEngine {
  /**
   * Decodes a transaction XDR and builds an anti-phishing transaction preview.
   */
  public static buildPreview(input: BuildPreviewInput): TransactionPreview {
    return buildTransactionPreview(input);
  }

  /**
   * Records the preview audit event into the provided audit sink.
   */
  public static async auditPreview(preview: TransactionPreview, sink: PreviewAuditSink): Promise<void> {
    await recordPreviewAudit(preview, sink);
  }

  /**
   * Renders the transaction preview into a safe human-readable text format.
   */
  public static renderText(preview: TransactionPreview, options: RenderOptions = {}): string {
    return renderPreviewText(preview, options);
  }

  /**
   * Evaluates whether a transaction preview should be blocked or require extra confirmation.
   */
  public static evaluateDecision(preview: TransactionPreview): {
    blocked: boolean;
    requiresExtraConfirmation: boolean;
    decision: PreviewDecision;
  } {
    const blocked = preview.decision === "refuse";
    const requiresExtraConfirmation = preview.decision === "confirm_with_warning";
    return {
      blocked,
      requiresExtraConfirmation,
      decision: preview.decision,
    };
  }
}
