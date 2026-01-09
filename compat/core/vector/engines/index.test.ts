/**
 * Vector Engine Tests
 *
 * Tests for all vector engine implementations:
 * - LibSQLEngine: F32_BLOB vectors in SQLite
 * - EdgeVecEngine: WASM HNSW via Workers RPC
 * - VectorizeEngine: Cloudflare Vectorize
 * - ClickHouseEngine: ANN indexes (usearch/annoy/hnsw)
 * - IcebergEngine: Parquet with LSH indexes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VectorTierConfig } from '../../types'
import {
  LibSQLEngine,
  EdgeVecEngine,
  VectorizeEngine,
  ClickHouseEngine,
  IcebergEngine,
  createEngine,
} from '.'

// ============================================================================
// SHARED TEST HELPERS
// ============================================================================

const testVector = (dims: number) => Array.from({ length: dims }, (_, i) => i / dims)

// ============================================================================
// LIBSQL ENGINE TESTS
// ============================================================================

describe('LibSQLEngine', () => {
  let engine: LibSQLEngine

  beforeEach(() => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 128 }
    engine = new LibSQLEngine(config, {} as any)
  })

  describe('constructor', () => {
    it('should create engine with config', () => {
      expect(engine.name).toBe('libsql')
      expect(engine.dimensions).toBe(128)
      expect(engine.metric).toBe('cosine')
    })

    it('should accept custom metric', () => {
      const config: VectorTierConfig = { engine: 'libsql', dimensions: 128, metric: 'euclidean' }
      const e = new LibSQLEngine(config, {} as any)
      expect(e.metric).toBe('euclidean')
    })
  })

  describe('insert', () => {
    it('should insert vector with metadata', async () => {
      await engine.insert('vec-1', testVector(128), { label: 'test' })
      const results = await engine.search(testVector(128), { limit: 1 })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-1')
    })

    it('should validate dimensions', async () => {
      await expect(
        engine.insert('vec-1', testVector(64), {}) // Wrong dimensions
      ).rejects.toThrow(/dimension/i)
    })

    it('should update existing vector', async () => {
      await engine.insert('vec-1', testVector(128), { v: 1 })
      await engine.insert('vec-1', testVector(128), { v: 2 })
      const results = await engine.search(testVector(128), { limit: 10 })
      expect(results.length).toBe(1)
      expect(results[0].metadata.v).toBe(2)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await engine.insert('vec-1', [1, 0, 0, ...Array(125).fill(0)], { label: 'a' })
      await engine.insert('vec-2', [0, 1, 0, ...Array(125).fill(0)], { label: 'b' })
      await engine.insert('vec-3', [0, 0, 1, ...Array(125).fill(0)], { label: 'c' })
    })

    it('should find similar vectors', async () => {
      const results = await engine.search([1, 0, 0, ...Array(125).fill(0)], { limit: 1 })
      expect(results[0].id).toBe('vec-1')
      expect(results[0].score).toBeCloseTo(1, 2)
    })

    it('should respect limit', async () => {
      const results = await engine.search(testVector(128), { limit: 2 })
      expect(results.length).toBe(2)
    })

    it('should include vectors when requested', async () => {
      const results = await engine.search(testVector(128), { limit: 1, includeVectors: true })
      expect(results[0].vector).toBeDefined()
      expect(results[0].vector?.length).toBe(128)
    })

    it('should filter by metadata', async () => {
      const results = await engine.search(testVector(128), {
        limit: 10,
        filter: { label: 'a' },
      })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-1')
    })
  })

  describe('delete', () => {
    it('should delete vector by ID', async () => {
      await engine.insert('vec-1', testVector(128), {})
      expect(await engine.count()).toBe(1)

      const deleted = await engine.delete('vec-1')
      expect(deleted).toBe(true)
      expect(await engine.count()).toBe(0)
    })

    it('should return false for non-existent ID', async () => {
      const deleted = await engine.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('count', () => {
    it('should return vector count', async () => {
      expect(await engine.count()).toBe(0)
      await engine.insert('vec-1', testVector(128), {})
      await engine.insert('vec-2', testVector(128), {})
      expect(await engine.count()).toBe(2)
    })
  })

  describe('F32_BLOB format', () => {
    it('should handle F32_BLOB vector storage', async () => {
      // LibSQL stores vectors as F32_BLOB (binary float32 array)
      const vector = Array.from({ length: 128 }, () => Math.random())
      await engine.insert('vec-1', vector, {})
      const results = await engine.search(vector, { limit: 1, includeVectors: true })
      // Verify vector is stored and retrieved correctly
      expect(results[0].vector).toBeDefined()
      for (let i = 0; i < vector.length; i++) {
        expect(results[0].vector![i]).toBeCloseTo(vector[i], 5)
      }
    })
  })
})

// ============================================================================
// EDGEVEC ENGINE TESTS
// ============================================================================

describe('EdgeVecEngine', () => {
  let engine: EdgeVecEngine
  let mockRpc: any

  beforeEach(() => {
    mockRpc = {
      createIndex: vi.fn().mockResolvedValue({ success: true }),
      insert: vi.fn().mockResolvedValue({ success: true }),
      search: vi.fn().mockResolvedValue({ results: [] }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      count: vi.fn().mockResolvedValue({ count: 0 }),
    }

    const config: VectorTierConfig = { engine: 'edgevec', dimensions: 128 }
    engine = new EdgeVecEngine(config, { EDGEVEC: mockRpc })
  })

  describe('constructor', () => {
    it('should create engine with config', () => {
      expect(engine.name).toBe('edgevec')
      expect(engine.dimensions).toBe(128)
    })
  })

  describe('insert', () => {
    it('should call RPC insert', async () => {
      await engine.insert('vec-1', testVector(128), { label: 'test' })
      expect(mockRpc.insert).toHaveBeenCalledWith(
        'vec-1',
        testVector(128),
        { label: 'test' }
      )
    })
  })

  describe('search', () => {
    it('should call RPC search with ef parameter', async () => {
      mockRpc.search.mockResolvedValue({
        results: [{ id: 'vec-1', score: 0.95, metadata: {} }],
      })

      const results = await engine.search(testVector(128), { limit: 10 })
      expect(mockRpc.search).toHaveBeenCalled()
      expect(results.length).toBe(1)
    })

    it('should pass ef parameter for HNSW search quality', async () => {
      await engine.search(testVector(128), { limit: 10, ef: 200 } as any)
      expect(mockRpc.search).toHaveBeenCalledWith(
        testVector(128),
        expect.objectContaining({ ef: 200 })
      )
    })
  })

  describe('quantization', () => {
    it('should support binary quantization option', async () => {
      const config: VectorTierConfig = { engine: 'edgevec', dimensions: 128 }
      const e = new EdgeVecEngine(config, { EDGEVEC: mockRpc }, { quantization: 'binary' })
      expect(e.quantization).toBe('binary')
    })

    it('should support scalar quantization option', async () => {
      const config: VectorTierConfig = { engine: 'edgevec', dimensions: 128 }
      const e = new EdgeVecEngine(config, { EDGEVEC: mockRpc }, { quantization: 'scalar' })
      expect(e.quantization).toBe('scalar')
    })
  })

  describe('delete', () => {
    it('should call RPC delete', async () => {
      mockRpc.delete.mockResolvedValue({ success: true })
      const result = await engine.delete('vec-1')
      expect(mockRpc.delete).toHaveBeenCalledWith('vec-1')
      expect(result).toBe(true)
    })
  })

  describe('count', () => {
    it('should call RPC count', async () => {
      mockRpc.count.mockResolvedValue({ count: 42 })
      const count = await engine.count()
      expect(count).toBe(42)
    })
  })
})

// ============================================================================
// VECTORIZE ENGINE TESTS
// ============================================================================

describe('VectorizeEngine', () => {
  let engine: VectorizeEngine
  let mockBinding: any

  beforeEach(() => {
    mockBinding = {
      upsert: vi.fn().mockResolvedValue({ count: 1 }),
      query: vi.fn().mockResolvedValue({ matches: [] }),
      deleteByIds: vi.fn().mockResolvedValue({ count: 1 }),
      describe: vi.fn().mockResolvedValue({ vectorCount: 0 }),
    }

    const config: VectorTierConfig = { engine: 'vectorize', dimensions: 1536 }
    engine = new VectorizeEngine(config, { VECTORIZE: mockBinding })
  })

  describe('constructor', () => {
    it('should create engine with config', () => {
      expect(engine.name).toBe('vectorize')
      expect(engine.dimensions).toBe(1536)
    })
  })

  describe('insert', () => {
    it('should call Vectorize upsert', async () => {
      await engine.insert('vec-1', testVector(1536), { label: 'test' })
      expect(mockBinding.upsert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'vec-1',
          values: testVector(1536),
          metadata: { label: 'test' },
        }),
      ])
    })
  })

  describe('search', () => {
    it('should call Vectorize query', async () => {
      mockBinding.query.mockResolvedValue({
        matches: [{ id: 'vec-1', score: 0.95, metadata: {} }],
      })

      const results = await engine.search(testVector(1536), { limit: 10 })
      expect(mockBinding.query).toHaveBeenCalledWith(
        testVector(1536),
        expect.objectContaining({ topK: 10 })
      )
      expect(results.length).toBe(1)
    })

    it('should support metadata filtering', async () => {
      await engine.search(testVector(1536), {
        limit: 10,
        filter: { category: 'embeddings' },
      })
      expect(mockBinding.query).toHaveBeenCalledWith(
        testVector(1536),
        expect.objectContaining({ filter: { category: 'embeddings' } })
      )
    })

    it('should support namespace', async () => {
      const config: VectorTierConfig = { engine: 'vectorize', dimensions: 1536 }
      const e = new VectorizeEngine(config, { VECTORIZE: mockBinding }, { namespace: 'prod' })
      await e.search(testVector(1536), { limit: 10 })
      expect(mockBinding.query).toHaveBeenCalledWith(
        testVector(1536),
        expect.objectContaining({ namespace: 'prod' })
      )
    })
  })

  describe('delete', () => {
    it('should call Vectorize deleteByIds', async () => {
      mockBinding.deleteByIds.mockResolvedValue({ count: 1 })
      const result = await engine.delete('vec-1')
      expect(mockBinding.deleteByIds).toHaveBeenCalledWith(['vec-1'])
      expect(result).toBe(true)
    })
  })

  describe('count', () => {
    it('should call Vectorize describe', async () => {
      mockBinding.describe.mockResolvedValue({ vectorCount: 100 })
      const count = await engine.count()
      expect(count).toBe(100)
    })
  })
})

// ============================================================================
// CLICKHOUSE ENGINE TESTS
// ============================================================================

describe('ClickHouseEngine', () => {
  let engine: ClickHouseEngine
  let mockClient: any

  beforeEach(() => {
    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      insert: vi.fn().mockResolvedValue({ success: true }),
      command: vi.fn().mockResolvedValue({ success: true }),
    }

    const config: VectorTierConfig = {
      engine: 'clickhouse',
      dimensions: 768,
      index: 'usearch',
    }
    engine = new ClickHouseEngine(config, { CLICKHOUSE: mockClient })
  })

  describe('constructor', () => {
    it('should create engine with config', () => {
      expect(engine.name).toBe('clickhouse')
      expect(engine.dimensions).toBe(768)
      expect(engine.indexType).toBe('usearch')
    })

    it('should default to usearch index', () => {
      const config: VectorTierConfig = { engine: 'clickhouse', dimensions: 768 }
      const e = new ClickHouseEngine(config, { CLICKHOUSE: mockClient })
      expect(e.indexType).toBe('usearch')
    })

    it('should accept annoy index', () => {
      const config: VectorTierConfig = {
        engine: 'clickhouse',
        dimensions: 768,
        index: 'annoy',
      }
      const e = new ClickHouseEngine(config, { CLICKHOUSE: mockClient })
      expect(e.indexType).toBe('annoy')
    })

    it('should accept hnsw index', () => {
      const config: VectorTierConfig = {
        engine: 'clickhouse',
        dimensions: 768,
        index: 'hnsw',
      }
      const e = new ClickHouseEngine(config, { CLICKHOUSE: mockClient })
      expect(e.indexType).toBe('hnsw')
    })
  })

  describe('search', () => {
    it('should use L2Distance for euclidean metric', async () => {
      const config: VectorTierConfig = {
        engine: 'clickhouse',
        dimensions: 768,
        metric: 'euclidean',
      }
      const e = new ClickHouseEngine(config, { CLICKHOUSE: mockClient })
      await e.search(testVector(768), { limit: 10 })
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('L2Distance')
      )
    })

    it('should use cosineDistance for cosine metric', async () => {
      await engine.search(testVector(768), { limit: 10 })
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('cosineDistance')
      )
    })

    it('should support hybrid search with full-text', async () => {
      await engine.search(testVector(768), {
        limit: 10,
        hybridQuery: 'machine learning',
      } as any)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('multiSearchAny')
      )
    })
  })

  describe('batch insert', () => {
    it('should support batch inserts', async () => {
      await engine.insertBatch([
        { id: 'v1', vector: testVector(768), metadata: {} },
        { id: 'v2', vector: testVector(768), metadata: {} },
      ])
      expect(mockClient.insert).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// ICEBERG ENGINE TESTS
// ============================================================================

describe('IcebergEngine', () => {
  let engine: IcebergEngine
  let mockR2Sql: any

  beforeEach(() => {
    mockR2Sql = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      execute: vi.fn().mockResolvedValue({ success: true }),
    }

    const config: VectorTierConfig = { engine: 'iceberg', dimensions: 1536 }
    engine = new IcebergEngine(config, { R2_SQL: mockR2Sql })
  })

  describe('constructor', () => {
    it('should create engine with config', () => {
      expect(engine.name).toBe('iceberg')
      expect(engine.dimensions).toBe(1536)
    })
  })

  describe('search', () => {
    it('should use LSH for approximate search', async () => {
      await engine.search(testVector(1536), { limit: 10 })
      expect(mockR2Sql.query).toHaveBeenCalled()
    })

    it('should support clustering-based filtering', async () => {
      await engine.search(testVector(1536), {
        limit: 10,
        cluster: 'cluster-1',
      } as any)
      expect(mockR2Sql.query).toHaveBeenCalledWith(
        expect.stringContaining('cluster')
      )
    })
  })

  describe('product quantization', () => {
    it('should support PQ approximation', async () => {
      const config: VectorTierConfig = { engine: 'iceberg', dimensions: 1536 }
      const e = new IcebergEngine(config, { R2_SQL: mockR2Sql }, { pq: true })
      expect(e.usePQ).toBe(true)
    })
  })
})

// ============================================================================
// ENGINE FACTORY TESTS
// ============================================================================

describe('createEngine', () => {
  it('should create LibSQLEngine', () => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 128 }
    const engine = createEngine(config, {})
    expect(engine).toBeInstanceOf(LibSQLEngine)
  })

  it('should create EdgeVecEngine', () => {
    const config: VectorTierConfig = { engine: 'edgevec', dimensions: 128 }
    const engine = createEngine(config, { EDGEVEC: {} })
    expect(engine).toBeInstanceOf(EdgeVecEngine)
  })

  it('should create VectorizeEngine', () => {
    const config: VectorTierConfig = { engine: 'vectorize', dimensions: 1536 }
    const engine = createEngine(config, { VECTORIZE: {} })
    expect(engine).toBeInstanceOf(VectorizeEngine)
  })

  it('should create ClickHouseEngine', () => {
    const config: VectorTierConfig = { engine: 'clickhouse', dimensions: 768 }
    const engine = createEngine(config, { CLICKHOUSE: {} })
    expect(engine).toBeInstanceOf(ClickHouseEngine)
  })

  it('should create IcebergEngine', () => {
    const config: VectorTierConfig = { engine: 'iceberg', dimensions: 1536 }
    const engine = createEngine(config, { R2_SQL: {} })
    expect(engine).toBeInstanceOf(IcebergEngine)
  })

  it('should throw for unknown engine', () => {
    const config = { engine: 'unknown', dimensions: 128 } as any
    expect(() => createEngine(config, {})).toThrow(/unknown engine/i)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Engine integration', () => {
  it('should work with VectorRouter pattern', async () => {
    // Create engines with same interface
    const libsqlConfig: VectorTierConfig = { engine: 'libsql', dimensions: 128 }
    const hot = new LibSQLEngine(libsqlConfig, {})

    // Insert into hot tier
    await hot.insert('vec-1', testVector(128), { tier: 'hot' })

    // Search should find it
    const results = await hot.search(testVector(128), { limit: 1 })
    expect(results.length).toBe(1)
    expect(results[0].metadata.tier).toBe('hot')
  })
})
