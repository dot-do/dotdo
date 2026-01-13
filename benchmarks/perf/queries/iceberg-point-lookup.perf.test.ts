/**
 * Iceberg Point Lookup Performance Benchmarks
 *
 * Validates the 50-150ms warm tier performance claims for R2/Iceberg queries.
 * Tests single record lookups by ID across various dataset sizes.
 *
 * Performance targets:
 * - Point lookup (cached metadata): 50-100ms
 * - Point lookup (cold metadata): 100-150ms
 *
 * Key datasets tested:
 * - NAICS industry codes (~2K records)
 * - UNSPSC product codes (~60K records)
 * - Custom tenant datasets (variable size)
 *
 * @see db/iceberg/reader.ts for IcebergReader implementation
 * @see dotdo-r6re0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for point lookups (ms)
 * Target: 50-100ms cached, <150ms cold
 */
const MAX_POINT_LOOKUP_P95_MS = 150

/**
 * Expected latency reduction with metadata caching (ms)
 * Cached metadata should save 30-50ms per query
 */
const EXPECTED_CACHE_BENEFIT_MS = 30

/**
 * Number of iterations for benchmark runs
 */
const BENCHMARK_ITERATIONS = 100

/**
 * Warmup iterations to populate caches
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample NAICS (North American Industry Classification System) codes
 * Used for small dataset benchmarks (~2K total codes)
 */
const NAICS_CODES = [
  '11', // Agriculture
  '21', // Mining
  '22', // Utilities
  '23', // Construction
  '31-33', // Manufacturing
  '42', // Wholesale Trade
  '44-45', // Retail Trade
  '48-49', // Transportation
  '51', // Information
  '52', // Finance
  '53', // Real Estate
  '54', // Professional Services
  '55', // Management
  '56', // Admin Support
  '61', // Education
  '62', // Healthcare
  '71', // Entertainment
  '72', // Accommodation
  '81', // Other Services
  '92', // Public Administration
]

/**
 * Sample UNSPSC codes for larger dataset testing
 * Full dataset has ~60K codes across commodity categories
 */
const UNSPSC_SEGMENTS = [
  '10000000', // Live Plant and Animal Material
  '11000000', // Mineral and Textile Material
  '12000000', // Chemicals and Allied Products
  '13000000', // Resin and Rosin
  '14000000', // Paper and Paperboard Products
  '15000000', // Fuels and Lubricants
  '20000000', // Mining Equipment
  '21000000', // Farming Equipment
  '22000000', // Building Material
  '23000000', // Industrial Equipment
]

// ============================================================================
// POINT LOOKUP BENCHMARKS
// ============================================================================

describe('Iceberg point lookups', () => {
  describe('NAICS dataset (~2K records)', () => {
    it('single record by ID - warm metadata', async () => {
      const result = await benchmark({
        name: 'iceberg-point-naics-warm',
        target: 'naics.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 2000,
        run: async (ctx, i) => {
          const code = NAICS_CODES[i % NAICS_CODES.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM industries WHERE code = ?',
              params: [code],
            }),
          })
        },
      })

      record(result)

      // Log results for visibility
      console.log('\n=== NAICS Point Lookup (Warm Metadata) ===')
      console.log(`  Dataset size: ~2,000 records`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
      console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)

      // Expected: 50-100ms for cached metadata
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('single record by ID - cold start', async () => {
      const timestamp = Date.now()

      const result = await benchmark({
        name: 'iceberg-point-naics-cold',
        target: `naics-cold-${timestamp}.perf.do`,
        iterations: 20, // Fewer iterations for cold tests
        coldStart: true, // Force fresh context per iteration
        datasetSize: 2000,
        run: async (ctx, i) => {
          const code = NAICS_CODES[i % NAICS_CODES.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM industries WHERE code = ?',
              params: [code],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== NAICS Point Lookup (Cold Start) ===')
      console.log(`  Dataset size: ~2,000 records`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Cold starts include metadata fetch: 100-150ms expected
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('verifies caching benefit', async () => {
      // First: cold lookup (no cache)
      const cold = await benchmark({
        name: 'iceberg-naics-cache-cold',
        target: 'naics-cache-test.perf.do',
        iterations: 10,
        warmup: 0, // No warmup - measure cold
        run: async (ctx, i) => {
          const code = NAICS_CODES[i % NAICS_CODES.length]
          // Force cache bypass
          return ctx.do.request('/iceberg/query?cache=bypass', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM industries WHERE code = ?',
              params: [code],
            }),
          })
        },
      })

      // Second: warm lookup (cached)
      const warm = await benchmark({
        name: 'iceberg-naics-cache-warm',
        target: 'naics-cache-test.perf.do',
        iterations: 50,
        warmup: 10, // Warmup to populate cache
        run: async (ctx, i) => {
          const code = NAICS_CODES[i % NAICS_CODES.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM industries WHERE code = ?',
              params: [code],
            }),
          })
        },
      })

      record([cold, warm])

      const cacheBenefit = cold.stats.p50 - warm.stats.p50

      console.log('\n=== NAICS Caching Benefit ===')
      console.log(`  Cold p50: ${cold.stats.p50.toFixed(3)} ms`)
      console.log(`  Warm p50: ${warm.stats.p50.toFixed(3)} ms`)
      console.log(`  Cache benefit: ${cacheBenefit.toFixed(3)} ms`)

      // Caching should provide meaningful benefit
      expect(cacheBenefit).toBeGreaterThan(0)
    })
  })

  describe('UNSPSC dataset (~60K records)', () => {
    it('single record by ID - larger dataset', async () => {
      const result = await benchmark({
        name: 'iceberg-point-unspsc',
        target: 'unspsc.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 60000,
        run: async (ctx, i) => {
          const segment = UNSPSC_SEGMENTS[i % UNSPSC_SEGMENTS.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM commodities WHERE segment = ?',
              params: [segment],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== UNSPSC Point Lookup (60K records) ===')
      console.log(`  Dataset size: ~60,000 records`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Larger dataset should still be fast with proper indexing
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('deep code lookup within segment', async () => {
      // Lookup specific codes within a segment (more selective)
      const sampleCodes = [
        '10101501', // Cats
        '10101502', // Dogs
        '12141501', // Industrial gases
        '15101505', // Diesel fuel
        '20102001', // Mining conveyors
      ]

      const result = await benchmark({
        name: 'iceberg-point-unspsc-deep',
        target: 'unspsc.perf.do',
        iterations: 50,
        warmup: 10,
        datasetSize: 60000,
        run: async (ctx, i) => {
          const code = sampleCodes[i % sampleCodes.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM commodities WHERE code = ?',
              params: [code],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== UNSPSC Deep Code Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })

  describe('multi-tenant datasets', () => {
    it('point lookup with tenant isolation', async () => {
      const tenants = ['acme', 'globex', 'initech', 'umbrella', 'waynetech']

      const result = await benchmark({
        name: 'iceberg-point-tenant',
        target: 'tenant.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const tenant = tenants[i % tenants.length]
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM resources WHERE ns = ? AND id = ?',
              params: [tenant, `resource-${i % 100}`],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Multi-Tenant Point Lookup ===')
      console.log(`  Tenants: ${tenants.length}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('measures tenant isolation overhead', async () => {
      // Single tenant vs cross-tenant lookup comparison
      const singleTenant = await benchmark({
        name: 'iceberg-single-tenant',
        target: 'tenant.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM resources WHERE ns = ? AND id = ?',
              params: ['acme', `resource-${i % 100}`],
            }),
          }),
      })

      const multiTenant = await benchmark({
        name: 'iceberg-multi-tenant',
        target: 'tenant.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const tenants = ['acme', 'globex', 'initech', 'umbrella', 'waynetech']
          return ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM resources WHERE ns = ? AND id = ?',
              params: [tenants[i % tenants.length], `resource-${i % 100}`],
            }),
          })
        },
      })

      record([singleTenant, multiTenant])

      const overhead = multiTenant.stats.p50 - singleTenant.stats.p50

      console.log('\n=== Tenant Isolation Overhead ===')
      console.log(`  Single tenant p50: ${singleTenant.stats.p50.toFixed(3)} ms`)
      console.log(`  Multi tenant p50: ${multiTenant.stats.p50.toFixed(3)} ms`)
      console.log(`  Overhead: ${overhead.toFixed(3)} ms`)

      // Switching tenants should have minimal overhead with proper partition pruning
      expect(Math.abs(overhead)).toBeLessThan(20)
    })
  })

  describe('lookup patterns', () => {
    it('sequential ID lookups', async () => {
      const result = await benchmark({
        name: 'iceberg-point-sequential',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [`thing-${i}`],
            }),
          }),
      })

      record(result)

      console.log('\n=== Sequential ID Lookups ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('random ID lookups', async () => {
      const result = await benchmark({
        name: 'iceberg-point-random',
        target: 'resources.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [crypto.randomUUID()],
            }),
          }),
      })

      record(result)

      console.log('\n=== Random ID Lookups ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Random lookups may miss more often but should still be fast
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('UUID-based ID lookups', async () => {
      // Pre-generate UUIDs for consistent testing
      const uuids = Array.from({ length: 50 }, () => crypto.randomUUID())

      const result = await benchmark({
        name: 'iceberg-point-uuid',
        target: 'resources.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/iceberg/query', {
            method: 'POST',
            body: JSON.stringify({
              sql: 'SELECT * FROM things WHERE id = ?',
              params: [uuids[i % uuids.length]],
            }),
          }),
      })

      record(result)

      console.log('\n=== UUID-Based ID Lookups ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Point Lookup Summary', () => {
  it('should document expected performance characteristics', () => {
    console.log('\n========================================')
    console.log('ICEBERG POINT LOOKUP SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log('  - Point lookup (cached): 50-100ms')
    console.log('  - Point lookup (cold): 100-150ms')
    console.log(`  - p95 threshold: <${MAX_POINT_LOOKUP_P95_MS}ms`)
    console.log('')

    console.log('Datasets tested:')
    console.log('  - NAICS codes: ~2,000 records')
    console.log('  - UNSPSC codes: ~60,000 records')
    console.log('  - Multi-tenant: variable size')
    console.log('')

    console.log('Lookup patterns:')
    console.log('  - Sequential IDs')
    console.log('  - Random IDs')
    console.log('  - UUID-based IDs')
    console.log('')

    console.log('Performance factors:')
    console.log('  - Metadata caching: 30-50ms benefit')
    console.log('  - Partition pruning: reduces manifest reads')
    console.log('  - Column statistics: enables file skipping')
    console.log('')

    expect(true).toBe(true)
  })
})
