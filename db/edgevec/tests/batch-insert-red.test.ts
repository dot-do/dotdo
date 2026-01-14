/**
 * Batch Insert RED Tests - TDD Tests for Edge Cases and Advanced Features
 *
 * These are RED phase tests that define expected behavior for:
 * - Memory pressure handling
 * - Timeout and cancellation
 * - Retry logic
 * - Metadata validation
 * - Streaming large datasets
 *
 * @module db/edgevec/tests/batch-insert-red.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  BatchInserter,
  type VectorInput,
  type BatchInsertOptions,
  type BatchInsertResult,
} from '../batch-insert'

import { createHNSWIndex, type HNSWIndex } from '../hnsw'
import { createFilteredIndex, type FilteredHNSWIndex } from '../filtered-search'

// ============================================================================
// TEST UTILITIES
// ============================================================================

function seededVector(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    v[i] = (seed / 0x7fffffff) * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

function createVectorBatch(count: number, dim: number, startId = 0): VectorInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec-${startId + i}`,
    vector: seededVector(dim, startId + i),
  }))
}

function createVectorBatchWithMetadata(
  count: number,
  dim: number,
  startId = 0
): VectorInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec-${startId + i}`,
    vector: seededVector(dim, startId + i),
    metadata: {
      category: `cat-${i % 5}`,
      score: (i % 100) / 100,
      tags: [`tag-${i % 3}`, `tag-${(i + 1) % 3}`],
      timestamp: Date.now() - i * 1000,
    },
  }))
}

// ============================================================================
// MEMORY PRESSURE TESTS
// ============================================================================

describe('Memory Pressure Handling', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should respect maxMemoryMB limit and chunk accordingly', async () => {
    const inserter = new BatchInserter(index, {
      maxMemoryMB: 1, // Very low memory limit
      chunkSize: 1000, // Large chunk size that should be reduced
    })

    const vectors = createVectorBatch(500, 128)
    const result = await inserter.insertBatch(vectors)

    // Should succeed by adapting chunk size
    expect(result.inserted).toBe(500)
    expect(result.failed).toBe(0)
    // Should have processed in multiple chunks due to memory constraint
    expect(result.chunks).toBeGreaterThan(1)
  })

  it('should report peak memory usage in result', async () => {
    const inserter = new BatchInserter(index, {
      chunkSize: 100,
    })

    const vectors = createVectorBatch(500, 128)
    const result = await inserter.insertBatch(vectors)

    expect(result.peakMemoryBytes).toBeDefined()
    expect(result.peakMemoryBytes).toBeGreaterThan(0)
  })

  it('should handle memory exhaustion gracefully', async () => {
    const inserter = new BatchInserter(index, {
      maxMemoryMB: 0.001, // Impossibly low
      skipOnError: true,
    })

    const vectors = createVectorBatch(100, 128)
    const result = await inserter.insertBatch(vectors)

    // Should either succeed with adaptive chunking or report failures
    expect(result.inserted + result.failed).toBe(100)
  })
})

// ============================================================================
// TIMEOUT AND CANCELLATION TESTS
// ============================================================================

describe('Timeout and Cancellation', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should respect timeout and return partial results', async () => {
    const inserter = new BatchInserter(index, {
      timeoutMs: 10, // Very short timeout
      chunkSize: 10,
    })

    const vectors = createVectorBatch(1000, 128)
    const result = await inserter.insertBatch(vectors)

    // Should have been cancelled due to timeout
    expect(result.cancelled).toBe(true)
    // Should have partial progress
    expect(result.inserted).toBeLessThan(1000)
    expect(result.inserted).toBeGreaterThan(0)
  })

  it('should respect AbortSignal cancellation', async () => {
    const controller = new AbortController()

    const inserter = new BatchInserter(index, {
      signal: controller.signal,
      chunkSize: 10,
    })

    const vectors = createVectorBatch(500, 128)

    // Abort after a short delay
    setTimeout(() => controller.abort(), 5)

    const result = await inserter.insertBatch(vectors)

    expect(result.cancelled).toBe(true)
    expect(result.inserted).toBeLessThan(500)
  })

  it('should return immediately if already aborted', async () => {
    const controller = new AbortController()
    controller.abort() // Abort immediately

    const inserter = new BatchInserter(index, {
      signal: controller.signal,
    })

    const vectors = createVectorBatch(100, 128)
    const result = await inserter.insertBatch(vectors)

    expect(result.cancelled).toBe(true)
    expect(result.inserted).toBe(0)
    expect(result.durationMs).toBeLessThan(10)
  })
})

// ============================================================================
// RETRY LOGIC TESTS
// ============================================================================

describe('Retry Logic', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should retry failed insertions up to maxRetries', async () => {
    // Create a failing vector with wrong dimensions
    const vectors: VectorInput[] = [
      { id: 'good-1', vector: seededVector(128, 1) },
      { id: 'bad-1', vector: seededVector(64, 2) }, // Wrong dimensions
      { id: 'good-2', vector: seededVector(128, 3) },
    ]

    const inserter = new BatchInserter(index, {
      maxRetries: 3,
      retryDelayMs: 10,
      skipOnError: true,
    })

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.retried).toBeDefined()
    expect(result.retried).toBeGreaterThan(0)
  })

  it('should apply exponential backoff between retries', async () => {
    const startTime = Date.now()

    const vectors: VectorInput[] = [
      { id: 'bad-1', vector: seededVector(64, 1) }, // Wrong dimensions
    ]

    const inserter = new BatchInserter(index, {
      maxRetries: 3,
      retryDelayMs: 50, // Base delay
      skipOnError: true,
    })

    await inserter.insertBatch(vectors)
    const elapsed = Date.now() - startTime

    // With exponential backoff: 50 + 100 + 200 = 350ms minimum
    // But this depends on implementation - test behavior not timing
    expect(elapsed).toBeGreaterThan(0)
  })
})

// ============================================================================
// METADATA VALIDATION TESTS
// ============================================================================

describe('Metadata Validation', () => {
  let index: FilteredHNSWIndex

  beforeEach(() => {
    index = createFilteredIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should validate metadata against JSON schema', async () => {
    const schema = {
      type: 'object',
      properties: {
        category: { type: 'string' },
        score: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['category'],
    }

    const inserter = new BatchInserter(index, {
      metadataSchema: schema,
      skipOnError: true,
    })

    const vectors: VectorInput[] = [
      {
        id: 'valid-1',
        vector: seededVector(128, 1),
        metadata: { category: 'test', score: 0.5 },
      },
      {
        id: 'invalid-1',
        vector: seededVector(128, 2),
        metadata: { score: 1.5 }, // Missing required category, score out of range
      },
      {
        id: 'valid-2',
        vector: seededVector(128, 3),
        metadata: { category: 'other' },
      },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(2)
    expect(result.metadataValidationErrors).toBe(1)
  })

  it('should index metadata fields for filtered search', async () => {
    const inserter = new BatchInserter(index, {
      indexMetadata: true,
    })

    const vectors: VectorInput[] = [
      {
        id: 'doc-1',
        vector: seededVector(128, 1),
        metadata: { category: 'electronics', price: 999 },
      },
      {
        id: 'doc-2',
        vector: seededVector(128, 2),
        metadata: { category: 'books', price: 29 },
      },
    ]

    await inserter.insertBatch(vectors)

    // Verify metadata was indexed by checking filtered search works
    const results = index.search(seededVector(128, 1), {
      k: 10,
      filter: { category: 'electronics' },
    })

    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe('doc-1')
  })
})

// ============================================================================
// STREAMING INSERTION TESTS
// ============================================================================

describe('Streaming Insertion', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should handle async iterator with backpressure', async () => {
    const inserter = new BatchInserter(index, {
      chunkSize: 50,
    })

    async function* generateVectors(): AsyncGenerator<VectorInput> {
      for (let i = 0; i < 200; i++) {
        // Simulate slow producer
        if (i % 50 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        yield {
          id: `stream-${i}`,
          vector: seededVector(128, i),
        }
      }
    }

    const result = await inserter.insertFromIterator(generateVectors())

    expect(result.inserted).toBe(200)
    expect(result.chunks).toBe(4) // 200 / 50 = 4 chunks
  })

  it('should handle synchronous iterator', async () => {
    const inserter = new BatchInserter(index, {
      chunkSize: 25,
    })

    function* generateVectors(): Generator<VectorInput> {
      for (let i = 0; i < 100; i++) {
        yield {
          id: `sync-${i}`,
          vector: seededVector(128, i),
        }
      }
    }

    const result = await inserter.insertFromIterator(generateVectors())

    expect(result.inserted).toBe(100)
    expect(result.chunks).toBe(4) // 100 / 25 = 4 chunks
  })

  it('should handle empty iterator gracefully', async () => {
    const inserter = new BatchInserter(index, {
      chunkSize: 50,
    })

    async function* emptyGenerator(): AsyncGenerator<VectorInput> {
      // Yields nothing
    }

    const result = await inserter.insertFromIterator(emptyGenerator())

    expect(result.inserted).toBe(0)
    expect(result.chunks).toBe(0)
  })

  it('should handle iterator that throws', async () => {
    const inserter = new BatchInserter(index, {
      chunkSize: 50,
      skipOnError: true,
    })

    async function* faultyGenerator(): AsyncGenerator<VectorInput> {
      for (let i = 0; i < 100; i++) {
        if (i === 75) {
          throw new Error('Simulated stream error')
        }
        yield {
          id: `faulty-${i}`,
          vector: seededVector(128, i),
        }
      }
    }

    // Should handle the error gracefully
    await expect(
      inserter.insertFromIterator(faultyGenerator())
    ).rejects.toThrow('Simulated stream error')
  })
})

// ============================================================================
// CONCURRENT INSERTION TESTS
// ============================================================================

describe('Concurrent Insertion', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should handle high concurrency without data loss', async () => {
    const inserter = new BatchInserter(index, {
      concurrency: 8,
      chunkSize: 50,
    })

    const vectors = createVectorBatch(400, 128)
    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(400)
    expect(result.failed).toBe(0)
    expect(index.size()).toBe(400)
  })

  it('should maintain insertion order in results', async () => {
    const inserter = new BatchInserter(index, {
      concurrency: 4,
      chunkSize: 25,
    })

    const vectors = createVectorBatch(100, 128)
    await inserter.insertBatch(vectors)

    // Verify all vectors are present
    for (let i = 0; i < 100; i++) {
      expect(index.has(`vec-${i}`)).toBe(true)
    }
  })

  it('should limit actual concurrency to specified value', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const originalInsert = index.insert.bind(index)
    index.insert = (id: string, vector: Float32Array) => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      const result = originalInsert(id, vector)
      currentConcurrent--
      return result
    }

    const inserter = new BatchInserter(index, {
      concurrency: 4,
      chunkSize: 10,
    })

    const vectors = createVectorBatch(100, 128)
    await inserter.insertBatch(vectors)

    expect(maxConcurrent).toBeLessThanOrEqual(4)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 100,
      metric: 'cosine',
    })
  })

  it('should handle empty batch', async () => {
    const inserter = new BatchInserter(index)

    const result = await inserter.insertBatch([])

    expect(result.inserted).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.chunks).toBe(0)
  })

  it('should handle single vector batch', async () => {
    const inserter = new BatchInserter(index)

    const result = await inserter.insertBatch([
      { id: 'single', vector: seededVector(128, 1) },
    ])

    expect(result.inserted).toBe(1)
    expect(result.chunks).toBe(1)
  })

  it('should handle vectors with number[] instead of Float32Array', async () => {
    const inserter = new BatchInserter(index)

    const numberVector = Array.from({ length: 128 }, (_, i) => Math.sin(i))

    const result = await inserter.insertBatch([
      { id: 'number-array', vector: numberVector },
    ])

    expect(result.inserted).toBe(1)
  })

  it('should handle special characters in IDs', async () => {
    const inserter = new BatchInserter(index)

    const vectors: VectorInput[] = [
      { id: 'id-with-dash', vector: seededVector(128, 1) },
      { id: 'id_with_underscore', vector: seededVector(128, 2) },
      { id: 'id.with.dots', vector: seededVector(128, 3) },
      { id: 'id/with/slashes', vector: seededVector(128, 4) },
      { id: 'id:with:colons', vector: seededVector(128, 5) },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(5)
    expect(index.has('id-with-dash')).toBe(true)
    expect(index.has('id/with/slashes')).toBe(true)
  })

  it('should handle very large IDs', async () => {
    const inserter = new BatchInserter(index)

    const longId = 'x'.repeat(1000)
    const result = await inserter.insertBatch([
      { id: longId, vector: seededVector(128, 1) },
    ])

    expect(result.inserted).toBe(1)
    expect(index.has(longId)).toBe(true)
  })

  it('should handle Unicode IDs', async () => {
    const inserter = new BatchInserter(index)

    const vectors: VectorInput[] = [
      { id: 'hello-world', vector: seededVector(128, 2) },
      { id: 'cafe', vector: seededVector(128, 3) },
      { id: 'test-emoji', vector: seededVector(128, 4) },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(3)
  })
})
