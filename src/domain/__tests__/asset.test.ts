import * as StellarSdk from '@stellar/stellar-sdk';
import { Asset, AssetAmount } from '../index';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return { __esModule: true, ...actual };
});

describe('Domain Models', () => {
  describe('Asset', () => {
    it('should create a native asset', () => {
      const xlm = Asset.native();
      expect(xlm.code).toBe('XLM');
      expect(xlm.type).toBe('native');
    });

    it('should create a custom asset', () => {
      const usdc = Asset.create({
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        type: 'credit_alphanum4',
        decimals: 7,
      });
      expect(usdc.code).toBe('USDC');
      expect(usdc.issuer).toBeDefined();
    });

    it('should throw on invalid asset code', () => {
      expect(() => {
        Asset.create({
          code: '',
          type: 'credit_alphanum4',
          decimals: 7,
        });
      }).toThrow();
    });

    it('should keep the issuer in the asset identity (#832)', () => {
      const issuerA = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const issuerB = 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V';
      const first = Asset.create({
        code: 'USDC',
        issuer: issuerA,
        type: 'credit_alphanum4',
        decimals: 7,
      });
      const second = Asset.create({
        code: 'USDC',
        issuer: issuerB,
        type: 'credit_alphanum4',
        decimals: 7,
      });

      expect(first.canonicalId).toBe(`USDC:${issuerA}`);
      expect(second.canonicalId).toBe(`USDC:${issuerB}`);
      expect(first.canonicalId).not.toBe(second.canonicalId);
      expect(first.toString()).not.toBe(second.toString());
      expect(first.equals(second)).toBe(false);
      expect(first.equals(Asset.create({ ...first.value }))).toBe(true);
      expect(Asset.native().canonicalId).toBe('native:XLM');
    });

    it('should round-trip the issuer through the Stellar SDK asset (#832)', () => {
      const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const asset = Asset.fromStellarAsset(new StellarSdk.Asset('USDC', issuer));

      expect(asset.issuer).toBe(issuer);
      expect(asset.canonicalId).toBe(`USDC:${issuer}`);
      expect(asset.toStellarAsset().getCode()).toBe('USDC');
      expect(asset.toStellarAsset().getIssuer()).toBe(issuer);
    });
  });

  describe('AssetAmount', () => {
    it('should create a valid asset amount', () => {
      const xlm = Asset.native();
      const amount = AssetAmount.create(xlm, '100.5');
      expect(amount.amount).toBe('100.5');
      expect(amount.toString()).toBe('100.5 XLM');
    });

    it('should throw on negative amount', () => {
      const xlm = Asset.native();
      expect(() => {
        AssetAmount.create(xlm, '-10');
      }).toThrow();
    });

    it('should add amounts correctly', () => {
      const xlm = Asset.native();
      const amount1 = AssetAmount.create(xlm, '100');
      const amount2 = AssetAmount.create(xlm, '50');
      const sum = amount1.add(amount2);
      expect(sum.amount).toBe('150');
    });

    it('should add amounts with fixed precision (no float drift) (#622)', () => {
      const xlm = Asset.native();
      const amount1 = AssetAmount.create(xlm, '0.1');
      const amount2 = AssetAmount.create(xlm, '0.2');
      const sum = amount1.add(amount2);
      expect(sum.amount).toBe('0.3');
    });

    it('should subtract amounts exactly (#622)', () => {
      const xlm = Asset.native();
      const amount1 = AssetAmount.create(xlm, '1.0000001');
      const amount2 = AssetAmount.create(xlm, '0.0000001');
      const diff = amount1.subtract(amount2);
      expect(diff.amount).toBe('1');
    });

    it('should reject precision an asset cannot represent (#622)', () => {
      const usdc = Asset.create({
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        type: 'credit_alphanum4',
        decimals: 7,
      });
      expect(() => {
        AssetAmount.create(usdc, '0.12345678');
      }).toThrow(/exceeds asset precision/);
    });

    it('should multiply by a fixed-precision rate (#622)', () => {
      const xlm = Asset.native();
      const amount = AssetAmount.create(xlm, '2.5');
      const product = amount.multiplyBy('0.4', 1);
      expect(product.amount).toBe('1');
    });
  });
});
