import { RecipientAllowlistPolicy, RecipientAllowlistPolicyError, RecipientAllowlistProvider } from "./recipientAllowlistPolicy";
import type { PaymentExecution } from "./paymentTypes";

describe("RecipientAllowlistPolicy", () => {
  const mockProvider: RecipientAllowlistProvider = {
    isAllowed(userId: string, recipient: string) {
      return recipient === "0xAllowed";
    },
  };

  const policy = new RecipientAllowlistPolicy(mockProvider);

  it("passes when the recipient is allowlisted", async () => {
    const payment: PaymentExecution = {
      requirement: { recipient: "0xAllowed" },
    } as any;

    await expect(policy.enforce("user-1", payment)).resolves.toBeUndefined();
  });

  it("fails when the recipient is not allowlisted", async () => {
    const payment: PaymentExecution = {
      requirement: { recipient: "0xBlocked" },
    } as any;

    await expect(policy.enforce("user-1", payment)).rejects.toThrow(RecipientAllowlistPolicyError);
  });

  it("fails when recipient is missing from payment requirements", async () => {
    const payment: PaymentExecution = {
      requirement: {},
    } as any;

    await expect(policy.enforce("user-1", payment)).rejects.toThrow(RecipientAllowlistPolicyError);
  });
});
