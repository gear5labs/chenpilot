import { createHash } from "crypto";
import logger from "../config/logger";

export interface TransactionSafetyRequest {
  transactionId?: string;
  userId?: string;
  intent: {
    actionType: string;
    sourceAccount?: string;
    destination?: string;
    amount?: string;
    asset?: string;
    maxSlippagePercent?: number;
    expectedPrice?: string;
    quotedPrice?: string;
  };
  parameters: {
    feeStroops?: number;
    gasLimit?: string;
    networkPassphrase?: string;
    [key: string]: unknown;
  };
  preflightContext?: {
    accountBalanceStroops?: string;
    requiredBalanceStroops?: string;
    allowanceValid?: boolean;
    chainCompatible?: boolean;
    [key: string]: unknown;
  };
}

export interface SafetyViolation {
  code: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface SafetyEvidenceBundle {
  digest: string;
  timestamp: number;
  requestDigest: string;
  status: "accepted" | "rejected";
  violations: SafetyViolation[];
  metadata: Record<string, unknown>;
}

export interface SafetyEvaluationResult {
  approved: boolean;
  violations: SafetyViolation[];
  evidence: SafetyEvidenceBundle;
}

export class TransactionSafetyGate {
  private maxAllowedSlippagePercent: number;
  private maxFeeStroops: number;

  constructor(options: { maxAllowedSlippagePercent?: number; maxFeeStroops?: number } = {}) {
    this.maxAllowedSlippagePercent = options.maxAllowedSlippagePercent ?? 5.0;
    this.maxFeeStroops = options.maxFeeStroops ?? 50_000_000; // 5 XLM
  }

  public evaluate(request: TransactionSafetyRequest): SafetyEvaluationResult {
    const violations: SafetyViolation[] = [];

    // 1. Intent Validation
    if (!request.intent || !request.intent.actionType) {
      violations.push({
        code: "INVALID_INTENT",
        message: "Transaction intent actionType is missing or invalid.",
        severity: "critical",
      });
    }

    if (request.intent?.amount && request.intent.amount.trim() === "") {
      violations.push({
        code: "EMPTY_AMOUNT",
        message: "Transaction amount cannot be empty.",
        severity: "high",
      });
    }

    // 2. Slippage and Price Impact Evaluation
    const slippage = request.intent?.maxSlippagePercent;
    if (slippage !== undefined && slippage > this.maxAllowedSlippagePercent) {
      violations.push({
        code: "EXCESSIVE_SLIPPAGE",
        message: `Requested slippage ${slippage}% exceeds maximum allowed limit of ${this.maxAllowedSlippagePercent}%`,
        severity: "high",
      });
    }

    if (request.intent?.expectedPrice && request.intent?.quotedPrice) {
      const expected = parseFloat(request.intent.expectedPrice);
      const quoted = parseFloat(request.intent.quotedPrice);
      if (!isNaN(expected) && !isNaN(quoted) && expected > 0) {
        const priceImpact = Math.abs((quoted - expected) / expected) * 100;
        if (priceImpact > this.maxAllowedSlippagePercent) {
          violations.push({
            code: "HIGH_PRICE_IMPACT",
            message: `Evaluated price impact ${priceImpact.toFixed(2)}% exceeds threshold.`,
            severity: "critical",
          });
        }
      }
    }

    // 3. Preflight Checks (Gas, Fees, Approvals, Chain Compatibility)
    const fee = request.parameters?.feeStroops;
    if (fee !== undefined && fee > this.maxFeeStroops) {
      violations.push({
        code: "EXCESSIVE_FEE",
        message: `Transaction fee ${fee} stroops exceeds safety limit of ${this.maxFeeStroops} stroops.`,
        severity: "high",
      });
    }

    if (request.preflightContext) {
      const ctx = request.preflightContext;
      if (ctx.chainCompatible === false) {
        violations.push({
          code: "INCOMPATIBLE_CHAIN_STATE",
          message: "Target chain state or network configuration is incompatible.",
          severity: "critical",
        });
      }

      if (ctx.allowanceValid === false) {
        violations.push({
          code: "INVALID_APPROVAL_STATE",
          message: "Token allowance or authorization dependency check failed preflight.",
          severity: "critical",
        });
      }

      if (
        typeof ctx.accountBalanceStroops === "string" &&
        typeof ctx.requiredBalanceStroops === "string"
      ) {
        const balance = BigInt(ctx.accountBalanceStroops);
        const required = BigInt(ctx.requiredBalanceStroops);
        if (balance < required) {
          violations.push({
            code: "INSUFFICIENT_BALANCE_PREFLIGHT",
            message: `Account balance (${balance.toString()}) is below required minimum (${required.toString()}).`,
            severity: "critical",
          });
        }
      }
    }

    const approved = violations.length === 0;
    const status = approved ? "accepted" : "rejected";

    const requestDigest = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");

    const evidenceBundle: SafetyEvidenceBundle = {
      digest: createHash("sha256")
        .update(requestDigest + status + Date.now().toString())
        .digest("hex"),
      timestamp: Date.now(),
      requestDigest,
      status,
      violations,
      metadata: {
        actionType: request.intent?.actionType,
        userId: request.userId,
        transactionId: request.transactionId,
      },
    };

    if (!approved) {
      logger.warn("Transaction rejected by safety gate", {
        violations,
        requestDigest,
        userId: request.userId,
      });
    }

    return {
      approved,
      violations,
      evidence: evidenceBundle,
    };
  }
}

export const transactionSafetyGate = new TransactionSafetyGate();
