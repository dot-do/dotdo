/**
 * RPC.do WebSocket Route Tests
 *
 * Tests for the /rpc endpoint supporting both HTTP batch mode and WebSocket
 * promise pipelining. Uses Capnweb-style RPC patterns.
 *
 * These tests will FAIL until the RPC routes are implemented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env, SELF } from 'cloudflare:test'

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

      const response = await SELF.fetch('http://localhost/rpc', {
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

      const response = await SELF.fetch('http://localhost/rpc', {
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

      const response = await SELF.fetch('http://localhost/rpc', {
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
          method: 'getSettings',
          args: [],
        },
      ])

      const response = await SELF.fetch('http://localhost/rpc', {
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
      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing required fields', async () => {
      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'call' }), // missing id and calls
      })

      expect(response.status).toBe(400)
    })

    it('should return 405 for non-POST methods', async () => {
      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'GET',
      })

      // GET without upgrade header should return 405 or redirect to WebSocket info
      expect([405, 426]).toContain(response.status)
    })
  })
})

// ============================================================================
// 2. WebSocket Upgrade Tests
// ============================================================================

describe('GET /rpc - WebSocket Upgrade', () => {
  it('should accept WebSocket upgrade request', async () => {
    // Note: In Vitest with Workers, we use a special approach for WebSocket testing
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': btoa(crypto.randomUUID()),
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.status).toBe(101)
    expect(response.headers.get('Upgrade')).toBe('websocket')
  })

  it('should return 426 Upgrade Required when upgrade header missing', async () => {
    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'GET',
    })

    // Should indicate WebSocket upgrade is required
    expect([426, 405]).toContain(response.status)
  })

  it('should include Sec-WebSocket-Accept header in upgrade response', async () => {
    const key = btoa(crypto.randomUUID())
    const response = await SELF.fetch('http://localhost/rpc', {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(response.headers.get('Sec-WebSocket-Accept')).toBeDefined()
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

      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.type).toBe('result')
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

      const response = await SELF.fetch('http://localhost/rpc', {
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
        method: 'createUser',
        args: [{ type: 'value', value: { name: 'Alice', email: 'alice@example.com.ai' } }],
      })

      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[0].type).toBe('value')
      expect(body.results?.[0].value).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com.ai',
      })
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

      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[1].value).toBe('alice@example.com.ai')
    })

    it('should chain multiple property accesses', async () => {
      const request = createBatchMessage([
        {
          promiseId: 'p1',
          target: { type: 'root' },
          method: 'getConfig',
          args: [],
        },
        {
          promiseId: 'p2',
          target: {
            type: 'property',
            base: {
              type: 'property',
              base: { type: 'promise', promiseId: 'p1' },
              property: 'settings',
            },
            property: 'theme',
          },
          method: '__get__',
          args: [],
        },
      ])

      const response = await SELF.fetch('http://localhost/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: RPCResponse = await response.json()
      expect(body.results?.[1].type).toBe('value')
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

      const response = await SELF.fetch('http://localhost/rpc', {
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
    // Simulate Promise.all([rpc.getUser('alice'), rpc.getPosts(), rpc.getSettings()])
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
        method: 'getSettings',
        args: [],
      },
    ])

    const response = await SELF.fetch('http://localhost/rpc', {
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

    const response = await SELF.fetch('http://localhost/rpc', {
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

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[1].type).toBe('value')
  })

  it('should handle map operations (magic map)', async () => {
    // Simulate: rpc.getPosts().map(post => post.title)
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
              type: 'callback',
              callbackId: 'cb1',
              // Callback instruction: for each item, access .title
            },
          ],
        },
      ],
      'map-test',
    )

    const response = await SELF.fetch('http://localhost/rpc', {
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

    const response = await SELF.fetch('http://localhost/rpc', {
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

    const response = await SELF.fetch('http://localhost/rpc', {
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
      args: [{ type: 'value', value: 'Custom error message' }],
    })

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].error?.message).toBe('Custom error message')
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

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[1].type).toBe('error')
    // p2 error should indicate it failed due to dependency
    expect(body.results?.[1].error?.code).toMatch(/DEPENDENCY_FAILED|PIPELINE_ERROR/)
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

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[0].error?.code).toBe('INVALID_PROMISE_REF')
  })

  it('should include optional data field for debugging', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'throwDetailedError',
      args: [],
    })

    const response = await SELF.fetch('http://localhost/rpc', {
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
  it('should return promise reference for objects that need to stay on server', async () => {
    const request = createCallMessage({
      promiseId: 'p1',
      method: 'createSession',
      args: [],
    })

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    // Session object should be returned as a promise reference, not serialized
    expect(body.results?.[0].type).toBe('promise')
    expect(body.results?.[0].value).toHaveProperty('promiseId')
  })

  it('should allow calling methods on pass-by-reference objects', async () => {
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
        method: 'setData',
        args: [{ type: 'value', value: { key: 'value' } }],
      },
      {
        promiseId: 'p3',
        target: { type: 'promise', promiseId: 'p1' },
        method: 'getData',
        args: [],
      },
    ])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[2].value).toEqual({ key: 'value' })
  })

  it('should maintain object state across multiple calls', async () => {
    // First batch: create session and set counter
    const batch1 = createBatchMessage(
      [
        {
          promiseId: 'session',
          target: { type: 'root' },
          method: 'createCounter',
          args: [],
        },
        {
          promiseId: 'inc1',
          target: { type: 'promise', promiseId: 'session' },
          method: 'increment',
          args: [],
        },
      ],
      'batch1',
    )

    const response1 = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch1),
    })

    const body1: RPCResponse = await response1.json()
    expect(body1.results?.[1].value).toBe(1)

    // Second batch: use same session reference to continue incrementing
    const batch2 = createBatchMessage(
      [
        {
          promiseId: 'inc2',
          target: { type: 'promise', promiseId: 'session' },
          method: 'increment',
          args: [],
        },
        {
          promiseId: 'val',
          target: { type: 'promise', promiseId: 'session' },
          method: 'getValue',
          args: [],
        },
      ],
      'batch2',
    )

    const response2 = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch2),
    })

    const body2: RPCResponse = await response2.json()
    expect(body2.results?.[1].value).toBe(2)
  })

  it('should support nested pass-by-reference objects', async () => {
    // Create a container that contains pass-by-ref child objects
    const request = createBatchMessage([
      {
        promiseId: 'container',
        target: { type: 'root' },
        method: 'createContainer',
        args: [],
      },
      {
        promiseId: 'child',
        target: { type: 'promise', promiseId: 'container' },
        method: 'createChild',
        args: [{ type: 'value', value: 'child-1' }],
      },
      {
        promiseId: 'childMethod',
        target: { type: 'promise', promiseId: 'child' },
        method: 'getName',
        args: [],
      },
    ])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[1].type).toBe('promise') // child is pass-by-ref
    expect(body.results?.[2].value).toBe('child-1')
  })
})

// ============================================================================
// 7. Disposal/Cleanup Tests
// ============================================================================

describe('Disposal and Cleanup', () => {
  it('should accept dispose message for promise references', async () => {
    // First create a reference
    const createRequest = createCallMessage({
      promiseId: 'p1',
      method: 'createSession',
    })

    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    })

    // Then dispose it
    const disposeRequest = createDisposeMessage(['p1'])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { type?: string }
    expect(body.type).not.toBe('error')
  })

  it('should return error when using disposed reference', async () => {
    // Create, dispose, then try to use
    const createRequest = createCallMessage({
      promiseId: 'session',
      method: 'createSession',
    })

    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    })

    const disposeRequest = createDisposeMessage(['session'])
    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    // Try to use disposed reference
    const useRequest = createBatchMessage([
      {
        promiseId: 'result',
        target: { type: 'promise', promiseId: 'session' },
        method: 'getData',
        args: [],
      },
    ])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(useRequest),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[0].error?.code).toBe('DISPOSED_REFERENCE')
  })

  it('should dispose multiple references in single request', async () => {
    // Create multiple references
    const createRequest = createBatchMessage([
      { promiseId: 'p1', target: { type: 'root' }, method: 'createSession', args: [] },
      { promiseId: 'p2', target: { type: 'root' }, method: 'createSession', args: [] },
      { promiseId: 'p3', target: { type: 'root' }, method: 'createSession', args: [] },
    ])

    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    })

    // Dispose all at once
    const disposeRequest = createDisposeMessage(['p1', 'p2', 'p3'])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    expect(response.status).toBe(200)
  })

  it('should handle dispose of non-existent reference gracefully', async () => {
    const disposeRequest = createDisposeMessage(['non-existent-promise'])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    // Should succeed (idempotent) or return specific error
    expect([200, 404]).toContain(response.status)
  })

  it('should call cleanup method when object is disposed', async () => {
    // Create object with cleanup callback
    const createRequest = createCallMessage({
      promiseId: 'resource',
      method: 'createResource',
      args: [{ type: 'value', value: 'test-resource' }],
    })

    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    })

    // Dispose the resource
    const disposeRequest = createDisposeMessage(['resource'])
    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    // Verify cleanup was called by checking cleanup log
    const verifyRequest = createCallMessage({
      promiseId: 'check',
      method: 'wasResourceCleaned',
      args: [{ type: 'value', value: 'test-resource' }],
    })

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyRequest),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].value).toBe(true)
  })

  it('should dispose child references when parent is disposed', async () => {
    // Create parent with children
    const createRequest = createBatchMessage([
      {
        promiseId: 'parent',
        target: { type: 'root' },
        method: 'createContainer',
        args: [],
      },
      {
        promiseId: 'child1',
        target: { type: 'promise', promiseId: 'parent' },
        method: 'createChild',
        args: [{ type: 'value', value: 'c1' }],
      },
      {
        promiseId: 'child2',
        target: { type: 'promise', promiseId: 'parent' },
        method: 'createChild',
        args: [{ type: 'value', value: 'c2' }],
      },
    ])

    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    })

    // Dispose parent
    const disposeRequest = createDisposeMessage(['parent'])
    await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disposeRequest),
    })

    // Try to use child - should be disposed
    const useChildRequest = createBatchMessage([
      {
        promiseId: 'result',
        target: { type: 'promise', promiseId: 'child1' },
        method: 'getName',
        args: [],
      },
    ])

    const response = await SELF.fetch('http://localhost/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(useChildRequest),
    })

    const body: RPCResponse = await response.json()
    expect(body.results?.[0].type).toBe('error')
    expect(body.results?.[0].error?.code).toBe('DISPOSED_REFERENCE')
  })
})

// ============================================================================
// WebSocket-Specific Tests (require WebSocket support)
// ============================================================================

describe('WebSocket RPC', () => {
  // Note: These tests require WebSocket support in the test environment
  // They may need to be run with a real server or with WebSocket mocks

  it.skip('should establish WebSocket connection', async () => {
    // This test requires WebSocket client support
    // const ws = new WebSocket('ws://localhost/rpc')
    // await new Promise((resolve, reject) => {
    //   ws.onopen = resolve
    //   ws.onerror = reject
    // })
    // expect(ws.readyState).toBe(WebSocket.OPEN)
    // ws.close()
  })

  it.skip('should receive responses on WebSocket', async () => {
    // WebSocket message exchange test
  })

  it.skip('should handle concurrent messages on same WebSocket', async () => {
    // Multiplexing test
  })

  it.skip('should cleanup on WebSocket close', async () => {
    // All pass-by-ref objects should be disposed when WS closes
  })
})
