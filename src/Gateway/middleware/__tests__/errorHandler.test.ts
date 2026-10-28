import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Request, Response } from "express";
import { ApiError } from "../../../contracts/errorContract";
import { ErrorHandler } from "../errorHandler";

jest.mock("../../../config/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

function createRes() {
  const res: Partial<Response> = {};
  const captured: { status?: number; body?: unknown } = {};
  res.status = jest.fn((code: number) => {
    captured.status = code;
    return res;
  }) as unknown as Response["status"];
  res.json = jest.fn((body: unknown) => {
    captured.body = body;
    return res;
  }) as unknown as Response["json"];
  return { res: res as Response, captured };
}

function createReq(requestId?: string): Request {
  return {
    requestId,
    method: "GET",
    originalUrl: "/api/thing",
    path: "/api/thing",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

describe("ErrorHandler request correlation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes the request id on ApiError responses", async () => {
    const { res, captured } = createRes();
    await ErrorHandler(
      ApiError.notFound("User not found"),
      createReq("req-abc"),
      res,
      jest.fn()
    );

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({
      success: false,
      status: 404,
      requestId: "req-abc",
      error: { message: "User not found", code: "NOT_FOUND" },
    });
  });

  it("includes the request id on unhandled errors", async () => {
    const { res, captured } = createRes();
    await ErrorHandler(
      new Error("boom"),
      createReq("req-xyz"),
      res,
      jest.fn()
    );

    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({
      success: false,
      status: 500,
      requestId: "req-xyz",
    });
  });

  it("includes the request id on oversized payloads", async () => {
    const { res, captured } = createRes();
    const err = Object.assign(new Error("too large"), {
      type: "entity.too.large",
    });
    await ErrorHandler(err, createReq("req-size"), res, jest.fn());

    expect(captured.status).toBe(413);
    expect(captured.body).toMatchObject({
      success: false,
      status: 413,
      requestId: "req-size",
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("leaves requestId undefined when the transport supplied none", async () => {
    const { res, captured } = createRes();
    await ErrorHandler(
      ApiError.badRequest("nope"),
      createReq(undefined),
      res,
      jest.fn()
    );

    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({ success: false, status: 400 });
    expect(
      (captured.body as { requestId?: string }).requestId
    ).toBeUndefined();
  });
});
