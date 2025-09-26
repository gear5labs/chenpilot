import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { AuthService, RegisterData, LoginData, GoogleAuthData, AuthResponse } from "./auth.service";
import { AuthenticatedRequest } from "./auth.middleware";

@injectable()
export class AuthController {
  constructor(
    @inject("AuthService") private authService: AuthService
  ) {}

  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, name } = req.body;

      // Validate required fields
      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          message: "Please provide a valid email address",
        });
        return;
      }

      // Validate password strength
      if (password.length < 8) {
        res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long",
        });
        return;
      }

      const registerData: RegisterData = { email, password, name };
      const result = await this.authService.register(registerData);

      // Determine the appropriate message based on setup status
      let message = "Account created successfully. Please check your email for verification.";
      if (result.setupStatus) {
        if (result.setupStatus.fullyReady) {
          message = "Account created, funded, and deployed successfully! Your Starknet account is ready to use.";
        } else if (result.setupStatus.funding.success && !result.setupStatus.deployment.success) {
          message = "Account created and funded successfully. Deployment is pending and will be completed shortly.";
        } else if (!result.setupStatus.funding.success) {
          message = "Account created successfully. Auto-funding is not available at the moment. Please fund your account manually.";
        }
      }

      res.status(201).json({
        success: true,
        message,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Registration failed",
      });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // Validate required fields
      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
        return;
      }

      const loginData: LoginData = { email, password };
      const result = await this.authService.login(loginData);

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: result,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error instanceof Error ? error.message : "Login failed",
      });
    }
  }

  async googleAuth(req: Request, res: Response): Promise<void> {
    try {
      const { googleId, email, name, profilePicture } = req.body;

      // Validate required fields
      if (!googleId || !email || !name) {
        res.status(400).json({
          success: false,
          message: "Google ID, email, and name are required",
        });
        return;
      }

      const googleAuthData: GoogleAuthData = { googleId, email, name, profilePicture };
      const result = await this.authService.googleAuth(googleAuthData);

      // Determine the appropriate message based on setup status
      let message = "Google authentication successful";
      if (result.setupStatus) {
        if (result.setupStatus.fullyReady) {
          message = "Google authentication successful! Your Starknet account is funded and deployed, ready to use.";
        } else if (result.setupStatus.funding.success && !result.setupStatus.deployment.success) {
          message = "Google authentication successful. Account is funded and deployment is pending.";
        } else if (!result.setupStatus.funding.success) {
          message = "Google authentication successful. Auto-funding is not available at the moment.";
        }
      }

      res.status(200).json({
        success: true,
        message,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Google authentication failed",
      });
    }
  }

  async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;

      if (!token) {
        res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
        return;
      }

      await this.authService.verifyEmail(token);

      res.status(200).json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Email verification failed",
      });
    }
  }

  async resendVerification(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          message: "Email is required",
        });
        return;
      }

      await this.authService.resendVerificationEmail(email);

      res.status(200).json({
        success: true,
        message: "Verification email sent successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to send verification email",
      });
    }
  }

  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          message: "Email is required",
        });
        return;
      }

      await this.authService.forgotPassword(email);

      res.status(200).json({
        success: true,
        message: "If an account with that email exists, a password reset link has been sent",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to process password reset request",
      });
    }
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const { password } = req.body;

      if (!token || !password) {
        res.status(400).json({
          success: false,
          message: "Token and new password are required",
        });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long",
        });
        return;
      }

      await this.authService.resetPassword(token, password);

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Password reset failed",
      });
    }
  }

  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          message: "Current password and new password are required",
        });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters long",
        });
        return;
      }

      await this.authService.changePassword(userId, currentPassword, newPassword);

      res.status(200).json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Password change failed",
      });
    }
  }

  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const profile = await this.authService.getProfile(userId);

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to get profile",
      });
    }
  }

  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      const { name, profilePicture } = req.body;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const updatedProfile = await this.authService.updateProfile(userId, { name, profilePicture });

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: updatedProfile,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Profile update failed",
      });
    }
  }

  async deleteAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      await this.authService.deleteAccount(userId);

      res.status(200).json({
        success: true,
        message: "Account deleted successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Account deletion failed",
      });
    }
  }

  async deployStarknetAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      // Check if account is funded first
      const user = await this.authService.getProfile(userId);
      if (!user.isFunded) {
        res.status(400).json({
          success: false,
          message: "Account must be funded before deployment. Please fund your account first.",
          data: { isFunded: user.isFunded }
        });
        return;
      }

      const result = await this.authService.deployStarknetAccount(userId);

      res.status(200).json({
        success: true,
        message: "Starknet account deployed successfully",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Starknet account deployment failed",
      });
    }
  }

  async getStarknetAccountBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const balance = await this.authService.getStarknetAccountBalance(userId);

      res.status(200).json({
        success: true,
        data: { balance },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to get account balance",
      });
    }
  }

  async checkStarknetAccountStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const isDeployed = await this.authService.isStarknetAccountDeployed(userId);

      res.status(200).json({
        success: true,
        data: { isDeployed },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to check account status",
      });
    }
  }


  async fundUserAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const result = await this.authService.fundUserAccount(userId);

      res.status(200).json({
        success: result.success,
        message: result.success ? "Account funded successfully" : "Failed to fund account",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to fund account",
      });
    }
  }

  async getAutoFundingStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = this.authService.getAutoFundingStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to get auto-funding statistics",
      });
    }
  }

  async checkFundedAccountBalance(req: Request, res: Response): Promise<void> {
    try {
      const balance = await this.authService.checkFundedAccountBalance();

      res.status(200).json({
        success: true,
        data: balance,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to check funded account balance",
      });
    }
  }

  async batchFundAccounts(req: Request, res: Response): Promise<void> {
    try {
      const { addresses } = req.body;

      if (!addresses || !Array.isArray(addresses)) {
        res.status(400).json({
          success: false,
          message: "Addresses array is required",
        });
        return;
      }

      const results = await this.authService.batchFundAccounts(addresses);

      res.status(200).json({
        success: true,
        message: "Batch funding completed",
        data: results,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to batch fund accounts",
      });
    }
  }

  async getFundingConfigurationStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = await this.authService.getFundingConfigurationStatus();

      res.status(200).json({
        success: true,
        message: "Funding configuration status retrieved",
        data: status,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to get funding configuration status",
      });
    }
  }
}
