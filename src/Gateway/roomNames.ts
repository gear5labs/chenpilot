/**
 * Canonical room-name construction for the realtime gateway.
 *
 * Socket.IO room names embed caller-provided identifiers (`transaction:<id>`,
 * `bot:<id>`, `user:<id>`, `execution:<id>`). Every join/leave path must build
 * those names through `buildRoomName` so delimiter and length behaviour is
 * validated in exactly one place instead of being assembled ad hoc from
 * template literals.
 */

import { ApiErrorCode, ApiError } from "../contracts/errorContract";

/** Maximum accepted length of a single room identifier. */
export const MAX_ROOM_ID_LENGTH = 128;

/** Separator between the room kind and the identifier. */
export const ROOM_DELIMITER = ":";

/**
 * Allowed identifier charset. Deliberately excludes `ROOM_DELIMITER` and any
 * whitespace so a caller-supplied id can never forge or split a room name.
 */
const ROOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type RoomKind = "user" | "transaction" | "bot" | "execution";

/** Room used when a client subscribes to every bot alert stream. */
export const BOT_ALL_ROOM = "bot:all";

function reject(message: string): never {
  throw new ApiError(message, 400, ApiErrorCode.INVALID_INPUT_FORMAT);
}

/**
 * Validate a caller-provided room identifier and return it unchanged.
 *
 * Rejects empty, oversized, delimiter-containing, and otherwise malformed
 * identifiers before they can be interpolated into a room name.
 */
export function validateRoomId(id: unknown): string {
  if (typeof id !== "string") {
    reject("Identifier must be a string.");
  }
  if (id.length === 0) {
    reject("Identifier must not be empty.");
  }
  if (id.length > MAX_ROOM_ID_LENGTH) {
    reject(`Identifier must be at most ${MAX_ROOM_ID_LENGTH} characters.`);
  }
  if (id.includes(ROOM_DELIMITER)) {
    reject(`Identifier must not contain '${ROOM_DELIMITER}'.`);
  }
  if (!ROOM_ID_PATTERN.test(id)) {
    reject("Identifier contains unsupported characters.");
  }
  return id;
}

/**
 * Build a Socket.IO room name from a kind and a validated identifier.
 */
export function buildRoomName(kind: RoomKind, id: string): string {
  return `${kind}${ROOM_DELIMITER}${validateRoomId(id)}`;
}

/**
 * Non-throwing variant for outbound broadcast paths where an invalid or
 * missing identifier should skip the fan-out rather than fail the emit.
 */
export function tryBuildRoomName(
  kind: RoomKind,
  id: string | undefined | null
): string | undefined {
  if (id === undefined || id === null) {
    return undefined;
  }
  try {
    return buildRoomName(kind, id);
  } catch {
    return undefined;
  }
}
