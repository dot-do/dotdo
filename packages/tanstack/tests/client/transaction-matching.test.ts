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

  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = 3
    this.onclose?.({ code, reason })
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

describe('client/transaction-matching', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket

    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
  })

  // ===========================================================================
  // txid Flow Tests
  // ===========================================================================

  describe('txid flow', () => {
    it('mutation returns txid from server rowid', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 123 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const result = await options.onInsert!({ transaction: { changes: newTask } })

      expect(result.txid).toBe(123)
    })

    it('commit() is called with txid from initial message', () => {
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
        items: [],
        txid: 100,
      })

      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 100 })
    })

    it('commit() is called with txid from change message', () => {
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

      const task: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: task,
        txid: 101,
      })

      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 101 })
    })

    it('txid from mutation matches txid in change stream', async () => {
      // Setup: mock fetch to return rowid: 200
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 200 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // First: subscribe to get change notifications
      const receivedTxids: number[] = []
      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn((info: { txid: number }) => {
          receivedTxids.push(info.txid)
        }),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Get initial state
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 100,
      })

      // Second: make mutation and capture returned txid
      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const mutationResult = await options.onInsert!({ transaction: { changes: newTask } })
      const mutationTxid = mutationResult.txid

      // Third: simulate server broadcasting the change
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: newTask,
        txid: 200, // Same as rowid from mutation
      })

      // Verify the txid from mutation matches the txid from change stream
      expect(mutationTxid).toBe(200)
      expect(receivedTxids).toContain(200)
    })
  })

  // ===========================================================================
  // Concurrent Write Handling Tests
  // ===========================================================================

  describe('concurrent writes', () => {
    it('handles changes from other clients arriving before own change', async () => {
      // Use real timers for this test to avoid async issues
      vi.useRealTimers()

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 102 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const insertedItems: Task[] = []
      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn((item: Task) => {
          insertedItems.push(item)
        }),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Initial state
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 100,
      })

      // Client A (us) makes a mutation - returns txid 102
      const ourTask: Task = {
        $id: 'task-our',
        $type: 'Task',
        name: 'Our task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const mutationPromise = options.onInsert!({ transaction: { changes: ourTask } })

      // Client B's change (txid 101) arrives first
      const otherTask: Task = {
        $id: 'task-other',
        $type: 'Task',
        name: 'Other task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-other',
        data: otherTask,
        txid: 101,
      })

      // Our change (txid 102) arrives after
      await mutationPromise

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-our',
        data: ourTask,
        txid: 102,
      })

      // Both changes should be received
      expect(insertedItems).toHaveLength(2)
      expect(insertedItems[0].$id).toBe('task-other')
      expect(insertedItems[1].$id).toBe('task-our')

      // Restore fake timers for other tests
      vi.useFakeTimers()
    })

    it('multiple concurrent mutations get distinct txids', async () => {
      let rowidCounter = 200
      mockFetch.mockImplementation(() => {
        const currentRowid = rowidCounter++
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, rowid: currentRowid }),
        })
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task1: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const task2: Task = {
        $id: 'task-2',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      // Fire off concurrent mutations
      const [result1, result2] = await Promise.all([
        options.onInsert!({ transaction: { changes: task1 } }),
        options.onInsert!({ transaction: { changes: task2 } }),
      ])

      // Each should have a unique txid
      expect(result1.txid).toBe(200)
      expect(result2.txid).toBe(201)
      expect(result1.txid).not.toBe(result2.txid)
    })
  })

  // ===========================================================================
  // Out-of-Order Message Tests
  // ===========================================================================

  describe('out-of-order messages', () => {
    it('handles messages arriving out of order', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const commitCalls: number[] = []
      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn((info: { txid: number }) => {
          commitCalls.push(info.txid)
        }),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Initial
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 100,
      })

      // txid 102 arrives before 101
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-2',
        data: {
          $id: 'task-2',
          $type: 'Task',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        txid: 102,
      })

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: {
          $id: 'task-1',
          $type: 'Task',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        txid: 101,
      })

      // Both messages should be processed (TanStack DB handles ordering)
      expect(commitCalls).toContain(102)
      expect(commitCalls).toContain(101)
    })

    it('each change commits with its own txid regardless of order', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const insertedWithTxid: Array<{ id: string; txid: number }> = []
      let lastTxid = 0

      const callbacks = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn((item: Task) => {
          // Store the item with the txid it will be committed with
          insertedWithTxid.push({ id: item.$id, txid: lastTxid })
        }),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn((info: { txid: number }) => {
          lastTxid = info.txid
        }),
      }

      options.subscribe(callbacks)

      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Send messages out of order
      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-later',
        data: {
          $id: 'task-later',
          $type: 'Task',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        txid: 105,
      })

      ws.simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-earlier',
        data: {
          $id: 'task-earlier',
          $type: 'Task',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        txid: 103,
      })

      // Each message was committed with its own txid
      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 105 })
      expect(callbacks.commit).toHaveBeenCalledWith({ txid: 103 })
    })
  })

  // ===========================================================================
  // Transaction Timeout Tests
  // ===========================================================================

  describe('transaction timeout', () => {
    it('accepts transactionTimeout configuration', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        transactionTimeout: 5000,
      })

      // Config is accepted without error
      expect(options).toBeDefined()
      expect(options.id).toBe('dotdo:Task')
    })

    it('default transactionTimeout is available in config', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        // No transactionTimeout - should use default
      })

      // Options should be created without error
      expect(options).toBeDefined()
    })

    it('mutation failure triggers proper error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server timeout'),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        transactionTimeout: 1000,
      })

      const task: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await expect(options.onInsert!({ transaction: { changes: task } }))
        .rejects.toThrow('RPC create failed: Server timeout')
    })

    it('network timeout triggers proper error', async () => {
      // Simulate network timeout by rejecting
      mockFetch.mockRejectedValue(new Error('Request timed out'))

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        transactionTimeout: 1000,
      })

      const task: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await expect(options.onInsert!({ transaction: { changes: task } }))
        .rejects.toThrow('Request timed out')
    })
  })

  // ===========================================================================
  // Integration with TanStack DB Patterns
  // ===========================================================================

  describe('TanStack DB integration patterns', () => {
    it('onInsert returns txid for awaitTxId matching', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 500 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const result = await options.onInsert!({ transaction: { changes: task } })

      // Result shape matches what TanStack DB expects for awaitTxId
      expect(result).toHaveProperty('txid')
      expect(typeof result.txid).toBe('number')
    })

    it('onUpdate returns txid for awaitTxId matching', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 501 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const result = await options.onUpdate!({
        id: 'task-1',
        data: { name: 'Updated' },
      })

      expect(result).toHaveProperty('txid')
      expect(typeof result.txid).toBe('number')
    })

    it('onDelete returns txid for awaitTxId matching', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 502 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const result = await options.onDelete!({ id: 'task-1' })

      expect(result).toHaveProperty('txid')
      expect(typeof result.txid).toBe('number')
    })

    it('commit callback receives txid for TanStack DB state reconciliation', () => {
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
        items: [],
        txid: 999,
      })

      // commit shape matches TanStack DB expectations
      expect(callbacks.commit).toHaveBeenCalledWith(
        expect.objectContaining({ txid: expect.any(Number) })
      )
    })
  })
})
