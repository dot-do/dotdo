/**
 * DuckDB VSS (Vector Similarity Search) Extension Tests
 *
 * RED phase TDD tests for VSS extension wrapper.
 * These tests define the API contract for vector similarity search.
 *
 * Test Categories:
 * 1. Index creation with different distance metrics
 * 2. Basic k-NN search
 * 3. Search with filters
 * 4. Memory estimation helper
 *
 * @see https://duckdb.org/docs/extensions/vss
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'

import {
  createDuckDB,
  type DuckDBInstance,
} from '../../index'

import {
  loadVSS,
  createVectorIndex,
  dropVectorIndex,
  search,
  getIndexStats,
  estimateMemory,
  type VSSExtensionState,
} from '../index'

import type {
  VectorIndexConfig,
  SearchResult,
  IndexStats,
  DistanceMetric,
  MemoryEstimation,
} from '../types'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random vector of given dimensions (normalized)
 */
function randomVector(dimensions: number): number[] {
  const vec: number[] = []
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    const v = Math.random() * 2 - 1
    vec.push(v)
    norm += v * v
  }
  norm = Math.sqrt(norm)
  return vec.map((v) => v / norm)
}

/**
 * Generate a vector similar to target with some noise
 */
function similarVector(target: number[], noise: number = 0.1): number[] {
  const vec: number[] = []
  let norm = 0
  for (let i = 0; i < target.length; i++) {
    const v = target[i] + (Math.random() * 2 - 1) * noise
    vec.push(v)
    norm += v * v
  }
  norm = Math.sqrt(norm)
  return vec.map((v) => v / norm)
}

/**
 * Convert vector to SQL array literal
 */
function vectorToSQL(vec: number[]): string {
  return `[${vec.join(', ')}]::FLOAT[${vec.length}]`
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DuckDB VSS Extension', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  // ============================================================================
  // 1. EXTENSION LOADING
  // ============================================================================

  describe('Extension Loading', () => {
    it('should load the VSS extension', async () => {
      const state = await loadVSS(db)

      expect(state.loaded).toBe(true)
      expect(state.error).toBeUndefined()
    })

    it('should report extension version after loading', async () => {
      const state = await loadVSS(db)

      expect(state.loaded).toBe(true)
      expect(state.version).toBeDefined()
      expect(typeof state.version).toBe('string')
    })

    it('should be idempotent (multiple loads succeed)', async () => {
      const state1 = await loadVSS(db)
      const state2 = await loadVSS(db)

      expect(state1.loaded).toBe(true)
      expect(state2.loaded).toBe(true)
    })
  })

  // ============================================================================
  // 2. INDEX CREATION
  // ============================================================================

  describe('Index Creation', () => {
    const dimensions = 128

    beforeEach(async () => {
      // Ensure VSS is loaded
      await loadVSS(db)

      // Create test table with vector column
      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_test_items (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          category VARCHAR,
          embedding FLOAT[${dimensions}]
        )
      `)

      // Insert test data
      for (let i = 0; i < 100; i++) {
        const vec = randomVector(dimensions)
        await db.query(
          `INSERT INTO vss_test_items VALUES ($1, $2, $3, ${vectorToSQL(vec)})`,
          [i, `item-${i}`, i % 3 === 0 ? 'electronics' : i % 3 === 1 ? 'clothing' : 'food']
        )
      }
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_test_items')
    })

    it('should create a vector index with default options', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
      })

      // Verify index exists by querying it
      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.vectorCount).toBe(100)
      expect(stats.dimensions).toBe(dimensions)
    })

    it('should create index with L2 squared distance (default)', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
        metric: 'l2sq',
      })

      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.metric).toBe('l2sq')
    })

    it('should create index with cosine distance', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
        metric: 'cosine',
      })

      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.metric).toBe('cosine')
    })

    it('should create index with inner product distance', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
        metric: 'ip',
      })

      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.metric).toBe('ip')
    })

    it('should create index with custom HNSW parameters', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
        M: 32,
        efConstruction: 300,
        efSearch: 128,
      })

      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.M).toBe(32)
      expect(stats.efConstruction).toBe(300)
      expect(stats.efSearch).toBe(128)
    })

    it('should create index with custom name', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', {
        dimensions,
        indexName: 'my_custom_index',
      })

      const stats = await getIndexStats(db, 'vss_test_items', 'embedding')
      expect(stats.name).toBe('my_custom_index')
    })

    it('should fail silently with IF NOT EXISTS by default', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', { dimensions })

      // Second creation should not throw
      await expect(
        createVectorIndex(db, 'vss_test_items', 'embedding', { dimensions })
      ).resolves.not.toThrow()
    })

    it('should throw when failIfExists is true and index exists', async () => {
      await createVectorIndex(db, 'vss_test_items', 'embedding', { dimensions })

      await expect(
        createVectorIndex(db, 'vss_test_items', 'embedding', {
          dimensions,
          failIfExists: true,
        })
      ).rejects.toThrow(/already exists/)
    })
  })

  // ============================================================================
  // 3. INDEX DELETION
  // ============================================================================

  describe('Index Deletion', () => {
    const dimensions = 64

    beforeEach(async () => {
      await loadVSS(db)
      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_drop_test (
          id INTEGER PRIMARY KEY,
          embedding FLOAT[${dimensions}]
        )
      `)
      for (let i = 0; i < 50; i++) {
        const vec = randomVector(dimensions)
        await db.query(
          `INSERT INTO vss_drop_test VALUES ($1, ${vectorToSQL(vec)})`,
          [i]
        )
      }
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_drop_test')
    })

    it('should drop an existing index', async () => {
      await createVectorIndex(db, 'vss_drop_test', 'embedding', { dimensions })
      await dropVectorIndex(db, 'vss_drop_test', 'embedding')

      // Should throw when trying to get stats of non-existent index
      await expect(
        getIndexStats(db, 'vss_drop_test', 'embedding')
      ).rejects.toThrow()
    })

    it('should not throw when dropping non-existent index', async () => {
      await expect(
        dropVectorIndex(db, 'vss_drop_test', 'embedding')
      ).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // 4. BASIC K-NN SEARCH
  // ============================================================================

  describe('Basic k-NN Search', () => {
    const dimensions = 128
    let targetVector: number[]
    let similarVectors: number[][] = []

    beforeEach(async () => {
      await loadVSS(db)

      // Create table
      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_search_test (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          embedding FLOAT[${dimensions}]
        )
      `)

      // Create target vector
      targetVector = randomVector(dimensions)

      // Insert target
      await db.query(
        `INSERT INTO vss_search_test VALUES (0, 'target', ${vectorToSQL(targetVector)})`
      )

      // Insert similar vectors (close to target)
      similarVectors = []
      for (let i = 1; i <= 10; i++) {
        const vec = similarVector(targetVector, 0.1)
        similarVectors.push(vec)
        await db.query(
          `INSERT INTO vss_search_test VALUES ($1, $2, ${vectorToSQL(vec)})`,
          [i, `similar-${i}`]
        )
      }

      // Insert random vectors (far from target)
      for (let i = 11; i < 100; i++) {
        const vec = randomVector(dimensions)
        await db.query(
          `INSERT INTO vss_search_test VALUES ($1, $2, ${vectorToSQL(vec)})`,
          [i, `random-${i}`]
        )
      }

      // Create index
      await createVectorIndex(db, 'vss_search_test', 'embedding', {
        dimensions,
        metric: 'cosine',
      })
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_search_test')
    })

    it('should find the exact vector', async () => {
      const results = await search(db, 'vss_search_test', 'embedding', targetVector, {
        k: 1,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe(0)
      expect(results[0].distance).toBeCloseTo(0, 5) // cosine distance = 0 for identical
    })

    it('should return k results', async () => {
      const results = await search(db, 'vss_search_test', 'embedding', targetVector, {
        k: 10,
      })

      expect(results.length).toBe(10)
    })

    it('should return results sorted by distance (ascending)', async () => {
      const results = await search(db, 'vss_search_test', 'embedding', targetVector, {
        k: 10,
      })

      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance)
      }
    })

    it('should find similar vectors before random ones', async () => {
      const results = await search(db, 'vss_search_test', 'embedding', targetVector, {
        k: 15,
      })

      // First 11 results should be target + similar vectors
      const topIds = results.slice(0, 11).map((r) => r.id)
      expect(topIds).toContain(0) // target

      // Most similar vectors should be in top results
      let similarCount = 0
      for (const r of results.slice(0, 11)) {
        if (typeof r.id === 'number' && r.id >= 1 && r.id <= 10) {
          similarCount++
        }
      }
      expect(similarCount).toBeGreaterThanOrEqual(8) // At least 8 of 10 similar should be in top 11
    })

    it('should return additional columns when select is specified', async () => {
      const results = await search<{ name: string }>(
        db,
        'vss_search_test',
        'embedding',
        targetVector,
        {
          k: 5,
          select: ['name'],
        }
      )

      expect(results.length).toBe(5)
      expect(results[0].data?.name).toBe('target')
    })

    it('should handle k larger than row count', async () => {
      const results = await search(db, 'vss_search_test', 'embedding', targetVector, {
        k: 1000,
      })

      expect(results.length).toBe(100) // Only 100 rows exist
    })

    it('should use custom idColumn', async () => {
      // Create table with different ID column name
      await db.query(`
        CREATE TABLE vss_custom_id (
          item_id INTEGER PRIMARY KEY,
          embedding FLOAT[${dimensions}]
        )
      `)

      const vec = randomVector(dimensions)
      await db.query(
        `INSERT INTO vss_custom_id VALUES (42, ${vectorToSQL(vec)})`
      )

      await createVectorIndex(db, 'vss_custom_id', 'embedding', { dimensions })

      const results = await search(db, 'vss_custom_id', 'embedding', vec, {
        k: 1,
        idColumn: 'item_id',
      })

      expect(results[0].id).toBe(42)

      await db.query('DROP TABLE vss_custom_id')
    })
  })

  // ============================================================================
  // 5. SEARCH WITH FILTERS
  // ============================================================================

  describe('Search with Filters', () => {
    const dimensions = 64

    beforeEach(async () => {
      await loadVSS(db)

      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_filter_test (
          id INTEGER PRIMARY KEY,
          category VARCHAR,
          price DECIMAL(10,2),
          in_stock BOOLEAN,
          embedding FLOAT[${dimensions}]
        )
      `)

      // Insert varied data
      for (let i = 0; i < 100; i++) {
        const vec = randomVector(dimensions)
        const category = i % 3 === 0 ? 'electronics' : i % 3 === 1 ? 'clothing' : 'food'
        const price = (Math.random() * 1000).toFixed(2)
        const inStock = i % 2 === 0

        await db.query(
          `INSERT INTO vss_filter_test VALUES ($1, $2, $3, $4, ${vectorToSQL(vec)})`,
          [i, category, price, inStock]
        )
      }

      await createVectorIndex(db, 'vss_filter_test', 'embedding', { dimensions })
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_filter_test')
    })

    it('should filter by category', async () => {
      const query = randomVector(dimensions)

      const results = await search<{ category: string }>(
        db,
        'vss_filter_test',
        'embedding',
        query,
        {
          k: 20,
          filter: "category = 'electronics'",
          select: ['category'],
        }
      )

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.data?.category).toBe('electronics')
      })
    })

    it('should filter by numeric comparison', async () => {
      const query = randomVector(dimensions)

      const results = await search<{ price: number }>(
        db,
        'vss_filter_test',
        'embedding',
        query,
        {
          k: 10,
          filter: 'price < 100',
          select: ['price'],
        }
      )

      results.forEach((r) => {
        expect(Number(r.data?.price)).toBeLessThan(100)
      })
    })

    it('should filter by boolean', async () => {
      const query = randomVector(dimensions)

      const results = await search<{ in_stock: boolean }>(
        db,
        'vss_filter_test',
        'embedding',
        query,
        {
          k: 30,
          filter: 'in_stock = true',
          select: ['in_stock'],
        }
      )

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(r.data?.in_stock).toBe(true)
      })
    })

    it('should filter with compound conditions', async () => {
      const query = randomVector(dimensions)

      const results = await search<{ category: string; price: number }>(
        db,
        'vss_filter_test',
        'embedding',
        query,
        {
          k: 10,
          filter: "category = 'electronics' AND price > 500",
          select: ['category', 'price'],
        }
      )

      results.forEach((r) => {
        expect(r.data?.category).toBe('electronics')
        expect(Number(r.data?.price)).toBeGreaterThan(500)
      })
    })

    it('should return empty results when filter matches nothing', async () => {
      const query = randomVector(dimensions)

      const results = await search(
        db,
        'vss_filter_test',
        'embedding',
        query,
        {
          k: 10,
          filter: "category = 'nonexistent'",
        }
      )

      expect(results.length).toBe(0)
    })
  })

  // ============================================================================
  // 6. DISTANCE METRICS
  // ============================================================================

  describe('Distance Metrics', () => {
    const dimensions = 64

    beforeEach(async () => {
      await loadVSS(db)
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_metric_test')
    })

    const metrics: DistanceMetric[] = ['l2sq', 'l2', 'cosine', 'ip']

    for (const metric of metrics) {
      it(`should work with ${metric} distance metric`, async () => {
        await db.query(`
          CREATE TABLE vss_metric_test (
            id INTEGER PRIMARY KEY,
            embedding FLOAT[${dimensions}]
          )
        `)

        const target = randomVector(dimensions)

        // Insert target
        await db.query(`INSERT INTO vss_metric_test VALUES (0, ${vectorToSQL(target)})`)

        // Insert some random vectors
        for (let i = 1; i < 50; i++) {
          const vec = randomVector(dimensions)
          await db.query(`INSERT INTO vss_metric_test VALUES ($1, ${vectorToSQL(vec)})`, [i])
        }

        await createVectorIndex(db, 'vss_metric_test', 'embedding', {
          dimensions,
          metric,
        })

        const results = await search(db, 'vss_metric_test', 'embedding', target, { k: 1 })

        expect(results.length).toBe(1)
        expect(results[0].id).toBe(0) // Should find exact match

        await db.query('DROP TABLE vss_metric_test')
      })
    }
  })

  // ============================================================================
  // 7. MEMORY ESTIMATION
  // ============================================================================

  describe('Memory Estimation', () => {
    it('should estimate memory for small dataset', () => {
      const estimate = estimateMemory({
        vectorCount: 10_000,
        dimensions: 128,
      })

      expect(estimate.totalBytes).toBeGreaterThan(0)
      expect(estimate.vectorBytes).toBeGreaterThan(0)
      expect(estimate.graphBytes).toBeGreaterThan(0)
      expect(estimate.humanReadable).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/)
    })

    it('should estimate memory for 1M vectors at 768 dimensions', () => {
      const estimate = estimateMemory({
        vectorCount: 1_000_000,
        dimensions: 768,
      })

      // ~3.4GB as mentioned in research notes
      expect(estimate.totalBytes).toBeGreaterThan(3 * 1024 * 1024 * 1024)
      expect(estimate.totalBytes).toBeLessThan(5 * 1024 * 1024 * 1024)
      expect(estimate.humanReadable).toContain('GB')
    })

    it('should scale linearly with vector count', () => {
      const small = estimateMemory({
        vectorCount: 10_000,
        dimensions: 128,
      })

      const large = estimateMemory({
        vectorCount: 100_000,
        dimensions: 128,
      })

      // Large should be roughly 10x small (with some overhead tolerance)
      const ratio = large.totalBytes / small.totalBytes
      expect(ratio).toBeGreaterThan(8)
      expect(ratio).toBeLessThan(12)
    })

    it('should scale linearly with dimensions', () => {
      const small = estimateMemory({
        vectorCount: 10_000,
        dimensions: 128,
      })

      const large = estimateMemory({
        vectorCount: 10_000,
        dimensions: 256,
      })

      // Vector bytes should double, graph stays same
      expect(large.vectorBytes).toBeCloseTo(small.vectorBytes * 2, -1)
    })

    it('should account for M parameter in graph size', () => {
      const smallM = estimateMemory({
        vectorCount: 10_000,
        dimensions: 128,
        M: 8,
      })

      const largeM = estimateMemory({
        vectorCount: 10_000,
        dimensions: 128,
        M: 32,
      })

      // Larger M = more connections = more memory
      expect(largeM.graphBytes).toBeGreaterThan(smallM.graphBytes)
    })
  })

  // ============================================================================
  // 8. ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    const dimensions = 64

    beforeEach(async () => {
      await loadVSS(db)
      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_error_test (
          id INTEGER PRIMARY KEY,
          embedding FLOAT[${dimensions}]
        )
      `)
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_error_test')
    })

    it('should throw on dimension mismatch in search', async () => {
      const vec = randomVector(dimensions)
      await db.query(`INSERT INTO vss_error_test VALUES (1, ${vectorToSQL(vec)})`)
      await createVectorIndex(db, 'vss_error_test', 'embedding', { dimensions })

      // Search with wrong dimensions
      const wrongDimVector = randomVector(dimensions * 2)

      await expect(
        search(db, 'vss_error_test', 'embedding', wrongDimVector, { k: 1 })
      ).rejects.toThrow(/dimension/)
    })

    it('should throw on non-existent table', async () => {
      const vec = randomVector(dimensions)

      await expect(
        search(db, 'nonexistent_table', 'embedding', vec, { k: 1 })
      ).rejects.toThrow()
    })

    it('should throw on non-existent column', async () => {
      const vec = randomVector(dimensions)
      await db.query(`INSERT INTO vss_error_test VALUES (1, ${vectorToSQL(vec)})`)

      await expect(
        createVectorIndex(db, 'vss_error_test', 'nonexistent_column', { dimensions })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // 9. PERFORMANCE CHARACTERISTICS
  // ============================================================================

  describe('Performance Characteristics', () => {
    const dimensions = 128
    const vectorCount = 10_000

    beforeEach(async () => {
      await loadVSS(db)

      await db.query(`
        CREATE TABLE IF NOT EXISTS vss_perf_test (
          id INTEGER PRIMARY KEY,
          embedding FLOAT[${dimensions}]
        )
      `)

      // Insert 10K vectors
      for (let i = 0; i < vectorCount; i++) {
        const vec = randomVector(dimensions)
        await db.query(`INSERT INTO vss_perf_test VALUES ($1, ${vectorToSQL(vec)})`, [i])
      }

      await createVectorIndex(db, 'vss_perf_test', 'embedding', { dimensions })
    })

    afterEach(async () => {
      await db.query('DROP TABLE IF EXISTS vss_perf_test')
    })

    it('should complete k-NN search on 10K vectors in reasonable time', async () => {
      const query = randomVector(dimensions)

      const startTime = performance.now()

      const results = await search(db, 'vss_perf_test', 'embedding', query, { k: 10 })

      const elapsed = performance.now() - startTime

      expect(results.length).toBe(10)

      console.log(`k-NN search on 10K vectors: ${elapsed.toFixed(2)}ms`)

      // Should complete in under 100ms (HNSW is O(log n))
      expect(elapsed).toBeLessThan(100)
    })

    it('should handle multiple concurrent searches', async () => {
      const startTime = performance.now()

      // Run 10 concurrent searches
      const searches = Array.from({ length: 10 }, () =>
        search(db, 'vss_perf_test', 'embedding', randomVector(dimensions), { k: 10 })
      )

      const results = await Promise.all(searches)

      const elapsed = performance.now() - startTime

      expect(results).toHaveLength(10)
      results.forEach((r) => expect(r.length).toBe(10))

      console.log(`10 concurrent k-NN searches: ${elapsed.toFixed(2)}ms`)

      // Should complete in reasonable time
      expect(elapsed).toBeLessThan(500)
    })
  })
})
