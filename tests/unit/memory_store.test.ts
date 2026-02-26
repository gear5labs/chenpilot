declare const process: { cwd: () => string };

import { MemoryStore } from "../../src/Agents/memory/memory";
import * as fs from "fs";
import * as path from "path";

describe("MemoryStore", () => {
  let storageDirectory: string;
  let storageFilePath: string;

  beforeEach(() => {
    storageDirectory = path.resolve(
      process.cwd(),
      "tmp",
      `memory-store-tests-${Date.now()}-${Math.floor(Math.random() * 10000)}`
    );
    storageFilePath = path.join(storageDirectory, "agent-memory.json");
  });

  afterEach(() => {
    if (fs.existsSync(storageDirectory)) {
      fs.rmSync(storageDirectory, { recursive: true, force: true });
    }
  });

  it("persists memory entries and reloads them", () => {
    const store = new MemoryStore(10, storageFilePath);

    store.add("user-1", "User: hello");
    store.add("user-1", "LLM: hi there");

    const reloadedStore = new MemoryStore(10, storageFilePath);

    expect(reloadedStore.get("user-1")).toEqual([
      "User: hello",
      "LLM: hi there",
    ]);
  });

  it("enforces max context per agent across reloads", () => {
    const store = new MemoryStore(2, storageFilePath);

    store.add("user-1", "entry-1");
    store.add("user-1", "entry-2");
    store.add("user-1", "entry-3");

    expect(store.get("user-1")).toEqual(["entry-2", "entry-3"]);

    const reloadedStore = new MemoryStore(2, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual(["entry-2", "entry-3"]);
  });

  it("persists clear and clearAll operations", () => {
    const store = new MemoryStore(10, storageFilePath);

    store.add("user-1", "entry-1");
    store.add("user-2", "entry-2");
    store.clear("user-1");

    let reloadedStore = new MemoryStore(10, storageFilePath);
    expect(reloadedStore.get("user-1")).toEqual([]);
    expect(reloadedStore.get("user-2")).toEqual(["entry-2"]);

    reloadedStore.clearAll();
    reloadedStore = new MemoryStore(10, storageFilePath);

    expect(reloadedStore.get("user-1")).toEqual([]);
    expect(reloadedStore.get("user-2")).toEqual([]);
  });
});
