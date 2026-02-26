/**
 * @fileoverview Cross-Chain Bridge Example
 *
 * This example demonstrates how to implement a cross-chain bridge system
 * that coordinates signatures across multiple blockchain networks using
 * different signature providers for each chain.
 */

import {
  SignatureProviderSDK,
  MultiSignatureCoordinator,
  ChainId,
  SignerInfo,
  MultiSignatureConfig,
  MockSignatureProvider,
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "../src";

/**
 * Bridge operation types
 */
enum BridgeOperationType {
  LOCK = "lock",
  UNLOCK = "unlock",
  MINT = "mint",
  BURN = "burn",
}

/**
 * Bridge transaction request
 */
interface BridgeTransactionRequest {
  operationType: BridgeOperationType;
  sourceChain: ChainId;
  destinationChain: ChainId;
  amount: string;
  sourceAddress: string;
  destinationAddress: string;
  tokenContract?: string;
  bridgeId: string;
  nonce: number;
}

/**
 * Bridge validator configuration
 */
interface BridgeValidator {
  validatorId: string;
  supportedChains: ChainId[];
  providerId: string;
  publicKey: string;
  stake: string;
  reputation: number;
}

/**
 * Bridge operation result
 */
interface BridgeOperationResult {
  success: boolean;
  sourceTransactionHash?: string;
  destinationTransactionHash?: string;
  signatures: unknown[];
  validatorSignatures: number;
  requiredSignatures: number;
  bridgeProof?: string;
  error?: string;
}

/**
 * Cross-chain bridge coordinator
 */
class CrossChainBridge {
  private sdk: SignatureProviderSDK;
  private coordinators: Map<ChainId, MultiSignatureCoordinator> = new Map();
  private validators: Map<string, BridgeValidator> = new Map();
  private bridgeContracts: Map<ChainId, string> = new Map();
  private minValidatorSignatures: number;

  constructor(minValidatorSignatures: number = 3) {
    this.minValidatorSignatures = minValidatorSignatures;
    this.sdk = new SignatureProviderSDK({
      enableMetrics: true,
      enableLogging: true,
    });

    // Initialize coordinators for each supported chain
    for (const chainId of [
      ChainId.BITCOIN,
      ChainId.STELLAR,
      ChainId.STARKNET,
    ]) {
      this.coordinators.set(chainId, new MultiSignatureCoordinator());
    }

    // Set bridge contract addresses (mock addresses)
    this.bridgeContracts.set(ChainId.BITCOIN, "bc1qbridge123example");
    this.bridgeContracts.set(ChainId.STELLAR, "GBRIDGECONTRACT123EXAMPLE");
    this.bridgeContracts.set(
      ChainId.STARKNET,
      "0x1234567890abcdef1234567890abcdef12345678"
    );
  }

  /**
   * Initialize the bridge system
   */
  async initialize(): Promise<void> {
    console.log("🌉 Initializing Cross-Chain Bridge...");

    await this.sdk.initialize();

    // Setup event listeners for each chain coordinator
    for (const [chainId, coordinator] of this.coordinators) {
      coordinator.addEventListener((event) => {
        console.log(`🔗 [${chainId}] Bridge event: ${event.type}`);
      });
    }

    console.log("✅ Cross-chain bridge initialized");
  }

  /**
   * Add a bridge validator
   */
  async addValidator(validator: BridgeValidator): Promise<void> {
    console.log(`👨‍⚖️ Adding bridge validator: ${validator.validatorId}`);

    // Create provider for validator
    const provider = new MockSignatureProvider(
      validator.providerId,
      undefined,
      {
        enableLogging: true,
        customCapabilities: {
          supportedChains: validator.supportedChains,
        },
      }
    );

    await provider.connect();

    // Register provider with coordinators for supported chains
    for (const chainId of validator.supportedChains) {
      const coordinator = this.coordinators.get(chainId);
      if (coordinator) {
        coordinator.registerProvider(provider);
      }
    }

    this.validators.set(validator.validatorId, validator);
    console.log(
      `✅ Validator ${validator.validatorId} added for chains: ${validator.supportedChains.join(", ")}`
    );
  }

  /**
   * Execute a cross-chain bridge operation
   */
  async executeBridgeOperation(
    request: BridgeTransactionRequest
  ): Promise<BridgeOperationResult> {
    console.log(`🌉 Executing bridge operation: ${request.operationType}`);
    console.log(
      `   From: ${request.sourceChain} → To: ${request.destinationChain}`
    );
    console.log(`   Amount: ${request.amount}`);

    try {
      // Step 1: Execute source chain transaction
      const sourceResult = await this.executeSourceChainTransaction(request);
      if (!sourceResult.success) {
        return {
          success: false,
          error: `Source chain transaction failed: ${sourceResult.error}`,
          signatures: [],
          validatorSignatures: 0,
          requiredSignatures: this.minValidatorSignatures,
        };
      }

      // Step 2: Generate bridge proof
      const bridgeProof = await this.generateBridgeProof(
        request,
        sourceResult.transactionHash!
      );

      // Step 3: Execute destination chain transaction
      const destinationResult = await this.executeDestinationChainTransaction(
        request,
        bridgeProof
      );

      return {
        success: destinationResult.success,
        sourceTransactionHash: sourceResult.transactionHash,
        destinationTransactionHash: destinationResult.transactionHash,
        signatures: [
          ...sourceResult.signatures,
          ...destinationResult.signatures,
        ],
        validatorSignatures:
          sourceResult.validatorSignatures +
          destinationResult.validatorSignatures,
        requiredSignatures: this.minValidatorSignatures * 2, // Both chains
        bridgeProof,
        error: destinationResult.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        signatures: [],
        validatorSignatures: 0,
        requiredSignatures: this.minValidatorSignatures,
      };
    }
  }

  /**
   * Get bridge statistics
   */
  getBridgeStats(): {
    totalValidators: number;
    validatorsByChain: Record<ChainId, number>;
    supportedChains: ChainId[];
    minValidatorSignatures: number;
  } {
    const validatorsByChain: Record<ChainId, number> = {
      [ChainId.BITCOIN]: 0,
      [ChainId.STELLAR]: 0,
      [ChainId.STARKNET]: 0,
    };

    for (const validator of this.validators.values()) {
      for (const chainId of validator.supportedChains) {
        validatorsByChain[chainId]++;
      }
    }

    return {
      totalValidators: this.validators.size,
      validatorsByChain,
      supportedChains: Array.from(this.coordinators.keys()),
      minValidatorSignatures: this.minValidatorSignatures,
    };
  }

  /**
   * Verify bridge proof
   */
  async verifyBridgeProof(
    proof: string,
    sourceChain: ChainId,
    destinationChain: ChainId,
    amount: string
  ): Promise<boolean> {
    console.log(
      `🔍 Verifying bridge proof for ${sourceChain} → ${destinationChain}`
    );

    try {
      // In a real implementation, this would verify cryptographic proofs
      // For this example, we'll do basic validation
      const proofData = JSON.parse(proof);

      return (
        proofData.sourceChain === sourceChain &&
        proofData.destinationChain === destinationChain &&
        proofData.amount === amount &&
        proofData.validatorSignatures >= this.minValidatorSignatures
      );
    } catch {
      return false;
    }
  }

  /**
   * Cleanup bridge resources
   */
  async dispose(): Promise<void> {
    console.log("🧹 Disposing bridge resources...");
    await this.sdk.dispose();
    console.log("✅ Bridge disposed");
  }

  private async executeSourceChainTransaction(
    request: BridgeTransactionRequest
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    signatures: unknown[];
    validatorSignatures: number;
    error?: string;
  }> {
    console.log(
      `📤 Executing source chain transaction on ${request.sourceChain}`
    );

    const coordinator = this.coordinators.get(request.sourceChain);
    if (!coordinator) {
      return {
        success: false,
        error: `No coordinator for chain ${request.sourceChain}`,
        signatures: [],
        validatorSignatures: 0,
      };
    }

    // Get validators for source chain
    const validators = this.getValidatorsForChain(request.sourceChain);
    if (validators.length < this.minValidatorSignatures) {
      return {
        success: false,
        error: `Insufficient validators for ${request.sourceChain}`,
        signatures: [],
        validatorSignatures: 0,
      };
    }

    // Create signers
    const signers: SignerInfo[] = validators.map((validator) => ({
      providerId: validator.providerId,
      accountAddress: request.sourceAddress,
      publicKey: validator.publicKey,
      required: true,
      metadata: {
        validatorId: validator.validatorId,
        stake: validator.stake,
        reputation: validator.reputation,
      },
    }));

    // Create multi-signature configuration
    const config: MultiSignatureConfig = {
      requiredSignatures: this.minValidatorSignatures,
      totalSigners: validators.length,
      allowPartialSigning: false,
      continueOnError: true,
      timeout: 180000, // 3 minutes
      description: `Bridge ${request.operationType} on ${request.sourceChain}`,
    };

    // Create chain-specific transaction
    const transaction = this.createChainTransaction(
      request,
      request.sourceChain
    );

    try {
      const workflowResult = await coordinator.startWorkflow(
        { chainId: request.sourceChain, transaction },
        signers,
        config
      );

      if (workflowResult.status === "completed" && workflowResult.requiredMet) {
        return {
          success: true,
          transactionHash: `${request.sourceChain}-tx-${Date.now()}`,
          signatures: workflowResult.signatures,
          validatorSignatures: workflowResult.signatures.filter(
            (s) => s.status === "completed"
          ).length,
        };
      } else {
        return {
          success: false,
          error: "Insufficient validator signatures",
          signatures: workflowResult.signatures,
          validatorSignatures: workflowResult.signatures.filter(
            (s) => s.status === "completed"
          ).length,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        signatures: [],
        validatorSignatures: 0,
      };
    }
  }

  private async executeDestinationChainTransaction(
    request: BridgeTransactionRequest,
    bridgeProof: string
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    signatures: unknown[];
    validatorSignatures: number;
    error?: string;
  }> {
    console.log(
      `📥 Executing destination chain transaction on ${request.destinationChain}`
    );

    const coordinator = this.coordinators.get(request.destinationChain);
    if (!coordinator) {
      return {
        success: false,
        error: `No coordinator for chain ${request.destinationChain}`,
        signatures: [],
        validatorSignatures: 0,
      };
    }

    // Verify bridge proof first
    const proofValid = await this.verifyBridgeProof(
      bridgeProof,
      request.sourceChain,
      request.destinationChain,
      request.amount
    );

    if (!proofValid) {
      return {
        success: false,
        error: "Invalid bridge proof",
        signatures: [],
        validatorSignatures: 0,
      };
    }

    // Get validators for destination chain
    const validators = this.getValidatorsForChain(request.destinationChain);
    if (validators.length < this.minValidatorSignatures) {
      return {
        success: false,
        error: `Insufficient validators for ${request.destinationChain}`,
        signatures: [],
        validatorSignatures: 0,
      };
    }

    // Create destination transaction (mint/unlock)
    const destinationRequest: BridgeTransactionRequest = {
      ...request,
      operationType:
        request.operationType === BridgeOperationType.LOCK
          ? BridgeOperationType.MINT
          : BridgeOperationType.UNLOCK,
    };

    // Execute similar to source chain
    return this.executeSourceChainTransaction(destinationRequest);
  }

  private async generateBridgeProof(
    request: BridgeTransactionRequest,
    sourceTransactionHash: string
  ): Promise<string> {
    console.log("🔐 Generating bridge proof...");

    // In a real implementation, this would create cryptographic proofs
    // For this example, we'll create a simple proof structure
    const proofData = {
      sourceChain: request.sourceChain,
      destinationChain: request.destinationChain,
      amount: request.amount,
      sourceTransactionHash,
      bridgeId: request.bridgeId,
      nonce: request.nonce,
      timestamp: Date.now(),
      validatorSignatures: this.minValidatorSignatures,
    };

    return JSON.stringify(proofData);
  }

  private getValidatorsForChain(chainId: ChainId): BridgeValidator[] {
    return Array.from(this.validators.values()).filter((validator) =>
      validator.supportedChains.includes(chainId)
    );
  }

  private createChainTransaction(
    request: BridgeTransactionRequest,
    chainId: ChainId
  ): unknown {
    const bridgeContract = this.bridgeContracts.get(chainId);

    switch (chainId) {
      case ChainId.BITCOIN:
        return {
          inputs: [{ txid: "source-utxo", vout: 0 }],
          outputs: [
            {
              value: parseInt(request.amount),
              scriptPubKey: bridgeContract,
            },
          ],
          metadata: {
            bridgeOperation: request.operationType,
            destinationChain: request.destinationChain,
            destinationAddress: request.destinationAddress,
          },
        } as BitcoinTransaction;

      case ChainId.STELLAR:
        return {
          sourceAccount: request.sourceAddress,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type:
                request.operationType === BridgeOperationType.LOCK
                  ? "payment"
                  : "create_account",
              destination: bridgeContract,
              asset: "native",
              amount: request.amount,
            },
          ],
          memo: {
            type: "text",
            value: `Bridge:${request.destinationChain}:${request.destinationAddress}`,
          },
        } as StellarTransaction;

      case ChainId.STARKNET:
        return {
          contractAddress: bridgeContract!,
          entrypoint: request.operationType,
          calldata: [
            request.destinationAddress,
            request.amount,
            request.nonce.toString(),
          ],
          metadata: {
            bridgeId: request.bridgeId,
            sourceChain: request.sourceChain,
          },
        } as StarknetTransaction;

      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }
}

/**
 * Example usage of the Cross-Chain Bridge
 */
async function crossChainBridgeExample() {
  console.log("=== Cross-Chain Bridge Example ===\n");

  const bridge = new CrossChainBridge(3); // Require 3 validator signatures
  await bridge.initialize();

  try {
    // Add bridge validators
    const validators: BridgeValidator[] = [
      {
        validatorId: "validator-1",
        supportedChains: [ChainId.BITCOIN, ChainId.STELLAR],
        providerId: "validator-1-provider",
        publicKey: "0x1234567890abcdef",
        stake: "10000",
        reputation: 95,
      },
      {
        validatorId: "validator-2",
        supportedChains: [ChainId.STELLAR, ChainId.STARKNET],
        providerId: "validator-2-provider",
        publicKey: "0xabcdef1234567890",
        stake: "15000",
        reputation: 98,
      },
      {
        validatorId: "validator-3",
        supportedChains: [ChainId.BITCOIN, ChainId.STARKNET],
        providerId: "validator-3-provider",
        publicKey: "0x567890abcdef1234",
        stake: "12000",
        reputation: 92,
      },
      {
        validatorId: "validator-4",
        supportedChains: [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET],
        providerId: "validator-4-provider",
        publicKey: "0x90abcdef12345678",
        stake: "20000",
        reputation: 99,
      },
    ];

    for (const validator of validators) {
      await bridge.addValidator(validator);
    }

    console.log("\n📊 Bridge Statistics:");
    const stats = bridge.getBridgeStats();
    console.log(`Total Validators: ${stats.totalValidators}`);
    console.log(`Supported Chains: ${stats.supportedChains.join(", ")}`);
    console.log("Validators by Chain:", stats.validatorsByChain);

    // Example 1: Bitcoin to Stellar bridge
    console.log("\n🌉 Example 1: Bitcoin → Stellar Bridge");
    const btcToStellarRequest: BridgeTransactionRequest = {
      operationType: BridgeOperationType.LOCK,
      sourceChain: ChainId.BITCOIN,
      destinationChain: ChainId.STELLAR,
      amount: "0.1",
      sourceAddress: "bc1quser123example",
      destinationAddress: "GUSER123EXAMPLE",
      bridgeId: "btc-stellar-bridge",
      nonce: 1,
    };

    const btcToStellarResult =
      await bridge.executeBridgeOperation(btcToStellarRequest);
    console.log(
      "Bridge Result:",
      btcToStellarResult.success ? "✅ Success" : "❌ Failed"
    );
    if (btcToStellarResult.success) {
      console.log(`Source TX: ${btcToStellarResult.sourceTransactionHash}`);
      console.log(
        `Destination TX: ${btcToStellarResult.destinationTransactionHash}`
      );
      console.log(
        `Validator Signatures: ${btcToStellarResult.validatorSignatures}/${btcToStellarResult.requiredSignatures}`
      );
    } else {
      console.log(`Error: ${btcToStellarResult.error}`);
    }

    // Example 2: Stellar to Starknet bridge
    console.log("\n🌉 Example 2: Stellar → Starknet Bridge");
    const stellarToStarknetRequest: BridgeTransactionRequest = {
      operationType: BridgeOperationType.BURN,
      sourceChain: ChainId.STELLAR,
      destinationChain: ChainId.STARKNET,
      amount: "500",
      sourceAddress: "GUSER456EXAMPLE",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      tokenContract: "GTOKEN123EXAMPLE",
      bridgeId: "stellar-starknet-bridge",
      nonce: 2,
    };

    const stellarToStarknetResult = await bridge.executeBridgeOperation(
      stellarToStarknetRequest
    );
    console.log(
      "Bridge Result:",
      stellarToStarknetResult.success ? "✅ Success" : "❌ Failed"
    );
    if (stellarToStarknetResult.success) {
      console.log(
        `Source TX: ${stellarToStarknetResult.sourceTransactionHash}`
      );
      console.log(
        `Destination TX: ${stellarToStarknetResult.destinationTransactionHash}`
      );
      console.log(
        `Validator Signatures: ${stellarToStarknetResult.validatorSignatures}/${stellarToStarknetResult.requiredSignatures}`
      );
    } else {
      console.log(`Error: ${stellarToStarknetResult.error}`);
    }

    // Example 3: Bridge proof verification
    console.log("\n🔍 Example 3: Bridge Proof Verification");
    if (btcToStellarResult.success && btcToStellarResult.bridgeProof) {
      const proofValid = await bridge.verifyBridgeProof(
        btcToStellarResult.bridgeProof,
        ChainId.BITCOIN,
        ChainId.STELLAR,
        "0.1"
      );
      console.log(
        "Bridge Proof Valid:",
        proofValid ? "✅ Valid" : "❌ Invalid"
      );
    }
  } catch (error) {
    console.error("Bridge operation failed:", error);
  } finally {
    await bridge.dispose();
  }
}

// Run the example
if (require.main === module) {
  crossChainBridgeExample().catch(console.error);
}

export {
  CrossChainBridge,
  crossChainBridgeExample,
  BridgeOperationType,
  BridgeTransactionRequest,
  BridgeValidator,
  BridgeOperationResult,
};
