/**
 * ClickBench Benchmark Runner
 *
 * Runs ClickBench queries across different backends (WASM, Sandbox, ClickHouse)
 * and collects timing metrics for comparison.
 */

import {
  benchmarkConfig,
  BackendType,
  BackendConfig,
  defaultBackendConfigs,
  getQuery,
  getQueryCount,
} from './config';

/**
 * Result of a single benchmark run
 */
export interface BenchmarkResult {
  /** Query index (0-42) */
  query: number;
  /** Backend type used */
  backend: string;
  /** Cold run time in milliseconds */
  coldMs: number;
  /** Hot run times in milliseconds (after warmup) */
  hotMs: number[];
  /** Number of rows returned */
  rowsReturned: number;
  /** Bytes processed (if available) */
  bytesProcessed: number;
  /** Error message if query failed */
  error?: string;
}

/**
 * Options for running benchmarks
 */
export interface BenchmarkOptions {
  /** Backends to benchmark */
  backends: BackendType[];
  /** Number of warmup runs before timing */
  warmupRuns?: number;
  /** Number of timed runs per query */
  runs?: number;
  /** Subset of queries to run (by index) */
  queries?: number[];
  /** Timeout per query in milliseconds */
  timeout?: number;
  /** Custom backend configurations */
  backendConfigs?: Partial<Record<BackendType, BackendConfig>>;
  /** Progress callback */
  onProgress?: (progress: BenchmarkProgress) => void;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Progress information during benchmark execution
 */
export interface BenchmarkProgress {
  /** Current backend being tested */
  backend: string;
  /** Current query index */
  query: number;
  /** Total queries to run */
  totalQueries: number;
  /** Current run number */
  run: number;
  /** Total runs (including warmup) */
  totalRuns: number;
  /** Whether this is a warmup run */
  isWarmup: boolean;
  /** Percentage complete (0-100) */
  percent: number;
}

/**
 * Client interface for executing queries
 */
export interface BenchmarkClient {
  /** Execute a query and return results */
  query(sql: string): Promise<QueryResult>;
  /** Close the client connection */
  close(): Promise<void>;
  /** Get client info */
  info(): ClientInfo;
}

/**
 * Query execution result
 */
export interface QueryResult {
  /** Result rows */
  rows: unknown[];
  /** Number of rows returned */
  rowCount: number;
  /** Bytes processed (if available) */
  bytesProcessed?: number;
  /** Execution time as reported by backend (if available) */
  executionTimeMs?: number;
}

/**
 * Client information
 */
export interface ClientInfo {
  /** Backend type */
  type: BackendType;
  /** Version string */
  version?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create a client for a specific backend
 */
export async function createClientForBackend(
  backend: BackendType,
  config?: BackendConfig
): Promise<BenchmarkClient> {
  const backendConfig = config || defaultBackendConfigs[backend];

  switch (backend) {
    case 'wasm':
      return createWasmClient(backendConfig);
    case 'sandbox':
      return createSandboxClient(backendConfig);
    case 'clickhouse':
      return createClickHouseClient(backendConfig);
    default:
      throw new Error(`Unknown backend: ${backend}`);
  }
}

/**
 * Create WASM-based client (chdb-wasm)
 */
async function createWasmClient(config: BackendConfig): Promise<BenchmarkClient> {
  // Note: This is a placeholder implementation
  // In a real implementation, this would load chdb-wasm
  console.log('Creating WASM client with config:', config);

  return {
    async query(sql: string): Promise<QueryResult> {
      // Placeholder: In production, this would use chdb-wasm
      // const chdb = await import('chdb-wasm');
      // const result = await chdb.query(sql);
      throw new Error(
        'WASM backend not yet implemented. Install chdb-wasm and implement the client.'
      );
    },
    async close(): Promise<void> {
      // Cleanup WASM resources
    },
    info(): ClientInfo {
      return {
        type: 'wasm',
        version: 'placeholder',
        metadata: { dataPath: config.dataPath },
      };
    },
  };
}

/**
 * Create Sandbox-based client (chdb in sandbox environment)
 */
async function createSandboxClient(config: BackendConfig): Promise<BenchmarkClient> {
  // Note: This is a placeholder implementation
  // In a real implementation, this would connect to a sandbox service
  console.log('Creating Sandbox client with config:', config);

  return {
    async query(sql: string): Promise<QueryResult> {
      // Placeholder: In production, this would call a sandbox API
      throw new Error(
        'Sandbox backend not yet implemented. Configure sandbox service and implement the client.'
      );
    },
    async close(): Promise<void> {
      // Cleanup sandbox resources
    },
    info(): ClientInfo {
      return {
        type: 'sandbox',
        version: 'placeholder',
        metadata: { dataPath: config.dataPath },
      };
    },
  };
}

/**
 * Create ClickHouse HTTP client
 */
async function createClickHouseClient(config: BackendConfig): Promise<BenchmarkClient> {
  const url = config.url || 'http://localhost:8123';
  const auth = config.auth;

  // Build auth header if credentials provided
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
  };
  if (auth) {
    const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  // Test connection
  try {
    const response = await fetch(`${url}/ping`, { headers });
    if (!response.ok) {
      throw new Error(`ClickHouse ping failed: ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Failed to connect to ClickHouse at ${url}: ${error}`);
  }

  return {
    async query(sql: string): Promise<QueryResult> {
      const queryUrl = new URL(url);
      queryUrl.searchParams.set('default_format', 'JSON');

      const response = await fetch(queryUrl.toString(), {
        method: 'POST',
        headers,
        body: sql,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ClickHouse query failed: ${errorText}`);
      }

      const result = await response.json();

      return {
        rows: result.data || [],
        rowCount: result.rows || (result.data?.length ?? 0),
        bytesProcessed: result.statistics?.bytes_read,
        executionTimeMs: result.statistics?.elapsed
          ? result.statistics.elapsed * 1000
          : undefined,
      };
    },
    async close(): Promise<void> {
      // HTTP client has no persistent connection to close
    },
    info(): ClientInfo {
      return {
        type: 'clickhouse',
        version: 'http',
        metadata: { url },
      };
    },
  };
}

/**
 * Run a single benchmark for a query
 */
async function runSingleBenchmark(
  client: BenchmarkClient,
  query: string,
  queryIndex: number,
  backend: BackendType,
  options: BenchmarkOptions
): Promise<BenchmarkResult> {
  const warmupRuns = options.warmupRuns ?? benchmarkConfig.defaultWarmupRuns;
  const runs = options.runs ?? benchmarkConfig.defaultRuns;
  const timeout = options.timeout ?? benchmarkConfig.defaultTimeout;

  const result: BenchmarkResult = {
    query: queryIndex,
    backend,
    coldMs: 0,
    hotMs: [],
    rowsReturned: 0,
    bytesProcessed: 0,
  };

  try {
    // Cold run (first run, no warmup)
    const coldStart = performance.now();
    const coldResult = await Promise.race([
      client.query(query),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), timeout)
      ),
    ]);
    result.coldMs = performance.now() - coldStart;
    result.rowsReturned = coldResult.rowCount;
    result.bytesProcessed = coldResult.bytesProcessed || 0;

    // Report progress for cold run
    if (options.onProgress) {
      options.onProgress({
        backend,
        query: queryIndex,
        totalQueries: options.queries?.length ?? getQueryCount(),
        run: 0,
        totalRuns: warmupRuns + runs + 1,
        isWarmup: false,
        percent: 0,
      });
    }

    // Warmup runs
    for (let i = 0; i < warmupRuns; i++) {
      await Promise.race([
        client.query(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), timeout)
        ),
      ]);

      if (options.onProgress) {
        options.onProgress({
          backend,
          query: queryIndex,
          totalQueries: options.queries?.length ?? getQueryCount(),
          run: i + 1,
          totalRuns: warmupRuns + runs + 1,
          isWarmup: true,
          percent: ((i + 1) / (warmupRuns + runs + 1)) * 100,
        });
      }
    }

    // Timed runs
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await Promise.race([
        client.query(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), timeout)
        ),
      ]);
      result.hotMs.push(performance.now() - start);

      if (options.onProgress) {
        options.onProgress({
          backend,
          query: queryIndex,
          totalQueries: options.queries?.length ?? getQueryCount(),
          run: warmupRuns + i + 1,
          totalRuns: warmupRuns + runs + 1,
          isWarmup: false,
          percent: ((warmupRuns + i + 2) / (warmupRuns + runs + 1)) * 100,
        });
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * Run benchmarks across all specified backends and queries
 */
export async function runBenchmarks(options: BenchmarkOptions): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const queryIndices = options.queries ?? Array.from({ length: getQueryCount() }, (_, i) => i);

  for (const backend of options.backends) {
    if (options.verbose) {
      console.log(`\nStarting benchmarks for backend: ${backend}`);
    }

    let client: BenchmarkClient;
    try {
      const backendConfig = options.backendConfigs?.[backend] || defaultBackendConfigs[backend];
      client = await createClientForBackend(backend, backendConfig);
    } catch (error) {
      // If client creation fails, add error results for all queries
      if (options.verbose) {
        console.error(`Failed to create client for ${backend}:`, error);
      }
      for (const queryIndex of queryIndices) {
        results.push({
          query: queryIndex,
          backend,
          coldMs: 0,
          hotMs: [],
          rowsReturned: 0,
          bytesProcessed: 0,
          error: `Client creation failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      continue;
    }

    try {
      for (const queryIndex of queryIndices) {
        const query = getQuery(queryIndex);

        if (options.verbose) {
          console.log(`  Running Q${queryIndex}...`);
        }

        const result = await runSingleBenchmark(client, query, queryIndex, backend, options);
        results.push(result);

        if (options.verbose) {
          if (result.error) {
            console.log(`    Error: ${result.error}`);
          } else {
            const avgHot =
              result.hotMs.length > 0
                ? result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length
                : 0;
            console.log(
              `    Cold: ${result.coldMs.toFixed(2)}ms, Avg Hot: ${avgHot.toFixed(2)}ms, Rows: ${result.rowsReturned}`
            );
          }
        }
      }
    } finally {
      await client.close();
    }
  }

  return results;
}

/**
 * Format benchmark results as a markdown table
 */
export function formatResults(results: BenchmarkResult[]): string {
  if (results.length === 0) {
    return 'No benchmark results to display.';
  }

  // Group results by query
  const byQuery = new Map<number, Map<string, BenchmarkResult>>();
  for (const result of results) {
    if (!byQuery.has(result.query)) {
      byQuery.set(result.query, new Map());
    }
    byQuery.get(result.query)!.set(result.backend, result);
  }

  // Get unique backends
  const backends = [...new Set(results.map((r) => r.backend))];

  // Build header
  const lines: string[] = [];
  lines.push('# ClickBench Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');

  // Header row
  const headerCols = ['Query', ...backends.map((b) => `${b} (cold)`), ...backends.map((b) => `${b} (hot avg)`)];
  lines.push(`| ${headerCols.join(' | ')} |`);
  lines.push(`| ${headerCols.map(() => '---').join(' | ')} |`);

  // Data rows
  const sortedQueries = [...byQuery.keys()].sort((a, b) => a - b);
  for (const queryIndex of sortedQueries) {
    const queryResults = byQuery.get(queryIndex)!;
    const cols: string[] = [`Q${queryIndex}`];

    // Cold times
    for (const backend of backends) {
      const result = queryResults.get(backend);
      if (result?.error) {
        cols.push('ERROR');
      } else if (result) {
        cols.push(`${result.coldMs.toFixed(2)}ms`);
      } else {
        cols.push('-');
      }
    }

    // Hot average times
    for (const backend of backends) {
      const result = queryResults.get(backend);
      if (result?.error) {
        cols.push('ERROR');
      } else if (result && result.hotMs.length > 0) {
        const avg = result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length;
        cols.push(`${avg.toFixed(2)}ms`);
      } else {
        cols.push('-');
      }
    }

    lines.push(`| ${cols.join(' | ')} |`);
  }

  lines.push('');

  // Detailed results
  lines.push('## Detailed Results');
  lines.push('');

  for (const queryIndex of sortedQueries) {
    const queryResults = byQuery.get(queryIndex)!;
    lines.push(`### Query ${queryIndex}`);
    lines.push('');
    lines.push('```sql');
    lines.push(getQuery(queryIndex));
    lines.push('```');
    lines.push('');

    lines.push('| Backend | Cold (ms) | Hot Runs (ms) | Avg Hot (ms) | Rows | Bytes | Error |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');

    for (const backend of backends) {
      const result = queryResults.get(backend);
      if (result) {
        const hotStr = result.hotMs.map((t) => t.toFixed(2)).join(', ') || '-';
        const avgHot =
          result.hotMs.length > 0
            ? (result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length).toFixed(2)
            : '-';
        const error = result.error || '-';
        lines.push(
          `| ${backend} | ${result.coldMs.toFixed(2)} | ${hotStr} | ${avgHot} | ${result.rowsReturned} | ${result.bytesProcessed} | ${error} |`
        );
      } else {
        lines.push(`| ${backend} | - | - | - | - | - | No data |`);
      }
    }

    lines.push('');
  }

  // Summary statistics
  lines.push('## Statistics');
  lines.push('');

  for (const backend of backends) {
    const backendResults = results.filter((r) => r.backend === backend && !r.error);
    if (backendResults.length === 0) continue;

    const coldTimes = backendResults.map((r) => r.coldMs);
    const allHotTimes = backendResults.flatMap((r) => r.hotMs);

    lines.push(`### ${backend}`);
    lines.push('');
    lines.push(`- Queries run: ${backendResults.length}`);
    lines.push(`- Total cold time: ${coldTimes.reduce((a, b) => a + b, 0).toFixed(2)}ms`);
    lines.push(`- Average cold time: ${(coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length).toFixed(2)}ms`);
    if (allHotTimes.length > 0) {
      lines.push(`- Average hot time: ${(allHotTimes.reduce((a, b) => a + b, 0) / allHotTimes.length).toFixed(2)}ms`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format results as JSON
 */
export function formatResultsJson(results: BenchmarkResult[]): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      results,
      summary: generateSummary(results),
    },
    null,
    2
  );
}

/**
 * Generate summary statistics from results
 */
function generateSummary(results: BenchmarkResult[]): Record<string, unknown> {
  const backends = [...new Set(results.map((r) => r.backend))];
  const summary: Record<string, unknown> = {};

  for (const backend of backends) {
    const backendResults = results.filter((r) => r.backend === backend);
    const successfulResults = backendResults.filter((r) => !r.error);

    const coldTimes = successfulResults.map((r) => r.coldMs);
    const allHotTimes = successfulResults.flatMap((r) => r.hotMs);

    summary[backend] = {
      queriesTotal: backendResults.length,
      queriesSuccessful: successfulResults.length,
      queriesFailed: backendResults.length - successfulResults.length,
      totalColdTimeMs: coldTimes.reduce((a, b) => a + b, 0),
      avgColdTimeMs: coldTimes.length > 0 ? coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length : 0,
      avgHotTimeMs: allHotTimes.length > 0 ? allHotTimes.reduce((a, b) => a + b, 0) / allHotTimes.length : 0,
      totalBytesProcessed: successfulResults.reduce((a, b) => a + b.bytesProcessed, 0),
      totalRowsReturned: successfulResults.reduce((a, b) => a + b.rowsReturned, 0),
    };
  }

  return summary;
}

/**
 * Format results as CSV
 */
export function formatResultsCsv(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  lines.push('query,backend,cold_ms,hot_avg_ms,hot_min_ms,hot_max_ms,rows_returned,bytes_processed,error');

  for (const result of results) {
    const hotAvg =
      result.hotMs.length > 0
        ? result.hotMs.reduce((a, b) => a + b, 0) / result.hotMs.length
        : 0;
    const hotMin = result.hotMs.length > 0 ? Math.min(...result.hotMs) : 0;
    const hotMax = result.hotMs.length > 0 ? Math.max(...result.hotMs) : 0;

    lines.push(
      [
        result.query,
        result.backend,
        result.coldMs.toFixed(2),
        hotAvg.toFixed(2),
        hotMin.toFixed(2),
        hotMax.toFixed(2),
        result.rowsReturned,
        result.bytesProcessed,
        result.error ? `"${result.error.replace(/"/g, '""')}"` : '',
      ].join(',')
    );
  }

  return lines.join('\n');
}
