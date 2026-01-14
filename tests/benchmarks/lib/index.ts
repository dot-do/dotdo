/**
 * Benchmark Runner Library for dotdo
 *
 * Provides utilities for running performance benchmarks against Durable Objects
 * deployed on Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { benchmark, record } from './benchmarks/lib'
 *
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
 * record(result)
 *
 * console.log(`p50: ${result.stats.p50}ms`)
 * console.log(`p99: ${result.stats.p99}ms`)
 * ```
 */

// Core benchmark function
export { benchmark, benchmarkSuite, type BenchmarkConfig } from './runner'

// Statistics calculation
export { calculateStats, type LatencyStats } from './stats'

// Result recording
export { record, readTodayResults, readResultsByDate, listResultDates, type BenchmarkResult } from './reporter'

// Context for DO access
export { createContext, type BenchmarkContext, type DOClient } from './context'

// Cloudflare colo utilities
export { ALL_COLOS, NA_COLOS, EU_COLOS, APAC_COLOS, isValidColo, getColoRegion, extractColoFromCfRay, type Colo } from './colos'
