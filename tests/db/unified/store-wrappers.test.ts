/**
 * Store Wrappers Tests (TDD RED+GREEN)
 *
 * Tests for wrapGraphStore and wrapVectorStore functionality.
 * These wrappers should provide complete Store<T> interface compatibility
 * for GraphStore and VectorStore.
 *
 * Current issues to fix:
 * - GraphStore wrapper: get/update/delete return null/throw (stubs)
 * - VectorStore wrapper: query/find return empty arrays (stubs)
 *
 * @module tests/db/unified/store-wrappers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  type Store,
  wrapGraphStore,
  wrapVectorStore,
} from '../../../db/unified'
import { GraphStore } from '../../../db/graph/store'
import { VectorStore } from '../../../db/vector/store'

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockDb() {
  return {
    exec: vi.fn(),
    run: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  }
}

function createTestEmbedding(dimension = 128, seed = 1): Float32Array {
  const embedding = new Float32Array(dimension)
  for (let i = 0; i < dimension; i++) {
    embedding[i] = Math.sin(seed * (i + 1) * 0.1) * 0.5 + 0.5
  }
  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))
  for (let i = 0; i < dimension; i++) {
    embedding[i] /= norm
  }
  return embedding
}

// ============================================================================
// wrapGraphStore Tests
// ============================================================================

describe('wrapGraphStore', () => {
  describe('create operation', () => {
    it('creates an edge via relate', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      const edge = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: { since: '2024-01-01' },
      })

      expect(edge.id).toBeDefined()
      expect(edge.from).toBe('User/alice')
      expect(edge.to).toBe('User/bob')
      expect(edge.type).toBe('follows')
      expect(edge.data).toEqual({ since: '2024-01-01' })
    })
  })

  describe('get operation', () => {
    it('retrieves an edge by id', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create an edge first
      const created = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })

      // Get by id should return the edge
      const retrieved = await store.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.from).toBe('User/alice')
      expect(retrieved?.to).toBe('User/bob')
      expect(retrieved?.type).toBe('follows')
    })

    it('returns null for non-existent id', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      const result = await store.get('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('update operation', () => {
    it('updates an edge data by id', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create an edge first
      const created = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: { weight: 1 },
      })

      // Update the edge
      const updated = await store.update(created.id, {
        data: { weight: 2 },
      })

      expect(updated.id).toBe(created.id)
      expect(updated.data).toEqual({ weight: 2 })
    })

    it('throws when edge does not exist', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      await expect(
        store.update('non-existent-id', { data: { weight: 2 } })
      ).rejects.toThrow(/not found/i)
    })
  })

  describe('delete operation', () => {
    it('deletes an edge by id', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create an edge first
      const created = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })

      // Delete the edge
      const result = await store.delete(created.id)
      expect(result).toBe(true)

      // Verify it's gone
      const retrieved = await store.get(created.id)
      expect(retrieved).toBeNull()
    })

    it('returns false when edge does not exist', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      const result = await store.delete('non-existent-id')
      expect(result).toBe(false)
    })
  })

  describe('query operation', () => {
    it('queries edges with where filter', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create multiple edges
      await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })
      await store.create({
        from: 'User/alice',
        to: 'User/carol',
        type: 'follows',
        data: null,
      })
      await store.create({
        from: 'User/bob',
        to: 'User/carol',
        type: 'blocks',
        data: null,
      })

      // Query by type
      const results = await store.query().where({ type: 'follows' }).execute()

      expect(results).toHaveLength(2)
      expect(results.every((e) => e.type === 'follows')).toBe(true)
    })

    it('queries edges by from node', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })
      await store.create({
        from: 'User/alice',
        to: 'User/carol',
        type: 'follows',
        data: null,
      })
      await store.create({
        from: 'User/bob',
        to: 'User/carol',
        type: 'follows',
        data: null,
      })

      const results = await store.query().where({ from: 'User/alice' }).execute()

      expect(results).toHaveLength(2)
      expect(results.every((e) => e.from === 'User/alice')).toBe(true)
    })

    it('supports limit and offset', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create 5 edges
      for (let i = 0; i < 5; i++) {
        await store.create({
          from: 'User/alice',
          to: `User/user${i}`,
          type: 'follows',
          data: null,
        })
      }

      const results = await store.query().limit(3).offset(1).execute()

      expect(results).toHaveLength(3)
    })

    it('supports count', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      // Create 5 edges
      for (let i = 0; i < 5; i++) {
        await store.create({
          from: 'User/alice',
          to: `User/user${i}`,
          type: 'follows',
          data: null,
        })
      }

      const count = await store.query().count()
      expect(count).toBe(5)
    })
  })

  describe('find operation', () => {
    it('finds edges matching filter', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)

      await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })
      await store.create({
        from: 'User/alice',
        to: 'User/carol',
        type: 'blocks',
        data: null,
      })

      const results = await store.find({ type: 'follows' })

      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('follows')
    })
  })

  describe('CDC events', () => {
    it('emits create event', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)
      const handler = vi.fn()

      store.on('create', handler)

      await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'create',
          item: expect.objectContaining({ from: 'User/alice', to: 'User/bob' }),
        })
      )
    })

    it('emits update event', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)
      const handler = vi.fn()

      const created = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: { weight: 1 },
      })

      store.on('update', handler)

      await store.update(created.id, { data: { weight: 2 } })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          item: expect.objectContaining({ data: { weight: 2 } }),
        })
      )
    })

    it('emits delete event', async () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)
      const store = wrapGraphStore(graphStore)
      const handler = vi.fn()

      const created = await store.create({
        from: 'User/alice',
        to: 'User/bob',
        type: 'follows',
        data: null,
      })

      store.on('delete', handler)

      await store.delete(created.id)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          item: expect.objectContaining({ from: 'User/alice', to: 'User/bob' }),
        })
      )
    })
  })
})

// ============================================================================
// wrapVectorStore Tests
// ============================================================================

describe('wrapVectorStore', () => {
  describe('create operation', () => {
    it('creates a vector document', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      const doc = await store.create({
        content: 'Hello world',
        embedding,
        metadata: { category: 'test' },
      })

      expect(doc.id).toBeDefined()
      expect(doc.content).toBe('Hello world')
      expect(doc.metadata?.category).toBe('test')
    })

    it('creates with provided id', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      const doc = await store.create({
        id: 'custom-id',
        content: 'Hello world',
        embedding,
      })

      expect(doc.id).toBe('custom-id')
    })
  })

  describe('get operation', () => {
    it('retrieves a vector document by id', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      const created = await store.create({
        id: 'test-id',
        content: 'Hello world',
        embedding,
        metadata: { tag: 'test' },
      })

      const retrieved = await store.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('test-id')
      expect(retrieved?.content).toBe('Hello world')
    })

    it('returns null for non-existent id', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('update operation', () => {
    it('updates a vector document', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      const created = await store.create({
        id: 'test-id',
        content: 'Original content',
        embedding,
        metadata: { version: 1 },
      })

      const updated = await store.update(created.id, {
        content: 'Updated content',
        metadata: { version: 2 },
      })

      expect(updated.id).toBe('test-id')
      expect(updated.content).toBe('Updated content')
      expect(updated.metadata?.version).toBe(2)
    })

    it('throws when document does not exist', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      await expect(
        store.update('non-existent', { content: 'Test' })
      ).rejects.toThrow(/not found/i)
    })
  })

  describe('delete operation', () => {
    it('deletes a vector document', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      const created = await store.create({
        id: 'test-id',
        content: 'Hello world',
        embedding,
      })

      const result = await store.delete(created.id)
      expect(result).toBe(true)

      const retrieved = await store.get(created.id)
      expect(retrieved).toBeNull()
    })
  })

  describe('query operation', () => {
    it('queries documents with where filter', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      await store.create({
        id: 'doc1',
        content: 'First document',
        embedding,
        metadata: { category: 'tech' },
      })
      await store.create({
        id: 'doc2',
        content: 'Second document',
        embedding: createTestEmbedding(128, 2),
        metadata: { category: 'news' },
      })
      await store.create({
        id: 'doc3',
        content: 'Third document',
        embedding: createTestEmbedding(128, 3),
        metadata: { category: 'tech' },
      })

      const results = await store
        .query()
        .where({ 'metadata.category': 'tech' })
        .execute()

      expect(results).toHaveLength(2)
      expect(results.every((d) => d.metadata?.category === 'tech')).toBe(true)
    })

    it('supports limit and offset', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await store.create({
          id: `doc${i}`,
          content: `Document ${i}`,
          embedding: createTestEmbedding(128, i + 1),
        })
      }

      const results = await store.query().limit(3).offset(1).execute()

      expect(results).toHaveLength(3)
    })

    it('supports count', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await store.create({
          id: `doc${i}`,
          content: `Document ${i}`,
          embedding: createTestEmbedding(128, i + 1),
        })
      }

      const count = await store.query().count()
      expect(count).toBe(5)
    })

    it('supports orderBy', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      await store.create({
        id: 'doc-c',
        content: 'Third',
        embedding: createTestEmbedding(128, 1),
      })
      await store.create({
        id: 'doc-a',
        content: 'First',
        embedding: createTestEmbedding(128, 2),
      })
      await store.create({
        id: 'doc-b',
        content: 'Second',
        embedding: createTestEmbedding(128, 3),
      })

      const results = await store.query().orderBy('id', 'asc').execute()

      expect(results[0].id).toBe('doc-a')
      expect(results[1].id).toBe('doc-b')
      expect(results[2].id).toBe('doc-c')
    })
  })

  describe('find operation', () => {
    it('finds documents matching filter', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const embedding = createTestEmbedding(128)
      await store.create({
        id: 'doc1',
        content: 'Tech article',
        embedding,
        metadata: { category: 'tech' },
      })
      await store.create({
        id: 'doc2',
        content: 'News article',
        embedding: createTestEmbedding(128, 2),
        metadata: { category: 'news' },
      })

      const results = await store.find({ 'metadata.category': 'tech' })

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('doc1')
    })

    it('returns empty array when no matches', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)

      const results = await store.find({ 'metadata.category': 'sports' })
      expect(results).toHaveLength(0)
    })
  })

  describe('CDC events', () => {
    it('emits create event', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)
      const handler = vi.fn()

      store.on('create', handler)

      const embedding = createTestEmbedding(128)
      await store.create({
        id: 'test-doc',
        content: 'Hello world',
        embedding,
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'create',
          item: expect.objectContaining({ id: 'test-doc', content: 'Hello world' }),
        })
      )
    })

    it('emits update event', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)
      const handler = vi.fn()

      const embedding = createTestEmbedding(128)
      const created = await store.create({
        id: 'test-doc',
        content: 'Original',
        embedding,
      })

      store.on('update', handler)

      await store.update(created.id, { content: 'Updated' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          item: expect.objectContaining({ content: 'Updated' }),
        })
      )
    })

    it('emits delete event', async () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })
      const store = wrapVectorStore(vectorStore)
      const handler = vi.fn()

      const embedding = createTestEmbedding(128)
      const created = await store.create({
        id: 'test-doc',
        content: 'Hello world',
        embedding,
      })

      store.on('delete', handler)

      await store.delete(created.id)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          item: expect.objectContaining({ id: 'test-doc' }),
        })
      )
    })
  })
})
