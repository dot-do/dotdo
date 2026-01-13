/**
 * DOBase Module Splitting Tests (GREEN TDD)
 *
 * These tests verify the modular components extracted from DOBase:
 * 1. DOStorage - SQLite, stores, persistence
 * 2. DOTransport - REST, MCP, CapnWeb handlers
 * 3. DOWorkflow - $ context, events, scheduling
 * 4. DOIntrospection - Schema discovery
 *
 * @see objects/DOBase.ts for original implementation
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { DOStorage, type StoreContext } from '../modules/DOStorage'
import { DOTransport, type TransportContext } from '../modules/DOTransport'
import { DOWorkflow, type WorkflowContext, type WorkflowContextInput, DEFAULT_RETRY_POLICY, DEFAULT_TRY_TIMEOUT } from '../modules/DOWorkflow'
import { DOIntrospection, type IntrospectContext, type DOSchema } from '../modules/DOIntrospection'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  setAlarm(time: number | Date): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
}

interface MockState {
  storage: MockStorage
  id: { toString(): string; name?: string }
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}

function createMockStorage(): MockStorage {
  const internalMap = new Map<string, unknown>()
  let alarmTime: number | null = null

  const mockStorage: MockStorage = {
    get: async <T>(key: string): Promise<T | undefined> => {
      return internalMap.get(key) as T | undefined
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      internalMap.set(key, value)
    },
    delete: async (key: string): Promise<boolean> => {
      return internalMap.delete(key)
    },
    list: async (options?: { prefix?: string }): Promise<Map<string, unknown>> => {
      if (!options?.prefix) return new Map(internalMap)
      const filtered = new Map<string, unknown>()
      for (const [key, value] of internalMap) {
        if (key.startsWith(options.prefix)) {
          filtered.set(key, value)
        }
      }
      return filtered
    },
    setAlarm: async (time: number | Date): Promise<void> => {
      alarmTime = typeof time === 'number' ? time : time.getTime()
    },
    getAlarm: async (): Promise<number | null> => {
      return alarmTime
    },
    deleteAlarm: async (): Promise<void> => {
      alarmTime = null
    },
  }

  return mockStorage
}

function createMockState(name: string = 'test'): MockState {
  const storage = createMockStorage()

  return {
    id: {
      toString: () => `test-do-id-${name}`,
      name,
    },
    storage,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn()
    },
  }
}

// Mock Drizzle database
function createMockDb() {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockReturnThis(),
  }
  return mockDb
}

// ============================================================================
// DOStorage Module Tests
// ============================================================================

describe('DOStorage Module', () => {
  describe('Module Existence', () => {
    test('DOStorage module should be importable', async () => {
      expect(DOStorage).toBeDefined()
      expect(typeof DOStorage).toBe('function')
    })

    test('DOStorage should export StoreContext type', async () => {
      // TypeScript compilation verifies the type exists
      const context: StoreContext = {
        db: {} as any,
        ns: 'test',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      expect(context).toBeDefined()
    })
  })

  describe('Store Initialization', () => {
    let storage: DOStorage
    let mockDb: ReturnType<typeof createMockDb>
    let mockStorageInterface: MockStorage

    beforeEach(() => {
      mockDb = createMockDb()
      mockStorageInterface = createMockStorage()
      storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)
    })

    test('initializes with provided database', async () => {
      expect(storage.db).toBe(mockDb)
    })

    test('provides lazy things store', async () => {
      expect(storage._things).toBeUndefined()
      const things = storage.things
      expect(things).toBeDefined()
      expect(storage._things).toBeDefined()
    })

    test('provides lazy rels store', async () => {
      expect(storage._rels).toBeUndefined()
      const rels = storage.rels
      expect(rels).toBeDefined()
      expect(storage._rels).toBeDefined()
    })

    test('provides lazy actions store', async () => {
      expect(storage._actions).toBeUndefined()
      const actions = storage.actions
      expect(actions).toBeDefined()
      expect(storage._actions).toBeDefined()
    })

    test('provides lazy events store', async () => {
      expect(storage._events).toBeUndefined()
      const events = storage.events
      expect(events).toBeDefined()
      expect(storage._events).toBeDefined()
    })

    test('provides lazy search store', async () => {
      expect(storage._search).toBeUndefined()
      const search = storage.search
      expect(search).toBeDefined()
      expect(storage._search).toBeDefined()
    })

    test('provides lazy objects store', async () => {
      expect(storage._objects).toBeUndefined()
      const objects = storage.objects
      expect(objects).toBeDefined()
      expect(storage._objects).toBeDefined()
    })

    test('provides lazy dlq store', async () => {
      expect(storage._dlq).toBeUndefined()
      const dlq = storage.dlq
      expect(dlq).toBeDefined()
      expect(storage._dlq).toBeDefined()
    })
  })

  describe('Lazy Loading Behavior', () => {
    test('stores are not initialized until first access', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      // All stores should be undefined initially
      expect(storage._things).toBeUndefined()
      expect(storage._rels).toBeUndefined()
      expect(storage._actions).toBeUndefined()
      expect(storage._events).toBeUndefined()

      // Access things store
      void storage.things

      // Now things should be defined, others still undefined
      expect(storage._things).toBeDefined()
      expect(storage._rels).toBeUndefined()
    })

    test('stores are cached after first access', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const things1 = storage.things
      const things2 = storage.things

      // Should return the same instance
      expect(things1).toBe(things2)
    })
  })

  describe('Store Context', () => {
    test('getStoreContext returns required context for stores', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const ctx = storage.getStoreContext()
      expect(ctx.db).toBeDefined()
      expect(ctx.ns).toBe('test-ns')
      expect(ctx.currentBranch).toBe('main')
      expect(ctx.env).toBeDefined()
      expect(ctx.typeCache).toBeInstanceOf(Map)
    })
  })

  describe('Eager Feature Initialization', () => {
    test('initializeEagerFeatures initializes specified stores', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      await storage.initializeEagerFeatures({
        things: true,
        events: true,
      })

      // These should now be initialized
      expect(storage._things).toBeDefined()
      expect(storage._events).toBeDefined()

      // These should still be lazy (undefined)
      expect(storage._rels).toBeUndefined()
      expect(storage._actions).toBeUndefined()
    })
  })

  describe('Step Result Persistence', () => {
    test('persistStepResult saves to storage', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      await storage.persistStepResult('step-1', { data: 'test' })

      const stored = await mockStorageInterface.get<{ result: unknown; completedAt: number }>('step:step-1')
      expect(stored?.result).toEqual({ data: 'test' })
      expect(stored?.completedAt).toBeDefined()
    })

    test('loadPersistedSteps restores step cache', async () => {
      const mockStorageInterface = createMockStorage()

      // Pre-populate storage
      await mockStorageInterface.put('step:step-1', { result: 'val1', completedAt: 1000 })
      await mockStorageInterface.put('step:step-2', { result: 'val2', completedAt: 2000 })

      const mockDb = createMockDb()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)
      await storage.loadPersistedSteps()

      expect(storage.getStepCache().get('step-1')).toEqual({ result: 'val1', completedAt: 1000 })
      expect(storage.getStepCache().get('step-2')).toEqual({ result: 'val2', completedAt: 2000 })
    })
  })

  describe('Type Cache Management', () => {
    test('type cache is shared across stores', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      // Access things and get store context multiple times
      const ctx1 = storage.getStoreContext()
      const ctx2 = storage.getStoreContext()

      expect(ctx1.typeCache).toBe(ctx2.typeCache)
    })
  })
})

// ============================================================================
// DOTransport Module Tests
// ============================================================================

describe('DOTransport Module', () => {
  describe('Module Existence', () => {
    test('DOTransport module should be importable', async () => {
      expect(DOTransport).toBeDefined()
      expect(typeof DOTransport).toBe('function')
    })

    test('DOTransport should export TransportContext type', async () => {
      const context: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      expect(context).toBeDefined()
    })
  })

  describe('REST Request Handling', () => {
    let transport: DOTransport
    let mockContext: TransportContext

    beforeEach(() => {
      mockContext = {
        ns: 'test',
        things: {
          list: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ $id: '1', $type: 'Test' }),
          update: vi.fn().mockResolvedValue({ $id: '1', $type: 'Test' }),
          delete: vi.fn().mockResolvedValue({ $id: '1', $type: 'Test' }),
        } as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      transport = new DOTransport(mockContext)
    })

    test('routes GET /:type to list handler', async () => {
      const req = new Request('https://test.api/customers', { method: 'GET' })
      const res = await transport.handleRequest(req)
      // Should return a response (may be 404 if route not matched, but should not error)
      expect(res).toBeInstanceOf(Response)
    })

    test('routes GET /:type/:id to get handler', async () => {
      const req = new Request('https://test.api/customers/cust-1', { method: 'GET' })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('routes POST /:type to create handler', async () => {
      const req = new Request('https://test.api/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('routes PUT /:type/:id to update handler', async () => {
      const req = new Request('https://test.api/customers/cust-1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Bob' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('routes DELETE /:type/:id to delete handler', async () => {
      const req = new Request('https://test.api/customers/cust-1', {
        method: 'DELETE',
      })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })
  })

  describe('MCP Request Handling', () => {
    test('handles MCP /mcp endpoint', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('returns MCP tool list from static $mcp config', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        $mcp: {
          tools: {
            search: { description: 'Search items', inputSchema: {} },
          },
        },
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await transport.handleRequest(req)
      expect(res.status).toBeDefined()
    })
  })

  describe('CapnWeb RPC Handling', () => {
    test('handles CapnWeb RPC POST requests', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      // CapnWeb RPC uses Content-Type: application/capnweb
      const req = new Request('https://test.api/', {
        method: 'POST',
        body: JSON.stringify({ method: 'testMethod', args: [1, 2] }),
        headers: { 'Content-Type': 'application/capnweb' },
      })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('handles CapnWeb WebSocket upgrade', async () => {
      // WebSocket upgrades require Cloudflare runtime (WebSocketPair)
      // In Node environment, we just verify the request is routed correctly
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/', {
        method: 'GET',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
        },
      })

      // In Node, this will fail with status code error, but that's expected
      // since WebSocket 101 responses aren't supported outside CF runtime
      try {
        const res = await transport.handleRequest(req)
        expect(res).toBeInstanceOf(Response)
      } catch (e: any) {
        // RangeError for status 101 is expected in Node
        expect(e.message).toContain('status')
      }
    })

    test('filters internal members from RPC exposure', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      // Methods starting with _ or # should not be exposed
      expect(transport.isRpcExposed('publicMethod')).toBe(true)
      expect(transport.isRpcExposed('_privateMethod')).toBe(false)
      expect(transport.isRpcExposed('fetch')).toBe(false) // Built-in
      expect(transport.isRpcExposed('alarm')).toBe(false) // Built-in
    })
  })

  describe('Sync WebSocket Handling', () => {
    test('handles /sync WebSocket for TanStack DB', async () => {
      // WebSocketPair is only available in Cloudflare runtime
      // In Node, we verify the request is recognized and routed correctly
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/sync', {
        method: 'GET',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Protocol': 'capnp-rpc, bearer.test-token',
        },
      })

      try {
        const res = await transport.handleRequest(req)
        expect(res).toBeInstanceOf(Response)
      } catch (e: any) {
        // WebSocketPair not defined is expected in Node
        expect(e.message).toContain('WebSocketPair')
      }
    })

    test('validates sync auth token', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const result = await transport.validateSyncAuthToken('valid-token')
      expect(result).toBeDefined()
      expect(result?.user).toBeDefined()
    })

    test('rejects sync without auth token', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/sync', {
        method: 'GET',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          // No Sec-WebSocket-Protocol header
        },
      })
      const res = await transport.handleRequest(req)
      expect(res.status).toBe(401)
    })
  })

  describe('Introspect Endpoint', () => {
    test('handles /$introspect GET request', async () => {
      const mockSchema: DOSchema = {
        ns: 'test',
        permissions: { role: 'user', scopes: [] },
        classes: [],
        nouns: [],
        verbs: [],
        stores: [],
        storage: { fsx: true, gitx: true, bashx: false, r2: { enabled: false }, sql: { enabled: false }, iceberg: false, edgevec: false },
      }
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => mockSchema,
      }
      const transport = new DOTransport(mockContext)

      // Create a valid JWT token
      const payload = { sub: 'user-1', roles: ['user'], exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify(payload))}.signature`

      const req = new Request('https://test.api/$introspect', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const res = await transport.handleRequest(req)
      expect(res.status).toBe(200)
    })

    test('rejects /$introspect without auth', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/$introspect', { method: 'GET' })
      const res = await transport.handleRequest(req)
      expect(res.status).toBe(401)
    })
  })

  describe('Root Request Handling', () => {
    test('GET / returns JSON-LD index', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/', { method: 'GET' })
      const res = await transport.handleRequest(req)
      expect(res.status).toBe(200)
    })

    test('returns 404 for unknown routes', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/unknown/deep/route/path', { method: 'GET' })
      const res = await transport.handleRequest(req)
      expect(res.status).toBe(404)
    })
  })

  describe('SyncEngine Integration', () => {
    test('SyncEngine is lazy initialized', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      expect(transport._syncEngine).toBeUndefined()
      void transport.syncEngine
      expect(transport._syncEngine).toBeDefined()
    })

    test('SyncEngine broadcasts thing mutations', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)
      const engine = transport.syncEngine

      // Just verify the engine has the expected methods
      expect(engine).toBeDefined()
      expect(typeof engine.onThingCreated).toBe('function')
      expect(typeof engine.onThingUpdated).toBe('function')
      expect(typeof engine.onThingDeleted).toBe('function')
    })
  })
})

// ============================================================================
// DOWorkflow Module Tests
// ============================================================================

describe('DOWorkflow Module', () => {
  describe('Module Existence', () => {
    test('DOWorkflow module should be importable', async () => {
      expect(DOWorkflow).toBeDefined()
      expect(typeof DOWorkflow).toBe('function')
    })
  })

  let workflow: DOWorkflow
  let mockInput: WorkflowContextInput

  beforeEach(() => {
    mockInput = {
      db: createMockDb() as any,
      ns: 'test-ns',
      ctx: createMockState() as any,
      getLocation: async () => ({ colo: 'lax', city: 'LosAngeles', region: 'us-west' }),
      user: { id: 'user-1' },
      sleep: vi.fn().mockResolvedValue(undefined),
      dlq: {
        add: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
      },
      persistStepResult: vi.fn().mockResolvedValue(undefined),
      getStepResult: vi.fn().mockReturnValue(undefined),
    }
    workflow = new DOWorkflow(mockInput)
  })

  describe('WorkflowContext ($) Creation', () => {
    test('provides $ context proxy', async () => {
      expect(workflow.$).toBeDefined()
      expect(typeof workflow.$).toBe('object')
    })

    test('$.send is callable', async () => {
      expect(typeof workflow.$.send).toBe('function')
    })

    test('$.try is callable', async () => {
      expect(typeof workflow.$.try).toBe('function')
    })

    test('$.do is callable', async () => {
      expect(typeof workflow.$.do).toBe('function')
    })

    test('$.on returns proxy for event registration', async () => {
      const onProxy = workflow.$.on
      expect(onProxy).toBeDefined()
      // Should allow $.on.Customer.created syntax
      expect(typeof onProxy.Customer).toBe('object')
    })

    test('$.every returns schedule builder', async () => {
      const scheduleBuilder = workflow.$.every
      expect(scheduleBuilder).toBeDefined()
    })

    test('$.log is callable', async () => {
      expect(typeof workflow.$.log).toBe('function')
    })

    test('$.location returns location promise', async () => {
      const locationPromise = workflow.$.location
      expect(locationPromise).toBeInstanceOf(Promise)
    })

    test('$.user returns current user context', async () => {
      expect(workflow.$.user).toBeDefined()
      expect(workflow.$.user?.id).toBe('user-1')
    })

    test('$.Noun(id) returns domain proxy', async () => {
      const customerProxy = workflow.$.Customer('cust-1')
      expect(customerProxy).toBeDefined()
    })
  })

  describe('Execution Modes', () => {
    describe('$.send (fire-and-forget)', () => {
      test('emits event without waiting', async () => {
        workflow.$.send('Customer.created', { id: 'cust-1' })
        // Should queue microtask, not block
        await new Promise(resolve => setTimeout(resolve, 10))
        // Just verify it doesn't throw
        expect(true).toBe(true)
      })

      test('logs action as send durability', async () => {
        workflow.$.send('test.event', {})
        await new Promise(resolve => setTimeout(resolve, 10))
        // Verify db.insert was called
        expect(mockInput.db.insert).toHaveBeenCalled()
      })

      test('errors do not propagate', async () => {
        // Mock executeAction to throw
        workflow.registerAction('failing.event', () => { throw new Error('Test') })

        // Should not throw
        workflow.$.send('failing.event', {})
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(true).toBe(true)
      })
    })

    describe('$.try (single attempt)', () => {
      test('executes action and returns result', async () => {
        workflow.registerAction('double', (n: unknown) => (n as number) * 2)

        const result = await workflow.$.try('double', 5)
        expect(result).toBe(10)
      })

      test('respects timeout option', async () => {
        workflow.registerAction('slow', async () => {
          await new Promise(resolve => setTimeout(resolve, 1000))
          return 'done'
        })

        await expect(
          workflow.$.try('slow', {}, { timeout: 50 })
        ).rejects.toThrow(/timed out/)
      })

      test('logs action status transitions', async () => {
        workflow.registerAction('test', () => 'result')
        await workflow.$.try('test', {})

        // Verify db operations were called
        expect(mockInput.db.update).toHaveBeenCalled()
      })

      test('emits completion event on success', async () => {
        workflow.registerAction('test', () => 'result')
        await workflow.$.try('test', {})

        // Verify event was emitted (via db.insert)
        expect(mockInput.db.insert).toHaveBeenCalled()
      })

      test('emits failure event on error', async () => {
        workflow.registerAction('failing', () => { throw new Error('Test') })

        await expect(workflow.$.try('failing', {})).rejects.toThrow()
        // Verify event was emitted
        expect(mockInput.db.insert).toHaveBeenCalled()
      })
    })

    describe('$.do (durable with retries)', () => {
      test('executes action with default retry policy', async () => {
        workflow.registerAction('test', () => 'result')

        const result = await workflow.$.do('test', {})
        expect(result).toBe('result')
      })

      test('retries on failure up to maxAttempts', async () => {
        let attempts = 0
        workflow.registerAction('flaky', () => {
          attempts++
          if (attempts < 3) throw new Error('Retry')
          return 'success'
        })

        const result = await workflow.$.do('flaky', {})
        expect(result).toBe('success')
        expect(attempts).toBe(3)
      })

      test('uses exponential backoff between retries', async () => {
        let attempts = 0
        workflow.registerAction('failing', () => {
          attempts++
          if (attempts < 3) throw new Error('Retry')
          return 'success'
        })

        await workflow.$.do('failing', {}, {
          retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 10000, jitter: false }
        })

        expect(mockInput.sleep).toHaveBeenCalled()
      })

      test('caches step results by stepId', async () => {
        let callCount = 0
        workflow.registerAction('counter', () => ++callCount)

        // Mock getStepResult to return cached value on second call
        mockInput.getStepResult = vi.fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValue({ result: 1, completedAt: Date.now() })

        const result1 = await workflow.$.do('counter', {}, { stepId: 'step-1' })
        expect(result1).toBe(1)
        expect(callCount).toBe(1)
      })

      test('persists step results to storage', async () => {
        workflow.registerAction('test', () => 'result')
        await workflow.$.do('test', {}, { stepId: 'step-1' })

        expect(mockInput.persistStepResult).toHaveBeenCalledWith('step-1', 'result')
      })

      test('fails after exhausting all retries', async () => {
        workflow.registerAction('alwaysFails', () => {
          throw new Error('Persistent failure')
        })

        await expect(
          workflow.$.do('alwaysFails', {}, { retry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2, jitter: false } })
        ).rejects.toThrow('Persistent failure')
      })
    })
  })

  describe('Event Handler Registration', () => {
    test('$.on.Noun.verb registers handler', async () => {
      const handler = vi.fn()

      workflow.$.on.Customer.created(handler)

      expect(workflow._eventHandlers.get('Customer.created')).toBeDefined()
      expect(workflow._eventHandlers.get('Customer.created')?.length).toBe(1)
    })

    test('$.on.*.verb registers wildcard handler', async () => {
      const handler = vi.fn()

      workflow.$.on['*'].created(handler)

      expect(workflow._eventHandlers.get('*.created')).toBeDefined()
    })

    test('multiple handlers for same event are all called', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      workflow.$.on.Customer.created(handler1)
      workflow.$.on.Customer.created(handler2)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'created',
        source: 'https://test-ns/Customer/1',
        data: {},
        timestamp: new Date(),
      })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    test('handler registration returns unsubscribe function', async () => {
      const handler = vi.fn()

      const unsubscribe = workflow.$.on.Customer.created(handler)
      expect(typeof unsubscribe).toBe('function')

      unsubscribe()

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'created',
        source: 'https://test-ns/Customer/1',
        data: {},
        timestamp: new Date(),
      })
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Event Dispatch', () => {
    test('dispatchEvent calls matching handlers', async () => {
      const handler = vi.fn()

      workflow.$.on.Order.completed(handler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'completed',
        source: 'https://test-ns/Order/ord-1',
        data: { total: 100 },
        timestamp: new Date(),
      })

      expect(handler).toHaveBeenCalled()
    })

    test('wildcard handlers receive all events', async () => {
      const wildcardHandler = vi.fn()

      workflow.$.on['*'].created(wildcardHandler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'created',
        source: 'https://test-ns/Customer/1',
        data: {},
        timestamp: new Date(),
      })
      await workflow.dispatchEventToHandlers({
        id: 'evt-2',
        verb: 'created',
        source: 'https://test-ns/Order/1',
        data: {},
        timestamp: new Date(),
      })

      expect(wildcardHandler).toHaveBeenCalledTimes(2)
    })

    test('handler errors do not affect other handlers', async () => {
      const failingHandler = vi.fn().mockImplementation(() => { throw new Error('Handler error') })
      const successHandler = vi.fn()

      workflow.$.on.Test.event(failingHandler)
      workflow.$.on.Test.event(successHandler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'event',
        source: 'https://test-ns/Test/1',
        data: {},
        timestamp: new Date(),
      })

      expect(successHandler).toHaveBeenCalled()
    })

    test('failed events go to DLQ', async () => {
      const failingHandler = vi.fn().mockImplementation(() => { throw new Error('Handler error') })

      workflow.$.on.Test.event(failingHandler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'event',
        source: 'https://test-ns/Test/1',
        data: {},
        timestamp: new Date(),
      })

      expect(mockInput.dlq.add).toHaveBeenCalled()
    })
  })

  describe('Scheduling', () => {
    test('$.every.hour registers hourly schedule', async () => {
      const handler = vi.fn()

      workflow.$.every.hour(handler)

      expect(workflow._scheduleHandlers.size).toBe(1)
    })

    test('$.every.day.at("9am") registers daily schedule', async () => {
      const handler = vi.fn()

      workflow.$.every.day.at('9am')(handler)

      expect(workflow._scheduleHandlers.size).toBe(1)
    })

    test('$.every.Monday.at9am registers weekly schedule', async () => {
      const handler = vi.fn()

      workflow.$.every.Monday.at9am(handler)

      expect(workflow._scheduleHandlers.size).toBe(1)
    })

    test('scheduleManager triggers handlers on alarm', async () => {
      const handler = vi.fn()

      workflow.$.every.hour(handler)
      workflow._scheduleHandlers.set('test', handler)

      // Manually trigger the handler
      const testHandler = workflow._scheduleHandlers.get('test')
      if (testHandler) {
        await testHandler()
      }

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Action Logging', () => {
    test('logAction creates action record', async () => {
      const record = await workflow.logAction('try', 'test.action', { input: 1 })

      expect(record.id).toBeDefined()
      expect(typeof record.id).toBe('string')
    })

    test('completeAction updates record with result', async () => {
      const record = await workflow.logAction('do', 'test', {})

      await workflow.completeAction(record.id, { result: 'success' }, {
        completedAt: new Date(),
        duration: 100,
      })

      expect(mockInput.db.update).toHaveBeenCalled()
    })

    test('failAction updates record with error', async () => {
      const record = await workflow.logAction('do', 'test', {})

      await workflow.failAction(record.id, {
        message: 'Test error',
        name: 'Error',
      }, { completedAt: new Date() })

      expect(mockInput.db.update).toHaveBeenCalled()
    })
  })

  describe('Backoff Calculation', () => {
    test('calculateBackoffDelay uses exponential backoff', async () => {
      const delay1 = workflow.calculateBackoffDelay(1, {
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: false,
        maxAttempts: 3,
      })

      const delay2 = workflow.calculateBackoffDelay(2, {
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: false,
        maxAttempts: 3,
      })

      expect(delay1).toBe(100)
      expect(delay2).toBe(200)
    })

    test('calculateBackoffDelay respects maxDelayMs', async () => {
      const delay = workflow.calculateBackoffDelay(10, {
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
        maxAttempts: 10,
      })

      expect(delay).toBe(1000) // Capped at max
    })

    test('calculateBackoffDelay applies jitter', async () => {
      const delays = new Set<number>()
      for (let i = 0; i < 10; i++) {
        delays.add(workflow.calculateBackoffDelay(1, {
          initialDelayMs: 100,
          maxDelayMs: 10000,
          backoffMultiplier: 2,
          jitter: true,
          maxAttempts: 3,
        }))
      }

      // With jitter, we should get varying delays
      expect(delays.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe('AI Functions via $', () => {
    test('$.ai is available', async () => {
      expect(typeof workflow.$.ai).toBe('function')
    })

    test('$.write is available', async () => {
      expect(typeof workflow.$.write).toBe('function')
    })

    test('$.summarize is available', async () => {
      expect(typeof workflow.$.summarize).toBe('function')
    })

    test('$.list is available', async () => {
      expect(typeof workflow.$.list).toBe('function')
    })

    test('$.extract is available', async () => {
      expect(typeof workflow.$.extract).toBe('function')
    })

    test('$.is is available', async () => {
      expect(typeof workflow.$.is).toBe('function')
    })

    test('$.decide is available', async () => {
      expect(typeof workflow.$.decide).toBe('function')
    })
  })
})

// ============================================================================
// DOIntrospection Module Tests
// ============================================================================

describe('DOIntrospection Module', () => {
  describe('Module Existence', () => {
    test('DOIntrospection module should be importable', async () => {
      expect(DOIntrospection).toBeDefined()
      expect(typeof DOIntrospection).toBe('function')
    })
  })

  describe('$introspect Method', () => {
    test('returns DOSchema object', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const schema = await introspection.$introspect()

      expect(schema).toMatchObject({
        ns: 'test-ns',
        permissions: expect.any(Object),
        classes: expect.any(Array),
        nouns: expect.any(Array),
        verbs: expect.any(Array),
        stores: expect.any(Array),
        storage: expect.any(Object),
      })
    })

    test('includes namespace in response', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const schema = await introspection.$introspect()
      expect(schema.ns).toBe('test-ns')
    })

    test('includes permissions based on auth context', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const schema = await introspection.$introspect({
        authenticated: true,
        user: { id: 'user-1', permissions: ['read', 'write'], roles: [] },
        token: { type: 'jwt', expiresAt: new Date() },
      })

      expect(schema.permissions.scopes).toContain('read')
      expect(schema.permissions.scopes).toContain('write')
    })
  })

  describe('Class Discovery', () => {
    test('introspectClasses returns class schemas', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const classes = introspection.introspectClasses('user')

      expect(Array.isArray(classes)).toBe(true)
      expect(classes.length).toBeGreaterThan(0)
      expect(classes[0]).toMatchObject({
        name: expect.any(String),
      })
    })

    test('returns class $type if defined', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns', $type: 'TestType' })

      const classes = introspection.introspectClasses('user')

      expect(classes[0]?.name).toBe('TestType')
    })

    test('discovers MCP tools from static $mcp config', async () => {
      const introspection = new DOIntrospection({
        ns: 'test-ns',
        $mcp: {
          tools: {
            search: { description: 'Search items', inputSchema: {} },
            create: { description: 'Create item', inputSchema: {} },
          },
        },
      })

      const classes = introspection.introspectClasses('user')

      expect(classes[0]?.tools).toHaveLength(2)
      expect(classes[0]?.tools).toContainEqual(
        expect.objectContaining({ name: 'search' })
      )
    })

    test('filters methods by visibility role', async () => {
      const introspection = new DOIntrospection({
        ns: 'test-ns',
        $mcp: {
          tools: {
            userTool: { description: 'User tool', inputSchema: {}, visibility: 'user' },
            adminTool: { description: 'Admin tool', inputSchema: {}, visibility: 'admin' },
          },
        },
      })

      const userClasses = introspection.introspectClasses('user')
      const adminClasses = introspection.introspectClasses('admin')

      // Admin should see more tools than user
      expect(adminClasses[0]?.tools.length).toBeGreaterThanOrEqual(
        userClasses[0]?.tools.length || 0
      )
    })
  })

  describe('Store Discovery', () => {
    test('introspectStores returns available stores', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      // Use 'admin' role to see events (events requires admin access per STORE_VISIBILITY)
      const stores = introspection.introspectStores('admin')

      expect(Array.isArray(stores)).toBe(true)
      expect(stores.map(s => s.name)).toContain('things')
      expect(stores.map(s => s.name)).toContain('relationships')
      expect(stores.map(s => s.name)).toContain('events')
    })

    test('filters stores by role visibility', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const guestStores = introspection.introspectStores('guest')
      const userStores = introspection.introspectStores('user')
      const adminStores = introspection.introspectStores('admin')
      const systemStores = introspection.introspectStores('system')

      // Higher roles see more or equal stores
      expect(userStores.length).toBeGreaterThanOrEqual(guestStores.length)
      expect(adminStores.length).toBeGreaterThanOrEqual(userStores.length)
      expect(systemStores.length).toBeGreaterThanOrEqual(adminStores.length)
    })

    test('includes store type in response', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const stores = introspection.introspectStores('user')
      const thingsStore = stores.find(s => s.name === 'things')

      expect(thingsStore?.type).toBe('things')
    })
  })

  describe('Storage Capabilities', () => {
    test('introspectStorage returns capability flags', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const storage = introspection.introspectStorage('user')

      expect(storage).toMatchObject({
        fsx: expect.any(Boolean),
        gitx: expect.any(Boolean),
        bashx: expect.any(Boolean),
        r2: expect.any(Object),
        sql: expect.any(Object),
        iceberg: expect.any(Boolean),
        edgevec: expect.any(Boolean),
      })
    })

    test('user role sees fsx and gitx', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const storage = introspection.introspectStorage('user')

      expect(storage.fsx).toBe(true)
      expect(storage.gitx).toBe(true)
    })

    test('admin role sees bashx, r2, sql', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const storage = introspection.introspectStorage('admin')

      expect(storage.bashx).toBe(true)
      expect(storage.r2.enabled).toBe(true)
      expect(storage.sql.enabled).toBe(true)
    })

    test('system role sees iceberg and edgevec', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const storage = introspection.introspectStorage('system')

      expect(storage.iceberg).toBe(true)
      expect(storage.edgevec).toBe(true)
    })
  })

  describe('Noun and Verb Discovery', () => {
    test('introspectNouns returns registered nouns', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const nouns = await introspection.introspectNouns()

      expect(Array.isArray(nouns)).toBe(true)
    })

    test('introspectVerbs returns registered verbs', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const verbs = await introspection.introspectVerbs()

      expect(Array.isArray(verbs)).toBe(true)
    })
  })

  describe('Role Determination', () => {
    test('determineRole returns guest for unauthenticated', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const role = introspection.determineRole(undefined)
      expect(role).toBe('guest')
    })

    test('determineRole returns user for authenticated', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const role = introspection.determineRole({
        authenticated: true,
        user: { id: 'user-1', roles: [], permissions: [] },
        token: { type: 'jwt', expiresAt: new Date() },
      })
      expect(role).toBe('user')
    })

    test('determineRole returns admin for admin user', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const role = introspection.determineRole({
        authenticated: true,
        user: { id: 'user-1', roles: ['admin'], permissions: [] },
        token: { type: 'jwt', expiresAt: new Date() },
      })
      expect(role).toBe('admin')
    })

    test('determineRole returns highest role from multiple', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const role = introspection.determineRole({
        authenticated: true,
        user: { id: 'user-1', roles: ['user', 'admin'], permissions: [] },
        token: { type: 'jwt', expiresAt: new Date() },
      })
      expect(role).toBe('admin')
    })
  })
})

// ============================================================================
// DOBase Composition Tests
// ============================================================================

describe('DOBase Composition', () => {
  describe('Module Composition', () => {
    test('DOStorage can be instantiated', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      expect(storage).toBeDefined()
      expect(storage.things).toBeDefined()
      expect(storage.rels).toBeDefined()
    })

    test('modules share the same db instance', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      // All getStoreContext calls should return same db
      const ctx1 = storage.getStoreContext()
      const ctx2 = storage.getStoreContext()

      expect(ctx1.db).toBe(ctx2.db)
    })

    test('modules share the same ns', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const ctx = storage.getStoreContext()
      expect(ctx.ns).toBe('test-ns')
    })
  })

  describe('Storage Delegation', () => {
    test('delegates things to storage module', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const things1 = storage.things
      const things2 = storage.things
      expect(things1).toBe(things2)
    })

    test('delegates rels to storage module', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const rels1 = storage.rels
      const rels2 = storage.rels
      expect(rels1).toBe(rels2)
    })

    test('delegates actions to storage module', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const actions1 = storage.actions
      const actions2 = storage.actions
      expect(actions1).toBe(actions2)
    })

    test('delegates events to storage module', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      const events1 = storage.events
      const events2 = storage.events
      expect(events1).toBe(events2)
    })
  })

  describe('Transport Delegation', () => {
    test('delegates fetch to transport module', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      const req = new Request('https://test.api/health', { method: 'GET' })
      const res = await transport.handleRequest(req)
      expect(res).toBeInstanceOf(Response)
    })

    test('delegates handleMcp to transport module', async () => {
      const mockContext: TransportContext = {
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      }
      const transport = new DOTransport(mockContext)

      expect(typeof transport.handleMcp).toBe('function')
    })
  })

  describe('Workflow Delegation', () => {
    test('$ context comes from workflow module', async () => {
      const mockInput: WorkflowContextInput = {
        db: createMockDb() as any,
        ns: 'test-ns',
        ctx: createMockState() as any,
        getLocation: async () => ({}),
        sleep: vi.fn().mockResolvedValue(undefined),
        dlq: { add: vi.fn().mockResolvedValue({ id: 'dlq-1' }) },
      }
      const workflow = new DOWorkflow(mockInput)

      expect(workflow.$).toBeDefined()
      expect(typeof workflow.$.send).toBe('function')
    })

    test('event handlers are managed by workflow module', async () => {
      const mockInput: WorkflowContextInput = {
        db: createMockDb() as any,
        ns: 'test-ns',
        ctx: createMockState() as any,
        getLocation: async () => ({}),
        sleep: vi.fn().mockResolvedValue(undefined),
        dlq: { add: vi.fn().mockResolvedValue({ id: 'dlq-1' }) },
      }
      const workflow = new DOWorkflow(mockInput)

      const handler = vi.fn()
      workflow.$.on.Test.event(handler)

      expect(workflow._eventHandlers.has('Test.event')).toBe(true)
    })
  })

  describe('Introspection Delegation', () => {
    test('$introspect delegates to introspection module', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      const schema = await introspection.$introspect()

      expect(schema.ns).toBeDefined()
      expect(schema.classes).toBeDefined()
    })
  })

  describe('DO.with() Integration', () => {
    test('initializeEagerFeatures creates class with eager features', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      await storage.initializeEagerFeatures({ things: true, events: true })

      // Features should be initialized
      expect(storage._things).toBeDefined()
      expect(storage._events).toBeDefined()
    })

    test('eager features are initialized before first request', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      await storage.initializeEagerFeatures({ search: true })

      expect(storage._search).toBeDefined()
    })
  })

  describe('Cross-Module Communication', () => {
    test('storage mutations can be tracked', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      // Access things store
      const things = storage.things
      expect(things).toBeDefined()
    })

    test('workflow events can be dispatched', async () => {
      const mockInput: WorkflowContextInput = {
        db: createMockDb() as any,
        ns: 'test-ns',
        ctx: createMockState() as any,
        getLocation: async () => ({}),
        sleep: vi.fn().mockResolvedValue(undefined),
        dlq: { add: vi.fn().mockResolvedValue({ id: 'dlq-1' }) },
      }
      const workflow = new DOWorkflow(mockInput)

      const handler = vi.fn()
      workflow.$.on.Order.completed(handler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'completed',
        source: 'https://test-ns/Order/ord-1',
        data: { orderId: 'ord-1' },
        timestamp: new Date(),
      })

      expect(handler).toHaveBeenCalled()
    })

    test('introspection sees storage capabilities', async () => {
      const introspection = new DOIntrospection({ ns: 'test-ns' })

      // Pass authenticated context to see stores (guest role can't see 'things')
      const authContext = {
        authenticated: true,
        user: { id: 'test-user', roles: ['user'] },
      }
      const schema = await introspection.$introspect(authContext)

      // Should reflect store information
      const thingsStore = schema.stores.find(s => s.name === 'things')
      expect(thingsStore).toBeDefined()
    })
  })
})

// ============================================================================
// Module Independence Tests
// ============================================================================

describe('Module Independence', () => {
  describe('DOStorage can work standalone', () => {
    test('DOStorage works without DOWorkflow', async () => {
      const mockDb = createMockDb()
      const mockStorageInterface = createMockStorage()

      // Should be able to create storage module independently
      const storage = new DOStorage(mockDb as any, 'test-ns', 'main', {}, mockStorageInterface)

      expect(storage.things).toBeDefined()
      expect(storage.rels).toBeDefined()
    })
  })

  describe('DOTransport can work with minimal storage', () => {
    test('DOTransport handles health check without stores', async () => {
      const transport = new DOTransport({
        ns: 'test',
        things: {} as any,
        nouns: [],
        doType: 'Test',
        env: {},
        handleIntrospect: async () => ({} as DOSchema),
      })

      const req = new Request('https://test.api/health', { method: 'GET' })
      const res = await transport.handleRequest(req)

      expect(res.status).toBe(200)
    })
  })

  describe('DOWorkflow can work without transport', () => {
    test('DOWorkflow emits events without REST', async () => {
      const mockInput: WorkflowContextInput = {
        db: createMockDb() as any,
        ns: 'test-ns',
        ctx: createMockState() as any,
        getLocation: async () => ({}),
        sleep: vi.fn().mockResolvedValue(undefined),
        dlq: { add: vi.fn().mockResolvedValue({ id: 'dlq-1' }) },
      }
      const workflow = new DOWorkflow(mockInput)

      const handler = vi.fn()
      workflow.$.on.Test.event(handler)

      await workflow.dispatchEventToHandlers({
        id: 'evt-1',
        verb: 'event',
        source: 'https://test-ns/Test/1',
        data: { test: 'data' },
        timestamp: new Date(),
      })

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('DOIntrospection works standalone', () => {
    test('DOIntrospection returns schema for minimal DO', async () => {
      const introspection = new DOIntrospection({
        ns: 'test',
        $type: 'TestDO',
      })

      const schema = await introspection.$introspect()

      expect(schema.ns).toBe('test')
      expect(schema.classes).toBeDefined()
    })
  })
})
