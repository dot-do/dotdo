/**
 * Clickable API E2E Tests (RED Phase)
 *
 * These tests verify the "clickable" API pattern where every response includes
 * links that are ACTUALLY clickable URLs. This means:
 * - $context, $id, $type are valid URLs
 * - links.self, links.edit, links.collection are present and fetchable
 * - Clicking any link returns a valid response (not 404 or 500)
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS are used - this tests the actual DO behavior.
 *
 * RED PHASE: These tests are expected to FAIL until the full clickable API
 * implementation is complete. The failing tests drive the implementation.
 *
 * Key concepts tested:
 * 1. Root Discovery - GET / returns $context, $id, $type, links.self, collections
 * 2. CRUD with Links - POST/GET/PUT/DELETE operations return entities with clickable links
 * 3. Link Clickability - Every link.* property is actually clickable (returns 200)
 * 4. Collection Listing - GET /:type returns items array with links
 * 5. Content Negotiation - Accept header determines response format
 * 6. Cross-Resource Navigation - Can navigate entire API by clicking links
 *
 * Run with: npx vitest run objects/tests/clickable-api-e2e.test.ts --project=do-integration
 *
 * @module objects/tests/clickable-api-e2e.test
 */

import { SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'

// ============================================================================
// Types
// ============================================================================

/**
 * Base response shape with JSON-LD style properties
 */
interface LinkedDataBase {
  $context: string
  $type: string
  $id: string
}

/**
 * Links object for clickable navigation
 */
interface ClickableLinks {
  self?: string
  edit?: string
  collection?: string
  home?: string
  [key: string]: string | undefined
}

/**
 * Action descriptor for hypermedia controls
 */
interface ClickableAction {
  method: string
  href: string
  type?: string
}

/**
 * Actions object for hypermedia controls
 */
interface ClickableActions {
  create?: ClickableAction
  update?: ClickableAction
  delete?: ClickableAction
  [key: string]: ClickableAction | undefined
}

/**
 * Root response with collections listing
 */
interface RootResponse extends LinkedDataBase {
  ns?: string
  links?: ClickableLinks
  actions?: ClickableActions
  collections?: Record<
    string,
    {
      $id: string
      $type: string
    }
  >
}

/**
 * Entity response with links
 */
interface EntityResponse extends LinkedDataBase {
  links: ClickableLinks
  actions?: ClickableActions
  name?: string
  [key: string]: unknown
}

/**
 * Collection response with items
 */
interface CollectionResponse extends LinkedDataBase {
  items: EntityResponse[]
  total?: number
  count?: number
  links: ClickableLinks
  actions?: ClickableActions
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'clickable'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to make requests to the DO via SELF
 * Constructs the full clickable URL with the namespace as subdomain
 */
function doFetch(ns: string, path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = `https://${ns}.api.dotdo.dev`
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`

  return SELF.fetch(url, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

/**
 * Helper to fetch a clickable link directly
 * Preserves the original URL structure for true clickability testing
 */
function fetchLink(url: string, ns: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(url, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

// ============================================================================
// Root Discovery Tests
// ============================================================================

describe('Clickable API E2E - Root Discovery', () => {
  /**
   * RED TEST: Root response should have $context property
   *
   * Expected behavior:
   * - GET / returns JSON with $context as a valid URL
   * - $context typically points to schema.org or schema.org.ai
   *
   * Current behavior (expected to fail):
   * - $context may not be present or may not be a URL
   */
  it('GET / returns $context as valid URL', async () => {
    const ns = uniqueNs('root-context')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.$context).toBeDefined()
    expect(body.$context).toMatch(/^https?:\/\//)
  })

  /**
   * RED TEST: Root response should have $id as the canonical URL
   *
   * Expected behavior:
   * - $id is the canonical URL for this DO instance
   * - Format: https://{ns}.api.dotdo.dev
   *
   * Current behavior (expected to fail):
   * - $id may be a relative path instead of full URL
   */
  it('GET / returns $id as full canonical URL', async () => {
    const ns = uniqueNs('root-id')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.$id).toBeDefined()
    expect(body.$id).toBe(`https://${ns}.api.dotdo.dev`)
  })

  /**
   * RED TEST: Root response should have $type
   *
   * Expected behavior:
   * - $type identifies the type of this DO
   * - Should be a valid type URL or identifier
   */
  it('GET / returns $type', async () => {
    const ns = uniqueNs('root-type')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.$type).toBeDefined()
    expect(typeof body.$type).toBe('string')
  })

  /**
   * RED TEST: Root response should have links.self
   *
   * Expected behavior:
   * - links.self points to the root URL
   * - Should match $id
   */
  it('GET / returns links.self matching $id', async () => {
    const ns = uniqueNs('root-self')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.links).toBeDefined()
    expect(body.links?.self).toBeDefined()
    expect(body.links?.self).toBe(body.$id)
  })

  /**
   * RED TEST: Root response should list available collections
   *
   * Expected behavior:
   * - collections object lists available entity types
   * - Each collection has $id and $type
   */
  it('GET / returns collections object listing available types', async () => {
    const ns = uniqueNs('root-collections')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.collections).toBeDefined()
    expect(typeof body.collections).toBe('object')

    // Should have at least one collection type
    const collectionNames = Object.keys(body.collections || {})
    expect(collectionNames.length).toBeGreaterThan(0)

    // Each collection should have $id and $type
    for (const name of collectionNames) {
      const collection = body.collections![name]
      expect(collection.$id).toBeDefined()
      expect(collection.$type).toBe('Collection')
    }
  })

  /**
   * RED TEST: Collection links in root should be clickable
   *
   * Expected behavior:
   * - Clicking a collection $id returns the collection
   * - Response status is 200
   */
  it('collection links in root are clickable', async () => {
    const ns = uniqueNs('root-clickable')
    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = (await res.json()) as RootResponse

    expect(body.collections).toBeDefined()

    // Get first collection
    const collectionNames = Object.keys(body.collections || {})
    expect(collectionNames.length).toBeGreaterThan(0)

    const firstCollectionName = collectionNames[0]
    const firstCollection = body.collections![firstCollectionName]

    // Click the collection link
    const collectionRes = await fetchLink(firstCollection.$id, ns)
    expect(collectionRes.status).toBe(200)
  })
})

// ============================================================================
// CRUD with Links Tests
// ============================================================================

describe('Clickable API E2E - CRUD with Links', () => {
  /**
   * RED TEST: POST creates entity with $id and links
   *
   * Expected behavior:
   * - POST /customers creates a new customer
   * - Response has $id as full clickable URL
   * - Response has links.self, links.edit, links.collection
   */
  it('POST /customers returns entity with $id and links', async () => {
    const ns = uniqueNs('crud-post')
    const res = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })

    expect(res.status).toBe(201)

    const body = (await res.json()) as EntityResponse

    // Has $id as full URL
    expect(body.$id).toBeDefined()
    expect(body.$id).toMatch(/^https?:\/\//)
    expect(body.$id).toContain('/customers/')

    // Has links object
    expect(body.links).toBeDefined()
    expect(body.links.self).toBeDefined()
    expect(body.links.edit).toBeDefined()
    expect(body.links.collection).toBeDefined()

    // Collection link points to /customers
    expect(body.links.collection).toBe(`https://${ns}.api.dotdo.dev/customers`)
  })

  /**
   * RED TEST: links.self is actually clickable
   *
   * Expected behavior:
   * - Create entity → get links.self
   * - Fetch links.self → returns same entity
   * - Data matches (name, $id)
   */
  it('links.self is actually clickable - GET returns same entity', async () => {
    const ns = uniqueNs('crud-self')

    // Create entity
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    expect(created.links.self).toBeDefined()

    // Click links.self
    const getRes = await fetchLink(created.links.self!, ns)

    expect(getRes.status).toBe(200)

    const retrieved = (await getRes.json()) as EntityResponse

    expect(retrieved.name).toBe('Bob')
    expect(retrieved.$id).toBe(created.$id)
  })

  /**
   * RED TEST: links.edit returns HTML edit form
   *
   * Expected behavior:
   * - links.edit points to an edit UI endpoint
   * - Fetching it returns text/html
   * - Status is 200
   */
  it('links.edit is clickable and returns edit UI (HTML)', async () => {
    const ns = uniqueNs('crud-edit')

    // Create entity
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    expect(created.links.edit).toBeDefined()

    // Click links.edit
    const editRes = await fetchLink(created.links.edit!, ns, {
      headers: { Accept: 'text/html' },
    })

    expect(editRes.status).toBe(200)

    const contentType = editRes.headers.get('content-type')
    expect(contentType).toContain('text/html')
  })

  /**
   * RED TEST: PUT via links updates the entity
   *
   * Expected behavior:
   * - Create entity with name "David"
   * - PUT to links.self with name "David Updated"
   * - GET links.self returns updated name
   */
  it('PUT via links.self updates the entity', async () => {
    const ns = uniqueNs('crud-put')

    // Create
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'David' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    // Update via PUT to links.self
    const updateRes = await fetchLink(created.links.self!, ns, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'David Updated' }),
    })

    expect(updateRes.status).toBe(200)

    // Verify update
    const getRes = await fetchLink(created.links.self!, ns)
    const updated = (await getRes.json()) as EntityResponse

    expect(updated.name).toBe('David Updated')
  })

  /**
   * RED TEST: DELETE via links removes the entity
   *
   * Expected behavior:
   * - Create entity
   * - DELETE links.self → 200 or 204
   * - GET links.self → 404
   */
  it('DELETE via links.self removes the entity', async () => {
    const ns = uniqueNs('crud-delete')

    // Create
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Eve' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    // DELETE via links.self
    const deleteRes = await fetchLink(created.links.self!, ns, {
      method: 'DELETE',
    })

    expect([200, 204]).toContain(deleteRes.status)

    // Verify deleted
    const getRes = await fetchLink(created.links.self!, ns)
    expect(getRes.status).toBe(404)
  })

  /**
   * RED TEST: links.collection is clickable
   *
   * Expected behavior:
   * - Create entity
   * - links.collection points to the collection
   * - Clicking it returns the collection with the created item
   */
  it('links.collection is clickable and returns the collection', async () => {
    const ns = uniqueNs('crud-collection')

    // Create
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Frank' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    expect(created.links.collection).toBeDefined()

    // Click links.collection
    const collectionRes = await fetchLink(created.links.collection!, ns)

    expect(collectionRes.status).toBe(200)

    const collection = (await collectionRes.json()) as CollectionResponse

    expect(collection.items).toBeDefined()
    expect(Array.isArray(collection.items)).toBe(true)
    expect(collection.items.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Collection Listing Tests
// ============================================================================

describe('Clickable API E2E - Collection Listing', () => {
  /**
   * RED TEST: Collection has $context, $type, $id, items, links
   *
   * Expected behavior:
   * - GET /products returns collection shape
   * - Has all required linked data properties
   * - items is an array
   */
  it('GET /products returns collection with full linked data shape', async () => {
    const ns = uniqueNs('list-shape')

    // Create some products first
    await doFetch(ns, '/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    })

    const res = await doFetch(ns, '/products')

    expect(res.status).toBe(200)

    const body = (await res.json()) as CollectionResponse

    // Has linked data properties
    expect(body.$context).toBeDefined()
    expect(body.$type).toBeDefined()
    expect(body.$id).toBeDefined()

    // Has items array
    expect(body.items).toBeDefined()
    expect(Array.isArray(body.items)).toBe(true)

    // Has links.self
    expect(body.links).toBeDefined()
    expect(body.links.self).toBe(`https://${ns}.api.dotdo.dev/products`)
  })

  /**
   * RED TEST: Collection items have clickable links
   *
   * Expected behavior:
   * - Each item in collection has links.self
   * - Clicking item's links.self returns that item
   */
  it('collection items have clickable links', async () => {
    const ns = uniqueNs('list-items')

    // Create an order
    await doFetch(ns, '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Order 1', qty: 5 }),
    })

    // Get collection
    const listRes = await doFetch(ns, '/orders')

    expect(listRes.status).toBe(200)

    const list = (await listRes.json()) as CollectionResponse

    expect(list.items.length).toBeGreaterThan(0)

    const firstItem = list.items[0]

    // Item has links.self
    expect(firstItem.links).toBeDefined()
    expect(firstItem.links.self).toBeDefined()

    // Click the item's link
    const itemRes = await fetchLink(firstItem.links.self!, ns)

    expect(itemRes.status).toBe(200)

    const item = (await itemRes.json()) as EntityResponse

    expect(item.$id).toBe(firstItem.$id)
  })

  /**
   * RED TEST: Collection supports count/total
   *
   * Expected behavior:
   * - Collection has total or count property
   * - Value matches items.length (for non-paginated)
   */
  it('collection has count/total matching items length', async () => {
    const ns = uniqueNs('list-count')

    // Create multiple tasks
    await doFetch(ns, '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Task 1' }),
    })

    await doFetch(ns, '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Task 2' }),
    })

    const res = await doFetch(ns, '/tasks')

    expect(res.status).toBe(200)

    const body = (await res.json()) as CollectionResponse

    // Has count or total
    const count = body.count ?? body.total
    expect(count).toBeDefined()
    expect(count).toBe(body.items.length)
    expect(count).toBe(2)
  })

  /**
   * RED TEST: Collection links.home navigates back to root
   *
   * Expected behavior:
   * - Collection has links.home
   * - Clicking it returns the root DO response
   */
  it('collection links.home navigates to root', async () => {
    const ns = uniqueNs('list-home')

    const collectionRes = await doFetch(ns, '/customers')

    expect(collectionRes.status).toBe(200)

    const collection = (await collectionRes.json()) as CollectionResponse

    expect(collection.links.home).toBeDefined()

    // Click home
    const homeRes = await fetchLink(collection.links.home!, ns)

    expect(homeRes.status).toBe(200)

    const root = (await homeRes.json()) as RootResponse

    expect(root.collections).toBeDefined()
  })
})

// ============================================================================
// Content Negotiation Tests
// ============================================================================

describe('Clickable API E2E - Content Negotiation', () => {
  /**
   * RED TEST: Accept: application/json returns JSON
   *
   * Expected behavior:
   * - Request with Accept: application/json
   * - Response Content-Type includes application/json
   */
  it('Accept: application/json returns JSON', async () => {
    const ns = uniqueNs('content-json')

    const res = await doFetch(ns, '/', {
      headers: { Accept: 'application/json' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  /**
   * RED TEST: Accept: text/html returns HTML UI
   *
   * Expected behavior:
   * - Request with Accept: text/html
   * - Response Content-Type includes text/html
   * - Response is an HTML document
   */
  it('Accept: text/html returns HTML UI', async () => {
    const ns = uniqueNs('content-html')

    const res = await doFetch(ns, '/', {
      headers: { Accept: 'text/html' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const html = await res.text()
    expect(html).toContain('<')
    expect(html).toContain('>')
  })

  /**
   * RED TEST: Accept: application/ld+json returns JSON-LD
   *
   * Expected behavior:
   * - Request with Accept: application/ld+json
   * - Response Content-Type includes application/ld+json
   */
  it('Accept: application/ld+json returns JSON-LD', async () => {
    const ns = uniqueNs('content-jsonld')

    const res = await doFetch(ns, '/', {
      headers: { Accept: 'application/ld+json' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/ld+json')
  })

  /**
   * RED TEST: Default (no Accept) returns JSON
   *
   * Expected behavior:
   * - Request without Accept header
   * - Defaults to application/json
   */
  it('no Accept header defaults to JSON', async () => {
    const ns = uniqueNs('content-default')

    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// Cross-Resource Navigation Tests
// ============================================================================

describe('Clickable API E2E - Cross-Resource Navigation', () => {
  /**
   * RED TEST: Full navigation cycle: root -> collection -> item -> back
   *
   * Expected behavior:
   * - GET / → click collection link → click item link → click collection link → back to collection
   * - All links return 200
   * - Can traverse the entire API by clicking links
   */
  it('can navigate from root to collection to item and back', async () => {
    const ns = uniqueNs('nav-cycle')

    // 1. Get root
    const rootRes = await doFetch(ns, '/')
    expect(rootRes.status).toBe(200)

    const root = (await rootRes.json()) as RootResponse
    expect(root.collections).toBeDefined()

    const collectionNames = Object.keys(root.collections || {})
    expect(collectionNames.length).toBeGreaterThan(0)

    // 2. Create an item so collection isn't empty
    const firstCollectionName = collectionNames[0]
    await doFetch(ns, `/${firstCollectionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Navigation Test' }),
    })

    // 3. Navigate to collection via link
    const collectionLink = root.collections![firstCollectionName].$id
    const collectionRes = await fetchLink(collectionLink, ns)
    expect(collectionRes.status).toBe(200)

    const collection = (await collectionRes.json()) as CollectionResponse
    expect(collection.items.length).toBeGreaterThan(0)

    // 4. Navigate to item via link
    const itemLink = collection.items[0].links.self!
    const itemRes = await fetchLink(itemLink, ns)
    expect(itemRes.status).toBe(200)

    const item = (await itemRes.json()) as EntityResponse
    expect(item.links.collection).toBeDefined()

    // 5. Navigate back to collection via item's collection link
    const backToCollectionRes = await fetchLink(item.links.collection!, ns)
    expect(backToCollectionRes.status).toBe(200)

    // 6. Navigate home
    const backCollection = (await backToCollectionRes.json()) as CollectionResponse
    expect(backCollection.links.home).toBeDefined()

    const homeRes = await fetchLink(backCollection.links.home!, ns)
    expect(homeRes.status).toBe(200)
  })

  /**
   * RED TEST: All links form a navigable graph (no broken links)
   *
   * Expected behavior:
   * - Every link in the response is clickable
   * - No 404 or 500 errors when clicking links
   */
  it('all links in response are clickable (no broken links)', async () => {
    const ns = uniqueNs('nav-no-broken')

    // Create some data
    await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Link Test' }),
    })

    // Get collection
    const collectionRes = await doFetch(ns, '/customers')
    expect(collectionRes.status).toBe(200)

    const collection = (await collectionRes.json()) as CollectionResponse

    // Check all collection-level links
    const links = collection.links
    const linkEntries = Object.entries(links).filter(([, url]) => url !== undefined)

    for (const [linkName, url] of linkEntries) {
      const linkRes = await fetchLink(url!, ns)
      expect(linkRes.status, `Link '${linkName}' (${url}) should be clickable`).toBe(200)
    }

    // Check all item-level links
    if (collection.items.length > 0) {
      const itemLinks = collection.items[0].links
      const itemLinkEntries = Object.entries(itemLinks).filter(([, url]) => url !== undefined)

      for (const [linkName, url] of itemLinkEntries) {
        // Skip edit links for HTML check (handled separately)
        if (linkName === 'edit') continue

        const linkRes = await fetchLink(url!, ns)
        expect(linkRes.status, `Item link '${linkName}' (${url}) should be clickable`).toBe(200)
      }
    }
  })

  /**
   * RED TEST: $id is self-referential
   *
   * Expected behavior:
   * - Fetching entity.$id returns the same entity
   * - $id in response matches the requested $id
   */
  it('$id is self-referential (fetching returns same entity)', async () => {
    const ns = uniqueNs('nav-self-ref')

    // Create entity
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Self Reference Test' }),
    })

    expect(createRes.status).toBe(201)

    const created = (await createRes.json()) as EntityResponse

    // Fetch by $id
    const fetchRes = await fetchLink(created.$id, ns)
    expect(fetchRes.status).toBe(200)

    const fetched = (await fetchRes.json()) as EntityResponse

    // $id should match
    expect(fetched.$id).toBe(created.$id)
    expect(fetched.name).toBe('Self Reference Test')
  })
})

// ============================================================================
// Error Response Tests
// ============================================================================

describe('Clickable API E2E - Error Responses', () => {
  /**
   * RED TEST: 404 error has proper shape
   *
   * Expected behavior:
   * - GET /customers/non-existent returns 404
   * - Response has $type: 'Error' or error shape
   * - Has code: 'NOT_FOUND'
   */
  it('404 error has proper linked data shape', async () => {
    const ns = uniqueNs('error-404')

    const res = await doFetch(ns, '/customers/non-existent-id-12345')

    expect(res.status).toBe(404)

    const body = (await res.json()) as {
      $type?: string
      code?: string
      error?: string
    }

    expect(body.code).toBe('NOT_FOUND')
  })

  /**
   * RED TEST: Invalid JSON returns 400
   *
   * Expected behavior:
   * - POST with invalid JSON body
   * - Returns 400 Bad Request
   * - Has proper error shape
   */
  it('invalid JSON returns 400 with error shape', async () => {
    const ns = uniqueNs('error-400')

    const res = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as { code?: string }
    expect(body.code).toBeDefined()
  })

  /**
   * RED TEST: Duplicate $id returns 409
   *
   * Expected behavior:
   * - Create entity with custom $id
   * - Create again with same $id
   * - Returns 409 Conflict
   */
  it('duplicate $id returns 409 conflict', async () => {
    const ns = uniqueNs('error-409')
    const customId = `dup-test-${Date.now()}`

    // First create
    const res1 = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ $id: customId, name: 'First' }),
    })

    expect(res1.status).toBe(201)

    // Second create with same ID
    const res2 = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ $id: customId, name: 'Duplicate' }),
    })

    expect(res2.status).toBe(409)

    const body = (await res2.json()) as { code?: string }
    expect(body.code).toBe('DUPLICATE')
  })
})

// ============================================================================
// Actions/Hypermedia Controls Tests
// ============================================================================

describe('Clickable API E2E - Hypermedia Actions', () => {
  /**
   * RED TEST: Collection has actions.create
   *
   * Expected behavior:
   * - GET /customers includes actions.create
   * - actions.create.method is POST
   * - actions.create.href is the collection URL
   */
  it('collection has actions.create pointing to POST', async () => {
    const ns = uniqueNs('action-create')

    const res = await doFetch(ns, '/customers')

    expect(res.status).toBe(200)

    const body = (await res.json()) as CollectionResponse

    expect(body.actions).toBeDefined()
    expect(body.actions?.create).toBeDefined()
    expect(body.actions?.create?.method).toBe('POST')
    expect(body.actions?.create?.href).toMatch(/\/customers$/)
  })

  /**
   * RED TEST: Entity has actions.update
   *
   * Expected behavior:
   * - Created entity has actions.update
   * - method is PUT or PATCH
   * - href points to the entity URL
   */
  it('entity has actions.update pointing to PUT/PATCH', async () => {
    const ns = uniqueNs('action-update')

    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Action Test' }),
    })

    expect(createRes.status).toBe(201)

    const body = (await createRes.json()) as EntityResponse

    expect(body.actions).toBeDefined()
    expect(body.actions?.update).toBeDefined()
    expect(body.actions?.update?.method).toMatch(/^(PUT|PATCH)$/)
    expect(body.actions?.update?.href).toBeDefined()
  })

  /**
   * RED TEST: Entity has actions.delete
   *
   * Expected behavior:
   * - Created entity has actions.delete
   * - method is DELETE
   * - href points to the entity URL
   */
  it('entity has actions.delete pointing to DELETE', async () => {
    const ns = uniqueNs('action-delete')

    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delete Action Test' }),
    })

    expect(createRes.status).toBe(201)

    const body = (await createRes.json()) as EntityResponse

    expect(body.actions).toBeDefined()
    expect(body.actions?.delete).toBeDefined()
    expect(body.actions?.delete?.method).toBe('DELETE')
    expect(body.actions?.delete?.href).toBeDefined()
  })
})
