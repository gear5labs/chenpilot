import { Asset } from '../core/types';
import { TrustRegistry } from '../trust/TrustRegistry';
import { TrustScorer } from '../trust/TrustScorer';
import { TrustSignals } from '../trust/TrustSignals';

const asset: Asset = { code: 'TEST', issuer: 'GTEST', network: 'public' };

describe('trust signals without configured sources', () => {
  it('returns every unconfigured signal as unknown instead of a placeholder score', async () => {
    const signals = await new TrustSignals().getAllSignals(asset);

    expect(signals).toHaveLength(6);
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'domain_verification', value: null, status: 'unknown', source: 'unconfigured' }),
      expect.objectContaining({ type: 'issuer_reputation', value: null, status: 'unknown', source: 'unconfigured' }),
      expect.objectContaining({ type: 'asset_age', value: null, status: 'unknown', source: 'unconfigured' }),
      expect.objectContaining({ type: 'trading_volume', value: null, status: 'unknown', source: 'unconfigured' }),
      expect.objectContaining({ type: 'community_verification', value: null, status: 'unknown', source: 'unconfigured' }),
      expect.objectContaining({ type: 'blacklist_status', value: null, status: 'unknown', source: 'unconfigured' }),
    ]));
  });

  it('does not verify an asset when the neutral score is at the verification boundary', async () => {
    const scorer = new TrustScorer(new TrustSignals(), new TrustRegistry(), {
      weights: {},
      thresholds: { verified: 50, unverified: 30, malicious: 10 },
    });

    const score = await scorer.calculateTrustScore(asset);

    expect(score.overall).toBe(50);
    expect(score.verificationStatus).toBe('unverified');
  });
});