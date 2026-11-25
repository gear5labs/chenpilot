import {
  QuoteExpiredError,
  QuoteDriftError,
} from "./errors";
import {
  generateQuoteDigest,
  validateQuoteCommitment,
  type QuoteCommitmentPayload,
} from "./quoteCommitment";

export const QUOTE_DEFAULT_EXPIRY_SECONDS = {
  SIMPLE_SWAP: 30,
  MULTI_HOP: 120,
};

export interface QuoteExpiryPolicy {
  deadline: number;
  maxExpirySeconds: number;
  minExpirySeconds: number;
  graceSeconds: number;
}

export interface QuoteExpiryCheck {
  isValid: boolean;
  isWithinGrace: boolean;
  secondsRemaining: number;
  requiresRefresh: boolean;
  recommendedDeadline?: number;
}

export function buildQuoteExpiryPolicy(
  routeType: "simple_swap" | "multi_hop",
  customExpirySeconds?: number,
  graceSeconds: number = 5,
): QuoteExpiryPolicy {
  const defaultExpiry =
    QUOTE_DEFAULT_EXPIRY_SECONDS[
      routeType === "multi_hop" ? "MULTI_HOP" : "SIMPLE_SWAP"
    ];
  const expirySeconds = customExpirySeconds ?? defaultExpiry;
  const nowSec = Math.floor(Date.now() / 1000);

  return {
    deadline: nowSec + expirySeconds,
    maxExpirySeconds: routeType === "multi_hop" ? 300 : 60,
    minExpirySeconds: 10,
    graceSeconds,
  };
}

export function checkQuoteExpiry(
  payload: QuoteCommitmentPayload,
  policy: QuoteExpiryPolicy,
): QuoteExpiryCheck {
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsRemaining = payload.deadline - nowSec;
  const isExpired = secondsRemaining <= 0;
  const isWithinGrace = isExpired && secondsRemaining >= -policy.graceSeconds;
  const isValid = !isExpired || isWithinGrace;

  return {
    isValid,
    isWithinGrace,
    secondsRemaining,
    requiresRefresh: !isValid,
    recommendedDeadline: isValid
      ? undefined
      : nowSec + policy.maxExpirySeconds,
  };
}

export function validateQuoteBeforeSigning(
  approvedDigest: string,
  livePayload: QuoteCommitmentPayload,
  policy: QuoteExpiryPolicy,
): void {
  const expiryCheck = checkQuoteExpiry(livePayload, policy);

  if (!expiryCheck.isValid) {
    throw new QuoteExpiredError(livePayload.deadline);
  }

  validateQuoteCommitment(approvedDigest, livePayload);
}

export interface QuoteRefreshHandler {
  requestFreshQuote: (
    previousPayload: QuoteCommitmentPayload,
  ) => Promise<QuoteCommitmentPayload | null>;
}

export async function refreshQuote(
  payload: QuoteCommitmentPayload,
  policy: QuoteExpiryPolicy,
  handler: QuoteRefreshHandler,
): Promise<QuoteRefreshResult> {
  const expiryCheck = checkQuoteExpiry(payload, policy);

  if (expiryCheck.isValid) {
    return {
      refreshed: false,
      reason: "Quote is still valid; no refresh needed",
    };
  }

  if (!expiryCheck.isWithinGrace && expiryCheck.requiresRefresh) {
    return {
      refreshed: false,
      reason: "Quote expired and outside grace period; refresh required",
    };
  }

  try {
    const freshPayload = await handler.requestFreshQuote(payload);

    if (!freshPayload) {
      return {
        refreshed: false,
        reason: "Refresh handler returned no new quote",
      };
    }

    const freshDigest = generateQuoteDigest(freshPayload);

    return {
      refreshed: true,
      payload: freshPayload,
      digest: freshDigest,
      deadline: freshPayload.deadline,
    };
  } catch (err) {
    return {
      refreshed: false,
      reason: `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface QuoteRefreshResult {
  refreshed: boolean;
  payload?: QuoteCommitmentPayload;
  digest?: string;
  deadline?: number;
  reason?: string;
}