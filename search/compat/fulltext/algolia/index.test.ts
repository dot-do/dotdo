/**
 * @dotdo/algolia - Algolia SDK compat tests
 *
 * Tests for Algolia API compatibility backed by DO SQLite FTS5:
 * - Client creation
 * - Index operations (save, get, delete, clear)
 * - Search (query, filters, facets, highlighting)
 * - Browse (pagination, batching)
 * - Settings management
 * - Index management (copy, move, list)
 *
 * @see https://www.algolia.com/doc/api-client/getting-started/install/javascript/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import algoliasearch, { clearAllIndices } from './algolia'
import type { SearchClient, SearchIndex, SearchResponse } from './types'
import { ObjectNotFoundError } from './types'

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('algoliasearch client', () => {
  let client: SearchClient

  beforeEach(() => {
    clearAllIndices()
    client = algoliasearch('test-app-id', 'test-api-key')
  })

  it('should create a client with app ID', () => {
    expect(client).toBeDefined()
    expect(client.appId).toBe('test-app-id')
  })

  it('should initialize an index', () => {
    const index = client.initIndex('products')
    expect(index).toBeDefined()
    expect(index.indexName).toBe('products')
  })

  it('should list indices', async () => {
    const index = client.initIndex('products')
    await index.saveObject({ objectID: '1', name: 'Test' })

    const response = await client.listIndices()
    expect(response.items).toHaveLength(1)
    expect(response.items[0].name).toBe('products')
    expect(response.items[0].entries).toBe(1)
  })
})

// ============================================================================
// SAVE OBJECT TESTS
// ============================================================================

describe('saveObject', () => {
  let index: SearchIndex

  beforeEach(() => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
  })

  it('should save an object with objectID', async () => {
    const response = await index.saveObject({
      objectID: 'product-1',
      name: 'iPhone 15',
      price: 999,
    })

    expect(response.objectID).toBe('product-1')
    expect(response.taskID).toBeDefined()
  })

  it('should auto-generate objectID if not provided', async () => {
    const response = await index.saveObject({
      name: 'MacBook Pro',
      price: 2499,
    })

    expect(response.objectID).toBeDefined()
    expect(response.objectID.length).toBeGreaterThan(0)
  })

  it('should overwrite existing object with same objectID', async () => {
    await index.saveObject({
      objectID: 'product-1',
      name: 'iPhone 15',
      price: 999,
    })

    await index.saveObject({
      objectID: 'product-1',
      name: 'iPhone 15 Pro',
      price: 1199,
    })

    const obj = await index.getObject('product-1')
    expect(obj.name).toBe('iPhone 15 Pro')
    expect(obj.price).toBe(1199)
  })
})

describe('saveObjects', () => {
  let index: SearchIndex

  beforeEach(() => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
  })

  it('should save multiple objects', async () => {
    const response = await index.saveObjects([
      { objectID: '1', name: 'iPhone', price: 999 },
      { objectID: '2', name: 'iPad', price: 799 },
      { objectID: '3', name: 'MacBook', price: 2499 },
    ])

    expect(response.objectIDs).toEqual(['1', '2', '3'])
    expect(response.taskID).toBeDefined()
  })

  it('should auto-generate objectIDs when option is set', async () => {
    const response = await index.saveObjects(
      [
        { name: 'iPhone', price: 999 },
        { name: 'iPad', price: 799 },
      ],
      { autoGenerateObjectIDIfNotExist: true }
    )

    expect(response.objectIDs).toHaveLength(2)
    expect(response.objectIDs[0]).toBeDefined()
    expect(response.objectIDs[1]).toBeDefined()
  })

  it('should throw if objectID missing without autoGenerate', async () => {
    await expect(
      index.saveObjects([{ name: 'iPhone', price: 999 }])
    ).rejects.toThrow()
  })
})

// ============================================================================
// GET OBJECT TESTS
// ============================================================================

describe('getObject', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObject({
      objectID: '1',
      name: 'iPhone 15',
      price: 999,
      category: 'phones',
    })
  })

  it('should get an object by ID', async () => {
    const obj = await index.getObject('1')

    expect(obj.objectID).toBe('1')
    expect(obj.name).toBe('iPhone 15')
    expect(obj.price).toBe(999)
  })

  it('should throw ObjectNotFoundError for missing object', async () => {
    await expect(index.getObject('non-existent')).rejects.toThrow(ObjectNotFoundError)
  })

  it('should filter attributes when specified', async () => {
    const obj = await index.getObject('1', {
      attributesToRetrieve: ['name'],
    })

    expect(obj.objectID).toBe('1')
    expect(obj.name).toBe('iPhone 15')
    expect(obj.price).toBeUndefined()
  })
})

describe('getObjects', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', price: 999 },
      { objectID: '2', name: 'iPad', price: 799 },
      { objectID: '3', name: 'MacBook', price: 2499 },
    ])
  })

  it('should get multiple objects', async () => {
    const response = await index.getObjects(['1', '2'])

    expect(response.results).toHaveLength(2)
    expect(response.results[0].name).toBe('iPhone')
    expect(response.results[1].name).toBe('iPad')
  })

  it('should return null for missing objects', async () => {
    const response = await index.getObjects(['1', 'missing', '3'])

    expect(response.results).toHaveLength(3)
    expect(response.results[0]?.name).toBe('iPhone')
    expect(response.results[1]).toBeNull()
    expect(response.results[2]?.name).toBe('MacBook')
  })
})

// ============================================================================
// DELETE OBJECT TESTS
// ============================================================================

describe('deleteObject', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObject({ objectID: '1', name: 'iPhone', price: 999 })
  })

  it('should delete an object', async () => {
    const response = await index.deleteObject('1')

    expect(response.objectID).toBe('1')
    expect(response.taskID).toBeDefined()

    await expect(index.getObject('1')).rejects.toThrow(ObjectNotFoundError)
  })
})

describe('deleteObjects', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', price: 999 },
      { objectID: '2', name: 'iPad', price: 799 },
      { objectID: '3', name: 'MacBook', price: 2499 },
    ])
  })

  it('should delete multiple objects', async () => {
    const response = await index.deleteObjects(['1', '3'])

    expect(response.objectIDs).toEqual(['1', '3'])

    const searchResult = await index.search('')
    expect(searchResult.nbHits).toBe(1)
    expect(searchResult.hits[0].name).toBe('iPad')
  })
})

describe('clearObjects', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', price: 999 },
      { objectID: '2', name: 'iPad', price: 799 },
    ])
  })

  it('should clear all objects', async () => {
    const response = await index.clearObjects()

    expect(response.taskID).toBeDefined()

    const searchResult = await index.search('')
    expect(searchResult.nbHits).toBe(0)
  })
})

// ============================================================================
// PARTIAL UPDATE TESTS
// ============================================================================

describe('partialUpdateObject', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObject({
      objectID: '1',
      name: 'iPhone 15',
      price: 999,
      stock: 100,
    })
  })

  it('should partially update an object', async () => {
    await index.partialUpdateObject({
      objectID: '1',
      price: 899,
    })

    const obj = await index.getObject('1')
    expect(obj.name).toBe('iPhone 15')
    expect(obj.price).toBe(899)
    expect(obj.stock).toBe(100)
  })

  it('should throw for non-existent object by default', async () => {
    await expect(
      index.partialUpdateObject({ objectID: 'missing', price: 899 })
    ).rejects.toThrow(ObjectNotFoundError)
  })

  it('should create object if createIfNotExists is true', async () => {
    await index.partialUpdateObject(
      { objectID: 'new', price: 899 },
      { createIfNotExists: true }
    )

    const obj = await index.getObject('new')
    expect(obj.objectID).toBe('new')
    expect(obj.price).toBe(899)
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('search', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone 15 Pro', brand: 'Apple', price: 1199, category: 'phones' },
      { objectID: '2', name: 'iPhone 15', brand: 'Apple', price: 999, category: 'phones' },
      { objectID: '3', name: 'Galaxy S24', brand: 'Samsung', price: 899, category: 'phones' },
      { objectID: '4', name: 'MacBook Pro', brand: 'Apple', price: 2499, category: 'laptops' },
      { objectID: '5', name: 'iPad Air', brand: 'Apple', price: 599, category: 'tablets' },
    ])
  })

  it('should search with empty query', async () => {
    const response = await index.search('')

    expect(response.nbHits).toBe(5)
    expect(response.hits).toHaveLength(5)
  })

  it('should search by query term', async () => {
    const response = await index.search('iPhone')

    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => (h as { name: string }).name.includes('iPhone'))).toBe(true)
  })

  it('should search with case insensitivity', async () => {
    const response = await index.search('iphone')

    expect(response.nbHits).toBe(2)
  })

  it('should search with multiple terms', async () => {
    const response = await index.search('iPhone Pro')

    expect(response.nbHits).toBeGreaterThan(0)
    // iPhone 15 Pro should rank higher
    expect((response.hits[0] as { name: string }).name).toBe('iPhone 15 Pro')
  })

  it('should return search metadata', async () => {
    const response = await index.search('MacBook')

    expect(response.query).toBe('MacBook')
    expect(response.page).toBe(0)
    expect(response.hitsPerPage).toBeDefined()
    expect(response.nbPages).toBeDefined()
    expect(response.processingTimeMS).toBeDefined()
    expect(response.params).toBeDefined()
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('search pagination', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')

    // Create 25 products
    const products = Array.from({ length: 25 }, (_, i) => ({
      objectID: String(i + 1),
      name: `Product ${i + 1}`,
      price: (i + 1) * 10,
    }))
    await index.saveObjects(products)
  })

  it('should paginate results with hitsPerPage', async () => {
    const response = await index.search('', { hitsPerPage: 10 })

    expect(response.hits).toHaveLength(10)
    expect(response.nbHits).toBe(25)
    expect(response.nbPages).toBe(3)
    expect(response.page).toBe(0)
  })

  it('should return specific page', async () => {
    const response = await index.search('', { hitsPerPage: 10, page: 1 })

    expect(response.hits).toHaveLength(10)
    expect(response.page).toBe(1)
  })

  it('should return partial last page', async () => {
    const response = await index.search('', { hitsPerPage: 10, page: 2 })

    expect(response.hits).toHaveLength(5)
    expect(response.page).toBe(2)
  })
})

// ============================================================================
// FILTER TESTS
// ============================================================================

describe('search filters', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone 15 Pro', brand: 'Apple', price: 1199, category: 'phones', inStock: true },
      { objectID: '2', name: 'iPhone 15', brand: 'Apple', price: 999, category: 'phones', inStock: false },
      { objectID: '3', name: 'Galaxy S24', brand: 'Samsung', price: 899, category: 'phones', inStock: true },
      { objectID: '4', name: 'MacBook Pro', brand: 'Apple', price: 2499, category: 'laptops', inStock: true },
      { objectID: '5', name: 'iPad Air', brand: 'Apple', price: 599, category: 'tablets', inStock: true },
    ])
  })

  it('should filter by equality', async () => {
    const response = await index.search('', { filters: 'brand:Apple' })

    expect(response.nbHits).toBe(4)
    expect(response.hits.every((h) => (h as { brand: string }).brand === 'Apple')).toBe(true)
  })

  it('should filter by numeric comparison', async () => {
    const response = await index.search('', { filters: 'price<1000' })

    expect(response.nbHits).toBe(3)
    expect(response.hits.every((h) => (h as { price: number }).price < 1000)).toBe(true)
  })

  it('should filter with AND', async () => {
    const response = await index.search('', {
      filters: 'brand:Apple AND category:phones',
    })

    expect(response.nbHits).toBe(2)
  })

  it('should filter with OR', async () => {
    const response = await index.search('', {
      filters: 'category:phones OR category:tablets',
    })

    expect(response.nbHits).toBe(4)
  })

  it('should filter with NOT', async () => {
    const response = await index.search('', {
      filters: 'brand:Apple AND NOT category:phones',
    })

    expect(response.nbHits).toBe(2)
  })

  it('should filter with parentheses', async () => {
    const response = await index.search('', {
      filters: 'brand:Apple AND (category:phones OR category:tablets)',
    })

    expect(response.nbHits).toBe(3)
  })

  it('should filter by boolean', async () => {
    const response = await index.search('', {
      filters: 'inStock:true',
    })

    expect(response.nbHits).toBe(4)
  })
})

describe('facetFilters', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', brand: 'Apple', category: 'phones' },
      { objectID: '2', name: 'MacBook', brand: 'Apple', category: 'laptops' },
      { objectID: '3', name: 'Galaxy', brand: 'Samsung', category: 'phones' },
    ])
  })

  it('should filter by facet string', async () => {
    const response = await index.search('', {
      facetFilters: 'brand:Apple',
    })

    expect(response.nbHits).toBe(2)
  })

  it('should filter by facet array (AND)', async () => {
    const response = await index.search('', {
      facetFilters: ['brand:Apple', 'category:phones'],
    })

    expect(response.nbHits).toBe(1)
  })

  it('should filter by nested facet array (OR within AND)', async () => {
    const response = await index.search('', {
      facetFilters: [['brand:Apple', 'brand:Samsung'], 'category:phones'],
    })

    expect(response.nbHits).toBe(2)
  })

  it('should support negation with -', async () => {
    const response = await index.search('', {
      facetFilters: ['-brand:Samsung'],
    })

    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => (h as { brand: string }).brand !== 'Samsung')).toBe(true)
  })
})

// ============================================================================
// NESTED FACET FILTER TESTS (dotdo-ifnt3)
// ============================================================================

describe('nested facetFilters normalization', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', brand: 'Apple', category: 'phones', status: 'active' },
      { objectID: '2', name: 'MacBook', brand: 'Apple', category: 'laptops', status: 'active' },
      { objectID: '3', name: 'Galaxy', brand: 'Samsung', category: 'phones', status: 'inactive' },
      { objectID: '4', name: 'Pixel', brand: 'Google', category: 'phones', status: 'active' },
    ])
  })

  it('should handle OR within nested array: ["category:A", "category:B"]', async () => {
    // OR: category is phones OR laptops
    const response = await index.search('', {
      facetFilters: [['category:phones', 'category:laptops']],
    })

    expect(response.nbHits).toBe(4)
  })

  it('should handle AND between arrays: [["a"], ["b"]]', async () => {
    // AND: (brand:Apple) AND (category:phones)
    const response = await index.search('', {
      facetFilters: [['brand:Apple'], ['category:phones']],
    })

    expect(response.nbHits).toBe(1)
    expect((response.hits[0] as { name: string }).name).toBe('iPhone')
  })

  it('should handle mixed string and array: ["a", ["b", "c"]]', async () => {
    // Mixed: status:active AND (brand:Apple OR brand:Samsung)
    const response = await index.search('', {
      facetFilters: ['status:active', ['brand:Apple', 'brand:Samsung']],
    })

    // Should match: iPhone (Apple, active), MacBook (Apple, active)
    // Galaxy is Samsung but inactive, Pixel is active but Google
    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => (h as { status: string }).status === 'active')).toBe(true)
    expect(response.hits.every((h) => ['Apple', 'Samsung'].includes((h as { brand: string }).brand))).toBe(true)
  })

  it('should handle array starting with nested array then string: [["a", "b"], "c"]', async () => {
    // (brand:Apple OR brand:Samsung) AND status:active
    const response = await index.search('', {
      facetFilters: [['brand:Apple', 'brand:Samsung'], 'status:active'],
    })

    // Should match: iPhone (Apple, active), MacBook (Apple, active)
    // Galaxy is Samsung but inactive
    expect(response.nbHits).toBe(2)
  })

  it('should handle complex nested filters with negation', async () => {
    // (category:phones) AND NOT brand:Samsung AND status:active
    const response = await index.search('', {
      facetFilters: [['category:phones'], '-brand:Samsung', 'status:active'],
    })

    // Should match: iPhone (phones, Apple, active), Pixel (phones, Google, active)
    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => (h as { brand: string }).brand !== 'Samsung')).toBe(true)
  })

  it('should handle deeply nested OR groups', async () => {
    // (brand:Apple OR brand:Google) AND (category:phones OR category:laptops)
    const response = await index.search('', {
      facetFilters: [['brand:Apple', 'brand:Google'], ['category:phones', 'category:laptops']],
    })

    // Should match: iPhone, MacBook, Pixel
    expect(response.nbHits).toBe(3)
    expect(response.hits.every((h) => ['Apple', 'Google'].includes((h as { brand: string }).brand))).toBe(true)
  })
})

// ============================================================================
// NESTED NUMERIC FILTER TESTS (dotdo-ifnt3)
// ============================================================================

describe('nested numericFilters normalization', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'Budget Phone', price: 299, stock: 100 },
      { objectID: '2', name: 'Mid Phone', price: 599, stock: 50 },
      { objectID: '3', name: 'Premium Phone', price: 999, stock: 25 },
      { objectID: '4', name: 'Ultra Phone', price: 1499, stock: 10 },
    ])
  })

  it('should handle nested numeric filter arrays', async () => {
    // price >= 500 AND price <= 1000
    const response = await index.search('', {
      numericFilters: [['price>=500'], ['price<=1000']],
    })

    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => {
      const price = (h as { price: number }).price
      return price >= 500 && price <= 1000
    })).toBe(true)
  })

  it('should handle mixed string and array numeric filters', async () => {
    // stock>20 AND (price<400 OR price>900)
    const response = await index.search('', {
      numericFilters: ['stock>20', ['price<400', 'price>900']],
    })

    // Budget Phone: price 299 < 400, stock 100 > 20 -> match
    // Mid Phone: price 599 (not < 400, not > 900), stock 50 > 20 -> no match
    // Premium Phone: price 999 > 900, stock 25 > 20 -> match
    // Ultra Phone: price 1499 > 900, stock 10 < 20 -> no match
    expect(response.nbHits).toBe(2)
  })
})

// ============================================================================
// NESTED TAG FILTER TESTS (dotdo-ifnt3)
// ============================================================================

describe('nested tagFilters normalization', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', _tags: ['mobile', 'apple', 'premium'] },
      { objectID: '2', name: 'MacBook', _tags: ['laptop', 'apple', 'premium'] },
      { objectID: '3', name: 'Galaxy', _tags: ['mobile', 'samsung', 'budget'] },
      { objectID: '4', name: 'Chromebook', _tags: ['laptop', 'google', 'budget'] },
    ])
  })

  it('should handle nested tag filter arrays with OR', async () => {
    // (mobile OR laptop) - all items match
    const response = await index.search('', {
      tagFilters: [['mobile', 'laptop']],
    })

    expect(response.nbHits).toBe(4)
  })

  it('should handle AND between tag filter arrays', async () => {
    // mobile AND premium
    const response = await index.search('', {
      tagFilters: [['mobile'], ['premium']],
    })

    expect(response.nbHits).toBe(1)
    expect((response.hits[0] as { name: string }).name).toBe('iPhone')
  })

  it('should handle mixed string and array tag filters', async () => {
    // apple AND (mobile OR laptop)
    const response = await index.search('', {
      tagFilters: ['apple', ['mobile', 'laptop']],
    })

    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => ((h as { _tags: string[] })._tags).includes('apple'))).toBe(true)
  })
})

// ============================================================================
// FACET TESTS
// ============================================================================

describe('facets', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.setSettings({
      attributesForFaceting: ['brand', 'category', 'price'],
    })
    await index.saveObjects([
      { objectID: '1', name: 'iPhone 15 Pro', brand: 'Apple', price: 1199, category: 'phones' },
      { objectID: '2', name: 'iPhone 15', brand: 'Apple', price: 999, category: 'phones' },
      { objectID: '3', name: 'Galaxy S24', brand: 'Samsung', price: 899, category: 'phones' },
      { objectID: '4', name: 'MacBook Pro', brand: 'Apple', price: 2499, category: 'laptops' },
    ])
  })

  it('should return facet counts', async () => {
    const response = await index.search('', { facets: ['brand'] })

    expect(response.facets).toBeDefined()
    expect(response.facets!.brand).toEqual({
      Apple: 3,
      Samsung: 1,
    })
  })

  it('should return multiple facets', async () => {
    const response = await index.search('', {
      facets: ['brand', 'category'],
    })

    expect(response.facets!.brand).toBeDefined()
    expect(response.facets!.category).toBeDefined()
    expect(response.facets!.category).toEqual({
      phones: 3,
      laptops: 1,
    })
  })

  it('should return filtered facet counts', async () => {
    const response = await index.search('', {
      filters: 'category:phones',
      facets: ['brand'],
    })

    expect(response.facets!.brand).toEqual({
      Apple: 2,
      Samsung: 1,
    })
  })
})

describe('searchForFacetValues', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', brand: 'Apple' },
      { objectID: '2', brand: 'Apple' },
      { objectID: '3', brand: 'Samsung' },
      { objectID: '4', brand: 'Sony' },
      { objectID: '5', brand: 'LG' },
    ])
  })

  it('should search for facet values', async () => {
    const response = await index.searchForFacetValues('brand', 'Sam')

    expect(response.facetHits).toHaveLength(1)
    expect(response.facetHits[0].value).toBe('Samsung')
    expect(response.facetHits[0].count).toBe(1)
    expect(response.facetHits[0].highlighted).toContain('<em>')
  })

  it('should return all matching facet values', async () => {
    const response = await index.searchForFacetValues('brand', 'S')

    expect(response.facetHits).toHaveLength(2) // Samsung, Sony
  })
})

// ============================================================================
// HIGHLIGHTING TESTS
// ============================================================================

describe('highlighting', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.setSettings({
      attributesToHighlight: ['name', 'description'],
    })
    await index.saveObjects([
      { objectID: '1', name: 'iPhone 15 Pro', description: 'The latest iPhone from Apple' },
      { objectID: '2', name: 'Galaxy S24', description: 'Samsung flagship phone' },
    ])
  })

  it('should include highlight results', async () => {
    const response = await index.search('iPhone')

    const hit = response.hits[0]
    expect(hit._highlightResult).toBeDefined()
    expect(hit._highlightResult!.name).toBeDefined()
    expect(hit._highlightResult!.name.matchLevel).not.toBe('none')
  })

  it('should use custom highlight tags', async () => {
    const response = await index.search('iPhone', {
      attributesToHighlight: ['name'],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
    })

    const hit = response.hits[0]
    expect(hit._highlightResult!.name.value).toContain('<mark>')
    expect(hit._highlightResult!.name.value).toContain('</mark>')
  })
})

// ============================================================================
// SETTINGS TESTS
// ============================================================================

describe('settings', () => {
  let index: SearchIndex

  beforeEach(() => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
  })

  it('should set and get settings', async () => {
    await index.setSettings({
      searchableAttributes: ['name', 'description'],
      attributesForFaceting: ['brand', 'category'],
      hitsPerPage: 50,
    })

    const settings = await index.getSettings()

    expect(settings.searchableAttributes).toEqual(['name', 'description'])
    expect(settings.attributesForFaceting).toEqual(['brand', 'category'])
    expect(settings.hitsPerPage).toBe(50)
  })

  it('should merge settings', async () => {
    await index.setSettings({ searchableAttributes: ['name'] })
    await index.setSettings({ hitsPerPage: 30 })

    const settings = await index.getSettings()

    expect(settings.searchableAttributes).toEqual(['name'])
    expect(settings.hitsPerPage).toBe(30)
  })
})

// ============================================================================
// BROWSE TESTS
// ============================================================================

describe('browse', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')

    const products = Array.from({ length: 50 }, (_, i) => ({
      objectID: String(i + 1),
      name: `Product ${i + 1}`,
    }))
    await index.saveObjects(products)
  })

  it('should browse all objects', async () => {
    const response = await index.browse({ hitsPerPage: 20 })

    expect(response.hits).toHaveLength(20)
    expect(response.nbHits).toBe(50)
    expect(response.cursor).toBeDefined()
  })

  it('should browse with query', async () => {
    const response = await index.browse({
      query: 'Product 1',
      hitsPerPage: 100,
    })

    // Matches Product 1, Product 10-19
    expect(response.nbHits).toBeGreaterThan(0)
  })
})

describe('browseObjects', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')

    const products = Array.from({ length: 100 }, (_, i) => ({
      objectID: String(i + 1),
      name: `Product ${i + 1}`,
    }))
    await index.saveObjects(products)
  })

  it('should iterate through all objects in batches', async () => {
    const allHits: unknown[] = []

    await index.browseObjects({
      hitsPerPage: 30,
      batch: (hits) => {
        allHits.push(...hits)
      },
    })

    expect(allHits).toHaveLength(100)
  })
})

// ============================================================================
// INDEX MANAGEMENT TESTS
// ============================================================================

describe('index management', () => {
  let client: SearchClient

  beforeEach(() => {
    clearAllIndices()
    client = algoliasearch('test-app-id', 'test-api-key')
  })

  it('should copy an index', async () => {
    const source = client.initIndex('source')
    await source.saveObjects([
      { objectID: '1', name: 'Product 1' },
      { objectID: '2', name: 'Product 2' },
    ])
    await source.setSettings({ hitsPerPage: 50 })

    await client.copyIndex('source', 'destination')

    const dest = client.initIndex('destination')
    const results = await dest.search('')
    expect(results.nbHits).toBe(2)

    const settings = await dest.getSettings()
    expect(settings.hitsPerPage).toBe(50)
  })

  it('should move an index', async () => {
    const source = client.initIndex('source')
    await source.saveObjects([
      { objectID: '1', name: 'Product 1' },
    ])

    await client.moveIndex('source', 'destination')

    const dest = client.initIndex('destination')
    const destResults = await dest.search('')
    expect(destResults.nbHits).toBe(1)

    const sourceResults = await source.search('')
    expect(sourceResults.nbHits).toBe(0)
  })

  it('should check if index exists', async () => {
    const index = client.initIndex('products')

    expect(await index.exists()).toBe(false)

    await index.saveObject({ objectID: '1', name: 'Test' })

    expect(await index.exists()).toBe(true)
  })

  it('should delete an index', async () => {
    const index = client.initIndex('products')
    await index.saveObject({ objectID: '1', name: 'Test' })

    await index.delete()

    expect(await index.exists()).toBe(false)
  })
})

// ============================================================================
// MULTI-INDEX TESTS
// ============================================================================

describe('multipleQueries', () => {
  let client: SearchClient

  beforeEach(async () => {
    clearAllIndices()
    client = algoliasearch('test-app-id', 'test-api-key')

    const products = client.initIndex('products')
    await products.saveObjects([
      { objectID: '1', name: 'iPhone', category: 'phones' },
      { objectID: '2', name: 'MacBook', category: 'laptops' },
    ])

    const users = client.initIndex('users')
    await users.saveObjects([
      { objectID: '1', name: 'John', email: 'john@example.com.ai' },
      { objectID: '2', name: 'Jane', email: 'jane@example.com.ai' },
    ])
  })

  it('should search multiple indices', async () => {
    const response = await client.multipleQueries([
      { indexName: 'products', query: 'iPhone' },
      { indexName: 'users', query: 'John' },
    ])

    expect(response.results).toHaveLength(2)
    expect(response.results[0].nbHits).toBe(1)
    expect(response.results[1].nbHits).toBe(1)
  })
})

describe('multipleGetObjects', () => {
  let client: SearchClient

  beforeEach(async () => {
    clearAllIndices()
    client = algoliasearch('test-app-id', 'test-api-key')

    const products = client.initIndex('products')
    await products.saveObject({ objectID: '1', name: 'iPhone' })

    const users = client.initIndex('users')
    await users.saveObject({ objectID: '1', name: 'John' })
  })

  it('should get objects from multiple indices', async () => {
    const response = await client.multipleGetObjects([
      { indexName: 'products', objectID: '1' },
      { indexName: 'users', objectID: '1' },
      { indexName: 'products', objectID: 'missing' },
    ])

    expect(response.results).toHaveLength(3)
    expect((response.results[0] as { name: string }).name).toBe('iPhone')
    expect((response.results[1] as { name: string }).name).toBe('John')
    expect(response.results[2]).toBeNull()
  })
})

// ============================================================================
// DELETESBY TESTS
// ============================================================================

describe('deleteBy', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', brand: 'Apple', category: 'phones' },
      { objectID: '2', name: 'MacBook', brand: 'Apple', category: 'laptops' },
      { objectID: '3', name: 'Galaxy', brand: 'Samsung', category: 'phones' },
    ])
  })

  it('should delete objects matching filter', async () => {
    await index.deleteBy({ filters: 'brand:Apple' })

    const results = await index.search('')
    expect(results.nbHits).toBe(1)
    expect((results.hits[0] as { brand: string }).brand).toBe('Samsung')
  })

  it('should delete objects matching facetFilters', async () => {
    await index.deleteBy({ facetFilters: ['category:phones'] })

    const results = await index.search('')
    expect(results.nbHits).toBe(1)
    expect((results.hits[0] as { category: string }).category).toBe('laptops')
  })
})

// ============================================================================
// ARRAY FIELD TESTS
// ============================================================================

describe('array fields', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')
    await index.saveObjects([
      { objectID: '1', name: 'iPhone', tags: ['phone', 'apple', 'smartphone'] },
      { objectID: '2', name: 'MacBook', tags: ['laptop', 'apple', 'computer'] },
      { objectID: '3', name: 'Galaxy', tags: ['phone', 'samsung', 'android'] },
    ])
  })

  it('should filter by array field equality', async () => {
    const response = await index.search('', { filters: 'tags:apple' })

    expect(response.nbHits).toBe(2)
  })

  it('should return facet counts for array fields', async () => {
    const response = await index.search('', { facets: ['tags'] })

    expect(response.facets!.tags).toBeDefined()
    expect(response.facets!.tags['apple']).toBe(2)
    expect(response.facets!.tags['phone']).toBe(2)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('e-commerce integration', () => {
  let index: SearchIndex

  beforeEach(async () => {
    clearAllIndices()
    const client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('products')

    await index.setSettings({
      searchableAttributes: ['name', 'description', 'brand'],
      attributesForFaceting: ['brand', 'category', 'price', 'inStock'],
      attributesToHighlight: ['name', 'description'],
    })

    await index.saveObjects([
      { objectID: '1', name: 'iPhone 15 Pro Max', brand: 'Apple', category: 'phones', price: 1199, inStock: true, description: 'The most powerful iPhone ever' },
      { objectID: '2', name: 'iPhone 15', brand: 'Apple', category: 'phones', price: 999, inStock: true, description: 'Beautiful and powerful' },
      { objectID: '3', name: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'phones', price: 1199, inStock: false, description: 'AI-powered Galaxy experience' },
      { objectID: '4', name: 'MacBook Pro 14', brand: 'Apple', category: 'laptops', price: 2499, inStock: true, description: 'Pro performance in a laptop' },
      { objectID: '5', name: 'iPad Pro 12.9', brand: 'Apple', category: 'tablets', price: 1299, inStock: true, description: 'Your next computer is not a computer' },
    ])
  })

  it('should perform a full e-commerce search', async () => {
    const response = await index.search<{
      name: string
      brand: string
      category: string
      price: number
      inStock: boolean
    }>('iPhone', {
      filters: 'inStock:true AND price<1200',
      facets: ['brand', 'category'],
      hitsPerPage: 10,
    })

    // Should find iPhone 15 Pro Max and iPhone 15
    expect(response.nbHits).toBe(2)
    expect(response.hits.every((h) => h.inStock)).toBe(true)
    expect(response.hits.every((h) => h.price < 1200)).toBe(true)
    expect(response.facets).toBeDefined()
  })

  it('should handle combined query and filters', async () => {
    const response = await index.search('powerful', {
      facetFilters: [['brand:Apple', 'brand:Samsung']],
      filters: 'price>=1000',
    })

    expect(response.nbHits).toBeGreaterThan(0)
    expect(response.hits.every((h) => (h as { price: number }).price >= 1000)).toBe(true)
  })
})
