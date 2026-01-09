import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dotdoCollectionOptions } from '../../src/client/collection'
import { z } from 'zod'

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

describe('client/mutations', () => {
  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ===========================================================================
  // onInsert Tests
  // ===========================================================================

  describe('onInsert', () => {
    it('calls POST to /rpc/{Collection}.create', async () => {
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
        name: 'New Task',
        data: { title: 'Test', completed: false },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await options.onInsert!({ transaction: { changes: newTask } })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/do/123/rpc/Task.create',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(newTask),
        })
      )
    })

    it('returns txid from response rowid', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 456 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const result = await options.onInsert!({ transaction: { changes: newTask } })

      expect(result).toEqual({ txid: 456 })
    })

    it('throws error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await expect(options.onInsert!({ transaction: { changes: newTask } }))
        .rejects.toThrow('Network error')
    })

    it('throws error on 4xx response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Validation failed'),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await expect(options.onInsert!({ transaction: { changes: newTask } }))
        .rejects.toThrow('RPC create failed: Validation failed')
    })

    it('throws error on 5xx response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const newTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      await expect(options.onInsert!({ transaction: { changes: newTask } }))
        .rejects.toThrow('RPC create failed: Internal server error')
    })
  })

  // ===========================================================================
  // onUpdate Tests
  // ===========================================================================

  describe('onUpdate', () => {
    it('calls POST to /rpc/{Collection}.update with id and data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 789 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const changes = { data: { title: 'Updated', completed: true } }

      await options.onUpdate!({
        id: 'task-1',
        data: changes,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/do/123/rpc/Task.update',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ id: 'task-1', data: changes }),
        })
      )
    })

    it('returns txid from response rowid', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 789 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const result = await options.onUpdate!({
        id: 'task-1',
        data: { data: { title: 'Updated', completed: true } },
      })

      expect(result).toEqual({ txid: 789 })
    })

    it('throws error on server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      await expect(options.onUpdate!({ id: 'task-1', data: {} }))
        .rejects.toThrow('RPC update failed: Not found')
    })
  })

  // ===========================================================================
  // onDelete Tests
  // ===========================================================================

  describe('onDelete', () => {
    it('calls POST to /rpc/{Collection}.delete with id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 999 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      await options.onDelete!({ id: 'task-1' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/do/123/rpc/Task.delete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ id: 'task-1' }),
        })
      )
    })

    it('returns txid from response rowid', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 999 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      const result = await options.onDelete!({ id: 'task-1' })

      expect(result).toEqual({ txid: 999 })
    })

    it('throws error on server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      await expect(options.onDelete!({ id: 'task-1' }))
        .rejects.toThrow('RPC delete failed: Forbidden')
    })
  })

  // ===========================================================================
  // Custom Fetch Options Tests
  // ===========================================================================

  describe('custom fetch options', () => {
    it('passes custom headers to fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 100 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        fetchOptions: {
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          },
        },
      })

      await options.onInsert!({
        transaction: {
          changes: {
            $id: 'task-1',
            $type: 'Task',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          }),
        })
      )
    })

    it('passes credentials option to fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 100 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
        fetchOptions: {
          credentials: 'include',
        },
      })

      await options.onDelete!({ id: 'task-1' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'include',
        })
      )
    })
  })

  // ===========================================================================
  // URL Construction Tests
  // ===========================================================================

  describe('URL construction', () => {
    it('handles doUrl without trailing slash', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 100 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123',
        collection: 'Task',
        schema: TaskSchema,
      })

      await options.onDelete!({ id: 'task-1' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/do/123/rpc/Task.delete',
        expect.any(Object)
      )
    })

    it('handles doUrl with trailing slash', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, rowid: 100 }),
      })

      const options = dotdoCollectionOptions({
        doUrl: 'https://example.com/do/123/',
        collection: 'Task',
        schema: TaskSchema,
      })

      await options.onDelete!({ id: 'task-1' })

      // Should still construct valid URL (implementation decides format)
      expect(mockFetch).toHaveBeenCalled()
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('/rpc/Task.delete')
    })
  })
})
