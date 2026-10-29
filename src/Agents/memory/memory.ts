import logger from "../../config/logger";
import * as fs from "fs";
import * as path from "path";

declare const process: { cwd: () => string };

/**
 * Optional flags for one memory entry.
 * Only these fields are read back from disk. Unknown JSON properties are ignored.
 */
export interface MemoryWriteOptions {
  /** Workflow context is omitted from new requests once this time has passed. */
  workflowExpiresAt?: number;
  /** Kept when conversation history is truncated so an in-flight transaction is not forgotten. */
  pendingTransaction?: boolean;
}

interface MemoryRecord {
  text: string;
  workflowExpiresAt?: number;
  pendingTransaction?: boolean;
}

type PersistedMemory = Record<string, Array<string | MemoryRecord>>;

export class MemoryStore {
  private memories = new Map<string, MemoryRecord[]>();
  private maxContextPerAgent: number;
  private storageFilePath: string;

  constructor(
    maxContextPerAgent = 10,
    storageFilePath = path.resolve(process.cwd(), "data", "agent-memory.json")
  ) {
    this.maxContextPerAgent = maxContextPerAgent;
    this.storageFilePath = storageFilePath;
    this.loadFromDisk();
  }

  add(agentId: string, entry: string, options?: MemoryWriteOptions): void {
    const existing = this.activeRecords(this.memories.get(agentId) ?? []);
    const record: MemoryRecord = { text: entry };
    if (
      typeof options?.workflowExpiresAt === "number" &&
      Number.isFinite(options.workflowExpiresAt)
    ) {
      record.workflowExpiresAt = options.workflowExpiresAt;
    }
    if (options?.pendingTransaction === true) {
      record.pendingTransaction = true;
    }

    const updated = this.trimToContext([...existing, record]);
    this.memories.set(agentId, updated);
    this.persistToDisk();
  }

  /**
   * Context for a new request. Expired workflow entries are left out.
   */
  get(agentId: string, now = Date.now()): string[] {
    return this.activeRecords(this.memories.get(agentId) ?? [], now).map(
      (record) => record.text
    );
  }

  /**
   * Drop workflow context that has expired so later requests cannot see it.
   * Returns how many entries were removed.
   */
  purgeExpiredWorkflowContext(now = Date.now()): number {
    let removed = 0;

    for (const [agentId, records] of this.memories.entries()) {
      const kept = this.activeRecords(records, now);
      removed += records.length - kept.length;
      if (kept.length === records.length) {
        continue;
      }
      if (kept.length === 0) {
        this.memories.delete(agentId);
      } else {
        this.memories.set(agentId, kept);
      }
    }

    if (removed > 0) {
      this.persistToDisk();
    }

    return removed;
  }

  clear(agentId: string): void {
    const removed = this.memories.delete(agentId);
    if (removed) {
      this.persistToDisk();
    }
  }

  clearAll(): void {
    if (this.memories.size === 0) {
      return;
    }

    this.memories.clear();
    this.persistToDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) {
        return;
      }

      const raw = fs.readFileSync(this.storageFilePath, "utf-8");
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as PersistedMemory;
      for (const agentId in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, agentId)) {
          continue;
        }

        const context = parsed[agentId];
        if (!Array.isArray(context)) {
          continue;
        }

        const sanitized = context
          .map((entry) => this.parseRecord(entry))
          .filter((entry): entry is MemoryRecord => entry !== null);
        const trimmed = this.trimToContext(sanitized);
        if (trimmed.length > 0) {
          this.memories.set(agentId, trimmed);
        }
      }
    } catch (error) {
      logger.error("Failed to load agent memory store from disk", {
        error,
        storageFilePath: this.storageFilePath,
      });
    }
  }

  private persistToDisk(): void {
    try {
      const directory = path.dirname(this.storageFilePath);
      fs.mkdirSync(directory, { recursive: true });

      const data: PersistedMemory = {};
      for (const [agentId, context] of this.memories.entries()) {
        data[agentId] = context;
      }

      fs.writeFileSync(
        this.storageFilePath,
        JSON.stringify(data, null, 2),
        "utf-8"
      );
    } catch (error) {
      logger.error("Failed to persist agent memory store to disk", {
        error,
        storageFilePath: this.storageFilePath,
      });
    }
  }

  private activeRecords(records: MemoryRecord[], now = Date.now()): MemoryRecord[] {
    return records.filter(
      (record) =>
        record.workflowExpiresAt === undefined || record.workflowExpiresAt > now
    );
  }

  /**
   * Drop the oldest ordinary lines first. Pending transaction facts stay,
   * in their original order, even when that makes the list longer than the cap.
   */
  private trimToContext(records: MemoryRecord[]): MemoryRecord[] {
    const pendingCount = records.filter(
      (record) => record.pendingTransaction
    ).length;
    if (pendingCount >= this.maxContextPerAgent) {
      return records.filter((record) => record.pendingTransaction);
    }

    const roomForOrdinary = this.maxContextPerAgent - pendingCount;
    const ordinary = records.filter((record) => !record.pendingTransaction);
    const keptOrdinary = new Set(ordinary.slice(-roomForOrdinary));
    return records.filter(
      (record) => record.pendingTransaction || keptOrdinary.has(record)
    );
  }

  private parseRecord(entry: unknown): MemoryRecord | null {
    if (typeof entry === "string") {
      return { text: entry };
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    const candidate = entry as {
      text?: unknown;
      workflowExpiresAt?: unknown;
      pendingTransaction?: unknown;
    };
    if (typeof candidate.text !== "string") {
      return null;
    }

    const record: MemoryRecord = { text: candidate.text };
    if (
      typeof candidate.workflowExpiresAt === "number" &&
      Number.isFinite(candidate.workflowExpiresAt)
    ) {
      record.workflowExpiresAt = candidate.workflowExpiresAt;
    }
    if (candidate.pendingTransaction === true) {
      record.pendingTransaction = true;
    }
    return record;
  }
}

export const memoryStore = new MemoryStore();
