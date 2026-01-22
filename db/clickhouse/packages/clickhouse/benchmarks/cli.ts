#!/usr/bin/env node
/**
 * ClickBench Benchmark CLI
 *
 * Command-line interface for running ClickBench benchmarks across different backends.
 *
 * Usage:
 *   npx tsx benchmarks/cli.ts --backends wasm,clickhouse --queries 0,1,2 --runs 3
 *   npx tsx benchmarks/cli.ts --help
 */

import {
  runBenchmarks,
  formatResults,
  formatResultsJson,
  formatResultsCsv,
  type BenchmarkOptions,
  type BenchmarkProgress,
} from './runner';
import { BackendType, getQueryCount, benchmarkConfig } from './config';

/**
 * CLI arguments
 */
interface CliArgs {
  /** Backends to benchmark */
  backends: BackendType[];
  /** Subset of queries to run */
  queries?: number[];
  /** Number of warmup runs */
  warmupRuns: number;
  /** Number of timed runs */
  runs: number;
  /** Timeout per query in ms */
  timeout: number;
  /** Output format */
  format: 'markdown' | 'json' | 'csv';
  /** Output file path */
  output?: string;
  /** Verbose output */
  verbose: boolean;
  /** Show progress */
  progress: boolean;
  /** Show help */
  help: boolean;
  /** ClickHouse URL */
  clickhouseUrl?: string;
  /** ClickHouse username */
  clickhouseUser?: string;
  /** ClickHouse password */
  clickhousePassword?: string;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
ClickBench Benchmark CLI

USAGE:
  npx tsx benchmarks/cli.ts [OPTIONS]

OPTIONS:
  -b, --backends <backends>     Comma-separated list of backends to test
                                Valid values: wasm, sandbox, clickhouse
                                Default: clickhouse

  -q, --queries <queries>       Comma-separated list of query indices (0-42)
                                or a range like "0-10" or "5-15"
                                Default: all 43 queries

  -w, --warmup <runs>           Number of warmup runs before timing
                                Default: ${benchmarkConfig.defaultWarmupRuns}

  -r, --runs <runs>             Number of timed runs per query
                                Default: ${benchmarkConfig.defaultRuns}

  -t, --timeout <ms>            Timeout per query in milliseconds
                                Default: ${benchmarkConfig.defaultTimeout}

  -f, --format <format>         Output format: markdown, json, csv
                                Default: markdown

  -o, --output <file>           Write results to file instead of stdout

  -v, --verbose                 Show verbose output

  -p, --progress                Show progress bar

  --clickhouse-url <url>        ClickHouse server URL
                                Default: http://localhost:8123

  --clickhouse-user <user>      ClickHouse username
                                Default: default

  --clickhouse-password <pass>  ClickHouse password
                                Default: (empty)

  -h, --help                    Show this help message

EXAMPLES:
  # Run all queries on ClickHouse backend
  npx tsx benchmarks/cli.ts --backends clickhouse

  # Run specific queries on multiple backends
  npx tsx benchmarks/cli.ts -b wasm,clickhouse -q 0,1,2,3,4

  # Run queries 0-10 with 5 runs each, output as JSON
  npx tsx benchmarks/cli.ts -b clickhouse -q 0-10 -r 5 -f json

  # Run benchmarks and save to file
  npx tsx benchmarks/cli.ts -b clickhouse -o results.md

  # Connect to remote ClickHouse
  npx tsx benchmarks/cli.ts --clickhouse-url http://clickhouse.example.com:8123 --clickhouse-user admin --clickhouse-password secret

QUERY INDICES:
  Q0-Q42 are the 43 official ClickBench queries.
  Use --queries to run a subset, e.g., --queries 0,1,2 or --queries 0-10
`);
}

/**
 * Parse command-line arguments
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    backends: ['clickhouse'],
    warmupRuns: benchmarkConfig.defaultWarmupRuns,
    runs: benchmarkConfig.defaultRuns,
    timeout: benchmarkConfig.defaultTimeout,
    format: 'markdown',
    verbose: false,
    progress: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;

      case '-b':
      case '--backends':
        if (!nextArg) throw new Error('--backends requires a value');
        args.backends = nextArg.split(',').map((b) => {
          const backend = b.trim().toLowerCase();
          if (!['wasm', 'sandbox', 'clickhouse'].includes(backend)) {
            throw new Error(`Invalid backend: ${backend}. Valid values: wasm, sandbox, clickhouse`);
          }
          return backend as BackendType;
        });
        i++;
        break;

      case '-q':
      case '--queries':
        if (!nextArg) throw new Error('--queries requires a value');
        args.queries = parseQueryRange(nextArg);
        i++;
        break;

      case '-w':
      case '--warmup':
        if (!nextArg) throw new Error('--warmup requires a value');
        args.warmupRuns = parseInt(nextArg, 10);
        if (isNaN(args.warmupRuns) || args.warmupRuns < 0) {
          throw new Error('--warmup must be a non-negative integer');
        }
        i++;
        break;

      case '-r':
      case '--runs':
        if (!nextArg) throw new Error('--runs requires a value');
        args.runs = parseInt(nextArg, 10);
        if (isNaN(args.runs) || args.runs < 1) {
          throw new Error('--runs must be a positive integer');
        }
        i++;
        break;

      case '-t':
      case '--timeout':
        if (!nextArg) throw new Error('--timeout requires a value');
        args.timeout = parseInt(nextArg, 10);
        if (isNaN(args.timeout) || args.timeout < 1) {
          throw new Error('--timeout must be a positive integer');
        }
        i++;
        break;

      case '-f':
      case '--format':
        if (!nextArg) throw new Error('--format requires a value');
        if (!['markdown', 'json', 'csv'].includes(nextArg)) {
          throw new Error(`Invalid format: ${nextArg}. Valid values: markdown, json, csv`);
        }
        args.format = nextArg as 'markdown' | 'json' | 'csv';
        i++;
        break;

      case '-o':
      case '--output':
        if (!nextArg) throw new Error('--output requires a value');
        args.output = nextArg;
        i++;
        break;

      case '-v':
      case '--verbose':
        args.verbose = true;
        break;

      case '-p':
      case '--progress':
        args.progress = true;
        break;

      case '--clickhouse-url':
        if (!nextArg) throw new Error('--clickhouse-url requires a value');
        args.clickhouseUrl = nextArg;
        i++;
        break;

      case '--clickhouse-user':
        if (!nextArg) throw new Error('--clickhouse-user requires a value');
        args.clickhouseUser = nextArg;
        i++;
        break;

      case '--clickhouse-password':
        if (!nextArg) throw new Error('--clickhouse-password requires a value');
        args.clickhousePassword = nextArg;
        i++;
        break;

      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return args;
}

/**
 * Parse query range string (e.g., "0,1,2" or "0-10" or "0,1,5-10")
 */
function parseQueryRange(input: string): number[] {
  const maxQuery = getQueryCount() - 1;
  const queries: Set<number> = new Set();

  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed.includes('-')) {
      // Range like "0-10"
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid query range: ${trimmed}`);
      }
      if (start < 0 || end > maxQuery || start > end) {
        throw new Error(`Query range ${trimmed} out of bounds (0-${maxQuery})`);
      }

      for (let i = start; i <= end; i++) {
        queries.add(i);
      }
    } else {
      // Single number
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) {
        throw new Error(`Invalid query number: ${trimmed}`);
      }
      if (num < 0 || num > maxQuery) {
        throw new Error(`Query ${num} out of bounds (0-${maxQuery})`);
      }
      queries.add(num);
    }
  }

  return [...queries].sort((a, b) => a - b);
}

/**
 * Create a simple progress bar
 */
function createProgressBar(width: number = 40): (progress: BenchmarkProgress) => void {
  let lastLine = '';

  return (progress: BenchmarkProgress): void => {
    const filled = Math.round((progress.percent / 100) * width);
    const empty = width - filled;
    const bar = '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
    const status = progress.isWarmup ? 'warmup' : 'timing';
    const line = `\r${bar} ${progress.percent.toFixed(1)}% | ${progress.backend} Q${progress.query} (${status})`;

    // Only update if changed
    if (line !== lastLine) {
      process.stdout.write(line);
      lastLine = line;
    }
  };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
      printUsage();
      process.exit(0);
    }

    // Build benchmark options
    const options: BenchmarkOptions = {
      backends: args.backends,
      warmupRuns: args.warmupRuns,
      runs: args.runs,
      queries: args.queries,
      timeout: args.timeout,
      verbose: args.verbose,
    };

    // Add custom ClickHouse config if provided
    if (args.clickhouseUrl || args.clickhouseUser || args.clickhousePassword) {
      options.backendConfigs = {
        clickhouse: {
          type: 'clickhouse',
          url: args.clickhouseUrl || 'http://localhost:8123',
          auth: {
            username: args.clickhouseUser || 'default',
            password: args.clickhousePassword || '',
          },
        },
      };
    }

    // Add progress callback if requested
    if (args.progress && !args.verbose) {
      options.onProgress = createProgressBar();
    }

    // Print run configuration
    if (args.verbose) {
      console.log('ClickBench Benchmark Runner');
      console.log('===========================');
      console.log(`Backends: ${args.backends.join(', ')}`);
      console.log(`Queries: ${args.queries ? args.queries.join(', ') : `all (0-${getQueryCount() - 1})`}`);
      console.log(`Warmup runs: ${args.warmupRuns}`);
      console.log(`Timed runs: ${args.runs}`);
      console.log(`Timeout: ${args.timeout}ms`);
      console.log(`Output format: ${args.format}`);
      if (args.output) {
        console.log(`Output file: ${args.output}`);
      }
      console.log('');
    }

    // Run benchmarks
    const results = await runBenchmarks(options);

    // Clear progress line if used
    if (args.progress && !args.verbose) {
      process.stdout.write('\n');
    }

    // Format results
    let output: string;
    switch (args.format) {
      case 'json':
        output = formatResultsJson(results);
        break;
      case 'csv':
        output = formatResultsCsv(results);
        break;
      case 'markdown':
      default:
        output = formatResults(results);
        break;
    }

    // Write output
    if (args.output) {
      const fs = await import('fs');
      fs.writeFileSync(args.output, output, 'utf-8');
      console.log(`Results written to ${args.output}`);
    } else {
      console.log(output);
    }

    // Exit with error if any benchmarks failed
    const failedCount = results.filter((r) => r.error).length;
    if (failedCount > 0) {
      console.error(`\n${failedCount} benchmark(s) failed.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main function
main();
