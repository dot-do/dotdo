#!/usr/bin/env npx tsx
/**
 * ClickBench Benchmark Runner
 *
 * Executes all 43 official ClickBench queries against the MergeTree WASM module
 * and outputs results in various formats including ClickBench-compatible JSON.
 *
 * Usage:
 *   npx tsx scripts/run-clickbench.ts [options]
 *
 * Options:
 *   --url <url>         Worker URL (default: http://localhost:8787)
 *   --output <format>   Output format: json, csv, table (default: table)
 *   --runs <n>          Number of runs per query (default: 3)
 *   --query <id>        Run only specific query (0-42)
 *   --export <file>     Export results to file
 *   --clickbench        Output in ClickBench-compatible format
 *   --help              Show this help message
 */

import { CLICKBENCH_QUERIES, QUERY_COUNT } from '../src/clickbench/queries';
import { HITS_TABLE_METADATA } from '../src/clickbench/schema';

// ============================================================================
// Types
// ============================================================================

interface QueryResult {
  queryId: number;
  queryName: string;
  sql: string;
  success: boolean;
  elapsedMs: number;
  rows: number;
  error?: string;
}

interface BenchmarkConfig {
  url: string;
  outputFormat: 'json' | 'csv' | 'table';
  runs: number;
  queryId: number | null;
  exportFile: string | null;
  clickbenchFormat: boolean;
}

interface BenchmarkSummary {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  minElapsedMs: number;
  maxElapsedMs: number;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(args: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    url: 'http://localhost:8787',
    outputFormat: 'table',
    runs: 3,
    queryId: null,
    exportFile: null,
    clickbenchFormat: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--url':
        config.url = args[++i];
        break;
      case '--output':
        config.outputFormat = args[++i] as 'json' | 'csv' | 'table';
        break;
      case '--runs':
        config.runs = parseInt(args[++i], 10);
        break;
      case '--query':
        config.queryId = parseInt(args[++i], 10);
        break;
      case '--export':
        config.exportFile = args[++i];
        break;
      case '--clickbench':
        config.clickbenchFormat = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
ClickBench Benchmark Runner

Executes all 43 official ClickBench queries against the MergeTree WASM module.

Usage:
  npx tsx scripts/run-clickbench.ts [options]

Options:
  --url <url>         Worker URL (default: http://localhost:8787)
  --output <format>   Output format: json, csv, table (default: table)
  --runs <n>          Number of runs per query (default: 3)
  --query <id>        Run only specific query (0-42)
  --export <file>     Export results to file
  --clickbench        Output in ClickBench-compatible format
  --help              Show this help message

Examples:
  # Run all queries locally
  npx tsx scripts/run-clickbench.ts

  # Run against deployed worker
  npx tsx scripts/run-clickbench.ts --url https://chdb.workers.dev

  # Run specific query with 5 runs
  npx tsx scripts/run-clickbench.ts --query 0 --runs 5

  # Export to ClickBench format
  npx tsx scripts/run-clickbench.ts --clickbench --export results.json
`);
}

// ============================================================================
// Benchmark Execution
// ============================================================================

async function runQuery(
  url: string,
  queryId: number,
  runs: number
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  const query = CLICKBENCH_QUERIES[queryId];

  for (let run = 0; run < runs; run++) {
    const startTime = performance.now();

    try {
      const response = await fetch(`${url}/clickbench/run/${queryId}`);
      const elapsedMs = performance.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        results.push({
          queryId,
          queryName: query.name,
          sql: query.sql,
          success: false,
          elapsedMs,
          rows: 0,
          error: errorText,
        });
        continue;
      }

      const data = await response.json() as {
        rows: number;
        elapsedMs: number;
      };

      results.push({
        queryId,
        queryName: query.name,
        sql: query.sql,
        success: true,
        elapsedMs: data.elapsedMs || elapsedMs,
        rows: data.rows,
      });
    } catch (error) {
      results.push({
        queryId,
        queryName: query.name,
        sql: query.sql,
        success: false,
        elapsedMs: performance.now() - startTime,
        rows: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function runAllQueries(
  url: string,
  runs: number,
  queryId: number | null,
  onProgress?: (current: number, total: number) => void
): Promise<Map<number, QueryResult[]>> {
  const results = new Map<number, QueryResult[]>();

  const queriesToRun = queryId !== null
    ? [queryId]
    : Array.from({ length: QUERY_COUNT }, (_, i) => i);

  for (let i = 0; i < queriesToRun.length; i++) {
    const qId = queriesToRun[i];
    onProgress?.(i + 1, queriesToRun.length);

    const queryResults = await runQuery(url, qId, runs);
    results.set(qId, queryResults);
  }

  return results;
}

// ============================================================================
// Result Analysis
// ============================================================================

function calculateSummary(results: Map<number, QueryResult[]>): BenchmarkSummary {
  let totalQueries = 0;
  let successfulQueries = 0;
  let failedQueries = 0;
  let totalElapsedMs = 0;
  let minElapsedMs = Infinity;
  let maxElapsedMs = 0;

  for (const [_, queryResults] of results) {
    totalQueries++;

    // Use best run for each query
    const successfulRuns = queryResults.filter(r => r.success);
    if (successfulRuns.length > 0) {
      successfulQueries++;
      const bestRun = Math.min(...successfulRuns.map(r => r.elapsedMs));
      totalElapsedMs += bestRun;
      minElapsedMs = Math.min(minElapsedMs, bestRun);
      maxElapsedMs = Math.max(maxElapsedMs, bestRun);
    } else {
      failedQueries++;
    }
  }

  return {
    totalQueries,
    successfulQueries,
    failedQueries,
    totalElapsedMs,
    averageElapsedMs: totalElapsedMs / successfulQueries || 0,
    minElapsedMs: minElapsedMs === Infinity ? 0 : minElapsedMs,
    maxElapsedMs,
  };
}

function getBestTimes(results: Map<number, QueryResult[]>): (number | null)[] {
  const bestTimes: (number | null)[] = [];

  for (let i = 0; i < QUERY_COUNT; i++) {
    const queryResults = results.get(i);
    if (!queryResults) {
      bestTimes.push(null);
      continue;
    }

    const successfulRuns = queryResults.filter(r => r.success);
    if (successfulRuns.length === 0) {
      bestTimes.push(null);
    } else {
      bestTimes.push(Math.min(...successfulRuns.map(r => r.elapsedMs)));
    }
  }

  return bestTimes;
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatTable(results: Map<number, QueryResult[]>): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('=' .repeat(100));
  lines.push('ClickBench Results');
  lines.push('=' .repeat(100));
  lines.push('');
  lines.push(
    'Query'.padEnd(6) +
    'Name'.padEnd(40) +
    'Status'.padEnd(10) +
    'Time (ms)'.padEnd(12) +
    'Rows'.padEnd(10)
  );
  lines.push('-'.repeat(100));

  for (let i = 0; i < QUERY_COUNT; i++) {
    const queryResults = results.get(i);
    if (!queryResults) continue;

    const query = CLICKBENCH_QUERIES[i];
    const successfulRuns = queryResults.filter(r => r.success);

    let status: string;
    let timeStr: string;
    let rowsStr: string;

    if (successfulRuns.length > 0) {
      const bestTime = Math.min(...successfulRuns.map(r => r.elapsedMs));
      const rows = successfulRuns[0].rows;
      status = 'OK';
      timeStr = bestTime.toFixed(2);
      rowsStr = String(rows);
    } else {
      status = 'FAIL';
      timeStr = '-';
      rowsStr = '-';
    }

    lines.push(
      String(i).padEnd(6) +
      query.name.substring(0, 38).padEnd(40) +
      status.padEnd(10) +
      timeStr.padEnd(12) +
      rowsStr.padEnd(10)
    );
  }

  // Summary
  const summary = calculateSummary(results);
  lines.push('-'.repeat(100));
  lines.push('');
  lines.push(`Total Queries: ${summary.totalQueries}`);
  lines.push(`Successful: ${summary.successfulQueries}`);
  lines.push(`Failed: ${summary.failedQueries}`);
  lines.push(`Total Time: ${summary.totalElapsedMs.toFixed(2)} ms`);
  lines.push(`Average Time: ${summary.averageElapsedMs.toFixed(2)} ms`);
  lines.push(`Min Time: ${summary.minElapsedMs.toFixed(2)} ms`);
  lines.push(`Max Time: ${summary.maxElapsedMs.toFixed(2)} ms`);
  lines.push('');

  return lines.join('\n');
}

function formatCSV(results: Map<number, QueryResult[]>): string {
  const lines: string[] = [];
  lines.push('query_id,query_name,status,time_ms,rows');

  for (let i = 0; i < QUERY_COUNT; i++) {
    const queryResults = results.get(i);
    if (!queryResults) continue;

    const query = CLICKBENCH_QUERIES[i];
    const successfulRuns = queryResults.filter(r => r.success);

    if (successfulRuns.length > 0) {
      const bestTime = Math.min(...successfulRuns.map(r => r.elapsedMs));
      const rows = successfulRuns[0].rows;
      lines.push(`${i},"${query.name}",OK,${bestTime.toFixed(2)},${rows}`);
    } else {
      const error = queryResults[0]?.error?.replace(/"/g, '""') || 'Unknown error';
      lines.push(`${i},"${query.name}",FAIL,0,0,"${error}"`);
    }
  }

  return lines.join('\n');
}

function formatJSON(results: Map<number, QueryResult[]>): string {
  const output: Record<string, unknown>[] = [];

  for (let i = 0; i < QUERY_COUNT; i++) {
    const queryResults = results.get(i);
    if (!queryResults) continue;

    const query = CLICKBENCH_QUERIES[i];
    const successfulRuns = queryResults.filter(r => r.success);

    if (successfulRuns.length > 0) {
      output.push({
        queryId: i,
        queryName: query.name,
        sql: query.sql,
        status: 'OK',
        timings: successfulRuns.map(r => r.elapsedMs),
        bestTime: Math.min(...successfulRuns.map(r => r.elapsedMs)),
        rows: successfulRuns[0].rows,
      });
    } else {
      output.push({
        queryId: i,
        queryName: query.name,
        sql: query.sql,
        status: 'FAIL',
        error: queryResults[0]?.error,
      });
    }
  }

  return JSON.stringify(output, null, 2);
}

function formatClickBench(results: Map<number, QueryResult[]>): string {
  const bestTimes = getBestTimes(results);

  // ClickBench expects 3 runs per query
  const times: (number | null)[][] = bestTimes.map(t => {
    if (t === null) {
      return [null, null, null];
    }
    // Convert ms to seconds
    return [t / 1000, null, null];
  });

  const output = {
    system: 'chdb-wasm',
    date: new Date().toISOString().split('T')[0],
    machine: 'cloudflare-worker',
    cluster_size: 1,
    comment: 'MergeTree WASM in Cloudflare Workers',
    tags: ['wasm', 'cloudflare', 'mergetree'],
    load_time: 0,
    data_size: HITS_TABLE_METADATA.approximateCompressedSize,
    result: times,
  };

  return JSON.stringify(output, null, 2);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = parseArgs(args);

  console.log('ClickBench Benchmark Runner');
  console.log('===========================');
  console.log(`Target URL: ${config.url}`);
  console.log(`Runs per query: ${config.runs}`);
  console.log(`Output format: ${config.outputFormat}`);
  if (config.queryId !== null) {
    console.log(`Running query: ${config.queryId}`);
  }
  console.log('');

  // Check connection
  console.log('Checking connection...');
  try {
    const response = await fetch(`${config.url}/clickbench`);
    if (!response.ok) {
      console.error(`Failed to connect to ${config.url}/clickbench`);
      console.error(`Status: ${response.status}`);
      process.exit(1);
    }
    console.log('Connection OK');
    console.log('');
  } catch (error) {
    console.error(`Failed to connect to ${config.url}`);
    console.error(error);
    process.exit(1);
  }

  // Run benchmark
  console.log('Running benchmark...');
  const results = await runAllQueries(
    config.url,
    config.runs,
    config.queryId,
    (current, total) => {
      process.stdout.write(`\rProgress: ${current}/${total}`);
    }
  );
  console.log('\n');

  // Format output
  let output: string;
  if (config.clickbenchFormat) {
    output = formatClickBench(results);
  } else {
    switch (config.outputFormat) {
      case 'csv':
        output = formatCSV(results);
        break;
      case 'json':
        output = formatJSON(results);
        break;
      case 'table':
      default:
        output = formatTable(results);
        break;
    }
  }

  // Output results
  console.log(output);

  // Export if requested
  if (config.exportFile) {
    const fs = await import('fs/promises');
    await fs.writeFile(config.exportFile, output);
    console.log(`\nResults exported to: ${config.exportFile}`);
  }
}

main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
