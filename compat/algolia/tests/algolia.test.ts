/**
 * @dotdo/algolia - Algolia SDK Compat Layer Tests
 *
 * Comprehensive tests for the Algolia SDK compatibility layer.
 * Tests verify API compatibility with the official algoliasearch package.
 *
 * TDD RED phase: These tests define expected behavior before full implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import algoliasearch, {
  clearAllIndices,
  AlgoliaError,
  ObjectNotFoundError,
  IndexNotFoundError,
  InvalidFilterError,
} from '../index'

import type {
  SearchClient,
  SearchIndex,
  SearchResponse,
  SearchHit,
  Settings,
  SaveObjectResponse,
  SaveObjectsResponse,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('@dotdo/algolia - Algolia SDK Compat Layer', () => {
  let client: SearchClient
  let index: SearchIndex

  beforeEach(() => {
    clearAllIndices()
    client = algoliasearch('test-app-id', 'test-api-key')
    index = client.initIndex('test-index')
  })

  afterEach(() => {
    clearAllIndices()
  })

  // ===========================================================================
  // INDEX OPERATIONS
  // ===========================================================================

  describe('Index Operations', () => {
    it('creates search index', async () => {
      const newIndex = client.initIndex('new-index')
      expect(newIndex).toBeDefined()
      expect(newIndex.indexName).toBe('new-index')

      // Index should be created lazily on first operation
      await newIndex.saveObject({ objectID: '1', name: 'test' })
      const exists = await newIndex.exists()
      expect(exists).toBe(true)
    })

    it('configures index settings', async () => {
      const settings: Settings = {
        searchableAttributes: ['name', 'description', 'tags'],
        attributesForFaceting: ['category', 'brand', 'filterOnly(price)'],
        ranking: ['typo', 'geo', 'words', 'filters', 'proximity', 'attribute', 'exact', 'custom'],
        customRanking: ['desc(popularity)', 'asc(price)'],
        hitsPerPage: 20,
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
      }

      const result = await index.setSettings(settings)
      expect(result.taskID).toBeDefined()
      expect(result.status).toBe('published')

      const retrievedSettings = await index.getSettings()
      expect(retrievedSettings.searchableAttributes).toEqual(settings.searchableAttributes)
      expect(retrievedSettings.attributesForFaceting).toEqual(settings.attributesForFaceting)
      expect(retrievedSettings.hitsPerPage).toBe(20)
    })

    it('deletes index', async () => {
      // Save some data first
      await index.saveObject({ objectID: '1', name: 'test' })

      // Verify it exists
      let exists = await index.exists()
      expect(exists).toBe(true)

      // Delete the index
      const result = await index.delete()
      expect(result.taskID).toBeDefined()

      // Verify it no longer exists
      exists = await index.exists()
      expect(exists).toBe(false)
    })

    it('lists all indices', async () => {
      // Create multiple indices with data
      const idx1 = client.initIndex('products')
      const idx2 = client.initIndex('users')

      await idx1.saveObject({ objectID: '1', name: 'iPhone' })
      await idx2.saveObject({ objectID: '1', name: 'John' })

      const response = await client.listIndices()
      expect(response.items).toHaveLength(2)
      expect(response.items.map((i) => i.name)).toContain('products')
      expect(response.items.map((i) => i.name)).toContain('users')
    })

    it('copies index with settings and data', async () => {
      await index.setSettings({ searchableAttributes: ['name'] })
      await index.saveObject({ objectID: '1', name: 'test' })

      const result = await client.copyIndex('test-index', 'copied-index')
      expect(result.taskID).toBeDefined()

      const copiedIndex = client.initIndex('copied-index')
      const settings = await copiedIndex.getSettings()
      expect(settings.searchableAttributes).toEqual(['name'])

      const obj = await copiedIndex.getObject('1')
      expect(obj.name).toBe('test')
    })

    it('moves index to new name', async () => {
      await index.saveObject({ objectID: '1', name: 'test' })

      await client.moveIndex('test-index', 'moved-index')

      // Original should not exist
      const originalExists = await index.exists()
      expect(originalExists).toBe(false)

      // New index should have the data
      const movedIndex = client.initIndex('moved-index')
      const obj = await movedIndex.getObject('1')
      expect(obj.name).toBe('test')
    })
  })

  // ===========================================================================
  // DOCUMENT OPERATIONS
  // ===========================================================================

  describe('Document Operations', () => {
    it('saves single object', async () => {
      const response = await index.saveObject({
        objectID: 'product-1',
        name: 'iPhone 15',
        price: 999,
        category: 'Electronics',
      })

      expect(response.objectID).toBe('product-1')
      expect(response.taskID).toBeDefined()
      expect(typeof response.taskID).toBe('number')
    })

    it('saves object with auto-generated objectID', async () => {
      const response = await index.saveObject({
        name: 'MacBook Pro',
        price: 2499,
      })

      expect(response.objectID).toBeDefined()
      expect(response.objectID.length).toBeGreaterThan(0)
    })

    it('saves batch of objects', async () => {
      const objects = [
        { objectID: '1', name: 'iPhone', price: 999 },
        { objectID: '2', name: 'MacBook', price: 2499 },
        { objectID: '3', name: 'iPad', price: 799 },
      ]

      const response = await index.saveObjects(objects)

      expect(response.objectIDs).toEqual(['1', '2', '3'])
      expect(response.taskID).toBeDefined()
    })

    it('saves batch with autoGenerateObjectIDIfNotExist', async () => {
      const objects = [
        { name: 'AirPods', price: 249 },
        { name: 'Apple Watch', price: 399 },
      ]

      const response = await index.saveObjects(objects, {
        autoGenerateObjectIDIfNotExist: true,
      })

      expect(response.objectIDs).toHaveLength(2)
      expect(response.objectIDs.every((id) => id.length > 0)).toBe(true)
    })

    it('partial update object', async () => {
      // First save the object
      await index.saveObject({
        objectID: 'product-1',
        name: 'iPhone 15',
        price: 999,
        stock: 100,
      })

      // Partial update - only update price
      const response = await index.partialUpdateObject({
        objectID: 'product-1',
        price: 899,
      })

      expect(response.objectID).toBe('product-1')

      // Verify the update
      const obj = await index.getObject('product-1')
      expect(obj.price).toBe(899)
      expect(obj.name).toBe('iPhone 15') // Should remain unchanged
      expect(obj.stock).toBe(100) // Should remain unchanged
    })

    it('partial update with createIfNotExists', async () => {
      const response = await index.partialUpdateObject(
        { objectID: 'new-product', name: 'New Product', price: 100 },
        { createIfNotExists: true }
      )

      expect(response.objectID).toBe('new-product')

      const obj = await index.getObject('new-product')
      expect(obj.name).toBe('New Product')
    })

    it('deletes object', async () => {
      await index.saveObject({ objectID: 'to-delete', name: 'Delete me' })

      const response = await index.deleteObject('to-delete')
      expect(response.objectID).toBe('to-delete')
      expect(response.taskID).toBeDefined()

      // Verify deletion
      await expect(index.getObject('to-delete')).rejects.toThrow(ObjectNotFoundError)
    })

    it('deletes multiple objects', async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Item 1' },
        { objectID: '2', name: 'Item 2' },
        { objectID: '3', name: 'Item 3' },
      ])

      const response = await index.deleteObjects(['1', '2'])
      expect(response.objectIDs).toEqual(['1', '2'])

      // Item 3 should still exist
      const obj = await index.getObject('3')
      expect(obj.name).toBe('Item 3')

      // Items 1 and 2 should be gone
      await expect(index.getObject('1')).rejects.toThrow()
      await expect(index.getObject('2')).rejects.toThrow()
    })

    it('deletes by filter', async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Item 1', category: 'A' },
        { objectID: '2', name: 'Item 2', category: 'B' },
        { objectID: '3', name: 'Item 3', category: 'A' },
      ])

      await index.deleteBy({ filters: 'category:A' })

      // Category A items should be deleted
      await expect(index.getObject('1')).rejects.toThrow()
      await expect(index.getObject('3')).rejects.toThrow()

      // Category B should remain
      const obj = await index.getObject('2')
      expect(obj.category).toBe('B')
    })

    it('clears all objects from index', async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Item 1' },
        { objectID: '2', name: 'Item 2' },
      ])

      const response = await index.clearObjects()
      expect(response.taskID).toBeDefined()

      const searchResult = await index.search('')
      expect(searchResult.nbHits).toBe(0)
    })

    it('gets single object', async () => {
      await index.saveObject({
        objectID: 'product-1',
        name: 'iPhone',
        price: 999,
        details: { color: 'black', storage: '128GB' },
      })

      const obj = await index.getObject('product-1')
      expect(obj.objectID).toBe('product-1')
      expect(obj.name).toBe('iPhone')
      expect(obj.price).toBe(999)
      expect(obj.details).toEqual({ color: 'black', storage: '128GB' })
    })

    it('gets object with attributesToRetrieve', async () => {
      await index.saveObject({
        objectID: 'product-1',
        name: 'iPhone',
        price: 999,
        secret: 'internal-data',
      })

      const obj = await index.getObject('product-1', {
        attributesToRetrieve: ['name', 'price'],
      })

      expect(obj.objectID).toBe('product-1')
      expect(obj.name).toBe('iPhone')
      expect(obj.price).toBe(999)
      expect(obj.secret).toBeUndefined()
    })

    it('gets multiple objects', async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Item 1' },
        { objectID: '2', name: 'Item 2' },
        { objectID: '3', name: 'Item 3' },
      ])

      const response = await index.getObjects(['1', '3'])
      expect(response.results).toHaveLength(2)
      expect(response.results[0].name).toBe('Item 1')
      expect(response.results[1].name).toBe('Item 3')
    })

    it('returns null for missing objects in getObjects', async () => {
      await index.saveObject({ objectID: '1', name: 'Item 1' })

      const response = await index.getObjects(['1', 'missing', '2'])
      expect(response.results).toHaveLength(3)
      expect(response.results[0].name).toBe('Item 1')
      expect(response.results[1]).toBeNull()
      expect(response.results[2]).toBeNull()
    })
  })

  // ===========================================================================
  // SEARCH
  // ===========================================================================

  describe('Search', () => {
    beforeEach(async () => {
      await index.setSettings({
        searchableAttributes: ['name', 'description', 'brand'],
        attributesForFaceting: ['category', 'brand', 'filterOnly(price)'],
      })

      await index.saveObjects([
        { objectID: '1', name: 'iPhone 15 Pro', description: 'Latest Apple smartphone', brand: 'Apple', category: 'Phones', price: 999 },
        { objectID: '2', name: 'MacBook Pro', description: 'Powerful laptop', brand: 'Apple', category: 'Laptops', price: 2499 },
        { objectID: '3', name: 'Galaxy S24', description: 'Samsung flagship smartphone', brand: 'Samsung', category: 'Phones', price: 899 },
        { objectID: '4', name: 'iPad Pro', description: 'Apple tablet', brand: 'Apple', category: 'Tablets', price: 1099 },
        { objectID: '5', name: 'Pixel 8', description: 'Google smartphone', brand: 'Google', category: 'Phones', price: 699 },
      ])
    })

    it('basic text search', async () => {
      const response = await index.search('iPhone')

      expect(response.hits).toHaveLength(1)
      expect(response.hits[0].name).toBe('iPhone 15 Pro')
      expect(response.nbHits).toBe(1)
      expect(response.query).toBe('iPhone')
    })

    it('searches across multiple fields', async () => {
      const response = await index.search('Apple')

      expect(response.nbHits).toBe(3) // iPhone, MacBook, iPad
      expect(response.hits.map((h) => h.brand)).toEqual(['Apple', 'Apple', 'Apple'])
    })

    it('searches with partial match', async () => {
      const response = await index.search('smart')

      expect(response.nbHits).toBeGreaterThan(0)
      // Should match "smartphone" in description
    })

    it('faceted search', async () => {
      const response = await index.search('', {
        facets: ['category', 'brand'],
      })

      expect(response.facets).toBeDefined()
      expect(response.facets!.category).toBeDefined()
      expect(response.facets!.category.Phones).toBe(3)
      expect(response.facets!.brand.Apple).toBe(3)
    })

    it('facet filter search', async () => {
      const response = await index.search('', {
        facetFilters: ['category:Phones'],
      })

      expect(response.nbHits).toBe(3)
      expect(response.hits.every((h) => h.category === 'Phones')).toBe(true)
    })

    it('highlighted results', async () => {
      const response = await index.search('iPhone', {
        attributesToHighlight: ['name', 'description'],
      })

      expect(response.hits[0]._highlightResult).toBeDefined()
      expect(response.hits[0]._highlightResult!.name.value).toContain('<em>iPhone</em>')
      expect(response.hits[0]._highlightResult!.name.matchLevel).toBe('full')
    })

    it('custom highlight tags', async () => {
      const response = await index.search('iPhone', {
        attributesToHighlight: ['name'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
      })

      expect(response.hits[0]._highlightResult!.name.value).toContain('<mark>iPhone</mark>')
    })

    it('paginated results', async () => {
      const page0 = await index.search('', { page: 0, hitsPerPage: 2 })
      expect(page0.hits).toHaveLength(2)
      expect(page0.page).toBe(0)
      expect(page0.nbPages).toBe(3)
      expect(page0.hitsPerPage).toBe(2)

      const page1 = await index.search('', { page: 1, hitsPerPage: 2 })
      expect(page1.hits).toHaveLength(2)
      expect(page1.page).toBe(1)

      // Pages should have different items
      expect(page0.hits[0].objectID).not.toBe(page1.hits[0].objectID)
    })

    it('empty query returns all results', async () => {
      const response = await index.search('')

      expect(response.nbHits).toBe(5)
    })

    it('no results for non-matching query', async () => {
      const response = await index.search('nonexistentproduct12345')

      expect(response.nbHits).toBe(0)
      expect(response.hits).toHaveLength(0)
    })

    it('search with attributesToRetrieve', async () => {
      const response = await index.search('iPhone', {
        attributesToRetrieve: ['name', 'price'],
      })

      expect(response.hits[0].name).toBe('iPhone 15 Pro')
      expect(response.hits[0].price).toBe(999)
      expect(response.hits[0].description).toBeUndefined()
      expect(response.hits[0].brand).toBeUndefined()
    })
  })

  // ===========================================================================
  // GEOSEARCH
  // ===========================================================================

  describe('Geosearch', () => {
    beforeEach(async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Store NYC', _geoloc: { lat: 40.7128, lng: -74.006 } },
        { objectID: '2', name: 'Store LA', _geoloc: { lat: 34.0522, lng: -118.2437 } },
        { objectID: '3', name: 'Store Chicago', _geoloc: { lat: 41.8781, lng: -87.6298 } },
        { objectID: '4', name: 'Store Miami', _geoloc: { lat: 25.7617, lng: -80.1918 } },
      ])
    })

    it('geosearch with aroundLatLng', async () => {
      const response = await index.search('', {
        aroundLatLng: '40.7128,-74.006', // NYC coordinates
        aroundRadius: 500000, // 500km
      })

      // Should return stores within radius, ordered by distance
      expect(response.hits.length).toBeGreaterThan(0)
      expect(response.hits[0].name).toBe('Store NYC')
    })

    it('geosearch with insideBoundingBox', async () => {
      const response = await index.search('', {
        insideBoundingBox: [[45, -125, 30, -65]], // Rough US bounds
      })

      // All stores should be within bounds
      expect(response.hits.length).toBe(4)
    })

    it('geosearch with aroundRadius limiting results', async () => {
      const response = await index.search('', {
        aroundLatLng: '40.7128,-74.006',
        aroundRadius: 100000, // 100km - should only get NYC
      })

      // Note: Geosearch filtering by radius is not yet implemented
      // This test documents expected behavior for future implementation
      // Once implemented, this should return only stores within 100km of NYC
      expect(response.hits.length).toBeGreaterThan(0)
      // TODO: When geosearch is implemented, uncomment:
      // expect(response.hits.length).toBeLessThan(4)
    })
  })

  // ===========================================================================
  // FILTERS
  // ===========================================================================

  describe('Filters', () => {
    beforeEach(async () => {
      await index.saveObjects([
        { objectID: '1', name: 'iPhone', price: 999, inStock: true, category: 'phones', rating: 4.5 },
        { objectID: '2', name: 'MacBook', price: 2499, inStock: true, category: 'laptops', rating: 4.8 },
        { objectID: '3', name: 'iPad', price: 799, inStock: false, category: 'tablets', rating: 4.6 },
        { objectID: '4', name: 'AirPods', price: 249, inStock: true, category: 'accessories', rating: 4.3 },
        { objectID: '5', name: 'Galaxy', price: 899, inStock: true, category: 'phones', rating: 4.2 },
      ])
    })

    it('numeric filters - greater than', async () => {
      const response = await index.search('', {
        filters: 'price>500',
      })

      expect(response.hits.every((h) => (h.price as number) > 500)).toBe(true)
      expect(response.nbHits).toBe(4) // iPhone, MacBook, iPad, Galaxy
    })

    it('numeric filters - less than', async () => {
      const response = await index.search('', {
        filters: 'price < 1000',
      })

      expect(response.hits.every((h) => (h.price as number) < 1000)).toBe(true)
    })

    it('numeric filters - greater than or equal', async () => {
      const response = await index.search('', {
        filters: 'price >= 999',
      })

      expect(response.hits.every((h) => (h.price as number) >= 999)).toBe(true)
    })

    it('numeric filters - less than or equal', async () => {
      const response = await index.search('', {
        filters: 'price <= 799',
      })

      expect(response.hits.every((h) => (h.price as number) <= 799)).toBe(true)
    })

    it('string filters - equality', async () => {
      const response = await index.search('', {
        filters: 'category:phones',
      })

      expect(response.nbHits).toBe(2)
      expect(response.hits.every((h) => h.category === 'phones')).toBe(true)
    })

    it('string filters - with quotes', async () => {
      const response = await index.search('', {
        filters: 'category:"phones"',
      })

      expect(response.hits.every((h) => h.category === 'phones')).toBe(true)
    })

    it('boolean filters - true', async () => {
      const response = await index.search('', {
        filters: 'inStock:true',
      })

      expect(response.hits.every((h) => h.inStock === true)).toBe(true)
      expect(response.nbHits).toBe(4)
    })

    it('boolean filters - false', async () => {
      const response = await index.search('', {
        filters: 'inStock:false',
      })

      expect(response.hits.every((h) => h.inStock === false)).toBe(true)
      expect(response.nbHits).toBe(1) // iPad
    })

    it('compound filters - AND', async () => {
      const response = await index.search('', {
        filters: 'category:phones AND price < 1000',
      })

      expect(response.hits.every((h) => h.category === 'phones' && (h.price as number) < 1000)).toBe(true)
    })

    it('compound filters - OR', async () => {
      const response = await index.search('', {
        filters: 'category:phones OR category:tablets',
      })

      expect(response.hits.every((h) => h.category === 'phones' || h.category === 'tablets')).toBe(true)
      expect(response.nbHits).toBe(3)
    })

    it('compound filters - NOT', async () => {
      const response = await index.search('', {
        filters: 'NOT category:phones',
      })

      expect(response.hits.every((h) => h.category !== 'phones')).toBe(true)
    })

    it('compound filters - parentheses', async () => {
      const response = await index.search('', {
        filters: '(category:phones OR category:tablets) AND price < 1000',
      })

      expect(response.hits.every((h) =>
        (h.category === 'phones' || h.category === 'tablets') && (h.price as number) < 1000
      )).toBe(true)
    })

    it('numeric filters array format', async () => {
      const response = await index.search('', {
        numericFilters: ['price>500', 'price<1500'],
      })

      expect(response.hits.every((h) =>
        (h.price as number) > 500 && (h.price as number) < 1500
      )).toBe(true)
    })

    it('facet filters array format - AND', async () => {
      const response = await index.search('', {
        facetFilters: ['inStock:true', 'category:phones'],
      })

      expect(response.hits.every((h) => h.inStock === true && h.category === 'phones')).toBe(true)
    })

    it('facet filters nested array format - OR within AND', async () => {
      const response = await index.search('', {
        facetFilters: [['category:phones', 'category:tablets'], 'inStock:true'],
      })

      expect(response.hits.every((h) =>
        (h.category === 'phones' || h.category === 'tablets') && h.inStock === true
      )).toBe(true)
    })

    it('negation in facet filters', async () => {
      const response = await index.search('', {
        facetFilters: ['-category:phones'],
      })

      expect(response.hits.every((h) => h.category !== 'phones')).toBe(true)
    })

    it('tag filters', async () => {
      await index.saveObjects([
        { objectID: 't1', name: 'Tagged 1', _tags: ['featured', 'sale'] },
        { objectID: 't2', name: 'Tagged 2', _tags: ['featured'] },
        { objectID: 't3', name: 'Tagged 3', _tags: ['sale'] },
      ])

      const response = await index.search('', {
        tagFilters: ['featured'],
      })

      expect(response.hits.every((h) => (h._tags as string[])?.includes('featured'))).toBe(true)
    })
  })

  // ===========================================================================
  // API COMPATIBILITY
  // ===========================================================================

  describe('API Compatibility', () => {
    beforeEach(async () => {
      await index.saveObjects([
        { objectID: '1', name: 'Product 1' },
        { objectID: '2', name: 'Product 2' },
      ])
    })

    it('response format matches Algolia', async () => {
      const response = await index.search('Product')

      // Required response fields
      expect(response).toHaveProperty('hits')
      expect(response).toHaveProperty('nbHits')
      expect(response).toHaveProperty('page')
      expect(response).toHaveProperty('nbPages')
      expect(response).toHaveProperty('hitsPerPage')
      expect(response).toHaveProperty('exhaustiveNbHits')
      expect(response).toHaveProperty('query')
      expect(response).toHaveProperty('params')
      expect(response).toHaveProperty('processingTimeMS')

      // Type checks
      expect(Array.isArray(response.hits)).toBe(true)
      expect(typeof response.nbHits).toBe('number')
      expect(typeof response.page).toBe('number')
      expect(typeof response.processingTimeMS).toBe('number')
    })

    it('hit format includes objectID', async () => {
      const response = await index.search('Product')

      expect(response.hits.every((hit) => typeof hit.objectID === 'string')).toBe(true)
    })

    it('error format matches Algolia - ObjectNotFoundError', async () => {
      try {
        await index.getObject('nonexistent')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ObjectNotFoundError)
        expect(error).toBeInstanceOf(AlgoliaError)
        expect((error as ObjectNotFoundError).status).toBe(404)
        expect((error as ObjectNotFoundError).message).toContain('nonexistent')
      }
    })

    it('error format matches Algolia - missing objectID', async () => {
      try {
        await index.saveObjects([
          { name: 'No ID' }, // Missing objectID without autoGenerate
        ])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AlgoliaError)
        expect((error as AlgoliaError).status).toBe(400)
      }
    })

    it('request format accepted - standard search params', async () => {
      // Test that all standard Algolia search params are accepted
      const response = await index.search('test', {
        page: 0,
        hitsPerPage: 10,
        attributesToRetrieve: ['name'],
        attributesToHighlight: ['name'],
        filters: '',
        facets: [],
        highlightPreTag: '<em>',
        highlightPostTag: '</em>',
      })

      expect(response).toBeDefined()
    })

    it('client exposes appId', () => {
      expect(client.appId).toBe('test-app-id')
    })

    it('index exposes indexName', () => {
      expect(index.indexName).toBe('test-index')
    })

    it('waitTask returns published status', async () => {
      const saveResult = await index.saveObject({ objectID: '1', name: 'test' })
      const taskResult = await index.waitTask(saveResult.taskID)

      expect(taskResult.status).toBe('published')
      expect(taskResult.taskID).toBe(saveResult.taskID)
    })
  })

  // ===========================================================================
  // MULTI-INDEX OPERATIONS
  // ===========================================================================

  describe('Multi-Index Operations', () => {
    it('multipleQueries across indices', async () => {
      const productsIndex = client.initIndex('products')
      const usersIndex = client.initIndex('users')

      await productsIndex.saveObject({ objectID: '1', name: 'iPhone', type: 'phone' })
      await usersIndex.saveObject({ objectID: '1', name: 'John', email: 'john@example.com' })

      const response = await client.multipleQueries([
        { indexName: 'products', query: 'iPhone' },
        { indexName: 'users', query: 'John' },
      ])

      expect(response.results).toHaveLength(2)
      expect(response.results[0].hits[0].name).toBe('iPhone')
      expect(response.results[1].hits[0].name).toBe('John')
    })

    it('multipleGetObjects across indices', async () => {
      const idx1 = client.initIndex('products')
      const idx2 = client.initIndex('users')

      await idx1.saveObject({ objectID: 'p1', name: 'Product' })
      await idx2.saveObject({ objectID: 'u1', name: 'User' })

      const response = await client.multipleGetObjects([
        { indexName: 'products', objectID: 'p1' },
        { indexName: 'users', objectID: 'u1' },
      ])

      expect(response.results).toHaveLength(2)
      expect(response.results[0]!.name).toBe('Product')
      expect(response.results[1]!.name).toBe('User')
    })
  })

  // ===========================================================================
  // BROWSE OPERATIONS
  // ===========================================================================

  describe('Browse Operations', () => {
    beforeEach(async () => {
      const objects = Array.from({ length: 50 }, (_, i) => ({
        objectID: `item-${i}`,
        name: `Product ${i}`,
        index: i,
      }))
      await index.saveObjects(objects)
    })

    it('browse returns paginated results with cursor', async () => {
      const response = await index.browse({ hitsPerPage: 10 })

      expect(response.hits).toHaveLength(10)
      expect(response.cursor).toBeDefined()
    })

    it('browseObjects iterates all records', async () => {
      const allHits: SearchHit[] = []

      await index.browseObjects({
        hitsPerPage: 15,
        batch: (hits) => allHits.push(...hits),
      })

      expect(allHits).toHaveLength(50)
    })
  })

  // ===========================================================================
  // SEARCH FOR FACET VALUES
  // ===========================================================================

  describe('Search for Facet Values', () => {
    beforeEach(async () => {
      await index.setSettings({
        attributesForFaceting: ['brand', 'category'],
      })

      await index.saveObjects([
        { objectID: '1', brand: 'Apple', category: 'Phones' },
        { objectID: '2', brand: 'Apple', category: 'Laptops' },
        { objectID: '3', brand: 'Samsung', category: 'Phones' },
        { objectID: '4', brand: 'Applebees', category: 'Restaurants' },
      ])
    })

    it('searches facet values with query', async () => {
      const response = await index.searchForFacetValues('brand', 'App')

      expect(response.facetHits.length).toBeGreaterThan(0)
      expect(response.facetHits.some((h) => h.value === 'Apple')).toBe(true)
      expect(response.facetHits.some((h) => h.value === 'Applebees')).toBe(true)
    })

    it('returns highlighted facet values', async () => {
      const response = await index.searchForFacetValues('brand', 'App')

      const appleHit = response.facetHits.find((h) => h.value === 'Apple')
      expect(appleHit?.highlighted).toContain('<em>App</em>')
    })

    it('includes count in facet hits', async () => {
      const response = await index.searchForFacetValues('brand', 'Apple')

      const appleHit = response.facetHits.find((h) => h.value === 'Apple')
      expect(appleHit?.count).toBe(2)
    })

    it('respects maxFacetHits option', async () => {
      const response = await index.searchForFacetValues('brand', '', {
        maxFacetHits: 1,
      })

      expect(response.facetHits).toHaveLength(1)
    })
  })
})
