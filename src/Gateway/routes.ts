import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import * as os from "os";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import authRoutes from "../Auth/auth.routes";
import authExtraRoutes from "./auth.routes";
import dataExportRoutes from "../services/dataExport.routes";
import horizonProxyRoutes from "./horizonProxy.routes";
import auditLogRoutes from "../AuditLog/auditLog.routes";
import adminAgentRoutes from "../Agents/admin/adminAgent.routes";
import botRoutes from "./bot.routes";
import webhookRoutes from "./webhook.routes";
import transactionRoutes from "./transaction.routes";
import realtimeRoutes from "./realtime.routes";
import { requireAdminAuth } from "./middleware/adminAuth";
import { stellarLiquidityTool } from "../Agents/tools/stellarLiquidityTool";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

const router = Router();
router.use(helmet());

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});
router.use(generalLimiter);

// Auth routes (includes login, logout, refresh, sessions)
router.use("/auth", authRoutes);
router.use("/auth", authExtraRoutes);

// Data export
router.use("/export", dataExportRoutes);

// Horizon proxy
router.use("/horizon", horizonProxyRoutes);

// Audit logs
router.use("/audit", auditLogRoutes);

// Admin agent routes
router.use("/admin/agents", adminAgentRoutes);

// Bot routes
router.use("/bot", botRoutes);

// Webhooks
router.use("/webhook", webhookRoutes);

// Account transactions and sponsorship
router.use("/account", transactionRoutes);

// Realtime
router.use("/realtime", realtimeRoutes);

// Signup route
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name, address, pk } = req.body;
    if (!name || !address || !pk) {
      return res.status(400).json({
        success: false,
        message: "name, address, and pk are required",
      });
    }
    const userRepository = AppDataSource.getRepository(User);
    const existingUser = await userRepository.findOne({ where: { name } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this name already exists",
      });
    }
    const user = userRepository.create({ name, address, pk });
    const savedUser = await userRepository.save(user);
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

// Liquidity
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
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    res.status(500).json({ error: errorMessage });
  }
});

// Admin stats
router.get(
  "/admin/stats",
  requireAdminAuth(),
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
