import { injectable, inject } from 'tsyringe';
import { Account, RpcProvider, uint256, hash, Signer } from 'starknet';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { StarknetService } from './starknet.service';
import { WalletTool } from '../Agents/tools/wallet';
import AppDataSource from '../config/Datasource';

export interface AutoFundingConfig {
  fundedAccountPrivateKey: string;
  fundedAccountAddress: string;
  fundingAmount: string; // Amount to transfer to new accounts (in wei)
  tokenAddress: string; // ERC20 token address (e.g., STRK)
  maxFundingPerDay: number; // Maximum number of accounts to fund per day
  maxFundingAmount: string; // Maximum total amount to fund per day (in wei)
}

export interface FundingResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  amount: string;
  recipientAddress: string;
}

@injectable()
export class AutoFundingService {
  private readonly provider: RpcProvider;
  private readonly config: AutoFundingConfig;
  private dailyFundingCount: number = 0;
  private dailyFundingAmount: string = '0';
  private lastResetDate: string = new Date().toDateString();

  private userRepository: Repository<User>;

  constructor(
    @inject(StarknetService) private starknetService: StarknetService
  ) {
    this.userRepository = AppDataSource.getRepository(User);
    // Use environment variables for configuration
    const nodeUrl =
      process.env.STARKNET_NODE_URL ||
      'https://docs-demo.strk-sepolia.quiknode.pro/rpc/v0_7';
    this.provider = new RpcProvider({ nodeUrl });

    this.config = {
      fundedAccountPrivateKey: process.env.FUNDED_ACCOUNT_PRIVATE_KEY || '',
      fundedAccountAddress: process.env.FUNDED_ACCOUNT_ADDRESS || '',
      fundingAmount: process.env.FUNDING_AMOUNT || '100000000000000000', // 0.1 STRK
      tokenAddress:
        process.env.TOKEN_ADDRESS ||
        '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      maxFundingPerDay: parseInt(process.env.MAX_FUNDING_PER_DAY || '100'),
      maxFundingAmount:
        process.env.MAX_FUNDING_AMOUNT || '100000000000000000000', // 100 STRK
    };

    console.log('Auto-funding configuration:');
    console.log(
      `- Funded account address: ${this.config.fundedAccountAddress}`
    );
    console.log(`- Funding amount: ${this.config.fundingAmount}`);
    console.log(`- Token address: ${this.config.tokenAddress}`);
    console.log(`- Max funding per day: ${this.config.maxFundingPerDay}`);
    console.log(`- Max funding amount: ${this.config.maxFundingAmount}`);

    if (
      !this.config.fundedAccountPrivateKey ||
      !this.config.fundedAccountAddress
    ) {
      console.warn(
        '⚠️  Auto-funding service not configured: Missing funded account credentials'
      );
      console.warn(
        '   Please set FUNDED_ACCOUNT_PRIVATE_KEY and FUNDED_ACCOUNT_ADDRESS environment variables'
      );
      console.warn(
        '   Account creation will work but auto-funding will be disabled'
      );
    } else {
      console.log('✅ Auto-funding service configured successfully');
    }
  }

  /**
   * Check if auto-funding is available and within limits
   */
  private isAutoFundingAvailable(): boolean {
    if (
      !this.config.fundedAccountPrivateKey ||
      !this.config.fundedAccountAddress
    ) {
      return false;
    }

    // Reset daily counters if it's a new day
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyFundingCount = 0;
      this.dailyFundingAmount = '0';
      this.lastResetDate = today;
    }

    // Check daily limits
    if (this.dailyFundingCount >= this.config.maxFundingPerDay) {
      console.log('Daily funding limit reached (count)');
      return false;
    }

    if (
      BigInt(this.dailyFundingAmount) + BigInt(this.config.fundingAmount) >
      BigInt(this.config.maxFundingAmount)
    ) {
      console.log('Daily funding limit reached (amount)');
      return false;
    }

    return true;
  }

  /**
   * Get the funded account instance
   */
  private getFundedAccount(): Account {
    if (
      !this.config.fundedAccountPrivateKey ||
      !this.config.fundedAccountAddress
    ) {
      throw new Error('Funded account not configured');
    }

    return new Account(
      this.provider,
      this.config.fundedAccountAddress,
      this.config.fundedAccountPrivateKey
    );
  }

  /**
   * Check if the funded account has sufficient balance
   */
  async checkFundedAccountBalance(): Promise<{
    hasBalance: boolean;
    balance: string;
    required: string;
    nativeBalance: string;
  }> {
    try {
      console.log(
        `Checking balance for funded account: ${this.config.fundedAccountAddress}`
      );

      // Check ERC20 token balance (STRK)
      const balance = await this.starknetService.getAccountBalance(
        this.config.fundedAccountAddress
      );

      // Check native ETH balance
      const nativeBalance = await this.starknetService.getNativeBalance(
        this.config.fundedAccountAddress
      );

      const required = this.config.fundingAmount;

      console.log(
        `Funded account ERC20 balance: ${balance}, Required: ${required}`
      );
      console.log(`Funded account native balance: ${nativeBalance}`);

      return {
        hasBalance: BigInt(balance) >= BigInt(required),
        balance,
        required,
        nativeBalance,
      };
    } catch (error) {
      console.error('Failed to check funded account balance:', error);
      return {
        hasBalance: false,
        balance: '0',
        required: this.config.fundingAmount,
        nativeBalance: '0',
      };
    }
  }

  /**
   * Transfer funds from the funded account to a new account
   */
  async fundNewAccount(recipientAddress: string): Promise<FundingResult> {
    try {
      console.log(
        `Starting funding process for recipient: ${recipientAddress}`
      );
      console.log(`Funding amount: ${this.config.fundingAmount}`);
      console.log(
        `Funded account address: ${this.config.fundedAccountAddress}`
      );

      // Check if auto-funding is available
      if (!this.isAutoFundingAvailable()) {
        console.log('Auto-funding not available or daily limits reached');
        return {
          success: false,
          error: 'Auto-funding not available or daily limits reached',
          amount: this.config.fundingAmount,
          recipientAddress,
        };
      }

      // Check funded account balance
      console.log('Checking funded account balance...');
      const balanceCheck = await this.checkFundedAccountBalance();
      if (!balanceCheck.hasBalance) {
        const requiredStrk = (
          BigInt(balanceCheck.required) / BigInt(10 ** 18)
        ).toString();
        const availableStrk = (
          BigInt(balanceCheck.balance) / BigInt(10 ** 18)
        ).toString();
        console.log(
          `❌ Insufficient balance: Required ${requiredStrk} STRK (${balanceCheck.required} wei), Available ${availableStrk} STRK (${balanceCheck.balance} wei)`
        );
        return {
          success: false,
          error: `Insufficient balance in funded account. Required: ${balanceCheck.required}, Available: ${balanceCheck.balance}. Please fund the account with at least ${requiredStrk} STRK tokens.`,
          amount: this.config.fundingAmount,
          recipientAddress,
        };
      }

      // Use wallet tool to execute the transfer
      const transferPayload = {
        operation: 'transfer',
        to: recipientAddress,
        amount: parseFloat(this.config.fundingAmount) / Math.pow(10, 18), // Convert wei to STRK
        token: 'STRK',
      };

      // Execute transfer using wallet tool
      const walletTool = new WalletTool();
      const result = await walletTool.execute(
        transferPayload,
        'funded-account'
      );

      if (result.status === 'error') {
        throw new Error(result.error || 'Transfer failed');
      }

      const transaction_hash = result.data?.txHash as string;

      // Update daily counters
      this.dailyFundingCount++;
      this.dailyFundingAmount = (
        BigInt(this.dailyFundingAmount) + BigInt(this.config.fundingAmount)
      ).toString();

      console.log(
        `Successfully funded account ${recipientAddress} with ${this.config.fundingAmount} tokens. Transaction: ${transaction_hash}`
      );

      return {
        success: true,
        transactionHash: transaction_hash,
        amount: this.config.fundingAmount,
        recipientAddress,
      };
    } catch (error) {
      console.error(`Failed to fund account ${recipientAddress}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        amount: this.config.fundingAmount,
        recipientAddress,
      };
    }
  }

  /**
   * Automatically fund a newly created account
   */
  async autoFundNewAccount(userId: string): Promise<FundingResult> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user || !user.address) {
        return {
          success: false,
          error: 'User or account address not found',
          amount: this.config.fundingAmount,
          recipientAddress: '',
        };
      }

      // Check if account is already funded
      if (user.isFunded) {
        return {
          success: false,
          error: 'Account is already funded',
          amount: this.config.fundingAmount,
          recipientAddress: user.address,
        };
      }

      // Fund the account
      const result = await this.fundNewAccount(user.address);

      if (result.success) {
        // Update user funding status
        await this.userRepository.update(userId, {
          isFunded: true,
          fundedAt: new Date(),
          fundingTransactionHash: result.transactionHash,
        });

        console.log(`Auto-funded user ${userId} account ${user.address}`);
      }

      return result;
    } catch (error) {
      console.error(`Auto-funding failed for user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        amount: this.config.fundingAmount,
        recipientAddress: '',
      };
    }
  }

  /**
   * Get auto-funding statistics
   */
  getAutoFundingStats(): {
    isConfigured: boolean;
    dailyFundingCount: number;
    dailyFundingAmount: string;
    maxFundingPerDay: number;
    maxFundingAmount: string;
    fundingAmount: string;
    lastResetDate: string;
  } {
    return {
      isConfigured: !!(
        this.config.fundedAccountPrivateKey && this.config.fundedAccountAddress
      ),
      dailyFundingCount: this.dailyFundingCount,
      dailyFundingAmount: this.dailyFundingAmount,
      maxFundingPerDay: this.config.maxFundingPerDay,
      maxFundingAmount: this.config.maxFundingAmount,
      fundingAmount: this.config.fundingAmount,
      lastResetDate: this.lastResetDate,
    };
  }

  /**
   * Get detailed funding configuration status
   */
  async getFundingConfigurationStatus(): Promise<{
    isConfigured: boolean;
    hasCredentials: boolean;
    hasBalance: boolean;
    balance: string;
    required: string;
    balanceInStrk: string;
    requiredInStrk: string;
    fundingAmount: string;
    fundingAmountInStrk: string;
    fundedAccountAddress: string;
    tokenAddress: string;
    errors: string[];
  }> {
    const errors: string[] = [];
    const hasCredentials = !!(
      this.config.fundedAccountPrivateKey && this.config.fundedAccountAddress
    );

    if (!hasCredentials) {
      errors.push(
        'Missing FUNDED_ACCOUNT_PRIVATE_KEY or FUNDED_ACCOUNT_ADDRESS environment variables'
      );
    }

    let balance = '0';
    let hasBalance = false;

    if (hasCredentials) {
      try {
        const balanceCheck = await this.checkFundedAccountBalance();
        balance = balanceCheck.balance;
        hasBalance = balanceCheck.hasBalance;
      } catch (error) {
        errors.push(
          `Failed to check balance: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const balanceInStrk = (BigInt(balance) / BigInt(10 ** 18)).toString();
    const requiredInStrk = (
      BigInt(this.config.fundingAmount) / BigInt(10 ** 18)
    ).toString();
    const fundingAmountInStrk = (
      BigInt(this.config.fundingAmount) / BigInt(10 ** 18)
    ).toString();

    return {
      isConfigured: hasCredentials && hasBalance,
      hasCredentials,
      hasBalance,
      balance,
      required: this.config.fundingAmount,
      balanceInStrk,
      requiredInStrk,
      fundingAmount: this.config.fundingAmount,
      fundingAmountInStrk,
      fundedAccountAddress: this.config.fundedAccountAddress,
      tokenAddress: this.config.tokenAddress,
      errors,
    };
  }

  /**
   * Manually fund multiple accounts (for batch operations)
   */
  async batchFundAccounts(
    recipientAddresses: string[]
  ): Promise<FundingResult[]> {
    const results: FundingResult[] = [];

    for (const address of recipientAddresses) {
      const result = await this.fundNewAccount(address);
      results.push(result);

      // Add small delay between transactions to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }
}
