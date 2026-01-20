/**
 * Concurrent WebSocket Connection Tests
 *
 * Tests for:
 * 1. State isolation between multiple connections
 * 2. Proper cleanup on disconnect
 * 3. Reconnection scenario handling
 * 4. Connection lifecycle events (connect/disconnect)
 * 5. Multiple connections with same/different tags
 * 6. Concurrent message handling
 *
 * These tests run in the Cloudflare Workers runtime via miniflare.
 * They use a helper to manually register connections since we can't
 * do real WebSocket upgrades in unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketManager, type ConnectionMetadata, type ConnectionHandler } from '../websocket'

// ============================================================================
// Test Helpers
// ============================================================================

interface MockWebSocketEvent {
  code?: number
  reason?: string
  wasClean?: boolean
  data?: string | ArrayBuffer
}

type MockWebSocketEventHandler = (event: MockWebSocketEvent) => void

/**
 * Creates a mock WebSocket for testing
 */
function createMockWebSocket(): WebSocket & {
  _sentMessages: string[]
  closeCode?: number
  closeReason?: string
} {
  let readyState = 1 // OPEN
  const sentMessages: string[] = []
  let closeCode: number | undefined
  let closeReason: string | undefined

  return {
    get readyState() { return readyState },
    send: vi.fn((data: string) => {
      if (readyState !== 1) {
        throw new Error('WebSocket is not open')
      }
      sentMessages.push(data)
    }),
    close: vi.fn((code?: number, reason?: string) => {
      readyState = 3 // CLOSED
      closeCode = code
      closeReason = reason
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // Expose for assertions
    _sentMessages: sentMessages,
    get closeCode() { return closeCode },
    get closeReason() { return closeReason },
  } as unknown as WebSocket & {
    _sentMessages: string[]
    closeCode?: number
    closeReason?: string
  }
}

/**
 * Creates a mock DurableObjectState for testing
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  const websockets = new Map<string, Set<WebSocket>>()
  const allWebsockets = new Set<WebSocket>()

  return {
    id: { toString: () => 'test-concurrent-ws-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {
      allWebsockets.add(ws)
      const tagList = tags || []
      for (const tag of tagList) {
        if (!websockets.has(tag)) {
          websockets.set(tag, new Set())
        }
        websockets.get(tag)!.add(ws)
      }
    }),
    getWebSockets: vi.fn((tag?: string) => {
      if (tag) {
        return Array.from(websockets.get(tag) || [])
      }
      return Array.from(allWebsockets)
    }),
  } as unknown as DurableObjectState
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Helper to manually register a connection with the manager
 * This simulates what handleWebSocketUpgrade does internally
 */
function registerConnection(
  manager: WebSocketManager,
  ws: WebSocket,
  metadata: Partial<ConnectionMetadata>
): ConnectionMetadata {
  const fullMetadata: ConnectionMetadata = {
    connectionId: metadata.connectionId || `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    tags: metadata.tags || [],
    hibernatable: metadata.hibernatable || false,
    connectedAt: metadata.connectedAt || Date.now(),
    lastActivityAt: metadata.lastActivityAt || Date.now(),
    reconnectCount: metadata.reconnectCount || 0,
    clientId: metadata.clientId,
  }

  // Access private connections map via any cast (for testing only)
  const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
  connections.set(ws, fullMetadata)

  // Update clientConnections if clientId is provided
  if (fullMetadata.clientId) {
    const clientConnections = (manager as unknown as { clientConnections: Map<string, WebSocket> }).clientConnections
    clientConnections.set(fullMetadata.clientId, ws)
  }

  return fullMetadata
}

// ============================================================================
// State Isolation Tests
// ============================================================================

describe('State Isolation Between Connections', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should maintain separate metadata for each connection', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()
    const ws3 = createMockWebSocket()

    registerConnection(manager, ws1, { tags: ['room:A'], hibernatable: false })
    registerConnection(manager, ws2, { tags: ['room:B'], hibernatable: true })
    registerConnection(manager, ws3, { tags: ['room:C', 'admin'], hibernatable: false })

    // Get all connections
    const connections = manager.getAllConnections()
    expect(connections).toHaveLength(3)

    // Verify each connection has its own metadata
    const metadatas = connections.map(c => c.metadata)

    // All connection IDs should be unique
    const connectionIds = metadatas.map(m => m.connectionId)
    expect(new Set(connectionIds).size).toBe(3)

    // Tags should be isolated
    const tags = metadatas.map(m => m.tags)
    expect(tags).toContainEqual(['room:A'])
    expect(tags).toContainEqual(['room:B'])
    expect(tags).toContainEqual(['room:C', 'admin'])

    // Hibernatable status should be correct
    const hibernatables = metadatas.map(m => m.hibernatable)
    expect(hibernatables).toContain(false)
    expect(hibernatables).toContain(true)
  })

  it('should not share state between connections', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    registerConnection(manager, ws1, { tags: ['room:1'], clientId: 'client-1' })
    registerConnection(manager, ws2, { tags: ['room:2'], clientId: 'client-2' })

    // Modify metadata for one connection
    manager.updateConnectionTags(ws1, ['modified-tag'])

    // Other connection should not be affected
    const conn1Updated = manager.getConnectionMetadata(ws1)
    const conn2Check = manager.getConnectionMetadata(ws2)

    expect(conn1Updated?.tags).toEqual(['modified-tag'])
    expect(conn2Check?.tags).toEqual(['room:2'])
  })

  it('should track activity times separately per connection', async () => {
    const ws1 = createMockWebSocket()
    const now = Date.now()

    registerConnection(manager, ws1, {
      tags: ['room:1'],
      connectedAt: now,
      lastActivityAt: now,
    })

    await delay(10)

    const ws2 = createMockWebSocket()
    const later = Date.now()

    registerConnection(manager, ws2, {
      tags: ['room:2'],
      connectedAt: later,
      lastActivityAt: later,
    })

    // Verify connection times are different
    const meta1 = manager.getConnectionMetadata(ws1)!
    const meta2 = manager.getConnectionMetadata(ws2)!

    expect(meta1.connectedAt).toBeLessThan(meta2.connectedAt)

    // Update activity for ws1 only via message handling
    await manager.handleMessage(ws1, JSON.stringify({ type: 'test' }))

    const meta1After = manager.getConnectionMetadata(ws1)!
    const meta2After = manager.getConnectionMetadata(ws2)!

    expect(meta1After.lastActivityAt).toBeGreaterThanOrEqual(meta1.connectedAt)
    // ws2's activity should not have changed
    expect(meta2After.lastActivityAt).toBe(meta2.connectedAt)
  })
})

// ============================================================================
// Connection Lifecycle Tests
// ============================================================================

describe('Connection Lifecycle Events', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should notify disconnect handlers when connection is cleaned up', async () => {
    const disconnectEvents: Array<{ connectionId: string; metadata: ConnectionMetadata }> = []

    manager.onDisconnect(async (ws, connectionId, metadata) => {
      disconnectEvents.push({ connectionId, metadata: { ...metadata } })
    })

    const ws = createMockWebSocket()
    const metadata = registerConnection(manager, ws, { tags: ['test'] })

    manager.cleanupWebSocket(ws)
    await delay(10) // Allow async handlers to complete

    expect(disconnectEvents).toHaveLength(1)
    expect(disconnectEvents[0].connectionId).toBe(metadata.connectionId)
    expect(disconnectEvents[0].metadata.tags).toEqual(['test'])
  })

  it('should support multiple disconnect handlers', async () => {
    const handler1Calls: string[] = []
    const handler2Calls: string[] = []

    const handler1: ConnectionHandler = async (ws, connectionId) => {
      handler1Calls.push(connectionId)
    }
    const handler2: ConnectionHandler = async (ws, connectionId) => {
      handler2Calls.push(connectionId)
    }

    manager.onDisconnect(handler1)
    manager.onDisconnect(handler2)

    const ws = createMockWebSocket()
    const metadata = registerConnection(manager, ws, { tags: ['test'] })

    manager.cleanupWebSocket(ws)
    await delay(10)

    expect(handler1Calls).toHaveLength(1)
    expect(handler2Calls).toHaveLength(1)
    expect(handler1Calls[0]).toBe(metadata.connectionId)
    expect(handler2Calls[0]).toBe(metadata.connectionId)
  })

  it('should allow removing disconnect handlers', async () => {
    const calls: string[] = []

    const handler: ConnectionHandler = async (ws, connectionId) => {
      calls.push(connectionId)
    }

    manager.onDisconnect(handler)

    const ws1 = createMockWebSocket()
    registerConnection(manager, ws1, { tags: ['test1'] })
    manager.cleanupWebSocket(ws1)
    await delay(10)

    expect(calls).toHaveLength(1)

    // Remove handler
    manager.offDisconnect(handler)

    const ws2 = createMockWebSocket()
    registerConnection(manager, ws2, { tags: ['test2'] })
    manager.cleanupWebSocket(ws2)
    await delay(10)

    // Should still be 1 since handler was removed
    expect(calls).toHaveLength(1)
  })

  it('should handle errors in lifecycle handlers gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const successCalls: string[] = []

    manager.onDisconnect(async () => {
      throw new Error('Handler error')
    })
    manager.onDisconnect(async (ws, connectionId) => {
      successCalls.push(connectionId)
    })

    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'] })

    manager.cleanupWebSocket(ws)
    await delay(10)

    // Both handlers should have been called, error should be logged
    expect(consoleSpy).toHaveBeenCalled()
    expect(successCalls).toHaveLength(1)

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// Reconnection Tests
// ============================================================================

describe('Reconnection Handling', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should track client connections for lookup', () => {
    const clientId = 'user-123'
    const ws = createMockWebSocket()

    registerConnection(manager, ws, { tags: ['room:A'], clientId })

    const lookedUp = manager.getWebSocketByClientId(clientId)
    expect(lookedUp).toBe(ws)

    const metadata = manager.getConnectionMetadata(lookedUp!)
    expect(metadata?.clientId).toBe(clientId)
  })

  it('should maintain separate connections for different client IDs', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    registerConnection(manager, ws1, { tags: ['room:A'], clientId: 'client-1' })
    registerConnection(manager, ws2, { tags: ['room:A'], clientId: 'client-2' })

    const connections = manager.getAllConnections()
    expect(connections).toHaveLength(2)

    const clientIds = connections.map(c => c.metadata.clientId)
    expect(clientIds).toContain('client-1')
    expect(clientIds).toContain('client-2')
  })

  it('should handle setting client ID after connection', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['room:A'] })

    expect(manager.getConnectionMetadata(ws)?.clientId).toBeUndefined()

    // Set client ID
    const success = manager.setClientId(ws, 'late-assigned-id')
    expect(success).toBe(true)

    expect(manager.getConnectionMetadata(ws)?.clientId).toBe('late-assigned-id')
    expect(manager.getWebSocketByClientId('late-assigned-id')).toBe(ws)
  })

  it('should notify disconnect handlers on cleanup', async () => {
    const disconnectEvents: string[] = []

    manager.onDisconnect(async (ws, connectionId, metadata) => {
      disconnectEvents.push(metadata.clientId || 'unknown')
    })

    const clientId = 'reconnect-test'
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['room:A'], clientId })

    manager.cleanupWebSocket(ws)
    await delay(10)

    expect(disconnectEvents).toHaveLength(1)
    expect(disconnectEvents[0]).toBe(clientId)
  })

  it('should handle setClientId when replacing existing clientId', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'], clientId: 'initial-id' })

    // Set new client ID
    manager.setClientId(ws, 'new-id')

    expect(manager.getWebSocketByClientId('initial-id')).toBeUndefined()
    expect(manager.getWebSocketByClientId('new-id')).toBe(ws)
    expect(manager.getConnectionMetadata(ws)?.clientId).toBe('new-id')
  })
})

// ============================================================================
// Concurrent Connection Tests
// ============================================================================

describe('Concurrent Connection Management', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should handle many simultaneous connections', () => {
    const connectionCount = 100
    const websockets: WebSocket[] = []

    for (let i = 0; i < connectionCount; i++) {
      const ws = createMockWebSocket()
      websockets.push(ws)
      registerConnection(manager, ws, {
        tags: [`room:${i % 10}`],
        hibernatable: i % 2 === 0,
      })
    }

    const connections = manager.getAllConnections()
    expect(connections).toHaveLength(connectionCount)

    // Verify all connection IDs are unique
    const ids = connections.map(c => c.metadata.connectionId)
    expect(new Set(ids).size).toBe(connectionCount)
  })

  it('should correctly filter connections by tag', () => {
    // Create connections with various tags
    for (let i = 0; i < 10; i++) {
      const ws = createMockWebSocket()
      registerConnection(manager, ws, { tags: ['room:A'] })
    }
    for (let i = 0; i < 5; i++) {
      const ws = createMockWebSocket()
      registerConnection(manager, ws, { tags: ['room:B'] })
    }
    for (let i = 0; i < 3; i++) {
      const ws = createMockWebSocket()
      registerConnection(manager, ws, { tags: ['room:A', 'room:B'] })
    }

    const roomA = manager.getConnectionsByTag('room:A')
    const roomB = manager.getConnectionsByTag('room:B')

    expect(roomA).toHaveLength(13) // 10 + 3 with both tags
    expect(roomB).toHaveLength(8) // 5 + 3 with both tags
  })

  it('should handle concurrent message processing', async () => {
    const receivedMessages: Array<{ wsId: string; data: unknown }> = []

    manager.on('test', async (ws, data) => {
      const metadata = manager.getConnectionMetadata(ws)
      receivedMessages.push({ wsId: metadata?.connectionId || 'unknown', data })
      await delay(Math.random() * 10) // Simulate async work
    })

    // Create multiple connections
    const websockets: WebSocket[] = []
    for (let i = 0; i < 5; i++) {
      const ws = createMockWebSocket()
      websockets.push(ws)
      registerConnection(manager, ws, { tags: ['test'] })
    }

    // Send messages from all connections concurrently
    const messagePromises = websockets.flatMap((ws, i) =>
      Array.from({ length: 5 }, (_, j) =>
        manager.handleMessage(ws, JSON.stringify({
          type: 'test',
          data: { connection: i, message: j }
        }))
      )
    )

    await Promise.all(messagePromises)

    expect(receivedMessages).toHaveLength(25) // 5 connections * 5 messages
  })

  it('should handle rapid connect/disconnect cycles', async () => {
    const disconnectCalls: string[] = []

    manager.onDisconnect(async (ws, connectionId) => {
      disconnectCalls.push(connectionId)
    })

    const websockets: WebSocket[] = []

    // Rapidly create and destroy connections
    for (let i = 0; i < 20; i++) {
      const ws = createMockWebSocket()
      websockets.push(ws)
      registerConnection(manager, ws, { tags: ['rapid'] })

      const connections = manager.getAllConnections()
      if (connections.length > 5) {
        // Disconnect some connections
        const toRemove = connections.slice(0, Math.min(3, connections.length))
        for (const conn of toRemove) {
          manager.cleanupWebSocket(conn.ws)
        }
      }
    }

    await delay(50) // Allow handlers to complete

    expect(disconnectCalls.length).toBeGreaterThan(0)
  })

  it('should maintain proper cleanup when multiple connections are closed', () => {
    const websockets: WebSocket[] = []

    // Create connections
    for (let i = 0; i < 10; i++) {
      const ws = createMockWebSocket()
      websockets.push(ws)
      registerConnection(manager, ws, { tags: ['cleanup-test'], clientId: `client-${i}` })
    }

    expect(manager.getAllConnections()).toHaveLength(10)

    // Close all odd-numbered clients
    for (let i = 1; i < 10; i += 2) {
      const ws = manager.getWebSocketByClientId(`client-${i}`)
      if (ws) {
        manager.cleanupWebSocket(ws)
      }
    }

    expect(manager.getAllConnections()).toHaveLength(5)

    // Verify remaining are even-numbered
    const remaining = manager.getAllConnections()
    const remainingClientIds = remaining.map(c => c.metadata.clientId).sort()
    expect(remainingClientIds).toEqual(['client-0', 'client-2', 'client-4', 'client-6', 'client-8'])
  })
})

// ============================================================================
// Tag Management Tests
// ============================================================================

describe('Tag Management', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should support adding tags to existing connection', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['initial'] })

    manager.addConnectionTag(ws, 'added-tag')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toContain('initial')
    expect(metadata?.tags).toContain('added-tag')
  })

  it('should support removing tags from existing connection', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['tag1', 'tag2', 'tag3'] })

    manager.removeConnectionTag(ws, 'tag2')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['tag1', 'tag3'])
  })

  it('should support replacing all tags', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['old1', 'old2'] })

    manager.updateConnectionTags(ws, ['new1', 'new2', 'new3'])

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['new1', 'new2', 'new3'])
  })

  it('should not duplicate tags when adding existing tag', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['existing'] })

    manager.addConnectionTag(ws, 'existing')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['existing'])
  })

  it('should return false when modifying non-existent connection', () => {
    const fakeWs = createMockWebSocket()

    expect(manager.addConnectionTag(fakeWs, 'tag')).toBe(false)
    expect(manager.removeConnectionTag(fakeWs, 'tag')).toBe(false)
    expect(manager.updateConnectionTags(fakeWs, ['tags'])).toBe(false)
  })
})

// ============================================================================
// Stale Connection Tests
// ============================================================================

describe('Stale Connection Detection', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should detect stale connections based on activity', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'] })

    // Initially not stale
    expect(manager.isStale(ws, 60000)).toBe(false)

    // Advance time past timeout
    vi.advanceTimersByTime(61000)

    expect(manager.isStale(ws, 60000)).toBe(true)
  })

  it('should update activity on message', async () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'] })

    vi.advanceTimersByTime(30000)

    // Process a message
    await manager.handleMessage(ws, JSON.stringify({ type: 'test' }))

    // Should not be stale since activity was updated
    vi.advanceTimersByTime(30000)
    expect(manager.isStale(ws, 60000)).toBe(false)

    // But should be stale after another 31 seconds
    vi.advanceTimersByTime(31000)
    expect(manager.isStale(ws, 60000)).toBe(true)
  })

  it('should close all stale connections', () => {
    // Create multiple connections at different times
    const ws1 = createMockWebSocket()
    registerConnection(manager, ws1, { tags: ['test'] })

    vi.advanceTimersByTime(20000)
    const ws2 = createMockWebSocket()
    registerConnection(manager, ws2, { tags: ['test'] })

    vi.advanceTimersByTime(20000)
    const ws3 = createMockWebSocket()
    registerConnection(manager, ws3, { tags: ['test'] })

    expect(manager.getAllConnections()).toHaveLength(3)

    // Advance more time - first two should be stale after 45 more seconds
    vi.advanceTimersByTime(45000) // Total: 45s since last, 65s since second, 85s since first

    manager.closeStaleConnections(60000)

    // First two should be closed
    const remaining = manager.getAllConnections()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].ws).toBe(ws3)
  })
})

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should handle cleanup of already cleaned up connection', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'] })

    // First cleanup
    manager.cleanupWebSocket(ws)
    expect(manager.hasConnection(ws)).toBe(false)

    // Second cleanup should not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })

  it('should return undefined for non-existent connection metadata', () => {
    const fakeWs = createMockWebSocket()
    expect(manager.getConnectionMetadata(fakeWs)).toBeUndefined()
    expect(manager.getConnectionId(fakeWs)).toBeUndefined()
  })

  it('should handle empty message gracefully', async () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'] })

    // Empty string
    await expect(manager.handleMessage(ws, '')).resolves.not.toThrow()

    // Invalid JSON
    await expect(manager.handleMessage(ws, '{invalid')).resolves.not.toThrow()
  })

  it('should handle WebSocket with no tags', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: [] })

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual([])

    // Should still work with tag filtering (returns empty)
    const filtered = manager.getConnectionsByTag('any-tag')
    expect(filtered).toHaveLength(0)
  })

  it('should generate unique connection IDs across multiple managers', () => {
    const manager1 = new WebSocketManager()
    const manager2 = new WebSocketManager()

    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    const meta1 = registerConnection(manager1, ws1, { tags: ['test'] })
    const meta2 = registerConnection(manager2, ws2, { tags: ['test'] })

    // IDs should be unique (different timestamps/counters)
    expect(meta1.connectionId).not.toBe(meta2.connectionId)
  })

  it('should handle getLastPong for unknown connection', () => {
    const fakeWs = createMockWebSocket()
    expect(manager.getLastPong(fakeWs)).toBe(0)
  })

  it('should handle setLastPong for unknown connection', () => {
    const fakeWs = createMockWebSocket()
    // Should not throw
    expect(() => manager.setLastPong(fakeWs, Date.now())).not.toThrow()
  })
})

// ============================================================================
// Legacy Compatibility Tests
// ============================================================================

describe('Legacy Compatibility', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  it('should support getWebSocketTags with WebSocket argument', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    registerConnection(manager, ws1, { tags: ['tag1'] })
    registerConnection(manager, ws2, { tags: ['tag2'] })

    expect(manager.getWebSocketTags(ws1)).toEqual(['tag1'])
    expect(manager.getWebSocketTags(ws2)).toEqual(['tag2'])
  })

  it('should support isWebSocketHibernatable with WebSocket argument', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    registerConnection(manager, ws1, { tags: ['test1'], hibernatable: false })
    registerConnection(manager, ws2, { tags: ['test2'], hibernatable: true })

    expect(manager.isWebSocketHibernatable(ws1)).toBe(false)
    expect(manager.isWebSocketHibernatable(ws2)).toBe(true)
  })

  it('should support getTagsForWebSocket (alias for proper isolation)', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['proper-tag'] })

    expect(manager.getTagsForWebSocket(ws)).toEqual(['proper-tag'])
  })

  it('should support isHibernatable method', () => {
    const ws = createMockWebSocket()
    registerConnection(manager, ws, { tags: ['test'], hibernatable: true })

    expect(manager.isHibernatable(ws)).toBe(true)
  })
})
