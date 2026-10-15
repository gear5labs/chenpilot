import { Asset } from "@stellar/stellar-sdk";
import {
  hasValidStellarTrustline,
  assertTrustlinesForTransfer,
  assertTrustlineAuthorized,
  TrustlineUnauthorizedError,
  findZeroBalanceTrustlines,
  buildTrustlineRemovalOps,
  TrustlineInfo,
} from "../trustline";

// Mock the Horizon Server that trustline.ts actually constructs
// (`new Horizon.Server(...)` from @stellar/stellar-sdk) but use real Asset
// classes so asset introspection behaves like production.
const mockCall = jest.fn();
const mockServerInstance: any = {
  accounts: () => ({ accountId: () => ({ call: mockCall }) }),
};

jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...original,
    Horizon: {
      ...original.Horizon,
      Server: jest.fn(() => mockServerInstance),
    },
  };
});

// Valid-looking Stellar account IDs (Asset validates issuer strkeys).
const ACCOUNT_ID = "GBKGBOEDFY7CBGI3B3DEBWLZC5BZEFWUH65ILUMEN5EWNDUBOXXITH3R";
const ISSUER_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("trustline helper functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hasValidStellarTrustline", () => {
    it("returns true for native asset regardless of balances", async () => {
      const res = await hasValidStellarTrustline(undefined, ACCOUNT_ID, "XLM");
      expect(res.exists).toBe(true);
      expect(res.authorized).toBe(true);
      expect(mockCall).not.toHaveBeenCalled();
    });

    it("handles missing trustline", async () => {
      mockCall.mockResolvedValueOnce({ balances: [] });
      const res = await hasValidStellarTrustline(
        undefined,
        ACCOUNT_ID,
        "TOKEN",
        ISSUER_ID
      );
      expect(res.exists).toBe(false);
      expect(res.authorized).toBe(false);
    });

    it("returns details when trustline present and authorized flag parsed", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "TOKEN",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized: false,
          },
        ],
      });
      const res = await hasValidStellarTrustline(
        undefined,
        ACCOUNT_ID,
        "TOKEN",
        ISSUER_ID
      );
      expect(res.exists).toBe(true);
      expect(res.authorized).toBe(false);
      expect(res.details).toBeDefined();
    });

    it("returns exists=false when the account lookup fails (account not found)", async () => {
      mockCall.mockRejectedValueOnce(new Error("Not Found"));
      const res = await hasValidStellarTrustline(
        undefined,
        ACCOUNT_ID,
        "TOKEN",
        ISSUER_ID
      );
      expect(res.exists).toBe(false);
      expect(res.authorized).toBe(false);
      expect(res.details?.error).toBeDefined();
    });

    it("falls back to authorized_to_maintain_liabilities when authorized flags are absent", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "TOKEN",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized_to_maintain_liabilities: false,
          },
        ],
      });
      const res = await hasValidStellarTrustline(
        undefined,
        ACCOUNT_ID,
        "TOKEN",
        ISSUER_ID
      );
      expect(res.exists).toBe(true);
      expect(res.authorized).toBe(false);
    });
  });

  describe("assertTrustlinesForTransfer (fail-closed transfer preflight)", () => {
    it("passes for XLM-only transfers without any Horizon call", async () => {
      const res = await assertTrustlinesForTransfer(undefined, ACCOUNT_ID, [
        "XLM",
      ]);
      expect(res).toEqual([]);
      expect(mockCall).not.toHaveBeenCalled();
    });

    it("passes when all assets hold authorized trustlines", async () => {
      mockCall.mockResolvedValue({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized: true,
          },
        ],
      });
      const res = await assertTrustlinesForTransfer(undefined, ACCOUNT_ID, [
        "XLM",
        "USDC",
      ]);
      expect(res).toHaveLength(1);
      expect(res[0].authorized).toBe(true);
    });

    it("throws when the trustline is missing", async () => {
      mockCall.mockResolvedValueOnce({ balances: [] });
      await expect(
        assertTrustlinesForTransfer(undefined, ACCOUNT_ID, ["USDC"])
      ).rejects.toThrow(TrustlineUnauthorizedError);
    });

    it("throws when the trustline is frozen (authorized=false)", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized: false,
          },
        ],
      });
      await expect(
        assertTrustlinesForTransfer(undefined, ACCOUNT_ID, ["USDC"])
      ).rejects.toThrow(/frozen/i);
    });

    it("throws when the source account does not exist", async () => {
      mockCall.mockRejectedValueOnce(new Error("Not Found"));
      await expect(
        assertTrustlinesForTransfer(undefined, ACCOUNT_ID, ["USDC"])
      ).rejects.toThrow(TrustlineUnauthorizedError);
    });

    it("deduplicates repeated assets across roles (source/dest/path)", async () => {
      mockCall.mockResolvedValue({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized: true,
          },
        ],
      });
      const res = await assertTrustlinesForTransfer(undefined, ACCOUNT_ID, [
        "USDC",
        "USDC",
        "USDC",
      ]);
      expect(res).toHaveLength(1);
      expect(mockCall).toHaveBeenCalledTimes(1);
    });

    it("skips native assets but still checks issued assets", async () => {
      mockCall.mockResolvedValue({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "10",
            authorized: false,
          },
        ],
      });
      await expect(
        assertTrustlinesForTransfer(undefined, ACCOUNT_ID, ["XLM", "USDC"])
      ).rejects.toThrow(/USDC/);
    });
  });

  describe("assertTrustlineAuthorized (single-asset, role-aware)", () => {
    it("accepts SDK Asset instances and reports the role in the error", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "5",
            authorized: false,
          },
        ],
      });
      const asset = new Asset("USDC", ISSUER_ID);
      await expect(
        assertTrustlineAuthorized(
          undefined,
          ACCOUNT_ID,
          asset,
          "destination"
        )
      ).rejects.toThrow(/destination asset USDC/);
    });

    it("does not throw when the trustline is authorized", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "USDC",
            asset_issuer: ISSUER_ID,
            balance: "5",
            authorized: true,
          },
        ],
      });
      const asset = new Asset("USDC", ISSUER_ID);
      const res = await assertTrustlineAuthorized(
        undefined,
        ACCOUNT_ID,
        asset,
        "source"
      );
      expect(res.authorized).toBe(true);
    });

    it("never contacts Horizon for the native asset", async () => {
      const res = await assertTrustlineAuthorized(
        undefined,
        ACCOUNT_ID,
        "XLM",
        "source"
      );
      expect(res.authorized).toBe(true);
      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe("findZeroBalanceTrustlines", () => {
    it("filters out native trustlines and non-zero balances", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          { asset_type: "native", balance: "100" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "ABC",
            asset_issuer: ISSUER_ID,
            balance: "0.00000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "XYZ",
            asset_issuer: ISSUER_ID,
            balance: "5.0",
          },
        ],
      });

      const result = await findZeroBalanceTrustlines(undefined, ACCOUNT_ID);
      expect(result).toEqual([
        {
          assetCode: "ABC",
          assetIssuer: ISSUER_ID,
          balance: "0.00000",
        },
      ]);
    });

    it("returns empty array when no zero-balance trustlines", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "FOO",
            asset_issuer: ISSUER_ID,
            balance: "1",
          },
        ],
      });
      const result = await findZeroBalanceTrustlines(undefined, ACCOUNT_ID);
      expect(result).toEqual([]);
    });
  });

  describe("buildTrustlineRemovalOps", () => {
    it("produces an empty array when given no trustlines", () => {
      const ops = buildTrustlineRemovalOps([]);
      expect(ops).toEqual([]);
    });

    it("produces changeTrust-to-zero operations for each trustline", () => {
      const trustlines: TrustlineInfo[] = [
        { assetCode: "ABC", assetIssuer: ISSUER_ID, balance: "0" },
      ];
      const ops = buildTrustlineRemovalOps(trustlines);
      expect(ops).toHaveLength(1);
    });
  });
});
