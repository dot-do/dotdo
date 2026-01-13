/**
 * Benchmark Runner
 *
 * Core benchmark execution and statistics calculation for measuring
 * Durable Object latency, throughput, and performance.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { BenchmarkOptions, BenchmarkResult, LatencyStats, BenchmarkContext } from './types'

/**
 * Calculate percentile from a sorted array of values.
 * Uses linear interpolation between nearest ranks.
 *
 * @param sorted - Sorted array of numbers
 * @param percentile - Percentile to calculate (0-100)
 * @returns The percentile value
 */
function percentile(sorted: number[], percentile: number): number {
  if (sorted.length === 1) {
    return sorted[0]
  }

  // Calculate the rank (1-indexed position)
  const rank = (percentile / 100) * (sorted.length - 1)
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex]
  }

  // Linear interpolation
  const fraction = rank - lowerIndex
  return sorted[lowerIndex] + fraction * (sorted[upperIndex] - sorted[lowerIndex])
}

/**
 * Calculate latency statistics from an array of latency measurements.
 *
 * @param latencies - Array of latency values in milliseconds
 * @returns Latency statistics including percentiles, min, max, mean, and stddev
 * @throws Error if latencies array is empty
 */
export function calculateStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    throw new Error('Cannot calculate statistics for empty array')
  }

  // Sort for percentile calculations
  const sorted = [...latencies].sort((a, b) => a - b)

  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  // Calculate mean
  const sum = latencies.reduce((acc, val) => acc + val, 0)
  const mean = sum / latencies.length

  // Calculate standard deviation
  const squaredDiffs = latencies.map((val) => Math.pow(val - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / latencies.length
  const stddev = Math.sqrt(avgSquaredDiff)

  // Calculate percentiles
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const p99 = percentile(sorted, 99)

  return {
    p50,
    p95,
    p99,
    min,
    max,
    mean,
    stddev,
  }
}

/**
 * Default warmup iterations (5 or 10% of iterations, whichever is larger)
 */
const DEFAULT_WARMUP_MIN = 5

/**
 * Run a benchmark with the specified options.
 *
 * @param name - Name of the benchmark
 * @param fn - Async function to benchmark
 * @param options - Benchmark configuration options
 * @returns Benchmark result with statistics
 */
export async function benchmark<T = unknown>(
  name: string,
  fn: (context: BenchmarkContext<T>) => Promise<void>,
  options: BenchmarkOptions<T>
): Promise<BenchmarkResult> {
  const { iterations, warmup, coldStart, doFactory, setup, teardown, colo } = options

  // Calculate warmup iterations
  const warmupIterations = warmup ?? Math.max(DEFAULT_WARMUP_MIN, Math.floor(iterations * 0.1))

  // Run setup hook
  if (setup) {
    await setup()
  }

  try {
    // Warmup phase
    for (let i = 0; i < warmupIterations; i++) {
      const context: BenchmarkContext<T> = { iteration: i }

      if (coldStart && doFactory) {
        context.do = await doFactory()
      }

      await fn(context)
    }

    // Measurement phase
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const context: BenchmarkContext<T> = { iteration: i }

      if (coldStart && doFactory) {
        context.do = await doFactory()
      }

      const start = performance.now()
      await fn(context)
      const end = performance.now()

      latencies.push(end - start)
    }

    // Calculate statistics
    const stats = calculateStats(latencies)

    const result: BenchmarkResult = {
      name,
      iterations,
      stats,
      timestamp: new Date().toISOString(),
    }

    if (colo) {
      result.colo = colo
    }

    return result
  } finally {
    // Run teardown hook
    if (teardown) {
      await teardown()
    }
  }
}

/**
 * Default results directory
 */
const DEFAULT_RESULTS_DIR = 'benchmarks/results'
const DEFAULT_RESULTS_FILE = 'benchmark-results.jsonl'

/**
 * Record a benchmark result to a JSONL file.
 *
 * @param result - Benchmark result to record
 * @param filename - Optional file path (defaults to benchmarks/results/benchmark-results.jsonl)
 */
export async function record(result: BenchmarkResult, filename?: string): Promise<void> {
  let filepath: string

  if (filename) {
    filepath = filename
  } else {
    // Use default path relative to project root
    const resultsDir = path.resolve(process.cwd(), DEFAULT_RESULTS_DIR)
    await fs.mkdir(resultsDir, { recursive: true })
    filepath = path.join(resultsDir, DEFAULT_RESULTS_FILE)
  }

  // Ensure parent directory exists
  const dir = path.dirname(filepath)
  await fs.mkdir(dir, { recursive: true })

  // Append result as JSONL
  const line = JSON.stringify(result) + '\n'
  await fs.appendFile(filepath, line, 'utf-8')
}
