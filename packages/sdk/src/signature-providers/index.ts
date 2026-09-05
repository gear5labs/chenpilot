// Core SignatureProvider exports
export * from "./types";
export * from "./interfaces";
export * from "./errors";
export * from "./error-recovery";
export * from "./registry";
export * from "./utils";
export * from "./mock-provider";
export * from "./ledger-provider";
export * from "./albedo-provider";
export * from "./multi-signature-coordinator";
export * from "./signature-verification";
export * from "./provider-factory";
export * from "./transaction-workflow-engine";
export * from "./sdk-integration";

// Type definitions and utilities (the generic helpers declared only in ./types/index)
export {
  ExtractProviderConfig,
  ProviderInstance,
  ChainSpecificTransaction,
  ProviderCapabilitiesByChain,
  SignatureProviderEventMap,
  SignatureProviderEventHandler,
  TypedProviderFactoryOptions,
  TypedMultiSignatureWorkflow,
  TypedSignatureVerificationRequest,
  ProviderRegistryQuery,
  ProviderSelectionCriteria,
  SignatureProviderContext,
  ProviderHealthCheck,
  BatchOperationResult,
  ProviderMetrics,
  TypeGuards,
  ProviderId,
  TransactionId,
  SignatureHash,
  PublicKeyHash,
  BrandedTypes,
  ProviderSpecificOperation,
  ProviderCompatibilityMatrix,
  DEFAULT_PROVIDER_COMPATIBILITY,
  ProviderFeatureMatrix,
  DEFAULT_PROVIDER_FEATURES,
} from "./types/index";
