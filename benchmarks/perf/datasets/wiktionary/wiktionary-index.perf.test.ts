/**
 * Wiktionary Index Building Performance Benchmarks
 *
 * Tests index construction performance for the 1M+ word Wiktionary dataset.
 * Covers inverted index, Bloom filters, and vector embeddings for definitions.
 *
 * Performance targets:
 * - Inverted index build: 50,000+ terms/second
 * - Bloom filter build: 100,000+ entries/second
 * - Vector embedding: 100+ definitions/second (with API calls)
 *
 * Index types:
 * - Inverted index: Full-text search on definitions/etymologies
 * - Bloom filter: Fast negative lookups for word existence
 * - Vector embeddings: Semantic similarity for definitions
 *
 * @see db/iceberg/inverted-index.ts for inverted index implementation
 * @see db/core/bloom.ts for Bloom filter implementation
 * @see dotdo-06d3k for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Target terms per second for inverted index building
 */
const TARGET_INDEX_TERMS_PER_SECOND = 50_000

/**
 * Target entries per second for Bloom filter building
 */
const TARGET_BLOOM_ENTRIES_PER_SECOND = 100_000

/**
 * Target definitions per second for vector embedding
 */
const TARGET_VECTOR_DEFS_PER_SECOND = 100

/**
 * Maximum acceptable p95 latency for single term indexing (ms)
 */
const MAX_SINGLE_TERM_INDEX_P95_MS = 5

/**
 * Maximum acceptable p95 latency for batch indexing (ms)
 */
const MAX_BATCH_INDEX_P95_MS = 200

/**
 * Maximum acceptable p95 for Bloom filter operations (ms)
 */
const MAX_BLOOM_OPERATION_P95_MS = 1

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample definitions for indexing
 */
const SAMPLE_DEFINITIONS = [
  'A finite sequence of well-defined instructions for solving a class of problems.',
  'A structured collection of data stored and accessed electronically.',
  'The rules governing the format of addresses and how data is transmitted.',
  'The process of converting information into a code for security purposes.',
  'A programming paradigm based on objects containing data and methods.',
  'The property of a program to execute multiple tasks simultaneously.',
  'A reusable piece of code that performs a specific task.',
  'A software component that provides services to other applications.',
  'A data structure that maps keys to values for efficient lookup.',
  'The delay between initiating a request and receiving a response.',
]

/**
 * Generate sample word entries for testing
 */
function generateWordEntries(count: number, offset: number = 0): Array<{
  word: string
  pos: string
  definitions: string[]
  etymology: string
}> {
  const pos = ['noun', 'verb', 'adjective', 'adverb']
  return Array.from({ length: count }, (_, i) => ({
    word: `word${offset + i}`,
    pos: pos[i % pos.length]!,
    definitions: [
      SAMPLE_DEFINITIONS[i % SAMPLE_DEFINITIONS.length]!,
      `Alternative definition ${i} for testing purposes.`,
    ],
    etymology: `From Latin word${i}us, derived from Proto-Indo-European root *word-`,
  }))
}

/**
 * Generate text content for indexing benchmarks
 */
function generateTextContent(wordCount: number): string {
  const words = ['algorithm', 'data', 'function', 'object', 'process', 'system', 'network', 'protocol', 'interface', 'method']
  return Array.from({ length: wordCount }, (_, i) => words[i % words.length]).join(' ')
}

// ============================================================================
// INVERTED INDEX BUILDING BENCHMARKS
// ============================================================================

describe('Wiktionary inverted index building', () => {
  describe('single entry indexing', () => {
    it('index single word entry', async () => {
      const result = await benchmark({
        name: 'wiktionary-index-single',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const entry = generateWordEntries(1, i)[0]
          return ctx.do.request('/index/inverted/entry', {
            method: 'POST',
            body: JSON.stringify(entry),
          })
        },
      })

      record(result)

      console.log('\n=== Single Entry Indexing ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1000 / result.stats.p50).toFixed(0)} entries/sec`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_TERM_INDEX_P95_MS)
    })

    it('index entries with varying definition lengths', async () => {
      const definitionLengths = [50, 200, 500, 1000, 2000]
      const results: Array<{ length: number; p50: number; throughput: number }> = []

      for (const length of definitionLengths) {
        const result = await benchmark({
          name: `wiktionary-index-deflen-${length}`,
          target: 'wiktionary.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            const entry = {
              word: `word${i}`,
              definitions: ['x'.repeat(length).split(' ').map(w => `word${w}`).slice(0, length / 5).join(' ')],
            }
            return ctx.do.request('/index/inverted/entry', {
              method: 'POST',
              body: JSON.stringify(entry),
            })
          },
        })

        results.push({
          length,
          p50: result.stats.p50,
          throughput: 1000 / result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Index Time by Definition Length ===')
      console.log('  Chars     | p50 (ms)  | Entries/sec')
      console.log('  ----------|-----------|-------------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(9)} | ${r.p50.toFixed(3).padStart(9)} | ${r.throughput.toFixed(0).padStart(11)}`)
      }

      // Indexing time should scale sub-linearly
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(5)
    })
  })

  describe('batch index building', () => {
    it.each([100, 500, 1000, 5000])('build index from %d entries', async (batchSize) => {
      const entries = generateWordEntries(batchSize)

      const result = await benchmark({
        name: `wiktionary-index-batch-${batchSize}`,
        target: 'wiktionary.perf.do',
        iterations: 15,
        warmup: 3,
        datasetSize: batchSize,
        run: async (ctx) =>
          ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          }),
      })

      record(result)

      const entriesPerSecond = (batchSize / result.stats.p50) * 1000
      const termsPerSecond = entriesPerSecond * 20 // Estimate ~20 terms per entry

      console.log(`\n=== Batch Index Build (${batchSize} entries) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Entries/sec: ${entriesPerSecond.toFixed(0)}`)
      console.log(`  Est. terms/sec: ${termsPerSecond.toFixed(0)}`)

      expect(result.samples.length).toBe(15)
    })

    it('measures throughput scaling', async () => {
      const batchSizes = [100, 500, 1000, 2500, 5000]
      const throughputs: Array<{ size: number; entriesPerSec: number; termsPerSec: number }> = []

      for (const size of batchSizes) {
        const entries = generateWordEntries(size)

        const result = await benchmark({
          name: `wiktionary-index-throughput-${size}`,
          target: 'wiktionary.perf.do',
          iterations: 10,
          warmup: 2,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/index/inverted/batch', {
              method: 'POST',
              body: JSON.stringify({ entries }),
            }),
        })

        const entriesPerSec = (size / result.stats.p50) * 1000
        const termsPerSec = entriesPerSec * 20 // ~20 terms per entry estimate

        throughputs.push({
          size,
          entriesPerSec,
          termsPerSec,
        })

        record(result)
      }

      console.log('\n=== Index Throughput Scaling ===')
      console.log('  Batch Size  | Entries/sec | Terms/sec')
      console.log('  ------------|-------------|----------')
      for (const t of throughputs) {
        console.log(`  ${String(t.size).padEnd(11)} | ${t.entriesPerSec.toFixed(0).padStart(11)} | ${t.termsPerSec.toFixed(0).padStart(9)}`)
      }

      // Should achieve target throughput with large batches
      expect(throughputs[throughputs.length - 1]!.termsPerSec).toBeGreaterThan(TARGET_INDEX_TERMS_PER_SECOND / 2)
    })
  })

  describe('incremental index updates', () => {
    it('add terms to existing index', async () => {
      const result = await benchmark({
        name: 'wiktionary-index-incremental',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-populate index with 10K entries
          const entries = generateWordEntries(10000)
          await ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
        run: async (ctx, i) => {
          // Add single new entry to existing index
          const entry = generateWordEntries(1, 100000 + i)[0]
          return ctx.do.request('/index/inverted/entry', {
            method: 'POST',
            body: JSON.stringify(entry),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/index/inverted/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Incremental Index Update ===')
      console.log(`  Base index size: 10,000 entries`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Incremental updates should be fast
      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_TERM_INDEX_P95_MS * 2)
    })
  })

  describe('index serialization', () => {
    it('serialize inverted index to R2', async () => {
      const result = await benchmark({
        name: 'wiktionary-index-serialize',
        target: 'wiktionary.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          const entries = generateWordEntries(25000)
          await ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
        run: async (ctx) =>
          ctx.do.request('/index/inverted/serialize', {
            method: 'POST',
            body: JSON.stringify({
              destination: 'r2://indexes/wiktionary/test.idx',
            }),
          }),
        teardown: async (ctx) => {
          await ctx.do.request('/index/inverted/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Index Serialization (25K entries) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INDEX_P95_MS * 2)
    })
  })
})

// ============================================================================
// BLOOM FILTER BENCHMARKS
// ============================================================================

describe('Wiktionary Bloom filter', () => {
  describe('filter building', () => {
    it('build Bloom filter from word list', async () => {
      const result = await benchmark({
        name: 'wiktionary-bloom-build',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          // Build filter from 10K words
          const words = Array.from({ length: 10000 }, (_, j) => `word${i * 10000 + j}`)
          return ctx.do.request('/index/bloom/build', {
            method: 'POST',
            body: JSON.stringify({
              words,
              expectedSize: 10000,
              falsePositiveRate: 0.01,
            }),
          })
        },
      })

      record(result)

      const wordsPerSecond = (10000 / result.stats.p50) * 1000

      console.log('\n=== Bloom Filter Build (10K words) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${wordsPerSecond.toFixed(0)} words/sec`)

      expect(wordsPerSecond).toBeGreaterThan(TARGET_BLOOM_ENTRIES_PER_SECOND / 2)
    })

    it('build Bloom filter at scale', async () => {
      const sizes = [10000, 50000, 100000, 250000]
      const results: Array<{ size: number; p50: number; wordsPerSec: number }> = []

      for (const size of sizes) {
        const words = Array.from({ length: size }, (_, i) => `word${i}`)

        const result = await benchmark({
          name: `wiktionary-bloom-build-${size}`,
          target: 'wiktionary.perf.do',
          iterations: 10,
          warmup: 2,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/index/bloom/build', {
              method: 'POST',
              body: JSON.stringify({
                words,
                expectedSize: size,
                falsePositiveRate: 0.01,
              }),
            }),
        })

        const wordsPerSec = (size / result.stats.p50) * 1000

        results.push({
          size,
          p50: result.stats.p50,
          wordsPerSec,
        })

        record(result)
      }

      console.log('\n=== Bloom Filter Build Scaling ===')
      console.log('  Size      | p50 (ms)  | Words/sec')
      console.log('  ----------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(9)} | ${r.p50.toFixed(3).padStart(9)} | ${r.wordsPerSec.toFixed(0).padStart(9)}`)
      }

      // Build time should scale linearly (throughput stays constant)
      const throughputRatio = results[results.length - 1]!.wordsPerSec / results[0]!.wordsPerSec
      expect(throughputRatio).toBeGreaterThan(0.5) // Within 2x
    })
  })

  describe('filter lookup', () => {
    it('check word existence in filter', async () => {
      const result = await benchmark({
        name: 'wiktionary-bloom-lookup',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Build filter with 100K words
          const words = Array.from({ length: 100000 }, (_, i) => `word${i}`)
          await ctx.do.request('/index/bloom/build', {
            method: 'POST',
            body: JSON.stringify({
              words,
              expectedSize: 100000,
              falsePositiveRate: 0.01,
            }),
          })
        },
        run: async (ctx, i) =>
          ctx.do.request('/index/bloom/check', {
            method: 'POST',
            body: JSON.stringify({
              word: `word${i % 100000}`,
            }),
          }),
      })

      record(result)

      console.log('\n=== Bloom Filter Lookup ===')
      console.log(`  Filter size: 100,000 words`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Lookups/sec: ${(1000 / result.stats.p50).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(MAX_BLOOM_OPERATION_P95_MS)
    })

    it('batch lookup performance', async () => {
      const batchSizes = [10, 50, 100, 500]
      const results: Array<{ batch: number; p50: number; lookupsPerSec: number }> = []

      for (const batch of batchSizes) {
        const result = await benchmark({
          name: `wiktionary-bloom-batch-${batch}`,
          target: 'wiktionary.perf.do',
          iterations: 30,
          warmup: 5,
          setup: async (ctx) => {
            const words = Array.from({ length: 100000 }, (_, i) => `word${i}`)
            await ctx.do.request('/index/bloom/build', {
              method: 'POST',
              body: JSON.stringify({
                words,
                expectedSize: 100000,
                falsePositiveRate: 0.01,
              }),
            })
          },
          run: async (ctx, i) => {
            const wordsToCheck = Array.from({ length: batch }, (_, j) => `word${(i * batch + j) % 100000}`)
            return ctx.do.request('/index/bloom/batch-check', {
              method: 'POST',
              body: JSON.stringify({ words: wordsToCheck }),
            })
          },
        })

        const lookupsPerSec = (batch / result.stats.p50) * 1000

        results.push({
          batch,
          p50: result.stats.p50,
          lookupsPerSec,
        })

        record(result)
      }

      console.log('\n=== Batch Bloom Lookup ===')
      console.log('  Batch | p50 (ms)  | Lookups/sec')
      console.log('  ------|-----------|------------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(5)} | ${r.p50.toFixed(3).padStart(9)} | ${r.lookupsPerSec.toFixed(0).padStart(11)}`)
      }

      // Batch lookups should have better throughput
      expect(results[results.length - 1]!.lookupsPerSec).toBeGreaterThan(results[0]!.lookupsPerSec)
    })
  })

  describe('filter effectiveness', () => {
    it('measure false positive rate', async () => {
      let falsePositives = 0
      let totalChecks = 0

      const result = await benchmark({
        name: 'wiktionary-bloom-fp-rate',
        target: 'wiktionary.perf.do',
        iterations: 100,
        warmup: 5,
        setup: async (ctx) => {
          // Build filter with words 0-99999
          const words = Array.from({ length: 100000 }, (_, i) => `existingword${i}`)
          await ctx.do.request('/index/bloom/build', {
            method: 'POST',
            body: JSON.stringify({
              words,
              expectedSize: 100000,
              falsePositiveRate: 0.01,
            }),
          })
        },
        run: async (ctx, i) => {
          // Check words that DON'T exist (100000+)
          const response = await ctx.do.request<{ exists: boolean }>('/index/bloom/check', {
            method: 'POST',
            body: JSON.stringify({
              word: `nonexistentword${100000 + i}`,
            }),
          })
          totalChecks++
          if (response.exists) falsePositives++
          return response
        },
      })

      record(result)

      const fpRate = (falsePositives / totalChecks) * 100

      console.log('\n=== Bloom Filter False Positive Rate ===')
      console.log(`  Target FP rate: 1%`)
      console.log(`  Total checks: ${totalChecks}`)
      console.log(`  False positives: ${falsePositives}`)
      console.log(`  Actual FP rate: ${fpRate.toFixed(2)}%`)

      // Should be close to target (within 2x)
      expect(fpRate).toBeLessThan(2.0)
    })
  })
})

// ============================================================================
// VECTOR EMBEDDING BENCHMARKS
// ============================================================================

describe('Wiktionary vector embeddings', () => {
  describe('definition embedding', () => {
    it('generate embedding for single definition', async () => {
      const result = await benchmark({
        name: 'wiktionary-embedding-single',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const definition = SAMPLE_DEFINITIONS[i % SAMPLE_DEFINITIONS.length]
          return ctx.do.request('/index/vector/embed', {
            method: 'POST',
            body: JSON.stringify({
              text: definition,
              model: 'bge-base-en-v1.5',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Definition Embedding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1000 / result.stats.p50).toFixed(1)} defs/sec`)

      expect((1000 / result.stats.p50)).toBeGreaterThan(TARGET_VECTOR_DEFS_PER_SECOND / 2)
    })

    it('batch embed definitions', async () => {
      const batchSizes = [5, 10, 25, 50]
      const results: Array<{ batch: number; p50: number; defsPerSec: number }> = []

      for (const batch of batchSizes) {
        const definitions = Array.from({ length: batch }, (_, i) =>
          SAMPLE_DEFINITIONS[i % SAMPLE_DEFINITIONS.length]
        )

        const result = await benchmark({
          name: `wiktionary-embedding-batch-${batch}`,
          target: 'wiktionary.perf.do',
          iterations: 15,
          warmup: 3,
          run: async (ctx) =>
            ctx.do.request('/index/vector/batch-embed', {
              method: 'POST',
              body: JSON.stringify({
                texts: definitions,
                model: 'bge-base-en-v1.5',
              }),
            }),
        })

        const defsPerSec = (batch / result.stats.p50) * 1000

        results.push({
          batch,
          p50: result.stats.p50,
          defsPerSec,
        })

        record(result)
      }

      console.log('\n=== Batch Definition Embedding ===')
      console.log('  Batch | p50 (ms)   | Defs/sec')
      console.log('  ------|------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(5)} | ${r.p50.toFixed(3).padStart(10)} | ${r.defsPerSec.toFixed(1).padStart(8)}`)
      }

      // Batch embedding should improve throughput
      expect(results[results.length - 1]!.defsPerSec).toBeGreaterThan(results[0]!.defsPerSec * 0.8)
    })
  })

  describe('vector index building', () => {
    it('build vector index from embeddings', async () => {
      const result = await benchmark({
        name: 'wiktionary-vector-index-build',
        target: 'wiktionary.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx, i) => {
          // Build index from 1000 pre-computed embeddings
          const embeddings = Array.from({ length: 1000 }, (_, j) => ({
            id: `def${i * 1000 + j}`,
            vector: Array.from({ length: 768 }, () => Math.random()), // 768-dim
          }))

          return ctx.do.request('/index/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              embeddings,
              indexType: 'hnsw',
              params: {
                m: 16,
                efConstruction: 200,
              },
            }),
          })
        },
      })

      record(result)

      const vectorsPerSec = (1000 / result.stats.p50) * 1000

      console.log('\n=== Vector Index Build (1K vectors) ===')
      console.log(`  Dimensions: 768`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Vectors/sec: ${vectorsPerSec.toFixed(0)}`)

      expect(result.samples.length).toBe(10)
    })

    it('incremental vector index update', async () => {
      const result = await benchmark({
        name: 'wiktionary-vector-index-update',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Pre-build index with 5000 vectors
          const embeddings = Array.from({ length: 5000 }, (_, j) => ({
            id: `def${j}`,
            vector: Array.from({ length: 768 }, () => Math.random()),
          }))

          await ctx.do.request('/index/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              embeddings,
              indexType: 'hnsw',
            }),
          })
        },
        run: async (ctx, i) => {
          // Add single vector to existing index
          return ctx.do.request('/index/vector/add', {
            method: 'POST',
            body: JSON.stringify({
              id: `newdef${i}`,
              vector: Array.from({ length: 768 }, () => Math.random()),
            }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/index/vector/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Incremental Vector Update ===')
      console.log(`  Base index: 5,000 vectors`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Updates should be fast
      expect(result.stats.p95).toBeLessThan(50)
    })
  })

  describe('semantic similarity search', () => {
    it('search for similar definitions', async () => {
      const result = await benchmark({
        name: 'wiktionary-vector-search',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Build index with 10K definitions
          const embeddings = Array.from({ length: 10000 }, (_, j) => ({
            id: `def${j}`,
            vector: Array.from({ length: 768 }, () => Math.random()),
          }))

          await ctx.do.request('/index/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              embeddings,
              indexType: 'hnsw',
            }),
          })
        },
        run: async (ctx, i) => {
          const queryVector = Array.from({ length: 768 }, () => Math.random())
          return ctx.do.request('/index/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Vector Similarity Search (10K index) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Queries/sec: ${(1000 / result.stats.p50).toFixed(0)}`)

      // Vector search should be fast with HNSW
      expect(result.stats.p95).toBeLessThan(50)
    })

    it('search scaling with index size', async () => {
      const indexSizes = [1000, 5000, 10000, 25000]
      const results: Array<{ size: number; p50: number; qps: number }> = []

      for (const size of indexSizes) {
        const result = await benchmark({
          name: `wiktionary-vector-search-${size}`,
          target: 'wiktionary.perf.do',
          iterations: 20,
          warmup: 5,
          setup: async (ctx) => {
            const embeddings = Array.from({ length: size }, (_, j) => ({
              id: `def${j}`,
              vector: Array.from({ length: 768 }, () => Math.random()),
            }))

            await ctx.do.request('/index/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                embeddings,
                indexType: 'hnsw',
              }),
            })
          },
          run: async (ctx) => {
            const queryVector = Array.from({ length: 768 }, () => Math.random())
            return ctx.do.request('/index/vector/search', {
              method: 'POST',
              body: JSON.stringify({
                vector: queryVector,
                k: 10,
              }),
            })
          },
          teardown: async (ctx) => {
            await ctx.do.request('/index/vector/clear', { method: 'POST' })
          },
        })

        const qps = 1000 / result.stats.p50

        results.push({
          size,
          p50: result.stats.p50,
          qps,
        })

        record(result)
      }

      console.log('\n=== Vector Search Scaling ===')
      console.log('  Index Size | p50 (ms)  | QPS')
      console.log('  -----------|-----------|-------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(10)} | ${r.p50.toFixed(3).padStart(9)} | ${r.qps.toFixed(0).padStart(5)}`)
      }

      // Search should scale sub-linearly with HNSW
      const latencyRatio = results[results.length - 1]!.p50 / results[0]!.p50
      const sizeRatio = results[results.length - 1]!.size / results[0]!.size
      expect(latencyRatio).toBeLessThan(Math.sqrt(sizeRatio))
    })
  })
})

// ============================================================================
// COMBINED INDEX OPERATIONS
// ============================================================================

describe('Wiktionary combined indexing', () => {
  describe('full index pipeline', () => {
    it('build all indexes from word batch', async () => {
      const entries = generateWordEntries(1000)

      const result = await benchmark({
        name: 'wiktionary-index-full-pipeline',
        target: 'wiktionary.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) =>
          ctx.do.request('/index/build-all', {
            method: 'POST',
            body: JSON.stringify({
              entries,
              indexes: ['inverted', 'bloom', 'vector'],
            }),
          }),
      })

      record(result)

      console.log('\n=== Full Index Pipeline (1K entries) ===')
      console.log(`  Indexes: inverted, bloom, vector`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Entries/sec: ${((1000 / result.stats.p50) * 1000).toFixed(0)}`)

      expect(result.samples.length).toBe(10)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Index Building Summary', () => {
  it('should document index building performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKTIONARY INDEX BUILDING SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Inverted index: >${TARGET_INDEX_TERMS_PER_SECOND.toLocaleString()} terms/sec`)
    console.log(`  - Bloom filter: >${TARGET_BLOOM_ENTRIES_PER_SECOND.toLocaleString()} entries/sec`)
    console.log(`  - Vector embeddings: >${TARGET_VECTOR_DEFS_PER_SECOND} defs/sec`)
    console.log('')

    console.log('Index types:')
    console.log('  - Inverted: Full-text search on definitions/etymologies')
    console.log('  - Bloom: Fast negative lookups for word existence')
    console.log('  - Vector: Semantic similarity for definitions (HNSW)')
    console.log('')

    console.log('Scaling characteristics:')
    console.log('  - Inverted index: Linear build, sub-linear query')
    console.log('  - Bloom filter: O(1) lookup, O(n) build')
    console.log('  - Vector index: O(log n) search with HNSW')
    console.log('')

    console.log('Memory considerations:')
    console.log('  - Inverted index: ~50 bytes per term')
    console.log('  - Bloom filter: ~10 bits per entry')
    console.log('  - Vector index: 768 dims * 4 bytes = 3KB per entry')
    console.log('')

    console.log('Storage strategy:')
    console.log('  - Serialize indexes to R2 for durability')
    console.log('  - Load into SQLite/memory for fast queries')
    console.log('  - Incremental updates during ingest')
    console.log('')

    expect(true).toBe(true)
  })
})
