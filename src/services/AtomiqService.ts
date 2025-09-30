import { SwapperFactory, BitcoinNetwork } from "@atomiqlabs/sdk";
import { StarknetInitializer, StarknetInitializerType } from "@atomiqlabs/chain-starknet";
import { SqliteStorageManager, SqliteUnifiedStorage } from "@atomiqlabs/storage-sqlite";
import config from "../config/config";

export class AtomiqService {
  private static instance: AtomiqService;
  private swapper: any;
  private factory: any;
  private tokens: any;
  private initialized = false;

  private constructor() {}

  static getInstance(): AtomiqService {
    if (!AtomiqService.instance) {
      AtomiqService.instance = new AtomiqService();
    }
    return AtomiqService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Create swapper factory with Starknet support only
      this.factory = new SwapperFactory<[StarknetInitializerType]>([StarknetInitializer] as const);
      this.tokens = this.factory.Tokens;

      // Initialize swapper following Atomiq documentation for NodeJS
      this.swapper = this.factory.newSwapper({
        chains: {
          STARKNET: {
            rpcUrl: config.node_url 
          }
        },
        bitcoinNetwork: BitcoinNetwork.TESTNET, 
        // SQLite storage for Node.js backend 
        swapStorage: (chainId: string) => new SqliteUnifiedStorage(`CHAIN_${chainId}.sqlite3`),
        chainStorageCtor: (name: string) => new SqliteStorageManager(`STORE_${name}.sqlite3`),
      });

      await this.swapper.init();
      this.initialized = true;
      
      console.log("Atomiq service initialized successfully for BTC ↔ STRK swaps (Starknet only)");
    } catch (error) {
      console.error("Failed to initialize Atomiq service:", error);
      throw error;
    }
  }

  getSwapper() {
    if (!this.initialized) {
      throw new Error("Atomiq service not initialized. Call initialize() first.");
    }
    return this.swapper;
  }

  getTokens() {
    if (!this.initialized) {
      throw new Error("Atomiq service not initialized. Call initialize() first.");
    }
    return this.tokens;
  }

  getFactory() {
    if (!this.initialized) {
      throw new Error("Atomiq service not initialized. Call initialize() first.");
    }
    return this.factory;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // Helper method to get supported tokens
  getSupportedTokens() {
    return {
      BTC: this.tokens.BITCOIN.BTC,
      STRK: this.tokens.STARKNET.STRK,
    };
  }

  // Helper method to get swap limits
  getSwapLimits(srcToken: any, dstToken: any) {
    return this.swapper.getSwapLimits(srcToken, dstToken);
  }
}

export const atomiqService = AtomiqService.getInstance();
