import { ChainId } from "../../types";
import {
  LedgerSignatureProvider,
  LedgerProviderConfig,
} from "../ledger-provider";
import {
  SignatureRequest,
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "../types";
import {
  DeviceNotFoundError,
  DeviceLockedError,
  DeviceBusyError,
  HardwareWalletError,
  UnsupportedChainError,
  InvalidTransactionError,
  UserRejectedError,
  ConnectionError,
} from "../errors";

// Mock the transport for testing
jest.mock("../ledger-provider", () => {
  const actual = jest.requireActual("../ledger-provider");

  class MockLedgerTransport {
    private isOpen = true;
    private currentApp = "Dashboard";
    private deviceLocked = false;
    private deviceBusy = false;
    private shouldFailConnection = false;
    private shouldRejectSigning = false;

    async send(
      cla: number,
      ins: number,
      _p1: number,
      _p2: number,
      _data?: Buffer
    ): Promise<Buffer> {
      void cla;
      void ins;
      void _p1;
      void _p2;
      void _data;
      if (!this.isOpen) {
        throw new Error("Transport is closed");
      }

      if (this.shouldFailConnection) {
        throw new Error("No device found");
      }

      if (this.deviceBusy) {
        throw new Error("Device is busy");
      }

      if (this.deviceLocked) {
        throw new Error("Device is locked");
      }

      if (this.shouldRejectSigning && ins === 0x04) {
        throw new Error("User rejected");
      }

      // Simulate device responses
      if (ins === 0x01) {
        // Get app info
        return Buffer.concat([
          Buffer.from(this.currentApp, "ascii"),
          Buffer.from([0x01, 0x00, 0x00]),
          Buffer.from([0x90, 0x00]),
        ]);
      }

      if (ins === 0x02) {
        // Get public key
        return Buffer.concat([
          Buffer.from(
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            "hex"
          ),
          Buffer.from([0x90, 0x00]),
        ]);
      }

      if (ins === 0x04) {
        // Sign transaction
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Buffer.concat([
          Buffer.from(
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "hex"
          ),
          Buffer.from([0x90, 0x00]),
        ]);
      }

      return Buffer.from([0x90, 0x00]);
    }

    async close(): Promise<void> {
      this.isOpen = false;
    }

    setScrambleKey(_key: string): void {
      void _key;
    }

    // Test control methods
    setDeviceLocked(locked: boolean): void {
      this.deviceLocked = locked;
    }

    setDeviceBusy(busy: boolean): void {
      this.deviceBusy = busy;
    }

    setCurrentApp(app: string): void {
      this.currentApp = app;
    }

    setShouldFailConnection(fail: boolean): void {
      this.shouldFailConnection = fail;
    }

    setShouldRejectSigning(reject: boolean): void {
      this.shouldRejectSigning = reject;
    }
  }

  return {
    ...actual,
    MockLedgerTransport,
  };
});

describe("LedgerSignatureProvider", () => {
  let ledgerProvider: LedgerSignatureProvider;
  let _mockTransport: unknown;

  beforeEach(() => {
    ledgerProvider = new LedgerSignatureProvider();
    void _mockTransport;

    // Access the mock transport through the provider's private methods
    // In a real test, we'd mock the transport creation
  });

  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(ledgerProvider.providerId).toBe("ledger-provider");
      expect(ledgerProvider.metadata.name).toBe("Ledger Hardware Wallet");
      expect(ledgerProvider.isConnected()).toBe(false);
    });

    it("should accept custom configuration", () => {
      const config: LedgerProviderConfig = {
        connectionTimeout: 5000,
        autoOpenApps: true,
        enableDebugLogging: true,
      };

      const customProvider = new LedgerSignatureProvider(config);
      const providerConfig = customProvider.getConfig();

      expect(providerConfig.connectionTimeout).toBe(5000);
      expect(providerConfig.autoOpenApps).toBe(true);
      expect(providerConfig.enableDebugLogging).toBe(true);
    });

    it("should update configuration", () => {
      ledgerProvider.updateConfig({
        connectionTimeout: 15000,
        autoOpenApps: true,
      });

      const config = ledgerProvider.getConfig();
      expect(config.connectionTimeout).toBe(15000);
      expect(config.autoOpenApps).toBe(true);
    });
  });

  describe("Connection Management", () => {
    it("should connect successfully", async () => {
      const connection = await ledgerProvider.connect();

      expect(ledgerProvider.isConnected()).toBe(true);
      expect(connection.isConnected).toBe(true);
      expect(connection.connectionId).toMatch(/^ledger-/);
      expect(connection.metadata?.deviceInfo).toBeDefined();
      expect(connection.metadata?.currentApp).toBeDefined();
    });

    it("should handle device not found error", async () => {
      // Mock transport creation to fail
      const originalCreateTransport = (ledgerProvider as unknown)
        .createTransport;
      (ledgerProvider as unknown).createTransport = jest
        .fn()
        .mockRejectedValue(new Error("No device found"));

      await expect(ledgerProvider.connect()).rejects.toThrow(
        DeviceNotFoundError
      );

      // Restore original method
      (ledgerProvider as unknown).createTransport = originalCreateTransport;
    });

    it("should handle device locked error", async () => {
      const originalCreateTransport = (ledgerProvider as unknown)
        .createTransport;
      (ledgerProvider as unknown).createTransport = jest
        .fn()
        .mockRejectedValue(new Error("Device is locked"));

      await expect(ledgerProvider.connect()).rejects.toThrow(DeviceLockedError);

      (ledgerProvider as unknown).createTransport = originalCreateTransport;
    });

    it("should handle device busy error", async () => {
      const originalCreateTransport = (ledgerProvider as unknown)
        .createTransport;
      (ledgerProvider as unknown).createTransport = jest
        .fn()
        .mockRejectedValue(new Error("Device is busy"));

      await expect(ledgerProvider.connect()).rejects.toThrow(DeviceBusyError);

      (ledgerProvider as unknown).createTransport = originalCreateTransport;
    });

    it("should disconnect successfully", async () => {
      await ledgerProvider.connect();
      expect(ledgerProvider.isConnected()).toBe(true);

      await ledgerProvider.disconnect();
      expect(ledgerProvider.isConnected()).toBe(false);
    });

    it("should notify connection state changes", async () => {
      const connectionCallback = jest.fn();
      ledgerProvider.onConnectionChange(connectionCallback);

      await ledgerProvider.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await ledgerProvider.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Account Management", () => {
    beforeEach(async () => {
      await ledgerProvider.connect();
    });

    afterEach(async () => {
      await ledgerProvider.disconnect();
    });

    it("should get Bitcoin accounts", async () => {
      // Mock the app to be Bitcoin
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const accounts = await ledgerProvider.getAccounts(ChainId.BITCOIN);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].chainId).toBe(ChainId.BITCOIN);
      expect(accounts[0].address).toMatch(/^bc1/);
      expect(accounts[0].derivationPath).toBe("m/84'/0'/0'/0/0");
      expect(accounts[0].metadata?.hardwareWallet).toBe(true);
    });

    it("should get Stellar accounts", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Stellar",
        version: "1.0.0",
        flags: 0,
      };

      const accounts = await ledgerProvider.getAccounts(ChainId.STELLAR);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].chainId).toBe(ChainId.STELLAR);
      expect(accounts[0].address).toMatch(/^G/);
      expect(accounts[0].derivationPath).toBe("m/44'/148'/0'");
    });

    it("should get Starknet accounts", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Starknet",
        version: "1.0.0",
        flags: 0,
      };

      const accounts = await ledgerProvider.getAccounts(ChainId.STARKNET);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].chainId).toBe(ChainId.STARKNET);
      expect(accounts[0].address).toMatch(/^0x/);
      expect(accounts[0].derivationPath).toBe("m/44'/9004'/0'/0/0");
    });

    it("should cache accounts", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const accounts1 = await ledgerProvider.getAccounts(ChainId.BITCOIN);
      const accounts2 = await ledgerProvider.getAccounts(ChainId.BITCOIN);

      expect(accounts1).toBe(accounts2); // Should return cached instance
    });

    it("should throw error when device not connected", async () => {
      await ledgerProvider.disconnect();

      await expect(ledgerProvider.getAccounts(ChainId.BITCOIN)).rejects.toThrow(
        ConnectionError
      );
    });

    it("should throw error when wrong app is open", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Dashboard",
        version: "1.0.0",
        flags: 0,
      };

      await expect(ledgerProvider.getAccounts(ChainId.BITCOIN)).rejects.toThrow(
        HardwareWalletError
      );
    });
  });

  describe("Transaction Signing", () => {
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
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
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

    beforeEach(async () => {
      await ledgerProvider.connect();
    });

    afterEach(async () => {
      await ledgerProvider.disconnect();
    });

    it("should sign Bitcoin transactions", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const request = createBitcoinSigningRequest();
      const result = await ledgerProvider.signTransaction(request);

      expect(result.signature).toMatch(/^304402/); // DER signature format
      expect(result.publicKey).toBeTruthy();
      expect(result.signedTransaction).toHaveProperty("signatures");
      expect(result.metadata?.ledgerProvider).toBe(true);
      expect(result.metadata?.chainId).toBe(ChainId.BITCOIN);
    });

    it("should sign Stellar transactions", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Stellar",
        version: "1.0.0",
        flags: 0,
      };

      const request = createStellarSigningRequest();
      const result = await ledgerProvider.signTransaction(request);

      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();
      expect(result.signedTransaction).toHaveProperty("signatures");
      expect(result.metadata?.chainId).toBe(ChainId.STELLAR);
    });

    it("should sign Starknet transactions", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Starknet",
        version: "1.0.0",
        flags: 0,
      };

      const request = createStarknetSigningRequest();
      const result = await ledgerProvider.signTransaction(request);

      expect(result.signature).toBeTruthy();
      expect(result.publicKey).toBeTruthy();
      expect(result.signedTransaction).toHaveProperty("signature");
      expect(result.metadata?.chainId).toBe(ChainId.STARKNET);
    });

    it("should throw error when device not connected", async () => {
      await ledgerProvider.disconnect();

      await expect(
        ledgerProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(ConnectionError);
    });

    it("should handle user rejection", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      // Mock transport to simulate user rejection
      const originalTransport = (
        ledgerProvider as unknown as { transport: unknown }
      ).transport;
      (ledgerProvider as unknown as { transport: unknown }).transport = {
        send: jest.fn().mockRejectedValue(new Error("User rejected")),
      };

      await expect(
        ledgerProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(UserRejectedError);

      (ledgerProvider as unknown as { transport: unknown }).transport =
        originalTransport;
    });

    it("should validate transaction format", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const invalidRequest: SignatureRequest = {
        transactionData: {
          chainId: ChainId.BITCOIN,
          transaction: { inputs: [] } as unknown as BitcoinTransaction, // Invalid: no outputs
        },
        accountAddress: "test-address",
      };

      await expect(
        ledgerProvider.signTransaction(invalidRequest)
      ).rejects.toThrow(InvalidTransactionError);
    });

    it("should handle device locked during signing", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const originalTransport = (
        ledgerProvider as unknown as { transport: unknown }
      ).transport;
      (ledgerProvider as unknown as { transport: unknown }).transport = {
        send: jest.fn().mockRejectedValue(new Error("Device is locked")),
      };

      await expect(
        ledgerProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(DeviceLockedError);

      (ledgerProvider as unknown as { transport: unknown }).transport =
        originalTransport;
    });

    it("should handle device busy during signing", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const originalTransport = (
        ledgerProvider as unknown as { transport: unknown }
      ).transport;
      (ledgerProvider as unknown as { transport: unknown }).transport = {
        send: jest.fn().mockRejectedValue(new Error("Device is busy")),
      };

      await expect(
        ledgerProvider.signTransaction(createBitcoinSigningRequest())
      ).rejects.toThrow(DeviceBusyError);

      (ledgerProvider as unknown as { transport: unknown }).transport =
        originalTransport;
    });
  });

  describe("Capabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = ledgerProvider.getCapabilities();

      expect(capabilities.supportedChains).toEqual([
        ChainId.BITCOIN,
        ChainId.STELLAR,
        ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(false);
      expect(capabilities.maxConcurrentSignatures).toBe(1);
      expect(capabilities.metadata?.hardwareWallet).toBe(true);
      expect(capabilities.metadata?.requiresPhysicalConfirmation).toBe(true);
      expect(capabilities.metadata?.secureElement).toBe(true);
    });
  });

  describe("App Management", () => {
    beforeEach(async () => {
      await ledgerProvider.connect();
    });

    afterEach(async () => {
      await ledgerProvider.disconnect();
    });

    it("should check if app is open", async () => {
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      const isBitcoinOpen = await ledgerProvider.isAppOpen(ChainId.BITCOIN);
      const isStellarOpen = await ledgerProvider.isAppOpen(ChainId.STELLAR);

      expect(isBitcoinOpen).toBe(true);
      expect(isStellarOpen).toBe(false);
    });

    it("should handle auto-open apps when enabled", async () => {
      ledgerProvider.updateConfig({ autoOpenApps: true });
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Dashboard",
        version: "1.0.0",
        flags: 0,
      };

      // This should not throw when autoOpenApps is enabled
      const accounts = await ledgerProvider.getAccounts(ChainId.BITCOIN);
      expect(accounts).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle transport errors gracefully", async () => {
      await ledgerProvider.connect();

      const originalTransport = (
        ledgerProvider as unknown as { transport: unknown }
      ).transport;
      (ledgerProvider as unknown as { transport: unknown }).transport = {
        send: jest.fn().mockRejectedValue(new Error("Transport error")),
      };

      await expect(
        ledgerProvider.getAccounts(ChainId.BITCOIN)
      ).rejects.toThrow();

      (ledgerProvider as unknown as { transport: unknown }).transport =
        originalTransport;
    });

    it("should handle unsupported chains", async () => {
      await ledgerProvider.connect();

      await expect(
        ledgerProvider.getAccounts("unsupported-chain" as ChainId)
      ).rejects.toThrow(UnsupportedChainError);
    });

    it("should clear cache on disconnect", async () => {
      await ledgerProvider.connect();
      (ledgerProvider as unknown as { currentApp: unknown }).currentApp = {
        name: "Bitcoin",
        version: "1.0.0",
        flags: 0,
      };

      // Get accounts to populate cache
      await ledgerProvider.getAccounts(ChainId.BITCOIN);
      expect(
        (ledgerProvider as unknown as { cachedAccounts: { size: number } })
          .cachedAccounts.size
      ).toBe(1);

      await ledgerProvider.disconnect();
      expect(
        (ledgerProvider as unknown as { cachedAccounts: { size: number } })
          .cachedAccounts.size
      ).toBe(0);
    });
  });

  describe("Logging", () => {
    it("should log when debug logging is enabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      ledgerProvider.updateConfig({ enableDebugLogging: true });

      await ledgerProvider.connect();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[LedgerSignatureProvider]"),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it("should not log when debug logging is disabled", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      ledgerProvider.updateConfig({ enableDebugLogging: false });

      await ledgerProvider.connect();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
