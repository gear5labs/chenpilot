import { AssetIntelligence } from '../core/AssetIntelligence';
import { Asset, AssetIntelligenceConfig, TrustSignal } from '../core/types';
import { TrustScorer } from '../trust/TrustScorer';

const asset: Asset = { code: 'USDC', issuer: 'GISSUER', network: 'testnet' };
const config: AssetIntelligenceConfig = {
  cache: {
    memory: { maxSize: 100, ttl: 60000 },
    persistent: { enabled: false, path: '', ttl: 0 },
  },
  providers: {
    metadata: { horizonUrl: 'https://horizon-testnet.stellar.org' },
    price: { sources: [], updateInterval: 60000 },
    trust: {
      sources: [],
      weights: {
        domain_verification: 0.3,
        issuer_reputation: 0.25,
        asset_age: 0.15,
        trading_volume: 0.15,
        community_verification: 0.1,
        blacklist_status: 0.05,
      },
    },
  },
  invalidation: { priceChangeThreshold: 100, maxAge: 3600000, eventDriven: false },
  compatibility: { strictMode: false, allowedNetworks: ['testnet'], blockedIssuers: [] },
};

const trustConfig = {
  weights: { domain: 0.6, blacklist: 0.4 },
  thresholds: { verified: 80, unverified: 50, malicious: 20 },
};

function signal(type: string, value: number, timestamp = Date.now()): TrustSignal {
  return { type, value, weight: 1, description: type, source: 'test', timestamp };
}

function horizonResponse(records: Array<Record<string, unknown>>): Response {
  return { ok: true, status: 200, json: async () => ({ _embedded: { records } }) } as Response;
}

describe('AssetIntelligence behavior', () => {
  let intelligence: AssetIntelligence;

  beforeEach(() => {
    intelligence = new AssetIntelligence(config);
  });

  afterEach(() => {
    intelligence.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns a typed unavailable price and never caches a fake zero quote', async () => {
    const result = await intelligence.getAssetPrice(asset);

    expect(result).toEqual({ status: 'unavailable', reason: 'no_configured_source' });
    expect('price' in result).toBe(false);
    expect(await intelligence.getAssetPrice(asset)).toEqual(result);
  });

  it('reports a configured price provider failure as unavailable, not as a quote', async () => {
    intelligence.updateConfig({
      providers: { ...config.providers, price: { sources: [{ name: 'feed', url: 'https://prices.invalid', priority: 1, enabled: true }], updateInterval: 60000 } },
    });

    expect(await intelligence.getAssetPrice(asset)).toEqual({ status: 'unavailable', reason: 'provider_unavailable' });
  });

  it('loads metadata from Horizon and matching Stellar TOML with provenance', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(horizonResponse([
      { asset_code: 'USDC', asset_issuer: 'GISSUER', home_domain: 'issuer.example' },
    ])).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[[CURRENCIES]]\ncode="USDC"\nissuer="GISSUER"\nname="USD Coin"\ndisplay_decimals=6',
    } as Response);

    const metadata = await (intelligence as any).fetchMetadata(asset);

    expect(metadata).toMatchObject({ name: 'USD Coin', decimals: 6, homeDomain: 'issuer.example' });
    expect(metadata.provenance.map((source: { provider: string }) => source.provider)).toEqual(['horizon', 'stellar_toml']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing Horizon asset instead of fabricating metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(horizonResponse([]));

    await expect((intelligence as any).fetchMetadata(asset)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('surfaces provider timeouts as metadata unavailable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('request timed out'));

    await expect((intelligence as any).fetchMetadata(asset)).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
  });

  it('rejects malformed TOML currency metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(horizonResponse([
      { asset_code: 'USDC', asset_issuer: 'GISSUER', home_domain: 'issuer.example' },
    ])).mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[[CURRENCIES]]\ncode="USDC"\nissuer="GISSUER"\ndisplay_decimals=99' } as Response);

    await expect((intelligence as any).fetchMetadata(asset)).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
  });

  it('uses the metadata cache without calling providers again', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(horizonResponse([
      { asset_code: 'USDC', asset_issuer: 'GISSUER', home_domain: 'issuer.example' },
    ])).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[[CURRENCIES]]\ncode="USDC"\nissuer="GISSUER"\nname="USD Coin"\ndisplay_decimals=6',
    } as Response);
    jest.spyOn((intelligence as any).trustScorer, 'calculateTrustScore').mockResolvedValue({
      overall: 0, confidence: 0, signals: [], verificationStatus: 'unverified', lastUpdated: Date.now(),
    });
    jest.spyOn(intelligence, 'checkCompatibility').mockResolvedValue({ compatible: true, reasons: [], warnings: [], lastChecked: Date.now() });

    const first = await intelligence.getAssetInfo(asset);
    const second = await intelligence.getAssetInfo(asset);

    expect(first?.metadata).toEqual(second?.metadata);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse compatibility across operation or version contexts', async () => {
    const check = jest.spyOn((intelligence as any).networkCompatibility, 'checkCompatibility')
      .mockImplementation(async (_asset: Asset, context: { operation?: string; version?: string }) => ({
        compatible: context.operation !== 'change_trust' && context.version !== '2',
        reasons: [], warnings: [], lastChecked: Date.now(),
      }));
    jest.spyOn((intelligence as any).assetValidator, 'validateMetadata').mockResolvedValue({ verified: true, status: 'verified', reasons: [], score: 100 });

    const payment = await intelligence.checkCompatibility(asset, { network: 'testnet', operation: 'payment', version: '1' });
    const trustChange = await intelligence.checkCompatibility(asset, { network: 'testnet', operation: 'change_trust', version: '1' });
    const versionTwo = await intelligence.checkCompatibility(asset, { network: 'testnet', operation: 'payment', version: '2' });

    expect(payment.compatible).toBe(true);
    expect(trustChange.compatible).toBe(false);
    expect(versionTwo.compatible).toBe(false);
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('TrustScorer handling of unavailable and stale signals', () => {
  let scorer: TrustScorer;
  let signals: { getAllSignals: jest.Mock<Promise<TrustSignal[]>, [Asset]> };

  beforeEach(() => {
    signals = { getAllSignals: jest.fn() };
    scorer = new TrustScorer(signals as any, {} as any, trustConfig);
  });

  it('returns zero confidence and an unverified status when every signal is unknown', async () => {
    signals.getAllSignals.mockResolvedValue([]);

    await expect(scorer.calculateTrustScore(asset)).resolves.toMatchObject({
      overall: 0, confidence: 0, verificationStatus: 'unverified', signals: [],
    });
  });

  it('reduces the total against configured weight and reports partial confidence', async () => {
    signals.getAllSignals.mockResolvedValue([signal('domain', 100)]);

    await expect(scorer.calculateTrustScore(asset)).resolves.toMatchObject({
      overall: 60, confidence: 60, verificationStatus: 'unverified',
    });
  });

  it('excludes stale signals from both total and confidence', async () => {
    signals.getAllSignals.mockResolvedValue([signal('domain', 100, Date.now() - 25 * 60 * 60 * 1000)]);

    await expect(scorer.calculateTrustScore(asset)).resolves.toMatchObject({
      overall: 0, confidence: 0, verificationStatus: 'unverified', signals: [],
    });
  });

  it('marks a fresh malicious signal as malicious even when another signal is favorable', async () => {
    signals.getAllSignals.mockResolvedValue([signal('domain', 100), signal('blacklist', 0)]);

    await expect(scorer.calculateTrustScore(asset)).resolves.toMatchObject({
      overall: 60, confidence: 100, verificationStatus: 'malicious',
    });
  });
});