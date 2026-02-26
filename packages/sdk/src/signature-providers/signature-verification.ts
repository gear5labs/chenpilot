import { ChainId } from "../types";
import {
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
  ChainTransaction,
} from "./types";
import { InvalidTransactionError, UnsupportedChainError } from "./errors";

/**
 * Signature verification result
 */
export interface SignatureVerificationResult {
  isValid: boolean;
  publicKey: string;
  signature: string;
  message?: string;
  chainId: ChainId;
  algorithm?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Signature verification request
 */
export interface SignatureVerificationRequest {
  signature: string;
  publicKey: string;
  message?: string;
  transactionData?: ChainTransaction;
  chainId: ChainId;
  metadata?: Record<string, unknown>;
}

/**
 * Multi-signature verification result
 */
export interface MultiSignatureVerificationResult {
  isValid: boolean;
  validSignatures: SignatureVerificationResult[];
  invalidSignatures: SignatureVerificationResult[];
  threshold: number;
  thresholdMet: boolean;
  totalSignatures: number;
  metadata?: Record<string, unknown>;
}

/**
 * Signature format utilities for different chains
 */
export class SignatureFormatUtils {
  /**
   * Validate signature format for specific chain
   */
  static validateSignatureFormat(signature: string, chainId: ChainId): boolean {
    switch (chainId) {
      case ChainId.BITCOIN:
        return this.validateBitcoinSignatureFormat(signature);
      case ChainId.STELLAR:
        return this.validateStellarSignatureFormat(signature);
      case ChainId.STARKNET:
        return this.validateStarknetSignatureFormat(signature);
      default:
        throw new UnsupportedChainError(chainId);
    }
  }

  /**
   * Validate Bitcoin signature format (DER encoding)
   */
  static validateBitcoinSignatureFormat(signature: string): boolean {
    // Bitcoin signatures are typically DER-encoded
    // Format: 0x30 [total-length] 0x02 [R-length] [R] 0x02 [S-length] [S] [sighash-type]
    if (!signature || signature.length < 8) {
      return false;
    }

    // Remove 0x prefix if present
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;

    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }

    // Basic DER format validation
    if (sig.length < 8 || sig.length > 144) {
      // Max DER signature length
      return false;
    }

    // Should start with 0x30 (DER sequence)
    return sig.startsWith("30");
  }

  /**
   * Validate Stellar signature format (64 bytes)
   */
  static validateStellarSignatureFormat(signature: string): boolean {
    if (!signature) {
      return false;
    }

    // Remove 0x prefix if present
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;

    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }

    // Stellar signatures are 64 bytes (128 hex characters)
    return sig.length === 128;
  }

  /**
   * Validate Starknet signature format
   */
  static validateStarknetSignatureFormat(signature: string): boolean {
    if (!signature) {
      return false;
    }

    // Starknet signatures can be arrays or single values
    if (signature.startsWith("[") && signature.endsWith("]")) {
      try {
        const sigArray = JSON.parse(signature);
        return Array.isArray(sigArray) && sigArray.length >= 2;
      } catch {
        return false;
      }
    }

    // Single signature format
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;

    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(sig)) {
      return false;
    }

    // Starknet signatures are typically 64 bytes (128 hex characters)
    return sig.length === 128;
  }

  /**
   * Normalize signature format for verification
   */
  static normalizeSignature(signature: string, chainId: ChainId): string {
    switch (chainId) {
      case ChainId.BITCOIN:
        return signature.startsWith("0x") ? signature : `0x${signature}`;
      case ChainId.STELLAR:
        return signature.startsWith("0x") ? signature.slice(2) : signature;
      case ChainId.STARKNET:
        return signature.startsWith("0x") ? signature : `0x${signature}`;
      default:
        return signature;
    }
  }
}

/**
 * Public key utilities for different chains
 */
export class PublicKeyUtils {
  /**
   * Validate public key format for specific chain
   */
  static validatePublicKeyFormat(publicKey: string, chainId: ChainId): boolean {
    switch (chainId) {
      case ChainId.BITCOIN:
        return this.validateBitcoinPublicKeyFormat(publicKey);
      case ChainId.STELLAR:
        return this.validateStellarPublicKeyFormat(publicKey);
      case ChainId.STARKNET:
        return this.validateStarknetPublicKeyFormat(publicKey);
      default:
        throw new UnsupportedChainError(chainId);
    }
  }

  /**
   * Validate Bitcoin public key format
   */
  static validateBitcoinPublicKeyFormat(publicKey: string): boolean {
    if (!publicKey) {
      return false;
    }

    const key = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;

    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      return false;
    }

    // Compressed public key (33 bytes) or uncompressed (65 bytes)
    return key.length === 66 || key.length === 130;
  }

  /**
   * Validate Stellar public key format (Ed25519)
   */
  static validateStellarPublicKeyFormat(publicKey: string): boolean {
    if (!publicKey) {
      return false;
    }

    // Stellar public keys start with 'G' and are 56 characters long
    return /^G[A-Z2-7]{55}$/.test(publicKey);
  }

  /**
   * Validate Starknet public key format
   */
  static validateStarknetPublicKeyFormat(publicKey: string): boolean {
    if (!publicKey) {
      return false;
    }

    const key = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;

    // Check if it's valid hex
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      return false;
    }

    // Starknet public keys are 32 bytes (64 hex characters)
    return key.length === 64;
  }

  /**
   * Normalize public key format
   */
  static normalizePublicKey(publicKey: string, chainId: ChainId): string {
    switch (chainId) {
      case ChainId.BITCOIN:
        return publicKey.startsWith("0x") ? publicKey : `0x${publicKey}`;
      case ChainId.STELLAR:
        return publicKey; // Stellar keys are already in correct format
      case ChainId.STARKNET:
        return publicKey.startsWith("0x") ? publicKey : `0x${publicKey}`;
      default:
        return publicKey;
    }
  }
}

/**
 * Message hashing utilities for signature verification
 */
export class MessageHashUtils {
  /**
   * Create message hash for signature verification
   */
  static createMessageHash(message: string, chainId: ChainId): string {
    switch (chainId) {
      case ChainId.BITCOIN:
        return this.createBitcoinMessageHash(message);
      case ChainId.STELLAR:
        return this.createStellarMessageHash(message);
      case ChainId.STARKNET:
        return this.createStarknetMessageHash(message);
      default:
        throw new UnsupportedChainError(chainId);
    }
  }

  /**
   * Create Bitcoin message hash (double SHA256)
   */
  static createBitcoinMessageHash(message: string): string {
    // Mock implementation - in real implementation would use crypto libraries
    return this.mockHash(`bitcoin:${message}`);
  }

  /**
   * Create Stellar message hash (SHA256)
   */
  static createStellarMessageHash(message: string): string {
    // Mock implementation - in real implementation would use crypto libraries
    return this.mockHash(`stellar:${message}`);
  }

  /**
   * Create Starknet message hash (Pedersen hash)
   */
  static createStarknetMessageHash(message: string): string {
    // Mock implementation - in real implementation would use Starknet crypto
    return this.mockHash(`starknet:${message}`);
  }

  /**
   * Create transaction hash for verification
   */
  static createTransactionHash(transactionData: ChainTransaction): string {
    const { chainId, transaction } = transactionData;

    switch (chainId) {
      case ChainId.BITCOIN:
        return this.createBitcoinTransactionHash(
          transaction as BitcoinTransaction
        );
      case ChainId.STELLAR:
        return this.createStellarTransactionHash(
          transaction as StellarTransaction
        );
      case ChainId.STARKNET:
        return this.createStarknetTransactionHash(
          transaction as StarknetTransaction
        );
      default:
        throw new UnsupportedChainError(chainId);
    }
  }

  private static createBitcoinTransactionHash(tx: BitcoinTransaction): string {
    // Mock implementation - would serialize and hash transaction
    return this.mockHash(`btc_tx:${JSON.stringify(tx)}`);
  }

  private static createStellarTransactionHash(tx: StellarTransaction): string {
    // Mock implementation - would use Stellar SDK to create transaction hash
    return this.mockHash(`stellar_tx:${JSON.stringify(tx)}`);
  }

  private static createStarknetTransactionHash(
    tx: StarknetTransaction
  ): string {
    // Mock implementation - would use Starknet libraries
    return this.mockHash(`starknet_tx:${JSON.stringify(tx)}`);
  }

  private static mockHash(input: string): string {
    // Simple mock hash function for development
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}

/**
 * Main signature verification utility class
 */
export class SignatureVerificationUtils {
  /**
   * Verify a single signature
   */
  static async verifySignature(
    request: SignatureVerificationRequest
  ): Promise<SignatureVerificationResult> {
    const { signature, publicKey, message, transactionData, chainId } = request;

    // Validate inputs
    if (!SignatureFormatUtils.validateSignatureFormat(signature, chainId)) {
      return {
        isValid: false,
        publicKey,
        signature,
        chainId,
        metadata: { error: "Invalid signature format" },
      };
    }

    if (!PublicKeyUtils.validatePublicKeyFormat(publicKey, chainId)) {
      return {
        isValid: false,
        publicKey,
        signature,
        chainId,
        metadata: { error: "Invalid public key format" },
      };
    }

    try {
      // Determine what to verify
      let messageToVerify: string;
      if (message) {
        messageToVerify = MessageHashUtils.createMessageHash(message, chainId);
      } else if (transactionData) {
        messageToVerify =
          MessageHashUtils.createTransactionHash(transactionData);
      } else {
        throw new InvalidTransactionError(
          "Either message or transactionData must be provided"
        );
      }

      // Perform chain-specific verification
      const isValid = await this.performChainSpecificVerification(
        signature,
        publicKey,
        messageToVerify,
        chainId
      );

      return {
        isValid,
        publicKey,
        signature,
        message: messageToVerify,
        chainId,
        algorithm: this.getSignatureAlgorithm(chainId),
        metadata: {
          verifiedAt: new Date().toISOString(),
          messageHash: messageToVerify,
        },
      };
    } catch (error) {
      return {
        isValid: false,
        publicKey,
        signature,
        chainId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Verify multiple signatures (multi-signature verification)
   */
  static async verifyMultiSignature(
    signatures: Array<{
      signature: string;
      publicKey: string;
    }>,
    message: string | ChainTransaction,
    chainId: ChainId,
    threshold: number = signatures.length
  ): Promise<MultiSignatureVerificationResult> {
    const verificationPromises = signatures.map(({ signature, publicKey }) => {
      const request: SignatureVerificationRequest = {
        signature,
        publicKey,
        chainId,
        ...(typeof message === "string"
          ? { message }
          : { transactionData: message }),
      };
      return this.verifySignature(request);
    });

    const results = await Promise.all(verificationPromises);
    const validSignatures = results.filter((r) => r.isValid);
    const invalidSignatures = results.filter((r) => !r.isValid);
    const thresholdMet = validSignatures.length >= threshold;

    return {
      isValid: thresholdMet,
      validSignatures,
      invalidSignatures,
      threshold,
      thresholdMet,
      totalSignatures: signatures.length,
      metadata: {
        verifiedAt: new Date().toISOString(),
        validCount: validSignatures.length,
        invalidCount: invalidSignatures.length,
      },
    };
  }

  /**
   * Verify signature against known test vectors
   */
  static async verifyWithTestVector(
    signature: string,
    publicKey: string,
    message: string,
    expectedResult: boolean,
    chainId: ChainId
  ): Promise<boolean> {
    const result = await this.verifySignature({
      signature,
      publicKey,
      message,
      chainId,
    });

    return result.isValid === expectedResult;
  }

  /**
   * Batch verify multiple signatures efficiently
   */
  static async batchVerifySignatures(
    requests: SignatureVerificationRequest[]
  ): Promise<SignatureVerificationResult[]> {
    // Group by chain for potential optimization
    const requestsByChain = new Map<ChainId, SignatureVerificationRequest[]>();

    for (const request of requests) {
      if (!requestsByChain.has(request.chainId)) {
        requestsByChain.set(request.chainId, []);
      }
      requestsByChain.get(request.chainId)!.push(request);
    }

    // Verify all requests (could be optimized per chain)
    const allPromises = requests.map((request) =>
      this.verifySignature(request)
    );
    return Promise.all(allPromises);
  }

  private static async performChainSpecificVerification(
    signature: string,
    publicKey: string,
    messageHash: string,
    chainId: ChainId
  ): Promise<boolean> {
    // Normalize inputs
    const normalizedSignature = SignatureFormatUtils.normalizeSignature(
      signature,
      chainId
    );
    const normalizedPublicKey = PublicKeyUtils.normalizePublicKey(
      publicKey,
      chainId
    );

    switch (chainId) {
      case ChainId.BITCOIN:
        return this.verifyBitcoinSignature(
          normalizedSignature,
          normalizedPublicKey,
          messageHash
        );
      case ChainId.STELLAR:
        return this.verifyStellarSignature(
          normalizedSignature,
          normalizedPublicKey,
          messageHash
        );
      case ChainId.STARKNET:
        return this.verifyStarknetSignature(
          normalizedSignature,
          normalizedPublicKey,
          messageHash
        );
      default:
        throw new UnsupportedChainError(chainId);
    }
  }

  private static async verifyBitcoinSignature(
    signature: string,
    publicKey: string,
    messageHash: string
  ): Promise<boolean> {
    // Mock Bitcoin signature verification
    // In real implementation, would use secp256k1 library
    return this.mockVerification(signature, publicKey, messageHash, "bitcoin");
  }

  private static async verifyStellarSignature(
    signature: string,
    publicKey: string,
    messageHash: string
  ): Promise<boolean> {
    // Mock Stellar signature verification
    // In real implementation, would use Ed25519 verification
    return this.mockVerification(signature, publicKey, messageHash, "stellar");
  }

  private static async verifyStarknetSignature(
    signature: string,
    publicKey: string,
    messageHash: string
  ): Promise<boolean> {
    // Mock Starknet signature verification
    // In real implementation, would use Starknet crypto libraries
    return this.mockVerification(signature, publicKey, messageHash, "starknet");
  }

  private static mockVerification(
    signature: string,
    publicKey: string,
    messageHash: string,
    chain: string
  ): boolean {
    // Simple mock verification for development
    // In real implementation, this would perform actual cryptographic verification
    const combined = `${signature}:${publicKey}:${messageHash}:${chain}`;
    const hash = this.simpleHash(combined);

    // Mock: signature is "valid" if hash is even
    return hash % 2 === 0;
  }

  private static simpleHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private static getSignatureAlgorithm(chainId: ChainId): string {
    switch (chainId) {
      case ChainId.BITCOIN:
        return "ECDSA-secp256k1";
      case ChainId.STELLAR:
        return "Ed25519";
      case ChainId.STARKNET:
        return "ECDSA-STARK";
      default:
        return "Unknown";
    }
  }
}
