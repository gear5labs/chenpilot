// packages/sdk/src/wallet.ts

import { parsePublicAmount } from "./fixedAmount";

export interface RpcClientInterface {
  getAccount(accountId: string): Promise<any>;
}

export interface SelectedOperation {
  operationType: 'payment' | 'create_account';
  destination: string;
  amount: string;
}

/**
 * Preflights recipient existence via RPC and chooses the appropriate
 * transaction operation (Payment vs CreateAccount).
 */
export async function selectPaymentOrCreationOperation(
  rpcClient: RpcClientInterface,
  destinationId: string,
  amount: string
): Promise<SelectedOperation> {
  let recipientExists = true;

  try {
    await rpcClient.getAccount(destinationId);
  } catch (error: any) {
    // Treat 404 or not found errors as non-existent recipient accounts
    if (error.status === 404 || error.message?.includes('not found') || error.code === 'account_not_found') {
      recipientExists = false;
    } else {
      throw error; // Rethrow unexpected RPC/network errors
    }
  }

  if (!recipientExists) {
    return {
      operationType: 'create_account',
      destination: destinationId,
      amount,
    };
  }

  return {
    operationType: 'payment',
    destination: destinationId,
    amount,
  };
}


export interface AccountBalanceData {
  balance: string;             // Total XLM balance as string
  sellingLiabilities: string;  // Active selling liabilities
  numSubentries: number;       // Number of subentries (trustlines, offers, data entries, etc.)
  baseReserve?: string;        // Optional base reserve override (default 0.5 XLM per entry)
  reserveBase?: string;        // Base account reserve (default 1.0 XLM)
  estimatedFee?: string;       // Estimated transaction fee reserve
}

/**
 * Computes spendable XLM taking into account account reserves, selling liabilities, and fees.
 */
export function computeSpendableXlm(data: AccountBalanceData): string {
  const decimals = 7;
  const scale = 10n ** BigInt(decimals);
  const totalBalance = parsePublicAmount(data.balance || "0", decimals);
  const sellingLiabilities = parsePublicAmount(data.sellingLiabilities || "0", decimals);
  const numSubentries = data.numSubentries || 0;
  const baseReserve = parsePublicAmount(data.baseReserve || "0.5", decimals);
  const reserveBase = parsePublicAmount(data.reserveBase || "1.0", decimals);
  const estimatedFee = parsePublicAmount(data.estimatedFee || "0.0001", decimals);

  const totalReserve = reserveBase + BigInt(numSubentries) * baseReserve;
  const spendable = totalBalance - totalReserve - sellingLiabilities - estimatedFee;
  const floored = spendable > 0n ? spendable : 0n;
  const intPart = floored / scale;
  const frac = (floored % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart.toString();
}