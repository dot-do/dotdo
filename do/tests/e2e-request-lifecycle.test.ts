/**
 * E2E Integration Tests for Full Request Lifecycle
 *
 * Issue: do-dp5q.7
 *
 * This file tests the complete request lifecycle through the dotdo stack:
 * 1. HTTP Request -> Worker -> DO -> Response
 * 2. RPC request flow (single and batch)
 * 3. Error propagation through all layers
 *
 * Uses @cloudflare/vitest-pool-workers for real miniflare instances - NO MOCKS.
 *
 * NOTE: These tests focus on the request/response lifecycle and error handling
 * at the HTTP/RPC layer. Entity CRUD tests are covered in entities-sqlite.test.ts.
 *
 * @module do/tests/e2e-request-lifecycle.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

interface InfoResponse {
  id: string
  keys: number
}

interface RPCErrorResponse {
  code: string
  message: string
  correlationId?: string
  httpStatus?: number
}

interface BatchRPCResponse {
  results: Array<{
    id: string
    result?: unknown
    error?: RPCErrorResponse
  }>
  correlationId?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getTestStub(name?: string) {
  const testName = name || generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Make an HTTP GET request to a DO stub
 */
async function httpGet(stub: DurableObjectStub, path: string): Promise<Response> {
  return stub.fetch(`https://do${path}`)
}

/**
 * Make an HTTP POST request to a DO stub
 */
async function httpPost(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return stub.fetch(`https://do${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/**
 * Make an RPC request to a DO stub
 */
async function rpcCall(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = [],
  headers: Record<string, string> = {}
): Promise<Response> {
  return httpPost(stub, '/rpc', { method, args }, headers)
}

/**
 * Make a batch RPC request to a DO stub
 */
async function batchRpcCall(
  stub: DurableObjectStub,
  calls: Array<{ id?: string; method: string; args?: unknown[] }>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return httpPost(stub, '/rpc/batch', { calls }, headers)
}

// ============================================================================
// TEST SUITE 1: HTTP Request -> Worker -> DO -> Response
// ============================================================================

describe('E2E: HTTP Request Lifecycle', () => {
  describe('Basic HTTP Flow', () => {
    it('should complete full HTTP GET request lifecycle through DO', async () => {
      const stub = getTestStub()

      // HTTP GET -> Worker would route to DO -> DO processes -> Response
      const response = await httpGet(stub, '/')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
    })

    it('should handle HTTP OPTIONS preflight request', async () => {
      const stub = getTestStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      })

      // CORS middleware should handle preflight
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeTruthy()
    })

    it('should route multiple concurrent HTTP requests to same DO instance', async () => {
      const testId = generateTestId()
      const stub = getTestStub(testId)

      // Fire multiple concurrent requests
      const requests = Array.from({ length: 5 }, () => httpGet(stub, '/'))
      const responses = await Promise.all(requests)

      // All should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // All should return same DO ID (proving single instance)
      const ids = await Promise.all(
        responses.map(async (r) => ((await r.json()) as HealthResponse).id)
      )
      expect(new Set(ids).size).toBe(1)
    })

    it('should maintain DO isolation between different namespaces', async () => {
      const stub1 = getTestStub('namespace-a-' + generateTestId())
      const stub2 = getTestStub('namespace-b-' + generateTestId())

      const [resp1, resp2] = await Promise.all([
        httpGet(stub1, '/'),
        httpGet(stub2, '/'),
      ])

      const json1 = (await resp1.json()) as HealthResponse
      const json2 = (await resp2.json()) as HealthResponse

      // Different namespaces -> different DO instances -> different IDs
      expect(json1.id).not.toBe(json2.id)
    })

    it('should return correct storage info via /info endpoint', async () => {
      const stub = getTestStub()

      const response = await httpGet(stub, '/info')

      expect(response.status).toBe(200)
      const json = (await response.json()) as InfoResponse
      expect(json.id).toBeDefined()
      expect(typeof json.keys).toBe('number')
      expect(json.keys).toBeGreaterThanOrEqual(0)
    })
  })

  describe('HTTP Request with Body Processing', () => {
    it('should handle POST request with JSON body through RPC endpoint', async () => {
      const stub = getTestStub()

      // POST to RPC endpoint - tests body parsing through full stack
      // Use a non-existent method to test the RPC infrastructure without SQLite
      const response = await httpPost(stub, '/rpc', {
        method: 'nonexistent.method',
        args: [],
      })

      // Should get 404 (method not found) - proves RPC flow works
      expect(response.status).toBe(404)
    })

    it('should handle malformed JSON gracefully', async () => {
      const stub = getTestStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      // Should return error response, not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should handle empty body gracefully', async () => {
      const stub = getTestStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })

      // Should return error response
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('HTTP Method Handling', () => {
    it('should handle GET requests to known endpoints', async () => {
      const stub = getTestStub()

      const endpoints = ['/', '/info']
      const responses = await Promise.all(endpoints.map((ep) => httpGet(stub, ep)))

      expect(responses.every((r) => r.status === 200)).toBe(true)
    })

    it('should return 404 for unknown endpoints', async () => {
      const stub = getTestStub()

      const response = await httpGet(stub, '/nonexistent-path')

      expect(response.status).toBe(404)
    })
  })
})

// ============================================================================
// TEST SUITE 2: RPC Request Flow
// ============================================================================

describe('E2E: RPC Request Flow', () => {
  describe('Single RPC Calls', () => {
    it('should execute RPC method call through full stack', async () => {
      const stub = getTestStub()

      // Create a thing via RPC
      const response = await rpcCall(stub, 'things.create', [
        { $type: 'Customer', name: 'Alice', email: 'alice@test.com' },
      ])

      expect(response.status).toBe(200)
      const result = (await response.json()) as ThingEntity

      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
    })

    it('should handle nested RPC method paths', async () => {
      const stub = getTestStub()

      // Test things.list (nested path)
      const response = await rpcCall(stub, 'things.list', [{ type: 'Customer' }])

      expect(response.status).toBe(200)
      const result = (await response.json()) as ThingEntity[]
      expect(Array.isArray(result)).toBe(true)
    })

    it('should propagate correlation ID through RPC call', async () => {
      const stub = getTestStub()
      const correlationId = 'test-correlation-' + generateTestId()

      const response = await rpcCall(
        stub,
        'things.list',
        [{ type: 'Customer' }],
        { 'X-Correlation-ID': correlationId }
      )

      expect(response.status).toBe(200)
      // Correlation ID should be echoed back
      expect(response.headers.get('X-Correlation-ID')).toBe(correlationId)
    })

    it('should generate correlation ID if not provided', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'things.list', [{ type: 'Customer' }])

      expect(response.status).toBe(200)
      // Should have auto-generated correlation ID
      expect(response.headers.get('X-Correlation-ID')).toBeDefined()
    })

    it('should handle RPC call with complex arguments', async () => {
      const stub = getTestStub()

      // Create with nested data
      const response = await rpcCall(stub, 'things.create', [
        {
          $type: 'Order',
          items: [
            { sku: 'ITEM-001', quantity: 2 },
            { sku: 'ITEM-002', quantity: 1 },
          ],
          metadata: {
            source: 'web',
            campaign: 'summer-sale',
          },
        },
      ])

      expect(response.status).toBe(200)
      const result = (await response.json()) as ThingEntity

      expect(result.$id).toBeDefined()
      expect(result.items).toHaveLength(2)
      expect((result.metadata as Record<string, string>).source).toBe('web')
    })
  })

  describe('Batch RPC Calls', () => {
    it('should execute batch RPC calls in parallel', async () => {
      const stub = getTestStub()

      // Create multiple things in one batch request
      const response = await batchRpcCall(stub, [
        {
          id: 'create-1',
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice' }],
        },
        {
          id: 'create-2',
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Bob' }],
        },
        {
          id: 'list',
          method: 'things.list',
          args: [{ type: 'Customer' }],
        },
      ])

      expect(response.status).toBe(200)
      const result = (await response.json()) as BatchRPCResponse

      expect(result.results).toHaveLength(3)
      expect(result.results[0]?.id).toBe('create-1')
      expect(result.results[1]?.id).toBe('create-2')
      expect(result.results[2]?.id).toBe('list')
    })

    it('should handle partial failures in batch RPC', async () => {
      const stub = getTestStub()

      const response = await batchRpcCall(stub, [
        {
          id: 'valid',
          method: 'things.list',
          args: [{ type: 'Customer' }],
        },
        {
          id: 'invalid',
          method: 'nonexistent.method',
          args: [],
        },
      ])

      expect(response.status).toBe(200) // Batch itself succeeds
      const result = (await response.json()) as BatchRPCResponse

      // First call succeeds
      expect(result.results[0]?.result).toBeDefined()
      expect(result.results[0]?.error).toBeUndefined()

      // Second call fails with error
      expect(result.results[1]?.error).toBeDefined()
      expect(result.results[1]?.result).toBeUndefined()
    })

    it('should auto-generate call IDs for batch requests', async () => {
      const stub = getTestStub()

      // Calls without explicit IDs
      const response = await batchRpcCall(stub, [
        { method: 'things.list', args: [{ type: 'Customer' }] },
        { method: 'things.list', args: [{ type: 'Order' }] },
      ])

      expect(response.status).toBe(200)
      const result = (await response.json()) as BatchRPCResponse

      // IDs should be auto-generated
      expect(result.results[0]?.id).toBeDefined()
      expect(result.results[1]?.id).toBeDefined()
    })

    it('should propagate correlation ID through batch RPC', async () => {
      const stub = getTestStub()
      const correlationId = 'batch-correlation-' + generateTestId()

      const response = await batchRpcCall(
        stub,
        [{ id: 'test', method: 'things.list', args: [{ type: 'Customer' }] }],
        { 'X-Correlation-ID': correlationId }
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Correlation-ID')).toBe(correlationId)

      const result = (await response.json()) as BatchRPCResponse
      expect(result.correlationId).toBe(correlationId)
    })
  })

  describe('RPC State Consistency', () => {
    it('should maintain state consistency across sequential RPC calls', async () => {
      const stub = getTestStub()

      // Create a thing
      const createResp = await rpcCall(stub, 'things.create', [
        { $type: 'Customer', name: 'TestUser', email: 'test@example.com' },
      ])
      expect(createResp.status).toBe(200)
      const created = (await createResp.json()) as ThingEntity

      // Retrieve the thing
      const getResp = await rpcCall(stub, 'things.get', [created.$id])
      expect(getResp.status).toBe(200)
      const retrieved = (await getResp.json()) as ThingEntity

      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.name).toBe('TestUser')

      // Update the thing
      const updateResp = await rpcCall(stub, 'things.update', [
        created.$id,
        { name: 'UpdatedUser' },
      ])
      expect(updateResp.status).toBe(200)

      // Verify update persisted
      const verifyResp = await rpcCall(stub, 'things.get', [created.$id])
      expect(verifyResp.status).toBe(200)
      const verified = (await verifyResp.json()) as ThingEntity
      expect(verified.name).toBe('UpdatedUser')
    })
  })
})

// ============================================================================
// TEST SUITE 3: Error Propagation Through Layers
// ============================================================================

describe('E2E: Error Propagation', () => {
  describe('RPC Method Not Found Errors', () => {
    it('should propagate 404 error for unknown method', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'unknownMethod', [])

      expect(response.status).toBe(404)
      const error = (await response.json()) as RPCErrorResponse
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toContain('Method not found')
    })

    it('should propagate 404 error for unknown nested method', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'things.unknownAction', [])

      expect(response.status).toBe(404)
      const error = (await response.json()) as RPCErrorResponse
      expect(error.code).toBe('NOT_FOUND')
    })

    it('should propagate 404 error for deeply nested unknown path', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'a.b.c.d.unknownMethod', [])

      expect(response.status).toBe(404)
    })
  })

  describe('Validation Errors', () => {
    it('should propagate validation errors from entity operations', async () => {
      const stub = getTestStub()

      // Try to get a non-existent thing
      const response = await rpcCall(stub, 'things.get', ['non-existent-id'])

      // Should fail but not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('should propagate errors for missing required fields', async () => {
      const stub = getTestStub()

      // Create without $type (required field)
      const response = await rpcCall(stub, 'things.create', [
        { name: 'Missing Type' },
      ])

      // Should return validation error
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Internal Errors', () => {
    it('should wrap unknown errors as InternalError', async () => {
      const stub = getTestStub()

      // Invalid batch request (not an array)
      const response = await httpPost(stub, '/rpc/batch', {
        calls: 'not-an-array',
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      const error = (await response.json()) as RPCErrorResponse
      expect(error.correlationId).toBeDefined()
    })

    it('should include correlation ID in all error responses', async () => {
      const stub = getTestStub()
      const correlationId = 'error-test-' + generateTestId()

      const response = await rpcCall(
        stub,
        'nonexistent.method',
        [],
        { 'X-Correlation-ID': correlationId }
      )

      expect(response.status).toBe(404)
      const error = (await response.json()) as RPCErrorResponse
      expect(error.correlationId).toBe(correlationId)
    })
  })

  describe('Error Recovery', () => {
    it('should continue operating after error', async () => {
      const stub = getTestStub()

      // Cause an error
      const errorResp = await rpcCall(stub, 'nonexistent.method', [])
      expect(errorResp.status).toBe(404)

      // Should still work after error
      const healthResp = await httpGet(stub, '/')
      expect(healthResp.status).toBe(200)
    })

    it('should handle multiple errors without affecting subsequent requests', async () => {
      const stub = getTestStub()

      // Fire multiple error-causing requests
      const errorRequests = Array.from({ length: 3 }, () =>
        rpcCall(stub, 'bad.method', [])
      )
      await Promise.all(errorRequests)

      // Should still be able to create things
      const createResp = await rpcCall(stub, 'things.create', [
        { $type: 'Customer', name: 'AfterErrors' },
      ])
      expect(createResp.status).toBe(200)
    })
  })

  describe('Error Response Format', () => {
    it('should return consistent error response structure', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'nonexistent', [])

      expect(response.status).toBe(404)
      const error = (await response.json()) as RPCErrorResponse

      // Verify error structure
      expect(error).toHaveProperty('code')
      expect(error).toHaveProperty('message')
      expect(error).toHaveProperty('correlationId')
      expect(typeof error.code).toBe('string')
      expect(typeof error.message).toBe('string')
    })

    it('should return JSON content-type for error responses', async () => {
      const stub = getTestStub()

      const response = await rpcCall(stub, 'nonexistent', [])

      expect(response.headers.get('content-type')).toContain('application/json')
    })
  })
})

// ============================================================================
// TEST SUITE 4: End-to-End Integration Scenarios
// ============================================================================

describe('E2E: Integration Scenarios', () => {
  describe('Full CRUD Lifecycle', () => {
    it('should complete full CRUD lifecycle via RPC', async () => {
      const stub = getTestStub()

      // CREATE
      const createResp = await rpcCall(stub, 'things.create', [
        { $type: 'Product', name: 'Widget', price: 99.99 },
      ])
      expect(createResp.status).toBe(200)
      const created = (await createResp.json()) as ThingEntity
      const productId = created.$id

      // READ
      const readResp = await rpcCall(stub, 'things.get', [productId])
      expect(readResp.status).toBe(200)
      const read = (await readResp.json()) as ThingEntity
      expect(read.name).toBe('Widget')

      // UPDATE
      const updateResp = await rpcCall(stub, 'things.update', [
        productId,
        { price: 79.99 },
      ])
      expect(updateResp.status).toBe(200)
      const updated = (await updateResp.json()) as ThingEntity
      expect(updated.price).toBe(79.99)

      // DELETE
      const deleteResp = await rpcCall(stub, 'things.delete', [productId])
      expect(deleteResp.status).toBe(200)

      // VERIFY DELETED
      const verifyResp = await rpcCall(stub, 'things.get', [productId])
      // Should return error (not found) or null
      expect(verifyResp.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent creates safely', async () => {
      const stub = getTestStub()

      // Create 10 things concurrently
      const creates = Array.from({ length: 10 }, (_, i) =>
        rpcCall(stub, 'things.create', [
          { $type: 'Customer', name: `Customer-${i}`, index: i },
        ])
      )

      const responses = await Promise.all(creates)

      // All should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // All should have unique IDs
      const ids = await Promise.all(
        responses.map(async (r) => ((await r.json()) as ThingEntity).$id)
      )
      expect(new Set(ids).size).toBe(10)
    })

    it('should serialize concurrent updates to same entity', async () => {
      const stub = getTestStub()

      // Create a thing
      const createResp = await rpcCall(stub, 'things.create', [
        { $type: 'Counter', value: 0 },
      ])
      const created = (await createResp.json()) as ThingEntity

      // Concurrent updates (DO serializes these)
      const updates = Array.from({ length: 5 }, (_, i) =>
        rpcCall(stub, 'things.update', [created.$id, { value: i + 1 }])
      )

      const responses = await Promise.all(updates)

      // All updates should complete (last one wins due to serialization)
      expect(responses.every((r) => r.status === 200)).toBe(true)
    })
  })

  describe('Mixed Operation Types', () => {
    it('should handle mixed HTTP and RPC operations', async () => {
      const stub = getTestStub()

      // Mix of operations
      const [healthResp, infoResp, createResp, listResp] = await Promise.all([
        httpGet(stub, '/'),
        httpGet(stub, '/info'),
        rpcCall(stub, 'things.create', [{ $type: 'Test', data: 'value' }]),
        rpcCall(stub, 'things.list', [{ type: 'Test' }]),
      ])

      expect(healthResp.status).toBe(200)
      expect(infoResp.status).toBe(200)
      expect(createResp.status).toBe(200)
      expect(listResp.status).toBe(200)
    })
  })

  describe('Request Timeout Behavior', () => {
    it('should complete requests within reasonable time', async () => {
      const stub = getTestStub()
      const startTime = Date.now()

      // Simple operation should be fast
      await httpGet(stub, '/')

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(5000) // 5 second max
    })
  })
})
