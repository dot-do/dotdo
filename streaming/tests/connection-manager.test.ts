/**
 * ConnectionManager Interface Tests (TDD GREEN Phase)
 *
 * Tests for the IConnectionManager interface extracted from EventStreamDO.
 * This component handles WebSocket connection lifecycle and topic subscriptions.
 *
 * @issue do-tcog - ConnectionManager Interface Tests
 * @wave Wave 3: EventStreamDO Decomposition
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ConnectionManager, type IConnectionManager, type ConnectionInfo } from '../event-stream/connection-manager'

// ============================================================================
// MOCK WEBSOCKET FOR TESTING
// ============================================================================

function createMockWebSocket(): WebSocket {
  const handlers: Map<string, Set<(data: any) => void>> = new Map()
  let isOpen = true

  const mock: any = {
    send: vi.fn(),
    close: vi.fn(() => {
      isOpen = false
    }),
    addEventListener: vi.fn((event: string, handler: (data: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (data: any) => void) => {
      handlers.get(event)?.delete(handler)
    }),
    readyState: 1, // OPEN
    get isOpen() {
      return isOpen
    },
  }

  return mock as WebSocket
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('ConnectionManager', () => {
  let manager: IConnectionManager

  beforeEach(() => {
    manager = new ConnectionManager()
  })

  describe('addConnection()', () => {
    it('adds connection and returns id', async () => {
      // Arrange
      const ws = createMockWebSocket()

      // Act
      const connectionId = manager.addConnection(ws, ['orders'])

      // Assert
      expect(connectionId).toBeDefined()
      expect(typeof connectionId).toBe('string')
      expect(connectionId.length).toBeGreaterThan(0)
    })

    it('registers connection with initial topics', async () => {
      // Arrange
      const ws = createMockWebSocket()
      const topics = ['orders', 'payments']

      // Act
      const connectionId = manager.addConnection(ws, topics)
      const info = manager.getConnection(connectionId)

      // Assert
      expect(info).toBeDefined()
      expect(info?.topics.has('orders')).toBe(true)
      expect(info?.topics.has('payments')).toBe(true)
    })

    it('stores connection metadata', async () => {
      // Arrange
      const ws = createMockWebSocket()
      const metadata = { userId: 'user-123', clientVersion: '1.0.0' }

      // Act
      const connectionId = manager.addConnection(ws, ['events'], metadata)
      const info = manager.getConnection(connectionId)

      // Assert
      expect(info?.metadata).toEqual(metadata)
    })

    it('increments connection count', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      expect(manager.getConnectionCount()).toBe(0)

      manager.addConnection(ws1, ['topic1'])
      expect(manager.getConnectionCount()).toBe(1)

      manager.addConnection(ws2, ['topic2'])
      expect(manager.getConnectionCount()).toBe(2)
    })

    it('handles empty topics array', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, [])

      expect(connectionId).toBeDefined()
      const info = manager.getConnection(connectionId)
      expect(info?.topics.size).toBe(0)
    })
  })

  describe('removeConnection()', () => {
    it('removes connection by id', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      expect(manager.getConnectionCount()).toBe(1)

      manager.removeConnection(connectionId)

      expect(manager.getConnectionCount()).toBe(0)
      expect(manager.getConnection(connectionId)).toBeUndefined()
    })

    it('handles non-existent connection gracefully', async () => {
      // Should not throw
      manager.removeConnection('non-existent-id')
      expect(manager.getConnectionCount()).toBe(0)
    })

    it('removes connection from all topic subscriptions', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders', 'payments'])

      // Verify it's in topics
      expect(manager.getConnectionsByTopic('orders')).toContain(ws)
      expect(manager.getConnectionsByTopic('payments')).toContain(ws)

      // Remove connection
      manager.removeConnection(connectionId)

      // Should no longer be in topics
      expect(manager.getConnectionsByTopic('orders')).not.toContain(ws)
      expect(manager.getConnectionsByTopic('payments')).not.toContain(ws)
    })
  })

  describe('getConnectionsByTopic()', () => {
    it('finds connections by topic', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      manager.addConnection(ws1, ['orders'])
      manager.addConnection(ws2, ['orders', 'payments'])
      manager.addConnection(ws3, ['payments'])

      const orderConnections = manager.getConnectionsByTopic('orders')
      expect(orderConnections).toHaveLength(2)
      expect(orderConnections).toContain(ws1)
      expect(orderConnections).toContain(ws2)
      expect(orderConnections).not.toContain(ws3)
    })

    it('supports wildcard topic matching', async () => {
      // Wildcard subscriptions: "orders.*" should match "orders.created", "orders.updated"
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      manager.addConnection(ws1, ['orders.*'])  // Wildcard subscription
      manager.addConnection(ws2, ['orders.created'])  // Exact subscription

      // When broadcasting to 'orders.created':
      const matches = manager.getConnectionsByTopic('orders.created')
      expect(matches).toHaveLength(2)  // Both should match
      expect(matches).toContain(ws1)
      expect(matches).toContain(ws2)

      // When broadcasting to 'orders.updated':
      const updatedMatches = manager.getConnectionsByTopic('orders.updated')
      expect(updatedMatches).toHaveLength(1)  // Only wildcard matches
      expect(updatedMatches).toContain(ws1)
    })

    it('supports double wildcard for all topics', async () => {
      // "*" should match all topics
      const ws = createMockWebSocket()
      manager.addConnection(ws, ['*'])

      expect(manager.getConnectionsByTopic('orders')).toContain(ws)
      expect(manager.getConnectionsByTopic('payments')).toContain(ws)
      expect(manager.getConnectionsByTopic('any.nested.topic')).toContain(ws)
    })

    it('returns empty array for topic with no subscribers', async () => {
      const connections = manager.getConnectionsByTopic('nonexistent')
      expect(connections).toHaveLength(0)
      expect(connections).toEqual([])
    })
  })

  describe('updateSubscriptions()', () => {
    it('replaces all subscriptions for a connection', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders', 'payments'])

      manager.updateSubscriptions(connectionId, ['users', 'events'])

      const info = manager.getConnection(connectionId)
      expect(info?.topics.has('orders')).toBe(false)
      expect(info?.topics.has('payments')).toBe(false)
      expect(info?.topics.has('users')).toBe(true)
      expect(info?.topics.has('events')).toBe(true)
    })

    it('handles non-existent connection gracefully', async () => {
      // Should not throw
      manager.updateSubscriptions('non-existent', ['topics'])
    })
  })

  describe('addSubscriptions()', () => {
    it('adds topics to existing subscriptions', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      manager.addSubscriptions(connectionId, ['payments', 'users'])

      const info = manager.getConnection(connectionId)
      expect(info?.topics.has('orders')).toBe(true)
      expect(info?.topics.has('payments')).toBe(true)
      expect(info?.topics.has('users')).toBe(true)
    })

    it('handles duplicate topics gracefully', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Adding 'orders' again should be idempotent
      manager.addSubscriptions(connectionId, ['orders'])

      const info = manager.getConnection(connectionId)
      expect(info?.topics.size).toBe(1)
    })
  })

  describe('removeSubscriptions()', () => {
    it('removes specific topics from subscriptions', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders', 'payments', 'users'])

      manager.removeSubscriptions(connectionId, ['payments'])

      const info = manager.getConnection(connectionId)
      expect(info?.topics.has('orders')).toBe(true)
      expect(info?.topics.has('payments')).toBe(false)
      expect(info?.topics.has('users')).toBe(true)
    })
  })

  describe('getConnectionCount()', () => {
    it('tracks connection count', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      expect(manager.getConnectionCount()).toBe(0)

      const id1 = manager.addConnection(ws1, ['a'])
      expect(manager.getConnectionCount()).toBe(1)

      const id2 = manager.addConnection(ws2, ['b'])
      manager.addConnection(ws3, ['c'])
      expect(manager.getConnectionCount()).toBe(3)

      manager.removeConnection(id1)
      expect(manager.getConnectionCount()).toBe(2)

      manager.removeConnection(id2)
      expect(manager.getConnectionCount()).toBe(1)
    })
  })

  describe('getActiveTopics()', () => {
    it('returns all topics with active subscribers', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      manager.addConnection(ws1, ['orders', 'payments'])
      manager.addConnection(ws2, ['orders', 'users'])

      const topics = manager.getActiveTopics()
      expect(topics).toContain('orders')
      expect(topics).toContain('payments')
      expect(topics).toContain('users')
      expect(topics).toHaveLength(3)
    })

    it('removes topic from active list when last subscriber leaves', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      expect(manager.getActiveTopics()).toContain('orders')

      manager.removeConnection(connectionId)

      expect(manager.getActiveTopics()).not.toContain('orders')
    })
  })

  describe('isSubscribed()', () => {
    it('checks if connection is subscribed to a topic', async () => {
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders', 'payments'])

      expect(manager.isSubscribed(connectionId, 'orders')).toBe(true)
      expect(manager.isSubscribed(connectionId, 'payments')).toBe(true)
      expect(manager.isSubscribed(connectionId, 'users')).toBe(false)
    })

    it('returns false for non-existent connection', async () => {
      expect(manager.isSubscribed('non-existent', 'orders')).toBe(false)
    })
  })
})
