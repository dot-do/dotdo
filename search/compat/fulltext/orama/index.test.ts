/**
 * @dotdo/orama - Orama-compatible full-text search SDK
 *
 * Tests for Orama API compatibility backed by DO SQLite FTS5:
 * - create() - Create a search index with schema
 * - insert() - Insert documents
 * - remove() - Remove documents
 * - update() - Update documents
 * - search() - Full-text search
 * - count() - Count documents
 * - getByID() - Get document by ID
 *
 * @see https://docs.orama.com/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Orama, SearchParams, SearchResult, Schema } from './types'
import {
  create,
  insert,
  insertMultiple,
  remove,
  update,
  search,
  count,
  getByID,
} from './orama'

// ============================================================================
// CREATE TESTS
// ============================================================================

describe('create', () => {
  it('should create a database with schema', async () => {
    const db = await create({
      schema: {
        title: 'string',
        content: 'string',
        category: 'string',
      },
    })

    expect(db).toBeDefined()
    expect(db.schema).toEqual({
      title: 'string',
      content: 'string',
      category: 'string',
    })
  })

  it('should support nested schema', async () => {
    const db = await create({
      schema: {
        name: 'string',
        meta: {
          rating: 'number',
          tags: 'string[]',
        },
      },
    })

    expect(db.schema).toHaveProperty('meta')
    expect(db.schema.meta).toHaveProperty('rating')
  })

  it('should support number type', async () => {
    const db = await create({
      schema: {
        title: 'string',
        price: 'number',
        stock: 'number',
      },
    })

    expect(db.schema.price).toBe('number')
  })

  it('should support boolean type', async () => {
    const db = await create({
      schema: {
        title: 'string',
        active: 'boolean',
      },
    })

    expect(db.schema.active).toBe('boolean')
  })

  it('should support array types', async () => {
    const db = await create({
      schema: {
        title: 'string',
        tags: 'string[]',
      },
    })

    expect(db.schema.tags).toBe('string[]')
  })

  it('should support custom ID field', async () => {
    const db = await create({
      schema: {
        title: 'string',
      },
      id: 'custom_id',
    })

    expect(db.id).toBe('custom_id')
  })

  it('should support default language', async () => {
    const db = await create({
      schema: {
        title: 'string',
      },
      language: 'english',
    })

    expect(db.language).toBe('english')
  })
})

// ============================================================================
// INSERT TESTS
// ============================================================================

describe('insert', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
        price: 'number',
      },
    })
  })

  it('should insert a document', async () => {
    const id = await insert(db, {
      title: 'Hello World',
      content: 'This is a test document',
      price: 99.99,
    })

    expect(id).toBeDefined()
    expect(typeof id).toBe('string')
  })

  it('should auto-generate ID if not provided', async () => {
    const id = await insert(db, {
      title: 'Test',
      content: 'Content',
      price: 10,
    })

    expect(id).toBeDefined()
    expect(id.length).toBeGreaterThan(0)
  })

  it('should use provided ID', async () => {
    const id = await insert(db, {
      id: 'custom-123',
      title: 'Test',
      content: 'Content',
      price: 10,
    })

    expect(id).toBe('custom-123')
  })

  it('should index string fields for FTS', async () => {
    await insert(db, {
      title: 'Searchable Title',
      content: 'Searchable content here',
      price: 50,
    })

    const results = await search(db, { term: 'searchable' })
    expect(results.count).toBe(1)
  })

  it('should handle nested objects', async () => {
    const db2 = await create({
      schema: {
        name: 'string',
        meta: {
          rating: 'number',
        },
      },
    })

    const id = await insert(db2, {
      name: 'Product',
      meta: { rating: 4.5 },
    })

    expect(id).toBeDefined()
  })
})

describe('insertMultiple', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
      },
    })
  })

  it('should insert multiple documents', async () => {
    const ids = await insertMultiple(db, [
      { title: 'Doc 1', content: 'Content 1' },
      { title: 'Doc 2', content: 'Content 2' },
      { title: 'Doc 3', content: 'Content 3' },
    ])

    expect(ids).toHaveLength(3)
    expect(await count(db)).toBe(3)
  })

  it('should handle batch sizes', async () => {
    const docs = Array.from({ length: 100 }, (_, i) => ({
      title: `Doc ${i}`,
      content: `Content ${i}`,
    }))

    const ids = await insertMultiple(db, docs, 10) // batch size 10

    expect(ids).toHaveLength(100)
    expect(await count(db)).toBe(100)
  })
})

// ============================================================================
// REMOVE TESTS
// ============================================================================

describe('remove', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
      },
    })
  })

  it('should remove a document by ID', async () => {
    const id = await insert(db, {
      title: 'To be deleted',
      content: 'This will be removed',
    })

    expect(await count(db)).toBe(1)

    const removed = await remove(db, id)
    expect(removed).toBe(true)
    expect(await count(db)).toBe(0)
  })

  it('should return false for non-existent ID', async () => {
    const removed = await remove(db, 'non-existent-id')
    expect(removed).toBe(false)
  })

  it('should remove from FTS index', async () => {
    const id = await insert(db, {
      title: 'Unique searchterm',
      content: 'Content',
    })

    let results = await search(db, { term: 'unique' })
    expect(results.count).toBe(1)

    await remove(db, id)

    results = await search(db, { term: 'unique' })
    expect(results.count).toBe(0)
  })
})

// ============================================================================
// UPDATE TESTS
// ============================================================================

describe('update', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
        price: 'number',
      },
    })
  })

  it('should update a document', async () => {
    const id = await insert(db, {
      title: 'Original',
      content: 'Original content',
      price: 100,
    })

    await update(db, id, {
      title: 'Updated',
      content: 'Updated content',
      price: 150,
    })

    const doc = await getByID(db, id)
    expect(doc?.title).toBe('Updated')
    expect(doc?.price).toBe(150)
  })

  it('should update FTS index', async () => {
    const id = await insert(db, {
      title: 'oldterm',
      content: 'Content',
      price: 100,
    })

    let results = await search(db, { term: 'oldterm' })
    expect(results.count).toBe(1)

    await update(db, id, {
      title: 'newterm',
      content: 'Content',
      price: 100,
    })

    results = await search(db, { term: 'oldterm' })
    expect(results.count).toBe(0)

    results = await search(db, { term: 'newterm' })
    expect(results.count).toBe(1)
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('search', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
        category: 'string',
        price: 'number',
      },
    })

    await insertMultiple(db, [
      { title: 'JavaScript Guide', content: 'Learn JavaScript programming', category: 'programming', price: 29 },
      { title: 'TypeScript Handbook', content: 'TypeScript for beginners', category: 'programming', price: 39 },
      { title: 'Python Basics', content: 'Python programming fundamentals', category: 'programming', price: 25 },
      { title: 'Cooking Recipes', content: 'Delicious food recipes', category: 'cooking', price: 19 },
    ])
  })

  it('should search by term', async () => {
    const results = await search(db, { term: 'javascript' })

    expect(results.count).toBe(1)
    expect(results.hits[0].document.title).toBe('JavaScript Guide')
  })

  it('should return multiple matches', async () => {
    const results = await search(db, { term: 'programming' })

    expect(results.count).toBe(3)
  })

  it('should include relevance score', async () => {
    const results = await search(db, { term: 'typescript' })

    expect(results.hits[0].score).toBeDefined()
    expect(typeof results.hits[0].score).toBe('number')
  })

  it('should support limit', async () => {
    const results = await search(db, {
      term: 'programming',
      limit: 2,
    })

    expect(results.hits).toHaveLength(2)
    expect(results.count).toBe(3) // Total matches
  })

  it('should support offset', async () => {
    const results = await search(db, {
      term: 'programming',
      limit: 2,
      offset: 1,
    })

    expect(results.hits).toHaveLength(2)
  })

  it('should support where filter', async () => {
    const results = await search(db, {
      term: 'programming',
      where: {
        category: { eq: 'programming' },
      },
    })

    expect(results.count).toBe(3)
  })

  it('should support numeric filters', async () => {
    const results = await search(db, {
      term: 'programming',
      where: {
        price: { lt: 30 },
      },
    })

    expect(results.count).toBe(2) // JS Guide (29) and Python (25)
  })

  it('should support multiple filters', async () => {
    const results = await search(db, {
      term: 'programming',
      where: {
        category: { eq: 'programming' },
        price: { gte: 30 },
      },
    })

    expect(results.count).toBe(1) // Only TypeScript (39)
    expect(results.hits[0].document.title).toBe('TypeScript Handbook')
  })

  it('should return empty for no matches', async () => {
    const results = await search(db, { term: 'nonexistent' })

    expect(results.count).toBe(0)
    expect(results.hits).toHaveLength(0)
  })

  it('should support boost', async () => {
    const results = await search(db, {
      term: 'guide handbook',
      boost: {
        title: 2,
      },
    })

    expect(results.count).toBeGreaterThan(0)
  })

  it('should support properties filter', async () => {
    const results = await search(db, {
      term: 'programming',
      properties: ['title'],
    })

    // Only searches in title field
    expect(results.count).toBeLessThanOrEqual(3)
  })

  it('should support tolerance (fuzzy)', async () => {
    const results = await search(db, {
      term: 'javascrpt', // typo
      tolerance: 1,
    })

    expect(results.count).toBe(1)
    expect(results.hits[0].document.title).toBe('JavaScript Guide')
  })
})

// ============================================================================
// COUNT TESTS
// ============================================================================

describe('count', () => {
  it('should return 0 for empty database', async () => {
    const db = await create({
      schema: { title: 'string' },
    })

    expect(await count(db)).toBe(0)
  })

  it('should return correct count after inserts', async () => {
    const db = await create({
      schema: { title: 'string' },
    })

    await insert(db, { title: 'Doc 1' })
    await insert(db, { title: 'Doc 2' })
    await insert(db, { title: 'Doc 3' })

    expect(await count(db)).toBe(3)
  })

  it('should update after remove', async () => {
    const db = await create({
      schema: { title: 'string' },
    })

    const id = await insert(db, { title: 'Doc' })
    expect(await count(db)).toBe(1)

    await remove(db, id)
    expect(await count(db)).toBe(0)
  })
})

// ============================================================================
// GET BY ID TESTS
// ============================================================================

describe('getByID', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
        price: 'number',
      },
    })
  })

  it('should get document by ID', async () => {
    const id = await insert(db, {
      title: 'Test',
      content: 'Content',
      price: 99,
    })

    const doc = await getByID(db, id)

    expect(doc).toBeDefined()
    expect(doc?.title).toBe('Test')
    expect(doc?.price).toBe(99)
  })

  it('should return undefined for non-existent ID', async () => {
    const doc = await getByID(db, 'non-existent')
    expect(doc).toBeUndefined()
  })

  it('should include ID in returned document', async () => {
    const id = await insert(db, {
      title: 'Test',
      content: 'Content',
      price: 99,
    })

    const doc = await getByID(db, id)
    expect(doc?.id).toBe(id)
  })
})

// ============================================================================
// FTS5 SPECIFIC TESTS
// ============================================================================

describe('FTS5 features', () => {
  let db: Orama

  beforeEach(async () => {
    db = await create({
      schema: {
        title: 'string',
        content: 'string',
      },
    })

    await insertMultiple(db, [
      { title: 'Quick brown fox', content: 'The quick brown fox jumps over the lazy dog' },
      { title: 'Lazy dog story', content: 'A story about a lazy dog and a quick fox' },
      { title: 'Cat adventures', content: 'Adventures of a curious cat' },
    ])
  })

  it('should match phrase queries', async () => {
    const results = await search(db, {
      term: '"quick brown"',
    })

    expect(results.count).toBe(1)
  })

  it('should support prefix matching', async () => {
    const results = await search(db, {
      term: 'adven*',
    })

    expect(results.count).toBe(1)
  })

  it('should support boolean OR', async () => {
    const results = await search(db, {
      term: 'cat OR dog',
    })

    expect(results.count).toBe(3)
  })

  it('should support boolean AND', async () => {
    const results = await search(db, {
      term: 'quick AND fox',
    })

    expect(results.count).toBe(2)
  })

  it('should support NOT', async () => {
    // "cat NOT dog" should match "Cat adventures" (has cat, no dog)
    const results = await search(db, {
      term: 'cat NOT dog',
    })

    expect(results.count).toBe(1)
    expect(results.hits[0].document.title).toBe('Cat adventures')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Orama integration', () => {
  it('should work with realistic e-commerce data', async () => {
    const db = await create({
      schema: {
        name: 'string',
        description: 'string',
        category: 'string',
        price: 'number',
        inStock: 'boolean',
      },
    })

    await insertMultiple(db, [
      { name: 'Wireless Headphones', description: 'Premium sound quality', category: 'electronics', price: 99, inStock: true },
      { name: 'USB-C Cable', description: 'Fast charging cable', category: 'electronics', price: 15, inStock: true },
      { name: 'Running Shoes', description: 'Lightweight and comfortable', category: 'sports', price: 120, inStock: false },
      { name: 'Yoga Mat', description: 'Non-slip exercise mat', category: 'sports', price: 35, inStock: true },
    ])

    // Search for electronics under $50
    const results = await search(db, {
      term: 'cable charging',
      where: {
        category: { eq: 'electronics' },
        price: { lt: 50 },
      },
    })

    expect(results.count).toBe(1)
    expect(results.hits[0].document.name).toBe('USB-C Cable')
  })
})
