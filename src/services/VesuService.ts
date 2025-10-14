import { RpcProvider, Contract, Account, cairo } from 'starknet';
import { injectable } from 'tsyringe';
import {
  VesuPool,
  VesuPosition,
  VesuLendingOperation,
  VesuQuote,
  VesuHealthCheck,
  VesuConfig,
} from '../types/vesu';

@injectable()
export class VesuService {
  private provider!: RpcProvider;
  private config: VesuConfig;

  constructor() {
    this.config = {
      rpcUrl: 'https://starknet-mainnet.public.blastapi.io/rpc/v0_8',
      network: 'mainnet',
      contractAddresses: {
        poolFactory:
          '0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0',
        oracle:
          '0xfe4bfb1b353ba51eb34dff963017f94af5a5cf8bdf3dfc191c504657f3c05',
        multiply:
          '0x7964760e90baa28841ec94714151e03fbc13321797e68a874e88f27c9d58513',
        liquidate:
          '0x6b895ba904fb8f02ed0d74e343161de48e611e9e771be4cc2c997501dbfb418',
        defiSpringDistributor:
          '0x387f3eb1d98632fbe3440a9f1385aec9d87b6172491d3dd81f1c35a7c61048f',
        btcFiDistributor:
          '0x47ba31cdfc2db9bd20ab8a5b2788f877964482a8548a6e366ce56228ea22fa8',
        primePool:
          '0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5',
        re7UsdcCore:
          '0x3976cac265a12609934089004df458ea29c776d77da423c96dc761d09d24124',
        re7UsdcPrime:
          '0x2eef0c13b10b487ea5916b54c0a7f98ec43fb3048f60fdeedaf5b08f6f88aaf',
        re7UsdcFrontier:
          '0x5c03e7e0ccfe79c634782388eb1e6ed4e8e2a013ab0fcc055140805e46261bd',
        re7xBtc:
          '0x3a8416bf20d036df5b1cf3447630a2e1cb04685f6b0c3a70ed7fb1473548ecf',
        re7UsdcStableCore:
          '0x73702fce24aba36da1eac539bd4bae62d4d6a76747b7cdd3e016da754d7a135',
      },
      supportedAssets: [
        'ETH',
        'STRK',
        'USDC',
        'USDT',
        'WBTC',
        'wstETH',
        'EKUBO',
        'xSTRK',
      ],
    };
  }

  async initialize(): Promise<void> {
    try {
      this.provider = new RpcProvider({
        nodeUrl: this.config.rpcUrl,
      });
    } catch (error) {
      throw new Error(
        `VesuService initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getAvailablePools(): Promise<VesuPool[]> {
    try {
      // Fetch real data from Vesu API
      const response = await fetch('https://api.vesu.xyz/pools');

      if (!response.ok) {
        throw new Error(
          `Vesu API error: ${response.status} ${response.statusText}`
        );
      }

      const apiData = await response.json();
      const pools = apiData.data || [];

      // Transform Vesu API data to our internal format
      const transformedPools: VesuPool[] = pools
        .map((pool: any) => {
          const asset = pool.assets[0]; // Get the first asset from the pool
          if (!asset) return null;

          // Convert APY from decimal format (e.g., 35204782697994705 with 18 decimals)
          const supplyApyDecimal =
            Number(asset.stats.supplyApy.value) /
            Math.pow(10, asset.stats.supplyApy.decimals);
          const apy = supplyApyDecimal * 100; // Convert to percentage

          // Convert utilization rate
          const utilizationDecimal =
            Number(asset.stats.currentUtilization.value) /
            Math.pow(10, asset.stats.currentUtilization.decimals);
          const utilizationRate = utilizationDecimal;

          // Convert total supplied and borrowed
          const totalSupplied = asset.stats.totalSupplied.value;
          const totalDebt = asset.stats.totalDebt.value;

          return {
            id: pool.id,
            asset: asset.symbol,
            symbol: asset.symbol,
            decimals: asset.decimals,
            contractAddress: asset.address,
            apy: Math.round(apy * 100) / 100, // Round to 2 decimal places
            totalLiquidity: totalSupplied,
            totalBorrowed: totalDebt,
            utilizationRate: Math.round(utilizationRate * 100) / 100,
            isActive:
              asset.stats.canBeBorrowed &&
              (!pool.shutdownMode || pool.shutdownMode === 'none'),
            // Additional Vesu-specific data
            vTokenAddress: asset.vToken.address,
            vTokenSymbol: asset.vToken.symbol,
            borrowApr:
              (Number(asset.stats.borrowApr.value) /
                Math.pow(10, asset.stats.borrowApr.decimals)) *
              100,
            usdPrice:
              Number(asset.usdPrice.value) /
              Math.pow(10, asset.usdPrice.decimals),
            poolName: pool.name || pool.id || `${asset.symbol} Pool`,
          };
        })
        .filter((pool: any) => pool !== null);

      return transformedPools;
    } catch (error) {
      throw new Error(
        `Failed to fetch pools: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getUserPositions(userAddress: string): Promise<VesuPosition[]> {
    try {
      if (!this.provider) {
        throw new Error('VesuService not initialized');
      }

      // Get all available pools
      const pools = await this.getAvailablePools();
      const positions: VesuPosition[] = [];

      // Check user's vToken balances for each pool
      for (const pool of pools) {
        if (!pool.vTokenAddress) continue;

        try {
          // vToken ABI for balance checking
          const vTokenABI = [
            {
              name: 'balanceOf',
              type: 'function',
              inputs: [{ name: 'account', type: 'felt' }],
              outputs: [{ name: 'balance', type: 'Uint256' }],
            },
          ];

          const vTokenContract = new Contract(
            vTokenABI,
            pool.vTokenAddress,
            this.provider
          );

          // Get user's vToken balance
          const vTokenBalance = await vTokenContract.balanceOf(userAddress);

          if (vTokenBalance && Number(vTokenBalance.balance) > 0) {
            // Convert vToken balance to underlying asset amount
            // This is a simplified calculation - actual conversion may require
            // additional contract calls to get exchange rates
            const suppliedAmount = vTokenBalance.balance.toString();
            const collateralValue =
              (Number(suppliedAmount) / Math.pow(10, pool.decimals)) *
              (pool.usdPrice || 0);

            positions.push({
              userAddress,
              poolId: pool.id,
              asset: pool.asset,
              suppliedAmount,
              borrowedAmount: '0',
              healthFactor: 999.99, // No borrowing = no liquidation risk
              liquidationThreshold: 0.8,
              collateralValue: collateralValue.toString(),
              debtValue: '0',
            });
          }
        } catch (error) {}
      }

      return positions;
    } catch (error) {
      throw new Error(
        `Failed to fetch user positions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getBestYieldQuote(
    amount: string,
    timeHorizon: number = 30
  ): Promise<VesuQuote> {
    try {
      const pools = await this.getAvailablePools();

      // Find the pool with the highest APY
      const bestPool = pools.reduce((best, current) =>
        current.apy > best.apy ? current : best
      );

      const amountBN = BigInt(amount);
      const apyDecimal = bestPool.apy / 100;
      const timeFraction = timeHorizon / 365;
      const estimatedYield =
        (amountBN * BigInt(Math.floor(apyDecimal * timeFraction * 10000))) /
        BigInt(10000);

      return {
        poolId: bestPool.id,
        asset: bestPool.asset,
        amount,
        apy: bestPool.apy,
        estimatedYield: estimatedYield.toString(),
        timeHorizon,
      };
    } catch (error) {
      throw new Error(
        `Failed to get yield quote: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async executeLendingOperation(
    operation: VesuLendingOperation,
    account: Account
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      if (!this.provider) {
        throw new Error('VesuService not initialized');
      }

      const { poolId, amount, operation: op, userAddress } = operation;

      // Get the pool information to find the vToken contract address
      const pools = await this.getAvailablePools();
      const targetPool = pools.find(pool => pool.id === poolId);

      if (!targetPool || !targetPool.vTokenAddress) {
        throw new Error(
          `Pool not found or vToken address not available for pool: ${poolId}`
        );
      }

      const amountUint256 = cairo.uint256(amount);

      // Vesu vToken ABI for lending operations
      const vTokenABI = [
        {
          name: 'deposit',
          type: 'function',
          inputs: [
            { name: 'amount', type: 'Uint256' },
            { name: 'to', type: 'felt' },
          ],
          outputs: [],
        },
        {
          name: 'withdraw',
          type: 'function',
          inputs: [
            { name: 'amount', type: 'Uint256' },
            { name: 'to', type: 'felt' },
          ],
          outputs: [],
        },
        {
          name: 'borrow',
          type: 'function',
          inputs: [
            { name: 'amount', type: 'Uint256' },
            { name: 'to', type: 'felt' },
          ],
          outputs: [],
        },
        {
          name: 'repay',
          type: 'function',
          inputs: [
            { name: 'amount', type: 'Uint256' },
            { name: 'to', type: 'felt' },
          ],
          outputs: [],
        },
        {
          name: 'balanceOf',
          type: 'function',
          inputs: [{ name: 'account', type: 'felt' }],
          outputs: [{ name: 'balance', type: 'Uint256' }],
        },
      ];

      const vTokenContract = new Contract(
        vTokenABI,
        targetPool.vTokenAddress,
        this.provider
      );

      let calldata: any[];
      let methodName: string;

      switch (op) {
        case 'supply':
          methodName = 'deposit';
          calldata = [
            amountUint256,
            userAddress || account.address, // to
          ];
          break;
        case 'withdraw':
          methodName = 'withdraw';
          calldata = [
            amountUint256,
            userAddress || account.address, // to
          ];
          break;
        case 'borrow':
          // Borrowing in Vesu V2 uses the pool contracts directly
          methodName = 'borrow';
          calldata = [
            amountUint256,
            userAddress || account.address, // to
          ];
          break;
        case 'repay':
          // Repaying in Vesu V2 uses the pool contracts directly
          methodName = 'repay';
          calldata = [
            amountUint256,
            userAddress || account.address, // to
          ];
          break;
        default:
          throw new Error(`Unsupported operation: ${op}`);
      }

      // Execute the transaction on the vToken contract
      const response = await account.execute({
        contractAddress: targetPool.vTokenAddress,
        entrypoint: methodName,
        calldata: calldata,
      });

      return {
        success: true,
        transactionHash: response.transaction_hash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkHealthFactor(userAddress: string): Promise<VesuHealthCheck> {
    try {
      const positions = await this.getUserPositions(userAddress);

      if (positions.length === 0) {
        return {
          status: 'healthy',
          healthFactor: 999.99,
          recommendations: ['No active positions'],
        };
      }

      // Calculate overall health factor
      const totalCollateral = positions.reduce(
        (sum, pos) => sum + BigInt(pos.collateralValue),
        BigInt(0)
      );
      const totalDebt = positions.reduce(
        (sum, pos) => sum + BigInt(pos.debtValue),
        BigInt(0)
      );

      const healthFactor =
        totalDebt > 0 ? Number(totalCollateral) / Number(totalDebt) : 999.99;

      let status: 'healthy' | 'warning' | 'critical';
      let recommendations: string[] = [];

      if (healthFactor < 1.1) {
        status = 'critical';
        recommendations = [
          'Health factor is critically low',
          'Consider repaying debt or adding collateral immediately',
          'Risk of liquidation is high',
        ];
      } else if (healthFactor < 1.5) {
        status = 'warning';
        recommendations = [
          'Health factor is low',
          'Consider adding more collateral',
          'Monitor your position closely',
        ];
      } else {
        status = 'healthy';
        recommendations = ['Position is healthy'];
      }

      return {
        status,
        healthFactor,
        recommendations,
      };
    } catch (error) {
      throw new Error(
        `Failed to check health factor: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      if (!this.provider) {
        return {
          status: 'not_initialized',
          details: {
            provider: !!this.provider,
            architecture: 'vToken-based',
          },
        };
      }

      const pools = await this.getAvailablePools();
      const apiStatus = await this.testVesuApiConnection();

      return {
        status: 'healthy',
        details: {
          provider: !!this.provider,
          architecture: 'vToken-based',
          availablePools: pools.length,
          supportedAssets: this.config.supportedAssets,
          network: this.config.network,
          vesuApiStatus: apiStatus,
          realTimeData: pools.length > 0 ? 'enabled' : 'api_error',
        },
      };
    } catch (error) {
      return {
        status: 'error',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          provider: !!this.provider,
          architecture: 'vToken-based',
        },
      };
    }
  }

  private async testVesuApiConnection(): Promise<string> {
    try {
      const response = await fetch('https://api.vesu.xyz/pools', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        // Add timeout
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return 'connected';
      } else {
        return `error_${response.status}`;
      }
    } catch (error) {
      return 'disconnected';
    }
  }

  isInitialized(): boolean {
    return !!this.provider;
  }

  getConfig(): VesuConfig {
    return this.config;
  }

  async getPoolByAsset(assetSymbol: string): Promise<VesuPool | null> {
    try {
      const pools = await this.getAvailablePools();
      return (
        pools.find(pool => pool.asset === assetSymbol.toUpperCase()) || null
      );
    } catch (error) {
      return null;
    }
  }

  async getPoolStats(): Promise<{
    totalPools: number;
    totalAssets: string[];
    highestApy: { asset: string; apy: number };
    totalLiquidity: number;
    averageUtilization: number;
  }> {
    try {
      const pools = await this.getAvailablePools();

      if (pools.length === 0) {
        return {
          totalPools: 0,
          totalAssets: [],
          highestApy: { asset: '', apy: 0 },
          totalLiquidity: 0,
          averageUtilization: 0,
        };
      }

      const totalAssets = [...new Set(pools.map(pool => pool.asset))];
      const highestApyPool = pools.reduce((best, current) =>
        current.apy > best.apy ? current : best
      );

      const totalLiquidity = pools.reduce((sum, pool) => {
        const liquidity =
          Number(pool.totalLiquidity) / Math.pow(10, pool.decimals);
        return sum + liquidity;
      }, 0);

      const averageUtilization =
        pools.reduce((sum, pool) => sum + pool.utilizationRate, 0) /
        pools.length;

      return {
        totalPools: pools.length,
        totalAssets,
        highestApy: { asset: highestApyPool.asset, apy: highestApyPool.apy },
        totalLiquidity: Math.round(totalLiquidity * 100) / 100,
        averageUtilization: Math.round(averageUtilization * 100) / 100,
      };
    } catch (error) {
      throw new Error(
        `Failed to get pool stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get native STRK balance for an account
   */
  async getNativeSTRKBalance(
    address: string
  ): Promise<{ balance: string; formatted: string }> {
    try {
      // STRK token contract address on Starknet mainnet
      const strkTokenAddress =
        '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

      // ERC20 balanceOf function selector
      const balanceOfSelector =
        '0x2e42684afd9ff2fdb8ea8e9d9b29a9a468420ce969663ce48f8c417e2ae5a7b';

      // Call balanceOf on STRK token contract
      const result = await this.provider.callContract({
        contractAddress: strkTokenAddress,
        entrypoint: 'balanceOf',
        calldata: [address],
      });

      // Extract balance from result (first element is the balance)
      const balance = result[0];
      const formattedBalance = (Number(balance) / Math.pow(10, 18)).toFixed(6);

      return {
        balance: balance,
        formatted: formattedBalance,
      };
    } catch (error) {
      return {
        balance: '0',
        formatted: '0.000000',
      };
    }
  }
}

export const vesuService = new VesuService();
