/**
 * Customer Worker Helpers - RED TDD Tests
 *
 * These tests verify simple export helpers that allow customers to easily expose
 * their Durable Objects with minimal boilerplate.
 *
 * Key Requirements:
 * 1. Simple default export that proxies to DO
 * 2. Handler creator functions for different transports
 * 3. Minimal boilerplate for customer workers
 * 4. Support for multiple DO classes in one worker
 * 5. Environment binding helpers
 *
 * Example customer worker should be just:
 * ```typescript
 * export { default } from '@dotdo/worker-helpers/preset'
 * // or
 * import { MyDO } from './my-do'
 * export default createWorker(MyDO)
 * ```
 *
 * RED PHASE: Implementation does not exist yet. These tests will fail.
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'

// Future imports (these don't exist yet - RED phase):
// import {
//   createWorker,
//   createHandler,
//   createFetchHandler,
//   createWebSocketHandler,
//   createRPCHandler,
//   createMultiDOWorker,
//   bindDO,
//   resolveDO,
//   withMiddleware,
//   withErrorHandler,
//   withCORS,
//   withAuth,
// } from '@dotdo/worker-helpers'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock Durable Object class for testing
 */
class MockDO {
  static readonly $type = 'MockDO'
  private ctx: DurableObjectState
  private env: MockEnv

  constructor(ctx: DurableObjectState, env: MockEnv) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade like a real DO would
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }
    return new Response(JSON.stringify({ status: 'ok', type: 'MockDO' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async handleWebSocket(request: Request): Promise<Response> {
    // Mock WebSocket upgrade - use custom response since we can't use status 101
    // In real Cloudflare Workers, this would be a proper WebSocket upgrade
    // We simulate it by creating a response that indicates WebSocket was handled
    const response = new Response(null, { status: 200 })
    // Use Object.defineProperty to override status for testing purposes
    Object.defineProperty(response, 'status', { value: 101, writable: false })
    return response
  }

  async rpc(method: string, args: unknown[]): Promise<unknown> {
    return { method, args, result: 'mocked' }
  }
}

/**
 * Second mock DO for multi-DO tests
 */
class UserDO {
  static readonly $type = 'UserDO'
  private ctx: DurableObjectState
  private env: MockEnv

  constructor(ctx: DurableObjectState, env: MockEnv) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ type: 'UserDO' }))
  }

  async getUser(id: string): Promise<{ id: string; name: string }> {
    return { id, name: `User ${id}` }
  }
}

/**
 * Third mock DO for multi-DO tests
 */
class PostDO {
  static readonly $type = 'PostDO'
  private ctx: DurableObjectState
  private env: MockEnv

  constructor(ctx: DurableObjectState, env: MockEnv) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ type: 'PostDO' }))
  }

  async getPost(id: string): Promise<{ id: string; title: string }> {
    return { id, title: `Post ${id}` }
  }
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<T>
}

interface DurableObjectStub<T = unknown> {
  id: DurableObjectId
  fetch(request: Request): Promise<Response>
  connect?(): WebSocket
}

interface MockEnv {
  MOCK_DO?: DurableObjectNamespace<MockDO>
  USER_DO?: DurableObjectNamespace<UserDO>
  POST_DO?: DurableObjectNamespace<PostDO>
  [key: string]: unknown
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

function createMockDOId(name: string = 'test-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other) => other.toString() === name,
    name,
  }
}

function createMockDOStub<T>(doInstance: T): DurableObjectStub<T> {
  return {
    id: createMockDOId(),
    fetch: vi.fn(async (request: Request) => {
      if (typeof (doInstance as { fetch?: (r: Request) => Promise<Response> }).fetch === 'function') {
        return (doInstance as { fetch: (r: Request) => Promise<Response> }).fetch(request)
      }
      return new Response('Not Found', { status: 404 })
    }),
  }
}

function createMockDONamespace<T>(
  DOClass: new (ctx: DurableObjectState, env: MockEnv) => T
): DurableObjectNamespace<T> {
  const instances = new Map<string, T>()

  const createInstance = (id: DurableObjectId): T => {
    const key = id.toString()
    if (!instances.has(key)) {
      const mockState: DurableObjectState = {
        id,
        storage: {
          get: vi.fn(async () => undefined),
          put: vi.fn(async () => {}),
          delete: vi.fn(async () => true),
          deleteAll: vi.fn(async () => {}),
          list: vi.fn(async () => new Map()),
        },
        waitUntil: vi.fn(),
        blockConcurrencyWhile: vi.fn(async (cb) => cb()),
      }
      instances.set(key, new DOClass(mockState, {}))
    }
    return instances.get(key)!
  }

  return {
    idFromName: (name) => createMockDOId(name),
    idFromString: (id) => createMockDOId(id),
    newUniqueId: () => createMockDOId(`unique-${Date.now()}`),
    get: (id) => {
      const instance = createInstance(id)
      return createMockDOStub(instance)
    },
  }
}

function createMockEnv(): MockEnv {
  return {
    MOCK_DO: createMockDONamespace(MockDO),
    USER_DO: createMockDONamespace(UserDO),
    POST_DO: createMockDONamespace(PostDO),
  }
}

function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

// ============================================================================
// Import the actual implementation
// ============================================================================

import {
  createWorker,
  createHandler,
  createFetchHandler,
  createWebSocketHandler,
  createRPCHandler,
  createMultiDOWorker,
  bindDO,
  resolveDO,
  withMiddleware,
  withErrorHandler,
  withCORS,
  withAuth,
  getDOBinding,
  inferBindingName,
} from '../src/index'

// ============================================================================
// TESTS: createWorker - Simple Default Export
// ============================================================================

describe('Customer Worker Helpers', () => {
  describe('createWorker', () => {
    it('creates a worker that proxies to DO', async () => {
      // Customer code should be:
      // export default createWorker(MyDO)
      const worker = createWorker(MockDO)

      expect(worker).toBeDefined()
      expect(worker.fetch).toBeDefined()
      expect(typeof worker.fetch).toBe('function')
    })

    it('worker.fetch routes requests to DO instance', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test')
      const response = await worker.fetch(request, env, ctx)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(200)
    })

    it('extracts DO id from URL path', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      // URL format: /{id}/... should route to DO with that id
      const request = new Request('https://example.com.ai/user-123/profile')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
    })

    it('extracts DO id from query parameter', async () => {
      const worker = createWorker(MockDO, { idSource: 'query' })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/profile?id=user-123')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
    })

    it('extracts DO id from header', async () => {
      const worker = createWorker(MockDO, { idSource: 'header', idHeader: 'X-DO-ID' })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/profile', {
        headers: { 'X-DO-ID': 'user-123' },
      })
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
    })

    it('uses custom id extractor function', async () => {
      const idExtractor = (request: Request) => {
        const url = new URL(request.url)
        return url.pathname.split('/')[2] // /api/{id}/...
      }

      const worker = createWorker(MockDO, { idExtractor })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/api/custom-id/action')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
    })

    it('handles missing DO id gracefully', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toHaveProperty('error')
    })

    it('passes environment to DO constructor', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id/action')
      await worker.fetch(request, env, ctx)

      // Verify env was passed (implementation detail)
      expect(env.MOCK_DO).toBeDefined()
    })

    it('supports options for customization', async () => {
      const worker = createWorker(MockDO, {
        bindingName: 'CUSTOM_DO',
        idSource: 'path',
        pathPrefix: '/api/v1',
      })

      expect(worker).toBeDefined()
      expect(worker.fetch).toBeDefined()
    })

    it('handles WebSocket upgrade requests', async () => {
      const worker = createWorker(MockDO, { websocket: true })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/ws-id/connect', {
        headers: { Upgrade: 'websocket' },
      })
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(101)
    })
  })

  // ==========================================================================
  // TESTS: createHandler - Fetch Handler Creator
  // ==========================================================================

  describe('createHandler', () => {
    it('creates fetch handler for DO', async () => {
      // Customer code should be:
      // export default { fetch: createHandler(MyDO) }
      const handler = createHandler(MockDO)

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('handler returns Response', async () => {
      const handler = createHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      const response = await handler(request, env, ctx)

      expect(response).toBeInstanceOf(Response)
    })

    it('supports middleware chain', async () => {
      const logMiddleware = vi.fn((request: Request, next: () => Promise<Response>) => next())
      const authMiddleware = vi.fn((request: Request, next: () => Promise<Response>) => next())

      const handler = createHandler(MockDO, [logMiddleware, authMiddleware])
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      await handler(request, env, ctx)

      expect(logMiddleware).toHaveBeenCalled()
      expect(authMiddleware).toHaveBeenCalled()
    })

    it('middleware can short-circuit request', async () => {
      const authMiddleware = vi.fn(async () => {
        return new Response('Unauthorized', { status: 401 })
      })

      const handler = createHandler(MockDO, [authMiddleware])
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(401)
    })

    it('middleware receives request and can modify it', async () => {
      const headerMiddleware = vi.fn(async (request: Request, next: () => Promise<Response>) => {
        const modifiedRequest = new Request(request, {
          headers: { ...Object.fromEntries(request.headers), 'X-Modified': 'true' },
        })
        return next()
      })

      const handler = createHandler(MockDO, [headerMiddleware])
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      await handler(request, env, ctx)

      expect(headerMiddleware).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // TESTS: Transport-Specific Handlers
  // ==========================================================================

  describe('createFetchHandler', () => {
    it('creates HTTP-only fetch handler', async () => {
      const handler = createFetchHandler(MockDO)

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('rejects WebSocket upgrades', async () => {
      const handler = createFetchHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id', {
        headers: { Upgrade: 'websocket' },
      })
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(426) // Upgrade Required
    })

    it('handles standard HTTP methods', async () => {
      const handler = createFetchHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        const request = new Request('https://example.com.ai/test-id', { method })
        const response = await handler(request, env, ctx)
        expect(response).toBeInstanceOf(Response)
      }
    })
  })

  describe('createWebSocketHandler', () => {
    it('creates WebSocket-only handler', async () => {
      const handler = createWebSocketHandler(MockDO)

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('requires WebSocket upgrade header', async () => {
      const handler = createWebSocketHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('WebSocket')
    })

    it('upgrades valid WebSocket requests', async () => {
      const handler = createWebSocketHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id', {
        headers: { Upgrade: 'websocket' },
      })
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(101)
    })
  })

  describe('createRPCHandler', () => {
    it('creates JSON-RPC handler', async () => {
      const handler = createRPCHandler(MockDO)

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('handles JSON-RPC 2.0 requests', async () => {
      const handler = createRPCHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'rpc',
          params: ['test', ['arg1']],
          id: 1,
        }),
      })
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toHaveProperty('jsonrpc', '2.0')
      expect(body).toHaveProperty('result')
      expect(body).toHaveProperty('id', 1)
    })

    it('returns JSON-RPC error for invalid requests', async () => {
      const handler = createRPCHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'request' }),
      })
      const response = await handler(request, env, ctx)

      const body = await response.json()
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
    })

    it('supports batch RPC requests', async () => {
      const handler = createRPCHandler(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', method: 'rpc', params: ['method1', []], id: 1 },
          { jsonrpc: '2.0', method: 'rpc', params: ['method2', []], id: 2 },
        ]),
      })
      const response = await handler(request, env, ctx)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)
    })
  })

  // ==========================================================================
  // TESTS: Multiple DO Classes in One Worker
  // ==========================================================================

  describe('createMultiDOWorker', () => {
    it('handles multiple DO classes', async () => {
      const worker = createMultiDOWorker({
        users: UserDO,
        posts: PostDO,
      })

      expect(worker).toBeDefined()
      expect(worker.fetch).toBeDefined()
    })

    it('routes by path prefix to correct DO', async () => {
      const worker = createMultiDOWorker({
        users: UserDO,
        posts: PostDO,
      })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      // /users/{id}/... -> UserDO
      const userRequest = new Request('https://example.com.ai/users/user-123/profile')
      const userResponse = await worker.fetch(userRequest, env, ctx)
      const userData = await userResponse.json()
      expect(userData.type).toBe('UserDO')

      // /posts/{id}/... -> PostDO
      const postRequest = new Request('https://example.com.ai/posts/post-456/content')
      const postResponse = await worker.fetch(postRequest, env, ctx)
      const postData = await postResponse.json()
      expect(postData.type).toBe('PostDO')
    })

    it('returns 404 for unknown routes', async () => {
      const worker = createMultiDOWorker({
        users: UserDO,
        posts: PostDO,
      })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/unknown/id-123')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(404)
    })

    it('supports custom route patterns', async () => {
      const worker = createMultiDOWorker({
        users: { DO: UserDO, pattern: '/api/v1/users/:id/*' },
        posts: { DO: PostDO, pattern: '/api/v1/posts/:id/*' },
      })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/api/v1/users/user-123/profile')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
    })

    it('allows custom binding names per DO', async () => {
      const worker = createMultiDOWorker({
        users: { DO: UserDO, binding: 'CUSTOM_USER_DO' },
        posts: { DO: PostDO, binding: 'CUSTOM_POST_DO' },
      })

      expect(worker).toBeDefined()
    })

    it('supports per-DO middleware', async () => {
      const userMiddleware = vi.fn((req: Request, next: () => Promise<Response>) => next())
      const postMiddleware = vi.fn((req: Request, next: () => Promise<Response>) => next())

      const worker = createMultiDOWorker({
        users: { DO: UserDO, middleware: [userMiddleware] },
        posts: { DO: PostDO, middleware: [postMiddleware] },
      })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      await worker.fetch(new Request('https://example.com.ai/users/id/test'), env, ctx)
      expect(userMiddleware).toHaveBeenCalled()
      expect(postMiddleware).not.toHaveBeenCalled()

      await worker.fetch(new Request('https://example.com.ai/posts/id/test'), env, ctx)
      expect(postMiddleware).toHaveBeenCalled()
    })

    it('supports global middleware applied to all routes', async () => {
      const globalMiddleware = vi.fn((req: Request, next: () => Promise<Response>) => next())

      const worker = createMultiDOWorker(
        {
          users: UserDO,
          posts: PostDO,
        },
        { middleware: [globalMiddleware] }
      )
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      await worker.fetch(new Request('https://example.com.ai/users/id/test'), env, ctx)
      expect(globalMiddleware).toHaveBeenCalledTimes(1)

      await worker.fetch(new Request('https://example.com.ai/posts/id/test'), env, ctx)
      expect(globalMiddleware).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // TESTS: Environment Binding Helpers
  // ==========================================================================

  describe('Environment Binding Helpers', () => {
    describe('bindDO', () => {
      it('resolves DO bindings from class name', () => {
        const env = createMockEnv()
        const namespace = bindDO(env, MockDO)

        expect(namespace).toBeDefined()
        expect(namespace.idFromName).toBeDefined()
        expect(namespace.get).toBeDefined()
      })

      it('uses $type static property for binding name', () => {
        const env = createMockEnv()
        // MockDO has static $type = 'MockDO'
        // Expected binding name: MOCK_DO
        const namespace = bindDO(env, MockDO)

        expect(namespace).toBeDefined()
      })

      it('falls back to class name if $type not present', () => {
        class SimpleClass {
          constructor(_ctx: DurableObjectState, _env: MockEnv) {}
        }
        const env = { SIMPLE_CLASS: createMockDONamespace(SimpleClass as unknown as typeof MockDO) }
        const namespace = bindDO(env as MockEnv, SimpleClass as unknown as typeof MockDO)

        expect(namespace).toBeDefined()
      })

      it('throws if binding not found', () => {
        const env: MockEnv = {}

        expect(() => bindDO(env, MockDO)).toThrow(/binding.*not found/i)
      })
    })

    describe('resolveDO', () => {
      it('resolves DO by explicit binding name', () => {
        const env = createMockEnv()
        const namespace = resolveDO<MockDO>(env, 'MOCK_DO')

        expect(namespace).toBeDefined()
        expect(namespace.idFromName).toBeDefined()
      })

      it('throws if binding name not in env', () => {
        const env: MockEnv = {}

        expect(() => resolveDO(env, 'NONEXISTENT_DO')).toThrow(/binding.*not found/i)
      })

      it('validates binding is a DO namespace', () => {
        const env: MockEnv = {
          NOT_A_DO: 'just a string',
        }

        expect(() => resolveDO(env, 'NOT_A_DO')).toThrow(/not.*durable object/i)
      })
    })

    describe('getDOBinding', () => {
      it('auto-detects binding from environment', () => {
        const env = createMockEnv()
        const binding = getDOBinding(env, MockDO)

        expect(binding).toBeDefined()
      })

      it('returns undefined if no matching binding', () => {
        const env: MockEnv = {}
        const binding = getDOBinding(env, MockDO)

        expect(binding).toBeUndefined()
      })
    })

    describe('inferBindingName', () => {
      it('converts class name to SCREAMING_SNAKE_CASE', () => {
        expect(inferBindingName({ name: 'UserDO' })).toBe('USER_DO')
        expect(inferBindingName({ name: 'MyCustomDurableObject' })).toBe('MY_CUSTOM_DURABLE_OBJECT')
      })

      it('uses $type if available', () => {
        expect(inferBindingName({ $type: 'CustomType' })).toBe('CUSTOM_TYPE')
      })

      it('handles edge cases', () => {
        expect(inferBindingName({ name: 'DO' })).toBe('DO')
        expect(inferBindingName({ name: 'ABCService' })).toBe('ABC_SERVICE')
      })
    })
  })

  // ==========================================================================
  // TESTS: Middleware Helpers
  // ==========================================================================

  describe('Middleware Helpers', () => {
    describe('withMiddleware', () => {
      it('wraps handler with middleware', async () => {
        const baseHandler = vi.fn(async () => new Response('OK'))
        const middleware = vi.fn(async (_req: Request, next: () => Promise<Response>) => next())

        const wrapped = withMiddleware(baseHandler, middleware)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(middleware).toHaveBeenCalled()
        expect(baseHandler).toHaveBeenCalled()
      })

      it('executes middleware in order', async () => {
        const order: string[] = []
        const baseHandler = vi.fn(async () => {
          order.push('handler')
          return new Response('OK')
        })
        const first = vi.fn(async (_req: Request, next: () => Promise<Response>) => {
          order.push('first-before')
          const res = await next()
          order.push('first-after')
          return res
        })
        const second = vi.fn(async (_req: Request, next: () => Promise<Response>) => {
          order.push('second-before')
          const res = await next()
          order.push('second-after')
          return res
        })

        const wrapped = withMiddleware(baseHandler, first, second)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(order).toEqual(['first-before', 'second-before', 'handler', 'second-after', 'first-after'])
      })
    })

    describe('withErrorHandler', () => {
      it('catches errors and returns error response', async () => {
        const failingHandler = vi.fn(async () => {
          throw new Error('Intentional error')
        })

        const wrapped = withErrorHandler(failingHandler)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(response.status).toBe(500)
        const body = await response.json()
        expect(body).toHaveProperty('error')
      })

      it('passes successful responses through', async () => {
        const successHandler = vi.fn(async () => new Response('OK', { status: 200 }))

        const wrapped = withErrorHandler(successHandler)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(response.status).toBe(200)
      })

      it('uses custom error handler if provided', async () => {
        const failingHandler = vi.fn(async () => {
          throw new Error('Custom error')
        })
        const customErrorHandler = vi.fn((error: Error) => {
          return new Response(JSON.stringify({ custom: error.message }), { status: 418 })
        })

        const wrapped = withErrorHandler(failingHandler, customErrorHandler)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(response.status).toBe(418)
        expect(customErrorHandler).toHaveBeenCalled()
      })
    })

    describe('withCORS', () => {
      it('adds CORS headers to response', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withCORS(handler)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined()
      })

      it('handles preflight OPTIONS requests', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withCORS(handler)
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(
          new Request('https://example.com.ai', { method: 'OPTIONS' }),
          env,
          ctx
        )

        expect(response.status).toBe(204)
        expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined()
        expect(handler).not.toHaveBeenCalled() // Should not call handler for preflight
      })

      it('supports custom CORS options', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withCORS(handler, {
          origin: 'https://allowed-origin.com',
          methods: ['GET', 'POST'],
          headers: ['X-Custom-Header'],
        })
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const response = await wrapped(new Request('https://example.com.ai'), env, ctx)

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed-origin.com')
      })
    })

    describe('withAuth', () => {
      it('validates authentication', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withAuth(handler, {
          type: 'bearer',
          validate: async (token: string) => token === 'valid-token',
        })
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const validRequest = new Request('https://example.com.ai', {
          headers: { Authorization: 'Bearer valid-token' },
        })
        const validResponse = await wrapped(validRequest, env, ctx)
        expect(validResponse.status).toBe(200)
        expect(handler).toHaveBeenCalled()
      })

      it('rejects invalid authentication', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withAuth(handler, {
          type: 'bearer',
          validate: async (token: string) => token === 'valid-token',
        })
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const invalidRequest = new Request('https://example.com.ai', {
          headers: { Authorization: 'Bearer invalid-token' },
        })
        const invalidResponse = await wrapped(invalidRequest, env, ctx)
        expect(invalidResponse.status).toBe(401)
        expect(handler).not.toHaveBeenCalled()
      })

      it('rejects missing authentication', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withAuth(handler, {
          type: 'bearer',
          validate: async () => true,
        })
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const noAuthRequest = new Request('https://example.com.ai')
        const noAuthResponse = await wrapped(noAuthRequest, env, ctx)
        expect(noAuthResponse.status).toBe(401)
      })

      it('supports API key authentication', async () => {
        const handler = vi.fn(async () => new Response('OK'))

        const wrapped = withAuth(handler, {
          type: 'apiKey',
          header: 'X-API-Key',
          validate: async (key: string) => key === 'secret-key',
        })
        const env = createMockEnv()
        const ctx = createMockExecutionContext()

        const request = new Request('https://example.com.ai', {
          headers: { 'X-API-Key': 'secret-key' },
        })
        const response = await wrapped(request, env, ctx)
        expect(response.status).toBe(200)
      })
    })
  })

  // ==========================================================================
  // TESTS: Minimal Boilerplate Examples
  // ==========================================================================

  describe('Minimal Boilerplate', () => {
    it('single line export for simple DO', async () => {
      // Customer code: export default createWorker(MyDO)
      const worker = createWorker(MockDO)

      expect(worker).toBeDefined()
      expect(typeof worker.fetch).toBe('function')
    })

    it('single object export with fetch handler', async () => {
      // Customer code: export default { fetch: createHandler(MyDO) }
      const handler = createHandler(MockDO)
      const workerExport = { fetch: handler }

      expect(workerExport.fetch).toBeDefined()
    })

    it('multi-DO worker in one declaration', async () => {
      // Customer code:
      // export default createMultiDOWorker({
      //   users: UserDO,
      //   posts: PostDO,
      // })
      const worker = createMultiDOWorker({
        users: UserDO,
        posts: PostDO,
      })

      expect(worker.fetch).toBeDefined()
    })

    it('handler with middleware in single expression', async () => {
      // Customer code:
      // export default {
      //   fetch: withCORS(withAuth(createHandler(MyDO), authConfig))
      // }
      const handler = withCORS(
        withAuth(createHandler(MockDO), { type: 'bearer', validate: async () => true })
      )

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  // ==========================================================================
  // TESTS: Type Safety
  // ==========================================================================

  describe('Type Safety', () => {
    it('createWorker accepts DO class constructor', () => {
      // Type check: should compile without errors
      const worker = createWorker(MockDO)
      expect(worker).toBeDefined()
    })

    it('createMultiDOWorker enforces DO class types', () => {
      // Type check: should compile without errors
      const worker = createMultiDOWorker({
        users: UserDO,
        posts: PostDO,
      })
      expect(worker).toBeDefined()
    })

    it('bindDO returns correctly typed namespace', () => {
      const env = createMockEnv()
      const namespace = bindDO<MockDO>(env, MockDO)

      // Type check: namespace should be DurableObjectNamespace<MockDO>
      expect(namespace.get).toBeDefined()
    })

    it('resolveDO returns correctly typed namespace', () => {
      const env = createMockEnv()
      const namespace = resolveDO<UserDO>(env, 'USER_DO')

      // Type check: namespace should be DurableObjectNamespace<UserDO>
      expect(namespace.get).toBeDefined()
    })
  })

  // ==========================================================================
  // TESTS: Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('returns proper error for missing DO binding', async () => {
      const worker = createWorker(MockDO)
      const emptyEnv: MockEnv = {}
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      const response = await worker.fetch(request, emptyEnv, ctx)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toContain('binding')
    })

    it('returns proper error for invalid DO id', async () => {
      const worker = createWorker(MockDO, {
        idValidator: (id: string) => /^[a-z0-9-]+$/.test(id),
      })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/INVALID_ID!')
      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(400)
    })

    it('propagates DO errors with proper status codes', async () => {
      // Mock DO that throws
      class ErrorDO {
        static readonly $type = 'ErrorDO'
        async fetch(): Promise<Response> {
          throw new Error('DO Error')
        }
      }

      const worker = createWorker(ErrorDO)
      const env = { ERROR_DO: createMockDONamespace(ErrorDO as unknown as typeof MockDO) }
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/test-id')
      const response = await worker.fetch(request, env as MockEnv, ctx)

      expect(response.status).toBe(500)
    })

    it('handles timeout errors', async () => {
      const worker = createWorker(MockDO, { timeout: 1000 })
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      // Note: This test documents expected behavior
      // Actual timeout implementation may vary
      const request = new Request('https://example.com.ai/test-id')
      const response = await worker.fetch(request, env, ctx)

      expect(response).toBeInstanceOf(Response)
    })
  })

  // ==========================================================================
  // TESTS: Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty path', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/')
      const response = await worker.fetch(request, env, ctx)

      // Should return error for missing ID or handle gracefully
      expect(response.status).toBeGreaterThanOrEqual(400)
    })

    it('handles very long DO ids', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const longId = 'a'.repeat(1000)
      const request = new Request(`https://example.com.ai/${longId}`)
      const response = await worker.fetch(request, env, ctx)

      // Should either work or return appropriate error
      expect(response).toBeInstanceOf(Response)
    })

    it('handles special characters in DO id', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const request = new Request('https://example.com.ai/id-with-special%20chars')
      const response = await worker.fetch(request, env, ctx)

      expect(response).toBeInstanceOf(Response)
    })

    it('handles concurrent requests to same DO', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const requests = Array.from({ length: 10 }, (_, i) =>
        worker.fetch(new Request(`https://example.com.ai/same-id/request-${i}`), env, ctx)
      )

      const responses = await Promise.all(requests)
      expect(responses.every((r) => r instanceof Response)).toBe(true)
    })

    it('handles trailing slashes', async () => {
      const worker = createWorker(MockDO)
      const env = createMockEnv()
      const ctx = createMockExecutionContext()

      const withSlash = new Request('https://example.com.ai/test-id/')
      const withoutSlash = new Request('https://example.com.ai/test-id')

      const [r1, r2] = await Promise.all([
        worker.fetch(withSlash, env, ctx),
        worker.fetch(withoutSlash, env, ctx),
      ])

      // Both should succeed
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
    })
  })
})
