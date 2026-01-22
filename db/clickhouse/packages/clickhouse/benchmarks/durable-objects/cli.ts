#!/usr/bin/env node
/**
 * Durable Objects Benchmark CLI
 *
 * Command-line interface for running benchmarks against deployed Durable Objects.
 *
 * Usage:
 *   npx tsx benchmarks/durable-objects/cli.ts --url https://your-worker.workers.dev --queries 0-4
 *   npx tsx benchmarks/durable-objects/cli.ts --help
 */

import {
  benchmarkDurableObjects,
  generateReport,
  formatReportMarkdown,
  getHealthStatus,
  testConcurrentAccess,
  type DOBenchmarkOptions,
  type DOBenchmarkProgress,
} from './benchmark';
import { getQueryCount, benchmarkConfig } from '../config';

/**
 * CLI arguments
 */
interface CliArgs {
  /** Durable Object worker URL */
  url: string;
  /** Subset of queries to run */
  queries?: number[];
  /** Number of warmup runs */
  warmupRuns: number;
  /** Number of timed runs */
  timedRuns: number;
  /** Timeout per query in ms */
  timeout: number;
  /** Force cold start for each query */
  forceColdStart: boolean;
  /** Durable Object ID */
  doId: string;
  /** Output format */
  format: 'markdown' | 'json';
  /** Output file path */
  output?: string;
  /** Verbose output */
  verbose: boolean;
  /** Show progress */
  progress: boolean;
  /** Show help */
  help: boolean;
  /** Health check only */
  healthCheck: boolean;
  /** Concurrency test */
  concurrencyTest?: number;
  /** Query for concurrency test */
  concurrencyQuery: number;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Durable Objects Benchmark CLI

USAGE:
  npx tsx benchmarks/durable-objects/cli.ts [OPTIONS]

OPTIONS:
  -u, --url <url>             Durable Object worker URL (required)
                              Example: https://clickbench-do-benchmark.your-subdomain.workers.dev

  -q, --queries <queries>     Comma-separated list of query indices (0-42)
                              or a range like "0-10" or "5-15"
                              Default: all 43 queries

  -w, --warmup <runs>         Number of warmup runs before timing
                              Default: ${benchmarkConfig.defaultWarmupRuns}

  -r, --runs <runs>           Number of timed runs per query
                              Default: ${benchmarkConfig.defaultRuns}

  -t, --timeout <ms>          Timeout per query in milliseconds
                              Default: ${benchmarkConfig.defaultTimeout}

  --cold-start                Force cold start for each query (reset DO)
                              Default: true

  --no-cold-start             Don't force cold start (measure warm-only)

  --do-id <id>                Durable Object ID for isolation
                              Default: benchmark

  -f, --format <format>       Output format: markdown, json
                              Default: markdown

  -o, --output <file>         Write results to file instead of stdout

  -v, --verbose               Show verbose output

  -p, --progress              Show progress bar

  --health                    Health check only (no benchmarks)

  --concurrency <n>           Run concurrency test with n parallel requests

  --concurrency-query <idx>   Query to use for concurrency test
                              Default: 0

  -h, --help                  Show this help message

EXAMPLES:
  # Run all queries
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev

  # Run specific queries with progress
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev -q 0-4 -p

  # Run warm-only benchmark (no cold start reset)
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev --no-cold-start

  # Health check
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev --health

  # Concurrency test
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev --concurrency 10

  # Save results to file
  npx tsx benchmarks/durable-objects/cli.ts -u https://your-worker.workers.dev -o results.md
`);
}

/**
 * Parse command-line arguments
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: '',
    warmupRuns: benchmarkConfig.defaultWarmupRuns,
    timedRuns: benchmarkConfig.defaultRuns,
    timeout: benchmarkConfig.defaultTimeout,
    forceColdStart: true,
    doId: 'benchmark',
    format: 'markdown',
    verbose: false,
    progress: false,
    help: false,
    healthCheck: false,
    concurrencyQuery: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];

    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;

      case '-u':
      case '--url':
        if (!nextArg) throw new Error('--url requires a value');
        args.url = nextArg;
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
        args.timedRuns = parseInt(nextArg, 10);
        if (isNaN(args.timedRuns) || args.timedRuns < 1) {
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

      case '--cold-start':
        args.forceColdStart = true;
        break;

      case '--no-cold-start':
        args.forceColdStart = false;
        break;

      case '--do-id':
        if (!nextArg) throw new Error('--do-id requires a value');
        args.doId = nextArg;
        i++;
        break;

      case '-f':
      case '--format':
        if (!nextArg) throw new Error('--format requires a value');
        if (!['markdown', 'json'].includes(nextArg)) {
          throw new Error(`Invalid format: ${nextArg}. Valid values: markdown, json`);
        }
        args.format = nextArg as 'markdown' | 'json';
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

      case '--health':
        args.healthCheck = true;
        break;

      case '--concurrency':
        if (!nextArg) throw new Error('--concurrency requires a value');
        args.concurrencyTest = parseInt(nextArg, 10);
        if (isNaN(args.concurrencyTest) || args.concurrencyTest < 1) {
          throw new Error('--concurrency must be a positive integer');
        }
        i++;
        break;

      case '--concurrency-query':
        if (!nextArg) throw new Error('--concurrency-query requires a value');
        args.concurrencyQuery = parseInt(nextArg, 10);
        if (isNaN(args.concurrencyQuery) || args.concurrencyQuery < 0) {
          throw new Error('--concurrency-query must be a non-negative integer');
        }
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
 * Parse query range string
 */
function parseQueryRange(input: string): number[] {
  const maxQuery = getQueryCount() - 1;
  const queries: Set<number> = new Set();

  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed.includes('-')) {
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
 * Create a progress bar
 */
function createProgressBar(width: number = 40): (progress: DOBenchmarkProgress) => void {
  let lastLine = '';

  return (progress: DOBenchmarkProgress): void => {
    const filled = Math.round((progress.percent / 100) * width);
    const empty = width - filled;
    const bar = '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
    const line = `\r${bar} ${progress.percent.toFixed(1)}% | ${progress.message}`;

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

    if (!args.url) {
      console.error('Error: --url is required');
      printUsage();
      process.exit(1);
    }

    // Health check mode
    if (args.healthCheck) {
      console.log(`Checking health of ${args.url}...`);
      const health = await getHealthStatus(args.url, args.doId);
      console.log(JSON.stringify(health, null, 2));
      process.exit(health.ok ? 0 : 1);
    }

    // Concurrency test mode
    if (args.concurrencyTest) {
      console.log(`Running concurrency test with ${args.concurrencyTest} parallel requests...`);
      console.log(`Query: Q${args.concurrencyQuery}`);
      console.log(`URL: ${args.url}`);
      console.log('');

      const result = await testConcurrentAccess(
        args.url,
        args.concurrencyQuery,
        args.concurrencyTest,
        args.timeout,
        args.doId
      );

      console.log('Results:');
      console.log(`  Total time: ${result.totalTime.toFixed(2)}ms`);
      console.log(`  Successful: ${result.successCount}/${args.concurrencyTest}`);
      console.log(`  Errors: ${result.errorCount}/${args.concurrencyTest}`);

      if (result.successCount > 0) {
        const times = result.results.filter((r) => !r.error).map((r) => r.elapsed);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        console.log(`  Avg response: ${avg.toFixed(2)}ms`);
        console.log(`  Min response: ${min.toFixed(2)}ms`);
        console.log(`  Max response: ${max.toFixed(2)}ms`);
      }

      process.exit(result.errorCount > 0 ? 1 : 0);
    }

    // Build benchmark options
    const options: DOBenchmarkOptions = {
      doUrl: args.url,
      queries: args.queries,
      warmupRuns: args.warmupRuns,
      timedRuns: args.timedRuns,
      timeout: args.timeout,
      forceColdStart: args.forceColdStart,
      doId: args.doId,
      verbose: args.verbose,
    };

    // Add progress callback if requested
    if (args.progress && !args.verbose) {
      options.onProgress = createProgressBar();
    }

    // Print configuration
    if (args.verbose) {
      console.log('Durable Objects Benchmark Runner');
      console.log('================================');
      console.log(`URL: ${args.url}`);
      console.log(`DO ID: ${args.doId}`);
      console.log(`Queries: ${args.queries ? args.queries.join(', ') : `all (0-${getQueryCount() - 1})`}`);
      console.log(`Warmup runs: ${args.warmupRuns}`);
      console.log(`Timed runs: ${args.timedRuns}`);
      console.log(`Timeout: ${args.timeout}ms`);
      console.log(`Force cold start: ${args.forceColdStart}`);
      console.log(`Output format: ${args.format}`);
      if (args.output) {
        console.log(`Output file: ${args.output}`);
      }
      console.log('');
    }

    // Run benchmarks
    const startTime = new Date();
    const results = await benchmarkDurableObjects(options);
    const endTime = new Date();

    // Clear progress line if used
    if (args.progress && !args.verbose) {
      process.stdout.write('\n');
    }

    // Generate report
    const report = generateReport(results, options, startTime, endTime);

    // Format output
    let output: string;
    if (args.format === 'json') {
      output = JSON.stringify(report, null, 2);
    } else {
      output = formatReportMarkdown(report);
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
    if (report.summary.totalFailedRuns > 0) {
      console.error(`\n${report.summary.totalFailedRuns} benchmark run(s) failed.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main function
main();
