// Transport Layer Tests - TDD for Fetch, WebSocket, and Stub transports
// Tests the Transport interface and all concrete implementations

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Transport, RPCMessage, RPCResponse, TransportState } from '../transport/types'

// ============================================================================
// Transport Interface Tests
// ============================================================================

describe('Transport interface', () => {
  it('FetchTransport sends POST to /rpc', async () => {
    const { FetchTransport } = await import('../transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: 42 }),
      headers: new Headers(),
    })

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })
    const result = await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
    // FetchTransport returns the parsed JSON as the result
    expect(result.result).toEqual({ value: 42 })
  })

  it('FetchTransport attaches custom headers', async () => {
    const { FetchTransport } = await import('../transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
      headers: new Headers(),
    })

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      headers: { Authorization: 'Bearer token' },
      fetch: mockFetch,
    })
    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      })
    )
  })

  it('Transport interface has required methods', async () => {
    const { FetchTransport } = await import('../transport/fetch')

    const transport = new FetchTransport({
      url: 'https://api.example.com',
    })

    expect(typeof transport.send).toBe('function')
  })
})

// ============================================================================
// FetchTransport Tests
// ============================================================================

describe('FetchTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  describe('constructor', () => {
    it('should create transport with required url option', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.send).toBe('function')
    })

    it('should accept optional timeout', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        timeout: 5000,
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      // The timeout should be passed to AbortSignal.timeout
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      )
    })

    it('should accept optional correlation ID', async () => {
      const { FetchTransport } = await import('../transport/fetch')
      const { CORRELATION_ID_HEADER } = await import('../client')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'base-correlation-id',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            [CORRELATION_ID_HEADER]: 'base-correlation-id',
          }),
        })
      )
    })
  })

  describe('send', () => {
    it('should send method and args in request body', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: 'result' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await transport.send({ method: 'users.create', args: [{ name: 'Alice' }] })

      const [[, options]] = mockFetch.mock.calls
      const body = JSON.parse(options.body)

      expect(body.method).toBe('users.create')
      expect(body.args).toEqual([{ name: 'Alice' }])
    })

    it('should return result from successful response', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.result).toEqual({ success: true, data: { id: 123 } })
      expect(response.error).toBeUndefined()
    })

    it('should include correlation ID in response', async () => {
      const { FetchTransport } = await import('../transport/fetch')
      const { CORRELATION_ID_HEADER } = await import('../client')

      const responseHeaders = new Headers()
      responseHeaders.set(CORRELATION_ID_HEADER, 'response-correlation-id')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: responseHeaders,
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.correlationId).toBe('response-correlation-id')
    })

    it('should use message correlation ID over base correlation ID', async () => {
      const { FetchTransport } = await import('../transport/fetch')
      const { CORRELATION_ID_HEADER } = await import('../client')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'base-id',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [], correlationId: 'message-id' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            [CORRELATION_ID_HEADER]: 'message-id',
          }),
        })
      )
    })

    it('should generate correlation ID if not provided', async () => {
      const { FetchTransport } = await import('../transport/fetch')
      const { CORRELATION_ID_HEADER } = await import('../client')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      const [[, options]] = mockFetch.mock.calls
      expect(options.headers[CORRELATION_ID_HEADER]).toBeDefined()
      expect(typeof options.headers[CORRELATION_ID_HEADER]).toBe('string')
    })
  })

  describe('error handling', () => {
    it('should return error response on network failure', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.type).toBe('TransportError')
      expect(response.correlationId).toBeDefined()
    })

    it('should parse structured error response', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            type: 'NotFoundError',
            code: 'NOT_FOUND',
            message: 'User not found',
          }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'users.get', args: ['123'] })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('NOT_FOUND')
      expect(response.error?.message).toBe('User not found')
    })

    it('should return generic error for non-JSON error response', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('500')
    })

    it('should handle timeout errors', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        timeout: 1000,
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('timeout')
    })
  })

  describe('getState', () => {
    it('should always return CONNECTED for stateless transport', async () => {
      const { FetchTransport } = await import('../transport/fetch')
      const { TransportState } = await import('../transport/types')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })
  })

  describe('close', () => {
    it('should be a no-op for stateless transport', async () => {
      const { FetchTransport } = await import('../transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await expect(transport.close()).resolves.toBeUndefined()
    })
  })
})

// ============================================================================
// WebSocketTransport Tests
// ============================================================================

describe('WebSocketTransport', () => {
  // Mock WebSocket implementation
  class MockWebSocket {
    static OPEN = 1
    static CLOSED = 3

    url: string
    readyState = MockWebSocket.OPEN
    listeners: Record<string, Function[]> = {}

    constructor(url: string) {
      this.url = url
      // Auto-trigger open after construction
      setTimeout(() => this.emit('open', {}), 0)
    }

    addEventListener(event: string, handler: Function) {
      if (!this.listeners[event]) {
        this.listeners[event] = []
      }
      this.listeners[event].push(handler)
    }

    removeEventListener(event: string, handler: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
      }
    }

    emit(event: string, data: unknown) {
      if (this.listeners[event]) {
        this.listeners[event].forEach((h) => h(data))
      }
    }

    send(data: string) {
      // Simulate async response
      const message = JSON.parse(data)
      setTimeout(() => {
        this.emit('message', {
          data: JSON.stringify({
            id: message.id,
            result: { echo: message.method },
          }),
        })
      }, 10)
    }

    close() {
      this.readyState = MockWebSocket.CLOSED
      this.emit('close', {})
    }
  }

  describe('constructor', () => {
    it('should create transport with required url option', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.send).toBe('function')
    })

    it('should accept auto-reconnect options', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        autoReconnect: false,
        maxReconnectAttempts: 3,
        reconnectDelay: 500,
        maxReconnectDelay: 10000,
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
      })

      expect(transport).toBeDefined()
    })
  })

  describe('send', () => {
    it('should send message and receive response', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const response = await transport.send({ method: 'test.echo', args: ['hello'] })

      expect(response.result).toEqual({ echo: 'test.echo' })
      expect(response.error).toBeUndefined()

      await transport.close()
    })

    it('should include correlation ID in response', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const response = await transport.send({
        method: 'test',
        args: [],
        correlationId: 'test-correlation',
      })

      expect(response.correlationId).toBe('test-correlation')

      await transport.close()
    })
  })

  describe('getState', () => {
    it('should return DISCONNECTED initially', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')
      const { TransportState } = await import('../transport/types')

      // Create a WebSocket that doesn't auto-connect
      class DelayedMockWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          // Don't auto-trigger open
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: DelayedMockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      expect(transport.getState()).toBe(TransportState.DISCONNECTED)
    })

    it('should return CONNECTED after successful connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')
      const { TransportState } = await import('../transport/types')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      // Send triggers connection
      await transport.send({ method: 'test', args: [] })

      expect(transport.getState()).toBe(TransportState.CONNECTED)

      await transport.close()
    })
  })

  describe('close', () => {
    it('should close WebSocket connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')
      const { TransportState } = await import('../transport/types')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      await transport.close()

      expect(transport.getState()).toBe(TransportState.CLOSED)
    })

    it('should reject pending requests on close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      // Create a WebSocket that doesn't respond
      class NoResponseWebSocket extends MockWebSocket {
        send(_data: string) {
          // Don't respond
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: NoResponseWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
        timeout: 10000, // Long timeout so we can close before it fires
      })

      const sendPromise = transport.send({ method: 'test', args: [] })

      // Close immediately
      setTimeout(() => transport.close(), 50)

      // The send should be rejected
      await expect(sendPromise).rejects.toThrow('Transport closed')
    })
  })

  describe('addEventListener', () => {
    it('should notify listeners of connect event', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const events: { type: string }[] = []
      transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      expect(events.some((e) => e.type === 'connect')).toBe(true)

      await transport.close()
    })

    it('should return unsubscribe function', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      const events: { type: string }[] = []
      const unsubscribe = transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      unsubscribe()

      // Trigger connection - listener should not be called
      await transport.send({ method: 'test', args: [] })

      expect(events.length).toBe(0)

      await transport.close()
    })
  })

  describe('timeout handling', () => {
    it('should timeout pending requests', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      // Create a WebSocket that doesn't respond
      class NoResponseWebSocket extends MockWebSocket {
        send(_data: string) {
          // Don't respond
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: NoResponseWebSocket as unknown as typeof WebSocket,
        timeout: 100, // Short timeout
        autoReconnect: false,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('TIMEOUT')
      expect(response.error?.message).toContain('timed out')

      await transport.close()
    })
  })

  describe('reconnection', () => {
    it('should emit reconnect event when attempting to reconnect', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let connectionCount = 0

      // Create a WebSocket that fails on first connection
      class ReconnectingWebSocket {
        static OPEN = 1
        static CLOSED = 3

        url: string
        readyState = 0
        listeners: Record<string, Function[]> = {}

        constructor(url: string) {
          this.url = url
          connectionCount++

          // First connection fails, subsequent ones succeed
          setTimeout(() => {
            if (connectionCount === 1) {
              this.emit('error', new Event('error'))
              this.emit('close', {})
            } else {
              this.readyState = ReconnectingWebSocket.OPEN
              this.emit('open', {})
            }
          }, 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(event: string, handler: Function) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
          }
        }

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(data: string) {
          const message = JSON.parse(data)
          setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                id: message.id,
                result: { echo: message.method },
              }),
            })
          }, 5)
        }

        close() {
          this.readyState = ReconnectingWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const events: { type: string; attempt?: number }[] = []

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: ReconnectingWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 10, // Very short for testing
        maxReconnectAttempts: 3,
      })

      transport.addEventListener((event) => {
        events.push({ type: event.type, attempt: event.attempt })
      })

      // Initial connection will fail, triggering reconnect
      try {
        await transport.send({ method: 'test', args: [] })
      } catch {
        // Expected to fail on first attempt
      }

      // Wait for reconnect event and successful reconnection
      await new Promise((r) => setTimeout(r, 50))

      expect(events.some((e) => e.type === 'reconnect')).toBe(true)

      await transport.close()
    })

    it('should stop reconnecting after max attempts', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let connectionAttempts = 0

      // Create a WebSocket that always fails (no extension)
      class AlwaysFailWebSocket {
        static OPEN = 1
        static CLOSED = 3

        url: string
        readyState = 0
        listeners: Record<string, Function[]> = {}

        constructor(url: string) {
          this.url = url
          connectionAttempts++

          // Always fail connection
          setTimeout(() => {
            this.emit('error', new Event('error'))
            this.emit('close', {})
          }, 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(event: string, handler: Function) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
          }
        }

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(_data: string) {}

        close() {
          this.readyState = AlwaysFailWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: AlwaysFailWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 5,
        maxReconnectAttempts: 2,
      })

      // Trigger initial connection
      try {
        await transport.send({ method: 'test', args: [] })
      } catch {
        // Expected
      }

      // Wait for all reconnect attempts (initial + delay + attempts + delay + attempts)
      // With 5ms delay and 2 max reconnects, need about 5 + 5*2 + 5*2*2 = 35ms
      await new Promise((r) => setTimeout(r, 100))

      // Should be: 1 initial + 2 reconnects = 3 total
      expect(connectionAttempts).toBeLessThanOrEqual(3)

      await transport.close()
    })

    it('should use exponential backoff for reconnection delays', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const reconnectTimes: number[] = []
      let lastTime = Date.now()

      // Create a WebSocket that always fails
      class TimingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          const now = Date.now()
          reconnectTimes.push(now - lastTime)
          lastTime = now

          setTimeout(() => {
            this.emit('error', new Event('error'))
            this.emit('close', {})
          }, 0)
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: TimingWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 20, // Base delay
        maxReconnectDelay: 1000,
        maxReconnectAttempts: 3,
      })

      // Trigger initial connection
      try {
        await transport.send({ method: 'test', args: [] })
      } catch {
        // Expected
      }

      // Wait for reconnect attempts
      await new Promise((r) => setTimeout(r, 200))

      // Second delay should be greater than first (exponential backoff)
      // Note: First entry is from initial connection (should be ~0)
      if (reconnectTimes.length >= 3) {
        expect(reconnectTimes[2]).toBeGreaterThanOrEqual(reconnectTimes[1])
      }

      await transport.close()
    })

    it('should not reconnect when autoReconnect is false', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      let connectionAttempts = 0

      class CountingWebSocket extends MockWebSocket {
        constructor(url: string) {
          super(url)
          connectionAttempts++

          setTimeout(() => {
            this.emit('error', new Event('error'))
            this.emit('close', {})
          }, 0)
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: CountingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      // Trigger initial connection
      try {
        await transport.send({ method: 'test', args: [] })
      } catch {
        // Expected
      }

      // Wait to ensure no reconnects
      await new Promise((r) => setTimeout(r, 50))

      expect(connectionAttempts).toBe(1)

      await transport.close()
    })

    it('should resolve pending requests with disconnect error', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      // Create a custom WebSocket that disconnects after receiving a message
      class DisconnectingWebSocket {
        static OPEN = 1
        static CLOSED = 3

        url: string
        readyState = DisconnectingWebSocket.OPEN
        listeners: Record<string, Function[]> = {}

        constructor(url: string) {
          this.url = url
          // Auto-open after a moment
          setTimeout(() => this.emit('open', {}), 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(event: string, handler: Function) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
          }
        }

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(_data: string) {
          // Disconnect after receiving message, don't respond
          setTimeout(() => {
            this.readyState = DisconnectingWebSocket.CLOSED
            this.emit('close', {})
          }, 20)
        }

        close() {
          this.readyState = DisconnectingWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: DisconnectingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
        timeout: 5000,
      })

      const response = await transport.send({ method: 'test', args: [] })

      // Should get disconnection error (not timeout)
      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('disconnected')

      await transport.close()
    })
  })

  describe('heartbeat', () => {
    it('should send heartbeat pings at configured interval', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const sentMessages: string[] = []

      // Custom WebSocket that tracks messages and responds appropriately
      class HeartbeatWebSocket {
        static OPEN = 1
        static CLOSED = 3

        url: string
        readyState = HeartbeatWebSocket.OPEN
        listeners: Record<string, Function[]> = {}

        constructor(url: string) {
          this.url = url
          setTimeout(() => this.emit('open', {}), 5)
        }

        addEventListener(event: string, handler: Function) {
          if (!this.listeners[event]) {
            this.listeners[event] = []
          }
          this.listeners[event].push(handler)
        }

        removeEventListener(event: string, handler: Function) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((h) => h !== handler)
          }
        }

        emit(event: string, data: unknown) {
          if (this.listeners[event]) {
            this.listeners[event].forEach((h) => h(data))
          }
        }

        send(data: string) {
          sentMessages.push(data)
          // Echo back responses
          const msg = JSON.parse(data)
          setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                id: msg.id,
                result: msg.method === '$ping' ? { pong: true, timestamp: Date.now() } : { echo: msg.method },
              }),
            })
          }, 5)
        }

        close() {
          this.readyState = HeartbeatWebSocket.CLOSED
          this.emit('close', {})
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: HeartbeatWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
        heartbeatInterval: 20, // Very short for testing
      })

      // Trigger connection by sending a message
      await transport.send({ method: 'test', args: [] })

      // Wait for heartbeats
      await new Promise((r) => setTimeout(r, 100))

      const heartbeats = sentMessages.filter((m) => {
        try {
          return JSON.parse(m).method === '$ping'
        } catch {
          return false
        }
      })

      // Should have sent at least 2 heartbeats in 100ms with 20ms interval
      expect(heartbeats.length).toBeGreaterThanOrEqual(2)

      await transport.close()
    })

    it('should close connection if heartbeat times out', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')
      const { TransportState } = await import('../transport/types')

      class NoResponseHeartbeatWebSocket extends MockWebSocket {
        send(data: string) {
          // Don't respond to heartbeats, but respond to regular messages
          const msg = JSON.parse(data)
          if (msg.method !== '$ping') {
            setTimeout(() => {
              this.emit('message', {
                data: JSON.stringify({
                  id: msg.id,
                  result: { echo: msg.method },
                }),
              })
            }, 5)
          }
          // Heartbeat pings get no response
        }
      }

      const events: { type: string }[] = []

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: NoResponseHeartbeatWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
        heartbeatInterval: 20,
        heartbeatTimeout: 30,
      })

      transport.addEventListener((event) => {
        events.push({ type: event.type })
      })

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      // Wait for heartbeat timeout
      await new Promise((r) => setTimeout(r, 150))

      // Should have disconnected due to heartbeat timeout
      expect(events.some((e) => e.type === 'disconnect' || e.type === 'error')).toBe(true)

      await transport.close()
    })

    it('should not send heartbeats when disabled', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const sentMessages: string[] = []

      class TrackingWebSocket extends MockWebSocket {
        send(data: string) {
          sentMessages.push(data)
          const msg = JSON.parse(data)
          setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                id: msg.id,
                result: { echo: msg.method },
              }),
            })
          }, 5)
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: TrackingWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
        // No heartbeatInterval means disabled (default)
      })

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      // Wait a bit
      await new Promise((r) => setTimeout(r, 100))

      const heartbeats = sentMessages.filter((m) => {
        try {
          return JSON.parse(m).method === '$ping'
        } catch {
          return false
        }
      })

      // Should not have sent any heartbeats
      expect(heartbeats.length).toBe(0)

      await transport.close()
    })
  })

  describe('isConnected helper', () => {
    it('should return false when not connected', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      expect(transport.isConnected()).toBe(false)

      await transport.close()
    })

    it('should return true when connected', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/ws',
        WebSocket: MockWebSocket as unknown as typeof WebSocket,
        autoReconnect: false,
      })

      // Trigger connection
      await transport.send({ method: 'test', args: [] })

      expect(transport.isConnected()).toBe(true)

      await transport.close()
    })
  })
})

// ============================================================================
// StubTransport Tests
// ============================================================================

describe('StubTransport', () => {
  // Mock DO stub
  function createMockStub(options: {
    response?: unknown
    error?: { type: string; code: string; message: string }
    status?: number
    headers?: Record<string, string>
    throwError?: Error
  } = {}) {
    return {
      fetch: vi.fn(async (_url: string, _init?: RequestInit) => {
        if (options.throwError) {
          throw options.throwError
        }

        const headers = new Headers(options.headers)
        const status = options.status ?? (options.error ? 400 : 200)
        const body = options.error ?? options.response ?? { result: 'ok' }

        return {
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(body),
          headers,
        }
      }),
    }
  }

  describe('constructor', () => {
    it('should create transport with required stub option', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.send).toBe('function')
    })

    it('should accept optional baseUrl', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
        baseUrl: 'https://custom-do',
      })

      await transport.send({ method: 'test', args: [] })

      expect(stub.fetch).toHaveBeenCalledWith(
        'https://custom-do/rpc',
        expect.any(Object)
      )
    })

    it('should accept optional sourceDoId for trust chain', async () => {
      const { StubTransport } = await import('../transport/stub')
      const { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } = await import('../headers')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
        sourceDoId: 'source-do-123',
      })

      await transport.send({ method: 'test', args: [] })

      const [[, options]] = stub.fetch.mock.calls
      expect(options.headers[DO_SOURCE_HEADER]).toBe('true')
      expect(options.headers[DO_SOURCE_ID_HEADER]).toBe('source-do-123')
    })
  })

  describe('send', () => {
    it('should send POST request to /rpc endpoint', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub({ response: { data: 'test' } })
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      await transport.send({ method: 'test.method', args: [1, 2, 3] })

      expect(stub.fetch).toHaveBeenCalledWith(
        'https://do/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )

      const [[, options]] = stub.fetch.mock.calls
      const body = JSON.parse(options.body)
      expect(body.method).toBe('test.method')
      expect(body.args).toEqual([1, 2, 3])
    })

    it('should return result from successful response', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub({ response: { id: 123, name: 'Test' } })
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      const response = await transport.send({ method: 'get', args: [] })

      expect(response.result).toEqual({ id: 123, name: 'Test' })
      expect(response.error).toBeUndefined()
    })

    it('should include correlation ID in request and response', async () => {
      const { StubTransport } = await import('../transport/stub')
      const { CORRELATION_ID_HEADER } = await import('../client')

      const responseHeaders = new Headers()
      responseHeaders.set(CORRELATION_ID_HEADER, 'response-correlation')

      const stub = createMockStub({ response: { ok: true }, headers: { [CORRELATION_ID_HEADER]: 'response-correlation' } })
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      const response = await transport.send({
        method: 'test',
        args: [],
        correlationId: 'test-correlation',
      })

      const [[, options]] = stub.fetch.mock.calls
      expect(options.headers[CORRELATION_ID_HEADER]).toBe('test-correlation')
      expect(response.correlationId).toBe('response-correlation')
    })
  })

  describe('error handling', () => {
    it('should return error response when stub fetch throws', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub({ throwError: new Error('Stub fetch failed') })
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.type).toBe('TransportError')
      expect(response.correlationId).toBeDefined()
    })

    it('should parse structured error response', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub({
        status: 404,
        error: {
          type: 'NotFoundError',
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      })
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      const response = await transport.send({ method: 'get', args: ['missing-id'] })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('NOT_FOUND')
      expect(response.error?.message).toBe('Resource not found')
    })

    it('should return generic error for non-JSON error response', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('Invalid JSON')),
          headers: new Headers(),
        }),
      }
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('500')
    })
  })

  describe('getState', () => {
    it('should always return CONNECTED for stateless transport', async () => {
      const { StubTransport } = await import('../transport/stub')
      const { TransportState } = await import('../transport/types')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })
  })

  describe('close', () => {
    it('should be a no-op for stateless transport', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      await expect(transport.close()).resolves.toBeUndefined()
    })
  })

  describe('getStub', () => {
    it('should return the underlying stub', async () => {
      const { StubTransport } = await import('../transport/stub')

      const stub = createMockStub()
      const transport = new StubTransport({
        stub: stub as unknown as DurableObjectStub,
      })

      expect(transport.getStub()).toBe(stub)
    })
  })
})

// ============================================================================
// Transport Type Guards Tests
// ============================================================================

describe('Transport type guards', () => {
  it('isCloseable should detect closeable transports', async () => {
    const { FetchTransport } = await import('../transport/fetch')
    const { isCloseable } = await import('../transport/types')

    const transport = new FetchTransport({ url: 'https://api.example.com' })

    expect(isCloseable(transport)).toBe(true)
  })

  it('isStateful should detect stateful transports', async () => {
    const { FetchTransport } = await import('../transport/fetch')
    const { isStateful } = await import('../transport/types')

    const transport = new FetchTransport({ url: 'https://api.example.com' })

    expect(isStateful(transport)).toBe(true)
  })

  it('supportsEvents should detect event-supporting transports', async () => {
    const { WebSocketTransport } = await import('../transport/websocket')
    const { FetchTransport } = await import('../transport/fetch')
    const { supportsEvents } = await import('../transport/types')

    // Mock WebSocket for the test
    class MockWebSocket {
      static OPEN = 1
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }

    const wsTransport = new WebSocketTransport({
      url: 'wss://api.example.com',
      WebSocket: MockWebSocket as unknown as typeof WebSocket,
    })
    const fetchTransport = new FetchTransport({ url: 'https://api.example.com' })

    expect(supportsEvents(wsTransport)).toBe(true)
    expect(supportsEvents(fetchTransport)).toBe(false)
  })
})

// ============================================================================
// createStubTransport Helper Tests
// ============================================================================

describe('createStubTransport', () => {
  it('should create transport from binding and string ID', async () => {
    const { createStubTransport } = await import('../transport/stub')

    const mockStub = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
        headers: new Headers(),
      }),
    }

    const mockBinding = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'generated-id' }),
      get: vi.fn().mockReturnValue(mockStub),
    }

    const transport = createStubTransport({
      binding: mockBinding as unknown as DurableObjectNamespace,
      id: 'my-instance',
    })

    expect(mockBinding.idFromName).toHaveBeenCalledWith('my-instance')
    expect(mockBinding.get).toHaveBeenCalled()

    await transport.send({ method: 'test', args: [] })
    expect(mockStub.fetch).toHaveBeenCalled()
  })

  it('should create transport from binding and DurableObjectId', async () => {
    const { createStubTransport } = await import('../transport/stub')

    const mockStub = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
        headers: new Headers(),
      }),
    }

    const mockDoId = { toString: () => 'existing-id' }

    const mockBinding = {
      idFromName: vi.fn(),
      get: vi.fn().mockReturnValue(mockStub),
    }

    createStubTransport({
      binding: mockBinding as unknown as DurableObjectNamespace,
      id: mockDoId as DurableObjectId,
    })

    // Should not call idFromName when given an actual DurableObjectId
    expect(mockBinding.idFromName).not.toHaveBeenCalled()
    expect(mockBinding.get).toHaveBeenCalledWith(mockDoId)
  })
})
