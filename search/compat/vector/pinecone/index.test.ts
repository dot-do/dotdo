/**
 * @dotdo/pinecone - Pinecone SDK compat tests
 *
 * Tests for Pinecone SDK API compatibility backed by DO:
 * - Pinecone client creation
 * - Index management: createIndex, deleteIndex, listIndexes, describeIndex
 * - Vector operations: upsert, query, fetch, delete, update
 * - Namespace support
 * - Metadata filtering with operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists)
 * - Similarity metrics: cosine, euclidean, dotproduct
 * - Pagination with listPaginated
 * - Index stats
 * - Collection management
 *
 * @see https://docs.pinecone.io/reference/typescript-sdk
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  Pinecone,
  _resetStorage,
  PineconeError,
  PineconeNotFoundError,
  PineconeConflictError,
  PineconeValidationError,
} from './index'
import type {
  PineconeRecord,
  RecordMetadata,
  QueryOptions,
  Metric,
} from './types'

// ============================================================================
// PINECONE CLIENT TESTS
// ============================================================================

describe('Pinecone', () => {
  beforeEach(() => {
    _resetStorage()
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should create client with config', () => {
    const pinecone = new Pinecone({ apiKey: 'test-api-key' })
    expect(pinecone).toBeDefined()
  })

  it('should create client without config (local mode)', () => {
    const pinecone = new Pinecone()
    expect(pinecone).toBeDefined()
  })

  it('should create client with environment', () => {
    const pinecone = new Pinecone({
      apiKey: 'test-api-key',
      environment: 'us-east1-gcp',
    })
    expect(pinecone).toBeDefined()
  })
})

// ============================================================================
// INDEX MANAGEMENT TESTS
// ============================================================================

describe('Index Management', () => {
  let pinecone: Pinecone

  beforeEach(() => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('createIndex', () => {
    it('should create index with required options', async () => {
      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
      })

      expect(index.name).toBe('test-index')
      expect(index.dimension).toBe(128)
      expect(index.metric).toBe('cosine') // default
      expect(index.status.ready).toBe(true)
      expect(index.status.state).toBe('Ready')
    })

    it('should create index with metric', async () => {
      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
        metric: 'euclidean',
      })

      expect(index.metric).toBe('euclidean')
    })

    it('should create index with dotproduct metric', async () => {
      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
        metric: 'dotproduct',
      })

      expect(index.metric).toBe('dotproduct')
    })

    it('should create index with serverless spec', async () => {
      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-west-2',
          },
        },
      })

      expect(index.spec.serverless?.cloud).toBe('aws')
      expect(index.spec.serverless?.region).toBe('us-west-2')
    })

    it('should create index with deletion protection', async () => {
      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
        deletionProtection: 'enabled',
      })

      expect(index.deletionProtection).toBe('enabled')
    })

    it('should throw on duplicate index name', async () => {
      await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
      })

      await expect(
        pinecone.createIndex({
          name: 'test-index',
          dimension: 128,
        })
      ).rejects.toThrow(PineconeConflictError)
    })

    it('should suppress conflict when suppressConflicts is true', async () => {
      await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
      })

      const index = await pinecone.createIndex({
        name: 'test-index',
        dimension: 256, // different dimension
        suppressConflicts: true,
      })

      // Should return existing index
      expect(index.dimension).toBe(128)
    })

    it('should throw on invalid dimension', async () => {
      await expect(
        pinecone.createIndex({
          name: 'test-index',
          dimension: 0,
        })
      ).rejects.toThrow(PineconeValidationError)
    })
  })

  describe('deleteIndex', () => {
    it('should delete an index', async () => {
      await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
      })

      await pinecone.deleteIndex('test-index')

      const list = await pinecone.listIndexes()
      expect(list.indexes?.length ?? 0).toBe(0)
    })

    it('should throw on non-existent index', async () => {
      await expect(pinecone.deleteIndex('non-existent')).rejects.toThrow(
        PineconeNotFoundError
      )
    })

    it('should throw when deletion protection is enabled', async () => {
      await pinecone.createIndex({
        name: 'protected-index',
        dimension: 128,
        deletionProtection: 'enabled',
      })

      await expect(pinecone.deleteIndex('protected-index')).rejects.toThrow(
        PineconeError
      )
    })
  })

  describe('listIndexes', () => {
    it('should list all indexes', async () => {
      await pinecone.createIndex({ name: 'index1', dimension: 128 })
      await pinecone.createIndex({ name: 'index2', dimension: 256 })

      const list = await pinecone.listIndexes()
      expect(list.indexes?.length).toBe(2)
      expect(list.indexes?.map((i) => i.name).sort()).toEqual(['index1', 'index2'])
    })

    it('should return empty list when no indexes', async () => {
      const list = await pinecone.listIndexes()
      expect(list.indexes?.length ?? 0).toBe(0)
    })
  })

  describe('describeIndex', () => {
    it('should describe an index', async () => {
      await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
        metric: 'euclidean',
      })

      const index = await pinecone.describeIndex('test-index')
      expect(index.name).toBe('test-index')
      expect(index.dimension).toBe(128)
      expect(index.metric).toBe('euclidean')
    })

    it('should throw on non-existent index', async () => {
      await expect(pinecone.describeIndex('non-existent')).rejects.toThrow(
        PineconeNotFoundError
      )
    })
  })

  describe('configureIndex', () => {
    it('should configure deletion protection', async () => {
      await pinecone.createIndex({
        name: 'test-index',
        dimension: 128,
      })

      const updated = await pinecone.configureIndex('test-index', {
        deletionProtection: 'enabled',
      })

      expect(updated.deletionProtection).toBe('enabled')
    })

    it('should throw on non-existent index', async () => {
      await expect(
        pinecone.configureIndex('non-existent', {})
      ).rejects.toThrow(PineconeNotFoundError)
    })
  })
})

// ============================================================================
// VECTOR OPERATIONS TESTS
// ============================================================================

describe('Vector Operations', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
      metric: 'cosine',
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('upsert', () => {
    it('should upsert single vector', async () => {
      const index = pinecone.index('test-index')

      const result = await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4] },
      ])

      expect(result.upsertedCount).toBe(1)
    })

    it('should upsert multiple vectors', async () => {
      const index = pinecone.index('test-index')

      const result = await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4] },
        { id: 'vec2', values: [0.5, 0.6, 0.7, 0.8] },
        { id: 'vec3', values: [0.9, 0.1, 0.2, 0.3] },
      ])

      expect(result.upsertedCount).toBe(3)
    })

    it('should upsert vector with metadata', async () => {
      const index = pinecone.index('test-index')

      await index.upsert([
        {
          id: 'vec1',
          values: [0.1, 0.2, 0.3, 0.4],
          metadata: { category: 'test', score: 100 },
        },
      ])

      const fetched = await index.fetch(['vec1'])
      expect(fetched.records['vec1'].metadata?.category).toBe('test')
      expect(fetched.records['vec1'].metadata?.score).toBe(100)
    })

    it('should update existing vector on upsert', async () => {
      const index = pinecone.index('test-index')

      await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4], metadata: { v: 1 } },
      ])

      await index.upsert([
        { id: 'vec1', values: [0.5, 0.6, 0.7, 0.8], metadata: { v: 2 } },
      ])

      const fetched = await index.fetch(['vec1'])
      expect(fetched.records['vec1'].values).toEqual([0.5, 0.6, 0.7, 0.8])
      expect(fetched.records['vec1'].metadata?.v).toBe(2)
    })

    it('should throw on dimension mismatch', async () => {
      const index = pinecone.index('test-index')

      await expect(
        index.upsert([{ id: 'vec1', values: [0.1, 0.2] }]) // wrong dimension
      ).rejects.toThrow(PineconeValidationError)
    })

    it('should upsert to namespace', async () => {
      const index = pinecone.index('test-index')
      const ns = index.namespace('my-namespace')

      await ns.upsert([{ id: 'vec1', values: [0.1, 0.2, 0.3, 0.4] }])

      const stats = await index.describeIndexStats()
      expect(stats.namespaces['my-namespace'].vectorCount).toBe(1)
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      const index = pinecone.index('test-index')
      await index.upsert([
        { id: 'vec1', values: [1, 0, 0, 0], metadata: { category: 'A' } },
        { id: 'vec2', values: [0, 1, 0, 0], metadata: { category: 'B' } },
        { id: 'vec3', values: [0, 0, 1, 0], metadata: { category: 'A' } },
        { id: 'vec4', values: [0, 0, 0, 1], metadata: { category: 'B' } },
        { id: 'vec5', values: [0.7, 0.7, 0, 0], metadata: { category: 'A' } },
      ])
    })

    it('should query by vector', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 3,
      })

      expect(result.matches.length).toBe(3)
      expect(result.matches[0].id).toBe('vec1') // exact match
      expect(result.matches[0].score).toBeCloseTo(1)
    })

    it('should respect topK limit', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 2,
      })

      expect(result.matches.length).toBe(2)
    })

    it('should include values when requested', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 1,
        includeValues: true,
      })

      expect(result.matches[0].values).toEqual([1, 0, 0, 0])
    })

    it('should include metadata when requested', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 1,
        includeMetadata: true,
      })

      expect(result.matches[0].metadata).toBeDefined()
      expect(result.matches[0].metadata?.category).toBe('A')
    })

    it('should query by ID', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        id: 'vec1',
        topK: 3,
      })

      expect(result.matches[0].id).toBe('vec1')
      expect(result.matches.length).toBe(3)
    })

    it('should return empty for non-existent ID', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        id: 'non-existent',
        topK: 3,
      })

      expect(result.matches.length).toBe(0)
    })

    it('should filter by metadata', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { category: 'A' },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(3) // vec1, vec3, vec5
      expect(result.matches.every((m) => m.metadata?.category === 'A')).toBe(true)
    })

    it('should return namespace', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 1,
      })

      expect(result.namespace).toBe('')
    })

    it('should query in namespace', async () => {
      const index = pinecone.index('test-index')
      const ns = index.namespace('my-ns')

      await ns.upsert([
        { id: 'ns-vec1', values: [1, 0, 0, 0] },
        { id: 'ns-vec2', values: [0, 1, 0, 0] },
      ])

      const result = await ns.query({
        vector: [1, 0, 0, 0],
        topK: 10,
      })

      expect(result.namespace).toBe('my-ns')
      expect(result.matches.length).toBe(2)
      expect(result.matches.every((m) => m.id.startsWith('ns-'))).toBe(true)
    })
  })

  describe('fetch', () => {
    beforeEach(async () => {
      const index = pinecone.index('test-index')
      await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4], metadata: { a: 1 } },
        { id: 'vec2', values: [0.5, 0.6, 0.7, 0.8], metadata: { b: 2 } },
      ])
    })

    it('should fetch single vector', async () => {
      const index = pinecone.index('test-index')

      const result = await index.fetch(['vec1'])

      expect(result.records['vec1']).toBeDefined()
      expect(result.records['vec1'].id).toBe('vec1')
      expect(result.records['vec1'].values).toEqual([0.1, 0.2, 0.3, 0.4])
    })

    it('should fetch multiple vectors', async () => {
      const index = pinecone.index('test-index')

      const result = await index.fetch(['vec1', 'vec2'])

      expect(Object.keys(result.records).length).toBe(2)
      expect(result.records['vec1']).toBeDefined()
      expect(result.records['vec2']).toBeDefined()
    })

    it('should skip non-existent IDs', async () => {
      const index = pinecone.index('test-index')

      const result = await index.fetch(['vec1', 'non-existent', 'vec2'])

      expect(Object.keys(result.records).length).toBe(2)
      expect(result.records['non-existent']).toBeUndefined()
    })

    it('should include metadata', async () => {
      const index = pinecone.index('test-index')

      const result = await index.fetch(['vec1'])

      expect(result.records['vec1'].metadata).toEqual({ a: 1 })
    })
  })

  describe('delete', () => {
    beforeEach(async () => {
      const index = pinecone.index('test-index')
      await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4], metadata: { cat: 'A' } },
        { id: 'vec2', values: [0.5, 0.6, 0.7, 0.8], metadata: { cat: 'B' } },
        { id: 'vec3', values: [0.9, 0.1, 0.2, 0.3], metadata: { cat: 'A' } },
      ])
    })

    it('should delete by IDs', async () => {
      const index = pinecone.index('test-index')

      await index.delete({ ids: ['vec1', 'vec2'] })

      const fetched = await index.fetch(['vec1', 'vec2', 'vec3'])
      expect(fetched.records['vec1']).toBeUndefined()
      expect(fetched.records['vec2']).toBeUndefined()
      expect(fetched.records['vec3']).toBeDefined()
    })

    it('should delete all', async () => {
      const index = pinecone.index('test-index')

      await index.delete({ deleteAll: true })

      const stats = await index.describeIndexStats()
      expect(stats.totalVectorCount).toBe(0)
    })

    it('should delete by filter', async () => {
      const index = pinecone.index('test-index')

      await index.delete({ filter: { cat: 'A' } })

      const fetched = await index.fetch(['vec1', 'vec2', 'vec3'])
      expect(fetched.records['vec1']).toBeUndefined()
      expect(fetched.records['vec2']).toBeDefined()
      expect(fetched.records['vec3']).toBeUndefined()
    })

    it('should deleteOne', async () => {
      const index = pinecone.index('test-index')

      await index.deleteOne('vec1')

      const fetched = await index.fetch(['vec1'])
      expect(fetched.records['vec1']).toBeUndefined()
    })

    it('should deleteMany', async () => {
      const index = pinecone.index('test-index')

      await index.deleteMany(['vec1', 'vec3'])

      const fetched = await index.fetch(['vec1', 'vec2', 'vec3'])
      expect(fetched.records['vec1']).toBeUndefined()
      expect(fetched.records['vec2']).toBeDefined()
      expect(fetched.records['vec3']).toBeUndefined()
    })

    it('should deleteAll convenience method', async () => {
      const index = pinecone.index('test-index')

      await index.deleteAll()

      const stats = await index.describeIndexStats()
      expect(stats.totalVectorCount).toBe(0)
    })
  })

  describe('update', () => {
    beforeEach(async () => {
      const index = pinecone.index('test-index')
      await index.upsert([
        { id: 'vec1', values: [0.1, 0.2, 0.3, 0.4], metadata: { a: 1, b: 2 } },
      ])
    })

    it('should update values', async () => {
      const index = pinecone.index('test-index')

      await index.update({
        id: 'vec1',
        values: [0.5, 0.6, 0.7, 0.8],
      })

      const fetched = await index.fetch(['vec1'])
      expect(fetched.records['vec1'].values).toEqual([0.5, 0.6, 0.7, 0.8])
    })

    it('should update metadata', async () => {
      const index = pinecone.index('test-index')

      await index.update({
        id: 'vec1',
        metadata: { c: 3 },
      })

      const fetched = await index.fetch(['vec1'])
      expect(fetched.records['vec1'].metadata).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('should throw on non-existent vector', async () => {
      const index = pinecone.index('test-index')

      await expect(
        index.update({ id: 'non-existent', values: [0.1, 0.2, 0.3, 0.4] })
      ).rejects.toThrow(PineconeNotFoundError)
    })

    it('should throw on dimension mismatch', async () => {
      const index = pinecone.index('test-index')

      await expect(
        index.update({ id: 'vec1', values: [0.1, 0.2] })
      ).rejects.toThrow(PineconeValidationError)
    })
  })
})

// ============================================================================
// METADATA FILTERING TESTS
// ============================================================================

describe('Metadata Filtering', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })

    const index = pinecone.index('test-index')
    await index.upsert([
      { id: 'v1', values: [1, 0, 0, 0], metadata: { name: 'Alice', age: 30, tags: ['a', 'b'] } },
      { id: 'v2', values: [0, 1, 0, 0], metadata: { name: 'Bob', age: 25, tags: ['b', 'c'] } },
      { id: 'v3', values: [0, 0, 1, 0], metadata: { name: 'Charlie', age: 35, tags: ['a'] } },
      { id: 'v4', values: [0, 0, 0, 1], metadata: { name: 'Diana', age: 28 } },
      { id: 'v5', values: [0.5, 0.5, 0, 0], metadata: { name: 'Eve', age: 30, active: true } },
    ])
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('comparison operators', () => {
    it('should filter with $eq', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { name: { $eq: 'Alice' } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(1)
      expect(result.matches[0].metadata?.name).toBe('Alice')
    })

    it('should filter with direct equality (implicit $eq)', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { name: 'Bob' },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(1)
      expect(result.matches[0].metadata?.name).toBe('Bob')
    })

    it('should filter with $ne', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { name: { $ne: 'Alice' } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(4)
      expect(result.matches.every((m) => m.metadata?.name !== 'Alice')).toBe(true)
    })

    it('should filter with $gt', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { age: { $gt: 28 } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(3) // Alice (30), Charlie (35), Eve (30)
    })

    it('should filter with $gte', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { age: { $gte: 30 } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(3) // Alice, Charlie, Eve
    })

    it('should filter with $lt', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { age: { $lt: 28 } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(1) // Bob
    })

    it('should filter with $lte', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { age: { $lte: 28 } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(2) // Bob, Diana
    })

    it('should filter with $in', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { name: { $in: ['Alice', 'Bob'] } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(2)
    })

    it('should filter with $nin', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { name: { $nin: ['Alice', 'Bob', 'Charlie'] } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(2) // Diana, Eve
    })

    it('should filter with $exists: true', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { active: { $exists: true } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(1)
      expect(result.matches[0].metadata?.name).toBe('Eve')
    })

    it('should filter with $exists: false', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: { active: { $exists: false } },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(4)
    })
  })

  describe('logical operators', () => {
    it('should filter with $and', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: {
          $and: [{ age: { $gte: 28 } }, { age: { $lt: 35 } }],
        },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(3) // Alice (30), Diana (28), Eve (30)
    })

    it('should filter with $or', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }],
        },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(2)
    })

    it('should combine multiple field filters (implicit $and)', async () => {
      const index = pinecone.index('test-index')

      const result = await index.query({
        vector: [1, 0, 0, 0],
        topK: 10,
        filter: {
          age: { $gte: 30 },
          name: { $ne: 'Charlie' },
        },
        includeMetadata: true,
      })

      expect(result.matches.length).toBe(2) // Alice, Eve (not Charlie)
    })
  })
})

// ============================================================================
// SIMILARITY METRICS TESTS
// ============================================================================

describe('Similarity Metrics', () => {
  let pinecone: Pinecone

  beforeEach(() => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
  })

  afterEach(() => {
    _resetStorage()
  })

  describe('cosine similarity', () => {
    it('should rank by cosine similarity', async () => {
      await pinecone.createIndex({
        name: 'cosine-index',
        dimension: 3,
        metric: 'cosine',
      })

      const index = pinecone.index('cosine-index')
      await index.upsert([
        { id: 'same', values: [1, 0, 0] },
        { id: 'similar', values: [0.9, 0.1, 0] },
        { id: 'different', values: [0, 1, 0] },
      ])

      const result = await index.query({
        vector: [1, 0, 0],
        topK: 3,
      })

      expect(result.matches[0].id).toBe('same')
      expect(result.matches[0].score).toBeCloseTo(1)
      expect(result.matches[1].id).toBe('similar')
      expect(result.matches[2].id).toBe('different')
      expect(result.matches[2].score).toBeCloseTo(0)
    })
  })

  describe('euclidean similarity', () => {
    it('should rank by euclidean distance', async () => {
      await pinecone.createIndex({
        name: 'euclidean-index',
        dimension: 3,
        metric: 'euclidean',
      })

      const index = pinecone.index('euclidean-index')
      await index.upsert([
        { id: 'same', values: [1, 0, 0] },
        { id: 'close', values: [1.1, 0.1, 0] },
        { id: 'far', values: [0, 0, 10] },
      ])

      const result = await index.query({
        vector: [1, 0, 0],
        topK: 3,
      })

      expect(result.matches[0].id).toBe('same')
      expect(result.matches[1].id).toBe('close')
      expect(result.matches[2].id).toBe('far')
    })
  })

  describe('dot product', () => {
    it('should rank by dot product', async () => {
      await pinecone.createIndex({
        name: 'dotproduct-index',
        dimension: 3,
        metric: 'dotproduct',
      })

      const index = pinecone.index('dotproduct-index')
      await index.upsert([
        { id: 'large', values: [2, 0, 0] },
        { id: 'medium', values: [1, 0, 0] },
        { id: 'small', values: [0.5, 0, 0] },
      ])

      const result = await index.query({
        vector: [1, 0, 0],
        topK: 3,
      })

      // Dot product: large(2), medium(1), small(0.5)
      expect(result.matches[0].id).toBe('large')
      expect(result.matches[0].score).toBeCloseTo(2)
      expect(result.matches[1].id).toBe('medium')
      expect(result.matches[1].score).toBeCloseTo(1)
      expect(result.matches[2].id).toBe('small')
      expect(result.matches[2].score).toBeCloseTo(0.5)
    })
  })
})

// ============================================================================
// NAMESPACE TESTS
// ============================================================================

describe('Namespaces', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should isolate vectors by namespace', async () => {
    const index = pinecone.index('test-index')
    const ns1 = index.namespace('ns1')
    const ns2 = index.namespace('ns2')

    await ns1.upsert([{ id: 'vec1', values: [1, 0, 0, 0] }])
    await ns2.upsert([{ id: 'vec2', values: [0, 1, 0, 0] }])

    const result1 = await ns1.query({ vector: [1, 0, 0, 0], topK: 10 })
    expect(result1.matches.length).toBe(1)
    expect(result1.matches[0].id).toBe('vec1')

    const result2 = await ns2.query({ vector: [1, 0, 0, 0], topK: 10 })
    expect(result2.matches.length).toBe(1)
    expect(result2.matches[0].id).toBe('vec2')
  })

  it('should report stats per namespace', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([{ id: 'default-vec', values: [1, 0, 0, 0] }])
    await index.namespace('ns1').upsert([
      { id: 'ns1-vec1', values: [1, 0, 0, 0] },
      { id: 'ns1-vec2', values: [0, 1, 0, 0] },
    ])
    await index.namespace('ns2').upsert([{ id: 'ns2-vec1', values: [0, 0, 1, 0] }])

    const stats = await index.describeIndexStats()

    expect(stats.namespaces['']).toEqual({ vectorCount: 1 })
    expect(stats.namespaces['ns1']).toEqual({ vectorCount: 2 })
    expect(stats.namespaces['ns2']).toEqual({ vectorCount: 1 })
    expect(stats.totalVectorCount).toBe(4)
  })

  it('should delete only from specified namespace', async () => {
    const index = pinecone.index('test-index')
    const ns1 = index.namespace('ns1')
    const ns2 = index.namespace('ns2')

    await ns1.upsert([{ id: 'vec1', values: [1, 0, 0, 0] }])
    await ns2.upsert([{ id: 'vec1', values: [0, 1, 0, 0] }]) // same ID, different namespace

    await ns1.deleteAll()

    const stats = await index.describeIndexStats()
    expect(stats.namespaces['ns1']?.vectorCount ?? 0).toBe(0)
    expect(stats.namespaces['ns2'].vectorCount).toBe(1)
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('Pagination', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })

    const index = pinecone.index('test-index')
    const vectors = []
    for (let i = 0; i < 50; i++) {
      vectors.push({
        id: `vec-${String(i).padStart(3, '0')}`,
        values: [i / 50, 0, 0, 0],
      })
    }
    await index.upsert(vectors)
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should paginate with limit', async () => {
    const index = pinecone.index('test-index')

    const result = await index.listPaginated({ limit: 10 })

    expect(result.vectors?.length).toBe(10)
    expect(result.pagination?.next).toBeDefined()
  })

  it('should paginate with token', async () => {
    const index = pinecone.index('test-index')

    const page1 = await index.listPaginated({ limit: 10 })
    const page2 = await index.listPaginated({
      limit: 10,
      paginationToken: page1.pagination?.next,
    })

    expect(page2.vectors?.length).toBe(10)
    expect(page2.vectors?.[0].id).not.toBe(page1.vectors?.[0].id)
  })

  it('should filter by prefix', async () => {
    const index = pinecone.index('test-index')

    // Add some vectors with different prefix
    await index.upsert([
      { id: 'other-1', values: [0, 0, 0, 1] },
      { id: 'other-2', values: [0, 0, 1, 0] },
    ])

    const result = await index.listPaginated({ prefix: 'vec-' })

    expect(result.vectors?.every((v) => v.id.startsWith('vec-'))).toBe(true)
    expect(result.vectors?.length).toBe(50)
  })

  it('should return no pagination when all fetched', async () => {
    const index = pinecone.index('test-index')

    const result = await index.listPaginated({ limit: 100 })

    expect(result.pagination?.next).toBeUndefined()
  })
})

// ============================================================================
// INDEX STATS TESTS
// ============================================================================

describe('Index Stats', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should return correct dimension', async () => {
    const index = pinecone.index('test-index')
    const stats = await index.describeIndexStats()

    expect(stats.dimension).toBe(4)
  })

  it('should count total vectors', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0] },
      { id: 'vec2', values: [0, 1, 0, 0] },
    ])

    const stats = await index.describeIndexStats()
    expect(stats.totalVectorCount).toBe(2)
  })

  it('should filter stats by metadata', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0], metadata: { category: 'A' } },
      { id: 'vec2', values: [0, 1, 0, 0], metadata: { category: 'B' } },
      { id: 'vec3', values: [0, 0, 1, 0], metadata: { category: 'A' } },
    ])

    const stats = await index.describeIndexStats({ category: 'A' })
    expect(stats.totalVectorCount).toBe(2)
  })
})

// ============================================================================
// COLLECTION TESTS
// ============================================================================

describe('Collections', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'source-index',
      dimension: 4,
    })

    const index = pinecone.index('source-index')
    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0] },
      { id: 'vec2', values: [0, 1, 0, 0] },
    ])
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should create collection from index', async () => {
    const collection = await pinecone.createCollection({
      name: 'my-collection',
      source: 'source-index',
    })

    expect(collection.name).toBe('my-collection')
    expect(collection.dimension).toBe(4)
    expect(collection.vectorCount).toBe(2)
    expect(collection.status).toBe('Ready')
  })

  it('should list collections', async () => {
    await pinecone.createCollection({ name: 'col1', source: 'source-index' })
    await pinecone.createCollection({ name: 'col2', source: 'source-index' })

    const list = await pinecone.listCollections()

    expect(list.collections?.length).toBe(2)
  })

  it('should describe collection', async () => {
    await pinecone.createCollection({ name: 'my-collection', source: 'source-index' })

    const collection = await pinecone.describeCollection('my-collection')

    expect(collection.name).toBe('my-collection')
    expect(collection.dimension).toBe(4)
  })

  it('should delete collection', async () => {
    await pinecone.createCollection({ name: 'my-collection', source: 'source-index' })

    await pinecone.deleteCollection('my-collection')

    const list = await pinecone.listCollections()
    expect(list.collections?.length ?? 0).toBe(0)
  })

  it('should throw on duplicate collection', async () => {
    await pinecone.createCollection({ name: 'my-collection', source: 'source-index' })

    await expect(
      pinecone.createCollection({ name: 'my-collection', source: 'source-index' })
    ).rejects.toThrow(PineconeConflictError)
  })

  it('should throw on non-existent source index', async () => {
    await expect(
      pinecone.createCollection({ name: 'my-collection', source: 'non-existent' })
    ).rejects.toThrow(PineconeNotFoundError)
  })

  it('should throw when deleting non-existent collection', async () => {
    await expect(pinecone.deleteCollection('non-existent')).rejects.toThrow(
      PineconeNotFoundError
    )
  })

  it('should throw when describing non-existent collection', async () => {
    await expect(pinecone.describeCollection('non-existent')).rejects.toThrow(
      PineconeNotFoundError
    )
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let pinecone: Pinecone

  beforeEach(() => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should throw PineconeNotFoundError for missing index', () => {
    expect(() => pinecone.index('non-existent')).toThrow(PineconeNotFoundError)
  })

  it('should throw PineconeValidationError for query without vector or id', async () => {
    await pinecone.createIndex({ name: 'test-index', dimension: 4 })
    const index = pinecone.index('test-index')

    await expect(
      index.query({ topK: 10 })
    ).rejects.toThrow(PineconeValidationError)
  })
})

// ============================================================================
// SPARSE VECTORS TESTS
// ============================================================================

describe('Sparse Vectors', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should upsert with sparse values', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      {
        id: 'vec1',
        values: [1, 0, 0, 0],
        sparseValues: {
          indices: [0, 5, 10],
          values: [0.5, 0.3, 0.2],
        },
      },
    ])

    const fetched = await index.fetch(['vec1'])
    expect(fetched.records['vec1'].sparseValues?.indices).toEqual([0, 5, 10])
    expect(fetched.records['vec1'].sparseValues?.values).toEqual([0.5, 0.3, 0.2])
  })

  it('should return sparse values in query when includeValues is true', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      {
        id: 'vec1',
        values: [1, 0, 0, 0],
        sparseValues: {
          indices: [0, 5],
          values: [0.5, 0.3],
        },
      },
    ])

    const result = await index.query({
      vector: [1, 0, 0, 0],
      topK: 1,
      includeValues: true,
    })

    expect(result.matches[0].sparseValues).toBeDefined()
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let pinecone: Pinecone

  beforeEach(async () => {
    _resetStorage()
    pinecone = new Pinecone({ apiKey: 'test-api-key' })
    await pinecone.createIndex({
      name: 'test-index',
      dimension: 4,
    })
  })

  afterEach(() => {
    _resetStorage()
  })

  it('should handle empty query results', async () => {
    const index = pinecone.index('test-index')

    const result = await index.query({
      vector: [1, 0, 0, 0],
      topK: 10,
    })

    expect(result.matches).toEqual([])
  })

  it('should handle fetch with no IDs', async () => {
    const index = pinecone.index('test-index')

    const result = await index.fetch([])

    expect(Object.keys(result.records).length).toBe(0)
  })

  it('should handle delete with empty options', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([{ id: 'vec1', values: [1, 0, 0, 0] }])

    // Delete with no options should do nothing
    await index.delete({})

    const stats = await index.describeIndexStats()
    expect(stats.totalVectorCount).toBe(1)
  })

  it('should handle null metadata values', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0], metadata: { value: null } },
    ])

    const fetched = await index.fetch(['vec1'])
    expect(fetched.records['vec1'].metadata?.value).toBeNull()
  })

  it('should handle array metadata values', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0], metadata: { tags: ['a', 'b', 'c'] } },
    ])

    const fetched = await index.fetch(['vec1'])
    expect(fetched.records['vec1'].metadata?.tags).toEqual(['a', 'b', 'c'])
  })

  it('should handle boolean metadata values', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0], metadata: { active: true, archived: false } },
    ])

    const result = await index.query({
      vector: [1, 0, 0, 0],
      topK: 1,
      filter: { active: true },
      includeMetadata: true,
    })

    expect(result.matches.length).toBe(1)
  })

  it('should handle very small similarity scores', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([
      { id: 'vec1', values: [1, 0, 0, 0] },
      { id: 'vec2', values: [0, 1, 0, 0] },
    ])

    // Orthogonal vectors should have 0 cosine similarity
    const result = await index.query({
      vector: [1, 0, 0, 0],
      topK: 10,
    })

    const vec2Match = result.matches.find((m) => m.id === 'vec2')
    expect(vec2Match?.score).toBeCloseTo(0, 5)
  })

  it('should handle query with topK greater than vector count', async () => {
    const index = pinecone.index('test-index')

    await index.upsert([{ id: 'vec1', values: [1, 0, 0, 0] }])

    const result = await index.query({
      vector: [1, 0, 0, 0],
      topK: 100,
    })

    expect(result.matches.length).toBe(1)
  })
})
