import { Account, RpcProvider, Contract } from "starknet";
import accountsData from "../../Auth/accounts.json";
import tokenAbi from "../../abis/token.json";
import {
  STRKTokenAddress,
  ETHTokenAddress,
  DAITokenAddress,
} from "../../constants/tokenaddresses";
import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

interface AccountData {
  userId: string;
  privateKey: string;
  publicKey: string;
  precalculatedAddress: string;
  deployed: boolean;
  contract_address?: string;
}

type supportedTokens = "STRK" | "ETH" | "DAI";

interface BalancePayload {
  token: supportedTokens;
}

interface TransferPayload {
  to: string;
  amount: number;
}

interface AddressPayload {
  // No parameters needed for getting address
}

export class WalletTool extends BaseTool {
  metadata: ToolMetadata = {
    name: "wallet_tool",
    description:
      "Wallet operations including balance checking, transfers, and address retrieval",
    parameters: {
      operation: {
        type: "string",
        description: "The wallet operation to perform",
        required: true,
        enum: ["get_balance", "transfer", "get_address"],
      },
      token: {
        type: "string",
        description: "Token symbol for balance operations",
        required: false,
        enum: ["STRK", "ETH", "DAI"],
      },
      to: {
        type: "string",
        description: "Recipient address for transfers",
        required: false,
      },
      amount: {
        type: "number",
        description: "Amount to transfer",
        required: false,
        min: 0,
      },
    },
    examples: [
      "Check my STRK balance",
      "Transfer 100 STRK to 0x123...",
      "Get my wallet address",
    ],
    category: "wallet",
    version: "1.0.0",
  };

  private accounts: AccountData[];
  private provider: RpcProvider;

  constructor() {
    super();
    this.accounts = accountsData as AccountData[];
    this.provider = new RpcProvider({
      nodeUrl: "https://docs-demo.strk-sepolia.quiknode.pro/rpc/v0_7",
    });
  }

  private getAccount(userId: string): AccountData {
    const account = this.accounts.find((a) => a.userId === userId);
    if (!account) throw new Error(`Account not found: ${userId}`);
    return account;
  }

  private getStarkAccount(userId: string): Account {
    const accountData = this.getAccount(userId);
    return new Account(
      this.provider,
      accountData.precalculatedAddress,
      accountData.privateKey
    );
  }

  async execute(
    payload: Record<string, unknown>,
    userId: string
  ): Promise<ToolResult> {
    const operation = payload.operation as string;

    switch (operation) {
      case "get_balance":
        return this.getBalance(payload as unknown as BalancePayload, userId);
      case "transfer":
        return this.transfer(payload as unknown as TransferPayload, userId);
      case "get_address":
        return this.getWalletAddress(userId);
      default:
        return this.createErrorResult(
          "wallet_operation",
          `Unknown operation: ${operation}`
        );
    }
  }

  private async getBalance(
    payload: BalancePayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      console.log(payload);
      const accountData = this.getAccount(userId);
      const acct = await this.getStarkAccount(userId);
      const tokensMap: Record<supportedTokens, string> = {
        DAI: DAITokenAddress,
        STRK: STRKTokenAddress,
        ETH: ETHTokenAddress,
      };
      const contractAddress = tokensMap[payload.token];
      const contract = new Contract(tokenAbi, contractAddress, acct);
      const balance = await contract.balanceOf(
        accountData.precalculatedAddress
      );
      console.log(balance.balance.toString());

      return this.createSuccessResult("wallet_balance", {
        balance: `${(Number(balance.balance.toString()) / 10 ** 18).toFixed(
          2
        )} ${payload.token}`,
        token: contractAddress,
        address: accountData.precalculatedAddress,
      });
    } catch (error) {
      return this.createErrorResult(
        "wallet_balance",
        `Failed to get balance: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async transfer(
    payload: TransferPayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      const starkAccount = this.getStarkAccount(userId);

      const tx = await starkAccount.execute(
        {
          contractAddress: payload.to,
          entrypoint: "transfer",
          calldata: [payload.amount],
        },
        undefined
      );

      await starkAccount.waitForTransaction(tx.transaction_hash);

      return this.createSuccessResult("transfer", {
        from: starkAccount.address,
        to: payload.to,
        amount: payload.amount,
        txHash: tx.transaction_hash,
      });
    } catch (error) {
      return this.createErrorResult(
        "transfer",
        `Transfer failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async getWalletAddress(userId: string): Promise<ToolResult> {
    try {
      const account = this.getAccount(userId);
      return this.createSuccessResult("address", {
        address: account.precalculatedAddress,
      });
    } catch (error) {
      return this.createErrorResult(
        "address",
        `Failed to get address: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

export const walletTool = new WalletTool();
