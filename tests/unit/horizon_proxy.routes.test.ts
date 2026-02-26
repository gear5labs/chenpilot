import express from "express";
import request from "supertest";

const mockVerifyAccessToken = jest.fn();
const mockProxyGet = jest.fn();

jest.mock("tsyringe", () => ({
  container: {
    resolve: () => ({
      verifyAccessToken: mockVerifyAccessToken,
    }),
  },
}));

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
  },
}));

class MockHorizonProxyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HorizonProxyError";
    this.statusCode = statusCode;
  }
}

jest.mock("../../src/Gateway/horizonProxy.service", () => ({
  horizonProxyService: {
    proxyGet: mockProxyGet,
  },
  HorizonProxyError: MockHorizonProxyError,
}));

import horizonProxyRoutes from "../../src/Gateway/horizonProxy.routes";

describe("Horizon Proxy Routes", () => {
  const app = express();
  app.use("/horizon", horizonProxyRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAccessToken.mockReturnValue({
      userId: "user-1",
      name: "tester",
      role: "user",
    });
  });

  it("returns 401 when access token is missing", async () => {
    const response = await request(app)
      .get("/horizon/proxy")
      .query({ path: "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF" });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("returns proxied data for authenticated requests", async () => {
    mockProxyGet.mockResolvedValue({ records: [] });

    const response = await request(app)
      .get("/horizon/proxy")
      .set("Authorization", "Bearer valid-token")
      .query({
        path: "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF",
        limit: "20",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ records: [] });
    expect(mockProxyGet).toHaveBeenCalledWith(
      "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF",
      { limit: "20" }
    );
  });

  it("maps HorizonProxyError status codes", async () => {
    mockProxyGet.mockRejectedValue(
      new MockHorizonProxyError("Requested Horizon path is not allowlisted", 403)
    );

    const response = await request(app)
      .get("/horizon/proxy")
      .set("Authorization", "Bearer valid-token")
      .query({ path: "/friendbot" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe("Requested Horizon path is not allowlisted");
  });
});
