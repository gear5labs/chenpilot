import { BaseTool } from './base/BaseTool';
import { ToolMetadata, ToolResult } from '../registry/ToolMetadata';
import { container } from 'tsyringe';
import { VesuService } from '../../services/VesuService';
import { memoryStore } from '../memory/memory';
import { authenticate } from '../../Auth/auth';
import { UnauthorizedError } from '../../utils/error';
import { Account } from 'starknet';
import { AuthService } from '../../Auth/auth.service';
import config from '../../config/config';
import { RpcProvider } from 'starknet';

interface VesuPayload extends Record<string, unknown> {
  operation: string;
  asset?: string;
  amount?: number;
  poolId?: string;
  positionId?: string;
  collateralAsset?: string;
  borrowAsset?: string;
  collateralAmount?: number;
  borrowAmount?: number;
  userAddress?: string;
  healthFactor?: number;
  timeHorizon?: number;
}

export class VesuTool extends BaseTool<VesuPayload> {
  metadata: ToolMetadata = {
    name: 'vesu_tool',
    description:
      'DeFi lending and borrowing operations via Vesu - lend, borrow, manage positions, and check health',
    parameters: {
      operation: {
        type: 'string',
        description:
          "The operation to perform (e.g., 'lend', 'borrow', 'withdraw', 'repay', 'get_pools', 'get_positions', 'get_quote', 'check_health')",
        required: true,
        enum: [
          'lend',
          'borrow',
          'withdraw',
          'repay',
          'get_pools',
          'get_positions',
          'get_quote',
          'check_health',
          'get_pool_stats',
          'get_pool_by_asset',
          'check_health_factor',
        ],
      },
      asset: {
        type: 'string',
        description: "The asset symbol (e.g., 'ETH', 'STRK', 'USDC')",
        required: false,
      },
      amount: {
        type: 'number',
        description: 'The amount of asset for the operation',
        required: false,
      },
      poolId: {
        type: 'string',
        description: 'The ID of the lending pool',
        required: false,
      },
      positionId: {
        type: 'string',
        description: "The ID of the user's lending/borrowing position",
        required: false,
      },
      collateralAsset: {
        type: 'string',
        description: 'The asset used as collateral',
        required: false,
      },
      borrowAsset: {
        type: 'string',
        description: 'The asset to borrow',
        required: false,
      },
      collateralAmount: {
        type: 'number',
        description: 'The amount of collateral',
        required: false,
      },
      borrowAmount: {
        type: 'number',
        description: 'The amount to borrow',
        required: false,
      },
      userAddress: {
        type: 'string',
        description: "The user's wallet address",
        required: false,
      },
      healthFactor: {
        type: 'number',
        description: 'The health factor of a position',
        required: false,
      },
      timeHorizon: {
        type: 'number',
        description: 'Time horizon in days for yield quote (default: 30)',
        required: false,
      },
    },
    examples: [
      'Lend 100 STRK to earn interest',
      'Borrow 50 USDC against collateral',
      'Check my lending positions',
      'What are the available lending pools?',
      'Get a quote for lending 10 ETH for 60 days',
      'Check the health factor for my position',
    ],
    category: 'defi',
    version: '1.0.0',
  };

  private vesuService = container.resolve(VesuService);
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

  async execute(payload: VesuPayload, userId: string): Promise<ToolResult> {
    const {
      operation,
      asset,
      amount,
      poolId,
      positionId,
      collateralAsset,
      borrowAsset,
      collateralAmount,
      borrowAmount,
      userAddress,
      timeHorizon,
    } = payload;

    try {
      // Authenticate user for operations requiring a connected wallet
      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError(
          'Invalid credentials or user not authenticated.'
        );
      }

      let account: Account | undefined;
      if (['lend', 'borrow', 'withdraw', 'repay'].includes(operation)) {
        account = await this.getUserStarknetAccount(userId);
      }

      switch (operation) {
        case 'get_pools':
          const pools = await this.vesuService.getAvailablePools();
          return this.createSuccessResult('vesu_pools', { pools });

        case 'get_positions':
          if (!userAddress)
            return this.createErrorResult(
              'vesu_positions',
              'User address is required.'
            );
          const positions =
            await this.vesuService.getUserPositions(userAddress);
          return this.createSuccessResult('vesu_positions', {
            userAddress,
            positions,
          });

        case 'get_quote':
          if (!amount)
            return this.createErrorResult(
              'vesu_quote',
              'Amount is required for quote.'
            );
          const quote = await this.vesuService.getBestYieldQuote(
            amount.toString(),
            timeHorizon
          );
          return this.createSuccessResult('vesu_quote', {
            amount,
            timeHorizon,
            quote,
          });

        case 'lend':
          if (!account || !poolId || !amount)
            return this.createErrorResult(
              'vesu_lend',
              'Account, pool ID, and amount are required for lending.'
            );
          const lendOperation = {
            poolId,
            amount: amount.toString(),
            operation: 'supply' as const,
            userAddress: account.address,
          };
          const lendResult = await this.vesuService.executeLendingOperation(
            lendOperation,
            account
          );
          return this.createSuccessResult('vesu_lend', { lendResult });

        case 'borrow':
          if (!account || !poolId || !amount)
            return this.createErrorResult(
              'vesu_borrow',
              'Account, pool ID, and amount are required for borrowing.'
            );
          const borrowOperation = {
            poolId,
            amount: amount.toString(),
            operation: 'borrow' as const,
            userAddress: account.address,
          };
          const borrowResult = await this.vesuService.executeLendingOperation(
            borrowOperation,
            account
          );
          return this.createSuccessResult('vesu_borrow', { borrowResult });

        case 'withdraw':
          if (!account || !poolId || !amount)
            return this.createErrorResult(
              'vesu_withdraw',
              'Account, pool ID, and amount are required for withdrawal.'
            );
          const withdrawOperation = {
            poolId,
            amount: amount.toString(),
            operation: 'withdraw' as const,
            userAddress: account.address,
          };
          const withdrawResult = await this.vesuService.executeLendingOperation(
            withdrawOperation,
            account
          );
          return this.createSuccessResult('vesu_withdraw', { withdrawResult });

        case 'repay':
          if (!account || !poolId || !amount)
            return this.createErrorResult(
              'vesu_repay',
              'Account, pool ID, and amount are required for repayment.'
            );
          const repayOperation = {
            poolId,
            amount: amount.toString(),
            operation: 'repay' as const,
            userAddress: account.address,
          };
          const repayResult = await this.vesuService.executeLendingOperation(
            repayOperation,
            account
          );
          return this.createSuccessResult('vesu_repay', { repayResult });

        case 'check_health':
          const health = await this.vesuService.healthCheck();
          return this.createSuccessResult('vesu_health', { health });

        case 'get_pool_stats':
          const stats = await this.vesuService.getPoolStats();
          return this.createSuccessResult('vesu_pool_stats', { stats });

        case 'get_pool_by_asset':
          if (!asset)
            return this.createErrorResult(
              'vesu_pool_by_asset',
              'Asset is required.'
            );
          const poolByAsset = await this.vesuService.getPoolByAsset(asset);
          return this.createSuccessResult('vesu_pool_by_asset', {
            asset,
            pool: poolByAsset,
          });

        case 'check_health_factor':
          if (!userAddress)
            return this.createErrorResult(
              'vesu_check_health_factor',
              'User address is required.'
            );
          const healthFactor =
            await this.vesuService.checkHealthFactor(userAddress);
          return this.createSuccessResult('vesu_check_health_factor', {
            userAddress,
            healthFactor,
          });

        default:
          return this.createErrorResult(
            'vesu_tool',
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      memoryStore.add(
        userId,
        `Error in VesuTool: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return this.createErrorResult('vesu_tool', (error as Error).message);
    }
  }
}

export const vesuTool = new VesuTool();
