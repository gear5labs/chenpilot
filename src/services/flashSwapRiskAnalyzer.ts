import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";

export interface SwapRiskAnalysis {
  riskLevel: "low" | "medium" | "high" | "critical";
  sandwichAttackRisk: number;
  warnings: string[];
  recommendations: string[];
  metrics: {
    priceImpact: number;
    liquidityDepth: number;
    spreadPercentage: number;
    recentVolatility: number;
  };
}

export interface SwapParams {
  fromAsset: StellarSdk.Asset;
  toAsset: StellarSdk.Asset;
  amount: number;
}

export class FlashSwapRiskAnalyzer {
  private server: StellarSdk.Horizon.Server;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  async analyzeSwapRisk(params: SwapParams): Promise<SwapRiskAnalysis> {
    const warnings: string[] = [];
    const recommendations: string[] = [];

    const liquidityDepth = await this.calculateLiquidityDepth(params);
    const priceImpact = this.estimatePriceImpact(params.amount, liquidityDepth);
    const spreadPercentage = await this.calculateSpread(params);
    const recentVolatility = await this.analyzeVolatility(params);

    const sandwichRisk = this.calculateSandwichRisk(
      priceImpact,
      liquidityDepth,
      spreadPercentage,
      recentVolatility
    );

    if (priceImpact > 5) {
      warnings.push(`High price impact: ${priceImpact.toFixed(2)}%`);
      recommendations.push("Consider splitting swap into smaller transactions");
    }

    if (liquidityDepth < params.amount * 2) {
      warnings.push("Low liquidity for swap size");
      recommendations.push("Reduce swap amount or wait for better liquidity");
    }

    if (spreadPercentage > 2) {
      warnings.push(`Wide spread detected: ${spreadPercentage.toFixed(2)}%`);
    }

    if (sandwichRisk > 0.7) {
      warnings.push("Critical sandwich attack risk detected");
      recommendations.push("Use private mempool or delay transaction");
    } else if (sandwichRisk > 0.5) {
      warnings.push("Elevated sandwich attack risk");
      recommendations.push("Set tight slippage tolerance (<0.5%)");
    }

    const riskLevel = this.determineRiskLevel(sandwichRisk);

    return {
      riskLevel,
      sandwichAttackRisk: sandwichRisk,
      warnings,
      recommendations,
      metrics: {
        priceImpact,
        liquidityDepth,
        spreadPercentage,
        recentVolatility,
      },
    };
  }

  private async calculateLiquidityDepth(params: SwapParams): Promise<number> {
    try {
      const orderbook = await this.server
        .orderbook(params.fromAsset, params.toAsset)
        .call();

      const totalBids = orderbook.bids.reduce(
        (sum, bid) => sum + parseFloat(bid.amount),
        0
      );
      const totalAsks = orderbook.asks.reduce(
        (sum, ask) => sum + parseFloat(ask.amount),
        0
      );

      return Math.min(totalBids, totalAsks);
    } catch (error) {
      logger.error("Failed to calculate liquidity depth", { error });
      return 0;
    }
  }

  private estimatePriceImpact(amount: number, liquidityDepth: number): number {
    if (liquidityDepth === 0) return 100;
    return (amount / liquidityDepth) * 100;
  }

  private async calculateSpread(params: SwapParams): Promise<number> {
    try {
      const orderbook = await this.server
        .orderbook(params.fromAsset, params.toAsset)
        .call();

      if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
        return 100;
      }

      const bestBid = parseFloat(orderbook.bids[0].price);
      const bestAsk = parseFloat(orderbook.asks[0].price);
      const midPrice = (bestBid + bestAsk) / 2;

      return ((bestAsk - bestBid) / midPrice) * 100;
    } catch (error) {
      logger.error("Failed to calculate spread", { error });
      return 100;
    }
  }

  private async analyzeVolatility(params: SwapParams): Promise<number> {
    try {
      const trades = await this.server
        .trades()
        .forAssetPair(params.fromAsset, params.toAsset)
        .limit(50)
        .order("desc")
        .call();

      if (trades.records.length < 10) return 0.5;

      const prices = trades.records
        .filter(
          (
            t
          ): t is (typeof trades.records)[0] & {
            price: { n: string; d: string };
          } => !!(t.price && t.price.n && t.price.d)
        )
        .map((t) => parseFloat(t.price!.n) / parseFloat(t.price!.d));

      if (prices.length === 0) return 0.5;

      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance =
        prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) /
        prices.length;
      const stdDev = Math.sqrt(variance);

      return (stdDev / avgPrice) * 100;
    } catch (error) {
      logger.error("Failed to analyze volatility", { error });
      return 0.5;
    }
  }

  private calculateSandwichRisk(
    priceImpact: number,
    liquidityDepth: number,
    spread: number,
    volatility: number
  ): number {
    const impactScore = Math.min(priceImpact / 10, 1);
    const liquidityScore =
      liquidityDepth < 1000 ? 0.8 : liquidityDepth < 10000 ? 0.4 : 0.1;
    const spreadScore = Math.min(spread / 5, 1);
    const volatilityScore = Math.min(volatility / 10, 1);

    return (
      impactScore * 0.4 +
      liquidityScore * 0.3 +
      spreadScore * 0.2 +
      volatilityScore * 0.1
    );
  }

  private determineRiskLevel(
    sandwichRisk: number
  ): "low" | "medium" | "high" | "critical" {
    if (sandwichRisk >= 0.7) return "critical";
    if (sandwichRisk >= 0.5) return "high";
    if (sandwichRisk >= 0.3) return "medium";
    return "low";
  }
}

export const flashSwapRiskAnalyzer = new FlashSwapRiskAnalyzer();
