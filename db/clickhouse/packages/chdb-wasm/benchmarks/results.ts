/**
 * Result collection and formatting for benchmark runs.
 */

import type { BenchmarkQuery } from './queries';

/**
 * Timing statistics for a single query.
 */
export interface QueryTiming {
  /** First execution time in milliseconds (cold run) */
  coldMs: number;
  /** Average of subsequent runs in milliseconds (warm runs) */
  warmAvgMs: number;
  /** Minimum execution time across all runs */
  minMs: number;
  /** Maximum execution time across all runs */
  maxMs: number;
  /** 50th percentile (median) */
  p50Ms: number;
  /** 95th percentile */
  p95Ms: number;
  /** Standard deviation */
  stdDevMs: number;
  /** Number of runs completed */
  runCount: number;
  /** All individual run times */
  allRunsMs: number[];
}

/**
 * Result of a single query benchmark.
 */
export interface QueryBenchmarkResult {
  /** Query definition */
  query: BenchmarkQuery;
  /** Timing statistics */
  timing: QueryTiming | null;
  /** Whether the query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of rows returned (if available) */
  rowCount?: number;
  /** Result size in bytes (if available) */
  resultSizeBytes?: number;
}

/**
 * Complete benchmark run results.
 */
export interface BenchmarkResults {
  /** Timestamp when benchmark started */
  startedAt: string;
  /** Timestamp when benchmark completed */
  completedAt: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Number of iterations per query */
  iterations: number;
  /** Timeout per query in milliseconds */
  timeoutMs: number;
  /** Whether using ClickBench data or simple test data */
  usingClickBenchData: boolean;
  /** Environment information */
  environment: {
    platform: string;
    nodeVersion?: string;
    wasmRuntime?: string;
  };
  /** Individual query results */
  queries: QueryBenchmarkResult[];
  /** Summary statistics */
  summary: BenchmarkSummary;
}

/**
 * Summary statistics across all queries.
 */
export interface BenchmarkSummary {
  /** Total queries run */
  totalQueries: number;
  /** Successful queries */
  successfulQueries: number;
  /** Failed queries */
  failedQueries: number;
  /** Timed out queries */
  timedOutQueries: number;
  /** Average cold run time */
  avgColdMs: number;
  /** Average warm run time */
  avgWarmMs: number;
  /** Total execution time (sum of all queries) */
  totalExecutionMs: number;
  /** Results by category */
  byCategory: Record<string, CategorySummary>;
}

/**
 * Summary for a query category.
 */
export interface CategorySummary {
  count: number;
  successful: number;
  avgColdMs: number;
  avgWarmMs: number;
}

/**
 * Calculate timing statistics from an array of run times.
 */
export function calculateTiming(runTimes: number[]): QueryTiming {
  if (runTimes.length === 0) {
    throw new Error('Cannot calculate timing from empty array');
  }

  const sorted = [...runTimes].sort((a, b) => a - b);
  const coldMs = runTimes[0];
  const warmRuns = runTimes.slice(1);
  const warmAvgMs = warmRuns.length > 0
    ? warmRuns.reduce((a, b) => a + b, 0) / warmRuns.length
    : coldMs;

  const minMs = sorted[0];
  const maxMs = sorted[sorted.length - 1];
  const p50Ms = percentile(sorted, 50);
  const p95Ms = percentile(sorted, 95);

  const mean = runTimes.reduce((a, b) => a + b, 0) / runTimes.length;
  const variance = runTimes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / runTimes.length;
  const stdDevMs = Math.sqrt(variance);

  return {
    coldMs,
    warmAvgMs,
    minMs,
    maxMs,
    p50Ms,
    p95Ms,
    stdDevMs,
    runCount: runTimes.length,
    allRunsMs: runTimes,
  };
}

/**
 * Calculate percentile from a sorted array.
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0];

  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedArr.length) return sortedArr[sortedArr.length - 1];
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

/**
 * Calculate summary statistics from query results.
 */
export function calculateSummary(results: QueryBenchmarkResult[]): BenchmarkSummary {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const timedOut = results.filter(r => r.error?.includes('timeout') || r.error?.includes('Timeout'));

  const successfulTimings = successful.filter(r => r.timing);

  const avgColdMs = successfulTimings.length > 0
    ? successfulTimings.reduce((sum, r) => sum + (r.timing?.coldMs ?? 0), 0) / successfulTimings.length
    : 0;

  const avgWarmMs = successfulTimings.length > 0
    ? successfulTimings.reduce((sum, r) => sum + (r.timing?.warmAvgMs ?? 0), 0) / successfulTimings.length
    : 0;

  const totalExecutionMs = successfulTimings.reduce(
    (sum, r) => sum + (r.timing?.allRunsMs.reduce((a, b) => a + b, 0) ?? 0),
    0
  );

  // Calculate by category
  const categories = new Set(results.map(r => r.query.category));
  const byCategory: Record<string, CategorySummary> = {};

  for (const category of categories) {
    const categoryResults = results.filter(r => r.query.category === category);
    const categorySuccessful = categoryResults.filter(r => r.success && r.timing);

    byCategory[category] = {
      count: categoryResults.length,
      successful: categorySuccessful.length,
      avgColdMs: categorySuccessful.length > 0
        ? categorySuccessful.reduce((sum, r) => sum + (r.timing?.coldMs ?? 0), 0) / categorySuccessful.length
        : 0,
      avgWarmMs: categorySuccessful.length > 0
        ? categorySuccessful.reduce((sum, r) => sum + (r.timing?.warmAvgMs ?? 0), 0) / categorySuccessful.length
        : 0,
    };
  }

  return {
    totalQueries: results.length,
    successfulQueries: successful.length,
    failedQueries: failed.length,
    timedOutQueries: timedOut.length,
    avgColdMs,
    avgWarmMs,
    totalExecutionMs,
    byCategory,
  };
}

/**
 * Format results as JSON string.
 */
export function formatResultsAsJson(results: BenchmarkResults): string {
  return JSON.stringify(results, null, 2);
}

/**
 * Format results as a markdown table.
 */
export function formatResultsAsMarkdown(results: BenchmarkResults): string {
  const lines: string[] = [];

  // Header
  lines.push('# ClickBench Benchmark Results');
  lines.push('');
  lines.push(`- **Started:** ${results.startedAt}`);
  lines.push(`- **Completed:** ${results.completedAt}`);
  lines.push(`- **Total Duration:** ${formatDuration(results.totalDurationMs)}`);
  lines.push(`- **Iterations per Query:** ${results.iterations}`);
  lines.push(`- **Timeout per Query:** ${formatDuration(results.timeoutMs)}`);
  lines.push(`- **Data Source:** ${results.usingClickBenchData ? 'ClickBench (hits table)' : 'Simple Test Queries'}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Queries | ${results.summary.totalQueries} |`);
  lines.push(`| Successful | ${results.summary.successfulQueries} |`);
  lines.push(`| Failed | ${results.summary.failedQueries} |`);
  lines.push(`| Timed Out | ${results.summary.timedOutQueries} |`);
  lines.push(`| Avg Cold Run | ${formatMs(results.summary.avgColdMs)} |`);
  lines.push(`| Avg Warm Run | ${formatMs(results.summary.avgWarmMs)} |`);
  lines.push(`| Total Execution | ${formatDuration(results.summary.totalExecutionMs)} |`);
  lines.push('');

  // Category breakdown
  lines.push('## Results by Category');
  lines.push('');
  lines.push(`| Category | Count | Successful | Avg Cold | Avg Warm |`);
  lines.push(`|----------|-------|------------|----------|----------|`);

  for (const [category, summary] of Object.entries(results.summary.byCategory)) {
    lines.push(`| ${category} | ${summary.count} | ${summary.successful} | ${formatMs(summary.avgColdMs)} | ${formatMs(summary.avgWarmMs)} |`);
  }
  lines.push('');

  // Detailed results table
  lines.push('## Detailed Results');
  lines.push('');
  lines.push(`| ID | Description | Status | Cold (ms) | Warm Avg (ms) | Min (ms) | Max (ms) | P50 (ms) | P95 (ms) |`);
  lines.push(`|----|-------------|--------|-----------|---------------|----------|----------|----------|----------|`);

  for (const result of results.queries) {
    const status = result.success ? 'OK' : 'FAIL';
    const timing = result.timing;

    if (timing) {
      lines.push(
        `| ${result.query.id} | ${truncate(result.query.description, 30)} | ${status} | ${formatMs(timing.coldMs)} | ${formatMs(timing.warmAvgMs)} | ${formatMs(timing.minMs)} | ${formatMs(timing.maxMs)} | ${formatMs(timing.p50Ms)} | ${formatMs(timing.p95Ms)} |`
      );
    } else {
      const errorMsg = result.error ? truncate(result.error, 20) : 'Unknown error';
      lines.push(
        `| ${result.query.id} | ${truncate(result.query.description, 30)} | ${status} | - | - | - | - | - | ${errorMsg} |`
      );
    }
  }
  lines.push('');

  // Failed queries details
  const failedQueries = results.queries.filter(r => !r.success);
  if (failedQueries.length > 0) {
    lines.push('## Failed Queries');
    lines.push('');
    for (const result of failedQueries) {
      lines.push(`### ${result.query.id}: ${result.query.description}`);
      lines.push('');
      lines.push('```sql');
      lines.push(result.query.sql);
      lines.push('```');
      lines.push('');
      lines.push(`**Error:** ${result.error ?? 'Unknown error'}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format milliseconds as a human-readable string.
 */
function formatMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)} us`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Format duration in milliseconds to human-readable format.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Class for collecting benchmark results incrementally.
 */
export class ResultCollector {
  private results: QueryBenchmarkResult[] = [];
  private startTime: Date;
  private iterations: number;
  private timeoutMs: number;
  private usingClickBenchData: boolean;

  constructor(options: {
    iterations: number;
    timeoutMs: number;
    usingClickBenchData: boolean;
  }) {
    this.startTime = new Date();
    this.iterations = options.iterations;
    this.timeoutMs = options.timeoutMs;
    this.usingClickBenchData = options.usingClickBenchData;
  }

  /**
   * Add a successful query result.
   */
  addSuccess(
    query: BenchmarkQuery,
    runTimes: number[],
    rowCount?: number,
    resultSizeBytes?: number
  ): void {
    this.results.push({
      query,
      timing: calculateTiming(runTimes),
      success: true,
      rowCount,
      resultSizeBytes,
    });
  }

  /**
   * Add a failed query result.
   */
  addFailure(query: BenchmarkQuery, error: string): void {
    this.results.push({
      query,
      timing: null,
      success: false,
      error,
    });
  }

  /**
   * Get current results count.
   */
  getCount(): number {
    return this.results.length;
  }

  /**
   * Get last result (for progress reporting).
   */
  getLastResult(): QueryBenchmarkResult | undefined {
    return this.results[this.results.length - 1];
  }

  /**
   * Finalize and get complete results.
   */
  finalize(): BenchmarkResults {
    const completedAt = new Date();

    return {
      startedAt: this.startTime.toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs: completedAt.getTime() - this.startTime.getTime(),
      iterations: this.iterations,
      timeoutMs: this.timeoutMs,
      usingClickBenchData: this.usingClickBenchData,
      environment: {
        platform: typeof process !== 'undefined' ? process.platform : 'unknown',
        nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
      },
      queries: this.results,
      summary: calculateSummary(this.results),
    };
  }
}
