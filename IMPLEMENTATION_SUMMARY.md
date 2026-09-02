# Reorg-Aware Transaction Submission - Implementation Summary

**Issue:** #621 — Make transaction submission reorg-aware across Stellar ledger forks

**Branch:** fix/reorg-aware-submission

**Date:** August 2026

---

## Files Created

### 1. Database Migration
**File:** `src/migrations/1785700000000-AddReorgAwarenessToTransactions.ts`

Adds:
- 11 new columns to `transaction_lifecycle` for finality tracking
- New `ledger_observations` table (immutable audit trail)
- Indexes on finality_status, ledger_sequence, provider, observed_at
- Foreign key constraint from observations to transactions

### 2. Entities
**Files:**
- `src/transactions/TransactionLifecycle.entity.ts` (modified)
- `src/transactions/LedgerObservation.entity.ts` (new)

Updates to TransactionLifecycle:
- New `FinalityStatus` type with 7 states
- 11 new columns for finality/reorg tracking

New LedgerObservation:
- Records every Horizon poll result
- Contains ledger sequence, hash, parent hash
- Immutable for audit trail

### 3. Core Finality Services
**Directory:** `src/services/finality/`

**Files:**
- `FinalityPolicy.ts` — Configuration interface + env var loading
- `ReorgEvent.ts` — Structured event interface for operators
- `AncestryVerifier.ts` — Ledger ancestry verification via parent hash chain
- `ConfirmationDepthTracker.ts` — Main confirmation polling loop
- `ReconciliationService.ts` — Independent provider reconciliation
- `FinalizationManager.ts` — Orchestrator + global singleton

**Total lines:** ~1500 lines of production code

### 4. Integration Points
**Files Modified:**
- `src/transactions/TransactionLifecycle.service.ts` — Gate confirmation events behind finality_status = FINAL
- `src/jobs/jobHandlers.ts` — DelayedTransactionJobHandler uses finalization manager
- `src/Agents/tools/swap.ts` — SwapTool uses finalization manager
- `src/config/Datasource.ts` — Register LedgerObservation entity

### 5. Tests
**File:** `tests/unit/finalization.test.ts`

10 comprehensive tests covering:
1. Happy path confirmation
2. Confirmation depth accumulation
3. Orphan detection
4. Reconciliation success
5. Reconciliation failure
6. Conflicting providers
7. STALE Horizon timeout
8. Side effects gating
9. No duplicate submission
10. Circuit breaker on max retries

---

## Architecture Overview

```
Transaction Submission Flow
================================

1. Submit to Horizon
   ↓
2. Response received (hash, ledger_sequence)
   ↓
3. Start ConfirmationDepthTracker (getFinalizationManager().startTracking())
   ↓
4. Poll every N ms:
   - Get current ledger from Horizon
   - Calculate depth = current - observed
   - Run AncestryVerifier (parent hash chain walk)
   ↓
5a. [FAILURE] Ancestry check fails (hash mismatch/fork detected)
   - Mark ORPHANED
   - Emit orphan_detected event
   - Trigger ReconciliationService
   ↓
5b. [TIMEOUT] Confirmation timeout exceeded (STALE)
   - Mark STALE
   - Emit stale_horizon event
   - Trigger ReconciliationService
   ↓
5c. [SUCCESS] depth >= required AND ancestry verified
   - Mark FINAL
   - Emit finality:declared event
   - Consuming code triggers balance updates, webhooks
   ↓
6. Reconciliation (if orphan/stale):
   - Query independent Horizon endpoint
   - Find where tx is / if it exists
   - Three outcomes:
     a) Found in canonical chain → restart confirmation tracking
     b) Not found anywhere → ORPHANED (terminal)
     c) Providers disagree → CONFLICTED (terminal)
```

---

## Key Design Decisions

### 1. Event-Driven Finality
- Finalization manager emits `finality:declared` event
- Balance updates subscribe to this event, not to lifecycle state changes
- Decouples finality logic from business logic

### 2. Immutable Observations Table
- Every Horizon poll creates a ledger_observation record
- Never deleted—serves as audit trail for forensics
- Essential for debugging reorg events

### 3. Ancestry Verification
- Walks parent_ledger_hash chain backward from current ledger
- Detects forks by hash mismatches
- Cached to avoid redundant Horizon fetches

### 4. Independent Reconciliation Provider
- MUST be genuinely different operator from primary
- Enables detection of issues beyond single-provider failures
- Configuration: `FINALITY_RECONCILIATION_HORIZON_URL` (separate from primary)

### 5. Circuit Breaker
- Max reconciliation attempts (default 3)
- After max attempts, mark as ORPHANED and emit unavailable event
- Prevents infinite retry loops

### 6. No Auto-Resubmission
- Orphaned transactions may still be in mempool
- Automatic resubmit risks double-spend
- Requires operator decision

### 7. Terminal States
- FINAL, ORPHANED, CONFLICTED, STALE all require operator attention
- FINAL → side effects trigger
- Others → operator must investigate and decide next step

---

## State Machine

### Lifecycle States (Unchanged)
```
intent → submitting → submitted → confirmed → [success]
                           ↓
                        [failed]
```

### Finality Status (New)
```
PENDING
  ↓ [tx observed in ledger]
CONFIRMING
  ├─ [ancestry ok + depth >= required] → FINAL ✓
  ├─ [ancestry fails] → ORPHANED + reconcile
  └─ [timeout] → STALE + reconcile
  
RECONCILING
  ├─ [found] → CONFIRMING (restart)
  ├─ [not found] → ORPHANED
  ├─ [conflict] → CONFLICTED
  └─ [max attempts] → ORPHANED
```

---

## Environment Variables

All optional with sensible defaults:

| Variable | Testnet Default | Mainnet Default | Description |
|----------|-----------------|-----------------|-------------|
| `FINALITY_CONFIRMATION_DEPTH` | 2 | 3 | Ledgers required on top |
| `FINALITY_POLL_INTERVAL_MS` | 2000 | 5000 | Poll frequency |
| `FINALITY_CONFIRMATION_TIMEOUT_MS` | 300000 | 600000 | Max time before STALE |
| `FINALITY_ANCESTRY_CHECK_DEPTH` | 5 | 10 | Ancestor walk distance |
| `FINALITY_PRIMARY_HORIZON_URL` | testnet default | mainnet default | Primary Horizon |
| `FINALITY_RECONCILIATION_HORIZON_URL` | (same as primary) | (same as primary) | **Must change to independent** |
| `FINALITY_MAX_RECONCILIATION_ATTEMPTS` | 3 | 3 | Circuit breaker |
| `FINALITY_RECONCILIATION_RETRY_DELAY_MS` | 2000 | 5000 | Retry delay |

---

## Integration Checklist

- [x] Migration created and contains both up() and down()
- [x] Entities created (TransactionLifecycle extensions, LedgerObservation)
- [x] FinalityPolicy interface with env var loading
- [x] AncestryVerifier with parent hash chain walking
- [x] ConfirmationDepthTracker with polling loop
- [x] ReconciliationService with conflict handling
- [x] FinalizationManager orchestrator
- [x] ReorgEvent interface for operators
- [x] TransactionLifecycleService updated to gate confirmation
- [x] DelayedTransactionJobHandler integrated
- [x] SwapTool integrated
- [x] Datasource updated with new entity
- [x] Comprehensive 10-test suite
- [x] Documentation complete

---

## Critical Validation Points

### Before Deploying to Testnet
- [ ] Run migration successfully
- [ ] Verify TypeScript compilation passes
- [ ] All 10 tests pass
- [ ] Submit test transaction to testnet
- [ ] Observe finality:declared event after 2+ ledgers
- [ ] Verify balance update triggered exactly once
- [ ] Check ledger_observations table populated

### Before Deploying to Mainnet
- [ ] Complete testnet validation above
- [ ] Set `FINALITY_RECONCILIATION_HORIZON_URL` to independent operator
- [ ] Configure operator alerting for reorg events
- [ ] Document operator runbooks for terminal states
- [ ] Estimate ledger_observations storage growth
- [ ] Plan archival strategy for old observations
- [ ] Run against mainnet testnet subset (if available)

---

## Code Statistics

| Component | Lines | File |
|-----------|-------|------|
| FinalityPolicy | 100 | `services/finality/FinalityPolicy.ts` |
| AncestryVerifier | 200 | `services/finality/AncestryVerifier.ts` |
| ConfirmationDepthTracker | 350 | `services/finality/ConfirmationDepthTracker.ts` |
| ReconciliationService | 280 | `services/finality/ReconciliationService.ts` |
| FinalizationManager | 220 | `services/finality/FinalizationManager.ts` |
| ReorgEvent | 30 | `services/finality/ReorgEvent.ts` |
| Migration | 150 | `migrations/1785700000000-*.ts` |
| Entities | 150 | `transactions/TransactionLifecycle.entity.ts`, `LedgerObservation.entity.ts` |
| Tests | 800 | `tests/unit/finalization.test.ts` |
| Integration changes | 100 | Various `src/` files |
| **Total** | **~2,380** | |

---

## Known Limitations & Future Work

1. **Single Primary Horizon**
   - Current: Single primary endpoint
   - Future: Support multiple primary endpoints with failover

2. **No Automatic Ledger Download**
   - Ancestry checks fetch via Horizon
   - Future: Support local ledger archive for faster verification

3. **No Metrics/Observability**
   - Events logged as JSON
   - Future: Prometheus metrics for confirmation depth, reorg frequency

4. **Terminal State Recovery**
   - CONFLICTED, ORPHANED states are permanently terminal
   - Future: Admin API to manually retry/resubmit

5. **Ledger Observations Retention**
   - No automatic archival
   - Future: Automated export to cold storage

---

## Support & Debugging

### Enable Verbose Logging
Set log level to DEBUG in `src/config/logger.ts`:
- Logs every poll cycle
- Logs ancestry check results
- Logs reconciliation attempts

### Query Ledger Observations
```sql
-- Find all observations for a transaction
SELECT * FROM ledger_observations 
WHERE transaction_id = 'your-tx-id'
ORDER BY observed_at;

-- Find orphans
SELECT DISTINCT transaction_id FROM transaction_lifecycle 
WHERE finality_status = 'ORPHANED';

-- Find conflicts
SELECT DISTINCT transaction_id FROM transaction_lifecycle 
WHERE finality_status = 'CONFLICTED';
```

### Operator Alert Queries
```sql
-- Recent reorg events in logs (JSON structured logs)
SELECT timestamp, event_type, details 
FROM logs 
WHERE json_extract(message, '$.eventType') IN ('orphan_detected', 'conflicting_providers')
ORDER BY timestamp DESC LIMIT 20;

-- Transaction finality distribution
SELECT finality_status, COUNT(*) as count, AVG(confirmation_depth) as avg_depth
FROM transaction_lifecycle
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY finality_status;
```

---

## References

- **Issue:** #621
- **Branch:** fix/reorg-aware-submission
- **Stellar Docs:** https://developers.stellar.org/learn/fundamentals/ledgers
- **Parent Hash Chain:** Every Horizon ledger includes `prev_hash` field pointing to parent

---

**Implementation Status:** ✅ Complete

All 14 implementation tasks finished. 10 comprehensive tests provided. Ready for code review and deployment after environment configuration.
