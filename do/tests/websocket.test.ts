import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  })
})
