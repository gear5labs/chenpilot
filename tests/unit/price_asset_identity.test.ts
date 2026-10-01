/**
 * Regression tests for issuer-qualified pricing — Issue #832
 *
 * Two assets can share a code and differ only by issuer. Prices are per asset,
 * so a quote must carry the issuer it was resolved for and must never be
 * cached or served under another issuer's identity.
 */

import * as redisModule from "../../src/services/redis/client";
import priceCacheService from "../../src/services/priceCache.service";
import {
  AssetIssuerMismatchError,
  StellarPriceService,
} from "../../src/services/stellarPrice.service";

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return { __esModule: true, ...actual };
});

jest.mock("../../src/services/redis/client", () => {
  const redis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  return {
    __esModule: true,
    getRedisClient: jest.fn(() => redis),
    disconnectRedis: jest.fn().mockResolvedValue(undefined),
    healthCheckRedis: jest.fn().mockResolvedValue(true),
    __mockRedis: redis,
  };
});

interface RedisMock {
  get: jest.Mock;
  setex: jest.Mock;
  del: jest.Mock;
}

const mockRedis = (redisModule as unknown as { __mockRedis: RedisMock })
  .__mockRedis;

// Issuers the price service actually prices.
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDT_ISSUER = "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V";
// A real, different account — i.e. another issuer of a USDC-labelled asset.
const OTHER_USDC_ISSUER =
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

type ServerWithPaths = {
  strictSendPaths: jest.Mock;
};

function stubLivePath(service: StellarPriceService, destinationAmount: string) {
  const server = (service as unknown as { server: ServerWithPaths }).server;
  server.strictSendPaths = jest.fn().mockReturnValue({
    call: jest.fn().mockResolvedValue({
      records: [{ destination_amount: destinationAmount, path: [] }],
    }),
  });
}

describe("price cache wiring", () => {
  it("exposes the shared cache as the module's default export", () => {
    // Without a default export the price service's cache reads resolve to
    // `undefined` and every lookup throws before it reaches Horizon.
    expect(typeof priceCacheService.getPrice).toBe("function");
    expect(typeof priceCacheService.setPrice).toBe("function");
    expect(typeof priceCacheService.invalidatePrice).toBe("function");
  });
});

describe("issuer-qualified price identity", () => {
  let service: StellarPriceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    service = new StellarPriceService();
    stubLivePath(service, "5");
  });

  it("echoes the issuers the quote was actually priced for", async () => {
    const quote = await service.getPrice("USDC", "XLM", 10);

    expect(quote.validity.valid).toBe(true);
    expect(quote.price).toBe(0.5);
    expect(quote.fromIssuer).toBe(USDC_ISSUER);
    expect(quote.toIssuer).toBeUndefined();
  });

  it("keeps the historical cache key for callers that supply no issuer", async () => {
    await service.getPrice("USDC", "XLM", 10);

    expect(mockRedis.get).toHaveBeenCalledWith("price:USDC:XLM");
    expect(mockRedis.setex).toHaveBeenCalledWith(
      "price:USDC:XLM",
      60,
      expect.any(String)
    );
  });

  it("keys the cache by issuer when the caller supplies one", async () => {
    await service.getPrice("USDC", "XLM", 10, { fromIssuer: USDC_ISSUER });

    const key = `price:USDC:${USDC_ISSUER}:XLM`;
    expect(mockRedis.get).toHaveBeenCalledWith(key);
    expect(mockRedis.setex).toHaveBeenCalledWith(key, 60, expect.any(String));
  });

  it("serves a cached price only to the issuer it belongs to", async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        price: 0.4,
        timestamp: Date.now(),
        source: "stellar_dex",
      })
    );

    const quote = await service.getPrice("USDC", "XLM", 10, {
      fromIssuer: USDC_ISSUER,
    });

    expect(quote.cached).toBe(true);
    expect(quote.price).toBe(0.4);
    expect(quote.fromIssuer).toBe(USDC_ISSUER);
    expect(mockRedis.get).toHaveBeenCalledWith(`price:USDC:${USDC_ISSUER}:XLM`);
  });

  it("rejects an issuer that does not issue the priced asset", async () => {
    const quote = await service.getPrice("USDC", "XLM", 10, {
      fromIssuer: OTHER_USDC_ISSUER,
    });

    expect(quote.validity.valid).toBe(false);
    expect(quote.validity.reason).toBe("issuer_mismatch");
    expect(quote.price).toBe(0);
    expect(quote.fromIssuer).toBe(OTHER_USDC_ISSUER);
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.setex).not.toHaveBeenCalled();
  });

  it("rejects a native asset requested with an issuer", async () => {
    const quote = await service.getPrice("XLM", "USDT", 1, {
      fromIssuer: USDC_ISSUER,
    });

    expect(quote.validity.valid).toBe(false);
    expect(quote.validity.reason).toBe("issuer_mismatch");
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it("accepts a quote request that names the right issuers", async () => {
    const quote = await service.getPrice("USDC", "USDT", 1, {
      fromIssuer: USDC_ISSUER,
      toIssuer: USDT_ISSUER,
    });

    expect(quote.validity.valid).toBe(true);
    expect(quote.fromIssuer).toBe(USDC_ISSUER);
    expect(quote.toIssuer).toBe(USDT_ISSUER);
    expect(mockRedis.setex).toHaveBeenCalledWith(
      `price:USDC:${USDC_ISSUER}:USDT:${USDT_ISSUER}`,
      60,
      expect.any(String)
    );
  });

  it("forwards each pair's issuer through the batch API", async () => {
    await service.getPrices([
      { from: "USDC", to: "XLM", amount: 2, fromIssuer: USDC_ISSUER },
      { from: "USDT", to: "XLM", amount: 3 },
    ]);

    const readKeys = mockRedis.get.mock.calls.map((call) => call[0]);
    expect(readKeys).toContain(`price:USDC:${USDC_ISSUER}:XLM`);
    expect(readKeys).toContain("price:USDT:XLM");

    const writtenKeys = mockRedis.setex.mock.calls.map((call) => call[0]);
    expect(writtenKeys).toContain(`price:USDC:${USDC_ISSUER}:XLM`);
    expect(writtenKeys).toContain("price:USDT:XLM");
  });

  it("invalidates the entry that belongs to the issuer", async () => {
    await service.invalidatePrice("USDC", "XLM", { fromIssuer: USDC_ISSUER });
    await service.invalidatePrice("USDC", "XLM");

    expect(mockRedis.del).toHaveBeenCalledWith(`price:USDC:${USDC_ISSUER}:XLM`);
    expect(mockRedis.del).toHaveBeenCalledWith("price:USDC:XLM");
  });

  it("names both issuers on an AssetIssuerMismatchError", () => {
    const error = new AssetIssuerMismatchError(
      "USDC",
      OTHER_USDC_ISSUER,
      USDC_ISSUER
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AssetIssuerMismatchError");
    expect(error.assetCode).toBe("USDC");
    expect(error.requestedIssuer).toBe(OTHER_USDC_ISSUER);
    expect(error.actualIssuer).toBe(USDC_ISSUER);
    expect(error.message).toContain(USDC_ISSUER);
    expect(error.message).toContain(OTHER_USDC_ISSUER);
  });
});
