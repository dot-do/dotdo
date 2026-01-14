/**
 * Wikidata Scale Performance Benchmarks
 *
 * Tests operations at Wikidata scale:
 * - 100M entity scale lookups
 * - 1.5B edge graph traversals
 * - Partitioned query routing
 * - Cross-partition scatter-gather
 * - Index effectiveness at scale
 * - Memory and throughput limits
 *
 * These benchmarks validate that the system can handle the full
 * Wikidata knowledge graph without degradation.
 *
 * Target namespace: wiki.org.ai
 *
 * @see dotdo-70c3y for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record, benchmarkSuite } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Wikidata scale metrics
 */
const WIKIDATA_SCALE = {
  entities: 100_000_000, // 100M Q-items
  properties: 10_000, // 10K P-properties
  statements: 1_500_000_000, // 1.5B edges
  labels: 500_000_000, // 500M labels/aliases
}

/**
 * Partition configuration
 */
const PARTITION_CONFIG = {
  entityPartitions: 1000, // 100K entities per partition
  statementPartitions: 10000, // 150K statements per partition
  labelPartitions: 500, // 1M labels per partition
}

/**
 * Performance targets at scale
 */
const SCALE_TARGETS = {
  entityLookupP95Ms: 50,
  batchLookupP95Ms: 200,
  graphTraversalP95Ms: 500,
  scatterGatherP95Ms: 300,
  indexQueryP95Ms: 100,
}

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 30

// ============================================================================
// 100M ENTITY SCALE LOOKUPS
// ============================================================================

describe('Wikidata 100M entity scale lookups', () => {
  describe('single entity lookup at scale', () => {
    it('lookup entity from beginning of QID space (Q1-Q1M)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-lookup-low-qid',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        datasetSize: WIKIDATA_SCALE.entities,
        run: async (ctx, i) => {
          // Low QID range (heavily accessed, likely cached)
          const qid = `Q${(i % 1000) + 1}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Low QID Lookup (Q1-Q1000) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
    })

    it('lookup entity from middle of QID space (Q50M range)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-lookup-mid-qid',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        datasetSize: WIKIDATA_SCALE.entities,
        run: async (ctx, i) => {
          // Mid QID range
          const qid = `Q${50_000_000 + (i % 1000)}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Mid QID Lookup (Q50M range) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
    })

    it('lookup entity from end of QID space (Q100M range)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-lookup-high-qid',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        datasetSize: WIKIDATA_SCALE.entities,
        run: async (ctx, i) => {
          // High QID range (newest entities, less cached)
          const qid = `Q${99_000_000 + (i % 1000)}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== High QID Lookup (Q99M range) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
    })

    it('random QID lookup across full range', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-lookup-random',
        target: 'wiki.perf.do',
        iterations: 100,
        warmup: 20,
        datasetSize: WIKIDATA_SCALE.entities,
        run: async (ctx) => {
          // Random QID across full 100M range
          const qid = `Q${Math.floor(Math.random() * WIKIDATA_SCALE.entities) + 1}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Random QID Lookup (Q1-Q100M) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Stddev: ${result.stats.stddev.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
      // Variance should be reasonable across full range
      expect(result.stats.stddev).toBeLessThan(result.stats.mean * 3)
    })
  })

  describe('batch entity lookup at scale', () => {
    it('batch lookup 100 entities across partitions', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-batch-100',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        datasetSize: 100,
        run: async (ctx) => {
          // Generate 100 QIDs distributed across partitions
          const qids = Array.from({ length: 100 }, (_, i) => {
            const partition = i % PARTITION_CONFIG.entityPartitions
            const offset = Math.floor(Math.random() * 100000)
            return `Q${partition * 100000 + offset}`
          })

          return ctx.do.request('/entities/batch', {
            method: 'POST',
            body: JSON.stringify({ ids: qids }),
          })
        },
      })

      record(result)

      console.log('\n=== Batch Lookup (100 entities, cross-partition) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.batchLookupP95Ms)
    })

    it('batch lookup 1000 entities', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-batch-1000',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: 1000,
        run: async (ctx) => {
          const qids = Array.from({ length: 1000 }, () =>
            `Q${Math.floor(Math.random() * WIKIDATA_SCALE.entities) + 1}`
          )

          return ctx.do.request('/entities/batch', {
            method: 'POST',
            body: JSON.stringify({ ids: qids }),
          })
        },
      })

      record(result)

      const entitiesPerSecond = (1000 / result.stats.p50) * 1000

      console.log('\n=== Batch Lookup (1000 entities) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${entitiesPerSecond.toFixed(0)} entities/sec`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.batchLookupP95Ms * 5)
    })
  })
})

// ============================================================================
// 1.5B EDGE GRAPH TRAVERSALS
// ============================================================================

describe('Wikidata 1.5B edge graph traversals', () => {
  describe('high-degree node traversal', () => {
    it('traverse from high-degree node (Q5 = human, millions of instances)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-high-degree-node',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: WIKIDATA_SCALE.statements,
        run: async (ctx) => {
          // Q5 (human) has millions of incoming P31 edges
          // Test paginated traversal
          const pageSize = 1000
          const results = await ctx.do.list<{ subject: string }>(
            `/graph/edges/to/Q5?predicate=P31&limit=${pageSize}`
          )

          return { nodeCount: results.length, hasMore: results.length === pageSize }
        },
      })

      record(result)

      console.log('\n=== High-Degree Node (Q5, first 1000) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.graphTraversalP95Ms)
    })

    it('paginated traversal through high-degree node', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-paginated-traversal',
        target: 'wiki.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Fetch multiple pages
          const pageSize = 1000
          const pagesToFetch = 5
          let totalFetched = 0
          let cursor: string | undefined

          for (let i = 0; i < pagesToFetch; i++) {
            const url = cursor
              ? `/graph/edges/to/Q5?predicate=P31&limit=${pageSize}&cursor=${cursor}`
              : `/graph/edges/to/Q5?predicate=P31&limit=${pageSize}`

            const response = await ctx.do.request<{
              results: unknown[]
              nextCursor?: string
            }>(url)

            totalFetched += response.results.length
            cursor = response.nextCursor

            if (!cursor) break
          }

          return { totalFetched, pagesRead: pagesToFetch }
        },
      })

      record(result)

      console.log('\n=== Paginated Traversal (5 pages of 1000) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.graphTraversalP95Ms * 3)
    })
  })

  describe('multi-hop traversal at scale', () => {
    it('3-hop traversal through type hierarchy', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-3hop-hierarchy',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        datasetSize: WIKIDATA_SCALE.statements,
        run: async (ctx) => {
          // Random entity -> P31 -> P279 -> P279 (3 hops)
          const startQid = `Q${Math.floor(Math.random() * 1000000) + 1}`
          const visited = new Set<string>()
          let current = startQid
          const path = [current]

          // Hop 1: instance of
          const instanceOf = await ctx.do.list<{ object: string }>(
            `/graph/edges/from/${current}?predicate=P31&limit=1`
          )
          if (instanceOf.length === 0) return { path, depth: 0 }

          current = instanceOf[0]!.object
          path.push(current)
          visited.add(current)

          // Hop 2 & 3: subclass of
          for (let hop = 0; hop < 2; hop++) {
            const subclassOf = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current}?predicate=P279&limit=1`
            )
            if (subclassOf.length === 0) break

            current = subclassOf[0]!.object
            if (visited.has(current)) break
            visited.add(current)
            path.push(current)
          }

          return { path, depth: path.length - 1 }
        },
      })

      record(result)

      console.log('\n=== 3-Hop Type Hierarchy Traversal ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.graphTraversalP95Ms)
    })

    it('breadth-first exploration (limited fan-out)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-bfs-limited',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          const start = 'Q42' // Douglas Adams
          const maxNodes = 50
          const maxDepth = 2
          const visited = new Set<string>([start])
          const queue: Array<{ node: string; depth: number }> = [{ node: start, depth: 0 }]
          let nodesVisited = 0

          while (queue.length > 0 && nodesVisited < maxNodes) {
            const current = queue.shift()!
            nodesVisited++

            if (current.depth >= maxDepth) continue

            // Limit fan-out to 10 edges per node
            const edges = await ctx.do.list<{ object: string }>(
              `/graph/edges/from/${current.node}?limit=10`
            )

            for (const edge of edges) {
              if (!visited.has(edge.object)) {
                visited.add(edge.object)
                queue.push({ node: edge.object, depth: current.depth + 1 })
              }
            }
          }

          return { nodesVisited, maxDepth }
        },
      })

      record(result)

      console.log('\n=== BFS with Limited Fan-out ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.graphTraversalP95Ms)
    })
  })
})

// ============================================================================
// PARTITIONED QUERY ROUTING
// ============================================================================

describe('Wikidata partitioned query routing', () => {
  describe('partition-aware routing', () => {
    it('route query to correct entity partition', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-partition-routing',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          // Query should be routed to partition based on QID
          const qid = `Q${i * 100000 + 1}` // Each iteration hits different partition
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Partition-Aware Entity Routing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Stddev: ${result.stats.stddev.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
      // Routing should be consistent across partitions
      expect(result.stats.stddev).toBeLessThan(result.stats.mean)
    })

    it('route query to correct statement partition', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-statement-partition-routing',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          // Statement partition based on subject QID
          const qid = `Q${i * 100000 + 1}`
          return ctx.do.list(`/graph/edges/from/${qid}?limit=10`)
        },
      })

      record(result)

      console.log('\n=== Partition-Aware Statement Routing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })

    it('route query to correct label partition', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-label-partition-routing',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          // Label partition based on language
          const languages = ['en', 'de', 'fr', 'es', 'ja', 'zh', 'ru', 'pt', 'it', 'ar']
          const lang = languages[i % languages.length]
          const qid = `Q${(i % 1000) + 1}`

          return ctx.do.get(`/entities/${qid}/label/${lang}`)
        },
      })

      record(result)

      console.log('\n=== Partition-Aware Label Routing ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.entityLookupP95Ms)
    })
  })
})

// ============================================================================
// CROSS-PARTITION SCATTER-GATHER
// ============================================================================

describe('Wikidata cross-partition scatter-gather', () => {
  describe('multi-partition queries', () => {
    it('scatter-gather across 10 entity partitions', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-scatter-gather-10',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 5,
        run: async (ctx) => {
          // Generate QIDs from 10 different partitions
          const qids = Array.from({ length: 10 }, (_, i) =>
            `Q${i * 10_000_000 + Math.floor(Math.random() * 100000)}`
          )

          // Parallel fetch across partitions
          const results = await Promise.all(
            qids.map((qid) => ctx.do.get(`/entities/${qid}`).catch(() => null))
          )

          return {
            requested: qids.length,
            found: results.filter((r) => r !== null).length,
          }
        },
      })

      record(result)

      console.log('\n=== Scatter-Gather (10 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.scatterGatherP95Ms)
    })

    it('scatter-gather across 50 entity partitions', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-scatter-gather-50',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Generate QIDs from 50 different partitions
          const qids = Array.from({ length: 50 }, (_, i) =>
            `Q${i * 2_000_000 + Math.floor(Math.random() * 10000)}`
          )

          const results = await Promise.all(
            qids.map((qid) => ctx.do.get(`/entities/${qid}`).catch(() => null))
          )

          return {
            requested: qids.length,
            found: results.filter((r) => r !== null).length,
          }
        },
      })

      record(result)

      console.log('\n=== Scatter-Gather (50 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Should scale sub-linearly with partition count
      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.scatterGatherP95Ms * 2)
    })

    it('scatter-gather for reverse index query', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-scatter-gather-reverse',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Query that needs to check multiple partitions
          // Find all entities with P31 = Q5 (human) - scattered across many partitions
          const response = await ctx.do.request<{
            results: unknown[]
            partitionsQueried: number
          }>('/graph/edges/to/Q5?predicate=P31&limit=100&gather=true')

          return {
            results: response.results.length,
            partitionsQueried: response.partitionsQueried,
          }
        },
      })

      record(result)

      console.log('\n=== Scatter-Gather (reverse index) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.scatterGatherP95Ms)
    })
  })

  describe('aggregation queries', () => {
    it('count entities across all partitions', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-global-count',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Global count requires scatter-gather
          return ctx.do.get<{ count: number }>('/stats/entities/count')
        },
      })

      record(result)

      console.log('\n=== Global Entity Count ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.scatterGatherP95Ms)
    })

    it('aggregate property statistics across partitions', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-property-stats',
        target: 'wiki.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx) => {
          // Get usage stats for a property (requires gathering from all statement partitions)
          return ctx.do.get<{
            property: string
            totalUsage: number
            uniqueSubjects: number
          }>('/stats/property/P31/global')
        },
      })

      record(result)

      console.log('\n=== Global Property Statistics ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.scatterGatherP95Ms)
    })
  })
})

// ============================================================================
// INDEX EFFECTIVENESS AT SCALE
// ============================================================================

describe('Wikidata index effectiveness at scale', () => {
  describe('forward index performance', () => {
    it('forward index lookup (subject -> predicates)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-forward-index',
        target: 'wiki.perf.do',
        iterations: 100,
        warmup: 20,
        run: async (ctx) => {
          const qid = `Q${Math.floor(Math.random() * WIKIDATA_SCALE.entities) + 1}`
          return ctx.do.list(`/graph/edges/from/${qid}`)
        },
      })

      record(result)

      console.log('\n=== Forward Index Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })

    it('forward index with predicate filter', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-forward-index-filtered',
        target: 'wiki.perf.do',
        iterations: 100,
        warmup: 20,
        run: async (ctx) => {
          const qid = `Q${Math.floor(Math.random() * WIKIDATA_SCALE.entities) + 1}`
          return ctx.do.list(`/graph/edges/from/${qid}?predicate=P31`)
        },
      })

      record(result)

      console.log('\n=== Forward Index (with predicate filter) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })
  })

  describe('reverse index performance', () => {
    it('reverse index lookup (object -> subjects)', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-reverse-index',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          // Popular entities have many inbound edges
          const popularEntities = ['Q5', 'Q6256', 'Q35120', 'Q5119', 'Q215627']
          const target = popularEntities[Math.floor(Math.random() * popularEntities.length)]
          return ctx.do.list(`/graph/edges/to/${target}?limit=100`)
        },
      })

      record(result)

      console.log('\n=== Reverse Index Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })

    it('reverse index with predicate filter', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-reverse-index-filtered',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          return ctx.do.list('/graph/edges/to/Q5?predicate=P31&limit=100')
        },
      })

      record(result)

      console.log('\n=== Reverse Index (with predicate filter) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })
  })

  describe('label index performance', () => {
    it('label search index at scale', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-label-search',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          const queries = ['Einstein', 'Douglas', 'United', 'Python', 'London']
          const query = queries[Math.floor(Math.random() * queries.length)]
          return ctx.do.list(`/labels/search?q=${query}&language=en&limit=10`)
        },
      })

      record(result)

      console.log('\n=== Label Search Index ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })

    it('prefix search (autocomplete) at scale', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-prefix-search',
        target: 'wiki.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) => {
          const prefixes = ['Ein', 'Doug', 'Unit', 'Pyth', 'Lond']
          const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
          return ctx.do.list(`/labels/search?q=${prefix}*&language=en&limit=10`)
        },
      })

      record(result)

      console.log('\n=== Prefix Search (Autocomplete) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(SCALE_TARGETS.indexQueryP95Ms)
    })
  })
})

// ============================================================================
// MEMORY AND THROUGHPUT LIMITS
// ============================================================================

describe('Wikidata memory and throughput limits', () => {
  describe('memory limits', () => {
    it('large result set without OOM', async () => {
      const result = await benchmark({
        name: 'wikidata-scale-large-result',
        target: 'wiki.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) => {
          // Request large result set (10K items)
          const response = await ctx.do.request<{
            results: unknown[]
            memoryUsedMB: number
          }>('/graph/edges/to/Q5?predicate=P31&limit=10000&includeMemoryStats=true')

          return {
            resultCount: response.results.length,
            memoryUsedMB: response.memoryUsedMB,
          }
        },
      })

      record(result)

      console.log('\n=== Large Result Set (10K items) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Should complete without errors
      expect(result.errors?.length ?? 0).toBe(0)
    })

    it('sustained query load without memory growth', async () => {
      const memorySnapshots: number[] = []

      const result = await benchmark({
        name: 'wikidata-scale-sustained-load',
        target: 'wiki.perf.do',
        iterations: 100,
        warmup: 10,
        run: async (ctx, i) => {
          const qid = `Q${Math.floor(Math.random() * 1000000) + 1}`
          const response = await ctx.do.request<{
            entity: unknown
            memoryUsedMB?: number
          }>(`/entities/${qid}?includeMemoryStats=true`)

          if (response.memoryUsedMB !== undefined && i % 10 === 0) {
            memorySnapshots.push(response.memoryUsedMB)
          }

          return response.entity
        },
      })

      record(result)

      if (memorySnapshots.length > 1) {
        const initialMemory = memorySnapshots[0]!
        const finalMemory = memorySnapshots[memorySnapshots.length - 1]!
        const growthPercent = ((finalMemory - initialMemory) / initialMemory) * 100

        console.log('\n=== Sustained Query Load ===')
        console.log(`  Queries: ${result.iterations}`)
        console.log(`  Initial memory: ${initialMemory.toFixed(1)} MB`)
        console.log(`  Final memory: ${finalMemory.toFixed(1)} MB`)
        console.log(`  Growth: ${growthPercent.toFixed(1)}%`)

        // Memory should not grow significantly
        expect(growthPercent).toBeLessThan(50)
      }
    })
  })

  describe('throughput limits', () => {
    it('measure sustained query throughput', async () => {
      const startTime = performance.now()

      const result = await benchmark({
        name: 'wikidata-scale-throughput',
        target: 'wiki.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx) => {
          const qid = `Q${Math.floor(Math.random() * 1000000) + 1}`
          return ctx.do.get(`/entities/${qid}`)
        },
      })

      const totalTime = performance.now() - startTime
      const queriesPerSecond = (result.iterations / totalTime) * 1000

      record(result)

      console.log('\n=== Sustained Throughput ===')
      console.log(`  Queries: ${result.iterations}`)
      console.log(`  Total time: ${totalTime.toFixed(0)} ms`)
      console.log(`  Throughput: ${queriesPerSecond.toFixed(1)} queries/sec`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Should maintain reasonable throughput
      expect(queriesPerSecond).toBeGreaterThan(50)
    })

    it('parallel query throughput', async () => {
      const concurrency = 10

      const results = await benchmarkSuite(
        Array.from({ length: concurrency }, (_, i) => ({
          name: `wikidata-scale-parallel-${i}`,
          target: 'wiki.perf.do',
          iterations: 50,
          warmup: 5,
          run: async (ctx) => {
            const qid = `Q${Math.floor(Math.random() * 1000000) + 1}`
            return ctx.do.get(`/entities/${qid}`)
          },
        }))
      )

      record(results)

      // Calculate aggregate stats
      const allP50s = results.map((r) => r.stats.p50)
      const avgP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      console.log('\n=== Parallel Query Throughput ===')
      console.log(`  Concurrency: ${concurrency}`)
      console.log(`  Avg p50: ${avgP50.toFixed(3)} ms`)
      console.log(`  Max p50: ${maxP50.toFixed(3)} ms`)

      // No significant degradation under parallel load
      expect(maxP50).toBeLessThan(avgP50 * 3)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wikidata Scale Summary', () => {
  it('should document scale performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKIDATA SCALE PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Dataset scale:')
    console.log(`  - Entities (Q-items): ${WIKIDATA_SCALE.entities.toLocaleString()}`)
    console.log(`  - Properties (P-properties): ${WIKIDATA_SCALE.properties.toLocaleString()}`)
    console.log(`  - Statements (edges): ${WIKIDATA_SCALE.statements.toLocaleString()}`)
    console.log(`  - Labels/aliases: ${WIKIDATA_SCALE.labels.toLocaleString()}`)
    console.log('')

    console.log('Partition configuration:')
    console.log(`  - Entity partitions: ${PARTITION_CONFIG.entityPartitions}`)
    console.log(`  - Statement partitions: ${PARTITION_CONFIG.statementPartitions}`)
    console.log(`  - Label partitions: ${PARTITION_CONFIG.labelPartitions}`)
    console.log('')

    console.log('Performance targets:')
    console.log(`  - Entity lookup: <${SCALE_TARGETS.entityLookupP95Ms}ms (p95)`)
    console.log(`  - Batch lookup: <${SCALE_TARGETS.batchLookupP95Ms}ms (p95)`)
    console.log(`  - Graph traversal: <${SCALE_TARGETS.graphTraversalP95Ms}ms (p95)`)
    console.log(`  - Scatter-gather: <${SCALE_TARGETS.scatterGatherP95Ms}ms (p95)`)
    console.log(`  - Index query: <${SCALE_TARGETS.indexQueryP95Ms}ms (p95)`)
    console.log('')

    console.log('Scaling strategies:')
    console.log('  - QID-based entity partitioning')
    console.log('  - Subject-based statement partitioning')
    console.log('  - Language-based label partitioning')
    console.log('  - Parallel scatter-gather for cross-partition queries')
    console.log('  - Cursor-based pagination for large result sets')
    console.log('  - Cached type hierarchies for frequent traversals')
    console.log('')

    console.log('Index structures at scale:')
    console.log('  - Forward index: O(1) lookup per partition')
    console.log('  - Reverse index: O(log n) with bloom filter pre-check')
    console.log('  - Label search: Trigram index with language partitioning')
    console.log('  - Type hierarchy: Pre-computed transitive closure cache')
    console.log('')

    expect(true).toBe(true)
  })
})
