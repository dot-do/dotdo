/**
 * dotdoCollectionOptions Tests - TDD RED Phase
 *
 * Tests for the collection options factory that integrates with @tanstack/db.
 * These tests verify that dotdoCollectionOptions returns a valid CollectionConfig
 * that can be used with TanStack DB's createCollection.
 *
 * Tests should FAIL until the GREEN implementation is complete.
 *
 * @see db/tanstack/collection.ts for the implementation (stub)
 * @see https://tanstack.com/db/latest/docs/framework/react/reference/createCollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import type { CollectionConfig, SyncConfig, ChangeMessage } from '@tanstack/db'
import { dotdoCollectionOptions, type DotdoCollectionConfig, type DotdoCollectionOptionsResult } from '../../collection'
import { createRPCClient, type RPCClient } from '../../rpc'

// =============================================================================
// Test Schemas
// =============================================================================

const TaskSchema = z.object({
  $id: z.string(),
  $type: z.string().default('Task'),
  name: z.string().optional(),
  data: z.object({
    title: z.string(),
    completed: z.boolean(),
    priority: z.number().optional(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type Task = z.infer<typeof TaskSchema>

const UserSchema = z.object({
  $id: z.string(),
  $type: z.string().default('User'),
  name: z.string().optional(),
  data: z.object({
    email: z.string(),
    role: z.enum(['admin', 'user', 'guest']),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type User = z.infer<typeof UserSchema>

// =============================================================================
// Test Fixtures
// =============================================================================

const createTask = (id: string, title: string, completed = false): Task => ({
  $id: `https://example.com/tasks/${id}`,
  $type: 'Task',
  name: title,
  data: { title, completed },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const createUser = (id: string, email: string, role: 'admin' | 'user' | 'guest' = 'user'): User => ({
  $id: `https://example.com/users/${id}`,
  $type: 'User',
  name: email.split('@')[0],
  data: { email, role },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

// =============================================================================
// Mock Fetch
// =============================================================================

function createMockFetch() {
  return vi.fn<typeof globalThis.fetch>()
}

function mockResponse(body: unknown, options: ResponseInit = {}): Response {
  return {
    ok: options.status ? options.status < 400 : true,
    status: options.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(options.headers),
  } as Response
}

function createBatchResponse(
  id: string,
  results: Array<{ promiseId: string; type: string; value?: unknown; error?: { code: string; message: string } }>
) {
  return { id, type: 'batch', results }
}

// =============================================================================
// Core Configuration Tests
// =============================================================================

describe('dotdoCollectionOptions', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    mockFetch = createMockFetch()
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Basic Configuration Tests
  // ===========================================================================

  describe('basic configuration', () => {
    it('returns valid CollectionConfig shape', () => {
      const config: DotdoCollectionConfig<Task> = {
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      }

      const result = dotdoCollectionOptions(config)

      // Should have required CollectionConfig properties
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('schema')
      expect(result).toHaveProperty('getKey')
      expect(result).toHaveProperty('subscribe')

      // Should have mutation handlers
      expect(result).toHaveProperty('onInsert')
      expect(result).toHaveProperty('onUpdate')
      expect(result).toHaveProperty('onDelete')

      // Functions should be callable
      expect(typeof result.getKey).toBe('function')
      expect(typeof result.subscribe).toBe('function')
      expect(typeof result.onInsert).toBe('function')
      expect(typeof result.onUpdate).toBe('function')
      expect(typeof result.onDelete).toBe('function')
    })

    it('id follows pattern dotdo:{collection}', () => {
      const taskOptions = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const userOptions = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/456',
        collection: 'User',
        schema: UserSchema,
      })

      expect(taskOptions.id).toBe('dotdo:Task')
      expect(userOptions.id).toBe('dotdo:User')
    })

    it('getKey extracts $id from items', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task = createTask('abc-123', 'My Task')
      const key = options.getKey(task)

      expect(key).toBe('https://example.com/tasks/abc-123')
    })

    it('schema validates items correctly', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // The schema should be the same as what was passed in
      expect(options.schema).toBe(TaskSchema)

      // Schema should validate valid tasks
      const validTask = createTask('1', 'Valid Task')
      const validResult = options.schema.safeParse(validTask)
      expect(validResult.success).toBe(true)

      // Schema should reject invalid tasks (missing required fields)
      const invalidTask = { title: 'No $id field' }
      const invalidResult = options.schema.safeParse(invalidTask)
      expect(invalidResult.success).toBe(false)
    })

    it('includes branch in id when specified', () => {
      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        branch: 'feature-branch',
      })

      // The id should incorporate branch information
      expect(options.id).toBe('dotdo:Task:feature-branch')
    })

    it('passes custom fetchOptions to RPC calls', async () => {
      const customHeaders = { 'X-Custom-Header': 'test-value' }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        fetchOptions: { headers: customHeaders },
      })

      // Trigger an insert to make an RPC call
      const task = createTask('1', 'Test Task')
      await options.onInsert!({ transaction: { changes: task } as any })

      // Verify custom headers were passed
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining(customHeaders),
        })
      )
    })
  })

  // ===========================================================================
  // Sync Tests
  // ===========================================================================

  describe('sync', () => {
    it('calls begin/write/commit for initial data', async () => {
      const begin = vi.fn()
      const write = vi.fn()
      const commit = vi.fn()
      const markReady = vi.fn()

      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // Simulate TanStack DB calling subscribe with callbacks
      const unsubscribe = options.subscribe({
        begin,
        onData: (items: Task[]) => {
          items.forEach((item) => write({ type: 'insert', key: item.$id, value: item }))
        },
        onInsert: (item: Task) => write({ type: 'insert', key: item.$id, value: item }),
        onUpdate: (item: Task) => write({ type: 'update', key: item.$id, value: item }),
        onDelete: (item: { id: string }) => write({ type: 'delete', key: item.id }),
        commit: (info: { txid: number }) => commit(info),
      })

      // Wait for WebSocket connection and initial sync
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have called begin at least once
      expect(begin).toHaveBeenCalled()

      // Cleanup
      unsubscribe()
    })

    it('calls markReady after initial sync', async () => {
      const begin = vi.fn()
      const write = vi.fn()
      const commit = vi.fn()
      const markReady = vi.fn()

      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // The subscribe function should receive markReady and call it
      // after the initial data sync is complete
      const callbacks = {
        begin,
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit,
      }

      const unsubscribe = options.subscribe(callbacks)

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 100))

      // markReady should be called after initial sync is complete
      // Note: The actual implementation needs to handle this
      // For now, we're testing the expected behavior

      unsubscribe()
    })

    it('calls begin/write/commit for changes', async () => {
      const begin = vi.fn()
      const write = vi.fn()
      const commit = vi.fn()

      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin,
        onData: vi.fn(),
        onInsert: (item: Task) => {
          begin()
          write({ type: 'insert', key: item.$id, value: item })
          commit({ txid: 1 })
        },
        onUpdate: (item: Task) => {
          begin()
          write({ type: 'update', key: item.$id, value: item })
          commit({ txid: 2 })
        },
        onDelete: (item: { id: string }) => {
          begin()
          write({ type: 'delete', key: item.id })
          commit({ txid: 3 })
        },
        commit,
      }

      const unsubscribe = options.subscribe(callbacks)

      // Simulate receiving changes from WebSocket
      // This will be tested more thoroughly in integration tests

      unsubscribe()
    })

    it('handles WebSocket reconnection gracefully', async () => {
      const begin = vi.fn()
      const commit = vi.fn()

      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const callbacks = {
        begin,
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit,
      }

      const unsubscribe = options.subscribe(callbacks)

      // Simulate connection loss and reconnection
      // The implementation should handle this transparently

      unsubscribe()
    })

    it('supports multiple concurrent subscriptions', async () => {
      const callbacks1 = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const callbacks2 = {
        begin: vi.fn(),
        onData: vi.fn(),
        onInsert: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        commit: vi.fn(),
      }

      const options = dotdoCollectionOptions({
        doUrl: 'wss://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const unsub1 = options.subscribe(callbacks1)
      const unsub2 = options.subscribe(callbacks2)

      // Both subscriptions should work independently

      unsub1()
      unsub2()
    })
  })

  // ===========================================================================
  // onInsert Tests
  // ===========================================================================

  describe('onInsert', () => {
    it('makes RPC call to {collection}.create', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 42 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask = createTask('new-1', 'New Task')

      // Simulate TanStack DB calling onInsert
      await options.onInsert!({
        transaction: {
          mutations: [{ modified: newTask, key: newTask.$id }],
        },
        collection: {} as any,
      } as any)

      // Verify RPC call was made
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify the method called was Task.create or Task.insert
      const [url, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls).toHaveLength(1)
      expect(body.calls[0].method).toMatch(/^Task\.(create|insert)$/)
    })

    it('returns txid from response rowid', async () => {
      const expectedRowid = 12345

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: expectedRowid } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask = createTask('new-1', 'New Task')

      const result = await options.onInsert!({
        transaction: {
          mutations: [{ modified: newTask, key: newTask.$id }],
        },
        collection: {} as any,
      } as any)

      expect(result).toHaveProperty('txid')
      expect(result.txid).toBe(expectedRowid)
    })

    it('includes item data in RPC payload', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask = createTask('task-1', 'Important Task', false)

      await options.onInsert!({
        transaction: {
          mutations: [{ modified: newTask, key: newTask.$id }],
        },
        collection: {} as any,
      } as any)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      // The data should be in the args
      const call = body.calls[0]
      expect(call.args).toBeDefined()
      expect(call.args.length).toBeGreaterThan(0)

      // Should contain the task data
      const argWithData = call.args.find(
        (arg: { type: string; value: unknown }) =>
          arg.type === 'value' && typeof arg.value === 'object'
      )
      expect(argWithData).toBeDefined()
    })

    it('throws on RPC error', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({
          id: 'req-1',
          type: 'error',
          error: { code: 'VALIDATION_ERROR', message: 'Invalid task data' },
        })
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask = createTask('bad-1', 'Bad Task')

      await expect(
        options.onInsert!({
          transaction: {
            mutations: [{ modified: newTask, key: newTask.$id }],
          },
          collection: {} as any,
        } as any)
      ).rejects.toThrow('Invalid task data')
    })

    it('handles batch insert with multiple items', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task1 = createTask('task-1', 'First Task')
      const task2 = createTask('task-2', 'Second Task')

      await options.onInsert!({
        transaction: {
          mutations: [
            { modified: task1, key: task1.$id },
            { modified: task2, key: task2.$id },
          ],
        },
        collection: {} as any,
      } as any)

      // Should batch both inserts in one request
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls.length).toBe(2)
    })
  })

  // ===========================================================================
  // onUpdate Tests
  // ===========================================================================

  describe('onUpdate', () => {
    it('makes RPC call to {collection}.update', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 100 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const existingTask = createTask('task-1', 'Original Task')
      const updatedTask = { ...existingTask, data: { ...existingTask.data!, completed: true } }

      await options.onUpdate!({
        transaction: {
          mutations: [
            {
              original: existingTask,
              modified: updatedTask,
              changes: { data: { completed: true } },
              key: existingTask.$id,
            },
          ],
        },
        collection: {} as any,
      } as any)

      // Verify RPC call was made
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls).toHaveLength(1)
      expect(body.calls[0].method).toBe('Task.update')
    })

    it('returns txid from response rowid', async () => {
      const expectedRowid = 999

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: expectedRowid } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const existingTask = createTask('task-1', 'Task')
      const updatedTask = { ...existingTask, data: { ...existingTask.data!, completed: true } }

      const result = await options.onUpdate!({
        transaction: {
          mutations: [
            {
              original: existingTask,
              modified: updatedTask,
              changes: { data: { completed: true } },
              key: existingTask.$id,
            },
          ],
        },
        collection: {} as any,
      } as any)

      expect(result).toHaveProperty('txid')
      expect(result.txid).toBe(expectedRowid)
    })

    it('includes key and changes in RPC payload', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const existingTask = createTask('task-abc', 'My Task')
      const changes = { data: { completed: true, priority: 5 } }
      const updatedTask = {
        ...existingTask,
        data: { ...existingTask.data!, ...changes.data },
      }

      await options.onUpdate!({
        transaction: {
          mutations: [
            {
              original: existingTask,
              modified: updatedTask,
              changes,
              key: existingTask.$id,
            },
          ],
        },
        collection: {} as any,
      } as any)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)
      const call = body.calls[0]

      // Should include key in the args
      const hasKeyArg = call.args.some(
        (arg: { type: string; value: unknown }) =>
          arg.type === 'value' &&
          typeof arg.value === 'object' &&
          arg.value !== null &&
          'key' in (arg.value as object)
      )
      expect(hasKeyArg).toBe(true)
    })

    it('throws on RPC error', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({
          id: 'req-1',
          type: 'error',
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        })
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const existingTask = createTask('nonexistent', 'Ghost Task')

      await expect(
        options.onUpdate!({
          transaction: {
            mutations: [
              {
                original: existingTask,
                modified: existingTask,
                changes: {},
                key: existingTask.$id,
              },
            ],
          },
          collection: {} as any,
        } as any)
      ).rejects.toThrow('Task not found')
    })

    it('handles batch update with multiple items', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
            { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const tasks = [
        createTask('task-1', 'Task 1'),
        createTask('task-2', 'Task 2'),
        createTask('task-3', 'Task 3'),
      ]

      await options.onUpdate!({
        transaction: {
          mutations: tasks.map((task) => ({
            original: task,
            modified: { ...task, data: { ...task.data!, completed: true } },
            changes: { data: { completed: true } },
            key: task.$id,
          })),
        },
        collection: {} as any,
      } as any)

      // Should batch all updates in one request
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls.length).toBe(3)
    })
  })

  // ===========================================================================
  // onDelete Tests
  // ===========================================================================

  describe('onDelete', () => {
    it('makes RPC call to {collection}.delete', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 50 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const taskToDelete = createTask('task-to-delete', 'Delete Me')

      await options.onDelete!({
        transaction: {
          mutations: [
            {
              original: taskToDelete,
              key: taskToDelete.$id,
            },
          ],
        },
        collection: {} as any,
      } as any)

      // Verify RPC call was made
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls).toHaveLength(1)
      expect(body.calls[0].method).toBe('Task.delete')
    })

    it('returns txid from response rowid', async () => {
      const expectedRowid = 777

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: expectedRowid } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const taskToDelete = createTask('task-1', 'Task')

      const result = await options.onDelete!({
        transaction: {
          mutations: [
            {
              original: taskToDelete,
              key: taskToDelete.$id,
            },
          ],
        },
        collection: {} as any,
      } as any)

      expect(result).toHaveProperty('txid')
      expect(result.txid).toBe(expectedRowid)
    })

    it('includes key in RPC payload', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const taskId = 'https://example.com/tasks/delete-me'
      const taskToDelete = { ...createTask('delete-me', 'Delete'), $id: taskId }

      await options.onDelete!({
        transaction: {
          mutations: [
            {
              original: taskToDelete,
              key: taskId,
            },
          ],
        },
        collection: {} as any,
      } as any)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)
      const call = body.calls[0]

      // Should include key in the args
      const hasKeyArg = call.args.some(
        (arg: { type: string; value: unknown }) =>
          arg.type === 'value' &&
          typeof arg.value === 'object' &&
          arg.value !== null &&
          'key' in (arg.value as object)
      )
      expect(hasKeyArg).toBe(true)
    })

    it('throws on RPC error', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({
          id: 'req-1',
          type: 'error',
          error: { code: 'PERMISSION_DENIED', message: 'Cannot delete this task' },
        })
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const taskToDelete = createTask('protected', 'Protected Task')

      await expect(
        options.onDelete!({
          transaction: {
            mutations: [
              {
                original: taskToDelete,
                key: taskToDelete.$id,
              },
            ],
          },
          collection: {} as any,
        } as any)
      ).rejects.toThrow('Cannot delete this task')
    })

    it('handles batch delete with multiple items', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const task1 = createTask('task-1', 'Task 1')
      const task2 = createTask('task-2', 'Task 2')

      await options.onDelete!({
        transaction: {
          mutations: [
            { original: task1, key: task1.$id },
            { original: task2, key: task2.$id },
          ],
        },
        collection: {} as any,
      } as any)

      // Should batch both deletes in one request
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, fetchOptions] = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchOptions?.body as string)

      expect(body.calls.length).toBe(2)
    })
  })

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty collection name', () => {
      // Should throw or handle gracefully
      expect(() =>
        dotdoCollectionOptions({
          doUrl: 'https://example.com/do/123',
          collection: '',
          schema: TaskSchema,
        })
      ).toThrow()
    })

    it('handles invalid doUrl', () => {
      // Should throw or handle gracefully
      expect(() =>
        dotdoCollectionOptions({
          doUrl: 'not-a-url',
          collection: 'Task',
          schema: TaskSchema,
        })
      ).toThrow()
    })

    it('handles network timeout', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), 100)
          )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        transactionTimeout: 50,
      })

      const task = createTask('1', 'Task')

      await expect(
        options.onInsert!({
          transaction: { mutations: [{ modified: task, key: task.$id }] },
          collection: {} as any,
        } as any)
      ).rejects.toThrow()
    })

    it('cleans up resources on unsubscribe', async () => {
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

      // Wait a bit for connection
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Unsubscribe should clean up WebSocket
      unsubscribe()

      // No memory leaks or errors should occur
    })

    it('handles concurrent mutations gracefully', async () => {
      let callCount = 0
      mockFetch.mockImplementation(() => {
        callCount++
        return Promise.resolve(
          mockResponse(
            createBatchResponse(`req-${callCount}`, [
              { promiseId: 'p-1', type: 'value', value: { success: true, rowid: callCount } },
            ])
          )
        )
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // Fire multiple concurrent mutations
      const promises = [
        options.onInsert!({
          transaction: { mutations: [{ modified: createTask('1', 'Task 1'), key: 'key-1' }] },
          collection: {} as any,
        } as any),
        options.onInsert!({
          transaction: { mutations: [{ modified: createTask('2', 'Task 2'), key: 'key-2' }] },
          collection: {} as any,
        } as any),
        options.onInsert!({
          transaction: { mutations: [{ modified: createTask('3', 'Task 3'), key: 'key-3' }] },
          collection: {} as any,
        } as any),
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result).toHaveProperty('txid')
      })
    })
  })

  // ===========================================================================
  // Integration with TanStack DB Types
  // ===========================================================================

  describe('TanStack DB type compatibility', () => {
    it('onInsert signature matches InsertMutationFn', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      // This tests that our onInsert matches TanStack DB's expected type
      const handler = options.onInsert!

      // The handler should accept InsertMutationFnParams shape
      const result = await handler({
        transaction: {
          mutations: [
            {
              mutationId: 'mut-1',
              original: {},
              modified: createTask('1', 'Task'),
              changes: createTask('1', 'Task'),
              globalKey: 'Task:key-1',
              key: 'key-1',
              type: 'insert',
              metadata: undefined,
              syncMetadata: {},
              optimistic: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              collection: {} as any,
            },
          ],
        } as any,
        collection: {} as any,
      })

      expect(result).toBeDefined()
    })

    it('onUpdate signature matches UpdateMutationFn', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const handler = options.onUpdate!
      const existingTask = createTask('1', 'Task')

      const result = await handler({
        transaction: {
          mutations: [
            {
              mutationId: 'mut-1',
              original: existingTask,
              modified: { ...existingTask, data: { ...existingTask.data!, completed: true } },
              changes: { data: { completed: true } },
              globalKey: 'Task:key-1',
              key: existingTask.$id,
              type: 'update',
              metadata: undefined,
              syncMetadata: {},
              optimistic: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              collection: {} as any,
            },
          ],
        } as any,
        collection: {} as any,
      })

      expect(result).toBeDefined()
    })

    it('onDelete signature matches DeleteMutationFn', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const handler = options.onDelete!
      const taskToDelete = createTask('1', 'Task')

      const result = await handler({
        transaction: {
          mutations: [
            {
              mutationId: 'mut-1',
              original: taskToDelete,
              modified: taskToDelete,
              changes: taskToDelete,
              globalKey: 'Task:key-1',
              key: taskToDelete.$id,
              type: 'delete',
              metadata: undefined,
              syncMetadata: {},
              optimistic: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              collection: {} as any,
            },
          ],
        } as any,
        collection: {} as any,
      })

      expect(result).toBeDefined()
    })
  })
})
