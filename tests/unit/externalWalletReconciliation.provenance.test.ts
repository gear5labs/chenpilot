import { ExternalWalletReconciliationService, IngestOptions, RawExternalTransaction } from "../../src/services/externalWalletReconciliation.service";

describe("ExternalWalletReconciliationService Provenance & Observation Time", () => {
  let service: ExternalWalletReconciliationService;

  beforeEach(() => {
    service = new ExternalWalletReconciliationService();
  });

  it("preserves source provenance and custom observation timestamp", async () => {
    const rawTx: RawExternalTransaction = {
      txHash: "0xprov123",
      operationIndex: 0,
      sourceAddress: "GSRC1",
      targetAddress: "GTGT1",
      amount: "100.00",
      asset: "USDC",
      status: "confirmed",
      timestamp: "2026-10-01T12:00:00Z",
    };

    const observationTime = "2026-10-01T12:05:00Z";
    const options: IngestOptions = {
      source: "horizon-testnet",
      network: "testnet",
      importedBy: "audit-agent-1",
      observationTimestamp: observationTime,
      rawTransactions: [rawTx],
    };

    const result = await service.ingestAndReconcile(options);
    expect(result.importedRecords).toHaveLength(1);
    const rec = result.importedRecords[0];

    expect(rec.source).toBe("horizon-testnet");
    expect(rec.network).toBe("testnet");
    expect(rec.importedBy).toBe("audit-agent-1");
    expect(rec.observationTimestamp).toBe(observationTime);
  });

  it("falls back to current time when observationTimestamp is omitted", async () => {
    const rawTx: RawExternalTransaction = {
      txHash: "0xprov456",
      operationIndex: 0,
      sourceAddress: "GSRC2",
      targetAddress: "GTGT2",
      amount: "25.00",
      asset: "XLM",
      status: "confirmed",
      timestamp: "2026-10-01T12:00:00Z",
    };

    const options: IngestOptions = {
      source: "horizon",
      network: "public",
      importedBy: "operator-2",
      rawTransactions: [rawTx],
    };

    const result = await service.ingestAndReconcile(options);
    expect(result.importedRecords).toHaveLength(1);
    const rec = result.importedRecords[0];

    expect(rec.source).toBe("horizon");
    expect(rec.network).toBe("public");
    expect(rec.importedBy).toBe("operator-2");
    expect(rec.observationTimestamp).toBeDefined();
    expect(typeof rec.observationTimestamp).toBe("string");
  });
});
