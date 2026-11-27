# PR Creation Instructions

## Branch Information
- **Branch Name**: `feat/deterministic-portfolio-results`
- **Base Branch**: `master`
- **Commits**: 1 commit with all changes
- **Commit Hash**: 136a46c

## PR Title
```
Portfolio balance source conflict resolution with deterministic handling and provenance
```

## PR Body
```
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
```

## Files Changed

| File | Status | Lines |
|------|--------|-------|
| src/domain/execution/portfolioResultsResolution.ts | Added | 280 |
| tests/unit/portfolioResultsResolution.test.ts | Added | 530+ |
| docs/PORTFOLIO_RESULTS_RESOLUTION.md | Added | 100+ |

## How to Create the PR

### Option 1: Using GitHub Web UI
1. Go to https://github.com/[your-repo]
2. You should see a prompt to create a PR for `feat/deterministic-portfolio-results`
3. Click "Compare & pull request"
4. Set base to `master`, compare to `feat/deterministic-portfolio-results`
5. Copy the PR Title and Body from above
6. Submit

### Option 2: Using GitHub CLI (if installed)
```bash
gh pr create \
  --base master \
  --head feat/deterministic-portfolio-results \
  --title "Portfolio balance source conflict resolution with deterministic handling and provenance" \
  --body-file .github/pr-body.md
```

### Option 3: Manual git workflow
The branch is already pushed to origin at: `origin/feat/deterministic-portfolio-results`

## Verification

Branch details:
```
$ git branch -vv
* feat/deterministic-portfolio-results 136a46c [origin/feat/deterministic-portfolio-results] feat: deterministic portfolio balance source conflict resolution with provenance
```

Commit details:
```
$ git show --name-status 136a46c
A	docs/PORTFOLIO_RESULTS_RESOLUTION.md
A	src/domain/execution/portfolioResultsResolution.ts
A	tests/unit/portfolioResultsResolution.test.ts
```

## Notes

- Branch is **NOT** against your own fork (created from main repo)
- All files staged and committed properly
- Ready for immediate PR creation
- No breaking changes to existing code
- Fully tested with 35+ assertions
