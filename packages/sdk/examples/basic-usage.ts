/**
 * @fileoverview Basic usage examples for the SignatureProvider SDK
 * @example
 *
 * // Basic provider creation and usage
 * import { SignatureProviderSDK, ProviderType, ChainId } from '@chen-pilot/sdk-core';
 *
 * const sdk = new SignatureProviderSDK();
 * await sdk.initialize();
 *
 * const provider = await sdk.createProvider(ProviderType.MOCK);
 * const accounts = await provider.getAccounts(ChainId.STELLAR);
 * console.log('Available accounts:', accounts);
 */

import {
  // Core SDK
  SignatureProviderSDK,
  SDKUtils,
  createSDKBuilder,

  // Provider types and factories
  ProviderType,
  SignatureProviderFactory,

  // Registry and coordination
  SignatureProviderRegistry,
  MultiSignatureCoordinator,

  // Verification utilities
  SignatureVerificationUtils,

  // Error handling
  signatureProviderErrorRecovery,

  // Types
  ChainId,
  SignatureRequest,
  MultiSignatureConfig,
  SignerInfo,

  // Provider implementations
  MockSignatureProvider,
  LedgerSignatureProvider,
} from "../src";

/**
 * Example 1: Basic SDK initialization and provider creation
 */
async function basicUsageExample() {
  console.log("=== Basic Usage Example ===");

  // Initialize SDK with default configuration
  const sdk = new SignatureProviderSDK({
    defaultProviders: [ProviderType.MOCK, ProviderType.LEDGER],
    autoDiscovery: true,
    enableMetrics: true,
    enableLogging: true,
  });

  await sdk.initialize();
  console.log("SDK initialized successfully");

  // Create a mock provider for testing
  const mockProvider = await sdk.createProvider(ProviderType.MOCK, {
    enableLogging: true,
  });

  console.log("Created provider:", mockProvider.providerId);
  console.log("Provider capabilities:", mockProvider.getCapabilities());

  // Get accounts for Stellar
  const accounts = await mockProvider.getAccounts(ChainId.STELLAR);
  console.log("Available accounts:", accounts.length);

  // Sign a simple transaction
  const transaction = {
    sourceAccount: accounts[0].address,
    fee: "100",
    sequenceNumber: "1",
    operations: [
      {
        type: "payment",
        destination: "GEXAMPLE123",
        asset: "native",
        amount: "10",
      },
    ],
  };

  const signatureRequest: SignatureRequest = {
    transactionData: {
      chainId: ChainId.STELLAR,
      transaction,
    },
    accountAddress: accounts[0].address,
  };

  const result = await mockProvider.signTransaction(signatureRequest);
  console.log("Transaction signed:", result.signature);

  // Cleanup
  await sdk.dispose();
}

/**
 * Example 2: Multi-signature workflow
 */
async function multiSignatureExample() {
  console.log("=== Multi-Signature Example ===");

  const coordinator = new MultiSignatureCoordinator();

  // Create multiple providers for multi-sig
  const provider1 = new MockSignatureProvider("multisig-1");
  const provider2 = new MockSignatureProvider("multisig-2");
  const provider3 = new MockSignatureProvider("multisig-3");

  // Register providers with coordinator
  coordinator.registerProvider(provider1);
  coordinator.registerProvider(provider2);
  coordinator.registerProvider(provider3);

  // Connect all providers
  await provider1.connect();
  await provider2.connect();
  await provider3.connect();

  // Get accounts from each provider
  const accounts1 = await provider1.getAccounts(ChainId.STELLAR);
  const accounts2 = await provider2.getAccounts(ChainId.STELLAR);
  const accounts3 = await provider3.getAccounts(ChainId.STELLAR);

  // Setup signers (2-of-3 multisig)
  const signers: SignerInfo[] = [
    {
      providerId: "multisig-1",
      accountAddress: accounts1[0].address,
      publicKey: accounts1[0].publicKey,
      required: true,
    },
    {
      providerId: "multisig-2",
      accountAddress: accounts2[0].address,
      publicKey: accounts2[0].publicKey,
      required: true,
    },
    {
      providerId: "multisig-3",
      accountAddress: accounts3[0].address,
      publicKey: accounts3[0].publicKey,
      required: false, // Optional third signer
    },
  ];

  const config: MultiSignatureConfig = {
    requiredSignatures: 2,
    totalSigners: 3,
    allowPartialSigning: true,
    continueOnError: true,
    description: "Example 2-of-3 multisig transaction",
  };

  const transaction = {
    sourceAccount: accounts1[0].address,
    fee: "100",
    sequenceNumber: "1",
    operations: [
      {
        type: "payment",
        destination: "GMULTISIG123",
        asset: "native",
        amount: "100",
      },
    ],
  };

  // Execute multi-signature workflow
  const workflowResult = await coordinator.startWorkflow(
    { chainId: ChainId.STELLAR, transaction },
    signers,
    config
  );

  console.log("Multi-signature workflow completed:", workflowResult.status);
  console.log("Required signatures met:", workflowResult.requiredMet);
  console.log("Total signatures collected:", workflowResult.signatures.length);

  // Cleanup
  await provider1.disconnect();
  await provider2.disconnect();
  await provider3.disconnect();
}

/**
 * Example 3: Provider discovery and selection
 */
async function providerDiscoveryExample() {
  console.log("=== Provider Discovery Example ===");

  const factory = new SignatureProviderFactory({
    enableLogging: true,
  });

  // Discover available providers
  const discoveries = await factory.discoverProviders();
  console.log("Available providers:");
  discoveries.forEach((discovery) => {
    console.log(
      `- ${discovery.type}: ${discovery.available ? "Available" : "Not available"}`
    );
    if (discovery.error) {
      console.log(`  Error: ${discovery.error}`);
    }
  });

  // Get providers for specific chain
  const stellarProviders = await factory.createProvidersForChain(
    ChainId.STELLAR,
    {
      autoConnect: true,
    }
  );
  console.log(`Found ${stellarProviders.length} providers for Stellar`);

  // Get the best provider for Bitcoin with preferences
  const bestBitcoinProvider = await factory.getBestProviderForChain(
    ChainId.BITCOIN,
    {
      preferHardwareWallet: true,
    }
  );
  console.log("Best Bitcoin provider:", bestBitcoinProvider.providerId);

  // Cleanup
  await factory.dispose();
}

/**
 * Example 4: Signature verification
 */
async function signatureVerificationExample() {
  console.log("=== Signature Verification Example ===");

  const provider = new MockSignatureProvider("verification-test");
  await provider.connect();

  const accounts = await provider.getAccounts(ChainId.STELLAR);

  // Create and sign a transaction
  const transaction = {
    sourceAccount: accounts[0].address,
    fee: "100",
    sequenceNumber: "1",
    operations: [{ type: "payment", destination: "GTEST", amount: "50" }],
  };

  const signatureResult = await provider.signTransaction({
    transactionData: { chainId: ChainId.STELLAR, transaction },
    accountAddress: accounts[0].address,
  });

  // Verify the signature
  const verificationResult = await SignatureVerificationUtils.verifySignature({
    signature: signatureResult.signature,
    publicKey: signatureResult.publicKey,
    transactionData: { chainId: ChainId.STELLAR, transaction },
    chainId: ChainId.STELLAR,
  });

  console.log("Signature verification result:", verificationResult.isValid);
  console.log("Signature algorithm:", verificationResult.algorithm);

  await provider.disconnect();
}

/**
 * Example 5: Error handling and recovery
 */
async function errorHandlingExample() {
  console.log("=== Error Handling Example ===");

  const provider = new MockSignatureProvider("error-test", undefined, {
    shouldFailSigning: true,
  });

  await provider.connect();

  const accounts = await provider.getAccounts(ChainId.STELLAR);

  try {
    await provider.signTransaction({
      transactionData: {
        chainId: ChainId.STELLAR,
        transaction: {
          sourceAccount: accounts[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment" }],
        },
      },
      accountAddress: accounts[0].address,
    });
  } catch (error) {
    console.log(
      "Signing failed as expected:",
      error instanceof Error ? error.message : error
    );

    // Check if error is recoverable
    const canRecover = signatureProviderErrorRecovery.canRecover(error);
    console.log("Error is recoverable:", canRecover);

    // Get recovery instructions
    const instructions =
      signatureProviderErrorRecovery.getRecoveryInstructions(error);
    console.log("Recovery instructions:", instructions);

    if (canRecover) {
      // Attempt recovery
      const recoveryResult = await signatureProviderErrorRecovery.recover(
        error,
        {
          providerId: provider.providerId,
          chainId: ChainId.STELLAR,
          retryCount: 0,
          maxRetries: 3,
        }
      );

      console.log("Recovery attempt result:", recoveryResult.success);
      if (recoveryResult.instructions) {
        console.log("Recovery instructions:", recoveryResult.instructions);
      }
    }
  }

  await provider.disconnect();
}

/**
 * Example 6: SDK Builder pattern
 */
async function sdkBuilderExample() {
  console.log("=== SDK Builder Example ===");

  // Use builder pattern for SDK configuration
  const sdk = await createSDKBuilder()
    .withDefaultProviders([ProviderType.MOCK, ProviderType.LEDGER])
    .withAutoDiscovery(true)
    .withMetrics(true)
    .withLogging(true)
    .withErrorRecovery({
      enabled: true,
      maxRetries: 5,
      retryDelay: 2000,
    })
    .withRegistry({
      autoRegister: true,
      validateProviders: true,
    })
    .build();

  console.log("SDK built and initialized with builder pattern");
  console.log("SDK configuration:", sdk.getConfig());

  // Use SDK utilities for quick operations
  const provider = await SDKUtils.quickCreateProvider(ProviderType.MOCK);
  console.log("Quick provider created:", provider.providerId);

  // Perform system health check
  const healthCheck = await SDKUtils.performSystemHealthCheck();
  console.log("System health:", healthCheck);

  // Get system metrics
  const metrics = SDKUtils.getSystemMetrics();
  console.log("System metrics:", metrics);

  await sdk.dispose();
}

/**
 * Example 7: Registry management
 */
async function registryManagementExample() {
  console.log("=== Registry Management Example ===");

  const registry = new SignatureProviderRegistry();

  // Create providers
  const mockProvider = new MockSignatureProvider("registry-mock");
  const ledgerProvider = new LedgerSignatureProvider();

  // Set up event listeners
  registry.onProviderRegistered((providerId, provider) => {
    console.log(`Provider registered: ${providerId}`);
    console.log(`Capabilities: ${JSON.stringify(provider.getCapabilities())}`);
  });

  registry.onProviderUnregistered((providerId) => {
    console.log(`Provider unregistered: ${providerId}`);
  });

  // Register providers
  registry.register(mockProvider);
  registry.register(ledgerProvider);

  console.log(`Total providers: ${registry.getProviderCount()}`);

  // Find providers by chain
  const stellarProviders = registry.findProvidersForChain(ChainId.STELLAR);
  console.log(`Stellar providers: ${stellarProviders.length}`);

  const bitcoinProviders = registry.findProvidersForChain(ChainId.BITCOIN);
  console.log(`Bitcoin providers: ${bitcoinProviders.length}`);

  // Find multi-chain providers
  const multiChainProviders = registry.findMultiChainProviders([
    ChainId.STELLAR,
    ChainId.BITCOIN,
  ]);
  console.log(`Multi-chain providers: ${multiChainProviders.length}`);

  // Cleanup
  registry.clear();
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await basicUsageExample();
    console.log("\n");

    await multiSignatureExample();
    console.log("\n");

    await providerDiscoveryExample();
    console.log("\n");

    await signatureVerificationExample();
    console.log("\n");

    await errorHandlingExample();
    console.log("\n");

    await sdkBuilderExample();
    console.log("\n");

    await registryManagementExample();

    console.log("\n=== All examples completed successfully! ===");
  } catch (error) {
    console.error("Example failed:", error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}

export {
  basicUsageExample,
  multiSignatureExample,
  providerDiscoveryExample,
  signatureVerificationExample,
  errorHandlingExample,
  sdkBuilderExample,
  registryManagementExample,
  runAllExamples,
};
