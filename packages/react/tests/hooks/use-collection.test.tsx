/**
 * Tests for useCollection hook
 *
 * RED phase: These tests verify useCollection behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as React from 'react'
import { useCollection } from '../../src/hooks/use-collection'
import { DO } from '../../src/provider'

// Types for testing
interface Task {
  $id: string
  title: string
  status: 'todo' | 'done'
  createdAt: number
}

// Mock fetch
const mockFetch = vi.fn()

// Mock @dotdo/client
vi.mock('@dotdo/client', () => ({
  createClient: vi.fn(() => ({
    connectionState: 'connected',
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}))

// WebSocket mock with message handling
type WSEventHandler = (event: { data: string }) => void

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
      this.emit('open', {})
    }, 0)
  }

  send = vi.fn()

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  })

  addEventListener = vi.fn((event: string, handler: WSEventHandler) => {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  })

  removeEventListener = vi.fn()

  // Emit events for testing
  emit(event: string, data: unknown) {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(data as { data: string })
    }
  }

  // Simulate receiving a message
  receiveMessage(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) })
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ results: [{ value: { success: true, rowid: 1 } }] }),
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// Provider wrapper for hooks
function createWrapper(ns = 'https://api.example.com/do/workspace') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DO ns={ns}>{children}</DO>
  }
}

describe('useCollection', () => {
  describe('returns empty data initially', () => {
    it('should return empty array for data', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.data).toEqual([])
    })

    it('should have zero length data array', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.data.length).toBe(0)
    })
  })

  describe('sets isLoading=true initially', () => {
    it('should have isLoading true before data arrives', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.isLoading).toBe(true)
    })

    it('should have no error initially', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.error).toBeNull()
    })

    it('should have pendingMutations at 0 initially', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.pendingMutations).toBe(0)
    })
  })

  describe('connects to WebSocket', () => {
    it('should create WebSocket connection', async () => {
      renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })
    })

    it('should connect to correct sync URL', async () => {
      renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper('https://api.example.com/do/workspace') }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
        const ws = MockWebSocket.instances[0]
        expect(ws.url).toBe('wss://api.example.com/do/workspace/sync')
      })
    })

    it('should send subscribe message on open', async () => {
      renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        const ws = MockWebSocket.instances[0]
        expect(ws.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'subscribe', collection: 'Task' })
        )
      })
    })

    it('should include branch in subscribe message if provided', async () => {
      renderHook(
        () => useCollection<Task>({ collection: 'Task', branch: 'feature-x' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        const ws = MockWebSocket.instances[0]
        expect(ws.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'subscribe', collection: 'Task', branch: 'feature-x' })
        )
      })
    })
  })

  describe('receives initial data', () => {
    it('should update data when initial message received', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]
      const initialData: Task[] = [
        { $id: '1', title: 'Task 1', status: 'todo', createdAt: Date.now() },
        { $id: '2', title: 'Task 2', status: 'done', createdAt: Date.now() },
      ]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: initialData,
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
        expect(result.current.data[0].title).toBe('Task 1')
      })
    })

    it('should set isLoading=false after initial data', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should update txid after initial data', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 42,
        })
      })

      await waitFor(() => {
        expect(result.current.txid).toBe(42)
      })
    })
  })

  describe('handles insert/update/delete messages', () => {
    it('should add item on insert message', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Initial data
      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [],
          txid: 1,
        })
      })

      // Insert new item
      act(() => {
        ws.receiveMessage({
          type: 'insert',
          collection: 'Task',
          data: { $id: '1', title: 'New Task', status: 'todo', createdAt: Date.now() },
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
        expect(result.current.data[0].title).toBe('New Task')
      })
    })

    it('should update item on update message', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Initial data
      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo', createdAt: Date.now() }],
          txid: 1,
        })
      })

      // Update item
      act(() => {
        ws.receiveMessage({
          type: 'update',
          collection: 'Task',
          key: '1',
          data: { $id: '1', title: 'Updated', status: 'done', createdAt: Date.now() },
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data[0].title).toBe('Updated')
        expect(result.current.data[0].status).toBe('done')
      })
    })

    it('should remove item on delete message', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Initial data with 2 items
      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [
            { $id: '1', title: 'Task 1', status: 'todo', createdAt: Date.now() },
            { $id: '2', title: 'Task 2', status: 'todo', createdAt: Date.now() },
          ],
          txid: 1,
        })
      })

      // Delete first item
      act(() => {
        ws.receiveMessage({
          type: 'delete',
          collection: 'Task',
          key: '1',
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
        expect(result.current.data[0].$id).toBe('2')
      })
    })

    it('should update txid on each message', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 10 })
      })

      await waitFor(() => {
        expect(result.current.txid).toBe(10)
      })

      act(() => {
        ws.receiveMessage({
          type: 'insert',
          collection: 'Task',
          data: { $id: '1', title: 'New', status: 'todo', createdAt: Date.now() },
          txid: 15,
        })
      })

      await waitFor(() => {
        expect(result.current.txid).toBe(15)
      })
    })
  })

  describe('optimistic updates work', () => {
    it('should update data immediately on insert', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 1 })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const newTask: Task = { $id: 'new-1', title: 'Optimistic Task', status: 'todo', createdAt: Date.now() }

      // Insert with optimistic update
      act(() => {
        result.current.insert(newTask)
      })

      // Data should update immediately (before RPC completes)
      expect(result.current.data).toContainEqual(newTask)
    })

    it('should increment pendingMutations on mutation', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 1 })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const newTask: Task = { $id: 'new-1', title: 'Test', status: 'todo', createdAt: Date.now() }

      // Start mutation
      act(() => {
        result.current.insert(newTask)
      })

      expect(result.current.pendingMutations).toBeGreaterThan(0)
    })

    it('should update data immediately on update', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo', createdAt: Date.now() }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Update with optimistic update
      act(() => {
        result.current.update('1', { title: 'Updated' })
      })

      // Data should update immediately
      expect(result.current.data[0].title).toBe('Updated')
    })

    it('should remove data immediately on delete', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'To Delete', status: 'todo', createdAt: Date.now() }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })

      // Delete with optimistic update
      act(() => {
        result.current.delete('1')
      })

      // Data should be removed immediately
      expect(result.current.data).toHaveLength(0)
    })
  })

  describe('rollback on error', () => {
    it('should rollback insert on RPC failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 1 })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const newTask: Task = { $id: 'new-1', title: 'Will Fail', status: 'todo', createdAt: Date.now() }

      // Insert that will fail
      let insertError: Error | null = null
      await act(async () => {
        try {
          await result.current.insert(newTask)
        } catch (e) {
          insertError = e as Error
        }
      })

      expect(insertError).not.toBeNull()

      // Data should be rolled back
      expect(result.current.data).toHaveLength(0)
    })

    it('should rollback update on RPC failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Original', status: 'todo', createdAt: Date.now() }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Update that will fail
      let updateError: Error | null = null
      await act(async () => {
        try {
          await result.current.update('1', { title: 'Will Fail' })
        } catch (e) {
          updateError = e as Error
        }
      })

      expect(updateError).not.toBeNull()

      // Data should be rolled back to original
      expect(result.current.data[0].title).toBe('Original')
    })

    it('should rollback delete on RPC failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: '1', title: 'Will Survive', status: 'todo', createdAt: Date.now() }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })

      // Delete that will fail
      let deleteError: Error | null = null
      await act(async () => {
        try {
          await result.current.delete('1')
        } catch (e) {
          deleteError = e as Error
        }
      })

      expect(deleteError).not.toBeNull()

      // Data should be restored
      expect(result.current.data).toHaveLength(1)
      expect(result.current.data[0].title).toBe('Will Survive')
    })

    it('should decrement pendingMutations after failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 1 })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        try {
          await result.current.insert({ $id: '1', title: 'Test', status: 'todo', createdAt: Date.now() })
        } catch {
          // Expected to fail
        }
      })

      expect(result.current.pendingMutations).toBe(0)
    })
  })

  describe('refetch', () => {
    it('should have refetch function', () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      expect(typeof result.current.refetch).toBe('function')
    })

    it('should set isLoading true on refetch', async () => {
      const { result } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.receiveMessage({ type: 'initial', collection: 'Task', data: [], txid: 1 })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        result.current.refetch()
      })

      expect(result.current.isLoading).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should close WebSocket on unmount', async () => {
      const { unmount } = renderHook(
        () => useCollection<Task>({ collection: 'Task' }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      unmount()

      expect(ws.close).toHaveBeenCalled()
    })
  })
})
