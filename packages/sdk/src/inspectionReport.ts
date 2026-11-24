/**
 * Stable, typed transaction inspection & simulation report format (#571).
 *
 * External applications frequently want to render "what will this transaction
 * do, what will it cost, who needs to sign, and is anything risky?" before a
 * user approves it. This module defines a versioned, serializable report shape
 * and a pure builder that assembles it from simulation output, so any app can
 * render the result directly without re-deriving the format.
 *
 * ## Fee-estimate provenance and freshness
 *
 * Network congestion can change rapidly; an estimate that was valid at
 * simulation time may be dangerously stale by the time the user approves or the
 * transaction is submitted.  Every `InspectionFeeEstimate` therefore carries a
 * `provenance` block that records:
 *
 *   - `estimatedAt`     — the Unix ms timestamp when the estimate was computed.
 *   - `simulationLedger` — (optional) the ledger sequence the simulation ran
 *                          against, so callers can correlate the estimate with
 *                          the on-chain state it reflects.
 *   - `network`         — the Soroban/Horizon network the simulation targeted.
 *   - `source`          — `"simulation"` (live RPC call) | `"fallback"` (the
 *                          caller supplied no `minResourceFee` and the builder
 *                          fell back to the base fee alone).
 *
 * Use `isFeeEstimateStale(estimate, ttlMs)` to decide whether the estimate is
 * still usable before building or submitting a transaction.  The builder also
 * emits a `FEE_ESTIMATE_STALE` warning automatically when the caller passes a
 * `feeEstimateAge` that exceeds `feeEstimateTtlMs`.
 */

/** Report format version. Bump on breaking shape changes. */
export const INSPECTION_REPORT_VERSION = "1" as const;

/**
 * Default TTL for a fee estimate.  Stellar ledgers close every ~5 s and fee
 * statistics are recalculated each ledger; 60 s gives a comfortable window
 * while still catching stale estimates before they cause a failed submission.
 */
export const DEFAULT_FEE_ESTIMATE_TTL_MS = 60_000;

/**
 * Provenance metadata attached to every `InspectionFeeEstimate`.
 *
 * Serializes cleanly to JSON — no methods, no non-primitive values.
 */
export interface FeeEstimateProvenance {
  /**
   * Unix epoch ms when the fee estimate was computed.  Set by
   * `buildInspectionReport` via the same `now` clock that populates
   * `generatedAt`, so the two values are always consistent.
   */
  estimatedAt: number;
  /**
   * Ledger sequence the simulation ran against, when available.  Absent for
   * estimates that come from a failed simulation or a fallback path.
   */
  simulationLedger?: number;
  /**
   * Network the simulation targeted (`"testnet"` | `"mainnet"` | any string
   * accepted by the caller).  Defaults to `"unknown"` when the caller does not
   * supply one.
   */
  network: string;
  /**
   * How the fee values were derived:
   * - `"simulation"` — the RPC simulation returned a `minResourceFee`.
   * - `"fallback"`   — no `minResourceFee` was available; the estimate uses the
   *                    inclusion fee alone.  Such estimates are inherently less
   *                    precise for Soroban calls.
   */
  source: "simulation" | "fallback";
}

/** Overall verdict for a transaction. */
export type InspectionStatus = "ok" | "warning" | "error";

/** Severity of a single warning. */
export type WarningSeverity = "info" | "warning" | "critical";

/** A human- and machine-readable warning about the transaction. */
export interface InspectionWarning {
  /** Stable warning code, e.g. `FEE_BELOW_SIMULATED`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** How serious the warning is. */
  severity: WarningSeverity;
}

/**
 * Fee estimate, in stroops, expressed as decimal strings to stay exact.
 *
 * Every estimate now carries a `provenance` block so callers can determine
 * whether the estimate is still usable.  Use `isFeeEstimateStale()` or check
 * `provenance.estimatedAt` directly before building or submitting a
 * transaction.
 */
export interface InspectionFeeEstimate {
  /** Lowest fee likely to succeed. */
  min: string;
  /** Suggested fee. */
  recommended: string;
  /** Upper bound worth offering under contention. */
  max: string;
  /** Unit of the values above. */
  currency: "stroops";
  /**
   * Where and when this estimate came from.  Always present on estimates
   * produced by `buildInspectionReport`; may be absent on hand-crafted or
   * legacy objects, in which case treat the estimate as stale.
   */
  provenance: FeeEstimateProvenance;
}

/**
 * Returns `true` when the fee estimate is older than `ttlMs` milliseconds.
 *
 * Pass `now` to override the wall clock (useful in tests).
 *
 * When `estimate.provenance` is absent (legacy / hand-crafted object), the
 * estimate is treated as unconditionally stale to fail safely.
 *
 * @example
 * ```ts
 * if (isFeeEstimateStale(report.feeEstimate)) {
 *   // Re-simulate before submitting
 * }
 * ```
 */
export function isFeeEstimateStale(
  estimate: InspectionFeeEstimate,
  ttlMs: number = DEFAULT_FEE_ESTIMATE_TTL_MS,
  now: () => number = Date.now
): boolean {
  if (!estimate.provenance) return true; // missing provenance → always stale
  return now() - estimate.provenance.estimatedAt >= ttlMs;
}

/** A signer the transaction requires, with why it is needed. */
export interface SignerRequirement {
  /** Signer public key (`G...`) or signer identifier. */
  key: string;
  /** Signing weight this signer contributes, if known. */
  weight?: number;
  /** Why this signer is required (e.g. `source account`, `additional signer`). */
  reason?: string;
}

/** A single operation within the transaction. */
export interface OperationSummary {
  /** Zero-based index within the transaction. */
  index: number;
  /** Operation type, e.g. `payment`, `invokeHostFunction`. */
  type: string;
  /** Human-readable description of the operation. */
  description: string;
  /** Per-operation source account, when it differs from the tx source. */
  source?: string;
}

/** Resource usage reported by simulation (Soroban). */
export interface ResourceUsage {
  cpuInstructions?: number;
  memoryBytes?: number;
  readBytes?: number;
  writeBytes?: number;
}

/** Summary of the simulation result. */
export interface SimulationSummary {
  /** Whether simulation succeeded. */
  success: boolean;
  /** Decoded return value, when the simulation produced one. */
  returnValue?: unknown;
  /** Minimum resource fee (stroops) reported by simulation. */
  minResourceFee?: string;
  /** Resource usage, when reported. */
  resourceUsage?: ResourceUsage;
  /** Error code when simulation failed. */
  errorCode?: string;
  /** Error message when simulation failed. */
  errorMessage?: string;
}

/** High-level execution summary derived from the report. */
export interface ExecutionSummary {
  /** Whether the transaction is expected to succeed. */
  willLikelySucceed: boolean;
  /** Number of operations. */
  operationCount: number;
  /** Number of distinct required signers. */
  signerCount: number;
  /** Recommended fee (stroops). */
  recommendedFee: string;
  /** One-line summary suitable for a header/toast. */
  headline: string;
}

/** The full, serializable inspection report. */
export interface TransactionInspectionReport {
  /** {@link INSPECTION_REPORT_VERSION}. */
  version: typeof INSPECTION_REPORT_VERSION;
  /** Overall verdict. */
  status: InspectionStatus;
  /** Operations in the transaction. */
  operations: OperationSummary[];
  /** Simulation summary. */
  simulation: SimulationSummary;
  /** Fee estimate. */
  feeEstimate: InspectionFeeEstimate;
  /** Required signers. */
  signerRequirements: SignerRequirement[];
  /** Warnings surfaced during inspection. */
  warnings: InspectionWarning[];
  /** Derived execution summary. */
  executionSummary: ExecutionSummary;
  /** Unix epoch ms when the report was generated. */
  generatedAt: number;
}

/** Simulation output accepted by the builder (loosely typed on purpose). */
export interface SimulationInput {
  success: boolean;
  returnValue?: unknown;
  minResourceFee?: string | number;
  resourceUsage?: ResourceUsage;
  errorCode?: string;
  errorMessage?: string;
}

/** Inputs to {@link buildInspectionReport}. */
export interface InspectionInput {
  /**
   * Base64 operation XDRs to decode. Each is turned into an
   * {@link OperationSummary} via {@link InspectionInput.explainOperation} (or the
   * built-in `XdrDecoder`, loaded on demand).
   */
  operationXdrs?: string[];
  /** Pre-decoded operations (used as-is; takes precedence over `operationXdrs`). */
  operations?: OperationSummary[];
  /**
   * Renders a single operation XDR to a human-readable string. Injectable so the
   * builder stays decoupled from any specific decoder; defaults to the SDK's
   * `XdrDecoder.explainOperation`, which is loaded lazily only when needed.
   */
  explainOperation?: (operationXdr: string, index: number) => string;
  /** Simulation output. */
  simulation: SimulationInput;
  /** Per-operation inclusion fee in stroops (network base fee). Default `100`. */
  baseFeePerOp?: string | number;
  /** Required signers. */
  signers?: SignerRequirement[];
  /** Extra warnings to merge into the report. */
  warnings?: InspectionWarning[];
  /** Multipliers applied to the recommended fee to derive min/max. */
  feeMultipliers?: { min?: number; recommended?: number; max?: number };
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /**
   * Network the simulation ran against.  Stored verbatim in
   * `feeEstimate.provenance.network`.  Defaults to `"unknown"`.
   */
  network?: string;
  /**
   * Ledger sequence the simulation ran against, when available.  Stored in
   * `feeEstimate.provenance.simulationLedger` so consumers can verify the
   * estimate reflects current on-chain state.
   */
  simulationLedger?: number;
  /**
   * Maximum age (ms) of an **externally produced** fee estimate before the
   * builder emits a `FEE_ESTIMATE_STALE` warning.  Only applies when
   * `feeEstimateAge` is also provided.  Defaults to
   * {@link DEFAULT_FEE_ESTIMATE_TTL_MS}.
   */
  feeEstimateTtlMs?: number;
  /**
   * Age (ms) of a pre-computed fee estimate being passed into this build.
   * When provided alongside `feeEstimateTtlMs` (or the default TTL) and the
   * age exceeds the TTL, the builder adds a `FEE_ESTIMATE_STALE` warning so
   * callers that reuse cached reports are alerted.
   */
  feeEstimateAge?: number;
}

function toBigInt(value: string | number | undefined, fallback = 0n): bigint {
  if (value === undefined) return fallback;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  return trimmed === "" ? fallback : BigInt(trimmed);
}

/** Scale a bigint by a decimal multiplier without floating-point drift. */
function scale(value: bigint, multiplier: number): bigint {
  const PRECISION = 1000n;
  const m = BigInt(Math.round(multiplier * Number(PRECISION)));
  return (value * m) / PRECISION;
}

/**
 * Lazily load `XdrDecoder.explainOperation`. Kept out of the module's static
 * import graph so this file (and its tests) never require the decoder unless a
 * caller actually passes raw operation XDRs without their own explainer.
 */
function loadDefaultExplain(): (operationXdr: string) => string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./xdrDecoder") as {
    XdrDecoder: { explainOperation(operationXdr: string): string };
  };
  return (operationXdr) => mod.XdrDecoder.explainOperation(operationXdr);
}

function decodeOperations(input: InspectionInput): OperationSummary[] {
  if (input.operations) return input.operations;
  const xdrs = input.operationXdrs ?? [];
  if (xdrs.length === 0) return [];
  const explain = input.explainOperation ?? loadDefaultExplain();
  return xdrs.map((xdr, index) => {
    const description = explain(xdr, index);
    // The explainer returns a leading verb we use as a coarse type label.
    const type = description.split(/\s|:/)[0]?.toLowerCase() || "operation";
    return { index, type, description };
  });
}

/**
 * Assemble a {@link TransactionInspectionReport} from simulation output. Pure
 * and deterministic given a fixed `now`.
 */
export function buildInspectionReport(
  input: InspectionInput
): TransactionInspectionReport {
  const now = input.now ?? Date.now;
  const operations = decodeOperations(input);

  const sim = input.simulation;
  const resourceFee = toBigInt(sim.minResourceFee);
  const baseFeePerOp = toBigInt(input.baseFeePerOp, 100n);
  const inclusionFee = baseFeePerOp * BigInt(Math.max(operations.length, 1));
  const recommendedRaw = resourceFee + inclusionFee;

  const mult = input.feeMultipliers ?? {};
  const recommended = scale(recommendedRaw, mult.recommended ?? 1);
  const min = scale(recommendedRaw, mult.min ?? 1);
  const max = scale(recommendedRaw, mult.max ?? 1.5);

  // Build provenance: record when this estimate was produced, what network it
  // targets, and whether it came from a live simulation or a fallback path.
  const provenance: FeeEstimateProvenance = {
    estimatedAt: now(),
    network: input.network ?? "unknown",
    source: sim.minResourceFee !== undefined ? "simulation" : "fallback",
    ...(input.simulationLedger !== undefined
      ? { simulationLedger: input.simulationLedger }
      : {}),
  };

  const feeEstimate: InspectionFeeEstimate = {
    min: min.toString(),
    recommended: recommended.toString(),
    max: max.toString(),
    currency: "stroops",
    provenance,
  };

  const simulation: SimulationSummary = {
    success: sim.success,
    returnValue: sim.returnValue,
    minResourceFee:
      sim.minResourceFee !== undefined ? resourceFee.toString() : undefined,
    resourceUsage: sim.resourceUsage,
    errorCode: sim.errorCode,
    errorMessage: sim.errorMessage,
  };

  const warnings: InspectionWarning[] = [...(input.warnings ?? [])];
  if (!sim.success) {
    warnings.push({
      code: "SIMULATION_FAILED",
      message: sim.errorMessage ?? "Transaction simulation failed",
      severity: "critical",
    });
  }
  if (operations.length === 0) {
    warnings.push({
      code: "NO_OPERATIONS",
      message: "Transaction contains no operations",
      severity: "warning",
    });
  }
  if ((input.signers ?? []).length === 0) {
    warnings.push({
      code: "NO_SIGNERS",
      message: "No required signers were provided",
      severity: "info",
    });
  }

  // Warn when the caller indicates the fee estimate was produced earlier and
  // the age already exceeds the configured (or default) TTL.  This catches the
  // common case where a cached report is re-used without re-simulating.
  if (input.feeEstimateAge !== undefined) {
    const ttl = input.feeEstimateTtlMs ?? DEFAULT_FEE_ESTIMATE_TTL_MS;
    if (input.feeEstimateAge >= ttl) {
      warnings.push({
        code: "FEE_ESTIMATE_STALE",
        message: `Fee estimate is ${input.feeEstimateAge} ms old (TTL: ${ttl} ms). Re-simulate before submitting.`,
        severity: "warning",
      });
    }
  }

  // Fallback source gets a standing informational note so reviewers know the
  // estimate may not reflect Soroban resource costs.
  if (provenance.source === "fallback") {
    warnings.push({
      code: "FEE_ESTIMATE_FALLBACK",
      message:
        "No minResourceFee was available from simulation. The fee estimate covers only the base inclusion fee and may be insufficient for Soroban contract calls.",
      severity: "info",
    });
  }

  const status: InspectionStatus = !sim.success
    ? "error"
    : warnings.some((w) => w.severity === "critical")
      ? "error"
      : warnings.some((w) => w.severity === "warning")
        ? "warning"
        : "ok";

  const signerRequirements = input.signers ?? [];
  const executionSummary: ExecutionSummary = {
    willLikelySucceed: sim.success && status !== "error",
    operationCount: operations.length,
    signerCount: signerRequirements.length,
    recommendedFee: feeEstimate.recommended,
    headline: sim.success
      ? `${operations.length} operation(s), ~${feeEstimate.recommended} stroops, ${signerRequirements.length} signer(s)`
      : `Will fail: ${sim.errorMessage ?? sim.errorCode ?? "simulation error"}`,
  };

  return {
    version: INSPECTION_REPORT_VERSION,
    status,
    operations,
    simulation,
    feeEstimate,
    signerRequirements,
    warnings,
    executionSummary,
    generatedAt: now(),
  };
}

/** Serialize a report to a stable JSON string (already plain data). */
export function serializeInspectionReport(
  report: TransactionInspectionReport
): string {
  return JSON.stringify(report);
}
