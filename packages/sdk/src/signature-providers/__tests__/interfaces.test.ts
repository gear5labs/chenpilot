import { ChainId } from "../../types";
import { BaseSignatureProvider } from "../interfaces";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  SignatureProviderMetadata,
} from "../types";
import { UnsupportedChainError } from "../errors";

// Mock implementation for testing
class MockSignatureProvider extends BaseSignatureProvider {
  private mockAccounts: SignatureProviderAccount[] = [];
  private mockCapabilities: SignatureProviderCapabilities;

  constructor(providerId: string, metadata: SignatureProviderMetadata) {
    super(providerId, metadata);
    this.mockCapabilities = {
      supportedChains: [ChainId.STELLAR, ChainId.STARKNET],
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 5,
    };
  }

  async connect(): Promise<SignatureProviderConnection> {
    this.connectionState = {
      isConnected: true,
      connectionId: "mock-connection-123",
      metadata: { mockProvider: true },
    };
    this.notifyConnectionChange(true);
    return this.connectionState;
  }

  async disconnect(): Promise<void> {
    this.connectionState = null;
    this.notifyConnectionChange(false);
  }

  async getAccounts(_chainId: ChainId): Promise<SignatureProviderAccount[]> {
    if (!this.mockCapabilities.supportedChains.includes(_chainId)) {
      throw new UnsupportedChainError(_chainId, this.providerId);
    }
    return this.mockAccounts;
  }

  async signTransaction(_request: SignatureRequest): Promise<SignatureResult> {
    void _request;
    return {
      signature: "mock-signature-123",
      publicKey: "mock-public-key-456",
      signedTransaction: { mockSigned: true },
      metadata: { mockSigning: true },
    };
  }

  getCapabilities(): SignatureProviderCapabilities {
    return this.mockCapabilities;
  }

  // Helper method for testing
  setMockAccounts(accounts: SignatureProviderAccount[]): void {
    this.mockAccounts = accounts;
  }
}

describe("SignatureProvider Interface", () => {
  let provider: MockSignatureProvider;
  const mockMetadata: SignatureProviderMetadata = {
    name: "Mock Provider",
    version: "1.0.0",
    description: "A mock signature provider for testing",
    icon: "mock-icon.png",
    website: "https://mock-provider.com",
  };

  beforeEach(() => {
    provider = new MockSignatureProvider("mock-provider", mockMetadata);
  });

  describe("Provider Identification", () => {
    it("should have correct provider ID and metadata", () => {
      expect(provider.providerId).toBe("mock-provider");
      expect(provider.metadata).toEqual(mockMetadata);
    });
  });

  describe("Connection Management", () => {
    it("should start disconnected", () => {
      expect(provider.isConnected()).toBe(false);
    });

    it("should connect successfully", async () => {
      const connection = await provider.connect();

      expect(provider.isConnected()).toBe(true);
      expect(connection.isConnected).toBe(true);
      expect(connection.connectionId).toBe("mock-connection-123");
      expect(connection.metadata).toEqual({ mockProvider: true });
    });

    it("should disconnect successfully", async () => {
      await provider.connect();
      expect(provider.isConnected()).toBe(true);

      await provider.disconnect();
      expect(provider.isConnected()).toBe(false);
    });

    it("should notify connection state changes", async () => {
      const connectionCallback = jest.fn();
      provider.onConnectionChange(connectionCallback);

      await provider.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await provider.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Account Management", () => {
    const mockAccounts: SignatureProviderAccount[] = [
      {
        address: "stellar-address-123",
        publicKey: "stellar-pubkey-123",
        chainId: ChainId.STELLAR,
        derivationPath: "m/44'/148'/0'",
        metadata: { accountName: "Main Account" },
      },
      {
        address: "starknet-address-456",
        publicKey: "starknet-pubkey-456",
        chainId: ChainId.STARKNET,
        derivationPath: "m/44'/9004'/0'/0/0",
        metadata: { accountName: "Secondary Account" },
      },
    ];

    beforeEach(() => {
      provider.setMockAccounts(mockAccounts);
    });

    it("should return accounts for supported chains", async () => {
      const stellarAccounts = await provider.getAccounts(ChainId.STELLAR);
      expect(stellarAccounts).toEqual(mockAccounts);

      const starknetAccounts = await provider.getAccounts(ChainId.STARKNET);
      expect(starknetAccounts).toEqual(mockAccounts);
    });

    it("should throw error for unsupported chains", async () => {
      await expect(provider.getAccounts(ChainId.BITCOIN)).rejects.toThrow(
        "Unsupported chain: bitcoin"
      );
    });

    it("should notify account changes", () => {
      const accountCallback = jest.fn();
      provider.onAccountChange(accountCallback);

      provider["notifyAccountChange"](mockAccounts);
      expect(accountCallback).toHaveBeenCalledWith(mockAccounts);
    });
  });

  describe("Transaction Signing", () => {
    it("should sign Stellar transactions", async () => {
      const request: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STELLAR,
          transaction: {
            sourceAccount: "GTEST123",
            fee: "100",
            sequenceNumber: "1",
            operations: [{ type: "payment" }],
          },
        },
        accountAddress: "stellar-address-123",
        metadata: { requestId: "req-123" },
      };

      const result = await provider.signTransaction(request);

      expect(result.signature).toBe("mock-signature-123");
      expect(result.publicKey).toBe("mock-public-key-456");
      expect(result.signedTransaction).toEqual({ mockSigned: true });
      expect(result.metadata).toEqual({ mockSigning: true });
    });

    it("should sign Starknet transactions", async () => {
      const request: SignatureRequest = {
        transactionData: {
          chainId: ChainId.STARKNET,
          transaction: {
            contractAddress: "0x123",
            entrypoint: "transfer",
            calldata: ["0x456", "1000", "0"],
          },
        },
        accountAddress: "starknet-address-456",
      };

      const result = await provider.signTransaction(request);
      expect(result).toBeDefined();
      expect(result.signature).toBeTruthy();
    });
  });

  describe("Provider Capabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.supportedChains).toEqual([
        ChainId.STELLAR,
        ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(false);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(5);
    });
  });

  describe("Error Handling in Callbacks", () => {
    it("should handle errors in connection callbacks gracefully", async () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      provider.onConnectionChange(errorCallback);
      provider.onConnectionChange(goodCallback);

      // Should not throw despite callback error
      await provider.connect();

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith(true);
    });

    it("should handle errors in account callbacks gracefully", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      provider.onAccountChange(errorCallback);
      provider.onAccountChange(goodCallback);

      const mockAccounts: SignatureProviderAccount[] = [];

      // Should not throw despite callback error
      provider["notifyAccountChange"](mockAccounts);

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith(mockAccounts);
    });
  });
});
