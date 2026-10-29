# Agent memory API

Ownership-scoped inspection and deletion of the context the agent remembers about a user (#801). Both routes require a valid access token and operate only on the authenticated user's memory.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/memory` | `{ success, data: { userId, count, entries } }`: the caller's remembered entries, oldest first. Expired workflow entries are not returned, matching what the agent sees. |
| `DELETE` | `/api/memory` | `{ success, data: { removed } }`: forgets everything stored for the caller and returns how many entries were removed. Other users' memory is untouched. |

## Ownership

The user id always comes from the access token. A `userId` or `user_id` in the query string, body or path that differs from the caller's is refused with `403` and recorded in the audit log (`permission_denied`, reason `cross_user_memory_scope_denied`); nothing is read or deleted. A successful deletion is audited with the number of entries removed.

## Not changed

`MemoryStore` itself is unchanged: `get`, `clear`, `clearAll`, retention purging and erasure through `deletionCoordinator` behave as before. The routes are a thin, authenticated layer over `get` and `clear`, so a deletion removes the entries from the in-memory store and from the persisted `data/agent-memory.json`.

Tests: `tests/unit/memory.routes.test.ts` (real `MemoryStore` on a temporary file) alongside the existing `tests/unit/memory_store.test.ts`.
