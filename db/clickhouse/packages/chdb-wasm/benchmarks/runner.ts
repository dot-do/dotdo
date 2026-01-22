#!/usr/bin/env node
/**
 * ClickBench Benchmark Runner
 *
 * Executes benchmark queries against chdb-wasm and measures performance.
 *
 * Usage:
 *   npx tsx benchmarks/runner.ts [options]
 *
 * Options:
 *   --iterations, -n  Number of iterations per query (default: 5)
 *   --timeout, -t     Timeout per query in milliseconds (default: 30000)
 *   --output, -o      Output file path (default: stdout)
 *   --format, -f      Output format: json | markdown (default: json)
 *   --queries, -q     Comma-separated list of query IDs to run (default: all)
 *   --category, -c    Run only queries in this category
 *   --verbose, -v     Enable verbose output
 *   --hits-table      Use ClickBench queries (requires hits table)
 *   --dry-run         Show what would be run without executing
 *   --help, -h        Show help message
 *
 * Environment:
 *   This benchmark runner is designed to work in Cloudflare Workers environments.
 *   For local Node.js testing, WASM loading may have compatibility limitations.
 *   Use --dry-run to validate the benchmark configuration without execution.
 */

import * as fsSync from 'fs';
import { fileURLToPath } from 'url';

// Polyfill fetch for file:// URLs in Node.js
// Node.js native fetch doesn't support file:// protocol
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith('file://')) {
    try {
      const filePath = fileURLToPath(url);
      const buffer = fsSync.readFileSync(filePath);
      return new Response(buffer, {
        status: 200,
        headers: {
          'content-type': url.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File read failed';
      return new Response(null, { status: 404, statusText: message });
    }
  }

  return originalFetch(input, init);
};

import { createChdb, type ChdbInstance } from '../src/index';
import {
  CLICKBENCH_QUERIES,
  SIMPLE_TEST_QUERIES,
  getQueryById,
  getQueriesByCategory,
  type BenchmarkQuery,
} from './queries';
import {
  ResultCollector,
  formatResultsAsJson,
  formatResultsAsMarkdown,
  type BenchmarkResults,
} from './results';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration options for the benchmark runner.
 */
interface BenchmarkConfig {
  /** Number of iterations per query */
  iterations: number;
  /** Timeout per query in milliseconds */
  timeoutMs: number;
  /** Output file path (null for stdout) */
  outputPath: string | null;
  /** Output format */
  format: 'json' | 'markdown';
  /** Query IDs to run (null for all) */
  queryIds: string[] | null;
  /** Category filter */
  category: string | null;
  /** Enable verbose output */
  verbose: boolean;
  /** Use ClickBench queries (requires hits table) */
  useHitsTable: boolean;
  /** Dry run - show what would be run without executing */
  dryRun: boolean;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  iterations: 5,
  timeoutMs: 30000,
  outputPath: null,
  format: 'json',
  queryIds: null,
  category: null,
  verbose: false,
  useHitsTable: false,
  dryRun: false,
};

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--iterations':
      case '-n':
        config.iterations = parseInt(args[++i], 10);
        break;
      case '--timeout':
      case '-t':
        config.timeoutMs = parseInt(args[++i], 10);
        break;
      case '--output':
      case '-o':
        config.outputPath = args[++i];
        break;
      case '--format':
      case '-f':
        config.format = args[++i] as 'json' | 'markdown';
        break;
      case '--queries':
      case '-q':
        config.queryIds = args[++i].split(',').map(s => s.trim());
        break;
      case '--category':
      case '-c':
        config.category = args[++i];
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--hits-table':
        config.useHitsTable = true;
        break;
      case '--dry-run':
        config.dryRun = true;
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

  return config;
}

/**
 * Print help message.
 */
function printHelp(): void {
  console.log(`
ClickBench Benchmark Runner

Usage:
  npx tsx benchmarks/runner.ts [options]

Options:
  --iterations, -n  Number of iterations per query (default: 5)
  --timeout, -t     Timeout per query in milliseconds (default: 30000)
  --output, -o      Output file path (default: stdout)
  --format, -f      Output format: json | markdown (default: json)
  --queries, -q     Comma-separated list of query IDs to run (default: all)
  --category, -c    Run only queries in this category
  --verbose, -v     Enable verbose output
  --hits-table      Use ClickBench queries (requires hits table)
  --dry-run         Show what would be run without executing
  --help, -h        Show help message

Environment Notes:
  This benchmark runner is designed for Cloudflare Workers environments.
  For local Node.js testing, WASM loading may have compatibility issues.
  Use --dry-run to validate configuration without execution.

Examples:
  # Run all simple test queries with default settings
  npx tsx benchmarks/runner.ts

  # Run with 10 iterations and markdown output
  npx tsx benchmarks/runner.ts -n 10 -f markdown -o results.md

  # Run specific queries
  npx tsx benchmarks/runner.ts -q T0,T1,T2

  # Run only aggregation queries
  npx tsx benchmarks/runner.ts -c aggregation

  # Run ClickBench queries (requires hits table)
  npx tsx benchmarks/runner.ts --hits-table
  `);
}

/**
 * Log message if verbose mode is enabled.
 */
function log(config: BenchmarkConfig, message: string): void {
  if (config.verbose) {
    console.error(`[${new Date().toISOString()}] ${message}`);
  }
}

/**
 * Progress logger for benchmark runs.
 */
function logProgress(
  config: BenchmarkConfig,
  queryIndex: number,
  totalQueries: number,
  query: BenchmarkQuery,
  result?: { success: boolean; timeMs?: number; error?: string }
): void {
  const progress = `[${queryIndex + 1}/${totalQueries}]`;
  const queryInfo = `${query.id}: ${query.description}`;

  if (result) {
    if (result.success) {
      console.error(`${progress} OK: ${queryInfo} (${result.timeMs?.toFixed(2)}ms avg)`);
    } else {
      console.error(`${progress} FAIL: ${queryInfo} - ${result.error}`);
    }
  } else {
    log(config, `${progress} Running: ${queryInfo}`);
  }
}

/**
 * Execute a single query with timeout.
 */
async function executeQueryWithTimeout(
  chdb: ChdbInstance,
  sql: string,
  timeoutMs: number
): Promise<{ result: string; durationMs: number }> {
  const start = performance.now();

  const resultPromise = chdb.query(sql, { format: 'JSON' });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  const result = await Promise.race([resultPromise, timeoutPromise]);
  const durationMs = performance.now() - start;

  return { result, durationMs };
}

/**
 * Run benchmark for a single query.
 */
async function runQueryBenchmark(
  chdb: ChdbInstance,
  query: BenchmarkQuery,
  config: BenchmarkConfig
): Promise<{ runTimes: number[]; rowCount?: number; resultSize?: number; error?: string }> {
  const runTimes: number[] = [];
  let rowCount: number | undefined;
  let resultSize: number | undefined;

  try {
    for (let i = 0; i < config.iterations; i++) {
      log(config, `  Iteration ${i + 1}/${config.iterations}`);

      const { result, durationMs } = await executeQueryWithTimeout(
        chdb,
        query.sql,
        config.timeoutMs
      );

      runTimes.push(durationMs);

      // Extract row count from first run
      if (i === 0) {
        resultSize = result.length;
        try {
          const parsed = JSON.parse(result);
          if (parsed.data && Array.isArray(parsed.data)) {
            rowCount = parsed.data.length;
          } else if (parsed.rows !== undefined) {
            rowCount = parsed.rows;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    return { runTimes, rowCount, resultSize };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { runTimes, error: errorMessage };
  }
}

/**
 * Check if hits table exists.
 */
async function checkHitsTable(chdb: ChdbInstance): Promise<boolean> {
  try {
    await chdb.query("SELECT 1 FROM hits LIMIT 1", { format: 'JSON' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Select queries based on configuration.
 */
function selectQueries(config: BenchmarkConfig, hitsTableAvailable: boolean): BenchmarkQuery[] {
  // Determine base query set
  let queries = config.useHitsTable && hitsTableAvailable
    ? CLICKBENCH_QUERIES
    : SIMPLE_TEST_QUERIES;

  // Filter by category if specified
  if (config.category) {
    queries = getQueriesByCategory(queries, config.category as BenchmarkQuery['category']);
  }

  // Filter by query IDs if specified
  if (config.queryIds) {
    queries = config.queryIds
      .map(id => getQueryById(queries, id) ?? getQueryById(SIMPLE_TEST_QUERIES, id))
      .filter((q): q is BenchmarkQuery => q !== undefined);
  }

  return queries;
}

/**
 * Main benchmark runner.
 */
async function runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResults> {
  console.error('Initializing chdb-wasm...');
  const chdb = await createChdb({
    logging: config.verbose,
    memoryLimit: 256 * 1024 * 1024, // 256MB for benchmarks
  });

  try {
    // Check if hits table is available
    const hitsTableAvailable = config.useHitsTable && await checkHitsTable(chdb);

    if (config.useHitsTable && !hitsTableAvailable) {
      console.error('Warning: --hits-table specified but hits table not found. Using simple test queries.');
    }

    const usingClickBenchData = config.useHitsTable && hitsTableAvailable;

    // Select queries to run
    const queries = selectQueries(config, hitsTableAvailable);

    if (queries.length === 0) {
      console.error('No queries selected. Check your --queries or --category filters.');
      process.exit(1);
    }

    console.error(`Running ${queries.length} queries with ${config.iterations} iterations each...`);
    console.error('');

    // Initialize result collector
    const collector = new ResultCollector({
      iterations: config.iterations,
      timeoutMs: config.timeoutMs,
      usingClickBenchData,
    });

    // Run each query
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      logProgress(config, i, queries.length, query);

      const { runTimes, rowCount, resultSize, error } = await runQueryBenchmark(
        chdb,
        query,
        config
      );

      if (error) {
        collector.addFailure(query, error);
        logProgress(config, i, queries.length, query, { success: false, error });
      } else if (runTimes.length > 0) {
        const avgTime = runTimes.reduce((a, b) => a + b, 0) / runTimes.length;
        collector.addSuccess(query, runTimes, rowCount, resultSize);
        logProgress(config, i, queries.length, query, { success: true, timeMs: avgTime });
      } else {
        collector.addFailure(query, 'No run times recorded');
        logProgress(config, i, queries.length, query, { success: false, error: 'No runs completed' });
      }
    }

    console.error('');
    console.error('Benchmark complete.');

    return collector.finalize();
  } finally {
    chdb.dispose();
  }
}

/**
 * Output results to file or stdout.
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
    console.error(`Results written to: ${config.outputPath}`);
  } else {
    console.log(output);
  }
}

/**
 * Run a dry-run showing what queries would be executed.
 */
function runDryRun(config: BenchmarkConfig): void {
  const queries = selectQueries(config, false);

  console.log('ClickBench Benchmark - Dry Run');
  console.log('==============================');
  console.log('');
  console.log(`Configuration:`);
  console.log(`  Iterations: ${config.iterations}`);
  console.log(`  Timeout: ${config.timeoutMs}ms`);
  console.log(`  Output format: ${config.format}`);
  console.log(`  Output path: ${config.outputPath || '(stdout)'}`);
  console.log(`  Use hits table: ${config.useHitsTable}`);
  console.log('');
  console.log(`Queries to run (${queries.length} total):`);
  console.log('');

  // Group by category
  const byCategory = new Map<string, typeof queries>();
  for (const q of queries) {
    if (!byCategory.has(q.category)) {
      byCategory.set(q.category, []);
    }
    byCategory.get(q.category)!.push(q);
  }

  for (const [category, categoryQueries] of byCategory) {
    console.log(`  ${category} (${categoryQueries.length} queries):`);
    for (const q of categoryQueries) {
      console.log(`    ${q.id}: ${q.description}`);
    }
    console.log('');
  }

  console.log('Run without --dry-run to execute benchmarks.');
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = parseArgs(args);

  // Handle dry-run mode
  if (config.dryRun) {
    runDryRun(config);
    return;
  }

  try {
    const results = await runBenchmarks(config);
    outputResults(results, config);

    // Exit with error code if any queries failed
    if (results.summary.failedQueries > 0) {
      console.error(`\n${results.summary.failedQueries} queries failed.`);
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Provide helpful context for common errors
    if (message.includes('fetch failed') || message.includes('file://') || message.includes('URL must be')) {
      console.error('Benchmark initialization failed.');
      console.error('');
      console.error('This error typically occurs when running in Node.js locally.');
      console.error('chdb WASM may have compatibility limitations with Node.js fetch for file:// URLs.');
      console.error('');
      console.error('Options:');
      console.error('  1. Use --dry-run to validate configuration without execution');
      console.error('  2. Run benchmarks in a Cloudflare Workers environment');
      console.error('  3. Deploy to staging and run benchmarks there');
      console.error('');
      console.error(`Original error: ${message}`);
    } else {
      console.error('Benchmark failed:', message);
    }
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);

// Export for programmatic use
export { runBenchmarks, type BenchmarkConfig };
