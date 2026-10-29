/**
 * Realtime subscription accounting for the gateway.
 *
 * Tracks active room subscriptions per socket and per user so that a client
 * cannot grow room state without bound, and exposes the join/leave helpers
 * used by the `subscribe:*` / `unsubscribe:*` socket handlers.
 *
 * All room names must come from `roomNames.buildRoomName` — this module never
 * constructs identifiers itself.
 */

import { BOT_ALL_ROOM, buildRoomName } from "./roomNames";

export interface SubscriptionLimits {
  maxPerSocket: number;
  maxPerUser: number;
}

export const DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET = 50;
export const DEFAULT_MAX_SUBSCRIPTIONS_PER_USER = 200;

function resolveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read the configurable per-socket and per-user subscription limits.
 */
export function resolveSubscriptionLimits(
  env: NodeJS.ProcessEnv = process.env
): SubscriptionLimits {
  return {
    maxPerSocket: resolveLimit(
      env.REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET,
      DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET
    ),
    maxPerUser: resolveLimit(
      env.REALTIME_MAX_SUBSCRIPTIONS_PER_USER,
      DEFAULT_MAX_SUBSCRIPTIONS_PER_USER
    ),
  };
}

/** Minimal socket surface required to join and leave rooms. */
export interface RoomAwareSocket {
  id: string;
  join(room: string): void;
  leave(room: string): void;
}

export type SubscriptionErrorCode =
  | "SUBSCRIPTION_LIMIT_EXCEEDED"
  | "USER_SUBSCRIPTION_LIMIT_EXCEEDED"
  | "INVALID_IDENTIFIER";

export type SubscribeOutcome =
  | { ok: true; room: string; alreadySubscribed: boolean }
  | { ok: false; code: SubscriptionErrorCode; message: string };

export type UnsubscribeOutcome =
  | { ok: true; room: string; wasSubscribed: boolean }
  | { ok: false; code: SubscriptionErrorCode; message: string };

function invalidIdentifier(error: unknown): {
  ok: false;
  code: "INVALID_IDENTIFIER";
  message: string;
} {
  return {
    ok: false,
    code: "INVALID_IDENTIFIER",
    message: (error as Error)?.message || "Invalid identifier.",
  };
}

/**
 * In-memory registry of active room subscriptions.
 *
 * A "subscription" is one (socketId, room) pair. Re-subscribing to a room the
 * socket already occupies is a no-op, so counts stay stable even if a handler
 * runs more than once for the same event.
 */
export class SubscriptionManager {
  private readonly bySocket = new Map<string, Set<string>>();
  private readonly byUser = new Map<string, number>();
  private readonly socketUser = new Map<string, string>();

  constructor(private readonly limits: SubscriptionLimits) {}

  getSocketSubscriptionCount(socketId: string): number {
    return this.bySocket.get(socketId)?.size ?? 0;
  }

  getUserSubscriptionCount(userId: string): number {
    return this.byUser.get(userId) ?? 0;
  }

  getSocketSubscriptions(socketId: string): string[] {
    return Array.from(this.bySocket.get(socketId) ?? []);
  }

  /**
   * Record a subscription for `socketId`, enforcing both limits.
   */
  trySubscribe(
    socketId: string,
    userId: string,
    room: string
  ):
    | { ok: true; alreadySubscribed: boolean }
    | { ok: false; code: SubscriptionErrorCode; message: string } {
    const rooms = this.bySocket.get(socketId);
    if (rooms?.has(room)) {
      return { ok: true, alreadySubscribed: true };
    }

    const socketCount = rooms?.size ?? 0;
    if (socketCount >= this.limits.maxPerSocket) {
      return {
        ok: false,
        code: "SUBSCRIPTION_LIMIT_EXCEEDED",
        message: `Per-socket subscription limit of ${this.limits.maxPerSocket} reached. Unsubscribe before adding more.`,
      };
    }

    const userCount = this.byUser.get(userId) ?? 0;
    if (userCount >= this.limits.maxPerUser) {
      return {
        ok: false,
        code: "USER_SUBSCRIPTION_LIMIT_EXCEEDED",
        message: `Per-user subscription limit of ${this.limits.maxPerUser} reached. Unsubscribe before adding more.`,
      };
    }

    if (!rooms) {
      this.bySocket.set(socketId, new Set());
    }
    this.bySocket.get(socketId)!.add(room);
    this.socketUser.set(socketId, userId);
    this.byUser.set(userId, userCount + 1);
    return { ok: true, alreadySubscribed: false };
  }

  /**
   * Drop a subscription. Idempotent — unsubscribing a room the socket is not
   * in reports `wasSubscribed: false` and leaves counts unchanged.
   */
  tryUnsubscribe(socketId: string, room: string): { ok: true; wasSubscribed: boolean } {
    const rooms = this.bySocket.get(socketId);
    if (!rooms?.has(room)) {
      return { ok: true, wasSubscribed: false };
    }

    rooms.delete(room);

    const userId = this.socketUser.get(socketId);
    if (userId !== undefined) {
      const remaining = (this.byUser.get(userId) ?? 1) - 1;
      if (remaining <= 0) {
        this.byUser.delete(userId);
      } else {
        this.byUser.set(userId, remaining);
      }
    }

    if (rooms.size === 0) {
      this.bySocket.delete(socketId);
      this.socketUser.delete(socketId);
    }

    return { ok: true, wasSubscribed: true };
  }

  /**
   * Release every subscription held by a socket (disconnect cleanup).
   */
  clearSocket(socketId: string): void {
    const rooms = this.bySocket.get(socketId);
    const userId = this.socketUser.get(socketId);
    this.bySocket.delete(socketId);
    this.socketUser.delete(socketId);
    if (!rooms || userId === undefined) {
      return;
    }

    const remaining = (this.byUser.get(userId) ?? rooms.size) - rooms.size;
    if (remaining <= 0) {
      this.byUser.delete(userId);
    } else {
      this.byUser.set(userId, remaining);
    }
  }
}

/**
 * Join `room` for `socket`, enforcing subscription limits.
 *
 * A socket that already occupies the room is left untouched and reports
 * `alreadySubscribed`, keeping repeated subscribe events idempotent.
 */
export function subscribeToRoom(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  userId: string,
  room: string
): SubscribeOutcome {
  const result = manager.trySubscribe(socket.id, userId, room);
  if (!result.ok) {
    return result;
  }
  if (!result.alreadySubscribed) {
    socket.join(room);
  }
  return { ok: true, room, alreadySubscribed: result.alreadySubscribed };
}

/**
 * Leave `room` for `socket` only — other sockets in the room are unaffected.
 * Idempotent: unsubscribing a room the socket is not in is a successful no-op.
 */
export function unsubscribeFromRoom(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  room: string
): UnsubscribeOutcome {
  const { wasSubscribed } = manager.tryUnsubscribe(socket.id, room);
  if (wasSubscribed) {
    socket.leave(room);
  }
  return { ok: true, room, wasSubscribed };
}

/** Build the transaction room name and join it. */
export function subscribeToTransaction(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  userId: string,
  transactionId: string
): SubscribeOutcome {
  try {
    return subscribeToRoom(
      socket,
      manager,
      userId,
      buildRoomName("transaction", transactionId)
    );
  } catch (error) {
    return invalidIdentifier(error);
  }
}

/**
 * Build the bot room name and join it. An omitted `botId` subscribes to the
 * shared `bot:all` room.
 */
export function subscribeToBot(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  userId: string,
  botId?: string
): SubscribeOutcome {
  try {
    const room = botId === undefined ? BOT_ALL_ROOM : buildRoomName("bot", botId);
    return subscribeToRoom(socket, manager, userId, room);
  } catch (error) {
    return invalidIdentifier(error);
  }
}

/** Build the transaction room name and leave it. */
export function unsubscribeFromTransaction(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  transactionId: string
): UnsubscribeOutcome {
  try {
    return unsubscribeFromRoom(
      socket,
      manager,
      buildRoomName("transaction", transactionId)
    );
  } catch (error) {
    return invalidIdentifier(error);
  }
}

/**
 * Build the bot room name and leave it. An omitted `botId` leaves the shared
 * `bot:all` room.
 */
export function unsubscribeFromBot(
  socket: RoomAwareSocket,
  manager: SubscriptionManager,
  botId?: string
): UnsubscribeOutcome {
  try {
    const room = botId === undefined ? BOT_ALL_ROOM : buildRoomName("bot", botId);
    return unsubscribeFromRoom(socket, manager, room);
  } catch (error) {
    return invalidIdentifier(error);
  }
}
