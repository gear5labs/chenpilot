import { TransactionSafetyGate, TransactionSafetyRequest } from "../TransactionSafetyGate";

describe("TransactionSafetyGate", () => {
  let gate: TransactionSafetyGate;

  beforeEach(() => {
    gate = new TransactionSafetyGate({
      maxAllowedSlippagePercent: 5.0,
      maxFeeStroops: 50_000_000,
    });
  });

  it("approves a valid, safe transaction request and produces an evidence bundle", () => {
    const request: TransactionSafetyRequest = {
      transactionId: "tx-123",
      userId: "user-456",
      intent: {
        actionType: "swap",
        sourceAccount: "GA...",
        destination: "GB...",
        amount: "100.0",
        asset: "USDC",
        maxSlippagePercent: 1.0,
      },
      parameters: {
        feeStroops: 1000,
        gasLimit: "21000",
      },
      preflightContext: {
        accountBalanceStroops: "1000000000",
        requiredBalanceStroops: "5000000",
        allowanceValid: true,
        chainCompatible: true,
      },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.evidence).toBeDefined();
    expect(result.evidence.status).toBe("accepted");
    expect(result.evidence.digest).toBeTruthy();
    expect(result.evidence.requestDigest).toBeTruthy();
    expect(result.evidence.metadata.actionType).toBe("swap");
  });

  it("rejects transaction with excessive slippage", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "swap",
        amount: "50.0",
        maxSlippagePercent: 10.0, // exceeds max of 5.0%
      },
      parameters: { feeStroops: 1000 },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "EXCESSIVE_SLIPPAGE")).toBe(true);
    expect(result.evidence.status).toBe("rejected");
  });

  it("rejects transaction with excessive price impact", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "swap",
        amount: "50.0",
        expectedPrice: "100.0",
        quotedPrice: "115.0", // 15% price impact
      },
      parameters: { feeStroops: 1000 },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "HIGH_PRICE_IMPACT")).toBe(true);
    expect(result.evidence.status).toBe("rejected");
  });

  it("rejects transaction with excessive fee", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "transfer",
        amount: "10.0",
      },
      parameters: {
        feeStroops: 100_000_000, // exceeds 50M limit
      },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "EXCESSIVE_FEE")).toBe(true);
  });

  it("rejects transaction when preflight allowance check fails", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "approve_and_swap",
        amount: "10.0",
      },
      parameters: { feeStroops: 1000 },
      preflightContext: {
        allowanceValid: false,
      },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "INVALID_APPROVAL_STATE")).toBe(true);
  });

  it("rejects transaction when chain state is incompatible", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "bridge",
        amount: "10.0",
      },
      parameters: { feeStroops: 1000 },
      preflightContext: {
        chainCompatible: false,
      },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "INCOMPATIBLE_CHAIN_STATE")).toBe(true);
  });

  it("rejects transaction when balance is insufficient during preflight", () => {
    const request: TransactionSafetyRequest = {
      intent: {
        actionType: "transfer",
        amount: "10.0",
      },
      parameters: { feeStroops: 1000 },
      preflightContext: {
        accountBalanceStroops: "100",
        requiredBalanceStroops: "5000",
      },
    };

    const result = gate.evaluate(request);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.code === "INSUFFICIENT_BALANCE_PREFLIGHT")).toBe(true);
  });
});
