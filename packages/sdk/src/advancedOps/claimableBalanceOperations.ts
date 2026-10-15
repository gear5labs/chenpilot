/**
 * Claimable balance operations for the unified advanced operations package.
 *
 * `claimableBalance.ts` covers searching and claiming against Horizon but
 * performs almost no input validation. This module adds the descriptor,
 * validation and normalization layer used by the composer and by the offline
 * signing pipeline, matching the treatment memos and trustlines receive.
 */

import {
  AdvancedOperationKind,
  type ClaimEligibility,
  type ClaimableBalanceClaimOperation,
  type ClaimableBalanceClaimParams,
  type ClaimableBalanceCreateOperation,
  type ClaimableBalanceCreateParams,
  type ClaimPredicate,
  type ClaimPredicateContext,
  type ExplainClaimEligibilityParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import {
  error,
  isAccountId,
  isAssetCode,
  isBalanceId,
  isPositiveAmount,
  toReport,
  warning,
} from "./validation";

const NATIVE_ASSET_CODE = "XLM";

/** Build a descriptor that creates a claimable balance. */
export function createClaimableBalance(
  params: ClaimableBalanceCreateParams,
  metadata?: Record<string, unknown>
): ClaimableBalanceCreateOperation {
  return {
    kind: AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE,
    params,
    metadata,
  };
}

/** Build a descriptor that claims an existing claimable balance. */
export function claimBalance(
  params: ClaimableBalanceClaimParams,
  metadata?: Record<string, unknown>
): ClaimableBalanceClaimOperation {
  return {
    kind: AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM,
    params,
    metadata,
  };
}

/** True when the asset described by `code`/`issuer` is native XLM. */
export function isNativeAsset(code: string, issuer?: string): boolean {
  return code.toUpperCase() === NATIVE_ASSET_CODE && !issuer;
}

/** Validate the parameters of a claimable balance creation. */
export function validateClaimableBalanceCreateParams(
  params: ClaimableBalanceCreateParams
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([
      error("", "MISSING_PARAMS", "Claimable balance parameters are required"),
    ]);
  }

  if (!isAssetCode(params.assetCode)) {
    issues.push(
      error(
        "assetCode",
        "INVALID_ASSET_CODE",
        "Asset code must be 1–12 alphanumeric characters"
      )
    );
  } else if (!isNativeAsset(params.assetCode, params.assetIssuer)) {
    if (!isAccountId(params.assetIssuer)) {
      issues.push(
        error(
          "assetIssuer",
          "INVALID_ACCOUNT_ID",
          "A non-native asset requires a valid issuer account id (G...)"
        )
      );
    }
  } else if (params.assetIssuer) {
    issues.push(
      error(
        "assetIssuer",
        "NATIVE_ASSET_HAS_ISSUER",
        "The native asset (XLM) must not specify an issuer"
      )
    );
  }

  if (!isPositiveAmount(params.amount)) {
    issues.push(
      error(
        "amount",
        "INVALID_AMOUNT",
        "Amount must be a positive decimal with at most 7 decimal places"
      )
    );
  }

  if (!Array.isArray(params.claimants) || params.claimants.length === 0) {
    issues.push(
      error(
        "claimants",
        "MISSING_CLAIMANTS",
        "At least one claimant is required"
      )
    );
  } else {
    params.claimants.forEach((claimant, index) => {
      if (!isAccountId(claimant)) {
        issues.push(
          error(
            `claimants[${index}]`,
            "INVALID_ACCOUNT_ID",
            "Claimant must be a valid Stellar account id (G...)"
          )
        );
      }
    });

    const unique = new Set(params.claimants);
    if (unique.size !== params.claimants.length) {
      issues.push(
        warning(
          "claimants",
          "DUPLICATE_CLAIMANTS",
          "Duplicate claimants were supplied; only the first predicate applies"
        )
      );
    }
  }

  return toReport(issues);
}

/** Validate the parameters of a claimable balance claim. */
export function validateClaimableBalanceClaimParams(
  params: ClaimableBalanceClaimParams
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([
      error("", "MISSING_PARAMS", "Claimable balance parameters are required"),
    ]);
  }

  if (!isBalanceId(params.balanceId)) {
    issues.push(
      error(
        "balanceId",
        "INVALID_BALANCE_ID",
        "Balance id must be a 72-character hex string"
      )
    );
  }

  if (!isAccountId(params.claimant)) {
    issues.push(
      error(
        "claimant",
        "INVALID_ACCOUNT_ID",
        "Claimant must be a valid Stellar account id (G...)"
      )
    );
  }

  return toReport(issues);
}

/**
 * Normalize claimable balance creation parameters.
 *
 * @throws {Error} when `params` fail validation.
 */
export function normalizeClaimableBalanceCreateParams(
  params: ClaimableBalanceCreateParams
): Record<string, unknown> {
  const report = validateClaimableBalanceCreateParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid claimable balance: ${report.errors
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  const native = isNativeAsset(params.assetCode, params.assetIssuer);
  return {
    assetCode: native ? NATIVE_ASSET_CODE : params.assetCode.trim(),
    ...(native ? {} : { assetIssuer: (params.assetIssuer ?? "").trim() }),
    native,
    amount: params.amount.trim(),
    claimants: [...new Set(params.claimants.map((c) => c.trim()))],
  };
}

/**
 * Normalize claimable balance claim parameters.
 *
 * @throws {Error} when `params` fail validation.
 */
export function normalizeClaimableBalanceClaimParams(
  params: ClaimableBalanceClaimParams
): Record<string, unknown> {
  const report = validateClaimableBalanceClaimParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid claimable balance claim: ${report.errors
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return {
    balanceId: params.balanceId.toLowerCase(),
    claimant: params.claimant.trim(),
  };
}

/** One-line human-readable description of a claimable balance creation. */
export function describeClaimableBalanceCreate(
  params: ClaimableBalanceCreateParams
): string {
  const asset = isNativeAsset(params.assetCode, params.assetIssuer)
    ? NATIVE_ASSET_CODE
    : `${params.assetCode}:${params.assetIssuer}`;
  const count = Array.isArray(params.claimants) ? params.claimants.length : 0;
  return `Create claimable balance of ${params.amount} ${asset} for ${count} claimant(s)`;
}

/** One-line human-readable description of a claimable balance claim. */
export function describeClaimableBalanceClaim(
  params: ClaimableBalanceClaimParams
): string {
  const preview = (params.balanceId ?? "").slice(0, 16);
  return `Claim balance ${preview}… as ${params.claimant}`;
}

// ─── Claim eligibility ───────────────────────────────────────────────────────

/**
 * A span of ledger times `[from, to)` during which a predicate is satisfied.
 *
 * Predicates are modelled as unions of disjoint intervals so that `and`, `or`
 * and `not` can all be composed exactly rather than approximated. Infinity is
 * used for open ends: a plain `abs_before`/`rel_before` predicate is satisfied
 * from the beginning of time until its cut-off, and only negating it (the
 * usual "claim after X" idiom) produces a finite opening.
 */
interface ClaimWindow {
  from: number;
  to: number;
}

const START_OF_TIME = Number.NEGATIVE_INFINITY;
const END_OF_TIME = Number.POSITIVE_INFINITY;

/** Sort and merge overlapping/adjacent windows into a disjoint set. */
function normalizeWindows(windows: ClaimWindow[]): ClaimWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.from - b.from);
  const merged: ClaimWindow[] = [{ ...sorted[0] }];
  for (const window of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (window.from <= last.to) {
      if (window.to > last.to) last.to = window.to;
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** Intersection of two disjoint window sets. */
function intersectWindows(a: ClaimWindow[], b: ClaimWindow[]): ClaimWindow[] {
  const out: ClaimWindow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].from, b[j].from);
    const to = Math.min(a[i].to, b[j].to);
    if (from < to) out.push({ from, to });
    if (a[i].to < b[j].to) i += 1;
    else j += 1;
  }
  return out;
}

/** Complement of a disjoint window set (everything outside it). */
function complementWindows(a: ClaimWindow[]): ClaimWindow[] {
  const out: ClaimWindow[] = [];
  let cursor = START_OF_TIME;
  for (const window of a) {
    if (window.from > cursor) out.push({ from: cursor, to: window.from });
    cursor = Math.max(cursor, window.to);
  }
  if (cursor < END_OF_TIME) out.push({ from: cursor, to: END_OF_TIME });
  return out;
}

function windowsContain(windows: ClaimWindow[], time: number): boolean {
  return windows.some((window) => time >= window.from && time < window.to);
}

/** Parse a predicate time value; null when it is absent or not a number. */
function toPredicateTime(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Render a unix timestamp as ISO-8601, falling back to the raw seconds. */
function formatLedgerTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds);
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return `${seconds}s since epoch`;
  }
}

interface WindowResolution {
  /** The windows the predicate is satisfied in, or null when unevaluable. */
  windows: ClaimWindow[] | null;
  /** Why the predicate could not be evaluated; set only when windows is null. */
  problem?: string;
}

/** Resolve a predicate into the ledger times at which it is satisfied. */
function resolveClaimWindows(
  predicate: unknown,
  context: ClaimPredicateContext
): WindowResolution {
  if (predicate === null || predicate === undefined) {
    return { windows: [{ from: START_OF_TIME, to: END_OF_TIME }] };
  }

  if (typeof predicate !== "object" || Array.isArray(predicate)) {
    return {
      windows: null,
      problem: "the predicate is not a structured value",
    };
  }

  const claim = predicate as ClaimPredicate;

  if (Array.isArray(claim.and)) {
    let windows: ClaimWindow[] = [{ from: START_OF_TIME, to: END_OF_TIME }];
    for (const child of claim.and) {
      const resolved = resolveClaimWindows(child, context);
      if (!resolved.windows) return resolved;
      windows = intersectWindows(windows, resolved.windows);
    }
    return { windows };
  }

  if (Array.isArray(claim.or)) {
    let windows: ClaimWindow[] = [];
    for (const child of claim.or) {
      const resolved = resolveClaimWindows(child, context);
      if (!resolved.windows) return resolved;
      windows = windows.concat(resolved.windows);
    }
    return { windows: normalizeWindows(windows) };
  }

  if (claim.not !== undefined) {
    const resolved = resolveClaimWindows(claim.not, context);
    if (!resolved.windows) return resolved;
    return { windows: complementWindows(resolved.windows) };
  }

  const absolute =
    claim.abs_before !== undefined ? claim.abs_before : claim.absTime;
  if (absolute !== undefined) {
    const cutOff = toPredicateTime(absolute);
    if (cutOff === null) {
      return {
        windows: null,
        problem: "its absolute-time value is not a number",
      };
    }
    return { windows: [{ from: START_OF_TIME, to: cutOff }] };
  }

  const relative =
    claim.rel_before !== undefined ? claim.rel_before : claim.relTime;
  if (relative !== undefined) {
    const duration = toPredicateTime(relative);
    if (duration === null) {
      return {
        windows: null,
        problem: "its relative-time value is not a number",
      };
    }
    if (context.startTime === undefined || !Number.isFinite(context.startTime)) {
      return {
        windows: null,
        problem:
          "its relative-time predicate needs the balance's creation time, which was not supplied",
      };
    }
    return {
      windows: [{ from: START_OF_TIME, to: context.startTime + duration }],
    };
  }

  // No recognised arm: Horizon renders the unconditional predicate as `{}`.
  return { windows: [{ from: START_OF_TIME, to: END_OF_TIME }] };
}

/**
 * Render a claim predicate as a single human-readable line.
 *
 * @param context Ledger context, used to turn relative times into absolute
 * ones when the balance's creation time is known.
 */
export function describeClaimPredicate(
  predicate: unknown,
  context?: ClaimPredicateContext
): string {
  if (predicate === null || predicate === undefined) {
    return "unconditional (claimable at any time)";
  }

  if (typeof predicate !== "object" || Array.isArray(predicate)) {
    return "unrecognised predicate";
  }

  const claim = predicate as ClaimPredicate;
  const render = (child: unknown): string => {
    const description = describeClaimPredicate(child, context);
    const compound =
      child !== null &&
      typeof child === "object" &&
      (Array.isArray((child as ClaimPredicate).and) ||
        Array.isArray((child as ClaimPredicate).or));
    return compound ? `(${description})` : description;
  };

  if (Array.isArray(claim.and) && claim.and.length > 0) {
    return claim.and.map(render).join(" AND ");
  }

  if (Array.isArray(claim.or) && claim.or.length > 0) {
    return claim.or.map(render).join(" OR ");
  }

  if (claim.not !== undefined) {
    return `NOT (${describeClaimPredicate(claim.not, context)})`;
  }

  const absolute =
    claim.abs_before !== undefined ? claim.abs_before : claim.absTime;
  if (absolute !== undefined) {
    const cutOff = toPredicateTime(absolute);
    return cutOff === null
      ? "claimable before an unreadable absolute time"
      : `claimable before ${formatLedgerTime(cutOff)}`;
  }

  const relative =
    claim.rel_before !== undefined ? claim.rel_before : claim.relTime;
  if (relative !== undefined) {
    const duration = toPredicateTime(relative);
    if (duration === null) {
      return "claimable before an unreadable relative time";
    }
    if (context?.startTime !== undefined && Number.isFinite(context.startTime)) {
      return `claimable before ${formatLedgerTime(
        context.startTime + duration
      )} (${duration}s after the balance was created)`;
    }
    return `claimable within ${duration}s of the balance being created`;
  }

  return "unconditional (claimable at any time)";
}

/**
 * Evaluate a claim predicate against a ledger time.
 *
 * A predicate that cannot be evaluated (missing balance creation time or a
 * malformed time value) reports `false`; use {@link explainClaimEligibility}
 * when the difference between "not yet" and "unknown" matters.
 */
export function evaluateClaimPredicate(
  predicate: unknown,
  context: ClaimPredicateContext
): boolean {
  if (!context || !Number.isFinite(context.ledgerTime)) return false;
  const { windows } = resolveClaimWindows(predicate, context);
  return windows ? windowsContain(windows, context.ledgerTime) : false;
}

/**
 * Explain whether a claimant can claim a balance at a given ledger time.
 *
 * The explanation combines three things: the claimant's predicate, the ledger
 * close time the claim would land at, and — for relative-time predicates —
 * the time the balance was created. The verdict carries the times the claim
 * window opens and closes so a caller can say *why* a claim is unavailable
 * instead of letting the network reject it with an opaque error.
 */
export function explainClaimEligibility(
  params: ExplainClaimEligibilityParams
): ClaimEligibility {
  const claimant = params?.claimant ?? "";
  const ledgerTime = params?.ledgerTime;
  const startTime = params?.startTime;
  const ledgerTimeIso = Number.isFinite(ledgerTime)
    ? formatLedgerTime(ledgerTime)
    : String(ledgerTime);

  const match = (params?.claimants ?? []).find(
    (entry) => entry?.destination === claimant
  );

  if (!match) {
    return {
      claimant,
      eligible: false,
      evaluated: true,
      ledgerTime,
      ledgerTimeIso,
      predicate: "none",
      reason: `Account ${claimant} is not a claimant for this balance and cannot claim it as of ledger time ${ledgerTimeIso}.`,
    };
  }

  const context: ClaimPredicateContext = { ledgerTime, startTime };
  const predicate = describeClaimPredicate(match.predicate, context);

  if (!Number.isFinite(ledgerTime)) {
    return {
      claimant,
      eligible: false,
      evaluated: false,
      ledgerTime,
      ledgerTimeIso,
      predicate,
      reason: `Cannot evaluate claim eligibility: ledger time must be a finite number of seconds since epoch (got ${String(
        ledgerTime
      )}).`,
    };
  }

  const { windows, problem } = resolveClaimWindows(match.predicate, context);
  if (!windows) {
    return {
      claimant,
      eligible: false,
      evaluated: false,
      ledgerTime,
      ledgerTimeIso,
      predicate,
      reason: `Cannot evaluate claim eligibility for ${claimant} as of ledger time ${ledgerTimeIso}: ${problem}.`,
    };
  }

  const openWindow = windows.find(
    (window) => ledgerTime >= window.from && ledgerTime < window.to
  );

  if (openWindow) {
    const finiteEnd = Number.isFinite(openWindow.to);
    return {
      claimant,
      eligible: true,
      evaluated: true,
      ledgerTime,
      ledgerTimeIso,
      predicate,
      reason: finiteEnd
        ? `Claimable now: ledger time ${ledgerTimeIso} satisfies the claim predicate (${predicate}); the claim window closes at ${formatLedgerTime(
            openWindow.to
          )}.`
        : `Claimable now: ledger time ${ledgerTimeIso} satisfies the claim predicate (${predicate}).`,
      ...(finiteEnd ? { claimExpiresAt: formatLedgerTime(openWindow.to) } : {}),
    };
  }

  const nextWindow = windows
    .filter((window) => window.from > ledgerTime)
    .sort((a, b) => a.from - b.from)[0];
  if (nextWindow) {
    const claimableAt = formatLedgerTime(nextWindow.from);
    return {
      claimant,
      eligible: false,
      evaluated: true,
      ledgerTime,
      ledgerTimeIso,
      predicate,
      reason: `Not claimable yet as of ledger time ${ledgerTimeIso}: ${predicate}. The claim window opens at ${claimableAt}.`,
      claimableAt,
    };
  }

  const lastWindow = windows
    .filter((window) => Number.isFinite(window.to))
    .sort((a, b) => b.to - a.to)[0];
  if (lastWindow) {
    const claimExpiresAt = formatLedgerTime(lastWindow.to);
    return {
      claimant,
      eligible: false,
      evaluated: true,
      ledgerTime,
      ledgerTimeIso,
      predicate,
      reason: `Not claimable as of ledger time ${ledgerTimeIso}: ${predicate}. The claim window closed at ${claimExpiresAt}.`,
      claimExpiresAt,
    };
  }

  return {
    claimant,
    eligible: false,
    evaluated: true,
    ledgerTime,
    ledgerTimeIso,
    predicate,
    reason: `Not claimable as of ledger time ${ledgerTimeIso}: the claim predicate (${predicate}) is not satisfied.`,
  };
}
