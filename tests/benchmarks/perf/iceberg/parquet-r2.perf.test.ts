/**
 * Parquet R2 Integration Performance Benchmarks
 *
 * Tests Parquet file operations with R2 storage:
 * - Streaming read from R2
 * - Streaming write to R2
 * - Range request optimization
 * - Multipart upload for large files
 *
 * Expected performance targets:
 * - Streaming read: <50ms
 * - Streaming write: <80ms
 * - Range request: <30ms
 * - Multipart upload: <200ms (for 10MB file)
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
 * Maximum acceptable latency for streaming read (ms)
 */
const MAX_STREAMING_READ_P50_MS = 50

/**
 * Maximum acceptable latency for streaming write (ms)
 */
const MAX_STREAMING_WRITE_P50_MS = 80

/**
 * Maximum acceptable latency for range request (ms)
 */
const MAX_RANGE_REQUEST_P50_MS = 30

/**
 * Maximum acceptable latency for multipart upload (ms)
 */
const MAX_MULTIPART_UPLOAD_P50_MS = 200

/**
 * Number of iterations for R2 benchmarks
 */
const R2_ITERATIONS = 50

/**
 * Number of warmup iterations
 */
const WARMUP_ITERATIONS = 5

// ============================================================================
// STREAMING READ BENCHMARKS
// ============================================================================

describe('Parquet R2 benchmarks', () => {
  describe('streaming read from R2', () => {
    it('stream read small file (<1MB)', async () => {
      const result = await benchmark({
        name: 'parquet-r2-stream-read-small',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/small-file-${i % 10}.parquet`
          const response = await ctx.fetch(`/parquet/r2/stream?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Stream read failed: ${response.status}`)
          }

          // Consume the stream
          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('No response body')
          }

          let totalBytes = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.length
          }

          return { bytesRead: totalBytes }
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Stream Read (small) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_STREAMING_READ_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_STREAMING_READ_P50_MS)
    })

    it('stream read medium file (1-10MB)', async () => {
      const result = await benchmark({
        name: 'parquet-r2-stream-read-medium',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx, i) => {
          const filePath = `benchmark/medium-file-${i % 5}.parquet`
          const response = await ctx.fetch(`/parquet/r2/stream?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Stream read medium failed: ${response.status}`)
          }

          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('No response body')
          }

          let totalBytes = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.length
          }

          return { bytesRead: totalBytes }
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Stream Read (medium) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      // Medium files take longer but should still be reasonable
      expect(result.stats.p50).toBeLessThan(MAX_STREAMING_READ_P50_MS * 3)
    })

    it('stream read with early termination', async () => {
      const result = await benchmark({
        name: 'parquet-r2-stream-read-partial',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          const response = await ctx.fetch(`/parquet/r2/stream?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Partial stream read failed: ${response.status}`)
          }

          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('No response body')
          }

          // Read only first 100KB
          let totalBytes = 0
          const targetBytes = 100 * 1024
          while (totalBytes < targetBytes) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.length
          }

          // Cancel remaining stream
          await reader.cancel()

          return { bytesRead: totalBytes }
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Stream Read (partial) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Partial reads should be faster than full reads
      expect(result.stats.p50).toBeLessThan(MAX_STREAMING_READ_P50_MS)
    })

    it('concurrent stream reads', async () => {
      const concurrency = 5

      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, workerIndex) =>
          benchmark({
            name: `parquet-r2-concurrent-read-${workerIndex}`,
            target: 'iceberg.perf.do',
            iterations: 20,
            warmup: 2,
            run: async (ctx, i) => {
              const filePath = `benchmark/small-file-${(workerIndex + i) % 10}.parquet`
              const response = await ctx.fetch(`/parquet/r2/stream?path=${encodeURIComponent(filePath)}`)
              if (!response.ok) {
                throw new Error(`Concurrent read failed: ${response.status}`)
              }

              const data = await response.arrayBuffer()
              return { bytesRead: data.byteLength }
            },
          })
        )
      )

      record(results)

      // Calculate aggregate stats
      const allP50s = results.map((r) => r.stats.p50)
      const avgP50 = allP50s.reduce((a, b) => a + b, 0) / allP50s.length

      console.log('\n=== Parquet R2 Concurrent Reads ===')
      console.log(`  Concurrency: ${concurrency}`)
      console.log(`  Average p50: ${avgP50.toFixed(3)} ms`)

      // Concurrent reads should not significantly degrade performance
      for (const result of results) {
        expect(result.stats.p50).toBeLessThan(MAX_STREAMING_READ_P50_MS * 2)
      }
    })
  })

  // ==========================================================================
  // STREAMING WRITE BENCHMARKS
  // ==========================================================================

  describe('streaming write to R2', () => {
    it('stream write small file', async () => {
      const result = await benchmark({
        name: 'parquet-r2-stream-write-small',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const records = Array.from({ length: 100 }, (_, j) => ({
            id: `stream-write-${i}-${j}`,
            name: `Record ${j}`,
            value: Math.random() * 1000,
            category: `category-${j % 10}`,
          }))

          const response = await ctx.fetch('/parquet/r2/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              path: `benchmark/output/small-${i}.parquet`,
            }),
          })

          if (!response.ok) {
            throw new Error(`Stream write failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Stream Write (small) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_STREAMING_WRITE_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_STREAMING_WRITE_P50_MS)
    })

    it('stream write medium file (1000 records)', async () => {
      const result = await benchmark({
        name: 'parquet-r2-stream-write-medium',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx, i) => {
          const records = Array.from({ length: 1000 }, (_, j) => ({
            id: `stream-write-med-${i}-${j}`,
            name: `Record ${j}`,
            value: Math.random() * 1000,
            category: `category-${j % 20}`,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          }))

          const response = await ctx.fetch('/parquet/r2/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              path: `benchmark/output/medium-${i}.parquet`,
            }),
          })

          if (!response.ok) {
            throw new Error(`Medium stream write failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Stream Write (medium) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // Medium writes take longer but should scale reasonably
      expect(result.stats.p50).toBeLessThan(MAX_STREAMING_WRITE_P50_MS * 3)
    })

    it('stream write with compression', async () => {
      const compressions = ['uncompressed', 'snappy', 'zstd'] as const
      const results: Array<{ compression: string; p50: number }> = []

      for (const compression of compressions) {
        const result = await benchmark({
          name: `parquet-r2-write-${compression}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 3,
          run: async (ctx, i) => {
            const records = Array.from({ length: 100 }, (_, j) => ({
              id: `write-${compression}-${i}-${j}`,
              name: `Record ${j}`,
              value: j * 1.5,
              text: 'Repeated text for compression testing. '.repeat(10),
            }))

            const response = await ctx.fetch('/parquet/r2/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                records,
                path: `benchmark/output/${compression}-${i}.parquet`,
                compression,
              }),
            })

            if (!response.ok) {
              throw new Error(`Write ${compression} failed: ${response.status}`)
            }
            return response.json()
          },
        })

        results.push({ compression, p50: result.stats.p50 })
      }

      console.log('\n=== R2 Write with Compression ===')
      console.log('  Compression | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${r.compression.padEnd(11)} | ${r.p50.toFixed(3)}`)
      }

      // All should be within acceptable range
      for (const r of results) {
        expect(r.p50).toBeLessThan(MAX_STREAMING_WRITE_P50_MS * 2)
      }
    })
  })

  // ==========================================================================
  // RANGE REQUEST BENCHMARKS
  // ==========================================================================

  describe('range request optimization', () => {
    it('read with range request (single range)', async () => {
      const result = await benchmark({
        name: 'parquet-r2-range-single',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          // Request only the footer (last 8 bytes for magic + metadata length)
          const response = await ctx.fetch(`/parquet/r2/range?path=${encodeURIComponent(filePath)}&start=-8`)
          if (!response.ok) {
            throw new Error(`Range request failed: ${response.status}`)
          }

          const data = await response.arrayBuffer()
          return { bytesRead: data.byteLength }
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Range Request (single) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_RANGE_REQUEST_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_RANGE_REQUEST_P50_MS)
    })

    it('read footer metadata only', async () => {
      const result = await benchmark({
        name: 'parquet-r2-range-footer',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          // Read footer: magic (4) + metadata length (4) + metadata (variable)
          // Typically request last ~64KB to get footer
          const response = await ctx.fetch(`/parquet/r2/footer?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Footer read failed: ${response.status}`)
          }

          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Footer Read ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_RANGE_REQUEST_P50_MS)
    })

    it('read specific row group', async () => {
      const result = await benchmark({
        name: 'parquet-r2-range-rowgroup',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          const rowGroup = i % 5

          const response = await ctx.fetch(`/parquet/r2/rowgroup?path=${encodeURIComponent(filePath)}&group=${rowGroup}`)
          if (!response.ok) {
            throw new Error(`Row group range read failed: ${response.status}`)
          }

          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Row Group Range Read ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_RANGE_REQUEST_P50_MS * 2)
    })

    it('read specific columns via range requests', async () => {
      const result = await benchmark({
        name: 'parquet-r2-range-columns',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/wide-file-${i % 3}.parquet`
          const columns = 'id,name,value'

          const response = await ctx.fetch(`/parquet/r2/columns?path=${encodeURIComponent(filePath)}&columns=${columns}`)
          if (!response.ok) {
            throw new Error(`Column range read failed: ${response.status}`)
          }

          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Column Range Read ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      expect(result.stats.p50).toBeLessThan(MAX_RANGE_REQUEST_P50_MS * 2)
    })

    it('compares range vs full read performance', async () => {
      // Range request (footer only)
      const rangeRead = await benchmark({
        name: 'parquet-r2-compare-range',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          const response = await ctx.fetch(`/parquet/r2/footer?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Range compare failed: ${response.status}`)
          }
          return response.json()
        },
      })

      // Full file read
      const fullRead = await benchmark({
        name: 'parquet-r2-compare-full',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        run: async (ctx, i) => {
          const filePath = `benchmark/large-file-${i % 3}.parquet`
          const response = await ctx.fetch(`/parquet/r2/stream?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Full read compare failed: ${response.status}`)
          }

          const data = await response.arrayBuffer()
          return { bytesRead: data.byteLength }
        },
      })

      record([rangeRead, fullRead])

      const speedup = fullRead.stats.p50 / rangeRead.stats.p50

      console.log('\n=== Range vs Full Read Comparison ===')
      console.log(`  Range request p50: ${rangeRead.stats.p50.toFixed(3)} ms`)
      console.log(`  Full read p50: ${fullRead.stats.p50.toFixed(3)} ms`)
      console.log(`  Speedup: ${speedup.toFixed(2)}x`)

      // Range requests should be significantly faster
      expect(rangeRead.stats.p50).toBeLessThan(fullRead.stats.p50)
    })
  })

  // ==========================================================================
  // MULTIPART UPLOAD BENCHMARKS
  // ==========================================================================

  describe('multipart upload', () => {
    it('multipart upload large file', async () => {
      const result = await benchmark({
        name: 'parquet-r2-multipart',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 2,
        run: async (ctx, i) => {
          // Generate ~1MB of data
          const records = Array.from({ length: 5000 }, (_, j) => ({
            id: `multipart-${i}-${j}`,
            name: `Record ${j}`,
            value: Math.random() * 10000,
            description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5),
            category: `category-${j % 50}`,
          }))

          const response = await ctx.fetch('/parquet/r2/multipart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              path: `benchmark/output/multipart-${i}.parquet`,
              partSize: 5 * 1024 * 1024, // 5MB parts
            }),
          })

          if (!response.ok) {
            throw new Error(`Multipart upload failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Multipart Upload ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  Target: <${MAX_MULTIPART_UPLOAD_P50_MS}ms`)

      expect(result.stats.p50).toBeLessThan(MAX_MULTIPART_UPLOAD_P50_MS)
    })

    it('multipart upload with different part sizes', async () => {
      const partSizes = [1, 5, 10] // MB
      const results: Array<{ partSize: number; p50: number }> = []

      for (const partSizeMB of partSizes) {
        const result = await benchmark({
          name: `parquet-r2-multipart-${partSizeMB}mb`,
          target: 'iceberg.perf.do',
          iterations: 10,
          warmup: 2,
          run: async (ctx, i) => {
            const records = Array.from({ length: 5000 }, (_, j) => ({
              id: `partsize-${partSizeMB}-${i}-${j}`,
              name: `Record ${j}`,
              value: j * 1.5,
              text: 'Padding text for size. '.repeat(20),
            }))

            const response = await ctx.fetch('/parquet/r2/multipart', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                records,
                path: `benchmark/output/partsize-${partSizeMB}-${i}.parquet`,
                partSize: partSizeMB * 1024 * 1024,
              }),
            })

            if (!response.ok) {
              throw new Error(`Part size ${partSizeMB}MB upload failed: ${response.status}`)
            }
            return response.json()
          },
        })

        results.push({ partSize: partSizeMB, p50: result.stats.p50 })
      }

      console.log('\n=== Multipart Part Size Comparison ===')
      console.log('  Part Size | p50 (ms)')
      console.log('  ----------|----------')
      for (const r of results) {
        console.log(`  ${r.partSize.toString().padStart(6)} MB | ${r.p50.toFixed(1)}`)
      }
    })

    it('compares single vs multipart upload', async () => {
      // Single upload
      const single = await benchmark({
        name: 'parquet-r2-upload-single',
        target: 'iceberg.perf.do',
        iterations: 15,
        warmup: 2,
        run: async (ctx, i) => {
          const records = Array.from({ length: 1000 }, (_, j) => ({
            id: `single-${i}-${j}`,
            name: `Record ${j}`,
            value: j * 1.5,
          }))

          const response = await ctx.fetch('/parquet/r2/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              path: `benchmark/output/single-${i}.parquet`,
            }),
          })

          if (!response.ok) {
            throw new Error(`Single upload failed: ${response.status}`)
          }
          return response.json()
        },
      })

      // Multipart upload
      const multipart = await benchmark({
        name: 'parquet-r2-upload-multipart',
        target: 'iceberg.perf.do',
        iterations: 15,
        warmup: 2,
        run: async (ctx, i) => {
          const records = Array.from({ length: 1000 }, (_, j) => ({
            id: `multipart-compare-${i}-${j}`,
            name: `Record ${j}`,
            value: j * 1.5,
          }))

          const response = await ctx.fetch('/parquet/r2/multipart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              records,
              path: `benchmark/output/multipart-compare-${i}.parquet`,
              partSize: 5 * 1024 * 1024,
            }),
          })

          if (!response.ok) {
            throw new Error(`Multipart compare failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record([single, multipart])

      console.log('\n=== Single vs Multipart Upload ===')
      console.log(`  Single upload p50: ${single.stats.p50.toFixed(3)} ms`)
      console.log(`  Multipart upload p50: ${multipart.stats.p50.toFixed(3)} ms`)

      // For small files, single upload should be faster
      // For large files, multipart has parallel advantage
    })
  })

  // ==========================================================================
  // R2 OPERATIONS BENCHMARKS
  // ==========================================================================

  describe('R2 operations', () => {
    it('list parquet files in bucket', async () => {
      const result = await benchmark({
        name: 'parquet-r2-list',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx) => {
          const response = await ctx.fetch('/parquet/r2/list?prefix=benchmark/')
          if (!response.ok) {
            throw new Error(`List failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 List Files ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    })

    it('head parquet file metadata', async () => {
      const result = await benchmark({
        name: 'parquet-r2-head',
        target: 'iceberg.perf.do',
        iterations: R2_ITERATIONS,
        warmup: WARMUP_ITERATIONS,
        run: async (ctx, i) => {
          const filePath = `benchmark/small-file-${i % 10}.parquet`
          const response = await ctx.fetch(`/parquet/r2/head?path=${encodeURIComponent(filePath)}`)
          if (!response.ok) {
            throw new Error(`Head failed: ${response.status}`)
          }
          return response.json()
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Head Metadata ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)

      // HEAD should be very fast
      expect(result.stats.p50).toBeLessThan(MAX_RANGE_REQUEST_P50_MS)
    })

    it('delete parquet file', async () => {
      const result = await benchmark({
        name: 'parquet-r2-delete',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 3,
        setup: async (ctx) => {
          // Create files to delete
          for (let i = 0; i < 35; i++) {
            await ctx.fetch('/parquet/r2/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                records: [{ id: `delete-test-${i}`, value: i }],
                path: `benchmark/delete-test/file-${i}.parquet`,
              }),
            })
          }
        },
        run: async (ctx, i) => {
          const response = await ctx.fetch(`/parquet/r2/delete?path=${encodeURIComponent(`benchmark/delete-test/file-${i}.parquet`)}`, {
            method: 'DELETE',
          })
          if (!response.ok && response.status !== 404) {
            throw new Error(`Delete failed: ${response.status}`)
          }
          return { deleted: response.ok }
        },
      })

      record(result)

      console.log('\n=== Parquet R2 Delete ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
    })
  })
})

// ============================================================================
// SUMMARY
// ============================================================================

describe('Parquet R2 Summary', () => {
  it('should document expected R2 performance', () => {
    console.log('\n========================================')
    console.log('PARQUET R2 PERFORMANCE SUMMARY')
    console.log('========================================\n')

    console.log('Expected performance targets:')
    console.log(`  - Streaming read: <${MAX_STREAMING_READ_P50_MS}ms`)
    console.log(`  - Streaming write: <${MAX_STREAMING_WRITE_P50_MS}ms`)
    console.log(`  - Range request: <${MAX_RANGE_REQUEST_P50_MS}ms`)
    console.log(`  - Multipart upload: <${MAX_MULTIPART_UPLOAD_P50_MS}ms`)
    console.log('')

    console.log('R2 optimization techniques:')
    console.log('  - Range requests for footer/metadata only')
    console.log('  - Row group targeting via byte ranges')
    console.log('  - Column projection via selective ranges')
    console.log('  - Multipart upload for large files')
    console.log('')

    console.log('R2 characteristics:')
    console.log('  - Zero egress fees within Cloudflare')
    console.log('  - Global edge caching for reads')
    console.log('  - S3-compatible API')
    console.log('  - Strong consistency')
    console.log('')

    console.log('Parquet + R2 best practices:')
    console.log('  - Use range requests for metadata')
    console.log('  - Batch small writes into larger files')
    console.log('  - Enable compression for storage savings')
    console.log('  - Use multipart for files >5MB')
    console.log('')

    expect(true).toBe(true)
  })
})
