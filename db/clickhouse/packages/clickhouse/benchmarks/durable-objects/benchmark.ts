/**
 * Durable Objects Benchmark Runner
 *
 * Provides utilities for running benchmarks against the BenchmarkDO
 * to measure cold start vs warm query performance on Cloudflare's edge.
 *
 * Features:
 * - Cold start measurement
 * - Warm query benchmarking
 * - Concurrent request testing
 * - Statistical analysis of results
 */

import type { DOQueryResult, BatchQueryResponse } from './do';
import { benchmarkConfig, getQueryCount } from '../config';
import type { BenchmarkResult } from '../runner';

/**
 * Options for running Durable Objects benchmarks
 */
export interface DOBenchmarkOptions {
  /** Base URL of the deployed Durable Object worker */
  doUrl: string;
  /** Query indices to benchmark (defaults to all) */
  queries?: number[];
  /** Number of warmup runs before timing */
  warmupRuns?: number;
  /** Number of timed runs per query */
  timedRuns?: number;
  /** Timeout per request in milliseconds */
  timeout?: number;
  /** Whether to force cold start by resetting DO before each test */
  forceColdStart?: boolean;
  /** Durable Object ID (for multi-DO testing) */
  doId?: string;
  /** Progress callback */
  onProgress?: (progress: DOBenchmarkProgress) => void;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Progress information during benchmark execution
 */
export interface DOBenchmarkProgress {
  /** Current phase */
  phase: 'cold' | 'warmup' | 'timing';
  /** Current query index */
  query: number;
  /** Current run number */
  run: number;
  /** Total runs in current phase */
  totalRuns: number;
  /** Percentage complete (0-100) */
  percent: number;
  /** Status message */
  message: string;
}

/**
 * Extended benchmark result with DO-specific metrics
 */
export interface DOBenchmarkResult extends BenchmarkResult {
  /** WASM initialization time (cold start) */
  wasmInitMs?: number;
  /** Whether this result was from a warm DO */
  wasWarm: boolean;
  /** Durable Object ID used */
  doId: string;
  /** Location hint if specified */
  locationHint?: string;
}

/**
 * Aggregated statistics for a query
 */
export interface QueryStatistics {
  /** Query index */
  query: number;
  /** Cold start time (first request after reset) */
  coldStartMs: number;
  /** WASM initialization time */
  wasmInitMs: number;
  /** Mean warm query time */
  meanWarmMs: number;
  /** Median warm query time */
  medianWarmMs: number;
  /** Minimum warm query time */
  minWarmMs: number;
  /** Maximum warm query time */
  maxWarmMs: number;
  /** Standard deviation of warm query times */
  stdDevWarmMs: number;
  /** P95 warm query time */
  p95WarmMs: number;
  /** P99 warm query time */
  p99WarmMs: number;
  /** Number of successful runs */
  successfulRuns: number;
  /** Number of failed runs */
  failedRuns: number;
  /** All warm timing samples */
  samples: number[];
}

/**
 * Full benchmark report
 */
export interface DOBenchmarkReport {
  /** Timestamp when benchmark started */
  startTime: string;
  /** Timestamp when benchmark ended */
  endTime: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Durable Object URL */
  doUrl: string;
  /** Options used */
  options: DOBenchmarkOptions;
  /** Per-query statistics */
  queryStats: QueryStatistics[];
  /** Summary statistics across all queries */
  summary: {
    /** Total queries tested */
    totalQueries: number;
    /** Average cold start time */
    avgColdStartMs: number;
    /** Average WASM init time */
    avgWasmInitMs: number;
    /** Average warm query time */
    avgWarmMs: number;
    /** Total successful runs */
    totalSuccessfulRuns: number;
    /** Total failed runs */
    totalFailedRuns: number;
  };
}

/**
 * Run benchmarks against a deployed Durable Object
 *
 * @param options - Benchmark configuration
 * @returns Array of benchmark results
 */
export async function benchmarkDurableObjects(
  options: DOBenchmarkOptions
): Promise<DOBenchmarkResult[]> {
  const {
    doUrl,
    queries = Array.from({ length: getQueryCount() }, (_, i) => i),
    warmupRuns = benchmarkConfig.defaultWarmupRuns,
    timedRuns = benchmarkConfig.defaultRuns,
    timeout = benchmarkConfig.defaultTimeout,
    forceColdStart = true,
    doId = 'benchmark',
    onProgress,
    verbose = false,
  } = options;

  const results: DOBenchmarkResult[] = [];
  const baseUrl = new URL(doUrl);
  baseUrl.searchParams.set('do_id', doId);

  const log = (msg: string) => verbose && console.log(`[DO Benchmark] ${msg}`);

  log(`Starting benchmark against ${doUrl}`);
  log(`Queries: ${queries.join(', ')}`);
  log(`Warmup runs: ${warmupRuns}, Timed runs: ${timedRuns}`);

  let totalProgress = 0;
  const totalSteps = queries.length * (1 + warmupRuns + timedRuns);

  for (let qIdx = 0; qIdx < queries.length; qIdx++) {
    const queryIndex = queries[qIdx];
    log(`\nBenchmarking Q${queryIndex}...`);

    // Reset DO for cold start measurement if requested
    if (forceColdStart) {
      log('  Resetting DO for cold start measurement...');
      await resetDurableObject(baseUrl.toString(), timeout);
    }

    // Cold start run
    log('  Running cold start...');
    onProgress?.({
      phase: 'cold',
      query: queryIndex,
      run: 1,
      totalRuns: 1,
      percent: (++totalProgress / totalSteps) * 100,
      message: `Q${queryIndex}: Cold start`,
    });

    const coldResult = await runQuery(baseUrl.toString(), queryIndex, timeout);
    const coldMs = coldResult.elapsed + (coldResult.initTime || 0);

    results.push({
      query: queryIndex,
      backend: 'durable-object',
      coldMs,
      hotMs: [],
      rowsReturned: coldResult.rows,
      bytesProcessed: 0,
      wasmInitMs: coldResult.initTime,
      wasWarm: coldResult.warm,
      doId,
      error: coldResult.error,
    });

    // Warmup runs (results discarded)
    for (let w = 0; w < warmupRuns; w++) {
      log(`  Warmup run ${w + 1}/${warmupRuns}...`);
      onProgress?.({
        phase: 'warmup',
        query: queryIndex,
        run: w + 1,
        totalRuns: warmupRuns,
        percent: (++totalProgress / totalSteps) * 100,
        message: `Q${queryIndex}: Warmup ${w + 1}/${warmupRuns}`,
      });

      await runQuery(baseUrl.toString(), queryIndex, timeout);
    }

    // Timed runs
    const hotTimes: number[] = [];
    for (let t = 0; t < timedRuns; t++) {
      log(`  Timed run ${t + 1}/${timedRuns}...`);
      onProgress?.({
        phase: 'timing',
        query: queryIndex,
        run: t + 1,
        totalRuns: timedRuns,
        percent: (++totalProgress / totalSteps) * 100,
        message: `Q${queryIndex}: Run ${t + 1}/${timedRuns}`,
      });

      const result = await runQuery(baseUrl.toString(), queryIndex, timeout);
      if (!result.error) {
        hotTimes.push(result.elapsed);
      }
    }

    // Update the result with hot times
    const lastResult = results[results.length - 1];
    lastResult.hotMs = hotTimes;

    if (verbose && hotTimes.length > 0) {
      const avg = hotTimes.reduce((a, b) => a + b, 0) / hotTimes.length;
      log(`  Cold: ${coldMs.toFixed(2)}ms, Avg Hot: ${avg.toFixed(2)}ms`);
    }
  }

  return results;
}

/**
 * Run a single query against the Durable Object
 */
async function runQuery(
  baseUrl: string,
  queryIndex: number,
  timeout: number
): Promise<DOQueryResult> {
  const url = new URL(baseUrl);
  url.pathname = '/query';
  url.searchParams.set('q', queryIndex.toString());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        query: queryIndex,
        elapsed: timeout,
        rows: 0,
        warm: false,
        error: 'Query timeout',
        timestamp: new Date().toISOString(),
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      query: queryIndex,
      elapsed: 0,
      rows: 0,
      warm: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Reset the Durable Object to force a cold start
 */
async function resetDurableObject(baseUrl: string, timeout: number): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = '/reset';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn('Failed to reset DO:', await response.text());
    }
  } catch (error) {
    console.warn('Error resetting DO:', error);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Run batch queries against the Durable Object
 */
export async function runBatchQueries(
  doUrl: string,
  queries: number[],
  runs: number = 1,
  timeout: number = benchmarkConfig.defaultTimeout,
  doId: string = 'benchmark'
): Promise<BatchQueryResponse> {
  const url = new URL(doUrl);
  url.pathname = '/batch';
  url.searchParams.set('do_id', doId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * queries.length * runs);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries, runs }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get health status of the Durable Object
 */
export async function getHealthStatus(
  doUrl: string,
  doId: string = 'benchmark',
  timeout: number = 5000
): Promise<{ ok: boolean; wasmInitialized: boolean; uptime?: number }> {
  const url = new URL(doUrl);
  url.pathname = '/health';
  url.searchParams.set('do_id', doId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, wasmInitialized: false };
    }

    return await response.json();
  } catch {
    return { ok: false, wasmInitialized: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calculate statistics from benchmark results
 */
export function calculateStatistics(results: DOBenchmarkResult[]): QueryStatistics[] {
  const byQuery = new Map<number, DOBenchmarkResult[]>();

  for (const result of results) {
    if (!byQuery.has(result.query)) {
      byQuery.set(result.query, []);
    }
    byQuery.get(result.query)!.push(result);
  }

  const stats: QueryStatistics[] = [];

  for (const [query, queryResults] of byQuery) {
    const successfulResults = queryResults.filter((r) => !r.error);
    const failedResults = queryResults.filter((r) => r.error);

    // Get all warm samples from hot times
    const samples = successfulResults.flatMap((r) => r.hotMs);

    if (samples.length === 0) {
      stats.push({
        query,
        coldStartMs: queryResults[0]?.coldMs || 0,
        wasmInitMs: queryResults[0]?.wasmInitMs || 0,
        meanWarmMs: 0,
        medianWarmMs: 0,
        minWarmMs: 0,
        maxWarmMs: 0,
        stdDevWarmMs: 0,
        p95WarmMs: 0,
        p99WarmMs: 0,
        successfulRuns: 0,
        failedRuns: failedResults.length,
        samples: [],
      });
      continue;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;

    stats.push({
      query,
      coldStartMs: queryResults[0]?.coldMs || 0,
      wasmInitMs: queryResults[0]?.wasmInitMs || 0,
      meanWarmMs: mean,
      medianWarmMs: sorted[Math.floor(sorted.length / 2)],
      minWarmMs: sorted[0],
      maxWarmMs: sorted[sorted.length - 1],
      stdDevWarmMs: Math.sqrt(variance),
      p95WarmMs: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
      p99WarmMs: sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1],
      successfulRuns: samples.length,
      failedRuns: failedResults.length,
      samples,
    });
  }

  return stats.sort((a, b) => a.query - b.query);
}

/**
 * Generate a full benchmark report
 */
export function generateReport(
  results: DOBenchmarkResult[],
  options: DOBenchmarkOptions,
  startTime: Date,
  endTime: Date
): DOBenchmarkReport {
  const queryStats = calculateStatistics(results);

  const totalSuccessful = queryStats.reduce((sum, s) => sum + s.successfulRuns, 0);
  const totalFailed = queryStats.reduce((sum, s) => sum + s.failedRuns, 0);

  const coldStarts = queryStats.map((s) => s.coldStartMs).filter((v) => v > 0);
  const wasmInits = queryStats.map((s) => s.wasmInitMs).filter((v) => v > 0);
  const warmTimes = queryStats.flatMap((s) => s.samples);

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    totalDurationMs: endTime.getTime() - startTime.getTime(),
    doUrl: options.doUrl,
    options,
    queryStats,
    summary: {
      totalQueries: queryStats.length,
      avgColdStartMs: coldStarts.length > 0
        ? coldStarts.reduce((a, b) => a + b, 0) / coldStarts.length
        : 0,
      avgWasmInitMs: wasmInits.length > 0
        ? wasmInits.reduce((a, b) => a + b, 0) / wasmInits.length
        : 0,
      avgWarmMs: warmTimes.length > 0
        ? warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length
        : 0,
      totalSuccessfulRuns: totalSuccessful,
      totalFailedRuns: totalFailed,
    },
  };
}

/**
 * Format benchmark report as markdown
 */
export function formatReportMarkdown(report: DOBenchmarkReport): string {
  const lines: string[] = [];

  lines.push('# Durable Objects Benchmark Report');
  lines.push('');
  lines.push(`**Generated:** ${report.endTime}`);
  lines.push(`**Duration:** ${(report.totalDurationMs / 1000).toFixed(2)}s`);
  lines.push(`**Target:** ${report.doUrl}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Queries | ${report.summary.totalQueries} |`);
  lines.push(`| Avg Cold Start | ${report.summary.avgColdStartMs.toFixed(2)}ms |`);
  lines.push(`| Avg WASM Init | ${report.summary.avgWasmInitMs.toFixed(2)}ms |`);
  lines.push(`| Avg Warm Query | ${report.summary.avgWarmMs.toFixed(2)}ms |`);
  lines.push(`| Successful Runs | ${report.summary.totalSuccessfulRuns} |`);
  lines.push(`| Failed Runs | ${report.summary.totalFailedRuns} |`);
  lines.push('');

  lines.push('## Per-Query Results');
  lines.push('');
  lines.push('| Query | Cold (ms) | WASM Init (ms) | Mean Warm (ms) | P95 (ms) | Min (ms) | Max (ms) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const stat of report.queryStats) {
    lines.push(
      `| Q${stat.query} | ${stat.coldStartMs.toFixed(2)} | ${stat.wasmInitMs.toFixed(2)} | ${stat.meanWarmMs.toFixed(2)} | ${stat.p95WarmMs.toFixed(2)} | ${stat.minWarmMs.toFixed(2)} | ${stat.maxWarmMs.toFixed(2)} |`
    );
  }

  lines.push('');
  lines.push('## Configuration');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.options, null, 2));
  lines.push('```');

  return lines.join('\n');
}

/**
 * Test concurrent DO access
 */
export async function testConcurrentAccess(
  doUrl: string,
  queryIndex: number,
  concurrency: number,
  timeout: number = benchmarkConfig.defaultTimeout,
  doId: string = 'benchmark'
): Promise<{
  results: DOQueryResult[];
  totalTime: number;
  successCount: number;
  errorCount: number;
}> {
  const start = performance.now();

  const promises = Array.from({ length: concurrency }, () =>
    runQuery(
      new URL(doUrl).toString() + `?do_id=${doId}`,
      queryIndex,
      timeout
    )
  );

  const results = await Promise.all(promises);
  const totalTime = performance.now() - start;

  return {
    results,
    totalTime,
    successCount: results.filter((r) => !r.error).length,
    errorCount: results.filter((r) => r.error).length,
  };
}
