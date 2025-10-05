import express from "express";
import { trovesService } from "../services/TrovesService";
import { intentAgent } from "../Agents/agents/intentagent";
import { authenticate } from "../Auth/auth";
import { UnauthorizedError, ValidationError } from "../utils/error";
import { AuthService } from "../Auth/auth.service";
import { container } from "tsyringe";
import { Account, RpcProvider } from "starknet";
import config from "../config/config";

const router = express.Router();

// Helper function to get real Starknet account for user
async function getUserStarknetAccount(userId: string): Promise<Account> {
  const authService = container.resolve(AuthService);
  const userAccountData = await authService.getUserAccountData(userId);
  
  if (!userAccountData) {
    throw new Error("User account not found");
  }

  const provider = new RpcProvider({
    nodeUrl: config.node_url,
  });

  const account = new Account(
    provider,
    userAccountData.precalculatedAddress,
    userAccountData.privateKey
  );

  return account;
}

// Health check endpoint
router.get("/health", async (req, res) => {
  try {
    const health = await trovesService.healthCheck();
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get available vaults
router.get("/vaults", async (req, res) => {
  try {
    const vaults = await trovesService.getAvailableVaults();
    res.json({ success: true, data: vaults });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch vaults"
    });
  }
});

// Get available strategies
router.get("/strategies", async (req, res) => {
  try {
    const strategies = await trovesService.getAvailableStrategies();
    res.json({ success: true, data: strategies });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch strategies"
    });
  }
});

// Get user positions
router.get("/positions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      throw new ValidationError("UserId is required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const positions = await trovesService.getUserPositions(userId);
    res.json({ success: true, data: positions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch positions"
    });
  }
});

// Get deposit quote
router.post("/quote", async (req, res) => {
  try {
    const { vaultId, amount, asset } = req.body;
    
    if (!vaultId || !amount || !asset) {
      throw new ValidationError("VaultId, amount, and asset are required");
    }

    const quote = await trovesService.getDepositQuote(vaultId, amount, asset);
    res.json({ success: true, data: quote });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get quote"
    });
  }
});

// Get yield data for a vault
router.get("/yield/:vaultId", async (req, res) => {
  try {
    const { vaultId } = req.params;
    
    if (!vaultId) {
      throw new ValidationError("VaultId is required");
    }

    const yieldData = await trovesService.getYieldData(vaultId);
    res.json({ success: true, data: yieldData });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch yield data"
    });
  }
});

// Execute vault operation (deposit, withdraw, harvest)
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

    // Execute operation using IntentAgent
    const result = await intentAgent.handle(operation, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute operation"
    });
  }
});

// Deposit to vault
router.post("/deposit", async (req, res) => {
  try {
    const { userId, vaultId, amount, asset } = req.body;
    
    if (!userId || !vaultId || !amount || !asset) {
      throw new ValidationError("UserId, vaultId, amount, and asset are required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Get real Starknet account for the user
    const starknetAccount = await getUserStarknetAccount(userId);

    const operation = {
      vaultId,
      amount,
      asset,
      userAddress: starknetAccount.address
    };

    const result = await trovesService.executeDeposit(operation, starknetAccount);
    res.json(result);
  } catch (error) {
    console.error("Deposit error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute deposit"
    });
  }
});

// Withdraw from vault
router.post("/withdraw", async (req, res) => {
  try {
    const { userId, vaultId, shares } = req.body;
    
    if (!userId || !vaultId || !shares) {
      throw new ValidationError("UserId, vaultId, and shares are required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Get real Starknet account for the user
    const starknetAccount = await getUserStarknetAccount(userId);

    const operation = {
      vaultId,
      shares,
      userAddress: starknetAccount.address
    };

    const result = await trovesService.executeWithdraw(operation, starknetAccount);
    res.json(result);
  } catch (error) {
    console.error("Withdraw error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute withdrawal"
    });
  }
});

// Harvest rewards
router.post("/harvest", async (req, res) => {
  try {
    const { userId, vaultId } = req.body;
    
    if (!userId || !vaultId) {
      throw new ValidationError("UserId and vaultId are required");
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Get real Starknet account for the user
    const starknetAccount = await getUserStarknetAccount(userId);

    const operation = {
      vaultId,
      userAddress: starknetAccount.address,
      estimatedRewards: "0" // Will be calculated by the service
    };

    const result = await trovesService.harvestRewards(operation, starknetAccount);
    res.json(result);
  } catch (error) {
    console.error("Harvest error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to harvest rewards"
    });
  }
});

export default router;
