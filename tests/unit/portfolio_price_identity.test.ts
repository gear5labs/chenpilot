/**
 * Regression tests for issuer identity in portfolio pricing — Issue #832
 *
 * Portfolio holdings carry an issuer. Pricing used to pass only the asset
 * code, so a same-coded asset from another issuer could be priced as if it
 * were this holding. The issuer now travels with the request, and a quote the
 * price service refuses on identity grounds leaves the holding's value
 * unresolved instead of attributing someone else's price to it.
 */

import { PortfolioService } from "../../src/services/portfolioService";
import stellarPriceService from "../../src/services/stellarPrice.service";

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    __esModule: true,
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn(() => ({})),
    },
  };
});

jest.mock("../../src/services/stellarPrice.service", () => ({
  __esModule: true,
  default: { getPrice: jest.fn() },
  StellarPriceService: class {},
  AssetIssuerMismatchError: class extends Error {},
}));

const mockGetPrice = stellarPriceService.getPrice as jest.Mock;

const ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_USDC_ISSUER =
  "GAREEL23QVJ4UZVQKQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2ZQ2Z";

function stubAccount(service: PortfolioService, balances: unknown[]) {
  (service as unknown as { server: Record<string, unknown> }).server = {
    accounts: jest.fn().mockReturnValue({
      accountId: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ balances }),
      }),
    }),
  };
}

function creditBalance(code: string, issuer: string, balance: string) {
  return {
    asset_type: "credit_alphanum4",
    asset_code: code,
    asset_issuer: issuer,
    balance,
    limit: "10000",
  };
}

function nativeBalance(balance: string) {
  return { asset_type: "native", balance };
}

function validQuote(estimatedOutput: number, fromIssuer?: string) {
  return {
    price: estimatedOutput,
    estimatedOutput,
    validity: { valid: true, ageMs: 0, expiresAt: Date.now() + 60_000 },
    ...(fromIssuer ? { fromIssuer } : {}),
  };
}

function invalidQuote(reason: string) {
  return {
    price: 0,
    estimatedOutput: 0,
    validity: { valid: false, reason, ageMs: 0, expiresAt: Date.now() },
  };
}

describe("portfolio pricing keeps the issuer identity", () => {
  let service: PortfolioService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PortfolioService();
  });

  it("prices a holding under its own issuer", async () => {
    stubAccount(service, [
      nativeBalance("100"),
      creditBalance("USDC", USDC_ISSUER, "5"),
    ]);
    mockGetPrice.mockImplementation(
      async (
        _from: string,
        _to: string,
        _amount: number,
        identity?: { fromIssuer?: string }
      ) =>
        identity?.fromIssuer === USDC_ISSUER
          ? validQuote(10, USDC_ISSUER)
          : validQuote(100)
    );

    const summary = await service.getPortfolio(ACCOUNT, "USD");

    expect(mockGetPrice).toHaveBeenCalledWith("USDC", "USD", 5, {
      fromIssuer: USDC_ISSUER,
    });
    expect(mockGetPrice).toHaveBeenCalledWith("XLM", "USD", 100, {});

    const usdc = summary.assets.find((asset) => asset.code === "USDC");
    expect(usdc?.issuer).toBe(USDC_ISSUER);
    expect(usdc?.valueInCurrency).toBe(10);
    expect(summary.totalValue).toBe(110);
  });

  it("leaves a holding's value unknown when the issuer does not match", async () => {
    stubAccount(service, [
      nativeBalance("100"),
      creditBalance("USDC", OTHER_USDC_ISSUER, "5"),
    ]);
    mockGetPrice.mockImplementation(async (from: string) =>
      from === "XLM" ? validQuote(100) : invalidQuote("issuer_mismatch")
    );

    const summary = await service.getPortfolio(ACCOUNT, "USD");

    const usdc = summary.assets.find((asset) => asset.code === "USDC");
    const xlm = summary.assets.find((asset) => asset.code === "XLM");

    expect(mockGetPrice).toHaveBeenCalledWith("USDC", "USD", 5, {
      fromIssuer: OTHER_USDC_ISSUER,
    });
    expect(usdc?.valueInCurrency).toBeNull();
    expect(xlm?.valueInCurrency).toBe(100);
    expect(summary.totalValue).toBe(100);
  });

  it("keeps the historical zero for a transient quote failure", async () => {
    stubAccount(service, [creditBalance("USDC", USDC_ISSUER, "5")]);
    mockGetPrice.mockResolvedValue(invalidQuote("fetch_error"));

    const summary = await service.getPortfolio(ACCOUNT, "USD");

    const usdc = summary.assets.find((asset) => asset.code === "USDC");
    expect(usdc?.valueInCurrency).toBe(0);
    expect(summary.totalValue).toBe(0);
  });

  it("leaves the value unresolved when pricing itself throws", async () => {
    stubAccount(service, [creditBalance("USDC", USDC_ISSUER, "5")]);
    mockGetPrice.mockRejectedValue(new Error("horizon down"));

    const summary = await service.getPortfolio(ACCOUNT, "USD");

    expect(summary.assets[0].valueInCurrency).toBeNull();
    expect(summary.totalValue).toBeNull();
  });

  it("does not price assets the price service does not support", async () => {
    stubAccount(service, [creditBalance("AAA", USDC_ISSUER, "5")]);

    const summary = await service.getPortfolio(ACCOUNT, "USD");

    expect(mockGetPrice).not.toHaveBeenCalled();
    expect(summary.assets[0].valueInCurrency).toBeNull();
  });

  describe("getAssetPrice", () => {
    it("forwards the issuer and reports it back", async () => {
      mockGetPrice.mockResolvedValue(validQuote(0.99, USDC_ISSUER));

      const result = await service.getAssetPrice("usdc", "usd", USDC_ISSUER);

      expect(mockGetPrice).toHaveBeenCalledWith("USDC", "USD", 1, {
        fromIssuer: USDC_ISSUER,
      });
      expect(result).toEqual({
        assetCode: "USDC",
        currency: "USD",
        price: 0.99,
        assetIssuer: USDC_ISSUER,
      });
    });

    it("reports the issuer the quote belongs to when none was supplied", async () => {
      mockGetPrice.mockResolvedValue(validQuote(0.99, USDC_ISSUER));

      const result = await service.getAssetPrice("USDC", "USD");

      expect(mockGetPrice).toHaveBeenCalledWith("USDC", "USD", 1, {});
      expect(result.assetIssuer).toBe(USDC_ISSUER);
    });

    it("returns the identity of a native quote without inventing an issuer", async () => {
      mockGetPrice.mockResolvedValue(validQuote(0.11));

      const result = await service.getAssetPrice("XLM", "USD");

      expect(result).toEqual({
        assetCode: "XLM",
        currency: "USD",
        price: 0.11,
      });
      expect(result.assetIssuer).toBeUndefined();
    });

    it("quotes 1 when the asset already is the requested currency", async () => {
      const result = await service.getAssetPrice("XLM", "XLM", USDC_ISSUER);

      expect(result).toEqual({
        assetCode: "XLM",
        currency: "XLM",
        price: 1,
        assetIssuer: USDC_ISSUER,
      });
      expect(mockGetPrice).not.toHaveBeenCalled();
    });
  });
});
