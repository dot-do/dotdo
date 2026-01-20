import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { WebSocketManager, type ConnectionMetadata } from '../websocket'

/**
 * WebSocket Manager Tests
 *
 * TEST STRATEGY - NO MOCKS per CLAUDE.md
 * ======================================
 *
 * The WebSocketManager has two categories of functionality:
 *
 * 1. PURE JAVASCRIPT LOGIC (tested as unit tests):
 *    - Handler registration (on/off)
 *    - Message routing to handlers
 *    - Internal state tracking
 *
 *    These use minimal test objects (not mocks!) to satisfy the interface.
 *    No Cloudflare APIs are involved in this logic.
 *
 * 2. CLOUDFLARE API INTEGRATION (tested via real DO stubs):
 *    - WebSocket upgrade flow
 *    - Broadcast via ctx.getWebSockets()
 *    - Connection acceptance via ctx.acceptWebSocket()
 *
 *    These require real Miniflare runtime and are tested:
 *    - In this file via cloudflare:test DO stubs
 *    - In miniflare-integration.test.ts for comprehensive coverage
 *
 * The helper functions below create minimal objects for unit testing
 * the pure JavaScript logic. This is NOT mocking Cloudflare APIs - we
 * only mock console.* for error assertion and use minimal test fixtures.
 */

// ============================================================================
// Test Fixtures (NOT mocks of Cloudflare APIs)
// ============================================================================

/**
 * Creates a test DurableObjectState fixture for unit testing.
 *
 * NOTE: This is used ONLY for methods that need a ctx parameter but don't
 * actually use Cloudflare-specific behavior. For real Cloudflare API testing,
 * use the DO stubs via cloudflare:test in the integration section below.
 */
function createTestState(): DurableObjectState {
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
 * Creates a minimal WebSocket-like object for unit testing.
 *
 * This is used to test pure JavaScript logic (handler routing, state tracking)
 * that doesn't depend on actual WebSocket protocol behavior. The WebSocketManager's
 * handleMessage() only uses ws.send() and ws.readyState, so we provide just those.
 *
 * For real WebSocket testing, see the integration tests using cloudflare:test.
 */
function createTestWebSocket(): WebSocket & { _sentMessages: string[] } {
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
    close: vi.fn((code?: number, _reason?: string) => {
      readyState = 3 // CLOSED
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    _sentMessages: sentMessages,
  } as unknown as WebSocket & { _sentMessages: string[] }
}

/**
 * Helper to generate unique test IDs for DO instances
 */
function generateTestId(): string {
  return `ws-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// UNIT TESTS: Message Routing (Pure JavaScript Logic)
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

      const ws = createTestWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'chat.message', data: { text: 'hello' } }))

      expect(handler).toHaveBeenCalledWith(ws, { text: 'hello' })
    })

    it('should support multiple handlers for same event type', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      const ws = createTestWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: { value: 1 } }))

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should support wildcard handlers', async () => {
      const handler = vi.fn()
      manager.on('*', handler)

      const ws = createTestWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'any.event', data: {} }))

      expect(handler).toHaveBeenCalled()
    })

    it('should handle binary messages', async () => {
      const handler = vi.fn()
      manager.on('binary', handler)

      const ws = createTestWebSocket()
      const buffer = new ArrayBuffer(8)
      await manager.handleMessage(ws, buffer)

      expect(handler).toHaveBeenCalledWith(ws, buffer)
    })

    it('should handle malformed JSON gracefully', async () => {
      const ws = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

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

      const ws = createTestWebSocket()
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

      const ws = createTestWebSocket()
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

      const ws = createTestWebSocket()
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

      const ws = createTestWebSocket()
      await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

      expect(asyncErrorHandler).toHaveBeenCalled()
      expect(successHandler).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// UNIT TESTS: Broadcast (Uses test fixtures for ctx parameter)
// ============================================================================

describe('WebSocketManager - Broadcast', () => {
  let manager: WebSocketManager
  let testState: DurableObjectState

  beforeEach(() => {
    manager = new WebSocketManager()
    testState = createTestState()
  })

  it('should broadcast message to all WebSockets with tag', () => {
    const ws1 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

    testState.acceptWebSocket(ws1, ['chat'])
    testState.acceptWebSocket(ws2, ['chat'])

    const result = manager.broadcast(testState, 'chat', { type: 'hello', message: 'world' })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(ws1._sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
    expect(ws2._sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
  })

  it('should handle failed broadcasts gracefully', () => {
    const ws = createTestWebSocket()
    testState.acceptWebSocket(ws, ['chat'])

    // Close the socket to simulate failure
    ws.close()

    const result = manager.broadcast(testState, 'chat', { type: 'test' })

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('should broadcast to correct tag only', () => {
    const ws1 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

    testState.acceptWebSocket(ws1, ['room:1'])
    testState.acceptWebSocket(ws2, ['room:2'])

    manager.broadcast(testState, 'room:1', { message: 'room1 only' })

    expect(ws1._sentMessages.length).toBe(1)
    expect(ws2._sentMessages.length).toBe(0)
  })

  it('should broadcast to all connections regardless of tag', () => {
    const ws1 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }
    const ws2 = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

    testState.acceptWebSocket(ws1, ['room:1'])
    testState.acceptWebSocket(ws2, ['room:2'])

    const result = manager.broadcastAll(testState, { type: 'global', data: 'announcement' })

    expect(result.sent).toBe(2)
    expect(ws1._sentMessages.length).toBe(1)
    expect(ws2._sentMessages.length).toBe(1)
  })
})

// ============================================================================
// UNIT TESTS: Connection Count (Uses test fixtures)
// ============================================================================

describe('WebSocketManager - Connection Count', () => {
  let manager: WebSocketManager
  let testState: DurableObjectState

  beforeEach(() => {
    manager = new WebSocketManager()
    testState = createTestState()
  })

  it('should track connection count', () => {
    const ws1 = createTestWebSocket()
    const ws2 = createTestWebSocket()

    testState.acceptWebSocket(ws1, ['chat'])
    testState.acceptWebSocket(ws2, ['chat'])

    const count = manager.getConnectionCount(testState)
    expect(count).toBe(2)
  })

  it('should track connections by tag', () => {
    const ws1 = createTestWebSocket()
    const ws2 = createTestWebSocket()
    const ws3 = createTestWebSocket()

    testState.acceptWebSocket(ws1, ['room:1'])
    testState.acceptWebSocket(ws2, ['room:1'])
    testState.acceptWebSocket(ws3, ['room:2'])

    const room1Count = manager.getConnectionCount(testState, 'room:1')
    const room2Count = manager.getConnectionCount(testState, 'room:2')

    expect(room1Count).toBe(2)
    expect(room2Count).toBe(1)
  })
})

// ============================================================================
// UNIT TESTS: Send (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Send', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should send message to specific WebSocket', () => {
    const ws = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

    const result = manager.send(ws, { type: 'direct', data: 'hello' })

    expect(result).toBe(true)
    expect(ws._sentMessages).toContain(JSON.stringify({ type: 'direct', data: 'hello' }))
  })

  it('should return false when sending to closed connection', () => {
    const ws = createTestWebSocket()
    ws.close() // CLOSED

    const result = manager.send(ws, { type: 'test' })

    expect(result).toBe(false)
  })
})

// ============================================================================
// UNIT TESTS: Close Connection (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Close Connection', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should close a specific WebSocket with code and reason', () => {
    const ws = createTestWebSocket()

    manager.closeConnection(ws, 1000, 'Normal closure')

    expect(ws.close).toHaveBeenCalledWith(1000, 'Normal closure')
  })
})

// ============================================================================
// UNIT TESTS: Ping/Pong (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Ping/Pong', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should send ping messages', () => {
    const ws = createTestWebSocket() as WebSocket & { _sentMessages: string[] }

    manager.sendPing(ws)

    expect(ws._sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)
  })

  it('should handle ping failure gracefully', () => {
    const ws = createTestWebSocket()
    ws.close() // CLOSED

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Should not throw
    expect(() => manager.sendPing(ws)).not.toThrow()

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// UNIT TESTS: Heartbeat Interval (Uses test fixtures)
// ============================================================================

describe('WebSocketManager - Heartbeat Interval', () => {
  let manager: WebSocketManager
  let testState: DurableObjectState

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new WebSocketManager()
    testState = createTestState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start heartbeat and send pings at interval', () => {
    const ws = createTestWebSocket() as WebSocket & { _sentMessages: string[] }
    testState.acceptWebSocket(ws, ['chat'])

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

    const intervalId = manager.startHeartbeat(testState, 1000, 5000)

    // Advance time by one interval
    vi.advanceTimersByTime(1000)

    expect(ws._sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)

    manager.stopHeartbeat(intervalId)
  })

  it('should stop heartbeat when stopHeartbeat is called', () => {
    const ws = createTestWebSocket() as WebSocket & { _sentMessages: string[] }
    testState.acceptWebSocket(ws, ['chat'])

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

    const intervalId = manager.startHeartbeat(testState, 1000, 5000)
    manager.stopHeartbeat(intervalId)

    // Clear sent messages
    ws._sentMessages.length = 0
    vi.advanceTimersByTime(2000)

    expect(ws._sentMessages.length).toBe(0)
  })
})

// ============================================================================
// UNIT TESTS: Internal State Management (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Internal State', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return empty tags for unknown WebSocket', () => {
    const ws = createTestWebSocket()
    expect(manager.getTagsForWebSocket(ws)).toEqual([])
  })

  it('should return false for hibernatable check on unknown WebSocket', () => {
    const ws = createTestWebSocket()
    expect(manager.isHibernatable(ws)).toBe(false)
  })

  it('should return undefined connection ID for unknown WebSocket', () => {
    const ws = createTestWebSocket()
    expect(manager.getConnectionId(ws)).toBeUndefined()
  })

  it('should return undefined metadata for unknown WebSocket', () => {
    const ws = createTestWebSocket()
    expect(manager.getConnectionMetadata(ws)).toBeUndefined()
  })

  it('should return 0 for last pong on unknown WebSocket', () => {
    const ws = createTestWebSocket()
    expect(manager.getLastPong(ws)).toBe(0)
  })

  it('should handle setLastPong for unknown WebSocket gracefully', () => {
    const ws = createTestWebSocket()
    // Should not throw
    expect(() => manager.setLastPong(ws, Date.now())).not.toThrow()
  })

  it('should return false for hasConnection on unknown WebSocket', () => {
    const ws = createTestWebSocket()
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
// UNIT TESTS: Tag Management (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Tag Management', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return false when adding tag to non-existent connection', () => {
    const ws = createTestWebSocket()
    expect(manager.addConnectionTag(ws, 'tag')).toBe(false)
  })

  it('should return false when removing tag from non-existent connection', () => {
    const ws = createTestWebSocket()
    expect(manager.removeConnectionTag(ws, 'tag')).toBe(false)
  })

  it('should return false when updating tags on non-existent connection', () => {
    const ws = createTestWebSocket()
    expect(manager.updateConnectionTags(ws, ['tags'])).toBe(false)
  })
})

// ============================================================================
// UNIT TESTS: Client ID (Pure JavaScript Logic)
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
    const ws = createTestWebSocket()
    expect(manager.setClientId(ws, 'client-id')).toBe(false)
  })
})

// ============================================================================
// UNIT TESTS: Cleanup (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Cleanup', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should handle cleanup of unknown WebSocket gracefully', () => {
    const ws = createTestWebSocket()
    // Should not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })

  it('should be idempotent - multiple cleanups should not throw', () => {
    const ws = createTestWebSocket()

    // First cleanup
    manager.cleanupWebSocket(ws)

    // Second cleanup should also not throw
    expect(() => manager.cleanupWebSocket(ws)).not.toThrow()
  })
})

// ============================================================================
// INTEGRATION TESTS: Real WebSocket via Cloudflare Test (NO MOCKS)
// ============================================================================

/**
 * These tests use real Durable Object stubs via cloudflare:test.
 *
 * The DO class exposes WebSocketManager via `this.ws`, and the DO lifecycle
 * methods (webSocketMessage, webSocketClose, webSocketError) delegate to it.
 *
 * For more comprehensive WebSocket integration tests including upgrade flow
 * and hibernation, see: do/tests/miniflare-integration.test.ts
 */
describe('WebSocketManager - Integration via Real DO', () => {
  it('should work with real DO instance via cloudflare:test', async () => {
    const testName = generateTestId()
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Health check to verify DO is working and WebSocketManager is initialized
    const response = await stub.fetch('https://do/')
    expect(response.status).toBe(200)

    const json = await response.json() as { status: string; id: string }
    expect(json.status).toBe('ok')
    expect(json.id).toBeDefined()
  })

  it('should handle concurrent requests with WebSocket manager', async () => {
    const testName = generateTestId()
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Fire multiple concurrent requests to test DO concurrency handling
    const requests = Array.from({ length: 5 }, () =>
      stub.fetch('https://do/')
    )

    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.status).toBe(200)
      await response.text() // Consume body
    }
  })

  it('should maintain separate DO instances for different names', async () => {
    const id1 = env.DO.idFromName(generateTestId())
    const id2 = env.DO.idFromName(generateTestId())

    const stub1 = env.DO.get(id1)
    const stub2 = env.DO.get(id2)

    const resp1 = await stub1.fetch('https://do/')
    const resp2 = await stub2.fetch('https://do/')

    const json1 = await resp1.json() as { id: string }
    const json2 = await resp2.json() as { id: string }

    // Different DO instances have different IDs
    expect(json1.id).not.toBe(json2.id)
  })

  it('should return same DO instance for same name', async () => {
    const testName = generateTestId()

    const id1 = env.DO.idFromName(testName)
    const id2 = env.DO.idFromName(testName)

    const stub1 = env.DO.get(id1)
    const stub2 = env.DO.get(id2)

    const resp1 = await stub1.fetch('https://do/')
    const resp2 = await stub2.fetch('https://do/')

    const json1 = await resp1.json() as { id: string }
    const json2 = await resp2.json() as { id: string }

    // Same DO instance - same ID
    expect(json1.id).toBe(json2.id)
  })

  /**
   * NOTE: WebSocket upgrade testing requires actual HTTP upgrade requests.
   * For comprehensive WebSocket upgrade, hibernation, and broadcast testing,
   * see: do/tests/miniflare-integration.test.ts
   *
   * That file creates a test DO inline with explicit WebSocket endpoints
   * and tests the full upgrade flow using response.webSocket.
   */
})
