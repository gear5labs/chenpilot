import { withTimeout, TimeoutError, TimeoutManager } from "../../src/utils/timeout";

describe("Timeout Utility", () => {
  describe("withTimeout", () => {
    it("should resolve when promise completes within timeout", async () => {
      const promise = Promise.resolve("success");
      const result = await withTimeout(promise, {
        timeoutMs: 1000,
        operation: "test_operation",
      });

      expect(result).toBe("success");
    });

    it("should reject with TimeoutError when promise exceeds timeout", async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));

      await expect(
        withTimeout(promise, {
          timeoutMs: 100,
          operation: "slow_operation",
        })
      ).rejects.toThrow(TimeoutError);
    });

    it("should call onTimeout callback when timeout occurs", async () => {
      const onTimeout = jest.fn();
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        await withTimeout(promise, {
          timeoutMs: 100,
          operation: "test_operation",
          onTimeout,
        });
      } catch (error) {
        // Expected to throw
      }

      expect(onTimeout).toHaveBeenCalled();
    });

    it("should include operation name in TimeoutError", async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        await withTimeout(promise, {
          timeoutMs: 100,
          operation: "custom_operation",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        if (error instanceof TimeoutError) {
          expect(error.operation).toBe("custom_operation");
          expect(error.timeoutMs).toBe(100);
        }
      }
    });

    it("should handle promise rejection", async () => {
      const promise = Promise.reject(new Error("Test error"));

      await expect(
        withTimeout(promise, {
          timeoutMs: 1000,
          operation: "failing_operation",
        })
      ).rejects.toThrow("Test error");
    });

    it("should abort when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const promise = Promise.resolve("success");

      await expect(
        withTimeout(promise, {
          timeoutMs: 1000,
          operation: "aborted_operation",
          signal: controller.signal,
        })
      ).rejects.toThrow(TimeoutError);
    });

    it("should abort when signal is aborted during execution", async () => {
      const controller = new AbortController();
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));

      setTimeout(() => controller.abort(), 100);

      await expect(
        withTimeout(promise, {
          timeoutMs: 5000,
          operation: "abort_during_execution",
          signal: controller.signal,
        })
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe("TimeoutManager", () => {
    let manager: TimeoutManager;

    beforeEach(() => {
      manager = new TimeoutManager();
    });

    it("should execute operation successfully", async () => {
      const promise = Promise.resolve("success");
      const result = await manager.execute("op1", promise, {
        timeoutMs: 1000,
        operation: "test_operation",
      });

      expect(result).toBe("success");
      expect(manager.isActive("op1")).toBe(false);
    });

    it("should track active operations", async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 1000));
      const execution = manager.execute("op1", promise, {
        timeoutMs: 2000,
        operation: "test_operation",
      });

      expect(manager.isActive("op1")).toBe(true);
      expect(manager.getActiveOperations()).toContain("op1");

      await execution;

      expect(manager.isActive("op1")).toBe(false);
    });

    it("should abort specific operation", async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));
      const execution = manager.execute("op1", promise, {
        timeoutMs: 5000,
        operation: "test_operation",
      });

      setTimeout(() => manager.abort("op1"), 100);

      await expect(execution).rejects.toThrow(TimeoutError);
      expect(manager.isActive("op1")).toBe(false);
    });

    it("should abort all operations", async () => {
      const promise1 = new Promise((resolve) => setTimeout(resolve, 2000));
      const promise2 = new Promise((resolve) => setTimeout(resolve, 2000));

      const execution1 = manager.execute("op1", promise1, {
        timeoutMs: 5000,
        operation: "operation_1",
      });

      const execution2 = manager.execute("op2", promise2, {
        timeoutMs: 5000,
        operation: "operation_2",
      });

      expect(manager.getActiveOperations()).toHaveLength(2);

      manager.abortAll();

      await expect(execution1).rejects.toThrow(TimeoutError);
      await expect(execution2).rejects.toThrow(TimeoutError);
      expect(manager.getActiveOperations()).toHaveLength(0);
    });

    it("should return false when aborting non-existent operation", () => {
      const result = manager.abort("non_existent");
      expect(result).toBe(false);
    });

    it("should handle multiple operations with same ID sequentially", async () => {
      const promise1 = Promise.resolve("first");
      const result1 = await manager.execute("op1", promise1, {
        timeoutMs: 1000,
        operation: "first_operation",
      });

      expect(result1).toBe("first");

      const promise2 = Promise.resolve("second");
      const result2 = await manager.execute("op1", promise2, {
        timeoutMs: 1000,
        operation: "second_operation",
      });

      expect(result2).toBe("second");
    });
  });

  describe("TimeoutError", () => {
    it("should create error with correct properties", () => {
      const error = new TimeoutError("Test timeout", "test_op", 5000);

      expect(error.name).toBe("TimeoutError");
      expect(error.message).toBe("Test timeout");
      expect(error.operation).toBe("test_op");
      expect(error.timeoutMs).toBe(5000);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
