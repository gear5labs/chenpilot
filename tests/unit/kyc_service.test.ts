import { KycProviderFactory } from "../../src/services/kyc/KycProviderFactory";
import { KycService } from "../../src/services/kyc/KycService";
import { MockKycProvider } from "../../src/services/kyc/providers/mockKycProvider";
import {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from "../../src/services/kyc/types";

describe("KycProviderFactory", () => {
  it("returns default provider when no provider name is specified", () => {
    const factory = new KycProviderFactory("mock");
    const provider = new MockKycProvider();

    factory.register(provider);

    expect(factory.getProvider()).toBe(provider);
  });

  it("throws when provider is not registered", () => {
    const factory = new KycProviderFactory("unknown");

    expect(() => factory.getProvider()).toThrow(
      "KYC provider 'unknown' is not registered"
    );
  });

  it("can switch default provider", () => {
    const factory = new KycProviderFactory("mock");

    const mock = new MockKycProvider();
    const stub: KycProvider = {
      name: "stub",
      createVerification: jest.fn(),
      getVerificationStatus: jest.fn(),
      healthCheck: jest.fn(),
    };

    factory.register(mock);
    factory.register(stub);

    factory.setDefaultProvider("stub");

    expect(factory.getProvider()).toBe(stub);
    expect(factory.getRegisteredProviders().sort()).toEqual(["mock", "stub"]);
  });
});

describe("KycService", () => {
  const baseRequest: KycVerificationRequest = {
    person: {
      userId: "user-123",
      fullName: "Jane Doe",
      email: "jane@example.com",
      countryCode: "US",
    },
    documents: [
      {
        type: "passport",
        documentId: "passport-1",
      },
    ],
    metadata: {
      flow: "onboarding",
    },
  };

  it("submits verification through selected provider", async () => {
    const factory = new KycProviderFactory("mock");
    factory.register(new MockKycProvider());

    const service = new KycService(factory);
    const result = await service.submitVerification(baseRequest);

    expect(result.provider).toBe("mock");
    expect(result.providerReferenceId).toContain("kyc_user-123_");
    expect(result.status).toBe("pending");
  });

  it("retrieves verification status by provider reference id", async () => {
    const factory = new KycProviderFactory("mock");
    factory.register(new MockKycProvider());

    const service = new KycService(factory);
    const created = await service.submitVerification(baseRequest);
    const status = await service.getVerificationStatus(created.providerReferenceId);

    expect(status).not.toBeNull();
    expect(status?.providerReferenceId).toBe(created.providerReferenceId);
    expect(status?.status).toBe("pending");
  });

  it("supports provider-driven rejection outcomes", async () => {
    const factory = new KycProviderFactory("mock");
    factory.register(new MockKycProvider());

    const service = new KycService(factory);
    const rejectedRequest: KycVerificationRequest = {
      ...baseRequest,
      person: {
        ...baseRequest.person,
        fullName: "Reject Candidate",
      },
    };

    const result = await service.submitVerification(rejectedRequest);

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Mock provider");
  });

  it("delegates health checks to provider", async () => {
    const healthyProvider: KycProvider = {
      name: "healthy",
      createVerification: jest
        .fn<Promise<KycVerificationResult>, [KycVerificationRequest]>()
        .mockResolvedValue({
          provider: "healthy",
          providerReferenceId: "ref-1",
          status: "approved",
        }),
      getVerificationStatus: jest
        .fn<Promise<KycVerificationResult | null>, [string]>()
        .mockResolvedValue(null),
      healthCheck: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
    };

    const factory = new KycProviderFactory("healthy");
    factory.register(healthyProvider);

    const service = new KycService(factory);
    const result = await service.healthCheck();

    expect(result).toBe(true);
    expect(healthyProvider.healthCheck).toHaveBeenCalledTimes(1);
  });
});
