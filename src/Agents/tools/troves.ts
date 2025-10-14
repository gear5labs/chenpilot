import { BaseTool } from './base/BaseTool';
import { ToolMetadata, ToolResult } from '../registry/ToolMetadata';
import { container } from 'tsyringe';
import { TrovesService } from '../../services/TrovesService';
import { authenticate } from '../../Auth/auth';
import { UnauthorizedError } from '../../utils/error';
import { Account } from 'starknet';
import { AuthService } from '../../Auth/auth.service';
import config from '../../config/config';
import { RpcProvider } from 'starknet';

interface TrovesPayload extends Record<string, unknown> {
  operation: string;
  strategyId?: string;
  vaultId?: string;
  amount?: number;
  asset?: string;
  userAddress?: string;
  positionId?: string;
  harvestAmount?: number;
  minAmountOut?: number;
  slippageTolerance?: number;
}

export class TrovesTool extends BaseTool<TrovesPayload> {
  metadata: ToolMetadata = {
    name: 'troves_tool',
    description:
      'Yield farming operations via Troves - deposit, withdraw, harvest yields, and manage positions',
    parameters: {
      operation: {
        type: 'string',
        description: 'The yield farming operation to perform',
        required: true,
        enum: [
          'get_strategies',
          'get_strategy_details',
          'get_vaults',
          'get_vault_details',
          'deposit',
          'withdraw',
          'harvest',
          'get_positions',
          'get_position_details',
          'get_yield_data',
          'get_quotes',
          'get_health_check',
          'get_supported_assets',
          'get_vault_apy',
          'get_user_balance',
          'get_total_value_locked',
        ],
      },
      strategyId: {
        type: 'string',
        description: 'Strategy ID for operations',
        required: false,
      },
      vaultId: {
        type: 'string',
        description: 'Vault ID for operations',
        required: false,
      },
      amount: {
        type: 'number',
        description: 'Amount to deposit/withdraw',
        required: false,
      },
      asset: {
        type: 'string',
        description: 'Asset to use (STRK, ETH, USDC, WBTC, USDT)',
        required: false,
      },
      userAddress: {
        type: 'string',
        description: 'User wallet address',
        required: false,
      },
      positionId: {
        type: 'string',
        description: 'Position ID for position operations',
        required: false,
      },
      harvestAmount: {
        type: 'number',
        description: 'Amount to harvest',
        required: false,
      },
      minAmountOut: {
        type: 'number',
        description: 'Minimum amount out for swaps',
        required: false,
      },
      slippageTolerance: {
        type: 'number',
        description: 'Slippage tolerance percentage',
        required: false,
      },
    },
    examples: [
      'Show available yield farming strategies',
      'Deposit 100 STRK into yield farming',
      'Withdraw my yield farming position',
      'Harvest my yield rewards',
      'Check my yield farming positions',
      'Get quotes for yield farming',
      'Show vault APY rates',
    ],
    category: 'yield_farming',
    version: '1.0.0',
  };

  private trovesService = container.resolve(TrovesService);
  private authService = container.resolve(AuthService);

  private async getUserStarknetAccount(userId: string): Promise<Account> {
    const userAccountData = await this.authService.getUserAccountData(userId);

    if (!userAccountData) {
      throw new Error('User account not found');
    }

    const provider = new RpcProvider({
      nodeUrl: config.node_url,
    });

    const account = new Account(
      provider,
      userAccountData.precalculatedAddress,
      userAccountData.privateKey
    );

    return account;
  }

  async execute(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    const { operation } = payload;

    try {
      switch (operation) {
        case 'get_strategies':
          return await this.getStrategies();
        case 'get_strategy_details':
          return await this.getStrategyDetails(payload);
        case 'get_vaults':
          return await this.getVaults();
        case 'get_vault_details':
          return await this.getVaultDetails(payload);
        case 'deposit':
          return await this.deposit(payload, userId);
        case 'withdraw':
          return await this.withdraw(payload, userId);
        case 'harvest':
          return await this.harvest(payload, userId);
        case 'get_positions':
          return await this.getPositions(payload);
        case 'get_position_details':
          return await this.getPositionDetails(payload);
        case 'get_yield_data':
          return await this.getYieldData(payload);
        case 'get_quotes':
          return await this.getQuotes(payload);
        case 'get_health_check':
          return await this.getHealthCheck(payload);
        case 'get_supported_assets':
          return await this.getSupportedAssets();
        case 'get_vault_apy':
          return await this.getVaultAPY(payload);
        case 'get_user_balance':
          return await this.getUserBalance(payload);
        case 'get_total_value_locked':
          return await this.getTotalValueLocked();
        default:
          return this.createErrorResult(
            'troves_operation',
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult(
        'troves_error',
        `Troves operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getStrategies(): Promise<ToolResult> {
    try {
      const strategies = await this.trovesService.getAvailableStrategies();
      return this.createSuccessResult('troves_strategies', {
        strategies: strategies,
        message: `Found ${strategies.length} available yield farming strategies`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_strategies',
        `Failed to get strategies: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getStrategyDetails(
    payload: TrovesPayload
  ): Promise<ToolResult> {
    if (!payload.strategyId) {
      return this.createErrorResult(
        'troves_strategy',
        'Strategy ID is required'
      );
    }

    try {
      // Get all strategies and find the one with matching ID
      const strategies = await this.trovesService.getAvailableStrategies();
      const strategy = strategies.find(s => s.id === payload.strategyId);
      if (!strategy) {
        return this.createErrorResult(
          'troves_strategy',
          `Strategy ${payload.strategyId} not found`
        );
      }
      return this.createSuccessResult('troves_strategy', {
        strategyId: payload.strategyId,
        strategy: strategy,
        message: `Strategy details for ${payload.strategyId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_strategy',
        `Failed to get strategy details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getVaults(): Promise<ToolResult> {
    try {
      const vaults = await this.trovesService.getAvailableVaults();
      return this.createSuccessResult('troves_vaults', {
        vaults: vaults,
        message: `Found ${vaults.length} available vaults`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_vaults',
        `Failed to get vaults: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getVaultDetails(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.vaultId) {
      return this.createErrorResult('troves_vault', 'Vault ID is required');
    }

    try {
      // Get all vaults and find the one with matching ID
      const vaults = await this.trovesService.getAvailableVaults();
      const vault = vaults.find(v => v.id === payload.vaultId);
      if (!vault) {
        return this.createErrorResult(
          'troves_vault',
          `Vault ${payload.vaultId} not found`
        );
      }
      return this.createSuccessResult('troves_vault', {
        vaultId: payload.vaultId,
        vault: vault,
        message: `Vault details for ${payload.vaultId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_vault',
        `Failed to get vault details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async deposit(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    if (!payload.amount || !payload.asset) {
      return this.createErrorResult(
        'troves_deposit',
        'Amount and asset are required for deposit'
      );
    }

    try {
      // Authenticate user
      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError('Invalid credentials or user not authenticated.');
      }

      // Get user's deployed account
      const account = await this.getUserStarknetAccount(userId);

      // If no vaultId provided, find the best vault for the asset
      let targetVaultId = payload.vaultId;
      if (!targetVaultId) {
        const vaults = await this.trovesService.getAvailableVaults();
        const assetVault = vaults.find(vault => 
          vault.asset === payload.asset && vault.isActive
        );
        if (assetVault) {
          targetVaultId = assetVault.id;
        }
      }

      if (!targetVaultId) {
        return this.createErrorResult(
          'troves_deposit',
          'Vault ID is required for deposit. Please specify a vault or asset.'
        );
      }

      // Create deposit operation
      const depositOperation = {
        vaultId: targetVaultId,
        amount: payload.amount.toString(),
        asset: payload.asset,
        userAddress: account.address,
      };

      // Execute deposit transaction
      const depositResult = await this.trovesService.executeDeposit(
        depositOperation,
        account
      );

      if (depositResult.success) {
        return this.createSuccessResult('troves_deposit', {
          message: `Successfully deposited ${payload.amount} ${payload.asset} into Troves vault. Transaction: ${depositResult.transactionHash}`,
          transactionHash: depositResult.transactionHash,
          amount: payload.amount,
          asset: payload.asset,
          vaultId: targetVaultId
        });
      } else {
        return this.createErrorResult('troves_deposit', depositResult.error || 'Deposit failed');
      }
    } catch (error) {
      return this.createErrorResult(
        'troves_deposit',
        `Failed to execute deposit: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async withdraw(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    if (!payload.amount) {
      return this.createErrorResult(
        'troves_withdraw',
        'Amount is required for withdrawal'
      );
    }

    try {
      // Authenticate user
      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError('Invalid credentials or user not authenticated.');
      }

      // Get user's deployed account
      const account = await this.getUserStarknetAccount(userId);

      // If no vaultId provided, find the user's vault positions
      let targetVaultId = payload.vaultId;
      if (!targetVaultId) {
        const positions = await this.trovesService.getUserPositions(account.address);
        if (positions.length > 0) {
          // Use the first position's vault
          targetVaultId = (positions[0] as any).vaultId;
        }
      }

      if (!targetVaultId) {
        return this.createErrorResult(
          'troves_withdraw',
          'Vault ID is required for withdrawal. Please specify a vault or ensure you have positions.'
        );
      }

      // Create withdraw operation - convert amount to shares
      const withdrawOperation = {
        vaultId: targetVaultId,
        shares: payload.amount.toString(), // For now, treating amount as shares
        userAddress: account.address,
      };

      // Execute withdraw transaction
      const withdrawResult = await this.trovesService.executeWithdraw(
        withdrawOperation,
        account
      );

      if (withdrawResult.success) {
        return this.createSuccessResult('troves_withdraw', {
          message: `Successfully withdrew ${payload.amount} from Troves vault. Transaction: ${withdrawResult.transactionHash}`,
          transactionHash: withdrawResult.transactionHash,
          amount: payload.amount,
          vaultId: targetVaultId
        });
      } else {
        return this.createErrorResult('troves_withdraw', withdrawResult.error || 'Withdrawal failed');
      }
    } catch (error) {
      return this.createErrorResult(
        'troves_withdraw',
        `Failed to execute withdrawal: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async harvest(payload: TrovesPayload, userId: string): Promise<ToolResult> {
    try {
      // Authenticate user
      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError('Invalid credentials or user not authenticated.');
      }

      // Get user's deployed account
      const account = await this.getUserStarknetAccount(userId);

      // If no vaultId provided, find the user's vault positions
      let targetVaultId = payload.vaultId;
      if (!targetVaultId) {
        const positions = await this.trovesService.getUserPositions(account.address);
        if (positions.length > 0) {
          // Use the first position's vault
          targetVaultId = (positions[0] as any).vaultId;
        }
      }

      if (!targetVaultId) {
        return this.createErrorResult(
          'troves_harvest',
          'Vault ID is required for harvest. Please specify a vault or ensure you have positions.'
        );
      }

      // Create harvest operation
      const harvestOperation = {
        vaultId: targetVaultId,
        userAddress: account.address,
        estimatedRewards: payload.harvestAmount?.toString() || '0', // Estimated rewards to harvest
      };

      // Execute harvest transaction
      const harvestResult = await this.trovesService.harvestRewards(
        harvestOperation,
        account
      );

      if (harvestResult.success) {
        return this.createSuccessResult('troves_harvest', {
          message: `Successfully harvested rewards from Troves vault. Transaction: ${harvestResult.transactionHash}`,
          transactionHash: harvestResult.transactionHash,
          vaultId: targetVaultId
        });
      } else {
        return this.createErrorResult('troves_harvest', harvestResult.error || 'Harvest failed');
      }
    } catch (error) {
      return this.createErrorResult(
        'troves_harvest',
        `Failed to execute harvest: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getPositions(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.userAddress) {
      return this.createErrorResult(
        'troves_positions',
        'User address is required for positions'
      );
    }

    try {
      const positions = await this.trovesService.getUserPositions(
        payload.userAddress
      );
      return this.createSuccessResult('troves_positions', {
        userAddress: payload.userAddress,
        positions: positions,
        message: `Found ${positions.length} positions for ${payload.userAddress}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_positions',
        `Failed to get positions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getPositionDetails(
    payload: TrovesPayload
  ): Promise<ToolResult> {
    if (!payload.positionId) {
      return this.createErrorResult(
        'troves_position',
        'Position ID is required'
      );
    }

    try {
      // Get all positions and find the one with matching ID
      const positions = await this.trovesService.getUserPositions(
        payload.userAddress || ''
      );
      const position = positions.find(
        p => (p as any).id === payload.positionId
      );
      if (!position) {
        return this.createErrorResult(
          'troves_position',
          `Position ${payload.positionId} not found`
        );
      }
      return this.createSuccessResult('troves_position', {
        positionId: payload.positionId,
        position: position,
        message: `Position details for ${payload.positionId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_position',
        `Failed to get position details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getYieldData(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.vaultId) {
      return this.createErrorResult(
        'troves_yield',
        'Vault ID is required for yield data'
      );
    }

    try {
      const yieldData = await this.trovesService.getYieldData(payload.vaultId);
      return this.createSuccessResult('troves_yield', {
        vaultId: payload.vaultId,
        yieldData: yieldData,
        message: `Yield data for vault ${payload.vaultId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_yield',
        `Failed to get yield data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getQuotes(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.vaultId || !payload.amount || !payload.asset) {
      return this.createErrorResult(
        'troves_quotes',
        'Vault ID, amount, and asset are required for quotes'
      );
    }

    try {
      const quotes = await this.trovesService.getDepositQuote(
        payload.vaultId,
        payload.amount.toString(),
        payload.asset
      );
      return this.createSuccessResult('troves_quotes', {
        vaultId: payload.vaultId,
        amount: payload.amount,
        asset: payload.asset,
        quotes: quotes,
        message: `Deposit quotes for ${payload.amount} ${payload.asset} into vault ${payload.vaultId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_quotes',
        `Failed to get quotes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getHealthCheck(payload: TrovesPayload): Promise<ToolResult> {
    try {
      const healthCheck = await this.trovesService.healthCheck();
      return this.createSuccessResult('troves_health', {
        healthCheck: healthCheck,
        message: `System health check: ${(healthCheck as any).isHealthy ? 'Healthy' : 'At Risk'}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_health',
        `Failed to get health check: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getSupportedAssets(): Promise<ToolResult> {
    try {
      // Get supported assets from config
      const assets = ['STRK', 'ETH', 'USDC', 'WBTC', 'USDT'];
      return this.createSuccessResult('troves_assets', {
        assets: assets,
        message: `Supported assets: ${assets.join(', ')}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_assets',
        `Failed to get supported assets: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getVaultAPY(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.vaultId) {
      return this.createErrorResult(
        'troves_apy',
        'Vault ID is required for APY'
      );
    }

    try {
      // Get vault details to extract APY
      const vaults = await this.trovesService.getAvailableVaults();
      const vault = vaults.find(v => v.id === payload.vaultId);
      if (!vault) {
        return this.createErrorResult(
          'troves_apy',
          `Vault ${payload.vaultId} not found`
        );
      }
      return this.createSuccessResult('troves_apy', {
        vaultId: payload.vaultId,
        apy: vault.apy || 'N/A',
        message: `APY for vault ${payload.vaultId}: ${vault.apy || 'N/A'}%`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_apy',
        `Failed to get vault APY: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getUserBalance(payload: TrovesPayload): Promise<ToolResult> {
    if (!payload.userAddress) {
      return this.createErrorResult(
        'troves_balance',
        'User address is required for balance'
      );
    }

    try {
      // Get user positions to calculate balance
      const positions = await this.trovesService.getUserPositions(
        payload.userAddress
      );
      const totalBalance = positions.reduce(
        (sum, pos) => sum + ((pos as any).balance || 0),
        0
      );
      return this.createSuccessResult('troves_balance', {
        userAddress: payload.userAddress,
        balance: totalBalance,
        positions: positions.length,
        message: `Total balance for ${payload.userAddress}: ${totalBalance} (${positions.length} positions)`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_balance',
        `Failed to get user balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getTotalValueLocked(): Promise<ToolResult> {
    try {
      // Calculate TVL from all vaults
      const vaults = await this.trovesService.getAvailableVaults();
      const totalTVL = vaults.reduce(
        (sum, vault) => sum + (Number((vault as any).tvl) || 0),
        0
      );
      return this.createSuccessResult('troves_tvl', {
        tvl: totalTVL,
        vaults: vaults.length,
        message: `Total Value Locked: $${totalTVL.toLocaleString()} across ${vaults.length} vaults`,
      });
    } catch (error) {
      return this.createErrorResult(
        'troves_tvl',
        `Failed to get TVL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

export const trovesTool = new TrovesTool();
