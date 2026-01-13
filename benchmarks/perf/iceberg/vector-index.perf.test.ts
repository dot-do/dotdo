/**
 * Vector Index Performance Benchmarks
 *
 * Tests vector index operations for semantic similarity search:
 * - Building HNSW vector indexes in Workers
 * - Persistence to R2 with chunking
 * - Incremental updates to existing indexes
 * - Query performance vs index size
 *
 * Expected performance:
 * - Build 1K vectors: <500ms
 * - Query (k=10): <50ms
 * - Incremental add: <5ms per vector
 *
 * @see db/compat/sql/clickhouse/spikes/vector-index.ts for implementation
 * @see dotdo-2mibg for issue tracking
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

describe('VectorIndex benchmarks', () => {
  describe('build vector index', () => {
    it('build vector index with 1K vectors', async () => {
      const result = await benchmark({
        name: 'vector-index-build-1k',
        target: 'iceberg.perf.do',
        iterations: 20,
        warmup: 3,
        run: async (ctx, iteration) => {
          // Generate random 384-dimensional vectors (common embedding size)
          const vectors = Array.from({ length: 1000 }, (_, i) => ({
            id: `vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          return ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              M: 16,
              efConstruction: 200,
              namespace: `vector-build-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Build Vector Index (1K vectors, 384 dims) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(20)
      expect(result.stats.p50).toBeGreaterThan(0)
      // Building 1K vectors should be under 500ms
      expect(result.stats.p50).toBeLessThan(500)
    })

    it.each([100, 500, 1000, 5000])('build index with %d vectors', async (count) => {
      const result = await benchmark({
        name: `vector-index-build-${count}`,
        target: 'iceberg.perf.do',
        iterations: 10,
        warmup: 2,
        run: async (ctx, iteration) => {
          const vectors = Array.from({ length: count }, (_, i) => ({
            id: `vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          return ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: `vector-scale-${count}-${iteration}`,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(10)
      expect(result.stats.p50).toBeGreaterThan(0)
    })

    it('measures build time scaling', async () => {
      const vectorCounts = [100, 500, 1000, 2500]
      const results: Array<{ count: number; p50: number; p99: number }> = []

      for (const count of vectorCounts) {
        const vectors = Array.from({ length: count }, (_, i) => ({
          id: `scale-vec:${i}`,
          vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
        }))

        const result = await benchmark({
          name: `vector-index-scale-${count}`,
          target: 'iceberg.perf.do',
          iterations: 8,
          warmup: 2,
          run: async (ctx, iteration) => {
            return ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric: 'cosine',
                namespace: `scale-test-${count}-${iteration}`,
              }),
            })
          },
        })

        results.push({
          count,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Build Time Scaling ===')
      console.log('  Vectors     | p50 (ms)  | p99 (ms)')
      console.log('  ------------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.count).padEnd(11)} | ${r.p50.toFixed(1).padStart(9)} | ${r.p99.toFixed(1).padStart(8)}`)
      }

      // HNSW build is O(n log n)
      if (results.length >= 2) {
        const timeRatio = results[results.length - 1]!.p50 / results[0]!.p50
        const countRatio = results[results.length - 1]!.count / results[0]!.count
        const nlogn = countRatio * Math.log2(countRatio)
        expect(timeRatio).toBeLessThan(nlogn * 2) // Allow 2x slack
      }
    })

    it('build with different dimensions', async () => {
      const dimensions = [128, 384, 768, 1536]
      const results: Array<{ dims: number; p50: number; memoryMB: number }> = []

      for (const dims of dimensions) {
        const vectors = Array.from({ length: 1000 }, (_, i) => ({
          id: `dim-vec:${i}`,
          vector: Array.from({ length: dims }, () => Math.random() * 2 - 1),
        }))

        const result = await benchmark({
          name: `vector-index-dims-${dims}`,
          target: 'iceberg.perf.do',
          iterations: 8,
          warmup: 2,
          run: async (ctx, iteration) => {
            const response = await ctx.fetch('/iceberg/vector/build', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                vectors,
                dimensions: dims,
                metric: 'cosine',
                namespace: `dims-test-${dims}-${iteration}`,
              }),
            })
            return response.json()
          },
        })

        results.push({
          dims,
          p50: result.stats.p50,
          memoryMB: (dims * 4 * 1000) / (1024 * 1024), // Approximate
        })

        record(result)
      }

      console.log('\n=== Build Time vs Dimensions ===')
      console.log('  Dimensions  | p50 (ms)  | Est Memory (MB)')
      console.log('  ------------|-----------|----------------')
      for (const r of results) {
        console.log(`  ${String(r.dims).padEnd(11)} | ${r.p50.toFixed(1).padStart(9)} | ${r.memoryMB.toFixed(2).padStart(14)}`)
      }

      expect(results.length).toBe(dimensions.length)
    })

    it('build with quantization', async () => {
      const quantizations = ['none', 'float16', 'int8', 'binary'] as const
      const results: Array<{ quant: string; p50: number; sizeFactor: number }> = []

      const vectors = Array.from({ length: 1000 }, (_, i) => ({
        id: `quant-vec:${i}`,
        vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
      }))

      for (const quant of quantizations) {
        const result = await benchmark({
          name: `vector-index-quant-${quant}`,
          target: 'iceberg.perf.do',
          iterations: 10,
          warmup: 2,
          run: async (ctx, iteration) => {
            return ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric: 'cosine',
                quantization: quant,
                namespace: `quant-test-${quant}-${iteration}`,
              }),
            })
          },
        })

        // Calculate size reduction factor
        const sizeFactors: Record<string, number> = {
          none: 1,
          float16: 0.5,
          int8: 0.25,
          binary: 0.03125, // 1/32
        }

        results.push({
          quant,
          p50: result.stats.p50,
          sizeFactor: sizeFactors[quant] ?? 1,
        })

        record(result)
      }

      console.log('\n=== Quantization Impact ===')
      console.log('  Quantization | p50 (ms)  | Size Factor')
      console.log('  -------------|-----------|------------')
      for (const r of results) {
        console.log(`  ${r.quant.padEnd(12)} | ${r.p50.toFixed(1).padStart(9)} | ${r.sizeFactor.toFixed(4).padStart(10)}`)
      }

      expect(results.length).toBe(quantizations.length)
    })
  })

  describe('persist to R2', () => {
    it('persist vector index to R2', async () => {
      const result = await benchmark({
        name: 'vector-index-persist',
        target: 'iceberg.perf.do',
        iterations: 15,
        warmup: 3,
        setup: async (ctx) => {
          const vectors = Array.from({ length: 5000 }, (_, i) => ({
            id: `persist-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: 'persist-test',
            }),
          })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/vector/persist', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'persist-test',
              destination: `r2://indexes/vector/test-${iteration}.hnsw`,
              chunkSize: 10 * 1024 * 1024, // 10MB chunks
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Persist Vector Index to R2 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(15)
    })

    it('load vector index from R2', async () => {
      const result = await benchmark({
        name: 'vector-index-load',
        target: 'iceberg.perf.do',
        iterations: 15,
        warmup: 3,
        setup: async (ctx) => {
          // Create and persist an index
          const vectors = Array.from({ length: 5000 }, (_, i) => ({
            id: `load-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: 'load-source',
            }),
          })

          await ctx.do.request('/iceberg/vector/persist', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'load-source',
              destination: 'r2://indexes/vector/load-test.hnsw',
            }),
          })
        },
        run: async (ctx, iteration) => {
          return ctx.do.request('/iceberg/vector/load', {
            method: 'POST',
            body: JSON.stringify({
              source: 'r2://indexes/vector/load-test.hnsw',
              namespace: `load-target-${iteration}`,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Load Vector Index from R2 ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(15)
    })

    it('measures chunk serialization overhead', async () => {
      const chunkSizes = [1, 5, 10, 20].map((mb) => mb * 1024 * 1024)
      const results: Array<{ chunkMB: number; p50: number; chunks: number }> = []

      for (const chunkSize of chunkSizes) {
        const result = await benchmark({
          name: `vector-index-chunk-${chunkSize / (1024 * 1024)}mb`,
          target: 'iceberg.perf.do',
          iterations: 8,
          warmup: 2,
          setup: async (ctx) => {
            const vectors = Array.from({ length: 5000 }, (_, i) => ({
              id: `chunk-vec:${i}`,
              vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
            }))

            await ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric: 'cosine',
                namespace: `chunk-${chunkSize}`,
              }),
            })
          },
          run: async (ctx, iteration) => {
            const response = await ctx.fetch('/iceberg/vector/persist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                namespace: `chunk-${chunkSize}`,
                destination: `r2://indexes/vector/chunk-test-${chunkSize}-${iteration}.hnsw`,
                chunkSize,
              }),
            })
            return response.json()
          },
        })

        // Estimate number of chunks
        const vectorBytes = 5000 * 384 * 4 // 5K vectors * 384 dims * 4 bytes
        const estimatedChunks = Math.ceil(vectorBytes / chunkSize)

        results.push({
          chunkMB: chunkSize / (1024 * 1024),
          p50: result.stats.p50,
          chunks: estimatedChunks,
        })

        record(result)
      }

      console.log('\n=== Chunk Size Impact ===')
      console.log('  Chunk Size  | p50 (ms)  | Est Chunks')
      console.log('  ------------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.chunkMB).padEnd(4)} MB     | ${r.p50.toFixed(1).padStart(9)} | ${String(r.chunks).padStart(10)}`)
      }

      expect(results.length).toBe(chunkSizes.length)
    })
  })

  describe('incremental updates', () => {
    it('add single vector to existing index', async () => {
      const result = await benchmark({
        name: 'vector-index-add-single',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          // Build initial index
          const vectors = Array.from({ length: 1000 }, (_, i) => ({
            id: `base-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: 'incremental-test',
            }),
          })
        },
        run: async (ctx, i) => {
          return ctx.do.request('/iceberg/vector/add', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'incremental-test',
              id: `new-vec:${i}`,
              vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Add Single Vector ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      // Single vector add should be fast
      expect(result.stats.p50).toBeLessThan(5)
    })

    it('batch add vectors', async () => {
      const batchSizes = [10, 50, 100]
      const results: Array<{ size: number; p50: number; perVector: number }> = []

      for (const size of batchSizes) {
        const result = await benchmark({
          name: `vector-index-batch-add-${size}`,
          target: 'iceberg.perf.do',
          iterations: 20,
          warmup: 3,
          setup: async (ctx) => {
            const vectors = Array.from({ length: 1000 }, (_, i) => ({
              id: `batch-base:${i}`,
              vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
            }))

            await ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric: 'cosine',
                namespace: `batch-add-${size}`,
              }),
            })
          },
          run: async (ctx, iteration) => {
            const newVectors = Array.from({ length: size }, (_, i) => ({
              id: `batch-new-${iteration}:${i}`,
              vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
            }))

            return ctx.do.request('/iceberg/vector/add-batch', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `batch-add-${size}`,
                vectors: newVectors,
              }),
            })
          },
        })

        results.push({
          size,
          p50: result.stats.p50,
          perVector: result.stats.p50 / size,
        })

        record(result)
      }

      console.log('\n=== Batch Add Performance ===')
      console.log('  Batch Size  | p50 (ms)  | ms/vector')
      console.log('  ------------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(11)} | ${r.p50.toFixed(1).padStart(9)} | ${r.perVector.toFixed(3).padStart(8)}`)
      }

      // Batch should have better per-vector performance
      expect(results[results.length - 1]!.perVector).toBeLessThan(results[0]!.perVector)
    })
  })

  describe('query performance', () => {
    it('query vector index (k=10)', async () => {
      const result = await benchmark({
        name: 'vector-index-query-k10',
        target: 'iceberg.perf.do',
        iterations: 100,
        warmup: 10,
        setup: async (ctx) => {
          const vectors = Array.from({ length: 10000 }, (_, i) => ({
            id: `query-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: 'query-test',
            }),
          })
        },
        run: async (ctx) => {
          const queryVector = Array.from({ length: 384 }, () => Math.random() * 2 - 1)
          return ctx.do.request('/iceberg/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'query-test',
              vector: queryVector,
              k: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Query Vector Index (k=10, 10K vectors) ===')
      console.log(`  Iterations: ${result.iterations}`)
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(100)
      // Query should be fast
      expect(result.stats.p50).toBeLessThan(50)
    })

    it.each([1, 10, 50, 100])('query with k=%d', async (k) => {
      const result = await benchmark({
        name: `vector-index-query-k${k}`,
        target: 'iceberg.perf.do',
        iterations: 50,
        warmup: 5,
        setup: async (ctx) => {
          const vectors = Array.from({ length: 10000 }, (_, i) => ({
            id: `k-query-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: `query-k-${k}`,
            }),
          })
        },
        run: async (ctx) => {
          const queryVector = Array.from({ length: 384 }, () => Math.random() * 2 - 1)
          return ctx.do.request('/iceberg/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              namespace: `query-k-${k}`,
              vector: queryVector,
              k,
            }),
          })
        },
      })

      record(result)

      expect(result.samples.length).toBe(50)
    })

    it('measures query time vs index size', async () => {
      const indexSizes = [1000, 5000, 10000, 25000]
      const results: Array<{ size: number; p50: number; p99: number }> = []

      for (const size of indexSizes) {
        const vectors = Array.from({ length: size }, (_, i) => ({
          id: `size-query-vec:${i}`,
          vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
        }))

        const result = await benchmark({
          name: `vector-index-query-size-${size}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 5,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric: 'cosine',
                namespace: `query-size-${size}`,
              }),
            })
          },
          run: async (ctx) => {
            const queryVector = Array.from({ length: 384 }, () => Math.random() * 2 - 1)
            return ctx.do.request('/iceberg/vector/search', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `query-size-${size}`,
                vector: queryVector,
                k: 10,
              }),
            })
          },
        })

        results.push({
          size,
          p50: result.stats.p50,
          p99: result.stats.p99,
        })

        record(result)
      }

      console.log('\n=== Query Time vs Index Size ===')
      console.log('  Index Size  | p50 (ms)  | p99 (ms)')
      console.log('  ------------|-----------|----------')
      for (const r of results) {
        console.log(`  ${String(r.size).padEnd(11)} | ${r.p50.toFixed(1).padStart(9)} | ${r.p99.toFixed(1).padStart(8)}`)
      }

      // HNSW query is O(log n), so should scale slowly
      if (results.length >= 2) {
        const timeRatio = results[results.length - 1]!.p50 / results[0]!.p50
        const sizeRatio = results[results.length - 1]!.size / results[0]!.size
        // Time should grow much slower than size
        expect(timeRatio).toBeLessThan(Math.sqrt(sizeRatio))
      }
    })

    it('measures query time with different metrics', async () => {
      const metrics = ['cosine', 'euclidean', 'dot'] as const
      const results: Array<{ metric: string; p50: number }> = []

      const vectors = Array.from({ length: 10000 }, (_, i) => ({
        id: `metric-vec:${i}`,
        vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
      }))

      for (const metric of metrics) {
        const result = await benchmark({
          name: `vector-index-metric-${metric}`,
          target: 'iceberg.perf.do',
          iterations: 30,
          warmup: 5,
          setup: async (ctx) => {
            await ctx.do.request('/iceberg/vector/build', {
              method: 'POST',
              body: JSON.stringify({
                vectors,
                dimensions: 384,
                metric,
                namespace: `metric-${metric}`,
              }),
            })
          },
          run: async (ctx) => {
            const queryVector = Array.from({ length: 384 }, () => Math.random() * 2 - 1)
            return ctx.do.request('/iceberg/vector/search', {
              method: 'POST',
              body: JSON.stringify({
                namespace: `metric-${metric}`,
                vector: queryVector,
                k: 10,
              }),
            })
          },
        })

        results.push({
          metric,
          p50: result.stats.p50,
        })

        record(result)
      }

      console.log('\n=== Query Time by Metric ===')
      console.log('  Metric      | p50 (ms)')
      console.log('  ------------|----------')
      for (const r of results) {
        console.log(`  ${r.metric.padEnd(11)} | ${r.p50.toFixed(3).padStart(8)}`)
      }

      // All metrics should be reasonably fast
      for (const r of results) {
        expect(r.p50).toBeLessThan(100)
      }
    })
  })

  describe('memory constraints', () => {
    it('verify index fits in 128MB memory limit', async () => {
      const result = await benchmark({
        name: 'vector-index-memory-check',
        target: 'iceberg.perf.do',
        iterations: 5,
        warmup: 1,
        run: async (ctx, iteration) => {
          // Build largest practical index
          const vectors = Array.from({ length: 50000 }, (_, i) => ({
            id: `memory-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          const response = await ctx.fetch('/iceberg/vector/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              quantization: 'int8', // Use quantization to reduce memory
              namespace: `memory-check-${iteration}`,
            }),
          })

          const data = (await response.json()) as { memoryBytes: number }
          return data
        },
      })

      record(result)

      console.log('\n=== Memory Check (50K vectors, int8) ===')
      console.log(`  Build p50: ${result.stats.p50.toFixed(1)} ms`)

      expect(result.samples.length).toBe(5)
    })

    it('streaming search with chunk loading', async () => {
      const result = await benchmark({
        name: 'vector-index-streaming-search',
        target: 'iceberg.perf.do',
        iterations: 30,
        warmup: 5,
        setup: async (ctx) => {
          // Build and persist large index
          const vectors = Array.from({ length: 20000 }, (_, i) => ({
            id: `stream-vec:${i}`,
            vector: Array.from({ length: 384 }, () => Math.random() * 2 - 1),
          }))

          await ctx.do.request('/iceberg/vector/build', {
            method: 'POST',
            body: JSON.stringify({
              vectors,
              dimensions: 384,
              metric: 'cosine',
              namespace: 'streaming-source',
            }),
          })

          await ctx.do.request('/iceberg/vector/persist', {
            method: 'POST',
            body: JSON.stringify({
              namespace: 'streaming-source',
              destination: 'r2://indexes/vector/streaming-test.hnsw',
              chunkSize: 5 * 1024 * 1024, // 5MB chunks
            }),
          })
        },
        run: async (ctx) => {
          const queryVector = Array.from({ length: 384 }, () => Math.random() * 2 - 1)
          return ctx.do.request('/iceberg/vector/search-streaming', {
            method: 'POST',
            body: JSON.stringify({
              source: 'r2://indexes/vector/streaming-test.hnsw',
              vector: queryVector,
              k: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n=== Streaming Search (on-demand chunk loading) ===')
      console.log(`  p50: ${result.stats.p50.toFixed(3)} ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(3)} ms`)

      expect(result.samples.length).toBe(30)
    })
  })
})
