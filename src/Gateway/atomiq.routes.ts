import express from 'express';
import { atomiqService } from '../services/AtomiqService';
import { intentAgent } from '../Agents/agents/intentagent';
import { authenticate } from '../Auth/auth';
import { UnauthorizedError, ValidationError } from '../utils/error';

const router = express.Router();

// Create swap
router.post('/swap', async (req, res) => {
  try {
    const {
      userId,
      fromAsset,
      toAsset,
      amount,
      fromChain,
      toChain,
      recipientAddress,
    } = req.body;

    if (!userId || !fromAsset || !toAsset || !amount) {
      throw new ValidationError(
        'UserId, from asset, to asset, and amount are required'
      );
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Map asset names to SDK tokens
    let srcToken, dstToken;

    if (fromAsset === 'BTC' && toAsset === 'STRK') {
      srcToken = atomiqService.tokens.BITCOIN.BTC;
      dstToken = atomiqService.tokens.STARKNET.STRK;
    } else if (fromAsset === 'STRK' && toAsset === 'BTC') {
      srcToken = atomiqService.tokens.STARKNET.STRK;
      dstToken = atomiqService.tokens.BITCOIN.BTC;
    } else if (fromAsset === 'BTC' && toAsset === 'BTCLN') {
      srcToken = atomiqService.tokens.BITCOIN.BTC;
      dstToken = atomiqService.tokens.BITCOIN.BTCLN;
    } else if (fromAsset === 'STRK' && toAsset === 'BTCLN') {
      srcToken = atomiqService.tokens.STARKNET.STRK;
      dstToken = atomiqService.tokens.BITCOIN.BTCLN;
    } else {
      throw new ValidationError(
        `Unsupported asset pair: ${fromAsset} -> ${toAsset}`
      );
    }

    const swap = await atomiqService.createSwap(
      srcToken,
      dstToken,
      BigInt(amount),
      true, // exactIn = true
      userId, // source address
      recipientAddress || userId // destination address
    );

    res.json({
      success: true,
      data: {
        swapId: swap.getId(),
        fromAsset,
        toAsset,
        amount,
        fromChain,
        toChain,
        recipientAddress,
        swap: swap,
        message: `Swap created: ${amount} ${fromAsset} to ${toAsset}`,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create swap',
    });
  }
});

// Get swap by ID
router.get('/swap/:swapId', async (req, res) => {
  try {
    const { swapId } = req.params;

    if (!swapId) {
      throw new ValidationError('Swap ID is required');
    }

    const swap = await atomiqService.getSwapById(swapId);
    res.json({ success: true, data: swap });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get swap',
    });
  }
});

// Get refundable swaps
router.get('/refundable/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { chain } = req.query;

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const refundableSwaps = await atomiqService.getRefundableSwaps(
      (chain as string) || 'STARKNET',
      userId
    );
    res.json({
      success: true,
      data: {
        chain: chain || 'STARKNET',
        address: userId,
        refundableSwaps,
        count: refundableSwaps.length,
        message: `Found ${refundableSwaps.length} refundable swaps`,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get refundable swaps',
    });
  }
});

// Get spendable balance
router.post('/spendable-balance', async (req, res) => {
  try {
    const { userId, signer, token } = req.body;

    if (!userId || !signer || !token) {
      throw new ValidationError('UserId, signer, and token are required');
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const spendableBalance = await atomiqService.getSpendableBalance(
      signer,
      token
    );
    res.json({
      success: true,
      data: {
        spendableBalance,
        message: 'Spendable balance retrieved',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get spendable balance',
    });
  }
});

// Parse address
router.get('/parse-address/:address', async (req, res) => {
  try {
    const { address } = req.params;

    if (!address) {
      throw new ValidationError('Address is required');
    }

    const parsedAddress = await atomiqService.parseAddress(address);
    res.json({
      success: true,
      data: {
        address,
        parsedAddress,
        message: 'Address parsed successfully',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse address',
    });
  }
});

// Get Bitcoin spendable balance
router.get('/bitcoin-balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { destinationChain } = req.query;

    if (!address) {
      throw new ValidationError('Address is required');
    }

    const bitcoinSpendable = await atomiqService.getBitcoinSpendableBalance(
      address,
      (destinationChain as string) || 'STARKNET'
    );
    res.json({
      success: true,
      data: {
        bitcoinAddress: address,
        destinationChain: destinationChain || 'STARKNET',
        bitcoinSpendable,
        message: `Bitcoin spendable balance retrieved for ${address}`,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get Bitcoin spendable balance',
    });
  }
});

// Get swap limits
router.get('/limits', async (req, res) => {
  try {
    const limits = atomiqService.getSwapLimits(
      atomiqService.tokens.STARKNET.STRK,
      atomiqService.tokens.BITCOIN.BTC
    );
    res.json({
      success: true,
      data: {
        limits,
        message: 'Swap limits retrieved',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to get swap limits',
    });
  }
});

// Cross-chain operations through intent agent
router.post('/cross-chain', async (req, res) => {
  try {
    const { userId, command } = req.body;

    if (!userId || !command) {
      throw new ValidationError('UserId and command are required');
    }

    const user = await authenticate(userId);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const result = await intentAgent.handle(command, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to process cross-chain command',
    });
  }
});

export default router;
