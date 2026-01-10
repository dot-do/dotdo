/**
 * Data Provider Tests
 *
 * Tests for the admin data provider abstraction.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DotdoDataProvider,
  AdminError,
  isAdminError,
  formatAdminError,
  createCacheKey,
  invalidateCache,
} from '../../src/admin'
import type {
  DataProvider,
  BaseRecord,
  GetListParams,
  GetOneParams,
} from '../../src/admin/types'

// =============================================================================
// Mock Setup
// =============================================================================

const mockFetch = vi.fn()

interface TestUser extends BaseRecord {
  $id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

const mockUsers: TestUser[] = [
  { $id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
  { $id: 'user-2', name: 'Bob', email: 'bob@example.com', role: 'user' },
  { $id: 'user-3', name: 'Charlie', email: 'charlie@example.com', role: 'user' },
]

// Helper to create a successful RPC response
function createRpcResponse(value: unknown) {
  return {
    ok: true,
    json: async () => ({
      results: [{ value }],
    }),
  }
}

// Helper to create an error RPC response
function createErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: message,
    headers: new Headers(),
    json: async () => ({ error: { message } }),
  }
}

// =============================================================================
// DotdoDataProvider Tests
// =============================================================================

describe('DotdoDataProvider', () => {
  let provider: DataProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()

    provider = DotdoDataProvider({
      ns: 'https://api.example.com/do/workspace',
      fetch: mockFetch,
    })
  })

  // ===========================================================================
  // getList
  // ===========================================================================

  describe('getList', () => {
    it('should fetch a list of records', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(mockUsers))

      const result = await provider.getList<TestUser>({
        resource: 'User',
      })

      expect(result.data).toHaveLength(3)
      expect(result.data[0].name).toBe('Alice')
      expect(result.total).toBe(3)
    })

    it('should pass pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(mockUsers.slice(0, 2)))

      await provider.getList<TestUser>({
        resource: 'User',
        pagination: { page: 1, perPage: 2 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/do/workspace/rpc',
        expect.objectContaining({
          method: 'POST',
        })
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.calls[0].method).toBe('User.findAll')
    })

    it('should handle paginated response format', async () => {
      mockFetch.mockResolvedValueOnce(
        createRpcResponse({
          items: mockUsers,
          total: 100,
          cursor: 'next-cursor',
        })
      )

      const result = await provider.getList<TestUser>({
        resource: 'User',
      })

      expect(result.data).toHaveLength(3)
      expect(result.total).toBe(100)
      expect(result.cursor).toBe('next-cursor')
      expect(result.hasMore).toBe(true)
    })

    it('should throw AdminError on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createErrorResponse(500, 'Internal Server Error')
      )

      await expect(
        provider.getList({ resource: 'User' })
      ).rejects.toThrow(AdminError)
    })
  })

  // ===========================================================================
  // getOne
  // ===========================================================================

  describe('getOne', () => {
    it('should fetch a single record', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(mockUsers[0]))

      const result = await provider.getOne<TestUser>({
        resource: 'User',
        id: 'user-1',
      })

      expect(result.data.name).toBe('Alice')
      expect(result.data.$id).toBe('user-1')
    })

    it('should throw NOT_FOUND for missing record', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(null))

      try {
        await provider.getOne({ resource: 'User', id: 'user-999' })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(isAdminError(err)).toBe(true)
        expect((err as AdminError).code).toBe('NOT_FOUND')
      }
    })
  })

  // ===========================================================================
  // create
  // ===========================================================================

  describe('create', () => {
    it('should create a new record', async () => {
      const newUser: Omit<TestUser, '$id' | 'id'> = {
        name: 'Dave',
        email: 'dave@example.com',
        role: 'user',
      }

      const createdUser = { $id: 'user-4', ...newUser }
      mockFetch.mockResolvedValueOnce(createRpcResponse(createdUser))

      const result = await provider.create<TestUser>({
        resource: 'User',
        data: newUser,
      })

      expect(result.data.$id).toBe('user-4')
      expect(result.data.name).toBe('Dave')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.calls[0].method).toBe('User.create')
    })
  })

  // ===========================================================================
  // update
  // ===========================================================================

  describe('update', () => {
    it('should update an existing record', async () => {
      const updatedUser = { ...mockUsers[0], name: 'Alice Updated' }
      mockFetch.mockResolvedValueOnce(createRpcResponse(updatedUser))

      const result = await provider.update<TestUser>({
        resource: 'User',
        id: 'user-1',
        data: { name: 'Alice Updated' },
      })

      expect(result.data.name).toBe('Alice Updated')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.calls[0].method).toBe('User.update')
      expect(body.calls[0].args[0].value.key).toBe('user-1')
    })
  })

  // ===========================================================================
  // delete
  // ===========================================================================

  describe('delete', () => {
    it('should delete a record', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(undefined))

      const result = await provider.delete<TestUser>({
        resource: 'User',
        id: 'user-1',
        previousData: mockUsers[0],
      })

      expect(result.data.$id).toBe('user-1')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.calls[0].method).toBe('User.delete')
    })
  })

  // ===========================================================================
  // deleteMany
  // ===========================================================================

  describe('deleteMany', () => {
    it('should delete multiple records', async () => {
      mockFetch.mockResolvedValueOnce(createRpcResponse(undefined))

      const result = await provider.deleteMany({
        resource: 'User',
        ids: ['user-1', 'user-2'],
      })

      expect(result.data).toEqual(['user-1', 'user-2'])
    })
  })
})

// =============================================================================
// AdminError Tests
// =============================================================================

describe('AdminError', () => {
  describe('isAdminError', () => {
    it('should return true for AdminError instances', () => {
      const error = new AdminError({
        code: 'NOT_FOUND',
        message: 'Not found',
      })

      expect(isAdminError(error)).toBe(true)
    })

    it('should return false for regular errors', () => {
      const error = new Error('Regular error')
      expect(isAdminError(error)).toBe(false)
    })
  })

  describe('formatAdminError', () => {
    it('should return AdminError unchanged', () => {
      const original = new AdminError({
        code: 'NOT_FOUND',
        message: 'Not found',
      })

      expect(formatAdminError(original)).toBe(original)
    })

    it('should wrap regular errors', () => {
      const original = new Error('Regular error')
      const formatted = formatAdminError(original, 'User')

      expect(isAdminError(formatted)).toBe(true)
      expect(formatted.message).toBe('Regular error')
      expect(formatted.resource).toBe('User')
    })

    it('should handle network errors', () => {
      const original = new TypeError('Failed to fetch')
      const formatted = formatAdminError(original, 'User')

      expect(formatted.code).toBe('NETWORK_ERROR')
      expect(formatted.retryable).toBe(true)
    })
  })

  describe('toUserMessage', () => {
    it('should return user-friendly messages', () => {
      const notFound = new AdminError({ code: 'NOT_FOUND', message: 'Not found' })
      expect(notFound.toUserMessage()).toBe('The requested item could not be found.')

      const network = new AdminError({ code: 'NETWORK_ERROR', message: 'Network' })
      expect(network.toUserMessage()).toBe('Unable to connect. Please check your internet connection.')

      const validation = new AdminError({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
      })
      expect(validation.toUserMessage()).toBe('Please check the form for errors and try again.')
    })
  })
})

// =============================================================================
// Cache Utilities Tests
// =============================================================================

describe('Cache Utilities', () => {
  describe('createCacheKey', () => {
    it('should create key for resource only', () => {
      expect(createCacheKey('User')).toBe('User')
    })

    it('should create key with parameters', () => {
      const key = createCacheKey('User', {
        pagination: { page: 1, perPage: 10 },
        filter: { role: 'admin' },
      })

      expect(key).toContain('User:')
      expect(key).toContain('"page":1')
      expect(key).toContain('"role":"admin"')
    })

    it('should create consistent keys regardless of parameter order', () => {
      const key1 = createCacheKey('User', {
        pagination: { page: 1, perPage: 10 },
        filter: { role: 'admin' },
      })

      const key2 = createCacheKey('User', {
        filter: { role: 'admin' },
        pagination: { page: 1, perPage: 10 },
      })

      expect(key1).toBe(key2)
    })
  })
})
