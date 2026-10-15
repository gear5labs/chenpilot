/**
 * Tests for the unified advanced operations package — Issue #572
 */

import {
  AdvancedOperationComposer,
  AdvancedOperationFamily,
  AdvancedOperationKind,
  DestinationMemoRequirementError,
  MAX_MEMO_TEXT_BYTES,
  MAX_TRUST_LIMIT,
  assertDestinationMemoRequirement,
  checkDestinationMemoRequirement,
  claimBalance,
  clearDestinationMemoRequirements,
  composeOperations,
  createClaimableBalance,
  createTrustline,
  describeClaimPredicate,
  describeOperation,
  destinationMemoChecksForTransaction,
  enforceDestinationMemoRequirements,
  evaluateClaimPredicate,
  explainClaimEligibility,
  familyOf,
  getDestinationMemoRequirement,
  hashMemo,
  idMemo,
  isAccountId,
  isAmount,
  isAssetCode,
  isBalanceId,
  isNativeAsset,
  isPositiveAmount,
  isUint64,
  listDestinationMemoRequirements,
  memoValueToBuffer,
  noMemo,
  registerDestinationMemoRequirement,
  registerDestinationMemoRequirements,
  removeTrustline,
  returnMemo,
  textMemo,
  unregisterDestinationMemoRequirement,
  updateTrustlineLimit,
  utf8ByteLength,
  validateOperation,
} from "../advancedOps";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HEX_32 = "a".repeat(64);
const BALANCE_ID = "0".repeat(72);

describe("advancedOps validation primitives", () => {
  it("accepts well-formed account ids and rejects malformed ones", () => {
    expect(isAccountId(ISSUER)).toBe(true);
    expect(isAccountId(ACCOUNT)).toBe(true);
    expect(isAccountId("GABC")).toBe(false);
    expect(isAccountId(`M${ISSUER.slice(1)}`)).toBe(false);
    expect(isAccountId(undefined)).toBe(false);
  });

  it("enforces the 1-12 character asset code range", () => {
    expect(isAssetCode("XLM")).toBe(true);
    expect(isAssetCode("a")).toBe(true);
    expect(isAssetCode("A".repeat(12))).toBe(true);
    expect(isAssetCode("A".repeat(13))).toBe(false);
    expect(isAssetCode("")).toBe(false);
    expect(isAssetCode("US-DC")).toBe(false);
  });

  it("enforces Stellar's seven decimal places on amounts", () => {
    expect(isAmount("0")).toBe(true);
    expect(isAmount("1.1234567")).toBe(true);
    expect(isAmount("1.12345678")).toBe(false);
    expect(isAmount("-1")).toBe(false);
    expect(isAmount("abc")).toBe(false);
  });

  it("distinguishes zero from a positive amount", () => {
    expect(isAmount("0")).toBe(true);
    expect(isPositiveAmount("0")).toBe(false);
    expect(isPositiveAmount("0.0000001")).toBe(true);
  });

  it("bounds memo ids to unsigned 64 bits", () => {
    expect(isUint64("0")).toBe(true);
    expect(isUint64(18446744073709551615n)).toBe(true);
    expect(isUint64(18446744073709551616n)).toBe(false);
    expect(isUint64(-1)).toBe(false);
    expect(isUint64(1.5)).toBe(false);
    expect(isUint64("not-a-number")).toBe(false);
  });

  it("recognises balance ids by their 72-character hex form", () => {
    expect(isBalanceId(BALANCE_ID)).toBe(true);
    expect(isBalanceId(HEX_32)).toBe(false);
  });

  it("measures memo length in UTF-8 bytes rather than code points", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("memo operations", () => {
  it("builds a descriptor for every memo variant", () => {
    expect(noMemo().params.kind).toBe("none");
    expect(textMemo("hello").params).toEqual({ kind: "text", value: "hello" });
    expect(idMemo(42).params).toEqual({ kind: "id", value: 42 });
    expect(hashMemo(HEX_32).params).toEqual({ kind: "hash", value: HEX_32 });
    expect(returnMemo(HEX_32).params).toEqual({ kind: "return", value: HEX_32 });
  });

  it("rejects text memos over the 28-byte limit", () => {
    const report = validateOperation(textMemo("a".repeat(MAX_MEMO_TEXT_BYTES)));
    expect(report.valid).toBe(true);

    const tooLong = validateOperation(
      textMemo("a".repeat(MAX_MEMO_TEXT_BYTES + 1))
    );
    expect(tooLong.valid).toBe(false);
    expect(tooLong.errors[0].code).toBe("MEMO_TEXT_TOO_LONG");
  });

  it("counts multi-byte characters against the byte limit", () => {
    // 15 two-byte characters is 30 bytes, over the limit, despite being
    // only 15 characters long.
    const report = validateOperation(textMemo("é".repeat(15)));
    expect(report.valid).toBe(false);
  });

  it("rejects hash memos that are not 32 bytes of hex", () => {
    const report = validateOperation(hashMemo("deadbeef"));
    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("INVALID_MEMO_HASH");
  });

  it("rejects id memos outside the unsigned 64-bit range", () => {
    expect(validateOperation(idMemo("0")).valid).toBe(true);
    expect(validateOperation(idMemo("-1")).valid).toBe(false);
  });

  it("decodes hex memo values into 32-byte buffers", () => {
    const buffer = memoValueToBuffer(HEX_32);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBe(32);
  });

  it("scopes issue fields to the params object", () => {
    const report = validateOperation(hashMemo("nope"));
    expect(report.errors[0].field.startsWith("params")).toBe(true);
  });
});

describe("trustline operations", () => {
  it("builds create, update and remove descriptors", () => {
    expect(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).kind).toBe(
      AdvancedOperationKind.TRUSTLINE_CREATE
    );
    expect(
      updateTrustlineLimit({ assetCode: "USDC", assetIssuer: ISSUER, limit: "10" })
        .kind
    ).toBe(AdvancedOperationKind.TRUSTLINE_UPDATE);
    expect(removeTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).kind).toBe(
      AdvancedOperationKind.TRUSTLINE_REMOVE
    );
  });

  it("forces a zero limit when removing a trustline", () => {
    expect(removeTrustline({ assetCode: "USDC", assetIssuer: ISSUER }).params.limit).toBe(
      "0"
    );
  });

  it("rejects an invalid issuer", () => {
    const report = validateOperation(
      createTrustline({ assetCode: "USDC", assetIssuer: "not-an-account" })
    );
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "INVALID_ACCOUNT_ID")).toBe(
      true
    );
  });

  it("rejects a limit above the protocol maximum", () => {
    const report = validateOperation(
      updateTrustlineLimit({
        assetCode: "USDC",
        assetIssuer: ISSUER,
        limit: "999999999999.9999999",
      })
    );
    expect(report.valid).toBe(false);
  });

  it("accepts exactly the protocol maximum limit", () => {
    const report = validateOperation(
      updateTrustlineLimit({
        assetCode: "USDC",
        assetIssuer: ISSUER,
        limit: MAX_TRUST_LIMIT,
      })
    );
    expect(report.valid).toBe(true);
  });

  it("rejects a non-zero limit on removal", () => {
    const report = validateOperation({
      kind: AdvancedOperationKind.TRUSTLINE_REMOVE,
      params: { assetCode: "USDC", assetIssuer: ISSUER, limit: "5" },
    });
    expect(report.valid).toBe(false);
  });
});

describe("claimable balance operations", () => {
  it("treats XLM without an issuer as the native asset", () => {
    expect(isNativeAsset("XLM")).toBe(true);
    expect(isNativeAsset("XLM", "")).toBe(true);
    expect(isNativeAsset("XLM", ISSUER)).toBe(false);
    expect(isNativeAsset("USDC", ISSUER)).toBe(false);
  });

  it("validates a well-formed create", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "10",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(true);
  });

  it("requires at least one claimant", () => {
    const report = validateOperation(
      createClaimableBalance({ assetCode: "XLM", amount: "10", claimants: [] })
    );
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "MISSING_CLAIMANTS")).toBe(
      true
    );
  });

  it("warns about duplicate claimants without failing validation", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "10",
        claimants: [ACCOUNT, ACCOUNT],
      })
    );
    expect(report.valid).toBe(true);
    expect(report.warnings.some((issue) => issue.code === "DUPLICATE_CLAIMANTS")).toBe(
      true
    );
  });

  it("rejects a zero amount", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "XLM",
        amount: "0",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(false);
  });

  it("requires an issuer for non-native assets", () => {
    const report = validateOperation(
      createClaimableBalance({
        assetCode: "USDC",
        amount: "10",
        claimants: [ACCOUNT],
      })
    );
    expect(report.valid).toBe(false);
  });

  it("validates a claim against the balance id format", () => {
    expect(
      validateOperation(claimBalance({ balanceId: BALANCE_ID, claimant: ACCOUNT }))
        .valid
    ).toBe(true);
    expect(
      validateOperation(claimBalance({ balanceId: "short", claimant: ACCOUNT })).valid
    ).toBe(false);
  });
});

describe("AdvancedOperationComposer", () => {
  it("maps each kind onto its family", () => {
    expect(familyOf(AdvancedOperationKind.MEMO_ATTACH)).toBe(
      AdvancedOperationFamily.MEMO
    );
    expect(familyOf(AdvancedOperationKind.TRUSTLINE_REMOVE)).toBe(
      AdvancedOperationFamily.TRUSTLINE
    );
    expect(familyOf(AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM)).toBe(
      AdvancedOperationFamily.CLAIMABLE_BALANCE
    );
  });

  it("separates the memo from ledger operations in the plan", () => {
    const plan = new AdvancedOperationComposer()
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .add(textMemo("onboarding"))
      .compose();

    expect(plan.operations).toHaveLength(1);
    expect(plan.memo?.kind).toBe(AdvancedOperationKind.MEMO_ATTACH);
    expect(plan.summary).toHaveLength(2);
  });

  it("preserves the order operations were added in", () => {
    const plan = composeOperations([
      createTrustline({ assetCode: "AAA", assetIssuer: ISSUER }),
      createTrustline({ assetCode: "BBB", assetIssuer: ISSUER }),
    ]);

    expect(plan.operations.map((op) => op.params.assetCode)).toEqual(["AAA", "BBB"]);
  });

  it("carries metadata through composition untouched", () => {
    const plan = composeOperations([
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }, { tag: "batch-1" }),
    ]);

    expect(plan.operations[0].metadata).toEqual({ tag: "batch-1" });
  });

  it("rejects more than one memo", () => {
    const report = new AdvancedOperationComposer()
      .add(textMemo("first"))
      .add(textMemo("second"))
      .validate();

    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "MULTIPLE_MEMOS")).toBe(true);
  });

  it("rejects an empty plan", () => {
    const report = new AdvancedOperationComposer().validate();
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "EMPTY_PLAN")).toBe(true);
  });

  it("does not count the memo against the operation ceiling", () => {
    const operations = Array.from({ length: 100 }, (_, index) =>
      createTrustline({ assetCode: `A${index}`, assetIssuer: ISSUER })
    );

    const report = new AdvancedOperationComposer(operations)
      .add(textMemo("bulk"))
      .validate();

    expect(report.valid).toBe(true);
  });

  it("rejects more than 100 ledger operations", () => {
    const operations = Array.from({ length: 101 }, (_, index) =>
      createTrustline({ assetCode: `A${index}`, assetIssuer: ISSUER })
    );

    const report = new AdvancedOperationComposer(operations).validate();
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === "TOO_MANY_OPERATIONS")).toBe(
      true
    );
  });

  it("scopes issues to the offending index", () => {
    const report = new AdvancedOperationComposer()
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .add(createTrustline({ assetCode: "USDC", assetIssuer: "bad" }))
      .validate();

    expect(report.valid).toBe(false);
    expect(report.errors[0].field.startsWith("operations[1]")).toBe(true);
  });

  it("throws with every reason when composing an invalid plan", () => {
    expect(() =>
      new AdvancedOperationComposer()
        .add(createTrustline({ assetCode: "USDC", assetIssuer: "bad" }))
        .compose()
    ).toThrow(/Cannot compose operations/);
  });

  it("supports clear() and size()", () => {
    const composer = new AdvancedOperationComposer()
      .add(textMemo("a"))
      .add(noMemo());

    expect(composer.size()).toBe(2);
    expect(composer.clear().size()).toBe(0);
  });

  it("describes operations in a single readable line each", () => {
    const description = describeOperation(
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER })
    );

    expect(typeof description).toBe("string");
    expect(description).toContain("USDC");
    expect(description.includes("\n")).toBe(false);
  });

  it("reports an unknown operation kind rather than throwing", () => {
    const report = validateOperation({
      kind: "not.a.kind",
      params: {},
    } as never);

    expect(report.valid).toBe(false);
    expect(report.errors[0].code).toBe("UNKNOWN_OPERATION_KIND");
  });
});

describe("destination memo requirements", () => {
  afterEach(() => {
    clearDestinationMemoRequirements();
  });

  it("passes every destination until a requirement is registered", () => {
    expect(getDestinationMemoRequirement(ACCOUNT)).toBeUndefined();
    expect(listDestinationMemoRequirements()).toHaveLength(0);

    const report = checkDestinationMemoRequirement({ destination: ACCOUNT });
    expect(report.valid).toBe(true);
    expect(() => enforceDestinationMemoRequirements({ operations: [] })).not.toThrow();
  });

  it("stores a requirement and normalizes surrounding whitespace", () => {
    const stored = registerDestinationMemoRequirement({
      destination: `  ${ACCOUNT}  `,
      required: true,
      label: "Example Exchange",
      source: "exchange-directory",
    });

    expect(stored.destination).toBe(ACCOUNT);
    expect(getDestinationMemoRequirement(ACCOUNT)?.label).toBe("Example Exchange");
    expect(getDestinationMemoRequirement(` ${ACCOUNT}`)?.required).toBe(true);
    expect(listDestinationMemoRequirements()).toHaveLength(1);
  });

  it("rejects a registration without a destination", () => {
    expect(() =>
      registerDestinationMemoRequirement({ destination: "   ", required: true })
    ).toThrow(DestinationMemoRequirementError);
    expect(() =>
      registerDestinationMemoRequirement({ required: true } as never)
    ).toThrow(DestinationMemoRequirementError);
    expect(() =>
      registerDestinationMemoRequirement({
        destination: ACCOUNT,
        required: true,
        memoKinds: ["not-a-kind" as never],
      })
    ).toThrow(DestinationMemoRequirementError);
  });

  it("rejects a payment that carries no memo", () => {
    registerDestinationMemoRequirement({
      destination: ACCOUNT,
      required: true,
      label: "Example Exchange",
    });

    const missing = checkDestinationMemoRequirement({ destination: ACCOUNT });
    expect(missing.valid).toBe(false);
    expect(missing.errors[0].code).toBe("DESTINATION_MEMO_REQUIRED");
    expect(missing.errors[0].message).toContain(ACCOUNT);
    expect(missing.errors[0].message).toContain("Example Exchange");

    const empty = checkDestinationMemoRequirement({
      destination: ACCOUNT,
      memo: { kind: "none" },
    });
    expect(empty.valid).toBe(false);
    expect(empty.errors[0].code).toBe("DESTINATION_MEMO_REQUIRED");

    const present = checkDestinationMemoRequirement({
      destination: ACCOUNT,
      memo: { kind: "text", value: "invoice-1" },
    });
    expect(present.valid).toBe(true);
  });

  it("only accepts the memo kinds the destination allows", () => {
    registerDestinationMemoRequirement({
      destination: ACCOUNT,
      required: true,
      memoKinds: ["id"],
    });

    const wrongKind = checkDestinationMemoRequirement({
      destination: ACCOUNT,
      memo: { kind: "text", value: "invoice-1" },
    });
    expect(wrongKind.valid).toBe(false);
    expect(wrongKind.errors[0].code).toBe("MEMO_KIND_NOT_ACCEPTED");

    const accepted = checkDestinationMemoRequirement({
      destination: ACCOUNT,
      memo: { kind: "id", value: 42 },
    });
    expect(accepted.valid).toBe(true);
  });

  it("leaves destinations that do not require a memo alone", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: false });

    expect(checkDestinationMemoRequirement({ destination: ACCOUNT }).valid).toBe(true);
    expect(() =>
      enforceDestinationMemoRequirements({
        operations: [{ type: "payment", destination: ACCOUNT, amount: "1" }],
      })
    ).not.toThrow();
  });

  it("throws a DestinationMemoRequirementError from the assertion form", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: true });

    let caught: unknown;
    try {
      assertDestinationMemoRequirement({ destination: ACCOUNT, memo: null });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DestinationMemoRequirementError);
    const failure = caught as DestinationMemoRequirementError;
    expect(failure.issues.some((issue) => issue.code === "DESTINATION_MEMO_REQUIRED")).toBe(
      true
    );
    expect(failure.message).toContain(ACCOUNT);
    expect(() => assertDestinationMemoRequirement({ destination: ACCOUNT })).toThrow(
      DestinationMemoRequirementError
    );
  });

  it("checks every destination a transaction pays and ignores the rest", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: true });

    const checks = destinationMemoChecksForTransaction({
      operations: [
        { type: "payment", destination: ACCOUNT, amount: "1" },
        { type: "payment", destination: ACCOUNT, amount: "2" },
        { type: "payment", destination: ISSUER, amount: "3" },
      ],
    });
    expect(checks.map((check) => check.destination)).toEqual([ACCOUNT, ISSUER]);

    const payment = {
      operations: [{ type: "payment", destination: ACCOUNT, amount: "1" }],
    };

    expect(() => enforceDestinationMemoRequirements(payment)).toThrow(
      DestinationMemoRequirementError
    );
    expect(() =>
      enforceDestinationMemoRequirements({
        ...payment,
        memo: { type: "text", value: "invoice-1" },
      })
    ).not.toThrow();
    // A "none" memo header is the same as no memo at all.
    expect(() =>
      enforceDestinationMemoRequirements({ ...payment, memo: { type: "none" } })
    ).toThrow(/requires a memo/);
    // Unregistered destinations are never blocked.
    expect(() =>
      enforceDestinationMemoRequirements({
        operations: [{ type: "payment", destination: ISSUER, amount: "1" }],
      })
    ).not.toThrow();
  });

  it("unregisters requirements so enforcement returns to a no-op", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: true });
    expect(unregisterDestinationMemoRequirement(ACCOUNT)).toBe(true);
    expect(unregisterDestinationMemoRequirement(ACCOUNT)).toBe(false);
    expect(getDestinationMemoRequirement(ACCOUNT)).toBeUndefined();
    expect(
      checkDestinationMemoRequirement({ destination: ACCOUNT }).valid
    ).toBe(true);
  });

  it("registers a batch of requirements at once", () => {
    const stored = registerDestinationMemoRequirements([
      { destination: ACCOUNT, required: true },
      { destination: ISSUER, required: true, memoKinds: ["text"] },
    ]);

    expect(stored).toHaveLength(2);
    expect(listDestinationMemoRequirements()).toHaveLength(2);
    expect(checkDestinationMemoRequirement({ destination: ACCOUNT }).valid).toBe(false);
    expect(checkDestinationMemoRequirement({ destination: ISSUER }).valid).toBe(false);
  });

  it("stops an unsigned plan at the composer when the destination needs a memo", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: true });

    const report = new AdvancedOperationComposer()
      .destination(ACCOUNT)
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .validate();

    expect(report.valid).toBe(false);
    const issue = report.errors.find(
      (entry) => entry.code === "DESTINATION_MEMO_REQUIRED"
    );
    expect(issue?.field).toBe("destination.memo");

    expect(() =>
      new AdvancedOperationComposer()
        .destination(ACCOUNT)
        .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
        .compose()
    ).toThrow(/Cannot compose operations/);

    const composer = new AdvancedOperationComposer()
      .destination(ACCOUNT)
      .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
      .add(textMemo("invoice-1"));
    expect(composer.validate().valid).toBe(true);

    const plan = composer.compose();
    expect(plan.destination).toBe(ACCOUNT);
    expect(plan.memo?.kind).toBe(AdvancedOperationKind.MEMO_ATTACH);

    // The wrong memo kind is rejected the same way.
    registerDestinationMemoRequirement({
      destination: ACCOUNT,
      required: true,
      memoKinds: ["id"],
    });
    expect(
      new AdvancedOperationComposer()
        .destination(ACCOUNT)
        .add(createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }))
        .add(textMemo("invoice-1"))
        .validate()
        .errors.some((entry) => entry.code === "MEMO_KIND_NOT_ACCEPTED")
    ).toBe(true);
  });

  it("leaves plans without a declared destination untouched", () => {
    registerDestinationMemoRequirement({ destination: ACCOUNT, required: true });

    const plan = composeOperations([
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }),
    ]);

    expect(plan.destination).toBeUndefined();
    expect(plan.validation.valid).toBe(true);

    const withDestination = new AdvancedOperationComposer([
      createTrustline({ assetCode: "USDC", assetIssuer: ISSUER }),
    ])
      .destination(ACCOUNT)
      .validate();
    expect(
      withDestination.errors.some(
        (entry) => entry.code === "DESTINATION_MEMO_REQUIRED"
      )
    ).toBe(true);
  });
});

describe("claim predicate eligibility", () => {
  const NOW = 1_700_000_000;
  const nowIso = (seconds: number) => new Date(seconds * 1000).toISOString();

  it("treats an absent predicate as unconditional", () => {
    expect(describeClaimPredicate(null)).toContain("unconditional");
    expect(describeClaimPredicate({})).toContain("unconditional");
    expect(evaluateClaimPredicate({}, { ledgerTime: NOW })).toBe(true);

    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: {} }],
      ledgerTime: NOW,
    });
    expect(explanation.eligible).toBe(true);
    expect(explanation.evaluated).toBe(true);
    expect(explanation.predicate).toContain("unconditional");
  });

  it("accepts a claim that lands before the absolute cut-off", () => {
    const closesAt = NOW + 3600;
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [
        { destination: ACCOUNT, predicate: { abs_before: String(closesAt) } },
      ],
      ledgerTime: NOW,
    });

    expect(explanation.eligible).toBe(true);
    expect(explanation.evaluated).toBe(true);
    expect(explanation.ledgerTime).toBe(NOW);
    expect(explanation.predicate).toContain(`claimable before ${nowIso(closesAt)}`);
    expect(explanation.reason).toContain("Claimable now");
    expect(explanation.claimExpiresAt).toBe(nowIso(closesAt));
    expect(
      evaluateClaimPredicate({ abs_before: String(closesAt) }, { ledgerTime: NOW })
    ).toBe(true);
  });

  it("names the moment a closed claim window shut", () => {
    const closedAt = NOW - 60;
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [
        { destination: ACCOUNT, predicate: { abs_before: String(closedAt) } },
      ],
      ledgerTime: NOW,
    });

    expect(explanation.eligible).toBe(false);
    expect(explanation.evaluated).toBe(true);
    expect(explanation.claimExpiresAt).toBe(nowIso(closedAt));
    expect(explanation.reason).toContain("claim window closed at");
    expect(explanation.reason).toContain(nowIso(closedAt));
    expect(
      evaluateClaimPredicate({ abs_before: String(closedAt) }, { ledgerTime: NOW })
    ).toBe(false);
  });

  it("counts relative time from when the balance was created", () => {
    const predicate = { rel_before: "60" };

    // Created ten minutes ago: the 60-second window ended minutes ago.
    const late = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate }],
      ledgerTime: NOW,
      startTime: NOW - 600,
    });
    expect(late.eligible).toBe(false);
    expect(late.evaluated).toBe(true);
    expect(late.claimExpiresAt).toBe(nowIso(NOW - 540));
    expect(late.predicate).toContain("60s after the balance was created");
    expect(late.reason).toContain("claim window closed at");

    // Created ten seconds ago: the window is still open.
    const early = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate }],
      ledgerTime: NOW,
      startTime: NOW - 10,
    });
    expect(early.eligible).toBe(true);
    expect(early.claimExpiresAt).toBe(nowIso(NOW + 50));
    expect(evaluateClaimPredicate(predicate, { ledgerTime: NOW, startTime: NOW - 10 })).toBe(
      true
    );
  });

  it("reports an unevaluable relative predicate when creation time is missing", () => {
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: { rel_before: "60" } }],
      ledgerTime: NOW,
    });

    expect(explanation.evaluated).toBe(false);
    expect(explanation.eligible).toBe(false);
    expect(explanation.predicate).toContain("claimable within 60s of the balance");
    expect(explanation.reason).toContain("creation time");
    expect(
      evaluateClaimPredicate({ rel_before: "60" }, { ledgerTime: NOW })
    ).toBe(false);
  });

  it("turns a negated cut-off into a window that opens later", () => {
    const opensAt = NOW + 60;
    const predicate = { not: { abs_before: String(opensAt) } };

    const before = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate }],
      ledgerTime: NOW,
    });
    expect(before.eligible).toBe(false);
    expect(before.evaluated).toBe(true);
    expect(before.claimableAt).toBe(nowIso(opensAt));
    expect(before.reason).toContain("claim window opens at");

    const after = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate }],
      ledgerTime: opensAt,
    });
    expect(after.eligible).toBe(true);
    expect(
      evaluateClaimPredicate(predicate, { ledgerTime: opensAt + 1 })
    ).toBe(true);
  });

  it("requires every AND predicate but any one OR predicate", () => {
    const past = { abs_before: String(NOW - 10) };
    const future = { abs_before: String(NOW + 10) };

    const both = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: { and: [past, future] } }],
      ledgerTime: NOW,
    });
    expect(both.eligible).toBe(false);
    expect(both.evaluated).toBe(true);
    expect(both.predicate).toContain(" AND ");
    expect(both.reason).toContain("claim window closed at");

    const either = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: { or: [past, future] } }],
      ledgerTime: NOW,
    });
    expect(either.eligible).toBe(true);
    expect(either.predicate).toContain(" OR ");
    expect(
      evaluateClaimPredicate({ or: [past, future] }, { ledgerTime: NOW })
    ).toBe(true);
  });

  it("explains a claimant that is not on the balance", () => {
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ISSUER, predicate: {} }],
      ledgerTime: NOW,
    });

    expect(explanation.eligible).toBe(false);
    expect(explanation.evaluated).toBe(true);
    expect(explanation.predicate).toBe("none");
    expect(explanation.reason).toContain("is not a claimant");
    expect(explanation.reason).toContain(ACCOUNT);
  });

  it("refuses to guess when the ledger time is unusable", () => {
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: { abs_before: String(NOW + 1) } }],
      ledgerTime: Number.NaN,
    });

    expect(explanation.eligible).toBe(false);
    expect(explanation.evaluated).toBe(false);
    expect(explanation.reason).toContain("finite number");
    expect(
      evaluateClaimPredicate({ abs_before: String(NOW + 1) }, {
        ledgerTime: Number.NaN,
      })
    ).toBe(false);
  });

  it("reports an unparseable predicate time as unknown rather than blocked", () => {
    const explanation = explainClaimEligibility({
      claimant: ACCOUNT,
      claimants: [{ destination: ACCOUNT, predicate: { abs_before: "tomorrow" } }],
      ledgerTime: NOW,
    });

    expect(explanation.evaluated).toBe(false);
    expect(explanation.eligible).toBe(false);
    expect(explanation.predicate).toContain("unreadable absolute time");
    expect(explanation.reason).toContain("absolute-time value is not a number");
  });
});
