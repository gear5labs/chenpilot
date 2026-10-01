import { Keypair, Networks, Asset } from "@stellar/stellar-sdk";
import {
  SponsorshipWorkflowBuilder,
  SponsorshipWorkflowStep,
} from "../sponsorship";

// Valid strkey account IDs — Asset validates issuer keys at construction.
const G_SPONSOR = "GB22YT5SCZCTDD6HM55DHLSCY5L47BDT2GWXKCURFKN65GQYWBN74XT3";
const G_SPONSORED = "GBTYUPMGKOWFPJGPX2AH2JJQWVCMLZ5S37SJYOEVCWNKUPQ4F63DLA3T";
const G_DEST = "GAWWNEXTRH7NVNFWXXE43UKDLB3HU46LBZBHJLBSJ7NXL5FUCGQQYFKG";
const G_NEW = "GBY7HEEHLWOFNKKUSKMSYLTPSQKCT3GABBDKA64AHN6MARJSPMJUWTRU";
const G_ISSUER = "GBT4AJHLR5BYOXMSF625VARWCZ7NX3IIS73M7KIUPZDNLG6FZ67MTHS6";
const G_ISSUER_2 = "GD4FVZ3O4WC5AJVDBRYO456O2P5ZE3W3IXCXM2DAQSAF5XJ4TRHT7HYG";

// Mock the Horizon Server that sponsorship.ts actually constructs
// (`new Horizon.Server(...)` from @stellar/stellar-sdk).
jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...original,
    Horizon: {
      ...original.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        accounts: () => ({
          accountId: (id: string) => ({
            call: jest.fn().mockImplementation(() => {
              if (id === G_SPONSOR) {
                return Promise.resolve({ balances: [] });
              }
              return Promise.reject(new Error("Not found"));
            }),
          }),
        }),
      })),
    },
    TransactionBuilder: original.TransactionBuilder,
    Account: original.Account,
    Networks: original.Networks,
    BASE_FEE: "100",
    Asset: original.Asset,
    Operation: original.Operation,
    Memo: original.Memo,
  };
});

describe("SponsorshipWorkflowBuilder", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const builder = new SponsorshipWorkflowBuilder();
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.IDLE);
    });

    it("should initialize with custom config", () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.IDLE);
    });
  });

  describe("setSponsoredAccount", () => {
    it("should set the sponsored account and move to BUILDING", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount(G_SPONSORED);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addTrustline", () => {
    it("should add trustline and update step", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addTrustline("USDC", G_ISSUER);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });

    it("should support adding multiple trustlines", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustline("EURT", G_ISSUER_2);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlines", () => {
    it("should add trustlines and update step", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addTrustlines([
        { assetCode: "USDC", assetIssuer: G_ISSUER },
        { assetCode: "EURT", assetIssuer: G_ISSUER_2, limit: "1000" },
      ]);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addCreateAccount", () => {
    it("should add create account and update step", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addCreateAccount(G_NEW);
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addManageData", () => {
    it("should add manage data and update step", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.addManageData("key", "value");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("addPayment", () => {
    it("should add payment operation", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount(G_SPONSORED);
      builder.addPayment(G_DEST, "100");
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });

    it("should add payment with custom asset", () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount(G_SPONSORED);
      builder.addPayment(G_DEST, "100", new Asset("USDC", G_ISSUER));
      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.BUILDING);
    });
  });

  describe("preview", () => {
    it("should generate empty preview without accounts", async () => {
      const builder = new SponsorshipWorkflowBuilder();
      const preview = await builder.preview();

      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.PREVIEWING);
      expect(preview.operations).toHaveLength(0);
    });

    it("should generate preview with trustline operations", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addTrustline("USDC", G_ISSUER);
      const preview = await builder.preview();

      expect(preview.operations.length).toBe(3); // begin, trustline, end
    });

    it("should include create account in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: G_SPONSOR });
      builder.addCreateAccount(G_NEW);
      const preview = await builder.preview();

      // Only the createAccount op: begin requires both sponsor AND
      // sponsoredAccount, and neither is set here.
      expect(preview.operations.length).toBe(1);
    });

    it("should frame create account with begin/end when fully configured", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addCreateAccount(G_NEW);
      const preview = await builder.preview();

      expect(preview.operations.length).toBe(3); // begin, create account, end
    });

    // stellar-sdk v14 operations expose the discriminator via op.body().switch().name
    const opTypeName = (op: any): string => op?.body?.().switch().name;

    it("should include manage data in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addManageData("key", "value");
      const preview = await builder.preview();

      expect(preview.operations.some((op) => opTypeName(op) === "manageData")).toBe(true);
    });

    it("should include payment in preview", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addPayment(G_DEST, "100");
      const preview = await builder.preview();

      expect(preview.operations.some((op) => opTypeName(op) === "payment")).toBe(true);
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid sponsor", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: G_SPONSOR });
      builder.setSponsoredAccount(G_SPONSORED);
      builder.addTrustline("USDC", G_ISSUER);
      const validation = await builder.validate();

      expect(builder.getCurrentStep()).toBe(SponsorshipWorkflowStep.VALIDATING);
      expect(validation.sponsorExists).toBe(true);
      expect(validation.valid).toBe(true);
    });

    it("should return errors when sponsor is missing", async () => {
      const builder = new SponsorshipWorkflowBuilder();
      builder.setSponsoredAccount(G_SPONSORED);
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Sponsor account is required");
    });

    it("should return errors when sponsored account is missing", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: G_SPONSOR });
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Sponsored account is required");
    });

    it("should warn about invalid issuer format", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: G_SPONSOR });
      builder.setSponsoredAccount(G_SPONSORED);
      builder.addTrustline("USDC", "not-an-issuer");
      const validation = await builder.validate();

      expect(validation.warnings.some((w) => w.includes("issuer"))).toBe(true);
    });
  });

  describe("estimate", () => {
    it("should estimate resource costs", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustline("EURT", G_ISSUER_2);
      builder.addManageData("key", "value");

      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.operationCount).toBeGreaterThan(0);
      expect(estimate.reservesToSponsor).toBeGreaterThan(0);
    });

    it("should count createAccount toward reserves", async () => {
      const builder = new SponsorshipWorkflowBuilder({ sponsor: G_SPONSOR });
      builder.addCreateAccount(G_NEW);
      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.reservesToSponsor).toBeGreaterThanOrEqual(1);
    });
  });

  describe("build", () => {
    it("should build workflow result", async () => {
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: G_SPONSOR,
        sponsoredAccount: G_SPONSORED,
      });
      builder.addTrustline("USDC", G_ISSUER);
      const result = await builder.build();

      expect(result.transactionXdr).toBeDefined();
      expect(result.operations).toBeDefined();
      expect(result.resourceEstimate).toBeDefined();
    });
  });
});
