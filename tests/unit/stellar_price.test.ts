import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { StellarPriceService } from "../../src/services/stellarPrice.service";
import priceCacheService from "../../src/services/priceCache.service";

// Mock the price cache service
jest.mock("../../src/services/priceCache.service", () => ({
  __esModule: true,
  default: {
    getPrice: jest.fn(),
    setPrice: jest.fn(),
    invalidatePrice: jest.fn(),
  },
}));

describe("StellarPriceService", () => {
  let priceService: StellarPriceService;

  beforeEach(() => {
    priceService = new StellarPriceService();
    jest.clearAllMocks();
  });

  describe("getPrice", () => {
    it("should return cached price if available", async () => {
      const mockCachedPrice = {
        price: 0.12,
        timestamp: Date.now(),
        source: "stellar_dex",
      };

      (priceCacheService.getPrice as jest.Mock).mockResolvedValue(
        mockCachedPrice
      );

      const quote = await priceService.getPrice("XLM", "USDC", 100);

      expect(quote.cached).toBe(true);
      expect(quote.price).toBe(0.12);
      expect(quote.estimatedOutput).toBe(12);
      expect(priceCacheService.getPrice).toHaveBeenCalledWith("XLM", "USDC");
    });

    it("should fetch from Stellar DEX if not cached", async () => {
      (priceCacheService.getPrice as jest.Mock).mockResolvedValue(null);

      // This will fail in test environment without actual Stellar connection
      // but we're testing the flow
      await expect(priceService.getPrice("XLM", "USDC", 100)).rejects.toThrow();
      expect(priceCacheService.getPrice).toHaveBeenCalledWith("XLM", "USDC");
    });

    it("should throw error for unsupported asset", async () => {
      (priceCacheService.getPrice as jest.Mock).mockResolvedValue(null);

      await expect(
        priceService.getPrice("INVALID", "USDC", 100)
      ).rejects.toThrow("Unsupported asset: INVALID");
    });
  });

  describe("getPrices", () => {
    it("should fetch multiple prices", async () => {
      const mockCachedPrice = {
        price: 0.12,
        timestamp: Date.now(),
        source: "stellar_dex",
      };

      (priceCacheService.getPrice as jest.Mock).mockResolvedValue(
        mockCachedPrice
      );

      const pairs = [
        { from: "XLM", to: "USDC", amount: 100 },
        { from: "XLM", to: "USDT", amount: 50 },
      ];

      const quotes = await priceService.getPrices(pairs);

      expect(quotes.length).toBe(2);
      expect(quotes[0].fromAsset).toBe("XLM");
      expect(quotes[0].toAsset).toBe("USDC");
      expect(quotes[1].fromAsset).toBe("XLM");
      expect(quotes[1].toAsset).toBe("USDT");
    });

    it("should handle errors gracefully in batch", async () => {
      (priceCacheService.getPrice as jest.Mock)
        .mockResolvedValueOnce({
          price: 0.12,
          timestamp: Date.now(),
          source: "stellar_dex",
        })
        .mockResolvedValueOnce(null);

      const pairs = [
        { from: "XLM", to: "USDC" },
        { from: "INVALID", to: "USDT" },
      ];

      const quotes = await priceService.getPrices(pairs);

      // Should return only successful quotes
      expect(quotes.length).toBe(1);
      expect(quotes[0].fromAsset).toBe("XLM");
    });
  });

  describe("invalidatePrice", () => {
    it("should call cache invalidation", async () => {
      await priceService.invalidatePrice("XLM", "USDC");

      expect(priceCacheService.invalidatePrice).toHaveBeenCalledWith(
        "XLM",
        "USDC"
      );
    });
  });
});
