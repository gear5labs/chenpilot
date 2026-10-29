import {
  DENIED_REASON,
  roomName,
  SubscriptionAccess,
} from "../../src/Gateway/subscriptionAccess";

function makeAccess(options?: {
  transactionOwners?: Record<string, string>;
  botOwners?: Record<string, string>;
  botGrants?: Record<string, string[]>;
}) {
  const transactionOwners = options?.transactionOwners ?? {};
  const botOwners = options?.botOwners ?? {};
  const botGrants = options?.botGrants ?? {};

  return new SubscriptionAccess({
    findTransactionOwner: async (id) => transactionOwners[id] ?? null,
    findBotOwner: async (id) => botOwners[id] ?? null,
    hasBotAccessGrant: async (userId, botId) =>
      (botGrants[userId] ?? []).includes(botId),
  });
}

describe("transaction subscription authorization (issue #1002)", () => {
  it("allows the transaction owner", async () => {
    const access = makeAccess({ transactionOwners: { "tx-1": "user-a" } });
    const decision = await access.authorizeTransaction("user-a", "tx-1");
    expect(decision.allowed).toBe(true);
  });

  it("rejects a user who does not own the transaction", async () => {
    const access = makeAccess({ transactionOwners: { "tx-1": "user-a" } });
    const decision = await access.authorizeTransaction("user-b", "tx-1");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(DENIED_REASON);
  });

  it("rejects a missing transaction with the same denial as an unauthorized one", async () => {
    const access = makeAccess();
    const missing = await access.authorizeTransaction("user-a", "tx-nope");
    const foreign = await access.authorizeTransaction(
      "user-a",
      "tx-nope-2"
    );
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toBe(foreign.reason);
  });
});

describe("bot-alert subscription authorization (issue #1003)", () => {
  it("allows the bot owner", async () => {
    const access = makeAccess({ botOwners: { "bot-1": "user-a" } });
    const decision = await access.authorizeBot("user-a", "bot-1");
    expect(decision.allowed).toBe(true);
  });

  it("rejects a non-owner with no grant", async () => {
    const access = makeAccess({ botOwners: { "bot-1": "user-a" } });
    const decision = await access.authorizeBot("user-b", "bot-1");
    expect(decision.allowed).toBe(false);
  });

  it("allows an explicit shared-access grant", async () => {
    const access = makeAccess({
      botOwners: { "bot-1": "user-a" },
      botGrants: { "user-b": ["bot-1"] },
    });
    const decision = await access.authorizeBot("user-b", "bot-1");
    expect(decision.allowed).toBe(true);
  });

  it("treats a revoked grant as denied", async () => {
    const access = makeAccess({
      botOwners: { "bot-1": "user-a" },
      botGrants: {},
    });
    const decision = await access.authorizeBot("user-b", "bot-1");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(DENIED_REASON);
  });

  it("does not reveal whether a nonexistent bot exists", async () => {
    const access = makeAccess();
    const nonexistent = await access.authorizeBot("user-a", "bot-missing");
    const foreign = await access.authorizeBot("user-b", "bot-missing");
    expect(nonexistent.allowed).toBe(false);
    expect(nonexistent.reason).toBe(foreign.reason);
    expect(nonexistent.reason).toBe(DENIED_REASON);
  });
});

describe("subscription tracking and revocation (issue #1004)", () => {
  it("tracks resource subscriptions per socket", () => {
    const access = makeAccess();
    access.track("sock-1", "user-a", {
      kind: "transaction",
      resourceId: "tx-1",
    });
    access.track("sock-1", "user-a", { kind: "bot", resourceId: "bot-1" });

    expect(access.listSubscriptions("sock-1")).toEqual([
      { kind: "transaction", resourceId: "tx-1" },
      { kind: "bot", resourceId: "bot-1" },
    ]);
  });

  it("finds sockets holding a subscription for a revoked resource", () => {
    const access = makeAccess();
    access.track("sock-1", "user-a", {
      kind: "transaction",
      resourceId: "tx-1",
    });
    access.track("sock-2", "user-a", {
      kind: "transaction",
      resourceId: "tx-1",
    });
    access.track("sock-3", "user-a", {
      kind: "transaction",
      resourceId: "tx-other",
    });

    expect(
      access.findForResource("user-a", {
        kind: "transaction",
        resourceId: "tx-1",
      })
    ).toEqual(["sock-1", "sock-2"]);
  });

  it("untracks a subscription so it is not revoked twice", () => {
    const access = makeAccess();
    const sub = { kind: "bot" as const, resourceId: "bot-1" };
    access.track("sock-1", "user-a", sub);

    access.untrack("sock-1", sub);
    expect(access.listSubscriptions("sock-1")).toEqual([]);
    expect(access.findForResource("user-a", sub)).toEqual([]);
  });

  it("clears every subscription on disconnect", () => {
    const access = makeAccess();
    access.track("sock-1", "user-a", {
      kind: "transaction",
      resourceId: "tx-1",
    });
    access.track("sock-1", "user-a", { kind: "bot", resourceId: "bot-1" });

    const cleared = access.clearSocket("sock-1");
    expect(cleared).toHaveLength(2);
    expect(access.listSubscriptions("sock-1")).toEqual([]);
  });

  it("computes the room name used for Socket.IO membership", () => {
    expect(
      roomName({ kind: "transaction", resourceId: "tx-9" })
    ).toBe("transaction:tx-9");
    expect(roomName({ kind: "bot", resourceId: "bot-9" })).toBe("bot:bot-9");
  });
});
