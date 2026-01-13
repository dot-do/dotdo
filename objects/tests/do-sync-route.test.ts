/**
 * DO /sync WebSocket Route Tests
 *
 * RED TDD: These tests verify that the DO class exposes a /sync WebSocket endpoint
 * for TanStack DB synchronization. These tests are designed to FAIL because the
 * /sync endpoint doesn't exist yet.
 *
 * The /sync endpoint should:
 * - Accept WebSocket upgrade requests
 * - Handle subscribe/unsubscribe messages
 * - Send initial data on subscribe
 * - Broadcast changes to subscribed clients
 * - Support multiple collections per connection
 * - Clean up on connection close
 * - Reject non-WebSocket requests
 *
 * Reference: packages/tanstack/src/server/engine.ts for SyncEngine
 * Reference: packages/tanstack/src/protocol.ts for message types
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'

// ============================================================================
// PROTOCOL TYPES (from packages/tanstack/src/protocol.ts)
// ============================================================================

interface SubscribeMessage {
  type: 'subscribe'
  collection: string
  branch?: string | null
  query?: {
    limit?: number
    offset?: number
  }
}

interface UnsubscribeMessage {
  type: 'unsubscribe'
  collection: string
}

interface InitialMessage {
  type: 'initial'
  collection: string
  branch: string | null
  items: Array<{
    $id: string
    $type: string
    name?: string
    data?: Record<string, unknown>
    branch?: string | null
    createdAt: string
    updatedAt: string
  }>
  txid: number
}

interface InsertMessage {
  type: 'insert'
  collection: string
  branch: string | null
  txid: number
  key: string
  data: {
    $id: string
    $type: string
    [key: string]: unknown
  }
}

interface UpdateMessage {
  type: 'update'
  collection: string
  branch: string | null
  txid: number
  key: string
  data: {
    $id: string
    $type: string
    [key: string]: unknown
  }
}

interface DeleteMessage {
  type: 'delete'
  collection: string
  branch: string | null
  txid: number
  key: string
}

type ChangeMessage = InsertMessage | UpdateMessage | DeleteMessage

type ServerMessage = InitialMessage | ChangeMessage
type ClientMessage = SubscribeMessage | UnsubscribeMessage

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
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  } as unknown as DurableObjectState
}

interface DurableObjectState {
  id: DurableObjectId
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
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

/**
 * Mock WebSocket that simulates Cloudflare Workers WebSocket
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  accept: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
  _messageHandlers: Array<(event: MessageEvent) => void>
  _closeHandlers: Array<() => void>
  simulateMessage(data: string | object): void
  simulateClose(): void
}

function createMockWebSocket(): MockWebSocket {
  const messageHandlers: Array<(event: MessageEvent) => void> = []
  const closeHandlers: Array<() => void> = []

  const ws: MockWebSocket = {
    send: vi.fn(),
    close: vi.fn(() => {
      // When close() is called, trigger all close handlers
      ws.readyState = 3 // WebSocket.CLOSED
      closeHandlers.forEach((h) => h())
    }),
    accept: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler as (event: MessageEvent) => void)
      } else if (event === 'close') {
        closeHandlers.push(handler as () => void)
      }
    }),
    removeEventListener: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    _messageHandlers: messageHandlers,
    _closeHandlers: closeHandlers,
    simulateMessage(data: string | object) {
      const eventData = typeof data === 'string' ? data : JSON.stringify(data)
      const event = { data: eventData } as MessageEvent
      messageHandlers.forEach((h) => h(event))
    },
    simulateClose() {
      ws.readyState = 3 // WebSocket.CLOSED
      closeHandlers.forEach((h) => h())
    },
  }

  return ws
}

/**
 * Mock WebSocket pair for Cloudflare DO WebSocket upgrade
 */
function createMockWebSocketPair(): [MockWebSocket, MockWebSocket] {
  const client = createMockWebSocket()
  const server = createMockWebSocket()

  // Link them so messages sent on one appear on the other
  client.send = vi.fn((data: string) => {
    server.simulateMessage(data)
  })
  server.send = vi.fn((data: string) => {
    client.simulateMessage(data)
  })

  // Link close events - when one closes, the other should get notified
  const originalClientClose = client.close
  const originalServerClose = server.close
  client.close = vi.fn(() => {
    originalClientClose()
    // Also trigger close on server
    server.simulateClose()
  })
  server.close = vi.fn(() => {
    originalServerClose()
    // Also trigger close on client
    client.simulateClose()
  })

  return [client, server]
}

// ============================================================================
// GLOBAL WEBSOCKETPAIR MOCK FOR CLOUDFLARE WORKERS RUNTIME
// ============================================================================

/**
 * Mock WebSocketPair class that mimics Cloudflare Workers runtime
 */
class MockWebSocketPairClass {
  0: MockWebSocket
  1: MockWebSocket

  constructor() {
    const [client, server] = createMockWebSocketPair()
    this[0] = client
    this[1] = server
  }

  *[Symbol.iterator]() {
    yield this[0]
    yield this[1]
  }
}

// Set up global WebSocketPair mock before tests run
// Also override Response to support status 101 and webSocket property
const OriginalResponse = globalThis.Response

class MockWSResponse {
  status: number
  webSocket: MockWebSocket | undefined
  headers: Headers
  ok: boolean
  statusText: string
  body: ReadableStream | null = null

  constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: MockWebSocket }) {
    this.status = init?.status ?? 200
    this.webSocket = init?.webSocket
    this.headers = new Headers(init?.headers)
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = init?.statusText ?? (this.status === 101 ? 'Switching Protocols' : 'OK')
  }

  json(): Promise<unknown> {
    return Promise.resolve({})
  }
}

beforeEach(() => {
  ;(globalThis as any).WebSocketPair = MockWebSocketPairClass

  // Override Response to support WebSocket upgrade responses
  ;(globalThis as any).Response = class extends OriginalResponse {
    webSocket?: MockWebSocket

    constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: MockWebSocket }) {
      // Use status 200 for the underlying Response if it's a WebSocket upgrade
      const isWebSocketUpgrade = init?.status === 101
      const adjustedInit = isWebSocketUpgrade ? { ...init, status: 200 } : init

      super(body, adjustedInit)

      if (isWebSocketUpgrade) {
        // Override the status property
        Object.defineProperty(this, 'status', { value: 101, writable: false })
        Object.defineProperty(this, 'statusText', { value: 'Switching Protocols', writable: false })
      }

      if (init?.webSocket) {
        this.webSocket = init.webSocket
      }
    }

    static json(data: unknown, init?: ResponseInit): Response {
      return OriginalResponse.json(data, init)
    }
  }
})

// ============================================================================
// TEST DO CLASS - For testing sync functionality
// ============================================================================

/**
 * Test DO with some data for sync testing
 */
class SyncTestDO extends DO {
  static readonly $type = 'SyncTestDO'

  // Simulate some stored things
  private _tasks = new Map([
    ['task-1', { $id: 'task-1', $type: 'Task', name: 'First Task', data: { completed: false }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    ['task-2', { $id: 'task-2', $type: 'Task', name: 'Second Task', data: { completed: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  ])

  private _users = new Map([
    ['user-1', { $id: 'user-1', $type: 'User', name: 'Alice', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  ])

  // Helper to simulate getting data for sync
  getTasksForSync() {
    return Array.from(this._tasks.values())
  }

  getUsersForSync() {
    return Array.from(this._users.values())
  }

  // Override to accept any token for testing (bypasses auth for functional tests)
  protected override async validateSyncAuthToken(token: string): Promise<{ user: { id: string; email?: string; role?: string } } | null> {
    // Accept any non-empty token for testing
    if (!token) return null
    return { user: { id: 'test-user' } }
  }
}

/**
 * Create WebSocket upgrade headers with auth token
 * @param token - Optional auth token (defaults to 'test-token')
 */
function createSyncWebSocketHeaders(token: string = 'test-token'): Record<string, string> {
  return {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Protocol': `capnp-rpc, bearer.${token}`,
  }
}

// ============================================================================
// TESTS: /sync WebSocket Route
// ============================================================================

describe('DO /sync WebSocket Route', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: SyncTestDO

  beforeEach(async () => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new SyncTestDO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com.ai' })
  })

  // ==========================================================================
  // TESTS: WebSocket Upgrade
  // ==========================================================================

  describe('WebSocket Upgrade', () => {
    it('upgrades to WebSocket on /sync path', async () => {
      // GREEN: DO has /sync endpoint with auth
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('returns 426 Upgrade Required for non-WebSocket requests to /sync', async () => {
      // RED: DO doesn't have /sync endpoint yet
      const request = new Request('http://test/sync', {
        method: 'GET',
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(426)
      const data = await response.json() as { error: string }
      expect(data.error).toContain('WebSocket')
    })

    it('rejects POST requests to /sync', async () => {
      // RED: DO doesn't have /sync endpoint yet
      const request = new Request('http://test/sync', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(426)
    })
  })

  // ==========================================================================
  // TESTS: Subscribe Message
  // ==========================================================================

  describe('Subscribe Message Handling', () => {
    it('accepts subscribe message', async () => {
      // RED: DO doesn't handle subscribe messages on /sync yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(101)

      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Send subscribe message
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'tasks',
      } satisfies SubscribeMessage))

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should receive initial message (even if empty)
      const initialMsg = messages.find((m) => (m as ServerMessage).type === 'initial') as InitialMessage | undefined
      expect(initialMsg).toBeDefined()
      expect(initialMsg?.collection).toBe('tasks')
    })

    it('sends initial data on subscribe', async () => {
      // RED: DO doesn't send initial data on subscribe yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe to tasks collection
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      const initialMsg = messages.find((m) => (m as ServerMessage).type === 'initial') as InitialMessage | undefined
      expect(initialMsg).toBeDefined()
      expect(initialMsg?.type).toBe('initial')
      expect(initialMsg?.collection).toBe('Task')
      expect(initialMsg?.items).toBeDefined()
      expect(Array.isArray(initialMsg?.items)).toBe(true)
      expect(typeof initialMsg?.txid).toBe('number')
    })

    it('supports branch filter on subscribe', async () => {
      // RED: DO doesn't support branch filter on subscribe yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe with branch filter
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
        branch: 'feature/dark-mode',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      const initialMsg = messages.find((m) => (m as ServerMessage).type === 'initial') as InitialMessage | undefined
      expect(initialMsg).toBeDefined()
      expect(initialMsg?.branch).toBe('feature/dark-mode')
    })

    it('supports query options on subscribe', async () => {
      // RED: DO doesn't support query options on subscribe yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe with query options
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
        query: {
          limit: 10,
          offset: 0,
        },
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      const initialMsg = messages.find((m) => (m as ServerMessage).type === 'initial') as InitialMessage | undefined
      expect(initialMsg).toBeDefined()
      // Response should respect query options (items.length <= limit)
      expect(initialMsg?.items.length).toBeLessThanOrEqual(10)
    })
  })

  // ==========================================================================
  // TESTS: Unsubscribe Message
  // ==========================================================================

  describe('Unsubscribe Message Handling', () => {
    it('accepts unsubscribe message', async () => {
      // RED: DO doesn't handle unsubscribe messages on /sync yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // First subscribe
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Then unsubscribe - should not throw
      expect(() => {
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          collection: 'Task',
        } satisfies UnsubscribeMessage))
      }).not.toThrow()
    })

    it('stops receiving changes after unsubscribe', async () => {
      // RED: DO doesn't stop changes after unsubscribe yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))
      const messagesBeforeUnsub = messages.length

      // Unsubscribe
      ws.send(JSON.stringify({
        type: 'unsubscribe',
        collection: 'Task',
      } satisfies UnsubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Any changes after unsubscribe should NOT be received
      // (This would be verified with a mutation trigger, simplified here)
      const messagesAfterUnsub = messages.length

      // No new messages should arrive after unsubscribe
      // (In a real test, we'd trigger a mutation and verify no change message arrives)
      expect(messagesAfterUnsub).toBe(messagesBeforeUnsub)
    })
  })

  // ==========================================================================
  // TESTS: Multiple Collections
  // ==========================================================================

  describe('Multiple Collections per Connection', () => {
    it('handles multiple collections per connection', async () => {
      // RED: DO doesn't handle multiple collections per connection yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe to multiple collections
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'User',
      } satisfies SubscribeMessage))

      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Project',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should receive initial message for each collection
      const initialMessages = messages.filter((m) => (m as ServerMessage).type === 'initial') as InitialMessage[]

      expect(initialMessages.length).toBe(3)

      const collections = initialMessages.map((m) => m.collection)
      expect(collections).toContain('Task')
      expect(collections).toContain('User')
      expect(collections).toContain('Project')
    })

    it('can unsubscribe from one collection while staying subscribed to others', async () => {
      // RED: DO doesn't handle selective unsubscribe yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Subscribe to two collections
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'User',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Unsubscribe from Task only
      ws.send(JSON.stringify({
        type: 'unsubscribe',
        collection: 'Task',
      } satisfies UnsubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Connection should still be open and User subscription should still work
      expect(ws.readyState).toBe(1) // WebSocket.OPEN

      // The sync engine should still have User subscription active
      // (This would be verified by triggering a User mutation and checking for change message)
    })
  })

  // ==========================================================================
  // TESTS: Connection Cleanup
  // ==========================================================================

  describe('Connection Cleanup', () => {
    it('cleans up on connection close', async () => {
      // RED: DO doesn't clean up on connection close yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Subscribe to a collection
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify sync engine has the subscription
      // Access sync engine if exposed (may need to use protected accessor)
      const syncEngine = (doInstance as unknown as { syncEngine?: { getActiveConnections(): number } }).syncEngine

      if (syncEngine) {
        expect(syncEngine.getActiveConnections()).toBe(1)
      }

      // Close the connection
      ws.close()

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Sync engine should clean up
      if (syncEngine) {
        expect(syncEngine.getActiveConnections()).toBe(0)
      }
    })

    it('removes all subscriptions when connection closes', async () => {
      // RED: DO doesn't remove subscriptions on close yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Subscribe to multiple collections
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'Task' } satisfies SubscribeMessage))
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'User' } satisfies SubscribeMessage))
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'Project' } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Close connection
      ws.close()

      await new Promise((resolve) => setTimeout(resolve, 50))

      // All subscriptions should be cleaned up
      const syncEngine = (doInstance as unknown as { syncEngine?: { getSubscribers(collection: string): Set<WebSocket> } }).syncEngine

      if (syncEngine) {
        expect(syncEngine.getSubscribers('Task').size).toBe(0)
        expect(syncEngine.getSubscribers('User').size).toBe(0)
        expect(syncEngine.getSubscribers('Project').size).toBe(0)
      }
    })
  })

  // ==========================================================================
  // TESTS: Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('rejects non-WebSocket requests to /sync', async () => {
      // RED: DO doesn't reject non-WS requests to /sync yet
      const request = new Request('http://test/sync', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      })

      const response = await doInstance.fetch(request)

      expect(response.status).toBe(426)
      expect(response.headers.get('Upgrade')).toBe('websocket')
    })

    it('handles invalid JSON in messages gracefully', async () => {
      // RED: DO doesn't handle invalid JSON gracefully yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Should not throw on invalid JSON
      expect(() => {
        ws.send('not valid json {{{')
      }).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Connection should still be open
      expect(ws.readyState).toBe(1)
    })

    it('handles unknown message types gracefully', async () => {
      // RED: DO doesn't handle unknown message types yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      // Send unknown message type
      ws.send(JSON.stringify({
        type: 'unknown_type',
        data: 'test',
      }))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Connection should still be open
      expect(ws.readyState).toBe(1)
    })

    it('handles subscribe to non-existent collection gracefully', async () => {
      // RED: DO doesn't handle non-existent collections yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe to collection that doesn't exist
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'NonExistentCollection',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should receive initial message with empty items
      const initialMsg = messages.find((m) => (m as ServerMessage).type === 'initial') as InitialMessage | undefined
      expect(initialMsg).toBeDefined()
      expect(initialMsg?.items).toEqual([])
    })
  })

  // ==========================================================================
  // TESTS: Integration with SyncEngine
  // ==========================================================================

  describe('SyncEngine Integration', () => {
    it('exposes syncEngine property for internal use', () => {
      // RED: DO doesn't expose syncEngine yet
      const syncEngine = (doInstance as unknown as { syncEngine?: unknown }).syncEngine

      expect(syncEngine).toBeDefined()
    })

    it('syncEngine tracks active connections', async () => {
      // RED: DO syncEngine doesn't track connections yet
      const request1 = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response1 = await doInstance.fetch(request1)
      const ws1 = response1.webSocket!
      ws1.accept()

      const syncEngine = (doInstance as unknown as { syncEngine?: { getActiveConnections(): number } }).syncEngine

      if (syncEngine) {
        expect(syncEngine.getActiveConnections()).toBe(1)
      }

      // Create second connection
      const request2 = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response2 = await doInstance.fetch(request2)
      const ws2 = response2.webSocket!
      ws2.accept()

      if (syncEngine) {
        expect(syncEngine.getActiveConnections()).toBe(2)
      }
    })

    it('syncEngine broadcasts changes to subscribed clients', async () => {
      // RED: DO syncEngine doesn't broadcast changes yet
      const request = new Request('http://test/sync', {
        headers: createSyncWebSocketHeaders(),
      })

      const response = await doInstance.fetch(request)
      const ws = response.webSocket!
      ws.accept()

      const messages: unknown[] = []
      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push(JSON.parse(event.data as string))
      })

      // Subscribe
      ws.send(JSON.stringify({
        type: 'subscribe',
        collection: 'Task',
      } satisfies SubscribeMessage))

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Trigger a change via syncEngine (if exposed)
      const syncEngine = (doInstance as unknown as {
        syncEngine?: {
          onThingCreated(thing: { $id: string; $type: string; [key: string]: unknown }, rowid: number): void
        }
      }).syncEngine

      if (syncEngine) {
        syncEngine.onThingCreated({
          $id: 'task-new',
          $type: 'Task',
          name: 'New Task',
          branch: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, 100)

        await new Promise((resolve) => setTimeout(resolve, 50))

        const insertMsg = messages.find((m) => (m as ServerMessage).type === 'insert') as InsertMessage | undefined
        expect(insertMsg).toBeDefined()
        expect(insertMsg?.data?.$id).toBe('task-new')
      }
    })
  })
})
