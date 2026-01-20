import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketManager, type ConnectionMetadata } from '../websocket'

/**
 * WebSocket Manager Tests
 *
 * These tests run in the Cloudflare Workers runtime via miniflare.
 * They test the WebSocketManager's internal state management without
 * requiring actual WebSocket upgrades (which need real HTTP requests).
 *
 * For integration tests that exercise full WebSocket upgrade flow,
 * see websocket-integration.test.ts
 */

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock DurableObjectState for testing
 * Uses real miniflare-provided APIs where possible
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  const websockets = new Map<string, Set<WebSocket>>()
  const allWebsockets = new Set<WebSocket>()

  return {
    id: { toString: () => 'test-ws-do-id' } as DurableObjectId,
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

/**
 * Creates a mock WebSocket for testing internal manager operations
 * This is used for testing methods that don't require real WebSocket upgrade
 */
function createMockWebSocket(): WebSocket {
  let readyState = 1 // OPEN
  const sentMessages: string[] = []

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
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // Expose sent messages for assertions
    _sentMessages: sentMessages,
  } as unknown as WebSocket & { _sentMessages: string[] }
}

// ============================================================================
// Message Routing Tests
// ============================================================================

describe('WebSocketManager - Message Routing', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  describe('message handlers', () => {
    it('should route messages to type-specific handlers', async () => {
      const handler = vi.fn()
      manager.on('chat.message', handler)

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'chat.message', data: { text: 'hello' } }))

      expect(handler).toHaveBeenCalledWith(ws, { text: 'hello' })
    })

    it('should support multiple handlers for same event type', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: { value: 1 } }))

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should support wildcard handlers', async () => {
      const handler = vi.fn()
      manager.on('*', handler)

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'any.event', data: {} }))

      expect(handler).toHaveBeenCalled()
    })

    it('should handle binary messages', async () => {
      const handler = vi.fn()
      manager.on('binary', handler)

      const ws = createMockWebSocket()
      const buffer = new ArrayBuffer(8)
      await manager.handleMessage(ws, buffer)

      expect(handler).toHaveBeenCalledWith(ws, buffer)
    })

    it('should handle malformed JSON gracefully', async () => {
      const ws = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

      // Should not throw
      await manager.handleMessage(ws, 'not valid json {')

      // Check if error was sent back
      expect(ws._sentMessages.some((msg: string) => msg.includes('error'))).toBe(true)
    })
  })

  describe('handler removal (off)', () => {
    it('should remove a handler when off is called', async () => {
      const handler = vi.fn()
      manager.on('test', handler)

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: { value: 1 } }))
      expect(handler).toHaveBeenCalledTimes(1)

      // Remove handler
      manager.off('test', handler)

      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: { value: 2 } }))
      // Handler should not be called again
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should not affect other handlers when one is removed', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      manager.off('test', handler1)

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should handle removing non-existent handler gracefully', () => {
      const handler = vi.fn()
      // Should not throw
      expect(() => manager.off('nonexistent', handler)).not.toThrow()
    })
  })

  describe('error handling in handlers', () => {
    it('should continue processing when a handler throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error')
      })
      const successHandler = vi.fn()

      manager.on('test', errorHandler)
      manager.on('test', successHandler)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

      expect(errorHandler).toHaveBeenCalled()
      expect(successHandler).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should handle async handler errors', async () => {
      const asyncErrorHandler = vi.fn(async () => {
        throw new Error('Async error')
      })
      const successHandler = vi.fn()

      manager.on('test', asyncErrorHandler)
      manager.on('test', successHandler)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const ws = createMockWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

      expect(asyncErrorHandler).toHaveBeenCalled()
      expect(successHandler).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// Broadcast Tests
// ============================================================================

describe('WebSocketManager - Broadcast', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    manager = new WebSocketManager()
    mockState = createMockState()
  })

  it('should broadcast message to all WebSockets with tag', () => {
    const ws1 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

    mockState.acceptWebSocket(ws1, ['chat'])
    mockState.acceptWebSocket(ws2, ['chat'])

    const result = manager.broadcast(mockState, 'chat', { type: 'hello', message: 'world' })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(ws1._sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
    expect(ws2._sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
  })

  it('should handle failed broadcasts gracefully', () => {
    const ws = createMockWebSocket()
    mockState.acceptWebSocket(ws, ['chat'])

    // Close the socket to simulate failure
    ws.close()

    const result = manager.broadcast(mockState, 'chat', { type: 'test' })

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('should broadcast to correct tag only', () => {
    const ws1 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

    mockState.acceptWebSocket(ws1, ['room:1'])
    mockState.acceptWebSocket(ws2, ['room:2'])

    manager.broadcast(mockState, 'room:1', { message: 'room1 only' })

    expect(ws1._sentMessages.length).toBe(1)
    expect(ws2._sentMessages.length).toBe(0)
  })

  it('should broadcast to all connections regardless of tag', () => {
    const ws1 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

    mockState.acceptWebSocket(ws1, ['room:1'])
    mockState.acceptWebSocket(ws2, ['room:2'])

    const result = manager.broadcastAll(mockState, { type: 'global', data: 'announcement' })

    expect(result.sent).toBe(2)
    expect(ws1._sentMessages.length).toBe(1)
    expect(ws2._sentMessages.length).toBe(1)
  })
})

// ============================================================================
// Connection Count Tests
// ============================================================================

describe('WebSocketManager - Connection Count', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    manager = new WebSocketManager()
    mockState = createMockState()
  })

  it('should track connection count', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()

    mockState.acceptWebSocket(ws1, ['chat'])
    mockState.acceptWebSocket(ws2, ['chat'])

    const count = manager.getConnectionCount(mockState)
    expect(count).toBe(2)
  })

  it('should track connections by tag', () => {
    const ws1 = createMockWebSocket()
    const ws2 = createMockWebSocket()
    const ws3 = createMockWebSocket()

    mockState.acceptWebSocket(ws1, ['room:1'])
    mockState.acceptWebSocket(ws2, ['room:1'])
    mockState.acceptWebSocket(ws3, ['room:2'])

    const room1Count = manager.getConnectionCount(mockState, 'room:1')
    const room2Count = manager.getConnectionCount(mockState, 'room:2')

    expect(room1Count).toBe(2)
    expect(room2Count).toBe(1)
  })
})

// ============================================================================
// Send to Specific Connection Tests
// ============================================================================

describe('WebSocketManager - Send', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should send message to specific WebSocket', () => {
    const ws = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

    const result = manager.send(ws, { type: 'direct', data: 'hello' })

    expect(result).toBe(true)
    expect(ws._sentMessages).toContain(JSON.stringify({ type: 'direct', data: 'hello' }))
  })

  it('should return false when sending to closed connection', () => {
    const ws = createMockWebSocket()
    ws.close() // CLOSED

    const result = manager.send(ws, { type: 'test' })

    expect(result).toBe(false)
  })
})

// ============================================================================
// Close Connection Tests
// ============================================================================

describe('WebSocketManager - Close Connection', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should close a specific WebSocket with code and reason', () => {
    const ws = createMockWebSocket()

    manager.closeConnection(ws, 1000, 'Normal closure')

    expect(ws.close).toHaveBeenCalledWith(1000, 'Normal closure')
  })
})

// ============================================================================
// Ping/Pong Tests
// ============================================================================

describe('WebSocketManager - Ping/Pong', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should send ping messages', () => {
    const ws = createMockWebSocket() as WebSocket & { _sentMessages: string[] }

    manager.sendPing(ws)

    expect(ws._sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)
  })

  it('should handle ping failure gracefully', () => {
    const ws = createMockWebSocket()
    ws.close() // CLOSED

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Should not throw
    expect(() => manager.sendPing(ws)).not.toThrow()

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// Heartbeat Interval Tests
// ============================================================================

describe('WebSocketManager - Heartbeat Interval', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new WebSocketManager()
    mockState = createMockState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start heartbeat and send pings at interval', () => {
    const ws = createMockWebSocket() as WebSocket & { _sentMessages: string[] }
    mockState.acceptWebSocket(ws, ['chat'])

    // Register the connection with the manager so it has activity time
    // We need to access private connections map since we're not using handleWebSocketUpgrade
    const connections = (manager as unknown as { connections: Map<WebSocket, unknown> }).connections
    connections.set(ws, {
      connectionId: 'test-conn',
      tags: ['chat'],
      hibernatable: false,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      reconnectCount: 0,
    })

    const intervalId = manager.startHeartbeat(mockState, 1000, 5000)

    // Advance time by one interval
    vi.advanceTimersByTime(1000)

    expect(ws._sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)

    manager.stopHeartbeat(intervalId)
  })

  it('should stop heartbeat when stopHeartbeat is called', () => {
    const ws = createMockWebSocket() as WebSocket & { _sentMessages: string[] }
    mockState.acceptWebSocket(ws, ['chat'])

    // Register the connection with the manager
    const connections = (manager as unknown as { connections: Map<WebSocket, unknown> }).connections
    connections.set(ws, {
      connectionId: 'test-conn',
      tags: ['chat'],
      hibernatable: false,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      reconnectCount: 0,
    })

    const intervalId = manager.startHeartbeat(mockState, 1000, 5000)
    manager.stopHeartbeat(intervalId)

    // Clear sent messages
    ws._sentMessages.length = 0
    vi.advanceTimersByTime(2000)

    expect(ws._sentMessages.length).toBe(0)
  })
})

// ============================================================================
// Internal State Management Tests
// ============================================================================

describe('WebSocketManager - Internal State', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return empty tags for unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.getTagsForWebSocket(ws)).toEqual([])
  })

  it('should return false for hibernatable check on unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.isHibernatable(ws)).toBe(false)
  })

  it('should return undefined connection ID for unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.getConnectionId(ws)).toBeUndefined()
  })

  it('should return undefined metadata for unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.getConnectionMetadata(ws)).toBeUndefined()
  })

  it('should return 0 for last pong on unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.getLastPong(ws)).toBe(0)
  })

  it('should handle setLastPong for unknown WebSocket gracefully', () => {
    const ws = createMockWebSocket()
    // Should not throw
    expect(() => manager.setLastPong(ws, Date.now())).not.toThrow()
  })

  it('should return false for hasConnection on unknown WebSocket', () => {
    const ws = createMockWebSocket()
    expect(manager.hasConnection(ws)).toBe(false)
  })

  it('should return empty array for getAllConnections when no connections', () => {
    expect(manager.getAllConnections()).toEqual([])
  })

  it('should return empty array for getConnectionsByTag when no connections', () => {
    expect(manager.getConnectionsByTag('any-tag')).toEqual([])
  })
})

// ============================================================================
// Tag Management Tests (without WebSocket upgrade)
// ============================================================================

describe('WebSocketManager - Tag Management', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return false when adding tag to non-existent connection', () => {
    const ws = createMockWebSocket()
    expect(manager.addConnectionTag(ws, 'tag')).toBe(false)
  })

  it('should return false when removing tag from non-existent connection', () => {
    const ws = createMockWebSocket()
    expect(manager.removeConnectionTag(ws, 'tag')).toBe(false)
  })

  it('should return false when updating tags on non-existent connection', () => {
    const ws = createMockWebSocket()
    expect(manager.updateConnectionTags(ws, ['tags'])).toBe(false)
  })
})

// ============================================================================
// Client ID Tests (without WebSocket upgrade)
// ============================================================================

describe('WebSocketManager - Client ID', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return undefined for unknown client ID', () => {
    expect(manager.getWebSocketByClientId('unknown')).toBeUndefined()
  })

  it('should return false when setting client ID on non-existent connection', () => {
    const ws = createMockWebSocket()
    expect(manager.setClientId(ws, 'client-id')).toBe(false)
  })
})

// ============================================================================
// Cleanup Tests
// ============================================================================

describe('WebSocketManager - Cleanup', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should handle cleanup of unknown WebSocket gracefully', () => {
    const ws = createMockWebSocket()
    // Should not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })

  it('should be idempotent - multiple cleanups should not throw', () => {
    const ws = createMockWebSocket()

    // First cleanup
    manager.cleanupWebSocket(ws)

    // Second cleanup should also not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })
})

// ============================================================================
// Error Logging Context Tests (do-grp5.2)
// ============================================================================

describe('WebSocketManager - Error Logging with Context', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    manager = new WebSocketManager()
    mockState = createMockState()
  })

  describe('handler errors log connection context', () => {
    it('should log connection ID when message handler throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Test handler error')
      })
      manager.on('test', errorHandler)

      // Register connection to get a connection ID
      const ws = createMockWebSocket()
      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_test_123',
        tags: ['test'],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
        clientId: 'client_abc',
      })

      const errorLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorLogs.push(args.join(' '))
      })

      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

      expect(errorLogs.some(log => log.includes('conn_test_123'))).toBe(true)
      expect(errorLogs.some(log => log.includes('messageType:'))).toBe(true)
      expect(errorLogs.some(log => log.includes('test'))).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should log connection ID when binary handler throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Binary handler error')
      })
      manager.on('binary', errorHandler)

      // Register connection
      const ws = createMockWebSocket()
      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_binary_456',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const errorLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorLogs.push(args.join(' '))
      })

      const buffer = new ArrayBuffer(16)
      await manager.handleMessage(ws, buffer)

      expect(errorLogs.some(log => log.includes('conn_binary_456'))).toBe(true)
      expect(errorLogs.some(log => log.includes('messageSize:'))).toBe(true)
      expect(errorLogs.some(log => log.includes('16'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('JSON parse errors log context', () => {
    it('should log connection ID and message preview on invalid JSON', async () => {
      const ws = createMockWebSocket()
      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_json_789',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      await manager.handleMessage(ws, '{"invalid json')

      expect(warnLogs.some(log => log.includes('conn_json_789'))).toBe(true)
      expect(warnLogs.some(log => log.includes('messagePreview:'))).toBe(true)
      expect(warnLogs.some(log => log.includes('Invalid JSON'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('send/broadcast errors log context', () => {
    it('should log connection ID when send fails', () => {
      const ws = createMockWebSocket()
      ws.close() // Close to force error

      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_send_fail',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      const result = manager.send(ws, { type: 'test' })

      expect(result).toBe(false)
      expect(warnLogs.some(log => log.includes('conn_send_fail'))).toBe(true)
      expect(warnLogs.some(log => log.includes('readyState:'))).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should log connection ID when broadcast fails for a connection', () => {
      const ws = createMockWebSocket()
      ws.close() // Close to force error

      mockState.acceptWebSocket(ws, ['room'])
      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_broadcast_fail',
        tags: ['room'],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      const result = manager.broadcast(mockState, 'room', { type: 'test' })

      expect(result.failed).toBe(1)
      expect(warnLogs.some(log => log.includes('conn_broadcast_fail'))).toBe(true)
      expect(warnLogs.some(log => log.includes('tag:'))).toBe(true)
      expect(warnLogs.some(log => log.includes('room'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('ping errors log context', () => {
    it('should log connection ID when ping fails', () => {
      const ws = createMockWebSocket()
      ws.close()

      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_ping_fail',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      manager.sendPing(ws)

      expect(warnLogs.some(log => log.includes('conn_ping_fail'))).toBe(true)
      expect(warnLogs.some(log => log.includes('readyState:'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('close connection errors log context', () => {
    it('should log connection ID and close parameters when close fails', () => {
      // Create a WebSocket that throws on close
      const ws = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(() => {
          throw new Error('Close failed')
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as WebSocket

      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_close_fail',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      manager.closeConnection(ws, 1001, 'Going away')

      expect(warnLogs.some(log => log.includes('conn_close_fail'))).toBe(true)
      expect(warnLogs.some(log => log.includes('code:'))).toBe(true)
      expect(warnLogs.some(log => log.includes('1001'))).toBe(true)
      expect(warnLogs.some(log => log.includes('reason:'))).toBe(true)
      expect(warnLogs.some(log => log.includes('Going away'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('stale connection close errors log context', () => {
    it('should log connection ID and stale duration when closing stale connection fails', () => {
      // Create a WebSocket that throws on close
      const ws = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(() => {
          throw new Error('Close failed')
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as WebSocket

      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_stale_fail',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now() - 120000, // 2 minutes ago
        lastActivityAt: Date.now() - 120000, // Very stale
        reconnectCount: 0,
        clientId: 'stale_client',
      })

      const warnLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnLogs.push(args.join(' '))
      })

      manager.closeStaleConnections(30000) // 30 second timeout

      expect(warnLogs.some(log => log.includes('conn_stale_fail'))).toBe(true)
      expect(warnLogs.some(log => log.includes('clientId:'))).toBe(true)
      expect(warnLogs.some(log => log.includes('stale_client'))).toBe(true)
      expect(warnLogs.some(log => log.includes('staleFor:'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('lifecycle handler errors log context', () => {
    it('should log connection ID and client ID when connect handler throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Connect handler failed')
      })
      manager.onConnect(errorHandler)

      const errorLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorLogs.push(args.join(' '))
      })

      // Trigger handleWebSocketUpgrade which calls notifyConnectHandlers
      manager.handleWebSocketUpgrade(mockState, ['room'], false, 'test_client_id')

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(errorLogs.some(log => log.includes('Connect handler error'))).toBe(true)
      expect(errorLogs.some(log => log.includes('test_client_id'))).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should log connection ID when disconnect handler throws', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Disconnect handler failed')
      })
      manager.onDisconnect(errorHandler)

      // First, create a connection
      const ws = createMockWebSocket()
      const connections = (manager as unknown as { connections: Map<WebSocket, ConnectionMetadata> }).connections
      connections.set(ws, {
        connectionId: 'conn_disconnect_test',
        tags: [],
        hibernatable: false,
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        reconnectCount: 0,
        clientId: 'disconnect_client',
      })

      const errorLogs: string[] = []
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorLogs.push(args.join(' '))
      })

      // Trigger cleanup which calls notifyDisconnectHandlers
      manager.cleanupWebSocket(ws)

      // Wait for async handlers
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(errorLogs.some(log => log.includes('Disconnect handler error'))).toBe(true)
      expect(errorLogs.some(log => log.includes('conn_disconnect_test'))).toBe(true)
      expect(errorLogs.some(log => log.includes('disconnect_client'))).toBe(true)

      consoleSpy.mockRestore()
    })
  })
})
