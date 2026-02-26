/**
 * Mock RPC responses for testing Soroban RPC client
 * Provides realistic mock data for ledger lookups and event queries
 */

export interface MockLedgerResponse {
  id: string;
  sequence: number;
  hash: string;
  previousLedgerHash: string;
  closeTime: number;
  transactionCount: number;
}

export interface MockTransactionResponse {
  id: string;
  hash: string;
  ledger: number;
  createdAt: number;
  status: "SUCCESS" | "FAILED";
  events: MockEventResponse[];
}

export interface MockEventResponse {
  type: "contract" | "system";
  contractId?: string;
  topic: unknown[];
  value: unknown;
}

/**
 * Mock successful ledger response
 */
export const mockLedgerResponse: MockLedgerResponse = {
  id: "ledger_1000000",
  sequence: 1000000,
  hash: "abc123def456",
  previousLedgerHash: "prev_hash_999999",
  closeTime: 1700000000,
  transactionCount: 5,
};

/**
 * Mock ledger with no transactions
 */
export const mockEmptyLedgerResponse: MockLedgerResponse = {
  id: "ledger_1000001",
  sequence: 1000001,
  hash: "empty_ledger_hash",
  previousLedgerHash: "abc123def456",
  closeTime: 1700000005,
  transactionCount: 0,
};

/**
 * Mock transaction with transfer event
 */
export const mockTransferTransaction: MockTransactionResponse = {
  id: "tx_transfer_123",
  hash: "tx_hash_transfer_123",
  ledger: 1000000,
  createdAt: 1700000000,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["transfer", "GFROM", "GTO"],
      value: { amount: "1000" },
    },
  ],
};

/**
 * Mock transaction with mint event
 */
export const mockMintTransaction: MockTransactionResponse = {
  id: "tx_mint_456",
  hash: "tx_hash_mint_456",
  ledger: 1000000,
  createdAt: 1700000000,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CDEF456",
      topic: ["mint"],
      value: { recipient: "GADDR", amount: "5000" },
    },
  ],
};

/**
 * Mock transaction with burn event
 */
export const mockBurnTransaction: MockTransactionResponse = {
  id: "tx_burn_789",
  hash: "tx_hash_burn_789",
  ledger: 1000001,
  createdAt: 1700000005,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["burn"],
      value: { from: "GADDR", amount: "500" },
    },
  ],
};

/**
 * Mock transaction with multiple events
 */
export const mockMultiEventTransaction: MockTransactionResponse = {
  id: "tx_multi_999",
  hash: "tx_hash_multi_999",
  ledger: 1000002,
  createdAt: 1700000010,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["approve"],
      value: { spender: "GSPENDER", amount: "10000" },
    },
    {
      type: "contract",
      contractId: "CABC123",
      topic: ["transfer"],
      value: { from: "GFROM", to: "GTO", amount: "1000" },
    },
  ],
};

/**
 * Mock failed transaction
 */
export const mockFailedTransaction: MockTransactionResponse = {
  id: "tx_failed_111",
  hash: "tx_hash_failed_111",
  ledger: 1000003,
  createdAt: 1700000015,
  status: "FAILED",
  events: [],
};

/**
 * Mock transaction with complex event data
 */
export const mockComplexEventTransaction: MockTransactionResponse = {
  id: "tx_complex_222",
  hash: "tx_hash_complex_222",
  ledger: 1000004,
  createdAt: 1700000020,
  status: "SUCCESS",
  events: [
    {
      type: "contract",
      contractId: "CGHI789",
      topic: ["swap_executed"],
      value: {
        trader: "GTRADER",
        tokenIn: "CTOKEN_IN",
        tokenOut: "CTOKEN_OUT",
        amountIn: "1000",
        amountOut: "950",
        fee: "50",
        path: ["CTOKEN_IN", "CTOKEN_MID", "CTOKEN_OUT"],
        timestamp: 1700000020,
      },
    },
  ],
};

/**
 * Mock RPC error response
 */
export const mockRpcErrorResponse = {
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32600,
    message: "Invalid request",
  },
};

/**
 * Mock RPC network error
 */
export const mockNetworkError = new Error("Network request failed");

/**
 * Mock RPC timeout error
 */
export const mockTimeoutError = new Error("Request timeout");

/**
 * Generate mock ledger sequence
 */
export function generateMockLedger(sequence: number): MockLedgerResponse {
  return {
    id: `ledger_${sequence}`,
    sequence,
    hash: `hash_${sequence}`,
    previousLedgerHash: `hash_${sequence - 1}`,
    closeTime: 1700000000 + sequence * 5,
    transactionCount: Math.floor(Math.random() * 10),
  };
}

/**
 * Generate mock transaction
 */
export function generateMockTransaction(
  ledger: number,
  contractId: string,
  topic: string[]
): MockTransactionResponse {
  return {
    id: `tx_${ledger}_${Math.random().toString(36).substr(2, 9)}`,
    hash: `tx_hash_${Math.random().toString(36).substr(2, 16)}`,
    ledger,
    createdAt: 1700000000 + ledger * 5,
    status: "SUCCESS",
    events: [
      {
        type: "contract",
        contractId,
        topic,
        value: { data: "mock_data" },
      },
    ],
  };
}

/**
 * Mock RPC client for testing
 */
export class MockRpcClient {
  private ledgers: Map<number, MockLedgerResponse> = new Map();
  private transactions: Map<string, MockTransactionResponse> = new Map();

  constructor() {
    // Initialize with some default data
    this.ledgers.set(1000000, mockLedgerResponse);
    this.ledgers.set(1000001, mockEmptyLedgerResponse);

    this.transactions.set(
      mockTransferTransaction.hash,
      mockTransferTransaction
    );
    this.transactions.set(mockMintTransaction.hash, mockMintTransaction);
    this.transactions.set(mockBurnTransaction.hash, mockBurnTransaction);
  }

  async getLedger(sequence: number): Promise<MockLedgerResponse | null> {
    return this.ledgers.get(sequence) || null;
  }

  async getTransaction(hash: string): Promise<MockTransactionResponse | null> {
    return this.transactions.get(hash) || null;
  }

  async getLatestLedger(): Promise<MockLedgerResponse> {
    const sequences = Array.from(this.ledgers.keys());
    const latest = Math.max(...sequences);
    return this.ledgers.get(latest)!;
  }

  addLedger(ledger: MockLedgerResponse): void {
    this.ledgers.set(ledger.sequence, ledger);
  }

  addTransaction(transaction: MockTransactionResponse): void {
    this.transactions.set(transaction.hash, transaction);
  }
}
