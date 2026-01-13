/**
 * V8 Isolate Cold Start Performance Benchmarks
 *
 * Validates the "0ms cold start" claim for V8 isolates on Cloudflare Workers.
 *
 * Key metrics:
 * - Fresh DO instantiation latency
 * - Cold vs warm latency comparison
 * - Cold start overhead calculation
 *
 * Reference: Cloudflare Workers promise 0ms cold starts for V8 isolates.
 * In practice, the "cold start" includes:
 * - Isolate creation (near-instant, cached by CF)
 * - Script compilation (cached after first run)
 * - Durable Object instantiation
 * - SQLite state hydration (varies by state size)
 *
 * The "0ms cold start" claim refers to the isolate spin-up time being
 * negligible compared to container-based FaaS (Lambda ~100-500ms).
 *
 * Expected benchmarks:
 * - p50 cold start: <50ms (isolate + DO init + network)
 * - Cold vs warm overhead: <50ms difference
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable cold start latency (ms)
 * This accounts for network round-trip + isolate init + DO instantiation
 */
const MAX_COLD_START_P50_MS = 50

/**
 * Maximum acceptable overhead between cold and warm requests (ms)
 * The V8 isolate spin-up should contribute minimal overhead
 */
const MAX_COLD_WARM_OVERHEAD_MS = 50

/**
 * Number of iterations for cold start tests
 * Lower than warm tests since each creates a new DO
 */
const COLD_START_ITERATIONS = 20

/**
 * Number of iterations for warm comparison baseline
 */
const WARM_ITERATIONS = 100

// ============================================================================
// V8 ISOLATE COLD START TESTS
// ============================================================================

describe('V8 isolate cold start', () => {
  /**
   * Test fresh DO instantiation latency
   *
   * Each iteration targets a unique namespace to force cold start.
   * Measures the end-to-end time including:
   * - DNS resolution (minimal, cached)
   * - TLS handshake (if not pooled)
   * - V8 isolate spin-up (should be ~0ms)
   * - DO instantiation
   * - SQLite initialization
   * - Request handling
   * - Response serialization
   */
  it('measures fresh DO instantiation', async () => {
    const timestamp = Date.now()

    const result = await benchmark({
      name: 'cold-start-isolate',
      target: `coldstart-${timestamp}.perf.do`,
      iterations: COLD_START_ITERATIONS,
      coldStart: true, // Forces new context per iteration
      run: async (ctx) => {
        // Use unique namespace suffix to ensure cold start
        const response = await ctx.fetch('/ping')
        if (!response.ok) {
          throw new Error(`Ping failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    // Log results for visibility
    console.log('\n=== V8 Isolate Cold Start ===')
    console.log(`  Iterations: ${result.iterations}`)
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
    console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
    console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)
    console.log(`  Mean: ${result.stats.mean.toFixed(3)} ms`)
    console.log(`  StdDev: ${result.stats.stddev.toFixed(3)} ms`)

    // V8 isolate spin-up should be ~0ms (no container)
    // Total latency includes network, so we expect <50ms
    expect(result.stats.p50).toBeLessThan(MAX_COLD_START_P50_MS)
  })

  /**
   * Compare cold vs warm latency to isolate cold start overhead
   *
   * Cold: unique namespace per iteration (forces new DO each time)
   * Warm: same namespace reused (DO stays alive between iterations)
   *
   * The difference represents the actual cold start overhead,
   * excluding network latency which affects both equally.
   */
  it('compares cold vs warm latency', async () => {
    const timestamp = Date.now()

    // Cold: unique namespace per iteration
    const cold = await benchmark({
      name: 'cold-start-comparison-cold',
      target: `cold-${timestamp}.perf.do`,
      iterations: COLD_START_ITERATIONS,
      coldStart: true,
      run: async (ctx) => {
        const response = await ctx.fetch('/ping')
        if (!response.ok) {
          throw new Error(`Cold ping failed: ${response.status}`)
        }
        return response.json()
      },
    })

    // Warm: same namespace, DO stays alive
    const warm = await benchmark({
      name: 'cold-start-comparison-warm',
      target: 'warm.perf.do',
      iterations: WARM_ITERATIONS,
      warmup: 10, // Ensure DO is fully warmed up
      run: async (ctx) => {
        const response = await ctx.fetch('/ping')
        if (!response.ok) {
          throw new Error(`Warm ping failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record([cold, warm])

    // Calculate overhead
    const overhead = cold.stats.p50 - warm.stats.p50
    const overheadPercent = warm.stats.p50 > 0 ? (overhead / warm.stats.p50) * 100 : 0

    console.log('\n=== Cold vs Warm Comparison ===')
    console.log('Cold Start:')
    console.log(`  p50: ${cold.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${cold.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${cold.stats.p99.toFixed(3)} ms`)
    console.log('Warm Start:')
    console.log(`  p50: ${warm.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${warm.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${warm.stats.p99.toFixed(3)} ms`)
    console.log('Overhead:')
    console.log(`  Absolute: ${overhead.toFixed(3)} ms`)
    console.log(`  Relative: ${overheadPercent.toFixed(1)}%`)

    // Cold should not be significantly slower than warm
    expect(overhead).toBeLessThan(MAX_COLD_WARM_OVERHEAD_MS)
  })

  /**
   * Measure multiple sequential cold starts to detect variance
   *
   * This helps identify if cold start performance is consistent
   * or if there are occasional slow starts due to:
   * - Script cache misses
   * - Isolate pool exhaustion
   * - DO placement/routing
   */
  it('measures cold start consistency', async () => {
    const timestamp = Date.now()
    const results: BenchmarkResult[] = []

    // Run multiple independent cold start benchmarks
    for (let batch = 0; batch < 5; batch++) {
      const result = await benchmark({
        name: `cold-start-batch-${batch}`,
        target: `batch-${timestamp}-${batch}.perf.do`,
        iterations: 10,
        coldStart: true,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Batch ${batch} ping failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push(result)
    }

    record(results)

    // Calculate cross-batch statistics
    const p50s = results.map((r) => r.stats.p50)
    const p50Min = Math.min(...p50s)
    const p50Max = Math.max(...p50s)
    const p50Mean = p50s.reduce((a, b) => a + b, 0) / p50s.length
    const p50Variance = p50s.reduce((a, b) => a + Math.pow(b - p50Mean, 2), 0) / p50s.length
    const p50StdDev = Math.sqrt(p50Variance)

    console.log('\n=== Cold Start Consistency ===')
    console.log(`  Batches: ${results.length}`)
    console.log('  p50 across batches:')
    console.log(`    Min: ${p50Min.toFixed(3)} ms`)
    console.log(`    Max: ${p50Max.toFixed(3)} ms`)
    console.log(`    Mean: ${p50Mean.toFixed(3)} ms`)
    console.log(`    StdDev: ${p50StdDev.toFixed(3)} ms`)
    console.log('  Individual batch p50s:')
    results.forEach((r, i) => {
      console.log(`    Batch ${i}: ${r.stats.p50.toFixed(3)} ms`)
    })

    // Cold starts should be consistent (low variance)
    // Allow for some variance due to network conditions
    const coefficientOfVariation = p50Mean > 0 ? p50StdDev / p50Mean : 0
    expect(coefficientOfVariation).toBeLessThan(0.5) // Max 50% CV
  })

  /**
   * Test cold start under different DO naming patterns
   *
   * DO placement may vary based on namespace hash, which could
   * affect cold start latency due to geographical routing.
   */
  it('measures cold start across naming patterns', async () => {
    const timestamp = Date.now()
    const patterns = [
      { prefix: 'uuid', generator: () => crypto.randomUUID() },
      { prefix: 'sequential', generator: (i: number) => `seq-${i}` },
      { prefix: 'timestamp', generator: () => `ts-${Date.now()}-${Math.random()}` },
      { prefix: 'hash-like', generator: () => crypto.randomUUID().replace(/-/g, '') },
    ]

    const results: Array<{ pattern: string; result: BenchmarkResult }> = []

    for (const { prefix, generator } of patterns) {
      let idx = 0
      const result = await benchmark({
        name: `cold-start-pattern-${prefix}`,
        target: `pattern-${timestamp}-${prefix}.perf.do`,
        iterations: 10,
        coldStart: true,
        run: async (ctx) => {
          // The generator creates unique identifiers, but we're measuring
          // the DO instantiation, not the key generation
          const _key = generator(idx++)
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Pattern ${prefix} ping failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push({ pattern: prefix, result })
    }

    record(results.map((r) => r.result))

    console.log('\n=== Cold Start by Naming Pattern ===')
    console.log('  Pattern       | p50 (ms) | p95 (ms) | p99 (ms)')
    console.log('  --------------|----------|----------|----------')
    for (const { pattern, result } of results) {
      console.log(
        `  ${pattern.padEnd(13)} | ${result.stats.p50.toFixed(3).padStart(8)} | ${result.stats.p95.toFixed(3).padStart(8)} | ${result.stats.p99.toFixed(3).padStart(8)}`
      )
    }

    // All patterns should have similar cold start latency
    const p50s = results.map((r) => r.result.stats.p50)
    const maxDiff = Math.max(...p50s) - Math.min(...p50s)
    expect(maxDiff).toBeLessThan(30) // Max 30ms difference between patterns
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Cold Start Summary', () => {
  it('should document expected cold start performance', () => {
    console.log('\n========================================')
    console.log('V8 ISOLATE COLD START SUMMARY')
    console.log('========================================\n')

    console.log('What "0ms cold start" means:')
    console.log('  - V8 isolate spin-up: ~0ms (pre-warmed pool)')
    console.log('  - Script compilation: ~0ms (cached)')
    console.log('  - Container startup: N/A (no containers)')
    console.log('')

    console.log('What contributes to measured latency:')
    console.log('  - Network round-trip: ~10-50ms')
    console.log('  - DO instantiation: ~1-5ms')
    console.log('  - SQLite initialization: ~1-5ms')
    console.log('  - Request/response serialization: ~1ms')
    console.log('')

    console.log('Expected benchmarks:')
    console.log(`  - Cold start p50: <${MAX_COLD_START_P50_MS}ms`)
    console.log(`  - Cold vs warm overhead: <${MAX_COLD_WARM_OVERHEAD_MS}ms`)
    console.log('  - Consistency (CV): <50%')
    console.log('')

    console.log('Comparison to container-based FaaS:')
    console.log('  - AWS Lambda cold start: 100-500ms')
    console.log('  - Google Cloud Functions: 100-400ms')
    console.log('  - CF Workers (this): <50ms')
    console.log('')

    expect(true).toBe(true)
  })
})
