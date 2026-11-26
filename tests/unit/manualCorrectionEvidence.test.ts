/**
 * Manual-correction evidence preservation.
 *
 * Verifies that operator resolutions of quarantined external activities and
 * dispute outcomes are recorded through recordTransactionCorrection with the
 * pre-resolution state, post-resolution state, and source evidence intact.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../src/config/config", () => ({
  __esModule: true,
  default: {
    agent: { timeouts: { toolExecution: 30_000, agentExecution: 60_000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
    db: {},
    redis: {},
  },
}));

jest.mock("../../src/services/transactionCorrections", () => ({
  recordTransactionCorrection: jest.fn(),
}));

// reconciliation.service is imported for types only by the services under
// test; stub it so its heavy provider imports never load.
jest.mock("../../src/services/reconciliation.service", () => ({}));

import { recordTransactionCorrection } from "../../src/services/transactionCorrections";
import { ExternalWalletReconciliationService } from "../../src/services/externalWalletReconciliation.service";
import { TransactionDisputeService } from "../../src/services/transactionDispute.service";
import type {
  InternalTransactionRecord,
  RawExternalTransaction,
} from "../../src/services/externalWalletReconciliation.service";

const mockRecord = recordTransactionCorrection as jest.MockedFunction<
  typeof recordTransactionCorrection
>;

describe("manual correction evidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecord.mockResolvedValue({ id: "corr-1" } as never);
  });

  it("resolveQuarantinedMatch preserves pre/post state and source evidence", async () => {
    const service = new ExternalWalletReconciliationService();

    const rawTx: RawExternalTransaction = {
      txHash: "0xquarantine_evidence",
      sourceAddress: "G_WALLET",
      amount: "100.00",
      asset: "USDC",
    };
    const internalRecord: InternalTransactionRecord = {
      id: "int-target-1",
      txHash: "0xquarantine_evidence",
      userId: "user-1",
      amount: "101.00", // mismatch → quarantine
      asset: "USDC",
      status: "confirmed",
      createdAt: new Date(),
    };

    const res = await service.ingestAndReconcile({
      source: "horizon",
      network: "testnet",
      importedBy: "operator-1",
      rawTransactions: [rawTx],
      internalRecords: [internalRecord],
    });
    const chainId = res.activities[0].chainIdentity;
    expect(service.getQuarantinedMatches()).toHaveLength(1);

    service.resolveQuarantinedMatch(chainId, "link", "int-target-1", {
      id: "operator-1",
      roles: ["operator"],
    });

    // recordTransactionCorrection is invoked synchronously (void promise)
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const arg = mockRecord.mock.calls[0][0];
    expect(arg.correctionType).toBe("quarantine_resolution");
    expect(arg.entityId).toBe(chainId);
    expect(arg.txHash).toBe("0xquarantine_evidence");
    expect(arg.correctedBy).toBe("operator-1");
    expect((arg.previousState as any).linkStatus).toBe("quarantined");
    expect((arg.newState as any).linkStatus).toBe("matched");
    expect((arg.newState as any).linkedInternalRecordId).toBe("int-target-1");
    expect((arg.sourceEvidence as any).txHash).toBe("0xquarantine_evidence");
    expect((arg.sourceEvidence as any).quarantineReason).toBe("AMOUNT_MISMATCH");
  });

  it("dispute resolve preserves status transition and evidence", () => {
    const service = new TransactionDisputeService();
    const dispute = service.report({
      userId: "user-1",
      transactionId: "tx-123",
      workflowId: "wf-1",
      evidence: "tx never arrived on-chain",
    });

    service.resolve(dispute.id, "resolved", "refund issued", {
      id: "inv-1",
      roles: ["investigator"],
    });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const arg = mockRecord.mock.calls[0][0];
    expect(arg.correctionType).toBe("dispute_resolution");
    expect(arg.entityId).toBe("tx-123");
    expect(arg.correctedBy).toBe("inv-1");
    expect(arg.previousState).toEqual({ status: "open" });
    expect(arg.newState).toEqual({ status: "resolved", outcome: "refund issued" });
    expect((arg.sourceEvidence as any).disputeId).toBe(dispute.id);
    expect((arg.sourceEvidence as any).evidence).toHaveLength(1);
  });
});
