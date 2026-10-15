// src/Agents/benchmarks/plannerBenchmarks.ts

export interface PlannerBenchmarkCase {
  input: string;
  expectedIntent: string;
  category: 'standard' | 'typo' | 'shorthand';
}

export const PLANNER_BENCHMARK_SUITE: PlannerBenchmarkCase[] = [
  {
    input: 'Fetch user transaction history',
    expectedIntent: 'fetch_transactions',
    category: 'standard',
  },
  {
    input: 'Check user bal and tx history',
    expectedIntent: 'fetch_balance_and_transactions',
    category: 'shorthand',
  },
  {
    input: 'Get tranaction reciept for payment',
    expectedIntent: 'fetch_transaction_receipt',
    category: 'typo',
  },
];