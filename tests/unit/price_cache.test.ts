import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { PriceCacheService } from "../../src/services/priceCache.service";

describe("PriceCacheService", () => {
  let cacheService: PriceCacheService;

  beforeAll(() => {
    cacheService = new PriceCacheService();
  });

  afterAll(async () => {
    await cacheService.disconnect();
  });

  beforeEach(async () => {
    await cacheService.clearAll();
  });

  describe("setPrice and getPrice", () => {
    it("should cache and retrieve a price", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      const cached = await cacheService.getPrice("XLM", "USDC");

      expect(cached).not.toBeNull();
      expect(cached?.price).toBe(0.12);
      expect(cached?.source).toBe("stellar_dex");
      expect(cached?.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should return null for non-existent price", async () => {
      const cached = await cacheService.getPrice("XLM", "USDT");
      expect(cached).toBeNull();
    });

    it("should handle case-insensitive asset symbols", async () => {
      await cacheService.setPrice("xlm", "usdc", 0.12, "stellar_dex", 60);
      const cached = await cacheService.getPrice("XLM", "USDC");

      expect(cached).not.toBeNull();
      expect(cached?.price).toBe(0.12);
    });

    it("should expire after TTL", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 1);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const cached = await cacheService.getPrice("XLM", "USDC");
      expect(cached).toBeNull();
    }, 10000);
  });

  describe("getPrices", () => {
    it("should retrieve multiple prices at once", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      await cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);
      await cacheService.setPrice("USDC", "USDT", 0.99, "stellar_dex", 60);

      const pairs = [
        { from: "XLM", to: "USDC" },
        { from: "XLM", to: "USDT" },
        { from: "USDC", to: "USDT" },
      ];

      const results = await cacheService.getPrices(pairs);

      expect(results.size).toBe(3);
      expect(results.get("XLM/USDC")?.price).toBe(0.12);
      expect(results.get("XLM/USDT")?.price).toBe(0.11);
      expect(results.get("USDC/USDT")?.price).toBe(0.99);
    });

    it("should handle missing prices in batch", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);

      const pairs = [
        { from: "XLM", to: "USDC" },
        { from: "XLM", to: "USDT" },
      ];

      const results = await cacheService.getPrices(pairs);

      expect(results.size).toBe(2);
      expect(results.get("XLM/USDC")?.price).toBe(0.12);
      expect(results.get("XLM/USDT")).toBeNull();
    });
  });

  describe("invalidatePrice", () => {
    it("should invalidate a cached price", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);

      let cached = await cacheService.getPrice("XLM", "USDC");
      expect(cached).not.toBeNull();

      await cacheService.invalidatePrice("XLM", "USDC");

      cached = await cacheService.getPrice("XLM", "USDC");
      expect(cached).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("should clear all cached prices", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      await cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);

      await cacheService.clearAll();

      const cached1 = await cacheService.getPrice("XLM", "USDC");
      const cached2 = await cacheService.getPrice("XLM", "USDT");

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return cache statistics", async () => {
      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      await cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);

      const stats = await cacheService.getStats();

      expect(stats.totalKeys).toBe(2);
      expect(stats.memoryUsage).toBeDefined();
    });
  });

  describe("healthCheck", () => {
    it("should return true when Redis is connected", async () => {
      const healthy = await cacheService.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
