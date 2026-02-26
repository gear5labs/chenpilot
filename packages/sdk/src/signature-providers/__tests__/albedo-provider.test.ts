import { ChainId } from "../../types";
import {
  AlbedoSignatureProvider,
  AlbedoProviderConfig,
} from "../albedo-provider";
import { SignatureRequest, StellarTransaction } from "../types";
import {
  ProviderNotFoundError,
  UserRejectedError,
  UnsupportedChainError,
  InvalidTransactionError,
  ConnectionError,
  SigningError,
} from "../errors";

describe("AlbedoSignatureProvider", () => {
  let albedoProvider: AlbedoSignatureProvider;

  beforeEach(() => {
    albedoProvider = new AlbedoSignatureProvider();
  });

  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(albedoProvider.providerId).toBe("albedo-provider");
      expect(albedoProvider.metadata.name).toBe("Albedo Wallet");
      expect(albedoProvider.isConnected()).toBe(false);
    });

    it("should accept custom configuration", () => {
      const config: AlbedoProviderConfig = {
        network: "mainnet",
        connectionTimeout: 15000,
        enableDebugLogging: true,
      };

      const customProvider = new AlbedoSignatureProvider(config);
      const providerConfig = customProvider.getConfig();

      expect(providerConfig.network).toBe("mainnet");
      expect(providerConfig.connectionTimeout).toBe(15000);
      expect(providerConfig.enableDebugLogging).toBe(true);
    });

    it("should update configuration", () => {
      albedoProvider.updateConfig({
        network: "mainnet",
        maxRetries: 5,
      });

      const config = albedoProvider.getConfig();
      expect(config.network).toBe("mainnet");
      expect(config.maxRetries).toBe(5);
    });
  });

  describe("Connection Management", () => {
    it("should connect successfully", async () => {
      const connection = await albedoProvider.connect();

      expect(albedoProvider.isConnected()).toBe(true);
      expect(connection.isConnected).toBe(true);
      expect(connection.connectionId).toMatch(/^albedo-/);
      expect(connection.metadata?.albedoProvider).toBe(true);
      expect(connection.metadata?.publicKey).toBeTruthy();
    });

    it("should handle Albedo extension not found", async () => {
      // Mock the initializeAlbedoAPI to throw extension not found error
      const originalInitialize = (albedoProvider as unknown)
        .initializeAlbedoAPI;
      (albedoProvider as unknown).initializeAlbedoAPI = jest
        .fn()
        .mockRejectedValue(new Error("Albedo extension not found"));

      await expect(albedoProvider.connect()).rejects.toThrow(
        ProviderNotFoundError
      );

      // Restore original method
      (albedoProvider as unknown).initializeAlbedoAPI = originalInitialize;
    });

    it("should handle user rejection during connection", async () => {
      const originalInitialize = (albedoProvider as unknown)
        .initializeAlbedoAPI;
      (albedoProvider as unknown).initializeAlbedoAPI = jest
        .fn()
        .mockResolvedValue({
          publicKey: jest
            .fn()
            .mockRejectedValue(new Error("User rejected the request")),
        });

      await expect(albedoProvider.connect()).rejects.toThrow(UserRejectedError);

      (albedoProvider as unknown).initializeAlbedoAPI = originalInitialize;
    });

    it("should handle connection failure", async () => {
      const originalInitialize = (albedoProvider as unknown)
        .initializeAlbedoAPI;
      (albedoProvider as unknown).initializeAlbedoAPI = jest
        .fn()
        .mockRejectedValue(new Error("Connection failed"));

      await expect(albedoProvider.connect()).rejects.toThrow(ConnectionError);

      (albedoProvider as unknown).initializeAlbedoAPI = originalInitialize;
    });

    it("should disconnect successfully", async () => {
      await albedoProvider.connect();
      expect(albedoProvider.isConnected()).toBe(true);

      await albedoProvider.disconnect();
      expect(albedoProvider.isConnected()).toBe(false);
    });

    it("should notify connection state changes", async () => {
      const connectionCallback = jest.fn();
      albedoProvider.onConnectionChange(connectionCallback);

      await albedoProvider.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await albedoProvider.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Account Management", () => {
    beforeEach(async () => {
      await albedoProvider.connect();
    });

    afterEach(async () => {
      await albedoProvider.disconnect();
    });

    it("should get Stellar accounts", async () => {
      const accounts = await albedoProvider.getAccounts(ChainId.STELLAR);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].chainId).toBe(ChainId.STELLAR);
      expect(accounts[0].address).toMatch(/^G/); // Stellar address format
      expect(accounts[0].publicKey).toBe(accounts[0].address); // Stellar addresses are public keys
      expect(accounts[0].metadata?.albedoProvider).toBe(true);
    });

    it("should throw error for unsupported chains", async () => {
      await expect(albedoProvider.getAccounts(ChainId.BITCOIN)).rejects.toThrow(
        UnsupportedChainError
      );
      await expect(
        albedoProvider.getAccounts(ChainId.STARKNET)
      ).rejects.toThrow(UnsupportedChainError);
    });

    it("should throw error when not connected", async () => {
      await albedoProvider.disconnect();

      await expect(albedoProvider.getAccounts(ChainId.STELLAR)).rejects.toThrow(
        ConnectionError
      );
    });

    it("should cache accounts", async () => {
      const accounts1 = await albedoProvider.getAccounts(ChainId.STELLAR);
      const accounts2 = await albedoProvider.getAccounts(ChainId.STELLAR);

      expect(accounts1).toBe(accounts2); // Should return cached instance
    });

    it("should handle user rejection when getting accounts", async () => {
      // Mock the albedoAPI to reject
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.publicKey = jest
        .fn()
        .mockRejectedValue(new Error("User rejected the request"));

      await expect(albedoProvider.getAccounts(ChainId.STELLAR)).rejects.toThrow(
        UserRejectedError
      );
    });
  });

  describe("Transaction Signing", () => {
    const createStellarSigningRequest = (): SignatureRequest => ({
      transactionData: {
        chainId: ChainId.STELLAR,
        transaction: {
          sourceAccount:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination:
                "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
              asset: "native",
              amount: "10",
            },
          ],
        } as StellarTransaction,
      },
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      metadata: {
        description: "Test payment transaction",
      },
    });

    beforeEach(async () => {
      await albedoProvider.connect();
    });

    afterEach(async () => {
      await albedoProvider.disconnect();
    });

    it("should sign Stellar transactions", async () => {
      const request = createStellarSigningRequest();
      const result = await albedoProvider.signTransaction(request);

      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBe(request.accountAddress);
      expect(result.signedTransaction).toHaveProperty("signatures");
      expect(result.signedTransaction).toHaveProperty("envelope_xdr");
      expect(result.metadata?.albedoProvider).toBe(true);
      expect(result.metadata?.network).toBeTruthy();
    });

    it("should throw error for unsupported chains", async () => {
      const bitcoinRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.BITCOIN,
          transaction: { inputs: [], outputs: [] },
        },
        accountAddress: "bc1qtest",
      };

      await expect(
        albedoProvider.signTransaction(bitcoinRequest)
      ).rejects.toThrow(UnsupportedChainError);
    });

    it("should throw error when not connected", async () => {
      await albedoProvider.disconnect();

      await expect(
        albedoProvider.signTransaction(createStellarSigningRequest())
      ).rejects.toThrow(ConnectionError);
    });

    it("should handle user rejection", async () => {
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.tx = jest
        .fn()
        .mockRejectedValue(new Error("User rejected the request"));

      await expect(
        albedoProvider.signTransaction(createStellarSigningRequest())
      ).rejects.toThrow(UserRejectedError);
    });

    it("should validate transaction format", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            // Missing required fields
            fee: "100",
          } as StellarTransaction,
        },
        accountAddress:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      };

      await expect(
        albedoProvider.signTransaction(invalidRequest)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should handle network errors", async () => {
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.tx = jest
        .fn()
        .mockRejectedValue(new Error("Network error occurred"));

      await expect(
        albedoProvider.signTransaction(createStellarSigningRequest())
      ).rejects.toThrow(SigningError);
    });
  });

  describe("Message Signing", () => {
    beforeEach(async () => {
      await albedoProvider.connect();
    });

    afterEach(async () => {
      await albedoProvider.disconnect();
    });

    it("should sign messages for Stellar", async () => {
      const result = await albedoProvider.signMessage!(
        "Hello, Stellar!",
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        ChainId.STELLAR
      );

      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();
      expect(result.metadata?.messageSignature).toBe(true);
      expect(result.metadata?.message).toBe("Hello, Stellar!");
    });

    it("should throw error for unsupported chains", async () => {
      await expect(
        albedoProvider.signMessage!("test", "address", ChainId.BITCOIN)
      ).rejects.toThrow(UnsupportedChainError);
    });

    it("should handle user rejection", async () => {
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.publicKey = jest
        .fn()
        .mockRejectedValue(new Error("User rejected the request"));

      await expect(
        albedoProvider.signMessage!("test", "address", ChainId.STELLAR)
      ).rejects.toThrow(UserRejectedError);
    });

    it("should handle missing signature in response", async () => {
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.publicKey = jest.fn().mockResolvedValue({
        pubkey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        // Missing message_signature
      });

      await expect(
        albedoProvider.signMessage!("test", "address", ChainId.STELLAR)
      ).rejects.toThrow(SigningError);
    });
  });

  describe("Payment Interface", () => {
    beforeEach(async () => {
      await albedoProvider.connect();
    });

    afterEach(async () => {
      await albedoProvider.disconnect();
    });

    it("should perform payments using simplified interface", async () => {
      const paymentOptions = {
        destination: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
        amount: "100",
        memo: "Test payment",
      };

      const result = await albedoProvider.pay(paymentOptions);

      expect(result.signature).toBeTruthy();
      expect(result.signedTransaction).toHaveProperty("envelope_xdr");
      expect(result.signedTransaction).toHaveProperty("hash");
      expect(result.metadata?.paymentTransaction).toBe(true);
    });

    it("should handle payment with custom asset", async () => {
      const paymentOptions = {
        destination: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
        amount: "50",
        assetCode: "USDC",
        assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      };

      const result = await albedoProvider.pay(paymentOptions);

      expect(result.signature).toBeTruthy();
      expect(result.metadata?.paymentTransaction).toBe(true);
    });

    it("should handle payment rejection", async () => {
      const mockAPI = (albedoProvider as unknown).albedoAPI;
      mockAPI.pay = jest
        .fn()
        .mockRejectedValue(new Error("User rejected the request"));

      const paymentOptions = {
        destination: "GTEST",
        amount: "100",
      };

      await expect(albedoProvider.pay(paymentOptions)).rejects.toThrow(
        UserRejectedError
      );
    });

    it("should throw error when not connected", async () => {
      await albedoProvider.disconnect();

      const paymentOptions = {
        destination: "GTEST",
        amount: "100",
      };

      await expect(albedoProvider.pay(paymentOptions)).rejects.toThrow(
        ConnectionError
      );
    });
  });

  describe("Capabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = albedoProvider.getCapabilities();

      expect(capabilities.supportedChains).toEqual([ChainId.STELLAR]);
      expect(capabilities.supportsMultipleAccounts).toBe(false);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(1);
      expect(capabilities.metadata?.browserExtension).toBe(true);
      expect(capabilities.metadata?.stellarSpecific).toBe(true);
    });
  });

  describe("Extension Detection", () => {
    it("should check if Albedo is installed", async () => {
      // Mock window.albedo
      const originalWindow = global.window;
      (global as unknown).window = { albedo: {} };

      const isInstalled = await albedoProvider.isAlbedoInstalled();
      expect(isInstalled).toBe(true);

      // Restore original window
      global.window = originalWindow;
    });

    it("should return false when Albedo is not installed", async () => {
      const originalWindow = global.window;
      (global as unknown).window = {};

      const isInstalled = await albedoProvider.isAlbedoInstalled();
      expect(isInstalled).toBe(false);

      global.window = originalWindow;
    });
  });

  describe("Transaction Validation", () => {
    beforeEach(async () => {
      await albedoProvider.connect();
    });

    afterEach(async () => {
      await albedoProvider.disconnect();
    });

    it("should validate source account", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            fee: "100",
            sequenceNumber: "1",
            operations: [{ type: "payment" }],
            // Missing sourceAccount
          } as unknown as StellarTransaction,
        },
        accountAddress:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      };

      await expect(
        albedoProvider.signTransaction(invalidRequest)
      ).rejects.toThrow("Stellar transaction must have source account");
    });

    it("should validate operations", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            sourceAccount:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            fee: "100",
            sequenceNumber: "1",
            operations: [], // Empty operations
          } as StellarTransaction,
        },
        accountAddress:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      };

      await expect(
        albedoProvider.signTransaction(invalidRequest)
      ).rejects.toThrow("Stellar transaction must have operations");
    });

    it("should validate fee", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            sourceAccount:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            sequenceNumber: "1",
            operations: [{ type: "payment" }],
            // Missing fee
          } as unknown as StellarTransaction,
        },
        accountAddress:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      };

      await expect(
        albedoProvider.signTransaction(invalidRequest)
      ).rejects.toThrow("Stellar transaction must have fee");
    });

    it("should validate sequence number", async () => {
      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            sourceAccount:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            fee: "100",
            operations: [{ type: "payment" }],
            // Missing sequenceNumber
          } as unknown as StellarTransaction,
        },
        accountAddress:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      };

      await expect(
        albedoProvider.signTransaction(invalidRequest)
      ).rejects.toThrow("Stellar transaction must have sequence number");
    });
  });

  describe("Logging", () => {
    it("should log when debug logging is enabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      albedoProvider.updateConfig({ enableDebugLogging: true });

      await albedoProvider.connect();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[AlbedoSignatureProvider]"),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it("should not log when debug logging is disabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      albedoProvider.updateConfig({ enableDebugLogging: false });

      await albedoProvider.connect();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
