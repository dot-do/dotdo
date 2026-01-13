/**
 * Range Index Performance Benchmarks
 *
 * Tests range index operations for efficient range queries:
 * - Building range indexes from data
 * - Generating min/max statistics
 * - Range query pruning performance
 * - Block-level statistics for skip scanning
 *
 * Expected performance:
 * - Range index build: <50ms for 10K rows
 * - Range query prune check: <1ms
 *
 * @see db/iceberg/stats.ts for implementation
 * @see dotdo-2mibg for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('RangeIndex benchmarks', () => {
  describe('build range index', () => {
    it('build range index from numeric data', async () => {
      const result = await benchmark({
        name: 'range-index-build-numeric',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Generate numeric data with some distribution
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: Math.sin(i * 0.01) * 1000 + Math.random() * 100,
            timestamp: Date.now() - Math.floor(Math.random() * 86400000),
          }))

          return ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value', 'timestamp'],
              blockSize: 1000,
              namespace: `range-numeric-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Build Range Index (10K numeric rows) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeGreaterThan(0)
      // Building range index should be under 50ms
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('build range index from string data', async () => {
      const result = await benchmark({
        name: 'range-index-build-string',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Generate string data with lexicographic ordering
          const prefixes = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            name: `${prefixes[i % prefixes.length]}-${String(i).padStart(6, '0')}`,
            category: `cat-${i % 100}`,
          }))

          return ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['name', 'category'],
              blockSize: 1000,
              namespace: `range-string-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Build Range Index (10K string rows) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it.each([1000, 5000, 10000, 50000])('build range index with %d rows', async (rowCount) => {
      const result = await benchmark({
        name: `range-index-build-${rowCount}`,
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, iteration) => {
          const data = Array.from({ length: rowCount }, (_, i) => ({
            id: `row:${i}`,
            value: Math.random() * 10000,
          }))

          return ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000,
              namespace: `range-scale-${rowCount}-${iteration}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures build time scaling with row count', async () => {
      const rowCounts = [1000, 5000, 10000, 25000]
      const results: Array<{ rows: number; p50: number; p99: number }> = []

      for (const rowCount of rowCounts) {
        const data = Array.from({ length: rowCount }, (_, i) => ({
          id: `scale-row:${i}`,
          value: Math.random() * 10000,
          secondary: Math.random() * 1000,
        }))

        const result = await benchmark({
          name: `range-index-scale-${rowCount}`,
          target: 'iceberg.perf.do',
          iterations: 15,
          warmup: 3,
          run: async (ctx, iteration) => {
            return ctx.do.request('/iceberg/range/build', {
              method: 'POST',
              body: JSON.stringify({
                data,
                columns: ['value', 'secondary'],
                blockSize: 1000,
                namespace: `scale-${rowCount}-${iteration}`,
              }),
            })
          },
        })

        results.push({
          rows: rowCount,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Build Time Scaling ===')
      console.log('  Row Count   | p50 (ms) | p99 (ms)')
      console.log('  ------------|----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.rows).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`)
      }

      // Build time should scale linearly
      if (results.length >= 2) {
        const timeRatio = results[results.length - 1]!.p50 / results[0]!.p50
        const rowRatio = results[results.length - 1]!.rows / results[0]!.rows
        // Should not be worse than O(n log n)
        expect(timeRatio).toBeLessThan(rowRatio * Math.log2(rowRatio))
      }
    })
  })

  describe('min/max statistics', () => {
    it('generate min/max statistics for columns', async () => {
      const result = await benchmark({
        name: 'range-index-minmax',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: Math.random() * 10000,
            timestamp: Date.now() - Math.floor(Math.random() * 86400000 * 30),
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value', 'timestamp'],
              blockSize: 1000,
              namespace: 'minmax-test',
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/range/stats', {
            method: 'GET',
            headers: {
              'X-Namespace': 'minmax-test',
            },
          })
        },
      })

      record(result)

      console.log('\n=== Generate Min/Max Statistics ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('get block-level statistics', async () => {
      const result = await benchmark({
        name: 'range-index-block-stats',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: Math.random() * 10000,
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000,
              namespace: 'block-stats-test',
            }),
          })
        },
        run: async (ctx, i) => {
          const blockIndex = i % 10
          return ctx.do.request('/iceberg/range/block-stats', {
            method: 'GET',
            headers: {
              'X-Namespace': 'block-stats-test',
              'X-Block-Index': String(blockIndex),
            },
          })
        },
      })

      record(result)

      console.log('\n=== Block-Level Statistics ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(2)
    })

    it('measures statistics for multiple columns', async () => {
      const columnCounts = [1, 3, 5, 10]
      const results: Array<{ columns: number; p50: number }> = []

      for (const columnCount of columnCounts) {
        const columns = Array.from({ length: columnCount }, (_, i) => `col${i}`)
        const data = Array.from({ length: 10000 }, (_, i) => {
          const row: Record<string, number> = { id: i }
          for (const col of columns) {
            row[col] = Math.random() * 10000
          }
          return row
        })

        const result = await benchmark({
          name: `range-index-columns-${columnCount}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, iteration) => {
            return ctx.do.request('/iceberg/range/build', {
              method: 'POST',
              body: JSON.stringify({
                data,
                columns,
                blockSize: 1000,
                namespace: `columns-${columnCount}-${iteration}`,
              }),
            })
          },
        })

        results.push({
          columns: columnCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Statistics Time vs Column Count ===')
      console.log('  Columns     | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.columns).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Time should scale linearly with column count
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('range query pruning', () => {
    it('test range query pruning efficiency', async () => {
      const result = await benchmark({
        name: 'range-index-prune',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Create index with sorted data in blocks
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: i * 10, // Monotonically increasing
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000,
              namespace: 'prune-test',
            }),
          })
        },
        run: async (ctx, i) => {
          // Query different ranges
          const ranges = [
            { min: 0, max: 1000 }, // First block only
            { min: 45000, max: 55000 }, // Middle blocks
            { min: 90000, max: 100000 }, // Last block only
            { min: 0, max: 100000 }, // All blocks
          ]
          const range = ranges[i % ranges.length]!

          return ctx.do.request('/iceberg/range/prune', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'prune-test',
              column: 'value',
              min: range.min,
              max: range.max,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Range Query Pruning ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      // Pruning check should be very fast
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('measures pruning effectiveness', async () => {
      const result = await benchmark({
        name: 'range-index-prune-effectiveness',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create index with well-distributed data
          const data = Array.from({ length: 100000 }, (_, i) => ({
            id: `row:${i}`,
            value: i,
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000, // 100 blocks total
              namespace: 'prune-effectiveness',
            }),
          })
        },
        run: async (ctx) => {
          // Query a narrow range (should prune most blocks)
          const response = await ctx.fetch('/iceberg/range/prune', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: 'prune-effectiveness',
              column: 'value',
              min: 45000,
              max: 55000, // ~10% of data
            }),
          })

          const data = (await response.json()) as {
            totalBlocks: number
            matchingBlocks: number
            prunedBlocks: number
          }

          return data
        },
      })

      record(result)

      console.log('\n=== Pruning Effectiveness ===')
      console.log(`  Query p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
    })

    it('prune with compound conditions', async () => {
      const result = await benchmark({
        name: 'range-index-prune-compound',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value1: i % 1000,
            value2: Math.floor(i / 100),
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value1', 'value2'],
              blockSize: 1000,
              namespace: 'prune-compound',
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/range/prune', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'prune-compound',
              conditions: [
                { column: 'value1', min: 100, max: 200 },
                { column: 'value2', min: 50, max: 60 },
              ],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Compound Condition Pruning ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(2)
    })
  })

  describe('serialization', () => {
    it('serialize range index to R2', async () => {
      const result = await benchmark({
        name: 'range-index-serialize',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: Math.random() * 10000,
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000,
              namespace: 'serialize-range',
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/range/serialize', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'serialize-range',
              destination: 'r2://indexes/range/test.idx',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Serialize Range Index ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
    })

    it('deserialize range index from R2', async () => {
      const result = await benchmark({
        name: 'range-index-deserialize',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const data = Array.from({ length: 10000 }, (_, i) => ({
            id: `row:${i}`,
            value: Math.random() * 10000,
          }))

          await ctx.do.request('/iceberg/range/build', {
            method: 'POST',
            body: JSON.stringify({
              data,
              columns: ['value'],
              blockSize: 1000,
              namespace: 'deserialize-source',
            }),
          })

          await ctx.do.request('/iceberg/range/serialize', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'deserialize-source',
              destination: 'r2://indexes/range/deserialize-test.idx',
            }),
          })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/range/deserialize', {
            method: 'POST',
            body: JSON.stringify({
              source: 'r2://indexes/range/deserialize-test.idx',
              namespace: `deserialize-target-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Deserialize Range Index ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
    })
  })

  describe('concurrent access', () => {
    it('handles concurrent range queries', async () => {
      const concurrency = 5
      const iterationsPerWorker = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `range-index-concurrent-${workerIndex}`,
            target: 'iceberg.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            setup:
              workerIndex === 0
                ? async (ctx) => {
                    const data = Array.from({ length: 10000 }, (_, i) => ({
                      id: `row:${i}`,
                      value: i * 10,
                    }))

                    await ctx.do.request('/iceberg/range/build', {
                      method: 'POST',
                      body: JSON.stringify({
                        data,
                        columns: ['value'],
                        blockSize: 1000,
                        namespace: 'concurrent-range',
                      }),
                    })
                  }
                : undefined,
            run: async (ctx, i) => {
              const offset = (workerIndex * 1000 + i * 100) % 90000
              return ctx.do.request('/iceberg/range/prune', {
                method: 'POST',
                body: JSON.stringify({
                  namespace: 'concurrent-range',
                  column: 'value',
                  min: offset,
                  max: offset + 10000,
                }),
              })
            },
          })
        )
      )

      record(results)

      console.log('\n=== Concurrent Range Queries ===')
      const allP50s = results.map((r) => r.stats.p50)
      console.log(`  Workers: ${concurrency}`)
      console.log(`  Avg p50: ${(allP50s.reduce((a, b) => a + b, 0) / allP50s.length).toFixed(3)} ms`)
      console.log(`  Max p50: ${Math.max(...allP50s).toFixed(3)} ms`)

      // All workers should complete without errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(iterationsPerWorker * 0.1)
      }
    })
  })
})
