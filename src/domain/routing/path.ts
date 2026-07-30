import { Asset, AssetAmount } from '../assets';
import { BaseEntity, UUID } from '../common';
import * as StellarSdk from '@stellar/stellar-sdk';

export interface PathNode {
  asset: Asset;
  amount: string;
  price: string;
}

export interface PathEdge {
  from: Asset;
  to: Asset;
  price: string;
  liquidity: string;
  exchangeId: string;
}

export interface PathProps {
  id: UUID;
  sourceAmount: AssetAmount;
  destinationAmount: AssetAmount;
  nodes: PathNode[];
  edges: PathEdge[];
  totalFee: string;
  estimatedTime: number; // milliseconds
}

export class Path implements BaseEntity {
  constructor(
    public readonly id: UUID,
    public readonly sourceAmount: AssetAmount,
    public readonly destinationAmount: AssetAmount,
    public readonly nodes: PathNode[],
    public readonly edges: PathEdge[],
    public readonly totalFee: string,
    public readonly estimatedTime: number,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number
  ) {}

  getHopCount(): number {
    return this.nodes.length;
  }

  getPriceImpact(): string {
    if (this.nodes.length === 0) return '0';
    const firstPrice = parseFloat(this.nodes[0].price);
    const lastPrice = parseFloat(this.nodes[this.nodes.length - 1].price);
    return ((lastPrice - firstPrice) / firstPrice * 100).toString();
  }

  toString(): string {
    const pathString = this.nodes.map(node => node.asset.code).join(' → ');
    return `${pathString}: ${this.sourceAmount.amount} → ${this.destinationAmount.amount}`;
  }
}

export interface PathRequest {
  sourceAsset: Asset;
  destinationAsset: Asset;
  amount: string;
  maxHops?: number;
  preferLiquidity?: boolean;
}

// --- Added for shared multi-hop routing types ---
export interface TradePath {
  path: StellarSdk.Asset[];
  sourceAmount: string;
  destinationAmount: string;
  priceImpact: number;
  estimatedSlippage: number;
  hops: number;
  route: string[];
  /**
   * Normalized efficiency score in [0, 1].
   * Computed as: (destAmount / bestDestAmount) * hopDiscount * slippageDiscount
   * Scores are dimensionless and comparable across paths for the same trade.
   */
  efficiency: number;
}

export interface PathEvaluationResult {
  bestPath: TradePath;
  allPaths: TradePath[];
  evaluationTime: number;
  timestamp: number;
}

export interface PathFinderOptions {
  maxHops?: number;
  minDestinationAmount?: string;
  includeAssets?: StellarSdk.Asset[];
  /** Hard timeout in ms. Defaults to 10 000. */
  timeout?: number;
  /** Route policy to enforce. Defaults to DEFAULT_ROUTE_POLICY. */
  policy?: RoutePolicy;
}

export interface RoutePolicy {
  /** Minimum normalized efficiency score [0, 1]. */
  minEfficiency: number;
  /** Maximum estimated slippage as a fraction (e.g. 0.05 = 5%). */
  maxSlippage: number;
  /** Maximum number of hops allowed. */
  maxHops: number;
}

export class RoutePolicyViolationError extends Error {
  constructor(
    public readonly reason: string,
    public readonly bestAvailable: TradePath
  ) {
    super(`Route policy violation: ${reason}`);
    this.name = 'RoutePolicyViolationError';
  }
}

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  minEfficiency: 0.7,
  maxSlippage: 0.05,
  maxHops: 5,
};

// --- Shared utilities for Stellar assets ---
export function parseStellarAsset(assetData: {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}): StellarSdk.Asset {
  if (assetData.asset_type === 'native') return StellarSdk.Asset.native();
  return new StellarSdk.Asset(assetData.asset_code!, assetData.asset_issuer!);
}

export function stellarAssetToString(asset: StellarSdk.Asset): string {
  if (asset.isNative()) return 'XLM';
  return `${asset.getCode()}:${asset.getIssuer().substring(0, 8)}...`;
}

