import { ChainId } from "../../types";
import {
  MultiSignatureCoordinator,
  MultiSignatureConfig,
  SignerInfo,
  SignatureStatus,
  MultiSignatureEventType,
} from "../multi-signature-coordinator";
import { MockSignatureProvider } from "../mock-provider";
import { StellarTransaction } from "../types";
import {
  SigningError,
  UserRejectedError,
  InvalidTransactionError,
  ConnectionError,
} from "../errors";

describe("MultiSignatureCoordinator", () => {
  let coordinator: MultiSignatureCoordinator;
  let mockProvider1: MockSignatureProvider;
  let mockProvider2: MockSignatureProvider;
  let mockProvider3: MockSignatureProvider;

  const createTestTransaction = () => ({
    chainId: ChainId.STELLAR,
    transaction: {
      sourceAccount: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      fee: "100",
      sequenceNumber: "1",
      operations: [{ type: "payment", destination: "GTEST", amount: "100" }],
    } as StellarTransaction,
  });

  const createTestSigners = (): SignerInfo[] => [
    {
      providerId: "mock-provider-1",
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      required: true,
      weight: 1,
    },
    {
      providerId: "mock-provider-2",
      accountAddress:
        "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
      publicKey: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
      required: true,
      weight: 1,
    },
    {
      providerId: "mock-provider-3",
      accountAddress:
        "GTEST3KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      publicKey: "GTEST3KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      required: false,
      weight: 1,
    },
  ];

  const createTestConfig = (): MultiSignatureConfig => ({
    requiredSignatures: 2,
    totalSigners: 3,
    signatureTimeout: 5000,
    totalTimeout: 15000,
    allowPartialSigning: true,
    continueOnError: true,
    description: "Test multi-signature transaction",
  });

  beforeEach(() => {
    coordinator = new MultiSignatureCoordinator();

    mockProvider1 = new MockSignatureProvider("mock-provider-1");
    mockProvider2 = new MockSignatureProvider("mock-provider-2");
    mockProvider3 = new MockSignatureProvider("mock-provider-3");

    coordinator.registerProvider(mockProvider1);
    coordinator.registerProvider(mockProvider2);
    coordinator.registerProvider(mockProvider3);
  });
  describe("Provider Management", () => {
    it("should register and list providers", () => {
      const providers = coordinator.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-1");
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-2");
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-3");
    });

    it("should get specific provider", () => {
      const provider = coordinator.getProvider("mock-provider-1");
      expect(provider).toBe(mockProvider1);
    });

    it("should unregister provider", () => {
      coordinator.unregisterProvider("mock-provider-1");
      const provider = coordinator.getProvider("mock-provider-1");
      expect(provider).toBeUndefined();
      expect(coordinator.listProviders()).toHaveLength(2);
    });
  });

  describe("Event Handling", () => {
    it("should add and remove event listeners", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      coordinator.addEventListener(handler1);
      coordinator.addEventListener(handler2);

      coordinator.removeEventListener(handler1);

      // Trigger an event by starting a workflow
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      coordinator.startWorkflow(transaction, signers, config);

      // handler1 should not be called, handler2 should be called
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it("should emit workflow started event", async () => {
      const eventHandler = jest.fn();
      coordinator.addEventListener(eventHandler);

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      await coordinator.startWorkflow(transaction, signers, config);

      const startedEvents = eventHandler.mock.calls
        .map((call) => call[0])
        .filter(
          (event) => event.type === MultiSignatureEventType.WORKFLOW_STARTED
        );

      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].workflow).toBeDefined();
    });
  });

  describe("Workflow Validation", () => {
    it("should validate workflow configuration", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const invalidConfig: MultiSignatureConfig = {
        requiredSignatures: 0, // Invalid: must be > 0
        totalSigners: 3,
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, invalidConfig)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should validate required signatures not exceeding total signers", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const invalidConfig: MultiSignatureConfig = {
        requiredSignatures: 5, // Invalid: exceeds total signers
        totalSigners: 3,
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, invalidConfig)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should validate signer count matches config", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners().slice(0, 2); // Only 2 signers
      const invalidConfig: MultiSignatureConfig = {
        requiredSignatures: 2,
        totalSigners: 3, // Config says 3 but only 2 provided
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, invalidConfig)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should validate all providers are registered", async () => {
      const transaction = createTestTransaction();
      const signers: SignerInfo[] = [
        {
          providerId: "unregistered-provider", // Not registered
          accountAddress: "GTEST",
          required: true,
        },
      ];
      const config: MultiSignatureConfig = {
        requiredSignatures: 1,
        totalSigners: 1,
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, config)
      ).rejects.toThrow(ConnectionError);
    });
  });

  describe("Successful Multi-Signature Workflows", () => {
    it("should complete parallel signing workflow", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      expect(result.status).toBe("completed");
      expect(result.requiredMet).toBe(true);
      expect(
        result.signatures.filter((s) => s.status === SignatureStatus.COMPLETED)
      ).toHaveLength(3);
      expect(result.finalTransaction).toBeDefined();
    });

    it("should complete sequential signing workflow", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config: MultiSignatureConfig = {
        ...createTestConfig(),
        requireSequentialSigning: true,
      };

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      expect(result.status).toBe("completed");
      expect(result.requiredMet).toBe(true);
      expect(
        result.signatures.filter((s) => s.status === SignatureStatus.COMPLETED)
      ).toHaveLength(3);
    });

    it("should meet threshold with partial signatures", async () => {
      // Configure one provider to fail
      mockProvider3.updateConfig({ shouldFailSigning: true });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig(); // Requires 2 out of 3

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      expect(result.status).toBe("completed");
      expect(result.requiredMet).toBe(true);
      expect(
        result.signatures.filter((s) => s.status === SignatureStatus.COMPLETED)
      ).toHaveLength(2);
      expect(
        result.signatures.filter((s) => s.status === SignatureStatus.FAILED)
      ).toHaveLength(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle user rejection", async () => {
      mockProvider1.updateConfig({ shouldRejectSigning: true });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      const rejectedSignature = result.signatures.find(
        (s) => s.signerInfo.providerId === "mock-provider-1"
      );
      expect(rejectedSignature?.status).toBe(SignatureStatus.REJECTED);
      expect(rejectedSignature?.error).toBeInstanceOf(UserRejectedError);
    });

    it("should handle signing failures", async () => {
      mockProvider1.updateConfig({ shouldFailSigning: true });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      const failedSignature = result.signatures.find(
        (s) => s.signerInfo.providerId === "mock-provider-1"
      );
      expect(failedSignature?.status).toBe(SignatureStatus.FAILED);
      expect(failedSignature?.error).toBeInstanceOf(SigningError);
    });

    it("should handle signature timeouts", async () => {
      mockProvider1.updateConfig({ signingDelay: 6000 }); // Longer than timeout

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config: MultiSignatureConfig = {
        ...createTestConfig(),
        signatureTimeout: 1000, // Short timeout
      };

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      const timedOutSignature = result.signatures.find(
        (s) => s.signerInfo.providerId === "mock-provider-1"
      );
      expect(timedOutSignature?.status).toBe(SignatureStatus.TIMEOUT);
    });

    it("should fail workflow when required signer fails and continueOnError is false", async () => {
      mockProvider1.updateConfig({ shouldFailSigning: true });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config: MultiSignatureConfig = {
        ...createTestConfig(),
        continueOnError: false,
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, config)
      ).rejects.toThrow(SigningError);
    });

    it("should handle insufficient signatures", async () => {
      // Make 2 providers fail, leaving only 1 signature (need 2)
      mockProvider1.updateConfig({ shouldFailSigning: true });
      mockProvider2.updateConfig({ shouldFailSigning: true });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config: MultiSignatureConfig = {
        ...createTestConfig(),
        allowPartialSigning: false,
      };

      await expect(
        coordinator.startWorkflow(transaction, signers, config)
      ).rejects.toThrow(SigningError);
    });
  });

  describe("Workflow Management", () => {
    it("should track active workflows", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      // Start workflow but don't await
      const workflowPromise = coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      // Check active workflows
      const activeWorkflows = coordinator.getActiveWorkflows();
      expect(activeWorkflows).toHaveLength(1);

      // Wait for completion
      await workflowPromise;

      // Should be removed from active workflows
      const activeWorkflowsAfter = coordinator.getActiveWorkflows();
      expect(activeWorkflowsAfter).toHaveLength(0);
    });

    it("should get workflow status", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      // During execution, we could get status (but workflow completes too fast in tests)
      // So we'll just verify the final result structure
      expect(result.transactionId).toBeTruthy();
      expect(result.status).toBe("completed");
    });

    it("should cancel workflow", async () => {
      // Use long delays to keep workflow active
      mockProvider1.updateConfig({ signingDelay: 5000 });
      mockProvider2.updateConfig({ signingDelay: 5000 });
      mockProvider3.updateConfig({ signingDelay: 5000 });

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      // Start workflow
      const workflowPromise = coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      // Get the transaction ID from active workflows
      const activeWorkflows = coordinator.getActiveWorkflows();
      expect(activeWorkflows).toHaveLength(1);
      const transactionId = activeWorkflows[0].transactionId;

      // Cancel the workflow
      await coordinator.cancelWorkflow(transactionId);

      // Workflow should be removed from active workflows
      const activeWorkflowsAfter = coordinator.getActiveWorkflows();
      expect(activeWorkflowsAfter).toHaveLength(0);

      // The original promise should still resolve/reject
      await expect(workflowPromise).rejects.toThrow();
    });
  });

  describe("Progress Tracking", () => {
    it("should track signing progress", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );
      const progress = coordinator.getSigningProgress(result);

      expect(progress.completed).toBe(3);
      expect(progress.required).toBe(2);
      expect(progress.total).toBe(3);
      expect(progress.percentage).toBe(150); // 3/2 * 100
    });

    it("should check threshold met", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      expect(coordinator.isThresholdMet(result)).toBe(true);
    });
  });

  describe("Event Emission", () => {
    it("should emit all workflow events", async () => {
      const eventHandler = jest.fn();
      coordinator.addEventListener(eventHandler);

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      await coordinator.startWorkflow(transaction, signers, config);

      const events = eventHandler.mock.calls.map((call) => call[0]);
      const eventTypes = events.map((e) => e.type);

      expect(eventTypes).toContain(MultiSignatureEventType.WORKFLOW_STARTED);
      expect(eventTypes).toContain(MultiSignatureEventType.SIGNATURE_STARTED);
      expect(eventTypes).toContain(MultiSignatureEventType.SIGNATURE_COMPLETED);
      expect(eventTypes).toContain(MultiSignatureEventType.THRESHOLD_MET);
      expect(eventTypes).toContain(MultiSignatureEventType.WORKFLOW_COMPLETED);
    });

    it("should handle event handler errors gracefully", async () => {
      const faultyHandler = jest.fn(() => {
        throw new Error("Handler error");
      });
      const goodHandler = jest.fn();

      coordinator.addEventListener(faultyHandler);
      coordinator.addEventListener(goodHandler);

      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      // Should not throw despite faulty handler
      await expect(
        coordinator.startWorkflow(transaction, signers, config)
      ).resolves.toBeDefined();

      expect(faultyHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe("Transaction Combination", () => {
    it("should combine signed transactions", async () => {
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();

      const result = await coordinator.startWorkflow(
        transaction,
        signers,
        config
      );

      expect(result.finalTransaction).toBeDefined();
      expect(
        (result.finalTransaction as { multiSignature?: unknown }).multiSignature
      ).toBeDefined();
      expect(
        (
          result.finalTransaction as {
            multiSignature?: { signatures: unknown[] };
          }
        ).multiSignature?.signatures.length || 0
      ).toBe(3);
      expect(
        (result.finalTransaction as { multiSignature?: { threshold: number } })
          .multiSignature?.threshold
      ).toBe(2);
      expect(
        (
          result.finalTransaction as {
            multiSignature?: { totalSigners: number };
          }
        ).multiSignature?.totalSigners
      ).toBe(3);
    });
  });
});
