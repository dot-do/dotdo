import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine } from '../../src/server/engine'
import type { ChangeMessage, SyncThing } from '../../src/protocol'

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

// Helper to create a mock thing
const createMockThing = (overrides: Partial<SyncThing> = {}): SyncThing => ({
  $id: 'https://example.com/tasks/task-1',
  $type: 'https://example.com/Task',
  name: 'Test Task',
  data: { description: 'A test task' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  branch: null,
  ...overrides,
})

describe('SyncEngine Broadcast', () => {
  let engine: SyncEngine
  let mockStore: ReturnType<typeof createMockStore>

  beforeEach(() => {
    mockStore = createMockStore()
    engine = new SyncEngine(mockStore)
  })

  describe('onThingCreated()', () => {
    it('should create insert message and broadcast to subscribers', () => {
      const socket = createMockSocket()
      const thing = createMockThing()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingCreated(thing, 42)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.type).toBe('change')
      expect(message.operation).toBe('insert')
      expect(message.collection).toBe('Task')
      expect(message.txid).toBe(42)
      expect(message.thing).toEqual(thing)
    })

    it('should extract collection from $type URL', () => {
      const socket = createMockSocket()
      const thing = createMockThing({
        $type: 'https://example.com/User',
      })

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'User')

      engine.onThingCreated(thing, 1)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.collection).toBe('User')
    })

    it('should not send to sockets not subscribed to the collection', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      const thing = createMockThing()

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      engine.subscribe(socket1 as unknown as WebSocket, 'Task')
      engine.subscribe(socket2 as unknown as WebSocket, 'User') // Different collection

      engine.onThingCreated(thing, 1)

      expect(socket1.send).toHaveBeenCalled()
      expect(socket2.send).not.toHaveBeenCalled()
    })

    it('should include branch in message', () => {
      const socket = createMockSocket()
      const thing = createMockThing({ branch: 'feature/dark-mode' })

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingCreated(thing, 1)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.branch).toBe('feature/dark-mode')
    })
  })

  describe('onThingUpdated()', () => {
    it('should create update message and broadcast to subscribers', () => {
      const socket = createMockSocket()
      const thing = createMockThing({ name: 'Updated Task' })

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingUpdated(thing, 99)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.type).toBe('change')
      expect(message.operation).toBe('update')
      expect(message.collection).toBe('Task')
      expect(message.txid).toBe(99)
      expect(message.thing).toEqual(thing)
    })

    it('should broadcast to all subscribed sockets', () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      const thing = createMockThing()

      engine.accept(socket1 as unknown as WebSocket)
      engine.accept(socket2 as unknown as WebSocket)
      engine.subscribe(socket1 as unknown as WebSocket, 'Task')
      engine.subscribe(socket2 as unknown as WebSocket, 'Task')

      engine.onThingUpdated(thing, 1)

      expect(socket1.send).toHaveBeenCalled()
      expect(socket2.send).toHaveBeenCalled()
    })
  })

  describe('onThingDeleted()', () => {
    it('should create delete message with id and broadcast', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingDeleted('Task', 'task-123', null, 77)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.type).toBe('change')
      expect(message.operation).toBe('delete')
      expect(message.collection).toBe('Task')
      expect(message.txid).toBe(77)
      expect(message.id).toBe('task-123')
      expect(message.thing).toBeUndefined()
    })

    it('should include branch in delete message', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingDeleted('Task', 'task-123', 'main', 1)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.branch).toBe('main')
    })
  })

  describe('branch filtering', () => {
    it('should only send to sockets subscribed to matching branch', () => {
      const socketMain = createMockSocket()
      const socketFeature = createMockSocket()
      const thing = createMockThing({ branch: 'main' })

      engine.accept(socketMain as unknown as WebSocket)
      engine.accept(socketFeature as unknown as WebSocket)
      engine.subscribe(socketMain as unknown as WebSocket, 'Task', 'main')
      engine.subscribe(socketFeature as unknown as WebSocket, 'Task', 'feature/dark-mode')

      engine.onThingCreated(thing, 1)

      expect(socketMain.send).toHaveBeenCalled()
      expect(socketFeature.send).not.toHaveBeenCalled()
    })

    it('should send to all branch subscribers when thing has null branch', () => {
      const socketMain = createMockSocket()
      const socketNoBranch = createMockSocket()
      const thing = createMockThing({ branch: null })

      engine.accept(socketMain as unknown as WebSocket)
      engine.accept(socketNoBranch as unknown as WebSocket)
      engine.subscribe(socketMain as unknown as WebSocket, 'Task', 'main')
      engine.subscribe(socketNoBranch as unknown as WebSocket, 'Task')

      engine.onThingCreated(thing, 1)

      // socketNoBranch should receive (subscribed without filter)
      expect(socketNoBranch.send).toHaveBeenCalled()
      // socketMain should NOT receive (null branch !== 'main')
      expect(socketMain.send).not.toHaveBeenCalled()
    })

    it('should send to unfiltered subscribers regardless of thing branch', () => {
      const socketUnfiltered = createMockSocket()
      const thing = createMockThing({ branch: 'feature/dark-mode' })

      engine.accept(socketUnfiltered as unknown as WebSocket)
      engine.subscribe(socketUnfiltered as unknown as WebSocket, 'Task') // No branch filter

      engine.onThingCreated(thing, 1)

      expect(socketUnfiltered.send).toHaveBeenCalled()
    })

    it('should respect branch filter for updates', () => {
      const socketMain = createMockSocket()
      const thing = createMockThing({ branch: 'feature/dark-mode' })

      engine.accept(socketMain as unknown as WebSocket)
      engine.subscribe(socketMain as unknown as WebSocket, 'Task', 'main')

      engine.onThingUpdated(thing, 1)

      expect(socketMain.send).not.toHaveBeenCalled()
    })

    it('should respect branch filter for deletes', () => {
      const socketMain = createMockSocket()

      engine.accept(socketMain as unknown as WebSocket)
      engine.subscribe(socketMain as unknown as WebSocket, 'Task', 'main')

      engine.onThingDeleted('Task', 'task-123', 'feature/dark-mode', 1)

      expect(socketMain.send).not.toHaveBeenCalled()
    })
  })

  describe('txid handling', () => {
    it('should use rowid as txid for insert', () => {
      const socket = createMockSocket()
      const thing = createMockThing()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingCreated(thing, 12345)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.txid).toBe(12345)
    })

    it('should use rowid as txid for update', () => {
      const socket = createMockSocket()
      const thing = createMockThing()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingUpdated(thing, 67890)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.txid).toBe(67890)
    })

    it('should use rowid as txid for delete', () => {
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingDeleted('Task', 'task-123', null, 11111)

      const message: ChangeMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.txid).toBe(11111)
    })
  })

  describe('edge cases', () => {
    it('should not throw when broadcasting to collection with no subscribers', () => {
      const thing = createMockThing()

      // No sockets accepted, no subscriptions
      expect(() => {
        engine.onThingCreated(thing, 1)
      }).not.toThrow()
    })

    it('should not send to closed sockets (readyState !== 1)', () => {
      const socket = createMockSocket()
      socket.readyState = 3 // CLOSED
      const thing = createMockThing()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      engine.onThingCreated(thing, 1)

      expect(socket.send).not.toHaveBeenCalled()
    })

    it('should handle socket.send throwing', () => {
      const socket = createMockSocket()
      socket.send.mockImplementation(() => {
        throw new Error('Socket error')
      })
      const thing = createMockThing()

      engine.accept(socket as unknown as WebSocket)
      engine.subscribe(socket as unknown as WebSocket, 'Task')

      // Should not throw
      expect(() => {
        engine.onThingCreated(thing, 1)
      }).not.toThrow()
    })
  })
})
