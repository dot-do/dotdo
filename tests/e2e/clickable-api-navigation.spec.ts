import { test, expect } from '@playwright/test'

/**
 * E2E tests for Clickable API Navigation
 *
 * These tests verify that the API supports "click-through" navigation
 * using standard HTTP links. Every URL should be navigable by following
 * the $type, $id, $context, and links properties in responses.
 *
 * The Clickable API pattern enables:
 * - Humans to explore APIs in browser
 * - AI agents to navigate without documentation
 * - Consistent HATEOAS-style navigation
 *
 * Navigation properties:
 * - $type: Link to collection type (e.g., /users)
 * - $id: Canonical URL for this resource
 * - $context: Link to parent context (up the hierarchy)
 * - links: Object with navigation links (edit, collection, etc.)
 * - actions: Object with mutation endpoints
 *
 * @see dotdo-feoqd - RED E2E Clickable API navigation tests
 * @see dotdo-1e9dh - Clickable API: Hono API Shape Implementation (epic)
 */

// Configure all tests to use Accept: application/json header
test.use({
  extraHTTPHeaders: {
    'Accept': 'application/json',
  },
})

test.describe('Clickable API Navigation', () => {
  test.describe('Root to Collection Navigation', () => {
    test('navigates from root to collection via links', async ({ request }) => {
      // Start at API root
      const rootResponse = await request.get('/')
      expect(rootResponse.ok()).toBe(true)

      const root = await rootResponse.json()

      // Root should expose collection links
      expect(root.links).toBeDefined()
      expect(root.links.customers).toBeDefined()

      // Follow customers link to get the collection
      const collectionResponse = await request.get(root.links.customers)
      expect(collectionResponse.ok()).toBe(true)

      const collection = await collectionResponse.json()

      // Collection should have items array
      expect(collection.items).toBeDefined()
      expect(Array.isArray(collection.items)).toBe(true)
    })

    test('root links are valid URL paths', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())

      expect(root.links).toBeDefined()
      // links should be paths (start with /) or full URLs
      for (const [, url] of Object.entries(root.links)) {
        expect(url).toMatch(/^(\/|https?:\/\/)/)
      }
    })
  })

  test.describe('Collection to Item Navigation', () => {
    test('navigates from collection to item via $id', async ({ request }) => {
      // First get root to find a collection
      const root = await request.get('/').then((r) => r.json())
      expect(root.links.customers).toBeDefined()

      // Get the collection
      const collection = await request.get(root.links.customers).then((r) => r.json())
      expect(collection.items).toBeDefined()
      expect(collection.items.length).toBeGreaterThan(0)

      // Each item should have an $id for navigation
      const firstItem = collection.items[0]
      expect(firstItem.$id).toBeDefined()
      expect(typeof firstItem.$id).toBe('string')

      // Follow $id link to get full item details
      const itemResponse = await request.get(firstItem.$id)
      expect(itemResponse.ok()).toBe(true)

      const item = await itemResponse.json()

      // Item should have the same $id (canonical URL)
      expect(item.$id).toBe(firstItem.$id)
    })

    test('collection items include $type for their resource type', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      expect(collection.items.length).toBeGreaterThan(0)

      // Each item should declare its type
      for (const item of collection.items.slice(0, 5)) {
        expect(item.$type).toBeDefined()
        expect(typeof item.$type).toBe('string')
      }
    })
  })

  test.describe('Item to Edit UI Navigation', () => {
    test('navigates from item to edit UI via links.edit', async ({ request }) => {
      // Navigate to an item first
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      expect(collection.items.length).toBeGreaterThan(0)
      const itemUrl = collection.items[0].$id

      const item = await request.get(itemUrl).then((r) => r.json())

      // Item should have links object with edit link
      expect(item.links).toBeDefined()
      expect(item.links.edit).toBeDefined()
      expect(typeof item.links.edit).toBe('string')

      // Follow edit link - edit UI returns HTML, not JSON
      const editResponse = await request.get(item.links.edit)
      expect(editResponse.ok()).toBe(true)

      // Edit returns HTML (Monaco editor UI)
      const contentType = editResponse.headers()['content-type'] || ''
      expect(contentType).toContain('text/html')
    })

    test('edit UI includes Monaco editor', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      const editResponse = await request.get(item.links.edit)
      const html = await editResponse.text()

      // Edit UI should include Monaco editor
      expect(html).toContain('monaco')
    })
  })

  test.describe('Edit to Item Navigation (back)', () => {
    test('edit HTML contains link back to collection', async ({ request }) => {
      // Navigate to edit UI
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      // Edit returns HTML, not JSON
      const editResponse = await request.get(item.links.edit)
      const html = await editResponse.text()

      // HTML should contain reference to the collection or item
      // The edit UI includes the $context which points to collection
      expect(html.toLowerCase()).toContain('customer')
    })

    test('item links.collection returns to collection view', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      // Item should have collection link
      expect(item.links?.collection).toBeDefined()

      const collectionData = await request.get(item.links.collection).then((r) => r.json())

      expect(collectionData.items).toBeDefined()
      expect(Array.isArray(collectionData.items)).toBe(true)
    })
  })

  test.describe('Item to Root Navigation via $context', () => {
    test('item has $context pointing to namespace', async ({ request }) => {
      // Get an item
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      // Item should have $context pointing to namespace
      expect(item.$context).toBeDefined()
      expect(typeof item.$context).toBe('string')

      // $context should be a valid URL
      expect(item.$context).toMatch(/^https?:\/\//)
    })

    test('$context is consistent across items in collection', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      // All items should have the same $context
      const contexts = collection.items?.map((item: { $context: string }) => item.$context) || []
      const uniqueContexts = [...new Set(contexts)]

      // All items in a collection should share the same $context
      expect(uniqueContexts.length).toBe(1)
    })
  })

  test.describe('Full Traversal', () => {
    test('complete navigation: root -> collection -> item -> edit (HTML) -> back to item', async ({ request }) => {
      // Step 1: Start at root
      const rootResponse = await request.get('/')
      expect(rootResponse.ok()).toBe(true)
      const root = await rootResponse.json()
      expect(root.links.customers).toBeDefined()

      // Step 2: Navigate to collection via $type
      const collectionResponse = await request.get(root.links.customers)
      expect(collectionResponse.ok()).toBe(true)
      const collection = await collectionResponse.json()
      expect(collection.items).toBeDefined()
      expect(collection.items.length).toBeGreaterThan(0)

      // Step 3: Navigate to item via $id
      const itemResponse = await request.get(collection.items[0].$id)
      expect(itemResponse.ok()).toBe(true)
      const item = await itemResponse.json()
      expect(item.links?.edit).toBeDefined()

      // Step 4: Navigate to edit via links.edit (returns HTML)
      const editResponse = await request.get(item.links.edit)
      expect(editResponse.ok()).toBe(true)
      const contentType = editResponse.headers()['content-type'] || ''
      expect(contentType).toContain('text/html')

      // Step 5: Navigate back to item via links.collection
      expect(item.links.collection).toBeDefined()
      const collectionBackResponse = await request.get(item.links.collection)
      expect(collectionBackResponse.ok()).toBe(true)
      const collectionBack = await collectionBackResponse.json()
      expect(collectionBack.items).toBeDefined()
    })

    test('all navigation links are self-consistent', async ({ request }) => {
      // Navigate through the API and verify links are consistent
      const root = await request.get('/').then((r) => r.json())

      if (root.links.customers) {
        const collection = await request.get(root.links.customers).then((r) => r.json())

        // Verify collection has proper structure
        expect(collection.$type).toBeDefined()
        expect(collection.items).toBeDefined()

        if (collection.items?.[0]?.$id) {
          const item = await request.get(collection.items[0].$id).then((r) => r.json())

          // Verify item has proper structure
          expect(item.$type).toBeDefined()
          expect(item.$id).toBeDefined()
          expect(item.links).toBeDefined()
        }
      }
    })
  })

  test.describe('Cross-DO Navigation', () => {
    test('$context is defined on collection responses', async ({ request }) => {
      // Test that collections have proper $context
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      // Collection should have $context pointing to its namespace
      expect(collection.$context).toBeDefined()
      expect(typeof collection.$context).toBe('string')
    })

    test('item links include self and collection references', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      if (collection.items?.length > 0) {
        const item = await request.get(collection.items[0].$id).then((r) => r.json())

        // Check for standard navigation links
        expect(item.links).toBeDefined()
        expect(item.links.self || item.$id).toBeDefined()
        expect(item.links.collection).toBeDefined()
      }
    })
  })

  test.describe('Response Shape Consistency', () => {
    test('all responses include $type for type identification', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      expect(root.links.customers).toBeDefined()

      if (root.links.customers) {
        const collection = await request.get(root.links.customers).then((r) => r.json())
        expect(collection.$type).toBeDefined()

        if (collection.items?.[0]?.$id) {
          const item = await request.get(collection.items[0].$id).then((r) => r.json())
          expect(item.$type).toBeDefined()
        }
      }
    })

    test('items have $id as canonical URL', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.links.customers).then((r) => r.json())

      for (const item of collection.items?.slice(0, 5) || []) {
        expect(item.$id).toBeDefined()

        // $id should be a valid URL path
        expect(item.$id).toMatch(/^(\/|https?:\/\/)/)

        // Fetching $id should return the same resource
        const fetched = await request.get(item.$id).then((r) => r.json())
        expect(fetched.$id).toBe(item.$id)
      }
    })
  })
})
