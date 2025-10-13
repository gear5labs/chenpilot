import { BaseTool } from './base/BaseTool';
import { ToolMetadata, ToolResult } from '../registry/ToolMetadata';
import { container } from 'tsyringe';
import { xverseService } from '../../services/XVerseService';

interface XversePayload extends Record<string, unknown> {
  operation: string;
  address?: string;
  amount?: number;
  toAddress?: string;
  asset?: string;
  ticker?: string;
  inscriptionId?: string;
  runeId?: string;
  query?: string;
  height?: number;
}

export class XverseTool extends BaseTool<XversePayload> {
  metadata: ToolMetadata = {
    name: 'xverse_tool',
    description:
      'Bitcoin wallet operations via Xverse - balance, transactions, Ordinals, Runes, and BRC-20 tokens',
    parameters: {
      operation: {
        type: 'string',
        description: 'The Bitcoin operation to perform',
        required: true,
        enum: [
          'get_balance',
          'get_transactions',
          'get_utxos',
          'get_price',
          'send_bitcoin',
          'create_wallet',
          'validate_address',
          'get_ordinals',
          'get_ordinal_by_id',
          'get_ordinal_collections',
          'get_top_ordinals',
          'get_runes',
          'get_rune_by_id',
          'search_runes',
          'get_top_runes',
          'get_rune_gainers_losers',
          'get_brc20_balances',
          'get_brc20_history',
          'get_brc20_by_ticker',
          'get_spark_balances',
          'get_mempool_fees',
          'get_current_block',
          'get_block_by_height',
        ],
      },
      address: {
        type: 'string',
        description: 'Bitcoin address for operations',
        required: false,
      },
      amount: {
        type: 'number',
        description: 'Amount for transactions',
        required: false,
      },
      toAddress: {
        type: 'string',
        description: 'Recipient address for transactions',
        required: false,
      },
      asset: {
        type: 'string',
        description: 'Asset type (BTC, etc.)',
        required: false,
      },
      ticker: {
        type: 'string',
        description: 'Token ticker for BRC-20 operations',
        required: false,
      },
      inscriptionId: {
        type: 'string',
        description: 'Ordinal inscription ID',
        required: false,
      },
      runeId: {
        type: 'string',
        description: 'Rune ID for Rune operations',
        required: false,
      },
      query: {
        type: 'string',
        description: 'Search query for Runes',
        required: false,
      },
      height: {
        type: 'number',
        description: 'Block height for block operations',
        required: false,
      },
    },
    examples: [
      'Check my Bitcoin balance',
      'Show my Bitcoin transactions',
      'Get Bitcoin price',
      'Show my Ordinals',
      'Show my Runes',
      'Get BRC-20 token balances',
      'Search for DOG Rune',
      'Get Bitcoin network fees',
    ],
    category: 'bitcoin',
    version: '1.0.0',
  };

  private xverseService = xverseService;

  async execute(payload: XversePayload, userId: string): Promise<ToolResult> {
    const { operation } = payload;

    try {
      switch (operation) {
        case 'get_balance':
          return await this.getBalance(payload);
        case 'get_transactions':
          return await this.getTransactions(payload);
        case 'get_utxos':
          return await this.getUTXOs(payload);
        case 'get_price':
          return await this.getPrice();
        case 'send_bitcoin':
          return await this.sendBitcoin(payload);
        case 'create_wallet':
          return await this.createWallet();
        case 'validate_address':
          return await this.validateAddress(payload);
        case 'get_ordinals':
          return await this.getOrdinals(payload);
        case 'get_ordinal_by_id':
          return await this.getOrdinalById(payload);
        case 'get_ordinal_collections':
          return await this.getOrdinalCollections(payload);
        case 'get_top_ordinals':
          return await this.getTopOrdinals();
        case 'get_runes':
          return await this.getRunes(payload);
        case 'get_rune_by_id':
          return await this.getRuneById(payload);
        case 'search_runes':
          return await this.searchRunes(payload);
        case 'get_top_runes':
          return await this.getTopRunes();
        case 'get_rune_gainers_losers':
          return await this.getRuneGainersLosers();
        case 'get_brc20_balances':
          return await this.getBRC20Balances(payload);
        case 'get_brc20_history':
          return await this.getBRC20History(payload);
        case 'get_brc20_by_ticker':
          return await this.getBRC20ByTicker(payload);
        case 'get_spark_balances':
          return await this.getSparkBalances(payload);
        case 'get_mempool_fees':
          return await this.getMempoolFees();
        case 'get_current_block':
          return await this.getCurrentBlock();
        case 'get_block_by_height':
          return await this.getBlockByHeight(payload);
        default:
          return this.createErrorResult(
            'xverse_operation',
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult(
        'xverse_error',
        `Xverse operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getBalance(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_balance',
        'Address is required for balance check'
      );
    }

    try {
      const balance = await this.xverseService.getAddressBalance(
        payload.address
      );
      return this.createSuccessResult('xverse_balance', {
        address: payload.address,
        balance: balance,
        message: `Bitcoin balance for ${payload.address}: ${(balance.total / 100000000).toFixed(8)} BTC`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_balance',
        `Failed to get balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getTransactions(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_transactions',
        'Address is required for transaction history'
      );
    }

    try {
      const transactions = await this.xverseService.getAddressTransactions(
        payload.address
      );
      return this.createSuccessResult('xverse_transactions', {
        address: payload.address,
        transactions: transactions,
        message: `Found ${transactions.length} transactions for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_transactions',
        `Failed to get transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getUTXOs(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_utxos',
        'Address is required for UTXO check'
      );
    }

    try {
      const utxos = await this.xverseService.getAddressUTXOs(payload.address);
      return this.createSuccessResult('xverse_utxos', {
        address: payload.address,
        utxos: utxos,
        message: `Found ${utxos.length} UTXOs for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_utxos',
        `Failed to get UTXOs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getPrice(): Promise<ToolResult> {
    try {
      const price = await this.xverseService.getBitcoinPrice();
      return this.createSuccessResult('xverse_price', {
        price: price,
        message: `Current Bitcoin price: $${price.usd.toLocaleString()}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_price',
        `Failed to get Bitcoin price: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async sendBitcoin(payload: XversePayload): Promise<ToolResult> {
    if (!payload.toAddress || !payload.amount) {
      return this.createErrorResult(
        'xverse_send',
        'Recipient address and amount are required'
      );
    }

    try {
      // Note: This would require private key for actual signing
      // For now, return instructions
      return this.createSuccessResult('xverse_send', {
        toAddress: payload.toAddress,
        amount: payload.amount,
        message: `Ready to send ${payload.amount} BTC to ${payload.toAddress}. Private key required for signing.`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_send',
        `Failed to prepare Bitcoin transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async createWallet(): Promise<ToolResult> {
    try {
      const wallet = await this.xverseService.createWallet();
      return this.createSuccessResult('xverse_wallet', {
        wallet: wallet,
        message: 'New Bitcoin wallet created successfully',
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_wallet',
        `Failed to create wallet: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async validateAddress(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_validate',
        'Address is required for validation'
      );
    }

    try {
      const isValid = this.xverseService.isValidAddress(payload.address);
      return this.createSuccessResult('xverse_validate', {
        address: payload.address,
        isValid: isValid,
        message: `Address ${payload.address} is ${isValid ? 'valid' : 'invalid'}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_validate',
        `Failed to validate address: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getOrdinals(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_ordinals',
        'Address is required for Ordinals check'
      );
    }

    try {
      const ordinals = await this.xverseService.getOrdinalsByAddress(
        payload.address
      );
      return this.createSuccessResult('xverse_ordinals', {
        address: payload.address,
        ordinals: ordinals,
        message: `Found ${ordinals.total || 0} Ordinals for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_ordinals',
        `Failed to get Ordinals: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getOrdinalById(payload: XversePayload): Promise<ToolResult> {
    if (!payload.inscriptionId) {
      return this.createErrorResult(
        'xverse_ordinal',
        'Inscription ID is required'
      );
    }

    try {
      const ordinal = await this.xverseService.getOrdinalById(
        payload.inscriptionId
      );
      return this.createSuccessResult('xverse_ordinal', {
        ordinal: ordinal,
        message: `Ordinal details for ${payload.inscriptionId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_ordinal',
        `Failed to get Ordinal: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getOrdinalCollections(
    payload: XversePayload
  ): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_collections',
        'Address is required for collections check'
      );
    }

    try {
      const collections =
        await this.xverseService.getOrdinalCollectionsByAddress(
          payload.address
        );
      return this.createSuccessResult('xverse_collections', {
        address: payload.address,
        collections: collections,
        message: `Found ${collections.total || 0} Ordinal collections for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_collections',
        `Failed to get collections: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getTopOrdinals(): Promise<ToolResult> {
    try {
      const topOrdinals = await this.xverseService.getTopOrdinalCollections();
      return this.createSuccessResult('xverse_top_ordinals', {
        topOrdinals: topOrdinals,
        message: `Top Ordinal collections retrieved`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_top_ordinals',
        `Failed to get top Ordinals: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getRunes(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_runes',
        'Address is required for Runes check'
      );
    }

    try {
      const runes = await this.xverseService.getRunesByAddressV2(
        payload.address
      );
      return this.createSuccessResult('xverse_runes', {
        address: payload.address,
        runes: runes,
        message: `Found ${runes.total || 0} Runes for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_runes',
        `Failed to get Runes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getRuneById(payload: XversePayload): Promise<ToolResult> {
    if (!payload.runeId) {
      return this.createErrorResult('xverse_rune', 'Rune ID is required');
    }

    try {
      const rune = await this.xverseService.getRuneById(payload.runeId);
      return this.createSuccessResult('xverse_rune', {
        rune: rune,
        message: `Rune details for ${payload.runeId}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_rune',
        `Failed to get Rune: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async searchRunes(payload: XversePayload): Promise<ToolResult> {
    if (!payload.query) {
      return this.createErrorResult(
        'xverse_search',
        'Search query is required'
      );
    }

    try {
      const runes = await this.xverseService.searchRunes(payload.query);
      return this.createSuccessResult('xverse_search', {
        query: payload.query,
        runes: runes,
        message: `Found ${runes.total || 0} Runes matching "${payload.query}"`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_search',
        `Failed to search Runes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getTopRunes(): Promise<ToolResult> {
    try {
      const topRunes = await this.xverseService.getTopRunesByVolume();
      return this.createSuccessResult('xverse_top_runes', {
        topRunes: topRunes,
        message: `Top Runes by volume retrieved`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_top_runes',
        `Failed to get top Runes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getRuneGainersLosers(): Promise<ToolResult> {
    try {
      const gainersLosers = await this.xverseService.getRunesTopGainersLosers();
      return this.createSuccessResult('xverse_gainers_losers', {
        gainersLosers: gainersLosers,
        message: `Rune gainers and losers retrieved`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_gainers_losers',
        `Failed to get gainers/losers: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getBRC20Balances(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_brc20',
        'Address is required for BRC-20 balances'
      );
    }

    try {
      const balances = await this.xverseService.getBRC20BalancesByAddress(
        payload.address
      );
      return this.createSuccessResult('xverse_brc20', {
        address: payload.address,
        balances: balances,
        message: `Found ${balances.total || 0} BRC-20 tokens for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_brc20',
        `Failed to get BRC-20 balances: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getBRC20History(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_brc20_history',
        'Address is required for BRC-20 history'
      );
    }

    try {
      const history =
        await this.xverseService.getBRC20TransactionHistoryByAddress(
          payload.address
        );
      return this.createSuccessResult('xverse_brc20_history', {
        address: payload.address,
        history: history,
        message: `Found ${history.total || 0} BRC-20 transactions for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_brc20_history',
        `Failed to get BRC-20 history: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getBRC20ByTicker(payload: XversePayload): Promise<ToolResult> {
    if (!payload.ticker) {
      return this.createErrorResult(
        'xverse_brc20_ticker',
        'Ticker is required for BRC-20 token'
      );
    }

    try {
      const token = await this.xverseService.getBRC20ByTicker(payload.ticker);
      return this.createSuccessResult('xverse_brc20_ticker', {
        ticker: payload.ticker,
        token: token,
        message: `BRC-20 token details for ${payload.ticker}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_brc20_ticker',
        `Failed to get BRC-20 token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getSparkBalances(payload: XversePayload): Promise<ToolResult> {
    if (!payload.address) {
      return this.createErrorResult(
        'xverse_spark',
        'Address is required for Spark balances'
      );
    }

    try {
      const balances = await this.xverseService.getSparkBalancesByAddress(
        payload.address
      );
      return this.createSuccessResult('xverse_spark', {
        address: payload.address,
        balances: balances,
        message: `Found ${balances.total || 0} Spark tokens for ${payload.address}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_spark',
        `Failed to get Spark balances: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getMempoolFees(): Promise<ToolResult> {
    try {
      const fees = await this.xverseService.getMempoolFees();
      return this.createSuccessResult('xverse_fees', {
        fees: fees,
        message: `Bitcoin network fees retrieved`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_fees',
        `Failed to get network fees: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getCurrentBlock(): Promise<ToolResult> {
    try {
      const block = await this.xverseService.getCurrentBlock();
      return this.createSuccessResult('xverse_current_block', {
        block: block,
        message: `Current Bitcoin block: ${block.height}`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_current_block',
        `Failed to get current block: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getBlockByHeight(payload: XversePayload): Promise<ToolResult> {
    if (!payload.height) {
      return this.createErrorResult('xverse_block', 'Block height is required');
    }

    try {
      const block = await this.xverseService.getBlockByHeight(payload.height);
      return this.createSuccessResult('xverse_block', {
        height: payload.height,
        block: block,
        message: `Bitcoin block ${payload.height} retrieved`,
      });
    } catch (error) {
      return this.createErrorResult(
        'xverse_block',
        `Failed to get block: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

export const xverseTool = new XverseTool();
