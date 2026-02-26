/**
 * Example: Adding Audit Logging to Trade Operations
 *
 * This example demonstrates how to integrate audit logging
 * into trade confirmation endpoints.
 */

import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { auditLogService } from "../auditLog.service";
import { AuditAction, AuditSeverity } from "../auditLog.entity";

const router = Router();

// Example trade service (mock)
interface Trade {
  id: string;
  userId: string;
  amount: number;
  asset: string;
  price: number;
  status: "pending" | "confirmed" | "failed";
}

class TradeService {
  async initiateTrade(
    userId: string,
    amount: number,
    asset: string
  ): Promise<Trade> {
    // Mock implementation
    return {
      id: `trade-${Date.now()}`,
      userId,
      amount,
      asset,
      price: 1.5,
      status: "pending",
    };
  }

  async confirmTrade(tradeId: string): Promise<Trade> {
    // Mock implementation
    return {
      id: tradeId,
      userId: "user-123",
      amount: 100,
      asset: "XLM",
      price: 1.5,
      status: "confirmed",
    };
  }
}

const tradeService = new TradeService();

/**
 * POST /trade/initiate
 * Initiate a new trade with audit logging
 */
router.post(
  "/trade/initiate",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { amount, asset } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      // Initiate trade
      const trade = await tradeService.initiateTrade(userId, amount, asset);

      // Log successful trade initiation
      await auditLogService.logFromRequest(req, AuditAction.TRADE_INITIATED, {
        userId,
        severity: AuditSeverity.INFO,
        metadata: {
          tradeId: trade.id,
          amount,
          asset,
          price: trade.price,
        },
      });

      return res.status(200).json({
        success: true,
        trade,
      });
    } catch (error) {
      // Log failed trade initiation
      await auditLogService.logFromRequest(req, AuditAction.TRADE_FAILED, {
        userId,
        severity: AuditSeverity.ERROR,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        metadata: {
          amount,
          asset,
          stage: "initiation",
        },
      });

      return res.status(500).json({
        success: false,
        message: "Failed to initiate trade",
      });
    }
  }
);

/**
 * POST /trade/confirm
 * Confirm a pending trade with audit logging
 */
router.post(
  "/trade/confirm",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { tradeId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      // Confirm trade
      const trade = await tradeService.confirmTrade(tradeId);

      // Log successful trade confirmation
      await auditLogService.logFromRequest(req, AuditAction.TRADE_CONFIRMED, {
        userId,
        severity: AuditSeverity.INFO,
        metadata: {
          tradeId: trade.id,
          amount: trade.amount,
          asset: trade.asset,
          price: trade.price,
          status: trade.status,
        },
      });

      return res.status(200).json({
        success: true,
        trade,
      });
    } catch (error) {
      // Log failed trade confirmation
      await auditLogService.logFromRequest(req, AuditAction.TRADE_FAILED, {
        userId,
        severity: AuditSeverity.ERROR,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        metadata: {
          tradeId,
          stage: "confirmation",
        },
      });

      return res.status(500).json({
        success: false,
        message: "Failed to confirm trade",
      });
    }
  }
);

/**
 * POST /swap
 * Execute a token swap with audit logging
 */
router.post("/swap", authenticateToken, async (req: Request, res: Response) => {
  const { fromAsset, toAsset, amount } = req.body;
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    // Execute swap (mock)
    const swapResult = {
      id: `swap-${Date.now()}`,
      fromAsset,
      toAsset,
      fromAmount: amount,
      toAmount: amount * 1.5,
      rate: 1.5,
    };

    // Log successful swap
    await auditLogService.logFromRequest(req, AuditAction.SWAP_EXECUTED, {
      userId,
      severity: AuditSeverity.INFO,
      metadata: {
        swapId: swapResult.id,
        fromAsset,
        toAsset,
        fromAmount: amount,
        toAmount: swapResult.toAmount,
        rate: swapResult.rate,
      },
    });

    return res.status(200).json({
      success: true,
      swap: swapResult,
    });
  } catch (error) {
    // Log failed swap
    await auditLogService.logFromRequest(req, AuditAction.TRADE_FAILED, {
      userId,
      severity: AuditSeverity.ERROR,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      metadata: {
        fromAsset,
        toAsset,
        amount,
        operation: "swap",
      },
    });

    return res.status(500).json({
      success: false,
      message: "Failed to execute swap",
    });
  }
});

/**
 * GET /trade/history
 * Get trade history with audit log query
 */
router.get(
  "/trade/history",
  authenticateToken,
  async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      // Query audit logs for trade-related actions
      const { logs, total } = await auditLogService.query({
        userId,
        action: AuditAction.TRADE_CONFIRMED,
        limit: 50,
        offset: 0,
      });

      // Log data access
      await auditLogService.logFromRequest(
        req,
        AuditAction.SENSITIVE_DATA_ACCESS,
        {
          userId,
          severity: AuditSeverity.INFO,
          metadata: {
            resource: "trade_history",
            recordCount: logs.length,
          },
        }
      );

      return res.status(200).json({
        success: true,
        trades: logs,
        total,
      });
    } catch {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch trade history",
      });
    }
  }
);

export default router;

/**
 * Usage in main app:
 *
 * import tradeAuditRoutes from "./AuditLog/examples/tradeAuditExample";
 * app.use("/api", tradeAuditRoutes);
 */
