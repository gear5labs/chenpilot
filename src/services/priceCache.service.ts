import Redis from "ioredis";
import config from "../config/config";
import logger from "../config/logger";

export interface PriceData {
  price: number;
  timestamp: number;
  source: string;
}

export class PriceCacheService {
  private redis: Redis;
  private readonly DEFAULT_TTL = 60; // 60 seconds default cache TTL

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
      logger.info("Redis connected successfully");
    });

    this.redis.on("error", (err) => {
      logger.error("Redis connection error:", err);
    });
  }

  /**
   * Generate cache key for asset pair
   */
  private getCacheKey(fromAsset: string, toAsset: string): string {
    return `price:${fromAsset.toUpperCase()}:${toAsset.toUpperCase()}`;
  }

  /**
   * Get cached price for asset pair
   */
  async getPrice(
    fromAsset: string,
    toAsset: string
  ): Promise<PriceData | null> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const cached = await this.redis.get(key);

      if (!cached) {
        return null;
      }

      const priceData: PriceData = JSON.parse(cached);
      logger.debug(`Cache hit for ${fromAsset}/${toAsset}: ${priceData.price}`);
      return priceData;
    } catch (error) {
      logger.error("Error getting cached price:", error);
      return null;
    }
  }

  /**
   * Set price in cache with TTL
   */
  async setPrice(
    fromAsset: string,
    toAsset: string,
    price: number,
    source: string,
    ttl: number = this.DEFAULT_TTL
  ): Promise<void> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const priceData: PriceData = {
        price,
        timestamp: Date.now(),
        source,
      };

      await this.redis.setex(key, ttl, JSON.stringify(priceData));
      logger.debug(
        `Cached price for ${fromAsset}/${toAsset}: ${price} (TTL: ${ttl}s)`
      );
    } catch (error) {
      logger.error("Error setting cached price:", error);
    }
  }

  /**
   * Get multiple prices at once
   */
  async getPrices(
    pairs: Array<{ from: string; to: string }>
  ): Promise<Map<string, PriceData | null>> {
    const results = new Map<string, PriceData | null>();

    try {
      const keys = pairs.map((pair) => this.getCacheKey(pair.from, pair.to));
      const values = await this.redis.mget(...keys);

      pairs.forEach((pair, index) => {
        const pairKey = `${pair.from}/${pair.to}`;
        const value = values[index];

        if (value) {
          results.set(pairKey, JSON.parse(value));
        } else {
          results.set(pairKey, null);
        }
      });
    } catch (error) {
      logger.error("Error getting multiple cached prices:", error);
    }

    return results;
  }

  /**
   * Invalidate cached price
   */
  async invalidatePrice(fromAsset: string, toAsset: string): Promise<void> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      await this.redis.del(key);
      logger.debug(`Invalidated cache for ${fromAsset}/${toAsset}`);
    } catch (error) {
      logger.error("Error invalidating cached price:", error);
    }
  }

  /**
   * Clear all price cache
   */
  async clearAll(): Promise<void> {
    try {
      const keys = await this.redis.keys("price:*");
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`Cleared ${keys.length} cached prices`);
      }
    } catch (error) {
      logger.error("Error clearing price cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    hitRate?: number;
  }> {
    try {
      const keys = await this.redis.keys("price:*");
      const info = await this.redis.info("memory");
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : "unknown";

      return {
        totalKeys: keys.length,
        memoryUsage,
      };
    } catch (error) {
      logger.error("Error getting cache stats:", error);
      return {
        totalKeys: 0,
        memoryUsage: "unknown",
      };
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    logger.info("Redis disconnected");
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error("Redis health check failed:", error);
      return false;
    }
  }
}

export default new PriceCacheService();
