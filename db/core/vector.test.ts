/**
 * VectorManager tests
 *
 * Tests for tiered vector search management:
 * - Engine support (libsql, edgevec, vectorize, clickhouse, iceberg)
 * - Routing strategies (cascade, parallel, smart)
 * - Tiered storage (hot/warm/cold)
 * - Vector operations (insert, search, delete)
 * - Metrics (cosine, euclidean, dot product)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VectorConfig, VectorTierConfig } from './types'
import {
  VectorManager,
  createVectorEngine,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
} from './vector'

// ============================================================================
// MATH UTILITIES TESTS
// ============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = [1, 0, 0]
    const b = [1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
  })

  it('should handle normalized vectors', () => {
    const a = [0.6, 0.8, 0]
    const b = [0.8, 0.6, 0]
    const result = cosineSimilarity(a, b)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
  })

  it('should handle arbitrary dimension vectors', () => {
    const a = [1, 2, 3, 4, 5]
    const b = [5, 4, 3, 2, 1]
    const result = cosineSimilarity(a, b)
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

describe('euclideanDistance', () => {
  it('should return 0 for identical vectors', () => {
    const a = [1, 2, 3]
    const b = [1, 2, 3]
    expect(euclideanDistance(a, b)).toBe(0)
  })

  it('should return correct distance for simple vectors', () => {
    const a = [0, 0, 0]
    const b = [3, 4, 0]
    expect(euclideanDistance(a, b)).toBe(5) // 3-4-5 triangle
  })

  it('should be symmetric', () => {
    const a = [1, 2, 3]
    const b = [4, 5, 6]
    expect(euclideanDistance(a, b)).toBe(euclideanDistance(b, a))
  })

  it('should handle high-dimensional vectors', () => {
    const a = Array(128).fill(0)
    const b = Array(128).fill(1)
    const result = euclideanDistance(a, b)
    expect(result).toBeCloseTo(Math.sqrt(128), 5)
  })
})

describe('dotProduct', () => {
  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(dotProduct(a, b)).toBe(0)
  })

  it('should return sum of squares for same vector', () => {
    const a = [1, 2, 3]
    expect(dotProduct(a, a)).toBe(14) // 1+4+9
  })

  it('should be commutative', () => {
    const a = [1, 2, 3]
    const b = [4, 5, 6]
    expect(dotProduct(a, b)).toBe(dotProduct(b, a))
  })

  it('should handle negative values', () => {
    const a = [1, -2, 3]
    const b = [-1, 2, -3]
    expect(dotProduct(a, b)).toBe(-14) // -1-4-9
  })
})

describe('normalizeVector', () => {
  it('should return unit vector', () => {
    const v = [3, 4, 0]
    const normalized = normalizeVector(v)
    const magnitude = Math.sqrt(normalized.reduce((sum, x) => sum + x * x, 0))
    expect(magnitude).toBeCloseTo(1, 5)
  })

  it('should preserve direction', () => {
    const v = [2, 0, 0]
    const normalized = normalizeVector(v)
    expect(normalized[0]).toBeCloseTo(1, 5)
    expect(normalized[1]).toBeCloseTo(0, 5)
    expect(normalized[2]).toBeCloseTo(0, 5)
  })

  it('should handle zero vector gracefully', () => {
    const v = [0, 0, 0]
    const normalized = normalizeVector(v)
    expect(normalized).toEqual([0, 0, 0])
  })
})

// ============================================================================
// MOCK ENGINES
// ============================================================================

const createMockEngine = (name: string) => ({
  name,
  insert: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(true),
  count: vi.fn().mockResolvedValue(0),
})

// ============================================================================
// CREATE VECTOR ENGINE TESTS
// ============================================================================

describe('createVectorEngine', () => {
  it('should create libsql engine', () => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine).toBeDefined()
    expect(engine.name).toBe('libsql')
  })

  it('should create edgevec engine', () => {
    const config: VectorTierConfig = { engine: 'edgevec', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine).toBeDefined()
    expect(engine.name).toBe('edgevec')
  })

  it('should create vectorize engine', () => {
    const config: VectorTierConfig = { engine: 'vectorize', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine).toBeDefined()
    expect(engine.name).toBe('vectorize')
  })

  it('should create clickhouse engine', () => {
    const config: VectorTierConfig = { engine: 'clickhouse', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine).toBeDefined()
    expect(engine.name).toBe('clickhouse')
  })

  it('should create iceberg engine', () => {
    const config: VectorTierConfig = { engine: 'iceberg', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine).toBeDefined()
    expect(engine.name).toBe('iceberg')
  })

  it('should pass dimensions to engine', () => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 256 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine.dimensions).toBe(256)
  })

  it('should use default cosine metric', () => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 128 }
    const engine = createVectorEngine(config, {} as any)
    expect(engine.metric).toBe('cosine')
  })

  it('should accept custom metric', () => {
    const config: VectorTierConfig = { engine: 'libsql', dimensions: 128, metric: 'euclidean' }
    const engine = createVectorEngine(config, {} as any)
    expect(engine.metric).toBe('euclidean')
  })
})

// ============================================================================
// VECTOR MANAGER TESTS
// ============================================================================

describe('VectorManager', () => {
  describe('constructor', () => {
    it('should create manager with default config', () => {
      const manager = new VectorManager({} as any)
      expect(manager).toBeInstanceOf(VectorManager)
    })

    it('should create manager with custom config', () => {
      const config: VectorConfig = {
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          warm: { engine: 'vectorize', dimensions: 128 },
        },
        routing: { strategy: 'cascade' },
      }
      const manager = new VectorManager({} as any, config)
      expect(manager.config.tiers.hot?.engine).toBe('libsql')
      expect(manager.config.tiers.warm?.engine).toBe('vectorize')
    })

    it('should initialize engines for each tier', () => {
      const config: VectorConfig = {
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          cold: { engine: 'iceberg', dimensions: 128 },
        },
        routing: { strategy: 'cascade' },
      }
      const manager = new VectorManager({} as any, config)
      expect(manager.hasEngine('hot')).toBe(true)
      expect(manager.hasEngine('warm')).toBe(false)
      expect(manager.hasEngine('cold')).toBe(true)
    })
  })

  describe('insert', () => {
    it('should insert vector into hot tier', async () => {
      const mockHot = createMockEngine('libsql')
      const manager = new VectorManager({} as any)
      manager._setEngine('hot', mockHot as any)

      await manager.insert('vec-1', [0.1, 0.2, 0.3], { label: 'test' })

      expect(mockHot.insert).toHaveBeenCalledWith('vec-1', [0.1, 0.2, 0.3], { label: 'test' })
    })

    it('should batch insert multiple vectors', async () => {
      const mockHot = createMockEngine('libsql')
      const manager = new VectorManager({} as any)
      manager._setEngine('hot', mockHot as any)

      await manager.insertBatch([
        { id: 'vec-1', vector: [0.1, 0.2], metadata: {} },
        { id: 'vec-2', vector: [0.3, 0.4], metadata: {} },
      ])

      expect(mockHot.insert).toHaveBeenCalledTimes(2)
    })

    it('should insert into specific tier', async () => {
      const mockWarm = createMockEngine('vectorize')
      const manager = new VectorManager({} as any)
      manager._setEngine('warm', mockWarm as any)

      await manager.insert('vec-1', [0.1, 0.2], {}, 'warm')

      expect(mockWarm.insert).toHaveBeenCalled()
    })
  })

  describe('search - cascade strategy', () => {
    it('should search hot tier first', async () => {
      const mockHot = createMockEngine('libsql')
      mockHot.search.mockResolvedValue([
        { id: 'vec-1', score: 0.95, metadata: {} },
      ])

      const manager = new VectorManager({} as any, {
        tiers: { hot: { engine: 'libsql', dimensions: 3 } },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('hot', mockHot as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(mockHot.search).toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('vec-1')
    })

    it('should fall back to warm tier when hot returns empty', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([])
      mockWarm.search.mockResolvedValue([
        { id: 'vec-2', score: 0.8, metadata: {} },
      ])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: true },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(mockHot.search).toHaveBeenCalled()
      expect(mockWarm.search).toHaveBeenCalled()
      expect(results[0].id).toBe('vec-2')
    })

    it('should not fall back when fallback is false', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'cascade', fallback: false },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(mockHot.search).toHaveBeenCalled()
      expect(mockWarm.search).not.toHaveBeenCalled()
      expect(results).toHaveLength(0)
    })
  })

  describe('search - parallel strategy', () => {
    it('should search all tiers simultaneously', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([{ id: 'hot-1', score: 0.9, metadata: {} }])
      mockWarm.search.mockResolvedValue([{ id: 'warm-1', score: 0.85, metadata: {} }])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'parallel' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(mockHot.search).toHaveBeenCalled()
      expect(mockWarm.search).toHaveBeenCalled()
      expect(results).toHaveLength(2)
    })

    it('should merge and sort results by score', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([{ id: 'hot-1', score: 0.8, metadata: {} }])
      mockWarm.search.mockResolvedValue([{ id: 'warm-1', score: 0.95, metadata: {} }])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'parallel' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(results[0].id).toBe('warm-1') // Higher score first
      expect(results[1].id).toBe('hot-1')
    })

    it('should apply limit after merging', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([
        { id: 'hot-1', score: 0.9, metadata: {} },
        { id: 'hot-2', score: 0.7, metadata: {} },
      ])
      mockWarm.search.mockResolvedValue([
        { id: 'warm-1', score: 0.85, metadata: {} },
        { id: 'warm-2', score: 0.65, metadata: {} },
      ])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'parallel' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 2 })

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('hot-1') // 0.9
      expect(results[1].id).toBe('warm-1') // 0.85
    })
  })

  describe('search - smart strategy', () => {
    it('should use hot tier for small result sets', async () => {
      const mockHot = createMockEngine('libsql')
      const mockCold = createMockEngine('iceberg')
      mockHot.count.mockResolvedValue(100) // Small dataset
      mockHot.search.mockResolvedValue([{ id: 'hot-1', score: 0.9, metadata: {} }])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          cold: { engine: 'iceberg', dimensions: 3 },
        },
        routing: { strategy: 'smart' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('cold', mockCold as any)

      const results = await manager.search([0.1, 0.2, 0.3], { limit: 10 })

      expect(mockHot.search).toHaveBeenCalled()
      expect(mockCold.search).not.toHaveBeenCalled()
    })

    it('should use cold tier for large result sets', async () => {
      const mockHot = createMockEngine('libsql')
      const mockCold = createMockEngine('iceberg')
      mockHot.count.mockResolvedValue(100)
      mockCold.count.mockResolvedValue(1000000) // Large dataset
      mockCold.search.mockResolvedValue([{ id: 'cold-1', score: 0.9, metadata: {} }])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          cold: { engine: 'iceberg', dimensions: 3 },
        },
        routing: { strategy: 'smart' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('cold', mockCold as any)

      // Trigger smart routing to cold tier
      const results = await manager.search([0.1, 0.2, 0.3], { limit: 1000, tier: 'cold' })

      expect(mockCold.search).toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('should delete from hot tier', async () => {
      const mockHot = createMockEngine('libsql')
      mockHot.delete.mockResolvedValue(true)

      const manager = new VectorManager({} as any)
      manager._setEngine('hot', mockHot as any)

      const result = await manager.delete('vec-1')

      expect(mockHot.delete).toHaveBeenCalledWith('vec-1')
      expect(result).toBe(true)
    })

    it('should delete from all tiers', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.delete.mockResolvedValue(true)
      mockWarm.delete.mockResolvedValue(true)

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      await manager.deleteFromAllTiers('vec-1')

      expect(mockHot.delete).toHaveBeenCalledWith('vec-1')
      expect(mockWarm.delete).toHaveBeenCalledWith('vec-1')
    })
  })

  describe('promote/demote', () => {
    it('should promote vector from hot to warm', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([
        { id: 'vec-1', vector: [0.1, 0.2], score: 1, metadata: { label: 'test' } },
      ])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 2 },
          warm: { engine: 'vectorize', dimensions: 2 },
        },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      await manager.promote('vec-1', 'hot', 'warm')

      expect(mockWarm.insert).toHaveBeenCalled()
      expect(mockHot.delete).toHaveBeenCalledWith('vec-1')
    })

    it('should demote vector from warm to cold', async () => {
      const mockWarm = createMockEngine('vectorize')
      const mockCold = createMockEngine('iceberg')
      mockWarm.search.mockResolvedValue([
        { id: 'vec-1', vector: [0.1, 0.2], score: 1, metadata: {} },
      ])

      const manager = new VectorManager({} as any, {
        tiers: {
          warm: { engine: 'vectorize', dimensions: 2 },
          cold: { engine: 'iceberg', dimensions: 2 },
        },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('warm', mockWarm as any)
      manager._setEngine('cold', mockCold as any)

      await manager.demote('vec-1', 'warm', 'cold')

      expect(mockCold.insert).toHaveBeenCalled()
      expect(mockWarm.delete).toHaveBeenCalledWith('vec-1')
    })
  })

  describe('count', () => {
    it('should return count from specified tier', async () => {
      const mockHot = createMockEngine('libsql')
      mockHot.count.mockResolvedValue(42)

      const manager = new VectorManager({} as any)
      manager._setEngine('hot', mockHot as any)

      const count = await manager.count('hot')

      expect(count).toBe(42)
    })

    it('should return total count across all tiers', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.count.mockResolvedValue(100)
      mockWarm.count.mockResolvedValue(200)

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 3 },
          warm: { engine: 'vectorize', dimensions: 3 },
        },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const count = await manager.countAll()

      expect(count).toBe(300)
    })
  })

  describe('getById', () => {
    it('should retrieve vector by ID from hot tier', async () => {
      const mockHot = createMockEngine('libsql')
      mockHot.search.mockResolvedValue([
        { id: 'vec-1', vector: [0.1, 0.2], score: 1, metadata: { label: 'test' } },
      ])

      const manager = new VectorManager({} as any)
      manager._setEngine('hot', mockHot as any)

      const result = await manager.getById('vec-1')

      expect(result).toBeDefined()
      expect(result?.id).toBe('vec-1')
    })

    it('should search all tiers for vector', async () => {
      const mockHot = createMockEngine('libsql')
      const mockWarm = createMockEngine('vectorize')
      mockHot.search.mockResolvedValue([])
      mockWarm.search.mockResolvedValue([
        { id: 'vec-1', vector: [0.1, 0.2], score: 1, metadata: {} },
      ])

      const manager = new VectorManager({} as any, {
        tiers: {
          hot: { engine: 'libsql', dimensions: 2 },
          warm: { engine: 'vectorize', dimensions: 2 },
        },
        routing: { strategy: 'cascade' },
      })
      manager._setEngine('hot', mockHot as any)
      manager._setEngine('warm', mockWarm as any)

      const result = await manager.getById('vec-1')

      expect(result?.id).toBe('vec-1')
    })
  })
})

// ============================================================================
// SEARCH OPTIONS TESTS
// ============================================================================

describe('VectorManager search options', () => {
  it('should support filter parameter', async () => {
    const mockHot = createMockEngine('libsql')
    mockHot.search.mockResolvedValue([])

    const manager = new VectorManager({} as any)
    manager._setEngine('hot', mockHot as any)

    await manager.search([0.1, 0.2], {
      limit: 10,
      filter: { category: 'embeddings' },
    })

    expect(mockHot.search).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({ filter: { category: 'embeddings' } })
    )
  })

  it('should support threshold parameter', async () => {
    const mockHot = createMockEngine('libsql')
    mockHot.search.mockResolvedValue([
      { id: 'vec-1', score: 0.9, metadata: {} },
      { id: 'vec-2', score: 0.5, metadata: {} },
    ])

    const manager = new VectorManager({} as any)
    manager._setEngine('hot', mockHot as any)

    const results = await manager.search([0.1, 0.2], {
      limit: 10,
      threshold: 0.7,
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('vec-1')
  })

  it('should support includeVectors parameter', async () => {
    const mockHot = createMockEngine('libsql')
    mockHot.search.mockResolvedValue([
      { id: 'vec-1', score: 0.9, vector: [0.1, 0.2], metadata: {} },
    ])

    const manager = new VectorManager({} as any)
    manager._setEngine('hot', mockHot as any)

    const results = await manager.search([0.1, 0.2], {
      limit: 10,
      includeVectors: true,
    })

    expect(results[0].vector).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('VectorManager integration', () => {
  it('should work with realistic tiered config', async () => {
    const config: VectorConfig = {
      tiers: {
        hot: { engine: 'libsql', dimensions: 1536, metric: 'cosine' },
        warm: { engine: 'vectorize', dimensions: 1536, metric: 'cosine' },
        cold: { engine: 'iceberg', dimensions: 1536, metric: 'cosine' },
      },
      routing: { strategy: 'cascade', fallback: true, rerank: true },
    }

    const manager = new VectorManager({} as any, config)

    expect(manager.config.tiers.hot?.engine).toBe('libsql')
    expect(manager.config.tiers.warm?.engine).toBe('vectorize')
    expect(manager.config.tiers.cold?.engine).toBe('iceberg')
    expect(manager.config.routing.rerank).toBe(true)
  })

  it('should use ClickHouse with specific index', async () => {
    const config: VectorConfig = {
      tiers: {
        hot: { engine: 'clickhouse', dimensions: 768, index: 'usearch' },
      },
      routing: { strategy: 'cascade' },
    }

    const manager = new VectorManager({} as any, config)

    expect(manager.config.tiers.hot?.index).toBe('usearch')
  })
})
