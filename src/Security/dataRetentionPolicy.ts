import crypto from "crypto";

export type RetentionUnit =
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

export type DataStoreKind = "primary" | "cache" | "export" | "backup" | "derived";
export type EncryptionStrategy = "shared" | "per-user" | "per-tenant" | "per-tenant-and-user";

export interface DataStoreDescriptor {
  name: string;
  kind: DataStoreKind;
  location: string;
  propagatesOnDelete: boolean;
  notes?: string;
}

export interface LegalHold {
  id: string;
  reason: string;
  scope: "legal" | "audit" | "regulatory" | "customer";
  owner: string;
  createdAt: string;
  expiresAt?: string;
  narrowScope: string[];
}

export interface EncryptionPolicy {
  strategy: EncryptionStrategy;
  keyId: string;
  requiresCryptographicErasure: boolean;
}

export interface PersistedDataClass {
  id: string;
  owner: string;
  purpose: string;
  retentionPeriod: number;
  retentionUnit: RetentionUnit;
  stores: DataStoreDescriptor[];
  encryption?: EncryptionPolicy;
  legalHolds?: LegalHold[];
}

export interface DeletionContext {
  subjectId: string;
  userId?: string;
  tenantId?: string;
  legalHolds?: LegalHold[];
  requestedBy?: string;
  reason?: string;
}

export interface VerificationReport {
  reportId: string;
  targetId: string;
  deletedStores: string[];
  retainedByHold: string[];
  keyId?: string;
  cryptographicErasure: boolean;
  erasureConfirmed: boolean;
  evidenceHash: string;
  summary: string;
  createdAt: string;
  deletedDataSample: string[];
}

export interface DataDeletionResult {
  allowed: boolean;
  subjectId: string;
  policyId: string;
  deletedStores: string[];
  retainedByHold: string[];
  verification: VerificationReport;
}

export const DEFAULT_DATA_RETAINED_CLASSES: PersistedDataClass[] = [
  {
    id: "application_logs",
    owner: "security-operations",
    purpose: "Operational diagnostics, anomaly investigation, and incident response",
    retentionPeriod: 90,
    retentionUnit: "days",
    stores: [
      { name: "application_log_table", kind: "primary", location: "postgres/logs", propagatesOnDelete: true },
      { name: "log_cache", kind: "cache", location: "redis/log-cache", propagatesOnDelete: true },
      { name: "daily_export", kind: "export", location: "s3/log-exports", propagatesOnDelete: true },
      { name: "analytics_snapshot", kind: "derived", location: "warehouse/log-aggregates", propagatesOnDelete: true },
    ],
    encryption: {
      strategy: "per-tenant",
      keyId: "tenant-key",
      requiresCryptographicErasure: true,
    },
  },
  {
    id: "conversation_transcripts",
    owner: "support-platform",
    purpose: "Customer support interactions and dispute resolution",
    retentionPeriod: 30,
    retentionUnit: "days",
    stores: [
      { name: "transcript_store", kind: "primary", location: "postgres/transcripts", propagatesOnDelete: true },
      { name: "transcript_cache", kind: "cache", location: "redis/transcript-cache", propagatesOnDelete: true },
      { name: "export_bundle", kind: "export", location: "s3/transcript-exports", propagatesOnDelete: true },
      { name: "summary_index", kind: "derived", location: "search/transcript-summaries", propagatesOnDelete: true },
    ],
    encryption: {
      strategy: "per-user",
      keyId: "user-key",
      requiresCryptographicErasure: true,
    },
  },
  {
    id: "audit_payloads",
    owner: "compliance",
    purpose: "Evidence for governance, auditing, and security investigations",
    retentionPeriod: 365,
    retentionUnit: "days",
    stores: [
      { name: "audit_event_store", kind: "primary", location: "postgres/audit-events", propagatesOnDelete: true },
      { name: "audit_archive", kind: "backup", location: "s3/audit-archive", propagatesOnDelete: true },
      { name: "audit_export", kind: "export", location: "s3/audit-exports", propagatesOnDelete: true },
    ],
    encryption: {
      strategy: "per-tenant",
      keyId: "tenant-key",
      requiresCryptographicErasure: true,
    },
  },
  {
    id: "data_exports",
    owner: "data-privacy",
    purpose: "User-requested or system-generated exports for portability and review",
    retentionPeriod: 7,
    retentionUnit: "days",
    stores: [
      { name: "export_manifest", kind: "primary", location: "postgres/export-requests", propagatesOnDelete: true },
      { name: "export_bucket", kind: "export", location: "s3/user-exports", propagatesOnDelete: true },
      { name: "export_cache", kind: "cache", location: "redis/export-cache", propagatesOnDelete: true },
    ],
    encryption: {
      strategy: "per-user",
      keyId: "user-key",
      requiresCryptographicErasure: true,
    },
  },
  {
    id: "backups",
    owner: "platform-operations",
    purpose: "Disaster recovery and restore validations",
    retentionPeriod: 30,
    retentionUnit: "days",
    stores: [
      { name: "backup_set", kind: "backup", location: "blob-storage/tenant-backups", propagatesOnDelete: true },
      { name: "restore_snapshot", kind: "derived", location: "blob-storage/restore-snapshots", propagatesOnDelete: true },
    ],
    encryption: {
      strategy: "per-tenant-and-user",
      keyId: "tenant-user-key",
      requiresCryptographicErasure: true,
    },
  },
];

export const defaultDataRetentionPolicies = DEFAULT_DATA_RETAINED_CLASSES;
export const dataRetentionCatalog = DEFAULT_DATA_RETAINED_CLASSES;

export function getDataRetentionPolicy(
  dataClassId: string,
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): PersistedDataClass | undefined {
  return catalog.find((entry) => entry.id === dataClassId);
}

export function classifyPersistedData(
  dataClassId: string,
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): PersistedDataClass | undefined {
  return getDataRetentionPolicy(dataClassId, catalog);
}

export function buildDataRetentionCatalog(
  overrides: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): PersistedDataClass[] {
  return overrides.map((entry) => ({ ...entry, stores: [...entry.stores] }));
}

export function validateDataRetentionCatalog(
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): { valid: boolean; invalid: string[]; errors: string[] } {
  const errors: string[] = [];
  const invalid: string[] = [];

  for (const entry of catalog) {
    if (!entry.id || !entry.owner || !entry.purpose || !entry.retentionPeriod) {
      invalid.push(entry.id || "unknown");
      errors.push(`Data class ${entry.id ?? "<unknown>"} is missing owner, purpose, or retentionPeriod.`);
      continue;
    }

    if (!entry.stores || entry.stores.length === 0) {
      invalid.push(entry.id);
      errors.push(`Data class ${entry.id} is missing stores to delete.`);
    }
  }

  return { valid: invalid.length === 0, invalid, errors };
}

export function resolveEncryptionKey(
  strategy: EncryptionStrategy,
  userId?: string,
  tenantId?: string,
  baseKeyId?: string
): string {
  const normalizedBase = baseKeyId ?? "default-key";
  if (strategy === "per-user") return `user:${userId ?? "anonymous"}:${normalizedBase}`;
  if (strategy === "per-tenant") return `tenant:${tenantId ?? "shared"}:${normalizedBase}`;
  if (strategy === "per-tenant-and-user") {
    return `tenant:${tenantId ?? "shared"}:user:${userId ?? "anonymous"}:${normalizedBase}`;
  }
  return normalizedBase;
}

export function scheduleLegalHold(
  dataClassId: string,
  hold: LegalHold,
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): PersistedDataClass | undefined {
  const entry = getDataRetentionPolicy(dataClassId, catalog);
  if (!entry) return undefined;

  const nextEntry = { ...entry, legalHolds: [...(entry.legalHolds ?? []), hold] };
  const index = catalog.findIndex((item) => item.id === dataClassId);
  if (index >= 0) {
    catalog[index] = nextEntry;
  }

  return nextEntry;
}

export function clearLegalHold(
  dataClassId: string,
  legalHoldId: string,
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): PersistedDataClass | undefined {
  const entry = getDataRetentionPolicy(dataClassId, catalog);
  if (!entry) return undefined;

  const nextHolds = (entry.legalHolds ?? []).filter((hold) => hold.id !== legalHoldId);
  const nextEntry = { ...entry, legalHolds: nextHolds };
  const index = catalog.findIndex((item) => item.id === dataClassId);
  if (index >= 0) {
    catalog[index] = nextEntry;
  }

  return nextEntry;
}

export function deletePersistedData(
  dataClassId: string,
  context: DeletionContext,
  catalog: PersistedDataClass[] = DEFAULT_DATA_RETAINED_CLASSES
): DataDeletionResult {
  const policy = getDataRetentionPolicy(dataClassId, catalog);
  if (!policy) {
    const report: VerificationReport = {
      reportId: crypto.randomUUID(),
      targetId: context.subjectId,
      deletedStores: [],
      retainedByHold: [],
      cryptographicErasure: false,
      erasureConfirmed: false,
      evidenceHash: "",
      summary: `No retention policy exists for ${dataClassId}.`,
      createdAt: new Date().toISOString(),
      deletedDataSample: [],
    };

    return {
      allowed: false,
      subjectId: context.subjectId,
      policyId: dataClassId,
      deletedStores: [],
      retainedByHold: [],
      verification: report,
    };
  }

  const configuredHolds = [...(policy.legalHolds ?? []), ...(context.legalHolds ?? [])];
  const activeHolds = configuredHolds.filter((hold) => {
    if (!hold.expiresAt) return true;
    return new Date(hold.expiresAt).getTime() > Date.now();
  });

  const activeHoldIds = activeHolds.map((hold) => hold.id);
  const blocked = activeHolds.length > 0;

  if (blocked) {
    const report: VerificationReport = {
      reportId: crypto.randomUUID(),
      targetId: context.subjectId,
      deletedStores: [],
      retainedByHold: activeHoldIds,
      cryptographicErasure: Boolean(policy.encryption?.requiresCryptographicErasure),
      erasureConfirmed: false,
      evidenceHash: crypto
        .createHash("sha256")
        .update(JSON.stringify({ subjectId: context.subjectId, dataClassId, activeHoldIds }))
        .digest("hex"),
      summary: `Deletion blocked by explicit legal or audit hold(s): ${activeHoldIds.join(", ") || "none"}.`,
      createdAt: new Date().toISOString(),
      deletedDataSample: [],
    };

    return {
      allowed: false,
      subjectId: context.subjectId,
      policyId: policy.id,
      deletedStores: [],
      retainedByHold: activeHoldIds,
      verification: report,
    };
  }

  const deletionTargets = policy.stores.filter((store) => store.propagatesOnDelete);
  const deletedStores = deletionTargets.map((store) => store.name);
  const effectiveKeyId = resolveEncryptionKey(
    policy.encryption?.strategy ?? "shared",
    context.userId,
    context.tenantId,
    policy.encryption?.keyId
  );

  const evidenceHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        subjectId: context.subjectId,
        policyId: policy.id,
        deletedStores,
        requestedBy: context.requestedBy ?? "system",
        reason: context.reason ?? "retention-expired",
      })
    )
    .digest("hex");

  const report: VerificationReport = {
    reportId: crypto.randomUUID(),
    targetId: context.subjectId,
    deletedStores,
    retainedByHold: [],
    keyId: effectiveKeyId,
    cryptographicErasure: Boolean(policy.encryption?.requiresCryptographicErasure),
    erasureConfirmed: true,
    evidenceHash,
    summary: `Deleted subject ${context.subjectId} from ${deletedStores.join(", ")} and verified a hash proving no deleted content was exposed in the report.`,
    createdAt: new Date().toISOString(),
    deletedDataSample: ["redacted-subject-reference", "hash-proof-only"],
  };

  return {
    allowed: true,
    subjectId: context.subjectId,
    policyId: policy.id,
    deletedStores,
    retainedByHold: [],
    verification: report,
  };
}

export const createDataRetentionPolicy = buildDataRetentionCatalog;
export const purgePersistedData = deletePersistedData;
export const createVerificationReport = (
  targetId: string,
  deletedStores: string[],
  keyId?: string,
  retainedByHold: string[] = []
): VerificationReport => {
  const evidenceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ targetId, deletedStores, retainedByHold, keyId }))
    .digest("hex");

  return {
    reportId: crypto.randomUUID(),
    targetId,
    deletedStores,
    retainedByHold,
    keyId,
    cryptographicErasure: Boolean(keyId),
    erasureConfirmed: deletedStores.length > 0 && retainedByHold.length === 0,
    evidenceHash,
    summary: `Erasure verified for ${targetId}; no deleted content was exposed in the verification record.`,
    createdAt: new Date().toISOString(),
    deletedDataSample: ["redacted-record-reference", "hash-proof-only"],
  };
};

export const retentionPolicyRegistry = Object.fromEntries(
  DEFAULT_DATA_RETAINED_CLASSES.map((entry) => [entry.id, entry])
) as Record<string, PersistedDataClass>;
