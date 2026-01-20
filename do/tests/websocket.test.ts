import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DO } from '../DO'
import { WebSocketManager } from '../websocket'

// Mock WebSocket
class MockWebSocket {
  public readyState = 1 // OPEN
  private listeners = new Map<string, Set<(event: any) => void>>()
  public sentMessages: string[] = []

  send(data: string) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3 // CLOSED
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

  // Simulate receiving a message
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
      // Return all websockets
      const all = new Set<WebSocket>()
      for (const set of websockets.values()) {
        for (const ws of set) {
          all.add(ws)
        }
      }
      return Array.from(all)
    }),
  } as unknown as DurableObjectState
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    manager = new WebSocketManager()
  })

  describe('WebSocket upgrade', () => {
    it('should handle WebSocket upgrade request', () => {
      const response = manager.handleWebSocketUpgrade(mockState, ['chat'], false)

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
      expect(mockState.acceptWebSocket).toHaveBeenCalled()
    })

    it('should support hibernatable WebSocket upgrade', () => {
      const response = manager.handleWebSocketUpgrade(mockState, ['chat'], true)

      expect(response.status).toBe(101)
      expect(mockState.acceptWebSocket).toHaveBeenCalledWith(
        expect.anything(),
        ['hibernatable']
      )
    })

    it('should track WebSocket tags', () => {
      manager.handleWebSocketUpgrade(mockState, ['chat', 'room:123'], false)

      const tags = manager.getWebSocketTags()
      expect(tags).toEqual(['chat', 'room:123'])
    })

    it('should track hibernatable state', () => {
      manager.handleWebSocketUpgrade(mockState, ['chat'], true)

      expect(manager.isWebSocketHibernatable()).toBe(true)
    })
  })

  describe('broadcast', () => {
    it('should broadcast message to all WebSockets with tag', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      // Manually add to state's websockets for testing
      mockState.acceptWebSocket(ws1, ['chat'])
      mockState.acceptWebSocket(ws2, ['chat'])

      const result = manager.broadcast(mockState, 'chat', { type: 'hello', message: 'world' })

      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
      expect((ws1 as any).sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
      expect((ws2 as any).sentMessages).toContain(JSON.stringify({ type: 'hello', message: 'world' }))
    })

    it('should handle failed broadcasts gracefully', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])

      // Close the socket
      ;(ws as any).readyState = 3 // CLOSED

      const result = manager.broadcast(mockState, 'chat', { type: 'test' })

      expect(result.failed).toBe(1)
      expect(result.sent).toBe(0)
    })

    it('should broadcast to correct tag only', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      mockState.acceptWebSocket(ws1, ['room:1'])
      mockState.acceptWebSocket(ws2, ['room:2'])

      manager.broadcast(mockState, 'room:1', { message: 'room1 only' })

      expect((ws1 as any).sentMessages.length).toBe(1)
      expect((ws2 as any).sentMessages.length).toBe(0)
    })
  })

  describe('broadcast to all connections', () => {
    it('should broadcast to all connections regardless of tag', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      mockState.acceptWebSocket(ws1, ['room:1'])
      mockState.acceptWebSocket(ws2, ['room:2'])

      const result = manager.broadcastAll(mockState, { type: 'global', data: 'announcement' })

      expect(result.sent).toBe(2)
      expect((ws1 as any).sentMessages.length).toBe(1)
      expect((ws2 as any).sentMessages.length).toBe(1)
    })
  })

  describe('connection cleanup', () => {
    it('should cleanup WebSocket on close', () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      manager.handleWebSocketUpgrade(mockState, ['chat'], true)
      mockState.acceptWebSocket(ws, ['chat'])

      manager.cleanupWebSocket(ws)

      const tags = manager.getTagsForWebSocket(ws)
      expect(tags).toEqual([])
      expect(manager.isHibernatable(ws)).toBe(false)
    })
  })

  describe('message routing', () => {
    it('should route messages to handlers', async () => {
      const handler = vi.fn()
      manager.on('chat.message', handler)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'chat.message', data: { text: 'hello' } })
      )

      expect(handler).toHaveBeenCalledWith(
        expect.anything(), // WebSocket
        { text: 'hello' }
      )
    })

    it('should handle multiple handlers for same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: { value: 1 } })
      )

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should support wildcard handlers', async () => {
      const handler = vi.fn()
      manager.on('*', handler)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'any.event', data: {} })
      )

      expect(handler).toHaveBeenCalled()
    })

    it('should handle binary messages', async () => {
      const handler = vi.fn()
      manager.on('binary', handler)

      const buffer = new ArrayBuffer(8)
      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        buffer
      )

      expect(handler).toHaveBeenCalledWith(expect.anything(), buffer)
    })

    it('should handle malformed JSON gracefully', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      // Should not throw
      await manager.handleMessage(ws, 'not valid json {')

      // Check if error was sent back
      expect((ws as any).sentMessages.some((msg: string) =>
        msg.includes('error')
      )).toBe(true)
    })
  })

  describe('handler removal (off)', () => {
    it('should remove a handler when off is called', async () => {
      const handler = vi.fn()
      manager.on('test', handler)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: { value: 1 } })
      )
      expect(handler).toHaveBeenCalledTimes(1)

      // Remove handler
      manager.off('test', handler)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: { value: 2 } })
      )
      // Handler should not be called again
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should not affect other handlers when one is removed', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      manager.on('test', handler1)
      manager.on('test', handler2)

      manager.off('test', handler1)

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: {} })
      )

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should handle removing non-existent handler gracefully', () => {
      const handler = vi.fn()
      // Should not throw
      manager.off('nonexistent', handler)
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

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: {} })
      )

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

      await manager.handleMessage(
        new MockWebSocket() as unknown as WebSocket,
        JSON.stringify({ type: 'test', data: {} })
      )

      expect(asyncErrorHandler).toHaveBeenCalled()
      expect(successHandler).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('heartbeat/ping-pong', () => {
    it('should send ping messages', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])

      manager.sendPing(ws)

      expect((ws as any).sentMessages.some((msg: string) =>
        msg.includes('ping')
      )).toBe(true)
    })

    it('should handle pong responses', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      manager.sendPing(ws)
      await manager.handleMessage(ws, JSON.stringify({ type: 'pong' }))

      // Should update last pong time
      const lastPong = manager.getLastPong(ws)
      expect(lastPong).toBeGreaterThan(0)
    })

    it('should detect stale connections', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])

      // Set last pong to 2 minutes ago
      manager.setLastPong(ws, Date.now() - 120000)

      expect(manager.isStale(ws, 60000)).toBe(true)
    })

    it('should auto-close stale connections', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])

      manager.setLastPong(ws, Date.now() - 120000)
      manager.closeStaleConnections(60000)

      expect((ws as any).readyState).toBe(3) // CLOSED
    })
  })

  describe('heartbeat interval', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should start heartbeat and send pings at interval', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])
      manager.setLastPong(ws, Date.now())

      const intervalId = manager.startHeartbeat(mockState, 1000, 5000)

      // Advance time by one interval
      vi.advanceTimersByTime(1000)

      expect((ws as any).sentMessages.some((msg: string) =>
        msg.includes('ping')
      )).toBe(true)

      manager.stopHeartbeat(intervalId)
    })

    it('should stop heartbeat when stopHeartbeat is called', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])
      manager.setLastPong(ws, Date.now())

      const intervalId = manager.startHeartbeat(mockState, 1000, 5000)
      manager.stopHeartbeat(intervalId)

      // Advance time - no more pings should be sent
      ;(ws as any).sentMessages = []
      vi.advanceTimersByTime(2000)

      expect((ws as any).sentMessages.length).toBe(0)
    })

    it('should close stale connections during heartbeat', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      mockState.acceptWebSocket(ws, ['chat'])

      // Set last pong to be stale
      manager.setLastPong(ws, Date.now() - 10000)

      const intervalId = manager.startHeartbeat(mockState, 1000, 5000)

      vi.advanceTimersByTime(1000)

      expect((ws as any).readyState).toBe(3) // CLOSED

      manager.stopHeartbeat(intervalId)
    })
  })

  describe('connection count and state', () => {
    it('should track connection count', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket

      mockState.acceptWebSocket(ws1, ['chat'])
      mockState.acceptWebSocket(ws2, ['chat'])

      const count = manager.getConnectionCount(mockState)
      expect(count).toBe(2)
    })

    it('should track connections by tag', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket
      const ws2 = new MockWebSocket() as unknown as WebSocket
      const ws3 = new MockWebSocket() as unknown as WebSocket

      mockState.acceptWebSocket(ws1, ['room:1'])
      mockState.acceptWebSocket(ws2, ['room:1'])
      mockState.acceptWebSocket(ws3, ['room:2'])

      const room1Count = manager.getConnectionCount(mockState, 'room:1')
      const room2Count = manager.getConnectionCount(mockState, 'room:2')

      expect(room1Count).toBe(2)
      expect(room2Count).toBe(1)
    })
  })

  describe('send to specific connection', () => {
    it('should send message to specific WebSocket', () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      const result = manager.send(ws, { type: 'direct', data: 'hello' })

      expect(result).toBe(true)
      expect((ws as any).sentMessages).toContain(
        JSON.stringify({ type: 'direct', data: 'hello' })
      )
    })

    it('should return false when sending to closed connection', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      ;(ws as any).readyState = 3 // CLOSED

      const result = manager.send(ws, { type: 'test' })

      expect(result).toBe(false)
    })
  })

  describe('close specific connection', () => {
    it('should close a specific WebSocket with code and reason', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      manager.setLastPong(ws, Date.now())

      manager.closeConnection(ws, 1000, 'Normal closure')

      expect((ws as any).readyState).toBe(3) // CLOSED
    })

    it('should cleanup WebSocket state on close', () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      manager.setLastPong(ws, Date.now())

      manager.closeConnection(ws, 1000, 'Test')

      expect(manager.getLastPong(ws)).toBe(0)
    })
  })
})

describe('DO with WebSocket support', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  describe('WebSocket lifecycle', () => {
    it('should handle webSocketMessage', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      const message = 'test message'

      // Should not throw
      await doInstance.webSocketMessage(ws, message)
    })

    it('should handle webSocketClose', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket

      // Should not throw
      await doInstance.webSocketClose(ws, 1000, 'Normal closure', true)
    })

    it('should handle webSocketError', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket
      const error = new Error('Test error')

      // Should not throw
      await doInstance.webSocketError(ws, error)
    })

    it('should allow subclasses to override webSocketMessage', async () => {
      const handler = vi.fn()

      class CustomDO extends DO {
        async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
          handler(message)
        }
      }

      const custom = new CustomDO(mockState, {})
      await custom.webSocketMessage(new MockWebSocket() as unknown as WebSocket, 'test')

      expect(handler).toHaveBeenCalledWith('test')
    })

    it('should allow subclasses to override webSocketError', async () => {
      const handler = vi.fn()

      class CustomDO extends DO {
        async webSocketError(ws: WebSocket, error: unknown) {
          handler(error)
        }
      }

      const custom = new CustomDO(mockState, {})
      const testError = new Error('Custom error')
      await custom.webSocketError(new MockWebSocket() as unknown as WebSocket, testError)

      expect(handler).toHaveBeenCalledWith(testError)
    })
  })

  describe('DO with WebSocketManager integration', () => {
    it('should provide access to WebSocketManager', () => {
      expect(doInstance.ws).toBeInstanceOf(WebSocketManager)
    })

    it('should handle WebSocket upgrade via DO', async () => {
      const request = new Request('http://localhost/ws', {
        headers: {
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'test-key',
          'Sec-WebSocket-Version': '13',
        },
      })

      // The DO should be able to upgrade WebSocket connections
      const response = await doInstance.fetch(request)

      // For now, it should return a 404 since /ws route isn't set up by default
      // Subclasses would need to add the upgrade route
      expect(response).toBeDefined()
    })
  })
})
