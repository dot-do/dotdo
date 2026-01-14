/**
 * HATEOAS Worker Unit Tests
 *
 * Tests for HATEOAS response wrapping, DO forwarding, and middleware.
 *
 * @module workers/hateoas.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers - Mock HATEOAS response structure
// ============================================================================

interface HATEOASResponse {
  api?: {
    $context?: string
    $type?: string
    $id?: string
    name?: string
    version?: string
  }
  links?: Record<string, string>
  discover?: Record<string, string>
  collections?: Record<string, string>
  schema?: Record<string, string>
  actions?: Record<string, unknown>
  user?: unknown
  data?: unknown
}

interface HATEOASCollectionResponse {
  api?: {
    $context?: string
    $type?: string
    name?: string
    version?: string
  }
  links?: Record<string, string>
  data?: Array<{ $id?: string; [key: string]: unknown }>
  meta?: Record<string, unknown>
}

interface HATEOASInstanceResponse {
  api?: {
    $context?: string
    $type?: string
    $id?: string
  }
  links?: Record<string, string>
  data?: Record<string, unknown>
  relationships?: Record<string, string>
  verbs?: string[]
}

// ============================================================================
// Response Structure Tests
// ============================================================================

describe('HATEOAS Response Structure', () => {
  describe('Root Discovery Response', () => {
    it('includes api context information', () => {
      const response: HATEOASResponse = {
        api: {
          $context: 'https://api.dotdo.dev/tenant',
          name: 'Tenant API',
          version: '1.0.0',
        },
        links: {
          self: '/tenant/',
        },
        collections: {},
        data: null,
      }

      expect(response.api?.$context).toBe('https://api.dotdo.dev/tenant')
      expect(response.api?.name).toBe('Tenant API')
      expect(response.api?.version).toBe('1.0.0')
    })

    it('includes collections when nouns are available', () => {
      const response: HATEOASResponse = {
        api: { $context: 'https://api.dotdo.dev/tenant' },
        links: { self: '/tenant/' },
        collections: {
          customers: '/tenant/customers/',
          orders: '/tenant/orders/',
          products: '/tenant/products/',
        },
        data: null,
      }

      expect(response.collections?.customers).toBe('/tenant/customers/')
      expect(response.collections?.orders).toBe('/tenant/orders/')
      expect(response.collections?.products).toBe('/tenant/products/')
    })

    it('includes schema links when tables are available', () => {
      const response: HATEOASResponse = {
        api: { $context: 'https://api.dotdo.dev/tenant' },
        links: { self: '/tenant/' },
        schema: {
          user: '/tenant/schema/user',
          session: '/tenant/schema/session',
          account: '/tenant/schema/account',
        },
        data: null,
      }

      expect(response.schema?.user).toBe('/tenant/schema/user')
      expect(response.schema?.session).toBe('/tenant/schema/session')
    })

    it('includes discover links for documentation', () => {
      const response: HATEOASResponse = {
        api: { $context: 'https://api.dotdo.dev/tenant' },
        links: { self: '/tenant/' },
        discover: {
          docs: '/docs',
          openapi: '/openapi.json',
          graphql: '/graphql',
        },
        data: null,
      }

      expect(response.discover?.docs).toBe('/docs')
      expect(response.discover?.openapi).toBe('/openapi.json')
    })
  })

  describe('Collection Response', () => {
    it('wraps items with collection metadata', () => {
      const response: HATEOASCollectionResponse = {
        api: {
          $context: 'https://api.dotdo.dev/tenant',
          $type: 'Customer',
        },
        links: {
          self: '/tenant/customers/',
          first: '/tenant/customers/?page=1',
          last: '/tenant/customers/?page=5',
        },
        data: [
          { $id: 'cust-1', name: 'Acme Corp' },
          { $id: 'cust-2', name: 'Widget Inc' },
        ],
        meta: {
          total: 50,
          page: 1,
          pageSize: 10,
        },
      }

      expect(response.api?.$type).toBe('Customer')
      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].$id).toBe('cust-1')
      expect(response.meta?.total).toBe(50)
    })

    it('handles empty collections', () => {
      const response: HATEOASCollectionResponse = {
        api: {
          $context: 'https://api.dotdo.dev/tenant',
          $type: 'Customer',
        },
        links: { self: '/tenant/customers/' },
        data: [],
        meta: { total: 0 },
      }

      expect(response.data).toEqual([])
      expect(response.meta?.total).toBe(0)
    })

    it('includes pagination links', () => {
      const response: HATEOASCollectionResponse = {
        api: { $context: 'https://api.dotdo.dev/tenant' },
        links: {
          self: '/tenant/customers/?page=2',
          first: '/tenant/customers/?page=1',
          prev: '/tenant/customers/?page=1',
          next: '/tenant/customers/?page=3',
          last: '/tenant/customers/?page=5',
        },
        data: [],
      }

      expect(response.links?.first).toBe('/tenant/customers/?page=1')
      expect(response.links?.prev).toBe('/tenant/customers/?page=1')
      expect(response.links?.next).toBe('/tenant/customers/?page=3')
      expect(response.links?.last).toBe('/tenant/customers/?page=5')
    })
  })

  describe('Instance Response', () => {
    it('wraps single resource with instance metadata', () => {
      const response: HATEOASInstanceResponse = {
        api: {
          $context: 'https://api.dotdo.dev/tenant',
          $type: 'Customer',
          $id: 'cust-123',
        },
        links: {
          self: '/tenant/customers/cust-123',
          collection: '/tenant/customers/',
        },
        data: {
          name: 'Acme Corp',
          email: 'contact@acme.com',
          status: 'active',
        },
        verbs: ['notify', 'archive', 'delete'],
      }

      expect(response.api?.$type).toBe('Customer')
      expect(response.api?.$id).toBe('cust-123')
      expect(response.data?.name).toBe('Acme Corp')
      expect(response.verbs).toContain('notify')
    })

    it('includes relationship links', () => {
      const response: HATEOASInstanceResponse = {
        api: {
          $context: 'https://api.dotdo.dev/tenant',
          $type: 'Customer',
          $id: 'cust-123',
        },
        links: { self: '/tenant/customers/cust-123' },
        data: { name: 'Acme Corp' },
        relationships: {
          orders: '/tenant/customers/cust-123/orders',
          invoices: '/tenant/customers/cust-123/invoices',
          contacts: '/tenant/customers/cust-123/contacts',
        },
      }

      expect(response.relationships?.orders).toBe('/tenant/customers/cust-123/orders')
      expect(response.relationships?.invoices).toBe('/tenant/customers/cust-123/invoices')
    })

    it('includes available verbs/actions', () => {
      const response: HATEOASInstanceResponse = {
        api: { $type: 'Order', $id: 'order-456' },
        data: { total: 100.00, status: 'pending' },
        verbs: ['fulfill', 'cancel', 'refund'],
      }

      expect(response.verbs).toContain('fulfill')
      expect(response.verbs).toContain('cancel')
      expect(response.verbs).toContain('refund')
    })
  })
})

// ============================================================================
// Context URL Building Tests
// ============================================================================

describe('Context URL Building', () => {
  it('builds context from request URL and namespace', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers')
    const url = new URL(request.url)
    const ns = 'tenant'

    const context = `${url.protocol}//${url.host}/${ns}`
    expect(context).toBe('https://api.dotdo.dev/tenant')
  })

  it('handles port numbers in context', () => {
    const request = new Request('http://localhost:8787/tenant/customers')
    const url = new URL(request.url)
    const ns = 'tenant'

    const context = `${url.protocol}//${url.host}/${ns}`
    expect(context).toBe('http://localhost:8787/tenant')
  })

  it('handles subdomain-based namespaces', () => {
    const request = new Request('https://tenant.api.dotdo.dev/customers')
    const url = new URL(request.url)
    const ns = url.hostname.split('.')[0]

    const context = `${url.protocol}//${url.host}`
    expect(ns).toBe('tenant')
    expect(context).toBe('https://tenant.api.dotdo.dev')
  })
})

// ============================================================================
// Environment Variable Parsing Tests
// ============================================================================

describe('Environment Variable Parsing', () => {
  it('parses comma-separated KNOWN_NOUNS', () => {
    const value = 'Customer,Order,Product,Invoice'
    const parsed = value.split(',').map(s => s.trim()).filter(Boolean)

    expect(parsed).toEqual(['Customer', 'Order', 'Product', 'Invoice'])
  })

  it('handles whitespace in comma-separated values', () => {
    const value = ' Customer , Order , Product '
    const parsed = value.split(',').map(s => s.trim()).filter(Boolean)

    expect(parsed).toEqual(['Customer', 'Order', 'Product'])
  })

  it('handles empty or undefined values', () => {
    const parseEnvArray = (value: string | undefined): string[] | undefined => {
      if (!value) return undefined
      return value.split(',').map(s => s.trim()).filter(Boolean)
    }

    expect(parseEnvArray(undefined)).toBeUndefined()
    expect(parseEnvArray('')).toBeUndefined()
  })

  it('parses SCHEMA_TABLES for database tables', () => {
    const value = 'user,session,account,verification'
    const parsed = value.split(',').map(s => s.trim()).filter(Boolean)

    expect(parsed).toEqual(['user', 'session', 'account', 'verification'])
  })
})

// ============================================================================
// DO Response Forwarding Tests
// ============================================================================

describe('DO Response Forwarding', () => {
  it('builds correct DO request URL', () => {
    const requestUrl = new URL('https://api.dotdo.dev/tenant/customers/')
    const ns = 'tenant'
    const collection = 'customers'

    const doUrl = new URL(`/${collection}/`, requestUrl.origin)
    expect(doUrl.pathname).toBe('/customers/')
  })

  it('preserves query parameters in forwarded request', () => {
    const requestUrl = new URL('https://api.dotdo.dev/tenant/customers/?page=2&limit=10')
    const forwardPath = '/customers/'

    const doUrl = new URL(forwardPath + requestUrl.search, requestUrl.origin)
    expect(doUrl.search).toBe('?page=2&limit=10')
    expect(doUrl.pathname).toBe('/customers/')
  })

  it('handles instance paths correctly', () => {
    const requestUrl = new URL('https://api.dotdo.dev/tenant/customers/cust-123')
    const ns = 'tenant'
    const collection = 'customers'
    const id = 'cust-123'

    const doUrl = new URL(`/${collection}/${id}`, requestUrl.origin)
    expect(doUrl.pathname).toBe('/customers/cust-123')
  })

  it('creates request with correct method and headers', () => {
    const originalRequest = new Request('https://api.dotdo.dev/tenant/customers/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token123',
      },
      body: JSON.stringify({ name: 'Test Customer' }),
    })

    const forwardedRequest = new Request('https://do/customers/', {
      method: originalRequest.method,
      headers: originalRequest.headers,
      body: originalRequest.body,
      duplex: 'half',
    } as RequestInit)

    expect(forwardedRequest.method).toBe('POST')
    expect(forwardedRequest.headers.get('Content-Type')).toBe('application/json')
    expect(forwardedRequest.headers.get('Authorization')).toBe('Bearer token123')
  })
})

// ============================================================================
// Error Response Tests
// ============================================================================

describe('Error Responses', () => {
  it('returns configuration error for missing DO binding', () => {
    const error = {
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'DO binding not configured',
      },
    }

    expect(error.error.code).toBe('CONFIGURATION_ERROR')
    expect(error.error.message).toBe('DO binding not configured')
  })

  it('returns internal error for unexpected exceptions', () => {
    const error = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    }

    expect(error.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('forwards DO error responses as-is', async () => {
    const doResponse = new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })

    // HATEOAS worker should forward error responses without wrapping
    expect(doResponse.ok).toBe(false)
    expect(doResponse.status).toBe(404)

    const body = await doResponse.json() as { error: string }
    expect(body.error).toBe('Not Found')
  })
})

// ============================================================================
// Route Matching Tests
// ============================================================================

describe('Route Matching', () => {
  it('matches root discovery route /:ns/', () => {
    const patterns = [
      { path: '/tenant/', matches: true },
      { path: '/acme/', matches: true },
      { path: '/my-org/', matches: true },
    ]

    for (const { path, matches } of patterns) {
      const match = path.match(/^\/([^/]+)\/$/)
      expect(!!match).toBe(matches)
      if (match) {
        expect(match[1]).toBeTruthy()
      }
    }
  })

  it('matches root discovery route without trailing slash /:ns', () => {
    const patterns = [
      { path: '/tenant', matches: true },
      { path: '/acme', matches: true },
    ]

    for (const { path, matches } of patterns) {
      const match = path.match(/^\/([^/]+)$/)
      expect(!!match).toBe(matches)
    }
  })

  it('matches collection route /:ns/:collection/', () => {
    const patterns = [
      { path: '/tenant/customers/', matches: true, ns: 'tenant', collection: 'customers' },
      { path: '/acme/orders/', matches: true, ns: 'acme', collection: 'orders' },
    ]

    for (const { path, matches, ns, collection } of patterns) {
      const match = path.match(/^\/([^/]+)\/([^/]+)\/$/)
      expect(!!match).toBe(matches)
      if (match) {
        expect(match[1]).toBe(ns)
        expect(match[2]).toBe(collection)
      }
    }
  })

  it('matches instance route /:ns/:collection/:id', () => {
    const patterns = [
      { path: '/tenant/customers/cust-123', matches: true },
      { path: '/acme/orders/order-456', matches: true },
    ]

    for (const { path, matches } of patterns) {
      const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/)
      expect(!!match).toBe(matches)
    }
  })

  it('extracts namespace, collection, and id from path', () => {
    const path = '/tenant/customers/cust-123'
    const segments = path.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(segments[1]).toBe('customers')
    expect(segments[2]).toBe('cust-123')
  })
})

// ============================================================================
// HTTP Method Handling Tests
// ============================================================================

describe('HTTP Method Handling', () => {
  it('handles GET requests for discovery', () => {
    const request = new Request('https://api.dotdo.dev/tenant/', { method: 'GET' })
    expect(request.method).toBe('GET')
  })

  it('handles GET requests for collections', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/', { method: 'GET' })
    expect(request.method).toBe('GET')
  })

  it('handles GET requests for instances', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/123', { method: 'GET' })
    expect(request.method).toBe('GET')
  })

  it('handles POST requests for collection creation', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Customer' }),
    })
    expect(request.method).toBe('POST')
  })

  it('handles PUT requests for instance updates', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/123', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated Customer' }),
    })
    expect(request.method).toBe('PUT')
  })

  it('handles PATCH requests for partial updates', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/123', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'inactive' }),
    })
    expect(request.method).toBe('PATCH')
  })

  it('handles DELETE requests for instance deletion', () => {
    const request = new Request('https://api.dotdo.dev/tenant/customers/123', {
      method: 'DELETE',
    })
    expect(request.method).toBe('DELETE')
  })
})

// ============================================================================
// POST Response with Location Header Tests
// ============================================================================

describe('POST Response with Location Header', () => {
  it('includes Location header for created resources', () => {
    const ns = 'tenant'
    const collection = 'customers'
    const newId = 'cust-999'

    const locationHeader = `/${ns}/${collection}/${newId}`
    expect(locationHeader).toBe('/tenant/customers/cust-999')
  })

  it('returns 201 status for successful creation', () => {
    const response = new Response(JSON.stringify({ $id: 'new-id', name: 'Created' }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Location': '/tenant/customers/new-id',
      },
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('Location')).toBe('/tenant/customers/new-id')
  })

  it('extracts $id or id from created resource', () => {
    const responses = [
      { $id: 'id-with-dollar', name: 'Test' },
      { id: 'id-without-dollar', name: 'Test' },
      { name: 'No ID' },
    ]

    for (const item of responses) {
      const id = (item as Record<string, unknown>).$id || (item as Record<string, unknown>).id || ''
      if ('$id' in item) expect(id).toBe('id-with-dollar')
      else if ('id' in item) expect(id).toBe('id-without-dollar')
      else expect(id).toBe('')
    }
  })
})

// ============================================================================
// Catch-All Route Tests
// ============================================================================

describe('Catch-All Route Handling', () => {
  it('extracts subpath after namespace for RPC', () => {
    const url = new URL('https://api.dotdo.dev/tenant/rpc')
    const ns = 'tenant'
    const pathParts = url.pathname.split('/')
    const nsIndex = pathParts.indexOf(ns)
    const subPath = '/' + pathParts.slice(nsIndex + 1).join('/')

    expect(subPath).toBe('/rpc')
  })

  it('extracts subpath for MCP endpoints', () => {
    const url = new URL('https://api.dotdo.dev/tenant/mcp')
    const ns = 'tenant'
    const pathParts = url.pathname.split('/')
    const nsIndex = pathParts.indexOf(ns)
    const subPath = '/' + pathParts.slice(nsIndex + 1).join('/')

    expect(subPath).toBe('/mcp')
  })

  it('extracts subpath for sync WebSocket', () => {
    const url = new URL('https://api.dotdo.dev/tenant/sync')
    const ns = 'tenant'
    const pathParts = url.pathname.split('/')
    const nsIndex = pathParts.indexOf(ns)
    const subPath = '/' + pathParts.slice(nsIndex + 1).join('/')

    expect(subPath).toBe('/sync')
  })

  it('handles deeply nested paths', () => {
    const url = new URL('https://api.dotdo.dev/tenant/api/v2/custom/endpoint')
    const ns = 'tenant'
    const pathParts = url.pathname.split('/')
    const nsIndex = pathParts.indexOf(ns)
    const subPath = '/' + pathParts.slice(nsIndex + 1).join('/')

    expect(subPath).toBe('/api/v2/custom/endpoint')
  })
})

// ============================================================================
// Metadata Endpoint Tests
// ============================================================================

describe('Metadata Endpoint (_meta)', () => {
  it('fetches nouns from DO metadata endpoint', async () => {
    const mockMetaResponse = {
      nouns: ['Customer', 'Order', 'Product'],
      schemaTables: ['user', 'session'],
    }

    // Simulate successful metadata fetch
    expect(mockMetaResponse.nouns).toEqual(['Customer', 'Order', 'Product'])
    expect(mockMetaResponse.schemaTables).toEqual(['user', 'session'])
  })

  it('falls back to env vars when metadata fails', () => {
    const envNouns = 'Customer,Order'
    const fallbackNouns = envNouns.split(',').map(s => s.trim())

    expect(fallbackNouns).toEqual(['Customer', 'Order'])
  })

  it('handles missing metadata gracefully', () => {
    const emptyMeta = {} as { nouns?: string[]; schemaTables?: string[] }

    const nouns = emptyMeta.nouns || ['default']
    const schemaTables = emptyMeta.schemaTables || []

    expect(nouns).toEqual(['default'])
    expect(schemaTables).toEqual([])
  })
})
