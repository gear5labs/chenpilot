export interface XverseConfig {
  apiKey: string;
  baseUrl: string;
  network: 'mainnet' | 'testnet';
  rateLimitDelay?: number;
}

export interface XverseTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: XverseInput[];
  vout: XverseOutput[];
  hex: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export interface XverseInput {
  txid: string;
  vout: number;
  prevout: XverseOutput;
  scriptsig: string;
  scriptsig_asm: string;
  witness: string[];
  is_coinbase: boolean;
  sequence: number;
}

export interface XverseOutput {
  value: number;
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
}

export interface XverseOrdinal {
  id: string;
  number: number;
  address: string;
  output: string;
  value: number;
  timestamp: number;
  height: number;
  idx: number;
  vin: number;
  vout: number;
  offset: number;
  rarity: string;
  type: string;
  content_type?: string;
  content_length?: number;
  preview?: string;
  content?: string;
}

export interface XverseRune {
  id: string;
  symbol: string;
  name: string;
  divisibility: number;
  premine: string;
  terms: string;
  spacers: number;
  rune: string;
  address: string;
  balance: string;
  holders: number;
  minted: string;
  supply: string;
  cap: string;
  block: number;
  txid: string;
}

export interface XverseBalance {
  address: string;
  balance: string;
  total_received: string;
  total_sent: string;
  txs: number;
  unconfirmed_balance: string;
  unconfirmed_txs: number;
}

export interface XverseSendTransaction {
  to: string;
  amount: string;
  fee_rate?: number;
  memo?: string;
}

export interface XverseSendRune {
  rune_id: string;
  to: string;
  amount: string;
  fee_rate?: number;
}

export interface XverseMintOrdinal {
  content: string;
  content_type: string;
  fee_rate?: number;
}

export interface XverseApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Bitcoin-specific types
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
  vin: XverseInput[];
  vout: XverseOutput[];
  hex: string;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
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
  }>;
  outputs: Array<{
    address: string;
    value: number;
  }>;
  feeRate?: number;
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

export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  price: string;
  priceImpact: string;
  fee: string;
  route: string[];
}

export interface SwapOrder {
  id: string;
  status: string;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  signature: string;
}

// XVerse API Response types
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
      block_height: number;
      block_hash: string;
      block_time: number;
    };
  }>;
  total: number;
  offset: number;
  limit: number;
}

export interface XVerseTransactionResponse {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: XverseInput[];
  vout: XverseOutput[];
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
  currency: string;
  rate: number;
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
