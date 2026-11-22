import * as crypto from "crypto";
import { ToolDefinition, ToolMetadata, ToolDiscoveryResult, ToolDiscoveryFailureType } from "./ToolMetadata";

/**
 * Validates tool metadata schema before activation into the registry (#1087)
 */
export function validateToolMetadataSchema(metadata: ToolMetadata): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!metadata) {
    return { valid: false, errors: ["Tool metadata is required"] };
  }

  // Name validation
  if (!metadata.name || typeof metadata.name !== "string") {
    errors.push("Tool name is required and must be a string");
  } else if (!/^[a-zA-Z0-9_:-]+$/.test(metadata.name)) {
    errors.push(`Tool name '${metadata.name}' contains invalid characters (must match ^[a-zA-Z0-9_:-]+$)`);
  }

  // Version validation
  if (!metadata.version || typeof metadata.version !== "string") {
    errors.push("Tool version is required and must be a string");
  } else if (!/^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/.test(metadata.version)) {
    errors.push(`Tool version '${metadata.version}' must follow semantic versioning`);
  }

  // Capabilities validation
  if (!Array.isArray(metadata.capabilities)) {
    errors.push("Tool capabilities must be an array");
  }

  // Parameters validation
  if (metadata.parameters && typeof metadata.parameters !== "object") {
    errors.push("Tool parameters must be a valid key-value schema object");
  } else if (metadata.parameters) {
    for (const [paramName, paramDef] of Object.entries(metadata.parameters)) {
      if (!paramDef.type || !["string", "number", "boolean", "object", "array"].includes(paramDef.type)) {
        errors.push(`Parameter '${paramName}' has invalid or missing type`);
      }
      if (typeof paramDef.required !== "boolean") {
        errors.push(`Parameter '${paramName}' must explicitly specify 'required' as boolean`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sorts and computes deterministic registry fingerprint (#1088)
 */
export function getDeterministicRegistryFingerprint(tools: ToolDefinition[]): {
  sortedTools: ToolDefinition[];
  fingerprint: string;
} {
  const sorted = [...tools].sort((a, b) => {
    const keyA = `${a.metadata.name}@${a.metadata.version}`;
    const keyB = `${b.metadata.name}@${b.metadata.version}`;
    return keyA.localeCompare(keyB);
  });

  const hashInput = sorted
    .map((t) => `${t.metadata.name}@${t.metadata.version}:${JSON.stringify(t.metadata.parameters)}`)
    .join("||");

  const fingerprint = crypto.createHash("sha256").update(hashInput).digest("hex");

  return {
    sortedTools: sorted,
    fingerprint,
  };
}

/**
 * Sanitizes tool descriptions to prevent prompt injection from overriding system policy (#1089)
 */
export function sanitizeToolDescription(rawDescription: string): string {
  if (!rawDescription) return "";

  // 1. Defang adversarial prompt injection tokens
  let sanitized = rawDescription
    .replace(/(?:system|developer|user|assistant)\s*:\s*/gi, "[filtered-role]: ")
    .replace(/ignore\s+(?:all\s+)?previous\s+instructions/gi, "[blocked instruction override]")
    .replace(/override\s+system\s+policy/gi, "[blocked policy override]")
    .replace(/```(?:system|json|markdown)?/gi, "'''");

  // 2. Strict character escaping for context boundaries
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  
  // 3. Encapsulate within inert data fences
  return sanitized.trim();
}
