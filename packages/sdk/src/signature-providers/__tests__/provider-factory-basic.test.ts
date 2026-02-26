import { ChainId } from "../../types";
import {
  SignatureProviderFactory,
  ProviderType,
  ProviderConfig,
  ProviderUtils,
  signatureProviderFactory,
} from "../provider-factory";
import { MockSignatureProvider } from "../mock-provider";
import { LedgerSignatureProvider } from "../ledger-provider";

describe("SignatureProviderFactory - Basic Functionality", () => {
  let factory: SignatureProviderFactory;

  beforeEach(() => {
    factory = new SignatureProviderFactory({
      enableLogging: false,
    });
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

    it("should auto-connect provider when requested", async () => {
      const config: ProviderConfig = { type: ProviderType.MOCK };

      const provider = await factory.createProvider(config, {
        autoConnect: true,
      });

      expect(provider.isConnected()).toBe(true);
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
  });

  describe("Best Provider Selection", () => {
    it("should select best provider for chain", async () => {
      const provider = await factory.getBestProviderForChain(ChainId.STELLAR);

      expect(provider).toBeDefined();
      expect(provider.getCapabilities().supportedChains).toContain(
        ChainId.STELLAR
      );
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
  });

  describe("Global Factory Instance", () => {
    it("should provide global factory instance", () => {
      expect(signatureProviderFactory).toBeInstanceOf(SignatureProviderFactory);
    });
  });
});

describe("ProviderUtils - Basic Functionality", () => {
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
});
