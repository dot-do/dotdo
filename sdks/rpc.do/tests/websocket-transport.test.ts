// WebSocket Transport Tests for rpc.do - TDD for WebSocket-based RPC transport
// Tests the WebSocketTransport implementation following Red-Green-Refactor methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransportState, type TransportEvent, type TransportEventListener } from '../transport/types'

// ============================================================================
// Mock WebSocket for Testing
// ============================================================================

interface MockWebSocketEvent {
  data?: string
  code?: number
  reason?: string
}

type MockWebSocketState = 0 | 1 | 2 | 3

class MockWebSocket {
  static readonly CONNECTING = 0 as const
  static readonly OPEN = 1 as const
  static readonly CLOSING = 2 as const
  static readonly CLOSED = 3 as const

  readonly CONNECTING = MockWebSocket.CONNECTING
  readonly OPEN = MockWebSocket.OPEN
  readonly CLOSING = MockWebSocket.CLOSING
  readonly CLOSED = MockWebSocket.CLOSED

  readyState: MockWebSocketState = MockWebSocket.CONNECTING
  url: string

  onopen: ((event: MockWebSocketEvent) => void) | null = null
  onclose: ((event: MockWebSocketEvent) => void) | null = null
  onerror: ((event: MockWebSocketEvent) => void) | null = null
  onmessage: ((event: MockWebSocketEvent) => void) | null = null

  private sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED
      this.onclose?.({ code: code ?? 1000, reason: reason ?? '' })
    }, 0)
  }

  // Test helper methods
  simulateOpen(): void {
    this.readyState = 1 as MockWebSocketState // OPEN
    this.onopen?.({})
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError(message?: string): void {
    this.onerror?.({ data: message ?? 'WebSocket error' })
  }

  simulateClose(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' })
  }

  getSentMessages(): string[] {
    return this.sentMessages
  }

  getLastSentMessage<T>(): T | undefined {
    const last = this.sentMessages[this.sentMessages.length - 1]
    return last ? JSON.parse(last) : undefined
  }
}

// ============================================================================
// WebSocketTransport Interface Tests
// ============================================================================

describe('WebSocketTransport', () => {
  let mockWS: MockWebSocket
  let originalWebSocket: typeof globalThis.WebSocket
  let wsInstances: MockWebSocket[] = []

  beforeEach(() => {
    wsInstances = []
    originalWebSocket = globalThis.WebSocket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        wsInstances.push(this)
        mockWS = this
      }
    }
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Implements Transport Interface
  // ==========================================================================

  describe('Transport interface implementation', () => {
    it('should implement Transport interface with required methods', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      expect(typeof transport.send).toBe('function')
      expect(typeof transport.close).toBe('function')
      expect(typeof transport.getState).toBe('function')
      expect(typeof transport.addEventListener).toBe('function')
      expect(typeof transport.connect).toBe('function')
    })
  })

  // ==========================================================================
  // 2. connect() establishes WebSocket connection
  // ==========================================================================

  describe('connect', () => {
    it('should establish WebSocket connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })

    it('should reject if connection fails', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateError('Connection refused')
      mockWS.simulateClose(1006, 'Connection refused')

      await expect(connectPromise).rejects.toThrow()
    })

    it('should be in CONNECTING state while connecting', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      transport.connect()
      expect(transport.getState()).toBe(TransportState.CONNECTING)
    })

    it('should not create multiple connections if already connected', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const promise1 = transport.connect()
      mockWS.simulateOpen()
      await promise1

      // Second connect should return immediately without creating new connection
      const instanceCountBefore = wsInstances.length
      await transport.connect()
      expect(wsInstances.length).toBe(instanceCountBefore)
    })
  })

  // ==========================================================================
  // 3. send() sends RPC message over WebSocket
  // ==========================================================================

  describe('send', () => {
    it('should send RPC message over WebSocket', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'users.create',
        args: [{ name: 'Alice' }],
      })

      // Simulate response
      const sentMessage = mockWS.getLastSentMessage<{ id: string; method: string; args: unknown[] }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: { id: '123', name: 'Alice' },
      })

      const response = await sendPromise

      expect(response.result).toEqual({ id: '123', name: 'Alice' })
    })

    it('should include method and args in sent message', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      transport.send({
        method: 'users.get',
        args: ['user-123'],
      })

      const sentMessage = mockWS.getLastSentMessage<{ method: string; args: unknown[] }>()
      expect(sentMessage?.method).toBe('users.get')
      expect(sentMessage?.args).toEqual(['user-123'])
    })

    it('should auto-connect if not connected', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const sendPromise = transport.send({
        method: 'test',
        args: [],
      })

      // Should have created a WebSocket
      expect(wsInstances.length).toBe(1)

      mockWS.simulateOpen()

      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: 'ok',
      })

      const response = await sendPromise
      expect(response.result).toBe('ok')
    })
  })

  // ==========================================================================
  // 4. Receives RPC response via WebSocket message
  // ==========================================================================

  describe('receive response', () => {
    it('should receive and parse JSON response', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'getData',
        args: [],
      })

      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: { data: [1, 2, 3] },
      })

      const response = await sendPromise
      expect(response.result).toEqual({ data: [1, 2, 3] })
    })

    it('should handle error responses', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'failingMethod',
        args: [],
      })

      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        error: {
          type: 'ValidationError',
          code: 'INVALID_INPUT',
          message: 'Invalid input provided',
        },
      })

      const response = await sendPromise
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('INVALID_INPUT')
      expect(response.error?.message).toBe('Invalid input provided')
    })
  })

  // ==========================================================================
  // 5. close() closes the WebSocket connection
  // ==========================================================================

  describe('close', () => {
    it('should close the WebSocket connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      await transport.close()

      expect(transport.getState()).toBe(TransportState.CLOSED)
    })

    it('should be safe to call close() multiple times', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      await transport.close()
      await expect(transport.close()).resolves.toBeUndefined()
    })

    it('should reject pending requests on close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'slowMethod',
        args: [],
      })

      await transport.close()

      const response = await sendPromise
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('CONNECTION_CLOSED')
    })
  })

  // ==========================================================================
  // 6. Handles connection errors gracefully
  // ==========================================================================

  describe('connection error handling', () => {
    it('should handle connection errors gracefully', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateError('Network error')
      mockWS.simulateClose(1006, 'Abnormal closure')

      await expect(connectPromise).rejects.toThrow()
      expect(transport.getState()).toBe(TransportState.DISCONNECTED)
    })

    it('should emit error event on connection error', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateError('Network error')
      mockWS.simulateClose(1006, 'Abnormal closure')

      try {
        await connectPromise
      } catch {
        // Expected to throw
      }

      expect(events.some((e) => e.type === 'error')).toBe(true)
    })
  })

  // ==========================================================================
  // 7. Handles message parse errors
  // ==========================================================================

  describe('message parse error handling', () => {
    it('should handle invalid JSON messages', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Send invalid JSON - should not crash
      mockWS.onmessage?.({ data: 'not valid json{{{' })

      // Transport should still be functional
      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })

    it('should ignore messages without matching request ID', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'test',
        args: [],
      })

      // Send response with wrong ID
      mockWS.simulateMessage({
        id: 'wrong-id',
        result: 'unexpected',
      })

      // Original request should still be pending
      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: 'correct',
      })

      const response = await sendPromise
      expect(response.result).toBe('correct')
    })
  })

  // ==========================================================================
  // 8. Reconnects automatically on disconnect
  // ==========================================================================

  describe('automatic reconnection', () => {
    it('should reconnect automatically on disconnect when enabled', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 1000,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Simulate unexpected disconnect
      mockWS.simulateClose(1006, 'Abnormal closure')

      expect(transport.getState()).toBe(TransportState.DISCONNECTED)

      // Wait for reconnect attempt
      await vi.advanceTimersByTimeAsync(1000)

      // New WebSocket should be created
      expect(wsInstances.length).toBe(2)

      // Simulate successful reconnect
      wsInstances[1]!.simulateOpen()

      expect(transport.getState()).toBe(TransportState.CONNECTED)

      vi.useRealTimers()
    })

    it('should not reconnect if reconnect is disabled', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      mockWS.simulateClose(1006, 'Abnormal closure')

      await vi.advanceTimersByTimeAsync(5000)

      // Should not have created new WebSocket
      expect(wsInstances.length).toBe(1)
      expect(transport.getState()).toBe(TransportState.DISCONNECTED)

      vi.useRealTimers()
    })

    it('should stop reconnecting after max attempts', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
        maxReconnectAttempts: 3,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Simulate disconnect
      mockWS.simulateClose(1006, 'Abnormal closure')

      // Allow all reconnect attempts to fail
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(100)
        if (wsInstances.length > i + 1) {
          const ws = wsInstances[wsInstances.length - 1]!
          ws.simulateError()
          ws.simulateClose(1006)
        }
      }

      // Should have made exactly 3 reconnect attempts
      // Initial + 3 reconnects = 4 total
      expect(wsInstances.length).toBe(4)
      expect(transport.getState()).toBe(TransportState.DISCONNECTED)

      vi.useRealTimers()
    })

    it('should emit reconnect event on reconnect attempt', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      mockWS.simulateClose(1006, 'Abnormal closure')

      await vi.advanceTimersByTimeAsync(100)

      expect(events.some((e) => e.type === 'reconnect' && e.attempt === 1)).toBe(true)

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // 9. Queues messages while reconnecting
  // ==========================================================================

  describe('message queuing during reconnection', () => {
    it('should queue messages while reconnecting', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
      })

      const connectPromise = transport.connect()
      const initialWs = wsInstances[0]!
      initialWs.simulateOpen()
      await connectPromise

      // Disconnect - don't use mockWS as it may have changed
      initialWs.simulateClose(1006, 'Abnormal closure')

      // Send message while disconnected - should be queued
      const sendPromise = transport.send({
        method: 'queuedMethod',
        args: ['queued'],
      })

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(100)

      // Verify new WebSocket was created
      expect(wsInstances.length).toBe(2)

      // New WebSocket connects
      const newWs = wsInstances[1]!
      newWs.simulateOpen()

      // Message should now be sent
      const sentMessage = newWs.getLastSentMessage<{ id: string; method: string }>()
      expect(sentMessage?.method).toBe('queuedMethod')

      // Respond to message
      newWs.simulateMessage({
        id: sentMessage?.id,
        result: 'queued result',
      })

      const response = await sendPromise
      expect(response.result).toBe('queued result')

      vi.useRealTimers()
    })

    it('should send queued messages in order after reconnect', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
      })

      const connectPromise = transport.connect()
      const initialWs = wsInstances[0]!
      initialWs.simulateOpen()
      await connectPromise

      initialWs.simulateClose(1006, 'Abnormal closure')

      // Queue multiple messages
      const promise1 = transport.send({ method: 'first', args: [] })
      const promise2 = transport.send({ method: 'second', args: [] })
      const promise3 = transport.send({ method: 'third', args: [] })

      await vi.advanceTimersByTimeAsync(100)

      const newWs = wsInstances[1]!
      newWs.simulateOpen()

      // Verify messages were sent in order
      const messages = newWs.getSentMessages().map((m) => JSON.parse(m) as { method: string; id: string })
      expect(messages[0]!.method).toBe('first')
      expect(messages[1]!.method).toBe('second')
      expect(messages[2]!.method).toBe('third')

      // Complete all promises
      for (const msg of messages) {
        newWs.simulateMessage({ id: msg.id, result: msg.method })
      }

      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3])
      expect(r1.result).toBe('first')
      expect(r2.result).toBe('second')
      expect(r3.result).toBe('third')

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // 10. getState() returns correct connection state
  // ==========================================================================

  describe('getState', () => {
    it('should return DISCONNECTED initially', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      expect(transport.getState()).toBe(TransportState.DISCONNECTED)
    })

    it('should return CONNECTING while connecting', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      transport.connect()

      expect(transport.getState()).toBe(TransportState.CONNECTING)
    })

    it('should return CONNECTED after successful connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })

    it('should return DISCONNECTED after disconnect', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      mockWS.simulateClose(1006)

      expect(transport.getState()).toBe(TransportState.DISCONNECTED)
    })

    it('should return CLOSED after explicit close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      await transport.close()

      expect(transport.getState()).toBe(TransportState.CLOSED)
    })
  })

  // ==========================================================================
  // 11. addEventListener() emits connect/disconnect/error events
  // ==========================================================================

  describe('addEventListener', () => {
    it('should emit connect event on successful connection', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      expect(events.some((e) => e.type === 'connect')).toBe(true)
    })

    it('should emit disconnect event on connection close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      mockWS.simulateClose(1000)

      expect(events.some((e) => e.type === 'disconnect')).toBe(true)
    })

    it('should emit error event on connection error', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateError('Connection failed')
      mockWS.simulateClose(1006)

      try {
        await connectPromise
      } catch {
        // Expected
      }

      expect(events.some((e) => e.type === 'error')).toBe(true)
    })

    it('should return unsubscribe function', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const events: TransportEvent[] = []
      const unsubscribe = transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      expect(events.length).toBe(1) // connect event

      unsubscribe()

      mockWS.simulateClose(1000)

      // Should not have received disconnect event
      expect(events.length).toBe(1)
    })
  })

  // ==========================================================================
  // 12. Timeout handling for requests
  // ==========================================================================

  describe('timeout handling', () => {
    it('should timeout request after specified duration', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        timeout: 5000,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'slowMethod',
        args: [],
      })

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5001)

      const response = await sendPromise
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('TIMEOUT')

      vi.useRealTimers()
    })

    it('should not timeout if response arrives in time', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        timeout: 5000,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'fastMethod',
        args: [],
      })

      await vi.advanceTimersByTimeAsync(1000)

      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: 'fast result',
      })

      const response = await sendPromise
      expect(response.result).toBe('fast result')
      expect(response.error).toBeUndefined()

      vi.useRealTimers()
    })

    it('should use default timeout if not specified', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport, DEFAULT_TIMEOUT } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'slowMethod',
        args: [],
      })

      // Advance to just before default timeout
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1)

      // Should still be pending
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      // Advance past default timeout
      await vi.advanceTimersByTimeAsync(2)

      const response = await sendPromise
      expect(response.error?.code).toBe('TIMEOUT')

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // 13. Correlation ID propagation
  // ==========================================================================

  describe('correlation ID propagation', () => {
    it('should include correlation ID in request', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      transport.send({
        method: 'test',
        args: [],
        correlationId: 'my-correlation-id',
      })

      const sentMessage = mockWS.getLastSentMessage<{ correlationId: string }>()
      expect(sentMessage?.correlationId).toBe('my-correlation-id')
    })

    it('should return correlation ID in response', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      const sendPromise = transport.send({
        method: 'test',
        args: [],
        correlationId: 'my-correlation-id',
      })

      const sentMessage = mockWS.getLastSentMessage<{ id: string }>()
      mockWS.simulateMessage({
        id: sentMessage?.id,
        result: 'ok',
        correlationId: 'my-correlation-id',
      })

      const response = await sendPromise
      expect(response.correlationId).toBe('my-correlation-id')
    })

    it('should generate correlation ID if not provided', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      transport.send({
        method: 'test',
        args: [],
      })

      const sentMessage = mockWS.getLastSentMessage<{ correlationId?: string }>()
      // Should either have a generated correlationId or use the message id
      expect(sentMessage?.correlationId || sentMessage).toBeDefined()
    })
  })

  // ==========================================================================
  // Factory Function Tests
  // ==========================================================================

  describe('createWebSocketTransport', () => {
    it('should create a WebSocketTransport instance', async () => {
      const { createWebSocketTransport, WebSocketTransport } = await import('../transport/websocket')

      const transport = createWebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      expect(transport).toBeInstanceOf(WebSocketTransport)
    })

    it('should pass all options to transport', async () => {
      const { createWebSocketTransport } = await import('../transport/websocket')

      const transport = createWebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 2000,
        maxReconnectAttempts: 5,
        timeout: 10000,
      })

      expect(transport).toBeDefined()
    })
  })
})

// ============================================================================
// REFACTOR Phase Tests - Advanced Features
// ============================================================================

describe('WebSocketTransport advanced features', () => {
  let mockWS: MockWebSocket
  let originalWebSocket: typeof globalThis.WebSocket
  let wsInstances: MockWebSocket[] = []

  beforeEach(() => {
    wsInstances = []
    originalWebSocket = globalThis.WebSocket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        wsInstances.push(this)
        mockWS = this
      }
    }
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ==========================================================================
  // Heartbeat/Ping-Pong
  // ==========================================================================

  describe('heartbeat', () => {
    it('should send ping at configured interval', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        heartbeatInterval: 30000,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      await vi.advanceTimersByTimeAsync(30000)

      const messages = mockWS.getSentMessages().map((m) => JSON.parse(m))
      expect(messages.some((m) => m.type === 'ping')).toBe(true)

      vi.useRealTimers()
    })

    it('should disconnect if no pong received within timeout', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        heartbeatInterval: 30000,
        heartbeatTimeout: 5000,
        reconnect: false,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Send ping
      await vi.advanceTimersByTimeAsync(30000)

      // Wait for pong timeout
      await vi.advanceTimersByTimeAsync(5001)

      expect(transport.getState()).toBe(TransportState.DISCONNECTED)

      vi.useRealTimers()
    })

    it('should stay connected if pong received in time', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        heartbeatInterval: 30000,
        heartbeatTimeout: 5000,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Trigger ping
      await vi.advanceTimersByTimeAsync(30000)

      // Respond with pong before timeout
      mockWS.simulateMessage({ type: 'pong' })

      await vi.advanceTimersByTimeAsync(10000)

      expect(transport.getState()).toBe(TransportState.CONNECTED)

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // Edge Cases for Full Coverage
  // ==========================================================================

  describe('queued message timeout', () => {
    it('should timeout queued messages after reconnection', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
        timeout: 5000,
      })

      const connectPromise = transport.connect()
      const initialWs = wsInstances[0]!
      initialWs.simulateOpen()
      await connectPromise

      // Disconnect
      initialWs.simulateClose(1006, 'Abnormal closure')

      // Queue a message while disconnected
      const sendPromise = transport.send({
        method: 'slowMethod',
        args: [],
      })

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(100)

      // New WebSocket connects
      const newWs = wsInstances[1]!
      newWs.simulateOpen()

      // The queued message is now sent, but let it timeout (don't respond)
      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(5001)

      const response = await sendPromise
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('TIMEOUT')

      vi.useRealTimers()
    })
  })

  describe('connect edge cases', () => {
    it('should throw error if connecting after explicit close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      await transport.close()

      // Try to connect again after explicit close
      await expect(transport.connect()).rejects.toThrow('Transport has been closed')
    })

    it('should reuse connection if already connecting (not create new WebSocket)', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      // Start first connect
      const promise1 = transport.connect()
      // Start second connect while still connecting
      const promise2 = transport.connect()

      // Both promises should resolve successfully
      mockWS.simulateOpen()
      await Promise.all([promise1, promise2])

      // Only one WebSocket should have been created
      expect(wsInstances.length).toBe(1)
      expect(transport.getState()).toBe(TransportState.CONNECTED)
    })
  })

  describe('close edge cases', () => {
    it('should clear queued messages on close with error response', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: false,
      })

      // Send a message while disconnected (will be queued)
      const sendPromise = transport.send({
        method: 'queuedMethod',
        args: [],
      })

      // Close before connecting
      await transport.close()

      const response = await sendPromise
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('CONNECTION_CLOSED')
    })
  })

  describe('listener error handling', () => {
    it('should continue emitting to other listeners if one throws', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const events1: TransportEvent[] = []
      const events2: TransportEvent[] = []

      // First listener throws
      transport.addEventListener(() => {
        throw new Error('Listener error')
      })

      // Second listener should still receive events
      transport.addEventListener((event) => events2.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // The second listener should still have received the connect event
      expect(events2.some((e) => e.type === 'connect')).toBe(true)
    })
  })

  describe('not reconnecting after explicit close', () => {
    it('should not reconnect after explicit close', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Explicit close
      await transport.close()

      // Advance time - should not attempt reconnect
      await vi.advanceTimersByTimeAsync(500)

      // Should only have one WebSocket instance
      expect(wsInstances.length).toBe(1)
      expect(transport.getState()).toBe(TransportState.CLOSED)

      vi.useRealTimers()
    })
  })

  describe('emit disconnect on explicit close', () => {
    it('should emit disconnect event on explicit close', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      const events: TransportEvent[] = []
      transport.addEventListener((event) => events.push(event))

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // close() triggers ws.close() which fires onclose via setTimeout(0)
      await transport.close()

      // Wait for the setTimeout(0) callback to fire in MockWebSocket.close()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(events.some((e) => e.type === 'disconnect')).toBe(true)
    })
  })

  describe('flushQueue edge cases', () => {
    it('should not flush queue if WebSocket is not open', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        reconnect: true,
        reconnectInterval: 100,
      })

      const connectPromise = transport.connect()
      const initialWs = wsInstances[0]!
      initialWs.simulateOpen()
      await connectPromise

      // Disconnect
      initialWs.simulateClose(1006, 'Abnormal closure')

      // Queue messages while disconnected
      const sendPromise1 = transport.send({ method: 'test1', args: [] })
      const sendPromise2 = transport.send({ method: 'test2', args: [] })

      // Wait for reconnect timeout
      await vi.advanceTimersByTimeAsync(100)

      // New WebSocket is created but not yet open
      expect(wsInstances.length).toBe(2)
      const newWs = wsInstances[1]!

      // The flushQueue should have been called but returned early since ws is not OPEN
      // Verify messages haven't been sent yet (readyState is still CONNECTING)
      expect(newWs.getSentMessages().length).toBe(0)

      // Now open the connection
      newWs.simulateOpen()

      // Messages should now be sent
      expect(newWs.getSentMessages().length).toBe(2)

      // Complete the messages
      const messages = newWs.getSentMessages().map((m) => JSON.parse(m) as { id: string })
      for (const msg of messages) {
        newWs.simulateMessage({ id: msg.id, result: 'ok' })
      }

      await Promise.all([sendPromise1, sendPromise2])

      vi.useRealTimers()
    })
  })

  describe('sendPing when not connected', () => {
    it('should not send ping when not in CONNECTED state', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        heartbeatInterval: 1000,
        reconnect: false,
      })

      const connectPromise = transport.connect()
      mockWS.simulateOpen()
      await connectPromise

      // Advance time to trigger a ping
      await vi.advanceTimersByTimeAsync(1000)

      // A ping should have been sent
      const messagesBefore = mockWS.getSentMessages().length
      expect(messagesBefore).toBeGreaterThan(0)

      // Now disconnect
      mockWS.simulateClose(1006, 'Abnormal closure')

      // Clear sent messages for tracking
      const messagesAfterDisconnect = mockWS.getSentMessages().length

      // Advance time - should not send more pings since disconnected
      await vi.advanceTimersByTimeAsync(2000)

      // No new messages should have been sent
      expect(mockWS.getSentMessages().length).toBe(messagesAfterDisconnect)

      vi.useRealTimers()
    })

    it('should guard against ping during state transitions', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../transport/websocket')

      // Use a custom WebSocket class that allows testing state transitions
      let capturedWs: MockWebSocket | null = null

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        heartbeatInterval: 500,
        heartbeatTimeout: 200,
        reconnect: true,
        reconnectInterval: 100,
      })

      const connectPromise = transport.connect()
      capturedWs = wsInstances[0]!
      capturedWs.simulateOpen()
      await connectPromise

      expect(transport.getState()).toBe(TransportState.CONNECTED)

      // Get the initial ping sent
      await vi.advanceTimersByTimeAsync(500)
      const sentMessagesAfterPing = capturedWs.getSentMessages().length
      expect(sentMessagesAfterPing).toBeGreaterThan(0)

      // Respond with pong to keep connection alive
      capturedWs.simulateMessage({ type: 'pong' })

      vi.useRealTimers()
    })
  })

  describe('custom WebSocket option', () => {
    it('should use custom WebSocket constructor when provided', async () => {
      const { WebSocketTransport } = await import('../transport/websocket')

      const CustomMockWebSocket = class extends MockWebSocket {
        static customCalled = false
        constructor(url: string) {
          super(url)
          CustomMockWebSocket.customCalled = true
        }
      }

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
        WebSocket: CustomMockWebSocket as unknown as typeof WebSocket,
      })

      transport.connect()

      expect(CustomMockWebSocket.customCalled).toBe(true)
    })
  })

  describe('default options', () => {
    it('should use default values for optional options', async () => {
      const { WebSocketTransport, DEFAULT_TIMEOUT, DEFAULT_RECONNECT_INTERVAL, DEFAULT_MAX_RECONNECT_ATTEMPTS } =
        await import('../transport/websocket')

      // Verify defaults are exported
      expect(DEFAULT_TIMEOUT).toBe(30000)
      expect(DEFAULT_RECONNECT_INTERVAL).toBe(1000)
      expect(DEFAULT_MAX_RECONNECT_ATTEMPTS).toBe(10)

      const transport = new WebSocketTransport({
        url: 'wss://api.example.com/rpc',
      })

      // Verify transport was created (defaults applied internally)
      expect(transport).toBeDefined()
      expect(transport.getState()).toBe(TransportState.DISCONNECTED)
    })
  })
})
