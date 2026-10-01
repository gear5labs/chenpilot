/**
 * Shared types for the unified advanced Stellar operations package.
 *
 * Memo, trustline and claimable-balance helpers historically lived in
 * unrelated modules, each with its own notion of "is this input valid" and
 * its own result shape. This module defines the single vocabulary all three
 * families now share so callers can validate, inspect and compose them
 * through one consistent surface.
 */

/** Every advanced operation the package knows how to describe. */
export enum AdvancedOperationKind {
  MEMO_ATTACH = "memo.attach",
  TRUSTLINE_CREATE = "trustline.create",
  TRUSTLINE_UPDATE = "trustline.update",
  TRUSTLINE_REMOVE = "trustline.remove",
  CLAIMABLE_BALANCE_CREATE = "claimableBalance.create",
  CLAIMABLE_BALANCE_CLAIM = "claimableBalance.claim",
}

/** Operation families, used for grouping and policy decisions. */
export enum AdvancedOperationFamily {
  MEMO = "memo",
  TRUSTLINE = "trustline",
  CLAIMABLE_BALANCE = "claimableBalance",
}

/** Severity of a single validation finding. */
export type ValidationSeverity = "error" | "warning";

/**
 * A single validation finding. Structured rather than a bare string so
 * callers can react programmatically instead of parsing messages.
 */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `params.assetIssuer`. */
  field: string;
  /** Machine-readable code, e.g. `INVALID_ACCOUNT_ID`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** Whether this blocks composition or is merely advisory. */
  severity: ValidationSeverity;
}

/** Aggregated result of validating one or more operations. */
export interface ValidationReport {
  /** True when no `error`-severity issues were found. */
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ─── Memo ─────────────────────────────────────────────────────────────────────

/** Memo variants supported by the Stellar protocol. */
export type MemoKind = "none" | "text" | "id" | "hash" | "return";

export interface MemoParams {
  kind: MemoKind;
  /**
   * Raw memo value. Interpretation depends on `kind`:
   *  - `text`   → UTF-8 string, at most 28 bytes
   *  - `id`     → unsigned 64-bit integer, as a decimal string or number
   *  - `hash`   → 32-byte value, as a 64-character hex string
   *  - `return` → 32-byte value, as a 64-character hex string
   *  - `none`   → omitted
   */
  value?: string | number | bigint;
}

// ─── Trustline ────────────────────────────────────────────────────────────────

export interface TrustlineParams {
  /** Asset code, 1–12 alphanumeric characters. */
  assetCode: string;
  /** Issuing account (`G...`). */
  assetIssuer: string;
  /**
   * Trust limit as a decimal string. Omit for the protocol maximum.
   * Must be `"0"` for `TRUSTLINE_REMOVE`.
   */
  limit?: string;
  /** Account that will hold the trustline (`G...`). */
  account?: string;
}

// ─── Claimable balance ────────────────────────────────────────────────────────

export interface ClaimableBalanceCreateParams {
  /** Asset code, or `"XLM"` for the native asset. */
  assetCode: string;
  /** Issuing account. Omitted or empty for the native asset. */
  assetIssuer?: string;
  /** Amount as a positive decimal string. */
  amount: string;
  /** Accounts allowed to claim the balance. At least one is required. */
  claimants: string[];
}

export interface ClaimableBalanceClaimParams {
  /** Balance identifier, a 72-character hex string. */
  balanceId: string;
  /** Claiming account (`G...`). */
  claimant: string;
}

/**
 * A claimant predicate in the JSON form Horizon returns.
 *
 * Every arm is optional; an empty object is the unconditional predicate.
 * Both Horizon's snake_case spellings (`abs_before`/`rel_before`) and the XDR
 * arm names (`absTime`/`relTime`) are accepted.
 */
export interface ClaimPredicate {
  and?: ClaimPredicate[];
  or?: ClaimPredicate[];
  not?: ClaimPredicate;
  /** Claimable strictly before this unix time. */
  abs_before?: string | number;
  /** Claimable strictly before this many seconds after the balance was created. */
  rel_before?: string | number;
  /** XDR arm spelling of {@link abs_before}. */
  absTime?: string | number;
  /** XDR arm spelling of {@link rel_before}. */
  relTime?: string | number;
}

/** The ledger context a claim predicate is evaluated against. */
export interface ClaimPredicateContext {
  /**
   * Ledger close time in seconds since the unix epoch — the time the claim
   * would be evaluated at.
   */
  ledgerTime: number;
  /**
   * Seconds since the unix epoch the claimable balance was created (its last
   * modified ledger close time). Required by relative-time predicates.
   */
  startTime?: number;
}

/** Inputs to {@link explainClaimEligibility}. */
export interface ExplainClaimEligibilityParams {
  /** Claimant account to explain eligibility for (`G...`). */
  claimant: string;
  /** Claimants carried by the balance, with the predicate each one has. */
  claimants: Array<{ destination: string; predicate: unknown }>;
  /** Ledger close time, in unix seconds, to evaluate the predicates at. */
  ledgerTime: number;
  /**
   * Seconds since the unix epoch the balance was created (Horizon's
   * `last_modified_time`). Required by relative-time predicates.
   */
  startTime?: number;
}

/** Whether, why and until when a claimant may claim a balance. */
export interface ClaimEligibility {
  /** Claimant the explanation describes. */
  claimant: string;
  /** True when the predicate is satisfied at {@link ledgerTime}. */
  eligible: boolean;
  /**
   * False when the predicate could not be evaluated (missing balance creation
   * time, malformed time value, or a non-finite ledger time). Treat an
   * unevaluated result as unknown rather than as "not eligible".
   */
  evaluated: boolean;
  /** Ledger close time the verdict was computed at, in unix seconds. */
  ledgerTime: number;
  /** {@link ledgerTime} rendered as an ISO timestamp. */
  ledgerTimeIso: string;
  /** Human-readable rendering of the claimant's predicate. */
  predicate: string;
  /** Full explanation, safe to surface to a user. */
  reason: string;
  /** ISO time the next claim window opens, when it opens in the future. */
  claimableAt?: string;
  /** ISO time the applicable claim window closes, when it has a finite end. */
  claimExpiresAt?: string;
}

// ─── Descriptors ──────────────────────────────────────────────────────────────

interface BaseDescriptor<K extends AdvancedOperationKind, P> {
  kind: K;
  params: P;
  /** Free-form annotations carried through composition untouched. */
  metadata?: Record<string, unknown>;
}

export type MemoOperation = BaseDescriptor<
  AdvancedOperationKind.MEMO_ATTACH,
  MemoParams
>;

export type TrustlineOperation = BaseDescriptor<
  | AdvancedOperationKind.TRUSTLINE_CREATE
  | AdvancedOperationKind.TRUSTLINE_UPDATE
  | AdvancedOperationKind.TRUSTLINE_REMOVE,
  TrustlineParams
>;

export type ClaimableBalanceCreateOperation = BaseDescriptor<
  AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE,
  ClaimableBalanceCreateParams
>;

export type ClaimableBalanceClaimOperation = BaseDescriptor<
  AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM,
  ClaimableBalanceClaimParams
>;

/** Any operation the package can validate and compose. */
export type AdvancedOperation =
  | MemoOperation
  | TrustlineOperation
  | ClaimableBalanceCreateOperation
  | ClaimableBalanceClaimOperation;

// ─── Composition output ───────────────────────────────────────────────────────

/**
 * A validated, normalized operation ready to be handed to a transaction
 * builder. Normalization is deliberately separated from building so the
 * package stays free of network and SDK construction concerns.
 */
export interface NormalizedOperation {
  kind: AdvancedOperationKind;
  family: AdvancedOperationFamily;
  /** Params after trimming, case normalization and defaulting. */
  params: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** The result of composing a set of advanced operations. */
export interface OperationPlan {
  /** Operations in submission order, excluding the memo. */
  operations: NormalizedOperation[];
  /** At most one memo applies to a Stellar transaction. */
  memo?: NormalizedOperation;
  /**
   * Destination the plan was composed for, when one was declared. The memo
   * requirement of this destination was enforced during validation.
   */
  destination?: string;
  /** Combined validation report across every supplied operation. */
  validation: ValidationReport;
  /** Human-readable one-line summaries, in order. */
  summary: string[];
}
