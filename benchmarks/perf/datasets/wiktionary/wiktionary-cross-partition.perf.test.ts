/**
 * Wiktionary Cross-Partition Query Performance Benchmarks
 *
 * Tests scatter-gather patterns across the A-Z alphabet partitions.
 * Validates performance for aggregations, searches, and relevance ranking
 * across the 1M+ word Wiktionary dataset.
 *
 * Performance targets:
 * - Scatter-gather (27 partitions): <500ms (p95)
 * - Aggregation (count by POS): <300ms (p95)
 * - BM25 search with ranking: <400ms (p95)
 * - Partial scatter (subset): <200ms (p95)
 *
 * Partition structure:
 * - 26 letter partitions: a.jsonl - z.jsonl
 * - 1 special partition: _other.jsonl (non-alphabetic)
 * - Total: 27 partitions, ~1M+ entries
 *
 * Target endpoints:
 * - wiktionary.perf.do - Coordinator/aggregator
 * - wiktionary-{letter}.perf.do - Per-partition workers
 *
 * @see workers/wiktionary-ingest.ts for partition strategy
 * @see dotdo-06d3k for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for full scatter-gather (ms)
 */
const MAX_FULL_SCATTER_P95_MS = 500

/**
 * Maximum acceptable p95 latency for aggregation queries (ms)
 */
const MAX_AGGREGATION_P95_MS = 300

/**
 * Maximum acceptable p95 latency for BM25 ranked search (ms)
 */
const MAX_BM25_SEARCH_P95_MS = 400

/**
 * Maximum acceptable p95 latency for partial scatter (ms)
 */
const MAX_PARTIAL_SCATTER_P95_MS = 200

/**
 * Expected per-partition overhead in scatter-gather (ms)
 * Should be sub-linear due to parallel execution
 */
const EXPECTED_PER_PARTITION_OVERHEAD_MS = 10

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * All alphabet partitions
 */
const ALL_PARTITIONS = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)), '_other']

/**
 * Part of speech types for aggregation
 */
const POS_TYPES = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'interjection']

/**
 * Sample search queries for BM25 testing
 */
const SEARCH_QUERIES = [
  'computer science',
  'natural language',
  'machine learning',
  'data structure',
  'programming language',
  'artificial intelligence',
  'network protocol',
  'system design',
  'software engineering',
  'distributed system',
]

/**
 * Etymology-related search terms
 */
const ETYMOLOGY_QUERIES = [
  'Latin origin',
  'Greek root',
  'Old English',
  'Proto-Indo-European',
  'French derivation',
  'Germanic origin',
  'borrowed from',
  'cognate with',
]

// ============================================================================
// SCATTER-GATHER BENCHMARKS
// ============================================================================

describe('Wiktionary scatter-gather across partitions', () => {
  describe('full scatter (27 partitions)', () => {
    it('count total words across all partitions', async () => {
      const result = await benchmark({
        name: 'wiktionary-scatter-count-all',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        datasetSize: 1_000_000,
        run: async (ctx) =>
          ctx.do.request('/scatter/count', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              aggregate: 'sum',
            }),
          }),
      })

      record(result)

      console.log('\n=== Full Scatter - Word Count (27 partitions) ===')
      console.log(`  Partitions: 27`)
      console.log(`  Dataset: ~1,000,000 words`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
      console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCATTER_P95_MS)
    })

    it('search across all partitions', async () => {
      const result = await benchmark({
        name: 'wiktionary-scatter-search-all',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions: 'all',
              limit: 20,
              merge: 'topN',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Full Scatter - Search (27 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCATTER_P95_MS)
    })

    it('list sample words from all partitions', async () => {
      const result = await benchmark({
        name: 'wiktionary-scatter-list-all',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/list', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              limitPerPartition: 5,
              merge: 'concat',
            }),
          }),
      })

      record(result)

      console.log('\n=== Full Scatter - List Sample (27 partitions) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULL_SCATTER_P95_MS)
    })
  })

  describe('scatter-gather overhead', () => {
    it('compare single partition vs full scatter', async () => {
      // Single partition query
      const single = await benchmark({
        name: 'wiktionary-overhead-single',
        target: 'wiktionary-a.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx) =>
          ctx.do.request('/count', {
            method: 'GET',
          }),
      })

      // Full scatter query
      const scatter = await benchmark({
        name: 'wiktionary-overhead-scatter',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/count', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              aggregate: 'sum',
            }),
          }),
      })

      record([single, scatter])

      const overheadRatio = scatter.stats.p50 / single.stats.p50
      const absoluteOverhead = scatter.stats.p50 - single.stats.p50

      console.log('\n=== Scatter-Gather Overhead ===')
      console.log(`  Single partition p50: ${single.stats.p50.toFixed(3)} ms`)
      console.log(`  Full scatter p50: ${scatter.stats.p50.toFixed(3)} ms`)
      console.log(`  Overhead ratio: ${overheadRatio.toFixed(2)}x`)
      console.log(`  Absolute overhead: ${absoluteOverhead.toFixed(3)} ms`)
      console.log(`  Per-partition overhead: ${(absoluteOverhead / 27).toFixed(3)} ms`)

      // Scatter should be slower but with parallel execution not 27x slower
      expect(overheadRatio).toBeLessThan(10)
      expect(absoluteOverhead / 27).toBeLessThan(EXPECTED_PER_PARTITION_OVERHEAD_MS * 2)
    })

    it('measure scaling with partition count', async () => {
      const partitionCounts = [5, 10, 15, 20, 27]
      const results: Array<{ partitions: number; p50: number; p95: number }> = []

      for (const count of partitionCounts) {
        const partitions = ALL_PARTITIONS.slice(0, count)

        const result = await benchmark({
          name: `wiktionary-scaling-${count}-partitions`,
          target: 'wiktionary.perf.do',
          iterations: 20,
          warmup: 5,
          shardCount: count,
          run: async (ctx) =>
            ctx.do.request('/scatter/count', {
              method: 'POST',
              body: JSON.stringify({
                partitions,
                aggregate: 'sum',
              }),
            }),
        })

        results.push({
          partitions: count,
          p50: result.stats.p50,
          p95: result.stats.p95,
        })

        record(result)
      }

      console.log('\n=== Scatter-Gather Scaling ===')
      console.log('  Partitions | p50 (ms)  | p95 (ms)')
      console.log('  -----------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.partitions).padEnd(10)} | ${r.p50.toFixed(3).padStart(9)} | ${r.p95.toFixed(3).padStart(8)}`)
      }

      // Calculate scaling factor
      const first = results[0]!
      const last = results[results.length - 1]!
      const partitionRatio = last.partitions / first.partitions
      const latencyRatio = last.p50 / first.p50

      console.log(`\n  Partition ratio: ${partitionRatio}x`)
      console.log(`  Latency ratio: ${latencyRatio.toFixed(2)}x`)
      console.log(`  Scaling efficiency: ${(partitionRatio / latencyRatio).toFixed(2)}`)

      // Should scale sub-linearly due to parallel execution
      expect(latencyRatio).toBeLessThan(partitionRatio)
    })
  })
})

// ============================================================================
// AGGREGATION BENCHMARKS
// ============================================================================

describe('Wiktionary aggregation queries', () => {
  describe('count by POS', () => {
    it('count words grouped by part of speech', async () => {
      const result = await benchmark({
        name: 'wiktionary-aggregate-pos-count',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              groupBy: 'pos',
              aggregate: 'count',
              merge: 'sum_by_key',
            }),
          }),
      })

      record(result)

      console.log('\n=== Aggregation - Count by POS ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_AGGREGATION_P95_MS)
    })

    it('count by POS with filter', async () => {
      const result = await benchmark({
        name: 'wiktionary-aggregate-pos-filtered',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const pos = POS_TYPES[i % POS_TYPES.length]
          return ctx.do.request('/scatter/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              filter: { pos },
              aggregate: 'count',
              merge: 'sum',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Aggregation - Count with POS Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_AGGREGATION_P95_MS)
    })
  })

  describe('count by partition', () => {
    it('word distribution across partitions', async () => {
      const result = await benchmark({
        name: 'wiktionary-aggregate-partition-dist',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              groupBy: 'partition',
              aggregate: 'count',
              merge: 'collect',
            }),
          }),
      })

      record(result)

      console.log('\n=== Aggregation - Partition Distribution ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_AGGREGATION_P95_MS)
    })
  })

  describe('etymology statistics', () => {
    it('count words by etymology origin', async () => {
      const result = await benchmark({
        name: 'wiktionary-aggregate-etymology-origin',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              groupBy: 'etymology_language',
              aggregate: 'count',
              merge: 'sum_by_key',
              limit: 20, // Top 20 origin languages
            }),
          }),
      })

      record(result)

      console.log('\n=== Aggregation - Etymology Origins ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_AGGREGATION_P95_MS)
    })
  })

  describe('distinct counting', () => {
    it('count distinct POS combinations', async () => {
      const result = await benchmark({
        name: 'wiktionary-aggregate-distinct-pos',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx) =>
          ctx.do.request('/scatter/aggregate', {
            method: 'POST',
            body: JSON.stringify({
              partitions: 'all',
              distinct: 'pos',
              aggregate: 'hll_union', // HyperLogLog for approximate distinct
              merge: 'hll_merge',
            }),
          }),
      })

      record(result)

      console.log('\n=== Aggregation - Distinct POS (HLL) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_AGGREGATION_P95_MS)
    })
  })
})

// ============================================================================
// BM25 SEARCH WITH RELEVANCE RANKING
// ============================================================================

describe('Wiktionary BM25 search with ranking', () => {
  describe('ranked definition search', () => {
    it('search definitions with BM25 ranking', async () => {
      const result = await benchmark({
        name: 'wiktionary-bm25-definitions',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              field: 'definitions',
              partitions: 'all',
              k: 20,
              k1: 1.2, // BM25 term frequency saturation
              b: 0.75, // BM25 length normalization
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 Definition Search ===')
      console.log(`  Dataset: ~1,000,000 words`)
      console.log(`  Partitions: 27`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS)
    })

    it('search etymologies with BM25 ranking', async () => {
      const result = await benchmark({
        name: 'wiktionary-bm25-etymology',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = ETYMOLOGY_QUERIES[i % ETYMOLOGY_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              field: 'etymology',
              partitions: 'all',
              k: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 Etymology Search ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS)
    })
  })

  describe('BM25 merge strategies', () => {
    it('merge with global re-ranking', async () => {
      const result = await benchmark({
        name: 'wiktionary-bm25-global-rerank',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              field: 'definitions',
              partitions: 'all',
              k: 50,
              kPerPartition: 10, // Fetch top 10 from each partition
              merge: 'global_rerank', // Re-score and rank globally
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 with Global Re-ranking ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS * 1.2)
    })

    it('merge with score thresholding', async () => {
      const result = await benchmark({
        name: 'wiktionary-bm25-threshold',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              field: 'definitions',
              partitions: 'all',
              scoreThreshold: 5.0, // Minimum BM25 score
              merge: 'threshold_concat',
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 with Score Threshold ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS)
    })
  })

  describe('multi-field BM25', () => {
    it('search across definitions and etymologies', async () => {
      const result = await benchmark({
        name: 'wiktionary-bm25-multifield',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search/bm25', {
            method: 'POST',
            body: JSON.stringify({
              query,
              fields: [
                { name: 'definitions', boost: 2.0 },
                { name: 'etymology', boost: 1.0 },
                { name: 'examples', boost: 0.5 },
              ],
              partitions: 'all',
              k: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== BM25 Multi-field Search ===')
      console.log(`  Fields: definitions (2x), etymology (1x), examples (0.5x)`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Multi-field is more expensive
      expect(result.stats.p95).toBeLessThan(MAX_BM25_SEARCH_P95_MS * 1.5)
    })
  })
})

// ============================================================================
// PARTIAL SCATTER BENCHMARKS
// ============================================================================

describe('Wiktionary partial scatter', () => {
  describe('subset of partitions', () => {
    it('search first 5 partitions (a-e)', async () => {
      const partitions = ['a', 'b', 'c', 'd', 'e']

      const result = await benchmark({
        name: 'wiktionary-partial-5-partitions',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 5,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partial Scatter (5 partitions: a-e) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PARTIAL_SCATTER_P95_MS)
    })

    it('search common letter partitions', async () => {
      // Most common starting letters in English: s, c, p, d, m
      const partitions = ['s', 'c', 'p', 'd', 'm']

      const result = await benchmark({
        name: 'wiktionary-partial-common-letters',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        shardCount: 5,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions,
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Partial Scatter (common letters: s,c,p,d,m) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PARTIAL_SCATTER_P95_MS)
    })
  })

  describe('dynamic partition selection', () => {
    it('search partitions based on query terms', async () => {
      const result = await benchmark({
        name: 'wiktionary-partial-dynamic',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          // Let coordinator determine relevant partitions
          return ctx.do.request('/scatter/search/smart', {
            method: 'POST',
            body: JSON.stringify({
              query,
              strategy: 'first_letter_routing',
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Dynamic Partition Selection ===')
      console.log(`  Strategy: first_letter_routing`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PARTIAL_SCATTER_P95_MS)
    })
  })

  describe('single partition fallback', () => {
    it('search single partition when query is specific', async () => {
      const specificQueries = [
        { query: 'algorithm', partition: 'a' },
        { query: 'benchmark', partition: 'b' },
        { query: 'computer', partition: 'c' },
        { query: 'database', partition: 'd' },
        { query: 'encryption', partition: 'e' },
      ]

      const result = await benchmark({
        name: 'wiktionary-single-partition-fallback',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const { query, partition } = specificQueries[i % specificQueries.length]!
          return ctx.do.request(`/scatter/search`, {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions: [partition],
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Partition Fallback ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PARTIAL_SCATTER_P95_MS / 2)
    })
  })
})

// ============================================================================
// CONCURRENT CROSS-PARTITION ACCESS
// ============================================================================

describe('Wiktionary concurrent partition access', () => {
  describe('parallel queries', () => {
    it('concurrent scatter-gather from multiple clients', async () => {
      const concurrency = 5
      const iterationsPerClient = 20

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, clientIndex) =>
          benchmark({
            name: `wiktionary-concurrent-client-${clientIndex}`,
            target: 'wiktionary.perf.do',
            iterations: iterationsPerClient,
            warmup: 3,
            shardCount: 27,
            run: async (ctx, i) => {
              const query = SEARCH_QUERIES[(clientIndex + i) % SEARCH_QUERIES.length]
              return ctx.do.request('/scatter/search', {
                method: 'POST',
                body: JSON.stringify({
                  query,
                  partitions: 'all',
                  limit: 10,
                }),
              })
            },
          })
        )
      )

      record(results)

      console.log('\n=== Concurrent Scatter-Gather ===')
      console.log(`  Concurrent clients: ${concurrency}`)
      console.log(`  Iterations per client: ${iterationsPerClient}`)

      const allP50s = results.map((r) => r.stats.p50)
      const meanP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length
      const maxP50 = Math.max(...allP50s)

      console.log(`  Mean p50: ${meanP50.toFixed(3)} ms`)
      console.log(`  Max p50: ${maxP50.toFixed(3)} ms`)

      // Concurrent access should not severely degrade performance
      expect(maxP50).toBeLessThan(MAX_FULL_SCATTER_P95_MS * 1.5)
    })
  })

  describe('mixed workload', () => {
    it('concurrent lookups and scatter-gather', async () => {
      const lookupResults = benchmark({
        name: 'wiktionary-mixed-lookups',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        run: async (ctx, i) => {
          const words = ['computer', 'algorithm', 'database', 'network', 'protocol']
          const word = words[i % words.length]
          return ctx.do.request(`/word/${word}`, {
            method: 'GET',
          })
        },
      })

      const scatterResults = benchmark({
        name: 'wiktionary-mixed-scatter',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        shardCount: 27,
        run: async (ctx, i) => {
          const query = SEARCH_QUERIES[i % SEARCH_QUERIES.length]
          return ctx.do.request('/scatter/search', {
            method: 'POST',
            body: JSON.stringify({
              query,
              partitions: 'all',
              limit: 10,
            }),
          })
        },
      })

      const [lookups, scatter] = await Promise.all([lookupResults, scatterResults])

      record([lookups, scatter])

      console.log('\n=== Mixed Workload (Concurrent) ===')
      console.log(`  Lookup p50: ${lookups.stats.p50.toFixed(3)} ms`)
      console.log(`  Scatter p50: ${scatter.stats.p50.toFixed(3)} ms`)
      console.log(`  Lookup p95: ${lookups.stats.p95.toFixed(3)} ms`)
      console.log(`  Scatter p95: ${scatter.stats.p95.toFixed(3)} ms`)

      expect(lookups.stats.p95).toBeLessThan(100)
      expect(scatter.stats.p95).toBeLessThan(MAX_FULL_SCATTER_P95_MS * 1.2)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Cross-Partition Summary', () => {
  it('should document cross-partition performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKTIONARY CROSS-PARTITION SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Full scatter (27 partitions): <${MAX_FULL_SCATTER_P95_MS}ms (p95)`)
    console.log(`  - Aggregations: <${MAX_AGGREGATION_P95_MS}ms (p95)`)
    console.log(`  - BM25 ranked search: <${MAX_BM25_SEARCH_P95_MS}ms (p95)`)
    console.log(`  - Partial scatter: <${MAX_PARTIAL_SCATTER_P95_MS}ms (p95)`)
    console.log('')

    console.log('Partition structure:')
    console.log('  - 26 letter partitions: a.jsonl - z.jsonl')
    console.log('  - 1 special partition: _other.jsonl')
    console.log('  - Total: 27 partitions, ~1M+ entries')
    console.log('')

    console.log('Query patterns:')
    console.log('  - Full scatter: Query all partitions in parallel')
    console.log('  - Partial scatter: Query subset of partitions')
    console.log('  - Smart routing: Auto-select partitions by query')
    console.log('  - Targeted: Single partition when prefix known')
    console.log('')

    console.log('Aggregation strategies:')
    console.log('  - Count: Sum counts from all partitions')
    console.log('  - Group by: Merge grouped results')
    console.log('  - Distinct: HyperLogLog approximate union')
    console.log('  - Top N: Collect and re-rank globally')
    console.log('')

    console.log('BM25 relevance ranking:')
    console.log('  - Per-partition scoring with local IDF')
    console.log('  - Global re-ranking with merged IDF')
    console.log('  - Score thresholding for filtering')
    console.log('  - Multi-field boosting support')
    console.log('')

    console.log('Scaling characteristics:')
    console.log(`  - Per-partition overhead: ~${EXPECTED_PER_PARTITION_OVERHEAD_MS}ms`)
    console.log('  - Parallel execution: Sub-linear latency growth')
    console.log('  - Partition pruning: Skip irrelevant partitions')
    console.log('')

    expect(true).toBe(true)
  })
})
