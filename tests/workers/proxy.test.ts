import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Minimal Proxy Worker Tests (RED Phase)
 *
 * These tests verify the proxy worker that routes requests to Durable Objects.
 * The worker should be minimal - just routing and DO lookup. All business logic lives in the DO.
 *
 * Routes:
 * - /{ns}                    -> DO(ns).fetch('/')
 * - /{ns}/{path}             -> DO(ns).fetch('/{path}')
 * - /{ns}/rpc                -> DO(ns).fetch('/rpc')
 * - /{ns}/mcp                -> DO(ns).fetch('/mcp')
 * - /{ns}/sync               -> DO(ns).fetch('/sync') [WebSocket]
 * - /{ns}/{collection}/      -> DO(ns).fetch('/{collection}/')
 * - /{ns}/{collection}/{id}  -> DO(ns).fetch('/{collection}/{id}')
 *
 * Implementation requirements:
 * - Create workers/proxy.ts with default export handler
 * - Parse URL to extract namespace (ns) from first path segment
 * - Get DO stub using env.DO.get(env.DO.idFromName(ns))
 * - Forward request with remaining path to DO
 * - Return DO response unchanged
 * - Handle WebSocket upgrades for /sync endpoint
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

// This import should fail until the implementation exists
import proxyWorker from '../../workers/proxy'

// ============================================================================
// Mock Types
// ============================================================================

interface MockDOStub {
  fetch: ReturnType<typeof vi.fn>
}

interface MockDONamespace {
  idFromName: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

interface MockEnv {
  DO: MockDONamespace
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Durable Object stub
 */
function createMockDOStub(responseOverrides: Partial<Response> = {}): MockDOStub {
  const defaultResponse = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...responseOverrides,
  })

  return {
    fetch: vi.fn().mockResolvedValue(defaultResponse),
  }
}

/**
 * Create a mock environment with DO namespace binding
 */
function createMockEnv(stub?: MockDOStub): MockEnv {
  const mockStub = stub || createMockDOStub()
  const mockId = { toString: () => 'mock-do-id' }

  return {
    DO: {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    },
  }
}

/**
 * Create a mock execution context
 */
function createMockContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext
}

/**
 * Create a request for testing
 */
function createRequest(
  path: string,
  options: RequestInit = {}
): Request {
  return new Request(`https://api.dotdo.dev${path}`, options)
}

// ============================================================================
// Routing Tests
// ============================================================================

describe('ProxyWorker - Routing', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  describe('namespace extraction', () => {
    it('extracts namespace from first path segment', async () => {
      const request = createRequest('/my-namespace/users')

      await proxyWorker.fetch(request, env, ctx)

      expect(env.DO.idFromName).toHaveBeenCalledWith('my-namespace')
    })

    it('handles namespace with hyphens', async () => {
      const request = createRequest('/my-cool-namespace/data')

      await proxyWorker.fetch(request, env, ctx)

      expect(env.DO.idFromName).toHaveBeenCalledWith('my-cool-namespace')
    })

    it('handles namespace with underscores', async () => {
      const request = createRequest('/my_namespace/data')

      await proxyWorker.fetch(request, env, ctx)

      expect(env.DO.idFromName).toHaveBeenCalledWith('my_namespace')
    })

    it('handles namespace with numbers', async () => {
      const request = createRequest('/tenant123/api')

      await proxyWorker.fetch(request, env, ctx)

      expect(env.DO.idFromName).toHaveBeenCalledWith('tenant123')
    })

    it('handles case-sensitive namespaces', async () => {
      const request = createRequest('/MyNamespace/data')

      await proxyWorker.fetch(request, env, ctx)

      expect(env.DO.idFromName).toHaveBeenCalledWith('MyNamespace')
    })
  })

  describe('path forwarding', () => {
    it('forwards remaining path to DO', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/users/123')

      await proxyWorker.fetch(request, env, ctx)

      expect(stub.fetch).toHaveBeenCalled()
      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/users/123')
    })

    it('handles root namespace requests (/{ns}/)', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/')
    })

    it('handles namespace without trailing slash (/{ns})', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/')
    })

    it('handles nested paths (/{ns}/{collection}/{id})', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/users/abc-123/profile')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/users/abc-123/profile')
    })

    it('handles deeply nested paths', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/a/b/c/d/e/f')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/a/b/c/d/e/f')
    })

    it('preserves query parameters', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/search?q=test&limit=10')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/search')
      expect(forwardedUrl.searchParams.get('q')).toBe('test')
      expect(forwardedUrl.searchParams.get('limit')).toBe('10')
    })
  })

  describe('special endpoints', () => {
    it('forwards /rpc to DO /rpc', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'getData' }),
      })

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/rpc')
    })

    it('forwards /mcp to DO /mcp', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
      })

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/mcp')
    })

    it('forwards /sync to DO /sync', async () => {
      const stub = createMockDOStub()
      env = createMockEnv(stub)
      const request = createRequest('/ns/sync')

      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls[0]
      const forwardedUrl = new URL(forwardedRequest.url)
      expect(forwardedUrl.pathname).toBe('/sync')
    })
  })
})

// ============================================================================
// DO Forwarding Tests
// ============================================================================

describe('ProxyWorker - DO Forwarding', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('gets DO stub from env binding', async () => {
    const request = createRequest('/ns/data')

    await proxyWorker.fetch(request, env, ctx)

    expect(env.DO.idFromName).toHaveBeenCalled()
    expect(env.DO.get).toHaveBeenCalled()
  })

  it('forwards request method to DO', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)

    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const request = createRequest('/ns/data', { method })
      await proxyWorker.fetch(request, env, ctx)

      const [forwardedRequest] = stub.fetch.mock.calls.at(-1)!
      expect(forwardedRequest.method).toBe(method)
    }
  })

  it('forwards request headers to DO', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/data', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'custom-value',
      },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    expect(forwardedRequest.headers.get('Content-Type')).toBe('application/json')
    expect(forwardedRequest.headers.get('Authorization')).toBe('Bearer token123')
    expect(forwardedRequest.headers.get('X-Custom-Header')).toBe('custom-value')
  })

  it('forwards request body to DO', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const body = JSON.stringify({ name: 'Test', value: 42 })
    const request = createRequest('/ns/data', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedBody = await forwardedRequest.text()
    expect(forwardedBody).toBe(body)
  })

  it('returns DO response unchanged', async () => {
    const doResponse = new Response(JSON.stringify({ id: 123, name: 'Test' }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-DO-Header': 'do-value',
      },
    })
    const stub = { fetch: vi.fn().mockResolvedValue(doResponse) }
    env = createMockEnv(stub as unknown as MockDOStub)
    const request = createRequest('/ns/data', { method: 'POST' })

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(201)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('X-DO-Header')).toBe('do-value')
    const responseBody = await response.json()
    expect(responseBody).toEqual({ id: 123, name: 'Test' })
  })

  it('preserves response status codes from DO', async () => {
    const statusCodes = [200, 201, 204, 301, 400, 401, 403, 404, 500, 503]

    for (const status of statusCodes) {
      const stub = { fetch: vi.fn().mockResolvedValue(new Response(null, { status })) }
      env = createMockEnv(stub as unknown as MockDOStub)
      const request = createRequest('/ns/data')

      const response = await proxyWorker.fetch(request, env, ctx)

      expect(response.status).toBe(status)
    }
  })
})

// ============================================================================
// Protocol Tests
// ============================================================================

describe('ProxyWorker - Protocols', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('handles HTTP requests', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/api/users')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response).toBeInstanceOf(Response)
    expect(stub.fetch).toHaveBeenCalled()
  })

  it('handles WebSocket upgrade for /sync', async () => {
    // Note: We can't create a real Response with status 101 in Node.js
    // (Response constructor only accepts 200-599). Instead, we mock the
    // Response object to verify the proxy forwards it unchanged.
    const wsResponse = {
      status: 101,
      headers: new Headers(),
      webSocket: {} as WebSocket,
    } as unknown as Response
    const stub = { fetch: vi.fn().mockResolvedValue(wsResponse) }
    env = createMockEnv(stub as unknown as MockDOStub)

    const request = new Request('https://api.dotdo.dev/ns/sync', {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    })

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(101)
    const [forwardedRequest] = stub.fetch.mock.calls[0]
    expect(forwardedRequest.headers.get('Upgrade')).toBe('websocket')
  })

  it('forwards WebSocket upgrade headers', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)

    const request = new Request('https://api.dotdo.dev/ns/sync', {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': 'test-key',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Protocol': 'dotdo-sync',
      },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    expect(forwardedRequest.headers.get('Upgrade')).toBe('websocket')
    expect(forwardedRequest.headers.get('Connection')).toBe('Upgrade')
    expect(forwardedRequest.headers.get('Sec-WebSocket-Key')).toBe('test-key')
    expect(forwardedRequest.headers.get('Sec-WebSocket-Protocol')).toBe('dotdo-sync')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('ProxyWorker - Error Handling', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('returns 404 for missing namespace (root path)', async () => {
    const request = createRequest('/')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(404)
    expect(env.DO.idFromName).not.toHaveBeenCalled()
  })

  it('returns 404 for empty namespace', async () => {
    const request = createRequest('//data')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(404)
  })

  it('returns 500 if DO binding not found', async () => {
    const envWithoutDO = {} as unknown as MockEnv
    const request = createRequest('/ns/data')

    const response = await proxyWorker.fetch(request, envWithoutDO, ctx)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('returns 503 if DO unavailable', async () => {
    const stub = { fetch: vi.fn().mockRejectedValue(new Error('DO unavailable')) }
    env = createMockEnv(stub as unknown as MockDOStub)
    const request = createRequest('/ns/data')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(503)
  })

  it('returns 503 with error message when DO throws', async () => {
    const stub = { fetch: vi.fn().mockRejectedValue(new Error('Connection refused')) }
    env = createMockEnv(stub as unknown as MockDOStub)
    const request = createRequest('/ns/data')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('handles DO timeout gracefully', async () => {
    const stub = {
      fetch: vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      ),
    }
    env = createMockEnv(stub as unknown as MockDOStub)
    const request = createRequest('/ns/data')

    const response = await proxyWorker.fetch(request, env, ctx)

    expect(response.status).toBe(503)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('ProxyWorker - Edge Cases', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('handles paths with special characters', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/path%20with%20spaces')

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedUrl = new URL(forwardedRequest.url)
    expect(forwardedUrl.pathname).toContain('path')
  })

  it('handles very long paths', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const longPath = '/a'.repeat(100)
    const request = createRequest(`/ns${longPath}`)

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedUrl = new URL(forwardedRequest.url)
    expect(forwardedUrl.pathname).toBe(longPath)
  })

  it('handles paths with dots', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/file.json')

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedUrl = new URL(forwardedRequest.url)
    expect(forwardedUrl.pathname).toBe('/file.json')
  })

  it('handles paths with multiple consecutive slashes', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns//path///to////resource')

    await proxyWorker.fetch(request, env, ctx)

    // Should normalize or preserve slashes as appropriate
    expect(stub.fetch).toHaveBeenCalled()
  })

  it('handles empty body for POST requests', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/data', { method: 'POST' })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    expect(forwardedRequest.method).toBe('POST')
  })

  it('handles large request bodies', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const largeBody = JSON.stringify({ data: 'x'.repeat(100000) })
    const request = createRequest('/ns/data', {
      method: 'POST',
      body: largeBody,
      headers: { 'Content-Type': 'application/json' },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedBody = await forwardedRequest.text()
    expect(forwardedBody).toBe(largeBody)
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('ProxyWorker - Security', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('does not add any auth headers (auth handled by DO)', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/data')

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    // Proxy should not add any auth headers - that's the DO's job
    expect(forwardedRequest.headers.get('X-Proxy-Auth')).toBeNull()
  })

  it('does not transform request body (no business logic)', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const originalBody = JSON.stringify({ secret: 'value', data: [1, 2, 3] })
    const request = createRequest('/ns/data', {
      method: 'POST',
      body: originalBody,
      headers: { 'Content-Type': 'application/json' },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    const forwardedBody = await forwardedRequest.text()
    // Body should be identical - no transformation
    expect(forwardedBody).toBe(originalBody)
  })

  it('does not transform response body (no business logic)', async () => {
    const originalResponse = JSON.stringify({ data: 'sensitive', _links: {} })
    const stub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(originalResponse, {
          headers: { 'Content-Type': 'application/json' },
        })
      ),
    }
    env = createMockEnv(stub as unknown as MockDOStub)
    const request = createRequest('/ns/data')

    const response = await proxyWorker.fetch(request, env, ctx)

    const responseBody = await response.text()
    // Response should be identical - no transformation
    expect(responseBody).toBe(originalResponse)
  })

  it('passes through all client headers to DO', async () => {
    const stub = createMockDOStub()
    env = createMockEnv(stub)
    const request = createRequest('/ns/data', {
      headers: {
        'Authorization': 'Bearer user-token',
        'Cookie': 'session=abc123',
        'X-Forwarded-For': '192.168.1.1',
        'X-Real-IP': '10.0.0.1',
      },
    })

    await proxyWorker.fetch(request, env, ctx)

    const [forwardedRequest] = stub.fetch.mock.calls[0]
    expect(forwardedRequest.headers.get('Authorization')).toBe('Bearer user-token')
    expect(forwardedRequest.headers.get('Cookie')).toBe('session=abc123')
    expect(forwardedRequest.headers.get('X-Forwarded-For')).toBe('192.168.1.1')
    expect(forwardedRequest.headers.get('X-Real-IP')).toBe('10.0.0.1')
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('ProxyWorker - Performance', () => {
  let env: MockEnv
  let ctx: ExecutionContext

  beforeEach(() => {
    env = createMockEnv()
    ctx = createMockContext()
  })

  it('creates DO stub only once per request', async () => {
    const request = createRequest('/ns/data')

    await proxyWorker.fetch(request, env, ctx)

    expect(env.DO.idFromName).toHaveBeenCalledTimes(1)
    expect(env.DO.get).toHaveBeenCalledTimes(1)
  })

  it('does not cache DO stubs across requests', async () => {
    const request1 = createRequest('/ns1/data')
    const request2 = createRequest('/ns2/data')

    await proxyWorker.fetch(request1, env, ctx)
    await proxyWorker.fetch(request2, env, ctx)

    expect(env.DO.idFromName).toHaveBeenCalledTimes(2)
    expect(env.DO.idFromName).toHaveBeenNthCalledWith(1, 'ns1')
    expect(env.DO.idFromName).toHaveBeenNthCalledWith(2, 'ns2')
  })
})
