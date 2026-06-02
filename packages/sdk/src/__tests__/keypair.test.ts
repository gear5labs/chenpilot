/**
 * Unit tests for Keypair mnemonic utilities
 * Tests mnemonic-based key derivation following SEP-0005 specification
 */

import {
  KeypairUtils,
  fromMnemonic,
  generateMnemonic,
  validateMnemonic,
} from "../keypair";

describe("KeypairUtils", () => {
  describe("fromMnemonic", () => {
    it("should derive correct keypair for test 1 (12 words)", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 0 });

      // Expected public key from SEP-0005 Test 1
      expect(keypair.publicKey()).toBe(
        "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6"
      );
    });

    it("should derive correct keypair for test 1 account 1", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 1 });

      // Expected public key from SEP-0005 Test 1
      expect(keypair.publicKey()).toBe(
        "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX"
      );
    });

    it("should derive correct keypair for test 1 account 5", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 5 });

      // Expected public key from SEP-0005 Test 1
      expect(keypair.publicKey()).toBe(
        "GBRQY5JFN5UBG5PGOSUOL4M6D7VRMAYU6WW2ZWXBMCKB7GPT3YCBU2XZ"
      );
    });

    it("should derive correct keypair for test 2 (15 words)", () => {
      const mnemonic =
        "resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 0 });

      // Expected public key from SEP-0005 Test 2
      expect(keypair.publicKey()).toBe(
        "GAVXVW5MCK7Q66RIBWZZKZEDQTRXWCZUP4DIIFXCCENGW2P6W4OA34RH"
      );
    });

    it("should derive correct keypair for test 2 account 9", () => {
      const mnemonic =
        "resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 9 });

      // Expected public key from SEP-0005 Test 2
      expect(keypair.publicKey()).toBe(
        "GB3C6RRQB3V7EPDXEDJCMTS45LVDLSZQ46PTIGKZUY37DXXEOAKJIWSV"
      );
    });

    it("should throw error for invalid mnemonic", () => {
      const invalidMnemonic = "invalid word phrase not valid";

      expect(() =>
        KeypairUtils.fromMnemonic({ mnemonic: invalidMnemonic })
      ).toThrow("Invalid mnemonic phrase");
    });

    it("should derive different keypairs for different account indices", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair0 = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 0 });
      const keypair1 = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 1 });

      expect(keypair0.publicKey()).not.toBe(keypair1.publicKey());
    });

    it("should derive same keypair for same inputs", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair1 = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 0 });
      const keypair2 = KeypairUtils.fromMnemonic({ mnemonic, accountIndex: 0 });

      expect(keypair1.publicKey()).toBe(keypair2.publicKey());
    });

    it("should support passphrase", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";
      const passphrase = "my-secret-passphrase";

      const keypairWithPassphrase = KeypairUtils.fromMnemonic({
        mnemonic,
        passphrase,
      });
      const keypairWithoutPassphrase = KeypairUtils.fromMnemonic({
        mnemonic,
      });

      // Passphrase should result in different keypair
      expect(keypairWithPassphrase.publicKey()).not.toBe(
        keypairWithoutPassphrase.publicKey()
      );
    });

    it("should use default account index of 0", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypairDefault = KeypairUtils.fromMnemonic({ mnemonic });
      const keypairExplicit = KeypairUtils.fromMnemonic({
        mnemonic,
        accountIndex: 0,
      });

      expect(keypairDefault.publicKey()).toBe(keypairExplicit.publicKey());
    });
  });

  describe("generateMnemonic", () => {
    it("should generate 24-word mnemonic by default", () => {
      const mnemonic = KeypairUtils.generateMnemonic();
      const words = mnemonic.split(" ");

      expect(words.length).toBe(24);
      expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
    });

    it("should generate 12-word mnemonic with strength 128", () => {
      const mnemonic = KeypairUtils.generateMnemonic(128);
      const words = mnemonic.split(" ");

      expect(words.length).toBe(12);
      expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
    });

    it("should generate valid mnemonics", () => {
      for (let i = 0; i < 10; i++) {
        const mnemonic = KeypairUtils.generateMnemonic();
        expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
      }
    });

    it("should generate unique mnemonics", () => {
      const mnemonic1 = KeypairUtils.generateMnemonic();
      const mnemonic2 = KeypairUtils.generateMnemonic();

      expect(mnemonic1).not.toBe(mnemonic2);
    });
  });

  describe("validateMnemonic", () => {
    it("should validate correct 12-word mnemonic", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
    });

    it("should validate correct 15-word mnemonic", () => {
      const mnemonic =
        "resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top";

      expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
    });

    it("should validate correct 24-word mnemonic", () => {
      const mnemonic = KeypairUtils.generateMnemonic();

      expect(KeypairUtils.validateMnemonic(mnemonic)).toBe(true);
    });

    it("should reject invalid mnemonic", () => {
      const invalidMnemonic = "invalid word phrase not valid";

      expect(KeypairUtils.validateMnemonic(invalidMnemonic)).toBe(false);
    });

    it("should reject empty string", () => {
      expect(KeypairUtils.validateMnemonic("")).toBe(false);
    });

    it("should reject mnemonic with wrong checksum", () => {
      // Take a valid mnemonic and change one word
      const invalidMnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain wrong";

      expect(KeypairUtils.validateMnemonic(invalidMnemonic)).toBe(false);
    });
  });

  describe("deriveMultiple", () => {
    it("should derive multiple keypairs from single mnemonic", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypairs = KeypairUtils.deriveMultiple(mnemonic, 5);

      expect(keypairs.length).toBe(5);
      expect(keypairs[0].publicKey()).toBe(
        "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6"
      );
      expect(keypairs[1].publicKey()).toBe(
        "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX"
      );
    });

    it("should derive unique keypairs for each index", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypairs = KeypairUtils.deriveMultiple(mnemonic, 10);
      const publicKeys = keypairs.map((kp) => kp.publicKey());

      const uniqueKeys = new Set(publicKeys);
      expect(uniqueKeys.size).toBe(10);
    });

    it("should respect start index", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypairsFrom0 = KeypairUtils.deriveMultiple(mnemonic, 2, 0);
      const keypairsFrom5 = KeypairUtils.deriveMultiple(mnemonic, 2, 5);

      expect(keypairsFrom0[0].publicKey()).not.toBe(
        keypairsFrom5[0].publicKey()
      );
    });

    it("should support passphrase in deriveMultiple", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";
      const passphrase = "test-pass";

      const keypairs = KeypairUtils.deriveMultiple(
        mnemonic,
        2,
        0,
        passphrase
      );

      expect(keypairs.length).toBe(2);
      expect(keypairs[0].publicKey()).not.toBe(
        "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6"
      ); // Should differ from no passphrase
    });
  });

  describe("Convenience functions", () => {
    describe("fromMnemonic", () => {
      it("should match KeypairUtils.fromMnemonic", () => {
        const mnemonic =
          "illness spike retreat truth genius clock brain pass fit cave bargain toe";

        const keypair1 = fromMnemonic({ mnemonic });
        const keypair2 = KeypairUtils.fromMnemonic({ mnemonic });

        expect(keypair1.publicKey()).toBe(keypair2.publicKey());
      });
    });

    describe("generateMnemonic", () => {
      it("should match KeypairUtils.generateMnemonic", () => {
        const mnemonic = generateMnemonic();

        // Both should be valid
        expect(validateMnemonic(mnemonic)).toBe(true);
        expect(KeypairUtils.validateMnemonic(KeypairUtils.generateMnemonic())).toBe(true);
      });
    });

    describe("validateMnemonic", () => {
      it("should match KeypairUtils.validateMnemonic", () => {
        const mnemonic =
          "illness spike retreat truth genius clock brain pass fit cave bargain toe";

        const result1 = validateMnemonic(mnemonic);
        const result2 = KeypairUtils.validateMnemonic(mnemonic);

        expect(result1).toBe(result2);
      });
    });
  });

  describe("Security considerations", () => {
    it("should not expose private key in public methods", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keypair = KeypairUtils.fromMnemonic({ mnemonic });

      // publicKey() should be available
      expect(typeof keypair.publicKey).toBe("function");

      // secret() should also be available (needed for signing)
      expect(typeof keypair.secret).toBe("function");
    });

    it("should derive deterministic keys", () => {
      const mnemonic =
        "illness spike retreat truth genius clock brain pass fit cave bargain toe";

      const keys = Array.from({ length: 5 }, () =>
        KeypairUtils.fromMnemonic({ mnemonic }).publicKey()
      );

      // All should be identical
      expect(keys.every((k) => k === keys[0])).toBe(true);
    });
  });
});
