import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { z } from 'zod'

// Import from the (not-yet-existing) react module
// These will fail until implementation exists - that's the RED phase!
import {
  SyncProvider,
  useDotdoCollection,
  type UseDotdoCollectionResult,
} from '../../src/react'

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
  readyState = MockWebSocket.CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
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

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    $id: `task-${Math.random().toString(36).slice(2)}`,
    $type: 'Task',
    name: 'Test Task',
    data: { title: 'Test Title', completed: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// Mock Fetch
// =============================================================================

let mockFetch: ReturnType<typeof vi.fn>

// =============================================================================
// Test Wrapper
// =============================================================================

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider doUrl="wss://example.com/do/123">
      {children}
    </SyncProvider>
  )
}

// =============================================================================
// Test Setup
// =============================================================================

describe('useDotdoCollection', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Data Loading Tests
  // ===========================================================================

  describe('data loading', () => {
    it('returns isLoading=true before initial sync', () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      expect(result?.isLoading).toBe(true)
      expect(result?.data).toEqual([])
    })

    it('returns data after initial sync message', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const initialTasks = [
        createTestTask({ $id: 'task-1', name: 'Task 1' }),
        createTestTask({ $id: 'task-2', name: 'Task 2' }),
      ]

      // Simulate connection and initial data
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: initialTasks,
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.isLoading).toBe(false)
        expect(result?.data).toHaveLength(2)
        expect(result?.data[0].$id).toBe('task-1')
        expect(result?.data[1].$id).toBe('task-2')
      })
    })

    it('returns error on sync failure', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Simulate error
      await act(async () => {
        MockWebSocket.instances[0]?.simulateError(new Error('Sync failed'))
        MockWebSocket.instances[0]?.simulateClose(1006, 'Abnormal closure')
      })

      await waitFor(() => {
        expect(result?.error).toBeDefined()
      })
    })

    it('updates data reactively on insert', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Initial sync with empty data
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.data).toEqual([])
      })

      // Simulate insert
      const newTask = createTestTask({ $id: 'task-new', name: 'New Task' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'insert',
          collection: 'Task',
          key: 'task-new',
          data: newTask,
          txid: 101,
        })
      })

      await waitFor(() => {
        expect(result?.data).toHaveLength(1)
        expect(result?.data[0].$id).toBe('task-new')
      })
    })

    it('updates data reactively on update', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const initialTask = createTestTask({
        $id: 'task-1',
        data: { title: 'Original', completed: false },
      })

      // Initial sync
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [initialTask],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.data[0]?.data?.title).toBe('Original')
      })

      // Simulate update
      const updatedTask = {
        ...initialTask,
        data: { title: 'Updated', completed: true },
        updatedAt: new Date().toISOString(),
      }

      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: updatedTask,
          txid: 102,
        })
      })

      await waitFor(() => {
        expect(result?.data[0]?.data?.title).toBe('Updated')
        expect(result?.data[0]?.data?.completed).toBe(true)
      })
    })

    it('updates data reactively on delete', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const task1 = createTestTask({ $id: 'task-1', name: 'Task 1' })
      const task2 = createTestTask({ $id: 'task-2', name: 'Task 2' })

      // Initial sync
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [task1, task2],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.data).toHaveLength(2)
      })

      // Simulate delete
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'delete',
          collection: 'Task',
          key: 'task-1',
          txid: 103,
        })
      })

      await waitFor(() => {
        expect(result?.data).toHaveLength(1)
        expect(result?.data[0].$id).toBe('task-2')
      })
    })
  })

  // ===========================================================================
  // Insert Mutation Tests
  // ===========================================================================

  describe('mutations - insert', () => {
    it('insert() returns optimistic item immediately', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Setup initial state
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      // Setup mock response (delayed)
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 200 }),
            }),
            1000
          )
        )
      )

      // Call insert
      const newTask = createTestTask({ $id: 'task-optimistic', name: 'Optimistic Task' })

      await act(async () => {
        // Don't await - we want to check optimistic state
        result?.insert(newTask)
      })

      // Item should appear immediately (optimistic)
      await waitFor(() => {
        expect(result?.data).toHaveLength(1)
        expect(result?.data[0].$id).toBe('task-optimistic')
      })
    })

    it('insert() sends RPC request', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Setup initial state
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 200 }),
      })

      const newTask = createTestTask({ $id: 'task-rpc', name: 'RPC Task' })

      await act(async () => {
        await result?.insert(newTask)
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rpc/Task.create'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      )

      // Verify body contains the task
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.$id).toBe('task-rpc')
    })

    it('insert() rolls back on error', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Setup initial state
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      // Make RPC fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      })

      const newTask = createTestTask({ $id: 'task-fail', name: 'Will Fail' })

      // Insert should add optimistically then rollback
      await act(async () => {
        try {
          await result?.insert(newTask)
        } catch {
          // Expected to throw
        }
      })

      // After error, optimistic item should be rolled back
      await waitFor(() => {
        expect(result?.data).toHaveLength(0)
      })
    })

    it('insert() throws on validation error', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Setup initial state
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Validation failed: missing required field'),
      })

      // @ts-expect-error - intentionally passing invalid data
      const invalidTask = { $id: 'bad', incomplete: true }

      await act(async () => {
        await expect(result?.insert(invalidTask as Task)).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // Update Mutation Tests
  // ===========================================================================

  describe('mutations - update', () => {
    it('update() returns optimistic item immediately', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const existingTask = createTestTask({
        $id: 'task-1',
        data: { title: 'Original', completed: false },
      })

      // Setup initial state with existing task
      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [existingTask],
          txid: 100,
        })
      })

      // Setup delayed mock response
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 201 }),
            }),
            1000
          )
        )
      )

      // Call update
      await act(async () => {
        result?.update('task-1', { data: { title: 'Updated', completed: true } })
      })

      // Item should be updated immediately (optimistic)
      await waitFor(() => {
        expect(result?.data[0]?.data?.title).toBe('Updated')
        expect(result?.data[0]?.data?.completed).toBe(true)
      })
    })

    it('update() sends RPC request', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const existingTask = createTestTask({ $id: 'task-1' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [existingTask],
          txid: 100,
        })
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 201 }),
      })

      await act(async () => {
        await result?.update('task-1', { data: { title: 'New Title', completed: true } })
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rpc/Task.update'),
        expect.objectContaining({
          method: 'POST',
        })
      )

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.id).toBe('task-1')
      expect(callBody.data).toHaveProperty('data')
    })

    it('update() rolls back on error', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const existingTask = createTestTask({
        $id: 'task-1',
        data: { title: 'Original', completed: false },
      })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [existingTask],
          txid: 100,
        })
      })

      // Make RPC fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      })

      await act(async () => {
        try {
          await result?.update('task-1', { data: { title: 'Will Fail', completed: true } })
        } catch {
          // Expected to throw
        }
      })

      // After error, should rollback to original value
      await waitFor(() => {
        expect(result?.data[0]?.data?.title).toBe('Original')
        expect(result?.data[0]?.data?.completed).toBe(false)
      })
    })

    it('update() throws for non-existent id', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await act(async () => {
        await expect(
          result?.update('non-existent', { data: { title: 'Test', completed: false } })
        ).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // Delete Mutation Tests
  // ===========================================================================

  describe('mutations - delete', () => {
    it('delete() removes item optimistically', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const task1 = createTestTask({ $id: 'task-1', name: 'Task 1' })
      const task2 = createTestTask({ $id: 'task-2', name: 'Task 2' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [task1, task2],
          txid: 100,
        })
      })

      // Setup delayed mock response
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 202 }),
            }),
            1000
          )
        )
      )

      await act(async () => {
        result?.delete('task-1')
      })

      // Item should be removed immediately (optimistic)
      await waitFor(() => {
        expect(result?.data).toHaveLength(1)
        expect(result?.data[0].$id).toBe('task-2')
      })
    })

    it('delete() sends RPC request', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const existingTask = createTestTask({ $id: 'task-1' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [existingTask],
          txid: 100,
        })
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 202 }),
      })

      await act(async () => {
        await result?.delete('task-1')
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rpc/Task.delete'),
        expect.objectContaining({
          method: 'POST',
        })
      )

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.id).toBe('task-1')
    })

    it('delete() rolls back on error', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const existingTask = createTestTask({ $id: 'task-1', name: 'Original Task' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [existingTask],
          txid: 100,
        })
      })

      // Make RPC fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      })

      await act(async () => {
        try {
          await result?.delete('task-1')
        } catch {
          // Expected to throw
        }
      })

      // After error, item should be restored
      await waitFor(() => {
        expect(result?.data).toHaveLength(1)
        expect(result?.data[0].$id).toBe('task-1')
      })
    })

    it('delete() throws for non-existent id', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await act(async () => {
        await expect(result?.delete('non-existent')).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // Query Tests
  // ===========================================================================

  describe('queries', () => {
    it('findById returns item by $id', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const task1 = createTestTask({ $id: 'task-1', name: 'Task 1' })
      const task2 = createTestTask({ $id: 'task-2', name: 'Task 2' })
      const task3 = createTestTask({ $id: 'task-3', name: 'Task 3' })

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [task1, task2, task3],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.findById('task-2')).toMatchObject({
          $id: 'task-2',
          name: 'Task 2',
        })
      })
    })

    it('findById returns undefined for non-existent id', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      await waitFor(() => {
        expect(result?.findById('non-existent')).toBeUndefined()
      })
    })

    it('filter returns items matching predicate', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      const tasks = [
        createTestTask({ $id: 'task-1', data: { title: 'A', completed: true } }),
        createTestTask({ $id: 'task-2', data: { title: 'B', completed: false } }),
        createTestTask({ $id: 'task-3', data: { title: 'C', completed: true } }),
      ]

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: tasks,
          txid: 100,
        })
      })

      await waitFor(() => {
        const completedTasks = result?.filter(t => t.data?.completed === true)
        expect(completedTasks).toHaveLength(2)
        expect(completedTasks?.[0].$id).toBe('task-1')
        expect(completedTasks?.[1].$id).toBe('task-3')
      })
    })
  })

  // ===========================================================================
  // State Tracking Tests
  // ===========================================================================

  describe('state tracking', () => {
    it('tracks pending mutations count', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 100,
        })
      })

      // Initial state: no pending mutations
      expect(result?.pendingMutations).toBe(0)

      // Setup slow response
      mockFetch.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() =>
            resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, rowid: 200 }),
            }),
            5000
          )
        )
      )

      // Start a mutation (don't await)
      const newTask = createTestTask({ $id: 'pending-task' })
      act(() => {
        result?.insert(newTask)
      })

      // Should have pending mutation
      await waitFor(() => {
        expect(result?.pendingMutations).toBeGreaterThan(0)
      })
    })

    it('tracks last synced txid', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Initial: no txid
      expect(result?.lastTxid).toBeUndefined()

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 150,
        })
      })

      await waitFor(() => {
        expect(result?.lastTxid).toBe(150)
      })

      // Another message updates txid
      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'insert',
          collection: 'Task',
          key: 'new-task',
          data: createTestTask({ $id: 'new-task' }),
          txid: 200,
        })
      })

      await waitFor(() => {
        expect(result?.lastTxid).toBe(200)
      })
    })
  })

  // ===========================================================================
  // Re-render Behavior Tests
  // ===========================================================================

  describe('re-render behavior', () => {
    it('maintains stable reference for data when no changes', async () => {
      const dataRefs: Task[][] = []

      function TestComponent() {
        const result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        dataRefs.push(result.data)
        return null
      }

      const { rerender } = render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [createTestTask({ $id: 'task-1' })],
          txid: 100,
        })
      })

      // Force re-render without data change
      rerender(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Data reference should be stable (referential equality)
      await waitFor(() => {
        // Find consecutive refs after initial data load
        const loadedRefs = dataRefs.filter(d => d.length > 0)
        if (loadedRefs.length >= 2) {
          expect(loadedRefs[0]).toBe(loadedRefs[1])
        }
      })
    })

    it('returns new reference when data changes', async () => {
      const dataRefs: Task[][] = []

      function TestComponent() {
        const result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
        })
        dataRefs.push(result.data)
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'initial',
          collection: 'Task',
          data: [createTestTask({ $id: 'task-1' })],
          txid: 100,
        })
      })

      const beforeInsertRef = dataRefs[dataRefs.length - 1]

      await act(async () => {
        MockWebSocket.instances[0]?.simulateMessage({
          type: 'insert',
          collection: 'Task',
          key: 'task-2',
          data: createTestTask({ $id: 'task-2' }),
          txid: 101,
        })
      })

      await waitFor(() => {
        const afterInsertRef = dataRefs[dataRefs.length - 1]
        expect(afterInsertRef).not.toBe(beforeInsertRef)
        expect(afterInsertRef).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Hook Options Tests
  // ===========================================================================

  describe('hook options', () => {
    it('accepts branch option', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent() {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
          branch: 'feature-branch',
        })
        return null
      }

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      await act(async () => {
        MockWebSocket.instances[0]?.simulateOpen()
      })

      // Check that subscribe message includes branch
      const ws = MockWebSocket.instances[0]
      expect(ws.send).toHaveBeenCalled()
      const sentMessage = JSON.parse(ws.send.mock.calls[0][0])
      expect(sentMessage.branch).toBe('feature-branch')
    })

    it('accepts enabled option', async () => {
      let result: UseDotdoCollectionResult<Task> | null = null

      function TestComponent({ enabled }: { enabled: boolean }) {
        result = useDotdoCollection({
          collection: 'Task',
          schema: TaskSchema,
          enabled,
        })
        return null
      }

      const { rerender } = render(
        <TestWrapper>
          <TestComponent enabled={false} />
        </TestWrapper>
      )

      // Should not connect when disabled
      expect(MockWebSocket.instances).toHaveLength(0)
      expect(result?.isLoading).toBe(false) // Not loading because disabled

      // Enable
      rerender(
        <TestWrapper>
          <TestComponent enabled={true} />
        </TestWrapper>
      )

      // Now should connect
      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })
    })
  })
})
