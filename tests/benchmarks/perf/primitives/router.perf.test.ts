/**
 * Router Benchmarks (KeyedRouter)
 *
 * Performance benchmarks for partition routing in streaming pipelines.
 * Tests hash routing, range routing, and partition assignment.
 *
 * Expected Performance:
 * | Operation | Expected |
 * |-----------|----------|
 * | hash route| <1ms |
 * | range route| <1ms |
 * | assignment| <1ms |
 *
 * Reference: Kafka partition assignment strategies
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// HASH ROUTING BENCHMARKS
// ============================================================================

describe('Router benchmarks (KeyedRouter)', () => {
  describe('hash routing', () => {
    it('hash route single key', async () => {
      const result = await benchmark({
        name: 'router-hash-single',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/hash', {
            method: 'POST',
            body: JSON.stringify({
              key: `user:${i}-${Math.random().toString(36).slice(2)}`,
              numPartitions: 32,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Hash Single Key Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
      expect(result.stats.p99).toBeLessThan(3)
    })

    it('hash route batch of keys', async () => {
      const result = await benchmark({
        name: 'router-hash-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const keys = Array.from({ length: 100 }, (_, j) => `key-${i * 100 + j}`)
          return ctx.do.request('/router/hash/batch', {
            method: 'POST',
            body: JSON.stringify({
              keys,
              numPartitions: 32,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Hash Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('consistent hash with virtual nodes', async () => {
      const result = await benchmark({
        name: 'router-consistent-hash',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/consistent-hash', {
            method: 'POST',
            body: JSON.stringify({
              key: `resource:${i}`,
              ring: 'default-ring',
              virtualNodes: 150,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Consistent Hash Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('murmur3 hash computation', async () => {
      const result = await benchmark({
        name: 'router-murmur3',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/murmur3', {
            method: 'POST',
            body: JSON.stringify({
              key: `data-${i}-${Math.random().toString(36).slice(2, 10)}`,
              seed: 42,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Murmur3 Hash Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })
  })

  // ============================================================================
  // RANGE ROUTING BENCHMARKS
  // ============================================================================

  describe('range routing', () => {
    it('range route single key', async () => {
      const result = await benchmark({
        name: 'router-range-single',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Configure range partitions
          const ranges = Array.from({ length: 26 }, (_, i) => ({
            start: String.fromCharCode(97 + i),
            end: String.fromCharCode(97 + i + 1) + 'zzz',
            partition: i,
          }))
          await ctx.do.request('/router/range/configure', {
            method: 'POST',
            body: JSON.stringify({ ranges }),
          })
        },
        run: async (ctx, i) => {
          const key = String.fromCharCode(97 + (i % 26)) + `-item-${i}`
          return ctx.do.request('/router/range', {
            method: 'POST',
            body: JSON.stringify({ key }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Range Single Key Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('range route batch of keys', async () => {
      const result = await benchmark({
        name: 'router-range-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const keys = Array.from({ length: 50 }, (_, j) => {
            const char = String.fromCharCode(97 + ((i + j) % 26))
            return `${char}-batch-${i}-${j}`
          })
          return ctx.do.request('/router/range/batch', {
            method: 'POST',
            body: JSON.stringify({ keys }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Range Batch Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('range route with binary search', async () => {
      const result = await benchmark({
        name: 'router-range-bsearch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Configure many range partitions to test binary search
          const ranges = Array.from({ length: 100 }, (_, i) => ({
            start: `${String(i).padStart(4, '0')}`,
            end: `${String(i + 1).padStart(4, '0')}`,
            partition: i,
          }))
          await ctx.do.request('/router/range/configure', {
            method: 'POST',
            body: JSON.stringify({ ranges }),
          })
        },
        run: async (ctx, i) => {
          const key = `${String(i % 100).padStart(4, '0')}-item-${i}`
          return ctx.do.request('/router/range', {
            method: 'POST',
            body: JSON.stringify({ key }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Range Binary Search Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })
  })

  // ============================================================================
  // PARTITION ASSIGNMENT BENCHMARKS
  // ============================================================================

  describe('partition assignment', () => {
    it('get partition assignment', async () => {
      const result = await benchmark({
        name: 'router-assignment-get',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/assignment', {
            method: 'POST',
            body: JSON.stringify({
              key: `order:${i}`,
              strategy: 'hash',
              numPartitions: 16,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Partition Assignment Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('batch partition assignment', async () => {
      const result = await benchmark({
        name: 'router-assignment-batch',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const keys = Array.from({ length: 200 }, (_, j) => `event-${i * 200 + j}`)
          return ctx.do.request('/router/assignment/batch', {
            method: 'POST',
            body: JSON.stringify({
              keys,
              strategy: 'hash',
              numPartitions: 32,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Batch Assignment Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('sticky partition assignment', async () => {
      const result = await benchmark({
        name: 'router-assignment-sticky',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/assignment/sticky', {
            method: 'POST',
            body: JSON.stringify({
              producerId: `producer-${i % 5}`,
              recordCount: 10,
              numPartitions: 16,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Sticky Assignment Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })

    it('round-robin assignment', async () => {
      const result = await benchmark({
        name: 'router-assignment-roundrobin',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/assignment/round-robin', {
            method: 'POST',
            body: JSON.stringify({
              batchSize: 100,
              numPartitions: 8,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Round-Robin Assignment Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(2)
    })
  })

  // ============================================================================
  // REBALANCING BENCHMARKS
  // ============================================================================

  describe('partition rebalancing', () => {
    it('compute rebalance plan', async () => {
      const result = await benchmark({
        name: 'router-rebalance-plan',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/rebalance/plan', {
            method: 'POST',
            body: JSON.stringify({
              currentAssignment: Object.fromEntries(
                Array.from({ length: 16 }, (_, j) => [`partition-${j}`, `consumer-${j % 4}`])
              ),
              consumers: ['consumer-0', 'consumer-1', 'consumer-2', 'consumer-3', 'consumer-4'],
              strategy: 'cooperative',
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Rebalance Plan Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(5)
    })

    it('apply rebalance', async () => {
      const result = await benchmark({
        name: 'router-rebalance-apply',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/rebalance/apply', {
            method: 'POST',
            body: JSON.stringify({
              newAssignment: Object.fromEntries(
                Array.from({ length: 16 }, (_, j) => [`partition-${j}`, `consumer-${(j + i) % 5}`])
              ),
              generation: i,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Rebalance Apply Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })

    it('get partition leader', async () => {
      const result = await benchmark({
        name: 'router-partition-leader',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request(`/router/partition/${i % 16}/leader`, {
            method: 'GET',
          })
        },
      })
      record(result)

      console.log('\n=== Router Get Partition Leader Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })
  })

  // ============================================================================
  // ROUTING TABLE BENCHMARKS
  // ============================================================================

  describe('routing table', () => {
    it('lookup routing table', async () => {
      const result = await benchmark({
        name: 'router-table-lookup',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/table/lookup', {
            method: 'POST',
            body: JSON.stringify({
              topic: `topic-${i % 5}`,
              key: `key-${i}`,
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Table Lookup Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(1)
    })

    it('update routing table', async () => {
      const result = await benchmark({
        name: 'router-table-update',
        target: 'streaming.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/router/table/update', {
            method: 'POST',
            body: JSON.stringify({
              topic: `topic-${i % 5}`,
              partitions: Array.from({ length: 8 }, (_, j) => ({
                id: j,
                leader: `broker-${(j + i) % 3}`,
                replicas: [`broker-${j % 3}`, `broker-${(j + 1) % 3}`],
              })),
            }),
          })
        },
      })
      record(result)

      console.log('\n=== Router Table Update Benchmark ===')
      console.log(`Avg: ${result.stats.mean.toFixed(4)}ms, P95: ${result.stats.p95.toFixed(4)}ms, P99: ${result.stats.p99.toFixed(4)}ms`)

      expect(result.stats.mean).toBeLessThan(3)
    })
  })
})
