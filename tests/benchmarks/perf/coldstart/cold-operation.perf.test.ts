/**
 * Cold Start + Operation Performance Benchmarks
 *
 * Measures the end-to-end latency of cold start followed by an operation.
 * This represents the real-world user experience for first requests.
 *
 * Key metrics:
 * - Cold start + promote operation
 * - Cold start + shard operation
 * - Cold start + query operation
 * - Comparison with warm operation baselines
 *
 * Expected benchmarks:
 * - Cold + promote: <100ms (cold start + promotion logic)
 * - Cold + shard: <150ms (cold start + shard routing + fan-out)
 * - Cold + query: <80ms (cold start + SQLite query)
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Expected latency thresholds for cold + operation (ms)
 */
const EXPECTED_THRESHOLDS = {
  promote: { p50: 100, p99: 200 },
  shard: { p50: 150, p99: 300 },
  query: { p50: 80, p99: 150 },
  write: { p50: 100, p99: 200 },
} as const

/**
 * Iterations for cold start + operation tests
 */
const COLD_ITERATIONS = 15

/**
 * Iterations for warm baseline tests
 */
const WARM_ITERATIONS = 50

// ============================================================================
// COLD START + PROMOTE OPERATION
// ============================================================================

describe('Cold start + promote operation', () => {
  /**
   * Test cold start followed by a promote operation
   *
   * Promote is a common operation that:
   * 1. Receives a request
   * 2. Validates/transforms data
   * 3. Emits an event
   * 4. Returns confirmation
   */
  it('measures cold start + promote latency', async () => {
    const timestamp = Date.now()

    const cold = await benchmark({
      name: 'cold-promote',
      target: `cold-promote-${timestamp}.perf.do`,
      iterations: COLD_ITERATIONS,
      coldStart: true,
      run: async (ctx) => {
        const response = await ctx.fetch('/promote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity: 'Customer',
            id: `customer-${timestamp}`,
            data: { name: 'Test Customer', email: 'test@example.com' },
          }),
        })
        if (!response.ok) {
          throw new Error(`Cold promote failed: ${response.status}`)
        }
        return response.json()
      },
    })

    const warm = await benchmark({
      name: 'warm-promote',
      target: 'warm-promote.perf.do',
      iterations: WARM_ITERATIONS,
      warmup: 10,
      run: async (ctx) => {
        const response = await ctx.fetch('/promote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity: 'Customer',
            id: `customer-warm-${Date.now()}`,
            data: { name: 'Test Customer', email: 'test@example.com' },
          }),
        })
        if (!response.ok) {
          throw new Error(`Warm promote failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record([cold, warm])

    const overhead = cold.stats.p50 - warm.stats.p50

    console.log('\n=== Cold Start + Promote ===')
    console.log('Cold:')
    console.log(`  p50: ${cold.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${cold.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${cold.stats.p99.toFixed(3)} ms`)
    console.log('Warm:')
    console.log(`  p50: ${warm.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${warm.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${warm.stats.p99.toFixed(3)} ms`)
    console.log('Cold Start Overhead:')
    console.log(`  Absolute: ${overhead.toFixed(3)} ms`)
    console.log(`  Relative: ${((overhead / warm.stats.p50) * 100).toFixed(1)}%`)

    expect(cold.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.promote.p50)
    expect(cold.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.promote.p99)
  })

  /**
   * Test cold start + promote with different payload sizes
   */
  it('measures promote with varying payload sizes', async () => {
    const timestamp = Date.now()
    const payloadSizes = [100, 1000, 10000] // bytes
    const results: Array<{ size: number; result: BenchmarkResult }> = []

    for (const size of payloadSizes) {
      const payload = {
        entity: 'Document',
        id: `doc-${size}`,
        data: { content: 'x'.repeat(size) },
      }

      const result = await benchmark({
        name: `cold-promote-${size}b`,
        target: `cold-promote-payload-${timestamp}-${size}.perf.do`,
        iterations: 10,
        coldStart: true,
        run: async (ctx) => {
          const response = await ctx.fetch('/promote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) {
            throw new Error(`Promote ${size}b failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push({ size, result })
    }

    record(results.map((r) => r.result))

    console.log('\n=== Cold Promote by Payload Size ===')
    console.log('  Payload (B) | p50 (ms)  | p95 (ms)  | p99 (ms)')
    console.log('  ------------|-----------|-----------|----------')
    for (const { size, result } of results) {
      console.log(
        `  ${size.toString().padStart(11)} | ${result.stats.p50.toFixed(3).padStart(9)} | ${result.stats.p95.toFixed(3).padStart(9)} | ${result.stats.p99.toFixed(3).padStart(9)}`
      )
    }

    // Payload size should have minimal impact on cold start
    const smallPayload = results[0].result.stats.p50
    const largePayload = results[results.length - 1].result.stats.p50
    expect(largePayload / smallPayload).toBeLessThan(3)
  })
})

// ============================================================================
// COLD START + SHARD OPERATION
// ============================================================================

describe('Cold start + shard operation', () => {
  /**
   * Test cold start followed by a shard operation
   *
   * Shard operations involve:
   * 1. Cold start of the coordinator DO
   * 2. Shard key extraction
   * 3. Hash-based routing
   * 4. Fan-out to target shard(s)
   * 5. Response aggregation
   */
  it('measures cold start + shard routing', async () => {
    const timestamp = Date.now()

    const cold = await benchmark({
      name: 'cold-shard-route',
      target: `cold-shard-${timestamp}.perf.do`,
      iterations: COLD_ITERATIONS,
      coldStart: true,
      shardCount: 8,
      run: async (ctx) => {
        // Route to specific shard based on key
        const response = await ctx.fetch('/shard/route?key=tenant-123')
        if (!response.ok) {
          throw new Error(`Cold shard route failed: ${response.status}`)
        }
        return response.json()
      },
    })

    const warm = await benchmark({
      name: 'warm-shard-route',
      target: 'warm-shard.perf.do',
      iterations: WARM_ITERATIONS,
      warmup: 10,
      shardCount: 8,
      run: async (ctx) => {
        const response = await ctx.fetch('/shard/route?key=tenant-123')
        if (!response.ok) {
          throw new Error(`Warm shard route failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record([cold, warm])

    const overhead = cold.stats.p50 - warm.stats.p50

    console.log('\n=== Cold Start + Shard Routing ===')
    console.log('Cold:')
    console.log(`  p50: ${cold.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${cold.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${cold.stats.p99.toFixed(3)} ms`)
    console.log('Warm:')
    console.log(`  p50: ${warm.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${warm.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${warm.stats.p99.toFixed(3)} ms`)
    console.log('Cold Start Overhead:')
    console.log(`  Absolute: ${overhead.toFixed(3)} ms`)

    expect(cold.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.shard.p50)
    expect(cold.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.shard.p99)
  })

  /**
   * Test cold start + scatter-gather across all shards
   */
  it('measures cold start + scatter-gather', async () => {
    const timestamp = Date.now()
    const shardCounts = [4, 8, 16]
    const results: Array<{ shards: number; result: BenchmarkResult }> = []

    for (const shardCount of shardCounts) {
      const result = await benchmark({
        name: `cold-scatter-${shardCount}`,
        target: `cold-scatter-${timestamp}-${shardCount}.perf.do`,
        iterations: 10,
        coldStart: true,
        shardCount,
        run: async (ctx) => {
          // Scatter-gather: query all shards
          const response = await ctx.fetch('/shard/scatter?query=all')
          if (!response.ok) {
            throw new Error(`Scatter-gather ${shardCount} failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push({ shards: shardCount, result })
    }

    record(results.map((r) => r.result))

    console.log('\n=== Cold Start + Scatter-Gather ===')
    console.log('  Shards | p50 (ms)  | p95 (ms)  | p99 (ms)')
    console.log('  -------|-----------|-----------|----------')
    for (const { shards, result } of results) {
      console.log(
        `  ${shards.toString().padStart(6)} | ${result.stats.p50.toFixed(3).padStart(9)} | ${result.stats.p95.toFixed(3).padStart(9)} | ${result.stats.p99.toFixed(3).padStart(9)}`
      )
    }

    // Scatter-gather should scale sub-linearly
    const fourShards = results[0].result.stats.p50
    const sixteenShards = results[results.length - 1].result.stats.p50
    expect(sixteenShards / fourShards).toBeLessThan(4) // Should be <4x for 4x shards
  })
})

// ============================================================================
// COLD START + QUERY OPERATION
// ============================================================================

describe('Cold start + query operation', () => {
  /**
   * Test cold start followed by a simple query
   */
  it('measures cold start + simple query', async () => {
    const timestamp = Date.now()

    const cold = await benchmark({
      name: 'cold-simple-query',
      target: `cold-query-${timestamp}.perf.do`,
      iterations: COLD_ITERATIONS,
      coldStart: true,
      run: async (ctx) => {
        // Simple point query
        const response = await ctx.fetch('/query?id=item-1')
        if (!response.ok) {
          throw new Error(`Cold query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    const warm = await benchmark({
      name: 'warm-simple-query',
      target: 'warm-query.perf.do',
      iterations: WARM_ITERATIONS,
      warmup: 10,
      run: async (ctx) => {
        const response = await ctx.fetch('/query?id=item-1')
        if (!response.ok) {
          throw new Error(`Warm query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record([cold, warm])

    const overhead = cold.stats.p50 - warm.stats.p50

    console.log('\n=== Cold Start + Simple Query ===')
    console.log('Cold:')
    console.log(`  p50: ${cold.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${cold.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${cold.stats.p99.toFixed(3)} ms`)
    console.log('Warm:')
    console.log(`  p50: ${warm.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${warm.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${warm.stats.p99.toFixed(3)} ms`)
    console.log('Cold Start Overhead:')
    console.log(`  Absolute: ${overhead.toFixed(3)} ms`)

    expect(cold.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.query.p50)
    expect(cold.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.query.p99)
  })

  /**
   * Test cold start + complex query with joins
   */
  it('measures cold start + complex query', async () => {
    const timestamp = Date.now()

    const result = await benchmark({
      name: 'cold-complex-query',
      target: `cold-complex-${timestamp}.perf.do`,
      iterations: COLD_ITERATIONS,
      coldStart: true,
      setup: async (ctx) => {
        // Seed data for complex query
        for (let i = 0; i < 100; i++) {
          await ctx.do.create('/items', {
            id: `item-${i}`,
            category: `cat-${i % 10}`,
            tags: [`tag-${i % 5}`, `tag-${(i + 1) % 5}`],
          })
        }
      },
      run: async (ctx) => {
        // Complex query with filtering and sorting
        const response = await ctx.fetch('/query?category=cat-5&sort=id&limit=20')
        if (!response.ok) {
          throw new Error(`Complex query failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record(result)

    console.log('\n=== Cold Start + Complex Query ===')
    console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

    // Complex queries should still be reasonable
    expect(result.stats.p50).toBeLessThan(150)
  })

  /**
   * Test cold start + write operation
   */
  it('measures cold start + write operation', async () => {
    const timestamp = Date.now()

    const cold = await benchmark({
      name: 'cold-write',
      target: `cold-write-${timestamp}.perf.do`,
      iterations: COLD_ITERATIONS,
      coldStart: true,
      run: async (ctx) => {
        const response = await ctx.fetch('/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `item-${Date.now()}`,
            data: { value: Math.random() },
          }),
        })
        if (!response.ok) {
          throw new Error(`Cold write failed: ${response.status}`)
        }
        return response.json()
      },
    })

    const warm = await benchmark({
      name: 'warm-write',
      target: 'warm-write.perf.do',
      iterations: WARM_ITERATIONS,
      warmup: 10,
      run: async (ctx) => {
        const response = await ctx.fetch('/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `item-${Date.now()}`,
            data: { value: Math.random() },
          }),
        })
        if (!response.ok) {
          throw new Error(`Warm write failed: ${response.status}`)
        }
        return response.json()
      },
    })

    record([cold, warm])

    const overhead = cold.stats.p50 - warm.stats.p50

    console.log('\n=== Cold Start + Write ===')
    console.log('Cold:')
    console.log(`  p50: ${cold.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${cold.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${cold.stats.p99.toFixed(3)} ms`)
    console.log('Warm:')
    console.log(`  p50: ${warm.stats.p50.toFixed(3)} ms`)
    console.log(`  p95: ${warm.stats.p95.toFixed(3)} ms`)
    console.log(`  p99: ${warm.stats.p99.toFixed(3)} ms`)
    console.log('Cold Start Overhead:')
    console.log(`  Absolute: ${overhead.toFixed(3)} ms`)

    expect(cold.stats.p50).toBeLessThan(EXPECTED_THRESHOLDS.write.p50)
    expect(cold.stats.p99).toBeLessThan(EXPECTED_THRESHOLDS.write.p99)
  })
})

// ============================================================================
// OPERATION COMPARISON
// ============================================================================

describe('Cold operation comparison', () => {
  /**
   * Compare all operation types side by side
   */
  it('compares cold start across operation types', async () => {
    const timestamp = Date.now()
    const operations = [
      { name: 'ping', path: '/ping', method: 'GET' },
      { name: 'read', path: '/items/item-1', method: 'GET' },
      {
        name: 'write',
        path: '/items',
        method: 'POST',
        body: { id: 'test', data: {} },
      },
      {
        name: 'promote',
        path: '/promote',
        method: 'POST',
        body: { entity: 'Test', id: 'test', data: {} },
      },
    ]

    const results: Array<{ op: string; result: BenchmarkResult }> = []

    for (const op of operations) {
      const result = await benchmark({
        name: `cold-${op.name}`,
        target: `cold-compare-${timestamp}-${op.name}.perf.do`,
        iterations: 10,
        coldStart: true,
        run: async (ctx) => {
          const init: RequestInit = { method: op.method }
          if (op.body) {
            init.headers = { 'Content-Type': 'application/json' }
            init.body = JSON.stringify(op.body)
          }
          const response = await ctx.fetch(op.path, init)
          if (!response.ok) {
            throw new Error(`${op.name} failed: ${response.status}`)
          }
          return response.json()
        },
      })
      results.push({ op: op.name, result })
    }

    record(results.map((r) => r.result))

    console.log('\n=== Cold Start by Operation Type ===')
    console.log('  Operation | p50 (ms)  | p95 (ms)  | p99 (ms)')
    console.log('  ----------|-----------|-----------|----------')
    for (const { op, result } of results) {
      console.log(
        `  ${op.padEnd(9)} | ${result.stats.p50.toFixed(3).padStart(9)} | ${result.stats.p95.toFixed(3).padStart(9)} | ${result.stats.p99.toFixed(3).padStart(9)}`
      )
    }

    // All operations should complete within threshold
    for (const { result } of results) {
      expect(result.stats.p50).toBeLessThan(100)
    }
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Cold Operation Summary', () => {
  it('should document expected cold operation performance', () => {
    console.log('\n========================================')
    console.log('COLD START + OPERATION SUMMARY')
    console.log('========================================\n')

    console.log('Operation Types Benchmarked:')
    console.log('  1. Promote - Event emission pipeline')
    console.log('  2. Shard - Hash-based routing + fan-out')
    console.log('  3. Query - SQLite read operations')
    console.log('  4. Write - SQLite write operations')
    console.log('')

    console.log('Expected Cold + Operation Latency (p50):')
    console.log('  Operation | Cold (ms) | Warm (ms) | Overhead')
    console.log('  ----------|-----------|-----------|----------')
    console.log(`  Promote   | <${EXPECTED_THRESHOLDS.promote.p50.toString().padStart(7)} | <20       | ~80ms`)
    console.log(`  Shard     | <${EXPECTED_THRESHOLDS.shard.p50.toString().padStart(7)} | <30       | ~120ms`)
    console.log(`  Query     | <${EXPECTED_THRESHOLDS.query.p50.toString().padStart(7)} | <10       | ~70ms`)
    console.log(`  Write     | <${EXPECTED_THRESHOLDS.write.p50.toString().padStart(7)} | <15       | ~85ms`)
    console.log('')

    console.log('Cold Start Components:')
    console.log('  - Network RTT: ~10-30ms')
    console.log('  - V8 Isolate: ~0ms (cached)')
    console.log('  - DO Instantiation: ~5-10ms')
    console.log('  - SQLite Init: ~5-20ms')
    console.log('  - Operation: varies')
    console.log('')

    console.log('Optimization Strategies:')
    console.log('  - Keep first operation lightweight')
    console.log('  - Use warmup requests during deployment')
    console.log('  - Implement lazy loading for state')
    console.log('  - Cache expensive computations')
    console.log('  - Consider edge caching for read-heavy')
    console.log('')

    expect(true).toBe(true)
  })
})
