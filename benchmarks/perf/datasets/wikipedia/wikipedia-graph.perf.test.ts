/**
 * Wikipedia Graph Performance Benchmarks
 *
 * Tests graph traversal and algorithm performance on Wikipedia's
 * category hierarchy (DAG) and internal link graph.
 *
 * Performance targets:
 * - Category traversal: <200ms (p95)
 * - Link graph query: <300ms (p95)
 * - "Six degrees" path finding: <1000ms (p95)
 * - Hub/authority analysis: <2000ms (p95)
 *
 * Graph characteristics:
 * - Categories: ~2M nodes (DAG with cycles removed)
 * - Internal links: ~200M+ edges
 * - Average article outdegree: ~30-50 links
 * - Average article indegree: ~10-30 backlinks
 *
 * Target endpoints:
 * - wikipedia.org.ai - Main Wikipedia API
 * - {letter}.wikipedia.org.ai - Per-partition endpoints (a-z)
 *
 * @see db/stores/relationships.ts for graph storage
 * @see dotdo-ymo5u for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for category traversal (ms)
 */
const MAX_CATEGORY_TRAVERSAL_P95_MS = 200

/**
 * Maximum acceptable p95 latency for link graph query (ms)
 */
const MAX_LINK_GRAPH_QUERY_P95_MS = 300

/**
 * Maximum acceptable p95 for path finding (ms)
 */
const MAX_PATH_FINDING_P95_MS = 1000

/**
 * Maximum acceptable p95 for hub/authority analysis (ms)
 */
const MAX_HUB_AUTHORITY_P95_MS = 2000

/**
 * Maximum acceptable p95 for cross-partition queries (ms)
 */
const MAX_CROSS_PARTITION_P95_MS = 500

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

/**
 * Warmup iterations
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample categories for hierarchy testing
 */
const SAMPLE_CATEGORIES = [
  'Category:Computer science',
  'Category:Programming languages',
  'Category:Software engineering',
  'Category:Artificial intelligence',
  'Category:Machine learning',
  'Category:Data structures',
  'Category:Algorithms',
  'Category:Computer networks',
  'Category:Operating systems',
  'Category:Databases',
]

/**
 * Famous articles for link graph testing
 */
const FAMOUS_ARTICLES = [
  'Computer science', 'Machine learning', 'Artificial intelligence',
  'Programming language', 'Algorithm', 'Data structure',
  'Internet', 'World Wide Web', 'Software engineering',
  'Database', 'Operating system', 'Computer network',
]

/**
 * Article pairs for path finding
 */
const ARTICLE_PAIRS = [
  { from: 'Computer science', to: 'Philosophy' },
  { from: 'Python (programming language)', to: 'Mathematics' },
  { from: 'Machine learning', to: 'Biology' },
  { from: 'Google', to: 'Stanford University' },
  { from: 'JavaScript', to: 'Netscape' },
]

/**
 * High-traffic hub articles
 */
const HUB_ARTICLES = [
  'United States', 'World War II', 'United Kingdom',
  'New York City', 'United Nations', 'Europe',
]

// ============================================================================
// CATEGORY HIERARCHY TRAVERSAL BENCHMARKS
// ============================================================================

describe('Wikipedia category hierarchy traversal (DAG)', () => {
  describe('parent traversal', () => {
    it('traverse category parents (single level)', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-parents-1',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request(`/graph/category/${encodeURIComponent(category!)}/parents`, {
            method: 'GET',
            headers: { 'X-Depth': '1' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Parent Traversal (depth 1) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('traverse category parents (multi-level)', async () => {
      const depths = [1, 2, 3, 4, 5]
      const results: Array<{ depth: number; p50: number }> = []

      for (const depth of depths) {
        const result = await benchmark({
          name: `wikipedia-category-parents-${depth}`,
          target: 'wikipedia.org.ai',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
            return ctx.do.request(`/graph/category/${encodeURIComponent(category!)}/parents`, {
              method: 'GET',
              headers: { 'X-Depth': String(depth) },
            })
          },
        })

        results.push({
          depth,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Category Parent Traversal by Depth ===')
      console.log('  Depth | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.depth).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Deeper traversals should be slower but manageable
      expect(results[results.length - 1]!.p50).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })

    it('find all ancestors to root', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-ancestors-all',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request(`/graph/category/${encodeURIComponent(category!)}/ancestors`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Category All Ancestors Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 3)
    })
  })

  describe('child traversal', () => {
    it('traverse category children (single level)', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-children-1',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request(`/graph/category/${encodeURIComponent(category!)}/children`, {
            method: 'GET',
            headers: { 'X-Depth': '1' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Children Traversal (depth 1) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('count all descendants', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-descendants-count',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request(`/graph/category/${encodeURIComponent(category!)}/descendants/count`, {
            method: 'GET',
            headers: { 'X-Max-Depth': '5' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Descendants Count ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })
  })

  describe('category relationships', () => {
    it('find common parent categories', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-common-parents',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const cat1 = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          const cat2 = SAMPLE_CATEGORIES[(i + 3) % SAMPLE_CATEGORIES.length]
          return ctx.do.request('/graph/category/common-ancestors', {
            method: 'POST',
            body: JSON.stringify({
              categories: [cat1, cat2],
              maxDepth: 5,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Common Parent Categories ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })

    it('check category subsumption', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-subsumes',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const parent = 'Category:Computer science'
          const child = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request('/graph/category/subsumes', {
            method: 'POST',
            body: JSON.stringify({
              parent,
              child,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Category Subsumption Check ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })
  })
})

// ============================================================================
// INTERNAL LINK GRAPH BENCHMARKS
// ============================================================================

describe('Wikipedia internal link graph', () => {
  describe('outbound links', () => {
    it('get outbound links (first hop)', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-outbound-1hop',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/links/outbound`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Outbound Links (1 hop) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('expand outbound links (2 hops)', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-outbound-2hop',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/links/expand`, {
            method: 'GET',
            headers: {
              'X-Depth': '2',
              'X-Limit': '20',
            },
          })
        },
      })

      record(result)

      console.log('\n=== Outbound Links Expansion (2 hops) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS * 2)
    })
  })

  describe('inbound links (backlinks)', () => {
    it('get inbound links', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-inbound',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/links/inbound`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Inbound Links (Backlinks) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('count backlinks (high-fanin)', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-inbound-count',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = HUB_ARTICLES[i % HUB_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/links/inbound/count`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Backlink Count (High-Fanin Articles) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS / 2)
    })
  })

  describe('link graph queries', () => {
    it('find common outbound links', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-common-outbound',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 4) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/links/common', {
            method: 'POST',
            body: JSON.stringify({
              articles: [article1, article2],
              direction: 'outbound',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Common Outbound Links ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('find common inbound links', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-common-inbound',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 4) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/links/common', {
            method: 'POST',
            body: JSON.stringify({
              articles: [article1, article2],
              direction: 'inbound',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Common Inbound Links ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })
  })
})

// ============================================================================
// "SIX DEGREES OF WIKIPEDIA" PATH FINDING BENCHMARKS
// ============================================================================

describe('Wikipedia path finding ("Six Degrees")', () => {
  describe('shortest path', () => {
    it('find shortest path between articles (BFS)', async () => {
      const result = await benchmark({
        name: 'wikipedia-path-bfs',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const pair = ARTICLE_PAIRS[i % ARTICLE_PAIRS.length]
          return ctx.do.request('/graph/path/shortest', {
            method: 'POST',
            body: JSON.stringify({
              from: pair!.from,
              to: pair!.to,
              maxDepth: 6,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Shortest Path (BFS, max 6 hops) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PATH_FINDING_P95_MS)
    })

    it('find path with depth limit', async () => {
      const depths = [2, 3, 4, 5, 6]
      const results: Array<{ depth: number; p50: number; found: number }> = []

      for (const depth of depths) {
        let pathsFound = 0

        const result = await benchmark({
          name: `wikipedia-path-depth-${depth}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            const pair = ARTICLE_PAIRS[i % ARTICLE_PAIRS.length]
            const response = await ctx.do.request<{ path: string[] | null }>('/graph/path/shortest', {
              method: 'POST',
              body: JSON.stringify({
                from: pair!.from,
                to: pair!.to,
                maxDepth: depth,
              }),
            })
            if (response.path) pathsFound++
            return response
          },
        })

        results.push({
          depth,
          p50: result.stats.p50,
          found: pathsFound,
        })

        record(result)
      }

      console.log('\n=== Path Finding by Depth Limit ===')
      console.log('  Depth | p50 (ms)   | Paths Found')
      console.log('  ------|------------|------------')
      for (const r of results) {
        console.log(`  ${String(r.depth).padEnd(5)} | ${r.p50.toFixed(3).padStart(10)} | ${String(r.found).padStart(11)}`)
      }

      // More depth = more paths found but slower
      expect(results[results.length - 1]!.p50).toBeLessThan(MAX_PATH_FINDING_P95_MS)
    })

    it('bidirectional BFS', async () => {
      const result = await benchmark({
        name: 'wikipedia-path-bidirectional',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const pair = ARTICLE_PAIRS[i % ARTICLE_PAIRS.length]
          return ctx.do.request('/graph/path/bidirectional', {
            method: 'POST',
            body: JSON.stringify({
              from: pair!.from,
              to: pair!.to,
              maxDepth: 6,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Bidirectional BFS Path Finding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Bidirectional should be faster
      expect(result.stats.p95).toBeLessThan(MAX_PATH_FINDING_P95_MS * 0.8)
    })
  })

  describe('all paths', () => {
    it('find all paths up to length k', async () => {
      const result = await benchmark({
        name: 'wikipedia-path-all',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const pair = ARTICLE_PAIRS[i % ARTICLE_PAIRS.length]
          return ctx.do.request('/graph/path/all', {
            method: 'POST',
            body: JSON.stringify({
              from: pair!.from,
              to: pair!.to,
              maxDepth: 3,
              maxPaths: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== All Paths (max 3 hops, max 10 paths) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PATH_FINDING_P95_MS)
    })
  })
})

// ============================================================================
// HUB/AUTHORITY ANALYSIS BENCHMARKS
// ============================================================================

describe('Wikipedia hub/authority analysis', () => {
  describe('degree centrality', () => {
    it('calculate outdegree (authority)', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-outdegree',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/degree/out`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Outdegree Calculation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS / 2)
    })

    it('calculate indegree (hub)', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-indegree',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = HUB_ARTICLES[i % HUB_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/degree/in`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Indegree Calculation (Hub Articles) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS / 2)
    })
  })

  describe('PageRank-like analysis', () => {
    it('compute local PageRank (neighborhood)', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-local-pagerank',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/analysis/local-pagerank', {
            method: 'POST',
            body: JSON.stringify({
              seed: article,
              hops: 2,
              iterations: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Local PageRank (2-hop neighborhood) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HUB_AUTHORITY_P95_MS)
    })

    it('find top hubs in category', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-top-hubs',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request('/graph/analysis/top-hubs', {
            method: 'POST',
            body: JSON.stringify({
              category,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Top Hubs in Category ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HUB_AUTHORITY_P95_MS)
    })
  })

  describe('HITS algorithm', () => {
    it('compute hub and authority scores', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-hits',
        target: 'wikipedia.org.ai',
        iterations: 15,
        warmup: 3,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/analysis/hits', {
            method: 'POST',
            body: JSON.stringify({
              seed: article,
              hops: 2,
              iterations: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== HITS Hub/Authority Scores ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HUB_AUTHORITY_P95_MS)
    })
  })
})

// ============================================================================
// ARTICLE SIMILARITY VIA SHARED CATEGORIES/LINKS
// ============================================================================

describe('Wikipedia article similarity', () => {
  describe('category-based similarity', () => {
    it('similarity via shared categories', async () => {
      const result = await benchmark({
        name: 'wikipedia-similarity-category',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 3) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/similarity/category', {
            method: 'POST',
            body: JSON.stringify({
              article1,
              article2,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Category-Based Similarity ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('find similar articles by category overlap', async () => {
      const result = await benchmark({
        name: 'wikipedia-similarity-find',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/graph/article/${encodeURIComponent(article!)}/similar`, {
            method: 'GET',
            headers: {
              'X-Method': 'category',
              'X-Limit': '10',
            },
          })
        },
      })

      record(result)

      console.log('\n=== Find Similar Articles (Category) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })
  })

  describe('link-based similarity', () => {
    it('similarity via shared outbound links', async () => {
      const result = await benchmark({
        name: 'wikipedia-similarity-links-out',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 3) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/similarity/links', {
            method: 'POST',
            body: JSON.stringify({
              article1,
              article2,
              direction: 'outbound',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Link-Based Similarity (Outbound) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('similarity via shared inbound links (co-citation)', async () => {
      const result = await benchmark({
        name: 'wikipedia-similarity-links-in',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 3) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/similarity/links', {
            method: 'POST',
            body: JSON.stringify({
              article1,
              article2,
              direction: 'inbound',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Link-Based Similarity (Co-citation) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })
  })

  describe('combined similarity', () => {
    it('similarity via category + link overlap', async () => {
      const result = await benchmark({
        name: 'wikipedia-similarity-combined',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 3) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/graph/similarity/combined', {
            method: 'POST',
            body: JSON.stringify({
              article1,
              article2,
              weights: {
                category: 0.5,
                outbound: 0.3,
                inbound: 0.2,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Combined Similarity Score ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS * 2)
    })
  })
})

// ============================================================================
// CROSS-PARTITION CATEGORY QUERIES
// ============================================================================

describe('Wikipedia cross-partition graph queries', () => {
  describe('scatter-gather category queries', () => {
    it('find articles by category across partitions', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-scatter-category',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        shardCount: 26,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request('/scatter/graph/category/articles', {
            method: 'POST',
            body: JSON.stringify({
              category,
              partitions: 'all',
              limit: 50,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Partition Category Query (26 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CROSS_PARTITION_P95_MS)
    })

    it('aggregate category counts across partitions', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-scatter-category-count',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        shardCount: 26,
        run: async (ctx, i) => {
          const category = SAMPLE_CATEGORIES[i % SAMPLE_CATEGORIES.length]
          return ctx.do.request('/scatter/graph/category/count', {
            method: 'POST',
            body: JSON.stringify({
              category,
              partitions: 'all',
              includeSubcategories: true,
              maxDepth: 2,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Partition Category Count (with subcategories) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CROSS_PARTITION_P95_MS)
    })
  })

  describe('cross-partition link queries', () => {
    it('find backlinks across partitions', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-scatter-backlinks',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        shardCount: 26,
        run: async (ctx, i) => {
          const article = HUB_ARTICLES[i % HUB_ARTICLES.length]
          return ctx.do.request('/scatter/graph/links/inbound', {
            method: 'POST',
            body: JSON.stringify({
              article,
              partitions: 'all',
              limit: 100,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Partition Backlinks Query ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CROSS_PARTITION_P95_MS)
    })

    it('cross-partition path finding', async () => {
      const result = await benchmark({
        name: 'wikipedia-graph-scatter-path',
        target: 'wikipedia.org.ai',
        iterations: 15,
        warmup: 3,
        shardCount: 26,
        run: async (ctx, i) => {
          const pair = ARTICLE_PAIRS[i % ARTICLE_PAIRS.length]
          return ctx.do.request('/scatter/graph/path', {
            method: 'POST',
            body: JSON.stringify({
              from: pair!.from,
              to: pair!.to,
              maxDepth: 4,
              partitions: 'all',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Cross-Partition Path Finding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PATH_FINDING_P95_MS * 1.5)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikipedia Graph Summary', () => {
  it('should document graph performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIPEDIA GRAPH PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Category traversal: <${MAX_CATEGORY_TRAVERSAL_P95_MS}ms (p95)`)
    console.log(`  - Link graph query: <${MAX_LINK_GRAPH_QUERY_P95_MS}ms (p95)`)
    console.log(`  - Path finding: <${MAX_PATH_FINDING_P95_MS}ms (p95)`)
    console.log(`  - Hub/authority analysis: <${MAX_HUB_AUTHORITY_P95_MS}ms (p95)`)
    console.log('')

    console.log('Graph characteristics:')
    console.log('  - Categories: ~2,000,000 nodes (DAG)')
    console.log('  - Internal links: ~200,000,000+ edges')
    console.log('  - Average outdegree: 30-50 links/article')
    console.log('  - Average indegree: 10-30 backlinks/article')
    console.log('')

    console.log('Query patterns:')
    console.log('  - Category traversal: Parent/child hierarchy')
    console.log('  - Link navigation: Outbound/inbound edges')
    console.log('  - Path finding: BFS, bidirectional BFS')
    console.log('  - Centrality: Degree, PageRank, HITS')
    console.log('  - Similarity: Category/link overlap')
    console.log('')

    console.log('Optimization strategies:')
    console.log('  - Depth limits on traversals')
    console.log('  - Bidirectional search for paths')
    console.log('  - Local algorithms for centrality')
    console.log('  - Partition-targeted queries')
    console.log('  - Edge index for fast lookups')
    console.log('')

    console.log('Cross-partition patterns:')
    console.log('  - Scatter-gather for global queries')
    console.log('  - Category routing by article prefix')
    console.log('  - Parallel path exploration')
    console.log('  - Aggregation at coordinator')
    console.log('')

    expect(true).toBe(true)
  })
})
