/**
 * Benchmark Types and Interfaces
 *
 * Defines the core types for performance benchmarking including metrics,
 * baselines, configuration, and comparison results.
 */

/** Individual timing measurement */
export interface TimingMeasurement {
  /** Duration in milliseconds */
  duration: number
  /** Timestamp when measurement was taken */
  timestamp: number
}

/** Statistical metrics for a benchmark */
export interface BenchmarkMetrics {
  /** Benchmark name/identifier */
  name: string
  /** Number of iterations */
  iterations: number
  /** Average duration in milliseconds */
  mean: number
  /** Median duration in milliseconds */
  median: number
  /** Minimum duration in milliseconds */
  min: number
  /** Maximum duration in milliseconds */
  max: number
  /** Standard deviation in milliseconds */
  stdDev: number
  /** 95th percentile in milliseconds */
  p95: number
  /** 99th percentile in milliseconds */
  p99: number
  /** Operations per second */
  opsPerSecond: number
}

/** Baseline metrics for comparison */
export interface BaselineMetrics {
  /** Version/commit identifier */
  version: string
  /** Timestamp when baseline was captured */
  capturedAt: string
  /** Environment info (e.g., Node version, platform) */
  environment: {
    nodeVersion: string
    platform: string
    arch: string
  }
  /** Benchmark results by name */
  benchmarks: Record<string, BenchmarkMetrics>
}

/** Configuration for benchmark thresholds */
export interface ThresholdConfig {
  /** Default regression threshold as percentage (e.g., 10 = 10% slower) */
  defaultRegressionThreshold: number
  /** Per-benchmark threshold overrides */
  thresholds?: Record<string, {
    /** Regression threshold percentage for this benchmark */
    regressionThreshold?: number
    /** Whether this benchmark is critical (fails CI on regression) */
    critical?: boolean
  }>
}

/** Result of comparing current vs baseline */
export interface ComparisonResult {
  /** Benchmark name */
  name: string
  /** Current metrics */
  current: BenchmarkMetrics
  /** Baseline metrics (if available) */
  baseline?: BenchmarkMetrics
  /** Percentage change (positive = slower) */
  percentChange: number
  /** Whether this is a regression */
  isRegression: boolean
  /** Whether this benchmark is critical */
  isCritical: boolean
  /** Human-readable summary */
  summary: string
}

/** Full comparison report */
export interface ComparisonReport {
  /** Timestamp of comparison */
  timestamp: string
  /** Current version/commit */
  currentVersion: string
  /** Baseline version/commit */
  baselineVersion?: string
  /** Individual comparison results */
  results: ComparisonResult[]
  /** Whether any critical regressions were detected */
  hasCriticalRegressions: boolean
  /** Total number of regressions */
  regressionCount: number
  /** Total number of improvements */
  improvementCount: number
}

/** Benchmark runner options */
export interface BenchmarkOptions {
  /** Number of iterations to run */
  iterations?: number
  /** Warmup iterations (not counted) */
  warmupIterations?: number
  /** Whether to collect individual timings */
  collectTimings?: boolean
  /** Timeout per iteration in milliseconds */
  timeout?: number
}

/** Default benchmark options */
export const DEFAULT_BENCHMARK_OPTIONS: Required<BenchmarkOptions> = {
  iterations: 100,
  warmupIterations: 10,
  collectTimings: true,
  timeout: 30000,
}

/** Default threshold configuration */
export const DEFAULT_THRESHOLD_CONFIG: ThresholdConfig = {
  defaultRegressionThreshold: 10,
  thresholds: {
    'rpc-call-latency': { regressionThreshold: 15, critical: true },
    'do-instantiation': { regressionThreshold: 20, critical: true },
    'storage-read': { regressionThreshold: 10, critical: true },
    'storage-write': { regressionThreshold: 10, critical: true },
    'websocket-throughput': { regressionThreshold: 15, critical: false },
    // Entity benchmarks
    'entity-create-single': { regressionThreshold: 15, critical: true },
    'entity-get-single': { regressionThreshold: 10, critical: true },
    'entity-bulk-create-10': { regressionThreshold: 15, critical: true },
    'entity-bulk-create-100': { regressionThreshold: 20, critical: false },
    // Relationship benchmarks
    'relationship-create-single': { regressionThreshold: 15, critical: true },
    'relationship-query-by-subject': { regressionThreshold: 15, critical: true },
    'relationship-getRelated': { regressionThreshold: 15, critical: true },
    // Graph traversal benchmarks
    'graph-traversal-2-hops': { regressionThreshold: 20, critical: false },
    'entity-fetch-with-related': { regressionThreshold: 15, critical: true },
  },
}
