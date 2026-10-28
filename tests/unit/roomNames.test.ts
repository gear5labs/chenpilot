import { describe, it, expect } from "@jest/globals";
import {
  buildRoomName,
  validateRoomId,
  MAX_ROOM_ID_LENGTH,
  BOT_ALL_ROOM,
} from "../../src/Gateway/roomNames";

describe("validateRoomId", () => {
  it("accepts a normal identifier", () => {
    expect(validateRoomId("tx-abc_123")).toBe("tx-abc_123");
    expect(validateRoomId("0")).toBe("0");
    expect(validateRoomId("a.b-c_d")).toBe("a.b-c_d");
  });

  it("rejects empty identifiers", () => {
    expect(() => validateRoomId("")).toThrow(/must not be empty/);
  });

  it("rejects non-string identifiers", () => {
    expect(() => validateRoomId(undefined)).toThrow(/must be a string/);
    expect(() => validateRoomId(null)).toThrow(/must be a string/);
    expect(() => validateRoomId(42)).toThrow(/must be a string/);
  });

  it("rejects oversized identifiers", () => {
    const oversized = "a".repeat(MAX_ROOM_ID_LENGTH + 1);
    expect(() => validateRoomId(oversized)).toThrow(/at most/);
    expect(validateRoomId("a".repeat(MAX_ROOM_ID_LENGTH))).toHaveLength(
      MAX_ROOM_ID_LENGTH
    );
  });

  it("rejects delimiter-containing identifiers", () => {
    expect(() => validateRoomId("tx:1")).toThrow(/must not contain/);
    expect(() => validateRoomId("user:1")).toThrow(/must not contain/);
  });

  it("rejects malformed identifiers", () => {
    expect(() => validateRoomId("-leading")).toThrow(/unsupported characters/);
    expect(() => validateRoomId("has space")).toThrow(/unsupported characters/);
    expect(() => validateRoomId("has/slash")).toThrow(/unsupported characters/);
    expect(() => validateRoomId("has\nnewline")).toThrow(
      /unsupported characters/
    );
    expect(() => validateRoomId("unicode-\u00e9")).toThrow(
      /unsupported characters/
    );
  });
});

describe("buildRoomName", () => {
  it("builds canonical room names", () => {
    expect(buildRoomName("transaction", "abc")).toBe("transaction:abc");
    expect(buildRoomName("bot", "bot-1")).toBe("bot:bot-1");
    expect(buildRoomName("user", "u1")).toBe("user:u1");
    expect(buildRoomName("execution", "e1")).toBe("execution:e1");
    expect(buildRoomName("bot", "all")).toBe(BOT_ALL_ROOM);
  });

  it("rejects invalid identifiers before building a name", () => {
    expect(() => buildRoomName("transaction", "")).toThrow(/must not be empty/);
    expect(() => buildRoomName("transaction", "a:b")).toThrow(
      /must not contain/
    );
    expect(() =>
      buildRoomName("transaction", "a".repeat(MAX_ROOM_ID_LENGTH + 1))
    ).toThrow(/at most/);
    expect(() => buildRoomName("transaction", "bad id")).toThrow(
      /unsupported characters/
    );
  });
});
