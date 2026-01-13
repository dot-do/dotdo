/**
 * Wikidata Query Performance Benchmarks
 *
 * Tests query patterns on the Wikidata knowledge graph:
 * - Entity lookup by QID (Q42 = Douglas Adams)
 * - Property path traversal (P31 = instance of)
 * - SPARQL-like queries (subject-predicate-object patterns)
 * - "Instance of" hierarchy queries
 * - Cross-reference queries (Wikipedia <-> Wikidata)
 * - Label search (multilingual)
 * - Statement filtering by qualifiers
 *
 * Performance targets:
 * - QID lookup: <50ms p95
 * - Property path (3 hops): <200ms p95
 * - SPARQL-like query: <500ms p95
 * - Hierarchy traversal: <300ms p95
 *
 * Target namespace: wiki.org.ai
 *
 * @see https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service
 * @see dotdo-70c3y for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for QID lookup (ms)
 */
const MAX_QID_LOOKUP_P95_MS = 50

/**
 * Maximum acceptable p95 latency for property path traversal (ms)
 */
const MAX_PROPERTY_PATH_P95_MS = 200

/**
 * Maximum acceptable p95 latency for SPARQL-like queries (ms)
 */
const MAX_SPARQL_LIKE_P95_MS = 500

/**
 * Maximum acceptable p95 latency for hierarchy traversal (ms)
 */
const MAX_HIERARCHY_TRAVERSAL_P95_MS = 300

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA - REAL WIKIDATA QIDs AND PROPERTIES
// ============================================================================

/**
 * Notable Q-items for testing
 */
const NOTABLE_QIDS = {
  douglasAdams: 'Q42',
  earth: 'Q2',
  human: 'Q5',
  unitedStates: 'Q30',
  apple: 'Q312',
  microsoft: 'Q2283',
  albertEinstein: 'Q937',
  python: 'Q28865', // Python programming language
  javascript: 'Q2005', // JavaScript
  sanFrancisco: 'Q62',
  university: 'Q3918',
  scientist: 'Q901',
  writer: 'Q36180',
  softwareDeveloper: 'Q183888',
}

/**
 * Common properties for testing
 */
const COMMON_PROPERTIES = {
  instanceOf: 'P31',
  subclassOf: 'P279',
  partOf: 'P361',
  occupation: 'P106',
  placeOfBirth: 'P19',
  dateOfBirth: 'P569',
  country: 'P17',
  locatedIn: 'P131',
  officialLanguage: 'P37',
  developer: 'P178',
  programmingLanguage: 'P277',
  wikipedia: 'P373',
  image: 'P18',
}

// ============================================================================
// ENTITY LOOKUP BENCHMARKS
// ============================================================================

describe('Wikidata entity lookup by QID', () => {
  describe('single entity lookup', () => {
    it('lookup Q42 (Douglas Adams)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-qid-lookup-q42',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Ensure Q42 exists in test data
          await ctx.do.request('/entities/Q42', {
            method: 'PUT',
            body: JSON.stringify({
              id: 'Q42',
              type: 'item',
              labels: { en: { value: 'Douglas Adams', language: 'en' } },
              descriptions: { en: { value: 'English writer and humorist', language: 'en' } },
              claims: {
                P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], // instance of human
                P106: [{ mainsnak: { datavalue: { value: { id: 'Q36180' } } } }], // occupation: writer
              },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/entities/Q42')
        },
      })

      record(result)

      console.log('\n=== Q42 Lookup (Douglas Adams) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })

    it('random QID lookups across range', async () => {
      const result = await benchmark({
        name: 'wikidata-query-qid-random',
        target: 'wiki.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Pre-populate a range of entities
          for (let i = 1; i <= 1000; i++) {
            await ctx.do.request(`/entities/Q${i}`, {
              method: 'PUT',
              body: JSON.stringify({
                id: `Q${i}`,
                type: 'item',
                labels: { en: { value: `Entity ${i}`, language: 'en' } },
              }),
            })
          }
        },
        run: async (ctx) => {
          const qid = `Q${Math.floor(Math.random() * 1000) + 1}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Random QID Lookup (Q1-Q1000) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Stddev: ${result.stats.stddev.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
      // Variance should be reasonable
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 2)
    })

    it('batch QID lookup (10 entities)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-qid-batch',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          const qids = ['Q42', 'Q2', 'Q5', 'Q30', 'Q312', 'Q2283', 'Q937', 'Q28865', 'Q62', 'Q3918']
          return ctx.do.request('/entities/batch', {
            method: 'POST',
            body: JSON.stringify({ ids: qids }),
          })
        },
      })

      record(result)

      console.log('\n=== Batch QID Lookup (10 entities) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Batch should be efficient (not 10x single lookup)
      expect(result.stats.p50).toBeLessThan(MAX_QID_LOOKUP_P95_MS * 3)
    })
  })

  describe('property lookup', () => {
    it('lookup P31 (instance of)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-property-p31',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          await ctx.do.request('/properties/P31', {
            method: 'PUT',
            body: JSON.stringify({
              id: 'P31',
              type: 'property',
              datatype: 'wikibase-item',
              labels: { en: { value: 'instance of', language: 'en' } },
              descriptions: { en: { value: 'that class of which this subject is a particular example and member', language: 'en' } },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/properties/P31')
        },
      })

      record(result)

      console.log('\n=== P31 Lookup (instance of) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })
  })
})

// ============================================================================
// PROPERTY PATH TRAVERSAL BENCHMARKS
// ============================================================================

describe('Wikidata property path traversal', () => {
  describe('P31 (instance of) traversal', () => {
    it('single hop: Q42 -> P31 -> ?', async () => {
      const result = await benchmark({
        name: 'wikidata-query-p31-single-hop',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Q42 (Douglas Adams) -> P31 -> Q5 (human)
          await ctx.do.request('/statements', {
            method: 'POST',
            body: JSON.stringify({
              subject: 'Q42',
              predicate: 'P31',
              object: 'Q5',
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/statements?subject=Q42&predicate=P31')
        },
      })

      record(result)

      console.log('\n=== P31 Single Hop (Q42 -> P31 -> ?) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })

    it('two hop: Q42 -> P31 -> Q5 -> P279 -> ?', async () => {
      const result = await benchmark({
        name: 'wikidata-query-p31-p279-two-hop',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Q42 -> P31 -> Q5 (human)
          // Q5 -> P279 -> Q154954 (natural person)
          // Q5 -> P279 -> Q215627 (person)
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q5', predicate: 'P279', object: 'Q215627' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // First hop: get instance of
          const instanceOf = await ctx.do.list<{ object: string }>('/statements?subject=Q42&predicate=P31')

          // Second hop: get subclass of for each result
          const results = await Promise.all(
            instanceOf.map((stmt) =>
              ctx.do.list<{ object: string }>(`/statements?subject=${stmt.object}&predicate=P279`)
            )
          )

          return { path: ['Q42', 'Q5', ...results.flat().map((r) => r.object)] }
        },
      })

      record(result)

      console.log('\n=== Two Hop (Q42 -> P31 -> Q5 -> P279 -> ?) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PROPERTY_PATH_P95_MS)
    })

    it('three hop traversal with branching', async () => {
      const result = await benchmark({
        name: 'wikidata-query-three-hop-branch',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Build a branching type hierarchy
          // Q42 -> P31 -> Q5 (human)
          // Q5 -> P279 -> Q154954 (natural person)
          // Q5 -> P279 -> Q215627 (person)
          // Q154954 -> P279 -> Q35120 (entity)
          // Q215627 -> P279 -> Q35120 (entity)
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q5', predicate: 'P279', object: 'Q215627' },
                { subject: 'Q154954', predicate: 'P279', object: 'Q35120' },
                { subject: 'Q215627', predicate: 'P279', object: 'Q35120' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const maxDepth = 3
          const visited = new Set<string>()
          const allTypes: string[] = []

          const traverse = async (node: string, depth: number, predicate: string): Promise<void> => {
            if (depth > maxDepth || visited.has(node)) return
            visited.add(node)

            const nextPred = depth === 0 ? 'P31' : 'P279' // instance of, then subclass of
            const edges = await ctx.do.list<{ object: string }>(
              `/statements?subject=${node}&predicate=${nextPred}`
            )

            for (const edge of edges) {
              allTypes.push(edge.object)
              await traverse(edge.object, depth + 1, 'P279')
            }
          }

          await traverse('Q42', 0, 'P31')
          return { types: allTypes, depth: maxDepth }
        },
      })

      record(result)

      console.log('\n=== Three Hop Branching Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PROPERTY_PATH_P95_MS)
    })
  })

  describe('multi-property path', () => {
    it('occupation chain: person -> occupation -> field', async () => {
      const result = await benchmark({
        name: 'wikidata-query-occupation-chain',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Q937 (Einstein) -> P106 -> Q901 (scientist) -> P425 -> Q395 (physics)
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q937', predicate: 'P106', object: 'Q901' }, // occupation: scientist
                { subject: 'Q901', predicate: 'P425', object: 'Q395' }, // field of work: physics
                { subject: 'Q937', predicate: 'P106', object: 'Q170790' }, // occupation: mathematician
                { subject: 'Q170790', predicate: 'P425', object: 'Q395' }, // field of work: physics
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Get occupations
          const occupations = await ctx.do.list<{ object: string }>(
            '/statements?subject=Q937&predicate=P106'
          )

          // Get field of work for each occupation
          const fields = await Promise.all(
            occupations.map((occ) =>
              ctx.do.list<{ object: string }>(`/statements?subject=${occ.object}&predicate=P425`)
            )
          )

          return {
            person: 'Q937',
            occupations: occupations.map((o) => o.object),
            fields: [...new Set(fields.flat().map((f) => f.object))],
          }
        },
      })

      record(result)

      console.log('\n=== Occupation Chain (person -> occupation -> field) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PROPERTY_PATH_P95_MS)
    })
  })
})

// ============================================================================
// SPARQL-LIKE QUERY BENCHMARKS
// ============================================================================

describe('Wikidata SPARQL-like queries', () => {
  describe('subject-predicate-object patterns', () => {
    it('find all instances of human (? P31 Q5)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-sparql-instances-of-human',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create multiple humans
          const humans = ['Q42', 'Q937', 'Q76', 'Q5284', 'Q1339']
          for (const qid of humans) {
            await ctx.do.request('/statements', {
              method: 'POST',
              body: JSON.stringify({
                subject: qid,
                predicate: 'P31',
                object: 'Q5',
              }),
            })
          }
        },
        run: async (ctx) => {
          // Find all subjects where P31 = Q5 (instance of human)
          return ctx.do.list('/statements?predicate=P31&object=Q5')
        },
      })

      record(result)

      console.log('\n=== SPARQL-like: All instances of human ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SPARQL_LIKE_P95_MS)
    })

    it('find all properties of entity (Q42 ? ?)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-sparql-all-properties',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Add multiple statements for Q42
          const statements = [
            { subject: 'Q42', predicate: 'P31', object: 'Q5' },
            { subject: 'Q42', predicate: 'P106', object: 'Q36180' },
            { subject: 'Q42', predicate: 'P19', object: 'Q350' },
            { subject: 'Q42', predicate: 'P569', object: '+1952-03-11T00:00:00Z' },
            { subject: 'Q42', predicate: 'P27', object: 'Q145' },
          ]
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/statements?subject=Q42')
        },
      })

      record(result)

      console.log('\n=== SPARQL-like: All properties of Q42 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })

    it('find reverse links (? ? Q5)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-sparql-reverse-links',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Find all statements pointing to Q5
          return ctx.do.list('/statements?object=Q5')
        },
      })

      record(result)

      console.log('\n=== SPARQL-like: Reverse links to Q5 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SPARQL_LIKE_P95_MS)
    })

    it('complex pattern: humans born in Cambridge', async () => {
      const result = await benchmark({
        name: 'wikidata-query-sparql-humans-born-cambridge',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create test data: people born in Cambridge (Q350)
          const statements = [
            { subject: 'Q42', predicate: 'P31', object: 'Q5' },
            { subject: 'Q42', predicate: 'P19', object: 'Q350' },
            { subject: 'Q937', predicate: 'P31', object: 'Q5' },
            { subject: 'Q937', predicate: 'P19', object: 'Q64' }, // Berlin
            { subject: 'Q7251', predicate: 'P31', object: 'Q5' },
            { subject: 'Q7251', predicate: 'P19', object: 'Q350' },
          ]
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
        run: async (ctx) => {
          // Find humans (P31 = Q5) AND born in Cambridge (P19 = Q350)
          // Two-query intersection
          const [humans, bornInCambridge] = await Promise.all([
            ctx.do.list<{ subject: string }>('/statements?predicate=P31&object=Q5'),
            ctx.do.list<{ subject: string }>('/statements?predicate=P19&object=Q350'),
          ])

          const humanSet = new Set(humans.map((h) => h.subject))
          const result = bornInCambridge.filter((b) => humanSet.has(b.subject))

          return { matches: result.map((r) => r.subject) }
        },
      })

      record(result)

      console.log('\n=== SPARQL-like: Humans born in Cambridge ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SPARQL_LIKE_P95_MS)
    })
  })
})

// ============================================================================
// HIERARCHY QUERY BENCHMARKS
// ============================================================================

describe('Wikidata "instance of" hierarchy queries', () => {
  describe('type hierarchy traversal', () => {
    it('traverse P31/P279 chain (instance of / subclass of)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-hierarchy-p31-p279',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Build type hierarchy:
          // Q42 -> P31 -> Q5 (human)
          // Q5 -> P279 -> Q154954 (natural person)
          // Q154954 -> P279 -> Q215627 (person)
          // Q215627 -> P279 -> Q35120 (entity)
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q154954', predicate: 'P279', object: 'Q215627' },
                { subject: 'Q215627', predicate: 'P279', object: 'Q35120' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Traverse the full type hierarchy for Q42
          const typeChain: string[] = []
          const visited = new Set<string>()

          // Start with instance of
          const instanceOf = await ctx.do.list<{ object: string }>(
            '/statements?subject=Q42&predicate=P31'
          )

          const queue = instanceOf.map((s) => s.object)

          while (queue.length > 0) {
            const current = queue.shift()!
            if (visited.has(current)) continue
            visited.add(current)
            typeChain.push(current)

            // Follow subclass of
            const subclassOf = await ctx.do.list<{ object: string }>(
              `/statements?subject=${current}&predicate=P279`
            )

            for (const parent of subclassOf) {
              if (!visited.has(parent.object)) {
                queue.push(parent.object)
              }
            }
          }

          return { entity: 'Q42', typeChain }
        },
      })

      record(result)

      console.log('\n=== P31/P279 Hierarchy Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HIERARCHY_TRAVERSAL_P95_MS)
    })

    it('check if entity is instance of type (transitive)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-hierarchy-transitive-check',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Check if Q42 is transitively an instance of Q35120 (entity)
          const targetType = 'Q35120'
          const visited = new Set<string>()

          const isInstanceOf = async (entity: string): Promise<boolean> => {
            // Get direct instance of
            const directTypes = await ctx.do.list<{ object: string }>(
              `/statements?subject=${entity}&predicate=P31`
            )

            for (const type of directTypes) {
              if (type.object === targetType) return true
              if (visited.has(type.object)) continue
              visited.add(type.object)

              // Check subclass chain
              const queue = [type.object]
              while (queue.length > 0) {
                const current = queue.shift()!
                if (current === targetType) return true

                const parents = await ctx.do.list<{ object: string }>(
                  `/statements?subject=${current}&predicate=P279`
                )

                for (const parent of parents) {
                  if (parent.object === targetType) return true
                  if (!visited.has(parent.object)) {
                    visited.add(parent.object)
                    queue.push(parent.object)
                  }
                }
              }
            }

            return false
          }

          return { entity: 'Q42', isInstanceOf: targetType, result: await isInstanceOf('Q42') }
        },
      })

      record(result)

      console.log('\n=== Transitive Instance Check (Q42 -> Q35120) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HIERARCHY_TRAVERSAL_P95_MS)
    })

    it('find common ancestors of two entities', async () => {
      const result = await benchmark({
        name: 'wikidata-query-hierarchy-common-ancestor',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Q42 (Douglas Adams) and Q937 (Einstein) both are Q5 (human)
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q937', predicate: 'P31', object: 'Q5' },
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Get type hierarchies for both entities
          const getTypeChain = async (entity: string): Promise<Set<string>> => {
            const types = new Set<string>()
            const queue: string[] = []

            // Get instance of
            const instanceOf = await ctx.do.list<{ object: string }>(
              `/statements?subject=${entity}&predicate=P31`
            )
            queue.push(...instanceOf.map((s) => s.object))

            while (queue.length > 0) {
              const current = queue.shift()!
              if (types.has(current)) continue
              types.add(current)

              const parents = await ctx.do.list<{ object: string }>(
                `/statements?subject=${current}&predicate=P279`
              )
              queue.push(...parents.map((p) => p.object))
            }

            return types
          }

          const [types1, types2] = await Promise.all([
            getTypeChain('Q42'),
            getTypeChain('Q937'),
          ])

          // Find intersection
          const commonTypes = [...types1].filter((t) => types2.has(t))

          return { entity1: 'Q42', entity2: 'Q937', commonTypes }
        },
      })

      record(result)

      console.log('\n=== Common Ancestor (Q42 & Q937) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SPARQL_LIKE_P95_MS)
    })
  })
})

// ============================================================================
// CROSS-REFERENCE QUERY BENCHMARKS
// ============================================================================

describe('Wikidata cross-reference queries', () => {
  describe('Wikipedia sitelinks', () => {
    it('lookup by Wikipedia title', async () => {
      const result = await benchmark({
        name: 'wikidata-query-wikipedia-lookup',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Index Wikipedia sitelinks
          await ctx.do.request('/sitelinks/enwiki', {
            method: 'POST',
            body: JSON.stringify({
              entries: [
                { title: 'Douglas Adams', qid: 'Q42' },
                { title: 'Albert Einstein', qid: 'Q937' },
                { title: 'United States', qid: 'Q30' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/sitelinks/enwiki/Douglas%20Adams')
        },
      })

      record(result)

      console.log('\n=== Wikipedia Title Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })

    it('get all sitelinks for entity', async () => {
      const result = await benchmark({
        name: 'wikidata-query-entity-sitelinks',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          await ctx.do.request('/entities/Q42/sitelinks', {
            method: 'PUT',
            body: JSON.stringify({
              enwiki: { site: 'enwiki', title: 'Douglas Adams' },
              dewiki: { site: 'dewiki', title: 'Douglas Adams' },
              frwiki: { site: 'frwiki', title: 'Douglas Adams' },
              jawiki: { site: 'jawiki', title: '\u30C0\u30B0\u30E9\u30B9\u30FB\u30A2\u30C0\u30E0\u30BA' },
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/entities/Q42/sitelinks')
        },
      })

      record(result)

      console.log('\n=== Get Entity Sitelinks ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })
  })

  describe('external identifiers', () => {
    it('lookup by external ID (VIAF, GND, etc.)', async () => {
      const result = await benchmark({
        name: 'wikidata-query-external-id-lookup',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Index external identifiers
          await ctx.do.request('/identifiers/P214', { // VIAF
            method: 'POST',
            body: JSON.stringify({
              entries: [
                { value: '113230702', qid: 'Q42' },
                { value: '75121530', qid: 'Q937' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.get('/identifiers/P214/113230702')
        },
      })

      record(result)

      console.log('\n=== External ID Lookup (VIAF) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })
  })
})

// ============================================================================
// LABEL SEARCH BENCHMARKS
// ============================================================================

describe('Wikidata label search', () => {
  describe('multilingual search', () => {
    it('search English labels', async () => {
      const result = await benchmark({
        name: 'wikidata-query-label-search-en',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          // Index labels
          await ctx.do.request('/labels/index', {
            method: 'POST',
            body: JSON.stringify({
              labels: [
                { qid: 'Q42', language: 'en', value: 'Douglas Adams' },
                { qid: 'Q937', language: 'en', value: 'Albert Einstein' },
                { qid: 'Q5', language: 'en', value: 'human' },
                { qid: 'Q36180', language: 'en', value: 'writer' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          return ctx.do.list('/labels/search?q=Douglas&language=en')
        },
      })

      record(result)

      console.log('\n=== English Label Search ("Douglas") ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS * 2)
    })

    it('search across multiple languages', async () => {
      const result = await benchmark({
        name: 'wikidata-query-label-search-multilang',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Search in multiple languages
          const [en, de, fr] = await Promise.all([
            ctx.do.list('/labels/search?q=Einstein&language=en'),
            ctx.do.list('/labels/search?q=Einstein&language=de'),
            ctx.do.list('/labels/search?q=Einstein&language=fr'),
          ])

          return { en, de, fr }
        },
      })

      record(result)

      console.log('\n=== Multilingual Label Search ("Einstein") ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SPARQL_LIKE_P95_MS)
    })

    it('prefix search for autocomplete', async () => {
      const result = await benchmark({
        name: 'wikidata-query-label-prefix-search',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.list('/labels/search?q=Doug*&language=en&limit=10')
        },
      })

      record(result)

      console.log('\n=== Prefix Search for Autocomplete ("Doug*") ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })
  })
})

// ============================================================================
// STATEMENT FILTERING BENCHMARKS
// ============================================================================

describe('Wikidata statement filtering by qualifiers', () => {
  describe('qualifier filtering', () => {
    it('filter statements by time qualifier', async () => {
      const result = await benchmark({
        name: 'wikidata-query-filter-time-qualifier',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Create statements with time qualifiers
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                {
                  subject: 'Q76', // Obama
                  predicate: 'P39', // position held
                  object: 'Q11696', // President of the United States
                  qualifiers: { P580: '+2009-01-20T00:00:00Z', P582: '+2017-01-20T00:00:00Z' },
                },
                {
                  subject: 'Q76',
                  predicate: 'P39',
                  object: 'Q13217683', // US Senator
                  qualifiers: { P580: '+2005-01-03T00:00:00Z', P582: '+2008-11-16T00:00:00Z' },
                },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Find positions held after 2008
          return ctx.do.list('/statements?subject=Q76&predicate=P39&qualifier.P580[gte]=+2008-01-01T00:00:00Z')
        },
      })

      record(result)

      console.log('\n=== Filter by Time Qualifier ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS * 2)
    })

    it('filter statements by rank', async () => {
      const result = await benchmark({
        name: 'wikidata-query-filter-rank',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        setup: async (ctx) => {
          await ctx.do.request('/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P569', object: '+1952-03-11T00:00:00Z', rank: 'preferred' },
                { subject: 'Q42', predicate: 'P569', object: '+1952-03-12T00:00:00Z', rank: 'deprecated' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Get only preferred rank statements
          return ctx.do.list('/statements?subject=Q42&predicate=P569&rank=preferred')
        },
      })

      record(result)

      console.log('\n=== Filter by Rank (preferred) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS)
    })

    it('filter statements with references', async () => {
      const result = await benchmark({
        name: 'wikidata-query-filter-with-refs',
        target: 'wiki.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx) => {
          // Get only statements that have references
          return ctx.do.list('/statements?subject=Q42&hasReference=true')
        },
      })

      record(result)

      console.log('\n=== Filter Statements with References ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_QID_LOOKUP_P95_MS * 2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikidata Query Summary', () => {
  it('should document query performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIDATA QUERY PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - QID lookup: <${MAX_QID_LOOKUP_P95_MS}ms (p95)`)
    console.log(`  - Property path (3 hops): <${MAX_PROPERTY_PATH_P95_MS}ms (p95)`)
    console.log(`  - SPARQL-like query: <${MAX_SPARQL_LIKE_P95_MS}ms (p95)`)
    console.log(`  - Hierarchy traversal: <${MAX_HIERARCHY_TRAVERSAL_P95_MS}ms (p95)`)
    console.log('')

    console.log('Query patterns tested:')
    console.log('  - Entity lookup by QID (Q42, Q937, etc.)')
    console.log('  - Property lookup (P31, P279, P106, etc.)')
    console.log('  - Property path traversal (P31/P279 chains)')
    console.log('  - SPARQL-like triple patterns')
    console.log('  - Type hierarchy traversal')
    console.log('  - Cross-reference queries (Wikipedia <-> Wikidata)')
    console.log('  - Multilingual label search')
    console.log('  - Statement filtering by qualifiers/rank')
    console.log('')

    console.log('Index structures used:')
    console.log('  - QID -> Entity (primary lookup)')
    console.log('  - (Subject, Predicate) -> Objects (forward index)')
    console.log('  - (Predicate, Object) -> Subjects (reverse index)')
    console.log('  - Label -> QID (search index per language)')
    console.log('  - Sitelink -> QID (Wikipedia lookup)')
    console.log('  - ExternalID -> QID (identifier lookup)')
    console.log('')

    expect(true).toBe(true)
  })
})
