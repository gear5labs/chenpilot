import { ChainId } from "../types";

// Base transaction types for different chains
export interface BitcoinTransaction {
  inputs: Array<{
    txid: string;
    vout: number;
    scriptSig?: string;
    sequence?: number;
  }>;
  outputs: Array<{
    value: number;
    scriptPubKey: string;
  }>;
  version?: number;
  lockTime?: number;
}

export interface StellarTransaction {
  sourceAccount: string;
  fee: string;
  sequenceNumber: string;
  operations: Array<Record<string, unknown>>;
  memo?: {
    type: string;
    value: string;
  };
  timeBounds?: {
    minTime: string;
    maxTime: string;
  };
}

export interface StarknetTransaction {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
  version?: string;
  maxFee?: string;
  nonce?: string;
}

// Union type for all supported transaction types
export type ChainTransaction =
  | { chainId: ChainId.BITCOIN; transaction: BitcoinTransaction }
  | { chainId: ChainId.STELLAR; transaction: StellarTransaction }
  | { chainId: ChainId.STARKNET; transaction: StarknetTransaction };

// Signature request and result types
export interface SignatureRequest {
  transactionData: ChainTransaction;
  accountAddress: string;
  metadata?: Record<string, unknown>;
}

export interface SignatureResult {
  signature: string;
  publicKey: string;
  signedTransaction?: unknown;
  metadata?: Record<string, unknown>;
}

// Provider account information
export interface SignatureProviderAccount {
  address: string;
  publicKey: string;
  chainId: ChainId;
  derivationPath?: string;
  metadata?: Record<string, unknown>;
}

// Provider connection information
export interface SignatureProviderConnection {
  isConnected: boolean;
  connectionId: string;
  metadata?: Record<string, unknown>;
}

// Provider capabilities
export interface SignatureProviderCapabilities {
  supportedChains: ChainId[];
  supportsMultipleAccounts: boolean;
  requiresUserInteraction: boolean;
  supportsMessageSigning: boolean;
  maxConcurrentSignatures: number;
  metadata?: Record<string, unknown>;
}

// Provider metadata
export interface SignatureProviderMetadata {
  name: string;
  version: string;
  description: string;
  icon?: string;
  website?: string;
}

// Provider types enum
export enum ProviderType {
  MOCK = "mock",
  LEDGER = "ledger",
  ALBEDO = "albedo",
}

// SDK Configuration
export interface SignatureProviderSDKConfig {
  defaultProviders?: ProviderType[];
  autoDiscovery?: boolean;
  enableMetrics?: boolean;
  enableLogging?: boolean;
  connectionTimeout?: number;
  maxRetries?: number;
  registry?: Record<string, unknown>; // SignatureProviderRegistry type
}

// Provider configuration for factory
export interface ProviderConfig {
  type: ProviderType;
  config?: Record<string, unknown>;
}
