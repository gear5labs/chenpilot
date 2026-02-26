import Redis from "ioredis";
import { randomUUID } from "crypto";
import config from "../../config/config";
import logger from "../../config/logger";
import { LockOptions, LockResult, LockInfo, LockService } from "./types";

export class RedisLockService implements LockService {
  private redis: Redis;
  private readonly DEFAULT_TTL = 30000; // 30 seconds
  private readonly DEFAULT_RETRY_DELAY = 100; // 100ms
  private readonly DEFAULT_MAX_RETRIES = 10;

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.redis.on("connect", () => {
      logger.info("Redis lock service connected successfully");
    });

    this.redis.on("error", (err: Error) => {
      logger.error("Redis lock service connection error:", err);
    });
  }

  /**
   * Generate a unique lock key for a resource
   */
  private getLockKey(resourceKey: string): string {
    return `lock:${resourceKey}`;
  }

  /**
   * Generate a unique lock value
   */
  private generateLockValue(identifier: string): string {
    return `${identifier}:${randomUUID()}:${Date.now()}`;
  }

  /**
   * Acquire a distributed lock using Redis SET with NX and EX options
   */
  async acquireLock(
    resourceKey: string,
    identifier: string,
    options: LockOptions = {}
  ): Promise<LockResult> {
    const {
      ttl = this.DEFAULT_TTL,
      retryDelay = this.DEFAULT_RETRY_DELAY,
      maxRetries = this.DEFAULT_MAX_RETRIES,
    } = options;

    const lockKey = this.getLockKey(resourceKey);
    const lockValue = this.generateLockValue(identifier);
    const ttlSeconds = Math.ceil(ttl / 1000);

    logger.debug("Attempting to acquire lock", {
      resourceKey,
      identifier,
      ttl,
      maxRetries,
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use Redis SET with NX (only if not exists) and EX (expire) options
        const result = await this.redis.set(
          lockKey,
          lockValue,
          "EX",
          ttlSeconds,
          "NX"
        );

        if (result === "OK") {
          logger.info("Lock acquired successfully", {
            resourceKey,
            identifier,
            attempt,
            ttl,
          });

          return {
            acquired: true,
            lockKey,
            lockValue,
            ttl,
          };
        }

        logger.debug("Lock acquisition failed, retrying", {
          resourceKey,
          identifier,
          attempt,
          maxRetries,
        });

        // Wait before retry (except on last attempt)
        if (attempt < maxRetries) {
          await this.delay(retryDelay);
        }
      } catch (error) {
        logger.error("Error during lock acquisition", {
          resourceKey,
          identifier,
          attempt,
          error,
        });

        if (attempt === maxRetries) {
          return {
            acquired: false,
            lockKey,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }

        await this.delay(retryDelay);
      }
    }

    logger.warn("Failed to acquire lock after max retries", {
      resourceKey,
      identifier,
      maxRetries,
    });

    return {
      acquired: false,
      lockKey,
      error: "Maximum retry attempts exceeded",
    };
  }

  /**
   * Release a distributed lock using Lua script for atomicity
   */
  async releaseLock(resourceKey: string, identifier: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    // Lua script for atomic lock release
    // Only releases the lock if it exists and belongs to the same identifier
    const luaScript = `
      local key = KEYS[1]
      local identifier = ARGV[1]
      
      local lockValue = redis.call('GET', key)
      if not lockValue then
        return 0
      end
      
      if string.match(lockValue, '^' .. identifier .. ':') then
        return redis.call('DEL', key)
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(luaScript, 1, lockKey, identifier);

      const released = result === 1;

      if (released) {
        logger.info("Lock released successfully", {
          resourceKey,
          identifier,
        });
      } else {
        logger.warn("Lock release failed", {
          resourceKey,
          identifier,
          reason: "Lock not found or not owned by identifier",
        });
      }

      return released;
    } catch (error) {
      logger.error("Error during lock release", {
        resourceKey,
        identifier,
        error,
      });
      return false;
    }
  }

  /**
   * Extend the TTL of an existing lock
   */
  async extendLock(
    resourceKey: string,
    identifier: string,
    ttl: number
  ): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);
    const ttlSeconds = Math.ceil(ttl / 1000);

    // Lua script for atomic lock extension
    // Only extends the lock if it exists and belongs to the same identifier
    const luaScript = `
      local key = KEYS[1]
      local identifier = ARGV[1]
      local ttl = ARGV[2]
      
      local lockValue = redis.call('GET', key)
      if not lockValue then
        return 0
      end
      
      if string.match(lockValue, '^' .. identifier .. ':') then
        return redis.call('EXPIRE', key, ttl)
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        1,
        lockKey,
        identifier,
        ttlSeconds
      );

      const extended = result === 1;

      if (extended) {
        logger.info("Lock extended successfully", {
          resourceKey,
          identifier,
          ttl,
        });
      } else {
        logger.warn("Lock extension failed", {
          resourceKey,
          identifier,
          ttl,
          reason: "Lock not found or not owned by identifier",
        });
      }

      return extended;
    } catch (error) {
      logger.error("Error during lock extension", {
        resourceKey,
        identifier,
        ttl,
        error,
      });
      return false;
    }
  }

  /**
   * Check if a resource is currently locked
   */
  async isLocked(resourceKey: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const result = await this.redis.exists(lockKey);
      return result === 1;
    } catch (error) {
      logger.error("Error checking lock status", {
        resourceKey,
        error,
      });
      return false;
    }
  }

  /**
   * Get information about a lock
   */
  async getLockInfo(resourceKey: string): Promise<LockInfo | null> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const [value, ttl] = await this.redis
        .pipeline()
        .get(lockKey)
        .ttl(lockKey)
        .exec();

      if (!value || !value[1]) {
        return null;
      }

      const lockValue = value[1] as string;
      const lockTtl = ttl[1] as number;

      // Parse timestamp from lock value
      const parts = lockValue.split(":");
      const timestamp = parseInt(parts[parts.length - 1]);

      return {
        key: resourceKey,
        value: lockValue,
        ttl: lockTtl > 0 ? lockTtl * 1000 : 0, // Convert to milliseconds
        createdAt: timestamp || Date.now(),
      };
    } catch (error) {
      logger.error("Error getting lock info", {
        resourceKey,
        error,
      });
      return null;
    }
  }

  /**
   * Utility function to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    logger.info("Redis lock service disconnected");
  }

  /**
   * Health check for the lock service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error("Redis lock service health check failed:", error);
      return false;
    }
  }
}
