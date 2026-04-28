import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import config from "../../config/config";
import logger from "../../config/logger";
import { horizonProxyService } from "../../Gateway/horizonProxy.service";

interface AmmExplorerPayload extends Record<string, unknown> {
  operation: "get_stats" | "search_pools";
  poolId?: string;
  assetA?: string;
  assetB?: string;
}

interface HorizonPoolRecord {
  id: string;
  reserves: Array<{ asset: string; amount: string }>;
  total_shares: string;
  total_trustlines: string;
  fee_bp: number;
  volume?: { [key: string]: { base_volume: string; counter_volume: string } };
}

const POOL_ID_REGEX = /^[0-9a-f]{64}$/i;
const FEE_PERCENTAGE = 0.003; // 0.30% standard Stellar AMM fee

export class AmmExplorerTool extends BaseTool<AmmExplorerPayload> {
  metadata: ToolMetadata = {
    name: "amm_explorer",
    description:
      "Search for Stellar AMM liquidity pools and view their latest metrics like reserves, volume, and APR",
    parameters: {
      operation: {
        type: "string",
        description: "The operation to perform: 'get_stats' or 'search_pools'",
        required: true,
        enum: ["get_stats", "search_pools"],
      },
      poolId: {
        type: "string",
        description: "64-character hexadecimal Stellar AMM liquidity pool ID (required for 'get_stats')",
        required: false,
        pattern: "^[0-9a-f]{64}$",
      },
      assetA: {
        type: "string",
        description: "First asset in the pair (e.g., 'XLM' or 'USDC:GA...') (required for 'search_pools')",
        required: false,
      },
      assetB: {
        type: "string",
        description: "Second asset in the pair (e.g., 'XLM' or 'USDC:GA...') (required for 'search_pools')",
        required: false,
      },
    },
    examples: [
      "Search for XLM/USDC liquidity pools",
      "Get metrics for pool abc123...",
      "Explore AMM pools for native XLM and yXLM",
    ],
    category: "stellar",
    version: "1.0.0",
  };

  validate(payload: AmmExplorerPayload): { valid: boolean; errors: string[] } {
    const baseValidation = super.validate ? super.validate(payload) : { valid: true, errors: [] };
    const errors = [...(baseValidation.errors || [])];

    if (payload.operation === "get_stats" && !payload.poolId) {
      errors.push("poolId is required for get_stats operation");
    } else if (payload.operation === "search_pools" && (!payload.assetA || !payload.assetB)) {
      errors.push("Both assetA and assetB are required for search_pools operation");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async execute(payload: AmmExplorerPayload, userId: string): Promise<ToolResult> {
    const validation = this.validate(payload);
    if (!validation.valid) {
      return this.createErrorResult("amm_explorer", validation.errors.join(", "));
    }

    try {
      switch (payload.operation) {
        case "get_stats":
          return await this.getStats(payload.poolId);
        case "search_pools":
          return await this.searchPools(payload.assetA, payload.assetB);
        default:
          return this.createErrorResult("amm_explorer", `Unknown operation: ${payload.operation}`);
      }
    } catch (error) {
      logger.error("AmmExplorerTool error", { payload, error });
      return this.createErrorResult(
        "amm_explorer",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  private async getStats(poolId?: string): Promise<ToolResult> {
    try {
      const path = `/liquidity_pools/${poolId}`;
      const pool = (await horizonProxyService.proxyGet(path, {})) as HorizonPoolRecord;
      return this.createSuccessResult("amm_explorer", this.formatPoolData(pool));
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return this.createErrorResult("amm_explorer", "Liquidity pool not found.");
      }
      throw error;
    }
  }

  private async searchPools(assetA?: string, assetB?: string): Promise<ToolResult> {
    const formattedA = this.formatAsset(assetA!);
    const formattedB = this.formatAsset(assetB!);

    const path = "/liquidity_pools";
    const data = (await horizonProxyService.proxyGet(path, {
      assets: `${formattedA},${formattedB}`,
    })) as any;

    const pools = data._embedded.records as HorizonPoolRecord[];

    if (pools.length === 0) {
      return this.createSuccessResult("amm_explorer", {
        message: `No liquidity pools found for ${assetA}/${assetB}`,
        pools: [],
      });
    }

    return this.createSuccessResult("amm_explorer", {
      message: `Found ${pools.length} liquidity pool(s) for ${assetA}/${assetB}`,
      pools: pools.map((p) => this.formatPoolData(p)),
    });
  }

  private formatAsset(assetStr: string): string {
    const upper = assetStr.toUpperCase();
    if (upper === "XLM" || upper === "NATIVE") {
      return "native";
    }
    // If it's already in CODE:ISSUER format, return as is (but uppercase code)
    if (assetStr.includes(":")) {
      const [code, issuer] = assetStr.split(":");
      return `${code.toUpperCase()}:${issuer}`;
    }
    return assetStr; // Return as is, might be just the code (Horizon might not like it without issuer)
  }

  private formatPoolData(pool: HorizonPoolRecord) {
    const reserveA = parseFloat(pool.reserves[0]?.amount ?? "0");
    const reserveB = parseFloat(pool.reserves[1]?.amount ?? "0");
    const assetA = pool.reserves[0]?.asset ?? "unknown";
    const assetB = pool.reserves[1]?.asset ?? "unknown";

    const volumeEntry = pool.volume
      ? (pool.volume as Record<string, { base_volume: string; counter_volume: string }>)[
          Object.keys(pool.volume)[0]
        ]
      : null;
    
    const volume24h = volumeEntry
      ? parseFloat(volumeEntry.base_volume) + parseFloat(volumeEntry.counter_volume)
      : 0;

    const totalLiquidity = reserveA + reserveB;
    const apr =
      totalLiquidity > 0
        ? parseFloat(((volume24h * FEE_PERCENTAGE * 365) / totalLiquidity * 100).toFixed(2))
        : 0;

    return {
      poolId: pool.id,
      assetA,
      assetB,
      reserveA: parseFloat(reserveA.toFixed(7)),
      reserveB: parseFloat(reserveB.toFixed(7)),
      totalShares: pool.total_shares,
      totalTrustlines: pool.total_trustlines,
      fee: `${(pool.fee_bp / 100).toFixed(2)}%`,
      volume24h: parseFloat(volume24h.toFixed(7)),
      apr,
      timestamp: new Date().toISOString(),
    };
  }
}

export const ammExplorerTool = new AmmExplorerTool();
