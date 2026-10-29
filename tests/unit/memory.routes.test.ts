declare const process: { cwd: () => string };

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import { MemoryStore } from "../../src/Agents/memory/memory";
import { auditLogService } from "../../src/AuditLog/auditLog.service";
import { AuditAction } from "../../src/AuditLog/auditLog.entity";

let mockCurrentUser: { userId: string; name: string; role: string } | null =
  null;

jest.mock("../../src/Auth/auth.middleware", () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) => {
    if (!mockCurrentUser) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }
    (req as Request & { user: typeof mockCurrentUser }).user = mockCurrentUser;
    next();
  },
}));
jest.mock("../../src/config/logger");
jest.mock("../../src/AuditLog/auditLog.service", () => ({
  auditLogService: { log: jest.fn().mockResolvedValue({ id: "audit-1" }) },
}));

import { createMemoryRoutes } from "../../src/Agents/memory/memory.routes";

describe("memory routes: ownership-scoped inspection and deletion (#801)", () => {
  let storageDirectory: string;
  let store: MemoryStore;
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    storageDirectory = path.resolve(
      process.cwd(),
      "tmp",
      `memory-routes-tests-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    );
    store = new MemoryStore(
      10,
      path.join(storageDirectory, "agent-memory.json")
    );
    store.add("alice", "User: pay Bob 10 XLM");
    store.add("alice", "LLM: prepared a payment");
    store.add("bob", "User: what is my balance");

    mockCurrentUser = { userId: "alice", name: "alice", role: "user" };
    app = express();
    app.use(express.json());
    app.use("/memory", createMemoryRoutes(store));
  });

  afterEach(() => {
    if (fs.existsSync(storageDirectory)) {
      fs.rmSync(storageDirectory, { recursive: true, force: true });
    }
  });

  describe("authentication", () => {
    it("refuses an unauthenticated read and delete", async () => {
      mockCurrentUser = null;
      await request(app).get("/memory").expect(401);
      await request(app).delete("/memory").expect(401);
      expect(store.get("alice")).toHaveLength(2);
    });
  });

  describe("inspection", () => {
    it("returns only the authenticated user's entries, in order", async () => {
      const res = await request(app).get("/memory").expect(200);
      expect(res.body.data).toEqual({
        userId: "alice",
        count: 2,
        entries: ["User: pay Bob 10 XLM", "LLM: prepared a payment"],
      });
      expect(JSON.stringify(res.body)).not.toContain("balance");
    });

    it("returns an empty list for a user with no memory", async () => {
      mockCurrentUser = { userId: "carol", name: "carol", role: "user" };
      const res = await request(app).get("/memory").expect(200);
      expect(res.body.data).toEqual({ userId: "carol", count: 0, entries: [] });
    });

    it("does not list expired workflow entries", async () => {
      store.add("alice", "Workflow: stale", {
        workflowExpiresAt: Date.now() - 1,
      });
      const res = await request(app).get("/memory").expect(200);
      expect(res.body.data.entries).not.toContain("Workflow: stale");
    });

    it.each([
      ["query", (r: request.Test) => r.query({ userId: "bob" })],
      ["snake_case query", (r: request.Test) => r.query({ user_id: "bob" })],
    ])(
      "refuses another user's id in the %s and audits it",
      async (_name, apply) => {
        const res = await apply(request(app).get("/memory")).expect(403);
        expect(res.body.success).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("balance");
        expect(auditLogService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "alice",
            action: AuditAction.PERMISSION_DENIED,
            metadata: expect.objectContaining({
              requestedUserId: "bob",
              reason: "cross_user_memory_scope_denied",
            }),
          })
        );
      }
    );

    it("accepts the user's own id explicitly", async () => {
      const res = await request(app)
        .get("/memory")
        .query({ userId: "alice" })
        .expect(200);
      expect(res.body.data.count).toBe(2);
    });
  });

  describe("deletion", () => {
    it("deletes the authenticated user's memory and leaves other users' untouched", async () => {
      const res = await request(app).delete("/memory").expect(200);
      expect(res.body.data).toEqual({ removed: 2 });
      expect(store.get("alice")).toEqual([]);
      expect(store.get("bob")).toEqual(["User: what is my balance"]);

      const reloaded = new MemoryStore(
        10,
        path.join(storageDirectory, "agent-memory.json")
      );
      expect(reloaded.get("alice")).toEqual([]);
      expect(reloaded.get("bob")).toEqual(["User: what is my balance"]);
    });

    it("audits the deletion by the owner", async () => {
      await request(app).delete("/memory").expect(200);
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "alice",
          metadata: expect.objectContaining({
            reason: "agent_memory_deleted_by_owner",
            removed: 2,
          }),
        })
      );
    });

    it("refuses to delete another user's memory by body or query and changes nothing", async () => {
      await request(app).delete("/memory").send({ userId: "bob" }).expect(403);
      await request(app)
        .delete("/memory")
        .query({ user_id: "bob" })
        .expect(403);
      expect(store.get("bob")).toEqual(["User: what is my balance"]);
      expect(store.get("alice")).toHaveLength(2);
    });

    it("is a no-op that reports zero removed when the user has no memory", async () => {
      mockCurrentUser = { userId: "carol", name: "carol", role: "user" };
      const res = await request(app).delete("/memory").expect(200);
      expect(res.body.data).toEqual({ removed: 0 });
      expect(store.get("alice")).toHaveLength(2);
    });
  });
});
