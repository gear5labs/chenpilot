// Mock the TypeORM DataSource so the global setup.ts does not attempt a real DB connection.
jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
}));

import * as StellarSdk from "@stellar/stellar-sdk";
import { getContractLogs } from "../../src/services/sorobanService";

const mockGetTransaction = jest.fn();

type StellarSdkWithRpc = typeof StellarSdk & {
  SorobanRpc: { Server: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  (StellarSdk as StellarSdkWithRpc).SorobanRpc.Server.mockImplementation(
    () => ({
      getTransaction: mockGetTransaction,
    })
  );
});

describe("getContractLogs", () => {
  it("throws when txHash is missing", async () => {
    await expect(
      getContractLogs({ txHash: "", network: "testnet" })
    ).rejects.toThrow("Missing or invalid txHash");
  });

  it("throws when transaction is NOT_FOUND", async () => {
    mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    await expect(
      getContractLogs({ txHash: "abc123", network: "testnet" })
    ).rejects.toThrow("Transaction not found: abc123");
  });

  it("throws when transaction FAILED", async () => {
    mockGetTransaction.mockResolvedValue({ status: "FAILED" });

    await expect(
      getContractLogs({ txHash: "abc123", network: "testnet" })
    ).rejects.toThrow("Transaction failed: abc123");
  });

  it("returns empty array when no events present", async () => {
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });

    const logs = await getContractLogs({
      txHash: "abc123",
      network: "testnet",
    });
    expect(logs).toEqual([]);
  });

  it("returns formatted log entries for each event", async () => {
    mockGetTransaction.mockResolvedValue({
      status: "SUCCESS",
      events: [
        {
          type: "contract",
          contractId: "CABC1234567890",
          topic: ["topic_val"],
          value: "data_val",
        },
      ],
    });

    const logs = await getContractLogs({
      txHash: "abc123",
      network: "testnet",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      index: 0,
      contractId: "CABC1234567890",
      type: "contract",
      topics: ["topic_val"],
      data: "data_val",
    });
  });

  it("defaults type to 'contract' when event type is missing", async () => {
    mockGetTransaction.mockResolvedValue({
      status: "SUCCESS",
      events: [{ contractId: "CABC1234567890" }],
    });

    const logs = await getContractLogs({
      txHash: "abc123",
      network: "testnet",
    });

    expect(logs[0].type).toBe("contract");
    expect(logs[0].contractId).toBe("CABC1234567890");
    expect(logs[0].topics).toEqual([]);
    expect(logs[0].data).toBeNull();
  });

  it("uses provided rpcUrl over default", async () => {
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });

    await getContractLogs({
      txHash: "abc123",
      network: "testnet",
      rpcUrl: "https://custom-rpc.example",
    });

    expect(
      (StellarSdk as StellarSdkWithRpc).SorobanRpc.Server
    ).toHaveBeenCalledWith("https://custom-rpc.example", expect.any(Object));
  });
});
