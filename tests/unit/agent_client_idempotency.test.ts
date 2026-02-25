import {
  AgentClient,
  AgentRequestError,
  createBtcToStellarSwapIdempotencyKey,
  generateIdempotencyKey,
} from "../../packages/sdk/src/agentClient";
import { ChainId, CrossChainSwapRequest } from "../../packages/sdk/src/types";

describe("AgentClient idempotency", () => {
  const swapRequest: CrossChainSwapRequest = {
    fromChain: ChainId.BITCOIN,
    toChain: ChainId.STELLAR,
    fromToken: "BTC",
    toToken: "XLM",
    amount: "0.01",
    destinationAddress: "GDSTELLARDESTINATION",
  };

  it("generates deterministic fingerprint regardless of payload key order", () => {
    const keyA = generateIdempotencyKey({
      namespace: "swap-btc-stellar",
      payload: {
        a: 1,
        b: { z: 2, y: [3, 4] },
      },
      clientRequestId: "req-123",
    });

    const keyB = generateIdempotencyKey({
      namespace: "swap-btc-stellar",
      payload: {
        b: { y: [3, 4], z: 2 },
        a: 1,
      },
      clientRequestId: "req-123",
    });

    expect(keyA).toBe(keyB);
  });

  it("reuses the same idempotency key across timeout/network retries", async () => {
    const capturedHeaders: Array<Record<string, string> | undefined> = [];
    const stableKey = createBtcToStellarSwapIdempotencyKey(
      swapRequest,
      "client-retry-id"
    );

    let calls = 0;
    const client = new AgentClient({
      baseUrl: "http://localhost:3000",
      defaultRetryDelayMs: 0,
      fetchFn: async (_url, init) => {
        capturedHeaders.push(init?.headers);
        calls += 1;

        if (calls === 1) {
          throw new TypeError("network error");
        }

        if (calls === 2) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ result: {} }),
            text: async () => "temporary unavailable",
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { success: true, message: "ok" } }),
          text: async () => "",
        };
      },
    });

    const result = await client.executeBtcToStellarSwap(swapRequest, {
      userId: "user-1",
      idempotencyKey: stableKey,
      maxRetries: 3,
    });

    expect(result.idempotencyKey).toBe(stableKey);
    expect(result.attempts).toBe(3);
    expect(capturedHeaders).toHaveLength(3);

    for (const headers of capturedHeaders) {
      expect(headers?.["Idempotency-Key"]).toBe(stableKey);
    }
  });

  it("surfaces idempotency key when retries are exhausted", async () => {
    const providedKey = "swap-btc-stellar:fingerprint:req-999";

    const client = new AgentClient({
      baseUrl: "http://localhost:3000",
      defaultRetryDelayMs: 0,
      fetchFn: async () => {
        throw new TypeError("network disconnected");
      },
    });

    await expect(
      client.executeBtcToStellarSwap(swapRequest, {
        userId: "user-1",
        idempotencyKey: providedKey,
        maxRetries: 2,
      })
    ).rejects.toMatchObject<Partial<AgentRequestError>>({
      name: "AgentRequestError",
      idempotencyKey: providedKey,
      attempts: 2,
    });
  });
});
