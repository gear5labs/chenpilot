jest.unmock("@stellar/stellar-sdk");
jest.unmock("stellar-sdk");

import * as StellarSdk from "@stellar/stellar-sdk";
import { TransactionPreviewService } from "../services/TransactionPreviewService";
import { ExecutionAction } from "../../../../src/AuditLog/auditEvent.types";

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

describe("TransactionPreviewService", () => {
  it("builds, evaluates, and renders safe preview locally", () => {
    const service = new TransactionPreviewService();
    const xdr = buildXdr([payment()]);
    const result = service.buildAndEvaluate({
      xdr,
      networkPassphrase: TESTNET,
      intent: { operationTypes: ["payment"], asset: "XLM", amount: "10", destination: recipient },
    });

    expect(result.preview.network).toBe("testnet");
    expect(result.evaluation.blocked).toBe(false);
    expect(result.evaluation.requiresExtraConfirmation).toBe(false);
    expect(result.text).toContain("Stellar Testnet");
    expect(result.text).toContain("Send 10.0000000 XLM");
  });

  it("blocks high-risk mismatched intent correctly", async () => {
    const auditSink = { logEvent: jest.fn().mockResolvedValue(true) };
    const service = new TransactionPreviewService({ auditSink });
    const xdr = buildXdr([payment(attacker)]);

    const reply = await service.handlePreviewRequest({
      xdr,
      networkPassphrase: TESTNET,
      intent: { destination: recipient, amount: "10" },
    });

    expect(reply.blocked).toBe(true);
    expect(reply.reply.text).toContain("⛔");
    expect(auditSink.logEvent).toHaveBeenCalledTimes(1);
    expect(auditSink.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: ExecutionAction.TRANSACTION_PREVIEW_REFUSED,
      })
    );
  });

  it("integrates with remote fetcher when provided", async () => {
    const mockFetcher = jest.fn().mockResolvedValue({
      success: true,
      text: "Remote preview text",
      decision: "confirm_with_warning",
      preview: {
        decision: "confirm_with_warning",
        decisionReason: "Warning triggered",
        audit: { previewId: "p1", transactionHash: "0123456789abcdef" },
      },
    });

    const service = new TransactionPreviewService({ previewFetcher: mockFetcher });
    const reply = await service.handlePreviewRequest({
      xdr: buildXdr([payment()]),
      networkPassphrase: TESTNET,
    });

    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(reply.blocked).toBe(false);
    expect(reply.pending).toBeDefined();
    expect(reply.reply.text).toContain("Remote preview text");
  });
});
