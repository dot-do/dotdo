/**
 * ClickBench Benchmark Framework
 *
 * This module provides a complete benchmarking framework for testing
 * chdb-wasm query performance against ClickBench queries.
 *
 * @example
 * ```typescript
 * import { runBenchmarks, SIMPLE_TEST_QUERIES, formatResultsAsMarkdown } from './benchmarks';
 *
 * const results = await runBenchmarks({
 *   iterations: 5,
 *   timeoutMs: 30000,
 *   queries: SIMPLE_TEST_QUERIES,
 * });
 *
 * console.log(formatResultsAsMarkdown(results));
 * ```
 *
 * @packageDocumentation
 */

// Query definitions
export {
  CLICKBENCH_QUERIES,
  SIMPLE_TEST_QUERIES,
  getQueries,
  getQueriesByCategory,
  getQueryById,
  type BenchmarkQuery,
} from './queries';

// Result collection and formatting
export {
  ResultCollector,
  calculateTiming,
  calculateSummary,
  formatResultsAsJson,
  formatResultsAsMarkdown,
  type QueryTiming,
  type QueryBenchmarkResult,
  type BenchmarkResults,
  type BenchmarkSummary,
  type CategorySummary,
} from './results';

// Runner (for programmatic use)
export { runBenchmarks, type BenchmarkConfig } from './runner';
