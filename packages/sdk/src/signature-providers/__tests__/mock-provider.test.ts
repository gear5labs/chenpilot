import { ChainId } from "../../types";
import { MockSignatureProvider, MockProviderConfig } from "../mock-provider";
import {
  SignatureRequest,
  SignatureProviderAccount,
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "../types";
import {
  ConnectionError,
  UserRejectedError,
  InvalidTransactionError,
  NetworkError,
  SigningError,
} from "../errors";

describe("MockSignatureProvider", () => {
  let mockProvider: MockSignatureProvider;

  // Helper functions for creating test requests
  const createBitcoinSigningRequest = (): SignatureRequest => ({
    transactionData: {
      chainId: ChainId.BITCOIN,
      transaction: {
        inputs: [{ txid: "test-txid", vout: 0 }],
        outputs: [{ value: 100000, scriptPubKey: "test-script" }],
      } as BitcoinTransaction,
    },
    accountAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  });

  const createStellarSigningRequest = (): SignatureRequest => ({
    transactionData: {
      chainId: ChainId.STELLAR,
      transaction: {
        sourceAccount:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      } as StellarTransaction,
    },
    accountAddress: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  });

  const createStarknetSigningRequest = (): SignatureRequest => ({
    transactionData: {
      chainId: ChainId.STARKNET,
      transaction: {
        contractAddress: "0x123",
        entrypoint: "transfer",
        calldata: ["0x456", "1000", "0"],
      } as StarknetTransaction,
    },
    accountAddress:
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  });

  beforeEach(() => {
    mockProvider = new MockSignatureProvider();
  });

  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(mockProvider.providerId).toBe("mock-provider");
      expect(mockProvider.metadata.name).toBe("Mock Signature Provider");
      expect(mockProvider.isConnected()).toBe(false);
    });

    it("should accept custom provider ID and metadata", () => {
      const customProvider = new MockSignatureProvider("custom-mock", {
        name: "Custom Mock Provider",
        version: "2.0.0",
        description: "Custom mock for testing",
      });

      expect(customProvider.providerId).toBe("custom-mock");
      expect(customProvider.metadata.name).toBe("Custom Mock Provider");
      expect(customProvider.metadata.version).toBe("2.0.0");
    });

    it("should accept custom configuration", () => {
      const config: MockProviderConfig = {
        connectionDelay: 500,
        signingDelay: 1000,
        enableLogging: true,
      };

      const customProvider = new MockSignatureProvider(
        "test",
        undefined,
        config
      );
      expect(customProvider.getConfig().connectionDelay).toBe(500);
      expect(customProvider.getConfig().signingDelay).toBe(1000);
      expect(customProvider.getConfig().enableLogging).toBe(true);
    });

    it("should update configuration", () => {
      mockProvider.updateConfig({
        connectionDelay: 200,
        shouldFailConnection: true,
      });

      const config = mockProvider.getConfig();
      expect(config.connectionDelay).toBe(200);
      expect(config.shouldFailConnection).toBe(true);
    });

    it("should reset to default state", () => {
      mockProvider.updateConfig({ shouldFailConnection: true });
      mockProvider.reset();

      const config = mockProvider.getConfig();
      expect(config.shouldFailConnection).toBeUndefined();
      expect(mockProvider.isConnected()).toBe(false);
    });
  });

  describe("Connection Management", () => {
    it("should connect successfully", async () => {
      const connection = await mockProvider.connect();

      expect(mockProvider.isConnected()).toBe(true);
      expect(connection.isConnected).toBe(true);
      expect(connection.connectionId).toMatch(/^mock-connection-/);
      expect(connection.metadata?.mockProvider).toBe(true);
    });

    it("should simulate connection delay", async () => {
      mockProvider.updateConfig({ connectionDelay: 100 });

      const startTime = Date.now();
      await mockProvider.connect();
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });

    it("should fail connection when configured", async () => {
      mockProvider.updateConfig({ shouldFailConnection: true });

      await expect(mockProvider.connect()).rejects.toThrow(ConnectionError);
    });

    it("should fail connection with custom error", async () => {
      const customError = new ConnectionError(
        "Custom connection error",
        "mock-provider"
      );
      mockProvider.updateConfig({
        shouldFailConnection: true,
        connectionError: customError,
      });

      await expect(mockProvider.connect()).rejects.toThrow(
        "Custom connection error"
      );
    });

    it("should disconnect successfully", async () => {
      await mockProvider.connect();
      expect(mockProvider.isConnected()).toBe(true);

      await mockProvider.disconnect();
      expect(mockProvider.isConnected()).toBe(false);
    });

    it("should notify connection state changes", async () => {
      const connectionCallback = jest.fn();
      mockProvider.onConnectionChange(connectionCallback);

      await mockProvider.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await mockProvider.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Account Management", () => {
    it("should return default accounts for all chains", async () => {
      const bitcoinAccounts = await mockProvider.getAccounts(ChainId.BITCOIN);
      const stellarAccounts = await mockProvider.getAccounts(ChainId.STELLAR);
      const starknetAccounts = await mockProvider.getAccounts(ChainId.STARKNET);

      expect(bitcoinAccounts).toHaveLength(2);
      expect(stellarAccounts).toHaveLength(2);
      expect(starknetAccounts).toHaveLength(2);

      expect(bitcoinAccounts[0].chainId).toBe(ChainId.BITCOIN);
      expect(stellarAccounts[0].chainId).toBe(ChainId.STELLAR);
      expect(starknetAccounts[0].chainId).toBe(ChainId.STARKNET);
    });

    it("should return custom accounts when configured", async () => {
      const customAccounts: SignatureProviderAccount[] = [
        {
          address: "custom-address",
          publicKey: "custom-pubkey",
          chainId: ChainId.STELLAR,
          metadata: { custom: true },
        },
      ];

      mockProvider.updateConfig({
        accounts: {
          [ChainId.BITCOIN]: [],
          [ChainId.STELLAR]: customAccounts,
          [ChainId.STARKNET]: [],
        },
      });

      const accounts = await mockProvider.getAccounts(ChainId.STELLAR);
      expect(accounts).toEqual(customAccounts);
    });

    it("should fail getting accounts when configured", async () => {
      mockProvider.updateConfig({ shouldFailGetAccounts: true });

      await expect(mockProvider.getAccounts(ChainId.STELLAR)).rejects.toThrow(
        SigningError
      );
    });

    it("should add mock accounts", () => {
      const newAccount: SignatureProviderAccount = {
        address: "new-address",
        publicKey: "new-pubkey",
        chainId: ChainId.BITCOIN,
      };

      mockProvider.addMockAccounts(ChainId.BITCOIN, [newAccount]);

      const mockAccounts = mockProvider.getMockAccounts();
      expect(mockAccounts[ChainId.BITCOIN]).toContain(newAccount);
    });

    it("should clear mock accounts", () => {
      mockProvider.clearMockAccounts(ChainId.BITCOIN);

      const mockAccounts = mockProvider.getMockAccounts();
      expect(mockAccounts[ChainId.BITCOIN]).toHaveLength(0);
    });
  });

  describe("Transaction Signing", () => {
    it("should sign Bitcoin transactions", async () => {
      const request = createBitcoinSigningRequest();
      const result = await mockProvider.signTransaction(request);

      expect(result.signature).toMatch(/^304402/); // Bitcoin signature format
      expect(result.publicKey).toMatch(/^02/); // Bitcoin public key format
      expect(result.signedTransaction).toHaveProperty("signatures");
      expect(result.metadata?.mockProvider).toBe(true);
      expect(result.metadata?.chainId).toBe(ChainId.BITCOIN);
    });

    it("should sign Stellar transactions", async () => {
      const request = createStellarSigningRequest();
      const result = await mockProvider.signTransaction(request);

      expect(result.signature).toHaveLength(128); // Stellar signature length
      expect(result.publicKey).toMatch(/^G/); // Stellar public key format
      expect(result.signedTransaction).toHaveProperty("signatures");
      expect(result.metadata?.chainId).toBe(ChainId.STELLAR);
    });

    it("should sign Starknet transactions", async () => {
      const request = createStarknetSigningRequest();
      const result = await mockProvider.signTransaction(request);

      expect(result.signature).toMatch(/^0x/); // Starknet signature format
      expect(result.publicKey).toMatch(/^0x/); // Starknet public key format
      expect(result.signedTransaction).toHaveProperty("signature");
      expect(result.metadata?.chainId).toBe(ChainId.STARKNET);
    });

    it("should simulate signing delay", async () => {
      mockProvider.updateConfig({ signingDelay: 100 });

      const startTime = Date.now();
      await mockProvider.signTransaction(createBitcoinSigningRequest());
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });

    it("should fail signing when configured", async () => {
      mockProvider.updateConfig({ shouldFailSigning: true });

      await expect(
        mockProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(SigningError);
    });

    it("should simulate user rejection", async () => {
      mockProvider.updateConfig({ shouldRejectSigning: true });

      await expect(
        mockProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(UserRejectedError);
    });

    it("should simulate random user rejection", async () => {
      mockProvider.updateConfig({ rejectionRate: 1.0 }); // 100% rejection rate

      await expect(
        mockProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(UserRejectedError);
    });

    it("should validate transaction format", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.BITCOIN,
          transaction: {
            inputs: [],
            outputs: [],
          } as unknown as BitcoinTransaction, // Invalid: no outputs
        },
        accountAddress: "test-address",
      };

      await expect(
        mockProvider.signTransaction(invalidRequest)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should increment signature counter", async () => {
      const result1 = await mockProvider.signTransaction(
        createBitcoinSigningRequest()
      );
      const result2 = await mockProvider.signTransaction(
        createStellarSigningRequest()
      );

      expect(result1.metadata?.signatureCounter).toBe(1);
      expect(result2.metadata?.signatureCounter).toBe(2);
    });
  });

  describe("Message Signing", () => {
    it("should sign messages", async () => {
      const result = await mockProvider.signMessage!(
        "Hello, world!",
        "test-address",
        ChainId.STELLAR
      );

      expect(result.signature).toMatch(/^mock_msg_sig_/);
      expect(result.publicKey).toBeTruthy();
      expect(result.metadata?.messageSignature).toBe(true);
      expect(result.metadata?.message).toBe("Hello, world!");
    });

    it("should fail message signing when configured", async () => {
      mockProvider.updateConfig({ shouldFailMessageSigning: true });

      await expect(
        mockProvider.signMessage!("test", "address", ChainId.STELLAR)
      ).rejects.toThrow(SigningError);
    });
  });

  describe("Capabilities", () => {
    it("should return default capabilities", () => {
      const capabilities = mockProvider.getCapabilities();

      expect(capabilities.supportedChains).toEqual([
        ChainId.BITCOIN,
        ChainId.STELLAR,
        ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(false);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(10);
      expect(capabilities.metadata?.mockProvider).toBe(true);
    });

    it("should return custom capabilities when configured", () => {
      mockProvider.updateConfig({
        customCapabilities: {
          supportedChains: [ChainId.STELLAR],
          maxConcurrentSignatures: 5,
          requiresUserInteraction: true,
        },
      });

      const capabilities = mockProvider.getCapabilities();

      expect(capabilities.supportedChains).toEqual([ChainId.STELLAR]);
      expect(capabilities.maxConcurrentSignatures).toBe(5);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(true); // Should merge with defaults
    });
  });

  describe("Network Simulation", () => {
    it("should simulate network latency", async () => {
      mockProvider.updateConfig({ networkLatency: 100 });

      const startTime = Date.now();
      await mockProvider.getAccounts(ChainId.STELLAR);
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });

    it("should simulate network failures", async () => {
      mockProvider.updateConfig({ networkFailureRate: 1.0 }); // 100% failure rate

      await expect(mockProvider.getAccounts(ChainId.STELLAR)).rejects.toThrow(
        NetworkError
      );
    });

    it("should not fail with 0% network failure rate", async () => {
      mockProvider.updateConfig({ networkFailureRate: 0.0 });

      await expect(
        mockProvider.getAccounts(ChainId.STELLAR)
      ).resolves.toBeDefined();
    });
  });

  describe("Error Simulation", () => {
    it("should simulate specific errors", () => {
      const customError = new ConnectionError("Custom error", "mock-provider");

      expect(() => mockProvider.simulateError(customError)).toThrow(
        "Custom error"
      );
    });
  });

  describe("Transaction Validation", () => {
    it("should validate Bitcoin transaction structure", async () => {
      const invalidBitcoinRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.BITCOIN,
          transaction: { outputs: [] } as unknown as BitcoinTransaction, // Missing inputs
        },
        accountAddress: "test-address",
      };

      await expect(
        mockProvider.signTransaction(invalidBitcoinRequest)
      ).rejects.toThrow("Bitcoin transaction must have inputs");
    });

    it("should validate Stellar transaction structure", async () => {
      const invalidStellarRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: { fee: "100" } as StellarTransaction, // Missing sourceAccount
        },
        accountAddress: "test-address",
      };

      await expect(
        mockProvider.signTransaction(invalidStellarRequest)
      ).rejects.toThrow("Stellar transaction must have source account");
    });

    it("should validate Starknet transaction structure", async () => {
      const invalidStarknetRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STARKNET,
          transaction: { calldata: [] } as unknown as StarknetTransaction, // Missing contractAddress
        },
        accountAddress: "test-address",
      };

      await expect(
        mockProvider.signTransaction(invalidStarknetRequest)
      ).rejects.toThrow("Starknet transaction must have contract address");
    });
  });

  describe("Logging", () => {
    it("should log when enabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      mockProvider.updateConfig({ enableLogging: true });

      await mockProvider.connect();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[MockSignatureProvider:mock-provider]"),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it("should not log when disabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      mockProvider.updateConfig({ enableLogging: false });

      await mockProvider.connect();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("Signature Generation", () => {
    it("should generate unique signatures", async () => {
      const request1 = createBitcoinSigningRequest();
      const request2 = createBitcoinSigningRequest();

      const result1 = await mockProvider.signTransaction(request1);
      const result2 = await mockProvider.signTransaction(request2);

      expect(result1.signature).not.toBe(result2.signature);
    });

    it("should generate chain-appropriate signature formats", async () => {
      const bitcoinResult = await mockProvider.signTransaction(
        createBitcoinSigningRequest()
      );
      const stellarResult = await mockProvider.signTransaction(
        createStellarSigningRequest()
      );
      const starknetResult = await mockProvider.signTransaction(
        createStarknetSigningRequest()
      );

      // Bitcoin signatures start with specific format
      expect(bitcoinResult.signature).toMatch(/^304402/);

      // Stellar signatures are 128 characters
      expect(stellarResult.signature).toHaveLength(128);

      // Starknet signatures start with 0x
      expect(starknetResult.signature).toMatch(/^0x/);
    });
  });
});
