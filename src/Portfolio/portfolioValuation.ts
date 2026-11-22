/**
 * Portfolio Valuation, Staleness Tracking & Canonical Asset Export
 * Implements #1097, #1098, #1099
 */

export interface AssetPriceInput {
  symbol: string;
  network: string;
  issuerOrContract: string;
  priceUsd: number | null;
  priceTimestamp: number; // epoch ms
}

export interface ValuationOptions {
  maxStaleAgeMs?: number; // default: 5 minutes (300_000 ms)
}

export interface ValuedAssetPosition {
  symbol: string;
  network: string;
  issuerOrContract: string;
  amount: number;
  unitPriceUsd: number | null;
  positionValueUsd: number | null;
  priceTimestamp: number;
  isStale: boolean;
  status: "PRICED_FRESH" | "PRICED_STALE" | "UNPRICED";
}

export interface PortfolioSummary {
  totalPricedValueUsd: number;
  completenessStatus: "COMPLETE" | "PARTIAL" | "UNPRICED";
  completenessRatio: number; // 0.0 to 1.0
  totalAssetsCount: number;
  pricedAssetsCount: number;
  unpricedAssets: Array<{ symbol: string; issuerOrContract: string; network: string }>;
  staleAssetsCount: number;
  positions: ValuedAssetPosition[];
}

/**
 * Values portfolio positions with explicit staleness and missing price metadata (#1097, #1098)
 */
export function calculatePortfolioValuation(
  holdings: Array<{ symbol: string; network: string; issuerOrContract: string; amount: number }>,
  priceFeeds: Map<string, AssetPriceInput>,
  now: number = Date.now(),
  options: ValuationOptions = {}
): PortfolioSummary {
  const maxStaleAge = options.maxStaleAgeMs ?? 300_000;
  const positions: ValuedAssetPosition[] = [];
  const unpricedAssets: Array<{ symbol: string; issuerOrContract: string; network: string }> = [];

  let totalPricedValueUsd = 0;
  let pricedCount = 0;
  let staleCount = 0;

  for (const item of holdings) {
    const key = `${item.network}:${item.issuerOrContract}:${item.symbol}`.toLowerCase();
    const feed = priceFeeds.get(key);

    if (!feed || feed.priceUsd === null) {
      unpricedAssets.push({
        symbol: item.symbol,
        issuerOrContract: item.issuerOrContract,
        network: item.network,
      });
      positions.push({
        symbol: item.symbol,
        network: item.network,
        issuerOrContract: item.issuerOrContract,
        amount: item.amount,
        unitPriceUsd: null,
        positionValueUsd: null,
        priceTimestamp: feed?.priceTimestamp ?? 0,
        isStale: true,
        status: "UNPRICED",
      });
      continue;
    }

    const age = now - feed.priceTimestamp;
    const isStale = age > maxStaleAge;
    if (isStale) staleCount++;

    const posVal = item.amount * feed.priceUsd;
    totalPricedValueUsd += posVal;
    pricedCount++;

    positions.push({
      symbol: item.symbol,
      network: item.network,
      issuerOrContract: item.issuerOrContract,
      amount: item.amount,
      unitPriceUsd: feed.priceUsd,
      positionValueUsd: posVal,
      priceTimestamp: feed.priceTimestamp,
      isStale,
      status: isStale ? "PRICED_STALE" : "PRICED_FRESH",
    });
  }

  const completenessRatio = holdings.length > 0 ? pricedCount / holdings.length : 1.0;
  const completenessStatus =
    pricedCount === holdings.length
      ? "COMPLETE"
      : pricedCount > 0
      ? "PARTIAL"
      : "UNPRICED";

  return {
    totalPricedValueUsd,
    completenessStatus,
    completenessRatio,
    totalAssetsCount: holdings.length,
    pricedAssetsCount: pricedCount,
    unpricedAssets,
    staleAssetsCount: staleCount,
    positions,
  };
}

/**
 * Exports portfolio assets preserving full canonical identity across serialization formats (#1099)
 */
export function exportPortfolioCanonical(
  summary: PortfolioSummary,
  format: "json" | "csv"
): string {
  if (format === "json") {
    return JSON.stringify(summary, null, 2);
  }

  // CSV format preserving network and issuer identity
  const headers = "Network,IssuerOrContract,Symbol,Amount,UnitPriceUSD,ValueUSD,Status,IsStale,PriceTimestamp";
  const rows = summary.positions.map((p) =>
    [
      p.network,
      p.issuerOrContract,
      p.symbol,
      p.amount,
      p.unitPriceUsd ?? "N/A",
      p.positionValueUsd ?? "N/A",
      p.status,
      p.isStale,
      p.priceTimestamp,
    ].join(",")
  );

  return [headers, ...rows].join("\n");
}
