/**
 * DataProvider Adapter Tests for react-admin
 *
 * RED TDD tests for react-admin DataProvider adapter. These tests define
 * the expected behavior for createDataProvider() which wraps a Durable Object
 * URL with the react-admin DataProvider interface.
 *
 * The DataProvider interface:
 * https://marmelab.com/react-admin/DataProviderIntroduction.html
 *
 * Key methods being tested:
 * - getList: Paginated list with sorting and filtering
 * - getOne: Single record by ID
 * - getMany: Multiple records by ID array
 * - getManyReference: Related records by foreign key
 * - create: Create new record
 * - update: Update existing record
 * - updateMany: Batch update
 * - delete: Delete single record
 * - deleteMany: Batch delete
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Import from implementation (will fail until implemented)
// =============================================================================

import { createDataProvider, DataProviderError } from '../../adapters/data-provider'
import type { DataProvider, GetListParams, GetOneParams, GetManyParams, GetManyReferenceParams, CreateParams, UpdateParams, UpdateManyParams, DeleteParams, DeleteManyParams } from '../../adapters/data-provider'

// =============================================================================
// Mock fetch for testing HTTP calls
// =============================================================================

type MockFetchHandler = (url: string, init?: RequestInit) => Promise<Response>

function createMockFetch(handler: MockFetchHandler) {
  return vi.fn(handler)
}

// =============================================================================
// Test Suite
// =============================================================================

describe('DataProvider Adapter (react-admin)', () => {
  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // getList Tests
  // ===========================================================================

  describe('getList', () => {
    it('returns paginated data with total count', async () => {
      mockFetch = createMockFetch(async (url, init) => {
        expect(url).toContain('/posts')
        return new Response(JSON.stringify({
          data: [
            { id: '1', title: 'First Post' },
            { id: '2', title: 'Second Post' },
          ],
          total: 100,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getList('posts', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ id: '1', title: 'First Post' })
      expect(result.total).toBe(100)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('applies sorting (field, order)', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({
          data: [{ id: '2' }, { id: '1' }],
          total: 2,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getList('posts', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'createdAt', order: 'DESC' },
        filter: {},
      })

      // Should include sort parameters in URL or body
      expect(capturedUrl).toContain('sort')
      expect(capturedUrl).toContain('createdAt')
      expect(capturedUrl).toContain('DESC')
    })

    it('applies filtering (filter object)', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({
          data: [{ id: '1', status: 'published' }],
          total: 1,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getList('posts', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: { status: 'published', author_id: 123 },
      })

      // Should include filter parameters
      expect(capturedUrl).toContain('filter')
      // Implementation may encode filters as JSON or as query params
      expect(capturedUrl).toMatch(/status|published/)
    })

    it('sends correct pagination parameters', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({
          data: [],
          total: 0,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getList('posts', {
        pagination: { page: 3, perPage: 25 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      // Should include pagination params (page=3, perPage=25 or equivalent)
      const urlObj = new URL(capturedUrl)
      const params = Object.fromEntries(urlObj.searchParams)

      // Either range-based or page-based pagination
      const hasPageParams = params.page === '3' || params._start === '50'
      expect(hasPageParams).toBe(true)
    })
  })

  // ===========================================================================
  // getOne Tests
  // ===========================================================================

  describe('getOne', () => {
    it('returns single record by ID', async () => {
      mockFetch = createMockFetch(async (url) => {
        expect(url).toContain('/posts/123')
        return new Response(JSON.stringify({
          data: { id: '123', title: 'My Post', body: 'Content here' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getOne('posts', { id: '123' })

      expect(result.data).toEqual({
        id: '123',
        title: 'My Post',
        body: 'Content here',
      })
    })

    it('handles numeric IDs', async () => {
      mockFetch = createMockFetch(async (url) => {
        expect(url).toContain('/posts/456')
        return new Response(JSON.stringify({
          data: { id: 456, title: 'Numeric ID Post' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getOne('posts', { id: 456 })

      expect(result.data.id).toBe(456)
    })
  })

  // ===========================================================================
  // getMany Tests
  // ===========================================================================

  describe('getMany', () => {
    it('returns multiple records by IDs array', async () => {
      mockFetch = createMockFetch(async (url) => {
        // Should request multiple IDs
        expect(url).toMatch(/ids.*1.*2.*3|id=1&id=2&id=3/)
        return new Response(JSON.stringify({
          data: [
            { id: '1', title: 'Post 1' },
            { id: '2', title: 'Post 2' },
            { id: '3', title: 'Post 3' },
          ],
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getMany('posts', {
        ids: ['1', '2', '3'],
      })

      expect(result.data).toHaveLength(3)
      expect(result.data.map(d => d.id)).toEqual(['1', '2', '3'])
    })

    it('handles empty IDs array', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ data: [] }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getMany('posts', { ids: [] })

      expect(result.data).toEqual([])
    })

    it('returns partial results when some IDs not found', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: [
            { id: '1', title: 'Post 1' },
            // ID 2 not found
            { id: '3', title: 'Post 3' },
          ],
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getMany('posts', {
        ids: ['1', '2', '3'],
      })

      expect(result.data).toHaveLength(2)
    })
  })

  // ===========================================================================
  // getManyReference Tests
  // ===========================================================================

  describe('getManyReference', () => {
    it('returns related records by foreign key', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({
          data: [
            { id: '10', post_id: '1', text: 'Comment 1' },
            { id: '11', post_id: '1', text: 'Comment 2' },
          ],
          total: 2,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getManyReference('comments', {
        target: 'post_id',
        id: '1',
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
      // Should include the foreign key filter
      expect(capturedUrl).toContain('post_id')
    })

    it('applies additional filters alongside reference', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({
          data: [{ id: '10', post_id: '1', approved: true }],
          total: 1,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getManyReference('comments', {
        target: 'post_id',
        id: '1',
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: { approved: true },
      })

      // Should include both reference filter and additional filter
      expect(capturedUrl).toContain('post_id')
      expect(capturedUrl).toContain('approved')
    })
  })

  // ===========================================================================
  // create Tests
  // ===========================================================================

  describe('create', () => {
    it('creates record and returns with ID', async () => {
      let capturedBody: unknown
      mockFetch = createMockFetch(async (url, init) => {
        expect(init?.method).toBe('POST')
        capturedBody = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({
          data: { id: 'new-123', title: 'New Post', body: 'Content' },
        }), { status: 201 })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.create('posts', {
        data: { title: 'New Post', body: 'Content' },
      })

      expect(result.data).toEqual({
        id: 'new-123',
        title: 'New Post',
        body: 'Content',
      })
      expect(capturedBody).toMatchObject({
        title: 'New Post',
        body: 'Content',
      })
    })

    it('sends correct Content-Type header', async () => {
      let capturedHeaders: Headers | undefined
      mockFetch = createMockFetch(async (url, init) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({
          data: { id: '1', title: 'Test' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.create('posts', {
        data: { title: 'Test' },
      })

      expect(capturedHeaders?.get('Content-Type')).toBe('application/json')
    })
  })

  // ===========================================================================
  // update Tests
  // ===========================================================================

  describe('update', () => {
    it('updates record by ID', async () => {
      let capturedBody: unknown
      let capturedMethod: string | undefined
      mockFetch = createMockFetch(async (url, init) => {
        capturedMethod = init?.method
        capturedBody = JSON.parse(init?.body as string)
        expect(url).toContain('/posts/123')
        return new Response(JSON.stringify({
          data: { id: '123', title: 'Updated Title', body: 'Updated body' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.update('posts', {
        id: '123',
        data: { title: 'Updated Title', body: 'Updated body' },
        previousData: { id: '123', title: 'Old Title', body: 'Old body' },
      })

      expect(capturedMethod).toBe('PUT')
      expect(result.data).toEqual({
        id: '123',
        title: 'Updated Title',
        body: 'Updated body',
      })
    })

    it('includes previousData for optimistic concurrency', async () => {
      let capturedBody: unknown
      mockFetch = createMockFetch(async (url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({
          data: { id: '123', title: 'Updated' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.update('posts', {
        id: '123',
        data: { title: 'Updated' },
        previousData: { id: '123', title: 'Original', version: 5 },
      })

      // previousData may be sent for optimistic locking
      // Implementation can use version or ETag
      expect(capturedBody).toBeDefined()
    })
  })

  // ===========================================================================
  // updateMany Tests
  // ===========================================================================

  describe('updateMany', () => {
    it('batch updates and returns IDs', async () => {
      let capturedBody: unknown
      mockFetch = createMockFetch(async (url, init) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({
          data: ['1', '2', '3'],
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.updateMany('posts', {
        ids: ['1', '2', '3'],
        data: { status: 'archived' },
      })

      expect(result.data).toEqual(['1', '2', '3'])
      expect(capturedBody).toMatchObject({
        ids: ['1', '2', '3'],
        data: { status: 'archived' },
      })
    })

    it('handles partial success', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: ['1', '3'], // ID 2 failed
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.updateMany('posts', {
        ids: ['1', '2', '3'],
        data: { status: 'archived' },
      })

      expect(result.data).toEqual(['1', '3'])
    })
  })

  // ===========================================================================
  // delete Tests
  // ===========================================================================

  describe('delete', () => {
    it('deletes record by ID', async () => {
      mockFetch = createMockFetch(async (url, init) => {
        expect(init?.method).toBe('DELETE')
        expect(url).toContain('/posts/123')
        return new Response(JSON.stringify({
          data: { id: '123' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.delete('posts', {
        id: '123',
        previousData: { id: '123', title: 'Deleted Post' },
      })

      expect(result.data).toEqual({ id: '123' })
    })

    it('returns deleted record data when available', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: { id: '123', title: 'Deleted Post', deletedAt: '2024-01-01' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.delete('posts', {
        id: '123',
        previousData: { id: '123', title: 'Deleted Post' },
      })

      expect(result.data.id).toBe('123')
    })
  })

  // ===========================================================================
  // deleteMany Tests
  // ===========================================================================

  describe('deleteMany', () => {
    it('batch deletes and returns IDs', async () => {
      let capturedBody: unknown
      mockFetch = createMockFetch(async (url, init) => {
        expect(init?.method).toBe('DELETE')
        capturedBody = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({
          data: ['1', '2', '3'],
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.deleteMany('posts', {
        ids: ['1', '2', '3'],
      })

      expect(result.data).toEqual(['1', '2', '3'])
      expect(capturedBody).toMatchObject({ ids: ['1', '2', '3'] })
    })

    it('handles partial deletion success', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: ['1', '2'], // ID 3 failed
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.deleteMany('posts', {
        ids: ['1', '2', '3'],
      })

      expect(result.data).toEqual(['1', '2'])
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('throws DataProviderError on 404', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          statusText: 'Not Found',
        })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await expect(
        dataProvider.getOne('posts', { id: 'nonexistent' })
      ).rejects.toThrow(DataProviderError)

      try {
        await dataProvider.getOne('posts', { id: 'nonexistent' })
      } catch (error) {
        expect(error).toBeInstanceOf(DataProviderError)
        expect((error as DataProviderError).status).toBe(404)
        expect((error as DataProviderError).message).toContain('Not')
      }
    })

    it('throws DataProviderError on 500', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500,
          statusText: 'Internal Server Error',
        })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await expect(
        dataProvider.getList('posts', {
          pagination: { page: 1, perPage: 10 },
          sort: { field: 'id', order: 'ASC' },
          filter: {},
        })
      ).rejects.toThrow(DataProviderError)

      try {
        await dataProvider.getList('posts', {
          pagination: { page: 1, perPage: 10 },
          sort: { field: 'id', order: 'ASC' },
          filter: {},
        })
      } catch (error) {
        expect((error as DataProviderError).status).toBe(500)
      }
    })

    it('handles network errors', async () => {
      mockFetch = createMockFetch(async () => {
        throw new TypeError('Failed to fetch')
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await expect(
        dataProvider.getOne('posts', { id: '1' })
      ).rejects.toThrow()
    })

    it('handles malformed JSON response', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await expect(
        dataProvider.getOne('posts', { id: '1' })
      ).rejects.toThrow()
    })

    it('includes resource name in error context', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
        })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      try {
        await dataProvider.getOne('posts', { id: '1' })
      } catch (error) {
        expect((error as DataProviderError).resource).toBe('posts')
      }
    })
  })

  // ===========================================================================
  // Pagination Edge Cases
  // ===========================================================================

  describe('pagination edge cases', () => {
    it('handles empty results', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: [],
          total: 0,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getList('posts', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.data).toEqual([])
      expect(result.total).toBe(0)
    })

    it('handles last page with fewer items', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: [
            { id: '91' },
            { id: '92' },
            { id: '93' },
          ],
          total: 93,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getList('posts', {
        pagination: { page: 10, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.data).toHaveLength(3)
      expect(result.total).toBe(93)
    })

    it('handles page beyond total (returns empty)', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: [],
          total: 50,
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getList('posts', {
        pagination: { page: 100, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.data).toEqual([])
      expect(result.total).toBe(50)
    })

    it('supports pageInfo for cursor-based pagination', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: [{ id: '1' }, { id: '2' }],
          total: 100,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
          },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const result = await dataProvider.getList('posts', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(result.pageInfo?.hasNextPage).toBe(true)
      expect(result.pageInfo?.hasPreviousPage).toBe(false)
    })
  })

  // ===========================================================================
  // Optimistic Update Support
  // ===========================================================================

  describe('optimistic update support', () => {
    it('supports optimistic updates via meta', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          data: { id: '123', title: 'Optimistically Updated' },
        }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      // react-admin uses meta for optimistic updates
      const result = await dataProvider.update('posts', {
        id: '123',
        data: { title: 'Optimistically Updated' },
        previousData: { id: '123', title: 'Original' },
        meta: { optimistic: true },
      })

      expect(result.data.title).toBe('Optimistically Updated')
    })

    it('provides previousData for rollback', async () => {
      mockFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({
          error: 'Conflict',
        }), { status: 409 })
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      const previousData = { id: '123', title: 'Original', version: 5 }

      try {
        await dataProvider.update('posts', {
          id: '123',
          data: { title: 'Updated' },
          previousData,
        })
      } catch (error) {
        // Error should include previousData for rollback
        expect((error as DataProviderError).previousData).toEqual(previousData)
      }
    })
  })

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    it('accepts base URL', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://custom.example.com/api/v2')

      await dataProvider.getOne('posts', { id: '1' })

      expect(capturedUrl).toContain('https://custom.example.com/api/v2')
    })

    it('accepts custom headers option', async () => {
      let capturedHeaders: Headers | undefined
      mockFetch = createMockFetch(async (url, init) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123',
        },
      })

      await dataProvider.getOne('posts', { id: '1' })

      expect(capturedHeaders?.get('X-Custom-Header')).toBe('custom-value')
      expect(capturedHeaders?.get('Authorization')).toBe('Bearer token123')
    })

    it('accepts auth token option', async () => {
      let capturedHeaders: Headers | undefined
      mockFetch = createMockFetch(async (url, init) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com', {
        auth: { token: 'my-jwt-token' },
      })

      await dataProvider.getOne('posts', { id: '1' })

      expect(capturedHeaders?.get('Authorization')).toBe('Bearer my-jwt-token')
    })

    it('accepts custom fetch implementation', async () => {
      const customFetch = vi.fn(async () => {
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })

      const dataProvider = createDataProvider('https://my-do.example.com', {
        fetch: customFetch,
      })

      await dataProvider.getOne('posts', { id: '1' })

      expect(customFetch).toHaveBeenCalled()
    })

    it('supports trailing slash normalization', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com/')

      await dataProvider.getOne('posts', { id: '1' })

      // Should not have double slashes in the path
      const urlPath = new URL(capturedUrl).pathname
      expect(urlPath).not.toContain('//')
      expect(capturedUrl).toContain('/posts/1')
    })
  })

  // ===========================================================================
  // Resource Name Handling
  // ===========================================================================

  describe('resource name handling', () => {
    it('uses resource name in URL path', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({ data: [] , total: 0 }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getList('users', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(capturedUrl).toContain('/users')
    })

    it('handles nested resource names', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({ data: [], total: 0 }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getList('admin/users', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      })

      expect(capturedUrl).toContain('/admin/users')
    })

    it('handles special characters in resource name', async () => {
      let capturedUrl = ''
      mockFetch = createMockFetch(async (url) => {
        capturedUrl = url
        return new Response(JSON.stringify({ data: { id: '1' } }))
      })
      globalThis.fetch = mockFetch

      const dataProvider = createDataProvider('https://my-do.example.com')

      await dataProvider.getOne('my-resources', { id: '1' })

      expect(capturedUrl).toContain('/my-resources')
    })
  })
})
