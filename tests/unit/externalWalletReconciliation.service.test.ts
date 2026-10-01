import { describe, it, expect, beforeEach } from "bun:test";
import {
  ExternalReconciliationNotification,
  ExternalWalletReconciliationService,
  IngestOptions,
  InternalTransactionRecord,
  RawExternalTransaction,
  WorkflowBroadcastIntent,
} from "../../src/services/externalWalletReconciliation.service";
import { ReconciliationWorkspaceService } from "../../src/services/reconciliationWorkspace.service";

describe("ExternalWalletReconciliationService", () => {
  let service: ExternalWalletReconciliationService;

  beforeEach(() => {
    service = new ExternalWalletReconciliationService();
  });

  describe("Stable Chain Identities & Deduplication", () => {
    it("generates deterministic, stable chain identities across networks and operations", () => {
      const id1 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xABCDEF123456",
        0
      );
      const id2 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xabcdef123456",
        0
      );
      const id3 = service.buildChainIdentity(
        "testnet",
        "stellar-testnet",
        "0xabcdef123456",
        1
      );
      const idMainnet = service.buildChainIdentity(
        "mainnet",
        "stellar-mainnet",
        "0xabcdef123456",
        0
      );

      expect(id1).toBe("testnet:stellar-testnet:0xabcdef123456:0");
      expect(id1).toBe(id2); // Case insensitive hash normalization
      expect(id1).not.toBe(id3); // Multi-op uniqueness
      expect(id1).not.toBe(idMainnet); // Network isolation
    });

    it("deduplicates identical transactions and ensures reimports are idempotent", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash111",
        operationIndex: 0,
        sourceAddress: "GSOURCE111",
        targetAddress: "GTARGET111",
        amount: "50.00",
        asset: "USDC",
        status: "confirmed",
        timestamp: "2026-09-28T10:00:00Z",
      };

      const options: IngestOptions = {
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
      };

      // First import
      const result1 = await service.ingestAndReconcile(options);
      expect(result1.totalIngested).toBe(1);
      expect(result1.newlyImported).toBe(1);
      expect(result1.deduplicated).toBe(0);
      expect(result1.unmatched).toBe(1);

      // Re-importing exact same transaction
      const result2 = await service.ingestAndReconcile(options);
      expect(result2.totalIngested).toBe(1);
      expect(result2.newlyImported).toBe(0);
      expect(result2.deduplicated).toBe(1); // Deduped!

      // Original activity count in service remains exactly 1
      const unmatched = service.getUnmatchedActivities();
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0].txHash).toBe("0xhash111");
    });
  });

  describe("Import Provenance & Checksum Integrity", () => {
    it("retains full provenance, actor identity, source, and payload checksum", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash222",
        sourceAddress: "GSOURCE222",
        targetAddress: "GTARGET222",
        amount: 100,
        asset: "XLM",
        status: "confirmed",
        extra: { memo: "payroll-sep-2026" },
      };

      const options: IngestOptions = {
        source: "external_export",
        network: "mainnet",
        importedBy: "admin-audit-user",
        metadata: { filename: "external_ledger_dump.csv" },
        rawTransactions: [rawTx],
      };

      const result = await service.ingestAndReconcile(options);
      expect(result.newlyImported).toBe(1);

      const activity = result.activities[0];
      expect(activity.provenance.source).toBe("external_export");
      expect(activity.provenance.importedBy).toBe("admin-audit-user");
      expect(activity.provenance.network).toBe("mainnet");
      expect(activity.provenance.metadata?.filename).toBe("external_ledger_dump.csv");
      expect(activity.provenance.rawPayloadChecksum).toBeDefined();
      expect(activity.provenance.rawPayloadChecksum.length).toBe(64); // SHA-256
    });
  });

  describe("Reconciliation & Quarantine of Ambiguous Matches", () => {
    it("links exact matching transactions successfully", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xmatched_hash_1",
        sourceAddress: "G_USER_WALLET",
        targetAddress: "G_MERCHANT",
        amount: "150.25",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-1",
        txHash: "0xmatched_hash_1",
        userId: "user-1",
        walletAddress: "G_USER_WALLET",
        amount: "150.25",
        asset: "USDC",
        status: "confirmed",
        sourceAddress: "G_USER_WALLET",
        targetAddress: "G_MERCHANT",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.matched).toBe(1);
      expect(result.quarantined).toBe(0);
      expect(result.unmatched).toBe(0);

      const activity = result.activities[0];
      expect(activity.linkStatus).toBe("matched");
      expect(activity.linkedInternalRecordId).toBe("int-tx-1");
    });

    it("quarantines transactions when amounts diverge (AMOUNT_MISMATCH)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash_divergent_amount",
        sourceAddress: "G_WALLET",
        targetAddress: "G_RECEIVER",
        amount: "200.00",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-2",
        txHash: "0xhash_divergent_amount",
        userId: "user-1",
        amount: "180.00", // Divergent!
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.matched).toBe(0);
      expect(result.quarantined).toBe(1);

      const quarantined = service.getQuarantinedMatches();
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].quarantineReason).toBe("AMOUNT_MISMATCH");
      expect(quarantined[0].quarantineDetails?.delta).toBe(20);
    });

    it("quarantines transactions when assets diverge (ASSET_MISMATCH)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xhash_divergent_asset",
        sourceAddress: "G_WALLET",
        amount: "100.00",
        asset: "XLM", // Divergent
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-tx-3",
        txHash: "0xhash_divergent_asset",
        userId: "user-1",
        amount: "100.00",
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.quarantined).toBe(1);
      expect(result.activities[0].quarantineReason).toBe("ASSET_MISMATCH");
    });

    it("quarantines transactions when multiple candidate internal records match (MULTIPLE_CANDIDATE_MATCHES)", async () => {
      const now = new Date();
      const rawTx: RawExternalTransaction = {
        txHash: "0xexternal_no_direct_hash_link",
        sourceAddress: "G_SHARED_POOL",
        amount: "75.00",
        asset: "USDC",
        status: "confirmed",
        timestamp: now,
      };

      // Two internal records with identical amount and wallet in the same window
      const internalRecords: InternalTransactionRecord[] = [
        {
          id: "int-candidate-1",
          userId: "user-1",
          walletAddress: "G_SHARED_POOL",
          amount: "75.00",
          asset: "USDC",
          status: "pending",
          createdAt: now,
        },
        {
          id: "int-candidate-2",
          userId: "user-2",
          walletAddress: "G_SHARED_POOL",
          amount: "75.00",
          asset: "USDC",
          status: "pending",
          createdAt: now,
        },
      ];

      const result = await service.ingestAndReconcile({
        source: "manual_batch",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords,
      });

      expect(result.quarantined).toBe(1);
      const activity = result.activities[0];
      expect(activity.linkStatus).toBe("quarantined");
      expect(activity.quarantineReason).toBe("MULTIPLE_CANDIDATE_MATCHES");
      expect(activity.quarantineDetails?.count).toBe(2);
    });

    it("quarantines status conflicts when external succeeded but internal failed (STATUS_CONFLICT)", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xstatus_conflict_hash",
        sourceAddress: "G_WALLET",
        amount: "10.00",
        asset: "USDC",
        status: "confirmed",
      };

      const internalRecord: InternalTransactionRecord = {
        id: "int-failed-1",
        txHash: "0xstatus_conflict_hash",
        userId: "user-1",
        amount: "10.00",
        asset: "USDC",
        status: "failed", // Internal recorded failure!
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [rawTx],
        internalRecords: [internalRecord],
      });

      expect(result.quarantined).toBe(1);
      expect(result.activities[0].quarantineReason).toBe("STATUS_CONFLICT");
    });
  });

  describe("Operator Triage & Review", () => {
    it("exposes unmatched activities and quarantined matches with filters", async () => {
      await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xunmatched_1",
            sourceAddress: "G_WALLET_A",
            amount: "10.00",
            asset: "USDC",
          },
          {
            txHash: "0xunmatched_2",
            sourceAddress: "G_WALLET_B",
            amount: "20.00",
            asset: "XLM",
          },
        ],
      });

      const allUnmatched = service.getUnmatchedActivities();
      expect(allUnmatched).toHaveLength(2);

      const filtered = service.getUnmatchedActivities({ walletAddress: "G_WALLET_A" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].txHash).toBe("0xunmatched_1");
    });

    it("allows authorized operators to resolve quarantined matches", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xquarantine_to_resolve",
        sourceAddress: "G_WALLET",
        amount: "100.00",
        asset: "USDC",
      };
      const internalRecord: InternalTransactionRecord = {
        id: "int-target-99",
        txHash: "0xquarantine_to_resolve",
        userId: "user-1",
        amount: "101.00", // slight discrepancy causing quarantine
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

      // Unauthorized actor fails
      expect(() =>
        service.resolveQuarantinedMatch(
          chainId,
          "link",
          "int-target-99",
          { id: "viewer", roles: ["viewer"] }
        )
      ).toThrow("Operator permission required");

      // Authorized operator succeeds
      const resolved = service.resolveQuarantinedMatch(
        chainId,
        "link",
        "int-target-99",
        { id: "operator-1", roles: ["operator"] }
      );

      expect(resolved.linkStatus).toBe("matched");
      expect(resolved.linkedInternalRecordId).toBe("int-target-99");
      expect(service.getQuarantinedMatches()).toHaveLength(0);
    });
  });

  describe("Integration with ReconciliationWorkspaceService & DriftItems", () => {
    it("converts unmatched and quarantined items to DriftItems and exports to ReconciliationCase", () => {
      const workspace = new ReconciliationWorkspaceService();

      service.buildChainIdentity("testnet", "stellar-testnet", "0xdrift_tx", 0);
      // Ingest an unmatched activity
      service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xdrift_tx",
            sourceAddress: "G_WALLET_DRIFT",
            amount: "500",
            asset: "USDC",
          },
        ],
      });

      const driftItems = service.toDriftItems();
      expect(driftItems).toHaveLength(1);
      expect(driftItems[0].type).toBe("external_activity_unmatched");
      expect(driftItems[0].severity).toBe("major");

      // Export directly into workspace cases
      const cases = service.exportToReconciliationCases(workspace, "rep-ext-101");
      expect(cases).toHaveLength(1);
      expect(cases[0].reportId).toBe("rep-ext-101");
      expect(cases[0].driftItem.type).toBe("external_activity_unmatched");
      expect(cases[0].status).toBe("unresolved");
    });
  });

  describe("Failure, Resilience & Partial Ingestion Retry", () => {
    it("isolates malformed records in errors array without failing entire batch", async () => {
      const batchWithBadRecords: RawExternalTransaction[] = [
        {
          txHash: "0xvalid_1",
          sourceAddress: "G_VALID",
          amount: "10.00",
        },
        {
          txHash: "", // Invalid empty txHash
          sourceAddress: "G_INVALID",
          amount: "20.00",
        },
        {
          txHash: "0xvalid_2",
          sourceAddress: "G_VALID_2",
          amount: -5, // Invalid negative amount
        },
        {
          txHash: "0xvalid_3",
          sourceAddress: "G_VALID_3",
          amount: "30.00",
        },
      ];

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: batchWithBadRecords,
      });

      expect(result.totalIngested).toBe(4);
      expect(result.newlyImported).toBe(2); // 0xvalid_1 and 0xvalid_3
      expect(result.errors).toHaveLength(2); // 2 invalid records captured
      expect(result.errors[0].itemIndex).toBe(1);
      expect(result.errors[1].itemIndex).toBe(2);

      // Verify the service retained the valid entries safely
      expect(service.getUnmatchedActivities()).toHaveLength(2);
    });

    it("supports resilient retry of partial batches idempotently", async () => {
      // First attempt: valid_1 and error on item 2
      const firstBatch: RawExternalTransaction[] = [
        { txHash: "0xbatch_tx_1", sourceAddress: "G1", amount: "10" },
        { txHash: "", sourceAddress: "G2", amount: "20" }, // error
      ];

      const res1 = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: firstBatch,
      });
      expect(res1.newlyImported).toBe(1);
      expect(res1.errors).toHaveLength(1);

      // Operator fixes item 2 and retries the entire batch
      const fixedBatch: RawExternalTransaction[] = [
        { txHash: "0xbatch_tx_1", sourceAddress: "G1", amount: "10" }, // already imported
        { txHash: "0xbatch_tx_2_fixed", sourceAddress: "G2", amount: "20" }, // fixed!
      ];

      const res2 = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: fixedBatch,
      });

      expect(res2.deduplicated).toBe(1); // 0xbatch_tx_1 was safely deduped
      expect(res2.newlyImported).toBe(1); // 0xbatch_tx_2_fixed was ingested
      expect(res2.errors).toHaveLength(0);
      expect(service.getUnmatchedActivities()).toHaveLength(2);
    });
  });

  describe("Linking Externally Broadcast Hashes to Originating Workflows", () => {
    const payoutIntent: WorkflowBroadcastIntent = {
      workflowId: "wf-payout-1",
      workflowType: "batch_payout",
      userId: "user-1",
      network: "testnet",
      txHash: "0xEXTERNAL_PAYOUT_HASH",
      sourceAddress: "G_TREASURY",
      amount: "250",
      asset: "usdc",
    };

    function collectNotifications(
      target: ExternalWalletReconciliationService
    ): ExternalReconciliationNotification[] {
      const notifications: ExternalReconciliationNotification[] = [];
      target.onNotification((notification) => {
        notifications.push(notification);
      });
      return notifications;
    }

    it("attributes an observed hash to the workflow that declared the broadcast", async () => {
      const notifications = collectNotifications(service);
      service.registerWorkflowBroadcast(payoutIntent);

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xexternal_payout_hash", // case-insensitive hash match
            sourceAddress: "G_TREASURY",
            targetAddress: "G_VENDOR",
            amount: "250",
            asset: "usdc",
            status: "confirmed",
          },
        ],
      });

      expect(result.workflowLinked).toBe(1);
      expect(result.workflowAmbiguous).toBe(0);

      const activity = result.activities[0];
      expect(activity.workflowLinkStatus).toBe("linked");
      expect(activity.workflowLink?.workflowId).toBe("wf-payout-1");
      expect(activity.workflowLink?.workflowType).toBe("batch_payout");
      expect(activity.workflowLink?.userId).toBe("user-1");
      expect(activity.workflowLink?.strategy).toBe("tx_hash");
      expect(activity.workflowLink?.confidence).toBe(1);

      // The originating workflow can read back its observed broadcast.
      const workflowActivities = service.getActivitiesForWorkflow("wf-payout-1");
      expect(workflowActivities).toHaveLength(1);
      expect(workflowActivities[0].txHash).toBe("0xexternal_payout_hash");

      const audit = service.getWorkflowBroadcastAudit("wf-payout-1");
      expect(audit.pending).toHaveLength(0); // observed, no longer pending
      expect(audit.linkedActivities).toHaveLength(1);

      const linkedNotifications = notifications.filter(
        (notification) => notification.type === "workflow_broadcast_linked"
      );
      expect(linkedNotifications).toHaveLength(1);
      expect(linkedNotifications[0].workflowId).toBe("wf-payout-1");
      expect(linkedNotifications[0].linkStrategy).toBe("tx_hash");

      // A single intent may only absorb one observed broadcast.
      const secondImport = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-1",
        rawTransactions: [
          {
            txHash: "0xunrelated_payout_hash",
            sourceAddress: "G_TREASURY",
            targetAddress: "G_VENDOR",
            amount: "250",
            asset: "usdc",
            status: "confirmed",
          },
        ],
      });
      expect(secondImport.workflowLinked).toBe(0);
      expect(secondImport.activities[0].workflowLinkStatus).toBe("unlinked");
    });

    it("links by correlation memo when the broadcast hash is not known in advance", async () => {
      service.registerWorkflowBroadcast({
        workflowId: "wf-rebalance-2",
        workflowType: "portfolio_rebalance",
        userId: "user-2",
        network: "testnet",
        memo: "chenpilot-wf-rebalance-2-step-1",
        amount: "1000",
        asset: "XLM",
      });

      const result = await service.ingestAndReconcile({
        source: "external_export",
        network: "testnet",
        importedBy: "operator-2",
        rawTransactions: [
          {
            txHash: "0xrebalance_broadcast",
            sourceAddress: "G_REBALANCE_WALLET",
            amount: "1000",
            asset: "XLM",
            memo: "chenpilot-wf-rebalance-2-step-1",
          },
        ],
      });

      expect(result.workflowLinked).toBe(1);
      expect(result.activities[0].workflowLink?.strategy).toBe("memo");
      expect(result.activities[0].workflowLink?.confidence).toBe(0.95);
    });

    it("links when the workflow id is embedded in the broadcast memo", async () => {
      service.registerWorkflowBroadcast({
        workflowId: "wf-allowance-3",
        workflowType: "wallet_allowance",
        userId: "user-3",
        network: "testnet",
      });

      const result = await service.ingestAndReconcile({
        source: "indexer",
        network: "testnet",
        importedBy: "operator-3",
        rawTransactions: [
          {
            txHash: "0xallowance_broadcast",
            sourceAddress: "G_USER_WALLET",
            amount: "42",
            memo: "cp:wf-allowance-3:grant",
          },
        ],
      });

      expect(result.workflowLinked).toBe(1);
      expect(result.activities[0].workflowLink?.workflowId).toBe("wf-allowance-3");
      expect(result.activities[0].workflowLink?.strategy).toBe("memo_workflow_id");
    });

    it("falls back to amount/wallet/time proximity for a single plausible workflow", async () => {
      const broadcastAt = new Date();
      service.registerWorkflowBroadcast({
        workflowId: "wf-multisig-4",
        workflowType: "multi_signature",
        userId: "user-4",
        network: "testnet",
        sourceAddress: "G_MULTISIG",
        targetAddress: "G_VENDOR_4",
        amount: "77.5",
        asset: "USDC",
        broadcastAt,
      });

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-4",
        rawTransactions: [
          {
            txHash: "0xmultisig_broadcast",
            sourceAddress: "G_MULTISIG",
            targetAddress: "G_VENDOR_4",
            amount: "77.5",
            asset: "USDC",
            timestamp: broadcastAt,
          },
        ],
      });

      expect(result.workflowLinked).toBe(1);
      expect(result.activities[0].workflowLink?.strategy).toBe(
        "amount_wallet_window"
      );
      expect(result.activities[0].workflowLink?.confidence).toBe(0.7);
    });

    it("flags ambiguity instead of guessing when several workflows claim a broadcast", async () => {
      const notifications = collectNotifications(service);
      const sharedCoordinates = {
        workflowType: "agent_plan" as const,
        network: "testnet" as const,
        sourceAddress: "G_SHARED",
        amount: "10",
        asset: "USDC",
      };

      service.registerWorkflowBroadcast({
        ...sharedCoordinates,
        workflowId: "wf-ambiguous-a",
        userId: "user-a",
        txHash: "0xambiguous_broadcast",
      });
      service.registerWorkflowBroadcast({
        ...sharedCoordinates,
        workflowId: "wf-ambiguous-b",
        userId: "user-b",
        txHash: "0xambiguous_broadcast",
      });

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-5",
        rawTransactions: [
          {
            txHash: "0xambiguous_broadcast",
            sourceAddress: "G_SHARED",
            amount: "10",
            asset: "USDC",
          },
        ],
      });

      expect(result.workflowLinked).toBe(0);
      expect(result.workflowAmbiguous).toBe(1);

      const activity = result.activities[0];
      expect(activity.workflowLinkStatus).toBe("ambiguous");
      expect(activity.workflowLink).toBeUndefined();
      expect(activity.workflowCandidateIds).toEqual([
        "wf-ambiguous-a",
        "wf-ambiguous-b",
      ]);

      const ambiguousNotifications = notifications.filter(
        (notification) => notification.type === "workflow_link_ambiguous"
      );
      expect(ambiguousNotifications).toHaveLength(1);
      expect(ambiguousNotifications[0].candidateWorkflowIds).toEqual([
        "wf-ambiguous-a",
        "wf-ambiguous-b",
      ]);

      // Both workflows remain pending observation until an operator resolves it.
      expect(service.getPendingWorkflowBroadcasts()).toHaveLength(2);

      // Re-importing the same hash must not spam duplicate ambiguity alerts.
      await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-5",
        rawTransactions: [
          {
            txHash: "0xambiguous_broadcast",
            sourceAddress: "G_SHARED",
            amount: "10",
            asset: "USDC",
          },
        ],
      });
      expect(
        notifications.filter(
          (notification) => notification.type === "workflow_link_ambiguous"
        )
      ).toHaveLength(1);
    });

    it("keeps ledger quarantine independent from workflow attribution", async () => {
      service.registerWorkflowBroadcast({
        workflowId: "wf-quarantine-6",
        workflowType: "agent_plan",
        userId: "user-6",
        network: "testnet",
        txHash: "0xquarantined_broadcast",
      });

      const internalRecord: InternalTransactionRecord = {
        id: "int-quarantine-6",
        txHash: "0xquarantined_broadcast",
        userId: "user-6",
        amount: "99", // divergent amount -> ledger quarantine
        asset: "USDC",
        status: "confirmed",
        createdAt: new Date(),
      };

      const result = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-6",
        rawTransactions: [
          {
            txHash: "0xquarantined_broadcast",
            sourceAddress: "G_WALLET_6",
            amount: "100",
            asset: "USDC",
          },
        ],
        internalRecords: [internalRecord],
      });

      const activity = result.activities[0];
      expect(activity.linkStatus).toBe("quarantined");
      expect(activity.quarantineReason).toBe("AMOUNT_MISMATCH");
      expect(activity.workflowLinkStatus).toBe("linked");
      expect(activity.workflowLink?.workflowId).toBe("wf-quarantine-6");
    });

    it("is idempotent across re-imports and attributes late registrations", async () => {
      const rawTx: RawExternalTransaction = {
        txHash: "0xlate_registration",
        sourceAddress: "G_WALLET_7",
        amount: "15",
        asset: "USDC",
      };

      const firstImport = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-7",
        rawTransactions: [rawTx],
      });
      expect(firstImport.workflowLinked).toBe(0);
      expect(firstImport.activities[0].workflowLinkStatus).toBe("unlinked");

      // The originating workflow declares the broadcast after ingestion.
      service.registerWorkflowBroadcast({
        workflowId: "wf-late-7",
        workflowType: "manual",
        userId: "user-7",
        network: "testnet",
        txHash: "0xLATE_REGISTRATION",
      });

      const secondImport = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-7",
        rawTransactions: [rawTx],
      });
      expect(secondImport.deduplicated).toBe(1);
      expect(secondImport.workflowLinked).toBe(1);
      expect(secondImport.activities[0].workflowLink?.workflowId).toBe("wf-late-7");

      // Already attributed: subsequent re-imports must not double count.
      const thirdImport = await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-7",
        rawTransactions: [rawTx],
      });
      expect(thirdImport.workflowLinked).toBe(0);
      expect(thirdImport.activities[0].workflowLink?.workflowId).toBe("wf-late-7");
      expect(service.getActivitiesForWorkflow("wf-late-7")).toHaveLength(1);
    });

    it("supports inline intents, pending queries and de-registration", async () => {
      const result = await service.ingestAndReconcile({
        source: "manual_batch",
        network: "testnet",
        importedBy: "operator-8",
        rawTransactions: [
          {
            txHash: "0xinline_intent_hash",
            sourceAddress: "G_WALLET_8",
            amount: "5",
            asset: "USDC",
          },
        ],
        workflowIntents: [
          {
            workflowId: "wf-inline-8",
            workflowType: "agent_plan",
            userId: "user-8",
            network: "testnet",
            txHash: "0xinline_intent_hash",
          },
        ],
      });

      expect(result.workflowLinked).toBe(1);

      // Inline intents are registered, so they remain queryable.
      const observed = service.getPendingWorkflowBroadcasts({
        includeObserved: true,
      });
      expect(observed).toHaveLength(1);
      expect(observed[0].workflowId).toBe("wf-inline-8");
      expect(service.getPendingWorkflowBroadcasts()).toHaveLength(0);

      // Registration is idempotent per workflow/network/hash/operation.
      service.registerWorkflowBroadcast({
        workflowId: "wf-pending-8",
        workflowType: "batch_payout",
        userId: "user-8",
        network: "testnet",
        txHash: "0xpending_hash",
      });
      service.registerWorkflowBroadcast({
        workflowId: "wf-pending-8",
        workflowType: "batch_payout",
        userId: "user-8",
        network: "testnet",
        txHash: "0xPENDING_HASH",
      });
      expect(service.getPendingWorkflowBroadcasts()).toHaveLength(1);

      expect(service.unregisterWorkflowBroadcast("wf-pending-8")).toBe(1);
      expect(service.getPendingWorkflowBroadcasts()).toHaveLength(0);

      expect(() =>
        service.registerWorkflowBroadcast({
          workflowId: "  ",
          workflowType: "manual",
          userId: "user-8",
        })
      ).toThrow("workflowId");
      expect(() =>
        service.registerWorkflowBroadcast({
          workflowId: "wf-invalid-8",
          workflowType: "manual",
          userId: "",
        })
      ).toThrow("userId");
    });

    it("surfaces unobserved broadcasts as drift items for operator follow-up", async () => {
      service.registerWorkflowBroadcast({
        workflowId: "wf-stale-9",
        workflowType: "batch_payout",
        userId: "user-9",
        network: "testnet",
        txHash: "0xnever_observed_hash",
        broadcastAt: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
      });

      const broadcastDrift = service
        .toDriftItems()
        .filter((item) => item.type === "workflow_broadcast_unobserved");
      expect(broadcastDrift).toHaveLength(1);
      expect(broadcastDrift[0].entityId).toBe("wf-stale-9");
      expect(broadcastDrift[0].severity).toBe("major");

      // Once the hash is observed the workflow is no longer reported as stale.
      await service.ingestAndReconcile({
        source: "indexer",
        network: "testnet",
        importedBy: "operator-9",
        rawTransactions: [
          {
            txHash: "0xnever_observed_hash",
            sourceAddress: "G_WALLET_9",
            amount: "12",
          },
        ],
      });

      expect(
        service
          .toDriftItems()
          .filter((item) => item.type === "workflow_broadcast_unobserved")
      ).toHaveLength(0);
    });

    it("includes workflow attribution in operator-facing drift items", async () => {
      service.registerWorkflowBroadcast({
        workflowId: "wf-drift-10",
        workflowType: "agent_plan",
        userId: "user-10",
        network: "testnet",
        txHash: "0xdrift_broadcast_hash",
      });

      await service.ingestAndReconcile({
        source: "horizon",
        network: "testnet",
        importedBy: "operator-10",
        rawTransactions: [
          {
            txHash: "0xdrift_broadcast_hash",
            sourceAddress: "G_WALLET_10",
            amount: "31",
            asset: "USDC",
          },
        ],
      });

      const driftItems = service.toDriftItems();
      expect(driftItems).toHaveLength(1);
      expect(driftItems[0].type).toBe("external_activity_unmatched");
      expect(driftItems[0].description).toContain("wf-drift-10");
      expect(driftItems[0].onChainValue).toMatchObject({
        workflowLink: { workflowId: "wf-drift-10", strategy: "tx_hash" },
      });
    });
  });
});
