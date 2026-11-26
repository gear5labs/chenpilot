/**
 * Verifiable signing manifests for air-gapped signing (#640).
 *
 * A manifest is a deterministic, human-reviewable description of exactly what
 * a Stellar transaction envelope authorizes. It binds the envelope hash,
 * network passphrase, source account, sequence, operations, fees, time bounds,
 * and caller-supplied simulation metadata, and it records signer provenance
 * without claiming that a signature exists.
 *
 * Encoding is canonical JSON (sorted keys, undefined omitted) encoded as
 * base64url, so the same manifest always produces identical bytes and the
 * encoding is safe to move by file or QR code.
 */

import { createHash } from "crypto";
import * as StellarSdk from "@stellar/stellar-sdk";

import {
  canonicalize,
  fromBase64Url,
  toBase64Url,
  type CanonicalValue,
} from "./canonical";
import { ErrorRegistry } from "./errorRegistry";

/** Schema version of the manifest payload. Bump on any breaking field change. */
export const SIGNING_MANIFEST_VERSION = 1;

/** Maximum number of operations a manifest will summarize. */
export const MAX_MANIFEST_OPERATIONS = 100;

/** Maximum canonical size of caller-supplied simulation metadata, in bytes. */
export const MAX_MANIFEST_SIMULATION_BYTES = 4096;

const MAX_OPERATION_STRING = 256;
const MAX_SIGNER_LABEL = 128;

/** A bounded, deterministic summary of one operation. */
export interface SigningManifestOperation {
  type: string;
  /** Operation-level source account, when it differs from the transaction source. */
  source?: string;
  destination?: string;
  contractId?: string;
  asset?: string;
  amount?: string;
}

/** Unix seconds. `0` means "no bound" on that side, matching Stellar. */
export interface SigningManifestTimeBounds {
  minTime: number;
  maxTime: number;
}

export interface SigningManifestMemo {
  type: string;
  value: string;
}

/** Provenance for a signer who reviewed (and, out of band, may have signed) this manifest. */
export interface SigningManifestSigner {
  publicKey: string;
  label?: string;
  /** Unix epoch milliseconds at which the signer reviewed/signed. */
  signedAt?: number;
}

/**
 * Caller-supplied simulation metadata. It is covered by the manifest encoding
 * but cannot be recomputed from XDR, so it is advisory, not authoritative.
 */
export type SigningManifestSimulation = Record<string, CanonicalValue>;

/** Canonical signing manifest. */
export interface SigningManifest {
  version: number;
  networkPassphrase: string;
  /** Hex SHA-256 of the exact transaction envelope XDR bytes. */
  xdrHash: string;
  sourceAccount: string;
  sequence: string;
  operations: SigningManifestOperation[];
  /** Fee paid by the transaction itself, in stroops (decimal string). */
  fee: string;
  /** Fee-bump envelope max fee, in stroops. Absent for ordinary transactions. */
  maxFee?: string;
  /** Fee-bump fee source. Absent for ordinary transactions. */
  feeSource?: string;
  timeBounds: SigningManifestTimeBounds;
  memo?: SigningManifestMemo;
  /** Signers in the order they were appended; never reordered or dropped. */
  signers: SigningManifestSigner[];
  simulation?: SigningManifestSimulation;
}

export interface CreateSigningManifestOptions {
  signers?: SigningManifestSigner[];
  simulation?: SigningManifestSimulation;
}

export interface SigningManifestVerification {
  valid: true;
  xdrHash: string;
  manifest: SigningManifest;
}

function invalid(
  field: string,
  message: string,
  details?: Record<string, unknown>
) {
  return ErrorRegistry.createError("SIGNING_MANIFEST_INVALID", {
    message,
    details: { field, ...details },
  });
}

function mismatch(
  field: string,
  expected: unknown,
  actual: unknown,
  fields: string[] = [field]
) {
  return ErrorRegistry.createError("SIGNING_MANIFEST_MISMATCH", {
    message: `Signing manifest mismatch on '${field}'`,
    details: { field, fields, expected, actual },
  });
}

function unsupportedVersion(version: unknown) {
  return ErrorRegistry.createError("SIGNING_MANIFEST_VERSION_UNSUPPORTED", {
    message: `Unsupported signing manifest version '${String(version)}'; expected ${SIGNING_MANIFEST_VERSION}`,
    details: {
      field: "version",
      expected: SIGNING_MANIFEST_VERSION,
      actual: version,
    },
  });
}

function boundString(
  value: unknown,
  field: string,
  max = MAX_OPERATION_STRING
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw invalid(
      field,
      `'${field}' must be a non-empty string of at most ${max} characters`
    );
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return boundString(value, field);
}

function parseEnvelope(xdr: string, networkPassphrase: string) {
  if (typeof xdr !== "string" || xdr.trim() === "") {
    throw invalid("xdr", "A transaction envelope XDR string is required");
  }
  if (
    typeof networkPassphrase !== "string" ||
    networkPassphrase.trim() === ""
  ) {
    throw invalid("networkPassphrase", "A network passphrase is required");
  }

  try {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      networkPassphrase
    );
    if (transaction instanceof StellarSdk.FeeBumpTransaction) {
      return {
        transaction: transaction.innerTransaction,
        maxFee: transaction.fee,
        feeSource: transaction.feeSource,
      };
    }
    return { transaction, maxFee: undefined, feeSource: undefined };
  } catch (caught) {
    throw invalid("xdr", "Transaction envelope XDR could not be decoded", {
      cause: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

function assetText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: unknown }).toString === "function") {
    const text = (value as { toString(): string }).toString();
    return text === "[object Object]" ? undefined : text;
  }
  return undefined;
}

function contractIdOf(operation: Record<string, unknown>): string | undefined {
  const func = operation.func as
    | {
        switch?: () => unknown;
        invokeContract?: () => { contractAddress: () => unknown };
      }
    | undefined;
  if (!func || typeof func.switch !== "function") return undefined;

  try {
    if (
      func.switch() ===
      StellarSdk.xdr.HostFunctionType.hostFunctionTypeInvokeContract()
    ) {
      const address = func.invokeContract?.().contractAddress();
      return address
        ? StellarSdk.Address.fromScAddress(address as never).toString()
        : undefined;
    }
  } catch {
    // A malformed host function is still covered by xdrHash; the summary just
    // omits the contract id rather than failing the whole manifest.
  }
  return undefined;
}

/** Build a bounded summary. Unknown operation fields are intentionally omitted. */
function summarizeOperation(operation: unknown): SigningManifestOperation {
  const op = operation as Record<string, unknown>;
  const summary: SigningManifestOperation = {
    type: typeof op.type === "string" ? op.type : "unknown",
  };

  const source = optionalString(op.source, "operations[].source");
  if (source) summary.source = source;

  const destination =
    assetText(op.destination) ?? assetText(op.into) ?? assetText(op.account);
  if (destination) summary.destination = destination;

  const contractId = contractIdOf(op);
  if (contractId) summary.contractId = contractId;

  const asset =
    assetText(op.asset) ??
    assetText(op.sendAsset) ??
    assetText(op.destAsset) ??
    assetText(op.selling) ??
    assetText(op.buying) ??
    assetText(op.line);
  if (asset) summary.asset = asset;

  const amount =
    assetText(op.amount) ??
    assetText(op.startingBalance) ??
    assetText(op.destAmount) ??
    assetText(op.sendMax);
  if (amount) summary.amount = amount;

  return summary;
}

function summarizeMemo(memo: unknown): SigningManifestMemo | undefined {
  if (!memo || typeof memo !== "object") return undefined;
  const { type, value } = memo as { type?: unknown; value?: unknown };
  if (type === "none" || type === undefined) return undefined;
  if (typeof type !== "string") return undefined;

  if (value === null || value === undefined) return { type, value: "" };
  const text = Buffer.isBuffer(value)
    ? type === "text"
      ? value.toString("utf8")
      : value.toString("hex")
    : String(value);
  return { type, value: text.slice(0, MAX_OPERATION_STRING) };
}

function assertSimulation(
  value: unknown,
  path = "simulation",
  depth = 0
): void {
  if (depth > 8) {
    throw invalid(path, "Simulation metadata is nested too deeply");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "string" && value.length > 1024) {
      throw invalid(
        path,
        "Simulation string values are limited to 1024 characters"
      );
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw invalid(path, "Simulation numbers must be safe integers");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_MANIFEST_OPERATIONS) {
      throw invalid(path, "Simulation arrays are limited to 100 entries");
    }
    value.forEach((item, index) =>
      assertSimulation(item, `${path}[${index}]`, depth + 1)
    );
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) {
      throw invalid(path, "Simulation objects are limited to 64 keys");
    }
    for (const [key, item] of entries) {
      if (key.length > 128) {
        throw invalid(path, "Simulation keys are limited to 128 characters");
      }
      assertSimulation(item, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw invalid(path, "Simulation metadata must contain only JSON-safe values");
}

function boundSimulation(
  simulation: SigningManifestSimulation | undefined
): SigningManifestSimulation | undefined {
  if (simulation === undefined) return undefined;
  assertSimulation(simulation);
  const size = Buffer.byteLength(canonicalize(simulation), "utf8");
  if (size > MAX_MANIFEST_SIMULATION_BYTES) {
    throw invalid(
      "simulation",
      `Simulation metadata exceeds ${MAX_MANIFEST_SIMULATION_BYTES} canonical bytes`,
      { size }
    );
  }
  return simulation;
}

function checkSigner(signer: SigningManifestSigner, index: number): void {
  if (!signer || typeof signer !== "object") {
    throw invalid(
      `signers[${index}]`,
      "Signer provenance entries must be objects"
    );
  }
  boundString(signer.publicKey, `signers[${index}].publicKey`, 128);
  if (signer.label !== undefined) {
    boundString(signer.label, `signers[${index}].label`, MAX_SIGNER_LABEL);
  }
  if (
    signer.signedAt !== undefined &&
    (!Number.isSafeInteger(signer.signedAt) || signer.signedAt < 0)
  ) {
    throw invalid(
      `signers[${index}].signedAt`,
      "signedAt must be a non-negative integer of epoch milliseconds"
    );
  }
}

/**
 * SHA-256 of the exact envelope XDR bytes (not of the base64 text), so line
 * wrapping or base64 formatting cannot change the bound hash.
 */
export function hashTransactionXdr(xdr: string): string {
  if (typeof xdr !== "string" || xdr.trim() === "") {
    throw invalid("xdr", "A transaction envelope XDR string is required");
  }
  const bytes = Buffer.from(xdr, "base64");
  if (bytes.length === 0) {
    throw invalid(
      "xdr",
      "Transaction envelope XDR did not decode to any bytes"
    );
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Derive a manifest from an unsigned envelope. Everything except `signers` and
 * `simulation` is read from the envelope, so a manifest cannot disagree with
 * the XDR it was created from.
 */
export function createSigningManifest(
  xdr: string,
  networkPassphrase: string,
  options: CreateSigningManifestOptions = {}
): SigningManifest {
  const { transaction, maxFee, feeSource } = parseEnvelope(
    xdr,
    networkPassphrase
  );

  if (transaction.operations.length > MAX_MANIFEST_OPERATIONS) {
    throw invalid(
      "operations",
      `A manifest may summarize at most ${MAX_MANIFEST_OPERATIONS} operations`
    );
  }

  const signers = options.signers ?? [];
  signers.forEach(checkSigner);

  const minTime = Number(transaction.timeBounds?.minTime ?? 0);
  const maxTime = Number(transaction.timeBounds?.maxTime ?? 0);
  for (const [field, value] of [
    ["timeBounds.minTime", minTime],
    ["timeBounds.maxTime", maxTime],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalid(field, "Time bounds must be non-negative safe integers");
    }
  }

  const memo = summarizeMemo(transaction.memo);
  const simulation = boundSimulation(options.simulation);

  return {
    version: SIGNING_MANIFEST_VERSION,
    networkPassphrase,
    xdrHash: hashTransactionXdr(xdr),
    sourceAccount: transaction.source,
    sequence: transaction.sequence,
    operations: transaction.operations.map(summarizeOperation),
    fee: transaction.fee,
    ...(maxFee !== undefined ? { maxFee } : {}),
    ...(feeSource !== undefined ? { feeSource } : {}),
    timeBounds: { minTime, maxTime },
    ...(memo !== undefined ? { memo } : {}),
    signers: signers.map((signer) => ({ ...signer })),
    ...(simulation !== undefined ? { simulation } : {}),
  };
}

function validateManifest(manifest: SigningManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw invalid("manifest", "A signing manifest object is required");
  }
  if (manifest.version !== SIGNING_MANIFEST_VERSION) {
    throw unsupportedVersion(manifest.version);
  }
  boundString(manifest.networkPassphrase, "networkPassphrase", 1024);
  if (
    typeof manifest.xdrHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.xdrHash)
  ) {
    throw invalid("xdrHash", "xdrHash must be a lowercase hex SHA-256 digest");
  }
  boundString(manifest.sourceAccount, "sourceAccount", 128);
  boundString(manifest.sequence, "sequence", 64);
  boundString(manifest.fee, "fee", 64);
  if (manifest.maxFee !== undefined) boundString(manifest.maxFee, "maxFee", 64);
  if (manifest.feeSource !== undefined) {
    boundString(manifest.feeSource, "feeSource", 128);
  }
  if (!Array.isArray(manifest.operations)) {
    throw invalid("operations", "operations must be an array");
  }
  if (manifest.operations.length > MAX_MANIFEST_OPERATIONS) {
    throw invalid(
      "operations",
      `A manifest may summarize at most ${MAX_MANIFEST_OPERATIONS} operations`
    );
  }
  manifest.operations.forEach((operation, index) => {
    if (!operation || typeof operation !== "object") {
      throw invalid(
        `operations[${index}]`,
        "Operation summaries must be objects"
      );
    }
    boundString(operation.type, `operations[${index}].type`, 64);
    optionalString(operation.source, `operations[${index}].source`);
    optionalString(operation.destination, `operations[${index}].destination`);
    optionalString(operation.contractId, `operations[${index}].contractId`);
    optionalString(operation.asset, `operations[${index}].asset`);
    optionalString(operation.amount, `operations[${index}].amount`);
  });
  if (
    !manifest.timeBounds ||
    !Number.isSafeInteger(manifest.timeBounds.minTime) ||
    !Number.isSafeInteger(manifest.timeBounds.maxTime) ||
    manifest.timeBounds.minTime < 0 ||
    manifest.timeBounds.maxTime < 0
  ) {
    throw invalid(
      "timeBounds",
      "timeBounds must hold non-negative safe integers"
    );
  }
  if (manifest.memo !== undefined) {
    boundString(manifest.memo.type, "memo.type", 32);
    if (
      typeof manifest.memo.value !== "string" ||
      manifest.memo.value.length > MAX_OPERATION_STRING
    ) {
      throw invalid("memo.value", "memo.value must be a bounded string");
    }
  }
  if (!Array.isArray(manifest.signers)) {
    throw invalid("signers", "signers must be an array");
  }
  manifest.signers.forEach(checkSigner);
  boundSimulation(manifest.simulation);
}

/** Deterministic canonical JSON -> base64url encoding of a manifest. */
export function encodeSigningManifest(manifest: SigningManifest): string {
  validateManifest(manifest);
  return toBase64Url(canonicalize(manifest as unknown as CanonicalValue));
}

/**
 * Decode and validate a manifest received across the air gap.
 *
 * Non-canonical encodings are rejected so two hosts cannot disagree about the
 * bytes they reviewed.
 */
export function decodeSigningManifest(encoded: string): SigningManifest {
  if (typeof encoded !== "string" || encoded.trim() === "") {
    throw invalid("manifest", "An encoded signing manifest is required");
  }

  let manifest: SigningManifest;
  let json: string;
  try {
    json = fromBase64Url(encoded.trim());
    manifest = JSON.parse(json) as SigningManifest;
  } catch (caught) {
    throw invalid(
      "manifest",
      "Encoded signing manifest is not valid base64url JSON",
      {
        cause: caught instanceof Error ? caught.message : String(caught),
      }
    );
  }

  validateManifest(manifest);

  if (canonicalize(manifest as unknown as CanonicalValue) !== json) {
    throw invalid("manifest", "Signing manifest is not canonically encoded");
  }

  return manifest;
}

function same(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    canonicalize(a as CanonicalValue) === canonicalize(b as CanonicalValue)
  );
}

/**
 * Verify a manifest against the XDR it claims to describe.
 *
 * Throws a structured `SIGNING_MANIFEST_MISMATCH` on the first mismatched
 * field (with `details.field` and `details.fields`), or a version error for an
 * unknown schema. `expectedNetworkPassphrase` is the only way to check the
 * network binding: XDR itself carries no network.
 */
export function verifySigningManifest(
  manifest: SigningManifest,
  xdr: string,
  expectedNetworkPassphrase?: string
): SigningManifestVerification {
  validateManifest(manifest);

  const mismatched: string[] = [];
  const expected: Record<string, unknown> = {};
  const actual: Record<string, unknown> = {};

  const record = (
    field: string,
    expectedValue: unknown,
    actualValue: unknown
  ) => {
    if (same(expectedValue, actualValue)) return;
    mismatched.push(field);
    expected[field] = expectedValue;
    actual[field] = actualValue;
  };

  if (
    expectedNetworkPassphrase !== undefined &&
    expectedNetworkPassphrase !== manifest.networkPassphrase
  ) {
    record(
      "networkPassphrase",
      expectedNetworkPassphrase,
      manifest.networkPassphrase
    );
  }

  record("xdrHash", manifest.xdrHash, hashTransactionXdr(xdr));

  const { transaction, maxFee, feeSource } = parseEnvelope(
    xdr,
    expectedNetworkPassphrase ?? manifest.networkPassphrase
  );

  record("sourceAccount", manifest.sourceAccount, transaction.source);
  record("sequence", manifest.sequence, transaction.sequence);
  record("fee", manifest.fee, transaction.fee);
  record("maxFee", manifest.maxFee, maxFee);
  record("feeSource", manifest.feeSource, feeSource);
  record("timeBounds", manifest.timeBounds, {
    minTime: Number(transaction.timeBounds?.minTime ?? 0),
    maxTime: Number(transaction.timeBounds?.maxTime ?? 0),
  });
  record("memo", manifest.memo, summarizeMemo(transaction.memo));
  record(
    "operations",
    manifest.operations,
    transaction.operations.map(summarizeOperation)
  );

  if (mismatched.length > 0) {
    throw mismatch(mismatched[0], expected, actual, mismatched);
  }

  return { valid: true, xdrHash: manifest.xdrHash, manifest };
}

/**
 * Append signer provenance without reordering existing entries. Duplicate
 * public keys are rejected rather than silently merged, so collection order and
 * provenance stay unambiguous.
 */
export function appendSigner(
  manifest: SigningManifest,
  signer: SigningManifestSigner
): SigningManifest {
  validateManifest(manifest);
  checkSigner(signer, manifest.signers.length);
  if (
    manifest.signers.some((existing) => existing.publicKey === signer.publicKey)
  ) {
    throw invalid(
      "signers",
      `Signer '${signer.publicKey}' is already present in the manifest`
    );
  }
  return { ...manifest, signers: [...manifest.signers, { ...signer }] };
}
