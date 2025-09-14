export class SwapTool {
  async execute(
    payload: { from: string; to: string; amount: number },
    userId: string
  ) {
    // mock swap logic
    console.log(
      `User ${userId} swapping ${payload.amount} ${payload.from} → ${payload.to}`
    );

    return {
      action: "swap",
      status: "success",
      details: {
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        txHash: "0xMOCKSWAP123",
      },
    };
  }
}

export const swapTool = new SwapTool();
