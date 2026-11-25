import { describe, expect, it } from "@jest/globals";
import {
  formatPortfolioPage,
  InvalidPortfolioPageError,
  type PortfolioReportData,
} from "../commands/portfolioPagination";

const shortPortfolio: PortfolioReportData = {
  currency: "USD",
  totalValue: 12.5,
  assets: [{ code: "XLM", balance: 2, value: 12.5 }],
};

describe("portfolio pagination", () => {
  it("preserves the existing single-message output for short portfolios", () => {
    expect(formatPortfolioPage(shortPortfolio)).toBe(
      "📊 **Portfolio Report (USD)**\n\n" +
        "**Total Value:** 12.5000 USD\n\n" +
        "• **XLM**: 2 ≈ 12.5000 USD\n"
    );
  });

  it("fits large portfolios into bounded pages and includes every asset once", () => {
    const portfolio = {
      ...shortPortfolio,
      assets: Array.from({ length: 100 }, (_, index) => ({
        code: `ASSET${index}`,
        balance: index,
        value: index,
      })),
    };
    const first = formatPortfolioPage(portfolio, 1, 600);
    const pageCount = Number(first.match(/Page 1\/(\d+)/)?.[1]);
    const pages = Array.from({ length: pageCount }, (_, index) =>
      formatPortfolioPage(portfolio, index + 1, 600)
    );

    expect(pageCount).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 600)).toBe(true);
    expect(first).toContain("Page 1/");
    expect(first).toContain("ASSET0");
    const output = pages.join("\n");
    for (let index = 0; index < 100; index += 1) {
      expect(output.match(new RegExp(`ASSET${index}(?:\\*\\*|:)`, "g"))).toHaveLength(1);
    }
    expect(() => formatPortfolioPage(portfolio, pageCount + 1, 600)).toThrow(
      /outside the available range/i
    );
  });

  it("handles empty assets and rejects invalid or out-of-range page requests", () => {
    expect(
      formatPortfolioPage({ ...shortPortfolio, assets: [] })
    ).toContain("Portfolio Report");
    expect(
      formatPortfolioPage(
        {
          ...shortPortfolio,
          address: "G123456789",
          fetchedAt: "2026-01-01T00:00:00.000Z",
          assets: [],
        },
        1,
        2_000
      )
    ).toContain("No assets found on this account.");
    expect(() => formatPortfolioPage(shortPortfolio, 0)).toThrow(
      InvalidPortfolioPageError
    );
    expect(() =>
      formatPortfolioPage({ ...shortPortfolio, assets: [] }, 2)
    ).toThrow(/only one page/i);
  });

  it("rejects entries that cannot fit within the requested message limit", () => {
    const portfolio = {
      ...shortPortfolio,
      assets: Array.from({ length: 20 }, (_, index) => ({
        code: `${index}-${"x".repeat(100)}`,
        balance: 1,
        value: 1,
      })),
    };
    expect(() => formatPortfolioPage(portfolio, 1, 250)).toThrow(
      InvalidPortfolioPageError
    );
  });
});
