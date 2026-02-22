import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import { stellarWebhookService } from "./webhook.service";
import {
  transactionHistoryService,
  type TransactionQueryParams,
  type TransactionType,
} from "./transaction.service";
import logger from "../config/logger";
import { stellarLiquidityTool } from "../Agents/tools/stellarLiquidityTool";

const router = Router();

router.use(helmet());

// --- RATE LIMITING STRATEGIES ---

// AC: 100 req/min per IP for public/general routes
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

// Apply general limiter to all routes by default
router.use(generalLimiter);

// --- ROUTES ---

// Public webhook endpoint for Stellar funding notifications
router.post("/webhook/stellar/funding", async (req: Request, res: Response) => {
  try {
    const result = await stellarWebhookService.processFundingWebhook(req);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        userId: result.userId,
        deploymentTriggered: result.deploymentTriggered,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name, address, pk } = req.body;

    // Validate required fields
    if (!name || !address || !pk) {
      return res.status(400).json({
        success: false,
        message: "name, address, and pk are required",
      });
    }

    const userRepository = AppDataSource.getRepository(User);

    // Check for existing user (name is unique)
    const existingUser = await userRepository.findOne({
      where: { name },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this name already exists",
      });
    }

    // Create user
    const user = userRepository.create({
      name,
      address,
      pk,
      // isDeployed and tokenType will use defaults
    });

    // Save user
    const savedUser = await userRepository.save(user);

    //  Return success
    return res.status(201).json({
      success: true,
      userId: savedUser.id,
    });
  } catch (error) {
    logger.error("Signup error", { error, name: req.body?.name });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// GET /account/:userId/transactions - Get paginated Stellar transaction history
router.get(
  "/account/:userId/transactions",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      // Ensure userId is a string
      if (!userId || Array.isArray(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid userId parameter",
        });
      }

      // Extract and validate query parameters
      const { type, startDate, endDate, limit, cursor } = req.query as Record<
        string,
        string | undefined
      >;

      // Validate type parameter
      const validTypes = ["funding", "deployment", "swap", "transfer", "all"];
      if (type && !validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid type. Must be one of: ${validTypes.join(", ")}`,
        });
      }

      // Validate limit parameter
      const parsedLimit = limit ? parseInt(limit, 10) : 20;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a number between 1 and 100",
        });
      }

      // Validate date parameters
      if (startDate && isNaN(Date.parse(startDate))) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid startDate format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
        });
      }

      if (endDate && isNaN(Date.parse(endDate))) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid endDate format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
        });
      }

      // Build query parameters
      const queryParams: TransactionQueryParams = {
        type: type as TransactionType,
        startDate,
        endDate,
        limit: parsedLimit,
        cursor,
      };

      // Fetch transaction history
      const result = await transactionHistoryService.getTransactionHistory(
        userId as string,
        queryParams
      );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("Transaction history error:", error);
      const message =
        error instanceof Error ? error.message : "Internal server error";
      const statusCode = message.includes("User not found") ? 404 : 500;

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  },

  router.post("/liquidity", async (req: Request, res: Response) => {
    try {
      const { assetCode, assetIssuer, depthLimit } = req.body;

      const result = await stellarLiquidityTool.execute({
        assetCode,
        assetIssuer,
        depthLimit,
      });

      res.json(result);
    } catch (err) {
      // Check if it's a standard Error object
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";

      res.status(500).json({ error: errorMessage });
    }
  })
);

export default router;
