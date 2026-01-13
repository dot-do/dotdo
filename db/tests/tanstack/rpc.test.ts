/**
 * Cap'n Web RPC Client Tests
 *
 * TDD test suite for the capnweb RPC client function that provides
 * typed RPC calls for TanStack DB mutations.
 *
 * The capnweb function:
 * - Builds CapnWebRequest with call operations
 * - Sends to DO URL
 * - Handles promise pipelining
 * - Returns typed results
 *
 * @module db/tanstack/tests/rpc.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { capnweb, type CapnWebConfig, type CapnWebRequest, type CapnWebResponse } from '../../tanstack/rpc'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock fetch responses
 */
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Helper to create mock successful response
 */
function mockSuccessResponse<T>(value: T, promiseId = 'p1'): CapnWebResponse {
  return {
    id: 'test-request',
    type: 'batch',
    results: [
      {
        promiseId,
        type: 'value',
        value,
      },
    ],
  }
}

/**
 * Helper to create mock error response
 */
function mockErrorResponse(code: string, message: string, promiseId = 'p1'): CapnWebResponse {
  return {
    id: 'test-request',
    type: 'batch',
    results: [
      {
        promiseId,
        type: 'error',
        error: { code, message },
      },
    ],
  }
}

// ============================================================================
// BASIC FUNCTIONALITY TESTS
// ============================================================================

describe('capnweb', () => {
  describe('single calls', () => {
    it('makes a simple RPC call and returns the result', async () => {
      const expectedResult = { $id: 'task-1', name: 'Test Task', status: 'todo' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse(expectedResult),
      })

      const result = await capnweb<typeof expectedResult>(
        'https://example.do/api',
        'Task',
        'get',
        { id: 'task-1' }
      )

      expect(result).toEqual(expectedResult)
    })

    it('sends correct request format to the DO URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({ success: true }),
      })

      await capnweb('https://example.do/api', 'Task', 'create', { name: 'New Task' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]

      expect(url).toBe('https://example.do/api')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(options.body) as CapnWebRequest
      expect(body.type).toBe('call')
      expect(body.calls).toHaveLength(1)
      expect(body.calls[0].method).toBe('Task.create')
      expect(body.calls[0].target).toEqual({ type: 'root' })
      expect(body.calls[0].args).toHaveLength(1)
      expect(body.calls[0].args[0]).toEqual({ type: 'value', value: { name: 'New Task' } })
    })

    it('generates unique request and promise IDs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSuccessResponse({}),
      })

      await capnweb('https://example.do/api', 'Task', 'list', {})
      await capnweb('https://example.do/api', 'Task', 'list', {})

      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body) as CapnWebRequest

      // Request IDs should be unique
      expect(body1.id).not.toBe(body2.id)
      // Promise IDs should be unique across calls
      expect(body1.calls[0].promiseId).not.toBe(body2.calls[0].promiseId)
    })

    it('handles void return type (delete operation)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({ deleted: true, $rowid: 5 }),
      })

      const result = await capnweb<void>(
        'https://example.do/api',
        'Task',
        'delete',
        { id: 'task-1' }
      )

      // For void operations, result should be the response (truthy)
      expect(result).toBeTruthy()
    })
  })

  describe('error handling', () => {
    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(
        capnweb('https://example.do/api', 'Task', 'get', { id: 'task-1' })
      ).rejects.toThrow('HTTP error: 500')
    })

    it('throws on RPC error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse('NOT_FOUND', 'Task not found'),
      })

      await expect(
        capnweb('https://example.do/api', 'Task', 'get', { id: 'nonexistent' })
      ).rejects.toThrow('Task not found')
    })

    it('throws on top-level error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test',
          type: 'error',
          error: { code: 'INVALID_REQUEST', message: 'Bad request format' },
        }),
      })

      await expect(
        capnweb('https://example.do/api', 'Task', 'create', {})
      ).rejects.toThrow('Bad request format')
    })

    it('throws on empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test',
          type: 'batch',
          results: [],
        }),
      })

      await expect(
        capnweb('https://example.do/api', 'Task', 'get', { id: 'task-1' })
      ).rejects.toThrow('No results in response')
    })

    it('throws on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      await expect(
        capnweb('https://example.do/api', 'Task', 'get', { id: 'task-1' })
      ).rejects.toThrow('Network failure')
    })
  })

  describe('configuration options', () => {
    it('accepts custom fetch options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({}),
      })

      const config: CapnWebConfig = {
        fetchOptions: {
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          },
        },
      }

      await capnweb('https://example.do/api', 'Task', 'list', {}, config)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers['Authorization']).toBe('Bearer token123')
      expect(options.headers['X-Custom-Header']).toBe('custom-value')
    })

    it('merges custom headers with default Content-Type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({}),
      })

      const config: CapnWebConfig = {
        fetchOptions: {
          headers: {
            'Authorization': 'Bearer token',
          },
        },
      }

      await capnweb('https://example.do/api', 'Task', 'list', {}, config)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.headers['Authorization']).toBe('Bearer token')
    })

    it('allows custom timeout via AbortSignal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({}),
      })

      const controller = new AbortController()
      const config: CapnWebConfig = {
        fetchOptions: {
          signal: controller.signal,
        },
      }

      await capnweb('https://example.do/api', 'Task', 'list', {}, config)

      const [, options] = mockFetch.mock.calls[0]
      expect(options.signal).toBe(controller.signal)
    })
  })

  describe('collection methods', () => {
    it('calls Task.create correctly', async () => {
      const newTask = { $id: 'task-new', name: 'New Task', $rowid: 1 }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse(newTask),
      })

      const result = await capnweb<typeof newTask>(
        'https://example.do/api',
        'Task',
        'create',
        { name: 'New Task', status: 'todo' }
      )

      expect(result.$id).toBe('task-new')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
      expect(body.calls[0].method).toBe('Task.create')
    })

    it('calls Task.update correctly', async () => {
      const updatedTask = { $id: 'task-1', name: 'Updated Task', status: 'done', $rowid: 2 }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse(updatedTask),
      })

      const result = await capnweb<typeof updatedTask>(
        'https://example.do/api',
        'Task',
        'update',
        { $id: 'task-1', status: 'done' }
      )

      expect(result.status).toBe('done')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
      expect(body.calls[0].method).toBe('Task.update')
    })

    it('calls Task.delete correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse({ deleted: true, $rowid: 3 }),
      })

      await capnweb<{ deleted: boolean }>(
        'https://example.do/api',
        'Task',
        'delete',
        { $id: 'task-1' }
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
      expect(body.calls[0].method).toBe('Task.delete')
    })

    it('calls Task.list correctly', async () => {
      const tasks = [
        { $id: 'task-1', name: 'Task 1' },
        { $id: 'task-2', name: 'Task 2' },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse(tasks),
      })

      const result = await capnweb<typeof tasks>(
        'https://example.do/api',
        'Task',
        'list',
        {}
      )

      expect(result).toHaveLength(2)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
      expect(body.calls[0].method).toBe('Task.list')
    })
  })
})

// ============================================================================
// BATCH CALLS TESTS
// ============================================================================

describe('capnweb batch calls', () => {
  it('executes multiple calls in a single request', async () => {
    // Import the batch function (to be implemented)
    const { capnwebBatch } = await import('../../tanstack/rpc')

    const results = [
      { $id: 'task-1', name: 'Task 1' },
      { $id: 'task-2', name: 'Task 2' },
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'batch-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'value', value: results[0] },
          { promiseId: 'p2', type: 'value', value: results[1] },
        ],
      }),
    })

    const batchResults = await capnwebBatch('https://example.do/api', [
      { collection: 'Task', method: 'get', params: { id: 'task-1' } },
      { collection: 'Task', method: 'get', params: { id: 'task-2' } },
    ])

    expect(batchResults).toHaveLength(2)
    expect(batchResults[0]).toEqual(results[0])
    expect(batchResults[1]).toEqual(results[1])

    // Should be a single fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest
    expect(body.type).toBe('batch')
    expect(body.calls).toHaveLength(2)
  })

  it('returns results in same order as calls', async () => {
    const { capnwebBatch } = await import('../../tanstack/rpc')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'batch-request',
        type: 'batch',
        results: [
          { promiseId: 'p2', type: 'value', value: { name: 'Second' } },
          { promiseId: 'p1', type: 'value', value: { name: 'First' } },
        ],
      }),
    })

    const batchResults = await capnwebBatch('https://example.do/api', [
      { collection: 'Task', method: 'create', params: { name: 'First' } },
      { collection: 'Task', method: 'create', params: { name: 'Second' } },
    ])

    // Results should be ordered by original call order, not response order
    expect(batchResults[0].name).toBe('First')
    expect(batchResults[1].name).toBe('Second')
  })

  it('handles partial errors in batch', async () => {
    const { capnwebBatch } = await import('../../tanstack/rpc')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'batch-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'value', value: { $id: 'task-1' } },
          { promiseId: 'p2', type: 'error', error: { code: 'NOT_FOUND', message: 'Not found' } },
        ],
      }),
    })

    // By default, partial errors should throw
    await expect(
      capnwebBatch('https://example.do/api', [
        { collection: 'Task', method: 'get', params: { id: 'task-1' } },
        { collection: 'Task', method: 'get', params: { id: 'nonexistent' } },
      ])
    ).rejects.toThrow('Not found')
  })

  it('supports allowPartialErrors option', async () => {
    const { capnwebBatch } = await import('../../tanstack/rpc')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'batch-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'value', value: { $id: 'task-1' } },
          { promiseId: 'p2', type: 'error', error: { code: 'NOT_FOUND', message: 'Not found' } },
        ],
      }),
    })

    const results = await capnwebBatch(
      'https://example.do/api',
      [
        { collection: 'Task', method: 'get', params: { id: 'task-1' } },
        { collection: 'Task', method: 'get', params: { id: 'nonexistent' } },
      ],
      { allowPartialErrors: true }
    )

    expect(results[0]).toEqual({ $id: 'task-1' })
    expect(results[1]).toBeInstanceOf(Error)
    expect((results[1] as Error).message).toBe('Not found')
  })
})

// ============================================================================
// PROMISE PIPELINING TESTS
// ============================================================================

describe('capnweb promise pipelining', () => {
  it('supports pipelining through capnwebPipeline', async () => {
    // Import the pipeline function (to be implemented)
    const { capnwebPipeline } = await import('../../tanstack/rpc')

    // The pipeline should allow chaining calls that reference previous results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pipeline-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'value', value: { $id: 'user-1', name: 'John' } },
          { promiseId: 'p2', type: 'value', value: [{ $id: 'post-1', userId: 'user-1' }] },
        ],
      }),
    })

    // Create a pipeline that gets a user and then their posts
    const pipeline = capnwebPipeline('https://example.do/api')
      .call('User', 'get', { id: 'user-1' }, 'user')
      .call('Post', 'list', { userId: { $ref: 'user', path: '$id' } }, 'posts')

    const results = await pipeline.execute()

    expect(results.user).toEqual({ $id: 'user-1', name: 'John' })
    expect(results.posts).toHaveLength(1)
  })

  it('sends pipeline calls with proper promise references', async () => {
    const { capnwebPipeline } = await import('../../tanstack/rpc')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pipeline-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'value', value: { $id: 'user-1' } },
          { promiseId: 'p2', type: 'value', value: { name: 'User 1' } },
        ],
      }),
    })

    await capnwebPipeline('https://example.do/api')
      .call('User', 'get', { id: 'user-1' }, 'user')
      .call('User', 'profile', { $ref: 'user' }, 'profile')
      .execute()

    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as CapnWebRequest

    // Second call should reference first call's result
    expect(body.calls[1].args[0].type).toBe('promise')
    expect(body.calls[1].args[0]).toHaveProperty('promiseId')
  })

  it('handles pipeline errors by stopping execution', async () => {
    const { capnwebPipeline } = await import('../../tanstack/rpc')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pipeline-request',
        type: 'batch',
        results: [
          { promiseId: 'p1', type: 'error', error: { code: 'NOT_FOUND', message: 'User not found' } },
          // Second call result won't matter as first failed
        ],
      }),
    })

    const pipeline = capnwebPipeline('https://example.do/api')
      .call('User', 'get', { id: 'nonexistent' }, 'user')
      .call('Post', 'list', { userId: { $ref: 'user', path: '$id' } }, 'posts')

    await expect(pipeline.execute()).rejects.toThrow('User not found')
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('capnweb type safety', () => {
  interface Task {
    $id: string
    name: string
    status: 'todo' | 'in_progress' | 'done'
    $rowid?: number
  }

  it('returns correctly typed result', async () => {
    const task: Task = { $id: 'task-1', name: 'Test', status: 'todo' }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSuccessResponse(task),
    })

    const result = await capnweb<Task>(
      'https://example.do/api',
      'Task',
      'get',
      { id: 'task-1' }
    )

    // TypeScript should know result is Task type
    expect(result.$id).toBe('task-1')
    expect(result.name).toBe('Test')
    expect(result.status).toBe('todo')
  })

  it('handles array return types', async () => {
    const tasks: Task[] = [
      { $id: 'task-1', name: 'Task 1', status: 'todo' },
      { $id: 'task-2', name: 'Task 2', status: 'done' },
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSuccessResponse(tasks),
    })

    const result = await capnweb<Task[]>(
      'https://example.do/api',
      'Task',
      'list',
      {}
    )

    // TypeScript should know result is Task[] type
    expect(result).toHaveLength(2)
    expect(result[0].status).toBe('todo')
    expect(result[1].status).toBe('done')
  })
})

// ============================================================================
// URL HANDLING TESTS
// ============================================================================

describe('capnweb URL handling', () => {
  it('uses the exact URL provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSuccessResponse({}),
    })

    await capnweb('https://my-do.workers.dev/namespace', 'Task', 'list', {})

    expect(mockFetch.mock.calls[0][0]).toBe('https://my-do.workers.dev/namespace')
  })

  it('works with URLs containing paths', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSuccessResponse({}),
    })

    await capnweb('https://api.example.com.ai/v1/do/workspace-123', 'Task', 'list', {})

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com.ai/v1/do/workspace-123')
  })

  it('works with localhost URLs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSuccessResponse({}),
    })

    await capnweb('http://localhost:8787/do/test', 'Task', 'list', {})

    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8787/do/test')
  })
})
