/**
 * Tests for TanStack DB CollectionOptions factory
 *
 * RED phase: These tests verify CollectionOptions behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { CollectionOptions, type CollectionCallbacks } from '../../src/tanstack/collection-options'

// Types for testing
interface Task {
  $id: string
  title: string
  status: 'todo' | 'done'
}

const TaskSchema = z.object({
  $id: z.string(),
  title: z.string(),
  status: z.enum(['todo', 'done']),
})

// Mock fetch
const mockFetch = vi.fn()

// WebSocket mock with message handling
type WSEventHandler = (event: MessageEvent | Event | CloseEvent) => void

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  url: string
  private handlers: Map<string, WSEventHandler[]> = new Map()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.emit('open', new Event('open'))
    }, 0)
  }

  send = vi.fn()

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', new CloseEvent('close'))
  })

  addEventListener(event: string, handler: WSEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  }

  removeEventListener = vi.fn()

  emit(event: string, data: Event | MessageEvent | CloseEvent) {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(data)
    }
  }

  receiveMessage(data: unknown) {
    const messageEvent = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.emit('message', messageEvent)
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
    }),
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('CollectionOptions', () => {
  describe('configuration', () => {
    it('should create options with required fields', () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      expect(options).toBeDefined()
      expect(options.id).toBeDefined()
      expect(options.schema).toBe(TaskSchema)
    })

    it('should generate unique id based on collection', () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      expect(options.id).toBe('dotdo:Task')
    })

    it('should include branch in id when provided', () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        branch: 'feature-x',
        schema: TaskSchema,
      })

      expect(options.id).toBe('dotdo:Task:feature-x')
    })

    it('should provide getKey function', () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task: Task = { $id: 'task-123', title: 'Test', status: 'todo' }
      expect(options.getKey(task)).toBe('task-123')
    })

    it('should throw for invalid doUrl', () => {
      expect(() => {
        CollectionOptions({
          doUrl: 'invalid-url',
          collection: 'Task',
          schema: TaskSchema,
        })
      }).toThrow('Invalid doUrl')
    })

    it('should throw for empty collection name', () => {
      expect(() => {
        CollectionOptions({
          doUrl: 'wss://api.example.com/do/workspace',
          collection: '',
          schema: TaskSchema,
        })
      }).toThrow('Collection name cannot be empty')
    })

    it('should accept http URLs and convert for WebSocket', () => {
      const options = CollectionOptions({
        doUrl: 'https://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      expect(options).toBeDefined()
    })
  })

  describe('subscribe', () => {
    it('should return unsubscribe function', () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
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

    it('should create WebSocket connection', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })
    })

    it('should call begin on subscribe', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      expect(callbacks.begin).toHaveBeenCalled()
    })

    it('should call onData with initial data', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      ws.receiveMessage({
        type: 'initial',
        collection: 'Task',
        data: [{ $id: '1', title: 'Test', status: 'todo' }],
        txid: 1,
      })

      await vi.waitFor(() => {
        expect(callbacks.onData).toHaveBeenCalledWith([
          { $id: '1', title: 'Test', status: 'todo' },
        ])
      })
    })

    it('should call commit after initial data', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      ws.receiveMessage({
        type: 'initial',
        collection: 'Task',
        data: [],
        txid: 42,
      })

      await vi.waitFor(() => {
        expect(callbacks.commit).toHaveBeenCalledWith({ txid: 42 })
      })
    })

    it('should call onInsert for insert messages', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      ws.receiveMessage({
        type: 'insert',
        collection: 'Task',
        data: { $id: '1', title: 'New Task', status: 'todo' },
        txid: 1,
      })

      await vi.waitFor(() => {
        expect(callbacks.onInsert).toHaveBeenCalledWith({
          $id: '1',
          title: 'New Task',
          status: 'todo',
        })
      })
    })

    it('should call onUpdate for update messages', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      ws.receiveMessage({
        type: 'update',
        collection: 'Task',
        data: { $id: '1', title: 'Updated Task', status: 'done' },
        txid: 2,
      })

      await vi.waitFor(() => {
        expect(callbacks.onUpdate).toHaveBeenCalledWith({
          $id: '1',
          title: 'Updated Task',
          status: 'done',
        })
      })
    })

    it('should call onDelete for delete messages', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      ws.receiveMessage({
        type: 'delete',
        collection: 'Task',
        key: '1',
        txid: 3,
      })

      await vi.waitFor(() => {
        expect(callbacks.onDelete).toHaveBeenCalledWith({ id: '1' })
      })
    })

    it('should disconnect on unsubscribe', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks: CollectionCallbacks<Task> = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const unsubscribe = options.subscribe(callbacks)

      await vi.waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      unsubscribe()

      expect(ws.close).toHaveBeenCalled()
    })
  })

  describe('onInsert', () => {
    it('should call RPC create method', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      await options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Task.create')
    })

    it('should return txid from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          type: 'result',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 42 } }],
        }),
      })

      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      const result = await options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])

      expect(result.txid).toBe(42)
    })

    it('should handle multiple inserts as batch', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          type: 'result',
          results: [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          ],
        }),
      })

      const ctx = {
        transaction: {
          mutations: [
            { key: 'task-1', modified: { $id: 'task-1', title: 'First', status: 'todo' } },
            { key: 'task-2', modified: { $id: 'task-2', title: 'Second', status: 'todo' } },
          ],
        },
        collection: {},
      }

      await options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls.length).toBe(2)
    })
  })

  describe('onUpdate', () => {
    it('should call RPC update method', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', changes: { title: 'Updated' } }],
        },
        collection: {},
      }

      await options.onUpdate(ctx as unknown as Parameters<typeof options.onUpdate>[0])

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Task.update')
    })

    it('should include key in update data', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', changes: { title: 'Updated' } }],
        },
        collection: {},
      }

      await options.onUpdate(ctx as unknown as Parameters<typeof options.onUpdate>[0])

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].args[0].value).toMatchObject({ key: 'task-1', title: 'Updated' })
    })
  })

  describe('onDelete', () => {
    it('should call RPC delete method', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1' }],
        },
        collection: {},
      }

      await options.onDelete(ctx as unknown as Parameters<typeof options.onDelete>[0])

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Task.delete')
    })

    it('should send key to delete', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1' }],
        },
        collection: {},
      }

      await options.onDelete(ctx as unknown as Parameters<typeof options.onDelete>[0])

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].args[0].value).toMatchObject({ key: 'task-1' })
    })
  })

  describe('error handling', () => {
    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      await expect(
        options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])
      ).rejects.toThrow('HTTP error: 500')
    })

    it('should throw on RPC error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          type: 'error',
          error: { code: 'VALIDATION_ERROR', message: 'Invalid data' },
        }),
      })

      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      await expect(
        options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])
      ).rejects.toThrow('Invalid data')
    })

    it('should throw on empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          type: 'result',
          results: [],
        }),
      })

      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      await expect(
        options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])
      ).rejects.toThrow('No results in response')
    })
  })

  describe('fetchOptions', () => {
    it('should pass custom headers', async () => {
      const options = CollectionOptions({
        doUrl: 'wss://api.example.com/do/workspace',
        collection: 'Task',
        schema: TaskSchema,
        fetchOptions: {
          headers: {
            'X-Custom-Header': 'custom-value',
          },
        },
      })

      const ctx = {
        transaction: {
          mutations: [{ key: 'task-1', modified: { $id: 'task-1', title: 'New', status: 'todo' } }],
        },
        collection: {},
      }

      await options.onInsert(ctx as unknown as Parameters<typeof options.onInsert>[0])

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[1].headers).toMatchObject({
        'X-Custom-Header': 'custom-value',
      })
    })
  })
})
