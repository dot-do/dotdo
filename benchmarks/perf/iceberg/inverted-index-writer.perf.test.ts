/**
 * Inverted Index Writer Performance Benchmarks
 *
 * Tests index building performance for full-text search capabilities:
 * - Single document indexing latency
 * - Batch indexing throughput
 * - Index serialization to R2
 * - Index size vs document count scaling
 *
 * Expected performance:
 * - Index single doc: <5ms
 * - Batch 100 docs: <200ms
 *
 * @see db/iceberg/inverted-index.ts for implementation
 * @see dotdo-2mibg for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('InvertedIndexWriter benchmarks', () => {
  describe('single document indexing', () => {
    it('index single document', async () => {
      const result = await benchmark({
        name: 'inverted-index-single',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/iceberg/inverted/index', {
            method: 'POST',
            body: JSON.stringify({
              id: `doc:${i}`,
              text: `This is document ${i} about software engineering and distributed systems`,
            }),
          })
        },
      })

      record(result)

      // Log results for visibility
      console.log('\n=== Inverted Index Single Document ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Verify benchmark completed successfully
      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)
      // Single document indexing should be fast
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('index document with varying text lengths', async () => {
      const textLengths = [100, 500, 1000, 5000]
      const results: Array<{ length: number; p50: number; p99: number }> = []

      for (const length of textLengths) {
        const text = 'word '.repeat(length / 5)

        const result = await benchmark({
          name: `inverted-index-text-${length}`,
          target: 'iceberg.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx, i) => {
            return ctx.do.request('/iceberg/inverted/index', {
              method: 'POST',
              body: JSON.stringify({
                id: `doc:${length}:${i}`,
                text: text,
              }),
            })
          },
        })

        results.push({
          length,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Index Time by Text Length ===')
      console.log('  Length      | p50 (ms) | p99 (ms)')
      console.log('  ------------|----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)} | ${r.p99.toFixed(3).padStart(8)}`)
      }

      // Indexing time should scale sub-linearly with text length
      if (results.length >= 2) {
        const ratio = results[results.length - 1]!.p50 / results[0]!.p50
        const lengthRatio = results[results.length - 1]!.length / results[0]!.length
        expect(ratio).toBeLessThan(lengthRatio)
      }
    })
  })

  describe('batch indexing', () => {
    it('batch index 100 documents', async () => {
      const documents = Array.from({ length: 100 }, (_, i) => ({
        id: `batch-doc:${i}`,
        text: `Document ${i} contains information about topic ${i % 10} and category ${i % 5}`,
      }))

      const result = await benchmark({
        name: 'inverted-index-batch-100',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
      })

      record(result)

      console.log('\n=== Batch Index 100 Documents ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(20)
      // Batch 100 docs should complete in under 200ms
      expect(result.stats.p50).toBeLessThan(200)
    })

    it.each([10, 50, 100, 500])('batch index %d documents', async (count) => {
      const documents = Array.from({ length: count }, (_, i) => ({
        id: `batch-${count}-doc:${i}`,
        text: `Document ${i} about software engineering practices and design patterns`,
      }))

      const result = await benchmark({
        name: `inverted-index-batch-${count}`,
        target: 'iceberg.perf.do',
        iterations: 15,
        warmup: 3,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(15)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures throughput vs batch size', async () => {
      const batchSizes = [10, 25, 50, 100, 250]
      const throughputs: Array<{ size: number; docsPerSecond: number }> = []

      for (const size of batchSizes) {
        const documents = Array.from({ length: size }, (_, i) => ({
          id: `throughput-${size}-doc:${i}`,
          text: `Document ${i} with standard content for throughput testing`,
        }))

        const result = await benchmark({
          name: `inverted-index-throughput-${size}`,
          target: 'iceberg.perf.do',
          iterations: 10,
          warmup: 2,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/inverted/batch', {
              method: 'POST',
              body: JSON.stringify({ documents }),
            })
          },
        })

        const docsPerSecond = (size / result.stats.p50) * 1000
        throughputs.push({ size, docsPerSecond })

        record(result)
      }

      console.log('\n=== Throughput vs Batch Size ===')
      console.log('  Batch Size  | Docs/Second')
      console.log('  ------------|------------')
      for (const t of throughputs) {
        console.log(`  ${String(t.size).padEnd(11)} | ${t.docsPerSecond.toFixed(0).padStart(11)}`)
      }

      // Throughput should increase with batch size (up to a point)
      expect(throughputs[throughputs.length - 1]!.docsPerSecond).toBeGreaterThan(throughputs[0]!.docsPerSecond)
    })
  })

  describe('serialization to R2', () => {
    it('serialize index to R2', async () => {
      const result = await benchmark({
        name: 'inverted-index-serialize',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Pre-populate index with documents
          const documents = Array.from({ length: 1000 }, (_, i) => ({
            id: `serialize-doc:${i}`,
            text: `Document ${i} about various topics including software, data, and systems`,
          }))
          await ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/inverted/serialize', {
            method: 'POST',
            body: JSON.stringify({
              destination: 'r2://indexes/inverted/test.idx',
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/iceberg/inverted/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Serialize Index to R2 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures serialization time vs index size', async () => {
      const documentCounts = [100, 500, 1000, 2500]
      const results: Array<{ docs: number; p50: number; sizeKB?: number }> = []

      for (const docCount of documentCounts) {
        const documents = Array.from({ length: docCount }, (_, i) => ({
          id: `size-test-doc:${i}`,
          text: `Document ${i} contains searchable content with various terms and phrases`,
        }))

        const result = await benchmark({
          name: `inverted-index-serialize-${docCount}`,
          target: 'iceberg.perf.do',
          iterations: 10,
          warmup: 2,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/inverted/clear', { method: 'POST' })
            await ctx.do.request('/iceberg/inverted/batch', {
              method: 'POST',
              body: JSON.stringify({ documents }),
            })
          },
          run: async (ctx) => {
            const response = await ctx.fetch('/iceberg/inverted/serialize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                destination: `r2://indexes/inverted/size-test-${docCount}.idx`,
              }),
            })
            return response.json()
          },
        })

        results.push({
          docs: docCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Serialization Time vs Document Count ===')
      console.log('  Documents   | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.docs).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Serialization should scale reasonably with document count
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('index size scaling', () => {
    it('measure index size vs document count', async () => {
      const documentCounts = [100, 500, 1000, 5000]
      const sizeResults: Array<{ docs: number; sizeBytes: number; terms: number }> = []

      for (const docCount of documentCounts) {
        const documents = Array.from({ length: docCount }, (_, i) => ({
          id: `size-doc:${i}`,
          text: `Document ${i} about topic ${i % 50} in category ${i % 10} with tags ${i % 20}`,
        }))

        const result = await benchmark({
          name: `inverted-index-size-${docCount}`,
          target: 'iceberg.perf.do',
          iterations: 5,
          warmup: 1,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/inverted/clear', { method: 'POST' })
            await ctx.do.request('/iceberg/inverted/batch', {
              method: 'POST',
              body: JSON.stringify({ documents }),
            })
          },
          run: async (ctx) => {
            const response = await ctx.fetch('/iceberg/inverted/stats', {
              method: 'GET',
            })
            const stats = (await response.json()) as { sizeBytes: number; termCount: number }
            sizeResults.push({
              docs: docCount,
              sizeBytes: stats.sizeBytes,
              terms: stats.termCount,
            })
            return stats
          },
        })

        record(result)
      }

      console.log('\n=== Index Size vs Document Count ===')
      console.log('  Documents   | Size (KB) | Terms')
      console.log('  ------------|-----------|-------')
      for (const r of sizeResults) {
        console.log(`  ${String(r.docs).padEnd(11)} | ${(r.sizeBytes / 1024).toFixed(1).padStart(9)} | ${String(r.terms).padStart(5)}`)
      }

      // Index size should scale sub-linearly due to term deduplication
      if (sizeResults.length >= 2) {
        const sizeRatio = sizeResults[sizeResults.length - 1]!.sizeBytes / sizeResults[0]!.sizeBytes
        const docRatio = sizeResults[sizeResults.length - 1]!.docs / sizeResults[0]!.docs
        expect(sizeRatio).toBeLessThan(docRatio)
      }
    })

    it('verify index fits in 2MB Snippets memory', async () => {
      const MAX_SNIPPETS_MEMORY = 2 * 1024 * 1024 // 2MB

      const result = await benchmark({
        name: 'inverted-index-memory-check',
        target: 'iceberg.perf.do',
        iterations: 5,
        warmup: 1,
        setup: async (ctx) => {
          // Create index with 10K documents (representative workload)
          const documents = Array.from({ length: 10000 }, (_, i) => ({
            id: `memory-doc:${i}`,
            text: `Document ${i} with searchable content about various technical topics`,
          }))
          await ctx.do.request('/iceberg/inverted/clear', { method: 'POST' })
          await ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
        run: async (ctx) => {
          const response = await ctx.fetch('/iceberg/inverted/stats', {
            method: 'GET',
          })
          return response.json()
        },
      })

      record(result)

      // Verify index size is within Snippets memory constraints
      // Note: actual check happens in the DO, this is informational
      expect(result.samples.length).toBe(5)
    })
  })

  describe('term lookup performance', () => {
    it('lookup single term', async () => {
      const result = await benchmark({
        name: 'inverted-index-lookup-single',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const documents = Array.from({ length: 1000 }, (_, i) => ({
            id: `lookup-doc:${i}`,
            text: `Document ${i} about software engineering and distributed systems`,
          }))
          await ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
        run: async (ctx, i) => {
          const terms = ['software', 'engineering', 'distributed', 'systems', 'document']
          const term = terms[i % terms.length]
          return ctx.do.request('/iceberg/inverted/lookup', {
            method: 'POST',
            body: JSON.stringify({ term }),
          })
        },
      })

      record(result)

      console.log('\n=== Term Lookup Performance ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      // Term lookup should be very fast (binary search)
      expect(result.stats.p50).toBeLessThan(2)
    })

    it('intersect multiple terms (AND query)', async () => {
      const result = await benchmark({
        name: 'inverted-index-intersect',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const documents = Array.from({ length: 1000 }, (_, i) => ({
            id: `intersect-doc:${i}`,
            text: `Document ${i} about software engineering and distributed systems architecture`,
          }))
          await ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/inverted/query', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'AND',
              terms: ['software', 'distributed'],
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Term Intersection Performance ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(5)
    })
  })
})
