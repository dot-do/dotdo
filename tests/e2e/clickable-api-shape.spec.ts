/**
 * E2E tests for Clickable API Response Shape
 *
 * These tests verify the "clickable" API response format where:
 * - $context, $type, $id are valid clickable URLs
 * - Links (home, collection, edit) are present and clickable
 * - Actions (update, delete) are present
 * - Collection responses include count, items, links, actions
 *
 * RED PHASE: These tests are expected to FAIL until the API
 * implements the full clickable response shape.
 *
 * @see https://json-ld.org/ for context on $context/$type/$id patterns
 */

import { test, expect } from './fixtures/api.fixture'

/** URL pattern matchers */
const URL_PATTERN = /^https?:\/\//
const COLLECTION_URL_PATTERN = /^https?:\/\/.*\/\w+$/
const ITEM_URL_PATTERN = /^https?:\/\/.*\/\w+\/\w+$/

/**
 * Response shape interfaces for clickable API
 */
interface ClickableBase {
  $context: string
  $type: string
  $id: string
}

interface ClickableLinks {
  home?: string
  self?: string
  collection?: string
  edit?: string
  [key: string]: string | undefined
}

interface ClickableAction {
  method: string
  href: string
  type?: string
}

interface ClickableActions {
  update?: ClickableAction
  delete?: ClickableAction
  create?: ClickableAction
  [key: string]: ClickableAction | undefined
}

interface RootResponse extends ClickableBase {
  links?: ClickableLinks
  actions?: ClickableActions
}

interface CollectionResponse<T = unknown> extends ClickableBase {
  count: number
  items: T[]
  links: ClickableLinks
  actions: ClickableActions
}

interface ItemResponse extends ClickableBase {
  links: ClickableLinks
  actions: ClickableActions
  [key: string]: unknown
}

test.describe('Clickable API - Root Response Shape', () => {
  test('GET / should have $context as valid URL', async ({ apiClient }) => {
    const result = await apiClient.get<RootResponse>('/')

    expect(result.ok).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.$context).toBeDefined()
    expect(result.data!.$context).toMatch(URL_PATTERN)
  })

  test('GET / should have $type as valid URL', async ({ apiClient }) => {
    const result = await apiClient.get<RootResponse>('/')

    expect(result.ok).toBe(true)
    expect(result.data!.$type).toBeDefined()
    expect(result.data!.$type).toMatch(URL_PATTERN)
  })

  test('GET / should have $id as valid URL', async ({ apiClient }) => {
    const result = await apiClient.get<RootResponse>('/')

    expect(result.ok).toBe(true)
    expect(result.data!.$id).toBeDefined()
    expect(result.data!.$id).toMatch(URL_PATTERN)
  })

  test('GET / $context should be fetchable', async ({ apiClient, request }) => {
    const result = await apiClient.get<RootResponse>('/')

    expect(result.ok).toBe(true)
    expect(result.data!.$context).toBeDefined()

    // The $context URL should be clickable and return a valid response
    const contextResponse = await request.get(result.data!.$context)
    expect(contextResponse.status()).toBe(200)
  })
})

test.describe('Clickable API - Collection Response Shape', () => {
  test('GET /customers should return collection with count', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.count).toBeDefined()
    expect(typeof result.data!.count).toBe('number')
    expect(result.data!.count).toBeGreaterThanOrEqual(0)
  })

  test('GET /customers should return collection with items array', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.items).toBeDefined()
    expect(Array.isArray(result.data!.items)).toBe(true)
  })

  test('GET /customers should have $context, $type, $id as URLs', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.$context).toMatch(URL_PATTERN)
    expect(result.data!.$type).toMatch(COLLECTION_URL_PATTERN)
    expect(result.data!.$id).toMatch(URL_PATTERN)
  })

  test('GET /customers should have links object', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links).toBeDefined()
    expect(typeof result.data!.links).toBe('object')
  })

  test('GET /customers should have links.home', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links.home).toBeDefined()
    expect(result.data!.links.home).toMatch(URL_PATTERN)
  })

  test('GET /customers should have links.self', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links.self).toBeDefined()
    expect(result.data!.links.self).toMatch(URL_PATTERN)
  })

  test('GET /customers should have actions object', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.actions).toBeDefined()
    expect(typeof result.data!.actions).toBe('object')
  })

  test('GET /customers should have actions.create', async ({ apiClient }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.actions.create).toBeDefined()
    expect(result.data!.actions.create!.method).toBe('POST')
    expect(result.data!.actions.create!.href).toMatch(URL_PATTERN)
  })

  test('GET /customers links.home should be clickable (200)', async ({ apiClient, request }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links.home).toBeDefined()

    const homeResponse = await request.get(result.data!.links.home!)
    expect(homeResponse.status()).toBe(200)
  })

  test('GET /customers links.self should be clickable (200)', async ({ apiClient, request }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links.self).toBeDefined()

    const selfResponse = await request.get(result.data!.links.self!)
    expect(selfResponse.status()).toBe(200)
  })
})

test.describe('Clickable API - Item Response Shape', () => {
  /**
   * Helper to get a valid customer ID from the collection
   * If no customers exist, the test should still express the expected shape
   */
  async function getFirstCustomerId(apiClient: Awaited<ReturnType<typeof test['fixtures']['apiClient']>>): Promise<string | null> {
    const result = await apiClient.get<CollectionResponse<{ id: string }>>('/customers')
    if (result.ok && result.data?.items?.length > 0) {
      return result.data.items[0].id || result.data.items[0].$id?.split('/').pop() || null
    }
    return null
  }

  test('GET /customers/:id should have $context, $type, $id', async ({ apiClient }) => {
    // Try with a known test ID or first available
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    // Even if 404, we're testing the shape expectation
    if (result.ok) {
      expect(result.data!.$context).toMatch(URL_PATTERN)
      expect(result.data!.$type).toMatch(COLLECTION_URL_PATTERN)
      expect(result.data!.$id).toMatch(ITEM_URL_PATTERN)
    } else {
      // Test expects the endpoint to return item shape when it exists
      expect(result.status).toBe(200)
    }
  })

  test('GET /customers/:id should have $id matching item URL pattern', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.$id).toMatch(ITEM_URL_PATTERN)
    // $id should contain the resource type and ID
    expect(result.data!.$id).toContain('/customers/')
    expect(result.data!.$id).toContain(customerId)
  })

  test('GET /customers/:id should have links.home', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links).toBeDefined()
    expect(result.data!.links.home).toBeDefined()
    expect(result.data!.links.home).toMatch(URL_PATTERN)
  })

  test('GET /customers/:id should have links.collection', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links.collection).toBeDefined()
    expect(result.data!.links.collection).toMatch(URL_PATTERN)
    expect(result.data!.links.collection).toContain('/customers')
  })

  test('GET /customers/:id should have links.self', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links.self).toBeDefined()
    expect(result.data!.links.self).toMatch(ITEM_URL_PATTERN)
  })

  test('GET /customers/:id should have links.edit', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links.edit).toBeDefined()
    expect(result.data!.links.edit).toMatch(URL_PATTERN)
  })

  test('GET /customers/:id should have actions.update', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.actions).toBeDefined()
    expect(result.data!.actions.update).toBeDefined()
    expect(result.data!.actions.update!.method).toMatch(/^(PUT|PATCH)$/)
    expect(result.data!.actions.update!.href).toMatch(URL_PATTERN)
  })

  test('GET /customers/:id should have actions.delete', async ({ apiClient }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.actions).toBeDefined()
    expect(result.data!.actions.delete).toBeDefined()
    expect(result.data!.actions.delete!.method).toBe('DELETE')
    expect(result.data!.actions.delete!.href).toMatch(URL_PATTERN)
  })

  test('GET /customers/:id links.home should be clickable (200)', async ({ apiClient, request }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links.home).toBeDefined()

    const homeResponse = await request.get(result.data!.links.home!)
    expect(homeResponse.status()).toBe(200)
  })

  test('GET /customers/:id links.collection should be clickable (200)', async ({ apiClient, request }) => {
    const customerId = await getFirstCustomerId(apiClient) || 'test-customer-1'
    const result = await apiClient.get<ItemResponse>(`/customers/${customerId}`)

    expect(result.ok).toBe(true)
    expect(result.data!.links.collection).toBeDefined()

    const collectionResponse = await request.get(result.data!.links.collection!)
    expect(collectionResponse.status()).toBe(200)
  })
})

test.describe('Clickable API - URL Consistency', () => {
  test('$type URL should return the collection schema/definition', async ({ apiClient, request }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.$type).toBeDefined()

    // $type should be fetchable and return schema or collection
    const typeResponse = await request.get(result.data!.$type)
    expect(typeResponse.status()).toBe(200)
  })

  test('$id URL should return the same resource', async ({ apiClient, request }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.$id).toBeDefined()

    // Fetching the $id URL should return equivalent data
    const idResponse = await request.get(result.data!.$id)
    expect(idResponse.status()).toBe(200)

    const idBody = await idResponse.json()
    expect(idBody.$id).toBe(result.data!.$id)
  })

  test('item $id should be self-referential (clicking it returns same item)', async ({ apiClient, request }) => {
    const collResult = await apiClient.get<CollectionResponse<{ $id: string }>>('/customers')

    if (collResult.ok && collResult.data?.items?.length > 0) {
      const firstItem = collResult.data.items[0]
      expect(firstItem.$id).toBeDefined()
      expect(firstItem.$id).toMatch(ITEM_URL_PATTERN)

      // Fetch the item by its $id
      const itemResponse = await request.get(firstItem.$id)
      expect(itemResponse.status()).toBe(200)

      const itemBody = await itemResponse.json()
      expect(itemBody.$id).toBe(firstItem.$id)
    } else {
      // If no items, ensure collection at least returns proper shape
      expect(collResult.ok).toBe(true)
      expect(collResult.data!.items).toEqual([])
    }
  })
})

test.describe('Clickable API - Cross-Resource Navigation', () => {
  test('should be able to navigate from root to customers to item and back', async ({ apiClient, request }) => {
    // Step 1: Get root
    const rootResult = await apiClient.get<RootResponse>('/')
    expect(rootResult.ok).toBe(true)
    expect(rootResult.data!.links).toBeDefined()

    // Step 2: Navigate to customers via link (if available) or direct path
    const customersUrl = rootResult.data!.links?.customers || '/customers'
    const customersResponse = await request.get(customersUrl)
    expect(customersResponse.status()).toBe(200)

    const customersBody = (await customersResponse.json()) as CollectionResponse<ItemResponse>
    expect(customersBody.links).toBeDefined()
    expect(customersBody.links.home).toBeDefined()

    // Step 3: Navigate back to home
    const homeResponse = await request.get(customersBody.links.home!)
    expect(homeResponse.status()).toBe(200)
  })

  test('links should form a navigable graph (no broken links)', async ({ apiClient, request }) => {
    const result = await apiClient.get<CollectionResponse>('/customers')

    expect(result.ok).toBe(true)
    expect(result.data!.links).toBeDefined()

    // Check all links are clickable
    const links = result.data!.links
    const linkEntries = Object.entries(links).filter(([, url]) => url !== undefined)

    for (const [linkName, url] of linkEntries) {
      const response = await request.get(url!)
      expect(response.status(), `Link '${linkName}' (${url}) should be clickable`).toBe(200)
    }
  })
})
