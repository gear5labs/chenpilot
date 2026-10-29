/**
 * Trust Score Calculation
 * Aggregates and calculates trust scores from multiple signals
 */

import { TrustSignal, TrustScore, Asset } from '../core/types';
import { TrustSignals } from './TrustSignals';
import { TrustRegistry } from './TrustRegistry';

export interface TrustConfig {
  weights: Record<string, number>;
  thresholds: {
    verified: number;
    unverified: number;
    malicious: number;
  };
}

export class TrustScorer {
  private static readonly MAX_SIGNAL_AGE_MS = 24 * 60 * 60 * 1000;
  private trustSignals: TrustSignals;
  private trustRegistry: TrustRegistry;
  private config: TrustConfig;

  constructor(trustSignals: TrustSignals, trustRegistry: TrustRegistry, config: TrustConfig) {
    this.trustSignals = trustSignals;
    this.trustRegistry = trustRegistry;
    this.config = config;
  }

  /**
   * Calculate overall trust score for an asset
   */
  async calculateTrustScore(asset: Asset): Promise<TrustScore> {
    const fetchedSignals = await this.trustSignals.getAllSignals(asset);
    const now = Date.now();
    const signals = fetchedSignals.filter(signal =>
      Number.isFinite(signal.value)
      && signal.value >= 0
      && signal.value <= 100
      && Number.isFinite(signal.timestamp)
      && now - signal.timestamp >= 0
      && now - signal.timestamp <= TrustScorer.MAX_SIGNAL_AGE_MS
    );
    const { overall, confidence } = this.calculateWeightedScore(signals);
    const hasMaliciousSignal = signals.some(signal => signal.value <= this.config.thresholds.malicious);
    const verificationStatus = hasMaliciousSignal
      ? 'malicious'
      : confidence > 0 ? this.determineVerificationStatus(overall) : 'unverified';

    return {
      overall,
      confidence,
      signals,
      verificationStatus,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate weighted score from signals
   */
  private calculateWeightedScore(signals: TrustSignal[]): { overall: number; confidence: number } {
    const configuredWeights = Object.entries(this.config.weights)
      .filter(([, weight]) => Number.isFinite(weight) && weight > 0);
    const totalWeight = configuredWeights.reduce((total, [, weight]) => total + weight, 0);
    if (totalWeight === 0) return { overall: 0, confidence: 0 };

    let weightedSum = 0;
    let observedWeight = 0;

    for (const signal of signals) {
      const weight = this.config.weights[signal.type] || 0;
      if (weight === 0) continue;
      weightedSum += signal.value * weight;
      observedWeight += weight;
    }

    return {
      overall: Math.round(weightedSum / totalWeight),
      confidence: Math.round((observedWeight / totalWeight) * 100),
    };
  }

  /**
   * Determine verification status based on score
   */
  private determineVerificationStatus(score: number): 'verified' | 'unverified' | 'malicious' {
    if (score >= this.config.thresholds.verified) {
      return 'verified';
    } else if (score <= this.config.thresholds.malicious) {
      return 'malicious';
    } else {
      return 'unverified';
    }
  }

  /**
   * Check if asset is in trust registry
   */
  async isInRegistry(asset: Asset): Promise<boolean> {
    return this.trustRegistry.contains(asset);
  }

  /**
   * Get registry entry for asset
   */
  async getRegistryEntry(asset: Asset) {
    return this.trustRegistry.getEntry(asset);
  }

  /**
   * Update trust configuration
   */
  updateConfig(config: Partial<TrustConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
