import fs from "fs";
import path from "path";
import { Request, Response, NextFunction } from "express";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "idempotency.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE))
    fs.writeFileSync(STORE_FILE, JSON.stringify({}));
}

type StoredResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  timestamp: string;
};

class IdempotencyStore {
  private store: Record<string, StoredResponse> = {};

  constructor() {
    ensureDataDir();
    try {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      this.store = JSON.parse(raw || "{}") as Record<string, StoredResponse>;
    } catch {
      this.store = {};
    }
  }

  get(key: string): StoredResponse | undefined {
    return this.store[key];
  }

  put(
    key: string,
    value: { status: number; headers: Record<string, string>; body: unknown }
  ) {
    this.store[key] = { ...value, timestamp: new Date().toISOString() };
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.store, null, 2));
  }
}

const store = new IdempotencyStore();

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(method)) return next();

  const key =
    req.headers["idempotency-key"] ||
    req.headers["Idempotency-Key"] ||
    req.headers["Idempotency-Key".toLowerCase()];
  if (!key || Array.isArray(key)) return next();

  const existing = store.get(String(key));
  if (existing) {
    Object.entries(existing.headers || {}).forEach(([k, v]) =>
      res.setHeader(k, v)
    );
    return res.status(existing.status).json(existing.body);
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body: unknown) => {
    try {
      store.put(String(key), {
        status: res.statusCode || 200,
        headers: {},
        body,
      });
    } catch {
      // ignore store errors
    }
    return originalJson(body);
  };

  res.send = (body?: unknown) => {
    try {
      let parsed = body;
      try {
        if (typeof body === "string") parsed = JSON.parse(body) as unknown;
      } catch {
        // not JSON, store as-is
      }
      store.put(String(key), {
        status: res.statusCode || 200,
        headers: {},
        body: parsed,
      });
    } catch {
      // ignore store errors
    }
    return originalSend(body);
  };

  return next();
}

export default idempotencyMiddleware;
