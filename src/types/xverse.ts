// XVerse API Types
export interface XVerseConfig {
  network: 'mainnet' | 'testnet';
  apiKey?: string;
  baseUrl?: string;
  rateLimitDelay?: number;
}

// Core Bitcoin Types
export interface BitcoinUTXO {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  confirmations: number;
  address: string;
  satoshis: number;
}

export interface BitcoinBalance {
  total: number;
  confirmed: number;
  unconfirmed: number;
  spendable: number;
  utxos: BitcoinUTXO[];
}

export interface BitcoinTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: BitcoinInput[];
  vout: BitcoinOutput[];
  hex: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface BitcoinInput {
  txid: string;
  vout: number;
  prevout?: BitcoinOutput;
  scriptsig: string;
  scriptsig_asm: string;
  witness?: string[];
  is_coinbase: boolean;
  sequence: number;
}

export interface BitcoinOutput {
  value: number;
  n: number;
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
}

export interface BitcoinFeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface BitcoinTransactionRequest {
  inputs: Array<{
    txid: string;
    vout: number;
    privateKey: string;
  }>;
  outputs: Array<{
    address: string;
    value: number; // in satoshis
  }>;
  feeRate?: number; // satoshis per byte
}

export interface BitcoinSignedTransaction {
  hex: string;
  txid: string;
  fee: number;
}

export interface BitcoinWalletInfo {
  address: string;
  privateKey: string;
  publicKey: string;
  wif: string;
  mnemonic?: string;
}

// Swap Types
export interface SwapQuote {
  input: {
    token: string;
    amount: string;
    chain: string;
  };
  output: {
    token: string;
    amount: string;
    chain: string;
  };
  price_impact: number;
  fee: string;
  route: string[];
  estimated_time: number;
  provider: string;
}

export interface SwapOrder {
  order_id: string;
  status: string;
  fee: string;
  total_cost: string;
  expires_at: number;
  payment_address: string;
  payment_amount: string;
}

// XVerse API Response Types
export interface XVerseBalanceResponse {
  confirmed: {
    fundedTxoSum: number;
    fundedTxoCount: number;
    spentTxoSum: number;
    spentTxoCount: number;
  };
  unconfirmed: {
    fundedTxoSum: number;
    fundedTxoCount: number;
    spentTxoSum: number;
    spentTxoCount: number;
  };
}

export interface XVerseUTXOResponse {
  items: Array<{
    txid: string;
    vout: number;
    value: number;
    status: {
      confirmed: boolean;
      block_height?: number;
      block_hash?: string;
      block_time?: number;
    };
  }>;
  total: number;
}

export interface XVerseTransactionResponse {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: BitcoinInput[];
  vout: BitcoinOutput[];
  hex: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface XVerseFeeEstimateResponse {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface XVersePriceResponse {
  usd: number;
  btc: number;
  timestamp: number;
}

export interface XVerseBlockResponse {
  height: number;
  hash: string;
  time: number;
  size: number;
  weight: number;
  tx_count: number;
  previous_block_hash?: string;
  next_block_hash?: string;
}
