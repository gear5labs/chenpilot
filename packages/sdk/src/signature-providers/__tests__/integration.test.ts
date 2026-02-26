import { ChainId } from "../../types";
import { SignatureProviderRegistry } from "../registry";
import { SignatureProviderFactory, ProviderType } from "../provider-factory";
import {
  MultiSignatureCoordinator,
  SignerInfo,
  MultiSignatureConfig,
  SignatureStatus,
} from "../multi-signature-coordinator";
import {
  SignatureVerificationUtils,
  SignatureVerificationRequest,
} from "../signature-verification";
import { MockSignatureProvider } from "../mock-provider";
import {
  SignatureRequest,
  StellarTransaction,
  BitcoinTransaction,
  StarknetTransaction,
} from "../types";
import { UserRejectedError, ConnectionError } from "../errors";

describe("SignatureProvider Integration Tests", () => {
  let registry: SignatureProviderRegistry;
  let factory: SignatureProviderFactory;
  let coordinator: MultiSignatureCoordinator;

  beforeEach(() => {
    registry = new SignatureProviderRegistry();
    factory = new SignatureProviderFactory({
      defaultRegistry: registry,
      enableLogging: false,
    });
    coordinator = new MultiSignatureCoordinator();
  });

  afterEach(async () => {
    await factory.dispose();
    registry.clear();
  });

  describe("End-to-End Provider Workflow", () => {
    it("should complete full provider lifecycle", async () => {
      // 1. Discover available providers
      const discoveries = await factory.discoverProviders();
      expect(discoveries.length).toBeGreaterThan(0);

      // 2. Create providers for Stellar chain
      const providers = await factory.createProvidersForChain(ChainId.STELLAR, {
        autoConnect: true,
        autoRegister: true,
      });
      expect(providers.length).toBeGreaterThan(0);

      // 3. Verify providers are registered
      const registeredProviders = registry.listProviders();
      expect(registeredProviders.length).toBe(providers.length);

      // 4. Get accounts from first provider
      const provider = providers[0];
      const accounts = await provider.getAccounts(ChainId.STELLAR);
      expect(accounts.length).toBeGreaterThan(0);

      // 5. Sign a transaction
      const transaction: StellarTransaction = {
        sourceAccount: accounts[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: "GTEST123",
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

      const result = await provider.signTransaction(signatureRequest);
      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();

      // 6. Verify the signature
      const verificationRequest: SignatureVerificationRequest = {
        signature: result.signature,
        publicKey: result.publicKey,
        transactionData: signatureRequest.transactionData,
        chainId: ChainId.STELLAR,
      };

      const verification =
        await SignatureVerificationUtils.verifySignature(verificationRequest);
      expect(verification.chainId).toBe(ChainId.STELLAR);

      // 7. Disconnect and cleanup
      await provider.disconnect();
      expect(provider.isConnected()).toBe(false);
    });

    it("should handle multi-chain workflow", async () => {
      // Create providers for different chains
      const bitcoinProviders = await factory.createProvidersForChain(
        ChainId.BITCOIN,
        {
          autoConnect: true,
          autoRegister: true,
        }
      );

      const stellarProviders = await factory.createProvidersForChain(
        ChainId.STELLAR,
        {
          autoConnect: true,
          autoRegister: true,
        }
      );

      const starknetProviders = await factory.createProvidersForChain(
        ChainId.STARKNET,
        {
          autoConnect: true,
          autoRegister: true,
        }
      );

      expect(bitcoinProviders.length).toBeGreaterThan(0);
      expect(stellarProviders.length).toBeGreaterThan(0);
      expect(starknetProviders.length).toBeGreaterThan(0);

      // Test signing on each chain
      const chains = [
        { chainId: ChainId.BITCOIN, providers: bitcoinProviders },
        { chainId: ChainId.STELLAR, providers: stellarProviders },
        { chainId: ChainId.STARKNET, providers: starknetProviders },
      ];

      for (const { chainId, providers } of chains) {
        const provider = providers[0];
        const accounts = await provider.getAccounts(chainId);
        expect(accounts.length).toBeGreaterThan(0);

        const transaction = createTestTransaction(chainId, accounts[0].address);
        const signatureRequest: SignatureRequest = {
          transactionData: { chainId, transaction },
          accountAddress: accounts[0].address,
        };

        const result = await provider.signTransaction(signatureRequest);
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
      }
    });
  });

  describe("Multi-Signature Integration", () => {
    it("should complete multi-signature workflow", async () => {
      // Create multiple providers for multi-sig
      const mockProvider1 = new MockSignatureProvider("multisig-provider-1");
      const mockProvider2 = new MockSignatureProvider("multisig-provider-2");
      const mockProvider3 = new MockSignatureProvider("multisig-provider-3");

      coordinator.registerProvider(mockProvider1);
      coordinator.registerProvider(mockProvider2);
      coordinator.registerProvider(mockProvider3);

      // Connect all providers
      await mockProvider1.connect();
      await mockProvider2.connect();
      await mockProvider3.connect();

      // Get accounts from each provider
      const accounts1 = await mockProvider1.getAccounts(ChainId.STELLAR);
      const accounts2 = await mockProvider2.getAccounts(ChainId.STELLAR);
      const accounts3 = await mockProvider3.getAccounts(ChainId.STELLAR);

      // Setup multi-signature configuration
      const signers: SignerInfo[] = [
        {
          providerId: "multisig-provider-1",
          accountAddress: accounts1[0].address,
          publicKey: accounts1[0].publicKey,
          required: true,
        },
        {
          providerId: "multisig-provider-2",
          accountAddress: accounts2[0].address,
          publicKey: accounts2[0].publicKey,
          required: true,
        },
        {
          providerId: "multisig-provider-3",
          accountAddress: accounts3[0].address,
          publicKey: accounts3[0].publicKey,
          required: false,
        },
      ];

      const config: MultiSignatureConfig = {
        requiredSignatures: 2,
        totalSigners: 3,
        allowPartialSigning: true,
        continueOnError: true,
      };

      // Create transaction
      const transaction: StellarTransaction = {
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

      const transactionData = {
        chainId: ChainId.STELLAR,
        transaction,
      };

      // Execute multi-signature workflow
      const workflowResult = await coordinator.startWorkflow(
        transactionData,
        signers,
        config
      );

      expect(workflowResult.status).toBe("completed");
      expect(workflowResult.requiredMet).toBe(true);
      expect(
        workflowResult.signatures.filter(
          (s) => s.status === SignatureStatus.COMPLETED
        ).length
      ).toBeGreaterThanOrEqual(2);
      expect(workflowResult.finalTransaction).toBeDefined();

      // Verify multi-signature result
      const completedSignatures = workflowResult.signatures.filter(
        (s) => s.status === SignatureStatus.COMPLETED
      );

      const multiSigVerification =
        await SignatureVerificationUtils.verifyMultiSignature(
          completedSignatures.map((s) => ({
            signature: s.signature!,
            publicKey: s.signerInfo.publicKey!,
          })),
          transactionData,
          ChainId.STELLAR,
          config.requiredSignatures
        );

      expect(multiSigVerification.thresholdMet).toBe(true);
      expect(
        multiSigVerification.validSignatures.length
      ).toBeGreaterThanOrEqual(config.requiredSignatures);

      // Cleanup
      await mockProvider1.disconnect();
      await mockProvider2.disconnect();
      await mockProvider3.disconnect();
    });

    it("should handle multi-signature with failures", async () => {
      // Create providers with one that will fail
      const mockProvider1 = new MockSignatureProvider("fail-provider-1");
      const mockProvider2 = new MockSignatureProvider(
        "fail-provider-2",
        undefined,
        {
          shouldFailSigning: true,
        }
      );
      const mockProvider3 = new MockSignatureProvider("fail-provider-3");

      coordinator.registerProvider(mockProvider1);
      coordinator.registerProvider(mockProvider2);
      coordinator.registerProvider(mockProvider3);

      await mockProvider1.connect();
      await mockProvider2.connect();
      await mockProvider3.connect();

      const accounts1 = await mockProvider1.getAccounts(ChainId.STELLAR);
      const accounts2 = await mockProvider2.getAccounts(ChainId.STELLAR);
      const accounts3 = await mockProvider3.getAccounts(ChainId.STELLAR);

      const signers: SignerInfo[] = [
        {
          providerId: "fail-provider-1",
          accountAddress: accounts1[0].address,
          publicKey: accounts1[0].publicKey,
          required: true,
        },
        {
          providerId: "fail-provider-2",
          accountAddress: accounts2[0].address,
          publicKey: accounts2[0].publicKey,
          required: false, // Not required, so failure is OK
        },
        {
          providerId: "fail-provider-3",
          accountAddress: accounts3[0].address,
          publicKey: accounts3[0].publicKey,
          required: true,
        },
      ];

      const config: MultiSignatureConfig = {
        requiredSignatures: 2,
        totalSigners: 3,
        allowPartialSigning: true,
        continueOnError: true,
      };

      const transaction: StellarTransaction = {
        sourceAccount: accounts1[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment", destination: "GTEST", amount: "50" }],
      };

      const workflowResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction },
        signers,
        config
      );

      expect(workflowResult.status).toBe("completed");
      expect(workflowResult.requiredMet).toBe(true);

      const completedSignatures = workflowResult.signatures.filter(
        (s) => s.status === SignatureStatus.COMPLETED
      );
      const failedSignatures = workflowResult.signatures.filter(
        (s) => s.status === SignatureStatus.FAILED
      );

      expect(completedSignatures.length).toBe(2);
      expect(failedSignatures.length).toBe(1);

      // Cleanup
      await mockProvider1.disconnect();
      await mockProvider2.disconnect();
      await mockProvider3.disconnect();
    });
  });

  describe("Provider Registry Integration", () => {
    it("should manage provider lifecycle through registry", async () => {
      // Create providers using factory
      const providers = await factory.createProviders(
        [
          { type: ProviderType.MOCK },
          { type: ProviderType.LEDGER },
          { type: ProviderType.ALBEDO },
        ],
        {
          autoConnect: true,
          autoRegister: true,
        }
      );

      expect(providers.length).toBe(3);
      expect(registry.getProviderCount()).toBe(3);

      // Test provider discovery through registry
      const stellarProviders = registry.findProvidersForChain(ChainId.STELLAR);
      expect(stellarProviders.length).toBeGreaterThan(0);

      const bitcoinProviders = registry.findProvidersForChain(ChainId.BITCOIN);
      expect(bitcoinProviders.length).toBeGreaterThan(0);

      // Test multi-chain provider discovery
      const multiChainProviders = registry.findMultiChainProviders([
        ChainId.STELLAR,
        ChainId.BITCOIN,
      ]);
      expect(multiChainProviders.length).toBeGreaterThan(0);

      // Test provider removal
      const providerId = providers[0].providerId;
      registry.unregister(providerId);
      expect(registry.hasProvider(providerId)).toBe(false);
      expect(registry.getProviderCount()).toBe(2);
    });

    it("should handle provider registration events", async () => {
      const registrationEvents: string[] = [];
      const unregistrationEvents: string[] = [];

      registry.onProviderRegistered((providerId) => {
        registrationEvents.push(providerId);
      });

      registry.onProviderUnregistered((providerId) => {
        unregistrationEvents.push(providerId);
      });

      // Create and register providers
      const provider1 = await factory.createProvider(
        { type: ProviderType.MOCK },
        {
          autoRegister: true,
        }
      );

      const provider2 = await factory.createProvider(
        { type: ProviderType.LEDGER },
        {
          autoRegister: true,
        }
      );

      expect(registrationEvents).toContain(provider1.providerId);
      expect(registrationEvents).toContain(provider2.providerId);

      // Unregister providers
      registry.unregister(provider1.providerId);
      registry.unregister(provider2.providerId);

      expect(unregistrationEvents).toContain(provider1.providerId);
      expect(unregistrationEvents).toContain(provider2.providerId);
    });
  });

  describe("Error Handling Integration", () => {
    it("should handle provider connection failures gracefully", async () => {
      // Create provider that will fail to connect
      const provider = new MockSignatureProvider(
        "failing-provider",
        undefined,
        {
          shouldFailConnection: true,
        }
      );

      await expect(provider.connect()).rejects.toThrow(ConnectionError);

      // Registry should handle failed providers
      expect(() => registry.register(provider)).not.toThrow();
      expect(registry.hasProvider("failing-provider")).toBe(true);
    });

    it("should handle signing failures in multi-signature workflow", async () => {
      const mockProvider1 = new MockSignatureProvider("error-provider-1");
      const mockProvider2 = new MockSignatureProvider(
        "error-provider-2",
        undefined,
        {
          shouldRejectSigning: true,
        }
      );

      coordinator.registerProvider(mockProvider1);
      coordinator.registerProvider(mockProvider2);

      await mockProvider1.connect();
      await mockProvider2.connect();

      const accounts1 = await mockProvider1.getAccounts(ChainId.STELLAR);
      const accounts2 = await mockProvider2.getAccounts(ChainId.STELLAR);

      const signers: SignerInfo[] = [
        {
          providerId: "error-provider-1",
          accountAddress: accounts1[0].address,
          required: true,
        },
        {
          providerId: "error-provider-2",
          accountAddress: accounts2[0].address,
          required: false,
        },
      ];

      const config: MultiSignatureConfig = {
        requiredSignatures: 1,
        totalSigners: 2,
        continueOnError: true,
      };

      const transaction: StellarTransaction = {
        sourceAccount: accounts1[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      };

      const workflowResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction },
        signers,
        config
      );

      expect(workflowResult.status).toBe("completed");

      const rejectedSignatures = workflowResult.signatures.filter(
        (s) => s.status === SignatureStatus.REJECTED
      );
      expect(rejectedSignatures.length).toBe(1);
      expect(rejectedSignatures[0].error).toBeInstanceOf(UserRejectedError);

      // Cleanup
      await mockProvider1.disconnect();
      await mockProvider2.disconnect();
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle multiple concurrent operations", async () => {
      // Create multiple providers
      const providers = await factory.createProviders(
        [
          { type: ProviderType.MOCK, config: { signingDelay: 100 } },
          { type: ProviderType.MOCK, config: { signingDelay: 150 } },
          { type: ProviderType.MOCK, config: { signingDelay: 200 } },
        ],
        {
          autoConnect: true,
        }
      );

      // Perform concurrent signing operations
      const signingPromises = providers.map(async (provider, index) => {
        const accounts = await provider.getAccounts(ChainId.STELLAR);
        const transaction: StellarTransaction = {
          sourceAccount: accounts[0].address,
          fee: "100",
          sequenceNumber: String(index + 1),
          operations: [{ type: "payment" }],
        };

        return provider.signTransaction({
          transactionData: { chainId: ChainId.STELLAR, transaction },
          accountAddress: accounts[0].address,
        });
      });

      const startTime = Date.now();
      const results = await Promise.all(signingPromises);
      const endTime = Date.now();

      expect(results.length).toBe(3);
      expect(results.every((r) => r.signature)).toBe(true);

      // Should complete faster than sequential execution
      expect(endTime - startTime).toBeLessThan(600); // Less than sum of delays
    });

    it("should handle batch signature verification", async () => {
      const provider = new MockSignatureProvider("batch-provider");
      await provider.connect();

      const accounts = await provider.getAccounts(ChainId.STELLAR);
      const verificationRequests: SignatureVerificationRequest[] = [];

      // Create multiple signature verification requests
      for (let i = 0; i < 10; i++) {
        const transaction: StellarTransaction = {
          sourceAccount: accounts[0].address,
          fee: "100",
          sequenceNumber: String(i + 1),
          operations: [{ type: "payment" }],
        };

        const signatureResult = await provider.signTransaction({
          transactionData: { chainId: ChainId.STELLAR, transaction },
          accountAddress: accounts[0].address,
        });

        verificationRequests.push({
          signature: signatureResult.signature,
          publicKey: signatureResult.publicKey,
          transactionData: { chainId: ChainId.STELLAR, transaction },
          chainId: ChainId.STELLAR,
        });
      }

      // Batch verify all signatures
      const startTime = Date.now();
      const verificationResults =
        await SignatureVerificationUtils.batchVerifySignatures(
          verificationRequests
        );
      const endTime = Date.now();

      expect(verificationResults.length).toBe(10);
      expect(
        verificationResults.every((r) => r.chainId === ChainId.STELLAR)
      ).toBe(true);

      console.log(
        `Batch verification of 10 signatures took ${endTime - startTime}ms`
      );

      await provider.disconnect();
    });
  });

  // Helper function to create test transactions for different chains
  function createTestTransaction(
    chainId: ChainId,
    sourceAccount: string
  ): unknown {
    switch (chainId) {
      case ChainId.BITCOIN:
        return {
          inputs: [{ txid: "test-txid", vout: 0 }],
          outputs: [{ value: 100000, scriptPubKey: "test-script" }],
        } as BitcoinTransaction;

      case ChainId.STELLAR:
        return {
          sourceAccount,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment", destination: "GTEST", amount: "10" }],
        } as StellarTransaction;

      case ChainId.STARKNET:
        return {
          contractAddress: "0x123",
          entrypoint: "transfer",
          calldata: ["0x456", "1000", "0"],
        } as StarknetTransaction;

      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }
});
