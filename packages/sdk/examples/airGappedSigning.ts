/**
 * Example: air-gapped signing with a verifiable transaction manifest (#640).
 *
 * The manifest is a deterministic, reviewable description of the unsigned
 * envelope. It binds the XDR hash and every field an offline signer needs to
 * inspect; it does not sign or prove that a signature exists.
 *
 * Run with: npx ts-node examples/airGappedSigning.ts
 */

import * as StellarSdk from "@stellar/stellar-sdk";

import {
  appendSigner,
  createSigningManifest,
  decodeSigningManifest,
  encodeSigningManifest,
  verifySigningManifest,
} from "../src/signingManifest";

const networkPassphrase = StellarSdk.Networks.TESTNET;

function buildUnsignedTransaction(
  source: string,
  destination: string,
  amount: string
): string {
  return new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(source, "100"),
    {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
      timebounds: { minTime: 0, maxTime: 0 },
    }
  )
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset: StellarSdk.Asset.native(),
        amount,
      })
    )
    .addMemo(StellarSdk.Memo.text("invoice-42"))
    .build()
    .toXDR();
}

// ── Online preparer ──────────────────────────────────────────────────────────
const hotWallet = StellarSdk.Keypair.random();
const coldSigner = StellarSdk.Keypair.random();
const destination = StellarSdk.Keypair.random().publicKey();

const unsignedXdr = buildUnsignedTransaction(
  hotWallet.publicKey(),
  destination,
  "25"
);

const manifest = createSigningManifest(unsignedXdr, networkPassphrase, {
  simulation: {
    // Advisory only: the SDK bounds and carries this, it cannot verify it.
    success: true,
    minResourceFee: "1234",
  },
});

// QR-safe, file-safe single string.
const qrPayload = encodeSigningManifest(manifest);
console.log(`Transfer ${qrPayload.length} characters across the air gap.`);

// ── Offline signer ───────────────────────────────────────────────────────────
const received = decodeSigningManifest(qrPayload);
verifySigningManifest(received, unsignedXdr, networkPassphrase);

console.log("Review before signing:");
console.log(`  network : ${received.networkPassphrase}`);
console.log(`  source  : ${received.sourceAccount}`);
console.log(`  fee     : ${received.fee} stroops`);
for (const operation of received.operations) {
  console.log(
    `  op      : ${operation.type} ${operation.amount ?? ""} ${
      operation.asset ?? ""
    } -> ${operation.destination ?? operation.contractId ?? "-"}`
  );
}

// Signing changes the envelope bytes; that signed XDR travels separately.
const offlineTransaction = StellarSdk.TransactionBuilder.fromXDR(
  unsignedXdr,
  networkPassphrase
) as StellarSdk.Transaction;
offlineTransaction.sign(coldSigner);
const signedXdr = offlineTransaction.toXDR();

// Provenance is appended in review order; it is metadata, not a signature.
const withProvenance = appendSigner(received, {
  publicKey: coldSigner.publicKey(),
  label: "cold vault",
  signedAt: Date.now(),
});
const returnPayload = encodeSigningManifest(withProvenance);

// ── Online submitter ─────────────────────────────────────────────────────────
const returned = decodeSigningManifest(returnPayload);
const verified = verifySigningManifest(
  returned,
  unsignedXdr,
  networkPassphrase
);

console.log("Returned provenance:", verified.manifest.signers);
console.log(
  "Signed envelope ready for signature collection:",
  signedXdr.slice(0, 16) + "..."
);

// ── Hostile substitution: verification refuses to accept it ──────────────────
const substitutedXdr = buildUnsignedTransaction(
  hotWallet.publicKey(),
  StellarSdk.Keypair.random().publicKey(),
  "2500"
);

try {
  verifySigningManifest(verified.manifest, substitutedXdr, networkPassphrase);
  throw new Error("unreachable: substitution should have been rejected");
} catch (error) {
  if (error instanceof Error && error.name === "SdkError") {
    console.log("Substitution rejected as expected:", error.message);
  } else {
    throw error;
  }
}
