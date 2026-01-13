import { createContext, type BenchmarkContext } from './context'
import { calculateStats, type LatencyStats } from './stats'
import type { BenchmarkResult } from './reporter'

export type { BenchmarkResult } from './reporter'

/**
 * Configuration for a benchmark run
 */
export interface BenchmarkConfig {
  /** Benchmark name (used for identification in results) */
  name: string

  /** Target DO endpoint (e.g., 'promote.perf.do') */
  target: string

  /** Number of iterations to record */
  iterations: number

  /** Number of warmup iterations (not recorded in results) */
  warmup?: number

  /** Force new DO instance each iteration (cold start testing) */
  coldStart?: boolean

  /** Dataset size for the benchmark (metadata) */
  datasetSize?: number

  /** Number of shards (metadata) */
  shardCount?: number

  /** Target colo for routing (added as cf-ipcolo header) */
  colo?: string

  /** Custom headers to include in all requests */
  headers?: Record<string, string>

  /**
   * Setup function called once before all iterations
   * Use to prepare test data, create resources, etc.
   */
  setup?: (ctx: BenchmarkContext) => Promise<void>

  /**
   * Main benchmark function called for each iteration
   *
   * @param ctx - Benchmark context with fetch method and DO client
   * @param iteration - Current iteration number (0-indexed, includes warmup)
   * @returns Any value (return value is not recorded)
   */
  run: (ctx: BenchmarkContext, iteration: number) => Promise<unknown>

  /**
   * Teardown function called once after all iterations
   * Use to clean up test data, delete resources, etc.
   */
  teardown?: (ctx: BenchmarkContext) => Promise<void>
}

/**
 * Error recorded during benchmark iteration
 */
interface BenchmarkError {
  iteration: number
  message: string
  stack?: string
}

/**
 * Run a benchmark and collect results
 *
 * The benchmark runner:
 * 1. Creates a context for the target DO
 * 2. Runs setup (if provided)
 * 3. Runs warmup iterations (if specified)
 * 4. Runs recorded iterations, measuring latency
 * 5. Calculates statistics from samples
 * 6. Runs teardown (if provided)
 *
 * @param config - Benchmark configuration
 * @returns BenchmarkResult with samples, stats, and metadata
 *
 * @example
 * ```ts
 * const result = await benchmark({
 *   name: 'create-customer',
 *   target: 'crm.perf.do',
 *   iterations: 100,
 *   warmup: 10,
 *   run: async (ctx) => {
 *     await ctx.do.create('/customers', { name: 'Test' })
 *   }
 * })
 *
 * console.log(`p50: ${result.stats.p50}ms`)
 * console.log(`p99: ${result.stats.p99}ms`)
 * ```
 */
export async function benchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const { name, target, iterations, warmup = 0, coldStart = false, datasetSize, shardCount, colo, headers = {}, setup, run, teardown } = config

  // Build headers with colo hint if specified
  const requestHeaders: Record<string, string> = { ...headers }
  if (colo) {
    requestHeaders['cf-ipcolo'] = colo
  }

  // Create context
  const ctx = await createContext(target, requestHeaders)

  // Track samples, errors, and colos
  const samples: number[] = []
  const errors: BenchmarkError[] = []
  const colosServed: string[] = []

  try {
    // Run setup
    if (setup) {
      await setup(ctx)
    }

    // Total iterations = warmup + recorded
    const totalIterations = warmup + iterations

    for (let i = 0; i < totalIterations; i++) {
      const isWarmup = i < warmup

      // If cold start mode, create a new context for each iteration
      const iterationCtx = coldStart ? await createContext(target, requestHeaders) : ctx

      try {
        // Measure latency
        const start = performance.now()
        await run(iterationCtx, i)
        const elapsed = performance.now() - start

        // Only record non-warmup iterations
        if (!isWarmup) {
          samples.push(elapsed)

          // Track colo served
          if (iterationCtx.lastColoServed) {
            colosServed.push(iterationCtx.lastColoServed)
          }
        }
      } catch (error) {
        // Record error but continue benchmark
        if (!isWarmup) {
          errors.push({
            iteration: i - warmup,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          })

          // Still record a sample (the time until error)
          // This helps identify iteration timing even for failures
        }
      }
    }

    // Run teardown
    if (teardown) {
      await teardown(ctx)
    }
  } catch (error) {
    // Setup or teardown error - still return partial results
    errors.push({
      iteration: -1,
      message: `Lifecycle error: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack : undefined,
    })
  }

  // Calculate stats (use default if no samples)
  const stats: LatencyStats =
    samples.length > 0
      ? calculateStats(samples)
      : {
          p50: 0,
          p95: 0,
          p99: 0,
          min: 0,
          max: 0,
          mean: 0,
          stddev: 0,
        }

  // Build result
  const result: BenchmarkResult = {
    name,
    target,
    iterations,
    stats,
    samples,
    timestamp: new Date().toISOString(),
    config: {
      warmup,
      coldStart,
      ...(datasetSize !== undefined && { datasetSize }),
      ...(shardCount !== undefined && { shardCount }),
    },
  }

  // Add optional fields
  if (colo) {
    result.colo = colo
  }

  if (colosServed.length > 0) {
    result.colosServed = colosServed
  }

  if (errors.length > 0) {
    result.errors = errors
  }

  return result
}

/**
 * Run multiple benchmarks in sequence
 *
 * @param configs - Array of benchmark configurations
 * @returns Array of BenchmarkResult in same order as configs
 */
export async function benchmarkSuite(configs: BenchmarkConfig[]): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  for (const config of configs) {
    const result = await benchmark(config)
    results.push(result)
  }

  return results
}
