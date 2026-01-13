/**
 * VectorIndex Primitive Benchmarks
 *
 * Performance benchmarks for the VectorIndex Durable Object primitive:
 * - Batch vector insertion
 * - kNN (k-Nearest Neighbors) search
 * - Filtered vector search
 * - Distance calculations
 *
 * Expected Performance Targets:
 * | Operation | Expected |
 * |-----------|----------|
 * | batch insert 100 vectors (384 dims) | <15ms |
 * | kNN search k=10 | <20ms |
 * | kNN search k=100 | <30ms |
 * | filtered vector search | <25ms |
 *
 * @see benchmarks/lib for benchmark runner utilities
 */

import { describe, it, expect } from 'vitest'
import { benchmark, record } from '../../lib'

/** Default vector dimension (matches common embedding models) */
const VECTOR_DIMENSION = 384

/** Generate a random normalized vector */
function generateRandomVector(dimension: number): number[] {
  const vector: number[] = []
  let magnitude = 0

  for (let i = 0; i < dimension; i++) {
    const value = Math.random() * 2 - 1
    vector.push(value)
    magnitude += value * value
  }

  // Normalize the vector
  magnitude = Math.sqrt(magnitude)
  return vector.map((v) => v / magnitude)
}

describe('VectorIndex benchmarks', () => {
  describe('insert operations', () => {
    it('batch insert 100 vectors (384 dims)', async () => {
      const result = await benchmark({
        name: 'vector-batch-insert-100',
        target: 'vector.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 100,
        setup: async (ctx) => {
          await ctx.do.request('/vector/clear', { method: 'POST' })
        },
        run: async (ctx, iteration) => {
          const vectors = []
          for (let i = 0; i < 100; i++) {
            vectors.push({
              id: `vec-${iteration}-${i}`,
              vector: generateRandomVector(VECTOR_DIMENSION),
              metadata: {
                category: ['technology', 'science', 'business', 'health', 'sports'][i % 5],
                source: `batch-${iteration}`,
                index: i,
                timestamp: Date.now(),
              },
            })
          }

          return ctx.do.request('/vector/batch-insert', {
            method: 'POST',
            body: JSON.stringify({ vectors }),
          })
        },
        teardown: async (ctx) => {
          await ctx.do.request('/vector/clear', { method: 'POST' })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Batch Insert (100 vectors, 384 dims) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)
      console.log(`  Throughput: ${(100 / result.stats.mean * 1000).toFixed(0)} vectors/sec`)

      expect(result.stats.p95).toBeLessThan(15) // <15ms target
    })

    it('single vector insert', async () => {
      const result = await benchmark({
        name: 'vector-single-insert',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          return ctx.do.request('/vector/insert', {
            method: 'POST',
            body: JSON.stringify({
              id: `single-vec-${iteration}`,
              vector: generateRandomVector(VECTOR_DIMENSION),
              metadata: {
                category: 'benchmark',
                iteration,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Single Insert Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(5) // <5ms for single insert
    })
  })

  describe('kNN search operations', () => {
    it('kNN search k=10', async () => {
      const result = await benchmark({
        name: 'vector-knn-k10',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        datasetSize: 10000,
        setup: async (ctx) => {
          // Pre-populate with 10K vectors
          const stats = await ctx.do.request<{ vectorCount: number }>('/vector/stats')
          if (stats.vectorCount < 10000) {
            await ctx.do.request('/vector/clear', { method: 'POST' })

            // Insert in batches of 100
            for (let batch = 0; batch < 100; batch++) {
              const vectors = []
              for (let i = 0; i < 100; i++) {
                vectors.push({
                  id: `indexed-vec-${batch * 100 + i}`,
                  vector: generateRandomVector(VECTOR_DIMENSION),
                  metadata: {
                    category: ['technology', 'science', 'business', 'health', 'sports'][i % 5],
                    batch,
                    index: i,
                  },
                })
              }
              await ctx.do.request('/vector/batch-insert', {
                method: 'POST',
                body: JSON.stringify({ vectors }),
              })
            }
          }
        },
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex kNN Search k=10 (10K vectors) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms target
    })

    it('kNN search k=100', async () => {
      const result = await benchmark({
        name: 'vector-knn-k100',
        target: 'vector.perf.do',
        iterations: 200,
        warmup: 20,
        datasetSize: 10000,
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 100,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex kNN Search k=100 (10K vectors) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms target
    })

    it('kNN search with distance threshold', async () => {
      const result = await benchmark({
        name: 'vector-knn-threshold',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 50,
              maxDistance: 0.8, // Only return vectors within distance threshold
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex kNN with Distance Threshold Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(25) // <25ms
    })
  })

  describe('filtered vector search', () => {
    it('filtered vector search (category filter)', async () => {
      const categories = ['technology', 'science', 'business', 'health', 'sports']

      const result = await benchmark({
        name: 'vector-filtered-search',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx, iteration) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          const category = categories[iteration % 5]

          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
              filter: {
                field: 'category',
                operator: 'eq',
                value: category,
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Filtered Search (category) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(25) // <25ms target
    })

    it('filtered vector search (multi-field filter)', async () => {
      const result = await benchmark({
        name: 'vector-multi-filter-search',
        target: 'vector.perf.do',
        iterations: 200,
        warmup: 20,
        run: async (ctx, iteration) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)

          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
              filter: {
                and: [
                  { field: 'category', operator: 'eq', value: 'technology' },
                  { field: 'batch', operator: 'lt', value: 50 },
                ],
              },
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Multi-Filter Search Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(30) // <30ms
    })
  })

  describe('distance metrics', () => {
    it('cosine similarity search', async () => {
      const result = await benchmark({
        name: 'vector-cosine-search',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
              metric: 'cosine',
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Cosine Similarity Search Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms
    })

    it('euclidean distance search', async () => {
      const result = await benchmark({
        name: 'vector-euclidean-search',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
              metric: 'euclidean',
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Euclidean Distance Search Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms
    })

    it('dot product search', async () => {
      const result = await benchmark({
        name: 'vector-dot-product-search',
        target: 'vector.perf.do',
        iterations: 500,
        warmup: 25,
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
              metric: 'dot',
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex Dot Product Search Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(20) // <20ms
    })
  })

  describe('scaling benchmarks', () => {
    it('search 50K vectors k=10', async () => {
      const result = await benchmark({
        name: 'vector-50k-knn-k10',
        target: 'vector.perf.do',
        iterations: 100,
        warmup: 10,
        datasetSize: 50000,
        setup: async (ctx) => {
          // Check if we need to populate more vectors
          const stats = await ctx.do.request<{ vectorCount: number }>('/vector/stats')
          if (stats.vectorCount < 50000) {
            // Insert additional vectors to reach 50K
            const batchesToAdd = Math.ceil((50000 - stats.vectorCount) / 100)
            for (let batch = 0; batch < batchesToAdd; batch++) {
              const vectors = []
              for (let i = 0; i < 100; i++) {
                vectors.push({
                  id: `scale-vec-${batch * 100 + i}`,
                  vector: generateRandomVector(VECTOR_DIMENSION),
                  metadata: {
                    category: ['technology', 'science', 'business', 'health', 'sports'][i % 5],
                  },
                })
              }
              await ctx.do.request('/vector/batch-insert', {
                method: 'POST',
                body: JSON.stringify({ vectors }),
              })
            }
          }
        },
        run: async (ctx) => {
          const queryVector = generateRandomVector(VECTOR_DIMENSION)
          return ctx.do.request('/vector/search', {
            method: 'POST',
            body: JSON.stringify({
              vector: queryVector,
              k: 10,
            }),
          })
        },
      })

      record(result)

      console.log('\n--- VectorIndex kNN k=10 (50K vectors) Benchmark ---')
      console.log(`  p50: ${result.stats.p50.toFixed(2)}ms`)
      console.log(`  p95: ${result.stats.p95.toFixed(2)}ms`)
      console.log(`  p99: ${result.stats.p99.toFixed(2)}ms`)

      expect(result.stats.p95).toBeLessThan(100) // <100ms for 50K vectors
    })
  })

  describe('summary', () => {
    it('should report vector index benchmark targets', () => {
      console.log('\n========================================')
      console.log('VECTOR INDEX BENCHMARK SUMMARY')
      console.log('========================================\n')

      console.log('Performance Targets:')
      console.log('  | Operation | Target |')
      console.log('  |-----------|--------|')
      console.log('  | batch insert 100 (384d) | <15ms |')
      console.log('  | single insert | <5ms |')
      console.log('  | kNN k=10 | <20ms |')
      console.log('  | kNN k=100 | <30ms |')
      console.log('  | filtered search | <25ms |')
      console.log('  | 50K vectors k=10 | <100ms |')
      console.log('')

      console.log('Vector Index Configuration:')
      console.log(`  - Default dimension: ${VECTOR_DIMENSION}`)
      console.log('  - Supported metrics: cosine, euclidean, dot')
      console.log('  - Index type: brute-force (flat)')
      console.log('  - Filter support: metadata field filters')
      console.log('')

      console.log('Distance Metric Complexity:')
      console.log('  - Cosine: O(d) per vector (normalize + dot)')
      console.log('  - Euclidean: O(d) per vector (squared sum)')
      console.log('  - Dot product: O(d) per vector')
      console.log('')

      console.log('Search Complexity:')
      console.log('  - Brute force: O(n * d) where n=vectors, d=dimension')
      console.log('  - With filter: O(n * d + m) where m=filter cost')
      console.log('  - Top-k selection: O(n log k) using heap')
      console.log('')

      expect(true).toBe(true)
    })
  })
})
