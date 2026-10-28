import { SafeXdrDecoder } from "../../utils/xdr/safeDecoder";
import { Networks, Transaction, Operation } from "@stellar/stellar-sdk";

export interface PreviewResult {
  safe: boolean;
  message: string;
}

// Matches any non-ASCII character (used to catch homoglyph spoofs)
const HOMOGLYPH_REGEX = /[^ -~]/;

export function renderTransactionPreview(
  xdrString: string, 
  networkPassphrase = Networks.TESTNET
): PreviewResult {
  const result = SafeXdrDecoder.tryDecodeTransaction(xdrString, { networkPassphrase });
  
  if (!result.success || !result.transaction) {
    return { safe: false, message: "🚨 SECURITY ALERT: Invalid or malformed transaction XDR." };
  }

  const tx = result.transaction as Transaction;
  const untrustedStrings: string[] = [];
  
  let output = `🔍 **Transaction Preview**
Source: \`${tx.source}\`
Fee: ${tx.fee} stroops
`;
  
  if (tx.memo && tx.memo.type !== "none") {
    const memoStr = tx.memo.value ? tx.memo.value.toString() : "";
    untrustedStrings.push(memoStr);
    output += `Memo: ${memoStr}
`;
  }
  output += `
`;

  for (let i = 0; i < tx.operations.length; i++) {
    const op = tx.operations[i];
    output += `**Operation ${i + 1}:** ${op.type.toUpperCase()}
`;

    if (op.type === "payment") {
      const payment = op as Operation.Payment;
      const assetCode = payment.asset.isNative() ? "XLM" : payment.asset.getCode();
      const issuer = payment.asset.isNative() ? "native" : payment.asset.getIssuer();
      
      untrustedStrings.push(assetCode, issuer, payment.destination);
      output += `  - To: \`${payment.destination}\`
  - Amount: ${payment.amount} ${assetCode}
`;
      if (issuer !== "native") output += `  - Issuer: \`${issuer}\`
`;
      
    } else if (op.type === "changeTrust") {
      const trust = op as Operation.ChangeTrust;
      const assetCode = trust.line.isNative() ? "XLM" : trust.line.getCode();
      
      untrustedStrings.push(assetCode);
      output += `  - Asset: ${assetCode}
`;
      
    } else {
      return { 
        safe: false, 
        message: `🚨 SECURITY ALERT: Unrecognized or dangerous operation type (${op.type}). Execution blocked.` 
      };
    }
  }

  // Evaluate all extracted user-provided strings for homoglyphs
  if (untrustedStrings.some(str => HOMOGLYPH_REGEX.test(str))) {
    return { 
      safe: false, 
      message: "🚨 SECURITY ALERT: Fake asset name detected. This is a scam attempt to trick you. Do not approve." 
    };
  }

  return { safe: true, message: output };
}
