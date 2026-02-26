import * as StellarSdk from "@stellar/stellar-sdk";

export interface VerificationResult {
  isSafe: boolean;
  domain?: string;
  status: "VERIFIED" | "UNVERIFIED" | "MALICIOUS";
  details?: string;
}

export class AssetVerificationService {
  private horizonServer: StellarSdk.Horizon.Server;

  constructor(horizonUrl: string) {
    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
  }

  /**
   * Requirement: Verify asset against home_domain and TOML files.
   * Priority: High
   */
  async verifyAsset(
    assetCode: string,
    issuerAddress: string
  ): Promise<VerificationResult> {
    try {
      // 1. Fetch Issuer Account to get home_domain
      const issuerAccount = await this.horizonServer.loadAccount(issuerAddress);
      const homeDomain = issuerAccount.home_domain;

      if (!homeDomain) {
        return {
          isSafe: false,
          status: "UNVERIFIED",
          details: "No home_domain set on issuer account.",
        };
      }

      // 2. Resolve and Fetch TOML (SEP-1)
      const toml = await StellarSdk.StellarToml.Resolver.resolve(homeDomain);

      // 3. Verify Asset is listed in TOML
      const verifiedAssets = toml.CURRENCIES || [];
      const isListed = verifiedAssets.some(
        (curr: Record<string, unknown>) =>
          curr.code === assetCode && curr.issuer === issuerAddress
      );

      if (isListed) {
        return {
          isSafe: true,
          domain: homeDomain,
          status: "VERIFIED",
        };
      }

      return {
        isSafe: false,
        domain: homeDomain,
        status: "MALICIOUS",
        details:
          "Asset issuer claims domain but asset is not listed in TOML file.",
      };
    } catch (error) {
      console.error("Asset verification error:", error);
      return {
        isSafe: false,
        status: "UNVERIFIED",
        details: "Verification failed due to network or TOML resolution error.",
      };
    }
  }
}
