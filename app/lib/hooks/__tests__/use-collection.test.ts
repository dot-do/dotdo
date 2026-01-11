/**
 * useCollection Hook Tests (RED phase - TDD)
 *
 * These tests define the contract for the useCollection hook - CRUD + real-time
 * sync built on top of use$ (useDollar).
 *
 * Tests are expected to FAIL until the implementation is created.
 *
 * The useCollection hook provides:
 * - Query operations (findAll, findById, findWhere)
 * - Mutation operations (insert, update, delete, bulk operations)
 * - Optimistic mutations with rollback on error
 * - Real-time sync via $ proxy
 * - Zod validation
 * - Cursor-based pagination
 *
 * @see app/lib/hooks/use-collection.ts (implementation to be created)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { z } from 'zod'

// Import the hook under test (will fail until implemented)
import { useCollection } from '../use-collection'

// =============================================================================
// Test Schema
// =============================================================================

const UserSchema = z.object({
  $id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().optional(),
})

type User = z.infer<typeof UserSchema>

// =============================================================================
// Mock $ Proxy
// =============================================================================

function createMock$() {
  const eventHandlers: Record<string, Set<(data: unknown) => void>> = {}

  const mock$ = {
    // Collection RPC methods
    collection: vi.fn().mockReturnValue({
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation(async (data) => ({ $id: 'new-id', ...data })),
      update: vi.fn().mockImplementation(async (id, data) => ({ $id: id, ...data })),
      delete: vi.fn().mockResolvedValue(undefined),
      insertMany: vi.fn().mockImplementation(async (items) =>
        items.map((item: Omit<User, '$id'>, i: number) => ({ $id: `new-id-${i}`, ...item }))
      ),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      findWhere: vi.fn().mockResolvedValue([]),
      loadMore: vi.fn().mockResolvedValue({ items: [], cursor: null }),
    }),

    // Event subscriptions
    on: new Proxy(
      {},
      {
        get: (_, noun) => {
          return new Proxy(
            {},
            {
              get: (_, verb) => {
                return (handler: (data: unknown) => void) => {
                  const eventName = `${String(noun)}.${String(verb)}`
                  if (!eventHandlers[eventName]) {
                    eventHandlers[eventName] = new Set()
                  }
                  eventHandlers[eventName].add(handler)
                  // Return unsubscribe function
                  return () => {
                    eventHandlers[eventName]?.delete(handler)
                  }
                }
              },
            }
          )
        },
      }
    ),

    // Test helpers
    _emit: (eventName: string, data: unknown) => {
      eventHandlers[eventName]?.forEach((handler) => handler(data))
    },
    _handlers: eventHandlers,
  }

  return mock$
}

type Mock$ = ReturnType<typeof createMock$>

// =============================================================================
// Test Setup
// =============================================================================

describe('useCollection', () => {
  let mock$: Mock$

  beforeEach(() => {
    vi.clearAllMocks()
    mock$ = createMock$()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Query Operations Tests
  // ===========================================================================

  describe('query operations', () => {
    it('findAll() returns all collection items', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
        { $id: '2', name: 'Bob', email: 'bob@example.com.ai' },
      ]

      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.findAll()).toEqual(users)
      expect(result.current.data).toEqual(users)
    })

    it('findById(id) returns single item or null', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }

      mock$.collection().findAll.mockResolvedValue([user])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.findById('1')).toEqual(user)
      expect(result.current.findById('nonexistent')).toBeNull()
    })

    it('findWhere(predicate) filters items', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai', age: 30 },
        { $id: '2', name: 'Bob', email: 'bob@example.com.ai', age: 25 },
        { $id: '3', name: 'Alice', email: 'alice2@example.com.ai', age: 28 },
      ]

      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Filter by name
      const alices = result.current.findWhere({ name: 'Alice' })
      expect(alices).toHaveLength(2)
      expect(alices.every((u) => u.name === 'Alice')).toBe(true)
    })

    it('data is reactive (re-renders on changes)', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
      ]

      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(1)

      // Simulate external change event
      act(() => {
        mock$._emit('users.change', {
          type: 'insert',
          data: { $id: '2', name: 'Bob', email: 'bob@example.com.ai' },
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Mutation Operations Tests
  // ===========================================================================

  describe('mutation operations', () => {
    it('insert(data) adds item and returns with $id', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      let insertedUser: User

      await act(async () => {
        insertedUser = await result.current.insert({
          name: 'Charlie',
          email: 'charlie@example.com.ai',
        })
      })

      expect(insertedUser!).toHaveProperty('$id')
      expect(insertedUser!.name).toBe('Charlie')
      expect(insertedUser!.email).toBe('charlie@example.com.ai')
    })

    it('update(id, data) modifies item', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])
      mock$.collection().update.mockResolvedValue({
        $id: '1',
        name: 'Alice Updated',
        email: 'alice@example.com.ai',
      })

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      let updatedUser: User

      await act(async () => {
        updatedUser = await result.current.update('1', { name: 'Alice Updated' })
      })

      expect(updatedUser!.name).toBe('Alice Updated')
    })

    it('delete(id) removes item', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(1)

      await act(async () => {
        await result.current.delete('1')
      })

      // Item should be removed from local data
      expect(result.current.data).toHaveLength(0)
    })

    it('insertMany(items) bulk inserts', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      let insertedUsers: User[]

      await act(async () => {
        insertedUsers = await result.current.insertMany([
          { name: 'User1', email: 'user1@example.com.ai' },
          { name: 'User2', email: 'user2@example.com.ai' },
        ])
      })

      expect(insertedUsers!).toHaveLength(2)
      expect(insertedUsers!.every((u) => u.$id)).toBe(true)
    })

    it('deleteMany(ids) bulk deletes', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
        { $id: '2', name: 'Bob', email: 'bob@example.com.ai' },
        { $id: '3', name: 'Charlie', email: 'charlie@example.com.ai' },
      ]
      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(3)

      await act(async () => {
        await result.current.deleteMany(['1', '2'])
      })

      expect(result.current.data).toHaveLength(1)
      expect(result.current.data[0].$id).toBe('3')
    })
  })

  // ===========================================================================
  // Optimistic Mutations Tests
  // ===========================================================================

  describe('optimistic mutations', () => {
    it('insert shows immediately before server confirms', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      // Make insert slow to verify optimistic behavior
      let resolveInsert: (value: User) => void
      mock$.collection().insert.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInsert = resolve
          })
      )

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Start insert (don't await)
      act(() => {
        result.current.insert({ name: 'Pending', email: 'pending@example.com.ai' })
      })

      // Should show optimistically immediately
      await waitFor(() => {
        expect(result.current.data.some((u) => u.name === 'Pending')).toBe(true)
      })

      // Resolve server response
      act(() => {
        resolveInsert!({ $id: 'server-id', name: 'Pending', email: 'pending@example.com.ai' })
      })
    })

    it('update reflects immediately', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])

      let resolveUpdate: (value: User) => void
      mock$.collection().update.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve
          })
      )

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Start update (don't await)
      act(() => {
        result.current.update('1', { name: 'Alice Updated' })
      })

      // Should show optimistically immediately
      await waitFor(() => {
        expect(result.current.findById('1')?.name).toBe('Alice Updated')
      })

      // Resolve server response
      act(() => {
        resolveUpdate!({ $id: '1', name: 'Alice Updated', email: 'alice@example.com.ai' })
      })
    })

    it('delete removes immediately', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])

      let resolveDelete: () => void
      mock$.collection().delete.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDelete = resolve
          })
      )

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(1)

      // Start delete (don't await)
      act(() => {
        result.current.delete('1')
      })

      // Should be removed optimistically immediately
      await waitFor(() => {
        expect(result.current.data).toHaveLength(0)
      })

      // Resolve server response
      act(() => {
        resolveDelete!()
      })
    })

    it('rollback on server validation failure', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])
      mock$.collection().update.mockRejectedValue(new Error('Server validation failed'))

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Attempt update that will fail
      await act(async () => {
        try {
          await result.current.update('1', { name: '' })
        } catch {
          // Expected to fail
        }
      })

      // Should rollback to original value
      await waitFor(() => {
        expect(result.current.findById('1')?.name).toBe('Alice')
      })
    })
  })

  // ===========================================================================
  // Real-time Sync Tests
  // ===========================================================================

  describe('real-time sync', () => {
    it('subscribes to collection changes via $', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        // Should have subscribed to users.change
        expect(mock$._handlers['users.change']).toBeDefined()
        expect(mock$._handlers['users.change'].size).toBeGreaterThan(0)
      })
    })

    it('external changes trigger re-render', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
      ]
      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(1)

      // Simulate external insert from another client
      act(() => {
        mock$._emit('users.change', {
          type: 'insert',
          data: { $id: '2', name: 'Bob', email: 'bob@example.com.ai' },
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(2)
      })

      // Simulate external update
      act(() => {
        mock$._emit('users.change', {
          type: 'update',
          data: { $id: '1', name: 'Alice Updated', email: 'alice@example.com.ai' },
        })
      })

      await waitFor(() => {
        expect(result.current.findById('1')?.name).toBe('Alice Updated')
      })

      // Simulate external delete
      act(() => {
        mock$._emit('users.change', {
          type: 'delete',
          id: '2',
        })
      })

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1)
      })
    })

    it('handles concurrent updates', async () => {
      const users: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
      ]
      mock$.collection().findAll.mockResolvedValue(users)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Start local update
      let resolveUpdate: (value: User) => void
      mock$.collection().update.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve
          })
      )

      act(() => {
        result.current.update('1', { name: 'Local Update' })
      })

      // Receive external update while local is pending
      act(() => {
        mock$._emit('users.change', {
          type: 'update',
          data: { $id: '1', name: 'Remote Update', email: 'alice@example.com.ai' },
        })
      })

      // Resolve local update - server wins
      act(() => {
        resolveUpdate!({ $id: '1', name: 'Local Update', email: 'alice@example.com.ai' })
      })

      // Final state should reflect resolved state
      await waitFor(() => {
        expect(result.current.findById('1')?.name).toBe('Local Update')
      })
    })
  })

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('Zod schema validates on insert', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Try to insert invalid data
      await act(async () => {
        try {
          await result.current.insert({
            name: '', // Invalid: min length 1
            email: 'invalid-email', // Invalid: not an email
          })
          expect.fail('Should have thrown validation error')
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }
      })

      // Should not have called the server
      expect(mock$.collection().insert).not.toHaveBeenCalled()
    })

    it('Zod schema validates on update', async () => {
      const user: User = { $id: '1', name: 'Alice', email: 'alice@example.com.ai' }
      mock$.collection().findAll.mockResolvedValue([user])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Try to update with invalid data
      await act(async () => {
        try {
          await result.current.update('1', {
            email: 'not-an-email', // Invalid
          })
          expect.fail('Should have thrown validation error')
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }
      })

      // Should not have called the server
      expect(mock$.collection().update).not.toHaveBeenCalled()
    })

    it('invalid data throws with field errors', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Try to insert with multiple invalid fields
      await act(async () => {
        try {
          await result.current.insert({
            name: '',
            email: 'bad',
          })
        } catch (error: any) {
          // Error should contain field-level information
          expect(error.message).toContain('name')
          expect(error.message).toContain('email')
        }
      })
    })
  })

  // ===========================================================================
  // Pagination Tests
  // ===========================================================================

  describe('pagination', () => {
    it('cursor-based pagination works', async () => {
      const page1: User[] = [
        { $id: '1', name: 'User1', email: 'u1@example.com.ai' },
        { $id: '2', name: 'User2', email: 'u2@example.com.ai' },
      ]

      mock$.collection().findAll.mockResolvedValue(page1)
      mock$.collection().loadMore.mockResolvedValue({
        items: [
          { $id: '3', name: 'User3', email: 'u3@example.com.ai' },
          { $id: '4', name: 'User4', email: 'u4@example.com.ai' },
        ],
        cursor: 'cursor-after-4',
      })

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(2)

      // Load more
      await act(async () => {
        await result.current.loadMore()
      })

      expect(result.current.data).toHaveLength(4)
    })

    it('hasMore indicates additional data', async () => {
      mock$.collection().findAll.mockResolvedValue([
        { $id: '1', name: 'User1', email: 'u1@example.com.ai' },
      ])

      // First loadMore returns more data
      mock$.collection().loadMore.mockResolvedValueOnce({
        items: [{ $id: '2', name: 'User2', email: 'u2@example.com.ai' }],
        cursor: 'next-cursor',
        hasMore: true,
      })

      // Second loadMore returns end of data
      mock$.collection().loadMore.mockResolvedValueOnce({
        items: [{ $id: '3', name: 'User3', email: 'u3@example.com.ai' }],
        cursor: null,
        hasMore: false,
      })

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.hasMore).toBe(true)

      await act(async () => {
        await result.current.loadMore()
      })

      expect(result.current.hasMore).toBe(true)

      await act(async () => {
        await result.current.loadMore()
      })

      expect(result.current.hasMore).toBe(false)
    })

    it('loadMore fetches next page', async () => {
      mock$.collection().findAll.mockResolvedValue([
        { $id: '1', name: 'User1', email: 'u1@example.com.ai' },
      ])
      mock$.collection().loadMore.mockResolvedValue({
        items: [{ $id: '2', name: 'User2', email: 'u2@example.com.ai' }],
        cursor: 'cursor-2',
      })

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await act(async () => {
        await result.current.loadMore()
      })

      // Should have called loadMore with current cursor
      expect(mock$.collection().loadMore).toHaveBeenCalled()
      expect(result.current.data).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Refresh Tests
  // ===========================================================================

  describe('refresh', () => {
    it('refetch() reloads data from server', async () => {
      const initialUsers: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
      ]

      mock$.collection().findAll.mockResolvedValue(initialUsers)

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.data).toHaveLength(1)

      // Update mock to return different data
      const updatedUsers: User[] = [
        { $id: '1', name: 'Alice', email: 'alice@example.com.ai' },
        { $id: '2', name: 'Bob', email: 'bob@example.com.ai' },
      ]
      mock$.collection().findAll.mockResolvedValue(updatedUsers)

      // Refetch
      await act(async () => {
        await result.current.refetch()
      })

      expect(result.current.data).toHaveLength(2)
      expect(mock$.collection().findAll).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Return Value Interface Tests
  // ===========================================================================

  describe('return value interface', () => {
    it('returns data array', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(Array.isArray(result.current.data)).toBe(true)
    })

    it('returns isLoading boolean', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.isLoading).toBe('boolean')
    })

    it('returns error or null', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(result.current.error === null || result.current.error instanceof Error).toBe(true)
    })

    it('returns findById function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.findById).toBe('function')
    })

    it('returns findAll function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.findAll).toBe('function')
    })

    it('returns findWhere function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.findWhere).toBe('function')
    })

    it('returns insert function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.insert).toBe('function')
    })

    it('returns update function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.update).toBe('function')
    })

    it('returns delete function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.delete).toBe('function')
    })

    it('returns insertMany function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.insertMany).toBe('function')
    })

    it('returns deleteMany function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.deleteMany).toBe('function')
    })

    it('returns hasMore boolean', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.hasMore).toBe('boolean')
    })

    it('returns loadMore function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.loadMore).toBe('function')
    })

    it('returns refetch function', async () => {
      mock$.collection().findAll.mockResolvedValue([])

      const { result } = renderHook(() =>
        useCollection({
          name: 'users',
          schema: UserSchema,
          $: mock$ as unknown as any,
        })
      )

      expect(typeof result.current.refetch).toBe('function')
    })
  })
})
