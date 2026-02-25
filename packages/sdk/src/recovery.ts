import {
  RecoveryContext,
  RecoveryEngineOptions,
  RecoveryResult,
  RecoveryAction,
  RetryHandler,
  RefundHandler,
} from "./types";

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class RecoveryEngine {
  private maxRetries: number;
  private retryDelayMs: number;
  private retryHandler?: RetryHandler;
  private refundHandler?: RefundHandler;

  constructor(options?: RecoveryEngineOptions) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 2000;
    this.retryHandler = options?.retryHandler;
    this.refundHandler = options?.refundHandler;
  }

  async cleanup(context: RecoveryContext): Promise<RecoveryResult> {
    // 1) Attempt retries of the mint step if a retry handler is provided
    if (this.retryHandler?.retryMint) {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const res = await this.retryHandler.retryMint(context);
          if (res && res.success) {
            return {
              actionTaken: RecoveryAction.RETRY_MINT,
              success: true,
              message: `Mint retry succeeded on attempt ${attempt}`,
              details: res.details || {},
            } as RecoveryResult;
          }
          // if handler returned failure, wait and retry
        } catch {
          // swallow and retry
        }
        if (attempt < this.maxRetries) await delay(this.retryDelayMs);
      }
    }

    // 2) If retries exhausted or not configured, attempt refund of the lock
    if (this.refundHandler?.refundLock) {
      try {
        const refundRes = await this.refundHandler.refundLock(context);
        if (refundRes && refundRes.success) {
          return {
            actionTaken: RecoveryAction.REFUND_LOCK,
            success: true,
            message: `Refund executed`,
            details: refundRes.details || {},
          } as RecoveryResult;
        }
        return {
          actionTaken: RecoveryAction.MANUAL_INTERVENTION,
          success: false,
          message: `Refund handler executed but reported failure: ${refundRes?.message || "unknown"}`,
          details: refundRes?.details || {},
        } as RecoveryResult;
      } catch (error: unknown) {
        const msg = String(error);
        return {
          actionTaken: RecoveryAction.MANUAL_INTERVENTION,
          success: false,
          message: `Refund handler threw an error: ${msg}`,
        } as RecoveryResult;
      }
    }

    // 3) No handlers available — signal manual intervention required
    return {
      actionTaken: RecoveryAction.MANUAL_INTERVENTION,
      success: false,
      message:
        "No retry or refund handlers configured; manual intervention required.",
    } as RecoveryResult;
  }
}

export function createRecoveryEngine(options?: RecoveryEngineOptions) {
  return new RecoveryEngine(options);
}
