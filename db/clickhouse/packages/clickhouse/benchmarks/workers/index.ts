/**
 * Cloudflare Workers Benchmark Module
 *
 * Provides tools for benchmarking chdb-wasm on Cloudflare Workers.
 *
 * @example
 * ```typescript
 * import { benchmarkWorkers, formatWorkersResults } from './workers';
 *
 * const results = await benchmarkWorkers(
 *   'https://clickbench-benchmark.workers.dev',
 *   [0, 1, 2, 3]
 * );
 *
 * console.log(formatWorkersResults(results));
 * ```
 */

// Export main benchmark function
export {
  benchmarkWorkers,
  benchmarkWorkersAdvanced,
  benchmarkWorkersMultiRegion,
  formatWorkersResults,
  generateWorkersSummary,
  runWorkersBenchmarkCli,
  type WorkersBenchmarkOptions,
  type WorkersBenchmarkProgress,
  type WorkersBenchmarkResult,
  type WorkersBenchmarkSummary,
} from './benchmark';

// Re-export worker for reference (not typically imported directly)
export type { Env as WorkerEnv } from './worker';
