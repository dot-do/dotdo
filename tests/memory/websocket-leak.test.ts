/**
 * WebSocket Memory Leak Tests (RED Phase)
 *
 * Issue: do-eyw [MEM-1] WebSocket memory leak on abnormal disconnect
 *
 * These tests verify that WebSocket connections are properly cleaned up
 * when they disconnect, especially for abnormal disconnections (network errors,
 * client crashes, etc.) where the close event may not fire.
 *
 * Expected behavior:
 * 1. Closed connections should be removed from internal maps
 * 2. Connection count should decrease after disconnect
 * 3. No references should be held to closed WebSockets
 * 4. Memory should not grow with connect/disconnect cycles
 *
 * These tests should FAIL initially (RED phase) to demonstrate the bug.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WebSocketHub, SubscriptionManager } from '../../streaming/index'

// ============================================================================
// Mock WebSocket Factory
// ============================================================================

interface MockWebSocketOptions {
  readyState?: number
  id?: string
}

function createMockWebSocket(options: MockWebSocketOptions = {}): WebSocket {
  const { readyState = WebSocket.OPEN, id = crypto.randomUUID() } = options

  // Create a mock with a unique identifier for tracking
  const ws = {
    send: vi.fn(),
    close: vi.fn(() => {
      // Simulate close behavior - change readyState
      ;(ws as any).readyState = WebSocket.CLOSED
    }),
    readyState,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    binaryType: 'blob' as BinaryType,
    bufferedAmount: 0,
    extensions: '',
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    protocol: '',
    url: `ws://test/${id}`,
    // Custom property for test identification
    __testId: id,
  } as unknown as WebSocket & { __testId: string }

  return ws
}

/**
 * Create a WebSocket that simulates abnormal disconnect
 * (readyState becomes CLOSED without calling close event)
 */
function createAbnormallyClosedWebSocket(id?: string): WebSocket {
  const ws = createMockWebSocket({ id })
  // Simulate abnormal close - readyState changes but no event fired
  ;(ws as any).readyState = WebSocket.CLOSED
  return ws
}

// ============================================================================
// WebSocketHub Memory Leak Tests
// ============================================================================

describe('WebSocketHub Memory Leaks', () => {
  let hub: WebSocketHub

  beforeEach(() => {
    hub = new WebSocketHub()
  })

  describe('connection cleanup on normal disconnect', () => {
    it('disconnect() removes WebSocket from connections map', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)
      expect(hub.connectionCount).toBe(1)

      hub.disconnect(ws)
      expect(hub.connectionCount).toBe(0)
      expect(hub.connections.has(ws)).toBe(false)
    })

    it('disconnect() removes metadata reference', () => {
      const ws = createMockWebSocket()
      const metadata = { userId: 'user-1', largeData: new Array(10000).fill('x') }
      hub.connect(ws, metadata)

      hub.disconnect(ws)

      // Metadata should be cleared - no lingering reference
      expect(hub.getMetadata(ws)).toBeUndefined()
    })

    it('disconnect() cleans up all room memberships', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)
      hub.room.join(ws, 'room-1')
      hub.room.join(ws, 'room-2')
      hub.room.join(ws, 'room-3')

      hub.disconnect(ws)

      // All room memberships should be cleaned up
      expect(hub.room.count('room-1')).toBe(0)
      expect(hub.room.count('room-2')).toBe(0)
      expect(hub.room.count('room-3')).toBe(0)
    })
  })

  describe('BUG: stale connections not automatically cleaned up', () => {
    /**
     * This test demonstrates the memory leak bug:
     * When a WebSocket becomes CLOSED without disconnect() being called,
     * the connection remains in the hub's internal maps.
     *
     * Expected: Hub should automatically detect and remove stale connections
     * Actual: Stale connections remain until cleanupStale() is manually called
     */
    it('should automatically remove connections when readyState becomes CLOSED', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })

      hub.connect(ws1)
      hub.connect(ws2)
      expect(hub.connectionCount).toBe(2)

      // Simulate abnormal disconnect - readyState changes but no event fires
      ;(ws1 as any).readyState = WebSocket.CLOSED

      // BUG: The hub should detect that ws1 is closed and remove it
      // Currently it does NOT - this test should FAIL
      expect(hub.connectionCount).toBe(1)
      expect(hub.connections.has(ws1)).toBe(false)
    })

    it('should not hold references to closed WebSockets after broadcast', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })

      hub.connect(ws1)
      hub.connect(ws2)

      // Simulate abnormal disconnect
      ;(ws1 as any).readyState = WebSocket.CLOSED

      // Broadcast should skip closed connections AND remove them
      hub.broadcast({ type: 'test' })

      // BUG: After broadcast detects closed connection, it should clean up
      // Currently it only skips but doesn't remove - this test should FAIL
      expect(hub.connectionCount).toBe(1)
      expect(hub.connections.has(ws1)).toBe(false)
    })

    it('should clean up room memberships when connection becomes stale', () => {
      const ws = createMockWebSocket()
      hub.connect(ws)
      hub.room.join(ws, 'important-room')

      // Simulate abnormal disconnect
      ;(ws as any).readyState = WebSocket.CLOSED

      // BUG: Room should not contain stale connections
      // Currently stale connections remain in rooms - this test should FAIL
      expect(hub.room.count('important-room')).toBe(0)
      expect(hub.room.members('important-room')).not.toContain(ws)
    })
  })

  describe('BUG: memory growth with connect/disconnect cycles', () => {
    /**
     * This test simulates high-frequency connect/disconnect cycles
     * and verifies that memory is properly reclaimed.
     *
     * In a leaky implementation, internal maps will grow unboundedly.
     */
    it('should not leak memory with rapid connect/disconnect cycles', () => {
      const cycleCount = 1000

      for (let i = 0; i < cycleCount; i++) {
        const ws = createMockWebSocket({ id: `cycle-${i}` })
        hub.connect(ws, { cycleId: i, payload: new Array(100).fill(i) })
        hub.room.join(ws, `room-${i % 10}`)

        // Simulate abnormal disconnect (no event, just state change)
        ;(ws as any).readyState = WebSocket.CLOSED
      }

      // BUG: After 1000 cycles with abnormal disconnects, hub should have 0 connections
      // Currently connections accumulate - this test should FAIL
      expect(hub.connectionCount).toBe(0)
    })

    it('should maintain stable connection count with mixed normal/abnormal disconnects', () => {
      const connections: WebSocket[] = []

      // Connect 100 WebSockets
      for (let i = 0; i < 100; i++) {
        const ws = createMockWebSocket({ id: `ws-${i}` })
        hub.connect(ws)
        connections.push(ws)
      }

      expect(hub.connectionCount).toBe(100)

      // Disconnect 50 normally
      for (let i = 0; i < 50; i++) {
        hub.disconnect(connections[i])
      }

      expect(hub.connectionCount).toBe(50)

      // Simulate 30 abnormal disconnects (state change without event)
      for (let i = 50; i < 80; i++) {
        ;(connections[i] as any).readyState = WebSocket.CLOSED
      }

      // BUG: Hub should detect the 30 abnormal disconnects
      // Expected: 20 connections (50 disconnected + 30 abnormal = 80 gone, 20 remain)
      // Actual: Still shows 50 because abnormal disconnects aren't detected
      // This test should FAIL
      expect(hub.connectionCount).toBe(20)
    })
  })

  describe('BUG: room.broadcast does not clean up stale connections', () => {
    it('should remove stale connections discovered during room broadcast', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })
      const ws3 = createMockWebSocket({ id: 'ws-3' })

      hub.connect(ws1)
      hub.connect(ws2)
      hub.connect(ws3)

      hub.room.join(ws1, 'chat')
      hub.room.join(ws2, 'chat')
      hub.room.join(ws3, 'chat')

      // Simulate ws1 and ws2 abnormal disconnect
      ;(ws1 as any).readyState = WebSocket.CLOSED
      ;(ws2 as any).readyState = WebSocket.CLOSED

      // Broadcast to room - should detect and clean up stale connections
      hub.room.broadcast('chat', { message: 'hello' })

      // BUG: After broadcast detects stale connections, it should remove them
      // Currently it only skips - this test should FAIL
      expect(hub.room.count('chat')).toBe(1)
      expect(hub.connectionCount).toBe(1)
    })
  })

  describe('cleanupStale() effectiveness', () => {
    /**
     * Even though cleanupStale() exists, it requires manual invocation.
     * These tests verify it works when called, but the bug is that
     * it's not called automatically.
     */
    it('cleanupStale() should remove all closed connections', () => {
      const connections: WebSocket[] = []

      for (let i = 0; i < 50; i++) {
        const ws = createMockWebSocket({ id: `ws-${i}` })
        hub.connect(ws)
        connections.push(ws)
      }

      // Close half of them abnormally
      for (let i = 0; i < 25; i++) {
        ;(connections[i] as any).readyState = WebSocket.CLOSED
      }

      // Manual cleanup should work
      const removed = hub.cleanupStale()
      expect(removed).toBe(25)
      expect(hub.connectionCount).toBe(25)
    })

    it('cleanupStale() should clean up rooms for stale connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.room.join(ws1, 'room-a')
      hub.room.join(ws1, 'room-b')
      hub.room.join(ws2, 'room-a')

      // ws1 becomes stale
      ;(ws1 as any).readyState = WebSocket.CLOSED

      hub.cleanupStale()

      // Rooms should be cleaned
      expect(hub.room.count('room-a')).toBe(1)
      expect(hub.room.count('room-b')).toBe(0) // Should be removed as empty
    })
  })
})

// ============================================================================
// SubscriptionManager Memory Leak Tests
// ============================================================================

describe('SubscriptionManager Memory Leaks', () => {
  let manager: SubscriptionManager

  beforeEach(() => {
    manager = new SubscriptionManager()
  })

  describe('BUG: stale subscriptions not automatically cleaned up', () => {
    it('should automatically remove subscriptions when WebSocket becomes CLOSED', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })

      manager.subscribe(ws1, 'orders.created')
      manager.subscribe(ws2, 'orders.created')

      expect(manager.getSubscribers('orders.created')).toHaveLength(2)

      // Simulate abnormal disconnect
      ;(ws1 as any).readyState = WebSocket.CLOSED

      // BUG: Manager should detect and remove stale subscription
      // Currently it does NOT - this test should FAIL
      expect(manager.getSubscribers('orders.created')).toHaveLength(1)
      expect(manager.isSubscribed(ws1, 'orders.created')).toBe(false)
    })

    it('should clean up all topics when WebSocket becomes stale', () => {
      const ws = createMockWebSocket()

      manager.subscribe(ws, 'topic-1')
      manager.subscribe(ws, 'topic-2')
      manager.subscribe(ws, 'topic-3')

      expect(manager.getSubscriptions(ws)).toHaveLength(3)

      // Simulate abnormal disconnect
      ;(ws as any).readyState = WebSocket.CLOSED

      // BUG: All subscriptions for this ws should be removed
      // Currently they remain - this test should FAIL
      expect(manager.getSubscriptions(ws)).toHaveLength(0)
    })
  })

  describe('BUG: publish does not clean up stale subscribers', () => {
    it('should remove stale subscribers discovered during publish', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })

      manager.subscribe(ws1, 'events')
      manager.subscribe(ws2, 'events')

      // Simulate abnormal disconnect
      ;(ws1 as any).readyState = WebSocket.CLOSED

      // Publish should detect and clean up stale subscriber
      manager.publish('events', { data: 'test' })

      // BUG: After publish detects stale subscriber, it should remove it
      // Currently it only skips - this test should FAIL
      expect(manager.getSubscribers('events')).toHaveLength(1)
      expect(manager.isSubscribed(ws1, 'events')).toBe(false)
    })
  })

  describe('BUG: memory growth with subscribe/disconnect cycles', () => {
    it('should not leak memory with rapid subscribe/disconnect cycles', () => {
      const cycleCount = 500

      for (let i = 0; i < cycleCount; i++) {
        const ws = createMockWebSocket({ id: `cycle-${i}` })
        manager.subscribe(ws, 'high-volume-topic')
        manager.subscribe(ws, `topic-${i % 20}`)

        // Simulate abnormal disconnect
        ;(ws as any).readyState = WebSocket.CLOSED
      }

      // BUG: After 500 cycles, there should be 0 subscribers
      // Currently subscribers accumulate - this test should FAIL
      expect(manager.getSubscribers('high-volume-topic')).toHaveLength(0)
    })
  })

  describe('pattern subscriptions with stale connections', () => {
    it('should clean up stale connections from wildcard subscriptions', () => {
      const ws1 = createMockWebSocket({ id: 'ws-1' })
      const ws2 = createMockWebSocket({ id: 'ws-2' })

      manager.subscribe(ws1, 'orders.*')
      manager.subscribe(ws2, 'orders.**')

      // Simulate abnormal disconnect
      ;(ws1 as any).readyState = WebSocket.CLOSED

      // Publish to matching topic
      manager.publish('orders.created', { orderId: '123' })

      // BUG: Stale wildcard subscriber should be cleaned up
      // This test should FAIL
      expect(manager.getSubscribers('orders.*')).toHaveLength(0)
    })
  })
})

// ============================================================================
// Memory Reference Tests
// ============================================================================

describe('WebSocket Reference Cleanup', () => {
  describe('BUG: internal maps hold references to closed WebSockets', () => {
    it('WebSocketHub should not hold any reference to closed WebSocket', () => {
      const hub = new WebSocketHub()

      // Create WebSocket with trackable reference
      const ws = createMockWebSocket({ id: 'tracked-ws' })
      const metadata = { data: 'test', nested: { value: 123 } }

      hub.connect(ws, metadata)
      hub.room.join(ws, 'room-1')

      // Simulate abnormal disconnect
      ;(ws as any).readyState = WebSocket.CLOSED

      // Get all internal references (would need to access private fields in real impl)
      // For this test, we verify through public API that ws is not accessible

      // BUG: Hub should have no way to access the closed WebSocket
      // These checks verify the WebSocket is truly removed
      expect(hub.connections.has(ws)).toBe(false)
      expect(hub.getMetadata(ws)).toBeUndefined()
      expect(hub.room.members('room-1')).not.toContain(ws)
      expect(hub.room.rooms(ws)).toHaveLength(0)
    })

    it('SubscriptionManager should not hold any reference to closed WebSocket', () => {
      const manager = new SubscriptionManager()

      const ws = createMockWebSocket({ id: 'tracked-ws' })

      manager.subscribe(ws, 'topic-1')
      manager.subscribe(ws, 'topic-2')

      // Simulate abnormal disconnect
      ;(ws as any).readyState = WebSocket.CLOSED

      // BUG: Manager should have no way to access the closed WebSocket
      // These checks verify the WebSocket is truly removed
      expect(manager.getSubscriptions(ws)).toHaveLength(0)
      expect(manager.getSubscribers('topic-1')).not.toContain(ws)
      expect(manager.getSubscribers('topic-2')).not.toContain(ws)
      expect(manager.isSubscribed(ws, 'topic-1')).toBe(false)
    })
  })
})

// ============================================================================
// Concurrent Operation Tests
// ============================================================================

describe('Concurrent Connection Handling', () => {
  describe('BUG: race conditions in cleanup', () => {
    it('should handle rapid connect/disconnect without leaking', async () => {
      const hub = new WebSocketHub()
      const operations: Promise<void>[] = []

      // Simulate concurrent connects and disconnects
      for (let i = 0; i < 100; i++) {
        operations.push(
          (async () => {
            const ws = createMockWebSocket({ id: `concurrent-${i}` })
            hub.connect(ws)

            // Random delay to simulate real-world timing
            await new Promise((r) => setTimeout(r, Math.random() * 10))

            // Half disconnect normally, half abnormally
            if (i % 2 === 0) {
              hub.disconnect(ws)
            } else {
              ;(ws as any).readyState = WebSocket.CLOSED
            }
          })()
        )
      }

      await Promise.all(operations)

      // BUG: All connections should be cleaned up
      // Abnormal disconnects will leak - this test should FAIL
      expect(hub.connectionCount).toBe(0)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  describe('WebSocket state transitions', () => {
    it('should handle CONNECTING -> CLOSED transition', () => {
      const hub = new WebSocketHub()
      const ws = createMockWebSocket({ readyState: WebSocket.CONNECTING })

      hub.connect(ws)

      // WebSocket never opens, goes directly to CLOSED
      ;(ws as any).readyState = WebSocket.CLOSED

      // BUG: Should detect and clean up
      expect(hub.connectionCount).toBe(0)
    })

    it('should handle CLOSING state', () => {
      const hub = new WebSocketHub()
      const ws = createMockWebSocket()

      hub.connect(ws)

      // WebSocket is closing
      ;(ws as any).readyState = WebSocket.CLOSING

      // cleanupStale should treat CLOSING as stale
      const removed = hub.cleanupStale()
      expect(removed).toBe(1)
      expect(hub.connectionCount).toBe(0)
    })
  })

  describe('empty room cleanup', () => {
    it('should remove empty rooms after all members disconnect abnormally', () => {
      const hub = new WebSocketHub()
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      hub.connect(ws1)
      hub.connect(ws2)
      hub.room.join(ws1, 'ephemeral-room')
      hub.room.join(ws2, 'ephemeral-room')

      // Both disconnect abnormally
      ;(ws1 as any).readyState = WebSocket.CLOSED
      ;(ws2 as any).readyState = WebSocket.CLOSED

      // BUG: Room should be removed when all members are gone
      // Currently room persists with stale references - this test should FAIL
      expect(hub.room.count('ephemeral-room')).toBe(0)
    })
  })
})
