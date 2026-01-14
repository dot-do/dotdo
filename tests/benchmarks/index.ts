/**
 * Benchmark Runner Infrastructure
 *
 * Core utilities for measuring Durable Object latency, throughput, and performance
 * across different colocation scenarios.
 *
 * @example
 * ```ts
 * import { benchmark, record } from 'benchmarks'
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
 * ```
 */

// Re-export everything from lib
export * from './lib'
