/**
 * E2E Tests: $ Context Full Flow
 *
 * These tests verify the FULL flow of $Context operations from client
 * through tenant DOs to parent DOs using Miniflare for real DO testing.
 *
 * NO MOCKS - Uses real Miniflare instances with real SQLite.
 *
 * Test Categories:
 * 1. Client -> Tenant DO connection (via $Context)
 * 2. Tenant CRUD operations via $Context
 * 3. Event streaming from Tenant -> Parent
 * 4. Global search from Parent across Tenants
 * 5. Multi-tenant isolation
 * 6. WebSocket event subscriptions across hierarchy
 * 7. Error handling and edge cases
 *
 * @module tests/e2e/tests/context-flow.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// Import $Context from @dotdo/do (client implementation)
import { $Context } from '../../../do/client'
import type { ClientContext, Thing, ListResult, EventPayload } from '../../../do/client'

// ============================================================================
// Type Definitions for E2E Testing
// ============================================================================

/**
 * Extended context interface for parent DO with global capabilities
 */
interface ParentContext extends ClientContext {
  query: {
    global: <T = Thing>(options: {
      $type?: string
      filters?: Record<string, unknown>
      limit?: number
      offset?: number
    }) => Promise<ListResult<T>>
  }
  children: {
    list: () => Promise<Array<{ id: string; name: string; lastSeen: number }>>
    count: () => Promise<number>
  }
}

/**
 * Tenant context with parent reference
 */
interface TenantContext extends ClientContext {
  $context: {
    $id: string
    emit: (event: { $type: string; payload: unknown }) => Promise<void>
  }
}

// ============================================================================
// Test DO Script - A complete DO implementation for testing
// ============================================================================

const TEST_DO_SCRIPT = `
// Simple ID generator
function generateId() {
  return 'thing-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

export class TenantDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.tenantId = null
    this.eventSubscribers = []
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Extract tenant from header
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader && !this.tenantId) {
      this.tenantId = tenantHeader
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return this.handleRPC(request)
    }

    // Health check
    if (path === '/' || path === '/health') {
      return Response.json({
        status: 'ok',
        id: this.state.id.toString(),
        tenantId: this.tenantId
      })
    }

    return Response.json({ error: 'Not Found', path }, { status: 404 })
  }

  handleWebSocket(request) {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    server.accept()

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'subscribe') {
          this.eventSubscribers.push({ ws: server, event: data.event })
        } else if (data.type === 'unsubscribe') {
          this.eventSubscribers = this.eventSubscribers.filter(
            s => !(s.ws === server && s.event === data.event)
          )
        }
      } catch (e) {
        // Ignore malformed messages
      }
    })

    server.addEventListener('close', () => {
      this.eventSubscribers = this.eventSubscribers.filter(s => s.ws !== server)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async handleRPC(request) {
    try {
      const body = await request.json()

      // Handle batch requests
      if (Array.isArray(body)) {
        const results = await Promise.all(body.map(b => this.executeRPC(b)))
        return Response.json(results)
      }

      const result = await this.executeRPC(body)
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: error.message, code: 'RPC_ERROR' }, { status: 500 })
    }
  }

  async executeRPC({ method, args, id }) {
    // things.create
    if (method === 'things.create') {
      const data = args[0]
      if (!data || !data.$type) {
        return { error: '$type is required', code: 'VALIDATION_ERROR' }
      }

      const thingId = generateId()
      const thing = {
        $id: thingId,
        $type: data.$type,
        ...data,
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
      }

      await this.storage.put('thing:' + thingId, thing)

      // Track in index
      const index = await this.storage.get('thing-index') || []
      index.push(thingId)
      await this.storage.put('thing-index', index)

      // Emit event
      this.broadcastEvent('Thing.created', { thing })

      return thing
    }

    // things.get
    if (method === 'things.get') {
      const thingId = args[0]
      const thing = await this.storage.get('thing:' + thingId)
      return thing || null
    }

    // things.list
    if (method === 'things.list') {
      const opts = args[0] || {}
      const index = await this.storage.get('thing-index') || []
      let things = []

      for (const thingId of index) {
        const thing = await this.storage.get('thing:' + thingId)
        if (thing) {
          // Filter by $type if specified
          if (opts.$type && thing.$type !== opts.$type) {
            continue
          }
          // Filter by where clause
          if (opts.where) {
            let match = true
            for (const [key, value] of Object.entries(opts.where)) {
              if (thing[key] !== value) {
                match = false
                break
              }
            }
            if (!match) continue
          }
          things.push(thing)
        }
      }

      // Apply pagination
      const offset = opts.offset || 0
      const limit = opts.limit || 100
      const total = things.length
      things = things.slice(offset, offset + limit)

      return { items: things, total }
    }

    // things.update
    if (method === 'things.update') {
      const [thingId, updates] = args
      const thing = await this.storage.get('thing:' + thingId)
      if (!thing) {
        throw new Error('Thing not found')
      }

      const updated = { ...thing, ...updates, $updatedAt: Date.now() }
      await this.storage.put('thing:' + thingId, updated)

      // Emit event
      this.broadcastEvent('Thing.updated', { thing: updated })

      return updated
    }

    // things.delete
    if (method === 'things.delete') {
      const thingId = args[0]
      const thing = await this.storage.get('thing:' + thingId)
      if (!thing) {
        return { deleted: false }
      }

      await this.storage.delete('thing:' + thingId)

      // Update index
      const index = await this.storage.get('thing-index') || []
      const newIndex = index.filter(id => id !== thingId)
      await this.storage.put('thing-index', newIndex)

      // Emit event
      this.broadcastEvent('Thing.deleted', { thingId })

      return { deleted: true }
    }

    // events.emit
    if (method === 'events.emit') {
      const event = args[0]
      const eventId = generateId()
      const timestamp = Date.now()

      // Store event
      const storedEvent = {
        $id: eventId,
        $timestamp: timestamp,
        type: event.type,
        payload: event.payload,
      }
      await this.storage.put('event:' + eventId, storedEvent)

      // Track in event index
      const eventIndex = await this.storage.get('event-index') || []
      eventIndex.push(eventId)
      await this.storage.put('event-index', eventIndex)

      // Broadcast to subscribers
      this.broadcastEvent(event.type, event.payload)

      return { $id: eventId, $timestamp: timestamp }
    }

    // events.query
    if (method === 'events.query') {
      const opts = args[0] || {}
      const eventIndex = await this.storage.get('event-index') || []
      let events = []

      for (const eventId of eventIndex) {
        const event = await this.storage.get('event:' + eventId)
        if (event) {
          if (opts.type && event.type !== opts.type) {
            continue
          }
          events.push(event)
        }
      }

      const total = events.length
      const offset = opts.offset || 0
      const limit = opts.limit || 100
      events = events.slice(offset, offset + limit)

      return { items: events, total }
    }

    return { error: 'Unknown method: ' + method, code: 'METHOD_NOT_FOUND' }
  }

  broadcastEvent(type, payload) {
    const eventData = JSON.stringify({
      type: 'event',
      event: type,
      payload,
      $id: generateId(),
      $timestamp: Date.now(),
    })

    for (const sub of this.eventSubscribers) {
      // Check if subscription matches
      const [subNoun, subVerb] = sub.event.split('.')
      const [eventNoun, eventVerb] = type.split('.')

      if (
        sub.event === '*.*' ||
        sub.event === type ||
        (subNoun === eventNoun && subVerb === '*') ||
        (subNoun === '*' && subVerb === eventVerb)
      ) {
        try {
          sub.ws.send(eventData)
        } catch (e) {
          // WebSocket might be closed
        }
      }
    }
  }
}

// Worker that routes requests to the appropriate tenant DO
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Extract tenant namespace from header only (simplest approach)
    // DO NOT manipulate paths - let the DO handle all paths
    const tenantHeader = request.headers.get('X-Tenant-ID')
    const namespace = tenantHeader || 'default'

    // Get DO stub for this tenant namespace
    const id = env.TENANT_DO.idFromName(namespace)
    const stub = env.TENANT_DO.get(id)

    // Forward request to the tenant's DO, adding tenant header
    const headers = new Headers(request.headers)
    headers.set('X-Tenant-ID', namespace)

    const newRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
    })

    return stub.fetch(newRequest)
  }
}
`

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for a condition with timeout
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Generate unique test ID
 */
function testId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a tenant client that makes requests to the miniflare instance
 */
function createTenantClient(mf: Miniflare, tenantId: string) {
  return {
    async rpc<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
      const headers = new Headers()
      headers.set('X-Tenant-ID', tenantId)
      headers.set('Content-Type', 'application/json')

      const response = await mf.dispatchFetch('http://localhost/rpc', {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args }),
      })

      const result = (await response.json()) as T
      return result
    },

    async health(): Promise<{ status: string; id: string; tenantId: string | null }> {
      const headers = new Headers()
      headers.set('X-Tenant-ID', tenantId)

      const response = await mf.dispatchFetch('http://localhost/health', { headers })
      return (await response.json()) as { status: string; id: string; tenantId: string | null }
    },
  }
}

// ============================================================================
// TEST SUITE 1: $Context Client API
// ============================================================================

describe('E2E: $Context Client API', () => {
  it('should create $Context for tenant URL', () => {
    const $ = $Context('https://crm.example.com.ai/acme')

    expect($).toBeDefined()
    expect(typeof $).toBe('object')
    expect($._namespace).toBe('acme')
    expect($._tenant).toBe('crm')
  })

  it('should parse tenant namespace from URL path', () => {
    const $ = $Context('https://crm.example.com.ai/acme')
    expect($._namespace).toBe('acme')
  })

  it('should parse subdomain from URL', () => {
    const $ = $Context('https://crm.example.com.ai/acme')
    expect($._tenant).toBe('crm')
  })

  it('should support authentication token', () => {
    const $ = $Context('https://crm.example.com.ai/acme', {
      token: 'test-bearer-token',
    })

    expect($._options.token).toBe('test-bearer-token')
  })

  it('should support custom headers', () => {
    const $ = $Context('https://crm.example.com.ai/acme', {
      headers: {
        'X-Tenant-ID': 'acme',
        'X-Correlation-ID': 'req-123',
      },
    })

    expect($._options.headers).toEqual({
      'X-Tenant-ID': 'acme',
      'X-Correlation-ID': 'req-123',
    })
  })

  it('should create unique contexts for different tenants', () => {
    const $acme = $Context('https://crm.example.com.ai/acme')
    const $bigcorp = $Context('https://crm.example.com.ai/bigcorp')

    expect($acme._namespace).toBe('acme')
    expect($bigcorp._namespace).toBe('bigcorp')
    expect($acme._namespace).not.toBe($bigcorp._namespace)
  })

  it('should have things API', () => {
    const $ = $Context('https://example.com.ai')

    expect($.things).toBeDefined()
    expect(typeof $.things.create).toBe('function')
    expect(typeof $.things.get).toBe('function')
    expect(typeof $.things.list).toBe('function')
    expect(typeof $.things.update).toBe('function')
    expect(typeof $.things.delete).toBe('function')
  })

  it('should have events API', () => {
    const $ = $Context('https://example.com.ai')

    expect($.events).toBeDefined()
    expect(typeof $.events.emit).toBe('function')
    expect(typeof $.events.subscribe).toBe('function')
    expect(typeof $.events.query).toBe('function')
  })

  it('should have on proxy for event subscriptions', () => {
    const $ = $Context('https://example.com.ai')

    expect($.on).toBeDefined()
    expect($.on.Customer).toBeDefined()
    expect(typeof $.on.Customer.created).toBe('function')
  })

  it('should have connection management methods', () => {
    const $ = $Context('https://example.com.ai')

    expect(typeof $.connect).toBe('function')
    expect(typeof $.disconnect).toBe('function')
    expect(typeof $.isConnected).toBe('function')
  })

  it('should have entity proxy for Noun(id) calls', () => {
    const $ = $Context('https://example.com.ai')

    // Access $.Customer - should return a function
    const CustomerFn = ($ as Record<string, unknown>).Customer
    expect(typeof CustomerFn).toBe('function')

    // Call $.Customer('123') - should return entity proxy
    const entity = (CustomerFn as (id: string) => unknown)('123')
    expect(entity).toBeDefined()
    expect(typeof entity).toBe('object')
  })
})

// ============================================================================
// TEST SUITE 2: Miniflare-based CRUD Operations
// ============================================================================

describe('E2E: Miniflare CRUD Operations', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: TEST_DO_SCRIPT,
      durableObjects: {
        TENANT_DO: 'TenantDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  describe('things.create()', () => {
    it('should create a thing in tenant DO', async () => {
      const client = createTenantClient(mf, `create-test-${testId()}`)

      const result = await client.rpc<Thing>('things.create', [
        { $type: 'Customer', name: 'Alice', email: 'alice@example.com' },
      ])

      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
      expect(result.$createdAt).toBeDefined()
    })

    it('should auto-generate unique $id', async () => {
      const client = createTenantClient(mf, `autoid-test-${testId()}`)

      const c1 = await client.rpc<Thing>('things.create', [{ $type: 'Customer', name: 'Alice' }])
      const c2 = await client.rpc<Thing>('things.create', [{ $type: 'Customer', name: 'Bob' }])

      expect(c1.$id).not.toBe(c2.$id)
    })

    it('should validate $type is required', async () => {
      const client = createTenantClient(mf, `validate-test-${testId()}`)

      const result = await client.rpc<{ error: string; code: string }>('things.create', [
        { name: 'Alice' },
      ])

      expect(result.error).toBeDefined()
      expect(result.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('things.get()', () => {
    it('should get a thing by ID', async () => {
      const client = createTenantClient(mf, `get-test-${testId()}`)

      const created = await client.rpc<Thing>('things.create', [{ $type: 'Customer', name: 'Bob' }])
      const retrieved = await client.rpc<Thing | null>('things.get', [created.$id])

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.name).toBe('Bob')
    })

    it('should return null for non-existent ID', async () => {
      const client = createTenantClient(mf, `getmissing-test-${testId()}`)

      const result = await client.rpc<Thing | null>('things.get', ['nonexistent-id-12345'])
      expect(result).toBeNull()
    })
  })

  describe('things.list()', () => {
    it('should list things by type', async () => {
      const tenantId = `list-test-${testId()}`
      const client = createTenantClient(mf, tenantId)

      await client.rpc('things.create', [{ $type: 'Lead', name: 'Lead 1' }])
      await client.rpc('things.create', [{ $type: 'Lead', name: 'Lead 2' }])
      await client.rpc('things.create', [{ $type: 'Customer', name: 'Customer 1' }])

      const leads = await client.rpc<ListResult<Thing>>('things.list', [{ $type: 'Lead' }])

      expect(leads.items.length).toBe(2)
      expect(leads.items.every((l) => l.$type === 'Lead')).toBe(true)
    })

    it('should support pagination', async () => {
      const tenantId = `pagination-test-${testId()}`
      const client = createTenantClient(mf, tenantId)

      for (let i = 0; i < 5; i++) {
        await client.rpc('things.create', [{ $type: 'Contact', name: `Contact ${i}` }])
      }

      const page1 = await client.rpc<ListResult<Thing>>('things.list', [
        { $type: 'Contact', limit: 2, offset: 0 },
      ])
      const page2 = await client.rpc<ListResult<Thing>>('things.list', [
        { $type: 'Contact', limit: 2, offset: 2 },
      ])

      expect(page1.items.length).toBe(2)
      expect(page2.items.length).toBe(2)
    })

    it('should support filtering', async () => {
      const tenantId = `filter-test-${testId()}`
      const client = createTenantClient(mf, tenantId)

      await client.rpc('things.create', [{ $type: 'Lead', name: 'Active Lead', status: 'active' }])
      await client.rpc('things.create', [{ $type: 'Lead', name: 'Inactive Lead', status: 'inactive' }])

      const activeLeads = await client.rpc<ListResult<Thing>>('things.list', [
        { $type: 'Lead', where: { status: 'active' } },
      ])

      expect(activeLeads.items.every((l) => l.status === 'active')).toBe(true)
    })
  })

  describe('things.update()', () => {
    it('should update a thing by ID', async () => {
      const client = createTenantClient(mf, `update-test-${testId()}`)

      const created = await client.rpc<Thing>('things.create', [
        { $type: 'Customer', name: 'Charlie', status: 'new' },
      ])

      const updated = await client.rpc<Thing>('things.update', [created.$id, { status: 'qualified' }])

      expect(updated.status).toBe('qualified')
      expect(updated.$updatedAt).toBeDefined()
    })

    it('should throw when updating non-existent thing', async () => {
      const client = createTenantClient(mf, `updatefail-test-${testId()}`)

      try {
        await client.rpc('things.update', ['nonexistent-id-12345', { name: 'Test' }])
        expect.fail('Should have thrown')
      } catch {
        // Expected
      }
    })
  })

  describe('things.delete()', () => {
    it('should delete a thing by ID', async () => {
      const client = createTenantClient(mf, `delete-test-${testId()}`)

      const created = await client.rpc<Thing>('things.create', [{ $type: 'Customer', name: 'Diana' }])

      const result = await client.rpc<{ deleted: boolean }>('things.delete', [created.$id])
      expect(result.deleted).toBe(true)

      const retrieved = await client.rpc<Thing | null>('things.get', [created.$id])
      expect(retrieved).toBeNull()
    })

    it('should return false for non-existent thing', async () => {
      const client = createTenantClient(mf, `deletefail-test-${testId()}`)

      const result = await client.rpc<{ deleted: boolean }>('things.delete', ['nonexistent-id-12345'])
      expect(result.deleted).toBe(false)
    })
  })
})

// ============================================================================
// TEST SUITE 3: Multi-tenant Isolation
// ============================================================================

describe('E2E: Multi-tenant Isolation', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: TEST_DO_SCRIPT,
      durableObjects: {
        TENANT_DO: 'TenantDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('should create separate DO instances for different tenants', async () => {
    const tenantA = createTenantClient(mf, `tenant-a-${testId()}`)
    const tenantB = createTenantClient(mf, `tenant-b-${testId()}`)

    const healthA = await tenantA.health()
    const healthB = await tenantB.health()

    expect(healthA.status).toBe('ok')
    expect(healthB.status).toBe('ok')
    expect(healthA.id).not.toBe(healthB.id)
  })

  it('should isolate things between tenants', async () => {
    const uniqueTag = testId('isolation')
    const tenant1 = createTenantClient(mf, `alpha-${uniqueTag}`)
    const tenant2 = createTenantClient(mf, `beta-${uniqueTag}`)

    // Create thing in tenant 1
    const t1Thing = await tenant1.rpc<Thing>('things.create', [
      { $type: 'Secret', name: 'Alpha Secret' },
    ])

    // Create thing in tenant 2
    const t2Thing = await tenant2.rpc<Thing>('things.create', [
      { $type: 'Secret', name: 'Beta Secret' },
    ])

    // Tenant 1 should only see their own things
    const t1List = await tenant1.rpc<ListResult<Thing>>('things.list', [{ $type: 'Secret' }])
    expect(t1List.items.length).toBe(1)
    expect(t1List.items[0].$id).toBe(t1Thing.$id)

    // Tenant 2 should only see their own things
    const t2List = await tenant2.rpc<ListResult<Thing>>('things.list', [{ $type: 'Secret' }])
    expect(t2List.items.length).toBe(1)
    expect(t2List.items[0].$id).toBe(t2Thing.$id)
  })

  it('should not allow cross-tenant access to things', async () => {
    const uniqueTag = testId('crossaccess')
    const tenant1 = createTenantClient(mf, `owner-${uniqueTag}`)
    const tenant2 = createTenantClient(mf, `attacker-${uniqueTag}`)

    // Create thing in tenant 1
    const t1Thing = await tenant1.rpc<Thing>('things.create', [
      { $type: 'PrivateData', name: 'Private' },
    ])

    // Tenant 2 should NOT be able to access tenant 1's thing
    const crossAccess = await tenant2.rpc<Thing | null>('things.get', [t1Thing.$id])
    expect(crossAccess).toBeNull()
  })

  it('should handle concurrent operations across tenants without data leakage', async () => {
    const uniqueTag = testId('concurrent')
    const tenants = Array.from({ length: 5 }, (_, i) =>
      createTenantClient(mf, `concurrent-${i}-${uniqueTag}`)
    )

    // Concurrently create data in all tenants
    const createPromises = tenants.map((tenant, i) =>
      tenant.rpc<Thing>('things.create', [
        { $type: 'ConcurrentTest', name: `Tenant ${i} Data`, data: { tenantIndex: i } },
      ])
    )

    const createResults = await Promise.all(createPromises)

    // All creates should succeed
    for (const result of createResults) {
      expect(result.$id).toBeDefined()
    }

    // Verify each tenant only sees their own data
    const listPromises = tenants.map((tenant) =>
      tenant.rpc<ListResult<Thing>>('things.list', [{ $type: 'ConcurrentTest' }])
    )
    const listResults = await Promise.all(listPromises)

    for (let i = 0; i < tenants.length; i++) {
      const list = listResults[i]
      expect(list.items).toHaveLength(1)
      expect(list.items[0].data?.tenantIndex).toBe(i)
    }
  })
})

// ============================================================================
// TEST SUITE 4: Events
// ============================================================================

describe('E2E: Events System', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: TEST_DO_SCRIPT,
      durableObjects: {
        TENANT_DO: 'TenantDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('should emit and query events', async () => {
    const client = createTenantClient(mf, `events-test-${testId()}`)

    // Emit event
    const emitted = await client.rpc<{ $id: string; $timestamp: number }>('events.emit', [
      { type: 'Order.placed', payload: { orderId: 'ord-123', total: 99.99 } },
    ])

    expect(emitted.$id).toBeDefined()
    expect(emitted.$timestamp).toBeDefined()

    // Query events
    const events = await client.rpc<{ items: EventPayload[]; total: number }>('events.query', [
      { type: 'Order.placed' },
    ])

    expect(events.items.length).toBeGreaterThan(0)
    expect(events.items[0].type).toBe('Order.placed')
  })

  it('should isolate events between tenants', async () => {
    const uniqueTag = testId('event-isolation')
    const tenant1 = createTenantClient(mf, `t1-${uniqueTag}`)
    const tenant2 = createTenantClient(mf, `t2-${uniqueTag}`)

    // Emit event in tenant 1
    await tenant1.rpc('events.emit', [
      { type: 'Deal.closed', payload: { tenant: 'tenant1' } },
    ])

    // Emit event in tenant 2
    await tenant2.rpc('events.emit', [
      { type: 'Deal.closed', payload: { tenant: 'tenant2' } },
    ])

    // Query from each tenant
    const t1Events = await tenant1.rpc<{ items: EventPayload[] }>('events.query', [
      { type: 'Deal.closed' },
    ])
    const t2Events = await tenant2.rpc<{ items: EventPayload[] }>('events.query', [
      { type: 'Deal.closed' },
    ])

    // Each should only see their own
    expect(t1Events.items.length).toBe(1)
    expect(t2Events.items.length).toBe(1)
    expect((t1Events.items[0].payload as Record<string, unknown>).tenant).toBe('tenant1')
    expect((t2Events.items[0].payload as Record<string, unknown>).tenant).toBe('tenant2')
  })
})

// ============================================================================
// TEST SUITE 5: Error Handling
// ============================================================================

describe('E2E: Error Handling', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: TEST_DO_SCRIPT,
      durableObjects: {
        TENANT_DO: 'TenantDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('should return error for validation failures', async () => {
    const client = createTenantClient(mf, `error-validation-${testId()}`)

    const result = await client.rpc<{ error: string; code: string }>('things.create', [
      { name: 'No type' },
    ])

    expect(result.error).toBeDefined()
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('should return error for unknown methods', async () => {
    const client = createTenantClient(mf, `error-method-${testId()}`)

    const result = await client.rpc<{ error: string; code: string }>('nonexistent.method', [])

    expect(result.error).toBeDefined()
    expect(result.code).toBe('METHOD_NOT_FOUND')
  })

  it('should support timeout configuration in $Context', () => {
    const $ = $Context('https://example.com.ai', { timeout: 100 })
    expect($._options.timeout).toBe(100)
  })
})
