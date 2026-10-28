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

  private readonly DEFAULTS: Record<
    StellarNetworkType,
    Partial<NetworkConfig>
  > = {
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
    const networkType =
      (process.env.STELLAR_NETWORK?.toLowerCase() as StellarNetworkType) ||
      "testnet";
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

const NETWORK_HINTS: Array<{ type: StellarNetworkType; pattern: RegExp }> = [
  { type: "public", pattern: /\b(mainnet|pubnet|public\s+network)\b/i },
  { type: "testnet", pattern: /\btestnet\b/i },
  { type: "futurenet", pattern: /\bfuturenet\b/i },
];

const VAGUE_NETWORK_PHRASES = [
  /\b(any|either|whichever|some)\s+network\b/i,
  /\bwhich\s+network\b/i,
  /\bon\s+(?:a|the)\s+network\b/i,
];

export interface NetworkClarification {
  needsClarification: boolean;
  question?: string;
  detectedNetworks: StellarNetworkType[];
}

/**
 * Decide whether a request names more than one network, or talks about a
 * network without naming one. A request that names no network is not
 * ambiguous: planning keeps the configured network.
 */
export function assessNetworkClarification(
  request: string
): NetworkClarification {
  const text = typeof request === "string" ? request : "";
  const detectedNetworks = NETWORK_HINTS.filter((hint) =>
    hint.pattern.test(text)
  ).map((hint) => hint.type);
  const unique = [...new Set(detectedNetworks)];
  const namesNoSingleNetwork = unique.length !== 1;
  const vague = VAGUE_NETWORK_PHRASES.some((pattern) => pattern.test(text));

  if (unique.length > 1 || (vague && namesNoSingleNetwork)) {
    const choices = unique.length > 0 ? unique.join(", ") : "public, testnet, or futurenet";
    return {
      needsClarification: true,
      detectedNetworks: unique,
      question: `Which network should I use before planning: ${choices}? Reply with one of public, testnet, or futurenet.`,
    };
  }

  return { needsClarification: false, detectedNetworks: unique };
}

export const networkConfig = NetworkConfigService.getInstance().getConfig();
