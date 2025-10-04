import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { xverseService } from "../../services/XVerseService";

interface BitcoinBalancePayload extends Record<string, unknown> {
  address: string;
}

interface BitcoinUTXOsPayload extends Record<string, unknown> {
  address: string;
  offset?: number;
  limit?: number;
}

interface BitcoinTransactionsPayload extends Record<string, unknown> {
  address: string;
  limit?: number;
}

interface BitcoinTransactionPayload extends Record<string, unknown> {
  txid: string;
}

interface BitcoinPricePayload extends Record<string, unknown> {
  // No parameters needed for price
}


interface BitcoinCreateTransactionPayload extends Record<string, unknown> {
  inputs: string; // JSON string of array
  outputs: string; // JSON string of array
  feeRate?: number; // satoshis per byte
}

interface BitcoinSendTransactionPayload extends Record<string, unknown> {
  hex: string;
}

interface BitcoinCreateWalletPayload extends Record<string, unknown> {
  // No parameters needed for wallet creation
}

interface BitcoinValidateAddressPayload extends Record<string, unknown> {
  address: string;
}

export class BitcoinBalanceTool extends BaseTool<BitcoinBalancePayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_balance",
    description: "Get Bitcoin balance for a specific address",
    parameters: {
      address: {
        type: "string",
        description: "Bitcoin address to check balance for",
        required: true,
      },
    },
    examples: [
      "Get balance for address bc1q0egjvlcfq77cxd9kvpgppyuxckzvws46e3sxch",
      "Check Bitcoin balance",
      "How much BTC does this address have?",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinBalancePayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.address) {
        return this.createErrorResult("bitcoin_balance", "Address is required");
      }

      const balance = await xverseService.getAddressBalance(payload.address);
      
      return this.createSuccessResult("bitcoin_balance", {
        address: payload.address,
        total: balance.total,
        confirmed: balance.confirmed,
        unconfirmed: balance.unconfirmed,
        spendable: balance.spendable,
        utxos_count: balance.utxos.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_balance",
        `Failed to get Bitcoin balance: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinUTXOsTool extends BaseTool<BitcoinUTXOsPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_utxos",
    description: "Get Bitcoin UTXOs (Unspent Transaction Outputs) for a specific address",
    parameters: {
      address: {
        type: "string",
        description: "Bitcoin address to get UTXOs for",
        required: true,
      },
      offset: {
        type: "number",
        description: "Offset for pagination (default: 0)",
        required: false,
        min: 0,
      },
      limit: {
        type: "number",
        description: "Number of UTXOs to return (default: 60, max: 60)",
        required: false,
        min: 1,
        max: 60,
      },
    },
    examples: [
      "Get UTXOs for address bc1q0egjvlcfq77cxd9kvpgppyuxckzvws46e3sxch",
      "Show me the UTXOs for this Bitcoin address",
      "List unspent outputs",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinUTXOsPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.address) {
        return this.createErrorResult("bitcoin_utxos", "Address is required");
      }

      const offset = payload.offset || 0;
      const limit = payload.limit || 60;
      
      const utxos = await xverseService.getAddressUTXOs(payload.address, offset, limit);
      
      return this.createSuccessResult("bitcoin_utxos", {
        address: payload.address,
        utxos: utxos.map(utxo => ({
          txid: utxo.txid,
          vout: utxo.vout,
          value: utxo.value,
          satoshis: utxo.satoshis,
          confirmations: utxo.confirmations,
        })),
        count: utxos.length,
        offset,
        limit,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_utxos",
        `Failed to get Bitcoin UTXOs: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinTransactionsTool extends BaseTool<BitcoinTransactionsPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_transactions",
    description: "Get Bitcoin transaction history for a specific address",
    parameters: {
      address: {
        type: "string",
        description: "Bitcoin address to get transaction history for",
        required: true,
      },
      limit: {
        type: "number",
        description: "Number of transactions to return (default: 50)",
        required: false,
        min: 1,
        max: 100,
      },
    },
    examples: [
      "Get transaction history for address bc1q0egjvlcfq77cxd9kvpgppyuxckzvws46e3sxch",
      "Show me the transaction history for this Bitcoin address",
      "List recent Bitcoin transactions",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinTransactionsPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.address) {
        return this.createErrorResult("bitcoin_transactions", "Address is required");
      }

      const limit = payload.limit || 50;
      const transactions = await xverseService.getAddressTransactions(payload.address, limit);
      
      return this.createSuccessResult("bitcoin_transactions", {
        address: payload.address,
        transactions: transactions.map(tx => ({
          txid: tx.txid,
          hash: tx.hash,
          size: tx.size,
          confirmations: tx.confirmations,
          time: tx.time,
          blocktime: tx.blocktime,
        })),
        count: transactions.length,
        limit,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_transactions",
        `Failed to get Bitcoin transactions: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinTransactionTool extends BaseTool<BitcoinTransactionPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_transaction",
    description: "Get details of a specific Bitcoin transaction",
    parameters: {
      txid: {
        type: "string",
        description: "Transaction ID (hash) to get details for",
        required: true,
      },
    },
    examples: [
      "Get transaction details for txid abc123...",
      "Show me details of this Bitcoin transaction",
      "What are the details of transaction abc123?",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinTransactionPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.txid) {
        return this.createErrorResult("bitcoin_transaction", "Transaction ID is required");
      }

      const transaction = await xverseService.getTransaction(payload.txid);
      
      return this.createSuccessResult("bitcoin_transaction", {
        txid: transaction.txid,
        hash: transaction.hash,
        version: transaction.version,
        size: transaction.size,
        vsize: transaction.vsize,
        weight: transaction.weight,
        locktime: transaction.locktime,
        confirmations: transaction.confirmations,
        time: transaction.time,
        blocktime: transaction.blocktime,
        blockhash: transaction.blockhash,
        input_count: transaction.vin.length,
        output_count: transaction.vout.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_transaction",
        `Failed to get Bitcoin transaction: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinPriceTool extends BaseTool<BitcoinPricePayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_price",
    description: "Get current Bitcoin price in USD",
    parameters: {},
    examples: [
      "What is the current Bitcoin price?",
      "Get Bitcoin price",
      "How much is Bitcoin worth?",
      "Current BTC price",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinPricePayload, userId: string): Promise<ToolResult> {
    try {
      const price = await xverseService.getBitcoinPrice();
      
      return this.createSuccessResult("bitcoin_price", {
        price_usd: price.usd,
        currency: "USD",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_price",
        `Failed to get Bitcoin price: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}


export class BitcoinCreateTransactionTool extends BaseTool<BitcoinCreateTransactionPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_create_transaction",
    description: "Create and sign a Bitcoin transaction",
    parameters: {
      inputs: {
        type: "string",
        description: "JSON string of array of input UTXOs to spend",
        required: true,
      },
      outputs: {
        type: "string",
        description: "JSON string of array of output addresses and amounts",
        required: true,
      },
      feeRate: {
        type: "number",
        description: "Fee rate in satoshis per byte (optional)",
        required: false,
        min: 1,
      },
    },
    examples: [
      "Create a Bitcoin transaction to send 0.001 BTC",
      "Sign a Bitcoin transaction",
      "Build a Bitcoin transaction",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinCreateTransactionPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.inputs || !payload.outputs) {
        return this.createErrorResult("bitcoin_create_transaction", "Inputs and outputs are required");
      }

      // Parse JSON strings
      let inputs, outputs;
      try {
        inputs = JSON.parse(payload.inputs as string);
        outputs = JSON.parse(payload.outputs as string);
      } catch (error) {
        return this.createErrorResult("bitcoin_create_transaction", "Invalid JSON format for inputs or outputs");
      }

      if (inputs.length === 0 || outputs.length === 0) {
        return this.createErrorResult("bitcoin_create_transaction", "At least one input and one output is required");
      }

      // Get the first private key for transaction creation
      const privateKey = inputs[0].privateKey;
      
      const signedTx = await xverseService.createTransaction({
        inputs,
        outputs,
        feeRate: payload.feeRate,
      }, privateKey);
      
      return this.createSuccessResult("bitcoin_create_transaction", {
        txid: signedTx.txid,
        hex: signedTx.hex,
        fee: signedTx.fee,
        input_count: inputs.length,
        output_count: outputs.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_create_transaction",
        `Failed to create Bitcoin transaction: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinSendTransactionTool extends BaseTool<BitcoinSendTransactionPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_send_transaction",
    description: "Send a signed Bitcoin transaction to the network",
    parameters: {
      hex: {
        type: "string",
        description: "Raw transaction hex to broadcast",
        required: true,
      },
    },
    examples: [
      "Send this Bitcoin transaction",
      "Broadcast a Bitcoin transaction",
      "Submit transaction to Bitcoin network",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinSendTransactionPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.hex) {
        return this.createErrorResult("bitcoin_send_transaction", "Transaction hex is required");
      }

      const txid = await xverseService.sendRawTransaction(payload.hex);
      
      return this.createSuccessResult("bitcoin_send_transaction", {
        txid,
        status: "broadcasted",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_send_transaction",
        `Failed to send Bitcoin transaction: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinCreateWalletTool extends BaseTool<BitcoinCreateWalletPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_create_wallet",
    description: "Create a new Bitcoin wallet",
    parameters: {},
    examples: [
      "Create a new Bitcoin wallet",
      "Generate a new Bitcoin address",
      "Create a new BTC wallet",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinCreateWalletPayload, userId: string): Promise<ToolResult> {
    try {
      const wallet = xverseService.createWallet();
      
      return this.createSuccessResult("bitcoin_create_wallet", {
        address: wallet.address,
        publicKey: wallet.publicKey,
        wif: wallet.wif,
        hasMnemonic: !!wallet.mnemonic,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_create_wallet",
        `Failed to create Bitcoin wallet: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

export class BitcoinValidateAddressTool extends BaseTool<BitcoinValidateAddressPayload> {
  metadata: ToolMetadata = {
    name: "bitcoin_validate_address",
    description: "Validate a Bitcoin address",
    parameters: {
      address: {
        type: "string",
        description: "Bitcoin address to validate",
        required: true,
      },
    },
    examples: [
      "Validate Bitcoin address bc1q0egjvlcfq77cxd9kvpgppyuxckzvws46e3sxch",
      "Is this a valid Bitcoin address?",
      "Check if address is valid",
    ],
    category: "bitcoin",
    version: "1.0.0",
  };

  async execute(payload: BitcoinValidateAddressPayload, userId: string): Promise<ToolResult> {
    try {
      if (!payload.address) {
        return this.createErrorResult("bitcoin_validate_address", "Address is required");
      }

      const isValid = xverseService.isValidAddress(payload.address);
      
      return this.createSuccessResult("bitcoin_validate_address", {
        address: payload.address,
        isValid,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this.createErrorResult(
        "bitcoin_validate_address",
        `Failed to validate Bitcoin address: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

// Export all tools
export const bitcoinBalanceTool = new BitcoinBalanceTool();
export const bitcoinUTXOsTool = new BitcoinUTXOsTool();
export const bitcoinTransactionsTool = new BitcoinTransactionsTool();
export const bitcoinTransactionTool = new BitcoinTransactionTool();
export const bitcoinPriceTool = new BitcoinPriceTool();
export const bitcoinCreateTransactionTool = new BitcoinCreateTransactionTool();
export const bitcoinSendTransactionTool = new BitcoinSendTransactionTool();
export const bitcoinCreateWalletTool = new BitcoinCreateWalletTool();
export const bitcoinValidateAddressTool = new BitcoinValidateAddressTool();
