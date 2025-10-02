import { SwapperFactory, BitcoinNetwork } from "@atomiqlabs/sdk";
import { StarknetInitializer, StarknetInitializerType } from "@atomiqlabs/chain-starknet";
import { SqliteStorageManager, SqliteUnifiedStorage } from "@atomiqlabs/storage-sqlite";
import { RpcProvider } from "starknet";
import { injectable } from "tsyringe";
import config from "../config/config";

@injectable()
export class AtomiqService {
  private factory!: SwapperFactory<[StarknetInitializerType]>;
  private swapper: any; // Will be properly typed after initialization
  private tokens: any; // Will be properly typed after initialization

  constructor() {}

  async initialize(): Promise<void> {
    try {
      // Create swapper factory with Starknet support only, following documentation exactly
      this.factory = new SwapperFactory<[StarknetInitializerType]>([StarknetInitializer] as const);
      this.tokens = this.factory.Tokens;

      // Create proper Starknet Provider for Node.js environment
      const rpcUrl = "https://starknet-sepolia.public.blastapi.io/rpc/v0_7";
      const starknetProvider = new RpcProvider({
        nodeUrl: rpcUrl
      });
      
      const swapperConfig = {
        chains: {
          STARKNET: {
            rpcUrl: starknetProvider
          }
        },
        bitcoinNetwork: BitcoinNetwork.TESTNET,
        swapStorage: (chainId: string) => new SqliteUnifiedStorage(`CHAIN_${chainId}.sqlite3`),
        chainStorageCtor: (name: string) => new SqliteStorageManager(`STORE_${name}.sqlite3`),
        pricingFeeDifferencePPM: BigInt(20000),
        getRequestTimeout: 30000,
        postRequestTimeout: 30000,
      } as any;
      
      this.swapper = this.factory.newSwapper(swapperConfig);

      // Initialize the swapper as per documentation
      await this.swapper.init();
      console.log("Atomiq swapper initialized successfully");
      
    } catch (error) {
      console.error("Failed to initialize AtomiqService:", error);
      throw new Error(`AtomiqService initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getSwapper(): any {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return this.swapper;
  }

  getTokens(): any {
    if (!this.tokens) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return this.tokens;
  }

  getFactory(): any {
    if (!this.factory) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return this.factory;
  }

  isInitialized(): boolean {
    return !!(this.swapper && this.tokens && this.factory);
  }


  getSwapLimits(srcToken: any, dstToken: any) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return this.swapper.getSwapLimits(srcToken, dstToken);
  }

  async getSwapById(id: string) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.getSwapById(id);
  }

  async getRefundableSwaps(chain: string, address: string) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.getRefundableSwaps(chain, address);
  }

  async getClaimableSwaps(chain: string, address: string) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.getClaimableSwaps(chain, address);
  }

  async getSpendableBalance(signer: any, token: any) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.Utils.getSpendableBalance(signer, token);
  }

  async parseAddress(address: string) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.Utils.parseAddress(address);
  }

  // Create a swap following the documentation pattern
  async createSwap(
    srcToken: any,
    dstToken: any,
    amount: bigint,
    exactIn: boolean,
    srcAddress: string,
    dstAddress: string
  ) {
    if (!this.swapper) {
      throw new Error("AtomiqService not initialized. Call initialize() first.");
    }
    return await this.swapper.swap(
      srcToken,
      dstToken,
      amount,
      exactIn,
      srcAddress,
      dstAddress
    );
  }

  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      if (!this.swapper || !this.tokens || !this.factory) {
        return {
          status: "not_initialized",
          details: {
            swapper: !!this.swapper,
            tokens: !!this.tokens,
            factory: !!this.factory
          }
        };
      }

      let limits;
      try {
        limits = this.getSwapLimits(this.tokens.BITCOIN.BTC, this.tokens.STARKNET.STRK);
      } catch (limitsError) {
        console.warn("Could not get swap limits:", limitsError);
        limits = { input: { min: null, max: null }, output: { min: null, max: null } };
      }
      
      return {
        status: "healthy",
        details: {
          swapper: !!this.swapper,
          tokens: !!this.tokens,
          factory: !!this.factory,
          limits: {
            input: {
              min: limits.input.min?.toString(),
              max: limits.input.max?.toString()
            },
            output: {
              min: limits.output.min?.toString(),
              max: limits.output.max?.toString()
            }
          }
        }
      };
    } catch (error) {
      return {
        status: "error",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          swapper: !!this.swapper,
          tokens: !!this.tokens,
          factory: !!this.factory
        }
      };
    }
  }
}

export const atomiqService = new AtomiqService();