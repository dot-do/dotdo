/**
 * Parquet Write Performance Benchmarks
 *
 * Tests write performance for Parquet files in Workers environment:
 * - Record batch writes
 * - Column encoding (dictionary, RLE, plain)
 * - Compression algorithms (snappy, zstd, gzip, uncompressed)
 * - File size vs record count scaling
 *
 * Expected performance targets:
 * - Write 100 records: <100ms
 * - Dictionary encoding: <120ms for 100 records
 * - Snappy compression: <110ms for 100 records
 * - Zstd compression: <150ms for 100 records
 *
 * @see db/iceberg/parquet.ts for implementation
 * @see dotdo-x3p2c for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Maximum acceptable latency for writing 100 records (ms)
 */
const MAX_WRITE_100_P50_MS = 100

/**
 * Maximum acceptable latency for dictionary encoding (ms)
 */
const MAX_DICTIONARY_ENCODE_P50_MS = 120

/**
 * Maximum acceptable latency for snappy compression (ms)
 */
const MAX_SNAPPY_COMPRESS_P50_MS = 110

/**
 * Maximum acceptable latency for zstd compression (ms)
 */
const MAX_ZSTD_COMPRESS_P50_MS = 150

/**
 * Number of iterations for write benchmarks
 */
const WRITE_ITERATIONS = 50

/**
 * Number of warmup iterations
 */
const WARMUP_ITERATIONS = 5

// ============================================================================
// RECORD BATCH WRITE BENCHMARKS
// ============================================================================

describe('Parquet write benchmarks', () => {
  describe('record batch writes', () => {
    it('write record batch (100 records)', async () => {
      const result = await benchmark({
        name: 'parquet-write-batch-100',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `batch-${i}-record-${j}`,
            name: `Record ${j}`,
            value: Math.random() * 1000,
            category: `category-${j % 10}`,
            timestamp: new Date().toISOString(),
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records }),
          })

          if (!response.ok) {
            throw new Error(`Write failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Write Batch (100 records) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_WRITE_100_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_WRITE_100_P50_MS)
      expect(result.samples.length).toBe(WRITE_ITERATIONS)
    })

    it.each([10, 50, 100, 500, 1000])('write batch of %d records', async (batchSize) => {
      const result = await benchmark({
        name: `parquet-write-batch-${batchSize}`,
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx, i) => {
          const records = Array.from({ length: batchSize }, (_, j) => ({
            id: `batch-${i}-record-${j}`,
            name: `Record ${j}`,
            value: Math.random() * 1000,
            category: `category-${j % 10}`,
            timestamp: new Date().toISOString(),
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records }),
          })

          if (!response.ok) {
            throw new Error(`Batch write ${batchSize} failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log(`\n=== Parquet Write (${batchSize} records) ===`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  Per-record avg: ${(result.stats.p50 / batchSize).toFixed(3)} ms`)

      // Expected scaling: base overhead + ~0.5ms per record
      const expectedMax = 50 + batchSize * 0.5
      expect(result.stats.p50).toBeLessThan(expectedMax)
    })

    it('measures write throughput scaling', async () => {
      const batchSizes = [10, 50, 100, 500]
      const results: Array<{ size: number; p50: number; throughput: number }> = []

      for (const batchSize of batchSizes) {
        const result = await benchmark({
          name: `parquet-write-throughput-${batchSize}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: batchSize }, (_, j) => ({
              id: `throughput-${i}-${j}`,
              name: `Record ${j}`,
              value: j * 1.5,
              category: `cat-${j % 5}`,
            }))

            const response = await ctx.fetch('/parquet/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ records }),
            })

            if (!response.ok) {
              throw new Error(`Throughput test failed: ${response.status}`)
            }
            return response.json()
          },
        })

        const throughput = (batchSize / result.stats.p50) * 1000 // records/second
        results.push({ size: batchSize, p50: result.stats.p50, throughput })
      }

      record(
        results.map((r) => ({
          name: `parquet-throughput-${r.size}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          stats: { p50: r.p50, p95: r.p50, p99: r.p50, min: 0, max: 0, mean: r.p50, stddev: 0 },
          samples: [],
          timestamp: new Date().toISOString(),
          metadata: { batchSize: r.size, throughput: r.throughput },
        }))
      )

      console.log('\n=== Write Throughput Scaling ===')
      console.log('  Batch Size | p50 (ms) | Throughput (rec/s)')
      console.log('  -----------|----------|-------------------')
      for (const r of results) {
        console.log(`  ${r.size.toString().padStart(10)} | ${r.p50.toFixed(1).padStart(8)} | ${r.throughput.toFixed(0).padStart(17)}`)
      }

      // Throughput should increase with batch size (amortized overhead)
      if (results.length >= 2) {
        const smallBatch = results[0]!
        const largeBatch = results[results.length - 1]!
        expect(largeBatch.throughput).toBeGreaterThan(smallBatch.throughput)
      }
    })
  })

  // ==========================================================================
  // COLUMN ENCODING BENCHMARKS
  // ==========================================================================

  describe('column encoding', () => {
    it('test dictionary encoding', async () => {
      const result = await benchmark({
        name: 'parquet-encoding-dictionary',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          // Data with high cardinality repetition - ideal for dictionary encoding
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `dict-${i}-${j}`,
            category: `category-${j % 5}`, // Only 5 unique values
            status: ['active', 'inactive', 'pending'][j % 3], // Only 3 unique values
            region: `region-${j % 10}`, // Only 10 unique values
            value: j * 1.5,
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              encoding: 'dictionary',
            }),
          })

          if (!response.ok) {
            throw new Error(`Dictionary encoding failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Dictionary Encoding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_DICTIONARY_ENCODE_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_DICTIONARY_ENCODE_P50_MS)
    })

    it('test RLE encoding', async () => {
      const result = await benchmark({
        name: 'parquet-encoding-rle',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          // Data with runs of repeated values - ideal for RLE
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `rle-${i}-${j}`,
            flag: j < 50, // First 50 true, rest false
            group: Math.floor(j / 10), // Groups of 10 same values
            sequence: j,
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              encoding: 'rle',
            }),
          })

          if (!response.ok) {
            throw new Error(`RLE encoding failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet RLE Encoding ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_DICTIONARY_ENCODE_P50_MS)
    })

    it('test plain encoding baseline', async () => {
      const result = await benchmark({
        name: 'parquet-encoding-plain',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `plain-${i}-${j}`,
            name: `Unique name ${crypto.randomUUID()}`, // All unique - no encoding benefit
            value: Math.random() * 10000,
            timestamp: Date.now() + j,
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              encoding: 'plain',
            }),
          })

          if (!response.ok) {
            throw new Error(`Plain encoding failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Plain Encoding (baseline) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_WRITE_100_P50_MS)
    })

    it('compares encoding performance', async () => {
      const encodings = ['plain', 'dictionary', 'rle'] as const
      const results: Array<{ encoding: string; p50: number }> = []

      for (const encoding of encodings) {
        const result = await benchmark({
          name: `parquet-encoding-compare-${encoding}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: 100 }, (_, j) => ({
              id: `compare-${encoding}-${i}-${j}`,
              category: `category-${j % 5}`,
              value: j * 1.5,
            }))

            const response = await ctx.fetch('/parquet/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ records, encoding }),
            })

            if (!response.ok) {
              throw new Error(`Encoding compare ${encoding} failed: ${response.status}`)
            }
            return response.json()
          },
        })

        results.push({ encoding, p50: result.stats.p50 })
      }

      console.log('\n=== Encoding Performance Comparison ===')
      console.log('  Encoding   | p50 (ms)')
      console.log('  -----------|----------')
      for (const r of results) {
        console.log(`  ${r.encoding.padEnd(10)} | ${r.p50.toFixed(3)}`)
      }
    })
  })

  // ==========================================================================
  // COMPRESSION BENCHMARKS
  // ==========================================================================

  describe('compression algorithms', () => {
    it('test snappy compression', async () => {
      const result = await benchmark({
        name: 'parquet-compress-snappy',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `snappy-${i}-${j}`,
            name: `Record number ${j} with some text content`,
            value: Math.random() * 1000,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              compression: 'snappy',
            }),
          })

          if (!response.ok) {
            throw new Error(`Snappy compression failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Snappy Compression ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_SNAPPY_COMPRESS_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_SNAPPY_COMPRESS_P50_MS)
    })

    it('test zstd compression', async () => {
      const result = await benchmark({
        name: 'parquet-compress-zstd',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `zstd-${i}-${j}`,
            name: `Record number ${j} with some text content`,
            value: Math.random() * 1000,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              compression: 'zstd',
            }),
          })

          if (!response.ok) {
            throw new Error(`Zstd compression failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Zstd Compression ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_ZSTD_COMPRESS_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_ZSTD_COMPRESS_P50_MS)
    })

    it('test gzip compression', async () => {
      const result = await benchmark({
        name: 'parquet-compress-gzip',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `gzip-${i}-${j}`,
            name: `Record number ${j} with some text content`,
            value: Math.random() * 1000,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              compression: 'gzip',
            }),
          })

          if (!response.ok) {
            throw new Error(`Gzip compression failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Gzip Compression ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Gzip typically slower than snappy but better compression
      expect(result.stats.p50).toBeLessThan(MAX_ZSTD_COMPRESS_P50_MS * 1.5)
    })

    it('test uncompressed baseline', async () => {
      const result = await benchmark({
        name: 'parquet-compress-none',
        target: 'iceberg.perf.do',
        iterations: WRITE_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `uncompressed-${i}-${j}`,
            name: `Record number ${j} with some text content`,
            value: Math.random() * 1000,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          }))

          const response = await ctx.fetch('/parquet/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              compression: 'uncompressed',
            }),
          })

          if (!response.ok) {
            throw new Error(`Uncompressed write failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet Uncompressed (baseline) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_WRITE_100_P50_MS)
    })

    it('compares compression algorithms', async () => {
      type CompressionResult = {
        compression: string
        p50: number
        fileSize?: number
      }

      const compressions = ['uncompressed', 'snappy', 'zstd', 'gzip'] as const
      const results: CompressionResult[] = []

      for (const compression of compressions) {
        const result = await benchmark({
          name: `parquet-compress-compare-${compression}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: 100 }, (_, j) => ({
              id: `compare-${compression}-${i}-${j}`,
              name: `Record number ${j} with repeated text for compression`,
              value: j * 1.5,
              description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5),
            }))

            const response = await ctx.fetch('/parquet/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ records, compression }),
            })

            if (!response.ok) {
              throw new Error(`Compression compare ${compression} failed: ${response.status}`)
            }

            const data = await response.json()
            return data
          },
        })

        results.push({
          compression,
          p50: result.stats.p50,
        })
      }

      console.log('\n=== Compression Algorithm Comparison ===')
      console.log('  Algorithm    | p50 (ms) | Notes')
      console.log('  -------------|----------|------------------')
      console.log(`  ${results[0]!.compression.padEnd(12)} | ${results[0]!.p50.toFixed(1).padStart(8)} | Baseline (fastest write)`)
      console.log(`  ${results[1]!.compression.padEnd(12)} | ${results[1]!.p50.toFixed(1).padStart(8)} | Good balance`)
      console.log(`  ${results[2]!.compression.padEnd(12)} | ${results[2]!.p50.toFixed(1).padStart(8)} | Best compression`)
      console.log(`  ${results[3]!.compression.padEnd(12)} | ${results[3]!.p50.toFixed(1).padStart(8)} | Legacy compatibility`)

      // Snappy should be fastest compressed format
      expect(results[1]!.p50).toBeLessThan(results[2]!.p50)
    })
  })

  // ==========================================================================
  // FILE SIZE BENCHMARKS
  // ==========================================================================

  describe('file size vs record count', () => {
    it('measures file size scaling', async () => {
      const recordCounts = [10, 50, 100, 500, 1000]
      const results: Array<{ count: number; p50: number; avgFileSize?: number }> = []

      for (const count of recordCounts) {
        let totalFileSize = 0
        let sizeCount = 0

        const result = await benchmark({
          name: `parquet-filesize-${count}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: count }, (_, j) => ({
              id: `filesize-${count}-${i}-${j}`,
              name: `Record ${j}`,
              value: j * 1.5,
              category: `category-${j % 10}`,
              timestamp: new Date().toISOString(),
            }))

            const response = await ctx.fetch('/parquet/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ records, compression: 'snappy' }),
            })

            if (!response.ok) {
              throw new Error(`File size test failed: ${response.status}`)
            }

            const data = (await response.json()) as { fileSize?: number }
            if (data.fileSize) {
              totalFileSize += data.fileSize
              sizeCount++
            }
            return data
          },
        })

        results.push({
          count,
          p50: result.stats.p50,
          avgFileSize: sizeCount > 0 ? totalFileSize / sizeCount : undefined,
        })
      }

      console.log('\n=== File Size vs Record Count ===')
      console.log('  Records | Write Time (ms) | Avg File Size')
      console.log('  --------|-----------------|---------------')
      for (const r of results) {
        const sizeStr = r.avgFileSize ? `${(r.avgFileSize / 1024).toFixed(1)} KB` : 'N/A'
        console.log(`  ${r.count.toString().padStart(7)} | ${r.p50.toFixed(1).padStart(15)} | ${sizeStr.padStart(13)}`)
      }

      // Write time should scale sub-linearly
      const ratio = results[results.length - 1]!.p50 / results[0]!.p50
      const countRatio = results[results.length - 1]!.count / results[0]!.count
      expect(ratio).toBeLessThan(countRatio) // Sub-linear scaling
    })

    it('measures row group sizing impact', async () => {
      const rowGroupSizes = [1000, 5000, 10000, 50000]
      const results: Array<{ rowGroupSize: number; p50: number }> = []

      for (const rowGroupSize of rowGroupSizes) {
        const result = await benchmark({
          name: `parquet-rowgroup-size-${rowGroupSize}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: 100 }, (_, j) => ({
              id: `rowgroup-${rowGroupSize}-${i}-${j}`,
              name: `Record ${j}`,
              value: j * 1.5,
            }))

            const response = await ctx.fetch('/parquet/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                records,
                rowGroupSize,
              }),
            })

            if (!response.ok) {
              throw new Error(`Row group size test failed: ${response.status}`)
            }
            return response.json()
          },
        })

        results.push({ rowGroupSize, p50: result.stats.p50 })
      }

      console.log('\n=== Row Group Size Impact ===')
      console.log('  Row Group Size | Write Time (ms)')
      console.log('  ---------------|----------------')
      for (const r of results) {
        console.log(`  ${r.rowGroupSize.toString().padStart(14)} | ${r.p50.toFixed(3).padStart(15)}`)
      }
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Parquet Write Summary', () => {
  it('should document expected write performance', () => {
    console.log('\n========================================')
    console.log('PARQUET WRITE PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected performance targets:')
    console.log(`  - Write 100 records: <${MAX_WRITE_100_P50_MS}ms`)
    console.log(`  - Dictionary encoding: <${MAX_DICTIONARY_ENCODE_P50_MS}ms`)
    console.log(`  - Snappy compression: <${MAX_SNAPPY_COMPRESS_P50_MS}ms`)
    console.log(`  - Zstd compression: <${MAX_ZSTD_COMPRESS_P50_MS}ms`)
    console.log('')

    console.log('Encoding recommendations:')
    console.log('  - Dictionary: Low-cardinality strings (status, category)')
    console.log('  - RLE: Boolean flags, sorted/grouped data')
    console.log('  - Plain: High-cardinality unique values')
    console.log('')

    console.log('Compression recommendations:')
    console.log('  - Snappy: Default, best speed/ratio balance')
    console.log('  - Zstd: Storage-optimized, better compression')
    console.log('  - Gzip: Maximum compatibility')
    console.log('  - Uncompressed: Real-time analytics, fast reads')
    console.log('')

    console.log('parquet-wasm write optimizations:')
    console.log('  - Streaming Arrow IPC serialization')
    console.log('  - Automatic encoding selection')
    console.log('  - Batch column encoding')
    console.log('')

    expect(true).toBe(true)
  })
})
