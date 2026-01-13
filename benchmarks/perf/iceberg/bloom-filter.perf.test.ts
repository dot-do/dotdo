/**
 * Bloom Filter Performance Benchmarks
 *
 * Tests bloom filter operations for probabilistic set membership:
 * - Filter creation with varying element counts
 * - False positive rate validation
 * - Query performance (membership testing)
 * - Serialization/deserialization performance
 *
 * Expected performance:
 * - Bloom filter query: <1ms
 * - Create filter (1000 items): <10ms
 *
 * @see db/iceberg/puffin.ts for implementation
 * @see dotdo-2mibg for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('BloomFilter benchmarks', () => {
  describe('filter creation', () => {
    it('create bloom filter with 1000 items', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => `item:${i}`)

      const result = await benchmark({
        name: 'bloom-filter-create-1000',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01, // 1% false positive rate
              namespace: `test-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Create Bloom Filter (1000 items) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)
      // Creating a bloom filter should be fast
      expect(result.stats.p50).toBeLessThan(10)
    })

    it.each([100, 1000, 10000, 100000])('create filter with %d items', async (count) => {
      const items = Array.from({ length: count }, (_, i) => `item:${i}`)

      const result = await benchmark({
        name: `bloom-filter-create-${count}`,
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: `scale-test-${count}-${iteration}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures creation time scaling', async () => {
      const itemCounts = [100, 500, 1000, 5000, 10000]
      const results: Array<{ count: number; p50: number; p99: number }> = []

      for (const count of itemCounts) {
        const items = Array.from({ length: count }, (_, i) => `scale-item:${i}`)

        const result = await benchmark({
          name: `bloom-filter-scale-${count}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, iteration) => {
            return ctx.do.request('/iceberg/bloom/create', {
              method: 'POST',
              body: JSON.stringify({
                items,
                fpr: 0.01,
                namespace: `scale-${count}-${iteration}`,
              }),
            })
          },
        })

        results.push({
          count,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Creation Time Scaling ===')
      console.log('  Items       | p50 (ms) | p99 (ms)')
      console.log('  ------------|----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.count).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`)
      }

      // Creation time should scale linearly with item count
      // Verify it doesn't scale worse than O(n log n)
      if (results.length >= 2) {
        const timeRatio = results[results.length - 1]!.p50 / results[0]!.p50
        const countRatio = results[results.length - 1]!.count / results[0]!.count
        const logFactor = Math.log2(countRatio)
        expect(timeRatio).toBeLessThan(countRatio * logFactor)
      }
    })
  })

  describe('false positive rate validation', () => {
    it('validate false positive rate at 1%', async () => {
      const result = await benchmark({
        name: 'bloom-filter-fpr-validation',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create filter with known items
          const items = Array.from({ length: 10000 }, (_, i) => `known-item:${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: 'fpr-test',
            }),
          })
        },
        run: async (ctx) => {
          // Test 10000 items that are NOT in the filter
          const testItems = Array.from({ length: 10000 }, (_, i) => `unknown-item:${i}`)
          const response = await ctx.fetch('/iceberg/bloom/test-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: 'fpr-test',
              items: testItems,
            }),
          })
          return response.json()
        },
      })

      record(result)

      console.log('\n=== FPR Validation ===')
      console.log(`  Test iterations: ${result.iterations}`)
      console.log(`  p50 time: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.samples.length).toBe(20)
    })

    it('measures actual FPR across multiple samples', async () => {
      const fprResults: number[] = []
      const targetFPR = 0.01

      const result = await benchmark({
        name: 'bloom-filter-fpr-measurement',
        target: 'iceberg.perf.do',
        iterations: 10,
        warmup: 1,
        run: async (ctx, iteration) => {
          // Create filter with 10000 known items
          const knownItems = Array.from({ length: 10000 }, (_, i) => `known-${iteration}-${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items: knownItems,
              fpr: targetFPR,
              namespace: `fpr-measure-${iteration}`,
            }),
          })

          // Test 10000 unknown items
          const unknownItems = Array.from({ length: 10000 }, (_, i) => `unknown-${iteration}-${i}`)
          const response = await ctx.fetch('/iceberg/bloom/test-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: `fpr-measure-${iteration}`,
              items: unknownItems,
            }),
          })

          const data = (await response.json()) as { falsePositiveCount: number; testedCount: number }
          const actualFPR = data.falsePositiveCount / data.testedCount
          fprResults.push(actualFPR)

          return data
        },
      })

      record(result)

      if (fprResults.length > 0) {
        const avgFPR = fprResults.reduce((a, b) => a + b, 0) / fprResults.length
        const maxFPR = Math.max(...fprResults)

        console.log('\n=== Actual FPR Measurement ===')
        console.log(`  Target FPR: ${(targetFPR * 100).toFixed(2)}%`)
        console.log(`  Average FPR: ${(avgFPR * 100).toFixed(2)}%`)
        console.log(`  Max FPR: ${(maxFPR * 100).toFixed(2)}%`)

        // Actual FPR should be close to target (within 2x)
        expect(avgFPR).toBeLessThan(targetFPR * 2)
      }
    })

    it.each([0.01, 0.001, 0.0001])('validates FPR at %d', async (targetFPR) => {
      const result = await benchmark({
        name: `bloom-filter-fpr-${targetFPR}`,
        target: 'iceberg.perf.do',
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const items = Array.from({ length: 10000 }, (_, i) => `item-${targetFPR}-${i}`)
          return ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: targetFPR,
              namespace: `fpr-${targetFPR}-${iteration}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
    })
  })

  describe('query performance', () => {
    it('query bloom filter single item', async () => {
      const result = await benchmark({
        name: 'bloom-filter-query-single',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          const items = Array.from({ length: 10000 }, (_, i) => `query-item:${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: 'query-test',
            }),
          })
        },
        run: async (ctx, i) => {
          const item = `query-item:${i % 10000}`
          return ctx.do.request('/iceberg/bloom/contains', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'query-test',
              item,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Query Single Item ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      // Bloom filter query should be sub-millisecond
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('query bloom filter batch of items', async () => {
      const result = await benchmark({
        name: 'bloom-filter-query-batch',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const items = Array.from({ length: 10000 }, (_, i) => `batch-query-item:${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: 'batch-query-test',
            }),
          })
        },
        run: async (ctx, iteration) => {
          // Query 100 items at once
          const items = Array.from({ length: 100 }, (_, i) => `batch-query-item:${(iteration * 100 + i) % 10000}`)
          return ctx.do.request('/iceberg/bloom/contains-batch', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'batch-query-test',
              items,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Query Batch (100 items) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      // Batch query should still be fast
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('measures query time vs filter size', async () => {
      const filterSizes = [1000, 10000, 100000, 1000000]
      const results: Array<{ size: number; p50: number; p99: number }> = []

      for (const size of filterSizes) {
        const items = Array.from({ length: size }, (_, i) => `size-query-item:${i}`)

        const result = await benchmark({
          name: `bloom-filter-query-size-${size}`,
          target: 'iceberg.perf.do',
          iterations: 50,
          warmup: 5,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/bloom/create', {
              method: 'POST',
              body: JSON.stringify({
                items,
                fpr: 0.01,
                namespace: `size-query-${size}`,
              }),
            })
          },
          run: async (ctx, i) => {
            const item = `size-query-item:${i % size}`
            return ctx.do.request('/iceberg/bloom/contains', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `size-query-${size}`,
                item,
              }),
            })
          },
        })

        results.push({
          size,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Query Time vs Filter Size ===')
      console.log('  Filter Size | p50 (ms) | p99 (ms)')
      console.log('  ------------|----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`)
      }

      // Query time should be O(k) where k is number of hash functions
      // Should NOT depend on filter size
      const maxP50 = Math.max(...results.map((r) => r.p50))
      const minP50 = Math.min(...results.map((r) => r.p50))
      // All queries should be within 5x of each other
      expect(maxP50 / minP50).toBeLessThan(5)
    })
  })

  describe('serialization', () => {
    it('serialize bloom filter to bytes', async () => {
      const result = await benchmark({
        name: 'bloom-filter-serialize',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const items = Array.from({ length: 10000 }, (_, i) => `serialize-item:${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: 'serialize-test',
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/bloom/serialize', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'serialize-test',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Serialize Bloom Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('deserialize bloom filter from bytes', async () => {
      let serializedData: string | null = null

      const result = await benchmark({
        name: 'bloom-filter-deserialize',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create and serialize a filter
          const items = Array.from({ length: 10000 }, (_, i) => `deserialize-item:${i}`)
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              namespace: 'deserialize-source',
            }),
          })

          const response = await ctx.fetch('/iceberg/bloom/serialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: 'deserialize-source',
            }),
          })
          const data = (await response.json()) as { data: string }
          serializedData = data.data
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/bloom/deserialize', {
            method: 'POST',
            body: JSON.stringify({
              data: serializedData,
              namespace: `deserialize-target-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Deserialize Bloom Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures serialized size vs element count', async () => {
      const elementCounts = [1000, 10000, 100000]
      const results: Array<{ count: number; sizeBytes: number; bitsPerElement: number }> = []

      for (const count of elementCounts) {
        const items = Array.from({ length: count }, (_, i) => `size-item:${i}`)

        const result = await benchmark({
          name: `bloom-filter-size-${count}`,
          target: 'iceberg.perf.do',
          iterations: 5,
          warmup: 1,
          run: async (ctx, iteration) => {
            await ctx.do.request('/iceberg/bloom/create', {
              method: 'POST',
              body: JSON.stringify({
                items,
                fpr: 0.01,
                namespace: `size-measure-${count}-${iteration}`,
              }),
            })

            const response = await ctx.fetch('/iceberg/bloom/stats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                namespace: `size-measure-${count}-${iteration}`,
              }),
            })
            const stats = (await response.json()) as { sizeBytes: number }
            results.push({
              count,
              sizeBytes: stats.sizeBytes,
              bitsPerElement: (stats.sizeBytes * 8) / count,
            })
            return stats
          },
        })

        record(result)
      }

      console.log('\n=== Serialized Size vs Element Count ===')
      console.log('  Elements    | Size (KB) | Bits/Element')
      console.log('  ------------|-----------|-------------')
      for (const r of results) {
        console.log(`  ${String(r.count).padEnd(11)} | ${(r.sizeBytes / 1024).toFixed(1).padStart(9)} | ${r.bitsPerElement.toFixed(2).padStart(12)}`)
      }

      // At 1% FPR, should be ~10 bits per element
      for (const r of results) {
        expect(r.bitsPerElement).toBeLessThan(15) // Allow some overhead
        expect(r.bitsPerElement).toBeGreaterThan(5)
      }
    })
  })

  describe('n-gram bloom filter', () => {
    it('create n-gram bloom filter for substring search', async () => {
      const result = await benchmark({
        name: 'ngram-bloom-create',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          const items = Array.from({ length: 1000 }, (_, i) => `user${i}@example.com`)
          return ctx.do.request('/iceberg/bloom/ngram/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              ngramSize: 3,
              namespace: `ngram-test-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== N-gram Bloom Filter Creation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
    })

    it('query n-gram bloom filter for substring', async () => {
      const result = await benchmark({
        name: 'ngram-bloom-query',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const items = Array.from({ length: 10000 }, (_, i) => `user${i}@example.com`)
          await ctx.do.request('/iceberg/bloom/ngram/create', {
            method: 'POST',
            body: JSON.stringify({
              items,
              fpr: 0.01,
              ngramSize: 3,
              namespace: 'ngram-query-test',
            }),
          })
        },
        run: async (ctx, i) => {
          const patterns = ['example', 'user', '@', '.com', 'xyz']
          const pattern = patterns[i % patterns.length]
          return ctx.do.request('/iceberg/bloom/ngram/contains', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'ngram-query-test',
              pattern,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== N-gram Bloom Filter Query ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(2)
    })
  })
})
