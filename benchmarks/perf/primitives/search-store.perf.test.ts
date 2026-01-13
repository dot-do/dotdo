/**
 * SearchStore Performance Benchmarks
 *
 * Tests full-text and semantic search operations:
 * - index thing: Add thing to search index
 * - full-text query: Text-based search
 * - semantic search: Vector similarity search (if implemented)
 *
 * Target: Simple operations should be sub-10ms, complex queries sub-50ms
 *
 * @see db/stores.ts for SearchStore implementation
 * @see dotdo-hn07m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('SearchStore benchmarks', () => {
  describe('index operations', () => {
    it('index thing', async () => {
      const result = await benchmark({
        name: 'search-index',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          return ctx.do.request('/search/index', {
            method: 'POST',
            body: JSON.stringify({
              $id: `doc-${i}`,
              $type: 'Document',
              content: `This is document ${i} about technology and innovation in the modern era.`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeGreaterThan(0)

      // Sub-10ms target for simple indexing
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('index with long content', async () => {
      const result = await benchmark({
        name: 'search-index-long',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          // Generate ~2KB of content
          const paragraphs = Array.from({ length: 5 }, (_, j) =>
            `Paragraph ${j + 1}: This is a detailed section about topic ${j + 1}. ` +
            `It contains important information about the subject matter including ` +
            `various technical details, implementation considerations, and best practices. ` +
            `The content is designed to test indexing performance with realistic document sizes.`
          )

          return ctx.do.request('/search/index', {
            method: 'POST',
            body: JSON.stringify({
              $id: `long-doc-${i}`,
              $type: 'Article',
              content: paragraphs.join('\n\n'),
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Longer content may be slower but still sub-30ms
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('index multiple types', async () => {
      const types = ['Document', 'Article', 'Product', 'User', 'Comment']

      for (const type of types) {
        const result = await benchmark({
          name: `search-index-${type.toLowerCase()}`,
          target: 'stores.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            return ctx.do.request('/search/index', {
              method: 'POST',
              body: JSON.stringify({
                $id: `${type.toLowerCase()}-${i}`,
                $type: type,
                content: `This is a ${type.toLowerCase()} entry number ${i} with searchable content.`,
              }),
            })
          },
        })

        record(result)

        expect(result.samples.length).toBe(20)
        // All types should have similar performance
        expect(result.stats.p50).toBeLessThan(15)
      }
    })

    it('re-index existing document', async () => {
      let docId: string

      const result = await benchmark({
        name: 'search-reindex',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          docId = 'reindex-target'
          // Initial index
          await ctx.do.request('/search/index', {
            method: 'POST',
            body: JSON.stringify({
              $id: docId,
              $type: 'Document',
              content: 'Initial content for reindexing test.',
            }),
          })
        },
        run: async (ctx, i) => {
          return ctx.do.request('/search/index', {
            method: 'POST',
            body: JSON.stringify({
              $id: docId,
              $type: 'Document',
              content: `Updated content version ${i + 1} for reindexing test.`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Re-indexing should be efficient
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('full-text query operations', () => {
    it('full-text query', async () => {
      const searchTerms = ['technology', 'innovation', 'startup', 'business', 'software']

      const result = await benchmark({
        name: 'search-query',
        target: 'stores.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Seed documents with various terms
          for (let i = 0; i < 100; i++) {
            const term = searchTerms[i % searchTerms.length]
            await ctx.do.request('/search/index', {
              method: 'POST',
              body: JSON.stringify({
                $id: `search-doc-${i}`,
                $type: 'Document',
                content: `Document ${i} about ${term} and related topics in the ${term} industry.`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          const term = searchTerms[i % searchTerms.length]
          return ctx.do.list(`/search?q=${encodeURIComponent(term)}&limit=10`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Full-text search should be sub-20ms
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('multi-word query', async () => {
      const result = await benchmark({
        name: 'search-query-multiword',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const queries = [
            'technology innovation',
            'business startup growth',
            'software development practices',
            'modern web applications',
            'cloud infrastructure services',
          ]
          return ctx.do.list(`/search?q=${encodeURIComponent(queries[i % queries.length])}&limit=10`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Multi-word should be slightly slower but still sub-30ms
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('query with type filter', async () => {
      const result = await benchmark({
        name: 'search-query-type-filter',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Seed documents of different types
          const types = ['Document', 'Article', 'Product']
          for (let i = 0; i < 60; i++) {
            await ctx.do.request('/search/index', {
              method: 'POST',
              body: JSON.stringify({
                $id: `typed-doc-${i}`,
                $type: types[i % types.length],
                content: `Searchable content for ${types[i % types.length]} number ${i}.`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          const types = ['Document', 'Article', 'Product']
          return ctx.do.list(
            `/search?q=searchable&type=${types[i % types.length]}&limit=10`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Type filter should be efficient
      expect(result.stats.p50).toBeLessThan(25)
    })

    it('query with varying limits', async () => {
      const limits = [5, 10, 20, 50]

      for (const limit of limits) {
        const result = await benchmark({
          name: `search-query-limit-${limit}`,
          target: 'stores.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx) => {
            return ctx.do.list(`/search?q=content&limit=${limit}`)
          },
        })

        record(result)

        expect(result.samples.length).toBe(30)
        // Larger limits may be slower, scale accordingly
        expect(result.stats.p50).toBeLessThan(10 + limit * 0.5)
      }
    })

    it('empty result query', async () => {
      const result = await benchmark({
        name: 'search-query-empty',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          // Query for terms that won't match
          return ctx.do.list(`/search?q=xyznonexistent${i}gibberish&limit=10`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Empty results should be very fast
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('semantic search operations', () => {
    it('semantic search (if implemented)', async () => {
      const result = await benchmark({
        name: 'search-semantic',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Seed documents for semantic search
          const topics = [
            'artificial intelligence and machine learning',
            'cloud computing infrastructure',
            'web development frameworks',
            'mobile application design',
            'database optimization techniques',
          ]
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/search/index', {
              method: 'POST',
              body: JSON.stringify({
                $id: `semantic-doc-${i}`,
                $type: 'Document',
                content: `${topics[i % topics.length]} - detailed discussion about ${topics[i % topics.length]}.`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Semantic queries use different phrasing than indexed content
          return ctx.do.list('/search/semantic?q=AI%20neural%20networks&limit=10')
        },
      })

      record(result)

      // Semantic search may be slower due to embedding computation
      // This is expected if using AI-based embeddings
      expect(result.samples.length).toBe(30)
      // Sub-100ms for semantic search (embedding + similarity)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('hybrid search (text + semantic)', async () => {
      const result = await benchmark({
        name: 'search-hybrid',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          return ctx.do.list('/search/hybrid?q=machine%20learning&limit=10')
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Hybrid may be slower than pure text search
      expect(result.stats.p50).toBeLessThan(150)
    })
  })

  describe('bulk indexing', () => {
    it('bulk index documents', async () => {
      const batchSize = 10

      const result = await benchmark({
        name: 'search-bulk-index',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          const documents = Array.from({ length: batchSize }, (_, j) => ({
            $id: `bulk-doc-${i * batchSize + j}`,
            $type: 'Document',
            content: `Bulk indexed document ${i * batchSize + j} with searchable content.`,
          }))

          return ctx.do.request('/search/index/batch', {
            method: 'POST',
            body: JSON.stringify(documents),
          })
        },
      })

      record(result)

      // Calculate indexing throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs

      // Should achieve at least 100 docs/sec for bulk indexing
      expect(throughput).toBeGreaterThan(100)
    })
  })

  describe('delete from index', () => {
    it('delete indexed document', async () => {
      let docIds: string[] = []

      const result = await benchmark({
        name: 'search-delete',
        target: 'stores.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Index documents to delete
          for (let i = 0; i < 100; i++) {
            const id = `delete-doc-${i}`
            await ctx.do.request('/search/index', {
              method: 'POST',
              body: JSON.stringify({
                $id: id,
                $type: 'Document',
                content: `Temporary document ${i} to be deleted.`,
              }),
            })
            docIds.push(id)
          }
        },
        run: async (ctx, i) => {
          if (i < docIds.length) {
            return ctx.do.delete(`/search/index/${docIds[i]}`)
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Delete should be sub-10ms
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('search at scale', () => {
    it('search in large index', async () => {
      const result = await benchmark({
        name: 'search-large-index',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 1000,
        setup: async (ctx) => {
          // Note: In real benchmarks, the index would already contain many documents
          // This setup is for demonstration; actual large-scale tests would use pre-seeded data
          console.log('Assuming pre-seeded index with 1000+ documents')
        },
        run: async (ctx) => {
          return ctx.do.list('/search?q=technology&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Large index queries may be slower
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('faceted search', async () => {
      const result = await benchmark({
        name: 'search-faceted',
        target: 'stores.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/search?q=content&type=Document&facets=true&limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Faceted search adds overhead
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('concurrency', () => {
    it('handles concurrent queries', async () => {
      const concurrency = 5
      const iterationsPerWorker = 15

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `search-concurrent-${workerIndex}`,
            target: 'stores.perf.do',
            iterations: iterationsPerWorker,
            warmup: 2,
            run: async (ctx, i) => {
              const terms = ['tech', 'business', 'software', 'cloud', 'data']
              return ctx.do.list(`/search?q=${terms[(workerIndex + i) % terms.length]}&limit=10`)
            },
          })
        )
      )

      record(results)

      // All workers should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(iterationsPerWorker * 0.1)
      }

      // Calculate overall latency variance
      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      // No worker should be more than 3x slower than average
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })

    it('handles concurrent indexing and querying', async () => {
      const indexer = benchmark({
        name: 'search-concurrent-indexer',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          return ctx.do.request('/search/index', {
            method: 'POST',
            body: JSON.stringify({
              $id: `concurrent-index-${i}`,
              $type: 'Document',
              content: `Concurrently indexed document ${i}.`,
            }),
          })
        },
      })

      const querier = benchmark({
        name: 'search-concurrent-querier',
        target: 'stores.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx) => {
          return ctx.do.list('/search?q=document&limit=10')
        },
      })

      const [indexResult, queryResult] = await Promise.all([indexer, querier])

      record([indexResult, queryResult])

      // Both operations should complete successfully
      expect(indexResult.errors?.length ?? 0).toBeLessThan(5)
      expect(queryResult.errors?.length ?? 0).toBeLessThan(5)
    })
  })
})
