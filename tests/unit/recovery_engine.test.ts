import { createRecoveryEngine } from "../../packages/sdk/src";
import {
  RecoveryAction,
  RecoveryContext,
  ChainId,
} from "../../packages/sdk/src/types";

describe("RecoveryEngine (focused)", () => {
  const baseContext: RecoveryContext = {
    lockTxId: "lock123",
    amount: "0.1",
    fromChain: ChainId.BITCOIN,
    toChain: ChainId.STELLAR,
    destinationAddress: "GDESTINATION",
  };

  it("retries mint and succeeds", async () => {
    const engine = createRecoveryEngine({
      maxRetries: 3,
      retryDelayMs: 1,
      retryHandler: {
        retryMint: async () => ({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: true,
          message: "mint ok",
        }),
      },
    });

    const res = await engine.cleanup(baseContext);
    expect(res.success).toBe(true);
    expect(res.actionTaken).toBe(RecoveryAction.RETRY_MINT);
  });

  it("exhausts retries then refunds lock", async () => {
    let attempts = 0;
    const engine = createRecoveryEngine({
      maxRetries: 1,
      retryDelayMs: 1,
      retryHandler: {
        retryMint: async () => {
          attempts++;
          return {
            actionTaken: RecoveryAction.RETRY_MINT,
            success: false,
            message: "fail",
          };
        },
      },
      refundHandler: {
        refundLock: async () => ({
          actionTaken: RecoveryAction.REFUND_LOCK,
          success: true,
          message: "refunded",
        }),
      },
    });

    const res = await engine.cleanup(baseContext);
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(res.success).toBe(true);
    expect(res.actionTaken).toBe(RecoveryAction.REFUND_LOCK);
  });

  it("requires manual intervention when no handlers configured", async () => {
    const engine = createRecoveryEngine({ maxRetries: 1, retryDelayMs: 1 });
    const res = await engine.cleanup(baseContext);
    expect(res.success).toBe(false);
    expect(res.actionTaken).toBe(RecoveryAction.MANUAL_INTERVENTION);
  });
});
