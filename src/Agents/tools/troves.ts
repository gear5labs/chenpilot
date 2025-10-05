import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { trovesService } from "../../services/TrovesService";
import { 
  TrovesDepositOperation, 
  TrovesWithdrawOperation, 
  TrovesHarvestOperation 
} from "../../types/troves";

interface TrovesPayload extends Record<string, unknown> {
  operation: "get_vaults" | "get_positions" | "get_quote" | "deposit" | "withdraw" | "get_strategies" | "get_yield" | "health_check" | "harvest";
  vaultId?: string;
  amount?: string;
  asset?: string;
  shares?: string;
  userAddress?: string;
}

export class TrovesTool extends BaseTool<TrovesPayload> {
  metadata: ToolMetadata = {
    name: "troves_tool",
    description: "Troves yield farming operations including vault deposits, withdrawals, and yield monitoring",
    parameters: {
      operation: {
        type: "string",
        description: "The Troves operation to perform",
        required: true,
        enum: ["get_vaults", "get_positions", "get_quote", "deposit", "withdraw", "get_strategies", "get_yield", "health_check", "harvest"],
      },
      vaultId: {
        type: "string",
        description: "Vault ID for specific operations",
        required: false,
      },
      amount: {
        type: "string",
        description: "Amount to deposit or withdraw",
        required: false,
      },
      asset: {
        type: "string",
        description: "Asset symbol (STRK, ETH, USDC, WBTC)",
        required: false,
        enum: ["STRK", "ETH", "USDC", "WBTC", "USDT"],
      },
      shares: {
        type: "string",
        description: "Number of shares to withdraw",
        required: false,
      },
      userAddress: {
        type: "string",
        description: "User address for position queries",
        required: false,
      },
    },
    examples: [
      "Show me available Troves vaults",
      "What are my Troves positions?",
      "Get quote for depositing 100 STRK",
      "Deposit 100 STRK to STRK vault",
      "Withdraw 50 shares from ETH vault",
      "Show me available strategies",
      "Get yield data for STRK vault",
      "Check Troves health status",
      "Harvest my rewards from STRK vault",
    ],
    category: "yield_farming",
    version: "1.0.0",
  };

  async execute(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    const operation = payload.operation as string;

    try {
      switch (operation) {
        case "get_vaults":
          return await this.getAvailableVaults();
        case "get_positions":
          return await this.getUserPositions(payload.userAddress as string || userId);
        case "get_quote":
          return await this.getDepositQuote(payload);
        case "deposit":
          return await this.executeDeposit(payload, userId);
        case "withdraw":
          return await this.executeWithdraw(payload, userId);
        case "get_strategies":
          return await this.getAvailableStrategies();
        case "get_yield":
          return await this.getYieldData(payload);
        case "health_check":
          return await this.healthCheck();
        case "harvest":
          return await this.harvestRewards(payload, userId);
        default:
          return this.createErrorResult(
            "troves_operation",
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult(
        "troves_error",
        error instanceof Error ? error.message : "Unknown error occurred"
      );
    }
  }

  private async getAvailableVaults(): Promise<ToolResult> {
    try {
      const vaults = await trovesService.getAvailableVaults();
      return this.createSuccessResult("troves_vaults", {
        vaults: vaults.map(vault => ({
          id: vault.id,
          name: vault.name,
          symbol: vault.symbol,
          asset: vault.asset,
          apy: vault.apy,
          tvl: vault.tvl,
          strategy: vault.strategy,
          minDeposit: vault.minDeposit,
          fees: vault.fees
        }))
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_vaults_error",
        error instanceof Error ? error.message : "Failed to fetch vaults"
      );
    }
  }

  private async getUserPositions(userAddress: string): Promise<ToolResult> {
    try {
      const positions = await trovesService.getUserPositions(userAddress);
      return this.createSuccessResult("troves_positions", {
        positions: positions.map(position => ({
          vaultId: position.vaultId,
          vaultName: position.vaultName,
          asset: position.asset,
          shares: position.shares,
          assets: position.assets,
          estimatedValue: position.estimatedValue,
          apy: position.apy,
          totalEarned: position.totalEarned,
          depositedAt: position.depositedAt
        }))
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_positions_error",
        error instanceof Error ? error.message : "Failed to fetch positions"
      );
    }
  }

  private async getDepositQuote(payload: TrovesPayload): Promise<ToolResult> {
    try {
      const { vaultId, amount, asset } = payload;
      
      if (!vaultId || !amount || !asset) {
        return this.createErrorResult(
          "troves_quote_error",
          "VaultId, amount, and asset are required for quote"
        );
      }

      const quote = await trovesService.getDepositQuote(
        vaultId as string,
        amount as string,
        asset as string
      );

      return this.createSuccessResult("troves_quote", {
        vaultId: quote.vaultId,
        asset: quote.asset,
        amount: quote.amount,
        estimatedShares: quote.estimatedShares,
        apy: quote.apy,
        estimatedYield: quote.estimatedYield,
        timeHorizon: quote.timeHorizon,
        fees: quote.fees
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_quote_error",
        error instanceof Error ? error.message : "Failed to get quote"
      );
    }
  }

  private async executeDeposit(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    try {
      const { vaultId, amount, asset, userAddress } = payload;
      
      if (!vaultId || !amount || !asset) {
        return this.createErrorResult(
          "troves_deposit_error",
          "VaultId, amount, and asset are required for deposit"
        );
      }

      // Get deposit quote first
      const quote = await trovesService.getDepositQuote(
        vaultId as string,
        amount as string,
        asset as string
      );

      return this.createSuccessResult("troves_deposit", {
        success: true,
        message: `Deposit quote for ${amount} ${asset} to vault ${vaultId}`,
        quote: {
          estimatedShares: quote.estimatedShares,
          apy: quote.apy,
          estimatedYield: quote.estimatedYield,
          fees: quote.fees
        },
        note: "To execute the actual deposit, use the /troves/deposit API endpoint with your Starknet account"
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_deposit_error",
        error instanceof Error ? error.message : "Failed to execute deposit"
      );
    }
  }

  private async executeWithdraw(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    try {
      const { vaultId, shares, userAddress } = payload;
      
      if (!vaultId || !shares) {
        return this.createErrorResult(
          "troves_withdraw_error",
          "VaultId and shares are required for withdrawal"
        );
      }

      // Get vault information for context
      const vaults = await trovesService.getAvailableVaults();
      const vault = vaults.find(v => v.id === vaultId);
      
      if (!vault) {
        return this.createErrorResult(
          "troves_withdraw_error",
          `Vault ${vaultId} not found`
        );
      }

      return this.createSuccessResult("troves_withdraw", {
        success: true,
        message: `Withdrawal of ${shares} shares from ${vault.name}`,
        vault: {
          id: vault.id,
          name: vault.name,
          asset: vault.asset
        },
        note: "To execute the actual withdrawal, use the /troves/withdraw API endpoint with your Starknet account"
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_withdraw_error",
        error instanceof Error ? error.message : "Failed to execute withdrawal"
      );
    }
  }

  private async getAvailableStrategies(): Promise<ToolResult> {
    try {
      const strategies = await trovesService.getAvailableStrategies();
      return this.createSuccessResult("troves_strategies", {
        strategies: strategies.map(strategy => ({
          id: strategy.id,
          name: strategy.name,
          description: strategy.description,
          riskLevel: strategy.riskLevel,
          targetApy: strategy.targetApy,
          currentApy: strategy.currentApy,
          tvl: strategy.tvl,
          supportedAssets: strategy.supportedAssets,
          strategyType: strategy.strategyType
        }))
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_strategies_error",
        error instanceof Error ? error.message : "Failed to fetch strategies"
      );
    }
  }

  private async getYieldData(payload: TrovesPayload): Promise<ToolResult> {
    try {
      const { vaultId } = payload;
      
      if (!vaultId) {
        return this.createErrorResult(
          "troves_yield_error",
          "VaultId is required for yield data"
        );
      }

      const yieldData = await trovesService.getYieldData(vaultId as string);
      return this.createSuccessResult("troves_yield", {
        vaultId: yieldData.vaultId,
        asset: yieldData.asset,
        currentApy: yieldData.currentApy,
        historicalApy: yieldData.historicalApy,
        totalYield: yieldData.totalYield,
        dailyYield: yieldData.dailyYield,
        weeklyYield: yieldData.weeklyYield,
        monthlyYield: yieldData.monthlyYield,
        lastUpdated: yieldData.lastUpdated
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_yield_error",
        error instanceof Error ? error.message : "Failed to fetch yield data"
      );
    }
  }

  private async healthCheck(): Promise<ToolResult> {
    try {
      const health = await trovesService.healthCheck();
      return this.createSuccessResult("troves_health", {
        status: health.status,
        totalTvl: health.totalTvl,
        totalApy: health.totalApy,
        vaultStatus: health.vaultStatus,
        recommendations: health.recommendations
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_health_error",
        error instanceof Error ? error.message : "Failed to check health"
      );
    }
  }

  private async harvestRewards(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    try {
      const { vaultId, userAddress } = payload;
      
      if (!vaultId) {
        return this.createErrorResult(
          "troves_harvest_error",
          "VaultId is required for harvesting"
        );
      }

      // Get vault information for context
      const vaults = await trovesService.getAvailableVaults();
      const vault = vaults.find(v => v.id === vaultId);
      
      if (!vault) {
        return this.createErrorResult(
          "troves_harvest_error",
          `Vault ${vaultId} not found`
        );
      }

      return this.createSuccessResult("troves_harvest", {
        success: true,
        message: `Harvest rewards from ${vault.name}`,
        vault: {
          id: vault.id,
          name: vault.name,
          asset: vault.asset
        },
        note: "To execute the actual harvest, use the /troves/harvest API endpoint with your Starknet account"
      });
    } catch (error) {
      return this.createErrorResult(
        "troves_harvest_error",
        error instanceof Error ? error.message : "Failed to harvest rewards"
      );
    }
  }
}

export const trovesTool = new TrovesTool();
