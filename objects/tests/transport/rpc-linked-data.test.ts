/**
 * RPC Linked Data Response Tests
 *
 * RED TDD: These tests verify that RPC responses include the same JSON-LD style
 * linked data shape ($context, $type, $id) as REST endpoints.
 *
 * The DO's RPC methods should return responses with full linked data properties
 * just like the REST API does. This ensures consistent response shapes across
 * both transport layers.
 *
 * Test scenarios:
 * 1. Single item via RPC returns $context, $type, $id
 * 2. Collection via RPC returns full linked shape with items
 * 3. RPC response shape matches REST response shape
 *
 * Issue: dotdo-ssefu
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../../DO'

// ============================================================================
// TYPES
// ============================================================================

interface RPCRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: RPCCall[]
}

interface RPCCall {
  promiseId: string
  target: RPCTarget
  method: string
  args: RPCArg[]
}

type RPCTarget =
  | { type: 'root' }
  | { type: 'promise'; promiseId: string }

type RPCArg =
  | { type: 'value'; value: unknown }
  | { type: 'promise'; promiseId: string }

interface RPCResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: RPCResult[]
  error?: RPCError
}

interface RPCResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: RPCError
}

interface RPCError {
  code: string
  message: string
  data?: unknown
}

/**
 * Expected linked data response shape for single items
 */
interface LinkedDataItem {
  $context: string
  $type: string
  $id: string
  [key: string]: unknown
}

/**
 * Expected linked data response shape for collections
 */
interface LinkedDataCollection {
  $context: string
  $type: string
  $id: string
  count: number
  items: LinkedDataItem[]
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

function createMockKvStorage() {
  const storage = new Map<string, unknown>()
  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// MOCK COLLECTION FOR TESTING
// ============================================================================

interface MockCollectionItem {
  $id: string
  $type: string
  $rowid: number
  [key: string]: unknown
}

class MockCollection {
  private items = new Map<string, MockCollectionItem>()
  private nextRowid = 1
  private noun: string

  constructor(noun: string) {
    this.noun = noun
  }

  async create(data: Record<string, unknown>): Promise<MockCollectionItem> {
    const $id = (data.$id as string) || `${this.noun.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`
    const $rowid = this.nextRowid++
    const item: MockCollectionItem = {
      ...data,
      $id,
      $type: this.noun,
      $rowid,
    }
    this.items.set($id, item)
    return item
  }

  async get(id: string): Promise<MockCollectionItem | null> {
    return this.items.get(id) ?? null
  }

  async list(): Promise<MockCollectionItem[]> {
    return Array.from(this.items.values())
  }
}

// ============================================================================
// TEST DO CLASS
// ============================================================================

class LinkedDataTestDO extends DO {
  static readonly $type = 'LinkedDataTestDO'

  private _mockCollections = new Map<string, MockCollection>()

  collection(noun: string): MockCollection {
    if (!this._mockCollections.has(noun)) {
      this._mockCollections.set(noun, new MockCollection(noun))
    }
    return this._mockCollections.get(noun)!
  }

  // Seed test data
  async seedCustomers() {
    const collection = this.collection('Customer')
    await collection.create({ $id: 'alice', name: 'Alice Smith', email: 'alice@example.com' })
    await collection.create({ $id: 'bob', name: 'Bob Jones', email: 'bob@example.com' })
    await collection.create({ $id: 'charlie', name: 'Charlie Brown', email: 'charlie@example.com' })
  }
}

// ============================================================================
// TESTS: RPC LINKED DATA RESPONSE SHAPE
// ============================================================================

describe('RPC Linked Data Response Shape', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: LinkedDataTestDO

  const NS = 'https://headless.ly'

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new LinkedDataTestDO(mockState, mockEnv)
    await doInstance.initialize({ ns: NS })
    await doInstance.seedCustomers()
  })

  // ==========================================================================
  // TESTS: SINGLE ITEM VIA RPC - stub.Customer('alice')
  // ==========================================================================

  describe('Single item via RPC returns linked data shape', () => {
    it('RPC Customer.get returns $context property', async () => {
      // RED: RPC responses don't include $context yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'alice' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem
      expect(result.$context).toBe('https://headless.ly')
    })

    it('RPC Customer.get returns $type property', async () => {
      // RED: RPC responses don't include $type yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'alice' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem
      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('RPC Customer.get returns $id property as full URL', async () => {
      // RED: RPC responses don't include $id as full URL yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'alice' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem
      expect(result.$id).toBe('https://headless.ly/customers/alice')
    })

    it('RPC Customer.get returns complete linked data shape', async () => {
      // RED: RPC responses don't include full linked data shape yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'alice' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem

      // Verify all three linked data properties
      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/alice')

      // Verify data is also present
      expect(result.name).toBe('Alice Smith')
      expect(result.email).toBe('alice@example.com')
    })
  })

  // ==========================================================================
  // TESTS: COLLECTION VIA RPC - stub.Customers()
  // ==========================================================================

  describe('Collection via RPC returns linked data shape', () => {
    it('RPC Customers.list returns $context property', async () => {
      // RED: RPC collection responses don't include $context yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection
      expect(result.$context).toBe('https://headless.ly')
    })

    it('RPC Customers.list returns $type property', async () => {
      // RED: RPC collection responses don't include $type yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection
      expect(result.$type).toBe('https://headless.ly/customers')
    })

    it('RPC Customers.list returns $id property as collection URL', async () => {
      // RED: RPC collection responses don't include $id yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection
      expect(result.$id).toBe('https://headless.ly/customers')
    })

    it('RPC Customers.list returns items array', async () => {
      // RED: RPC collection responses don't include items array yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection
      expect(result.items).toBeDefined()
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('RPC Customers.list returns count property', async () => {
      // RED: RPC collection responses don't include count yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection
      expect(result.count).toBeTypeOf('number')
      expect(result.count).toBe(3) // alice, bob, charlie
    })

    it('RPC Customers.list items have linked data properties', async () => {
      // RED: RPC collection item responses don't include linked data yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection

      // Each item should have linked data properties
      for (const item of result.items) {
        expect(item.$context).toBe('https://headless.ly')
        expect(item.$type).toBe('https://headless.ly/customers')
        expect(item.$id).toMatch(/^https:\/\/headless\.ly\/customers\//)
      }
    })

    it('RPC Customers.list returns complete linked data shape', async () => {
      // RED: RPC collection responses don't include full shape yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataCollection

      // Verify collection-level linked data
      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers')
      expect(result.count).toBe(3)
      expect(result.items).toHaveLength(3)

      // Verify item-level linked data
      const alice = result.items.find(i => i.name === 'Alice Smith')
      expect(alice?.$context).toBe('https://headless.ly')
      expect(alice?.$type).toBe('https://headless.ly/customers')
      expect(alice?.$id).toBe('https://headless.ly/customers/alice')
    })
  })

  // ==========================================================================
  // TESTS: RPC SHAPE MATCHES REST
  // ==========================================================================

  describe('RPC response shape matches REST response shape', () => {
    it('RPC Customer.get matches REST GET /customers/:id shape', async () => {
      // RED: RPC and REST responses have different shapes

      // Make RPC call
      const rpcRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'alice' }],
          }],
        } satisfies RPCRequest),
      })

      const rpcResponse = await doInstance.fetch(rpcRequest)
      const rpcData = await rpcResponse.json() as RPCResponse
      const rpcResult = rpcData.results?.[0].value as LinkedDataItem

      // Make REST call
      const restRequest = new Request('https://headless.ly/customers/alice', {
        method: 'GET',
      })

      const restResponse = await doInstance.fetch(restRequest)
      const restResult = await restResponse.json() as LinkedDataItem

      // Compare linked data properties
      expect(rpcResult.$context).toBe(restResult.$context)
      expect(rpcResult.$type).toBe(restResult.$type)
      expect(rpcResult.$id).toBe(restResult.$id)
    })

    it('RPC Customers.list matches REST GET /customers shape', async () => {
      // RED: RPC and REST collection responses have different shapes

      // Make RPC call
      const rpcRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const rpcResponse = await doInstance.fetch(rpcRequest)
      const rpcData = await rpcResponse.json() as RPCResponse
      const rpcResult = rpcData.results?.[0].value as LinkedDataCollection

      // Make REST call
      const restRequest = new Request('https://headless.ly/customers', {
        method: 'GET',
      })

      const restResponse = await doInstance.fetch(restRequest)
      const restResult = await restResponse.json() as LinkedDataCollection

      // Compare linked data properties
      expect(rpcResult.$context).toBe(restResult.$context)
      expect(rpcResult.$type).toBe(restResult.$type)
      expect(rpcResult.$id).toBe(restResult.$id)
      expect(rpcResult.count).toBe(restResult.count)
    })

    it('RPC item $id format matches REST item $id format', async () => {
      // RED: RPC $id format doesn't match REST format

      // RPC call
      const rpcRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.get',
            args: [{ type: 'value', value: 'bob' }],
          }],
        } satisfies RPCRequest),
      })

      const rpcResponse = await doInstance.fetch(rpcRequest)
      const rpcData = await rpcResponse.json() as RPCResponse
      const rpcResult = rpcData.results?.[0].value as LinkedDataItem

      // REST call
      const restRequest = new Request('https://headless.ly/customers/bob', {
        method: 'GET',
      })

      const restResponse = await doInstance.fetch(restRequest)
      const restResult = await restResponse.json() as LinkedDataItem

      // $id should be identical full URL
      expect(rpcResult.$id).toBe('https://headless.ly/customers/bob')
      expect(rpcResult.$id).toBe(restResult.$id)
    })

    it('RPC collection items have same shape as REST items', async () => {
      // RED: RPC collection items don't match REST item shape

      // RPC collection call
      const rpcRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customers.list',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const rpcResponse = await doInstance.fetch(rpcRequest)
      const rpcData = await rpcResponse.json() as RPCResponse
      const rpcResult = rpcData.results?.[0].value as LinkedDataCollection

      // REST item call
      const restRequest = new Request('https://headless.ly/customers/alice', {
        method: 'GET',
      })

      const restResponse = await doInstance.fetch(restRequest)
      const restResult = await restResponse.json() as LinkedDataItem

      // Find alice in RPC collection
      const rpcAlice = rpcResult.items.find(i => i.name === 'Alice Smith')

      // Compare shapes (same linked data properties)
      expect(rpcAlice?.$context).toBe(restResult.$context)
      expect(rpcAlice?.$type).toBe(restResult.$type)
      expect(rpcAlice?.$id).toBe(restResult.$id)
    })
  })

  // ==========================================================================
  // TESTS: LINKED DATA WITH MUTATIONS
  // ==========================================================================

  describe('RPC mutations return linked data shape', () => {
    it('RPC Customer.create returns $context, $type, $id', async () => {
      // RED: RPC create responses don't include linked data yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.create',
            args: [{ type: 'value', value: { $id: 'dave', name: 'Dave Wilson', email: 'dave@example.com' } }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/dave')
      expect(result.name).toBe('Dave Wilson')
    })

    it('RPC Customer.update returns $context, $type, $id', async () => {
      // RED: RPC update responses don't include linked data yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'Customer.update',
            args: [
              { type: 'value', value: 'alice' },
              { type: 'value', value: { name: 'Alice Updated' } },
            ],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const result = data.results?.[0].value as LinkedDataItem

      expect(result.$context).toBe('https://headless.ly')
      expect(result.$type).toBe('https://headless.ly/customers')
      expect(result.$id).toBe('https://headless.ly/customers/alice')
    })
  })
})
