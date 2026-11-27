import {
  compareBalances,
  resolveBalance,
  resolvePortfolioBalances,
  BALANCE_SOURCE_PRIORITY,
  BalanceSource,
  BalanceComparison,
  ResolvedBalance,
  ResolvedPortfolioResults,
} from '../../src/domain/execution/portfolioResultsResolution';

describe('Portfolio Results Resolution', () => {
  describe('compareBalances', () => {
    it('returns agree=true when sources have identical values', () => {
      const result = compareBalances('on_chain', 100.5, 'backend_cache', 100.5);

      expect(result.agree).toBe(true);
      expect(result.delta).toBeLessThan(0.0000001);
      expect(result.winnerSource).toBe('on_chain'); // Higher priority
    });

    it('returns agree=true for values within sub-stroop tolerance', () => {
      const result = compareBalances('on_chain', 100.5, 'backend_cache', 100.50000001);

      expect(result.agree).toBe(true);
      expect(result.delta).toBeLessThan(0.0000001);
    });

    it('returns agree=false when values differ beyond tolerance', () => {
      const result = compareBalances('on_chain', 100.5, 'backend_cache', 99.5);

      expect(result.agree).toBe(false);
      expect(result.delta).toBe(1.0);
    });

    it('chooses on_chain over backend_cache on conflict', () => {
      const result = compareBalances('backend_cache', 99.5, 'on_chain', 100.5);

      expect(result.winnerSource).toBe('on_chain');
      expect(result.loserSource).toBe('backend_cache');
      expect(result.reason).toContain('priority');
    });

    it('respects priority order: on_chain > bridge_transfer > backend_cache > inferred', () => {
      const priorities = BALANCE_SOURCE_PRIORITY;

      expect(priorities).toEqual(['on_chain', 'bridge_transfer', 'backend_cache', 'inferred']);
    });
  });

  describe('resolveBalance', () => {
    it('returns single source directly when only one source exists', () => {
      const sources = new Map<BalanceSource | string, number>([['on_chain', 100.5]]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.amount).toBe('100.5000000');
      expect(resolved.provenance.source).toBe('on_chain');
      expect(resolved.provenance.isDeterministic).toBe(true);
      expect(resolved.provenance.conflict).toBeUndefined();
    });

    it('chooses highest priority source when multiple agree', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['backend_cache', 100.5],
        ['on_chain', 100.5],
        ['inferred', 100.5],
      ]);
      const resolved = resolveBalance('USDC', 'issuer1', 'stellar', sources);

      expect(resolved.amount).toBe('100.5000000');
      expect(resolved.provenance.source).toBe('on_chain');
      expect(resolved.provenance.isDeterministic).toBe(true);
    });

    it('detects and records conflict when sources disagree', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['backend_cache', 99.5],
        ['on_chain', 100.5],
      ]);
      const resolved = resolveBalance('USDC', 'issuer1', 'stellar', sources);

      expect(resolved.amount).toBe('100.5000000');
      expect(resolved.provenance.source).toBe('on_chain');
      expect(resolved.provenance.conflict).toBeDefined();
      expect(resolved.provenance.conflict?.resolvedValue).toBe('100.5000000');
      expect(resolved.provenance.conflict?.observedValues['on_chain']).toBe('100.5000000');
      expect(resolved.provenance.conflict?.observedValues['backend_cache']).toBe('99.5000000');
      expect(resolved.provenance.conflict?.reason).toContain('priority');
    });

    it('does not record conflict when sources agree within tolerance', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['backend_cache', 100.50000001],
        ['on_chain', 100.5],
      ]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.provenance.conflict).toBeUndefined();
    });

    it('formats amounts to 7 decimals', () => {
      const sources = new Map<BalanceSource | string, number>([['on_chain', 123.456789123]]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.amount).toBe('123.4567891');
    });

    it('records observedAt timestamp when provided', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const sources = new Map<BalanceSource | string, number>([['on_chain', 100.5]]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources, now);

      expect(resolved.provenance.observedAt).toBe('2024-01-15T12:00:00.000Z');
    });

    it('throws when sources map is empty', () => {
      const sources = new Map<BalanceSource | string, number>();

      expect(() => resolveBalance('XLM', '', 'stellar', sources)).toThrow(
        'No balance sources provided'
      );
    });

    it('handles three sources with varying disagreement', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['backend_cache', 50.0],
        ['bridge_transfer', 100.5],
        ['on_chain', 100.5],
      ]);
      const resolved = resolveBalance('USDC', 'issuer1', 'stellar', sources);

      expect(resolved.amount).toBe('100.5000000');
      expect(resolved.provenance.source).toBe('on_chain');
      expect(resolved.provenance.conflict).toBeDefined();
      expect(Object.keys(resolved.provenance.conflict?.observedValues ?? {})).toHaveLength(3);
    });
  });

  describe('resolvePortfolioBalances', () => {
    it('resolves single source group directly', () => {
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.5 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sources);

      expect(result.accountId).toBe('acc123');
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0].amount).toBe('100.5000000');
      expect(result.resolutionSummary.totalAssets).toBe(1);
      expect(result.resolutionSummary.conflictedAssets).toBe(0);
      expect(result.isDeterministic).toBe(true);
    });

    it('detects conflicts across source groups', () => {
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.5 },
            ],
          ]),
        },
        {
          source: 'backend_cache' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 99.5 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sources);

      expect(result.balances[0].provenance.conflict).toBeDefined();
      expect(result.resolutionSummary.conflictedAssets).toBe(1);
      expect(result.balances[0].amount).toBe('100.5000000');
    });

    it('resolves multiple distinct assets independently', () => {
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.0 },
            ],
            [
              'stellar:USDC:issuer1',
              { assetCode: 'USDC', assetIssuer: 'issuer1', chain: 'stellar', amount: 50.0 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sources);

      expect(result.balances).toHaveLength(2);
      expect(result.resolutionSummary.totalAssets).toBe(2);
      expect(result.resolutionSummary.conflictedAssets).toBe(0);
    });

    it('records resolution timestamp', () => {
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.5 },
            ],
          ]),
        },
      ];

      const before = new Date();
      const result = resolvePortfolioBalances('acc123', sources);
      const after = new Date();

      const resolvedAt = new Date(result.resolvedAt);
      expect(resolvedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(resolvedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('handles empty source groups', () => {
      const result = resolvePortfolioBalances('acc123', []);

      expect(result.balances).toHaveLength(0);
      expect(result.resolutionSummary.totalAssets).toBe(0);
      expect(result.isDeterministic).toBe(true);
    });

    it('chooses on_chain even when backend_cache shows higher balance', () => {
      // Simulates a scenario where backend cache inflated the balance
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 50.0 },
            ],
          ]),
        },
        {
          source: 'backend_cache' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 150.0 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sources);

      expect(result.balances[0].amount).toBe('50.0000000');
      expect(result.balances[0].provenance.source).toBe('on_chain');
    });

    it('detects multiple conflicts when multiple assets disagree', () => {
      const sources = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.0 },
            ],
            [
              'stellar:USDC:issuer1',
              { assetCode: 'USDC', assetIssuer: 'issuer1', chain: 'stellar', amount: 50.0 },
            ],
          ]),
        },
        {
          source: 'backend_cache' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 99.0 },
            ],
            [
              'stellar:USDC:issuer1',
              { assetCode: 'USDC', assetIssuer: 'issuer1', chain: 'stellar', amount: 49.0 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sources);

      expect(result.resolutionSummary.conflictedAssets).toBe(2);
      expect(result.balances[0].provenance.conflict).toBeDefined();
      expect(result.balances[1].provenance.conflict).toBeDefined();
    });
  });

  describe('failure and boundary conditions', () => {
    it('handles precision loss from floating-point arithmetic', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in floating-point
      const sources = new Map<BalanceSource | string, number>([
        ['on_chain', 0.1 + 0.2],
        ['backend_cache', 0.3],
      ]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      // Should recognize these as agreeing within tolerance
      expect(resolved.provenance.conflict).toBeUndefined();
    });

    it('handles zero balances', () => {
      const sources = new Map<BalanceSource | string, number>([['on_chain', 0.0]]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.amount).toBe('0.0000000');
      expect(resolved.provenance.isDeterministic).toBe(true);
    });

    it('handles very large numbers', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['on_chain', 1000000000.5],
      ]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.amount).toBe('1000000000.5000000');
    });

    it('handles native asset (empty issuer)', () => {
      const sources = new Map<BalanceSource | string, number>([['on_chain', 100.0]]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.assetIssuer).toBe('');
      expect(resolved.amount).toBe('100.0000000');
    });

    it('handles cross-chain asset with long issuer', () => {
      const issuer = 'GBRPYHIL2CI3FV4BMSXIMC5IXBQDGPTZSBVVXUTKH2DCYHUBDDPVT4DJ4';
      const sources = new Map<BalanceSource | string, number>([['on_chain', 100.0]]);
      const resolved = resolveBalance('USDC', issuer, 'stellar', sources);

      expect(resolved.assetIssuer).toBe(issuer);
      expect(resolved.assetCode).toBe('USDC');
    });
  });

  describe('determinism', () => {
    it('marks result deterministic when all sources are from priority list', () => {
      const sources = new Map<BalanceSource | string, number>([
        ['on_chain', 100.0],
        ['backend_cache', 100.0],
      ]);
      const resolved = resolveBalance('XLM', '', 'stellar', sources);

      expect(resolved.provenance.isDeterministic).toBe(true);
    });

    it('portfolio result is deterministic when all balances are deterministic', () => {
      const sourceGroups = [
        {
          source: 'on_chain' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.0 },
            ],
          ]),
        },
        {
          source: 'backend_cache' as BalanceSource,
          balances: new Map([
            [
              'stellar:XLM:',
              { assetCode: 'XLM', assetIssuer: '', chain: 'stellar', amount: 100.0 },
            ],
          ]),
        },
      ];
      const result = resolvePortfolioBalances('acc123', sourceGroups);

      expect(result.isDeterministic).toBe(true);
    });

    it('source priority is consistent across calls', () => {
      const sources1 = new Map<BalanceSource | string, number>([
        ['inferred', 100.0],
        ['backend_cache', 100.0],
        ['on_chain', 100.0],
      ]);
      const resolved1 = resolveBalance('XLM', '', 'stellar', sources1);

      const sources2 = new Map<BalanceSource | string, number>([
        ['on_chain', 100.0],
        ['backend_cache', 100.0],
        ['inferred', 100.0],
      ]);
      const resolved2 = resolveBalance('XLM', '', 'stellar', sources2);

      expect(resolved1.provenance.source).toBe(resolved2.provenance.source);
      expect(resolved1.provenance.source).toBe('on_chain');
    });
  });
});
