/**
 * InvertedIndex Primitive Benchmarks
 *
 * Performance benchmarks for the InvertedIndex Durable Object primitive:
 * - Document indexing
 * - BM25 search
 * - Boolean queries (AND, OR)
 * - Phrase queries
 * - Faceted search
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | index document | <10ms |
 * | BM25 search | <30ms |
 * | boolean query (AND) | <20ms |
 * | phrase query | <25ms |
 *
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

/** Sample document corpus topics for benchmarks */
const TOPICS = ['technology', 'science', 'business', 'health', 'sports', 'politics', 'entertainment', 'education']

/** Generate a random document with realistic content */
function generateDocument(index: number): { id: string; content: string; fields: Record<string, string> } {
  const topic = TOPICS[index % TOPICS.length]
  const adjectives = ['innovative', 'groundbreaking', 'revolutionary', 'traditional', 'modern', 'advanced', 'emerging', 'sustainable']
  const nouns = ['solutions', 'approaches', 'methods', 'strategies', 'techniques', 'systems', 'platforms', 'applications']
  const verbs = ['transforms', 'enhances', 'improves', 'disrupts', 'revolutionizes', 'enables', 'accelerates', 'optimizes']

  const adj1 = adjectives[index % adjectives.length]
  const adj2 = adjectives[(index + 3) % adjectives.length]
  const noun1 = nouns[index % nouns.length]
  const noun2 = nouns[(index + 4) % nouns.length]
  const verb = verbs[index % verbs.length]

  const content = `
    This document discusses ${topic} with ${adj1} ${noun1} and ${adj2} ${noun2}.
    The ${topic} industry continues to evolve with new ${noun1} that ${verb} the field.
    Experts recommend ${adj1} ${noun2} for better results in ${topic}.
    Recent developments show that ${adj2} ${noun1} are becoming essential.
    The future of ${topic} lies in combining ${noun1} with ${noun2}.
    Industry leaders are adopting ${adj1} approaches to stay competitive.
  `.trim()

  return {
    id: `doc-${index}`,
    content,
    fields: {
      topic,
      category: topic,
      author: `author-${index % 20}`,
      date: new Date(Date.now() - (index * 86400000)).toISOString().split('T')[0]!,
    },
  }
}

describe('InvertedIndex benchmarks', () => {
  describe('indexing operations', () => {
    it('index document', async () => {
      const result = await benchmark({
        name: 'inverted-index-document',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        setup: async (ctx) => {
          await ctx.do.request('/inverted/clear', { method: 'POST' })
        },
        run: async (ctx, iteration) => {
          const doc = generateDocument(iteration)
          return ctx.do.request('/inverted/index', {
            method: 'POST',
            body: JSON.stringify(doc),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/inverted/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Document Indexing Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  Throughput: ${(1000 / result.stats.mean).toFixed(0)} docs/sec`)

      expect(result.stats.p95).toBeLessThan(10) // <10ms target
    })

    it('batch index documents (100)', async () => {
      const result = await benchmark({
        name: 'inverted-batch-index-100',
        target: 'inverted.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          const documents = []
          for (let i = 0; i < 100; i++) {
            documents.push(generateDocument(iteration * 100 + i))
          }

          return ctx.do.request('/inverted/batch-index', {
            method: 'POST',
            body: JSON.stringify({ documents }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Batch Index (100 docs) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  Throughput: ${(100 / result.stats.mean * 1000).toFixed(0)} docs/sec`)

      expect(result.stats.p95).toBeLessThan(50) // <50ms for 100 docs
    })
  })

  describe('BM25 search', () => {
    it('BM25 search', async () => {
      const queries = [
        'technology solutions',
        'innovative methods',
        'business strategies',
        'health systems',
        'science approaches',
        'modern platforms',
        'emerging techniques',
        'sustainable applications',
      ]

      const result = await benchmark({
        name: 'inverted-bm25-search',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        datasetSize: 10000,
        setup: async (ctx) => {
          // Pre-populate with 10K documents
          const stats = await ctx.do.request<{ documentCount: number }>('/inverted/stats')
          if (stats.documentCount < 10000) {
            await ctx.do.request('/inverted/clear', { method: 'POST' })

            // Index in batches
            for (let batch = 0; batch < 100; batch++) {
              const documents = []
              for (let i = 0; i < 100; i++) {
                documents.push(generateDocument(batch * 100 + i))
              }
              await ctx.do.request('/inverted/batch-index', {
                method: 'POST',
                body: JSON.stringify({ documents }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const query = queries[iteration % queries.length]
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              algorithm: 'bm25',
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex BM25 Search (10K docs) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms target
    })

    it('BM25 search with pagination', async () => {
      const result = await benchmark({
        name: 'inverted-bm25-paginated',
        target: 'inverted.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'technology solutions approaches',
              algorithm: 'bm25',
              limit: 20,
              offset: (iteration % 10) * 20, // Paginate through results
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex BM25 Paginated Search Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(35) // <35ms with pagination
    })
  })

  describe('boolean queries', () => {
    it('boolean query (AND)', async () => {
      const termPairs = [
        ['technology', 'solutions'],
        ['innovative', 'methods'],
        ['business', 'strategies'],
        ['health', 'systems'],
        ['science', 'approaches'],
        ['modern', 'platforms'],
      ]

      const result = await benchmark({
        name: 'inverted-boolean-and',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const terms = termPairs[iteration % termPairs.length]
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: {
                and: terms,
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Boolean AND Query Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target
    })

    it('boolean query (OR)', async () => {
      const termSets = [
        ['technology', 'science', 'business'],
        ['innovative', 'modern', 'advanced'],
        ['solutions', 'methods', 'approaches'],
        ['systems', 'platforms', 'applications'],
      ]

      const result = await benchmark({
        name: 'inverted-boolean-or',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const terms = termSets[iteration % termSets.length]
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: {
                or: terms,
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Boolean OR Query Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(25) // <25ms
    })

    it('boolean query (NOT)', async () => {
      const result = await benchmark({
        name: 'inverted-boolean-not',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const includeTerm = TOPICS[iteration % TOPICS.length]
          const excludeTerm = TOPICS[(iteration + 1) % TOPICS.length]

          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: {
                and: [includeTerm],
                not: [excludeTerm],
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Boolean NOT Query Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(25) // <25ms
    })
  })

  describe('phrase queries', () => {
    it('phrase query', async () => {
      const phrases = [
        'innovative solutions',
        'technology industry',
        'better results',
        'new methods',
        'experts recommend',
        'future of technology',
        'industry leaders',
        'emerging techniques',
      ]

      const result = await benchmark({
        name: 'inverted-phrase-query',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const phrase = phrases[iteration % phrases.length]
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: {
                phrase,
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Phrase Query Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(25) // <25ms target
    })

    it('phrase query with slop', async () => {
      const result = await benchmark({
        name: 'inverted-phrase-slop',
        target: 'inverted.perf.do',
        iterations: 300,
        warmup: 20,
        run: async (ctx, iteration) => {
          const phrases = ['innovative methods', 'technology solutions', 'modern approaches']
          const phrase = phrases[iteration % phrases.length]

          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: {
                phrase,
                slop: 2, // Allow 2 words between phrase terms
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Phrase Query with Slop Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms with slop
    })
  })

  describe('faceted search', () => {
    it('search with field filter', async () => {
      const result = await benchmark({
        name: 'inverted-field-filter',
        target: 'inverted.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const topic = TOPICS[iteration % TOPICS.length]
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'solutions methods approaches',
              algorithm: 'bm25',
              filter: {
                field: 'topic',
                value: topic,
              },
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Search with Field Filter Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(35) // <35ms with filter
    })

    it('facet aggregation', async () => {
      const result = await benchmark({
        name: 'inverted-facet-aggregation',
        target: 'inverted.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx) => {
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'technology business science',
              algorithm: 'bm25',
              limit: 10,
              facets: ['topic', 'author'],
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Facet Aggregation Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(40) // <40ms with facets
    })
  })

  describe('highlighting', () => {
    it('search with highlighting', async () => {
      const result = await benchmark({
        name: 'inverted-highlighting',
        target: 'inverted.perf.do',
        iterations: 300,
        warmup: 20,
        run: async (ctx, iteration) => {
          const queries = ['technology solutions', 'innovative methods', 'business strategies']
          return ctx.do.request('/inverted/search', {
            method: 'POST',
            body: JSON.stringify({
              query: queries[iteration % queries.length],
              algorithm: 'bm25',
              limit: 10,
              highlight: {
                fields: ['content'],
                preTag: '<em>',
                postTag: '</em>',
                fragmentSize: 150,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- InvertedIndex Search with Highlighting Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(40) // <40ms with highlighting
    })
  })

  describe('summary', () => {
    it('should report inverted index benchmark targets', () => {
      console.log('\n========================================')
      console.log('INVERTED INDEX BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | index document | <10ms |')
      console.log('  | batch index (100) | <50ms |')
      console.log('  | BM25 search | <30ms |')
      console.log('  | boolean AND | <20ms |')
      console.log('  | boolean OR | <25ms |')
      console.log('  | phrase query | <25ms |')
      console.log('  | field filter | <35ms |')
      console.log('  | facet aggregation | <40ms |')
      console.log('  | highlighting | <40ms |')
      console.log('')

      console.log('BM25 Algorithm Parameters:')
      console.log('  - k1 (term frequency saturation): 1.2')
      console.log('  - b (length normalization): 0.75')
      console.log('  - IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)')
      console.log('')

      console.log('Index Operations Complexity:')
      console.log('  - Index document: O(t) where t = unique terms')
      console.log('  - BM25 search: O(q * d) where q = query terms, d = matching docs')
      console.log('  - Boolean AND: O(min(d1, d2, ...)) intersection')
      console.log('  - Boolean OR: O(d1 + d2 + ...) union')
      console.log('  - Phrase query: O(d * p) where p = phrase length')
      console.log('')

      console.log('Supported Features:')
      console.log('  - Full-text search with BM25 ranking')
      console.log('  - Boolean queries (AND, OR, NOT)')
      console.log('  - Phrase queries with optional slop')
      console.log('  - Field filtering')
      console.log('  - Facet aggregations')
      console.log('  - Search result highlighting')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
