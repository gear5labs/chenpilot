/**
 * Memo operations for the unified advanced operations package.
 *
 * Consolidates the overlapping helpers that previously lived in `memos.ts`
 * (hex-string validation and buffer building) and `memoUtils.ts` (Stellar
 * `Memo` construction and comparison) behind a single descriptor-based API
 * that covers all five memo variants rather than only `hash` and `return`.
 *
 * Both legacy modules remain exported for backwards compatibility; this
 * module is the recommended entry point for new code.
 */

import {
  AdvancedOperationKind,
  type MemoKind,
  type MemoOperation,
  type MemoParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import {
  MAX_MEMO_TEXT_BYTES,
  error,
  isHex32,
  isUint64,
  mergeReports,
  toReport,
  utf8ByteLength,
} from "./validation";

const MEMO_KINDS: readonly MemoKind[] = [
  "none",
  "text",
  "id",
  "hash",
  "return",
];

// ─── Destination memo requirements ───────────────────────────────────────────

/**
 * A destination's memo requirement.
 *
 * Memo syntax and encoding already existed (see {@link validateMemoParams});
 * what was missing was a place to record *which destinations demand a memo*
 * and a check that runs before a transaction is handed to a signer.
 */
export interface DestinationMemoRequirement {
  /** Destination account (`G...`) or muxed account (`M...`) the rule applies to. */
  destination: string;
  /** True when the destination rejects payments that arrive without a memo. */
  required: boolean;
  /**
   * Optional allow-list of memo kinds the destination accepts. Defaults to
   * "any memo other than `none`" when omitted.
   */
  memoKinds?: MemoKind[];
  /** Human-readable label for the destination (e.g. an exchange name). */
  label?: string;
  /** Where the requirement came from, carried through for auditing. */
  source?: string;
}

/** A destination plus the memo a transaction intends to send to it. */
export interface DestinationMemoCheck {
  /** Destination to look the requirement up for. Unknown destinations pass. */
  destination?: string | null;
  /** Memo attached to the transaction, if any. */
  memo?: MemoParams | null;
}

/** The subset of a Stellar transaction the memo-requirement check needs. */
export interface StellarTransactionMemoShape {
  operations?: Array<Record<string, unknown>> | null;
  memo?: { type?: string; value?: string | number | null } | null;
}

/** Thrown when a destination's memo requirement is not satisfied. */
export class DestinationMemoRequirementError extends Error {
  /** The structured findings that caused the failure. */
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "DestinationMemoRequirementError";
    this.issues = issues;
  }
}

/**
 * Registry backing the destination memo-required lookup.
 *
 * Requirements are supplied by the caller (an exchange directory, an
 * account-data feed, or a hand-maintained policy list) because nothing on
 * chain advertises them. The registry is empty by default, so enforcement is
 * a no-op until a requirement is registered.
 */
const destinationMemoRequirements = new Map<string, DestinationMemoRequirement>();

/** Normalizes a destination for registry lookups. */
function normalizeDestination(destination: string): string {
  return destination.trim();
}

/**
 * Register (or replace) a destination's memo requirement.
 *
 * @throws {DestinationMemoRequirementError} when the destination is missing or
 * `memoKinds` is supplied but contains no valid memo kind.
 */
export function registerDestinationMemoRequirement(
  requirement: DestinationMemoRequirement
): DestinationMemoRequirement {
  if (!requirement || typeof requirement.destination !== "string") {
    throw new DestinationMemoRequirementError(
      "A destination is required to register a memo requirement"
    );
  }

  const destination = normalizeDestination(requirement.destination);
  if (destination.length === 0) {
    throw new DestinationMemoRequirementError(
      "A destination is required to register a memo requirement"
    );
  }

  let memoKinds: MemoKind[] | undefined;
  if (requirement.memoKinds !== undefined) {
    if (!Array.isArray(requirement.memoKinds) || requirement.memoKinds.length === 0) {
      throw new DestinationMemoRequirementError(
        `Destination ${destination}: memoKinds must list at least one memo kind`
      );
    }
    const unknown = requirement.memoKinds.filter(
      (kind) => !MEMO_KINDS.includes(kind) || kind === "none"
    );
    if (unknown.length > 0) {
      throw new DestinationMemoRequirementError(
        `Destination ${destination}: unknown memo kind(s) ${unknown.join(", ")}`
      );
    }
    memoKinds = [...requirement.memoKinds];
  }

  const stored: DestinationMemoRequirement = {
    ...requirement,
    destination,
    required: Boolean(requirement.required),
    ...(memoKinds ? { memoKinds } : {}),
  };
  destinationMemoRequirements.set(destination, stored);
  return { ...stored, ...(memoKinds ? { memoKinds: [...memoKinds] } : {}) };
}

/** Register several requirements at once. */
export function registerDestinationMemoRequirements(
  requirements: DestinationMemoRequirement[]
): DestinationMemoRequirement[] {
  return requirements.map(registerDestinationMemoRequirement);
}

/**
 * Look up whether a destination requires a memo.
 *
 * Returns `undefined` for unknown destinations and for callers that never
 * registered a requirement, which is what keeps existing flows untouched.
 */
export function getDestinationMemoRequirement(
  destination?: string | null
): DestinationMemoRequirement | undefined {
  if (typeof destination !== "string") return undefined;
  const requirement = destinationMemoRequirements.get(normalizeDestination(destination));
  return requirement ? { ...requirement } : undefined;
}

/** Remove a destination's requirement. Returns false when nothing was stored. */
export function unregisterDestinationMemoRequirement(destination: string): boolean {
  return destinationMemoRequirements.delete(normalizeDestination(destination));
}

/** Drop every registered requirement (used by tests and config reloads). */
export function clearDestinationMemoRequirements(): void {
  destinationMemoRequirements.clear();
}

/** Snapshot of every registered requirement. */
export function listDestinationMemoRequirements(): DestinationMemoRequirement[] {
  return [...destinationMemoRequirements.values()].map((requirement) => ({
    ...requirement,
    ...(requirement.memoKinds ? { memoKinds: [...requirement.memoKinds] } : {}),
  }));
}

/** True when `memo` carries content a destination could route on. */
function memoCarriesValue(memo: MemoParams | null | undefined): boolean {
  return Boolean(memo && memo.kind && memo.kind !== "none");
}

/**
 * Check a destination/memo pair against the registered requirement.
 *
 * Unknown destinations produce a valid report, so this is safe to call on
 * every transaction path.
 */
export function checkDestinationMemoRequirement(
  check: DestinationMemoCheck
): ValidationReport {
  const requirement = getDestinationMemoRequirement(check?.destination);
  if (!requirement || !requirement.required) {
    return toReport([]);
  }

  const label = requirement.label ? ` (${requirement.label})` : "";
  const issues: ValidationIssue[] = [];
  const memo = check.memo ?? null;

  if (!memoCarriesValue(memo)) {
    issues.push(
      error(
        "memo",
        "DESTINATION_MEMO_REQUIRED",
        `Destination ${requirement.destination}${label} requires a memo before this transaction can be signed`
      )
    );
    return toReport(issues);
  }

  const accepted = requirement.memoKinds;
  if (accepted && accepted.length > 0 && memo && !accepted.includes(memo.kind)) {
    issues.push(
      error(
        "memo",
        "MEMO_KIND_NOT_ACCEPTED",
        `Destination ${requirement.destination}${label} only accepts ${accepted.join(
          ", "
        )} memos (got '${memo.kind}')`
      )
    );
  }

  return toReport(issues);
}

/**
 * Throwing form of {@link checkDestinationMemoRequirement}.
 *
 * @throws {DestinationMemoRequirementError} when the requirement is unmet.
 */
export function assertDestinationMemoRequirement(check: DestinationMemoCheck): void {
  const report = checkDestinationMemoRequirement(check);
  if (!report.valid) {
    throw new DestinationMemoRequirementError(
      report.errors.map((issue) => issue.message).join("; "),
      report.errors
    );
  }
}

/** Convert a transaction memo header into memo params. */
function memoParamsFromTransactionMemo(
  memo: StellarTransactionMemoShape["memo"]
): MemoParams | null {
  if (!memo || typeof memo.type !== "string") return null;
  const kind = memo.type as MemoKind;
  if (!MEMO_KINDS.includes(kind)) return null;
  if (kind === "none") return { kind: "none" };
  return { kind, value: memo.value ?? undefined };
}

/** Destinations named by operations a memo can be required for. */
function destinationsOf(tx: StellarTransactionMemoShape): string[] {
  const destinations = new Set<string>();
  for (const operation of tx?.operations ?? []) {
    if (!operation || typeof operation !== "object") continue;
    const destination = (operation as { destination?: unknown }).destination;
    if (typeof destination === "string" && destination.trim().length > 0) {
      destinations.add(destination.trim());
    }
  }
  return [...destinations];
}

/**
 * Build the destination/memo checks a transaction must satisfy.
 *
 * One check per distinct destination named by its operations, all sharing the
 * single transaction memo (a Stellar transaction carries at most one).
 */
export function destinationMemoChecksForTransaction(
  tx: StellarTransactionMemoShape
): DestinationMemoCheck[] {
  if (!tx || typeof tx !== "object") return [];
  const memo = memoParamsFromTransactionMemo(tx.memo);
  return destinationsOf(tx).map((destination) => ({ destination, memo }));
}

/**
 * Enforce every destination memo requirement a transaction implicates.
 *
 * Call this immediately before handing a transaction to a signer: it is the
 * last gate where a missing memo can still be fixed without a signature.
 * Destinations without a registered requirement are passed through untouched.
 *
 * @throws {DestinationMemoRequirementError} listing every unmet requirement.
 */
export function enforceDestinationMemoRequirements(
  tx: StellarTransactionMemoShape
): void {
  const report = mergeReports(
    destinationMemoChecksForTransaction(tx).map(checkDestinationMemoRequirement)
  );
  if (!report.valid) {
    throw new DestinationMemoRequirementError(
      report.errors.map((issue) => issue.message).join("; "),
      report.errors
    );
  }
}

/** Build a `MEMO_NONE` descriptor. */
export function noMemo(metadata?: Record<string, unknown>): MemoOperation {
  return { kind: AdvancedOperationKind.MEMO_ATTACH, params: { kind: "none" }, metadata };
}

/** Build a `MEMO_TEXT` descriptor. */
export function textMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "text", value },
    metadata,
  };
}

/** Build a `MEMO_ID` descriptor. */
export function idMemo(
  value: string | number | bigint,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "id", value },
    metadata,
  };
}

/** Build a `MEMO_HASH` descriptor from a 64-character hex string. */
export function hashMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "hash", value },
    metadata,
  };
}

/** Build a `MEMO_RETURN` descriptor from a 64-character hex string. */
export function returnMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "return", value },
    metadata,
  };
}

/**
 * Validate memo parameters.
 *
 * Applies the same rules the Stellar protocol enforces, so a memo that passes
 * here will not be rejected at transaction build time for shape reasons.
 */
export function validateMemoParams(params: MemoParams): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([error("", "MISSING_PARAMS", "Memo parameters are required")]);
  }

  if (!MEMO_KINDS.includes(params.kind)) {
    return toReport([
      error(
        "kind",
        "INVALID_MEMO_KIND",
        `Memo kind must be one of: ${MEMO_KINDS.join(", ")}`
      ),
    ]);
  }

  if (params.kind === "none") {
    if (params.value !== undefined) {
      issues.push(
        error("value", "UNEXPECTED_VALUE", "A 'none' memo must not carry a value")
      );
    }
    return toReport(issues);
  }

  if (params.value === undefined || params.value === null) {
    return toReport([
      error("value", "MISSING_VALUE", `A '${params.kind}' memo requires a value`),
    ]);
  }

  switch (params.kind) {
    case "text": {
      if (typeof params.value !== "string") {
        issues.push(
          error("value", "INVALID_MEMO_TEXT", "A 'text' memo value must be a string")
        );
        break;
      }
      const bytes = utf8ByteLength(params.value);
      if (bytes > MAX_MEMO_TEXT_BYTES) {
        issues.push(
          error(
            "value",
            "MEMO_TEXT_TOO_LONG",
            `A 'text' memo must be at most ${MAX_MEMO_TEXT_BYTES} bytes (got ${bytes})`
          )
        );
      }
      break;
    }
    case "id": {
      if (!isUint64(params.value)) {
        issues.push(
          error(
            "value",
            "INVALID_MEMO_ID",
            "An 'id' memo must be an unsigned 64-bit integer"
          )
        );
      }
      break;
    }
    case "hash":
    case "return": {
      if (!isHex32(params.value)) {
        issues.push(
          error(
            "value",
            "INVALID_MEMO_HASH",
            `A '${params.kind}' memo must be a 64-character hex string (32 bytes)`
          )
        );
      }
      break;
    }
  }

  return toReport(issues);
}

/**
 * Normalize memo parameters into their canonical wire form.
 *
 * Hex values are lower-cased and `id` values become decimal strings so that
 * two logically identical memos always compare equal.
 *
 * @throws {Error} when `params` fail {@link validateMemoParams}.
 */
export function normalizeMemoParams(params: MemoParams): Record<string, unknown> {
  const report = validateMemoParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid memo: ${report.errors.map((issue) => issue.message).join("; ")}`
    );
  }

  switch (params.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", value: params.value as string };
    case "id":
      return { kind: "id", value: BigInt(params.value as string | number).toString() };
    case "hash":
    case "return":
      return { kind: params.kind, value: (params.value as string).toLowerCase() };
  }
}

/**
 * Decode a 32-byte hex memo value into a `Buffer`.
 *
 * Replaces the near-identical `buildMemoHash` and `buildMemoReturn` helpers
 * from `memos.ts` with a single implementation.
 */
export function memoValueToBuffer(value: string): Buffer {
  if (!isHex32(value)) {
    throw new Error(
      "Invalid memo value: must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(value, "hex");
}

/** One-line human-readable description, used in plan summaries and reviews. */
export function describeMemo(params: MemoParams): string {
  if (params.kind === "none") return "No memo";
  if (params.kind === "text") return `Text memo "${String(params.value)}"`;
  if (params.kind === "id") return `Id memo ${String(params.value)}`;
  const value = String(params.value ?? "");
  const preview = value.length > 16 ? `${value.slice(0, 16)}…` : value;
  return `${params.kind === "hash" ? "Hash" : "Return"} memo ${preview}`;
}
