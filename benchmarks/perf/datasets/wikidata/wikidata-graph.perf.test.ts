/**
 * Wikidata Graph Performance Benchmarks
 *
 * Tests graph algorithm operations on the Wikidata knowledge graph:
 * - Shortest path between entities
 * - Entity similarity (shared properties)
 * - Subgraph extraction (N-hop neighborhood)
 * - Type hierarchy traversal (P31/P279 chains)
 * - Property usage statistics
 * - Connected component analysis
 *
 * The Wikidata graph has:
 * - ~100M Q-items (nodes)
 * - ~1.5B statements (edges)
 * - ~10K P-properties (edge types)
 *
 * Target namespace: wiki.org.ai
 *
 * @see dotdo-70c3y for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for shortest path (ms)
 */
const MAX_SHORTEST_PATH_P95_MS = 500

/**
 * Maximum acceptable p95 latency for similarity computation (ms)
 */
const MAX_SIMILARITY_P95_MS = 300

/**
 * Maximum acceptable p95 latency for subgraph extraction (ms)
 */
const MAX_SUBGRAPH_P95_MS = 500

/**
 * Maximum acceptable p95 latency for hierarchy traversal (ms)
 */
const MAX_HIERARCHY_P95_MS = 300

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 30

// ============================================================================
// TEST DATA - WIKIDATA GRAPH TOPOLOGY
// ============================================================================

/**
 * Common properties used for graph traversal
 */
const GRAPH_PROPERTIES = {
  instanceOf: 'P31',
  subclassOf: 'P279',
  partOf: 'P361',
  hasPart: 'P527',
  locatedIn: 'P131',
  country: 'P17',
  occupation: 'P106',
  employer: 'P108',
  educatedAt: 'P69',
  fieldOfWork: 'P101',
  influencedBy: 'P737',
  notableWork: 'P800',
  author: 'P50',
  developer: 'P178',
  genre: 'P136',
  follows: 'P155',
  followedBy: 'P156',
}

/**
 * Generate a chain of entities connected by a property
 */
function generateEntityChain(
  prefix: string,
  property: string,
  length: number
): Array<{ subject: string; predicate: string; object: string }> {
  const statements: Array<{ subject: string; predicate: string; object: string }> = []
  for (let i = 0; i < length - 1; i++) {
    statements.push({
      subject: `${prefix}${i}`,
      predicate: property,
      object: `${prefix}${i + 1}`,
    })
  }
  return statements
}

/**
 * Generate a star topology (one central node with many connections)
 */
function generateStarTopology(
  center: string,
  property: string,
  spokes: number
): Array<{ subject: string; predicate: string; object: string }> {
  return Array.from({ length: spokes }, (_, i) => ({
    subject: center,
    predicate: property,
    object: `${center}_spoke_${i}`,
  }))
}

// ============================================================================
// SHORTEST PATH BENCHMARKS
// ============================================================================

describe('Wikidata shortest path on knowledge graph', () => {
  describe('BFS shortest path', () => {
    it('shortest path between two humans (via shared type)', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-shortest-path-humans',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create test graph:
          // Q42 (Douglas Adams) -> P31 -> Q5 (human)
          // Q937 (Einstein) -> P31 -> Q5 (human)
          // So shortest path Q42 -> Q5 -> Q937 (via shared type)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q937', predicate: 'P31', object: 'Q5' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // BFS from Q42 to Q937
          const start = 'Q42'
          const target = 'Q937'
          const visited = new Set<string>([start])
          const queue: Array<{ node: string; path: string[] }> = [
            { node: start, path: [start] },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.node === target) {
              return { path: current.path, length: current.path.length - 1 }
            }

            // Get all outbound edges
            const outEdges = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current.node}`
            )
            for (const edge of outEdges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push({ node: edge.object, path: [...current.path, edge.object] })
              }
            }

            // Get all inbound edges (for undirected search)
            const inEdges = await ctx.do.list<{ subject: string }>(
              `/graph/edges/to/${current.node}`
            )
            for (const edge of inEdges) {
              if (!visited.has(edge.subject)) {
                visited.add(edge.subject)
                queue.push({ node: edge.subject, path: [...current.path, edge.subject] })
              }
            }
          }

          return { path: [], length: -1 } // No path found
        },
      })

      record(result)

      console.log('\n=== Shortest Path (Q42 -> Q937 via Q5) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SHORTEST_PATH_P95_MS)
    })

    it('shortest path with depth limit', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-shortest-path-depth-limit',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create a longer chain: Q1 -> Q2 -> Q3 -> Q4 -> Q5 -> Q6
          const chain = generateEntityChain('QPath', 'P361', 6)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements: chain }),
          })
        },
        run: async (ctx) => {
          const maxDepth = 3
          const start = 'QPath0'
          const target = 'QPath5'
          const visited = new Set<string>([start])
          const queue: Array<{ node: string; path: string[]; depth: number }> = [
            { node: start, path: [start], depth: 0 },
          ]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.node === target) {
              return { found: true, path: current.path, depth: current.depth }
            }

            if (current.depth >= maxDepth) continue

            const edges = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current.node}`
            )

            for (const edge of edges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push({
                  node: edge.object,
                  path: [...current.path, edge.object],
                  depth: current.depth + 1,
                })
              }
            }
          }

          return { found: false, path: [], depth: maxDepth }
        },
      })

      record(result)

      console.log('\n=== Shortest Path with Depth Limit (max 3) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SHORTEST_PATH_P95_MS)
    })

    it('shortest path via specific property', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-shortest-path-property',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create graph with mixed properties
          // We want to find path only via P279 (subclass of)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q154954', predicate: 'P279', object: 'Q215627' },
                { subject: 'Q215627', predicate: 'P279', object: 'Q35120' },
                // Alternative path via different property (should be ignored)
                { subject: 'Q5', predicate: 'P361', object: 'Q35120' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Find shortest path via P279 only
          const start = 'Q5'
          const target = 'Q35120'
          const property = 'P279'
          const visited = new Set<string>([start])
          const queue: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }]

          while (queue.length > 0) {
            const current = queue.shift()!
            if (current.node === target) {
              return { path: current.path, length: current.path.length - 1 }
            }

            const edges = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current.node}?predicate=${property}`
            )

            for (const edge of edges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push({ node: edge.object, path: [...current.path, edge.object] })
              }
            }
          }

          return { path: [], length: -1 }
        },
      })

      record(result)

      console.log('\n=== Shortest Path via P279 (subclass of) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SHORTEST_PATH_P95_MS)
    })

    it('bidirectional BFS for faster convergence', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-bidirectional-bfs',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a graph where bidirectional search converges faster
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                // Path from A: A -> B -> C -> D -> E
                { subject: 'QBidi_A', predicate: 'P361', object: 'QBidi_B' },
                { subject: 'QBidi_B', predicate: 'P361', object: 'QBidi_C' },
                { subject: 'QBidi_C', predicate: 'P361', object: 'QBidi_D' },
                { subject: 'QBidi_D', predicate: 'P361', object: 'QBidi_E' },
                // Cross connections for early meeting
                { subject: 'QBidi_B', predicate: 'P279', object: 'QBidi_D' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const start = 'QBidi_A'
          const end = 'QBidi_E'

          // Forward search from start
          const forwardVisited = new Map<string, string[]>([[start, [start]]])
          const forwardQueue: string[] = [start]

          // Backward search from end
          const backwardVisited = new Map<string, string[]>([[end, [end]]])
          const backwardQueue: string[] = [end]

          let meetingPoint: string | null = null
          let iterations = 0
          const maxIterations = 20

          while (forwardQueue.length > 0 && backwardQueue.length > 0 && iterations < maxIterations) {
            iterations++

            // Expand forward
            if (forwardQueue.length > 0) {
              const current = forwardQueue.shift()!
              const edges = await ctx.do.list<{ object: string }>(`/graph/edges/from/${current}`)

              for (const edge of edges) {
                if (backwardVisited.has(edge.object)) {
                  meetingPoint = edge.object
                  break
                }
                if (!forwardVisited.has(edge.object)) {
                  forwardVisited.set(edge.object, [...forwardVisited.get(current)!, edge.object])
                  forwardQueue.push(edge.object)
                }
              }
            }

            if (meetingPoint) break

            // Expand backward
            if (backwardQueue.length > 0) {
              const current = backwardQueue.shift()!
              const edges = await ctx.do.list<{ subject: string }>(`/graph/edges/to/${current}`)

              for (const edge of edges) {
                if (forwardVisited.has(edge.subject)) {
                  meetingPoint = edge.subject
                  break
                }
                if (!backwardVisited.has(edge.subject)) {
                  backwardVisited.set(edge.subject, [edge.subject, ...backwardVisited.get(current)!])
                  backwardQueue.push(edge.subject)
                }
              }
            }

            if (meetingPoint) break
          }

          if (meetingPoint) {
            const forwardPath = forwardVisited.get(meetingPoint) || []
            const backwardPath = backwardVisited.get(meetingPoint) || []
            return {
              found: true,
              path: [...forwardPath, ...backwardPath.slice(1)],
              meetingPoint,
            }
          }

          return { found: false, path: [] }
        },
      })

      record(result)

      console.log('\n=== Bidirectional BFS ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SHORTEST_PATH_P95_MS)
    })
  })
})

// ============================================================================
// ENTITY SIMILARITY BENCHMARKS
// ============================================================================

describe('Wikidata entity similarity', () => {
  describe('shared properties', () => {
    it('compute Jaccard similarity of properties', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-similarity-jaccard',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Q42 and Q937 share some properties
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                // Q42 properties
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q42', predicate: 'P106', object: 'Q36180' },
                { subject: 'Q42', predicate: 'P27', object: 'Q145' },
                { subject: 'Q42', predicate: 'P19', object: 'Q350' },
                // Q937 properties
                { subject: 'Q937', predicate: 'P31', object: 'Q5' },
                { subject: 'Q937', predicate: 'P106', object: 'Q901' },
                { subject: 'Q937', predicate: 'P27', object: 'Q183' },
                { subject: 'Q937', predicate: 'P19', object: 'Q3012' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Get all properties for both entities
          const [props1, props2] = await Promise.all([
            ctx.do.list<{ predicate: string; object: string }>('/graph/edges/from/Q42'),
            ctx.do.list<{ predicate: string; object: string }>('/graph/edges/from/Q937'),
          ])

          // Create property sets (predicate:object pairs)
          const set1 = new Set(props1.map((p) => `${p.predicate}:${p.object}`))
          const set2 = new Set(props2.map((p) => `${p.predicate}:${p.object}`))

          // Compute Jaccard similarity
          const intersection = [...set1].filter((x) => set2.has(x)).length
          const union = new Set([...set1, ...set2]).size
          const jaccard = intersection / union

          return {
            entity1: 'Q42',
            entity2: 'Q937',
            intersection,
            union,
            jaccardSimilarity: jaccard,
          }
        },
      })

      record(result)

      console.log('\n=== Jaccard Similarity (Q42 vs Q937) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })

    it('find entities with most shared types', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-similarity-shared-types',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create multiple entities with overlapping types
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                // Writers
                { subject: 'Q42', predicate: 'P31', object: 'Q5' },
                { subject: 'Q42', predicate: 'P31', object: 'Q36180' },
                { subject: 'Q7251', predicate: 'P31', object: 'Q5' },
                { subject: 'Q7251', predicate: 'P31', object: 'Q36180' },
                // Scientists
                { subject: 'Q937', predicate: 'P31', object: 'Q5' },
                { subject: 'Q937', predicate: 'P31', object: 'Q901' },
                { subject: 'Q7186', predicate: 'P31', object: 'Q5' },
                { subject: 'Q7186', predicate: 'P31', object: 'Q901' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const targetEntity = 'Q42'

          // Get types of target entity
          const targetTypes = await ctx.do.list<{ object: string }>(
            `/graph/edges/from/${targetEntity}?predicate=P31`
          )
          const targetTypeSet = new Set(targetTypes.map((t) => t.object))

          // Find entities sharing same types
          const candidates = ['Q7251', 'Q937', 'Q7186']
          const similarities: Array<{ entity: string; sharedTypes: number }> = []

          for (const candidate of candidates) {
            const candidateTypes = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${candidate}?predicate=P31`
            )

            const shared = candidateTypes.filter((t) => targetTypeSet.has(t.object)).length
            similarities.push({ entity: candidate, sharedTypes: shared })
          }

          // Sort by shared types descending
          similarities.sort((a, b) => b.sharedTypes - a.sharedTypes)

          return { target: targetEntity, mostSimilar: similarities }
        },
      })

      record(result)

      console.log('\n=== Find Most Similar by Types ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })

    it('compute property overlap ratio', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-similarity-overlap',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const entity1 = 'Q42'
          const entity2 = 'Q937'

          // Get all predicates used by each entity
          const [edges1, edges2] = await Promise.all([
            ctx.do.list<{ predicate: string }>(`/graph/edges/from/${entity1}`),
            ctx.do.list<{ predicate: string }>(`/graph/edges/from/${entity2}`),
          ])

          const predicates1 = new Set(edges1.map((e) => e.predicate))
          const predicates2 = new Set(edges2.map((e) => e.predicate))

          // Compute overlap
          const sharedPredicates = [...predicates1].filter((p) => predicates2.has(p))
          const overlapRatio = sharedPredicates.length / Math.min(predicates1.size, predicates2.size)

          return {
            entity1,
            entity2,
            predicates1: predicates1.size,
            predicates2: predicates2.size,
            sharedPredicates: sharedPredicates.length,
            overlapRatio,
          }
        },
      })

      record(result)

      console.log('\n=== Property Overlap Ratio ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })
  })
})

// ============================================================================
// SUBGRAPH EXTRACTION BENCHMARKS
// ============================================================================

describe('Wikidata subgraph extraction', () => {
  describe('N-hop neighborhood', () => {
    it('extract 1-hop neighborhood', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-subgraph-1hop',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create star topology around Q42
          const statements = generateStarTopology('Q42', 'P361', 10)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
        run: async (ctx) => {
          const center = 'Q42'
          const nodes = new Set<string>([center])
          const edges: Array<{ from: string; to: string; predicate: string }> = []

          // Get outbound edges
          const outEdges = await ctx.do.list<{ predicate: string; object: string }>(
            `/graph/edges/from/${center}`
          )
          for (const edge of outEdges) {
            nodes.add(edge.object)
            edges.push({ from: center, to: edge.object, predicate: edge.predicate })
          }

          // Get inbound edges
          const inEdges = await ctx.do.list<{ predicate: string; subject: string }>(
            `/graph/edges/to/${center}`
          )
          for (const edge of inEdges) {
            nodes.add(edge.subject)
            edges.push({ from: edge.subject, to: center, predicate: edge.predicate })
          }

          return { center, nodeCount: nodes.size, edgeCount: edges.length }
        },
      })

      record(result)

      console.log('\n=== 1-Hop Neighborhood ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SUBGRAPH_P95_MS / 2)
    })

    it('extract 2-hop neighborhood', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-subgraph-2hop',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create 2-level tree
          const statements: Array<{ subject: string; predicate: string; object: string }> = []
          for (let i = 0; i < 5; i++) {
            statements.push({ subject: 'QSub_center', predicate: 'P361', object: `QSub_L1_${i}` })
            for (let j = 0; j < 3; j++) {
              statements.push({
                subject: `QSub_L1_${i}`,
                predicate: 'P361',
                object: `QSub_L2_${i}_${j}`,
              })
            }
          }
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({ statements }),
          })
        },
        run: async (ctx) => {
          const center = 'QSub_center'
          const maxHops = 2
          const nodes = new Set<string>([center])
          const edges: Array<{ from: string; to: string; predicate: string }> = []
          const queue: Array<{ node: string; depth: number }> = [{ node: center, depth: 0 }]
          const visited = new Set<string>([center])

          while (queue.length > 0) {
            const current = queue.shift()!

            if (current.depth < maxHops) {
              const outEdges = await ctx.do.list<{ predicate: string; object: string }>(
                `/graph/edges/from/${current.node}`
              )

              for (const edge of outEdges) {
                nodes.add(edge.object)
                edges.push({ from: current.node, to: edge.object, predicate: edge.predicate })

                if (!visited.has(edge.object)) {
                  visited.add(edge.object)
                  queue.push({ node: edge.object, depth: current.depth + 1 })
                }
              }
            }
          }

          return { center, maxHops, nodeCount: nodes.size, edgeCount: edges.length }
        },
      })

      record(result)

      console.log('\n=== 2-Hop Neighborhood ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SUBGRAPH_P95_MS)
    })

    it('extract subgraph filtered by property', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-subgraph-filtered',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create graph with mixed properties
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'QFilter_A', predicate: 'P279', object: 'QFilter_B' },
                { subject: 'QFilter_B', predicate: 'P279', object: 'QFilter_C' },
                { subject: 'QFilter_A', predicate: 'P361', object: 'QFilter_D' }, // Should be excluded
                { subject: 'QFilter_C', predicate: 'P279', object: 'QFilter_E' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const start = 'QFilter_A'
          const filterProperty = 'P279'
          const nodes = new Set<string>([start])
          const edges: Array<{ from: string; to: string }> = []
          const queue: string[] = [start]
          const visited = new Set<string>([start])

          while (queue.length > 0) {
            const current = queue.shift()!

            // Only follow edges with the filter property
            const filteredEdges = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current}?predicate=${filterProperty}`
            )

            for (const edge of filteredEdges) {
              nodes.add(edge.object)
              edges.push({ from: current, to: edge.object })

              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push(edge.object)
              }
            }
          }

          return { start, filterProperty, nodeCount: nodes.size, edgeCount: edges.length }
        },
      })

      record(result)

      console.log('\n=== Property-Filtered Subgraph ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SUBGRAPH_P95_MS)
    })
  })
})

// ============================================================================
// TYPE HIERARCHY TRAVERSAL BENCHMARKS
// ============================================================================

describe('Wikidata type hierarchy traversal (P31/P279 chains)', () => {
  describe('class hierarchy', () => {
    it('traverse full type hierarchy', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-hierarchy-full',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create type hierarchy:
          // Q5 (human) -> P279 -> Q154954 (natural person)
          // Q154954 -> P279 -> Q215627 (person)
          // Q215627 -> P279 -> Q35120 (entity)
          // Q35120 -> P279 -> Q99527517 (thing)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q154954', predicate: 'P279', object: 'Q215627' },
                { subject: 'Q215627', predicate: 'P279', object: 'Q35120' },
                { subject: 'Q35120', predicate: 'P279', object: 'Q99527517' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const start = 'Q5'
          const hierarchy: string[] = [start]
          const visited = new Set<string>([start])
          let current = start

          // Traverse up the hierarchy
          while (true) {
            const parents = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current}?predicate=P279`
            )

            if (parents.length === 0) break

            // Take first parent (could be multiple inheritance)
            const parent = parents[0]!.object
            if (visited.has(parent)) break

            visited.add(parent)
            hierarchy.push(parent)
            current = parent
          }

          return { start, hierarchy, depth: hierarchy.length - 1 }
        },
      })

      record(result)

      console.log('\n=== Full Type Hierarchy Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HIERARCHY_P95_MS)
    })

    it('find all subclasses (reverse hierarchy)', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-hierarchy-subclasses',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        setup: async (ctx) => {
          // Create subclass tree under Q35120 (entity)
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                { subject: 'Q215627', predicate: 'P279', object: 'Q35120' },
                { subject: 'Q154954', predicate: 'P279', object: 'Q215627' },
                { subject: 'Q5', predicate: 'P279', object: 'Q154954' },
                { subject: 'Q729', predicate: 'P279', object: 'Q35120' }, // Animal
                { subject: 'Q7377', predicate: 'P279', object: 'Q729' }, // Mammal
              ],
            }),
          })
        },
        run: async (ctx) => {
          const rootClass = 'Q35120'
          const subclasses = new Set<string>()
          const queue: string[] = [rootClass]
          const visited = new Set<string>([rootClass])

          while (queue.length > 0) {
            const current = queue.shift()!

            // Find all classes that have this as superclass
            const children = await ctx.do.list<{ subject: string }>(
              `/graph/edges/to/${current}?predicate=P279`
            )

            for (const child of children) {
              subclasses.add(child.subject)
              if (!visited.has(child.subject)) {
                visited.add(child.subject)
                queue.push(child.subject)
              }
            }
          }

          return { rootClass, subclassCount: subclasses.size, subclasses: [...subclasses] }
        },
      })

      record(result)

      console.log('\n=== Find All Subclasses ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HIERARCHY_P95_MS)
    })

    it('compute hierarchy depth', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-hierarchy-depth',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const entity = 'Q5' // Human
          let depth = 0
          let current = entity
          const path: string[] = [current]

          while (depth < 20) { // Max depth limit
            const parents = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current}?predicate=P279`
            )

            if (parents.length === 0) break

            current = parents[0]!.object
            if (path.includes(current)) break // Cycle detection

            path.push(current)
            depth++
          }

          return { entity, depth, path }
        },
      })

      record(result)

      console.log('\n=== Compute Hierarchy Depth ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_HIERARCHY_P95_MS)
    })
  })
})

// ============================================================================
// PROPERTY USAGE STATISTICS BENCHMARKS
// ============================================================================

describe('Wikidata property usage statistics', () => {
  describe('property distribution', () => {
    it('count entities using property', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-property-usage-count',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          // Count how many entities use P31 (instance of)
          const stats = await ctx.do.get<{ count: number }>('/graph/stats/property/P31')
          return stats
        },
      })

      record(result)

      console.log('\n=== Property Usage Count (P31) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })

    it('get property value distribution', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-property-distribution',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Get distribution of values for P31 (most common types)
          const distribution = await ctx.do.list<{ value: string; count: number }>(
            '/graph/stats/property/P31/distribution?limit=10'
          )
          return { property: 'P31', topValues: distribution }
        },
      })

      record(result)

      console.log('\n=== Property Value Distribution (P31) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })

    it('compute property co-occurrence', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-property-cooccurrence',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create entities with various property combinations
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                // Entities with P31 and P106
                { subject: 'QCooc1', predicate: 'P31', object: 'Q5' },
                { subject: 'QCooc1', predicate: 'P106', object: 'Q36180' },
                { subject: 'QCooc2', predicate: 'P31', object: 'Q5' },
                { subject: 'QCooc2', predicate: 'P106', object: 'Q901' },
                // Entity with only P31
                { subject: 'QCooc3', predicate: 'P31', object: 'Q5' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          // Find properties commonly used together with P31
          const cooccurrence = await ctx.do.list<{ property: string; cooccurrenceRate: number }>(
            '/graph/stats/property/P31/cooccurrence?limit=5'
          )
          return { baseProperty: 'P31', cooccurringProperties: cooccurrence }
        },
      })

      record(result)

      console.log('\n=== Property Co-occurrence (P31) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SIMILARITY_P95_MS)
    })
  })
})

// ============================================================================
// CONNECTED COMPONENT ANALYSIS BENCHMARKS
// ============================================================================

describe('Wikidata connected component analysis', () => {
  describe('component discovery', () => {
    it('find connected component from entity', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-component-discovery',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        setup: async (ctx) => {
          // Create a connected component
          await ctx.do.request('/graph/statements/batch', {
            method: 'POST',
            body: JSON.stringify({
              statements: [
                // Component 1
                { subject: 'QComp1_A', predicate: 'P361', object: 'QComp1_B' },
                { subject: 'QComp1_B', predicate: 'P361', object: 'QComp1_C' },
                { subject: 'QComp1_C', predicate: 'P361', object: 'QComp1_A' }, // Cycle
                // Component 2 (disconnected)
                { subject: 'QComp2_A', predicate: 'P361', object: 'QComp2_B' },
              ],
            }),
          })
        },
        run: async (ctx) => {
          const start = 'QComp1_A'
          const component = new Set<string>([start])
          const queue: string[] = [start]
          const visited = new Set<string>([start])

          while (queue.length > 0) {
            const current = queue.shift()!

            // Get all connected nodes (both directions)
            const [outEdges, inEdges] = await Promise.all([
              ctx.do.list<{ object: string }>(`/graph/edges/from/${current}`),
              ctx.do.list<{ subject: string }>(`/graph/edges/to/${current}`),
            ])

            for (const edge of outEdges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                component.add(edge.object)
                queue.push(edge.object)
              }
            }

            for (const edge of inEdges) {
              if (!visited.has(edge.subject)) {
                visited.add(edge.subject)
                component.add(edge.subject)
                queue.push(edge.subject)
              }
            }
          }

          return { start, componentSize: component.size, members: [...component] }
        },
      })

      record(result)

      console.log('\n=== Connected Component Discovery ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SUBGRAPH_P95_MS)
    })

    it('compute component size without full extraction', async () => {
      const result = await benchmark({
        name: 'wikidata-graph-component-size',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          const start = 'QComp1_A'
          let size = 0
          const visited = new Set<string>([start])
          const queue: string[] = [start]

          while (queue.length > 0) {
            const current = queue.shift()!
            size++

            const [outEdges, inEdges] = await Promise.all([
              ctx.do.list<{ object: string }>(`/graph/edges/from/${current}`),
              ctx.do.list<{ subject: string }>(`/graph/edges/to/${current}`),
            ])

            for (const edge of outEdges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push(edge.object)
              }
            }

            for (const edge of inEdges) {
              if (!visited.has(edge.subject)) {
                visited.add(edge.subject)
                queue.push(edge.subject)
              }
            }
          }

          return { start, componentSize: size }
        },
      })

      record(result)

      console.log('\n=== Component Size Computation ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_SUBGRAPH_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikidata Graph Summary', () => {
  it('should document graph performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIDATA GRAPH PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Shortest path: <${MAX_SHORTEST_PATH_P95_MS}ms (p95)`)
    console.log(`  - Entity similarity: <${MAX_SIMILARITY_P95_MS}ms (p95)`)
    console.log(`  - Subgraph extraction: <${MAX_SUBGRAPH_P95_MS}ms (p95)`)
    console.log(`  - Hierarchy traversal: <${MAX_HIERARCHY_P95_MS}ms (p95)`)
    console.log('')

    console.log('Graph characteristics:')
    console.log('  - Nodes (Q-items): ~100M')
    console.log('  - Edges (statements): ~1.5B')
    console.log('  - Edge types (properties): ~10K')
    console.log('  - Average degree: ~15 edges per node')
    console.log('  - Key properties: P31 (instance of), P279 (subclass of)')
    console.log('')

    console.log('Algorithms tested:')
    console.log('  - Shortest path (BFS, bidirectional)')
    console.log('  - Entity similarity (Jaccard, shared types)')
    console.log('  - Subgraph extraction (N-hop neighborhood)')
    console.log('  - Type hierarchy traversal (P31/P279 chains)')
    console.log('  - Property usage statistics')
    console.log('  - Connected component analysis')
    console.log('')

    console.log('Index structures:')
    console.log('  - Forward index: (subject, predicate) -> objects')
    console.log('  - Reverse index: (predicate, object) -> subjects')
    console.log('  - Type index: entity -> all types (transitive)')
    console.log('  - Property stats: predicate -> usage count')
    console.log('')

    expect(true).toBe(true)
  })
})
