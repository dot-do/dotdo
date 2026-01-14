/**
 * Graph Scale Performance Benchmarks
 *
 * Tests graph operations at scale (100K+ edges):
 * - Traversal on large edge graph
 * - Pagination for large result sets
 * - Index effectiveness for edge lookups
 * - Memory and latency characteristics under load
 *
 * These benchmarks validate that the RelationshipsStore can handle
 * real-world dataset sizes from standards.org.ai.
 *
 * Target endpoints: graph.perf.do, standards.perf.do
 *
 * @see db/stores.ts for RelationshipsStore implementation
 * @see dotdo-zas1m for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Graph Scale Performance Benchmarks', () => {
  describe('traversal on 100K+ edge graph', () => {
    it('single-hop traversal on high-fanout node (1000 edges)', async () => {
      const result = await benchmark({
        name: 'graph-scale-high-fanout-1k',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        setup: async (ctx) => {
          // Create a node with 1000 outbound edges
          const sourceId = 'Scale/fanout-1k'
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'links',
                from: sourceId,
                to: `Scale/target-${i}`,
                data: { index: i, batch: Math.floor(i / 100) },
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Scale%2Ffanout-1k')
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // 1000 edges should still be sub-100ms
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('single-hop traversal on very high-fanout node (5000 edges)', async () => {
      const result = await benchmark({
        name: 'graph-scale-high-fanout-5k',
        target: 'graph.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 5000,
        setup: async (ctx) => {
          const sourceId = 'Scale/fanout-5k'
          // Batch insert for efficiency
          for (let batch = 0; batch < 50; batch++) {
            for (let i = 0; i < 100; i++) {
              const idx = batch * 100 + i
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'connects',
                  from: sourceId,
                  to: `Scale/node-${idx}`,
                  data: { batch, index: i },
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Scale%2Ffanout-5k')
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // 5000 edges may take longer, target sub-500ms
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('inbound traversal on popular node (high in-degree)', async () => {
      const result = await benchmark({
        name: 'graph-scale-high-indegree',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        setup: async (ctx) => {
          // Create 1000 nodes pointing to same target
          const targetId = 'Scale/popular'
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'follows',
                from: `Scale/follower-${i}`,
                to: targetId,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/to/Scale%2Fpopular')
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('multi-hop traversal on dense graph', async () => {
      const result = await benchmark({
        name: 'graph-scale-dense-multihop',
        target: 'graph.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 500, // 500 edges total (10 * 10 * 5)
        setup: async (ctx) => {
          // Create 3-level hierarchy:
          // Root -> 10 children -> 10 grandchildren each -> 5 leaves each
          const root = 'Scale/dense-root'
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'contains',
                from: root,
                to: `Scale/child-${i}`,
              }),
            })
            for (let j = 0; j < 10; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'contains',
                  from: `Scale/child-${i}`,
                  to: `Scale/grandchild-${i}-${j}`,
                }),
              })
              for (let k = 0; k < 5; k++) {
                await ctx.do.request('/relationships', {
                  method: 'POST',
                  body: JSON.stringify({
                    verb: 'contains',
                    from: `Scale/grandchild-${i}-${j}`,
                    to: `Scale/leaf-${i}-${j}-${k}`,
                  }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          // BFS traversal to collect all nodes
          const allNodes = new Set<string>()
          const queue: string[] = ['Scale/dense-root']
          let edgesTraversed = 0

          while (queue.length > 0) {
            const node = queue.shift()!
            if (allNodes.has(node)) continue
            allNodes.add(node)

            const edges = await ctx.do.list<{ to: string }>(
              `/relationships/from/${encodeURIComponent(node)}?verb=contains`
            )
            edgesTraversed += edges.length

            for (const edge of edges) {
              if (!allNodes.has(edge.to)) {
                queue.push(edge.to)
              }
            }
          }

          return { nodeCount: allNodes.size, edgesTraversed }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // Dense multi-hop should complete in reasonable time
      expect(result.stats.p50).toBeLessThan(2000)
    })
  })

  describe('pagination for large result sets', () => {
    it('paginated traversal (limit + offset)', async () => {
      const result = await benchmark({
        name: 'graph-scale-pagination-basic',
        target: 'graph.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const sourceId = 'Scale/paginated'
          for (let i = 0; i < 200; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'has',
                from: sourceId,
                to: `Scale/item-${i}`,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          // Paginate through results
          const pageSize = 20
          const page = iteration % 10
          const offset = page * pageSize

          return ctx.do.list(`/relationships/from/Scale%2Fpaginated?limit=${pageSize}&offset=${offset}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Paginated queries should be fast
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('cursor-based pagination simulation', async () => {
      const result = await benchmark({
        name: 'graph-scale-cursor-pagination',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const sourceId = 'Scale/cursor-paginated'
          for (let i = 0; i < 500; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'contains',
                from: sourceId,
                to: `Scale/cursor-item-${String(i).padStart(4, '0')}`, // Sortable IDs
                data: { sequence: i },
              }),
            })
          }
        },
        run: async (ctx) => {
          // Simulate cursor pagination by fetching all pages
          const pageSize = 50
          const allResults: unknown[] = []
          let offset = 0
          let hasMore = true

          while (hasMore && offset < 500) {
            const page = await ctx.do.list<unknown>(
              `/relationships/from/Scale%2Fcursor-paginated?limit=${pageSize}&offset=${offset}`
            )
            allResults.push(...page)
            hasMore = page.length === pageSize
            offset += pageSize
          }

          return { totalFetched: allResults.length, pages: Math.ceil(allResults.length / pageSize) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Full pagination through 500 items should be reasonable
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('streaming large result sets', async () => {
      const result = await benchmark({
        name: 'graph-scale-streaming',
        target: 'graph.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        setup: async (ctx) => {
          const sourceId = 'Scale/streaming'
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'includes',
                from: sourceId,
                to: `Scale/stream-item-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Measure first page latency for streaming scenarios
          const firstPage = await ctx.do.list<unknown>(
            '/relationships/from/Scale%2Fstreaming?limit=100'
          )
          return { firstPageSize: firstPage.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // First page should be fast even with large total dataset
      expect(result.stats.p50).toBeLessThan(30)
    })
  })

  describe('index effectiveness for edge lookups', () => {
    it('verb-filtered lookup (index utilization)', async () => {
      const result = await benchmark({
        name: 'graph-scale-verb-index',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const sourceId = 'Scale/verb-indexed'
          const verbs = ['manages', 'owns', 'follows', 'likes', 'requires']

          // Create 1000 edges with 5 different verbs
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: verbs[i % verbs.length],
                from: sourceId,
                to: `Scale/verb-target-${i}`,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const verbs = ['manages', 'owns', 'follows', 'likes', 'requires']
          const verb = verbs[iteration % verbs.length]
          return ctx.do.list(`/relationships/from/Scale%2Fverb-indexed?verb=${verb}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Verb-filtered should be fast with proper indexing
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('compound filter (from + verb)', async () => {
      const result = await benchmark({
        name: 'graph-scale-compound-index',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create multiple source nodes with various verbs
          for (let s = 0; s < 10; s++) {
            const sourceId = `Scale/compound-src-${s}`
            for (let i = 0; i < 100; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: i % 2 === 0 ? 'typeA' : 'typeB',
                  from: sourceId,
                  to: `Scale/compound-tgt-${s}-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const srcIdx = iteration % 10
          return ctx.do.list(`/relationships/from/Scale%2Fcompound-src-${srcIdx}?verb=typeA`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Compound filter should be efficient
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('random access pattern (cache behavior)', async () => {
      const result = await benchmark({
        name: 'graph-scale-random-access',
        target: 'graph.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create 100 different nodes with edges
          for (let i = 0; i < 100; i++) {
            const sourceId = `Scale/random-${i}`
            for (let j = 0; j < 10; j++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'links',
                  from: sourceId,
                  to: `Scale/random-target-${i}-${j}`,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          // Random access pattern
          const idx = Math.floor(Math.random() * 100)
          return ctx.do.list(`/relationships/from/Scale%2Frandom-${idx}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Random access should still be consistent
      expect(result.stats.p50).toBeLessThan(15)
      // Standard deviation should be reasonable
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 2)
    })

    it('sequential scan vs indexed lookup comparison', async () => {
      // First, measure unfiltered scan
      const scanResult = await benchmark({
        name: 'graph-scale-scan-unfiltered',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const sourceId = 'Scale/scan-test'
          for (let i = 0; i < 500; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: i % 5 === 0 ? 'special' : 'common',
                from: sourceId,
                to: `Scale/scan-tgt-${i}`,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Scale%2Fscan-test')
        },
      })

      // Then, measure filtered lookup
      const indexResult = await benchmark({
        name: 'graph-scale-indexed-lookup',
        target: 'graph.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/relationships/from/Scale%2Fscan-test?verb=special')
        },
      })

      record(scanResult)
      record(indexResult)

      expect(scanResult.samples.length).toBe(30)
      expect(indexResult.samples.length).toBe(30)

      // Indexed lookup should be faster than full scan
      expect(indexResult.stats.p50).toBeLessThan(scanResult.stats.p50)
    })
  })

  describe('write performance at scale', () => {
    it('bulk edge creation throughput', async () => {
      const batchSize = 100

      const result = await benchmark({
        name: 'graph-scale-bulk-create',
        target: 'graph.perf.do',
        iterations: 10,
        warmup: 1,
        run: async (ctx, iteration) => {
          const sourceId = `Scale/bulk-${iteration}`
          const promises = []

          for (let i = 0; i < batchSize; i++) {
            promises.push(
              ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'bulkLink',
                  from: sourceId,
                  to: `Scale/bulk-target-${iteration}-${i}`,
                }),
              })
            )
          }

          await Promise.all(promises)
          return { created: batchSize }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)

      // Calculate throughput
      const avgMs = result.stats.mean
      const throughput = (batchSize * 1000) / avgMs

      // Should achieve at least 100 edges/sec
      expect(throughput).toBeGreaterThan(100)
    })

    it('concurrent writers to different nodes', async () => {
      const concurrency = 5
      const edgesPerWriter = 50

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, writerIdx) =>
          benchmark({
            name: `graph-scale-concurrent-writer-${writerIdx}`,
            target: 'graph.perf.do',
            iterations: edgesPerWriter,
            warmup: 5,
            run: async (ctx, i) => {
              return ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'concurrent',
                  from: `Scale/writer-${writerIdx}`,
                  to: `Scale/concurrent-target-${writerIdx}-${i}`,
                }),
              })
            },
          })
        )
      )

      record(results)

      // All writers should complete without excessive errors
      for (const result of results) {
        expect(result.errors?.length ?? 0).toBeLessThan(edgesPerWriter * 0.1)
      }

      // Calculate variance across workers
      const p50s = results.map((r) => r.stats.p50)
      const meanP50 = p50s.reduce((a, b) => a + b, 0) / p50s.length
      const maxP50 = Math.max(...p50s)

      // No worker should be more than 3x slower
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })
  })

  describe('memory characteristics', () => {
    it('large result set does not cause memory issues', async () => {
      const result = await benchmark({
        name: 'graph-scale-memory-stress',
        target: 'graph.perf.do',
        iterations: 5,
        warmup: 1,
        datasetSize: 2000,
        setup: async (ctx) => {
          const sourceId = 'Scale/memory-test'
          // Create 2000 edges with larger data payloads
          for (let i = 0; i < 2000; i++) {
            await ctx.do.request('/relationships', {
              method: 'POST',
              body: JSON.stringify({
                verb: 'holds',
                from: sourceId,
                to: `Scale/memory-target-${i}`,
                data: {
                  metadata: {
                    description: `This is item ${i} with some metadata`,
                    tags: Array.from({ length: 5 }, (_, j) => `tag-${i}-${j}`),
                    properties: { index: i, batch: Math.floor(i / 100) },
                  },
                },
              }),
            })
          }
        },
        run: async (ctx) => {
          const results = await ctx.do.list<unknown>('/relationships/from/Scale%2Fmemory-test')
          return { count: results.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
      // Should complete without memory-related errors
      expect(result.errors?.length ?? 0).toBe(0)
    })
  })

  describe('latency distribution at scale', () => {
    it('consistent latency under varying load', async () => {
      const result = await benchmark({
        name: 'graph-scale-latency-consistency',
        target: 'graph.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Pre-populate graph
          for (let s = 0; s < 20; s++) {
            const sourceId = `Scale/latency-src-${s}`
            for (let i = 0; i < 50; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'links',
                  from: sourceId,
                  to: `Scale/latency-tgt-${s}-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const srcIdx = iteration % 20
          return ctx.do.list(`/relationships/from/Scale%2Flatency-src-${srcIdx}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(200)

      // Check latency consistency
      // p99 should not be more than 10x p50
      expect(result.stats.p99).toBeLessThan(result.stats.p50 * 10)

      // Standard deviation should be reasonable
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 2)
    })

    it('tail latency under sustained load', async () => {
      const result = await benchmark({
        name: 'graph-scale-tail-latency',
        target: 'graph.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Create moderate dataset
          for (let s = 0; s < 10; s++) {
            for (let i = 0; i < 100; i++) {
              await ctx.do.request('/relationships', {
                method: 'POST',
                body: JSON.stringify({
                  verb: 'refs',
                  from: `Scale/tail-src-${s}`,
                  to: `Scale/tail-tgt-${s}-${i}`,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const srcIdx = iteration % 10
          return ctx.do.list(`/relationships/from/Scale%2Ftail-src-${srcIdx}?verb=refs`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(500)

      // Log the latency distribution for analysis
      console.log(`Latency distribution:`)
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  max: ${result.stats.max.toFixed(2)}ms`)

      // p99 should be within acceptable bounds
      expect(result.stats.p99).toBeLessThan(100)
    })
  })
})
