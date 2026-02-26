/**
 * Unit tests for Recovery Engine
 * Tests retry logic, refund handling, and error recovery scenarios
 */

import { RecoveryEngine, createRecoveryEngine } from "../recovery";
import {
  RecoveryContext,
  RecoveryAction,
  ChainId,
  RetryHandler,
  RefundHandler,
} from "../types";

describe("RecoveryEngine", () => {
  let mockRetryHandler: jest.Mocked<RetryHandler>;
  let mockRefundHandler: jest.Mocked<RefundHandler>;
  let recoveryContext: RecoveryContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRetryHandler = {
      retryMint: jest.fn(),
    };

    mockRefundHandler = {
      refundLock: jest.fn(),
    };

    recoveryContext = {
      lockTxId: "btc_tx_123",
      mintTxId: "stellar_tx_456",
      amount: "1000",
      fromChain: ChainId.BITCOIN,
      toChain: ChainId.STELLAR,
      destinationAddress: "GADDR123",
      lockDetails: {
        scriptHash: "abc123",
        timestamp: 1234567890,
      },
      metadata: {
        userId: "user_1",
      },
    };
  });

  describe("Constructor", () => {
    it("should create engine with default options", () => {
      const engine = new RecoveryEngine();
      expect(engine).toBeInstanceOf(RecoveryEngine);
    });

    it("should create engine with custom options", () => {
      const engine = new RecoveryEngine({
        maxRetries: 5,
        retryDelayMs: 3000,
        retryHandler: mockRetryHandler,
        refundHandler: mockRefundHandler,
      });
      expect(engine).toBeInstanceOf(RecoveryEngine);
    });
  });

  describe("Retry Success Scenarios", () => {
    it("should succeed on first retry attempt", async () => {
      mockRetryHandler.retryMint.mockResolvedValueOnce({
        actionTaken: RecoveryAction.RETRY_MINT,
        success: true,
        message: "Mint succeeded",
        details: { txHash: "new_tx_789" },
      });

      const engine = new RecoveryEngine({
        maxRetries: 3,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe(RecoveryAction.RETRY_MINT);
      expect(result.message).toContain("attempt 1");
      expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(1);
    });

    it("should succeed on second retry attempt", async () => {
      mockRetryHandler.retryMint
        .mockResolvedValueOnce({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: false,
        })
        .mockResolvedValueOnce({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: true,
          message: "Mint succeeded",
        });

      const engine = new RecoveryEngine({
        maxRetries: 3,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(result.message).toContain("attempt 2");
      expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(2);
    });

    it("should succeed on last retry attempt", async () => {
      mockRetryHandler.retryMint
        .mockResolvedValueOnce({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: false,
        })
        .mockResolvedValueOnce({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: false,
        })
        .mockResolvedValueOnce({
          actionTaken: RecoveryAction.RETRY_MINT,
          success: true,
        });

      const engine = new RecoveryEngine({
        maxRetries: 3,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
    });
  });

  describe("Retry Failure and Refund", () => {
    it("should proceed to refund after all retries fail", async () => {
      mockRetryHandler.retryMint.mockResolvedValue({
        actionTaken: RecoveryAction.RETRY_MINT,
        success: false,
      });

      mockRefundHandler.refundLock.mockResolvedValueOnce({
        actionTaken: RecoveryAction.REFUND_LOCK,
        success: true,
        message: "Refund successful",
      });

      const engine = new RecoveryEngine({
        maxRetries: 3,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
        refundHandler: mockRefundHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe(RecoveryAction.REFUND_LOCK);
      expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
      expect(mockRefundHandler.refundLock).toHaveBeenCalledTimes(1);
    });

    it("should handle retry handler throwing errors", async () => {
      mockRetryHandler.retryMint.mockRejectedValue(new Error("Network error"));

      mockRefundHandler.refundLock.mockResolvedValueOnce({
        actionTaken: RecoveryAction.REFUND_LOCK,
        success: true,
      });

      const engine = new RecoveryEngine({
        maxRetries: 3,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
        refundHandler: mockRefundHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe(RecoveryAction.REFUND_LOCK);
      expect(mockRetryHandler.retryMint).toHaveBeenCalledTimes(3);
    });
  });

  describe("Refund Scenarios", () => {
    it("should execute refund when no retry handler provided", async () => {
      mockRefundHandler.refundLock.mockResolvedValueOnce({
        actionTaken: RecoveryAction.REFUND_LOCK,
        success: true,
        message: "Refund executed",
      });

      const engine = new RecoveryEngine({
        refundHandler: mockRefundHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe(RecoveryAction.REFUND_LOCK);
      expect(mockRefundHandler.refundLock).toHaveBeenCalledWith(
        recoveryContext
      );
    });

    it("should handle refund failure", async () => {
      mockRefundHandler.refundLock.mockResolvedValueOnce({
        actionTaken: RecoveryAction.REFUND_LOCK,
        success: false,
        message: "Refund failed",
      });

      const engine = new RecoveryEngine({
        refundHandler: mockRefundHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(false);
      expect(result.actionTaken).toBe(RecoveryAction.MANUAL_INTERVENTION);
      expect(result.message).toContain(
        "Refund handler executed but reported failure"
      );
    });

    it("should handle refund handler throwing error", async () => {
      mockRefundHandler.refundLock.mockRejectedValueOnce(
        new Error("Refund error")
      );

      const engine = new RecoveryEngine({
        refundHandler: mockRefundHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(false);
      expect(result.actionTaken).toBe(RecoveryAction.MANUAL_INTERVENTION);
      expect(result.message).toContain("Refund handler threw an error");
    });
  });

  describe("Manual Intervention", () => {
    it("should require manual intervention when no handlers provided", async () => {
      const engine = new RecoveryEngine();

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(false);
      expect(result.actionTaken).toBe(RecoveryAction.MANUAL_INTERVENTION);
      expect(result.message).toContain(
        "No retry or refund handlers configured"
      );
    });

    it("should require manual intervention when retry fails and no refund handler", async () => {
      mockRetryHandler.retryMint.mockResolvedValue({
        actionTaken: RecoveryAction.RETRY_MINT,
        success: false,
      });

      const engine = new RecoveryEngine({
        maxRetries: 2,
        retryDelayMs: 100,
        retryHandler: mockRetryHandler,
      });

      const result = await engine.cleanup(recoveryContext);

      expect(result.success).toBe(false);
      expect(result.actionTaken).toBe(RecoveryAction.MANUAL_INTERVENTION);
    });
  });

  describe("Context Preservation", () => {
    it("should pass complete context to retry handler", async () => {
      mockRetryHandler.retryMint.mockResolvedValue({
        actionTaken: RecoveryAction.RETRY_MINT,
        success: true,
      });

      const engine = new RecoveryEngine({
        retryHandler: mockRetryHandler,
      });

      await engine.cleanup(recoveryContext);

      expect(mockRetryHandler.retryMint).toHaveBeenCalledWith(
        expect.objectContaining({
          lockTxId: "btc_tx_123",
          amount: "1000",
          fromChain: ChainId.BITCOIN,
          toChain: ChainId.STELLAR,
        })
      );
    });

    it("should pass complete context to refund handler", async () => {
      mockRefundHandler.refundLock.mockResolvedValue({
        actionTaken: RecoveryAction.REFUND_LOCK,
        success: true,
      });

      const engine = new RecoveryEngine({
        refundHandler: mockRefundHandler,
      });

      await engine.cleanup(recoveryContext);

      expect(mockRefundHandler.refundLock).toHaveBeenCalledWith(
        recoveryContext
      );
    });
  });
});

describe("createRecoveryEngine", () => {
  it("should create engine with factory function", () => {
    const engine = createRecoveryEngine();
    expect(engine).toBeInstanceOf(RecoveryEngine);
  });

  it("should create engine with options", () => {
    const engine = createRecoveryEngine({
      maxRetries: 5,
      retryDelayMs: 3000,
    });
    expect(engine).toBeInstanceOf(RecoveryEngine);
  });
});
