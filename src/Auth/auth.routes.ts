import { Router } from "express";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { StarknetService } from "./starknet.service";
import { AutoFundingService } from "./auto-funding.service";
import { EncryptionService } from "./encryption.service";

const router = Router();

// Create instances directly
const authRepository = new AuthRepository();
const starknetService = new StarknetService();
const encryptionService = new EncryptionService();
const autoFundingService = new AutoFundingService(authRepository, starknetService);
const authService = new AuthService(authRepository, starknetService, autoFundingService, encryptionService);
const authController = new AuthController(authService);
const authMiddleware = new AuthMiddleware(authService);

// Public routes
router.post("/register", authController.register.bind(authController));
router.post("/login", authController.login.bind(authController));
router.post("/google-auth", authController.googleAuth.bind(authController));
router.get("/verify-email/:token", authController.verifyEmail.bind(authController));
router.post("/resend-verification", authController.resendVerification.bind(authController));
router.post("/forgot-password", authController.forgotPassword.bind(authController));
router.post("/reset-password/:token", authController.resetPassword.bind(authController));

// Protected routes
router.get("/profile", authMiddleware.authenticate, authController.getProfile.bind(authController));
router.put("/profile", authMiddleware.authenticate, authController.updateProfile.bind(authController));
router.post("/change-password", authMiddleware.authenticate, authController.changePassword.bind(authController));
router.delete("/account", authMiddleware.authenticate, authController.deleteAccount.bind(authController));

// Starknet account management routes
router.post("/starknet/deploy", authMiddleware.authenticate, authController.deployStarknetAccount.bind(authController));
router.get("/starknet/balance", authMiddleware.authenticate, authController.getStarknetAccountBalance.bind(authController));
router.get("/starknet/status", authMiddleware.authenticate, authController.checkStarknetAccountStatus.bind(authController));


// Auto-funding routes
router.post("/funding/fund-account", authMiddleware.authenticate, authController.fundUserAccount.bind(authController));
router.get("/funding/auto-funding-stats", authController.getAutoFundingStats.bind(authController));
router.get("/funding/funded-account-balance", authController.checkFundedAccountBalance.bind(authController));
router.post("/funding/batch-fund", authController.batchFundAccounts.bind(authController));

export default router;
