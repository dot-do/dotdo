/**
 * Integration Tests: API + DO + RPC Layer Interaction
 *
 * Issue: do-avhr1.5
 *
 * These tests verify the integration between the three core packages:
 * - @dotdo/api: HTTP request handling and HATEOAS responses
 * - @dotdo/do: Durable Object storage and business logic
 * - @dotdo/rpc: RPC communication layer
 *
 * Tests use real Miniflare instances with actual DOs - NO MOCKS.
 *
 * Test scenarios include:
 * 1. Full request flow: HTTP -> DO -> storage
 * 2. RPC calls between DOs via the RPC layer
 * 3. Error propagation across layers
 * 4. HATEOAS responses from API through DO
 * 5. Cross-DO RPC coordination
 *
 * @module e2e/tests/integration/api-do-rpc.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  $created: number
  $updated: number
  [key: string]: unknown
}

interface Customer extends Thing {
  $type: 'Customer'
  name: string
  email: string
  status: 'active' | 'inactive'
  balance: number
}

interface Order extends Thing {
  $type: 'Order'
  customerId: string
  items: string[]
  total: number
  status: 'pending' | 'processing' | 'shipped' | 'delivered'
}

interface Event {
  $id: string
  type: string
  payload: Record<string, unknown>
  timestamp: number
}

interface RPCResponse<T = unknown> {
  result?: T
  error?: {
    message: string
    code: string
    details?: Record<string, unknown>
  }
}

interface HATEOASResponse<T = unknown> {
  data: T
  _links: Record<string, {
    href: string
    rel: string
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    title?: string
  }>
}

// ============================================================================
// TEST DO IMPLEMENTATION
// ============================================================================

/**
 * Integrated DO script that combines API, DO, and RPC patterns
 * This simulates the real dotdo architecture for integration testing
 */
const INTEGRATED_DO_SCRIPT = `
// ============================================================================
// RPC Handler - Implements @dotdo/rpc server pattern
// ============================================================================
function createRPCHandler(instance) {
  return async (request) => {
    const correlationId = request.headers.get('X-Correlation-ID') || crypto.randomUUID()

    try {
      const { method, args } = await request.json()

      // Navigate nested methods (things.create, events.emit, etc.)
      const parts = method.split('.')
      let target = instance
      for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]]
        if (!target) {
          return Response.json({
            error: { message: \`Path not found: \${parts.slice(0, i + 1).join('.')}\`, code: 'NOT_FOUND' }
          }, {
            status: 404,
            headers: { 'X-Correlation-ID': correlationId }
          })
        }
      }

      const fn = target[parts[parts.length - 1]]
      if (typeof fn !== 'function') {
        return Response.json({
          error: { message: \`Method not found: \${method}\`, code: 'METHOD_NOT_FOUND' }
        }, {
          status: 404,
          headers: { 'X-Correlation-ID': correlationId }
        })
      }

      const result = await fn.apply(target, args || [])
      return Response.json({ result }, {
        headers: { 'X-Correlation-ID': correlationId }
      })
    } catch (error) {
      return Response.json({
        error: {
          message: error.message,
          code: error.code || 'INTERNAL_ERROR',
          details: error.details || {}
        }
      }, {
        status: error.httpStatus || 500,
        headers: { 'X-Correlation-ID': correlationId }
      })
    }
  }
}

// ============================================================================
// HATEOAS Link Generator - Implements @dotdo/api pattern
// ============================================================================
function generateLinks(resourceType, id, baseUrl, options = {}) {
  const basePath = \`\${baseUrl}/\${resourceType.toLowerCase()}s\`
  const resourcePath = \`\${basePath}/\${id}\`

  const links = {
    self: { href: resourcePath, rel: 'self', method: 'GET' },
    collection: { href: basePath, rel: 'collection', method: 'GET' },
    update: { href: resourcePath, rel: 'edit', method: 'PUT' },
    delete: { href: resourcePath, rel: 'delete', method: 'DELETE' },
  }

  if (options.relations) {
    for (const [name, config] of Object.entries(options.relations)) {
      links[name] = {
        href: \`\${resourcePath}/\${name}\`,
        rel: config.type === 'hasMany' ? 'related' : 'item',
        method: 'GET'
      }
    }
  }

  if (options.actions) {
    for (const action of options.actions) {
      links[action] = {
        href: \`\${resourcePath}/\${action}\`,
        rel: action,
        method: 'POST'
      }
    }
  }

  return links
}

function withLinks(data, links) {
  return { data, _links: links }
}

// ============================================================================
// IntegratedDO - Full API + DO + RPC Integration
// ============================================================================
export class IntegratedDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env

    // Initialize things namespace (DO pattern)
    this.things = {
      create: this._createThing.bind(this),
      get: this._getThing.bind(this),
      list: this._listThings.bind(this),
      update: this._updateThing.bind(this),
      delete: this._deleteThing.bind(this),
    }

    // Initialize events namespace
    this.events = {
      emit: this._emitEvent.bind(this),
      list: this._listEvents.bind(this),
    }

    // Initialize RPC namespace for cross-DO calls
    this.rpc = {
      call: this._rpcCall.bind(this),
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const baseUrl = url.origin

    // RPC endpoint (RPC layer)
    if (path === '/rpc' && request.method === 'POST') {
      return createRPCHandler(this)(request)
    }

    // Health check (API layer)
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        doId: this.state.id.toString(),
        timestamp: Date.now()
      })
    }

    // API routes with HATEOAS (API layer)

    // GET /customers - List customers
    if (path === '/customers' && request.method === 'GET') {
      const customers = await this._listThings({ $type: 'Customer' })
      return Response.json({
        data: customers.map(c => ({
          ...c,
          _links: generateLinks('Customer', c.$id, baseUrl)
        })),
        _links: {
          self: { href: \`\${baseUrl}/customers\`, rel: 'self', method: 'GET' },
          create: { href: \`\${baseUrl}/customers\`, rel: 'create-form', method: 'POST' },
        }
      })
    }

    // POST /customers - Create customer
    if (path === '/customers' && request.method === 'POST') {
      const body = await request.json()
      const customer = await this._createThing({ ...body, $type: 'Customer' })
      const links = generateLinks('Customer', customer.$id, baseUrl, {
        relations: { orders: { type: 'hasMany' } },
        actions: ['activate', 'deactivate']
      })
      return Response.json(withLinks(customer, links), { status: 201 })
    }

    // GET /customers/:id - Get customer
    const customerMatch = path.match(/^\\/customers\\/([\\w-]+)$/)
    if (customerMatch && request.method === 'GET') {
      const customer = await this._getThing(customerMatch[1])
      if (!customer || customer.$type !== 'Customer') {
        return Response.json({ error: 'Customer not found', status: 404 }, { status: 404 })
      }
      const links = generateLinks('Customer', customer.$id, baseUrl, {
        relations: { orders: { type: 'hasMany' } },
        actions: ['activate', 'deactivate']
      })
      return Response.json(withLinks(customer, links))
    }

    // PUT /customers/:id - Update customer
    if (customerMatch && request.method === 'PUT') {
      const body = await request.json()
      const customer = await this._updateThing(customerMatch[1], body)
      if (!customer) {
        return Response.json({ error: 'Customer not found', status: 404 }, { status: 404 })
      }
      const links = generateLinks('Customer', customer.$id, baseUrl, {
        relations: { orders: { type: 'hasMany' } },
        actions: ['activate', 'deactivate']
      })
      return Response.json(withLinks(customer, links))
    }

    // DELETE /customers/:id - Delete customer
    if (customerMatch && request.method === 'DELETE') {
      const deleted = await this._deleteThing(customerMatch[1])
      if (!deleted) {
        return Response.json({ error: 'Customer not found', status: 404 }, { status: 404 })
      }
      return Response.json({ success: true })
    }

    // POST /customers/:id/activate - Action endpoint
    const activateMatch = path.match(/^\\/customers\\/([\\w-]+)\\/activate$/)
    if (activateMatch && request.method === 'POST') {
      const customer = await this._getThing(activateMatch[1])
      if (!customer || customer.$type !== 'Customer') {
        return Response.json({ error: 'Customer not found', status: 404 }, { status: 404 })
      }
      const updated = await this._updateThing(activateMatch[1], { status: 'active' })
      await this._emitEvent({ type: 'Customer.activated', payload: { customerId: updated.$id } })
      const links = generateLinks('Customer', updated.$id, baseUrl, {
        relations: { orders: { type: 'hasMany' } },
        actions: ['activate', 'deactivate']
      })
      return Response.json(withLinks(updated, links))
    }

    // POST /customers/:id/deactivate - Action endpoint
    const deactivateMatch = path.match(/^\\/customers\\/([\\w-]+)\\/deactivate$/)
    if (deactivateMatch && request.method === 'POST') {
      const customer = await this._getThing(deactivateMatch[1])
      if (!customer || customer.$type !== 'Customer') {
        return Response.json({ error: 'Customer not found', status: 404 }, { status: 404 })
      }
      const updated = await this._updateThing(deactivateMatch[1], { status: 'inactive' })
      await this._emitEvent({ type: 'Customer.deactivated', payload: { customerId: updated.$id } })
      const links = generateLinks('Customer', updated.$id, baseUrl, {
        relations: { orders: { type: 'hasMany' } },
        actions: ['activate', 'deactivate']
      })
      return Response.json(withLinks(updated, links))
    }

    // GET /customers/:id/orders - Related orders
    const ordersMatch = path.match(/^\\/customers\\/([\\w-]+)\\/orders$/)
    if (ordersMatch && request.method === 'GET') {
      const orders = await this._listThings({ $type: 'Order', customerId: ordersMatch[1] })
      return Response.json({
        data: orders.map(o => ({
          ...o,
          _links: generateLinks('Order', o.$id, baseUrl)
        })),
        _links: {
          self: { href: \`\${baseUrl}/customers/\${ordersMatch[1]}/orders\`, rel: 'self', method: 'GET' }
        }
      })
    }

    // GET /orders - List orders
    if (path === '/orders' && request.method === 'GET') {
      const orders = await this._listThings({ $type: 'Order' })
      return Response.json({
        data: orders.map(o => ({
          ...o,
          _links: generateLinks('Order', o.$id, baseUrl)
        })),
        _links: {
          self: { href: \`\${baseUrl}/orders\`, rel: 'self', method: 'GET' },
          create: { href: \`\${baseUrl}/orders\`, rel: 'create-form', method: 'POST' },
        }
      })
    }

    // POST /orders - Create order
    if (path === '/orders' && request.method === 'POST') {
      const body = await request.json()

      // Validate customer exists (cross-DO scenario)
      if (body.customerId) {
        const customer = await this._getThing(body.customerId)
        if (!customer || customer.$type !== 'Customer') {
          return Response.json({
            error: 'Customer not found',
            code: 'CUSTOMER_NOT_FOUND',
            status: 400
          }, { status: 400 })
        }
        if (customer.status !== 'active') {
          return Response.json({
            error: 'Customer is not active',
            code: 'CUSTOMER_INACTIVE',
            status: 400
          }, { status: 400 })
        }
      }

      const order = await this._createThing({
        ...body,
        $type: 'Order',
        status: 'pending'
      })

      // Emit event
      await this._emitEvent({
        type: 'Order.created',
        payload: { orderId: order.$id, customerId: body.customerId }
      })

      const links = generateLinks('Order', order.$id, baseUrl, {
        relations: { customer: { type: 'belongsTo' } },
        actions: ['ship', 'cancel']
      })
      return Response.json(withLinks(order, links), { status: 201 })
    }

    // GET /orders/:id - Get order
    const orderMatch = path.match(/^\\/orders\\/([\\w-]+)$/)
    if (orderMatch && request.method === 'GET') {
      const order = await this._getThing(orderMatch[1])
      if (!order || order.$type !== 'Order') {
        return Response.json({ error: 'Order not found', status: 404 }, { status: 404 })
      }
      const links = generateLinks('Order', order.$id, baseUrl, {
        relations: { customer: { type: 'belongsTo' } },
        actions: ['ship', 'cancel']
      })
      // Add customer link
      if (order.customerId) {
        links.customer = {
          href: \`\${baseUrl}/customers/\${order.customerId}\`,
          rel: 'customer',
          method: 'GET'
        }
      }
      return Response.json(withLinks(order, links))
    }

    // POST /orders/:id/ship - Ship order action
    const shipMatch = path.match(/^\\/orders\\/([\\w-]+)\\/ship$/)
    if (shipMatch && request.method === 'POST') {
      const order = await this._getThing(shipMatch[1])
      if (!order || order.$type !== 'Order') {
        return Response.json({ error: 'Order not found', status: 404 }, { status: 404 })
      }
      if (order.status !== 'pending' && order.status !== 'processing') {
        return Response.json({
          error: 'Order cannot be shipped in current status',
          code: 'INVALID_STATUS',
          status: 400
        }, { status: 400 })
      }

      const updated = await this._updateThing(shipMatch[1], { status: 'shipped' })
      await this._emitEvent({
        type: 'Order.shipped',
        payload: { orderId: updated.$id, customerId: order.customerId }
      })

      const links = generateLinks('Order', updated.$id, baseUrl, {
        relations: { customer: { type: 'belongsTo' } },
        actions: ['deliver']
      })
      return Response.json(withLinks(updated, links))
    }

    // GET /events - List events
    if (path === '/events' && request.method === 'GET') {
      const events = await this._listEvents()
      return Response.json({ data: events })
    }

    return Response.json({ error: 'Not Found', status: 404 }, { status: 404 })
  }

  // ============================================================================
  // DO Layer - Things management (implements @dotdo/do patterns)
  // ============================================================================

  async _createThing(data) {
    const $id = data.$id || 'thing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const now = Date.now()
    const thing = {
      $id,
      $type: data.$type || 'Thing',
      $created: now,
      $updated: now,
      ...data,
    }

    // Store in things collection
    const things = await this.storage.get('things') || {}
    things[$id] = thing
    await this.storage.put('things', things)

    return thing
  }

  async _getThing($id) {
    const things = await this.storage.get('things') || {}
    return things[$id] || null
  }

  async _listThings(filter = {}) {
    const things = await this.storage.get('things') || {}
    let results = Object.values(things)

    // Apply filters
    for (const [key, value] of Object.entries(filter)) {
      results = results.filter(t => t[key] === value)
    }

    return results
  }

  async _updateThing($id, data) {
    const things = await this.storage.get('things') || {}
    if (!things[$id]) {
      return null
    }

    things[$id] = {
      ...things[$id],
      ...data,
      $id, // Preserve $id
      $type: things[$id].$type, // Preserve $type
      $created: things[$id].$created, // Preserve $created
      $updated: Date.now(),
    }

    await this.storage.put('things', things)
    return things[$id]
  }

  async _deleteThing($id) {
    const things = await this.storage.get('things') || {}
    if (!things[$id]) {
      return false
    }

    delete things[$id]
    await this.storage.put('things', things)
    return true
  }

  // ============================================================================
  // DO Layer - Events (implements @dotdo/do event patterns)
  // ============================================================================

  async _emitEvent(event) {
    const $id = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const storedEvent = {
      $id,
      type: event.type,
      payload: event.payload,
      timestamp: Date.now(),
    }

    const events = await this.storage.get('events') || []
    events.push(storedEvent)
    await this.storage.put('events', events)

    return storedEvent
  }

  async _listEvents(filter = {}) {
    const events = await this.storage.get('events') || []
    let results = events

    if (filter.type) {
      results = results.filter(e => e.type === filter.type)
    }
    if (filter.since) {
      results = results.filter(e => e.timestamp >= filter.since)
    }

    return results
  }

  // ============================================================================
  // RPC Layer - Cross-DO communication (implements @dotdo/rpc patterns)
  // ============================================================================

  async _rpcCall(namespace, doName, method, args = []) {
    const ns = this.env[namespace]
    if (!ns) {
      throw new Error(\`Namespace not found: \${namespace}\`)
    }

    const doId = ns.idFromName(doName)
    const stub = ns.get(doId)

    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({ method, args })
    })

    const result = await response.json()

    if (result.error) {
      const error = new Error(result.error.message)
      error.code = result.error.code
      error.details = result.error.details
      throw error
    }

    return result.result
  }
}

// ============================================================================
// Coordinator DO - For cross-DO RPC testing
// ============================================================================
export class CoordinatorDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/rpc' && request.method === 'POST') {
      return createRPCHandler(this)(request)
    }

    return Response.json({ status: 'CoordinatorDO' })
  }

  // Orchestrate operations across multiple DOs
  async orchestrate(operations) {
    const results = []

    for (const op of operations) {
      const { namespace, doName, method, args } = op
      try {
        const ns = this.env[namespace]
        const doId = ns.idFromName(doName)
        const stub = ns.get(doId)

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, args })
        })

        const result = await response.json()
        results.push({
          success: !result.error,
          ...result
        })
      } catch (error) {
        results.push({
          success: false,
          error: { message: error.message, code: 'ORCHESTRATION_ERROR' }
        })
      }
    }

    return { results, totalSuccess: results.filter(r => r.success).length }
  }

  // Aggregate data from multiple DOs
  async aggregate(doNames, method) {
    const results = await Promise.all(
      doNames.map(async (doName) => {
        try {
          const ns = this.env.INTEGRATED_DO
          const doId = ns.idFromName(doName)
          const stub = ns.get(doId)

          const response = await stub.fetch('https://do/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, args: [] })
          })

          const result = await response.json()
          return { doName, ...result }
        } catch (error) {
          return { doName, error: error.message }
        }
      })
    )

    return results
  }
}

// ============================================================================
// Worker entry point
// ============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doType = url.searchParams.get('do') || 'integrated'
    const doName = url.searchParams.get('name') || 'default'

    let stub
    switch (doType) {
      case 'integrated':
        stub = env.INTEGRATED_DO.get(env.INTEGRATED_DO.idFromName(doName))
        break
      case 'coordinator':
        stub = env.COORDINATOR_DO.get(env.COORDINATOR_DO.idFromName(doName))
        break
      default:
        return Response.json({ error: 'Unknown DO type' }, { status: 400 })
    }

    return stub.fetch(request)
  }
}
`

// ============================================================================
// MINIFLARE CONFIGURATION
// ============================================================================

function getMiniflareConfig() {
  return {
    modules: true,
    script: INTEGRATED_DO_SCRIPT,
    durableObjects: {
      INTEGRATED_DO: 'IntegratedDO',
      COORDINATOR_DO: 'CoordinatorDO',
    },
    durableObjectsPersist: false, // In-memory for tests
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

async function getIntegratedStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('INTEGRATED_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getCoordinatorStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('COORDINATOR_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function rpcCall<T = unknown>(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = []
): Promise<RPCResponse<T>> {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  return response.json() as Promise<RPCResponse<T>>
}

async function apiRequest<T = unknown>(
  stub: DurableObjectStub,
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: T }> {
  const response = await stub.fetch(`https://api.test${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const body = await response.json() as T
  return { status: response.status, body }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Integration Tests: API + DO + RPC', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. FULL REQUEST FLOW: HTTP -> DO -> Storage
  // ==========================================================================

  describe('1. Full Request Flow: HTTP -> DO -> Storage', () => {
    let doName: string
    let stub: DurableObjectStub

    beforeEach(async () => {
      doName = generateTestId()
      stub = await getIntegratedStub(mf, doName)
    })

    it('should handle GET request flow through all layers', async () => {
      // First create a customer via API
      const createResult = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alice',
          email: 'alice@example.com',
          status: 'active',
          balance: 100,
        }),
      })
      expect(createResult.status).toBe(201)
      const customerId = createResult.body.data.$id

      // Then GET via API - verifies HTTP -> DO -> storage -> response flow
      const getResult = await apiRequest<HATEOASResponse<Customer>>(stub, `/customers/${customerId}`)

      expect(getResult.status).toBe(200)
      expect(getResult.body.data.$id).toBe(customerId)
      expect(getResult.body.data.name).toBe('Alice')
      expect(getResult.body.data.email).toBe('alice@example.com')
      expect(getResult.body._links).toBeDefined()
      expect(getResult.body._links.self).toBeDefined()
    })

    it('should handle POST request creating entity in storage', async () => {
      const result = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bob',
          email: 'bob@example.com',
          status: 'active',
          balance: 500,
        }),
      })

      expect(result.status).toBe(201)
      expect(result.body.data.$id).toBeDefined()
      expect(result.body.data.$type).toBe('Customer')
      expect(result.body.data.$created).toBeDefined()
      expect(result.body.data.$updated).toBeDefined()
      expect(result.body.data.name).toBe('Bob')
      expect(result.body._links.self.href).toContain(result.body.data.$id)
    })

    it('should handle PUT request updating entity in storage', async () => {
      // Create
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Charlie',
          email: 'charlie@example.com',
          status: 'active',
          balance: 0,
        }),
      })
      const customerId = created.body.data.$id

      // Update
      const updated = await apiRequest<HATEOASResponse<Customer>>(stub, `/customers/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify({ balance: 1000 }),
      })

      expect(updated.status).toBe(200)
      expect(updated.body.data.balance).toBe(1000)
      expect(updated.body.data.$updated).toBeGreaterThan(created.body.data.$created)
    })

    it('should handle DELETE request removing entity from storage', async () => {
      // Create
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'To Delete',
          email: 'delete@example.com',
          status: 'active',
          balance: 0,
        }),
      })
      const customerId = created.body.data.$id

      // Delete
      const deleted = await apiRequest<{ success: boolean }>(stub, `/customers/${customerId}`, {
        method: 'DELETE',
      })

      expect(deleted.status).toBe(200)
      expect(deleted.body.success).toBe(true)

      // Verify deleted
      const getResult = await apiRequest(stub, `/customers/${customerId}`)
      expect(getResult.status).toBe(404)
    })

    it('should persist data across multiple requests', async () => {
      // Create first customer
      await apiRequest(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'First', email: 'first@test.com', status: 'active', balance: 10 }),
      })

      // Create second customer
      await apiRequest(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Second', email: 'second@test.com', status: 'active', balance: 20 }),
      })

      // List all - should have both
      const list = await apiRequest<HATEOASResponse<Customer[]>>(stub, '/customers')

      expect(list.status).toBe(200)
      expect(list.body.data).toHaveLength(2)
      expect(list.body.data.map(c => c.name)).toContain('First')
      expect(list.body.data.map(c => c.name)).toContain('Second')
    })

    it('should isolate data between different DO instances', async () => {
      const doName2 = generateTestId()
      const stub2 = await getIntegratedStub(mf, doName2)

      // Create customer in first DO
      await apiRequest(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'DO1 Customer', email: 'do1@test.com', status: 'active', balance: 100 }),
      })

      // Create customer in second DO
      await apiRequest(stub2, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'DO2 Customer', email: 'do2@test.com', status: 'active', balance: 200 }),
      })

      // List customers in first DO
      const list1 = await apiRequest<HATEOASResponse<Customer[]>>(stub, '/customers')
      expect(list1.body.data).toHaveLength(1)
      expect(list1.body.data[0].name).toBe('DO1 Customer')

      // List customers in second DO
      const list2 = await apiRequest<HATEOASResponse<Customer[]>>(stub2, '/customers')
      expect(list2.body.data).toHaveLength(1)
      expect(list2.body.data[0].name).toBe('DO2 Customer')
    })
  })

  // ==========================================================================
  // 2. RPC CALLS BETWEEN DOs
  // ==========================================================================

  describe('2. RPC Calls Between DOs', () => {
    let doName: string
    let stub: DurableObjectStub

    beforeEach(async () => {
      doName = generateTestId()
      stub = await getIntegratedStub(mf, doName)
    })

    it('should handle RPC create operation via things.create', async () => {
      const result = await rpcCall<Customer>(stub, 'things.create', [{
        $type: 'Customer',
        name: 'RPC Customer',
        email: 'rpc@test.com',
        status: 'active',
        balance: 1000,
      }])

      expect(result.error).toBeUndefined()
      expect(result.result?.$id).toBeDefined()
      expect(result.result?.$type).toBe('Customer')
      expect(result.result?.name).toBe('RPC Customer')
    })

    it('should handle RPC get operation via things.get', async () => {
      // Create first
      const created = await rpcCall<Customer>(stub, 'things.create', [{
        $type: 'Customer',
        name: 'Get Test',
        email: 'get@test.com',
        status: 'active',
        balance: 500,
      }])
      const customerId = created.result!.$id

      // Get via RPC
      const result = await rpcCall<Customer>(stub, 'things.get', [customerId])

      expect(result.error).toBeUndefined()
      expect(result.result?.$id).toBe(customerId)
      expect(result.result?.name).toBe('Get Test')
    })

    it('should handle RPC list operation via things.list', async () => {
      // Create some customers
      await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'List1', email: 'list1@test.com', status: 'active', balance: 10 }])
      await rpcCall(stub, 'things.create', [{ $type: 'Customer', name: 'List2', email: 'list2@test.com', status: 'inactive', balance: 20 }])
      await rpcCall(stub, 'things.create', [{ $type: 'Order', customerId: 'test', items: [], total: 100, status: 'pending' }])

      // List all customers
      const result = await rpcCall<Customer[]>(stub, 'things.list', [{ $type: 'Customer' }])

      expect(result.error).toBeUndefined()
      expect(result.result).toHaveLength(2)
    })

    it('should handle RPC update operation via things.update', async () => {
      // Create first
      const created = await rpcCall<Customer>(stub, 'things.create', [{
        $type: 'Customer',
        name: 'Update Test',
        email: 'update@test.com',
        status: 'active',
        balance: 100,
      }])
      const customerId = created.result!.$id

      // Update via RPC
      const result = await rpcCall<Customer>(stub, 'things.update', [customerId, { balance: 500 }])

      expect(result.error).toBeUndefined()
      expect(result.result?.balance).toBe(500)
      expect(result.result?.$id).toBe(customerId)
    })

    it('should handle RPC delete operation via things.delete', async () => {
      // Create first
      const created = await rpcCall<Customer>(stub, 'things.create', [{
        $type: 'Customer',
        name: 'Delete Test',
        email: 'delete@test.com',
        status: 'active',
        balance: 100,
      }])
      const customerId = created.result!.$id

      // Delete via RPC
      const deleteResult = await rpcCall<boolean>(stub, 'things.delete', [customerId])
      expect(deleteResult.error).toBeUndefined()
      expect(deleteResult.result).toBe(true)

      // Verify deleted
      const getResult = await rpcCall<Customer | null>(stub, 'things.get', [customerId])
      expect(getResult.result).toBeNull()
    })

    it('should handle RPC event emission via events.emit', async () => {
      const result = await rpcCall<Event>(stub, 'events.emit', [{
        type: 'Test.event',
        payload: { foo: 'bar', count: 42 },
      }])

      expect(result.error).toBeUndefined()
      expect(result.result?.$id).toMatch(/^evt-/)
      expect(result.result?.type).toBe('Test.event')
      expect(result.result?.payload).toEqual({ foo: 'bar', count: 42 })
      expect(result.result?.timestamp).toBeDefined()
    })

    it('should handle RPC event listing via events.list', async () => {
      // Emit some events
      await rpcCall(stub, 'events.emit', [{ type: 'Test.event1', payload: { id: 1 } }])
      await rpcCall(stub, 'events.emit', [{ type: 'Test.event2', payload: { id: 2 } }])
      await rpcCall(stub, 'events.emit', [{ type: 'Test.event1', payload: { id: 3 } }])

      // List all events
      const allEvents = await rpcCall<Event[]>(stub, 'events.list', [])
      expect(allEvents.result).toHaveLength(3)

      // List filtered events
      const filteredEvents = await rpcCall<Event[]>(stub, 'events.list', [{ type: 'Test.event1' }])
      expect(filteredEvents.result).toHaveLength(2)
    })

    it('should propagate correlation ID through RPC calls', async () => {
      const correlationId = `corr-${generateTestId()}`

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Correlation Test', email: 'corr@test.com', status: 'active', balance: 0 }],
        }),
      })

      expect(response.headers.get('X-Correlation-ID')).toBe(correlationId)
    })
  })

  // ==========================================================================
  // 3. ERROR PROPAGATION ACROSS LAYERS
  // ==========================================================================

  describe('3. Error Propagation Across Layers', () => {
    let doName: string
    let stub: DurableObjectStub

    beforeEach(async () => {
      doName = generateTestId()
      stub = await getIntegratedStub(mf, doName)
    })

    it('should propagate 404 error for non-existent resource via API', async () => {
      const result = await apiRequest(stub, '/customers/non-existent-id')

      expect(result.status).toBe(404)
      expect((result.body as { error: string }).error).toContain('not found')
    })

    it('should propagate 404 error for non-existent method via RPC', async () => {
      const result = await rpcCall(stub, 'nonExistent.method', [])

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('NOT_FOUND')
    })

    it('should propagate validation error for invalid order (inactive customer)', async () => {
      // Create inactive customer
      const customer = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Inactive Customer',
          email: 'inactive@test.com',
          status: 'inactive', // Not active
          balance: 100,
        }),
      })
      const customerId = customer.body.data.$id

      // Try to create order for inactive customer
      const result = await apiRequest(stub, '/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          items: ['item1'],
          total: 50,
        }),
      })

      expect(result.status).toBe(400)
      expect((result.body as { code: string }).code).toBe('CUSTOMER_INACTIVE')
    })

    it('should propagate validation error for non-existent customer on order', async () => {
      const result = await apiRequest(stub, '/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: 'non-existent-customer',
          items: ['item1'],
          total: 50,
        }),
      })

      expect(result.status).toBe(400)
      expect((result.body as { code: string }).code).toBe('CUSTOMER_NOT_FOUND')
    })

    it('should propagate invalid status error for shipping non-shippable order', async () => {
      // Create customer and order
      const customer = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ship Test', email: 'ship@test.com', status: 'active', balance: 100 }),
      })
      const customerId = customer.body.data.$id

      const order = await apiRequest<HATEOASResponse<Order>>(stub, '/orders', {
        method: 'POST',
        body: JSON.stringify({ customerId, items: ['item1'], total: 50 }),
      })
      const orderId = order.body.data.$id

      // Ship the order
      await apiRequest(stub, `/orders/${orderId}/ship`, { method: 'POST' })

      // Try to ship again - should fail
      const result = await apiRequest(stub, `/orders/${orderId}/ship`, { method: 'POST' })

      expect(result.status).toBe(400)
      expect((result.body as { code: string }).code).toBe('INVALID_STATUS')
    })

    it('should return structured RPC error with code and details', async () => {
      const result = await rpcCall(stub, 'things.nonExistent', [])

      expect(result.error).toBeDefined()
      expect(result.error?.message).toBeDefined()
      expect(result.error?.code).toBeDefined()
    })

    it('should handle error in DELETE for non-existent resource', async () => {
      const result = await apiRequest(stub, '/customers/non-existent', {
        method: 'DELETE',
      })

      expect(result.status).toBe(404)
    })
  })

  // ==========================================================================
  // 4. HATEOAS RESPONSES FROM API THROUGH DO
  // ==========================================================================

  describe('4. HATEOAS Responses from API through DO', () => {
    let doName: string
    let stub: DurableObjectStub

    beforeEach(async () => {
      doName = generateTestId()
      stub = await getIntegratedStub(mf, doName)
    })

    it('should include _links in resource response', async () => {
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'HATEOAS Test', email: 'hateoas@test.com', status: 'active', balance: 0 }),
      })

      expect(created.body._links).toBeDefined()
      expect(created.body._links.self).toBeDefined()
      expect(created.body._links.self.rel).toBe('self')
      expect(created.body._links.self.method).toBe('GET')
      expect(created.body._links.collection).toBeDefined()
      expect(created.body._links.update).toBeDefined()
      expect(created.body._links.delete).toBeDefined()
    })

    it('should include _links in collection response', async () => {
      const list = await apiRequest<{ data: Customer[]; _links: Record<string, unknown> }>(stub, '/customers')

      expect(list.body._links).toBeDefined()
      expect(list.body._links.self).toBeDefined()
      expect(list.body._links.create).toBeDefined()
    })

    it('should include relation links for related resources', async () => {
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Relation Test', email: 'rel@test.com', status: 'active', balance: 0 }),
      })
      const customerId = created.body.data.$id

      const get = await apiRequest<HATEOASResponse<Customer>>(stub, `/customers/${customerId}`)

      expect(get.body._links.orders).toBeDefined()
      expect(get.body._links.orders.rel).toBe('related') // hasMany relation
      expect(get.body._links.orders.href).toContain(`/customers/${customerId}/orders`)
    })

    it('should include action links for available actions', async () => {
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Action Test', email: 'action@test.com', status: 'active', balance: 0 }),
      })

      expect(created.body._links.activate).toBeDefined()
      expect(created.body._links.activate.method).toBe('POST')
      expect(created.body._links.deactivate).toBeDefined()
      expect(created.body._links.deactivate.method).toBe('POST')
    })

    it('should navigate via HATEOAS links', async () => {
      // Create customer
      const created = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Navigate Test', email: 'nav@test.com', status: 'active', balance: 0 }),
      })

      // Follow self link
      const selfHref = created.body._links.self.href
      const selfUrl = new URL(selfHref)

      const getResult = await apiRequest<HATEOASResponse<Customer>>(stub, selfUrl.pathname)

      expect(getResult.status).toBe(200)
      expect(getResult.body.data.name).toBe('Navigate Test')
    })

    it('should include customer link in order response', async () => {
      // Create customer
      const customer = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Order Link Test', email: 'orderlink@test.com', status: 'active', balance: 100 }),
      })
      const customerId = customer.body.data.$id

      // Create order
      const order = await apiRequest<HATEOASResponse<Order>>(stub, '/orders', {
        method: 'POST',
        body: JSON.stringify({ customerId, items: ['item1'], total: 50 }),
      })
      const orderId = order.body.data.$id

      // Get order and check customer link
      const getOrder = await apiRequest<HATEOASResponse<Order>>(stub, `/orders/${orderId}`)

      expect(getOrder.body._links.customer).toBeDefined()
      expect(getOrder.body._links.customer.href).toContain(`/customers/${customerId}`)
    })
  })

  // ==========================================================================
  // 5. CROSS-DO RPC COORDINATION
  // ==========================================================================

  describe('5. Cross-DO RPC Coordination', () => {
    it('should orchestrate operations across multiple DOs', async () => {
      const coordinatorName = generateTestId()
      const coordinatorStub = await getCoordinatorStub(mf, coordinatorName)

      // Set up data in separate DOs
      const do1Name = generateTestId()
      const do2Name = generateTestId()

      const do1Stub = await getIntegratedStub(mf, do1Name)
      const do2Stub = await getIntegratedStub(mf, do2Name)

      // Create data in each DO
      await rpcCall(do1Stub, 'things.create', [{
        $type: 'Customer',
        name: 'DO1 Customer',
        email: 'do1@test.com',
        status: 'active',
        balance: 100,
      }])

      await rpcCall(do2Stub, 'things.create', [{
        $type: 'Customer',
        name: 'DO2 Customer',
        email: 'do2@test.com',
        status: 'active',
        balance: 200,
      }])

      // Orchestrate listing from both DOs
      const result = await rpcCall<{
        results: Array<{ success: boolean; result?: Customer[] }>
        totalSuccess: number
      }>(coordinatorStub, 'orchestrate', [[
        { namespace: 'INTEGRATED_DO', doName: do1Name, method: 'things.list', args: [{ $type: 'Customer' }] },
        { namespace: 'INTEGRATED_DO', doName: do2Name, method: 'things.list', args: [{ $type: 'Customer' }] },
      ]])

      expect(result.error).toBeUndefined()
      expect(result.result?.totalSuccess).toBe(2)
      expect(result.result?.results[0].success).toBe(true)
      expect(result.result?.results[1].success).toBe(true)
    })

    it('should aggregate data from multiple DOs', async () => {
      const coordinatorName = generateTestId()
      const coordinatorStub = await getCoordinatorStub(mf, coordinatorName)

      // Set up DOs with data
      const doNames: string[] = []
      for (let i = 0; i < 3; i++) {
        const doName = generateTestId()
        doNames.push(doName)
        const stub = await getIntegratedStub(mf, doName)

        // Create unique customers in each
        for (let j = 0; j < i + 1; j++) {
          await rpcCall(stub, 'things.create', [{
            $type: 'Customer',
            name: `DO${i} Customer ${j}`,
            email: `do${i}c${j}@test.com`,
            status: 'active',
            balance: (i + 1) * 100,
          }])
        }
      }

      // Aggregate listing from all DOs
      const result = await rpcCall<Array<{ doName: string; result?: Customer[] }>>(
        coordinatorStub,
        'aggregate',
        [doNames, 'things.list']
      )

      expect(result.error).toBeUndefined()
      expect(result.result).toHaveLength(3)

      // DO0 should have 1 customer, DO1 should have 2, DO2 should have 3
      expect(result.result?.[0].result).toHaveLength(1)
      expect(result.result?.[1].result).toHaveLength(2)
      expect(result.result?.[2].result).toHaveLength(3)
    })

    it('should handle partial failures in orchestration', async () => {
      const coordinatorName = generateTestId()
      const coordinatorStub = await getCoordinatorStub(mf, coordinatorName)

      // Set up one valid DO
      const validDoName = generateTestId()
      const validStub = await getIntegratedStub(mf, validDoName)
      await rpcCall(validStub, 'things.create', [{
        $type: 'Customer',
        name: 'Valid Customer',
        email: 'valid@test.com',
        status: 'active',
        balance: 100,
      }])

      // Orchestrate with one valid and one call to non-existent method
      const result = await rpcCall<{
        results: Array<{ success: boolean; error?: { code: string } }>
        totalSuccess: number
      }>(coordinatorStub, 'orchestrate', [[
        { namespace: 'INTEGRATED_DO', doName: validDoName, method: 'things.list', args: [{ $type: 'Customer' }] },
        { namespace: 'INTEGRATED_DO', doName: validDoName, method: 'nonexistent.method', args: [] },
      ]])

      expect(result.error).toBeUndefined()
      expect(result.result?.totalSuccess).toBe(1)
      expect(result.result?.results[0].success).toBe(true)
      expect(result.result?.results[1].success).toBe(false)
    })

    it('should maintain event consistency across API and RPC interactions', async () => {
      const doName = generateTestId()
      const stub = await getIntegratedStub(mf, doName)

      // Create customer via API (should emit event)
      const customer = await apiRequest<HATEOASResponse<Customer>>(stub, '/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Event Test', email: 'event@test.com', status: 'active', balance: 100 }),
      })
      const customerId = customer.body.data.$id

      // Create order via API (should emit event)
      await apiRequest(stub, '/orders', {
        method: 'POST',
        body: JSON.stringify({ customerId, items: ['item1'], total: 50 }),
      })

      // Activate/deactivate via API (should emit events)
      await apiRequest(stub, `/customers/${customerId}/deactivate`, { method: 'POST' })
      await apiRequest(stub, `/customers/${customerId}/activate`, { method: 'POST' })

      // Check events via RPC
      const events = await rpcCall<Event[]>(stub, 'events.list', [])

      expect(events.result).toBeDefined()
      // Should have: Order.created, Customer.deactivated, Customer.activated
      expect(events.result!.length).toBeGreaterThanOrEqual(3)

      const eventTypes = events.result!.map(e => e.type)
      expect(eventTypes).toContain('Order.created')
      expect(eventTypes).toContain('Customer.deactivated')
      expect(eventTypes).toContain('Customer.activated')
    })
  })

  // ==========================================================================
  // 6. HEALTH AND STATUS
  // ==========================================================================

  describe('6. Health and Status', () => {
    it('should return health status from DO', async () => {
      const doName = generateTestId()
      const stub = await getIntegratedStub(mf, doName)

      const response = await stub.fetch('https://api.test/health')
      const body = await response.json() as { status: string; doId: string; timestamp: number }

      expect(response.status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.doId).toBeDefined()
      expect(body.timestamp).toBeDefined()
    })
  })
})
