/**
 * Wiktionary Query Performance Benchmarks
 *
 * Tests query performance against the 1M+ word Wiktionary dataset.
 * Validates scalability claims for dictionary lookups, search, and autocomplete.
 *
 * Performance targets:
 * - Point lookup by word: <50ms (p95)
 * - Full-text search: <200ms (p95)
 * - Prefix search (autocomplete): <100ms (p95)
 * - Etymology/definition retrieval: <75ms (p95)
 *
 * Target endpoints:
 * - wiktionary.perf.do - Main dictionary API
 * - wiktionary-{letter}.perf.do - Per-partition endpoints (a-z)
 *
 * @see workers/wiktionary-ingest.ts for data ingestion
 * @see dotdo-06d3k for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable p95 latency for point lookups (ms)
 */
const MAX_POINT_LOOKUP_P95_MS = 50

/**
 * Maximum acceptable p95 latency for full-text search (ms)
 */
const MAX_FULLTEXT_SEARCH_P95_MS = 200

/**
 * Maximum acceptable p95 latency for prefix/autocomplete (ms)
 */
const MAX_PREFIX_SEARCH_P95_MS = 100

/**
 * Maximum acceptable p95 latency for etymology retrieval (ms)
 */
const MAX_ETYMOLOGY_P95_MS = 75

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
 * Common English words for point lookup testing
 * These represent high-frequency dictionary lookups
 */
const COMMON_WORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
  'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this',
  'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or',
  'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so',
]

/**
 * Technical/computing words for specialized lookups
 */
const TECHNICAL_WORDS = [
  'algorithm', 'database', 'interface', 'protocol', 'encryption',
  'asynchronous', 'recursion', 'polymorphism', 'abstraction', 'middleware',
  'serialization', 'authentication', 'authorization', 'concurrency', 'latency',
  'throughput', 'bandwidth', 'compression', 'deduplication', 'virtualization',
]

/**
 * Words with rich etymologies for etymology tests
 */
const ETYMOLOGY_WORDS = [
  'philosophy', 'democracy', 'technology', 'economy', 'psychology',
  'biology', 'chemistry', 'physics', 'mathematics', 'astronomy',
  'geography', 'history', 'literature', 'architecture', 'medicine',
]

/**
 * Prefixes for autocomplete testing
 */
const AUTOCOMPLETE_PREFIXES = [
  'comp', 'prog', 'soft', 'hard', 'data',
  'algo', 'func', 'proc', 'inter', 'proto',
  'sys', 'net', 'web', 'app', 'ser',
]

/**
 * Part of speech types
 */
const POS_TYPES = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction']

// ============================================================================
// POINT LOOKUP BENCHMARKS
// ============================================================================

describe('Wiktionary point lookups', () => {
  describe('single word lookup', () => {
    it('lookup common English words', async () => {
      const result = await benchmark({
        name: 'wiktionary-lookup-common',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 1_000_000,
        run: async (ctx, i) => {
          const word = COMMON_WORDS[i % COMMON_WORDS.length]
          return ctx.do.request(`/word/${word}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Common Word Lookup (1M+ dataset) ===')
      console.log(`  Dataset size: ~1,000,000 words`)
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Min: ${result.stats.min.toFixed(3)} ms`)
      console.log(`  Max: ${result.stats.max.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('lookup technical/computing words', async () => {
      const result = await benchmark({
        name: 'wiktionary-lookup-technical',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 1_000_000,
        run: async (ctx, i) => {
          const word = TECHNICAL_WORDS[i % TECHNICAL_WORDS.length]
          return ctx.do.request(`/word/${word}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Technical Word Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('lookup words with multiple definitions', async () => {
      // Words known to have many definitions/senses
      const polysemousWords = [
        'run', 'set', 'go', 'take', 'get', 'make', 'put', 'see', 'come', 'give',
      ]

      const result = await benchmark({
        name: 'wiktionary-lookup-polysemous',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        datasetSize: 1_000_000,
        run: async (ctx, i) => {
          const word = polysemousWords[i % polysemousWords.length]
          return ctx.do.request(`/word/${word}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Polysemous Word Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Polysemous words have larger responses but should still be fast
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS * 1.5)
    })

    it('lookup case-insensitive', async () => {
      const variations = [
        'Computer', 'COMPUTER', 'computer', 'CoMpUtEr',
        'Algorithm', 'ALGORITHM', 'algorithm', 'AlGoRiThM',
      ]

      const result = await benchmark({
        name: 'wiktionary-lookup-case-insensitive',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const word = variations[i % variations.length]
          return ctx.do.request(`/word/${word}?case=insensitive`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Case-Insensitive Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })

  describe('partition-targeted lookups', () => {
    it('lookup via partition endpoint', async () => {
      const result = await benchmark({
        name: 'wiktionary-lookup-partition-targeted',
        target: 'wiktionary-a.perf.do', // Target 'a' partition directly
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const aWords = ['algorithm', 'abstract', 'array', 'async', 'await', 'api', 'authentication', 'authorization', 'aggregate', 'application']
          const word = aWords[i % aWords.length]
          return ctx.do.request(`/word/${word}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Partition-Targeted Lookup (a.jsonl) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Direct partition access should be faster
      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS * 0.8)
    })

    it('compare lookup times across partitions', async () => {
      const partitions = ['a', 'e', 'm', 's', 'z']
      const sampleWords: Record<string, string[]> = {
        a: ['algorithm', 'abstract', 'array'],
        e: ['execute', 'encrypt', 'enumerate'],
        m: ['module', 'middleware', 'method'],
        s: ['system', 'serialize', 'server'],
        z: ['zero', 'zone', 'zip'],
      }

      const results: Array<{ partition: string; p50: number }> = []

      for (const partition of partitions) {
        const result = await benchmark({
          name: `wiktionary-lookup-partition-${partition}`,
          target: `wiktionary-${partition}.perf.do`,
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            const words = sampleWords[partition]!
            const word = words[i % words.length]
            return ctx.do.request(`/word/${word}`, {
              method: 'GET',
            })
          },
        })

        results.push({
          partition,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Cross-Partition Lookup Comparison ===')
      console.log('  Partition | p50 (ms)')
      console.log('  ----------|----------')
      for (const r of results) {
        console.log(`  ${r.partition.padEnd(9)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // All partitions should have similar performance
      const times = results.map(r => r.p50)
      const variance = Math.max(...times) - Math.min(...times)
      expect(variance).toBeLessThan(20) // Within 20ms of each other
    })
  })

  describe('cold vs warm lookups', () => {
    it('verifies caching benefit', async () => {
      const testWord = 'benchmark'
      const timestamp = Date.now()

      // Cold lookup (bypass cache)
      const cold = await benchmark({
        name: 'wiktionary-lookup-cold',
        target: `wiktionary-cold-${timestamp}.perf.do`,
        iterations: 20,
        warmup: 0,
        run: async (ctx) =>
          ctx.do.request(`/word/${testWord}?cache=bypass`, {
            method: 'GET',
          }),
      })

      // Warm lookup (use cache)
      const warm = await benchmark({
        name: 'wiktionary-lookup-warm',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx) =>
          ctx.do.request(`/word/${testWord}`, {
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

describe('Wiktionary full-text search', () => {
  describe('definition search', () => {
    it('search definitions for single term', async () => {
      const searchTerms = [
        'computer', 'software', 'program', 'data', 'system',
        'network', 'process', 'function', 'object', 'class',
      ]

      const result = await benchmark({
        name: 'wiktionary-search-single-term',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        datasetSize: 1_000_000,
        run: async (ctx, i) => {
          const term = searchTerms[i % searchTerms.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: term,
              fields: ['definitions'],
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Full-Text Search (Single Term) ===')
      console.log(`  Dataset: ~1,000,000 words`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })

    it('search definitions for phrase', async () => {
      const phrases = [
        'type of', 'used to', 'relating to', 'kind of', 'form of',
        'pertaining to', 'characterized by', 'in the manner of',
      ]

      const result = await benchmark({
        name: 'wiktionary-search-phrase',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        datasetSize: 1_000_000,
        run: async (ctx, i) => {
          const phrase = phrases[i % phrases.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: phrase,
              fields: ['definitions'],
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

    it('search with result limit scaling', async () => {
      const limits = [10, 25, 50, 100, 200]
      const results: Array<{ limit: number; p50: number }> = []

      for (const limit of limits) {
        const result = await benchmark({
          name: `wiktionary-search-limit-${limit}`,
          target: 'wiktionary.perf.do',
          iterations: 20,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/search', {
              method: 'POST',
              body: JSON.stringify({
                query: 'computer',
                fields: ['definitions'],
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

      // Latency should scale sub-linearly with limit
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(5)
    })
  })

  describe('etymology search', () => {
    it('search etymologies', async () => {
      const languages = ['Latin', 'Greek', 'French', 'German', 'Old English']

      const result = await benchmark({
        name: 'wiktionary-search-etymology',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const lang = languages[i % languages.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: `From ${lang}`,
              fields: ['etymology'],
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Etymology Search ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS)
    })
  })

  describe('filtered search', () => {
    it('search with POS filter', async () => {
      const result = await benchmark({
        name: 'wiktionary-search-pos-filter',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const pos = POS_TYPES[i % POS_TYPES.length]
          return ctx.do.request('/search', {
            method: 'POST',
            body: JSON.stringify({
              query: 'process',
              fields: ['definitions'],
              filter: { pos },
              limit: 20,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Search with POS Filter ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Filtered search may be slightly slower
      expect(result.stats.p95).toBeLessThan(MAX_FULLTEXT_SEARCH_P95_MS * 1.2)
    })
  })
})

// ============================================================================
// PREFIX SEARCH (AUTOCOMPLETE) BENCHMARKS
// ============================================================================

describe('Wiktionary prefix search (autocomplete)', () => {
  describe('short prefixes', () => {
    it('autocomplete with 2-char prefix', async () => {
      const prefixes = ['ab', 'co', 'de', 'ex', 'in', 'ma', 'pr', 're', 'sy', 'un']

      const result = await benchmark({
        name: 'wiktionary-autocomplete-2char',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const prefix = prefixes[i % prefixes.length]
          return ctx.do.request('/autocomplete', {
            method: 'POST',
            body: JSON.stringify({
              prefix,
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Autocomplete (2-char prefix) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // 2-char prefix may hit many matches
      expect(result.stats.p95).toBeLessThan(MAX_PREFIX_SEARCH_P95_MS * 1.5)
    })

    it('autocomplete with 3-char prefix', async () => {
      const prefixes = ['alg', 'com', 'dat', 'fun', 'net', 'obj', 'pro', 'ser', 'sys', 'var']

      const result = await benchmark({
        name: 'wiktionary-autocomplete-3char',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const prefix = prefixes[i % prefixes.length]
          return ctx.do.request('/autocomplete', {
            method: 'POST',
            body: JSON.stringify({
              prefix,
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Autocomplete (3-char prefix) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PREFIX_SEARCH_P95_MS)
    })

    it('autocomplete with 4-char prefix', async () => {
      const result = await benchmark({
        name: 'wiktionary-autocomplete-4char',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const prefix = AUTOCOMPLETE_PREFIXES[i % AUTOCOMPLETE_PREFIXES.length]
          return ctx.do.request('/autocomplete', {
            method: 'POST',
            body: JSON.stringify({
              prefix,
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Autocomplete (4-char prefix) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PREFIX_SEARCH_P95_MS)
    })
  })

  describe('autocomplete scaling', () => {
    it('latency vs prefix length', async () => {
      const prefixLengths = [2, 3, 4, 5, 6]
      const baseWord = 'programming'
      const results: Array<{ length: number; p50: number; matches: number }> = []

      for (const length of prefixLengths) {
        const prefix = baseWord.slice(0, length)

        const result = await benchmark({
          name: `wiktionary-autocomplete-len-${length}`,
          target: 'wiktionary.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx) => {
            const response = await ctx.fetch('/autocomplete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prefix,
                limit: 100,
              }),
            })
            return response.json()
          },
        })

        results.push({
          length,
          p50: result.stats.p50,
          matches: 0, // Would be populated from response
        })

        record(result)
      }

      console.log('\n=== Autocomplete Latency vs Prefix Length ===')
      console.log('  Length | p50 (ms)')
      console.log('  -------|----------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(6)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Longer prefixes should be faster (fewer matches)
      expect(results[results.length - 1]!.p50).toBeLessThanOrEqual(results[0]!.p50)
    })

    it('latency vs result limit', async () => {
      const limits = [5, 10, 20, 50, 100]
      const results: Array<{ limit: number; p50: number }> = []

      for (const limit of limits) {
        const result = await benchmark({
          name: `wiktionary-autocomplete-limit-${limit}`,
          target: 'wiktionary.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx) =>
            ctx.do.request('/autocomplete', {
              method: 'POST',
              body: JSON.stringify({
                prefix: 'comp',
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

      console.log('\n=== Autocomplete Latency vs Result Limit ===')
      console.log('  Limit | p50 (ms)')
      console.log('  ------|----------')
      for (const r of results) {
        console.log(`  ${String(r.limit).padEnd(5)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Latency should increase moderately with limit
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(3)
    })
  })

  describe('real-world autocomplete patterns', () => {
    it('simulates typing sequence', async () => {
      const typingSequence = ['c', 'co', 'com', 'comp', 'compu', 'comput', 'compute', 'computer']
      const latencies: number[] = []

      const result = await benchmark({
        name: 'wiktionary-autocomplete-typing',
        target: 'wiktionary.perf.do',
        iterations: typingSequence.length * 5, // 5 iterations per prefix
        warmup: 5,
        run: async (ctx, i) => {
          const prefix = typingSequence[i % typingSequence.length]
          return ctx.do.request('/autocomplete', {
            method: 'POST',
            body: JSON.stringify({
              prefix,
              limit: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Typing Sequence Autocomplete ===')
      console.log(`  Sequence: ${typingSequence.join(' -> ')}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // All requests in typing sequence should be fast
      expect(result.stats.p95).toBeLessThan(MAX_PREFIX_SEARCH_P95_MS)
    })
  })
})

// ============================================================================
// ETYMOLOGY/DEFINITION RETRIEVAL BENCHMARKS
// ============================================================================

describe('Wiktionary etymology/definition retrieval', () => {
  describe('etymology lookup', () => {
    it('retrieve word etymology', async () => {
      const result = await benchmark({
        name: 'wiktionary-etymology-lookup',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const word = ETYMOLOGY_WORDS[i % ETYMOLOGY_WORDS.length]
          return ctx.do.request(`/word/${word}/etymology`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Etymology Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_ETYMOLOGY_P95_MS)
    })

    it('retrieve etymology tree (word origins)', async () => {
      const result = await benchmark({
        name: 'wiktionary-etymology-tree',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const word = ETYMOLOGY_WORDS[i % ETYMOLOGY_WORDS.length]
          return ctx.do.request(`/word/${word}/etymology/tree`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Etymology Tree ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      // Etymology tree is more complex
      expect(result.stats.p95).toBeLessThan(MAX_ETYMOLOGY_P95_MS * 2)
    })
  })

  describe('definition retrieval', () => {
    it('retrieve all definitions for word', async () => {
      const result = await benchmark({
        name: 'wiktionary-definitions-all',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const word = COMMON_WORDS[i % COMMON_WORDS.length]
          return ctx.do.request(`/word/${word}/definitions`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== All Definitions Retrieval ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })

    it('retrieve definitions by POS', async () => {
      const result = await benchmark({
        name: 'wiktionary-definitions-by-pos',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const word = COMMON_WORDS[i % COMMON_WORDS.length]
          const pos = POS_TYPES[i % POS_TYPES.length]
          return ctx.do.request(`/word/${word}/definitions?pos=${pos}`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Definitions by POS ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })

  describe('pronunciation lookup', () => {
    it('retrieve word pronunciation (IPA)', async () => {
      const result = await benchmark({
        name: 'wiktionary-pronunciation',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const word = COMMON_WORDS[i % COMMON_WORDS.length]
          return ctx.do.request(`/word/${word}/pronunciation`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Pronunciation Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })

  describe('word forms', () => {
    it('retrieve all word forms', async () => {
      const result = await benchmark({
        name: 'wiktionary-forms',
        target: 'wiktionary.perf.do',
        iterations: 50,
        warmup: 10,
        run: async (ctx, i) => {
          const word = COMMON_WORDS[i % COMMON_WORDS.length]
          return ctx.do.request(`/word/${word}/forms`, {
            method: 'GET',
          })
        },
      })

      record(result)

      console.log('\n=== Word Forms Lookup ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_POINT_LOOKUP_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Query Performance Summary', () => {
  it('should document query performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKTIONARY QUERY PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Point lookup: <${MAX_POINT_LOOKUP_P95_MS}ms (p95)`)
    console.log(`  - Full-text search: <${MAX_FULLTEXT_SEARCH_P95_MS}ms (p95)`)
    console.log(`  - Prefix/autocomplete: <${MAX_PREFIX_SEARCH_P95_MS}ms (p95)`)
    console.log(`  - Etymology retrieval: <${MAX_ETYMOLOGY_P95_MS}ms (p95)`)
    console.log('')

    console.log('Dataset characteristics:')
    console.log('  - Total words: ~1,000,000+')
    console.log('  - Partitioned: A-Z + _other (27 partitions)')
    console.log('  - Storage: R2 JSONL files')
    console.log('')

    console.log('Query patterns:')
    console.log('  - Point lookup: Direct word -> entry')
    console.log('  - Full-text: Definition/etymology search')
    console.log('  - Autocomplete: Prefix matching')
    console.log('  - Filtered: POS type filtering')
    console.log('')

    console.log('Optimization strategies:')
    console.log('  - Partition targeting: Route by first letter')
    console.log('  - Response caching: SQLite + LRU')
    console.log('  - Inverted index: Full-text search')
    console.log('  - Sorted arrays: Prefix binary search')
    console.log('')

    expect(true).toBe(true)
  })
})
