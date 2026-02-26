import { Networks } from "@stellar/stellar-sdk";

export type StellarNetworkType = "public" | "testnet" | "futurenet";

export interface NetworkConfig {
  type: StellarNetworkType;
  horizonUrl: string;
  rpcUrl: string;
  passphrase: string;
}

export class NetworkConfigService {
  private static instance: NetworkConfigService;
  private config: NetworkConfig;

  private readonly DEFAULTS: Record<StellarNetworkType, Partial<NetworkConfig>> = {
    public: {
      horizonUrl: "https://horizon.stellar.org",
      rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
      passphrase: Networks.PUBLIC,
    },
    testnet: {
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      passphrase: Networks.TESTNET,
    },
    futurenet: {
      horizonUrl: "https://horizon-futurenet.stellar.org",
      rpcUrl: "https://rpc-futurenet.stellar.org",
      passphrase: Networks.FUTURENET,
    },
  };

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): NetworkConfigService {
    if (!this.instance) {
      this.instance = new NetworkConfigService();
    }
    return this.instance;
  }

  private loadConfig(): NetworkConfig {
    // 1. Determine which network we are targeting
    const networkType = (process.env.STELLAR_NETWORK?.toLowerCase() as StellarNetworkType) || "testnet";
    const defaults = this.DEFAULTS[networkType] || this.DEFAULTS.testnet;

    // 2. Build final config with environment overrides
    return {
      type: networkType,
      horizonUrl: process.env.HORIZON_URL || defaults.horizonUrl!,
      rpcUrl: process.env.SOROBAN_RPC_URL || defaults.rpcUrl!,
      passphrase: process.env.NETWORK_PASSPHRASE || defaults.passphrase!,
    };
  }

  public getConfig(): NetworkConfig {
    return { ...this.config };
  }

  public isMainnet(): boolean {
    return this.config.type === "public";
  }
}

export const networkConfig = NetworkConfigService.getInstance().getConfig();