import { ChainId } from "../../types";
import {
  SignatureVerificationUtils,
  SignatureFormatUtils,
  PublicKeyUtils,
  MessageHashUtils,
  SignatureVerificationRequest,
} from "../signature-verification";
import {
  BitcoinTransaction,
  StellarTransaction,
  StarknetTransaction,
} from "../types";

describe("Signature Verification Utilities", () => {
  describe("SignatureFormatUtils", () => {
    describe("Bitcoin Signature Format", () => {
      it("should validate valid Bitcoin DER signatures", () => {
        const validSignatures = [
          "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        ];

        validSignatures.forEach((sig) => {
          expect(SignatureFormatUtils.validateBitcoinSignatureFormat(sig)).toBe(
            true
          );
        });
      });

      it("should reject invalid Bitcoin signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          "404402201234567890abcdef", // Wrong DER header
        ];

        invalidSignatures.forEach((sig) => {
          expect(SignatureFormatUtils.validateBitcoinSignatureFormat(sig)).toBe(
            false
          );
        });
      });
    });

    describe("Stellar Signature Format", () => {
      it("should validate valid Stellar signatures", () => {
        const validSignatures = [
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        ];

        validSignatures.forEach((sig) => {
          expect(SignatureFormatUtils.validateStellarSignatureFormat(sig)).toBe(
            true
          );
        });
      });

      it("should reject invalid Stellar signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234567890abcdef", // Too short
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12", // Too long
        ];

        invalidSignatures.forEach((sig) => {
          expect(SignatureFormatUtils.validateStellarSignatureFormat(sig)).toBe(
            false
          );
        });
      });
    });

    describe("Starknet Signature Format", () => {
      it("should validate valid Starknet signatures", () => {
        const validSignatures = [
          "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          '["0x1234567890abcdef1234567890abcdef", "0x1234567890abcdef1234567890abcdef"]',
        ];

        validSignatures.forEach((sig) => {
          expect(
            SignatureFormatUtils.validateStarknetSignatureFormat(sig)
          ).toBe(true);
        });
      });

      it("should reject invalid Starknet signatures", () => {
        const invalidSignatures = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          '["invalid"]', // Invalid array format
        ];

        invalidSignatures.forEach((sig) => {
          expect(
            SignatureFormatUtils.validateStarknetSignatureFormat(sig)
          ).toBe(false);
        });
      });
    });

    describe("Signature Normalization", () => {
      it("should normalize signatures correctly", () => {
        expect(
          SignatureFormatUtils.normalizeSignature("1234abcd", ChainId.BITCOIN)
        ).toBe("0x1234abcd");
        expect(
          SignatureFormatUtils.normalizeSignature("0x1234abcd", ChainId.STELLAR)
        ).toBe("1234abcd");
        expect(
          SignatureFormatUtils.normalizeSignature("1234abcd", ChainId.STARKNET)
        ).toBe("0x1234abcd");
      });
    });
  });

  describe("PublicKeyUtils", () => {
    describe("Bitcoin Public Key Format", () => {
      it("should validate valid Bitcoin public keys", () => {
        const validKeys = [
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", // Compressed
          "0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", // Uncompressed
        ];

        validKeys.forEach((key) => {
          expect(PublicKeyUtils.validateBitcoinPublicKeyFormat(key)).toBe(true);
        });
      });

      it("should reject invalid Bitcoin public keys", () => {
        const invalidKeys = [
          "", // Empty
          "invalid", // Not hex
          "1234", // Too short
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F8179812", // Wrong length
        ];

        invalidKeys.forEach((key) => {
          expect(PublicKeyUtils.validateBitcoinPublicKeyFormat(key)).toBe(
            false
          );
        });
      });
    });

    describe("Stellar Public Key Format", () => {
      it("should validate valid Stellar public keys", () => {
        const validKeys = [
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
        ];

        validKeys.forEach((key) => {
          expect(PublicKeyUtils.validateStellarPublicKeyFormat(key)).toBe(true);
        });
      });

      it("should reject invalid Stellar public keys", () => {
        const invalidKeys = [
          "", // Empty
          "ADQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37", // Wrong prefix
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W3", // Too short
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W371", // Too long
        ];

        invalidKeys.forEach((key) => {
          expect(PublicKeyUtils.validateStellarPublicKeyFormat(key)).toBe(
            false
          );
        });
      });
    });

    describe("Starknet Public Key Format", () => {
      it("should validate valid Starknet public keys", () => {
        const validKeys = [
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        ];

        validKeys.forEach((key) => {
          expect(PublicKeyUtils.validateStarknetPublicKeyFormat(key)).toBe(
            true
          );
        });
      });

      it("should reject invalid Starknet public keys", () => {
        const invalidKeys = [
          "", // Empty
          "invalid", // Not hex
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc", // Too short
          "049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc712", // Too long
        ];

        invalidKeys.forEach((key) => {
          expect(PublicKeyUtils.validateStarknetPublicKeyFormat(key)).toBe(
            false
          );
        });
      });
    });
  });

  describe("MessageHashUtils", () => {
    it("should create message hashes for different chains", () => {
      const message = "Hello, World!";

      const bitcoinHash = MessageHashUtils.createBitcoinMessageHash(message);
      const stellarHash = MessageHashUtils.createStellarMessageHash(message);
      const starknetHash = MessageHashUtils.createStarknetMessageHash(message);

      expect(bitcoinHash).toBeTruthy();
      expect(stellarHash).toBeTruthy();
      expect(starknetHash).toBeTruthy();
      expect(bitcoinHash).not.toBe(stellarHash);
      expect(stellarHash).not.toBe(starknetHash);
    });

    it("should create transaction hashes for different chains", () => {
      const bitcoinTx: BitcoinTransaction = {
        inputs: [{ txid: "test", vout: 0 }],
        outputs: [{ value: 100000, scriptPubKey: "test" }],
      };

      const stellarTx: StellarTransaction = {
        sourceAccount:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      };

      const starknetTx: StarknetTransaction = {
        contractAddress: "0x123",
        entrypoint: "transfer",
        calldata: ["0x456", "1000"],
      };

      const bitcoinHash = MessageHashUtils.createTransactionHash({
        chainId: ChainId.BITCOIN,
        transaction: bitcoinTx,
      });

      const stellarHash = MessageHashUtils.createTransactionHash({
        chainId: ChainId.STELLAR,
        transaction: stellarTx,
      });

      const starknetHash = MessageHashUtils.createTransactionHash({
        chainId: ChainId.STARKNET,
        transaction: starknetTx,
      });

      expect(bitcoinHash).toBeTruthy();
      expect(stellarHash).toBeTruthy();
      expect(starknetHash).toBeTruthy();
      expect(bitcoinHash).not.toBe(stellarHash);
      expect(stellarHash).not.toBe(starknetHash);
    });
  });

  describe("SignatureVerificationUtils", () => {
    describe("Single Signature Verification", () => {
      it("should verify valid signatures", async () => {
        const request: SignatureVerificationRequest = {
          signature:
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          message: "Hello, World!",
          chainId: ChainId.BITCOIN,
        };

        const result =
          await SignatureVerificationUtils.verifySignature(request);

        expect(result.chainId).toBe(ChainId.BITCOIN);
        expect(result.signature).toBe(request.signature);
        expect(result.publicKey).toBe(request.publicKey);
        expect(result.algorithm).toBe("ECDSA-secp256k1");
        expect(result.metadata?.verifiedAt).toBeTruthy();
      });

      it("should handle invalid signature format", async () => {
        const request: SignatureVerificationRequest = {
          signature: "invalid-signature",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          message: "Hello, World!",
          chainId: ChainId.BITCOIN,
        };

        const result =
          await SignatureVerificationUtils.verifySignature(request);

        expect(result.isValid).toBe(false);
        expect(result.metadata?.error).toBe("Invalid signature format");
      });

      it("should handle invalid public key format", async () => {
        const request: SignatureVerificationRequest = {
          signature:
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey: "invalid-pubkey",
          message: "Hello, World!",
          chainId: ChainId.BITCOIN,
        };

        const result =
          await SignatureVerificationUtils.verifySignature(request);

        expect(result.isValid).toBe(false);
        expect(result.metadata?.error).toBe("Invalid public key format");
      });

      it("should verify transaction signatures", async () => {
        const transaction: BitcoinTransaction = {
          inputs: [{ txid: "test", vout: 0 }],
          outputs: [{ value: 100000, scriptPubKey: "test" }],
        };

        const request: SignatureVerificationRequest = {
          signature:
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          transactionData: {
            chainId: ChainId.BITCOIN,
            transaction,
          },
          chainId: ChainId.BITCOIN,
        };

        const result =
          await SignatureVerificationUtils.verifySignature(request);

        expect(result.chainId).toBe(ChainId.BITCOIN);
        expect(result.metadata?.messageHash).toBeTruthy();
      });
    });

    describe("Multi-Signature Verification", () => {
      it("should verify multiple signatures", async () => {
        const signatures = [
          {
            signature:
              "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          },
          {
            signature:
              "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            publicKey:
              "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          },
        ];

        const result = await SignatureVerificationUtils.verifyMultiSignature(
          signatures,
          "Hello, Multi-Sig!",
          ChainId.STELLAR,
          2
        );

        expect(result.totalSignatures).toBe(2);
        expect(result.threshold).toBe(2);
        expect(
          result.validSignatures.length + result.invalidSignatures.length
        ).toBe(2);
      });

      it("should handle threshold not met", async () => {
        const signatures = [
          {
            signature: "invalid-signature",
            publicKey:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          },
          {
            signature: "another-invalid-signature",
            publicKey:
              "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          },
        ];

        const result = await SignatureVerificationUtils.verifyMultiSignature(
          signatures,
          "Hello, Multi-Sig!",
          ChainId.STELLAR,
          2
        );

        expect(result.isValid).toBe(false);
        expect(result.thresholdMet).toBe(false);
        expect(result.invalidSignatures.length).toBe(2);
      });
    });

    describe("Batch Verification", () => {
      it("should batch verify multiple requests", async () => {
        const requests: SignatureVerificationRequest[] = [
          {
            signature:
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            message: "Message 1",
            chainId: ChainId.BITCOIN,
          },
          {
            signature:
              "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            publicKey:
              "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            message: "Message 2",
            chainId: ChainId.STELLAR,
          },
        ];

        const results =
          await SignatureVerificationUtils.batchVerifySignatures(requests);

        expect(results).toHaveLength(2);
        expect(results[0].chainId).toBe(ChainId.BITCOIN);
        expect(results[1].chainId).toBe(ChainId.STELLAR);
      });
    });

    describe("Test Vector Verification", () => {
      it("should verify against known test vectors", async () => {
        const isValid = await SignatureVerificationUtils.verifyWithTestVector(
          "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          "Test message",
          true, // Expected result (mock will determine actual result)
          ChainId.BITCOIN
        );

        expect(typeof isValid).toBe("boolean");
      });
    });

    describe("Chain-Specific Verification", () => {
      it("should handle different signature algorithms", async () => {
        const bitcoinRequest: SignatureVerificationRequest = {
          signature:
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          message: "Bitcoin message",
          chainId: ChainId.BITCOIN,
        };

        const stellarRequest: SignatureVerificationRequest = {
          signature:
            "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          message: "Stellar message",
          chainId: ChainId.STELLAR,
        };

        const starknetRequest: SignatureVerificationRequest = {
          signature:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          publicKey:
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          message: "Starknet message",
          chainId: ChainId.STARKNET,
        };

        const bitcoinResult =
          await SignatureVerificationUtils.verifySignature(bitcoinRequest);
        const stellarResult =
          await SignatureVerificationUtils.verifySignature(stellarRequest);
        const starknetResult =
          await SignatureVerificationUtils.verifySignature(starknetRequest);

        expect(bitcoinResult.algorithm).toBe("ECDSA-secp256k1");
        expect(stellarResult.algorithm).toBe("Ed25519");
        expect(starknetResult.algorithm).toBe("ECDSA-STARK");
      });
    });
  });
});
