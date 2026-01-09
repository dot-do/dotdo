/**
 * RED Phase Tests for Usage Middleware
 *
 * These tests verify the usage tracking middleware that captures request/response metrics
 * and emits events to the usage analytics pipeline.
 *
 * Related issues:
 * - dotdo-nko3: [Red] Usage event schema and middleware tests
 *
 * Implementation requirements:
 * - Capture request/response metrics (latency, status code, sizes)
 * - Attach usage info to Hono context
 * - Emit events to pipeline asynchronously (non-blocking)
 * - Track API key attribution for authenticated requests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Types (Expected)
// ============================================================================

/**
 * Expected UsageContext attached to Hono context
 */
interface UsageContext {
  /** Start time of request processing */
  startTime: number
  /** Request ID for correlation */
  requestId: string
  /** Endpoint path (normalized) */
  endpoint: string
  /** HTTP method */
  method: string
  /** API key ID if authenticated via API key */
  apiKeyId?: string
  /** User ID if authenticated */
  userId?: string
  /** Request content length */
  requestSize?: number
}

/**
 * Expected Pipeline interface for usage events
 */
interface UsagePipeline {
  send(events: unknown[]): Promise<void>
}

/**
 * Expected middleware options
 */
interface UsageMiddlewareOptions {
  /** Pipeline to send events to */
  pipeline: UsagePipeline
  /** Endpoints to exclude from tracking */
  excludePaths?: string[]
  /** Whether to track anonymous requests */
  trackAnonymous?: boolean
  /** Cost calculator function */
  calculateCost?: (ctx: UsageContext, statusCode: number) => number
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let usageMiddleware: ((options: UsageMiddlewareOptions) => unknown) | undefined
let createUsagePipeline: (() => UsagePipeline & { events: unknown[]; clear: () => void }) | undefined

try {
  // @ts-expect-error - Module not yet implemented
  const module = await import('../../api/middleware/usage')
  usageMiddleware = module.usageMiddleware

  // @ts-expect-error - Module not yet implemented
  const pipelineModule = await import('../../tests/mocks/usage-pipeline')
  createUsagePipeline = pipelineModule.createUsagePipeline
} catch {
  // Modules don't exist yet - tests will fail as expected (RED phase)
  usageMiddleware = undefined
  createUsagePipeline = undefined
}

// ============================================================================
// Test App Factory
// ============================================================================

interface TestEnv {
  API_KEYS?: string
}

interface TestVariables {
  auth?: {
    userId: string
    apiKeyId?: string
    role: 'admin' | 'user'
  }
  usage?: UsageContext
}

function createTestApp(
  pipeline: UsagePipeline,
  options?: Partial<UsageMiddlewareOptions>
): Hono<{ Bindings: TestEnv; Variables: TestVariables }> {
  const app = new Hono<{ Bindings: TestEnv; Variables: TestVariables }>()

  app.use('*', usageMiddleware!({ pipeline, ...options }))

  app.get('/api/test', (c) => c.json({ ok: true }))
  app.post('/api/things', (c) => c.json({ created: true }, 201))
  app.get('/api/slow', async (c) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return c.json({ slow: true })
  })
  app.get('/api/error', () => {
    throw new Error('Intentional error')
  })
  app.get('/health', (c) => c.text('OK'))

  return app
}

// ============================================================================
// 1. Middleware Export Tests
// ============================================================================

describe('usageMiddleware Export', () => {
  it('usageMiddleware is exported from api/middleware/usage', () => {
    expect(usageMiddleware).toBeDefined()
    expect(typeof usageMiddleware).toBe('function')
  })

  it('createUsagePipeline mock is available', () => {
    expect(createUsagePipeline).toBeDefined()
    expect(typeof createUsagePipeline).toBe('function')
  })
})

// ============================================================================
// 2. Captures Request/Response Metrics Tests
// ============================================================================

describe('Captures request/response metrics', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    vi.useRealTimers()
    pipeline.clear()
  })

  it('emits usage event after request completes', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    expect(pipeline.events).toHaveLength(1)
  })

  it('captures endpoint path in event', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { endpoint: string }
    expect(event.endpoint).toBe('/api/test')
  })

  it('captures HTTP method in event', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/things', { method: 'POST' })

    const event = pipeline.events[0] as { method: string }
    expect(event.method).toBe('POST')
  })

  it('captures status code in event', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/things', { method: 'POST' })

    const event = pipeline.events[0] as { statusCode: number }
    expect(event.statusCode).toBe(201)
  })

  it('captures latency in milliseconds', async () => {
    // Use real timers for this test since we need actual time to pass
    // for the setTimeout in the slow handler to work
    vi.useRealTimers()
    pipeline = createUsagePipeline!()

    const app = createTestApp(pipeline)

    await app.request('/api/slow', { method: 'GET' })

    const event = pipeline.events[0] as { latencyMs: number }
    expect(event.latencyMs).toBeGreaterThanOrEqual(50)
    expect(event.latencyMs).toBeLessThan(200) // Allow some overhead

    // Restore fake timers for subsequent tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
  })

  it('captures request size from Content-Length header', async () => {
    const app = createTestApp(pipeline)
    const body = JSON.stringify({ data: 'test content' })

    await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length.toString() },
      body,
    })

    const event = pipeline.events[0] as { metadata: { requestSize: number } }
    expect(event.metadata?.requestSize).toBe(body.length)
  })

  it('captures response size', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { metadata: { responseSize: number } }
    expect(event.metadata?.responseSize).toBeGreaterThan(0)
  })

  it('generates unique event ID for each request', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })
    await app.request('/api/test', { method: 'GET' })

    const event1 = pipeline.events[0] as { id: string }
    const event2 = pipeline.events[1] as { id: string }
    expect(event1.id).toBeDefined()
    expect(event2.id).toBeDefined()
    expect(event1.id).not.toBe(event2.id)
  })

  it('includes timestamp in ISO 8601 format', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { timestamp: string }
    expect(event.timestamp).toBe('2026-01-09T12:00:00.000Z')
  })
})

// ============================================================================
// 3. Attaches Usage Info to Context Tests
// ============================================================================

describe('Attaches usage info to context', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('attaches usage context to c.var', async () => {
    const app = new Hono<{ Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))

    let usageContext: UsageContext | undefined
    app.get('/test', (c) => {
      usageContext = c.get('usage')
      return c.json({ ok: true })
    })

    await app.request('/test', { method: 'GET' })

    expect(usageContext).toBeDefined()
  })

  it('usage context includes startTime', async () => {
    const app = new Hono<{ Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))

    let usageContext: UsageContext | undefined
    app.get('/test', (c) => {
      usageContext = c.get('usage')
      return c.json({ ok: true })
    })

    const beforeRequest = Date.now()
    await app.request('/test', { method: 'GET' })

    expect(usageContext?.startTime).toBeGreaterThanOrEqual(beforeRequest)
  })

  it('usage context includes requestId', async () => {
    const app = new Hono<{ Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))

    let usageContext: UsageContext | undefined
    app.get('/test', (c) => {
      usageContext = c.get('usage')
      return c.json({ ok: true })
    })

    await app.request('/test', { method: 'GET' })

    expect(usageContext?.requestId).toBeDefined()
    expect(usageContext?.requestId.length).toBeGreaterThan(0)
  })

  it('usage context includes endpoint', async () => {
    const app = new Hono<{ Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))

    let usageContext: UsageContext | undefined
    app.get('/api/users/:id', (c) => {
      usageContext = c.get('usage')
      return c.json({ ok: true })
    })

    await app.request('/api/users/123', { method: 'GET' })

    // Should normalize to pattern, not include actual ID
    expect(usageContext?.endpoint).toBe('/api/users/:id')
  })

  it('usage context includes method', async () => {
    const app = new Hono<{ Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))

    let usageContext: UsageContext | undefined
    app.post('/test', (c) => {
      usageContext = c.get('usage')
      return c.json({ ok: true })
    })

    await app.request('/test', { method: 'POST' })

    expect(usageContext?.method).toBe('POST')
  })
})

// ============================================================================
// 4. Emits Events to Pipeline Tests
// ============================================================================

describe('Emits events to pipeline', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void; send: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    pipeline = createUsagePipeline!() as UsagePipeline & {
      events: unknown[]
      clear: () => void
      send: ReturnType<typeof vi.fn>
    }
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('calls pipeline.send with event array', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    expect(pipeline.send).toHaveBeenCalled()
    const callArg = pipeline.send.mock.calls[0][0]
    expect(Array.isArray(callArg)).toBe(true)
  })

  it('sends event asynchronously (non-blocking)', async () => {
    let sendCompleted = false
    const slowPipeline: UsagePipeline & { events: unknown[]; clear: () => void; send: ReturnType<typeof vi.fn> } = {
      events: [],
      send: vi.fn(async (events) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        slowPipeline.events.push(...events)
        sendCompleted = true
      }),
      clear: () => {
        slowPipeline.events = []
      },
    }

    const app = createTestApp(slowPipeline)

    const startTime = Date.now()
    const response = await app.request('/api/test', { method: 'GET' })
    const responseTime = Date.now() - startTime

    // Response should return before send completes
    expect(response.status).toBe(200)
    expect(responseTime).toBeLessThan(50) // Should not wait for 100ms send

    // Wait for send to complete
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(sendCompleted).toBe(true)
  })

  it('does not block response on pipeline errors', async () => {
    const errorPipeline: UsagePipeline = {
      send: vi.fn(async () => {
        throw new Error('Pipeline failed')
      }),
    }

    const app = createTestApp(errorPipeline)

    const response = await app.request('/api/test', { method: 'GET' })

    // Response should still succeed
    expect(response.status).toBe(200)
  })

  it('batches multiple requests if sent in quick succession', async () => {
    const app = createTestApp(pipeline)

    // Send multiple requests quickly
    await Promise.all([
      app.request('/api/test', { method: 'GET' }),
      app.request('/api/test', { method: 'GET' }),
      app.request('/api/test', { method: 'GET' }),
    ])

    // Allow time for batching
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Events should be captured (batching is an optimization detail)
    expect(pipeline.events.length).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================================
// 5. API Key Attribution Tests
// ============================================================================

describe('Tracks API key attribution', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('captures apiKeyId from X-API-Key header authentication', async () => {
    const env = {
      API_KEYS: JSON.stringify({
        'test-key-abc': { userId: 'user-1', role: 'user', name: 'Test Key' },
      }),
    }

    const app = new Hono<{ Bindings: typeof env; Variables: TestVariables }>()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/test', (c) => c.json({ ok: true }))

    await app.request(
      '/api/test',
      {
        method: 'GET',
        headers: { 'X-API-Key': 'test-key-abc' },
      },
      env
    )

    const event = pipeline.events[0] as { apiKeyId: string }
    expect(event.apiKeyId).toBe('test-key-abc')
  })

  it('captures apiKeyId from Authorization Bearer token', async () => {
    const app = new Hono<{ Variables: TestVariables }>()

    // Simulate auth middleware setting apiKeyId
    app.use('*', async (c, next) => {
      c.set('auth', { userId: 'user-1', apiKeyId: 'bearer-key-xyz', role: 'user' })
      await next()
    })
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/test', (c) => c.json({ ok: true }))

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { apiKeyId: string }
    expect(event.apiKeyId).toBe('bearer-key-xyz')
  })

  it('captures userId from authenticated session', async () => {
    const app = new Hono<{ Variables: TestVariables }>()

    // Simulate auth middleware setting userId
    app.use('*', async (c, next) => {
      c.set('auth', { userId: 'session-user-123', role: 'user' })
      await next()
    })
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/test', (c) => c.json({ ok: true }))

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { userId: string }
    expect(event.userId).toBe('session-user-123')
  })

  it('captures both userId and apiKeyId when both present', async () => {
    const app = new Hono<{ Variables: TestVariables }>()

    app.use('*', async (c, next) => {
      c.set('auth', { userId: 'owner-user', apiKeyId: 'api-key-123', role: 'user' })
      await next()
    })
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/test', (c) => c.json({ ok: true }))

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { userId: string; apiKeyId: string }
    expect(event.userId).toBe('owner-user')
    expect(event.apiKeyId).toBe('api-key-123')
  })

  it('handles anonymous requests (no auth context)', async () => {
    const app = createTestApp(pipeline, { trackAnonymous: true })

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { userId?: string; apiKeyId?: string }
    expect(event.userId).toBeUndefined()
    expect(event.apiKeyId).toBeUndefined()
  })

  it('can exclude anonymous requests from tracking', async () => {
    const app = createTestApp(pipeline, { trackAnonymous: false })

    await app.request('/api/test', { method: 'GET' })

    // No event should be emitted for anonymous request
    expect(pipeline.events).toHaveLength(0)
  })
})

// ============================================================================
// 6. Cost Calculation Tests
// ============================================================================

describe('Cost calculation', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('includes default cost of 1 for standard requests', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { cost: number }
    expect(event.cost).toBe(1)
  })

  it('uses custom cost calculator when provided', async () => {
    const customCalculator = (_ctx: UsageContext, statusCode: number) => {
      return statusCode >= 400 ? 0 : 10 // Free for errors, 10 for success
    }

    const app = createTestApp(pipeline, { calculateCost: customCalculator })

    await app.request('/api/test', { method: 'GET' })

    const event = pipeline.events[0] as { cost: number }
    expect(event.cost).toBe(10)
  })

  it('calculates higher cost for POST/PUT/PATCH methods', async () => {
    const methodBasedCalculator = (ctx: UsageContext) => {
      const costMap: Record<string, number> = {
        GET: 1,
        POST: 5,
        PUT: 5,
        PATCH: 3,
        DELETE: 2,
      }
      return costMap[ctx.method] || 1
    }

    const app = createTestApp(pipeline, { calculateCost: methodBasedCalculator })

    await app.request('/api/things', { method: 'POST' })

    const event = pipeline.events[0] as { cost: number }
    expect(event.cost).toBe(5)
  })

  it('calculates zero cost for health check endpoints', async () => {
    const healthCheckFree = (ctx: UsageContext) => {
      return ctx.endpoint === '/health' ? 0 : 1
    }

    const app = createTestApp(pipeline, { calculateCost: healthCheckFree })

    await app.request('/health', { method: 'GET' })

    const event = pipeline.events[0] as { cost: number }
    expect(event.cost).toBe(0)
  })
})

// ============================================================================
// 7. Exclude Paths Tests
// ============================================================================

describe('Exclude paths from tracking', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('excludes specified paths from tracking', async () => {
    const app = createTestApp(pipeline, { excludePaths: ['/health'] })

    await app.request('/health', { method: 'GET' })

    expect(pipeline.events).toHaveLength(0)
  })

  it('excludes multiple paths', async () => {
    const app = createTestApp(pipeline, { excludePaths: ['/health', '/metrics', '/ready'] })

    await app.request('/health', { method: 'GET' })
    await app.request('/api/test', { method: 'GET' })

    expect(pipeline.events).toHaveLength(1)
    expect((pipeline.events[0] as { endpoint: string }).endpoint).toBe('/api/test')
  })

  it('supports glob patterns for exclusion', async () => {
    const app = createTestApp(pipeline, { excludePaths: ['/internal/*'] })

    const internalApp = new Hono()
    internalApp.use('*', usageMiddleware!({ pipeline, excludePaths: ['/internal/*'] }))
    internalApp.get('/internal/health', (c) => c.text('OK'))
    internalApp.get('/internal/metrics', (c) => c.text('OK'))
    internalApp.get('/api/test', (c) => c.json({ ok: true }))

    await internalApp.request('/internal/health', { method: 'GET' })
    await internalApp.request('/internal/metrics', { method: 'GET' })
    await internalApp.request('/api/test', { method: 'GET' })

    expect(pipeline.events).toHaveLength(1)
  })

  it('tracks non-excluded paths normally', async () => {
    const app = createTestApp(pipeline, { excludePaths: ['/health'] })

    await app.request('/api/test', { method: 'GET' })

    expect(pipeline.events).toHaveLength(1)
  })
})

// ============================================================================
// 8. Error Handling Tests
// ============================================================================

describe('Error handling', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('still emits event when handler throws error', async () => {
    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/error', () => {
      throw new Error('Handler error')
    })
    app.onError((err, c) => {
      return c.json({ error: err.message }, 500)
    })

    await app.request('/error', { method: 'GET' })

    expect(pipeline.events).toHaveLength(1)
    const event = pipeline.events[0] as { statusCode: number }
    expect(event.statusCode).toBe(500)
  })

  it('captures error status codes correctly', async () => {
    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/not-found', (c) => c.json({ error: 'Not found' }, 404))
    app.get('/forbidden', (c) => c.json({ error: 'Forbidden' }, 403))
    app.get('/bad-request', (c) => c.json({ error: 'Bad request' }, 400))

    await app.request('/not-found', { method: 'GET' })
    await app.request('/forbidden', { method: 'GET' })
    await app.request('/bad-request', { method: 'GET' })

    expect(pipeline.events).toHaveLength(3)
    expect((pipeline.events[0] as { statusCode: number }).statusCode).toBe(404)
    expect((pipeline.events[1] as { statusCode: number }).statusCode).toBe(403)
    expect((pipeline.events[2] as { statusCode: number }).statusCode).toBe(400)
  })

  it('middleware itself does not throw errors', async () => {
    // Even with broken pipeline, middleware should not throw
    const brokenPipeline: UsagePipeline = {
      send: async () => {
        throw new Error('Pipeline broken')
      },
    }

    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline: brokenPipeline }))
    app.get('/test', (c) => c.json({ ok: true }))

    const response = await app.request('/test', { method: 'GET' })

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 9. Cloudflare Metadata Tests
// ============================================================================

describe('Cloudflare metadata capture', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('captures CF-Ray header as rayId', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', {
      method: 'GET',
      headers: { 'CF-Ray': 'abc123-SFO' },
    })

    const event = pipeline.events[0] as { metadata: { rayId: string } }
    expect(event.metadata?.rayId).toBe('abc123-SFO')
  })

  it('captures colo from CF-Ray suffix', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', {
      method: 'GET',
      headers: { 'CF-Ray': 'abc123def456-LAX' },
    })

    const event = pipeline.events[0] as { metadata: { colo: string } }
    expect(event.metadata?.colo).toBe('LAX')
  })

  it('captures User-Agent header', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 Test Agent' },
    })

    const event = pipeline.events[0] as { metadata: { userAgent: string } }
    expect(event.metadata?.userAgent).toBe('Mozilla/5.0 Test Agent')
  })

  it('hashes IP address for privacy', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '192.168.1.100' },
    })

    const event = pipeline.events[0] as { metadata: { ipHash: string } }
    // Should be a hash, not the raw IP
    expect(event.metadata?.ipHash).toBeDefined()
    expect(event.metadata?.ipHash).not.toBe('192.168.1.100')
    expect(event.metadata?.ipHash.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// 10. Endpoint Normalization Tests
// ============================================================================

describe('Endpoint normalization', () => {
  let pipeline: UsagePipeline & { events: unknown[]; clear: () => void }

  beforeEach(() => {
    pipeline = createUsagePipeline!()
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('normalizes path parameters to placeholders', async () => {
    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/users/:userId', (c) => c.json({ id: c.req.param('userId') }))

    await app.request('/api/users/12345', { method: 'GET' })

    const event = pipeline.events[0] as { endpoint: string }
    expect(event.endpoint).toBe('/api/users/:userId')
  })

  it('normalizes multiple path parameters', async () => {
    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/orgs/:orgId/members/:memberId', (c) => c.json({ ok: true }))

    await app.request('/api/orgs/org-abc/members/mem-xyz', { method: 'GET' })

    const event = pipeline.events[0] as { endpoint: string }
    expect(event.endpoint).toBe('/api/orgs/:orgId/members/:memberId')
  })

  it('strips query parameters from endpoint', async () => {
    const app = createTestApp(pipeline)

    await app.request('/api/test?page=1&limit=20', { method: 'GET' })

    const event = pipeline.events[0] as { endpoint: string }
    expect(event.endpoint).toBe('/api/test')
    expect(event.endpoint).not.toContain('?')
  })

  it('normalizes UUID-like path segments', async () => {
    const app = new Hono()
    app.use('*', usageMiddleware!({ pipeline }))
    app.get('/api/things/:id', (c) => c.json({ ok: true }))

    await app.request('/api/things/550e8400-e29b-41d4-a716-446655440000', { method: 'GET' })

    const event = pipeline.events[0] as { endpoint: string }
    expect(event.endpoint).toBe('/api/things/:id')
  })
})
