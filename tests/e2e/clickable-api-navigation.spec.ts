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
    test('navigates from root to collection via $type', async ({ request }) => {
      // Start at API root
      const rootResponse = await request.get('/')
      expect(rootResponse.ok()).toBe(true)

      const root = await rootResponse.json()

      // Root should expose its type as a navigable link
      expect(root.$type).toBeDefined()
      expect(typeof root.$type).toBe('string')

      // Follow $type link to get the collection
      const collectionResponse = await request.get(root.$type)
      expect(collectionResponse.ok()).toBe(true)

      const collection = await collectionResponse.json()

      // Collection should have items array
      expect(collection.items).toBeDefined()
      expect(Array.isArray(collection.items)).toBe(true)
    })

    test('root $type link is a valid URL path', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())

      expect(root.$type).toBeDefined()
      // $type should be a path (starts with /) or full URL
      expect(root.$type).toMatch(/^(\/|https?:\/\/)/)
    })
  })

  test.describe('Collection to Item Navigation', () => {
    test('navigates from collection to item via $id', async ({ request }) => {
      // First get root to find a collection
      const root = await request.get('/').then((r) => r.json())
      expect(root.$type).toBeDefined()

      // Get the collection
      const collection = await request.get(root.$type).then((r) => r.json())
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
      const collection = await request.get(root.$type).then((r) => r.json())

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
      const collection = await request.get(root.$type).then((r) => r.json())

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
      const collection = await request.get(root.$type).then((r) => r.json())
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
      const collection = await request.get(root.$type).then((r) => r.json())
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
      const collection = await request.get(root.$type).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      // Item should have collection link
      expect(item.links?.collection).toBeDefined()

      const collectionData = await request.get(item.links.collection).then((r) => r.json())

      expect(collectionData.items).toBeDefined()
      expect(Array.isArray(collectionData.items)).toBe(true)
    })
  })

  test.describe('Item to Root Navigation via $context', () => {
    test('navigates from item to root via $context chain', async ({ request }) => {
      // Get an item deep in the hierarchy
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.$type).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      // Item should have $context pointing up the hierarchy
      expect(item.$context).toBeDefined()

      // Follow $context - may need multiple hops to reach root
      let current = item
      let hops = 0
      const maxHops = 10 // Prevent infinite loops

      while (current.$context && hops < maxHops) {
        const contextResponse = await request.get(current.$context)
        expect(contextResponse.ok()).toBe(true)
        current = await contextResponse.json()
        hops++
      }

      // Should eventually reach root (no $context) or root path
      expect(hops).toBeGreaterThan(0)
    })

    test('$context provides valid parent URL', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.$type).then((r) => r.json())
      const item = await request.get(collection.items[0].$id).then((r) => r.json())

      if (item.$context) {
        // $context should be a valid path or URL
        expect(item.$context).toMatch(/^(\/|https?:\/\/)/)

        // Should return 200 when fetched
        const response = await request.get(item.$context)
        expect(response.ok()).toBe(true)
      }
    })
  })

  test.describe('Full Traversal', () => {
    test('complete navigation: root -> collection -> item -> edit (HTML) -> back to item', async ({ request }) => {
      // Step 1: Start at root
      const rootResponse = await request.get('/')
      expect(rootResponse.ok()).toBe(true)
      const root = await rootResponse.json()
      expect(root.$type).toBeDefined()

      // Step 2: Navigate to collection via $type
      const collectionResponse = await request.get(root.$type)
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

      if (root.$type) {
        const collection = await request.get(root.$type).then((r) => r.json())

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
    test('$context enables navigation across DO boundaries', async ({ request }) => {
      // This tests that $context can cross from one DO namespace to another
      const root = await request.get('/').then((r) => r.json())

      // Root might represent a DO, and $context might point to parent DO
      if (root.$context) {
        const parentContext = await request.get(root.$context)
        expect(parentContext.ok()).toBe(true)

        const parent = await parentContext.json()
        // Parent should be a valid API response with navigation properties
        expect(parent.$type || parent.$id || parent.links).toBeDefined()
      }
    })

    test('related resources across DOs are navigable via links', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.$type).then((r) => r.json())

      if (collection.items?.length > 0) {
        const item = await request.get(collection.items[0].$id).then((r) => r.json())

        // Check for relationship links (e.g., links.owner, links.related)
        if (item.links) {
          const relationshipLinks = Object.entries(item.links).filter(
            ([key]) => !['self', 'edit', 'delete', 'collection', 'item'].includes(key)
          )

          // If there are relationship links, verify they're navigable
          for (const [, url] of relationshipLinks.slice(0, 3)) {
            if (typeof url === 'string') {
              const relatedResponse = await request.get(url as string)
              // Related resources should return success or 404 (if not found)
              expect([200, 201, 404].includes(relatedResponse.status())).toBe(true)
            }
          }
        }
      }
    })
  })

  test.describe('Response Shape Consistency', () => {
    test('all responses include $type for type identification', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      expect(root.$type).toBeDefined()

      if (root.$type) {
        const collection = await request.get(root.$type).then((r) => r.json())
        expect(collection.$type).toBeDefined()

        if (collection.items?.[0]?.$id) {
          const item = await request.get(collection.items[0].$id).then((r) => r.json())
          expect(item.$type).toBeDefined()
        }
      }
    })

    test('items have $id as canonical URL', async ({ request }) => {
      const root = await request.get('/').then((r) => r.json())
      const collection = await request.get(root.$type).then((r) => r.json())

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
