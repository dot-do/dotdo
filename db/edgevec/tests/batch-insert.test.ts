/**
 * Batch Insert Tests
 *
 * RED phase TDD tests for batch vector insertion.
 * Tests comprehensive batch operations, insert modes, concurrency,
 * performance characteristics, metadata handling, and edge cases.
 *
 * @module db/edgevec/tests/batch-insert.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import from batch-insert module
import {
  BatchInserter,
  type VectorInput,
  type BatchInsertOptions,
  type BatchInsertResult,
} from '../batch-insert'

// Import HNSW for creating test indices
import { createHNSWIndex, type HNSWIndex } from '../hnsw'
import { createFilteredIndex, type FilteredHNSWIndex } from '../filtered-search'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random normalized vector
 */
function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) {
    v[i] /= norm
  }
  return v
}

/**
 * Generate a reproducible vector based on seed
 */
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

/**
 * Create batch of vector inputs
 */
function createVectorBatch(count: number, dim: number, startId = 0): VectorInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec-${startId + i}`,
    vector: seededVector(dim, startId + i),
  }))
}

/**
 * Create batch with metadata
 */
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
// BATCH OPERATIONS TESTS
// ============================================================================

describe('Batch Operations', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('inserts batch of vectors', async () => {
    const inserter = new BatchInserter(index)
    const vectors = createVectorBatch(100, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(100)
    expect(result.failed).toBe(0)
    expect(index.size()).toBe(100)

    // Verify vectors are searchable
    const query = seededVector(128, 50)
    const searchResults = index.search(query, { k: 10 })
    expect(searchResults.length).toBe(10)
    expect(searchResults[0].id).toBe('vec-50')
  })

  it('respects batch size limit', async () => {
    const inserter = new BatchInserter(index, { chunkSize: 25 })
    const vectors = createVectorBatch(100, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(100)
    expect(result.chunks).toBe(4) // 100 / 25 = 4 chunks
    expect(index.size()).toBe(100)
  })

  it('handles oversized batch', async () => {
    const inserter = new BatchInserter(index, { chunkSize: 50 })
    const vectors = createVectorBatch(500, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(500)
    expect(result.chunks).toBe(10) // 500 / 50 = 10 chunks
    expect(index.size()).toBe(500)
  })

  it('reports progress during batch', async () => {
    const progressValues: number[] = []
    const inserter = new BatchInserter(index, {
      chunkSize: 25,
      onProgress: (progress) => progressValues.push(progress),
    })

    const vectors = createVectorBatch(100, 128)
    await inserter.insertBatch(vectors)

    // Should have 4 progress updates (one per chunk)
    expect(progressValues.length).toBe(4)
    expect(progressValues[0]).toBe(0.25)
    expect(progressValues[1]).toBe(0.5)
    expect(progressValues[2]).toBe(0.75)
    expect(progressValues[3]).toBe(1.0)
  })
})

// ============================================================================
// INSERT MODES TESTS
// ============================================================================

describe('Insert Modes', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })

    // Pre-populate with some vectors
    for (let i = 0; i < 50; i++) {
      index.insert(`vec-${i}`, seededVector(128, i))
    }
  })

  it('upsert mode updates existing', async () => {
    // NOTE: This tests that InsertMode.UPSERT is supported as an option
    // The inserter should accept { insertMode: 'upsert' } option
    const inserter = new BatchInserter(index, { insertMode: 'upsert' } as BatchInsertOptions)

    // Create batch that overlaps with existing vectors
    const vectors: VectorInput[] = [
      { id: 'vec-25', vector: randomVector(128) }, // Existing - should update
      { id: 'vec-100', vector: randomVector(128) }, // New - should insert
      { id: 'vec-49', vector: randomVector(128) }, // Existing - should update
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.updated).toBe(2) // Should report 2 updates
    expect(index.size()).toBe(51) // 50 existing + 1 new
    expect(index.has('vec-100')).toBe(true)
  })

  it('insert mode fails on duplicate', async () => {
    // NOTE: This tests that InsertMode.STRICT is supported
    // { insertMode: 'strict' } should reject duplicates
    const inserter = new BatchInserter(index, {
      insertMode: 'strict',
      skipOnError: false,
      failFast: true,
    } as BatchInsertOptions)

    // Try to insert a duplicate
    const vectors: VectorInput[] = [
      { id: 'vec-25', vector: randomVector(128) }, // Duplicate
    ]

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/duplicate/)
    expect(index.size()).toBe(50) // Unchanged
  })

  it('replace mode overwrites completely', async () => {
    // NOTE: This tests that InsertMode.REPLACE is supported
    // { insertMode: 'replace' } should completely replace vector and metadata
    const inserter = new BatchInserter(index, { insertMode: 'replace' } as BatchInsertOptions)

    // Get original vector
    const originalVector = index.getVector('vec-25')!

    // Replace with new vector
    const newVector = randomVector(128)
    const vectors: VectorInput[] = [
      { id: 'vec-25', vector: newVector },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(1)
    expect(result.replaced).toBe(1) // Should report as replaced

    // Verify vector was replaced
    const storedVector = index.getVector('vec-25')!
    // New vector should be different from original
    let similarity = 0
    for (let i = 0; i < 128; i++) {
      similarity += storedVector[i] * newVector[i]
    }
    expect(similarity).toBeCloseTo(1, 5) // Should match new vector
  })

  it('skip mode silently ignores duplicates', async () => {
    // NOTE: This tests that InsertMode.SKIP is supported
    // { insertMode: 'skip' } should silently skip duplicates without error
    const inserter = new BatchInserter(index, { insertMode: 'skip' } as BatchInsertOptions)

    const vectors: VectorInput[] = [
      { id: 'vec-25', vector: randomVector(128) }, // Duplicate - should skip
      { id: 'vec-100', vector: randomVector(128) }, // New - should insert
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(1) // Should report skipped
    expect(result.failed).toBe(0) // Not a failure
    expect(index.size()).toBe(51)
  })
})

// ============================================================================
// CONCURRENT BATCHES TESTS
// ============================================================================

describe('Concurrent Batches', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('parallel batches safe', async () => {
    const inserter = new BatchInserter(index, { concurrency: 4, chunkSize: 25 })
    const vectors = createVectorBatch(200, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(200)
    expect(result.failed).toBe(0)
    expect(index.size()).toBe(200)

    // Verify all vectors are searchable
    for (let i = 0; i < 200; i += 50) {
      expect(index.has(`vec-${i}`)).toBe(true)
    }
  })

  it('batches are atomic', async () => {
    const inserter = new BatchInserter(index, {
      transactional: true,
      chunkSize: 50,
    })

    // Create batch with one invalid vector in the middle
    const vectors = createVectorBatch(100, 128)
    vectors[75].vector = new Float32Array(64) // Wrong dimension - will fail

    await expect(inserter.insertBatch(vectors)).rejects.toThrow()

    // Index should be empty - all or nothing
    expect(index.size()).toBe(0)
  })

  it('failed batch rolls back', async () => {
    // Pre-populate
    for (let i = 0; i < 50; i++) {
      index.insert(`existing-${i}`, seededVector(128, i))
    }

    const inserter = new BatchInserter(index, {
      transactional: true,
      failFast: true,
    })

    // Create batch with invalid vector
    const vectors: VectorInput[] = [
      { id: 'new-1', vector: seededVector(128, 1000) },
      { id: 'new-2', vector: seededVector(128, 1001) },
      { id: 'new-3', vector: new Float32Array(64) }, // Invalid
    ]

    await expect(inserter.insertBatch(vectors)).rejects.toThrow()

    // New vectors should be rolled back
    expect(index.has('new-1')).toBe(false)
    expect(index.has('new-2')).toBe(false)
    // Original vectors should remain
    expect(index.size()).toBe(50)
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Performance', () => {
  it('batch faster than individual inserts', async () => {
    const dim = 128
    const count = 500

    // Measure individual inserts
    const index1 = createHNSWIndex({ dimensions: dim })
    const vectors = createVectorBatch(count, dim)

    const individualStart = performance.now()
    for (const v of vectors) {
      index1.insert(v.id, v.vector instanceof Float32Array ? v.vector : new Float32Array(v.vector))
    }
    const individualTime = performance.now() - individualStart

    // Measure batch insert
    const index2 = createHNSWIndex({ dimensions: dim })
    const inserter = new BatchInserter(index2, { chunkSize: 100 })

    const batchStart = performance.now()
    await inserter.insertBatch(vectors)
    const batchTime = performance.now() - batchStart

    // Both should have same number of vectors
    expect(index1.size()).toBe(count)
    expect(index2.size()).toBe(count)

    // Batch should be faster (or at least not significantly slower)
    // Allow some variance for small batches
    expect(batchTime).toBeLessThan(individualTime * 1.5)
  })

  it('batch respects memory limit', async () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const inserter = new BatchInserter(index, {
      maxMemoryMB: 10,
      chunkSize: 1000,
    })

    // Create large batch
    const vectors = createVectorBatch(5000, 128)

    const result = await inserter.insertBatch(vectors)

    // Should still complete successfully (chunking based on memory)
    expect(result.inserted).toBe(5000)
    expect(index.size()).toBe(5000)
  })

  it('streaming batch for large sets', async () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const inserter = new BatchInserter(index, { chunkSize: 100 })

    // Create async iterator for streaming
    async function* vectorStream(): AsyncGenerator<VectorInput> {
      for (let i = 0; i < 1000; i++) {
        yield {
          id: `stream-${i}`,
          vector: seededVector(128, i),
        }
      }
    }

    const result = await inserter.insertFromIterator(vectorStream())

    expect(result.inserted).toBe(1000)
    expect(result.chunks).toBe(10) // 1000 / 100
    expect(index.size()).toBe(1000)
  })
})

// ============================================================================
// METADATA TESTS
// ============================================================================

describe('Metadata', () => {
  let index: FilteredHNSWIndex

  beforeEach(() => {
    index = createFilteredIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('batch preserves vector metadata', async () => {
    const inserter = new BatchInserter(index)
    const vectors = createVectorBatchWithMetadata(100, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(100)

    // Verify metadata is stored
    const metadata = index.getMetadata('vec-42')
    expect(metadata).toBeDefined()
    expect(metadata!.category).toBe('cat-2') // 42 % 5 = 2
    expect(metadata!.score).toBe(0.42)
    expect(metadata!.tags).toContain('tag-0') // 42 % 3 = 0
  })

  it('batch validates metadata schema', async () => {
    // NOTE: This tests that metadataSchema option is supported
    // The inserter should validate metadata against a JSON schema
    const inserter = new BatchInserter(index, {
      metadataSchema: {
        type: 'object',
        required: ['category'],
        properties: {
          category: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      failFast: true,
    } as BatchInsertOptions)

    // Valid metadata
    const validBatch: VectorInput[] = [
      { id: 'v1', vector: randomVector(128), metadata: { category: 'test', score: 0.5 } },
    ]
    const validResult = await inserter.insertBatch(validBatch)
    expect(validResult.inserted).toBe(1)
    expect(validResult.metadataValidated).toBe(1) // Should report validation count

    // Invalid metadata (missing required field)
    const invalidBatch: VectorInput[] = [
      { id: 'v2', vector: randomVector(128), metadata: { score: 0.5 } }, // Missing category
    ]
    await expect(inserter.insertBatch(invalidBatch)).rejects.toThrow(/validation|schema|required/)
  })

  it('metadata indexed on insert', async () => {
    const inserter = new BatchInserter(index, { indexMetadata: true })
    const vectors = createVectorBatchWithMetadata(100, 128)

    await inserter.insertBatch(vectors)

    // Search with metadata filter should work efficiently
    const query = randomVector(128)
    const results = index.search(query, {
      k: 10,
      filter: { category: 'cat-2' },
    })

    expect(results.length).toBeGreaterThan(0)
    // All results should have category cat-2
    for (const r of results) {
      const meta = index.getMetadata(r.id)
      expect(meta!.category).toBe('cat-2')
    }
  })
})

// ============================================================================
// EDGE CASES TESTS
// ============================================================================

describe('Edge Cases', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('empty batch succeeds', async () => {
    const inserter = new BatchInserter(index)
    const vectors: VectorInput[] = []

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.chunks).toBe(0)
    expect(index.size()).toBe(0)
  })

  it('single item batch', async () => {
    const inserter = new BatchInserter(index)
    const vectors: VectorInput[] = [
      { id: 'single', vector: randomVector(128) },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.chunks).toBe(1)
    expect(index.has('single')).toBe(true)
  })

  it('duplicate IDs in batch', async () => {
    // NOTE: This tests that duplicate IDs WITHIN a single batch are detected
    // The inserter should pre-scan the batch and detect duplicate IDs before insertion
    const inserter = new BatchInserter(index, {
      detectDuplicates: true, // New option to detect duplicates within batch
      skipOnError: false,
      failFast: true,
    } as BatchInsertOptions)

    // Batch with duplicate IDs
    const vectors: VectorInput[] = [
      { id: 'dup-1', vector: randomVector(128) },
      { id: 'dup-2', vector: randomVector(128) },
      { id: 'dup-1', vector: randomVector(128) }, // Duplicate within batch
    ]

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/duplicate/)

    // Nothing should be inserted due to pre-validation
    expect(index.size()).toBe(0)
  })

  it('duplicate IDs in batch with skip mode', async () => {
    // When detectDuplicates is true but skipOnError is also true,
    // duplicates within the batch should be skipped (last one wins or first one wins)
    const inserter = new BatchInserter(index, {
      detectDuplicates: true,
      duplicateStrategy: 'first', // Keep first occurrence
      skipOnError: true,
    } as BatchInsertOptions)

    const firstVector = randomVector(128)
    const secondVector = randomVector(128)
    const vectors: VectorInput[] = [
      { id: 'dup-1', vector: firstVector },
      { id: 'dup-2', vector: randomVector(128) },
      { id: 'dup-1', vector: secondVector }, // Duplicate - should be skipped
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(2)
    expect(result.skipped).toBe(1)
    expect(index.size()).toBe(2)

    // Should have kept the first vector
    const stored = index.getVector('dup-1')!
    let similarity = 0
    for (let i = 0; i < 128; i++) {
      similarity += stored[i] * firstVector[i]
    }
    expect(similarity).toBeCloseTo(1, 5)
  })

  it('handles dimension mismatch in batch', async () => {
    const inserter = new BatchInserter(index, { skipOnError: true })

    const vectors: VectorInput[] = [
      { id: 'v1', vector: randomVector(128) }, // Valid
      { id: 'v2', vector: randomVector(64) },  // Invalid dimension
      { id: 'v3', vector: randomVector(128) }, // Valid
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toBeDefined()
    expect(result.errors!['v2']).toMatch(/dimension mismatch/)
  })

  it('handles invalid IDs in batch', async () => {
    const inserter = new BatchInserter(index, { skipOnError: true })

    const vectors: VectorInput[] = [
      { id: '', vector: randomVector(128) },      // Empty ID
      { id: 'valid', vector: randomVector(128) }, // Valid
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors![''] || result.errors!['unknown']).toBeDefined()
  })

  it('reports duration in result', async () => {
    const inserter = new BatchInserter(index)
    const vectors = createVectorBatch(100, 128)

    const result = await inserter.insertBatch(vectors)

    expect(result.durationMs).toBeDefined()
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('handles number[] vectors', async () => {
    const inserter = new BatchInserter(index)

    // Use number[] instead of Float32Array
    const vectors: VectorInput[] = [
      { id: 'num-1', vector: Array.from(randomVector(128)) },
      { id: 'num-2', vector: Array.from(randomVector(128)) },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(2)
    expect(index.has('num-1')).toBe(true)
    expect(index.has('num-2')).toBe(true)
  })

  it('sync iterator works', async () => {
    const inserter = new BatchInserter(index, { chunkSize: 50 })

    // Create sync iterator
    function* vectorIterator(): Generator<VectorInput> {
      for (let i = 0; i < 200; i++) {
        yield {
          id: `iter-${i}`,
          vector: seededVector(128, i),
        }
      }
    }

    const result = await inserter.insertFromIterator(vectorIterator())

    expect(result.inserted).toBe(200)
    expect(result.chunks).toBe(4) // 200 / 50 = 4
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('skipOnError continues on failure', async () => {
    const inserter = new BatchInserter(index, { skipOnError: true })

    const vectors: VectorInput[] = [
      { id: 'v1', vector: randomVector(128) },
      { id: 'v2', vector: randomVector(64) }, // Wrong dim
      { id: 'v3', vector: randomVector(128) },
      { id: 'v4', vector: randomVector(32) }, // Wrong dim
      { id: 'v5', vector: randomVector(128) },
    ]

    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(3)
    expect(result.failed).toBe(2)
    expect(result.errors).toBeDefined()
    expect(Object.keys(result.errors!)).toHaveLength(2)
  })

  it('failFast stops on first error', async () => {
    const inserter = new BatchInserter(index, {
      skipOnError: false,
      failFast: true,
    })

    const vectors: VectorInput[] = [
      { id: 'v1', vector: randomVector(128) },
      { id: 'v2', vector: randomVector(64) }, // Wrong dim - should stop here
      { id: 'v3', vector: randomVector(128) },
    ]

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/dimension mismatch/)

    // Only first vector should be inserted (before the error)
    expect(index.size()).toBe(1)
    expect(index.has('v1')).toBe(true)
    expect(index.has('v3')).toBe(false)
  })

  it('transactional mode validates all before insert', async () => {
    const inserter = new BatchInserter(index, { transactional: true })

    const vectors: VectorInput[] = [
      { id: 'v1', vector: randomVector(128) },
      { id: 'v2', vector: randomVector(128) },
      { id: 'v3', vector: randomVector(64) }, // Invalid - last one
    ]

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/Validation failed/)

    // Nothing should be inserted due to pre-validation
    expect(index.size()).toBe(0)
  })
})

// ============================================================================
// RETRY AND RESILIENCE TESTS
// ============================================================================

describe('Retry and Resilience', () => {
  let index: HNSWIndex

  beforeEach(() => {
    index = createHNSWIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  it('retries failed inserts', async () => {
    // NOTE: This tests that retry option is supported
    // The inserter should retry failed operations
    const inserter = new BatchInserter(index, {
      maxRetries: 3,
      retryDelayMs: 10,
    } as BatchInsertOptions)

    const vectors = createVectorBatch(10, 128)
    const result = await inserter.insertBatch(vectors)

    expect(result.inserted).toBe(10)
    expect(result.retriedCount).toBeDefined() // Should report retry stats
  })

  it('aborts batch on timeout', async () => {
    // NOTE: This tests that timeout option is supported
    const inserter = new BatchInserter(index, {
      timeoutMs: 1, // Very short timeout
    } as BatchInsertOptions)

    const vectors = createVectorBatch(1000, 128)

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/timeout/)
  })

  it('cancellation token stops batch', async () => {
    // NOTE: This tests that cancellation is supported
    const controller = new AbortController()
    const inserter = new BatchInserter(index, {
      signal: controller.signal,
      chunkSize: 10,
    } as BatchInsertOptions)

    const vectors = createVectorBatch(100, 128)

    // Cancel after a short delay
    setTimeout(() => controller.abort(), 5)

    await expect(inserter.insertBatch(vectors)).rejects.toThrow(/abort|cancel/)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  it('batch insert followed by search', async () => {
    const index = createHNSWIndex({ dimensions: 128 })
    const inserter = new BatchInserter(index, { chunkSize: 100 })

    // Insert vectors in categories
    const category1 = createVectorBatch(100, 128, 0)
    const category2 = createVectorBatch(100, 128, 1000)

    await inserter.insertBatch(category1)
    await inserter.insertBatch(category2)

    expect(index.size()).toBe(200)

    // Search should find nearest neighbors
    const query = seededVector(128, 50) // Should be near vec-50
    const results = index.search(query, { k: 5 })

    expect(results.length).toBe(5)
    expect(results[0].id).toBe('vec-50')
  })

  it('batch insert with filtered index', async () => {
    const index = createFilteredIndex({ dimensions: 128 })
    const inserter = new BatchInserter(index)

    const vectors = createVectorBatchWithMetadata(200, 128)
    await inserter.insertBatch(vectors)

    // Search with filter
    const query = randomVector(128)
    const results = index.search(query, {
      k: 10,
      filter: { category: 'cat-0' },
    })

    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      const meta = index.getMetadata(r.id)
      expect(meta!.category).toBe('cat-0')
    }
  })

  it('multiple batch inserters on same index', async () => {
    const index = createHNSWIndex({ dimensions: 128 })

    // Create multiple inserters
    const inserter1 = new BatchInserter(index, { chunkSize: 50 })
    const inserter2 = new BatchInserter(index, { chunkSize: 50 })

    // Insert different batches
    const batch1 = createVectorBatch(100, 128, 0)
    const batch2 = createVectorBatch(100, 128, 1000)

    // Sequential to avoid race conditions
    await inserter1.insertBatch(batch1)
    await inserter2.insertBatch(batch2)

    expect(index.size()).toBe(200)
  })
})
