# Operations and Observability Boundaries (#1083, #1084, #1085)

## Overview

This specification establishes operational and observability boundaries for Chen Pilot across service health probing, metric cardinality constraints, and security audit log retention/export policies.

---

## 1. Readiness vs. Liveness Probing (#1083)

### Core Mechanics
- **Liveness Probe (`GET /health`)**:
  - Always returns HTTP 200 `{ "status": "UP", "timestamp": "<ISO8601>" }` as long as the Node.js event loop and HTTP server are responsive.
  - Does NOT evaluate downstream dependencies (PostgreSQL, Redis, Horizon, Soroban RPC).
  - Guarantees container orchestrators (Kubernetes, Docker Swarm) will not restart healthy application processes during transient database or external service outages, preventing restart loops.

- **Readiness Probe (`GET /ready`)**:
  - Executes comprehensive dependency health checks via `healthService.getFullReport()`.
  - Evaluates individual dependency status (`UP`, `DEGRADED`, `DOWN`), measured latencies, and error details.
  - If any critical dependency (PostgreSQL or Redis) is `DOWN`, returns HTTP 503 `{ "overallStatus": "UNHEALTHY", ... }`.
  - If all critical dependencies are operational or non-critical dependencies are degraded, returns HTTP 200 `{ "overallStatus": "HEALTHY" | "DEGRADED", ... }`.
  - Service traffic routers (ingress, load balancers) remove instances reporting 503 from active routing while keeping the processes running.

---

## 2. Cardinality Limits on Workflow and Asset Metrics (#1084)

### Problem
Prometheus/OpenTelemetry metric labels containing high-cardinality values (e.g., raw wallet addresses, user UUIDs, transaction hashes, arbitrary contract addresses, or execution IDs) cause exponential time-series growth, exhausting collector memory and degrading query performance.

### Invariant & Cardinality Policy
- **Prohibited Labels**:
  - `user_id`, `wallet_address`, `account_id`
  - `tx_hash`, `ledger_sequence`, `operation_id`
  - `correlation_id`, `raw_payload`, `workflow_uuid`
- **Allowed Bounded Labels**:
  - `workflow_class`: `[swap, bridge, lending, staking, arbitrage, admin]`
  - `asset_tier`: `[native_xlm, tier1_usdc, tier2_major, other_custom]`
  - `status`: `[success, failed, rejected, timeout, rate_limited]`
  - `network`: `[mainnet, testnet, futurenet]`
  - `protocol`: `[blend, phoenix, aquarius, soroswap]`
- **Enforcement**:
  - Label sanitizers automatically map arbitrary asset strings into predefined asset tiers.
  - Workflow metrics aggregate solely by workflow type and disposition, stripping individual instance IDs.

---

## 3. Audit Log Retention and Export Verification (#1085)

### Retention Policy
- Default retention window is **90 days** (configurable via `AUDIT_RETENTION_DAYS`).
- Scheduled cleanup runs via `auditLogService.deleteOldLogs(daysToKeep)` to prune expired records.
- In-progress investigations or legal hold records can be flagged to prevent automated deletion.

### Export Contract & Pagination
- Audit logs are exportable via `GET /api/audit` and `GET /api/audit/security-events`.
- Strict cursor- or offset-based pagination (`limit`, `offset`/`cursor`) prevents out-of-memory errors on large audit queries.
- Export formats support structured JSON and CSV representations.

### Tamper-Evident Integrity Evidence
- Each audit event records an SHA-256 payload hash and chains to the previous event's hash (`prev_hash`).
- Integrity verification endpoint `GET /api/audit/chain/verify` validates cryptographic continuity across historical records.
- Deleted or pruned records are recorded in a high-level pruning tombstone ledger to maintain proof of non-tampering.
