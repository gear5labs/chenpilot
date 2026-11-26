/**
 * Tests for the append-only transaction_corrections audit trail.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockState = {
  initialized: true,
  query: jest.fn(),
};

jest.mock("../../src/config/Datasource", () => {
  const ds = {
    get isInitialized() {
      return mockState.initialized;
    },
    query: (...args: unknown[]) => mockState.query(...args),
  };
  return { __esModule: true, AppDataSource: ds, default: ds };
});

import {
  correctionEvidenceHash,
  recordTransactionCorrection,
} from "../../src/services/transactionCorrections";

describe("correctionEvidenceHash", () => {
  it("is deterministic and sensitive to evidence changes", () => {
    const a = correctionEvidenceHash({
      previousState: { status: "quarantined" },
      newState: { status: "matched" },
      sourceEvidence: { txHash: "0x1" },
    });
    const b = correctionEvidenceHash({
      previousState: { status: "quarantined" },
      newState: { status: "matched" },
      sourceEvidence: { txHash: "0x1" },
    });
    const c = correctionEvidenceHash({
      previousState: { status: "quarantined" },
      newState: { status: "dismissed" },
      sourceEvidence: { txHash: "0x1" },
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("recordTransactionCorrection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.initialized = true;
    mockState.query.mockResolvedValue([
      {
        id: "corr-1",
        reportId: null,
        entityId: "ent-1",
        txHash: "0xabc",
        correctionType: "quarantine_resolution",
        previousState: { status: "quarantined" },
        newState: { status: "matched" },
        sourceEvidence: { txHash: "0xabc" },
        correctedBy: "op-1",
        reason: "manual link",
        evidenceSha256: "deadbeef",
        createdAt: new Date().toISOString(),
      },
    ]);
  });

  it("inserts an append-only row with a verifiable evidence hash", async () => {
    const input = {
      entityId: "ent-1",
      txHash: "0xabc",
      correctionType: "quarantine_resolution",
      previousState: { status: "quarantined" },
      newState: { status: "matched" },
      sourceEvidence: { txHash: "0xabc" },
      correctedBy: "op-1",
      reason: "manual link",
    };

    const result = await recordTransactionCorrection(input);

    expect(result?.id).toBe("corr-1");
    expect(mockState.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockState.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO transaction_corrections");
    expect(sql).toContain("evidence_sha256");
    // params[10] is evidence_sha256 — must equal the canonical hash
    expect(params[10]).toBe(correctionEvidenceHash(input));
    expect(params[3]).toBe("0xabc");
    expect(params[8]).toBe("op-1");
  });

  it("returns null without touching the DB when uninitialized", async () => {
    mockState.initialized = false;
    const result = await recordTransactionCorrection({
      correctionType: "other",
    });
    expect(result).toBeNull();
    expect(mockState.query).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the insert fails", async () => {
    mockState.query.mockRejectedValue(new Error("relation does not exist"));
    const result = await recordTransactionCorrection({
      correctionType: "other",
    });
    expect(result).toBeNull();
  });
});
