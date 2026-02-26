import {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from "../types";

export class MockKycProvider implements KycProvider {
  readonly name = "mock";
  private records = new Map<string, KycVerificationResult>();

  async createVerification(
    request: KycVerificationRequest
  ): Promise<KycVerificationResult> {
    const providerReferenceId =
      request.referenceId ||
      `kyc_${request.person.userId}_${Date.now().toString(36)}`;

    const fullName = request.person.fullName.toLowerCase();
    const status = fullName.includes("reject") ? "rejected" : "pending";

    const result: KycVerificationResult = {
      provider: this.name,
      providerReferenceId,
      status,
      reason:
        status === "rejected"
          ? "Mock provider triggered rejection based on profile data"
          : undefined,
      reviewedAt: status === "rejected" ? new Date().toISOString() : undefined,
      metadata: request.metadata,
    };

    this.records.set(providerReferenceId, result);
    return result;
  }

  async getVerificationStatus(
    providerReferenceId: string
  ): Promise<KycVerificationResult | null> {
    return this.records.get(providerReferenceId) || null;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
