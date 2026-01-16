/**
 * RPC Client WebSocket Integration Tests (TDD RED Phase)
 *
 * Comprehensive tests for RpcClient WebSocket functionality:
 * - connect() success and failure paths
 * - disconnect() clean shutdown
 * - call() request/response with correlation IDs
 * - call() timeout handling
 * - Reconnection with exponential backoff
 * - Message parsing (invalid JSON, unknown types)
 * - Callback registration and invocation
 *
 * These tests should FAIL initially due to missing test infrastructure,
 * not because the code is broken.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to create shared state between mock and tests
const { wsInstances, getMockWs, resetWs } = vi.hoisted(() => {
  const instances: any[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => {
      instances.length = 0
    },
  }
})

// Mock the ws module
vi.mock('ws', () => {
  class MockWebSocket {
    readyState: number = 0 // CONNECTING
    url: string
    options?: { headers?: Record<string, string> }

    private eventHandlers: Map<string, ((...args: any[]) => void)[]> = new Map()

    send = vi.fn()
    close = vi.fn(function (this: any, code?: number, reason?: string) {
      this.readyState = 3 // CLOSED
      // Simulate async close event
      setImmediate(() => {
        const handlers = this.eventHandlers.get('close')
        if (handlers) {
          handlers.forEach((h: any) => h(code ?? 1000, Buffer.from(reason ?? 'closed')))
        }
      })
    })

    constructor(url: string, options?: { headers?: Record<string, string> }) {
      this.url = url
      this.options = options
      wsInstances.push(this)
    }

    on(event: string, handler: (...args: any[]) => void): MockWebSocket {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      this.eventHandlers.get(event)!.push(handler)
      return this
    }

    // Internal method to trigger events
    _triggerEvent(event: string, ...args: any[]): boolean {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach((h) => h(...args))
        return true
      }
      return false
    }
  }

  return { default: MockWebSocket }
})

// Import RpcClient AFTER the mock is set up
import { RpcClient } from '../src/rpc-client.js'

// Helper type for the mocked WebSocket
interface MockedWebSocket {
  url: string
  options?: { headers?: Record<string, string> }
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on(event: string, handler: (...args: any[]) => void): MockedWebSocket
  _triggerEvent(event: string, ...args: any[]): boolean
}

// Helper functions to manipulate mock WebSocket
function simulateOpen(ws: MockedWebSocket) {
  ws.readyState = 1 // OPEN
  ws._triggerEvent('open')
}

function simulateResponse(ws: MockedWebSocket, id: string, result: unknown) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      result,
    })
  )
}

function simulateErrorResponse(ws: MockedWebSocket, id: string, error: { message: string; code?: string }) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      error,
    })
  )
}

function simulateConnectionDrop(ws: MockedWebSocket, code = 1006, reason = 'Connection lost') {
  ws.readyState = 3 // CLOSED
  ws._triggerEvent('close', code, Buffer.from(reason))
}

function simulateError(ws: MockedWebSocket, error: Error) {
  ws._triggerEvent('error', error)
}

function simulateMessage(ws: MockedWebSocket, message: unknown) {
  ws._triggerEvent('message', JSON.stringify(message))
}

function simulateRawMessage(ws: MockedWebSocket, data: string) {
  ws._triggerEvent('message', data)
}

function simulateCallback(ws: MockedWebSocket, callbackId: string, args: unknown[]) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `cb_${Date.now()}`,
      type: 'callback',
      callbackId,
      args,
    })
  )
}

function simulateEvent(ws: MockedWebSocket, eventType: string, data: unknown) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id: `evt_${Date.now()}`,
      type: 'event',
      eventType,
      data,
    })
  )
}

describe('RpcClient WebSocket Integration', () => {
  let client: RpcClient
  let mockWs: MockedWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    resetWs()

    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      timeout: 5000,
      autoReconnect: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /**
   * Helper to connect client and get mock WebSocket
   */
  async function connectClient(schema = { name: 'Test', fields: [], methods: [] }): Promise<MockedWebSocket> {
    const connectPromise = client.connect()

    // Wait for WebSocket instantiation
    await vi.advanceTimersByTimeAsync(0)

    mockWs = getMockWs() as MockedWebSocket
    simulateOpen(mockWs)

    // Respond to introspect call
    await vi.advanceTimersByTimeAsync(0)
    const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
    simulateResponse(mockWs, introspectCall.id, schema)

    await connectPromise
    return mockWs
  }

  // ==========================================================================
  // 1. connect() - Success Path
  // ==========================================================================
  describe('1. connect() - success path with schema introspection', () => {
    it('should establish WebSocket connection and return schema', async () => {
      const expectedSchema = {
        name: 'Customer',
        fields: [{ name: '$id', type: 'string', required: true }],
        methods: [{ name: 'getOrders', params: [], returns: 'Promise<Order[]>' }],
      }

      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      expect(mockWs.url).toBe('wss://test.api.dotdo.dev/ws/rpc')

      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Should have sent introspect call
      expect(mockWs.send).toHaveBeenCalledTimes(1)
      const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
      expect(introspectCall.type).toBe('call')
      expect(introspectCall.path).toEqual(['$meta', 'schema'])

      simulateResponse(mockWs, introspectCall.id, expectedSchema)

      const schema = await connectPromise
      expect(schema).toEqual(expectedSchema)
      expect(client.getState()).toBe('connected')
      expect(client.getSchema()).toEqual(expectedSchema)
    })

    it('should emit "connecting" event when connection starts', async () => {
      const connectingHandler = vi.fn()
      client.on('connecting', connectingHandler)

      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(0)

      expect(connectingHandler).toHaveBeenCalledTimes(1)
      expect(client.getState()).toBe('connecting')

      // Cleanup
      mockWs = getMockWs() as MockedWebSocket
      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)
      const call = JSON.parse(mockWs.send.mock.calls[0][0])
      simulateResponse(mockWs, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise
    })

    it('should emit "connected" event when WebSocket opens', async () => {
      const connectedHandler = vi.fn()
      client.on('connected', connectedHandler)

      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      expect(connectedHandler).toHaveBeenCalledTimes(1)

      const call = JSON.parse(mockWs.send.mock.calls[0][0])
      simulateResponse(mockWs, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise
    })

    it('should include auth token in WebSocket headers when provided', async () => {
      const authClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        token: 'secret-token-123',
        timeout: 5000,
        autoReconnect: false,
      })

      const connectPromise = authClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getMockWs() as MockedWebSocket
      expect(ws.options?.headers?.Authorization).toBe('Bearer secret-token-123')

      // Cleanup
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)
      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise
    })

    it('should return cached schema when already connected', async () => {
      const schema = { name: 'Cached', fields: [], methods: [] }
      await connectClient(schema)

      // Second connect should return cached schema immediately
      const cachedSchema = await client.connect()
      expect(cachedSchema).toEqual(schema)

      // Should not have created new WebSocket
      expect(wsInstances.length).toBe(1)
    })
  })

  // ==========================================================================
  // 2. connect() - Failure Path
  // ==========================================================================
  describe('2. connect() - failure paths', () => {
    it('should reject with timeout error when connection times out', async () => {
      let timeoutError: Error | null = null
      const connectPromise = client.connect().catch((e) => {
        timeoutError = e
      })
      await vi.advanceTimersByTimeAsync(0)

      // Don't open the WebSocket - let it timeout
      await vi.advanceTimersByTimeAsync(5000)
      await connectPromise

      expect(timeoutError).toBeInstanceOf(Error)
      expect(timeoutError?.message).toBe('Connection timeout')
      expect(client.getState()).toBe('error')
    })

    it('should reject when WebSocket emits error', async () => {
      const errorHandler = vi.fn()
      client.on('error', errorHandler)

      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      const wsError = new Error('WebSocket connection failed')
      simulateError(mockWs, wsError)

      expect(errorHandler).toHaveBeenCalledWith(wsError)
      expect(client.getState()).toBe('error')
    })

    it('should reject when introspection call fails', async () => {
      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
      simulateErrorResponse(mockWs, introspectCall.id, {
        message: 'Schema introspection not supported',
        code: 'INTROSPECT_FAILED',
      })

      await expect(connectPromise).rejects.toThrow('Schema introspection not supported')
    })

    it('should reject when introspection times out', async () => {
      let timeoutError: Error | null = null
      const connectPromise = client.connect().catch((e) => {
        timeoutError = e
      })
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Don't respond to introspect call - let it timeout
      await vi.advanceTimersByTimeAsync(5000)
      await connectPromise

      expect(timeoutError).toBeInstanceOf(Error)
      expect(timeoutError?.message).toMatch(/timeout/i)
    })

    it('should handle connection closed before introspection completes', async () => {
      let closeError: Error | null = null
      const connectPromise = client.connect().catch((e) => {
        closeError = e
      })
      await vi.advanceTimersByTimeAsync(0)

      mockWs = getMockWs() as MockedWebSocket
      simulateOpen(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Close connection before introspect response
      simulateConnectionDrop(mockWs, 1001, 'Server going away')
      await vi.advanceTimersByTimeAsync(0)
      await connectPromise

      expect(closeError).toBeInstanceOf(Error)
      expect(closeError?.message).toBe('Connection closed')
    })
  })

  // ==========================================================================
  // 3. disconnect() - Clean Shutdown
  // ==========================================================================
  describe('3. disconnect() - clean shutdown', () => {
    it('should close WebSocket with normal close code', async () => {
      await connectClient()

      client.disconnect()

      expect(mockWs.close).toHaveBeenCalledWith(1000, 'Client disconnect')
    })

    it('should emit "disconnected" event', async () => {
      await connectClient()

      const disconnectedHandler = vi.fn()
      client.on('disconnected', disconnectedHandler)

      client.disconnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(disconnectedHandler).toHaveBeenCalled()
    })

    it('should set state to "disconnected"', async () => {
      await connectClient()

      expect(client.getState()).toBe('connected')

      client.disconnect()

      expect(client.getState()).toBe('disconnected')
    })

    it('should disable auto-reconnect on explicit disconnect', async () => {
      const reconnectClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true,
      })

      const connectPromise = reconnectClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      const initialWsCount = wsInstances.length

      reconnectClient.disconnect()
      await vi.advanceTimersByTimeAsync(0)

      // Advance time past reconnect delay
      await vi.advanceTimersByTimeAsync(10000)

      // Should NOT have created new WebSocket for reconnection
      expect(wsInstances.length).toBe(initialWsCount)
    })

    it('should reject pending calls with "Connection closed" error', async () => {
      await connectClient()

      const pendingCall = client.call(['test', 'method'], [])

      client.disconnect()

      await expect(pendingCall).rejects.toThrow('Connection closed')
    })

    it('should clear WebSocket reference', async () => {
      await connectClient()

      client.disconnect()

      const clientAny = client as any
      expect(clientAny.ws).toBeNull()
    })

    it('should handle disconnect when not connected', () => {
      // Should not throw
      expect(() => client.disconnect()).not.toThrow()
      expect(client.getState()).toBe('disconnected')
    })
  })

  // ==========================================================================
  // 4. call() - Request/Response with Correlation IDs
  // ==========================================================================
  describe('4. call() - request/response cycle with correlation IDs', () => {
    it('should send call message with unique ID', async () => {
      await connectClient()

      const callPromise = client.call(['customers', 'create'], [{ name: 'Alice' }])
      await vi.advanceTimersByTimeAsync(0)

      const lastCall = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(lastCall.type).toBe('call')
      expect(lastCall.path).toEqual(['customers', 'create'])
      expect(lastCall.args).toEqual([{ name: 'Alice' }])
      expect(lastCall.id).toMatch(/^msg_\d+_\d+_[a-z0-9]+$/)

      // Respond
      simulateResponse(mockWs, lastCall.id, { $id: 'cust_123', name: 'Alice' })
      await callPromise
    })

    it('should resolve with correct response for matching ID', async () => {
      await connectClient()

      const callPromise = client.call(['customers', 'get'], ['cust_123'])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      const expectedResult = { $id: 'cust_123', name: 'Alice', email: 'alice@example.com' }
      simulateResponse(mockWs, callMsg.id, expectedResult)

      const result = await callPromise
      expect(result).toEqual(expectedResult)
    })

    it('should handle multiple concurrent calls with different IDs', async () => {
      await connectClient()

      const call1 = client.call(['customers', 'get'], ['cust_1'])
      const call2 = client.call(['orders', 'list'], [])
      const call3 = client.call(['products', 'search'], ['shoes'])
      await vi.advanceTimersByTimeAsync(0)

      // Get all call IDs (skip the introspect call)
      const calls = mockWs.send.mock.calls.slice(1)
      const ids = calls.map((c: any) => JSON.parse(c[0]).id)

      // All IDs should be unique
      expect(new Set(ids).size).toBe(3)

      // Respond out of order
      simulateResponse(mockWs, ids[2], { products: ['shoe1', 'shoe2'] })
      simulateResponse(mockWs, ids[0], { $id: 'cust_1', name: 'Bob' })
      simulateResponse(mockWs, ids[1], { orders: [] })

      const [result1, result2, result3] = await Promise.all([call1, call2, call3])

      expect(result1).toEqual({ $id: 'cust_1', name: 'Bob' })
      expect(result2).toEqual({ orders: [] })
      expect(result3).toEqual({ products: ['shoe1', 'shoe2'] })
    })

    it('should reject call with error response', async () => {
      await connectClient()

      const callPromise = client.call(['customers', 'delete'], ['cust_123'])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      simulateErrorResponse(mockWs, callMsg.id, {
        message: 'Customer not found',
        code: 'NOT_FOUND',
      })

      await expect(callPromise).rejects.toThrow('Customer not found')
    })

    it('should throw when calling without being connected', async () => {
      await expect(client.call(['test', 'method'], [])).rejects.toThrow('Not connected')
    })

    it('should serialize Date objects in arguments', async () => {
      await connectClient()

      const date = new Date('2024-06-15T10:30:00Z')
      const callPromise = client.call(['events', 'create'], [{ date }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(callMsg.args[0].date).toEqual({ __rpc_date: '2024-06-15T10:30:00.000Z' })

      simulateResponse(mockWs, callMsg.id, { id: 'evt_1' })
      await callPromise
    })

    it('should deserialize Date objects in responses', async () => {
      await connectClient()

      const callPromise = client.call(['events', 'get'], ['evt_1'])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      simulateResponse(mockWs, callMsg.id, {
        id: 'evt_1',
        createdAt: { __rpc_date: '2024-06-15T10:30:00.000Z' },
      })

      const result = (await callPromise) as any
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.toISOString()).toBe('2024-06-15T10:30:00.000Z')
    })

    it('should ignore response for unknown/non-pending ID', async () => {
      await connectClient()

      const callPromise = client.call(['test', 'method'], [])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Send response for wrong ID
      simulateResponse(mockWs, 'unknown_id_123', { ignored: true })

      // Original call should still be pending
      const clientAny = client as any
      expect(clientAny.pendingCalls.has(callMsg.id)).toBe(true)

      // Now respond correctly
      simulateResponse(mockWs, callMsg.id, { success: true })
      const result = await callPromise
      expect(result).toEqual({ success: true })
    })
  })

  // ==========================================================================
  // 5. call() - Timeout Handling
  // ==========================================================================
  describe('5. call() - timeout handling', () => {
    it('should reject call after timeout period', async () => {
      await connectClient()

      // Catch to prevent unhandled rejection warning
      let timeoutError: Error | null = null
      const callPromise = client.call(['slow', 'operation'], []).catch((e) => {
        timeoutError = e
      })

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5000)
      await callPromise

      expect(timeoutError).toBeInstanceOf(Error)
      expect(timeoutError?.message).toMatch(/timeout/i)
    })

    it('should include method path in timeout error message', async () => {
      await connectClient()

      let timeoutError: Error | null = null
      const callPromise = client.call(['customer', 'analytics', 'generate'], []).catch((e) => {
        timeoutError = e
      })

      await vi.advanceTimersByTimeAsync(5000)
      await callPromise

      expect(timeoutError?.message).toContain('customer.analytics.generate')
    })

    it('should use custom timeout from options', async () => {
      const fastClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 1000, // 1 second timeout
        autoReconnect: false,
      })

      const connectPromise = fastClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      let timeoutError: Error | null = null
      const callPromise = fastClient.call(['test', 'method'], []).catch((e) => {
        timeoutError = e
      })

      // Should not timeout at 500ms
      await vi.advanceTimersByTimeAsync(500)
      const clientAny = fastClient as any
      expect(clientAny.pendingCalls.size).toBe(1)

      // Should timeout at 1000ms
      await vi.advanceTimersByTimeAsync(500)
      await callPromise

      expect(timeoutError?.message).toMatch(/timeout/i)
    })

    it('should remove pending call from map after timeout', async () => {
      await connectClient()

      const callPromise = client.call(['test', 'method'], []).catch(() => {})
      await vi.advanceTimersByTimeAsync(0)

      const clientAny = client as any
      expect(clientAny.pendingCalls.size).toBe(1)

      await vi.advanceTimersByTimeAsync(5000)
      await callPromise

      expect(clientAny.pendingCalls.size).toBe(0)
    })

    it('should not resolve if response arrives after timeout', async () => {
      await connectClient()

      let timeoutError: Error | null = null
      const callPromise = client.call(['test', 'method'], []).catch((e) => {
        timeoutError = e
      })
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Let it timeout
      await vi.advanceTimersByTimeAsync(5000)
      await callPromise

      expect(timeoutError?.message).toMatch(/timeout/i)

      // Late response should be ignored (call already removed from pending)
      const clientAny = client as any
      expect(clientAny.pendingCalls.has(callMsg.id)).toBe(false)

      // Late response arrives - should not cause errors
      simulateResponse(mockWs, callMsg.id, { late: true })
    })
  })

  // ==========================================================================
  // 6. Reconnection with Exponential Backoff
  // ==========================================================================
  describe('6. Reconnection - exponential backoff logic', () => {
    it('should attempt reconnection when autoReconnect is enabled', async () => {
      const reconnectClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true,
      })

      // Initial connection
      const connectPromise = reconnectClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      let ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      const initialWsCount = wsInstances.length

      // Simulate connection drop
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      // Wait for first reconnect delay (1000ms base)
      await vi.advanceTimersByTimeAsync(1000)

      // Should have created new WebSocket
      expect(wsInstances.length).toBe(initialWsCount + 1)
    })

    it('should use exponential backoff for reconnection delays', async () => {
      const reconnectClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true,
      })

      // Initial connection
      const connectPromise = reconnectClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      let ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      let call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      const clientAny = reconnectClient as any

      // Verify initial reconnect attempts counter
      expect(clientAny.reconnectAttempts).toBe(0)

      // First disconnect
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      // After disconnect, reconnect is scheduled. Check reconnect delay calculation.
      // Formula: reconnectDelay * Math.pow(2, reconnectAttempts - 1)
      // Attempt 1: 1000 * 2^0 = 1000ms
      // Attempt 2: 1000 * 2^1 = 2000ms
      // Attempt 3: 1000 * 2^2 = 4000ms

      // First reconnect should happen after 1000ms
      let wsCountBefore = wsInstances.length
      await vi.advanceTimersByTimeAsync(999)
      expect(wsInstances.length).toBe(wsCountBefore) // Not yet
      await vi.advanceTimersByTimeAsync(1)
      expect(wsInstances.length).toBe(wsCountBefore + 1) // Now

      // Fail the first reconnect attempt
      ws = getMockWs() as MockedWebSocket
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      // Second reconnect should happen after 2000ms
      wsCountBefore = wsInstances.length
      await vi.advanceTimersByTimeAsync(1999)
      expect(wsInstances.length).toBe(wsCountBefore) // Not yet
      await vi.advanceTimersByTimeAsync(1)
      expect(wsInstances.length).toBe(wsCountBefore + 1) // Now

      // Fail the second reconnect attempt
      ws = getMockWs() as MockedWebSocket
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      // Third reconnect should happen after 4000ms
      wsCountBefore = wsInstances.length
      await vi.advanceTimersByTimeAsync(3999)
      expect(wsInstances.length).toBe(wsCountBefore) // Not yet
      await vi.advanceTimersByTimeAsync(1)
      expect(wsInstances.length).toBe(wsCountBefore + 1) // Now

      // Cleanup
      reconnectClient.disconnect()
    })

    it('should stop reconnecting after max attempts', async () => {
      const reconnectClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true,
      })

      const connectPromise = reconnectClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      let ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      const clientAny = reconnectClient as any
      const maxAttempts = clientAny.maxReconnectAttempts // Should be 5

      // Trigger first disconnect
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      // Fail each reconnection attempt up to max
      for (let i = 1; i <= maxAttempts; i++) {
        const delay = 1000 * Math.pow(2, i - 1) // exponential backoff
        await vi.advanceTimersByTimeAsync(delay)

        ws = getMockWs() as MockedWebSocket
        // Don't open the connection - just fail it
        simulateConnectionDrop(ws)
        await vi.advanceTimersByTimeAsync(0)
      }

      const wsCountAfterMaxAttempts = wsInstances.length

      // Wait much longer - should not create more WebSockets
      await vi.advanceTimersByTimeAsync(100000)

      expect(wsInstances.length).toBe(wsCountAfterMaxAttempts)

      // Verify we hit max attempts
      expect(clientAny.reconnectAttempts).toBe(maxAttempts)
    })

    it('should reset reconnect attempts on successful connection', async () => {
      const reconnectClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: true,
      })

      const connectPromise = reconnectClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      let ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      let call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      // Simulate disconnect and reconnect
      simulateConnectionDrop(ws)
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(1000)

      ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await vi.advanceTimersByTimeAsync(0)

      // After successful reconnect, internal counter should be reset
      const clientAny = reconnectClient as any
      expect(clientAny.reconnectAttempts).toBe(0)
    })

    it('should not reconnect when autoReconnect is false', async () => {
      // Client already has autoReconnect: false
      await connectClient()

      const initialWsCount = wsInstances.length

      simulateConnectionDrop(mockWs)
      await vi.advanceTimersByTimeAsync(0)

      // Wait long enough for any reconnection attempt
      await vi.advanceTimersByTimeAsync(10000)

      // Should not have created new WebSocket
      expect(wsInstances.length).toBe(initialWsCount)
    })
  })

  // ==========================================================================
  // 7. Message Parsing - Invalid JSON and Unknown Types
  // ==========================================================================
  describe('7. Message parsing - invalid JSON, unknown message types', () => {
    it('should handle invalid JSON gracefully', async () => {
      await connectClient()

      // Send malformed JSON - should not crash
      expect(() => {
        simulateRawMessage(mockWs, 'not valid json {{{')
      }).not.toThrow()

      // Client should still be functional
      expect(client.getState()).toBe('connected')

      // Should be able to make calls still
      const callPromise = client.call(['test', 'method'], [])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      simulateResponse(mockWs, callMsg.id, { ok: true })

      await expect(callPromise).resolves.toEqual({ ok: true })
    })

    it('should handle unknown message types silently', async () => {
      await connectClient()

      // Send unknown message type
      expect(() => {
        simulateMessage(mockWs, {
          id: 'msg_123',
          type: 'unknown_type',
          data: { some: 'data' },
        })
      }).not.toThrow()

      // Client should still be functional
      expect(client.getState()).toBe('connected')
    })

    it('should handle empty message data', async () => {
      await connectClient()

      expect(() => {
        simulateRawMessage(mockWs, '')
      }).not.toThrow()

      expect(client.getState()).toBe('connected')
    })

    it('should handle null in message', async () => {
      await connectClient()

      expect(() => {
        simulateRawMessage(mockWs, 'null')
      }).not.toThrow()

      expect(client.getState()).toBe('connected')
    })

    it('should handle response message with missing id', async () => {
      await connectClient()

      expect(() => {
        simulateMessage(mockWs, {
          type: 'response',
          result: { some: 'result' },
          // missing id field
        })
      }).not.toThrow()

      // Client should still work
      const callPromise = client.call(['test', 'method'], [])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      simulateResponse(mockWs, callMsg.id, { ok: true })

      await expect(callPromise).resolves.toEqual({ ok: true })
    })

    it('should log invalid messages when debug is enabled', async () => {
      const debugClient = new RpcClient({
        url: 'wss://test.api.dotdo.dev/ws/rpc',
        timeout: 5000,
        autoReconnect: false,
        debug: true,
      })

      const consoleLogSpy = vi.spyOn(console, 'log')

      const connectPromise = debugClient.connect()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getMockWs() as MockedWebSocket
      simulateOpen(ws)
      await vi.advanceTimersByTimeAsync(0)

      const call = JSON.parse(ws.send.mock.calls[0][0])
      simulateResponse(ws, call.id, { name: 'Test', fields: [], methods: [] })
      await connectPromise

      // Clear spy calls before testing invalid message
      consoleLogSpy.mockClear()

      // Send invalid JSON
      simulateRawMessage(ws, 'invalid json')

      // Should have logged with [RpcClient] prefix
      expect(consoleLogSpy).toHaveBeenCalled()
      const lastCallArgs = consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1]
      expect(lastCallArgs[0]).toBe('[RpcClient]')
      expect(lastCallArgs[1]).toBe('Failed to parse message:')

      consoleLogSpy.mockRestore()
    })
  })

  // ==========================================================================
  // 8. Callback Registration and Invocation
  // ==========================================================================
  describe('8. Callback registration and invocation', () => {
    it('should serialize functions as callback references', async () => {
      await connectClient()

      const onProgress = vi.fn()
      const callPromise = client.call(['tasks', 'run'], [{ onProgress }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Function should be replaced with callback reference
      expect(callMsg.args[0].onProgress).toHaveProperty('__rpc_callback_id')
      expect(typeof callMsg.args[0].onProgress.__rpc_callback_id).toBe('string')

      simulateResponse(mockWs, callMsg.id, { taskId: 'task_1' })
      await callPromise
    })

    it('should invoke registered callback when callback message received', async () => {
      await connectClient()

      const onProgress = vi.fn()
      const callPromise = client.call(['tasks', 'run'], [{ onProgress }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const callbackId = callMsg.args[0].onProgress.__rpc_callback_id

      // Server sends callback invocation
      simulateCallback(mockWs, callbackId, [50, 'Halfway done'])

      expect(onProgress).toHaveBeenCalledWith(50, 'Halfway done')

      // Complete the call
      simulateResponse(mockWs, callMsg.id, { taskId: 'task_1' })
      await callPromise
    })

    it('should handle multiple callback invocations', async () => {
      await connectClient()

      const onProgress = vi.fn()
      const callPromise = client.call(['tasks', 'longProcess'], [{ onProgress }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const callbackId = callMsg.args[0].onProgress.__rpc_callback_id

      // Multiple progress updates
      simulateCallback(mockWs, callbackId, [25, 'Quarter done'])
      simulateCallback(mockWs, callbackId, [50, 'Half done'])
      simulateCallback(mockWs, callbackId, [75, 'Almost there'])
      simulateCallback(mockWs, callbackId, [100, 'Complete'])

      expect(onProgress).toHaveBeenCalledTimes(4)
      expect(onProgress).toHaveBeenNthCalledWith(1, 25, 'Quarter done')
      expect(onProgress).toHaveBeenNthCalledWith(2, 50, 'Half done')
      expect(onProgress).toHaveBeenNthCalledWith(3, 75, 'Almost there')
      expect(onProgress).toHaveBeenNthCalledWith(4, 100, 'Complete')

      simulateResponse(mockWs, callMsg.id, { completed: true })
      await callPromise
    })

    it('should handle callback with no arguments', async () => {
      await connectClient()

      const onDone = vi.fn()
      const callPromise = client.call(['tasks', 'notify'], [{ onDone }])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      const callbackId = callMsg.args[0].onDone.__rpc_callback_id

      // Callback with no args
      simulateCallback(mockWs, callbackId, [])

      expect(onDone).toHaveBeenCalledWith()

      simulateResponse(mockWs, callMsg.id, {})
      await callPromise
    })

    it('should ignore callback for unknown callback ID', async () => {
      await connectClient()

      // Send callback for non-existent ID
      expect(() => {
        simulateCallback(mockWs, 'unknown_callback_id', ['ignored', 'data'])
      }).not.toThrow()
    })

    it('should handle event subscription and unsubscription', async () => {
      await connectClient()

      const eventHandler = vi.fn()
      const unsubscribe = client.subscribe('customer.created', eventHandler)

      // Check subscription message was sent
      const lastCall = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      expect(lastCall.type).toBe('subscribe')
      expect(lastCall.eventType).toBe('customer.created')
      expect(lastCall.callbackId).toBeDefined()

      // Unsubscribe
      unsubscribe()

      // Check unsubscription message was sent
      const unsubCall = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      expect(unsubCall.type).toBe('unsubscribe')
      expect(unsubCall.eventType).toBe('customer.created')
    })

    it('should receive events through subscription', async () => {
      await connectClient()

      const eventHandler = vi.fn()
      client.on('event', eventHandler)

      simulateEvent(mockWs, 'customer.created', { $id: 'cust_new', name: 'New Customer' })

      expect(eventHandler).toHaveBeenCalledWith({
        type: 'customer.created',
        data: { $id: 'cust_new', name: 'New Customer' },
      })
    })

    it('should emit rpcError on error message', async () => {
      await connectClient()

      const errorHandler = vi.fn()
      client.on('rpcError', errorHandler)

      simulateMessage(mockWs, {
        id: 'err_1',
        type: 'error',
        error: { message: 'Server error', code: 'INTERNAL' },
      })

      expect(errorHandler).toHaveBeenCalledWith({
        message: 'Server error',
        code: 'INTERNAL',
      })
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================
  describe('Additional edge cases', () => {
    it('should create fluent proxy for method calls', async () => {
      await connectClient()

      const proxy = client.createProxy<{
        customers: {
          get: (id: string) => Promise<{ $id: string; name: string }>
          create: (data: { name: string }) => Promise<{ $id: string }>
        }
      }>()

      const callPromise = proxy.customers.get('cust_123')
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      expect(callMsg.path).toEqual(['customers', 'get'])
      expect(callMsg.args).toEqual(['cust_123'])

      simulateResponse(mockWs, callMsg.id, { $id: 'cust_123', name: 'Alice' })

      const result = await callPromise
      expect(result).toEqual({ $id: 'cust_123', name: 'Alice' })
    })

    it('should handle deeply nested callback in arguments', async () => {
      await connectClient()

      const nestedCallback = vi.fn()
      const callPromise = client.call(['complex', 'operation'], [
        {
          settings: {
            hooks: {
              onEvent: nestedCallback,
            },
          },
        },
      ])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Nested function should be serialized
      expect(callMsg.args[0].settings.hooks.onEvent).toHaveProperty('__rpc_callback_id')

      const callbackId = callMsg.args[0].settings.hooks.onEvent.__rpc_callback_id
      simulateCallback(mockWs, callbackId, ['triggered'])

      expect(nestedCallback).toHaveBeenCalledWith('triggered')

      simulateResponse(mockWs, callMsg.id, { success: true })
      await callPromise
    })

    it('should serialize arrays with functions', async () => {
      await connectClient()

      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const callPromise = client.call(['batch', 'process'], [[cb1, cb2]])
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(callMsg.args[0][0]).toHaveProperty('__rpc_callback_id')
      expect(callMsg.args[0][1]).toHaveProperty('__rpc_callback_id')

      simulateResponse(mockWs, callMsg.id, { processed: 2 })
      await callPromise
    })

    it('should handle subscribe when not connected', () => {
      expect(() => {
        client.subscribe('test.event', () => {})
      }).toThrow('Not connected')
    })
  })
})
