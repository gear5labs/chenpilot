import { injectable } from 'tsyringe';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import config from '../config/config';
import {
  XverseConfig,
  BitcoinUTXO,
  BitcoinBalance,
  BitcoinTransaction,
  BitcoinFeeEstimate,
  BitcoinTransactionRequest,
  BitcoinSignedTransaction,
  BitcoinWalletInfo,
  SwapQuote,
  SwapOrder,
  XVerseBalanceResponse,
  XVerseUTXOResponse,
  XVerseTransactionResponse,
  XVerseFeeEstimateResponse,
  XVersePriceResponse,
  XVerseBlockResponse,
} from '../types/xverse';

// Initialize ECPair with secp256k1
const ECPair = ECPairFactory(ecc);

// Initialize bitcoinjs-lib with ecc
bitcoin.initEccLib(ecc);

@injectable()
export class XVerseService {
  private config: XverseConfig;
  private network: bitcoin.Network;
  private baseUrl: string;
  private rateLimitDelay: number;
  private lastRequestTime: number = 0;

  constructor() {
    this.config = {
      network: (config.bitcoinNetwork as 'mainnet') || 'mainnet',
      apiKey: config.xverseApiKey || '',
      baseUrl: config.xverseBaseUrl || '',
      rateLimitDelay: 100,
    };

    this.network =
      this.config.network === 'mainnet'
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;

    // Auto-select endpoint based on network:
    // mainnet: https://api.secretkeylabs.io (SecretKey Labs mainnet endpoint)
    // testnet: https://api-testnet4.secretkeylabs.io (SecretKey Labs testnet4 endpoint)
    this.baseUrl =
      this.config.baseUrl ||
      (this.config.network === 'mainnet'
        ? 'https://api.secretkeylabs.io'
        : 'https://api-testnet4.secretkeylabs.io');
    this.rateLimitDelay = this.config.rateLimitDelay || 100;
  }

  public setConfig(config: Partial<XverseConfig>): void {
    this.config = { ...this.config, ...config };
    this.network =
      this.config.network === 'mainnet'
        ? bitcoin.networks.bitcoin
        : bitcoin.networks.testnet;
    // Auto-select endpoint based on network:
    // mainnet: https://api.secretkeylabs.io (SecretKey Labs mainnet endpoint)
    // testnet: https://api-testnet4.secretkeylabs.io (SecretKey Labs testnet4 endpoint)
    this.baseUrl =
      this.config.baseUrl ||
      (this.config.network === 'mainnet'
        ? 'https://api.secretkeylabs.io'
        : 'https://api-testnet4.secretkeylabs.io');
    this.rateLimitDelay = this.config.rateLimitDelay || 100;
  }

  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make authenticated request to XVerse API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.rateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Chenpilot-XVerse-Integration/1.0',
      ...(options.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`XVerse API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Error handling helper
   */
  private handleError(error: any, message: string): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(message);
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<{ status: string; details?: string }> {
    try {
      // Test with a simple endpoint that we know works
      await this.makeRequest<XVerseBalanceResponse>(
        '/v1/bitcoin/address/bc1q0egjvlcfq77cxd9kvpgppyuxckzvws46e3sxch/balance'
      );
      return { status: 'healthy' };
    } catch (error: any) {
      return { status: 'error', details: error.message };
    }
  }

  /**
   * Get Bitcoin address balance
   */
  public async getAddressBalance(address: string): Promise<BitcoinBalance> {
    try {
      const data = await this.makeRequest<XVerseBalanceResponse>(
        `/v1/bitcoin/address/${address}/balance`
      );

      // Convert the API response to our format
      const confirmed = data.confirmed?.fundedTxoSum || 0;
      const unconfirmed = data.unconfirmed?.fundedTxoSum || 0;
      const total = confirmed + unconfirmed;

      // Get UTXOs for detailed breakdown
      const utxos = await this.getAddressUTXOs(address);

      return {
        total,
        confirmed,
        unconfirmed,
        spendable: confirmed, // Confirmed funds are spendable
        utxos,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch address balance');
    }
  }

  /**
   * Get Bitcoin UTXOs for an address
   */
  public async getAddressUTXOs(
    address: string,
    offset: number = 0,
    limit: number = 60
  ): Promise<BitcoinUTXO[]> {
    try {
      const data = await this.makeRequest<XVerseUTXOResponse>(
        `/v1/bitcoin/address/${address}/utxo?offset=${offset}&limit=${limit}`
      );

      return data.items.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value / 100000000,
        scriptPubKey: '',
        confirmations: utxo.status?.confirmed ? 1 : 0,
        address: address,
        satoshis: utxo.value,
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch UTXOs');
    }
  }

  /**
   * Get Bitcoin transaction history
   */
  public async getAddressTransactions(
    address: string,
    limit: number = 50
  ): Promise<BitcoinTransaction[]> {
    try {
      const data = await this.makeRequest<{
        transactions: Array<{
          txid: string;
          blockHeight: number;
          blockTime: number;
          ownActivity: Array<{
            address: string;
            sent: number;
            received: number;
            outgoing: number;
            incoming: number;
          }>;
          totalOut: number;
          totalIn: number;
        }>;
        offset: number;
        limit: number;
      }>(`/v1/analytics/history?addresses=${address}&limit=${limit}`);

      // Convert the analytics history format to our Bitcoin transaction format
      return data.transactions.map(tx => ({
        txid: tx.txid,
        hash: tx.txid,
        version: 1,
        size: 0,
        vsize: 0,
        weight: 0,
        locktime: 0,
        vin: [],
        vout: [],
        hex: '',
        blockhash: undefined,
        confirmations: tx.blockHeight > 0 ? 1 : 0,
        time: tx.blockTime,
        blocktime: tx.blockTime,
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch transaction history');
    }
  }

  /**
   * Get specific Bitcoin transaction
   */
  public async getTransaction(txid: string): Promise<BitcoinTransaction> {
    try {
      const data = await this.makeRequest<XVerseTransactionResponse>(
        `/v1/bitcoin/transactions/${txid}`
      );
      return this.convertXVerseTransactionToBitcoinTransaction(data);
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch transaction');
    }
  }

  /**
   * Get raw transaction hex
   */
  public async getRawTransaction(txid: string): Promise<string> {
    try {
      const data = await this.makeRequest<{ hex: string }>(
        `/v1/bitcoin/transactions/${txid}/hex`
      );
      return data.hex;
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch raw transaction');
    }
  }

  /**
   * Decode raw Bitcoin transaction
   */
  public async decodeRawTransaction(hex: string): Promise<BitcoinTransaction> {
    try {
      const data = await this.makeRequest<XVerseTransactionResponse>(
        '/v1/bitcoin/transactions/decode',
        {
          method: 'POST',
          body: JSON.stringify({ hex }),
        }
      );

      return this.convertXVerseTransactionToBitcoinTransaction(data);
    } catch (error) {
      throw this.handleError(error, 'Failed to decode transaction');
    }
  }

  /**
   * Send raw transaction using XVerse API
   */
  public async sendRawTransaction(hex: string): Promise<string> {
    try {
      const data = await this.makeRequest<{ txid: string }>(
        '/v1/bitcoin/node-and-mempool/send-transaction',
        {
          method: 'POST',
          body: JSON.stringify({ hex }),
        }
      );

      return data.txid;
    } catch (error) {
      throw this.handleError(error, 'Failed to send transaction');
    }
  }

  /**
   * Get Bitcoin price
   */
  public async getBitcoinPrice(): Promise<{ usd: number }> {
    try {
      const data = await this.makeRequest<{ currency: string; rate: number }>(
        '/v1/bitcoin/price'
      );
      return { usd: data.rate };
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch Bitcoin price');
    }
  }

  /**
   * Get current Bitcoin block
   */
  public async getCurrentBlock(): Promise<{
    height: number;
    hash: string;
    time: number;
    size: number;
    weight: number;
    tx_count: number;
  }> {
    try {
      const data = await this.makeRequest<XVerseBlockResponse>(
        '/v1/bitcoin/blocks/current'
      );

      return {
        height: data.height,
        hash: data.hash,
        time: data.time,
        size: data.size,
        weight: data.weight,
        tx_count: data.tx_count,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch current block');
    }
  }

  /**
   * Get block by height
   */
  public async getBlockByHeight(height: number): Promise<{
    height: number;
    hash: string;
    time: number;
    size: number;
    weight: number;
    tx_count: number;
    previous_block_hash: string;
    next_block_hash?: string;
  }> {
    try {
      const data = await this.makeRequest<XVerseBlockResponse>(
        `/v1/bitcoin/blocks/${height}`
      );

      return {
        height: data.height,
        hash: data.hash,
        time: data.time,
        size: data.size,
        weight: data.weight,
        tx_count: data.tx_count,
        previous_block_hash: data.previous_block_hash || '',
        next_block_hash: data.next_block_hash,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch block by height');
    }
  }

  /**
   * Create and sign Bitcoin transaction using mnemonic
   */
  public async createTransactionWithMnemonic(
    request: BitcoinTransactionRequest,
    mnemonic: string,
    derivationPath: string = "m/84'/0'/0'/0/0"
  ): Promise<BitcoinSignedTransaction> {
    try {
      // Import wallet from mnemonic to get private key
      const walletInfo = this.importWalletFromMnemonic(mnemonic);
      return await this.createTransaction(request, walletInfo.privateKey);
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to create transaction with mnemonic'
      );
    }
  }

  /**
   * Create and sign Bitcoin transaction using private key
   */
  public async createTransaction(
    request: BitcoinTransactionRequest,
    privateKey: string
  ): Promise<BitcoinSignedTransaction> {
    try {
      const psbt = new bitcoin.Psbt({ network: this.network });

      // Add inputs
      for (const input of request.inputs) {
        const txHex = await this.getRawTransaction(input.txid);
        const tx = bitcoin.Transaction.fromHex(txHex);
        const utxo = tx.outs[input.vout];

        psbt.addInput({
          hash: input.txid,
          index: input.vout,
          witnessUtxo: {
            script: utxo.script,
            value: utxo.value,
          },
        });
      }

      // Add outputs
      let totalOutputValue = 0;
      for (const output of request.outputs) {
        psbt.addOutput({
          address: output.address,
          value: output.value,
        });
        totalOutputValue += output.value;
      }

      // Calculate fee (using default rate since XVerse doesn't provide fee estimation)
      const feeRate = request.feeRate || 10; // Default 10 satoshis per byte
      const estimatedSize =
        request.inputs.length * 148 + request.outputs.length * 34 + 10; // Rough estimate
      const fee = Math.max(estimatedSize * feeRate, 1000); // Minimum 1000 satoshis

      // Add change output if needed
      const totalInputValue = request.inputs.reduce((sum, input) => {
        // This is a simplified calculation - in practice, you'd need to fetch the actual UTXO values
        return sum + 100000;
      }, 0);

      if (totalInputValue > totalOutputValue + fee) {
        const changeAddress = this.getAddressFromPrivateKey(privateKey);
        const changeValue = totalInputValue - totalOutputValue - fee;
        psbt.addOutput({
          address: changeAddress,
          value: changeValue,
        });
      }

      // Sign inputs
      const keyPair = ECPair.fromWIF(privateKey, this.network);
      for (let i = 0; i < request.inputs.length; i++) {
        psbt.signInput(i, keyPair as any);
      }

      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      const hex = tx.toHex();
      const txid = tx.getId();

      return {
        hex,
        txid,
        fee,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to create transaction');
    }
  }

  /**
   * Create new Bitcoin wallet
   */
  public createWallet(): BitcoinWalletInfo {
    try {
      const mnemonic = bip39.generateMnemonic();
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const root = bip32.BIP32Factory(ecc).fromSeed(seed, this.network);
      const child = root.derivePath("m/84'/0'/0'/0/0"); // BIP84 path for native segwit

      const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey!), {
        network: this.network,
      });
      const address = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: this.network,
      }).address!;

      return {
        address,
        privateKey: keyPair.toWIF(),
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        wif: keyPair.toWIF(),
        mnemonic,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to create wallet');
    }
  }

  /**
   * Import wallet from mnemonic
   */
  public importWalletFromMnemonic(mnemonic: string): BitcoinWalletInfo {
    try {
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic');
      }

      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const root = bip32.BIP32Factory(ecc).fromSeed(seed, this.network);
      const child = root.derivePath("m/84'/0'/0'/0/0");

      const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey!), {
        network: this.network,
      });
      const address = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: this.network,
      }).address!;

      return {
        address,
        privateKey: keyPair.toWIF(),
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        wif: keyPair.toWIF(),
        mnemonic,
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to import wallet');
    }
  }

  /**
   * Import wallet from private key
   */
  public importWalletFromPrivateKey(privateKey: string): BitcoinWalletInfo {
    try {
      const keyPair = ECPair.fromWIF(privateKey, this.network);
      const address = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: this.network,
      }).address!;

      return {
        address,
        privateKey: keyPair.toWIF(),
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        wif: keyPair.toWIF(),
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to import wallet');
    }
  }

  /**
   * Validate Bitcoin address
   */
  public isValidAddress(address: string): boolean {
    try {
      bitcoin.address.toOutputScript(address, this.network);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get swap destination tokens
   */
  public async getDestinationTokens(
    sourceChain: string,
    sourceToken: string
  ): Promise<any[]> {
    try {
      return await this.makeRequest<any[]>(
        `/v1/swaps/destination-tokens?sourceChain=${sourceChain}&sourceToken=${sourceToken}`
      );
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch destination tokens');
    }
  }

  /**
   * Get swap quotes
   */
  public async getSwapQuotes(
    inputToken: string,
    outputToken: string,
    inputAmount: string,
    inputChain: string,
    outputChain: string
  ): Promise<SwapQuote[]> {
    try {
      return await this.makeRequest<SwapQuote[]>('/v1/swaps/quotes', {
        method: 'POST',
        body: JSON.stringify({
          input_token: inputToken,
          output_token: outputToken,
          input_amount: inputAmount,
          input_chain: inputChain,
          output_chain: outputChain,
        }),
      });
    } catch (error) {
      throw this.handleError(error, 'Failed to fetch swap quotes');
    }
  }

  /**
   * Place swap order
   */
  public async placeSwapOrder(orderData: any): Promise<SwapOrder> {
    try {
      return await this.makeRequest<SwapOrder>('/v1/swaps/order', {
        method: 'POST',
        body: JSON.stringify(orderData),
      });
    } catch (error) {
      throw this.handleError(error, 'Failed to place swap order');
    }
  }

  /**
   * Execute swap order
   */
  public async executeSwapOrder(
    orderId: string,
    signature: string
  ): Promise<any> {
    try {
      return await this.makeRequest<any>(`/v1/swaps/order/${orderId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ signature }),
      });
    } catch (error) {
      throw this.handleError(error, 'Failed to execute swap order');
    }
  }

  /**
   * Convert XVerse transaction to Bitcoin transaction format
   */
  private convertXVerseTransactionToBitcoinTransaction(
    tx: XVerseTransactionResponse
  ): BitcoinTransaction {
    return {
      txid: tx.txid || tx.hash,
      hash: tx.hash || tx.txid,
      version: tx.version || 1,
      size: tx.size || 0,
      vsize: tx.vsize || tx.size || 0,
      weight: tx.weight || 0,
      locktime: tx.locktime || 0,
      vin: tx.vin || [],
      vout: tx.vout || [],
      hex: tx.hex || '',
      blockhash: tx.blockhash,
      confirmations: tx.confirmations,
      time: tx.time,
      blocktime: tx.blocktime,
    };
  }

  /**
   * Get address from private key
   */
  private getAddressFromPrivateKey(privateKey: string): string {
    const keyPair = ECPair.fromWIF(privateKey, this.network);
    return bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: this.network,
    }).address!;
  }

  /**
   * Get address from mnemonic
   */
  public getAddressFromMnemonic(
    mnemonic: string,
    derivationPath: string = "m/84'/0'/0'/0/0"
  ): string {
    try {
      const walletInfo = this.importWalletFromMnemonic(mnemonic);
      return walletInfo.address;
    } catch (error) {
      throw this.handleError(error, 'Failed to get address from mnemonic');
    }
  }
  /**
   * Get address activity (confirmed transactions)
   */
  public async getAddressActivity(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/bitcoin/address/${address}/activity?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get address activity');
    }
  }

  /**
   * Get mempool activity (unconfirmed transactions)
   */
  public async getAddressMempoolActivity(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/bitcoin/address/${address}/activity/mempool?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get mempool activity');
    }
  }

  /**
   * Get unconfirmed transactions
   */
  public async getAddressUnconfirmedTransactions(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/bitcoin/address/${address}/activity/unconfirmed?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get unconfirmed transactions');
    }
  }

  /**
   * Get raw transaction hex
   */
  public async getRawTransactionHex(txid: string): Promise<string> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<{ hex: string }>(
        `/v1/bitcoin/transactions/${txid}/hex`
      );
      return response.hex;
    } catch (error) {
      throw this.handleError(error, 'Failed to get raw transaction hex');
    }
  }

  /**
   * Get ordinal transaction outputs
   */
  public async getOrdinalTransactionOutputs(txid: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/bitcoin/transactions/${txid}/ordinals`
      );
      return response;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get ordinal transaction outputs'
      );
    }
  }
  /**
   * Get Ordinals by address
   */
  public async getOrdinalsByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/ordinals/address/${address}/inscriptions?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ordinals by address');
    }
  }

  /**
   * Get Ordinal collections by address
   */
  public async getOrdinalCollectionsByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/ordinals/address/${address}/collections?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get Ordinal collections by address'
      );
    }
  }

  /**
   * Get Ordinal by ID
   */
  public async getOrdinalById(inscriptionId: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/ordinals/inscriptions/${inscriptionId}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ordinal by ID');
    }
  }

  /**
   * Get top Ordinal collections
   */
  public async getTopOrdinalCollections(
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/ordinals/collections/top?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get top Ordinal collections');
    }
  }
  /**
   * Get Runes by address (v1)
   */
  public async getRunesByAddressV1(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/address/${address}/balances?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Runes by address (v1)');
    }
  }

  /**
   * Get Runes by address (v2)
   */
  public async getRunesByAddressV2(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/address/${address}/balances/v2?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Runes by address (v2)');
    }
  }

  /**
   * Get Rune by ID
   */
  public async getRuneById(runeId: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/${runeId}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Rune by ID');
    }
  }

  /**
   * Search Runes
   */
  public async searchRunes(
    query: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to search Runes');
    }
  }

  /**
   * Get top Runes by volume
   */
  public async getTopRunesByVolume(
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/top/volume?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get top Runes by volume');
    }
  }

  /**
   * Get Runes top gainers and losers
   */
  public async getRunesTopGainersLosers(
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/runes/top/gainers-losers?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get Runes top gainers and losers'
      );
    }
  }
  /**
   * Get BRC-20 balances by address
   */
  public async getBRC20BalancesByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/brc20/address/${address}/balances?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get BRC-20 balances by address');
    }
  }

  /**
   * Get BRC-20 transaction history by address
   */
  public async getBRC20TransactionHistoryByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/brc20/address/${address}/transactions?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get BRC-20 transaction history by address'
      );
    }
  }

  /**
   * Get BRC-20 by ticker
   */
  public async getBRC20ByTicker(ticker: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/brc20/ticker/${ticker}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get BRC-20 by ticker');
    }
  }
  /**
   * Get Spark balances by address
   */
  public async getSparkBalancesByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/spark/address/${address}/balances?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Spark balances by address');
    }
  }

  /**
   * Get Spark transaction history by address
   */
  public async getSparkTransactionHistoryByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        `/v1/global/spark/address/${address}/transactions?limit=${limit}&offset=${offset}`
      );
      return response;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get Spark transaction history by address'
      );
    }
  }

  /**
   * Get mempool fees
   */
  public async getMempoolFees(): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(
        '/v1/bitcoin/node/mempool/fees'
      );
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get mempool fees');
    }
  }

  /**
   * Get address from mnemonic
   */
  public getAddressFromMnemonic(mnemonic: string, derivationPath: string = "m/84'/0'/0'/0/0"): string {
    try {
      const walletInfo = this.importWalletFromMnemonic(mnemonic);
      return walletInfo.address;
    } catch (error) {
      throw this.handleError(error, 'Failed to get address from mnemonic');
    }
  }
  /**
   * Get address activity (confirmed transactions)
   */
  public async getAddressActivity(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/bitcoin/address/${address}/activity?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get address activity');
    }
  }

  /**
   * Get mempool activity (unconfirmed transactions)
   */
  public async getAddressMempoolActivity(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/bitcoin/address/${address}/activity/mempool?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get mempool activity');
    }
  }

  /**
   * Get unconfirmed transactions
   */
  public async getAddressUnconfirmedTransactions(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/bitcoin/address/${address}/activity/unconfirmed?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get unconfirmed transactions');
    }
  }

  /**
   * Get raw transaction hex
   */
  public async getRawTransactionHex(txid: string): Promise<string> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<{ hex: string }>(`/v1/bitcoin/transactions/${txid}/hex`);
      return response.hex;
    } catch (error) {
      throw this.handleError(error, 'Failed to get raw transaction hex');
    }
  }

  /**
   * Get ordinal transaction outputs
   */
  public async getOrdinalTransactionOutputs(txid: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/bitcoin/transactions/${txid}/ordinals`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get ordinal transaction outputs');
    }
  }
  /**
   * Get Ordinals by address
   */
  public async getOrdinalsByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/ordinals/address/${address}/inscriptions?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ordinals by address');
    }
  }

  /**
   * Get Ordinal collections by address
   */
  public async getOrdinalCollectionsByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/ordinals/address/${address}/collections?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ordinal collections by address');
    }
  }

  /**
   * Get Ordinal by ID
   */
  public async getOrdinalById(inscriptionId: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/ordinals/inscriptions/${inscriptionId}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Ordinal by ID');
    }
  }

  /**
   * Get top Ordinal collections
   */
  public async getTopOrdinalCollections(limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/ordinals/collections/top?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get top Ordinal collections');
    }
  }
  /**
   * Get Runes by address (v1)
   */
  public async getRunesByAddressV1(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/address/${address}/balances?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Runes by address (v1)');
    }
  }

  /**
   * Get Runes by address (v2)
   */
  public async getRunesByAddressV2(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/address/${address}/balances/v2?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Runes by address (v2)');
    }
  }

  /**
   * Get Rune by ID
   */
  public async getRuneById(runeId: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/${runeId}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Rune by ID');
    }
  }

  /**
   * Search Runes
   */
  public async searchRunes(query: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to search Runes');
    }
  }

  /**
   * Get top Runes by volume
   */
  public async getTopRunesByVolume(limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/top/volume?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get top Runes by volume');
    }
  }

  /**
   * Get Runes top gainers and losers
   */
  public async getRunesTopGainersLosers(limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/runes/top/gainers-losers?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Runes top gainers and losers');
    }
  }
  /**
   * Get BRC-20 balances by address
   */
  public async getBRC20BalancesByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/brc20/address/${address}/balances?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get BRC-20 balances by address');
    }
  }

  /**
   * Get BRC-20 transaction history by address
   */
  public async getBRC20TransactionHistoryByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/brc20/address/${address}/transactions?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get BRC-20 transaction history by address');
    }
  }

  /**
   * Get BRC-20 by ticker
   */
  public async getBRC20ByTicker(ticker: string): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/brc20/ticker/${ticker}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get BRC-20 by ticker');
    }
  }
  /**
   * Get Spark balances by address
   */
  public async getSparkBalancesByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/spark/address/${address}/balances?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Spark balances by address');
    }
  }

  /**
   * Get Spark transaction history by address
   */
  public async getSparkTransactionHistoryByAddress(address: string, limit: number = 50, offset: number = 0): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>(`/v1/global/spark/address/${address}/transactions?limit=${limit}&offset=${offset}`);
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get Spark transaction history by address');
    }
  }

  /**
   * Get mempool fees
   */
  public async getMempoolFees(): Promise<any> {
    try {
      await this.rateLimit();
      const response = await this.makeRequest<any>('/v1/bitcoin/node/mempool/fees');
      return response;
    } catch (error) {
      throw this.handleError(error, 'Failed to get mempool fees');
    }
  }

}

export const xverseService = new XVerseService();
