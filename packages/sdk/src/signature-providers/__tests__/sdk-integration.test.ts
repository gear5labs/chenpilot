import { ChainId } from "../../types";
import {
  SignatureProviderSDK,
  signatureProviderSDK,
  SDKUtils,
  SignatureProviderSDKBuilder,
  createSDKBuilder,
} from "../sdk-integration";
import { ProviderType } from "../types";
import { MockSignatureProvider } from "../mock-provider";

describe("SignatureProvider SDK Integration", () => {
  let sdk: SignatureProviderSDK;

  beforeEach(() => {
    sdk = new SignatureProviderSDK({
      enableLogging: false,
      enableMetrics: true,
      autoDiscovery: false, // Disable for controlled testing
    });
  });

  afterEach(async () => {
    if (sdk.isInitialized()) {
      await sdk.dispose();
    }
  });

  describe("SDK Initialization", () => {
    it("should initialize SDK with default configuration", async () => {
      expect(sdk.isInitialized()).toBe(false);

      await sdk.initialize();

      expect(sdk.isInitialized()).toBe(true);
    });

    it("should initialize SDK with custom configuration", async () => {
      const customSDK = new SignatureProviderSDK({
        defaultProviders: [ProviderType.MOCK, ProviderType.LEDGER],
        enableMetrics: true,
        enableLogging: true,
        autoDiscovery: false,
      });

      await customSDK.initialize();

      expect(customSDK.isInitialized()).toBe(true);

      const config = customSDK.getConfig();
      expect(config.defaultProviders).toEqual([
        ProviderType.MOCK,
        ProviderType.LEDGER,
      ]);
      expect(config.enableMetrics).toBe(true);
      expect(config.enableLogging).toBe(true);

      await customSDK.dispose();
    });

    it("should not reinitialize if already initialized", async () => {
      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);

      // Should not throw or cause issues
      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);
    });

    it("should throw error when using uninitialized SDK", () => {
      expect(() => sdk.getProviders()).toThrow("SDK not initialized");
    });
  });

  describe("Provider Management", () => {
    beforeEach(async () => {
      await sdk.initialize();
    });

    it("should create providers through SDK", async () => {
      const provider = await sdk.createProvider(ProviderType.MOCK);

      expect(provider).toBeInstanceOf(MockSignatureProvider);
      expect(provider.isConnected()).toBe(true);

      const providers = sdk.getProviders();
      expect(providers).toContain(provider);
    });

    it("should get providers for specific chain", async () => {
      await sdk.createProvider(ProviderType.MOCK);
      await sdk.createProvider(ProviderType.LEDGER);

      const stellarProviders = sdk.getProvidersForChain(ChainId.STELLAR);
      expect(stellarProviders.length).toBeGreaterThan(0);

      stellarProviders.forEach((provider) => {
        expect(provider.getCapabilities().supportedChains).toContain(
          ChainId.STELLAR
        );
      });
    });

    it("should get best provider for chain", async () => {
      await sdk.createProvider(ProviderType.MOCK);
      await sdk.createProvider(ProviderType.LEDGER);

      const bestProvider = await sdk.getBestProvider(ChainId.BITCOIN);
      expect(bestProvider).toBeDefined();
      expect(bestProvider.getCapabilities().supportedChains).toContain(
        ChainId.BITCOIN
      );
    });

    it("should batch create providers", async () => {
      const configs = [
        { type: ProviderType.MOCK },
        { type: ProviderType.LEDGER },
        { type: ProviderType.ALBEDO },
      ];

      const result = await sdk.batchCreateProviders(configs);

      expect(result.totalCount).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.successful.length).toBe(3);
      expect(result.duration).toBeGreaterThan(0);
    });

    it("should handle batch creation failures", async () => {
      const configs = [
        { type: ProviderType.MOCK },
        { type: "invalid" as ProviderType },
      ];

      const result = await sdk.batchCreateProviders(configs);

      expect(result.totalCount).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.failed.length).toBe(1);
    });
  });

  describe("Health Checks and Metrics", () => {
    beforeEach(async () => {
      await sdk.initialize();
    });

    it("should perform health checks on providers", async () => {
      const provider = await sdk.createProvider(ProviderType.MOCK);

      const healthChecks = await sdk.performHealthChecks();

      expect(healthChecks.length).toBe(1);
      expect(healthChecks[0].providerId).toBe(provider.providerId);
      expect(healthChecks[0].healthy).toBe(true);
      expect(healthChecks[0].connected).toBe(true);
      expect(healthChecks[0].capabilities).toBeDefined();
    });

    it("should track provider metrics", async () => {
      const provider = await sdk.createProvider(ProviderType.MOCK);

      const metrics = sdk.getProviderMetrics(provider.providerId);

      expect(metrics.length).toBe(1);
      expect(metrics[0].providerId).toBe(provider.providerId);
      expect(metrics[0].connectionCount).toBeDefined();
      expect(metrics[0].signatureCount).toBeDefined();
    });

    it("should get all provider metrics", async () => {
      await sdk.createProvider(ProviderType.MOCK);
      await sdk.createProvider(ProviderType.LEDGER);

      const allMetrics = sdk.getProviderMetrics();

      expect(allMetrics.length).toBe(2);
    });

    it("should get provider health status", async () => {
      const provider = await sdk.createProvider(ProviderType.MOCK);

      const healthStatus = sdk.getProviderHealth(provider.providerId);

      expect(healthStatus.length).toBe(1);
      expect(healthStatus[0].providerId).toBe(provider.providerId);
      expect(healthStatus[0].healthy).toBe(true);
    });
  });

  describe("SDK Context", () => {
    beforeEach(async () => {
      await sdk.initialize();
    });

    it("should provide SDK context for dependency injection", () => {
      const context = sdk.getContext();

      expect(context.registry).toBeDefined();
      expect(context.factory).toBeDefined();
      expect(context.coordinator).toBeDefined();
      expect(context.errorRecovery).toBeDefined();
    });
  });

  describe("Configuration Management", () => {
    it("should get and update configuration", async () => {
      await sdk.initialize();

      const originalConfig = sdk.getConfig();
      expect(originalConfig.enableMetrics).toBe(true);

      sdk.updateConfig({ enableMetrics: false });

      const updatedConfig = sdk.getConfig();
      expect(updatedConfig.enableMetrics).toBe(false);
    });
  });

  describe("SDK Disposal", () => {
    it("should dispose SDK and cleanup resources", async () => {
      await sdk.initialize();
      await sdk.createProvider(ProviderType.MOCK);

      expect(sdk.isInitialized()).toBe(true);
      expect(sdk.getProviders().length).toBe(1);

      await sdk.dispose();

      expect(sdk.isInitialized()).toBe(false);
    });

    it("should handle disposal of uninitialized SDK", async () => {
      expect(sdk.isInitialized()).toBe(false);

      // Should not throw
      await expect(sdk.dispose()).resolves.toBeUndefined();
    });
  });

  describe("Global SDK Instance", () => {
    afterEach(async () => {
      if (signatureProviderSDK.isInitialized()) {
        await signatureProviderSDK.dispose();
      }
    });

    it("should provide global SDK instance", () => {
      expect(signatureProviderSDK).toBeInstanceOf(SignatureProviderSDK);
    });

    it("should work with global instance", async () => {
      await signatureProviderSDK.initialize();

      const provider = await signatureProviderSDK.createProvider(
        ProviderType.MOCK
      );
      expect(provider).toBeDefined();

      const providers = signatureProviderSDK.getProviders();
      expect(providers).toContain(provider);
    });
  });
});

describe("SDK Utils", () => {
  afterEach(async () => {
    if (signatureProviderSDK.isInitialized()) {
      await signatureProviderSDK.dispose();
    }
  });

  describe("Convenience Functions", () => {
    it("should initialize SDK with default configuration", async () => {
      const sdk = await SDKUtils.initializeSDK({
        enableLogging: false,
        autoDiscovery: false,
      });

      expect(sdk.isInitialized()).toBe(true);

      await sdk.dispose();
    });

    it("should quickly create provider", async () => {
      const provider = await SDKUtils.quickCreateProvider(ProviderType.MOCK);

      expect(provider).toBeInstanceOf(MockSignatureProvider);
      expect(signatureProviderSDK.isInitialized()).toBe(true);
    });

    it("should get providers for chain with auto-initialization", async () => {
      // Create a provider first
      await SDKUtils.quickCreateProvider(ProviderType.MOCK);

      const providers = await SDKUtils.getProvidersForChain(ChainId.STELLAR);

      expect(providers.length).toBeGreaterThan(0);
    });

    it("should perform system health check", async () => {
      const healthCheck = await SDKUtils.performSystemHealthCheck();

      expect(healthCheck.sdkInitialized).toBe(false);
      expect(healthCheck.totalProviders).toBe(0);

      // Initialize and add provider
      await SDKUtils.quickCreateProvider(ProviderType.MOCK);

      const healthCheckAfter = await SDKUtils.performSystemHealthCheck();

      expect(healthCheckAfter.sdkInitialized).toBe(true);
      expect(healthCheckAfter.totalProviders).toBe(1);
      expect(healthCheckAfter.healthyProviders).toBe(1);
    });

    it("should get system metrics", async () => {
      const metricsEmpty = SDKUtils.getSystemMetrics();

      expect(metricsEmpty.totalProviders).toBe(0);
      expect(metricsEmpty.totalConnections).toBe(0);

      // Initialize SDK with metrics enabled
      const sdk = await SDKUtils.initializeSDK({ enableMetrics: true });
      await sdk.createProvider(ProviderType.MOCK);

      const metricsWithProvider = SDKUtils.getSystemMetrics();

      expect(metricsWithProvider.totalProviders).toBe(1);

      await sdk.dispose();
    });
  });
});

describe("SDK Builder", () => {
  it("should build SDK with fluent interface", async () => {
    const sdk = await createSDKBuilder()
      .withDefaultProviders([ProviderType.MOCK])
      .withAutoDiscovery(false)
      .withMetrics(true)
      .withLogging(false)
      .withErrorRecovery({
        enabled: true,
        maxRetries: 5,
        retryDelay: 2000,
      })
      .withRegistry({
        autoRegister: true,
        validateProviders: true,
      })
      .build();

    expect(sdk.isInitialized()).toBe(true);

    const config = sdk.getConfig();
    expect(config.defaultProviders).toEqual([ProviderType.MOCK]);
    expect(config.autoDiscovery).toBe(false);
    expect(config.enableMetrics).toBe(true);
    expect(config.enableLogging).toBe(false);
    expect(config.errorRecovery.maxRetries).toBe(5);
    expect(config.errorRecovery.retryDelay).toBe(2000);

    await sdk.dispose();
  });

  it("should create builder instance", () => {
    const builder = createSDKBuilder();
    expect(builder).toBeInstanceOf(SignatureProviderSDKBuilder);
  });
});

describe("Error Handling", () => {
  let sdk: SignatureProviderSDK;

  beforeEach(() => {
    sdk = new SignatureProviderSDK({
      enableLogging: false,
      autoDiscovery: false,
    });
  });

  afterEach(async () => {
    if (sdk.isInitialized()) {
      await sdk.dispose();
    }
  });

  it("should handle initialization errors gracefully", async () => {
    // Mock an initialization error
    const originalInitialize = sdk.initialize;
    sdk.initialize = jest.fn().mockRejectedValue(new Error("Init failed"));

    await expect(sdk.initialize()).rejects.toThrow("Init failed");
    expect(sdk.isInitialized()).toBe(false);

    // Restore original method
    sdk.initialize = originalInitialize;
  });

  it("should handle provider creation errors", async () => {
    await sdk.initialize();

    // Try to create invalid provider type
    await expect(
      sdk.createProvider("invalid" as ProviderType)
    ).rejects.toThrow();
  });

  it("should handle disposal errors gracefully", async () => {
    await sdk.initialize();

    // Mock disposal error
    const originalDispose = (sdk as unknown).factory.dispose;
    (sdk as unknown).factory.dispose = jest
      .fn()
      .mockRejectedValue(new Error("Disposal failed"));

    await expect(sdk.dispose()).rejects.toThrow("Disposal failed");

    // Restore original method
    (sdk as unknown).factory.dispose = originalDispose;
  });
});
