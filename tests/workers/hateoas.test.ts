/**
 * HATEOAS Worker Tests
 *
 * Tests for the standalone HATEOAS worker that wraps DO responses
 * with navigation links and discoverable endpoints.
 *
 * @module tests/workers/hateoas
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../../workers/hateoas'

// ============================================================================
// Mock Types
// ============================================================================

interface MockDOStub {
  fetch: ReturnType<typeof vi.fn>
}

interface MockDONamespace {
  idFromName: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

// ============================================================================
// Mock Factory
// ============================================================================

function createMockEnv(options?: {
  doResponses?: Record<string, Response | (() => Response | Promise<Response>)>
  nouns?: string[]
  schemaTables?: string[]
  apiName?: string
  apiVersion?: string
  noDO?: boolean
}) {
  const mockStub: MockDOStub = {
    fetch: vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname

      // Check for custom response (exact match first, then prefix match)
      if (options?.doResponses) {
        // First check exact matches
        if (options.doResponses[path]) {
          const response = options.doResponses[path]
          return typeof response === 'function' ? response() : response
        }
        // Then check prefix matches
        for (const [pattern, response] of Object.entries(options.doResponses)) {
          if (path.startsWith(pattern) && pattern !== path) {
            return typeof response === 'function' ? response() : response
          }
        }
      }

      // Default responses based on path
      if (path === '/_meta') {
        return new Response(JSON.stringify({
          nouns: options?.nouns || ['things', 'users'],
          schemaTables: options?.schemaTables,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Collection listing (with or without trailing slash)
      const pathParts = path.split('/').filter(Boolean)
      if (pathParts.length === 1) {
        // Collection listing
        return new Response(JSON.stringify([
          { $id: 'item-1', name: 'Item 1' },
          { $id: 'item-2', name: 'Item 2' },
        ]), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (pathParts.length === 2) {
        // Instance detail
        const id = pathParts[1]
        return new Response(JSON.stringify({
          $id: id,
          name: `Item ${id}`,
          data: { key: 'value' },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }

  const mockNamespace: MockDONamespace = {
    idFromName: vi.fn((name: string) => ({ name, toString: () => name })),
    get: vi.fn(() => mockStub),
  }

  return {
    DO: options?.noDO ? undefined : mockNamespace,
    KNOWN_NOUNS: options?.nouns?.join(','),
    SCHEMA_TABLES: options?.schemaTables?.join(','),
    API_NAME: options?.apiName,
    API_VERSION: options?.apiVersion,
    _mockStub: mockStub,
    _mockNamespace: mockNamespace,
  }
}

// ============================================================================
// Root Discovery Tests
// ============================================================================

describe('HATEOAS Worker - Root Discovery', () => {
  it('should return root discovery response for GET /{ns}/', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api).toBeDefined()
    expect(body.api.$context).toBe('https://api.example.com.ai/myns')
    expect(body.links).toBeDefined()
    expect(body.links.self).toBe('/')
    expect(body.links.home).toBe('/')
    expect(body.discover).toBeDefined()
    expect(body.actions).toBeDefined()
    expect(body.data).toBeNull()
  })

  it('should return root discovery response for GET /{ns} (without trailing slash)', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api.$context).toBe('https://api.example.com.ai/myns')
  })

  it('should include API name and version from env', async () => {
    const env = createMockEnv({
      apiName: 'My API',
      apiVersion: '2.0.0',
    })
    const request = new Request('https://api.example.com.ai/myns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.api.name).toBe('My API')
    expect(body.api.version).toBe('2.0.0')
  })

  it('should include collections from DO metadata', async () => {
    const env = createMockEnv({
      nouns: ['products', 'orders', 'customers'],
    })
    const request = new Request('https://api.example.com.ai/shop/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.collections).toBeDefined()
    expect(body.collections.products).toBe('/products/')
    expect(body.collections.orders).toBe('/orders/')
    expect(body.collections.customers).toBe('/customers/')
  })

  it('should include schema tables when available', async () => {
    const env = createMockEnv({
      schemaTables: ['users', 'sessions', 'accounts'],
    })
    const request = new Request('https://api.example.com.ai/auth/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.schema).toBeDefined()
    expect(body.schema.users).toBe('/users/')
    expect(body.schema.sessions).toBe('/sessions/')
  })

  it('should include built-in discover endpoints', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/ns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.discover).toBeDefined()
    expect(body.discover.things).toBe('/things/')
    expect(body.discover.actions).toBe('/actions/')
    expect(body.discover.events).toBe('/events/')
    expect(body.discover.workflows).toBe('/workflows/')
    expect(body.discover.agents).toBe('/agents/')
  })

  it('should include standard actions in root response', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/ns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.actions).toBeDefined()
    expect(body.actions.rpc).toEqual({ method: 'POST', href: '/rpc' })
    expect(body.actions.mcp).toEqual({ method: 'POST', href: '/mcp' })
    expect(body.actions.sync).toEqual({ method: 'GET', href: '/sync', protocol: 'websocket' })
  })
})

// ============================================================================
// Collection Listing Tests
// ============================================================================

describe('HATEOAS Worker - Collection Listing', () => {
  it('should return collection response for GET /{ns}/{collection}/', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api).toBeDefined()
    expect(body.api.$context).toBe('https://api.example.com.ai/myns')
    expect(body.api.$type).toBe('things')
    expect(body.links.self).toBe('/things/')
    expect(body.links.home).toBe('/')
    expect(body.data).toBeInstanceOf(Array)
  })

  it('should return collection response without trailing slash', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api.$type).toBe('things')
  })

  it('should include discover section with item links', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.discover).toBeDefined()
    expect(body.discover['item-1']).toBe('/things/item-1')
    expect(body.discover['item-2']).toBe('/things/item-2')
  })

  it('should include collection actions', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.actions).toBeDefined()
    expect(body.actions.create).toEqual({
      method: 'POST',
      href: './',
      fields: ['name', 'data'],
    })
    expect(body.actions.search).toEqual({
      method: 'GET',
      href: './?q={query}',
      templated: true,
    })
  })

  it('should include verbs when returned by DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/': new Response(JSON.stringify({
          items: [{ $id: 'item-1' }],
          verbs: ['activate', 'archive', 'duplicate'],
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.verbs).toEqual(['activate', 'archive', 'duplicate'])
  })

  it('should forward query parameters to DO', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/?limit=10&cursor=abc')

    await app.fetch(request, env as any)

    expect(env._mockStub.fetch).toHaveBeenCalled()
    const doRequest = env._mockStub.fetch.mock.calls[0][0] as Request
    const url = new URL(doRequest.url)
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('cursor')).toBe('abc')
  })

  it('should forward DO error responses', async () => {
    const env = createMockEnv({
      doResponses: {
        '/private/': new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/private/')

    const response = await app.fetch(request, env as any)

    expect(response.status).toBe(403)
  })
})

// ============================================================================
// Instance Detail Tests
// ============================================================================

describe('HATEOAS Worker - Instance Details', () => {
  it('should return instance response for GET /{ns}/{collection}/{id}', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/item-123')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api).toBeDefined()
    expect(body.api.$context).toBe('https://api.example.com.ai/myns')
    expect(body.api.$type).toBe('things')
    expect(body.api.$id).toBe('item-123')
    expect(body.links.self).toBe('/things/item-123')
    expect(body.links.collection).toBe('/things/')
    expect(body.links.home).toBe('/')
  })

  it('should include instance actions', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/things/item-123')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.actions).toBeDefined()
    expect(body.actions.update).toEqual({ method: 'PUT', href: './' })
    expect(body.actions.delete).toEqual({ method: 'DELETE', href: './' })
  })

  it('should include verb actions when returned by DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/item-123': new Response(JSON.stringify({
          $id: 'item-123',
          name: 'Test',
          verbs: ['approve', 'reject', 'archive'],
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/item-123')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.actions.approve).toEqual({ method: 'POST', href: './approve' })
    expect(body.actions.reject).toEqual({ method: 'POST', href: './reject' })
    expect(body.actions.archive).toEqual({ method: 'POST', href: './archive' })
  })

  it('should include relationships when returned by DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/orders/order-1': new Response(JSON.stringify({
          $id: 'order-1',
          customerId: 'cust-1',
          relationships: {
            customer: '/customers/cust-1',
            items: '/orders/order-1/items',
            payments: '/payments/?orderId=order-1',
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/orders/order-1')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.relationships).toBeDefined()
    expect(body.relationships.customer).toBe('/customers/cust-1')
    expect(body.relationships.items).toBe('/orders/order-1/items')
  })

  it('should forward 404 responses from DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/nonexistent': new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/nonexistent')

    const response = await app.fetch(request, env as any)

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// Mutation Tests (POST, PUT, PATCH, DELETE)
// ============================================================================

describe('HATEOAS Worker - Mutations', () => {
  it('should wrap POST response with instance links and return 201', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/': new Response(JSON.stringify({
          $id: 'new-item-1',
          name: 'New Item',
        }), {
          status: 200, // DO returns 200, worker should make it 201
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Item' }),
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(response.headers.get('Location')).toBe('/myns/things/new-item-1')
    expect(body.api.$id).toBe('new-item-1')
    expect(body.links.self).toBe('/things/new-item-1')
  })

  it('should wrap PUT response with instance links', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/item-1': new Response(JSON.stringify({
          $id: 'item-1',
          name: 'Updated Item',
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/item-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Item' }),
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api.$id).toBe('item-1')
    expect(body.actions.update).toBeDefined()
  })

  it('should wrap PATCH response with instance links', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/item-1': new Response(JSON.stringify({
          $id: 'item-1',
          name: 'Patched Item',
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Patched Item' }),
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.api.$id).toBe('item-1')
  })

  it('should pass through DELETE response', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/item-1': new Response(null, { status: 204 }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/item-1', {
      method: 'DELETE',
    })

    const response = await app.fetch(request, env as any)

    expect(response.status).toBe(204)
  })

  it('should forward POST errors from DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/': new Response(JSON.stringify({
          error: { code: 'CONFLICT', message: 'Item already exists' },
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate' }),
    })

    const response = await app.fetch(request, env as any)

    expect(response.status).toBe(409)
  })
})

// ============================================================================
// Passthrough Tests
// ============================================================================

describe('HATEOAS Worker - Passthrough Routes', () => {
  it('should forward RPC requests to DO (POST to collection wraps with HATEOAS)', async () => {
    // Note: POST /{ns}/rpc matches /:ns/:collection pattern, so it gets HATEOAS wrapper
    // This is actually correct behavior - rpc acts as a "collection" that returns results
    const env = createMockEnv({
      doResponses: {
        '/rpc': new Response(JSON.stringify({ result: 'success', $id: 'rpc-result-1' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'doSomething', params: [] }),
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    // POST to a collection returns 201 with HATEOAS wrapper
    expect(response.status).toBe(201)
    expect(body.data.result).toBe('success')
  })

  it('should forward MCP requests to DO (POST to collection wraps with HATEOAS)', async () => {
    // Note: POST /{ns}/mcp matches /:ns/:collection pattern
    const env = createMockEnv({
      doResponses: {
        '/mcp': new Response(JSON.stringify({ tools: [], $id: 'mcp-result-1' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
    })

    const response = await app.fetch(request, env as any)

    // POST to a collection returns 201 with HATEOAS wrapper
    expect(response.status).toBe(201)
  })

  it('should forward nested paths to DO', async () => {
    const env = createMockEnv({
      doResponses: {
        '/things/item-1/attachments': new Response(JSON.stringify([
          { id: 'att-1', name: 'file.pdf' },
        ]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    })
    const request = new Request('https://api.example.com.ai/myns/things/item-1/attachments')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([{ id: 'att-1', name: 'file.pdf' }])
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('HATEOAS Worker - Error Handling', () => {
  it('should return 500 when DO binding is missing', async () => {
    const env = createMockEnv({ noDO: true })
    const request = new Request('https://api.example.com.ai/myns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe('CONFIGURATION_ERROR')
  })

  it('should handle DO fetch errors gracefully', async () => {
    const env = createMockEnv()
    env._mockStub.fetch = vi.fn(() => {
      throw new Error('Network error')
    })
    const request = new Request('https://api.example.com.ai/myns/things/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBeDefined()
  })
})

// ============================================================================
// User Context Tests
// ============================================================================

describe('HATEOAS Worker - User Context', () => {
  it('should include user context in response', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/', {
      headers: {
        'CF-Connecting-IP': '192.168.1.1',
      },
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.user).toBeDefined()
    expect(body.user.authenticated).toBe(false)
    expect(body.user.ip).toBe('192.168.1.1')
  })

  it('should detect authenticated requests', async () => {
    const env = createMockEnv()
    const request = new Request('https://api.example.com.ai/myns/', {
      headers: {
        Authorization: 'Bearer token123',
      },
    })

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.user.authenticated).toBe(true)
  })
})

// ============================================================================
// Context URL Tests
// ============================================================================

describe('HATEOAS Worker - Context URL Building', () => {
  it('should build correct $context for different hosts', async () => {
    const env = createMockEnv()

    const request1 = new Request('https://api.example.com.ai/tenant1/')
    const response1 = await app.fetch(request1, env as any)
    const body1 = await response1.json()
    expect(body1.api.$context).toBe('https://api.example.com.ai/tenant1')

    const request2 = new Request('https://localhost:8787/dev/')
    const response2 = await app.fetch(request2, env as any)
    const body2 = await response2.json()
    expect(body2.api.$context).toBe('https://localhost:8787/dev')
  })

  it('should handle HTTP protocol', async () => {
    const env = createMockEnv()
    const request = new Request('http://localhost:8787/myns/')

    const response = await app.fetch(request, env as any)
    const body = await response.json()

    expect(body.api.$context).toBe('http://localhost:8787/myns')
  })
})
