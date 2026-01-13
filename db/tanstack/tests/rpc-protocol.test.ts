/**
 * RPC Protocol Tests - TanStack DB Cap'n Web RPC
 *
 * Tests for the RPC client implementation that provides Cap'n Web protocol-based
 * communication for CRUD mutations. The protocol supports:
 * - Single and batch operations
 * - Promise pipelining for batching multiple operations in a single round trip
 * - Error propagation from server to client
 *
 * Wire Protocol Reference:
 *
 * Request Format:
 *   {
 *     id: string (UUID),
 *     type: 'call' | 'batch',
 *     calls: [{
 *       promiseId: string,
 *       target: { type: 'root' },
 *       method: string (e.g., 'Task.create'),
 *       args: [{ type: 'value', value: unknown }]
 *     }]
 *   }
 *
 * Response Format:
 *   {
 *     id: string (matches request),
 *     type: 'result' | 'error' | 'batch',
 *     results?: [{
 *       promiseId: string,
 *       type: 'value' | 'promise' | 'error',
 *       value?: unknown,
 *       error?: { code: string, message: string }
 *     }],
 *     error?: { code: string, message: string }
 *   }
 *
 * @module db/tanstack/tests/rpc-protocol.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  CapnWebRequest,
  CapnWebResponse,
  MutationType,
  MutationOperation,
  MutationResult,
  RpcClient,
  RpcClientConfig,
} from '../rpc'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock fetch implementation for testing HTTP requests
 */
interface MockFetchCall {
  url: string
  options: RequestInit
  body: CapnWebRequest
}

let mockFetchCalls: MockFetchCall[] = []
let mockFetchResponse: CapnWebResponse | Error = {
  id: 'test-id',
  type: 'result',
  results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
}

const mockFetch = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
  const body = JSON.parse(options?.body as string) as CapnWebRequest
  mockFetchCalls.push({ url, options: options ?? {}, body })

  if (mockFetchResponse instanceof Error) {
    throw mockFetchResponse
  }

  // If response id is not set, use the request id
  const response: CapnWebResponse = {
    ...mockFetchResponse,
    id: mockFetchResponse.id || body.id,
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

let originalFetch: typeof fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  mockFetchCalls = []
  mockFetchResponse = {
    id: 'test-id',
    type: 'result',
    results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
  }
  vi.clearAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ============================================================================
// TEST HELPERS
// ============================================================================

function setMockResponse(response: CapnWebResponse | Error): void {
  mockFetchResponse = response
}

function setMockHttpError(status: number): void {
  mockFetch.mockImplementationOnce(async () => {
    return new Response(null, { status, statusText: `HTTP ${status}` })
  })
}

function getLastRequest(): CapnWebRequest | undefined {
  return mockFetchCalls[mockFetchCalls.length - 1]?.body
}

function getLastFetchOptions(): RequestInit | undefined {
  return mockFetchCalls[mockFetchCalls.length - 1]?.options
}

// ============================================================================
// TESTS: URL Helpers
// ============================================================================

describe('URL helpers', () => {
  describe('deriveRpcUrl()', () => {
    it('should convert WebSocket URL to HTTP RPC URL', async () => {
      const { deriveRpcUrl } = await import('../rpc')

      expect(deriveRpcUrl('wss://example.com/do/123')).toBe('https://example.com/do/123/rpc')
    })

    it('should handle ws:// protocol', async () => {
      const { deriveRpcUrl } = await import('../rpc')

      expect(deriveRpcUrl('ws://localhost:8787/do/123')).toBe('http://localhost:8787/do/123/rpc')
    })

    it('should strip /sync suffix before adding /rpc', async () => {
      const { deriveRpcUrl } = await import('../rpc')

      expect(deriveRpcUrl('wss://example.com/do/123/sync')).toBe('https://example.com/do/123/rpc')
    })

    it('should handle URLs without path', async () => {
      const { deriveRpcUrl } = await import('../rpc')

      expect(deriveRpcUrl('wss://example.com')).toBe('https://example.com/rpc')
    })

    it('should handle complex paths', async () => {
      const { deriveRpcUrl } = await import('../rpc')

      expect(deriveRpcUrl('wss://api.example.com/v1/tenant/abc/do/xyz')).toBe(
        'https://api.example.com/v1/tenant/abc/do/xyz/rpc'
      )
    })
  })

  describe('validateUrl()', () => {
    it('should accept valid HTTP URLs', async () => {
      const { validateUrl } = await import('../rpc')

      expect(() => validateUrl('https://example.com/rpc')).not.toThrow()
    })

    it('should accept valid WebSocket URLs', async () => {
      const { validateUrl } = await import('../rpc')

      expect(() => validateUrl('wss://example.com/sync')).not.toThrow()
    })

    it('should throw for invalid URLs', async () => {
      const { validateUrl } = await import('../rpc')

      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL: not-a-url')
    })

    it('should throw for empty strings', async () => {
      const { validateUrl } = await import('../rpc')

      expect(() => validateUrl('')).toThrow('Invalid URL: ')
    })

    it('should throw for relative paths', async () => {
      const { validateUrl } = await import('../rpc')

      expect(() => validateUrl('/api/rpc')).toThrow()
    })
  })
})

// ============================================================================
// TESTS: Message Encoding
// ============================================================================

describe('Message encoding', () => {
  describe('single mutation encoding', () => {
    it('should encode create mutation with proper structure', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', {
        type: 'create',
        key: 'task-1',
        data: { title: 'New Task', status: 'todo' },
      })

      const request = getLastRequest()
      expect(request).toBeDefined()
      expect(request!.type).toBe('call')
      expect(request!.calls).toHaveLength(1)
      expect(request!.calls[0].method).toBe('Task.create')
      expect(request!.calls[0].target).toEqual({ type: 'root' })
      expect(request!.calls[0].args).toHaveLength(1)
      expect(request!.calls[0].args[0]).toEqual({
        type: 'value',
        value: { title: 'New Task', status: 'todo' },
      })
    })

    it('should encode update mutation', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', {
        type: 'update',
        key: 'task-1',
        data: { status: 'done' },
      })

      const request = getLastRequest()
      expect(request!.calls[0].method).toBe('Task.update')
      expect(request!.calls[0].args[0].value).toEqual({ status: 'done' })
    })

    it('should encode delete mutation with key only', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', {
        type: 'delete',
        key: 'task-1',
      })

      const request = getLastRequest()
      expect(request!.calls[0].method).toBe('Task.delete')
      expect(request!.calls[0].args[0].value).toEqual({ key: 'task-1' })
    })

    it('should encode insert mutation', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', {
        type: 'insert',
        key: 'task-1',
        data: { title: 'Inserted Task' },
      })

      const request = getLastRequest()
      expect(request!.calls[0].method).toBe('Task.insert')
    })

    it('should generate unique request IDs', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      const request1 = getLastRequest()

      await client.execute('Task', { type: 'create', key: 'task-2', data: {} })
      const request2 = getLastRequest()

      expect(request1!.id).not.toBe(request2!.id)
      // Should be valid UUIDs
      expect(request1!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('should generate sequential promise IDs', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'batch',
        results: [
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
        ],
      })

      await client.executeBatch('Task', [
        { type: 'create', key: 'task-1', data: {} },
        { type: 'create', key: 'task-2', data: {} },
        { type: 'create', key: 'task-3', data: {} },
      ])

      const request = getLastRequest()
      expect(request!.calls[0].promiseId).toBe('p-1')
      expect(request!.calls[1].promiseId).toBe('p-2')
      expect(request!.calls[2].promiseId).toBe('p-3')
    })
  })

  describe('batch mutation encoding', () => {
    it('should encode multiple mutations as batch request', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'batch',
        results: [
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
        ],
      })

      await client.executeBatch('Task', [
        { type: 'create', key: 'task-1', data: { title: 'Task 1' } },
        { type: 'create', key: 'task-2', data: { title: 'Task 2' } },
      ])

      const request = getLastRequest()
      expect(request!.type).toBe('batch')
      expect(request!.calls).toHaveLength(2)
    })

    it('should use call type for single item batch', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.executeBatch('Task', [{ type: 'create', key: 'task-1', data: {} }])

      const request = getLastRequest()
      expect(request!.type).toBe('call')
    })

    it('should return empty array for empty batch', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      const results = await client.executeBatch('Task', [])

      expect(results).toEqual([])
      expect(mockFetchCalls).toHaveLength(0) // No HTTP call made
    })

    it('should support mixed mutation types in batch', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'batch',
        results: [
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
        ],
      })

      await client.executeBatch('Task', [
        { type: 'create', key: 'task-1', data: { title: 'New Task' } },
        { type: 'update', key: 'task-2', data: { status: 'done' } },
        { type: 'delete', key: 'task-3' },
      ])

      const request = getLastRequest()
      expect(request!.calls[0].method).toBe('Task.create')
      expect(request!.calls[1].method).toBe('Task.update')
      expect(request!.calls[2].method).toBe('Task.delete')
    })
  })
})

// ============================================================================
// TESTS: Message Decoding / Response Handling
// ============================================================================

describe('Response handling', () => {
  describe('successful responses', () => {
    it('should decode single result', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'result',
        results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 42 } }],
      })

      const result = await client.execute('Task', {
        type: 'create',
        key: 'task-1',
        data: {},
      })

      expect(result).toEqual({ success: true, rowid: 42 })
    })

    it('should decode batch results in order', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'batch',
        results: [
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
          { promiseId: 'p-3', type: 'value', value: { success: true, rowid: 3 } },
        ],
      })

      const results = await client.executeBatch('Task', [
        { type: 'create', key: 'task-1', data: {} },
        { type: 'create', key: 'task-2', data: {} },
        { type: 'create', key: 'task-3', data: {} },
      ])

      expect(results).toEqual([
        { success: true, rowid: 1 },
        { success: true, rowid: 2 },
        { success: true, rowid: 3 },
      ])
    })

    it('should handle promise-type results', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      // Promise-type results still have a value
      setMockResponse({
        id: 'test',
        type: 'result',
        results: [{ promiseId: 'p-1', type: 'promise', value: { success: true, rowid: 1 } }],
      })

      const result = await client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      expect(result).toEqual({ success: true, rowid: 1 })
    })
  })

  describe('error responses', () => {
    it('should propagate top-level errors', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Server exploded' },
      })

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('Server exploded')
    })

    it('should propagate per-result errors', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'batch',
        results: [
          { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
          { promiseId: 'p-2', type: 'error', error: { code: 'NOT_FOUND', message: 'Item not found' } },
        ],
      })

      await expect(
        client.executeBatch('Task', [
          { type: 'create', key: 'task-1', data: {} },
          { type: 'update', key: 'task-2', data: {} },
        ])
      ).rejects.toThrow('Item not found')
    })

    it('should throw on empty results', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'result',
        results: [],
      })

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('No results in response')
    })

    it('should throw on missing results array', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockResponse({
        id: 'test',
        type: 'result',
        // results omitted
      } as CapnWebResponse)

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('No results in response')
    })
  })
})

// ============================================================================
// TESTS: HTTP Layer
// ============================================================================

describe('HTTP layer', () => {
  describe('request formatting', () => {
    it('should send POST request with JSON content type', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      const options = getLastFetchOptions()
      expect(options!.method).toBe('POST')
      expect((options!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    })

    it('should send to configured RPC URL', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://my-api.example.com/v1/rpc' })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      expect(mockFetchCalls[0].url).toBe('https://my-api.example.com/v1/rpc')
    })

    it('should merge custom fetch options', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({
        rpcUrl: 'https://example.com/rpc',
        fetchOptions: {
          headers: {
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          },
          credentials: 'include',
        },
      })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      const options = getLastFetchOptions()
      expect((options!.headers as Record<string, string>)['Authorization']).toBe('Bearer token123')
      expect((options!.headers as Record<string, string>)['X-Custom-Header']).toBe('custom-value')
      expect(options!.credentials).toBe('include')
    })

    it('should preserve Content-Type even with custom headers', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({
        rpcUrl: 'https://example.com/rpc',
        fetchOptions: {
          headers: { 'Accept': 'application/json' },
        },
      })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      const options = getLastFetchOptions()
      expect((options!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    })
  })

  describe('HTTP errors', () => {
    it('should throw on 4xx errors', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockHttpError(400)

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('HTTP error: 400')
    })

    it('should throw on 5xx errors', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockHttpError(500)

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('HTTP error: 500')
    })

    it('should throw on 401 unauthorized', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockHttpError(401)

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('HTTP error: 401')
    })

    it('should throw on 404 not found', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      setMockHttpError(404)

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('HTTP error: 404')
    })

    it('should handle network errors', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      await expect(
        client.execute('Task', { type: 'create', key: 'task-1', data: {} })
      ).rejects.toThrow('Network failure')
    })
  })

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should use default timeout of 30 seconds', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

      // Mock a slow response
      mockFetch.mockImplementationOnce(async (_url, options) => {
        // Check that signal is present
        expect(options?.signal).toBeDefined()
        return new Response(JSON.stringify({
          id: 'test',
          type: 'result',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
        }))
      })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    it('should allow custom timeout', async () => {
      const { createRpcClient } = await import('../rpc')
      const client = createRpcClient({
        rpcUrl: 'https://example.com/rpc',
        timeout: 5000,
      })

      mockFetch.mockImplementationOnce(async (_url, options) => {
        expect(options?.signal).toBeDefined()
        return new Response(JSON.stringify({
          id: 'test',
          type: 'result',
          results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
        }))
      })

      await client.execute('Task', { type: 'create', key: 'task-1', data: {} })

      expect(mockFetch).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// TESTS: Generic RPC Call
// ============================================================================

describe('Generic RPC call', () => {
  it('should call arbitrary methods', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'value', value: { items: [1, 2, 3], count: 3 } }],
    })

    const result = await client.call<{ items: number[]; count: number }>(
      'CustomService.getItems',
      [{ filter: 'active' }]
    )

    expect(result).toEqual({ items: [1, 2, 3], count: 3 })

    const request = getLastRequest()
    expect(request!.calls[0].method).toBe('CustomService.getItems')
    expect(request!.calls[0].args[0].value).toEqual({ filter: 'active' })
  })

  it('should handle multiple arguments', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'value', value: 'ok' }],
    })

    await client.call('Service.methodWithArgs', ['arg1', { key: 'value' }, 123, true])

    const request = getLastRequest()
    expect(request!.calls[0].args).toHaveLength(4)
    expect(request!.calls[0].args[0].value).toBe('arg1')
    expect(request!.calls[0].args[1].value).toEqual({ key: 'value' })
    expect(request!.calls[0].args[2].value).toBe(123)
    expect(request!.calls[0].args[3].value).toBe(true)
  })

  it('should handle zero arguments', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'value', value: 'pong' }],
    })

    const result = await client.call<string>('Health.ping', [])

    expect(result).toBe('pong')
    expect(getLastRequest()!.calls[0].args).toHaveLength(0)
  })

  it('should propagate errors from generic calls', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'error',
      error: { code: 'METHOD_NOT_FOUND', message: 'Unknown method' },
    })

    await expect(client.call('Unknown.method', [])).rejects.toThrow('Unknown method')
  })

  it('should handle per-result errors in generic calls', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'error', error: { code: 'INVALID_ARG', message: 'Bad argument' } }],
    })

    await expect(client.call('Service.method', ['invalid'])).rejects.toThrow('Bad argument')
  })
})

// ============================================================================
// TESTS: Protocol Compliance
// ============================================================================

describe('Protocol compliance', () => {
  it('should use root target for all calls', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    setMockResponse({
      id: 'test',
      type: 'batch',
      results: [
        { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
        { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
      ],
    })

    await client.executeBatch('Task', [
      { type: 'create', key: 'task-1', data: {} },
      { type: 'delete', key: 'task-2' },
    ])

    const request = getLastRequest()
    for (const call of request!.calls) {
      expect(call.target).toEqual({ type: 'root' })
    }
  })

  it('should format arguments as value type', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    await client.execute('Task', {
      type: 'create',
      key: 'task-1',
      data: { nested: { deep: { value: 42 } } },
    })

    const request = getLastRequest()
    expect(request!.calls[0].args[0].type).toBe('value')
    expect(request!.calls[0].args[0].value).toEqual({ nested: { deep: { value: 42 } } })
  })

  it('should preserve data types in serialization', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    const data = {
      string: 'hello',
      number: 42,
      float: 3.14,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      object: { key: 'value' },
    }

    await client.execute('Task', { type: 'create', key: 'task-1', data })

    const request = getLastRequest()
    expect(request!.calls[0].args[0].value).toEqual(data)
  })

  it('should handle special characters in collection names', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    await client.execute('My_Special_Collection', { type: 'create', key: 'key-1', data: {} })

    const request = getLastRequest()
    expect(request!.calls[0].method).toBe('My_Special_Collection.create')
  })

  it('should use fallback key data when no data provided', async () => {
    const { createRpcClient } = await import('../rpc')
    const client = createRpcClient({ rpcUrl: 'https://example.com/rpc' })

    await client.execute('Task', { type: 'create', key: 'task-key-123' })

    const request = getLastRequest()
    expect(request!.calls[0].args[0].value).toEqual({ key: 'task-key-123' })
  })
})

// ============================================================================
// TESTS: Deprecated API
// ============================================================================

describe('Deprecated executeMutations function', () => {
  it('should work as standalone function', async () => {
    const { executeMutations } = await import('../rpc')

    setMockResponse({
      id: 'test',
      type: 'batch',
      results: [
        { promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } },
        { promiseId: 'p-2', type: 'value', value: { success: true, rowid: 2 } },
      ],
    })

    const results = await executeMutations('https://example.com/rpc', 'Task', [
      { type: 'create', key: 'task-1', data: { title: 'Task 1' } },
      { type: 'create', key: 'task-2', data: { title: 'Task 2' } },
    ])

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ success: true, rowid: 1 })
    expect(results[1]).toEqual({ success: true, rowid: 2 })
  })

  it('should accept custom fetch options', async () => {
    const { executeMutations } = await import('../rpc')

    setMockResponse({
      id: 'test',
      type: 'result',
      results: [{ promiseId: 'p-1', type: 'value', value: { success: true, rowid: 1 } }],
    })

    await executeMutations(
      'https://example.com/rpc',
      'Task',
      [{ type: 'create', key: 'task-1', data: {} }],
      { headers: { Authorization: 'Bearer token' } }
    )

    const options = getLastFetchOptions()
    expect((options!.headers as Record<string, string>)['Authorization']).toBe('Bearer token')
  })
})

// ============================================================================
// TESTS: Type Exports
// ============================================================================

describe('Type exports', () => {
  it('should export all required types', async () => {
    const rpc = await import('../rpc')

    // Type exports are compile-time only, so we just verify the module loads
    expect(rpc.createRpcClient).toBeDefined()
    expect(rpc.deriveRpcUrl).toBeDefined()
    expect(rpc.validateUrl).toBeDefined()
    expect(rpc.executeMutations).toBeDefined()
  })
})
