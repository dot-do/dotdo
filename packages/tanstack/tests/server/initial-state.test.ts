import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine } from '../../src/server/engine'
import type { InitialMessage, SyncThing } from '../../src/protocol'

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

describe('SyncEngine Initial State', () => {
  let mockStore: {
    list: ReturnType<typeof vi.fn>
    getMaxRowid: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockStore = {
      list: vi.fn().mockResolvedValue([]),
      getMaxRowid: vi.fn().mockResolvedValue(null),
    }
  })

  describe('sendInitialState()', () => {
    it('should send current items to socket', async () => {
      const things: SyncThing[] = [
        createMockThing({ $id: 'https://example.com/tasks/task-1', name: 'Task 1' }),
        createMockThing({ $id: 'https://example.com/tasks/task-2', name: 'Task 2' }),
        createMockThing({ $id: 'https://example.com/tasks/task-3', name: 'Task 3' }),
      ]
      mockStore.list.mockResolvedValue(things)
      mockStore.getMaxRowid.mockResolvedValue(100)

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      expect(socket.send).toHaveBeenCalledTimes(1)
      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])

      expect(message.type).toBe('initial')
      expect(message.collection).toBe('Task')
      expect(message.items).toEqual(things)
      expect(message.items.length).toBe(3)
    })

    it('should call store.list with correct collection type', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'User')

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'User',
        })
      )
    })

    it('should pass branch filter to store.list', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', 'main')

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Task',
          branch: 'main',
        })
      )
    })

    it('should pass null branch when not specified', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: null,
        })
      )
    })

    it('should include branch in message', async () => {
      mockStore.getMaxRowid.mockResolvedValue(50)
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', 'feature/dark-mode')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.branch).toBe('feature/dark-mode')
    })

    it('should set txid to max rowid in collection', async () => {
      mockStore.getMaxRowid.mockResolvedValue(12345)
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.txid).toBe(12345)
    })

    it('should call getMaxRowid with correct parameters', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', 'main')

      expect(mockStore.getMaxRowid).toHaveBeenCalledWith({
        type: 'Task',
        branch: 'main',
      })
    })
  })

  describe('empty collection handling', () => {
    it('should send empty items array for collection with no items', async () => {
      mockStore.list.mockResolvedValue([])
      mockStore.getMaxRowid.mockResolvedValue(null)

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.items).toEqual([])
      expect(message.items.length).toBe(0)
    })

    it('should set txid to 0 when max rowid is null', async () => {
      mockStore.list.mockResolvedValue([])
      mockStore.getMaxRowid.mockResolvedValue(null)

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.txid).toBe(0)
    })
  })

  describe('query options', () => {
    it('should pass limit to store.list', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', null, { limit: 10 })

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
        })
      )
    })

    it('should pass offset to store.list', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', null, { offset: 20 })

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: 20,
        })
      )
    })

    it('should pass limit and offset together', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', null, {
        limit: 50,
        offset: 100,
      })

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Task',
          branch: null,
          limit: 50,
          offset: 100,
        })
      )
    })

    it('should work with branch and query options combined', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', 'main', {
        limit: 25,
        offset: 50,
      })

      expect(mockStore.list).toHaveBeenCalledWith({
        type: 'Task',
        branch: 'main',
        limit: 25,
        offset: 50,
      })
    })
  })

  describe('message format', () => {
    it('should match InitialMessage schema', async () => {
      const things = [createMockThing()]
      mockStore.list.mockResolvedValue(things)
      mockStore.getMaxRowid.mockResolvedValue(42)

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task', 'main')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])

      // Verify all required fields are present
      expect(message).toHaveProperty('type', 'initial')
      expect(message).toHaveProperty('collection', 'Task')
      expect(message).toHaveProperty('branch', 'main')
      expect(message).toHaveProperty('items')
      expect(message).toHaveProperty('txid', 42)

      // Verify items array structure
      expect(Array.isArray(message.items)).toBe(true)
    })

    it('should set branch to null when no branch specified', async () => {
      mockStore.list.mockResolvedValue([])
      mockStore.getMaxRowid.mockResolvedValue(0)

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      const message: InitialMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.branch).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should not send to closed socket', async () => {
      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()
      socket.readyState = 3 // CLOSED

      engine.accept(socket as unknown as WebSocket)
      await engine.sendInitialState(socket as unknown as WebSocket, 'Task')

      expect(socket.send).not.toHaveBeenCalled()
    })

    it('should handle store.list rejection gracefully', async () => {
      mockStore.list.mockRejectedValue(new Error('Database error'))

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      // Should throw since we're not catching errors internally
      await expect(
        engine.sendInitialState(socket as unknown as WebSocket, 'Task')
      ).rejects.toThrow('Database error')
    })

    it('should handle store.getMaxRowid rejection gracefully', async () => {
      mockStore.list.mockResolvedValue([])
      mockStore.getMaxRowid.mockRejectedValue(new Error('Database error'))

      const engine = new SyncEngine(mockStore)
      const socket = createMockSocket()

      engine.accept(socket as unknown as WebSocket)

      await expect(
        engine.sendInitialState(socket as unknown as WebSocket, 'Task')
      ).rejects.toThrow('Database error')
    })
  })
})
