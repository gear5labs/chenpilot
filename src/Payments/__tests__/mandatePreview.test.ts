import { RecurringPaymentMandateService } from "../recurringMandate.service";
import { PaymentExecutor } from "../paymentTypes";

describe("RecurringPaymentMandateService previewMandateUpdate", () => {
  const dummyExecutor: PaymentExecutor = {
    executePayment: async () => ({ status: "success", transactionHash: "0x123" }),
  };

  const baseMandate = {
    id: "mandate-1",
    requirement: {
      recipient: "0xRecipient",
      amount: "100",
      asset: { symbol: "ETH", decimals: 18 },
      network: "ethereum",
    },
    intervalMs: 86400000,
    nextRunAt: new Date("2025-01-01T00:00:00.000Z"),
    cumulativeLimit: "1000",
    approvalRequired: true,
    approved: false,
    missedRunBehavior: "skip" as const,
  };

  it("previews projected amount and timing changes successfully", () => {
    const service = new RecurringPaymentMandateService(dummyExecutor);
    service.createMandate(baseMandate);

    const preview = service.previewMandateUpdate("mandate-1", {
      requirement: {
        recipient: "0xRecipient",
        amount: "250",
        asset: { symbol: "ETH", decimals: 18 },
        network: "ethereum",
      },
      nextRunAt: new Date("2025-01-05T00:00:00.000Z"),
    });

    expect(preview.amount).toBe("250");
    expect(preview.nextRunAt).toBe("2025-01-05T00:00:00.000Z");
    expect(preview.summaryHash).toBeDefined();
  });

  it("fails with failure conditions when mandate does not exist", () => {
    const service = new RecurringPaymentMandateService(dummyExecutor);

    expect(() => {
      service.previewMandateUpdate("non-existent", { cumulativeLimit: "500" });
    }).toThrow("Unknown mandate: non-existent");
  });

  it("handles boundary conditions with missing or incomplete requirement fields in preview", () => {
    const service = new RecurringPaymentMandateService(dummyExecutor);
    service.createMandate(baseMandate);

    const preview = service.previewMandateUpdate("mandate-1", {
      requirement: {
        recipient: "",
        amount: "",
        asset: { symbol: "", decimals: 0 },
        network: "",
      },
    });

    expect(preview.missingFields.length).toBeGreaterThan(0);
  });
});
