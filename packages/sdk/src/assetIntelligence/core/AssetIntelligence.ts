/**
 * Asset Intelligence - Main Orchestrator
 * Coordinates all asset intelligence operations
 */

import { AssetCache } from './AssetCache';
import { CacheInvalidator } from './CacheInvalidator';
import { MetadataRevisionStore } from './MetadataRevisionStore';
import { TrustScorer } from '../trust/TrustScorer';
import { TrustSignals } from '../trust/TrustSignals';
import { TrustRegistry } from '../trust/TrustRegistry';
import { AssetValidator } from '../compatibility/AssetValidator';
import { NetworkCompatibility } from '../compatibility/NetworkCompatibility';
import { VersionCompatibility } from '../compatibility/VersionCompatibility';
import { 
  Asset, 
  AssetData, 
  PriceResult,
  TrustScore, 
  CompatibilityResult, 
  CompatibilityContext,
  AssetIntelligenceConfig,
  AssetEvent,
  AssetIntelligenceError,
  ErrorCode,
  MetadataRevision,
} from './types';

export class AssetIntelligence {
  private cache: AssetCache;
  private invalidator: CacheInvalidator;
  private trustScorer: TrustScorer;
  private trustSignals: TrustSignals;
  private trustRegistry: TrustRegistry;
  private assetValidator: AssetValidator;
  private networkCompatibility: NetworkCompatibility;
  private versionCompatibility: VersionCompatibility;
  private metadataRevisions: MetadataRevisionStore;
  private config: AssetIntelligenceConfig;

  constructor(config: AssetIntelligenceConfig) {
    this.config = config;

    // Initialize metadata revision store (kept separate from the cache so
    // invalidation and TTL expiry never remove historical revisions)
    this.metadataRevisions = new MetadataRevisionStore();
    
    // Initialize cache
    this.cache = new AssetCache(config.cache);
    
    // Initialize invalidator
    this.invalidator = new CacheInvalidator(this.cache, config.invalidation);
    
    // Initialize trust components
    this.trustRegistry = new TrustRegistry();
    this.trustSignals = new TrustSignals();
    this.trustScorer = new TrustScorer(
      this.trustSignals,
      this.trustRegistry,
      {
        weights: config.providers.trust.weights,
        thresholds: {
          verified: 80,
          unverified: 50,
          malicious: 20,
        },
      }
    );
    
    // Initialize compatibility components
    this.assetValidator = new AssetValidator({
      strictMode: config.compatibility.strictMode,
      allowedNetworks: config.compatibility.allowedNetworks,
      blockedIssuers: config.compatibility.blockedIssuers,
      requireAuth: true,
      requireTOML: false,
    });
    
    this.networkCompatibility = new NetworkCompatibility();
    this.versionCompatibility = new VersionCompatibility();
  }

  /**
   * Get comprehensive asset information
   */
  async getAssetInfo(asset: Asset): Promise<AssetData | null> {
    try {
      // Check cache first
      const cached = await this.cache.get(asset, 'general');
      if (cached) {
        return cached;
      }

      // Fetch metadata
      const metadata = await this.fetchMetadata(asset);

      // Record the metadata revision so historical records can refer to it
      const revision = this.metadataRevisions.record(asset, metadata);
      
      // Fetch trust score
      const trust = await this.trustScorer.calculateTrustScore(asset);
      
      // Check compatibility
      const compatibility = await this.checkCompatibility(asset, {
        network: asset.network,
      });

      const assetData: AssetData = {
        metadata,
        metadataRevisionId: revision.revisionId,
        trust,
        compatibility: {
          [asset.network]: compatibility,
        },
        lastUpdated: Date.now(),
      };

      // Cache the result
      await this.cache.set(asset, 'general', assetData);

      return assetData;
    } catch (error) {
      throw new AssetIntelligenceError(
        'PROVIDER_ERROR',
        `Failed to get asset info: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Get asset price information
   */
  async getAssetPrice(asset: Asset): Promise<PriceResult> {
    try {
      // Check cache first
      const cached = await this.cache.get(asset, 'price');
      if (cached && cached.price) {
        return { status: 'available', price: cached.price };
      }

      const hasConfiguredSource = this.config.providers.price.sources.some(source => source.enabled);
      return {
        status: 'unavailable',
        reason: hasConfiguredSource ? 'provider_unavailable' : 'no_configured_source',
      };
    } catch (error) {
      throw new AssetIntelligenceError(
        'PRICE_UNAVAILABLE',
        `Failed to get asset price: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Get trust score for asset
   */
  async getTrustScore(asset: Asset): Promise<TrustScore> {
    try {
      // Check cache first
      const cached = await this.cache.get(asset, 'trust');
      if (cached && cached.trust) {
        return cached.trust;
      }

      // Calculate trust score
      const trustScore = await this.trustScorer.calculateTrustScore(asset);

      // Cache the result
      const assetData: AssetData = {
        trust: trustScore,
        lastUpdated: Date.now(),
      };
      await this.cache.set(asset, 'trust', assetData);

      return trustScore;
    } catch (error) {
      throw new AssetIntelligenceError(
        'TRUST_CHECK_FAILED',
        `Failed to get trust score: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Check asset compatibility
   */
  async checkCompatibility(asset: Asset, context: CompatibilityContext): Promise<CompatibilityResult> {
    try {
      // Check cache first
      const cacheKey = `${context.network}:${context.operation || 'any'}:${context.version || 'any'}`;
      const cached = await this.cache.get(asset, 'compatibility');
      if (cached?.compatibility?.[cacheKey]) {
        return cached.compatibility[cacheKey];
      }

      // Check network compatibility
      const networkResult = await this.networkCompatibility.checkCompatibility(asset, context);

      // Check asset validation
      const validationResult = await this.assetValidator.validateMetadata(asset, {});

      const reasons = [...networkResult.reasons, ...validationResult.reasons];
      const warnings = [...networkResult.warnings, ...validationResult.reasons];
      const compatible = networkResult.compatible && validationResult.verified;

      const result: CompatibilityResult = {
        compatible,
        reasons,
        warnings,
        lastChecked: Date.now(),
      };

      // Cache the result
      const assetData: AssetData = {
        compatibility: {
          ...cached?.compatibility,
          [cacheKey]: result,
        },
        lastUpdated: Date.now(),
      };
      await this.cache.set(asset, 'compatibility', assetData);

      return result;
    } catch (error) {
      throw new AssetIntelligenceError(
        'COMPATIBILITY_CHECK_FAILED',
        `Failed to check compatibility: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Get the exact metadata revision a historical record was built from.
   * Revisions are kept when the cache is invalidated, refreshed or cleared.
   */
  getMetadataRevision(revisionId: string): MetadataRevision | undefined {
    return this.metadataRevisions.get(revisionId);
  }

  /**
   * Get all recorded metadata revisions for an asset, oldest first.
   */
  getMetadataHistory(asset: Asset): MetadataRevision[] {
    return this.metadataRevisions.getHistory(asset);
  }

  /**
   * Invalidate asset cache
   */
  async invalidateAsset(asset: Asset): Promise<void> {
    await this.cache.invalidate(asset);
  }

  /**
   * Refresh asset data
   */
  async refreshAsset(asset: Asset): Promise<void> {
    await this.invalidateAsset(asset);
    await this.getAssetInfo(asset); // This will re-fetch and cache
  }

  /**
   * Handle asset event
   */
  async handleEvent(event: AssetEvent): Promise<void> {
    await this.invalidator.invalidateOnEvent(event);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  /** Fetch metadata only from the configured Horizon and Stellar TOML providers. */
  private async fetchMetadata(asset: Asset) {
    const horizonUrl = this.config.providers.metadata.horizonUrl.replace(/\/$/, '');
    if (!horizonUrl) {
      throw new AssetIntelligenceError('METADATA_UNAVAILABLE', 'No Horizon metadata provider is configured', asset);
    }

    const assetUrl = new URL(`${horizonUrl}/assets`);
    assetUrl.searchParams.set('asset_code', asset.code);
    if (asset.issuer) assetUrl.searchParams.set('asset_issuer', asset.issuer);

    const assetResponse = await this.fetchProvider(assetUrl.toString());
    if (!assetResponse.ok) {
      throw new AssetIntelligenceError('METADATA_UNAVAILABLE', `Horizon returned HTTP ${assetResponse.status}`, asset);
    }

    const assetPayload = await assetResponse.json() as { _embedded?: { records?: Array<Record<string, unknown>> } };
    const record = assetPayload?._embedded?.records?.find(candidate =>
      candidate.asset_code === asset.code && (!asset.issuer || candidate.asset_issuer === asset.issuer)
    );
    if (!record) {
      throw new AssetIntelligenceError('ASSET_NOT_FOUND', `Asset ${asset.code} was not found by Horizon`, asset);
    }

    const now = Date.now();
    const provenance: NonNullable<AssetData['metadata']>['provenance'] = [
      { provider: 'horizon', url: assetUrl.toString(), fetchedAt: now },
    ];
    const homeDomain = typeof record.home_domain === 'string' ? record.home_domain : undefined;
    const tomlUrl = this.config.providers.metadata.tomlUrl
      || (homeDomain ? `https://${homeDomain}/.well-known/stellar.toml` : undefined);
    const metadata: NonNullable<AssetData['metadata']> = { homeDomain, tomlUrl, provenance };

    if (tomlUrl) {
      const tomlResponse = await this.fetchProvider(tomlUrl);
      if (!tomlResponse.ok) {
        throw new AssetIntelligenceError('METADATA_UNAVAILABLE', `Stellar TOML returned HTTP ${tomlResponse.status}`, asset);
      }
      const toml = await tomlResponse.text();
      const currency = this.parseTomlCurrency(toml, asset);
      if (!currency) {
        throw new AssetIntelligenceError('METADATA_UNAVAILABLE', `Stellar TOML has no valid entry for ${asset.code}`, asset);
      }
      Object.assign(metadata, currency);
      provenance.push({ provider: 'stellar_toml', url: tomlUrl, fetchedAt: Date.now() });
    }

    return metadata;
  }

  private async fetchProvider(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (error) {
      throw new AssetIntelligenceError(
        'METADATA_UNAVAILABLE',
        `Metadata provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseTomlCurrency(toml: string, asset: Asset): Partial<NonNullable<AssetData['metadata']>> | null {
    const blocks = toml.split(/^\s*\[\[CURRENCIES\]\]\s*$/m).slice(1);
    const block = blocks.find(candidate => {
      const code = candidate.match(/^\s*code\s*=\s*["']([^"']+)["']/m)?.[1];
      const issuer = candidate.match(/^\s*issuer\s*=\s*["']([^"']+)["']/m)?.[1];
      return code === asset.code && (!asset.issuer || issuer === asset.issuer);
    });
    if (!block) return null;

    const readString = (key: string) => block.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'))?.[1];
    const decimalsText = block.match(/^\s*display_decimals\s*=\s*(\d+)\s*$/m)?.[1];
    const decimals = decimalsText === undefined ? undefined : Number(decimalsText);
    if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)) return null;
    return {
      name: readString('name'),
      description: readString('desc'),
      image: readString('image'),
      decimals,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AssetIntelligenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): AssetIntelligenceConfig {
    return { ...this.config };
  }

  /**
   * Destroy and clean up resources
   */
  destroy(): void {
    this.invalidator.destroy();
  }
}
