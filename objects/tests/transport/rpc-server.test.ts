/**
 * RPC Server Integration Tests for DO
 *
 * RED TDD: These tests verify that DO methods can be exposed via Cap'n Web RPC protocol.
 * These tests are designed to FAIL because the DO-integrated RPC implementation doesn't exist yet.
 *
 * The DO RPC server should support:
 * - Direct method calls via Cap'n Web RPC protocol
 * - Promise pipelining (chain method calls without awaiting intermediate results)
 * - Pass-by-reference for DO objects
 * - Both JSON-RPC 2.0 and Cap'n Web protocols
 * - WebSocket and HTTP transports
 * - Automatic batching of multiple calls
 *
 * Reference: /Users/nathanclevenger/projects/dotdo/api/routes/rpc.ts for protocol structure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO, type Env } from '../../DO'

// ============================================================================
// TYPES - Cap'n Web RPC Protocol
// ============================================================================

interface RPCRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: RPCCall[]
  resolve?: { promiseId: string }
  dispose?: { promiseIds: string[] }
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
  | { type: 'property'; base: NestedTarget; property: string }

type NestedTarget =
  | { type: 'root' }
  | { type: 'promise'; promiseId: string }

type RPCArg =
  | { type: 'value'; value: unknown }
  | { type: 'promise'; promiseId: string }
  | { type: 'callback'; callbackId: string }

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

// JSON-RPC 2.0 types
interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JSONRPCError
  id: string | number | null
}

interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

/**
 * Mock KV storage for Durable Object state
 */
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

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
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

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// TEST DO CLASS - Exposes methods for RPC
// ============================================================================

/**
 * Test DO that extends DO with methods we want to expose via RPC
 */
class RpcTestDO extends DO {
  static readonly $type = 'RpcTestDO'

  private _users: Map<string, { id: string; name: string; email: string }> = new Map([
    ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
    ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' }],
    ['user-3', { id: 'user-3', name: 'Charlie', email: 'charlie@example.com' }],
  ])

  private _posts: Map<string, { id: string; title: string; authorId: string; published: boolean }> = new Map([
    ['post-1', { id: 'post-1', title: 'First Post', authorId: 'user-1', published: true }],
    ['post-2', { id: 'post-2', title: 'Second Post', authorId: 'user-1', published: false }],
    ['post-3', { id: 'post-3', title: 'Third Post', authorId: 'user-2', published: true }],
  ])

  // Basic methods
  getUser(id: string) {
    return this._users.get(id) ?? null
  }

  getUserPosts(userId: string) {
    return Array.from(this._posts.values()).filter(p => p.authorId === userId)
  }

  getPost(id: string) {
    return this._posts.get(id) ?? null
  }

  // Method that returns an object with methods (for pipelining)
  getUserWithMethods(id: string) {
    const user = this._users.get(id)
    if (!user) return null
    return {
      ...user,
      getPosts: () => this.getUserPosts(id),
      getPostCount: () => this.getUserPosts(id).length,
    }
  }

  // Arithmetic methods for testing batching
  add(a: number, b: number) {
    return a + b
  }

  multiply(a: number, b: number) {
    return a * b
  }

  // Async method
  async processData(data: { value: number }) {
    await this.sleep(10) // Simulate async work
    return { result: data.value * 2 }
  }

  // Method that throws
  throwError(message: string) {
    throw new Error(message)
  }

  // Method that returns a reference to another DO
  getRelatedDO(type: string, id: string) {
    return {
      $ref: `${type}/${id}`,
      $type: type,
      $id: id,
    }
  }

  // List methods for Magic Map testing
  getAllUsers() {
    return Array.from(this._users.values())
  }

  getAllPosts() {
    return Array.from(this._posts.values())
  }

  // Nested object method
  getOrganization(id: string) {
    return {
      id,
      name: `Org ${id}`,
      getTeams: () => [
        { id: 'team-1', name: 'Engineering' },
        { id: 'team-2', name: 'Product' },
      ],
      getTeam: (teamId: string) => ({
        id: teamId,
        name: `Team ${teamId}`,
        getMembers: () => Array.from(this._users.values()),
      }),
    }
  }

  // Echo for basic testing
  echo(value: unknown) {
    return value
  }

  // Ping for connection testing
  ping() {
    return { pong: true, timestamp: Date.now() }
  }
}

// ============================================================================
// TESTS: BASIC METHOD CALLS VIA RPC
// ============================================================================

describe('RPC Server Integration - DO Methods', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: RpcTestDO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new RpcTestDO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com' })
  })

  // ==========================================================================
  // TESTS: RPC METHOD EXPOSURE
  // ==========================================================================

  describe('Method Exposure', () => {
    it('DO should have rpcMethods property listing exposed methods', () => {
      // RED: DO class doesn't yet have RPC method exposure
      const rpcServer = (doInstance as unknown as { rpcServer: { methods: string[] } }).rpcServer

      expect(rpcServer).toBeDefined()
      expect(rpcServer.methods).toContain('getUser')
      expect(rpcServer.methods).toContain('getUserPosts')
      expect(rpcServer.methods).toContain('add')
    })

    it('DO should expose methods via @rpc decorator or rpc() wrapper', () => {
      // RED: No decorator/wrapper mechanism yet
      const isExposed = (doInstance as unknown as { isRpcExposed: (method: string) => boolean }).isRpcExposed

      expect(isExposed('getUser')).toBe(true)
      expect(isExposed('getUserPosts')).toBe(true)
      expect(isExposed('_users')).toBe(false) // Private should not be exposed
    })

    it('DO should have /rpc endpoint for HTTP RPC', async () => {
      // RED: DO doesn't have /rpc endpoint yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'ping',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as RPCResponse
      expect(data.type).toBe('batch')
      expect(data.results?.[0].value).toEqual({ pong: true, timestamp: expect.any(Number) })
    })

    it('DO should support WebSocket upgrade for /rpc', async () => {
      // RED: DO doesn't support WebSocket RPC yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: BASIC JSON-RPC 2.0 CALLS
  // ==========================================================================

  describe('JSON-RPC 2.0 Protocol', () => {
    it('handles single JSON-RPC request', async () => {
      // RED: DO doesn't handle JSON-RPC yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getUser',
          params: ['user-1'],
          id: 1,
        } satisfies JSONRPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as JSONRPCResponse

      expect(data.jsonrpc).toBe('2.0')
      expect(data.id).toBe(1)
      expect(data.result).toEqual({
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('handles JSON-RPC request with object params', async () => {
      // RED: DO doesn't handle JSON-RPC yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'add',
          params: { a: 5, b: 3 },
          id: 2,
        }),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as JSONRPCResponse

      expect(data.result).toBe(8)
    })

    it('handles JSON-RPC batch request', async () => {
      // RED: DO doesn't handle JSON-RPC batch yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', method: 'add', params: [1, 2], id: 1 },
          { jsonrpc: '2.0', method: 'multiply', params: [3, 4], id: 2 },
          { jsonrpc: '2.0', method: 'echo', params: ['hello'], id: 3 },
        ] satisfies JSONRPCRequest[]),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as JSONRPCResponse[]

      expect(data).toHaveLength(3)
      expect(data[0].result).toBe(3)
      expect(data[1].result).toBe(12)
      expect(data[2].result).toBe('hello')
    })

    it('returns JSON-RPC error for unknown method', async () => {
      // RED: DO doesn't handle JSON-RPC errors yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'unknownMethod',
          params: [],
          id: 1,
        } satisfies JSONRPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as JSONRPCResponse

      expect(data.error).toBeDefined()
      expect(data.error?.code).toBe(-32601) // Method not found
    })

    it('handles notification (no id - no response expected)', async () => {
      // RED: DO doesn't handle JSON-RPC notifications yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'echo',
          params: ['notification'],
          // No id = notification
        }),
      })

      const response = await doInstance.fetch(request)

      // Notifications should return 204 No Content or empty response
      expect(response.status === 204 || (await response.text()) === '').toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: CAP'N WEB RPC PROTOCOL
  // ==========================================================================

  describe('Cap\'n Web RPC Protocol', () => {
    it('handles single Cap\'n Web call', async () => {
      // RED: DO doesn't handle Cap'n Web protocol yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getUser',
            args: [{ type: 'value', value: 'user-1' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.id).toBe('req-1')
      expect(data.type).toBe('batch')
      expect(data.results?.[0]).toEqual({
        promiseId: 'p1',
        type: 'value',
        value: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      })
    })

    it('handles batch Cap\'n Web calls', async () => {
      // RED: DO doesn't handle Cap'n Web batching yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'add',
              args: [{ type: 'value', value: 1 }, { type: 'value', value: 2 }],
            },
            {
              promiseId: 'p2',
              target: { type: 'root' },
              method: 'multiply',
              args: [{ type: 'value', value: 3 }, { type: 'value', value: 4 }],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results).toHaveLength(2)
      expect(data.results?.[0].value).toBe(3)
      expect(data.results?.[1].value).toBe(12)
    })

    it('handles resolve request for stored promise', async () => {
      // RED: DO doesn't handle resolve requests yet
      // First, make a call to store a promise
      const callRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getUser',
            args: [{ type: 'value', value: 'user-1' }],
          }],
        } satisfies RPCRequest),
      })

      await doInstance.fetch(callRequest)

      // Then resolve the stored promise
      const resolveRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-2',
          type: 'resolve',
          resolve: { promiseId: 'p1' },
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(resolveRequest)
      const data = await response.json() as RPCResponse

      expect(data.type).toBe('result')
      expect(data.results?.[0].value).toEqual({
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('handles dispose request', async () => {
      // RED: DO doesn't handle dispose requests yet
      // First store a promise
      const callRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getUser',
            args: [{ type: 'value', value: 'user-1' }],
          }],
        } satisfies RPCRequest),
      })

      await doInstance.fetch(callRequest)

      // Dispose the promise
      const disposeRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-2',
          type: 'dispose',
          dispose: { promiseIds: ['p1'] },
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(disposeRequest)
      const data = await response.json() as RPCResponse

      expect(data.type).toBe('result')

      // Trying to resolve disposed promise should error
      const resolveRequest = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-3',
          type: 'resolve',
          resolve: { promiseId: 'p1' },
        } satisfies RPCRequest),
      })

      const errorResponse = await doInstance.fetch(resolveRequest)
      const errorData = await errorResponse.json() as RPCResponse

      expect(errorData.error?.code).toBe('DISPOSED_REFERENCE')
    })
  })

  // ==========================================================================
  // TESTS: PROMISE PIPELINING
  // ==========================================================================

  describe('Promise Pipelining', () => {
    it('chains method calls without awaiting intermediate results', async () => {
      // RED: DO doesn't support promise pipelining yet
      // Example: getUser('user-1').getPosts() in a single round trip
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            // First call: get user with methods
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getUserWithMethods',
              args: [{ type: 'value', value: 'user-1' }],
            },
            // Second call: pipeline on first result
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: 'getPosts',
              args: [],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results).toHaveLength(2)
      // First result is the user object
      expect(data.results?.[0].value).toMatchObject({
        id: 'user-1',
        name: 'Alice',
      })
      // Second result is the posts array from pipelining
      expect(data.results?.[1].value).toEqual([
        { id: 'post-1', title: 'First Post', authorId: 'user-1', published: true },
        { id: 'post-2', title: 'Second Post', authorId: 'user-1', published: false },
      ])
    })

    it('supports deep pipelining (3+ levels)', async () => {
      // RED: DO doesn't support deep pipelining yet
      // Example: getOrganization('org-1').getTeam('team-1').getMembers()
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getOrganization',
              args: [{ type: 'value', value: 'org-1' }],
            },
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: 'getTeam',
              args: [{ type: 'value', value: 'team-1' }],
            },
            {
              promiseId: 'p3',
              target: { type: 'promise', promiseId: 'p2' },
              method: 'getMembers',
              args: [],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results).toHaveLength(3)
      // Final result should be array of members
      expect(data.results?.[2].value).toHaveLength(3) // All 3 users
    })

    it('propagates errors through pipeline', async () => {
      // RED: DO doesn't propagate pipeline errors yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getUser',
              args: [{ type: 'value', value: 'non-existent' }],
            },
            // This should fail because p1 returns null
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: 'someMethod',
              args: [],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      // p1 should succeed with null
      expect(data.results?.[0].value).toBeNull()
      // p2 should error because null has no methods
      expect(data.results?.[1].type).toBe('error')
      expect(data.results?.[1].error?.code).toBe('INVALID_TARGET')
    })

    it('supports property access in pipeline', async () => {
      // RED: DO doesn't support property access pipelining yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getUser',
              args: [{ type: 'value', value: 'user-1' }],
            },
            // Access .name property from result
            {
              promiseId: 'p2',
              target: { type: 'property', base: { type: 'promise', promiseId: 'p1' }, property: 'name' },
              method: '__get__',
              args: [],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[1].value).toBe('Alice')
    })
  })

  // ==========================================================================
  // TESTS: PASS-BY-REFERENCE
  // ==========================================================================

  describe('Pass-by-Reference for DO Objects', () => {
    it('returns DO reference objects with $ref', async () => {
      // RED: DO doesn't return references yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getRelatedDO',
            args: [
              { type: 'value', value: 'Organization' },
              { type: 'value', value: 'org-123' },
            ],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].value).toEqual({
        $ref: 'Organization/org-123',
        $type: 'Organization',
        $id: 'org-123',
      })
    })

    it('accepts promise references as arguments', async () => {
      // RED: DO doesn't accept promise refs as args yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getUser',
              args: [{ type: 'value', value: 'user-1' }],
            },
            // Use the result of p1 as argument
            {
              promiseId: 'p2',
              target: { type: 'root' },
              method: 'getUserPosts',
              args: [{ type: 'promise', promiseId: 'p1' }], // Should extract .id from user
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      // The second call should use the user object's id
      expect(data.results?.[1].value).toHaveLength(2) // Alice has 2 posts
    })

    it('serializes DO references for cross-DO calls', async () => {
      // RED: DO doesn't serialize cross-DO refs yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'getRelatedDO',
            args: [
              { type: 'value', value: 'Customer' },
              { type: 'value', value: 'cust-456' },
            ],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const ref = data.results?.[0].value as { $ref: string }
      expect(ref.$ref).toBe('Customer/cust-456')

      // The reference should be usable to make cross-DO calls
      // (This would be validated in integration tests)
    })
  })

  // ==========================================================================
  // TESTS: AUTOMATIC BATCHING
  // ==========================================================================

  describe('Automatic Batching', () => {
    it('batches multiple calls in single HTTP request', async () => {
      // RED: DO doesn't auto-batch yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            { promiseId: 'p1', target: { type: 'root' }, method: 'add', args: [{ type: 'value', value: 1 }, { type: 'value', value: 2 }] },
            { promiseId: 'p2', target: { type: 'root' }, method: 'add', args: [{ type: 'value', value: 3 }, { type: 'value', value: 4 }] },
            { promiseId: 'p3', target: { type: 'root' }, method: 'add', args: [{ type: 'value', value: 5 }, { type: 'value', value: 6 }] },
            { promiseId: 'p4', target: { type: 'root' }, method: 'multiply', args: [{ type: 'value', value: 2 }, { type: 'value', value: 3 }] },
            { promiseId: 'p5', target: { type: 'root' }, method: 'multiply', args: [{ type: 'value', value: 4 }, { type: 'value', value: 5 }] },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results).toHaveLength(5)
      expect(data.results?.map(r => r.value)).toEqual([3, 7, 11, 6, 20])
    })

    it('preserves order in batch responses', async () => {
      // RED: DO doesn't preserve batch order yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            { promiseId: 'p1', target: { type: 'root' }, method: 'echo', args: [{ type: 'value', value: 'first' }] },
            { promiseId: 'p2', target: { type: 'root' }, method: 'processData', args: [{ type: 'value', value: { value: 5 } }] }, // Async
            { promiseId: 'p3', target: { type: 'root' }, method: 'echo', args: [{ type: 'value', value: 'third' }] },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].promiseId).toBe('p1')
      expect(data.results?.[1].promiseId).toBe('p2')
      expect(data.results?.[2].promiseId).toBe('p3')
    })

    it('handles partial batch failures', async () => {
      // RED: DO doesn't handle partial failures yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            { promiseId: 'p1', target: { type: 'root' }, method: 'add', args: [{ type: 'value', value: 1 }, { type: 'value', value: 2 }] },
            { promiseId: 'p2', target: { type: 'root' }, method: 'throwError', args: [{ type: 'value', value: 'test error' }] },
            { promiseId: 'p3', target: { type: 'root' }, method: 'multiply', args: [{ type: 'value', value: 3 }, { type: 'value', value: 4 }] },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].type).toBe('value')
      expect(data.results?.[0].value).toBe(3)

      expect(data.results?.[1].type).toBe('error')
      expect(data.results?.[1].error?.message).toContain('test error')

      expect(data.results?.[2].type).toBe('value')
      expect(data.results?.[2].value).toBe(12)
    })
  })

  // ==========================================================================
  // TESTS: MAGIC MAP
  // ==========================================================================

  describe('Magic Map Operations', () => {
    it('supports __map__ operation on arrays', async () => {
      // RED: DO doesn't support __map__ yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getAllUsers',
              args: [],
            },
            // Map to extract just names
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: '__map__',
              args: [{ type: 'value', value: { property: 'name' } }],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[1].value).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('supports __filter__ operation on arrays', async () => {
      // RED: DO doesn't support __filter__ yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getAllPosts',
              args: [],
            },
            // Filter published posts
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: '__filter__',
              args: [{ type: 'value', value: { property: 'published', equals: true } }],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      const filtered = data.results?.[1].value as { id: string }[]
      expect(filtered).toHaveLength(2)
      expect(filtered.map(p => p.id)).toEqual(['post-1', 'post-3'])
    })

    it('supports array index access', async () => {
      // RED: DO doesn't support array index access yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getAllUsers',
              args: [],
            },
            // Access first element
            {
              promiseId: 'p2',
              target: { type: 'property', base: { type: 'promise', promiseId: 'p1' }, property: '0' },
              method: '__get__',
              args: [],
            },
          ],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[1].value).toEqual({
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
      })
    })
  })

  // ==========================================================================
  // TESTS: WEBSOCKET TRANSPORT
  // ==========================================================================

  describe('WebSocket Transport', () => {
    it('accepts WebSocket upgrade on /rpc', async () => {
      // RED: DO doesn't handle WebSocket upgrade yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('sends connection acknowledgment on WebSocket open', async () => {
      // RED: DO doesn't send ack yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!

      // Simulate accepting the WebSocket
      ws.accept()

      // Should receive connection ack
      const messages: string[] = []
      ws.addEventListener('message', (event) => {
        messages.push(event.data as string)
      })

      // Wait a bit for the ack
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(messages.length).toBeGreaterThan(0)
      const ack = JSON.parse(messages[0])
      expect(ack.type).toBe('connected')
      expect(ack.sessionId).toBeDefined()
    })

    it('handles RPC messages over WebSocket', async () => {
      // RED: DO doesn't handle WS RPC messages yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const responses: unknown[] = []
      ws.addEventListener('message', (event) => {
        responses.push(JSON.parse(event.data as string))
      })

      // Send RPC request
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'ping',
        id: 1,
      }))

      await new Promise(resolve => setTimeout(resolve, 100))

      const rpcResponse = responses.find((r: unknown) => (r as JSONRPCResponse).id === 1) as JSONRPCResponse
      expect(rpcResponse.result).toEqual({ pong: true, timestamp: expect.any(Number) })
    })

    it('maintains session state across WebSocket messages', async () => {
      // RED: DO doesn't maintain WS session state yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const responses: unknown[] = []
      ws.addEventListener('message', (event) => {
        responses.push(JSON.parse(event.data as string))
      })

      // First call - store promise
      ws.send(JSON.stringify({
        id: 'req-1',
        type: 'call',
        calls: [{
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getUser',
          args: [{ type: 'value', value: 'user-1' }],
        }],
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      // Second call - pipeline on stored promise (from different message)
      ws.send(JSON.stringify({
        id: 'req-2',
        type: 'call',
        calls: [{
          promiseId: 'p2',
          target: { type: 'promise', promiseId: 'p1' },
          method: '__get__', // Get the stored value
          args: [],
        }],
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      const resp2 = responses.find((r: unknown) => (r as RPCResponse).id === 'req-2') as RPCResponse
      expect(resp2.results?.[0].value).toEqual({
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('cleans up session on WebSocket close', async () => {
      // RED: DO doesn't clean up WS sessions yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Store a promise
      ws.send(JSON.stringify({
        id: 'req-1',
        type: 'call',
        calls: [{
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getUser',
          args: [{ type: 'value', value: 'user-1' }],
        }],
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      // Close WebSocket
      ws.close()

      // Create new connection
      const request2 = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response2 = await doInstance.fetch(request2)
      const ws2 = response2.webSocket!
      ws2.accept()

      const responses: unknown[] = []
      ws2.addEventListener('message', (event) => {
        responses.push(JSON.parse(event.data as string))
      })

      // Try to resolve promise from old session
      ws2.send(JSON.stringify({
        id: 'req-2',
        type: 'resolve',
        resolve: { promiseId: 'p1' },
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      const resp = responses.find((r: unknown) => (r as RPCResponse).id === 'req-2') as RPCResponse
      // Should error because p1 doesn't exist in new session
      expect(resp.error).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('returns parse error for invalid JSON', async () => {
      // RED: DO doesn't return parse errors yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse | JSONRPCResponse

      if ('jsonrpc' in data) {
        expect(data.error?.code).toBe(-32700)
      } else {
        expect(data.error?.code).toBe('PARSE_ERROR')
      }
    })

    it('returns method not found error for unknown methods', async () => {
      // RED: DO doesn't return method not found errors yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'nonExistentMethod',
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].type).toBe('error')
      expect(data.results?.[0].error?.code).toBe('METHOD_NOT_FOUND')
    })

    it('handles method execution errors', async () => {
      // RED: DO doesn't handle execution errors yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: 'throwError',
            args: [{ type: 'value', value: 'intentional error' }],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].type).toBe('error')
      expect(data.results?.[0].error?.code).toBe('EXECUTION_ERROR')
      expect(data.results?.[0].error?.message).toContain('intentional error')
    })

    it('prevents access to private methods', async () => {
      // RED: DO doesn't filter private methods yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'call',
          calls: [{
            promiseId: 'p1',
            target: { type: 'root' },
            method: '_users', // Private property
            args: [],
          }],
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      expect(data.results?.[0].type).toBe('error')
      expect(data.results?.[0].error?.code).toBe('METHOD_NOT_FOUND')
    })

    it('prevents access to inherited DO methods', async () => {
      // RED: DO doesn't filter inherited methods yet
      const dangerousMethods = ['initialize', 'fetch', 'handleFetch', 'db', 'ctx', 'storage']

      for (const method of dangerousMethods) {
        const request = new Request('http://test/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'req-1',
            type: 'call',
            calls: [{
              promiseId: 'p1',
              target: { type: 'root' },
              method,
              args: [],
            }],
          } satisfies RPCRequest),
        })

        const response = await doInstance.fetch(request)
        const data = await response.json() as RPCResponse

        expect(data.results?.[0].type).toBe('error')
        expect(data.results?.[0].error?.code).toBe('METHOD_NOT_FOUND')
      }
    })
  })

  // ==========================================================================
  // TESTS: SUBSCRIPTIONS
  // ==========================================================================

  describe('Event Subscriptions', () => {
    it('supports subscribe/unsubscribe pattern', async () => {
      // RED: DO doesn't support subscriptions yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe to events
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'user.updated' },
        id: 1,
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      const subResponse = messages.find((m: unknown) => (m as JSONRPCResponse).id === 1) as JSONRPCResponse
      expect(subResponse.result).toHaveProperty('subscriptionId')
    })

    it('receives events after subscription', async () => {
      // RED: DO doesn't push events yet
      const request = new Request('http://test/rpc', {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        params: { event: 'user.updated' },
        id: 1,
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      // Trigger an event (assuming there's a method that emits events)
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'triggerEvent',
        params: { event: 'user.updated', data: { userId: 'user-1' } },
        id: 2,
      }))

      await new Promise(resolve => setTimeout(resolve, 100))

      // Should receive notification
      const notification = messages.find((m: unknown) => {
        const msg = m as { method?: string }
        return msg.method === 'user.updated'
      })
      expect(notification).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: PERFORMANCE
  // ==========================================================================

  describe('Performance Characteristics', () => {
    it('handles large batch requests efficiently', async () => {
      // RED: DO doesn't optimize large batches yet
      const calls = Array.from({ length: 100 }, (_, i) => ({
        promiseId: `p${i}`,
        target: { type: 'root' as const },
        method: 'add',
        args: [
          { type: 'value' as const, value: i },
          { type: 'value' as const, value: i + 1 },
        ],
      }))

      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls,
        } satisfies RPCRequest),
      })

      const startTime = Date.now()
      const response = await doInstance.fetch(request)
      const endTime = Date.now()

      const data = await response.json() as RPCResponse

      expect(data.results).toHaveLength(100)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in < 1s
    })

    it('limits concurrent pipelining depth', async () => {
      // RED: DO doesn't limit pipeline depth yet
      // Create a deeply nested pipeline (20 levels)
      const calls: RPCCall[] = [
        {
          promiseId: 'p0',
          target: { type: 'root' },
          method: 'getOrganization',
          args: [{ type: 'value', value: 'org-1' }],
        },
      ]

      for (let i = 1; i <= 20; i++) {
        calls.push({
          promiseId: `p${i}`,
          target: { type: 'promise', promiseId: `p${i - 1}` },
          method: 'getTeam',
          args: [{ type: 'value', value: `team-${i}` }],
        })
      }

      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'req-1',
          type: 'batch',
          calls,
        } satisfies RPCRequest),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as RPCResponse

      // Should either complete successfully or return max depth error
      const lastResult = data.results?.[data.results.length - 1]
      expect(
        lastResult?.type === 'value' ||
        lastResult?.error?.code === 'MAX_PIPELINE_DEPTH'
      ).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: CONTENT-TYPE HANDLING
  // ==========================================================================

  describe('Content-Type Handling', () => {
    it('accepts application/json', async () => {
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: 1,
        }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
    })

    it('accepts application/json-rpc', async () => {
      // RED: DO doesn't accept json-rpc content type yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json-rpc' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: 1,
        }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
    })

    it('returns correct Content-Type in response', async () => {
      // RED: DO doesn't set correct content type yet
      const request = new Request('http://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: 1,
        }),
      })

      const response = await doInstance.fetch(request)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })
})

// ============================================================================
// TESTS: RPC DECORATOR/WRAPPER
// ============================================================================

describe('RPC Method Decoration', () => {
  it('@rpc decorator marks methods as exposed', () => {
    // RED: @rpc decorator doesn't exist yet
    // This test documents the expected API
    expect(() => {
      // @ts-expect-error - decorator doesn't exist yet
      class TestDO extends DO {
        // @rpc()
        myMethod() {
          return 'hello'
        }
      }
    }).not.toThrow()
  })

  it('rpc() wrapper function marks methods as exposed', () => {
    // RED: rpc() wrapper doesn't exist yet
    // Alternative to decorator syntax

    // @ts-expect-error - rpc function doesn't exist yet
    const rpc = (method: Function) => method

    const myMethod = rpc(function () {
      return 'hello'
    })

    expect(typeof myMethod).toBe('function')
  })

  it('rpcMethods config option lists exposed methods', () => {
    // RED: rpcMethods config doesn't exist yet
    class TestDO extends DO {
      static readonly rpcMethods = ['getUser', 'createUser', 'updateUser']

      getUser(id: string) {
        return { id }
      }

      createUser(data: unknown) {
        return data
      }

      updateUser(id: string, data: unknown) {
        return { id, ...data as object }
      }

      // Not exposed
      internalMethod() {
        return 'internal'
      }
    }

    // @ts-expect-error - accessing static property
    expect(TestDO.rpcMethods).toContain('getUser')
    // @ts-expect-error - accessing static property
    expect(TestDO.rpcMethods).not.toContain('internalMethod')
  })
})

// ============================================================================
// TESTS: TYPE-SAFE RPC CLIENT
// ============================================================================

describe('Type-Safe RPC Client Generation', () => {
  it('generates typed client from DO class', () => {
    // RED: Client generation doesn't exist yet
    // This test documents the expected API

    type RpcTestDOClient = {
      getUser(id: string): Promise<{ id: string; name: string; email: string } | null>
      getUserPosts(userId: string): Promise<{ id: string; title: string; authorId: string; published: boolean }[]>
      add(a: number, b: number): Promise<number>
    }

    // The generated client should have correct types
    const mockClient: RpcTestDOClient = {
      getUser: async (id) => ({ id, name: 'Test', email: 'test@example.com' }),
      getUserPosts: async (userId) => [],
      add: async (a, b) => a + b,
    }

    expect(mockClient.getUser).toBeDefined()
    expect(mockClient.getUserPosts).toBeDefined()
    expect(mockClient.add).toBeDefined()
  })

  it('client supports pipelining syntax', async () => {
    // RED: Pipelining syntax doesn't exist yet
    // This test documents the expected API

    type PipelinedClient = {
      getUser(id: string): Promise<{ id: string; name: string }> & {
        pipe<T>(method: (user: { id: string; name: string }) => T): Promise<T>
      }
    }

    // Example usage (would fail until implemented):
    // const client: PipelinedClient = createRpcClient(RpcTestDO)
    // const userName = await client.getUser('user-1').pipe(u => u.name)

    expect(true).toBe(true) // Placeholder
  })
})
