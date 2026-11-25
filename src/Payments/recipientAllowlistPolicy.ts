/**
 * Pre-execution policy hook for saved recipient allowlists (#1075).
 *
 * Validates that a payment's recipient is present in the user's saved allowlist
 * (contacts or allowed recipient policies) immediately before submission.
 */
import type { PaymentExecution } from "./paymentTypes";

export interface RecipientAllowlistProvider {
  isAllowed(userId: string, recipient: string): Promise<boolean> | boolean;
}

export class RecipientAllowlistPolicyError extends Error {
  constructor(
    message: string,
    public readonly recipient: string,
    public readonly reason: "recipient_not_allowlisted" = "recipient_not_allowlisted"
  )
  {
    super(message);
    this.name = "RecipientAllowlistPolicyError";
  }
}

export class RecipientAllowlistPolicy {
  constructor(private readonly provider: RecipientAllowlistProvider) {}

  async enforce(userId: string, payment: PaymentExecution): Promise<void> {
    const recipient = payment.requirement?.recipient;
    if (!recipient) {
      throw new RecipientAllowlistPolicyError(
        "Payment requirement is missing a recipient address",
        "",
        "recipient_not_allowlisted"
      );
    }
    const allowed = await this.provider.isAllowed(userId, recipient);
    if (!allowed) {
      throw new RecipientAllowlistPolicyError(
        `Recipient '${recipient}' is not on the allowlist for user '${userId}'`,
        recipient,
        "recipient_not_allowlisted"
      );
    }
  }
}
