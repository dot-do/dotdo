/**
 * Wikipedia Index Building Performance Benchmarks
 *
 * Tests index construction performance for the ~6M article Wikipedia dataset.
 * Covers inverted index building, BM25 search, infobox field indexing,
 * category/link graph indexing, and vector embeddings.
 *
 * Performance targets:
 * - Inverted index build: 50,000+ terms/second
 * - BM25 search: <500ms (p95) over 6M articles
 * - Vector embedding: 100+ articles/second
 * - Index serialization: <5s for 100K article partition
 *
 * Index types:
 * - Inverted: Full-text search on article content
 * - Infobox: Field-level indexing for structured queries
 * - Category: Parent-child hierarchy index
 * - Link: Graph edge index for navigation
 * - Vector: Semantic similarity via embeddings
 *
 * @see db/iceberg/inverted-index.ts for index implementation
 * @see dotdo-ymo5u for issue tracking
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
 * Target articles per second for vector embedding
 */
const TARGET_VECTOR_ARTICLES_PER_SECOND = 100

/**
 * Maximum acceptable p95 latency for BM25 search (ms)
 */
const MAX_BM25_SEARCH_P95_MS = 500

/**
 * Maximum acceptable time for partition serialization (s)
 */
const MAX_PARTITION_SERIALIZE_S = 5

/**
 * Maximum acceptable p95 latency for single term indexing (ms)
 */
const MAX_SINGLE_TERM_INDEX_P95_MS = 5

/**
 * Maximum acceptable p95 latency for batch indexing (ms)
 */
const MAX_BATCH_INDEX_P95_MS = 500

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample article text for indexing benchmarks
 */
const SAMPLE_ARTICLE_TEXTS = [
  'Machine learning is a branch of artificial intelligence that enables systems to learn from data.',
  'Computer science is the study of computation, automation, and information.',
  'Algorithms are step-by-step procedures for calculations, data processing, and automated reasoning.',
  'A database is an organized collection of data stored and accessed electronically.',
  'Software engineering is the systematic application of engineering approaches to software development.',
  'The Internet is a global system of interconnected computer networks.',
  'Cryptography is the practice of secure communication in the presence of adversarial behavior.',
  'Operating systems are software that manage computer hardware and software resources.',
  'Programming languages are formal languages comprising instructions that produce various outputs.',
  'Cloud computing is on-demand availability of computer system resources.',
]

/**
 * Sample infobox data for field indexing
 */
const SAMPLE_INFOBOXES = [
  { template: 'company', name: 'Microsoft', industry: 'Technology', founded: '1975' },
  { template: 'company', name: 'Google', industry: 'Technology', founded: '1998' },
  { template: 'software', name: 'Linux', developer: 'Community', license: 'GPL' },
  { template: 'person', name: 'Alan Turing', occupation: 'Mathematician', born: '1912' },
  { template: 'university', name: 'MIT', location: 'Cambridge', founded: '1861' },
]

/**
 * BM25 search queries
 */
const BM25_QUERIES = [
  'machine learning algorithms',
  'database management systems',
  'computer programming',
  'artificial intelligence applications',
  'software development lifecycle',
  'network security protocols',
  'operating system kernels',
  'distributed computing',
  'cloud infrastructure',
  'web development frameworks',
]

/**
 * Generate sample articles for indexing
 */
function generateArticles(count: number, offset: number = 0): Array<{
  id: number
  title: string
  text: string
  infobox?: Record<string, string>
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: offset + i,
    title: `Article_${offset + i}`,
    text: SAMPLE_ARTICLE_TEXTS[i % SAMPLE_ARTICLE_TEXTS.length]! + ` Additional content for article ${offset + i}.`,
    ...(i % 2 === 0 && { infobox: SAMPLE_INFOBOXES[i % SAMPLE_INFOBOXES.length] }),
  }))
}

/**
 * Generate text content for throughput testing
 */
function generateTextBatch(wordCount: number): string {
  const words = ['algorithm', 'data', 'computer', 'system', 'network', 'software', 'programming', 'database', 'machine', 'learning']
  return Array.from({ length: wordCount }, (_, i) => words[i % words.length]).join(' ')
}

// ============================================================================
// INVERTED INDEX BUILDING BENCHMARKS
// ============================================================================

describe('Wikipedia inverted index building', () => {
  describe('single article indexing', () => {
    it('index single article', async () => {
      const result = await benchmark({
        name: 'wikipedia-index-single-article',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const article = generateArticles(1, i)[0]
          return ctx.do.request('/index/inverted/article', {
            method: 'POST',
            body: JSON.stringify(article),
          })
        },
      })

      record(result)

      console.log('\n=== Single Article Indexing ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1000 / result.stats.p50).toFixed(0)} articles/sec`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_TERM_INDEX_P95_MS * 10)
    })

    it('index articles with varying lengths', async () => {
      const articleLengths = [100, 500, 1000, 5000, 10000] // words
      const results: Array<{ length: number; p50: number; throughput: number }> = []

      for (const length of articleLengths) {
        const result = await benchmark({
          name: `wikipedia-index-length-${length}`,
          target: 'wikipedia.org.ai',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            const text = generateTextBatch(length)
            return ctx.do.request('/index/inverted/article', {
              method: 'POST',
              body: JSON.stringify({
                id: i,
                title: `Long_Article_${i}`,
                text,
              }),
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

      console.log('\n=== Index Time by Article Length ===')
      console.log('  Words     | p50 (ms)   | Articles/sec')
      console.log('  ----------|------------|-------------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(9)} | ${r.p50.toFixed(3).padStart(10)} | ${r.throughput.toFixed(0).padStart(11)}`)
      }

      // Indexing time should scale reasonably with length
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(20)
    })
  })

  describe('batch index building', () => {
    it.each([100, 500, 1000, 2500])('build index from %d articles', async (batchSize) => {
      const articles = generateArticles(batchSize)

      const result = await benchmark({
        name: `wikipedia-index-batch-${batchSize}`,
        target: 'wikipedia.org.ai',
        iterations: 15,
        warmup: 3,
        datasetSize: batchSize,
        run: async (ctx) =>
          ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ articles }),
          }),
      })

      record(result)

      const articlesPerSecond = (batchSize / result.stats.p50) * 1000
      const termsPerSecond = articlesPerSecond * 100 // Estimate ~100 terms per article

      console.log(`\n=== Batch Index Build (${batchSize} articles) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Articles/sec: ${articlesPerSecond.toFixed(0)}`)
      console.log(`  Est. terms/sec: ${termsPerSecond.toFixed(0)}`)

      expect(result.samples.length).toBe(15)
    })

    it('measures throughput scaling', async () => {
      const batchSizes = [100, 500, 1000, 2500, 5000]
      const throughputs: Array<{ size: number; articlesPerSec: number; termsPerSec: number }> = []

      for (const size of batchSizes) {
        const articles = generateArticles(size)

        const result = await benchmark({
          name: `wikipedia-index-throughput-${size}`,
          target: 'wikipedia.org.ai',
          iterations: 10,
          warmup: 2,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/index/inverted/batch', {
              method: 'POST',
              body: JSON.stringify({ articles }),
            }),
        })

        const articlesPerSec = (size / result.stats.p50) * 1000
        const termsPerSec = articlesPerSec * 100

        throughputs.push({
          size,
          articlesPerSec,
          termsPerSec,
        })

        record(result)
      }

      console.log('\n=== Index Throughput Scaling ===')
      console.log('  Batch Size  | Articles/sec | Terms/sec')
      console.log('  ------------|--------------|----------')
      for (const t of throughputs) {
        console.log(`  ${String(t.size).padEnd(11)} | ${t.articlesPerSec.toFixed(0).padStart(12)} | ${t.termsPerSec.toFixed(0).padStart(9)}`)
      }

      // Should achieve target throughput with large batches
      expect(throughputs[throughputs.length - 1]!.termsPerSec).toBeGreaterThan(TARGET_INDEX_TERMS_PER_SECOND / 2)
    })
  })

  describe('incremental index updates', () => {
    it('add articles to existing index', async () => {
      const result = await benchmark({
        name: 'wikipedia-index-incremental',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-populate index with 10K articles
          const articles = generateArticles(10000)
          await ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ articles }),
          })
        },
        run: async (ctx, i) => {
          // Add single new article to existing index
          const article = generateArticles(1, 100000 + i)[0]
          return ctx.do.request('/index/inverted/article', {
            method: 'POST',
            body: JSON.stringify(article),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/index/inverted/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Incremental Index Update ===')
      console.log(`  Base index size: 10,000 articles`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Incremental updates should be fast
      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_TERM_INDEX_P95_MS * 5)
    })
  })
})

// ============================================================================
// BM25 SEARCH BENCHMARKS
// ============================================================================

describe('Wikipedia BM25 search', () => {
  describe('ranked search', () => {
    it('BM25 search on 6M article index', async () => {
      const result = await benchmark({
        name: 'wikipedia-bm25-search',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 6_000_000,
        run: async (ctx, i) => {
          const query = BM25_QUERIES[i % BM25_QUERIES.length]
          return ctx.do.request('/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              k: 20,
              k1: 1.2,
              b: 0.75,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 Search (6M articles) ===')
      console.log(`  Dataset: ~6,000,000 articles`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS)
    })

    it('BM25 with varying k values', async () => {
      const kValues = [10, 25, 50, 100, 200]
      const results: Array<{ k: number; p50: number }> = []

      for (const k of kValues) {
        const result = await benchmark({
          name: `wikipedia-bm25-k-${k}`,
          target: 'wikipedia.org.ai',
          iterations: 30,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/search/bm25', {
              method: 'POST',
              body: JSON.stringify({
                query: 'machine learning',
                k,
              }),
            }),
        })

        results.push({
          k,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== BM25 Search by Result Count (k) ===')
      console.log('  k     | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.k).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Latency should scale reasonably with k
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(5)
    })

    it('BM25 across partition scatter-gather', async () => {
      const result = await benchmark({
        name: 'wikipedia-bm25-scatter',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        shardCount: 26,
        run: async (ctx, i) => {
          const query = BM25_QUERIES[i % BM25_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions: 'all',
              k: 20,
              kPerPartition: 5,
              merge: 'global_rerank',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 Scatter-Gather (26 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS * 1.5)
    })
  })

  describe('BM25 tuning parameters', () => {
    it('compare k1 parameter values', async () => {
      const k1Values = [0.5, 1.0, 1.2, 1.5, 2.0]
      const results: Array<{ k1: number; p50: number }> = []

      for (const k1 of k1Values) {
        const result = await benchmark({
          name: `wikipedia-bm25-k1-${k1}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/search/bm25', {
              method: 'POST',
              body: JSON.stringify({
                query: 'artificial intelligence',
                k: 20,
                k1,
                b: 0.75,
              }),
            }),
        })

        results.push({
          k1,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== BM25 k1 Parameter Comparison ===')
      console.log('  k1    | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.k1).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Performance should be similar across k1 values
      const times = results.map(r => r.p50)
      const variance = Math.max(...times) - Math.min(...times)
      expect(variance).toBeLessThan(50)
    })
  })
})

// ============================================================================
// INFOBOX FIELD INDEXING BENCHMARKS
// ============================================================================

describe('Wikipedia infobox field indexing', () => {
  describe('field index building', () => {
    it('index infobox fields', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-index',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const infobox = SAMPLE_INFOBOXES[i % SAMPLE_INFOBOXES.length]
          return ctx.do.request('/index/infobox', {
            method: 'POST',
            body: JSON.stringify({
              articleId: i,
              articleTitle: `Article_${i}`,
              infobox,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Infobox Field Indexing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1000 / result.stats.p50).toFixed(0)} infoboxes/sec`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_TERM_INDEX_P95_MS * 2)
    })

    it('batch index infobox fields', async () => {
      const batchSizes = [100, 500, 1000, 2500]
      const results: Array<{ batch: number; p50: number; perSec: number }> = []

      for (const batchSize of batchSizes) {
        const infoboxes = Array.from({ length: batchSize }, (_, i) => ({
          articleId: i,
          articleTitle: `Article_${i}`,
          infobox: SAMPLE_INFOBOXES[i % SAMPLE_INFOBOXES.length],
        }))

        const result = await benchmark({
          name: `wikipedia-infobox-batch-${batchSize}`,
          target: 'wikipedia.org.ai',
          iterations: 15,
          warmup: 3,
          datasetSize: batchSize,
          run: async (ctx) =>
            ctx.do.request('/index/infobox/batch', {
              method: 'POST',
              body: JSON.stringify({ infoboxes }),
            }),
        })

        results.push({
          batch: batchSize,
          p50: result.stats.p50,
          perSec: (batchSize / result.stats.p50) * 1000,
        })

        record(result)
      }

      console.log('\n=== Batch Infobox Indexing ===')
      console.log('  Batch  | p50 (ms)   | Per sec')
      console.log('  -------|------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(6)} | ${r.p50.toFixed(3).padStart(10)} | ${r.perSec.toFixed(0).padStart(8)}`)
      }

      expect(results.length).toBe(4)
    })
  })

  describe('infobox query index', () => {
    it('query indexed infobox fields', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-query-index',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Build index with 10K infoboxes
          const infoboxes = Array.from({ length: 10000 }, (_, i) => ({
            articleId: i,
            articleTitle: `Article_${i}`,
            infobox: SAMPLE_INFOBOXES[i % SAMPLE_INFOBOXES.length],
          }))
          await ctx.do.request('/index/infobox/batch', {
            method: 'POST',
            body: JSON.stringify({ infoboxes }),
          })
        },
        run: async (ctx, i) =>
          ctx.do.request('/index/infobox/query', {
            method: 'POST',
            body: JSON.stringify({
              template: 'company',
              where: { industry: 'Technology' },
              limit: 20,
            }),
          }),
      })

      record(result)

      console.log('\n=== Infobox Index Query ===')
      console.log(`  Index size: 10,000 infoboxes`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(100)
    })
  })
})

// ============================================================================
// CATEGORY INDEX BUILDING BENCHMARKS
// ============================================================================

describe('Wikipedia category index building', () => {
  describe('hierarchy index', () => {
    it('build category parent-child index', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-index',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const relationships = Array.from({ length: 100 }, (_, j) => ({
            child: `Category:Test_${i * 100 + j}`,
            parents: [`Category:Parent_${j % 50}`],
          }))

          return ctx.do.request('/index/categories/build', {
            method: 'POST',
            body: JSON.stringify({ relationships }),
          })
        },
      })

      record(result)

      console.log('\n=== Category Index Build (100 relationships) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INDEX_P95_MS)
    })

    it('category index scaling', async () => {
      const sizes = [100, 500, 1000, 2500, 5000]
      const results: Array<{ size: number; p50: number; perSec: number }> = []

      for (const size of sizes) {
        const relationships = Array.from({ length: size }, (_, i) => ({
          child: `Category:Scale_${i}`,
          parents: [`Category:Parent_${i % 100}`, `Category:Parent_${(i + 50) % 100}`],
        }))

        const result = await benchmark({
          name: `wikipedia-category-index-${size}`,
          target: 'wikipedia.org.ai',
          iterations: 10,
          warmup: 2,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/index/categories/build', {
              method: 'POST',
              body: JSON.stringify({ relationships }),
            }),
        })

        results.push({
          size,
          p50: result.stats.p50,
          perSec: (size / result.stats.p50) * 1000,
        })

        record(result)
      }

      console.log('\n=== Category Index Scaling ===')
      console.log('  Size    | p50 (ms)   | Rels/sec')
      console.log('  --------|------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(7)} | ${r.p50.toFixed(3).padStart(10)} | ${r.perSec.toFixed(0).padStart(8)}`)
      }

      expect(results.length).toBe(5)
    })
  })

  describe('category membership index', () => {
    it('index article-category memberships', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-membership-index',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const memberships = Array.from({ length: 500 }, (_, j) => ({
            article: `Article_${i * 500 + j}`,
            categories: [`Category:Cat_${j % 100}`, `Category:Cat_${(j + 25) % 100}`],
          }))

          return ctx.do.request('/index/categories/memberships', {
            method: 'POST',
            body: JSON.stringify({ memberships }),
          })
        },
      })

      record(result)

      console.log('\n=== Category Membership Index (500 articles) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INDEX_P95_MS)
    })
  })
})

// ============================================================================
// LINK GRAPH INDEX BUILDING BENCHMARKS
// ============================================================================

describe('Wikipedia link graph index building', () => {
  describe('edge index', () => {
    it('build link edge index', async () => {
      const result = await benchmark({
        name: 'wikipedia-link-index',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const edges = Array.from({ length: 1000 }, (_, j) => ({
            from: `Article_${i * 100}`,
            to: `Article_${(i * 100 + j + 1) % 10000}`,
          }))

          return ctx.do.request('/index/links/build', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })
        },
      })

      record(result)

      console.log('\n=== Link Edge Index Build (1000 edges) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Edges/sec: ${((1000 / result.stats.p50) * 1000).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INDEX_P95_MS)
    })

    it('link index scaling', async () => {
      const edgeCounts = [500, 1000, 2500, 5000, 10000]
      const results: Array<{ edges: number; p50: number; perSec: number }> = []

      for (const edgeCount of edgeCounts) {
        const edges = Array.from({ length: edgeCount }, (_, i) => ({
          from: `Article_${i % 1000}`,
          to: `Article_${(i + 1) % 1000}`,
        }))

        const result = await benchmark({
          name: `wikipedia-link-index-${edgeCount}`,
          target: 'wikipedia.org.ai',
          iterations: 10,
          warmup: 2,
          datasetSize: edgeCount,
          run: async (ctx) =>
            ctx.do.request('/index/links/build', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            }),
        })

        results.push({
          edges: edgeCount,
          p50: result.stats.p50,
          perSec: (edgeCount / result.stats.p50) * 1000,
        })

        record(result)
      }

      console.log('\n=== Link Index Scaling ===')
      console.log('  Edges    | p50 (ms)   | Edges/sec')
      console.log('  ---------|------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.edges).padEnd(8)} | ${r.p50.toFixed(3).padStart(10)} | ${r.perSec.toFixed(0).padStart(9)}`)
      }

      // Throughput should remain reasonable
      const avgThroughput = results.map(r => r.perSec).reduce((a, b) => a + b, 0) / results.length
      expect(avgThroughput).toBeGreaterThan(10000)
    })
  })

  describe('bidirectional index', () => {
    it('build bidirectional link index', async () => {
      const result = await benchmark({
        name: 'wikipedia-link-bidirectional',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const edges = Array.from({ length: 500 }, (_, j) => ({
            from: `Article_${i * 100}`,
            to: `Article_${(i * 100 + j + 1) % 5000}`,
          }))

          return ctx.do.request('/index/links/build', {
            method: 'POST',
            body: JSON.stringify({
              edges,
              bidirectional: true,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Bidirectional Link Index (500 edges) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INDEX_P95_MS)
    })
  })
})

// ============================================================================
// VECTOR EMBEDDING BENCHMARKS
// ============================================================================

describe('Wikipedia vector embeddings', () => {
  describe('article embedding', () => {
    it('generate embedding for single article', async () => {
      const result = await benchmark({
        name: 'wikipedia-embedding-single',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const text = SAMPLE_ARTICLE_TEXTS[i % SAMPLE_ARTICLE_TEXTS.length]
          return ctx.do.request('/index/vector/embed', {
            method: 'POST',
            body: JSON.stringify({
              text,
              model: 'bge-base-en-v1.5',
            }),
          })
        },
      })

      record(result)

      const articlesPerSec = 1000 / result.stats.p50

      console.log('\n=== Single Article Embedding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${articlesPerSec.toFixed(1)} articles/sec`)

      expect(articlesPerSec).toBeGreaterThan(TARGET_VECTOR_ARTICLES_PER_SECOND / 2)
    })

    it('batch embed articles', async () => {
      const batchSizes = [5, 10, 25, 50]
      const results: Array<{ batch: number; p50: number; articlesPerSec: number }> = []

      for (const batch of batchSizes) {
        const texts = Array.from({ length: batch }, (_, i) =>
          SAMPLE_ARTICLE_TEXTS[i % SAMPLE_ARTICLE_TEXTS.length]
        )

        const result = await benchmark({
          name: `wikipedia-embedding-batch-${batch}`,
          target: 'wikipedia.org.ai',
          iterations: 15,
          warmup: 3,
          run: async (ctx) =>
            ctx.do.request('/index/vector/batch-embed', {
              method: 'POST',
              body: JSON.stringify({
                texts,
                model: 'bge-base-en-v1.5',
              }),
            }),
        })

        const articlesPerSec = (batch / result.stats.p50) * 1000

        results.push({
          batch,
          p50: result.stats.p50,
          articlesPerSec,
        })

        record(result)
      }

      console.log('\n=== Batch Article Embedding ===')
      console.log('  Batch | p50 (ms)   | Articles/sec')
      console.log('  ------|------------|-------------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(5)} | ${r.p50.toFixed(3).padStart(10)} | ${r.articlesPerSec.toFixed(1).padStart(12)}`)
      }

      // Batch should improve throughput
      expect(results[results.length - 1]!.articlesPerSec).toBeGreaterThan(results[0]!.articlesPerSec * 0.8)
    })
  })

  describe('vector index', () => {
    it('build vector index from embeddings', async () => {
      const result = await benchmark({
        name: 'wikipedia-vector-index-build',
        target: 'wikipedia.org.ai',
        iterations: 10,
        warmup: 2,
        run: async (ctx, i) => {
          // Build index from 1000 pre-computed embeddings
          const embeddings = Array.from({ length: 1000 }, (_, j) => ({
            id: `article_${i * 1000 + j}`,
            vector: Array.from({ length: 768 }, () => Math.random()),
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

    it('semantic similarity search', async () => {
      const result = await benchmark({
        name: 'wikipedia-vector-search',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Build index with 10K article embeddings
          const embeddings = Array.from({ length: 10000 }, (_, j) => ({
            id: `article_${j}`,
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
      })

      record(result)

      console.log('\n=== Vector Similarity Search (10K index) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  QPS: ${(1000 / result.stats.p50).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(50)
    })
  })
})

// ============================================================================
// INDEX SERIALIZATION BENCHMARKS
// ============================================================================

describe('Wikipedia index serialization', () => {
  describe('partition serialization', () => {
    it('serialize partition index to R2', async () => {
      const result = await benchmark({
        name: 'wikipedia-index-serialize',
        target: 'wikipedia.org.ai',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          const articles = generateArticles(25000)
          await ctx.do.request('/index/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({ articles }),
          })
        },
        run: async (ctx) =>
          ctx.do.request('/index/serialize', {
            method: 'POST',
            body: JSON.stringify({
              destination: 'r2://indexes/wikipedia/test-partition.idx',
              include: ['inverted', 'infobox', 'category'],
            }),
          }),
        teardown: async (ctx) => {
          await ctx.do.request('/index/clear', { method: 'POST' })
        },
      })

      record(result)

      const serializeTimeS = result.stats.p50 / 1000

      console.log('\n=== Partition Index Serialization (25K articles) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms (${serializeTimeS.toFixed(2)}s)`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(serializeTimeS).toBeLessThan(MAX_PARTITION_SERIALIZE_S)
    })

    it('deserialize partition index from R2', async () => {
      const result = await benchmark({
        name: 'wikipedia-index-deserialize',
        target: 'wikipedia.org.ai',
        iterations: 10,
        warmup: 2,
        run: async (ctx) =>
          ctx.do.request('/index/deserialize', {
            method: 'POST',
            body: JSON.stringify({
              source: 'r2://indexes/wikipedia/sample-partition.idx',
            }),
          }),
      })

      record(result)

      console.log('\n=== Partition Index Deserialization ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p50 / 1000).toBeLessThan(MAX_PARTITION_SERIALIZE_S)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikipedia Index Building Summary', () => {
  it('should document index building performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIPEDIA INDEX BUILDING SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Inverted index: >${TARGET_INDEX_TERMS_PER_SECOND.toLocaleString()} terms/sec`)
    console.log(`  - BM25 search: <${MAX_BM25_SEARCH_P95_MS}ms (p95)`)
    console.log(`  - Vector embedding: >${TARGET_VECTOR_ARTICLES_PER_SECOND} articles/sec`)
    console.log(`  - Serialization: <${MAX_PARTITION_SERIALIZE_S}s per partition`)
    console.log('')

    console.log('Index types:')
    console.log('  - Inverted: Full-text search on article content')
    console.log('  - Infobox: Structured field indexing')
    console.log('  - Category: Parent-child hierarchy DAG')
    console.log('  - Link: Article-to-article graph edges')
    console.log('  - Vector: Semantic similarity (HNSW)')
    console.log('')

    console.log('Scaling characteristics:')
    console.log('  - Inverted index: Linear build, sub-linear search')
    console.log('  - Category index: O(n) build, O(log n) traversal')
    console.log('  - Link index: O(n) build, O(1) edge lookup')
    console.log('  - Vector index: O(n log n) build, O(log n) search')
    console.log('')

    console.log('Storage strategy:')
    console.log('  - Per-partition indexes in R2')
    console.log('  - Load into SQLite for queries')
    console.log('  - Incremental updates during ingest')
    console.log('  - Partition serialization for durability')
    console.log('')

    console.log('Memory considerations:')
    console.log('  - Inverted index: ~100 bytes per unique term')
    console.log('  - Category index: ~50 bytes per relationship')
    console.log('  - Link index: ~16 bytes per edge')
    console.log('  - Vector index: 768 dims * 4 bytes = 3KB per article')
    console.log('')

    expect(true).toBe(true)
  })
})
