/**
 * Simple JSON Worker Tests
 *
 * These tests verify the simple.ts worker that returns plain JSON
 * responses without HATEOAS envelope. Just data with $type and $id.
 *
 * Simple JSON Format:
 *
 * Collection Response:
 * [
 *   { "$type": "Startup", "$id": "headless.ly", "name": "Headless.ly", "stage": "seed" },
 *   { "$type": "Startup", "$id": "agents.do", "name": "Agents.do", "stage": "growth" }
 * ]
 *
 * Single Resource Response:
 * {
 *   "$type": "Startup",
 *   "$id": "headless.ly",
 *   "name": "Headless.ly",
 *   "stage": "seed",
 *   "founded": "2024-01-01"
 * }
 *
 * No `api`, `links`, `discover`, `actions` envelope. Just the data.
 *
 * Related issues:
 * - dotdo-zebir: Simple JSON worker RED tests
 * - dotdo-z16pr: Simple JSON worker GREEN implementation
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let createSimpleHandler: ((config?: SimpleConfig) => SimpleHandler) | undefined
let stripEnvelope: ((response: unknown) => unknown) | undefined

interface SimpleConfig {
  /** Routing mode (defaults to 'path') */
  mode?: 'hostname' | 'path' | 'fixed'
  /** Root domain for hostname mode */
  rootDomain?: string
  /** Fixed namespace for fixed mode */
  namespace?: string
  /** Base path to strip */
  basepath?: string
  /** Default namespace fallback */
  defaultNs?: string
}

interface SimpleHandler {
  (request: Request, env: unknown): Promise<Response>
}

// Try to import - will be undefined until implemented
try {
  const module = await import('../../workers/simple')
  createSimpleHandler = module.createSimpleHandler
  stripEnvelope = module.stripEnvelope
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  createSimpleHandler = undefined
  stripEnvelope = undefined
}

// ============================================================================
// 1. Module Export Tests
// ============================================================================

describe('Simple Worker Module Exports', () => {
  it('exports createSimpleHandler function', () => {
    expect(createSimpleHandler).toBeDefined()
    expect(typeof createSimpleHandler).toBe('function')
  })

  it('exports stripEnvelope function', () => {
    expect(stripEnvelope).toBeDefined()
    expect(typeof stripEnvelope).toBe('function')
  })
})

// ============================================================================
// 2. stripEnvelope Function Tests
// ============================================================================

describe('stripEnvelope', () => {
  describe('HATEOAS response stripping', () => {
    it('extracts data from full HATEOAS envelope', () => {
      const hateoasResponse = {
        api: {
          $context: 'https://startups.studio',
          $type: 'Startup',
          $id: 'headless.ly',
        },
        links: {
          self: '/Startup/headless.ly',
          collection: '/Startup/',
          home: '/',
        },
        actions: {
          update: { method: 'PUT', href: './' },
          delete: { method: 'DELETE', href: './' },
        },
        data: {
          name: 'Headless.ly',
          stage: 'seed',
          founded: '2024-01-01',
        },
      }

      const result = stripEnvelope!(hateoasResponse)

      expect(result).toEqual({
        $type: 'Startup',
        $id: 'headless.ly',
        name: 'Headless.ly',
        stage: 'seed',
        founded: '2024-01-01',
      })
    })

    it('extracts data array from collection HATEOAS envelope', () => {
      const hateoasResponse = {
        api: {
          $context: 'https://startups.studio',
          $type: 'Startup',
        },
        links: {
          self: '/Startup/',
          home: '/',
        },
        discover: {
          'headless.ly': '/Startup/headless.ly',
          'agents.do': '/Startup/agents.do',
        },
        actions: {
          create: { method: 'POST', href: './' },
        },
        data: [
          { $id: 'headless.ly', name: 'Headless.ly', stage: 'seed' },
          { $id: 'agents.do', name: 'Agents.do', stage: 'growth' },
        ],
      }

      const result = stripEnvelope!(hateoasResponse) as Array<Record<string, unknown>>

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        $type: 'Startup',
        $id: 'headless.ly',
        name: 'Headless.ly',
        stage: 'seed',
      })
      expect(result[1]).toEqual({
        $type: 'Startup',
        $id: 'agents.do',
        name: 'Agents.do',
        stage: 'growth',
      })
    })

    it('removes api section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', name: 'test' },
        links: {},
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.api).toBeUndefined()
    })

    it('removes links section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: { self: '/', home: '/' },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.links).toBeUndefined()
    })

    it('removes discover section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        discover: { things: '/things/', events: '/events/' },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.discover).toBeUndefined()
    })

    it('removes actions section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        actions: { create: { method: 'POST', href: './' } },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.actions).toBeUndefined()
    })

    it('removes collections section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        collections: { Startup: '/Startup/' },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.collections).toBeUndefined()
    })

    it('removes schema section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        schema: { users: '/users/' },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.schema).toBeUndefined()
    })

    it('removes relationships section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Startup', $id: 'test' },
        links: {},
        relationships: { founders: '/Startup/test/founders/' },
        data: { name: 'Test' },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.relationships).toBeUndefined()
    })

    it('removes verbs section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Startup' },
        links: {},
        verbs: ['pitch', 'fund', 'launch'],
        data: { name: 'Test' },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.verbs).toBeUndefined()
    })

    it('removes user section', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        user: { authenticated: true, id: 'user-123' },
        data: { value: 123 },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.user).toBeUndefined()
    })
  })

  describe('$type and $id injection', () => {
    it('injects $type from api.$type for single object', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Customer' },
        links: {},
        data: { name: 'Alice', email: 'alice@test.com' },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.$type).toBe('Customer')
    })

    it('injects $id from api.$id for single object', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Customer', $id: 'cust-123' },
        links: {},
        data: { name: 'Alice', email: 'alice@test.com' },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result.$id).toBe('cust-123')
    })

    it('injects $type into each array item for collection', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Order' },
        links: {},
        data: [
          { $id: 'ord-1', total: 100 },
          { $id: 'ord-2', total: 250 },
        ],
      }

      const result = stripEnvelope!(hateoasResponse) as Array<Record<string, unknown>>

      expect(result[0].$type).toBe('Order')
      expect(result[1].$type).toBe('Order')
    })

    it('preserves existing $id in array items', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Order' },
        links: {},
        data: [
          { $id: 'ord-1', total: 100 },
          { $id: 'ord-2', total: 250 },
        ],
      }

      const result = stripEnvelope!(hateoasResponse) as Array<Record<string, unknown>>

      expect(result[0].$id).toBe('ord-1')
      expect(result[1].$id).toBe('ord-2')
    })

    it('does not override existing $type in data', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'GenericThing' },
        links: {},
        data: { $type: 'SpecificThing', $id: 'thing-1', name: 'Test' },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      // Data's $type should take precedence
      expect(result.$type).toBe('SpecificThing')
    })
  })

  describe('non-HATEOAS response passthrough', () => {
    it('returns plain object unchanged', () => {
      const plainResponse = {
        name: 'Headless.ly',
        stage: 'seed',
      }

      const result = stripEnvelope!(plainResponse)

      expect(result).toEqual(plainResponse)
    })

    it('returns plain array unchanged', () => {
      const plainResponse = [
        { name: 'Item 1' },
        { name: 'Item 2' },
      ]

      const result = stripEnvelope!(plainResponse)

      expect(result).toEqual(plainResponse)
    })

    it('returns primitive values unchanged', () => {
      expect(stripEnvelope!('hello')).toBe('hello')
      expect(stripEnvelope!(123)).toBe(123)
      expect(stripEnvelope!(true)).toBe(true)
      expect(stripEnvelope!(null)).toBe(null)
    })

    it('returns undefined unchanged', () => {
      expect(stripEnvelope!(undefined)).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles empty data object', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Empty' },
        links: {},
        data: {},
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result).toEqual({ $type: 'Empty' })
    })

    it('handles empty data array', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Empty' },
        links: {},
        data: [],
      }

      const result = stripEnvelope!(hateoasResponse)

      expect(result).toEqual([])
    })

    it('handles null data', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do' },
        links: {},
        data: null,
      }

      const result = stripEnvelope!(hateoasResponse)

      expect(result).toBeNull()
    })

    it('handles nested objects in data', () => {
      const hateoasResponse = {
        api: { $context: 'https://test.do', $type: 'Startup', $id: 'test' },
        links: {},
        data: {
          name: 'Test',
          metrics: {
            mrr: 50000,
            customers: 100,
          },
          founders: [
            { name: 'Alice', role: 'CEO' },
            { name: 'Bob', role: 'CTO' },
          ],
        },
      }

      const result = stripEnvelope!(hateoasResponse) as Record<string, unknown>

      expect(result).toEqual({
        $type: 'Startup',
        $id: 'test',
        name: 'Test',
        metrics: {
          mrr: 50000,
          customers: 100,
        },
        founders: [
          { name: 'Alice', role: 'CEO' },
          { name: 'Bob', role: 'CTO' },
        ],
      })
    })
  })
})

// ============================================================================
// 3. GET /{ns}/{collection}/ Tests
// ============================================================================

describe('GET /{ns}/{collection}/', () => {
  it('returns plain array of items', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv([
      { $id: 'headless.ly', name: 'Headless.ly', stage: 'seed' },
      { $id: 'agents.do', name: 'Agents.do', stage: 'growth' },
    ])

    const request = new Request('https://api.dotdo.dev/startups/Startup/')
    const response = await handler(request, mockEnv)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('items have $type and $id', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv([
      { $id: 'headless.ly', name: 'Headless.ly', stage: 'seed' },
    ])

    const request = new Request('https://api.dotdo.dev/startups/Startup/')
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Array<Record<string, unknown>>

    expect(data[0].$type).toBe('Startup')
    expect(data[0].$id).toBe('headless.ly')
  })

  it('no envelope, links, or actions', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv([
      { $id: 'test', name: 'Test' },
    ])

    const request = new Request('https://api.dotdo.dev/startups/Startup/')
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    // Should not have HATEOAS envelope properties
    expect(data.api).toBeUndefined()
    expect(data.links).toBeUndefined()
    expect(data.discover).toBeUndefined()
    expect(data.actions).toBeUndefined()
    expect(data.data).toBeUndefined() // data should be at root, not wrapped
  })

  it('returns Content-Type: application/json', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv([])

    const request = new Request('https://api.dotdo.dev/startups/Startup/')
    const response = await handler(request, mockEnv)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })
})

// ============================================================================
// 4. GET /{ns}/{collection}/{id} Tests
// ============================================================================

describe('GET /{ns}/{collection}/{id}', () => {
  it('returns plain object', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Headless.ly',
      stage: 'seed',
      founded: '2024-01-01',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly')
    const response = await handler(request, mockEnv)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(typeof data).toBe('object')
    expect(Array.isArray(data)).toBe(false)
  })

  it('includes $type and $id', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Headless.ly',
      stage: 'seed',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly')
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    expect(data.$type).toBe('Startup')
    expect(data.$id).toBe('headless.ly')
  })

  it('no envelope', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Test',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/test')
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    // Should not have HATEOAS envelope properties
    expect(data.api).toBeUndefined()
    expect(data.links).toBeUndefined()
    expect(data.actions).toBeUndefined()
    expect(data.relationships).toBeUndefined()
    expect(data.data).toBeUndefined()
  })

  it('preserves all data fields', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Headless.ly',
      stage: 'seed',
      founded: '2024-01-01',
      metrics: { mrr: 50000, customers: 100 },
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly')
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    expect(data.name).toBe('Headless.ly')
    expect(data.stage).toBe('seed')
    expect(data.founded).toBe('2024-01-01')
    expect(data.metrics).toEqual({ mrr: 50000, customers: 100 })
  })
})

// ============================================================================
// 5. Mutation Tests
// ============================================================================

describe('mutations', () => {
  it('POST returns created item with $type and $id', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      $id: 'new-startup',
      name: 'New Startup',
      stage: 'ideation',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Startup', stage: 'ideation' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(data.$type).toBe('Startup')
    expect(data.$id).toBe('new-startup')
    expect(data.name).toBe('New Startup')
  })

  it('PUT returns updated item', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Updated Startup',
      stage: 'growth',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly', {
      method: 'PUT',
      body: JSON.stringify({ stage: 'growth' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(data.$type).toBe('Startup')
    expect(data.$id).toBe('headless.ly')
    expect(data.stage).toBe('growth')
  })

  it('PATCH returns updated item', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({
      name: 'Headless.ly',
      stage: 'growth',
    })

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly', {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'growth' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await handler(request, mockEnv)
    const data = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(data.$type).toBe('Startup')
    expect(data.$id).toBe('headless.ly')
  })

  it('DELETE returns 204 with no content', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnvForDelete()

    const request = new Request('https://api.dotdo.dev/startups/Startup/headless.ly', {
      method: 'DELETE',
    })
    const response = await handler(request, mockEnv)

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })
})

// ============================================================================
// 6. Error Response Tests
// ============================================================================

describe('error responses', () => {
  it('returns 404 with simple error object', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnvFor404()

    const request = new Request('https://api.dotdo.dev/startups/Startup/nonexistent')
    const response = await handler(request, mockEnv)

    expect(response.status).toBe(404)
    const data = (await response.json()) as Record<string, unknown>
    expect(data.error).toBeDefined()
    // Should not have HATEOAS envelope
    expect(data.api).toBeUndefined()
    expect(data.links).toBeUndefined()
  })

  it('returns 500 with simple error object', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnvFor500()

    const request = new Request('https://api.dotdo.dev/startups/Startup/')
    const response = await handler(request, mockEnv)

    expect(response.status).toBe(500)
    const data = (await response.json()) as Record<string, unknown>
    expect(data.error).toBeDefined()
  })
})

// ============================================================================
// 7. Routing Mode Tests
// ============================================================================

describe('routing modes', () => {
  it('path mode extracts namespace from first path segment', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({ name: 'Test' })

    const request = new Request('https://api.dotdo.dev/my-namespace/Startup/')
    const response = await handler(request, mockEnv)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
  })

  it('hostname mode extracts namespace from subdomain', async () => {
    const handler = createSimpleHandler!({
      mode: 'hostname',
      rootDomain: 'api.dotdo.dev',
    })
    const mockEnv = createMockEnv({ name: 'Test' })

    const request = new Request('https://my-namespace.api.dotdo.dev/Startup/')
    const response = await handler(request, mockEnv)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
  })

  it('fixed mode routes to configured namespace', async () => {
    const handler = createSimpleHandler!({
      mode: 'fixed',
      namespace: 'main-app',
    })
    const mockEnv = createMockEnv({ name: 'Test' })

    const request = new Request('https://anything.example.com/Startup/')
    const response = await handler(request, mockEnv)

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 8. Content-Type Tests
// ============================================================================

describe('content-type handling', () => {
  it('always returns application/json', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({ name: 'Test' })

    const request = new Request('https://api.dotdo.dev/ns/Startup/')
    const response = await handler(request, mockEnv)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('does not add charset for simple responses', async () => {
    const handler = createSimpleHandler!({ mode: 'path' })
    const mockEnv = createMockEnv({ name: 'Test' })

    const request = new Request('https://api.dotdo.dev/ns/Startup/')
    const response = await handler(request, mockEnv)

    // Should be simple: application/json, not application/json; charset=utf-8
    const contentType = response.headers.get('Content-Type')
    expect(contentType).toBe('application/json')
  })
})

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Creates a mock env that returns HATEOAS response which gets stripped
 */
function createMockEnv(mockData: unknown): Record<string, unknown> {
  const isArray = Array.isArray(mockData)

  return {
    DO: {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => ({
        fetch: async (req: Request) => {
          const url = new URL(req.url)
          const pathParts = url.pathname.split('/').filter(Boolean)
          const collection = pathParts[0] || 'Thing'
          const id = pathParts[1]

          // Simulate HATEOAS response from DO
          const hateoasResponse = {
            api: {
              $context: url.origin,
              $type: collection,
              ...(id && { $id: id }),
            },
            links: {
              self: url.pathname,
              home: '/',
            },
            ...(isArray ? { discover: {} } : {}),
            actions: {},
            data: mockData,
          }

          return new Response(JSON.stringify(hateoasResponse), {
            status: req.method === 'POST' ? 201 : 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      }),
    },
  }
}

/**
 * Creates mock env for DELETE that returns 204
 */
function createMockEnvForDelete(): Record<string, unknown> {
  return {
    DO: {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => ({
        fetch: async () => {
          return new Response(null, { status: 204 })
        },
      }),
    },
  }
}

/**
 * Creates mock env for 404 responses
 */
function createMockEnvFor404(): Record<string, unknown> {
  return {
    DO: {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => ({
        fetch: async () => {
          return new Response(
            JSON.stringify({
              api: { $context: 'https://test.do' },
              links: {},
              error: 'Not found',
              data: null,
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        },
      }),
    },
  }
}

/**
 * Creates mock env for 500 responses
 */
function createMockEnvFor500(): Record<string, unknown> {
  return {
    DO: {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => ({
        fetch: async () => {
          return new Response(
            JSON.stringify({
              api: { $context: 'https://test.do' },
              links: {},
              error: 'Internal server error',
              data: null,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        },
      }),
    },
  }
}
