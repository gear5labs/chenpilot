import { ChainId } from "../../types";
import {
  SignatureProviderFactory,
  ProviderType,
  ProviderConfig,
  ProviderUtils,
  signatureProviderFactory,
} from "../provider-factory";
import { SignatureProviderRegistry } from "../registry";
import { MockSignatureProvider } from "../mock-provider";
import { LedgerSignatureProvider } from "../ledger-provider";
import { AlbedoSignatureProvider } from "../albedo-provider";
import {
  SignatureProviderError,
  UnsupportedChainError,
  ConnectionError,
} from "../errors";

describe("SignatureProviderFactory", () => {
  let factory: SignatureProviderFactory;
  let registry: SignatureProviderRegistry;

  beforeEach(() => {
    factory = new SignatureProviderFactory({
      enableLogging: false,
    });
    registry = new SignatureProviderRegistry();
  });

  afterEach(async () => {
    await factory.dispose();
  });

  describe("Provider Creation", () => {
    it("should create mock provider", async () => {
      const config: ProviderConfig = {
        type: ProviderType.MOCK,
        config: { enableLogging: true },
      };

      const provider = await factory.createProvider(config);

      expect(provider).toBeInstanceOf(MockSignatureProvider);
      expect(provider.providerId).toBe("mock-provider");
    });

    it("should create ledger provider", async () => {
      const config: ProviderConfig = {
        type: ProviderType.LEDGER,
        config: { enableDebugLogging: true },
      };

      const provider = await factory.createProvider(config);

      expect(provider).toBeInstanceOf(LedgerSignatureProvider);
      expect(provider.providerId).toBe("ledger-provider");
    });

    it("should create albedo provider", async () => {
      const config: ProviderConfig = {
        type: ProviderType.ALBEDO,
        config: { enableDebugLogging: true },
      };

      const provider = await factory.createProvider(config);

      expect(provider).toBeInstanceOf(AlbedoSignatureProvider);
      expect(provider.providerId).toBe("albedo-provider");
    });

    it("should throw error for unsupported provider type", async () => {
      const config = {
        type: "unsupported" as ProviderType,
      } as ProviderConfig;

      await expect(factory.createProvider(config)).rejects.toThrow(
        SignatureProviderError
      );
    });

    it("should auto-register provider when requested", async () => {
      const config: ProviderConfig = { type: ProviderType.MOCK };

      const provider = await factory.createProvider(config, {
        autoRegister: true,
        registry,
      });

      expect(registry.hasProvider(provider.providerId)).toBe(true);
    });

    it("should auto-connect provider when requested", async () => {
      const config: ProviderConfig = { type: ProviderType.MOCK };

      const provider = await factory.createProvider(config, {
        autoConnect: true,
      });

      expect(provider.isConnected()).toBe(true);
    });

    it("should handle connection failures with retry", async () => {
      const config: ProviderConfig = {
        type: ProviderType.MOCK,
        config: { shouldFailConnection: true },
      };

      await expect(
        factory.createProvider(config, {
          autoConnect: true,
          retries: 2,
          timeout: 1000,
        })
      ).rejects.toThrow(ConnectionError);
    });
  });

  describe("Multiple Provider Creation", () => {
    it("should create multiple providers", async () => {
      const configs: ProviderConfig[] = [
        { type: ProviderType.MOCK },
        { type: ProviderType.LEDGER },
        { type: ProviderType.ALBEDO },
      ];

      const providers = await factory.createProviders(configs);

      expect(providers).toHaveLength(3);
      expect(providers[0]).toBeInstanceOf(MockSignatureProvider);
      expect(providers[1]).toBeInstanceOf(LedgerSignatureProvider);
      expect(providers[2]).toBeInstanceOf(AlbedoSignatureProvider);
    });

    it("should handle partial failures when not auto-connecting", async () => {
      const configs: ProviderConfig[] = [
        { type: ProviderType.MOCK },
        { type: "invalid" as ProviderType } as ProviderConfig,
      ];

      const providers = await factory.createProviders(configs, {
        autoConnect: false,
      });

      expect(providers).toHaveLength(1);
      expect(providers[0]).toBeInstanceOf(MockSignatureProvider);
    });

    it("should throw error when all providers fail", async () => {
      const configs: ProviderConfig[] = [
        { type: "invalid1" as ProviderType } as ProviderConfig,
        { type: "invalid2" as ProviderType } as ProviderConfig,
      ];

      await expect(
        factory.createProviders(configs, { autoConnect: false })
      ).rejects.toThrow(SignatureProviderError);
    });
  });

  describe("Provider Discovery", () => {
    it("should discover available providers", async () => {
      const discoveries = await factory.discoverProviders();

      expect(discoveries).toHaveLength(3);

      const mockDiscovery = discoveries.find(
        (d) => d.type === ProviderType.MOCK
      );
      expect(mockDiscovery?.available).toBe(true);

      const ledgerDiscovery = discoveries.find(
        (d) => d.type === ProviderType.LEDGER
      );
      expect(ledgerDiscovery?.available).toBe(true);

      // Albedo might not be available in test environment
      const albedoDiscovery = discoveries.find(
        (d) => d.type === ProviderType.ALBEDO
      );
      expect(albedoDiscovery).toBeDefined();
    });

    it("should use cache on subsequent discovery calls", async () => {
      const discoveries1 = await factory.discoverProviders();
      const discoveries2 = await factory.discoverProviders(true);

      expect(discoveries1).toEqual(discoveries2);
    });

    it("should bypass cache when requested", async () => {
      await factory.discoverProviders();
      const discoveries = await factory.discoverProviders(false);

      expect(discoveries).toBeDefined();
    });

    it("should clear discovery cache", async () => {
      await factory.discoverProviders();
      factory.clearDiscoveryCache();

      // Should rediscover
      const discoveries = await factory.discoverProviders();
      expect(discoveries).toBeDefined();
    });
  });

  describe("Chain-Specific Provider Creation", () => {
    it("should create providers for Bitcoin", async () => {
      const providers = await factory.createProvidersForChain(ChainId.BITCOIN);

      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((provider) => {
        expect(provider.getCapabilities().supportedChains).toContain(
          ChainId.BITCOIN
        );
      });
    });

    it("should create providers for Stellar", async () => {
      const providers = await factory.createProvidersForChain(ChainId.STELLAR);

      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((provider) => {
        expect(provider.getCapabilities().supportedChains).toContain(
          ChainId.STELLAR
        );
      });
    });

    it("should create providers for Starknet", async () => {
      const providers = await factory.createProvidersForChain(ChainId.STARKNET);

      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((provider) => {
        expect(provider.getCapabilities().supportedChains).toContain(
          ChainId.STARKNET
        );
      });
    });

    it("should throw error for unsupported chain", async () => {
      await expect(
        factory.createProvidersForChain("unsupported-chain" as ChainId)
      ).rejects.toThrow(UnsupportedChainError);
    });
  });

  describe("Best Provider Selection", () => {
    it("should select best provider for chain", async () => {
      const provider = await factory.getBestProviderForChain(ChainId.STELLAR);

      expect(provider).toBeDefined();
      expect(provider.getCapabilities().supportedChains).toContain(
        ChainId.STELLAR
      );
    });

    it("should prefer hardware wallet when requested", async () => {
      const provider = await factory.getBestProviderForChain(ChainId.BITCOIN, {
        preferHardwareWallet: true,
      });

      expect(provider).toBeDefined();
      // In our test setup, Ledger would be preferred for hardware wallet
    });

    it("should prefer browser extension when requested", async () => {
      const provider = await factory.getBestProviderForChain(ChainId.STELLAR, {
        preferBrowserExtension: true,
      });

      expect(provider).toBeDefined();
    });
  });

  describe("Provider Instance Management", () => {
    it("should store and retrieve provider instances", async () => {
      const config: ProviderConfig = { type: ProviderType.MOCK };
      const provider = await factory.createProvider(config);

      const retrieved = factory.getProvider(provider.providerId);
      expect(retrieved).toBe(provider);
    });

    it("should return undefined for non-existent provider", () => {
      const provider = factory.getProvider("non-existent");
      expect(provider).toBeUndefined();
    });
  });

  describe("Factory Disposal", () => {
    it("should dispose of all providers", async () => {
      const configs: ProviderConfig[] = [
        { type: ProviderType.MOCK },
        { type: ProviderType.LEDGER },
      ];

      const providers = await factory.createProviders(configs, {
        autoConnect: true,
      });

      expect(providers.every((p) => p.isConnected())).toBe(true);

      await factory.dispose();

      expect(providers.every((p) => !p.isConnected())).toBe(true);
    });

    it("should handle disposal errors gracefully", async () => {
      const config: ProviderConfig = { type: ProviderType.MOCK };
      const provider = await factory.createProvider(config, {
        autoConnect: true,
      });

      // Mock a disconnect error
      const originalDisconnect = provider.disconnect;
      provider.disconnect = jest
        .fn()
        .mockRejectedValue(new Error("Disconnect failed"));

      // Should not throw
      await expect(factory.dispose()).resolves.toBeUndefined();

      // Restore original method
      provider.disconnect = originalDisconnect;
    });
  });

  describe("Global Factory Instance", () => {
    it("should provide global factory instance", () => {
      expect(signatureProviderFactory).toBeInstanceOf(SignatureProviderFactory);
    });
  });

  describe("Error Handling", () => {
    it("should handle provider creation errors", async () => {
      // Mock a provider that throws during construction
      const originalCreateMock = (factory as unknown).createMockProvider;
      (factory as unknown).createMockProvider = jest.fn(() => {
        throw new Error("Mock creation failed");
      });

      const config: ProviderConfig = { type: ProviderType.MOCK };

      await expect(factory.createProvider(config)).rejects.toThrow(
        SignatureProviderError
      );

      // Restore original method
      (factory as unknown).createMockProvider = originalCreateMock;
    });

    it("should handle connection timeout", async () => {
      const config: ProviderConfig = {
        type: ProviderType.MOCK,
        config: { connectionDelay: 2000 }, // Longer than timeout
      };

      await expect(
        factory.createProvider(config, {
          autoConnect: true,
          timeout: 500, // Short timeout
          retries: 1,
        })
      ).rejects.toThrow(ConnectionError);
    });
  });
});

describe("ProviderUtils", () => {
  afterEach(async () => {
    await signatureProviderFactory.dispose();
  });

  describe("Convenience Methods", () => {
    it("should create and connect provider", async () => {
      const provider = await ProviderUtils.createAndConnect(ProviderType.MOCK);

      expect(provider).toBeInstanceOf(MockSignatureProvider);
      expect(provider.isConnected()).toBe(true);
    });

    it("should get providers for chain", async () => {
      const providers = await ProviderUtils.getProvidersForChain(
        ChainId.STELLAR
      );

      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((provider) => {
        expect(provider.getCapabilities().supportedChains).toContain(
          ChainId.STELLAR
        );
      });
    });

    it("should get best provider", async () => {
      const provider = await ProviderUtils.getBestProvider(ChainId.BITCOIN);

      expect(provider).toBeDefined();
      expect(provider.getCapabilities().supportedChains).toContain(
        ChainId.BITCOIN
      );
    });

    it("should discover all providers", async () => {
      const discoveries = await ProviderUtils.discoverAll();

      expect(discoveries).toHaveLength(3);
      expect(discoveries.some((d) => d.type === ProviderType.MOCK)).toBe(true);
      expect(discoveries.some((d) => d.type === ProviderType.LEDGER)).toBe(
        true
      );
      expect(discoveries.some((d) => d.type === ProviderType.ALBEDO)).toBe(
        true
      );
    });

    it("should create mock provider for testing", () => {
      const provider = ProviderUtils.createMockProvider({
        enableLogging: true,
      });

      expect(provider).toBeInstanceOf(MockSignatureProvider);
      expect(provider.providerId).toBe("test-mock-provider");
    });
  });

  describe("Error Scenarios", () => {
    it("should handle connection failures", async () => {
      await expect(
        ProviderUtils.createAndConnect(ProviderType.MOCK, {
          shouldFailConnection: true,
        })
      ).rejects.toThrow(ConnectionError);
    });

    it("should handle unsupported chains", async () => {
      await expect(
        ProviderUtils.getProvidersForChain("unsupported" as ChainId)
      ).rejects.toThrow(UnsupportedChainError);
    });
  });
});
