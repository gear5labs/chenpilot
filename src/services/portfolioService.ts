/**
 * Portfolio Service
 *
 * Fetches a user's Stellar account balances from Horizon and calculates
 * net worth by pricing each asset against a target currency via the DEX.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import stellarPriceService from "./stellarPrice.service";

export interface AssetBalance {
  /** Asset code, e.g. "XLM", "USDC" */
  code: string;
  /** Issuer public key, empty string for native XLM */
  issuer: string;
  /** Raw balance string from Horizon */
  balance: string;
  /** Numeric balance */
  amount: number;
  /** Estimated value in the requested currency (null if price unavailable) */
  valueInCurrency: number | null;
  /** Whether this is the native XLM asset */
  isNative: boolean;
}

export interface PortfolioSummary {
  /** Stellar account address */
  address: string;
  /** Currency used for net-worth calculation */
  currency: string;
  /** All asset balances on the account */
  assets: AssetBalance[];
  /** Sum of all asset values in the requested currency (null if no prices available) */
  totalValue: number | null;
  /** ISO timestamp of when this snapshot was taken */
  fetchedAt: string;
}

// Currencies we can price assets against via the DEX
const SUPPORTED_CURRENCIES = ["USD", "XLM", "BTC"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// Well-known anchor issuers for common stablecoins so we can attempt DEX pricing
const KNOWN_ISSUERS: Record<string, string> = {
  USDC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  USDT: "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V",
};

export class PortfolioService {
  private server: StellarSdk.Horizon.Server;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  /**
   * Fetch all balances for a Stellar account and price them in the given currency.
   *
   * @param address  Stellar public key (G…)
   * @param currency Target currency for net-worth calculation (default: "USD")
   */
  async getPortfolio(
    address: string,
    currency: string = "USD"
  ): Promise<PortfolioSummary> {
    const normalizedCurrency = currency.toUpperCase() as SupportedCurrency;

    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      throw new Error(
        `Unsupported currency "${currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`
      );
    }

    // Fetch account from Horizon
    let account: StellarSdk.Horizon.AccountResponse;
    try {
      account = await this.server.accounts().accountId(address).call();
    } catch (err) {
      logger.error("PortfolioService: failed to load account", { address, err });
      throw new Error(`Account not found or Horizon unreachable: ${address}`);
    }

    const rawBalances: StellarSdk.Horizon.HorizonApi.BalanceLine[] =
      account.balances as StellarSdk.Horizon.HorizonApi.BalanceLine[];

    // Build asset list
    const assets: AssetBalance[] = rawBalances.map((b) => {
      const isNative = b.asset_type === "native";
      const code = isNative
        ? "XLM"
        : (b as StellarSdk.Horizon.HorizonApi.BalanceLineAsset).asset_code;
      const issuer = isNative
        ? ""
        : (b as StellarSdk.Horizon.HorizonApi.BalanceLineAsset).asset_issuer;
      const amount = parseFloat(b.balance);

      return {
        code,
        issuer,
        balance: b.balance,
        amount,
        valueInCurrency: null, // filled in below
        isNative,
      };
    });

    // Price each asset
    await Promise.all(
      assets.map(async (asset) => {
        if (asset.amount === 0) {
          asset.valueInCurrency = 0;
          return;
        }

        try {
          if (asset.code === normalizedCurrency) {
            // Asset IS the target currency — 1:1
            asset.valueInCurrency = asset.amount;
            return;
          }

          // For XLM priced in XLM — trivial
          if (asset.code === "XLM" && normalizedCurrency === "XLM") {
            asset.valueInCurrency = asset.amount;
            return;
          }

          // Attempt DEX price lookup
          const fromCode = asset.code;
          const toCode = normalizedCurrency;

          // Only attempt pricing for assets we know how to look up
          const isKnown =
            asset.isNative || Object.keys(KNOWN_ISSUERS).includes(fromCode);

          if (!isKnown) {
            // Unknown asset — skip pricing
            return;
          }

          const quote = await stellarPriceService.getPrice(
            fromCode,
            toCode,
            asset.amount
          );
          asset.valueInCurrency = quote.estimatedOutput;
        } catch (err) {
          // Price unavailable — leave as null
          logger.warn(
            `PortfolioService: could not price ${asset.code} in ${normalizedCurrency}`,
            { err }
          );
        }
      })
    );

    // Sum total value (only include assets where price is known)
    const pricedAssets = assets.filter((a) => a.valueInCurrency !== null);
    const totalValue =
      pricedAssets.length > 0
        ? pricedAssets.reduce((sum, a) => sum + (a.valueInCurrency ?? 0), 0)
        : null;

    return {
      address,
      currency: normalizedCurrency,
      assets,
      totalValue,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the current price of a single asset in the given currency.
   *
   * @param assetCode  e.g. "XLM", "USDC"
   * @param currency   e.g. "USD", "XLM", "BTC"
   */
  async getAssetPrice(
    assetCode: string,
    currency: string = "USD"
  ): Promise<{ assetCode: string; currency: string; price: number }> {
    const from = assetCode.toUpperCase();
    const to = currency.toUpperCase();

    if (from === to) {
      return { assetCode: from, currency: to, price: 1 };
    }

    const quote = await stellarPriceService.getPrice(from, to, 1);
    return { assetCode: from, currency: to, price: quote.price };
  }
}

export const portfolioService = new PortfolioService();
export default portfolioService;
