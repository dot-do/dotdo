/**
 * Admin Hooks Tests
 *
 * Tests for useResource and useResourceRecord hooks.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  AdminProvider,
  useResource,
  useResourceRecord,
  useAdminContext,
} from '../../src/admin'
import type { DataProvider, BaseRecord } from '../../src/admin/types'

// =============================================================================
// Mock Setup
// =============================================================================

interface TestUser extends BaseRecord {
  $id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

const mockUsers: TestUser[] = [
  { $id: 'user-1', name: 'Alice', email: 'alice@example.com.ai', role: 'admin' },
  { $id: 'user-2', name: 'Bob', email: 'bob@example.com.ai', role: 'user' },
  { $id: 'user-3', name: 'Charlie', email: 'charlie@example.com.ai', role: 'user' },
]

function createMockDataProvider(): DataProvider {
  return {
    getList: vi.fn().mockResolvedValue({
      data: mockUsers,
      total: mockUsers.length,
    }),
    getOne: vi.fn().mockImplementation(async ({ id }) => {
      const user = mockUsers.find((u) => u.$id === id)
      if (!user) throw new Error('Not found')
      return { data: user }
    }),
    getMany: vi.fn().mockImplementation(async ({ ids }) => ({
      data: mockUsers.filter((u) => ids.includes(u.$id)),
    })),
    create: vi.fn().mockImplementation(async ({ data }) => ({
      data: { $id: 'user-new', ...data },
    })),
    update: vi.fn().mockImplementation(async ({ id, data }) => {
      const user = mockUsers.find((u) => u.$id === id)
      return { data: { ...user, ...data } }
    }),
    delete: vi.fn().mockImplementation(async ({ id, previousData }) => ({
      data: previousData || { $id: id },
    })),
    deleteMany: vi.fn().mockImplementation(async ({ ids }) => ({
      data: ids,
    })),
  }
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(dataProvider: DataProvider) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AdminProvider dataProvider={dataProvider}>{children}</AdminProvider>
    )
  }
}

// =============================================================================
// useAdminContext Tests
// =============================================================================

describe('useAdminContext', () => {
  it('should throw when used outside AdminProvider', () => {
    const { result } = renderHook(() => {
      try {
        return useAdminContext()
      } catch (err) {
        return { error: err }
      }
    })

    expect(result.current).toHaveProperty('error')
  })

  it('should return context when used inside AdminProvider', () => {
    const dataProvider = createMockDataProvider()

    const { result } = renderHook(() => useAdminContext(), {
      wrapper: createWrapper(dataProvider),
    })

    expect(result.current.dataProvider).toBe(dataProvider)
  })
})

// =============================================================================
// useResource Tests
// =============================================================================

describe('useResource', () => {
  let dataProvider: DataProvider

  beforeEach(() => {
    vi.clearAllMocks()
    dataProvider = createMockDataProvider()
  })

  it('should fetch data on mount', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    // Initially loading
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toHaveLength(3)
    expect(result.current.data[0].name).toBe('Alice')
    expect(dataProvider.getList).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'User' })
    )
  })

  it('should provide pagination state', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User', perPage: 10 }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.page).toBe(1)
    expect(result.current.perPage).toBe(10)
    expect(result.current.total).toBe(3)
  })

  it('should allow changing page', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setPage(2)
    })

    expect(result.current.page).toBe(2)
  })

  it('should allow changing sort', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setSort('name')
    })

    expect(result.current.sort).toEqual({ field: 'name', order: 'asc' })

    // Toggle sort order
    act(() => {
      result.current.setSort('name')
    })

    expect(result.current.sort).toEqual({ field: 'name', order: 'desc' })
  })

  it('should allow setting filters', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setFilter({ role: 'admin' })
    })

    expect(result.current.filter).toEqual({ role: 'admin' })
    expect(result.current.page).toBe(1) // Reset to first page
  })

  it('should create a record with optimistic update', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const initialLength = result.current.data.length

    let createPromise: Promise<TestUser>
    act(() => {
      createPromise = result.current.create({
        name: 'Dave',
        email: 'dave@example.com.ai',
        role: 'user',
      })
    })

    // Optimistic update - should add immediately
    expect(result.current.data.length).toBe(initialLength + 1)

    await createPromise!

    expect(dataProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        data: expect.objectContaining({ name: 'Dave' }),
      })
    )
  })

  it('should update a record with optimistic update', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let updatePromise: Promise<TestUser>
    act(() => {
      updatePromise = result.current.update('user-1', { name: 'Alice Updated' })
    })

    // Optimistic update - should update immediately
    expect(result.current.data.find((u) => u.$id === 'user-1')?.name).toBe(
      'Alice Updated'
    )

    await updatePromise!

    expect(dataProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        id: 'user-1',
        data: { name: 'Alice Updated' },
      })
    )
  })

  it('should delete a record with optimistic update', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const initialLength = result.current.data.length

    let deletePromise: Promise<void>
    act(() => {
      deletePromise = result.current.remove('user-1')
    })

    // Optimistic update - should remove immediately
    expect(result.current.data.length).toBe(initialLength - 1)
    expect(result.current.data.find((u) => u.$id === 'user-1')).toBeUndefined()

    await deletePromise!

    expect(dataProvider.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        id: 'user-1',
      })
    )
  })

  it('should find a record by ID', async () => {
    const { result } = renderHook(
      () => useResource<TestUser>({ resource: 'User' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const user = result.current.findById('user-2')
    expect(user?.name).toBe('Bob')
  })
})

// =============================================================================
// useResourceRecord Tests
// =============================================================================

describe('useResourceRecord', () => {
  let dataProvider: DataProvider

  beforeEach(() => {
    vi.clearAllMocks()
    dataProvider = createMockDataProvider()
  })

  it('should fetch a single record on mount', async () => {
    const { result } = renderHook(
      () => useResourceRecord<TestUser>({ resource: 'User', id: 'user-1' }),
      { wrapper: createWrapper(dataProvider) }
    )

    // Initially loading
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.name).toBe('Alice')
    expect(result.current.notFound).toBe(false)
    expect(dataProvider.getOne).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        id: 'user-1',
      })
    )
  })

  it('should handle not found', async () => {
    ;(dataProvider.getOne as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Not found')
    )

    const { result } = renderHook(
      () => useResourceRecord<TestUser>({ resource: 'User', id: 'user-999' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeTruthy()
  })

  it('should update the record', async () => {
    const { result } = renderHook(
      () => useResourceRecord<TestUser>({ resource: 'User', id: 'user-1' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.update({ name: 'Alice Updated' })
    })

    expect(dataProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        id: 'user-1',
        data: { name: 'Alice Updated' },
      })
    )
  })

  it('should delete the record', async () => {
    const { result } = renderHook(
      () => useResourceRecord<TestUser>({ resource: 'User', id: 'user-1' }),
      { wrapper: createWrapper(dataProvider) }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.remove()
    })

    expect(result.current.notFound).toBe(true)
    expect(dataProvider.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'User',
        id: 'user-1',
      })
    )
  })
})
