/**
 * Search Manifest Performance Benchmarks
 *
 * Tests search manifest operations for unified index discovery:
 * - buildIndexUrl generation performance
 * - Multi-index manifest creation
 * - Index discovery from manifest
 * - Manifest parsing and validation
 *
 * The search manifest is a JSON file that describes available indexes
 * (bloom, range, vector, inverted) for a searchable dataset, enabling
 * clients to discover and fetch indexes efficiently.
 *
 * Expected performance:
 * - buildIndexUrl: <0.1ms
 * - Manifest parsing: <1ms
 * - Full manifest creation: <5ms
 *
 * @see db/iceberg/search-manifest.ts for implementation
 * @see dotdo-2mibg for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('SearchManifest benchmarks', () => {
  describe('buildIndexUrl generation', () => {
    it('generate index URL for single field', async () => {
      const result = await benchmark({
        name: 'search-manifest-build-url-single',
        target: 'iceberg.perf.do',
        iterations: 500,
        warmup: 50,
        setup: async (ctx) => {
          // Create a manifest first
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'url-test',
              base: 'cdn.apis.do/wiktionary/v1',
              indexes: {
                bloom: {
                  word: { file: 'indexes/bloom/word.bloom', fpr: 0.01, items: 500000 },
                },
                vector: {
                  definition: { file: 'indexes/vector/definition.hnsw', dims: 384, count: 500000, metric: 'cosine' },
                },
              },
              data: {
                files: ['data/words-0001.parquet'],
              },
            }),
          })
        },
        run: async (ctx, i) => {
          const indexTypes = ['bloom', 'vector'] as const
          const fields = ['word', 'definition']
          const indexType = indexTypes[i % indexTypes.length]!
          const field = fields[i % fields.length]!

          return ctx.do.request('/iceberg/manifest/build-url', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'url-test',
              indexType,
              field,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== buildIndexUrl (single field) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)

      expect(result.samples.length).toBe(500)
      // URL generation should be extremely fast
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('generate URLs for all index types', async () => {
      const indexTypes = ['bloom', 'range', 'vector', 'inverted'] as const
      const results: Array<{ type: string; p50: number }> = []

      for (const indexType of indexTypes) {
        const result = await benchmark({
          name: `search-manifest-url-${indexType}`,
          target: 'iceberg.perf.do',
          iterations: 200,
          warmup: 20,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/manifest/create', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `url-type-${indexType}`,
                base: 'cdn.apis.do/test/v1',
                indexes: {
                  [indexType]:
                    indexType === 'bloom'
                      ? { field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 } }
                      : indexType === 'range'
                        ? { field1: { file: 'indexes/range/f1.range', offset: 0, blocks: 100 } }
                        : indexType === 'vector'
                          ? { field1: { file: 'indexes/vector/f1.hnsw', dims: 384, count: 10000, metric: 'cosine' } }
                          : { field1: { file: 'indexes/inverted/f1.idx', terms: 50000 } },
                },
                data: {
                  files: ['data/test.parquet'],
                },
              }),
            })
          },
          run: async (ctx) => {
            return ctx.do.request('/iceberg/manifest/build-url', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `url-type-${indexType}`,
                indexType,
                field: 'field1',
              }),
            })
          },
        })

        results.push({
          type: indexType,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== URL Generation by Index Type ===')
      console.log('  Index Type  | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${r.type.padEnd(11)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // All types should be equally fast
      for (const r of results) {
        expect(r.p50).toBeLessThan(1)
      }
    })

    it('batch URL generation', async () => {
      const result = await benchmark({
        name: 'search-manifest-build-urls-batch',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'url-batch',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                  field2: { file: 'indexes/bloom/f2.bloom', fpr: 0.01, items: 20000 },
                  field3: { file: 'indexes/bloom/f3.bloom', fpr: 0.01, items: 30000 },
                },
                range: {
                  timestamp: { file: 'indexes/range/ts.range', offset: 0, blocks: 100 },
                  value: { file: 'indexes/range/val.range', offset: 0, blocks: 50 },
                },
                vector: {
                  embedding: { file: 'indexes/vector/emb.hnsw', dims: 768, count: 100000, metric: 'cosine' },
                },
              },
              data: {
                files: ['data/part-0001.parquet', 'data/part-0002.parquet'],
              },
            }),
          })
        },
        run: async (ctx) => {
          // Generate URLs for all indexes in the manifest
          return ctx.do.request('/iceberg/manifest/build-all-urls', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'url-batch',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Batch URL Generation (6 indexes) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      expect(result.stats.p50).toBeLessThan(2)
    })
  })

  describe('multi-index manifest creation', () => {
    it('create manifest with multiple index types', async () => {
      const result = await benchmark({
        name: 'search-manifest-create-multi',
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: `multi-index-${iteration}`,
              base: 'cdn.apis.do/products/v1',
              indexes: {
                bloom: {
                  sku: { file: 'indexes/bloom/sku.bloom', fpr: 0.01, items: 100000 },
                  name: { file: 'indexes/bloom/name.bloom', fpr: 0.01, items: 100000 },
                },
                range: {
                  price: { file: 'indexes/range/price.range', offset: 0, blocks: 1000 },
                  created_at: { file: 'indexes/range/created.range', offset: 0, blocks: 500 },
                },
                vector: {
                  description_embedding: { file: 'indexes/vector/desc.hnsw', dims: 384, count: 100000, metric: 'cosine' },
                  image_embedding: { file: 'indexes/vector/img.hnsw', dims: 512, count: 100000, metric: 'cosine' },
                },
                inverted: {
                  description: { file: 'indexes/inverted/desc.idx', terms: 50000 },
                  tags: { file: 'indexes/inverted/tags.idx', terms: 10000 },
                },
              },
              data: {
                files: Array.from({ length: 10 }, (_, i) => `data/products-${String(i + 1).padStart(4, '0')}.parquet`),
                puffin: ['stats/products.puffin'],
              },
              cache: {
                queries: {
                  file: 'cache/popular-queries.bin',
                  count: 10000,
                },
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Create Multi-Index Manifest ===')
      console.log(`  Indexes: 8 (2 bloom, 2 range, 2 vector, 2 inverted)`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(50)
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('measures creation time vs index count', async () => {
      const indexCounts = [2, 5, 10, 20]
      const results: Array<{ count: number; p50: number }> = []

      for (const count of indexCounts) {
        const result = await benchmark({
          name: `search-manifest-create-${count}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, iteration) => {
            // Create manifest with variable number of indexes
            const bloom: Record<string, { file: string; fpr: number; items: number }> = {}
            for (let i = 0; i < count; i++) {
              bloom[`field${i}`] = { file: `indexes/bloom/f${i}.bloom`, fpr: 0.01, items: 10000 }
            }

            return ctx.do.request('/iceberg/manifest/create', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `count-${count}-${iteration}`,
                base: 'cdn.apis.do/test/v1',
                indexes: { bloom },
                data: {
                  files: ['data/test.parquet'],
                },
              }),
            })
          },
        })

        results.push({
          count,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Creation Time vs Index Count ===')
      console.log('  Index Count | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${String(r.count).padEnd(11)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Creation should scale linearly
      if (results.length >= 2) {
        const timeRatio = results[results.length - 1]!.p50 / results[0]!.p50
        const countRatio = results[results.length - 1]!.count / results[0]!.count
        expect(timeRatio).toBeLessThan(countRatio * 2)
      }
    })

    it('create manifest from index builders', async () => {
      const result = await benchmark({
        name: 'search-manifest-create-from-builders',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Pre-build some indexes
          await ctx.do.request('/iceberg/bloom/create', {
            method: 'POST',
            body: JSON.stringify({
              items: Array.from({ length: 10000 }, (_, i) => `item:${i}`),
              fpr: 0.01,
              namespace: 'builder-bloom',
            }),
          })

          await ctx.do.request('/iceberg/inverted/batch', {
            method: 'POST',
            body: JSON.stringify({
              documents: Array.from({ length: 1000 }, (_, i) => ({
                id: `doc:${i}`,
                text: `Document ${i} about various topics`,
              })),
              namespace: 'builder-inverted',
            }),
          })
        },
        run: async (ctx, iteration) => {
          // Create manifest from existing indexes
          return ctx.do.request('/iceberg/manifest/create-from-indexes', {
            method: 'POST',
            body: JSON.stringify({
              namespace: `from-builders-${iteration}`,
              base: 'cdn.apis.do/combined/v1',
              sourceIndexes: [
                { namespace: 'builder-bloom', type: 'bloom', field: 'items' },
                { namespace: 'builder-inverted', type: 'inverted', field: 'content' },
              ],
              data: {
                files: ['data/combined.parquet'],
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Create Manifest from Index Builders ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(20)
    })
  })

  describe('index discovery from manifest', () => {
    it('discover available indexes', async () => {
      const result = await benchmark({
        name: 'search-manifest-discover',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'discover-test',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                  field2: { file: 'indexes/bloom/f2.bloom', fpr: 0.01, items: 20000 },
                },
                range: {
                  timestamp: { file: 'indexes/range/ts.range', offset: 0, blocks: 100 },
                },
                vector: {
                  embedding: { file: 'indexes/vector/emb.hnsw', dims: 384, count: 50000, metric: 'cosine' },
                },
                inverted: {
                  content: { file: 'indexes/inverted/content.idx', terms: 100000 },
                },
              },
              data: {
                files: ['data/test.parquet'],
              },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/discover', {
            method: 'GET',
            headers: {
              'X-Namespace': 'discover-test',
            },
          })
        },
      })

      record(result)

      console.log('\n=== Discover Available Indexes ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('get index config for specific field', async () => {
      const result = await benchmark({
        name: 'search-manifest-get-config',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'config-test',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                vector: {
                  embedding: { file: 'indexes/vector/emb.hnsw', dims: 384, count: 100000, metric: 'cosine' },
                },
              },
              data: {
                files: ['data/test.parquet'],
              },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/get-config', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'config-test',
              indexType: 'vector',
              field: 'embedding',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Get Index Config ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('check if index exists', async () => {
      const result = await benchmark({
        name: 'search-manifest-has-index',
        target: 'iceberg.perf.do',
        iterations: 300,
        warmup: 30,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'has-index-test',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  existingField: { file: 'indexes/bloom/ef.bloom', fpr: 0.01, items: 10000 },
                },
              },
              data: {
                files: ['data/test.parquet'],
              },
            }),
          })
        },
        run: async (ctx, i) => {
          // Alternate between existing and non-existing fields
          const field = i % 2 === 0 ? 'existingField' : 'nonExistingField'
          return ctx.do.request('/iceberg/manifest/has-index', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'has-index-test',
              indexType: 'bloom',
              field,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Check Index Existence ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(300)
      expect(result.stats.p50).toBeLessThan(0.5)
    })
  })

  describe('manifest parsing and validation', () => {
    it('parse manifest from JSON', async () => {
      const manifestJson = JSON.stringify({
        version: 1,
        base: 'cdn.apis.do/dataset/v1',
        indexes: {
          bloom: {
            field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
          },
          vector: {
            embedding: { file: 'indexes/vector/emb.hnsw', dims: 384, count: 50000, metric: 'cosine' },
          },
        },
        data: {
          files: ['data/test.parquet'],
        },
      })

      const result = await benchmark({
        name: 'search-manifest-parse',
        target: 'iceberg.perf.do',
        iterations: 500,
        warmup: 50,
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/parse', {
            method: 'POST',
            body: JSON.stringify({
              json: manifestJson,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Parse Manifest from JSON ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(500)
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('validate manifest structure', async () => {
      const result = await benchmark({
        name: 'search-manifest-validate',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, i) => {
          // Alternate between valid and invalid manifests
          const manifest =
            i % 2 === 0
              ? {
                  version: 1,
                  base: 'cdn.apis.do/test/v1',
                  indexes: {
                    bloom: { f: { file: 'f.bloom', fpr: 0.01, items: 100 } },
                  },
                  data: { files: ['test.parquet'] },
                }
              : {
                  version: 2, // Invalid version
                  base: '',
                  indexes: {},
                  data: { files: [] },
                }

          return ctx.do.request('/iceberg/manifest/validate', {
            method: 'POST',
            body: JSON.stringify({ manifest }),
          })
        },
      })

      record(result)

      console.log('\n=== Validate Manifest Structure ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('measures parsing time vs manifest complexity', async () => {
      const complexities = [
        { indexes: 1, files: 1 },
        { indexes: 5, files: 10 },
        { indexes: 10, files: 50 },
        { indexes: 20, files: 100 },
      ]
      const results: Array<{ indexes: number; files: number; p50: number }> = []

      for (const { indexes, files } of complexities) {
        // Build complex manifest
        const bloom: Record<string, { file: string; fpr: number; items: number }> = {}
        for (let i = 0; i < indexes; i++) {
          bloom[`field${i}`] = { file: `indexes/bloom/f${i}.bloom`, fpr: 0.01, items: 10000 }
        }

        const manifestJson = JSON.stringify({
          version: 1,
          base: 'cdn.apis.do/complex/v1',
          indexes: { bloom },
          data: {
            files: Array.from({ length: files }, (_, i) => `data/part-${i}.parquet`),
          },
        })

        const result = await benchmark({
          name: `search-manifest-parse-${indexes}idx-${files}files`,
          target: 'iceberg.perf.do',
          iterations: 100,
          warmup: 10,
          run: async (ctx) => {
            return ctx.do.request('/iceberg/manifest/parse', {
              method: 'POST',
              body: JSON.stringify({ json: manifestJson }),
            })
          },
        })

        results.push({
          indexes,
          files,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Parsing Time vs Complexity ===')
      console.log('  Indexes | Files | p50 (ms)')
      console.log('  --------|-------|----------')
      for (const r of results) {
        console.log(`  ${String(r.indexes).padEnd(7)} | ${String(r.files).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Parsing should remain fast even for complex manifests
      for (const r of results) {
        expect(r.p50).toBeLessThan(5)
      }
    })
  })

  describe('manifest serialization', () => {
    it('serialize manifest to JSON', async () => {
      const result = await benchmark({
        name: 'search-manifest-serialize',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'serialize-test',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                },
                vector: {
                  embedding: { file: 'indexes/vector/emb.hnsw', dims: 384, count: 50000, metric: 'cosine' },
                },
              },
              data: {
                files: Array.from({ length: 20 }, (_, i) => `data/part-${i}.parquet`),
              },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/serialize', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'serialize-test',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Serialize Manifest to JSON ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(1)
    })

    it('persist manifest to R2', async () => {
      const result = await benchmark({
        name: 'search-manifest-persist',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'persist-manifest',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                },
              },
              data: {
                files: ['data/test.parquet'],
              },
            }),
          })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/manifest/persist', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'persist-manifest',
              destination: `r2://manifests/test-${iteration}.json`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Persist Manifest to R2 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
    })

    it('load manifest from R2', async () => {
      const result = await benchmark({
        name: 'search-manifest-load',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'load-source',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                },
              },
              data: {
                files: ['data/test.parquet'],
              },
            }),
          })

          await ctx.do.request('/iceberg/manifest/persist', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'load-source',
              destination: 'r2://manifests/load-test.json',
            }),
          })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/manifest/load', {
            method: 'POST',
            body: JSON.stringify({
              source: 'r2://manifests/load-test.json',
              namespace: `load-target-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Load Manifest from R2 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
    })
  })

  describe('data file operations', () => {
    it('build data file URLs', async () => {
      const result = await benchmark({
        name: 'search-manifest-data-urls',
        target: 'iceberg.perf.do',
        iterations: 200,
        warmup: 20,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'data-urls-test',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                },
              },
              data: {
                files: Array.from({ length: 100 }, (_, i) => `data/part-${String(i).padStart(4, '0')}.parquet`),
              },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.request('/iceberg/manifest/data-urls', {
            method: 'GET',
            headers: {
              'X-Namespace': 'data-urls-test',
            },
          })
        },
      })

      record(result)

      console.log('\n=== Build Data File URLs (100 files) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(200)
      expect(result.stats.p50).toBeLessThan(2)
    })

    it('get single data file URL by index', async () => {
      const result = await benchmark({
        name: 'search-manifest-data-url-single',
        target: 'iceberg.perf.do',
        iterations: 300,
        warmup: 30,
        setup: async (ctx) => {
          await ctx.do.request('/iceberg/manifest/create', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'data-url-single',
              base: 'cdn.apis.do/dataset/v1',
              indexes: {
                bloom: {
                  field1: { file: 'indexes/bloom/f1.bloom', fpr: 0.01, items: 10000 },
                },
              },
              data: {
                files: Array.from({ length: 100 }, (_, i) => `data/part-${i}.parquet`),
              },
            }),
          })
        },
        run: async (ctx, i) => {
          return ctx.do.request('/iceberg/manifest/data-url', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'data-url-single',
              index: i % 100,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Get Single Data File URL ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(300)
      expect(result.stats.p50).toBeLessThan(0.5)
    })
  })
})
