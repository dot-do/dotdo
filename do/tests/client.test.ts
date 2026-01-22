/**
 * $Context Client Tests - RED Phase
 *
 * These tests define the expected behavior for a client-side $Context that provides
 * the same API as the server-side $ inside a DO. The client connects via Cap'n Web
 * RPC and WebSocket to DOs.
 *
 * The $Context client enables:
 * - $.things CRUD operations (create, get, list, update, delete)
 * - $.on.Noun.verb event subscriptions (via WebSocket)
 * - $.Noun(id).method() RPC calls
 * - $.events.emit() and $.events.subscribe()
 * - WebSocket connection management and reconnection
 * - Error handling and graceful degradation
 *
 * IMPORTANT: These tests are designed to FAIL because $Context client is not implemented yet.
 * This is the RED phase of TDD.
 *
 * @module do/tests/client.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// STUB: $Context is not implemented yet - this file will fail to import
// until the client module is created. For now, we define a stub that throws
// to make the tests discoverable and demonstrate the expected API.
// ============================================================================

// Stub type definitions for the expected API
interface ClientContextOptions {
  token?: string
  headers?: Record<string, string>
  timeout?: number
  maxReconnectAttempts?: number
  reconnectInterval?: number
  cache?: boolean
  offlineSupport?: boolean
  retries?: number
}

interface Thing {
  $id: string
  $type: string
  $createdAt?: number
  $updatedAt?: number
  [key: string]: unknown
}

interface ListResult<T> {
  items: T[]
  total: number
  hasMore: boolean
  cursor?: string
}

interface EventPayload {
  type: string
  payload: unknown
  $id: string
  $timestamp: number
}

type EventHandler = (event: EventPayload) => void | Promise<void>
type UnsubscribeFn = () => void

interface ThingsAPI {
  create(data: { $type: string; [key: string]: unknown }): Promise<Thing>
  get(id: string): Promise<Thing | null>
  list(options: { $type: string; limit?: number; offset?: number; where?: Record<string, unknown> }): Promise<ListResult<Thing>>
  update(id: string, data: Record<string, unknown>): Promise<Thing>
  delete(id: string): Promise<{ deleted: boolean }>
}

interface EventsAPI {
  emit(event: { type: string; payload?: unknown }, options?: { fireAndForget?: boolean }): Promise<{ $id: string; $timestamp: number } | { queued: boolean }>
  subscribe(event: string, handler: EventHandler): UnsubscribeFn
  query(options: { type: string; since?: number }): Promise<{ items: EventPayload[]; total: number }>
}

interface EntityProxy {
  update(data: Record<string, unknown>): Promise<Thing>
  [method: string]: (...args: unknown[]) => Promise<unknown>
}

interface OnNounProxy {
  [verb: string]: (handler: EventHandler) => UnsubscribeFn
}

interface OnProxy {
  [noun: string]: OnNounProxy
}

interface ClientContext {
  things: ThingsAPI
  events: EventsAPI
  on: OnProxy
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  onConnected(handler: () => void): void
  onDisconnected(handler: () => void): void
  onReconnecting(handler: () => void): void
  onError(handler: (error: Error) => void): void
  onHandlerError(handler: (error: Error, event: EventPayload) => void): void
  use(middleware: (request: unknown) => unknown): void
  useResponse(middleware: (response: unknown) => unknown): void
  // Internal state (for testing)
  _tenant?: string
  _namespace?: string
  _options: ClientContextOptions
  _ws?: MockWebSocket
  _handlers: Map<string, EventHandler[]>
  _isOnline?: boolean
  _offlineQueue?: unknown[]
  _processOfflineQueue?: () => Promise<void>
  // Entity proxy accessor
  [noun: string]: ((id: string) => EntityProxy) | unknown
}

/**
 * Stub $Context factory - throws because it's not implemented yet.
 * This allows tests to be discovered and fail with a clear message.
 */
function $Context(_url: string, _options?: ClientContextOptions): ClientContext {
  throw new Error(
    '$Context client is not implemented yet. ' +
    'This is the RED phase of TDD - tests are expected to fail. ' +
    'Implement the client in do/client.ts to make these tests pass.'
  )
}

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * Mock fetch for testing HTTP-based RPC calls.
 * In real tests, we'd use MSW or similar, but for RED phase we just need
 * to define the expected behavior.
 */
const mockFetch = vi.fn()
const originalFetch = globalThis.fetch

/**
 * Mock WebSocket for testing event subscriptions.
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private messageQueue: unknown[] = []

  constructor(url: string) {
    this.url = url
    // Simulate connection after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.messageQueue.push(JSON.parse(data))
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code, reason }))
  }

  // Test helper to simulate receiving a message
  _receiveMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  // Test helper to simulate connection error
  _simulateError(): void {
    this.onerror?.(new Event('error'))
  }

  // Test helper to get sent messages
  _getSentMessages(): unknown[] {
    return this.messageQueue
  }
}

beforeEach(() => {
  globalThis.fetch = mockFetch
  // @ts-expect-error - Replacing WebSocket for tests
  globalThis.WebSocket = MockWebSocket
  mockFetch.mockReset()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ============================================================================
// SECTION 1: $Context Creation and Connection
// ============================================================================

describe('$Context - Creation and Connection', () => {
  describe('$Context(url) factory', () => {
    it('should create a client context from a URL', () => {
      const $ = $Context('https://example.com.ai')

      expect($).toBeDefined()
      expect(typeof $).toBe('object')
    })

    it('should accept URL with explicit protocol', () => {
      const $ = $Context('https://api.example.com.ai')

      expect($).toBeDefined()
    })

    it('should accept URL without protocol (defaults to https)', () => {
      const $ = $Context('example.com.ai')

      expect($).toBeDefined()
    })

    it('should parse tenant from subdomain', () => {
      const $ = $Context('https://crm.example.com.ai')

      // Internal state should track the tenant
      expect($._tenant).toBe('crm')
    })

    it('should support explicit namespace via path', () => {
      const $ = $Context('https://example.com.ai/acme')

      expect($._namespace).toBe('acme')
    })

    it('should support options for authentication', () => {
      const $ = $Context('https://example.com.ai', {
        token: 'bearer-token-123',
      })

      expect($._options.token).toBe('bearer-token-123')
    })

    it('should support options for custom headers', () => {
      const $ = $Context('https://example.com.ai', {
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      })

      expect($._options.headers).toEqual({
        'X-Custom-Header': 'custom-value',
      })
    })

    it('should support timeout configuration', () => {
      const $ = $Context('https://example.com.ai', {
        timeout: 5000,
      })

      expect($._options.timeout).toBe(5000)
    })
  })

  describe('connection management', () => {
    it('should establish WebSocket connection on first subscription', async () => {
      const $ = $Context('https://example.com.ai')

      // Subscribing to events should establish WebSocket
      $.on.Customer.created(() => {})

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 10))

      expect($._ws).toBeDefined()
      expect($._ws.readyState).toBe(MockWebSocket.OPEN)
    })

    it('should reuse existing WebSocket connection', async () => {
      const $ = $Context('https://example.com.ai')

      $.on.Customer.created(() => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      const ws1 = $._ws

      $.on.Order.placed(() => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      const ws2 = $._ws

      expect(ws1).toBe(ws2)
    })

    it('should provide connect() method for explicit connection', async () => {
      const $ = $Context('https://example.com.ai')

      await $.connect()

      expect($._ws).toBeDefined()
      expect($._ws.readyState).toBe(MockWebSocket.OPEN)
    })

    it('should provide disconnect() method', async () => {
      const $ = $Context('https://example.com.ai')

      await $.connect()
      await $.disconnect()

      expect($._ws.readyState).toBe(MockWebSocket.CLOSED)
    })

    it('should provide isConnected() method', async () => {
      const $ = $Context('https://example.com.ai')

      expect($.isConnected()).toBe(false)

      await $.connect()

      expect($.isConnected()).toBe(true)
    })
  })
})

// ============================================================================
// SECTION 2: $.things CRUD Operations
// ============================================================================

describe('$Context - $.things CRUD', () => {
  describe('$.things.create()', () => {
    it('should create a thing with $type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          $id: 'cust_123',
          $type: 'Customer',
          name: 'Alice',
          $createdAt: Date.now(),
        }),
      })

      const $ = $Context('https://example.com.ai')

      const customer = await $.things.create({
        $type: 'Customer',
        name: 'Alice',
      })

      expect(customer.$id).toBe('cust_123')
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')
      expect(customer.$createdAt).toBeDefined()
    })

    it('should send correct RPC request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $id: 'cust_123', $type: 'Customer', name: 'Alice' }),
      })

      const $ = $Context('https://example.com.ai')

      await $.things.create({ $type: 'Customer', name: 'Alice' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rpc'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.method).toBe('things.create')
      expect(body.args).toEqual([{ $type: 'Customer', name: 'Alice' }])
    })

    it('should throw on creation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Validation failed', code: 'VALIDATION_ERROR' }),
      })

      const $ = $Context('https://example.com.ai')

      await expect($.things.create({ $type: 'Customer' })).rejects.toThrow('Validation failed')
    })
  })

  describe('$.things.get()', () => {
    it('should get a thing by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          $id: 'cust_123',
          $type: 'Customer',
          name: 'Alice',
        }),
      })

      const $ = $Context('https://example.com.ai')

      const customer = await $.things.get('cust_123')

      expect(customer.$id).toBe('cust_123')
      expect(customer.name).toBe('Alice')
    })

    it('should return null for non-existent thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null),
      })

      const $ = $Context('https://example.com.ai')

      const customer = await $.things.get('nonexistent')

      expect(customer).toBeNull()
    })

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      })

      const $ = $Context('https://example.com.ai')

      await expect($.things.get('cust_123')).rejects.toThrow()
    })
  })

  describe('$.things.list()', () => {
    it('should list things by type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { $id: 'cust_1', $type: 'Customer', name: 'Alice' },
            { $id: 'cust_2', $type: 'Customer', name: 'Bob' },
          ],
          total: 2,
          hasMore: false,
        }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.things.list({ $type: 'Customer' })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].name).toBe('Alice')
      expect(result.total).toBe(2)
    })

    it('should support pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [{ $id: 'cust_1', $type: 'Customer', name: 'Alice' }],
          total: 100,
          hasMore: true,
          cursor: 'cursor_abc',
        }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.things.list({
        $type: 'Customer',
        limit: 1,
        offset: 0,
      })

      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(true)
      expect(result.cursor).toBe('cursor_abc')
    })

    it('should support filtering', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [{ $id: 'cust_1', $type: 'Customer', name: 'Alice', status: 'active' }],
          total: 1,
          hasMore: false,
        }),
      })

      const $ = $Context('https://example.com.ai')

      await $.things.list({
        $type: 'Customer',
        where: { status: 'active' },
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.args[0].where).toEqual({ status: 'active' })
    })
  })

  describe('$.things.update()', () => {
    it('should update a thing by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          $id: 'cust_123',
          $type: 'Customer',
          name: 'Alice Updated',
          $updatedAt: Date.now(),
        }),
      })

      const $ = $Context('https://example.com.ai')

      const customer = await $.things.update('cust_123', { name: 'Alice Updated' })

      expect(customer.name).toBe('Alice Updated')
      expect(customer.$updatedAt).toBeDefined()
    })

    it('should throw when updating non-existent thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found', code: 'NOT_FOUND' }),
      })

      const $ = $Context('https://example.com.ai')

      await expect($.things.update('nonexistent', { name: 'Test' })).rejects.toThrow('Not found')
    })
  })

  describe('$.things.delete()', () => {
    it('should delete a thing by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.things.delete('cust_123')

      expect(result.deleted).toBe(true)
    })

    it('should return false for non-existent thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: false }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.things.delete('nonexistent')

      expect(result.deleted).toBe(false)
    })
  })
})

// ============================================================================
// SECTION 3: $.on.Noun.verb Event Subscriptions
// ============================================================================

describe('$Context - $.on.Noun.verb Event Subscriptions', () => {
  describe('event handler registration', () => {
    it('should register handler via $.on.Noun.verb(handler)', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.on.Customer.created(handler)

      // Handler should be registered
      expect($._handlers.has('Customer.created')).toBe(true)
    })

    it('should support multiple handlers for same event', async () => {
      const $ = $Context('https://example.com.ai')
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      $.on.Customer.created(handler1)
      $.on.Customer.created(handler2)

      expect($._handlers.get('Customer.created')).toHaveLength(2)
    })

    it('should support wildcard handlers', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.on.Customer['*'](handler)

      expect($._handlers.has('Customer.*')).toBe(true)
    })

    it('should support global wildcard handlers', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.on['*']['*'](handler)

      expect($._handlers.has('*.*')).toBe(true)
    })
  })

  describe('event delivery via WebSocket', () => {
    it('should send subscription message over WebSocket', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.on.Customer.created(handler)

      // Wait for WebSocket connection
      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      const messages = ws._getSentMessages()

      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          event: 'Customer.created',
        })
      )
    })

    it('should invoke handler when event is received', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.on.Customer.created(handler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws._receiveMessage({
        type: 'event',
        event: 'Customer.created',
        payload: { name: 'Alice', email: 'alice@example.com' },
        $id: 'evt_123',
        $timestamp: Date.now(),
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Customer.created',
          payload: { name: 'Alice', email: 'alice@example.com' },
          $id: 'evt_123',
        })
      )
    })

    it('should invoke wildcard handlers for matching events', async () => {
      const $ = $Context('https://example.com.ai')
      const wildcardHandler = vi.fn()
      const exactHandler = vi.fn()

      $.on.Customer['*'](wildcardHandler)
      $.on.Customer.created(exactHandler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws._receiveMessage({
        type: 'event',
        event: 'Customer.created',
        payload: { name: 'Alice' },
        $id: 'evt_123',
        $timestamp: Date.now(),
      })

      expect(wildcardHandler).toHaveBeenCalled()
      expect(exactHandler).toHaveBeenCalled()
    })

    it('should handle async handlers', async () => {
      const $ = $Context('https://example.com.ai')
      let resolved = false

      $.on.Customer.created(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        resolved = true
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws._receiveMessage({
        type: 'event',
        event: 'Customer.created',
        payload: {},
        $id: 'evt_123',
        $timestamp: Date.now(),
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(resolved).toBe(true)
    })
  })

  describe('unsubscription', () => {
    it('should return unsubscribe function', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      const unsubscribe = $.on.Customer.created(handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('should remove handler when unsubscribe is called', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      const unsubscribe = $.on.Customer.created(handler)

      await new Promise(resolve => setTimeout(resolve, 10))

      unsubscribe()

      expect($._handlers.get('Customer.created')).not.toContain(handler)
    })

    it('should send unsubscribe message over WebSocket', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      const unsubscribe = $.on.Customer.created(handler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      unsubscribe()

      const messages = ws._getSentMessages()
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'unsubscribe',
          event: 'Customer.created',
        })
      )
    })
  })
})

// ============================================================================
// SECTION 4: $.Noun(id).method() RPC Calls
// ============================================================================

describe('$Context - $.Noun(id).method() RPC Calls', () => {
  describe('entity proxy creation', () => {
    it('should create entity proxy via $.Noun(id)', async () => {
      const $ = $Context('https://example.com.ai')

      const customer = $.Customer('cust_123')

      expect(customer).toBeDefined()
      expect(typeof customer).toBe('object')
    })

    it('should support any noun name', async () => {
      const $ = $Context('https://example.com.ai')

      const order = $.Order('order_456')
      const product = $.Product('prod_789')
      const invoice = $.Invoice('inv_012')

      expect(order).toBeDefined()
      expect(product).toBeDefined()
      expect(invoice).toBeDefined()
    })
  })

  describe('RPC method calls', () => {
    it('should call method on entity via RPC', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, message: 'Email sent' }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.Customer('cust_123').notify({ message: 'Hello!' })

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalled()

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.method).toBe('Customer.notify')
      expect(body.args).toEqual([{ message: 'Hello!' }])
      expect(body.id).toBe('cust_123')
    })

    it('should support methods without arguments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'Alice', email: 'alice@example.com' }),
      })

      const $ = $Context('https://example.com.ai')

      const profile = await $.Customer('cust_123').getProfile()

      expect(profile.name).toBe('Alice')
    })

    it('should support methods with multiple arguments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ shipped: true }),
      })

      const $ = $Context('https://example.com.ai')

      await $.Order('order_123').ship('fedex', { priority: 'overnight' })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.args).toEqual(['fedex', { priority: 'overnight' }])
    })

    it('should throw on RPC failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error', code: 'INTERNAL_ERROR' }),
      })

      const $ = $Context('https://example.com.ai')

      await expect($.Customer('cust_123').notify({ message: 'Hello!' })).rejects.toThrow()
    })

    it('should throw on timeout', async () => {
      mockFetch.mockImplementationOnce(() => new Promise(() => {})) // Never resolves

      const $ = $Context('https://example.com.ai', { timeout: 100 })

      await expect($.Customer('cust_123').getProfile()).rejects.toThrow('timeout')
    })
  })

  describe('update shorthand', () => {
    it('should support $.Noun(id).update() shorthand', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          $id: 'cust_123',
          $type: 'Customer',
          name: 'Alice Updated',
        }),
      })

      const $ = $Context('https://example.com.ai')

      const customer = await $.Customer('cust_123').update({ name: 'Alice Updated' })

      expect(customer.name).toBe('Alice Updated')
    })
  })
})

// ============================================================================
// SECTION 5: $.events API
// ============================================================================

describe('$Context - $.events API', () => {
  describe('$.events.emit()', () => {
    it('should emit event via RPC', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $id: 'evt_123', $timestamp: Date.now() }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.events.emit({
        type: 'Customer.signup',
        payload: { email: 'alice@example.com' },
      })

      expect(result.$id).toBe('evt_123')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.method).toBe('events.emit')
      expect(body.args[0].type).toBe('Customer.signup')
    })

    it('should support fire-and-forget emit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ queued: true }),
      })

      const $ = $Context('https://example.com.ai')

      // Fire-and-forget doesn't wait for handlers
      $.events.emit({
        type: 'Customer.activity',
        payload: { action: 'page_view' },
      }, { fireAndForget: true })

      // Should not throw even if we don't await
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('$.events.subscribe()', () => {
    it('should subscribe to events via WebSocket', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.events.subscribe('Customer.created', handler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      const messages = ws._getSentMessages()

      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          event: 'Customer.created',
        })
      )
    })

    it('should return unsubscribe function', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      const unsubscribe = $.events.subscribe('Customer.created', handler)

      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('$.events.query()', () => {
    it('should query events by type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          items: [
            { $id: 'evt_1', type: 'Customer.created', payload: { name: 'Alice' }, $timestamp: Date.now() },
            { $id: 'evt_2', type: 'Customer.created', payload: { name: 'Bob' }, $timestamp: Date.now() },
          ],
          total: 2,
        }),
      })

      const $ = $Context('https://example.com.ai')

      const result = await $.events.query({ type: 'Customer.created' })

      expect(result.items).toHaveLength(2)
    })

    it('should support time range filtering', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0 }),
      })

      const $ = $Context('https://example.com.ai')
      const since = Date.now() - 3600000 // 1 hour ago

      await $.events.query({
        type: 'Customer.created',
        since,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.args[0].since).toBe(since)
    })
  })
})

// ============================================================================
// SECTION 6: WebSocket Reconnection
// ============================================================================

describe('$Context - WebSocket Reconnection', () => {
  describe('automatic reconnection', () => {
    it('should reconnect when connection is lost', async () => {
      const $ = $Context('https://example.com.ai')

      $.on.Customer.created(() => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws1 = $._ws as MockWebSocket

      // Simulate connection loss
      ws1.close(1006, 'Connection lost')

      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should have new WebSocket
      expect($._ws).not.toBe(ws1)
      expect($.isConnected()).toBe(true)
    })

    it('should resubscribe to events after reconnection', async () => {
      const $ = $Context('https://example.com.ai')

      $.on.Customer.created(() => {})
      $.on.Order.placed(() => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws1 = $._ws as MockWebSocket
      ws1.close(1006, 'Connection lost')

      await new Promise(resolve => setTimeout(resolve, 100))

      const ws2 = $._ws as MockWebSocket
      const messages = ws2._getSentMessages()

      // Should have resubscribed to both events
      expect(messages).toContainEqual(expect.objectContaining({ event: 'Customer.created' }))
      expect(messages).toContainEqual(expect.objectContaining({ event: 'Order.placed' }))
    })

    it('should use exponential backoff for reconnection', async () => {
      const $ = $Context('https://example.com.ai')
      let reconnectAttempts = 0

      // Track reconnection attempts
      const originalConnect = $.connect.bind($)
      $.connect = async () => {
        reconnectAttempts++
        if (reconnectAttempts < 3) {
          throw new Error('Connection failed')
        }
        return originalConnect()
      }

      $.on.Customer.created(() => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws.close(1006, 'Connection lost')

      // Wait for multiple reconnection attempts
      await new Promise(resolve => setTimeout(resolve, 500))

      expect(reconnectAttempts).toBeGreaterThan(1)
    })
  })

  describe('reconnection configuration', () => {
    it('should respect maxReconnectAttempts option', async () => {
      const $ = $Context('https://example.com.ai', {
        maxReconnectAttempts: 2,
      })

      expect($._options.maxReconnectAttempts).toBe(2)
    })

    it('should respect reconnectInterval option', async () => {
      const $ = $Context('https://example.com.ai', {
        reconnectInterval: 500,
      })

      expect($._options.reconnectInterval).toBe(500)
    })
  })

  describe('connection state events', () => {
    it('should emit connected event', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.onConnected(handler)
      await $.connect()

      expect(handler).toHaveBeenCalled()
    })

    it('should emit disconnected event', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.onDisconnected(handler)
      await $.connect()

      const ws = $._ws as MockWebSocket
      ws.close(1000, 'Normal closure')

      expect(handler).toHaveBeenCalled()
    })

    it('should emit reconnecting event', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.onReconnecting(handler)

      await $.connect()

      const ws = $._ws as MockWebSocket
      ws.close(1006, 'Connection lost')

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalled()
    })

    it('should emit error event', async () => {
      const $ = $Context('https://example.com.ai')
      const handler = vi.fn()

      $.onError(handler)

      await $.connect()

      const ws = $._ws as MockWebSocket
      ws._simulateError()

      expect(handler).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// SECTION 7: Error Handling
// ============================================================================

describe('$Context - Error Handling', () => {
  describe('RPC errors', () => {
    it('should throw typed error for validation failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: { field: 'email', message: 'Invalid email format' },
        }),
      })

      const $ = $Context('https://example.com.ai')

      try {
        await $.things.create({ $type: 'Customer', email: 'invalid' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('VALIDATION_ERROR')
        expect((error as { details: { field: string } }).details.field).toBe('email')
      }
    })

    it('should throw typed error for not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({
          error: 'Customer not found',
          code: 'NOT_FOUND',
        }),
      })

      const $ = $Context('https://example.com.ai')

      try {
        await $.Customer('nonexistent').getProfile()
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('NOT_FOUND')
      }
    })

    it('should throw typed error for unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
        }),
      })

      const $ = $Context('https://example.com.ai')

      try {
        await $.things.list({ $type: 'Customer' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('UNAUTHORIZED')
      }
    })

    it('should throw typed error for rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
        }),
      })

      const $ = $Context('https://example.com.ai')

      try {
        await $.things.list({ $type: 'Customer' })
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe('RATE_LIMIT_EXCEEDED')
        expect((error as { retryAfter: number }).retryAfter).toBe(60)
      }
    })
  })

  describe('network errors', () => {
    it('should throw on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const $ = $Context('https://example.com.ai')

      await expect($.things.list({ $type: 'Customer' })).rejects.toThrow('Network error')
    })

    it('should retry on transient errors', async () => {
      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [], total: 0 }),
        })

      const $ = $Context('https://example.com.ai', { retries: 1 })

      const result = await $.things.list({ $type: 'Customer' })

      expect(result.items).toEqual([])
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('handler errors', () => {
    it('should not crash when event handler throws', async () => {
      const $ = $Context('https://example.com.ai')
      const errorHandler = vi.fn(() => { throw new Error('Handler error') })
      const successHandler = vi.fn()

      $.on.Customer.created(errorHandler)
      $.on.Customer.created(successHandler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws._receiveMessage({
        type: 'event',
        event: 'Customer.created',
        payload: {},
        $id: 'evt_123',
        $timestamp: Date.now(),
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      // Second handler should still be called
      expect(successHandler).toHaveBeenCalled()
    })

    it('should report handler errors via onHandlerError callback', async () => {
      const $ = $Context('https://example.com.ai')
      const errorReporter = vi.fn()
      const erroringHandler = () => { throw new Error('Handler error') }

      $.onHandlerError(errorReporter)
      $.on.Customer.created(erroringHandler)

      await new Promise(resolve => setTimeout(resolve, 10))

      const ws = $._ws as MockWebSocket
      ws._receiveMessage({
        type: 'event',
        event: 'Customer.created',
        payload: {},
        $id: 'evt_123',
        $timestamp: Date.now(),
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(errorReporter).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ type: 'Customer.created' })
      )
    })
  })
})

// ============================================================================
// SECTION 8: Advanced Features
// ============================================================================

describe('$Context - Advanced Features', () => {
  describe('batching', () => {
    it('should batch multiple RPC calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { $id: 'cust_1', name: 'Alice' },
          { $id: 'cust_2', name: 'Bob' },
        ]),
      })

      const $ = $Context('https://example.com.ai')

      const [alice, bob] = await Promise.all([
        $.things.get('cust_1'),
        $.things.get('cust_2'),
      ])

      expect(alice.name).toBe('Alice')
      expect(bob.name).toBe('Bob')

      // Should have been batched into single request
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('caching', () => {
    it('should cache things.get results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ $id: 'cust_123', name: 'Alice' }),
      })

      const $ = $Context('https://example.com.ai', { cache: true })

      await $.things.get('cust_123')
      await $.things.get('cust_123')

      // Second call should be cached
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should invalidate cache on update', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $id: 'cust_123', name: 'Alice' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $id: 'cust_123', name: 'Alice Updated' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ $id: 'cust_123', name: 'Alice Updated' }),
        })

      const $ = $Context('https://example.com.ai', { cache: true })

      await $.things.get('cust_123')
      await $.things.update('cust_123', { name: 'Alice Updated' })
      await $.things.get('cust_123')

      // Should have made 3 requests (get, update, get after cache invalidation)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('offline support', () => {
    it('should queue operations when offline', async () => {
      const $ = $Context('https://example.com.ai', { offlineSupport: true })

      // Simulate offline
      $._isOnline = false

      const promise = $.things.create({ $type: 'Customer', name: 'Alice' })

      // Should be queued, not rejected
      expect($._offlineQueue).toHaveLength(1)

      // Simulate coming back online
      $._isOnline = true
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ $id: 'cust_123', $type: 'Customer', name: 'Alice' }),
      })

      await $._processOfflineQueue()

      const result = await promise
      expect(result.$id).toBe('cust_123')
    })
  })

  describe('middleware', () => {
    it('should support request middleware', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0 }),
      })

      const middleware = vi.fn((request) => ({
        ...request,
        headers: {
          ...request.headers,
          'X-Request-ID': 'req_123',
        },
      }))

      const $ = $Context('https://example.com.ai')
      $.use(middleware)

      await $.things.list({ $type: 'Customer' })

      expect(middleware).toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': 'req_123',
          }),
        })
      )
    })

    it('should support response middleware', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0 }),
      })

      const responseMiddleware = vi.fn((response) => {
        // Log or transform response
        return response
      })

      const $ = $Context('https://example.com.ai')
      $.useResponse(responseMiddleware)

      await $.things.list({ $type: 'Customer' })

      expect(responseMiddleware).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// SECTION 9: Type Safety (Compile-time tests)
// ============================================================================

describe('$Context - Type Safety', () => {
  it('should have proper TypeScript types for things API', () => {
    // These are compile-time tests - they just need to not have TS errors
    const $ = $Context('https://example.com.ai')

    // @ts-expect-error - thing requires $type
    $.things.create({ name: 'Alice' })

    // Valid usage should not error (at compile time)
    const _p1 = $.things.create({ $type: 'Customer', name: 'Alice' })
    const _p2 = $.things.get('id')
    const _p3 = $.things.list({ $type: 'Customer' })
    const _p4 = $.things.update('id', { name: 'Bob' })
    const _p5 = $.things.delete('id')

    expect(true).toBe(true) // Test exists to verify no TS errors
  })

  it('should have proper TypeScript types for events API', () => {
    const $ = $Context('https://example.com.ai')

    // Handler receives typed event
    $.on.Customer.created((event) => {
      // event should have type, payload, $id, $timestamp
      const _type = event.type
      const _payload = event.payload
      const _id = event.$id
      const _ts = event.$timestamp
    })

    expect(true).toBe(true)
  })

  it('should have proper TypeScript types for entity proxy', () => {
    const $ = $Context('https://example.com.ai')

    // Entity proxy should accept any method name
    const customer = $.Customer('id')
    const _p1 = customer.getProfile()
    const _p2 = customer.notify({ message: 'Hello' })
    const _p3 = customer.update({ name: 'Bob' })

    expect(true).toBe(true)
  })
})
