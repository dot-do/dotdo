// WebSocket Queue Bounds Tests for rpc.do - TDD for message queue bounds
// Tests the WebSocketTransport queue limit implementation following Red-Green-Refactor methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransportState, type TransportEvent } from '../src/transport/types'

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
// WebSocket Message Queue Bounds Tests
// ============================================================================

describe('WebSocket Message Queue Bounds', () => {
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
  // Queue Size Limits
  // ==========================================================================

  describe('queue size limits', () => {
    it('should reject messages when queue exceeds maxQueueSize', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 3,
        reconnect: false,
      })

      // Don't connect - messages will be queued
      // Start connecting but don't complete it
      transport.connect().catch(() => {
        // Expected - we'll simulate failure later
      })

      // Queue up messages while connecting
      // First 3 messages get queued (won't resolve until connected)
      transport.send({ method: 'a', args: [] })
      transport.send({ method: 'b', args: [] })
      transport.send({ method: 'c', args: [] })

      // 4th message should be rejected immediately with QUEUE_FULL
      const fourthResult = await transport.send({ method: 'd', args: [] })

      expect(fourthResult.error).toBeDefined()
      expect(fourthResult.error?.code).toBe('QUEUE_FULL')

      // Queue should still be at max size
      expect(transport.queueSize).toBe(3)
    })

    it('should use default maxQueueSize of 100', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
      })

      expect(transport.maxQueueSize).toBe(100)
    })

    it('should allow configuring custom maxQueueSize', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 500,
      })

      expect(transport.maxQueueSize).toBe(500)
    })
  })

  // ==========================================================================
  // Queue Overflow Behavior
  // ==========================================================================

  describe('queue overflow behavior', () => {
    it('should return error response when queue full (default)', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 1,
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // First message should be queued
      const first = transport.send({ method: 'a', args: [] })
      // Second message should be rejected immediately
      const second = await transport.send({ method: 'b', args: [] })

      expect(second.error).toBeDefined()
      expect(second.error?.code).toBe('QUEUE_FULL')
      expect(second.error?.message).toContain('queue')
    })

    it('should support drop-oldest strategy', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 2,
        queueOverflowStrategy: 'drop-oldest',
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue 3 messages with size limit 2
      transport.send({ method: 'a', args: [] })
      transport.send({ method: 'b', args: [] })
      transport.send({ method: 'c', args: [] }) // Should drop 'a'

      // Verify queue contains only 2 messages
      expect(transport.queueSize).toBe(2)
    })

    it('should drop oldest message and resolve with error when using drop-oldest', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 1,
        queueOverflowStrategy: 'drop-oldest',
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue first message
      const firstPromise = transport.send({ method: 'first', args: [] })

      // Queue second message - should drop first
      transport.send({ method: 'second', args: [] })

      // First message should be resolved with overflow error
      const firstResult = await firstPromise
      expect(firstResult.error).toBeDefined()
      expect(firstResult.error?.code).toBe('QUEUE_OVERFLOW')
    })
  })

  // ==========================================================================
  // Backpressure Signals
  // ==========================================================================

  describe('backpressure signals', () => {
    it('should emit backpressure event when queue nears limit', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const events: TransportEvent[] = []
      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 10,
        backpressureThreshold: 0.8, // 80%
        reconnect: false,
      })

      transport.addEventListener((event) => {
        events.push(event)
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue 8 messages (80% of 10)
      for (let i = 0; i < 8; i++) {
        transport.send({ method: `m${i}`, args: [] })
      }

      expect(events.some((e) => e.type === 'backpressure')).toBe(true)
    })

    it('should emit resume event when queue drains below threshold', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const events: TransportEvent[] = []
      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 10,
        backpressureThreshold: 0.8, // 80%
        reconnect: false,
      })

      transport.addEventListener((event) => {
        events.push(event)
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue 8 messages (80% of 10) - triggers backpressure
      for (let i = 0; i < 8; i++) {
        transport.send({ method: `m${i}`, args: [] })
      }

      // Now connect - messages will flush
      mockWS.simulateOpen()

      // Wait for flush
      await vi.advanceTimersByTimeAsync(0)

      // Should have emitted backpressure and then resume
      expect(events.some((e) => e.type === 'backpressure')).toBe(true)
      expect(events.some((e) => e.type === 'resume')).toBe(true)

      vi.useRealTimers()
    })

    it('should use default backpressure threshold of 0.8', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 10,
      })

      expect(transport.backpressureThreshold).toBe(0.8)
    })
  })

  // ==========================================================================
  // Queue Metrics
  // ==========================================================================

  describe('queue metrics', () => {
    it('should expose current queue size', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        reconnect: false,
      })

      expect(transport.queueSize).toBe(0)

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      transport.send({ method: 'a', args: [] })
      transport.send({ method: 'b', args: [] })

      expect(transport.queueSize).toBe(2)
    })

    it('should include queue info in getStateInfo()', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 50,
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      transport.send({ method: 'a', args: [] })

      const stateInfo = transport.getStateInfo()
      expect(stateInfo.state).toBe(TransportState.CONNECTING)
      expect(stateInfo.queueSize).toBe(1)
      expect(stateInfo.maxQueueSize).toBe(50)
    })

    it('should decrease queue size after messages are sent', async () => {
      vi.useFakeTimers()
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        reconnect: false,
      })

      // Start connecting
      transport.connect().catch(() => {})

      // Queue messages
      transport.send({ method: 'a', args: [] })
      transport.send({ method: 'b', args: [] })

      expect(transport.queueSize).toBe(2)

      // Connect - messages should flush
      mockWS.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(transport.queueSize).toBe(0)

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // Memory Safety
  // ==========================================================================

  describe('memory safety', () => {
    it('should not allow queue to grow beyond maxQueueSize with default strategy', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 5,
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue first 5 messages (they will be pending, not awaited)
      for (let i = 0; i < 5; i++) {
        transport.send({ method: `m${i}`, args: [] })
      }

      // Queue should be exactly at maxQueueSize
      expect(transport.queueSize).toBe(5)

      // Next 5 messages should be immediately rejected with QUEUE_FULL
      for (let i = 5; i < 10; i++) {
        const result = await transport.send({ method: `m${i}`, args: [] })
        expect(result.error?.code).toBe('QUEUE_FULL')
      }

      // Queue should still be at maxQueueSize (rejected messages don't get queued)
      expect(transport.queueSize).toBe(5)
    })

    it('should not allow queue to grow beyond maxQueueSize with drop-oldest strategy', async () => {
      const { WebSocketTransport } = await import('../src/transport/websocket')

      const transport = new WebSocketTransport({
        url: 'wss://api.test.com',
        maxQueueSize: 5,
        queueOverflowStrategy: 'drop-oldest',
        reconnect: false,
      })

      // Start connecting but don't complete
      transport.connect().catch(() => {})

      // Queue 10 messages
      for (let i = 0; i < 10; i++) {
        transport.send({ method: `m${i}`, args: [] })
      }

      // Queue should be exactly maxQueueSize
      expect(transport.queueSize).toBe(5)
    })
  })
})
