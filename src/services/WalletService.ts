export interface UserAccountData {
  userId: string;
  privateKey: string;
  publicKey: string;
  address: string;
  chainId: string;
  isActive: boolean;
  createdAt: Date;
  lastUsed: Date;
}

export interface WalletService {
  /**
   * Get user account data for creating Starknet signers
   * @param userId - The user ID
   * @returns Promise<UserAccountData> - User's wallet account data
   */
  getUserAccountData(userId: string): Promise<UserAccountData>;

  /**
   * Get user's Starknet address
   * @param userId - The user ID
   * @returns Promise<string> - User's Starknet address
   */
  getUserAddress(userId: string): Promise<string>;

  /**
   * Check if user has an active wallet
   * @param userId - The user ID
   * @returns Promise<boolean> - Whether user has an active wallet
   */
  hasActiveWallet(userId: string): Promise<boolean>;

  /**
   * Create a new wallet for a user (if needed)
   * @param userId - The user ID
   * @returns Promise<UserAccountData> - New wallet account data
   */
  createWallet(userId: string): Promise<UserAccountData>;

  /**
   * Validate user's private key format
   * @param privateKey - The private key to validate
   * @returns boolean - Whether the private key is valid
   */
  validatePrivateKey(privateKey: string): boolean;
}

import { container } from "tsyringe";
import { AuthService } from "../Auth/auth.service";


export class ProductionWalletService implements WalletService {
  private authService: AuthService;

  constructor() {
    this.authService = container.resolve(AuthService);
  }

  async getUserAccountData(userId: string): Promise<UserAccountData> {
    try {
      // Get user account data from existing AuthService
      const userAccountData = await this.authService.getUserAccountData(userId);
      
      return {
        userId: userAccountData.userId,
        privateKey: userAccountData.privateKey,
        publicKey: userAccountData.publicKey,
        address: userAccountData.precalculatedAddress,
        chainId: "SN_SEPOLIA", // or your target chain
        isActive: userAccountData.deployed,
        createdAt: new Date(),
        lastUsed: new Date(),
      };
    } catch (error) {
      throw new Error(`Failed to get user account data: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async getUserAddress(userId: string): Promise<string> {
    const accountData = await this.getUserAccountData(userId);
    return accountData.address;
  }

  async hasActiveWallet(userId: string): Promise<boolean> {
    try {
      const accountData = await this.getUserAccountData(userId);
      return accountData.isActive;
    } catch {
      return false;
    }
  }

  async createWallet(userId: string): Promise<UserAccountData> {

    throw new Error("Wallet creation is handled by the existing AuthService - use AuthService.createUser() instead");
  }

  validatePrivateKey(privateKey: string): boolean {
    // Basic validation for Starknet private key format
    return /^0x[a-fA-F0-9]{64}$/.test(privateKey);
  }
}


export const walletService: WalletService = new ProductionWalletService();
