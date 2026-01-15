/**
 * Server Socket Reverse Map Tests (TDD RED Phase)
 *
 * Tests verifying O(1) lookup of connection ID from server WebSocket
 * via a serverSocketToConnId reverse map.
 *
 * CONTEXT: Currently, looking up connection ID from a server socket requires
 * O(n) scan through the connections map. This test suite verifies a
 * serverSocketToConnId map is maintained for O(1) reverse lookup.
 *
 * @issue do-hp18 - RED: Server socket reverse map tests
 * @wave Wave 2: Performance Hardening
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  ConnectionManager,
  type IConnectionManager,
  type ConnectionInfo,
} from '../event-stream/connection-manager'

// ============================================================================
// MOCK WEBSOCKET FOR TESTING
// ============================================================================

function createMockWebSocket(): WebSocket {
  const handlers: Map<string, Set<(data: unknown) => void>> = new Map()
  let isOpen = true

  const mock: unknown = {
    send: vi.fn(),
    close: vi.fn(() => {
      isOpen = false
    }),
    addEventListener: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: (data: unknown) => void) => {
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
// EXTENDED INTERFACE FOR REVERSE MAP
// ============================================================================

/**
 * Extended interface that includes server socket reverse map operations.
 * This extends IConnectionManager with O(1) server socket lookup.
 */
interface IConnectionManagerWithReverseMap extends IConnectionManager {
  /**
   * Get connection ID from a WebSocket (O(1) lookup)
   * Works for both client and server sockets.
   *
   * @param ws - The WebSocket to look up
   * @returns Connection ID or undefined if not found
   */
  getConnectionIdBySocket(ws: WebSocket): string | undefined

  /**
   * Check if a reverse map entry exists for this socket (for testing)
   *
   * @param ws - The WebSocket to check
   * @returns true if the socket has a reverse map entry
   */
  hasReverseMapEntry(ws: WebSocket): boolean
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Server Socket Reverse Map', () => {
  let manager: IConnectionManagerWithReverseMap

  beforeEach(() => {
    // Cast to extended interface - tests will fail until implementation exists
    manager = new ConnectionManager() as unknown as IConnectionManagerWithReverseMap
  })

  describe('O(1) lookup of connId from server socket', () => {
    it('should provide getConnectionIdBySocket method', () => {
      // The method should exist on the manager
      expect(typeof manager.getConnectionIdBySocket).toBe('function')
    })

    it('should return connection ID for registered server socket in O(1)', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Act
      const retrievedId = manager.getConnectionIdBySocket(ws)

      // Assert - should find the connection ID without iteration
      expect(retrievedId).toBe(connectionId)
    })

    it('should return undefined for unregistered socket', () => {
      // Arrange
      const registeredWs = createMockWebSocket()
      const unregisteredWs = createMockWebSocket()
      manager.addConnection(registeredWs, ['orders'])

      // Act
      const retrievedId = manager.getConnectionIdBySocket(unregisteredWs)

      // Assert
      expect(retrievedId).toBeUndefined()
    })

    it('should handle multiple concurrent connections efficiently', () => {
      // Arrange - create many connections
      const sockets: WebSocket[] = []
      const connectionIds: string[] = []

      for (let i = 0; i < 100; i++) {
        const ws = createMockWebSocket()
        sockets.push(ws)
        connectionIds.push(manager.addConnection(ws, [`topic-${i}`]))
      }

      // Act & Assert - all lookups should return correct IDs
      for (let i = 0; i < sockets.length; i++) {
        const retrievedId = manager.getConnectionIdBySocket(sockets[i])
        expect(retrievedId).toBe(connectionIds[i])
      }
    })
  })

  describe('Reverse map maintained on connection', () => {
    it('should create reverse map entry when connection is added', () => {
      // Arrange
      const ws = createMockWebSocket()

      // Act
      manager.addConnection(ws, ['orders'])

      // Assert - reverse map entry should exist
      expect(manager.hasReverseMapEntry(ws)).toBe(true)
    })

    it('should maintain reverse map entry after subscription updates', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Act - modify subscriptions
      manager.updateSubscriptions(connectionId, ['payments', 'users'])

      // Assert - reverse map should still work
      expect(manager.getConnectionIdBySocket(ws)).toBe(connectionId)
      expect(manager.hasReverseMapEntry(ws)).toBe(true)
    })

    it('should maintain reverse map when adding subscriptions', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Act
      manager.addSubscriptions(connectionId, ['payments'])

      // Assert
      expect(manager.getConnectionIdBySocket(ws)).toBe(connectionId)
    })

    it('should maintain reverse map when removing subscriptions', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders', 'payments'])

      // Act
      manager.removeSubscriptions(connectionId, ['orders'])

      // Assert
      expect(manager.getConnectionIdBySocket(ws)).toBe(connectionId)
    })
  })

  describe('Reverse map cleaned on disconnect', () => {
    it('should remove reverse map entry when connection is removed', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Verify entry exists
      expect(manager.hasReverseMapEntry(ws)).toBe(true)

      // Act
      manager.removeConnection(connectionId)

      // Assert - reverse map entry should be removed
      expect(manager.hasReverseMapEntry(ws)).toBe(false)
      expect(manager.getConnectionIdBySocket(ws)).toBeUndefined()
    })

    it('should clean reverse map for multiple disconnections', () => {
      // Arrange
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      const id1 = manager.addConnection(ws1, ['a'])
      const id2 = manager.addConnection(ws2, ['b'])
      const id3 = manager.addConnection(ws3, ['c'])

      // Act - remove connections in different order
      manager.removeConnection(id2)
      manager.removeConnection(id1)

      // Assert
      expect(manager.hasReverseMapEntry(ws1)).toBe(false)
      expect(manager.hasReverseMapEntry(ws2)).toBe(false)
      expect(manager.hasReverseMapEntry(ws3)).toBe(true) // ws3 not removed
      expect(manager.getConnectionIdBySocket(ws3)).toBe(id3)
    })

    it('should handle removing non-existent connection gracefully', () => {
      // Should not throw and should not affect other entries
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Act - remove non-existent connection
      manager.removeConnection('non-existent-id')

      // Assert - existing connection should be unaffected
      expect(manager.hasReverseMapEntry(ws)).toBe(true)
      expect(manager.getConnectionIdBySocket(ws)).toBe(connectionId)
    })
  })

  describe('Bidirectional lookup consistency', () => {
    it('should maintain consistency between connections map and reverse map', () => {
      // Arrange
      const ws = createMockWebSocket()
      const connectionId = manager.addConnection(ws, ['orders'])

      // Assert - both lookups should be consistent
      const connectionInfo = manager.getConnection(connectionId)
      expect(connectionInfo).toBeDefined()
      expect(connectionInfo?.ws).toBe(ws)

      const retrievedId = manager.getConnectionIdBySocket(ws)
      expect(retrievedId).toBe(connectionId)
    })

    it('should maintain consistency after connection ID lookup', () => {
      // Arrange
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      const id1 = manager.addConnection(ws1, ['orders'])
      const id2 = manager.addConnection(ws2, ['payments'])

      // Assert bidirectional consistency for both connections
      expect(manager.getConnection(id1)?.ws).toBe(ws1)
      expect(manager.getConnection(id2)?.ws).toBe(ws2)
      expect(manager.getConnectionIdBySocket(ws1)).toBe(id1)
      expect(manager.getConnectionIdBySocket(ws2)).toBe(id2)
    })

    it('should maintain consistency during add/remove cycles', () => {
      // Arrange
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      // Add connections
      const id1 = manager.addConnection(ws1, ['a'])
      const id2 = manager.addConnection(ws2, ['b'])

      // Remove one
      manager.removeConnection(id1)

      // Add another
      const id3 = manager.addConnection(ws3, ['c'])

      // Assert consistency
      expect(manager.getConnectionIdBySocket(ws1)).toBeUndefined()
      expect(manager.getConnectionIdBySocket(ws2)).toBe(id2)
      expect(manager.getConnectionIdBySocket(ws3)).toBe(id3)

      expect(manager.getConnection(id1)).toBeUndefined()
      expect(manager.getConnection(id2)?.ws).toBe(ws2)
      expect(manager.getConnection(id3)?.ws).toBe(ws3)
    })

    it('should not have stale entries after rapid add/remove', () => {
      // Arrange - rapid add/remove cycles
      const sockets: WebSocket[] = []
      const activeIds = new Set<string>()

      for (let i = 0; i < 50; i++) {
        const ws = createMockWebSocket()
        sockets.push(ws)
        const id = manager.addConnection(ws, [`topic-${i}`])
        activeIds.add(id)
      }

      // Remove every other connection
      const removedIds: string[] = []
      for (let i = 0; i < sockets.length; i += 2) {
        const id = manager.getConnectionIdBySocket(sockets[i])!
        manager.removeConnection(id)
        activeIds.delete(id)
        removedIds.push(id)
      }

      // Assert - removed connections should not be in reverse map
      for (let i = 0; i < sockets.length; i += 2) {
        expect(manager.hasReverseMapEntry(sockets[i])).toBe(false)
        expect(manager.getConnectionIdBySocket(sockets[i])).toBeUndefined()
      }

      // Assert - remaining connections should be in reverse map
      for (let i = 1; i < sockets.length; i += 2) {
        expect(manager.hasReverseMapEntry(sockets[i])).toBe(true)
        const id = manager.getConnectionIdBySocket(sockets[i])
        expect(id).toBeDefined()
        expect(activeIds.has(id!)).toBe(true)
      }
    })

    it('should have same count in both directions', () => {
      // Arrange
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ws3 = createMockWebSocket()

      manager.addConnection(ws1, ['a'])
      manager.addConnection(ws2, ['b'])
      manager.addConnection(ws3, ['c'])

      // Assert - connection count should match reverse map entries
      expect(manager.getConnectionCount()).toBe(3)

      // Count reverse map entries
      let reverseMapCount = 0
      for (const ws of [ws1, ws2, ws3]) {
        if (manager.hasReverseMapEntry(ws)) reverseMapCount++
      }
      expect(reverseMapCount).toBe(3)

      // Remove one and verify counts
      const id1 = manager.getConnectionIdBySocket(ws1)!
      manager.removeConnection(id1)

      expect(manager.getConnectionCount()).toBe(2)

      reverseMapCount = 0
      for (const ws of [ws1, ws2, ws3]) {
        if (manager.hasReverseMapEntry(ws)) reverseMapCount++
      }
      expect(reverseMapCount).toBe(2)
    })
  })
})
