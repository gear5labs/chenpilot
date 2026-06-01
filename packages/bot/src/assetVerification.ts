import {
  StellarTrustFramework,
  AssetTrustResult,
  TrustPolicyConfig,
  StellarMetadataManager,
} from "@chen-pilot/sdk-core";

const parseCsv = (value?: string): string[] =>
  value
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];

export class AssetVerificationService {
  private trustFramework: StellarTrustFramework;

  constructor(horizonUrl: string, metadataManager?: StellarMetadataManager) {
    const config: TrustPolicyConfig = {
      horizonUrl,
      enableScamDetection: true,
      allowUnverifiedAssetUsage: false,
      requireVerifiedAssetUsage: false,
      safeIssuers: parseCsv(process.env.TRUST_SAFE_ISSUERS),
      blockedIssuers: parseCsv(process.env.TRUST_BLOCKED_ISSUERS),
      safeAssets: parseCsv(process.env.TRUST_SAFE_ASSETS),
      blockedAssets: parseCsv(process.env.TRUST_BLOCKED_ASSETS),
      safeDomains: parseCsv(process.env.TRUST_SAFE_DOMAINS),
      blockedDomains: parseCsv(process.env.TRUST_BLOCKED_DOMAINS),
      metadataManager,
    };

    this.trustFramework = new StellarTrustFramework(config);
  }

  async verifyAsset(assetCode: string, issuerAddress: string): Promise<AssetTrustResult> {
    return this.trustFramework.verifyAsset(assetCode, issuerAddress);
  }

  async canExecuteTrustline(assetCode: string, issuerAddress: string) {
    return this.trustFramework.canExecuteTrustline(assetCode, issuerAddress);
  }
}
