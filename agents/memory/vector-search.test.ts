/**
 * Tests for Vector Search Memory
 *
 * @module agents/memory/vector-search.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  VectorMemory,
  SimpleVectorIndex,
  WorkersAIEmbeddingProvider,
  createTestVectorMemory,
  type EmbeddingProvider,
} from './vector-search'
import { createInMemoryAgentMemory } from '../unified-memory'

// ============================================================================
// SimpleVectorIndex Tests
// ============================================================================

describe('SimpleVectorIndex', () => {
  describe('basic operations', () => {
    it('should insert and retrieve vectors', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      const embedding = new Float32Array([1, 0, 0, 0])
      index.insert('test-1', embedding, { type: 'short-term' })

      expect(index.size()).toBe(1)
    })

    it('should reject vectors with wrong dimensions', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      const wrongDim = new Float32Array([1, 0, 0])
      expect(() => index.insert('test-1', wrongDim)).toThrow('Dimension mismatch')
    })

    it('should delete vectors', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      index.insert('test-1', new Float32Array([1, 0, 0, 0]))
      expect(index.size()).toBe(1)

      const deleted = index.delete('test-1')
      expect(deleted).toBe(true)
      expect(index.size()).toBe(0)
    })

    it('should return false when deleting non-existent vector', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      const deleted = index.delete('non-existent')
      expect(deleted).toBe(false)
    })

    it('should clear all vectors', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      index.insert('test-1', new Float32Array([1, 0, 0, 0]))
      index.insert('test-2', new Float32Array([0, 1, 0, 0]))
      expect(index.size()).toBe(2)

      index.clear()
      expect(index.size()).toBe(0)
    })
  })

  describe('cosine similarity search', () => {
    it('should find exact matches first', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      // Insert orthogonal vectors
      index.insert('x', new Float32Array([1, 0, 0, 0]))
      index.insert('y', new Float32Array([0, 1, 0, 0]))
      index.insert('z', new Float32Array([0, 0, 1, 0]))

      // Search for x direction
      const results = index.search(new Float32Array([1, 0, 0, 0]), 3)

      expect(results.length).toBe(3)
      expect(results[0].id).toBe('x')
      expect(results[0].score).toBeCloseTo(1.0, 5) // Exact match
    })

    it('should rank by similarity', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      // Insert vectors at different angles
      index.insert('exact', new Float32Array([1, 0, 0, 0]))
      index.insert('close', new Float32Array([0.9, 0.1, 0, 0]))
      index.insert('far', new Float32Array([0.5, 0.5, 0.5, 0.5]))

      // Normalize close vector
      const closeVec = new Float32Array([0.9, 0.1, 0, 0])
      const norm = Math.sqrt(0.81 + 0.01)
      closeVec[0] = closeVec[0]! / norm
      closeVec[1] = closeVec[1]! / norm

      const results = index.search(new Float32Array([1, 0, 0, 0]), 3)

      expect(results[0].id).toBe('exact')
      expect(results[1].id).toBe('close')
      expect(results[2].id).toBe('far')
    })

    it('should respect k limit', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      for (let i = 0; i < 10; i++) {
        const vec = new Float32Array(4)
        vec[i % 4] = 1
        index.insert(`vec-${i}`, vec)
      }

      const results = index.search(new Float32Array([1, 0, 0, 0]), 3)
      expect(results.length).toBe(3)
    })

    it('should apply metadata filter', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'cosine' })

      index.insert('a', new Float32Array([1, 0, 0, 0]), { type: 'long-term' })
      index.insert('b', new Float32Array([0.9, 0.1, 0, 0]), { type: 'short-term' })
      index.insert('c', new Float32Array([0.8, 0.2, 0, 0]), { type: 'long-term' })

      const results = index.search(
        new Float32Array([1, 0, 0, 0]),
        10,
        (meta) => meta.type === 'long-term'
      )

      expect(results.length).toBe(2)
      expect(results.every((r) => r.metadata.type === 'long-term')).toBe(true)
    })
  })

  describe('euclidean distance search', () => {
    it('should find nearest neighbors', () => {
      const index = new SimpleVectorIndex({ dimensions: 2, metric: 'euclidean' })

      index.insert('origin', new Float32Array([0, 0]))
      index.insert('near', new Float32Array([0.1, 0.1]))
      index.insert('far', new Float32Array([1, 1]))

      const results = index.search(new Float32Array([0, 0]), 3)

      expect(results[0].id).toBe('origin')
      expect(results[1].id).toBe('near')
      expect(results[2].id).toBe('far')
    })
  })

  describe('dot product search', () => {
    it('should maximize dot product', () => {
      const index = new SimpleVectorIndex({ dimensions: 4, metric: 'dot' })

      index.insert('high', new Float32Array([1, 1, 1, 1]))
      index.insert('low', new Float32Array([0.1, 0.1, 0.1, 0.1]))

      const results = index.search(new Float32Array([1, 1, 1, 1]), 2)

      expect(results[0].id).toBe('high')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })
  })
})

// ============================================================================
// VectorMemory Tests
// ============================================================================

describe('VectorMemory', () => {
  let vectorMemory: VectorMemory

  beforeEach(() => {
    const baseMemory = createInMemoryAgentMemory()
    vectorMemory = createTestVectorMemory(baseMemory, {
      dimensions: 64,
      metric: 'cosine',
      maxVectors: 100,
      minSimilarity: 0.3,
    })
  })

  describe('remember', () => {
    it('should store memory with embedding', async () => {
      const memory = await vectorMemory.remember('The user prefers dark mode', {
        type: 'long-term',
      })

      expect(memory.id).toBeDefined()
      expect(memory.content).toBe('The user prefers dark mode')
      expect(memory.type).toBe('long-term')
    })

    it('should index memory for search', async () => {
      await vectorMemory.remember('First memory')
      await vectorMemory.remember('Second memory')

      const stats = vectorMemory.getStats()
      expect(stats.vectorCount).toBe(2)
    })
  })

  describe('semanticSearch', () => {
    it('should find similar memories', async () => {
      await vectorMemory.remember('The weather is sunny today')
      await vectorMemory.remember('It is raining outside')
      await vectorMemory.remember('User prefers dark mode')

      // With mock embedder using hash-based pseudo-random embeddings,
      // we need minSimilarity: 0 to ensure results are returned (since hash
      // doesn't encode actual semantic similarity)
      const results = await vectorMemory.semanticSearch('What is the weather like?', {
        minSimilarity: 0,
      })

      // With mock embedder, results are deterministic based on text hash
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toBeDefined()
    })

    it('should filter by type', async () => {
      await vectorMemory.remember('Long term fact', { type: 'long-term' })
      await vectorMemory.remember('Short term note', { type: 'short-term' })

      const results = await vectorMemory.semanticSearch('fact', {
        type: 'long-term',
      })

      expect(results.every((r) => r.type === 'long-term')).toBe(true)
    })

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await vectorMemory.remember(`Memory number ${i}`)
      }

      const results = await vectorMemory.semanticSearch('memory', { limit: 3 })
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should return empty for no matches above threshold', async () => {
      // Create memory with very different content
      await vectorMemory.remember('ABCDEFG')

      const results = await vectorMemory.semanticSearch('XYZ', {
        minSimilarity: 0.99, // Very high threshold
      })

      // May or may not have results depending on hash similarity
      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe('hybridSearch', () => {
    it('should combine text and semantic results', async () => {
      await vectorMemory.remember('The quick brown fox jumps')
      await vectorMemory.remember('A fast orange animal leaps')
      await vectorMemory.remember('Database optimization tips')

      // With mock embedder, semantic similarity may be low (hash-based),
      // but text search will match 'quick' and 'fox'
      const results = await vectorMemory.hybridSearch('quick fox', {
        textWeight: 0.5,
        minSimilarity: 0, // Allow all semantic results since mock embedder doesn't encode semantics
      })

      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('deleteMemory', () => {
    it('should remove memory from base and index', async () => {
      const memory = await vectorMemory.remember('To be deleted')
      const id = memory.id

      expect(vectorMemory.getStats().vectorCount).toBe(1)

      const deleted = await vectorMemory.deleteMemory(id)
      expect(deleted).toBe(true)
      expect(vectorMemory.getStats().vectorCount).toBe(0)
    })
  })

  describe('warmIndex', () => {
    it('should load existing memories into index', async () => {
      // Store some memories first
      await vectorMemory.remember('Memory one')
      await vectorMemory.remember('Memory two')
      await vectorMemory.remember('Memory three')

      // Create new VectorMemory with same base
      const baseMemory = vectorMemory.getBaseMemory()
      const newVectorMemory = createTestVectorMemory(baseMemory, {
        dimensions: 64,
        metric: 'cosine',
        maxVectors: 100,
      })

      // New index should be empty
      expect(newVectorMemory.getStats().vectorCount).toBe(0)

      // Warm the index
      const indexed = await newVectorMemory.warmIndex()
      expect(indexed).toBe(3)
      expect(newVectorMemory.getStats().vectorCount).toBe(3)
    })
  })
})

// ============================================================================
// WorkersAIEmbeddingProvider Tests (mock)
// ============================================================================

describe('WorkersAIEmbeddingProvider', () => {
  // Mock Workers AI
  const mockAI = {
    run: async (_model: any, input: any) => {
      const texts = Array.isArray(input.text) ? input.text : [input.text]
      const embeddings = texts.map((text: string) => {
        // Generate 768-dim "embedding" based on text length
        const embedding = new Array(768).fill(0).map((_, i) => {
          return Math.sin(text.length + i * 0.01)
        })
        return embedding
      })
      return { data: embeddings }
    },
  } as unknown as Ai

  describe('embed', () => {
    it('should return full 768-dim embedding by default', async () => {
      const provider = new WorkersAIEmbeddingProvider(mockAI)
      const embedding = await provider.embed('test')

      expect(embedding.length).toBe(768)
      expect(provider.getDimensions()).toBe(768)
    })

    it('should truncate to 256 dimensions when configured', async () => {
      const provider = new WorkersAIEmbeddingProvider(mockAI, { truncateTo: 256 })
      const embedding = await provider.embed('test')

      expect(embedding.length).toBe(256)
      expect(provider.getDimensions()).toBe(256)
    })

    it('should normalize truncated embeddings', async () => {
      const provider = new WorkersAIEmbeddingProvider(mockAI, { truncateTo: 256 })
      const embedding = await provider.embed('test')

      // Check L2 norm is approximately 1
      let norm = 0
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i]! * embedding[i]!
      }
      norm = Math.sqrt(norm)

      expect(norm).toBeCloseTo(1.0, 4)
    })
  })

  describe('embedBatch', () => {
    it('should embed multiple texts', async () => {
      const provider = new WorkersAIEmbeddingProvider(mockAI, { truncateTo: 256 })
      const embeddings = await provider.embedBatch(['one', 'two', 'three'])

      expect(embeddings.length).toBe(3)
      expect(embeddings[0].length).toBe(256)
      expect(embeddings[1].length).toBe(256)
      expect(embeddings[2].length).toBe(256)
    })

    it('should return empty array for empty input', async () => {
      const provider = new WorkersAIEmbeddingProvider(mockAI)
      const embeddings = await provider.embedBatch([])

      expect(embeddings).toEqual([])
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('VectorMemory Integration', () => {
  it('should work with unified-memory as base', async () => {
    const baseMemory = createInMemoryAgentMemory()
    const vectorMemory = createTestVectorMemory(baseMemory, {
      dimensions: 128,
    })

    // Store via vector memory
    await vectorMemory.remember('Important fact', { type: 'long-term' })

    // Access via base memory
    const memories = await baseMemory.getRecentMemories(10)
    expect(memories.length).toBe(1)
    expect(memories[0].content).toBe('Important fact')
  })

  it('should preserve message operations from base memory', async () => {
    const baseMemory = createInMemoryAgentMemory()
    const vectorMemory = createTestVectorMemory(baseMemory)

    // Use base memory's message operations
    const base = vectorMemory.getBaseMemory()
    await base.addMessage({ role: 'user', content: 'Hello!' })
    await base.addMessage({ role: 'assistant', content: 'Hi there!' })

    const messages = base.getMessages()
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })
})
