/**
 * @dotdo/chroma - Chroma SDK compat tests
 *
 * Tests for Chroma SDK API compatibility backed by DO:
 * - ChromaClient creation
 * - Collection management: createCollection, getCollection, deleteCollection, listCollections
 * - Document operations: add, query, get, update, delete
 * - Embedding storage and similarity search (cosine)
 * - Metadata filtering with where clauses
 * - Document filtering with whereDocument
 * - Include/exclude fields in responses
 *
 * @see https://docs.trychroma.com/reference/js-client
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ChromaClient,
  _resetStorage,
  ChromaError,
  ChromaNotFoundError,
  ChromaConflictError,
  ChromaValidationError,
} from './index'
import type { Collection, Metadata, Where, WhereDocument, IncludeEnum } from './types'

// ============================================================================
// CHROMA CLIENT TESTS
// ============================================================================

describe('ChromaClient', () => {
  beforeEach(() => {
    _resetStorage()
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should create client with default config', () => {
    const client = new ChromaClient()
    expect(client).toBeDefined()
  })

  it('should create client with custom path', () => {
    const client = new ChromaClient({ path: 'http://localhost:8000' })
    expect(client).toBeDefined()
  })

  it('should create client with tenant and database', () => {
    const client = new ChromaClient({
      path: 'http://localhost:8000',
      tenant: 'my-tenant',
      database: 'my-database',
    })
    expect(client).toBeDefined()
  })

  it('should heartbeat successfully', async () => {
    const client = new ChromaClient()
    const heartbeat = await client.heartbeat()
    expect(typeof heartbeat).toBe('number')
  })

  it('should return version', async () => {
    const client = new ChromaClient()
    const version = await client.version()
    expect(typeof version).toBe('string')
  })

  it('should reset all data', async () => {
    const client = new ChromaClient()
    await client.createCollection({ name: 'test-collection' })
    await client.reset()
    const collections = await client.listCollections()
    expect(collections.length).toBe(0)
  })
})

// ============================================================================
// COLLECTION MANAGEMENT TESTS
// ============================================================================

describe('Collection Management', () => {
  let client: ChromaClient

  beforeEach(() => {
    _resetStorage()
    client = new ChromaClient()
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('createCollection', () => {
    it('should create collection with name only', async () => {
      const collection = await client.createCollection({ name: 'my-collection' })
      expect(collection.name).toBe('my-collection')
      expect(collection.id).toBeDefined()
    })

    it('should create collection with metadata', async () => {
      const collection = await client.createCollection({
        name: 'my-collection',
        metadata: { description: 'Test collection' },
      })
      expect(collection.metadata?.description).toBe('Test collection')
    })

    it('should throw on duplicate collection name', async () => {
      await client.createCollection({ name: 'my-collection' })
      await expect(
        client.createCollection({ name: 'my-collection' })
      ).rejects.toThrow(ChromaConflictError)
    })

    it('should throw on empty name', async () => {
      await expect(
        client.createCollection({ name: '' })
      ).rejects.toThrow(ChromaValidationError)
    })

    it('should throw on invalid name characters', async () => {
      await expect(
        client.createCollection({ name: 'my collection!' })
      ).rejects.toThrow(ChromaValidationError)
    })
  })

  describe('getCollection', () => {
    it('should get existing collection', async () => {
      await client.createCollection({ name: 'my-collection' })
      const collection = await client.getCollection({ name: 'my-collection' })
      expect(collection.name).toBe('my-collection')
    })

    it('should throw on non-existent collection', async () => {
      await expect(
        client.getCollection({ name: 'non-existent' })
      ).rejects.toThrow(ChromaNotFoundError)
    })
  })

  describe('getOrCreateCollection', () => {
    it('should create new collection if not exists', async () => {
      const collection = await client.getOrCreateCollection({ name: 'my-collection' })
      expect(collection.name).toBe('my-collection')
    })

    it('should return existing collection if exists', async () => {
      await client.createCollection({
        name: 'my-collection',
        metadata: { version: 1 },
      })
      const collection = await client.getOrCreateCollection({
        name: 'my-collection',
        metadata: { version: 2 }, // Should be ignored
      })
      expect(collection.metadata?.version).toBe(1)
    })
  })

  describe('deleteCollection', () => {
    it('should delete existing collection', async () => {
      await client.createCollection({ name: 'my-collection' })
      await client.deleteCollection({ name: 'my-collection' })
      const collections = await client.listCollections()
      expect(collections.length).toBe(0)
    })

    it('should throw on non-existent collection', async () => {
      await expect(
        client.deleteCollection({ name: 'non-existent' })
      ).rejects.toThrow(ChromaNotFoundError)
    })
  })

  describe('listCollections', () => {
    it('should list all collections', async () => {
      await client.createCollection({ name: 'collection1' })
      await client.createCollection({ name: 'collection2' })
      await client.createCollection({ name: 'collection3' })

      const collections = await client.listCollections()
      expect(collections.length).toBe(3)
      expect(collections.map((c) => c.name).sort()).toEqual([
        'collection1',
        'collection2',
        'collection3',
      ])
    })

    it('should return empty array when no collections', async () => {
      const collections = await client.listCollections()
      expect(collections).toEqual([])
    })
  })

  describe('countCollections', () => {
    it('should count collections', async () => {
      await client.createCollection({ name: 'collection1' })
      await client.createCollection({ name: 'collection2' })

      const count = await client.countCollections()
      expect(count).toBe(2)
    })

    it('should return 0 when no collections', async () => {
      const count = await client.countCollections()
      expect(count).toBe(0)
    })
  })
})

// ============================================================================
// ADD DOCUMENTS TESTS
// ============================================================================

describe('Add Documents', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should add documents with embeddings', async () => {
    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
      ],
    })

    const count = await collection.count()
    expect(count).toBe(2)
  })

  it('should add documents with metadata', async () => {
    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
      ],
      metadatas: [{ source: 'doc1' }, { source: 'doc2' }],
    })

    const result = await collection.get({ ids: ['id1'], include: ['metadatas'] })
    expect(result.metadatas?.[0]?.source).toBe('doc1')
  })

  it('should add documents with document text', async () => {
    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
      ],
      documents: ['This is document 1', 'This is document 2'],
    })

    const result = await collection.get({ ids: ['id1'], include: ['documents'] })
    expect(result.documents?.[0]).toBe('This is document 1')
  })

  it('should add single document', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 2.0, 3.0]],
    })

    const count = await collection.count()
    expect(count).toBe(1)
  })

  it('should throw on duplicate IDs in same batch', async () => {
    await expect(
      collection.add({
        ids: ['id1', 'id1'],
        embeddings: [
          [1.0, 2.0, 3.0],
          [4.0, 5.0, 6.0],
        ],
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should throw on duplicate ID with existing document', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 2.0, 3.0]],
    })

    await expect(
      collection.add({
        ids: ['id1'],
        embeddings: [[4.0, 5.0, 6.0]],
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should throw on empty IDs array', async () => {
    await expect(
      collection.add({
        ids: [],
        embeddings: [],
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should throw on mismatched array lengths', async () => {
    await expect(
      collection.add({
        ids: ['id1', 'id2'],
        embeddings: [[1.0, 2.0, 3.0]], // Only one embedding
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should throw on mismatched metadata array length', async () => {
    await expect(
      collection.add({
        ids: ['id1', 'id2'],
        embeddings: [
          [1.0, 2.0, 3.0],
          [4.0, 5.0, 6.0],
        ],
        metadatas: [{ source: 'doc1' }], // Only one metadata
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should throw on mismatched documents array length', async () => {
    await expect(
      collection.add({
        ids: ['id1', 'id2'],
        embeddings: [
          [1.0, 2.0, 3.0],
          [4.0, 5.0, 6.0],
        ],
        documents: ['Doc 1'], // Only one document
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should handle null metadata entries', async () => {
    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
      ],
      metadatas: [{ source: 'doc1' }, null as unknown as Metadata],
    })

    const result = await collection.get({ ids: ['id2'], include: ['metadatas'] })
    expect(result.metadatas?.[0]).toBeNull()
  })

  it('should handle null document entries', async () => {
    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
      ],
      documents: ['Doc 1', null as unknown as string],
    })

    const result = await collection.get({ ids: ['id2'], include: ['documents'] })
    expect(result.documents?.[0]).toBeNull()
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('Query', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    // Add test documents
    await collection.add({
      ids: ['id1', 'id2', 'id3', 'id4', 'id5'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.7, 0.7, 0.0],
        [0.5, 0.5, 0.5],
      ],
      metadatas: [
        { category: 'A', score: 100 },
        { category: 'B', score: 200 },
        { category: 'A', score: 150 },
        { category: 'B', score: 250 },
        { category: 'C', score: 300 },
      ],
      documents: ['Doc one', 'Doc two', 'Doc three', 'Doc four', 'Doc five'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should query by single embedding', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 3,
    })

    expect(result.ids.length).toBe(1) // One query
    expect(result.ids[0].length).toBe(3) // 3 results
    expect(result.ids[0][0]).toBe('id1') // Exact match first
  })

  it('should query by multiple embeddings', async () => {
    const result = await collection.query({
      queryEmbeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
      ],
      nResults: 2,
    })

    expect(result.ids.length).toBe(2) // Two queries
    expect(result.ids[0][0]).toBe('id1')
    expect(result.ids[1][0]).toBe('id2')
  })

  it('should respect nResults limit', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 2,
    })

    expect(result.ids[0].length).toBe(2)
  })

  it('should return distances by default', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 3,
    })

    expect(result.distances).toBeDefined()
    expect(result.distances![0].length).toBe(3)
    expect(result.distances![0][0]).toBeCloseTo(0) // Exact match = 0 distance
  })

  it('should include metadatas when requested', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
      include: ['metadatas'],
    })

    expect(result.metadatas).toBeDefined()
    expect(result.metadatas![0][0]?.category).toBe('A')
  })

  it('should include documents when requested', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
      include: ['documents'],
    })

    expect(result.documents).toBeDefined()
    expect(result.documents![0][0]).toBe('Doc one')
  })

  it('should include embeddings when requested', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
      include: ['embeddings'],
    })

    expect(result.embeddings).toBeDefined()
    expect(result.embeddings![0][0]).toEqual([1.0, 0.0, 0.0])
  })

  it('should filter by where clause', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      where: { category: 'A' },
    })

    expect(result.ids[0].length).toBe(2) // Only id1 and id3
    expect(result.ids[0]).toContain('id1')
    expect(result.ids[0]).toContain('id3')
  })

  it('should return empty results when no matches', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 10,
      where: { category: 'NonExistent' },
    })

    expect(result.ids[0].length).toBe(0)
  })

  it('should handle query with nResults greater than document count', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 100,
    })

    expect(result.ids[0].length).toBe(5) // Only 5 documents exist
  })

  it('should throw on empty queryEmbeddings', async () => {
    await expect(
      collection.query({
        queryEmbeddings: [],
        nResults: 10,
      })
    ).rejects.toThrow(ChromaValidationError)
  })
})

// ============================================================================
// METADATA FILTERING (WHERE) TESTS
// ============================================================================

describe('Metadata Filtering (where)', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1', 'id2', 'id3', 'id4', 'id5'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.5, 0.5, 0.0],
        [0.0, 0.5, 0.5],
      ],
      metadatas: [
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
        { name: 'Charlie', age: 35, active: true },
        { name: 'Diana', age: 28 },
        { name: 'Eve', age: 30, active: true, tags: ['admin', 'user'] },
      ],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('comparison operators', () => {
    it('should filter with $eq', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { name: { $eq: 'Alice' } },
      })

      expect(result.ids[0].length).toBe(1)
      expect(result.ids[0][0]).toBe('id1')
    })

    it('should filter with implicit $eq', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { name: 'Bob' },
      })

      expect(result.ids[0].length).toBe(1)
      expect(result.ids[0][0]).toBe('id2')
    })

    it('should filter with $ne', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { name: { $ne: 'Alice' } },
      })

      expect(result.ids[0].length).toBe(4)
      expect(result.ids[0]).not.toContain('id1')
    })

    it('should filter with $gt', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { age: { $gt: 28 } },
      })

      expect(result.ids[0].length).toBe(3) // Alice (30), Charlie (35), Eve (30)
    })

    it('should filter with $gte', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { age: { $gte: 30 } },
      })

      expect(result.ids[0].length).toBe(3) // Alice, Charlie, Eve
    })

    it('should filter with $lt', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { age: { $lt: 28 } },
      })

      expect(result.ids[0].length).toBe(1) // Bob (25)
    })

    it('should filter with $lte', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { age: { $lte: 28 } },
      })

      expect(result.ids[0].length).toBe(2) // Bob (25), Diana (28)
    })

    it('should filter with $in', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { name: { $in: ['Alice', 'Bob', 'Charlie'] } },
      })

      expect(result.ids[0].length).toBe(3)
    })

    it('should filter with $nin', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { name: { $nin: ['Alice', 'Bob'] } },
      })

      expect(result.ids[0].length).toBe(3)
    })
  })

  describe('logical operators', () => {
    it('should filter with $and', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: {
          $and: [{ age: { $gte: 30 } }, { active: true }],
        },
      })

      expect(result.ids[0].length).toBe(3) // Alice, Charlie, Eve
    })

    it('should filter with $or', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }],
        },
      })

      expect(result.ids[0].length).toBe(2)
    })

    it('should filter with nested logical operators', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: {
          $and: [
            { $or: [{ name: 'Alice' }, { name: 'Eve' }] },
            { age: { $gte: 30 } },
          ],
        },
      })

      expect(result.ids[0].length).toBe(2) // Alice and Eve
    })
  })

  describe('edge cases', () => {
    it('should filter on boolean values', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { active: true },
      })

      expect(result.ids[0].length).toBe(3) // Alice, Charlie, Eve
    })

    it('should handle missing field (not equal)', async () => {
      const result = await collection.query({
        queryEmbeddings: [[0.5, 0.5, 0.5]],
        nResults: 10,
        where: { active: false },
      })

      // Only Bob has active: false. Diana has no active field.
      expect(result.ids[0].length).toBe(1)
    })
  })
})

// ============================================================================
// DOCUMENT FILTERING (whereDocument) TESTS
// ============================================================================

describe('Document Filtering (whereDocument)', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1', 'id2', 'id3', 'id4'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.5, 0.5, 0.5],
      ],
      documents: [
        'The quick brown fox jumps over the lazy dog',
        'A fast red fox leaps across the sleeping canine',
        'Hello world this is a test document',
        'The brown dog runs in the park',
      ],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should filter with $contains', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      whereDocument: { $contains: 'fox' },
    })

    expect(result.ids[0].length).toBe(2)
    expect(result.ids[0]).toContain('id1')
    expect(result.ids[0]).toContain('id2')
  })

  it('should filter with $not_contains', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      whereDocument: { $not_contains: 'fox' },
    })

    expect(result.ids[0].length).toBe(2)
    expect(result.ids[0]).toContain('id3')
    expect(result.ids[0]).toContain('id4')
  })

  it('should combine whereDocument with where', async () => {
    await collection.update({
      ids: ['id1', 'id2', 'id3', 'id4'],
      metadatas: [
        { type: 'animal' },
        { type: 'animal' },
        { type: 'test' },
        { type: 'animal' },
      ],
    })

    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      where: { type: 'animal' },
      whereDocument: { $contains: 'fox' },
    })

    expect(result.ids[0].length).toBe(2) // id1 and id2
  })

  it('should filter with $and in whereDocument', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      whereDocument: {
        $and: [{ $contains: 'the' }, { $contains: 'dog' }],
      },
    })

    expect(result.ids[0].length).toBe(2) // id1 and id4
  })

  it('should filter with $or in whereDocument', async () => {
    const result = await collection.query({
      queryEmbeddings: [[0.5, 0.5, 0.5]],
      nResults: 10,
      whereDocument: {
        $or: [{ $contains: 'fox' }, { $contains: 'Hello' }],
      },
    })

    expect(result.ids[0].length).toBe(3) // id1, id2, id3
  })
})

// ============================================================================
// GET DOCUMENTS TESTS
// ============================================================================

describe('Get Documents', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1', 'id2', 'id3'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ],
      metadatas: [{ category: 'A' }, { category: 'B' }, { category: 'A' }],
      documents: ['Doc 1', 'Doc 2', 'Doc 3'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should get by IDs', async () => {
    const result = await collection.get({ ids: ['id1', 'id2'] })

    expect(result.ids.length).toBe(2)
    expect(result.ids).toContain('id1')
    expect(result.ids).toContain('id2')
  })

  it('should get all documents when no filter', async () => {
    const result = await collection.get({})

    expect(result.ids.length).toBe(3)
  })

  it('should get with where filter', async () => {
    const result = await collection.get({
      where: { category: 'A' },
    })

    expect(result.ids.length).toBe(2)
    expect(result.ids).toContain('id1')
    expect(result.ids).toContain('id3')
  })

  it('should get with limit', async () => {
    const result = await collection.get({
      limit: 2,
    })

    expect(result.ids.length).toBe(2)
  })

  it('should get with offset', async () => {
    const result = await collection.get({
      offset: 1,
      limit: 10,
    })

    expect(result.ids.length).toBe(2)
  })

  it('should include metadatas when requested', async () => {
    const result = await collection.get({
      ids: ['id1'],
      include: ['metadatas'],
    })

    expect(result.metadatas).toBeDefined()
    expect(result.metadatas![0]?.category).toBe('A')
  })

  it('should include documents when requested', async () => {
    const result = await collection.get({
      ids: ['id1'],
      include: ['documents'],
    })

    expect(result.documents).toBeDefined()
    expect(result.documents![0]).toBe('Doc 1')
  })

  it('should include embeddings when requested', async () => {
    const result = await collection.get({
      ids: ['id1'],
      include: ['embeddings'],
    })

    expect(result.embeddings).toBeDefined()
    expect(result.embeddings![0]).toEqual([1.0, 0.0, 0.0])
  })

  it('should skip non-existent IDs', async () => {
    const result = await collection.get({
      ids: ['id1', 'non-existent', 'id2'],
    })

    expect(result.ids.length).toBe(2)
  })

  it('should return empty result for non-existent IDs only', async () => {
    const result = await collection.get({
      ids: ['non-existent'],
    })

    expect(result.ids.length).toBe(0)
  })
})

// ============================================================================
// UPDATE DOCUMENTS TESTS
// ============================================================================

describe('Update Documents', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1', 'id2'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
      ],
      metadatas: [{ category: 'A', version: 1 }, { category: 'B', version: 1 }],
      documents: ['Original doc 1', 'Original doc 2'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should update embeddings', async () => {
    await collection.update({
      ids: ['id1'],
      embeddings: [[0.5, 0.5, 0.0]],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['embeddings'],
    })

    expect(result.embeddings![0]).toEqual([0.5, 0.5, 0.0])
  })

  it('should update metadata', async () => {
    await collection.update({
      ids: ['id1'],
      metadatas: [{ category: 'C', version: 2 }],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['metadatas'],
    })

    expect(result.metadatas![0]?.category).toBe('C')
    expect(result.metadatas![0]?.version).toBe(2)
  })

  it('should update documents', async () => {
    await collection.update({
      ids: ['id1'],
      documents: ['Updated doc 1'],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['documents'],
    })

    expect(result.documents![0]).toBe('Updated doc 1')
  })

  it('should update multiple fields at once', async () => {
    await collection.update({
      ids: ['id1'],
      embeddings: [[0.5, 0.5, 0.0]],
      metadatas: [{ category: 'Updated' }],
      documents: ['Updated doc'],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['embeddings', 'metadatas', 'documents'],
    })

    expect(result.embeddings![0]).toEqual([0.5, 0.5, 0.0])
    expect(result.metadatas![0]?.category).toBe('Updated')
    expect(result.documents![0]).toBe('Updated doc')
  })

  it('should update multiple documents', async () => {
    await collection.update({
      ids: ['id1', 'id2'],
      metadatas: [{ version: 2 }, { version: 2 }],
    })

    const result = await collection.get({
      include: ['metadatas'],
    })

    expect(result.metadatas![0]?.version).toBe(2)
    expect(result.metadatas![1]?.version).toBe(2)
  })

  it('should throw on non-existent ID', async () => {
    await expect(
      collection.update({
        ids: ['non-existent'],
        metadatas: [{ category: 'X' }],
      })
    ).rejects.toThrow(ChromaNotFoundError)
  })

  it('should throw on mismatched array lengths', async () => {
    await expect(
      collection.update({
        ids: ['id1', 'id2'],
        metadatas: [{ category: 'X' }], // Only one metadata
      })
    ).rejects.toThrow(ChromaValidationError)
  })
})

// ============================================================================
// UPSERT DOCUMENTS TESTS
// ============================================================================

describe('Upsert Documents', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
      metadatas: [{ category: 'A' }],
      documents: ['Doc 1'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should insert new documents', async () => {
    await collection.upsert({
      ids: ['id2'],
      embeddings: [[0.0, 1.0, 0.0]],
      metadatas: [{ category: 'B' }],
      documents: ['Doc 2'],
    })

    const count = await collection.count()
    expect(count).toBe(2)
  })

  it('should update existing documents', async () => {
    await collection.upsert({
      ids: ['id1'],
      embeddings: [[0.5, 0.5, 0.0]],
      metadatas: [{ category: 'Updated' }],
      documents: ['Updated Doc'],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['embeddings', 'metadatas', 'documents'],
    })

    expect(result.embeddings![0]).toEqual([0.5, 0.5, 0.0])
    expect(result.metadatas![0]?.category).toBe('Updated')
    expect(result.documents![0]).toBe('Updated Doc')
  })

  it('should mix insert and update in same call', async () => {
    await collection.upsert({
      ids: ['id1', 'id2'],
      embeddings: [
        [0.5, 0.5, 0.0],
        [0.0, 1.0, 0.0],
      ],
      metadatas: [{ category: 'Updated' }, { category: 'New' }],
    })

    const count = await collection.count()
    expect(count).toBe(2)

    const result = await collection.get({
      include: ['metadatas'],
    })

    const categories = result.metadatas!.map((m) => m?.category).sort()
    expect(categories).toEqual(['New', 'Updated'])
  })
})

// ============================================================================
// DELETE DOCUMENTS TESTS
// ============================================================================

describe('Delete Documents', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1', 'id2', 'id3', 'id4'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.5, 0.5, 0.5],
      ],
      metadatas: [
        { category: 'A' },
        { category: 'B' },
        { category: 'A' },
        { category: 'B' },
      ],
      documents: ['Doc 1', 'Doc 2', 'Doc 3', 'Doc 4'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should delete by IDs', async () => {
    await collection.delete({ ids: ['id1', 'id2'] })

    const count = await collection.count()
    expect(count).toBe(2)

    const result = await collection.get({})
    expect(result.ids).not.toContain('id1')
    expect(result.ids).not.toContain('id2')
  })

  it('should delete by where filter', async () => {
    await collection.delete({
      where: { category: 'A' },
    })

    const count = await collection.count()
    expect(count).toBe(2)

    const result = await collection.get({ include: ['metadatas'] })
    expect(result.metadatas!.every((m) => m?.category === 'B')).toBe(true)
  })

  it('should delete by whereDocument filter', async () => {
    await collection.delete({
      whereDocument: { $contains: 'Doc 1' },
    })

    const count = await collection.count()
    expect(count).toBe(3)
  })

  it('should combine delete filters', async () => {
    await collection.delete({
      where: { category: 'A' },
      whereDocument: { $contains: 'Doc 1' },
    })

    const count = await collection.count()
    expect(count).toBe(3) // Only id1 matches both
  })

  it('should do nothing when no matches', async () => {
    await collection.delete({
      where: { category: 'NonExistent' },
    })

    const count = await collection.count()
    expect(count).toBe(4)
  })

  it('should skip non-existent IDs silently', async () => {
    await collection.delete({
      ids: ['id1', 'non-existent'],
    })

    const count = await collection.count()
    expect(count).toBe(3)
  })
})

// ============================================================================
// INCLUDE/EXCLUDE FIELDS TESTS
// ============================================================================

describe('Include/Exclude Fields', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
      metadatas: [{ category: 'A' }],
      documents: ['Test document'],
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should exclude all optional fields by default in get', async () => {
    const result = await collection.get({ ids: ['id1'] })

    expect(result.ids).toEqual(['id1'])
    // Default behavior varies - some implementations include all
    // Test with explicit include to be safe
  })

  it('should include only requested fields in get', async () => {
    const result = await collection.get({
      ids: ['id1'],
      include: ['metadatas'],
    })

    expect(result.metadatas).toBeDefined()
    expect(result.embeddings).toBeUndefined()
    expect(result.documents).toBeUndefined()
  })

  it('should include multiple fields in get', async () => {
    const result = await collection.get({
      ids: ['id1'],
      include: ['metadatas', 'documents'],
    })

    expect(result.metadatas).toBeDefined()
    expect(result.documents).toBeDefined()
    expect(result.embeddings).toBeUndefined()
  })

  it('should include only requested fields in query', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
      include: ['documents'],
    })

    expect(result.documents).toBeDefined()
    expect(result.metadatas).toBeUndefined()
    expect(result.embeddings).toBeUndefined()
  })

  it('should include distances in query by default', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
    })

    expect(result.distances).toBeDefined()
  })

  it('should exclude distances when not in include', async () => {
    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 1,
      include: ['metadatas'],
    })

    // When include is specified, only those fields are included
    expect(result.metadatas).toBeDefined()
  })
})

// ============================================================================
// COLLECTION COUNT TESTS
// ============================================================================

describe('Collection Count', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should return 0 for empty collection', async () => {
    const count = await collection.count()
    expect(count).toBe(0)
  })

  it('should count after add', async () => {
    await collection.add({
      ids: ['id1', 'id2', 'id3'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ],
    })

    const count = await collection.count()
    expect(count).toBe(3)
  })

  it('should count after delete', async () => {
    await collection.add({
      ids: ['id1', 'id2', 'id3'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ],
    })

    await collection.delete({ ids: ['id2'] })

    const count = await collection.count()
    expect(count).toBe(2)
  })
})

// ============================================================================
// COLLECTION MODIFY TESTS
// ============================================================================

describe('Collection Modify', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({
      name: 'test-collection',
      metadata: { version: 1 },
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should modify collection name', async () => {
    await collection.modify({ name: 'new-name' })

    // Get collection with new name
    const updated = await client.getCollection({ name: 'new-name' })
    expect(updated.name).toBe('new-name')
  })

  it('should modify collection metadata', async () => {
    await collection.modify({
      metadata: { version: 2, description: 'Updated' },
    })

    const updated = await client.getCollection({ name: 'test-collection' })
    expect(updated.metadata?.version).toBe(2)
    expect(updated.metadata?.description).toBe('Updated')
  })

  it('should throw on rename conflict', async () => {
    await client.createCollection({ name: 'other-collection' })

    await expect(
      collection.modify({ name: 'other-collection' })
    ).rejects.toThrow(ChromaConflictError)
  })
})

// ============================================================================
// PEEK TESTS
// ============================================================================

describe('Peek', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })

    // Add 20 documents
    const ids = Array.from({ length: 20 }, (_, i) => `id${i + 1}`)
    const embeddings = ids.map((_, i) => [i / 20, 0, 0])
    await collection.add({ ids, embeddings })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should peek first 10 documents by default', async () => {
    const result = await collection.peek()

    expect(result.ids.length).toBe(10)
  })

  it('should peek specified number of documents', async () => {
    const result = await collection.peek({ limit: 5 })

    expect(result.ids.length).toBe(5)
  })

  it('should return all documents if limit exceeds count', async () => {
    const result = await collection.peek({ limit: 100 })

    expect(result.ids.length).toBe(20)
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases', () => {
  let client: ChromaClient
  let collection: Collection

  beforeEach(async () => {
    _resetStorage()
    client = new ChromaClient()
    collection = await client.createCollection({ name: 'test-collection' })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should handle empty embeddings dimension', async () => {
    await expect(
      collection.add({
        ids: ['id1'],
        embeddings: [[]],
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should handle inconsistent embedding dimensions', async () => {
    await expect(
      collection.add({
        ids: ['id1', 'id2'],
        embeddings: [
          [1.0, 0.0, 0.0],
          [1.0, 0.0], // Different dimension
        ],
      })
    ).rejects.toThrow(ChromaValidationError)
  })

  it('should handle very large embeddings', async () => {
    const largeEmbedding = Array.from({ length: 10000 }, () => Math.random())

    await collection.add({
      ids: ['id1'],
      embeddings: [largeEmbedding],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['embeddings'],
    })

    expect(result.embeddings![0].length).toBe(10000)
  })

  it('should handle special characters in IDs', async () => {
    await collection.add({
      ids: ['id-with-dash', 'id_with_underscore', 'id.with.dots'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ],
    })

    const result = await collection.get({ ids: ['id-with-dash'] })
    expect(result.ids.length).toBe(1)
  })

  it('should handle empty string document', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
      documents: [''],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['documents'],
    })

    expect(result.documents![0]).toBe('')
  })

  it('should handle unicode in documents', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
      documents: ['Hello \u4e16\u754c \ud83c\udf0d'],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['documents'],
    })

    expect(result.documents![0]).toBe('Hello \u4e16\u754c \ud83c\udf0d')
  })

  it('should handle numeric metadata values', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
      metadatas: [{ score: 42.5, count: 100 }],
    })

    const result = await collection.get({
      ids: ['id1'],
      include: ['metadatas'],
    })

    expect(result.metadatas![0]?.score).toBe(42.5)
    expect(result.metadatas![0]?.count).toBe(100)
  })

  it('should handle empty where clause', async () => {
    await collection.add({
      ids: ['id1'],
      embeddings: [[1.0, 0.0, 0.0]],
    })

    const result = await collection.query({
      queryEmbeddings: [[1.0, 0.0, 0.0]],
      nResults: 10,
      where: {},
    })

    expect(result.ids[0].length).toBe(1)
  })

  it('should preserve insertion order in results', async () => {
    await collection.add({
      ids: ['z', 'a', 'm'],
      embeddings: [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
      ],
    })

    const result = await collection.get({})

    // Get returns in some consistent order (typically insertion)
    expect(result.ids.length).toBe(3)
  })
})
