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
  AssetLookupOptions,
  PriceResult,
  TrustScore,
  CompatibilityResult,
  CompatibilityContext,
  AssetIntelligenceConfig,
  AssetEvent,
  AssetIntelligenceError,
  MetadataRevision,
} from './types';
import { combineSignals, isAbortError, throwIfAborted } from '../../abort';

/** Default per-provider request deadline when none is configured by the caller. */
const DEFAULT_PROVIDER_TIMEOUT_MS = 5_000;

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
   * Get comprehensive asset information.
   *
   * @param asset - The asset to look up.
   * @param options - Optional cancellation signal and per-provider deadlines.
   *   When the signal fires (or any deadline fires) before all providers have
   *   responded, the returned promise rejects with an AbortError and the cache
   *   is NOT populated with partial data.
   */
  async getAssetInfo(asset: Asset, options: AssetLookupOptions = {}): Promise<AssetData | null> {
    throwIfAborted(options.signal);

    try {
      // Check cache first — a cache hit never touches external providers so no
      // deadline is needed here.
      const cached = await this.cache.get(asset, 'general');
      if (cached) {
        return cached;
      }

      // ── Metadata ──────────────────────────────────────────────────────────
      const metadata = await this.fetchMetadata(asset, options);

      // ── Abort check before any further work ───────────────────────────────
      // If the caller cancelled while the metadata fetch was in flight, stop
      // here — do NOT record a revision or call downstream providers.
      throwIfAborted(options.signal);

      // Record the metadata revision so historical records can refer to it
      const revision = this.metadataRevisions.record(asset, metadata);

      // ── Trust score ───────────────────────────────────────────────────────
      const trustSignal = this.buildProviderSignal(options, options.deadlines?.trustMs);
      let trust: TrustScore;
      try {
        trust = await this.trustScorer.calculateTrustScore(asset, trustSignal.signal);
      } finally {
        trustSignal.cleanup();
      }

      throwIfAborted(options.signal);

      // ── Compatibility ─────────────────────────────────────────────────────
      const compatibility = await this.checkCompatibility(asset, { network: asset.network }, options);

      throwIfAborted(options.signal);

      const assetData: AssetData = {
        metadata,
        metadataRevisionId: revision.revisionId,
        trust,
        compatibility: {
          [asset.network]: compatibility,
        },
        lastUpdated: Date.now(),
      };

      // Only write to the cache once ALL providers have responded successfully
      // and the operation has not been cancelled.
      await this.cache.set(asset, 'general', assetData);

      return assetData;
    } catch (error) {
      // Re-throw abort errors with their original identity so callers can
      // distinguish cancellation from ordinary provider failures.
      if (isAbortError(error)) throw error;
      throw new AssetIntelligenceError(
        'PROVIDER_ERROR',
        `Failed to get asset info: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Get asset price information.
   *
   * @param asset - The asset to price.
   * @param options - Optional cancellation signal and per-provider deadlines.
   */
  async getAssetPrice(asset: Asset, options: AssetLookupOptions = {}): Promise<PriceResult> {
    throwIfAborted(options.signal);

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
      if (isAbortError(error)) throw error;
      throw new AssetIntelligenceError(
        'PRICE_UNAVAILABLE',
        `Failed to get asset price: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Get trust score for an asset.
   *
   * @param asset - The asset to score.
   * @param options - Optional cancellation signal and per-provider deadlines.
   *   When aborted, the cache is not populated with partial data.
   */
  async getTrustScore(asset: Asset, options: AssetLookupOptions = {}): Promise<TrustScore> {
    throwIfAborted(options.signal);

    try {
      // Check cache first
      const cached = await this.cache.get(asset, 'trust');
      if (cached && cached.trust) {
        return cached.trust;
      }

      // Merge the caller's external signal with the trust-specific deadline.
      const trustSignal = this.buildProviderSignal(options, options.deadlines?.trustMs);
      let trustScore: TrustScore;
      try {
        trustScore = await this.trustScorer.calculateTrustScore(asset, trustSignal.signal);
      } finally {
        trustSignal.cleanup();
      }

      // Guard: do not cache if the caller's signal fired during the fetch.
      throwIfAborted(options.signal);

      const assetData: AssetData = {
        trust: trustScore,
        lastUpdated: Date.now(),
      };
      await this.cache.set(asset, 'trust', assetData);

      return trustScore;
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new AssetIntelligenceError(
        'TRUST_CHECK_FAILED',
        `Failed to get trust score: ${error instanceof Error ? error.message : String(error)}`,
        asset
      );
    }
  }

  /**
   * Check asset compatibility against a network/operation context.
   *
   * @param asset - The asset to check.
   * @param context - The network / operation context.
   * @param options - Optional cancellation signal and per-provider deadlines.
   *   When aborted, the cache is not populated with partial data.
   */
  async checkCompatibility(
    asset: Asset,
    context: CompatibilityContext,
    options: AssetLookupOptions = {},
  ): Promise<CompatibilityResult> {
    throwIfAborted(options.signal);

    try {
      // Check cache first
      const cacheKey = `${context.network}:${context.operation || 'any'}:${context.version || 'any'}`;
      const cached = await this.cache.get(asset, 'compatibility');
      if (cached?.compatibility?.[cacheKey]) {
        return cached.compatibility[cacheKey];
      }

      // Build a per-compatibility deadline signal.
      const compatSignal = this.buildProviderSignal(options, options.deadlines?.compatibilityMs);
      let networkResult: CompatibilityResult;
      let validationResult: Awaited<ReturnType<AssetValidator['validateMetadata']>>;
      try {
        // Both calls share the same combined signal — if either the external
        // signal or the compatibility deadline fires, both stop.
        networkResult = await this.networkCompatibility.checkCompatibility(
          asset,
          context,
          compatSignal.signal,
        );
        validationResult = await this.assetValidator.validateMetadata(
          asset,
          {},
          compatSignal.signal,
        );
      } finally {
        compatSignal.cleanup();
      }

      // Guard: do not cache if the caller's signal fired.
      throwIfAborted(options.signal);

      const reasons = [...networkResult.reasons, ...validationResult.reasons];
      const warnings = [...networkResult.warnings, ...validationResult.reasons];
      const compatible = networkResult.compatible && validationResult.verified;

      const result: CompatibilityResult = {
        compatible,
        reasons,
        warnings,
        lastChecked: Date.now(),
      };

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
      if (isAbortError(error)) throw error;
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
    await this.getAssetInfo(asset);
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

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Builds a `CombinedSignal` for a single provider call by merging the
   * caller's external signal with an optional per-provider deadline.
   *
   * When no deadline is provided for the provider category, the SDK-wide
   * default (DEFAULT_PROVIDER_TIMEOUT_MS) is used so every outbound request
   * has a bounded lifetime even without explicit caller configuration.
   *
   * Always call `.cleanup()` in a `finally` block to release the timeout and
   * remove the abort listener from the external signal.
   */
  private buildProviderSignal(
    options: AssetLookupOptions,
    providerDeadlineMs: number | undefined,
  ) {
    const timeoutMs = providerDeadlineMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    return combineSignals(timeoutMs, options.signal);
  }

  /**
   * Fetch metadata from the configured Horizon and Stellar TOML providers.
   *
   * Uses the caller-supplied `options.signal` merged with the metadata-specific
   * deadline (`options.deadlines?.metadataMs`), falling back to
   * DEFAULT_PROVIDER_TIMEOUT_MS when neither is set.
   */
  private async fetchMetadata(asset: Asset, options: AssetLookupOptions = {}) {
    const horizonUrl = this.config.providers.metadata.horizonUrl.replace(/\/$/, '');
    if (!horizonUrl) {
      throw new AssetIntelligenceError('METADATA_UNAVAILABLE', 'No Horizon metadata provider is configured', asset);
    }

    const assetUrl = new URL(`${horizonUrl}/assets`);
    assetUrl.searchParams.set('asset_code', asset.code);
    if (asset.issuer) assetUrl.searchParams.set('asset_issuer', asset.issuer);

    const assetResponse = await this.fetchProvider(
      assetUrl.toString(),
      options,
      options.deadlines?.metadataMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    );
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
      // Re-check cancellation before the second network hop.
      throwIfAborted(options.signal);

      const tomlResponse = await this.fetchProvider(
        tomlUrl,
        options,
        options.deadlines?.metadataMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      );
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

  /**
   * Execute a single HTTP request to an external provider.
   *
   * Merges the caller's external cancellation signal with the appropriate
   * per-provider deadline (via `combineSignals`) so whichever fires first
   * aborts the fetch.  The timeout is always cleared in the `finally` block
   * to prevent leaks on both success and failure paths.
   *
   * @param url - The URL to fetch.
   * @param options - Caller-supplied lookup options (signal + deadlines).
   * @param provider - Which provider category is making this call, used to
   *   select the correct per-provider deadline.
   */
  private async fetchProvider(
    url: string,
    options: AssetLookupOptions = {},
    deadlineMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
  ): Promise<Response> {
    const { signal, cleanup } = combineSignals(deadlineMs, options.signal);
    try {
      return await fetch(url, { signal: signal as AbortSignal | undefined });
    } catch (error) {
      // Preserve abort identity — do NOT wrap it in AssetIntelligenceError.
      if (isAbortError(error)) throw error;
      throw new AssetIntelligenceError(
        'METADATA_UNAVAILABLE',
        `Metadata provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      cleanup();
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
