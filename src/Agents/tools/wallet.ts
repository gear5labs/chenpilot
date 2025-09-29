import { Account, RpcProvider, Contract, uint256 } from "starknet";
import tokenAbi from "../../abis/token.json";
import {
  STRKTokenAddress,
  ETHTokenAddress,
  DAITokenAddress,
} from "../../constants/tokenaddresses";
import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import ContactService from "../../Contacts/contact.service";
import { AuthService } from "../../Auth/auth.service";
import { container } from "tsyringe";
import { StarknetService } from "../../Auth/starknet.service";
import { AutoFundingService } from "../../Auth/auto-funding.service";
import { EncryptionService } from "../../Auth/encryption.service";
import config from "../../config/config";
const tokensMap: Record<supportedTokens, string> = {
  DAI: DAITokenAddress,
  STRK: STRKTokenAddress,
  ETH: ETHTokenAddress,
};

interface AccountData {
  userId: string;
  privateKey: string;
  publicKey: string;
  precalculatedAddress: string;
  deployed: boolean;
  contract_address?: string;
}

type supportedTokens = "STRK" | "ETH" | "DAI";

// System accounts configuration - loaded from environment variables
const getSystemAccounts = (): AccountData[] => {
  const privateKey = process.env.FUNDED_ACCOUNT_PRIVATE_KEY;
  const publicKey = process.env.FUNDED_ACCOUNT_PUBLIC_KEY;
  const address = process.env.FUNDED_ACCOUNT_ADDRESS;
  const deployed = process.env.FUNDED_ACCOUNT_DEPLOYED === 'true';

  if (!privateKey || !publicKey || !address) {
    throw new Error('Missing required environment variables for funded account: FUNDED_ACCOUNT_PRIVATE_KEY, FUNDED_ACCOUNT_PUBLIC_KEY, FUNDED_ACCOUNT_ADDRESS');
  }

  return [
    {
      userId: "funded-account",
      privateKey,
      publicKey,
      precalculatedAddress: address,
      deployed,
      contract_address: undefined
    }
  ];
};

interface BalancePayload {
  token: supportedTokens;
}

interface TransferPayload {
  to: string;
  amount: number;
  token?: "STRK" | "ETH";
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
  private contactService: ContactService;
  private authService: AuthService;
  
  constructor() {
    super();
    this.accounts = getSystemAccounts();
    this.provider = new RpcProvider({
      nodeUrl: config.node_url,
    });
    
    // Create service instances directly
    this.contactService = new ContactService();
    
    // Create AuthService with its dependencies using tsyringe container
    const starknetService = container.resolve(StarknetService);
    const encryptionService = container.resolve(EncryptionService);
    const autoFundingService = container.resolve(AutoFundingService);
    this.authService = container.resolve(AuthService);
  }

  private async getAccount(userId: string): Promise<AccountData> {
    // First try to get user account from database
    try {
      const userAccountData = await this.authService.getUserAccountData(userId);
      return {
        userId: userAccountData.userId,
        privateKey: userAccountData.privateKey,
        publicKey: userAccountData.publicKey,
        precalculatedAddress: userAccountData.precalculatedAddress,
        deployed: userAccountData.deployed,
        contract_address: userAccountData.contract_address
      };
    } catch (error) {
      // If not found in database, check if it's a system account
      const systemAccount = this.accounts.find((a) => a.userId === userId);
      if (systemAccount) {
        return systemAccount;
      }
      
      throw new Error(`Account not found: ${userId}. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getStarkAccount(userId: string): Promise<Account> {
    const accountData = await this.getAccount(userId);

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
      const accountData = await this.getAccount(userId);
      const acct = await this.getStarkAccount(userId);

      const contractAddress = tokensMap[payload.token];
      if (!contractAddress) throw new Error("invalid token ");
      const contract = new Contract(tokenAbi, contractAddress, acct);
      const balance = await contract.balanceOf(
        accountData.precalculatedAddress
      );

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
      const starkAccount = await this.getStarkAccount(userId);
      const tokenAddress = payload.token
        ? tokensMap[payload.token]
        : STRKTokenAddress;
      const isValidContact = await this.contactService.getContactByName(
        payload.to
      );
      if (isValidContact) payload.to = isValidContact.address;
      const amount = uint256.bnToUint256(payload.amount * 10 ** 18);
      const tx = await starkAccount.execute({
        contractAddress: tokenAddress,
        entrypoint: "transfer",
        calldata: [payload.to, amount.low, amount.high],
      });

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
      const account = await this.getAccount(userId);
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

