import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Repository} from "typeorm";
import { injectable, inject } from "tsyringe";
import { User, AuthProvider } from "./user.entity";
import { StarknetService } from "./starknet.service";
import { AutoFundingService } from "./auto-funding.service";
import { EncryptionService } from "./encryption.service";
import AppDataSource from "../config/Datasource";
import nodemailer from "nodemailer";

export interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface GoogleAuthData {
  googleId: string;
  email: string;
  name: string;
  profilePicture?: string;
}

export interface StarknetAccountInfo {
  address: string;
  publicKey: string;
  isDeployed: boolean;
  deploymentTransactionHash?: string;
}

export interface AuthResponse {
  user: Omit<
    User,
    'password' | 'emailVerificationToken' | 'passwordResetToken'
  >;
  token: string;
  starknetAccount?: StarknetAccountInfo;
  setupStatus?: {
    funding: {
      success: boolean;
      transactionHash?: string;
      error?: string;
      amount?: string;
    };
    deployment: {
      success: boolean;
      transactionHash?: string;
      error?: string;
      contractAddress?: string;
    };
    fullyReady: boolean;
  };
}

@injectable()
export class AuthService {
  private readonly JWT_SECRET: string;
  private readonly JWT_EXPIRES_IN: string;
  private readonly SALT_ROUNDS: number = 12;
  private userRepository: Repository<User>;

  constructor(
    @inject(StarknetService) private starknetService: StarknetService,
    @inject(AutoFundingService) private autoFundingService: AutoFundingService,
    @inject(EncryptionService) private encryptionService: EncryptionService
  ) {
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
    this.userRepository = AppDataSource.getRepository(User);
  }

  async register(data: RegisterData): Promise<AuthResponse> {
    const { email, password, name } = data;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create Starknet account
    let starknetAccountData;
    try {
      starknetAccountData = await this.starknetService.createAccount();
    } catch (error) {
      console.error('Failed to create Starknet account:', error);
      // Continue with user creation even if Starknet account creation fails
      starknetAccountData = null;
    }

    // Create user
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      authProvider: AuthProvider.EMAIL,
      emailVerificationToken,
      isEmailVerified: true,
      // Starknet account data
      address: starknetAccountData?.precalculatedAddress,
      pk: starknetAccountData?.privateKey
        ? this.encryptionService.encryptPrivateKeyForStorage(
            starknetAccountData.privateKey
          )
        : undefined,
      publicKey: starknetAccountData?.publicKey,
      addressSalt: starknetAccountData?.addressSalt,
      constructorCalldata: starknetAccountData?.constructorCalldata
        ? JSON.stringify(starknetAccountData.constructorCalldata)
        : undefined,
      isDeployed: false,
    });
    const savedUser = await this.userRepository.save(user);

    // Auto-fund and deploy the new account synchronously with timeout
    let fundingResult = null;
    let deploymentResult = null;
    let fundingError = null;
    let deploymentError = null;

    if (starknetAccountData?.precalculatedAddress) {
      try {
        console.log(`Starting auto-funding for user ${savedUser.id}...`);

        // Set a timeout for the entire funding and deployment process (2 minutes)
        const setupPromise = this.performAccountSetup(
          savedUser.id,
          starknetAccountData.precalculatedAddress
        );
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Account setup timeout after 2 minutes')),
            120000
          )
        );

        const result = (await Promise.race([setupPromise, timeoutPromise])) as {
          fundingResult: any;
          deploymentResult: any;
          fundingError: any;
          deploymentError: any;
        };
        fundingResult = result.fundingResult;
        deploymentResult = result.deploymentResult;
        fundingError = result.fundingError;
        deploymentError = result.deploymentError;
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          fundingError = error;
          console.log(`⏰ Account setup timed out for user ${savedUser.id}`);
        } else {
          fundingError = error;
          console.error(
            `❌ Auto-funding error for user ${savedUser.id}:`,
            error
          );
        }
      }
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    // Refresh user data to get updated funding/deployment status
    const updatedUser = await this.userRepository.findOne({
      where: { id: user.id },
    });

    // Prepare Starknet account info for response
    const starknetAccount: StarknetAccountInfo | undefined = starknetAccountData
      ? {
          address: starknetAccountData.precalculatedAddress,
          publicKey: starknetAccountData.publicKey,
          isDeployed: updatedUser?.isDeployed || false,
          deploymentTransactionHash: updatedUser?.deploymentTransactionHash,
        }
      : undefined;

    // Prepare response with funding and deployment status
    const response = {
      user: this.sanitizeUser(updatedUser || user),
      token,
      starknetAccount,
      setupStatus: {
        funding: {
          success: fundingResult?.success || false,
          transactionHash: fundingResult?.transactionHash,
          error: fundingError?.message,
          amount: fundingResult?.amount,
        },
        deployment: {
          success: deploymentResult ? true : false,
          transactionHash: deploymentResult?.transactionHash,
          error: deploymentError?.message,
          contractAddress: deploymentResult?.contractAddress,
        },
        fullyReady: (fundingResult?.success && deploymentResult) || false,
      },
    };

    return response;
  }

  async login(data: LoginData): Promise<AuthResponse> {
    const { email, password } = data;

    // Find user by email
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check if user has a password (not OAuth only)
    if (!user.password) {
      throw new Error('Please use Google sign-in for this account');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      throw new Error('Please verify your email before logging in');
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    // Prepare Starknet account info for response
    const starknetAccount: StarknetAccountInfo | undefined = user.address
      ? {
          address: user.address,
          publicKey: user.publicKey || '',
          isDeployed: user.isDeployed,
          deploymentTransactionHash: user.deploymentTransactionHash,
        }
      : undefined;

    return {
      user: this.sanitizeUser(user),
      token,
      starknetAccount,
    };
  }

  async googleAuth(data: GoogleAuthData): Promise<AuthResponse> {
    const { googleId, email, name, profilePicture } = data;

    // Variables for tracking funding and deployment status
    let fundingResult = null;
    let deploymentResult = null;
    let fundingError = null;
    let deploymentError = null;

    // Check if user already exists with this Google ID
    let user = await this.userRepository.findOne({ where: { googleId } });

    if (user) {
      // Update user info if needed
      if (user.name !== name || user.profilePicture !== profilePicture) {
        await this.userRepository.update(user.id, {
          name,
          profilePicture,
        });
        user = await this.userRepository.findOne({ where: { id: user.id } });
      }
    } else {
      // Check if user exists with this email but different provider
      const existingUser = await this.userRepository.findOne({
        where: { email },
      });
      if (existingUser) {
        // Link Google account to existing user
        await this.userRepository.update(existingUser.id, {
          googleId,
          authProvider: AuthProvider.GOOGLE,
          name: name || existingUser.name,
          profilePicture,
          isEmailVerified: true, // Google emails are pre-verified
        });
        user = await this.userRepository.findOne({
          where: { id: existingUser.id },
        });
      } else {
        // Create Starknet account for new Google user
        let starknetAccountData;
        try {
          starknetAccountData = await this.starknetService.createAccount();
        } catch (error) {
          console.error('Failed to create Starknet account:', error);
          starknetAccountData = null;
        }

        // Create new user
        const newUser = this.userRepository.create({
          googleId,
          email,
          name,
          profilePicture,
          authProvider: AuthProvider.GOOGLE,
          isEmailVerified: true,
          // Starknet account data
          address: starknetAccountData?.precalculatedAddress,
          pk: starknetAccountData?.privateKey
            ? this.encryptionService.encryptPrivateKeyForStorage(
                starknetAccountData.privateKey
              )
            : undefined,
          publicKey: starknetAccountData?.publicKey,
          addressSalt: starknetAccountData?.addressSalt,
          constructorCalldata: starknetAccountData?.constructorCalldata
            ? JSON.stringify(starknetAccountData.constructorCalldata)
            : undefined,
          isDeployed: false,
        });
        user = await this.userRepository.save(newUser);

        // Auto-fund and deploy the new Google user account synchronously with timeout
        if (starknetAccountData?.precalculatedAddress) {
          try {
            console.log(`Starting auto-funding for Google user ${user.id}...`);

            // Set a timeout for the entire funding and deployment process (2 minutes)
            const setupPromise = this.performAccountSetup(
              user.id,
              starknetAccountData.precalculatedAddress
            );
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(new Error('Account setup timeout after 2 minutes')),
                120000
              )
            );

            const result = (await Promise.race([
              setupPromise,
              timeoutPromise,
            ])) as {
              fundingResult: any;
              deploymentResult: any;
              fundingError: any;
              deploymentError: any;
            };
            fundingResult = result.fundingResult;
            deploymentResult = result.deploymentResult;
            fundingError = result.fundingError;
            deploymentError = result.deploymentError;
          } catch (error) {
            if (error instanceof Error && error.message.includes('timeout')) {
              fundingError = error;
              console.log(
                `⏰ Account setup timed out for Google user ${user.id}`
              );
            } else {
              fundingError = error;
              console.error(
                `❌ Auto-funding error for Google user ${user.id}:`,
                error
              );
            }
          }
        }
      }
    }

    if (!user) {
      throw new Error('Failed to authenticate with Google');
    }

    // Generate JWT token
    const token = this.generateToken(user.id);

    // Refresh user data to get updated funding/deployment status
    const updatedUser = await this.userRepository.findOne({
      where: { id: user.id },
    });

    // Prepare Starknet account info for response
    const starknetAccount: StarknetAccountInfo | undefined = user.address
      ? {
          address: user.address,
          publicKey: user.publicKey || '',
          isDeployed: updatedUser?.isDeployed || false,
          deploymentTransactionHash: updatedUser?.deploymentTransactionHash,
        }
      : undefined;

    // Prepare response with funding and deployment status
    const response = {
      user: this.sanitizeUser(updatedUser || user),
      token,
      starknetAccount,
      setupStatus: {
        funding: {
          success: fundingResult?.success || false,
          transactionHash: fundingResult?.transactionHash,
          error: fundingError?.message,
          amount: fundingResult?.amount,
        },
        deployment: {
          success: deploymentResult ? true : false,
          transactionHash: deploymentResult?.transactionHash,
          error: deploymentError?.message,
          contractAddress: deploymentResult?.contractAddress,
        },
        fullyReady: (fundingResult?.success && deploymentResult) || false,
      },
    };

    return response;
  }

  async verifyEmail(token: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
    });
    if (!user) {
      throw new Error('Invalid or expired verification token');
    }

    await this.userRepository.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: undefined,
    });
    return true;
  }

  async resendVerificationEmail(email: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new Error('User not found');
    }

    if (user.isEmailVerified) {
      throw new Error('Email is already verified');
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    await this.userRepository.update(user.id, { emailVerificationToken });

    return true;
  }

  private async sendResetEmail(
    email: string,
    resetToken: string
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || 'your@email.com',
        pass: process.env.SMTP_PASS || 'yourpassword',
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"ChenPilot" <${process.env.SMTP_USER || 'your@email.com'}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <p>You requested a password reset.</p>
        <p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  }

  async forgotPassword(email: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      // Don't reveal if user exists or not
      return true;
    }

    // Generate reset token
    const passwordResetToken = crypto.randomBytes(32).toString('hex');
    const passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour

    await this.userRepository.update(user.id, {
      passwordResetToken,
      passwordResetExpires,
    });

    // Send email with reset link
    await this.sendResetEmail(email, passwordResetToken);

    return true;
  }

  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { passwordResetToken: token },
    });
    if (
      !user ||
      !user.passwordResetExpires ||
      user.passwordResetExpires < new Date()
    ) {
      throw new Error('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    // Update password and clear reset token
    await this.userRepository.update(user.id, {
      password: hashedPassword,
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    });

    return true;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.password) {
      throw new Error('User not found or no password set');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    // Update password
    await this.userRepository.update(userId, { password: hashedPassword });

    return true;
  }

  async getProfile(
    userId: string
  ): Promise<
    Omit<User, 'password' | 'emailVerificationToken' | 'passwordResetToken'>
  > {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    return this.sanitizeUser(user);
  }

  async updateProfile(
    userId: string,
    data: Partial<Pick<User, 'name' | 'profilePicture'>>
  ): Promise<
    Omit<User, 'password' | 'emailVerificationToken' | 'passwordResetToken'>
  > {
    await this.userRepository.update(userId, data);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    return this.sanitizeUser(user);
  }

  async deleteAccount(userId: string): Promise<boolean> {
    const result = await this.userRepository.delete(userId);
    return result.affected !== 0;
  }

  private generateToken(userId: string): string {
    return jwt.sign({ userId }, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  private sanitizeUser(
    user: User
  ): Omit<User, 'password' | 'emailVerificationToken' | 'passwordResetToken'> {
    const {
      password,
      emailVerificationToken,
      passwordResetToken,
      ...sanitizedUser
    } = user;
    return sanitizedUser;
  }

  verifyToken(token: string): { userId: string } {
    try {
      return jwt.verify(token, this.JWT_SECRET) as { userId: string };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Deploy a user's Starknet account
   */
  async deployStarknetAccount(
    userId: string
  ): Promise<{ transactionHash: string; contractAddress: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    if (
      !user.address ||
      !user.pk ||
      !user.publicKey ||
      !user.addressSalt ||
      !user.constructorCalldata
    ) {
      throw new Error('User does not have a Starknet account');
    }

    if (user.isDeployed) {
      throw new Error('Starknet account is already deployed');
    }

    try {
      // Decrypt the private key before deployment
      const decryptedPrivateKey =
        this.encryptionService.decryptPrivateKeyFromStorage(user.pk!);

      const accountData = {
        privateKey: decryptedPrivateKey,
        publicKey: user.publicKey,
        addressSalt: user.addressSalt,
        constructorCalldata: JSON.parse(user.constructorCalldata!),
        precalculatedAddress: user.address,
        deployed: false,
      };

      const deploymentResult =
        await this.starknetService.deployAccount(accountData);

      // Update user with deployment information
      await this.userRepository.update(userId, {
        isDeployed: true,
        deploymentTransactionHash: deploymentResult.transactionHash,
      });

      return deploymentResult;
    } catch (error) {
      throw new Error(
        `Failed to deploy Starknet account: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get user's Starknet account balance
   */
  async getStarknetAccountBalance(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.address) {
      throw new Error('User or Starknet account not found');
    }

    try {
      return await this.starknetService.getAccountBalance(user.address);
    } catch (error) {
      throw new Error(
        `Failed to get account balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if user's Starknet account is deployed
   */
  async isStarknetAccountDeployed(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.address) {
      return false;
    }

    try {
      return await this.starknetService.isAccountDeployed(user.address);
    } catch (error) {
      return false;
    }
  }

  /**
   * Manually fund a user's account
   */
  async fundUserAccount(userId: string): Promise<{
    success: boolean;
    transactionHash?: string;
    error?: string;
    amount: string;
  }> {
    const result = await this.autoFundingService.autoFundNewAccount(userId);
    return {
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
      amount: result.amount,
    };
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
    return this.autoFundingService.getAutoFundingStats();
  }

  /**
   * Check funded account balance
   */
  async checkFundedAccountBalance(): Promise<{
    hasBalance: boolean;
    balance: string;
    required: string;
    nativeBalance: string;
  }> {
    return await this.autoFundingService.checkFundedAccountBalance();
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
    return await this.autoFundingService.getFundingConfigurationStatus();
  }

  /**
   * Batch fund multiple accounts
   */
  async batchFundAccounts(recipientAddresses: string[]): Promise<
    Array<{
      success: boolean;
      transactionHash?: string;
      error?: string;
      amount: string;
      recipientAddress: string;
    }>
  > {
    return await this.autoFundingService.batchFundAccounts(recipientAddresses);
  }

  /**
   * Perform account setup (funding and deployment) with proper error handling
   */
  private async performAccountSetup(
    userId: string,
    address: string
  ): Promise<{
    fundingResult: any;
    deploymentResult: any;
    fundingError: any;
    deploymentError: any;
  }> {
    let fundingResult = null;
    let deploymentResult = null;
    let fundingError = null;
    let deploymentError = null;

    try {
      console.log(`Starting auto-funding for user ${userId}...`);
      fundingResult = await this.autoFundingService.autoFundNewAccount(userId);

      if (fundingResult.success) {
        console.log(`✅ Auto-funded new account ${address} for user ${userId}`);

        // Wait a moment for the funding transaction to be confirmed
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Auto-deploy the account after funding
        try {
          console.log(`Starting auto-deployment for user ${userId}...`);
          deploymentResult = await this.deployStarknetAccount(userId);
          console.log(
            `✅ Auto-deployed account for user ${userId}: ${deploymentResult.transactionHash}`
          );
        } catch (deployError) {
          deploymentError = deployError;
          console.log(
            `❌ Auto-deployment failed for user ${userId}: ${deployError instanceof Error ? deployError.message : 'Unknown error'}`
          );

          // Mark as deployment pending for later retry
          await this.userRepository.update(userId, {
            isDeploymentPending: true,
            deploymentRequestedAt: new Date(),
          });
        }
      } else {
        fundingError = new Error(fundingResult.error || 'Auto-funding failed');
        console.log(
          `❌ Auto-funding failed for user ${userId}: ${fundingResult.error}`
        );
      }
    } catch (error) {
      fundingError = error;
      console.error(`❌ Auto-funding error for user ${userId}:`, error);
    }

    return {
      fundingResult,
      deploymentResult,
      fundingError,
      deploymentError,
    };
  }

  /**
   * Decrypts a user's private key for use by agents
   * @param userId - The user ID
   * @returns The decrypted private key
   */
  async getDecryptedPrivateKey(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.pk) {
      throw new Error('User does not have a private key');
    }

    try {
      return this.encryptionService.decryptPrivateKeyFromStorage(user.pk);
    } catch (error) {
      throw new Error(
        `Failed to decrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Gets user account data with decrypted private key for agent use
   * @param userId - The user ID
   * @returns User account data with decrypted private key
   */
  async getUserAccountData(userId: string): Promise<{
    userId: string;
    privateKey: string;
    publicKey: string;
    precalculatedAddress: string;
    deployed: boolean;
    contract_address?: string;
  }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.pk || !user.publicKey || !user.address) {
        throw new Error('User does not have complete Starknet account data');
      }

      try {
        const decryptedPrivateKey =
          this.encryptionService.decryptPrivateKeyFromStorage(user.pk);

        return {
          userId: user.id,
          privateKey: decryptedPrivateKey,
          publicKey: user.publicKey,
          precalculatedAddress: user.address,
          deployed: user.isDeployed,
          contract_address: user.deploymentTransactionHash || undefined,
        };
      } catch (decryptionError) {
        throw new Error('Failed to decrypt private key');
      }
    } catch (error) {
      console.error('Database error in getUserAccountData:', error);
      // Handle database column issues gracefully
      if (
        error instanceof Error &&
        error.message.includes('column') &&
        error.message.includes('does not exist')
      ) {
        console.warn(
          'Database columns missing, attempting to retrieve existing user data for:',
          userId
        );

        // Try to get user data without the problematic columns
        try {
          const user = await this.userRepository.findOne({
            where: { id: userId },
            select: [
              'id',
              'pk',
              'publicKey',
              'address',
              'isDeployed',
              'deploymentTransactionHash',
            ],
          });

          if (!user) {
            throw new Error('User not found');
          }

          if (!user.pk || !user.publicKey || !user.address) {
            throw new Error(
              'User does not have complete Starknet account data'
            );
          }

          const decryptedPrivateKey =
            this.encryptionService.decryptPrivateKeyFromStorage(user.pk);

          return {
            userId: user.id,
            privateKey: decryptedPrivateKey,
            publicKey: user.publicKey,
            precalculatedAddress: user.address,
            deployed: user.isDeployed,
            contract_address: user.deploymentTransactionHash || undefined,
          };
        } catch (retrieveError) {
          console.error(
            'Failed to retrieve existing user account data:',
            retrieveError
          );
          throw new Error(
            'Unable to retrieve user account data. Please contact support.'
          );
        }
      }
      throw error;
    }
  }

  /**
   * Creates new user account data with proper Starknet account
   * @param userId - The user ID
   * @returns User account data with Starknet account
   */
  private async createUserAccountData(userId: string): Promise<{
    userId: string;
    privateKey: string;
    publicKey: string;
    precalculatedAddress: string;
    deployed: boolean;
    contract_address?: string;
  }> {
    console.log('Creating new Starknet account for user:', userId);

    // Generate new Starknet account data
    const starknetAccountData = await this.starknetService.createAccount();

    // Create a new user record with the generated account data
    const user = new User();
    user.id = userId;
    user.email = `temp-${userId}@example.com`;
    user.password = 'temp-password';
    user.name = 'Temporary User';
    user.pk = this.encryptionService.encryptPrivateKeyForStorage(
      starknetAccountData.privateKey
    );
    user.publicKey = starknetAccountData.publicKey;
    user.address = starknetAccountData.precalculatedAddress;
    user.addressSalt = starknetAccountData.addressSalt;
    user.constructorCalldata = JSON.stringify(
      starknetAccountData.constructorCalldata
    );
    user.isDeployed = false;

    try {
      const savedUser = await this.userRepository.save(user);
      console.log('Created new user account:', savedUser.id);

      return {
        userId: savedUser.id,
        privateKey: starknetAccountData.privateKey,
        publicKey: starknetAccountData.publicKey,
        precalculatedAddress: starknetAccountData.precalculatedAddress,
        deployed: false,
        contract_address: undefined,
      };
    } catch (saveError) {
      console.error('Failed to save new user account:', saveError);
      throw new Error('Failed to create user account data');
    }
  }
}
