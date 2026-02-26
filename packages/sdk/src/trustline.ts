// @ts-ignore: dependency is provided at the workspace root
import { Server } from "stellar-sdk";

export interface TrustlineCheckResult {
  exists: boolean;
  authorized: boolean;
  details?: Record<string, unknown>;
}

/**
 * Checks whether an account has a valid, non-frozen trustline for an asset.
 * - For native XLM the function returns exists=true, authorized=true.
 * - For other assets it fetches the account from Horizon and inspects balances.
 *
 * @param horizonUrl Horizon server URL (defaults to public Horizon)
 * @param accountId Stellar account id to check
 * @param assetCode Asset code (string; "XLM" for native)
 * @param assetIssuer Asset issuer public key (optional for native/XLM)
 */
export async function hasValidStellarTrustline(
  horizonUrl: string | undefined,
  accountId: string,
  assetCode: string,
  assetIssuer?: string
): Promise<TrustlineCheckResult> {
  const server = new Server(horizonUrl || "https://horizon.stellar.org");

  // Native XLM does not require a trustline
  if (!assetCode || assetCode.toUpperCase() === "XLM") {
    return { exists: true, authorized: true };
  }

  let account: any;
  try {
    account = await server.accounts().accountId(accountId).call();
  } catch (err) {
    return {
      exists: false,
      authorized: false,
      details: { error: String(err) },
    };
  }

  const balances: any[] = account.balances || [];
  const match = balances.find((b) => {
    return (
      b.asset_code === assetCode &&
      (assetIssuer ? b.asset_issuer === assetIssuer : true)
    );
  });

  if (!match) {
    return { exists: false, authorized: false };
  }

  // Horizon may include authorization properties on the trustline/balance object
  const authorized =
    // common property name
    (match.is_authorized as boolean) ??
    (match.authorized as boolean) ??
    // if issuer uses 'authorized_to_maintain_liabilities' treat as authorized
    (match.authorized_to_maintain_liabilities as boolean) ?? true;

  return { exists: true, authorized, details: { balance: match } };
}

export default hasValidStellarTrustline;
