import express from "express";
import { xverseService } from "../services/XVerseService";
import { authenticate } from "../Auth/auth";
import { UnauthorizedError, ValidationError } from "../utils/error";

const router = express.Router();

// Health check endpoint
router.get("/health", async (req, res) => {
  try {
    const health = await xverseService.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: "error",
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
      error: error instanceof Error ? error.message : "Failed to fetch balance"
    });
  }
});

// Get Bitcoin UTXOs for an address
router.get("/utxos/:address", async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const { offset = 0, limit = 60 } = req.query;
    const utxos = await xverseService.getAddressUTXOs(address, parseInt(offset as string), parseInt(limit as string));
    res.json({ success: true, data: utxos });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch UTXOs"
    });
  }
});

// Get Bitcoin transaction history for an address
router.get("/transactions/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;
    
    if (!address) {
      throw new ValidationError("Address is required");
    }

    const transactions = await xverseService.getAddressTransactions(address, parseInt(limit as string));
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch transaction history"
    });
  }
});

// Get specific Bitcoin transaction
router.get("/transaction/:txid", async (req, res) => {
  try {
    const { txid } = req.params;
    
    if (!txid) {
      throw new ValidationError("Transaction ID is required");
    }

    const transaction = await xverseService.getTransaction(txid);
    res.json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch transaction"
    });
  }
});

// Get raw transaction hex
router.get("/transaction/:txid/hex", async (req, res) => {
  try {
    const { txid } = req.params;
    
    if (!txid) {
      throw new ValidationError("Transaction ID is required");
    }

    const hex = await xverseService.getRawTransaction(txid);
    res.json({ success: true, data: hex });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch raw transaction hex"
    });
  }
});

// Decode raw transaction
router.post("/transaction/decode", async (req, res) => {
  try {
    const { hex } = req.body;
    
    if (!hex) {
      throw new ValidationError("Raw transaction hex is required");
    }

    const decodedTx = await xverseService.decodeRawTransaction(hex);
    res.json({ success: true, data: decodedTx });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to decode raw transaction"
    });
  }
});



// Create and sign Bitcoin transaction
router.post("/transaction/create", async (req, res) => {
  try {
    const { inputs, outputs, feeRate, privateKey } = req.body;
    
    if (!inputs || !outputs || !privateKey) {
      throw new ValidationError("Inputs, outputs, and private key are required");
    }

    const signedTx = await xverseService.createTransaction({ inputs, outputs, feeRate }, privateKey);
    res.json({ success: true, data: signedTx });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create transaction"
    });
  }
});

// Send raw transaction
router.post("/transaction/send", async (req, res) => {
  try {
    const { hex } = req.body;
    
    if (!hex) {
      throw new ValidationError("Raw transaction hex is required");
    }

    const txid = await xverseService.sendRawTransaction(hex);
    res.json({ success: true, data: { txid } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to send transaction"
    });
  }
});

// Create new Bitcoin wallet
router.post("/wallet/create", async (req, res) => {
  try {
    const wallet = xverseService.createWallet();
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create wallet"
    });
  }
});

// Import wallet from mnemonic
router.post("/wallet/import/mnemonic", async (req, res) => {
  try {
    const { mnemonic } = req.body;
    
    if (!mnemonic) {
      throw new ValidationError("Mnemonic is required");
    }

    const wallet = xverseService.importWalletFromMnemonic(mnemonic);
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to import wallet from mnemonic"
    });
  }
});

// Import wallet from private key
router.post("/wallet/import/privatekey", async (req, res) => {
  try {
    const { privateKey } = req.body;
    
    if (!privateKey) {
      throw new ValidationError("Private key is required");
    }

    const wallet = xverseService.importWalletFromPrivateKey(privateKey);
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to import wallet from private key"
    });
  }
});

// Validate Bitcoin address
router.post("/address/validate", async (req, res) => {
  try {
    const { address } = req.body;
    
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

// Get destination tokens for swaps
router.get("/swap/tokens", async (req, res) => {
  try {
    const { sourceChain, sourceToken } = req.query;
    
    if (!sourceChain || !sourceToken) {
      throw new ValidationError("Source chain and token are required");
    }

    const tokens = await xverseService.getDestinationTokens(sourceChain as string, sourceToken as string);
    res.json({ success: true, data: tokens });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get destination tokens"
    });
  }
});

// Get swap quotes
router.post("/swap/quotes", async (req, res) => {
  try {
    const { inputToken, outputToken, inputAmount, inputChain, outputChain } = req.body;
    
    if (!inputToken || !outputToken || !inputAmount || !inputChain || !outputChain) {
      throw new ValidationError("Input token, output token, input amount, input chain, and output chain are required");
    }

    const quotes = await xverseService.getSwapQuotes(inputToken, outputToken, inputAmount, inputChain, outputChain);
    res.json({ success: true, data: quotes });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get swap quotes"
    });
  }
});

// Place swap order
router.post("/swap/order", async (req, res) => {
  try {
    const orderData = req.body;
    
    if (!orderData) {
      throw new ValidationError("Order data is required");
    }

    const order = await xverseService.placeSwapOrder(orderData);
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to place swap order"
    });
  }
});

// Execute swap order
router.post("/swap/order/:orderId/execute", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { signature } = req.body;
    
    if (!orderId || !signature) {
      throw new ValidationError("Order ID and signature are required");
    }

    const result = await xverseService.executeSwapOrder(orderId, signature);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute swap order"
    });
  }
});

export default router;