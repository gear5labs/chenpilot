## Summary

Implements deterministic resolution of conflicting portfolio balance values from multiple sources (on-chain, backend cache, bridge transfers). Every decision is recorded with full provenance for audit.

## Changes

### Core Module: src/domain/execution/portfolioResultsResolution.ts
- **compareBalances()** - Compares two balance sources, returns winner based on priority
- **resolveBalance()** - Resolves single asset with conflict detection (sub-stroop tolerance)  
- **resolvePortfolioBalances()** - Resolves entire portfolio across multiple sources
- **Source Priority** (deterministic): on_chain > bridge_transfer > backend_cache > inferred

### Tests: tests/unit/portfolioResultsResolution.test.ts
- 35+ assertions across 20+ test cases
- Success scenarios: single source, multiple agree, multiple conflict, cross-chain
- Failure cases: empty sources, precision loss, boundary conditions
- Determinism: priority consistency, repeatable resolution

### Documentation: docs/PORTFOLIO_RESULTS_RESOLUTION.md
- Problem statement and solution overview
- API reference with examples
- Failure cases and mitigations
- Backward and forward compatibility

## Acceptance Criteria Met

- ✅ Deterministic handling: on-chain always wins on conflict
- ✅ Provenance tracking: source, timestamp, conflict metadata on every resolution
- ✅ Automated tests: 35+ assertions, success/failure/boundary/determinism cases
- ✅ No breaking changes: backward compatible, fully additive
- ✅ Documentation: API reference with practical examples

## Key Features

- **On-Chain Authority**: On-chain always wins, even when cache shows higher/lower balance
- **Transparent Conflicts**: Conflicts recorded with full attribution (source, delta, reason)
- **Deterministic**: Same inputs always produce same output, no randomness
- **Extensible**: New sources can be added without breaking consumers
- **Precision**: 7 decimals (Stellar Stroop) consistently

Fixes: Portfolio results needed deterministic handling when balance sources conflict
