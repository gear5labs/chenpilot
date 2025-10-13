import express from "express";
import { xverseService } from "../services/XVerseService";
import { intentAgent } from "../Agents/agents/intentagent";
import { authenticate } from "../Auth/auth";
import { UnauthorizedError, ValidationError } from "../utils/error";

const router = express.Router();

// Health check endpoint
router.get("/health", async (req, res) => {
  try {
    const health = await xverseService.healthCheck();
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get Bitcoin balance for an address
router.get("/balance/:address", async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const balance = await xverseService.getAddressBalance(address);
    res.json({ success: true, data: balance });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get balance"
    });
  }
});

// Get Bitcoin transactions for an address
router.get("/transactions/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const transactions = await xverseService.getAddressTransactions(address, Number(limit));
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get transactions"
    });
  }
});

// Get UTXOs for an address
router.get("/utxos/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 60 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const utxos = await xverseService.getAddressUTXOs(address, Number(offset), Number(limit));
    res.json({ success: true, data: utxos });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get UTXOs"
    });
  }
});

// Get Bitcoin price
router.get("/price", async (req, res) => {
  try {
    const price = await xverseService.getBitcoinPrice();
    res.json({ success: true, data: price });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Bitcoin price"
    });
  }
});

// Get Ordinals for an address
router.get("/ordinals/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const ordinals = await xverseService.getOrdinalsByAddress(address, Number(offset), Number(limit));
    res.json({ success: true, data: ordinals });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Ordinals"
    });
  }
});

// Get Ordinal by ID
router.get("/ordinal/:inscriptionId", async (req, res) => {
  try {
    const { inscriptionId } = req.params;
    
    if (!inscriptionId) {
      throw new ValidationError("Inscription ID is required");
    }

    const ordinal = await xverseService.getOrdinalById(inscriptionId);
    res.json({ success: true, data: ordinal });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Ordinal"
    });
  }
});

// Get Ordinal collections for an address
router.get("/collections/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const collections = await xverseService.getOrdinalCollectionsByAddress(address, Number(offset), Number(limit));
    res.json({ success: true, data: collections });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get collections"
    });
  }
});

// Get top Ordinal collections
router.get("/ordinals/top", async (req, res) => {
  try {
    const topOrdinals = await xverseService.getTopOrdinalCollections();
    res.json({ success: true, data: topOrdinals });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get top Ordinals"
    });
  }
});

// Get Runes for an address
router.get("/runes/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const runes = await xverseService.getRunesByAddressV2(address, Number(offset), Number(limit));
    res.json({ success: true, data: runes });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Runes"
    });
  }
});

// Get Rune by ID
router.get("/rune/:runeId", async (req, res) => {
  try {
    const { runeId } = req.params;
    
    if (!runeId) {
      throw new ValidationError("Rune ID is required");
    }

    const rune = await xverseService.getRuneById(runeId);
    res.json({ success: true, data: rune });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Rune"
    });
  }
});

// Search Runes
router.get("/runes/search/:query", async (req, res) => {
  try {
    const { query } = req.params;
    
    if (!query) {
      throw new ValidationError("Search query is required");
    }

    const runes = await xverseService.searchRunes(query);
    res.json({ success: true, data: runes });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to search Runes"
    });
  }
});

// Get top Runes by volume
router.get("/runes/top", async (req, res) => {
  try {
    const topRunes = await xverseService.getTopRunesByVolume();
    res.json({ success: true, data: topRunes });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get top Runes"
    });
  }
});

// Get Rune gainers and losers
router.get("/runes/gainers-losers", async (req, res) => {
  try {
    const gainersLosers = await xverseService.getRunesTopGainersLosers();
    res.json({ success: true, data: gainersLosers });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get gainers/losers"
    });
  }
});

// Get BRC-20 balances for an address
router.get("/brc20/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const balances = await xverseService.getBRC20BalancesByAddress(address, Number(offset), Number(limit));
    res.json({ success: true, data: balances });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get BRC-20 balances"
    });
  }
});

// Get BRC-20 transaction history for an address
router.get("/brc20/history/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const history = await xverseService.getBRC20TransactionHistoryByAddress(address, Number(offset), Number(limit));
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get BRC-20 history"
    });
  }
});

// Get BRC-20 token by ticker
router.get("/brc20/token/:ticker", async (req, res) => {
  try {
    const { ticker } = req.params;
    
    if (!ticker) {
      throw new ValidationError("Ticker is required");
    }

    const token = await xverseService.getBRC20ByTicker(ticker);
    res.json({ success: true, data: token });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get BRC-20 token"
    });
  }
});

// Get Spark balances for an address
router.get("/spark/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { offset = 0, limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const balances = await xverseService.getSparkBalancesByAddress(address, Number(offset), Number(limit));
    res.json({ success: true, data: balances });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get Spark balances"
    });
  }
});

// Get mempool fees
router.get("/fees", async (req, res) => {
  try {
    const fees = await xverseService.getMempoolFees();
    res.json({ success: true, data: fees });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get mempool fees"
    });
  }
});

// Get current block
router.get("/block/current", async (req, res) => {
  try {
    const block = await xverseService.getCurrentBlock();
    res.json({ success: true, data: block });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get current block"
    });
  }
});

// Get block by height
router.get("/block/:height", async (req, res) => {
  try {
    const { height } = req.params;
    
    if (!height) {
      throw new ValidationError("Block height is required");
    }

    const block = await xverseService.getBlockByHeight(Number(height));
    res.json({ success: true, data: block });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get block"
    });
  }
});

// Validate Bitcoin address
router.get("/validate/:address", async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const isValid = xverseService.isValidAddress(address);
    res.json({ success: true, data: { address, isValid } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to validate address"
    });
  }
});

// Create Bitcoin wallet
router.post("/wallet", async (req, res) => {
  try {
    const wallet = await xverseService.createWallet();
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create wallet"
    });
  }
});

// Create transaction with mnemonic
router.post("/transaction/mnemonic", async (req, res) => {
  try {
    const { mnemonic, inputs, outputs, feeRate } = req.body;
    
    if (!mnemonic || !inputs || !outputs) {
      throw new ValidationError("Mnemonic, inputs, and outputs are required");
    }

    const transactionRequest = {
      inputs,
      outputs,
      feeRate: feeRate || 10
    };

    const signedTransaction = await xverseService.createTransactionWithMnemonic(transactionRequest, mnemonic);
    res.json({ success: true, data: signedTransaction });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create transaction with mnemonic"
    });
  }
});

// Get address from mnemonic
router.post("/address/mnemonic", async (req, res) => {
  try {
    const { mnemonic, derivationPath } = req.body;
    
    if (!mnemonic) {
      throw new ValidationError("Mnemonic is required");
    }

    const address = xverseService.getAddressFromMnemonic(mnemonic, derivationPath);
    res.json({ success: true, data: { address, mnemonic } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get address from mnemonic"
    });
  }
});

// Bitcoin operations through intent agent
router.post("/bitcoin", async (req, res) => {
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
      error: error instanceof Error ? error.message : "Failed to process Bitcoin command"
    });
  }
});

export default router;
