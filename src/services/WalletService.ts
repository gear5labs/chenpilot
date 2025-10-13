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
  getUserAccountData(userId: string): Promise<UserAccountData>;
  getUserAddress(userId: string): Promise<string>;
  hasActiveWallet(userId: string): Promise<boolean>;
  createWallet(userId: string): Promise<UserAccountData>;
  validatePrivateKey(privateKey: string): boolean;
}

import { container } from 'tsyringe';
import { AuthService } from '../Auth/auth.service';

export class ProductionWalletService implements WalletService {
  private authService: AuthService;

  constructor() {
    this.authService = container.resolve(AuthService);
  }

  async getUserAccountData(userId: string): Promise<UserAccountData> {
    try {
      const userAccountData = await this.authService.getUserAccountData(userId);

      return {
        userId: userAccountData.userId,
        privateKey: userAccountData.privateKey,
        publicKey: userAccountData.publicKey,
        address: userAccountData.precalculatedAddress,
        chainId: 'SN_SEPOLIA',
        isActive: userAccountData.deployed,
        createdAt: new Date(),
        lastUsed: new Date(),
      };
    } catch (error) {
      throw new Error(
        `Failed to get user account data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
    throw new Error(
      'Wallet creation is handled by the existing AuthService - use AuthService.createUser() instead'
    );
  }

  validatePrivateKey(privateKey: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(privateKey);
  }
}

export const walletService: WalletService = new ProductionWalletService();
