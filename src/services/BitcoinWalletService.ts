export interface BitcoinWalletData {
  userId: string;
  address: string;
  network: "testnet" | "mainnet";
  createdAt: Date;
  lastUsed: Date;
}

export interface BitcoinWalletService {
  /**
   * Get or generate a Bitcoin address for a user
   * @param userId - The user ID
   * @returns Promise<BitcoinWalletData> - User's Bitcoin wallet data
   */
  getBitcoinAddress(userId: string): Promise<BitcoinWalletData>;

  /**
   * Check if user has a Bitcoin address
   * @param userId - The user ID
   * @returns Promise<boolean> - Whether user has a Bitcoin address
   */
  hasBitcoinAddress(userId: string): Promise<boolean>;

  /**
   * Validate Bitcoin address format
   * @param address - The Bitcoin address to validate
   * @returns boolean - Whether the address is valid
   */
  validateBitcoinAddress(address: string): boolean;
}

/**
 * Production Bitcoin Wallet Service
 * For now, generates deterministic addresses based on user ID
 * In production, integrate with your Bitcoin wallet infrastructure
 */
export class ProductionBitcoinWalletService implements BitcoinWalletService {
  private userBitcoinAddresses: Map<string, BitcoinWalletData> = new Map();
  private readonly network: "testnet" | "mainnet" = "testnet"; // Change to "mainnet" for production

  async getBitcoinAddress(userId: string): Promise<BitcoinWalletData> {
    try {
      // Check if user already has a Bitcoin address
      const existingAddress = this.userBitcoinAddresses.get(userId);
      if (existingAddress) {
        // Update last used timestamp
        existingAddress.lastUsed = new Date();
        return existingAddress;
      }

      // Generate a deterministic Bitcoin address based on user ID
      const bitcoinAddress = this.generateDeterministicAddress(userId);
      
      const walletData: BitcoinWalletData = {
        userId,
        address: bitcoinAddress,
        network: this.network,
        createdAt: new Date(),
        lastUsed: new Date(),
      };

      this.userBitcoinAddresses.set(userId, walletData);
      return walletData;
    } catch (error) {
      throw new Error(`Failed to get Bitcoin address: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async hasBitcoinAddress(userId: string): Promise<boolean> {
    return this.userBitcoinAddresses.has(userId);
  }

  validateBitcoinAddress(address: string): boolean {
    // Basic Bitcoin address validation
    // Bech32 (bc1...) addresses
    const bech32Regex = /^bc1[a-z0-9]{39,59}$/;
    // Legacy addresses (1...)
    const legacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    // P2SH addresses (3...)
    const p2shRegex = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
    
    return bech32Regex.test(address) || legacyRegex.test(address) || p2shRegex.test(address);
  }


  private generateDeterministicAddress(userId: string): string {
    // Simple hash-based address generation for demonstration
    // In production, use proper Bitcoin address generation libraries
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(userId).digest('hex');
    
    // Generate a testnet bech32 address (simplified)

    const addressHash = hash.substring(0, 40);
    return `bc1q${addressHash}`;
  }
}

/**
 * Singleton instance of the Bitcoin wallet service
 */
export const bitcoinWalletService: BitcoinWalletService = new ProductionBitcoinWalletService();
