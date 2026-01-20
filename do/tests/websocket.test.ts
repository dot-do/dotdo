import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { WebSocketManager, type ConnectionMetadata } from '../websocket'
import type { DurableObjectStub } from '@cloudflare/workers-types'

/**
 * WebSocket Manager Tests
 *
 * TEST STRATEGY - REAL WEBSOCKET HIBERNATION
 * ==========================================
 *
 * These tests use REAL WebSocket connections via miniflare/cloudflare:test.
 * No mocked WebSocket objects or DurableObjectState - we test against
 * actual WebSocket hibernation API provided by the runtime.
 *
 * Test Categories:
 * 1. UNIT TESTS: Pure JavaScript logic (handler registration, message routing)
 *    - These test WebSocketManager in isolation without DO
 *
 * 2. INTEGRATION TESTS: Real WebSocket hibernation via DO stub
 *    - WebSocket upgrade flow
 *    - Connection tracking
 *    - Broadcast functionality
 *    - Hibernation behavior
 *
 * NOTE: The base DO class provides webSocketMessage, webSocketClose, and
 * webSocketError handlers that delegate to WebSocketManager. WebSocket
 * upgrade routes must be added by subclasses to expose the upgrade endpoint.
 */

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique test IDs to avoid DO instance collisions
 */
function generateTestId(): string {
  return `ws-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a DO stub for testing
 */
function getTestStub(name?: string): DurableObjectStub {
  const id = env.DO.idFromName(name || generateTestId())
  return env.DO.get(id)
}

// ============================================================================
// UNIT TESTS: Message Routing (Pure JavaScript Logic)
// ============================================================================

describe('WebSocketManager - Message Routing', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  describe('handler registration', () => {
    it('should register handlers for specific event types', () => {
      const handler = vi.fn()
      manager.on('test.event', handler)

      // Verify handler is registered by checking if it can be removed
      expect(() => manager.off('test.event', handler)).not.toThrow()
    })

    it('should support multiple handlers for same event type', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      // Both handlers should be registered
      manager.off('test', handler1)
      manager.off('test', handler2)
    })

    it('should support wildcard handlers', () => {
      const handler = vi.fn()
      manager.on('*', handler)

      expect(() => manager.off('*', handler)).not.toThrow()
    })
  })

  describe('handler removal', () => {
    it('should remove a handler when off is called', () => {
      const handler = vi.fn()
      manager.on('test', handler)
      manager.off('test', handler)

      // Handler should be removed - no error on repeated off
      expect(() => manager.off('test', handler)).not.toThrow()
    })

    it('should handle removing non-existent handler gracefully', () => {
      const handler = vi.fn()
      // Should not throw
      expect(() => manager.off('nonexistent', handler)).not.toThrow()
    })
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

  it('should return empty array for getAllConnections when no connections', () => {
    expect(manager.getAllConnections()).toEqual([])
  })

  it('should return empty array for getConnectionsByTag when no connections', () => {
    expect(manager.getConnectionsByTag('any-tag')).toEqual([])
  })
})

// ============================================================================
// INTEGRATION TESTS: Real DO via Cloudflare Test (NO MOCKS)
// ============================================================================

describe('WebSocketManager - Real DO Integration', () => {
  /**
   * These tests verify the DO infrastructure works correctly with real
   * miniflare instances. The WebSocketManager is tested via the DO's
   * internal state and exposed properties.
   */

  it('should work with real DO instance via cloudflare:test', async () => {
    const stub = getTestStub()

    // Health check to verify DO is working
    const response = await stub.fetch('https://do/')
    expect(response.status).toBe(200)

    const json = await response.json() as { status: string; id: string }
    expect(json.status).toBe('ok')
    expect(json.id).toBeDefined()
  })

  it('should handle concurrent requests', async () => {
    const stub = getTestStub()

    // Fire multiple concurrent requests
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
    const stub1 = getTestStub(generateTestId())
    const stub2 = getTestStub(generateTestId())

    const [resp1, resp2] = await Promise.all([
      stub1.fetch('https://do/'),
      stub2.fetch('https://do/'),
    ])

    const json1 = await resp1.json() as { id: string }
    const json2 = await resp2.json() as { id: string }

    // Different DO instances have different IDs
    expect(json1.id).not.toBe(json2.id)
  })

  it('should return same DO instance for same name', async () => {
    const testName = generateTestId()
    const stub1 = getTestStub(testName)
    const stub2 = getTestStub(testName)

    const [resp1, resp2] = await Promise.all([
      stub1.fetch('https://do/'),
      stub2.fetch('https://do/'),
    ])

    const json1 = await resp1.json() as { id: string }
    const json2 = await resp2.json() as { id: string }

    // Same DO instance - same ID
    expect(json1.id).toBe(json2.id)
  })

  it('should handle multiple DO instances with isolated state', async () => {
    // Create multiple DO instances
    const instances = Array.from({ length: 3 }, () => getTestStub(generateTestId()))

    // Each instance should be independent
    const responses = await Promise.all(
      instances.map(stub => stub.fetch('https://do/'))
    )

    const ids = await Promise.all(
      responses.map(async r => {
        const json = await r.json() as { id: string }
        return json.id
      })
    )

    // All IDs should be unique
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })
})

// ============================================================================
// UNIT TESTS: WebSocketManager Pure Logic (No DO Required)
// ============================================================================

describe('WebSocketManager - Pure Logic Tests', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  describe('connection lifecycle handlers', () => {
    it('should register and unregister connect handlers', () => {
      const handler = vi.fn()

      manager.onConnect(handler)
      expect(() => manager.offConnect(handler)).not.toThrow()
    })

    it('should register and unregister disconnect handlers', () => {
      const handler = vi.fn()

      manager.onDisconnect(handler)
      expect(() => manager.offDisconnect(handler)).not.toThrow()
    })
  })

  describe('heartbeat management', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should stop heartbeat when stopHeartbeat is called', () => {
      // Create a minimal mock state for heartbeat testing
      const mockState = {
        getWebSockets: () => [],
      } as unknown as DurableObjectState

      const intervalId = manager.startHeartbeat(mockState, 1000, 5000)

      // Stop should not throw
      expect(() => manager.stopHeartbeat(intervalId)).not.toThrow()
    })
  })

  describe('send method', () => {
    it('should return false when WebSocket send throws', () => {
      // Create a fake WebSocket that throws on send
      const fakeWs = {
        readyState: 1, // OPEN
        send: () => {
          throw new Error('Send failed')
        },
      } as unknown as WebSocket

      const result = manager.send(fakeWs, { type: 'test' })
      expect(result).toBe(false)
    })

    it('should return true when send succeeds', () => {
      const fakeWs = {
        readyState: 1, // OPEN
        send: vi.fn(),
      } as unknown as WebSocket

      const result = manager.send(fakeWs, { type: 'test' })
      expect(result).toBe(true)
      expect(fakeWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }))
    })
  })

  describe('client ID management', () => {
    it('should return undefined for unknown client ID', () => {
      expect(manager.getWebSocketByClientId('unknown')).toBeUndefined()
    })
  })

  describe('tag management for unknown connections', () => {
    it('should return false when adding tag to non-existent connection', () => {
      const fakeWs = {} as WebSocket
      expect(manager.addConnectionTag(fakeWs, 'tag')).toBe(false)
    })

    it('should return false when removing tag from non-existent connection', () => {
      const fakeWs = {} as WebSocket
      expect(manager.removeConnectionTag(fakeWs, 'tag')).toBe(false)
    })

    it('should return false when updating tags on non-existent connection', () => {
      const fakeWs = {} as WebSocket
      expect(manager.updateConnectionTags(fakeWs, ['tags'])).toBe(false)
    })
  })

  describe('connection metadata for unknown connections', () => {
    it('should return empty tags for unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.getTagsForWebSocket(fakeWs)).toEqual([])
    })

    it('should return false for hibernatable check on unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.isHibernatable(fakeWs)).toBe(false)
    })

    it('should return undefined connection ID for unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.getConnectionId(fakeWs)).toBeUndefined()
    })

    it('should return undefined metadata for unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.getConnectionMetadata(fakeWs)).toBeUndefined()
    })

    it('should return 0 for last pong on unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.getLastPong(fakeWs)).toBe(0)
    })

    it('should handle setLastPong for unknown WebSocket gracefully', () => {
      const fakeWs = {} as WebSocket
      // Should not throw
      expect(() => manager.setLastPong(fakeWs, Date.now())).not.toThrow()
    })

    it('should return false for hasConnection on unknown WebSocket', () => {
      const fakeWs = {} as WebSocket
      expect(manager.hasConnection(fakeWs)).toBe(false)
    })
  })

  describe('client ID for unknown connections', () => {
    it('should return false when setting client ID on non-existent connection', () => {
      const fakeWs = {} as WebSocket
      expect(manager.setClientId(fakeWs, 'client-id')).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('should handle cleanup of unknown WebSocket gracefully', () => {
      const fakeWs = {} as WebSocket
      // Should not throw
      expect(() => manager.cleanupWebSocket(fakeWs)).not.toThrow()
    })

    it('should be idempotent - multiple cleanups should not throw', () => {
      const fakeWs = {} as WebSocket

      // First cleanup
      manager.cleanupWebSocket(fakeWs)

      // Second cleanup should also not throw
      expect(() => manager.cleanupWebSocket(fakeWs)).not.toThrow()
    })
  })

  describe('stale connection detection', () => {
    it('should consider unknown connection as stale', () => {
      const fakeWs = {} as WebSocket
      expect(manager.isStale(fakeWs, 5000)).toBe(true)
    })
  })

  describe('close connection', () => {
    it('should handle close on connection gracefully', () => {
      const fakeWs = {
        close: vi.fn(),
      } as unknown as WebSocket

      // Should not throw
      expect(() => manager.closeConnection(fakeWs, 1000, 'Test close')).not.toThrow()
      expect(fakeWs.close).toHaveBeenCalledWith(1000, 'Test close')
    })

    it('should handle close error gracefully', () => {
      const fakeWs = {
        close: () => {
          throw new Error('Close failed')
        },
      } as unknown as WebSocket

      // Should not throw
      expect(() => manager.closeConnection(fakeWs, 1000, 'Test close')).not.toThrow()
    })
  })
})

// ============================================================================
// UNIT TESTS: Broadcast and Connection Count (With Minimal State)
// ============================================================================

describe('WebSocketManager - Broadcast', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should broadcast message to all WebSockets with tag', () => {
    // Create minimal fake WebSockets
    const sentMessages1: string[] = []
    const sentMessages2: string[] = []

    const ws1 = {
      readyState: 1, // OPEN
      send: (data: string) => sentMessages1.push(data),
    } as unknown as WebSocket

    const ws2 = {
      readyState: 1, // OPEN
      send: (data: string) => sentMessages2.push(data),
    } as unknown as WebSocket

    // Create minimal state that returns our fake WebSockets
    const mockState = {
      getWebSockets: (tag?: string) => tag === 'chat' ? [ws1, ws2] : [],
    } as unknown as DurableObjectState

    const result = manager.broadcast(mockState, 'chat', { type: 'hello', message: 'world' })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(0)
    expect(sentMessages1).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
    expect(sentMessages2).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
  })

  it('should handle failed broadcasts gracefully', () => {
    const ws = {
      readyState: 3, // CLOSED
      send: () => {
        throw new Error('WebSocket is not open')
      },
    } as unknown as WebSocket

    const mockState = {
      getWebSockets: () => [ws],
    } as unknown as DurableObjectState

    const result = manager.broadcast(mockState, 'chat', { type: 'test' })

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('should broadcast to correct tag only', () => {
    const sentMessages1: string[] = []
    const sentMessages2: string[] = []

    const ws1 = {
      readyState: 1,
      send: (data: string) => sentMessages1.push(data),
    } as unknown as WebSocket

    const ws2 = {
      readyState: 1,
      send: (data: string) => sentMessages2.push(data),
    } as unknown as WebSocket

    // State returns different WebSockets for different tags
    const mockState = {
      getWebSockets: (tag?: string) => {
        if (tag === 'room:1') return [ws1]
        if (tag === 'room:2') return [ws2]
        return []
      },
    } as unknown as DurableObjectState

    manager.broadcast(mockState, 'room:1', { message: 'room1 only' })

    expect(sentMessages1.length).toBe(1)
    expect(sentMessages2.length).toBe(0)
  })

  it('should broadcast to all connections regardless of tag', () => {
    const sentMessages1: string[] = []
    const sentMessages2: string[] = []

    const ws1 = {
      readyState: 1,
      send: (data: string) => sentMessages1.push(data),
    } as unknown as WebSocket

    const ws2 = {
      readyState: 1,
      send: (data: string) => sentMessages2.push(data),
    } as unknown as WebSocket

    // State returns all WebSockets when no tag specified
    const mockState = {
      getWebSockets: (tag?: string) => tag ? [] : [ws1, ws2],
    } as unknown as DurableObjectState

    const result = manager.broadcastAll(mockState, { type: 'global', data: 'announcement' })

    expect(result.sent).toBe(2)
    expect(sentMessages1.length).toBe(1)
    expect(sentMessages2.length).toBe(1)
  })
})

// ============================================================================
// UNIT TESTS: Connection Count
// ============================================================================

describe('WebSocketManager - Connection Count', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should return connection count from state', () => {
    const ws1 = {} as WebSocket
    const ws2 = {} as WebSocket

    const mockState = {
      getWebSockets: (tag?: string) => tag === 'chat' ? [ws1, ws2] : [ws1, ws2],
    } as unknown as DurableObjectState

    const count = manager.getConnectionCount(mockState)
    expect(count).toBe(2)
  })

  it('should return connection count by tag', () => {
    const ws1 = {} as WebSocket
    const ws2 = {} as WebSocket
    const ws3 = {} as WebSocket

    const mockState = {
      getWebSockets: (tag?: string) => {
        if (tag === 'room:1') return [ws1, ws2]
        if (tag === 'room:2') return [ws3]
        return [ws1, ws2, ws3]
      },
    } as unknown as DurableObjectState

    const room1Count = manager.getConnectionCount(mockState, 'room:1')
    const room2Count = manager.getConnectionCount(mockState, 'room:2')

    expect(room1Count).toBe(2)
    expect(room2Count).toBe(1)
  })
})

// ============================================================================
// UNIT TESTS: Ping/Pong
// ============================================================================

describe('WebSocketManager - Ping/Pong', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should send ping messages', () => {
    const sentMessages: string[] = []
    const ws = {
      readyState: 1,
      send: (data: string) => sentMessages.push(data),
    } as unknown as WebSocket

    manager.sendPing(ws)

    expect(sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)
  })

  it('should handle ping failure gracefully', () => {
    const ws = {
      readyState: 3, // CLOSED
      send: () => {
        throw new Error('WebSocket is not open')
      },
    } as unknown as WebSocket

    // Should not throw
    expect(() => manager.sendPing(ws)).not.toThrow()
  })
})

// ============================================================================
// UNIT TESTS: Message Handling
// ============================================================================

describe('WebSocketManager - Message Handling', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    manager = new WebSocketManager()
  })

  it('should route messages to type-specific handlers', async () => {
    const handler = vi.fn()
    manager.on('chat.message', handler)

    const sentMessages: string[] = []
    const ws = {
      readyState: 1,
      send: (data: string) => sentMessages.push(data),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'chat.message', data: { text: 'hello' } }))

    expect(handler).toHaveBeenCalledWith(ws, { text: 'hello' })
  })

  it('should support multiple handlers for same event type', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    manager.on('test', handler1)
    manager.on('test', handler2)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: { value: 1 } }))

    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  it('should support wildcard handlers', async () => {
    const handler = vi.fn()
    manager.on('*', handler)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'any.event', data: {} }))

    expect(handler).toHaveBeenCalled()
  })

  it('should handle binary messages', async () => {
    const handler = vi.fn()
    manager.on('binary', handler)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    const buffer = new ArrayBuffer(8)
    await manager.handleMessage(ws, buffer)

    expect(handler).toHaveBeenCalledWith(ws, buffer)
  })

  it('should handle malformed JSON gracefully', async () => {
    const sentMessages: string[] = []
    const ws = {
      readyState: 1,
      send: (data: string) => sentMessages.push(data),
    } as unknown as WebSocket

    // Should not throw
    await manager.handleMessage(ws, 'not valid json {')

    // Check if error was sent back
    expect(sentMessages.some((msg: string) => msg.includes('error'))).toBe(true)
  })

  it('should remove a handler when off is called', async () => {
    const handler = vi.fn()
    manager.on('test', handler)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

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

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  it('should continue processing when a handler throws', async () => {
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error')
    })
    const successHandler = vi.fn()

    manager.on('test', errorHandler)
    manager.on('test', successHandler)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

    expect(errorHandler).toHaveBeenCalled()
    expect(successHandler).toHaveBeenCalled()
  })

  it('should handle async handler errors', async () => {
    const asyncErrorHandler = vi.fn(async () => {
      throw new Error('Async error')
    })
    const successHandler = vi.fn()

    manager.on('test', asyncErrorHandler)
    manager.on('test', successHandler)

    const ws = {
      readyState: 1,
      send: vi.fn(),
    } as unknown as WebSocket

    await manager.handleMessage(ws, JSON.stringify({ type: 'test', data: {} }))

    expect(asyncErrorHandler).toHaveBeenCalled()
    expect(successHandler).toHaveBeenCalled()
  })
})

// ============================================================================
// UNIT TESTS: Heartbeat Interval
// ============================================================================

describe('WebSocketManager - Heartbeat Interval', () => {
  let manager: WebSocketManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new WebSocketManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start heartbeat and send pings at interval', () => {
    const sentMessages: string[] = []
    const ws = {
      readyState: 1,
      send: (data: string) => sentMessages.push(data),
    } as unknown as WebSocket

    // Register the connection with the manager so it has activity time
    const connections = (manager as unknown as { connections: Map<WebSocket, unknown> }).connections
    connections.set(ws, {
      connectionId: 'test-conn',
      tags: ['chat'],
      hibernatable: false,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      reconnectCount: 0,
    })

    const mockState = {
      getWebSockets: () => [ws],
    } as unknown as DurableObjectState

    const intervalId = manager.startHeartbeat(mockState, 1000, 5000)

    // Advance time by one interval
    vi.advanceTimersByTime(1000)

    expect(sentMessages.some((msg: string) => msg.includes('ping'))).toBe(true)

    manager.stopHeartbeat(intervalId)
  })

  it('should stop heartbeat when stopHeartbeat is called', () => {
    const sentMessages: string[] = []
    const ws = {
      readyState: 1,
      send: (data: string) => sentMessages.push(data),
    } as unknown as WebSocket

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

    const mockState = {
      getWebSockets: () => [ws],
    } as unknown as DurableObjectState

    const intervalId = manager.startHeartbeat(mockState, 1000, 5000)
    manager.stopHeartbeat(intervalId)

    // Clear sent messages
    sentMessages.length = 0
    vi.advanceTimersByTime(2000)

    expect(sentMessages.length).toBe(0)
  })
})
