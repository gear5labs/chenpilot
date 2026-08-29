import { describe, it, expect } from "@jest/globals";
import {
  validateDataRetentionCatalog,
  getDataRetentionPolicy,
  deletePersistedData,
  createVerificationReport,
  resolveEncryptionKey,
} from "../dataRetentionPolicy";

describe("data retention policy", () => {
  it("classifies persisted data with owner, purpose, and retention period", () => {
    const policy = getDataRetentionPolicy("conversation_transcripts");
    expect(policy).toBeDefined();
    expect(policy?.owner).toBe("support-platform");
    expect(policy?.purpose).toContain("support");
    expect(policy?.retentionPeriod).toBe(30);
    expect(policy?.retentionUnit).toBe("days");
  });

  it("validates that every persisted data class has required metadata", () => {
    const result = validateDataRetentionCatalog();
    expect(result.valid).toBe(true);
    expect(result.invalid).toEqual([]);
  });

  it("propagates deletion to cache, export, and derived stores", () => {
    const result = deletePersistedData("data_exports", {
      subjectId: "export-123",
      tenantId: "tenant-42",
      userId: "user-9",
      requestedBy: "privacy-automation",
      reason: "retention expired",
    });

    expect(result.allowed).toBe(true);
    expect(result.deletedStores).toContain("export_bucket");
    expect(result.verification.erasureConfirmed).toBe(true);
    expect(result.verification.deletedDataSample).toEqual([
      "redacted-subject-reference",
      "hash-proof-only",
    ]);
  });

  it("respects legal and audit holds and reports them without exposing data", () => {
    const result = deletePersistedData("audit_payloads", {
      subjectId: "audit-77",
      tenantId: "tenant-42",
      legalHolds: [{
        id: "hold-1",
        reason: "litigation hold",
        scope: "legal",
        owner: "legal",
        createdAt: new Date().toISOString(),
        narrowScope: ["audit_payloads"],
      }],
    });

    expect(result.allowed).toBe(false);
    expect(result.retainedByHold).toContain("hold-1");
    expect(result.verification.summary).toContain("blocked");
    expect(result.verification.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses per-user or per-tenant key ids for cryptographic erasure", () => {
    expect(resolveEncryptionKey("per-user", "user-9", "tenant-42", "user-key")).toContain("user:user-9");
    expect(resolveEncryptionKey("per-tenant", "user-9", "tenant-42", "tenant-key")).toContain("tenant:tenant-42");
  });

  it("creates a verification report without exposing deleted payloads", () => {
    const report = createVerificationReport("user-9", ["primary-db", "redis-cache"], "tenant:user-9:key");
    expect(report.erasureConfirmed).toBe(true);
    expect(report.deletedDataSample).toContain("hash-proof-only");
    expect(report.summary).toContain("no deleted content was exposed");
  });
});
