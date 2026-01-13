/**
 * Web Crawl Scale Performance Benchmarks
 *
 * Tests web graph operations at extreme scale:
 * - Billion-node graph traversals
 * - 10B edge query patterns
 * - Per-TLD partition routing
 * - Cross-TLD scatter-gather
 * - Index effectiveness (hash vs range)
 * - Memory limits and streaming patterns
 * - Concurrent access under load
 *
 * Target namespace: web.org.ai, {tld}.web.org.ai
 * Scale: ~1B+ hostnames, ~10B+ link edges
 *
 * Performance targets:
 * - Domain lookup: <100ms p95
 * - Backlink query: <500ms p95
 * - Scatter-gather (100 TLDs): <1s p95
 *
 * @see dotdo-b2pk0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Web Crawl Scale Benchmarks', () => {
  describe('billion-node graph traversals', () => {
    it('high-fanout domain (10K+ outbound links)', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-high-fanout-10k',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 10000,
        setup: async (ctx) => {
          // Create a hub domain with 10K outbound links
          const hub = 'mega-hub.com'
          for (let batch = 0; batch < 100; batch++) {
            const edges = Array.from({ length: 100 }, (_, i) => ({
              from: hub,
              to: `target-${batch * 100 + i}.com`,
              weight: Math.floor(Math.random() * 100) + 1,
            }))

            await ctx.do.request('/edges/batch', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/from/mega-hub.com')
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // Large fanout should still complete within target
      expect(result.stats.p95).toBeLessThan(1000)
    })

    it('high-indegree domain (100K+ backlinks)', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-high-indegree-100k',
        target: 'web.perf.do',
        iterations: 5,
        warmup: 1,
        datasetSize: 100000,
        setup: async (ctx) => {
          // Create a popular domain with 100K inbound links
          const popular = 'super-popular.com'
          for (let batch = 0; batch < 1000; batch++) {
            const edges = Array.from({ length: 100 }, (_, i) => ({
              from: `linker-${batch * 100 + i}.com`,
              to: popular,
              weight: 1,
            }))

            await ctx.do.request('/edges/batch', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            })
          }
        },
        run: async (ctx) => {
          // Get backlink count (not full list)
          return ctx.do.get('/edges/to/super-popular.com/count')
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
      // Count query should be fast even with 100K backlinks
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('paginated traversal of high-degree node', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-paginated-high-degree',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const hub = 'paginated-hub.com'
          for (let i = 0; i < 5000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: hub,
                to: `paged-target-${String(i).padStart(5, '0')}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const pageSize = 100
          const page = iteration % 50
          return ctx.do.list(
            `/edges/from/paginated-hub.com?limit=${pageSize}&offset=${page * pageSize}`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // Paginated queries should be fast
      expect(result.stats.p50).toBeLessThan(50)
      expect(result.stats.p95).toBeLessThan(100)
    })

    it('deep traversal with pruning', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-deep-traversal-pruning',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create a deep graph with branching
          for (let depth = 0; depth < 5; depth++) {
            for (let node = 0; node < 10; node++) {
              for (let link = 0; link < 3; link++) {
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({
                    from: `deep-d${depth}-n${node}.com`,
                    to: `deep-d${depth + 1}-n${(node + link) % 10}.com`,
                    weight: 1,
                  }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          const maxDepth = 4
          const maxNodesPerLevel = 5 // Pruning
          let currentLevel = ['deep-d0-n0.com']
          const visited = new Set<string>(currentLevel)
          let totalNodes = 1

          for (let depth = 0; depth < maxDepth; depth++) {
            const nextLevel: string[] = []

            for (const node of currentLevel.slice(0, maxNodesPerLevel)) {
              const edges = await ctx.do.list<{ to: string }>(
                `/edges/from/${encodeURIComponent(node)}`
              )

              for (const edge of edges) {
                if (!visited.has(edge.to)) {
                  visited.add(edge.to)
                  nextLevel.push(edge.to)
                  totalNodes++
                }
              }
            }

            currentLevel = nextLevel
            if (currentLevel.length === 0) break
          }

          return { totalNodes, depth: maxDepth }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(2000)
    })
  })

  describe('10B edge query patterns', () => {
    it('random domain lookup', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-random-lookup',
        target: 'web.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Pre-populate with indexed domains
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `indexed-${i}.com`,
                to: `target-${i % 100}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          const domainIdx = Math.floor(Math.random() * 1000)
          return ctx.do.list(`/edges/from/indexed-${domainIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(500)
      // Target: <100ms p95
      expect(result.stats.p50).toBeLessThan(20)
      expect(result.stats.p95).toBeLessThan(100)

      // Check latency consistency
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 2)
    })

    it('bulk edge existence check', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-bulk-exists',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create some edges
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `exists-${i}.com`,
                to: `target-${i % 50}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          // Check existence of 100 edges (mix of existing and non-existing)
          const edges = Array.from({ length: 100 }, (_, i) => ({
            from: `${i % 2 === 0 ? 'exists' : 'nonexistent'}-${(iteration * 100 + i) % 1000}.com`,
            to: `target-${i % 50}.com`,
          }))

          return ctx.do.request('/edges/exists', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('range query by weight', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-range-weight',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const source = 'range-query-source.com'
          for (let i = 0; i < 500; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: source,
                to: `range-target-${i}.com`,
                weight: i, // Weights from 0 to 499
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const minWeight = (iteration % 5) * 100 // 0, 100, 200, 300, 400
          const maxWeight = minWeight + 99
          return ctx.do.list(
            `/edges/from/range-query-source.com?minWeight=${minWeight}&maxWeight=${maxWeight}`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('top-K edges by weight', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-topk-weight',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const source = 'topk-source.com'
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: source,
                to: `topk-target-${i}.com`,
                weight: Math.floor(Math.random() * 10000),
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/from/topk-source.com?sort=weight&order=desc&limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('TLD partition routing', () => {
    it('route query to correct TLD partition', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-tld-routing',
        target: 'web.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          const tlds = ['com', 'org', 'net', 'io', 'ai', 'co.uk', 'de', 'fr', 'jp', 'cn']
          const tld = tlds[iteration % tlds.length]
          return ctx.do.get(`/partition/${tld}/stats`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(20)
      expect(result.stats.p95).toBeLessThan(100)
    })

    it('query within single TLD partition', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-single-partition',
        target: 'com.web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // All .com domains
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `partition-source-${i}.com`,
                to: `partition-target-${i % 20}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const sourceIdx = iteration % 100
          return ctx.do.list(`/edges/from/partition-source-${sourceIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('cross-partition edge query', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-cross-partition',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Edges crossing TLD boundaries
          const pairs = [
            { from: 'source.com', to: 'target.org' },
            { from: 'source.org', to: 'target.net' },
            { from: 'source.net', to: 'target.io' },
            { from: 'source.io', to: 'target.ai' },
            { from: 'source.ai', to: 'target.com' },
          ]

          for (const pair of pairs) {
            for (let i = 0; i < 20; i++) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: pair.from.replace('.', `-${i}.`),
                  to: pair.to.replace('.', `-${i}.`),
                  weight: 1,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const idx = iteration % 20
          return ctx.do.list(`/edges/from/source-${idx}.com?crossPartition=true`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('scatter-gather queries', () => {
    it('scatter-gather across 10 TLDs', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-scatter-gather-10',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          const tlds = ['com', 'org', 'net', 'io', 'ai', 'co.uk', 'de', 'fr', 'jp', 'cn']

          // Scatter: query each TLD partition in parallel
          const scatterResults = await Promise.all(
            tlds.map(async (tld) => {
              const stats = await ctx.do.get<{ domainCount: number; edgeCount: number }>(
                `/partition/${tld}/stats`
              )
              return { tld, ...stats }
            })
          )

          // Gather: aggregate results
          const totalDomains = scatterResults.reduce((sum, r) => sum + (r.domainCount || 0), 0)
          const totalEdges = scatterResults.reduce((sum, r) => sum + (r.edgeCount || 0), 0)

          return { tldCount: tlds.length, totalDomains, totalEdges }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('scatter-gather across 100 TLDs', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-scatter-gather-100',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Simulate 100 TLD partitions
          const tlds = Array.from({ length: 100 }, (_, i) => `tld-${i}`)

          const scatterResults = await Promise.all(
            tlds.map(async (tld) => {
              const stats = await ctx.do.get<{ count: number }>(`/partition/${tld}/count`)
              return { tld, count: stats?.count || 0 }
            })
          )

          const total = scatterResults.reduce((sum, r) => sum + r.count, 0)

          return { tldCount: tlds.length, total }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // Target: <1s p95 for 100 TLDs
      expect(result.stats.p50).toBeLessThan(1000)
      expect(result.stats.p95).toBeLessThan(2000)
    })

    it('scatter-gather top domains across TLDs', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-scatter-gather-top',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          const tlds = ['com', 'org', 'net', 'io', 'ai']

          // Get top 20 domains from each TLD
          const scatterResults = await Promise.all(
            tlds.map(async (tld) => {
              const top = await ctx.do.list<{ domain: string; score: number }>(
                `/partition/${tld}/top?limit=20`
              )
              return { tld, domains: top }
            })
          )

          // Gather: merge and re-sort
          const allDomains = scatterResults.flatMap((r) =>
            r.domains.map((d) => ({ ...d, tld: r.tld }))
          )
          allDomains.sort((a, b) => b.score - a.score)

          return {
            topGlobal: allDomains.slice(0, 50),
            tldCount: tlds.length,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(500)
    })
  })

  describe('index effectiveness', () => {
    it('hash index lookup (exact domain match)', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-hash-index-exact',
        target: 'web.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          for (let i = 0; i < 10000; i++) {
            await ctx.do.request('/domains/index', {
              method: 'POST',
              body: JSON.stringify({
                domain: `hash-indexed-${i}.com`,
                metadata: { id: i },
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const domainIdx = iteration % 10000
          return ctx.do.get(`/domains/hash-indexed-${domainIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(500)
      // Hash index should be O(1)
      expect(result.stats.p50).toBeLessThan(5)
      expect(result.stats.p95).toBeLessThan(20)
    })

    it('range index query (domain prefix)', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-range-index-prefix',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create domains with prefixes
          const prefixes = ['tech-', 'shop-', 'blog-', 'news-', 'dev-']
          for (const prefix of prefixes) {
            for (let i = 0; i < 100; i++) {
              await ctx.do.request('/domains/index', {
                method: 'POST',
                body: JSON.stringify({
                  domain: `${prefix}${i}.com`,
                  metadata: { prefix, id: i },
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const prefixes = ['tech-', 'shop-', 'blog-', 'news-', 'dev-']
          const prefix = prefixes[iteration % prefixes.length]
          return ctx.do.list(`/domains/prefix/${prefix}`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(30)
    })

    it('compound index query (TLD + weight range)', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-compound-index',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const tlds = ['com', 'org', 'net']
          for (const tld of tlds) {
            for (let i = 0; i < 100; i++) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: `compound-source.${tld}`,
                  to: `compound-target-${i}.${tld}`,
                  weight: i * 10,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const tlds = ['com', 'org', 'net']
          const tld = tlds[iteration % tlds.length]
          return ctx.do.list(`/edges/from/compound-source.${tld}?minWeight=500&maxWeight=800`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('index vs scan comparison', async () => {
      // Indexed query
      const indexedResult = await benchmark({
        name: 'webcrawl-scale-indexed-query',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: 'comparison-source.com',
                to: `comparison-target-${i}.com`,
                weight: i,
                indexed: true,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/from/comparison-source.com?minWeight=900')
        },
      })

      // Full scan query
      const scanResult = await benchmark({
        name: 'webcrawl-scale-scan-query',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // Force scan without index
          return ctx.do.list('/edges/from/comparison-source.com?forceNoIndex=true&minWeight=900')
        },
      })

      record(indexedResult)
      record(scanResult)

      expect(indexedResult.samples.length).toBe(50)
      expect(scanResult.samples.length).toBe(50)

      // Indexed should be faster
      console.log(`Indexed p50: ${indexedResult.stats.p50.toFixed(2)}ms`)
      console.log(`Scan p50: ${scanResult.stats.p50.toFixed(2)}ms`)
    })
  })

  describe('memory limits and streaming', () => {
    it('stream large result set', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-stream-large',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 5000,
        setup: async (ctx) => {
          const source = 'stream-source.com'
          for (let batch = 0; batch < 50; batch++) {
            const edges = Array.from({ length: 100 }, (_, i) => ({
              from: source,
              to: `stream-target-${batch * 100 + i}.com`,
              weight: 1,
            }))

            await ctx.do.request('/edges/batch', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            })
          }
        },
        run: async (ctx) => {
          // Stream all 5000 edges in chunks
          let total = 0
          let offset = 0
          const chunkSize = 500

          while (true) {
            const chunk = await ctx.do.list<unknown>(
              `/edges/from/stream-source.com?limit=${chunkSize}&offset=${offset}`
            )
            total += chunk.length
            if (chunk.length < chunkSize) break
            offset += chunkSize
          }

          return { totalStreamed: total }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('memory-bounded aggregation', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-memory-bounded-agg',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Aggregation with memory budget
          return ctx.do.request('/algorithms/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'count-by-tld',
              memoryBudgetMB: 128,
              spillToDisk: true,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('chunked batch insert', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-chunked-insert',
        target: 'web.perf.do',
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          const totalEdges = 10000
          const chunkSize = 500
          let inserted = 0

          for (let offset = 0; offset < totalEdges; offset += chunkSize) {
            const edges = Array.from({ length: chunkSize }, (_, i) => ({
              from: `chunked-${iteration}-${offset + i}.com`,
              to: `chunked-target-${(offset + i) % 1000}.com`,
              weight: 1,
            }))

            await ctx.do.request('/edges/batch', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            })

            inserted += chunkSize
          }

          return { inserted }
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
      expect(result.errors?.length ?? 0).toBe(0)
    })
  })

  describe('concurrent access under load', () => {
    it('concurrent read queries', async () => {
      const concurrency = 10

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerId) =>
          benchmark({
            name: `webcrawl-scale-concurrent-read-${workerId}`,
            target: 'web.perf.do',
            iterations: 50,
            warmup: 5,
            setup: async (ctx) => {
              // Each worker has its own source domain
              for (let i = 0; i < 50; i++) {
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({
                    from: `concurrent-read-${workerId}.com`,
                    to: `concurrent-target-${i}.com`,
                    weight: 1,
                  }),
                })
              }
            },
            run: async (ctx) => {
              return ctx.do.list(`/edges/from/concurrent-read-${workerId}.com`)
            },
          })
        )
      )

      record(results)

      // All workers should complete
      for (const r of results) {
        expect(r.errors?.length ?? 0).toBeLessThan(5)
      }

      // Check for fairness
      const p50s = results.map((r) => r.stats.p50)
      const meanP50 = p50s.reduce((a, b) => a + b, 0) / p50s.length
      const maxP50 = Math.max(...p50s)

      // No worker should be more than 3x slower
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })

    it('concurrent write queries', async () => {
      const concurrency = 5

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerId) =>
          benchmark({
            name: `webcrawl-scale-concurrent-write-${workerId}`,
            target: 'web.perf.do',
            iterations: 30,
            warmup: 3,
            run: async (ctx, iteration) => {
              const edges = Array.from({ length: 10 }, (_, i) => ({
                from: `write-worker-${workerId}-${iteration}.com`,
                to: `write-target-${i}.com`,
                weight: 1,
              }))

              return ctx.do.request('/edges/batch', {
                method: 'POST',
                body: JSON.stringify({ edges }),
              })
            },
          })
        )
      )

      record(results)

      // All workers should complete
      for (const r of results) {
        expect(r.errors?.length ?? 0).toBeLessThan(5)
      }
    })

    it('mixed read/write workload', async () => {
      const readers = 5
      const writers = 2

      const readerResults = Promise.all(
        Array.from({ length: readers }, (_, id) =>
          benchmark({
            name: `webcrawl-scale-mixed-reader-${id}`,
            target: 'web.perf.do',
            iterations: 50,
            warmup: 5,
            run: async (ctx, iteration) => {
              return ctx.do.list(`/edges/from/mixed-source-${iteration % 100}.com`)
            },
          })
        )
      )

      const writerResults = Promise.all(
        Array.from({ length: writers }, (_, id) =>
          benchmark({
            name: `webcrawl-scale-mixed-writer-${id}`,
            target: 'web.perf.do',
            iterations: 20,
            warmup: 2,
            run: async (ctx, iteration) => {
              return ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: `mixed-writer-${id}-${iteration}.com`,
                  to: `mixed-target.com`,
                  weight: 1,
                }),
              })
            },
          })
        )
      )

      const [rResults, wResults] = await Promise.all([readerResults, writerResults])

      record([...rResults, ...wResults])

      // Readers should not be significantly impacted by writers
      const readerP50s = rResults.map((r) => r.stats.p50)
      const avgReaderP50 = readerP50s.reduce((a, b) => a + b, 0) / readerP50s.length

      expect(avgReaderP50).toBeLessThan(100)
    })
  })

  describe('latency distribution', () => {
    it('latency percentiles under load', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-latency-percentiles',
        target: 'web.perf.do',
        iterations: 1000,
        warmup: 100,
        setup: async (ctx) => {
          for (let i = 0; i < 100; i++) {
            for (let j = 0; j < 10; j++) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: `latency-source-${i}.com`,
                  to: `latency-target-${j}.com`,
                  weight: 1,
                }),
              })
            }
          }
        },
        run: async (ctx, iteration) => {
          const sourceIdx = iteration % 100
          return ctx.do.list(`/edges/from/latency-source-${sourceIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(1000)

      // Log percentile distribution
      console.log('Latency distribution:')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  max: ${result.stats.max.toFixed(2)}ms`)
      console.log(`  stddev: ${result.stats.stddev.toFixed(2)}ms`)

      // Target: p95 < 100ms for domain lookup
      expect(result.stats.p95).toBeLessThan(100)

      // p99 should not be too far from p95
      expect(result.stats.p99).toBeLessThan(result.stats.p95 * 3)
    })

    it('tail latency stability', async () => {
      const result = await benchmark({
        name: 'webcrawl-scale-tail-latency',
        target: 'web.perf.do',
        iterations: 500,
        warmup: 50,
        run: async (ctx, iteration) => {
          const sourceIdx = iteration % 50
          return ctx.do.list(`/edges/from/tail-source-${sourceIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(500)

      // Tail latency should be stable
      // Max should not be more than 10x p99
      expect(result.stats.max).toBeLessThan(result.stats.p99 * 10)

      // Standard deviation should be reasonable
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 2)
    })
  })
})
