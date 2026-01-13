/**
 * Wikipedia Query Performance Benchmarks
 *
 * Tests query performance against the ~6M article English Wikipedia dataset.
 * Validates scalability claims for article lookups, full-text search,
 * structured infobox queries, category traversal, and link navigation.
 *
 * Performance targets:
 * - Article lookup: <100ms (p95)
 * - Full-text search: <500ms (p95)
 * - Category traversal: <200ms (p95)
 * - Link graph query: <300ms (p95)
 *
 * Target endpoints:
 * - wikipedia.org.ai - Main Wikipedia API
 * - {letter}.wikipedia.org.ai - Per-partition endpoints (a-z)
 *
 * @see workers/wikipedia-api.ts for API implementation
 * @see dotdo-ymo5u for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for article lookup (ms)
 */
const MAX_ARTICLE_LOOKUP_P95_MS = 100

/**
 * Maximum acceptable p95 latency for full-text search (ms)
 */
const MAX_FULLTEXT_SEARCH_P95_MS = 500

/**
 * Maximum acceptable p95 latency for category traversal (ms)
 */
const MAX_CATEGORY_TRAVERSAL_P95_MS = 200

/**
 * Maximum acceptable p95 latency for link graph query (ms)
 */
const MAX_LINK_GRAPH_QUERY_P95_MS = 300

/**
 * Maximum acceptable p95 for structured infobox query (ms)
 */
const MAX_INFOBOX_QUERY_P95_MS = 150

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 100

/**
 * Warmup iterations for cache population
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Famous Wikipedia articles for point lookup testing
 */
const FAMOUS_ARTICLES = [
  'United States', 'World War II', 'Albert Einstein', 'The Beatles',
  'DNA', 'Solar System', 'William Shakespeare', 'Climate change',
  'Python (programming language)', 'Artificial intelligence',
  'New York City', 'Barack Obama', 'Google', 'Apple Inc.',
  'Mount Everest', 'Amazon (company)', 'COVID-19 pandemic',
  'Internet', 'Facebook', 'Television',
]

/**
 * Technical/computing articles
 */
const TECH_ARTICLES = [
  'Computer science', 'Algorithm', 'Data structure', 'Machine learning',
  'Neural network', 'Database', 'Operating system', 'Programming language',
  'Compiler', 'HTTP', 'TCP/IP', 'JavaScript', 'TypeScript',
  'Kubernetes', 'Docker (software)', 'Git', 'Linux', 'Unix',
  'Cryptography', 'Quantum computing',
]

/**
 * Articles with rich infoboxes
 */
const INFOBOX_RICH_ARTICLES = [
  'Microsoft', 'Google', 'Apple Inc.', 'Amazon (company)',
  'Tesla, Inc.', 'Meta Platforms', 'Netflix', 'Adobe Inc.',
  'Salesforce', 'Oracle Corporation',
]

/**
 * Categories for traversal testing
 */
const TEST_CATEGORIES = [
  'Category:Computer science',
  'Category:American companies',
  'Category:Programming languages',
  'Category:Internet companies',
  'Category:Technology companies',
  'Category:Free and open-source software',
  'Category:Cloud computing',
  'Category:Machine learning',
]

/**
 * Search queries for full-text search
 */
const SEARCH_QUERIES = [
  'machine learning algorithms',
  'artificial intelligence applications',
  'software development lifecycle',
  'distributed computing systems',
  'data structures and algorithms',
  'computer programming paradigms',
  'web development frameworks',
  'database management systems',
  'cloud computing platforms',
  'cybersecurity best practices',
]

/**
 * Infobox query templates
 */
const INFOBOX_QUERIES = [
  { template: 'company', field: 'industry', value: 'Technology' },
  { template: 'company', field: 'founder', value: 'contains:Gates' },
  { template: 'software', field: 'programming_language', value: 'TypeScript' },
  { template: 'person', field: 'occupation', value: 'Entrepreneur' },
  { template: 'country', field: 'gdp', value: 'range:1000000000000,*' },
]

// ============================================================================
// ARTICLE LOOKUP BENCHMARKS
// ============================================================================

describe('Wikipedia article lookups', () => {
  describe('single article lookup', () => {
    it('lookup famous Wikipedia articles', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-famous',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 6_000_000,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Famous Article Lookup (6M dataset) ===')
      console.log(`  Dataset size: ~6,000,000 articles`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
      console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })

    it('lookup technical articles', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-technical',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 6_000_000,
        run: async (ctx, i) => {
          const title = TECH_ARTICLES[i % TECH_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Technical Article Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })

    it('lookup via partition endpoint', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-partition-targeted',
        target: 'a.wikipedia.org.ai', // Target 'a' partition directly
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const aArticles = ['Algorithm', 'Artificial intelligence', 'Amazon (company)', 'Apple Inc.', 'Adobe Inc.']
          const title = aArticles[i % aArticles.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Partition-Targeted Lookup (a.wikipedia.org.ai) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Direct partition access should be faster
      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS * 0.8)
    })
  })

  describe('article content retrieval', () => {
    it('retrieve article with full content', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-full-content',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}?include=content,infobox,categories,links`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Full Article Content Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Full content retrieval may be slower
      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS * 2)
    })

    it('retrieve article summary only', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-summary',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/summary`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Article Summary Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })

    it('retrieve specific article sections', async () => {
      const result = await benchmark({
        name: 'wikipedia-lookup-sections',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/sections?names=Overview,History`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Article Sections Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })
  })

  describe('cold vs warm lookups', () => {
    it('verifies caching benefit', async () => {
      const testArticle = 'Machine learning'
      const timestamp = Date.now()

      // Cold lookup (bypass cache)
      const cold = await benchmark({
        name: 'wikipedia-lookup-cold',
        target: `wikipedia-cold-${timestamp}.org.ai`,
        iterations: 20,
        warmup: 0,
        run: async (ctx) =>
          ctx.do.request(`/article/${encodeURIComponent(testArticle)}?cache=bypass`, {
            method: 'GET',
          }),
      })

      // Warm lookup (use cache)
      const warm = await benchmark({
        name: 'wikipedia-lookup-warm',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx) =>
          ctx.do.request(`/article/${encodeURIComponent(testArticle)}`, {
            method: 'GET',
          }),
      })

      record([cold, warm])

      const cacheBenefit = cold.stats.p50 - warm.stats.p50

      console.log('\n=== Lookup Caching Benefit ===')
      console.log(`  Cold p50: ${cold.stats.p50.toFixed(3)} ms`)
      console.log(`  Warm p50: ${warm.stats.p50.toFixed(3)} ms`)
      console.log(`  Cache benefit: ${cacheBenefit.toFixed(3)} ms`)

      expect(cacheBenefit).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// FULL-TEXT SEARCH BENCHMARKS
// ============================================================================

describe('Wikipedia full-text search', () => {
  describe('article content search', () => {
    it('search across 6M articles - single term', async () => {
      const terms = ['algorithm', 'democracy', 'evolution', 'quantum', 'economy', 'biology', 'philosophy', 'technology']

      const result = await benchmark({
        name: 'wikipedia-search-single-term',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 6_000_000,
        run: async (ctx, i) => {
          const term = terms[i % terms.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: term,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Full-Text Search (Single Term, 6M articles) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })

    it('search with multi-word query', async () => {
      const result = await benchmark({
        name: 'wikipedia-search-multi-word',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 6_000_000,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Full-Text Search (Multi-word) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })

    it('search with phrase query', async () => {
      const phrases = [
        '"machine learning"',
        '"artificial intelligence"',
        '"climate change"',
        '"computer science"',
        '"software engineering"',
      ]

      const result = await benchmark({
        name: 'wikipedia-search-phrase',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const phrase = phrases[i % phrases.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: phrase,
              mode: 'phrase',
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Full-Text Search (Phrase) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })
  })

  describe('search result limit scaling', () => {
    it('measure latency vs result limit', async () => {
      const limits = [10, 25, 50, 100, 200]
      const results: Array<{ limit: number; p50: number }> = []

      for (const limit of limits) {
        const result = await benchmark({
          name: `wikipedia-search-limit-${limit}`,
          target: 'wikipedia.org.ai',
          iterations: 30,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/search', {
              method: 'POST',
              body: JSON.stringify({
                query: 'computer science',
                limit,
              }),
            }),
        })

        results.push({
          limit,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Search Latency by Result Limit ===')
      console.log('  Limit | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.limit).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Latency should scale sub-linearly
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(5)
    })
  })

  describe('filtered search', () => {
    it('search with category filter', async () => {
      const result = await benchmark({
        name: 'wikipedia-search-category-filter',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const category = TEST_CATEGORIES[i % TEST_CATEGORIES.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'software',
              filter: { category },
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Search with Category Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })

    it('search with date range filter', async () => {
      const result = await benchmark({
        name: 'wikipedia-search-date-filter',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx) =>
          ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'technology',
              filter: {
                lastModified: {
                  gte: '2024-01-01',
                  lte: '2024-12-31',
                },
              },
              limit: 20,
            }),
          }),
      })

      record(result)

      console.log('\n=== Search with Date Range Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })
  })
})

// ============================================================================
// STRUCTURED INFOBOX QUERY BENCHMARKS
// ============================================================================

describe('Wikipedia structured infobox queries', () => {
  describe('infobox field queries', () => {
    it('query articles by infobox template', async () => {
      const templates = ['company', 'software', 'person', 'country', 'university']

      const result = await benchmark({
        name: 'wikipedia-infobox-by-template',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const template = templates[i % templates.length]
          return ctx.do.request('/query/infobox', {
            method: 'POST',
            body: JSON.stringify({
              template,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Infobox Query by Template ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_INFOBOX_QUERY_P95_MS)
    })

    it('query infobox field with exact match', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-exact-match',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const query = INFOBOX_QUERIES[i % INFOBOX_QUERIES.length]
          return ctx.do.request('/query/infobox', {
            method: 'POST',
            body: JSON.stringify({
              template: query!.template,
              where: {
                [query!.field]: query!.value,
              },
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Infobox Query Exact Match ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_INFOBOX_QUERY_P95_MS)
    })

    it('retrieve infobox for specific articles', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-retrieve',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = INFOBOX_RICH_ARTICLES[i % INFOBOX_RICH_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/infobox`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Infobox Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })
  })

  describe('combined structured + unstructured queries', () => {
    it('full-text search with infobox filter', async () => {
      const result = await benchmark({
        name: 'wikipedia-combined-search-infobox',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) =>
          ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'cloud computing',
              filter: {
                infobox: {
                  template: 'company',
                  industry: 'contains:Technology',
                },
              },
              limit: 20,
            }),
          }),
      })

      record(result)

      console.log('\n=== Combined Search + Infobox Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Combined query may be slower
      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS * 1.5)
    })

    it('aggregate infobox statistics', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-aggregate',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.do.request('/query/infobox/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              template: 'company',
              groupBy: 'industry',
              aggregate: 'count',
              limit: 50,
            }),
          }),
      })

      record(result)

      console.log('\n=== Infobox Aggregation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })
  })
})

// ============================================================================
// CATEGORY TRAVERSAL BENCHMARKS
// ============================================================================

describe('Wikipedia category traversal', () => {
  describe('category membership', () => {
    it('list articles in category', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-articles',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const category = TEST_CATEGORIES[i % TEST_CATEGORIES.length]
          return ctx.do.request(`/category/${encodeURIComponent(category!)}/articles`, {
            method: 'GET',
            headers: { 'X-Limit': '50' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Articles Listing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('get categories for article', async () => {
      const result = await benchmark({
        name: 'wikipedia-article-categories',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/categories`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Article Categories Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })
  })

  describe('category hierarchy', () => {
    it('traverse category parents', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-parents',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const category = TEST_CATEGORIES[i % TEST_CATEGORIES.length]
          return ctx.do.request(`/category/${encodeURIComponent(category!)}/parents`, {
            method: 'GET',
            headers: { 'X-Depth': '3' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Parent Traversal (depth 3) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('traverse category children', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-children',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const category = TEST_CATEGORIES[i % TEST_CATEGORIES.length]
          return ctx.do.request(`/category/${encodeURIComponent(category!)}/children`, {
            method: 'GET',
            headers: { 'X-Depth': '2' },
          })
        },
      })

      record(result)

      console.log('\n=== Category Children Traversal (depth 2) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS)
    })

    it('measure traversal depth scaling', async () => {
      const depths = [1, 2, 3, 4, 5]
      const results: Array<{ depth: number; p50: number }> = []

      for (const depth of depths) {
        const result = await benchmark({
          name: `wikipedia-category-depth-${depth}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/category/Category%3AComputer%20science/children', {
              method: 'GET',
              headers: { 'X-Depth': String(depth) },
            }),
        })

        results.push({
          depth,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Category Traversal Depth Scaling ===')
      console.log('  Depth | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.depth).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Deeper traversals should be slower but manageable
      expect(results[results.length - 1]!.p50).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })
  })

  describe('cross-partition category queries', () => {
    it('find articles by category across partitions', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-cross-partition',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        shardCount: 26,
        run: async (ctx, i) => {
          const category = TEST_CATEGORIES[i % TEST_CATEGORIES.length]
          return ctx.do.request('/scatter/category/articles', {
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

      expect(result.stats.p95).toBeLessThan(MAX_CATEGORY_TRAVERSAL_P95_MS * 2)
    })
  })
})

// ============================================================================
// LINK GRAPH NAVIGATION BENCHMARKS
// ============================================================================

describe('Wikipedia link graph navigation', () => {
  describe('outbound links', () => {
    it('get articles linked from page', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-outbound',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/links/outbound`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Outbound Links Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('get top linked articles', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-outbound-top',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/links/outbound?limit=50&sort=popularity`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Top Outbound Links (by popularity) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })
  })

  describe('inbound links', () => {
    it('get articles linking to page', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-inbound',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/links/inbound`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Inbound Links Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS)
    })

    it('count inbound links (backlinks)', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-inbound-count',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const title = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/links/inbound/count`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Inbound Link Count ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ARTICLE_LOOKUP_P95_MS)
    })
  })

  describe('link graph queries', () => {
    it('find common links between articles', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-common',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const article1 = FAMOUS_ARTICLES[i % FAMOUS_ARTICLES.length]
          const article2 = FAMOUS_ARTICLES[(i + 5) % FAMOUS_ARTICLES.length]
          return ctx.do.request('/query/links/common', {
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

    it('two-hop link expansion', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-two-hop',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const title = TECH_ARTICLES[i % TECH_ARTICLES.length]
          return ctx.do.request(`/article/${encodeURIComponent(title!)}/links/expand`, {
            method: 'GET',
            headers: { 'X-Depth': '2', 'X-Limit': '20' },
          })
        },
      })

      record(result)

      console.log('\n=== Two-Hop Link Expansion ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_LINK_GRAPH_QUERY_P95_MS * 2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikipedia Query Summary', () => {
  it('should document query performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIPEDIA QUERY PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Article lookup: <${MAX_ARTICLE_LOOKUP_P95_MS}ms (p95)`)
    console.log(`  - Full-text search: <${MAX_FULLTEXT_SEARCH_P95_MS}ms (p95)`)
    console.log(`  - Category traversal: <${MAX_CATEGORY_TRAVERSAL_P95_MS}ms (p95)`)
    console.log(`  - Link graph query: <${MAX_LINK_GRAPH_QUERY_P95_MS}ms (p95)`)
    console.log('')

    console.log('Dataset characteristics:')
    console.log('  - Total articles: ~6,000,000 (English)')
    console.log('  - Infoboxes: ~3,000,000 structured records')
    console.log('  - Internal links: ~200,000,000+ edges')
    console.log('  - Categories: ~2,000,000 nodes')
    console.log('')

    console.log('Query patterns:')
    console.log('  - Point lookup: Article by title')
    console.log('  - Full-text: Search article content')
    console.log('  - Structured: Infobox field queries')
    console.log('  - Graph: Category/link traversal')
    console.log('  - Combined: Text + structured filters')
    console.log('')

    console.log('Optimization strategies:')
    console.log('  - Partition targeting: Route by title prefix')
    console.log('  - Response caching: SQLite + LRU')
    console.log('  - Inverted index: Full-text search')
    console.log('  - Graph index: Link/category edges')
    console.log('  - Infobox index: Structured fields')
    console.log('')

    expect(true).toBe(true)
  })
})
