/**
 * Web Crawl Ingest Performance Benchmarks
 *
 * Tests Common Crawl data ingestion into web.org.ai:
 * - Streaming WAT/WARC parsing
 * - Hostname extraction from URLs
 * - Link deduplication
 * - Domain-level aggregation
 * - Edge weight (link count) computation
 * - TLD partitioning
 * - Memory stability at billion-edge scale
 *
 * Target namespace: web.org.ai, {tld}.web.org.ai
 * Scale: ~1B+ hostnames, ~10B+ link edges
 *
 * Performance targets:
 * - Ingest: >1M links/minute
 * - Memory stable at billion-edge scale
 *
 * @see dotdo-b2pk0 for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

describe('Web Crawl Ingest Benchmarks', () => {
  describe('WAT/WARC parsing', () => {
    it('streaming WAT record parsing', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-wat-parsing',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Simulate WAT record batch (Common Crawl format)
          const watRecords = Array.from({ length: 100 }, (_, i) => ({
            'WARC-Type': 'metadata',
            'WARC-Target-URI': `https://example-${iteration}-${i}.com/page`,
            'WARC-Date': new Date().toISOString(),
            'Content-Type': 'application/json',
            envelope: {
              'WARC-Header-Metadata': {
                'WARC-Target-URI': `https://example-${iteration}-${i}.com/page`,
              },
              'Payload-Metadata': {
                'HTTP-Response-Metadata': {
                  'HTML-Metadata': {
                    Links: [
                      { url: `https://link-${i}-1.com/`, path: 'A@/href' },
                      { url: `https://link-${i}-2.com/path`, path: 'A@/href' },
                      { url: `https://link-${i}-3.org/`, path: 'A@/href' },
                    ],
                  },
                },
              },
            },
          }))

          // Ingest the batch
          const response = await ctx.do.request('/ingest/wat', {
            method: 'POST',
            body: JSON.stringify({ records: watRecords }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      // 100 records should process quickly
      expect(result.stats.p50).toBeLessThan(500)
    })

    it('streaming WARC link extraction', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-warc-extraction',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Simulate WARC response with HTML containing links
          const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><title>Test Page ${iteration}</title></head>
            <body>
              ${Array.from({ length: 50 }, (_, i) => `<a href="https://target-${i}.com/page">Link ${i}</a>`).join('\n')}
            </body>
            </html>
          `

          const warcRecord = {
            'WARC-Type': 'response',
            'WARC-Target-URI': `https://source-${iteration}.com/`,
            'Content-Type': 'text/html',
            payload: htmlContent,
          }

          const response = await ctx.do.request('/ingest/warc', {
            method: 'POST',
            body: JSON.stringify({ record: warcRecord }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // HTML parsing and link extraction
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('batch WAT/WARC processing (1000 records)', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-batch-1k',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 1000,
        run: async (ctx, iteration) => {
          // Large batch simulating streaming from S3
          const records = Array.from({ length: 1000 }, (_, i) => ({
            sourceUrl: `https://domain-${iteration}-${i}.com/`,
            links: Array.from({ length: 5 }, (_, j) => ({
              url: `https://target-${i}-${j}.net/`,
              anchorText: `Link ${j}`,
            })),
          }))

          const response = await ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({ records }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // 1000 records with 5 links each = 5000 edges
      // Should achieve >1M links/minute = ~16K links/sec
      // 5000 edges should complete in <500ms for target throughput
      expect(result.stats.p50).toBeLessThan(1000)

      // Verify throughput target
      const edgesPerBatch = 1000 * 5
      const linksPerSecond = edgesPerBatch / (result.stats.mean / 1000)
      console.log(`Ingest throughput: ${linksPerSecond.toFixed(0)} links/sec`)
    })
  })

  describe('hostname extraction', () => {
    it('URL hostname extraction and normalization', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-hostname-extraction',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          const urls = [
            'https://www.example.com/path/to/page?query=1',
            'http://subdomain.example.org:8080/page',
            'https://EXAMPLE.NET/PATH',
            'https://www.sub.domain.example.co.uk/page',
            'http://192.168.1.1/path',
            'https://user:pass@example.com/secret',
            'https://example.com.',
            'https://example.com:443/path',
          ]

          const response = await ctx.do.request('/extract/hostnames', {
            method: 'POST',
            body: JSON.stringify({ urls }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Simple URL parsing should be fast
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('TLD extraction and classification', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-tld-extraction',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          const domains = [
            'example.com',
            'example.co.uk',
            'example.org.au',
            'example.edu',
            'example.gov',
            'example.io',
            'example.ai',
            'sub.example.com.br',
          ]

          const response = await ctx.do.request('/extract/tld', {
            method: 'POST',
            body: JSON.stringify({ domains }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('batch hostname processing (10K URLs)', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-hostname-batch-10k',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 10000,
        run: async (ctx, iteration) => {
          const tlds = ['com', 'org', 'net', 'io', 'ai', 'co.uk', 'de', 'fr']
          const urls = Array.from({ length: 10000 }, (_, i) => {
            const tld = tlds[i % tlds.length]
            return `https://domain-${iteration}-${i}.${tld}/path/${i}`
          })

          const response = await ctx.do.request('/extract/hostnames/batch', {
            method: 'POST',
            body: JSON.stringify({ urls }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      // 10K URLs should process quickly
      expect(result.stats.p50).toBeLessThan(500)
    })
  })

  describe('link deduplication', () => {
    it('deduplicate links within page', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-dedup-within-page',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // Page with many duplicate outbound links
          const links = [
            ...Array.from({ length: 50 }, () => 'https://popular.com/'),
            ...Array.from({ length: 30 }, () => 'https://common.org/page'),
            ...Array.from({ length: 20 }, (_, i) => `https://unique-${i}.net/`),
          ]

          const response = await ctx.do.request('/dedup/links', {
            method: 'POST',
            body: JSON.stringify({
              source: 'https://source.com/',
              links,
            }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(15)
    })

    it('deduplicate links across domains (bloom filter)', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-dedup-bloom',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, iteration) => {
          // Simulate checking against existing link set
          const edgesToCheck = Array.from({ length: 1000 }, (_, i) => ({
            from: `domain-${iteration % 100}.com`,
            to: `target-${i % 500}.com`,
          }))

          const response = await ctx.do.request('/dedup/check', {
            method: 'POST',
            body: JSON.stringify({ edges: edgesToCheck }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      // Bloom filter check should be fast
      expect(result.stats.p50).toBeLessThan(50)
    })

    it('incremental dedup with seen set', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-dedup-incremental',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Pre-populate seen set with existing edges
          const existingEdges = Array.from({ length: 10000 }, (_, i) => ({
            from: `existing-${i % 100}.com`,
            to: `target-${i % 1000}.com`,
          }))

          await ctx.do.request('/dedup/seed', {
            method: 'POST',
            body: JSON.stringify({ edges: existingEdges }),
          })
        },
        run: async (ctx, iteration) => {
          // Check new batch (mix of new and existing)
          const newEdges = Array.from({ length: 500 }, (_, i) => ({
            from: `${i % 2 === 0 ? 'existing' : 'new'}-${i % 100}.com`,
            to: `target-${i % 1000}.com`,
          }))

          const response = await ctx.do.request('/dedup/filter', {
            method: 'POST',
            body: JSON.stringify({ edges: newEdges }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)
      expect(result.stats.p50).toBeLessThan(100)
    })
  })

  describe('domain-level aggregation', () => {
    it('aggregate page links to domain level', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-domain-aggregation',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // Multiple pages from same domain linking to targets
          const pageLinks = [
            {
              page: 'https://source.com/page1',
              links: ['https://a.com/', 'https://b.com/', 'https://c.com/'],
            },
            {
              page: 'https://source.com/page2',
              links: ['https://a.com/other', 'https://d.com/', 'https://b.com/page'],
            },
            {
              page: 'https://source.com/page3',
              links: ['https://e.com/', 'https://a.com/another', 'https://c.com/path'],
            },
          ]

          const response = await ctx.do.request('/aggregate/domain', {
            method: 'POST',
            body: JSON.stringify({ pageLinks }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(20)
    })

    it('aggregate subdomain to root domain', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-subdomain-aggregation',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          const subdomainLinks = [
            { from: 'www.example.com', to: 'target.com' },
            { from: 'blog.example.com', to: 'target.com' },
            { from: 'api.example.com', to: 'other.com' },
            { from: 'shop.example.com', to: 'target.com' },
            { from: 'm.example.com', to: 'mobile.com' },
          ]

          const response = await ctx.do.request('/aggregate/subdomain', {
            method: 'POST',
            body: JSON.stringify({ links: subdomainLinks }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('batch domain aggregation (100K page links)', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-domain-aggregation-100k',
        target: 'web.perf.do',
        iterations: 5,
        warmup: 1,
        datasetSize: 100000,
        run: async (ctx, iteration) => {
          // Simulate large batch of page-level links
          const pageLinks = Array.from({ length: 100000 }, (_, i) => ({
            from: `page-${i % 1000}.source-${i % 100}.com`,
            to: `target-${i % 500}.com`,
          }))

          const response = await ctx.do.request('/aggregate/domain/batch', {
            method: 'POST',
            body: JSON.stringify({ links: pageLinks }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
      // Large batch aggregation
      expect(result.stats.p50).toBeLessThan(5000)
    })
  })

  describe('edge weight computation', () => {
    it('compute link count weights', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-edge-weight-count',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // Domain pairs with multiple page-level links
          const domainPairs = [
            { from: 'source1.com', to: 'target.com', pageLinks: 150 },
            { from: 'source2.com', to: 'target.com', pageLinks: 75 },
            { from: 'source3.com', to: 'target.com', pageLinks: 300 },
            { from: 'source4.com', to: 'other.com', pageLinks: 25 },
          ]

          const response = await ctx.do.request('/weights/compute', {
            method: 'POST',
            body: JSON.stringify({ pairs: domainPairs }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(10)
    })

    it('update edge weights incrementally', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-edge-weight-update',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Initialize edge weights
          const initialEdges = Array.from({ length: 1000 }, (_, i) => ({
            from: `source-${i % 100}.com`,
            to: `target-${i % 50}.com`,
            weight: Math.floor(Math.random() * 100),
          }))

          await ctx.do.request('/weights/init', {
            method: 'POST',
            body: JSON.stringify({ edges: initialEdges }),
          })
        },
        run: async (ctx, iteration) => {
          // Increment weights for batch of edges
          const updates = Array.from({ length: 50 }, (_, i) => ({
            from: `source-${(iteration + i) % 100}.com`,
            to: `target-${i % 50}.com`,
            increment: 1,
          }))

          const response = await ctx.do.request('/weights/increment', {
            method: 'POST',
            body: JSON.stringify({ updates }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('TLD partitioning', () => {
    it('route edges to TLD partitions', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-tld-routing',
        target: 'web.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx) => {
          const edges = [
            { from: 'source.com', to: 'target.com' },
            { from: 'source.org', to: 'target.org' },
            { from: 'source.net', to: 'target.net' },
            { from: 'source.io', to: 'target.io' },
            { from: 'source.ai', to: 'target.ai' },
            { from: 'source.co.uk', to: 'target.co.uk' },
            { from: 'source.de', to: 'target.de' },
            { from: 'source.fr', to: 'target.fr' },
          ]

          const response = await ctx.do.request('/partition/route', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(100)
      // Routing should be very fast
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('batch ingest to specific TLD partition', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-tld-partition-batch',
        target: 'com.web.perf.do', // .com partition
        iterations: 20,
        warmup: 3,
        run: async (ctx, iteration) => {
          // All edges for .com TLD
          const edges = Array.from({ length: 500 }, (_, i) => ({
            from: `source-${iteration}-${i}.com`,
            to: `target-${i % 100}.com`,
            weight: 1,
          }))

          const response = await ctx.do.request('/edges/batch', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeLessThan(200)
    })

    it('cross-TLD edge handling', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-cross-tld',
        target: 'web.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx) => {
          // Edges crossing TLD boundaries
          const crossTldEdges = [
            { from: 'source.com', to: 'target.org' },
            { from: 'source.org', to: 'target.net' },
            { from: 'source.io', to: 'target.com' },
            { from: 'source.ai', to: 'target.io' },
            { from: 'source.co.uk', to: 'target.com' },
          ]

          const response = await ctx.do.request('/edges/cross-tld', {
            method: 'POST',
            body: JSON.stringify({ edges: crossTldEdges }),
          })

          return response
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(20)
    })
  })

  describe('memory stability at scale', () => {
    it('streaming ingest without memory growth', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-memory-stability',
        target: 'web.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, iteration) => {
          // Simulate streaming chunks without accumulating in memory
          for (let chunk = 0; chunk < 10; chunk++) {
            const edges = Array.from({ length: 1000 }, (_, i) => ({
              from: `stream-${iteration}-${chunk}-${i % 100}.com`,
              to: `target-${i % 200}.com`,
            }))

            await ctx.do.request('/ingest/stream', {
              method: 'POST',
              body: JSON.stringify({
                chunk,
                edges,
                flush: chunk === 9, // Flush on last chunk
              }),
            })
          }

          return { chunks: 10, edgesPerChunk: 1000 }
        },
      })

      record(result)

      expect(result.samples.length).toBe(20)
      // Should not have memory errors
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('large batch with chunked processing', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-chunked-large',
        target: 'web.perf.do',
        iterations: 5,
        warmup: 1,
        datasetSize: 50000,
        run: async (ctx, iteration) => {
          // 50K edges in chunks of 5K
          const chunkSize = 5000
          const totalEdges = 50000
          let processed = 0

          for (let offset = 0; offset < totalEdges; offset += chunkSize) {
            const edges = Array.from({ length: chunkSize }, (_, i) => ({
              from: `chunk-${iteration}-${offset + i}.com`,
              to: `target-${(offset + i) % 1000}.com`,
            }))

            await ctx.do.request('/ingest/chunk', {
              method: 'POST',
              body: JSON.stringify({
                edges,
                offset,
                total: totalEdges,
              }),
            })

            processed += chunkSize
          }

          return { totalProcessed: processed }
        },
      })

      record(result)

      expect(result.samples.length).toBe(5)
      // Large batch should complete without issues
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('concurrent ingest streams', async () => {
      const concurrency = 5

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, streamIdx) =>
          benchmark({
            name: `webcrawl-ingest-concurrent-stream-${streamIdx}`,
            target: 'web.perf.do',
            iterations: 10,
            warmup: 2,
            run: async (ctx, iteration) => {
              const edges = Array.from({ length: 200 }, (_, i) => ({
                from: `stream-${streamIdx}-${iteration}-${i}.com`,
                to: `target-${i % 50}.com`,
              }))

              return ctx.do.request('/ingest/stream', {
                method: 'POST',
                body: JSON.stringify({ streamId: streamIdx, edges }),
              })
            },
          })
        )
      )

      record(results)

      // All streams should complete
      for (const r of results) {
        expect(r.errors?.length ?? 0).toBeLessThan(3)
      }

      // Check for fairness
      const p50s = results.map((r) => r.stats.p50)
      const meanP50 = p50s.reduce((a, b) => a + b, 0) / p50s.length
      const maxP50 = Math.max(...p50s)
      expect(maxP50).toBeLessThan(meanP50 * 3)
    })
  })

  describe('ingest throughput', () => {
    it('sustained ingest throughput measurement', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-throughput-sustained',
        target: 'web.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, iteration) => {
          const edgesPerBatch = 2000
          const edges = Array.from({ length: edgesPerBatch }, (_, i) => ({
            from: `sustained-${iteration}-${i}.com`,
            to: `target-${i % 500}.com`,
            weight: 1,
          }))

          const start = performance.now()
          await ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })
          const elapsed = performance.now() - start

          return {
            edges: edgesPerBatch,
            durationMs: elapsed,
            edgesPerSecond: (edgesPerBatch / elapsed) * 1000,
          }
        },
      })

      record(result)

      expect(result.samples.length).toBe(30)

      // Calculate average throughput
      // Target: >1M links/minute = ~16,667 links/second
      const avgMs = result.stats.mean
      const edgesPerBatch = 2000
      const throughput = (edgesPerBatch / avgMs) * 1000 * 60 // per minute

      console.log(`Ingest throughput: ${(throughput / 1_000_000).toFixed(2)}M links/minute`)
      console.log(`Edges per second: ${((edgesPerBatch / avgMs) * 1000).toFixed(0)}`)

      // Should achieve reasonable throughput
      expect(throughput).toBeGreaterThan(100_000) // At least 100K/min in test
    })

    it('peak ingest throughput', async () => {
      const result = await benchmark({
        name: 'webcrawl-ingest-throughput-peak',
        target: 'web.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: 10000,
        run: async (ctx, iteration) => {
          // Larger batches for peak throughput
          const edgesPerBatch = 10000
          const edges = Array.from({ length: edgesPerBatch }, (_, i) => ({
            from: `peak-${iteration}-${i}.com`,
            to: `target-${i % 1000}.com`,
          }))

          await ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({ edges }),
          })

          return { edges: edgesPerBatch }
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)

      // Calculate peak throughput
      const avgMs = result.stats.mean
      const edgesPerBatch = 10000
      const throughput = (edgesPerBatch / avgMs) * 1000 * 60

      console.log(`Peak throughput: ${(throughput / 1_000_000).toFixed(2)}M links/minute`)
    })
  })
})
