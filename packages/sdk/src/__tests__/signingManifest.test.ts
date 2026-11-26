/**
 * Tests for verifiable air-gapped signing manifests (#640).
 */

import * as StellarSdk from "@stellar/stellar-sdk";

import {
  MAX_MANIFEST_SIMULATION_BYTES,
  SIGNING_MANIFEST_VERSION,
  appendSigner,
  createSigningManifest,
  decodeSigningManifest,
  encodeSigningManifest,
  hashTransactionXdr,
  verifySigningManifest,
  type SigningManifest,
} from "../signingManifest";
import { fromBase64Url } from "../canonical";
import { isSdkError } from "../errors";

const PASSPHRASE = "Test SDF Network ; September 2015";
const OTHER_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const SOURCE = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DESTINATION = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function buildXdr(
  options: {
    destination?: string;
    amount?: string;
    memo?: StellarSdk.Memo;
    timebounds?: { minTime: number; maxTime: number };
  } = {}
): string {
  const builder = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(SOURCE, "12345"),
    {
      fee: "100",
      networkPassphrase: PASSPHRASE,
      timebounds: options.timebounds ?? { minTime: 0, maxTime: 0 },
    }
  )
    .addOperation(
      StellarSdk.Operation.payment({
        destination: options.destination ?? DESTINATION,
        asset: StellarSdk.Asset.native(),
        amount: options.amount ?? "10",
      })
    )
    .addMemo(options.memo ?? StellarSdk.Memo.text("invoice-42"));

  return builder.build().toXDR();
}

function buildFeeBumpXdr(): string {
  const inner = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(SOURCE, "12345"),
    {
      fee: "100",
      networkPassphrase: PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 0 },
    }
  )
    .addOperation(
      StellarSdk.Operation.payment({
        destination: DESTINATION,
        asset: StellarSdk.Asset.native(),
        amount: "10",
      })
    )
    .build();

  return StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    StellarSdk.Keypair.random().publicKey(),
    "200",
    inner,
    PASSPHRASE
  ).toXDR();
}

function manifest(
  overrides: { xdr?: string; simulation?: Record<string, unknown> } = {}
) {
  return createSigningManifest(overrides.xdr ?? buildXdr(), PASSPHRASE, {
    simulation: overrides.simulation as never,
  });
}

function expectFailure(run: () => unknown, code: string, field?: string) {
  try {
    run();
  } catch (caught) {
    expect(isSdkError(caught)).toBe(true);
    if (!isSdkError(caught)) return;
    expect(caught.code).toBe(code);
    if (field) expect(caught.details?.field).toBe(field);
    return;
  }
  throw new Error(
    `Expected ${code}${field ? ` on ${field}` : ""} but nothing was thrown`
  );
}

describe("createSigningManifest", () => {
  it("derives every bound field from the XDR", () => {
    const xdr = buildXdr({
      memo: StellarSdk.Memo.id("987654321"),
      timebounds: { minTime: 1_700_000_000, maxTime: 1_700_000_300 },
    });
    const result = createSigningManifest(xdr, PASSPHRASE);

    expect(result.version).toBe(SIGNING_MANIFEST_VERSION);
    expect(result.networkPassphrase).toBe(PASSPHRASE);
    expect(result.xdrHash).toBe(hashTransactionXdr(xdr));
    expect(result.xdrHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sourceAccount).toBe(SOURCE);
    expect(result.sequence).toBe("12346");
    expect(result.fee).toBe("100");
    expect(result.timeBounds).toEqual({
      minTime: 1_700_000_000,
      maxTime: 1_700_000_300,
    });
    expect(result.memo).toEqual({ type: "id", value: "987654321" });
    expect(result.operations).toEqual([
      {
        type: "payment",
        destination: DESTINATION,
        asset: "native",
        amount: "10.0000000",
      },
    ]);
    expect(result.signers).toEqual([]);
    expect(result.simulation).toBeUndefined();
  });

  it("summarizes fee-bump envelopes without losing the inner authorization", () => {
    const xdr = buildFeeBumpXdr();
    const result = createSigningManifest(xdr, PASSPHRASE);

    expect(result.sourceAccount).toBe(SOURCE);
    expect(result.fee).toBe("100");
    expect(result.maxFee).toBe("400");
    expect(result.feeSource).toMatch(/^G/);
    expect(verifySigningManifest(result, xdr, PASSPHRASE).valid).toBe(true);
  });

  it("rejects an XDR that cannot be decoded", () => {
    expectFailure(
      () => createSigningManifest("not-an-envelope", PASSPHRASE),
      "SIGNING_MANIFEST_INVALID",
      "xdr"
    );
  });

  it("bounds simulation metadata and rejects floating point", () => {
    expectFailure(
      () => manifest({ simulation: { price: 1.5 } }),
      "SIGNING_MANIFEST_INVALID",
      "simulation.price"
    );

    expectFailure(
      () =>
        manifest({
          simulation: { blob: "x".repeat(MAX_MANIFEST_SIMULATION_BYTES) },
        }),
      "SIGNING_MANIFEST_INVALID",
      "simulation.blob"
    );

    const oversized: Record<string, string> = {};
    for (let index = 0; index < 64; index += 1) {
      oversized[`k${index}`] = "v".repeat(100);
    }
    expectFailure(
      () => manifest({ simulation: oversized }),
      "SIGNING_MANIFEST_INVALID",
      "simulation"
    );
  });
});

describe("deterministic encoding", () => {
  it("produces identical bytes for identical input", () => {
    const xdr = buildXdr();
    expect(encodeSigningManifest(createSigningManifest(xdr, PASSPHRASE))).toBe(
      encodeSigningManifest(createSigningManifest(xdr, PASSPHRASE))
    );
  });

  it("ignores key insertion order, both in the manifest and in simulation", () => {
    const first = createSigningManifest(buildXdr(), PASSPHRASE, {
      simulation: { a: 1, b: { c: 2, d: 3 } },
    });
    const reordered = {
      simulation: { b: { d: 3, c: 2 }, a: 1 },
      signers: first.signers,
      memo: first.memo,
      timeBounds: {
        maxTime: first.timeBounds.maxTime,
        minTime: first.timeBounds.minTime,
      },
      fee: first.fee,
      operations: first.operations,
      sequence: first.sequence,
      sourceAccount: first.sourceAccount,
      xdrHash: first.xdrHash,
      networkPassphrase: first.networkPassphrase,
      version: first.version,
    } as SigningManifest;

    expect(encodeSigningManifest(reordered)).toBe(encodeSigningManifest(first));
  });

  it("encodes canonical JSON as base64url and round-trips it", () => {
    const original = createSigningManifest(buildXdr(), PASSPHRASE);
    const encoded = encodeSigningManifest(original);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(encoded)).toBe(
      '{"fee":"100","memo":{"type":"text","value":"invoice-42"},' +
        '"networkPassphrase":"Test SDF Network ; September 2015",' +
        '"operations":[{"amount":"10.0000000","asset":"native",' +
        `"destination":"${DESTINATION}","type":"payment"}],` +
        `"sequence":"12346","signers":[],"sourceAccount":"${SOURCE}",` +
        '"timeBounds":{"maxTime":0,"minTime":0},"version":1,' +
        `"xdrHash":"${hashTransactionXdr(buildXdr())}"}`
    );
    expect(decodeSigningManifest(encoded)).toEqual(original);
  });

  it("rejects non-canonical transport encodings", () => {
    const encoded = Buffer.from(
      JSON.stringify(createSigningManifest(buildXdr(), PASSPHRASE), null, 2),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expectFailure(
      () => decodeSigningManifest(encoded),
      "SIGNING_MANIFEST_INVALID",
      "manifest"
    );
  });
});

describe("verifySigningManifest", () => {
  it("accepts the matching XDR and expected network", () => {
    const xdr = buildXdr();
    const result = verifySigningManifest(manifest({ xdr }), xdr, PASSPHRASE);
    expect(result.valid).toBe(true);
    expect(result.xdrHash).toBe(hashTransactionXdr(xdr));
  });

  it("rejects a hostile manifest/XDR substitution", () => {
    const honest = buildXdr({ amount: "10" });
    const hostile = buildXdr({
      destination: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ",
      amount: "9999",
    });

    expectFailure(
      () =>
        verifySigningManifest(
          createSigningManifest(honest, PASSPHRASE),
          hostile
        ),
      "SIGNING_MANIFEST_MISMATCH",
      "xdrHash"
    );
  });

  it.each([
    [
      "sourceAccount",
      (m: SigningManifest) => ({ ...m, sourceAccount: DESTINATION }),
    ],
    ["sequence", (m: SigningManifest) => ({ ...m, sequence: "99999" })],
    ["fee", (m: SigningManifest) => ({ ...m, fee: "999" })],
    ["maxFee", (m: SigningManifest) => ({ ...m, maxFee: "999" })],
    ["feeSource", (m: SigningManifest) => ({ ...m, feeSource: DESTINATION })],
    [
      "timeBounds",
      (m: SigningManifest) => ({
        ...m,
        timeBounds: { ...m.timeBounds, maxTime: m.timeBounds.maxTime + 1 },
      }),
    ],
    [
      "memo",
      (m: SigningManifest) => ({
        ...m,
        memo: { type: "text", value: "other" },
      }),
    ],
    [
      "operations",
      (m: SigningManifest) => ({
        ...m,
        operations: m.operations.map((op) => ({ ...op, amount: "9999" })),
      }),
    ],
    ["xdrHash", (m: SigningManifest) => ({ ...m, xdrHash: "0".repeat(64) })],
  ])("rejects a mismatch on %s", (field, mutate) => {
    const xdr = buildXdr();
    expectFailure(
      () =>
        verifySigningManifest(
          mutate(createSigningManifest(xdr, PASSPHRASE)),
          xdr
        ),
      "SIGNING_MANIFEST_MISMATCH",
      field
    );
  });

  it("rejects a network passphrase mismatch when an expectation is supplied", () => {
    const xdr = buildXdr();
    expectFailure(
      () =>
        verifySigningManifest(
          createSigningManifest(xdr, PASSPHRASE),
          xdr,
          OTHER_PASSPHRASE
        ),
      "SIGNING_MANIFEST_MISMATCH",
      "networkPassphrase"
    );
  });

  it("rejects unknown manifest versions", () => {
    const xdr = buildXdr();
    const future = { ...createSigningManifest(xdr, PASSPHRASE), version: 2 };
    expectFailure(
      () => verifySigningManifest(future, xdr),
      "SIGNING_MANIFEST_VERSION_UNSUPPORTED",
      "version"
    );
  });
});

describe("multi-signature provenance", () => {
  it("appends signers in collection order and preserves them through encoding", () => {
    const original = createSigningManifest(buildXdr(), PASSPHRASE);
    const withA = appendSigner(original, {
      publicKey: DESTINATION,
      label: "treasury-a",
      signedAt: 1_700_000_000_000,
    });
    const withB = appendSigner(withA, {
      publicKey: SOURCE,
      label: "treasury-b",
      signedAt: 1_700_000_001_000,
    });

    expect(original.signers).toEqual([]);
    expect(withB.signers.map((signer) => signer.label)).toEqual([
      "treasury-a",
      "treasury-b",
    ]);

    const decoded = decodeSigningManifest(encodeSigningManifest(withB));
    expect(decoded.signers).toEqual(withB.signers);
    expect(verifySigningManifest(decoded, buildXdr()).manifest.signers).toEqual(
      withB.signers
    );
  });

  it("rejects duplicate signer provenance instead of merging it", () => {
    const withA = appendSigner(createSigningManifest(buildXdr(), PASSPHRASE), {
      publicKey: DESTINATION,
    });
    expectFailure(
      () => appendSigner(withA, { publicKey: DESTINATION, label: "again" }),
      "SIGNING_MANIFEST_INVALID",
      "signers"
    );
  });
});
