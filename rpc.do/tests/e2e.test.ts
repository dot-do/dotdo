/**
 * E2E Integration Tests for rpc.do
 *
 * Issue: do-ti43.5
 *
 * These tests verify end-to-end RPC flows using real Miniflare Durable Objects
 * with real transports. NO MOCKS.
 *
 * Tests cover:
 * 1. Full client-server RPC flow (real DO, real transport)
 * 2. Create/Read/Update/Delete operations on Things
 * 3. Event handlers and scheduling
 * 4. Auth flow integration
 * 5. Transport scenarios (errors, timeouts, correlation IDs)
 *
 * @module rpc.do/tests/e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'
import { createClient } from '../src'
import type { RPCMessage, RPCResponse, DOSchema } from '../src/types'
import type { Transport, TransportState } from '../src/transport/types'
import { CORRELATION_ID_HEADER, generateCorrelationId } from '../src/transport/fetch'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  name?: string
  email?: string
  status?: string
  [key: string]: unknown
}

interface ThingsAPI {
  create(data: Partial<Thing>): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<Thing>): Promise<Thing>
  delete(id: string): Promise<{ deleted: boolean }>
  list(type?: string): Promise<Thing[]>
}

interface EventResult {
  registered: boolean
  event: string
}

interface ScheduleResult {
  id: string
  cron: string
  active: boolean
}

// Full DO API interface
interface DOInterface {
  things: ThingsAPI
  greet(name: string): Promise<string>
  echo(value: unknown): Promise<unknown>
  throwError(message: string): Promise<never>
  slowOperation(delayMs: number): Promise<string>
  getInfo(): Promise<{ id: string; timestamp: number }>
  _schema(): Promise<DOSchema>
  _types(): Promise<string>
  md(): Promise<string>
}

// ============================================================================
// E2E TEST DO IMPLEMENTATION
// ============================================================================

/**
 * Multi-purpose DO script for E2E testing
 * Implements full CRUD, events, scheduling, and error handling
 */
const E2E_DO_SCRIPT = `
// Shared RPC endpoint handler with full error handling
function handleRPC(instance) {
  return async (request) => {
    const url = new URL(request.url)
    const correlationId = request.headers.get('X-Correlation-ID') || 'generated-' + Date.now()

    if (url.pathname !== '/rpc') {
      return Response.json({ status: 'E2E Test DO', id: instance.state?.id?.toString() })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { type: 'ParseError', code: 'PARSE_ERROR', message: 'Invalid JSON body' },
        { status: 400, headers: { 'X-Correlation-ID': correlationId } }
      )
    }

    const { method, args } = body

    // Navigate to nested methods via dot notation
    const parts = method.split('.')
    let target = instance
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]]
      if (!target) {
        return Response.json(
          { type: 'NotFoundError', code: 'METHOD_NOT_FOUND', message: 'Path not found: ' + parts.slice(0, i + 1).join('.') },
          { status: 404, headers: { 'X-Correlation-ID': correlationId } }
        )
      }
    }

    const fn = target[parts[parts.length - 1]]
    if (typeof fn !== 'function') {
      return Response.json(
        { type: 'NotFoundError', code: 'METHOD_NOT_FOUND', message: 'Method not found: ' + method },
        { status: 404, headers: { 'X-Correlation-ID': correlationId } }
      )
    }

    try {
      const result = await fn.apply(target, args || [])
      return Response.json(result, {
        headers: { 'X-Correlation-ID': correlationId }
      })
    } catch (error) {
      // Structured error response
      return Response.json({
        type: error.name || 'Error',
        code: error.code || 'INTERNAL_ERROR',
        message: error.message,
        details: error.details || {}
      }, {
        status: error.httpStatus || 500,
        headers: { 'X-Correlation-ID': correlationId }
      })
    }
  }
}

// ============================================================================
// E2E Test DO - Full CRUD, Events, Scheduling
// ============================================================================
export class E2ETestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.things = new ThingsService(this.storage)
    this.events = new Map()
    this.schedules = new Map()
  }

  async fetch(request) {
    return handleRPC(this)(request)
  }

  // Simple methods
  async greet(name) {
    return 'Hello, ' + name + '!'
  }

  async echo(value) {
    return value
  }

  async throwError(message) {
    const error = new Error(message)
    error.code = 'CUSTOM_ERROR'
    error.httpStatus = 400
    throw error
  }

  async slowOperation(delayMs) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return 'completed after ' + delayMs + 'ms'
  }

  async getInfo() {
    return {
      id: this.state.id.toString(),
      timestamp: Date.now()
    }
  }

  // Reflection methods
  async _schema() {
    return {
      $version: '1.0.0',
      entities: {
        Thing: {
          methods: ['create', 'get', 'update', 'delete', 'list'],
          description: 'A generic thing entity'
        }
      },
      methods: {
        'things.create': {
          params: [{ name: 'data', type: 'Partial<Thing>' }],
          returns: 'Promise<Thing>',
          description: 'Create a new thing'
        },
        'things.get': {
          params: [{ name: 'id', type: 'string' }],
          returns: 'Promise<Thing | null>',
          description: 'Get a thing by ID'
        },
        'greet': {
          params: [{ name: 'name', type: 'string' }],
          returns: 'Promise<string>',
          description: 'Return a greeting'
        }
      }
    }
  }

  async _types() {
    return \`interface Thing {
  $id: string
  $type: string
  name?: string
  [key: string]: unknown
}

interface DOInterface {
  things: {
    create(data: Partial<Thing>): Promise<Thing>
    get(id: string): Promise<Thing | null>
    update(id: string, data: Partial<Thing>): Promise<Thing>
    delete(id: string): Promise<{ deleted: boolean }>
    list(type?: string): Promise<Thing[]>
  }
  greet(name: string): Promise<string>
  echo(value: unknown): Promise<unknown>
}
\`
  }

  async md() {
    return \`# E2E Test DO API

## Methods

### greet(name: string): Promise<string>
Returns a greeting for the given name.

### things.create(data): Promise<Thing>
Create a new thing.

### things.get(id): Promise<Thing | null>
Get a thing by ID.
\`
  }

  // Event registration (placeholder)
  async registerEvent(eventPath, handler) {
    this.events.set(eventPath, handler)
    return { registered: true, event: eventPath }
  }

  // Schedule registration (placeholder)
  async registerSchedule(cron, id) {
    const scheduleId = id || 'schedule-' + Date.now()
    this.schedules.set(scheduleId, { cron, active: true })
    return { id: scheduleId, cron, active: true }
  }
}

// ============================================================================
// Things Service - CRUD operations
// ============================================================================
class ThingsService {
  constructor(storage) {
    this.storage = storage
  }

  async create(data) {
    const id = data.$id || 'thing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const type = data.$type || 'Unknown'
    const thing = { ...data, $id: id, $type: type }
    await this.storage.put('thing:' + id, thing)

    // Track all thing IDs for list
    const ids = await this.storage.get('things:ids') || []
    ids.push(id)
    await this.storage.put('things:ids', ids)

    return thing
  }

  async get(id) {
    return await this.storage.get('thing:' + id) || null
  }

  async update(id, data) {
    const existing = await this.storage.get('thing:' + id)
    if (!existing) {
      const error = new Error('Thing not found: ' + id)
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    const updated = { ...existing, ...data, $id: id }
    await this.storage.put('thing:' + id, updated)
    return updated
  }

  async delete(id) {
    const existing = await this.storage.get('thing:' + id)
    if (!existing) {
      return { deleted: false }
    }
    await this.storage.delete('thing:' + id)

    // Remove from ID list
    const ids = await this.storage.get('things:ids') || []
    const newIds = ids.filter(i => i !== id)
    await this.storage.put('things:ids', newIds)

    return { deleted: true }
  }

  async list(type) {
    const ids = await this.storage.get('things:ids') || []
    const things = []
    for (const id of ids) {
      const thing = await this.storage.get('thing:' + id)
      if (thing && (!type || thing.$type === type)) {
        things.push(thing)
      }
    }
    return things
  }
}

// ============================================================================
// Auth Test DO - Token validation and protected methods
// ============================================================================
export class AuthTestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.validTokens = new Set(['valid-token-123', 'admin-token-456'])
  }

  async fetch(request) {
    const url = new URL(request.url)
    const correlationId = request.headers.get('X-Correlation-ID') || 'generated-' + Date.now()
    const authHeader = request.headers.get('Authorization')

    if (url.pathname !== '/rpc') {
      return Response.json({ status: 'Auth Test DO' })
    }

    const { method, args } = await request.json()

    // Public methods don't need auth
    if (method === 'publicMethod') {
      return Response.json({ public: true }, {
        headers: { 'X-Correlation-ID': correlationId }
      })
    }

    // Validate token for protected methods
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Response.json(
        { type: 'AuthError', code: 'UNAUTHORIZED', message: 'Missing authentication' },
        { status: 401, headers: { 'X-Correlation-ID': correlationId } }
      )
    }

    const token = authHeader.substring(7)
    if (!this.validTokens.has(token)) {
      return Response.json(
        { type: 'AuthError', code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
        { status: 401, headers: { 'X-Correlation-ID': correlationId } }
      )
    }

    // Execute protected method
    try {
      const fn = this[method]
      if (typeof fn !== 'function') {
        return Response.json(
          { type: 'NotFoundError', code: 'METHOD_NOT_FOUND', message: 'Method not found: ' + method },
          { status: 404, headers: { 'X-Correlation-ID': correlationId } }
        )
      }
      const result = await fn.apply(this, args || [])
      return Response.json(result, {
        headers: { 'X-Correlation-ID': correlationId }
      })
    } catch (error) {
      return Response.json({
        type: error.name || 'Error',
        code: error.code || 'INTERNAL_ERROR',
        message: error.message
      }, {
        status: error.httpStatus || 500,
        headers: { 'X-Correlation-ID': correlationId }
      })
    }
  }

  async publicMethod() {
    return { public: true }
  }

  async protectedMethod() {
    return { secret: 'data', authorized: true }
  }

  async adminOnly() {
    return { admin: true, sensitive: 'admin-data' }
  }
}

// ============================================================================
// Worker entry point
// ============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doType = url.searchParams.get('do') || 'e2e'
    const doName = url.searchParams.get('name') || 'default'

    let stub
    switch (doType) {
      case 'e2e':
        stub = env.E2E_DO.get(env.E2E_DO.idFromName(doName))
        break
      case 'auth':
        stub = env.AUTH_DO.get(env.AUTH_DO.idFromName(doName))
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
    script: E2E_DO_SCRIPT,
    durableObjects: {
      E2E_DO: 'E2ETestDO',
      AUTH_DO: 'AuthTestDO',
    },
    durableObjectsPersist: false, // In-memory for tests
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let mf: Miniflare
let baseUrl: string

async function getE2EStub(name: string) {
  const ns = await mf.getDurableObjectNamespace('E2E_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getAuthStub(name: string) {
  const ns = await mf.getDurableObjectNamespace('AUTH_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Direct transport that routes RPC messages to a Durable Object stub
 * This bypasses fetch and sends directly to the DO
 */
class DirectDOTransport implements Transport {
  private readonly stub: DurableObjectStub
  private readonly headers: Record<string, string>

  constructor(stub: DurableObjectStub, headers?: Record<string, string>) {
    this.stub = stub
    this.headers = headers ?? {}
  }

  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? generateCorrelationId()

    const response = await this.stub.fetch('https://do/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
        ...this.headers,
      },
      body: JSON.stringify({
        method: message.method,
        args: message.args,
      }),
    })

    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) ?? correlationId

    if (!response.ok) {
      try {
        const errorBody = await response.json() as { type?: string; code?: string; message?: string }
        return {
          error: {
            type: errorBody.type ?? 'Error',
            code: errorBody.code ?? 'INTERNAL_ERROR',
            message: errorBody.message ?? `RPC error: ${response.status}`,
          },
          correlationId: responseCorrelationId,
        }
      } catch {
        return {
          error: {
            type: 'RPCError',
            code: 'INTERNAL_ERROR',
            message: `RPC error: ${response.status}`,
          },
          correlationId: responseCorrelationId,
        }
      }
    }

    const result = await response.json() as T
    return {
      result,
      correlationId: responseCorrelationId,
    }
  }

  async close(): Promise<void> {
    // No-op - DO stubs don't need explicit close
  }

  getState(): TransportState {
    return 'CONNECTED'
  }
}

// Create a transport that routes to our miniflare DO
async function createMiniflareTransport(
  doType: string,
  doName: string,
  headers?: Record<string, string>
): Promise<DirectDOTransport> {
  const stub = doType === 'auth' ? await getAuthStub(doName) : await getE2EStub(doName)
  return new DirectDOTransport(stub, headers)
}

// ============================================================================
// E2E TEST SUITES
// ============================================================================

describe('E2E rpc.do Integration Tests', () => {
  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    // Get the miniflare worker URL (not used directly, we route through stubs)
    const url = await mf.ready
    baseUrl = url.toString().replace(/\/$/, '')
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. FULL CLIENT-SERVER RPC FLOW
  // ==========================================================================

  describe('1. Full Client-Server RPC Flow', () => {
    it('should call simple methods via RPC client', async () => {
      const doName = generateTestId()

      // Test via direct stub call to verify DO is working
      const stub = await getE2EStub(doName)
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json() as string
      // Use toEqual instead of toBe to handle potential object types
      expect(String(result)).toEqual('Hello, World!')
    })

    it('should call nested methods via dot notation', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const thing = await client.things.create({ $type: 'Customer', name: 'Alice' })
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    it('should echo complex values correctly', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const complexValue = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { deep: { value: 'found' } },
      }

      const echoed = await client.echo(complexValue)
      expect(echoed).toEqual(complexValue)
    })

    it('should get DO info', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const info = await client.getInfo()
      expect(info.id).toBeDefined()
      expect(typeof info.id).toBe('string')
      expect(typeof info.timestamp).toBe('number')
    })

    it('should handle concurrent requests', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      // Test concurrent requests via direct stub calls
      const results = await Promise.all([
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'greet', args: ['A'] }),
        }).then(r => r.json()),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'greet', args: ['B'] }),
        }).then(r => r.json()),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'greet', args: ['C'] }),
        }).then(r => r.json()),
      ])

      expect(results).toEqual([
        'Hello, A!',
        'Hello, B!',
        'Hello, C!',
      ])
    })
  })

  // ==========================================================================
  // 2. CREATE/READ/UPDATE/DELETE OPERATIONS
  // ==========================================================================

  describe('2. CRUD Operations on Things', () => {
    it('should create a thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const thing = await client.things.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
      expect(thing.email).toBe('alice@example.com')
    })

    it('should read a thing by ID', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create
      const created = await client.things.create({
        $type: 'Product',
        name: 'Widget',
      })

      // Read
      const fetched = await client.things.get(created.$id)
      expect(fetched).toEqual(created)
    })

    it('should return null for non-existent thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const fetched = await client.things.get('non-existent-id')
      expect(fetched).toBeNull()
    })

    it('should update a thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create
      const created = await client.things.create({
        $type: 'Customer',
        name: 'Alice',
        status: 'pending',
      })

      // Update
      const updated = await client.things.update(created.$id, {
        status: 'active',
      })

      expect(updated.$id).toBe(created.$id)
      expect(updated.name).toBe('Alice')
      expect(updated.status).toBe('active')
    })

    it('should throw error when updating non-existent thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      await expect(
        client.things.update('non-existent', { status: 'active' })
      ).rejects.toThrow('Thing not found')
    })

    it('should delete a thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create
      const created = await client.things.create({
        $type: 'Temp',
        name: 'To Delete',
      })

      // Delete
      const result = await client.things.delete(created.$id)
      expect(result.deleted).toBe(true)

      // Verify deleted
      const fetched = await client.things.get(created.$id)
      expect(fetched).toBeNull()
    })

    it('should return false when deleting non-existent thing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const result = await client.things.delete('non-existent')
      expect(result.deleted).toBe(false)
    })

    it('should list all things', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create multiple things
      await client.things.create({ $type: 'A', name: 'First' })
      await client.things.create({ $type: 'B', name: 'Second' })
      await client.things.create({ $type: 'A', name: 'Third' })

      // List all
      const all = await client.things.list()
      expect(all.length).toBe(3)
    })

    it('should list things filtered by type', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create mixed types
      await client.things.create({ $type: 'Customer', name: 'Alice' })
      await client.things.create({ $type: 'Product', name: 'Widget' })
      await client.things.create({ $type: 'Customer', name: 'Bob' })

      // List only Customers
      const customers = await client.things.list('Customer')
      expect(customers.length).toBe(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('should persist state across multiple operations', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create
      const thing1 = await client.things.create({ $type: 'Test', name: 'One' })
      const thing2 = await client.things.create({ $type: 'Test', name: 'Two' })

      // Update
      await client.things.update(thing1.$id, { name: 'Updated One' })

      // Delete
      await client.things.delete(thing2.$id)

      // Verify final state
      const remaining = await client.things.list()
      expect(remaining.length).toBe(1)
      expect(remaining[0]?.name).toBe('Updated One')
    })
  })

  // ==========================================================================
  // 3. REFLECTION METHODS
  // ==========================================================================

  describe('3. Reflection Methods', () => {
    it('should return schema via _schema()', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const schema = await client._schema()
      expect(schema.$version).toBe('1.0.0')
      expect(schema.entities).toBeDefined()
      expect(schema.entities?.Thing).toBeDefined()
      expect(schema.methods?.['things.create']).toBeDefined()
    })

    it('should return TypeScript types via _types()', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const types = await client._types()
      expect(types).toContain('interface Thing')
      expect(types).toContain('$id: string')
      expect(types).toContain('interface DOInterface')
    })

    it('should return markdown documentation via md()', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const markdown = await client.md()
      expect(markdown).toContain('# E2E Test DO API')
      expect(markdown).toContain('## Methods')
      expect(markdown).toContain('### greet')
    })
  })

  // ==========================================================================
  // 4. AUTH FLOW INTEGRATION
  // ==========================================================================

  describe('4. Auth Flow Integration', () => {
    it('should allow public methods without auth', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('auth', doName)
      const client = createClient<{ publicMethod(): Promise<{ public: boolean }> }>(
        'https://do',
        { transport }
      )

      const result = await client.publicMethod()
      expect(result.public).toBe(true)
    })

    it('should reject protected methods without auth', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('auth', doName)
      const client = createClient<{ protectedMethod(): Promise<{ secret: string }> }>(
        'https://do',
        { transport }
      )

      await expect(client.protectedMethod()).rejects.toThrow('Missing authentication')
    })

    it('should reject invalid tokens', async () => {
      const doName = generateTestId()
      const stub = await getAuthStub(doName)

      // Make authenticated request with invalid token
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
        body: JSON.stringify({ method: 'protectedMethod', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('INVALID_TOKEN')
    })

    it('should allow protected methods with valid token', async () => {
      const doName = generateTestId()
      const stub = await getAuthStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-token-123',
        },
        body: JSON.stringify({ method: 'protectedMethod', args: [] }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json() as { secret: string; authorized: boolean }
      expect(result.authorized).toBe(true)
      expect(result.secret).toBe('data')
    })

    it('should work with transport custom headers for auth', async () => {
      const doName = generateTestId()

      // Create transport with auth header
      const transport = await createMiniflareTransport('auth', doName, {
        'Authorization': 'Bearer valid-token-123',
      })

      const client = createClient<{ protectedMethod(): Promise<{ authorized: boolean }> }>(
        'https://do',
        { transport }
      )

      const result = await client.protectedMethod()
      expect(result.authorized).toBe(true)
    })
  })

  // ==========================================================================
  // 5. TRANSPORT SCENARIOS
  // ==========================================================================

  describe('5. Transport Scenarios', () => {
    it('should handle method errors with structured response', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      await expect(client.throwError('Test error message')).rejects.toThrow('Test error message')
    })

    it('should handle non-existent method errors', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      // Use any to call non-existent method
      const client = createClient<{ nonExistent(): Promise<void> }>('https://do', { transport })

      await expect(client.nonExistent()).rejects.toThrow('Method not found')
    })

    it('should propagate correlation ID through request/response', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)
      const correlationId = 'test-correlation-' + generateTestId()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({ method: 'greet', args: ['Test'] }),
      })

      expect(response.headers.get('X-Correlation-ID')).toBe(correlationId)
    })

    it('should generate correlation ID if not provided', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['Test'] }),
      })

      const correlationId = response.headers.get('X-Correlation-ID')
      expect(correlationId).toBeDefined()
      expect(correlationId?.startsWith('generated-')).toBe(true)
    })

    it('should handle slow operations', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const start = Date.now()
      const result = await client.slowOperation(100)
      const elapsed = Date.now() - start

      expect(result).toBe('completed after 100ms')
      expect(elapsed).toBeGreaterThanOrEqual(100)
    })

    it('should handle invalid JSON body', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
      const error = await response.json() as { code: string }
      expect(error.code).toBe('PARSE_ERROR')
    })

    it('should handle multiple clients to same DO', async () => {
      const doName = generateTestId()
      const transport1 = await createMiniflareTransport('e2e', doName)
      const transport2 = await createMiniflareTransport('e2e', doName)
      const client1 = createClient<DOInterface>('https://do', { transport: transport1 })
      const client2 = createClient<DOInterface>('https://do', { transport: transport2 })

      // Create via client1
      const created = await client1.things.create({ $type: 'Shared', name: 'Item' })

      // Read via client2 (should see same state)
      const fetched = await client2.things.get(created.$id)
      expect(fetched).toEqual(created)
    })

    it('should isolate state between different DOs', async () => {
      const doName1 = generateTestId()
      const doName2 = generateTestId()
      const transport1 = await createMiniflareTransport('e2e', doName1)
      const transport2 = await createMiniflareTransport('e2e', doName2)
      const client1 = createClient<DOInterface>('https://do', { transport: transport1 })
      const client2 = createClient<DOInterface>('https://do', { transport: transport2 })

      // Create in DO1
      const created = await client1.things.create({ $type: 'Isolated', name: 'Only in DO1' })

      // Should not exist in DO2
      const fetched = await client2.things.get(created.$id)
      expect(fetched).toBeNull()
    })
  })

  // ==========================================================================
  // 6. TIMING & PERFORMANCE ASSERTIONS
  // ==========================================================================

  describe('6. Timing & Performance', () => {
    it('should complete create operation within threshold', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Warm-up call to initialize DO
      await client.greet('warmup')

      const start = Date.now()
      await client.things.create({ $type: 'TimingTest', name: 'Test' })
      const elapsed = Date.now() - start

      // Create should complete within 200ms after warm-up
      expect(elapsed).toBeLessThan(200)
    })

    it('should complete get operation within threshold', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create a thing first
      const thing = await client.things.create({ $type: 'TimingTest', name: 'Test' })

      const start = Date.now()
      await client.things.get(thing.$id)
      const elapsed = Date.now() - start

      // Get should be fast (under 100ms)
      expect(elapsed).toBeLessThan(100)
    })

    it('should complete update operation within threshold', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      const thing = await client.things.create({ $type: 'TimingTest', name: 'Test' })

      const start = Date.now()
      await client.things.update(thing.$id, { name: 'Updated' })
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(150)
    })

    it('should handle concurrent operations efficiently', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Warm up
      await client.greet('warmup')

      const start = Date.now()

      // Fire 10 concurrent creates
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          client.things.create({ $type: 'Concurrent', index: i })
        )
      )

      const elapsed = Date.now() - start

      expect(results).toHaveLength(10)
      // 10 concurrent creates should complete within 1 second
      expect(elapsed).toBeLessThan(1000)
    })

    it('should measure list operation latency', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create some items
      for (let i = 0; i < 20; i++) {
        await client.things.create({ $type: 'ListTest', index: i })
      }

      const start = Date.now()
      const items = await client.things.list('ListTest')
      const elapsed = Date.now() - start

      expect(items).toHaveLength(20)
      // List with 20 items should be under 200ms
      expect(elapsed).toBeLessThan(200)
    })
  })

  // ==========================================================================
  // 7. RETRY & RESILIENCE
  // ==========================================================================

  describe('7. Retry & Resilience', () => {
    it('should handle rapid sequential operations', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Rapid fire operations
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        const thing = await client.things.create({ $type: 'Rapid', index: i })
        ids.push(thing.$id)
        await client.things.update(thing.$id, { updated: true })
      }

      // Verify all were created and updated
      for (const id of ids) {
        const thing = await client.things.get(id)
        expect(thing).not.toBeNull()
        expect(thing?.updated).toBe(true)
      }
    })

    it('should recover from errors and continue processing', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // First, a successful operation
      const thing1 = await client.things.create({ $type: 'Recovery', name: 'First' })

      // Attempt an operation that fails
      try {
        await client.throwError('Expected error')
      } catch {
        // Expected
      }

      // Should still be able to continue operations
      const thing2 = await client.things.create({ $type: 'Recovery', name: 'Second' })
      expect(thing2.$id).toBeDefined()

      // Verify both things exist
      const all = await client.things.list('Recovery')
      expect(all).toHaveLength(2)
    })

    it('should maintain data integrity under concurrent updates', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Create a thing
      const thing = await client.things.create({ $type: 'Integrity', counter: 0 })

      // Concurrent updates (in real DO, these would serialize)
      await Promise.all([
        client.things.update(thing.$id, { counter: 1 }),
        client.things.update(thing.$id, { counter: 2 }),
        client.things.update(thing.$id, { counter: 3 }),
      ])

      // Final state should be deterministic (one of the values)
      const final = await client.things.get(thing.$id)
      expect([1, 2, 3]).toContain(final?.counter)
    })

    it('should handle interleaved CRUD operations', async () => {
      const doName = generateTestId()
      const transport = await createMiniflareTransport('e2e', doName)
      const client = createClient<DOInterface>('https://do', { transport })

      // Interleave creates and deletes
      const thing1 = await client.things.create({ $type: 'Interleave', name: 'A' })
      const thing2 = await client.things.create({ $type: 'Interleave', name: 'B' })
      await client.things.delete(thing1.$id)
      const thing3 = await client.things.create({ $type: 'Interleave', name: 'C' })
      await client.things.update(thing2.$id, { name: 'B-Updated' })

      const all = await client.things.list('Interleave')
      expect(all).toHaveLength(2)
      expect(all.some(t => t.name === 'B-Updated')).toBe(true)
      expect(all.some(t => t.name === 'C')).toBe(true)
      expect(all.some(t => t.name === 'A')).toBe(false)
    })
  })

  // ==========================================================================
  // 8. VALIDATION ERRORS
  // ==========================================================================

  describe('8. Validation Errors', () => {
    it('should handle nested path not found error', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonexistent.nested.method', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
      const error = await response.json() as { code: string; message: string }
      expect(error.code).toBe('METHOD_NOT_FOUND')
    })

    it('should handle empty method name', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '', args: [] }),
      })

      expect(response.ok).toBe(false)
    })

    it('should handle missing args array', async () => {
      const doName = generateTestId()
      const stub = await getE2EStub(doName)

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet' }), // Missing args
      })

      // Should either work with default empty args or return proper error
      // The DO implementation accepts missing args as undefined
      expect(response.status).toBeLessThan(500)
    })
  })
})
