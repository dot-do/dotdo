/**
 * Benchmark Types
 *
 * Type definitions for the benchmark runner infrastructure.
 */

/**
 * Latency statistics calculated from benchmark measurements.
 */
export interface LatencyStats {
  /** 50th percentile (median) latency in milliseconds */
  p50: number
  /** 95th percentile latency in milliseconds */
  p95: number
  /** 99th percentile latency in milliseconds */
  p99: number
  /** Minimum latency in milliseconds */
  min: number
  /** Maximum latency in milliseconds */
  max: number
  /** Mean (average) latency in milliseconds */
  mean: number
  /** Standard deviation in milliseconds */
  stddev: number
}

/**
 * Factory function that creates a new Durable Object instance.
 * Used for cold start benchmarks where each iteration needs a fresh DO.
 */
export type DOFactory<T = unknown> = () => Promise<T>

/**
 * Context passed to benchmark functions.
 */
export interface BenchmarkContext<T = unknown> {
  /** The Durable Object instance (when using doFactory in cold start mode) */
  do?: T
  /** Current iteration number (0-indexed) */
  iteration: number
}

/**
 * Options for configuring a benchmark run.
 */
export interface BenchmarkOptions<T = unknown> {
  /** Number of iterations to measure */
  iterations: number
  /** Number of warmup iterations before measurement (default: 5) */
  warmup?: number
  /** When true, creates a new DO for each iteration */
  coldStart?: boolean
  /** Factory function to create DO instances (required if coldStart is true) */
  doFactory?: DOFactory<T>
  /** Setup hook called once before warmup and iterations */
  setup?: () => Promise<void>
  /** Teardown hook called once after all iterations */
  teardown?: () => Promise<void>
  /** Target colocation to record in results */
  colo?: string
}

/**
 * Result of a benchmark run.
 */
export interface BenchmarkResult {
  /** Name of the benchmark */
  name: string
  /** Number of iterations measured (excludes warmup) */
  iterations: number
  /** Latency statistics */
  stats: LatencyStats
  /** ISO 8601 timestamp of when the benchmark completed */
  timestamp: string
  /** Colocation where the benchmark was run (if available) */
  colo?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}
