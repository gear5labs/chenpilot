import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const REGISTRY_FILE = path.join(DATA_DIR, "tool_registry.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE))
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ tools: [] }));
}

export interface ToolMetadata {
  name: string;
  version: string;
  authorizedRoles?: string[];
  deprecated?: boolean;
  deprecationDate?: string | null;
  description?: string;
}

export class ToolRegistry {
  private tools: ToolMetadata[] = [];

  constructor() {
    ensureDataDir();
    try {
      const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
      const parsed = JSON.parse(raw || "{}");
      this.tools = parsed.tools || [];
    } catch {
      this.tools = [];
    }
  }

  register(metadata: ToolMetadata): void {
    // replace same name+version
    this.tools = this.tools.filter(
      (t) => !(t.name === metadata.name && t.version === metadata.version)
    );
    this.tools.push(metadata);
    this.persist();
  }

  get(name: string, version?: string): ToolMetadata | undefined {
    if (version)
      return this.tools.find((t) => t.name === name && t.version === version);
    // return latest by version sort (lexicographic) — callers should use semver in production
    return [...this.tools]
      .filter((t) => t.name === name)
      .sort((a, b) => b.version.localeCompare(a.version))[0];
  }

  list(): ToolMetadata[] {
    return [...this.tools];
  }

  validateStartup(): { ok: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const names = new Set<string>();
    for (const t of this.tools) {
      const key = `${t.name}@${t.version}`;
      if (names.has(key)) warnings.push(`Duplicate registration for ${key}`);
      names.add(key);
      if (t.deprecated)
        warnings.push(`Tool ${t.name}@${t.version} is deprecated`);
    }
    return { ok: warnings.length === 0, warnings };
  }

  private persist() {
    fs.writeFileSync(
      REGISTRY_FILE,
      JSON.stringify({ tools: this.tools }, null, 2)
    );
  }
}

const defaultRegistry = new ToolRegistry();
export default defaultRegistry;
