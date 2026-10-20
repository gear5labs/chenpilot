import { AppDataSource } from "../config/Datasource";
import { UserPreferences, RiskLevel } from "./userPreferences.entity";
import { UserPreferenceProvenance } from "./userPreferenceProvenance.entity";
import { User } from "./user.entity";
import logger from "../config/logger";

export interface UpdatePreferencesDTO {
  riskLevel?: RiskLevel;
  preferredAssets?: string;
  autoApproveSmallTransactions?: boolean;
  smallTransactionThreshold?: number;
  notificationSettings?: string;
  defaultSlippage?: string;
  changedBy?: string;
  reason?: string;
}

class UserPreferencesService {
  private repository = AppDataSource.getRepository(UserPreferences);
  private provenanceRepository = AppDataSource.getRepository(UserPreferenceProvenance);
  private userRepository = AppDataSource.getRepository(User);

  /**
   * Get user preferences by user ID
   * Creates default preferences if they don't exist
   */
  async getPreferences(userId: string): Promise<UserPreferences> {
    let preferences = await this.repository.findOne({
      where: { userId },
    });

    if (!preferences) {
      logger.info("Creating default preferences for user", { userId });
      preferences = await this.createDefaultPreferences(userId);
    }

    return preferences;
  }

  /**
   * Get preferences as a plain object for agent context
   */
  async getPreferencesForAgent(userId: string): Promise<{
    riskLevel: RiskLevel;
    preferredAssets: string[];
    autoApproveSmallTransactions: boolean;
    smallTransactionThreshold: number;
    defaultSlippage: number | null;
  }> {
    const prefs = await this.getPreferences(userId);

    return {
      riskLevel: prefs.riskLevel,
      preferredAssets: prefs.preferredAssets.split(","),
      autoApproveSmallTransactions: prefs.autoApproveSmallTransactions,
      smallTransactionThreshold: Number(prefs.smallTransactionThreshold),
      defaultSlippage: prefs.defaultSlippage
        ? parseFloat(prefs.defaultSlippage)
        : null,
    };
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    updates: UpdatePreferencesDTO
  ): Promise<UserPreferences> {
    const preferences = await this.getPreferences(userId);

    const previousValues: Record<string, unknown> = {
      riskLevel: preferences.riskLevel,
      preferredAssets: preferences.preferredAssets,
      autoApproveSmallTransactions: preferences.autoApproveSmallTransactions,
      smallTransactionThreshold: preferences.smallTransactionThreshold,
      notificationSettings: preferences.notificationSettings,
      defaultSlippage: preferences.defaultSlippage,
    };

    let hasFinancialChanges = false;

    if (updates.riskLevel !== undefined && updates.riskLevel !== preferences.riskLevel) {
      preferences.riskLevel = updates.riskLevel;
      hasFinancialChanges = true;
    }
    if (updates.preferredAssets !== undefined && updates.preferredAssets !== preferences.preferredAssets) {
      preferences.preferredAssets = updates.preferredAssets;
      hasFinancialChanges = true;
    }
    if (updates.autoApproveSmallTransactions !== undefined && updates.autoApproveSmallTransactions !== preferences.autoApproveSmallTransactions) {
      preferences.autoApproveSmallTransactions = updates.autoApproveSmallTransactions;
      hasFinancialChanges = true;
    }
    if (updates.smallTransactionThreshold !== undefined && updates.smallTransactionThreshold !== preferences.smallTransactionThreshold) {
      preferences.smallTransactionThreshold = updates.smallTransactionThreshold;
      hasFinancialChanges = true;
    }
    if (updates.notificationSettings !== undefined) {
      preferences.notificationSettings = updates.notificationSettings;
    }
    if (updates.defaultSlippage !== undefined && updates.defaultSlippage !== preferences.defaultSlippage) {
      preferences.defaultSlippage = updates.defaultSlippage;
      hasFinancialChanges = true;
    }

    const saved = await this.repository.save(preferences);

    if (hasFinancialChanges) {
      try {
        const provenance = this.provenanceRepository.create({
          userId,
          changedBy: updates.changedBy || userId,
          changes: JSON.stringify({
            previous: previousValues,
            updated: {
              riskLevel: saved.riskLevel,
              preferredAssets: saved.preferredAssets,
              autoApproveSmallTransactions: saved.autoApproveSmallTransactions,
              smallTransactionThreshold: saved.smallTransactionThreshold,
              defaultSlippage: saved.defaultSlippage,
            },
          }),
          reason: updates.reason,
        });
        await this.provenanceRepository.save(provenance);
        logger.info("User preference financial provenance recorded", { userId, changedBy: updates.changedBy || userId });
      } catch (provenanceError) {
        logger.error("Failed to record preference provenance", { userId, error: provenanceError });
      }
    }

    logger.info("User preferences updated", { userId, updates });
    return saved;
  }

  /**
   * Create default preferences for a new user
   */
  private async createDefaultPreferences(
    userId: string
  ): Promise<UserPreferences> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const preferences = this.repository.create({
      userId,
      riskLevel: "medium",
      preferredAssets: "XLM,STRK",
      autoApproveSmallTransactions: false,
      smallTransactionThreshold: 10,
      defaultSlippage: "0.5",
    });

    return this.repository.save(preferences);
  }

  /**
   * Check if a transaction meets user's risk tolerance
   */
  async checkRiskTolerance(
    userId: string,
    estimatedRisk: "low" | "medium" | "high"
  ): Promise<{ allowed: boolean; reason?: string }> {
    const prefs = await this.getPreferences(userId);

    const riskOrder: RiskLevel[] = ["low", "medium", "high"];
    const userRiskIndex = riskOrder.indexOf(prefs.riskLevel);
    const transactionRiskIndex = riskOrder.indexOf(estimatedRisk);

    if (transactionRiskIndex > userRiskIndex) {
      return {
        allowed: false,
        reason: `Transaction risk level (${estimatedRisk}) exceeds user's risk tolerance (${prefs.riskLevel})`,
      };
    }

    return { allowed: true };
  }
}

export const userPreferencesService = new UserPreferencesService();
