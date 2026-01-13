/**
 * Cache Primitive Benchmarks
 *
 * Performance benchmarks for the Cache Durable Object primitive:
 * - Get hit/miss operations
 * - Set with TTL
 * - Cascade invalidation
 * - Compare-and-swap (CAS) operations
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | get hit | <5ms |
 * | get miss | <5ms |
 * | set TTL | <5ms |
 * | invalidate | <10ms |
 * | CAS | <5ms |
 *
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('Cache benchmarks', () => {
  describe('get operations', () => {
    it('get hit', async () => {
      const result = await benchmark({
        name: 'cache-get-hit',
        target: 'cache.perf.do',
        iterations: 1000,
        warmup: 50,
        setup: async (ctx) => {
          // Pre-populate cache with warm entries
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/cache/set', {
              method: 'POST',
              body: JSON.stringify({
                key: `warm-${i}`,
                value: { data: `test-value-${i}`, index: i },
                ttl: 60000,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const key = `warm-${iteration % 100}`
          return ctx.do.request(`/cache/get?key=${key}`)
        },
        teardown: async (ctx) => {
          // Clean up cache entries
          await ctx.do.request('/cache/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cache Get Hit Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })

    it('get miss', async () => {
      const result = await benchmark({
        name: 'cache-get-miss',
        target: 'cache.perf.do',
        iterations: 1000,
        warmup: 50,
        setup: async (ctx) => {
          // Ensure cache is empty
          await ctx.do.request('/cache/clear', { method: 'POST' })
        },
        run: async (ctx, iteration) => {
          // Request non-existent keys
          return ctx.do.request(`/cache/get?key=nonexistent-${iteration}`)
        },
      })

      record(result)

      console.log('\n--- Cache Get Miss Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('set operations', () => {
    it('set with TTL', async () => {
      const result = await benchmark({
        name: 'cache-set-ttl',
        target: 'cache.perf.do',
        iterations: 1000,
        warmup: 50,
        run: async (ctx, iteration) => {
          return ctx.do.request('/cache/set', {
            method: 'POST',
            body: JSON.stringify({
              key: `perf-key-${iteration}`,
              value: {
                data: `performance-test-value-${iteration}`,
                timestamp: Date.now(),
                metadata: { iteration, type: 'benchmark' },
              },
              ttl: 5000 + (iteration % 10) * 1000, // Variable TTL 5-14s
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/cache/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cache Set with TTL Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('invalidation', () => {
    it('cascade invalidation', async () => {
      const result = await benchmark({
        name: 'cache-cascade-invalidate',
        target: 'cache.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Build dependency tree before each benchmark run
          // root -> level1 (10 items) -> level2 (50 items) -> level3 (100 items)
          await ctx.do.request('/cache/set', {
            method: 'POST',
            body: JSON.stringify({
              key: 'cascade-root',
              value: { level: 0, name: 'root' },
              ttl: 60000,
            }),
          })

          // Level 1: 10 items depending on root
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/cache/set', {
              method: 'POST',
              body: JSON.stringify({
                key: `cascade-l1-${i}`,
                value: { level: 1, parent: 'root', index: i },
                ttl: 60000,
                dependencies: ['cascade-root'],
              }),
            })

            // Level 2: 5 items per level1 item (50 total)
            for (let j = 0; j < 5; j++) {
              await ctx.do.request('/cache/set', {
                method: 'POST',
                body: JSON.stringify({
                  key: `cascade-l2-${i}-${j}`,
                  value: { level: 2, parent: `l1-${i}`, index: j },
                  ttl: 60000,
                  dependencies: [`cascade-l1-${i}`],
                }),
              })

              // Level 3: 2 items per level2 item (100 total)
              for (let k = 0; k < 2; k++) {
                await ctx.do.request('/cache/set', {
                  method: 'POST',
                  body: JSON.stringify({
                    key: `cascade-l3-${i}-${j}-${k}`,
                    value: { level: 3, parent: `l2-${i}-${j}`, index: k },
                    ttl: 60000,
                    dependencies: [`cascade-l2-${i}-${j}`],
                  }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          // Invalidate root, which should cascade to all 161 entries
          return ctx.do.request('/cache/invalidate-cascade', {
            method: 'POST',
            body: JSON.stringify({ key: 'cascade-root' }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/cache/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cache Cascade Invalidation Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  (Invalidating ~161 entries per cascade)`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })
  })

  describe('atomic operations', () => {
    it('compare-and-swap', async () => {
      const etags: Map<string, string> = new Map()

      const result = await benchmark({
        name: 'cache-compare-and-swap',
        target: 'cache.perf.do',
        iterations: 1000,
        warmup: 50,
        setup: async (ctx) => {
          // Initialize keys with etags
          for (let i = 0; i < 100; i++) {
            const response = await ctx.do.request<{ etag: string }>('/cache/set', {
              method: 'POST',
              body: JSON.stringify({
                key: `cas-key-${i}`,
                value: { version: 0, data: 'initial' },
                ttl: 60000,
              }),
            })
            etags.set(`cas-key-${i}`, response.etag)
          }
        },
        run: async (ctx, iteration) => {
          const keyIndex = iteration % 100
          const key = `cas-key-${keyIndex}`
          const currentEtag = etags.get(key)

          const response = await ctx.do.request<{ etag: string; success: boolean }>('/cache/cas', {
            method: 'POST',
            body: JSON.stringify({
              key,
              value: { version: iteration, data: `updated-${iteration}` },
              expectedEtag: currentEtag,
            }),
          })

          // Update etag for next iteration
          if (response.success && response.etag) {
            etags.set(key, response.etag)
          }

          return response
        },
        teardown: async (ctx) => {
          await ctx.do.request('/cache/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- Cache Compare-and-Swap Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms target
    })
  })

  describe('summary', () => {
    it('should report cache benchmark targets', () => {
      console.log('\n========================================')
      console.log('CACHE BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | get hit | <5ms |')
      console.log('  | get miss | <5ms |')
      console.log('  | set TTL | <5ms |')
      console.log('  | invalidate | <10ms |')
      console.log('  | CAS | <5ms |')
      console.log('')

      console.log('Cache Operations:')
      console.log('  - get: O(1) hash lookup')
      console.log('  - set: O(1) hash insert + dependency indexing')
      console.log('  - invalidate: O(1) single key')
      console.log('  - cascade invalidate: O(n) where n = dependent entries')
      console.log('  - CAS: O(1) conditional update')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
