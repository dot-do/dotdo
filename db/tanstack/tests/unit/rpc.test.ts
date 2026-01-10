/**
 * Cap'n Web RPC Client Tests
 *
 * RED phase TDD tests for the Cap'n Web RPC client.
 * These tests verify the client-side implementation of the Cap'n Web protocol
 * for mutations to Durable Objects.
 *
 * Tests should FAIL until the RPCClient is fully implemented.
 *
 * Cap'n Web Protocol enables:
 * - Promise pipelining: Chain calls using promiseId references
 * - Automatic batching: Multiple calls in single round-trip
 * - Structured RPC: Typed request/response format
 *
 * @see db/tanstack/rpc.ts for the client implementation (stub)
 * @see objects/transport/rpc-server.ts for the server-side protocol
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RPCClient,
  createRPCClient,
  type RPCClientConfig,
  type MutationOperation,
  type QueryOperation,
} from '../../rpc'
import type { MutationResponse } from '../../protocol'

// =============================================================================
// Cap'n Web Protocol Types (matching server-side)
// =============================================================================

/**
 * Cap'n Web Request format - sent to /rpc endpoint
 * @see objects/transport/rpc-server.ts for server implementation
 */
interface CapnWebRequest {
  id: string
  type: 'call' | 'batch'
  calls: Array<{
    promiseId: string
    target: { type: 'root' } | { type: 'promise'; promiseId: string }
    method: string
    args: Array<{ type: 'value'; value: unknown }>
  }>
}

/**
 * Cap'n Web Response format - returned from /rpc endpoint
 */
interface CapnWebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: Array<{
    promiseId: string
    type: 'value' | 'promise' | 'error'
    value?: unknown
    error?: { code: string; message: string }
  }>
  error?: { code: string; message: string }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock fetch that captures requests and returns configured responses
 */
function createMockFetch() {
  return vi.fn<typeof globalThis.fetch>()
}

/**
 * Create a successful Cap'n Web batch response
 */
function createBatchResponse(
  id: string,
  results: CapnWebResponse['results']
): CapnWebResponse {
  return { id, type: 'batch', results }
}

/**
 * Create an error Cap'n Web response
 */
function createErrorResponse(
  id: string,
  error: { code: string; message: string }
): CapnWebResponse {
  return { id, type: 'error', error }
}

/**
 * Create a mock Response object
 */
function mockResponse(body: unknown, options: ResponseInit = {}): Response {
  return {
    ok: options.status ? options.status < 400 : true,
    status: options.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(options.headers),
  } as Response
}

// =============================================================================
// Single Call Tests
// =============================================================================

describe('capnweb RPC client', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    mockFetch = createMockFetch()
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('single call', () => {
    it('makes POST to /rpc endpoint', async () => {
      // Setup mock response for mutation
      const mutationResponse: MutationResponse = {
        success: true,
        rowid: 123,
      }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: mutationResponse },
          ])
        )
      )

      // Create client and make call
      const client = createRPCClient({ url: 'https://example.com/rpc' })
      await client.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'task-123',
        data: { title: 'New Task' },
      })

      // Verify POST to /rpc
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it("formats request as Cap'n Web protocol", async () => {
      // Setup mock response
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      await client.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: { title: 'Test Task', completed: false },
      })

      // Capture the request body
      const [, options] = mockFetch.mock.calls[0]
      const body: CapnWebRequest = JSON.parse(options?.body as string)

      // Verify Cap'n Web protocol format
      expect(body.type).toMatch(/^(call|batch)$/)
      expect(body.id).toBeDefined()
      expect(body.calls).toHaveLength(1)

      const call = body.calls[0]
      expect(call.promiseId).toBeDefined()
      expect(call.target).toEqual({ type: 'root' })
      expect(call.method).toBeDefined() // Should be 'Task.insert' or similar
      expect(call.args).toBeDefined()
      expect(Array.isArray(call.args)).toBe(true)
      // Args should be wrapped in { type: 'value', value: ... }
      if (call.args.length > 0) {
        expect(call.args[0]).toHaveProperty('type', 'value')
        expect(call.args[0]).toHaveProperty('value')
      }
    })

    it('extracts value from response', async () => {
      const expectedResponse: MutationResponse = {
        success: true,
        rowid: 456,
        data: { title: 'Created Task' },
      }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: expectedResponse },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const result = await client.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: { title: 'Test' },
      })

      expect(result).toEqual(expectedResponse)
      expect(result.success).toBe(true)
      expect(result.rowid).toBe(456)
    })

    it('throws on RPC error response', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createErrorResponse('req-1', {
            code: 'METHOD_NOT_FOUND',
            message: 'Method "unknownCollection.insert" not found',
          })
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await expect(
        client.mutate({
          type: 'insert',
          collection: 'unknownCollection',
          key: 'key-1',
          data: {},
        })
      ).rejects.toThrow('Method "unknownCollection.insert" not found')
    })

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          { error: 'Internal Server Error' },
          { status: 500 }
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await expect(
        client.mutate({
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: {},
        })
      ).rejects.toThrow()
    })

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await expect(
        client.mutate({
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: {},
        })
      ).rejects.toThrow('Network error')
    })

    it('passes authentication token in headers', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({
        url: 'https://example.com/rpc',
        token: 'secret-token-123',
      })

      await client.mutate({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: {},
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer secret-token-123',
          }),
        })
      )
    })
  })

  // ===========================================================================
  // Batching Tests
  // ===========================================================================

  describe('batching', () => {
    it('batches multiple calls in single request', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
            { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      await client.batch([
        { type: 'insert', collection: 'Task', key: 'task-1', data: { title: 'Task 1' } },
        { type: 'update', collection: 'Task', key: 'task-2', data: { title: 'Updated' } },
        { type: 'delete', collection: 'Task', key: 'task-3' },
      ])

      // Verify only one request was made
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify request contains all calls
      const [, options] = mockFetch.mock.calls[0]
      const body: CapnWebRequest = JSON.parse(options?.body as string)

      expect(body.type).toBe('batch')
      expect(body.calls).toHaveLength(3)
    })

    it('returns results in order', async () => {
      const responses: MutationResponse[] = [
        { success: true, rowid: 101, data: { id: 'task-1' } },
        { success: true, rowid: 102, data: { id: 'task-2' } },
        { success: true, rowid: 103, data: { id: 'task-3' } },
      ]

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: responses[0] },
            { promiseId: 'p-2', type: 'value', value: responses[1] },
            { promiseId: 'p-3', type: 'value', value: responses[2] },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const results = await client.batch([
        { type: 'insert', collection: 'Task', key: 'task-1', data: {} },
        { type: 'insert', collection: 'Task', key: 'task-2', data: {} },
        { type: 'insert', collection: 'Task', key: 'task-3', data: {} },
      ])

      expect(results).toHaveLength(3)
      expect(results[0].rowid).toBe(101)
      expect(results[1].rowid).toBe(102)
      expect(results[2].rowid).toBe(103)
    })

    it('handles partial failures in batch', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            {
              promiseId: 'p-2',
              type: 'error',
              error: { code: 'NOT_FOUND', message: 'Task task-999 not found' },
            },
            { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      // The batch should throw for the failed call
      await expect(
        client.batch([
          { type: 'insert', collection: 'Task', key: 'task-1', data: {} },
          { type: 'update', collection: 'Task', key: 'task-999', data: {} }, // This fails
          { type: 'insert', collection: 'Task', key: 'task-3', data: {} },
        ])
      ).rejects.toThrow('Task task-999 not found')
    })

    it('handles empty batch', async () => {
      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const results = await client.batch([])

      expect(results).toEqual([])
      // Should not make a network request for empty batch
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('preserves argument types in batch', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      await client.batch([
        {
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: {
            string: 'text',
            number: 123,
            boolean: true,
            null: null,
            nested: { key: 'value' },
            array: ['item1', 'item2'],
          },
        },
      ])

      const [, options] = mockFetch.mock.calls[0]
      const body: CapnWebRequest = JSON.parse(options?.body as string)

      // Data should be preserved in the args
      const call = body.calls[0]
      expect(call.args).toBeDefined()
      // The data should be in one of the args as a value
      const dataArg = call.args.find(
        (arg) => arg.type === 'value' && typeof arg.value === 'object' && arg.value !== null
      )
      expect(dataArg).toBeDefined()
    })

    it('generates unique promiseIds within a batch', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
            { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await client.batch([
        { type: 'insert', collection: 'Task', key: 'task-1', data: {} },
        { type: 'insert', collection: 'Task', key: 'task-2', data: {} },
        { type: 'insert', collection: 'Task', key: 'task-3', data: {} },
      ])

      const [, options] = mockFetch.mock.calls[0]
      const body: CapnWebRequest = JSON.parse(options?.body as string)
      const promiseIds = body.calls.map((c) => c.promiseId)

      // All promiseIds should be unique
      const uniqueIds = new Set(promiseIds)
      expect(uniqueIds.size).toBe(promiseIds.length)
    })
  })

  // ===========================================================================
  // Promise Pipelining Tests
  // ===========================================================================

  describe('promise pipelining', () => {
    it('chains calls using promiseId references', async () => {
      // This tests the core Cap'n Web feature: promise pipelining
      // Server should receive a batch where second call can reference first call's result

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
            { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      // First call creates a user, second call updates related data
      // Both should go in same request with pipelining
      await client.batch([
        { type: 'insert', collection: 'User', key: 'user-1', data: { name: 'Alice' } },
        { type: 'insert', collection: 'UserProfile', key: 'profile-1', data: { userId: 'user-1' } },
      ])

      // Verify single request
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [, options] = mockFetch.mock.calls[0]
      const body: CapnWebRequest = JSON.parse(options?.body as string)

      // Should have two calls
      expect(body.calls).toHaveLength(2)

      // First call targets root
      expect(body.calls[0].target).toEqual({ type: 'root' })

      // In a full pipelining implementation, second call could target first call's promise
      // For now, we verify the calls are batched together
      expect(body.calls[1]).toBeDefined()
    })
  })

  // ===========================================================================
  // Query Tests
  // ===========================================================================

  describe('query operations', () => {
    it('executes a query and returns results', async () => {
      const mockData = [
        { $id: 'task-1', $type: 'Task', data: { title: 'Task 1' } },
        { $id: 'task-2', $type: 'Task', data: { title: 'Task 2' } },
      ]

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: mockData },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const results = await client.query({
        collection: 'Task',
        options: { limit: 10 },
      })

      expect(results).toEqual(mockData)
      expect(results).toHaveLength(2)
    })

    it('gets a single item by key', async () => {
      const mockTask = {
        $id: 'task-1',
        $type: 'Task',
        data: { title: 'My Task', completed: false },
      }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: mockTask },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const result = await client.get<typeof mockTask>('Task', 'task-1')

      expect(result).toEqual(mockTask)
    })

    it('returns null for non-existent item', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: null },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const result = await client.get('Task', 'non-existent')

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('edge cases', () => {
    it('handles timeout configuration', async () => {
      // Test that timeout is respected (implementation detail)
      const client = createRPCClient({
        url: 'https://example.com/rpc',
        timeout: 5000,
      })

      // The client should be created with timeout config
      expect(client).toBeDefined()
    })

    it('generates unique request IDs across calls', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await client.mutate({ type: 'insert', collection: 'Task', key: 'task-1', data: {} })
      await client.mutate({ type: 'insert', collection: 'Task', key: 'task-2', data: {} })

      const body1: CapnWebRequest = JSON.parse(mockFetch.mock.calls[0][1]?.body as string)
      const body2: CapnWebRequest = JSON.parse(mockFetch.mock.calls[1][1]?.body as string)

      expect(body1.id).not.toBe(body2.id)
    })

    it('handles very large payloads', async () => {
      const largeData: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        largeData[`field${i}`] = 'x'.repeat(1000)
      }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const result = await client.mutate({
        type: 'insert',
        collection: 'LargeData',
        key: 'large-1',
        data: largeData,
      })

      expect(result.success).toBe(true)
    })

    it('handles malformed JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Invalid JSON')),
        text: () => Promise.resolve('not valid json'),
        headers: new Headers(),
      } as Response)

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      await expect(
        client.mutate({ type: 'insert', collection: 'Task', key: 'task-1', data: {} })
      ).rejects.toThrow()
    })

    it('handles response with mismatched promiseIds', async () => {
      // Server returns results with different promiseIds than requested
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'unknown-id', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })

      // Should throw or handle gracefully
      await expect(
        client.mutate({ type: 'insert', collection: 'Task', key: 'task-1', data: {} })
      ).rejects.toThrow()
    })
  })

  // ===========================================================================
  // URL Handling Tests
  // ===========================================================================

  describe('URL handling', () => {
    it('uses configured URL for requests', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://api.example.com/v1/rpc' })
      await client.mutate({ type: 'insert', collection: 'Task', key: 'task-1', data: {} })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/rpc',
        expect.any(Object)
      )
    })

    it('handles URL with trailing slash', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc/' })
      await client.mutate({ type: 'insert', collection: 'Task', key: 'task-1', data: {} })

      // Should handle trailing slash appropriately
      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toBeDefined()
    })
  })

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createRPCClient factory', () => {
    it('creates an RPCClient instance', () => {
      const client = createRPCClient({ url: 'https://example.com/rpc' })

      expect(client).toBeInstanceOf(RPCClient)
    })

    it('created client has all required methods', () => {
      const client = createRPCClient({ url: 'https://example.com/rpc' })

      expect(typeof client.mutate).toBe('function')
      expect(typeof client.batch).toBe('function')
      expect(typeof client.query).toBe('function')
      expect(typeof client.get).toBe('function')
    })
  })

  // ===========================================================================
  // Type Safety Tests
  // ===========================================================================

  describe('type safety', () => {
    it('returns typed results from get', async () => {
      interface Task {
        $id: string
        $type: string
        data: {
          title: string
          completed: boolean
        }
      }

      const mockTask: Task = {
        $id: 'task-1',
        $type: 'Task',
        data: { title: 'My Task', completed: false },
      }

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: mockTask },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const task = await client.get<Task>('Task', 'task-1')

      // TypeScript should know these properties exist
      expect(task?.$id).toBe('task-1')
      expect(task?.data.title).toBe('My Task')
    })

    it('returns typed array from query', async () => {
      interface Task {
        $id: string
        $type: string
        data: { title: string }
      }

      const mockTasks: Task[] = [
        { $id: 'task-1', $type: 'Task', data: { title: 'Task 1' } },
        { $id: 'task-2', $type: 'Task', data: { title: 'Task 2' } },
      ]

      mockFetch.mockResolvedValue(
        mockResponse(
          createBatchResponse('req-1', [
            { promiseId: 'p-1', type: 'value', value: mockTasks },
          ])
        )
      )

      const client = createRPCClient({ url: 'https://example.com/rpc' })
      const tasks = await client.query<Task>({ collection: 'Task' })

      expect(tasks).toHaveLength(2)
      expect(tasks[0].data.title).toBe('Task 1')
    })
  })
})
