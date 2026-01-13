/**
 * Wikidata Ingest Performance Benchmarks
 *
 * Tests streaming ingest throughput and memory stability for Wikidata
 * knowledge graph at scale (~100M Q-items, ~10K P-properties, ~1.5B statements).
 *
 * Performance targets:
 * - Entity ingest: >100K entities/minute
 * - Statement parsing: >500K statements/minute
 * - Memory stable: No OOM during 100M+ entity processing
 * - Streaming parse: <10ms per 1000 lines
 *
 * Infrastructure:
 * - Source: Wikidata JSON dumps (entities.json.gz)
 * - Namespace: wiki.org.ai
 * - Partitioning: By QID prefix (Q1-Q999999, Q1M-Q9M, Q10M-Q99M, Q100M+)
 *
 * @see https://dumps.wikimedia.org/wikidatawiki/entities/
 * @see dotdo-70c3y for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Target entities per minute for streaming ingest
 */
const TARGET_ENTITIES_PER_MINUTE = 100_000

/**
 * Maximum acceptable p95 latency for entity writes (ms)
 */
const MAX_ENTITY_WRITE_P95_MS = 50

/**
 * Maximum acceptable p95 latency for batch statement writes (ms)
 */
const MAX_STATEMENT_BATCH_P95_MS = 200

/**
 * Maximum memory growth allowed during ingest (percentage)
 */
const MAX_MEMORY_GROWTH_PERCENT = 50

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Generate a sample Wikidata Q-item (entity)
 */
function generateQItem(index: number): object {
  const qid = `Q${index}`
  const labels = {
    en: { language: 'en', value: `Entity ${index}` },
    de: { language: 'de', value: `Entitat ${index}` },
    fr: { language: 'fr', value: `Entite ${index}` },
    es: { language: 'es', value: `Entidad ${index}` },
    ja: { language: 'ja', value: `\u30A8\u30F3\u30C6\u30A3\u30C6\u30A3 ${index}` },
  }

  const aliases = {
    en: [
      { language: 'en', value: `Alt name ${index}` },
      { language: 'en', value: `Alias ${index}` },
    ],
  }

  const descriptions = {
    en: { language: 'en', value: `Description for entity ${index}` },
    de: { language: 'de', value: `Beschreibung fur Entitat ${index}` },
  }

  // Generate claims/statements
  const claims: Record<string, unknown[]> = {}
  const numProperties = 5 + (index % 10) // 5-15 properties per entity

  for (let p = 0; p < numProperties; p++) {
    const pid = `P${31 + p}` // P31 = instance of, etc.
    claims[pid] = [
      {
        mainsnak: {
          snaktype: 'value',
          property: pid,
          datavalue: {
            value: { 'entity-type': 'item', 'numeric-id': (index * 100 + p) % 1000000, id: `Q${(index * 100 + p) % 1000000}` },
            type: 'wikibase-entityid',
          },
        },
        type: 'statement',
        id: `${qid}$${crypto.randomUUID()}`,
        rank: 'normal',
        qualifiers: p % 3 === 0 ? {
          P580: [{ // start time qualifier
            snaktype: 'value',
            property: 'P580',
            datavalue: {
              value: { time: '+2020-01-01T00:00:00Z', precision: 11 },
              type: 'time',
            },
          }],
        } : undefined,
        references: p % 5 === 0 ? [{
          snaks: {
            P854: [{ // reference URL
              snaktype: 'value',
              property: 'P854',
              datavalue: { value: `https://example.com/ref/${index}/${p}`, type: 'string' },
            }],
          },
        }] : undefined,
      },
    ]
  }

  return {
    type: 'item',
    id: qid,
    labels,
    descriptions,
    aliases,
    claims,
    sitelinks: {
      enwiki: { site: 'enwiki', title: `Article ${index}`, badges: [] },
      dewiki: { site: 'dewiki', title: `Artikel ${index}`, badges: [] },
    },
  }
}

/**
 * Generate a sample Wikidata P-property
 */
function generateProperty(index: number): object {
  const pid = `P${index}`

  return {
    type: 'property',
    id: pid,
    datatype: ['wikibase-item', 'string', 'time', 'quantity', 'url'][index % 5],
    labels: {
      en: { language: 'en', value: `Property ${index}` },
      de: { language: 'de', value: `Eigenschaft ${index}` },
    },
    descriptions: {
      en: { language: 'en', value: `Description for property ${index}` },
    },
    aliases: {
      en: [{ language: 'en', value: `P-${index}` }],
    },
    claims: {},
  }
}

/**
 * Generate batch of Q-items
 */
function generateQItemBatch(size: number, offset: number = 0): object[] {
  return Array.from({ length: size }, (_, i) => generateQItem(offset + i + 1))
}

/**
 * Generate batch of statements/claims
 */
function generateStatementBatch(entityId: string, count: number): object[] {
  return Array.from({ length: count }, (_, i) => ({
    entityId,
    propertyId: `P${31 + (i % 100)}`,
    mainsnak: {
      snaktype: 'value',
      property: `P${31 + (i % 100)}`,
      datavalue: {
        value: { 'entity-type': 'item', 'numeric-id': i, id: `Q${i}` },
        type: 'wikibase-entityid',
      },
    },
    qualifiers: i % 3 === 0 ? [
      { property: 'P580', value: '+2020-01-01T00:00:00Z' },
    ] : [],
    references: i % 5 === 0 ? [
      { property: 'P854', value: `https://example.com/ref/${i}` },
    ] : [],
  }))
}

// ============================================================================
// STREAMING JSON DUMP PARSING BENCHMARKS
// ============================================================================

describe('Wikidata streaming JSON dump parsing', () => {
  describe('single entity processing', () => {
    it('parse single Q-item entity', async () => {
      const result = await benchmark({
        name: 'wikidata-ingest-single-qitem',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        datasetSize: 1,
        run: async (ctx, i) => {
          const entity = generateQItem(i + 1)
          return ctx.do.request('/ingest/entity', {
            method: 'POST',
            body: JSON.stringify(entity),
          })
        },
      })

      record(result)

      console.log('\n=== Single Q-Item Processing ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Throughput: ${(60000 / result.stats.p50).toFixed(0)} entities/min`)

      expect(result.stats.p95).toBeLessThan(MAX_ENTITY_WRITE_P95_MS)
    })

    it('parse single P-property', async () => {
      const result = await benchmark({
        name: 'wikidata-ingest-single-property',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        datasetSize: 1,
        run: async (ctx, i) => {
          const property = generateProperty(i + 1)
          return ctx.do.request('/ingest/property', {
            method: 'POST',
            body: JSON.stringify(property),
          })
        },
      })

      record(result)

      console.log('\n=== Single P-Property Processing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ENTITY_WRITE_P95_MS)
    })

    it('parse entity with varying claim counts', async () => {
      const claimCounts = [5, 20, 50, 100, 200]
      const results: Array<{ claims: number; p50: number; throughput: number }> = []

      for (const claimCount of claimCounts) {
        const result = await benchmark({
          name: `wikidata-ingest-claims-${claimCount}`,
          target: 'wiki.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            const entity = generateQItem(i + 1)
            // Add extra claims to reach target count
            const claims = (entity as { claims: Record<string, unknown[]> }).claims
            for (let c = Object.keys(claims).length; c < claimCount; c++) {
              claims[`P${1000 + c}`] = [{
                mainsnak: { snaktype: 'value', property: `P${1000 + c}`, datavalue: { value: `value-${c}`, type: 'string' } },
                type: 'statement',
                rank: 'normal',
              }]
            }
            return ctx.do.request('/ingest/entity', {
              method: 'POST',
              body: JSON.stringify(entity),
            })
          },
        })

        results.push({
          claims: claimCount,
          p50: result.stats.p50,
          throughput: 60000 / result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Processing by Claim Count ===')
      console.log('  Claims   | p50 (ms)  | Entities/min')
      console.log('  ---------|-----------|-------------')
      for (const r of results) {
        console.log(`  ${String(r.claims).padEnd(8)} | ${r.p50.toFixed(3).padStart(9)} | ${r.throughput.toFixed(0).padStart(11)}`)
      }

      // Processing time should scale sub-linearly with claim count
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(20)
    })
  })

  describe('batch entity extraction', () => {
    it.each([100, 500, 1000, 5000])('ingest batch of %d Q-items', async (batchSize) => {
      const entities = generateQItemBatch(batchSize)

      const result = await benchmark({
        name: `wikidata-ingest-batch-${batchSize}`,
        target: 'wiki.perf.do',
        iterations: 10,
        warmup: 2,
        datasetSize: batchSize,
        run: async (ctx) =>
          ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({ entities }),
          }),
      })

      record(result)

      const entitiesPerMinute = (batchSize / result.stats.p50) * 60000

      console.log(`\n=== Batch Ingest (${batchSize} entities) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${entitiesPerMinute.toFixed(0)} entities/min`)

      expect(result.samples.length).toBe(10)
    })

    it('measures throughput scaling with batch size', async () => {
      const batchSizes = [100, 500, 1000, 5000]
      const throughputs: Array<{ size: number; entitiesPerMin: number }> = []

      for (const size of batchSizes) {
        const entities = generateQItemBatch(size)

        const result = await benchmark({
          name: `wikidata-throughput-${size}`,
          target: 'wiki.perf.do',
          iterations: 5,
          warmup: 1,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/ingest/batch', {
              method: 'POST',
              body: JSON.stringify({ entities }),
            }),
        })

        throughputs.push({
          size,
          entitiesPerMin: (size / result.stats.p50) * 60000,
        })

        record(result)
      }

      console.log('\n=== Throughput vs Batch Size ===')
      console.log('  Batch Size  | Entities/Minute')
      console.log('  ------------|----------------')
      for (const t of throughputs) {
        console.log(`  ${String(t.size).padEnd(11)} | ${t.entitiesPerMin.toFixed(0).padStart(14)}`)
      }

      // Larger batches should have better throughput
      expect(throughputs[throughputs.length - 1]!.entitiesPerMin).toBeGreaterThan(
        throughputs[0]!.entitiesPerMin
      )

      // Should meet target throughput with large batches
      expect(throughputs[throughputs.length - 1]!.entitiesPerMin).toBeGreaterThan(TARGET_ENTITIES_PER_MINUTE)
    })
  })

  describe('property extraction', () => {
    it('bulk property ingest (all ~10K properties)', async () => {
      // Simulate ingesting subset of properties
      const properties = Array.from({ length: 100 }, (_, i) => generateProperty(i + 1))

      const result = await benchmark({
        name: 'wikidata-ingest-properties-bulk',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 100,
        run: async (ctx) =>
          ctx.do.request('/ingest/properties/batch', {
            method: 'POST',
            body: JSON.stringify({ properties }),
          }),
      })

      record(result)

      console.log('\n=== Bulk Property Ingest (100 properties) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(500)
    })
  })
})

// ============================================================================
// STATEMENT/CLAIM PARSING BENCHMARKS
// ============================================================================

describe('Wikidata statement/claim parsing', () => {
  describe('statement extraction', () => {
    it('parse statements with qualifiers', async () => {
      const result = await benchmark({
        name: 'wikidata-parse-statements-with-qualifiers',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const statements = generateStatementBatch(`Q${i + 1}`, 10)
          return ctx.do.request('/ingest/statements', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
      })

      record(result)

      console.log('\n=== Statement Parsing (with qualifiers) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_STATEMENT_BATCH_P95_MS)
    })

    it('parse statements with references', async () => {
      const result = await benchmark({
        name: 'wikidata-parse-statements-with-refs',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          // Generate statements with many references
          const statements = Array.from({ length: 20 }, (_, j) => ({
            entityId: `Q${i + 1}`,
            propertyId: `P${31 + j}`,
            mainsnak: {
              snaktype: 'value',
              property: `P${31 + j}`,
              datavalue: { value: { 'entity-type': 'item', id: `Q${j}` }, type: 'wikibase-entityid' },
            },
            references: [
              { snaks: { P854: [{ datavalue: { value: `https://ref1.com/${j}` } }] } },
              { snaks: { P854: [{ datavalue: { value: `https://ref2.com/${j}` } }] } },
            ],
          }))

          return ctx.do.request('/ingest/statements', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
      })

      record(result)

      console.log('\n=== Statement Parsing (with references) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_STATEMENT_BATCH_P95_MS)
    })

    it('bulk statement batch (1000 statements)', async () => {
      const result = await benchmark({
        name: 'wikidata-statements-bulk-1k',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        run: async (ctx, i) => {
          const statements = generateStatementBatch(`Q${i + 1}`, 1000)
          return ctx.do.request('/ingest/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
      })

      record(result)

      const statementsPerMinute = (1000 / result.stats.p50) * 60000

      console.log('\n=== Bulk Statement Batch (1000) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  Throughput: ${statementsPerMinute.toFixed(0)} statements/min`)

      expect(statementsPerMinute).toBeGreaterThan(500000) // Target: 500K/min
    })
  })

  describe('qualifier and reference handling', () => {
    it('parse complex qualifiers (time, quantity, coordinates)', async () => {
      const result = await benchmark({
        name: 'wikidata-parse-complex-qualifiers',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const statement = {
            entityId: `Q${i + 1}`,
            propertyId: 'P39', // position held
            mainsnak: {
              snaktype: 'value',
              property: 'P39',
              datavalue: { value: { id: 'Q30461' }, type: 'wikibase-entityid' },
            },
            qualifiers: {
              P580: [{ // start time
                snaktype: 'value',
                property: 'P580',
                datavalue: {
                  value: { time: '+2009-01-20T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' },
                  type: 'time',
                },
              }],
              P582: [{ // end time
                snaktype: 'value',
                property: 'P582',
                datavalue: {
                  value: { time: '+2017-01-20T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' },
                  type: 'time',
                },
              }],
              P1365: [{ // replaces
                snaktype: 'value',
                property: 'P1365',
                datavalue: { value: { id: 'Q207' }, type: 'wikibase-entityid' },
              }],
            },
          }

          return ctx.do.request('/ingest/statement', {
            method: 'POST',
            body: JSON.stringify(statement),
          })
        },
      })

      record(result)

      console.log('\n=== Complex Qualifier Parsing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(50)
    })

    it('parse nested reference chains', async () => {
      const result = await benchmark({
        name: 'wikidata-parse-nested-refs',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const statement = {
            entityId: `Q${i + 1}`,
            propertyId: 'P569', // date of birth
            mainsnak: {
              snaktype: 'value',
              property: 'P569',
              datavalue: {
                value: { time: '+1990-01-01T00:00:00Z', precision: 11 },
                type: 'time',
              },
            },
            references: [
              {
                hash: 'abc123',
                snaks: {
                  P854: [{ datavalue: { value: 'https://source1.com', type: 'string' } }],
                  P813: [{ datavalue: { value: { time: '+2024-01-01T00:00:00Z', precision: 11 }, type: 'time' } }],
                  P1476: [{ datavalue: { value: { text: 'Source Title', language: 'en' }, type: 'monolingualtext' } }],
                },
                'snaks-order': ['P854', 'P813', 'P1476'],
              },
              {
                hash: 'def456',
                snaks: {
                  P248: [{ datavalue: { value: { id: 'Q5375741' }, type: 'wikibase-entityid' } }],
                  P577: [{ datavalue: { value: { time: '+2020-01-01T00:00:00Z', precision: 9 }, type: 'time' } }],
                },
                'snaks-order': ['P248', 'P577'],
              },
            ],
          }

          return ctx.do.request('/ingest/statement', {
            method: 'POST',
            body: JSON.stringify(statement),
          })
        },
      })

      record(result)

      console.log('\n=== Nested Reference Chain Parsing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(50)
    })
  })
})

// ============================================================================
// LABEL/ALIAS MULTILINGUAL EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikidata label/alias multilingual extraction', () => {
  describe('label processing', () => {
    it('extract labels in multiple languages', async () => {
      const result = await benchmark({
        name: 'wikidata-extract-multilingual-labels',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const entity = {
            id: `Q${i + 1}`,
            labels: {
              en: { language: 'en', value: `English label ${i}` },
              de: { language: 'de', value: `Deutsches Etikett ${i}` },
              fr: { language: 'fr', value: `Etiquette francaise ${i}` },
              es: { language: 'es', value: `Etiqueta espanola ${i}` },
              ja: { language: 'ja', value: `\u65E5\u672C\u8A9E\u30E9\u30D9\u30EB ${i}` },
              zh: { language: 'zh', value: `\u4E2D\u6587\u6807\u7B7E ${i}` },
              ru: { language: 'ru', value: `\u0420\u0443\u0441\u0441\u043A\u0430\u044F \u043C\u0435\u0442\u043A\u0430 ${i}` },
              ar: { language: 'ar', value: `\u062A\u0633\u0645\u064A\u0629 \u0639\u0631\u0628\u064A\u0629 ${i}` },
              pt: { language: 'pt', value: `Rotulo portugues ${i}` },
              it: { language: 'it', value: `Etichetta italiana ${i}` },
            },
          }

          return ctx.do.request('/ingest/labels', {
            method: 'POST',
            body: JSON.stringify(entity),
          })
        },
      })

      record(result)

      console.log('\n=== Multilingual Label Extraction (10 languages) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(20)
    })

    it('extract aliases (multiple per language)', async () => {
      const result = await benchmark({
        name: 'wikidata-extract-aliases',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const entity = {
            id: `Q${i + 1}`,
            aliases: {
              en: Array.from({ length: 10 }, (_, j) => ({
                language: 'en',
                value: `English alias ${i}-${j}`,
              })),
              de: Array.from({ length: 5 }, (_, j) => ({
                language: 'de',
                value: `Deutscher Alias ${i}-${j}`,
              })),
              fr: Array.from({ length: 3 }, (_, j) => ({
                language: 'fr',
                value: `Alias francais ${i}-${j}`,
              })),
            },
          }

          return ctx.do.request('/ingest/aliases', {
            method: 'POST',
            body: JSON.stringify(entity),
          })
        },
      })

      record(result)

      console.log('\n=== Alias Extraction (18 aliases across 3 languages) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(20)
    })

    it('bulk label index update', async () => {
      const result = await benchmark({
        name: 'wikidata-label-index-bulk',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        run: async (ctx, i) => {
          const labels = Array.from({ length: 1000 }, (_, j) => ({
            entityId: `Q${i * 1000 + j + 1}`,
            language: 'en',
            value: `Label ${i * 1000 + j + 1}`,
            type: 'label',
          }))

          return ctx.do.request('/index/labels/batch', {
            method: 'POST',
            body: JSON.stringify({ labels }),
          })
        },
      })

      record(result)

      const labelsPerSecond = (1000 / result.stats.p50) * 1000

      console.log('\n=== Bulk Label Index Update (1000 labels) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  Throughput: ${labelsPerSecond.toFixed(0)} labels/sec`)

      expect(result.stats.p95).toBeLessThan(500)
    })
  })
})

// ============================================================================
// MEMORY STABILITY BENCHMARKS
// ============================================================================

describe('Wikidata memory stability at scale', () => {
  describe('sustained ingest', () => {
    it('memory stable during extended ingest (100K entities)', async () => {
      const memorySnapshots: number[] = []
      const batchSize = 1000

      const result = await benchmark({
        name: 'wikidata-memory-sustained-100k',
        target: 'wiki.perf.do',
        iterations: 100, // 100 batches of 1000 = 100K entities
        warmup: 5,
        run: async (ctx, i) => {
          const entities = generateQItemBatch(batchSize, i * batchSize)
          const response = await ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({
              entities,
              includeMemoryStats: true,
            }),
          })

          const data = response as { memoryUsedMB?: number }
          if (data.memoryUsedMB !== undefined) {
            memorySnapshots.push(data.memoryUsedMB)
          }

          return response
        },
      })

      record(result)

      if (memorySnapshots.length > 0) {
        const initialMemory = memorySnapshots[0]!
        const maxMemory = Math.max(...memorySnapshots)
        const growthPercent = ((maxMemory - initialMemory) / initialMemory) * 100

        console.log('\n=== Memory Stability (100K Entities) ===')
        console.log(`  Total entities processed: ${result.iterations * batchSize}`)
        console.log(`  Initial memory: ${initialMemory.toFixed(1)} MB`)
        console.log(`  Max memory: ${maxMemory.toFixed(1)} MB`)
        console.log(`  Growth: ${growthPercent.toFixed(1)}%`)

        expect(growthPercent).toBeLessThan(MAX_MEMORY_GROWTH_PERCENT)
      }

      expect(result.samples.length).toBe(100)
    })

    it('memory reclaimed after partition flush', async () => {
      let memoryBeforeFlush = 0
      let memoryAfterFlush = 0

      const result = await benchmark({
        name: 'wikidata-memory-flush-reclaim',
        target: 'wiki.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx, i) => {
          // Fill buffer with entity data
          const entities = generateQItemBatch(5000, i * 5000)
          await ctx.do.request('/partition/entities/write', {
            method: 'POST',
            body: JSON.stringify({ entities }),
          })

          // Check memory before flush
          const beforeStats = await ctx.do.request<{ memoryUsedMB: number }>('/stats/memory', {
            method: 'GET',
          })
          if (i === 0) memoryBeforeFlush = beforeStats.memoryUsedMB

          // Flush partition
          await ctx.do.request('/partition/entities/flush', { method: 'POST' })

          // Check memory after flush
          const afterStats = await ctx.do.request<{ memoryUsedMB: number }>('/stats/memory', {
            method: 'GET',
          })
          memoryAfterFlush = afterStats.memoryUsedMB

          return afterStats
        },
        teardown: async (ctx) => {
          await ctx.do.request('/partition/entities/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Memory Reclamation After Flush ===')
      console.log(`  Memory before flush: ${memoryBeforeFlush.toFixed(1)} MB`)
      console.log(`  Memory after flush: ${memoryAfterFlush.toFixed(1)} MB`)

      // Memory should be reclaimed after flush
      expect(memoryAfterFlush).toBeLessThan(memoryBeforeFlush * 0.9)
    })
  })

  describe('large entity handling', () => {
    it('process entity with 500+ claims without OOM', async () => {
      const result = await benchmark({
        name: 'wikidata-large-entity-500-claims',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, i) => {
          const entity = generateQItem(i + 1)
          const claims = (entity as { claims: Record<string, unknown[]> }).claims

          // Add 500 claims
          for (let c = 0; c < 500; c++) {
            claims[`P${2000 + c}`] = [{
              mainsnak: {
                snaktype: 'value',
                property: `P${2000 + c}`,
                datavalue: { value: { id: `Q${c}` }, type: 'wikibase-entityid' },
              },
              type: 'statement',
              rank: 'normal',
            }]
          }

          return ctx.do.request('/ingest/entity', {
            method: 'POST',
            body: JSON.stringify(entity),
          })
        },
      })

      record(result)

      console.log('\n=== Large Entity (500 claims) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Should complete without errors
      expect(result.errors?.length ?? 0).toBe(0)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikidata Ingest Summary', () => {
  it('should document ingest performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIDATA INGEST PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Entity ingest: >${TARGET_ENTITIES_PER_MINUTE.toLocaleString()} entities/min`)
    console.log(`  - Entity write latency: <${MAX_ENTITY_WRITE_P95_MS}ms (p95)`)
    console.log(`  - Statement batch: <${MAX_STATEMENT_BATCH_P95_MS}ms (p95)`)
    console.log(`  - Memory growth: <${MAX_MEMORY_GROWTH_PERCENT}%`)
    console.log('')

    console.log('Dataset characteristics:')
    console.log('  - Total Q-items: ~100M')
    console.log('  - Total P-properties: ~10K')
    console.log('  - Total statements/edges: ~1.5B')
    console.log('  - Total labels/aliases: ~500M')
    console.log('  - Compressed dump size: ~100GB')
    console.log('')

    console.log('Partitioning strategy:')
    console.log('  - Entities: By QID prefix (Q1-Q999K, Q1M-Q9M, Q10M-Q99M, Q100M+)')
    console.log('  - Properties: Single partition (only ~10K)')
    console.log('  - Statements: By subject QID partition')
    console.log('  - Labels: By language code partition')
    console.log('')

    console.log('Streaming ingest pipeline:')
    console.log('  1. Stream gzipped JSON dump from Wikidata')
    console.log('  2. Parse entities line-by-line (JSONL format)')
    console.log('  3. Extract labels, claims, sitelinks')
    console.log('  4. Index in partitioned stores')
    console.log('  5. Build graph edges from claims')
    console.log('')

    expect(true).toBe(true)
  })
})
