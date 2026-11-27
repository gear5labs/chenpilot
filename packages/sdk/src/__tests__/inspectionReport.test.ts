/**
 * Tests for the transaction inspection / simulation report format (#571).
 */

import {
  buildInspectionReport,
  serializeInspectionReport,
  INSPECTION_REPORT_VERSION,
  OperationSummary,
} from "../inspectionReport";

const ops: OperationSummary[] = [
  {
    index: 0,
    type: "invokehostfunction",
    description: "invokeHostFunction: transfer",
  },
  { index: 1, type: "payment", description: "payment: 10 XLM" },
];

const fixedNow = () => 1700000000000;

describe("buildInspectionReport", () => {
  it("produces an ok report with a computed fee estimate for a successful simulation", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: { success: true, minResourceFee: "1000" },
      baseFeePerOp: 100,
      signers: [{ key: "GSOURCE", reason: "source account" }],
      now: fixedNow,
    });

    expect(report.version).toBe(INSPECTION_REPORT_VERSION);
    expect(report.status).toBe("ok");
    // resourceFee(1000) + baseFee(100) * 2 ops = 1200 recommended.
    expect(report.feeEstimate.recommended).toBe("1200");
    expect(report.feeEstimate.min).toBe("1200");
    expect(report.feeEstimate.max).toBe("1800"); // default max multiplier 1.5
    expect(report.feeEstimate.currency).toBe("stroops");
    expect(report.feeEstimate.provenance.estimatedAt).toBe(1700000000000);
    expect(report.feeEstimate.provenance.network).toBe("unknown");
    expect(report.feeEstimate.provenance.source).toBe("simulation");
    expect(report.executionSummary.willLikelySucceed).toBe(true);
    expect(report.executionSummary.operationCount).toBe(2);
    expect(report.executionSummary.signerCount).toBe(1);
    expect(report.generatedAt).toBe(1700000000000);
    expect(report.warnings).toEqual([]);
  });

  it("marks the report as error and adds a warning when simulation fails", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: {
        success: false,
        errorCode: "TX_SIMULATION_FAILED",
        errorMessage: "trap",
      },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    expect(report.status).toBe("error");
    expect(report.executionSummary.willLikelySucceed).toBe(false);
    expect(report.warnings.some((w) => w.code === "SIMULATION_FAILED")).toBe(
      true
    );
    expect(report.executionSummary.headline).toMatch(/Will fail/);
  });

  it("warns when there are no operations and no signers", () => {
    const report = buildInspectionReport({
      operations: [],
      simulation: { success: true },
      signers: [],
      now: fixedNow,
    });
    expect(report.warnings.map((w) => w.code).sort()).toEqual([
      "NO_OPERATIONS",
      "NO_SIGNERS",
    ]);
    expect(report.status).toBe("warning");
    // inclusion fee still counts at least one operation slot.
    expect(report.feeEstimate.recommended).toBe("100");
  });

  it("applies custom fee multipliers deterministically", () => {
    const report = buildInspectionReport({
      operations: [ops[0]],
      simulation: { success: true, minResourceFee: "900" },
      baseFeePerOp: 100,
      feeMultipliers: { min: 1, recommended: 1.1, max: 2 },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    // raw = 900 + 100 = 1000
    expect(report.feeEstimate.min).toBe("1000");
    expect(report.feeEstimate.recommended).toBe("1100");
    expect(report.feeEstimate.max).toBe("2000");
  });

  it("decodes raw operation XDRs with an injected explainer", () => {
    const report = buildInspectionReport({
      operationXdrs: ["xdr-a", "xdr-b"],
      explainOperation: (_xdr, i) => `payment: op ${i}`,
      simulation: { success: true, minResourceFee: "0" },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    expect(report.operations).toHaveLength(2);
    expect(report.operations[0]).toEqual({
      index: 0,
      type: "payment",
      description: "payment: op 0",
    });
  });

  it("serializes to stable JSON", () => {
    const report = buildInspectionReport({
      operations: ops,
      simulation: { success: true, minResourceFee: "1000" },
      signers: [{ key: "G1" }],
      now: fixedNow,
    });
    const json = serializeInspectionReport(report);
    expect(JSON.parse(json)).toEqual(report);
  });
});

// ─── Fee-estimate provenance and freshness ────────────────────────────────────

import {
  isFeeEstimateStale,
  DEFAULT_FEE_ESTIMATE_TTL_MS,
  FeeEstimateProvenance,
  InspectionFeeEstimate,
} from "../inspectionReport";

describe("FeeEstimateProvenance", () => {
  describe("buildInspectionReport — provenance fields", () => {
    it("populates provenance.estimatedAt equal to generatedAt", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.estimatedAt).toBe(fixedNow());
      expect(report.feeEstimate.provenance.estimatedAt).toBe(report.generatedAt);
    });

    it("stores network='unknown' by default", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.network).toBe("unknown");
    });

    it("stores the caller-supplied network verbatim", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        network: "testnet",
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.network).toBe("testnet");
    });

    it("stores simulationLedger when provided", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        simulationLedger: 123456,
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.simulationLedger).toBe(123456);
    });

    it("omits simulationLedger when not provided", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.simulationLedger).toBeUndefined();
    });

    it("sets source='simulation' when minResourceFee is present", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "1000" },
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.source).toBe("simulation");
    });

    it("sets source='fallback' and adds FEE_ESTIMATE_FALLBACK warning when minResourceFee is absent", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true }, // no minResourceFee
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      expect(report.feeEstimate.provenance.source).toBe("fallback");
      expect(report.warnings.some((w) => w.code === "FEE_ESTIMATE_FALLBACK")).toBe(true);
    });

    it("fallback source does not set status=error — it is only info", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true },
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      const fallbackWarning = report.warnings.find(
        (w) => w.code === "FEE_ESTIMATE_FALLBACK"
      );
      expect(fallbackWarning?.severity).toBe("info");
      // status should not be "error" because of the fallback warning alone
      expect(report.status).not.toBe("error");
    });

    it("provenance survives JSON round-trip via serializeInspectionReport", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "800" },
        network: "mainnet",
        simulationLedger: 999,
        signers: [{ key: "G1" }],
        now: fixedNow,
      });
      const parsed = JSON.parse(serializeInspectionReport(report));
      expect(parsed.feeEstimate.provenance).toEqual(
        report.feeEstimate.provenance
      );
    });
  });

  describe("buildInspectionReport — FEE_ESTIMATE_STALE warning", () => {
    it("does not emit FEE_ESTIMATE_STALE when feeEstimateAge is below the TTL", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        feeEstimateAge: DEFAULT_FEE_ESTIMATE_TTL_MS - 1,
        now: fixedNow,
      });
      expect(report.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(false);
    });

    it("emits FEE_ESTIMATE_STALE when feeEstimateAge equals the default TTL (boundary)", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        feeEstimateAge: DEFAULT_FEE_ESTIMATE_TTL_MS,
        now: fixedNow,
      });
      expect(report.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(true);
    });

    it("emits FEE_ESTIMATE_STALE when feeEstimateAge exceeds the default TTL", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        feeEstimateAge: DEFAULT_FEE_ESTIMATE_TTL_MS + 5000,
        now: fixedNow,
      });
      const staleWarning = report.warnings.find(
        (w) => w.code === "FEE_ESTIMATE_STALE"
      );
      expect(staleWarning).toBeDefined();
      expect(staleWarning?.severity).toBe("warning");
    });

    it("respects a custom feeEstimateTtlMs", () => {
      const customTtl = 5000;
      // age=4999 is fresh under a 5000 ms TTL
      const fresh = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        feeEstimateAge: customTtl - 1,
        feeEstimateTtlMs: customTtl,
        now: fixedNow,
      });
      expect(fresh.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(false);

      // age=5000 is stale under a 5000 ms TTL
      const stale = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        feeEstimateAge: customTtl,
        feeEstimateTtlMs: customTtl,
        now: fixedNow,
      });
      expect(stale.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(true);
    });

    it("does not emit FEE_ESTIMATE_STALE when feeEstimateAge is not provided", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: true, minResourceFee: "500" },
        signers: [{ key: "G1" }],
        now: fixedNow,
        // feeEstimateAge intentionally absent
      });
      expect(report.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(false);
    });

    it("stale estimate on a failed simulation still produces a combined error report", () => {
      const report = buildInspectionReport({
        operations: ops,
        simulation: { success: false, errorCode: "FAIL", errorMessage: "trap" },
        signers: [{ key: "G1" }],
        feeEstimateAge: DEFAULT_FEE_ESTIMATE_TTL_MS + 1,
        now: fixedNow,
      });
      expect(report.status).toBe("error");
      expect(report.warnings.some((w) => w.code === "SIMULATION_FAILED")).toBe(true);
      expect(report.warnings.some((w) => w.code === "FEE_ESTIMATE_STALE")).toBe(true);
    });
  });
});

describe("isFeeEstimateStale", () => {
  const makeEstimate = (
    estimatedAt: number,
    source: FeeEstimateProvenance["source"] = "simulation"
  ): InspectionFeeEstimate => ({
    min: "100",
    recommended: "200",
    max: "300",
    currency: "stroops",
    provenance: { estimatedAt, network: "testnet", source },
  });

  it("returns false when the estimate is fresh (age < TTL)", () => {
    const estimatedAt = 1_000_000;
    const now = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS - 1;
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), DEFAULT_FEE_ESTIMATE_TTL_MS, now)).toBe(false);
  });

  it("returns true at the exact TTL boundary (age === TTL)", () => {
    const estimatedAt = 1_000_000;
    const now = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS;
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), DEFAULT_FEE_ESTIMATE_TTL_MS, now)).toBe(true);
  });

  it("returns true when the estimate is older than the TTL", () => {
    const estimatedAt = 1_000_000;
    const now = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS + 1;
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), DEFAULT_FEE_ESTIMATE_TTL_MS, now)).toBe(true);
  });

  it("uses DEFAULT_FEE_ESTIMATE_TTL_MS when ttlMs is not supplied", () => {
    const estimatedAt = 1_000_000;
    const freshNow = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS - 1;
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), undefined, freshNow)).toBe(false);

    const staleNow = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS;
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), undefined, staleNow)).toBe(true);
  });

  it("returns true unconditionally when provenance is absent (legacy estimate)", () => {
    const legacyEstimate = {
      min: "100",
      recommended: "200",
      max: "300",
      currency: "stroops",
      // provenance deliberately omitted
    } as unknown as InspectionFeeEstimate;

    // Even if the estimate was just produced the missing provenance means stale
    const now = () => 1_000_001;
    expect(isFeeEstimateStale(legacyEstimate, DEFAULT_FEE_ESTIMATE_TTL_MS, now)).toBe(true);
  });

  it("works correctly for a fallback-source estimate", () => {
    const estimatedAt = 2_000_000;
    const freshNow = () => estimatedAt + 1000;
    const staleNow = () => estimatedAt + DEFAULT_FEE_ESTIMATE_TTL_MS;

    const fallback = makeEstimate(estimatedAt, "fallback");
    expect(isFeeEstimateStale(fallback, DEFAULT_FEE_ESTIMATE_TTL_MS, freshNow)).toBe(false);
    expect(isFeeEstimateStale(fallback, DEFAULT_FEE_ESTIMATE_TTL_MS, staleNow)).toBe(true);
  });

  it("works with ttlMs=0 (every estimate is immediately stale)", () => {
    const estimatedAt = 1_000_000;
    const now = () => estimatedAt; // same instant
    expect(isFeeEstimateStale(makeEstimate(estimatedAt), 0, now)).toBe(true);
  });
});
