import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BatchRPCBuilder,
  BatchDORPCBuilder,
  createBatchRPC,
  createBatchDORPC,
  executeBatchRPC,
  executeBatchDORPC,
  type BatchRPCResult,
  type BatchRPCResponse,
} from '../batch-rpc'
import { NotFoundError, ValidationError } from '../errors'

// Mock fetch for testing
const mockFetch = vi.fn()
const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch
  mockFetch.mockReset()
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('Batch RPC', () => {
  describe('BatchRPCBuilder', () => {
    it('should create an empty batch builder', () => {
      const batch = new BatchRPCBuilder('http://localhost:8787')
      expect(batch.size).toBe(0)
      expect(batch.isEmpty).toBe(true)
    })

    it('should add calls to the batch', () => {
      const batch = new BatchRPCBuilder('http://localhost:8787')
        .add('things.get', ['id1'])
        .add('things.get', ['id2'])
        .add('events.list', [{ limit: 10 }])

      expect(batch.size).toBe(3)
      expect(batch.isEmpty).toBe(false)
    })

    it('should support method chaining', () => {
      const batch = new BatchRPCBuilder('http://localhost:8787')

      const result = batch
        .add('method1', [])
        .add('method2', [1, 2])
        .add('method3', ['a', 'b', 'c'])

      expect(result).toBe(batch)
      expect(batch.size).toBe(3)
    })

    it('should clear all calls', () => {
      const batch = new BatchRPCBuilder('http://localhost:8787')
        .add('method1', [])
        .add('method2', [])

      expect(batch.size).toBe(2)

      batch.clear()
      expect(batch.size).toBe(0)
      expect(batch.isEmpty).toBe(true)
    })

    it('should execute empty batch and return empty array', async () => {
      const batch = new BatchRPCBuilder('http://localhost:8787')
      const results = await batch.execute()

      expect(results).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should execute batch and return results', async () => {
      const mockResponse: BatchRPCResponse = {
        results: [
          { id: 'call-0', result: { value: 1 } },
          { id: 'call-1', result: { value: 2 } },
          { id: 'call-2', result: [{ id: 1 }, { id: 2 }] },
        ],
        correlationId: 'test-correlation-id',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const results = await createBatchRPC('http://localhost:8787')
        .add('things.get', ['id1'])
        .add('things.get', ['id2'])
        .add('events.list', [{ limit: 10 }])
        .execute()

      expect(results).toHaveLength(3)
      expect(results[0].result).toEqual({ value: 1 })
      expect(results[1].result).toEqual({ value: 2 })
      expect(results[2].result).toEqual([{ id: 1 }, { id: 2 }])

      // Verify fetch was called correctly
      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[0]).toBe('http://localhost:8787/rpc/batch')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json')
      expect(fetchCall[1].headers['X-Correlation-ID']).toBeTruthy()

      const body = JSON.parse(fetchCall[1].body)
      expect(body.calls).toHaveLength(3)
      expect(body.calls[0]).toEqual({ method: 'things.get', args: ['id1'], id: 'call-0' })
      expect(body.calls[1]).toEqual({ method: 'things.get', args: ['id2'], id: 'call-1' })
      expect(body.calls[2]).toEqual({ method: 'events.list', args: [{ limit: 10 }], id: 'call-2' })
    })

    it('should handle partial failures', async () => {
      const mockResponse: BatchRPCResponse = {
        results: [
          { id: 'call-0', result: { value: 1 } },
          {
            id: 'call-1',
            error: {
              type: 'NotFoundError',
              code: 'NOT_FOUND',
              message: 'Resource not found',
              httpStatus: 404,
            },
          },
          { id: 'call-2', result: { value: 3 } },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const results = await createBatchRPC('http://localhost:8787')
        .add('method1', [])
        .add('method2', [])
        .add('method3', [])
        .execute()

      expect(results).toHaveLength(3)
      expect(results[0].result).toEqual({ value: 1 })
      expect(results[0].error).toBeUndefined()

      expect(results[1].error).toBeDefined()
      expect(results[1].error?.code).toBe('NOT_FOUND')
      expect(results[1].result).toBeUndefined()

      expect(results[2].result).toEqual({ value: 3 })
      expect(results[2].error).toBeUndefined()
    })

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'X-Correlation-ID': 'error-correlation-id' }),
      })

      const batch = createBatchRPC('http://localhost:8787')
        .add('method1', [])

      await expect(batch.execute()).rejects.toThrow('Batch RPC error: 500')
    })

    it('should use custom call IDs when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'my-custom-id-1', result: 'a' },
            { id: 'my-custom-id-2', result: 'b' },
          ],
        }),
      })

      await createBatchRPC('http://localhost:8787')
        .add('method1', [], 'my-custom-id-1')
        .add('method2', [], 'my-custom-id-2')
        .execute()

      const fetchCall = mockFetch.mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.calls[0].id).toBe('my-custom-id-1')
      expect(body.calls[1].id).toBe('my-custom-id-2')
    })
  })

  describe('createBatchRPC factory', () => {
    it('should create a batch builder', () => {
      const batch = createBatchRPC('http://localhost:8787')
      expect(batch).toBeInstanceOf(BatchRPCBuilder)
    })

    it('should pass options to the builder', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ id: 'call-0', result: 'ok' }] }),
      })

      await createBatchRPC('http://localhost:8787', { correlationId: 'my-correlation-id' })
        .add('method', [])
        .execute()

      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[1].headers['X-Correlation-ID']).toBe('my-correlation-id')
    })
  })

  describe('executeBatchRPC function', () => {
    it('should return empty array for empty calls', async () => {
      const results = await executeBatchRPC('http://localhost:8787', [])
      expect(results).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should execute batch directly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'call-0', result: { data: 'test' } },
          ],
        }),
      })

      const results = await executeBatchRPC('http://localhost:8787', [
        { method: 'getData', args: ['key'], id: 'call-0' },
      ])

      expect(results).toHaveLength(1)
      expect(results[0].result).toEqual({ data: 'test' })
    })

    it('should throw on first error when throwOnError is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'call-0', result: 'ok' },
            {
              id: 'call-1',
              error: {
                type: 'ValidationError',
                code: 'VALIDATION_ERROR',
                message: 'Invalid input',
                httpStatus: 400,
              },
            },
            { id: 'call-2', result: 'ok' },
          ],
        }),
      })

      await expect(
        executeBatchRPC(
          'http://localhost:8787',
          [
            { method: 'method1', args: [] },
            { method: 'method2', args: [] },
            { method: 'method3', args: [] },
          ],
          { throwOnError: true }
        )
      ).rejects.toThrow('Invalid input')
    })
  })

  describe('executeStrict', () => {
    it('should return just the result values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'call-0', result: { name: 'Alice' } },
            { id: 'call-1', result: { name: 'Bob' } },
          ],
        }),
      })

      const results = await createBatchRPC('http://localhost:8787')
        .add('getUser', ['id1'])
        .add('getUser', ['id2'])
        .executeStrict<{ name: string }>()

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({ name: 'Alice' })
      expect(results[1]).toEqual({ name: 'Bob' })
    })

    it('should throw on any error in results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'call-0', result: { name: 'Alice' } },
            {
              id: 'call-1',
              error: {
                type: 'NotFoundError',
                code: 'NOT_FOUND',
                message: 'User not found',
                httpStatus: 404,
              },
            },
          ],
        }),
      })

      await expect(
        createBatchRPC('http://localhost:8787')
          .add('getUser', ['id1'])
          .add('getUser', ['invalid-id'])
          .executeStrict()
      ).rejects.toThrow('User not found')
    })
  })

  describe('BatchDORPCBuilder', () => {
    it('should execute batch on DO stub', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { id: 'call-0', result: { count: 42 } },
            ],
          }),
        }),
      } as unknown as DurableObjectStub

      const results = await createBatchDORPC(mockStub)
        .add('getCount', [])
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].result).toEqual({ count: 42 })

      // Verify fetch was called on the stub
      const fetchCall = mockStub.fetch.mock.calls[0]
      expect(fetchCall[0]).toBe('https://do/rpc/batch')
      expect(fetchCall[1].method).toBe('POST')
    })

    it('should handle empty batch', async () => {
      const mockStub = {
        fetch: vi.fn(),
      } as unknown as DurableObjectStub

      const results = await createBatchDORPC(mockStub).execute()

      expect(results).toEqual([])
      expect(mockStub.fetch).not.toHaveBeenCalled()
    })

    it('should support all builder methods', () => {
      const mockStub = {} as DurableObjectStub

      const batch = new BatchDORPCBuilder(mockStub)
        .add('method1', ['arg1'])
        .add('method2', ['arg2'])

      expect(batch.size).toBe(2)
      expect(batch.isEmpty).toBe(false)

      batch.clear()
      expect(batch.size).toBe(0)
      expect(batch.isEmpty).toBe(true)
    })
  })

  describe('executeBatchDORPC function', () => {
    it('should return empty array for empty calls', async () => {
      const mockStub = {
        fetch: vi.fn(),
      } as unknown as DurableObjectStub

      const results = await executeBatchDORPC(mockStub, [])

      expect(results).toEqual([])
      expect(mockStub.fetch).not.toHaveBeenCalled()
    })

    it('should execute batch on stub', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { id: 'call-0', result: 'value1' },
              { id: 'call-1', result: 'value2' },
            ],
          }),
        }),
      } as unknown as DurableObjectStub

      const results = await executeBatchDORPC(mockStub, [
        { method: 'get', args: ['key1'], id: 'call-0' },
        { method: 'get', args: ['key2'], id: 'call-1' },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].result).toBe('value1')
      expect(results[1].result).toBe('value2')
    })

    it('should throw on stub error', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers({ 'X-Correlation-ID': 'error-id' }),
        }),
      } as unknown as DurableObjectStub

      await expect(
        executeBatchDORPC(mockStub, [{ method: 'fail', args: [] }])
      ).rejects.toThrow('Batch DO RPC error: 500')
    })
  })
})
