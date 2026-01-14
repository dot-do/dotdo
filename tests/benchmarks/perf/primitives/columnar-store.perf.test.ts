/**
 * ColumnarStore Primitive Benchmarks
 *
 * Performance benchmarks for the ColumnarStore Durable Object primitive:
 * - Batch insert operations
 * - Aggregate operations (SUM, AVG, COUNT)
 * - Bloom filter predicate pushdown
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | batch insert 1000 rows | <20ms |
 * | SUM 100K rows | <50ms |
 * | bloom filter predicate | <30ms |
 *
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('ColumnarStore benchmarks', () => {
  describe('write operations', () => {
    it('batch insert (1000 rows)', async () => {
      const result = await benchmark({
        name: 'columnar-batch-insert-1000',
        target: 'columnar.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 1000,
        setup: async (ctx) => {
          // Ensure clean state
          await ctx.do.request('/columnar/clear', { method: 'POST' })
        },
        run: async (ctx, iteration) => {
          // Generate 1000 rows per iteration
          const rows = []
          for (let i = 0; i < 1000; i++) {
            rows.push({
              id: `row-${iteration}-${i}`,
              columns: {
                amount: Math.random() * 10000,
                quantity: Math.floor(Math.random() * 100),
                category: ['electronics', 'clothing', 'food', 'furniture', 'toys'][i % 5],
                region: ['north', 'south', 'east', 'west'][i % 4],
                active: Math.random() > 0.3,
                timestamp: Date.now() - Math.floor(Math.random() * 86400000),
              },
            })
          }

          return ctx.do.request('/columnar/batch-insert', {
            method: 'POST',
            body: JSON.stringify({ rows }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/columnar/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore Batch Insert (1000 rows) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  Throughput: ${(1000 / result.stats.mean * 1000).toFixed(0)} rows/sec`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms for 1000 rows
    })
  })

  describe('aggregate operations', () => {
    it('aggregate SUM on 100K rows', async () => {
      const result = await benchmark({
        name: 'columnar-sum-100k',
        target: 'columnar.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 100000,
        setup: async (ctx) => {
          // Pre-populate with 100K rows in batches
          await ctx.do.request('/columnar/clear', { method: 'POST' })

          // Insert 100 batches of 1000 rows = 100K rows
          for (let batch = 0; batch < 100; batch++) {
            const rows = []
            for (let i = 0; i < 1000; i++) {
              rows.push({
                id: `row-${batch}-${i}`,
                columns: {
                  amount: Math.random() * 10000,
                  quantity: Math.floor(Math.random() * 100),
                  category: ['electronics', 'clothing', 'food', 'furniture', 'toys'][i % 5],
                },
              })
            }
            await ctx.do.request('/columnar/batch-insert', {
              method: 'POST',
              body: JSON.stringify({ rows }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/columnar/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'SUM',
              column: 'amount',
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/columnar/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore SUM (100K rows) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms for 100K rows
    })

    it('aggregate AVG on 100K rows', async () => {
      const result = await benchmark({
        name: 'columnar-avg-100k',
        target: 'columnar.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 100000,
        setup: async (ctx) => {
          // Pre-populate with 100K rows (assuming setup from previous test)
          // Re-check if data exists, otherwise populate
          const stats = await ctx.do.request<{ rowCount: number }>('/columnar/stats')
          if (stats.rowCount < 100000) {
            await ctx.do.request('/columnar/clear', { method: 'POST' })
            for (let batch = 0; batch < 100; batch++) {
              const rows = []
              for (let i = 0; i < 1000; i++) {
                rows.push({
                  id: `row-${batch}-${i}`,
                  columns: {
                    amount: Math.random() * 10000,
                    quantity: Math.floor(Math.random() * 100),
                  },
                })
              }
              await ctx.do.request('/columnar/batch-insert', {
                method: 'POST',
                body: JSON.stringify({ rows }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/columnar/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'AVG',
              column: 'amount',
            }),
          })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore AVG (100K rows) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms for 100K rows
    })

    it('aggregate COUNT with filter on 100K rows', async () => {
      const result = await benchmark({
        name: 'columnar-count-filtered-100k',
        target: 'columnar.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 100000,
        run: async (ctx, iteration) => {
          const categories = ['electronics', 'clothing', 'food', 'furniture', 'toys']
          return ctx.do.request('/columnar/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'COUNT',
              column: 'id',
              filter: {
                column: 'category',
                operator: '=',
                value: categories[iteration % 5],
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore COUNT with Filter (100K rows) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms
    })
  })

  describe('bloom filter operations', () => {
    it('bloom filter predicate pushdown', async () => {
      const result = await benchmark({
        name: 'columnar-bloom-predicate',
        target: 'columnar.perf.do',
        iterations: 500,
        warmup: 25,
        datasetSize: 100000,
        setup: async (ctx) => {
          // Ensure bloom filters are built during data population
          const stats = await ctx.do.request<{ rowCount: number; bloomFilters: string[] }>('/columnar/stats')
          if (stats.rowCount < 100000) {
            await ctx.do.request('/columnar/clear', { method: 'POST' })

            // Insert data with bloom filter enabled
            for (let batch = 0; batch < 100; batch++) {
              const rows = []
              for (let i = 0; i < 1000; i++) {
                rows.push({
                  id: `row-${batch}-${i}`,
                  columns: {
                    amount: Math.random() * 10000,
                    category: ['electronics', 'clothing', 'food', 'furniture', 'toys'][i % 5],
                    region: ['north', 'south', 'east', 'west'][i % 4],
                    sku: `SKU-${batch}-${i}`, // Unique values for bloom filter testing
                  },
                })
              }
              await ctx.do.request('/columnar/batch-insert', {
                method: 'POST',
                body: JSON.stringify({
                  rows,
                  buildBloomFilter: ['category', 'region', 'sku'],
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          // Query with bloom filter predicate
          // Mix of hits and misses to test bloom filter effectiveness
          const isHit = iteration % 3 !== 0
          const category = isHit
            ? ['electronics', 'clothing', 'food', 'furniture', 'toys'][iteration % 5]
            : 'nonexistent-category'

          return ctx.do.request('/columnar/query-bloom', {
            method: 'POST',
            body: JSON.stringify({
              column: 'category',
              value: category,
              limit: 100,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore Bloom Filter Predicate Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  (Mix of bloom filter hits and misses)`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms with bloom filter
    })

    it('bloom filter miss (early termination)', async () => {
      const result = await benchmark({
        name: 'columnar-bloom-miss',
        target: 'columnar.perf.do',
        iterations: 1000,
        warmup: 50,
        run: async (ctx, iteration) => {
          // Query for values that definitely don't exist
          // Bloom filter should reject immediately
          return ctx.do.request('/columnar/query-bloom', {
            method: 'POST',
            body: JSON.stringify({
              column: 'sku',
              value: `NONEXISTENT-SKU-${iteration}`,
              limit: 100,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- ColumnarStore Bloom Filter Miss Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  (Bloom filter early termination)`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms for bloom filter miss
    })
  })

  describe('summary', () => {
    it('should report columnar store benchmark targets', () => {
      console.log('\n========================================')
      console.log('COLUMNAR STORE BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | batch insert 1K rows | <20ms |')
      console.log('  | SUM 100K rows | <50ms |')
      console.log('  | AVG 100K rows | <50ms |')
      console.log('  | COUNT filtered 100K | <50ms |')
      console.log('  | bloom predicate | <30ms |')
      console.log('  | bloom miss | <5ms |')
      console.log('')

      console.log('Columnar Operations:')
      console.log('  - batch insert: O(n) with bloom filter updates')
      console.log('  - aggregates: O(n) full scan or O(m) with predicate pushdown')
      console.log('  - bloom query hit: O(n) scan after bloom check')
      console.log('  - bloom query miss: O(k) hash operations (k = hash count)')
      console.log('')

      console.log('Bloom Filter Configuration:')
      console.log('  - Hash functions: 3')
      console.log('  - Bit array size: 1024 bytes per column')
      console.log('  - Expected false positive rate: ~1-2%')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
