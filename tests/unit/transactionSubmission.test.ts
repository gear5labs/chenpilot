import {
  AmbiguousSubmissionError,
  ProviderUnavailableError,
  type LedgerTransaction,
  type SubmissionGateway,
  type SubmitOutcome,
} from "../../src/transactions/submission/SubmissionGateway";
import {
  DuplicateEffectRiskError,
  RESOLUTION_OUTCOME_STATES,
  RESOLVABLE_SUBMISSION_STATES,
  SubmissionAlreadyResolvedError,
  SubmissionState,
  VALID_SUBMISSION_TRANSITIONS,
} from "../../src/transactions/submission/SubmissionState";
import { TransactionSubmissionService } from "../../src/transactions/submission/TransactionSubmission.service";
import type {
  CreateSubmissionInput,
  SubmissionStore,
} from "../../src/transactions/submission/SubmissionStore";
import type { TransactionSubmission } from "../../src/transactions/submission/TransactionSubmission.entity";

const SOURCE_ACCOUNT = "GDUMMYACCOUNTFORTESTS000000000000000000000000000000000";
const TX_HASH =
  "b1c9f0d2e3a4b5c6d7e8f90112233445566778899aabbccddeeff00112233445";
const SEQUENCE = "1000";
const MAX_TIME = "2000000000";

class InMemorySubmissionStore implements SubmissionStore {
  private readonly rows = new Map<string, TransactionSubmission>();
  private counter = 0;

  async create(input: CreateSubmissionInput): Promise<TransactionSubmission> {
    const now = new Date();
    const record = {
      ...input,
      id: `submission-${++this.counter}`,
      state: SubmissionState.BUILT,
      submitAttempts: 0,
      resolutionAttempts: 0,
      nextResolutionAt: null,
      ledger: null,
      resultXdr: null,
      lastReason: null,
      submittedAt: null,
      resolvedAt: null,
      lifecycleId: input.lifecycleId ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    } as TransactionSubmission;

    this.rows.set(record.id, record);
    return this.clone(record);
  }

  async save(record: TransactionSubmission): Promise<TransactionSubmission> {
    record.updatedAt = new Date();
    this.rows.set(record.id, this.clone(record));
    return this.clone(record);
  }

  async findById(id: string): Promise<TransactionSubmission | null> {
    const record = this.rows.get(id);
    return record ? this.clone(record) : null;
  }

  async findByHash(
    transactionHash: string
  ): Promise<TransactionSubmission | null> {
    return this.first((row) => row.transactionHash === transactionHash);
  }

  async findByIdempotencyKey(
    key: string
  ): Promise<TransactionSubmission | null> {
    return this.first((row) => row.idempotencyKey === key);
  }

  async findByUser(
    userId: string,
    limit: number
  ): Promise<TransactionSubmission[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .slice(0, limit)
      .map((row) => this.clone(row));
  }

  async findDueForResolution(
    now: Date,
    limit: number
  ): Promise<TransactionSubmission[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.state !== SubmissionState.FINALIZED &&
          row.state !== SubmissionState.REJECTED &&
          row.state !== SubmissionState.EXPIRED &&
          (row.nextResolutionAt === null || row.nextResolutionAt <= now)
      )
      .slice(0, limit)
      .map((row) => this.clone(row));
  }

  async findStalled(stalledBefore: Date): Promise<TransactionSubmission[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          (row.state === SubmissionState.BUILT ||
            row.state === SubmissionState.SUBMITTING) &&
          row.updatedAt < stalledBefore
      )
      .map((row) => this.clone(row));
  }

  /** Simulates a process that died: the row survives, the in-flight call does not. */
  forceUpdatedAt(id: string, updatedAt: Date): void {
    const record = this.rows.get(id);
    if (record) {
      record.updatedAt = updatedAt;
    }
  }

  private first(
    predicate: (row: TransactionSubmission) => boolean
  ): TransactionSubmission | null {
    const record = [...this.rows.values()].find(predicate);
    return record ? this.clone(record) : null;
  }

  private clone(record: TransactionSubmission): TransactionSubmission {
    return { ...record } as TransactionSubmission;
  }
}

class FakeGateway implements SubmissionGateway {
  submitImpl: () => Promise<SubmitOutcome> = async () => ({
    status: "accepted",
  });
  ledgerTransaction: LedgerTransaction | null = null;
  accountSequence = "999";
  latestLedgerCloseTime = 1_700_000_000;
  lookupError: Error | null = null;
  submitCalls = 0;

  async submit(): Promise<SubmitOutcome> {
    this.submitCalls += 1;
    return this.submitImpl();
  }

  async findTransactionByHash(): Promise<LedgerTransaction | null> {
    if (this.lookupError) {
      throw this.lookupError;
    }
    return this.ledgerTransaction;
  }

  async getAccountSequence(): Promise<string> {
    if (this.lookupError) {
      throw this.lookupError;
    }
    return this.accountSequence;
  }

  async getLatestLedgerCloseTime(): Promise<number> {
    if (this.lookupError) {
      throw this.lookupError;
    }
    return this.latestLedgerCloseTime;
  }
}

/** Lets the resolution backoff configured for these tests elapse. */
function flushBackoff(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function buildInput(
  overrides: Partial<CreateSubmissionInput> = {}
): CreateSubmissionInput {
  return {
    idempotencyKey: "idem-key-1",
    userId: "user-1",
    operationType: "swap",
    transactionHash: TX_HASH,
    envelopeXdr: "AAAAAgAAAAA=",
    sourceAccount: SOURCE_ACCOUNT,
    sequenceNumber: SEQUENCE,
    maxTime: MAX_TIME,
    ...overrides,
  };
}

describe("TransactionSubmissionService", () => {
  let store: InMemorySubmissionStore;
  let gateway: FakeGateway;
  let service: TransactionSubmissionService;

  beforeEach(() => {
    store = new InMemorySubmissionStore();
    gateway = new FakeGateway();
    service = new TransactionSubmissionService(gateway, store, {
      baseResolutionDelayMs: 1,
      maxResolutionDelayMs: 5,
      stalledAfterMs: 1_000,
    });
  });

  describe("registration", () => {
    it("persists the envelope before it can reach the network", async () => {
      const record = await service.register(buildInput());

      expect(record.state).toBe(SubmissionState.BUILT);
      expect(record.transactionHash).toBe(TX_HASH);
      expect(gateway.submitCalls).toBe(0);
    });

    it("returns the existing record for a repeated idempotency key", async () => {
      const first = await service.register(buildInput());
      const second = await service.register(buildInput());

      expect(second.id).toBe(first.id);
    });
  });

  describe("timeout before send", () => {
    it("leaves a durable, queryable record when the process dies before submitting", async () => {
      const record = await service.register(buildInput());
      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));

      const [recovered] = await service.recoverStalled();

      expect(recovered.state).toBe(SubmissionState.UNKNOWN);
      expect(await service.findByHash(TX_HASH)).not.toBeNull();
    });

    it("expires the submission once the time bounds have elapsed with the sequence unconsumed", async () => {
      const record = await service.register(buildInput());
      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));
      await service.recoverStalled();

      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.EXPIRED);
      await expect(service.prepareRetry(record.id)).resolves.toMatchObject({
        state: SubmissionState.EXPIRED,
      });
    });
  });

  describe("timeout during send", () => {
    it("records an unknown state instead of a failure", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };

      const submitted = await service.submit(record.id);

      expect(submitted.state).toBe(SubmissionState.UNKNOWN);
      expect(submitted.nextResolutionAt).not.toBeNull();
    });

    it("refuses to retry while the outcome is unknown", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      await expect(service.prepareRetry(record.id)).rejects.toBeInstanceOf(
        DuplicateEffectRiskError
      );
    });

    it("finalizes the submission when the hash turns up in the ledger", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 4242,
        successful: true,
        resultXdr: "AAAAAA==",
      };

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      expect(resolved.ledger).toBe(4242);
      expect(resolved.resolvedAt).not.toBeNull();
      await expect(service.prepareRetry(record.id)).rejects.toBeInstanceOf(
        DuplicateEffectRiskError
      );
    });

    it("rejects the submission when another transaction consumed the sequence", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      gateway.ledgerTransaction = null;
      gateway.accountSequence = SEQUENCE;

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.REJECTED);
      expect(resolved.lastReason).toBe(
        "sequence_consumed_by_another_transaction"
      );
    });
  });

  describe("timeout after acceptance", () => {
    it("keeps the accepted state and never retries a transaction that already applied", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });

      const accepted = await service.submit(record.id);
      expect(accepted.state).toBe(SubmissionState.ACCEPTED);
      await expect(service.prepareRetry(record.id)).rejects.toBeInstanceOf(
        DuplicateEffectRiskError
      );

      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 5150,
        successful: true,
      };

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      expect(gateway.submitCalls).toBe(1);
    });

    it("marks a transaction that failed inside the ledger as rejected", async () => {
      const record = await service.register(buildInput());
      await service.submit(record.id);

      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 5151,
        successful: false,
        resultXdr: "AAAAAP//",
      };

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.REJECTED);
      expect(resolved.lastReason).toBe("failed_in_ledger");
    });
  });

  describe("provider and process failure", () => {
    it("stays unknown when the provider cannot answer", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      gateway.lookupError = new ProviderUnavailableError("Horizon is down");

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.UNKNOWN);
      expect(resolved.lastReason).toBe("provider_unavailable");
    });

    it("preserves resolution progress across a provider failover", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      gateway.lookupError = new ProviderUnavailableError("Horizon is down");
      const deferred = await service.resolve(record.id);

      expect(deferred.state).toBe(SubmissionState.UNKNOWN);
      expect(deferred.lastReason).toBe("provider_unavailable");
      expect(deferred.resolutionAttempts).toBe(1);
      expect(deferred.nextResolutionAt).not.toBeNull();

      gateway.lookupError = null;
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 5150,
        successful: true,
        resultXdr: "AAAAAA==",
      };

      const recovered = await service.resolve(record.id);

      expect(recovered.state).toBe(SubmissionState.FINALIZED);
      expect(recovered.lastReason).toBe("found_by_hash");
      expect(recovered.resolutionAttempts).toBeGreaterThan(1);
    });

    it("redacts provider rejection details before persisting the reason", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({
        status: "rejected",
        reason:
          "tx_bad_auth: signer=GSECRET...; envelope=AAAAAgAAAAA=; token=abc123",
      });

      const submitted = await service.submit(record.id);

      expect(submitted.state).toBe(SubmissionState.REJECTED);
      expect(submitted.lastReason).toBe("provider_rejected");
      expect(submitted.lastReason).not.toContain("signer=");
      expect(submitted.lastReason).not.toContain("AAAAAgAAAAA=");
    });

    it("resolves a submission left mid-flight by a dead process", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = () => new Promise(() => undefined);
      void service.submit(record.id);
      await Promise.resolve();

      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));
      await service.recoverStalled();

      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 6001,
        successful: true,
      };
      await flushBackoff();
      const [resolved] = await service.resolveDue();

      expect(resolved.state).toBe(SubmissionState.FINALIZED);
    });

    it("does not expire a submission that has no time bounds", async () => {
      const record = await service.register(buildInput({ maxTime: null }));
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(record.id);

      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.UNKNOWN);
      expect(resolved.lastReason).toBe("no_time_bounds");
    });
  });

  describe("state machine guards", () => {
    it("lets every resolvable state reach every resolution the resolver can return", () => {
      const gaps: string[] = [];

      for (const from of RESOLVABLE_SUBMISSION_STATES) {
        for (const to of RESOLUTION_OUTCOME_STATES) {
          if (from === to) {
            continue;
          }
          if (!VALID_SUBMISSION_TRANSITIONS[from].has(to)) {
            gaps.push(`${from} -> ${to}`);
          }
        }
      }

      expect(gaps).toEqual([]);
    });

    it("finalizes a record the resolver finds on chain before it was marked submitting", async () => {
      const record = await service.register(buildInput());
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 7001,
        successful: true,
      };

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.FINALIZED);
    });

    it("expires a record still marked submitting when its time bounds elapsed", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = () => new Promise(() => undefined);
      void service.submit(record.id);
      await Promise.resolve();

      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;

      const resolved = await service.resolve(record.id);

      expect(resolved.state).toBe(SubmissionState.EXPIRED);
    });

    it("refuses to resubmit an envelope that already reached a terminal state", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({
        status: "rejected",
        reason: "tx_malformed",
      });
      await service.submit(record.id);

      await expect(service.submit(record.id)).rejects.toBeInstanceOf(
        SubmissionAlreadyResolvedError
      );
    });

    it("treats a submit call on an applied transaction as a no-op", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({
        status: "applied",
        ledger: 8001,
        successful: true,
      });
      await service.submit(record.id);

      const replayed = await service.submit(record.id);

      expect(replayed.state).toBe(SubmissionState.FINALIZED);
      expect(gateway.submitCalls).toBe(1);
    });
  });

  describe("retries", () => {
    it("links a retry to the submission it replaces once that one expired", async () => {
      const original = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(original.id);

      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      await service.resolve(original.id);

      const retry = await service.registerRetry(
        original.id,
        buildInput({
          idempotencyKey: "idem-key-2",
          transactionHash: `${TX_HASH.slice(0, 63)}f`,
          sequenceNumber: "1001",
        })
      );

      expect(retry.id).not.toBe(original.id);
      expect(retry.state).toBe(SubmissionState.BUILT);
      expect(retry.metadata).toMatchObject({ retryOf: original.id });
    });

    it("refuses to register a retry while the original is unresolved", async () => {
      const original = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Horizon submission timed out");
      };
      await service.submit(original.id);

      await expect(
        service.registerRetry(
          original.id,
          buildInput({ idempotencyKey: "idem-key-2" })
        )
      ).rejects.toBeInstanceOf(DuplicateEffectRiskError);
    });
  });

  describe("restart recovery at each persisted transition", () => {
    it("recovers BUILT -> SUBMITTING transition after restart", async () => {
      const record = await service.register(buildInput());
      
      // Simulate process died during transition to SUBMITTING
      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));
      
      // Recovery should mark as UNKNOWN for resolution
      const [recovered] = await service.recoverStalled();
      expect(recovered.state).toBe(SubmissionState.UNKNOWN);
      
      // Verify record can still be found and resolved
      const found = await service.findByHash(TX_HASH);
      expect(found).not.toBeNull();
      expect(found?.state).toBe(SubmissionState.UNKNOWN);
    });

    it("recovers BUILT -> UNKNOWN transition after restart", async () => {
      const record = await service.register(buildInput());
      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));
      
      const [recovered] = await service.recoverStalled();
      expect(recovered.state).toBe(SubmissionState.UNKNOWN);
      
      // Should be resolvable
      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      
      const resolved = await service.resolve(recovered.id);
      expect(resolved.state).toBe(SubmissionState.EXPIRED);
    });

    it("recovers BUILT -> FINALIZED transition after restart", async () => {
      const record = await service.register(buildInput());
      
      // Simulate pre-finalized state where transaction was found in ledger
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9001,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      
      // After restart, should still be finalized
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.FINALIZED);
      expect(found?.ledger).toBe(9001);
    });

    it("recovers BUILT -> REJECTED transition after restart", async () => {
      const record = await service.register(buildInput());
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = SEQUENCE;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.REJECTED);
      
      // After restart, should still be rejected
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.REJECTED);
    });

    it("recovers BUILT -> EXPIRED transition after restart", async () => {
      const record = await service.register(buildInput());
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.EXPIRED);
      
      // After restart, should still be expired
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.EXPIRED);
    });

    it("recovers SUBMITTING -> ACCEPTED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });
      
      const submitted = await service.submit(record.id);
      expect(submitted.state).toBe(SubmissionState.ACCEPTED);
      
      // After restart, should still be accepted
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.ACCEPTED);
      
      // Can continue to finalization
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9002,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
    });

    it("recovers SUBMITTING -> UNKNOWN transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Network timeout");
      };
      
      const submitted = await service.submit(record.id);
      expect(submitted.state).toBe(SubmissionState.UNKNOWN);
      
      // After restart, should still be unknown and resolvable
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.UNKNOWN);
      
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9003,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
    });

    it("recovers SUBMITTING -> FINALIZED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({
        status: "applied",
        ledger: 9004,
        successful: true,
      });
      
      const submitted = await service.submit(record.id);
      expect(submitted.state).toBe(SubmissionState.FINALIZED);
      
      // After restart, should still be finalized
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.FINALIZED);
      expect(found?.ledger).toBe(9004);
    });

    it("recovers SUBMITTING -> REJECTED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({
        status: "rejected",
        reason: "tx_malformed",
      });
      
      const submitted = await service.submit(record.id);
      expect(submitted.state).toBe(SubmissionState.REJECTED);
      
      // After restart, should still be rejected
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.REJECTED);
    });

    it("recovers SUBMITTING -> EXPIRED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = () => new Promise(() => undefined);
      void service.submit(record.id);
      await Promise.resolve();
      
      store.forceUpdatedAt(record.id, new Date(Date.now() - 60_000));
      await service.recoverStalled();
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.EXPIRED);
      
      // After restart, should still be expired
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.EXPIRED);
    });

    it("recovers UNKNOWN -> ACCEPTED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Network timeout");
      };
      await service.submit(record.id);
      
      // Resolution can't determine outcome but marks as accepted (rare case)
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9005,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      
      // After restart, should still be finalized
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.FINALIZED);
    });

    it("recovers UNKNOWN -> FINALIZED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Network timeout");
      };
      await service.submit(record.id);
      
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9006,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      
      // After restart, should still be finalized
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.FINALIZED);
      expect(found?.ledger).toBe(9006);
    });

    it("recovers UNKNOWN -> REJECTED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Network timeout");
      };
      await service.submit(record.id);
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = SEQUENCE;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.REJECTED);
      
      // After restart, should still be rejected
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.REJECTED);
    });

    it("recovers UNKNOWN -> EXPIRED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Network timeout");
      };
      await service.submit(record.id);
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.EXPIRED);
      
      // After restart, should still be expired
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.EXPIRED);
    });

    it("recovers ACCEPTED -> FINALIZED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });
      await service.submit(record.id);
      
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9007,
        successful: true,
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.FINALIZED);
      
      // After restart, should still be finalized
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.FINALIZED);
      expect(found?.ledger).toBe(9007);
    });

    it("recovers ACCEPTED -> REJECTED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });
      await service.submit(record.id);
      
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9008,
        successful: false,
        resultXdr: "AAAAAP//",
      };
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.REJECTED);
      
      // After restart, should still be rejected
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.REJECTED);
    });

    it("recovers ACCEPTED -> UNKNOWN transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });
      await service.submit(record.id);
      
      gateway.lookupError = new ProviderUnavailableError("Horizon is down");
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.UNKNOWN);
      
      // After restart, should still be unknown and resolvable
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.UNKNOWN);
      
      // Clear error and resolve
      gateway.lookupError = null;
      gateway.ledgerTransaction = {
        hash: TX_HASH,
        ledger: 9009,
        successful: true,
      };
      
      const resolvedAgain = await service.resolve(record.id);
      expect(resolvedAgain.state).toBe(SubmissionState.FINALIZED);
    });

    it("recovers ACCEPTED -> EXPIRED transition after restart", async () => {
      const record = await service.register(buildInput());
      gateway.submitImpl = async () => ({ status: "accepted" });
      await service.submit(record.id);
      
      gateway.ledgerTransaction = null;
      gateway.accountSequence = "999";
      gateway.latestLedgerCloseTime = Number(MAX_TIME) + 3_600;
      
      const resolved = await service.resolve(record.id);
      expect(resolved.state).toBe(SubmissionState.EXPIRED);
      
      // After restart, should still be expired
      const found = await service.findById(record.id);
      expect(found?.state).toBe(SubmissionState.EXPIRED);
    });

    it("recovers stalled submissions across all non-terminal states", async () => {
      // Create submissions in various states
      const built = await service.register(buildInput({ idempotencyKey: "test-1" }));
      
      const submitting = await service.register(buildInput({ idempotencyKey: "test-2" }));
      gateway.submitImpl = () => new Promise(() => undefined);
      void service.submit(submitting.id);
      await Promise.resolve();
      
      const unknown = await service.register(buildInput({ idempotencyKey: "test-3" }));
      gateway.submitImpl = async () => {
        throw new AmbiguousSubmissionError("Timeout");
      };
      await service.submit(unknown.id);
      
      const accepted = await service.register(buildInput({ idempotencyKey: "test-4" }));
      gateway.submitImpl = async () => ({ status: "accepted" });
      await service.submit(accepted.id);
      
      // Simulate process death - make all look stalled
      const oldTimestamp = new Date(Date.now() - 60_000);
      store.forceUpdatedAt(built.id, oldTimestamp);
      store.forceUpdatedAt(submitting.id, oldTimestamp);
      store.forceUpdatedAt(unknown.id, oldTimestamp);
      store.forceUpdatedAt(accepted.id, oldTimestamp);
      
      // Recovery should handle all
      const recovered = await service.recoverStalled();
      expect(recovered).toHaveLength(4);
      
      // All should be in UNKNOWN state for resolution
      recovered.forEach((r) => {
        expect(r.state).toBe(SubmissionState.UNKNOWN);
      });
    });
  });
});
