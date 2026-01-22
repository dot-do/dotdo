#!/usr/bin/env npx tsx
/**
 * Deployed Worker Benchmark Suite
 *
 * Benchmarks the deployed chdb-wasm Cloudflare Worker endpoints.
 * Measures latency, throughput, and statistical distribution of response times.
 *
 * Usage:
 *   npx tsx benchmarks/deployed-worker-bench.ts [options]
 *
 * Options:
 *   --url, -u       Worker URL (default: https://chdb-wasm.nathanclevenger.workers.dev)
 *   --iterations    Number of iterations per test (default: 50)
 *   --warmup        Number of warmup requests (default: 5)
 *   --concurrency   Concurrent requests for throughput test (default: 10)
 *   --output, -o    Output file path (default: stdout)
 *   --format, -f    Output format: json | markdown (default: json)
 *   --verbose, -v   Enable verbose output
 *   --help, -h      Show help message
 *
 * Examples:
 *   npx tsx benchmarks/deployed-worker-bench.ts
 *   npx tsx benchmarks/deployed-worker-bench.ts --url https://my-worker.workers.dev
 *   npx tsx benchmarks/deployed-worker-bench.ts --iterations 100 --format markdown
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Default worker URL
 */
const DEFAULT_WORKER_URL = 'https://chdb-wasm.dotdo.workers.dev';

/**
 * Configuration for the benchmark runner
 */
interface BenchmarkConfig {
  /** Worker base URL */
  workerUrl: string;
  /** Number of iterations per test */
  iterations: number;
  /** Number of warmup requests */
  warmup: number;
  /** Concurrency for throughput tests */
  concurrency: number;
  /** Output file path (null for stdout) */
  outputPath: string | null;
  /** Output format */
  format: 'json' | 'markdown';
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Latency statistics
 */
interface LatencyStats {
  /** First request latency (cold start) */
  coldStartMs: number;
  /** Average warm latency */
  warmAvgMs: number;
  /** Minimum latency */
  minMs: number;
  /** Maximum latency */
  maxMs: number;
  /** 50th percentile */
  p50Ms: number;
  /** 95th percentile */
  p95Ms: number;
  /** 99th percentile */
  p99Ms: number;
  /** Standard deviation */
  stdDevMs: number;
  /** All latency samples */
  samples: number[];
}

/**
 * Throughput statistics
 */
interface ThroughputStats {
  /** Requests per second */
  requestsPerSecond: number;
  /** Total requests made */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Individual endpoint benchmark result
 */
interface EndpointBenchmarkResult {
  /** Endpoint name */
  name: string;
  /** Endpoint path */
  endpoint: string;
  /** HTTP method */
  method: 'GET' | 'POST';
  /** Description */
  description: string;
  /** Whether the endpoint responded successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Latency statistics */
  latency: LatencyStats | null;
  /** Response size in bytes */
  responseSizeBytes?: number;
  /** HTTP status code */
  statusCode?: number;
}

/**
 * Query benchmark result
 */
interface QueryBenchmarkResult {
  /** Query name */
  name: string;
  /** SQL query */
  query: string;
  /** Description */
  description: string;
  /** Whether the query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Query execution latency */
  latency: LatencyStats | null;
  /** Response size in bytes */
  responseSizeBytes?: number;
  /** Row count from response */
  rowCount?: number;
}

/**
 * Complete benchmark results
 */
interface BenchmarkResults {
  /** Benchmark metadata */
  metadata: {
    /** Timestamp when benchmark started */
    startedAt: string;
    /** Timestamp when benchmark completed */
    completedAt: string;
    /** Total duration in milliseconds */
    totalDurationMs: number;
    /** Worker URL tested */
    workerUrl: string;
    /** Number of iterations per test */
    iterations: number;
    /** Number of warmup requests */
    warmup: number;
    /** Concurrency for throughput tests */
    concurrency: number;
  };
  /** Endpoint benchmark results */
  endpoints: EndpointBenchmarkResult[];
  /** Query benchmark results */
  queries: QueryBenchmarkResult[];
  /** Throughput test results */
  throughput: {
    /** /ping endpoint throughput */
    ping: ThroughputStats | null;
    /** Simple query throughput */
    simpleQuery: ThroughputStats | null;
  };
  /** Summary statistics */
  summary: {
    /** Total tests run */
    totalTests: number;
    /** Successful tests */
    successfulTests: number;
    /** Failed tests */
    failedTests: number;
    /** Average ping latency */
    avgPingLatencyMs: number;
    /** Average query latency */
    avgQueryLatencyMs: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  workerUrl: DEFAULT_WORKER_URL,
  iterations: 50,
  warmup: 5,
  concurrency: 10,
  outputPath: null,
  format: 'json',
  verbose: false,
};

/**
 * Benchmark queries to test
 */
const BENCHMARK_QUERIES = [
  {
    name: 'select_1',
    query: 'SELECT 1',
    description: 'Simplest possible query',
  },
  {
    name: 'arithmetic',
    query: 'SELECT 1 + 2 * 3 - 4 / 2 AS result',
    description: 'Basic arithmetic operations',
  },
  {
    name: 'range_1000',
    query: 'SELECT * FROM (SELECT UNNEST(range(1000)) as number) LIMIT 100',
    description: 'Generate and limit 1000 rows',
  },
  {
    name: 'aggregation',
    query: 'SELECT COUNT(*), SUM(number), AVG(number) FROM (SELECT UNNEST(range(1000)) as number)',
    description: 'Aggregation over generated data',
  },
  {
    name: 'clickbench_q0',
    query: 'SELECT COUNT(*) FROM (SELECT UNNEST(range(10000)) as number)',
    description: 'ClickBench-style count query',
  },
  {
    name: 'clickbench_group',
    query: 'SELECT number % 10 as bucket, COUNT(*) as cnt FROM (SELECT UNNEST(range(10000)) as number) GROUP BY bucket ORDER BY bucket',
    description: 'ClickBench-style group by query',
  },
  {
    name: 'clickbench_filter_agg',
    query: 'SELECT COUNT(*), AVG(number), MIN(number), MAX(number) FROM (SELECT UNNEST(range(10000)) as number) WHERE number > 5000',
    description: 'ClickBench-style filter and aggregate',
  },
  {
    name: 'large_range',
    query: 'SELECT COUNT(*) FROM (SELECT UNNEST(range(100000)) as number)',
    description: 'Large range aggregation (100k rows)',
  },
];

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--url':
      case '-u':
        config.workerUrl = args[++i];
        break;
      case '--iterations':
        config.iterations = parseInt(args[++i], 10);
        break;
      case '--warmup':
        config.warmup = parseInt(args[++i], 10);
        break;
      case '--concurrency':
        config.concurrency = parseInt(args[++i], 10);
        break;
      case '--output':
      case '-o':
        config.outputPath = args[++i];
        break;
      case '--format':
      case '-f':
        config.format = args[++i] as 'json' | 'markdown';
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  // Ensure URL doesn't have trailing slash
  config.workerUrl = config.workerUrl.replace(/\/$/, '');

  return config;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Deployed Worker Benchmark Suite

Benchmarks the deployed chdb-wasm Cloudflare Worker endpoints.

Usage:
  npx tsx benchmarks/deployed-worker-bench.ts [options]

Options:
  --url, -u       Worker URL (default: ${DEFAULT_WORKER_URL})
  --iterations    Number of iterations per test (default: 50)
  --warmup        Number of warmup requests (default: 5)
  --concurrency   Concurrent requests for throughput test (default: 10)
  --output, -o    Output file path (default: stdout)
  --format, -f    Output format: json | markdown (default: json)
  --verbose, -v   Enable verbose output
  --help, -h      Show help message

Examples:
  # Run with defaults
  npx tsx benchmarks/deployed-worker-bench.ts

  # Custom worker URL
  npx tsx benchmarks/deployed-worker-bench.ts --url https://my-worker.workers.dev

  # More iterations with markdown output
  npx tsx benchmarks/deployed-worker-bench.ts --iterations 100 --format markdown -o results.md

  # Verbose mode with JSON output to file
  npx tsx benchmarks/deployed-worker-bench.ts -v -o results.json
`);
}

/**
 * Log message if verbose mode is enabled
 */
function log(config: BenchmarkConfig, message: string): void {
  if (config.verbose) {
    console.error(`[${new Date().toISOString()}] ${message}`);
  }
}

/**
 * Calculate percentile from sorted array
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
 * Calculate latency statistics from samples
 */
function calculateLatencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return {
      coldStartMs: 0,
      warmAvgMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      stdDevMs: 0,
      samples: [],
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const coldStartMs = samples[0];
  const warmSamples = samples.slice(1);
  const warmAvgMs = warmSamples.length > 0
    ? warmSamples.reduce((a, b) => a + b, 0) / warmSamples.length
    : coldStartMs;

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;
  const stdDevMs = Math.sqrt(variance);

  return {
    coldStartMs,
    warmAvgMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    stdDevMs,
    samples,
  };
}

/**
 * Make a timed HTTP request
 */
async function timedFetch(
  url: string,
  options?: RequestInit
): Promise<{ response: Response; durationMs: number }> {
  const start = performance.now();
  const response = await fetch(url, options);
  const durationMs = performance.now() - start;
  return { response, durationMs };
}

/**
 * Run latency benchmark for an endpoint
 */
async function benchmarkEndpoint(
  config: BenchmarkConfig,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: string
): Promise<{ samples: number[]; responseSizeBytes: number; statusCode: number; error?: string }> {
  const url = `${config.workerUrl}${endpoint}`;
  const samples: number[] = [];
  let responseSizeBytes = 0;
  let statusCode = 0;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'text/plain',
    },
  };

  if (body && method === 'POST') {
    fetchOptions.body = body;
  }

  // Warmup requests
  log(config, `  Warming up with ${config.warmup} requests...`);
  for (let i = 0; i < config.warmup; i++) {
    try {
      await fetch(url, fetchOptions);
    } catch {
      // Ignore warmup errors
    }
  }

  // Benchmark requests
  log(config, `  Running ${config.iterations} iterations...`);
  for (let i = 0; i < config.iterations; i++) {
    try {
      const { response, durationMs } = await timedFetch(url, fetchOptions);
      samples.push(durationMs);

      if (i === 0) {
        statusCode = response.status;
        const text = await response.text();
        responseSizeBytes = new TextEncoder().encode(text).length;

        if (!response.ok) {
          return {
            samples,
            responseSizeBytes,
            statusCode,
            error: `HTTP ${response.status}: ${text.substring(0, 200)}`,
          };
        }
      } else {
        // Consume response body
        await response.text();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        samples,
        responseSizeBytes,
        statusCode,
        error: errorMessage,
      };
    }
  }

  return { samples, responseSizeBytes, statusCode };
}

/**
 * Run throughput benchmark
 */
async function benchmarkThroughput(
  config: BenchmarkConfig,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: string,
  durationMs: number = 5000
): Promise<ThroughputStats> {
  const url = `${config.workerUrl}${endpoint}`;
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'text/plain',
    },
  };

  if (body && method === 'POST') {
    fetchOptions.body = body;
  }

  const startTime = performance.now();
  const endTime = startTime + durationMs;

  // Run concurrent requests until duration expires
  while (performance.now() < endTime) {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.concurrency; i++) {
      promises.push(
        fetch(url, fetchOptions)
          .then(async (response) => {
            totalRequests++;
            await response.text();
            if (response.ok) {
              successfulRequests++;
            } else {
              failedRequests++;
            }
          })
          .catch(() => {
            totalRequests++;
            failedRequests++;
          })
      );
    }

    await Promise.all(promises);
  }

  const actualDurationMs = performance.now() - startTime;
  const requestsPerSecond = (successfulRequests / actualDurationMs) * 1000;

  return {
    requestsPerSecond,
    totalRequests,
    successfulRequests,
    failedRequests,
    durationMs: actualDurationMs,
  };
}

/**
 * Run all benchmarks
 */
async function runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResults> {
  const startedAt = new Date();
  console.error(`Starting benchmark against ${config.workerUrl}`);
  console.error(`Iterations: ${config.iterations}, Warmup: ${config.warmup}, Concurrency: ${config.concurrency}`);
  console.error('');

  const endpointResults: EndpointBenchmarkResult[] = [];
  const queryResults: QueryBenchmarkResult[] = [];

  // Benchmark endpoints
  console.error('=== Endpoint Benchmarks ===');

  // /ping endpoint
  console.error('Testing GET /ping...');
  const pingResult = await benchmarkEndpoint(config, '/ping', 'GET');
  endpointResults.push({
    name: 'ping',
    endpoint: '/ping',
    method: 'GET',
    description: 'Ping endpoint for health checks',
    success: !pingResult.error,
    error: pingResult.error,
    latency: pingResult.samples.length > 0 ? calculateLatencyStats(pingResult.samples) : null,
    responseSizeBytes: pingResult.responseSizeBytes,
    statusCode: pingResult.statusCode,
  });
  if (pingResult.error) {
    console.error(`  FAILED: ${pingResult.error}`);
  } else {
    const stats = calculateLatencyStats(pingResult.samples);
    console.error(`  OK: p50=${stats.p50Ms.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms, p99=${stats.p99Ms.toFixed(2)}ms`);
  }

  // /replicas_status endpoint (health check)
  console.error('Testing GET /replicas_status...');
  const healthResult = await benchmarkEndpoint(config, '/replicas_status', 'GET');
  endpointResults.push({
    name: 'health',
    endpoint: '/replicas_status',
    method: 'GET',
    description: 'ClickHouse-compatible health endpoint',
    success: !healthResult.error,
    error: healthResult.error,
    latency: healthResult.samples.length > 0 ? calculateLatencyStats(healthResult.samples) : null,
    responseSizeBytes: healthResult.responseSizeBytes,
    statusCode: healthResult.statusCode,
  });
  if (healthResult.error) {
    console.error(`  FAILED: ${healthResult.error}`);
  } else {
    const stats = calculateLatencyStats(healthResult.samples);
    console.error(`  OK: p50=${stats.p50Ms.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms, p99=${stats.p99Ms.toFixed(2)}ms`);
  }

  console.error('');
  console.error('=== Query Benchmarks ===');

  // Benchmark queries
  for (const queryDef of BENCHMARK_QUERIES) {
    console.error(`Testing ${queryDef.name}: ${queryDef.description}...`);

    const queryResult = await benchmarkEndpoint(
      config,
      `/?query=${encodeURIComponent(queryDef.query)}&default_format=JSON`,
      'GET'
    );

    let rowCount: number | undefined;
    if (!queryResult.error && queryResult.responseSizeBytes > 0) {
      try {
        // Try to extract row count from JSON response
        const testResponse = await fetch(
          `${config.workerUrl}/?query=${encodeURIComponent(queryDef.query)}&default_format=JSON`
        );
        const json = await testResponse.json() as { rows?: number; data?: unknown[] };
        rowCount = json.rows ?? json.data?.length;
      } catch {
        // Ignore
      }
    }

    queryResults.push({
      name: queryDef.name,
      query: queryDef.query,
      description: queryDef.description,
      success: !queryResult.error,
      error: queryResult.error,
      latency: queryResult.samples.length > 0 ? calculateLatencyStats(queryResult.samples) : null,
      responseSizeBytes: queryResult.responseSizeBytes,
      rowCount,
    });

    if (queryResult.error) {
      console.error(`  FAILED: ${queryResult.error}`);
    } else {
      const stats = calculateLatencyStats(queryResult.samples);
      console.error(`  OK: p50=${stats.p50Ms.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms, p99=${stats.p99Ms.toFixed(2)}ms`);
    }
  }

  console.error('');
  console.error('=== Throughput Benchmarks ===');

  // Throughput benchmarks
  console.error('Testing /ping throughput (5 seconds)...');
  const pingThroughput = await benchmarkThroughput(config, '/ping', 'GET');
  console.error(`  ${pingThroughput.requestsPerSecond.toFixed(2)} req/s (${pingThroughput.successfulRequests}/${pingThroughput.totalRequests} successful)`);

  console.error('Testing simple query throughput (5 seconds)...');
  const queryThroughput = await benchmarkThroughput(
    config,
    `/?query=${encodeURIComponent('SELECT 1')}&default_format=JSON`,
    'GET'
  );
  console.error(`  ${queryThroughput.requestsPerSecond.toFixed(2)} req/s (${queryThroughput.successfulRequests}/${queryThroughput.totalRequests} successful)`);

  const completedAt = new Date();

  // Calculate summary
  const successfulEndpoints = endpointResults.filter(r => r.success);
  const successfulQueries = queryResults.filter(r => r.success);

  const avgPingLatency = successfulEndpoints
    .filter(r => r.name === 'ping' && r.latency)
    .reduce((sum, r) => sum + (r.latency?.warmAvgMs ?? 0), 0) / Math.max(1, successfulEndpoints.filter(r => r.name === 'ping').length);

  const avgQueryLatency = successfulQueries
    .filter(r => r.latency)
    .reduce((sum, r) => sum + (r.latency?.warmAvgMs ?? 0), 0) / Math.max(1, successfulQueries.length);

  console.error('');
  console.error('=== Summary ===');
  console.error(`Total tests: ${endpointResults.length + queryResults.length}`);
  console.error(`Successful: ${successfulEndpoints.length + successfulQueries.length}`);
  console.error(`Failed: ${(endpointResults.length - successfulEndpoints.length) + (queryResults.length - successfulQueries.length)}`);
  console.error(`Avg ping latency: ${avgPingLatency.toFixed(2)}ms`);
  console.error(`Avg query latency: ${avgQueryLatency.toFixed(2)}ms`);
  console.error(`Ping throughput: ${pingThroughput.requestsPerSecond.toFixed(2)} req/s`);
  console.error(`Query throughput: ${queryThroughput.requestsPerSecond.toFixed(2)} req/s`);

  return {
    metadata: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      totalDurationMs: completedAt.getTime() - startedAt.getTime(),
      workerUrl: config.workerUrl,
      iterations: config.iterations,
      warmup: config.warmup,
      concurrency: config.concurrency,
    },
    endpoints: endpointResults,
    queries: queryResults,
    throughput: {
      ping: pingThroughput,
      simpleQuery: queryThroughput,
    },
    summary: {
      totalTests: endpointResults.length + queryResults.length,
      successfulTests: successfulEndpoints.length + successfulQueries.length,
      failedTests: (endpointResults.length - successfulEndpoints.length) + (queryResults.length - successfulQueries.length),
      avgPingLatencyMs: avgPingLatency,
      avgQueryLatencyMs: avgQueryLatency,
    },
  };
}

/**
 * Format results as JSON
 */
function formatResultsAsJson(results: BenchmarkResults): string {
  return JSON.stringify(results, null, 2);
}

/**
 * Format milliseconds nicely
 */
function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}us`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format results as Markdown
 */
function formatResultsAsMarkdown(results: BenchmarkResults): string {
  const lines: string[] = [];

  lines.push('# Deployed Worker Benchmark Results');
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **Worker URL:** ${results.metadata.workerUrl}`);
  lines.push(`- **Started:** ${results.metadata.startedAt}`);
  lines.push(`- **Completed:** ${results.metadata.completedAt}`);
  lines.push(`- **Total Duration:** ${formatMs(results.metadata.totalDurationMs)}`);
  lines.push(`- **Iterations:** ${results.metadata.iterations}`);
  lines.push(`- **Warmup Requests:** ${results.metadata.warmup}`);
  lines.push(`- **Concurrency:** ${results.metadata.concurrency}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Tests | ${results.summary.totalTests} |`);
  lines.push(`| Successful | ${results.summary.successfulTests} |`);
  lines.push(`| Failed | ${results.summary.failedTests} |`);
  lines.push(`| Avg Ping Latency | ${formatMs(results.summary.avgPingLatencyMs)} |`);
  lines.push(`| Avg Query Latency | ${formatMs(results.summary.avgQueryLatencyMs)} |`);
  lines.push(`| Ping Throughput | ${results.throughput.ping?.requestsPerSecond.toFixed(2) ?? 'N/A'} req/s |`);
  lines.push(`| Query Throughput | ${results.throughput.simpleQuery?.requestsPerSecond.toFixed(2) ?? 'N/A'} req/s |`);
  lines.push('');

  lines.push('## Endpoint Latency');
  lines.push('');
  lines.push('| Endpoint | Status | Cold Start | P50 | P95 | P99 | Min | Max |');
  lines.push('|----------|--------|------------|-----|-----|-----|-----|-----|');

  for (const result of results.endpoints) {
    const status = result.success ? 'OK' : 'FAIL';
    const lat = result.latency;

    if (lat) {
      lines.push(
        `| ${result.endpoint} | ${status} | ${formatMs(lat.coldStartMs)} | ${formatMs(lat.p50Ms)} | ${formatMs(lat.p95Ms)} | ${formatMs(lat.p99Ms)} | ${formatMs(lat.minMs)} | ${formatMs(lat.maxMs)} |`
      );
    } else {
      lines.push(
        `| ${result.endpoint} | ${status} | - | - | - | - | - | - |`
      );
    }
  }
  lines.push('');

  lines.push('## Query Latency');
  lines.push('');
  lines.push('| Query | Status | Cold Start | P50 | P95 | P99 | Rows |');
  lines.push('|-------|--------|------------|-----|-----|-----|------|');

  for (const result of results.queries) {
    const status = result.success ? 'OK' : 'FAIL';
    const lat = result.latency;

    if (lat) {
      lines.push(
        `| ${result.name} | ${status} | ${formatMs(lat.coldStartMs)} | ${formatMs(lat.p50Ms)} | ${formatMs(lat.p95Ms)} | ${formatMs(lat.p99Ms)} | ${result.rowCount ?? '-'} |`
      );
    } else {
      lines.push(
        `| ${result.name} | ${status} | - | - | - | - | - |`
      );
    }
  }
  lines.push('');

  lines.push('## Throughput');
  lines.push('');
  lines.push('| Test | Requests/sec | Successful | Failed | Duration |');
  lines.push('|------|--------------|------------|--------|----------|');

  if (results.throughput.ping) {
    const t = results.throughput.ping;
    lines.push(
      `| /ping | ${t.requestsPerSecond.toFixed(2)} | ${t.successfulRequests} | ${t.failedRequests} | ${formatMs(t.durationMs)} |`
    );
  }

  if (results.throughput.simpleQuery) {
    const t = results.throughput.simpleQuery;
    lines.push(
      `| SELECT 1 | ${t.requestsPerSecond.toFixed(2)} | ${t.successfulRequests} | ${t.failedRequests} | ${formatMs(t.durationMs)} |`
    );
  }
  lines.push('');

  // Failed tests
  const failedEndpoints = results.endpoints.filter(r => !r.success);
  const failedQueries = results.queries.filter(r => !r.success);

  if (failedEndpoints.length > 0 || failedQueries.length > 0) {
    lines.push('## Failed Tests');
    lines.push('');

    for (const result of failedEndpoints) {
      lines.push(`### ${result.endpoint}`);
      lines.push('');
      lines.push(`**Error:** ${result.error ?? 'Unknown error'}`);
      lines.push('');
    }

    for (const result of failedQueries) {
      lines.push(`### ${result.name}`);
      lines.push('');
      lines.push('```sql');
      lines.push(result.query);
      lines.push('```');
      lines.push('');
      lines.push(`**Error:** ${result.error ?? 'Unknown error'}`);
      lines.push('');
    }
  }

  lines.push('## Query Details');
  lines.push('');

  for (const result of results.queries) {
    lines.push(`### ${result.name}`);
    lines.push('');
    lines.push(`**Description:** ${result.description}`);
    lines.push('');
    lines.push('```sql');
    lines.push(result.query);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Output results to file or stdout
 */
function outputResults(results: BenchmarkResults, config: BenchmarkConfig): void {
  const output = config.format === 'markdown'
    ? formatResultsAsMarkdown(results)
    : formatResultsAsJson(results);

  if (config.outputPath) {
    const outputDir = path.dirname(config.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(config.outputPath, output);
    console.error(`\nResults written to: ${config.outputPath}`);
  } else {
    console.log(output);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = parseArgs(args);

  try {
    const results = await runBenchmarks(config);
    outputResults(results, config);

    // Exit with error code if any tests failed
    if (results.summary.failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nBenchmark failed: ${message}`);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);

// Export for programmatic use
export {
  runBenchmarks,
  type BenchmarkConfig,
  type BenchmarkResults,
  type EndpointBenchmarkResult,
  type QueryBenchmarkResult,
  type LatencyStats,
  type ThroughputStats,
};
