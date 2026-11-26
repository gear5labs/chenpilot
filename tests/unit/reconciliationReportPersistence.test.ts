/**
 * Reconciliation report persistence — invariant results/summary must be
 * stored and returned, not dropped.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../src/config/config", () => ({
  __esModule: true,
  default: { node_url: "http://localhost:5050" },
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

jest.mock("../../src/observability", () => ({
  getObservabilityContext: () => undefined,
}));

jest.mock("../../src/services/soroban/sdkAdapter", () => ({
  buildRpcServer: jest.fn(() => ({})),
}));

jest.mock("starknet", () => ({
  RpcProvider: jest.fn().mockImplementation(() => ({})),
  Contract: jest.fn(),
}));

import { ReconciliationService } from "../../src/services/reconciliation.service";

describe("reconciliation report persistence", () => {
  let service: ReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.initialized = true;
    mockState.query.mockResolvedValue([]);
    service = new ReconciliationService();
  });

  it("persistReport stores invariant results and summary", async () => {
    const report = await service.reconcile("user-1", { invariants: true });

    expect(report.invariantResults).toBeDefined();
    expect(report.invariantSummary).toBeDefined();

    const insertCall = mockState.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO reconciliation_reports")
    );
    expect(insertCall).toBeDefined();
    const [, params] = insertCall as [string, unknown[]];
    expect(String((insertCall as [string])[0])).toContain("invariant_results");
    expect(String((insertCall as [string])[0])).toContain("invariant_summary");
    expect(JSON.parse(params[9] as string)).toEqual(report.invariantResults);
    expect(JSON.parse(params[10] as string)).toEqual(report.invariantSummary);
  });

  it("getReports returns parsed invariant fields", async () => {
    const invariantResults = [{ invariantId: "inv-1", status: "passing" }];
    const invariantSummary = { total: 1, passing: 1 };
    mockState.query.mockResolvedValueOnce([
      {
        id: "r1",
        userId: "user-1",
        scope: { invariants: true },
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        driftItems: [],
        summary: { total: 0, critical: 0, major: 0, minor: 0, none: 0 },
        status: "clean",
        errorMessage: null,
        invariantResults: JSON.stringify(invariantResults),
        invariantSummary: JSON.stringify(invariantSummary),
      },
    ]);

    const reports = await service.getReports("user-1");

    expect(reports).toHaveLength(1);
    expect(reports[0].invariantResults).toEqual(invariantResults);
    expect(reports[0].invariantSummary).toEqual(invariantSummary);
  });
});
