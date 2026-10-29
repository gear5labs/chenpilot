/**
 * Core type definitions for Asset Intelligence Layer
 */

import type { AbortSignalLike } from '../../types';

export type Network = 'public' | 'testnet' | 'futurenet' | 'standalone';

// ─── Per-call options ─────────────────────────────────────────────────────────

/**
 * Per-provider deadline configuration.
 *
 * Each field caps how long (in milliseconds) a single outbound request to that
 * provider category may take before the operation is aborted with a timeout.
 * When omitted the orchestrator falls back to the default 5 000 ms built-in
 * deadline that was previously applied globally.
 */
export interface ProviderDeadlines {
  /** Maximum time (ms) for the Horizon + Stellar TOML metadata fetch. */
  metadataMs?: number;
  /** Maximum time (ms) for trust-signal provider calls. */
  trustMs?: number;
  /** Maximum time (ms) for compatibility provider calls. */
  compatibilityMs?: number;
}

/**
 * Options accepted by every public `AssetIntelligence` lookup method.
 *
 * Callers can supply either an external cancellation signal, provider-specific
 * deadlines, or both. The orchestrator merges them into a single per-request
 * AbortController so that whichever limit fires first wins.
 */
export interface AssetLookupOptions {
  /**
   * External signal used to cancel the entire lookup.  Passing an already-aborted
   * signal causes the method to reject immediately without touching the cache.
   */
  signal?: AbortSignalLike;
  /**
   * Fine-grained per-provider timeouts.  These are combined with `signal` so
   * that whichever limit fires first terminates the affected request.
   */
  deadlines?: ProviderDeadlines;
}

export interface Asset {
  code: string;
  issuer?: string;
  network: Network;
}

export interface AssetData {
  metadata?: AssetMetadata;
  metadataRevisionId?: string;
  price?: PriceInfo;
  trust?: TrustScore;
  compatibility?: CompatibilityMap;
  lastUpdated: number;
}

export interface AssetMetadata {
  name?: string;
  description?: string;
  image?: string;
  homeDomain?: string;
  decimals?: number;
  isAuthRequired?: boolean;
  authRevoked?: boolean;
  tomlUrl?: string;
  provenance?: MetadataProvenance[];
}

export interface MetadataProvenance {
  provider: 'horizon' | 'stellar_toml';
  url: string;
  fetchedAt: number;
}

export interface MetadataRevision {
  revisionId: string; // content hash of asset + metadata
  asset: Asset;
  metadata: AssetMetadata;
  recordedAt: number;
}

export interface PriceInfo {
  price: number;
  priceChange24h?: number;
  volume24h?: number;
  lastTrade?: number;
  source: string;
  timestamp: number;
}

export type PriceResult =
  | { status: 'available'; price: PriceInfo }
  | { status: 'unavailable'; reason: 'no_configured_source' | 'provider_unavailable' };

export interface TrustScore {
  overall: number; // 0-100
  confidence: number; // 0-100, proportion of configured signal weight observed fresh
  signals: TrustSignal[];
  verificationStatus: 'verified' | 'unverified' | 'malicious';
  lastUpdated: number;
}

export interface TrustSignal {
  type: string;
  value: number;
  weight: number;
  description: string;
  source: string;
  timestamp: number;
}

export interface CompatibilityMap {
  [network: string]: CompatibilityResult;
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
  warnings: string[];
  lastChecked: number;
}

export interface CompatibilityContext {
  network: Network;
  operation?: Operation;
  version?: string;
}

export type Operation = 
  | 'payment'
  | 'create_account'
  | 'manage_sell_offer'
  | 'manage_buy_offer'
  | 'set_trustline'
  | 'change_trust';

export interface AssetEvent {
  type: 'price_change' | 'metadata_update' | 'trust_change' | 'compatibility_change' | 'manual_invalidation';
  asset: Asset;
  timestamp: number;
  data?: any;
}

export interface VerificationResult {
  verified: boolean;
  status: 'verified' | 'unverified' | 'malicious';
  reasons: string[];
  score: number;
}

export interface PriceSource {
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
}

export interface TrustSource {
  name: string;
  type: 'domain' | 'issuer' | 'community' | 'blacklist';
  priority: number;
  enabled: boolean;
}

export interface CacheConfig {
  memory: {
    maxSize: number;
    ttl: number;
  };
  persistent: {
    enabled: boolean;
    path: string;
    ttl: number;
  };
  remote?: {
    enabled: boolean;
    host: string;
    port: number;
    ttl: number;
  };
}

export interface AssetIntelligenceConfig {
  cache: CacheConfig;
  providers: {
    metadata: {
      horizonUrl: string;
      tomlUrl?: string;
    };
    price: {
      sources: PriceSource[];
      updateInterval: number;
    };
    trust: {
      sources: TrustSource[];
      weights: Record<string, number>;
    };
  };
  invalidation: {
    priceChangeThreshold: number; // basis points
    maxAge: number; // milliseconds
    eventDriven: boolean;
  };
  compatibility: {
    strictMode: boolean;
    allowedNetworks: Network[];
    blockedIssuers: string[];
  };
}

export type ErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'METADATA_UNAVAILABLE'
  | 'PRICE_UNAVAILABLE'
  | 'TRUST_CHECK_FAILED'
  | 'COMPATIBILITY_CHECK_FAILED'
  | 'CACHE_ERROR'
  | 'PROVIDER_ERROR';

export class AssetIntelligenceError extends Error {
  code: ErrorCode;
  asset?: Asset;
  context?: Record<string, any>;

  constructor(code: ErrorCode, message: string, asset?: Asset, context?: Record<string, any>) {
    super(message);
    this.name = 'AssetIntelligenceError';
    this.code = code;
    this.asset = asset;
    this.context = context;
  }
}
