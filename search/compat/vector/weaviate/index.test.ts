/**
 * @dotdo/weaviate - Weaviate-compatible vector database SDK
 *
 * Tests for Weaviate API compatibility backed by DO SQLite:
 * - Client creation and configuration
 * - Schema operations (create, get, delete classes)
 * - Data operations (create, read, update, delete objects)
 * - Vector search (nearVector, nearObject)
 * - Keyword search (BM25)
 * - Hybrid search
 * - Batch operations
 * - Filtering and sorting
 *
 * @see https://weaviate.io/developers/weaviate/client-libraries/typescript
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type {
  WeaviateClass,
  WeaviateObject,
  GraphQLResponse,
  WhereFilter,
} from './types'
import { weaviate, WeaviateClient } from './weaviate'

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('weaviate.client', () => {
  it('should create a client with host', () => {
    const client = weaviate.client({
      host: 'localhost:8080',
    })

    expect(client).toBeDefined()
    expect(client).toBeInstanceOf(WeaviateClient)
  })

  it('should create a client with scheme and host', () => {
    const client = weaviate.client({
      scheme: 'https',
      host: 'weaviate.example.com',
    })

    expect(client).toBeDefined()
  })

  it('should create a client with API key', () => {
    const client = weaviate.client({
      host: 'localhost:8080',
      apiKey: 'test-api-key',
    })

    expect(client).toBeDefined()
  })

  it('should have schema, data, batch, and graphql APIs', () => {
    const client = weaviate.client({ host: 'localhost:8080' })

    expect(client.schema).toBeDefined()
    expect(client.data).toBeDefined()
    expect(client.batch).toBeDefined()
    expect(client.graphql).toBeDefined()
  })

  it('should report isReady', async () => {
    const client = weaviate.client({ host: 'localhost:8080' })

    const ready = await client.isReady()
    expect(ready).toBe(true)
  })

  it('should return meta information', async () => {
    const client = weaviate.client({ host: 'localhost:8080' })

    const meta = await client.getMeta()
    expect(meta.hostname).toBe('localhost:8080')
    expect(meta.version).toContain('dotdo')
  })
})

// ============================================================================
// SCHEMA TESTS
// ============================================================================

describe('schema', () => {
  let client: WeaviateClient

  beforeEach(() => {
    client = weaviate.client({ host: 'localhost:8080' })
  })

  describe('classCreator', () => {
    it('should create a class with basic config', async () => {
      const classConfig: WeaviateClass = {
        class: 'Article',
        description: 'A news article',
        properties: [
          { name: 'title', dataType: ['text'] },
          { name: 'content', dataType: ['text'] },
        ],
      }

      const result = await client.schema
        .classCreator()
        .withClass(classConfig)
        .do()

      expect(result.class).toBe('Article')
      expect(result.properties).toHaveLength(2)
    })

    it('should create a class with vectorizer', async () => {
      const classConfig: WeaviateClass = {
        class: 'Document',
        vectorizer: 'text2vec-openai',
        properties: [{ name: 'text', dataType: ['text'] }],
      }

      const result = await client.schema
        .classCreator()
        .withClass(classConfig)
        .do()

      expect(result.vectorizer).toBe('text2vec-openai')
    })

    it('should create a class with vector index config', async () => {
      const classConfig: WeaviateClass = {
        class: 'Vector',
        vectorizer: 'none',
        vectorIndexConfig: {
          distance: 'cosine',
          ef: 256,
          efConstruction: 128,
        },
        properties: [{ name: 'name', dataType: ['text'] }],
      }

      const result = await client.schema
        .classCreator()
        .withClass(classConfig)
        .do()

      expect(result.vectorIndexConfig?.distance).toBe('cosine')
    })

    it('should throw error for duplicate class', async () => {
      const classConfig: WeaviateClass = {
        class: 'Duplicate',
        properties: [{ name: 'name', dataType: ['text'] }],
      }

      await client.schema.classCreator().withClass(classConfig).do()

      await expect(
        client.schema.classCreator().withClass(classConfig).do()
      ).rejects.toThrow("Class 'Duplicate' already exists")
    })
  })

  describe('getter', () => {
    it('should return empty schema initially', async () => {
      const schema = await client.schema.getter().do()

      expect(schema.classes).toEqual([])
    })

    it('should return all classes', async () => {
      await client.schema
        .classCreator()
        .withClass({ class: 'Class1', properties: [] })
        .do()
      await client.schema
        .classCreator()
        .withClass({ class: 'Class2', properties: [] })
        .do()

      const schema = await client.schema.getter().do()

      expect(schema.classes).toHaveLength(2)
      expect(schema.classes.map((c) => c.class)).toContain('Class1')
      expect(schema.classes.map((c) => c.class)).toContain('Class2')
    })
  })

  describe('classGetter', () => {
    it('should return a specific class', async () => {
      await client.schema
        .classCreator()
        .withClass({
          class: 'MyClass',
          description: 'Test class',
          properties: [{ name: 'field', dataType: ['text'] }],
        })
        .do()

      const classConfig = await client.schema
        .classGetter()
        .withClassName('MyClass')
        .do()

      expect(classConfig.class).toBe('MyClass')
      expect(classConfig.description).toBe('Test class')
    })

    it('should throw error for non-existent class', async () => {
      await expect(
        client.schema.classGetter().withClassName('NonExistent').do()
      ).rejects.toThrow("Class 'NonExistent' not found")
    })
  })

  describe('classDeleter', () => {
    it('should delete a class', async () => {
      await client.schema
        .classCreator()
        .withClass({ class: 'ToDelete', properties: [] })
        .do()

      await client.schema.classDeleter().withClassName('ToDelete').do()

      const schema = await client.schema.getter().do()
      expect(schema.classes).toHaveLength(0)
    })

    it('should throw error for non-existent class', async () => {
      await expect(
        client.schema.classDeleter().withClassName('NonExistent').do()
      ).rejects.toThrow("Class 'NonExistent' not found")
    })
  })

  describe('propertyCreator', () => {
    it('should add a property to existing class', async () => {
      await client.schema
        .classCreator()
        .withClass({ class: 'Extensible', properties: [] })
        .do()

      await client.schema
        .propertyCreator()
        .withClassName('Extensible')
        .withProperty({ name: 'newField', dataType: ['text'] })
        .do()

      const classConfig = await client.schema
        .classGetter()
        .withClassName('Extensible')
        .do()

      expect(classConfig.properties).toHaveLength(1)
      expect(classConfig.properties![0].name).toBe('newField')
    })
  })
})

// ============================================================================
// DATA TESTS
// ============================================================================

describe('data', () => {
  let client: WeaviateClient

  beforeEach(async () => {
    client = weaviate.client({ host: 'localhost:8080' })
    await client.schema
      .classCreator()
      .withClass({
        class: 'Product',
        vectorizer: 'none',
        properties: [
          { name: 'name', dataType: ['text'] },
          { name: 'description', dataType: ['text'] },
          { name: 'price', dataType: ['number'] },
          { name: 'inStock', dataType: ['boolean'] },
          { name: 'tags', dataType: ['text[]'] },
        ],
      })
      .do()
  })

  describe('creator', () => {
    it('should create an object with properties', async () => {
      const obj = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({
          name: 'Widget',
          description: 'A useful widget',
          price: 29.99,
          inStock: true,
        })
        .do()

      expect(obj.id).toBeDefined()
      expect(obj.class).toBe('Product')
      expect(obj.properties.name).toBe('Widget')
    })

    it('should create an object with custom ID', async () => {
      const customId = '12345678-1234-1234-1234-123456789012'

      const obj = await client.data
        .creator()
        .withClassName('Product')
        .withId(customId)
        .withProperties({ name: 'Custom ID Product' })
        .do()

      expect(obj.id).toBe(customId)
    })

    it('should create an object with vector', async () => {
      const vector = [0.1, 0.2, 0.3, 0.4, 0.5]

      const obj = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'Vectorized' })
        .withVector(vector)
        .do()

      expect(obj.vector).toEqual(vector)
    })

    it('should set creation and update timestamps', async () => {
      const before = Date.now()

      const obj = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'Timestamped' })
        .do()

      const after = Date.now()

      expect(obj.creationTimeUnix).toBeGreaterThanOrEqual(before)
      expect(obj.creationTimeUnix).toBeLessThanOrEqual(after)
      expect(obj.lastUpdateTimeUnix).toBe(obj.creationTimeUnix)
    })

    it('should throw error for non-existent class', async () => {
      await expect(
        client.data
          .creator()
          .withClassName('NonExistent')
          .withProperties({ name: 'Test' })
          .do()
      ).rejects.toThrow("Class 'NonExistent' not found")
    })
  })

  describe('getterById', () => {
    it('should get an object by ID', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'Findable', price: 50 })
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .do()

      expect(found).not.toBeNull()
      expect(found!.properties.name).toBe('Findable')
    })

    it('should return null for non-existent ID', async () => {
      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId('non-existent-id')
        .do()

      expect(found).toBeNull()
    })

    it('should include additional fields when requested', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'WithAdditional' })
        .withVector([0.1, 0.2, 0.3])
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .withAdditional(['id', 'vector', 'creationTimeUnix'])
        .do()

      expect(found!.additional).toBeDefined()
      expect(found!.additional!.id).toBe(created.id)
      expect(found!.additional!.vector).toEqual([0.1, 0.2, 0.3])
      expect(found!.additional!.creationTimeUnix).toBeDefined()
    })
  })

  describe('updater', () => {
    it('should update object properties', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'Original', price: 100 })
        .do()

      await client.data
        .updater()
        .withClassName('Product')
        .withId(created.id!)
        .withProperties({ name: 'Updated', price: 150 })
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .do()

      expect(found!.properties.name).toBe('Updated')
      expect(found!.properties.price).toBe(150)
    })

    it('should update vector', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'VectorUpdate' })
        .withVector([0.1, 0.2, 0.3])
        .do()

      await client.data
        .updater()
        .withClassName('Product')
        .withId(created.id!)
        .withVector([0.4, 0.5, 0.6])
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .withAdditional('vector')
        .do()

      expect(found!.additional!.vector).toEqual([0.4, 0.5, 0.6])
    })
  })

  describe('merger', () => {
    it('should merge properties without overwriting all', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'Original', price: 100, inStock: true })
        .do()

      await client.data
        .merger()
        .withClassName('Product')
        .withId(created.id!)
        .withProperties({ price: 150 })
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .do()

      expect(found!.properties.name).toBe('Original')
      expect(found!.properties.price).toBe(150)
      expect(found!.properties.inStock).toBe(true)
    })
  })

  describe('deleter', () => {
    it('should delete an object', async () => {
      const created = await client.data
        .creator()
        .withClassName('Product')
        .withProperties({ name: 'ToDelete' })
        .do()

      await client.data
        .deleter()
        .withClassName('Product')
        .withId(created.id!)
        .do()

      const found = await client.data
        .getterById()
        .withClassName('Product')
        .withId(created.id!)
        .do()

      expect(found).toBeNull()
    })

    it('should throw error for non-existent object', async () => {
      await expect(
        client.data
          .deleter()
          .withClassName('Product')
          .withId('non-existent-id')
          .do()
      ).rejects.toThrow("Object 'non-existent-id' not found")
    })
  })
})

// ============================================================================
// BATCH TESTS
// ============================================================================

describe('batch', () => {
  let client: WeaviateClient

  beforeEach(async () => {
    client = weaviate.client({ host: 'localhost:8080' })
    await client.schema
      .classCreator()
      .withClass({
        class: 'BatchItem',
        vectorizer: 'none',
        properties: [
          { name: 'name', dataType: ['text'] },
          { name: 'value', dataType: ['number'] },
        ],
      })
      .do()
  })

  describe('objectsBatcher', () => {
    it('should create multiple objects', async () => {
      const results = await client.batch
        .objectsBatcher()
        .withClassName('BatchItem')
        .withObjects([
          { properties: { name: 'Item 1', value: 10 } },
          { properties: { name: 'Item 2', value: 20 } },
          { properties: { name: 'Item 3', value: 30 } },
        ])
        .do()

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.status === 'SUCCESS')).toBe(true)
    })

    it('should create objects with vectors', async () => {
      const results = await client.batch
        .objectsBatcher()
        .withClassName('BatchItem')
        .withObjects([
          {
            properties: { name: 'Vec 1' },
            vector: [0.1, 0.2, 0.3],
          },
          {
            properties: { name: 'Vec 2' },
            vector: [0.4, 0.5, 0.6],
          },
        ])
        .do()

      expect(results).toHaveLength(2)
      expect(results[0].status).toBe('SUCCESS')

      // Verify vectors were stored
      const found = await client.data
        .getterById()
        .withClassName('BatchItem')
        .withId(results[0].id)
        .withAdditional('vector')
        .do()

      expect(found!.additional!.vector).toEqual([0.1, 0.2, 0.3])
    })

    it('should handle failed objects', async () => {
      const results = await client.batch
        .objectsBatcher()
        .withObjects([
          { class: 'BatchItem', properties: { name: 'Valid' } },
          { class: 'NonExistent', properties: { name: 'Invalid' } },
        ])
        .do()

      expect(results).toHaveLength(2)
      expect(results[0].status).toBe('SUCCESS')
      expect(results[1].status).toBe('FAILED')
      expect(results[1].errors).toBeDefined()
    })
  })

  describe('objectsDeleter', () => {
    it('should delete objects matching filter', async () => {
      await client.batch
        .objectsBatcher()
        .withClassName('BatchItem')
        .withObjects([
          { properties: { name: 'Keep', value: 100 } },
          { properties: { name: 'Delete', value: 50 } },
          { properties: { name: 'Delete Too', value: 25 } },
        ])
        .do()

      const result = await client.batch
        .objectsDeleter()
        .withClassName('BatchItem')
        .withWhere({
          operator: 'LessThan',
          path: ['value'],
          valueNumber: 75,
        })
        .do()

      expect(result.matches).toBe(2)
      expect(result.successful).toBe(2)
    })
  })
})

// ============================================================================
// GRAPHQL GET TESTS
// ============================================================================

describe('graphql.get', () => {
  let client: WeaviateClient

  beforeEach(async () => {
    client = weaviate.client({ host: 'localhost:8080' })
    await client.schema
      .classCreator()
      .withClass({
        class: 'Article',
        vectorizer: 'none',
        vectorIndexConfig: { distance: 'cosine' },
        properties: [
          { name: 'title', dataType: ['text'] },
          { name: 'content', dataType: ['text'] },
          { name: 'category', dataType: ['text'] },
          { name: 'views', dataType: ['int'] },
        ],
      })
      .do()

    // Insert test data
    await client.batch
      .objectsBatcher()
      .withClassName('Article')
      .withObjects([
        {
          properties: {
            title: 'Introduction to Machine Learning',
            content: 'Machine learning is a subset of artificial intelligence',
            category: 'tech',
            views: 1000,
          },
          vector: [0.9, 0.1, 0.0, 0.0],
        },
        {
          properties: {
            title: 'Deep Learning Fundamentals',
            content: 'Deep learning uses neural networks with many layers',
            category: 'tech',
            views: 2000,
          },
          vector: [0.8, 0.2, 0.0, 0.0],
        },
        {
          properties: {
            title: 'Healthy Cooking Tips',
            content: 'Learn to cook healthy meals at home',
            category: 'lifestyle',
            views: 500,
          },
          vector: [0.0, 0.0, 0.9, 0.1],
        },
      ])
      .do()
  })

  describe('basic queries', () => {
    it('should get all objects with specified fields', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title content')
        .do()

      expect(result.data?.Get?.Article).toHaveLength(3)
      expect(result.data?.Get?.Article?.[0]).toHaveProperty('title')
      expect(result.data?.Get?.Article?.[0]).toHaveProperty('content')
    })

    it('should support limit', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withLimit(2)
        .do()

      expect(result.data?.Get?.Article).toHaveLength(2)
    })

    it('should support offset', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withLimit(2)
        .withOffset(1)
        .do()

      expect(result.data?.Get?.Article).toHaveLength(2)
    })

    it('should include _additional fields', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { id creationTimeUnix }')
        .withLimit(1)
        .do()

      const article = result.data?.Get?.Article?.[0] as Record<string, unknown>
      expect(article._additional).toBeDefined()
      expect((article._additional as Record<string, unknown>).id).toBeDefined()
    })
  })

  describe('nearVector search', () => {
    it('should search by vector similarity', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { id distance }')
        .withNearVector({ vector: [0.9, 0.1, 0.0, 0.0] })
        .withLimit(2)
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2)

      // First result should be most similar
      expect(articles[0].title).toBe('Introduction to Machine Learning')
      expect((articles[0]._additional as Record<string, unknown>).distance).toBeDefined()
    })

    it('should filter by certainty', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { certainty }')
        .withNearVector({ vector: [0.9, 0.1, 0.0, 0.0], certainty: 0.9 })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      // Only very similar articles should match
      expect(articles.length).toBeLessThanOrEqual(2)
    })

    it('should filter by distance', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withNearVector({ vector: [0.9, 0.1, 0.0, 0.0], distance: 0.001 })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      // Only the exact match (distance = 0) should pass with distance < 0.001
      expect(articles.length).toBe(1)
      expect(articles[0].title).toBe('Introduction to Machine Learning')
    })
  })

  describe('nearObject search', () => {
    it('should search by object similarity', async () => {
      // Get an existing object ID
      const initial = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { id }')
        .withLimit(1)
        .do()

      const objectId = (
        (initial.data?.Get?.Article?.[0] as Record<string, unknown>)._additional as Record<
          string,
          unknown
        >
      ).id as string

      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { id distance }')
        .withNearObject({ id: objectId })
        .withLimit(3)
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(3)
    })
  })

  describe('BM25 keyword search', () => {
    it('should search by keywords', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { score }')
        .withBm25({ query: 'machine learning' })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles.length).toBeGreaterThan(0)
      expect(articles[0].title).toContain('Machine Learning')
    })

    it('should search in specific properties', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withBm25({ query: 'learning', properties: ['title'] })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles.length).toBeGreaterThan(0)
    })
  })

  describe('hybrid search', () => {
    it('should combine vector and keyword search', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title _additional { score }')
        .withHybrid({
          query: 'machine learning',
          vector: [0.9, 0.1, 0.0, 0.0],
          alpha: 0.5,
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles.length).toBeGreaterThan(0)
    })

    it('should respect alpha weighting', async () => {
      // Pure keyword search (alpha = 0)
      const keywordOnly = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withHybrid({
          query: 'cooking',
          vector: [0.9, 0.1, 0.0, 0.0],
          alpha: 0,
        })
        .do()

      // Pure vector search (alpha = 1)
      const vectorOnly = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withHybrid({
          query: 'cooking',
          vector: [0.9, 0.1, 0.0, 0.0],
          alpha: 1,
        })
        .do()

      const keywordResults = keywordOnly.data?.Get?.Article as Array<Record<string, unknown>>
      const vectorResults = vectorOnly.data?.Get?.Article as Array<Record<string, unknown>>

      // Keyword search should find cooking article
      expect(keywordResults.some((a) => (a.title as string).includes('Cooking'))).toBe(true)

      // Vector search should prioritize ML articles
      expect((vectorResults[0].title as string).includes('Machine Learning')).toBe(true)
    })
  })

  describe('where filter', () => {
    it('should filter by equality', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title category')
        .withWhere({
          operator: 'Equal',
          path: ['category'],
          valueText: 'tech',
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2)
      expect(articles.every((a) => a.category === 'tech')).toBe(true)
    })

    it('should filter by greater than', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title views')
        .withWhere({
          operator: 'GreaterThan',
          path: ['views'],
          valueInt: 750,
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2)
      expect(articles.every((a) => (a.views as number) > 750)).toBe(true)
    })

    it('should support AND operator', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title category views')
        .withWhere({
          operator: 'And',
          operands: [
            { operator: 'Equal', path: ['category'], valueText: 'tech' },
            { operator: 'GreaterThan', path: ['views'], valueInt: 1500 },
          ],
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(1)
      expect(articles[0].title).toBe('Deep Learning Fundamentals')
    })

    it('should support OR operator', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withWhere({
          operator: 'Or',
          operands: [
            { operator: 'Equal', path: ['category'], valueText: 'lifestyle' },
            { operator: 'GreaterThan', path: ['views'], valueInt: 1500 },
          ],
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2) // Cooking + Deep Learning
    })

    it('should support Like operator', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title')
        .withWhere({
          operator: 'Like',
          path: ['title'],
          valueText: '*Learning*',
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2)
    })

    it('should combine with vector search', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title category _additional { distance }')
        .withNearVector({ vector: [0.9, 0.1, 0.0, 0.0] })
        .withWhere({
          operator: 'Equal',
          path: ['category'],
          valueText: 'tech',
        })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect(articles).toHaveLength(2)
      expect(articles.every((a) => a.category === 'tech')).toBe(true)
    })
  })

  describe('sorting', () => {
    it('should sort by property ascending', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title views')
        .withSort({ path: ['views'], order: 'asc' })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect((articles[0].views as number)).toBeLessThan(articles[1].views as number)
    })

    it('should sort by property descending', async () => {
      const result = await client.graphql
        .get()
        .withClassName('Article')
        .withFields('title views')
        .withSort({ path: ['views'], order: 'desc' })
        .do()

      const articles = result.data?.Get?.Article as Array<Record<string, unknown>>
      expect((articles[0].views as number)).toBeGreaterThan(articles[1].views as number)
    })
  })
})

// ============================================================================
// GRAPHQL AGGREGATE TESTS
// ============================================================================

describe('graphql.aggregate', () => {
  let client: WeaviateClient

  beforeEach(async () => {
    client = weaviate.client({ host: 'localhost:8080' })
    await client.schema
      .classCreator()
      .withClass({
        class: 'Item',
        properties: [
          { name: 'name', dataType: ['text'] },
          { name: 'value', dataType: ['number'] },
        ],
      })
      .do()

    await client.batch
      .objectsBatcher()
      .withClassName('Item')
      .withObjects([
        { properties: { name: 'A', value: 10 } },
        { properties: { name: 'B', value: 20 } },
        { properties: { name: 'C', value: 30 } },
      ])
      .do()
  })

  it('should count objects', async () => {
    const result = await client.graphql
      .aggregate()
      .withClassName('Item')
      .withFields('meta { count }')
      .do()

    const aggregate = result.data?.Aggregate?.Item as Array<Record<string, unknown>>
    expect((aggregate[0].meta as Record<string, unknown>).count).toBe(3)
  })

  it('should count with filter', async () => {
    const result = await client.graphql
      .aggregate()
      .withClassName('Item')
      .withFields('meta { count }')
      .withWhere({
        operator: 'GreaterThan',
        path: ['value'],
        valueNumber: 15,
      })
      .do()

    const aggregate = result.data?.Aggregate?.Item as Array<Record<string, unknown>>
    expect((aggregate[0].meta as Record<string, unknown>).count).toBe(2)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Weaviate integration', () => {
  it('should work with e-commerce product search', async () => {
    const client = weaviate.client({ host: 'localhost:8080' })

    // Create schema
    await client.schema
      .classCreator()
      .withClass({
        class: 'EcomProduct',
        vectorizer: 'none',
        properties: [
          { name: 'name', dataType: ['text'] },
          { name: 'description', dataType: ['text'] },
          { name: 'category', dataType: ['text'] },
          { name: 'price', dataType: ['number'] },
          { name: 'rating', dataType: ['number'] },
        ],
      })
      .do()

    // Insert products with vectors (simulating embeddings)
    await client.batch
      .objectsBatcher()
      .withClassName('EcomProduct')
      .withObjects([
        {
          properties: {
            name: 'Wireless Noise-Cancelling Headphones',
            description: 'Premium audio quality with active noise cancellation',
            category: 'electronics',
            price: 299.99,
            rating: 4.8,
          },
          vector: [0.9, 0.1, 0.0, 0.0, 0.0],
        },
        {
          properties: {
            name: 'Bluetooth Earbuds',
            description: 'Compact wireless earbuds with great sound',
            category: 'electronics',
            price: 79.99,
            rating: 4.2,
          },
          vector: [0.85, 0.15, 0.0, 0.0, 0.0],
        },
        {
          properties: {
            name: 'Running Shoes',
            description: 'Lightweight shoes for marathon training',
            category: 'sports',
            price: 129.99,
            rating: 4.5,
          },
          vector: [0.0, 0.0, 0.9, 0.1, 0.0],
        },
        {
          properties: {
            name: 'Yoga Mat',
            description: 'Non-slip exercise mat for yoga and fitness',
            category: 'sports',
            price: 39.99,
            rating: 4.7,
          },
          vector: [0.0, 0.0, 0.8, 0.2, 0.0],
        },
      ])
      .do()

    // Semantic search for "audio equipment"
    const audioSearch = await client.graphql
      .get()
      .withClassName('EcomProduct')
      .withFields('name price _additional { distance }')
      .withNearVector({ vector: [0.9, 0.1, 0.0, 0.0, 0.0] })
      .withLimit(2)
      .do()

    const audioResults = audioSearch.data?.Get?.EcomProduct as Array<Record<string, unknown>>
    expect(audioResults).toHaveLength(2)
    expect((audioResults[0].name as string).includes('Headphones')).toBe(true)

    // Hybrid search for "wireless audio" in electronics under $100
    const hybridSearch = await client.graphql
      .get()
      .withClassName('EcomProduct')
      .withFields('name price category')
      .withHybrid({
        query: 'wireless audio',
        vector: [0.9, 0.1, 0.0, 0.0, 0.0],
        alpha: 0.5,
      })
      .withWhere({
        operator: 'And',
        operands: [
          { operator: 'Equal', path: ['category'], valueText: 'electronics' },
          { operator: 'LessThan', path: ['price'], valueNumber: 100 },
        ],
      })
      .do()

    const hybridResults = hybridSearch.data?.Get?.EcomProduct as Array<Record<string, unknown>>
    expect(hybridResults).toHaveLength(1)
    expect(hybridResults[0].name).toBe('Bluetooth Earbuds')

    // Aggregate to count products by category
    const statsElectronics = await client.graphql
      .aggregate()
      .withClassName('EcomProduct')
      .withFields('meta { count }')
      .withWhere({
        operator: 'Equal',
        path: ['category'],
        valueText: 'electronics',
      })
      .do()

    const electronicsCount = statsElectronics.data?.Aggregate?.EcomProduct as Array<
      Record<string, unknown>
    >
    expect((electronicsCount[0].meta as Record<string, unknown>).count).toBe(2)
  })

  it('should work with document Q&A use case', async () => {
    const client = weaviate.client({ host: 'localhost:8080' })

    // Create schema for documents
    await client.schema
      .classCreator()
      .withClass({
        class: 'Document',
        vectorizer: 'none',
        properties: [
          { name: 'title', dataType: ['text'] },
          { name: 'content', dataType: ['text'] },
          { name: 'source', dataType: ['text'] },
          { name: 'page', dataType: ['int'] },
        ],
      })
      .do()

    // Insert document chunks
    await client.batch
      .objectsBatcher()
      .withClassName('Document')
      .withObjects([
        {
          properties: {
            title: 'Company Policy',
            content: 'Employees are entitled to 15 days of paid vacation per year.',
            source: 'hr-handbook.pdf',
            page: 12,
          },
          vector: [0.7, 0.3, 0.0],
        },
        {
          properties: {
            title: 'Company Policy',
            content: 'Remote work is allowed with manager approval.',
            source: 'hr-handbook.pdf',
            page: 15,
          },
          vector: [0.2, 0.8, 0.0],
        },
        {
          properties: {
            title: 'Technical Guide',
            content: 'The API uses OAuth2 for authentication.',
            source: 'api-docs.pdf',
            page: 5,
          },
          vector: [0.0, 0.0, 1.0],
        },
      ])
      .do()

    // Question: "How many vacation days do I get?"
    const vacationQuery = await client.graphql
      .get()
      .withClassName('Document')
      .withFields('title content source page _additional { distance }')
      .withNearVector({ vector: [0.7, 0.3, 0.0] })
      .withLimit(1)
      .do()

    const vacationResults = vacationQuery.data?.Get?.Document as Array<Record<string, unknown>>
    expect(vacationResults[0].content).toContain('15 days')

    // Keyword search for "remote work"
    const remoteQuery = await client.graphql
      .get()
      .withClassName('Document')
      .withFields('content source')
      .withBm25({ query: 'remote work' })
      .withLimit(1)
      .do()

    const remoteResults = remoteQuery.data?.Get?.Document as Array<Record<string, unknown>>
    expect(remoteResults[0].content).toContain('Remote work')
  })
})
