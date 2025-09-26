import { injectable } from "tsyringe";
import { Account, CallData, RpcProvider, ec, stark, hash, Signer, Contract } from "starknet";

export interface StarknetAccountData {
  privateKey: string;
  publicKey: string;
  addressSalt: string;
  constructorCalldata: string[];
  precalculatedAddress: string;
  deployed: boolean;
  transactionHash?: string;
  contractAddress?: string;
}

@injectable()
export class StarknetService {
  private readonly provider: RpcProvider;
  private readonly OZAccountClassHash: string;

  constructor() {
    // Use environment variables for configuration
    const nodeUrl = process.env.STARKNET_NODE_URL || 'https://docs-demo.strk-sepolia.quiknode.pro/rpc/v0_7';
    this.provider = new RpcProvider({ nodeUrl });
    
    // OpenZeppelin Account class hash for Sepolia
    this.OZAccountClassHash = process.env.STARKNET_ACCOUNT_CLASS_HASH || '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f';
  }

  /**
   * Validates and formats a Starknet address
   */
  private formatAddress(address: string): string {
    if (!address) {
      throw new Error('Address cannot be empty');
    }
  
    const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
    
    // Pad with zeros to ensure 64 hex characters
    const paddedAddress = cleanAddress.padStart(64, '0');
    
    // Add 0x prefix
    const formattedAddress = `0x${paddedAddress}`;
    
    // Validate length (66 characters including 0x)
    if (formattedAddress.length !== 66) {
      throw new Error(`Invalid Starknet address length: ${formattedAddress.length}, expected 66 characters (including 0x prefix)`);
    }
    
    // Validate hex format
    if (!/^0x[0-9a-fA-F]{64}$/.test(formattedAddress)) {
      throw new Error('Invalid Starknet address format: must be 64 hex characters after 0x prefix');
    }
    
    return formattedAddress.toLowerCase();
  }

  /**
   * Creates a new Starknet account with precalculated address
   */
  async createAccount(): Promise<StarknetAccountData> {
    try {
      // Generate private key (64 hex characters)
      const privateKey = stark.randomAddress();
      
      // Ensure private key is properly formatted (66 characters)
      const formattedPrivateKey = this.formatAddress(privateKey);
      
      // Generate public key
      const publicKey = ec.starkCurve.getStarkKey(formattedPrivateKey);
      
      // Prepare constructor calldata - OpenZeppelin account expects publicKey as direct parameter
      const constructorCalldata = [publicKey];
      
      // Generate address salt (64 hex characters)
      const addressSalt = stark.randomAddress();
      const formattedAddressSalt = this.formatAddress(addressSalt);
      
      // Calculate precalculated address
      const precalculatedAddress = hash.calculateContractAddressFromHash(
        formattedAddressSalt,
        this.OZAccountClassHash,
        constructorCalldata,
        0
      );

      // Ensure the address is properly formatted (66 characters including 0x)
      const formattedAddress = this.formatAddress(precalculatedAddress);

      return {
        privateKey: formattedPrivateKey,
        publicKey,
        addressSalt: formattedAddressSalt,
        constructorCalldata,
        precalculatedAddress: formattedAddress,
        deployed: false,
      };
    } catch (error) {
      throw new Error(`Failed to create Starknet account: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Deploys a Starknet account to the network
   */
  async deployAccount(accountData: StarknetAccountData): Promise<{ transactionHash: string; contractAddress: string }> {
    try {
      if (accountData.deployed) {
        throw new Error('Account is already deployed');
      }

      // Check if account is already deployed
      const isDeployed = await this.isAccountDeployed(accountData.precalculatedAddress);
      if (isDeployed) {
        return {
          transactionHash: 'already-deployed',
          contractAddress: accountData.precalculatedAddress,
        };
      }

      // Create signer and account
      const signer = new Signer(accountData.privateKey);
      const account = new Account(
        this.provider, 
        accountData.precalculatedAddress, 
        signer, 
        '1', // chainId for Sepolia
        '0x3' // account version
      );

      // Check if account has sufficient balance for deployment
      const balance = await this.getAccountBalance(accountData.precalculatedAddress);
      const deploymentCost = await this.getDeploymentCost();
      
      if (BigInt(balance) < BigInt(deploymentCost)) {
        throw new Error(`Insufficient balance for deployment. Required: ${deploymentCost}, Available: ${balance}`);
      }

      console.log(`Deploying account ${accountData.precalculatedAddress} with balance: ${balance}`);

      // Deploy the account
      const { transaction_hash, contract_address } = await account.deployAccount({
        classHash: this.OZAccountClassHash,
        constructorCalldata: accountData.constructorCalldata,
        addressSalt: accountData.addressSalt,
      });

      console.log(`Deployment transaction submitted: ${transaction_hash}`);

      // Wait for transaction confirmation
      await this.provider.waitForTransaction(transaction_hash);

      console.log(`Account deployed successfully: ${contract_address}`);

      return {
        transactionHash: transaction_hash,
        contractAddress: contract_address,
      };
    } catch (error) {
      console.error('Deployment error:', error);
      throw new Error(`Failed to deploy Starknet account: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets account balance (ERC20 token, e.g., STRK)
   */
  async getAccountBalance(address: string): Promise<string> {
    try {
      const formattedAddress = this.formatAddress(address);
      const erc20Address = process.env.STARKNET_ERC20_ADDRESS || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

      console.log(`Checking balance for address: ${formattedAddress}`);
      console.log(`Using ERC20 contract: ${erc20Address}`);

      // Get the contract class/ABI
      const contractClass = await this.provider.getClassAt(erc20Address);
      
      if (!contractClass) {
        throw new Error('Failed to fetch contract class');
      }
      
      // Create contract instance
      const contract = new Contract(contractClass.abi, erc20Address, this.provider);
      
      // Call balanceOf using the contract instance
      const balance = await contract.balanceOf(formattedAddress);
      
      console.log(`Balance query result:`, balance);
      
      if (balance) {
        // The balance is returned as a BigInt, convert to string
        return balance.toString();
      }
      
      return "0";
    } catch (error) {
      console.error(`Balance check failed for address ${address}:`, error);
      return "0";
    }
  }

  /**
   * Checks if an account is deployed
   */
  async isAccountDeployed(address: string): Promise<boolean> {
    try {
      const formattedAddress = this.formatAddress(address);
      const code = await this.provider.getClassHashAt(formattedAddress);
      return code !== '0x0';
    } catch (error) {
      return false;
    }
  }

  /**
   * Checks if an account has sufficient funding for deployment
   */
  async isAccountFunded(address: string, minimumBalance: string = "1000000000000000000"): Promise<boolean> {
    try {
      const balance = await this.getAccountBalance(address);
      return BigInt(balance) >= BigInt(minimumBalance);
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets the minimum balance required for account deployment
   */
  async getDeploymentCost(): Promise<string> {
    try {
      return "10000000000000000"; // 0.01 STRK in wei (18 decimals)
    } catch (error) {
      throw new Error(`Failed to get deployment cost: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Monitors account funding by polling balance
   */
  async monitorAccountFunding(
    address: string, 
    onFunded: (balance: string, transactionHash?: string) => Promise<void>,
    pollInterval: number = 30000, // 30 seconds
    timeout: number = 3600000 // 1 hour
  ): Promise<void> {
    const startTime = Date.now();
    const minimumBalance = await this.getDeploymentCost();

    const poll = async (): Promise<void> => {
      try {
        const isFunded = await this.isAccountFunded(address, minimumBalance);
        
        if (isFunded) {
          const balance = await this.getAccountBalance(address);
          await onFunded(balance);
          return;
        }

        // Check if timeout reached
        if (Date.now() - startTime > timeout) {
          throw new Error('Funding monitoring timeout reached');
        }

        // Continue polling
        setTimeout(poll, pollInterval);
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          throw error;
        }
        // Continue polling on other errors
        setTimeout(poll, pollInterval);
      }
    };

    await poll();
  }

  /**
   * Gets recent transactions for an address to detect funding
   */
  async getRecentTransactions(address: string, limit: number = 10): Promise<any[]> {
    try {
      return [];
    } catch (error) {
      throw new Error(`Failed to get recent transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets the native ETH balance of an account (simplified - returns 0 for now)
   */
  async getNativeBalance(address: string): Promise<string> {
    try {
      const formattedAddress = this.formatAddress(address);
      console.log(`Native balance check for ${formattedAddress}: 0 (not implemented)`);
      return "0";
    } catch (error) {
      console.error(`Failed to get native balance for ${address}:`, error);
      return "0";
    }
  }

  /**
   * Checks if an account has received any funding
   */
  async hasReceivedFunding(address: string): Promise<{ funded: boolean; balance: string; transactionHash?: string }> {
    try {
      const balance = await this.getAccountBalance(address);
      const funded = BigInt(balance) > BigInt(0);
      
      return {
        funded,
        balance,
        // In a real implementation, you'd track the funding transaction hash
        transactionHash: funded ? undefined : undefined
      };
    } catch (error) {
      return {
        funded: false,
        balance: "0"
      };
    }
  }
}
