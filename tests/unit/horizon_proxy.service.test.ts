declare const global: Record<string, unknown>;

import {
  HorizonProxyError,
  HorizonProxyService,
} from "../../src/Gateway/horizonProxy.service";

describe("HorizonProxyService", () => {
  let service: HorizonProxyService;
  let originalFetch: unknown;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    service = new HorizonProxyService();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("rejects paths outside allowlist", async () => {
    await expect(
      service.proxyGet("/friendbot", {})
    ).rejects.toMatchObject<HorizonProxyError>({
      statusCode: 403,
      message: "Requested Horizon path is not allowlisted",
    });
  });

  it("rejects forbidden query keys", async () => {
    await expect(
      service.proxyGet("/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF", {
        api_key: "secret",
      })
    ).rejects.toMatchObject<HorizonProxyError>({
      statusCode: 400,
      message: "Forbidden query key: api_key",
    });
  });

  it("proxies successful JSON GET requests", async () => {
    const mockJson = { records: [{ id: "op-1" }] };

    global.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: () => "application/json",
      },
      json: async () => mockJson,
      text: async () => JSON.stringify(mockJson),
    });

    const result = await service.proxyGet(
      "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF/operations",
      {
        limit: "10",
        order: "desc",
      }
    );

    expect(result).toEqual(mockJson);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = global.fetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF/operations"
    );
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("order=desc");
  });
});
