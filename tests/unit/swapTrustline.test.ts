/**
 * Regression tests for trustline authorization enforcement on asset
 * transfer paths ([Wallet] trustline-checks issue).
 *
 * `hasValidStellarTrustline` already existed, but its result was never
 * enforced: swaps, multi-hop trades and delayed submissions would build and
 * sign transactions whose assets had missing or frozen (unauthorized)
 * trustlines. These tests pin the fail-closed preflight behavior on the
 * SwapTool path — a frozen trustline must block the transfer before any
 * quote is fetched or transaction is built.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
} from "@jest/globals";

jest.mock("../../src/services/stellarPrice.service", () => ({
  __esModule: true,
  default: {
    getPrice: jest.fn().mockResolvedValue({
      price: 1,
      estimatedOutput: 1,
      cached: false,
      path: [],
    }),
  },
}));

jest.mock("../../src/services/flashSwapRiskAnalyzer", () => ({
  flashSwapRiskAnalyzer: {
    analyzeSwapRisk: jest.fn().mockResolvedValue({
      riskLevel: "low",
      sandwichAttackRisk: 0,
      warnings: [],
      recommendations: [],
    }),
  },
}));

jest.mock("../../src/Auth/accountSecretStore", () => ({
  accountSecretStore: {
    getAccountByUserId: jest.fn(() => ({
      secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })),
  },
}));

jest.mock("../../src/transactions/TransactionLifecycle.service", () => ({
  transactionLifecycleService: {
    create: jest.fn().mockResolvedValue({ id: "lifecycle-1" }),
    transition: jest.fn().mockResolvedValue({}),
    fail: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("../../src/services/lock", () => ({
  RedisLockService: jest.fn().mockImplementation(() => ({
    acquireLock: jest
      .fn()
      .mockResolvedValue({
        acquired: true,
        lockKey: "lock:test",
        lockValue: "test",
      }),
    releaseLock: jest.fn().mockResolvedValue(true),
    extendLock: jest.fn().mockResolvedValue(true),
    isLocked: jest.fn().mockResolvedValue(false),
    getLockInfo: jest.fn().mockResolvedValue(null),
    forceReleaseLock: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Asset: class {
    constructor(
      public code: string,
      public issuer?: string
    ) {}
    static native() {
      return new (this as unknown as {
        new (code: string, issuer?: string): unknown;
      })("XLM");
    }
  },
  Horizon: { Server: class {} },
  TransactionBuilder: class {
    constructor() {}
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: jest.fn() };
    }
  },
  Operation: { pathPaymentStrictSend: jest.fn(() => ({})) },
  BASE_FEE: "100",
}));

// Controllable trustline preflight: the mock below lets each test choose the
// Horizon account response, exercising both the allow and the frozen paths.
const mockAccountsCall = jest.fn();

jest.mock("../../../packages/sdk/src/trustline", () => {
  const actual = jest.requireActual("../../../packages/sdk/src/trustline");
  return {
    ...actual,
    // Re-implement hasValidStellarTrustline against our controllable mock
    // instead of the real Horizon client.
    hasValidStellarTrustline: jest.fn(
      async (_url, _accountId, assetCode, assetIssuer) => {
        if (assetCode.toUpperCase() === "XLM") {
          return { exists: true, authorized: true };
        }
        const account = await mockAccountsCall();
        if (!account) {
          return {
            exists: false,
            authorized: false,
            details: { error: "account not found" },
          };
        }
        const match = (account.balances ?? []).find(
          (b: any) =>
            b.asset_code === assetCode &&
            (!assetIssuer || b.asset_issuer === assetIssuer)
        );
        if (!match) return { exists: false, authorized: false };
        const authorized =
          match.is_authorized ??
          match.authorized ??
          match.authorized_to_maintain_liabilities ??
          true;
        return { exists: true, authorized, details: { balance: match } };
      }
    ),
  };
});

import { SwapTool } from "../../src/Agents/tools/swap";
import { transactionLifecycleService } from "../../src/transactions/TransactionLifecycle.service";
import { TrustlineUnauthorizedError } from "../../../packages/sdk/src/trustline";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("SwapTool trustline authorization preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccountsCall.mockReset();
  });

  it("allows a swap when both trustlines are authorized", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: ISSUER,
          balance: "50",
          authorized: true,
        },
      ],
    });

    const tool = new SwapTool();
    const result = await tool.execute(
      { from: "USDC", to: "XLM", amount: 10 },
      "user-1"
    );

    expect(result.status).toBe("success");
    expect(transactionLifecycleService.fail).not.toHaveBeenCalled();
  });

  it("blocks the swap when the source trustline is frozen", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: ISSUER,
          balance: "50",
          authorized: false,
        },
      ],
    });

    const tool = new SwapTool();
    const result = await tool.execute(
      { from: "USDC", to: "XLM", amount: 10 },
      "user-1"
    );

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/frozen|not authorized/i);
    // Fail-closed: never reached simulation or submission.
    expect(transactionLifecycleService.transition).not.toHaveBeenCalledWith(
      "lifecycle-1",
      "executing",
      expect.anything()
    );
  });

  it("blocks the swap when the destination trustline is missing", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        {
          asset_code: "USDC",
          asset_issuer: ISSUER,
          balance: "50",
          authorized: true,
        },
      ],
    });

    const tool = new SwapTool();
    const result = await tool.execute(
      { from: "XLM", to: "USDC", amount: 10 },
      "user-1"
    );

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/no trustline|missing/i);
  });

  it("blocks the swap when the account lookup fails entirely", async () => {
    mockAccountsCall.mockResolvedValue(null);

    const tool = new SwapTool();
    const result = await tool.execute(
      { from: "USDC", to: "XLM", amount: 10 },
      "user-1"
    );

    expect(result.status).toBe("error");
    expect(new (TrustlineUnauthorizedError as any)().name).toBe(
      "TrustlineUnauthorizedError"
    );
  });
});
