/**
 * Tests for $.vector Context API
 *
 * TDD tests for the vector namespace providing tiered vector search capabilities.
 *
 * API Design:
 * - $.vector(config?) - Create or access VectorManager
 * - $.vector().insert(id, vector, metadata?, tier?) - Insert a vector
 * - $.vector().search(vector, options?) - Search for similar vectors
 * - $.vector().delete(id, tier?) - Delete a vector
 * - $.vector().count(tier?) - Count vectors in a tier
 *
 * @module workflows/context/tests/vector
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  createMockContext,
  type VectorContext,
  type VectorContextInstance,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
} from '../vector'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('$.vector Context API', () => {
  let ctx: VectorContext

  beforeEach(() => {
    ctx = createMockContext()
  })

  // ============================================================================
  // 1. NAMESPACE STRUCTURE
  // ============================================================================

  describe('Namespace Structure', () => {
    it('should have $.vector function on context', () => {
      expect(ctx.vector).toBeDefined()
      expect(typeof ctx.vector).toBe('function')
    })

    it('should expose internal storage for testing', () => {
      expect(ctx._storage).toBeDefined()
    })

    it('should have _setBindings function', () => {
      expect(ctx._setBindings).toBeDefined()
      expect(typeof ctx._setBindings).toBe('function')
    })
  })

  // ============================================================================
  // 2. VECTOR INSTANCE CREATION
  // ============================================================================

  describe('Vector Instance Creation', () => {
    it('should create vector instance', () => {
      const vec = ctx.vector()
      expect(vec).toBeDefined()
    })

    it('should return VectorContextInstance with all methods', () => {
      const vec = ctx.vector()

      expect(typeof vec.manager).toBe('function')
      expect(typeof vec.insert).toBe('function')
      expect(typeof vec.insertBatch).toBe('function')
      expect(typeof vec.search).toBe('function')
      expect(typeof vec.delete).toBe('function')
      expect(typeof vec.deleteFromAllTiers).toBe('function')
      expect(typeof vec.count).toBe('function')
      expect(typeof vec.countAll).toBe('function')
      expect(typeof vec.getById).toBe('function')
      expect(typeof vec.promote).toBe('function')
      expect(typeof vec.demote).toBe('function')
      expect(typeof vec.hasEngine).toBe('function')
      expect(typeof vec.config).toBe('function')
    })

    it('should use default config when none provided', () => {
      const vec = ctx.vector()
      const config = vec.config()

      expect(config.tiers.hot).toBeDefined()
      expect(config.tiers.hot?.engine).toBe('libsql')
      expect(config.tiers.hot?.dimensions).toBe(128)
      expect(config.routing.strategy).toBe('cascade')
    })

    it('should accept custom config', () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'edgevec', dimensions: 1536 },
          warm: { engine: 'vectorize', dimensions: 1536 },
        },
        routing: { strategy: 'parallel' },
      })
      const config = vec.config()

      expect(config.tiers.hot?.engine).toBe('edgevec')
      expect(config.tiers.hot?.dimensions).toBe(1536)
      expect(config.tiers.warm?.engine).toBe('vectorize')
      expect(config.routing.strategy).toBe('parallel')
    })
  })

  // ============================================================================
  // 3. INSERT OPERATIONS
  // ============================================================================

  describe('Insert Operations', () => {
    it('should insert a vector', async () => {
      const vec = ctx.vector()
      await vec.insert('doc-1', [0.1, 0.2, 0.3], { title: 'Test Doc' })

      const count = await vec.count('hot')
      expect(count).toBe(1)
    })

    it('should insert with default metadata', async () => {
      const vec = ctx.vector()
      await vec.insert('doc-1', [0.1, 0.2, 0.3])

      const count = await vec.count('hot')
      expect(count).toBe(1)
    })

    it('should insert to specific tier', async () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          warm: { engine: 'vectorize', dimensions: 128 },
        },
      })

      await vec.insert('doc-1', [0.1, 0.2], {}, 'warm')

      const hotCount = await vec.count('hot')
      const warmCount = await vec.count('warm')
      expect(hotCount).toBe(0)
      expect(warmCount).toBe(1)
    })

    it('should batch insert vectors', async () => {
      const vec = ctx.vector()

      await vec.insertBatch([
        { id: 'doc-1', vector: [0.1, 0.2], metadata: { title: 'Doc 1' } },
        { id: 'doc-2', vector: [0.3, 0.4], metadata: { title: 'Doc 2' } },
        { id: 'doc-3', vector: [0.5, 0.6] },
      ])

      const count = await vec.count('hot')
      expect(count).toBe(3)
    })
  })

  // ============================================================================
  // 4. SEARCH OPERATIONS
  // ============================================================================

  describe('Search Operations', () => {
    beforeEach(async () => {
      const vec = ctx.vector()
      await vec.insertBatch([
        { id: 'doc-1', vector: [1, 0, 0], metadata: { category: 'A' } },
        { id: 'doc-2', vector: [0, 1, 0], metadata: { category: 'B' } },
        { id: 'doc-3', vector: [0, 0, 1], metadata: { category: 'A' } },
        { id: 'doc-4', vector: [0.9, 0.1, 0], metadata: { category: 'A' } },
      ])
    })

    it('should search for similar vectors', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0])

      expect(results.length).toBeGreaterThan(0)
    })

    it('should return results sorted by score', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0])

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
      }
    })

    it('should respect limit option', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0], { limit: 2 })

      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should apply threshold filter', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0], { threshold: 0.9 })

      results.forEach((hit) => {
        expect(hit.score).toBeGreaterThanOrEqual(0.9)
      })
    })

    it('should apply metadata filter', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0], {
        filter: { category: 'A' },
      })

      results.forEach((hit) => {
        expect(hit.metadata.category).toBe('A')
      })
    })

    it('should include vectors when requested', async () => {
      const vec = ctx.vector()
      const results = await vec.search([1, 0, 0], { includeVectors: true })

      results.forEach((hit) => {
        expect(hit.vector).toBeDefined()
        expect(Array.isArray(hit.vector)).toBe(true)
      })
    })
  })

  // ============================================================================
  // 5. DELETE OPERATIONS
  // ============================================================================

  describe('Delete Operations', () => {
    beforeEach(async () => {
      const vec = ctx.vector()
      await vec.insert('doc-1', [0.1, 0.2])
      await vec.insert('doc-2', [0.3, 0.4])
    })

    it('should delete a vector', async () => {
      const vec = ctx.vector()
      const deleted = await vec.delete('doc-1')

      expect(deleted).toBe(true)
      expect(await vec.count('hot')).toBe(1)
    })

    it('should return false when vector not found', async () => {
      const vec = ctx.vector()
      const deleted = await vec.delete('non-existent')

      expect(deleted).toBe(false)
    })

    it('should delete from all tiers', async () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          warm: { engine: 'vectorize', dimensions: 128 },
        },
      })

      await vec.insert('doc-1', [0.1, 0.2], {}, 'hot')
      await vec.insert('doc-1', [0.1, 0.2], {}, 'warm')

      await vec.deleteFromAllTiers('doc-1')

      expect(await vec.count('hot')).toBe(0)
      expect(await vec.count('warm')).toBe(0)
    })
  })

  // ============================================================================
  // 6. COUNT OPERATIONS
  // ============================================================================

  describe('Count Operations', () => {
    it('should count vectors in tier', async () => {
      const vec = ctx.vector()
      await vec.insertBatch([
        { id: 'doc-1', vector: [0.1, 0.2] },
        { id: 'doc-2', vector: [0.3, 0.4] },
      ])

      const count = await vec.count('hot')
      expect(count).toBe(2)
    })

    it('should return 0 for empty tier', async () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          warm: { engine: 'vectorize', dimensions: 128 },
        },
      })

      const count = await vec.count('warm')
      expect(count).toBe(0)
    })

    it('should count all tiers', async () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
          warm: { engine: 'vectorize', dimensions: 128 },
        },
      })

      await vec.insert('doc-1', [0.1, 0.2], {}, 'hot')
      await vec.insert('doc-2', [0.3, 0.4], {}, 'warm')

      const total = await vec.countAll()
      expect(total).toBe(2)
    })
  })

  // ============================================================================
  // 7. TIER MANAGEMENT
  // ============================================================================

  describe('Tier Management', () => {
    it('should check if engine exists for tier', () => {
      const vec = ctx.vector({
        tiers: {
          hot: { engine: 'libsql', dimensions: 128 },
        },
      })

      expect(vec.hasEngine('hot')).toBe(true)
      expect(vec.hasEngine('warm')).toBe(false)
      expect(vec.hasEngine('cold')).toBe(false)
    })
  })

  // ============================================================================
  // 8. RETRIEVAL
  // ============================================================================

  describe('Retrieval', () => {
    it('should get vector by ID', async () => {
      const vec = ctx.vector()
      // Note: getById uses filter { id } which checks metadata.id
      // so we need to include id in metadata for this to work
      await vec.insert('doc-1', [0.1, 0.2, 0.3], { id: 'doc-1', title: 'Test' })

      const result = await vec.getById('doc-1')

      expect(result).toBeDefined()
      expect(result?.metadata.id).toBe('doc-1')
      expect(result?.metadata.title).toBe('Test')
    })

    it('should return undefined for non-existent ID', async () => {
      const vec = ctx.vector()
      const result = await vec.getById('non-existent')

      expect(result).toBeUndefined()
    })
  })

  // ============================================================================
  // 9. MATH UTILITIES
  // ============================================================================

  describe('Math Utilities', () => {
    describe('cosineSimilarity', () => {
      it('should return 1 for identical vectors', () => {
        const similarity = cosineSimilarity([1, 0, 0], [1, 0, 0])
        expect(similarity).toBeCloseTo(1, 5)
      })

      it('should return 0 for orthogonal vectors', () => {
        const similarity = cosineSimilarity([1, 0], [0, 1])
        expect(similarity).toBeCloseTo(0, 5)
      })

      it('should return -1 for opposite vectors', () => {
        const similarity = cosineSimilarity([1, 0], [-1, 0])
        expect(similarity).toBeCloseTo(-1, 5)
      })
    })

    describe('euclideanDistance', () => {
      it('should return 0 for identical vectors', () => {
        const distance = euclideanDistance([1, 2, 3], [1, 2, 3])
        expect(distance).toBe(0)
      })

      it('should calculate correct distance', () => {
        const distance = euclideanDistance([0, 0], [3, 4])
        expect(distance).toBe(5)
      })
    })

    describe('dotProduct', () => {
      it('should return 0 for orthogonal vectors', () => {
        const dot = dotProduct([1, 0], [0, 1])
        expect(dot).toBe(0)
      })

      it('should calculate correct product', () => {
        const dot = dotProduct([1, 2, 3], [4, 5, 6])
        expect(dot).toBe(32)
      })
    })

    describe('normalizeVector', () => {
      it('should normalize to unit length', () => {
        const normalized = normalizeVector([3, 4])
        const magnitude = Math.sqrt(
          normalized.reduce((sum, x) => sum + x * x, 0)
        )
        expect(magnitude).toBeCloseTo(1, 5)
      })

      it('should handle zero vector', () => {
        const normalized = normalizeVector([0, 0, 0])
        expect(normalized).toEqual([0, 0, 0])
      })
    })
  })
})
