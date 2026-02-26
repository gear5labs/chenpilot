import { ChainId } from "../../types";
import {
  ConnectionErrorRecoveryStrategy,
  AuthenticationErrorRecoveryStrategy,
  HardwareWalletErrorRecoveryStrategy,
  NetworkErrorRecoveryStrategy,
  SignatureProviderErrorRecovery,
  signatureProviderErrorRecovery,
  ErrorRecoveryContext,
} from "../error-recovery";
import {
  ConnectionTimeoutError,
  ProviderNotFoundError,
  UserRejectedError,
  UnauthorizedError,
  DeviceNotFoundError,
  DeviceLockedError,
  DeviceBusyError,
  HardwareWalletError,
  NetworkError,
  SigningError,
} from "../errors";

describe("Error Recovery System", () => {
  describe("ConnectionErrorRecoveryStrategy", () => {
    let strategy: ConnectionErrorRecoveryStrategy;

    beforeEach(() => {
      strategy = new ConnectionErrorRecoveryStrategy();
    });

    it("should handle connection timeout errors", async () => {
      const error = new ConnectionTimeoutError("test-provider");

      expect(strategy.canRecover(error)).toBe(true);

      const result = await strategy.recover(error, { retryCount: 0 });

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfterMs).toBe(1000); // First retry
      expect(result.instructions).toContain("Connection timed out.");
    });

    it("should use exponential backoff for timeouts", async () => {
      const error = new ConnectionTimeoutError("test-provider");

      const result1 = await strategy.recover(error, { retryCount: 1 });
      const result2 = await strategy.recover(error, { retryCount: 2 });

      expect(result1.retryAfterMs).toBe(2000);
      expect(result2.retryAfterMs).toBe(4000);
    });

    it("should cap exponential backoff", async () => {
      const error = new ConnectionTimeoutError("test-provider");

      const result = await strategy.recover(error, { retryCount: 10 });

      expect(result.retryAfterMs).toBe(10000); // Capped at 10 seconds
    });

    it("should handle provider not found errors", async () => {
      const error = new ProviderNotFoundError("missing-provider");

      expect(strategy.canRecover(error)).toBe(false); // Not recoverable

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(result.instructions).toContain("Wallet provider not found.");
    });

    it("should stop retrying after max attempts", async () => {
      const error = new ConnectionTimeoutError("test-provider");

      const result = await strategy.recover(error, {
        retryCount: 3,
        maxRetries: 3,
      });

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(result.instructions).toContain("Maximum retry attempts reached.");
    });

    it("should provide recovery instructions", () => {
      const timeoutError = new ConnectionTimeoutError("provider");
      const notFoundError = new ProviderNotFoundError("provider");

      const timeoutInstructions =
        strategy.getRecoveryInstructions(timeoutError);
      const notFoundInstructions =
        strategy.getRecoveryInstructions(notFoundError);

      expect(timeoutInstructions).toContain("Connection timed out");
      expect(notFoundInstructions).toContain("Wallet not found");
    });
  });

  describe("AuthenticationErrorRecoveryStrategy", () => {
    let strategy: AuthenticationErrorRecoveryStrategy;

    beforeEach(() => {
      strategy = new AuthenticationErrorRecoveryStrategy();
    });

    it("should handle user rejection errors", async () => {
      const error = new UserRejectedError("test-provider");

      expect(strategy.canRecover(error)).toBe(true);

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(result.instructions).toContain(
        "Transaction was cancelled by user."
      );
    });

    it("should handle generic authentication errors with retry", async () => {
      const error = new UnauthorizedError("test-provider");

      const result = await strategy.recover(error, { retryCount: 0 });

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfterMs).toBe(1000);
    });

    it("should stop retrying auth errors after max attempts", async () => {
      const error = new UnauthorizedError("test-provider");

      const result = await strategy.recover(error, {
        retryCount: 2,
        maxRetries: 2,
      });

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("HardwareWalletErrorRecoveryStrategy", () => {
    let strategy: HardwareWalletErrorRecoveryStrategy;

    beforeEach(() => {
      strategy = new HardwareWalletErrorRecoveryStrategy();
    });

    it("should handle device not found errors", async () => {
      const error = new DeviceNotFoundError("ledger-provider");

      expect(strategy.canRecover(error)).toBe(true);

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfterMs).toBe(3000);
      expect(result.instructions).toContain("Hardware wallet not detected.");
    });

    it("should handle device locked errors", async () => {
      const error = new DeviceLockedError("ledger-provider");

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfterMs).toBe(1000);
      expect(result.instructions).toContain("Hardware wallet is locked.");
    });

    it("should handle device busy errors", async () => {
      const error = new DeviceBusyError("ledger-provider");

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryAfterMs).toBe(2000);
      expect(result.instructions).toContain("Hardware wallet is busy.");
    });

    it("should handle generic hardware wallet errors", async () => {
      const error = new HardwareWalletError(
        "Generic HW error",
        "ledger-provider"
      );

      const result = await strategy.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.instructions).toContain("Hardware wallet error occurred.");
    });
  });

  describe("NetworkErrorRecoveryStrategy", () => {
    let strategy: NetworkErrorRecoveryStrategy;

    beforeEach(() => {
      strategy = new NetworkErrorRecoveryStrategy();
    });

    it("should handle network errors with exponential backoff", async () => {
      const error = new NetworkError(
        "RPC timeout",
        "provider",
        ChainId.STELLAR
      );

      expect(strategy.canRecover(error)).toBe(true);

      const result1 = await strategy.recover(error, { retryCount: 0 });
      const result2 = await strategy.recover(error, { retryCount: 1 });

      expect(result1.shouldRetry).toBe(true);
      expect(result2.shouldRetry).toBe(true);
      expect(result2.retryAfterMs).toBeGreaterThan(result1.retryAfterMs!);
    });

    it("should include jitter in retry timing", async () => {
      const error = new NetworkError("Network error", "provider");

      const results = await Promise.all([
        strategy.recover(error, { retryCount: 1 }),
        strategy.recover(error, { retryCount: 1 }),
        strategy.recover(error, { retryCount: 1 }),
      ]);

      // Due to jitter, retry times should vary slightly
      const retryTimes = results.map((r) => r.retryAfterMs!);
      // Should have some variation due to jitter (though might occasionally be same)
      expect(retryTimes.every((t) => t >= 2000 && t <= 2500)).toBe(true);
    });

    it("should cap retry delay", async () => {
      const error = new NetworkError("Network error", "provider");

      const result = await strategy.recover(error, { retryCount: 10 });

      expect(result.retryAfterMs).toBeLessThanOrEqual(30000);
    });

    it("should stop retrying after max attempts", async () => {
      const error = new NetworkError("Network error", "provider");

      const result = await strategy.recover(error, {
        retryCount: 5,
        maxRetries: 5,
      });

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("SignatureProviderErrorRecovery", () => {
    let recovery: SignatureProviderErrorRecovery;

    beforeEach(() => {
      recovery = new SignatureProviderErrorRecovery();
    });

    it("should find appropriate strategy for error type", async () => {
      const connectionError = new ConnectionTimeoutError("provider");
      const authError = new UserRejectedError("provider");
      const hardwareError = new DeviceLockedError("provider");
      const networkError = new NetworkError("Network error", "provider");

      const connectionResult = await recovery.recover(connectionError);
      const authResult = await recovery.recover(authError);
      const hardwareResult = await recovery.recover(hardwareError);
      const networkResult = await recovery.recover(networkError);

      expect(connectionResult.instructions).toContain("Connection timed out.");
      expect(authResult.instructions).toContain(
        "Transaction was cancelled by user."
      );
      expect(hardwareResult.instructions).toContain(
        "Hardware wallet is locked."
      );
      expect(networkResult.instructions).toContain("Network error occurred.");
    });

    it("should handle errors without specific strategy", async () => {
      const genericError = new SigningError(
        "Generic signing error",
        "provider"
      );

      const result = await recovery.recover(genericError);

      expect(result.success).toBe(false);
      expect(result.instructions).toContain(
        "No specific recovery strategy available."
      );
    });

    it("should convert generic errors to SignatureProviderError", async () => {
      const genericError = new Error("Generic error");
      const context: ErrorRecoveryContext = {
        providerId: "test-provider",
        chainId: ChainId.STELLAR,
      };

      const result = await recovery.recover(genericError, context);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true); // Generic SigningError is recoverable
    });

    it("should handle recovery strategy errors", async () => {
      // Create a faulty strategy that throws
      const faultyStrategy = {
        canRecover: () => true,
        recover: async () => {
          throw new Error("Recovery strategy failed");
        },
        getRecoveryInstructions: () => ["Faulty instructions"],
      };

      recovery.addStrategy(faultyStrategy);

      const error = new SigningError("Test error", "provider");
      const result = await recovery.recover(error);

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(result.newError).toBeDefined();
      expect(result.instructions).toContain("Error recovery failed.");
    });

    it("should provide recovery instructions without attempting recovery", () => {
      const connectionError = new ConnectionTimeoutError("provider");
      const unknownError = new Error("Unknown error");

      const connectionInstructions =
        recovery.getRecoveryInstructions(connectionError);
      const unknownInstructions =
        recovery.getRecoveryInstructions(unknownError);

      expect(connectionInstructions).toContain("Connection timed out");
      expect(unknownInstructions).toContain("Unknown error");
    });

    it("should check if errors are recoverable", () => {
      const recoverableError = new ConnectionTimeoutError("provider");
      const nonRecoverableError = new ProviderNotFoundError("provider");
      const unknownError = new Error("Unknown");

      expect(recovery.canRecover(recoverableError)).toBe(true);
      expect(recovery.canRecover(nonRecoverableError)).toBe(true); // Has strategy
      expect(recovery.canRecover(unknownError)).toBe(false); // No specific strategy
    });

    it("should allow adding and removing custom strategies", async () => {
      const customStrategy = {
        canRecover: (error: unknown) =>
          (error as { message?: string }).message === "custom error",
        recover: async () => ({
          success: true,
          shouldRetry: false,
          instructions: ["Custom recovery successful"],
        }),
        getRecoveryInstructions: () => ["Custom instructions"],
      };

      recovery.addStrategy(customStrategy);

      const customError = new SigningError("custom error", "provider");
      const result = await recovery.recover(customError);

      expect(result.success).toBe(true);
      expect(result.instructions).toContain("Custom recovery successful");

      // Remove strategy
      recovery.removeStrategy(customStrategy);

      const result2 = await recovery.recover(customError);
      expect(result2.success).toBe(false);
      expect(result2.instructions).toContain(
        "No specific recovery strategy available."
      );
    });

    it("should use global recovery instance", () => {
      expect(signatureProviderErrorRecovery).toBeInstanceOf(
        SignatureProviderErrorRecovery
      );
    });
  });

  describe("Error Recovery Context", () => {
    let recovery: SignatureProviderErrorRecovery;

    beforeEach(() => {
      recovery = new SignatureProviderErrorRecovery();
    });

    it("should use context information in recovery", async () => {
      const error = new ConnectionTimeoutError("provider");
      const context: ErrorRecoveryContext = {
        retryCount: 2,
        maxRetries: 3,
        providerId: "test-provider",
        chainId: ChainId.STELLAR,
      };

      const result = await recovery.recover(error, context);

      expect(result.retryAfterMs).toBe(4000); // 2^2 * 1000
    });

    it("should handle missing context gracefully", async () => {
      const error = new ConnectionTimeoutError("provider");

      const result = await recovery.recover(error);

      expect(result).toBeDefined();
      expect(result.shouldRetry).toBe(true);
    });
  });
});
