/**
 * FanOutManager Interface Tests (TDD GREEN Phase)
 *
 * Tests for the IFanOutManager interface extracted from EventStreamDO.
 * This component handles broadcasting messages to WebSocket connections by topic.
 *
 * @issue do-ogbp - FanOutManager Interface Tests
 * @wave Wave 3: EventStreamDO Decomposition
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { FanOutManager, type IFanOutManager, type BatchMessage } from '../event-stream/fan-out-manager'
import { ConnectionManager, type IConnectionManager } from '../event-stream/connection-manager'

// ============================================================================
// MOCK WEBSOCKET FOR TESTING
// ============================================================================

function createMockWebSocket(shouldFail = false): WebSocket {
  const sentMessages: string[] = []
  let isOpen = true

  const mock: any = {
    send: vi.fn((data: string) => {
      if (shouldFail) {
        throw new Error('WebSocket send failed')
      }
      sentMessages.push(data)
    }),
    close: vi.fn(() => {
      isOpen = false
    }),
    readyState: 1, // OPEN
    get isOpen() {
      return isOpen
    },
    _sentMessages: sentMessages,
  }

  return mock as WebSocket
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('FanOutManager', () => {
  let fanOut: IFanOutManager
  let connectionManager: IConnectionManager

  beforeEach(() => {
    connectionManager = new ConnectionManager()
    fanOut = new FanOutManager(connectionManager)
  })

  describe('broadcast()', () => {
    it('broadcasts to single topic', async () => {
      // Arrange
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['orders'])

      const message = { type: 'order.created', orderId: '123' }

      // Act
      const count = await fanOut.broadcast('orders', message)

      // Assert
      expect(count).toBe(2)
      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(message))
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(message))
    })

    it('broadcasts with wildcard matching', async () => {
      // Subscribers with wildcard pattern should receive messages
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      connectionManager.addConnection(ws1, ['orders.*'])  // Wildcard
      connectionManager.addConnection(ws2, ['orders.created'])  // Exact

      const message = { type: 'order.created', orderId: '123' }

      // Act
      const count = await fanOut.broadcast('orders.created', message)

      // Assert - both should receive (one via wildcard, one via exact)
      expect(count).toBe(2)
    })

    it('returns count of recipients', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['orders'])
      connectionManager.addConnection(ws3, ['payments'])  // Different topic

      const count = await fanOut.broadcast('orders', { event: 'test' })

      expect(count).toBe(2)  // Only 2 are subscribed to 'orders'
    })

    it('returns 0 for topic with no subscribers', async () => {
      const count = await fanOut.broadcast('nonexistent', { event: 'test' })
      expect(count).toBe(0)
    })

    it('serializes message as JSON', async () => {
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders'])

      const message = { nested: { data: [1, 2, 3] }, timestamp: 12345 }
      await fanOut.broadcast('orders', message)

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message))
    })

    it('handles string messages without re-serializing', async () => {
      // If message is already a string, don't double-serialize
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders'])

      const message = '{"already":"serialized"}'
      await fanOut.broadcast('orders', message)

      expect(ws.send).toHaveBeenCalledWith(message)
    })
  })

  describe('broadcastWithResult()', () => {
    it('returns detailed broadcast result', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket(true)  // This one will fail

      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['orders'])

      const result = await fanOut.broadcastWithResult('orders', { test: true })

      expect(result.delivered).toBe(1)
      expect(result.failed).toBe(1)
    })

    it('handles all successful deliveries', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['orders'])

      const result = await fanOut.broadcastWithResult('orders', { test: true })

      expect(result.delivered).toBe(2)
      expect(result.failed).toBe(0)
      expect(result.failedConnections).toHaveLength(0)
    })

    it('handles all failed deliveries', async () => {
      const ws1 = createMockWebSocket(true)
      const ws2 = createMockWebSocket(true)

      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['orders'])

      const result = await fanOut.broadcastWithResult('orders', { test: true })

      expect(result.delivered).toBe(0)
      expect(result.failed).toBe(2)
    })
  })

  describe('broadcastBatch()', () => {
    it('broadcasts multiple messages efficiently', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      connectionManager.addConnection(ws1, ['orders'])
      connectionManager.addConnection(ws2, ['payments'])
      connectionManager.addConnection(ws3, ['orders', 'payments'])

      const messages: BatchMessage[] = [
        { topic: 'orders', message: { orderId: '1' } },
        { topic: 'payments', message: { paymentId: '2' } },
      ]

      const count = await fanOut.broadcastBatch(messages)

      // ws1 gets orders (1), ws2 gets payments (1), ws3 gets both (2)
      // Total: 4 deliveries
      expect(count).toBe(4)
    })

    it('handles empty batch gracefully', async () => {
      const count = await fanOut.broadcastBatch([])
      expect(count).toBe(0)
    })

    it('deduplicates messages to same connection', async () => {
      // If same connection subscribes to multiple topics that all match,
      // it should only receive the message once per topic, not duplicated
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders', '*'])

      const messages: BatchMessage[] = [
        { topic: 'orders', message: { id: 1 } },
      ]

      await fanOut.broadcastBatch(messages)

      // Should only receive once, not twice
      expect((ws as any)._sentMessages).toHaveLength(1)
    })

    it('aggregates messages for efficient sending', async () => {
      // For same connection receiving multiple messages, each gets sent
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders'])

      const messages: BatchMessage[] = [
        { topic: 'orders', message: { id: 1 } },
        { topic: 'orders', message: { id: 2 } },
        { topic: 'orders', message: { id: 3 } },
      ]

      const count = await fanOut.broadcastBatch(messages)
      expect(count).toBe(3)
    })
  })

  describe('sendToConnection()', () => {
    it('sends to specific connection by ID', async () => {
      const ws = createMockWebSocket()
      const connectionId = connectionManager.addConnection(ws, ['orders'])

      const success = await fanOut.sendToConnection(connectionId, { direct: true })

      expect(success).toBe(true)
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ direct: true }))
    })

    it('returns false for non-existent connection', async () => {
      const success = await fanOut.sendToConnection('non-existent', { test: true })
      expect(success).toBe(false)
    })

    it('returns false when send fails', async () => {
      const ws = createMockWebSocket(true)  // Will fail
      const connectionId = connectionManager.addConnection(ws, ['orders'])

      const success = await fanOut.sendToConnection(connectionId, { test: true })
      expect(success).toBe(false)
    })
  })

  describe('sendToConnections()', () => {
    it('sends to multiple specific connections', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      const id1 = connectionManager.addConnection(ws1, ['a'])
      const id2 = connectionManager.addConnection(ws2, ['b'])
      connectionManager.addConnection(ws3, ['c'])

      const count = await fanOut.sendToConnections([id1, id2], { multicast: true })

      expect(count).toBe(2)
      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalled()
      expect(ws3.send).not.toHaveBeenCalled()
    })

    it('returns count of successful sends only', async () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket(true)  // Will fail

      const id1 = connectionManager.addConnection(ws1, ['a'])
      const id2 = connectionManager.addConnection(ws2, ['b'])

      const count = await fanOut.sendToConnections([id1, id2], { test: true })
      expect(count).toBe(1)  // Only ws1 succeeded
    })

    it('handles empty connection list', async () => {
      const count = await fanOut.sendToConnections([], { test: true })
      expect(count).toBe(0)
    })
  })

  describe('Wildcard Matching', () => {
    it('matches single-level wildcard (orders.*)', async () => {
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders.*'])

      // Matches single level after prefix
      expect(await fanOut.broadcast('orders.created', {})).toBe(1)
      expect(await fanOut.broadcast('orders.updated', {})).toBe(1)

      // Does not match (no dot)
      expect(await fanOut.broadcast('orders', {})).toBe(0)

      // Does not match (too deep)
      expect(await fanOut.broadcast('orders.item.added', {})).toBe(0)
    })

    it('matches multi-level wildcard (orders.**)', async () => {
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['orders.**'])

      // Matches all depths
      expect(await fanOut.broadcast('orders.created', {})).toBe(1)
      expect(await fanOut.broadcast('orders.item.added', {})).toBe(1)
      expect(await fanOut.broadcast('orders.item.quantity.updated', {})).toBe(1)
    })

    it('matches global wildcard (*)', async () => {
      const ws = createMockWebSocket()
      connectionManager.addConnection(ws, ['*'])

      // Matches everything
      expect(await fanOut.broadcast('orders', {})).toBe(1)
      expect(await fanOut.broadcast('payments.processed', {})).toBe(1)
      expect(await fanOut.broadcast('any.topic.here', {})).toBe(1)
    })
  })
})
