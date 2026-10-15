// packages/sdk/src/wallet.ts

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
  const totalBalance = parseFloat(data.balance || '0');
  const sellingLiabilities = parseFloat(data.sellingLiabilities || '0');
  const numSubentries = data.numSubentries || 0;
  
  const baseReserve = parseFloat(data.baseReserve || '0.5');
  const reserveBase = parseFloat(data.reserveBase || '1.0');
  const estimatedFee = parseFloat(data.estimatedFee || '0.0001'); // 1 stroop default or configured fee

  // Total Reserve = ReserveBase + (numSubentries * baseReserve)
  const totalReserve = reserveBase + numSubentries * baseReserve;

  // Spendable = Total Balance - Total Reserve - Selling Liabilities - Estimated Fee
  const spendable = totalBalance - totalReserve - sellingLiabilities - estimatedFee;

  return Math.max(0, spendable).toFixed(7);
}