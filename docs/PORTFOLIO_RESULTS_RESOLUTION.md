# Portfolio Results Resolution

## Overview

Portfolio results require deterministic handling when balance sources return conflicting values. This document defines the supported behavior, failure cases, and compatibility requirements.

## Problem Statement

Portfolios can receive balance data from multiple sources:
- **On-chain**: Authoritative ledger state (Horizon, StarkNet RPC, etc.)
- **Backend cache**: Last known cached state from the database
- **Bridge transfers**: Explicit in-transit accounting for cross-chain movements
- **Inferred**: Computed or estimated values

When these sources disagree, resolution must be deterministic, with full provenance tracking.

## Solution: Deterministic Conflict Resolution

### Source Priority

Sources are ranked by authoritativeness:

```
1. on_chain        — Authoritative ledger state
2. bridge_transfer — Explicit transfer state management
3. backend_cache   — Last known cached value
4. inferred        — Computed or estimated
```

When multiple sources exist for the same asset, the **highest priority source always wins**. This ensures:
- Deterministic results (no randomness or race conditions)
- Conflicts are recorded with full provenance
- On-chain is authoritative even when cache shows higher or lower balance

### Conflict Detection

A conflict occurs when multiple sources for the same asset disagree by more than sub-stroop tolerance (0.0000001):

```typescript
const delta = Math.abs(value1 - value2);
const conflict = delta >= 0.0000001; // Sub-stroop tolerance
```

When a conflict is detected, it is recorded in the provenance.

### API: resolveBalance

Resolves a single asset's balance when multiple sources exist.

```typescript
function resolveBalance(
  assetCode: string,
  assetIssuer: string,
  chain: string,
  sources: Map<BalanceSource | string, number>,
  observedAt?: Date
): ResolvedBalance
```

### API: resolvePortfolioBalances

Resolves an entire portfolio's balances across multiple sources.

```typescript
function resolvePortfolioBalances(
  accountId: string,
  sourceGroups: Array<{
    source: BalanceSource | string;
    balances: Map<string, AssetMetadata>;
  }>
): ResolvedPortfolioResults
```

## Failure Cases

### Empty sources → throws error
### Precision beyond 7 decimals → truncates
### Negative/NaN → validated at source level
### Cross-chain assets → resolved independently
### Multiple conflicts → highest priority wins, conflict recorded

## Backward Compatibility

- Existing code continues to work (amount still returned)
- Provenance is optional for consumers
- Conflict metadata available but not required

## See Also

- `bridgeAccountingModel.ts` — Cross-chain transfer accounting
- `portfolioService.ts` — Main portfolio calculation entry point
- `reconciliation.service.ts` — Drift detection and reporting
- `portfolioReconciliation.ts` — Conflict surfacing to consumers
