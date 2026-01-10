/**
 * Tests for useRecord hook
 *
 * RED phase: These tests verify useRecord behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as React from 'react'
import { useRecord } from '../../src/hooks/use-record'
import { DO } from '../../src/provider'

// Types for testing
interface Task {
  $id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  description?: string
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

  emit(event: string, data: unknown) {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(data as { data: string })
    }
  }

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

describe('useRecord', () => {
  describe('finds record by id', () => {
    it('should return specific record from collection', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [
            { $id: 'task-1', title: 'Target Task', status: 'todo' },
            { $id: 'task-2', title: 'Other Task', status: 'done' },
          ],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
        expect(result.current.data?.$id).toBe('task-1')
        expect(result.current.data?.title).toBe('Target Task')
      })
    })

    it('should update when record is updated in collection', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('Original')
      })

      act(() => {
        ws.receiveMessage({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: { $id: 'task-1', title: 'Updated', status: 'done' },
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('Updated')
        expect(result.current.data?.status).toBe('done')
      })
    })

    it('should handle different id types', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'uuid-format-12345' }),
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
          data: [{ $id: 'uuid-format-12345', title: 'UUID Task', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.$id).toBe('uuid-format-12345')
      })
    })
  })

  describe('returns null if not found', () => {
    it('should return null when id does not exist', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'nonexistent' }),
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
          data: [{ $id: 'task-1', title: 'Existing Task', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toBeNull()
    })

    it('should return null for empty collection', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'any-id' }),
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

      expect(result.current.data).toBeNull()
    })

    it('should become null when record is deleted', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Will Be Deleted', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
      })

      act(() => {
        ws.receiveMessage({
          type: 'delete',
          collection: 'Task',
          key: 'task-1',
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data).toBeNull()
      })
    })
  })

  describe('update calls collection update', () => {
    it('should have update function', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
        { wrapper: createWrapper() }
      )

      expect(typeof result.current.update).toBe('function')
    })

    it('should call RPC with correct parameters', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.update({ title: 'Updated Title' })
      })

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Task.update')
      expect(body.calls[0].args[0].value).toMatchObject({ key: 'task-1', title: 'Updated Title' })
    })

    it('should apply optimistic update', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('Original')
      })

      act(() => {
        result.current.update({ title: 'Optimistic' })
      })

      // Should update immediately
      expect(result.current.data?.title).toBe('Optimistic')
    })

    it('should rollback on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Original', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('Original')
      })

      await act(async () => {
        try {
          await result.current.update({ title: 'Will Fail' })
        } catch {
          // Expected to fail
        }
      })

      // Should rollback
      expect(result.current.data?.title).toBe('Original')
    })

    it('should merge partial updates', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Original', status: 'todo', description: 'Test' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        // Only update title, keep other fields
        result.current.update({ title: 'New Title' })
      })

      expect(result.current.data?.title).toBe('New Title')
      expect(result.current.data?.status).toBe('todo')
      expect(result.current.data?.description).toBe('Test')
    })
  })

  describe('delete calls collection delete', () => {
    it('should have delete function', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
        { wrapper: createWrapper() }
      )

      expect(typeof result.current.delete).toBe('function')
    })

    it('should call RPC delete', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'To Delete', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
      })

      await act(async () => {
        await result.current.delete()
      })

      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.calls[0].method).toBe('Task.delete')
    })

    it('should apply optimistic delete', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'To Delete', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
      })

      act(() => {
        result.current.delete()
      })

      // Should become null immediately
      expect(result.current.data).toBeNull()
    })

    it('should rollback delete on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'Protected', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data).not.toBeNull()
      })

      await act(async () => {
        try {
          await result.current.delete()
        } catch {
          // Expected to fail
        }
      })

      // Should restore the record
      expect(result.current.data).not.toBeNull()
      expect(result.current.data?.title).toBe('Protected')
    })
  })

  describe('loading state', () => {
    it('should be loading initially', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.isLoading).toBe(true)
    })

    it('should stop loading after data received', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
  })

  describe('error handling', () => {
    it('should expose error from collection', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
        { wrapper: createWrapper() }
      )

      expect(result.current.error).toBeNull()
    })
  })

  describe('refetch', () => {
    it('should have refetch function', () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
        { wrapper: createWrapper() }
      )

      expect(typeof result.current.refetch).toBe('function')
    })

    it('should trigger refetch', async () => {
      const { result } = renderHook(
        () => useRecord<Task>({ collection: 'Task', id: 'task-1' }),
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
          data: [{ $id: 'task-1', title: 'First', status: 'todo' }],
          txid: 1,
        })
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

  describe('id changes', () => {
    it('should find different record when id prop changes', async () => {
      const { result, rerender } = renderHook(
        ({ id }) => useRecord<Task>({ collection: 'Task', id }),
        { wrapper: createWrapper(), initialProps: { id: 'task-1' } }
      )

      await waitFor(() => {
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)
      })

      const ws = MockWebSocket.instances[0]

      // Send initial data for task-1
      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: 'task-1', title: 'First Task', status: 'todo' }],
          txid: 1,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('First Task')
      })

      // Change id - hook will send new subscription and set loading
      rerender({ id: 'task-2' })

      // Should go back to loading state while waiting for new record
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true)
      })

      // Send data for the new record (simulating server response to subscription)
      act(() => {
        ws.receiveMessage({
          type: 'initial',
          collection: 'Task',
          data: [{ $id: 'task-2', title: 'Second Task', status: 'done' }],
          txid: 2,
        })
      })

      await waitFor(() => {
        expect(result.current.data?.title).toBe('Second Task')
      })
    })
  })
})
