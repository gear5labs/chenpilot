jest.mock("../../src/services/sorobanService", () => ({
  invokeContract: jest.fn(),
}));

import { sorobanTool } from "../../src/Agents/tools/soroban";
import { invokeContract } from "../../src/services/sorobanService";

const mockInvoke = invokeContract as jest.Mock;

describe("SorobanTool wiring", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("calls invokeContract with expected params", async () => {
    mockInvoke.mockResolvedValue({
      network: "testnet",
      contractId: "CABC1234567890",
      method: "ping",
      result: "ok",
    });

    const result = await sorobanTool.execute(
      {
        contractId: "CABC1234567890",
        method: "ping",
        network: "testnet",
        args: [1],
      },
      "user-1"
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "testnet",
        contractId: "CABC1234567890",
        method: "ping",
        args: [1],
      })
    );
    expect(result.status).toBe("success");
  });

  it("defaults network to testnet", async () => {
    mockInvoke.mockResolvedValue({
      network: "testnet",
      contractId: "CABC1234567890",
      method: "ping",
      result: "ok",
    });

    await sorobanTool.execute(
      {
        contractId: "CABC1234567890",
        method: "ping",
      },
      "user-1"
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "testnet",
      })
    );
  });

  it("returns error result when service throws", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));

    const result = await sorobanTool.execute(
      {
        contractId: "CABC1234567890",
        method: "ping",
        network: "testnet",
      },
      "user-1"
    );

    expect(result.status).toBe("error");
  });
});
