import { test, expect } from '@playwright/test'

/**
 * E2E tests for Collection<T> single-collection DO
 *
 * Tests the clickable API design for Collection DOs where:
 * - Root IS the collection (not a DO with multiple collections)
 * - Items are at /:id instead of /:type/:id
 * - $type === $id at root level
 * - Proper parent/child context navigation
 *
 * These tests are RED - they should FAIL until the full implementation
 * is complete. This is TDD: write tests first, then implement.
 *
 * @see docs/plans/2026-01-13-hono-api-shape-design.md
 * @see objects/CollectionDO.ts
 */

/**
 * Test configuration
 *
 * We test against a Collection DO endpoint. In a real deployment,
 * this would be something like https://Startups.Studio or similar.
 * For E2E testing, we use a test endpoint on the dev server.
 */
const COLLECTION_BASE = '/api/test-collection'

test.describe('Collection<T> DO - Root is Collection', () => {
  test('root response has collection shape with items array', async ({ request }) => {
    const response = await request.get(COLLECTION_BASE)

    expect(response.ok()).toBe(true)
    const root = await response.json()

    // Root should have items array (it IS the collection)
    expect(root.items).toBeDefined()
    expect(Array.isArray(root.items)).toBe(true)

    // Root should have count
    expect(root.count).toBeDefined()
    expect(typeof root.count).toBe('number')
  })

  test('$type and $id are same at root level', async ({ request }) => {
    const response = await request.get(COLLECTION_BASE)

    expect(response.ok()).toBe(true)
    const root = await response.json()

    // $type and $id should be same at root (the collection is both its type and identity)
    expect(root.$type).toBeDefined()
    expect(root.$id).toBeDefined()
    expect(root.$type).toBe(root.$id)
  })

  test('root has $context pointing to parent or schema.org.ai', async ({ request }) => {
    const response = await request.get(COLLECTION_BASE)

    expect(response.ok()).toBe(true)
    const root = await response.json()

    // $context should be present
    expect(root.$context).toBeDefined()

    // If no parent (orphan collection), $context should be schema.org.ai/Collection
    // Note: This test assumes an orphan collection for the test endpoint
    expect(root.$context).toMatch(/^https:\/\/schema\.org\.ai\/Collection$|^https:\/\//)
  })
})

test.describe('Collection<T> DO - Item Routing at /:id', () => {
  test('items accessible at /:id (not /:type/:id)', async ({ request }) => {
    // First get the collection to find an item
    const collectionResponse = await request.get(COLLECTION_BASE)
    expect(collectionResponse.ok()).toBe(true)

    const collection = await collectionResponse.json()

    // Skip if no items
    if (!collection.items || collection.items.length === 0) {
      test.skip()
      return
    }

    const firstItem = collection.items[0]

    // Extract the item ID from its $id
    // $id should be like: COLLECTION_BASE/itemId
    expect(firstItem.$id).toBeDefined()

    // The item should be accessible directly at /:id (single path segment after base)
    // NOT at /:type/:id (two path segments)
    const itemIdMatch = firstItem.$id.match(/\/([^/]+)$/)
    expect(itemIdMatch).toBeTruthy()

    const itemId = itemIdMatch![1]
    const itemResponse = await request.get(`${COLLECTION_BASE}/${itemId}`)

    expect(itemResponse.ok()).toBe(true)
    const item = await itemResponse.json()

    // Verify it's the same item
    expect(item.$id).toBe(firstItem.$id)
  })

  test('item $id is BASE/:id format (not BASE/:type/:id)', async ({ request }) => {
    const collectionResponse = await request.get(COLLECTION_BASE)
    expect(collectionResponse.ok()).toBe(true)

    const collection = await collectionResponse.json()

    if (!collection.items || collection.items.length === 0) {
      test.skip()
      return
    }

    for (const item of collection.items) {
      // $id should match the pattern BASE/:id (single path segment after base)
      // NOT BASE/:type/:id (two segments after base)
      const basePattern = COLLECTION_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const singleSegmentPattern = new RegExp(`^.*${basePattern}/[^/]+$`)

      expect(item.$id).toMatch(singleSegmentPattern)
    }
  })
})

test.describe('Collection<T> DO - Context Navigation', () => {
  test('item $context points to collection namespace', async ({ request }) => {
    const collectionResponse = await request.get(COLLECTION_BASE)
    expect(collectionResponse.ok()).toBe(true)

    const collection = await collectionResponse.json()

    if (!collection.items || collection.items.length === 0) {
      test.skip()
      return
    }

    const firstItem = collection.items[0]

    // Item's $context should be the collection namespace (parent)
    expect(firstItem.$context).toBeDefined()

    // For Collection<T>, item $context should match collection $id
    expect(firstItem.$context).toBe(collection.$id)
  })

  test('item $type matches collection namespace (homogeneous collection)', async ({ request }) => {
    const collectionResponse = await request.get(COLLECTION_BASE)
    expect(collectionResponse.ok()).toBe(true)

    const collection = await collectionResponse.json()

    if (!collection.items || collection.items.length === 0) {
      test.skip()
      return
    }

    // All items in a Collection<T> should have the same $type as the collection
    for (const item of collection.items) {
      expect(item.$type).toBe(collection.$type)
    }
  })

  test('orphan collection root $context is schema.org.ai/Collection', async ({ request }) => {
    const response = await request.get(COLLECTION_BASE)
    expect(response.ok()).toBe(true)

    const root = await response.json()

    // For orphan collections (no parent), $context should be the schema URL
    // This assumes the test collection is an orphan
    if (!root._parent) {
      expect(root.$context).toBe('https://schema.org.ai/Collection')
    }
  })
})

test.describe('Collection<T> DO - CRUD Operations', () => {
  const testItemId = `test-item-${Date.now()}`

  test('POST / creates item at root (not POST /:type)', async ({ request }) => {
    const response = await request.post(COLLECTION_BASE, {
      data: {
        id: testItemId,
        name: 'Test Item',
        description: 'Created by E2E test',
      },
    })

    expect(response.status()).toBe(201)
    const created = await response.json()

    // Created item should have proper Collection<T> shape
    expect(created.$id).toContain(testItemId)
    expect(created.$context).toBeDefined()
    expect(created.$type).toBeDefined()
    expect(created.name).toBe('Test Item')
  })

  test('GET /:id retrieves item directly', async ({ request }) => {
    // First ensure item exists
    await request.post(COLLECTION_BASE, {
      data: {
        id: testItemId,
        name: 'Test Item',
      },
    })

    // Then retrieve it directly by ID
    const response = await request.get(`${COLLECTION_BASE}/${testItemId}`)

    expect(response.ok()).toBe(true)
    const item = await response.json()

    expect(item.$id).toContain(testItemId)
    expect(item.name).toBe('Test Item')
  })

  test('DELETE /:id removes item', async ({ request }) => {
    // Ensure item exists
    await request.post(COLLECTION_BASE, {
      data: {
        id: testItemId,
        name: 'Test Item to Delete',
      },
    })

    // Delete it
    const deleteResponse = await request.delete(`${COLLECTION_BASE}/${testItemId}`)
    expect(deleteResponse.status()).toBe(204)

    // Verify it's gone
    const getResponse = await request.get(`${COLLECTION_BASE}/${testItemId}`)
    expect(getResponse.status()).toBe(404)
  })
})

test.describe('Collection<T> DO - Response Shape Compliance', () => {
  test('collection response includes required fields', async ({ request }) => {
    const response = await request.get(COLLECTION_BASE)
    expect(response.ok()).toBe(true)

    const collection = await response.json()

    // Required fields for Collection<T> root
    expect(collection).toHaveProperty('$context')
    expect(collection).toHaveProperty('$type')
    expect(collection).toHaveProperty('$id')
    expect(collection).toHaveProperty('items')
    expect(collection).toHaveProperty('count')
  })

  test('item response includes required fields', async ({ request }) => {
    const collectionResponse = await request.get(COLLECTION_BASE)
    const collection = await collectionResponse.json()

    if (!collection.items || collection.items.length === 0) {
      test.skip()
      return
    }

    const firstItem = collection.items[0]

    // Required fields for Collection<T> item
    expect(firstItem).toHaveProperty('$context')
    expect(firstItem).toHaveProperty('$type')
    expect(firstItem).toHaveProperty('$id')
  })

  test('collection supports pagination cursor', async ({ request }) => {
    const response = await request.get(`${COLLECTION_BASE}?limit=1`)
    expect(response.ok()).toBe(true)

    const collection = await response.json()

    // If there are items and we limited to 1, there should be a cursor
    if (collection.items && collection.items.length > 0 && collection.count > 1) {
      expect(collection.cursor).toBeDefined()
    }
  })
})

test.describe('Collection<T> DO - Error Handling', () => {
  test('GET /:id returns 404 for non-existent item', async ({ request }) => {
    const response = await request.get(`${COLLECTION_BASE}/non-existent-item-${Date.now()}`)

    expect(response.status()).toBe(404)
    const error = await response.json()

    expect(error.$type).toBe('Error')
    expect(error.code).toBe('NOT_FOUND')
  })

  test('nested paths return 404 (Collection only supports /:id)', async ({ request }) => {
    const response = await request.get(`${COLLECTION_BASE}/item/nested/path`)

    expect(response.status()).toBe(404)
  })

  test('POST with duplicate ID returns 409 conflict', async ({ request }) => {
    const uniqueId = `duplicate-test-${Date.now()}`

    // Create first item
    const first = await request.post(COLLECTION_BASE, {
      data: { id: uniqueId, name: 'First' },
    })
    expect(first.status()).toBe(201)

    // Try to create duplicate
    const second = await request.post(COLLECTION_BASE, {
      data: { id: uniqueId, name: 'Duplicate' },
    })
    expect(second.status()).toBe(409)

    // Cleanup
    await request.delete(`${COLLECTION_BASE}/${uniqueId}`)
  })
})
