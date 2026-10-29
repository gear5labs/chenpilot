jest.unmock("@stellar/stellar-sdk");
jest.unmock("stellar-sdk");

import * as StellarSdk from "@stellar/stellar-sdk";
import { AntiPhishingPreviewEngine } from "../AntiPhishingPreviewEngine";
import { ExecutionAction } from "../../../AuditLog/auditEvent.types";

const TESTNET = StellarSdk.Networks.TESTNET;
const source = StellarSdk.Keypair.random();
const recipient = StellarSdk.Keypair.random().publicKey();
const attacker = StellarSdk.Keypair.random().publicKey();

function buildXdr(ops: StellarSdk.xdr.Operation[]): string {
  const account = new StellarSdk.Account(source.publicKey(), "100");
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: TESTNET,
  });
  ops.forEach((op) => builder.addOperation(op));
  builder.setTimeout(300);
  return builder.build().toXDR();
}

const payment = (destination = recipient, amount = "10", asset = StellarSdk.Asset.native()) =>
  StellarSdk.Operation.payment({ destination, asset, amount });

describe("AntiPhishingPreviewEngine", () => {
  it("builds preview and detects matching intent", () => {
    const xdr = buildXdr([payment()]);
    const preview = AntiPhishingPreviewEngine.buildPreview({
      xdr,
      networkPassphrase: TESTNET,
      intent: { operationTypes: ["payment"], asset: "XLM", amount: "10", destination: recipient },
    });

    expect(preview.network).toBe("testnet");
    expect(preview.decision).toBe("proceed");
    const evaluation = AntiPhishingPreviewEngine.evaluateDecision(preview);
    expect(evaluation.blocked).toBe(false);
    expect(evaluation.requiresExtraConfirmation).toBe(false);
  });

  it("refuses when intent destination mismatches attacker", () => {
    const xdr = buildXdr([payment(attacker)]);
    const preview = AntiPhishingPreviewEngine.buildPreview({
      xdr,
      networkPassphrase: TESTNET,
      intent: { destination: recipient, amount: "10" },
    });

    expect(preview.decision).toBe("refuse");
    const evaluation = AntiPhishingPreviewEngine.evaluateDecision(preview);
    expect(evaluation.blocked).toBe(true);
  });

  it("renders readable text correctly", () => {
    const xdr = buildXdr([payment()]);
    const preview = AntiPhishingPreviewEngine.buildPreview({
      xdr,
      networkPassphrase: TESTNET,
    });
    const text = AntiPhishingPreviewEngine.renderText(preview);
    expect(text).toContain("Stellar Testnet");
    expect(text).toContain(source.publicKey());
    expect(text).toContain("Send 10.0000000 XLM");
  });

  it("records audit log successfully", async () => {
    const xdr = buildXdr([payment()]);
    const preview = AntiPhishingPreviewEngine.buildPreview({
      xdr,
      networkPassphrase: TESTNET,
    });
    const logEvent = jest.fn().mockResolvedValue(true);
    await AntiPhishingPreviewEngine.auditPreview(preview, { logEvent });
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: ExecutionAction.TRANSACTION_PREVIEW_GENERATED,
      })
    );
  });
});
