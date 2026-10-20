import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { userPreferencesService } from "../userPreferences.service";
import { AppDataSource } from "../../config/Datasource";
import { UserPreferences } from "../userPreferences.entity";
import { UserPreferenceProvenance } from "../userPreferenceProvenance.entity";
import { User } from "../user.entity";

jest.mock("../../config/Datasource", () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

describe("UserPreferencesService Provenance", () => {
  let mockPrefRepo: any;
  let mockProvRepo: any;
  let mockUserRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrefRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: "pref-1", ...data })),
    };

    mockProvRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: "prov-1", ...data })),
    };

    mockUserRepo = {
      findOne: jest.fn(async () => ({ id: "user-1" })),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === UserPreferences) return mockPrefRepo;
      if (entity === UserPreferenceProvenance) return mockProvRepo;
      if (entity === User) return mockUserRepo;
      return null;
    });
  });

  it("should record provenance when financial preferences are updated", async () => {
    const existingPrefs = {
      userId: "user-1",
      riskLevel: "medium",
      preferredAssets: "XLM,STRK",
      autoApproveSmallTransactions: false,
      smallTransactionThreshold: 10,
      defaultSlippage: "0.5",
    };

    mockPrefRepo.findOne.mockResolvedValueOnce(existingPrefs);

    const updated = await userPreferencesService.updatePreferences("user-1", {
      riskLevel: "high",
      changedBy: "admin-1",
      reason: "Risk tolerance reassessment",
    });

    expect(updated.riskLevel).toBe("high");
    expect(mockProvRepo.create).toHaveBeenCalledTimes(1);
    expect(mockProvRepo.save).toHaveBeenCalledTimes(1);

    const savedProvenance = mockProvRepo.save.mock.calls[0][0];
    expect(savedProvenance.userId).toBe("user-1");
    expect(savedProvenance.changedBy).toBe("admin-1");
    expect(savedProvenance.reason).toBe("Risk tolerance reassessment");
    
    const parsedChanges = JSON.parse(savedProvenance.changes);
    expect(parsedChanges.previous.riskLevel).toBe("medium");
    expect(parsedChanges.updated.riskLevel).toBe("high");
  });

  it("should not record provenance if no financial fields changed", async () => {
    const existingPrefs = {
      userId: "user-1",
      riskLevel: "medium",
      preferredAssets: "XLM,STRK",
      autoApproveSmallTransactions: false,
      smallTransactionThreshold: 10,
      defaultSlippage: "0.5",
      notificationSettings: "email",
    };

    mockPrefRepo.findOne.mockResolvedValueOnce(existingPrefs);

    await userPreferencesService.updatePreferences("user-1", {
      notificationSettings: "push",
      changedBy: "user-1",
    });

    expect(mockProvRepo.save).not.toHaveBeenCalled();
  });
});
