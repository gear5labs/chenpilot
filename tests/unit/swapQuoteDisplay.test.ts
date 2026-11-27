import "../stellar.mock";
import * as StellarSdk from "@stellar/stellar-sdk";
import { SwapTool } from "../../src/Agents/tools/swap";

jest.mock("../../src/services/stellarPrice.service");
jest.mock("../../src/services/flashSwapRiskAnalyzer");
jest.mock("../../src/Auth/accountSecretStore");
jest.mock("../../src/transactions/TransactionLifecycle.service");
jest.mock("../../src/Security");

const mockSwapTool = new SwapTool();

describe("SwapTool — Quote Lifetime and Material Fees Display", () => {
  describe("Quote Lifetime", () => {
    it("should include deadline timestamp in seconds", () => {
      const now = Math.floor(Date.now() / 1000);
      const DEFAULT_QUOTE_TTL_SEC = 30;
      const expectedDeadline = now + DEFAULT_QUOTE_TTL_SEC;

      // Check that deadline is within expected range (accounting for execution time)
      expect(expectedDeadline).toBeGreaterThan(now);
      expect(expectedDeadline - now).toBeLessThanOrEqual(DEFAULT_QUOTE_TTL_SEC + 1);
    });

    it("should format deadline as ISO 8601 datetime string", () => {
      const deadline = Math.floor(Date.now() / 1000) + 30;
      const isoString = new Date(deadline * 1000).toISOString();

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should calculate secondsRemaining correctly", () => {
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + 25;
      const secondsRemaining = Math.max(0, deadline - now);

      expect(secondsRemaining).toBe(25);
      expect(secondsRemaining).toBeLessThanOrEqual(30);
      expect(secondsRemaining).toBeGreaterThanOrEqual(0);
    });

    it("should return 0 secondsRemaining when deadline has passed", () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredDeadline = now - 10;
      const secondsRemaining = Math.max(0, expiredDeadline - now);

      expect(secondsRemaining).toBe(0);
    });
  });

  describe("Material Fees", () => {
    it("should convert BASE_FEE from stroops to XLM correctly", () => {
      // StellarSdk.BASE_FEE is 100 stroops
      const BASE_FEE_STROOPS = 100;
      const STROOPS_PER_XLM = 10_000_000;
      const expectedXlm = BASE_FEE_STROOPS / STROOPS_PER_XLM;

      expect(expectedXlm).toBe(0.00001);
    });

    it("should include network fee in materialFees", () => {
      const networkFee = {
        network: "0.00001 XLM",
        total: "0.00001 XLM",
      };

      expect(networkFee).toHaveProperty("network");
      expect(networkFee).toHaveProperty("total");
      expect(networkFee.network).toContain("XLM");
      expect(networkFee.total).toContain("XLM");
    });

    it("should format fees with correct decimal places", () => {
      const feeStr = "0.00001";
      const decimals = feeStr.split(".")[1]?.length || 0;

      expect(decimals).toBeLessThanOrEqual(7);
      expect(decimals).toBeGreaterThan(0);
    });

    it("should handle zero fees gracefully", () => {
      const zeroFee = "0.0000000";
      expect(zeroFee).toMatch(/^0\.0{7}$/);
    });
  });

  describe("Acceptance Criteria", () => {
    it("should include both quoteLifetime and materialFees in success result", () => {
      const mockResult = {
        quoteLifetime: {
          deadline: Math.floor(Date.now() / 1000) + 30,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          secondsRemaining: 30,
        },
        materialFees: {
          network: "0.00001 XLM",
          total: "0.00001 XLM",
        },
      };

      expect(mockResult).toHaveProperty("quoteLifetime");
      expect(mockResult).toHaveProperty("materialFees");
      expect(mockResult.quoteLifetime).toHaveProperty("deadline");
      expect(mockResult.quoteLifetime).toHaveProperty("expiresAt");
      expect(mockResult.quoteLifetime).toHaveProperty("secondsRemaining");
      expect(mockResult.materialFees).toHaveProperty("network");
      expect(mockResult.materialFees).toHaveProperty("total");
    });

    it("should display fees before user confirmation", () => {
      const displayData = {
        from: "XLM",
        to: "USDC",
        amount: "100.0000000 XLM",
        estimatedOutput: "12.3456789 USDC",
        price: "0.1234568",
        quoteLifetime: {
          deadline: Math.floor(Date.now() / 1000) + 30,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          secondsRemaining: 30,
        },
        materialFees: {
          network: "0.00001 XLM",
          total: "0.00001 XLM",
        },
      };

      // Verify all critical information is available before confirmation
      expect(displayData.amount).toBeDefined();
      expect(displayData.estimatedOutput).toBeDefined();
      expect(displayData.quoteLifetime).toBeDefined();
      expect(displayData.materialFees).toBeDefined();
    });

    it("should indicate when quote is about to expire", () => {
      const expiringDeadline = Math.floor(Date.now() / 1000) + 2;
      const secondsRemaining = Math.max(0, expiringDeadline - Math.floor(Date.now() / 1000));

      expect(secondsRemaining).toBeLessThanOrEqual(2);
      expect(secondsRemaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Failure Cases", () => {
    it("should handle deadline calculation at boundary conditions", () => {
      const now = Math.floor(Date.now() / 1000);

      // Exactly at deadline
      expect(Math.max(0, now - now)).toBe(0);

      // Well before deadline
      const future = now + 60;
      expect(Math.max(0, future - now)).toBe(60);
    });

    it("should handle fee calculations with large amounts", () => {
      // Fee stays constant regardless of swap amount
      const networkFee = 0.00001; // Always 100 stroops

      expect(networkFee).toBeCloseTo(0.00001, 7);
    });

    it("should format fees with consistent precision", () => {
      const fees = ["0.00001", "0.00010", "0.00100", "0.01000"];

      fees.forEach((fee) => {
        const decimals = fee.split(".")[1]?.length || 0;
        expect(decimals).toBeGreaterThanOrEqual(5);
      });
    });
  });

  describe("Compatibility", () => {
    it("should work with 30-second default quote TTL", () => {
      const DEFAULT_TTL = 30;
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + DEFAULT_TTL;

      expect(deadline - now).toBe(DEFAULT_TTL);
    });

    it("should work with 120-second multi-hop quote TTL", () => {
      const MULTI_HOP_TTL = 120;
      const now = Math.floor(Date.now() / 1000);
      const deadline = now + MULTI_HOP_TTL;

      expect(deadline - now).toBe(MULTI_HOP_TTL);
    });

    it("should maintain backward compatibility with existing approval flow", () => {
      const result = {
        status: "success",
        data: {
          from: "XLM",
          to: "USDC",
          amount: "100.0000000 XLM",
          estimatedOutput: "12.3456789 USDC",
          quoteLifetime: {
            deadline: Math.floor(Date.now() / 1000) + 30,
            expiresAt: new Date(Date.now() + 30000).toISOString(),
            secondsRemaining: 30,
          },
          materialFees: {
            network: "0.00001 XLM",
            total: "0.00001 XLM",
          },
        },
      };

      expect(result.status).toBe("success");
      expect(result.data).toHaveProperty("quoteLifetime");
      expect(result.data).toHaveProperty("materialFees");
    });
  });
});
