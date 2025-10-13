type MemoryItem = {
  agentId: string;
  context: string[];
};

export class MemoryStore {
  private memories: MemoryItem[] = [];
  private maxContextPerAgent: number;

  constructor(maxContextPerAgent = 10) {
    this.maxContextPerAgent = maxContextPerAgent;
  }

  add(agentId: string, entry: string) {
    let memory = this.memories.find(m => m.agentId === agentId);
    if (!memory) {
      memory = { agentId, context: [] };
      this.memories.push(memory);
    }
    memory.context.push(entry);
    if (memory.context.length > this.maxContextPerAgent) {
      memory.context = memory.context.slice(-this.maxContextPerAgent);
    }
  }

  get(agentId: string): string[] {
    const memory = this.memories.find(m => m.agentId === agentId);
    return memory ? memory.context : [];
  }

  clear(agentId: string) {
    this.memories = this.memories.filter(m => m.agentId !== agentId);
  }

  clearAll() {
    this.memories = [];
  }
}

export const memoryStore = new MemoryStore();
