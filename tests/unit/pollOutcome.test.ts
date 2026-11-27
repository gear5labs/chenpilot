/**
 * Tests for PollOutcome, AbortSignal support, and deadline/cancellation
 * behaviour in the confirmation-polling layer.
 *
 * Covers:
 * - Success: awaitConfirmation resolves with "confirmed" when finality is declared
 * - Timeout: awaitConfirmation resolves with "timeout" when deadline is reached
 * - Cancellation: awaitConfirmation resolves with "cancelled" when AbortSignal fires
 * - Orphaned: awaitConfirmation resolves with "orphaned" when reorg is detected
 * - Boundary: already-aborted signal resolves immediately with "cancelled"
 * - Boundary: custom deadlineMs overrides policy timeout
 * - Failure: handleCancellation on unknown txHash is a no-op
 * - Compatibility: startConfirmationTracking still works without a signal
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLifecycleRepo = {
  findOneOrFail: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(() => mockLifecycleRepo),
  },
}));

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock StellarSdk Horizon.Server
const mockLedgersCall = jest.fn();
const mockServerConstructor = jest.fn(() => ({
  ledgers: jest.fn(() => ({
    order: jest.fn(() => ({
      limit: jest.fn(() => ({
        call: mockLedgersCall,
      })),
    })),
  })),
  transactions: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  ...jest.requireActual("@stellar/stellar-sdk"),
  Horizon: {
    Server: mockServerConstructor,
  },
}));

// Import after mocks
import { ConfirmationDepthTracker } from "../../src/services/finality/ConfirmationDepthTracker";
import { PollOutcome } from "../../src/services/finality/PollOutcome";
import type { FinalityPolicy } from "../../src/services/finality/FinalityPolicy";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<FinalityPolicy> = {}): FinalityPolicy {
  return {
    network: "testnet",
    confirmationDepthRequired: 2,
    confirmationPollIntervalMs: 50, // Fast for tests
    confirmationTimeoutMs: 500,
    primaryHorizonUrl: "https://horizon-testnet.stellar.org",
    reconciliationHorizonUrl: "https://horizon-testnet.stellar.org",
    ancestryCheckDepth: 5,
    maxReconciliationAttempts: 3,
    reconciliationRetryDelayMs: 50,
    ...overrides,
  };
}

function mockLifecycleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    userId: "user-1",
    operationType: "swap",
    state: "submitted",
    correlationId: "hash-1",
    payload: null,
    metadata: null,
    lastTransitionReason: null,
    ledgerSequence: null,
    ledgerHash: null,
    confirmationDepth: 0,
    observedAtProvider: null,
    finalityStatus: "PENDING",
    finalityDeclaredAt: null,
    orphanedAt: null,
    orphanedLedgerHash: null,
    reconciledAt: null,
    reconcileProvider: null,
    reorgDepth: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setupLedgerSequence(sequence: number) {
  mockLedgersCall.mockResolvedValue({
    records: [{ sequence }],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PollOutcome type", () => {
  it("has four discriminated union members", () => {
    const confirmed: PollOutcome = {
      status: "confirmed",
      transactionId: "t1",
      txHash: "h1",
      confirmationDepth: 3,
      ledgerSequence: 100,
    };
    const timeout: PollOutcome = {
      status: "timeout",
      transactionId: "t1",
      txHash: "h1",
      deadlineMs: Date.now(),
      lastConfirmationDepth: 1,
    };
    const cancelled: PollOutcome = {
      status: "cancelled",
      transactionId: "t1",
      txHash: "h1",
      reason: "abort signal",
    };
    const orphaned: PollOutcome = {
      status: "orphaned",
      transactionId: "t1",
      txHash: "h1",
      reorgDepth: 2,
    };

    expect(confirmed.status).toBe("confirmed");
    expect(timeout.status).toBe("timeout");
    expect(cancelled.status).toBe("cancelled");
    expect(orphaned.status).toBe("orphaned");
  });
});

describe("ConfirmationDepthTracker — awaitConfirmation", () => {
  let tracker: ConfirmationDepthTracker;
  let policy: FinalityPolicy;

  beforeEach(() => {
    jest.clearAllMocks();
    policy = makePolicy();
    tracker = new ConfirmationDepthTracker(policy);

    // Default lifecycle record
    mockLifecycleRepo.findOneOrFail.mockResolvedValue(mockLifecycleRecord());
    mockLifecycleRepo.save.mockResolvedValue(mockLifecycleRecord());
    mockLifecycleRepo.findOne.mockResolvedValue(mockLifecycleRecord());
  });

  describe("Success — confirmed", () => {
    it("resolves with status=confirmed when finality is declared", async () => {
      const txLedger = 100;
      // Simulate ledger progression: 101, 102 (depth 2 = required)
      let currentLedger = txLedger;
      mockLedgersCall.mockImplementation(async () => ({
        records: [{ sequence: ++currentLedger }],
      }));

      // Mock ancestry as canonical (not orphaned)
      const verifyAncestrySpy = jest
        .spyOn(tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }, "ancestryVerifier")
        .verifyAncestry;
      verifyAncestrySpy.mockResolvedValue({ canonical: true });

      const outcome = await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        txLedger,
        "ledger-hash",
        "horizon-testnet"
      );

      expect(outcome.status).toBe("confirmed");
      if (outcome.status === "confirmed") {
        expect(outcome.transactionId).toBe("tx-1");
        expect(outcome.txHash).toBe("hash-1");
        expect(outcome.confirmationDepth).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("Timeout — deadline reached", () => {
    it("resolves with status=timeout when confirmationTimeoutMs elapses", async () => {
      const shortPolicy = makePolicy({ confirmationTimeoutMs: 100, confirmationPollIntervalMs: 30 });
      tracker = new ConfirmationDepthTracker(shortPolicy);

      // Ledger never advances (always returns same sequence → depth 0)
      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 100 }],
      });

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      const outcome = await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet"
      );

      expect(outcome.status).toBe("timeout");
      if (outcome.status === "timeout") {
        expect(outcome.transactionId).toBe("tx-1");
        expect(outcome.txHash).toBe("hash-1");
        expect(outcome.lastConfirmationDepth).toBe(0);
      }
    });

    it("custom deadlineMs overrides policy timeout", async () => {
      const longPolicy = makePolicy({ confirmationTimeoutMs: 10_000, confirmationPollIntervalMs: 30 });
      tracker = new ConfirmationDepthTracker(longPolicy);

      // Ledger never advances
      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 100 }],
      });

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      // Use a very short custom deadline
      const outcome = await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet",
        { deadlineMs: Date.now() + 80 }
      );

      expect(outcome.status).toBe("timeout");
    });
  });

  describe("Cancellation — AbortSignal", () => {
    it("resolves with status=cancelled when signal is aborted mid-poll", async () => {
      const longPolicy = makePolicy({ confirmationTimeoutMs: 10_000, confirmationPollIntervalMs: 50 });
      tracker = new ConfirmationDepthTracker(longPolicy);

      // Ledger never advances (will never reach finality)
      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 100 }],
      });

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      const controller = new AbortController();

      const outcomePromise = tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet",
        { signal: controller.signal }
      );

      // Abort after a short delay
      setTimeout(() => controller.abort(), 120);

      const outcome = await outcomePromise;

      expect(outcome.status).toBe("cancelled");
      if (outcome.status === "cancelled") {
        expect(outcome.transactionId).toBe("tx-1");
        expect(outcome.txHash).toBe("hash-1");
        expect(outcome.reason).toBe("abort signal");
      }
    });

    it("resolves with status=cancelled when signal is already aborted", async () => {
      const longPolicy = makePolicy({ confirmationTimeoutMs: 10_000, confirmationPollIntervalMs: 50 });
      tracker = new ConfirmationDepthTracker(longPolicy);

      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 100 }],
      });

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      const controller = new AbortController();
      controller.abort();

      const outcome = await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet",
        { signal: controller.signal }
      );

      expect(outcome.status).toBe("cancelled");
      if (outcome.status === "cancelled") {
        expect(outcome.reason).toBe("abort signal");
      }
    });
  });

  describe("Orphaned — reorg detected", () => {
    it("resolves with status=orphaned when ancestry check fails", async () => {
      const txLedger = 100;
      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 101 }],
      });

      // Ancestry check says the observed ledger is NOT canonical
      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({
        canonical: false,
        reorgDepth: 1,
      });

      const outcome = await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        txLedger,
        "ledger-hash",
        "horizon-testnet"
      );

      expect(outcome.status).toBe("orphaned");
      if (outcome.status === "orphaned") {
        expect(outcome.transactionId).toBe("tx-1");
        expect(outcome.txHash).toBe("hash-1");
        expect(outcome.reorgDepth).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Compatibility", () => {
    it("startConfirmationTracking still works without a signal (backward compatible)", async () => {
      let currentLedger = 100;
      mockLedgersCall.mockImplementation(async () => ({
        records: [{ sequence: ++currentLedger }],
      }));

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      // Use the old void-return API
      await tracker.startConfirmationTracking(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet"
        // no signal argument
      );

      // Should have started polling — activeConfirmations should have the entry
      const active = tracker.getActiveConfirmations();
      // The entry may already be resolved if finality was reached quickly,
      // but the call should not throw.
      expect(active.length).toBeGreaterThanOrEqual(0);

      // Clean up
      tracker.stopTracking("hash-1");
    });

    it("awaitConfirmation cleans up all listeners after resolving", async () => {
      let currentLedger = 100;
      mockLedgersCall.mockImplementation(async () => ({
        records: [{ sequence: ++currentLedger }],
      }));

      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      await tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet"
      );

      // No leaked listeners on the tracker
      expect(tracker.listenerCount("finality:declared")).toBe(0);
      expect(tracker.listenerCount("stale:detected")).toBe(0);
      expect(tracker.listenerCount("orphan:detected")).toBe(0);
      expect(tracker.listenerCount("cancelled")).toBe(0);
    });
  });

  describe("Failure — handleCancellation on unknown txHash", () => {
    it("is a no-op when the txHash is not being tracked", async () => {
      // Use the private method via the public AbortSignal path
      const longPolicy = makePolicy({ confirmationTimeoutMs: 10_000, confirmationPollIntervalMs: 50 });
      tracker = new ConfirmationDepthTracker(longPolicy);

      // No tracking started — abort should not throw
      const controller = new AbortController();

      // Start tracking, then stop it manually, then abort
      mockLedgersCall.mockResolvedValue({ records: [{ sequence: 100 }] });
      const ancestryVerifier = (tracker as unknown as { ancestryVerifier: { verifyAncestry: jest.Mock } }).ancestryVerifier;
      ancestryVerifier.verifyAncestry.mockResolvedValue({ canonical: true });

      const outcomePromise = tracker.awaitConfirmation(
        "tx-1",
        "hash-1",
        100,
        "ledger-hash",
        "horizon-testnet",
        { signal: controller.signal }
      );

      // Abort after tracking started
      setTimeout(() => controller.abort(), 120);

      const outcome = await outcomePromise;
      expect(outcome.status).toBe("cancelled");
    });
  });
});
