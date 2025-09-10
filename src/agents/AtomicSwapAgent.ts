import { BaseAgent, AgentOutcome } from "./BaseAgent.js";
import { Intent } from "../types/intents.js";
import { SwapperFactory, BitcoinNetwork } from "@atomiqlabs/sdk";
import {
  SqliteStorageManager,
  SqliteUnifiedStorage,
} from "@atomiqlabs/storage-sqlite";
import {
  RpcProviderWithRetries,
  StarknetInitializer,
} from "@atomiqlabs/chain-starknet";
import { getEnv } from "../config/env.js";

export class AtomicSwapAgent extends BaseAgent {
  readonly name = "AtomicSwapAgent";
  private initialized = false;
  // Relaxe types for experimentals setup
  private Factory: any = new SwapperFactory([StarknetInitializer] as any);
  private swapper: any = this.Factory.newSwapper({
    chains: {
      STARKNET: {
        rpcUrl: getEnv().STARKNET_RPC_URL,
      },
    },
    bitcoinNetwork: getEnv().BITCOIN_NETWORK as unknown as BitcoinNetwork,
    swapStorage: (chainId: string) =>
      new SqliteUnifiedStorage(`CHAIN_${chainId}.sqlite3`),
    chainStorageCtor: (name: string) =>
      new SqliteStorageManager(`STORE_${name}.sqlite3`),
  });

  canHandle(intent: Intent): boolean {
    return intent.action === "swap";
  }

  scoreIntent(intent: Intent): number {
    return this.canHandle(intent) ? 0.8 : 0;
  }

  async handle(intent: Intent): Promise<AgentOutcome> {
    if (!this.initialized) {
      await this.swapper.init();
      this.initialized = true;
    }

    const from = (intent.entities.fromAsset || "BTC").toUpperCase();
    const to = (intent.entities.toAsset || "STRK").toUpperCase();
    const amount = intent.entities.amount || 10000; // sats default for demo

    const Tokens: any = this.Factory.Tokens;
    const src = Tokens?.BITCOIN?.BTC;
    const dst = Tokens?.STARKNET?.STRK;

    try {
      const swap = await this.swapper.swap(
        src,
        dst,
        BigInt(amount),
        true,
        undefined,
        getEnv().STARKNET_DEFAULT_ACCOUNT || ""
      );
      // Optional: override price if fixed pricing desired for experiments
      if (
        getEnv().USE_FIXED_PRICE &&
        getEnv().FIXED_BTC_USD &&
        getEnv().FIXED_STRK_USD
      ) {
        const price =
          (getEnv().FIXED_BTC_USD as number) /
          (getEnv().FIXED_STRK_USD as number);
        if (swap?.getPriceInfo) {
          // No direct setter; we just annotate the quote data for visibility
        }
      }
      const quote = {
        input: swap.getInput().toString(),
        output: swap.getOutput().toString(),
        fee: swap.getFee().amountInSrcToken.toString(),
        quoteExpiry: swap.getQuoteExpiry(),
      };
      return { success: true, message: "Swap quote created", data: quote };
    } catch (e: any) {
      return {
        success: false,
        message: `Swap quote failed: ${e?.message || e}`,
      };
    }
  }
}
