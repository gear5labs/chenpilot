/**
 * Workflow Schema Version Management
 * 
 * This module handles schema versioning for durable execution workflows.
 * When the workflow schema changes (e.g., ExecutionPlan structure changes),
 * the version should be incremented to prevent incompatible resumes.
 */

/**
 * Current workflow schema version
 * 
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes that require migration or prevent resume
 * - MINOR: Non-breaking additions that are backward compatible
 * - PATCH: Bug fixes that don't affect the schema structure
 */
export const CURRENT_WORKFLOW_SCHEMA_VERSION = "1.0.0";

/**
 * Minimum compatible schema version
 * 
 * This defines the oldest version that can be resumed by the current code.
 * Set this to allow backward compatibility for minor/patch versions.
 */
export const MINIMUM_COMPATIBLE_SCHEMA_VERSION = "1.0.0";

/**
 * Schema version compatibility result
 */
export interface VersionCompatibilityResult {
  compatible: boolean;
  reason?: string;
  currentVersion: string;
  storedVersion: string;
}

/**
 * Parse a semantic version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
  };
}

/**
 * Compare two semantic versions
 * 
 * @returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);

  if (parsed1.major !== parsed2.major) {
    return parsed1.major < parsed2.major ? -1 : 1;
  }
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor < parsed2.minor ? -1 : 1;
  }
  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch < parsed2.patch ? -1 : 1;
  }
  return 0;
}

/**
 * Check if a stored schema version is compatible with the current version
 * 
 * @param storedVersion - The schema version stored in the execution
 * @returns Compatibility check result
 */
export function checkSchemaCompatibility(
  storedVersion: string
): VersionCompatibilityResult {
  const current = CURRENT_WORKFLOW_SCHEMA_VERSION;
  const minimum = MINIMUM_COMPATIBLE_SCHEMA_VERSION;

  // Exact match is always compatible
  if (storedVersion === current) {
    return {
      compatible: true,
      currentVersion: current,
      storedVersion,
    };
  }

  // Check if stored version is below minimum compatible
  if (compareVersions(storedVersion, minimum) < 0) {
    return {
      compatible: false,
      reason: `Stored schema version ${storedVersion} is below minimum compatible version ${minimum}. Migration required.`,
      currentVersion: current,
      storedVersion,
    };
  }

  // Check if stored version is from the future (newer than current)
  if (compareVersions(storedVersion, current) > 0) {
    return {
      compatible: false,
      reason: `Stored schema version ${storedVersion} is newer than current version ${current}. Code upgrade required.`,
      currentVersion: current,
      storedVersion,
    };
  }

  // Stored version is between minimum and current - compatible
  return {
    compatible: true,
    currentVersion: current,
    storedVersion,
  };
}

/**
 * Validate that a schema version string is properly formatted
 */
export function isValidSchemaVersion(version: string): boolean {
  try {
    parseVersion(version);
    return true;
  } catch {
    return false;
  }
}
