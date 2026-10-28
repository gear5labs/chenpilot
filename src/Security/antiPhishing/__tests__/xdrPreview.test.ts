import { renderTransactionPreview } from "../xdrPreview";
import { Asset, Operation, TransactionBuilder, Account, Networks, Keypair, Memo } from "@stellar/stellar-sdk";

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return { __esModule: true, ...actual };
});

describe("Anti-Phishing XDR Preview", () => {
  const sourceKey = Keypair.random().publicKey();
  const destKey = Keypair.random().publicKey();
  const account = new Account(sourceKey, "1");

  it("blocks homoglyph attacks in memos and payloads", () => {
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({
        destination: destKey,
        asset: Asset.native(),
        amount: "10.0"
      }))
      .addMemo(Memo.text("USDС")) // Cyrillic C injected into Memo
      .setTimeout(100)
      .build();

    const result = renderTransactionPreview(tx.toEnvelope().toXDR("base64"));
    expect(result.safe).toBe(false);
    expect(result.message).toContain("Fake asset name");
  });

  it("fails closed on unsupported or dangerous operations", () => {
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({
        name: "attack",
        value: "malicious"
      }))
      .setTimeout(100)
      .build();

    const result = renderTransactionPreview(tx.toEnvelope().toXDR("base64"));
    expect(result.safe).toBe(false);
    expect(result.message).toContain("Unrecognized or dangerous");
  });

  it("renders safe transactions correctly", () => {
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({
        destination: destKey,
        asset: Asset.native(),
        amount: "50.0"
      }))
      .setTimeout(100)
      .build();

    const result = renderTransactionPreview(tx.toEnvelope().toXDR("base64"));
    expect(result.safe).toBe(true);
    expect(result.message).toContain("50.0000000 XLM"); 
  });

  it("renders full 56-character destination addresses to prevent truncation attacks", () => {
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({
        destination: destKey,
        asset: Asset.native(),
        amount: "50.0"
      }))
      .setTimeout(100)
      .build();

    const result = renderTransactionPreview(tx.toEnvelope().toXDR("base64"));
    expect(result.safe).toBe(true);
    // Mathematically assert that the full 56-character address is rendered, not a sliced version
    expect(result.message).toContain(destKey);
    expect(result.message).not.toMatch(/[A-Z0-9]{4}\.\.\.[A-Z0-9]{4}/);
  });
});
