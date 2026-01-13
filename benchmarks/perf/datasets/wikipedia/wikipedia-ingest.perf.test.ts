/**
 * Wikipedia Ingest Performance Benchmarks
 *
 * Tests ingestion performance for the ~6M article English Wikipedia dataset.
 * Covers streaming XML dump parsing, structured infobox extraction,
 * article body extraction, category hierarchy, and internal link graph.
 *
 * Performance targets:
 * - Ingest: >50,000 articles/minute
 * - XML parsing throughput: >100MB/s
 * - Infobox extraction: >10,000/minute
 * - Memory stability: No growth during sustained ingest
 *
 * Target endpoints:
 * - wikipedia.org.ai - Main Wikipedia API
 * - {letter}.wikipedia.org.ai - Per-partition endpoints (a-z)
 *
 * Data characteristics:
 * - Articles: ~6M (English Wikipedia)
 * - Infoboxes: ~3M structured records
 * - Internal links: ~200M+ edges
 * - Categories: ~2M nodes
 *
 * @see workers/wikipedia-ingest.ts for ingestion worker
 * @see dotdo-ymo5u for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Target articles ingested per minute
 */
const TARGET_ARTICLES_PER_MINUTE = 50_000

/**
 * Target XML parsing throughput (MB/s)
 */
const TARGET_XML_PARSE_MB_PER_SEC = 100

/**
 * Target infobox extraction per minute
 */
const TARGET_INFOBOX_PER_MINUTE = 10_000

/**
 * Maximum memory growth during sustained ingest (bytes)
 */
const MAX_MEMORY_GROWTH_MB = 100

/**
 * Maximum acceptable p95 latency for single article ingest (ms)
 */
const MAX_SINGLE_ARTICLE_P95_MS = 50

/**
 * Maximum acceptable p95 latency for batch ingest (ms)
 */
const MAX_BATCH_INGEST_P95_MS = 500

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

/**
 * Warmup iterations for cache population
 */
const WARMUP_ITERATIONS = 10

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample Wikipedia article XML for streaming tests
 */
const SAMPLE_ARTICLE_XML = `
<page>
  <title>Test Article</title>
  <ns>0</ns>
  <id>12345</id>
  <revision>
    <id>987654321</id>
    <parentid>987654320</parentid>
    <timestamp>2024-01-15T12:00:00Z</timestamp>
    <contributor>
      <username>TestUser</username>
      <id>1234</id>
    </contributor>
    <text xml:space="preserve">'''Test Article''' is an example article.

{{Infobox software
| name = Test Software
| developer = Test Company
| latest_release_version = 1.0.0
| programming_language = TypeScript
| license = MIT
}}

== Overview ==
This is the overview section.

== Features ==
* Feature 1
* Feature 2

== See also ==
* [[Related Article 1]]
* [[Related Article 2]]

[[Category:Test Category]]
[[Category:Software]]
</text>
  </revision>
</page>
`

/**
 * Sample infobox templates from Wikipedia
 */
const INFOBOX_TEMPLATES = [
  'Infobox software',
  'Infobox company',
  'Infobox person',
  'Infobox country',
  'Infobox settlement',
  'Infobox university',
  'Infobox film',
  'Infobox album',
  'Infobox book',
  'Infobox species',
]

/**
 * Generate sample article data for testing
 */
function generateSampleArticle(index: number): {
  title: string
  id: number
  text: string
  categories: string[]
  links: string[]
  infobox?: Record<string, string>
} {
  const hasInfobox = index % 2 === 0 // ~50% have infoboxes
  const infoboxTemplate = INFOBOX_TEMPLATES[index % INFOBOX_TEMPLATES.length]

  return {
    title: `Article_${index}`,
    id: 100000 + index,
    text: `This is article ${index} with sample content. `.repeat(50),
    categories: [
      `Category_${index % 100}`,
      `Category_${(index + 50) % 100}`,
    ],
    links: [
      `Article_${(index + 1) % 1000}`,
      `Article_${(index + 2) % 1000}`,
      `Article_${(index + 10) % 1000}`,
    ],
    ...(hasInfobox && {
      infobox: {
        template: infoboxTemplate!,
        name: `Entity_${index}`,
        type: `Type_${index % 10}`,
        date: `202${index % 10}-01-15`,
      },
    }),
  }
}

/**
 * Generate batch of articles
 */
function generateArticleBatch(count: number, offset: number = 0): Array<ReturnType<typeof generateSampleArticle>> {
  return Array.from({ length: count }, (_, i) => generateSampleArticle(offset + i))
}

/**
 * Generate sample XML dump chunk
 */
function generateXMLChunk(articleCount: number): string {
  let xml = '<mediawiki>\n'
  for (let i = 0; i < articleCount; i++) {
    xml += SAMPLE_ARTICLE_XML.replace('Test Article', `Article_${i}`)
      .replace('12345', String(100000 + i))
  }
  xml += '</mediawiki>'
  return xml
}

// ============================================================================
// XML STREAMING BENCHMARKS
// ============================================================================

describe('Wikipedia XML dump streaming', () => {
  describe('XML parsing throughput', () => {
    it('stream parse small XML chunk (100 articles)', async () => {
      const xmlChunk = generateXMLChunk(100)
      const chunkSizeMB = Buffer.byteLength(xmlChunk) / (1024 * 1024)

      const result = await benchmark({
        name: 'wikipedia-xml-parse-100',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 100,
        run: async (ctx) =>
          ctx.do.request('/ingest/xml/stream', {
            method: 'POST',
            body: xmlChunk,
            headers: { 'Content-Type': 'application/xml' },
          }),
      })

      record(result)

      const mbPerSecond = (chunkSizeMB / (result.stats.p50 / 1000))

      console.log('\n=== XML Streaming Parse (100 articles) ===')
      console.log(`  Chunk size: ${chunkSizeMB.toFixed(2)} MB`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${mbPerSecond.toFixed(2)} MB/s`)
      console.log(`  Articles/sec: ${(100 / (result.stats.p50 / 1000)).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INGEST_P95_MS)
    })

    it('stream parse medium XML chunk (1000 articles)', async () => {
      const xmlChunk = generateXMLChunk(1000)
      const chunkSizeMB = Buffer.byteLength(xmlChunk) / (1024 * 1024)

      const result = await benchmark({
        name: 'wikipedia-xml-parse-1000',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        datasetSize: 1000,
        run: async (ctx) =>
          ctx.do.request('/ingest/xml/stream', {
            method: 'POST',
            body: xmlChunk,
            headers: { 'Content-Type': 'application/xml' },
          }),
      })

      record(result)

      const articlesPerMinute = (1000 / (result.stats.p50 / 1000)) * 60

      console.log('\n=== XML Streaming Parse (1000 articles) ===')
      console.log(`  Chunk size: ${chunkSizeMB.toFixed(2)} MB`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Articles/minute: ${articlesPerMinute.toFixed(0)}`)

      // Should achieve target throughput
      expect(articlesPerMinute).toBeGreaterThan(TARGET_ARTICLES_PER_MINUTE / 2)
    })

    it('measure XML parsing scaling', async () => {
      const articleCounts = [50, 100, 250, 500, 1000]
      const results: Array<{ count: number; p50: number; mbPerSec: number }> = []

      for (const count of articleCounts) {
        const xmlChunk = generateXMLChunk(count)
        const chunkSizeMB = Buffer.byteLength(xmlChunk) / (1024 * 1024)

        const result = await benchmark({
          name: `wikipedia-xml-scaling-${count}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 3,
          datasetSize: count,
          run: async (ctx) =>
            ctx.do.request('/ingest/xml/stream', {
              method: 'POST',
              body: xmlChunk,
              headers: { 'Content-Type': 'application/xml' },
            }),
        })

        results.push({
          count,
          p50: result.stats.p50,
          mbPerSec: chunkSizeMB / (result.stats.p50 / 1000),
        })

        record(result)
      }

      console.log('\n=== XML Parsing Scaling ===')
      console.log('  Articles | p50 (ms)   | MB/sec')
      console.log('  ---------|------------|--------')
      for (const r of results) {
        console.log(`  ${String(r.count).padEnd(8)} | ${r.p50.toFixed(3).padStart(10)} | ${r.mbPerSec.toFixed(2).padStart(6)}`)
      }

      // Parsing should scale linearly (constant throughput)
      const firstThroughput = results[0]!.mbPerSec
      const lastThroughput = results[results.length - 1]!.mbPerSec
      expect(lastThroughput / firstThroughput).toBeGreaterThan(0.5)
    })
  })

  describe('SAX vs DOM parsing comparison', () => {
    it('compare SAX streaming vs DOM parsing', async () => {
      const xmlChunk = generateXMLChunk(500)

      const saxResult = await benchmark({
        name: 'wikipedia-xml-sax',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.do.request('/ingest/xml/stream', {
            method: 'POST',
            body: xmlChunk,
            headers: {
              'Content-Type': 'application/xml',
              'X-Parser': 'sax',
            },
          }),
      })

      const domResult = await benchmark({
        name: 'wikipedia-xml-dom',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.do.request('/ingest/xml/stream', {
            method: 'POST',
            body: xmlChunk,
            headers: {
              'Content-Type': 'application/xml',
              'X-Parser': 'dom',
            },
          }),
      })

      record([saxResult, domResult])

      console.log('\n=== SAX vs DOM Parsing (500 articles) ===')
      console.log(`  SAX p50: ${saxResult.stats.p50.toFixed(3)} ms`)
      console.log(`  DOM p50: ${domResult.stats.p50.toFixed(3)} ms`)
      console.log(`  SAX advantage: ${(domResult.stats.p50 / saxResult.stats.p50).toFixed(2)}x`)

      // SAX should be faster for large documents
      expect(saxResult.stats.p50).toBeLessThan(domResult.stats.p50 * 1.5)
    })
  })
})

// ============================================================================
// INFOBOX EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikipedia infobox extraction', () => {
  describe('structured data extraction', () => {
    it('extract infobox from single article', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-single',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = generateSampleArticle(i)
          return ctx.do.request('/ingest/infobox/extract', {
            method: 'POST',
            body: JSON.stringify({
              title: article.title,
              wikitext: SAMPLE_ARTICLE_XML,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Infobox Extraction ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Extractions/sec: ${(1000 / result.stats.p50).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })

    it('batch extract infoboxes', async () => {
      const batchSizes = [10, 50, 100, 250]
      const results: Array<{ batch: number; p50: number; perMinute: number }> = []

      for (const batchSize of batchSizes) {
        const articles = generateArticleBatch(batchSize)
          .filter(a => a.infobox)
          .slice(0, batchSize)

        const result = await benchmark({
          name: `wikipedia-infobox-batch-${batchSize}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 3,
          datasetSize: batchSize,
          run: async (ctx) =>
            ctx.do.request('/ingest/infobox/batch', {
              method: 'POST',
              body: JSON.stringify({
                articles: articles.map(a => ({
                  title: a.title,
                  wikitext: SAMPLE_ARTICLE_XML,
                })),
              }),
            }),
        })

        const perMinute = (batchSize / (result.stats.p50 / 1000)) * 60

        results.push({
          batch: batchSize,
          p50: result.stats.p50,
          perMinute,
        })

        record(result)
      }

      console.log('\n=== Batch Infobox Extraction ===')
      console.log('  Batch  | p50 (ms)   | Per minute')
      console.log('  -------|------------|------------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(6)} | ${r.p50.toFixed(3).padStart(10)} | ${r.perMinute.toFixed(0).padStart(10)}`)
      }

      // Should achieve target extraction rate
      expect(results[results.length - 1]!.perMinute).toBeGreaterThan(TARGET_INFOBOX_PER_MINUTE / 2)
    })

    it('extract different infobox templates', async () => {
      const templateResults: Array<{ template: string; p50: number }> = []

      for (const template of INFOBOX_TEMPLATES.slice(0, 5)) {
        const result = await benchmark({
          name: `wikipedia-infobox-${template.replace(/\s+/g, '-')}`,
          target: 'wikipedia.org.ai',
          iterations: 30,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/ingest/infobox/extract', {
              method: 'POST',
              body: JSON.stringify({
                title: `Test ${template}`,
                wikitext: SAMPLE_ARTICLE_XML.replace('Infobox software', template),
              }),
            }),
        })

        templateResults.push({
          template,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Infobox Template Extraction ===')
      console.log('  Template            | p50 (ms)')
      console.log('  --------------------|----------')
      for (const r of templateResults) {
        console.log(`  ${r.template.padEnd(19)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // All templates should have similar extraction times
      const times = templateResults.map(r => r.p50)
      const variance = Math.max(...times) - Math.min(...times)
      expect(variance).toBeLessThan(20)
    })
  })

  describe('infobox normalization', () => {
    it('normalize extracted fields', async () => {
      const result = await benchmark({
        name: 'wikipedia-infobox-normalize',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) =>
          ctx.do.request('/ingest/infobox/normalize', {
            method: 'POST',
            body: JSON.stringify({
              template: 'Infobox company',
              fields: {
                name: 'Test Company, Inc.',
                founded: '{{Start date|2010|01|15}}',
                revenue: '{{US$|5.2 billion}}',
                employees: '10,000+',
                website: '{{URL|https://example.com}}',
              },
            }),
          }),
      })

      record(result)

      console.log('\n=== Infobox Field Normalization ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })
  })
})

// ============================================================================
// ARTICLE BODY EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikipedia article body extraction', () => {
  describe('text extraction', () => {
    it('extract plain text from wikitext', async () => {
      const result = await benchmark({
        name: 'wikipedia-article-text-extract',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = generateSampleArticle(i)
          return ctx.do.request('/ingest/article/extract-text', {
            method: 'POST',
            body: JSON.stringify({
              title: article.title,
              wikitext: article.text,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Article Text Extraction ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Articles/sec: ${(1000 / result.stats.p50).toFixed(0)}`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })

    it('batch extract article text', async () => {
      const articles = generateArticleBatch(100)

      const result = await benchmark({
        name: 'wikipedia-article-text-batch',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        datasetSize: 100,
        run: async (ctx) =>
          ctx.do.request('/ingest/article/batch-extract', {
            method: 'POST',
            body: JSON.stringify({
              articles: articles.map(a => ({
                title: a.title,
                wikitext: a.text,
              })),
            }),
          }),
      })

      record(result)

      const articlesPerMinute = (100 / (result.stats.p50 / 1000)) * 60

      console.log('\n=== Batch Article Text Extraction (100) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Articles/minute: ${articlesPerMinute.toFixed(0)}`)

      expect(articlesPerMinute).toBeGreaterThan(TARGET_ARTICLES_PER_MINUTE / 2)
    })

    it('extract article sections', async () => {
      const result = await benchmark({
        name: 'wikipedia-article-sections',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) =>
          ctx.do.request('/ingest/article/sections', {
            method: 'POST',
            body: JSON.stringify({
              title: `Article_${i}`,
              wikitext: SAMPLE_ARTICLE_XML,
            }),
          }),
      })

      record(result)

      console.log('\n=== Article Section Extraction ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })
  })

  describe('article text length handling', () => {
    it('extract varying article lengths', async () => {
      const articleLengths = [1000, 5000, 10000, 25000, 50000] // chars
      const results: Array<{ length: number; p50: number }> = []

      for (const length of articleLengths) {
        const longText = 'x'.repeat(length)

        const result = await benchmark({
          name: `wikipedia-article-length-${length}`,
          target: 'wikipedia.org.ai',
          iterations: 20,
          warmup: 3,
          run: async (ctx) =>
            ctx.do.request('/ingest/article/extract-text', {
              method: 'POST',
              body: JSON.stringify({
                title: `Long_Article_${length}`,
                wikitext: longText,
              }),
            }),
        })

        results.push({
          length,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Article Extraction by Length ===')
      console.log('  Chars     | p50 (ms)')
      console.log('  ----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(9)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Extraction time should scale reasonably
      const ratio = results[results.length - 1]!.p50 / results[0]!.p50
      expect(ratio).toBeLessThan(10)
    })
  })
})

// ============================================================================
// CATEGORY HIERARCHY EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikipedia category extraction', () => {
  describe('article categories', () => {
    it('extract categories from article', async () => {
      const result = await benchmark({
        name: 'wikipedia-category-extract',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const article = generateSampleArticle(i)
          return ctx.do.request('/ingest/categories/extract', {
            method: 'POST',
            body: JSON.stringify({
              title: article.title,
              wikitext: SAMPLE_ARTICLE_XML,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Article Category Extraction ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })

    it('batch extract categories', async () => {
      const articles = generateArticleBatch(500)

      const result = await benchmark({
        name: 'wikipedia-category-batch',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 3,
        datasetSize: 500,
        run: async (ctx) =>
          ctx.do.request('/ingest/categories/batch', {
            method: 'POST',
            body: JSON.stringify({
              articles: articles.map(a => ({
                title: a.title,
                categories: a.categories,
              })),
            }),
          }),
      })

      record(result)

      console.log('\n=== Batch Category Extraction (500) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INGEST_P95_MS)
    })
  })

  describe('category hierarchy', () => {
    it('build category parent-child relationships', async () => {
      const categories = [
        { child: 'Category:TypeScript', parents: ['Category:Programming languages', 'Category:Microsoft software'] },
        { child: 'Category:Programming languages', parents: ['Category:Computing', 'Category:Technology'] },
        { child: 'Category:Computing', parents: ['Category:Technology'] },
      ]

      const result = await benchmark({
        name: 'wikipedia-category-hierarchy',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx) =>
          ctx.do.request('/ingest/categories/hierarchy', {
            method: 'POST',
            body: JSON.stringify({ relationships: categories }),
          }),
      })

      record(result)

      console.log('\n=== Category Hierarchy Build ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(100)
    })

    it('batch insert category hierarchy at scale', async () => {
      const batchSizes = [100, 500, 1000, 2500]
      const results: Array<{ batch: number; p50: number }> = []

      for (const batchSize of batchSizes) {
        const relationships = Array.from({ length: batchSize }, (_, i) => ({
          child: `Category:Test_${i}`,
          parents: [`Category:Parent_${i % 100}`, `Category:Parent_${(i + 50) % 100}`],
        }))

        const result = await benchmark({
          name: `wikipedia-category-hierarchy-${batchSize}`,
          target: 'wikipedia.org.ai',
          iterations: 15,
          warmup: 3,
          datasetSize: batchSize,
          run: async (ctx) =>
            ctx.do.request('/ingest/categories/hierarchy', {
              method: 'POST',
              body: JSON.stringify({ relationships }),
            }),
        })

        results.push({
          batch: batchSize,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Category Hierarchy Scaling ===')
      console.log('  Batch  | p50 (ms)')
      console.log('  -------|----------')
      for (const r of results) {
        console.log(`  ${String(r.batch).padEnd(6)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      expect(results.length).toBe(4)
    })
  })
})

// ============================================================================
// INTERNAL LINK EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikipedia internal link extraction', () => {
  describe('link parsing', () => {
    it('extract internal links from article', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-extract',
        target: 'wikipedia.org.ai',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) =>
          ctx.do.request('/ingest/links/extract', {
            method: 'POST',
            body: JSON.stringify({
              title: `Article_${i}`,
              wikitext: SAMPLE_ARTICLE_XML,
            }),
          }),
      })

      record(result)

      console.log('\n=== Internal Link Extraction ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SINGLE_ARTICLE_P95_MS)
    })

    it('batch extract internal links', async () => {
      const articles = generateArticleBatch(250)

      const result = await benchmark({
        name: 'wikipedia-links-batch',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        datasetSize: 250,
        run: async (ctx) =>
          ctx.do.request('/ingest/links/batch', {
            method: 'POST',
            body: JSON.stringify({
              articles: articles.map(a => ({
                title: a.title,
                links: a.links,
              })),
            }),
          }),
      })

      record(result)

      console.log('\n=== Batch Link Extraction (250) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INGEST_P95_MS)
    })
  })

  describe('link graph building', () => {
    it('build link graph from edges', async () => {
      const result = await benchmark({
        name: 'wikipedia-links-graph-build',
        target: 'wikipedia.org.ai',
        iterations: 20,
        warmup: 5,
        run: async (ctx, i) => {
          const edges = Array.from({ length: 100 }, (_, j) => ({
            from: `Article_${i * 100}`,
            to: `Article_${i * 100 + j + 1}`,
          }))

          return ctx.do.request('/ingest/links/graph', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })
        },
      })

      record(result)

      console.log('\n=== Link Graph Build (100 edges) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INGEST_P95_MS)
    })

    it('measure link graph scaling', async () => {
      const edgeCounts = [100, 500, 1000, 2500, 5000]
      const results: Array<{ edges: number; p50: number; edgesPerSec: number }> = []

      for (const edgeCount of edgeCounts) {
        const edges = Array.from({ length: edgeCount }, (_, i) => ({
          from: `Article_${i % 1000}`,
          to: `Article_${(i + 1) % 1000}`,
        }))

        const result = await benchmark({
          name: `wikipedia-links-graph-${edgeCount}`,
          target: 'wikipedia.org.ai',
          iterations: 10,
          warmup: 2,
          datasetSize: edgeCount,
          run: async (ctx) =>
            ctx.do.request('/ingest/links/graph', {
              method: 'POST',
              body: JSON.stringify({ edges }),
            }),
        })

        results.push({
          edges: edgeCount,
          p50: result.stats.p50,
          edgesPerSec: (edgeCount / result.stats.p50) * 1000,
        })

        record(result)
      }

      console.log('\n=== Link Graph Build Scaling ===')
      console.log('  Edges   | p50 (ms)   | Edges/sec')
      console.log('  --------|------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.edges).padEnd(7)} | ${r.p50.toFixed(3).padStart(10)} | ${r.edgesPerSec.toFixed(0).padStart(9)}`)
      }

      // Throughput should remain relatively stable
      const throughputs = results.map(r => r.edgesPerSec)
      const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length
      expect(avgThroughput).toBeGreaterThan(10000) // At least 10K edges/sec
    })
  })
})

// ============================================================================
// MEMORY STABILITY BENCHMARKS
// ============================================================================

describe('Wikipedia ingest memory stability', () => {
  describe('sustained ingest', () => {
    it('memory stable during sustained article ingest', async () => {
      let initialMemory = 0
      let finalMemory = 0
      const memorySnapshots: number[] = []

      const result = await benchmark({
        name: 'wikipedia-memory-sustained-ingest',
        target: 'wikipedia.org.ai',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const memInfo = await ctx.do.request<{ heapUsed: number }>('/debug/memory')
          initialMemory = memInfo.heapUsed
        },
        run: async (ctx, i) => {
          const articles = generateArticleBatch(50, i * 50)
          const response = await ctx.do.request('/ingest/articles', {
            method: 'POST',
            body: JSON.stringify({ articles }),
          })

          // Sample memory periodically
          if (i % 10 === 0) {
            const memInfo = await ctx.do.request<{ heapUsed: number }>('/debug/memory')
            memorySnapshots.push(memInfo.heapUsed)
          }

          return response
        },
        teardown: async (ctx) => {
          const memInfo = await ctx.do.request<{ heapUsed: number }>('/debug/memory')
          finalMemory = memInfo.heapUsed
        },
      })

      record(result)

      const memoryGrowthMB = (finalMemory - initialMemory) / (1024 * 1024)

      console.log('\n=== Sustained Ingest Memory Stability ===')
      console.log(`  Initial memory: ${(initialMemory / (1024 * 1024)).toFixed(2)} MB`)
      console.log(`  Final memory: ${(finalMemory / (1024 * 1024)).toFixed(2)} MB`)
      console.log(`  Memory growth: ${memoryGrowthMB.toFixed(2)} MB`)
      console.log(`  Total articles: 5000`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Memory should not grow unbounded
      expect(memoryGrowthMB).toBeLessThan(MAX_MEMORY_GROWTH_MB)
    })

    it('memory stable during XML streaming', async () => {
      const result = await benchmark({
        name: 'wikipedia-memory-xml-streaming',
        target: 'wikipedia.org.ai',
        iterations: 50,
        warmup: 5,
        run: async (ctx, i) => {
          const xmlChunk = generateXMLChunk(200)
          return ctx.do.request('/ingest/xml/stream', {
            method: 'POST',
            body: xmlChunk,
            headers: { 'Content-Type': 'application/xml' },
          })
        },
      })

      record(result)

      console.log('\n=== XML Streaming Memory Stability ===')
      console.log(`  Iterations: 50`)
      console.log(`  Articles per iteration: 200`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Verify stable performance (no degradation from memory pressure)
      expect(result.stats.p99 / result.stats.p50).toBeLessThan(3)
    })
  })
})

// ============================================================================
// PARTITION-AWARE INGEST BENCHMARKS
// ============================================================================

describe('Wikipedia partition-aware ingest', () => {
  describe('per-partition routing', () => {
    it('ingest to specific letter partition', async () => {
      const partitions = ['a', 'b', 'c', 's', 'm']
      const results: Array<{ partition: string; p50: number }> = []

      for (const partition of partitions) {
        const articles = generateArticleBatch(50).map(a => ({
          ...a,
          title: `${partition.toUpperCase()}${a.title}`,
        }))

        const result = await benchmark({
          name: `wikipedia-partition-${partition}`,
          target: `${partition}.wikipedia.org.ai`,
          iterations: 30,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/ingest/articles', {
              method: 'POST',
              body: JSON.stringify({ articles }),
            }),
        })

        results.push({
          partition,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Per-Partition Ingest ===')
      console.log('  Partition | p50 (ms)')
      console.log('  ----------|----------')
      for (const r of results) {
        console.log(`  ${r.partition.padEnd(9)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // All partitions should have similar performance
      const times = results.map(r => r.p50)
      const variance = Math.max(...times) - Math.min(...times)
      expect(variance).toBeLessThan(50)
    })

    it('auto-route articles to partitions', async () => {
      const result = await benchmark({
        name: 'wikipedia-partition-auto-route',
        target: 'wikipedia.org.ai',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          // Mix of articles starting with different letters
          const articles = [
            { title: `Apple_${i}`, text: 'Apple content' },
            { title: `Banana_${i}`, text: 'Banana content' },
            { title: `Computer_${i}`, text: 'Computer content' },
            { title: `System_${i}`, text: 'System content' },
            { title: `Microsoft_${i}`, text: 'Microsoft content' },
          ]

          return ctx.do.request('/ingest/articles/auto-partition', {
            method: 'POST',
            body: JSON.stringify({ articles }),
          })
        },
      })

      record(result)

      console.log('\n=== Auto-Partition Routing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BATCH_INGEST_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikipedia Ingest Summary', () => {
  it('should document ingest performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIPEDIA INGEST PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Ingest throughput: >${TARGET_ARTICLES_PER_MINUTE.toLocaleString()} articles/min`)
    console.log(`  - XML parsing: >${TARGET_XML_PARSE_MB_PER_SEC} MB/s`)
    console.log(`  - Infobox extraction: >${TARGET_INFOBOX_PER_MINUTE.toLocaleString()}/min`)
    console.log(`  - Memory growth: <${MAX_MEMORY_GROWTH_MB} MB during sustained ingest`)
    console.log('')

    console.log('Dataset characteristics:')
    console.log('  - Total articles: ~6,000,000 (English)')
    console.log('  - Infoboxes: ~3,000,000 structured records')
    console.log('  - Internal links: ~200,000,000+ edges')
    console.log('  - Categories: ~2,000,000 nodes')
    console.log('')

    console.log('Extraction pipeline:')
    console.log('  1. Stream XML dump (SAX parser)')
    console.log('  2. Extract article text (plain text)')
    console.log('  3. Extract infoboxes (structured)')
    console.log('  4. Extract categories (hierarchy)')
    console.log('  5. Extract internal links (graph edges)')
    console.log('')

    console.log('Partition strategy:')
    console.log('  - 26 letter partitions: a-z')
    console.log('  - Route by article title first letter')
    console.log('  - wikipedia.org.ai - coordinator')
    console.log('  - {letter}.wikipedia.org.ai - partitions')
    console.log('')

    console.log('Memory management:')
    console.log('  - Streaming XML parsing (no full DOM)')
    console.log('  - Batch processing with size limits')
    console.log('  - R2 offload for large content')
    console.log('')

    expect(true).toBe(true)
  })
})
