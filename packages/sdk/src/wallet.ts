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