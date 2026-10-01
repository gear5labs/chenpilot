/**
 * Regression tests for ledger-time claim eligibility — Issue #833
 *
 * A claimable balance whose claim window has not opened (or has already shut)
 * is rejected by the network with an opaque error. The SDK now explains the
 * verdict from the claim predicates and the ledger close time before anything
 * is signed.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { claimBalance, getClaimEligibility } from "../claimableBalance";

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  const server = {
    claimableBalances: jest.fn(),
    ledgers: jest.fn(),
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  };

  return {
    __esModule: true,
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn(() => server),
    },
    __mockServer: server,
  };
});

type MockServer = {
  claimableBalances: jest.Mock;
  ledgers: jest.Mock;
  loadAccount: jest.Mock;
  submitTransaction: jest.Mock;
};

const server = (StellarSdk as unknown as { __mockServer: MockServer })
  .__mockServer;
const { Keypair } = StellarSdk;

const BALANCE_ID = "0".repeat(72);
const NOW = 1_700_000_000;
const nowIso = (seconds: number) => new Date(seconds * 1000).toISOString();

const claimant = Keypair.random();

interface BalanceRecordOverrides {
  predicate?: unknown;
  claimant?: string;
  createdAt?: string;
}

function balanceRecord(overrides: BalanceRecordOverrides = {}) {
  return {
    id: BALANCE_ID,
    asset: "native",
    amount: "25",
    sponsor: "GSPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    last_modified_time: overrides.createdAt ?? nowIso(NOW - 600),
    claimants: [
      {
        destination: overrides.claimant ?? claimant.publicKey(),
        predicate: overrides.predicate ?? {},
      },
    ],
  };
}

function ledgerResponse(close: { close_time?: number; closed_at?: string }) {
  return {
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: [close] }),
  };
}

function stubBalance(record: unknown) {
  server.claimableBalances.mockReturnValue({
    claimableBalance: jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue(record),
    }),
  });
}

describe("claimable balance eligibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockRejectedValue(new Error("network unreachable"));
    server.submitTransaction.mockResolvedValue({ hash: "deadbeef" });
  });

  describe("getClaimEligibility", () => {
    it("uses a supplied ledger time without asking Horizon", async () => {
      stubBalance(
        balanceRecord({ predicate: { abs_before: String(NOW + 3600) } })
      );

      const verdict = await getClaimEligibility({
        balanceId: BALANCE_ID,
        claimant: claimant.publicKey(),
        ledgerTime: NOW,
      });

      expect(verdict.eligible).toBe(true);
      expect(verdict.evaluated).toBe(true);
      expect(verdict.ledgerTime).toBe(NOW);
      expect(verdict.ledgerTimeIso).toBe(nowIso(NOW));
      expect(verdict.claimExpiresAt).toBe(nowIso(NOW + 3600));
      expect(verdict.reason).toContain("Claimable now");
      expect(server.ledgers).not.toHaveBeenCalled();
    });

    it("reads the latest ledger close time from Horizon when none is supplied", async () => {
      stubBalance(
        balanceRecord({ predicate: { abs_before: String(NOW + 60) } })
      );
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const verdict = await getClaimEligibility({
        balanceId: BALANCE_ID,
        claimant: claimant.publicKey(),
      });

      expect(verdict.ledgerTime).toBe(NOW);
      expect(verdict.eligible).toBe(true);
      expect(verdict.claimExpiresAt).toBe(nowIso(NOW + 60));
      expect(server.ledgers).toHaveBeenCalledTimes(1);
    });

    it("falls back to the ledger's ISO close time", async () => {
      stubBalance(balanceRecord({ predicate: {} }));
      server.ledgers.mockReturnValue(
        ledgerResponse({ closed_at: nowIso(NOW) })
      );

      const verdict = await getClaimEligibility({
        balanceId: BALANCE_ID,
        claimant: claimant.publicKey(),
      });

      expect(verdict.ledgerTime).toBe(NOW);
      expect(verdict.eligible).toBe(true);
    });

    it("explains that the balance is closed once the ledger time has passed", async () => {
      stubBalance(
        balanceRecord({ predicate: { abs_before: String(NOW - 60) } })
      );
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const verdict = await getClaimEligibility({
        balanceId: BALANCE_ID,
        claimant: claimant.publicKey(),
      });

      expect(verdict.eligible).toBe(false);
      expect(verdict.evaluated).toBe(true);
      expect(verdict.claimExpiresAt).toBe(nowIso(NOW - 60));
      expect(verdict.reason).toContain("claim window closed at");
    });

    it("rejects an account that is not a claimant", async () => {
      stubBalance(
        balanceRecord({ claimant: Keypair.random().publicKey(), predicate: {} })
      );
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const verdict = await getClaimEligibility({
        balanceId: BALANCE_ID,
        claimant: claimant.publicKey(),
      });

      expect(verdict.eligible).toBe(false);
      expect(verdict.evaluated).toBe(true);
      expect(verdict.reason).toContain("is not a claimant");
    });

    it("throws when the ledger close time cannot be read", async () => {
      stubBalance(balanceRecord({ predicate: {} }));
      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(new Error("horizon down")),
      });

      await expect(
        getClaimEligibility({
          balanceId: BALANCE_ID,
          claimant: claimant.publicKey(),
        })
      ).rejects.toThrow(/ledger close time could not be read/);
    });
  });

  describe("claimBalance", () => {
    it("refuses to sign a claim whose window has not opened", async () => {
      stubBalance(
        balanceRecord({ predicate: { not: { abs_before: String(NOW - 60) } } })
      );
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const result = await claimBalance({
        balanceId: BALANCE_ID,
        claimantSecret: claimant.secret(),
        ledgerTime: NOW - 7200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("claim window opens at");
      expect(result.eligibility?.eligible).toBe(false);
      expect(result.eligibility?.evaluated).toBe(true);
      expect(result.eligibility?.claimableAt).toBe(nowIso(NOW - 60));
      expect(server.loadAccount).not.toHaveBeenCalled();
      expect(server.submitTransaction).not.toHaveBeenCalled();
    });

    it("refuses to sign a claim whose window has shut", async () => {
      stubBalance(
        balanceRecord({ predicate: { abs_before: String(NOW - 60) } })
      );
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const result = await claimBalance({
        balanceId: BALANCE_ID,
        claimantSecret: claimant.secret(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("claim window closed at");
      expect(result.error).toContain(nowIso(NOW - 60));
      expect(result.eligibility?.eligible).toBe(false);
      expect(result.eligibility?.claimExpiresAt).toBe(nowIso(NOW - 60));
      expect(result.balance?.amount).toBe("25");
      expect(server.loadAccount).not.toHaveBeenCalled();
      expect(server.submitTransaction).not.toHaveBeenCalled();
    });

    it("carries an eligible verdict through a claim that proceeds", async () => {
      stubBalance(balanceRecord({ predicate: {} }));
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));

      const result = await claimBalance({
        balanceId: BALANCE_ID,
        claimantSecret: claimant.secret(),
      });

      expect(server.loadAccount).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("network unreachable");
      expect(result.eligibility?.eligible).toBe(true);
      expect(result.eligibility?.evaluated).toBe(true);
      expect(server.submitTransaction).not.toHaveBeenCalled();
    });

    it("does not invent a verdict when the ledger close time is unreadable", async () => {
      stubBalance(
        balanceRecord({ predicate: { abs_before: String(NOW - 60) } })
      );
      server.ledgers.mockReturnValue({
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(new Error("horizon down")),
      });

      const result = await claimBalance({
        balanceId: BALANCE_ID,
        claimantSecret: claimant.secret(),
      });

      expect(server.loadAccount).toHaveBeenCalledTimes(1);
      expect(result.eligibility).toBeUndefined();
      expect(result.error).toContain("network unreachable");
    });

    it("keeps the eligibility verdict when submission itself fails", async () => {
      stubBalance(balanceRecord({ predicate: {} }));
      server.ledgers.mockReturnValue(ledgerResponse({ close_time: NOW }));
      server.loadAccount.mockResolvedValue(
        new StellarSdk.Account(claimant.publicKey(), "0")
      );
      server.submitTransaction.mockRejectedValue(new Error("tx rejected"));

      const result = await claimBalance({
        balanceId: BALANCE_ID,
        claimantSecret: claimant.secret(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("tx rejected");
      expect(result.eligibility?.eligible).toBe(true);
      expect(server.submitTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
