import { SorobanBatchBuilder } from "../soroban";

describe("SorobanBatchBuilder", () => {
  describe("addTransaction", () => {
    it("should add a single transaction to the batch", () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransaction("abc123");

      expect(builder.size()).toBe(1);
    });

    it("should chain multiple addTransaction calls", () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder
        .addTransaction("hash1")
        .addTransaction("hash2")
        .addTransaction("hash3");

      expect(builder.size()).toBe(3);
    });

    it("should throw on invalid transaction hash", () => {
      const builder = new SorobanBatchBuilder("testnet");

      expect(() => builder.addTransaction("")).toThrow(
        "Invalid transaction hash"
      );
      expect(() => builder.addTransaction(null as unknown as string)).toThrow(
        "Invalid transaction hash"
      );
    });
  });

  describe("addTransactions", () => {
    it("should add multiple transactions at once", () => {
      const builder = new SorobanBatchBuilder("testnet");
      const hashes = ["hash1", "hash2", "hash3", "hash4"];

      builder.addTransactions(hashes);

      expect(builder.size()).toBe(4);
    });

    it("should work with empty array", () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions([]);

      expect(builder.size()).toBe(0);
    });

    it("should throw if any hash in array is invalid", () => {
      const builder = new SorobanBatchBuilder("testnet");

      expect(() => builder.addTransactions(["hash1", "", "hash3"])).toThrow();
    });
  });

  describe("size", () => {
    it("should return zero for empty batch", () => {
      const builder = new SorobanBatchBuilder("testnet");
      expect(builder.size()).toBe(0);
    });

    it("should return correct count", () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransaction("hash1");
      expect(builder.size()).toBe(1);

      builder.addTransaction("hash2");
      expect(builder.size()).toBe(2);
    });
  });

  describe("clear", () => {
    it("should clear all transactions", () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["hash1", "hash2", "hash3"]);
      expect(builder.size()).toBe(3);

      builder.clear();
      expect(builder.size()).toBe(0);
    });
  });

  describe("execute", () => {
    it("should return empty array for empty batch", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      const results = await builder.execute(async () => {
        throw new Error("Fetch should not be called");
      });

      expect(results).toEqual([]);
    });

    it("should execute batch request with single transaction", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransaction("tx123");

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: {
              status: "SUCCESS",
              ledger: 12345,
              createdAt: 1234567890,
              returnValue: "success",
              events: [],
            },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(1);
      expect(results[0].txHash).toBe("tx123");
      expect(results[0].status).toBe("SUCCESS");
      expect(results[0].ledger).toBe(12345);
    });

    it("should execute batch request with multiple transactions", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["tx1", "tx2", "tx3"]);

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: {
              status: "SUCCESS",
              ledger: 100,
              createdAt: 1000,
            },
          },
          {
            id: 2,
            result: {
              status: "FAILED",
              ledger: 101,
              createdAt: 1001,
            },
          },
          {
            id: 3,
            result: {
              status: "NOT_FOUND",
            },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe("SUCCESS");
      expect(results[1].status).toBe("FAILED");
      expect(results[2].status).toBe("NOT_FOUND");
    });

    it("should handle RPC errors in batch response", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["tx1", "tx2"]);

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: {
              status: "SUCCESS",
            },
          },
          {
            id: 2,
            error: {
              code: -32600,
              message: "Invalid request",
            },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("SUCCESS");
      expect(results[1].status).toBe("NOT_FOUND");
      expect(results[1].errorMessage).toContain("Invalid request");
    });

    it("should handle HTTP errors gracefully", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["tx1", "tx2"]);

      const mockFetch = async () => {
        throw new Error("Network error");
      };

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result.status).toBe("NOT_FOUND");
        expect(result.errorMessage).toContain("Batch request failed");
      });
    });

    it("should maintain order of results", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      const hashes = ["hash_a", "hash_b", "hash_c"];
      builder.addTransactions(hashes);

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          { id: 1, result: { status: "SUCCESS" } },
          { id: 2, result: { status: "FAILED" } },
          { id: 3, result: { status: "NOT_FOUND" } },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results.map((r) => r.txHash)).toEqual(hashes);
    });

    it("should format events correctly from batch response", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransaction("tx_with_events");

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: {
              status: "SUCCESS",
              events: [
                {
                  type: "contract",
                  contractId:
                    "CCJZ4IQSV5KFXV7W2O7ZMVXJ65I2LTGV7MNXNVXJ65I2LTGV7MNVXJ",
                  topic: ["topic1", "topic2"],
                  value: "eventData",
                },
              ],
            },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results[0].events).toHaveLength(1);
      expect(results[0].events[0].type).toBe("contract");
      expect(results[0].events[0].topics).toEqual(["topic1", "topic2"]);
      expect(results[0].events[0].data).toBe("eventData");
    });

    it("should use custom RPC URL when provided", async () => {
      let capturedUrl = "";

      const mockFetch = async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => [
            {
              id: 1,
              result: { status: "SUCCESS" },
            },
          ],
        };
      };

      const customUrl = "https://custom-soroban-rpc.example.com";
      const builder = new SorobanBatchBuilder("testnet", customUrl);
      builder.addTransaction("tx1");

      await builder.execute(mockFetch as unknown as typeof fetch);

      expect(capturedUrl).toBe(customUrl);
    });

    it("should use default RPC URL for network when not specified", async () => {
      let capturedUrl = "";

      const mockFetch = async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => [
            {
              id: 1,
              result: { status: "SUCCESS" },
            },
          ],
        };
      };

      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransaction("tx1");

      await builder.execute(mockFetch as unknown as typeof fetch);

      expect(capturedUrl).toContain("soroban-testnet.stellar.org");
    });

    it("should handle mainnet URL correctly", async () => {
      let capturedUrl = "";

      const mockFetch = async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => [
            {
              id: 1,
              result: { status: "SUCCESS" },
            },
          ],
        };
      };

      const builder = new SorobanBatchBuilder("mainnet");
      builder.addTransaction("tx1");

      await builder.execute(mockFetch as unknown as typeof fetch);

      expect(capturedUrl).toContain("soroban-mainnet.stellar.org");
    });

    it("should handle multiple transactions with mixed statuses", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["success_tx", "failed_tx", "notfound_tx"]);

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: {
              status: "SUCCESS",
              ledger: 1000,
              createdAt: 1000000,
              returnValue: "0xabc123",
            },
          },
          {
            id: 2,
            result: {
              status: "FAILED",
              ledger: 1001,
              createdAt: 1000001,
            },
          },
          {
            id: 3,
            result: {
              status: "NOT_FOUND",
            },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe("SUCCESS");
      expect(results[0].returnValue).toBe("0xabc123");
      expect(results[1].status).toBe("FAILED");
      expect(results[2].status).toBe("NOT_FOUND");
    });

    it("should handle responses with out-of-order IDs", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["tx1", "tx2", "tx3"]);

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          { id: 3, result: { status: "NOT_FOUND" } },
          { id: 1, result: { status: "SUCCESS" } },
          { id: 2, result: { status: "FAILED" } },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      // Results should be sorted by ID internally
      expect(results[0].txHash).toBe("tx1");
      expect(results[1].txHash).toBe("tx2");
      expect(results[2].txHash).toBe("tx3");
      expect(results[0].status).toBe("SUCCESS");
      expect(results[1].status).toBe("FAILED");
      expect(results[2].status).toBe("NOT_FOUND");
    });

    it("should reuse builder after clear", async () => {
      const builder = new SorobanBatchBuilder("testnet");
      builder.addTransactions(["tx1", "tx2"]);
      builder.clear();
      builder.addTransaction("tx3");

      const mockFetch = async () => ({
        ok: true,
        json: async () => [
          {
            id: 1,
            result: { status: "SUCCESS" },
          },
        ],
      });

      const results = await builder.execute(
        mockFetch as unknown as typeof fetch
      );

      expect(results).toHaveLength(1);
      expect(results[0].txHash).toBe("tx3");
    });
  });
});
