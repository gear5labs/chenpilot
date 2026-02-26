import logger from "../../config/logger";
import * as fs from "fs";
import * as path from "path";

declare const process: { cwd: () => string };

type PersistedMemory = Record<string, string[]>;

export class MemoryStore {
  private memories = new Map<string, string[]>();
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

  add(agentId: string, entry: string): void {
    const existing = this.memories.get(agentId) ?? [];
    const updated = [...existing, entry].slice(-this.maxContextPerAgent);
    this.memories.set(agentId, updated);
    this.persistToDisk();
  }

  get(agentId: string): string[] {
    const memory = this.memories.get(agentId);
    return memory ? [...memory] : [];
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
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-this.maxContextPerAgent);
        if (sanitized.length > 0) {
          this.memories.set(agentId, sanitized);
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
}

export const memoryStore = new MemoryStore();
