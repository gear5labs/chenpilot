import { RedisLockService } from "../../src/services/lock/redisLock.service";

// Mock Redis for testing
const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  ttl: jest.fn(),
  eval: jest.fn(),
  pipeline: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
};

// Mock the Redis module
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

describe("RedisLockService", () => {
  let lockService: RedisLockService;

  beforeEach(() => {
    jest.clearAllMocks();
    lockService = new RedisLockService();
  });

  afterEach(async () => {
    await lockService.disconnect();
  });

  describe("acquireLock", () => {
    it("should acquire lock successfully on first attempt", async () => {
      mockRedis.set.mockResolvedValue("OK");

      const result = await lockService.acquireLock("resource1", "user1");

      expect(result.acquired).toBe(true);
      expect(result.lockKey).toBe("lock:resource1");
      expect(result.lockValue).toBeDefined();
      expect(result.ttl).toBe(30000);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "lock:resource1",
        expect.stringMatching(/^user1:[a-f0-9-]+:\d+$/),
        "EX",
        30,
        "NX"
      );
    });

    it("should fail to acquire lock after max retries", async () => {
      mockRedis.set.mockResolvedValue(null);

      const result = await lockService.acquireLock("resource1", "user1", {
        maxRetries: 3,
        retryDelay: 10,
      });

      expect(result.acquired).toBe(false);
      expect(result.lockKey).toBe("lock:resource1");
      expect(result.error).toBe("Maximum retry attempts exceeded");
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });

    it("should handle Redis errors during acquisition", async () => {
      mockRedis.set.mockRejectedValue(new Error("Redis connection failed"));

      const result = await lockService.acquireLock("resource1", "user1", {
        maxRetries: 2,
        retryDelay: 10,
      });

      expect(result.acquired).toBe(false);
      expect(result.error).toBe("Redis connection failed");
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });

    it("should use custom TTL when provided", async () => {
      mockRedis.set.mockResolvedValue("OK");

      const result = await lockService.acquireLock("resource1", "user1", {
        ttl: 60000,
      });

      expect(result.acquired).toBe(true);
      expect(result.ttl).toBe(60000);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "lock:resource1",
        expect.any(String),
        "EX",
        60,
        "NX"
      );
    });
  });

  describe("releaseLock", () => {
    it("should release lock successfully when owned by identifier", async () => {
      mockRedis.eval.mockResolvedValue(1);

      const result = await lockService.releaseLock("resource1", "user1");

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("local key = KEYS[1]"),
        1,
        "lock:resource1",
        "user1"
      );
    });

    it("should fail to release lock when not owned by identifier", async () => {
      mockRedis.eval.mockResolvedValue(0);

      const result = await lockService.releaseLock("resource1", "user1");

      expect(result).toBe(false);
    });

    it("should handle Redis errors during release", async () => {
      mockRedis.eval.mockRejectedValue(new Error("Redis error"));

      const result = await lockService.releaseLock("resource1", "user1");

      expect(result).toBe(false);
    });
  });

  describe("extendLock", () => {
    it("should extend lock successfully when owned by identifier", async () => {
      mockRedis.eval.mockResolvedValue(1);

      const result = await lockService.extendLock("resource1", "user1", 45000);

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("local ttl = ARGV[2]"),
        1,
        "lock:resource1",
        "user1",
        45
      );
    });

    it("should fail to extend lock when not owned by identifier", async () => {
      mockRedis.eval.mockResolvedValue(0);

      const result = await lockService.extendLock("resource1", "user1", 45000);

      expect(result).toBe(false);
    });

    it("should handle Redis errors during extension", async () => {
      mockRedis.eval.mockRejectedValue(new Error("Redis error"));

      const result = await lockService.extendLock("resource1", "user1", 45000);

      expect(result).toBe(false);
    });
  });

  describe("isLocked", () => {
    it("should return true when resource is locked", async () => {
      mockRedis.exists.mockResolvedValue(1);

      const result = await lockService.isLocked("resource1");

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith("lock:resource1");
    });

    it("should return false when resource is not locked", async () => {
      mockRedis.exists.mockResolvedValue(0);

      const result = await lockService.isLocked("resource1");

      expect(result).toBe(false);
    });

    it("should handle Redis errors during check", async () => {
      mockRedis.exists.mockRejectedValue(new Error("Redis error"));

      const result = await lockService.isLocked("resource1");

      expect(result).toBe(false);
    });
  });

  describe("getLockInfo", () => {
    it("should return lock info when lock exists", async () => {
      const mockValue =
        "user1:550e8400-e29b-41d4-a716-446655440000:1640995200000";
      mockRedis.pipeline = jest.fn().mockReturnValue({
        get: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, mockValue],
          [null, 45],
        ]),
      });

      const result = await lockService.getLockInfo("resource1");

      expect(result).toEqual({
        key: "resource1",
        value: mockValue,
        ttl: 45000,
        createdAt: 1640995200000,
      });
    });

    it("should return null when lock does not exist", async () => {
      mockRedis.pipeline = jest.fn().mockReturnValue({
        get: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, null],
          [null, -2],
        ]),
      });

      const result = await lockService.getLockInfo("resource1");

      expect(result).toBeNull();
    });

    it("should handle Redis errors during info retrieval", async () => {
      mockRedis.pipeline = jest.fn().mockReturnValue({
        get: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error("Redis error")),
      });

      const result = await lockService.getLockInfo("resource1");

      expect(result).toBeNull();
    });
  });

  describe("healthCheck", () => {
    it("should return true when Redis is healthy", async () => {
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await lockService.healthCheck();

      expect(result).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it("should return false when Redis is unhealthy", async () => {
      mockRedis.ping.mockRejectedValue(new Error("Redis down"));

      const result = await lockService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete lock lifecycle", async () => {
      // Acquire lock
      mockRedis.set.mockResolvedValue("OK");
      const acquireResult = await lockService.acquireLock("resource1", "user1");
      expect(acquireResult.acquired).toBe(true);

      // Check if locked
      mockRedis.exists.mockResolvedValue(1);
      const isLocked = await lockService.isLocked("resource1");
      expect(isLocked).toBe(true);

      // Extend lock
      mockRedis.eval.mockResolvedValue(1);
      const extended = await lockService.extendLock(
        "resource1",
        "user1",
        45000
      );
      expect(extended).toBe(true);

      // Release lock
      mockRedis.eval.mockResolvedValue(1);
      const released = await lockService.releaseLock("resource1", "user1");
      expect(released).toBe(true);

      // Check if unlocked
      mockRedis.exists.mockResolvedValue(0);
      const isStillLocked = await lockService.isLocked("resource1");
      expect(isStillLocked).toBe(false);
    });

    it("should prevent concurrent access to same resource", async () => {
      // First user acquires lock
      mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

      const user1Result = await lockService.acquireLock("resource1", "user1", {
        maxRetries: 1,
        retryDelay: 10,
      });
      expect(user1Result.acquired).toBe(true);

      // Second user fails to acquire same lock
      const user2Result = await lockService.acquireLock("resource1", "user2", {
        maxRetries: 1,
        retryDelay: 10,
      });
      expect(user2Result.acquired).toBe(false);
    });
  });
});
