import * as StellarSdk from "@stellar/stellar-sdk";
import * as bip39 from "bip39";
import * as ed25519 from "ed25519-hd-key";

/**
 * Options for deriving a Stellar keypair from a mnemonic
 */
export interface MnemonicKeyPairOptions {
  /** The BIP39 mnemonic phrase (12 or 24 words) */
  mnemonic: string;
  /** The account index (default: 0) */
  accountIndex?: number;
  /** Optional passphrase for the mnemonic (default: empty string) */
  passphrase?: string;
  /** BIP39 wordlist language (default: english) */
  wordlist?: string[];
}

/**
 * Utility class for deriving Stellar keypairs from mnemonic phrases
 * following SEP-0005 specification
 */
export class KeypairUtils {
  /**
   * Derive a Stellar keypair from a BIP39 mnemonic phrase
   * 
   * This implements SEP-0005 key derivation:
   * - Uses BIP-0039 to derive binary seed from mnemonic
   * - Uses SLIP-0010 for ed25519 key derivation
   * - Uses BIP-0044 with coin_type = 148 (Stellar) for path: m/44'/148'/account'
   * 
   * @param options - The mnemonic and derivation options
   * @returns A Stellar Keypair derived from the mnemonic
   * 
   * @example
   * ```ts
   * // Derive primary keypair (account 0)
   * const keypair = KeypairUtils.fromMnemonic({
   *   mnemonic: "illness spike retreat truth genius clock brain pass fit cave bargain toe"
   * });
   * 
   * // Derive specific account index
   * const keypair2 = KeypairUtils.fromMnemonic({
   *   mnemonic: "illness spike retreat truth genius clock brain pass fit cave bargain toe",
   *   accountIndex: 5
   * });
   * 
   * // Derive with passphrase
   * const keypair3 = KeypairUtils.fromMnemonic({
   *   mnemonic: "illness spike retreat truth genius clock brain pass fit cave bargain toe",
   *   passphrase: "my-secret-passphrase"
   * });
   * ```
   */
  static fromMnemonic(options: MnemonicKeyPairOptions): StellarSdk.Keypair {
    const {
      mnemonic,
      accountIndex = 0,
      passphrase = "",
      wordlist,
    } = options;

    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic, wordlist)) {
      throw new Error("Invalid mnemonic phrase");
    }

    // Convert mnemonic to seed (BIP-0039)
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);

    // Derive ed25519 key using SLIP-0010
    // Path: m/44'/148'/accountIndex'
    const derivationPath = `m/44'/148'/${accountIndex}'`;
    const derivedKey = ed25519.derivePath(derivationPath, seed.toString("hex"));

    // Create Stellar keypair from the derived private key
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(
      derivedKey.key
    );

    return keypair;
  }

  /**
   * Generate a new BIP39 mnemonic phrase
   * 
   * @param strength - Entropy in bits (128 for 12 words, 256 for 24 words, default: 256)
   * @param wordlist - Optional BIP39 wordlist (default: english)
   * @returns A randomly generated mnemonic phrase
   * 
   * @example
   * ```ts
   * // Generate 24-word mnemonic (recommended)
   * const mnemonic = KeypairUtils.generateMnemonic();
   * 
   * // Generate 12-word mnemonic
   * const mnemonic12 = KeypairUtils.generateMnemonic(128);
   * ```
   */
  static generateMnemonic(strength: number = 256, wordlist?: string[]): string {
    return bip39.generateMnemonic(strength, undefined, wordlist);
  }

  /**
   * Validate a BIP39 mnemonic phrase
   * 
   * @param mnemonic - The mnemonic phrase to validate
   * @param wordlist - Optional BIP39 wordlist (default: english)
   * @returns true if the mnemonic is valid, false otherwise
   * 
   * @example
   * ```ts
   * const isValid = KeypairUtils.validateMnemonic(
   *   "illness spike retreat truth genius clock brain pass fit cave bargain toe"
   * );
   * ```
   */
  static validateMnemonic(mnemonic: string, wordlist?: string[]): boolean {
    return bip39.validateMnemonic(mnemonic, wordlist);
  }

  /**
   * Derive multiple keypairs from a single mnemonic
   * Useful for generating a wallet with multiple accounts
   * 
   * @param mnemonic - The BIP39 mnemonic phrase
   * @param count - Number of keypairs to derive
   * @param startIndex - Starting account index (default: 0)
   * @param passphrase - Optional passphrase (default: empty string)
   * @returns Array of Stellar Keypairs
   * 
   * @example
   * ```ts
   * // Derive first 5 accounts
   * const keypairs = KeypairUtils.deriveMultiple({
   *   mnemonic: "illness spike retreat truth genius clock brain pass fit cave bargain toe",
   *   count: 5
   * });
   * ```
   */
  static deriveMultiple(
    mnemonic: string,
    count: number,
    startIndex: number = 0,
    passphrase: string = ""
  ): StellarSdk.Keypair[] {
    const keypairs: StellarSdk.Keypair[] = [];

    for (let i = 0; i < count; i++) {
      const keypair = this.fromMnemonic({
        mnemonic,
        accountIndex: startIndex + i,
        passphrase,
      });
      keypairs.push(keypair);
    }

    return keypairs;
  }
}

/**
 * Convenience function to derive a Stellar keypair from a mnemonic
 * 
 * @param options - The mnemonic and derivation options
 * @returns A Stellar Keypair derived from the mnemonic
 */
export function fromMnemonic(options: MnemonicKeyPairOptions): StellarSdk.Keypair {
  return KeypairUtils.fromMnemonic(options);
}

/**
 * Convenience function to generate a new BIP39 mnemonic phrase
 * 
 * @param strength - Entropy in bits (default: 256 for 24 words)
 * @param wordlist - Optional BIP39 wordlist
 * @returns A randomly generated mnemonic phrase
 */
export function generateMnemonic(strength: number = 256, wordlist?: string[]): string {
  return KeypairUtils.generateMnemonic(strength, wordlist);
}

/**
 * Convenience function to validate a BIP39 mnemonic phrase
 * 
 * @param mnemonic - The mnemonic phrase to validate
 * @param wordlist - Optional BIP39 wordlist
 * @returns true if the mnemonic is valid, false otherwise
 */
export function validateMnemonic(mnemonic: string, wordlist?: string[]): boolean {
  return KeypairUtils.validateMnemonic(mnemonic, wordlist);
}
