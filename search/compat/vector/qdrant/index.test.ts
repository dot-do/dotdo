/**
 * @dotdo/qdrant - Qdrant-compatible vector search SDK
 *
 * Tests for Qdrant API compatibility backed by DO SQLite:
 * - QdrantClient - Client initialization
 * - Collections - Create, delete, list, get collections
 * - Points - Upsert, search, retrieve, delete, scroll, count
 * - Filters - Must, should, must_not, field conditions
 * - Distance metrics - Cosine, Euclidean, Dot product
 *
 * @see https://qdrant.tech/documentation/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { QdrantClient } from './qdrant'
import type { Filter, ScoredPoint } from './types'

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * Generate a random vector of given dimension
 */
function randomVector(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1)
}

/**
 * Generate a normalized random vector
 */
function normalizedVector(dim: number): number[] {
  const vec = randomVector(dim)
  const magnitude = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0))
  return vec.map((x) => x / magnitude)
}

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('QdrantClient', () => {
  it('should create client with default config', () => {
    const client = new QdrantClient()
    expect(client).toBeDefined()
  })

  it('should create client with custom config', () => {
    const client = new QdrantClient({
      url: 'http://custom:6333',
      apiKey: 'test-key',
    })
    expect(client).toBeDefined()
  })

  it('should create client with host/port config', () => {
    const client = new QdrantClient({
      host: 'localhost',
      port: 6334,
      https: true,
    })
    expect(client).toBeDefined()
  })
})

// ============================================================================
// COLLECTION TESTS
// ============================================================================

describe('Collections', () => {
  let client: QdrantClient

  beforeEach(() => {
    client = new QdrantClient()
  })

  describe('createCollection', () => {
    it('should create a collection with vector params', async () => {
      const result = await client.createCollection('test', {
        vectors: {
          size: 128,
          distance: 'Cosine',
        },
      })

      expect(result.status).toBe('completed')
    })

    it('should create collection with named vectors', async () => {
      const result = await client.createCollection('multi-vector', {
        vectors: {
          title: { size: 64, distance: 'Cosine' },
          content: { size: 256, distance: 'Dot' },
        },
      })

      expect(result.status).toBe('completed')
    })

    it('should create collection with HNSW config', async () => {
      const result = await client.createCollection('hnsw-test', {
        vectors: {
          size: 128,
          distance: 'Cosine',
          hnsw_config: {
            m: 16,
            ef_construct: 100,
          },
        },
      })

      expect(result.status).toBe('completed')
    })

    it('should throw on duplicate collection name', async () => {
      await client.createCollection('duplicate', {
        vectors: { size: 64, distance: 'Cosine' },
      })

      await expect(
        client.createCollection('duplicate', {
          vectors: { size: 64, distance: 'Cosine' },
        })
      ).rejects.toThrow('already exists')
    })
  })

  describe('deleteCollection', () => {
    it('should delete an existing collection', async () => {
      await client.createCollection('to-delete', {
        vectors: { size: 64, distance: 'Cosine' },
      })

      const result = await client.deleteCollection('to-delete')
      expect(result.status).toBe('completed')

      const exists = await client.collectionExists('to-delete')
      expect(exists).toBe(false)
    })

    it('should throw on non-existent collection', async () => {
      await expect(client.deleteCollection('non-existent')).rejects.toThrow('not found')
    })
  })

  describe('getCollections', () => {
    it('should return empty list initially', async () => {
      const response = await client.getCollections()
      expect(response.collections).toEqual([])
    })

    it('should return all created collections', async () => {
      await client.createCollection('col1', { vectors: { size: 64, distance: 'Cosine' } })
      await client.createCollection('col2', { vectors: { size: 128, distance: 'Euclid' } })

      const response = await client.getCollections()
      expect(response.collections).toHaveLength(2)
      expect(response.collections.map((c) => c.name).sort()).toEqual(['col1', 'col2'])
    })
  })

  describe('getCollection', () => {
    it('should return collection info', async () => {
      await client.createCollection('info-test', {
        vectors: { size: 256, distance: 'Dot' },
      })

      const info = await client.getCollection('info-test')

      expect(info.status).toBe('green')
      expect(info.vectors_count).toBe(0)
      expect(info.points_count).toBe(0)
    })

    it('should throw on non-existent collection', async () => {
      await expect(client.getCollection('non-existent')).rejects.toThrow('not found')
    })
  })

  describe('collectionExists', () => {
    it('should return true for existing collection', async () => {
      await client.createCollection('exists', { vectors: { size: 64, distance: 'Cosine' } })

      const exists = await client.collectionExists('exists')
      expect(exists).toBe(true)
    })

    it('should return false for non-existing collection', async () => {
      const exists = await client.collectionExists('not-exists')
      expect(exists).toBe(false)
    })
  })
})

// ============================================================================
// POINT UPSERT TESTS
// ============================================================================

describe('Points - Upsert', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })
  })

  it('should upsert a single point', async () => {
    const result = await client.upsert('test', {
      points: [
        {
          id: 1,
          vector: [0.1, 0.2, 0.3, 0.4],
          payload: { name: 'point1' },
        },
      ],
    })

    expect(result.status).toBe('completed')

    const info = await client.getCollection('test')
    expect(info.points_count).toBe(1)
  })

  it('should upsert multiple points', async () => {
    const result = await client.upsert('test', {
      points: [
        { id: 1, vector: [0.1, 0.2, 0.3, 0.4], payload: { name: 'p1' } },
        { id: 2, vector: [0.2, 0.3, 0.4, 0.5], payload: { name: 'p2' } },
        { id: 3, vector: [0.3, 0.4, 0.5, 0.6], payload: { name: 'p3' } },
      ],
    })

    expect(result.status).toBe('completed')

    const info = await client.getCollection('test')
    expect(info.points_count).toBe(3)
  })

  it('should upsert with string IDs', async () => {
    const result = await client.upsert('test', {
      points: [
        { id: 'uuid-1', vector: [0.1, 0.2, 0.3, 0.4], payload: {} },
        { id: 'uuid-2', vector: [0.2, 0.3, 0.4, 0.5], payload: {} },
      ],
    })

    expect(result.status).toBe('completed')
  })

  it('should update existing point on upsert', async () => {
    await client.upsert('test', {
      points: [{ id: 1, vector: [0.1, 0.2, 0.3, 0.4], payload: { version: 1 } }],
    })

    await client.upsert('test', {
      points: [{ id: 1, vector: [0.5, 0.6, 0.7, 0.8], payload: { version: 2 } }],
    })

    const records = await client.retrieve('test', { ids: [1], with_payload: true })
    expect(records[0].payload?.version).toBe(2)
  })

  it('should throw on dimension mismatch', async () => {
    await expect(
      client.upsert('test', {
        points: [{ id: 1, vector: [0.1, 0.2, 0.3], payload: {} }], // 3 instead of 4
      })
    ).rejects.toThrow('dimension mismatch')
  })

  it('should throw on non-existent collection', async () => {
    await expect(
      client.upsert('non-existent', {
        points: [{ id: 1, vector: [0.1, 0.2, 0.3, 0.4], payload: {} }],
      })
    ).rejects.toThrow('not found')
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('Points - Search', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    // Insert test points
    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { category: 'a', price: 10 } },
        { id: 2, vector: [0, 1, 0, 0], payload: { category: 'a', price: 20 } },
        { id: 3, vector: [0, 0, 1, 0], payload: { category: 'b', price: 30 } },
        { id: 4, vector: [0, 0, 0, 1], payload: { category: 'b', price: 40 } },
        { id: 5, vector: [0.5, 0.5, 0, 0], payload: { category: 'a', price: 15 } },
      ],
    })
  })

  it('should search with vector', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 3,
    })

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe(1) // Most similar to [1, 0, 0, 0]
    expect(results[0].score).toBeCloseTo(1, 5)
  })

  it('should return scores in descending order', async () => {
    const results = await client.search('test', {
      vector: [0.5, 0.5, 0, 0],
      limit: 5,
    })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('should respect limit parameter', async () => {
    const results = await client.search('test', {
      vector: [0.5, 0.5, 0.5, 0.5],
      limit: 2,
    })

    expect(results).toHaveLength(2)
  })

  it('should support offset parameter', async () => {
    const allResults = await client.search('test', {
      vector: [0.5, 0.5, 0.5, 0.5],
      limit: 5,
    })

    const offsetResults = await client.search('test', {
      vector: [0.5, 0.5, 0.5, 0.5],
      limit: 3,
      offset: 2,
    })

    expect(offsetResults[0].id).toBe(allResults[2].id)
  })

  it('should include payload when requested', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 1,
      with_payload: true,
    })

    expect(results[0].payload).toBeDefined()
    expect(results[0].payload?.category).toBe('a')
  })

  it('should include specific payload fields', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 1,
      with_payload: ['category'],
    })

    expect(results[0].payload?.category).toBe('a')
    expect(results[0].payload?.price).toBeUndefined()
  })

  it('should exclude specific payload fields', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 1,
      with_payload: { exclude: ['price'] },
    })

    expect(results[0].payload?.category).toBe('a')
    expect(results[0].payload?.price).toBeUndefined()
  })

  it('should include vector when requested', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 1,
      with_vector: true,
    })

    expect(results[0].vector).toBeDefined()
    expect(results[0].vector).toEqual([1, 0, 0, 0])
  })

  it('should not include payload by default', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 1,
    })

    expect(results[0].payload).toBeNull()
  })

  it('should apply score threshold', async () => {
    const results = await client.search('test', {
      vector: [1, 0, 0, 0],
      limit: 10,
      score_threshold: 0.9,
    })

    expect(results.length).toBeLessThan(5)
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.9)
    }
  })
})

// ============================================================================
// DISTANCE METRIC TESTS
// ============================================================================

describe('Distance Metrics', () => {
  let client: QdrantClient

  beforeEach(() => {
    client = new QdrantClient()
  })

  describe('Cosine', () => {
    it('should use cosine similarity', async () => {
      await client.createCollection('cosine', {
        vectors: { size: 3, distance: 'Cosine' },
      })

      await client.upsert('cosine', {
        points: [
          { id: 1, vector: [1, 0, 0], payload: {} },
          { id: 2, vector: [0, 1, 0], payload: {} },
          { id: 3, vector: [1, 1, 0], payload: {} }, // 45 degrees from both
        ],
      })

      const results = await client.search('cosine', {
        vector: [1, 0, 0],
        limit: 3,
      })

      expect(results[0].id).toBe(1) // Exact match
      expect(results[0].score).toBeCloseTo(1, 5)
      expect(results[1].id).toBe(3) // cos(45) = 0.707
      expect(results[1].score).toBeCloseTo(Math.sqrt(2) / 2, 2)
      expect(results[2].id).toBe(2) // Orthogonal
      expect(results[2].score).toBeCloseTo(0, 5)
    })
  })

  describe('Euclid', () => {
    it('should use Euclidean distance', async () => {
      await client.createCollection('euclid', {
        vectors: { size: 2, distance: 'Euclid' },
      })

      await client.upsert('euclid', {
        points: [
          { id: 1, vector: [0, 0], payload: {} },
          { id: 2, vector: [1, 0], payload: {} },
          { id: 3, vector: [2, 0], payload: {} },
        ],
      })

      const results = await client.search('euclid', {
        vector: [0, 0],
        limit: 3,
      })

      // Closer points should have higher scores
      expect(results[0].id).toBe(1) // Distance 0
      expect(results[1].id).toBe(2) // Distance 1
      expect(results[2].id).toBe(3) // Distance 2
    })
  })

  describe('Dot', () => {
    it('should use dot product', async () => {
      await client.createCollection('dot', {
        vectors: { size: 2, distance: 'Dot' },
      })

      await client.upsert('dot', {
        points: [
          { id: 1, vector: [1, 1], payload: {} }, // dot = 2
          { id: 2, vector: [1, 0], payload: {} }, // dot = 1
          { id: 3, vector: [0, 0], payload: {} }, // dot = 0
        ],
      })

      const results = await client.search('dot', {
        vector: [1, 1],
        limit: 3,
      })

      expect(results[0].id).toBe(1) // Highest dot product
      expect(results[0].score).toBe(2)
      expect(results[1].id).toBe(2)
      expect(results[1].score).toBe(1)
      expect(results[2].id).toBe(3)
      expect(results[2].score).toBe(0)
    })
  })
})

// ============================================================================
// FILTER TESTS
// ============================================================================

describe('Filters', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { category: 'electronics', price: 100, inStock: true, tags: ['new', 'sale'] } },
        { id: 2, vector: [0, 1, 0, 0], payload: { category: 'electronics', price: 200, inStock: false, tags: ['popular'] } },
        { id: 3, vector: [0, 0, 1, 0], payload: { category: 'books', price: 25, inStock: true, tags: ['new'] } },
        { id: 4, vector: [0, 0, 0, 1], payload: { category: 'books', price: 15, inStock: true, tags: ['sale', 'clearance'] } },
        { id: 5, vector: [0.5, 0.5, 0, 0], payload: { category: 'electronics', price: 150, inStock: true, tags: [] } },
      ],
    })
  })

  describe('must (AND)', () => {
    it('should filter with single must condition', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'category', match: { value: 'electronics' } }],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(3)
      for (const r of results) {
        expect(r.payload?.category).toBe('electronics')
      }
    })

    it('should filter with multiple must conditions', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [
            { key: 'category', match: { value: 'electronics' } },
            { key: 'inStock', match: { value: true } },
          ],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(2) // id 1 and 5
      for (const r of results) {
        expect(r.payload?.category).toBe('electronics')
        expect(r.payload?.inStock).toBe(true)
      }
    })
  })

  describe('should (OR)', () => {
    it('should filter with should conditions', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          should: [
            { key: 'category', match: { value: 'books' } },
            { key: 'price', range: { lt: 50 } },
          ],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(2) // id 3 and 4 (both books and price < 50)
    })
  })

  describe('must_not (NOT)', () => {
    it('should filter with must_not conditions', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must_not: [{ key: 'category', match: { value: 'books' } }],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(3) // All electronics
      for (const r of results) {
        expect(r.payload?.category).not.toBe('books')
      }
    })
  })

  describe('range conditions', () => {
    it('should filter with lt', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'price', range: { lt: 100 } }],
        },
        with_payload: true,
      })

      for (const r of results) {
        expect(r.payload?.price).toBeLessThan(100)
      }
    })

    it('should filter with gt', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'price', range: { gt: 100 } }],
        },
        with_payload: true,
      })

      for (const r of results) {
        expect(r.payload?.price).toBeGreaterThan(100)
      }
    })

    it('should filter with gte and lte', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'price', range: { gte: 25, lte: 150 } }],
        },
        with_payload: true,
      })

      for (const r of results) {
        expect(r.payload?.price).toBeGreaterThanOrEqual(25)
        expect(r.payload?.price).toBeLessThanOrEqual(150)
      }
    })
  })

  describe('match conditions', () => {
    it('should match with text (substring)', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'category', match: { text: 'elec' } }],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(3)
    })

    it('should match with any', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'tags', match: { any: ['sale', 'popular'] } }],
        },
        with_payload: true,
      })

      // id 1 (sale), id 2 (popular), id 4 (sale)
      expect(results).toHaveLength(3)
    })

    it('should match with except', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'category', match: { except: ['books'] } }],
        },
        with_payload: true,
      })

      expect(results).toHaveLength(3) // All electronics
    })
  })

  describe('has_id condition', () => {
    it('should filter by point IDs', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ has_id: [1, 3] }],
        },
      })

      expect(results).toHaveLength(2)
      const ids = results.map((r) => r.id)
      expect(ids).toContain(1)
      expect(ids).toContain(3)
    })
  })

  describe('is_empty condition', () => {
    it('should filter empty arrays', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ is_empty: { key: 'tags' } }],
        },
      })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(5)
    })
  })

  describe('combined filters', () => {
    it('should combine must, should, and must_not', async () => {
      const results = await client.search('test', {
        vector: [0.5, 0.5, 0.5, 0.5],
        limit: 10,
        filter: {
          must: [{ key: 'inStock', match: { value: true } }],
          should: [
            { key: 'price', range: { lt: 50 } },
            { key: 'tags', match: { any: ['sale'] } },
          ],
          must_not: [{ key: 'category', match: { value: 'electronics' } }],
        },
        with_payload: true,
      })

      // Must be in stock, not electronics, and either price < 50 or has 'sale' tag
      // id 3: books, in stock, price 25, tags ['new'] - matches (price < 50)
      // id 4: books, in stock, price 15, tags ['sale', 'clearance'] - matches (price < 50 and sale)
      expect(results).toHaveLength(2)
    })
  })
})

// ============================================================================
// RETRIEVE TESTS
// ============================================================================

describe('Points - Retrieve', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { name: 'point1' } },
        { id: 2, vector: [0, 1, 0, 0], payload: { name: 'point2' } },
        { id: 3, vector: [0, 0, 1, 0], payload: { name: 'point3' } },
      ],
    })
  })

  it('should retrieve points by IDs', async () => {
    const records = await client.retrieve('test', {
      ids: [1, 3],
    })

    expect(records).toHaveLength(2)
    const ids = records.map((r) => r.id)
    expect(ids).toContain(1)
    expect(ids).toContain(3)
  })

  it('should retrieve with payload', async () => {
    const records = await client.retrieve('test', {
      ids: [1],
      with_payload: true,
    })

    expect(records[0].payload?.name).toBe('point1')
  })

  it('should retrieve with vector', async () => {
    const records = await client.retrieve('test', {
      ids: [1],
      with_vector: true,
    })

    expect(records[0].vector).toEqual([1, 0, 0, 0])
  })

  it('should skip non-existent IDs', async () => {
    const records = await client.retrieve('test', {
      ids: [1, 999],
    })

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(1)
  })

  it('should retrieve with string IDs', async () => {
    await client.upsert('test', {
      points: [{ id: 'string-id', vector: [0.5, 0.5, 0, 0], payload: { name: 'string' } }],
    })

    const records = await client.retrieve('test', {
      ids: ['string-id'],
      with_payload: true,
    })

    expect(records).toHaveLength(1)
    expect(records[0].payload?.name).toBe('string')
  })
})

// ============================================================================
// DELETE TESTS
// ============================================================================

describe('Points - Delete', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { category: 'a' } },
        { id: 2, vector: [0, 1, 0, 0], payload: { category: 'a' } },
        { id: 3, vector: [0, 0, 1, 0], payload: { category: 'b' } },
        { id: 4, vector: [0, 0, 0, 1], payload: { category: 'b' } },
      ],
    })
  })

  it('should delete points by IDs', async () => {
    await client.delete('test', {
      points: [1, 2],
    })

    const info = await client.getCollection('test')
    expect(info.points_count).toBe(2)

    const records = await client.retrieve('test', { ids: [1, 2, 3, 4] })
    expect(records).toHaveLength(2)
  })

  it('should delete points by filter', async () => {
    await client.delete('test', {
      filter: {
        must: [{ key: 'category', match: { value: 'a' } }],
      },
    })

    const info = await client.getCollection('test')
    expect(info.points_count).toBe(2)

    const records = await client.retrieve('test', { ids: [1, 2, 3, 4], with_payload: true })
    for (const r of records) {
      expect(r.payload?.category).toBe('b')
    }
  })
})

// ============================================================================
// SCROLL TESTS
// ============================================================================

describe('Points - Scroll', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        vector: [Math.random(), Math.random(), Math.random(), Math.random()],
        payload: { index: i + 1 },
      })),
    })
  })

  it('should scroll through all points', async () => {
    const page1 = await client.scroll('test', { limit: 10 })

    expect(page1.points).toHaveLength(10)
    expect(page1.next_page_offset).not.toBeNull()
  })

  it('should scroll with offset', async () => {
    const page1 = await client.scroll('test', { limit: 10 })
    const page2 = await client.scroll('test', { limit: 10, offset: page1.next_page_offset })

    expect(page2.points).toHaveLength(10)

    // Pages should be different
    const page1Ids = new Set(page1.points.map((p) => p.id))
    for (const p of page2.points) {
      expect(page1Ids.has(p.id)).toBe(false)
    }
  })

  it('should scroll with filter', async () => {
    const result = await client.scroll('test', {
      limit: 100,
      filter: {
        must: [{ key: 'index', range: { lte: 10 } }],
      },
      with_payload: true,
    })

    expect(result.points).toHaveLength(10)
  })

  it('should include payload when requested', async () => {
    const result = await client.scroll('test', {
      limit: 5,
      with_payload: true,
    })

    for (const p of result.points) {
      expect(p.payload).toBeDefined()
      expect(p.payload?.index).toBeDefined()
    }
  })

  it('should include vector when requested', async () => {
    const result = await client.scroll('test', {
      limit: 5,
      with_vector: true,
    })

    for (const p of result.points) {
      expect(p.vector).toBeDefined()
      expect(Array.isArray(p.vector)).toBe(true)
    }
  })
})

// ============================================================================
// COUNT TESTS
// ============================================================================

describe('Points - Count', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { category: 'a' } },
        { id: 2, vector: [0, 1, 0, 0], payload: { category: 'a' } },
        { id: 3, vector: [0, 0, 1, 0], payload: { category: 'b' } },
        { id: 4, vector: [0, 0, 0, 1], payload: { category: 'b' } },
        { id: 5, vector: [0.5, 0.5, 0, 0], payload: { category: 'a' } },
      ],
    })
  })

  it('should count all points', async () => {
    const result = await client.count('test')
    expect(result.count).toBe(5)
  })

  it('should count with filter', async () => {
    const result = await client.count('test', {
      filter: {
        must: [{ key: 'category', match: { value: 'a' } }],
      },
    })

    expect(result.count).toBe(3)
  })

  it('should return 0 for empty result', async () => {
    const result = await client.count('test', {
      filter: {
        must: [{ key: 'category', match: { value: 'nonexistent' } }],
      },
    })

    expect(result.count).toBe(0)
  })
})

// ============================================================================
// PAYLOAD OPERATIONS TESTS
// ============================================================================

describe('Payload Operations', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { name: 'original', count: 1 } },
        { id: 2, vector: [0, 1, 0, 0], payload: { name: 'original', count: 2 } },
      ],
    })
  })

  describe('setPayload', () => {
    it('should set payload for points', async () => {
      await client.setPayload('test', { name: 'updated' }, { points: [1] })

      const records = await client.retrieve('test', { ids: [1], with_payload: true })
      expect(records[0].payload?.name).toBe('updated')
      expect(records[0].payload?.count).toBe(1) // Original field preserved
    })

    it('should set payload with filter', async () => {
      await client.setPayload(
        'test',
        { status: 'processed' },
        { filter: { must: [{ key: 'count', range: { gte: 2 } }] } }
      )

      const records = await client.retrieve('test', { ids: [1, 2], with_payload: true })
      expect(records.find((r) => r.id === 1)?.payload?.status).toBeUndefined()
      expect(records.find((r) => r.id === 2)?.payload?.status).toBe('processed')
    })
  })

  describe('overwritePayload', () => {
    it('should overwrite entire payload', async () => {
      await client.overwritePayload('test', { completely: 'new' }, { points: [1] })

      const records = await client.retrieve('test', { ids: [1], with_payload: true })
      expect(records[0].payload?.completely).toBe('new')
      expect(records[0].payload?.name).toBeUndefined()
      expect(records[0].payload?.count).toBeUndefined()
    })
  })

  describe('deletePayload', () => {
    it('should delete specific payload keys', async () => {
      await client.deletePayload('test', ['name'], { points: [1] })

      const records = await client.retrieve('test', { ids: [1], with_payload: true })
      expect(records[0].payload?.name).toBeUndefined()
      expect(records[0].payload?.count).toBe(1)
    })
  })

  describe('clearPayload', () => {
    it('should clear all payload', async () => {
      await client.clearPayload('test', { points: [1] })

      const records = await client.retrieve('test', { ids: [1], with_payload: true })
      expect(records[0].payload).toEqual({})
    })
  })
})

// ============================================================================
// NAMED VECTORS TESTS
// ============================================================================

describe('Named Vectors', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('multi', {
      vectors: {
        title: { size: 4, distance: 'Cosine' },
        content: { size: 8, distance: 'Dot' },
      },
    })
  })

  it('should upsert with named vectors', async () => {
    const result = await client.upsert('multi', {
      points: [
        {
          id: 1,
          vector: {
            title: [1, 0, 0, 0],
            content: [1, 0, 0, 0, 0, 0, 0, 0],
          },
          payload: { name: 'doc1' },
        },
      ],
    })

    expect(result.status).toBe('completed')
  })

  it('should search with named vector', async () => {
    await client.upsert('multi', {
      points: [
        { id: 1, vector: { title: [1, 0, 0, 0], content: [1, 0, 0, 0, 0, 0, 0, 0] }, payload: {} },
        { id: 2, vector: { title: [0, 1, 0, 0], content: [0, 1, 0, 0, 0, 0, 0, 0] }, payload: {} },
      ],
    })

    const results = await client.search('multi', {
      vector: { name: 'title', vector: [1, 0, 0, 0] },
      limit: 2,
    })

    expect(results[0].id).toBe(1)
  })

  it('should retrieve specific named vectors', async () => {
    await client.upsert('multi', {
      points: [
        { id: 1, vector: { title: [1, 0, 0, 0], content: [1, 0, 0, 0, 0, 0, 0, 0] }, payload: {} },
      ],
    })

    const records = await client.retrieve('multi', {
      ids: [1],
      with_vector: ['title'],
    })

    expect(records[0].vector).toHaveProperty('title')
    expect(records[0].vector).not.toHaveProperty('content')
  })
})

// ============================================================================
// RECOMMEND TESTS
// ============================================================================

describe('Recommend', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: { category: 'a' } },
        { id: 2, vector: [0.9, 0.1, 0, 0], payload: { category: 'a' } },
        { id: 3, vector: [0.8, 0.2, 0, 0], payload: { category: 'a' } },
        { id: 4, vector: [0, 1, 0, 0], payload: { category: 'b' } },
        { id: 5, vector: [0, 0.9, 0.1, 0], payload: { category: 'b' } },
      ],
    })
  })

  it('should recommend based on positive examples', async () => {
    const results = await client.recommend('test', {
      positive: [1],
      limit: 3,
    })

    // Should find points similar to id 1
    expect(results).toHaveLength(3)
    // Should not include the positive example itself
    expect(results.find((r) => r.id === 1)).toBeUndefined()
    // Points 2 and 3 should be most similar
    expect([results[0].id, results[1].id]).toContain(2)
    expect([results[0].id, results[1].id]).toContain(3)
  })

  it('should recommend with negative examples', async () => {
    const results = await client.recommend('test', {
      positive: [1],
      negative: [4],
      limit: 3,
    })

    // Should not include positive or negative examples
    expect(results.find((r) => r.id === 1)).toBeUndefined()
    expect(results.find((r) => r.id === 4)).toBeUndefined()
  })

  it('should apply filter to recommendations', async () => {
    const results = await client.recommend('test', {
      positive: [1],
      limit: 3,
      filter: {
        must: [{ key: 'category', match: { value: 'a' } }],
      },
      with_payload: true,
    })

    for (const r of results) {
      expect(r.payload?.category).toBe('a')
    }
  })
})

// ============================================================================
// BATCH SEARCH TESTS
// ============================================================================

describe('Batch Search', () => {
  let client: QdrantClient

  beforeEach(async () => {
    client = new QdrantClient()
    await client.createCollection('test', {
      vectors: { size: 4, distance: 'Cosine' },
    })

    await client.upsert('test', {
      points: [
        { id: 1, vector: [1, 0, 0, 0], payload: {} },
        { id: 2, vector: [0, 1, 0, 0], payload: {} },
        { id: 3, vector: [0, 0, 1, 0], payload: {} },
        { id: 4, vector: [0, 0, 0, 1], payload: {} },
      ],
    })
  })

  it('should search multiple queries in batch', async () => {
    const results = await client.searchBatch('test', [
      { vector: [1, 0, 0, 0], limit: 2 },
      { vector: [0, 1, 0, 0], limit: 2 },
      { vector: [0, 0, 1, 0], limit: 2 },
    ])

    expect(results).toHaveLength(3)
    expect(results[0][0].id).toBe(1)
    expect(results[1][0].id).toBe(2)
    expect(results[2][0].id).toBe(3)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  it('should work with realistic semantic search workflow', async () => {
    const client = new QdrantClient()

    // Create collection for document embeddings
    await client.createCollection('documents', {
      vectors: { size: 128, distance: 'Cosine' },
    })

    // Insert some "documents" with embeddings
    const docs = [
      { title: 'Machine Learning Basics', category: 'tech', rating: 4.5 },
      { title: 'Deep Learning Guide', category: 'tech', rating: 4.8 },
      { title: 'Cooking for Beginners', category: 'lifestyle', rating: 4.2 },
      { title: 'Travel Photography', category: 'lifestyle', rating: 4.6 },
      { title: 'AI Ethics', category: 'tech', rating: 4.3 },
    ]

    await client.upsert('documents', {
      points: docs.map((doc, i) => ({
        id: i + 1,
        vector: normalizedVector(128),
        payload: doc,
      })),
    })

    // Search for tech documents
    const techDocs = await client.search('documents', {
      vector: normalizedVector(128),
      limit: 10,
      filter: {
        must: [{ key: 'category', match: { value: 'tech' } }],
      },
      with_payload: true,
    })

    expect(techDocs).toHaveLength(3)
    for (const doc of techDocs) {
      expect(doc.payload?.category).toBe('tech')
    }

    // Search with rating filter
    const highRated = await client.search('documents', {
      vector: normalizedVector(128),
      limit: 10,
      filter: {
        must: [{ key: 'rating', range: { gte: 4.5 } }],
      },
      with_payload: true,
    })

    for (const doc of highRated) {
      expect(doc.payload?.rating).toBeGreaterThanOrEqual(4.5)
    }

    // Count by category
    const techCount = await client.count('documents', {
      filter: {
        must: [{ key: 'category', match: { value: 'tech' } }],
      },
    })

    expect(techCount.count).toBe(3)

    // Scroll through all documents
    const allDocs = await client.scroll('documents', {
      limit: 100,
      with_payload: true,
    })

    expect(allDocs.points).toHaveLength(5)
  })

  it('should handle large-scale operations', async () => {
    const client = new QdrantClient()
    const dimension = 64
    const numPoints = 1000

    await client.createCollection('large', {
      vectors: { size: dimension, distance: 'Cosine' },
    })

    // Batch insert
    const points = Array.from({ length: numPoints }, (_, i) => ({
      id: i,
      vector: normalizedVector(dimension),
      payload: { index: i, batch: Math.floor(i / 100) },
    }))

    await client.upsert('large', { points })

    const info = await client.getCollection('large')
    expect(info.points_count).toBe(numPoints)

    // Search performance
    const startTime = performance.now()
    const results = await client.search('large', {
      vector: normalizedVector(dimension),
      limit: 10,
    })
    const elapsed = performance.now() - startTime

    expect(results).toHaveLength(10)
    expect(elapsed).toBeLessThan(1000) // Should complete in under 1 second

    // Filtered search
    const filteredResults = await client.search('large', {
      vector: normalizedVector(dimension),
      limit: 10,
      filter: {
        must: [{ key: 'batch', match: { value: 5 } }],
      },
    })

    expect(filteredResults.length).toBeGreaterThan(0)
  })
})
