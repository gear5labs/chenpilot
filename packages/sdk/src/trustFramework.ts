import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarMetadataManager } from "./metadata";
import { resolveIssuerFromDomain } from "./trustline";

export enum TrustStatus {
  VERIFIED = "VERIFIED",
  TRUSTED = "TRUSTED",
  UNVERIFIED = "UNVERIFIED",
  MALICIOUS = "MALICIOUS",
  BLOCKED = "BLOCKED",
}

export interface AssetTrustResult {
  assetCode: string;
  issuer: string;
  issuerDomain?: string;
  status: TrustStatus;
  isSafe: boolean;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionGateResult {
  allowed: boolean;
  reason?: string;
  trustResult: AssetTrustResult;
}

export interface TrustPolicyConfig {
  horizonUrl?: string;
  allowUnverifiedAssetUsage?: boolean;
  requireVerifiedAssetUsage?: boolean;
  enableScamDetection?: boolean;
  safeIssuers?: string[];
  blockedIssuers?: string[];
  safeAssets?: string[];
  blockedAssets?: string[];
  safeDomains?: string[];
  blockedDomains?: string[];
  metadataManager?: StellarMetadataManager;
}

interface NormalizedTrustPolicyConfig extends TrustPolicyConfig {
  allowUnverifiedAssetUsage: boolean;
  requireVerifiedAssetUsage: boolean;
  enableScamDetection: boolean;
  safeIssuers: string[];
  blockedIssuers: string[];
  safeAssets: string[];
  blockedAssets: string[];
  safeDomains: string[];
  blockedDomains: string[];
}

export class StellarTrustFramework {
  private server: StellarSdk.Horizon.Server;
  private policy: NormalizedTrustPolicyConfig;

  constructor(config: TrustPolicyConfig = {}) {
    this.server = new StellarSdk.Horizon.Server(
      config.horizonUrl || "https://horizon.stellar.org"
    );
    this.policy = {
      horizonUrl: config.horizonUrl || "https://horizon.stellar.org",
      allowUnverifiedAssetUsage: config.allowUnverifiedAssetUsage ?? false,
      requireVerifiedAssetUsage: config.requireVerifiedAssetUsage ?? false,
      enableScamDetection: config.enableScamDetection ?? true,
      safeIssuers: (config.safeIssuers || []).map((id) => id.trim()),
      blockedIssuers: (config.blockedIssuers || []).map((id) => id.trim()),
      safeAssets: (config.safeAssets || []).map((key) => key.trim().toUpperCase()),
      blockedAssets: (config.blockedAssets || []).map((key) => key.trim().toUpperCase()),
      safeDomains: (config.safeDomains || []).map((domain) => domain.toLowerCase()),
      blockedDomains: (config.blockedDomains || []).map((domain) => domain.toLowerCase()),
      metadataManager: config.metadataManager,
    };
  }

  private static normalizeIssuer(issuer: string): string {
    return issuer.trim();
  }

  private static normalizeAssetKey(assetCode: string, issuer: string): string {
    return `${assetCode.trim().toUpperCase()}:${issuer.trim()}`;
  }

  private static isIssuerDomain(value: string): boolean {
    return value.includes(".") && !value.toUpperCase().startsWith("G");
  }

  private static isValidStellarPublicKey(value: string): boolean {
    return /^[G][A-Z0-9]{55}$/.test(value.trim());
  }

  private static isSuspiciousDomain(domain: string): boolean {
    return /\b(free|bonus|giveaway|airdrop|claim|reward|loan|earn|wallet|verify|confirm|urgent|limited)\b/i.test(
      domain
    );
  }

  private async loadTrustMetadata(
    issuerAddress: string,
    assetCode: string
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.policy.metadataManager) {
      return undefined;
    }

    try {
      const metadataKey = `trust:asset:${assetCode.toUpperCase()}`;
      const entry = await this.policy.metadataManager.getMetadata({
        accountId: issuerAddress,
        key: metadataKey,
      });
      if (!entry) {
        return undefined;
      }

      try {
        return JSON.parse(entry.value);
      } catch {
        return { value: entry.value, type: entry.type } as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }

  private getStatusForSafeCandidate(
    hasVerifiedListing: boolean,
    isSafeAsset: boolean,
    isSafeIssuer: boolean,
    isSafeDomain: boolean
  ): TrustStatus {
    if (hasVerifiedListing) {
      return TrustStatus.VERIFIED;
    }
    if (isSafeAsset || isSafeIssuer || isSafeDomain) {
      return TrustStatus.TRUSTED;
    }
    return TrustStatus.UNVERIFIED;
  }

  private getBlockedReason(assetCode: string, issuerAddress: string): string | undefined {
    const assetKey = StellarTrustFramework.normalizeAssetKey(assetCode, issuerAddress);
    if ((this.policy.blockedAssets ?? []).includes(assetKey)) {
      return `Asset ${assetCode} from issuer ${issuerAddress} is explicitly blocked.`;
    }
    if ((this.policy.blockedIssuers ?? []).includes(issuerAddress)) {
      return `Issuer ${issuerAddress} is explicitly blocked.`;
    }
    return undefined;
  }

  private getDomainBlockReason(
    domain?: string,
    isSafeDomain: boolean = false,
    isSafeAsset: boolean = false,
    isSafeIssuer: boolean = false
  ): string | undefined {
    if (!domain) return undefined;
    const normalized = domain.toLowerCase();
    if ((this.policy.blockedDomains ?? []).includes(normalized)) {
      return `Domain ${domain} is explicitly blocked.`;
    }
    if (
      this.policy.enableScamDetection &&
      !isSafeDomain &&
      !isSafeAsset &&
      !isSafeIssuer &&
      StellarTrustFramework.isSuspiciousDomain(normalized)
    ) {
      return `Domain ${domain} contains suspicious terms commonly used by scam operators.`;
    }
    return undefined;
  }

  private async resolveIssuerId(assetCode: string, issuerOrDomain: string): Promise<string | undefined> {
    const cleaned = StellarTrustFramework.normalizeIssuer(issuerOrDomain);
    if (StellarTrustFramework.isIssuerDomain(cleaned)) {
      return await resolveIssuerFromDomain(cleaned, assetCode);
    }
    return cleaned;
  }

  public async verifyAsset(
    assetCode: string,
    issuerOrDomain: string
  ): Promise<AssetTrustResult> {
    const normalizedAssetCode = assetCode.trim().toUpperCase();
    const issuerInput = issuerOrDomain.trim();
    const issuerAddress = await this.resolveIssuerId(normalizedAssetCode, issuerInput);

    if (!issuerAddress) {
      return {
        assetCode: normalizedAssetCode,
        issuer: issuerInput,
        status: TrustStatus.UNVERIFIED,
        isSafe: false,
        details: `Could not resolve issuer for ${issuerInput}.`,
      };
    }

    const normalizedInputDomain = issuerInput.toLowerCase();
    const inputIsDomain = StellarTrustFramework.isIssuerDomain(issuerInput);
    const isSafeDomainInput =
      inputIsDomain && (this.policy.safeDomains ?? []).includes(normalizedInputDomain);
    const isBlockedDomainInput =
      inputIsDomain && (this.policy.blockedDomains ?? []).includes(normalizedInputDomain);

    if (isBlockedDomainInput) {
      return {
        assetCode: normalizedAssetCode,
        issuer: issuerAddress,
        issuerDomain: issuerInput,
        status: TrustStatus.MALICIOUS,
        isSafe: false,
        details: `Domain ${issuerInput} is explicitly blocked.`,
      };
    }

    const blockedReason = this.getBlockedReason(normalizedAssetCode, issuerAddress);
    if (blockedReason) {
      return {
        assetCode: normalizedAssetCode,
        issuer: issuerAddress,
        status: TrustStatus.BLOCKED,
        isSafe: false,
        details: blockedReason,
      };
    }

    if (!StellarTrustFramework.isValidStellarPublicKey(issuerAddress)) {
      return {
        assetCode: normalizedAssetCode,
        issuer: issuerAddress,
        status: TrustStatus.UNVERIFIED,
        isSafe: false,
        details: `Issuer ${issuerAddress} is not a valid Stellar public key.`,
      };
    }

    const safeAssetKey = StellarTrustFramework.normalizeAssetKey(normalizedAssetCode, issuerAddress);
    const isSafeAsset = (this.policy.safeAssets ?? []).includes(safeAssetKey);
    const isSafeIssuer = (this.policy.safeIssuers ?? []).includes(issuerAddress);

    let issuerDomain: string | undefined = isSafeDomainInput ? issuerInput : undefined;
    let verifiedListing = false;
    let tomlError: Error | undefined;
    let scamReason: string | undefined;
    let entryMetadata: Record<string, unknown> | undefined;
    let isSafeDomain = isSafeDomainInput;

    try {
      const issuerAccount = await this.server.loadAccount(issuerAddress);
      issuerDomain = issuerAccount.home_domain;
    } catch {
      if (!isSafeAsset && !isSafeIssuer && !isSafeDomain) {
        return {
          assetCode: normalizedAssetCode,
          issuer: issuerAddress,
          status: TrustStatus.UNVERIFIED,
          isSafe: this.policy.allowUnverifiedAssetUsage ?? false,
          details: "Issuer account could not be loaded.",
        };
      }
    }

    if (issuerDomain) {
      isSafeDomain = Boolean(
        issuerDomain &&
          (this.policy.safeDomains ?? []).includes(issuerDomain.toLowerCase())
      );
      const domainBlockReason = this.getDomainBlockReason(
        issuerDomain,
        isSafeDomain,
        isSafeAsset,
        isSafeIssuer
      );
      if (domainBlockReason) {
        return {
          assetCode: normalizedAssetCode,
          issuer: issuerAddress,
          issuerDomain,
          status: TrustStatus.MALICIOUS,
          isSafe: false,
          details: domainBlockReason,
        };
      }

      try {
        const toml = await StellarSdk.StellarToml.Resolver.resolve(issuerDomain);
        const currencies: Record<string, unknown>[] = toml.CURRENCIES || [];
        verifiedListing = currencies.some(
          (curr) =>
            String(curr.code).toUpperCase() === normalizedAssetCode &&
            String(curr.issuer) === issuerAddress
        );
      } catch (error) {
        tomlError = error as Error;
      }
    }

    if (
      this.policy.enableScamDetection &&
      !verifiedListing &&
      issuerDomain &&
      !isSafeDomain &&
      !isSafeAsset &&
      !isSafeIssuer
    ) {
      scamReason = StellarTrustFramework.isSuspiciousDomain(issuerDomain)
        ? `Possible scam domain detected: ${issuerDomain}`
        : undefined;
    }

    if (issuerAddress && this.policy.metadataManager) {
      entryMetadata = await this.loadTrustMetadata(issuerAddress, normalizedAssetCode);
    }

    const status = this.getStatusForSafeCandidate(
      verifiedListing,
      isSafeAsset,
      isSafeIssuer,
      isSafeDomain
    );

    const details = verifiedListing
      ? `Asset ${normalizedAssetCode} is listed in stellar.toml for ${issuerAddress}.`
      : scamReason
      ? scamReason
      : tomlError
      ? `Could not resolve stellar.toml for domain ${issuerDomain}: ${tomlError.message}`
      : issuerDomain
      ? `Asset ${normalizedAssetCode} is unverified for issuer ${issuerAddress}.`
      : status === TrustStatus.TRUSTED
      ? `Asset ${normalizedAssetCode} is considered trusted via safelist or issuer validation.`
      : "Issuer home_domain is missing.";

    const isSafe = status === TrustStatus.VERIFIED || status === TrustStatus.TRUSTED;

    return {
      assetCode: normalizedAssetCode,
      issuer: issuerAddress,
      issuerDomain,
      status,
      isSafe,
      details,
      metadata: entryMetadata,
    };
  }

  public async canExecuteTrustline(
    assetCode: string,
    issuerOrDomain: string
  ): Promise<ExecutionGateResult> {
    const trustResult = await this.verifyAsset(assetCode, issuerOrDomain);

    if (
      trustResult.status === TrustStatus.BLOCKED ||
      trustResult.status === TrustStatus.MALICIOUS
    ) {
      return {
        allowed: false,
        reason: trustResult.details || "This asset is explicitly blocked.",
        trustResult,
      };
    }

    if (trustResult.status === TrustStatus.UNVERIFIED) {
      if (this.policy.requireVerifiedAssetUsage) {
        return {
          allowed: false,
          reason:
            "Trustline creation is gated to verified assets only. Please verify the issuer's stellar.toml registration before proceeding.",
          trustResult,
        };
      }

      if (!this.policy.allowUnverifiedAssetUsage) {
        return {
          allowed: false,
          reason:
            "Trustline creation is not permitted for unverified assets under current policy.",
          trustResult,
        };
      }
    }

    return {
      allowed: true,
      trustResult,
      reason:
        trustResult.status === TrustStatus.UNVERIFIED
          ? "Asset is unverified. Proceed with caution."
          : undefined,
    };
  }
}
