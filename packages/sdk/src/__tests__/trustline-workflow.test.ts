import { Asset, Operation, Keypair, Account, Networks } from "stellar-sdk";
import {
  TrustlineWorkflowBuilder,
  TrustlineWorkflowStep,
  AssetToTrust,
} from "../trustline";

jest.mock("stellar-sdk", () => {
  const original = jest.requireActual("stellar-sdk");
  return {
    ...original,
    Server: jest.fn().mockImplementation(() => ({
      accounts: () => ({
        accountId: (id: string) => ({
          call: jest.fn().mockResolvedValue({
            balances: [
              { asset_type: "native", balance: "100" },
              { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GSPONSOR", balance: "10" },
            ],
          }),
        }),
      }),
    })),
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        accounts: () => ({
          accountId: (id: string) => ({
            call: jest.fn().mockResolvedValue({
              balances: [
                { asset_type: "native", balance: "100" },
                { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GSPONSOR", balance: "10" },
              ],
            }),
          }),
        }),
      })),
    },
    TransactionBuilder: original.TransactionBuilder,
    Account: original.Account,
    Networks: original.Networks,
    BASE_FEE: "100",
  };
});

describe("TrustlineWorkflowBuilder", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const builder = new TrustlineWorkflowBuilder();
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });

    it("should initialize with custom config", () => {
      const builder = new TrustlineWorkflowBuilder({
        source: "GTEST",
        networkPassphrase: Networks.TESTNET,
      });
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });
  });

  describe("addTrustline", () => {
    it("should add a single trustline and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });

    it("should add multiple trustlines", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer1");
      builder.addTrustline("EURT", "GAIssuer2");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlines", () => {
    it("should add multiple trustlines at once", () => {
      const builder = new TrustlineWorkflowBuilder();
      const assets: AssetToTrust[] = [
        { assetCode: "USDC", assetIssuer: "GAIssuer1" },
        { assetCode: "EURT", assetIssuer: "GAIssuer2", limit: "1000" },
      ];
      builder.addTrustlines(assets);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlineRemoval", () => {
    it("should add a trustline removal and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustlineRemoval("USDC", "GAIssuer");
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("preview", () => {
    it("should generate preview with operations", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      const preview = await builder.preview();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.PREVIEWING);
      expect(preview.operations).toHaveLength(1);
      expect(preview.sourceAccount).toBe("GSOURCE");
    });

    it("should include trustline removals in preview", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      builder.addTrustlineRemoval("EURT", "GIssuer2");
      const preview = await builder.preview();

      expect(preview.operations).toHaveLength(2);
    });
  });

  describe("validate", () => {
    it("should validate successfully with source account provided", async () => {
      const builder = new TrustlineWorkflowBuilder({
        source: "GSOURCE",
        horizonUrl: "https://horizon.stellar.org",
      });
      builder.addTrustline("USDC", "GAIssuer");
      const validation = await builder.validate();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.VALIDATING);
      expect(validation.valid).toBe(true);
      expect(validation.accountExists).toBe(true);
    });

    it("should return errors when source account is missing", async () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", "GAIssuer");
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Source account is required for validation");
    });

    it("should warn about existing trustlines", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GSPONSOR");
      const validation = await builder.validate();

      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it("should warn about invalid issuer format", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "not-an-issuer");
      const validation = await builder.validate();

      expect(validation.warnings.some((w) => w.includes("issuer"))).toBe(true);
    });
  });

  describe("estimate", () => {
    it("should estimate resource costs", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      builder.addTrustline("EURT", "GIssuer2");
      builder.addTrustlineRemoval("OLD", "GOLDIssuer");

      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.operationCount).toBe(3);
      expect(estimate.trustlinesCreated).toBe(2);
      expect(estimate.trustlinesRemoved).toBe(1);
    });
  });

  describe("build", () => {
    it("should build workflow result", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: "GSOURCE" });
      builder.addTrustline("USDC", "GAIssuer");
      const result = await builder.build();

      expect(result.transactionXdr).toBeDefined();
      expect(result.operations).toHaveLength(1);
      expect(result.resourceEstimate).toBeDefined();
    });
  });
});