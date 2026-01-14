/**
 * Tests for useDotdoCollection hook
 *
 * RED phase: Tests define the useDotdoCollection contract
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import * as React from 'react'
import { z } from 'zod'
import { SyncProvider } from '../../src/react/provider'
import { useDotdoCollection } from '../../src/react/use-dotdo-collection'

// Mock fetch
const mockFetch = vi.fn()

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

// WebSocket mock with message handling
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  url: string
  private handlers: Map<string, Array<(event: Event | MessageEvent | CloseEvent) => void>> = new Map()

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

  addEventListener(event: string, handler: (event: Event | MessageEvent | CloseEvent) => void) {
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

// Test wrapper component
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider doUrl="https://api.example.com/do/workspace">
      {children}
    </SyncProvider>
  )
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
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('useDotdoCollection', () => {
  describe('data loading', () => {
    it('should return isLoading=true before initial sync', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      expect(hookResult!.isLoading).toBe(true)
    })

    it('should return empty array as initial data', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      expect(hookResult!.data).toEqual([])
    })

    it('should return data after initial sync message', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return <div data-testid="loading">{hookResult.isLoading ? 'loading' : 'loaded'}</div>
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Simulate initial data
      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Test Task', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(hookResult!.isLoading).toBe(false)
        expect(hookResult!.data).toHaveLength(1)
        expect(hookResult!.data[0].title).toBe('Test Task')
      })
    })

    it('should update data reactively on insert message', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Send initial data
      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      // Send insert
      await act(async () => {
        ws.receiveMessage({
          type: 'insert',
          collection: 'Task',
          data: { $id: 'new-1', title: 'New Task', status: 'todo' },
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(hookResult!.data).toHaveLength(1)
        expect(hookResult!.data[0].$id).toBe('new-1')
      })
    })

    it('should update data reactively on update message', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Send initial data
      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      // Send update
      await act(async () => {
        ws.receiveMessage({
          type: 'update',
          collection: 'Task',
          key: '1',
          data: { $id: '1', title: 'Updated', status: 'done' },
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(hookResult!.data[0].title).toBe('Updated')
        expect(hookResult!.data[0].status).toBe('done')
      })
    })

    it('should remove item reactively on delete message', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Send initial data
      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            { $id: '1', title: 'Task 1', status: 'todo' },
            { $id: '2', title: 'Task 2', status: 'todo' },
          ],
          txid: 1,
        })
      })

      // Send delete
      await act(async () => {
        ws.receiveMessage({
          type: 'delete',
          collection: 'Task',
          key: '1',
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(hookResult!.data).toHaveLength(1)
        expect(hookResult!.data[0].$id).toBe('2')
      })
    })
  })

  describe('mutations', () => {
    it('should provide insert function that returns optimistic item immediately', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Send initial empty data
      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      // Call insert
      const newTask = { $id: 'temp-1', title: 'New Task', status: 'todo' as const }
      act(() => {
        hookResult!.insert(newTask)
      })

      // Should be in data immediately (optimistic)
      expect(hookResult!.data).toContainEqual(newTask)
    })

    it('should call RPC on insert', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      await act(async () => {
        await hookResult!.insert({ $id: 'temp-1', title: 'New Task', status: 'todo' })
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should rollback insert on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      // Insert will fail
      await act(async () => {
        try {
          await hookResult!.insert({ $id: 'temp-1', title: 'New Task', status: 'todo' })
        } catch {
          // Expected
        }
      })

      // Should be rolled back
      await waitFor(() => {
        expect(hookResult!.data).toHaveLength(0)
      })
    })

    it('should apply optimistic update immediately', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      // Call update
      act(() => {
        hookResult!.update('1', { title: 'Updated' })
      })

      // Should be updated immediately (optimistic)
      expect(hookResult!.data[0].title).toBe('Updated')
    })

    it('should rollback update on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      // Update will fail
      await act(async () => {
        try {
          await hookResult!.update('1', { title: 'Updated' })
        } catch {
          // Expected
        }
      })

      // Should be rolled back
      await waitFor(() => {
        expect(hookResult!.data[0].title).toBe('Original')
      })
    })

    it('should remove item optimistically on delete', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Task 1', status: 'todo' }],
          txid: 1,
        })
      })

      // Call delete
      act(() => {
        hookResult!.delete('1')
      })

      // Should be removed immediately (optimistic)
      expect(hookResult!.data).toHaveLength(0)
    })

    it('should restore item on delete error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Task 1', status: 'todo' }],
          txid: 1,
        })
      })

      // Delete will fail
      await act(async () => {
        try {
          await hookResult!.delete('1')
        } catch {
          // Expected
        }
      })

      // Should be restored
      await waitFor(() => {
        expect(hookResult!.data).toHaveLength(1)
        expect(hookResult!.data[0].$id).toBe('1')
      })
    })
  })

  describe('queries', () => {
    it('should provide findById that returns item by $id', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            { $id: '1', title: 'Task 1', status: 'todo' },
            { $id: '2', title: 'Task 2', status: 'done' },
          ],
          txid: 1,
        })
      })

      const found = hookResult!.findById('2')
      expect(found).toBeDefined()
      expect(found!.title).toBe('Task 2')
    })

    it('should return undefined for missing id', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      await act(async () => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Task 1', status: 'todo' }],
          txid: 1,
        })
      })

      const found = hookResult!.findById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('branch support', () => {
    it('should support branch parameter', async () => {
      let hookResult: ReturnType<typeof useDotdoCollection<Task>> | null = null

      function TestComponent() {
        hookResult = useDotdoCollection<Task>({
          collection: 'Task',
          schema: TaskSchema,
          branch: 'feature-x',
        })
        return null
      }

      render(<TestComponent />, { wrapper: TestWrapper })

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      // Just verify it doesn't throw
      expect(hookResult).toBeDefined()
    })
  })
})
