/**
 * EdgeVecService RPC Tests
 *
 * RED phase TDD tests for EdgeVecService WorkerEntrypoint.
 * Tests the RPC interface for HNSW vector search operations.
 *
 * EdgeVec is deployed as a separate worker (217KB WASM) to avoid bundle bloat
 * in the main application. It communicates via Cloudflare Workers Service Bindings.
 *
 * Tests should FAIL until service.ts is implemented.
 *
 * @see docs/plans/2026-01-09-compat-layer-design.md
 * @see compat/core/types.ts - VectorEngineType includes 'edgevec'
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'

// Import types that will be implemented
import type {
  EdgeVecService,
  IndexConfig,
  Vector,
  SearchOptions,
  SearchResult,
  InsertResult,
  DeleteResult,
  IndexInfo,
  EdgeVecError,
  EdgeVecErrorCode,
} from '../types'

// Import the service that will be implemented
import { EdgeVecServiceImpl } from '../service'

// ============================================================================
// Type Definitions (expected interface)
// ============================================================================

/**
 * Expected IndexConfig structure
 */
interface ExpectedIndexConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Distance metric: cosine, euclidean, or dot */
  metric?: 'cosine' | 'euclidean' | 'dot'
  /** HNSW parameter: max connections per node (default: 16) */
  m?: number
  /** HNSW parameter: size of dynamic candidate list (default: 200) */
  efConstruction?: number
}

/**
 * Expected Vector structure
 */
interface ExpectedVector {
  /** Unique identifier */
  id: string
  /** Vector values (embedding) */
  values: number[] | Float32Array
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Expected SearchOptions structure
 */
interface ExpectedSearchOptions {
  /** Number of results to return */
  k?: number
  /** HNSW search parameter: size of dynamic candidate list */
  ef?: number
  /** Metadata filter */
  filter?: Record<string, unknown>
}

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_NAMESPACE = 'test-namespace'
const TEST_INDEX = 'test-index'

const createTestVectors = (count: number, dimensions = 128): ExpectedVector[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `vec-${i + 1}`,
    values: Array.from({ length: dimensions }, (_, d) => Math.random()),
    metadata: { label: `Document ${i + 1}`, index: i + 1 },
  }))
}

const createNormalizedVector = (dimensions: number, seed: number): number[] => {
  // Create a reproducible vector
  const raw = Array.from({ length: dimensions }, (_, i) => Math.sin(seed + i))
  // Normalize to unit length
  const norm = Math.sqrt(raw.reduce((sum, x) => sum + x * x, 0))
  return raw.map((x) => x / norm)
}

// ============================================================================
// WorkerEntrypoint Class Structure Tests
// ============================================================================

describe('EdgeVecService WorkerEntrypoint', () => {
  describe('class structure', () => {
    it('is a class that can be instantiated', () => {
      // EdgeVecServiceImpl should be a class that extends WorkerEntrypoint base
      expect(EdgeVecServiceImpl.prototype).toBeInstanceOf(Object)
      expect(typeof EdgeVecServiceImpl).toBe('function')

      // Create mock env and ctx
      const mockEnv = {}
      const mockCtx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      }

      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      // Should be an instance of EdgeVecServiceImpl
      expect(service).toBeInstanceOf(EdgeVecServiceImpl)
    })

    it('exposes createIndex RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.createIndex).toBe('function')
    })

    it('exposes insert RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.insert).toBe('function')
    })

    it('exposes search RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.search).toBe('function')
    })

    it('exposes delete RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.delete).toBe('function')
    })

    it('exposes persist RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.persist).toBe('function')
    })

    it('exposes load RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.load).toBe('function')
    })

    it('exposes listIndexes RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.listIndexes).toBe('function')
    })

    it('exposes describeIndex RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.describeIndex).toBe('function')
    })

    it('exposes deleteIndex RPC method', () => {
      const mockEnv = {}
      const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
      const service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, mockEnv)

      expect(typeof service.deleteIndex).toBe('function')
    })
  })
})

// ============================================================================
// createIndex RPC Tests
// ============================================================================

describe('EdgeVecService.createIndex', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  it('creates an index with required dimensions', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 128,
    })

    expect(result.success).toBe(true)
    expect(result.name).toBe(TEST_INDEX)
    expect(result.namespace).toBe(TEST_NAMESPACE)
  })

  it('creates an index with cosine metric', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 128,
      metric: 'cosine',
    })

    expect(result.success).toBe(true)
    expect(result.config.metric).toBe('cosine')
  })

  it('creates an index with euclidean metric', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 256,
      metric: 'euclidean',
    })

    expect(result.success).toBe(true)
    expect(result.config.metric).toBe('euclidean')
  })

  it('creates an index with dot product metric', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 768,
      metric: 'dot',
    })

    expect(result.success).toBe(true)
    expect(result.config.metric).toBe('dot')
  })

  it('creates an index with custom HNSW parameters', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 128,
      m: 32,
      efConstruction: 400,
    })

    expect(result.success).toBe(true)
    expect(result.config.m).toBe(32)
    expect(result.config.efConstruction).toBe(400)
  })

  it('uses default HNSW parameters when not specified', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 128,
    })

    expect(result.success).toBe(true)
    expect(result.config.m).toBe(16) // default
    expect(result.config.efConstruction).toBe(200) // default
    expect(result.config.metric).toBe('cosine') // default
  })

  it('returns error for invalid dimensions (zero)', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 0,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_DIMENSIONS')
  })

  it('returns error for invalid dimensions (negative)', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: -128,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_DIMENSIONS')
  })

  it('returns error for empty index name', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, '', {
      dimensions: 128,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_INDEX_NAME')
  })

  it('returns error for empty namespace', async () => {
    const result = await service.createIndex('', TEST_INDEX, {
      dimensions: 128,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_NAMESPACE')
  })

  it('returns error when index already exists', async () => {
    // Create first index
    await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })

    // Try to create same index again
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 128,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INDEX_EXISTS')
  })
})

// ============================================================================
// insert RPC Tests
// ============================================================================

describe('EdgeVecService.insert', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(async () => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
    // Create an index for testing
    await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })
  })

  it('inserts a single vector', async () => {
    const vectors = createTestVectors(1)
    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(1)
    expect(result.ids).toContain('vec-1')
  })

  it('inserts multiple vectors', async () => {
    const vectors = createTestVectors(10)
    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(10)
    expect(result.ids).toHaveLength(10)
  })

  it('inserts vectors with metadata', async () => {
    const vectors = [
      {
        id: 'doc-1',
        values: createNormalizedVector(128, 1),
        metadata: { title: 'Document 1', category: 'tech', score: 0.95 },
      },
    ]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(1)
  })

  it('returns error for dimension mismatch', async () => {
    // Index expects 128 dimensions, provide 256
    const vectors = [
      {
        id: 'wrong-dim',
        values: createNormalizedVector(256, 1),
      },
    ]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('DIMENSION_MISMATCH')
    expect(result.error?.message).toContain('128')
    expect(result.error?.message).toContain('256')
  })

  it('returns error for empty vector array', async () => {
    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [])

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_VECTORS')
  })

  it('returns error for nonexistent index', async () => {
    const vectors = createTestVectors(1)
    const result = await service.insert(TEST_NAMESPACE, 'nonexistent', vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INDEX_NOT_FOUND')
  })

  it('returns error for nonexistent namespace', async () => {
    const vectors = createTestVectors(1)
    const result = await service.insert('nonexistent', TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('NAMESPACE_NOT_FOUND')
  })

  it('returns error for duplicate vector IDs', async () => {
    const vectors = [
      { id: 'dup-1', values: createNormalizedVector(128, 1) },
      { id: 'dup-1', values: createNormalizedVector(128, 2) },
    ]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('DUPLICATE_IDS')
  })

  it('returns error for empty vector ID', async () => {
    const vectors = [{ id: '', values: createNormalizedVector(128, 1) }]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_VECTOR_ID')
  })

  it('returns error for empty values array', async () => {
    const vectors = [{ id: 'empty', values: [] }]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_VALUES')
  })

  it('returns error for non-numeric values', async () => {
    const vectors = [{ id: 'nan', values: [0.1, NaN, 0.3] }]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_VALUES')
  })

  it('accepts Float32Array values', async () => {
    const vectors = [
      {
        id: 'float32',
        values: new Float32Array(createNormalizedVector(128, 1)),
      },
    ]

    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(1)
  })

  it('updates existing vectors when ID already exists (upsert behavior)', async () => {
    const vector1 = { id: 'upsert-1', values: createNormalizedVector(128, 1) }
    const vector2 = { id: 'upsert-1', values: createNormalizedVector(128, 2) }

    // First insert
    await service.insert(TEST_NAMESPACE, TEST_INDEX, [vector1])

    // Second insert with same ID should update
    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [vector2])

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
  })
})

// ============================================================================
// search RPC Tests
// ============================================================================

describe('EdgeVecService.search', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(async () => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})

    // Create and populate an index
    await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })

    const vectors = Array.from({ length: 100 }, (_, i) => ({
      id: `doc-${i}`,
      values: createNormalizedVector(128, i),
      metadata: { index: i, category: i % 3 === 0 ? 'tech' : 'other' },
    }))

    await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)
  })

  it('searches with default k=10', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec)

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(10)
  })

  it('searches with custom k', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, { k: 20 })

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(20)
  })

  it('returns results sorted by score descending', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, { k: 10 })

    expect(result.success).toBe(true)
    const scores = result.results.map((r: { score: number }) => r.score)
    const sortedScores = [...scores].sort((a, b) => b - a)
    expect(scores).toEqual(sortedScores)
  })

  it('returns vector IDs in results', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, { k: 5 })

    expect(result.success).toBe(true)
    result.results.forEach((r: { id: string }) => {
      expect(r.id).toMatch(/^doc-\d+$/)
    })
  })

  it('returns scores between 0 and 1 for cosine metric', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec)

    expect(result.success).toBe(true)
    result.results.forEach((r: { score: number }) => {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    })
  })

  it('returns metadata when available', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, { k: 5 })

    expect(result.success).toBe(true)
    result.results.forEach((r: { metadata?: Record<string, unknown> }) => {
      expect(r.metadata).toBeDefined()
      expect(typeof r.metadata?.index).toBe('number')
    })
  })

  it('applies metadata filter', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, {
      k: 50,
      filter: { category: 'tech' },
    })

    expect(result.success).toBe(true)
    result.results.forEach((r: { metadata?: Record<string, unknown> }) => {
      expect(r.metadata?.category).toBe('tech')
    })
  })

  it('respects ef parameter for search quality', async () => {
    const queryVec = createNormalizedVector(128, 5)

    // Higher ef = more accurate but slower
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, {
      k: 10,
      ef: 100,
    })

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(10)
  })

  it('returns error for dimension mismatch', async () => {
    const queryVec = createNormalizedVector(256, 5) // Wrong dimensions

    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('DIMENSION_MISMATCH')
  })

  it('returns error for empty query vector', async () => {
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, [])

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_QUERY')
  })

  it('returns error for nonexistent index', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, 'nonexistent', queryVec)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INDEX_NOT_FOUND')
  })

  it('returns empty results for empty index', async () => {
    // Create a new empty index
    await service.createIndex(TEST_NAMESPACE, 'empty-index', { dimensions: 128 })
    const queryVec = createNormalizedVector(128, 5)

    const result = await service.search(TEST_NAMESPACE, 'empty-index', queryVec)

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(0)
  })

  it('accepts Float32Array as query vector', async () => {
    const queryVec = new Float32Array(createNormalizedVector(128, 5))
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec)

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(10)
  })

  it('returns query time in milliseconds', async () => {
    const queryVec = createNormalizedVector(128, 5)
    const result = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec)

    expect(result.success).toBe(true)
    expect(typeof result.queryTimeMs).toBe('number')
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// delete RPC Tests
// ============================================================================

describe('EdgeVecService.delete', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(async () => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})

    await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })

    const vectors = Array.from({ length: 10 }, (_, i) => ({
      id: `doc-${i}`,
      values: createNormalizedVector(128, i),
    }))

    await service.insert(TEST_NAMESPACE, TEST_INDEX, vectors)
  })

  it('deletes a single vector by ID', async () => {
    const result = await service.delete(TEST_NAMESPACE, TEST_INDEX, ['doc-0'])

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(1)
    expect(result.ids).toContain('doc-0')
  })

  it('deletes multiple vectors', async () => {
    const result = await service.delete(TEST_NAMESPACE, TEST_INDEX, ['doc-0', 'doc-1', 'doc-2'])

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(3)
    expect(result.ids).toEqual(['doc-0', 'doc-1', 'doc-2'])
  })

  it('returns error for nonexistent vector IDs', async () => {
    const result = await service.delete(TEST_NAMESPACE, TEST_INDEX, ['nonexistent'])

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('VECTORS_NOT_FOUND')
  })

  it('partially deletes when some IDs exist', async () => {
    const result = await service.delete(TEST_NAMESPACE, TEST_INDEX, ['doc-0', 'nonexistent'])

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(1)
    expect(result.notFound).toContain('nonexistent')
  })

  it('returns error for empty ID array', async () => {
    const result = await service.delete(TEST_NAMESPACE, TEST_INDEX, [])

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_IDS')
  })

  it('returns error for nonexistent index', async () => {
    const result = await service.delete(TEST_NAMESPACE, 'nonexistent', ['doc-0'])

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INDEX_NOT_FOUND')
  })

  it('ensures deleted vectors are not returned in search', async () => {
    await service.delete(TEST_NAMESPACE, TEST_INDEX, ['doc-5'])

    const queryVec = createNormalizedVector(128, 5)
    const searchResult = await service.search(TEST_NAMESPACE, TEST_INDEX, queryVec, { k: 100 })

    expect(searchResult.success).toBe(true)
    const ids = searchResult.results.map((r: { id: string }) => r.id)
    expect(ids).not.toContain('doc-5')
  })
})

// ============================================================================
// Batch Operations Tests
// ============================================================================

describe('EdgeVecService batch operations', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  describe('batch insert via RPC', () => {
    it('handles large batch insert (1000 vectors)', async () => {
      await service.createIndex(TEST_NAMESPACE, 'large-index', { dimensions: 128 })

      const vectors = Array.from({ length: 1000 }, (_, i) => ({
        id: `batch-${i}`,
        values: createNormalizedVector(128, i),
      }))

      const result = await service.insert(TEST_NAMESPACE, 'large-index', vectors)

      expect(result.success).toBe(true)
      expect(result.inserted).toBe(1000)
    })

    it('handles batch insert with varying metadata', async () => {
      await service.createIndex(TEST_NAMESPACE, 'metadata-index', { dimensions: 64 })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `meta-${i}`,
        values: createNormalizedVector(64, i),
        metadata: {
          category: ['A', 'B', 'C'][i % 3],
          score: Math.random(),
          tags: [`tag-${i % 5}`, `tag-${(i + 1) % 5}`],
        },
      }))

      const result = await service.insert(TEST_NAMESPACE, 'metadata-index', vectors)

      expect(result.success).toBe(true)
      expect(result.inserted).toBe(100)
    })

    it('returns partial success for batch with some invalid vectors', async () => {
      await service.createIndex(TEST_NAMESPACE, 'partial-index', { dimensions: 128 })

      const vectors = [
        { id: 'valid-1', values: createNormalizedVector(128, 1) },
        { id: '', values: createNormalizedVector(128, 2) }, // Invalid: empty ID
        { id: 'valid-2', values: createNormalizedVector(128, 3) },
      ]

      const result = await service.insert(TEST_NAMESPACE, 'partial-index', vectors)

      // Behavior depends on implementation: could be all-or-nothing or partial
      expect(result.inserted + (result.failed || 0)).toBe(3)
    })
  })

  describe('batch search via RPC', () => {
    beforeEach(async () => {
      await service.createIndex(TEST_NAMESPACE, 'batch-search-index', { dimensions: 128 })

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `search-${i}`,
        values: createNormalizedVector(128, i),
        metadata: { index: i },
      }))

      await service.insert(TEST_NAMESPACE, 'batch-search-index', vectors)
    })

    it('performs batch search with multiple query vectors', async () => {
      const queries = [
        createNormalizedVector(128, 10),
        createNormalizedVector(128, 50),
        createNormalizedVector(128, 90),
      ]

      const result = await service.batchSearch(TEST_NAMESPACE, 'batch-search-index', queries, {
        k: 5,
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(3)
      result.results.forEach((r: { results: unknown[] }) => {
        expect(r.results).toHaveLength(5)
      })
    })

    it('handles empty batch search', async () => {
      const result = await service.batchSearch(TEST_NAMESPACE, 'batch-search-index', [])

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EMPTY_QUERIES')
    })

    it('returns individual errors for batch search failures', async () => {
      const queries = [
        createNormalizedVector(128, 10), // Valid
        createNormalizedVector(256, 20), // Invalid dimensions
        createNormalizedVector(128, 30), // Valid
      ]

      const result = await service.batchSearch(TEST_NAMESPACE, 'batch-search-index', queries)

      expect(result.success).toBe(true)
      expect(result.results[0].success).toBe(true)
      expect(result.results[1].success).toBe(false)
      expect(result.results[1].error?.code).toBe('DIMENSION_MISMATCH')
      expect(result.results[2].success).toBe(true)
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('EdgeVecService error handling', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  it('returns typed errors via RPC', async () => {
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: -1,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error?.code).toBe('string')
    expect(typeof result.error?.message).toBe('string')
  })

  it('includes error code in all error responses', async () => {
    // Test various error conditions
    const errors: Array<{ code: string }> = []

    // Invalid dimensions
    const r1 = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 0 })
    if (!r1.success) errors.push(r1.error!)

    // Empty namespace
    const r2 = await service.createIndex('', TEST_INDEX, { dimensions: 128 })
    if (!r2.success) errors.push(r2.error!)

    // Empty index name
    const r3 = await service.createIndex(TEST_NAMESPACE, '', { dimensions: 128 })
    if (!r3.success) errors.push(r3.error!)

    errors.forEach((err) => {
      expect(err.code).toBeTruthy()
      expect(['INVALID_DIMENSIONS', 'INVALID_NAMESPACE', 'INVALID_INDEX_NAME']).toContain(err.code)
    })
  })

  it('handles invalid parameter types gracefully', async () => {
    // Pass wrong types (TypeScript would catch this, but testing runtime behavior)
    const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
      dimensions: 'not-a-number' as unknown as number,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMETERS')
  })

  it('returns descriptive error messages', async () => {
    await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })

    // Insert with wrong dimensions
    const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [
      { id: 'wrong', values: createNormalizedVector(64, 1) },
    ])

    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('dimension')
    expect(result.error?.message).toContain('128')
    expect(result.error?.message).toContain('64')
  })

  it('does not throw exceptions for invalid inputs', async () => {
    // All methods should return error results, not throw
    await expect(
      service.createIndex(null as unknown as string, TEST_INDEX, { dimensions: 128 })
    ).resolves.toBeDefined()

    await expect(
      service.insert(TEST_NAMESPACE, TEST_INDEX, null as unknown as ExpectedVector[])
    ).resolves.toBeDefined()

    await expect(
      service.search(TEST_NAMESPACE, TEST_INDEX, null as unknown as number[])
    ).resolves.toBeDefined()

    await expect(
      service.delete(TEST_NAMESPACE, TEST_INDEX, null as unknown as string[])
    ).resolves.toBeDefined()
  })
})

// ============================================================================
// Namespace Isolation Tests
// ============================================================================

describe('EdgeVecService namespace isolation', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  it('isolates indexes by namespace', async () => {
    // Create same index name in different namespaces
    await service.createIndex('namespace-1', 'shared-index', { dimensions: 128 })
    await service.createIndex('namespace-2', 'shared-index', { dimensions: 128 })

    // Insert different data in each
    await service.insert('namespace-1', 'shared-index', [
      { id: 'doc-1', values: createNormalizedVector(128, 1), metadata: { ns: 1 } },
    ])

    await service.insert('namespace-2', 'shared-index', [
      { id: 'doc-1', values: createNormalizedVector(128, 2), metadata: { ns: 2 } },
    ])

    // Search should return namespace-specific results
    const query = createNormalizedVector(128, 1)

    const result1 = await service.search('namespace-1', 'shared-index', query)
    const result2 = await service.search('namespace-2', 'shared-index', query)

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    expect(result1.results[0].metadata?.ns).toBe(1)
    expect(result2.results[0].metadata?.ns).toBe(2)
  })

  it('prevents cross-namespace access', async () => {
    await service.createIndex('secure-ns', 'secure-index', { dimensions: 128 })
    await service.insert('secure-ns', 'secure-index', [
      { id: 'secret', values: createNormalizedVector(128, 1) },
    ])

    // Try to access from different namespace
    const searchResult = await service.search(
      'other-ns',
      'secure-index',
      createNormalizedVector(128, 1)
    )

    expect(searchResult.success).toBe(false)
    expect(searchResult.error?.code).toBe('INDEX_NOT_FOUND')
  })

  it('allows deleting namespace-specific indexes', async () => {
    await service.createIndex('ns-to-delete', 'temp-index', { dimensions: 128 })

    const result = await service.deleteIndex('ns-to-delete', 'temp-index')

    expect(result.success).toBe(true)

    // Verify index is gone
    const searchResult = await service.search(
      'ns-to-delete',
      'temp-index',
      createNormalizedVector(128, 1)
    )

    expect(searchResult.success).toBe(false)
    expect(searchResult.error?.code).toBe('INDEX_NOT_FOUND')
  })

  it('lists indexes within a namespace only', async () => {
    await service.createIndex('list-ns-1', 'index-a', { dimensions: 128 })
    await service.createIndex('list-ns-1', 'index-b', { dimensions: 128 })
    await service.createIndex('list-ns-2', 'index-c', { dimensions: 128 })

    const result1 = await service.listIndexes('list-ns-1')
    const result2 = await service.listIndexes('list-ns-2')

    expect(result1.success).toBe(true)
    expect(result1.indexes).toHaveLength(2)
    expect(result1.indexes.map((i: { name: string }) => i.name).sort()).toEqual([
      'index-a',
      'index-b',
    ])

    expect(result2.success).toBe(true)
    expect(result2.indexes).toHaveLength(1)
    expect(result2.indexes[0].name).toBe('index-c')
  })
})

// ============================================================================
// Persistence Tests (persist/load)
// ============================================================================

describe('EdgeVecService persistence', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  describe('persist', () => {
    it('persists index to durable storage', async () => {
      await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })
      await service.insert(TEST_NAMESPACE, TEST_INDEX, createTestVectors(10))

      const result = await service.persist(TEST_NAMESPACE, TEST_INDEX)

      expect(result.success).toBe(true)
      expect(result.bytesWritten).toBeGreaterThan(0)
    })

    it('returns error for nonexistent index', async () => {
      const result = await service.persist(TEST_NAMESPACE, 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INDEX_NOT_FOUND')
    })

    it('persists all namespaces when called without namespace', async () => {
      await service.createIndex('ns-1', 'index-1', { dimensions: 64 })
      await service.createIndex('ns-2', 'index-2', { dimensions: 64 })

      const result = await service.persistAll()

      expect(result.success).toBe(true)
      expect(result.persisted).toBeGreaterThanOrEqual(2)
    })
  })

  describe('load', () => {
    it('loads index from durable storage', async () => {
      // Setup: create, populate, and persist
      await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })
      await service.insert(TEST_NAMESPACE, TEST_INDEX, createTestVectors(10))
      await service.persist(TEST_NAMESPACE, TEST_INDEX)

      // Load into new service instance (simulating restart)
      const newService = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
      const result = await newService.load(TEST_NAMESPACE, TEST_INDEX)

      expect(result.success).toBe(true)
      expect(result.vectorCount).toBe(10)
    })

    it('returns error when no persisted data exists', async () => {
      const result = await service.load(TEST_NAMESPACE, 'never-persisted')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NO_PERSISTED_DATA')
    })

    it('loads all namespaces when called without namespace', async () => {
      // Setup
      await service.createIndex('ns-1', 'index-1', { dimensions: 64 })
      await service.createIndex('ns-2', 'index-2', { dimensions: 64 })
      await service.persistAll()

      // Load all
      const newService = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
      const result = await newService.loadAll()

      expect(result.success).toBe(true)
      expect(result.loaded).toBeGreaterThanOrEqual(2)
    })
  })
})

// ============================================================================
// Index Management Tests
// ============================================================================

describe('EdgeVecService index management', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  describe('describeIndex', () => {
    it('returns index configuration and stats', async () => {
      await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
        dimensions: 128,
        metric: 'cosine',
        m: 24,
        efConstruction: 300,
      })

      await service.insert(TEST_NAMESPACE, TEST_INDEX, createTestVectors(50))

      const result = await service.describeIndex(TEST_NAMESPACE, TEST_INDEX)

      expect(result.success).toBe(true)
      expect(result.info.name).toBe(TEST_INDEX)
      expect(result.info.namespace).toBe(TEST_NAMESPACE)
      expect(result.info.dimensions).toBe(128)
      expect(result.info.metric).toBe('cosine')
      expect(result.info.vectorCount).toBe(50)
      expect(result.info.config.m).toBe(24)
      expect(result.info.config.efConstruction).toBe(300)
    })

    it('returns error for nonexistent index', async () => {
      const result = await service.describeIndex(TEST_NAMESPACE, 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INDEX_NOT_FOUND')
    })
  })

  describe('deleteIndex', () => {
    it('deletes an existing index', async () => {
      await service.createIndex(TEST_NAMESPACE, 'to-delete', { dimensions: 128 })

      const result = await service.deleteIndex(TEST_NAMESPACE, 'to-delete')

      expect(result.success).toBe(true)
    })

    it('returns error for nonexistent index', async () => {
      const result = await service.deleteIndex(TEST_NAMESPACE, 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INDEX_NOT_FOUND')
    })

    it('removes all vectors when index is deleted', async () => {
      await service.createIndex(TEST_NAMESPACE, 'with-data', { dimensions: 128 })
      await service.insert(TEST_NAMESPACE, 'with-data', createTestVectors(100))

      await service.deleteIndex(TEST_NAMESPACE, 'with-data')

      // Recreate with same name should be empty
      await service.createIndex(TEST_NAMESPACE, 'with-data', { dimensions: 128 })
      const search = await service.search(
        TEST_NAMESPACE,
        'with-data',
        createNormalizedVector(128, 1)
      )

      expect(search.success).toBe(true)
      expect(search.results).toHaveLength(0)
    })
  })

  describe('listIndexes', () => {
    it('returns empty array when no indexes exist', async () => {
      const result = await service.listIndexes('empty-namespace')

      expect(result.success).toBe(true)
      expect(result.indexes).toEqual([])
    })

    it('returns all indexes in namespace with basic info', async () => {
      await service.createIndex(TEST_NAMESPACE, 'index-1', { dimensions: 128 })
      await service.createIndex(TEST_NAMESPACE, 'index-2', { dimensions: 256 })
      await service.createIndex(TEST_NAMESPACE, 'index-3', { dimensions: 64 })

      const result = await service.listIndexes(TEST_NAMESPACE)

      expect(result.success).toBe(true)
      expect(result.indexes).toHaveLength(3)
      expect(result.indexes.map((i: { name: string }) => i.name).sort()).toEqual([
        'index-1',
        'index-2',
        'index-3',
      ])
    })
  })
})

// ============================================================================
// Request Validation Tests
// ============================================================================

describe('EdgeVecService request validation', () => {
  let service: InstanceType<typeof EdgeVecServiceImpl>
  let mockCtx: { waitUntil: Mock; passThroughOnException: Mock }

  beforeEach(() => {
    mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() }
    service = new EdgeVecServiceImpl(mockCtx as unknown as ExecutionContext, {})
  })

  describe('namespace validation', () => {
    it('rejects null namespace', async () => {
      const result = await service.createIndex(null as unknown as string, TEST_INDEX, {
        dimensions: 128,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_NAMESPACE')
    })

    it('rejects undefined namespace', async () => {
      const result = await service.createIndex(undefined as unknown as string, TEST_INDEX, {
        dimensions: 128,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_NAMESPACE')
    })

    it('rejects whitespace-only namespace', async () => {
      const result = await service.createIndex('   ', TEST_INDEX, { dimensions: 128 })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_NAMESPACE')
    })
  })

  describe('index name validation', () => {
    it('rejects index names with invalid characters', async () => {
      const result = await service.createIndex(TEST_NAMESPACE, 'invalid/name', {
        dimensions: 128,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_INDEX_NAME')
    })

    it('accepts valid index name characters', async () => {
      const result = await service.createIndex(TEST_NAMESPACE, 'valid-name_123', {
        dimensions: 128,
      })

      expect(result.success).toBe(true)
    })
  })

  describe('vector validation', () => {
    beforeEach(async () => {
      await service.createIndex(TEST_NAMESPACE, TEST_INDEX, { dimensions: 128 })
    })

    it('rejects vectors with Infinity values', async () => {
      const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [
        { id: 'inf', values: [Infinity, 0.5, 0.5] },
      ])

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_VALUES')
    })

    it('rejects vectors with -Infinity values', async () => {
      const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [
        { id: 'neg-inf', values: [-Infinity, 0.5, 0.5] },
      ])

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_VALUES')
    })

    it('rejects vectors with null values', async () => {
      const result = await service.insert(TEST_NAMESPACE, TEST_INDEX, [
        { id: 'null-vals', values: null as unknown as number[] },
      ])

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_VALUES')
    })
  })

  describe('HNSW parameter validation', () => {
    it('rejects M parameter less than 2', async () => {
      const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
        dimensions: 128,
        m: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_HNSW_PARAMS')
    })

    it('rejects efConstruction less than m', async () => {
      const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
        dimensions: 128,
        m: 16,
        efConstruction: 8,
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_HNSW_PARAMS')
    })

    it('rejects invalid metric value', async () => {
      const result = await service.createIndex(TEST_NAMESPACE, TEST_INDEX, {
        dimensions: 128,
        metric: 'invalid' as 'cosine',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_METRIC')
    })
  })
})
