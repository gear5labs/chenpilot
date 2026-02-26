import { ChainId } from "../../types";
import {
  SignatureProviderRegistry,
  signatureProviderRegistry,
} from "../registry";
import { BaseSignatureProvider, SignatureProvider } from "../interfaces";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  SignatureProviderMetadata,
} from "../types";
import { ProviderNotFoundError } from "../errors";

// Mock provider implementations for testing
class MockProvider extends BaseSignatureProvider {
  private mockConnected = false;
  private mockAccounts: SignatureProviderAccount[] = [];
  private mockCapabilities: SignatureProviderCapabilities;

  constructor(
    providerId: string,
    metadata: SignatureProviderMetadata,
    supportedChains: ChainId[] = [ChainId.STELLAR]
  ) {
    super(providerId, metadata);
    this.mockCapabilities = {
      supportedChains,
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 1,
    };
  }

  async connect(): Promise<SignatureProviderConnection> {
    this.mockConnected = true;
    this.connectionState = {
      isConnected: true,
      connectionId: `${this.providerId}-connection`,
    };
    return this.connectionState;
  }

  async disconnect(): Promise<void> {
    this.mockConnected = false;
    this.connectionState = null;
  }

  isConnected(): boolean {
    return this.mockConnected;
  }

  async getAccounts(_chainId: ChainId): Promise<SignatureProviderAccount[]> {
    void _chainId;
    return this.mockAccounts;
  }

  async signTransaction(_request: SignatureRequest): Promise<SignatureResult> {
    void _request;
    return {
      signature: "mock-signature",
      publicKey: "mock-public-key",
    };
  }

  getCapabilities(): SignatureProviderCapabilities {
    return this.mockCapabilities;
  }

  // Test helpers
  setMockAccounts(accounts: SignatureProviderAccount[]): void {
    this.mockAccounts = accounts;
  }
}

describe("SignatureProviderRegistry", () => {
  let registry: SignatureProviderRegistry;
  let mockProvider1: MockProvider;
  let mockProvider2: MockProvider;
  let mockProvider3: MockProvider;

  const mockMetadata1: SignatureProviderMetadata = {
    name: "Mock Provider 1",
    version: "1.0.0",
    description: "First mock provider",
  };

  const mockMetadata2: SignatureProviderMetadata = {
    name: "Mock Provider 2",
    version: "2.0.0",
    description: "Second mock provider",
  };

  const mockMetadata3: SignatureProviderMetadata = {
    name: "Multi-Chain Provider",
    version: "1.0.0",
    description: "Provider supporting multiple chains",
  };

  beforeEach(() => {
    registry = new SignatureProviderRegistry();
    mockProvider1 = new MockProvider("provider1", mockMetadata1, [
      ChainId.STELLAR,
    ]);
    mockProvider2 = new MockProvider("provider2", mockMetadata2, [
      ChainId.STARKNET,
    ]);
    mockProvider3 = new MockProvider("provider3", mockMetadata3, [
      ChainId.STELLAR,
      ChainId.STARKNET,
      ChainId.BITCOIN,
    ]);
  });

  describe("Provider Registration", () => {
    it("should register a provider successfully", () => {
      registry.register(mockProvider1);

      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.getProviderCount()).toBe(1);
      expect(registry.getProvider("provider1")).toBe(mockProvider1);
    });

    it("should register multiple providers", () => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);

      expect(registry.getProviderCount()).toBe(2);
      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.hasProvider("provider2")).toBe(true);
    });

    it("should throw error when registering duplicate provider ID", () => {
      registry.register(mockProvider1);

      expect(() => registry.register(mockProvider1)).toThrow(
        "Provider with ID 'provider1' is already registered"
      );
    });

    it("should validate provider implementation during registration", () => {
      const invalidProvider = {} as unknown;

      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });

    it("should notify registration callbacks", () => {
      const callback = jest.fn();
      registry.onProviderRegistered(callback);

      registry.register(mockProvider1);

      expect(callback).toHaveBeenCalledWith("provider1", mockProvider1);
    });

    it("should handle errors in registration callbacks gracefully", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      registry.onProviderRegistered(errorCallback);
      registry.onProviderRegistered(goodCallback);

      // Should not throw despite callback error
      registry.register(mockProvider1);

      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith("provider1", mockProvider1);
    });
  });

  describe("Provider Unregistration", () => {
    beforeEach(() => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
    });

    it("should unregister a provider successfully", () => {
      registry.unregister("provider1");

      expect(registry.hasProvider("provider1")).toBe(false);
      expect(registry.getProviderCount()).toBe(1);
      expect(registry.hasProvider("provider2")).toBe(true);
    });

    it("should throw error when unregistering non-existent provider", () => {
      expect(() => registry.unregister("nonexistent")).toThrow(
        ProviderNotFoundError
      );
    });

    it("should disconnect provider before unregistering", async () => {
      await mockProvider1.connect();
      expect(mockProvider1.isConnected()).toBe(true);

      registry.unregister("provider1");

      // Give time for async disconnect
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockProvider1.isConnected()).toBe(false);
    });

    it("should notify unregistration callbacks", () => {
      const callback = jest.fn();
      registry.onProviderUnregistered(callback);

      registry.unregister("provider1");

      expect(callback).toHaveBeenCalledWith("provider1");
    });
  });

  describe("Provider Retrieval", () => {
    beforeEach(() => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
      registry.register(mockProvider3);
    });

    it("should get provider by ID", () => {
      const provider = registry.getProvider("provider1");
      expect(provider).toBe(mockProvider1);
    });

    it("should throw error for non-existent provider", () => {
      expect(() => registry.getProvider("nonexistent")).toThrow(
        ProviderNotFoundError
      );
    });

    it("should list all providers", () => {
      const providers = registry.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain(mockProvider1);
      expect(providers).toContain(mockProvider2);
      expect(providers).toContain(mockProvider3);
    });

    it("should check if provider exists", () => {
      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.hasProvider("nonexistent")).toBe(false);
    });

    it("should get provider count", () => {
      expect(registry.getProviderCount()).toBe(3);

      registry.unregister("provider1");
      expect(registry.getProviderCount()).toBe(2);
    });
  });

  describe("Chain-Based Provider Discovery", () => {
    beforeEach(() => {
      registry.register(mockProvider1); // Stellar only
      registry.register(mockProvider2); // Starknet only
      registry.register(mockProvider3); // All chains
    });

    it("should find providers for specific chain", () => {
      const stellarProviders = registry.findProvidersForChain(ChainId.STELLAR);
      expect(stellarProviders).toHaveLength(2);
      expect(stellarProviders).toContain(mockProvider1);
      expect(stellarProviders).toContain(mockProvider3);

      const starknetProviders = registry.findProvidersForChain(
        ChainId.STARKNET
      );
      expect(starknetProviders).toHaveLength(2);
      expect(starknetProviders).toContain(mockProvider2);
      expect(starknetProviders).toContain(mockProvider3);

      const bitcoinProviders = registry.findProvidersForChain(ChainId.BITCOIN);
      expect(bitcoinProviders).toHaveLength(1);
      expect(bitcoinProviders).toContain(mockProvider3);
    });

    it("should find multi-chain providers", () => {
      const multiChainProviders = registry.findMultiChainProviders([
        ChainId.STELLAR,
        ChainId.STARKNET,
      ]);
      expect(multiChainProviders).toHaveLength(1);
      expect(multiChainProviders).toContain(mockProvider3);

      const allChainProviders = registry.findMultiChainProviders([
        ChainId.STELLAR,
        ChainId.STARKNET,
        ChainId.BITCOIN,
      ]);
      expect(allChainProviders).toHaveLength(1);
      expect(allChainProviders).toContain(mockProvider3);
    });

    it("should return empty array for unsupported chain combinations", () => {
      const impossibleProviders = registry.findMultiChainProviders([
        ChainId.STELLAR,
        ChainId.STARKNET,
        ChainId.BITCOIN,
        "unsupported-chain" as ChainId,
      ]);
      expect(impossibleProviders).toHaveLength(0);
    });
  });

  describe("Registry Clearing", () => {
    beforeEach(async () => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
      await mockProvider1.connect();
      await mockProvider2.connect();
    });

    it("should clear all providers", async () => {
      expect(registry.getProviderCount()).toBe(2);
      expect(mockProvider1.isConnected()).toBe(true);
      expect(mockProvider2.isConnected()).toBe(true);

      registry.clear();

      // Give time for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(registry.getProviderCount()).toBe(0);
      expect(mockProvider1.isConnected()).toBe(false);
      expect(mockProvider2.isConnected()).toBe(false);
    });

    it("should notify unregistration callbacks for all providers when clearing", async () => {
      const callback = jest.fn();
      registry.onProviderUnregistered(callback);

      registry.clear();

      // Give time for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith("provider1");
      expect(callback).toHaveBeenCalledWith("provider2");
    });
  });

  describe("Provider Validation", () => {
    it("should validate provider has required methods", () => {
      const invalidProvider = {
        providerId: "invalid",
        metadata: mockMetadata1,
        // Missing required methods
      } as unknown;

      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider invalid missing required method: connect"
      );
    });

    it("should validate provider has required properties", () => {
      const invalidProvider = {
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
        // Missing providerId and metadata
      } as unknown as SignatureProvider;

      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });

    it("should validate provider metadata structure", () => {
      const invalidProvider = {
        providerId: "test",
        metadata: {}, // Invalid metadata - intentionally empty for testing
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
      } as unknown as SignatureProvider;

      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider test metadata must include name, version, and description"
      );
    });

    it("should validate providerId is non-empty string", () => {
      const invalidProvider: SignatureProvider = {
        providerId: "", // Empty string
        metadata: mockMetadata1,
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
      };

      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });
  });

  describe("Global Registry Instance", () => {
    it("should provide a global registry instance", () => {
      expect(signatureProviderRegistry).toBeInstanceOf(
        SignatureProviderRegistry
      );
    });

    it("should maintain state across imports", () => {
      signatureProviderRegistry.register(mockProvider1);
      expect(signatureProviderRegistry.hasProvider("provider1")).toBe(true);

      // Clean up
      signatureProviderRegistry.unregister("provider1");
    });
  });

  describe("Error Handling", () => {
    it("should handle provider disconnect errors gracefully during unregistration", async () => {
      const faultyProvider = new MockProvider("faulty", mockMetadata1);
      faultyProvider.disconnect = jest
        .fn()
        .mockRejectedValue(new Error("Disconnect failed"));

      registry.register(faultyProvider);
      await faultyProvider.connect();

      // Should not throw despite disconnect error
      expect(() => registry.unregister("faulty")).not.toThrow();
    });

    it("should handle provider disconnect errors gracefully during clear", async () => {
      const faultyProvider = new MockProvider("faulty", mockMetadata1);
      faultyProvider.disconnect = jest
        .fn()
        .mockRejectedValue(new Error("Disconnect failed"));

      registry.register(faultyProvider);
      await faultyProvider.connect();

      // Should not throw despite disconnect error
      expect(() => registry.clear()).not.toThrow();
    });
  });
});
