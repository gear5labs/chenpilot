import { Router, Request, Response } from "express";
import { container } from "tsyringe";
import JwtService from "./jwt.service";
import UserService from "./user.service";
import { authenticateToken } from "./auth.middleware";
import logger from "../config/logger";

const router = Router();

/**
 * POST /auth/login - Login and get token pair
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Username is required",
      });
    }

    const userService = container.resolve(UserService);
    const user = await userService.getUserByName(name);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const jwtService = container.resolve(JwtService);
    const tokens = await jwtService.generateTokenPair(user.id, user.name);

    logger.info("User logged in", { userId: user.id, name: user.name });

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          address: user.address,
        },
        ...tokens,
      },
    });
  } catch (error) {
    logger.error("Login error", { error, name: req.body?.name });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * POST /auth/refresh - Rotate refresh token and get new token pair
 */
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const jwtService = container.resolve(JwtService);
    const tokens = await jwtService.rotateRefreshToken(refreshToken);

    return res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    logger.error("Token refresh error", { error });
    const statusCode =
      error instanceof Error && error.message.includes("revoked") ? 401 : 401;
    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Token refresh failed",
    });
  }
});

/**
 * POST /auth/logout - Revoke current refresh token
 */
router.post("/logout", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const jwtService = container.resolve(JwtService);
    await jwtService.revokeToken(refreshToken, "User logout");

    logger.info("User logged out");

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout error", { error });
    return res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
});

/**
 * POST /auth/logout-all - Revoke all refresh tokens for user (logout from all devices)
 */
router.post(
  "/logout-all",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const jwtService = container.resolve(JwtService);
      await jwtService.revokeAllUserTokens(
        req.user.userId,
        "User logout from all devices"
      );

      logger.info("User logged out from all devices", {
        userId: req.user.userId,
      });

      return res.status(200).json({
        success: true,
        message: "Logged out from all devices successfully",
      });
    } catch (error) {
      logger.error("Logout all error", { error });
      return res.status(500).json({
        success: false,
        message: "Logout failed",
      });
    }
  }
);

/**
 * GET /auth/sessions - Get all active sessions (refresh tokens) for current user
 */
router.get(
  "/sessions",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const jwtService = container.resolve(JwtService);
      const tokens = await jwtService.getUserActiveTokens(req.user.userId);

      return res.status(200).json({
        success: true,
        data: {
          sessions: tokens.map((token) => ({
            id: token.id,
            createdAt: token.createdAt,
            expiresAt: token.expiresAt,
          })),
        },
      });
    } catch (error) {
      logger.error("Get sessions error", { error });
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve sessions",
      });
    }
  }
);

export default router;
