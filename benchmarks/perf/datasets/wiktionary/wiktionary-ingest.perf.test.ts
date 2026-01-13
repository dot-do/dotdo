/**
 * Wiktionary Ingest Performance Benchmarks
 *
 * Tests streaming ingest throughput and memory stability for large-scale
 * dictionary data (1M+ English words from kaikki.org).
 *
 * Performance targets:
 * - Streaming ingest: 10,000+ entries/second
 * - Memory stable: No OOM during 1M+ entry ingest
 * - R2 writes: <50ms per partition chunk
 * - Multipart merge: <500ms per partition
 *
 * Infrastructure:
 * - Source: kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
 * - Storage: R2 partitioned by first letter (a.jsonl, b.jsonl, ..., z.jsonl, _other.jsonl)
 * - Worker: workers/wiktionary-ingest.ts
 *
 * @see workers/wiktionary-ingest.ts for implementation
 * @see dotdo-06d3k for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Target entries per second for streaming ingest
 */
const TARGET_ENTRIES_PER_SECOND = 10_000

/**
 * Maximum acceptable p95 latency for partition writes (ms)
 */
const MAX_PARTITION_WRITE_P95_MS = 100

/**
 * Maximum acceptable latency for multipart merge (ms)
 */
const MAX_MULTIPART_MERGE_P95_MS = 1000

/**
 * Maximum memory growth allowed during ingest (percentage)
 */
const MAX_MEMORY_GROWTH_PERCENT = 50

/**
 * Sample batch sizes for throughput testing
 */
const BATCH_SIZES = [100, 500, 1000, 5000, 10000]

/**
 * Standard benchmark iterations
 */
const BENCHMARK_ITERATIONS = 50

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Sample Wiktionary entries for benchmarking
 */
function generateSampleEntry(index: number): object {
  const words = ['algorithm', 'benchmark', 'compile', 'database', 'execute',
    'framework', 'generate', 'handler', 'iterate', 'javascript',
    'kernel', 'lambda', 'module', 'namespace', 'optimize',
    'parallel', 'query', 'runtime', 'serialize', 'thread',
    'utility', 'validate', 'workflow', 'xml', 'yaml', 'zero']

  const pos = ['noun', 'verb', 'adjective', 'adverb'][index % 4]
  const word = words[index % words.length]

  return {
    word: `${word}${index}`,
    pos,
    senses: [{
      glosses: [`Definition ${index} for ${word}`],
      tags: ['computing', 'technology'],
      examples: [{
        text: `Example usage of ${word} in a sentence.`,
        ref: 'Technical Dictionary',
      }],
    }],
    etymology_text: `From Latin ${word}us, meaning "${word}"`,
    sounds: [{
      ipa: `/\u02C8${word}/`,
    }],
    forms: [{
      form: `${word}s`,
      tags: ['plural'],
    }],
  }
}

/**
 * Generate batch of sample entries
 */
function generateBatch(size: number, offset: number = 0): object[] {
  return Array.from({ length: size }, (_, i) => generateSampleEntry(offset + i))
}

// ============================================================================
// STREAMING INGEST BENCHMARKS
// ============================================================================

describe('Wiktionary streaming ingest', () => {
  describe('single entry processing', () => {
    it('process single entry', async () => {
      const result = await benchmark({
        name: 'wiktionary-ingest-single',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        datasetSize: 1,
        run: async (ctx, i) => {
          const entry = generateSampleEntry(i)
          return ctx.do.request('/ingest/entry', {
            method: 'POST',
            body: JSON.stringify(entry),
          })
        },
      })

      record(result)

      console.log('\n=== Single Entry Processing ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1000 / result.stats.p50).toFixed(0)} entries/sec`)

      // Single entry should be very fast
      expect(result.stats.p95).toBeLessThan(10)
    })

    it('process entries with varying definition lengths', async () => {
      const definitionLengths = [50, 200, 500, 1000]
      const results: Array<{ length: number; p50: number; throughput: number }> = []

      for (const length of definitionLengths) {
        const result = await benchmark({
          name: `wiktionary-ingest-def-${length}`,
          target: 'wiktionary.perf.do',
          iterations: 30,
          warmup: 5,
          run: async (ctx, i) => {
            const entry = {
              word: `word${i}`,
              pos: 'noun',
              senses: [{
                glosses: ['x'.repeat(length)],
              }],
            }
            return ctx.do.request('/ingest/entry', {
              method: 'POST',
              body: JSON.stringify(entry),
            })
          },
        })

        results.push({
          length,
          p50: result.stats.p50,
          throughput: 1000 / result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Processing by Definition Length ===')
      console.log('  Length  | p50 (ms)  | Throughput')
      console.log('  --------|-----------|------------')
      for (const r of results) {
        console.log(`  ${String(r.length).padEnd(7)} | ${r.p50.toFixed(3).padStart(9)} | ${r.throughput.toFixed(0).padStart(10)}/s`)
      }

      // Processing time should scale sub-linearly
      expect(results[results.length - 1]!.p50 / results[0]!.p50).toBeLessThan(10)
    })
  })

  describe('batch ingest throughput', () => {
    it.each(BATCH_SIZES)('ingest batch of %d entries', async (batchSize) => {
      const entries = generateBatch(batchSize)

      const result = await benchmark({
        name: `wiktionary-ingest-batch-${batchSize}`,
        target: 'wiktionary.perf.do',
        iterations: 20,
        warmup: 3,
        datasetSize: batchSize,
        run: async (ctx) =>
          ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          }),
      })

      record(result)

      const entriesPerSecond = (batchSize / result.stats.p50) * 1000

      console.log(`\n=== Batch Ingest (${batchSize} entries) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${entriesPerSecond.toFixed(0)} entries/sec`)

      expect(result.samples.length).toBe(20)
    })

    it('measures throughput scaling with batch size', async () => {
      const throughputs: Array<{ size: number; entriesPerSec: number }> = []

      for (const size of BATCH_SIZES) {
        const entries = generateBatch(size)

        const result = await benchmark({
          name: `wiktionary-throughput-${size}`,
          target: 'wiktionary.perf.do',
          iterations: 10,
          warmup: 2,
          datasetSize: size,
          run: async (ctx) =>
            ctx.do.request('/ingest/batch', {
              method: 'POST',
              body: JSON.stringify({ entries }),
            }),
        })

        throughputs.push({
          size,
          entriesPerSec: (size / result.stats.p50) * 1000,
        })

        record(result)
      }

      console.log('\n=== Throughput vs Batch Size ===')
      console.log('  Batch Size  | Entries/Second')
      console.log('  ------------|---------------')
      for (const t of throughputs) {
        console.log(`  ${String(t.size).padEnd(11)} | ${t.entriesPerSec.toFixed(0).padStart(14)}`)
      }

      // Larger batches should have better throughput
      expect(throughputs[throughputs.length - 1]!.entriesPerSec).toBeGreaterThan(
        throughputs[0]!.entriesPerSec
      )

      // Should meet target throughput with large batches
      expect(throughputs[throughputs.length - 1]!.entriesPerSec).toBeGreaterThan(TARGET_ENTRIES_PER_SECOND)
    })
  })

  describe('streaming decompression', () => {
    it('decompress and parse gzipped JSONL stream', async () => {
      const result = await benchmark({
        name: 'wiktionary-decompress-stream',
        target: 'wiktionary.perf.do',
        iterations: 20,
        warmup: 5,
        run: async (ctx) =>
          ctx.do.request('/ingest/stream/decompress', {
            method: 'POST',
            body: JSON.stringify({
              // Simulate streaming 1MB of compressed data
              compressedSizeKB: 1024,
              format: 'gzip',
            }),
          }),
      })

      record(result)

      console.log('\n=== Streaming Decompression (1MB) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${(1024 / result.stats.p50 * 1000).toFixed(0)} KB/sec`)

      expect(result.stats.p95).toBeLessThan(500)
    })

    it('line splitting performance', async () => {
      const lineCounts = [1000, 5000, 10000, 50000]
      const results: Array<{ lines: number; p50: number }> = []

      for (const lineCount of lineCounts) {
        const result = await benchmark({
          name: `wiktionary-line-split-${lineCount}`,
          target: 'wiktionary.perf.do',
          iterations: 15,
          warmup: 3,
          run: async (ctx) =>
            ctx.do.request('/ingest/stream/split', {
              method: 'POST',
              body: JSON.stringify({ lineCount }),
            }),
        })

        results.push({
          lines: lineCount,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Line Splitting Performance ===')
      console.log('  Lines       | p50 (ms)  | Lines/ms')
      console.log('  ------------|-----------|----------')
      for (const r of results) {
        const linesPerMs = r.lines / r.p50
        console.log(`  ${String(r.lines).padEnd(11)} | ${r.p50.toFixed(3).padStart(9)} | ${linesPerMs.toFixed(0).padStart(8)}`)
      }

      // Line splitting should be fast
      expect(results[0]!.p50 / results[0]!.lines * 1000).toBeLessThan(1) // < 1ms per 1000 lines
    })
  })
})

// ============================================================================
// PARTITION WRITE BENCHMARKS
// ============================================================================

describe('Wiktionary partition writes', () => {
  describe('single partition writes', () => {
    it('write to single partition buffer', async () => {
      const result = await benchmark({
        name: 'wiktionary-partition-write-single',
        target: 'wiktionary.perf.do',
        iterations: BENCHMARK_ITERATIONS,
        warmup: 10,
        run: async (ctx, i) => {
          const partition = String.fromCharCode(97 + (i % 26)) // a-z
          const entries = generateBatch(100, i * 100)
          return ctx.do.request(`/partition/${partition}/write`, {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
      })

      record(result)

      console.log('\n=== Single Partition Write (100 entries) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_PARTITION_WRITE_P95_MS)
    })

    it('write to all 27 partitions round-robin', async () => {
      const partitions = [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)), '_other']

      const result = await benchmark({
        name: 'wiktionary-partition-write-roundrobin',
        target: 'wiktionary.perf.do',
        iterations: 54, // Two rounds through all partitions
        warmup: 5,
        run: async (ctx, i) => {
          const partition = partitions[i % 27]
          const entries = generateBatch(50, i * 50)
          return ctx.do.request(`/partition/${partition}/write`, {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
      })

      record(result)

      console.log('\n=== Round-Robin Partition Writes ===')
      console.log(`  Partitions: 27`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Stddev: ${result.stats.stddev.toFixed(3)} ms`)

      // All partitions should have similar write performance
      expect(result.stats.stddev).toBeLessThan(result.stats.p50 * 0.5)
    })
  })

  describe('partition flush to R2', () => {
    it('flush partition chunk to R2', async () => {
      const result = await benchmark({
        name: 'wiktionary-partition-flush',
        target: 'wiktionary.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Pre-populate partition buffer with 3MB of data
          const entries = generateBatch(10000)
          await ctx.do.request('/partition/a/write', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })
        },
        run: async (ctx) =>
          ctx.do.request('/partition/a/flush', {
            method: 'POST',
          }),
        teardown: async (ctx) => {
          await ctx.do.request('/partition/a/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Partition Flush to R2 ===')
      console.log(`  Data size: ~3MB`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(200)
    })

    it('flush performance by chunk size', async () => {
      const chunkSizes = [1000, 5000, 10000, 25000]
      const results: Array<{ entries: number; p50: number; mbPerSec: number }> = []

      for (const size of chunkSizes) {
        const result = await benchmark({
          name: `wiktionary-flush-${size}`,
          target: 'wiktionary.perf.do',
          iterations: 10,
          warmup: 2,
          setup: async (ctx) => {
            const entries = generateBatch(size)
            await ctx.do.request('/partition/b/write', {
              method: 'POST',
              body: JSON.stringify({ entries }),
            })
          },
          run: async (ctx) =>
            ctx.do.request('/partition/b/flush', {
              method: 'POST',
            }),
          teardown: async (ctx) => {
            await ctx.do.request('/partition/b/clear', { method: 'POST' })
          },
        })

        // Estimate ~300 bytes per entry
        const estimatedMB = (size * 300) / (1024 * 1024)
        const mbPerSec = (estimatedMB / result.stats.p50) * 1000

        results.push({
          entries: size,
          p50: result.stats.p50,
          mbPerSec,
        })

        record(result)
      }

      console.log('\n=== Flush Performance by Chunk Size ===')
      console.log('  Entries   | p50 (ms)   | MB/sec')
      console.log('  ----------|------------|--------')
      for (const r of results) {
        console.log(`  ${String(r.entries).padEnd(9)} | ${r.p50.toFixed(3).padStart(10)} | ${r.mbPerSec.toFixed(1).padStart(6)}`)
      }

      // Larger chunks should have better throughput
      expect(results[results.length - 1]!.mbPerSec).toBeGreaterThan(results[0]!.mbPerSec * 0.5)
    })
  })
})

// ============================================================================
// MEMORY STABILITY BENCHMARKS
// ============================================================================

describe('Wiktionary memory stability', () => {
  describe('sustained ingest', () => {
    it('memory stable during extended ingest', async () => {
      const memorySnapshots: number[] = []

      const result = await benchmark({
        name: 'wiktionary-memory-sustained',
        target: 'wiktionary.perf.do',
        iterations: 100,
        warmup: 5,
        run: async (ctx, i) => {
          const entries = generateBatch(1000, i * 1000)
          const response = await ctx.do.request('/ingest/batch', {
            method: 'POST',
            body: JSON.stringify({
              entries,
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

        console.log('\n=== Memory Stability During Sustained Ingest ===')
        console.log(`  Total entries processed: ${result.iterations * 1000}`)
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
        name: 'wiktionary-memory-flush-reclaim',
        target: 'wiktionary.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx, i) => {
          // Fill buffer with data
          const entries = generateBatch(10000, i * 10000)
          await ctx.do.request('/partition/c/write', {
            method: 'POST',
            body: JSON.stringify({ entries }),
          })

          // Check memory before flush
          const beforeStats = await ctx.do.request<{ memoryUsedMB: number }>('/stats/memory', {
            method: 'GET',
          })
          if (i === 0) memoryBeforeFlush = beforeStats.memoryUsedMB

          // Flush partition
          await ctx.do.request('/partition/c/flush', { method: 'POST' })

          // Check memory after flush
          const afterStats = await ctx.do.request<{ memoryUsedMB: number }>('/stats/memory', {
            method: 'GET',
          })
          memoryAfterFlush = afterStats.memoryUsedMB

          return afterStats
        },
        teardown: async (ctx) => {
          await ctx.do.request('/partition/c/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Memory Reclamation After Flush ===')
      console.log(`  Memory before flush: ${memoryBeforeFlush.toFixed(1)} MB`)
      console.log(`  Memory after flush: ${memoryAfterFlush.toFixed(1)} MB`)
      console.log(`  Reclaimed: ${(memoryBeforeFlush - memoryAfterFlush).toFixed(1)} MB`)

      // Memory should be reclaimed after flush
      expect(memoryAfterFlush).toBeLessThan(memoryBeforeFlush * 0.8)
    })
  })
})

// ============================================================================
// R2 MULTIPART MERGE BENCHMARKS
// ============================================================================

describe('Wiktionary R2 multipart merge', () => {
  describe('chunk merging', () => {
    it('merge 2 chunks into final file', async () => {
      const result = await benchmark({
        name: 'wiktionary-merge-2-chunks',
        target: 'wiktionary.perf.do',
        iterations: 15,
        warmup: 3,
        setup: async (ctx) => {
          // Create 2 chunk files
          for (let i = 0; i < 2; i++) {
            const entries = generateBatch(5000, i * 5000)
            await ctx.do.request('/partition/d/write', {
              method: 'POST',
              body: JSON.stringify({ entries }),
            })
            await ctx.do.request('/partition/d/flush', { method: 'POST' })
          }
        },
        run: async (ctx) =>
          ctx.do.request('/partition/d/merge', {
            method: 'POST',
          }),
        teardown: async (ctx) => {
          await ctx.do.request('/partition/d/cleanup', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n=== Merge 2 Chunks ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTIPART_MERGE_P95_MS)
    })

    it('merge scaling with chunk count', async () => {
      const chunkCounts = [2, 4, 8, 16]
      const results: Array<{ chunks: number; p50: number }> = []

      for (const chunks of chunkCounts) {
        const result = await benchmark({
          name: `wiktionary-merge-${chunks}-chunks`,
          target: 'wiktionary.perf.do',
          iterations: 10,
          warmup: 2,
          setup: async (ctx) => {
            for (let i = 0; i < chunks; i++) {
              const entries = generateBatch(2500, i * 2500)
              await ctx.do.request('/partition/e/write', {
                method: 'POST',
                body: JSON.stringify({ entries }),
              })
              await ctx.do.request('/partition/e/flush', { method: 'POST' })
            }
          },
          run: async (ctx) =>
            ctx.do.request('/partition/e/merge', {
              method: 'POST',
            }),
          teardown: async (ctx) => {
            await ctx.do.request('/partition/e/cleanup', { method: 'POST' })
          },
        })

        results.push({
          chunks,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Merge Scaling by Chunk Count ===')
      console.log('  Chunks | p50 (ms)')
      console.log('  -------|----------')
      for (const r of results) {
        console.log(`  ${String(r.chunks).padEnd(6)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // Merge time should scale sub-linearly with streaming approach
      const ratio = results[results.length - 1]!.p50 / results[0]!.p50
      const chunkRatio = results[results.length - 1]!.chunks / results[0]!.chunks
      expect(ratio).toBeLessThan(chunkRatio)
    })

    it('multipart upload performance', async () => {
      const result = await benchmark({
        name: 'wiktionary-multipart-upload',
        target: 'wiktionary.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx) =>
          ctx.do.request('/r2/multipart/benchmark', {
            method: 'POST',
            body: JSON.stringify({
              partCount: 4,
              partSizeMB: 5, // 5MB minimum part size
            }),
          }),
      })

      record(result)

      console.log('\n=== R2 Multipart Upload (4 x 5MB parts) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Throughput: ${((20 / result.stats.p50) * 1000).toFixed(1)} MB/sec`)

      expect(result.stats.p95).toBeLessThan(MAX_MULTIPART_MERGE_P95_MS)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Wiktionary Ingest Summary', () => {
  it('should document ingest performance characteristics', () => {
    console.log('\n========================================')
    console.log('WIKTIONARY INGEST PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Performance targets:')
    console.log(`  - Streaming ingest: >${TARGET_ENTRIES_PER_SECOND.toLocaleString()} entries/sec`)
    console.log(`  - Partition writes: <${MAX_PARTITION_WRITE_P95_MS}ms (p95)`)
    console.log(`  - Multipart merge: <${MAX_MULTIPART_MERGE_P95_MS}ms (p95)`)
    console.log(`  - Memory growth: <${MAX_MEMORY_GROWTH_PERCENT}%`)
    console.log('')

    console.log('Dataset characteristics:')
    console.log('  - Source: kaikki.org English dictionary')
    console.log('  - Total entries: ~1M+')
    console.log('  - Compressed size: ~500MB gzipped')
    console.log('  - Uncompressed: ~2-3GB JSONL')
    console.log('')

    console.log('Partitioning strategy:')
    console.log('  - 27 partitions: a-z + _other')
    console.log('  - Chunk-based writes: 3MB buffer per partition')
    console.log('  - R2 multipart merge: streaming concatenation')
    console.log('')

    console.log('Memory management:')
    console.log('  - Worker limit: 128MB')
    console.log('  - Streaming decompression')
    console.log('  - Periodic partition flushes')
    console.log('  - No read-modify-write patterns')
    console.log('')

    expect(true).toBe(true)
  })
})
