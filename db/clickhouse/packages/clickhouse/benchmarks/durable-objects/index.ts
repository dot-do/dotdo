/**
 * Durable Objects Benchmark Module
 *
 * Provides tools for benchmarking chdb-wasm on Cloudflare Durable Objects.
 *
 * @example
 * ```typescript
 * import { benchmarkDurableObjects, formatReportMarkdown } from './durable-objects';
 *
 * const results = await benchmarkDurableObjects({
 *   doUrl: 'https://clickbench-do-benchmark.your-subdomain.workers.dev',
 *   queries: [0, 1, 2, 3, 4],
 *   warmupRuns: 1,
 *   timedRuns: 3,
 * });
 *
 * console.log(formatReportMarkdown(generateReport(results, options, start, end)));
 * ```
 */

// Export Durable Object
export { BenchmarkDO } from './do';
export type {
  Env,
  ChdbInstance,
  DOQueryResult,
  BatchQueryRequest,
  BatchQueryResponse,
  HealthCheckResponse,
} from './do';

// Export benchmark runner
export {
  benchmarkDurableObjects,
  runBatchQueries,
  getHealthStatus,
  calculateStatistics,
  generateReport,
  formatReportMarkdown,
  testConcurrentAccess,
} from './benchmark';

export type {
  DOBenchmarkOptions,
  DOBenchmarkProgress,
  DOBenchmarkResult,
  QueryStatistics,
  DOBenchmarkReport,
} from './benchmark';
