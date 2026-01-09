import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dotdoCollectionOptions } from '../../src/client/collection'
import { z } from 'zod'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  readyState = MockWebSocket.OPEN

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  // Test helpers
  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = 3 // CLOSED
    this.onclose?.({ code, reason })
  }

  simulateError(error: Error) {
    this.onerror?.(error)
  }
}

// =============================================================================
// Test Schema
// =============================================================================

const TaskSchema = z.object({
  $id: z.string(),
  $type: z.string(),
  name: z.string().optional(),
  data: z.object({
    title: z.string(),
    completed: z.boolean(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type Task = z.infer<typeof TaskSchema>

// =============================================================================
// Test Setup
// =============================================================================

describe('client/subscribe', () => {
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  // ===========================================================================
  // WebSocket Connection Tests
  // ===========================================================================

  describe('WebSocket connection', () => {
    it('opens WebSocket to doUrl + /sync', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toBe('wss://example.com/do/123/sync')
    })

    it('sends subscribe message on open', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      expect(ws.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'subscribe',
        collection: 'Task',
      })
    })

    it('sends subscribe message with branch when specified', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        branch: 'feature-branch',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'subscribe',
        collection: 'Task',
        branch: 'feature-branch',
      })
    })

    it('returns unsubscribe function', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      expect(typeof unsubscribe).toBe('function')
    })
  })

  // ===========================================================================
  // Initial Data Handling Tests
  // ===========================================================================

  describe('initial data handling', () => {
    it('calls begin() before processing initial message', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 100,
      })

      // Verify call order using mock.invocationCallOrder
      expect(callbacks.begin).toHaveBeenCalled()
      expect(callbacks.onData).toHaveBeenCalled()
      expect(callbacks.begin.mock.invocationCallOrder[0]).toBeLessThan(
        callbacks.onData.mock.invocationCallOrder[0]
      )
    })

    it('calls onData with initial items', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const items = [
        {
          $id: 'task-1',
          $type: 'Task',
          name: 'Task 1',
          data: { title: 'First task', completed: false },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          $id: 'task-2',
          $type: 'Task',
          name: 'Task 2',
          data: { title: 'Second task', completed: true },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: items,
        txid: 100,
      })

      expect(callbacks.onData).toHaveBeenCalledWith(items)
    })

    it('calls commit with txid after initial message', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 100,
      })

      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 100 })
      // Verify call order
      expect(callbacks.onData.mock.invocationCallOrder[0]).toBeLessThan(
        callbacks.commit.mock.invocationCallOrder[0]
      )
    })
  })

  // ===========================================================================
  // Change Stream Handling Tests
  // ===========================================================================

  describe('change stream handling', () => {
    it('handles insert message with begin/commit pattern', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const newTask = {
        $id: 'task-3',
        $type: 'Task',
        name: 'Task 3',
        data: { title: 'New task', completed: false },
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      }

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: newTask.$id,
        data: newTask,
        txid: 101,
      })

      expect(callbacks.begin).toHaveBeenCalled()
      expect(callbacks.onInsert).toHaveBeenCalledWith(newTask)
      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 101 })
    })

    it('handles update message with begin/commit pattern', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      const updatedTask = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Task 1',
        data: { title: 'Updated task', completed: true },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      }

      ws.simulateMessage({
        type: 'update',
        collection: 'Task',
        key: updatedTask.$id,
        data: updatedTask,
        txid: 102,
      })

      expect(callbacks.begin).toHaveBeenCalled()
      expect(callbacks.onUpdate).toHaveBeenCalledWith(updatedTask)
      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 102 })
    })

    it('handles delete message with begin/commit pattern', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      ws.simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 103,
      })

      expect(callbacks.begin).toHaveBeenCalled()
      expect(callbacks.onDelete).toHaveBeenCalledWith({ id: 'task-1' })
      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 103 })
    })
  })

  // ===========================================================================
  // Reconnection Tests
  // ===========================================================================

  describe('reconnection', () => {
    it('reconnects on close with exponential backoff', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      expect(MockWebSocket.instances).toHaveLength(1)

      // First close - should reconnect after 1 second
      MockWebSocket.instances[0].simulateClose()
      expect(MockWebSocket.instances).toHaveLength(1)

      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second close - should reconnect after 2 seconds (exponential backoff)
      MockWebSocket.instances[1].simulateClose()
      expect(MockWebSocket.instances).toHaveLength(2)

      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2) // Not yet

      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('re-sends subscribe message on reconnection', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        branch: 'main',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws1 = MockWebSocket.instances[0]
      ws1.simulateOpen()
      expect(ws1.send).toHaveBeenCalledTimes(1)

      ws1.simulateClose()
      vi.advanceTimersByTime(1000)

      const ws2 = MockWebSocket.instances[1]
      ws2.simulateOpen()

      expect(ws2.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(ws2.send.mock.calls[0][0])).toEqual({
        type: 'subscribe',
        collection: 'Task',
        branch: 'main',
      })
    })

    it('resets reconnect attempts after successful connection', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      // Close and reconnect
      MockWebSocket.instances[0].simulateClose()
      vi.advanceTimersByTime(1000)

      // Successful connection
      MockWebSocket.instances[1].simulateOpen()

      // Close again - should use 1 second delay (reset)
      MockWebSocket.instances[1].simulateClose()
      expect(MockWebSocket.instances).toHaveLength(2)

      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('caps backoff delay at 30 seconds', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      // Simulate many failed reconnection attempts
      for (let i = 0; i < 10; i++) {
        MockWebSocket.instances[i].simulateClose()
        // Even after 10 attempts, delay should not exceed 30 seconds
        vi.advanceTimersByTime(30000)
        expect(MockWebSocket.instances).toHaveLength(i + 2)
      }
    })
  })

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe('cleanup', () => {
    it('unsubscribe sends unsubscribe message and closes socket', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Clear the subscribe message call
      ws.send.mockClear()

      unsubscribe()

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'unsubscribe', collection: 'Task' })
      )
      expect(ws.close).toHaveBeenCalled()
    })

    it('unsubscribe cancels pending reconnection', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      // Close connection, triggering reconnection timer
      MockWebSocket.instances[0].simulateClose()

      // Unsubscribe before reconnection
      unsubscribe()

      // Advance timers - should not create new connection
      vi.advanceTimersByTime(30000)
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('unsubscribe is safe to call multiple times', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Call unsubscribe multiple times
      expect(() => {
        unsubscribe()
        unsubscribe()
        unsubscribe()
      }).not.toThrow()
    })
  })

  // ===========================================================================
  // Collection Options Tests
  // ===========================================================================

  describe('collection options', () => {
    it('returns correct id based on collection name', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      expect(options.id).toBe('dotdo:Task')
    })

    it('returns schema from config', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      expect(options.schema).toBe(TaskSchema)
    })

    it('getKey returns $id from item', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task: Task = {
        $id: 'task-123',
        $type: 'Task',
        name: 'Test',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(options.getKey(task)).toBe('task-123')
    })
  })
})
