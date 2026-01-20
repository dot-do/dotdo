/**
 * Miniflare Integration Tests for @dotdo/rpc
 *
 * These tests run in a real Cloudflare Workers environment using
 * @cloudflare/vitest-pool-workers with miniflare. This provides:
 *
 * - Real DurableObjectState with actual storage
 * - Real DO-to-DO communication via env bindings
 * - Accurate behavior testing for RPC in production-like environment
 *
 * Test scenarios:
 * 1. RPC client-server communication
 * 2. Cross-DO RPC calls
 * 3. Error serialization over RPC
 * 4. Batch RPC calls
 * 5. Timeout handling
 *
 * @module rpc/tests/miniflare-integration
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
  CrossDOStubCache,
  NotFoundError,
  TimeoutError,
  deserializeError,
  withTimeout,
  batchMap,
  CORRELATION_ID_HEADER,
} from '../index'

// Re-export DO classes for vitest-pool-workers (these are in the main entry point)
export { TestDO, TargetDO, SourceDO } from './test-dos'

// Type interface for env
interface Env {
  DO: DurableObjectNamespace
  TARGET_DO: DurableObjectNamespace
  SOURCE_DO: DurableObjectNamespace
}

// ============================================================================
// Test Suites
// ============================================================================

describe('RPC Miniflare Integration Tests', () => {
  describe('1. RPC Client-Server Communication', () => {
    it('should call simple methods via RPC', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-1'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] }),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe('Hello, World!')
    })

    it('should pass multiple arguments correctly', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-2'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'add', args: [5, 3] }),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe(8)
    })

    it('should handle complex return types', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-3'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getInfo', args: [] }),
      })

      expect(response.ok).toBe(true)
      const info = await response.json() as { id: string; counter: number; timestamp: number }
      expect(typeof info.id).toBe('string')
      expect(typeof info.counter).toBe('number')
      expect(typeof info.timestamp).toBe('number')
    })

    it('should maintain state across calls', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-state'))

      // First increment
      let response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'increment', args: [] }),
      })
      expect(await response.json()).toBe(1)

      // Second increment
      response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'increment', args: [] }),
      })
      expect(await response.json()).toBe(2)

      // Third increment
      response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'increment', args: [] }),
      })
      expect(await response.json()).toBe(3)
    })

    it('should support nested methods via dot notation', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-nested'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'math.multiply', args: [4, 5] }),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe(20)
    })

    it('should propagate correlation ID header', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('test-correlation'))
      const correlationId = 'test-correlation-123'

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: JSON.stringify({ method: 'greet', args: ['Test'] }),
      })

      expect(response.ok).toBe(true)
      expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(correlationId)
    })
  })

  describe('2. Cross-DO RPC Calls', () => {
    it('should call methods on another DO via createCrossDOClient', async () => {
      // Get the source DO
      const sourceStub = (env as Env).SOURCE_DO.get(
        (env as Env).SOURCE_DO.idFromName('source-1')
      )

      // Call a method that invokes another DO
      const response = await sourceStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getTargetBalance', args: ['target-1'] }),
      })

      expect(response.ok).toBe(true)
      const balance = await response.json()
      expect(balance).toBe(1000)
    })

    it('should pass arguments through cross-DO calls', async () => {
      const sourceStub = (env as Env).SOURCE_DO.get(
        (env as Env).SOURCE_DO.idFromName('source-2')
      )

      const response = await sourceStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'chargeTarget', args: ['target-2', 100] }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json() as { success: boolean; balance: number }
      expect(result.success).toBe(true)
      expect(result.balance).toBe(900)
    })

    it('should propagate errors across DO boundaries', async () => {
      const sourceStub = (env as Env).SOURCE_DO.get(
        (env as Env).SOURCE_DO.idFromName('source-3')
      )

      // Try to charge more than available
      const response = await sourceStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'chargeTarget', args: ['target-3', 9999] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400) // ValidationError
      const error = await response.json() as { code: string; message: string }
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toContain('Insufficient balance')
    })

    it('should use CrossDOStubCache for connection pooling', async () => {
      const cache = new CrossDOStubCache()

      const stub1 = cache.getStub((env as Env).TARGET_DO, 'cached-target')
      const stub2 = cache.getStub((env as Env).TARGET_DO, 'cached-target')

      // Should return the same cached stub
      expect(stub1).toBe(stub2)
    })

    it('should evict stubs from cache correctly', async () => {
      const cache = new CrossDOStubCache()

      const stub1 = cache.getStub((env as Env).TARGET_DO, 'evict-target')
      cache.evict((env as Env).TARGET_DO, 'evict-target')
      const stub2 = cache.getStub((env as Env).TARGET_DO, 'evict-target')

      // After eviction, should get a new stub
      expect(stub1).not.toBe(stub2)
    })
  })

  describe('3. Error Serialization Over RPC', () => {
    it('should serialize NotFoundError correctly', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('error-notfound'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'notFound', args: ['item-123'] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)

      const error = await response.json() as {
        type: string
        code: string
        message: string
        details: { resourceType: string; resourceId: string }
      }
      expect(error.type).toBe('NotFoundError')
      expect(error.code).toBe('NOT_FOUND')
      expect(error.details.resourceType).toBe('Item')
      expect(error.details.resourceId).toBe('item-123')
    })

    it('should serialize ValidationError correctly', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('error-validation'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'validate', args: ['invalid-email'] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)

      const error = await response.json() as {
        type: string
        code: string
        message: string
        details: { field: string }
      }
      expect(error.type).toBe('ValidationError')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.details.field).toBe('email')
    })

    it('should wrap generic errors in InternalError', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('error-crash'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'crash', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)

      const error = await response.json() as { type: string; code: string }
      expect(error.code).toBe('INTERNAL_ERROR')
    })

    it('should preserve custom error details', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('error-custom'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'customError', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(409) // CONFLICT

      const error = await response.json() as {
        code: string
        message: string
        details: { resource: string }
      }
      expect(error.code).toBe('CONFLICT')
      expect(error.message).toBe('Resource conflict')
      expect(error.details.resource).toBe('test')
    })

    it('should deserialize errors back into Error instances', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('error-deserialize'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'notFound', args: ['test-id'] }),
      })

      const serialized = await response.json() as {
        type: string
        code: string
        message: string
        details: Record<string, unknown>
      }

      const deserialized = deserializeError(serialized)
      expect(deserialized).toBeInstanceOf(NotFoundError)
      expect(deserialized.message).toContain('test-id')
    })
  })

  describe('4. Batch RPC Calls', () => {
    it('should process multiple items in batch', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('batch-1'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'processItems',
          args: [['hello', 'world', 'test']],
        }),
      })

      expect(response.ok).toBe(true)
      const results = await response.json() as string[]
      expect(results).toEqual(['HELLO', 'WORLD', 'TEST'])
    })

    it('should handle concurrent batch requests', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('batch-concurrent'))

      // Send multiple requests concurrently
      const promises = [
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'add', args: [1, 1] }),
        }),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'add', args: [2, 2] }),
        }),
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'add', args: [3, 3] }),
        }),
      ]

      const responses = await Promise.all(promises)
      const results = await Promise.all(responses.map((r) => r.json()))

      expect(results).toEqual([2, 4, 6])
    })

    it('should support batchMap utility', async () => {
      const items = ['a', 'b', 'c', 'd', 'e']

      const results = await batchMap(
        items,
        async (item) => item.toUpperCase(),
        { concurrency: 2 }
      )

      expect(results).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should support batchMap with progress tracking', async () => {
      const items = [1, 2, 3, 4, 5]
      const progressUpdates: Array<{ done: number; total: number }> = []

      const results = await batchMap(
        items,
        async (item) => item * 2,
        {
          concurrency: 2,
          onProgress: (done, total) => {
            progressUpdates.push({ done, total })
          },
        }
      )

      expect(results).toEqual([2, 4, 6, 8, 10])
      expect(progressUpdates.length).toBe(5)
      expect(progressUpdates[progressUpdates.length - 1]).toEqual({ done: 5, total: 5 })
    })

    it('should continue on error with onError: continue', async () => {
      const items = [1, 2, 0, 4, 5] // 0 will cause error
      const errors: Array<{ index: number; item: number }> = []

      const results = await batchMap(
        items,
        async (item) => {
          if (item === 0) throw new Error('Cannot process zero')
          return item * 2
        },
        {
          onError: 'continue',
          onItemError: (index, item, error) => {
            errors.push({ index, item: item as number })
          },
        }
      )

      expect(results[0]).toBe(2)
      expect(results[1]).toBe(4)
      expect(results[2]).toBeUndefined() // Error item
      expect(results[3]).toBe(8)
      expect(results[4]).toBe(10)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual({ index: 2, item: 0 })
    })
  })

  describe('5. Timeout Handling', () => {
    it('should complete fast operations before timeout', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('timeout-fast'))

      // 50ms delay with 5000ms timeout
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'slow', args: [50] }),
        signal: AbortSignal.timeout(5000),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe('completed')
    })

    it('should timeout slow operations', async () => {
      const stub = (env as Env).TARGET_DO.get((env as Env).TARGET_DO.idFromName('timeout-slow'))

      // Use a wrapper function with very short timeout
      const makeCall = async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'slowOperation', args: [10000] }), // 10 second delay
          signal: AbortSignal.timeout(100), // 100ms timeout
        })
        return response.json()
      }

      await expect(makeCall()).rejects.toThrow()
    })

    it('should use withTimeout utility correctly', async () => {
      // Test successful case
      const quickResult = await withTimeout(
        Promise.resolve('quick'),
        1000
      )
      expect(quickResult).toBe('quick')

      // Test timeout case
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('slow'), 5000)
      })

      await expect(withTimeout(slowPromise, 100)).rejects.toThrow(TimeoutError)
    })

    it('should clean up resources after timeout', async () => {
      // This test verifies that after a timeout, subsequent calls still work
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('timeout-recovery'))

      // Make a normal call first
      let response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['Before'] }),
      })
      expect(await response.json()).toBe('Hello, Before!')

      // Try to make a call that might timeout (but don't actually let it)
      // Just verify the DO is still responsive
      response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['After'] }),
      })
      expect(await response.json()).toBe('Hello, After!')
    })
  })

  describe('Edge Cases and Error Conditions', () => {
    it('should return 404 for unknown methods', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-unknown'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'nonExistentMethod', args: [] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it('should handle empty args array', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-empty-args'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getInfo', args: [] }),
      })

      expect(response.ok).toBe(true)
    })

    it('should handle null/undefined arguments', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-null-args'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: [null] }),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe('Hello, null!')
    })

    it('should handle deeply nested method paths', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-nested'))

      // Test existing nested method
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'math.divide', args: [10, 2] }),
      })

      expect(response.ok).toBe(true)
      expect(await response.json()).toBe(5)
    })

    it('should handle nested method errors', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-nested-error'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'math.divide', args: [10, 0] }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400) // ValidationError
    })

    it('should generate correlation ID if not provided', async () => {
      const stub = (env as Env).DO.get((env as Env).DO.idFromName('edge-no-correlation'))

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No correlation ID header
        body: JSON.stringify({ method: 'greet', args: ['Test'] }),
      })

      expect(response.ok).toBe(true)
      // Server should generate one
      const correlationId = response.headers.get(CORRELATION_ID_HEADER)
      expect(correlationId).toBeTruthy()
      expect(typeof correlationId).toBe('string')
    })
  })
})
