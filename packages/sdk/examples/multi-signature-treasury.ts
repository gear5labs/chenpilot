/**
 * @fileoverview Treasury Multi-Signature Example
 *
 * This example demonstrates how to implement a treasury management system
 * that requires multiple signatures for large payments using different
 * provider types (hardware wallets, browser extensions, etc.)
 */

import {
  SignatureProviderSDK,
  MultiSignatureCoordinator,
  ProviderType,
  ChainId,
  SignerInfo,
  MultiSignatureConfig,
  MultiSignatureEventType,
  MockSignatureProvider,
  LedgerSignatureProvider,
  AlbedoSignatureProvider,
} from "../src";

/**
 * Treasury configuration
 */
interface TreasuryConfig {
  requiredSignatures: number;
  totalSigners: number;
  largePaymentThreshold: string;
  emergencySigners: string[];
}

/**
 * Treasury signer role
 */
enum SignerRole {
  ADMIN = "admin",
  FINANCE = "finance",
  OPERATIONS = "operations",
  EMERGENCY = "emergency",
}

/**
 * Treasury payment request
 */
interface PaymentRequest {
  destination: string;
  amount: string;
  asset?: string;
  memo?: string;
  category: "operational" | "emergency" | "investment";
  requestedBy: string;
  approvedBy: string[];
}

/**
 * Treasury management system with multi-signature support
 */
class TreasuryManager {
  private sdk: SignatureProviderSDK;
  private coordinator: MultiSignatureCoordinator;
  private config: TreasuryConfig;
  private signers: Map<string, { info: SignerInfo; role: SignerRole }> =
    new Map();

  constructor(config: TreasuryConfig) {
    this.config = config;
    this.sdk = new SignatureProviderSDK({
      enableMetrics: true,
      enableLogging: true,
    });
    this.coordinator = new MultiSignatureCoordinator();
  }

  /**
   * Initialize the treasury system
   */
  async initialize(): Promise<void> {
    console.log("🏛️  Initializing Treasury Management System...");

    await this.sdk.initialize();

    // Setup event listeners for audit trail
    this.coordinator.addEventListener((event) => {
      this.logTreasuryEvent(event);
    });

    console.log("✅ Treasury system initialized");
  }

  /**
   * Add a signer to the treasury
   */
  async addSigner(
    providerId: string,
    providerType: ProviderType,
    role: SignerRole,
    required: boolean = true
  ): Promise<void> {
    console.log(`👤 Adding ${role} signer: ${providerId}`);

    // Create provider based on type
    let provider;
    switch (providerType) {
      case ProviderType.MOCK:
        provider = new MockSignatureProvider(providerId, undefined, {
          enableLogging: true,
        });
        break;
      case ProviderType.LEDGER:
        provider = new LedgerSignatureProvider({
          enableDebugLogging: true,
        });
        break;
      case ProviderType.ALBEDO:
        provider = new AlbedoSignatureProvider({
          enableDebugLogging: true,
        });
        break;
      default:
        throw new Error(`Unsupported provider type: ${providerType}`);
    }

    // Connect and register
    await provider.connect();
    this.coordinator.registerProvider(provider);

    // Get account for Stellar (treasury operates on Stellar)
    const accounts = await provider.getAccounts(ChainId.STELLAR);
    if (accounts.length === 0) {
      throw new Error(`No accounts available for provider ${providerId}`);
    }

    // Store signer information
    const signerInfo: SignerInfo = {
      providerId,
      accountAddress: accounts[0].address,
      publicKey: accounts[0].publicKey,
      required,
      metadata: {
        role,
        addedAt: new Date().toISOString(),
        providerType,
      },
    };

    this.signers.set(providerId, { info: signerInfo, role });
    console.log(`✅ Added ${role} signer: ${accounts[0].address}`);
  }

  /**
   * Process a payment request
   */
  async processPayment(request: PaymentRequest): Promise<{
    approved: boolean;
    transactionHash?: string;
    signatures: unknown[];
    auditTrail: string[];
  }> {
    console.log(
      `💰 Processing payment request: ${request.amount} to ${request.destination}`
    );

    const auditTrail: string[] = [];
    auditTrail.push(
      `Payment requested: ${request.amount} to ${request.destination}`
    );
    auditTrail.push(
      `Category: ${request.category}, Requested by: ${request.requestedBy}`
    );

    // Determine required signers based on payment category and amount
    const requiredSigners = this.determineRequiredSigners(request);
    auditTrail.push(`Required signers: ${requiredSigners.length}`);

    // Create multi-signature configuration
    const config: MultiSignatureConfig = {
      requiredSignatures: this.getRequiredSignatureCount(request),
      totalSigners: requiredSigners.length,
      allowPartialSigning: false, // Treasury requires all required signatures
      continueOnError: true,
      timeout: 300000, // 5 minutes for treasury operations
      description: `Treasury payment: ${request.amount} to ${request.destination}`,
    };

    // Create transaction
    const transaction = {
      sourceAccount: requiredSigners[0].accountAddress, // Treasury account
      fee: "100",
      sequenceNumber: "1", // In real implementation, get from network
      operations: [
        {
          type: "payment",
          destination: request.destination,
          asset: request.asset || "native",
          amount: request.amount,
        },
      ],
      memo: request.memo
        ? {
            type: "text",
            value: request.memo,
          }
        : undefined,
    };

    try {
      // Execute multi-signature workflow
      const workflowResult = await this.coordinator.startWorkflow(
        { chainId: ChainId.STELLAR, transaction },
        requiredSigners,
        config
      );

      auditTrail.push(`Workflow status: ${workflowResult.status}`);
      auditTrail.push(
        `Signatures collected: ${workflowResult.signatures.length}`
      );

      if (workflowResult.status === "completed" && workflowResult.requiredMet) {
        auditTrail.push("✅ Payment approved and executed");

        return {
          approved: true,
          transactionHash:
            (workflowResult.finalTransaction as { hash?: string })?.hash ||
            "mock-tx-hash",
          signatures: workflowResult.signatures,
          auditTrail,
        };
      } else {
        auditTrail.push("❌ Payment rejected - insufficient signatures");

        return {
          approved: false,
          signatures: workflowResult.signatures,
          auditTrail,
        };
      }
    } catch (error) {
      auditTrail.push(
        `❌ Payment failed: ${error instanceof Error ? error.message : error}`
      );

      return {
        approved: false,
        signatures: [],
        auditTrail,
      };
    }
  }

  /**
   * Get treasury status and metrics
   */
  getTreasuryStatus(): {
    totalSigners: number;
    activeSigners: number;
    signersByRole: Record<SignerRole, number>;
    healthStatus: string;
  } {
    const signersByRole = {
      [SignerRole.ADMIN]: 0,
      [SignerRole.FINANCE]: 0,
      [SignerRole.OPERATIONS]: 0,
      [SignerRole.EMERGENCY]: 0,
    };

    let activeSigners = 0;

    for (const { info, role } of this.signers.values()) {
      signersByRole[role]++;

      // Check if provider is connected (simplified check)
      try {
        const provider = this.coordinator.getProvider(info.providerId);
        if (provider?.isConnected()) {
          activeSigners++;
        }
      } catch {
        // Provider not found or not connected
      }
    }

    const healthStatus =
      activeSigners >= this.config.requiredSignatures ? "healthy" : "degraded";

    return {
      totalSigners: this.signers.size,
      activeSigners,
      signersByRole,
      healthStatus,
    };
  }

  /**
   * Emergency payment with reduced signature requirements
   */
  async processEmergencyPayment(request: PaymentRequest): Promise<unknown> {
    console.log("🚨 Processing EMERGENCY payment");

    // Emergency payments require only emergency signers
    const emergencySigners = Array.from(this.signers.values())
      .filter(
        ({ role }) => role === SignerRole.EMERGENCY || role === SignerRole.ADMIN
      )
      .map(({ info }) => info);

    if (emergencySigners.length === 0) {
      throw new Error("No emergency signers available");
    }

    const config: MultiSignatureConfig = {
      requiredSignatures: Math.min(2, emergencySigners.length), // Reduced requirement
      totalSigners: emergencySigners.length,
      allowPartialSigning: true,
      continueOnError: true,
      timeout: 120000, // 2 minutes for emergency
      description: `EMERGENCY payment: ${request.amount}`,
    };

    // Process with emergency configuration
    return this.processPaymentWithSigners(request, emergencySigners, config);
  }

  /**
   * Cleanup treasury resources
   */
  async dispose(): Promise<void> {
    console.log("🧹 Disposing treasury resources...");
    await this.sdk.dispose();
    console.log("✅ Treasury disposed");
  }

  private determineRequiredSigners(request: PaymentRequest): SignerInfo[] {
    const amount = parseFloat(request.amount);
    const threshold = parseFloat(this.config.largePaymentThreshold);

    let requiredSigners: SignerInfo[] = [];

    if (request.category === "emergency") {
      // Emergency payments require emergency signers
      requiredSigners = Array.from(this.signers.values())
        .filter(
          ({ role }) =>
            role === SignerRole.EMERGENCY || role === SignerRole.ADMIN
        )
        .map(({ info }) => info);
    } else if (amount >= threshold) {
      // Large payments require admin + finance approval
      requiredSigners = Array.from(this.signers.values())
        .filter(
          ({ role }) => role === SignerRole.ADMIN || role === SignerRole.FINANCE
        )
        .map(({ info }) => info);
    } else {
      // Regular payments require any authorized signers
      requiredSigners = Array.from(this.signers.values())
        .filter(({ role }) => role !== SignerRole.EMERGENCY)
        .map(({ info }) => info);
    }

    return requiredSigners.slice(0, this.config.totalSigners);
  }

  private getRequiredSignatureCount(request: PaymentRequest): number {
    const amount = parseFloat(request.amount);
    const threshold = parseFloat(this.config.largePaymentThreshold);

    if (request.category === "emergency") {
      return 2; // Emergency requires 2 signatures
    } else if (amount >= threshold) {
      return Math.min(3, this.config.requiredSignatures); // Large payments require more signatures
    } else {
      return this.config.requiredSignatures;
    }
  }

  private async processPaymentWithSigners(
    request: PaymentRequest,
    signers: SignerInfo[],
    config: MultiSignatureConfig
  ): Promise<unknown> {
    const transaction = {
      sourceAccount: signers[0].accountAddress,
      fee: "100",
      sequenceNumber: "1",
      operations: [
        {
          type: "payment",
          destination: request.destination,
          asset: request.asset || "native",
          amount: request.amount,
        },
      ],
      memo: request.memo ? { type: "text", value: request.memo } : undefined,
    };

    return this.coordinator.startWorkflow(
      { chainId: ChainId.STELLAR, transaction },
      signers,
      config
    );
  }

  private logTreasuryEvent(event: {
    type: string;
    workflowId?: string;
    providerId?: string;
  }): void {
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case MultiSignatureEventType.WORKFLOW_STARTED:
        console.log(
          `📋 [${timestamp}] Treasury workflow started: ${event.workflowId}`
        );
        break;
      case MultiSignatureEventType.SIGNATURE_STARTED:
        console.log(
          `✍️  [${timestamp}] Signature requested from: ${event.providerId}`
        );
        break;
      case MultiSignatureEventType.SIGNATURE_COMPLETED:
        console.log(
          `✅ [${timestamp}] Signature completed by: ${event.providerId}`
        );
        break;
      case MultiSignatureEventType.SIGNATURE_FAILED:
        console.log(
          `❌ [${timestamp}] Signature failed for: ${event.providerId}`
        );
        break;
      case MultiSignatureEventType.WORKFLOW_COMPLETED:
        console.log(
          `🎉 [${timestamp}] Treasury workflow completed: ${event.workflowId}`
        );
        break;
      default:
        console.log(`📝 [${timestamp}] Treasury event: ${event.type}`);
    }
  }
}

/**
 * Example usage of the Treasury Management System
 */
async function treasuryExample() {
  console.log("=== Treasury Management System Example ===\n");

  // Initialize treasury with 3-of-5 signature requirement
  const treasuryConfig: TreasuryConfig = {
    requiredSignatures: 3,
    totalSigners: 5,
    largePaymentThreshold: "1000", // Payments over 1000 XLM require additional approval
    emergencySigners: ["emergency-1", "emergency-2"],
  };

  const treasury = new TreasuryManager(treasuryConfig);
  await treasury.initialize();

  try {
    // Add treasury signers with different roles
    await treasury.addSigner(
      "ceo-ledger",
      ProviderType.MOCK,
      SignerRole.ADMIN,
      true
    );
    await treasury.addSigner(
      "cfo-ledger",
      ProviderType.MOCK,
      SignerRole.FINANCE,
      true
    );
    await treasury.addSigner(
      "finance-manager",
      ProviderType.MOCK,
      SignerRole.FINANCE,
      true
    );
    await treasury.addSigner(
      "ops-manager",
      ProviderType.MOCK,
      SignerRole.OPERATIONS,
      false
    );
    await treasury.addSigner(
      "emergency-key",
      ProviderType.MOCK,
      SignerRole.EMERGENCY,
      false
    );

    console.log("\n📊 Treasury Status:");
    const status = treasury.getTreasuryStatus();
    console.log(`Total Signers: ${status.totalSigners}`);
    console.log(`Active Signers: ${status.activeSigners}`);
    console.log(`Health Status: ${status.healthStatus}`);
    console.log("Signers by Role:", status.signersByRole);

    // Process a regular payment
    console.log("\n💰 Processing Regular Payment...");
    const regularPayment: PaymentRequest = {
      destination: "GVENDOR123EXAMPLE",
      amount: "500",
      memo: "Monthly vendor payment - Invoice #12345",
      category: "operational",
      requestedBy: "finance-manager",
      approvedBy: ["cfo-ledger"],
    };

    const regularResult = await treasury.processPayment(regularPayment);
    console.log(
      "Regular Payment Result:",
      regularResult.approved ? "✅ Approved" : "❌ Rejected"
    );
    console.log("Audit Trail:");
    regularResult.auditTrail.forEach((entry) => console.log(`  - ${entry}`));

    // Process a large payment
    console.log("\n💎 Processing Large Payment...");
    const largePayment: PaymentRequest = {
      destination: "GINVESTMENT456EXAMPLE",
      amount: "5000",
      memo: "Strategic investment - Q4 2024",
      category: "investment",
      requestedBy: "ceo-ledger",
      approvedBy: ["cfo-ledger", "ceo-ledger"],
    };

    const largeResult = await treasury.processPayment(largePayment);
    console.log(
      "Large Payment Result:",
      largeResult.approved ? "✅ Approved" : "❌ Rejected"
    );
    console.log("Audit Trail:");
    largeResult.auditTrail.forEach((entry) => console.log(`  - ${entry}`));

    // Process an emergency payment
    console.log("\n🚨 Processing Emergency Payment...");
    const emergencyPayment: PaymentRequest = {
      destination: "GEMERGENCY789EXAMPLE",
      amount: "2000",
      memo: "Emergency security incident response",
      category: "emergency",
      requestedBy: "emergency-key",
      approvedBy: [],
    };

    const emergencyResult =
      await treasury.processEmergencyPayment(emergencyPayment);
    console.log(
      "Emergency Payment Result:",
      emergencyResult.status === "completed" ? "✅ Approved" : "❌ Rejected"
    );
  } catch (error) {
    console.error("Treasury operation failed:", error);
  } finally {
    await treasury.dispose();
  }
}

// Run the example
if (require.main === module) {
  treasuryExample().catch(console.error);
}

export {
  TreasuryManager,
  treasuryExample,
  TreasuryConfig,
  PaymentRequest,
  SignerRole,
};
