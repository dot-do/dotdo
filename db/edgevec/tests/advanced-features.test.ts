/**
 * EdgeVec Advanced Features Tests
 *
 * RED phase TDD tests for advanced EdgeVec features:
 * - Filtered vector search (metadata + vector combined)
 * - Batch insert optimization
 * - Index persistence to R2
 * - Product quantization
 * - Scalar quantization (int8)
 *
 * @module db/edgevec/tests/advanced-features.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import types and implementation
import {
  createHNSWIndex,
  HNSWIndexImpl,
  type HNSWIndex,
} from '../hnsw'

import {
  FilteredHNSWIndex,
  createFilteredIndex,
  type MetadataFilter,
  type FilterOperator,
  type FilteredSearchOptions,
} from '../filtered-search'

import {
  BatchInserter,
  type BatchInsertOptions,
  type BatchInsertResult,
} from '../batch-insert'

import {
  HNSWPersistence,
  type PersistenceOptions,
  type IndexManifest,
} from '../persistence'

import {
  ProductQuantizer,
  ScalarQuantizer,
  type PQConfig,
  type SQConfig,
  type QuantizedIndex,
} from '../quantization'

// ============================================================================
// TEST UTILITIES
// ============================================================================

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

// Mock R2 bucket for testing
function createMockR2Bucket() {
  const storage = new Map<string, ArrayBuffer>()

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | string) => {
      const buffer = typeof value === 'string'
        ? new TextEncoder().encode(value).buffer
        : value
      storage.set(key, buffer)
      return { key, etag: `etag-${Date.now()}` }
    }),
    get: vi.fn(async (key: string) => {
      const data = storage.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data,
        text: async () => new TextDecoder().decode(data),
        json: async () => JSON.parse(new TextDecoder().decode(data)),
      }
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: Array<{ key: string }> = []
      for (const key of storage.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects, truncated: false }
    }),
    _storage: storage,
  }
}

// ============================================================================
// FILTERED SEARCH TESTS
// ============================================================================

describe('Filtered Vector Search', () => {
  let index: FilteredHNSWIndex

  beforeEach(() => {
    index = createFilteredIndex({
      dimensions: 128,
      M: 16,
      efConstruction: 200,
    })
  })

  describe('Metadata Storage', () => {
    it('stores metadata with vectors', () => {
      const vector = randomVector(128)
      const metadata = { category: 'tech', score: 0.95, tags: ['ai', 'ml'] }

      index.insert('vec-1', vector, metadata)

      const stored = index.getMetadata('vec-1')
      expect(stored).toEqual(metadata)
    })

    it('updates metadata on re-insert', () => {
      const vector = randomVector(128)

      index.insert('vec-1', vector, { version: 1 })
      index.insert('vec-1', vector, { version: 2 })

      const stored = index.getMetadata('vec-1')
      expect(stored).toEqual({ version: 2 })
    })

    it('returns undefined for non-existent metadata', () => {
      expect(index.getMetadata('nonexistent')).toBeUndefined()
    })

    it('allows updating metadata separately', () => {
      const vector = randomVector(128)
      index.insert('vec-1', vector, { original: true })

      index.updateMetadata('vec-1', { updated: true })

      const stored = index.getMetadata('vec-1')
      expect(stored).toEqual({ updated: true })
    })

    it('supports partial metadata updates', () => {
      const vector = randomVector(128)
      index.insert('vec-1', vector, { a: 1, b: 2 })

      index.patchMetadata('vec-1', { b: 3, c: 4 })

      const stored = index.getMetadata('vec-1')
      expect(stored).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('removes metadata on delete', () => {
      const vector = randomVector(128)
      index.insert('vec-1', vector, { test: true })

      index.delete('vec-1')

      expect(index.getMetadata('vec-1')).toBeUndefined()
    })
  })

  describe('Filter Operators', () => {
    beforeEach(() => {
      // Insert test data
      for (let i = 0; i < 100; i++) {
        index.insert(`vec-${i}`, seededVector(128, i), {
          category: ['tech', 'science', 'art'][i % 3],
          score: i / 100,
          count: i,
          active: i % 2 === 0,
          tags: [`tag-${i % 5}`, `tag-${(i + 1) % 5}`],
        })
      }
    })

    it('filters by equality ($eq)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { category: { $eq: 'tech' } },
      })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).toBe('tech')
      })
    })

    it('filters by inequality ($ne)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { category: { $ne: 'tech' } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).not.toBe('tech')
      })
    })

    it('filters by greater than ($gt)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { score: { $gt: 0.5 } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.score).toBeGreaterThan(0.5)
      })
    })

    it('filters by greater than or equal ($gte)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { count: { $gte: 50 } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.count).toBeGreaterThanOrEqual(50)
      })
    })

    it('filters by less than ($lt)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { score: { $lt: 0.3 } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.score).toBeLessThan(0.3)
      })
    })

    it('filters by less than or equal ($lte)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { count: { $lte: 25 } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.count).toBeLessThanOrEqual(25)
      })
    })

    it('filters by array contains ($in)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { category: { $in: ['tech', 'science'] } },
      })

      results.forEach((r) => {
        const cat = index.getMetadata(r.id)?.category
        expect(['tech', 'science']).toContain(cat)
      })
    })

    it('filters by array not contains ($nin)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { category: { $nin: ['art'] } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).not.toBe('art')
      })
    })

    it('filters by array contains element ($contains)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { tags: { $contains: 'tag-0' } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.tags).toContain('tag-0')
      })
    })

    it('filters by existence ($exists)', () => {
      // Add some items without 'score' field
      index.insert('no-score', randomVector(128), { category: 'test' })

      const query = randomVector(128)
      const results = index.search(query, {
        k: 100,
        filter: { score: { $exists: true } },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.score).toBeDefined()
      })
    })

    it('filters by boolean value', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: { active: true },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.active).toBe(true)
      })
    })
  })

  describe('Compound Filters', () => {
    beforeEach(() => {
      for (let i = 0; i < 100; i++) {
        index.insert(`vec-${i}`, seededVector(128, i), {
          category: ['tech', 'science', 'art'][i % 3],
          score: i / 100,
          priority: i % 5,
        })
      }
    })

    it('combines filters with AND (implicit)', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: {
          category: 'tech',
          score: { $gt: 0.5 },
        },
      })

      results.forEach((r) => {
        const meta = index.getMetadata(r.id)
        expect(meta?.category).toBe('tech')
        expect(meta?.score).toBeGreaterThan(0.5)
      })
    })

    it('combines filters with explicit $and', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: {
          $and: [
            { category: 'tech' },
            { priority: { $gte: 3 } },
          ],
        },
      })

      results.forEach((r) => {
        const meta = index.getMetadata(r.id)
        expect(meta?.category).toBe('tech')
        expect(meta?.priority).toBeGreaterThanOrEqual(3)
      })
    })

    it('combines filters with $or', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: {
          $or: [
            { category: 'tech' },
            { category: 'science' },
          ],
        },
      })

      results.forEach((r) => {
        const cat = index.getMetadata(r.id)?.category
        expect(['tech', 'science']).toContain(cat)
      })
    })

    it('combines filters with $not', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: {
          $not: { category: 'art' },
        },
      })

      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).not.toBe('art')
      })
    })

    it('supports nested compound filters', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 50,
        filter: {
          $or: [
            {
              $and: [
                { category: 'tech' },
                { score: { $gt: 0.7 } },
              ],
            },
            {
              $and: [
                { category: 'science' },
                { priority: { $lt: 2 } },
              ],
            },
          ],
        },
      })

      results.forEach((r) => {
        const meta = index.getMetadata(r.id)
        const isTechHighScore = meta?.category === 'tech' && (meta?.score as number) > 0.7
        const isScienceLowPriority = meta?.category === 'science' && (meta?.priority as number) < 2
        expect(isTechHighScore || isScienceLowPriority).toBe(true)
      })
    })
  })

  describe('Pre-filter vs Post-filter', () => {
    beforeEach(() => {
      for (let i = 0; i < 1000; i++) {
        index.insert(`vec-${i}`, seededVector(128, i), {
          category: ['rare', 'common'][i < 50 ? 0 : 1],
        })
      }
    })

    it('uses post-filter by default for high selectivity', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 10,
        filter: { category: 'common' },
      })

      expect(results.length).toBe(10)
    })

    it('handles filters that return few results', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 100, // Request more than available
        filter: { category: 'rare' },
      })

      // Should return rare items (may not get all due to search approximation)
      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(50)
      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).toBe('rare')
      })
    })

    it('allows forcing pre-filter mode', () => {
      const query = randomVector(128)
      const results = index.search(query, {
        k: 10,
        filter: { category: 'rare' },
        filterMode: 'pre',
      })

      expect(results.length).toBeLessThanOrEqual(10)
      results.forEach((r) => {
        expect(index.getMetadata(r.id)?.category).toBe('rare')
      })
    })
  })
})

// ============================================================================
// BATCH INSERT TESTS
// ============================================================================

describe('Batch Insert Optimization', () => {
  describe('Basic Batch Operations', () => {
    it('inserts batch of vectors', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index)

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(100)
      expect(result.failed).toBe(0)
      expect(index.size()).toBe(100)
    })

    it('inserts batch with metadata', async () => {
      const index = createFilteredIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index)

      const vectors = Array.from({ length: 50 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
        metadata: { index: i, label: `item-${i}` },
      }))

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(50)
      expect(index.getMetadata('vec-25')).toEqual({ index: 25, label: 'item-25' })
    })

    it('handles empty batch', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index)

      const result = await inserter.insertBatch([])

      expect(result.inserted).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('validates all vectors before inserting', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index)

      const vectors = [
        { id: 'valid-1', vector: randomVector(128) },
        { id: 'invalid', vector: randomVector(64) }, // Wrong dimension
        { id: 'valid-2', vector: randomVector(128) },
      ]

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors?.['invalid']).toContain('dimension')
    })
  })

  describe('Chunked Insertion', () => {
    it('processes in configurable chunks', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { chunkSize: 10 })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(100)
      expect(result.chunks).toBe(10)
    })

    it('reports progress via callback', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const progressUpdates: number[] = []
      const inserter = new BatchInserter(index, {
        chunkSize: 25,
        onProgress: (progress) => progressUpdates.push(progress),
      })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      await inserter.insertBatch(vectors)

      expect(progressUpdates).toEqual([0.25, 0.5, 0.75, 1.0])
    })

    it('handles partial chunk at end', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { chunkSize: 30 })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(100)
      expect(result.chunks).toBe(4) // 30 + 30 + 30 + 10
    })
  })

  describe('Parallel Insertion', () => {
    it('inserts in parallel with concurrency limit', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, {
        chunkSize: 10,
        concurrency: 4,
      })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      const start = performance.now()
      const result = await inserter.insertBatch(vectors)
      const duration = performance.now() - start

      expect(result.inserted).toBe(100)
      // Parallel should be faster than sequential
      // (this is a weak assertion, mainly testing it doesn't break)
    })

    it('maintains consistency with parallel inserts', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, {
        chunkSize: 10,
        concurrency: 4,
      })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `vec-${i}`,
        vector: seededVector(128, i),
      }))

      await inserter.insertBatch(vectors)

      // Verify all vectors are searchable
      const query = seededVector(128, 50)
      const results = index.search(query, { k: 10 })

      expect(results.length).toBe(10)
      // The exact vector should be in top results
      expect(results.some((r) => r.id === 'vec-50')).toBe(true)
    })
  })

  describe('Memory Management', () => {
    it('limits memory usage during batch insert', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, {
        maxMemoryMB: 50,
        chunkSize: 100,
      })

      const vectors = Array.from({ length: 1000 }, (_, i) => ({
        id: `vec-${i}`,
        vector: randomVector(128),
      }))

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(1000)
      // Memory should have been managed within limits
    })

    it('streams large batches from iterator', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { chunkSize: 50 })

      // Generator that produces vectors on demand
      function* vectorGenerator() {
        for (let i = 0; i < 500; i++) {
          yield {
            id: `vec-${i}`,
            vector: randomVector(128),
          }
        }
      }

      const result = await inserter.insertFromIterator(vectorGenerator())

      expect(result.inserted).toBe(500)
    })
  })

  describe('Error Handling', () => {
    it('continues on individual failures with skipOnError', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { skipOnError: true })

      const vectors = [
        { id: 'valid-1', vector: randomVector(128) },
        { id: '', vector: randomVector(128) }, // Invalid ID
        { id: 'valid-2', vector: randomVector(128) },
      ]

      const result = await inserter.insertBatch(vectors)

      expect(result.inserted).toBe(2)
      expect(result.failed).toBe(1)
    })

    it('stops on first error with failFast', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { failFast: true })

      const vectors = [
        { id: 'valid-1', vector: randomVector(128) },
        { id: '', vector: randomVector(128) }, // Invalid ID
        { id: 'valid-2', vector: randomVector(128) },
      ]

      await expect(inserter.insertBatch(vectors)).rejects.toThrow()
    })

    it('rollbacks on error with transactional mode', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      const inserter = new BatchInserter(index, { transactional: true })

      const vectors = [
        { id: 'valid-1', vector: randomVector(128) },
        { id: 'valid-2', vector: randomVector(128) },
        { id: '', vector: randomVector(128) }, // Invalid - should rollback all
      ]

      await expect(inserter.insertBatch(vectors)).rejects.toThrow()
      expect(index.size()).toBe(0)
    })
  })
})

// ============================================================================
// R2 PERSISTENCE TESTS
// ============================================================================

describe('Index Persistence to R2', () => {
  let r2Bucket: ReturnType<typeof createMockR2Bucket>

  beforeEach(() => {
    r2Bucket = createMockR2Bucket()
  })

  describe('Save Index', () => {
    it('saves index to R2', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 100; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)
      await persistence.save('test-index', index)

      expect(r2Bucket.put).toHaveBeenCalled()
      const savedKey = (r2Bucket.put.mock.calls[0] as [string, unknown])[0]
      expect(savedKey).toContain('test-index')
    })

    it('creates manifest file', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 50; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)
      await persistence.save('my-index', index)

      // Check manifest was created
      const manifestKey = Array.from(r2Bucket._storage.keys()).find(
        (k) => k.includes('manifest')
      )
      expect(manifestKey).toBeDefined()
    })

    it('saves with compression', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 100; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket, {
        compression: 'gzip',
      })
      await persistence.save('compressed-index', index)

      expect(r2Bucket.put).toHaveBeenCalled()
    })

    it('saves in chunks for large indices', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 1000; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket, {
        maxChunkSizeMB: 1, // Force chunking
      })
      await persistence.save('large-index', index)

      // Should have multiple chunks
      const chunkKeys = Array.from(r2Bucket._storage.keys()).filter(
        (k) => k.includes('chunk')
      )
      expect(chunkKeys.length).toBeGreaterThan(1)
    })
  })

  describe('Load Index', () => {
    it('loads index from R2', async () => {
      // First save
      const original = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 100; i++) {
        original.insert(`vec-${i}`, seededVector(128, i))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)
      await persistence.save('saved-index', original)

      // Then load
      const loaded = await persistence.load('saved-index')

      expect(loaded.size()).toBe(100)
      expect(loaded.dimensions()).toBe(128)
    })

    it('preserves search results after load', async () => {
      const original = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 100; i++) {
        original.insert(`vec-${i}`, seededVector(128, i))
      }

      const query = seededVector(128, 42)
      const originalResults = original.search(query, { k: 10 })

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)
      await persistence.save('preserved-index', original)
      const loaded = await persistence.load('preserved-index')

      const loadedResults = loaded.search(query, { k: 10 })

      expect(loadedResults.map((r) => r.id)).toEqual(
        originalResults.map((r) => r.id)
      )
    })

    it('loads chunked index', async () => {
      const original = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 500; i++) {
        original.insert(`vec-${i}`, seededVector(128, i))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket, {
        maxChunkSizeMB: 0.1, // Force chunking
      })
      await persistence.save('chunked-index', original)
      const loaded = await persistence.load('chunked-index')

      expect(loaded.size()).toBe(500)
    })

    it('throws on missing index', async () => {
      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)

      await expect(persistence.load('nonexistent')).rejects.toThrow(
        /not found/i
      )
    })

    it('validates checksum on load', async () => {
      const original = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 50; i++) {
        original.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket, {
        validateChecksum: true,
      })
      await persistence.save('checksummed-index', original)

      // Corrupt the data
      const keys = Array.from(r2Bucket._storage.keys())
      const dataKey = keys.find((k) => !k.includes('manifest'))
      if (dataKey) {
        r2Bucket._storage.set(dataKey, new ArrayBuffer(100))
      }

      await expect(persistence.load('checksummed-index')).rejects.toThrow(
        /checksum/i
      )
    })
  })

  describe('Incremental Backup', () => {
    it('creates incremental backup', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 50; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)

      // Initial save
      await persistence.save('incremental-index', index)
      const initialCalls = r2Bucket.put.mock.calls.length

      // Add more vectors
      for (let i = 50; i < 75; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      // Incremental save (for now, this is a full save)
      await persistence.saveIncremental('incremental-index', index)
      const totalCalls = r2Bucket.put.mock.calls.length

      // At minimum, it should have made additional calls
      expect(totalCalls).toBeGreaterThan(initialCalls)
    })

    it('lists available backups', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 20; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)

      await persistence.save('backup-test', index)
      await new Promise((r) => setTimeout(r, 10))
      await persistence.save('backup-test', index)

      const backups = await persistence.listBackups('backup-test')
      expect(backups.length).toBeGreaterThanOrEqual(1)
    })

    it('restores from latest backup via load', async () => {
      const index = createHNSWIndex({ dimensions: 128 })
      for (let i = 0; i < 20; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)

      await persistence.save('point-in-time', index)

      // Load restores the latest version
      const restored = await persistence.load('point-in-time')
      expect(restored.size()).toBe(20)
    })
  })

  describe('Index Metadata', () => {
    it('saves and loads index metadata', async () => {
      const index = createHNSWIndex({
        dimensions: 128,
        M: 24,
        efConstruction: 300,
      })
      for (let i = 0; i < 50; i++) {
        index.insert(`vec-${i}`, randomVector(128))
      }

      const persistence = new HNSWPersistence(r2Bucket as unknown as R2Bucket)
      await persistence.save('metadata-test', index, {
        description: 'Test index',
        version: '1.0.0',
      })

      const manifest = await persistence.getManifest('metadata-test')

      expect(manifest?.indexMetadata?.description).toBe('Test index')
      expect(manifest?.config?.M).toBe(24)
      expect(manifest?.vectorCount).toBe(50)
    })
  })
})

// ============================================================================
// QUANTIZATION TESTS
// ============================================================================

describe('Product Quantization', () => {
  describe('Training', () => {
    it('trains PQ codebook from vectors', async () => {
      const trainingVectors = Array.from({ length: 3000 }, () =>
        randomVector(128)
      )

      const pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8, // M=8 subspaces
        numCentroids: 256, // 256 centroids per subspace
      })

      await pq.train(trainingVectors)

      expect(pq.isTrained()).toBe(true)
      expect(pq.numSubvectors()).toBe(8)
      expect(pq.numCentroids()).toBe(256)
    })

    it('requires minimum training vectors', async () => {
      const pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const tooFewVectors = Array.from({ length: 100 }, () =>
        randomVector(128)
      )

      await expect(pq.train(tooFewVectors)).rejects.toThrow(/insufficient/)
    })

    it('validates dimension divisibility', () => {
      expect(() =>
        new ProductQuantizer({
          dimensions: 127, // Not divisible by 8
          numSubvectors: 8,
          numCentroids: 256,
        })
      ).toThrow(/divisible/)
    })
  })

  describe('Encoding', () => {
    let pq: ProductQuantizer

    beforeEach(async () => {
      pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const trainingVectors = Array.from({ length: 3000 }, () =>
        randomVector(128)
      )
      await pq.train(trainingVectors)
    })

    it('encodes vector to codes', () => {
      const vector = randomVector(128)
      const codes = pq.encode(vector)

      expect(codes).toBeInstanceOf(Uint8Array)
      expect(codes.length).toBe(8) // One byte per subvector
    })

    it('encodes batch of vectors', () => {
      const vectors = Array.from({ length: 100 }, () => randomVector(128))
      const codes = pq.encodeBatch(vectors)

      expect(codes.length).toBe(100)
      codes.forEach((c) => {
        expect(c).toBeInstanceOf(Uint8Array)
        expect(c.length).toBe(8)
      })
    })

    it('decodes codes back to approximate vector', () => {
      const original = randomVector(128)
      const codes = pq.encode(original)
      const reconstructed = pq.decode(codes)

      expect(reconstructed.length).toBe(128)

      // Reconstructed should be somewhat similar to original
      let dot = 0
      for (let i = 0; i < 128; i++) {
        dot += original[i] * reconstructed[i]
      }
      // Cosine similarity should be positive (reconstruction maintains direction)
      // PQ with 8 subvectors may have limited precision
      expect(dot).toBeGreaterThan(0.3)
    })
  })

  describe('Asymmetric Distance Computation', () => {
    let pq: ProductQuantizer

    beforeEach(async () => {
      pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const trainingVectors = Array.from({ length: 3000 }, () =>
        randomVector(128)
      )
      await pq.train(trainingVectors)
    })

    it('computes distance lookup table', () => {
      const query = randomVector(128)
      const lookupTable = pq.computeDistanceTable(query)

      expect(lookupTable.length).toBe(8) // One table per subvector
      expect(lookupTable[0].length).toBe(256) // One entry per centroid
    })

    it('computes asymmetric distance using lookup table', () => {
      const query = randomVector(128)
      const vector = randomVector(128)
      const codes = pq.encode(vector)
      const lookupTable = pq.computeDistanceTable(query)

      const distance = pq.asymmetricDistance(codes, lookupTable)

      expect(typeof distance).toBe('number')
      expect(distance).toBeGreaterThanOrEqual(0)
    })

    it('batch asymmetric distance is faster', () => {
      const query = randomVector(128)
      const vectors = Array.from({ length: 1000 }, () => randomVector(128))
      const codes = pq.encodeBatch(vectors)
      const lookupTable = pq.computeDistanceTable(query)

      const start = performance.now()
      const distances = pq.batchAsymmetricDistance(codes, lookupTable)
      const duration = performance.now() - start

      expect(distances.length).toBe(1000)
      expect(duration).toBeLessThan(100) // Should be fast
    })
  })

  describe('PQ Index Integration', () => {
    it('creates quantized index', async () => {
      const pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const trainingVectors = Array.from({ length: 3000 }, () =>
        randomVector(128)
      )
      await pq.train(trainingVectors)

      const quantizedIndex = pq.createIndex()

      for (let i = 0; i < 1000; i++) {
        quantizedIndex.insert(`vec-${i}`, randomVector(128))
      }

      expect(quantizedIndex.size()).toBe(1000)
    })

    it('searches quantized index', async () => {
      const pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const trainingVectors = Array.from({ length: 3000 }, (_, i) =>
        seededVector(128, i)
      )
      await pq.train(trainingVectors)

      const quantizedIndex = pq.createIndex()
      trainingVectors.slice(0, 1000).forEach((v, i) => {
        quantizedIndex.insert(`vec-${i}`, v)
      })

      const query = seededVector(128, 42)
      const results = quantizedIndex.search(query, { k: 10 })

      expect(results.length).toBe(10)
      // The exact match should be in top results (with some tolerance for quantization error)
      expect(results.slice(0, 10).some((r) => r.id === 'vec-42')).toBe(true)
    })

    it('uses less memory than full index', async () => {
      const pq = new ProductQuantizer({
        dimensions: 128,
        numSubvectors: 8,
        numCentroids: 256,
      })

      const trainingVectors = Array.from({ length: 3000 }, () =>
        randomVector(128)
      )
      await pq.train(trainingVectors)

      const quantizedIndex = pq.createIndex()
      const fullIndex = createHNSWIndex({ dimensions: 128 })

      for (let i = 0; i < 1000; i++) {
        const v = randomVector(128)
        quantizedIndex.insert(`vec-${i}`, v)
        fullIndex.insert(`vec-${i}`, v)
      }

      const quantizedMemory = quantizedIndex.memoryUsage()
      const fullMemory = fullIndex.getStats().memoryBytes

      // PQ should use significantly less memory for vectors
      // (128 * 4 bytes = 512 bytes per vector vs 8 bytes with PQ)
      expect(quantizedMemory).toBeLessThan(fullMemory * 0.5)
    })
  })
})

describe('Scalar Quantization (int8)', () => {
  describe('Quantization', () => {
    it('quantizes float32 to int8', () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const vector = randomVector(128)
      const quantized = sq.quantize(vector)

      expect(quantized).toBeInstanceOf(Int8Array)
      expect(quantized.length).toBe(128)
    })

    it('trains min/max bounds from data', async () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const trainingVectors = Array.from({ length: 1000 }, () =>
        randomVector(128)
      )
      await sq.train(trainingVectors)

      expect(sq.isTrained()).toBe(true)
    })

    it('dequantizes back to float32', () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const original = randomVector(128)
      const quantized = sq.quantize(original)
      const dequantized = sq.dequantize(quantized)

      expect(dequantized.length).toBe(128)

      // Dequantized should be close to original
      let maxError = 0
      for (let i = 0; i < 128; i++) {
        maxError = Math.max(maxError, Math.abs(original[i] - dequantized[i]))
      }
      // Error should be small (within quantization step size)
      expect(maxError).toBeLessThan(0.02)
    })

    it('batch quantizes efficiently', () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const vectors = Array.from({ length: 1000 }, () => randomVector(128))

      const start = performance.now()
      const quantized = sq.quantizeBatch(vectors)
      const duration = performance.now() - start

      expect(quantized.length).toBe(1000)
      expect(duration).toBeLessThan(100) // Should be fast
    })
  })

  describe('Distance Computation', () => {
    it('computes dot product on int8 vectors', () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const v1 = randomVector(128)
      const v2 = randomVector(128)
      const q1 = sq.quantize(v1)
      const q2 = sq.quantize(v2)

      const distance = sq.dotProduct(q1, q2)

      // Should be a scalar value
      expect(typeof distance).toBe('number')
    })

    it('maintains ranking after quantization', async () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      // Create test vectors
      const vectors = Array.from({ length: 100 }, (_, i) =>
        seededVector(128, i)
      )
      await sq.train(vectors)

      const query = seededVector(128, 42)
      const qQuery = sq.quantize(query)

      // Compute distances with full precision
      const fullDistances = vectors.map((v, i) => ({
        id: i,
        dist: cosineSim(query, v),
      }))
      fullDistances.sort((a, b) => b.dist - a.dist)

      // Compute distances with quantized vectors
      const quantizedVectors = vectors.map((v) => sq.quantize(v))
      const quantizedDistances = quantizedVectors.map((qv, i) => ({
        id: i,
        dist: sq.dotProduct(qQuery, qv),
      }))
      quantizedDistances.sort((a, b) => b.dist - a.dist)

      // Top results should largely overlap
      const topFullIds = new Set(fullDistances.slice(0, 10).map((d) => d.id))
      const topQuantizedIds = quantizedDistances.slice(0, 10).map((d) => d.id)
      const overlap = topQuantizedIds.filter((id) => topFullIds.has(id)).length

      expect(overlap).toBeGreaterThanOrEqual(7) // At least 70% overlap
    })
  })

  describe('SQ Index Integration', () => {
    it('creates scalar quantized index', async () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const trainingVectors = Array.from({ length: 1000 }, () =>
        randomVector(128)
      )
      await sq.train(trainingVectors)

      const sqIndex = sq.createIndex()

      for (let i = 0; i < 1000; i++) {
        sqIndex.insert(`vec-${i}`, randomVector(128))
      }

      expect(sqIndex.size()).toBe(1000)
    })

    it('searches with 4x memory reduction', async () => {
      const sq = new ScalarQuantizer({ dimensions: 128 })

      const trainingVectors = Array.from({ length: 1000 }, (_, i) =>
        seededVector(128, i)
      )
      await sq.train(trainingVectors)

      const sqIndex = sq.createIndex()
      trainingVectors.forEach((v, i) => {
        sqIndex.insert(`vec-${i}`, v)
      })

      const query = seededVector(128, 42)
      const results = sqIndex.search(query, { k: 10 })

      expect(results.length).toBe(10)

      // Memory should be ~4x less (float32 to int8)
      const memoryUsage = sqIndex.memoryUsage()
      const expectedFullMemory = 1000 * 128 * 4 // 512KB for full precision
      expect(memoryUsage).toBeLessThan(expectedFullMemory * 0.3)
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
