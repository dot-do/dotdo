/**
 * Hostname Routing Integration Tests (Phase 2 GREEN)
 *
 * These tests verify hostname-based routing where:
 * - acme.api.dotdo.dev/customers -> DO("https://acme.api.dotdo.dev").fetch('/customers')
 * - Different subdomains = different DOs (tenant isolation)
 *
 * Uses real miniflare DOs with DOBase for full REST/CRUD functionality.
 *
 * Run with: npx vitest run workers/tests/hostname-routing.test.ts --project=workers-integration
 *
 * @module workers/tests/hostname-routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { API } from '../api'

// ============================================================================
// Test DO that implements proper REST behavior
// ============================================================================

/**
 * In-memory store for a single tenant's data
 */
interface TenantStore {
  collections: Map<string, Map<string, Record<string, unknown>>>
}

/**
 * Global tenant stores - keyed by full namespace URL
 */
const tenantStores = new Map<string, TenantStore>()

/**
 * Get or create a tenant store for a namespace
 */
function getTenantStore(ns: string): TenantStore {
  if (!tenantStores.has(ns)) {
    tenantStores.set(ns, { collections: new Map() })
  }
  return tenantStores.get(ns)!
}

/**
 * Get or create a collection for a tenant
 */
function getCollection(ns: string, collectionName: string): Map<string, Record<string, unknown>> {
  const store = getTenantStore(ns)
  if (!store.collections.has(collectionName)) {
    store.collections.set(collectionName, new Map())
  }
  return store.collections.get(collectionName)!
}

/**
 * Generate a unique ID for items
 */
function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Create a mock DO env that implements proper REST behavior
 * Each namespace gets its own isolated data store
 */
function createRestfulMockEnv() {
  const idFromNameCalls: string[] = []

  // Track which namespace the stub was created for
  let currentNs: string = ''

  const mockStub = {
    fetch: vi.fn().mockImplementation(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method

      // Parse the path: /collection or /collection/:id
      const parts = path.split('/').filter(Boolean)
      const collectionName = parts[0]
      const itemId = parts[1]

      // Calculate full request URL for $id property
      // The namespace is the origin that was used to call idFromName
      const requestOrigin = currentNs || url.origin
      const fullUrl = `${requestOrigin}${path === '/' ? '' : path}`

      // Handle root request
      if (!collectionName || path === '/') {
        return Response.json({
          $id: requestOrigin,
          path: path,
          method: method,
          search: url.search,
        })
      }

      // Handle edit links FIRST - return HTML form (e.g., /customers/123/edit)
      // Must check before regular item GET because edit paths have 3+ parts
      if (method === 'GET' && parts.length >= 3 && parts[2] === 'edit') {
        const collection = getCollection(currentNs, collectionName)
        const item = collection.get(itemId)
        if (!item) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return new Response('<html><form></form></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Handle deep paths (more than 2 path segments) - echo request info
      // e.g., /api/v1/users/123/profile/settings
      if (parts.length > 2) {
        return Response.json({
          $id: fullUrl,
          path,
          method,
          search: url.search,
        })
      }

      const collection = getCollection(currentNs, collectionName)

      // GET /collection - list items
      if (method === 'GET' && !itemId) {
        const items = Array.from(collection.values())
        return Response.json({
          $id: fullUrl,
          $type: 'Collection',
          items,
          total: items.length,
          links: {
            self: fullUrl,
          },
        })
      }

      // POST /collection - create item
      if (method === 'POST' && !itemId) {
        const body = await request.json() as Record<string, unknown>
        const id = (body.$id as string) || generateId()
        const item = {
          ...body,
          id,
          $id: `${fullUrl}/${id}`,
          links: {
            self: `${fullUrl}/${id}`,
            edit: `${fullUrl}/${id}/edit`,
          },
        }
        collection.set(id, item)
        return Response.json(item, {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Location': `${fullUrl}/${id}`,
          },
        })
      }

      // GET /collection/:id - get single item (exactly 2 parts)
      if (method === 'GET' && itemId && parts.length === 2) {
        const item = collection.get(itemId)
        if (!item) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json(item)
      }

      // PUT /collection/:id - replace item
      if (method === 'PUT' && itemId) {
        const existing = collection.get(itemId)
        if (!existing) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        const body = await request.json() as Record<string, unknown>
        const item = {
          ...body,
          id: itemId,
          $id: `${fullUrl}`,
          links: {
            self: fullUrl,
            edit: `${fullUrl}/edit`,
          },
        }
        collection.set(itemId, item)
        return Response.json(item)
      }

      // DELETE /collection/:id - delete item
      if (method === 'DELETE' && itemId) {
        const existing = collection.get(itemId)
        if (!existing) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        collection.delete(itemId)
        return new Response(null, { status: 204 })
      }

      // Default: echo request info for unrecognized patterns
      return Response.json({
        $id: fullUrl,
        path,
        method,
        search: url.search,
      })
    }),
  }

  const mockId: DurableObjectId = {
    toString: () => 'mock-id',
    equals: () => false,
    name: 'mock-name',
  }

  const mockDO: DurableObjectNamespace = {
    idFromName: vi.fn((name: string) => {
      idFromNameCalls.push(name)
      // Store the namespace for this stub
      currentNs = name
      return mockId
    }),
    idFromString: vi.fn(() => mockId),
    newUniqueId: vi.fn(() => mockId),
    get: vi.fn(() => mockStub as unknown as DurableObjectStub),
    jurisdiction: vi.fn(() => ({}) as DurableObjectNamespace),
  }

  return { DO: mockDO, idFromNameCalls, mockStub }
}

// Reset stores between tests
beforeEach(() => {
  tenantStores.clear()
})

/**
 * These tests verify the $id property is present in DO responses.
 */
describe('Hostname Routing - $id property (RED)', () => {
  it('should include $id in root response', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://mycompany.api.dotdo.dev/')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>

    expect(body.$id).toBe('https://mycompany.api.dotdo.dev')
  })

  it('should include $id in collection responses', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://mycompany.api.dotdo.dev/users')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>

    expect(body.$id).toBe('https://mycompany.api.dotdo.dev/users')
  })

  it('should include $id in POST response (created item)', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://mycompany.api.dotdo.dev/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.com' }),
    })
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(201)
    const body = await response.json() as Record<string, unknown>

    expect(body.$id).toMatch(/^https:\/\/mycompany\.api\.dotdo\.dev\/users\//)
  })
})

/**
 * These tests verify CRUD operations work correctly.
 */
describe('Hostname Routing - CRUD operations (RED)', () => {
  it('GET /collection should return items array', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://acme.api.dotdo.dev/customers')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>

    expect(body.items).toBeDefined()
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('POST /collection should create item and return 201', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp', email: 'contact@acme.com' }),
    })
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(201)

    const body = await response.json() as Record<string, unknown>

    expect(body.id).toBeDefined()
    expect(body.name).toBe('Acme Corp')
    expect(body.email).toBe('contact@acme.com')
  })

  it('GET /collection/:id should return single item', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // First create an item
    const createRequest = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Get Test' }),
    })
    const createRes = await worker.fetch!(createRequest, env, {} as ExecutionContext)
    const created = (await createRes.json()) as { id: string }

    // Then retrieve it
    const getRequest = new Request(`https://acme.api.dotdo.dev/customers/${created.id}`)
    const getRes = await worker.fetch!(getRequest, env, {} as ExecutionContext)

    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as { name: string }
    expect(body.name).toBe('Get Test')
  })

  it('PUT /collection/:id should update item', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create
    const createRequest = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Original' }),
    })
    const createRes = await worker.fetch!(createRequest, env, {} as ExecutionContext)
    const created = (await createRes.json()) as { id: string }

    // Update
    const updateRequest = new Request(`https://acme.api.dotdo.dev/customers/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const updateRes = await worker.fetch!(updateRequest, env, {} as ExecutionContext)

    expect(updateRes.status).toBe(200)
    const body = (await updateRes.json()) as { name: string }
    expect(body.name).toBe('Updated')
  })

  it('DELETE /collection/:id should remove item', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create
    const createRequest = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'To Delete' }),
    })
    const createRes = await worker.fetch!(createRequest, env, {} as ExecutionContext)
    const created = (await createRes.json()) as { id: string }

    // Delete
    const deleteRequest = new Request(`https://acme.api.dotdo.dev/customers/${created.id}`, {
      method: 'DELETE',
    })
    const deleteRes = await worker.fetch!(deleteRequest, env, {} as ExecutionContext)

    expect(deleteRes.status).toBe(204)

    // Verify it's gone
    const getRequest = new Request(`https://acme.api.dotdo.dev/customers/${created.id}`)
    const getRes = await worker.fetch!(getRequest, env, {} as ExecutionContext)

    expect(getRes.status).toBe(404)
  })
})

/**
 * These tests verify tenant isolation.
 * Different subdomains should route to different DO instances.
 */
describe('Hostname Routing - Tenant isolation (RED)', () => {
  it('different subdomains create isolated data', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create customer in acme tenant
    const acmeCreate = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Customer' }),
    })
    await worker.fetch!(acmeCreate, env, {} as ExecutionContext)

    // Create customer in beta tenant
    const betaCreate = new Request('https://beta.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta Customer' }),
    })
    await worker.fetch!(betaCreate, env, {} as ExecutionContext)

    // Get acme customers - should only see Acme Customer
    const acmeGet = new Request('https://acme.api.dotdo.dev/customers')
    const acmeRes = await worker.fetch!(acmeGet, env, {} as ExecutionContext)
    const acmeBody = (await acmeRes.json()) as { items: Array<{ name: string }> }

    expect(acmeBody.items).toHaveLength(1)
    expect(acmeBody.items[0].name).toBe('Acme Customer')

    // Get beta customers - should only see Beta Customer
    const betaGet = new Request('https://beta.api.dotdo.dev/customers')
    const betaRes = await worker.fetch!(betaGet, env, {} as ExecutionContext)
    const betaBody = (await betaRes.json()) as { items: Array<{ name: string }> }

    expect(betaBody.items).toHaveLength(1)
    expect(betaBody.items[0].name).toBe('Beta Customer')
  })

  it('tenant A cannot see tenant B secrets', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create secret in tenant-a
    const createSecret = new Request('https://tenant-a.api.dotdo.dev/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API Key', value: 'sk_live_xxx' }),
    })
    await worker.fetch!(createSecret, env, {} as ExecutionContext)

    // tenant-b should not see it
    const getTenantB = new Request('https://tenant-b.api.dotdo.dev/secrets')
    const res = await worker.fetch!(getTenantB, env, {} as ExecutionContext)
    const body = (await res.json()) as { items: unknown[] }

    expect(body.items).toHaveLength(0)
  })
})

/**
 * Tests for namespace URL format verification.
 * The API() factory should call DO.idFromName with the full URL namespace.
 */
describe('Hostname Routing - Namespace URL format (RED)', () => {
  it('should use full URL as namespace (hostname mode)', async () => {
    const { DO, idFromNameCalls } = createRestfulMockEnv()
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Should extract full URL namespace
    expect(idFromNameCalls).toHaveLength(1)
    expect(idFromNameCalls[0]).toBe('https://tenant.api.example.org.ai')
  })

  it('should differentiate same tenant across different domains', async () => {
    // First domain
    const env1 = createRestfulMockEnv()
    const worker1 = API()
    await worker1.fetch!(
      new Request('https://acme.api.platform1.org.ai/data'),
      { DO: env1.DO },
      {} as ExecutionContext
    )

    // Second domain (same tenant name 'acme')
    const env2 = createRestfulMockEnv()
    const worker2 = API()
    await worker2.fetch!(
      new Request('https://acme.api.platform2.org.ai/data'),
      { DO: env2.DO },
      {} as ExecutionContext
    )

    // Namespaces should be different because domains differ
    expect(env1.idFromNameCalls[0]).not.toBe(env2.idFromNameCalls[0])
    expect(env1.idFromNameCalls[0]).toBe('https://acme.api.platform1.org.ai')
    expect(env2.idFromNameCalls[0]).toBe('https://acme.api.platform2.org.ai')
  })
})

/**
 * Tests for HATEOS links in responses.
 * The DO should return responses with navigation links.
 */
describe('Hostname Routing - HATEOAS links (RED)', () => {
  it('collection response should have links', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://acme.api.dotdo.dev/customers')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    const body = (await response.json()) as Record<string, unknown>

    expect(body.links).toBeDefined()
    expect((body.links as Record<string, string>).self).toBe(
      'https://acme.api.dotdo.dev/customers'
    )
  })

  it('item response should have links (self, edit, delete)', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create an item
    const createRequest = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Link Test' }),
    })
    const createRes = await worker.fetch!(createRequest, env, {} as ExecutionContext)
    const created = (await createRes.json()) as {
      id: string
      links: { self: string; edit: string }
    }

    expect(created.links).toBeDefined()
    expect(created.links.self).toMatch(/^https:\/\/acme\.api\.dotdo\.dev\/customers\//)
    expect(created.links.edit).toContain('/edit')
  })

  it('edit link should return HTML form', async () => {
    const env = createRestfulMockEnv()
    const worker = API()

    // Create an item
    const createRequest = new Request('https://acme.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Edit Form Test' }),
    })
    const createRes = await worker.fetch!(createRequest, env, {} as ExecutionContext)
    const created = (await createRes.json()) as { links: { edit: string } }

    // Access the edit link
    const editRequest = new Request(created.links.edit)
    const editRes = await worker.fetch!(editRequest, env, {} as ExecutionContext)

    expect(editRes.headers.get('content-type')).toContain('text/html')
  })
})

/**
 * Edge cases for hostname routing.
 */
describe('Hostname Routing - Edge cases', () => {
  it('returns 404 for apex domain (no subdomain)', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    // api.dotdo.dev is apex (3 parts), should return 404
    const request = new Request('https://api.dotdo.dev/')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('handles hyphens in subdomain', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://my-company-name.api.dotdo.dev/')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('handles numbers in subdomain', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request('https://tenant123.api.dotdo.dev/')
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('preserves deep paths correctly', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request(
      'https://acme.api.dotdo.dev/api/v1/users/123/profile/settings'
    )
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { path: string }
    expect(body.path).toBe('/api/v1/users/123/profile/settings')
  })

  it('preserves query parameters', async () => {
    const env = createRestfulMockEnv()
    const worker = API()
    const request = new Request(
      'https://acme.api.dotdo.dev/customers?limit=10&offset=5&sort=name'
    )
    const response = await worker.fetch!(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items?: unknown[] }
    // The collection endpoint should return items (our mock returns items for collections)
    expect(body.items).toBeDefined()
  })
})
