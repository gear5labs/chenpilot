import { StellarTrustFramework, TrustStatus } from "../trustFramework";
import { StellarMetadataManager } from "../metadata";

jest.mock("@stellar/stellar-sdk", () => {
  const mockLoadAccount = jest.fn();
  const mockResolveToml = jest.fn();

  return {
    __esModule: true,
    Horizon: {
      Server: jest.fn(() => ({ loadAccount: mockLoadAccount })),
    },
    StellarToml: {
      Resolver: {
        resolve: mockResolveToml,
      },
    },
    __mockLoadAccount: mockLoadAccount,
    __mockResolveToml: mockResolveToml,
  };
});

const { __mockLoadAccount: mockLoadAccount, __mockResolveToml: mockResolveToml } =
  jest.requireMock("@stellar/stellar-sdk");

describe("StellarTrustFramework", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validIssuer = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("returns VERIFIED when asset is listed in stellar.toml", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "example.com" });
    mockResolveToml.mockResolvedValueOnce({ CURRENCIES: [{ code: "USD", issuer: validIssuer }] });

    const framework = new StellarTrustFramework({ enableScamDetection: true });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.VERIFIED);
    expect(result.isSafe).toBe(true);
    expect(result.details).toContain("listed in stellar.toml");
  });

  it("returns BLOCKED when issuer is in blocked issuers list", async () => {
    const framework = new StellarTrustFramework({ blockedIssuers: [validIssuer] });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.BLOCKED);
    expect(result.isSafe).toBe(false);
    expect(result.details).toContain("explicitly blocked");
  });

  it("returns TRUSTED for safe asset even when stellar.toml is missing", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "example.com" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ safeAssets: [`USD:${validIssuer}`] });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.TRUSTED);
    expect(result.isSafe).toBe(true);
    expect(result.details).toContain("Not found");
  });

  it("returns BLOCKED when asset is in blocked assets list", async () => {
    const framework = new StellarTrustFramework({ blockedAssets: [`USD:${validIssuer}`] });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.BLOCKED);
    expect(result.isSafe).toBe(false);
    expect(result.details).toContain("explicitly blocked");
  });

  it("returns MALICIOUS when issuer domain is blocked", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "malicious.example" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ blockedDomains: ["malicious.example"] });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.MALICIOUS);
    expect(result.isSafe).toBe(false);
    expect(result.details).toContain("explicitly blocked");
  });

  it("returns TRUSTED for safe issuer even when domain appears suspicious", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "free-airdrop.example" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ safeIssuers: [validIssuer], enableScamDetection: true });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.status).toBe(TrustStatus.TRUSTED);
    expect(result.isSafe).toBe(true);
    expect(result.details).toContain("Not found");
  });

  it("blocks trustline execution when verified asset usage is required and asset is unverified", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "example.com" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ requireVerifiedAssetUsage: true });
    const gate = await framework.canExecuteTrustline("USD", validIssuer);

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("Trustline creation is gated to verified assets only");
    expect(gate.trustResult.status).toBe(TrustStatus.UNVERIFIED);
  });

  it("blocks trustline execution when unverified asset usage is disabled", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "example.com" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ allowUnverifiedAssetUsage: false });
    const gate = await framework.canExecuteTrustline("USD", validIssuer);

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("not permitted for unverified assets");
    expect(gate.trustResult.status).toBe(TrustStatus.UNVERIFIED);
  });

  it("attaches metadata from the metadata manager when available", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "example.com" });
    mockResolveToml.mockResolvedValueOnce({ CURRENCIES: [{ code: "USD", issuer: "GISSUER123" }] });

    const metadataManager = {
      getMetadata: jest.fn().mockResolvedValue({ value: JSON.stringify({ audit: "trusted" }), type: "json" }),
    } as unknown as StellarMetadataManager;

    const framework = new StellarTrustFramework({ enableScamDetection: true, metadataManager });
    const result = await framework.verifyAsset("USD", validIssuer);

    expect(result.metadata).toEqual({ audit: "trusted" });
    expect(metadataManager.getMetadata).toHaveBeenCalled();
  });

  it("blocks trustline execution for MALICIOUS domains", async () => {
    mockLoadAccount.mockResolvedValueOnce({ home_domain: "free-airdrop.example" });
    mockResolveToml.mockRejectedValueOnce(new Error("Not found"));

    const framework = new StellarTrustFramework({ enableScamDetection: true });
    const gate = await framework.canExecuteTrustline("USD", validIssuer);

    expect(gate.allowed).toBe(false);
    expect(gate.trustResult.status).toBe(TrustStatus.MALICIOUS);
  });
});
