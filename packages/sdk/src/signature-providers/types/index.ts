/**
 * @fileoverview Comprehensive TypeScript type definitions for SignatureProvider system
 * @module SignatureProviders/Types
 */

// Re-export all core types for easy access
export * from "../types";
export * from "../interfaces";
export * from "../errors";
export * from "../error-recovery";
export * from "../registry";
export * from "../utils";
export * from "../mock-provider";
export * from "../ledger-provider";
export * from "../albedo-provider";
export * from "../multi-signature-coordinator";
export * from "../signature-verification";
export * from "../provider-factory";

// Additional type utilities and helpers
import { ChainId } from "../../types";
import { SignatureProvider } from "../interfaces";
import {
  SignatureRequest,
  SignatureResult,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  ChainTransaction,
} from "../types";
import { ProviderType, ProviderConfig } from "../provider-factory";

/**
 * Utility type for extracting provider configuration type
 */
export type ExtractProviderConfig<T extends ProviderType> =
  T extends ProviderType.MOCK
    ? Extract<ProviderConfig, { type: ProviderType.MOCK }>["config"]
    : T extends ProviderType.LEDGER
      ? Extract<ProviderConfig, { type: ProviderType.LEDGER }>["config"]
      : T extends ProviderType.ALBEDO
        ? Extract<ProviderConfig, { type: ProviderType.ALBEDO }>["config"]
        : never;

/**
 * Utility type for provider instance based on type
 */
export type ProviderInstance<T extends ProviderType> =
  T extends ProviderType.MOCK
    ? import("../mock-provider").MockSignatureProvider
    : T extends ProviderType.LEDGER
      ? import("../ledger-provider").LedgerSignatureProvider
      : T extends ProviderType.ALBEDO
        ? import("../albedo-provider").AlbedoSignatureProvider
        : SignatureProvider;

/**
 * Chain-specific transaction types
 */
export type ChainSpecificTransaction<T extends ChainId> =
  T extends ChainId.BITCOIN
    ? import("../types").BitcoinTransaction
    : T extends ChainId.STELLAR
      ? import("../types").StellarTransaction
      : T extends ChainId.STARKNET
        ? import("../types").StarknetTransaction
        : never;

/**
 * Provider capabilities by chain
 */
export type ProviderCapabilitiesByChain = {
  [K in ChainId]: {
    supportedProviders: ProviderType[];
    recommendedProvider: ProviderType;
    capabilities: Partial<SignatureProviderCapabilities>;
  };
};

/**
 * Signature provider event map for type-safe event handling
 */
export interface SignatureProviderEventMap {
  "provider:connected": {
    providerId: string;
    connection: SignatureProviderConnection;
  };
  "provider:disconnected": { providerId: string };
  "provider:error": { providerId: string; error: Error };
  "signature:started": { providerId: string; request: SignatureRequest };
  "signature:completed": { providerId: string; result: SignatureResult };
  "signature:failed": { providerId: string; error: Error };
}

/**
 * Type-safe event handler for signature provider events
 */
export type SignatureProviderEventHandler<
  T extends keyof SignatureProviderEventMap,
> = (event: SignatureProviderEventMap[T]) => void;

/**
 * Provider factory options with type constraints
 */
export interface TypedProviderFactoryOptions<T extends ProviderType> {
  type: T;
  config?: ExtractProviderConfig<T>;
  autoConnect?: boolean;
  autoRegister?: boolean;
  timeout?: number;
}

/**
 * Multi-signature workflow types with enhanced type safety
 */
export interface TypedMultiSignatureWorkflow<T extends ChainId> {
  chainId: T;
  transaction: ChainSpecificTransaction<T>;
  signers: Array<{
    providerId: string;
    accountAddress: string;
    publicKey?: string;
    required: boolean;
    weight?: number;
  }>;
  config: {
    requiredSignatures: number;
    totalSigners: number;
    allowPartialSigning?: boolean;
    requireSequentialSigning?: boolean;
  };
}

/**
 * Signature verification request with chain-specific typing
 */
export interface TypedSignatureVerificationRequest<T extends ChainId> {
  signature: string;
  publicKey: string;
  chainId: T;
  message?: string;
  transactionData?: {
    chainId: T;
    transaction: ChainSpecificTransaction<T>;
  };
}

/**
 * Provider registry query options
 */
export interface ProviderRegistryQuery {
  chainId?: ChainId;
  connected?: boolean;
  capabilities?: Partial<SignatureProviderCapabilities>;
  metadata?: Record<string, unknown>;
}

/**
 * Provider selection criteria
 */
export interface ProviderSelectionCriteria {
  chainId: ChainId;
  preferHardwareWallet?: boolean;
  preferBrowserExtension?: boolean;
  requiresUserInteraction?: boolean;
  minConcurrentSignatures?: number;
  requiredCapabilities?: string[];
}

/**
 * Signature provider context for dependency injection
 */
export interface SignatureProviderContext {
  registry: import("../registry").SignatureProviderRegistry;
  factory: import("../provider-factory").SignatureProviderFactory;
  coordinator: import("../multi-signature-coordinator").MultiSignatureCoordinator;
  errorRecovery: import("../error-recovery").SignatureProviderErrorRecovery;
}

/**
 * Provider health check result
 */
export interface ProviderHealthCheck {
  providerId: string;
  healthy: boolean;
  connected: boolean;
  lastChecked: Date;
  capabilities: SignatureProviderCapabilities;
  errors?: Error[];
  metadata?: Record<string, unknown>;
}

/**
 * Batch operation result
 */
export interface BatchOperationResult<T> {
  successful: T[];
  failed: Array<{ error: Error; input?: unknown }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
  duration: number;
}

/**
 * Provider metrics for monitoring
 */
export interface ProviderMetrics {
  providerId: string;
  connectionCount: number;
  signatureCount: number;
  errorCount: number;
  averageSigningTime: number;
  lastActivity: Date;
  uptime: number;
}

/**
 * SDK configuration for signature providers
 */
export interface SignatureProviderSDKConfig {
  defaultProviders?: ProviderType[];
  autoDiscovery?: boolean;
  enableMetrics?: boolean;
  enableLogging?: boolean;
  errorRecovery?: {
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;
  };
  registry?: {
    autoRegister: boolean;
    validateProviders: boolean;
  };
}

/**
 * Type guards for runtime type checking
 */
export namespace TypeGuards {
  export function isSignatureProvider(obj: unknown): obj is SignatureProvider {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "providerId" in obj &&
      "connect" in obj &&
      "disconnect" in obj &&
      "signTransaction" in obj &&
      "getCapabilities" in obj
    );
  }

  export function isSignatureResult(obj: unknown): obj is SignatureResult {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "signature" in obj &&
      "publicKey" in obj &&
      typeof (obj as SignatureResult).signature === "string" &&
      typeof (obj as SignatureResult).publicKey === "string"
    );
  }

  export function isChainTransaction(obj: unknown): obj is ChainTransaction {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "chainId" in obj &&
      "transaction" in obj &&
      Object.values(ChainId).includes((obj as ChainTransaction).chainId)
    );
  }

  export function isProviderCapabilities(
    obj: unknown
  ): obj is SignatureProviderCapabilities {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "supportedChains" in obj &&
      "supportsMultipleAccounts" in obj &&
      "requiresUserInteraction" in obj &&
      "supportsMessageSigning" in obj &&
      "maxConcurrentSignatures" in obj &&
      Array.isArray((obj as SignatureProviderCapabilities).supportedChains)
    );
  }
}

/**
 * Branded types for enhanced type safety
 */
export type ProviderId = string & { readonly __brand: "ProviderId" };
export type TransactionId = string & { readonly __brand: "TransactionId" };
export type SignatureHash = string & { readonly __brand: "SignatureHash" };
export type PublicKeyHash = string & { readonly __brand: "PublicKeyHash" };

/**
 * Helper functions for creating branded types
 */
export namespace BrandedTypes {
  export function createProviderId(id: string): ProviderId {
    return id as ProviderId;
  }

  export function createTransactionId(id: string): TransactionId {
    return id as TransactionId;
  }

  export function createSignatureHash(hash: string): SignatureHash {
    return hash as SignatureHash;
  }

  export function createPublicKeyHash(hash: string): PublicKeyHash {
    return hash as PublicKeyHash;
  }
}

/**
 * Conditional types for provider-specific operations
 */
export type ProviderSpecificOperation<
  T extends ProviderType,
  TChain extends ChainId,
> = T extends ProviderType.ALBEDO
  ? TChain extends ChainId.STELLAR
    ? "pay" | "trust" | "exchange"
    : never
  : T extends ProviderType.LEDGER
    ? "getDeviceInfo" | "isAppOpen"
    : "signMessage";

/**
 * Provider compatibility matrix
 */
export type ProviderCompatibilityMatrix = {
  [P in ProviderType]: {
    [C in ChainId]: boolean;
  };
};

/**
 * Default provider compatibility
 */
export const DEFAULT_PROVIDER_COMPATIBILITY: ProviderCompatibilityMatrix = {
  [ProviderType.MOCK]: {
    [ChainId.BITCOIN]: true,
    [ChainId.STELLAR]: true,
    [ChainId.STARKNET]: true,
  },
  [ProviderType.LEDGER]: {
    [ChainId.BITCOIN]: true,
    [ChainId.STELLAR]: true,
    [ChainId.STARKNET]: true,
  },
  [ProviderType.ALBEDO]: {
    [ChainId.BITCOIN]: false,
    [ChainId.STELLAR]: true,
    [ChainId.STARKNET]: false,
  },
};

/**
 * Provider feature matrix
 */
export interface ProviderFeatureMatrix {
  messageSignature: boolean;
  multipleAccounts: boolean;
  hardwareWallet: boolean;
  browserExtension: boolean;
  userInteractionRequired: boolean;
  concurrentSignatures: number;
}

/**
 * Default provider features
 */
export const DEFAULT_PROVIDER_FEATURES: Record<
  ProviderType,
  ProviderFeatureMatrix
> = {
  [ProviderType.MOCK]: {
    messageSignature: true,
    multipleAccounts: true,
    hardwareWallet: false,
    browserExtension: false,
    userInteractionRequired: false,
    concurrentSignatures: 10,
  },
  [ProviderType.LEDGER]: {
    messageSignature: false,
    multipleAccounts: true,
    hardwareWallet: true,
    browserExtension: false,
    userInteractionRequired: true,
    concurrentSignatures: 1,
  },
  [ProviderType.ALBEDO]: {
    messageSignature: true,
    multipleAccounts: false,
    hardwareWallet: false,
    browserExtension: true,
    userInteractionRequired: true,
    concurrentSignatures: 1,
  },
};

/**
 * Export all types for external consumption
 */
export type {
  // Core interfaces
  SignatureProvider,
  BaseSignatureProvider,

  // Core types
  SignatureRequest,
  SignatureResult,
  SignatureProviderAccount,
  SignatureProviderConnection,
  SignatureProviderCapabilities,
  SignatureProviderMetadata,
  ChainTransaction,

  // Provider types
  ProviderType,
  ProviderConfig,

  // Multi-signature types
  SignerInfo,
  MultiSignatureConfig,
  MultiSignatureWorkflowResult,

  // Verification types
  SignatureVerificationRequest,
  SignatureVerificationResult,
  MultiSignatureVerificationResult,

  // Error types
  SignatureProviderError,

  // Registry types
  SignatureProviderRegistry,

  // Factory types
  SignatureProviderFactory,
  ProviderDiscoveryResult,
  ProviderInitializationOptions,
} from "../index";
