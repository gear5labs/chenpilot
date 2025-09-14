import { Account, RpcProvider, Contract } from "starknet";
import accountsData from "../../Auth/accounts.json";
import tokenAbi from "../../abis/token.json";
import {
  STRKTokenAddress,
  ETHTokenAddress,
  DAITokenAddress,
} from "../../constants/tokenaddresses";

interface AccountData {
  userId: string;
  privateKey: string;
  publicKey: string;
  precalculatedAddress: string;
  deployed: boolean;
  contract_address?: string;
}
import { supportedTokens, Tool } from "../types";
export class WalletTool {
  private accounts: AccountData[];
  private provider: RpcProvider;

  constructor() {
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

  async getBalance(payload: { token: supportedTokens }, userId: string) {
    
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
    const balance = await contract.balanceOf(accountData.precalculatedAddress);
    console.log(balance.balance.toString());
    return {
      action: "wallet_balance",
      status: "success",
      balance: `${(Number(balance.balance.toString()) / 10 ** 18).toFixed(2)} ${
        payload.token
      }`,
      token: contractAddress,
      address: accountData.precalculatedAddress,
    };
  }

  async transfer(payload: { to: string; amount: number }, userId: string) {
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

    return {
      action: "transfer",
      status: "success",
      details: {
        from: starkAccount.address,
        to: payload.to,
        amount: payload.amount,
        txHash: tx.transaction_hash,
      },
    };
  }
  async getWalletAddress(userId: string) {
    const account = this.getAccount(userId);
    return {
      action: "address",
      status: "success",
      address: account.precalculatedAddress,
    };
  }
}

export const walletTool = new WalletTool();
