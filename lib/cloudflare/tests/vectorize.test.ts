/**
 * Vectorize Integration Layer Tests
 *
 * Comprehensive tests for the Vectorize integration including:
 * - Vector insertion and upsert
 * - Similarity search queries
 * - Metadata filtering
 * - Batch operations
 * - Namespace support
 * - Semantic search (with AI integration)
 * - Error handling
 *
 * @module lib/cloudflare/tests/vectorize.test
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'

// Import the module under test
import {
  VectorizeClient,
  createVectorizeClient,
  createNamespacedVectorizeClient,
  createSemanticSearchClient,
  VectorizeEnv,
  VectorizeConfig,
  Vector,
  QueryOptions,
  QueryResult,
  MutationResult,
  MetadataFilter,
} from '../vectorize'

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockVectorizeIndex = () => ({
  insert: vi.fn(),
  upsert: vi.fn(),
  deleteByIds: vi.fn(),
  query: vi.fn(),
  getByIds: vi.fn(),
  describe: vi.fn(),
})

const createMockAIBinding = () => ({
  run: vi.fn(),
})

const createMockEnv = (overrides: Partial<VectorizeEnv> = {}): VectorizeEnv => ({
  VECTORS: createMockVectorizeIndex() as unknown as VectorizeIndex,
  AI: createMockAIBinding() as unknown as Ai,
  ...overrides,
})

const createTestVectors = (count: number, prefix = 'doc'): Vector[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    values: [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)],
    metadata: { title: `Document ${i + 1}`, index: i + 1 },
  }))
}

// ============================================================================
// VectorizeClient Instantiation Tests
// ============================================================================

describe('VectorizeClient instantiation', () => {
  it('creates instance with VECTORS binding', () => {
    const env = createMockEnv()
    const client = new VectorizeClient(env)
    expect(client).toBeInstanceOf(VectorizeClient)
  })

  it('creates instance with optional config', () => {
    const env = createMockEnv()
    const config: VectorizeConfig = {
      namespace: 'test-namespace',
      defaultTopK: 20,
      returnValues: true,
      returnMetadata: 'all',
      batchSize: 500,
    }
    const client = new VectorizeClient(env, config)
    expect(client).toBeInstanceOf(VectorizeClient)
  })

  it('throws error when VECTORS binding is not available', () => {
    const env = createMockEnv({ VECTORS: undefined })
    expect(() => new VectorizeClient(env)).toThrow('Vectorize binding (VECTORS) is required')
  })

  it('creates instance without AI binding', () => {
    const env = createMockEnv({ AI: undefined })
    const client = new VectorizeClient(env)
    expect(client).toBeInstanceOf(VectorizeClient)
  })
})

// ============================================================================
// Insert Tests
// ============================================================================

describe('VectorizeClient.insert', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { insert: Mock }).insert.mockResolvedValue({
      ids: ['doc-1', 'doc-2'],
      count: 2,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('inserts vectors successfully', async () => {
    const vectors = createTestVectors(2)
    const result = await client.insert(vectors)

    expect(result.count).toBe(2)
    expect(result.ids).toEqual(['doc-1', 'doc-2'])
    expect((mockEnv.VECTORS as unknown as { insert: Mock }).insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doc-1' }),
        expect.objectContaining({ id: 'doc-2' }),
      ])
    )
  })

  it('returns empty result for empty input', async () => {
    const result = await client.insert([])

    expect(result.count).toBe(0)
    expect(result.ids).toEqual([])
    expect((mockEnv.VECTORS as unknown as { insert: Mock }).insert).not.toHaveBeenCalled()
  })

  it('validates vector IDs', async () => {
    const vectors = [{ id: '', values: [0.1, 0.2] }]

    await expect(client.insert(vectors)).rejects.toThrow('Vector ID must be a non-empty string')
  })

  it('validates vector values', async () => {
    const vectors = [{ id: 'test', values: [] }]

    await expect(client.insert(vectors)).rejects.toThrow('Vector test values cannot be empty')
  })

  it('validates vector values are numbers', async () => {
    const vectors = [{ id: 'test', values: [0.1, 'invalid' as unknown as number] }]

    await expect(client.insert(vectors)).rejects.toThrow('Vector test values must be finite numbers')
  })

  it('handles batch processing for large inserts', async () => {
    const mockIndex = mockEnv.VECTORS as unknown as { insert: Mock }
    mockIndex.insert
      .mockResolvedValueOnce({ ids: Array.from({ length: 100 }, (_, i) => `doc-${i + 1}`), count: 100 })
      .mockResolvedValueOnce({ ids: Array.from({ length: 50 }, (_, i) => `doc-${i + 101}`), count: 50 })

    const client = new VectorizeClient(mockEnv, { batchSize: 100 })
    const vectors = createTestVectors(150)

    const result = await client.insert(vectors)

    expect(result.count).toBe(150)
    expect(mockIndex.insert).toHaveBeenCalledTimes(2)
  })

  it('includes namespace in vectors', async () => {
    const client = new VectorizeClient(mockEnv, { namespace: 'test-ns' })
    const vectors = createTestVectors(1)

    await client.insert(vectors)

    expect((mockEnv.VECTORS as unknown as { insert: Mock }).insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ namespace: 'test-ns' }),
      ])
    )
  })

  it('preserves vector-level namespace over default', async () => {
    const client = new VectorizeClient(mockEnv, { namespace: 'default-ns' })
    const vectors = [{ id: 'doc-1', values: [0.1], namespace: 'custom-ns' }]

    await client.insert(vectors)

    expect((mockEnv.VECTORS as unknown as { insert: Mock }).insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ namespace: 'custom-ns' }),
      ])
    )
  })
})

// ============================================================================
// Upsert Tests
// ============================================================================

describe('VectorizeClient.upsert', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { upsert: Mock }).upsert.mockResolvedValue({
      ids: ['doc-1', 'doc-2'],
      count: 2,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('upserts vectors successfully', async () => {
    const vectors = createTestVectors(2)
    const result = await client.upsert(vectors)

    expect(result.count).toBe(2)
    expect(result.ids).toEqual(['doc-1', 'doc-2'])
    expect((mockEnv.VECTORS as unknown as { upsert: Mock }).upsert).toHaveBeenCalled()
  })

  it('returns empty result for empty input', async () => {
    const result = await client.upsert([])

    expect(result.count).toBe(0)
    expect(result.ids).toEqual([])
  })

  it('validates vectors before upsert', async () => {
    const vectors = [{ id: '', values: [0.1] }]

    await expect(client.upsert(vectors)).rejects.toThrow('Vector ID must be a non-empty string')
  })
})

// ============================================================================
// Delete Tests
// ============================================================================

describe('VectorizeClient.delete', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { deleteByIds: Mock }).deleteByIds.mockResolvedValue({
      ids: ['doc-1', 'doc-2'],
      count: 2,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('deletes vectors by ID', async () => {
    const result = await client.delete(['doc-1', 'doc-2'])

    expect(result.count).toBe(2)
    expect(result.ids).toEqual(['doc-1', 'doc-2'])
    expect((mockEnv.VECTORS as unknown as { deleteByIds: Mock }).deleteByIds).toHaveBeenCalledWith([
      'doc-1',
      'doc-2',
    ])
  })

  it('returns empty result for empty input', async () => {
    const result = await client.delete([])

    expect(result.count).toBe(0)
    expect(result.ids).toEqual([])
    expect((mockEnv.VECTORS as unknown as { deleteByIds: Mock }).deleteByIds).not.toHaveBeenCalled()
  })

  it('validates IDs are non-empty strings', async () => {
    await expect(client.delete(['valid', ''])).rejects.toThrow(
      'Vector IDs must be non-empty strings'
    )
  })

  it('handles batch deletion', async () => {
    const mockIndex = mockEnv.VECTORS as unknown as { deleteByIds: Mock }
    mockIndex.deleteByIds
      .mockResolvedValueOnce({ ids: Array.from({ length: 100 }, (_, i) => `doc-${i + 1}`), count: 100 })
      .mockResolvedValueOnce({ ids: Array.from({ length: 50 }, (_, i) => `doc-${i + 101}`), count: 50 })

    const client = new VectorizeClient(mockEnv, { batchSize: 100 })
    const ids = Array.from({ length: 150 }, (_, i) => `doc-${i + 1}`)

    const result = await client.delete(ids)

    expect(result.count).toBe(150)
    expect(mockIndex.deleteByIds).toHaveBeenCalledTimes(2)
  })
})

// ============================================================================
// Query Tests
// ============================================================================

describe('VectorizeClient.query', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockResolvedValue({
      matches: [
        { id: 'doc-1', score: 0.95, values: [0.1, 0.2], metadata: { title: 'Doc 1' } },
        { id: 'doc-2', score: 0.85, values: [0.3, 0.4], metadata: { title: 'Doc 2' } },
      ],
      count: 2,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('queries for similar vectors', async () => {
    const result = await client.query([0.1, 0.2, 0.3])

    expect(result.count).toBe(2)
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].id).toBe('doc-1')
    expect(result.matches[0].score).toBe(0.95)
  })

  it('passes query options', async () => {
    const options: QueryOptions = {
      topK: 20,
      namespace: 'test-ns',
      returnValues: true,
      returnMetadata: 'all',
    }

    await client.query([0.1, 0.2], options)

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        topK: 20,
        namespace: 'test-ns',
        returnValues: true,
        returnMetadata: 'all',
      })
    )
  })

  it('uses default options from config', async () => {
    const client = new VectorizeClient(mockEnv, {
      defaultTopK: 15,
      namespace: 'default-ns',
      returnValues: true,
      returnMetadata: 'indexed',
    })

    await client.query([0.1, 0.2])

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        topK: 15,
        namespace: 'default-ns',
        returnValues: true,
        returnMetadata: 'indexed',
      })
    )
  })

  it('applies metadata filter', async () => {
    const filter: MetadataFilter = {
      category: 'articles',
      score: { $gte: 0.8 },
    }

    await client.query([0.1, 0.2], { filter })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: {
          category: 'articles',
          score: { $gte: 0.8 },
        },
      })
    )
  })

  it('throws error for empty query vector', async () => {
    await expect(client.query([])).rejects.toThrow('Query vector cannot be empty')
  })

  it('validates query vector values', async () => {
    await expect(client.query([0.1, NaN, 0.3])).rejects.toThrow(
      'Vector values must be finite numbers'
    )
  })

  it('accepts Float32Array as query vector', async () => {
    const floatArray = new Float32Array([0.1, 0.2, 0.3])
    await client.query(floatArray)

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      floatArray,
      expect.any(Object)
    )
  })

  it('returns values and metadata when requested', async () => {
    const result = await client.query([0.1, 0.2], {
      returnValues: true,
      returnMetadata: true,
    })

    expect(result.matches[0].values).toEqual([0.1, 0.2])
    expect(result.matches[0].metadata).toEqual({ title: 'Doc 1' })
  })
})

// ============================================================================
// GetByIds Tests
// ============================================================================

describe('VectorizeClient.getByIds', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { getByIds: Mock }).getByIds.mockResolvedValue([
      { id: 'doc-1', values: [0.1, 0.2], metadata: { title: 'Doc 1' } },
      { id: 'doc-2', values: [0.3, 0.4], metadata: { title: 'Doc 2' } },
    ])
    client = new VectorizeClient(mockEnv)
  })

  it('retrieves vectors by ID', async () => {
    const vectors = await client.getByIds(['doc-1', 'doc-2'])

    expect(vectors).toHaveLength(2)
    expect(vectors[0].id).toBe('doc-1')
    expect(vectors[0].values).toEqual([0.1, 0.2])
    expect(vectors[0].metadata).toEqual({ title: 'Doc 1' })
  })

  it('returns empty array for empty input', async () => {
    const vectors = await client.getByIds([])

    expect(vectors).toEqual([])
    expect((mockEnv.VECTORS as unknown as { getByIds: Mock }).getByIds).not.toHaveBeenCalled()
  })

  it('validates IDs are non-empty strings', async () => {
    await expect(client.getByIds(['valid', ''])).rejects.toThrow(
      'Vector IDs must be non-empty strings'
    )
  })

  it('handles batch retrieval', async () => {
    const mockIndex = mockEnv.VECTORS as unknown as { getByIds: Mock }
    mockIndex.getByIds
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i + 1}`,
        values: [0.1],
      })))
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i + 101}`,
        values: [0.2],
      })))

    const client = new VectorizeClient(mockEnv, { batchSize: 100 })
    const ids = Array.from({ length: 150 }, (_, i) => `doc-${i + 1}`)

    const vectors = await client.getByIds(ids)

    expect(vectors).toHaveLength(150)
    expect(mockIndex.getByIds).toHaveBeenCalledTimes(2)
  })

  it('converts Float32Array values to number array', async () => {
    ;(mockEnv.VECTORS as unknown as { getByIds: Mock }).getByIds.mockResolvedValue([
      { id: 'doc-1', values: new Float32Array([0.1, 0.2]) },
    ])

    const vectors = await client.getByIds(['doc-1'])

    expect(Array.isArray(vectors[0].values)).toBe(true)
    expect(vectors[0].values).toEqual([expect.any(Number), expect.any(Number)])
  })
})

// ============================================================================
// Semantic Search Tests
// ============================================================================

describe('VectorizeClient.semanticSearch', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.AI as unknown as { run: Mock }).run.mockResolvedValue({
      data: [[0.1, 0.2, 0.3, 0.4, 0.5]],
    })
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockResolvedValue({
      matches: [
        { id: 'doc-1', score: 0.95, metadata: { title: 'Doc 1' } },
      ],
      count: 1,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('performs semantic search with text query', async () => {
    const result = await client.semanticSearch('What is machine learning?')

    expect(result.count).toBe(1)
    expect(result.matches[0].id).toBe('doc-1')
    expect(result.queryEmbedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
  })

  it('uses AI to generate embedding', async () => {
    await client.semanticSearch('test query')

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      '@cf/baai/bge-base-en-v1.5',
      expect.objectContaining({ text: 'test query' })
    )
  })

  it('uses custom embedding model', async () => {
    await client.semanticSearch('test query', {
      model: '@cf/custom/embedding-model',
    })

    expect((mockEnv.AI as unknown as { run: Mock }).run).toHaveBeenCalledWith(
      '@cf/custom/embedding-model',
      expect.any(Object)
    )
  })

  it('passes search options to query', async () => {
    await client.semanticSearch('test query', {
      topK: 20,
      namespace: 'test-ns',
      filter: { category: 'articles' },
    })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        topK: 20,
        namespace: 'test-ns',
        filter: { category: 'articles' },
      })
    )
  })

  it('throws error if AI binding not available', async () => {
    const envWithoutAI = createMockEnv({ AI: undefined })
    const clientWithoutAI = new VectorizeClient(envWithoutAI)

    await expect(clientWithoutAI.semanticSearch('test')).rejects.toThrow(
      'AI binding is required for semantic search'
    )
  })

  it('throws error for empty search text', async () => {
    await expect(client.semanticSearch('')).rejects.toThrow('Search text cannot be empty')
    await expect(client.semanticSearch('   ')).rejects.toThrow('Search text cannot be empty')
  })
})

// ============================================================================
// Describe Tests
// ============================================================================

describe('VectorizeClient.describe', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { describe: Mock }).describe.mockResolvedValue({
      id: 'index-123',
      name: 'test-index',
      description: 'Test index description',
      config: { dimensions: 384, metric: 'cosine' },
      vectorsCount: 1000,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('returns index information', async () => {
    const info = await client.describe()

    expect(info.id).toBe('index-123')
    expect(info.name).toBe('test-index')
    expect(info.description).toBe('Test index description')
    expect(info.config.dimensions).toBe(384)
    expect(info.config.metric).toBe('cosine')
    expect(info.vectorsCount).toBe(1000)
  })
})

// ============================================================================
// Namespace Tests
// ============================================================================

describe('VectorizeClient namespace operations', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockResolvedValue({
      matches: [],
      count: 0,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('sets and gets namespace', () => {
    client.setNamespace('new-namespace')
    expect(client.getNamespace()).toBe('new-namespace')
  })

  it('clears namespace', () => {
    client.setNamespace('test')
    client.setNamespace(undefined)
    expect(client.getNamespace()).toBeUndefined()
  })

  it('creates namespaced client', () => {
    const namespacedClient = client.withNamespace('tenant-123')

    expect(namespacedClient).toBeInstanceOf(VectorizeClient)
    expect(namespacedClient.getNamespace()).toBe('tenant-123')
  })

  it('namespaced client uses namespace in queries', async () => {
    const namespacedClient = client.withNamespace('tenant-123')
    await namespacedClient.query([0.1, 0.2])

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ namespace: 'tenant-123' })
    )
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory functions', () => {
  it('createVectorizeClient creates instance', () => {
    const env = createMockEnv()
    const client = createVectorizeClient(env)

    expect(client).toBeInstanceOf(VectorizeClient)
  })

  it('createVectorizeClient with config', () => {
    const env = createMockEnv()
    const client = createVectorizeClient(env, { defaultTopK: 20 })

    expect(client).toBeInstanceOf(VectorizeClient)
  })

  it('createNamespacedVectorizeClient creates namespaced instance', () => {
    const env = createMockEnv()
    const client = createNamespacedVectorizeClient(env, 'tenant-123')

    expect(client).toBeInstanceOf(VectorizeClient)
    expect(client.getNamespace()).toBe('tenant-123')
  })

  it('createSemanticSearchClient requires AI binding', () => {
    const envWithoutAI = createMockEnv({ AI: undefined })

    expect(() => createSemanticSearchClient(envWithoutAI)).toThrow(
      'AI binding is required for semantic search client'
    )
  })

  it('createSemanticSearchClient creates instance with AI', () => {
    const env = createMockEnv()
    const client = createSemanticSearchClient(env)

    expect(client).toBeInstanceOf(VectorizeClient)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('VectorizeClient error handling', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    client = new VectorizeClient(mockEnv)
  })

  it('propagates insert errors', async () => {
    ;(mockEnv.VECTORS as unknown as { insert: Mock }).insert.mockRejectedValue(
      new Error('Insert failed')
    )

    await expect(client.insert(createTestVectors(1))).rejects.toThrow('Insert failed')
  })

  it('propagates query errors', async () => {
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockRejectedValue(
      new Error('Query failed')
    )

    await expect(client.query([0.1, 0.2])).rejects.toThrow('Query failed')
  })

  it('propagates delete errors', async () => {
    ;(mockEnv.VECTORS as unknown as { deleteByIds: Mock }).deleteByIds.mockRejectedValue(
      new Error('Delete failed')
    )

    await expect(client.delete(['doc-1'])).rejects.toThrow('Delete failed')
  })

  it('validates vector with Infinity value', async () => {
    const vectors = [{ id: 'test', values: [0.1, Infinity] }]

    await expect(client.insert(vectors)).rejects.toThrow('Vector test values must be finite numbers')
  })

  it('validates vector with -Infinity value', async () => {
    const vectors = [{ id: 'test', values: [-Infinity, 0.1] }]

    await expect(client.insert(vectors)).rejects.toThrow('Vector test values must be finite numbers')
  })

  it('validates vector without values', async () => {
    const vectors = [{ id: 'test' }] as Vector[]

    await expect(client.insert(vectors)).rejects.toThrow('Vector test must have values')
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type exports', () => {
  it('exports Vector type', () => {
    const vector: Vector = {
      id: 'test',
      values: [0.1, 0.2],
      namespace: 'ns',
      metadata: { key: 'value' },
    }
    expect(vector.id).toBe('test')
  })

  it('exports QueryOptions type', () => {
    const options: QueryOptions = {
      topK: 10,
      namespace: 'ns',
      returnValues: true,
      returnMetadata: 'all',
      filter: { category: 'test' },
    }
    expect(options.topK).toBe(10)
  })

  it('exports QueryResult type', () => {
    const result: QueryResult = {
      matches: [{ id: 'test', score: 0.95 }],
      count: 1,
    }
    expect(result.count).toBe(1)
  })

  it('exports MutationResult type', () => {
    const result: MutationResult = {
      ids: ['id-1', 'id-2'],
      count: 2,
    }
    expect(result.count).toBe(2)
  })

  it('exports MetadataFilter type', () => {
    const filter: MetadataFilter = {
      category: 'articles',
      score: { $gte: 0.5 },
      status: { $in: ['published', 'draft'] },
    }
    expect(filter.category).toBe('articles')
  })
})

// ============================================================================
// Float Array Conversion Tests
// ============================================================================

describe('Float array conversions', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { insert: Mock }).insert.mockResolvedValue({
      ids: ['test'],
      count: 1,
    })
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockResolvedValue({
      matches: [{ id: 'test', score: 0.9, values: new Float32Array([0.1, 0.2]) }],
      count: 1,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('accepts Float32Array for insert', async () => {
    const vectors = [{ id: 'test', values: new Float32Array([0.1, 0.2, 0.3]) }]
    const result = await client.insert(vectors)

    expect(result.count).toBe(1)
  })

  it('accepts Float64Array for insert', async () => {
    const vectors = [{ id: 'test', values: new Float64Array([0.1, 0.2, 0.3]) }]
    const result = await client.insert(vectors)

    expect(result.count).toBe(1)
  })

  it('converts Float32Array values in query results to number array', async () => {
    const result = await client.query([0.1, 0.2], { returnValues: true })

    expect(Array.isArray(result.matches[0].values)).toBe(true)
  })
})

// ============================================================================
// Metadata Filter Operation Tests
// ============================================================================

describe('Metadata filter operations', () => {
  let mockEnv: VectorizeEnv
  let client: VectorizeClient

  beforeEach(() => {
    mockEnv = createMockEnv()
    ;(mockEnv.VECTORS as unknown as { query: Mock }).query.mockResolvedValue({
      matches: [],
      count: 0,
    })
    client = new VectorizeClient(mockEnv)
  })

  it('supports equality filter', async () => {
    await client.query([0.1], { filter: { status: 'active' } })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { status: 'active' },
      })
    )
  })

  it('supports $eq filter', async () => {
    await client.query([0.1], { filter: { status: { $eq: 'active' } } })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { status: { $eq: 'active' } },
      })
    )
  })

  it('supports $ne filter', async () => {
    await client.query([0.1], { filter: { status: { $ne: 'deleted' } } })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { status: { $ne: 'deleted' } },
      })
    )
  })

  it('supports comparison filters', async () => {
    await client.query([0.1], {
      filter: {
        score: { $gte: 0.5, $lt: 1.0 },
      },
    })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { score: { $gte: 0.5, $lt: 1.0 } },
      })
    )
  })

  it('supports $in filter', async () => {
    await client.query([0.1], {
      filter: {
        category: { $in: ['tech', 'science'] },
      },
    })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { category: { $in: ['tech', 'science'] } },
      })
    )
  })

  it('supports null filter', async () => {
    await client.query([0.1], { filter: { deletedAt: null } })

    expect((mockEnv.VECTORS as unknown as { query: Mock }).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { deletedAt: null },
      })
    )
  })
})
