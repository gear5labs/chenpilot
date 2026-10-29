import { randomUUID } from "crypto";
import { Socket } from "socket.io";
import { ExecutionContext, getExecutionContext, runWithExecutionContext } from "../observability/context";

export interface SocketContext {
  socket: Socket;
  userId?: string;
  roles?: string[];
}

export function createSocketContext(socket: Socket, userId?: string): ExecutionContext {
  const current = getExecutionContext();
  return {
    requestId: current?.requestId || randomUUID(),
    executionId: current?.executionId || randomUUID(),
    rootExecutionId: current?.rootExecutionId || current?.executionId || randomUUID(),
    parentExecutionId: current?.parentExecutionId,
    userId,
    roles: userId ? [] : undefined,
    transport: "websocket",
    ip:
      (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      socket.handshake.address ||
      undefined,
    userAgent: socket.handshake.headers["user-agent"] as string | undefined,
    path: socket.handshake.url,
    component: "websocket",
    messageId: socket.id,
  };
}

/**
 * Run `callback` under a fresh socket request context.
 *
 * Unlike `propagateSocketContext` (which reuses any ambient ids), this always
 * mints a new `requestId` for the inbound socket event so that a single
 * subscribe/unsubscribe/error can be correlated across logs and the client
 * error payload.
 */
export function runWithSocketRequest<T>(
  socket: Socket,
  userId: string | undefined,
  callback: () => T
): T {
  const current = getExecutionContext();
  return runWithExecutionContext(
    {
      ...createSocketContext(socket, userId),
      requestId: randomUUID(),
      executionId: current?.executionId || randomUUID(),
      rootExecutionId: current?.rootExecutionId || current?.executionId || randomUUID(),
    },
    callback
  );
}

export function propagateSocketContext<T>(
  socket: Socket,
  userId?: string,
  callback: () => T
): T {
  const context = createSocketContext(socket, userId);
  return runWithExecutionContext(context, callback);
}
