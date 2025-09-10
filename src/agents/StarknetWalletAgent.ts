import { BaseAgent, AgentOutcome } from "./BaseAgent.js";
import { Intent } from "../types/intents.js";
import { RpcProvider, ec } from "starknet";
import { getEnv } from "../config/env.js";

export class StarknetWalletAgent extends BaseAgent {
  readonly name = "StarknetWalletAgent";
  private provider: RpcProvider;

  constructor() {
    super();
    const { STARKNET_RPC_URL } = getEnv();
    this.provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  }

  canHandle(intent: Intent): boolean {
    return (
      ["create_account", "balance"].includes(intent.action) &&
      (intent.entities.chain === undefined ||
        intent.entities.chain === "starknet")
    );
  }

  scoreIntent(intent: Intent): number {
    return this.canHandle(intent) ? 0.9 : 0;
  }

  async handle(intent: Intent): Promise<AgentOutcome> {
    if (intent.action === "create_account") {
      return this.createStarknetAccount();
    }
    if (intent.action === "balance") {
      return this.checkBalance(
        intent.entities.fromAsset || "STRK",
        intent.entities.recipient
      );
    }
    return { success: false, message: "Unsupported action" };
  }

  private async createStarknetAccount(): Promise<AgentOutcome> {
    // Generate Starknet keypair (Cairo curve)
    const privateKey = ec.starkCurve.utils.randomPrivateKey();
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    // Note: To deploy an account, you'd need a specific account class. For experimentation we just return keys.
    return {
      success: true,
      message: "Generated Starknet keypair",
      data: { privateKey, publicKey },
    };
  }

  private async checkBalance(
    assetSymbol: string,
    address?: string | undefined
  ): Promise<AgentOutcome> {
    const { STARKNET_DEFAULT_ACCOUNT, STRK_TOKEN_ADDRESS } = getEnv();
    const targetAddress = address || STARKNET_DEFAULT_ACCOUNT;
    if (!targetAddress) {
      return {
        success: false,
        message:
          "No Starknet address provided and STARKNET_DEFAULT_ACCOUNT not set.",
      };
    }

    if (assetSymbol.toUpperCase() === "STRK") {
      try {
        const balance = await this.readErc20Balance(
          STRK_TOKEN_ADDRESS,
          targetAddress
        );
        const decimals = await this.readErc20Decimals(STRK_TOKEN_ADDRESS);
        return {
          success: true,
          message: `Balance for ${targetAddress}`,
          data: { asset: "STRK", balance: balance.toString(), decimals },
        };
      } catch (e: any) {
        return { success: false, message: `Balance error: ${e?.message || e}` };
      }
    }

    return { success: false, message: `Unsupported asset: ${assetSymbol}` };
  }

  private async readErc20Balance(
    tokenAddress: string,
    owner: string
  ): Promise<bigint> {
    // Try Cairo v1 naming first: balance_of (Uint256)
    try {
      const res1: any = await this.provider.callContract({
        contractAddress: tokenAddress,
        entrypoint: "balance_of",
        calldata: [owner],
      });
      const arr1: string[] = Array.isArray(res1) ? res1 : res1?.result;
      if (arr1?.length >= 2) {
        const low = BigInt(arr1[0]);
        const high = BigInt(arr1[1]);
        return (high << 128n) + low;
      }
    } catch (_) {}

    // Fallback to older: balanceOf (Uint256)
    const res2: any = await this.provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: "balanceOf",
      calldata: [owner],
    });
    const arr2: string[] = Array.isArray(res2) ? res2 : res2?.result;
    const low = BigInt(arr2?.[0] || 0);
    const high = BigInt(arr2?.[1] || 0);
    return (high << 128n) + low;
  }

  private async readErc20Decimals(tokenAddress: string): Promise<number> {
    try {
      const res: any = await this.provider.callContract({
        contractAddress: tokenAddress,
        entrypoint: "decimals",
        calldata: [],
      });
      const arr: string[] = Array.isArray(res) ? res : res?.result;
      if (arr?.[0]) return Number(arr[0]);
    } catch (_) {}
    // Common default
    return 18;
  }
}
