/**
 * WSConnectionManager Tests
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * WSConnectionManager handles hibernatable WebSocket connections for the Unified Storage
 * architecture. It provides:
 * - Accept connections with ctx.acceptWebSocket() for hibernation support
 * - Track connection state and sessions
 * - Handle hibernation lifecycle
 * - Manage connection limits
 * - Broadcast messages to all or topic-based connections
 *
 * Architecture context (from unified-storage.md):
 * - WebSocket is 20:1 cheaper than HTTP ($0.0075/M vs $0.15/M messages)
 * - Hibernatable connections have zero duration cost when idle
 * - Connections survive hibernation via state serialization
 *
 * Issue: do-2tr.4.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  WSConnectionManager,
  type WSConnectionManagerConfig,
  type SessionState,
  type ConnectionInfo,
} from '../../objects/unified-storage/ws-connection-manager'

// ============================================================================
// MOCK TYPES AND UTILITIES
// ============================================================================

/**
 * Mock WebSocket for testing
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  readyState: number
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  messages: Array<{ data: string; timestamp: number }>
  simulateMessage: (data: string) => void
  simulateClose: (code: number, reason: string) => void
}

/**
 * Mock DurableObjectState context for testing
 */
interface MockDOContext {
  acceptWebSocket: ReturnType<typeof vi.fn>
  getWebSockets: ReturnType<typeof vi.fn>
  storage: {
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
}

/**
 * Create a mock WebSocket for testing
 */
function createMockWebSocket(options?: { readyState?: number }): MockWebSocket {
  const messages: Array<{ data: string; timestamp: number }> = []
  const handlers: Map<string, Set<(event: unknown) => void>> = new Map()

  const ws: MockWebSocket = {
    send: vi.fn((data: string) => {
      messages.push({ data, timestamp: Date.now() })
    }),
    close: vi.fn(),
    readyState: options?.readyState ?? 1, // WebSocket.OPEN
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    messages,
    simulateMessage: (data: string) => {
      handlers.get('message')?.forEach((h) => h({ data }))
    },
    simulateClose: (code: number, reason: string) => {
      handlers.get('close')?.forEach((h) => h({ code, reason }))
    },
  }

  return ws
}

/**
 * Create a mock WebSocketPair for testing
 */
function createMockWebSocketPair(): [MockWebSocket, MockWebSocket] {
  const client = createMockWebSocket()
  const server = createMockWebSocket()

  // Wire them together: when server sends, client receives
  server.send = vi.fn((data: string) => {
    client.messages.push({ data, timestamp: Date.now() })
  })

  return [client, server]
}

/**
 * Create a mock DO context for testing
 */
function createMockDOContext(): MockDOContext {
  const websockets: WebSocket[] = []

  return {
    acceptWebSocket: vi.fn((ws: WebSocket) => {
      websockets.push(ws)
    }),
    getWebSockets: vi.fn(() => websockets),
    storage: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WSConnectionManager', () => {
  let manager: WSConnectionManager
  let mockCtx: MockDOContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T10:00:00.000Z'))
    mockCtx = createMockDOContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // CONNECTION HANDLING
  // ==========================================================================

  describe('connection handling', () => {
    it('should accept WebSocket upgrade request', async () => {
      // Given: A manager and an upgrade request
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)

      const request = new Request('https://example.com/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      })

      // When: Handling the upgrade request
      const response = await manager.handleUpgrade(request)

      // Then: Should return a WebSocket upgrade response
      expect(response).toBeDefined()
      expect(response.status).toBe(101)
    })

    it('should return 101 Switching Protocols response', async () => {
      // Given: A manager and an upgrade request
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)

      const request = new Request('https://example.com/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      })

      // When: Handling the upgrade request
      const response = await manager.handleUpgrade(request)

      // Then: Should have correct status code
      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('should use ctx.acceptWebSocket for hibernation support', async () => {
      // Given: A manager with a mock context
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)

      const request = new Request('https://example.com/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      })

      // When: Handling the upgrade request
      await manager.handleUpgrade(request)

      // Then: Should have called ctx.acceptWebSocket for hibernation
      expect(mockCtx.acceptWebSocket).toHaveBeenCalled()
    })

    it('should assign unique session ID to each connection', async () => {
      // Given: A manager
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)

      const request1 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const request2 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Accepting multiple connections
      const response1 = await manager.handleUpgrade(request1)
      const response2 = await manager.handleUpgrade(request2)

      // Then: Each connection should have a unique session ID
      const sessions = manager.getAllSessions()
      expect(sessions.length).toBe(2)
      expect(sessions[0].sessionId).not.toBe(sessions[1].sessionId)
    })

    it('should track connection in clients map', async () => {
      // Given: A manager with no connections
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
      expect(manager.connectionCount).toBe(0)

      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Accepting a connection
      await manager.handleUpgrade(request)

      // Then: Connection should be tracked
      expect(manager.connectionCount).toBe(1)
    })
  })

  // ==========================================================================
  // SESSION STATE
  // ==========================================================================

  describe('session state', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should store session ID per connection', async () => {
      // Given: A new connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Connection is established
      const response = await manager.handleUpgrade(request)

      // Then: Session should have an ID
      const sessions = manager.getAllSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionId).toBeDefined()
      expect(typeof sessions[0].sessionId).toBe('string')
      expect(sessions[0].sessionId.length).toBeGreaterThan(0)
    })

    it('should track connection timestamp', async () => {
      // Given: A specific time
      vi.setSystemTime(new Date('2026-01-14T15:30:00.000Z'))

      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Connection is established
      await manager.handleUpgrade(request)

      // Then: Session should have connection timestamp
      const sessions = manager.getAllSessions()
      expect(sessions[0].connectedAt).toBeDefined()
      expect(sessions[0].connectedAt).toBe(new Date('2026-01-14T15:30:00.000Z').getTime())
    })

    it('should track last activity timestamp', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request)

      // When: Time passes and activity occurs
      vi.advanceTimersByTime(60_000) // 1 minute later

      // Simulate message activity
      const sessions = manager.getAllSessions()
      manager.updateActivity(sessions[0].sessionId)

      // Then: Last activity should be updated
      const updatedSessions = manager.getAllSessions()
      expect(updatedSessions[0].lastActivity).toBeDefined()
      expect(updatedSessions[0].lastActivity).toBeGreaterThan(updatedSessions[0].connectedAt)
    })

    it('should store custom session data', async () => {
      // Given: A connection with custom data
      const request = new Request('https://example.com/ws?userId=user_123&role=admin', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Connection is established with session data
      await manager.handleUpgrade(request, {
        userId: 'user_123',
        role: 'admin',
        tenantId: 'tenant_abc',
      })

      // Then: Custom data should be stored
      const sessions = manager.getAllSessions()
      expect(sessions[0].data).toBeDefined()
      expect(sessions[0].data?.userId).toBe('user_123')
      expect(sessions[0].data?.role).toBe('admin')
      expect(sessions[0].data?.tenantId).toBe('tenant_abc')
    })
  })

  // ==========================================================================
  // HIBERNATION
  // ==========================================================================

  describe('hibernation', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should accept hibernatable WebSocket', async () => {
      // Given: A new connection request
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      // When: Connection is accepted
      await manager.handleUpgrade(request)

      // Then: Should use ctx.acceptWebSocket (hibernatable API)
      expect(mockCtx.acceptWebSocket).toHaveBeenCalledTimes(1)
      // Verify the WebSocket passed to acceptWebSocket is the server-side socket
      expect(mockCtx.acceptWebSocket).toHaveBeenCalled()
    })

    it('should preserve session state through hibernation', async () => {
      // Given: A connection with session data
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request, {
        userId: 'user_456',
        subscriptions: ['orders', 'notifications'],
      })

      const originalSessions = manager.getAllSessions()
      const originalSessionId = originalSessions[0].sessionId

      // When: Hibernation occurs and state is restored
      const serializedState = manager.getSerializableState()

      // Create new manager (simulating cold start after hibernation)
      const newCtx = createMockDOContext()
      const restoredManager = new WSConnectionManager(newCtx as unknown as DurableObjectState)

      // Restore from serialized state
      await restoredManager.restoreFromHibernation(serializedState)

      // Then: Session state should be preserved
      const restoredSessions = restoredManager.getAllSessions()
      expect(restoredSessions.length).toBe(1)
      expect(restoredSessions[0].sessionId).toBe(originalSessionId)
      expect(restoredSessions[0].data?.userId).toBe('user_456')
      expect(restoredSessions[0].data?.subscriptions).toEqual(['orders', 'notifications'])
    })

    it('should handle webSocketClose event', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request)
      expect(manager.connectionCount).toBe(1)

      // When: WebSocket close event is received
      await manager.webSocketClose(response.webSocket as unknown as WebSocket, 1000, 'Normal closure')

      // Then: Connection should be removed
      expect(manager.connectionCount).toBe(0)
    })

    it('should clean up session on close', async () => {
      // Given: A connection with session data
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request, { userId: 'user_789' })

      const sessionId = manager.getAllSessions()[0].sessionId

      // When: Connection is closed
      await manager.webSocketClose(response.webSocket as unknown as WebSocket, 1000, 'Normal closure')

      // Then: Session should be cleaned up
      expect(manager.getSession(sessionId)).toBeNull()
      expect(manager.getAllSessions().length).toBe(0)
    })
  })

  // ==========================================================================
  // CONNECTION LIMITS
  // ==========================================================================

  describe('connection limits', () => {
    it('should enforce max connections limit', async () => {
      // Given: A manager with max 3 connections
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState, {
        maxConnections: 3,
      })

      // When: Accepting connections up to the limit
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://example.com/ws', {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        })
        await manager.handleUpgrade(request)
      }

      // Then: Should have exactly 3 connections
      expect(manager.connectionCount).toBe(3)
    })

    it('should reject new connections when at limit', async () => {
      // Given: A manager at max connections
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState, {
        maxConnections: 2,
      })

      // Accept up to limit
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://example.com/ws', {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        })
        await manager.handleUpgrade(request)
      }

      // When: Trying to accept one more
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request)

      // Then: Should reject with appropriate status
      expect(response.status).toBe(503)
      expect(manager.connectionCount).toBe(2)
    })

    it('should return 503 when connection limit reached', async () => {
      // Given: A manager at max connections
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState, {
        maxConnections: 1,
      })

      // Fill to capacity
      const firstRequest = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(firstRequest)

      // When: Another connection is attempted
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request)

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503)

      // Verify error message
      const body = await response.text()
      expect(body).toContain('connection')
      expect(body.toLowerCase()).toContain('limit')
    })
  })

  // ==========================================================================
  // BROADCAST
  // ==========================================================================

  describe('broadcast', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should broadcast message to all connections', async () => {
      // Given: Multiple connected clients
      const [client1] = createMockWebSocketPair()
      const [client2] = createMockWebSocketPair()
      const [client3] = createMockWebSocketPair()

      // Connect all clients
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://example.com/ws', {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        })
        await manager.handleUpgrade(request)
      }

      expect(manager.connectionCount).toBe(3)

      // When: Broadcasting a message
      const message = JSON.stringify({ type: 'notification', data: { text: 'Hello all!' } })
      const sendCount = await manager.broadcast(message)

      // Then: All connections should receive the message
      expect(sendCount).toBe(3)
    })

    it('should skip closed connections', async () => {
      // Given: Multiple connections, one closed
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://example.com/ws', {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        })
        await manager.handleUpgrade(request)
      }

      // Close one connection
      const sessions = manager.getAllSessions()
      await manager.closeConnection(sessions[0].sessionId)

      expect(manager.connectionCount).toBe(2)

      // When: Broadcasting
      const message = JSON.stringify({ type: 'test' })
      const sendCount = await manager.broadcast(message)

      // Then: Only open connections should receive
      expect(sendCount).toBe(2)
    })

    it('should support topic-based broadcast', async () => {
      // Given: Connections subscribed to different topics
      const request1 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const request2 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const request3 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      await manager.handleUpgrade(request1, { topics: ['orders'] })
      await manager.handleUpgrade(request2, { topics: ['orders', 'notifications'] })
      await manager.handleUpgrade(request3, { topics: ['notifications'] })

      // When: Broadcasting to 'orders' topic
      const message = JSON.stringify({ type: 'order.created', orderId: 'ord_123' })
      const sendCount = await manager.broadcastToTopic('orders', message)

      // Then: Only 'orders' subscribers should receive
      expect(sendCount).toBe(2) // request1 and request2
    })
  })

  // ==========================================================================
  // WEBSOCKET MESSAGE HANDLING
  // ==========================================================================

  describe('websocket message handling', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should handle ping messages with pong response', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request)
      const ws = response.webSocket as unknown as MockWebSocket

      // When: Receiving a ping message
      await manager.webSocketMessage(
        ws as unknown as WebSocket,
        JSON.stringify({ type: 'ping', timestamp: Date.now() })
      )

      // Then: Should respond with pong
      // The pong response should be sent to the client
      expect(ws.send).toHaveBeenCalled()
      const lastMessage = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0])
      expect(lastMessage.type).toBe('pong')
    })

    it('should update last activity on message', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request)

      const sessions = manager.getAllSessions()
      const originalActivity = sessions[0].lastActivity

      // When: Time passes and a message is received
      vi.advanceTimersByTime(30_000)

      await manager.webSocketMessage(
        {} as WebSocket, // Mock WS - will be matched by session
        JSON.stringify({ type: 'custom', data: {} })
      )

      // Then: Last activity should be updated
      const updatedSessions = manager.getAllSessions()
      expect(updatedSessions[0].lastActivity).toBeGreaterThan(originalActivity)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should handle webSocketError gracefully', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const response = await manager.handleUpgrade(request)
      expect(manager.connectionCount).toBe(1)

      // When: WebSocket error occurs
      await manager.webSocketError(response.webSocket as unknown as WebSocket, new Error('Connection lost'))

      // Then: Connection should be cleaned up
      expect(manager.connectionCount).toBe(0)
    })

    it('should not throw when broadcasting to empty connections', async () => {
      // Given: No connections
      expect(manager.connectionCount).toBe(0)

      // When/Then: Broadcasting should not throw
      await expect(manager.broadcast(JSON.stringify({ type: 'test' }))).resolves.toBe(0)
    })

    it('should reject non-WebSocket upgrade requests', async () => {
      // Given: A non-WebSocket request
      const request = new Request('https://example.com/ws', {
        headers: {
          // No Upgrade header
        },
      })

      // When: Attempting to handle as WebSocket
      const response = await manager.handleUpgrade(request)

      // Then: Should return 426 Upgrade Required
      expect(response.status).toBe(426)
    })
  })

  // ==========================================================================
  // METRICS AND STATS
  // ==========================================================================

  describe('metrics and stats', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should track total connections', async () => {
      // Given: Multiple connections over time
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://example.com/ws', {
          headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
        })
        await manager.handleUpgrade(request)
      }

      // When: Getting stats
      const stats = manager.getStats()

      // Then: Should report total connections
      expect(stats.totalConnections).toBe(5)
      expect(stats.activeConnections).toBe(5)
    })

    it('should report connection duration', async () => {
      // Given: A connection established at a specific time
      vi.setSystemTime(new Date('2026-01-14T10:00:00.000Z'))

      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request)

      // When: Time passes
      vi.advanceTimersByTime(5 * 60 * 1000) // 5 minutes

      // Then: Duration should be accurate
      const sessions = manager.getAllSessions()
      const duration = Date.now() - sessions[0].connectedAt
      expect(duration).toBe(5 * 60 * 1000)
    })
  })

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  describe('configuration', () => {
    it('should use default config values', () => {
      // Given: A manager with no config
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)

      // Then: Should have sensible defaults
      expect(manager.config.maxConnections).toBe(10_000)
      expect(manager.config.pingInterval).toBe(30_000)
      expect(manager.config.sessionTimeout).toBe(300_000) // 5 minutes
    })

    it('should accept custom config', () => {
      // Given: Custom configuration
      const config: WSConnectionManagerConfig = {
        maxConnections: 500,
        pingInterval: 15_000,
        sessionTimeout: 60_000,
      }

      // When: Creating manager with custom config
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState, config)

      // Then: Should use custom values
      expect(manager.config.maxConnections).toBe(500)
      expect(manager.config.pingInterval).toBe(15_000)
      expect(manager.config.sessionTimeout).toBe(60_000)
    })
  })

  // ==========================================================================
  // SUBSCRIPTION MANAGEMENT
  // ==========================================================================

  describe('subscription management', () => {
    beforeEach(() => {
      manager = new WSConnectionManager(mockCtx as unknown as DurableObjectState)
    })

    it('should allow subscribing to topics', async () => {
      // Given: An established connection
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request)

      const sessions = manager.getAllSessions()
      const sessionId = sessions[0].sessionId

      // When: Subscribing to topics
      manager.subscribe(sessionId, ['orders', 'notifications'])

      // Then: Session should have topics
      const session = manager.getSession(sessionId)
      expect(session?.topics).toContain('orders')
      expect(session?.topics).toContain('notifications')
    })

    it('should allow unsubscribing from topics', async () => {
      // Given: A connection subscribed to topics
      const request = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      await manager.handleUpgrade(request, { topics: ['orders', 'notifications', 'alerts'] })

      const sessions = manager.getAllSessions()
      const sessionId = sessions[0].sessionId

      // When: Unsubscribing from a topic
      manager.unsubscribe(sessionId, ['notifications'])

      // Then: Topic should be removed
      const session = manager.getSession(sessionId)
      expect(session?.topics).toContain('orders')
      expect(session?.topics).toContain('alerts')
      expect(session?.topics).not.toContain('notifications')
    })

    it('should track subscribers per topic', async () => {
      // Given: Multiple connections with different subscriptions
      const request1 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const request2 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })
      const request3 = new Request('https://example.com/ws', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      })

      await manager.handleUpgrade(request1, { topics: ['orders'] })
      await manager.handleUpgrade(request2, { topics: ['orders', 'payments'] })
      await manager.handleUpgrade(request3, { topics: ['payments'] })

      // When: Getting topic subscriber counts
      const ordersCount = manager.getTopicSubscriberCount('orders')
      const paymentsCount = manager.getTopicSubscriberCount('payments')
      const alertsCount = manager.getTopicSubscriberCount('alerts')

      // Then: Should report correct counts
      expect(ordersCount).toBe(2)
      expect(paymentsCount).toBe(2)
      expect(alertsCount).toBe(0)
    })
  })
})
