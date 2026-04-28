import { ammExplorerTool } from "../../src/Agents/tools/ammExplorer";
import { horizonProxyService } from "../../src/Gateway/horizonProxy.service";

// Mock horizonProxyService
jest.mock("../../src/Gateway/horizonProxy.service", () => ({
  horizonProxyService: {
    proxyGet: jest.fn(),
  },
}));

describe("AmmExplorerTool", () => {
  beforeEach(() => {
    (horizonProxyService.proxyGet as jest.Mock).mockReset();
  });

  it("search_pools: should return success result with pools", async () => {
    const mockPools = {
      _embedded: {
        records: [
          {
            id: "pool1",
            reserves: [
              { asset: "native", amount: "100.0000000" },
              { asset: "USDC:GABC", amount: "10.0000000" }
            ],
            total_shares: "50",
            total_trustlines: "10",
            fee_bp: 30
          }
        ]
      }
    };

    (horizonProxyService.proxyGet as jest.Mock).mockResolvedValue(mockPools);

    const result = await ammExplorerTool.execute({
      operation: "search_pools",
      assetA: "XLM",
      assetB: "USDC:GABC"
    }, "user123");

    expect(result.status).toBe("success");
    expect(result.data.pools).toHaveLength(1);
    expect(result.data.pools[0].poolId).toBe("pool1");
    expect(result.data.pools[0].assetA).toBe("native");
    expect(horizonProxyService.proxyGet).toHaveBeenCalledWith("/liquidity_pools", expect.any(Object));
  });

  it("get_stats: should return pool details", async () => {
    const mockPool = {
      id: "0".repeat(64),
      reserves: [
        { asset: "native", amount: "100.0000000" },
        { asset: "USDC:GABC", amount: "10.0000000" }
      ],
      total_shares: "50",
      total_trustlines: "10",
      fee_bp: 30
    };
    const poolId = "0".repeat(64);

    (horizonProxyService.proxyGet as jest.Mock).mockResolvedValue(mockPool);

    const result = await ammExplorerTool.execute({
      operation: "get_stats",
      poolId: poolId
    }, "user123");

    expect(result.status).toBe("success");
    expect(result.data.poolId).toBe(mockPool.id);
    expect(result.data.reserveA).toBe(100);
    expect(result.data.fee).toBe("0.30%");
    expect(horizonProxyService.proxyGet).toHaveBeenCalledWith(`/liquidity_pools/${poolId}`, {});
  });

  it("should return error if operation is missing", async () => {
    const result = await ammExplorerTool.execute({} as any, "user123");
    expect(result.status).toBe("error");
  });
});
