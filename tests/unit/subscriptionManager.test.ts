import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  resolveSubscriptionLimits,
  SubscriptionManager,
  subscribeToRoom,
  unsubscribeFromRoom,
  subscribeToTransaction,
  subscribeToBot,
  unsubscribeFromTransaction,
  unsubscribeFromBot,
  DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET,
  DEFAULT_MAX_SUBSCRIPTIONS_PER_USER,
  RoomAwareSocket,
} from "../../src/Gateway/subscriptionManager";
import { BOT_ALL_ROOM, MAX_ROOM_ID_LENGTH } from "../../src/Gateway/roomNames";

function createFakeSocket(id: string): RoomAwareSocket & {
  rooms: Set<string>;
} {
  const rooms = new Set<string>();
  return {
    id,
    rooms,
    join(room: string) {
      rooms.add(room);
    },
    leave(room: string) {
      rooms.delete(room);
    },
  };
}

describe("resolveSubscriptionLimits", () => {
  it("falls back to defaults when unset or invalid", () => {
    expect(resolveSubscriptionLimits({})).toEqual({
      maxPerSocket: DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET,
      maxPerUser: DEFAULT_MAX_SUBSCRIPTIONS_PER_USER,
    });
    expect(
      resolveSubscriptionLimits({
        REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET: "0",
        REALTIME_MAX_SUBSCRIPTIONS_PER_USER: "nope",
      })
    ).toEqual({
      maxPerSocket: DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET,
      maxPerUser: DEFAULT_MAX_SUBSCRIPTIONS_PER_USER,
    });
  });

  it("honours configured limits", () => {
    expect(
      resolveSubscriptionLimits({
        REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET: "3",
        REALTIME_MAX_SUBSCRIPTIONS_PER_USER: "5",
      })
    ).toEqual({ maxPerSocket: 3, maxPerUser: 5 });
  });
});

describe("SubscriptionManager", () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager({ maxPerSocket: 2, maxPerUser: 3 });
  });

  it("enforces the per-socket subscription limit", () => {
    const socket = createFakeSocket("s1");
    expect(subscribeToTransaction(socket, manager, "u1", "tx1").ok).toBe(true);
    expect(subscribeToTransaction(socket, manager, "u1", "tx2").ok).toBe(true);

    const third = subscribeToTransaction(socket, manager, "u1", "tx3");
    expect(third).toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_EXCEEDED",
    });
    expect(socket.rooms.size).toBe(2);
    expect(manager.getSocketSubscriptionCount("s1")).toBe(2);
  });

  it("enforces the per-user subscription limit across sockets", () => {
    const s1 = createFakeSocket("s1");
    const s2 = createFakeSocket("s2");
    expect(subscribeToTransaction(s1, manager, "u1", "tx1").ok).toBe(true);
    expect(subscribeToTransaction(s1, manager, "u1", "tx2").ok).toBe(true);
    expect(subscribeToTransaction(s2, manager, "u1", "tx3").ok).toBe(true);

    const fourth = subscribeToTransaction(s2, manager, "u1", "tx4");
    expect(fourth).toMatchObject({
      ok: false,
      code: "USER_SUBSCRIPTION_LIMIT_EXCEEDED",
    });
    expect(manager.getUserSubscriptionCount("u1")).toBe(3);
  });

  it("recovers a slot after unsubscribe", () => {
    const socket = createFakeSocket("s1");
    subscribeToTransaction(socket, manager, "u1", "tx1");
    subscribeToTransaction(socket, manager, "u1", "tx2");
    expect(subscribeToTransaction(socket, manager, "u1", "tx3").ok).toBe(false);

    expect(unsubscribeFromTransaction(socket, manager, "tx1")).toEqual({
      ok: true,
      room: "transaction:tx1",
      wasSubscribed: true,
    });
    expect(subscribeToTransaction(socket, manager, "u1", "tx3").ok).toBe(true);
    expect(manager.getSocketSubscriptionCount("s1")).toBe(2);
    expect(manager.getUserSubscriptionCount("u1")).toBe(2);
  });

  it("cleans up all subscriptions on disconnect", () => {
    const s1 = createFakeSocket("s1");
    const s2 = createFakeSocket("s2");
    subscribeToTransaction(s1, manager, "u1", "tx1");
    subscribeToBot(s1, manager, "u1", "bot1");
    subscribeToTransaction(s2, manager, "u1", "tx2");

    manager.clearSocket("s1");

    expect(manager.getSocketSubscriptionCount("s1")).toBe(0);
    expect(manager.getSocketSubscriptions("s1")).toEqual([]);
    expect(manager.getUserSubscriptionCount("u1")).toBe(1);
    expect(manager.getSocketSubscriptions("s2")).toEqual(["transaction:tx2"]);
  });

  it("clears the user counter once every socket disconnects", () => {
    const s1 = createFakeSocket("s1");
    const s2 = createFakeSocket("s2");
    subscribeToTransaction(s1, manager, "u1", "tx1");
    subscribeToTransaction(s2, manager, "u1", "tx2");

    manager.clearSocket("s1");
    manager.clearSocket("s2");

    expect(manager.getUserSubscriptionCount("u1")).toBe(0);
  });

  it("treats repeated subscribe to the same room as idempotent", () => {
    const socket = createFakeSocket("s1");
    expect(subscribeToTransaction(socket, manager, "u1", "tx1")).toEqual({
      ok: true,
      room: "transaction:tx1",
      alreadySubscribed: false,
    });
    expect(subscribeToTransaction(socket, manager, "u1", "tx1")).toEqual({
      ok: true,
      room: "transaction:tx1",
      alreadySubscribed: true,
    });
    expect(manager.getSocketSubscriptionCount("s1")).toBe(1);
    expect(manager.getUserSubscriptionCount("u1")).toBe(1);
    expect(socket.rooms.size).toBe(1);
  });
});

describe("unsubscribeFromRoom", () => {
  it("is idempotent and only leaves the requesting socket", () => {
    const manager = new SubscriptionManager({
      maxPerSocket: 10,
      maxPerUser: 10,
    });
    const alice = createFakeSocket("alice");
    const bob = createFakeSocket("bob");

    subscribeToTransaction(alice, manager, "u-alice", "tx1");
    subscribeToTransaction(bob, manager, "u-bob", "tx1");
    expect(alice.rooms.has("transaction:tx1")).toBe(true);
    expect(bob.rooms.has("transaction:tx1")).toBe(true);

    expect(unsubscribeFromTransaction(alice, manager, "tx1")).toEqual({
      ok: true,
      room: "transaction:tx1",
      wasSubscribed: true,
    });
    expect(alice.rooms.has("transaction:tx1")).toBe(false);
    expect(bob.rooms.has("transaction:tx1")).toBe(true);

    expect(unsubscribeFromTransaction(alice, manager, "tx1")).toEqual({
      ok: true,
      room: "transaction:tx1",
      wasSubscribed: false,
    });
    expect(bob.rooms.has("transaction:tx1")).toBe(true);
    expect(manager.getSocketSubscriptionCount("bob")).toBe(1);
    expect(manager.getUserSubscriptionCount("u-bob")).toBe(1);
  });

  it("unsubscribes from the shared bot:all room", () => {
    const manager = new SubscriptionManager({
      maxPerSocket: 10,
      maxPerUser: 10,
    });
    const socket = createFakeSocket("s1");
    subscribeToBot(socket, manager, "u1");
    expect(socket.rooms.has(BOT_ALL_ROOM)).toBe(true);

    expect(unsubscribeFromBot(socket, manager)).toEqual({
      ok: true,
      room: BOT_ALL_ROOM,
      wasSubscribed: true,
    });
    expect(socket.rooms.has(BOT_ALL_ROOM)).toBe(false);
    expect(manager.getSocketSubscriptionCount("s1")).toBe(0);
  });
});

describe("identifier validation in subscription helpers", () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager({ maxPerSocket: 5, maxPerUser: 5 });
  });

  it("rejects empty, oversized, malformed, and delimiter-containing ids", () => {
    const socket = createFakeSocket("s1");

    for (const bad of [
      "",
      "a".repeat(MAX_ROOM_ID_LENGTH + 1),
      "bad id",
      "tx:1",
    ]) {
      expect(subscribeToTransaction(socket, manager, "u1", bad)).toMatchObject({
        ok: false,
        code: "INVALID_IDENTIFIER",
      });
      expect(unsubscribeFromTransaction(socket, manager, bad)).toMatchObject({
        ok: false,
        code: "INVALID_IDENTIFIER",
      });
      expect(subscribeToBot(socket, manager, "u1", bad)).toMatchObject({
        ok: false,
        code: "INVALID_IDENTIFIER",
      });
      expect(unsubscribeFromBot(socket, manager, bad)).toMatchObject({
        ok: false,
        code: "INVALID_IDENTIFIER",
      });
    }

    expect(manager.getSocketSubscriptionCount("s1")).toBe(0);
    expect(socket.rooms.size).toBe(0);
  });
});

describe("subscribeToRoom", () => {
  it("enforces limits through the generic helper", () => {
    const manager = new SubscriptionManager({ maxPerSocket: 1, maxPerUser: 10 });
    const s1 = createFakeSocket("s1");
    const s2 = createFakeSocket("s2");

    expect(subscribeToRoom(s1, manager, "u1", "transaction:tx1").ok).toBe(true);
    expect(subscribeToRoom(s2, manager, "u2", "transaction:tx1").ok).toBe(true);

    const blocked = subscribeToRoom(s1, manager, "u1", "transaction:tx2");
    expect(blocked).toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_EXCEEDED",
    });
    expect(s1.rooms.has("transaction:tx2")).toBe(false);
    expect(unsubscribeFromRoom(s1, manager, "transaction:tx1").wasSubscribed).toBe(
      true
    );
  });
});
