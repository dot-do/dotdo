/**
 * Web Crawl Graph Algorithm Performance Benchmarks
 *
 * Tests graph algorithms on web link data:
 * - PageRank computation benchmarks
 * - Connected components at web scale
 * - Hub/authority (HITS) analysis
 * - Domain clustering by link patterns
 * - Shortest path between domains
 * - Subgraph extraction (domain neighborhood)
 *
 * Target namespace: web.org.ai, {tld}.web.org.ai
 * Scale: ~1B+ hostnames, ~10B+ link edges
 *
 * Performance targets:
 * - PageRank iteration: <5s per iteration
 *
 * @see dotdo-b2pk0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Web Crawl Graph Algorithm Benchmarks', () => {
  describe('PageRank computation', () => {
    it('single PageRank iteration on small graph', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-pagerank-single-iter-small',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create a small web graph
          const domains = Array.from({ length: 100 }, (_, i) => `pr-domain-${i}.com`)
          for (const from of domains) {
            const numLinks = Math.floor(Math.random() * 10) + 1
            for (let i = 0; i < numLinks; i++) {
              const to = domains[Math.floor(Math.random() * domains.length)]
              if (from !== to) {
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({ from, to, weight: 1 }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          // Execute single PageRank iteration
          return ctx.do.request('/algorithms/pagerank/iterate', {
            method: 'POST',
            body: JSON.stringify({
              dampingFactor: 0.85,
              maxIterations: 1,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('PageRank convergence (10 iterations)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-pagerank-10-iter',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create moderate-sized web graph
          const domains = Array.from({ length: 500 }, (_, i) => `pr10-domain-${i}.com`)
          for (const from of domains) {
            const numLinks = Math.floor(Math.random() * 5) + 1
            for (let i = 0; i < numLinks; i++) {
              const to = domains[Math.floor(Math.random() * domains.length)]
              if (from !== to) {
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({ from, to, weight: 1 }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/algorithms/pagerank/compute', {
            method: 'POST',
            body: JSON.stringify({
              dampingFactor: 0.85,
              maxIterations: 10,
              convergenceThreshold: 0.0001,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // Target: <5s per iteration, 10 iterations
      expect(result.stats.p50).toBeLessThan(50000)
    })

    it('incremental PageRank update', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-pagerank-incremental',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Initialize PageRank scores
          await ctx.do.request('/algorithms/pagerank/init', {
            method: 'POST',
            body: JSON.stringify({ domainCount: 1000 }),
          })
        },
        run: async (ctx, iteration) => {
          // Add new edges and update PageRank incrementally
          const newEdges = Array.from({ length: 10 }, (_, i) => ({
            from: `new-source-${iteration}-${i}.com`,
            to: `existing-${i % 100}.com`,
            weight: 1,
          }))

          return ctx.do.request('/algorithms/pagerank/update', {
            method: 'POST',
            body: JSON.stringify({
              newEdges,
              iterations: 1,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('PageRank query (get top N domains)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-pagerank-query-top',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-compute and store PageRank scores
          const scores = Array.from({ length: 10000 }, (_, i) => ({
            domain: `ranked-${i}.com`,
            pageRank: Math.random(),
          }))

          await ctx.do.request('/algorithms/pagerank/seed', {
            method: 'POST',
            body: JSON.stringify({ scores }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/algorithms/pagerank/top?limit=100')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('PageRank for specific domain', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-pagerank-lookup',
        target: 'web.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          const scores = Array.from({ length: 1000 }, (_, i) => ({
            domain: `lookup-${i}.com`,
            pageRank: Math.random(),
          }))

          await ctx.do.request('/algorithms/pagerank/seed', {
            method: 'POST',
            body: JSON.stringify({ scores }),
          })
        },
        run: async (ctx, iteration) => {
          const domainIdx = iteration % 1000
          return ctx.do.get(`/algorithms/pagerank/lookup-${domainIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('connected components', () => {
    it('find connected component from starting domain', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-connected-component',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a connected component
          const component = [
            { from: 'cc-a.com', to: 'cc-b.com' },
            { from: 'cc-b.com', to: 'cc-c.com' },
            { from: 'cc-c.com', to: 'cc-d.com' },
            { from: 'cc-d.com', to: 'cc-a.com' },
            { from: 'cc-b.com', to: 'cc-e.com' },
          ]

          // Separate component
          const isolated = [
            { from: 'isolated-1.com', to: 'isolated-2.com' },
          ]

          for (const edge of [...component, ...isolated]) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ ...edge, weight: 1 }),
            })
          }
        },
        run: async (ctx) => {
          // Find all domains in same component as cc-a.com (bidirectional)
          const component = new Set<string>()
          const queue: string[] = ['cc-a.com']

          while (queue.length > 0) {
            const current = queue.shift()!
            if (component.has(current)) continue
            component.add(current)

            const [outbound, inbound] = await Promise.all([
              ctx.do.list<{ to: string }>(`/edges/from/${encodeURIComponent(current)}`),
              ctx.do.list<{ from: string }>(`/edges/to/${encodeURIComponent(current)}`),
            ])

            for (const e of outbound) {
              if (!component.has(e.to)) queue.push(e.to)
            }
            for (const e of inbound) {
              if (!component.has(e.from)) queue.push(e.from)
            }
          }

          return { size: component.size, members: Array.from(component) }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('component size distribution (pre-computed)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-component-distribution',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Pre-compute component sizes
          const distribution = [
            { size: 1, count: 500000 },
            { size: 2, count: 100000 },
            { size: '3-10', count: 50000 },
            { size: '11-100', count: 10000 },
            { size: '101-1000', count: 1000 },
            { size: '>1000', count: 100 },
          ]

          await ctx.do.request('/algorithms/components/distribution', {
            method: 'POST',
            body: JSON.stringify({ distribution }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/algorithms/components/distribution')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('weakly connected components (WCC) on TLD partition', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-wcc-tld',
        target: 'com.web.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Request WCC computation on the .com partition
          return ctx.do.request('/algorithms/components/wcc', {
            method: 'POST',
            body: JSON.stringify({
              sampleSize: 10000, // Sample for benchmark
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(5000)
    })
  })

  describe('HITS (hub/authority) analysis', () => {
    it('HITS single iteration', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-hits-single-iter',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create hub-authority graph structure
          const hubs = Array.from({ length: 20 }, (_, i) => `hub-${i}.com`)
          const authorities = Array.from({ length: 50 }, (_, i) => `authority-${i}.com`)

          for (const hub of hubs) {
            // Each hub links to multiple authorities
            const numLinks = Math.floor(Math.random() * 20) + 5
            for (let i = 0; i < numLinks; i++) {
              const auth = authorities[Math.floor(Math.random() * authorities.length)]
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: hub, to: auth, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/algorithms/hits/iterate', {
            method: 'POST',
            body: JSON.stringify({ iterations: 1 }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('HITS convergence (10 iterations)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-hits-10-iter',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create larger hub-authority structure
          const nodes = Array.from({ length: 500 }, (_, i) => `hits-node-${i}.com`)
          for (let i = 0; i < 1000; i++) {
            const from = nodes[Math.floor(Math.random() * nodes.length)]
            const to = nodes[Math.floor(Math.random() * nodes.length)]
            if (from !== to) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from, to, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/algorithms/hits/compute', {
            method: 'POST',
            body: JSON.stringify({
              iterations: 10,
              convergenceThreshold: 0.0001,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(5000)
    })

    it('query top hubs', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-hits-top-hubs',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const scores = Array.from({ length: 1000 }, (_, i) => ({
            domain: `hits-domain-${i}.com`,
            hubScore: Math.random(),
            authorityScore: Math.random(),
          }))

          await ctx.do.request('/algorithms/hits/seed', {
            method: 'POST',
            body: JSON.stringify({ scores }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/algorithms/hits/top-hubs?limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('query top authorities', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-hits-top-authorities',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/algorithms/hits/top-authorities?limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('domain clustering', () => {
    it('cluster domains by outbound link overlap', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-cluster-outbound',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create domains with clustered link patterns
          const clusters = [
            ['tech-1.com', 'tech-2.com', 'tech-3.com'],
            ['news-1.com', 'news-2.com', 'news-3.com'],
            ['shop-1.com', 'shop-2.com', 'shop-3.com'],
          ]
          const clusterTargets = [
            ['github.com', 'stackoverflow.com', 'npmjs.com'],
            ['cnn.com', 'bbc.com', 'reuters.com'],
            ['amazon.com', 'ebay.com', 'shopify.com'],
          ]

          for (let c = 0; c < clusters.length; c++) {
            for (const domain of clusters[c]!) {
              for (const target of clusterTargets[c]!) {
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({ from: domain, to: target, weight: 1 }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/algorithms/cluster/outbound', {
            method: 'POST',
            body: JSON.stringify({
              algorithm: 'louvain',
              minClusterSize: 2,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(2000)
    })

    it('cluster domains by inbound link overlap (topic detection)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-cluster-inbound',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Sites in same topic are often linked together
          const topicDomains = ['ml-1.com', 'ml-2.com', 'ml-3.com', 'ml-4.com']
          const linkers = ['blog-1.com', 'blog-2.com', 'blog-3.com']

          for (const linker of linkers) {
            for (const topic of topicDomains) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: linker, to: topic, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          return ctx.do.request('/algorithms/cluster/inbound', {
            method: 'POST',
            body: JSON.stringify({
              algorithm: 'label-propagation',
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(2000)
    })

    it('get cluster assignments for domains', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-cluster-lookup',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-compute cluster assignments
          const assignments = Array.from({ length: 1000 }, (_, i) => ({
            domain: `clustered-${i}.com`,
            clusterId: `cluster-${i % 10}`,
            confidence: Math.random(),
          }))

          await ctx.do.request('/algorithms/cluster/seed', {
            method: 'POST',
            body: JSON.stringify({ assignments }),
          })
        },
        run: async (ctx, iteration) => {
          const domainIdx = iteration % 1000
          return ctx.do.get(`/algorithms/cluster/clustered-${domainIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('shortest path', () => {
    it('shortest path between two domains (BFS)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-shortest-path-bfs',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a path: a -> b -> c -> d -> e
          const path = [
            { from: 'path-a.com', to: 'path-b.com' },
            { from: 'path-b.com', to: 'path-c.com' },
            { from: 'path-c.com', to: 'path-d.com' },
            { from: 'path-d.com', to: 'path-e.com' },
          ]

          // Add some alternate paths
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({ from: 'path-a.com', to: 'path-c.com', weight: 1 }),
          })

          for (const edge of path) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ ...edge, weight: 1 }),
            })
          }
        },
        run: async (ctx) => {
          const start = 'path-a.com'
          const target = 'path-e.com'
          const visited = new Map<string, string>() // domain -> previous domain
          const queue: string[] = [start]
          visited.set(start, '')

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current === target) {
              // Reconstruct path
              const path: string[] = []
              let node: string | undefined = target
              while (node) {
                path.unshift(node)
                node = visited.get(node) || undefined
                if (node === '') break
              }
              return { path, length: path.length - 1 }
            }

            const edges = await ctx.do.list<{ to: string }>(
              `/edges/from/${encodeURIComponent(current)}`
            )

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.set(edge.to, current)
                queue.push(edge.to)
              }
            }
          }

          return { path: null, length: -1 }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('shortest path with depth limit', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-shortest-path-depth-limit',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create a longer path
          for (let i = 0; i < 10; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `depth-${i}.com`,
                to: `depth-${i + 1}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          const maxDepth = 5
          const start = 'depth-0.com'
          const target = 'depth-10.com' // Beyond max depth

          const visited = new Set<string>([start])
          const queue: { domain: string; depth: number; path: string[] }[] = [
            { domain: start, depth: 0, path: [start] },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.domain === target) {
              return { path: current.path, found: true }
            }

            if (current.depth >= maxDepth) continue

            const edges = await ctx.do.list<{ to: string }>(
              `/edges/from/${encodeURIComponent(current.domain)}`
            )

            for (const edge of edges) {
              if (!visited.has(edge.to)) {
                visited.add(edge.to)
                queue.push({
                  domain: edge.to,
                  depth: current.depth + 1,
                  path: [...current.path, edge.to],
                })
              }
            }
          }

          return { path: null, found: false, maxDepthReached: maxDepth }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(1000)
    })

    it('check if path exists (reachability)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-reachability',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          // Create connected and isolated components
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({
              from: 'reach-a.com',
              to: 'reach-b.com',
              weight: 1,
            }),
          })
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({
              from: 'reach-b.com',
              to: 'reach-c.com',
              weight: 1,
            }),
          })
          // Isolated node
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({
              from: 'isolated.com',
              to: 'isolated-2.com',
              weight: 1,
            }),
          })
        },
        run: async (ctx, iteration) => {
          const targets = ['reach-c.com', 'isolated.com']
          const target = targets[iteration % 2]

          // Simple reachability check with BFS
          const visited = new Set<string>()
          const queue = ['reach-a.com']

          while (queue.length > 0 && visited.size < 100) {
            const current = queue.shift()!
            if (visited.has(current)) continue
            visited.add(current)

            if (current === target) return { reachable: true, target }

            const edges = await ctx.do.list<{ to: string }>(
              `/edges/from/${encodeURIComponent(current)}`
            )
            for (const edge of edges) {
              if (!visited.has(edge.to)) queue.push(edge.to)
            }
          }

          return { reachable: false, target }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(500)
    })
  })

  describe('subgraph extraction', () => {
    it('extract N-hop neighborhood subgraph', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-subgraph-nhop',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a subgraph-worthy structure
          const center = 'subgraph-center.com'
          for (let i = 0; i < 10; i++) {
            const hop1 = `subgraph-h1-${i}.com`
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ from: center, to: hop1, weight: 1 }),
            })

            for (let j = 0; j < 5; j++) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: hop1,
                  to: `subgraph-h2-${i}-${j}.com`,
                  weight: 1,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const center = 'subgraph-center.com'
          const maxHops = 2
          const nodes = new Set<string>()
          const edges: Array<{ from: string; to: string }> = []
          const queue: { domain: string; depth: number }[] = [{ domain: center, depth: 0 }]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (nodes.has(current.domain)) continue
            nodes.add(current.domain)

            if (current.depth < maxHops) {
              const outEdges = await ctx.do.list<{ to: string }>(
                `/edges/from/${encodeURIComponent(current.domain)}`
              )

              for (const edge of outEdges) {
                edges.push({ from: current.domain, to: edge.to })
                if (!nodes.has(edge.to)) {
                  queue.push({ domain: edge.to, depth: current.depth + 1 })
                }
              }
            }
          }

          return {
            center,
            nodeCount: nodes.size,
            edgeCount: edges.length,
            nodes: Array.from(nodes),
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(1000)
    })

    it('extract ego graph (1-hop in and out)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-ego',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const center = 'ego-center.com'
          // Outbound
          for (let i = 0; i < 15; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ from: center, to: `ego-out-${i}.com`, weight: 1 }),
            })
          }
          // Inbound
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ from: `ego-in-${i}.com`, to: center, weight: 1 }),
            })
          }
        },
        run: async (ctx) => {
          const center = 'ego-center.com'

          const [outbound, inbound] = await Promise.all([
            ctx.do.list<{ to: string }>(`/edges/from/${center}`),
            ctx.do.list<{ from: string }>(`/edges/to/${center}`),
          ])

          const nodes = new Set([
            center,
            ...outbound.map((e) => e.to),
            ...inbound.map((e) => e.from),
          ])

          const edges = [
            ...outbound.map((e) => ({ from: center, to: e.to })),
            ...inbound.map((e) => ({ from: e.from, to: center })),
          ]

          return {
            center,
            nodeCount: nodes.size,
            edgeCount: edges.length,
            outDegree: outbound.length,
            inDegree: inbound.length,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('extract subgraph by domain pattern', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-subgraph-pattern',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create domains matching a pattern
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `tech-${i}.example.com`,
                to: `target-${i % 10}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          // Extract subgraph for *.example.com domains
          return ctx.do.request('/algorithms/subgraph/extract', {
            method: 'POST',
            body: JSON.stringify({
              pattern: '*.example.com',
              includeOutbound: true,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(500)
    })
  })

  describe('graph statistics', () => {
    it('compute graph density', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-density',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.get('/algorithms/stats/density')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('degree distribution', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-degree-distribution',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.get('/algorithms/stats/degree-distribution')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('average path length (sampled)', async () => {
      const result = await benchmark({
        name: 'webcrawl-graph-avg-path-length',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          return ctx.do.request('/algorithms/stats/avg-path-length', {
            method: 'POST',
            body: JSON.stringify({
              sampleSize: 100, // Sample pairs for estimation
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(5000)
    })
  })
})
