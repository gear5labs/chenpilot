import { AntiPhishingPreviewEngine } from "../../../src/transactions/preview/AntiPhishingPreviewEngine";
import { BuildPreviewInput, TransactionPreview } from "../../../src/transactions/preview/types";
import { PreviewAuditSink } from "../../../src/transactions/preview/previewAudit";
import { previewToReply, PreviewReply, PreviewFetcher, BackendPreviewResponse, PreviewIntent } from "../transactionPreview";

export interface TransactionPreviewServiceOptions {
  previewFetcher?: PreviewFetcher;
  auditSink?: PreviewAuditSink;
  baseUrl?: string;
  accessToken?: string;
}

/**
 * Bot-side service for rendering anti-phishing transaction previews, evaluating risk decisions,
 * generating audit trails, and mapping previews to consistent bot confirmation replies.
 */
export class TransactionPreviewService {
  private previewFetcher?: PreviewFetcher;
  private auditSink?: PreviewAuditSink;

  constructor(options: TransactionPreviewServiceOptions = {}) {
    this.previewFetcher = options.previewFetcher;
    this.auditSink = options.auditSink;
  }

  /**
   * Builds and evaluates a transaction preview locally using AntiPhishingPreviewEngine.
   */
  public buildAndEvaluate(input: BuildPreviewInput): {
    preview: TransactionPreview;
    text: string;
    evaluation: ReturnType<typeof AntiPhishingPreviewEngine.evaluateDecision>;
  } {
    const preview = AntiPhishingPreviewEngine.buildPreview(input);
    const text = AntiPhishingPreviewEngine.renderText(preview);
    const evaluation = AntiPhishingPreviewEngine.evaluateDecision(preview);
    return { preview, text, evaluation };
  }

  /**
   * Records an audit event for a transaction preview.
   */
  public async audit(preview: TransactionPreview, sink?: PreviewAuditSink):
    Promise<void> {
    const targetSink = sink ?? this.auditSink;
    if (targetSink) {
      await AntiPhishingPreviewEngine.auditPreview(preview, targetSink);
    }
  }

  /**
   * Fetches or builds a preview and converts it into a bot preview reply with appropriate
   * confirmation or refusal gating.
   */
  public async handlePreviewRequest(body: {
    xdr: string;
    networkPassphrase?: string;
    intent?: PreviewIntent;
  }): Promise<PreviewReply> {
    if (this.previewFetcher) {
      const response = await this.previewFetcher(body);
      return previewToReply(response);
    }

    // Fallback to local engine evaluation if no remote fetcher is configured
    try {
      const preview = AntiPhishingPreviewEngine.buildPreview({
        xdr: body.xdr,
        networkPassphrase: body.networkPassphrase,
        intent: body.intent,
      });
      const text = AntiPhishingPreviewEngine.renderText(preview);
      const response: BackendPreviewResponse = {
        success: true,
        text,
        decision: preview.decision,
        preview: {
          decision: preview.decision,
          decisionReason: preview.decisionReason,
          audit: {
            previewId: preview.audit.previewId,
            transactionHash: preview.audit.transactionHash,
          },
        },
      };
      if (this.auditSink) {
        await this.audit(preview, this.auditSink);
      }
      return previewToReply(response);
    } catch (error) {
      return {
        blocked: true,
        reply: {
          text: `⛔ Transaction decoding failed: ${error instanceof Error ? error.message : String(error)}`,
          ephemeral: true,
        },
      };
    }
  }
}
