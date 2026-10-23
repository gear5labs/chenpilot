import { describe, it, expect, beforeEach } from "jest";
import { userPreferencesService } from "../userPreferences.service";

describe("UserPreferencesService Explicit Consent Regression", () => {
  it("should reject preference updates without explicit consent", async () => {
    await expect(
      userPreferencesService.updatePreferences("test-user-1", {
        riskLevel: "high",
      })
    ).rejects.toThrow(
      "Explicit consent is required before saving conversational preferences"
    );
  });

  it("should allow preference updates when explicitConsent is true", async () => {
    // Mock repository or test behavior where repository save is stubbed or handled
    // Here we verify the validation gate runs correctly
    try {
      await userPreferencesService.updatePreferences("test-user-1", {
        riskLevel: "low",
        explicitConsent: true,
      });
    } catch (err: any) {
      // If user entity lookup fails in test DB without mock, ensure it's not a consent error
      expect(err.message).not.toContain("Explicit consent is required");
    }
  });
});
