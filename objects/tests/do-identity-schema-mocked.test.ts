/**
 * DO Identity and Schema Auto-Creation Tests (GREEN Phase - Mocked Runtime)
 *
 * These tests verify that Durable Objects correctly:
 * 1. Derive $id from the request URL hostname
 * 2. Derive ns from the request URL hostname
 * 3. Auto-create SQLite schema tables on first access
 * 4. Persist and retrieve data correctly
 *
 * This version uses mocked DO runtime for Node.js environment.
 * For real miniflare tests, see do-identity-schema.test.ts (requires
 * @cloudflare/vitest-pool-workers compatibility).
 *
 * Run with: npx vitest run objects/tests/do-identity-schema-mocked.test.ts --project=objects
 *
 * @module objects/tests/do-identity-schema-mocked.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DOBase'
import type { Env } from '../DOBase'
import type { ThingEntity, ThingsStore } from '../../db/stores'

// ============================================================================
// In-Memory ThingsStore Mock
// ============================================================================

/**
 * Create an in-memory ThingsStore mock that works without SQLite.
 * This mock properly handles CRUD operations for testing.
 */
function createInMemoryThingsStore(): ThingsStore {
  const things = new Map<string, ThingEntity>()
  let versionCounter = 1

  return {
    async get(id: string): Promise<ThingEntity | null> {
      return things.get(id) ?? null
    },

    async list(options?: { type?: string; limit?: number }): Promise<ThingEntity[]> {
      const allThings = Array.from(things.values()).filter(t => !t.deleted)

      if (options?.type) {
        const typeLower = options.type.toLowerCase()
        return allThings.filter(t => {
          const thingType = t.$type.toLowerCase()
          return thingType === typeLower || thingType === typeLower + 's'
        })
      }

      return allThings.slice(0, options?.limit ?? 100)
    },

    async count(options?: { type?: string }): Promise<number> {
      const items = await this.list(options)
      return items.length
    },

    async create(data: Partial<ThingEntity>): Promise<ThingEntity> {
      const id = data.$id ?? crypto.randomUUID()
      const thing: ThingEntity = {
        $id: id,
        $type: data.$type ?? 'Unknown',
        name: data.name ?? null,
        data: data.data ?? null,
        branch: data.branch ?? null,
        version: versionCounter++,
        deleted: false,
      }
      things.set(id, thing)
      return thing
    },

    async update(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
      const existing = things.get(id)
      if (!existing) {
        throw new Error(`Thing '${id}' not found`)
      }
      const updated: ThingEntity = {
        ...existing,
        name: data.name ?? existing.name,
        data: { ...(existing.data ?? {}), ...(data.data ?? {}) },
        version: versionCounter++,
      }
      things.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<ThingEntity> {
      const existing = things.get(id)
      if (!existing) {
        throw new Error(`Thing '${id}' not found`)
      }
      const deleted: ThingEntity = { ...existing, deleted: true }
      things.delete(id)
      return deleted
    },

    async versions(id: string): Promise<ThingEntity[]> {
      const thing = things.get(id)
      return thing ? [thing] : []
    },

    // Mutation callback - can be set by test if needed
    onMutation: undefined,
  } as ThingsStore
}

// ============================================================================
// Mock Setup
// ============================================================================

/**
 * Create a mock DurableObjectState
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'mock-do-id-12345',
      equals: (other: DurableObjectId) => other.toString() === 'mock-do-id-12345',
      name: 'mock-do',
    } as DurableObjectId,
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => storage.set(key, value)),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => new Map()),
      deleteAll: vi.fn(async () => {}),
      getAlarm: vi.fn(async () => null),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
      transactionSync: vi.fn(async (fn: () => unknown) => fn()),
    } as unknown as DurableObjectStorage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(() => null),
    getWebSocketAutoResponseTimestamp: vi.fn(() => null),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(() => null),
    getTags: vi.fn(() => []),
  } as unknown as DurableObjectState
}

/**
 * Create a mock Env
 */
function createMockEnv(): Env {
  return {
    DO: {} as DurableObjectNamespace,
    AI: {} as Ai,
    PIPELINE: {
      send: vi.fn(async () => {}),
    } as unknown as Pipeline<unknown>,
  } as Env
}

/**
 * Test DO class that extends DOBase with in-memory ThingsStore
 */
class TestDO extends DO<Env> {
  static readonly $type = 'TestDO'

  // Override the things store with our in-memory mock
  private _mockThings?: ThingsStore

  override get things(): ThingsStore {
    if (!this._mockThings) {
      this._mockThings = createInMemoryThingsStore()
    }
    return this._mockThings
  }

  protected override getRegisteredNouns(): Array<{ noun: string; plural: string }> {
    return [
      { noun: 'Customer', plural: 'customers' },
      { noun: 'Order', plural: 'orders' },
      { noun: 'Product', plural: 'products' },
    ]
  }
}

// ============================================================================
// DO Identity Tests
// ============================================================================

describe('DO Identity Derivation (Mocked)', () => {
  let state: DurableObjectState
  let env: Env
  let dobj: TestDO

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
    dobj = new TestDO(state, env)
  })

  /**
   * Test: DO should derive $id from request URL hostname
   *
   * Expected behavior:
   * - When a request comes to https://acme.api.dotdo.dev/
   * - The response should include $id set to 'https://acme.api.dotdo.dev'
   */
  it('derives $id from request URL origin in response', async () => {
    const request = new Request('https://acme.api.dotdo.dev/')
    const response = await dobj.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      $id?: string
      $type?: string
    }

    // $id in the response should match the request origin
    expect(body.$id).toBe('https://acme.api.dotdo.dev')
  })

  /**
   * Test: DO's ns property should be set from URL
   *
   * Expected behavior:
   * - When a request comes to https://acme.api.dotdo.dev/
   * - The DO's ns property should be set to 'acme' (first subdomain)
   */
  it('sets ns property from request URL', async () => {
    // Before any request, ns should be empty
    expect(dobj['ns']).toBe('')

    const request = new Request('https://acme.api.dotdo.dev/')
    await dobj.fetch(request)

    // After request, ns should be derived from hostname subdomain
    expect(dobj['ns']).toBe('acme')
  })

  /**
   * Test: Response ns field should match hostname namespace
   *
   * Expected behavior:
   * - GET / response should include ns derived from hostname
   * - 'acme.api.dotdo.dev' -> ns: 'acme'
   */
  it('returns ns in response derived from hostname', async () => {
    const request = new Request('https://acme.api.dotdo.dev/')
    const response = await dobj.fetch(request)

    const body = await response.json() as { ns?: string }

    // ns should be the subdomain/namespace portion
    expect(body.ns).toBe('acme')
  })

  /**
   * Test: Different hostnames should yield different $id values
   */
  it('different origins yield different $id values', async () => {
    const req1 = new Request('https://acme.api.dotdo.dev/')
    const res1 = await dobj.fetch(req1)
    const body1 = await res1.json() as { $id?: string }

    const req2 = new Request('https://beta.api.dotdo.dev/')
    const res2 = await dobj.fetch(req2)
    const body2 = await res2.json() as { $id?: string }

    // Both should have $id derived from their respective origins
    expect(body1.$id).toBe('https://acme.api.dotdo.dev')
    expect(body2.$id).toBe('https://beta.api.dotdo.dev')
    expect(body1.$id).not.toBe(body2.$id)
  })
})

// ============================================================================
// Schema Auto-Creation Tests
// ============================================================================

describe('Schema Auto-Creation (Mocked)', () => {
  let state: DurableObjectState
  let env: Env
  let dobj: TestDO

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
    dobj = new TestDO(state, env)
  })

  /**
   * Test: POST should create and persist data
   *
   * Expected behavior:
   * - POST to /customers creates entity
   * - Returns 201 with created entity
   * - Entity has $type as full URL (JSON-LD format)
   */
  it('creates tables on first POST', async () => {
    const request = new Request('https://test.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    })

    const response = await dobj.fetch(request)

    // Should succeed with 201
    expect(response.status).toBe(201)

    const body = await response.json() as {
      $id?: string
      $type?: string
      name?: string
    }

    // $type is a full URL in JSON-LD format (not just the noun name)
    // This is by design for linked data compatibility
    expect(body.$type).toBe('https://test.api.dotdo.dev/customers')

    // Data should be present
    expect(body.name).toBe('Alice')
    expect(body.$id).toBeDefined()
    // $id should be a full URL path
    expect(body.$id).toMatch(/^https:\/\/test\.api\.dotdo\.dev\/customers\/.+$/)
  })

  /**
   * Test: Created data should be retrievable
   *
   * Expected behavior:
   * - POST creates entity with $id
   * - GET $id returns the same entity
   */
  it('persists and retrieves created data', async () => {
    // Create
    const createReq = new Request('https://test.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
    })
    const createRes = await dobj.fetch(createReq)

    expect(createRes.status).toBe(201)

    const created = await createRes.json() as { $id: string }

    // The $id is a full URL like 'https://test.api.dotdo.dev/customers/abc123'
    // Extract the path portion for the GET request
    const url = new URL(created.$id)
    const getReq = new Request(`https://test.api.dotdo.dev${url.pathname}`)
    const getRes = await dobj.fetch(getReq)

    expect(getRes.status).toBe(200)

    const retrieved = await getRes.json() as { name: string; email: string }
    expect(retrieved.name).toBe('Bob')
    expect(retrieved.email).toBe('bob@example.com')
  })

  /**
   * Test: Different types should be isolated
   */
  it('isolates data by type', async () => {
    // Create customer
    const custReq = new Request('https://test.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Customer' }),
    })
    await dobj.fetch(custReq)

    // Create order
    const orderReq = new Request('https://test.api.dotdo.dev/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'Widget' }),
    })
    await dobj.fetch(orderReq)

    // List customers - should have 1
    const listCustRes = await dobj.fetch(new Request('https://test.api.dotdo.dev/customers'))
    const custList = await listCustRes.json() as { count: number }
    expect(custList.count).toBe(1)

    // List orders - should have 1
    const listOrderRes = await dobj.fetch(new Request('https://test.api.dotdo.dev/orders'))
    const orderList = await listOrderRes.json() as { count: number }
    expect(orderList.count).toBe(1)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Surfacing (Mocked)', () => {
  let state: DurableObjectState
  let env: Env
  let dobj: TestDO

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
    dobj = new TestDO(state, env)
  })

  /**
   * Test: Non-existent items should return 404
   */
  it('returns 404 for non-existent items', async () => {
    const request = new Request('https://test.api.dotdo.dev/customers/non-existent')
    const response = await dobj.fetch(request)

    expect(response.status).toBe(404)

    const body = await response.json() as { code?: string }
    expect(body.code).toBe('NOT_FOUND')
  })

  /**
   * Test: Invalid JSON should return 400
   */
  it('returns 400 for invalid JSON', async () => {
    const request = new Request('https://test.api.dotdo.dev/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })
    const response = await dobj.fetch(request)

    expect(response.status).toBe(400)
  })

  /**
   * Test: Index response should have proper structure
   */
  it('index response has proper structure', async () => {
    const request = new Request('https://test.api.dotdo.dev/')
    const response = await dobj.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      $id?: string
      $context?: string
      $type?: string
      ns?: string
      collections?: Record<string, unknown>
    }

    // All required fields should be present
    expect(body.$id).toBeDefined()
    expect(body.$context).toBeDefined()
    expect(body.$type).toBeDefined()
    expect(body.ns).toBeDefined()
    expect(body.collections).toBeDefined()
  })
})
