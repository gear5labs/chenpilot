import {
  calculatePortfolioValuation,
  exportPortfolioCanonical,
  AssetPriceInput,
} from "../portfolioValuation";
import { redactPlannerPromptDiagnostics } from "../../Agents/planner/promptRedaction";

describe("Portfolio Valuation, Staleness & Prompt Redaction (#1096, #1097, #1098, #1099)", () => {
  // --------------------------------------------------------------------------
  // #1096: Redaction policy for planner prompt diagnostics
  // --------------------------------------------------------------------------
  describe("#1096: Redact sensitive fields in prompt diagnostics", () => {
    it("should strip private keys and authorization tokens in production mode", () => {
      const entry = {
        promptText: "Execute payment using secret SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB and token Bearer eyJhbGciOiJIUzI1NiJ9",
      };

      const redacted = redactPlannerPromptDiagnostics(entry, true);
      expect(redacted.promptText).not.toContain("SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
      expect(redacted.promptText).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(redacted.promptText).toContain("[REDACTED_STELLAR_SECRET_KEY]");
      expect(redacted.promptText).toContain("Bearer [REDACTED_TOKEN]");
    });
  });

  // --------------------------------------------------------------------------
  // #1097: Mark stale prices explicitly in portfolio summaries
  // --------------------------------------------------------------------------
  describe("#1097: Stale price detection", () => {
    it("should flag prices older than max age as stale without omitting values", () => {
      const now = 1_000_000;
      const feeds = new Map<string, AssetPriceInput>();
      feeds.set("stellar:native:xlm", {
        symbol: "XLM",
        network: "stellar",
        issuerOrContract: "native",
        priceUsd: 0.12,
        priceTimestamp: now - 400_000, // 400s old > 300s limit
      });

      const holdings = [{ symbol: "XLM", network: "stellar", issuerOrContract: "native", amount: 1000 }];
      const summary = calculatePortfolioValuation(holdings, feeds, now, { maxStaleAgeMs: 300_000 });

      expect(summary.staleAssetsCount).toBe(1);
      expect(summary.positions[0].isStale).toBe(true);
      expect(summary.positions[0].status).toBe("PRICED_STALE");
    });
  });

  // --------------------------------------------------------------------------
  // #1098: Valuation behavior when some assets lack prices
  // --------------------------------------------------------------------------
  describe("#1098: Unpriced asset handling & completeness metadata", () => {
    it("should return partial completeness and list unpriced assets without silently assuming zero", () => {
      const now = 1_000_000;
      const feeds = new Map<string, AssetPriceInput>();
      feeds.set("stellar:native:xlm", {
        symbol: "XLM",
        network: "stellar",
        issuerOrContract: "native",
        priceUsd: 0.15,
        priceTimestamp: now,
      });

      const holdings = [
        { symbol: "XLM", network: "stellar", issuerOrContract: "native", amount: 100 },
        { symbol: "NEWTOKEN", network: "stellar", issuerOrContract: "GCUSTOMISSUER", amount: 50 },
      ];

      const summary = calculatePortfolioValuation(holdings, feeds, now);
      expect(summary.completenessStatus).toBe("PARTIAL");
      expect(summary.completenessRatio).toBe(0.5);
      expect(summary.unpricedAssets.length).toBe(1);
      expect(summary.unpricedAssets[0].symbol).toBe("NEWTOKEN");
      expect(summary.positions[1].positionValueUsd).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // #1099: Preserve issuer identity through all portfolio export formats
  // --------------------------------------------------------------------------
  describe("#1099: Preserve canonical asset identity on export", () => {
    it("should include network and issuer in CSV and JSON exports", () => {
      const now = 1_000_000;
      const feeds = new Map<string, AssetPriceInput>();
      feeds.set("stellar:gissuer123:usdc", {
        symbol: "USDC",
        network: "stellar",
        issuerOrContract: "GISSUER123",
        priceUsd: 1.0,
        priceTimestamp: now,
      });

      const holdings = [{ symbol: "USDC", network: "stellar", issuerOrContract: "GISSUER123", amount: 500 }];
      const summary = calculatePortfolioValuation(holdings, feeds, now);

      const csv = exportPortfolioCanonical(summary, "csv");
      expect(csv).toContain("stellar,GISSUER123,USDC,500");

      const json = exportPortfolioCanonical(summary, "json");
      const parsed = JSON.parse(json);
      expect(parsed.positions[0].issuerOrContract).toBe("GISSUER123");
      expect(parsed.positions[0].network).toBe("stellar");
    });
  });
});
