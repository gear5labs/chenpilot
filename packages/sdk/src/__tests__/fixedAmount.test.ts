import fc from "fast-check";
import { parseScaledAmount, serializeScaledAmount, sumAmounts } from "../fixedAmount";

describe("SDK fixedAmount (#622)", () => {
  describe("parse/serialize round-trip", () => {
    it("is canonical and stable", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 ** 9 }), (n) => {
          const units = parseScaledAmount(String(n), 7);
          expect(serializeScaledAmount(units, 7)).toBe(String(n));
        })
      );
    });

    it("handles fractional values exactly", () => {
      expect(parseScaledAmount("0.1", 7)).toBe(1_000_000n);
      expect(parseScaledAmount("0.2", 7)).toBe(2_000_000n);
      expect(serializeScaledAmount(3_000_000n, 7)).toBe("0.3");
    });

    it("rejects precision beyond the asset", () => {
      expect(() => parseScaledAmount("0.00000001", 7)).toThrow(/exceeds precision/);
    });
  });

  describe("sumAmounts", () => {
    it("sums 0.1 + 0.2 without float drift", () => {
      expect(sumAmounts(["0.1", "0.2"], 7)).toBe("0.3");
    });

    it("handles dust and large values", () => {
      expect(sumAmounts(["0.0000001", "0.0000002"], 7)).toBe("0.0000003");
      expect(sumAmounts(["999999999.9999999", "0.0000001"], 7)).toBe("1000000000");
    });

    it("is exact for many terms (no float accumulation error)", () => {
      const terms = Array.from({ length: 1000 }, () => "0.0000001");
      expect(sumAmounts(terms, 7)).toBe("0.0001");
    });
  });

  describe("unsafe numeric amount rejection at API boundaries", () => {
    it("rejects unsafe amounts in SponsorshipTransactionBuilder.addSponsoredPayment", () => {
      const { SponsorshipTransactionBuilder } = require("../sponsorship");
      const keypair = require("@stellar/stellar-sdk").Keypair.random();
      const builder = new SponsorshipTransactionBuilder(
        keypair,
        "Test SDF Network ; September 2015"
      );

      builder.addBeginSponsorship({
        sponsor: keypair.publicKey(),
        sponsoredAccount: "GSPONSORED",
      });

      expect(() => {
        builder.addSponsoredPayment("GDEST", undefined, "123.123456789");
      }).toThrow(/Invalid amount.*7 decimal places/);

      expect(() => {
        builder.addSponsoredPayment("GDEST", undefined, "-5");
      }).toThrow(/Invalid amount/);

      expect(() => {
        builder.addSponsoredPayment("GDEST", undefined, "abc");
      }).toThrow(/Invalid amount/);
    });

    it("accepts valid amounts in SponsorshipTransactionBuilder.addSponsoredPayment", () => {
      const { SponsorshipTransactionBuilder } = require("../sponsorship");
      const keypair = require("@stellar/stellar-sdk").Keypair.random();
      const builder = new SponsorshipTransactionBuilder(
        keypair,
        "Test SDF Network ; September 2015"
      );

      builder.addBeginSponsorship({
        sponsor: keypair.publicKey(),
        sponsoredAccount: "GSPONSORED",
      });

      expect(() => {
        builder.addSponsoredPayment("GDEST", undefined, "100.1234567");
      }).not.toThrow();

      expect(() => {
        builder.addSponsoredPayment("GDEST", undefined, "0");
      }).not.toThrow();
    });

    it("rejects unsafe amounts in SponsorshipWorkflowBuilder.addPayment", () => {
      const { SponsorshipWorkflowBuilder } = require("../sponsorship");
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });

      expect(() => {
        builder.addPayment("GDEST", "999.99999999");
      }).toThrow(/Invalid amount.*7 decimal places/);

      expect(() => {
        builder.addPayment("GDEST", "-100");
      }).toThrow(/Invalid amount/);
    });

    it("rejects numbers, exponent notation, and excess precision, and accepts zero", () => {
      const { parsePublicAmount } = require("../fixedAmount");
      const { isAmount, isPositiveAmount } = require("../advancedOps/validation");
      const maxSafe = Number.MAX_SAFE_INTEGER;

      expect(() => parsePublicAmount(maxSafe, 7)).toThrow(/canonical decimal string/);
      expect(() => parsePublicAmount(maxSafe + 2, 7)).toThrow(/Unsafe numeric amount/);
      expect(() => parsePublicAmount(0.1, 7)).toThrow(/Unsafe numeric amount/);
      expect(() => parsePublicAmount("1e7", 7)).toThrow(/exponent notation/);
      expect(() => parsePublicAmount("0.00000001", 7)).toThrow(/exceeds precision/);
      expect(parsePublicAmount("0", 7)).toBe(0n);
      expect(parsePublicAmount("9007199254740993", 0)).toBe(9007199254740993n);

      expect(isAmount(maxSafe)).toBe(false);
      expect(isAmount("1e7")).toBe(false);
      expect(isAmount("0")).toBe(true);
      expect(isPositiveAmount("0")).toBe(false);
      expect(isPositiveAmount("0.0000001")).toBe(true);
      expect(isAmount("0.00000001")).toBe(false);
      expect(isPositiveAmount("9007199254740993")).toBe(true);
    });

    it("accepts valid amounts in SponsorshipWorkflowBuilder.addPayment", () => {
      const { SponsorshipWorkflowBuilder } = require("../sponsorship");
      const builder = new SponsorshipWorkflowBuilder({
        sponsor: "GSPONSOR",
        sponsoredAccount: "GSPONSORED",
      });

      expect(() => {
        builder.addPayment("GDEST", "50.5");
      }).not.toThrow();

      expect(() => {
        builder.addPayment("GDEST", "0.0000001");
      }).not.toThrow();
    });
  });
});
