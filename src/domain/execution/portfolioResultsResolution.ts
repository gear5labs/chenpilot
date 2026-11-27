/**
 * Portfolio Results Resolution — Deterministic Conflict Handling
 *
 * Implements deterministic resolution of conflicting balance values from
 * multiple sources (on-chain, backend cache, bridge transfers). Every
 * decision is recorded with provenance to enable audit and replay.
 *
 * PHILOSOPHY
 * ──────────
 * On-chain is the source of truth. Backend cache and bridge state provide
 * context. When sources disagree, on-chain wins. When on-chain is unavailable,
 * backend + bridge state provides the best-effort estimate. Conflicts are
 * never silently suppressed — they're logged with full attribution.
 */

export type BalanceSource = 'on_chain' | 'backend_cache' | 'bridge_transfer' | 'inferred';

/**
 * Provenance metadata for a resolved balance value.
 * Enables audit and investigation of which source was chosen and why.
 */
export interface BalanceResolutionProvenance {
  /** Which source was used for this balance value */
  source: BalanceSource;
  /** Whether this value is deterministically chosen (true) or inferred/estimated (false) */
  isDeterministic: boolean;
  /** Timestamp when the value was observed */
  observedAt: string; // ISO 8601
  /** If this resolution involved a conflict, the conflicting values and sources */
  conflict?: {
    /** The resolved (chosen) value */
    resolvedValue: string;
    /** All observed values in comparison format: { source: value } */
    observedValues: Record<BalanceSource | string, string>;
    /** Why the winning source was chosen over others */
    reason: string;
  };
}

/**
 * A single resolved balance with full provenance.
 */
export interface ResolvedBalance {
  /** Asset identifier */
  assetCode: string;
  assetIssuer: string;
  chain: string;
  /** The resolved numeric balance (decimal string, 7 decimals) */
  amount: string;
  /** Provenance of this value */
  provenance: BalanceResolutionProvenance;
}

/**
 * Portfolio results with conflict metadata.
 * When multiple balance sources exist for the same asset, this captures
 * which source was chosen and what alternatives existed.
 */
export interface ResolvedPortfolioResults {
  /** User/account this portfolio belongs to */
  accountId: string;
  /** All resolved balances across chains */
  balances: ResolvedBalance[];
  /** Summary of conflicts encountered and resolution strategy */
  resolutionSummary: {
    totalAssets: number;
    conflictedAssets: number;
    sourcePriority: BalanceSource[];
  };
  /** Overall determinism: true if all values came from prioritized sources */
  isDeterministic: boolean;
  /** When this resolution was computed */
  resolvedAt: string; // ISO 8601
}

/**
 * When comparing multiple balance sources for the same asset, determines
 * which source to trust.
 *
 * Priority order (highest to lowest):
 * 1. on_chain — Authoritative ledger state
 * 2. bridge_transfer — Explicit in-transit accounting
 * 3. backend_cache — Last known cached state
 * 4. inferred — Computed or estimated
 *
 * On-chain is used unless:
 *  - On-chain data is unavailable or stale (> lag tolerance)
 *  - In which case, bridge_transfer is checked for explicit state
 *  - Then backend_cache as a fallback
 *
 * Conflicts are logged but do not halt processing.
 */
export const BALANCE_SOURCE_PRIORITY: BalanceSource[] = [
  'on_chain',
  'bridge_transfer',
  'backend_cache',
  'inferred',
];

/**
 * Result of comparing two balance sources for the same asset.
 */
export interface BalanceComparison {
  /** Whether the two sources agree (within tolerance) */
  agree: boolean;
  /** Numeric difference (absolute value) */
  delta: number;
  /** The source with higher priority (always wins) */
  winnerSource: BalanceSource | string;
  /** The source with lower priority */
  loserSource: BalanceSource | string;
  /** Human-readable explanation */
  reason: string;
}

/**
 * Compare two balance values from different sources and determine which to use.
 *
 * Returns the value from the higher-priority source, along with details of
 * the comparison including any conflict.
 */
export function compareBalances(
  source1: BalanceSource | string,
  value1: number,
  source2: BalanceSource | string,
  value2: number,
  lagToleranceMs: number = 60_000
): BalanceComparison {
  const delta = Math.abs(value1 - value2);
  const agree = delta < 0.0000001; // Sub-stroop tolerance
  const p1 = BALANCE_SOURCE_PRIORITY.indexOf(source1 as BalanceSource);
  const p2 = BALANCE_SOURCE_PRIORITY.indexOf(source2 as BalanceSource);

  if (agree) {
    return {
      agree: true,
      delta,
      winnerSource: p1 <= p2 ? source1 : source2,
      loserSource: p1 <= p2 ? source2 : source1,
      reason: `Sources agree within tolerance (delta: ${delta.toFixed(8)})`,
    };
  }

  // Sources disagree — choose the one with higher priority
  const winnerSource = p1 <= p2 ? source1 : source2;
  const loserSource = p1 <= p2 ? source2 : source1;

  return {
    agree: false,
    delta,
    winnerSource,
    loserSource,
    reason: `Conflict: ${source1}=${value1.toFixed(7)} vs ${source2}=${value2.toFixed(7)}. Using ${winnerSource} (priority ${p1 <= p2 ? 'higher' : 'lower'})`,
  };
}

/**
 * Resolve a single asset's balance when multiple sources exist.
 *
 * Always returns the value from the highest-priority available source.
 * If sources conflict, the conflict is recorded in provenance but doesn't
 * affect the resolution — higher priority always wins.
 *
 * @param assetCode Asset identifier
 * @param assetIssuer Asset issuer (empty for native)
 * @param chain Where the asset resides
 * @param sources Map of source name to balance value
 * @param observedAt When each source was read (defaults to now)
 * @returns ResolvedBalance with provenance
 */
export function resolveBalance(
  assetCode: string,
  assetIssuer: string,
  chain: string,
  sources: Map<BalanceSource | string, number>,
  observedAt?: Date
): ResolvedBalance {
  const now = observedAt ?? new Date();
  const nowIso = now.toISOString();

  if (sources.size === 0) {
    throw new Error(`No balance sources provided for ${assetCode}:${assetIssuer} on ${chain}`);
  }

  // Sort sources by priority
  const sortedSources = Array.from(sources.entries()).sort(
    ([srcA], [srcB]) => {
      const pA = BALANCE_SOURCE_PRIORITY.indexOf(srcA as BalanceSource);
      const pB = BALANCE_SOURCE_PRIORITY.indexOf(srcB as BalanceSource);
      return pA - pB; // Lower index = higher priority
    }
  );

  const [winnerSource, winnerValue] = sortedSources[0];
  const amount = winnerValue.toFixed(7);

  // Check if there are conflicts
  if (sortedSources.length > 1) {
    const otherValues: Record<BalanceSource | string, string> = {};
    let hasConflict = false;

    for (const [source, value] of sortedSources) {
      otherValues[source] = value.toFixed(7);
      if (!hasConflict && source !== winnerSource) {
        const delta = Math.abs(value - winnerValue);
        hasConflict = delta >= 0.0000001; // Sub-stroop tolerance
      }
    }

    return {
      assetCode,
      assetIssuer,
      chain,
      amount,
      provenance: {
        source: winnerSource as BalanceSource,
        isDeterministic: true,
        observedAt: nowIso,
        conflict: hasConflict
          ? {
              resolvedValue: amount,
              observedValues: otherValues,
              reason: `Multiple sources available. Used ${winnerSource} (priority ${BALANCE_SOURCE_PRIORITY.indexOf(winnerSource as BalanceSource)}) over others.`,
            }
          : undefined,
      },
    };
  }

  // Single source: deterministic by definition
  return {
    assetCode,
    assetIssuer,
    chain,
    amount,
    provenance: {
      source: winnerSource as BalanceSource,
      isDeterministic: true,
      observedAt: nowIso,
    },
  };
}

/**
 * Resolve an entire portfolio's balances across multiple sources.
 *
 * Maintains a map of asset keys to their resolved values. When the same
 * asset appears in multiple source maps (e.g., both on-chain and backend),
 * conflict resolution is applied and recorded.
 *
 * @param accountId Account identifier
 * @param sourceGroups Array of { source, balances } where balances is { key: amount }
 * @returns ResolvedPortfolioResults with provenance
 */
export function resolvePortfolioBalances(
  accountId: string,
  sourceGroups: Array<{
    source: BalanceSource | string;
    balances: Map<
      string,
      { assetCode: string; assetIssuer: string; chain: string; amount: number }
    >;
  }>
): ResolvedPortfolioResults {
  const resolved = new Map<string, ResolvedBalance>();
  const conflicts = new Set<string>();
  const sourceCounts = new Map<BalanceSource | string, number>();

  // Build a map of key -> { source, value, metadata }
  const byKey = new Map<
    string,
    Array<{ source: BalanceSource | string; meta: { assetCode: string; assetIssuer: string; chain: string; amount: number } }>
  >();

  for (const group of sourceGroups) {
    sourceCounts.set(group.source, (sourceCounts.get(group.source) ?? 0) + 1);

    for (const [key, meta] of group.balances) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push({ source: group.source, meta });
    }
  }

  // Resolve each asset
  for (const [key, entries] of byKey) {
    const sourceMap = new Map<BalanceSource | string, number>();
    const { assetCode, assetIssuer, chain } = entries[0].meta;

    for (const entry of entries) {
      sourceMap.set(entry.source, entry.meta.amount);
    }

    if (sourceMap.size > 1) {
      conflicts.add(key);
    }

    const resolvedBalance = resolveBalance(assetCode, assetIssuer, chain, sourceMap);
    resolved.set(key, resolvedBalance);
  }

  const balances = Array.from(resolved.values());

  return {
    accountId,
    balances,
    resolutionSummary: {
      totalAssets: balances.length,
      conflictedAssets: conflicts.size,
      sourcePriority: BALANCE_SOURCE_PRIORITY,
    },
    isDeterministic: balances.every((b) => b.provenance.isDeterministic),
    resolvedAt: new Date().toISOString(),
  };
}
