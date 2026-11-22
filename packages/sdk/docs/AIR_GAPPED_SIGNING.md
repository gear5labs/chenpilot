# Air-gapped signing with verifiable manifests

A signing manifest is a deterministic, human-reviewable description of exactly
what one Stellar transaction envelope authorizes. An offline signer can compare
the manifest against the XDR before signing, and an importing host can reject
any manifest that does not match the XDR it arrived with.

This module **binds and verifies** a transaction. It does **not** sign, prove
that anyone signed, or replace signature verification.

## Flow

```
online preparer                    air gap                    offline signer
─────────────────                  ───────                    ──────────────
build unsigned XDR                                             decode manifest
createSigningManifest(xdr)   ──►  QR / file / USB  ──►          verify(manifest, xdr)
encodeSigningManifest(m)                                       render fields for review
                                                               sign the XDR offline
                                                               appendSigner(manifest, …)
online submitter                   air gap
────────────────                   ───────
decode manifest             ◄──    QR / file / USB   ◄──
verify(manifest, unsignedXdr)
merge signatures, submit
```

The manifest is generated from the **unsigned** envelope. Signatures are added
outside it: signing changes the envelope bytes, so the manifest is verified
against the unsigned XDR that was reviewed, not against the later signed XDR.
The `signers` array records provenance; the actual signatures travel
separately (for example as `OfflineSignature` values from `offlineSigning`).

## Manifest fields

| Field               | Bound to           | Notes                                                                                         |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `version`           | schema             | `1`. Unknown versions are rejected.                                                           |
| `networkPassphrase` | caller/XDR context | Checked when an expected passphrase is supplied.                                              |
| `xdrHash`           | exact XDR bytes    | Lowercase hex SHA-256 of the decoded envelope bytes.                                          |
| `sourceAccount`     | inner transaction  | `G...` source.                                                                                |
| `sequence`          | inner transaction  | Decimal string.                                                                               |
| `operations`        | XDR operations     | Bounded summaries: `type`, optional `source`, `destination`, `contractId`, `asset`, `amount`. |
| `fee`               | inner transaction  | Stroops, decimal string.                                                                      |
| `maxFee`            | fee-bump only      | Outer fee-bump fee, decimal string.                                                           |
| `feeSource`         | fee-bump only      | Outer fee-bump source.                                                                        |
| `timeBounds`        | inner transaction  | `{ minTime, maxTime }` in Unix seconds; `0` means unbounded.                                  |
| `memo`              | inner transaction  | `{ type, value }`; text memos are UTF-8, hash/return memos are hex.                           |
| `signers`           | manifest only      | `{ publicKey, label?, signedAt? }` in append order.                                           |
| `simulation`        | caller-supplied    | Bounded JSON; advisory because it is not derivable from XDR.                                  |

Operation summaries deliberately omit unbounded raw payloads. `xdrHash` still
covers every byte of the envelope, including fields the summary does not show.

## Deterministic encoding

`encodeSigningManifest` serializes the manifest with the SDK's canonical JSON
rules (keys sorted lexicographically, arrays in order, `undefined` omitted) and
encodes the resulting UTF-8 string as base64url without padding. The output
contains only characters safe for QR codes, filenames, and clipboard transfer.

Properties:

- Same manifest → identical bytes.
- Reordering object keys or changing whitespace in inputs → identical bytes.
- `decodeSigningManifest` rejects a payload that is not canonical, so two hosts
  cannot review different bytes for the same manifest.
- `version` is inside the payload; an unknown version fails with
  `SIGNING_MANIFEST_VERSION_UNSUPPORTED`.

Simulation metadata is capped at 4096 canonical bytes, 100 array entries,
64 keys per object, 8 levels of nesting, and 1024 characters per string.
Numbers must be safe integers, avoiding floating-point encoding differences.

## Verification

```ts
import {
  createSigningManifest,
  encodeSigningManifest,
  decodeSigningManifest,
  verifySigningManifest,
} from "@chen-pilot/sdk-core";

const manifest = createSigningManifest(unsignedXdr, networkPassphrase);
const payload = encodeSigningManifest(manifest); // QR / file / USB

// On the importing host:
const received = decodeSigningManifest(payload);
verifySigningManifest(received, unsignedXdr, networkPassphrase);
```

`verifySigningManifest(manifest, xdr, expectedNetworkPassphrase?)`:

1. Rejects an unknown schema version.
2. Checks the expected network passphrase when provided.
3. Recomputes `xdrHash` from the supplied XDR bytes.
4. Re-derives source, sequence, operations, fee, `maxFee`, `feeSource`, time
   bounds, and memo from the XDR and compares every one.
5. Throws `SIGNING_MANIFEST_MISMATCH` naming the first mismatched field in
   `error.details.field` (all mismatches are listed in `details.fields`).
6. On success, returns the verified manifest with its signer provenance intact.

There is no "warn and continue" path: any difference is rejected.

## Multi-signature provenance

`appendSigner` returns a new manifest with the signer appended after existing
entries. It never reorders or drops provenance, and rejects a duplicate public
key instead of silently merging it.

```ts
const withSigner = appendSigner(received, {
  publicKey: signerPublicKey,
  label: "cold signer",
  signedAt: Date.now(),
});
```

Provenance is metadata that the signer/host asserts. It is not a signature and
is not checked against the XDR.

## QR and file transfer

The encoded manifest is a single base64url string. For QR codes, keep the
operation list and simulation metadata small; a QR code has a limited payload
capacity. For files, write the string as UTF-8 and verify the hash of the file
out of band if your transfer channel is untrusted.

See `examples/airGappedSigning.ts` for a full flow, including a hostile
substitution attempt.

## Threat model

What this protects against:

- **Substitution**: a manifest for transaction A paired with transaction B is
  rejected by `xdrHash` and the re-derived fields.
- **Field tampering**: changing the displayed destination, amount, fee, time
  bounds, or operation list is rejected even if the attacker keeps the original
  XDR hash, because every field is re-derived from the XDR.
- **Network confusion**: an expected passphrase that disagrees with the
  manifest is rejected. XDR does not carry a network, so callers must supply
  this expectation; without it, the passphrase is only a declared value.
- **Encoding ambiguity**: non-canonical manifests and unknown versions are
  rejected.

What this does **not** protect against:

- A compromised preparer or signer that creates a matching manifest and XDR for
  a transaction the user did not intend.
- A malicious signer's device producing signatures without review. The manifest
  is a review format, not a hardware display guarantee.
- Signature forgery or invalid signatures. Verify signatures separately.
- A signed envelope whose signatures were added after review. The manifest
  covers the unsigned envelope; signature verification belongs to the Stellar
  signature/provenance workflow.
- Incorrect or malicious `simulation` metadata. It is caller-supplied; the SDK
  only enforces size and shape, not truth.
- Tampering with fields that are not derived from XDR (`signers`, `label`,
  `signedAt`, `simulation`). The manifest encoding is deterministic but not
  authenticated: if provenance must survive an untrusted channel, sign or MAC
  the encoded manifest separately.
- Loss of the manifest itself. A manifest cannot prove what was reviewed if the
  receiving side never compares it to the XDR.

## Tests

`src/__tests__/signingManifest.test.ts` covers determinism, exact canonical
encoding, round-trip, every mismatch field, unknown versions, signer provenance,
fee-bump envelopes, simulation bounds, and hostile manifest/XDR substitution.
