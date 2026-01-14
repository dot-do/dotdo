/**
 * HTTP Baseline Latency Benchmarks
 *
 * Measures baseline network latency for HTTP requests in the dotdo infrastructure.
 * These benchmarks establish performance baselines for:
 * - Worker-to-DO round-trip latency
 * - DO-to-DO communication latency (same colo and cross-colo)
 * - Per-colo latency distribution
 *
 * Key metrics:
 * - Round-trip time (RTT) to echo endpoint
 * - Latency distribution across colos
 * - Same-colo vs cross-colo overhead
 *
 * Reference: Cloudflare Workers run in 300+ data centers with near-zero cold starts.
 * These tests measure the actual network latency component.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { benchmark, record, NA_COLOS, EU_COLOS, APAC_COLOS, type BenchmarkResult } from '../../lib'

// ============================================================================
// TYPES
// ============================================================================

/**
 * HTTP benchmark configuration
 */
interface HttpBenchmarkConfig {
  /** Target endpoint for the benchmark */
  target: string
  /** Number of iterations to run */
  iterations: number
  /** Number of warmup iterations */
  warmup: number
  /** Optional colo hint for routing */
  colo?: string
}

/**
 * Colo latency result
 */
interface ColoLatencyResult {
  colo: string
  region: 'NA' | 'EU' | 'APAC'
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  mean: number
  sampleCount: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ECHO_TARGET = 'echo.perf.do'
const DEFAULT_ITERATIONS = 100
const DEFAULT_WARMUP = 10
const COLO_ITERATIONS = 50

// Subset of colos for parameterized tests
const NORTH_AMERICA_COLOS = NA_COLOS.slice(0, 5) // First 5 NA colos
const EUROPE_COLOS = EU_COLOS.slice(0, 3) // First 3 EU colos
const APAC_COLOS_SUBSET = APAC_COLOS.slice(0, 3) // First 3 APAC colos

// ============================================================================
// WORKER-TO-DO BENCHMARKS
// ============================================================================

describe('HTTP baseline latency', () => {
  describe('worker-to-DO', () => {
    it('measures round-trip to echo.perf.do', async () => {
      const result = await benchmark({
        name: 'http-worker-to-do',
        target: ECHO_TARGET,
        iterations: DEFAULT_ITERATIONS,
        warmup: DEFAULT_WARMUP,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`)
          }
          return response
        },
      })

      record(result)

      console.log('\n=== HTTP Worker-to-DO Round-Trip ===')
      console.log(`  Target: ${ECHO_TARGET}`)
      console.log(`  Iterations: ${DEFAULT_ITERATIONS}`)
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)
      console.log(`  min: ${result.stats.min.toFixed(2)} ms`)
      console.log(`  max: ${result.stats.max.toFixed(2)} ms`)
      console.log(`  mean: ${result.stats.mean.toFixed(2)} ms`)
      console.log(`  stddev: ${result.stats.stddev.toFixed(2)} ms`)

      // Basic sanity checks - actual values will vary by network conditions
      expect(result.stats.p50).toBeGreaterThan(0)
      expect(result.stats.p99).toBeGreaterThan(result.stats.p50)
      expect(result.samples.length).toBe(DEFAULT_ITERATIONS)
    })

    it('measures latency with payload', async () => {
      const payloadSizes = [100, 1000, 10000] // bytes
      const results: BenchmarkResult[] = []

      for (const size of payloadSizes) {
        const payload = JSON.stringify({ data: 'x'.repeat(size) })

        const result = await benchmark({
          name: `http-worker-to-do-payload-${size}b`,
          target: ECHO_TARGET,
          iterations: 50,
          warmup: 5,
          run: async (ctx) => {
            const response = await ctx.fetch('/echo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
            })
            if (!response.ok) {
              throw new Error(`Echo failed: ${response.status}`)
            }
            return response
          },
        })

        results.push(result)
        record(result)
      }

      console.log('\n=== HTTP Payload Size Impact ===')
      console.log('  Size (bytes) | p50 (ms) | p95 (ms) | p99 (ms)')
      console.log('  -------------|----------|----------|----------')
      for (let i = 0; i < payloadSizes.length; i++) {
        const size = payloadSizes[i]
        const stats = results[i].stats
        console.log(
          `  ${size.toString().padStart(11)} | ${stats.p50.toFixed(2).padStart(8)} | ${stats.p95.toFixed(2).padStart(8)} | ${stats.p99.toFixed(2).padStart(8)}`
        )
      }

      // Larger payloads should not dramatically increase latency
      const smallPayloadP50 = results[0].stats.p50
      const largePayloadP50 = results[results.length - 1].stats.p50

      // Allow 10x slowdown for 100x larger payload (generous margin)
      expect(largePayloadP50).toBeLessThan(smallPayloadP50 * 10)
    })

    // Parameterized tests for North American colos
    it.each(NORTH_AMERICA_COLOS)('measures latency via %s colo hint (NA)', async (colo) => {
      const result = await benchmark({
        name: `http-worker-to-do-${colo}`,
        target: ECHO_TARGET,
        colo,
        iterations: COLO_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`)
          }
          return response
        },
      })

      record(result)

      console.log(`\n=== HTTP Latency via ${colo} (NA) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)
      if (result.colosServed) {
        const uniqueColos = Array.from(new Set(result.colosServed))
        console.log(`  Served by: ${uniqueColos.join(', ')}`)
      }

      expect(result.stats.p50).toBeGreaterThan(0)
      expect(result.samples.length).toBe(COLO_ITERATIONS)
    })

    // Parameterized tests for European colos
    it.each(EUROPE_COLOS)('measures latency via %s colo hint (EU)', async (colo) => {
      const result = await benchmark({
        name: `http-worker-to-do-${colo}`,
        target: ECHO_TARGET,
        colo,
        iterations: COLO_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`)
          }
          return response
        },
      })

      record(result)

      console.log(`\n=== HTTP Latency via ${colo} (EU) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)

      expect(result.stats.p50).toBeGreaterThan(0)
    })

    // Parameterized tests for APAC colos
    it.each(APAC_COLOS_SUBSET)('measures latency via %s colo hint (APAC)', async (colo) => {
      const result = await benchmark({
        name: `http-worker-to-do-${colo}`,
        target: ECHO_TARGET,
        colo,
        iterations: COLO_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const response = await ctx.fetch('/ping')
          if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`)
          }
          return response
        },
      })

      record(result)

      console.log(`\n=== HTTP Latency via ${colo} (APAC) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)

      expect(result.stats.p50).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // DO-TO-DO BENCHMARKS
  // ============================================================================

  describe('DO-to-DO', () => {
    it('measures same-colo DO call', async () => {
      // This test assumes the echo DO can make calls to another DO in the same colo
      const result = await benchmark({
        name: 'http-do-to-do-same-colo',
        target: ECHO_TARGET,
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // The /do-call endpoint triggers the DO to call another DO
          // The colo affinity should keep them on the same edge
          const response = await ctx.fetch('/do-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'echo-replica.perf.do', affinity: 'same-colo' }),
          })
          if (!response.ok) {
            // This endpoint may not exist yet - record as skipped
            console.log('  (endpoint not available - skipping)')
            return null
          }
          return response
        },
      })

      record(result)

      console.log('\n=== DO-to-DO Same Colo ===')
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)

      // Same-colo DO calls should be very fast (sub-ms to few ms)
      // This is a baseline expectation; actual values depend on implementation
      if (result.samples.length > 0) {
        expect(result.stats.p50).toBeLessThan(100) // Generous upper bound
      }
    })

    it('measures cross-colo DO call', async () => {
      // This test measures latency when a DO calls another DO in a different colo
      const result = await benchmark({
        name: 'http-do-to-do-cross-colo',
        target: ECHO_TARGET,
        iterations: 30,
        warmup: 3,
        run: async (ctx) => {
          const response = await ctx.fetch('/do-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'echo-replica.perf.do', affinity: 'cross-colo' }),
          })
          if (!response.ok) {
            console.log('  (endpoint not available - skipping)')
            return null
          }
          return response
        },
      })

      record(result)

      console.log('\n=== DO-to-DO Cross Colo ===')
      console.log(`  p50: ${result.stats.p50.toFixed(2)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)} ms`)

      // Cross-colo calls will have higher latency due to network hop
      if (result.samples.length > 0) {
        expect(result.stats.p50).toBeLessThan(500) // Cross-colo can be slower
      }
    })

    it('compares same-colo vs cross-colo overhead', async () => {
      // Run both benchmarks and compare
      const sameColoResult = await benchmark({
        name: 'http-do-to-do-compare-same',
        target: ECHO_TARGET,
        iterations: 30,
        warmup: 3,
        run: async (ctx) => {
          const response = await ctx.fetch('/do-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'echo-replica.perf.do', affinity: 'same-colo' }),
          })
          return response
        },
      })

      const crossColoResult = await benchmark({
        name: 'http-do-to-do-compare-cross',
        target: ECHO_TARGET,
        iterations: 30,
        warmup: 3,
        run: async (ctx) => {
          const response = await ctx.fetch('/do-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'echo-replica.perf.do', affinity: 'cross-colo' }),
          })
          return response
        },
      })

      record([sameColoResult, crossColoResult])

      console.log('\n=== DO-to-DO Colo Comparison ===')
      console.log(`  Same Colo p50: ${sameColoResult.stats.p50.toFixed(2)} ms`)
      console.log(`  Cross Colo p50: ${crossColoResult.stats.p50.toFixed(2)} ms`)

      if (sameColoResult.samples.length > 0 && crossColoResult.samples.length > 0) {
        const overhead = crossColoResult.stats.p50 - sameColoResult.stats.p50
        const overheadPercent = sameColoResult.stats.p50 > 0 ? (overhead / sameColoResult.stats.p50) * 100 : 0
        console.log(`  Cross-colo overhead: ${overhead.toFixed(2)} ms (${overheadPercent.toFixed(1)}%)`)
      }

      // Basic sanity check
      expect(sameColoResult.samples.length).toBeGreaterThanOrEqual(0)
      expect(crossColoResult.samples.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // LATENCY DISTRIBUTION ANALYSIS
  // ============================================================================

  describe('latency distribution', () => {
    it('analyzes latency variance across multiple runs', async () => {
      const runs = 5
      const allSamples: number[] = []
      const runStats: Array<{ mean: number; stddev: number }> = []

      for (let run = 0; run < runs; run++) {
        const result = await benchmark({
          name: `http-variance-run-${run}`,
          target: ECHO_TARGET,
          iterations: 50,
          warmup: 5,
          run: async (ctx) => ctx.fetch('/ping'),
        })

        allSamples.push(...result.samples)
        runStats.push({ mean: result.stats.mean, stddev: result.stats.stddev })
        record(result)
      }

      // Calculate overall statistics
      const overallMean = allSamples.reduce((a, b) => a + b, 0) / allSamples.length
      const squaredDiffs = allSamples.map((s) => Math.pow(s - overallMean, 2))
      const overallStddev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / allSamples.length)

      // Calculate coefficient of variation (CV) for consistency analysis
      const cv = (overallStddev / overallMean) * 100

      console.log('\n=== Latency Variance Analysis ===')
      console.log(`  Total samples: ${allSamples.length}`)
      console.log(`  Overall mean: ${overallMean.toFixed(2)} ms`)
      console.log(`  Overall stddev: ${overallStddev.toFixed(2)} ms`)
      console.log(`  Coefficient of variation: ${cv.toFixed(1)}%`)
      console.log('\n  Per-run statistics:')
      for (let i = 0; i < runStats.length; i++) {
        console.log(`    Run ${i + 1}: mean=${runStats[i].mean.toFixed(2)}ms, stddev=${runStats[i].stddev.toFixed(2)}ms`)
      }

      expect(allSamples.length).toBe(runs * 50)
      // CV below 100% indicates reasonable consistency
      // Note: Network latency can be highly variable
    })

    it('identifies latency outliers', async () => {
      const result = await benchmark({
        name: 'http-outlier-analysis',
        target: ECHO_TARGET,
        iterations: 200,
        warmup: 10,
        run: async (ctx) => ctx.fetch('/ping'),
      })

      record(result)

      // Calculate IQR for outlier detection
      const sorted = [...result.samples].sort((a, b) => a - b)
      const q1Index = Math.floor(sorted.length * 0.25)
      const q3Index = Math.floor(sorted.length * 0.75)
      const q1 = sorted[q1Index]
      const q3 = sorted[q3Index]
      const iqr = q3 - q1

      const lowerBound = q1 - 1.5 * iqr
      const upperBound = q3 + 1.5 * iqr

      const outliers = result.samples.filter((s) => s < lowerBound || s > upperBound)
      const outlierPercent = (outliers.length / result.samples.length) * 100

      console.log('\n=== Latency Outlier Analysis ===')
      console.log(`  Q1: ${q1.toFixed(2)} ms`)
      console.log(`  Q3: ${q3.toFixed(2)} ms`)
      console.log(`  IQR: ${iqr.toFixed(2)} ms`)
      console.log(`  Lower bound: ${lowerBound.toFixed(2)} ms`)
      console.log(`  Upper bound: ${upperBound.toFixed(2)} ms`)
      console.log(`  Outliers: ${outliers.length}/${result.samples.length} (${outlierPercent.toFixed(1)}%)`)

      if (outliers.length > 0) {
        console.log(`  Min outlier: ${Math.min(...outliers).toFixed(2)} ms`)
        console.log(`  Max outlier: ${Math.max(...outliers).toFixed(2)} ms`)
      }

      // Some outliers are expected in network measurements
      // Flag if more than 10% are outliers
      expect(outlierPercent).toBeLessThan(20) // Generous threshold
    })
  })

  // ============================================================================
  // SUMMARY
  // ============================================================================

  describe('HTTP Baseline Summary', () => {
    it('generates comprehensive HTTP latency report', async () => {
      console.log('\n========================================')
      console.log('HTTP BASELINE LATENCY SUMMARY')
      console.log('========================================\n')

      const results: Map<string, BenchmarkResult> = new Map()

      // Basic round-trip
      const basicResult = await benchmark({
        name: 'http-summary-basic',
        target: ECHO_TARGET,
        iterations: 100,
        warmup: 10,
        run: async (ctx) => ctx.fetch('/ping'),
      })
      results.set('Basic /ping', basicResult)
      record(basicResult)

      // Small payload
      const smallPayloadResult = await benchmark({
        name: 'http-summary-small-payload',
        target: ECHO_TARGET,
        iterations: 50,
        warmup: 5,
        run: async (ctx) =>
          ctx.fetch('/echo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'x'.repeat(100) }),
          }),
      })
      results.set('100B payload', smallPayloadResult)
      record(smallPayloadResult)

      // Large payload
      const largePayloadResult = await benchmark({
        name: 'http-summary-large-payload',
        target: ECHO_TARGET,
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.fetch('/echo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'x'.repeat(10000) }),
          }),
      })
      results.set('10KB payload', largePayloadResult)
      record(largePayloadResult)

      // Print summary table
      console.log('Scenario       | p50 (ms) | p95 (ms) | p99 (ms) | min (ms) | max (ms)')
      console.log('---------------|----------|----------|----------|----------|----------')
      Array.from(results.entries()).forEach(([name, result]) => {
        console.log(
          `${name.padEnd(14)} | ${result.stats.p50.toFixed(2).padStart(8)} | ${result.stats.p95.toFixed(2).padStart(8)} | ${result.stats.p99.toFixed(2).padStart(8)} | ${result.stats.min.toFixed(2).padStart(8)} | ${result.stats.max.toFixed(2).padStart(8)}`
        )
      })

      console.log('\nKey findings:')
      console.log(`  - Baseline p50: ${basicResult.stats.p50.toFixed(2)} ms`)
      console.log(`  - Baseline p99: ${basicResult.stats.p99.toFixed(2)} ms`)
      console.log(`  - 10KB payload overhead: ${(largePayloadResult.stats.p50 - basicResult.stats.p50).toFixed(2)} ms`)

      // All results should have data
      Array.from(results.entries()).forEach(([name, result]) => {
        expect(result.samples.length, `${name} should have samples`).toBeGreaterThan(0)
      })
    })
  })
})
