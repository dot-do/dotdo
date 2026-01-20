/**
 * Benchmark Runner
 *
 * Core utilities for running benchmarks and collecting metrics.
 */

import type {
  TimingMeasurement,
  BenchmarkMetrics,
  BenchmarkOptions,
} from './types'
import { DEFAULT_BENCHMARK_OPTIONS } from './types'

/**
 * Calculate statistical metrics from an array of timings
 */
export function calculateMetrics(
  name: string,
  timings: TimingMeasurement[]
): BenchmarkMetrics {
  const durations = timings.map((t) => t.duration).sort((a, b) => a - b)
  const n = durations.length

  if (n === 0) {
    return {
      name,
      iterations: 0,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      p95: 0,
      p99: 0,
      opsPerSecond: 0,
    }
  }

  const sum = durations.reduce((a, b) => a + b, 0)
  const mean = sum / n

  // Variance and standard deviation
  const variance = durations.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / n
  const stdDev = Math.sqrt(variance)

  // Median
  const median =
    n % 2 === 0
      ? (durations[n / 2 - 1] + durations[n / 2]) / 2
      : durations[Math.floor(n / 2)]

  // Percentiles
  const p95Index = Math.floor(n * 0.95)
  const p99Index = Math.floor(n * 0.99)

  return {
    name,
    iterations: n,
    mean,
    median,
    min: durations[0],
    max: durations[n - 1],
    stdDev,
    p95: durations[Math.min(p95Index, n - 1)],
    p99: durations[Math.min(p99Index, n - 1)],
    opsPerSecond: mean > 0 ? 1000 / mean : 0,
  }
}

/**
 * Run a benchmark function and collect metrics
 */
export async function runBenchmark(
  name: string,
  fn: () => void | Promise<void>,
  options: BenchmarkOptions = {}
): Promise<BenchmarkMetrics> {
  const opts = { ...DEFAULT_BENCHMARK_OPTIONS, ...options }
  const timings: TimingMeasurement[] = []

  // Warmup phase
  for (let i = 0; i < opts.warmupIterations; i++) {
    await fn()
  }

  // Main benchmark phase
  for (let i = 0; i < opts.iterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()

    timings.push({
      duration: end - start,
      timestamp: Date.now(),
    })
  }

  return calculateMetrics(name, timings)
}

/**
 * Run a batch of benchmark functions
 */
export async function runBenchmarkBatch(
  name: string,
  setup: () => void | Promise<void>,
  fn: () => void | Promise<void>,
  teardown?: () => void | Promise<void>,
  options: BenchmarkOptions = {}
): Promise<BenchmarkMetrics> {
  const opts = { ...DEFAULT_BENCHMARK_OPTIONS, ...options }
  const timings: TimingMeasurement[] = []

  // Warmup phase
  for (let i = 0; i < opts.warmupIterations; i++) {
    await setup()
    await fn()
    if (teardown) await teardown()
  }

  // Main benchmark phase
  for (let i = 0; i < opts.iterations; i++) {
    await setup()

    const start = performance.now()
    await fn()
    const end = performance.now()

    if (teardown) await teardown()

    timings.push({
      duration: end - start,
      timestamp: Date.now(),
    })
  }

  return calculateMetrics(name, timings)
}

/**
 * Format metrics as a human-readable string
 */
export function formatMetrics(metrics: BenchmarkMetrics): string {
  return [
    `Benchmark: ${metrics.name}`,
    `  Iterations: ${metrics.iterations}`,
    `  Mean: ${metrics.mean.toFixed(3)}ms`,
    `  Median: ${metrics.median.toFixed(3)}ms`,
    `  Min: ${metrics.min.toFixed(3)}ms`,
    `  Max: ${metrics.max.toFixed(3)}ms`,
    `  StdDev: ${metrics.stdDev.toFixed(3)}ms`,
    `  P95: ${metrics.p95.toFixed(3)}ms`,
    `  P99: ${metrics.p99.toFixed(3)}ms`,
    `  Ops/sec: ${metrics.opsPerSecond.toFixed(2)}`,
  ].join('\n')
}

/**
 * Create a high-resolution timer for micro-benchmarks
 */
export function createTimer() {
  let startTime: number

  return {
    start() {
      startTime = performance.now()
    },
    stop(): number {
      return performance.now() - startTime
    },
  }
}

/**
 * Run multiple iterations and return raw timings
 */
export async function collectTimings(
  fn: () => void | Promise<void>,
  iterations: number
): Promise<number[]> {
  const timings: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    timings.push(performance.now() - start)
  }

  return timings
}
