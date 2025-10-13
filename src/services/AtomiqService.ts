import { SwapperFactory, BitcoinNetwork } from '@atomiqlabs/sdk';
import {
  StarknetInitializer,
  StarknetInitializerType,
} from '@atomiqlabs/chain-starknet';
import { RpcProvider } from 'starknet';
import { injectable } from 'tsyringe';
import config from '../config/config';
import * as fs from 'fs';
import * as path from 'path';

// Import SQLite storage
import {
  SqliteStorageManager,
  SqliteUnifiedStorage,
} from '@atomiqlabs/storage-sqlite';

// Use the actual SDK types - let the SDK handle the complex type system
import type { Swapper } from '@atomiqlabs/sdk';

// Use any types to avoid complex SDK type mismatches
type AtomiqSwapper = Swapper<any>;
type AtomiqSwap = any;

interface AtomiqTokens {
  BITCOIN: {
    BTC: any;
    BTCLN: any;
  };
  STARKNET: {
    STRK: any;
  };
}

@injectable()
export class AtomiqService {
  private factory!: SwapperFactory<[StarknetInitializerType]>;
  private swapper!: AtomiqSwapper;
  public tokens!: AtomiqTokens;

  constructor() {}

  async initialize(): Promise<void> {
    try {
      // Ensure data directory exists for SQLite storage
      const dataDir = path.join(process.cwd(), 'data', 'atomiq');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created Atomiq data directory: ${dataDir}`);
      }

      // Create swapper factory with Starknet support only, following documentation exactly
      this.factory = new SwapperFactory<[StarknetInitializerType]>([
        StarknetInitializer,
      ] as const);
      this.tokens = this.factory.Tokens;

      // Create proper Starknet Provider for Node.js environment
      // Try multiple RPC endpoints for better reliability
      const rpcUrls = [
        process.env.NODE_URL ||
          'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
        'https://starknet-sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
        'https://rpc.sepolia.starknet.io',
      ];

      let starknetProvider;
      for (const rpcUrl of rpcUrls) {
        try {
          console.log(`Trying RPC endpoint: ${rpcUrl}`);
          starknetProvider = new RpcProvider({ nodeUrl: rpcUrl });
          // Test the connection
          await starknetProvider.getChainId();
          console.log(`Successfully connected to: ${rpcUrl}`);
          break;
        } catch (error) {
          console.warn(
            `Failed to connect to ${rpcUrl}:`,
            error instanceof Error ? error.message : String(error)
          );
          if (rpcUrl === rpcUrls[rpcUrls.length - 1]) {
            throw new Error('All RPC endpoints failed');
          }
        }
      }

      const swapperConfig = {
        chains: {
          STARKNET: {
            rpcUrl: starknetProvider!,
          },
        },
        bitcoinNetwork: BitcoinNetwork.TESTNET,
        // Following the exact documentation pattern for NodeJS
        swapStorage: (chainId: string) =>
          new SqliteUnifiedStorage(`CHAIN_${chainId}.sqlite3`),
        chainStorageCtor: (name: string) =>
          new SqliteStorageManager(`STORE_${name}.sqlite3`) as any,
      };

      this.swapper = this.factory.newSwapper(swapperConfig);
      await this.swapper.init();

      console.log(
        'AtomiqService initialized successfully with Starknet support'
      );
    } catch (error) {
      console.error('Failed to initialize AtomiqService:', error);
      throw new Error(
        `AtomiqService initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  isInitialized(): boolean {
    return !!(this.swapper && this.tokens && this.factory);
  }

  getSwapLimits(srcToken: any, dstToken: any) {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return this.swapper.getSwapLimits(srcToken, dstToken);
  }

  async getSwapById(id: string): Promise<any> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return await this.swapper.getSwapById(id);
  }

  // Create a swap following the SDK documentation pattern
  async createSwap(
    srcToken: any,
    dstToken: any,
    amount: bigint,
    exactIn: boolean,
    srcAddress: string,
    dstAddress: string,
    options?: any
  ): Promise<any> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }

    try {
      const swap = await this.swapper.swap(
        srcToken,
        dstToken,
        amount,
        exactIn,
        srcAddress,
        dstAddress,
        options
      );
      return swap;
    } catch (error) {
      throw new Error(
        `Failed to create swap: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getRefundableSwaps(chain: string, address: string): Promise<any[]> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return await this.swapper.getRefundableSwaps(chain, address);
  }

  async getSpendableBalance(signer: any, token: any): Promise<any> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return await this.swapper.Utils.getSpendableBalance(signer, token);
  }

  async parseAddress(address: string): Promise<any> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return await this.swapper.Utils.parseAddress(address);
  }

  // Get Bitcoin spendable balance
  async getBitcoinSpendableBalance(
    bitcoinAddress: string,
    destinationChain: string
  ): Promise<any> {
    if (!this.swapper) {
      throw new Error(
        'AtomiqService not initialized. Call initialize() first.'
      );
    }
    return await this.swapper.Utils.getBitcoinSpendableBalance(
      bitcoinAddress,
      destinationChain
    );
  }
}

export const atomiqService = new AtomiqService();
