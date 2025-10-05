// Troves.fi Types
export interface TrovesConfig {
  rpcUrl: string;
  network: 'mainnet' | 'sepolia';
  contractAddresses: {
    // Troves core contracts from https://docs.troves.fi/p/developers/contracts
    accessControl: string;
    timelock: string;
    // Individual vault contracts are now fetched dynamically from Troves API
  };
  supportedAssets: string[];
  apiBaseUrl?: string;
}

export interface TrovesVault {
  id: string;
  name: string;
  symbol: string;
  asset: string;
  contractAddress: string;
  totalAssets: string;
  totalShares: string;
  apy: number;
  tvl: string;
  strategy: string;
  isActive: boolean;
  minDeposit: string;
  maxDeposit?: string;
  fees: {
    managementFee: number;
    performanceFee: number;
  };
  lastHarvest?: Date;
  createdAt: Date;
}

export interface TrovesPosition {
  userAddress: string;
  vaultId: string;
  vaultName: string;
  asset: string;
  shares: string;
  assets: string;
  depositedAt: Date;
  lastUpdated: Date;
  estimatedValue: string;
  apy: number;
  totalEarned: string;
}

export interface TrovesDepositOperation {
  vaultId: string;
  amount: string;
  asset: string;
  userAddress: string;
  minShares?: string;
}

export interface TrovesWithdrawOperation {
  vaultId: string;
  shares: string;
  userAddress: string;
  minAssets?: string;
}

export interface TrovesQuote {
  vaultId: string;
  asset: string;
  amount: string;
  estimatedShares: string;
  apy: number;
  estimatedYield: string;
  timeHorizon: number; // in days
  fees: {
    managementFee: number;
    performanceFee: number;
  };
}

export interface TrovesStrategy {
  id: string;
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  targetApy: number;
  currentApy: number;
  tvl: string;
  isActive: boolean;
  supportedAssets: string[];
  strategyType: 'liquidity_provision' | 'lending' | 'trading' | 'arbitrage';
}

export interface TrovesHealthCheck {
  status: 'healthy' | 'warning' | 'critical';
  vaultStatus: {
    [vaultId: string]: {
      status: 'active' | 'paused' | 'emergency';
      apy: number;
      tvl: string;
      lastHarvest: Date;
    };
  };
  totalTvl: string;
  totalApy: number;
  recommendations: string[];
}

export interface TrovesYieldData {
  vaultId: string;
  asset: string;
  currentApy: number;
  historicalApy: number[];
  totalYield: string;
  dailyYield: string;
  weeklyYield: string;
  monthlyYield: string;
  lastUpdated: Date;
}

export interface TrovesHarvestOperation {
  vaultId: string;
  userAddress: string;
  estimatedRewards: string;
}
