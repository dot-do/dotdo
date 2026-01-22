/**
 * Cloudflare Workers Benchmark Runner
 *
 * Runs benchmark queries against a deployed Cloudflare Workers instance
 * and collects timing metrics for cold starts and hot runs.
 */

import { benchmarkConfig, getQueryCount } from '../config';
import type { BenchmarkResult } from '../runner';

/**
 * Response from the benchmark worker
 */
interface WorkerResponse {
  query: number;
  elapsed: number;
  rows: number;
  sql: string;
  error?: string;
  timestamp: string;
  worker: {
    colo?: string;
    requestId?: string;
  };
}

/**
 * Options for running Workers benchmarks
 */
export interface WorkersBenchmarkOptions {
  /** URL of the deployed worker */
  workerUrl: string;
  /** Query indices to benchmark (defaults to [0, 1, 2, 3]) */
  queries?: number[];
  /** Number of hot runs per query (defaults to 3) */
  hotRuns?: number;
  /** Timeout per request in milliseconds (defaults to 30000) */
  timeout?: number;
  /** Delay between requests in milliseconds to avoid rate limiting (defaults to 100) */
  requestDelay?: number;
  /** Whether to include cold start measurements (defaults to true) */
  includeColdStart?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Progress callback */
  onProgress?: (progress: WorkersBenchmarkProgress) => void;
}

/**
 * Progress information during Workers benchmark
 */
export interface WorkersBenchmarkProgress {
  /** Current query index */
  query: number;
  /** Total queries to run */
  totalQueries: number;
  /** Current phase: 'cold' or 'hot' */
  phase: 'cold' | 'hot';
  /** Current hot run (1-based) */
  hotRun?: number;
  /** Total hot runs */
  totalHotRuns?: number;
  /** Percentage complete (0-100) */
  percent: number;
}

/**
 * Extended benchmark result with Workers-specific data
 */
export interface WorkersBenchmarkResult extends BenchmarkResult {
  /** Cloudflare datacenter/colo codes for each run */
  colos?: string[];
  /** Request IDs for debugging */
  requestIds?: string[];
  /** Network latencies (total request time - server-reported elapsed) */
  networkLatencies?: number[];
}

/**
 * Run a single query against the worker
 */
async function runQuery(
  workerUrl: string,
  queryIndex: number,
  timeout: number
): Promise<{ response: WorkerResponse; totalTime: number }> {
  const url = new URL(workerUrl);
  url.searchParams.set('q', String(queryIndex));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const start = performance.now();
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });
    const totalTime = performance.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker returned ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as WorkerResponse;
    return { response: data, totalTime };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run benchmarks against a deployed Cloudflare Worker
 *
 * @param workerUrl - URL of the deployed benchmark worker
 * @param queries - Query indices to benchmark (defaults to [0, 1, 2, 3])
 * @returns Array of benchmark results
 *
 * @example
 * ```typescript
 * const results = await benchmarkWorkers(
 *   'https://clickbench-benchmark.workers.dev',
 *   [0, 1, 2, 3, 4]
 * );
 *
 * for (const result of results) {
 *   console.log(`Q${result.query}: cold=${result.coldMs}ms, hot avg=${avg(result.hotMs)}ms`);
 * }
 * ```
 */
export async function benchmarkWorkers(
  workerUrl: string,
  queries: number[] = [0, 1, 2, 3]
): Promise<WorkersBenchmarkResult[]> {
  return benchmarkWorkersAdvanced({
    workerUrl,
    queries,
  });
}

/**
 * Run benchmarks with full options
 */
export async function benchmarkWorkersAdvanced(
  options: WorkersBenchmarkOptions
): Promise<WorkersBenchmarkResult[]> {
  const {
    workerUrl,
    queries = [0, 1, 2, 3],
    hotRuns = 3,
    timeout = 30000,
    requestDelay = 100,
    includeColdStart = true,
    verbose = false,
    onProgress,
  } = options;

  // Validate query indices
  const maxQuery = getQueryCount() - 1;
  for (const q of queries) {
    if (q < 0 || q > maxQuery) {
      throw new Error(`Query index ${q} out of range (0-${maxQuery})`);
    }
  }

  const results: WorkersBenchmarkResult[] = [];
  const totalQueries = queries.length;
  let completedSteps = 0;
  const totalSteps = queries.length * (includeColdStart ? 1 + hotRuns : hotRuns);

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];

    if (verbose) {
      console.log(`\nBenchmarking Q${q}...`);
    }

    const result: WorkersBenchmarkResult = {
      query: q,
      backend: 'workers',
      coldMs: 0,
      hotMs: [],
      rowsReturned: 0,
      bytesProcessed: 0,
      colos: [],
      requestIds: [],
      networkLatencies: [],
    };

    try {
      // Cold start measurement
      if (includeColdStart) {
        if (onProgress) {
          onProgress({
            query: q,
            totalQueries,
            phase: 'cold',
            percent: (completedSteps / totalSteps) * 100,
          });
        }

        const coldResult = await runQuery(workerUrl, q, timeout);
        result.coldMs = coldResult.response.elapsed;
        result.rowsReturned = coldResult.response.rows;

        if (coldResult.response.worker.colo) {
          result.colos!.push(coldResult.response.worker.colo);
        }
        if (coldResult.response.worker.requestId) {
          result.requestIds!.push(coldResult.response.worker.requestId);
        }
        result.networkLatencies!.push(coldResult.totalTime - coldResult.response.elapsed);

        if (verbose) {
          console.log(`  Cold: ${result.coldMs.toFixed(2)}ms (colo: ${coldResult.response.worker.colo || 'unknown'})`);
        }

        completedSteps++;
        await delay(requestDelay);
      }

      // Hot runs (parallel execution)
      const hotPromises: Promise<{ response: WorkerResponse; totalTime: number }>[] = [];

      for (let run = 0; run < hotRuns; run++) {
        if (onProgress) {
          onProgress({
            query: q,
            totalQueries,
            phase: 'hot',
            hotRun: run + 1,
            totalHotRuns: hotRuns,
            percent: (completedSteps / totalSteps) * 100,
          });
        }

        // Execute hot runs in parallel for more accurate timing
        hotPromises.push(runQuery(workerUrl, q, timeout));
      }

      const hotResults = await Promise.all(hotPromises);

      for (const hotResult of hotResults) {
        result.hotMs.push(hotResult.response.elapsed);

        if (hotResult.response.worker.colo) {
          result.colos!.push(hotResult.response.worker.colo);
        }
        if (hotResult.response.worker.requestId) {
          result.requestIds!.push(hotResult.response.worker.requestId);
        }
        result.networkLatencies!.push(hotResult.totalTime - hotResult.response.elapsed);

        completedSteps++;
      }

      // Use rows from last hot run if cold start wasn't measured
      if (!includeColdStart && hotResults.length > 0) {
        result.rowsReturned = hotResults[0].response.rows;
      }

      if (verbose) {
        const avgHot = result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length;
        console.log(`  Hot: ${result.hotMs.map((t) => t.toFixed(2) + 'ms').join(', ')} (avg: ${avgHot.toFixed(2)}ms)`);
        console.log(`  Rows: ${result.rowsReturned}`);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.error(`  Error: ${result.error}`);
      }
    }

    results.push(result);

    // Delay between queries
    if (i < queries.length - 1) {
      await delay(requestDelay);
    }
  }

  return results;
}

/**
 * Run a comprehensive benchmark suite across multiple regions
 *
 * This function can be used to test the worker from different geographic locations
 * by making requests through different endpoints or using a proxy service.
 */
export async function benchmarkWorkersMultiRegion(
  workerUrl: string,
  options?: Omit<WorkersBenchmarkOptions, 'workerUrl'>
): Promise<{
  results: WorkersBenchmarkResult[];
  summary: WorkersBenchmarkSummary;
}> {
  const results = await benchmarkWorkersAdvanced({
    ...options,
    workerUrl,
  });

  const summary = generateWorkersSummary(results);

  return { results, summary };
}

/**
 * Summary statistics for Workers benchmarks
 */
export interface WorkersBenchmarkSummary {
  /** Total queries run */
  totalQueries: number;
  /** Number of successful queries */
  successfulQueries: number;
  /** Number of failed queries */
  failedQueries: number;
  /** Average cold start time in ms */
  avgColdMs: number;
  /** Average hot run time in ms */
  avgHotMs: number;
  /** Minimum hot run time in ms */
  minHotMs: number;
  /** Maximum hot run time in ms */
  maxHotMs: number;
  /** Average network latency in ms */
  avgNetworkLatencyMs: number;
  /** Unique colos/datacenters used */
  colos: string[];
  /** P50 hot run time */
  p50HotMs: number;
  /** P95 hot run time */
  p95HotMs: number;
  /** P99 hot run time */
  p99HotMs: number;
}

/**
 * Generate summary statistics from benchmark results
 */
export function generateWorkersSummary(results: WorkersBenchmarkResult[]): WorkersBenchmarkSummary {
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  const coldTimes = successful.map((r) => r.coldMs).filter((t) => t > 0);
  const hotTimes = successful.flatMap((r) => r.hotMs);
  const networkLatencies = successful.flatMap((r) => r.networkLatencies || []);
  const colos = [...new Set(successful.flatMap((r) => r.colos || []))];

  // Calculate percentiles
  const sortedHotTimes = [...hotTimes].sort((a, b) => a - b);
  const p50Index = Math.floor(sortedHotTimes.length * 0.5);
  const p95Index = Math.floor(sortedHotTimes.length * 0.95);
  const p99Index = Math.floor(sortedHotTimes.length * 0.99);

  return {
    totalQueries: results.length,
    successfulQueries: successful.length,
    failedQueries: failed.length,
    avgColdMs: coldTimes.length > 0 ? coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length : 0,
    avgHotMs: hotTimes.length > 0 ? hotTimes.reduce((a, b) => a + b, 0) / hotTimes.length : 0,
    minHotMs: hotTimes.length > 0 ? Math.min(...hotTimes) : 0,
    maxHotMs: hotTimes.length > 0 ? Math.max(...hotTimes) : 0,
    avgNetworkLatencyMs:
      networkLatencies.length > 0 ? networkLatencies.reduce((a, b) => a + b, 0) / networkLatencies.length : 0,
    colos,
    p50HotMs: sortedHotTimes[p50Index] || 0,
    p95HotMs: sortedHotTimes[p95Index] || 0,
    p99HotMs: sortedHotTimes[p99Index] || 0,
  };
}

/**
 * Format Workers benchmark results as a markdown report
 */
export function formatWorkersResults(results: WorkersBenchmarkResult[]): string {
  const summary = generateWorkersSummary(results);
  const lines: string[] = [];

  lines.push('# Cloudflare Workers Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total queries: ${summary.totalQueries}`);
  lines.push(`- Successful: ${summary.successfulQueries}`);
  lines.push(`- Failed: ${summary.failedQueries}`);
  lines.push(`- Colos: ${summary.colos.join(', ') || 'N/A'}`);
  lines.push('');

  lines.push('### Timing Statistics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Avg Cold Start | ${summary.avgColdMs.toFixed(2)}ms |`);
  lines.push(`| Avg Hot Run | ${summary.avgHotMs.toFixed(2)}ms |`);
  lines.push(`| Min Hot Run | ${summary.minHotMs.toFixed(2)}ms |`);
  lines.push(`| Max Hot Run | ${summary.maxHotMs.toFixed(2)}ms |`);
  lines.push(`| P50 Hot Run | ${summary.p50HotMs.toFixed(2)}ms |`);
  lines.push(`| P95 Hot Run | ${summary.p95HotMs.toFixed(2)}ms |`);
  lines.push(`| P99 Hot Run | ${summary.p99HotMs.toFixed(2)}ms |`);
  lines.push(`| Avg Network Latency | ${summary.avgNetworkLatencyMs.toFixed(2)}ms |`);
  lines.push('');

  lines.push('## Detailed Results');
  lines.push('');
  lines.push('| Query | Cold (ms) | Hot Avg (ms) | Hot Runs (ms) | Rows | Colo | Error |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const result of results) {
    const hotAvg = result.hotMs.length > 0 ? result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length : 0;
    const hotStr = result.hotMs.map((t) => t.toFixed(1)).join(', ') || '-';
    const colo = result.colos?.[0] || '-';
    const error = result.error || '-';

    lines.push(
      `| Q${result.query} | ${result.coldMs.toFixed(2)} | ${hotAvg.toFixed(2)} | ${hotStr} | ${result.rowsReturned} | ${colo} | ${error} |`
    );
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * CLI entry point for running Workers benchmarks
 */
export async function runWorkersBenchmarkCli(args: string[]): Promise<void> {
  let workerUrl = '';
  let queries: number[] = [0, 1, 2, 3];
  let hotRuns = 3;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--url':
      case '-u':
        workerUrl = args[++i];
        break;
      case '--queries':
      case '-q':
        queries = args[++i].split(',').map((s) => parseInt(s.trim(), 10));
        break;
      case '--runs':
      case '-r':
        hotRuns = parseInt(args[++i], 10);
        break;
      case '--verbose':
      case '-v':
        verbose = true;
        break;
    }
  }

  if (!workerUrl) {
    console.error('Usage: benchmark --url <worker-url> [--queries 0,1,2,3] [--runs 3] [--verbose]');
    process.exit(1);
  }

  console.log('Starting Workers benchmark...');
  console.log(`Worker URL: ${workerUrl}`);
  console.log(`Queries: ${queries.join(', ')}`);
  console.log(`Hot runs: ${hotRuns}`);
  console.log('');

  const results = await benchmarkWorkersAdvanced({
    workerUrl,
    queries,
    hotRuns,
    verbose,
    onProgress: (progress) => {
      if (!verbose) {
        process.stdout.write(`\rBenchmarking Q${progress.query} (${progress.phase})... ${progress.percent.toFixed(1)}%`);
      }
    },
  });

  if (!verbose) {
    console.log('');
  }

  console.log('\n' + formatWorkersResults(results));
}
