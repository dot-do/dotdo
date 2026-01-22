/**
 * E2E SDK Generation and Usage Tests
 *
 * Tests SDK generation and usage with REAL DO instances:
 * 1. SDK client generation from resource definitions
 * 2. Full CRUD operations through SDK interface
 * 3. Type-safe API calls
 * 4. Batch operations
 * 5. Pagination and filtering
 * 6. SDK error handling
 *
 * NO MOCKS - uses real Miniflare instances to test true integration.
 *
 * @module e2e/tests/sdk-generation-e2e.test
 * @see do-oojf
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  name?: string
  description?: string
  data?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

interface Relationship {
  $id: string
  subject: string
  predicate: string
  object: string
  createdAt: number
}

interface Event {
  $id: string
  type: string
  payload?: Record<string, unknown>
  source?: string
  timestamp: number
}

interface ListResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

interface HATEOASLink {
  href: string
  method?: string
  title?: string
}

interface RootResponse {
  name: string
  version: string
  _links: Record<string, HATEOASLink>
  resources: string[]
}

// ============================================================================
// SDK DO SCRIPT - Comprehensive API for SDK Testing
// ============================================================================

const SDK_DO_SCRIPT = `
// ============================================================================
// UTILITIES
// ============================================================================

function generateId(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

// ============================================================================
// SDK DO CLASS
// ============================================================================

export class SDKDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // Build base URL for HATEOAS links
    const baseUrl = url.origin

    // ========================================================================
    // ROOT / DISCOVERY
    // ========================================================================

    if (path === '/' || path === '') {
      return this.handleRoot(baseUrl)
    }

    if (path === '/health') {
      return Response.json({
        status: 'ok',
        id: this.state.id.toString(),
        timestamp: Date.now()
      })
    }

    // OpenAPI spec endpoint
    if (path === '/openapi.json' || path === '/api/openapi') {
      return this.handleOpenApiSpec(baseUrl)
    }

    // Types endpoint for SDK generation
    if (path === '/types' || path === '/_types') {
      return this.handleTypes()
    }

    // Schema endpoint
    if (path === '/schema' || path === '/_schema') {
      return this.handleSchema()
    }

    // ========================================================================
    // THINGS CRUD
    // ========================================================================

    if (path === '/things') {
      if (method === 'GET') return this.listThings(url)
      if (method === 'POST') return this.createThing(request)
    }

    const thingMatch = path.match(/^\\/things\\/([^/]+)$/)
    if (thingMatch) {
      const id = thingMatch[1]
      if (method === 'GET') return this.getThing(id)
      if (method === 'PUT') return this.updateThing(id, request)
      if (method === 'PATCH') return this.patchThing(id, request)
      if (method === 'DELETE') return this.deleteThing(id)
    }

    // Batch operations
    if (path === '/things/batch' && method === 'POST') {
      return this.batchThings(request)
    }

    // ========================================================================
    // RELATIONSHIPS
    // ========================================================================

    if (path === '/relationships') {
      if (method === 'GET') return this.listRelationships(url)
      if (method === 'POST') return this.createRelationship(request)
    }

    if (path === '/relationships/query' && method === 'POST') {
      return this.queryRelationships(request)
    }

    const relMatch = path.match(/^\\/relationships\\/([^/]+)$/)
    if (relMatch) {
      const id = relMatch[1]
      if (method === 'GET') return this.getRelationship(id)
      if (method === 'DELETE') return this.deleteRelationship(id)
    }

    // ========================================================================
    // EVENTS
    // ========================================================================

    if (path === '/events') {
      if (method === 'GET') return this.listEvents(url)
      if (method === 'POST') return this.emitEvent(request)
    }

    const eventMatch = path.match(/^\\/events\\/([^/]+)$/)
    if (eventMatch) {
      const id = eventMatch[1]
      if (method === 'GET') return this.getEvent(id)
    }

    // ========================================================================
    // RPC
    // ========================================================================

    if (path === '/rpc' && method === 'POST') {
      return this.handleRPC(request)
    }

    return Response.json({
      error: 'Not Found',
      code: 'NOT_FOUND',
      path,
      method
    }, { status: 404 })
  }

  // ========================================================================
  // ROOT / DISCOVERY HANDLERS
  // ========================================================================

  handleRoot(baseUrl) {
    return Response.json({
      name: 'dotdo-sdk-test',
      version: '1.0.0',
      description: 'SDK Test API',
      _links: {
        self: { href: baseUrl + '/', method: 'GET' },
        health: { href: baseUrl + '/health', method: 'GET' },
        openapi: { href: baseUrl + '/openapi.json', method: 'GET' },
        types: { href: baseUrl + '/types', method: 'GET' },
        schema: { href: baseUrl + '/schema', method: 'GET' },
        things: { href: baseUrl + '/things', method: 'GET', title: 'List Things' },
        relationships: { href: baseUrl + '/relationships', method: 'GET', title: 'List Relationships' },
        events: { href: baseUrl + '/events', method: 'GET', title: 'List Events' }
      },
      resources: ['things', 'relationships', 'events']
    })
  }

  handleOpenApiSpec(baseUrl) {
    return Response.json({
      openapi: '3.0.0',
      info: {
        title: 'dotdo SDK Test API',
        version: '1.0.0'
      },
      servers: [{ url: baseUrl }],
      paths: {
        '/things': {
          get: {
            summary: 'List things',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
              { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
              { name: '$type', in: 'query', schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'List of things' } }
          },
          post: {
            summary: 'Create a thing',
            requestBody: {
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Thing' }
                }
              }
            },
            responses: { '201': { description: 'Created thing' } }
          }
        },
        '/things/{id}': {
          get: {
            summary: 'Get a thing',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Thing details' } }
          },
          put: { summary: 'Update a thing' },
          patch: { summary: 'Patch a thing' },
          delete: { summary: 'Delete a thing' }
        }
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            required: ['$type'],
            properties: {
              $id: { type: 'string' },
              $type: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              data: { type: 'object' }
            }
          }
        }
      }
    })
  }

  handleTypes() {
    return Response.json({
      types: \`
interface Thing {
  $id: string
  $type: string
  name?: string
  description?: string
  data?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

interface Relationship {
  $id: string
  subject: string
  predicate: string
  object: string
  createdAt: number
}

interface Event {
  $id: string
  type: string
  payload?: Record<string, unknown>
  source?: string
  timestamp: number
}

interface SDK {
  things: {
    list(options?: { limit?: number; offset?: number; $type?: string }): Promise<ListResponse<Thing>>
    get(id: string): Promise<Thing>
    create(data: Omit<Thing, '$id' | 'createdAt' | 'updatedAt'>): Promise<Thing>
    update(id: string, data: Partial<Thing>): Promise<Thing>
    delete(id: string): Promise<void>
    batch(operations: BatchOperation[]): Promise<BatchResult>
  }
  relationships: {
    list(): Promise<ListResponse<Relationship>>
    get(id: string): Promise<Relationship>
    create(data: { subject: string; predicate: string; object: string }): Promise<Relationship>
    delete(id: string): Promise<void>
    query(params: { subject?: string; predicate?: string; object?: string }): Promise<Relationship[]>
  }
  events: {
    list(options?: { limit?: number; type?: string }): Promise<ListResponse<Event>>
    get(id: string): Promise<Event>
    emit(data: { type: string; payload?: unknown; source?: string }): Promise<Event>
  }
}
\`
    })
  }

  handleSchema() {
    return Response.json({
      resources: {
        things: {
          fields: {
            $id: { type: 'string', readOnly: true },
            $type: { type: 'string', required: true },
            name: { type: 'string' },
            description: { type: 'string' },
            data: { type: 'object' },
            createdAt: { type: 'number', readOnly: true },
            updatedAt: { type: 'number', readOnly: true }
          },
          operations: ['list', 'get', 'create', 'update', 'patch', 'delete', 'batch']
        },
        relationships: {
          fields: {
            $id: { type: 'string', readOnly: true },
            subject: { type: 'string', required: true },
            predicate: { type: 'string', required: true },
            object: { type: 'string', required: true },
            createdAt: { type: 'number', readOnly: true }
          },
          operations: ['list', 'get', 'create', 'delete', 'query']
        },
        events: {
          fields: {
            $id: { type: 'string', readOnly: true },
            type: { type: 'string', required: true },
            payload: { type: 'object' },
            source: { type: 'string' },
            timestamp: { type: 'number', readOnly: true }
          },
          operations: ['list', 'get', 'emit']
        }
      }
    })
  }

  // ========================================================================
  // THINGS HANDLERS
  // ========================================================================

  async listThings(url) {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const typeFilter = url.searchParams.get('$type')

    const index = await this.storage.get('thing-index') || []
    let things = []

    for (const id of index) {
      const thing = await this.storage.get('thing:' + id)
      if (thing) {
        if (!typeFilter || thing.$type === typeFilter) {
          things.push(thing)
        }
      }
    }

    // Sort by createdAt descending
    things.sort((a, b) => b.createdAt - a.createdAt)

    const total = things.length
    const paginated = things.slice(offset, offset + limit)

    return Response.json({
      data: paginated,
      total,
      limit,
      offset,
      hasMore: offset + paginated.length < total
    })
  }

  async getThing(id) {
    const thing = await this.storage.get('thing:' + id)

    if (!thing) {
      return Response.json({
        error: 'Thing not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    return Response.json(thing)
  }

  async createThing(request) {
    try {
      const data = await request.json()

      if (!data.$type) {
        return Response.json({
          error: 'Missing required field: $type',
          code: 'VALIDATION_ERROR',
          field: '$type'
        }, { status: 400 })
      }

      const id = generateId('thing')
      const now = Date.now()

      const thing = {
        $id: id,
        $type: data.$type,
        name: data.name,
        description: data.description,
        data: data.data,
        createdAt: now,
        updatedAt: now
      }

      await this.storage.put('thing:' + id, thing)

      const index = await this.storage.get('thing-index') || []
      index.push(id)
      await this.storage.put('thing-index', index)

      return Response.json(thing, { status: 201 })
    } catch (error) {
      return Response.json({
        error: 'Invalid request body',
        code: 'PARSE_ERROR'
      }, { status: 400 })
    }
  }

  async updateThing(id, request) {
    const existing = await this.storage.get('thing:' + id)

    if (!existing) {
      return Response.json({
        error: 'Thing not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    const data = await request.json()
    const updated = {
      ...existing,
      ...data,
      $id: id, // Preserve ID
      createdAt: existing.createdAt, // Preserve createdAt
      updatedAt: Date.now()
    }

    await this.storage.put('thing:' + id, updated)
    return Response.json(updated)
  }

  async patchThing(id, request) {
    const existing = await this.storage.get('thing:' + id)

    if (!existing) {
      return Response.json({
        error: 'Thing not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    const patch = await request.json()
    const patched = {
      ...existing,
      ...patch,
      $id: id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    }

    await this.storage.put('thing:' + id, patched)
    return Response.json(patched)
  }

  async deleteThing(id) {
    const existing = await this.storage.get('thing:' + id)

    if (!existing) {
      return Response.json({
        error: 'Thing not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    await this.storage.delete('thing:' + id)

    const index = await this.storage.get('thing-index') || []
    const newIndex = index.filter(i => i !== id)
    await this.storage.put('thing-index', newIndex)

    return new Response(null, { status: 204 })
  }

  async batchThings(request) {
    const { operations } = await request.json()
    const results = []

    for (const op of operations) {
      try {
        if (op.operation === 'create') {
          const id = generateId('thing')
          const now = Date.now()
          const thing = {
            $id: id,
            ...op.data,
            createdAt: now,
            updatedAt: now
          }
          await this.storage.put('thing:' + id, thing)
          const index = await this.storage.get('thing-index') || []
          index.push(id)
          await this.storage.put('thing-index', index)
          results.push({ success: true, result: thing })
        } else if (op.operation === 'update') {
          const existing = await this.storage.get('thing:' + op.id)
          if (!existing) {
            results.push({ success: false, error: 'Not found', id: op.id })
          } else {
            const updated = { ...existing, ...op.data, updatedAt: Date.now() }
            await this.storage.put('thing:' + op.id, updated)
            results.push({ success: true, result: updated })
          }
        } else if (op.operation === 'delete') {
          await this.storage.delete('thing:' + op.id)
          const index = await this.storage.get('thing-index') || []
          const newIndex = index.filter(i => i !== op.id)
          await this.storage.put('thing-index', newIndex)
          results.push({ success: true, id: op.id })
        }
      } catch (error) {
        results.push({ success: false, error: error.message })
      }
    }

    return Response.json({
      results,
      total: operations.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    })
  }

  // ========================================================================
  // RELATIONSHIPS HANDLERS
  // ========================================================================

  async listRelationships(url) {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    const index = await this.storage.get('relationship-index') || []
    const relationships = []

    for (const id of index) {
      const rel = await this.storage.get('relationship:' + id)
      if (rel) {
        relationships.push(rel)
      }
    }

    const total = relationships.length
    const paginated = relationships.slice(offset, offset + limit)

    return Response.json({
      data: paginated,
      total,
      limit,
      offset,
      hasMore: offset + paginated.length < total
    })
  }

  async getRelationship(id) {
    const rel = await this.storage.get('relationship:' + id)

    if (!rel) {
      return Response.json({
        error: 'Relationship not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    return Response.json(rel)
  }

  async createRelationship(request) {
    const data = await request.json()

    if (!data.subject || !data.predicate || !data.object) {
      return Response.json({
        error: 'Missing required fields: subject, predicate, object',
        code: 'VALIDATION_ERROR'
      }, { status: 400 })
    }

    const id = generateId('rel')
    const relationship = {
      $id: id,
      subject: data.subject,
      predicate: data.predicate,
      object: data.object,
      createdAt: Date.now()
    }

    await this.storage.put('relationship:' + id, relationship)

    const index = await this.storage.get('relationship-index') || []
    index.push(id)
    await this.storage.put('relationship-index', index)

    return Response.json(relationship, { status: 201 })
  }

  async deleteRelationship(id) {
    const existing = await this.storage.get('relationship:' + id)

    if (!existing) {
      return Response.json({
        error: 'Relationship not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    await this.storage.delete('relationship:' + id)

    const index = await this.storage.get('relationship-index') || []
    const newIndex = index.filter(i => i !== id)
    await this.storage.put('relationship-index', newIndex)

    return new Response(null, { status: 204 })
  }

  async queryRelationships(request) {
    const { subject, predicate, object } = await request.json()

    const index = await this.storage.get('relationship-index') || []
    const matches = []

    for (const id of index) {
      const rel = await this.storage.get('relationship:' + id)
      if (rel) {
        const matchSubject = !subject || rel.subject === subject
        const matchPredicate = !predicate || rel.predicate === predicate
        const matchObject = !object || rel.object === object

        if (matchSubject && matchPredicate && matchObject) {
          matches.push(rel)
        }
      }
    }

    return Response.json(matches)
  }

  // ========================================================================
  // EVENTS HANDLERS
  // ========================================================================

  async listEvents(url) {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const typeFilter = url.searchParams.get('type')

    const index = await this.storage.get('event-index') || []
    let events = []

    for (const id of index) {
      const event = await this.storage.get('event:' + id)
      if (event) {
        if (!typeFilter || event.type === typeFilter) {
          events.push(event)
        }
      }
    }

    // Sort by timestamp descending
    events.sort((a, b) => b.timestamp - a.timestamp)

    const total = events.length
    const paginated = events.slice(offset, offset + limit)

    return Response.json({
      data: paginated,
      total,
      limit,
      offset,
      hasMore: offset + paginated.length < total
    })
  }

  async getEvent(id) {
    const event = await this.storage.get('event:' + id)

    if (!event) {
      return Response.json({
        error: 'Event not found',
        code: 'NOT_FOUND',
        id
      }, { status: 404 })
    }

    return Response.json(event)
  }

  async emitEvent(request) {
    const data = await request.json()

    if (!data.type) {
      return Response.json({
        error: 'Missing required field: type',
        code: 'VALIDATION_ERROR',
        field: 'type'
      }, { status: 400 })
    }

    const id = generateId('event')
    const event = {
      $id: id,
      type: data.type,
      payload: data.payload,
      source: data.source,
      timestamp: Date.now()
    }

    await this.storage.put('event:' + id, event)

    const index = await this.storage.get('event-index') || []
    index.push(id)
    await this.storage.put('event-index', index)

    return Response.json(event, { status: 201 })
  }

  // ========================================================================
  // RPC
  // ========================================================================

  async handleRPC(request) {
    try {
      const { method, args } = await request.json()
      const fn = this[method]

      if (typeof fn !== 'function') {
        return Response.json({
          error: 'Method not found',
          code: 'METHOD_NOT_FOUND',
          method
        }, { status: 404 })
      }

      const result = await fn.apply(this, args || [])
      return Response.json({ result })
    } catch (error) {
      return Response.json({
        error: error.message,
        code: 'RPC_ERROR'
      }, { status: 500 })
    }
  }

  // RPC methods
  async getThingCount() {
    const index = await this.storage.get('thing-index') || []
    return index.length
  }

  async getStats() {
    const thingIndex = await this.storage.get('thing-index') || []
    const relIndex = await this.storage.get('relationship-index') || []
    const eventIndex = await this.storage.get('event-index') || []

    return {
      things: thingIndex.length,
      relationships: relIndex.length,
      events: eventIndex.length
    }
  }
}

// ============================================================================
// WORKER
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    let namespace = 'default'

    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    }

    const id = env.SDK_DO.idFromName(namespace)
    const stub = env.SDK_DO.get(id)

    return stub.fetch(request)
  }
}
`

// ============================================================================
// SDK CLIENT IMPLEMENTATION (simulates generated SDK)
// ============================================================================

function createSDKClient(mf: Miniflare, tenantId: string = 'default') {
  const baseRequest = async <T>(path: string, options: RequestInit = {}): Promise<{ status: number; data: T; headers: Headers }> => {
    const headers = new Headers(options.headers)
    headers.set('Content-Type', 'application/json')
    headers.set('X-Tenant-ID', tenantId)

    const response = await mf.dispatchFetch(`http://localhost${path}`, {
      ...options,
      headers,
    })

    if (response.status === 204) {
      return { status: response.status, data: undefined as T, headers: response.headers }
    }

    const data = await response.json() as T
    return { status: response.status, data, headers: response.headers }
  }

  return {
    // Discovery
    root: () => baseRequest<RootResponse>('/'),
    health: () => baseRequest<{ status: string }>('/health'),
    openapi: () => baseRequest<{ openapi: string }>('/openapi.json'),
    types: () => baseRequest<{ types: string }>('/types'),
    schema: () => baseRequest<{ resources: Record<string, unknown> }>('/schema'),

    // Things
    things: {
      list: (options?: { limit?: number; offset?: number; $type?: string }) => {
        const params = new URLSearchParams()
        if (options?.limit) params.set('limit', options.limit.toString())
        if (options?.offset) params.set('offset', options.offset.toString())
        if (options?.$type) params.set('$type', options.$type)
        const query = params.toString() ? `?${params}` : ''
        return baseRequest<ListResponse<Thing>>(`/things${query}`)
      },
      get: (id: string) => baseRequest<Thing | { error: string }>(`/things/${id}`),
      create: (data: { $type: string; name?: string; description?: string; data?: Record<string, unknown> }) =>
        baseRequest<Thing>('/things', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Partial<Thing>) =>
        baseRequest<Thing>(`/things/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      patch: (id: string, data: Partial<Thing>) =>
        baseRequest<Thing>(`/things/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id: string) =>
        baseRequest<void>(`/things/${id}`, { method: 'DELETE' }),
      batch: (operations: Array<{ operation: 'create' | 'update' | 'delete'; id?: string; data?: unknown }>) =>
        baseRequest<{ results: unknown[]; total: number; succeeded: number; failed: number }>(
          '/things/batch',
          { method: 'POST', body: JSON.stringify({ operations }) }
        ),
    },

    // Relationships
    relationships: {
      list: (options?: { limit?: number; offset?: number }) => {
        const params = new URLSearchParams()
        if (options?.limit) params.set('limit', options.limit.toString())
        if (options?.offset) params.set('offset', options.offset.toString())
        const query = params.toString() ? `?${params}` : ''
        return baseRequest<ListResponse<Relationship>>(`/relationships${query}`)
      },
      get: (id: string) => baseRequest<Relationship | { error: string }>(`/relationships/${id}`),
      create: (data: { subject: string; predicate: string; object: string }) =>
        baseRequest<Relationship>('/relationships', { method: 'POST', body: JSON.stringify(data) }),
      delete: (id: string) =>
        baseRequest<void>(`/relationships/${id}`, { method: 'DELETE' }),
      query: (params: { subject?: string; predicate?: string; object?: string }) =>
        baseRequest<Relationship[]>('/relationships/query', { method: 'POST', body: JSON.stringify(params) }),
    },

    // Events
    events: {
      list: (options?: { limit?: number; offset?: number; type?: string }) => {
        const params = new URLSearchParams()
        if (options?.limit) params.set('limit', options.limit.toString())
        if (options?.offset) params.set('offset', options.offset.toString())
        if (options?.type) params.set('type', options.type)
        const query = params.toString() ? `?${params}` : ''
        return baseRequest<ListResponse<Event>>(`/events${query}`)
      },
      get: (id: string) => baseRequest<Event | { error: string }>(`/events/${id}`),
      emit: (data: { type: string; payload?: unknown; source?: string }) =>
        baseRequest<Event>('/events', { method: 'POST', body: JSON.stringify(data) }),
    },

    // RPC
    rpc: <T = unknown>(method: string, args: unknown[] = []) =>
      baseRequest<{ result: T }>('/rpc', { method: 'POST', body: JSON.stringify({ method, args }) }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E SDK Generation and Usage Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: SDK_DO_SCRIPT,
      durableObjects: {
        SDK_DO: 'SDKDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. API DISCOVERY (HATEOAS)
  // ==========================================================================

  describe('API Discovery (HATEOAS)', () => {
    it('should return root resource with links', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `discovery-${testId}`)

      const result = await sdk.root()

      expect(result.status).toBe(200)
      expect(result.data.name).toBeDefined()
      expect(result.data.version).toBeDefined()
      expect(result.data._links).toBeDefined()
      expect(result.data._links.self).toBeDefined()
      expect(result.data._links.things).toBeDefined()
      expect(result.data.resources).toContain('things')
    })

    it('should return OpenAPI spec', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `openapi-${testId}`)

      const result = await sdk.openapi()

      expect(result.status).toBe(200)
      expect(result.data.openapi).toBe('3.0.0')
    })

    it('should return TypeScript types', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `types-${testId}`)

      const result = await sdk.types()

      expect(result.status).toBe(200)
      expect(result.data.types).toContain('interface Thing')
      expect(result.data.types).toContain('interface SDK')
    })

    it('should return resource schema', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `schema-${testId}`)

      const result = await sdk.schema()

      expect(result.status).toBe(200)
      expect(result.data.resources).toBeDefined()
      expect(result.data.resources.things).toBeDefined()
      expect(result.data.resources.relationships).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. THINGS CRUD
  // ==========================================================================

  describe('Things CRUD via SDK', () => {
    it('should create a thing', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `create-${testId}`)

      const result = await sdk.things.create({
        $type: 'Customer',
        name: 'Test Customer',
        data: { email: 'test@example.com' },
      })

      expect(result.status).toBe(201)
      expect(result.data.$id).toBeDefined()
      expect(result.data.$type).toBe('Customer')
      expect(result.data.name).toBe('Test Customer')
      expect(result.data.createdAt).toBeDefined()
    })

    it('should get a thing by ID', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `get-${testId}`)

      const created = await sdk.things.create({ $type: 'Test', name: 'Get Test' })
      const result = await sdk.things.get(created.data.$id)

      expect(result.status).toBe(200)
      expect((result.data as Thing).$id).toBe(created.data.$id)
      expect((result.data as Thing).name).toBe('Get Test')
    })

    it('should update a thing', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `update-${testId}`)

      const created = await sdk.things.create({ $type: 'Test', name: 'Original' })
      const result = await sdk.things.update(created.data.$id, { name: 'Updated' })

      expect(result.status).toBe(200)
      expect(result.data.name).toBe('Updated')
      expect(result.data.updatedAt).toBeGreaterThan(result.data.createdAt)
    })

    it('should patch a thing', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `patch-${testId}`)

      const created = await sdk.things.create({ $type: 'Test', name: 'Name', description: 'Desc' })
      const result = await sdk.things.patch(created.data.$id, { name: 'Patched Name' })

      expect(result.status).toBe(200)
      expect(result.data.name).toBe('Patched Name')
      expect(result.data.description).toBe('Desc') // Unchanged
    })

    it('should delete a thing', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `delete-${testId}`)

      const created = await sdk.things.create({ $type: 'Test', name: 'To Delete' })
      const deleteResult = await sdk.things.delete(created.data.$id)

      expect(deleteResult.status).toBe(204)

      // Verify deleted
      const getResult = await sdk.things.get(created.data.$id)
      expect(getResult.status).toBe(404)
    })

    it('should list things with pagination', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `list-${testId}`)

      // Create 25 things
      for (let i = 0; i < 25; i++) {
        await sdk.things.create({ $type: 'ListTest', name: `Item ${i}` })
      }

      // First page
      const page1 = await sdk.things.list({ limit: 10 })
      expect(page1.data.data).toHaveLength(10)
      expect(page1.data.total).toBe(25)
      expect(page1.data.hasMore).toBe(true)

      // Second page
      const page2 = await sdk.things.list({ limit: 10, offset: 10 })
      expect(page2.data.data).toHaveLength(10)
      expect(page2.data.hasMore).toBe(true)

      // Third page
      const page3 = await sdk.things.list({ limit: 10, offset: 20 })
      expect(page3.data.data).toHaveLength(5)
      expect(page3.data.hasMore).toBe(false)
    })

    it('should filter things by type', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `filter-${testId}`)

      await sdk.things.create({ $type: 'TypeA', name: 'A1' })
      await sdk.things.create({ $type: 'TypeA', name: 'A2' })
      await sdk.things.create({ $type: 'TypeB', name: 'B1' })

      const typeAResult = await sdk.things.list({ $type: 'TypeA' })
      expect(typeAResult.data.data).toHaveLength(2)
      expect(typeAResult.data.data.every(t => t.$type === 'TypeA')).toBe(true)

      const typeBResult = await sdk.things.list({ $type: 'TypeB' })
      expect(typeBResult.data.data).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 3. BATCH OPERATIONS
  // ==========================================================================

  describe('Batch Operations', () => {
    it('should batch create multiple things', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `batch-create-${testId}`)

      const result = await sdk.things.batch([
        { operation: 'create', data: { $type: 'Batch', name: 'Batch 1' } },
        { operation: 'create', data: { $type: 'Batch', name: 'Batch 2' } },
        { operation: 'create', data: { $type: 'Batch', name: 'Batch 3' } },
      ])

      expect(result.status).toBe(200)
      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(3)
      expect(result.data.failed).toBe(0)
    })

    it('should batch update and delete', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `batch-mixed-${testId}`)

      // First create some things
      const created1 = await sdk.things.create({ $type: 'Batch', name: 'Update Me' })
      const created2 = await sdk.things.create({ $type: 'Batch', name: 'Delete Me' })

      const result = await sdk.things.batch([
        { operation: 'update', id: created1.data.$id, data: { name: 'Updated' } },
        { operation: 'delete', id: created2.data.$id },
      ])

      expect(result.data.total).toBe(2)
      expect(result.data.succeeded).toBe(2)

      // Verify update
      const updated = await sdk.things.get(created1.data.$id)
      expect((updated.data as Thing).name).toBe('Updated')

      // Verify delete
      const deleted = await sdk.things.get(created2.data.$id)
      expect(deleted.status).toBe(404)
    })

    it('should handle partial batch failures', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `batch-fail-${testId}`)

      const result = await sdk.things.batch([
        { operation: 'create', data: { $type: 'Batch', name: 'Success' } },
        { operation: 'update', id: 'nonexistent', data: { name: 'Fail' } },
        { operation: 'create', data: { $type: 'Batch', name: 'Also Success' } },
      ])

      expect(result.data.total).toBe(3)
      expect(result.data.succeeded).toBe(2)
      expect(result.data.failed).toBe(1)
    })
  })

  // ==========================================================================
  // 4. RELATIONSHIPS
  // ==========================================================================

  describe('Relationships', () => {
    it('should create a relationship between things', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rel-create-${testId}`)

      const customer = await sdk.things.create({ $type: 'Customer', name: 'Customer' })
      const order = await sdk.things.create({ $type: 'Order', name: 'Order' })

      const result = await sdk.relationships.create({
        subject: customer.data.$id,
        predicate: 'hasOrder',
        object: order.data.$id,
      })

      expect(result.status).toBe(201)
      expect(result.data.$id).toBeDefined()
      expect(result.data.subject).toBe(customer.data.$id)
      expect(result.data.predicate).toBe('hasOrder')
      expect(result.data.object).toBe(order.data.$id)
    })

    it('should query relationships', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rel-query-${testId}`)

      const customer = await sdk.things.create({ $type: 'Customer', name: 'Customer' })
      const order1 = await sdk.things.create({ $type: 'Order', name: 'Order 1' })
      const order2 = await sdk.things.create({ $type: 'Order', name: 'Order 2' })

      await sdk.relationships.create({ subject: customer.data.$id, predicate: 'hasOrder', object: order1.data.$id })
      await sdk.relationships.create({ subject: customer.data.$id, predicate: 'hasOrder', object: order2.data.$id })

      const result = await sdk.relationships.query({ subject: customer.data.$id, predicate: 'hasOrder' })

      expect(result.status).toBe(200)
      expect(result.data).toHaveLength(2)
    })

    it('should delete a relationship', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rel-delete-${testId}`)

      const rel = await sdk.relationships.create({
        subject: 'a',
        predicate: 'relates',
        object: 'b',
      })

      const deleteResult = await sdk.relationships.delete(rel.data.$id)
      expect(deleteResult.status).toBe(204)

      const getResult = await sdk.relationships.get(rel.data.$id)
      expect(getResult.status).toBe(404)
    })
  })

  // ==========================================================================
  // 5. EVENTS
  // ==========================================================================

  describe('Events', () => {
    it('should emit an event', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `event-emit-${testId}`)

      const result = await sdk.events.emit({
        type: 'user.signup',
        payload: { email: 'test@example.com' },
        source: 'test',
      })

      expect(result.status).toBe(201)
      expect(result.data.$id).toBeDefined()
      expect(result.data.type).toBe('user.signup')
      expect(result.data.timestamp).toBeDefined()
    })

    it('should list events with filtering', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `event-list-${testId}`)

      await sdk.events.emit({ type: 'user.signup', payload: {} })
      await sdk.events.emit({ type: 'user.signup', payload: {} })
      await sdk.events.emit({ type: 'order.created', payload: {} })

      const signupEvents = await sdk.events.list({ type: 'user.signup' })
      expect(signupEvents.data.data).toHaveLength(2)

      const orderEvents = await sdk.events.list({ type: 'order.created' })
      expect(orderEvents.data.data).toHaveLength(1)
    })

    it('should get an event by ID', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `event-get-${testId}`)

      const emitted = await sdk.events.emit({ type: 'test.event', payload: { test: true } })
      const result = await sdk.events.get(emitted.data.$id)

      expect(result.status).toBe(200)
      expect((result.data as Event).$id).toBe(emitted.data.$id)
      expect((result.data as Event).type).toBe('test.event')
    })
  })

  // ==========================================================================
  // 6. RPC
  // ==========================================================================

  describe('RPC Calls', () => {
    it('should call RPC methods', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rpc-${testId}`)

      // Create some things first
      await sdk.things.create({ $type: 'Test', name: 'RPC Test 1' })
      await sdk.things.create({ $type: 'Test', name: 'RPC Test 2' })

      const result = await sdk.rpc<number>('getThingCount')

      expect(result.status).toBe(200)
      expect(result.data.result).toBe(2)
    })

    it('should get stats via RPC', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rpc-stats-${testId}`)

      await sdk.things.create({ $type: 'Test', name: 'Thing' })
      await sdk.relationships.create({ subject: 'a', predicate: 'b', object: 'c' })
      await sdk.events.emit({ type: 'test' })

      const result = await sdk.rpc<{ things: number; relationships: number; events: number }>('getStats')

      expect(result.data.result.things).toBe(1)
      expect(result.data.result.relationships).toBe(1)
      expect(result.data.result.events).toBe(1)
    })

    it('should handle RPC method not found', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rpc-notfound-${testId}`)

      const result = await sdk.rpc('nonexistentMethod')

      expect(result.status).toBe(404)
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING
  // ==========================================================================

  describe('SDK Error Handling', () => {
    it('should handle validation errors', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `error-validation-${testId}`)

      // Missing required $type
      const result = await sdk.things.create({ name: 'No Type' } as never)

      expect(result.status).toBe(400)
      expect((result.data as { code: string }).code).toBe('VALIDATION_ERROR')
    })

    it('should handle not found errors', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `error-notfound-${testId}`)

      const result = await sdk.things.get('nonexistent-id')

      expect(result.status).toBe(404)
      expect((result.data as { code: string }).code).toBe('NOT_FOUND')
    })

    it('should handle update on non-existent resource', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `error-update-${testId}`)

      const result = await sdk.things.update('nonexistent', { name: 'Updated' })

      expect(result.status).toBe(404)
    })

    it('should handle relationship validation errors', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `error-rel-${testId}`)

      const result = await sdk.relationships.create({ subject: 'a', predicate: 'b' } as never)

      expect(result.status).toBe(400)
      expect((result.data as { code: string }).code).toBe('VALIDATION_ERROR')
    })
  })

  // ==========================================================================
  // 8. MULTI-TENANT ISOLATION
  // ==========================================================================

  describe('Multi-Tenant SDK Isolation', () => {
    it('should isolate data between tenants', async () => {
      const testId = Date.now().toString(36)
      const sdkA = createSDKClient(mf, `tenant-a-${testId}`)
      const sdkB = createSDKClient(mf, `tenant-b-${testId}`)

      // Create things in each tenant
      await sdkA.things.create({ $type: 'Test', name: 'Tenant A Thing' })
      await sdkB.things.create({ $type: 'Test', name: 'Tenant B Thing' })

      // Each tenant should only see their own things
      const listA = await sdkA.things.list()
      const listB = await sdkB.things.list()

      expect(listA.data.data).toHaveLength(1)
      expect(listA.data.data[0].name).toBe('Tenant A Thing')

      expect(listB.data.data).toHaveLength(1)
      expect(listB.data.data[0].name).toBe('Tenant B Thing')
    })

    it('should isolate events between tenants', async () => {
      const testId = Date.now().toString(36)
      const sdkA = createSDKClient(mf, `event-tenant-a-${testId}`)
      const sdkB = createSDKClient(mf, `event-tenant-b-${testId}`)

      await sdkA.events.emit({ type: 'tenant.a.event' })
      await sdkB.events.emit({ type: 'tenant.b.event' })

      const eventsA = await sdkA.events.list()
      const eventsB = await sdkB.events.list()

      expect(eventsA.data.data).toHaveLength(1)
      expect(eventsA.data.data[0].type).toBe('tenant.a.event')

      expect(eventsB.data.data).toHaveLength(1)
      expect(eventsB.data.data[0].type).toBe('tenant.b.event')
    })
  })

  // ==========================================================================
  // 9. CONCURRENT OPERATIONS
  // ==========================================================================

  describe('Concurrent SDK Operations', () => {
    it('should handle concurrent creates', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `concurrent-${testId}`)

      const promises = Array.from({ length: 10 }, (_, i) =>
        sdk.things.create({ $type: 'Concurrent', name: `Thing ${i}` })
      )

      const results = await Promise.all(promises)

      expect(results.every(r => r.status === 201)).toBe(true)

      const list = await sdk.things.list()
      expect(list.data.total).toBe(10)
    })

    it('should handle concurrent reads and writes', async () => {
      const testId = Date.now().toString(36)
      const sdk = createSDKClient(mf, `rw-concurrent-${testId}`)

      // Create initial thing
      const created = await sdk.things.create({ $type: 'RW', name: 'Original' })
      const id = created.data.$id

      // Concurrent reads and updates
      const operations = [
        sdk.things.get(id),
        sdk.things.update(id, { name: 'Update 1' }),
        sdk.things.get(id),
        sdk.things.update(id, { name: 'Update 2' }),
        sdk.things.get(id),
      ]

      const results = await Promise.all(operations)

      // All should succeed
      expect(results.every(r => r.status === 200)).toBe(true)
    })
  })
})
