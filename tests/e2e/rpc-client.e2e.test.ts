/**
 * RPC Client E2E Tests
 *
 * Tests the @dotdo/core RPC client against deployed workers.
 *
 * These tests verify:
 * 1. createRPCClient connects to real deployed workers
 * 2. Noun accessor methods work (Customer.create, Customer.list)
 * 3. Direct CRUD methods work (create, listThings)
 * 4. Promise pipelining batches requests properly
 * 5. HTTP routes work (/health, /api/items, /rpc/pipeline)
 *
 * Configuration:
 *   TEST_URL - Base URL of deployed worker (required for deployed tests)
 *   TEST_TOKEN - Auth token for protected endpoints
 *
 * @example
 * ```bash
 * # Test against local dev server
 * npm run dev &
 * TEST_URL=http://localhost:8787 npm run test:e2e
 *
 * # Test against deployed worker
 * TEST_URL=https://api.dotdo.dev npm run test:e2e
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  createRPCClient,
  pipeline,
  RPCError,
  serialize,
  deserialize,
} from '../../rpc/index'

// =============================================================================
// Configuration
// =============================================================================

const TEST_URL = process.env.TEST_URL || 'http://localhost:8787'
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token-for-e2e'

// Skip deployed tests if no TEST_URL configured
const SKIP_DEPLOYED_TESTS = !process.env.TEST_URL && !process.env.CI

// =============================================================================
// Type Definitions for DOFull API
// =============================================================================

interface ThingData {
  $id: string
  $type: string
  $createdAt?: string
  $updatedAt?: string
  $version?: number
  [key: string]: unknown
}

interface NounAccessor {
  create(data: Record<string, unknown>): Promise<ThingData>
  list(query?: { where?: Record<string, unknown>; limit?: number }): Promise<ThingData[]>
}

interface NounInstanceAccessor {
  getProfile(): Promise<ThingData | null>
  update(data: Record<string, unknown>): Promise<ThingData>
  delete(): Promise<boolean>
}

interface DOFullAPI {
  // Direct CRUD methods
  create(type: string, data: Record<string, unknown>): Promise<ThingData>
  listThings(type: string, query?: { where?: Record<string, unknown>; limit?: number }): Promise<ThingData[]>
  getThingById(id: string): Promise<ThingData | null>

  // Noun accessors
  Customer: NounAccessor & ((id: string) => NounInstanceAccessor)
  Order: NounAccessor & ((id: string) => NounInstanceAccessor)
  Product: NounAccessor & ((id: string) => NounInstanceAccessor)
}

// =============================================================================
// 1. RPC CLIENT CREATION
// =============================================================================

describe('RPC Client Creation', () => {
  it('creates client with URL target', () => {
    const client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
    })

    expect(client).toBeDefined()
    expect(client.$meta).toBeDefined()
  })

  it('creates client with auth token', () => {
    const client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      auth: TEST_TOKEN,
    })

    expect(client).toBeDefined()
  })

  it('creates client with timeout and retry config', () => {
    const client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      timeout: 5000,
      retry: {
        maxAttempts: 3,
        backoffMs: 1000,
      },
    })

    expect(client).toBeDefined()
  })
})

// =============================================================================
// 2. HTTP ROUTES (verify worker is responding)
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('HTTP Routes', () => {
  it('GET /health returns ok', async () => {
    const response = await fetch(`${TEST_URL}/health`)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('path', '/health')
  })

  it('GET /ready returns ready state', async () => {
    const response = await fetch(`${TEST_URL}/ready`)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('ready')
  })

  it('GET /api/status returns ok', async () => {
    const response = await fetch(`${TEST_URL}/api/status`)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  it('POST /api/items creates item', async () => {
    const response = await fetch(`${TEST_URL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item' }),
    })

    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.created).toEqual({ name: 'Test Item' })
  })

  it('POST /api/echo echoes body', async () => {
    const body = { test: 'data', nested: { value: 42 } }
    const response = await fetch(`${TEST_URL}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(body)
  })
})

// =============================================================================
// 3. RPC PIPELINE ENDPOINT
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('RPC Pipeline Endpoint', () => {
  it('POST /rpc/pipeline executes single pipeline', async () => {
    const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test-1',
        pipeline: {
          target: ['Customer', 'test-123'],
          pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
        },
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('id', 'test-1')
  })

  it('POST /rpc/pipeline executes batch pipelines', async () => {
    const response = await fetch(`${TEST_URL}/rpc/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          id: 'batch-1',
          pipeline: {
            target: ['Customer', 'cust-1'],
            pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
          },
        },
        {
          id: 'batch-2',
          pipeline: {
            target: ['Customer', 'cust-2'],
            pipeline: [{ type: 'method', name: 'getProfile', args: [] }],
          },
        },
      ]),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    expect(data[0].id).toBe('batch-1')
    expect(data[1].id).toBe('batch-2')
  })
})

// =============================================================================
// 4. RPC CLIENT DIRECT METHODS
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('RPC Client Direct Methods', () => {
  let client: DOFullAPI & { $meta: import('../../rpc/proxy').MetaInterface }
  const testId = `rpc-direct-${Date.now()}`

  beforeAll(() => {
    client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      auth: TEST_TOKEN,
    })
  })

  it('create() creates a thing', async () => {
    const result = await client.create('Customer', {
      $id: testId,
      name: 'RPC Direct Test',
      email: 'direct@test.com',
    })

    expect(result.$id).toBe(testId)
    expect(result.$type).toBe('Customer')
    expect(result.name).toBe('RPC Direct Test')
  })

  it('listThings() returns things by type', async () => {
    const results = await client.listThings('Customer')

    expect(Array.isArray(results)).toBe(true)
    // Should include our created thing
    const found = results.find(c => c.$id === testId)
    expect(found).toBeDefined()
  })

  it('listThings() supports where clause', async () => {
    const results = await client.listThings('Customer', {
      where: { name: 'RPC Direct Test' },
    })

    expect(Array.isArray(results)).toBe(true)
    expect(results.every(c => c.name === 'RPC Direct Test')).toBe(true)
  })

  it('getThingById() returns a thing', async () => {
    const result = await client.getThingById(testId)

    expect(result).not.toBeNull()
    expect(result!.$id).toBe(testId)
  })
})

// =============================================================================
// 5. RPC CLIENT NOUN ACCESSORS
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('RPC Client Noun Accessors', () => {
  let client: DOFullAPI & { $meta: import('../../rpc/proxy').MetaInterface }
  const testId = `rpc-noun-${Date.now()}`

  beforeAll(() => {
    client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      auth: TEST_TOKEN,
    })
  })

  it('Customer.create() creates a customer', async () => {
    const result = await client.Customer.create({
      $id: testId,
      name: 'Noun Accessor Test',
      email: 'noun@test.com',
    })

    expect(result.$id).toBe(testId)
    expect(result.$type).toBe('Customer')
  })

  it('Customer.list() returns customers', async () => {
    const results = await client.Customer.list()

    expect(Array.isArray(results)).toBe(true)
  })

  it('Customer(id).getProfile() returns customer profile', async () => {
    const result = await client.Customer(testId).getProfile()

    expect(result).not.toBeNull()
    expect(result!.$id).toBe(testId)
    expect(result!.name).toBe('Noun Accessor Test')
  })

  it('Customer(id).update() updates customer', async () => {
    const result = await client.Customer(testId).update({
      name: 'Updated Noun Test',
    })

    expect(result.name).toBe('Updated Noun Test')
  })

  it('Customer(id).delete() deletes customer', async () => {
    const result = await client.Customer(testId).delete()
    expect(result).toBe(true)

    // Verify deleted
    const profile = await client.Customer(testId).getProfile()
    expect(profile).toBeNull()
  })
})

// =============================================================================
// 6. PROMISE PIPELINING
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('Promise Pipelining', () => {
  let client: DOFullAPI & { $meta: import('../../rpc/proxy').MetaInterface }

  beforeAll(() => {
    client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      auth: TEST_TOKEN,
    })
  })

  it('pipeline().then().execute() works', async () => {
    const result = await pipeline(client)
      .then('listThings', 'Customer')
      .execute()

    expect(Array.isArray(result)).toBe(true)
  })

  it('pipeline().plan() returns execution plan', () => {
    const builder = pipeline(client)
      .then('create', 'Customer', { name: 'Pipeline Test' })

    const plan = builder.plan()

    expect(Array.isArray(plan)).toBe(true)
    expect(plan[0].name).toBe('create')
    expect(plan[0].args).toEqual(['Customer', { name: 'Pipeline Test' }])
  })
})

// =============================================================================
// 7. SERIALIZATION
// =============================================================================

describe('Serialization Round-trip', () => {
  it('preserves Date', () => {
    const date = new Date('2026-01-16T12:00:00Z')
    const serialized = serialize({ date })
    const deserialized = deserialize<{ date: Date }>(serialized as string)

    expect(deserialized.date).toBeInstanceOf(Date)
    expect(deserialized.date.toISOString()).toBe(date.toISOString())
  })

  it('preserves BigInt', () => {
    const value = BigInt('9007199254740993')
    const serialized = serialize({ value })
    const deserialized = deserialize<{ value: bigint }>(serialized as string)

    expect(typeof deserialized.value).toBe('bigint')
  })

  it('preserves Map', () => {
    const map = new Map([['key', 'value']])
    const serialized = serialize({ map })
    const deserialized = deserialize<{ map: Map<string, string> }>(serialized as string)

    expect(deserialized.map).toBeInstanceOf(Map)
    expect(deserialized.map.get('key')).toBe('value')
  })

  it('preserves Set', () => {
    const set = new Set([1, 2, 3])
    const serialized = serialize({ set })
    const deserialized = deserialize<{ set: Set<number> }>(serialized as string)

    expect(deserialized.set).toBeInstanceOf(Set)
    expect(deserialized.set.has(2)).toBe(true)
  })
})

// =============================================================================
// 8. $META INTROSPECTION
// =============================================================================

describe('$meta Introspection', () => {
  let client: DOFullAPI & { $meta: import('../../rpc/proxy').MetaInterface }

  beforeAll(() => {
    client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
    })
  })

  it('$meta.version() returns version info', async () => {
    const version = await client.$meta.version()

    expect(version).toHaveProperty('major')
    expect(version).toHaveProperty('minor')
    expect(version).toHaveProperty('patch')
    expect(typeof version.major).toBe('number')
  })

  it.skipIf(SKIP_DEPLOYED_TESTS)('$meta.schema() returns schema', async () => {
    const schema = await client.$meta.schema()

    expect(schema).toHaveProperty('name')
    expect(schema).toHaveProperty('methods')
    expect(schema).toHaveProperty('fields')
  })

  it.skipIf(SKIP_DEPLOYED_TESTS)('$meta.methods() returns method list', async () => {
    const methods = await client.$meta.methods()

    expect(Array.isArray(methods)).toBe(true)
    for (const method of methods) {
      expect(method).toHaveProperty('name')
      expect(method).toHaveProperty('params')
    }
  })
})

// =============================================================================
// 9. ERROR HANDLING
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('Error Handling', () => {
  let client: DOFullAPI & { $meta: import('../../rpc/proxy').MetaInterface }

  beforeAll(() => {
    client = createRPCClient<DOFullAPI>({
      target: TEST_URL,
      auth: TEST_TOKEN,
      timeout: 5000,
    })
  })

  it('handles network errors gracefully', async () => {
    const badClient = createRPCClient<DOFullAPI>({
      target: 'http://localhost:99999', // Invalid port
      timeout: 1000,
    })

    await expect(badClient.listThings('Customer')).rejects.toThrow()
  })

  it('getThingById returns null for non-existent', async () => {
    const result = await client.getThingById('non-existent-id-12345')
    expect(result).toBeNull()
  })
})
