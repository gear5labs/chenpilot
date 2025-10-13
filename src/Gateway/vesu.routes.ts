import express from "express";
import { vesuService } from "../services/VesuService";
import { intentAgent } from "../Agents/agents/intentagent";
import { authenticate } from "../Auth/auth";
import { UnauthorizedError, ValidationError } from "../utils/error";

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    const health = await vesuService.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

router.get("/pools", async (req, res) => {
  try {
    const pools = await vesuService.getAvailablePools();
    res.json({ success: true, data: pools });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch pools"
    });
  }
});

router.get("/positions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await authenticate(userId);
    
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const positions = await vesuService.getUserPositions(userId);
    res.json({ success: true, data: positions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch positions"
    });
  }
});

router.post("/quote", async (req, res) => {
  try {
    const { amount, timeHorizon = 30 } = req.body;
    
    if (!amount) {
      throw new ValidationError("Amount is required");
    }

    const quote = await vesuService.getBestYieldQuote(amount, timeHorizon);
    res.json({ success: true, data: quote });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get quote"
    });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const stats = await vesuService.getPoolStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get pool statistics"
    });
  }
});

router.get("/pool/:asset", async (req, res) => {
  try {
    const { asset } = req.params;
    const pool = await vesuService.getPoolByAsset(asset);
    
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: `No pool found for asset: ${asset}`
      });
    }

    res.json({ success: true, data: pool });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get pool information"
    });
  }
});

router.get("/health-factor/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await authenticate(userId);
    
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const healthCheck = await vesuService.checkHealthFactor(userId);
    res.json({ success: true, data: healthCheck });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to check health factor"
    });
  }
});

router.post("/defi", async (req, res) => {
  try {
    const { userId, command } = req.body;
    
    if (!userId || !command) {
      throw new ValidationError("UserId and command are required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const result = await intentAgent.handle(command, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to process DeFi command"
    });
  }
});

router.post("/execute", async (req, res) => {
  try {
    const { userId, operation, account } = req.body;
    
    if (!userId || !operation || !account) {
      throw new ValidationError("UserId, operation, and account are required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Use the intent agent with a natural language command
    const command = `Execute ${operation.type} operation with ${operation.amount} ${operation.asset} for account ${account.address}`;
    const result = await intentAgent.handle(command, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute operation"
    });
  }
});

export default router;
