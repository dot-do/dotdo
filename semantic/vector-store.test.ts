/**
 * VectorStore Tests
 *
 * Tests for the vector search functionality powering fuzzy relationship operators.
 *
 * @module semantic/vector-store.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  VectorStore,
  InMemoryVectorIndex,
  MockEmbeddingProvider,
  getVectorStore,
  resetVectorStore,
  type VectorStoreConfig,
} from './vector-store'
import { noun, thing, resetState, type Thing, type ScoredThing } from './index'

// Reset state before each test
beforeEach(() => {
  resetState()
  resetVectorStore()
})

// =============================================================================
// VectorStore Basic Operations
// =============================================================================

describe('VectorStore', () => {
  describe('Construction', () => {
    it('should create a VectorStore with default config', () => {
      const store = new VectorStore()
      expect(store).toBeInstanceOf(VectorStore)
    })

    it('should create a VectorStore with custom config', () => {
      const vectorize = new InMemoryVectorIndex()
      const embeddingProvider = new MockEmbeddingProvider(384)

      const store = new VectorStore({
        vectorize,
        embeddingProvider,
        defaultTopK: 5,
        defaultThreshold: 0.7,
      })

      expect(store).toBeInstanceOf(VectorStore)
    })
  })

  describe('Indexing Things', () => {
    it('should index a single Thing', async () => {
      const store = new VectorStore()
      const Product = noun('Product')
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro', price: 2499 })

      await store.index(macbook)

      // Verify by searching for similar items
      const results = await store.findSimilar(macbook, undefined, { threshold: 0.9 })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].$id).toBe('macbook')
    })

    it('should index multiple Things in batch', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const products = [
        thing(Product, 'macbook', { name: 'MacBook Pro', price: 2499 }),
        thing(Product, 'iphone', { name: 'iPhone 15', price: 999 }),
        thing(Product, 'ipad', { name: 'iPad Pro', price: 1099 }),
      ]

      await store.indexBatch(products)

      // Search should find all products
      const results = await store.search('Apple products', 'Product', { threshold: 0 })
      expect(results.length).toBe(3)
    })

    it('should handle empty batch', async () => {
      const store = new VectorStore()
      await expect(store.indexBatch([])).resolves.not.toThrow()
    })

    it('should update existing Thing on re-index', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro', price: 2499 })
      await store.index(macbook)

      // Update the thing
      const updatedMacbook = thing(Product, 'macbook', { name: 'MacBook Pro M3', price: 2999 })
      await store.index(updatedMacbook)

      // Should still only have one entry
      const results = (await store.findSimilar(updatedMacbook, undefined, {
        threshold: 0.9,
        withScores: true,
      })) as ScoredThing[]
      expect(results.filter((r) => r.$id === 'macbook').length).toBe(1)
    })
  })

  describe('Removing Things', () => {
    it('should remove a Thing from the index', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro', price: 2499 })
      await store.index(macbook)

      // Verify it's indexed
      let results = await store.findSimilar(macbook, undefined, { threshold: 0.9 })
      expect(results.length).toBeGreaterThan(0)

      // Remove it
      await store.remove('macbook')

      // Should no longer find it
      results = await store.findSimilar(macbook, undefined, { threshold: 0.9 })
      expect(results.find((r) => r.$id === 'macbook')).toBeUndefined()
    })
  })
})

// =============================================================================
// Semantic Search
// =============================================================================

describe('Semantic Search', () => {
  describe('findSimilar', () => {
    it('should find similar Things', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const products = [
        thing(Product, 'macbook-pro', { name: 'MacBook Pro', category: 'laptop' }),
        thing(Product, 'macbook-air', { name: 'MacBook Air', category: 'laptop' }),
        thing(Product, 'iphone', { name: 'iPhone 15', category: 'phone' }),
      ]
      await store.indexBatch(products)

      // Find similar to MacBook Pro
      const results = await store.findSimilar(products[0], undefined, { threshold: 0 })

      expect(results.length).toBeGreaterThan(0)
      // Should return the query thing itself with high score
      expect(results[0].$id).toBe('macbook-pro')
    })

    it('should filter by target type', async () => {
      const store = new VectorStore()
      const Product = noun('Product')
      const Category = noun('Category')

      await store.indexBatch([
        thing(Product, 'macbook', { name: 'MacBook Pro' }),
        thing(Product, 'iphone', { name: 'iPhone' }),
        thing(Category, 'laptops', { name: 'Laptops' }),
        thing(Category, 'phones', { name: 'Phones' }),
      ])

      const query = thing(Product, 'query', { name: 'Laptop computer' })
      await store.index(query)

      // Only search for Categories
      const results = await store.findSimilar(query, 'Category', { threshold: 0 })

      expect(results.every((r) => r.$type === 'Category')).toBe(true)
    })

    it('should respect threshold option', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      await store.indexBatch([
        thing(Product, 'exact', { name: 'MacBook Pro' }),
        thing(Product, 'similar', { name: 'MacBook Air' }),
        thing(Product, 'different', { name: 'Samsung Galaxy' }),
      ])

      const query = thing(Product, 'query', { name: 'MacBook Pro laptop' })

      // High threshold - fewer results
      const strictResults = await store.findSimilar(query, undefined, { threshold: 0.9 })

      // Low threshold - more results
      const looseResults = await store.findSimilar(query, undefined, { threshold: 0.1 })

      expect(looseResults.length).toBeGreaterThanOrEqual(strictResults.length)
    })

    it('should return scores when withScores is true', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })
      await store.index(macbook)

      const results = (await store.findSimilar(macbook, undefined, {
        threshold: 0,
        withScores: true,
      })) as ScoredThing[]

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('score')
      expect(typeof results[0].score).toBe('number')
      expect(results[0].score).toBeGreaterThanOrEqual(0)
      expect(results[0].score).toBeLessThanOrEqual(1)
    })

    it('should not return scores when withScores is false', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })
      await store.index(macbook)

      const results = await store.findSimilar(macbook, undefined, {
        threshold: 0,
        withScores: false,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).not.toHaveProperty('score')
    })

    it('should respect topK option', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      // Index many products
      const products = Array.from({ length: 20 }, (_, i) =>
        thing(Product, `product-${i}`, { name: `Product ${i}` })
      )
      await store.indexBatch(products)

      const query = thing(Product, 'query', { name: 'Product search' })

      const results = await store.findSimilar(query, undefined, {
        threshold: 0,
        topK: 5,
      })

      expect(results.length).toBeLessThanOrEqual(5)
    })
  })

  describe('findRelatedTo (backward fuzzy)', () => {
    it('should find Things related to target', async () => {
      const store = new VectorStore()
      const Product = noun('Product')

      const products = [
        thing(Product, 'macbook', { name: 'MacBook Pro laptop' }),
        thing(Product, 'iphone', { name: 'iPhone smartphone' }),
      ]
      await store.indexBatch(products)

      // For semantic similarity, forward and backward are equivalent
      const target = thing(Product, 'target', { name: 'Apple laptop computer' })
      const results = await store.findRelatedTo(target, undefined, { threshold: 0 })

      expect(results.length).toBeGreaterThan(0)
    })

    it('should filter by source type', async () => {
      const store = new VectorStore()
      const Customer = noun('Customer')
      const Product = noun('Product')

      await store.indexBatch([
        thing(Customer, 'alice', { name: 'Alice', interests: 'technology' }),
        thing(Customer, 'bob', { name: 'Bob', interests: 'music' }),
        thing(Product, 'macbook', { name: 'MacBook' }),
      ])

      const target = thing(Product, 'target', { name: 'Tech product' })

      // Only find related Customers
      const results = await store.findRelatedTo(target, 'Customer', { threshold: 0 })

      expect(results.every((r) => r.$type === 'Customer')).toBe(true)
    })
  })

  describe('Text query search', () => {
    it('should search by text query', async () => {
      const store = new VectorStore()
      const Article = noun('Article')

      await store.indexBatch([
        thing(Article, 'ai-article', { title: 'Introduction to Machine Learning', content: 'AI basics' }),
        thing(Article, 'web-article', { title: 'Web Development Guide', content: 'HTML CSS JS' }),
        thing(Article, 'db-article', { title: 'Database Design', content: 'SQL and NoSQL' }),
      ])

      const results = await store.search('machine learning AI', 'Article', { threshold: 0 })

      expect(results.length).toBeGreaterThan(0)
    })

    it('should filter by type in text search', async () => {
      const store = new VectorStore()
      const Article = noun('Article')
      const Video = noun('Video')

      await store.indexBatch([
        thing(Article, 'ai-article', { title: 'AI Article' }),
        thing(Video, 'ai-video', { title: 'AI Video' }),
      ])

      const articleResults = await store.search('artificial intelligence', 'Article', { threshold: 0 })
      const videoResults = await store.search('artificial intelligence', 'Video', { threshold: 0 })

      expect(articleResults.every((r) => r.$type === 'Article')).toBe(true)
      expect(videoResults.every((r) => r.$type === 'Video')).toBe(true)
    })
  })
})

// =============================================================================
// InMemoryVectorIndex
// =============================================================================

describe('InMemoryVectorIndex', () => {
  it('should insert vectors', async () => {
    const index = new InMemoryVectorIndex()

    const result = await index.insert([
      { id: 'v1', values: [0.1, 0.2, 0.3], metadata: { $id: 'v1', $type: 'Test' } },
      { id: 'v2', values: [0.4, 0.5, 0.6], metadata: { $id: 'v2', $type: 'Test' } },
    ])

    expect(result.count).toBe(2)
    expect(index.size()).toBe(2)
  })

  it('should not insert duplicate IDs', async () => {
    const index = new InMemoryVectorIndex()

    await index.insert([{ id: 'v1', values: [0.1, 0.2, 0.3] }])
    const result = await index.insert([{ id: 'v1', values: [0.4, 0.5, 0.6] }])

    expect(result.count).toBe(0)
    expect(index.size()).toBe(1)
  })

  it('should upsert vectors', async () => {
    const index = new InMemoryVectorIndex()

    await index.upsert([{ id: 'v1', values: [0.1, 0.2, 0.3] }])
    await index.upsert([{ id: 'v1', values: [0.4, 0.5, 0.6] }])

    expect(index.size()).toBe(1)

    const result = await index.getByIds(['v1'])
    expect(result.vectors[0].values).toEqual([0.4, 0.5, 0.6])
  })

  it('should query similar vectors', async () => {
    const index = new InMemoryVectorIndex()

    await index.insert([
      { id: 'v1', values: [1, 0, 0], metadata: { $id: 'v1', $type: 'A' } },
      { id: 'v2', values: [0.9, 0.1, 0], metadata: { $id: 'v2', $type: 'A' } },
      { id: 'v3', values: [0, 1, 0], metadata: { $id: 'v3', $type: 'B' } },
    ])

    // Query with vector similar to v1
    const result = await index.query([1, 0, 0], { topK: 2 })

    expect(result.matches.length).toBe(2)
    expect(result.matches[0].id).toBe('v1') // Most similar
    expect(result.matches[0].score).toBeCloseTo(1, 5) // Perfect match
    expect(result.matches[1].id).toBe('v2') // Second most similar
  })

  it('should filter by type in query', async () => {
    const index = new InMemoryVectorIndex()

    await index.insert([
      { id: 'v1', values: [1, 0, 0], metadata: { $id: 'v1', $type: 'A' } },
      { id: 'v2', values: [0.9, 0.1, 0], metadata: { $id: 'v2', $type: 'B' } },
    ])

    const result = await index.query([1, 0, 0], { filter: { $type: 'A' } })

    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('v1')
  })

  it('should delete vectors', async () => {
    const index = new InMemoryVectorIndex()

    await index.insert([
      { id: 'v1', values: [0.1, 0.2, 0.3] },
      { id: 'v2', values: [0.4, 0.5, 0.6] },
    ])

    const result = await index.deleteByIds(['v1'])

    expect(result.count).toBe(1)
    expect(index.size()).toBe(1)
  })

  it('should get vectors by IDs', async () => {
    const index = new InMemoryVectorIndex()

    await index.insert([
      { id: 'v1', values: [0.1, 0.2, 0.3], metadata: { $id: 'v1', $type: 'Test' } },
      { id: 'v2', values: [0.4, 0.5, 0.6], metadata: { $id: 'v2', $type: 'Test' } },
    ])

    const result = await index.getByIds(['v1', 'v3']) // v3 doesn't exist

    expect(result.vectors.length).toBe(1)
    expect(result.vectors[0].id).toBe('v1')
  })
})

// =============================================================================
// MockEmbeddingProvider
// =============================================================================

describe('MockEmbeddingProvider', () => {
  it('should generate embeddings of correct dimension', async () => {
    const provider = new MockEmbeddingProvider(768)

    const embedding = await provider.embed('Hello world')

    expect(embedding.length).toBe(768)
  })

  it('should generate normalized embeddings', async () => {
    const provider = new MockEmbeddingProvider(768)

    const embedding = await provider.embed('Test text')

    // Magnitude should be approximately 1
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
    expect(magnitude).toBeCloseTo(1, 5)
  })

  it('should generate deterministic embeddings', async () => {
    const provider = new MockEmbeddingProvider(768)

    const embedding1 = await provider.embed('Hello world')
    const embedding2 = await provider.embed('Hello world')

    expect(embedding1).toEqual(embedding2)
  })

  it('should generate different embeddings for different text', async () => {
    const provider = new MockEmbeddingProvider(768)

    const embedding1 = await provider.embed('Hello')
    const embedding2 = await provider.embed('World')

    expect(embedding1).not.toEqual(embedding2)
  })

  it('should batch embed multiple texts', async () => {
    const provider = new MockEmbeddingProvider(384)

    const embeddings = await provider.embedBatch(['Text 1', 'Text 2', 'Text 3'])

    expect(embeddings.length).toBe(3)
    embeddings.forEach((emb) => {
      expect(emb.length).toBe(384)
    })
  })
})

// =============================================================================
// Module-level Factory
// =============================================================================

describe('getVectorStore', () => {
  it('should return a singleton instance', () => {
    const store1 = getVectorStore()
    const store2 = getVectorStore()

    expect(store1).toBe(store2)
  })

  it('should create new instance with config', () => {
    const store1 = getVectorStore()
    const store2 = getVectorStore({ defaultTopK: 20 })

    // Config creates new instance
    expect(store2).not.toBe(store1)
  })

  it('should reset singleton', () => {
    const store1 = getVectorStore()
    resetVectorStore()
    const store2 = getVectorStore()

    expect(store2).not.toBe(store1)
  })
})

// =============================================================================
// Integration with Thing operators
// =============================================================================

describe('Integration with fuzzy operators', () => {
  it('should work with forwardFuzzy operator pattern', async () => {
    const store = new VectorStore()
    const Customer = noun('Customer')
    const Product = noun('Product')

    // Index products
    const products = [
      thing(Product, 'laptop', { name: 'Gaming Laptop', category: 'electronics' }),
      thing(Product, 'phone', { name: 'Smartphone', category: 'electronics' }),
      thing(Product, 'book', { name: 'Programming Book', category: 'books' }),
    ]
    await store.indexBatch(products)

    // Customer looking for electronics
    const customer = thing(Customer, 'alice', { name: 'Alice', interests: 'gaming computers electronics' })

    // Find similar products (~> operator)
    const recommendations = await store.findSimilar(customer, 'Product', {
      threshold: 0,
      topK: 3,
    })

    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.every((r) => r.$type === 'Product')).toBe(true)
  })

  it('should work with backwardFuzzy operator pattern', async () => {
    const store = new VectorStore()
    const Customer = noun('Customer')
    const Product = noun('Product')

    // Index customers with their interests
    const customers = [
      thing(Customer, 'alice', { name: 'Alice', interests: 'technology, gadgets' }),
      thing(Customer, 'bob', { name: 'Bob', interests: 'sports, fitness' }),
      thing(Customer, 'charlie', { name: 'Charlie', interests: 'tech, programming' }),
    ]
    await store.indexBatch(customers)

    // Product looking for related customers (<~ operator)
    const product = thing(Product, 'laptop', { name: 'Gaming Laptop', category: 'technology' })

    const relatedCustomers = await store.findRelatedTo(product, 'Customer', {
      threshold: 0,
    })

    expect(relatedCustomers.length).toBeGreaterThan(0)
    expect(relatedCustomers.every((r) => r.$type === 'Customer')).toBe(true)
  })
})
