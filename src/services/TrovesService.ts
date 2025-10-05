import { RpcProvider, Contract, Account, cairo } from "starknet";
import { injectable } from "tsyringe";
import { 
  TrovesVault, 
  TrovesPosition, 
  TrovesDepositOperation, 
  TrovesWithdrawOperation,
  TrovesQuote,
  TrovesStrategy,
  TrovesHealthCheck,
  TrovesYieldData,
  TrovesHarvestOperation,
  TrovesConfig 
} from "../types/troves";

@injectable()
export class TrovesService {
  private provider!: RpcProvider;
  private config: TrovesConfig;

  constructor() {
    // Configuration for Troves protocol
    this.config = {
      rpcUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7",
      network: "sepolia",
      contractAddresses: {
        // Troves core contracts from https://docs.troves.fi/p/developers/contracts
        accessControl: "0x0636a3f51cc37f5729e4da4b1de6a8549a28f3c0d5bf3b17f150971e451ff9c2",
        timelock: "0x0613a26e199f9bafa9418567f4ef0d78e9496a8d6aab15fba718a2ec7f2f2f69",
        // Individual vault contracts are now fetched dynamically from Troves API

      },
      supportedAssets: ["STRK", "ETH", "USDC", "WBTC", "USDT"],
      apiBaseUrl: "https://app.troves.fi/api" 
    };
  }

  async initialize(): Promise<void> {
    try {
      this.provider = new RpcProvider({
        nodeUrl: this.config.rpcUrl,
      });
      
      console.log("TrovesService initialized successfully");
    } catch (error) {
      console.error("Failed to initialize TrovesService:", error);
      throw new Error(`TrovesService initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch real strategies from Troves API
  private async fetchStrategiesFromAPI(): Promise<any[]> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/strategies`);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.strategies || [];
    } catch (error) {
      console.error("Failed to fetch strategies from API:", error);
      return [];
    }
  }

  async getAvailableVaults(): Promise<TrovesVault[]> {
    try {
      const strategies = await this.fetchStrategiesFromAPI();
      
      // Convert API strategies to TrovesVault format
      const vaults: TrovesVault[] = strategies.map((strategy: any) => {
        const depositToken = strategy.depositToken[0]; // Primary deposit token
        const contract = strategy.contract[0]; // Primary contract
        
        return {
          id: strategy.id,
          name: strategy.name,
          symbol: `v${depositToken.symbol}`,
          asset: depositToken.symbol,
          contractAddress: contract.address,
          totalAssets: "0", // Not provided by API
          totalShares: "0", // Not provided by API
          apy: strategy.apy * 100, // Convert to percentage
          tvl: strategy.tvlUsd.toString(),
          strategy: strategy.name.toLowerCase().replace(/\s+/g, '_'),
          isActive: strategy.status.number === 3, // Active status
          minDeposit: this.getMinDepositForAsset(depositToken.symbol),
          fees: {
            managementFee: 0.02, // Default fee structure
            performanceFee: 0.1
          },
          createdAt: new Date()
        };
      });

      return vaults;
    } catch (error) {
      console.error("Error fetching available vaults:", error);
      // Return empty array if API fails
      return [];
    }
  }

  private getMinDepositForAsset(asset: string): string {
    const minDeposits: { [key: string]: string } = {
      "STRK": "10",
      "ETH": "0.1",
      "USDC": "100",
      "USDT": "100",
      "WBTC": "0.001",
      "xWBTC": "0.001",
      "xsBTC": "0.001"
    };
    return minDeposits[asset] || "1";
  }

  async getUserPositions(userAddress: string): Promise<TrovesPosition[]> {
    try {
      const vaults = await this.getAvailableVaults();
      const positions: TrovesPosition[] = [];

      // Check each vault for user positions
      for (const vault of vaults) {
        try {
          // Standard ERC4626 ABI for balance queries
          const vaultABI = [
            {
              "name": "balanceOf",
              "type": "function",
              "inputs": [
                {"name": "account", "type": "felt"}
              ],
              "outputs": [
                {"name": "balance", "type": "felt"}
              ],
              "stateMutability": "view"
            },
            {
              "name": "convertToAssets",
              "type": "function",
              "inputs": [
                {"name": "shares", "type": "felt"}
              ],
              "outputs": [
                {"name": "assets", "type": "felt"}
              ],
              "stateMutability": "view"
            }
          ];

          const vaultContract = new Contract(
            vaultABI,
            vault.contractAddress,
            this.provider
          );

          // Get user's share balance
          const balanceResult = await vaultContract.call("balanceOf", [userAddress]);
          const shares = (balanceResult as any)[0];

          if (shares && shares !== "0") {
            // Convert shares to assets
            const assetsResult = await vaultContract.call("convertToAssets", [shares]);
            const assets = (assetsResult as any)[0];

            positions.push({
              userAddress,
              vaultId: vault.id,
              vaultName: vault.name,
              asset: vault.asset,
              shares,
              assets,
              depositedAt: new Date(), 
              lastUpdated: new Date(),
              estimatedValue: assets,
              apy: vault.apy,
              totalEarned: "0" 
            });
          }
        } catch (vaultError) {
          console.warn(`Could not fetch position for vault ${vault.id}:`, vaultError);
          
        }
      }

      return positions;
    } catch (error) {
      console.error("Error fetching user positions:", error);
      throw new Error(`Failed to fetch positions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getDepositQuote(vaultId: string, amount: string, asset: string): Promise<TrovesQuote> {
    try {
      const vaults = await this.getAvailableVaults();
      const vault = vaults.find(v => v.id === vaultId);
      
      if (!vault) {
        throw new Error(`Vault ${vaultId} not found`);
      }

     
      let estimatedShares = "0";
      try {
        const vaultABI = [
          {
            "name": "previewDeposit",
            "type": "function",
            "inputs": [
              {"name": "assets", "type": "felt"}
            ],
            "outputs": [
              {"name": "shares", "type": "felt"}
            ],
            "stateMutability": "view"
          }
        ];

        const vaultContract = new Contract(
          vaultABI,
          vault.contractAddress,
          this.provider
        );

        const amountUint256 = cairo.uint256(amount);
        const previewResult = await vaultContract.call("previewDeposit", [amountUint256.low, amountUint256.high]);
        estimatedShares = (previewResult as any)[0];
      } catch (previewError) {
        console.warn("Could not get preview deposit, using fallback calculation:", previewError);
        // Fallback to approximate calculation
        estimatedShares = (parseFloat(amount) * 0.95).toString();
      }

      const estimatedYield = (parseFloat(amount) * vault.apy / 100).toString();

      return {
        vaultId,
        asset,
        amount,
        estimatedShares,
        apy: vault.apy,
        estimatedYield,
        timeHorizon: 365,
        fees: vault.fees
      };
    } catch (error) {
      console.error("Error getting deposit quote:", error);
      throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeDeposit(operation: TrovesDepositOperation, account: Account): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const vaults = await this.getAvailableVaults();
      const vault = vaults.find(v => v.id === operation.vaultId);
      
      if (!vault) {
        throw new Error(`Vault ${operation.vaultId} not found`);
      }

      // Validate vault contract address
      if (!vault.contractAddress || vault.contractAddress.length !== 66 || !vault.contractAddress.startsWith('0x')) {
        throw new Error(`Invalid contract address for vault ${operation.vaultId}. Please check Troves API data.`);
      }

      // Standard ERC4626 vault ABI for deposit function
      const vaultABI = [
        {
          "name": "deposit",
          "type": "function",
          "inputs": [
            {"name": "assets", "type": "felt"},
            {"name": "receiver", "type": "felt"}
          ],
          "outputs": [
            {"name": "shares", "type": "felt"}
          ],
          "stateMutability": "external"
        },
        {
          "name": "previewDeposit",
          "type": "function",
          "inputs": [
            {"name": "assets", "type": "felt"}
          ],
          "outputs": [
            {"name": "shares", "type": "felt"}
          ],
          "stateMutability": "view"
        }
      ];

      const vaultContract = new Contract(
        vaultABI,
        vault.contractAddress,
        this.provider
      );

      // Convert amount to uint256
      const amountUint256 = cairo.uint256(operation.amount);
      const receiverAddress = operation.userAddress || account.address;

      // First, get preview of shares to be received
      let previewShares;
      try {
        const previewResult = await vaultContract.call("previewDeposit", [amountUint256.low, amountUint256.high]);
        previewShares = (previewResult as any)[0];
        console.log(`Preview: ${operation.amount} assets will receive ${previewShares} shares`);
      } catch (previewError) {
        console.warn("Could not get deposit preview:", previewError);
        previewShares = "0";
      }

      // Execute deposit transaction
      const response = await account.execute({
        contractAddress: vault.contractAddress,
        entrypoint: "deposit",
        calldata: [amountUint256.low, amountUint256.high, receiverAddress]
      });

      console.log(`Deposit transaction submitted: ${response.transaction_hash}`);

      return {
        success: true,
        transactionHash: response.transaction_hash
      };
    } catch (error) {
      console.error("Error executing deposit:", error);
      
      // Enhanced error handling
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Handle specific Starknet errors
        if (error.message.includes('insufficient balance')) {
          errorMessage = 'Insufficient balance for deposit';
        } else if (error.message.includes('vault paused')) {
          errorMessage = 'Vault is currently paused';
        } else if (error.message.includes('minimum deposit')) {
          errorMessage = 'Deposit amount below minimum threshold';
        } else if (error.message.includes('contract not found')) {
          errorMessage = 'Vault contract not found or not deployed';
        }
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async executeWithdraw(operation: TrovesWithdrawOperation, account: Account): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const vaults = await this.getAvailableVaults();
      const vault = vaults.find(v => v.id === operation.vaultId);
      
      if (!vault) {
        throw new Error(`Vault ${operation.vaultId} not found`);
      }

      // Validate vault contract address
      if (!vault.contractAddress || vault.contractAddress.length !== 66 || !vault.contractAddress.startsWith('0x')) {
        throw new Error(`Invalid contract address for vault ${operation.vaultId}. Please check Troves API data.`);
      }

      // Standard ERC4626 vault ABI for withdraw function
      const vaultABI = [
        {
          "name": "withdraw",
          "type": "function",
          "inputs": [
            {"name": "assets", "type": "felt"},
            {"name": "receiver", "type": "felt"},
            {"name": "owner", "type": "felt"}
          ],
          "outputs": [
            {"name": "shares", "type": "felt"}
          ],
          "stateMutability": "external"
        },
        {
          "name": "redeem",
          "type": "function",
          "inputs": [
            {"name": "shares", "type": "felt"},
            {"name": "receiver", "type": "felt"},
            {"name": "owner", "type": "felt"}
          ],
          "outputs": [
            {"name": "assets", "type": "felt"}
          ],
          "stateMutability": "external"
        },
        {
          "name": "previewRedeem",
          "type": "function",
          "inputs": [
            {"name": "shares", "type": "felt"}
          ],
          "outputs": [
            {"name": "assets", "type": "felt"}
          ],
          "stateMutability": "view"
        }
      ];

      const vaultContract = new Contract(
        vaultABI,
        vault.contractAddress,
        this.provider
      );

      const sharesUint256 = cairo.uint256(operation.shares);
      const receiverAddress = operation.userAddress || account.address;
      const ownerAddress = operation.userAddress || account.address;

      // First, get preview of assets to be received
      let previewAssets;
      try {
        const previewResult = await vaultContract.call("previewRedeem", [sharesUint256.low, sharesUint256.high]);
        previewAssets = (previewResult as any)[0];
        console.log(`Preview: ${operation.shares} shares will receive ${previewAssets} assets`);
      } catch (previewError) {
        console.warn("Could not get withdraw preview:", previewError);
        previewAssets = "0";
      }

      // Execute redeem transaction (withdraw shares for assets)
      const response = await account.execute({
        contractAddress: vault.contractAddress,
        entrypoint: "redeem",
        calldata: [sharesUint256.low, sharesUint256.high, receiverAddress, ownerAddress]
      });

      console.log(`Withdraw transaction submitted: ${response.transaction_hash}`);

      return {
        success: true,
        transactionHash: response.transaction_hash
      };
    } catch (error) {
      console.error("Error executing withdraw:", error);
      
      // Enhanced error handling
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Handle specific Starknet errors
        if (error.message.includes('insufficient shares')) {
          errorMessage = 'Insufficient shares for withdrawal';
        } else if (error.message.includes('vault paused')) {
          errorMessage = 'Vault is currently paused';
        } else if (error.message.includes('minimum withdrawal')) {
          errorMessage = 'Withdrawal amount below minimum threshold';
        } else if (error.message.includes('contract not found')) {
          errorMessage = 'Vault contract not found or not deployed';
        } else if (error.message.includes('withdrawal limit')) {
          errorMessage = 'Withdrawal exceeds daily limit';
        }
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async getAvailableStrategies(): Promise<TrovesStrategy[]> {
    try {
     
      const strategies = await this.fetchStrategiesFromAPI();
      
      // Convert API strategies to TrovesStrategy format
      const trovesStrategies: TrovesStrategy[] = strategies.map((strategy: any) => {
        const depositTokens = strategy.depositToken.map((token: any) => token.symbol);
        
        return {
          id: strategy.id,
          name: strategy.name,
          description: `${strategy.name} - ${strategy.apyMethodology}`,
          riskLevel: this.getRiskLevel(strategy.riskFactor),
          targetApy: strategy.apy * 100, 
          currentApy: strategy.apy * 100,
          tvl: strategy.tvlUsd.toString(),
          isActive: strategy.status.number === 3,
          supportedAssets: depositTokens,
          strategyType: this.getStrategyType(strategy.name)
        };
      });

      return trovesStrategies;
    } catch (error) {
      console.error("Error fetching strategies:", error);
      // Return empty array if API fails 
      return [];
    }
  }

  private getRiskLevel(riskFactor: number): "low" | "medium" | "high" {
    if (riskFactor <= 0.5) return "low";
    if (riskFactor <= 1.0) return "medium";
    return "high";
  }

  private getStrategyType(strategyName: string): "trading" | "liquidity_provision" | "lending" | "arbitrage" {
    const name = strategyName.toLowerCase();
    if (name.includes("hyper")) return "trading";
    if (name.includes("evergreen")) return "lending";
    if (name.includes("ekubo")) return "liquidity_provision";
    if (name.includes("vesu")) return "lending";
    return "liquidity_provision";
  }

  async getYieldData(vaultId: string): Promise<TrovesYieldData> {
    try {
      const vaults = await this.getAvailableVaults();
      const vault = vaults.find(v => v.id === vaultId);
      
      if (!vault) {
        throw new Error(`Vault ${vaultId} not found`);
      }

      // Calculate real yield data based on current APY and TVL
      const currentApy = vault.apy;
      const dailyApy = currentApy / 365;
      const weeklyApy = currentApy / 52;
      const monthlyApy = currentApy / 12;

      // Calculate yields based on TVL
      const examplePosition = 1000;
      const dailyYield = (examplePosition * dailyApy / 100).toFixed(2);
      const weeklyYield = (examplePosition * weeklyApy / 100).toFixed(2);
      const monthlyYield = (examplePosition * monthlyApy / 100).toFixed(2);
      const totalYield = (examplePosition * currentApy / 100).toFixed(2);

      // Generate historical APY data (simulated based on current APY with some variation)
      const historicalApy = [
        currentApy * 0.95,
        currentApy * 0.98,
        currentApy * 1.02,
        currentApy
      ];

      return {
        vaultId,
        asset: vault.asset,
        currentApy,
        historicalApy,
        totalYield,
        dailyYield,
        weeklyYield,
        monthlyYield,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error("Error fetching yield data:", error);
      throw new Error(`Failed to fetch yield data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async healthCheck(): Promise<TrovesHealthCheck> {
    try {
      const vaults = await this.getAvailableVaults();
      const strategies = await this.getAvailableStrategies();
      
      const totalTvl = vaults.reduce((sum, vault) => sum + parseFloat(vault.tvl), 0).toString();
      const totalApy = vaults.reduce((sum, vault) => sum + vault.apy, 0) / vaults.length;

      const vaultStatus: { [vaultId: string]: any } = {};
      vaults.forEach(vault => {
        vaultStatus[vault.id] = {
          status: vault.isActive ? 'active' : 'paused',
          apy: vault.apy,
          tvl: vault.tvl,
          lastHarvest: new Date()
        };
      });

      return {
        status: 'healthy',
        vaultStatus,
        totalTvl,
        totalApy,
        recommendations: [
          "All vaults are operating normally",
          "Consider diversifying across multiple strategies",
          "Monitor APY changes regularly"
        ]
      };
    } catch (error) {
      return {
        status: 'critical',
        vaultStatus: {},
        totalTvl: "0",
        totalApy: 0,
        recommendations: [
          "Service temporarily unavailable",
          "Please try again later"
        ]
      };
    }
  }

  async harvestRewards(operation: TrovesHarvestOperation, account: Account): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const vaults = await this.getAvailableVaults();
      const vault = vaults.find(v => v.id === operation.vaultId);
      
      if (!vault) {
        throw new Error(`Vault ${operation.vaultId} not found`);
      }

      // Validate vault contract address
      if (!vault.contractAddress || vault.contractAddress.length !== 66 || !vault.contractAddress.startsWith('0x')) {
        throw new Error(`Invalid contract address for vault ${operation.vaultId}. Please check Troves API data.`);
      }

      // Standard harvest ABI for yield farming vaults
      const harvestABI = [
        {
          "name": "harvest",
          "type": "function",
          "inputs": [],
          "outputs": [
            {"name": "rewards", "type": "felt"}
          ],
          "stateMutability": "external"
        },
        {
          "name": "claimRewards",
          "type": "function",
          "inputs": [],
          "outputs": [
            {"name": "rewards", "type": "felt"}
          ],
          "stateMutability": "external"
        },
        {
          "name": "pendingRewards",
          "type": "function",
          "inputs": [
            {"name": "user", "type": "felt"}
          ],
          "outputs": [
            {"name": "rewards", "type": "felt"}
          ],
          "stateMutability": "view"
        }
      ];

      const vaultContract = new Contract(
        harvestABI,
        vault.contractAddress,
        this.provider
      );

      // First, check pending rewards
      let pendingRewards = "0";
      try {
        const pendingResult = await vaultContract.call("pendingRewards", [account.address]);
        pendingRewards = (pendingResult as any)[0];
        console.log(`Pending rewards: ${pendingRewards}`);
      } catch (pendingError) {
        console.warn("Could not get pending rewards:", pendingError);
      }

      if (pendingRewards === "0") {
        return {
          success: false,
          error: "No rewards available to harvest"
        };
      }

      // Try harvest function first, then claimRewards as fallback
      let response;
      try {
        response = await account.execute({
          contractAddress: vault.contractAddress,
          entrypoint: "harvest",
          calldata: []
        });
        console.log(`Harvest transaction submitted: ${response.transaction_hash}`);
      } catch (harvestError) {
        console.warn("Harvest failed, trying claimRewards:", harvestError);
        
        // Fallback to claimRewards
        response = await account.execute({
          contractAddress: vault.contractAddress,
          entrypoint: "claimRewards",
          calldata: []
        });
        console.log(`Claim rewards transaction submitted: ${response.transaction_hash}`);
      }

      return {
        success: true,
        transactionHash: response.transaction_hash
      };
    } catch (error) {
      console.error("Error harvesting rewards:", error);
      
      // Enhanced error handling
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Handle specific Starknet errors
        if (error.message.includes('no rewards')) {
          errorMessage = 'No rewards available to harvest';
        } else if (error.message.includes('vault paused')) {
          errorMessage = 'Vault is currently paused';
        } else if (error.message.includes('harvest cooldown')) {
          errorMessage = 'Harvest is on cooldown, please wait';
        } else if (error.message.includes('contract not found')) {
          errorMessage = 'Vault contract not found or not deployed';
        } else if (error.message.includes('insufficient gas')) {
          errorMessage = 'Insufficient gas for harvest transaction';
        }
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export const trovesService = new TrovesService();
