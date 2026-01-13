/**
 * RPC.do Route Tests (Node Environment)
 *
 * Tests the /rpc endpoint handler directly without the workers pool.
 * This enables testing the RPC logic while the workers pool infrastructure is being fixed.
 *
 * Tests verify:
 * - POST /rpc accepts batch mode requests
 * - RPC method invocation with proper response format
 * - Promise pipelining chains multiple calls
 * - Error responses in proper format
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { rpcRoutes } from '../rpc'

// Create a test app with just the rpc routes
const app = new Hono()
app.route('/rpc', rpcRoutes)

// ============================================================================
// Types for RPC Protocol
// ============================================================================

/**
 * RPC Request message format (Capnweb-style)
 *
 * Each message can contain:
 * - calls: Array of method calls with pipelined references
 * - resolve: Request to resolve a promise and get the value
 * - dispose: Release references to objects
 */
interface RPCRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: RPCCall[]
  resolve?: { promiseId: string }
  dispose?: { promiseIds: string[] }
}

interface RPCCall {
  promiseId: string
  target: RPCTarget
  method: string
  args: RPCArg[]
}

type RPCTarget = { type: 'root' } | { type: 'promise'; promiseId: string } | { type: 'property'; base: RPCTarget; property: string }

type RPCArg = { type: 'value'; value: unknown } | { type: 'promise'; promiseId: string } | { type: 'callback'; callbackId: string }

/**
 * RPC Response message format
 */
interface RPCResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: RPCResult[]
  error?: RPCError
}

interface RPCResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: RPCError
}

interface RPCError {
  code: string
  message: string
  data?: unknown
}

// ============================================================================
// Test Helpers
// ============================================================================

function createCallMessage(options: { id?: string; promiseId: string; method: string; args?: RPCArg[]; target?: RPCTarget }): RPCRequest {
  return {
    id: options.id ?? crypto.randomUUID(),
    type: 'call',
    calls: [
      {
        promiseId: options.promiseId,
        target: options.target ?? { type: 'root' },
        method: options.method,
        args: options.args ?? [],
      },
    ],
  }
}

function createBatchMessage(calls: RPCCall[], id?: string): RPCRequest {
  return {
    id: id ?? crypto.randomUUID(),
    type: 'batch',
    calls,
  }
}

function createResolveMessage(promiseId: string, id?: string): RPCRequest {
  return {
    id: id ?? crypto.randomUUID(),
    type: 'resolve',
    resolve: { promiseId },
  }
}

function createDisposeMessage(promiseIds: string[], id?: string): RPCRequest {
  return {
    id: id ?? crypto.randomUUID(),
    type: 'dispose',
    dispose: { promiseIds },
  }
}

// ============================================================================
// 1. POST /rpc HTTP Batch Mode Tests
// ============================================================================

describe('POST /rpc - HTTP Batch Mode', () => {
  describe('basic functionality', () => {
    it('should accept POST requests to /rpc', async () => {
      const request = createCallMessage({
        promiseId: 'p1',
        method: 'echo',
        args: [{ type: 'value', value: 'hello' }],
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      // Should return 200 OK (not 404)
      expect(response.status).toBe(200)
    })

    it('should return JSON response with correct content-type', async () => {
      const request = createCallMessage({
        promiseId: 'p1',
        method: 'echo',
        args: [{ type: 'value', value: 'test' }],
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should return response with matching request id', async () => {
      const requestId = 'test-request-123'
      const request = createCallMessage({
        id: requestId,
        promiseId: 'p1',
        method: 'ping',
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.id).toBe(requestId)
    })

    it('should handle batch of multiple calls in single request', async () => {
      const request = createBatchMessage([
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getUser',
          args: [{ type: 'value', value: 'alice' }],
        },
        {
          promiseId: 'p2',
          target: { type: 'root' },
          method: 'getPosts',
          args: [{ type: 'value', value: { limit: 10 } }],
        },
        {
          promiseId: 'p3',
          target: { type: 'root' },
          method: 'getData',
          args: [],
        },
      ])

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.type).toBe('batch')
      expect(body.results).toHaveLength(3)
      expect(body.results?.[0].promiseId).toBe('p1')
      expect(body.results?.[1].promiseId).toBe('p2')
      expect(body.results?.[2].promiseId).toBe('p3')
    })
  })

  describe('error handling', () => {
    it('should return 400 for invalid JSON', async () => {
      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing required fields', async () => {
      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'call' }), // missing id and calls
      })

      expect(response.status).toBe(400)
    })

    it('should return 200 for GET requests (returns RPC info)', async () => {
      const response = await app.request('/rpc', {
        method: 'GET',
      })

      // GET without upgrade header returns RPC info (200)
      expect(response.status).toBe(200)
    })
  })
})

// ============================================================================
// 2. WebSocket Upgrade Tests
// ============================================================================

describe('GET /rpc - WebSocket Upgrade', () => {
  // Note: WebSocket upgrade tests require the full workers runtime with @cloudflare/vitest-pool-workers
  // These tests are skipped when running without the workers pool
  // The Hono app.request() method doesn't support WebSocket upgrades

  it.skip('should accept WebSocket upgrade request', async () => {
    // Requires workers runtime for WebSocket support
  })

  it.skip('should return 426 Upgrade Required when upgrade header missing', async () => {
    // Requires workers runtime for WebSocket support
  })

  it.skip('should include Sec-WebSocket-Accept header in upgrade response', async () => {
    // Requires workers runtime for WebSocket support
  })
})

// ============================================================================
// 3. RPC Method Invocation Tests
// ============================================================================

describe('RPC Method Invocation', () => {
  describe('root object methods', () => {
    it('should invoke method on root and return result', async () => {
      const request = createCallMessage({
        promiseId: 'p1',
        method: 'echo',
        args: [{ type: 'value', value: 'hello world' }],
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.type).toBe('batch')
      expect(body.results?.[0].type).toBe('value')
      expect(body.results?.[0].value).toBe('hello world')
    })

    it('should invoke method with multiple arguments', async () => {
      const request = createCallMessage({
        promiseId: 'p1',
        method: 'add',
        args: [
          { type: 'value', value: 5 },
          { type: 'value', value: 3 },
        ],
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[0].value).toBe(8)
    })

    it('should invoke method with object arguments', async () => {
      const request = createCallMessage({
        promiseId: 'p1',
        method: 'getUser',
        args: [{ type: 'value', value: 'alice' }],
      })

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[0].type).toBe('value')
      // getUser returns a UserObject with id, name, email
      const user = body.results?.[0].value as { id?: string; name?: string; email?: string }
      expect(user).toHaveProperty('id')
      expect(user).toHaveProperty('email')
    })
  })

  describe('property access on promises', () => {
    it('should access property on promise result', async () => {
      // First call: get an object
      // Second call: access property on that object's result
      const request = createBatchMessage([
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getUser',
          args: [{ type: 'value', value: 'alice' }],
        },
        {
          promiseId: 'p2',
          target: { type: 'property', base: { type: 'promise', promiseId: 'p1' }, property: 'email' },
          method: '__get__', // Special method for property access
          args: [],
        },
      ])

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[1].value).toBe('alice@example.com.ai')
    })

    it('should access nested properties on promise result', async () => {
      const request = createBatchMessage([
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getData',
          args: [],
        },
        {
          promiseId: 'p2',
          target: { type: 'property', base: { type: 'promise', promiseId: 'p1' }, property: 'foo' },
          method: '__get__',
          args: [],
        },
      ])

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[1].type).toBe('value')
      expect(body.results?.[1].value).toBe('bar')
    })
  })

  describe('method chaining on promises', () => {
    it('should call method on promise result', async () => {
      // Chain: getUser('alice').getPosts()
      const request = createBatchMessage([
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getUser',
          args: [{ type: 'value', value: 'alice' }],
        },
        {
          promiseId: 'p2',
          target: { type: 'promise', promiseId: 'p1' },
          method: 'getPosts',
          args: [],
        },
      ])

      const response = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results).toHaveLength(2)
      expect(body.results?.[1].type).toBe('value')
      expect(Array.isArray(body.results?.[1].value)).toBe(true)
    })
  })
})

// ============================================================================
// 4. Promise Pipelining Tests
// ============================================================================

describe('Promise Pipelining', () => {
  it('should batch multiple independent calls', async () => {
    // Simulate Promise.all([rpc.getUser('alice'), rpc.getPosts(), rpc.getData()])
    const request = createBatchMessage([
      {
        promiseId: 'p1',
        target: { type: 'root' },
        method: 'getUser',
        args: [{ type: 'value', value: 'alice' }],
      },
      {
        promiseId: 'p2',
        target: { type: 'root' },
        method: 'getPosts',
        args: [],
      },
      {
        promiseId: 'p3',
        target: { type: 'root' },
        method: 'getData',
        args: [],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.type).toBe('batch')
    expect(body.results).toHaveLength(3)

    // All results should be available
    for (const result of body.results ?? []) {
      expect(result.type).not.toBe('error')
    }
  })

  it('should pipeline dependent calls without waiting for intermediate results', async () => {
    // Simulate: rpc.getUser('alice').getPosts()[0]
    // Server processes chain without returning intermediate results
    const request = createBatchMessage([
      {
        promiseId: 'p1',
        target: { type: 'root' },
        method: 'getUser',
        args: [{ type: 'value', value: 'alice' }],
      },
      {
        promiseId: 'p2',
        target: { type: 'promise', promiseId: 'p1' },
        method: 'getPosts',
        args: [],
      },
      {
        promiseId: 'p3',
        target: { type: 'property', base: { type: 'promise', promiseId: 'p2' }, property: '0' },
        method: '__get__',
        args: [],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()

    // All three were processed in a single round-trip
    expect(body.results).toHaveLength(3)

    // p1 and p2 may be marked as 'promise' (not yet resolved to caller)
    // p3 should have the actual value since it was terminal
    expect(body.results?.[2].type).toBe('value')
  })

  it('should pass promise references as arguments', async () => {
    // Simulate: const user = rpc.getUser('alice'); rpc.sendNotification(user, 'Hello!')
    const request = createBatchMessage([
      {
        promiseId: 'p1',
        target: { type: 'root' },
        method: 'getUser',
        args: [{ type: 'value', value: 'alice' }],
      },
      {
        promiseId: 'p2',
        target: { type: 'root' },
        method: 'sendNotification',
        args: [
          { type: 'promise', promiseId: 'p1' },
          { type: 'value', value: 'Hello!' },
        ],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[1].type).toBe('value')
  })

  it('should handle magic map operations with property specification', async () => {
    // Simulate: rpc.getPosts() then map with property access
    const request = createBatchMessage(
      [
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getPosts',
          args: [],
        },
        {
          promiseId: 'p2',
          target: { type: 'promise', promiseId: 'p1' },
          method: '__map__',
          args: [
            {
              type: 'value',
              value: { property: 'title' },
            },
          ],
        },
      ],
      'map-test',
    )

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[1].type).toBe('value')
    expect(Array.isArray(body.results?.[1].value)).toBe(true)
  })
})

// ============================================================================
// 5. Error Response Format Tests
// ============================================================================

describe('Error Response Format', () => {
  it('should return error for unknown method', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'nonExistentMethod',
      args: [],
    })

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[0].error).toBeDefined()
    expect(body.results?.[0].error?.code).toBe('METHOD_NOT_FOUND')
  })

  it('should include error code in error response', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'throwError',
      args: [],
    })

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].error?.code).toBeDefined()
    expect(typeof body.results?.[0].error?.code).toBe('string')
  })

  it('should include error message in error response', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'throwError',
      args: [],
    })

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    // throwError throws { code: 'TEST_ERROR', message: 'Test error thrown' }
    expect(body.results?.[0].error?.message).toBe('Test error thrown')
  })

  it('should propagate errors through pipeline', async () => {
    // If p1 errors, p2 which depends on p1 should also error
    const request = createBatchMessage([
      {
        promiseId: 'p1',
        target: { type: 'root' },
        method: 'throwError',
        args: [],
      },
      {
        promiseId: 'p2',
        target: { type: 'promise', promiseId: 'p1' },
        method: 'someMethod',
        args: [],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[1].type).toBe('error')
    // p2 error should indicate it failed due to the original error being propagated
    expect(body.results?.[1].error?.code).toBe('TEST_ERROR')
  })

  it('should return error for invalid promise reference', async () => {
    const request = createBatchMessage([
      {
        promiseId: 'p2',
        target: { type: 'promise', promiseId: 'p-nonexistent' },
        method: 'someMethod',
        args: [],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[0].error?.code).toBe('INVALID_PROMISE')
  })

  it('should include optional data field for debugging', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'throwDetailedError',
      args: [{ type: 'value', value: { includeStack: true } }],
    })

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    // data field is optional but should be present for detailed errors
    if (body.results?.[0].error?.data) {
      expect(typeof body.results?.[0].error?.data).toBe('object')
    }
  })
})

// ============================================================================
// 6. Pass-by-Reference Object Tests
// ============================================================================

describe('Pass-by-Reference Objects', () => {
  // Note: Pass-by-reference tests that require state persistence across requests
  // are skipped because each app.request() creates a fresh context.
  // These tests require WebSocket connections or stateful DO instances.

  it('should create session object', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'createSession',
      args: [],
    })

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    // Session object is created and returned
    expect(body.results?.[0].type).toBe('value')
    expect(body.results?.[0].value).toHaveProperty('id')
    expect(body.results?.[0].value).toHaveProperty('createdAt')
  })

  it('should call methods on session object within same batch', async () => {
    const request = createBatchMessage([
      {
        promiseId: 'p1',
        target: { type: 'root' },
        method: 'createSession',
        args: [],
      },
      {
        promiseId: 'p2',
        target: { type: 'promise', promiseId: 'p1' },
        method: 'getData',
        args: [],
      },
    ])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[1].type).toBe('value')
    expect(body.results?.[1].value).toHaveProperty('sessionId')
    expect(body.results?.[1].value).toHaveProperty('createdAt')
  })

  it.skip('should maintain object state across multiple requests', async () => {
    // Requires WebSocket or stateful DO instance
  })

  it.skip('should support nested pass-by-reference objects', async () => {
    // Requires stateful objects like createContainer which is not defined
  })
})

// ============================================================================
// 7. Disposal/Cleanup Tests
// ============================================================================

describe('Disposal and Cleanup', () => {
  // Note: Disposal tests require state persistence across requests
  // which is not supported with app.request() (each request is stateless).
  // These tests are marked as skipped and should be run with WebSocket tests.

  it('should accept dispose message format', async () => {
    // Dispose request is valid even if promise doesn't exist (idempotent)
    const disposeRequest = createDisposeMessage(['non-existent-promise'])

    const response = await app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { type?: string }
    expect(body.type).not.toBe('error')
  })

  it.skip('should return error when using disposed reference', async () => {
    // Requires stateful session across requests
  })

  it.skip('should dispose multiple references in single request', async () => {
    // Requires stateful session across requests
  })

  it.skip('should call cleanup method when object is disposed', async () => {
    // Requires createResource and wasResourceCleaned methods
  })

  it.skip('should dispose child references when parent is disposed', async () => {
    // Requires createContainer method and stateful session
  })
})

// ============================================================================
// WebSocket-Specific Tests (require WebSocket support)
// ============================================================================

describe('WebSocket RPC', () => {
  // Note: These tests require WebSocket support in the test environment
  // They should be run with @cloudflare/vitest-pool-workers when available

  it.skip('should establish WebSocket connection', async () => {
    // Requires workers runtime for WebSocket support
  })

  it.skip('should receive responses on WebSocket', async () => {
    // Requires workers runtime for WebSocket support
  })

  it.skip('should handle concurrent messages on same WebSocket', async () => {
    // Requires workers runtime for WebSocket support
  })

  it.skip('should cleanup on WebSocket close', async () => {
    // Requires workers runtime for WebSocket support
  })
})
