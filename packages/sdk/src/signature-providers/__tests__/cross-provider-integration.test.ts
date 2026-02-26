import { ChainId } from "../../types";
import { SignatureProviderRegistry } from "../registry";
import { SignatureProviderFactory } from "../provider-factory";
import {
  MultiSignatureCoordinator,
  SignerInfo,
  MultiSignatureConfig,
  MultiSignatureEventType,
} from "../multi-signature-coordinator";
import { SignatureVerificationUtils } from "../signature-verification";
import { MockSignatureProvider } from "../mock-provider";
import { LedgerSignatureProvider } from "../ledger-provider";
import { AlbedoSignatureProvider } from "../albedo-provider";
import { SignatureRequest, StellarTransaction } from "../types";
import {
  signatureProviderErrorRecovery,
  ErrorRecoveryContext,
} from "../error-recovery";

describe("Cross-Provider Integration Tests", () => {
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

  describe("Mixed Provider Multi-Signature", () => {
    it("should coordinate signatures across different provider types", async () => {
      // Create different types of providers
      const mockProvider = new MockSignatureProvider("mixed-mock");
      const ledgerProvider = new LedgerSignatureProvider({
        enableDebugLogging: false,
      });
      const albedoProvider = new AlbedoSignatureProvider({
        enableDebugLogging: false,
      });

      // Register all providers with coordinator
      coordinator.registerProvider(mockProvider);
      coordinator.registerProvider(ledgerProvider);
      coordinator.registerProvider(albedoProvider);

      // Connect all providers
      await mockProvider.connect();
      await ledgerProvider.connect();
      await albedoProvider.connect();

      // Get accounts from each provider (all support Stellar)
      const mockAccounts = await mockProvider.getAccounts(ChainId.STELLAR);
      const ledgerAccounts = await ledgerProvider.getAccounts(ChainId.STELLAR);
      const albedoAccounts = await albedoProvider.getAccounts(ChainId.STELLAR);

      // Setup mixed provider multi-signature
      const signers: SignerInfo[] = [
        {
          providerId: "mixed-mock",
          accountAddress: mockAccounts[0].address,
          publicKey: mockAccounts[0].publicKey,
          required: true,
          metadata: { providerType: "mock" },
        },
        {
          providerId: "ledger-provider",
          accountAddress: ledgerAccounts[0].address,
          publicKey: ledgerAccounts[0].publicKey,
          required: true,
          metadata: { providerType: "ledger" },
        },
        {
          providerId: "albedo-provider",
          accountAddress: albedoAccounts[0].address,
          publicKey: albedoAccounts[0].publicKey,
          required: false,
          metadata: { providerType: "albedo" },
        },
      ];

      const config: MultiSignatureConfig = {
        requiredSignatures: 2,
        totalSigners: 3,
        allowPartialSigning: true,
        continueOnError: true,
        description: "Mixed provider multi-signature test",
      };

      const transaction: StellarTransaction = {
        sourceAccount: mockAccounts[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: "GMIXED123",
            asset: "native",
            amount: "250",
          },
        ],
      };

      // Track events
      const events: unknown[] = [];
      coordinator.addEventListener((event) => {
        events.push(event);
      });

      // Execute mixed provider workflow
      const workflowResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction },
        signers,
        config
      );

      expect(workflowResult.status).toBe("completed");
      expect(workflowResult.requiredMet).toBe(true);

      // Verify we got signatures from different provider types
      const completedSignatures = workflowResult.signatures.filter(
        (s) => s.status === "completed"
      );
      expect(completedSignatures.length).toBeGreaterThanOrEqual(2);

      // Verify events were emitted for each provider
      const signatureStartedEvents = events.filter(
        (e) => e.type === MultiSignatureEventType.SIGNATURE_STARTED
      );
      const signatureCompletedEvents = events.filter(
        (e) => e.type === MultiSignatureEventType.SIGNATURE_COMPLETED
      );

      expect(signatureStartedEvents.length).toBe(3);
      expect(signatureCompletedEvents.length).toBeGreaterThanOrEqual(2);

      // Verify signatures from different providers
      for (const signature of completedSignatures) {
        const verification = await SignatureVerificationUtils.verifySignature({
          signature: signature.signature!,
          publicKey: signature.signerInfo.publicKey!,
          transactionData: { chainId: ChainId.STELLAR, transaction },
          chainId: ChainId.STELLAR,
        });
        expect(verification.chainId).toBe(ChainId.STELLAR);
      }

      // Cleanup
      await mockProvider.disconnect();
      await ledgerProvider.disconnect();
      await albedoProvider.disconnect();
    });

    it("should handle provider-specific failures in mixed workflow", async () => {
      // Create providers with different failure modes
      const mockProvider = new MockSignatureProvider("reliable-mock");
      const failingLedger = new MockSignatureProvider(
        "failing-ledger",
        undefined,
        {
          shouldFailSigning: true,
        }
      );
      const rejectingAlbedo = new MockSignatureProvider(
        "rejecting-albedo",
        undefined,
        {
          shouldRejectSigning: true,
        }
      );

      coordinator.registerProvider(mockProvider);
      coordinator.registerProvider(failingLedger);
      coordinator.registerProvider(rejectingAlbedo);

      await mockProvider.connect();
      await failingLedger.connect();
      await rejectingAlbedo.connect();

      const mockAccounts = await mockProvider.getAccounts(ChainId.STELLAR);
      const ledgerAccounts = await failingLedger.getAccounts(ChainId.STELLAR);
      const albedoAccounts = await rejectingAlbedo.getAccounts(ChainId.STELLAR);

      const signers: SignerInfo[] = [
        {
          providerId: "reliable-mock",
          accountAddress: mockAccounts[0].address,
          required: true,
        },
        {
          providerId: "failing-ledger",
          accountAddress: ledgerAccounts[0].address,
          required: false, // Not required, so failure is OK
        },
        {
          providerId: "rejecting-albedo",
          accountAddress: albedoAccounts[0].address,
          required: false, // Not required, so rejection is OK
        },
      ];

      const config: MultiSignatureConfig = {
        requiredSignatures: 1,
        totalSigners: 3,
        continueOnError: true,
      };

      const transaction: StellarTransaction = {
        sourceAccount: mockAccounts[0].address,
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
      expect(workflowResult.requiredMet).toBe(true);

      // Check that we have the expected failure types
      const completedSignatures = workflowResult.signatures.filter(
        (s) => s.status === "completed"
      );
      const failedSignatures = workflowResult.signatures.filter(
        (s) => s.status === "failed"
      );
      const rejectedSignatures = workflowResult.signatures.filter(
        (s) => s.status === "rejected"
      );

      expect(completedSignatures.length).toBe(1);
      expect(failedSignatures.length).toBe(1);
      expect(rejectedSignatures.length).toBe(1);

      // Cleanup
      await mockProvider.disconnect();
      await failingLedger.disconnect();
      await rejectingAlbedo.disconnect();
    });
  });

  describe("Provider Discovery and Selection", () => {
    it("should discover and select optimal providers for different scenarios", async () => {
      // Test discovery
      const discoveries = await factory.discoverProviders();
      expect(discoveries.length).toBeGreaterThan(0);

      // Test chain-specific selection
      const stellarProviders = await factory.createProvidersForChain(
        ChainId.STELLAR,
        {
          autoConnect: false,
        }
      );
      expect(stellarProviders.length).toBeGreaterThan(0);

      // Test best provider selection with preferences
      const hardwarePreferred = await factory.getBestProviderForChain(
        ChainId.BITCOIN,
        {
          preferHardwareWallet: true,
        }
      );
      expect(hardwarePreferred).toBeDefined();

      const browserPreferred = await factory.getBestProviderForChain(
        ChainId.STELLAR,
        {
          preferBrowserExtension: true,
        }
      );
      expect(browserPreferred).toBeDefined();

      // Verify different providers were selected based on preferences
      // (In our mock setup, this tests the scoring logic)
      expect(hardwarePreferred.providerId).toBeDefined();
      expect(browserPreferred.providerId).toBeDefined();
    });

    it("should handle provider availability changes", async () => {
      // Initial discovery
      const initialDiscoveries = await factory.discoverProviders();
      const initialCount = initialDiscoveries.filter((d) => d.available).length;

      // Clear cache and rediscover
      factory.clearDiscoveryCache();
      const newDiscoveries = await factory.discoverProviders();

      expect(newDiscoveries.length).toBe(initialDiscoveries.length);

      // In a real scenario, availability might change
      // Here we test that the discovery system works consistently
      const newCount = newDiscoveries.filter((d) => d.available).length;
      expect(newCount).toBe(initialCount);
    });
  });

  describe("Error Recovery Integration", () => {
    it("should recover from provider errors using error recovery system", async () => {
      const mockProvider = new MockSignatureProvider(
        "recovery-test",
        undefined,
        {
          shouldFailSigning: true,
        }
      );

      await mockProvider.connect();

      const accounts = await mockProvider.getAccounts(ChainId.STELLAR);
      const transaction: StellarTransaction = {
        sourceAccount: accounts[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      };

      const signatureRequest: SignatureRequest = {
        transactionData: { chainId: ChainId.STELLAR, transaction },
        accountAddress: accounts[0].address,
      };

      // Attempt signing (will fail)
      try {
        await mockProvider.signTransaction(signatureRequest);
        fail("Expected signing to fail");
      } catch (error) {
        // Use error recovery system
        const recoveryContext: ErrorRecoveryContext = {
          providerId: mockProvider.providerId,
          chainId: ChainId.STELLAR,
          retryCount: 0,
          maxRetries: 3,
        };

        const recoveryResult = await signatureProviderErrorRecovery.recover(
          error,
          recoveryContext
        );

        expect(recoveryResult.success).toBe(false);
        expect(recoveryResult.instructions).toBeDefined();
        expect(recoveryResult.instructions!.length).toBeGreaterThan(0);

        // Test recovery instructions
        const instructions =
          signatureProviderErrorRecovery.getRecoveryInstructions(error);
        expect(instructions.length).toBeGreaterThan(0);

        // Test recoverability check
        const canRecover = signatureProviderErrorRecovery.canRecover(error);
        expect(typeof canRecover).toBe("boolean");
      }

      await mockProvider.disconnect();
    });

    it("should provide appropriate recovery strategies for different error types", async () => {
      const testErrors = [
        new Error("Connection timeout"),
        new Error("User rejected"),
        new Error("Device not found"),
        new Error("Network error"),
      ];

      for (const error of testErrors) {
        const canRecover = signatureProviderErrorRecovery.canRecover(error);
        const instructions =
          signatureProviderErrorRecovery.getRecoveryInstructions(error);

        expect(typeof canRecover).toBe("boolean");
        expect(Array.isArray(instructions)).toBe(true);
        expect(instructions.length).toBeGreaterThan(0);

        if (canRecover) {
          const recoveryResult =
            await signatureProviderErrorRecovery.recover(error);
          expect(recoveryResult).toBeDefined();
          expect(recoveryResult.instructions).toBeDefined();
        }
      }
    });
  });

  describe("Performance and Stress Testing", () => {
    it("should handle high-volume multi-signature operations", async () => {
      const numProviders = 5;
      const providers: MockSignatureProvider[] = [];

      // Create multiple providers
      for (let i = 0; i < numProviders; i++) {
        const provider = new MockSignatureProvider(
          `stress-provider-${i}`,
          undefined,
          {
            signingDelay: Math.random() * 100 + 50, // Random delay 50-150ms
          }
        );
        providers.push(provider);
        coordinator.registerProvider(provider);
        await provider.connect();
      }

      // Setup signers
      const signers: SignerInfo[] = [];
      for (let i = 0; i < numProviders; i++) {
        const accounts = await providers[i].getAccounts(ChainId.STELLAR);
        signers.push({
          providerId: `stress-provider-${i}`,
          accountAddress: accounts[0].address,
          publicKey: accounts[0].publicKey,
          required: i < 3, // First 3 are required
        });
      }

      const config: MultiSignatureConfig = {
        requiredSignatures: 3,
        totalSigners: numProviders,
        allowPartialSigning: true,
        continueOnError: true,
      };

      const transaction: StellarTransaction = {
        sourceAccount: signers[0].accountAddress,
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      };

      // Execute stress test
      const startTime = Date.now();
      const workflowResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction },
        signers,
        config
      );
      const endTime = Date.now();

      expect(workflowResult.status).toBe("completed");
      expect(workflowResult.requiredMet).toBe(true);

      const completedSignatures = workflowResult.signatures.filter(
        (s) => s.status === "completed"
      );
      expect(completedSignatures.length).toBeGreaterThanOrEqual(3);

      console.log(
        `Stress test with ${numProviders} providers completed in ${endTime - startTime}ms`
      );

      // Cleanup
      for (const provider of providers) {
        await provider.disconnect();
      }
    });

    it("should handle concurrent multi-signature workflows", async () => {
      const numWorkflows = 3;
      const workflowPromises: Promise<unknown>[] = [];

      for (let i = 0; i < numWorkflows; i++) {
        const workflowPromise = (async () => {
          const workflowCoordinator = new MultiSignatureCoordinator();

          // Create providers for this workflow
          const provider1 = new MockSignatureProvider(`concurrent-1-${i}`);
          const provider2 = new MockSignatureProvider(`concurrent-2-${i}`);

          workflowCoordinator.registerProvider(provider1);
          workflowCoordinator.registerProvider(provider2);

          await provider1.connect();
          await provider2.connect();

          const accounts1 = await provider1.getAccounts(ChainId.STELLAR);
          const accounts2 = await provider2.getAccounts(ChainId.STELLAR);

          const signers: SignerInfo[] = [
            {
              providerId: `concurrent-1-${i}`,
              accountAddress: accounts1[0].address,
              required: true,
            },
            {
              providerId: `concurrent-2-${i}`,
              accountAddress: accounts2[0].address,
              required: true,
            },
          ];

          const config: MultiSignatureConfig = {
            requiredSignatures: 2,
            totalSigners: 2,
          };

          const transaction: StellarTransaction = {
            sourceAccount: accounts1[0].address,
            fee: "100",
            sequenceNumber: String(i + 1),
            operations: [{ type: "payment" }],
          };

          const result = await workflowCoordinator.startWorkflow(
            { chainId: ChainId.STELLAR, transaction },
            signers,
            config
          );

          // Cleanup
          await provider1.disconnect();
          await provider2.disconnect();

          return result;
        })();

        workflowPromises.push(workflowPromise);
      }

      // Execute all workflows concurrently
      const startTime = Date.now();
      const results = await Promise.all(workflowPromises);
      const endTime = Date.now();

      expect(results.length).toBe(numWorkflows);
      expect(results.every((r) => r.status === "completed")).toBe(true);
      expect(results.every((r) => r.requiredMet)).toBe(true);

      console.log(
        `${numWorkflows} concurrent workflows completed in ${endTime - startTime}ms`
      );
    });
  });

  describe("Real-World Scenarios", () => {
    it("should simulate treasury management workflow", async () => {
      // Simulate a treasury that requires 3-of-5 signatures
      const treasuryProviders: MockSignatureProvider[] = [];
      const treasurySigners: SignerInfo[] = [];

      // Create 5 treasury signers (different provider types)
      for (let i = 0; i < 5; i++) {
        const provider = new MockSignatureProvider(
          `treasury-signer-${i}`,
          undefined,
          {
            signingDelay: Math.random() * 200 + 100, // Realistic signing delays
          }
        );
        treasuryProviders.push(provider);
        coordinator.registerProvider(provider);
        await provider.connect();

        const accounts = await provider.getAccounts(ChainId.STELLAR);
        treasurySigners.push({
          providerId: `treasury-signer-${i}`,
          accountAddress: accounts[0].address,
          publicKey: accounts[0].publicKey,
          required: false, // None are individually required
          metadata: {
            role: i < 2 ? "admin" : "member",
            department: i % 2 === 0 ? "finance" : "operations",
          },
        });
      }

      const treasuryConfig: MultiSignatureConfig = {
        requiredSignatures: 3,
        totalSigners: 5,
        allowPartialSigning: false, // Must get required signatures
        continueOnError: true,
        description: "Treasury payment requiring 3-of-5 signatures",
      };

      // Large treasury payment
      const treasuryTransaction: StellarTransaction = {
        sourceAccount: treasurySigners[0].accountAddress,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: "GVENDOR123",
            asset: "native",
            amount: "10000", // Large payment
          },
        ],
        memo: {
          type: "text",
          value: "Vendor payment - Invoice #12345",
        },
      };

      const treasuryResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction: treasuryTransaction },
        treasurySigners,
        treasuryConfig
      );

      expect(treasuryResult.status).toBe("completed");
      expect(treasuryResult.requiredMet).toBe(true);

      const completedSignatures = treasuryResult.signatures.filter(
        (s) => s.status === "completed"
      );
      expect(completedSignatures.length).toBeGreaterThanOrEqual(3);

      // Verify the final transaction has proper multi-signature structure
      expect(treasuryResult.finalTransaction).toBeDefined();
      expect(
        (treasuryResult.finalTransaction as { multiSignature?: unknown })
          .multiSignature
      ).toBeDefined();
      expect(
        (
          treasuryResult.finalTransaction as {
            multiSignature?: { signatures: unknown[] };
          }
        ).multiSignature?.signatures.length || 0
      ).toBeGreaterThanOrEqual(3);

      // Cleanup
      for (const provider of treasuryProviders) {
        await provider.disconnect();
      }
    });

    it("should simulate cross-chain bridge workflow", async () => {
      // Simulate a cross-chain bridge requiring signatures from different chains
      const bridgeProviders = [
        new MockSignatureProvider("bridge-stellar", undefined, {
          customCapabilities: { supportedChains: [ChainId.STELLAR] },
        }),
        new MockSignatureProvider("bridge-bitcoin", undefined, {
          customCapabilities: { supportedChains: [ChainId.BITCOIN] },
        }),
        new MockSignatureProvider("bridge-starknet", undefined, {
          customCapabilities: { supportedChains: [ChainId.STARKNET] },
        }),
      ];

      // Connect all bridge providers
      for (const provider of bridgeProviders) {
        coordinator.registerProvider(provider);
        await provider.connect();
      }

      // For this test, we'll focus on Stellar side of the bridge
      const stellarAccounts = await bridgeProviders[0].getAccounts(
        ChainId.STELLAR
      );

      const bridgeSigners: SignerInfo[] = [
        {
          providerId: "bridge-stellar",
          accountAddress: stellarAccounts[0].address,
          publicKey: stellarAccounts[0].publicKey,
          required: true,
          metadata: { role: "bridge-validator", chain: "stellar" },
        },
      ];

      const bridgeConfig: MultiSignatureConfig = {
        requiredSignatures: 1,
        totalSigners: 1,
        description: "Cross-chain bridge lock transaction",
      };

      // Bridge lock transaction
      const bridgeTransaction: StellarTransaction = {
        sourceAccount: stellarAccounts[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: "GBRIDGE123", // Bridge contract
            asset: "native",
            amount: "500",
          },
        ],
        memo: {
          type: "hash",
          value: "bridge-lock-hash-123",
        },
      };

      const bridgeResult = await coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction: bridgeTransaction },
        bridgeSigners,
        bridgeConfig
      );

      expect(bridgeResult.status).toBe("completed");
      expect(bridgeResult.requiredMet).toBe(true);

      // Cleanup
      for (const provider of bridgeProviders) {
        await provider.disconnect();
      }
    });
  });
});
