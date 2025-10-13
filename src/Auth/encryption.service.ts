import { injectable } from 'tsyringe';
import crypto from 'crypto';

export interface EncryptedData {
  encryptedData: string;
  iv: string;
  tag: string;
}

@injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly tagLength = 16; // 128 bits

  constructor() {
    this.validateEncryptionKey();
  }

  private validateEncryptionKey(): void {
    const encryptionKey = process.env.PRIVATE_KEY_ENCRYPTION_KEY;

    if (!encryptionKey) {
      throw new Error(
        'PRIVATE_KEY_ENCRYPTION_KEY environment variable is required. ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }

    if (encryptionKey.length !== 64) {
      // 32 bytes = 64 hex characters
      throw new Error(
        'PRIVATE_KEY_ENCRYPTION_KEY must be 64 characters long (32 bytes). ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
  }

  /**
   * Gets the encryption key from environment variables
   */
  private getEncryptionKey(): Buffer {
    const keyHex = process.env.PRIVATE_KEY_ENCRYPTION_KEY!;
    return Buffer.from(keyHex, 'hex');
  }

  /**
   * Encrypts a private key
   * @param privateKey - The private key to encrypt
   * @returns Encrypted data with IV and authentication tag
   */
  public encryptPrivateKey(privateKey: string): EncryptedData {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.ivLength);

      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      cipher.setAAD(Buffer.from('starknet-private-key', 'utf8')); // Additional authenticated data

      let encrypted = cipher.update(privateKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return {
        encryptedData: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
      };
    } catch (error) {
      throw new Error(
        `Failed to encrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Decrypts a private key
   * @param encryptedData - The encrypted private key data
   * @returns The decrypted private key
   */
  public decryptPrivateKey(encryptedData: EncryptedData): string {
    try {
      const key = this.getEncryptionKey();
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const tag = Buffer.from(encryptedData.tag, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAAD(Buffer.from('starknet-private-key', 'utf8')); // Additional authenticated data
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(
        encryptedData.encryptedData,
        'hex',
        'utf8'
      );
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(
        `Failed to decrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Encrypts a private key and returns it as a JSON string for database storage
   * @param privateKey - The private key to encrypt
   * @returns JSON string containing encrypted data
   */
  public encryptPrivateKeyForStorage(privateKey: string): string {
    const encryptedData = this.encryptPrivateKey(privateKey);
    return JSON.stringify(encryptedData);
  }

  /**
   * Decrypts a private key from JSON string stored in database
   * @param encryptedJson - JSON string containing encrypted data
   * @returns The decrypted private key
   */
  public decryptPrivateKeyFromStorage(encryptedJson: string): string {
    try {
      const encryptedData: EncryptedData = JSON.parse(encryptedJson);
      return this.decryptPrivateKey(encryptedData);
    } catch (error) {
      throw new Error(
        `Failed to decrypt private key from storage: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validates that a string is a valid encrypted private key format
   * @param encryptedJson - The encrypted JSON string to validate
   * @returns True if valid format, false otherwise
   */
  public isValidEncryptedFormat(encryptedJson: string): boolean {
    try {
      const parsed = JSON.parse(encryptedJson);
      return (
        typeof parsed === 'object' &&
        typeof parsed.encryptedData === 'string' &&
        typeof parsed.iv === 'string' &&
        typeof parsed.tag === 'string' &&
        parsed.encryptedData.length > 0 &&
        parsed.iv.length === 32 && // 16 bytes = 32 hex characters
        parsed.tag.length === 32 // 16 bytes = 32 hex characters
      );
    } catch {
      return false;
    }
  }

  /**
   * Generates a new encryption key (for setup purposes)
   * @returns A new encryption key as hex string
   */
  public static generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
