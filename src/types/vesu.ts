export interface VesuPool {
  id: string;
  asset: string;
  symbol: string;
  decimals: number;
  contractAddress: string;
  apy: number;
  totalLiquidity: string;
  totalBorrowed: string;
  utilizationRate: number;
  isActive: boolean;
  vTokenAddress?: string;
  vTokenSymbol?: string;
  borrowApr?: number;
  usdPrice?: number;
  poolName?: string;
}

export interface VesuPosition {
  userAddress: string;
  poolId: string;
  asset: string;
  suppliedAmount: string;
  borrowedAmount: string;
  healthFactor: number;
  liquidationThreshold: number;
  collateralValue: string;
  debtValue: string;
}

export interface VesuLendingOperation {
  poolId: string;
  amount: string;
  operation: 'supply' | 'withdraw' | 'borrow' | 'repay';
  userAddress: string;
}

export interface VesuQuote {
  poolId: string;
  asset: string;
  amount: string;
  apy: number;
  estimatedYield: string;
  timeHorizon: number;
}

export interface VesuHealthCheck {
  status: 'healthy' | 'warning' | 'critical';
  healthFactor: number;
  liquidationPrice?: string;
  recommendations: string[];
}

export interface VesuConfig {
  rpcUrl: string;
  network: 'mainnet' | 'sepolia';
  contractAddresses: {
    poolFactory: string;
    oracle: string;
    multiply: string;
    liquidate: string;
    defiSpringDistributor: string;
    btcFiDistributor: string;
    primePool: string;
    re7UsdcCore: string;
    re7UsdcPrime: string;
    re7UsdcFrontier: string;
    re7xBtc: string;
    re7UsdcStableCore: string;
  };
  supportedAssets: string[];
}
