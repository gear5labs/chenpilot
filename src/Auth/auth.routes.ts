import { Router } from "express";
import { container } from "./auth.container";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";

const router = Router();
const authController = container.resolve(AuthController);
const authMiddleware = container.resolve(AuthMiddleware);

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

export default router;
