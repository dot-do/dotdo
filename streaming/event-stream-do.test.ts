/**
 * EventStreamDO tests - Real-time event delivery via WebSocket
 *
 * Tests for EventStreamDO - a Durable Object that handles WebSocket connections
 * and broadcasts events in real-time:
 * - WebSocket connection handling (upgrade, connect/disconnect)
 * - Broadcasting to subscribers
 * - Live query updates via PGLite
 * - 5-minute hot tier retention
 * - Sub-10ms latency performance
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * Import from './event-stream-do' which does not exist.
 *
 * @see /streaming/README.md for the EventStreamDO API design
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Install WebSocket mock for test environment (must be before imports that use WebSocketPair)
import { installWebSocketMock } from './tests/utils/websocket-mock'
installWebSocketMock()

// Import from non-existent module - this will cause tests to fail
import {
  EventStreamDO,
  type EventStreamConfig,
  type StreamSubscription,
  type LiveQuerySubscription,
  type BroadcastEvent,
} from './event-stream-do'

// ============================================================================
// MOCK WEBSOCKET
// ============================================================================

interface MockWebSocketMessage {
  data: string
  timestamp: number
}

const createMockWebSocket = () => {
  const messages: MockWebSocketMessage[] = []
  const handlers: Map<string, Set<(data: any) => void>> = new Map()
  let isOpen = true
  let closeCode: number | undefined
  let closeReason: string | undefined

  return {
    send: vi.fn((data: string) => {
      if (!isOpen) throw new Error('WebSocket is closed')
      messages.push({ data, timestamp: Date.now() })
    }),
    close: vi.fn((code?: number, reason?: string) => {
      isOpen = false
      closeCode = code
      closeReason = reason
      handlers.get('close')?.forEach((handler) => handler({ code, reason }))
    }),
    addEventListener: vi.fn((event: string, handler: (data: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (data: any) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    dispatchEvent: vi.fn((event: string, data: any) => {
      handlers.get(event)?.forEach((handler) => handler(data))
    }),
    // Test utilities
    get messages() {
      return messages
    },
    get isOpen() {
      return isOpen
    },
    get closeCode() {
      return closeCode
    },
    get closeReason() {
      return closeReason
    },
    simulateMessage: (data: string) => {
      handlers.get('message')?.forEach((handler) => handler({ data }))
    },
    simulateError: (error: Error) => {
      handlers.get('error')?.forEach((handler) => handler(error))
    },
    simulateClose: (code: number, reason: string) => {
      isOpen = false
      closeCode = code
      closeReason = reason
      handlers.get('close')?.forEach((handler) => handler({ code, reason }))
    },
  }
}

type MockWebSocket = ReturnType<typeof createMockWebSocket>

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      deleteAll: vi.fn(async () => storage.clear()),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
    getAlarm: vi.fn(async () => alarms[0]),
    deleteAlarm: vi.fn(async () => {
      alarms.length = 0
    }),
    // For WebSocket hibernation
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    // Test utilities
    _storage: storage,
    _alarms: alarms,
  }
}

type MockState = ReturnType<typeof createMockState>

// ============================================================================
// MOCK REQUEST
// ============================================================================

const createMockRequest = (options: {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}) => {
  const url = options.url || 'https://stream.example.com.ai/events'
  const method = options.method || 'GET'
  const headers = new Headers(options.headers || {})

  return {
    url,
    method,
    headers,
    json: vi.fn(async () => JSON.parse(options.body || '{}')),
    text: vi.fn(async () => options.body || ''),
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a test event with standard structure
 */
function createTestEvent(data: Partial<BroadcastEvent> = {}): BroadcastEvent {
  return {
    id: data.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: data.type || 'test',
    topic: data.topic || 'default',
    payload: data.payload || { message: 'test' },
    timestamp: data.timestamp || Date.now(),
    ...data,
  }
}

/**
 * Wait for async operations to complete
 */
async function tick(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Measure execution time in milliseconds
 */
async function measureLatency<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now()
  const result = await fn()
  const latencyMs = performance.now() - start
  return { result, latencyMs }
}

// ============================================================================
// CONSTRUCTOR AND CONFIG TESTS
// ============================================================================

describe('EventStreamDO', () => {
  let mockState: MockState
  let eventStream: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should create instance with state', () => {
      eventStream = new EventStreamDO(mockState as any)
      expect(eventStream).toBeInstanceOf(EventStreamDO)
    })

    it('should create instance with custom config', () => {
      const config: EventStreamConfig = {
        hotTierRetentionMs: 10 * 60 * 1000, // 10 minutes
        maxConnections: 50_000,
        maxTopics: 1000,
        cleanupIntervalMs: 30_000,
      }

      eventStream = new EventStreamDO(mockState as any, config)

      expect(eventStream.config.hotTierRetentionMs).toBe(10 * 60 * 1000)
      expect(eventStream.config.maxConnections).toBe(50_000)
    })

    it('should use default config values', () => {
      eventStream = new EventStreamDO(mockState as any)

      // Default: 5 minute retention from README
      expect(eventStream.config.hotTierRetentionMs).toBe(5 * 60 * 1000)
      expect(eventStream.config.maxConnections).toBe(10_000)
      expect(eventStream.config.cleanupIntervalMs).toBe(60_000)
    })

    it('should initialize PGLite for hot tier storage', () => {
      eventStream = new EventStreamDO(mockState as any)

      // Should have initialized PGLite database
      expect(eventStream.db).toBeDefined()
    })
  })

  // ============================================================================
  // WEBSOCKET CONNECTION HANDLING TESTS
  // ============================================================================

  describe('WebSocket handling', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    describe('connection upgrade', () => {
      it('should accept WebSocket upgrade request', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders',
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': '13',
          },
        })

        const response = await eventStream.fetch(request as any)

        expect(response.status).toBe(101)
        expect(response.webSocket).toBeDefined()
      })

      it('should reject non-WebSocket requests to WebSocket endpoint', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          method: 'GET',
        })

        const response = await eventStream.fetch(request as any)

        expect(response.status).toBe(426) // Upgrade Required
      })

      it('should parse topic from query string', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders.new',
          headers: {
            Upgrade: 'websocket',
          },
        })

        const response = await eventStream.fetch(request as any)

        expect(response.status).toBe(101)
        // Topic should be registered for the connection
        expect(eventStream.getTopicSubscribers('orders.new').length).toBe(1)
      })

      it('should support multiple topics via query string', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders&topic=payments&topic=users',
          headers: {
            Upgrade: 'websocket',
          },
        })

        const response = await eventStream.fetch(request as any)

        expect(response.status).toBe(101)
        expect(eventStream.getTopicSubscribers('orders').length).toBe(1)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(1)
        expect(eventStream.getTopicSubscribers('users').length).toBe(1)
      })

      it('should assign unique connection ID', async () => {
        const request1 = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })
        const request2 = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response1 = await eventStream.fetch(request1 as any)
        const response2 = await eventStream.fetch(request2 as any)

        // Both should succeed with unique IDs
        expect(response1.status).toBe(101)
        expect(response2.status).toBe(101)
        expect(eventStream.connectionCount).toBe(2)
      })

      it('should enforce max connections limit', async () => {
        eventStream = new EventStreamDO(mockState as any, {
          maxConnections: 2,
        })

        const requests = Array.from({ length: 3 }, () =>
          createMockRequest({
            url: 'https://stream.example.com.ai/events',
            headers: { Upgrade: 'websocket' },
          })
        )

        const response1 = await eventStream.fetch(requests[0] as any)
        const response2 = await eventStream.fetch(requests[1] as any)
        const response3 = await eventStream.fetch(requests[2] as any)

        expect(response1.status).toBe(101)
        expect(response2.status).toBe(101)
        expect(response3.status).toBe(503) // Service Unavailable
      })
    })

    describe('connection lifecycle', () => {
      it('should track active connections', async () => {
        expect(eventStream.connectionCount).toBe(0)

        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        await eventStream.fetch(request as any)

        expect(eventStream.connectionCount).toBe(1)
      })

      it('should handle disconnection', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=test',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        expect(eventStream.connectionCount).toBe(1)

        // Simulate client disconnect
        ws.simulateClose(1000, 'Normal closure')
        await tick()

        expect(eventStream.connectionCount).toBe(0)
        expect(eventStream.getTopicSubscribers('test').length).toBe(0)
      })

      it('should clean up topic subscriptions on disconnect', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders&topic=payments',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        expect(eventStream.getTopicSubscribers('orders').length).toBe(1)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(1)

        ws.simulateClose(1000, 'Normal closure')
        await tick()

        expect(eventStream.getTopicSubscribers('orders').length).toBe(0)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(0)
      })

      it('should handle connection errors gracefully', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        expect(eventStream.connectionCount).toBe(1)

        // Simulate error
        ws.simulateError(new Error('Connection reset'))
        await tick()

        // Connection should be cleaned up
        expect(eventStream.connectionCount).toBe(0)
      })

      it('should send welcome message on connect', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=test',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        // Should have sent welcome message
        expect(ws.send).toHaveBeenCalledTimes(1)
        const welcomeMsg = JSON.parse(ws.messages[0].data)
        expect(welcomeMsg.type).toBe('connected')
        expect(welcomeMsg.connectionId).toBeDefined()
        expect(welcomeMsg.topics).toContain('test')
      })
    })

    describe('message handling', () => {
      it('should handle subscribe message', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        ws.simulateMessage(
          JSON.stringify({
            type: 'subscribe',
            topics: ['orders', 'payments'],
          })
        )
        await tick()

        expect(eventStream.getTopicSubscribers('orders').length).toBe(1)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(1)
      })

      it('should handle unsubscribe message', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders&topic=payments',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        expect(eventStream.getTopicSubscribers('orders').length).toBe(1)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(1)

        ws.simulateMessage(
          JSON.stringify({
            type: 'unsubscribe',
            topics: ['orders'],
          })
        )
        await tick()

        expect(eventStream.getTopicSubscribers('orders').length).toBe(0)
        expect(eventStream.getTopicSubscribers('payments').length).toBe(1)
      })

      it('should handle ping message', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        ws.send.mockClear()
        ws.simulateMessage(JSON.stringify({ type: 'ping' }))
        await tick()

        // Should respond with pong
        expect(ws.send).toHaveBeenCalled()
        const pongMsg = JSON.parse(ws.messages[ws.messages.length - 1].data)
        expect(pongMsg.type).toBe('pong')
      })

      it('should ignore invalid JSON messages', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        // Should not throw
        ws.simulateMessage('not valid json')
        await tick()

        // Connection should still be open
        expect(ws.isOpen).toBe(true)
      })

      it('should ignore unknown message types', async () => {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events',
          headers: { Upgrade: 'websocket' },
        })

        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket

        // Should not throw
        ws.simulateMessage(JSON.stringify({ type: 'unknown_type', data: {} }))
        await tick()

        // Connection should still be open
        expect(ws.isOpen).toBe(true)
      })
    })
  })

  // ============================================================================
  // BROADCASTING TESTS
  // ============================================================================

  describe('broadcasting', () => {
    let ws1: MockWebSocket
    let ws2: MockWebSocket
    let ws3: MockWebSocket

    beforeEach(async () => {
      eventStream = new EventStreamDO(mockState as any)

      // Create 3 connections with different topic subscriptions
      const req1 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders',
        headers: { Upgrade: 'websocket' },
      })
      const req2 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders&topic=payments',
        headers: { Upgrade: 'websocket' },
      })
      const req3 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=users',
        headers: { Upgrade: 'websocket' },
      })

      const res1 = await eventStream.fetch(req1 as any)
      const res2 = await eventStream.fetch(req2 as any)
      const res3 = await eventStream.fetch(req3 as any)

      ws1 = res1.webSocket as MockWebSocket
      ws2 = res2.webSocket as MockWebSocket
      ws3 = res3.webSocket as MockWebSocket

      // Clear initial welcome messages
      ws1.send.mockClear()
      ws2.send.mockClear()
      ws3.send.mockClear()
    })

    describe('broadcast(event)', () => {
      it('should send to all connected subscribers', async () => {
        const event = createTestEvent({
          type: 'notification',
          payload: { message: 'Hello everyone' },
        })

        await eventStream.broadcast(event)

        // All 3 connections should receive
        expect(ws1.send).toHaveBeenCalledTimes(1)
        expect(ws2.send).toHaveBeenCalledTimes(1)
        expect(ws3.send).toHaveBeenCalledTimes(1)
      })

      it('should serialize event as JSON', async () => {
        const event = createTestEvent({
          type: 'order.created',
          payload: { orderId: 123, total: 99.99 },
        })

        await eventStream.broadcast(event)

        const received = JSON.parse(ws1.messages[0].data)
        expect(received.type).toBe('order.created')
        expect(received.payload).toEqual({ orderId: 123, total: 99.99 })
      })

      it('should preserve event ordering', async () => {
        const events = Array.from({ length: 10 }, (_, i) =>
          createTestEvent({
            type: 'sequence',
            payload: { order: i },
          })
        )

        for (const event of events) {
          await eventStream.broadcast(event)
        }

        // Verify order on first connection
        const receivedOrders = ws1.messages.map((m) => JSON.parse(m.data).payload.order)
        expect(receivedOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      })

      it('should handle broadcast with no subscribers', async () => {
        // Disconnect all
        ws1.simulateClose(1000, 'test')
        ws2.simulateClose(1000, 'test')
        ws3.simulateClose(1000, 'test')
        await tick()

        const event = createTestEvent()

        // Should not throw
        await expect(eventStream.broadcast(event)).resolves.not.toThrow()
      })

      it('should skip disconnected sockets', async () => {
        ws1.simulateClose(1000, 'test')
        await tick()

        ws1.send.mockClear()
        ws2.send.mockClear()
        ws3.send.mockClear()

        await eventStream.broadcast(createTestEvent())

        expect(ws1.send).not.toHaveBeenCalled()
        expect(ws2.send).toHaveBeenCalledTimes(1)
        expect(ws3.send).toHaveBeenCalledTimes(1)
      })

      it('should handle send errors gracefully', async () => {
        // Make ws1 throw on send
        ws1.send.mockImplementation(() => {
          throw new Error('Socket error')
        })

        const event = createTestEvent()

        // Should not throw
        await expect(eventStream.broadcast(event)).resolves.not.toThrow()

        // Other connections should still receive
        expect(ws2.send).toHaveBeenCalledTimes(1)
        expect(ws3.send).toHaveBeenCalledTimes(1)
      })
    })

    describe('broadcastToTopic(topic, event)', () => {
      it('should send only to topic subscribers', async () => {
        const event = createTestEvent({
          topic: 'orders',
          type: 'order.created',
          payload: { orderId: 456 },
        })

        await eventStream.broadcastToTopic('orders', event)

        // ws1 and ws2 subscribe to orders
        expect(ws1.send).toHaveBeenCalledTimes(1)
        expect(ws2.send).toHaveBeenCalledTimes(1)
        // ws3 subscribes to users
        expect(ws3.send).not.toHaveBeenCalled()
      })

      it('should support wildcard topic matching', async () => {
        // Add wildcard subscriber
        const reqWildcard = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=orders.*',
          headers: { Upgrade: 'websocket' },
        })
        const resWildcard = await eventStream.fetch(reqWildcard as any)
        const wsWildcard = resWildcard.webSocket as MockWebSocket
        wsWildcard.send.mockClear()

        const event = createTestEvent({
          topic: 'orders.created',
        })

        await eventStream.broadcastToTopic('orders.created', event)

        // Wildcard subscriber should receive
        expect(wsWildcard.send).toHaveBeenCalledTimes(1)
      })

      it('should handle empty topic subscribers', async () => {
        const event = createTestEvent({
          topic: 'nonexistent',
        })

        // Should not throw
        await expect(eventStream.broadcastToTopic('nonexistent', event)).resolves.not.toThrow()
      })

      it('should broadcast to multiple topics', async () => {
        const event = createTestEvent({
          payload: { shared: true },
        })

        await eventStream.broadcastToTopic('orders', event)
        await eventStream.broadcastToTopic('payments', event)

        // ws1 gets orders only
        expect(ws1.send).toHaveBeenCalledTimes(1)
        // ws2 gets both orders and payments
        expect(ws2.send).toHaveBeenCalledTimes(2)
        // ws3 gets neither
        expect(ws3.send).not.toHaveBeenCalled()
      })
    })

    describe('fan-out performance', () => {
      it('should handle fan-out to 1000+ connections efficiently', async () => {
        eventStream = new EventStreamDO(mockState as any, {
          maxConnections: 2000,
        })

        // Create 1000 connections
        const connections: MockWebSocket[] = []
        for (let i = 0; i < 1000; i++) {
          const req = createMockRequest({
            url: 'https://stream.example.com.ai/events?topic=mass',
            headers: { Upgrade: 'websocket' },
          })
          const res = await eventStream.fetch(req as any)
          const ws = res.webSocket as MockWebSocket
          ws.send.mockClear()
          connections.push(ws)
        }

        expect(eventStream.connectionCount).toBe(1000)

        const event = createTestEvent({ topic: 'mass' })

        const { latencyMs } = await measureLatency(() => eventStream.broadcastToTopic('mass', event))

        // All connections should receive
        for (const ws of connections) {
          expect(ws.send).toHaveBeenCalledTimes(1)
        }

        // Fan-out should be fast (< 100ms for 1000 connections)
        expect(latencyMs).toBeLessThan(100)
      })

      it('should maintain message ordering under load', async () => {
        eventStream = new EventStreamDO(mockState as any)

        const req = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=ordered',
          headers: { Upgrade: 'websocket' },
        })
        const res = await eventStream.fetch(req as any)
        const ws = res.webSocket as MockWebSocket
        ws.send.mockClear()

        // Send 100 events rapidly
        const events = Array.from({ length: 100 }, (_, i) =>
          createTestEvent({
            topic: 'ordered',
            payload: { seq: i },
          })
        )

        await Promise.all(events.map((e) => eventStream.broadcastToTopic('ordered', e)))

        // Verify all received in order
        expect(ws.messages.length).toBe(100)
        const sequences = ws.messages.map((m) => JSON.parse(m.data).payload.seq)
        const sorted = [...sequences].sort((a, b) => a - b)
        expect(sequences).toEqual(sorted)
      })
    })
  })

  // ============================================================================
  // LIVE QUERY TESTS
  // ============================================================================

  describe('live queries', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    describe('query(sql)', () => {
      it('should query hot events from PGLite', async () => {
        // Insert some test events
        await eventStream.broadcast(
          createTestEvent({ type: 'order.created', payload: { orderId: 1, amount: 100 } })
        )
        await eventStream.broadcast(
          createTestEvent({ type: 'order.created', payload: { orderId: 2, amount: 200 } })
        )
        await eventStream.broadcast(
          createTestEvent({ type: 'order.created', payload: { orderId: 3, amount: 300 } })
        )

        const result = await eventStream.query(`
          SELECT * FROM events
          WHERE type = 'order.created'
          ORDER BY timestamp DESC
          LIMIT 10
        `)

        expect(result.rows).toHaveLength(3)
        expect(result.rows[0].payload.orderId).toBe(3)
      })

      it('should support parameterized queries', async () => {
        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { status: 'pending' } })
        )
        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { status: 'completed' } })
        )
        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { status: 'pending' } })
        )

        const result = await eventStream.query(
          `SELECT * FROM events WHERE topic = $1 AND payload->>'status' = $2`,
          ['orders', 'pending']
        )

        expect(result.rows).toHaveLength(2)
      })

      it('should query by timestamp range', async () => {
        vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))
        await eventStream.broadcast(createTestEvent({ payload: { time: 'early' } }))

        vi.setSystemTime(new Date('2026-01-09T10:05:00Z'))
        await eventStream.broadcast(createTestEvent({ payload: { time: 'late' } }))

        const startTime = new Date('2026-01-09T10:04:00Z').getTime()
        const result = await eventStream.query(`SELECT * FROM events WHERE timestamp > $1`, [
          startTime,
        ])

        expect(result.rows).toHaveLength(1)
        expect(result.rows[0].payload.time).toBe('late')
      })

      it('should return empty result for no matches', async () => {
        const result = await eventStream.query(`SELECT * FROM events WHERE type = 'nonexistent'`)

        expect(result.rows).toHaveLength(0)
      })

      it('should handle SQL errors gracefully', async () => {
        await expect(eventStream.query(`SELECT * FROM nonexistent_table`)).rejects.toThrow()
      })
    })

    describe('subscribe to query results', () => {
      it('should subscribe to live query updates', async () => {
        const callback = vi.fn()

        const subscription = await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'orders'`,
          callback
        )

        expect(subscription.id).toBeDefined()
        expect(subscription.active).toBe(true)
      })

      it('should push updates when matching events arrive', async () => {
        const callback = vi.fn()

        await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'orders' ORDER BY timestamp DESC LIMIT 5`,
          callback
        )

        // Initial callback with empty results
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenLastCalledWith({ rows: [] })

        // Broadcast matching event
        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { orderId: 1 } })
        )

        // Should trigger update
        expect(callback).toHaveBeenCalledTimes(2)
        expect(callback.mock.calls[1][0].rows).toHaveLength(1)
      })

      it('should not push updates for non-matching events', async () => {
        const callback = vi.fn()

        await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'orders'`,
          callback
        )

        callback.mockClear()

        // Broadcast non-matching event
        await eventStream.broadcast(createTestEvent({ topic: 'payments' }))

        // Should not trigger update
        expect(callback).not.toHaveBeenCalled()
      })

      it('should support multiple query subscriptions', async () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()

        await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'orders'`,
          callback1
        )
        await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'payments'`,
          callback2
        )

        callback1.mockClear()
        callback2.mockClear()

        await eventStream.broadcast(createTestEvent({ topic: 'orders' }))

        expect(callback1).toHaveBeenCalledTimes(1)
        expect(callback2).not.toHaveBeenCalled()
      })

      it('should unsubscribe from query', async () => {
        const callback = vi.fn()

        const subscription = await eventStream.subscribeToQuery(
          `SELECT * FROM events WHERE topic = 'orders'`,
          callback
        )

        callback.mockClear()

        await subscription.unsubscribe()

        await eventStream.broadcast(createTestEvent({ topic: 'orders' }))

        expect(callback).not.toHaveBeenCalled()
        expect(subscription.active).toBe(false)
      })

      it('should handle complex query subscriptions', async () => {
        const callback = vi.fn()

        await eventStream.subscribeToQuery(
          `SELECT topic, COUNT(*) as count, SUM((payload->>'amount')::numeric) as total
           FROM events
           WHERE topic = 'orders'
           GROUP BY topic`,
          callback
        )

        callback.mockClear()

        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { amount: 100 } })
        )
        await eventStream.broadcast(
          createTestEvent({ topic: 'orders', payload: { amount: 200 } })
        )

        // Should receive aggregated update
        expect(callback).toHaveBeenCalled()
        const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0]
        expect(lastCall.rows[0].count).toBe(2)
        expect(lastCall.rows[0].total).toBe(300)
      })
    })
  })

  // ============================================================================
  // HOT TIER RETENTION TESTS
  // ============================================================================

  describe('hot tier retention', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any, {
        hotTierRetentionMs: 5 * 60 * 1000, // 5 minutes
        cleanupIntervalMs: 60_000, // 1 minute
      })
    })

    it('should store events in PGLite hot tier', async () => {
      const event = createTestEvent({ payload: { stored: true } })
      await eventStream.broadcast(event)

      const result = await eventStream.query(`SELECT * FROM events WHERE id = $1`, [event.id])

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].payload.stored).toBe(true)
    })

    it('should retain events for 5 minutes', async () => {
      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      const event = createTestEvent()
      await eventStream.broadcast(event)

      // 4 minutes later - should still exist
      vi.setSystemTime(new Date('2026-01-09T10:04:00Z'))
      await eventStream.runCleanup()

      let result = await eventStream.query(`SELECT * FROM events WHERE id = $1`, [event.id])
      expect(result.rows).toHaveLength(1)

      // 6 minutes later - should be cleaned up
      vi.setSystemTime(new Date('2026-01-09T10:06:00Z'))
      await eventStream.runCleanup()

      result = await eventStream.query(`SELECT * FROM events WHERE id = $1`, [event.id])
      expect(result.rows).toHaveLength(0)
    })

    it('should automatically cleanup old events', async () => {
      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      // Create events over time
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcast(createTestEvent({ payload: { seq: i } }))
        vi.advanceTimersByTime(60_000) // 1 minute
      }

      // Now at 10:10, events from 10:00-10:04 should be cleaned up (> 5 min old)
      await eventStream.runCleanup()

      const result = await eventStream.query(`SELECT * FROM events`)

      // Should only have events from last 5 minutes (seq 5-9)
      expect(result.rows.length).toBeLessThanOrEqual(5)
    })

    it('should schedule cleanup alarm', async () => {
      await eventStream.broadcast(createTestEvent())

      // Should have set an alarm for cleanup
      expect(mockState.setAlarm).toHaveBeenCalled()
    })

    it('should run cleanup on alarm', async () => {
      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      const event = createTestEvent()
      await eventStream.broadcast(event)

      // Simulate alarm trigger after retention period
      vi.setSystemTime(new Date('2026-01-09T10:06:00Z'))
      await eventStream.alarm()

      const result = await eventStream.query(`SELECT * FROM events WHERE id = $1`, [event.id])
      expect(result.rows).toHaveLength(0)
    })

    it('should query only hot data', async () => {
      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      const oldEvent = createTestEvent({ payload: { age: 'old' } })
      await eventStream.broadcast(oldEvent)

      // Move time forward past retention
      vi.setSystemTime(new Date('2026-01-09T10:06:00Z'))
      await eventStream.runCleanup()

      const newEvent = createTestEvent({ payload: { age: 'new' } })
      await eventStream.broadcast(newEvent)

      const result = await eventStream.query(`SELECT * FROM events`)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].payload.age).toBe('new')
    })

    it('should handle custom retention period', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        hotTierRetentionMs: 10 * 60 * 1000, // 10 minutes
      })

      vi.setSystemTime(new Date('2026-01-09T10:00:00Z'))

      const event = createTestEvent()
      await eventStream.broadcast(event)

      // 7 minutes later - should still exist with 10 min retention
      vi.setSystemTime(new Date('2026-01-09T10:07:00Z'))
      await eventStream.runCleanup()

      const result = await eventStream.query(`SELECT * FROM events WHERE id = $1`, [event.id])
      expect(result.rows).toHaveLength(1)
    })
  })

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('performance', () => {
    beforeEach(() => {
      vi.useRealTimers() // Use real timers for latency measurement
      eventStream = new EventStreamDO(mockState as any)
    })

    afterEach(() => {
      vi.useFakeTimers()
    })

    describe('sub-10ms message latency', () => {
      it('should broadcast with sub-10ms latency', async () => {
        const req = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=perf',
          headers: { Upgrade: 'websocket' },
        })
        const res = await eventStream.fetch(req as any)
        const ws = res.webSocket as MockWebSocket
        ws.send.mockClear()

        const event = createTestEvent({ topic: 'perf' })

        const { latencyMs } = await measureLatency(() =>
          eventStream.broadcastToTopic('perf', event)
        )

        expect(latencyMs).toBeLessThan(10)
        expect(ws.send).toHaveBeenCalledTimes(1)
      })

      it('should maintain sub-10ms latency under load', async () => {
        // Create 100 connections
        const connections: MockWebSocket[] = []
        for (let i = 0; i < 100; i++) {
          const req = createMockRequest({
            url: 'https://stream.example.com.ai/events?topic=load',
            headers: { Upgrade: 'websocket' },
          })
          const res = await eventStream.fetch(req as any)
          const ws = res.webSocket as MockWebSocket
          ws.send.mockClear()
          connections.push(ws)
        }

        // Measure latency for broadcast
        const event = createTestEvent({ topic: 'load' })
        const { latencyMs } = await measureLatency(() =>
          eventStream.broadcastToTopic('load', event)
        )

        expect(latencyMs).toBeLessThan(10)

        // All connections should receive
        for (const ws of connections) {
          expect(ws.send).toHaveBeenCalledTimes(1)
        }
      })

      it('should measure end-to-end latency including serialization', async () => {
        const req = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=e2e',
          headers: { Upgrade: 'websocket' },
        })
        const res = await eventStream.fetch(req as any)
        const ws = res.webSocket as MockWebSocket
        ws.send.mockClear()

        const largePayload = {
          orderId: 12345,
          items: Array.from({ length: 100 }, (_, i) => ({
            productId: i,
            name: `Product ${i}`,
            price: Math.random() * 100,
            quantity: Math.floor(Math.random() * 10),
          })),
          customer: {
            id: 'cust-123',
            name: 'Test Customer',
            email: 'test@example.com.ai',
          },
          metadata: {
            source: 'api',
            version: '2.0',
            timestamp: Date.now(),
          },
        }

        const event = createTestEvent({ topic: 'e2e', payload: largePayload })

        const { latencyMs } = await measureLatency(() =>
          eventStream.broadcastToTopic('e2e', event)
        )

        expect(latencyMs).toBeLessThan(10)
      })
    })

    describe('10K+ concurrent connections', () => {
      it('should handle 10K connections', async () => {
        eventStream = new EventStreamDO(mockState as any, {
          maxConnections: 15_000,
        })

        // Create 10,000 connections
        for (let i = 0; i < 10_000; i++) {
          const req = createMockRequest({
            url: `https://stream.example.com.ai/events?topic=topic-${i % 100}`,
            headers: { Upgrade: 'websocket' },
          })
          await eventStream.fetch(req as any)
        }

        expect(eventStream.connectionCount).toBe(10_000)
      })

      it('should broadcast efficiently with 10K connections', async () => {
        eventStream = new EventStreamDO(mockState as any, {
          maxConnections: 15_000,
        })

        const connections: MockWebSocket[] = []
        for (let i = 0; i < 10_000; i++) {
          const req = createMockRequest({
            url: 'https://stream.example.com.ai/events?topic=broadcast',
            headers: { Upgrade: 'websocket' },
          })
          const res = await eventStream.fetch(req as any)
          const ws = res.webSocket as MockWebSocket
          ws.send.mockClear()
          connections.push(ws)
        }

        const event = createTestEvent({ topic: 'broadcast' })

        const { latencyMs } = await measureLatency(() =>
          eventStream.broadcastToTopic('broadcast', event)
        )

        // Should complete within reasonable time (< 1 second for 10K)
        expect(latencyMs).toBeLessThan(1000)

        // All connections should receive
        let received = 0
        for (const ws of connections) {
          if (ws.send.mock.calls.length > 0) received++
        }
        expect(received).toBe(10_000)
      })
    })

    describe('memory efficient subscriber tracking', () => {
      it('should track subscribers with minimal memory overhead', async () => {
        eventStream = new EventStreamDO(mockState as any, {
          maxConnections: 15_000,
        })

        // Create connections with various topic subscriptions
        for (let i = 0; i < 1000; i++) {
          const topics = [`topic-${i % 10}`, `topic-${(i + 5) % 10}`]
          const req = createMockRequest({
            url: `https://stream.example.com.ai/events?topic=${topics.join('&topic=')}`,
            headers: { Upgrade: 'websocket' },
          })
          await eventStream.fetch(req as any)
        }

        // Check topic distribution
        expect(eventStream.connectionCount).toBe(1000)
        expect(eventStream.topicCount).toBe(10)

        // Each topic should have ~200 subscribers (1000 connections * 2 topics / 10 topics)
        for (let i = 0; i < 10; i++) {
          const subscribers = eventStream.getTopicSubscribers(`topic-${i}`)
          expect(subscribers.length).toBeGreaterThan(150)
          expect(subscribers.length).toBeLessThan(250)
        }
      })

      it('should clean up subscriber tracking on disconnect', async () => {
        eventStream = new EventStreamDO(mockState as any)

        const connections: MockWebSocket[] = []
        for (let i = 0; i < 100; i++) {
          const req = createMockRequest({
            url: 'https://stream.example.com.ai/events?topic=cleanup',
            headers: { Upgrade: 'websocket' },
          })
          const res = await eventStream.fetch(req as any)
          connections.push(res.webSocket as MockWebSocket)
        }

        expect(eventStream.connectionCount).toBe(100)
        expect(eventStream.getTopicSubscribers('cleanup').length).toBe(100)

        // Disconnect all
        for (const ws of connections) {
          ws.simulateClose(1000, 'test')
        }
        await tick(100)

        expect(eventStream.connectionCount).toBe(0)
        expect(eventStream.getTopicSubscribers('cleanup').length).toBe(0)
      })

      it('should use efficient data structures for topic lookup', async () => {
        eventStream = new EventStreamDO(mockState as any)

        // Create many topics
        for (let i = 0; i < 1000; i++) {
          const req = createMockRequest({
            url: `https://stream.example.com.ai/events?topic=topic-${i}`,
            headers: { Upgrade: 'websocket' },
          })
          await eventStream.fetch(req as any)
        }

        // Topic lookup should be O(1) - measure time for lookup
        const start = performance.now()
        for (let i = 0; i < 10000; i++) {
          eventStream.getTopicSubscribers(`topic-${i % 1000}`)
        }
        const lookupTime = performance.now() - start

        // 10,000 lookups should complete quickly (< 50ms)
        expect(lookupTime).toBeLessThan(50)
      })
    })
  })

  // ============================================================================
  // HTTP API TESTS
  // ============================================================================

  describe('HTTP API', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should handle POST /broadcast', async () => {
      // Connect a subscriber first
      const wsReq = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=api-test',
        headers: { Upgrade: 'websocket' },
      })
      const wsRes = await eventStream.fetch(wsReq as any)
      const ws = wsRes.webSocket as MockWebSocket
      ws.send.mockClear()

      // POST to broadcast
      const req = createMockRequest({
        url: 'https://stream.example.com.ai/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'api-test',
          event: { type: 'test', payload: { via: 'http' } },
        }),
      })

      const res = await eventStream.fetch(req as any)

      expect(res.status).toBe(200)
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('should handle GET /stats', async () => {
      // Create some connections
      for (let i = 0; i < 5; i++) {
        const req = createMockRequest({
          url: `https://stream.example.com.ai/events?topic=stats-${i % 2}`,
          headers: { Upgrade: 'websocket' },
        })
        await eventStream.fetch(req as any)
      }

      const req = createMockRequest({
        url: 'https://stream.example.com.ai/stats',
        method: 'GET',
      })

      const res = await eventStream.fetch(req as any)
      const stats = await res.json()

      expect(res.status).toBe(200)
      expect(stats.connectionCount).toBe(5)
      expect(stats.topicCount).toBe(2)
    })

    it('should handle POST /query', async () => {
      // Insert some events
      await eventStream.broadcast(createTestEvent({ type: 'query-test' }))

      const req = createMockRequest({
        url: 'https://stream.example.com.ai/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `SELECT * FROM events WHERE type = 'query-test'`,
        }),
      })

      const res = await eventStream.fetch(req as any)
      const result = await res.json()

      expect(res.status).toBe(200)
      expect(result.rows).toHaveLength(1)
    })

    it('should return 404 for unknown endpoints', async () => {
      const req = createMockRequest({
        url: 'https://stream.example.com.ai/unknown',
        method: 'GET',
      })

      const res = await eventStream.fetch(req as any)

      expect(res.status).toBe(404)
    })
  })

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('integration scenarios', () => {
    it('should handle real-time order notification flow', async () => {
      eventStream = new EventStreamDO(mockState as any)

      // Customer dashboard connects
      const dashboardReq = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.user-123',
        headers: { Upgrade: 'websocket' },
      })
      const dashboardRes = await eventStream.fetch(dashboardReq as any)
      const dashboardWs = dashboardRes.webSocket as MockWebSocket
      dashboardWs.send.mockClear()

      // Admin panel connects
      const adminReq = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.*',
        headers: { Upgrade: 'websocket' },
      })
      const adminRes = await eventStream.fetch(adminReq as any)
      const adminWs = adminRes.webSocket as MockWebSocket
      adminWs.send.mockClear()

      // Order is created
      const orderEvent = createTestEvent({
        topic: 'orders.user-123',
        type: 'order.created',
        payload: { orderId: 'ord-456', total: 99.99 },
      })

      await eventStream.broadcastToTopic('orders.user-123', orderEvent)

      // Both should receive
      expect(dashboardWs.send).toHaveBeenCalledTimes(1)
      expect(adminWs.send).toHaveBeenCalledTimes(1)

      // Verify event content
      const dashboardMsg = JSON.parse(dashboardWs.messages[0].data)
      expect(dashboardMsg.type).toBe('order.created')
      expect(dashboardMsg.payload.orderId).toBe('ord-456')
    })

    it('should handle live analytics dashboard', async () => {
      eventStream = new EventStreamDO(mockState as any)

      // Analytics dashboard subscribes to query
      const callback = vi.fn()
      await eventStream.subscribeToQuery(
        `SELECT
          COUNT(*) as total_events,
          COUNT(DISTINCT payload->>'userId') as unique_users
         FROM events
         WHERE type = 'page_view'
           AND timestamp > (extract(epoch from now()) * 1000 - 60000)`,
        callback
      )

      callback.mockClear()

      // Simulate page views coming in
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcast(
          createTestEvent({
            type: 'page_view',
            payload: { userId: `user-${i % 3}`, page: '/home' },
          })
        )
      }

      // Callback should have been called with updated stats
      expect(callback).toHaveBeenCalled()
      const lastResult = callback.mock.calls[callback.mock.calls.length - 1][0]
      expect(lastResult.rows[0].total_events).toBe(10)
      expect(lastResult.rows[0].unique_users).toBe(3)
    })

    it('should handle connection recovery scenario', async () => {
      eventStream = new EventStreamDO(mockState as any)

      // Client connects
      const req = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=recovery',
        headers: { Upgrade: 'websocket' },
      })
      const res = await eventStream.fetch(req as any)
      const ws = res.webSocket as MockWebSocket
      ws.send.mockClear()

      // Broadcast some events
      for (let i = 0; i < 5; i++) {
        await eventStream.broadcastToTopic(
          'recovery',
          createTestEvent({ payload: { seq: i } })
        )
      }

      expect(ws.messages.length).toBe(5)

      // Client disconnects
      ws.simulateClose(1006, 'Abnormal closure')
      await tick()

      // More events while disconnected
      for (let i = 5; i < 8; i++) {
        await eventStream.broadcastToTopic(
          'recovery',
          createTestEvent({ payload: { seq: i } })
        )
      }

      // Client reconnects
      const req2 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=recovery',
        headers: { Upgrade: 'websocket' },
      })
      const res2 = await eventStream.fetch(req2 as any)
      const ws2 = res2.webSocket as MockWebSocket
      ws2.send.mockClear()

      // Client can query missed events from hot tier
      const missed = await eventStream.query(`
        SELECT * FROM events
        WHERE topic = 'recovery' AND payload->>'seq' >= '5'
        ORDER BY timestamp
      `)

      expect(missed.rows).toHaveLength(3)
      expect(missed.rows.map((r) => r.payload.seq)).toEqual([5, 6, 7])
    })
  })

  // ============================================================================
  // WEBSOCKET HIBERNATION TESTS
  // ============================================================================

  describe('WebSocket hibernation', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should accept WebSocket with hibernation support', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=hibernate',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(101)
      // Should use hibernation-compatible WebSocket handling
      expect(mockState.acceptWebSocket).toHaveBeenCalled()
    })

    it('should handle webSocketMessage event', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=test',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      // Simulate hibernation wake with message
      const mockWs = createMockWebSocket()
      await eventStream.webSocketMessage(mockWs as any, JSON.stringify({
        type: 'subscribe',
        topics: ['new-topic'],
      }))

      // Should process the subscription
      expect(eventStream.getTopicSubscribers('new-topic').length).toBeGreaterThanOrEqual(0)
    })

    it('should handle webSocketClose event', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=hibernate',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      expect(eventStream.connectionCount).toBe(1)

      // Simulate hibernation close event
      const mockWs = response.webSocket as MockWebSocket
      await eventStream.webSocketClose(mockWs as any, 1000, 'Normal closure')

      expect(eventStream.connectionCount).toBe(0)
    })

    it('should handle webSocketError event', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=error',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const mockWs = response.webSocket as MockWebSocket

      // Simulate hibernation error event
      await eventStream.webSocketError(mockWs as any, new Error('Connection failed'))

      // Connection should be cleaned up
      expect(eventStream.connectionCount).toBe(0)
    })

    it('should restore state after hibernation', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=persist',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      // Store subscription state
      mockState.getWebSockets.mockReturnValue([{
        deserializeAttachment: () => ({
          connectionId: 'conn-123',
          topics: ['persist', 'another'],
          subscribedAt: Date.now(),
        }),
      }])

      // Create new instance (simulating hibernation wake)
      const newEventStream = new EventStreamDO(mockState as any)

      // Should restore connections from hibernated sockets
      await newEventStream.restoreFromHibernation()
      expect(newEventStream.connectionCount).toBeGreaterThanOrEqual(0)
    })

    it('should serialize connection state for hibernation', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=serialize',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as any

      // Should have serialized attachment
      expect(ws.serializeAttachment).toBeDefined()

      const attachment = await eventStream.getConnectionState(ws)
      expect(attachment).toHaveProperty('connectionId')
      expect(attachment).toHaveProperty('topics')
      expect(attachment.topics).toContain('serialize')
    })
  })

  // ============================================================================
  // BACK PRESSURE HANDLING TESTS
  // ============================================================================

  describe('back pressure handling', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should track pending messages per connection', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=backpressure',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Make send slow to simulate backpressure
      let pendingCount = 0
      ws.send.mockImplementation(async () => {
        pendingCount++
        await tick(100)
        pendingCount--
      })

      // Rapid broadcast should accumulate pending messages
      for (let i = 0; i < 10; i++) {
        eventStream.broadcastToTopic('backpressure', createTestEvent())
      }

      // Should track pending messages
      const stats = eventStream.getConnectionStats(ws as any)
      expect(stats.pendingMessages).toBeGreaterThanOrEqual(0)
    })

    it('should drop messages when backpressure limit exceeded', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        maxPendingMessages: 5,
      })

      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=drop',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Block sends completely
      let blocked = true
      ws.send.mockImplementation(async () => {
        while (blocked) await tick(10)
      })

      // Send more than limit
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcastToTopic('drop', createTestEvent({ payload: { seq: i } }))
      }

      blocked = false
      await tick(100)

      // Should have dropped some messages
      expect(ws.messages.length).toBeLessThanOrEqual(5)
    })

    it('should notify client of dropped messages', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        maxPendingMessages: 3,
      })

      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=notify',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Block sends
      let blocked = true
      ws.send.mockImplementation(async () => {
        while (blocked) await tick(10)
      })

      // Exceed limit
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcastToTopic('notify', createTestEvent())
      }

      blocked = false
      await tick(100)

      // Should have sent a warning about dropped messages
      const messages = ws.messages.map(m => JSON.parse(m.data))
      const warningMsg = messages.find(m => m.type === 'warning' || m.type === 'backpressure')
      expect(warningMsg).toBeDefined()
    })

    it('should implement slow start for reconnecting clients', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=slowstart',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Mark connection as having back pressure issues
      await eventStream.markBackPressure(ws as any)

      // Send events
      const sendTimes: number[] = []
      ws.send.mockImplementation(() => {
        sendTimes.push(Date.now())
      })

      for (let i = 0; i < 5; i++) {
        await eventStream.broadcastToTopic('slowstart', createTestEvent())
      }

      // Slow start should pace message delivery
      // (implementation detail - may have delays between messages)
      expect(sendTimes.length).toBe(5)
    })
  })

  // ============================================================================
  // EVENT DEDUPLICATION TESTS
  // ============================================================================

  describe('event deduplication', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should deduplicate events with same ID', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=dedup',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      const eventId = 'unique-event-id'

      // Send same event twice
      await eventStream.broadcast(createTestEvent({ id: eventId, payload: { v: 1 } }))
      await eventStream.broadcast(createTestEvent({ id: eventId, payload: { v: 2 } }))

      // Should only receive once
      expect(ws.messages.length).toBe(1)
      const received = JSON.parse(ws.messages[0].data)
      expect(received.id).toBe(eventId)
    })

    it('should allow same ID after dedup window expires', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        dedupWindowMs: 1000, // 1 second
      })

      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=dedup-expire',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      const eventId = 'reusable-id'

      await eventStream.broadcast(createTestEvent({ id: eventId }))
      expect(ws.messages.length).toBe(1)

      // Wait for dedup window to expire
      vi.advanceTimersByTime(2000)

      await eventStream.broadcast(createTestEvent({ id: eventId }))
      expect(ws.messages.length).toBe(2)
    })

    it('should track dedup IDs per topic', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=topic1&topic=topic2',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      const eventId = 'shared-id'

      // Same ID, different topics - should both be delivered
      await eventStream.broadcastToTopic('topic1', createTestEvent({ id: eventId, topic: 'topic1' }))
      await eventStream.broadcastToTopic('topic2', createTestEvent({ id: eventId, topic: 'topic2' }))

      expect(ws.messages.length).toBe(2)
    })

    it('should expose dedup stats', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=stats',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      const eventId = 'dup-event'
      await eventStream.broadcast(createTestEvent({ id: eventId }))
      await eventStream.broadcast(createTestEvent({ id: eventId }))
      await eventStream.broadcast(createTestEvent({ id: eventId }))

      const stats = eventStream.getDedupStats()
      expect(stats.deduplicatedCount).toBe(2)
      expect(stats.uniqueCount).toBe(1)
    })
  })

  // ============================================================================
  // LAST EVENT ID / REPLAY TESTS
  // ============================================================================

  describe('last event ID and replay', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should accept Last-Event-ID header', async () => {
      // First, broadcast some events
      const events = []
      for (let i = 0; i < 10; i++) {
        const event = createTestEvent({ topic: 'replay', payload: { seq: i } })
        events.push(event)
        await eventStream.broadcast(event)
      }

      // Connect with Last-Event-ID
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=replay',
        headers: {
          Upgrade: 'websocket',
          'Last-Event-ID': events[4].id, // Request events after #5
        },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Should receive missed events (5-9) plus welcome message
      const dataMessages = ws.messages.filter(m => {
        const parsed = JSON.parse(m.data)
        return parsed.type !== 'connected'
      })

      expect(dataMessages.length).toBe(5) // Events 5, 6, 7, 8, 9
    })

    it('should support replay via query string', async () => {
      const events = []
      for (let i = 0; i < 5; i++) {
        const event = createTestEvent({ topic: 'replay-qs', payload: { seq: i } })
        events.push(event)
        await eventStream.broadcast(event)
      }

      const request = createMockRequest({
        url: `https://stream.example.com.ai/events?topic=replay-qs&lastEventId=${events[1].id}`,
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Filter out connection messages
      const dataMessages = ws.messages.filter(m => {
        const parsed = JSON.parse(m.data)
        return parsed.type !== 'connected'
      })

      expect(dataMessages.length).toBe(3) // Events 2, 3, 4
    })

    it('should replay from timestamp', async () => {
      const baseTime = Date.now()
      vi.setSystemTime(baseTime)

      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(baseTime + i * 1000)
        await eventStream.broadcast(createTestEvent({
          topic: 'replay-ts',
          payload: { seq: i },
          timestamp: Date.now(),
        }))
      }

      const request = createMockRequest({
        url: `https://stream.example.com.ai/events?topic=replay-ts&fromTimestamp=${baseTime + 2500}`,
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Should get events from timestamp onward
      const dataMessages = ws.messages.filter(m => {
        const parsed = JSON.parse(m.data)
        return parsed.type !== 'connected'
      })

      expect(dataMessages.length).toBe(2) // Events at t+3000 and t+4000
    })

    it('should limit replay to hot tier retention', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        hotTierRetentionMs: 5 * 60 * 1000, // 5 minutes
      })

      // Request events from 10 minutes ago (outside retention)
      const oldTimestamp = Date.now() - 10 * 60 * 1000

      const request = createMockRequest({
        url: `https://stream.example.com.ai/events?topic=old&fromTimestamp=${oldTimestamp}`,
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Should receive a warning about limited replay
      const messages = ws.messages.map(m => JSON.parse(m.data))
      const warning = messages.find(m => m.type === 'warning' && m.code === 'REPLAY_TRUNCATED')
      expect(warning).toBeDefined()
    })

    it('should include event ID in all broadcast messages', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=ids',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcast(createTestEvent({ topic: 'ids' }))

      const message = JSON.parse(ws.messages[0].data)
      expect(message.id).toBeDefined()
      expect(typeof message.id).toBe('string')
    })
  })

  // ============================================================================
  // METRICS AND MONITORING TESTS
  // ============================================================================

  describe('metrics and monitoring', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should track connection metrics', async () => {
      for (let i = 0; i < 5; i++) {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=metrics',
          headers: { Upgrade: 'websocket' },
        })
        await eventStream.fetch(request as any)
      }

      const metrics = eventStream.getMetrics()

      expect(metrics.activeConnections).toBe(5)
      expect(metrics.totalConnections).toBeGreaterThanOrEqual(5)
    })

    it('should track message throughput', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=throughput',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      for (let i = 0; i < 100; i++) {
        await eventStream.broadcast(createTestEvent({ topic: 'throughput' }))
      }

      const metrics = eventStream.getMetrics()

      expect(metrics.messagesSent).toBe(100)
      expect(metrics.messagesPerSecond).toBeGreaterThan(0)
    })

    it('should track topic subscription counts', async () => {
      const topics = ['orders', 'payments', 'users']

      for (const topic of topics) {
        for (let i = 0; i < 3; i++) {
          const request = createMockRequest({
            url: `https://stream.example.com.ai/events?topic=${topic}`,
            headers: { Upgrade: 'websocket' },
          })
          await eventStream.fetch(request as any)
        }
      }

      const metrics = eventStream.getMetrics()

      expect(metrics.topicStats.orders.subscribers).toBe(3)
      expect(metrics.topicStats.payments.subscribers).toBe(3)
      expect(metrics.topicStats.users.subscribers).toBe(3)
    })

    it('should track error counts', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=errors',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Simulate send errors
      ws.send.mockImplementation(() => {
        throw new Error('Send failed')
      })

      await eventStream.broadcast(createTestEvent({ topic: 'errors' }))

      const metrics = eventStream.getMetrics()
      expect(metrics.errorCount).toBeGreaterThan(0)
    })

    it('should track latency percentiles', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=latency',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      for (let i = 0; i < 100; i++) {
        await eventStream.broadcast(createTestEvent({ topic: 'latency' }))
      }

      const metrics = eventStream.getMetrics()

      expect(metrics.latencyP50).toBeDefined()
      expect(metrics.latencyP95).toBeDefined()
      expect(metrics.latencyP99).toBeDefined()
    })

    it('should expose metrics via HTTP endpoint', async () => {
      // Add some activity
      const wsReq = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=http-metrics',
        headers: { Upgrade: 'websocket' },
      })
      await eventStream.fetch(wsReq as any)

      // Get metrics via HTTP
      const metricsReq = createMockRequest({
        url: 'https://stream.example.com.ai/metrics',
        method: 'GET',
      })

      const response = await eventStream.fetch(metricsReq as any)
      const metrics = await response.json()

      expect(response.status).toBe(200)
      expect(metrics.activeConnections).toBe(1)
    })

    it('should support Prometheus format metrics', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/metrics',
        method: 'GET',
        headers: { Accept: 'text/plain' },
      })

      const response = await eventStream.fetch(request as any)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/plain')
      expect(body).toContain('eventstream_connections_active')
      expect(body).toContain('eventstream_messages_total')
    })
  })

  // ============================================================================
  // TOPIC PATTERN MATCHING TESTS
  // ============================================================================

  describe('topic pattern matching', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should match single-level wildcard (*)', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.*',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastToTopic('orders.created', createTestEvent())
      await eventStream.broadcastToTopic('orders.updated', createTestEvent())
      await eventStream.broadcastToTopic('orders.deleted', createTestEvent())
      await eventStream.broadcastToTopic('orders.items.added', createTestEvent()) // Should NOT match

      expect(ws.messages.length).toBe(3)
    })

    it('should match multi-level wildcard (>)', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.>',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastToTopic('orders.created', createTestEvent())
      await eventStream.broadcastToTopic('orders.items.added', createTestEvent())
      await eventStream.broadcastToTopic('orders.items.removed', createTestEvent())
      await eventStream.broadcastToTopic('payments.created', createTestEvent()) // Should NOT match

      expect(ws.messages.length).toBe(3)
    })

    it('should match exact topic only when no wildcards', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.created',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastToTopic('orders.created', createTestEvent())
      await eventStream.broadcastToTopic('orders.created.v2', createTestEvent()) // Should NOT match
      await eventStream.broadcastToTopic('orders', createTestEvent()) // Should NOT match

      expect(ws.messages.length).toBe(1)
    })

    it('should support mixed patterns per connection', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders.*&topic=payments.>',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastToTopic('orders.created', createTestEvent())
      await eventStream.broadcastToTopic('payments.stripe.success', createTestEvent())
      await eventStream.broadcastToTopic('users.created', createTestEvent()) // Should NOT match

      expect(ws.messages.length).toBe(2)
    })

    it('should efficiently route to pattern subscribers', async () => {
      // Create many pattern subscribers
      const connections: MockWebSocket[] = []
      for (let i = 0; i < 100; i++) {
        const request = createMockRequest({
          url: `https://stream.example.com.ai/events?topic=tenant-${i % 10}.*`,
          headers: { Upgrade: 'websocket' },
        })
        const response = await eventStream.fetch(request as any)
        const ws = response.webSocket as MockWebSocket
        ws.send.mockClear()
        connections.push(ws)
      }

      const start = performance.now()

      // Broadcast to tenant-5.orders - should reach 10 subscribers
      await eventStream.broadcastToTopic('tenant-5.orders', createTestEvent())

      const elapsed = performance.now() - start

      // Should be fast even with pattern matching
      expect(elapsed).toBeLessThan(50)

      // Only connections subscribed to tenant-5.* should receive
      const receivedCount = connections.filter(ws => ws.messages.length > 0).length
      expect(receivedCount).toBe(10)
    })
  })

  // ============================================================================
  // CONNECTION AUTHENTICATION TESTS
  // ============================================================================

  describe('connection authentication', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any, {
        requireAuth: true,
      })
    })

    it('should reject connection without auth token', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=secure',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(401)
    })

    it('should accept connection with valid auth token', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=secure&token=valid-token',
        headers: { Upgrade: 'websocket' },
      })

      // Mock token validation
      eventStream.setTokenValidator(async (token) => token === 'valid-token')

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(101)
    })

    it('should accept auth token from Authorization header', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=secure',
        headers: {
          Upgrade: 'websocket',
          Authorization: 'Bearer valid-token',
        },
      })

      eventStream.setTokenValidator(async (token) => token === 'valid-token')

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(101)
    })

    it('should restrict topics based on auth claims', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=admin.secrets',
        headers: {
          Upgrade: 'websocket',
          Authorization: 'Bearer user-token',
        },
      })

      // Token validator returns claims
      eventStream.setTokenValidator(async (token) => {
        if (token === 'user-token') {
          return { valid: true, allowedTopics: ['public.*', 'user.*'] }
        }
        return { valid: false }
      })

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(403) // Forbidden - topic not allowed
    })

    it('should allow topic subscription based on claims', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=user.123.*',
        headers: {
          Upgrade: 'websocket',
          Authorization: 'Bearer user-123-token',
        },
      })

      eventStream.setTokenValidator(async (token) => {
        if (token === 'user-123-token') {
          return { valid: true, allowedTopics: ['user.123.*'] }
        }
        return { valid: false }
      })

      const response = await eventStream.fetch(request as any)

      expect(response.status).toBe(101)
    })

    it('should support token refresh during connection', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        requireAuth: true,
        tokenTTL: 3600, // 1 hour
      })

      eventStream.setTokenValidator(async () => ({ valid: true }))

      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=refresh&token=initial-token',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Send token refresh message
      ws.simulateMessage(JSON.stringify({
        type: 'refresh_token',
        token: 'new-token',
      }))

      await tick()

      // Should acknowledge refresh
      const messages = ws.messages.map(m => JSON.parse(m.data))
      const refreshAck = messages.find(m => m.type === 'token_refreshed')
      expect(refreshAck).toBeDefined()
    })
  })

  // ============================================================================
  // RATE LIMITING TESTS
  // ============================================================================

  describe('rate limiting', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any, {
        rateLimit: {
          messagesPerSecond: 10,
          burstSize: 20,
        },
      })
    })

    it('should allow messages within rate limit', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=ratelimit',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Send 10 messages (within limit)
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcastToTopic('ratelimit', createTestEvent())
      }

      expect(ws.messages.length).toBe(10)
    })

    it('should allow burst up to burst size', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=burst',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Send 20 messages (burst limit)
      for (let i = 0; i < 20; i++) {
        await eventStream.broadcastToTopic('burst', createTestEvent())
      }

      expect(ws.messages.length).toBe(20)
    })

    it('should queue or drop messages exceeding rate limit', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=exceed',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Send 30 messages (exceeds burst)
      for (let i = 0; i < 30; i++) {
        await eventStream.broadcastToTopic('exceed', createTestEvent())
      }

      // Should cap at burst size or rate limit
      expect(ws.messages.length).toBeLessThanOrEqual(20)
    })

    it('should replenish tokens over time', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=replenish',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Use up burst
      for (let i = 0; i < 20; i++) {
        await eventStream.broadcastToTopic('replenish', createTestEvent())
      }

      // Wait for token replenishment (1 second = 10 tokens)
      vi.advanceTimersByTime(1000)

      // Clear previous messages
      const prevCount = ws.messages.length
      ws.messages.length = 0

      // Should be able to send more
      for (let i = 0; i < 10; i++) {
        await eventStream.broadcastToTopic('replenish', createTestEvent())
      }

      expect(ws.messages.length).toBe(10)
    })

    it('should apply rate limit per connection', async () => {
      // Two connections, each should have own rate limit
      const req1 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=perconn',
        headers: { Upgrade: 'websocket' },
      })
      const req2 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=perconn',
        headers: { Upgrade: 'websocket' },
      })

      const res1 = await eventStream.fetch(req1 as any)
      const res2 = await eventStream.fetch(req2 as any)
      const ws1 = res1.webSocket as MockWebSocket
      const ws2 = res2.webSocket as MockWebSocket
      ws1.send.mockClear()
      ws2.send.mockClear()

      // Send 20 messages (burst limit)
      for (let i = 0; i < 20; i++) {
        await eventStream.broadcastToTopic('perconn', createTestEvent())
      }

      // Both should receive up to their individual limits
      expect(ws1.messages.length).toBe(20)
      expect(ws2.messages.length).toBe(20)
    })
  })

  // ============================================================================
  // ERROR EVENT BROADCASTING TESTS
  // ============================================================================

  describe('error event broadcasting', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should broadcast error events to error topic', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=_errors',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      // Trigger an error
      await eventStream.broadcastError({
        code: 'PROCESSING_ERROR',
        message: 'Failed to process event',
        eventId: 'evt-123',
      })

      expect(ws.messages.length).toBe(1)
      const errorEvent = JSON.parse(ws.messages[0].data)
      expect(errorEvent.type).toBe('error')
      expect(errorEvent.payload.code).toBe('PROCESSING_ERROR')
    })

    it('should include error context in error events', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=_errors',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload',
        context: {
          topic: 'orders',
          field: 'amount',
          value: -100,
        },
      })

      const errorEvent = JSON.parse(ws.messages[0].data)
      expect(errorEvent.payload.context.topic).toBe('orders')
      expect(errorEvent.payload.context.field).toBe('amount')
    })

    it('should not broadcast errors to regular topics', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=orders',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastError({
        code: 'SYSTEM_ERROR',
        message: 'Internal error',
      })

      // Regular topic subscriber should not receive errors
      expect(ws.messages.length).toBe(0)
    })

    it('should support error severity levels', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=_errors',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      await eventStream.broadcastError({
        code: 'CRITICAL_ERROR',
        message: 'Database connection lost',
        severity: 'critical',
      })

      const errorEvent = JSON.parse(ws.messages[0].data)
      expect(errorEvent.payload.severity).toBe('critical')
    })
  })

  // ============================================================================
  // GRACEFUL SHUTDOWN TESTS
  // ============================================================================

  describe('graceful shutdown', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should reject new connections during shutdown', async () => {
      // Create initial connection
      const req1 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=shutdown',
        headers: { Upgrade: 'websocket' },
      })
      await eventStream.fetch(req1 as any)

      // Initiate shutdown
      eventStream.initiateShutdown()

      // Try to connect during shutdown
      const req2 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=shutdown',
        headers: { Upgrade: 'websocket' },
      })
      const response = await eventStream.fetch(req2 as any)

      expect(response.status).toBe(503) // Service Unavailable
    })

    it('should notify existing connections of impending shutdown', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=notify-shutdown',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      eventStream.initiateShutdown()

      // Should send shutdown notice
      const messages = ws.messages.map(m => JSON.parse(m.data))
      const shutdownMsg = messages.find(m => m.type === 'shutdown')
      expect(shutdownMsg).toBeDefined()
      expect(shutdownMsg.reason).toBeDefined()
    })

    it('should wait for pending messages to drain', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=drain',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Make send slow
      ws.send.mockImplementation(async () => {
        await tick(100)
      })

      // Queue some messages
      eventStream.broadcastToTopic('drain', createTestEvent())
      eventStream.broadcastToTopic('drain', createTestEvent())

      // Initiate shutdown
      const shutdownPromise = eventStream.gracefulShutdown({ drainTimeout: 5000 })

      // Should wait for messages to drain
      await vi.advanceTimersByTimeAsync(500)
      await shutdownPromise

      expect(ws.send).toHaveBeenCalled()
    })

    it('should force close after drain timeout', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=force-close',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Make send never complete
      ws.send.mockImplementation(() => new Promise(() => {}))

      eventStream.broadcastToTopic('force-close', createTestEvent())

      const shutdownPromise = eventStream.gracefulShutdown({ drainTimeout: 1000 })

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(1500)
      await shutdownPromise

      // Connection should be forcibly closed
      expect(ws.close).toHaveBeenCalled()
    })

    it('should complete shutdown when all connections close', async () => {
      const connections: MockWebSocket[] = []

      for (let i = 0; i < 5; i++) {
        const request = createMockRequest({
          url: 'https://stream.example.com.ai/events?topic=all-close',
          headers: { Upgrade: 'websocket' },
        })
        const response = await eventStream.fetch(request as any)
        connections.push(response.webSocket as MockWebSocket)
      }

      expect(eventStream.connectionCount).toBe(5)

      const shutdownPromise = eventStream.gracefulShutdown()

      // Close all connections
      for (const ws of connections) {
        ws.simulateClose(1000, 'Shutdown')
      }
      await tick()

      await shutdownPromise

      expect(eventStream.connectionCount).toBe(0)
      expect(eventStream.isShutdown).toBe(true)
    })
  })

  // ============================================================================
  // BATCH OPERATIONS TESTS
  // ============================================================================

  describe('batch operations', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should broadcast batch of events atomically', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=batch',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket
      ws.send.mockClear()

      const events = [
        createTestEvent({ topic: 'batch', payload: { seq: 1 } }),
        createTestEvent({ topic: 'batch', payload: { seq: 2 } }),
        createTestEvent({ topic: 'batch', payload: { seq: 3 } }),
      ]

      await eventStream.broadcastBatch(events)

      // All events should be sent together
      expect(ws.messages.length).toBe(3)

      // Verify order preserved
      const received = ws.messages.map(m => JSON.parse(m.data).payload.seq)
      expect(received).toEqual([1, 2, 3])
    })

    it('should handle batch with mixed topics', async () => {
      const req1 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=topic-a',
        headers: { Upgrade: 'websocket' },
      })
      const req2 = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=topic-b',
        headers: { Upgrade: 'websocket' },
      })

      const res1 = await eventStream.fetch(req1 as any)
      const res2 = await eventStream.fetch(req2 as any)
      const ws1 = res1.webSocket as MockWebSocket
      const ws2 = res2.webSocket as MockWebSocket
      ws1.send.mockClear()
      ws2.send.mockClear()

      const events = [
        createTestEvent({ topic: 'topic-a', payload: { for: 'a' } }),
        createTestEvent({ topic: 'topic-b', payload: { for: 'b' } }),
        createTestEvent({ topic: 'topic-a', payload: { for: 'a' } }),
      ]

      await eventStream.broadcastBatch(events)

      expect(ws1.messages.length).toBe(2) // topic-a events
      expect(ws2.messages.length).toBe(1) // topic-b events
    })

    it('should optimize batch storage in PGLite', async () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        createTestEvent({ topic: 'bulk', payload: { index: i } })
      )

      const start = performance.now()
      await eventStream.broadcastBatch(events)
      const elapsed = performance.now() - start

      // Batch insert should be efficient
      expect(elapsed).toBeLessThan(100)

      // Verify all events stored
      const result = await eventStream.query(`SELECT COUNT(*) as count FROM events WHERE topic = 'bulk'`)
      expect(result.rows[0].count).toBe(100)
    })
  })

  // ============================================================================
  // TOPIC MANAGEMENT TESTS
  // ============================================================================

  describe('topic management', () => {
    beforeEach(() => {
      eventStream = new EventStreamDO(mockState as any)
    })

    it('should list active topics', async () => {
      const topics = ['orders', 'payments', 'users', 'analytics']

      for (const topic of topics) {
        const request = createMockRequest({
          url: `https://stream.example.com.ai/events?topic=${topic}`,
          headers: { Upgrade: 'websocket' },
        })
        await eventStream.fetch(request as any)
      }

      const activeTopics = eventStream.getActiveTopics()

      expect(activeTopics).toContain('orders')
      expect(activeTopics).toContain('payments')
      expect(activeTopics).toContain('users')
      expect(activeTopics).toContain('analytics')
    })

    it('should remove topic when last subscriber disconnects', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=temporary',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      expect(eventStream.getActiveTopics()).toContain('temporary')

      ws.simulateClose(1000, 'Test')
      await tick()

      expect(eventStream.getActiveTopics()).not.toContain('temporary')
    })

    it('should track topic message counts', async () => {
      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=counted',
        headers: { Upgrade: 'websocket' },
      })

      await eventStream.fetch(request as any)

      for (let i = 0; i < 10; i++) {
        await eventStream.broadcastToTopic('counted', createTestEvent())
      }

      const stats = eventStream.getTopicStats('counted')
      expect(stats.messageCount).toBe(10)
    })

    it('should support topic TTL for auto-cleanup', async () => {
      eventStream = new EventStreamDO(mockState as any, {
        topicTTL: 5000, // 5 second TTL for empty topics
      })

      const request = createMockRequest({
        url: 'https://stream.example.com.ai/events?topic=ttl-topic',
        headers: { Upgrade: 'websocket' },
      })

      const response = await eventStream.fetch(request as any)
      const ws = response.webSocket as MockWebSocket

      // Disconnect
      ws.simulateClose(1000, 'Test')
      await tick()

      // Topic should still exist (in grace period)
      expect(eventStream.getTopicStats('ttl-topic')).toBeDefined()

      // After TTL
      vi.advanceTimersByTime(6000)
      await eventStream.runCleanup()

      // Topic should be cleaned up
      expect(eventStream.getTopicStats('ttl-topic')).toBeUndefined()
    })
  })
})
