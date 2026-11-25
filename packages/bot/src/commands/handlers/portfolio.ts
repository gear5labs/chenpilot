/**
 * Portfolio / report command.
 *
 * Unified handler for both `/report` (Discord) and `/portfolio` (Telegram).
 * Both names are registered in the index so either alias triggers this logic.
 */

import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { SUPPORTED_CURRENCIES } from "../types";
import type { SupportedCurrency } from "../types";
import { getUserCurrency } from "./currency";
import {
  formatPortfolioPage,
  InvalidPortfolioPageError,
  type PortfolioReportData,
} from "../portfolioPagination";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

interface PortfolioResponse extends PortfolioReportData {
  address: string;
  fetchedAt: string;
}

async function fetchPortfolio(
  userId: string,
  currency: SupportedCurrency
): Promise<PortfolioResponse> {
  const res = await fetch(
    `${BACKEND_URL}/api/portfolio/${userId}?currency=${currency}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PortfolioResponse>;
}

export const portfolioHandler: CommandHandler = {
  name: "portfolio",
  description: "View your Stellar portfolio and estimated net worth",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    // Keep the existing currency argument and accept an optional page number.
    const rawCurrency = ctx.args[0]?.toUpperCase();
    const currency: SupportedCurrency =
      rawCurrency &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(rawCurrency)
        ? (rawCurrency as SupportedCurrency)
        : getUserCurrency(ctx.platform, ctx.userId);
    const pageArg =
      rawCurrency &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(rawCurrency)
        ? ctx.args[1]
        : ctx.args[0];
    const page = pageArg ? Number(pageArg) : 1;
    if (!Number.isInteger(page) || page < 1) {
      return { text: "❌ Page must be a positive whole number." };
    }

    const data = await fetchPortfolio(ctx.userId, currency);
    try {
      return {
        text: formatPortfolioPage(
          data,
          page,
          ctx.platform === "discord" ? 2_000 : 4_096
        ),
      };
    } catch (error) {
      if (error instanceof InvalidPortfolioPageError) {
        return { text: `❌ ${error.message}` };
      }
      throw error;
    }
  },
};

/** Alias — Discord uses `/report` for the same thing. */
export const reportHandler: CommandHandler = {
  ...portfolioHandler,
  name: "report",
  description: "Get your portfolio report in your preferred currency",
};
