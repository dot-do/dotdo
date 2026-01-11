/**
 * REST Router Tests
 *
 * Tests for the REST API router with JSON-LD/mdxld response formatting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  formatThingAsJsonLd,
  formatCollectionAsJsonLd,
  generateIndex,
  parseRestRoute,
  handleRestRequest,
  handleGetIndex,
  handleListByType,
  handleGetById,
  handleCreate,
  handleUpdate,
  handleDelete,
  type RestRouterContext,
  type JsonLdResponse,
  type CollectionResponse,
  type IndexResponse,
} from '../../transport/rest-router'
import type { ThingEntity } from '../../../db/stores'

// ============================================================================
// MOCK THINGS STORE
// ============================================================================

function createMockThingsStore() {
  const things: Map<string, ThingEntity> = new Map()

  return {
    things,
    list: vi.fn(async (options?: { type?: string }) => {
      const allThings = Array.from(things.values())
      if (options?.type) {
        return allThings.filter(t =>
          t.$type.toLowerCase() === options.type!.toLowerCase()
        )
      }
      return allThings
    }),
    get: vi.fn(async (id: string) => {
      return things.get(id) ?? null
    }),
    create: vi.fn(async (data: Partial<ThingEntity>) => {
      const id = data.$id ?? crypto.randomUUID()
      const thing: ThingEntity = {
        $id: id,
        $type: data.$type ?? 'Unknown',
        name: data.name ?? null,
        data: data.data ?? null,
        version: 1,
        deleted: false,
      }
      things.set(id, thing)
      return thing
    }),
    update: vi.fn(async (id: string, data: Partial<ThingEntity>) => {
      const existing = things.get(id)
      if (!existing) {
        throw new Error(`Thing '${id}' not found`)
      }
      const updated: ThingEntity = {
        ...existing,
        name: data.name ?? existing.name,
        data: data.data ?? existing.data,
        version: (existing.version ?? 0) + 1,
      }
      things.set(id, updated)
      return updated
    }),
    delete: vi.fn(async (id: string) => {
      const existing = things.get(id)
      if (!existing) {
        throw new Error(`Thing '${id}' not found`)
      }
      const deleted: ThingEntity = { ...existing, deleted: true }
      things.delete(id)
      return deleted
    }),
  }
}

// ============================================================================
// FORMAT TESTS
// ============================================================================

describe('formatThingAsJsonLd', () => {
  it('should format a thing with $context, $id, and $type', () => {
    const thing: ThingEntity = {
      $id: 'cust-1',
      $type: 'Customer',
      name: 'Acme Corp',
      data: { email: 'contact@acme.com', tier: 'premium' },
    }

    const result = formatThingAsJsonLd(thing)

    expect(result.$context).toBe('https://dotdo.dev/context')
    expect(result.$id).toBe('/customers/cust-1')
    expect(result.$type).toBe('Customer')
    expect(result.name).toBe('Acme Corp')
    expect(result.email).toBe('contact@acme.com')
    expect(result.tier).toBe('premium')
  })

  it('should handle full URL in $type', () => {
    const thing: ThingEntity = {
      $id: 'prod-1',
      $type: 'https://schema.org/Product',
      name: 'Widget',
      data: null,
    }

    const result = formatThingAsJsonLd(thing)

    expect(result.$type).toBe('Product')
    expect(result.$id).toBe('/products/prod-1')
  })

  it('should use custom context URL', () => {
    const thing: ThingEntity = {
      $id: 'item-1',
      $type: 'Item',
      name: null,
      data: null,
    }

    const result = formatThingAsJsonLd(thing, 'https://example.com.ai/context')

    expect(result.$context).toBe('https://example.com.ai/context')
  })

  it('should omit name when null', () => {
    const thing: ThingEntity = {
      $id: 'anon-1',
      $type: 'Anonymous',
      name: null,
      data: { foo: 'bar' },
    }

    const result = formatThingAsJsonLd(thing)

    expect(result.name).toBeUndefined()
    expect(result.foo).toBe('bar')
  })
})

describe('formatCollectionAsJsonLd', () => {
  it('should format a collection with items', () => {
    const things: ThingEntity[] = [
      { $id: 'cust-1', $type: 'Customer', name: 'Acme', data: null },
      { $id: 'cust-2', $type: 'Customer', name: 'Globex', data: null },
    ]

    const result = formatCollectionAsJsonLd(things, 'Customer')

    expect(result.$context).toBe('https://dotdo.dev/context')
    expect(result.$id).toBe('/customers')
    expect(result.$type).toBe('Collection')
    expect(result.totalItems).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.items[0].$id).toBe('/customers/cust-1')
    expect(result.items[1].$id).toBe('/customers/cust-2')
  })

  it('should handle empty collection', () => {
    const result = formatCollectionAsJsonLd([], 'Order')

    expect(result.totalItems).toBe(0)
    expect(result.items).toHaveLength(0)
  })
})

describe('generateIndex', () => {
  it('should generate HATEOAS index', () => {
    const nouns = [
      { noun: 'Customer', plural: 'Customers' },
      { noun: 'Order', plural: 'Orders' },
    ]

    const result = generateIndex('my-do', nouns)

    expect(result.$context).toBe('https://dotdo.dev/context')
    expect(result.$id).toBe('/')
    expect(result.$type).toBe('Index')
    expect(result.ns).toBe('my-do')
    expect(result.collections).toHaveLength(2)
    expect(result.collections[0].$id).toBe('/customers')
    expect(result.collections[0].$type).toBe('Customer')
    expect(result.collections[1].$id).toBe('/orders')
  })

  it('should handle empty nouns', () => {
    const result = generateIndex('empty-do', [])

    expect(result.collections).toHaveLength(0)
  })
})

// ============================================================================
// ROUTE PARSING TESTS
// ============================================================================

describe('parseRestRoute', () => {
  it('should parse collection route', () => {
    const result = parseRestRoute('/customers')

    expect(result).toEqual({ type: 'Customer', id: undefined })
  })

  it('should parse item route', () => {
    const result = parseRestRoute('/customers/cust-123')

    expect(result).toEqual({ type: 'Customer', id: 'cust-123' })
  })

  it('should singularize plural forms', () => {
    expect(parseRestRoute('/orders')?.type).toBe('Order')
    expect(parseRestRoute('/categories')?.type).toBe('Category')
    expect(parseRestRoute('/statuses')?.type).toBe('Status') // 'es' ending is stripped
    expect(parseRestRoute('/users')?.type).toBe('User')
  })

  it('should capitalize type', () => {
    expect(parseRestRoute('/products')?.type).toBe('Product')
  })

  it('should return null for root path', () => {
    expect(parseRestRoute('/')).toBeNull()
  })

  it('should return null for too many segments', () => {
    expect(parseRestRoute('/a/b/c')).toBeNull()
  })
})

// ============================================================================
// HANDLER TESTS
// ============================================================================

describe('handleGetIndex', () => {
  it('should return JSON-LD index', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = {
      things: store as any,
      ns: 'test-do',
      nouns: [
        { noun: 'Customer', plural: 'Customers' },
        { noun: 'Order', plural: 'Orders' },
      ],
    }

    const response = await handleGetIndex(ctx)
    const body = await response.json() as IndexResponse

    expect(response.headers.get('Content-Type')).toBe('application/ld+json')
    expect(body.$type).toBe('Index')
    expect(body.ns).toBe('test-do')
    expect(body.collections).toHaveLength(2)
  })
})

describe('handleListByType', () => {
  it('should list items by type', async () => {
    const store = createMockThingsStore()
    store.things.set('cust-1', { $id: 'cust-1', $type: 'Customer', name: 'A', data: null })
    store.things.set('cust-2', { $id: 'cust-2', $type: 'Customer', name: 'B', data: null })

    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }
    const response = await handleListByType(ctx, 'Customer')
    const body = await response.json() as CollectionResponse

    expect(response.status).toBe(200)
    expect(body.$type).toBe('Collection')
    expect(body.totalItems).toBe(2)
  })

  it('should return empty collection for no matches', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleListByType(ctx, 'Customer')
    const body = await response.json() as CollectionResponse

    expect(body.totalItems).toBe(0)
    expect(body.items).toHaveLength(0)
  })
})

describe('handleGetById', () => {
  it('should get item by id', async () => {
    const store = createMockThingsStore()
    store.things.set('cust-1', {
      $id: 'cust-1',
      $type: 'Customer',
      name: 'Acme',
      data: { tier: 'gold' },
    })

    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }
    const response = await handleGetById(ctx, 'Customer', 'cust-1')
    const body = await response.json() as JsonLdResponse

    expect(response.status).toBe(200)
    expect(body.$id).toBe('/customers/cust-1')
    expect(body.$type).toBe('Customer')
    expect(body.name).toBe('Acme')
    expect(body.tier).toBe('gold')
  })

  it('should return 404 for missing item', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleGetById(ctx, 'Customer', 'nonexistent')
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('should return 404 for wrong type', async () => {
    const store = createMockThingsStore()
    store.things.set('ord-1', { $id: 'ord-1', $type: 'Order', name: null, data: null })

    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }
    const response = await handleGetById(ctx, 'Customer', 'ord-1')

    expect(response.status).toBe(404)
  })
})

describe('handleCreate', () => {
  it('should create new item', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleCreate(ctx, 'Customer', {
      name: 'NewCorp',
      email: 'new@corp.com',
    })
    const body = await response.json() as JsonLdResponse

    expect(response.status).toBe(201)
    expect(body.$type).toBe('Customer')
    expect(body.name).toBe('NewCorp')
    expect(body.email).toBe('new@corp.com')
    expect(response.headers.get('Location')).toBeTruthy()
  })

  it('should use provided $id', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleCreate(ctx, 'Customer', {
      $id: 'custom-id',
      name: 'Custom',
    })
    const body = await response.json() as JsonLdResponse

    expect(body.$id).toBe('/customers/custom-id')
  })
})

describe('handleUpdate', () => {
  it('should update existing item', async () => {
    const store = createMockThingsStore()
    store.things.set('cust-1', {
      $id: 'cust-1',
      $type: 'Customer',
      name: 'Old Name',
      data: { tier: 'silver' },
    })

    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }
    const response = await handleUpdate(ctx, 'Customer', 'cust-1', {
      name: 'New Name',
      tier: 'gold',
    })
    const body = await response.json() as JsonLdResponse

    expect(response.status).toBe(200)
    expect(body.name).toBe('New Name')
    expect(body.tier).toBe('gold')
  })

  it('should return 404 for missing item', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleUpdate(ctx, 'Customer', 'nonexistent', {
      name: 'test',
    })

    expect(response.status).toBe(404)
  })
})

describe('handleDelete', () => {
  it('should delete existing item', async () => {
    const store = createMockThingsStore()
    store.things.set('cust-1', {
      $id: 'cust-1',
      $type: 'Customer',
      name: 'ToDelete',
      data: null,
    })

    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }
    const response = await handleDelete(ctx, 'Customer', 'cust-1')

    expect(response.status).toBe(204)
    expect(store.things.has('cust-1')).toBe(false)
  })

  it('should return 404 for missing item', async () => {
    const store = createMockThingsStore()
    const ctx: RestRouterContext = { things: store as any, ns: 'test-do' }

    const response = await handleDelete(ctx, 'Customer', 'nonexistent')

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// FULL REQUEST HANDLER TESTS
// ============================================================================

describe('handleRestRequest', () => {
  let store: ReturnType<typeof createMockThingsStore>
  let ctx: RestRouterContext

  beforeEach(() => {
    store = createMockThingsStore()
    ctx = { things: store as any, ns: 'test-do' }
  })

  it('should handle GET /customers (list)', async () => {
    store.things.set('c1', { $id: 'c1', $type: 'Customer', name: 'A', data: null })

    const request = new Request('https://example.com.ai/customers', { method: 'GET' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json() as CollectionResponse
    expect(body.$type).toBe('Collection')
  })

  it('should handle GET /customers/:id', async () => {
    store.things.set('c1', { $id: 'c1', $type: 'Customer', name: 'A', data: null })

    const request = new Request('https://example.com.ai/customers/c1', { method: 'GET' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json() as JsonLdResponse
    expect(body.$id).toBe('/customers/c1')
  })

  it('should handle POST /customers', async () => {
    const request = new Request('https://example.com.ai/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Customer' }),
    })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(201)
  })

  it('should handle PUT /customers/:id', async () => {
    store.things.set('c1', { $id: 'c1', $type: 'Customer', name: 'Old', data: null })

    const request = new Request('https://example.com.ai/customers/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('should handle PATCH /customers/:id', async () => {
    store.things.set('c1', { $id: 'c1', $type: 'Customer', name: 'Old', data: null })

    const request = new Request('https://example.com.ai/customers/c1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com' }),
    })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('should handle DELETE /customers/:id', async () => {
    store.things.set('c1', { $id: 'c1', $type: 'Customer', name: 'ToDelete', data: null })

    const request = new Request('https://example.com.ai/customers/c1', { method: 'DELETE' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(204)
  })

  it('should return null for non-REST routes', async () => {
    const request = new Request('https://example.com.ai/health', { method: 'GET' })
    const response = await handleRestRequest(request, ctx)

    expect(response).toBeNull()
  })

  it('should return 405 for unsupported methods on collections', async () => {
    const request = new Request('https://example.com.ai/customers', { method: 'DELETE' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(405)
    expect(response!.headers.get('Allow')).toBe('GET, POST')
  })

  it('should return 405 for unsupported methods on items', async () => {
    const request = new Request('https://example.com.ai/customers/c1', { method: 'POST' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(response!.status).toBe(405)
    expect(response!.headers.get('Allow')).toBe('GET, PUT, PATCH, DELETE')
  })

  it('should handle query parameters for list', async () => {
    const request = new Request('https://example.com.ai/customers?limit=10&offset=5', { method: 'GET' })
    const response = await handleRestRequest(request, ctx)

    expect(response).not.toBeNull()
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 5,
    }))
  })
})
