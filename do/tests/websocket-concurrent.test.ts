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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketManager, type ConnectionMetadata, type ConnectionHandler } from '../websocket'

// ============================================================================
// Mock Setup
// ============================================================================

class MockWebSocket {
  public readyState = 1 // OPEN
  private listeners = new Map<string, Set<(event: any) => void>>()
  public sentMessages: string[] = []
  public closeCode?: number
  public closeReason?: string

  send(data: string) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3 // CLOSED
    this.closeCode = code
    this.closeReason = reason
    this.dispatchEvent('close', { code, reason, wasClean: true })
  }

  addEventListener(event: string, handler: (event: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  removeEventListener(event: string, handler: (event: any) => void) {
    this.listeners.get(event)?.delete(handler)
  }

  dispatchEvent(event: string, data: any) {
    this.listeners.get(event)?.forEach(handler => handler(data))
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.dispatchEvent('message', { data })
  }
}

// Mock WebSocketPair globally
;(globalThis as any).WebSocketPair = class WebSocketPair {
  constructor() {
    return {
      0: new MockWebSocket(),
      1: new MockWebSocket(),
    }
  }
}

// Mock DurableObjectState with WebSocket support
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
    // Create multiple connections with different tags
    const response1 = manager.handleWebSocketUpgrade(mockState, ['room:A'], false)
    const response2 = manager.handleWebSocketUpgrade(mockState, ['room:B'], true)
    const response3 = manager.handleWebSocketUpgrade(mockState, ['room:C', 'admin'], false)

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
    // Create two connections
    manager.handleWebSocketUpgrade(mockState, ['room:1'], false, 'client-1')
    manager.handleWebSocketUpgrade(mockState, ['room:2'], true, 'client-2')

    const connections = manager.getAllConnections()
    const [conn1, conn2] = connections

    // Modify metadata for one connection
    manager.updateConnectionTags(conn1.ws, ['modified-tag'])

    // Other connection should not be affected
    const conn1Updated = manager.getConnectionMetadata(conn1.ws)
    const conn2Check = manager.getConnectionMetadata(conn2.ws)

    expect(conn1Updated?.tags).toEqual(['modified-tag'])
    expect(conn2Check?.tags).toEqual(['room:2'])
  })

  it('should track activity times separately per connection', async () => {
    // Create two connections
    manager.handleWebSocketUpgrade(mockState, ['room:1'], false)
    const connections1 = manager.getAllConnections()
    const ws1 = connections1[0].ws

    await delay(10)

    manager.handleWebSocketUpgrade(mockState, ['room:2'], false)
    const connections2 = manager.getAllConnections()
    const ws2 = connections2.find(c => c.metadata.tags.includes('room:2'))!.ws

    // Verify connection times are different
    const meta1 = manager.getConnectionMetadata(ws1)!
    const meta2 = manager.getConnectionMetadata(ws2)!

    expect(meta1.connectedAt).toBeLessThan(meta2.connectedAt)

    // Update activity for ws1 only
    await manager.handleMessage(ws1, JSON.stringify({ type: 'test' }))

    const meta1After = manager.getConnectionMetadata(ws1)!
    const meta2After = manager.getConnectionMetadata(ws2)!

    expect(meta1After.lastActivityAt).toBeGreaterThan(meta1.connectedAt)
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

  it('should notify connect handlers when new connection is made', async () => {
    const connectEvents: Array<{ connectionId: string; metadata: ConnectionMetadata }> = []

    manager.onConnect(async (ws, connectionId, metadata) => {
      connectEvents.push({ connectionId, metadata })
    })

    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    await delay(10) // Allow async handlers to complete

    expect(connectEvents).toHaveLength(1)
    expect(connectEvents[0].metadata.tags).toEqual(['test'])
  })

  it('should notify disconnect handlers when connection is cleaned up', async () => {
    const disconnectEvents: Array<{ connectionId: string; metadata: ConnectionMetadata }> = []

    manager.onDisconnect(async (ws, connectionId, metadata) => {
      disconnectEvents.push({ connectionId, metadata })
    })

    // Create and then cleanup a connection
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    const connections = manager.getAllConnections()
    const ws = connections[0].ws

    manager.cleanupWebSocket(ws)
    await delay(10) // Allow async handlers to complete

    expect(disconnectEvents).toHaveLength(1)
    expect(disconnectEvents[0].metadata.tags).toEqual(['test'])
  })

  it('should support multiple connect/disconnect handlers', async () => {
    const handler1Calls: string[] = []
    const handler2Calls: string[] = []

    const handler1: ConnectionHandler = async (ws, connectionId) => {
      handler1Calls.push(connectionId)
    }
    const handler2: ConnectionHandler = async (ws, connectionId) => {
      handler2Calls.push(connectionId)
    }

    manager.onConnect(handler1)
    manager.onConnect(handler2)

    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    await delay(10)

    expect(handler1Calls).toHaveLength(1)
    expect(handler2Calls).toHaveLength(1)
    expect(handler1Calls[0]).toBe(handler2Calls[0])
  })

  it('should allow removing connect/disconnect handlers', async () => {
    const calls: string[] = []

    const handler: ConnectionHandler = async (ws, connectionId) => {
      calls.push(connectionId)
    }

    manager.onConnect(handler)
    manager.handleWebSocketUpgrade(mockState, ['test1'], false)
    await delay(10)

    expect(calls).toHaveLength(1)

    // Remove handler
    manager.offConnect(handler)
    manager.handleWebSocketUpgrade(mockState, ['test2'], false)
    await delay(10)

    // Should still be 1 since handler was removed
    expect(calls).toHaveLength(1)
  })

  it('should handle errors in lifecycle handlers gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const successCalls: string[] = []

    manager.onConnect(async () => {
      throw new Error('Handler error')
    })
    manager.onConnect(async (ws, connectionId) => {
      successCalls.push(connectionId)
    })

    manager.handleWebSocketUpgrade(mockState, ['test'], false)
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

  it('should track reconnect count when client reconnects', () => {
    const clientId = 'user-123'

    // First connection
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    let connections = manager.getAllConnections()
    expect(connections[0].metadata.reconnectCount).toBe(0)

    // Second connection with same clientId
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    connections = manager.getAllConnections()
    // Only one connection should exist (old one closed)
    expect(connections).toHaveLength(1)
    expect(connections[0].metadata.reconnectCount).toBe(1)

    // Third connection
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    connections = manager.getAllConnections()
    expect(connections).toHaveLength(1)
    expect(connections[0].metadata.reconnectCount).toBe(2)
  })

  it('should close old connection when client reconnects', () => {
    const clientId = 'user-456'

    // First connection
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    const connections1 = manager.getAllConnections()
    const oldWs = connections1[0].ws as unknown as MockWebSocket

    // Second connection
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)

    // Old connection should be closed
    expect(oldWs.readyState).toBe(3) // CLOSED
    expect(oldWs.closeReason).toBe('Reconnected from another connection')
  })

  it('should maintain separate connections for different client IDs', () => {
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, 'client-1')
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, 'client-2')

    const connections = manager.getAllConnections()
    expect(connections).toHaveLength(2)

    const clientIds = connections.map(c => c.metadata.clientId)
    expect(clientIds).toContain('client-1')
    expect(clientIds).toContain('client-2')
  })

  it('should allow getting WebSocket by client ID', () => {
    const clientId = 'lookup-test'
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)

    const ws = manager.getWebSocketByClientId(clientId)
    expect(ws).toBeDefined()

    const metadata = manager.getConnectionMetadata(ws!)
    expect(metadata?.clientId).toBe(clientId)
  })

  it('should handle setting client ID after connection', () => {
    // Connect without client ID
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false)
    const connections = manager.getAllConnections()
    const ws = connections[0].ws

    expect(manager.getConnectionMetadata(ws)?.clientId).toBeUndefined()

    // Set client ID
    const success = manager.setClientId(ws, 'late-assigned-id')
    expect(success).toBe(true)

    expect(manager.getConnectionMetadata(ws)?.clientId).toBe('late-assigned-id')
    expect(manager.getWebSocketByClientId('late-assigned-id')).toBe(ws)
  })

  it('should notify disconnect handlers when reconnection closes old connection', async () => {
    const disconnectEvents: string[] = []

    manager.onDisconnect(async (ws, connectionId, metadata) => {
      disconnectEvents.push(metadata.clientId || 'unknown')
    })

    const clientId = 'reconnect-test'
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    await delay(10)

    // Reconnect
    manager.handleWebSocketUpgrade(mockState, ['room:A'], false, clientId)
    await delay(10)

    expect(disconnectEvents).toHaveLength(1)
    expect(disconnectEvents[0]).toBe(clientId)
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

    for (let i = 0; i < connectionCount; i++) {
      manager.handleWebSocketUpgrade(mockState, [`room:${i % 10}`], i % 2 === 0)
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
      manager.handleWebSocketUpgrade(mockState, ['room:A'], false)
    }
    for (let i = 0; i < 5; i++) {
      manager.handleWebSocketUpgrade(mockState, ['room:B'], false)
    }
    for (let i = 0; i < 3; i++) {
      manager.handleWebSocketUpgrade(mockState, ['room:A', 'room:B'], false)
    }

    const roomA = manager.getConnectionsByTag('room:A')
    const roomB = manager.getConnectionsByTag('room:B')

    expect(roomA).toHaveLength(13) // 10 + 3 with both tags
    expect(roomB).toHaveLength(8) // 5 + 3 with both tags
  })

  it('should handle concurrent message processing', async () => {
    const receivedMessages: Array<{ wsId: string; data: any }> = []

    manager.on('test', async (ws, data) => {
      const metadata = manager.getConnectionMetadata(ws)
      receivedMessages.push({ wsId: metadata?.connectionId || 'unknown', data })
      await delay(Math.random() * 10) // Simulate async work
    })

    // Create multiple connections
    for (let i = 0; i < 5; i++) {
      manager.handleWebSocketUpgrade(mockState, ['test'], false)
    }

    const connections = manager.getAllConnections()

    // Send messages from all connections concurrently
    const messagePromises = connections.flatMap((conn, i) =>
      Array.from({ length: 5 }, (_, j) =>
        manager.handleMessage(conn.ws, JSON.stringify({
          type: 'test',
          data: { connection: i, message: j }
        }))
      )
    )

    await Promise.all(messagePromises)

    expect(receivedMessages).toHaveLength(25) // 5 connections * 5 messages
  })

  it('should handle rapid connect/disconnect cycles', async () => {
    const connectCalls: string[] = []
    const disconnectCalls: string[] = []

    manager.onConnect(async (ws, connectionId) => {
      connectCalls.push(connectionId)
    })
    manager.onDisconnect(async (ws, connectionId) => {
      disconnectCalls.push(connectionId)
    })

    // Rapidly create and destroy connections
    for (let i = 0; i < 20; i++) {
      manager.handleWebSocketUpgrade(mockState, ['rapid'], false)
      const connections = manager.getAllConnections()
      if (connections.length > 5) {
        // Disconnect random connections
        const toRemove = connections.slice(0, Math.min(3, connections.length))
        for (const conn of toRemove) {
          manager.cleanupWebSocket(conn.ws)
        }
      }
    }

    await delay(50) // Allow handlers to complete

    expect(connectCalls.length).toBe(20)
    expect(disconnectCalls.length).toBeGreaterThan(0)
  })

  it('should maintain proper cleanup when multiple connections are closed', () => {
    // Create connections
    for (let i = 0; i < 10; i++) {
      manager.handleWebSocketUpgrade(mockState, ['cleanup-test'], false, `client-${i}`)
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
    const remainingClientIds = remaining.map(c => c.metadata.clientId)
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
    manager.handleWebSocketUpgrade(mockState, ['initial'], false)
    const ws = manager.getAllConnections()[0].ws

    manager.addConnectionTag(ws, 'added-tag')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toContain('initial')
    expect(metadata?.tags).toContain('added-tag')
  })

  it('should support removing tags from existing connection', () => {
    manager.handleWebSocketUpgrade(mockState, ['tag1', 'tag2', 'tag3'], false)
    const ws = manager.getAllConnections()[0].ws

    manager.removeConnectionTag(ws, 'tag2')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['tag1', 'tag3'])
  })

  it('should support replacing all tags', () => {
    manager.handleWebSocketUpgrade(mockState, ['old1', 'old2'], false)
    const ws = manager.getAllConnections()[0].ws

    manager.updateConnectionTags(ws, ['new1', 'new2', 'new3'])

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['new1', 'new2', 'new3'])
  })

  it('should not duplicate tags when adding existing tag', () => {
    manager.handleWebSocketUpgrade(mockState, ['existing'], false)
    const ws = manager.getAllConnections()[0].ws

    manager.addConnectionTag(ws, 'existing')

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual(['existing'])
  })

  it('should return false when modifying non-existent connection', () => {
    const fakeWs = new MockWebSocket() as unknown as WebSocket

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
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    const ws = manager.getAllConnections()[0].ws

    // Initially not stale
    expect(manager.isStale(ws, 60000)).toBe(false)

    // Advance time past timeout
    vi.advanceTimersByTime(61000)

    expect(manager.isStale(ws, 60000)).toBe(true)
  })

  it('should update activity on message', async () => {
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    const ws = manager.getAllConnections()[0].ws

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
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    vi.advanceTimersByTime(20000)
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    vi.advanceTimersByTime(20000)
    manager.handleWebSocketUpgrade(mockState, ['test'], false)

    expect(manager.getAllConnections()).toHaveLength(3)

    // Only first connection should be stale after 45 more seconds
    vi.advanceTimersByTime(45000) // Total: 45s since last, 65s since second, 85s since first

    manager.closeStaleConnections(60000)

    // First two should be closed
    const remaining = manager.getAllConnections()
    expect(remaining).toHaveLength(1)
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
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    const ws = manager.getAllConnections()[0].ws

    // First cleanup
    manager.cleanupWebSocket(ws)
    expect(manager.hasConnection(ws)).toBe(false)

    // Second cleanup should not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })

  it('should return undefined for non-existent connection metadata', () => {
    const fakeWs = new MockWebSocket() as unknown as WebSocket
    expect(manager.getConnectionMetadata(fakeWs)).toBeUndefined()
    expect(manager.getConnectionId(fakeWs)).toBeUndefined()
  })

  it('should handle empty message gracefully', async () => {
    manager.handleWebSocketUpgrade(mockState, ['test'], false)
    const ws = manager.getAllConnections()[0].ws

    // Empty string
    await expect(manager.handleMessage(ws, '')).resolves.not.toThrow()

    // Invalid JSON
    await expect(manager.handleMessage(ws, '{invalid')).resolves.not.toThrow()
  })

  it('should handle WebSocket with no tags', () => {
    manager.handleWebSocketUpgrade(mockState, [], false)
    const ws = manager.getAllConnections()[0].ws

    const metadata = manager.getConnectionMetadata(ws)
    expect(metadata?.tags).toEqual([])

    // Should still work with tag filtering (returns empty)
    const filtered = manager.getConnectionsByTag('any-tag')
    expect(filtered).toHaveLength(0)
  })

  it('should generate unique connection IDs across multiple managers', () => {
    const manager1 = new WebSocketManager()
    const manager2 = new WebSocketManager()

    manager1.handleWebSocketUpgrade(mockState, ['test'], false)
    manager2.handleWebSocketUpgrade(mockState, ['test'], false)

    const id1 = manager1.getAllConnections()[0].metadata.connectionId
    const id2 = manager2.getAllConnections()[0].metadata.connectionId

    // IDs should be unique (different timestamps/counters)
    expect(id1).not.toBe(id2)
  })

  it('should handle getLastPong for unknown connection', () => {
    const fakeWs = new MockWebSocket() as unknown as WebSocket
    expect(manager.getLastPong(fakeWs)).toBe(0)
  })

  it('should handle setLastPong for unknown connection', () => {
    const fakeWs = new MockWebSocket() as unknown as WebSocket
    // Should not throw
    expect(() => manager.setLastPong(fakeWs, Date.now())).not.toThrow()
  })

  it('should handle setClientId when replacing existing clientId', () => {
    manager.handleWebSocketUpgrade(mockState, ['test'], false, 'initial-id')
    const ws = manager.getAllConnections()[0].ws

    // Set new client ID
    manager.setClientId(ws, 'new-id')

    expect(manager.getWebSocketByClientId('initial-id')).toBeUndefined()
    expect(manager.getWebSocketByClientId('new-id')).toBe(ws)
    expect(manager.getConnectionMetadata(ws)?.clientId).toBe('new-id')
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

  it('should support getWebSocketTags without argument (legacy)', () => {
    manager.handleWebSocketUpgrade(mockState, ['legacy-tag'], false)

    // Legacy usage without passing WebSocket
    const tags = manager.getWebSocketTags()
    expect(tags).toEqual(['legacy-tag'])
  })

  it('should support getWebSocketTags with WebSocket argument', () => {
    manager.handleWebSocketUpgrade(mockState, ['tag1'], false)
    manager.handleWebSocketUpgrade(mockState, ['tag2'], false)

    const connections = manager.getAllConnections()
    const [conn1, conn2] = connections

    expect(manager.getWebSocketTags(conn1.ws)).toEqual(['tag1'])
    expect(manager.getWebSocketTags(conn2.ws)).toEqual(['tag2'])
  })

  it('should support isWebSocketHibernatable without argument (legacy)', () => {
    manager.handleWebSocketUpgrade(mockState, ['test'], true)

    const isHibernatable = manager.isWebSocketHibernatable()
    expect(isHibernatable).toBe(true)
  })

  it('should support isWebSocketHibernatable with WebSocket argument', () => {
    manager.handleWebSocketUpgrade(mockState, ['test1'], false)
    manager.handleWebSocketUpgrade(mockState, ['test2'], true)

    const connections = manager.getAllConnections()
    const nonHibernatable = connections.find(c => c.metadata.tags.includes('test1'))!
    const hibernatable = connections.find(c => c.metadata.tags.includes('test2'))!

    expect(manager.isWebSocketHibernatable(nonHibernatable.ws)).toBe(false)
    expect(manager.isWebSocketHibernatable(hibernatable.ws)).toBe(true)
  })

  it('should support getTagsForWebSocket (alias for proper isolation)', () => {
    manager.handleWebSocketUpgrade(mockState, ['proper-tag'], false)
    const ws = manager.getAllConnections()[0].ws

    expect(manager.getTagsForWebSocket(ws)).toEqual(['proper-tag'])
  })

  it('should support isHibernatable method', () => {
    manager.handleWebSocketUpgrade(mockState, ['test'], true)
    const ws = manager.getAllConnections()[0].ws

    expect(manager.isHibernatable(ws)).toBe(true)
  })
})
