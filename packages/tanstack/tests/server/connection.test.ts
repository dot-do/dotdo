import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine } from '../../src/server/engine'

/**
 * Mock WebSocket interface matching Cloudflare Workers WebSocket
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
}

const createMockSocket = (): MockWebSocket => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1, // WebSocket.OPEN
})

// Mock ThingsStore for SyncEngine constructor
const createMockStore = () => ({
  list: vi.fn().mockResolvedValue([]),
  getMaxRowid: vi.fn().mockResolvedValue(null),
})

describe('SyncEngine Connection Management', () => {
  let engine: SyncEngine
  let mockStore: ReturnType<typeof createMockStore>

  beforeEach(() => {
    mockStore = createMockStore()
    engine = new SyncEngine(mockStore)
  })

  describe('accept()', () => {
    it('should add socket to active connections set', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      expect(engine.getActiveConnections()).toBe(1)
    })

    it('should register close event listener on socket', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      expect(socket.addEventListener).toHaveBeenCalledWith('close', expect.any(Function))
    })

    it('should handle multiple simultaneous connections', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      const socket3 = createMockSocket()

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      engine.accept(socket3 as unknown as WebSocket)

      expect(engine.getActiveConnections()).toBe(3)
    })

    it('should not duplicate socket if accepted twice', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.accept(socket as unknown as WebSocket)

      expect(engine.getActiveConnections()).toBe(1)
    })
  })

  describe('socket close handling', () => {
    it('should remove socket from active set on close event', () => {
      const socket = createMockSocket()
      let closeHandler: (() => void) | undefined

      socket.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler
        }
      })

      engine.accept(socket as unknown as WebSocket)
      expect(engine.getActiveConnections()).toBe(1)

      // Simulate close event
      closeHandler!()

      expect(engine.getActiveConnections()).toBe(0)
    })

    it('should clean up all subscriptions when socket closes', () => {
      const socket = createMockSocket()
      let closeHandler: (() => void) | undefined

      socket.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler
        }
      })

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')
      engine.subscribe(socket as unknown as WebSocket, 'users')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'users')).toBe(true)

      // Simulate close event
      closeHandler!()

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(false)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'users')).toBe(false)
    })
  })

  describe('subscribe()', () => {
    it('should register socket interest in a collection', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)
    })

    it('should register socket with branch filter', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks', 'feature/dark-mode')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)
    })

    it('should allow multiple collections per socket', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')
      engine.subscribe(socket as unknown as WebSocket, 'users')
      engine.subscribe(socket as unknown as WebSocket, 'projects')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'users')).toBe(true)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'projects')).toBe(true)
    })

    it('should track subscribers per collection', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      engine.subscribe(socket1 as unknown as WebSocket, 'tasks')
      engine.subscribe(socket2 as unknown as WebSocket, 'tasks')

      const subscribers = engine.getSubscribers('tasks')
      expect(subscribers.size).toBe(2)
    })

    it('should return empty set for collection with no subscribers', () => {
      const subscribers = engine.getSubscribers('nonexistent')
      expect(subscribers.size).toBe(0)
    })
  })

  describe('unsubscribe()', () => {
    it('should remove socket interest from a collection', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)

      engine.unsubscribe(socket as unknown as WebSocket, 'tasks')
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(false)
    })

    it('should not affect other collections when unsubscribing', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')
      engine.subscribe(socket as unknown as WebSocket, 'users')

      engine.unsubscribe(socket as unknown as WebSocket, 'tasks')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(false)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'users')).toBe(true)
    })

    it('should handle unsubscribe from non-subscribed collection gracefully', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      // Should not throw
      expect(() => {
        engine.unsubscribe(socket as unknown as WebSocket, 'tasks')
      }).not.toThrow()
    })

    it('should update getSubscribers count after unsubscribe', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      engine.subscribe(socket1 as unknown as WebSocket, 'tasks')
      engine.subscribe(socket2 as unknown as WebSocket, 'tasks')

      expect(engine.getSubscribers('tasks').size).toBe(2)

      engine.unsubscribe(socket1 as unknown as WebSocket, 'tasks')

      expect(engine.getSubscribers('tasks').size).toBe(1)
    })
  })

  describe('getActiveConnections()', () => {
    it('should return 0 when no connections', () => {
      expect(engine.getActiveConnections()).toBe(0)
    })

    it('should return correct count after connections and disconnections', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      let closeHandler1: (() => void) | undefined

      socket1.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler1 = handler
        }
      })

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      expect(engine.getActiveConnections()).toBe(2)

      closeHandler1!()
      expect(engine.getActiveConnections()).toBe(1)
    })
  })

  describe('isSubscribed()', () => {
    it('should return false for unaccepted socket', () => {
      const socket = createMockSocket()

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(false)
    })

    it('should return false for accepted but not subscribed socket', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(false)
    })

    it('should return true only for subscribed collections', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')

      expect(engine.isSubscribed(socket as unknown as WebSocket, 'tasks')).toBe(true)
      expect(engine.isSubscribed(socket as unknown as WebSocket, 'users')).toBe(false)
    })
  })

  describe('getSubscriptionBranch()', () => {
    it('should return null for subscription without branch', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks')

      expect(engine.getSubscriptionBranch(socket as unknown as WebSocket, 'tasks')).toBeNull()
    })

    it('should return branch for subscription with branch filter', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'tasks', 'main')

      expect(engine.getSubscriptionBranch(socket as unknown as WebSocket, 'tasks')).toBe('main')
    })

    it('should return undefined for non-subscribed collection', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      expect(engine.getSubscriptionBranch(socket as unknown as WebSocket, 'tasks')).toBeUndefined()
    })
  })
})
