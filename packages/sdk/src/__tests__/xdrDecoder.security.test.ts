// packages/sdk/src/__tests__/xdrDecoder.security.test.ts

import * as StellarSdk from "@stellar/stellar-sdk";
import {
  SafeXdrDecoder,
  safeScValToNative,
  XdrPreValidator,
  DEFAULT_XDR_LIMITS,
  XdrSecurityError,
  XdrByteLimitExceededError,
  XdrBase64LimitExceededError,
  XdrDepthLimitExceededError,
  XdrOperationLimitExceededError,
  XdrCollectionLimitExceededError,
  XdrComputationLimitExceededError,
  XdrMalformedError,
  XdrDecoder,
  EventDecoderRegistry,
  parseEvent,
} from "../index";

describe("XDR Security & Hardened Decoding Subsystem (#663)", () => {
  const sampleKeypair = StellarSdk.Keypair.random();
  const destKeypair = StellarSdk.Keypair.random();

  describe("1. Pre-validation and Byte/Base64 Limits", () => {
    it("rejects null or undefined input with XdrMalformedError", () => {
      expect(() => XdrPreValidator.validateAndNormalize(null as never)).toThrow(
        XdrMalformedError
      );
      expect(() =>
        XdrPreValidator.validateAndNormalize(undefined as never)
      ).toThrow(XdrMalformedError);
    });

    it("rejects non-string non-buffer input types", () => {
      expect(() =>
        XdrPreValidator.validateAndNormalize(12345 as never)
      ).toThrow(XdrMalformedError);
      expect(() => XdrPreValidator.validateAndNormalize({} as never)).toThrow(
        XdrMalformedError
      );
    });

    it("rejects oversized base64 strings exceeding maxBase64Length", () => {
      const oversized = "A".repeat(DEFAULT_XDR_LIMITS.maxBase64Length + 10);
      expect(() => SafeXdrDecoder.decodeTransaction(oversized)).toThrow(
        XdrBase64LimitExceededError
      );
    });

    it("rejects oversized raw buffers exceeding maxByteLength", () => {
      const hugeBuffer = Buffer.alloc(DEFAULT_XDR_LIMITS.maxByteLength + 100);
      expect(() => SafeXdrDecoder.decodeTransaction(hugeBuffer)).toThrow(
        XdrByteLimitExceededError
      );
    });

    it("rejects invalid non-base64 characters before buffer allocation", () => {
      const invalidChars = "AAAA!@#$%^&*()_+===";
      expect(() => SafeXdrDecoder.decodeTransaction(invalidChars)).toThrow(
        XdrMalformedError
      );
    });

    it("rejects empty payload", () => {
      expect(() => SafeXdrDecoder.decodeTransaction("")).toThrow(
        XdrMalformedError
      );
      expect(() => SafeXdrDecoder.decodeTransaction(Buffer.alloc(0))).toThrow(
        XdrMalformedError
      );
    });
  });

  describe("2. Pathological Nesting Attacks (Stack Overflow Defense)", () => {
    it("successfully decodes shallowly nested ScVals within depth limit", () => {
      // Build 3 levels of nested vector: vec([vec([vec([scvU32(42)])])])
      const inner = StellarSdk.xdr.ScVal.scvVec([
        StellarSdk.xdr.ScVal.scvU32(42),
      ]);
      const mid = StellarSdk.xdr.ScVal.scvVec([inner]);
      const outer = StellarSdk.xdr.ScVal.scvVec([mid]);

      const result = safeScValToNative(outer, { limits: { maxDepth: 5 } });
      expect(result).toEqual([[[42]]]);
    });

    it("rejects deeply nested ScVal vectors exceeding maxDepth", () => {
      // Create 30 levels of nested vector
      let current = StellarSdk.xdr.ScVal.scvU32(999);
      for (let i = 0; i < 30; i++) {
        current = StellarSdk.xdr.ScVal.scvVec([current]);
      }

      // Should fail against default maxDepth of 16
      expect(() =>
        safeScValToNative(current, { limits: { maxDepth: 16 } })
      ).toThrow(XdrDepthLimitExceededError);
    });

    it("rejects deeply nested ScVal maps exceeding maxDepth", () => {
      let current = StellarSdk.xdr.ScVal.scvString("leaf");
      for (let i = 0; i < 20; i++) {
        const entry = new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol(`k${i}`),
          val: current,
        });
        current = StellarSdk.xdr.ScVal.scvMap([entry]);
      }

      expect(() =>
        safeScValToNative(current, { limits: { maxDepth: 10 } })
      ).toThrow(XdrDepthLimitExceededError);
    });
  });

  describe("3. Length-Field and Memory Allocation Bomb Attacks", () => {
    it("detects and rejects 4GB length header claim in tiny buffer", () => {
      // Construct a 16-byte buffer with 0xFFFFFFFF at offset 0
      const maliciousBuffer = Buffer.alloc(16);
      maliciousBuffer.writeUInt32BE(0xffffffff, 0);

      expect(() =>
        XdrPreValidator.validateAndNormalize(maliciousBuffer)
      ).toThrow(XdrMalformedError);
    });

    it("detects and rejects 2GB length header claim in tiny buffer", () => {
      const maliciousBuffer = Buffer.alloc(16);
      maliciousBuffer.writeUInt32BE(0x7fffffff, 0);

      expect(() =>
        XdrPreValidator.validateAndNormalize(maliciousBuffer)
      ).toThrow(XdrMalformedError);
    });
  });

  describe("4. Pathological Operation Count and Collection Bounds", () => {
    it("rejects ScVal vector with items exceeding maxCollectionEntries", () => {
      const hugeArray: StellarSdk.xdr.ScVal[] = [];
      for (let i = 0; i < 1050; i++) {
        hugeArray.push(StellarSdk.xdr.ScVal.scvU32(i));
      }
      const vec = StellarSdk.xdr.ScVal.scvVec(hugeArray);

      expect(() =>
        safeScValToNative(vec, { limits: { maxCollectionEntries: 1000 } })
      ).toThrow(XdrCollectionLimitExceededError);
    });

    it("enforces operation limits in transaction decoding", () => {
      const account = new StellarSdk.Account(sampleKeypair.publicKey(), "100");
      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: StellarSdk.Networks.TESTNET,
      });

      // Add 5 operations
      for (let i = 0; i < 5; i++) {
        builder.addOperation(
          StellarSdk.Operation.payment({
            destination: destKeypair.publicKey(),
            asset: StellarSdk.Asset.native(),
            amount: "1",
          })
        );
      }
      builder.setTimeout(30);
      const tx = builder.build();
      const txXdr = tx.toXDR();

      // Should succeed with default limit (100)
      const decoded = SafeXdrDecoder.decodeTransaction(txXdr);
      expect(decoded.operations.length).toBe(5);

      // Should fail if maxOperations is set to 3
      expect(() =>
        SafeXdrDecoder.decodeTransaction(txXdr, {
          limits: { maxOperations: 3 },
        })
      ).toThrow(XdrOperationLimitExceededError);
    });
  });

  describe("5. Computation Step Budgeting", () => {
    it("throws XdrComputationLimitExceededError when total node visits exceed budget", () => {
      // Build a tree with 50 nodes
      const items: StellarSdk.xdr.ScVal[] = [];
      for (let i = 0; i < 50; i++) {
        items.push(StellarSdk.xdr.ScVal.scvU32(i));
      }
      const vec = StellarSdk.xdr.ScVal.scvVec(items);

      // Set tiny computation step budget
      expect(() =>
        safeScValToNative(vec, { limits: { maxComputationSteps: 10 } })
      ).toThrow(XdrComputationLimitExceededError);
    });
  });

  describe("6. Bounded Diagnostic Sanitization & Zero Payload Echoing", () => {
    it("never echoes secret or attacker payload in error diagnostic", () => {
      const secretPayload =
        "SECRET_TOKEN_1234567890_UNAUTHORIZED_BLOCKCHAIN_DATA_EXFILTRATION";
      const garbageXdr =
        "AAAA" + Buffer.from(secretPayload).toString("base64") + "====";

      try {
        SafeXdrDecoder.decodeTransaction(garbageXdr);
        throw new Error("Expected decodeTransaction to fail");
      } catch (err) {
        expect(err).toBeInstanceOf(XdrSecurityError);
        const errorMsg = (err as Error).message;

        // Verify message length is bounded
        expect(errorMsg.length).toBeLessThanOrEqual(
          DEFAULT_XDR_LIMITS.maxDiagnosticLength
        );

        // Verify secret token string is NEVER present in the error message
        expect(errorMsg.includes(secretPayload)).toBe(false);
      }
    });

    it("sanitizes XdrDecoder.explainOperation errors without leaking payload", () => {
      const maliciousPayload =
        "SOME_MALICIOUS_AND_VERY_LONG_PAYLOAD_STRING_THAT_SHOULD_NEVER_BE_LOGGED";
      const result = XdrDecoder.explainOperation(maliciousPayload);

      expect(result.startsWith("Failed to decode operation:")).toBe(true);
      expect(result.length).toBeLessThanOrEqual(300);
      expect(result.includes(maliciousPayload)).toBe(false);
    });
  });

  describe("7. Standard Valid Stellar Operation & Transaction Decoding", () => {
    it("correctly decodes and explains valid payment operation", () => {
      const op = StellarSdk.Operation.payment({
        destination: destKeypair.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "100.5",
      });

      const opXdr = op.toXDR("base64");
      const explanation = XdrDecoder.explainOperation(opXdr);

      expect(explanation).toContain("Send 100.5 XLM to");
      expect(explanation).toContain(destKeypair.publicKey());
    });

    it("preserves muxed recipient ID in payment operation explanation", () => {
      // Build a muxed account: same base key as destKeypair but with sub-ID 42
      const muxedDest = new StellarSdk.MuxedAccount(
        new StellarSdk.Account(destKeypair.publicKey(), "0"),
        "42"
      );
      const op = StellarSdk.Operation.payment({
        destination: muxedDest.accountId(),
        asset: StellarSdk.Asset.native(),
        amount: "50",
      });

      const opXdr = op.toXDR("base64");
      const explanation = XdrDecoder.explainOperation(opXdr);

      // The explanation must carry the full M-address, not just the base G-address
      expect(explanation).toContain("Send 50 XLM to");
      expect(explanation).toContain(muxedDest.accountId());
      expect(explanation).not.toBe(`Send 50 XLM to ${destKeypair.publicKey()}`);
    });

    it("correctly decodes and explains valid change trust operation", () => {
      const customAsset = new StellarSdk.Asset(
        "USDC",
        sampleKeypair.publicKey()
      );
      const op = StellarSdk.Operation.changeTrust({
        asset: customAsset,
        limit: "10000",
      });

      const opXdr = op.toXDR("base64");
      const explanation = XdrDecoder.explainOperation(opXdr);

      expect(explanation).toContain("Change trust: set trustline for USDC");
      expect(explanation).toContain("limit: 10000");
    });

    it("supports tryDecodeTransaction without throwing on malformed input", () => {
      const result = SafeXdrDecoder.tryDecodeTransaction("malformed_xdr");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.transaction).toBeUndefined();
    });

    it("supports tryDecodeOperation without throwing on malformed input", () => {
      const result = SafeXdrDecoder.tryDecodeOperation("invalid_op");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.operation).toBeUndefined();
    });
  });
});

describe("8. Bounded XDR decoding in contract-event registry handlers (#842)", () => {
  it("parseEvent decodes XDR-encoded ScVal data through the bounded decoder", () => {
    // Encode a simple u32 ScVal as XDR base64 — this is the shape Soroban RPC
    // returns for event data before client-side decoding.
    const scVal = StellarSdk.xdr.ScVal.scvU32(42);
    const xdrBase64 = scVal.toXDR("base64");

    const event = parseEvent(
      { topic: ["deposit"], value: xdrBase64 },
      "CABC",
      "txhash",
      100,
      1000
    );

    // data must be the decoded native value, not the raw XDR string
    expect(event.data).toBe(42);
    expect(typeof event.data).toBe("number");
  });

  it("parseEvent passes non-XDR data through unchanged", () => {
    const alreadyDecoded = { amount: "100", user: "GA..." };

    const event = parseEvent(
      { topic: ["deposit"], value: alreadyDecoded },
      "CABC",
      "txhash",
      100,
      1000
    );

    expect(event.data).toBe(alreadyDecoded);
  });

  it("parseEvent falls back to raw value when string is not valid XDR", () => {
    const event = parseEvent(
      { topic: ["deposit"], value: "not-xdr" },
      "CABC",
      "txhash",
      100,
      1000
    );

    expect(event.data).toBe("not-xdr");
  });

  it("EventDecoderRegistry decoder receives bounded-decoded data from parseEvent", () => {
    const registry = new EventDecoderRegistry();
    registry.register({
      eventType: "deposit",
      decoder: (ev) => ({ amount: (ev.data as Record<string, unknown>).amount }),
    });

    // Encode a map { amount: "500" } as XDR
    const mapEntry = new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("amount"),
      val: StellarSdk.xdr.ScVal.scvString("500"),
    });
    const scVal = StellarSdk.xdr.ScVal.scvMap([mapEntry]);
    const xdrBase64 = scVal.toXDR("base64");

    const event = parseEvent(
      { topic: ["deposit"], value: xdrBase64 },
      "CABC",
      "txhash",
      101,
      1001
    );

    const decoded = registry.decode(event, { strict: true });
    expect(decoded).toBeDefined();
    expect((decoded!.data as Record<string, unknown>).amount).toBe("500");
  });

  it("parseEvent enforces depth limits — rejects adversarially nested XDR event data", () => {
    // Build 30 levels of nested vec and encode as XDR
    let current = StellarSdk.xdr.ScVal.scvU32(1);
    for (let i = 0; i < 30; i++) {
      current = StellarSdk.xdr.ScVal.scvVec([current]);
    }
    const xdrBase64 = current.toXDR("base64");

    // With default limits (maxDepth 16) the bounded decoder will reject this;
    // parseEvent must fall back to the raw string rather than throwing.
    const event = parseEvent(
      { topic: ["deposit"], value: xdrBase64 },
      "CABC",
      "txhash",
      102,
      1002
    );

    // Falls back to raw string — does NOT propagate the XdrDepthLimitExceededError
    expect(event.data).toBe(xdrBase64);
  });
});
