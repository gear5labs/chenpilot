import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import {
  TrustlineWorkflowBuilder,
  TrustlineWorkflowStep,
  AssetToTrust,
} from "../trustline";

// Valid strkey account IDs — Asset validates issuer keys at construction.
export const G_TEST = "GB22YT5SCZCTDD6HM55DHLSCY5L47BDT2GWXKCURFKN65GQYWBN74XT3";
export const G_SOURCE = "GBTYUPMGKOWFPJGPX2AH2JJQWVCMLZ5S37SJYOEVCWNKUPQ4F63DLA3T";
export const G_ISSUER = "GAWWNEXTRH7NVNFWXXE43UKDLB3HU46LBZBHJLBSJ7NXL5FUCGQQYFKG";
export const G_ISSUER_2 = "GBY7HEEHLWOFNKKUSKMSYLTPSQKCT3GABBDKA64AHN6MARJSPMJUWTRU";
export const G_OLD_ISSUER = "GBT4AJHLR5BYOXMSF625VARWCZ7NX3IIS73M7KIUPZDNLG6FZ67MTHS6";
export const G_SIGNER_2 = "GD4FVZ3O4WC5AJVDBRYO456O2P5ZE3W3IXCXM2DAQSAF5XJ4TRHT7HYG";

// Mock the Horizon Server that trustline.ts actually constructs
// (`new Horizon.Server(...)` from @stellar/stellar-sdk).
const mockCall = jest.fn();
const mockOffers = jest.fn();
const mockServerInstance: any = {
  accounts: () => ({ accountId: () => ({ call: mockCall }) }),
  offers: () => ({
    forAccount: () => ({
      limit: () => ({
        call: mockOffers,
      }),
    }),
  }),
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

const GTEST = G_TEST;
const GSOURCE = G_SOURCE;
const GISSUER = G_ISSUER;

describe("checkAccountMergeBlockers", () => {
  beforeAll(() => {
    mockCall.mockReset();
    mockOffers.mockReset();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports no blockers when account is merge-ready", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: GTEST,
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [{ key: GTEST, weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("reports non-zero trustline blockers with cleanup instructions", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: GISSUER,
          balance: "50.5",
        },
      ],
      data: {},
      signers: [{ key: GTEST, weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].type).toBe("trustline");
    expect(result.blockers[0].description).toContain("non-zero balance");
    expect(result.blockers[0].cleanupInstructions).toContain(
      "Send all asset balances"
    );
    expect(result.blockers[0].affectedItems).toContain(`USDC:${GISSUER}`);
  });

  it("reports zero-balance trustline blockers with removal instructions", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "EMPTY",
          asset_issuer: GISSUER,
          balance: "0",
        },
      ],
      data: {},
      signers: [{ key: GTEST, weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    expect(result.blockers[0].type).toBe("trustline");
    expect(result.blockers[0].cleanupInstructions).toContain("changeTrust");
    expect(result.blockers[0].affectedItems).toContain(`EMPTY:${GISSUER}`);
  });

  it("reports data entry blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "100" }],
      data: { config: "base64data", metadata: "base64data" },
      signers: [{ key: GTEST, weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    const dataBlocker = result.blockers.find((b) => b.type === "data_entry");
    expect(dataBlocker).toBeDefined();
    expect(dataBlocker!.cleanupInstructions).toContain("manageData");
    expect(dataBlocker!.affectedItems).toContain("config");
  });

  it("reports open offer blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [{ key: GTEST, weight: 1 }],
    });
    mockOffers.mockResolvedValueOnce({
      records: [{ id: "12345" }, { id: "67890" }],
    });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    const offerBlocker = result.blockers.find((b) => b.type === "offers");
    expect(offerBlocker).toBeDefined();
    expect(offerBlocker!.cleanupInstructions).toContain("manageSellOffer");
    expect(offerBlocker!.affectedItems).toHaveLength(2);
  });

  it("reports additional signer blockers", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: GTEST,
      balances: [{ asset_type: "native", balance: "100" }],
      data: {},
      signers: [
        { key: GTEST, weight: 1 },
        { key: G_SIGNER_2, weight: 1 },
      ],
    });
    mockOffers.mockResolvedValueOnce({ records: [] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    const signerBlocker = result.blockers.find((b) => b.type === "signers");
    expect(signerBlocker).toBeDefined();
    expect(signerBlocker!.cleanupInstructions).toContain("setOptions");
    expect(signerBlocker!.affectedItems).toContain(G_SIGNER_2);
  });

  it("reports multiple blocker types simultaneously", async () => {
    const { checkAccountMergeBlockers } = await import("../trustline");
    mockCall.mockResolvedValueOnce({
      id: GTEST,
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: GISSUER,
          balance: "0",
        },
      ],
      data: { key1: "value1" },
      signers: [
        { key: GTEST, weight: 1 },
        { key: G_SIGNER_2, weight: 1 },
      ],
    });
    mockOffers.mockResolvedValueOnce({ records: [{ id: "12345" }] });

    const result = await checkAccountMergeBlockers(undefined, GTEST);

    expect(result.canMerge).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

describe("TrustlineWorkflowBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default account lookup: GSOURCE exists and already holds a USDC
    // trustline issued by GISSUER (drives "existing trustline" warnings).
    mockCall.mockResolvedValue({
      id: GSOURCE,
      balances: [
        { asset_type: "native", balance: "100" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: GISSUER,
          balance: "10",
        },
      ],
    });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const builder = new TrustlineWorkflowBuilder();
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });

    it("should initialize with custom config", () => {
      const builder = new TrustlineWorkflowBuilder({
        source: GTEST,
        networkPassphrase: Networks.TESTNET,
      });
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.IDLE);
    });
  });

  describe("addTrustline", () => {
    it("should add a single trustline and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", G_ISSUER);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });

    it("should add multiple trustlines", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustline("EURT", G_ISSUER_2);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlines", () => {
    it("should add multiple trustlines at once", () => {
      const builder = new TrustlineWorkflowBuilder();
      const assets: AssetToTrust[] = [
        { assetCode: "USDC", assetIssuer: G_ISSUER },
        { assetCode: "EURT", assetIssuer: G_ISSUER_2, limit: "1000" },
      ];
      builder.addTrustlines(assets);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("addTrustlineRemoval", () => {
    it("should add a trustline removal and update step", () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustlineRemoval("USDC", G_ISSUER);
      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.BUILDING);
    });
  });

  describe("preview", () => {
    it("should generate preview with operations", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      builder.addTrustline("USDC", G_ISSUER);
      const preview = await builder.preview();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.PREVIEWING);
      expect(preview.operations).toHaveLength(1);
      expect(preview.sourceAccount).toBe(GSOURCE);
    });

    it("should include trustline removals in preview", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustlineRemoval("EURT", G_ISSUER_2);
      const preview = await builder.preview();

      expect(preview.operations).toHaveLength(2);
    });
  });

  describe("validate", () => {
    it("should validate successfully with source account provided", async () => {
      const builder = new TrustlineWorkflowBuilder({
        source: GSOURCE,
        horizonUrl: "https://horizon.stellar.org",
      });
      builder.addTrustline("USDC", G_ISSUER);
      const validation = await builder.validate();

      expect(builder.getCurrentStep()).toBe(TrustlineWorkflowStep.VALIDATING);
      expect(validation.valid).toBe(true);
      expect(validation.accountExists).toBe(true);
    });

    it("should return errors when source account is missing", async () => {
      const builder = new TrustlineWorkflowBuilder();
      builder.addTrustline("USDC", G_ISSUER);
      const validation = await builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Source account is required for validation");
    });

    it("should warn about existing trustlines", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      builder.addTrustline("USDC", G_ISSUER);
      const validation = await builder.validate();

      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it("should flag assets not yet trusted as missingTrustlines", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      // USDC:GISSUER is in the mocked existing balances; EURT is not.
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustline("EURT", G_ISSUER_2);
      const validation = await builder.validate();

      expect(validation.missingTrustlines).toHaveLength(1);
      expect(validation.missingTrustlines[0].assetCode).toBe("EURT");
    });
  });

  describe("estimate", () => {
    it("should estimate resource costs", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      builder.addTrustline("USDC", G_ISSUER);
      builder.addTrustline("EURT", G_ISSUER_2);
      builder.addTrustlineRemoval("OLD", G_OLD_ISSUER);

      const preview = await builder.preview();
      const estimate = builder.estimate(preview);

      expect(estimate.operationCount).toBe(3);
      expect(estimate.trustlinesCreated).toBe(2);
      expect(estimate.trustlinesRemoved).toBe(1);
    });
  });

  describe("build", () => {
    it("should build workflow result", async () => {
      const builder = new TrustlineWorkflowBuilder({ source: GSOURCE });
      builder.addTrustline("USDC", G_ISSUER);
      const result = await builder.build();

      expect(result.transactionXdr).toBeDefined();
      expect(result.operations).toHaveLength(1);
      expect(result.resourceEstimate).toBeDefined();
    });
  });
});
