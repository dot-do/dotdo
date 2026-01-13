/**
 * Web Crawl Query Performance Benchmarks
 *
 * Tests query patterns on web graph data:
 * - Outbound links from domain
 * - Inbound links to domain (backlinks)
 * - Domain authority lookup
 * - Link neighborhood queries (N-hop)
 * - TLD distribution queries
 * - Top domains by inbound links
 * - Domain similarity by link overlap
 *
 * Target namespace: web.org.ai, {tld}.web.org.ai
 * Scale: ~1B+ hostnames, ~10B+ link edges
 *
 * Performance targets:
 * - Domain lookup: <100ms p95
 * - Backlink query: <500ms p95
 *
 * @see dotdo-b2pk0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Web Crawl Query Benchmarks', () => {
  describe('outbound link queries', () => {
    it('outbound links from domain', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-outbound-basic',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create domain with outbound links
          const domain = 'source-domain.com'
          for (let i = 0; i < 50; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: domain,
                to: `target-${i}.com`,
                weight: Math.floor(Math.random() * 100) + 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/from/source-domain.com')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Outbound query should be fast
      expect(result.stats.p50).toBeLessThan(20)
      // Target: <100ms p95
      expect(result.stats.p95).toBeLessThan(100)
    })

    it('outbound links with weight threshold', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-outbound-weight-filter',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const domain = 'weight-source.com'
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: domain,
                to: `weighted-target-${i}.com`,
                weight: i, // Weights from 0 to 99
              }),
            })
          }
        },
        run: async (ctx) => {
          // Get links with weight >= 50
          return ctx.do.list('/edges/from/weight-source.com?minWeight=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('outbound links paginated', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-outbound-paginated',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const domain = 'paginated-source.com'
          for (let i = 0; i < 200; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: domain,
                to: `paginated-target-${i}.com`,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx, iteration) => {
          const pageSize = 20
          const page = iteration % 10
          return ctx.do.list(
            `/edges/from/paginated-source.com?limit=${pageSize}&offset=${page * pageSize}`
          )
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(15)
    })
  })

  describe('inbound link queries (backlinks)', () => {
    it('backlinks to domain', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-backlinks-basic',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Create domain with many inbound links (popular site)
          const target = 'popular-domain.com'
          for (let i = 0; i < 100; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `linking-site-${i}.com`,
                to: target,
                weight: Math.floor(Math.random() * 50) + 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/to/popular-domain.com')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Backlink query target: <500ms p95
      expect(result.stats.p50).toBeLessThan(100)
      expect(result.stats.p95).toBeLessThan(500)
    })

    it('backlinks to high-authority domain (1000+ links)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-backlinks-high-authority',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        setup: async (ctx) => {
          const target = 'authority-domain.com'
          for (let i = 0; i < 1000; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `backlink-source-${i}.com`,
                to: target,
                weight: Math.floor(Math.random() * 100) + 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/to/authority-domain.com')
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Large backlink set should still be within target
      expect(result.stats.p95).toBeLessThan(500)
    })

    it('backlinks sorted by weight', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-backlinks-sorted',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const target = 'sorted-backlink-target.com'
          for (let i = 0; i < 200; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `sorted-source-${i}.com`,
                to: target,
                weight: Math.floor(Math.random() * 1000),
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/edges/to/sorted-backlink-target.com?sort=weight&order=desc&limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('backlink count only', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-backlinks-count',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const target = 'count-target.com'
          for (let i = 0; i < 500; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `count-source-${i}.com`,
                to: target,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.get('/edges/to/count-target.com/count')
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Count-only should be very fast
      expect(result.stats.p50).toBeLessThan(10)
    })
  })

  describe('domain authority lookup', () => {
    it('domain authority score lookup', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-authority-lookup',
        target: 'web.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          // Pre-compute authority scores for domains
          const domains = Array.from({ length: 100 }, (_, i) => ({
            domain: `authority-test-${i}.com`,
            score: Math.random() * 100,
            inboundCount: Math.floor(Math.random() * 10000),
            outboundCount: Math.floor(Math.random() * 500),
          }))

          await ctx.do.request('/authority/seed', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })
        },
        run: async (ctx, iteration) => {
          const domainIdx = iteration % 100
          return ctx.do.get(`/authority/authority-test-${domainIdx}.com`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(200)
      // Authority lookup target: <100ms p95
      expect(result.stats.p50).toBeLessThan(10)
      expect(result.stats.p95).toBeLessThan(100)
    })

    it('batch authority lookup', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-authority-batch',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const domains = Array.from({ length: 500 }, (_, i) => ({
            domain: `batch-authority-${i}.com`,
            score: Math.random() * 100,
          }))

          await ctx.do.request('/authority/seed', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })
        },
        run: async (ctx, iteration) => {
          const batchSize = 20
          const domains = Array.from(
            { length: batchSize },
            (_, i) => `batch-authority-${(iteration * batchSize + i) % 500}.com`
          )

          return ctx.do.request('/authority/batch', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('authority ranking (top N domains)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-authority-ranking',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          const domains = Array.from({ length: 1000 }, (_, i) => ({
            domain: `ranked-${i}.com`,
            score: Math.random() * 100,
          }))

          await ctx.do.request('/authority/seed', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/authority/top?limit=100')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('link neighborhood queries', () => {
    it('1-hop neighborhood (direct links)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-neighborhood-1hop',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const center = 'neighborhood-center.com'
          // Outbound links
          for (let i = 0; i < 20; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: center,
                to: `outbound-neighbor-${i}.com`,
                weight: 1,
              }),
            })
          }
          // Inbound links
          for (let i = 0; i < 30; i++) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `inbound-neighbor-${i}.com`,
                to: center,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          const center = 'neighborhood-center.com'
          const [outbound, inbound] = await Promise.all([
            ctx.do.list<{ to: string }>(`/edges/from/${center}`),
            ctx.do.list<{ from: string }>(`/edges/to/${center}`),
          ])

          const neighbors = new Set([
            ...outbound.map((e) => e.to),
            ...inbound.map((e) => e.from),
          ])

          return { center, neighborCount: neighbors.size }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('2-hop neighborhood', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-neighborhood-2hop',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create 2-hop graph
          const center = '2hop-center.com'
          const hop1 = ['hop1-a.com', 'hop1-b.com', 'hop1-c.com']
          const hop2 = ['hop2-1.com', 'hop2-2.com', 'hop2-3.com', 'hop2-4.com', 'hop2-5.com']

          for (const h1 of hop1) {
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ from: center, to: h1, weight: 1 }),
            })
            for (const h2 of hop2) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: h1, to: h2, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          const center = '2hop-center.com'
          const hop1Domains = new Set<string>()
          const hop2Domains = new Set<string>()

          // Hop 1
          const hop1Edges = await ctx.do.list<{ to: string }>(`/edges/from/${center}`)
          for (const edge of hop1Edges) {
            hop1Domains.add(edge.to)
          }

          // Hop 2 (parallel)
          const hop2Promises = Array.from(hop1Domains).map((domain) =>
            ctx.do.list<{ to: string }>(`/edges/from/${encodeURIComponent(domain)}`)
          )
          const hop2Results = await Promise.all(hop2Promises)
          for (const edges of hop2Results) {
            for (const edge of edges) {
              hop2Domains.add(edge.to)
            }
          }

          return {
            center,
            hop1Count: hop1Domains.size,
            hop2Count: hop2Domains.size,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('N-hop neighborhood with depth limit', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-neighborhood-nhop',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Create deeper graph structure
          const levels = 4
          const nodesPerLevel = 5

          for (let level = 0; level < levels - 1; level++) {
            for (let i = 0; i < nodesPerLevel; i++) {
              const from = `nhop-L${level}-${i}.com`
              for (let j = 0; j < 3; j++) {
                const to = `nhop-L${level + 1}-${(i + j) % nodesPerLevel}.com`
                await ctx.do.request('/edges', {
                  method: 'POST',
                  body: JSON.stringify({ from, to, weight: 1 }),
                })
              }
            }
          }
        },
        run: async (ctx) => {
          const maxDepth = 3
          const visited = new Set<string>()
          const queue: { domain: string; depth: number }[] = [
            { domain: 'nhop-L0-0.com', depth: 0 },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (visited.has(current.domain)) continue
            visited.add(current.domain)

            if (current.depth < maxDepth) {
              const edges = await ctx.do.list<{ to: string }>(
                `/edges/from/${encodeURIComponent(current.domain)}`
              )
              for (const edge of edges) {
                if (!visited.has(edge.to)) {
                  queue.push({ domain: edge.to, depth: current.depth + 1 })
                }
              }
            }
          }

          return { reachable: visited.size, maxDepth }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeLessThan(1000)
    })
  })

  describe('TLD distribution queries', () => {
    it('get TLD distribution for domain backlinks', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-tld-distribution',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const target = 'tld-dist-target.com'
          const tlds = ['com', 'org', 'net', 'io', 'ai', 'co.uk', 'de', 'fr']
          for (let i = 0; i < 100; i++) {
            const tld = tlds[i % tlds.length]
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({
                from: `source-${i}.${tld}`,
                to: target,
                weight: 1,
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.get('/edges/to/tld-dist-target.com/tld-distribution')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('top TLDs by link count', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-top-tlds',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/stats/tld/top?limit=20')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('domain count per TLD', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-tld-domain-count',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, iteration) => {
          const tlds = ['com', 'org', 'net', 'io', 'ai']
          const tld = tlds[iteration % tlds.length]
          return ctx.do.get(`/stats/tld/${tld}/count`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('top domains queries', () => {
    it('top domains by inbound links (global)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-top-by-inbound',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create domains with varying inbound counts
          for (let i = 0; i < 100; i++) {
            const inboundCount = Math.floor(Math.random() * 1000) + 1
            await ctx.do.request('/domains/stats', {
              method: 'POST',
              body: JSON.stringify({
                domain: `ranked-domain-${i}.com`,
                inboundCount,
                outboundCount: Math.floor(Math.random() * 100),
              }),
            })
          }
        },
        run: async (ctx) => {
          return ctx.do.list('/domains/top?sortBy=inbound&limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('top domains by inbound links (per TLD)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-top-by-inbound-tld',
        target: 'com.web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/domains/top?sortBy=inbound&limit=100')
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('top domains by outbound links', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-top-by-outbound',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          return ctx.do.list('/domains/top?sortBy=outbound&limit=50')
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('domain similarity queries', () => {
    it('find domains with similar outbound links (Jaccard)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-similarity-outbound-jaccard',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create domains with overlapping link profiles
          const commonTargets = ['common-1.com', 'common-2.com', 'common-3.com']
          const domains = ['domain-a.com', 'domain-b.com', 'domain-c.com']

          for (const domain of domains) {
            for (const target of commonTargets) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: domain, to: target, weight: 1 }),
              })
            }
            // Add unique links
            for (let i = 0; i < 5; i++) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({
                  from: domain,
                  to: `unique-${domain}-${i}.com`,
                  weight: 1,
                }),
              })
            }
          }
        },
        run: async (ctx) => {
          const domain = 'domain-a.com'
          const candidates = ['domain-b.com', 'domain-c.com']

          // Get links for target domain
          const targetLinks = await ctx.do.list<{ to: string }>(`/edges/from/${domain}`)
          const targetSet = new Set(targetLinks.map((l) => l.to))

          // Calculate Jaccard similarity with each candidate
          const similarities = await Promise.all(
            candidates.map(async (candidate) => {
              const candidateLinks = await ctx.do.list<{ to: string }>(
                `/edges/from/${encodeURIComponent(candidate)}`
              )
              const candidateSet = new Set(candidateLinks.map((l) => l.to))

              const intersection = new Set(
                Array.from(targetSet).filter((x) => candidateSet.has(x))
              )
              const union = new Set([...Array.from(targetSet), ...Array.from(candidateSet)])

              return {
                domain: candidate,
                jaccard: intersection.size / union.size,
              }
            })
          )

          return { domain, similarities }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('find domains with similar inbound links (co-citation)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-similarity-inbound-cocitation',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create domains that are often cited together
          const citingSites = ['citing-1.com', 'citing-2.com', 'citing-3.com', 'citing-4.com']
          const citedDomains = ['cited-a.com', 'cited-b.com']

          for (const citing of citingSites) {
            for (const cited of citedDomains) {
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: citing, to: cited, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          const domain = 'cited-a.com'
          const candidates = ['cited-b.com']

          // Get sites linking to target domain
          const targetBacklinks = await ctx.do.list<{ from: string }>(`/edges/to/${domain}`)
          const targetCiting = new Set(targetBacklinks.map((l) => l.from))

          // Calculate co-citation with candidates
          const similarities = await Promise.all(
            candidates.map(async (candidate) => {
              const candidateBacklinks = await ctx.do.list<{ from: string }>(
                `/edges/to/${encodeURIComponent(candidate)}`
              )
              const candidateCiting = new Set(candidateBacklinks.map((l) => l.from))

              const coCitation = new Set(
                Array.from(targetCiting).filter((x) => candidateCiting.has(x))
              )

              return {
                domain: candidate,
                coCitationCount: coCitation.size,
                coCitingSites: Array.from(coCitation),
              }
            })
          )

          return { domain, similarities }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(100)
    })

    it('find similar domains using pre-computed embeddings', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-similarity-embedding',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-compute link profile embeddings
          const domains = Array.from({ length: 100 }, (_, i) => ({
            domain: `embedded-${i}.com`,
            embedding: Array.from({ length: 64 }, () => Math.random()),
          }))

          await ctx.do.request('/embeddings/seed', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })
        },
        run: async (ctx, iteration) => {
          const queryDomain = `embedded-${iteration % 100}.com`
          return ctx.do.list(`/embeddings/similar/${encodeURIComponent(queryDomain)}?limit=10`)
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Vector similarity should be fast with index
      expect(result.stats.p50).toBeLessThan(50)
    })
  })

  describe('complex query patterns', () => {
    it('mutual link query (A->B and B->A)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-mutual-links',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const domain = 'mutual-test.com'
          // Create some mutual links
          for (let i = 0; i < 20; i++) {
            const other = `partner-${i}.com`
            await ctx.do.request('/edges', {
              method: 'POST',
              body: JSON.stringify({ from: domain, to: other, weight: 1 }),
            })
            if (i < 10) {
              // Only some are mutual
              await ctx.do.request('/edges', {
                method: 'POST',
                body: JSON.stringify({ from: other, to: domain, weight: 1 }),
              })
            }
          }
        },
        run: async (ctx) => {
          const domain = 'mutual-test.com'

          const [outbound, inbound] = await Promise.all([
            ctx.do.list<{ to: string }>(`/edges/from/${domain}`),
            ctx.do.list<{ from: string }>(`/edges/to/${domain}`),
          ])

          const outboundSet = new Set(outbound.map((e) => e.to))
          const inboundSet = new Set(inbound.map((e) => e.from))

          const mutual = Array.from(outboundSet).filter((d) => inboundSet.has(d))

          return { domain, mutualCount: mutual.length, mutual }
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('link chain query (A->B->C)', async () => {
      const result = await benchmark({
        name: 'webcrawl-query-link-chain',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create chains
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({ from: 'chain-a.com', to: 'chain-b.com', weight: 1 }),
          })
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({ from: 'chain-b.com', to: 'chain-c.com', weight: 1 }),
          })
          await ctx.do.request('/edges', {
            method: 'POST',
            body: JSON.stringify({ from: 'chain-b.com', to: 'chain-d.com', weight: 1 }),
          })
        },
        run: async (ctx) => {
          const start = 'chain-a.com'

          // Hop 1
          const hop1 = await ctx.do.list<{ to: string }>(`/edges/from/${start}`)
          if (hop1.length === 0) return { chains: [] }

          // Hop 2 (parallel)
          const hop2Promises = hop1.map((h1) =>
            ctx.do.list<{ to: string }>(`/edges/from/${encodeURIComponent(h1.to)}`)
          )
          const hop2Results = await Promise.all(hop2Promises)

          const chains: string[][] = []
          for (let i = 0; i < hop1.length; i++) {
            for (const h2 of hop2Results[i]!) {
              chains.push([start, hop1[i]!.to, h2.to])
            }
          }

          return { chains, chainCount: chains.length }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })
})
