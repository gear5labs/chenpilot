import {
  parseScaledAmount,
  serializeScaledAmount,
} from "./fixedAmount";

/**
 * Stellar Claimable Balance Utilities
 *
 * Provides functionality to search for and claim pending claimable balances
 * for a given Stellar account.
 */

import {
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { abortableWait, isAbortError } from "./abort";
import type { AbortSignalLike } from "./types";
import { explainClaimEligibility } from "./advancedOps/claimableBalanceOperations";
import type { ClaimEligibility } from "./advancedOps/types";

export interface ClaimableBalance {
  /** Unique identifier for the claimable balance */
  id: string;
  /** Asset code (e.g., "XLM", "USDC") */
  asset: string;
  /** Amount available to claim */
  amount: string;
  /** Account that created the claimable balance */
  sponsor: string;
  /** Timestamp when the balance was created */
  createdAt?: string;
  /** Claimants who can claim this balance */
  claimants: Array<{
    destination: string;
    predicate: unknown;
  }>;
}

export interface ClaimableBalanceSearchOptions {
  /** Stellar account public key to search for */
  accountId: string;
  /** Network to use: "testnet" or "mainnet" */
  network?: "testnet" | "mainnet";
  /** Optional custom Horizon URL */
  horizonUrl?: string;
  /** Limit number of results (default: 200) */
  limit?: number;
  /** Optional external signal to cancel the operation. */
  signal?: AbortSignalLike;
}

export interface ClaimBalanceOptions {
  /** Claimable balance ID to claim */
  balanceId: string;
  /** Secret key of the claimant account */
  claimantSecret: string;
  /** Network to use: "testnet" or "mainnet" */
  network?: "testnet" | "mainnet";
  /** Optional custom Horizon URL */
  horizonUrl?: string;
  /** Optional external signal to cancel the operation. */
  signal?: AbortSignalLike;
  /**
   * Ledger close time (unix seconds) to evaluate the claim predicates at.
   * Defaults to the latest ledger read from Horizon, which keeps callers that
   * already know the ledger time off the extra round trip (and makes tests
   * deterministic).
   */
  ledgerTime?: number;
}

export interface ClaimBalanceResult {
  /** Whether the claim was successful */
  success: boolean;
  /** Transaction hash if successful */
  transactionHash?: string;
  /** Error message if failed */
  error?: string;
  /** Claimed balance details */
  balance?: ClaimableBalance;
  /**
   * True when the outcome is unknown because the submission was cancelled or
   * timed out after the transaction may have already reached the network.
   */
  ambiguous?: boolean;
  /**
   * Why this claimant can (or cannot) claim, evaluated against the claim
   * predicates and the ledger time. Present whenever the ledger time could be
   * read; absent when it could not, in which case no eligibility verdict is
   * asserted.
   */
  eligibility?: ClaimEligibility;
}

export interface ClaimEligibilityOptions {
  /** Claimable balance ID to explain */
  balanceId: string;
  /** Claimant account (`G...`) to explain eligibility for */
  claimant: string;
  /** Network to use: "testnet" or "mainnet" */
  network?: "testnet" | "mainnet";
  /** Optional custom Horizon URL */
  horizonUrl?: string;
  /**
   * Ledger close time (unix seconds) to evaluate the predicates at.
   * Defaults to the latest ledger read from Horizon.
   */
  ledgerTime?: number;
  /** Optional external signal to cancel the operation. */
  signal?: AbortSignalLike;
}

/** Convert an ISO timestamp to unix seconds; undefined when unparseable. */
function toUnixSeconds(iso?: string): number | undefined {
  if (!iso) return undefined;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

/**
 * Extract a ledger close time in unix seconds from a Horizon ledger record.
 * Prefers the integer `close_time` and falls back to the ISO `closed_at`.
 */
function parseLedgerCloseTime(record: unknown): number | undefined {
  const ledger = record as {
    close_time?: number | string;
    closed_at?: string;
  };
  if (ledger?.close_time !== undefined && ledger.close_time !== null) {
    const closeTime = Number(ledger.close_time);
    if (Number.isFinite(closeTime) && closeTime > 0) return closeTime;
  }
  if (typeof ledger?.closed_at === "string") {
    const parsed = Date.parse(ledger.closed_at);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

/**
 * Read the latest ledger close time from Horizon, in unix seconds.
 *
 * Returns undefined when Horizon cannot supply it so callers can decide
 * whether an unknown ledger time blocks them; cancellation still propagates.
 */
async function fetchLedgerCloseTime(
  server: Horizon.Server,
  signal?: AbortSignalLike
): Promise<number | undefined> {
  try {
    const response = await abortableWait(
      server.ledgers().order("desc").limit(1).call(),
      signal
    );
    const record = response.records?.[0];
    return parseLedgerCloseTime(record);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

/**
 * Search for claimable balances for a given account
 */
export async function searchClaimableBalances(
  options: ClaimableBalanceSearchOptions
): Promise<ClaimableBalance[]> {
  const horizonUrl =
    options.horizonUrl ||
    (options.network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org");

  const server = new Horizon.Server(horizonUrl);

  try {
    const balancesCall = server
      .claimableBalances()
      .claimant(options.accountId)
      .limit(options.limit || 200);

    const response = await abortableWait(balancesCall.call(), options.signal);

    return response.records.map((record: unknown) => {
      const rec = record as Record<string, unknown>;
      return {
        id: rec.id as string,
        asset:
          rec.asset === "native" ? "XLM" : `${String(rec.asset).split(":")[0]}`,
        amount: rec.amount as string,
        sponsor: (rec.sponsor as string) || "",
        createdAt: rec.last_modified_time as string,
        claimants: (rec.claimants as Array<Record<string, unknown>>).map(
          (c) => ({
            destination: c.destination as string,
            predicate: c.predicate,
          })
        ),
      };
    });
  } catch (error) {
    // Cancellation must propagate unmasked.
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error(
      `Failed to search claimable balances: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Claim a specific claimable balance
 */
export async function claimBalance(
  options: ClaimBalanceOptions
): Promise<ClaimBalanceResult> {
  const horizonUrl =
    options.horizonUrl ||
    (options.network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org");

  const networkPassphrase =
    options.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  const server = new Horizon.Server(horizonUrl);

  let balance: ClaimableBalance | undefined;
  let eligibility: ClaimEligibility | undefined;

  try {
    // Load the claimant keypair
    const claimantKeypair = Keypair.fromSecret(options.claimantSecret);
    const claimantPublicKey = claimantKeypair.publicKey();

    // Fetch balance details first
    const balanceRecord = await abortableWait(
      server
        .claimableBalances()
        .claimableBalance(options.balanceId)
        .call(),
      options.signal
    );

    balance = {
      id: balanceRecord.id,
      asset:
        balanceRecord.asset === "native"
          ? "XLM"
          : `${balanceRecord.asset.split(":")[0]}`,
      amount: balanceRecord.amount,
      sponsor: balanceRecord.sponsor || "",
      createdAt: (balanceRecord as unknown as Record<string, unknown>)
        .last_modified_time as string,
      claimants: balanceRecord.claimants.map((c: unknown) => {
        const claimant = c as Record<string, unknown>;
        return {
          destination: claimant.destination as string,
          predicate: claimant.predicate,
        };
      }),
    };

    // Verify the account is a valid claimant
    const isClaimant = balance.claimants.some(
      (c) => c.destination === claimantPublicKey
    );

    if (!isClaimant) {
      return {
        success: false,
        error: `Account ${claimantPublicKey} is not a valid claimant for this balance`,
        balance,
      };
    }

    // Explain eligibility from the claim predicates and the ledger close time
    // before anything is signed: a claim the ledger would reject surfaces here
    // as a readable reason instead of an opaque failure after submission.
    // When the ledger time cannot be read the verdict is skipped rather than
    // invented, so behaviour is unchanged in that case.
    const ledgerTime =
      options.ledgerTime ?? (await fetchLedgerCloseTime(server, options.signal));
    if (ledgerTime !== undefined) {
      eligibility = explainClaimEligibility({
        claimant: claimantPublicKey,
        claimants: balance.claimants,
        ledgerTime,
        startTime: toUnixSeconds(balance.createdAt),
      });

      if (eligibility.evaluated && !eligibility.eligible) {
        return {
          success: false,
          error: eligibility.reason,
          balance,
          eligibility,
        };
      }
    }

    // Load the claimant account
    const account = await abortableWait(
      server.loadAccount(claimantPublicKey),
      options.signal
    );

    // Build the claim transaction
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.claimClaimableBalance({
          balanceId: options.balanceId,
        })
      )
      .setTimeout(180)
      .build();

    // Sign the transaction
    transaction.sign(claimantKeypair);

    // Submit the transaction. If the caller cancels (or the request times
    // out) while Horizon is processing, the claim may still have been
    // recorded — surface that ambiguity instead of a plain failure.
    let ambiguous = false;
    const result = await abortableWait(
      server.submitTransaction(transaction),
      options.signal,
      { onAbort: () => (ambiguous = true) }
    );

    return {
      success: true,
      transactionHash: result.hash,
      balance,
      ...(eligibility ? { eligibility } : {}),
    };
  } catch (error) {
    const outcome: ClaimBalanceResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      balance,
      ...(eligibility ? { eligibility } : {}),
    };

    if (isAbortError(error) || isAmbiguousSubmissionError(error)) {
      outcome.ambiguous = true;
    }

    return outcome;
  }
}

/**
 * Explain whether an account may claim a claimable balance at the current
 * ledger time, without building or submitting anything.
 *
 * The verdict comes from the balance's own claim predicates evaluated against
 * the latest ledger close time (or `options.ledgerTime`), so callers can say
 * "not yet — the claim window opens at ..." or "the claim window closed at
 * ..." rather than discovering it through a rejected transaction.
 *
 * @throws {Error} when the balance or the ledger close time cannot be read.
 */
export async function getClaimEligibility(
  options: ClaimEligibilityOptions
): Promise<ClaimEligibility> {
  const horizonUrl =
    options.horizonUrl ||
    (options.network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org");

  const server = new Horizon.Server(horizonUrl);

  try {
    const balanceRecord = await abortableWait(
      server.claimableBalances().claimableBalance(options.balanceId).call(),
      options.signal
    );

    const claimants = balanceRecord.claimants.map((claimant: unknown) => {
      const entry = claimant as Record<string, unknown>;
      return {
        destination: entry.destination as string,
        predicate: entry.predicate,
      };
    });

    const ledgerTime =
      options.ledgerTime ?? (await fetchLedgerCloseTime(server, options.signal));
    if (ledgerTime === undefined) {
      throw new Error("the latest ledger close time could not be read");
    }

    const createdAt = (balanceRecord as unknown as Record<string, unknown>)
      .last_modified_time as string | undefined;

    return explainClaimEligibility({
      claimant: options.claimant,
      claimants,
      ledgerTime,
      startTime: toUnixSeconds(createdAt),
    });
  } catch (error) {
    // Cancellation must propagate unmasked.
    if (isAbortError(error)) throw error;
    throw new Error(
      `Failed to explain claim eligibility: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Horizon submissions that may have been recorded despite signalling failure
 * (gateway timeouts, dropped connections, or missing HTTP status).
 */
function isAmbiguousSubmissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { response?: { status?: number } }).response?.status;
  if (status === undefined) return true;
  return status === 408 || status === 504;
}

/**
 * Get total claimable amount for an account grouped by asset
 */
export async function getTotalClaimableAmount(
  options: ClaimableBalanceSearchOptions
): Promise<Record<string, string>> {
  const balances = await searchClaimableBalances(options);

  // #622: aggregate with fixed-precision (BigInt) arithmetic at Stellar's
  // default 7 decimals — never float `number`.
  const totals: Record<string, bigint> = {};

  for (const balance of balances) {
    totals[balance.asset] =
      (totals[balance.asset] ?? 0n) + parseScaledAmount(balance.amount, 7);
  }

  const result: Record<string, string> = {};
  for (const [asset, units] of Object.entries(totals)) {
    result[asset] = serializeScaledAmount(units, 7);
  }

  return result;
}
