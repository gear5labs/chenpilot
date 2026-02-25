import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import priceCacheService from "./priceCache.service";

export interface PriceQuote {
  fromAsset: string;
  toAsset: string;
  price: number;
  amount: number;
  estimatedOutput: number;
  path?: string[];
  cached: boolean;
  timestamp: number;
}

export class StellarPriceService {
  private server: StellarSdk.Horizon.Server;
  private readonly CACHE_TTL = 60; // Cache prices for 60 seconds

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  /**
   * Get asset definition from symbol
   */
  private getAsset(symbol: string): StellarSdk.Asset {
    const assets: Record<string, StellarSdk.Asset> = {
      XLM: StellarSdk.Asset.native(),
      USDC: new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      ),
      USDT: new StellarSdk.Asset(
        "USDT",
        "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
      ),
    };

    const asset = assets[symbol.toUpperCase()];
    if (!asset) {
      throw new Error(`Unsupported asset: ${symbol}`);
    }
    return asset;
  }

  /**
   * Get price quote from Stellar DEX with caching
   */
  async getPrice(
    fromAsset: string,
    toAsset: string,
    amount: number = 1
  ): Promise<PriceQuote> {
    // Check cache first
    const cached = await priceCacheService.getPrice(fromAsset, toAsset);
    if (cached) {
      return {
        fromAsset,
        toAsset,
        price: cached.price,
        amount,
        estimatedOutput: amount * cached.price,
        cached: true,
        timestamp: cached.timestamp,
      };
    }

    // Fetch from Stellar DEX
    try {
      const sourceAsset = this.getAsset(fromAsset);
      const destAsset = this.getAsset(toAsset);

      // Use strict send path to get price
      const paths = await this.server
        .strictSendPaths(sourceAsset, amount.toFixed(7), [destAsset])
        .call();

      if (!paths.records || paths.records.length === 0) {
        throw new Error(
          `No liquidity path found for ${fromAsset} to ${toAsset}`
        );
      }

      const bestPath = paths.records[0];
      const destAmount = parseFloat(bestPath.destination_amount);
      const price = destAmount / amount;

      // Cache the price
      await priceCacheService.setPrice(
        fromAsset,
        toAsset,
        price,
        "stellar_dex",
        this.CACHE_TTL
      );

      // Extract path information
      const pathAssets = bestPath.path.map(
        (asset: { asset_type: string; asset_code: string }) =>
          asset.asset_type === "native" ? "XLM" : asset.asset_code
      );

      logger.info(
        `Fetched price from Stellar DEX: ${fromAsset}/${toAsset} = ${price}`
      );

      return {
        fromAsset,
        toAsset,
        price,
        amount,
        estimatedOutput: destAmount,
        path: [fromAsset, ...pathAssets, toAsset],
        cached: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("Error fetching price from Stellar DEX:", error);
      throw error;
    }
  }

  /**
   * Get multiple prices at once
   */
  async getPrices(
    pairs: Array<{ from: string; to: string; amount?: number }>
  ): Promise<PriceQuote[]> {
    const quotes: PriceQuote[] = [];

    for (const pair of pairs) {
      try {
        const quote = await this.getPrice(pair.from, pair.to, pair.amount || 1);
        quotes.push(quote);
      } catch (error) {
        logger.error(
          `Error fetching price for ${pair.from}/${pair.to}:`,
          error
        );
      }
    }

    return quotes;
  }

  /**
   * Get orderbook depth for asset pair
   */
  async getOrderbookDepth(
    fromAsset: string,
    toAsset: string,
    limit: number = 20
  ): Promise<{
    bids: Array<{ price: number; amount: number }>;
    asks: Array<{ price: number; amount: number }>;
  }> {
    try {
      const sourceAsset = this.getAsset(fromAsset);
      const destAsset = this.getAsset(toAsset);

      const orderbook = await this.server
        .orderbook(sourceAsset, destAsset)
        .limit(limit)
        .call();

      return {
        bids: orderbook.bids.map((bid) => ({
          price: parseFloat(bid.price),
          amount: parseFloat(bid.amount),
        })),
        asks: orderbook.asks.map((ask) => ({
          price: parseFloat(ask.price),
          amount: parseFloat(ask.amount),
        })),
      };
    } catch (error) {
      logger.error("Error fetching orderbook:", error);
      throw error;
    }
  }

  /**
   * Invalidate cached price
   */
  async invalidatePrice(fromAsset: string, toAsset: string): Promise<void> {
    await priceCacheService.invalidatePrice(fromAsset, toAsset);
  }
}

export default new StellarPriceService();
