import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import * as os from "os";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import { stellarWebhookService } from "./webhook.service";
import { platformWebhookService } from "./platformWebhook.service";
import {
  transactionHistoryService,
  type TransactionQueryParams,
  type TransactionType,
} from "./transaction.service";
import logger from "../config/logger";
import authRoutes from "../Auth/auth.routes";
import dataExportRoutes from "../services/dataExport.routes";
import horizonProxyRoutes from "./horizonProxy.routes";
import auditLogRoutes from "../AuditLog/auditLog.routes";
import { stellarLiquidityTool } from "../Agents/tools/stellarLiquidityTool";
import { authenticateToken } from "../Auth/auth.middleware";
import {
  requireAdmin,
  requireOwnerOrElevated,
} from "./middleware/rbac.middleware";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

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

// Mount auth routes
router.use("/auth", authRoutes);

// Mount data export routes
router.use("/export", dataExportRoutes);

// Mount Horizon proxy routes (authenticated)
router.use("/horizon", horizonProxyRoutes);
// Mount audit log routes
router.use("/audit", auditLogRoutes);

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

// Public webhook endpoint for Telegram
router.post("/webhook/telegram", async (req: Request, res: Response) => {
  try {
    const result = await platformWebhookService.processTelegramWebhook(req);

    if (result.isDuplicate) {
      // Return 200 for duplicates to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: result.message,
      });
    }

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Telegram webhook processing error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Public webhook endpoint for Discord
router.post("/webhook/discord", async (req: Request, res: Response) => {
  try {
    const result = await platformWebhookService.processDiscordWebhook(req);

    // Discord ping response (type 1)
    if (
      result.data &&
      typeof result.data === "object" &&
      "type" in result.data &&
      result.data.type === 1
    ) {
      return res.status(200).json({ type: 1 });
    }

    if (result.isDuplicate) {
      // Return 200 for duplicates to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: result.message,
      });
    }

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Discord webhook processing error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * @swagger
 * /api/signup:
 *   post:
 *     summary: Register a new user with wallet details
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - pk
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique username
 *               address:
 *                 type: string
 *                 description: Stellar public address
 *               pk:
 *                 type: string
 *                 description: Private key
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: User with this name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
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

    // Log user creation
    await auditLogService.log({
      userId: savedUser.id,
      action: AuditAction.USER_CREATED,
      severity: AuditSeverity.INFO,
      ipAddress:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.socket.remoteAddress ||
        "unknown",
      userAgent: req.headers["user-agent"],
      metadata: { username: name, address },
    });

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

/**
 * @swagger
 * /api/account/{userId}/transactions:
 *   get:
 *     summary: Get paginated Stellar transaction history
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [funding, deployment, swap, transfer, all]
 *         description: Filter by transaction type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter (ISO 8601)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter (ISO 8601)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of transactions per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor from previous response
 *     responses:
 *       200:
 *         description: Paginated transaction list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TransactionHistoryItem'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     nextCursor:
 *                       type: string
 *                     prevCursor:
 *                       type: string
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/account/:userId/transactions",
  authenticateToken,
  requireOwnerOrElevated("userId"),
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
        userId,
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

// GET /admin/stats - Internal admin route for CPU and memory usage
router.get(
  "/admin/stats",
  authenticateToken,
  requireAdmin,
  (req: Request, res: Response) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      memory: {
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`,
      },
      cpu: {
        user: `${(cpuUsage.user / 1000).toFixed(2)} ms`,
        system: `${(cpuUsage.system / 1000).toFixed(2)} ms`,
      },
      system: {
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        uptime: `${(os.uptime() / 3600).toFixed(2)} hours`,
        loadAverage: os.loadavg(),
      },
      process: {
        uptime: `${(process.uptime() / 60).toFixed(2)} minutes`,
        pid: process.pid,
      },
    });
  }
);

export default router;
