/**
 * VectorShardDO Tests
 *
 * Unit tests for the VectorShardDO vector similarity search functionality.
 * Tests cover:
 * - Vector loading and storage
 * - Cosine similarity and L2 distance computations
 * - Top-K selection with min-heap
 * - Batch operations (insert, delete)
 * - HTTP API endpoints
 *
 * @module tests/vector/shard-do.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VectorShardDO } from '../../objects/VectorShardDO'
import {
  createMockId,
  createMockStorage,
  createMockState,
  createMockEnv,
  createMockR2,
  type MockDurableObjectState,
  type MockEnv,
} from '../harness/do'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock VectorShardDO for testing
 */
function createTestShard(options: {
  id?: string
  r2Data?: Map<string, ArrayBuffer>
} = {}) {
  const id = createMockId(options.id ?? 'test-shard')
  const storage = createMockStorage()
  const ctx = createMockState(id, storage)

  const r2 = createMockR2()

  // Override R2 to return ArrayBuffer
  if (options.r2Data) {
    for (const [key, buffer] of options.r2Data) {
      r2.data.set(key, buffer)
    }
  }

  // Create a more realistic R2 mock that returns ArrayBuffer
  const mockR2 = {
    ...r2,
    get: async (key: string) => {
      const data = r2.data.get(key) as ArrayBuffer | undefined
      if (!data) return null
      return {
        arrayBuffer: async () => data,
        body: data,
      }
    },
    put: async (key: string, value: ArrayBuffer | unknown) => {
      r2.data.set(key, value)
      r2.operations.push({ type: 'put', key })
    },
  }

  const env = createMockEnv({ R2: mockR2 as any }) as MockEnv

  const instance = new VectorShardDO(ctx as any, env as any)

  return { instance, ctx, env, storage, r2: mockR2 }
}

/**
 * Create a test vector buffer in the VEC1 format
 */
function createTestVectorBuffer(
  ids: string[],
  vectors: Float32Array,
  dimensions: number
): ArrayBuffer {
  const textEncoder = new TextEncoder()
  const encodedIds = ids.map(id => textEncoder.encode(id))

  // Calculate sizes
  let idsSize = 0
  for (const encoded of encodedIds) {
    idsSize += 2 + encoded.length
  }

  // Align to 4-byte boundary
  const HEADER_SIZE = 32
  const padding = (4 - ((HEADER_SIZE + idsSize) % 4)) % 4
  const vectorsSize = vectors.byteLength
  const totalSize = HEADER_SIZE + idsSize + padding + vectorsSize

  // Create buffer
  const buffer = new ArrayBuffer(totalSize)
  const dataView = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Write magic bytes "VEC1"
  uint8View.set([0x56, 0x45, 0x43, 0x31], 0)

  // Write header
  dataView.setUint32(4, 1, true) // version
  dataView.setUint32(8, ids.length, true) // count
  dataView.setUint32(12, dimensions, true) // dimensions

  // Write IDs
  let offset = HEADER_SIZE
  for (const encoded of encodedIds) {
    dataView.setUint16(offset, encoded.length, true)
    offset += 2
    uint8View.set(encoded, offset)
    offset += encoded.length
  }

  // Add padding
  offset += padding

  // Write vectors
  const vectorsView = new Float32Array(buffer, offset)
  vectorsView.set(vectors)

  return buffer
}

/**
 * Create a normalized unit vector
 */
function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)

  const result = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm
  }
  return result
}

// ============================================================================
// TESTS: BASIC FUNCTIONALITY
// ============================================================================

describe('VectorShardDO', () => {
  describe('Basic Operations', () => {
    it('starts unloaded', async () => {
      const { instance } = createTestShard()

      const stats = await instance.getStats()

      expect(stats.loaded).toBe(false)
      expect(stats.vectorCount).toBe(0)
      expect(stats.dimensions).toBe(0)
    })

    it('throws error when searching without loading', async () => {
      const { instance } = createTestShard()
      const query = new Float32Array([1, 0, 0])

      await expect(instance.search(query, 5)).rejects.toThrow(
        'Vectors not loaded'
      )
    })

    it('throws error when R2 binding not available', async () => {
      const id = createMockId('test-shard')
      const storage = createMockStorage()
      const ctx = createMockState(id, storage)
      const env = createMockEnv({ R2: undefined }) as MockEnv

      const instance = new VectorShardDO(ctx as any, env as any)

      await expect(instance.loadFromR2('vectors/test.vec')).rejects.toThrow(
        'R2 binding not available'
      )
    })
  })

  describe('Loading Vectors', () => {
    it('loads vectors from buffer', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2', 'vec3']
      const dimensions = 3
      const vectors = new Float32Array([
        1, 0, 0, // vec1
        0, 1, 0, // vec2
        0, 0, 1, // vec3
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const stats = await instance.getStats()
      expect(stats.loaded).toBe(true)
      expect(stats.vectorCount).toBe(3)
      expect(stats.dimensions).toBe(3)
    })

    it('loads vectors from R2', async () => {
      const ids = ['vec1', 'vec2']
      const dimensions = 4
      const vectors = new Float32Array([
        1, 2, 3, 4, // vec1
        5, 6, 7, 8, // vec2
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      const r2Data = new Map([['vectors/test.vec', buffer]])

      const { instance } = createTestShard({ r2Data })

      await instance.loadFromR2('vectors/test.vec')

      const stats = await instance.getStats()
      expect(stats.loaded).toBe(true)
      expect(stats.vectorCount).toBe(2)
      expect(stats.dimensions).toBe(4)
    })

    it('throws error for non-existent R2 file', async () => {
      const { instance } = createTestShard()

      await expect(instance.loadFromR2('nonexistent.vec')).rejects.toThrow(
        'Vector file not found'
      )
    })

    it('retrieves individual vectors by ID', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2']
      const dimensions = 3
      const vectors = new Float32Array([
        1, 2, 3, // vec1
        4, 5, 6, // vec2
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const vec1 = await instance.getVector('vec1')
      expect(vec1).toBeDefined()
      expect(Array.from(vec1!)).toEqual([1, 2, 3])

      const vec2 = await instance.getVector('vec2')
      expect(Array.from(vec2!)).toEqual([4, 5, 6])

      const notFound = await instance.getVector('nonexistent')
      expect(notFound).toBeNull()
    })

    it('checks vector existence', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2']
      const dimensions = 2
      const vectors = new Float32Array([1, 2, 3, 4])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      expect(await instance.hasVector('vec1')).toBe(true)
      expect(await instance.hasVector('vec2')).toBe(true)
      expect(await instance.hasVector('vec3')).toBe(false)
    })
  })

  describe('Cosine Similarity Search', () => {
    it('finds exact matches', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2', 'vec3']
      const dimensions = 3
      const vectors = new Float32Array([
        1, 0, 0, // vec1
        0, 1, 0, // vec2
        0, 0, 1, // vec3
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      // Search for vec1 direction
      const query = new Float32Array([1, 0, 0])
      const results = await instance.search(query, 3, 'cosine')

      expect(results[0].id).toBe('vec1')
      expect(results[0].score).toBeCloseTo(1.0) // Perfect match
    })

    it('returns results sorted by similarity', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2', 'vec3']
      const dimensions = 3
      // Create vectors at different angles
      const vectors = new Float32Array([
        1, 0, 0, // vec1: 0 degrees
        0.707, 0.707, 0, // vec2: 45 degrees
        0, 1, 0, // vec3: 90 degrees
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0, 0])
      const results = await instance.search(query, 3, 'cosine')

      // Should be sorted: vec1 (cos=1), vec2 (cos~0.707), vec3 (cos=0)
      expect(results[0].id).toBe('vec1')
      expect(results[0].score).toBeCloseTo(1.0)

      expect(results[1].id).toBe('vec2')
      expect(results[1].score).toBeCloseTo(0.707, 2)

      expect(results[2].id).toBe('vec3')
      expect(results[2].score).toBeCloseTo(0.0)
    })

    it('respects k parameter', async () => {
      const { instance } = createTestShard()

      const ids = ['v1', 'v2', 'v3', 'v4', 'v5']
      const dimensions = 2
      const vectors = new Float32Array([
        1, 0,
        0, 1,
        -1, 0,
        0, -1,
        0.5, 0.5,
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0])

      const results2 = await instance.search(query, 2, 'cosine')
      expect(results2).toHaveLength(2)

      const results5 = await instance.search(query, 5, 'cosine')
      expect(results5).toHaveLength(5)
    })

    it('throws error for dimension mismatch', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1']
      const dimensions = 3
      const vectors = new Float32Array([1, 2, 3])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const wrongDimQuery = new Float32Array([1, 2])

      await expect(instance.search(wrongDimQuery, 1, 'cosine')).rejects.toThrow(
        'Query dimension mismatch'
      )
    })
  })

  describe('L2 Distance Search', () => {
    it('finds exact matches', async () => {
      const { instance } = createTestShard()

      const ids = ['vec1', 'vec2', 'vec3']
      const dimensions = 3
      const vectors = new Float32Array([
        1, 0, 0, // vec1
        0, 1, 0, // vec2
        0, 0, 1, // vec3
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0, 0])
      const results = await instance.search(query, 3, 'l2')

      expect(results[0].id).toBe('vec1')
      expect(results[0].score).toBeCloseTo(0.0) // Zero distance = exact match
    })

    it('returns results sorted by distance (ascending)', async () => {
      const { instance } = createTestShard()

      const ids = ['near', 'medium', 'far']
      const dimensions = 2
      const vectors = new Float32Array([
        1, 0, // near: distance 0
        2, 0, // medium: distance 1
        5, 0, // far: distance 4
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0])
      const results = await instance.search(query, 3, 'l2')

      // Should be sorted by distance ascending
      expect(results[0].id).toBe('near')
      expect(results[0].score).toBeCloseTo(0)

      expect(results[1].id).toBe('medium')
      expect(results[1].score).toBeCloseTo(1)

      expect(results[2].id).toBe('far')
      expect(results[2].score).toBeCloseTo(4)
    })
  })

  describe('Extended Search', () => {
    it('returns search statistics', async () => {
      const { instance } = createTestShard()

      const ids = ['v1', 'v2', 'v3']
      const dimensions = 2
      const vectors = new Float32Array([1, 0, 0, 1, 1, 1])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0])
      const response = await instance.searchExtended({
        query,
        k: 2,
        metric: 'cosine',
      })

      expect(response.results).toHaveLength(2)
      expect(response.vectorsScanned).toBe(3)
      expect(response.searchTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('supports filtering', async () => {
      const { instance } = createTestShard()

      const ids = ['user:1', 'user:2', 'admin:1', 'admin:2']
      const dimensions = 2
      const vectors = new Float32Array([
        1, 0,
        0.9, 0.1,
        0.8, 0.2,
        0.7, 0.3,
      ])

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0])

      // Filter to only users
      const response = await instance.searchExtended({
        query,
        k: 10,
        metric: 'cosine',
        filter: (id) => id.startsWith('user:'),
      })

      expect(response.results).toHaveLength(2)
      expect(response.results.every(r => r.id.startsWith('user:'))).toBe(true)
      expect(response.vectorsScanned).toBe(2) // Only 2 vectors matched filter
    })
  })

  describe('Batch Operations', () => {
    describe('addVectors', () => {
      it('adds vectors to empty shard', async () => {
        const { instance } = createTestShard()

        const result = await instance.addVectors({
          ids: ['v1', 'v2'],
          vectors: new Float32Array([1, 0, 0, 0, 1, 0]),
          dimensions: 3,
        })

        expect(result.inserted).toBe(2)
        expect(result.failed).toHaveLength(0)

        const stats = await instance.getStats()
        expect(stats.vectorCount).toBe(2)
        expect(stats.dimensions).toBe(3)
      })

      it('adds vectors to existing shard', async () => {
        const { instance } = createTestShard()

        // Initial vectors
        const ids = ['v1']
        const dimensions = 2
        const vectors = new Float32Array([1, 0])
        const buffer = createTestVectorBuffer(ids, vectors, dimensions)
        await instance.loadFromBuffer(buffer)

        // Add more
        const result = await instance.addVectors({
          ids: ['v2', 'v3'],
          vectors: new Float32Array([0, 1, 1, 1]),
          dimensions: 2,
        })

        expect(result.inserted).toBe(2)
        expect(result.failed).toHaveLength(0)

        const stats = await instance.getStats()
        expect(stats.vectorCount).toBe(3)
      })

      it('rejects duplicates', async () => {
        const { instance } = createTestShard()

        // Initial vectors
        await instance.addVectors({
          ids: ['v1'],
          vectors: new Float32Array([1, 0]),
          dimensions: 2,
        })

        // Try to add duplicate
        const result = await instance.addVectors({
          ids: ['v1', 'v2'],
          vectors: new Float32Array([0, 1, 1, 1]),
          dimensions: 2,
        })

        expect(result.inserted).toBe(1)
        expect(result.failed).toContain('v1')
        expect(result.errors?.['v1']).toBe('Vector already exists')
      })

      it('rejects dimension mismatch', async () => {
        const { instance } = createTestShard()

        await instance.addVectors({
          ids: ['v1'],
          vectors: new Float32Array([1, 0]),
          dimensions: 2,
        })

        await expect(
          instance.addVectors({
            ids: ['v2'],
            vectors: new Float32Array([1, 0, 0]),
            dimensions: 3,
          })
        ).rejects.toThrow('Dimension mismatch')
      })
    })

    describe('deleteVectors', () => {
      it('deletes existing vectors', async () => {
        const { instance } = createTestShard()

        const ids = ['v1', 'v2', 'v3']
        const dimensions = 2
        const vectors = new Float32Array([1, 0, 0, 1, 1, 1])
        const buffer = createTestVectorBuffer(ids, vectors, dimensions)
        await instance.loadFromBuffer(buffer)

        const result = await instance.deleteVectors({ ids: ['v2'] })

        expect(result.deleted).toBe(1)
        expect(result.notFound).toHaveLength(0)

        const stats = await instance.getStats()
        expect(stats.vectorCount).toBe(2)

        expect(await instance.hasVector('v1')).toBe(true)
        expect(await instance.hasVector('v2')).toBe(false)
        expect(await instance.hasVector('v3')).toBe(true)
      })

      it('reports not found IDs', async () => {
        const { instance } = createTestShard()

        const ids = ['v1']
        const vectors = new Float32Array([1, 0])
        const buffer = createTestVectorBuffer(ids, vectors, 2)
        await instance.loadFromBuffer(buffer)

        const result = await instance.deleteVectors({
          ids: ['v1', 'nonexistent'],
        })

        expect(result.deleted).toBe(1)
        expect(result.notFound).toContain('nonexistent')
      })

      it('handles deletion from empty shard', async () => {
        const { instance } = createTestShard()

        const result = await instance.deleteVectors({ ids: ['v1'] })

        expect(result.deleted).toBe(0)
        expect(result.notFound).toContain('v1')
      })
    })

    describe('clear', () => {
      it('removes all vectors', async () => {
        const { instance } = createTestShard()

        const ids = ['v1', 'v2']
        const vectors = new Float32Array([1, 0, 0, 1])
        const buffer = createTestVectorBuffer(ids, vectors, 2)
        await instance.loadFromBuffer(buffer)

        await instance.clear()

        const stats = await instance.getStats()
        expect(stats.loaded).toBe(false)
        expect(stats.vectorCount).toBe(0)
        expect(stats.dimensions).toBe(0)
      })
    })
  })

  describe('HTTP API', () => {
    it('responds to /health', async () => {
      const { instance } = createTestShard()

      const response = await instance.fetch(
        new Request('https://test.com/health')
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ status: 'ok', loaded: false })
    })

    it('responds to /stats', async () => {
      const { instance } = createTestShard()

      const ids = ['v1']
      const vectors = new Float32Array([1, 2, 3])
      const buffer = createTestVectorBuffer(ids, vectors, 3)
      await instance.loadFromBuffer(buffer)

      const response = await instance.fetch(
        new Request('https://test.com/stats')
      )
      const stats = await response.json()

      expect(response.status).toBe(200)
      expect(stats.loaded).toBe(true)
      expect(stats.vectorCount).toBe(1)
      expect(stats.dimensions).toBe(3)
    })

    it('handles /search endpoint', async () => {
      const { instance } = createTestShard()

      const ids = ['v1', 'v2']
      const dimensions = 3
      const vectors = new Float32Array([1, 0, 0, 0, 1, 0])
      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const response = await instance.fetch(
        new Request('https://test.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: [1, 0, 0],
            k: 2,
            metric: 'cosine',
          }),
        })
      )

      expect(response.status).toBe(200)

      const data = (await response.json()) as { results: any[] }
      expect(data.results).toHaveLength(2)
      expect(data.results[0].id).toBe('v1')
    })

    it('handles /vectors POST for insertion', async () => {
      const { instance } = createTestShard()

      const response = await instance.fetch(
        new Request('https://test.com/vectors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: ['v1', 'v2'],
            vectors: [1, 0, 0, 0, 1, 0],
            dimensions: 3,
          }),
        })
      )

      expect(response.status).toBe(200)

      const data = (await response.json()) as { inserted: number }
      expect(data.inserted).toBe(2)
    })

    it('handles /vectors DELETE', async () => {
      const { instance } = createTestShard()

      const ids = ['v1', 'v2']
      const vectors = new Float32Array([1, 0, 0, 1])
      const buffer = createTestVectorBuffer(ids, vectors, 2)
      await instance.loadFromBuffer(buffer)

      const response = await instance.fetch(
        new Request('https://test.com/vectors', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ['v1'] }),
        })
      )

      expect(response.status).toBe(200)

      const data = (await response.json()) as { deleted: number }
      expect(data.deleted).toBe(1)
    })

    it('returns 404 for unknown paths', async () => {
      const { instance } = createTestShard()

      const response = await instance.fetch(
        new Request('https://test.com/unknown')
      )

      expect(response.status).toBe(404)
    })

    it('returns 405 for wrong methods', async () => {
      const { instance } = createTestShard()

      const response = await instance.fetch(
        new Request('https://test.com/search', { method: 'GET' })
      )

      expect(response.status).toBe(405)
    })

    it('returns error for invalid operations', async () => {
      const { instance } = createTestShard()

      const response = await instance.fetch(
        new Request('https://test.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: [1, 0], k: 5 }),
        })
      )

      expect(response.status).toBe(500)

      const data = (await response.json()) as { error: string }
      expect(data.error).toContain('Vectors not loaded')
    })
  })

  describe('Top-K Heap', () => {
    it('handles k larger than vector count', async () => {
      const { instance } = createTestShard()

      const ids = ['v1', 'v2']
      const vectors = new Float32Array([1, 0, 0, 1])
      const buffer = createTestVectorBuffer(ids, vectors, 2)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0])
      const results = await instance.search(query, 100, 'cosine')

      // Should return all vectors even if k > count
      expect(results).toHaveLength(2)
    })

    it('correctly selects top-K for large datasets', async () => {
      const { instance } = createTestShard()

      // Create 100 vectors
      const count = 100
      const dimensions = 3
      const ids = Array.from({ length: count }, (_, i) => `v${i}`)
      const vectors = new Float32Array(count * dimensions)

      for (let i = 0; i < count; i++) {
        // Create vectors with decreasing similarity to [1, 0, 0]
        // v0 is [1, 0, 0], v1 is [0.99, 0.01, 0], etc.
        vectors[i * dimensions] = 1 - i * 0.01
        vectors[i * dimensions + 1] = i * 0.01
        vectors[i * dimensions + 2] = 0
      }

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const query = new Float32Array([1, 0, 0])
      const results = await instance.search(query, 5, 'cosine')

      expect(results).toHaveLength(5)

      // Top 5 should be v0, v1, v2, v3, v4
      expect(results[0].id).toBe('v0')
      expect(results[1].id).toBe('v1')
      expect(results[2].id).toBe('v2')
      expect(results[3].id).toBe('v3')
      expect(results[4].id).toBe('v4')

      // Scores should be in descending order
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
      }
    })
  })

  describe('Memory Statistics', () => {
    it('calculates memory usage correctly', async () => {
      const { instance } = createTestShard()

      const ids = ['vector1', 'vector2', 'vector3']
      const dimensions = 4
      const vectors = new Float32Array(12) // 3 * 4 = 12 floats

      const buffer = createTestVectorBuffer(ids, vectors, dimensions)
      await instance.loadFromBuffer(buffer)

      const stats = await instance.getStats()

      // Memory should include vectors (12 * 4 = 48 bytes) + ids (variable)
      expect(stats.memoryBytes).toBeGreaterThan(0)
      expect(stats.memoryBytes).toBe(
        vectors.byteLength +
          ids.reduce((sum, id) => sum + id.length * 2, 0)
      )
    })
  })
})
