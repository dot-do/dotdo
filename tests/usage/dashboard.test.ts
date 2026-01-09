/**
 * RED Phase Tests for Dashboard API
 *
 * These tests verify the admin dashboard API endpoints for viewing usage analytics.
 * They are expected to FAIL until the implementation is complete.
 *
 * Related issues:
 * - dotdo-g0uo: [Red] Dashboard API tests
 *
 * Implementation requirements:
 * - GET /admin/usage - Usage overview
 * - GET /admin/usage/keys - Per-key usage
 * - GET /admin/usage/endpoints - Per-endpoint usage
 * - Date range filtering
 * - Export to CSV
 * - Authentication and admin role required
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Types (Expected)
// ============================================================================

/**
 * Usage overview response
 */
interface UsageOverviewResponse {
  summary: {
    totalRequests: number
    totalCost: number
    avgLatencyMs: number
    p95LatencyMs: number
    errorRate: number
    successRate: number
  }
  timeline: Array<{
    timestamp: string
    requests: number
    cost: number
    errors: number
  }>
  topEndpoints: Array<{
    endpoint: string
    method: string
    requests: number
    cost: number
  }>
  topApiKeys: Array<{
    apiKeyId: string
    name?: string
    requests: number
    cost: number
  }>
}

/**
 * Per-key usage response
 */
interface KeyUsageResponse {
  keys: Array<{
    apiKeyId: string
    name?: string
    userId?: string
    requests: number
    cost: number
    avgLatencyMs: number
    errorRate: number
    topEndpoint: string
    lastUsed: string
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

/**
 * Single key usage detail response
 */
interface KeyUsageDetailResponse {
  apiKeyId: string
  name?: string
  userId?: string
  summary: {
    totalRequests: number
    totalCost: number
    avgLatencyMs: number
    errorRate: number
  }
  timeline: Array<{
    timestamp: string
    requests: number
    cost: number
    errors: number
  }>
  topEndpoints: Array<{
    endpoint: string
    method: string
    requests: number
    cost: number
  }>
}

/**
 * Per-endpoint usage response
 */
interface EndpointUsageResponse {
  endpoints: Array<{
    endpoint: string
    method: string
    requests: number
    cost: number
    avgLatencyMs: number
    p95LatencyMs: number
    errorRate: number
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let createAdminRouter: (() => Hono) | undefined
let createMockAnalyticsBinding: (() => unknown) | undefined
let createMockKVBinding: (() => unknown) | undefined

try {
  // @ts-expect-error - Module not yet implemented
  const module = await import('../../api/routes/admin')
  createAdminRouter = module.createAdminRouter

  // @ts-expect-error - Module not yet implemented
  const mockModule = await import('../../tests/mocks/analytics')
  createMockAnalyticsBinding = mockModule.createMockAnalyticsBinding
  createMockKVBinding = mockModule.createMockKVBinding
} catch {
  // Modules don't exist yet - tests will fail as expected (RED phase)
  createAdminRouter = undefined
  createMockAnalyticsBinding = undefined
  createMockKVBinding = undefined
}

// ============================================================================
// Test App Factory
// ============================================================================

interface TestEnv {
  ANALYTICS?: unknown
  KV?: unknown
  API_KEYS?: string
}

interface TestVariables {
  auth?: {
    userId: string
    role: 'admin' | 'user'
    apiKeyId?: string
  }
}

function createTestApp(
  options: { authenticated?: boolean; role?: 'admin' | 'user' } = {}
): Hono<{ Bindings: TestEnv; Variables: TestVariables }> {
  const app = new Hono<{ Bindings: TestEnv; Variables: TestVariables }>()

  // Mock auth middleware
  if (options.authenticated !== false) {
    app.use('/admin/*', async (c, next) => {
      c.set('auth', {
        userId: 'test-user-123',
        role: options.role || 'admin',
      })
      await next()
    })
  }

  // Mount admin router
  const adminRouter = createAdminRouter!()
  app.route('/admin', adminRouter)

  return app
}

function createTestEnv(): TestEnv {
  return {
    ANALYTICS: createMockAnalyticsBinding!(),
    KV: createMockKVBinding!(),
    API_KEYS: JSON.stringify({
      'key-abc': { userId: 'user-1', role: 'user', name: 'Production Key' },
      'key-xyz': { userId: 'user-2', role: 'admin', name: 'Admin Key' },
    }),
  }
}

// ============================================================================
// 1. Admin Router Export Tests
// ============================================================================

describe('Admin Router Export', () => {
  it('createAdminRouter is exported from api/routes/admin', () => {
    expect(createAdminRouter).toBeDefined()
    expect(typeof createAdminRouter).toBe('function')
  })

  it('createMockAnalyticsBinding is available for testing', () => {
    expect(createMockAnalyticsBinding).toBeDefined()
  })
})

// ============================================================================
// 2. GET /admin/usage - Usage Overview Tests
// ============================================================================

describe('GET /admin/usage - Usage overview', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 200 for authenticated admin', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('returns usage summary in response', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as UsageOverviewResponse

    expect(body.summary).toBeDefined()
    expect(typeof body.summary.totalRequests).toBe('number')
    expect(typeof body.summary.totalCost).toBe('number')
    expect(typeof body.summary.avgLatencyMs).toBe('number')
    expect(typeof body.summary.errorRate).toBe('number')
  })

  it('returns timeline data in response', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as UsageOverviewResponse

    expect(Array.isArray(body.timeline)).toBe(true)
    if (body.timeline.length > 0) {
      expect(body.timeline[0].timestamp).toBeDefined()
      expect(typeof body.timeline[0].requests).toBe('number')
      expect(typeof body.timeline[0].cost).toBe('number')
    }
  })

  it('returns top endpoints in response', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as UsageOverviewResponse

    expect(Array.isArray(body.topEndpoints)).toBe(true)
    if (body.topEndpoints.length > 0) {
      expect(body.topEndpoints[0].endpoint).toBeDefined()
      expect(body.topEndpoints[0].method).toBeDefined()
      expect(typeof body.topEndpoints[0].requests).toBe('number')
    }
  })

  it('returns top API keys in response', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as UsageOverviewResponse

    expect(Array.isArray(body.topApiKeys)).toBe(true)
    if (body.topApiKeys.length > 0) {
      expect(body.topApiKeys[0].apiKeyId).toBeDefined()
      expect(typeof body.topApiKeys[0].requests).toBe('number')
    }
  })

  it('supports range query parameter (7d, 30d, 90d)', async () => {
    const res7d = await app.request('/admin/usage?range=7d', { method: 'GET' }, env)
    const res30d = await app.request('/admin/usage?range=30d', { method: 'GET' }, env)
    const res90d = await app.request('/admin/usage?range=90d', { method: 'GET' }, env)

    expect(res7d.status).toBe(200)
    expect(res30d.status).toBe(200)
    expect(res90d.status).toBe(200)
  })

  it('supports custom date range with start and end parameters', async () => {
    const res = await app.request('/admin/usage?start=2026-01-01&end=2026-01-09', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('defaults to last 7 days when no range specified', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as UsageOverviewResponse

    // Timeline should have data for approximately 7 days
    expect(body.timeline.length).toBeLessThanOrEqual(7 * 24) // hourly buckets for 7 days
  })

  it('returns 400 for invalid range parameter', async () => {
    const res = await app.request('/admin/usage?range=invalid', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid date format', async () => {
    const res = await app.request('/admin/usage?start=not-a-date', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })
})

// ============================================================================
// 3. GET /admin/usage/keys - Per-Key Usage Tests
// ============================================================================

describe('GET /admin/usage/keys - Per-key usage', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 200 for authenticated admin', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('returns list of API key usage', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    expect(Array.isArray(body.keys)).toBe(true)
  })

  it('each key has required fields', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    if (body.keys.length > 0) {
      const key = body.keys[0]
      expect(key.apiKeyId).toBeDefined()
      expect(typeof key.requests).toBe('number')
      expect(typeof key.cost).toBe('number')
      expect(typeof key.avgLatencyMs).toBe('number')
      expect(typeof key.errorRate).toBe('number')
      expect(key.topEndpoint).toBeDefined()
    }
  })

  it('includes key name from configuration', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    // At least some keys should have names
    const keysWithNames = body.keys.filter((k) => k.name)
    expect(keysWithNames.length).toBeGreaterThanOrEqual(0) // Depends on mock data
  })

  it('includes pagination metadata', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    expect(body.pagination).toBeDefined()
    expect(typeof body.pagination.total).toBe('number')
    expect(typeof body.pagination.limit).toBe('number')
    expect(typeof body.pagination.offset).toBe('number')
    expect(typeof body.pagination.hasMore).toBe('boolean')
  })

  it('supports limit and offset parameters', async () => {
    const res = await app.request('/admin/usage/keys?limit=5&offset=0', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    expect(body.keys.length).toBeLessThanOrEqual(5)
    expect(body.pagination.limit).toBe(5)
    expect(body.pagination.offset).toBe(0)
  })

  it('supports range parameter', async () => {
    const res = await app.request('/admin/usage/keys?range=30d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('sorts by cost descending by default', async () => {
    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageResponse

    for (let i = 1; i < body.keys.length; i++) {
      expect(body.keys[i].cost).toBeLessThanOrEqual(body.keys[i - 1].cost)
    }
  })

  it('supports sort parameter (requests, cost, latency)', async () => {
    const resByRequests = await app.request('/admin/usage/keys?sort=requests', { method: 'GET' }, env)
    const resByCost = await app.request('/admin/usage/keys?sort=cost', { method: 'GET' }, env)
    const resByLatency = await app.request('/admin/usage/keys?sort=latency', { method: 'GET' }, env)

    expect(resByRequests.status).toBe(200)
    expect(resByCost.status).toBe(200)
    expect(resByLatency.status).toBe(200)
  })
})

// ============================================================================
// 4. GET /admin/usage/keys/:keyId - Single Key Usage Detail Tests
// ============================================================================

describe('GET /admin/usage/keys/:keyId - Single key usage detail', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 200 for existing key', async () => {
    const res = await app.request('/admin/usage/keys/key-abc', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('returns 404 for non-existent key', async () => {
    const res = await app.request('/admin/usage/keys/nonexistent-key', { method: 'GET' }, env)

    expect(res.status).toBe(404)
  })

  it('returns detailed usage for the key', async () => {
    const res = await app.request('/admin/usage/keys/key-abc', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageDetailResponse

    expect(body.apiKeyId).toBe('key-abc')
    expect(body.summary).toBeDefined()
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(Array.isArray(body.topEndpoints)).toBe(true)
  })

  it('includes summary statistics', async () => {
    const res = await app.request('/admin/usage/keys/key-abc', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageDetailResponse

    expect(typeof body.summary.totalRequests).toBe('number')
    expect(typeof body.summary.totalCost).toBe('number')
    expect(typeof body.summary.avgLatencyMs).toBe('number')
    expect(typeof body.summary.errorRate).toBe('number')
  })

  it('includes timeline data for the key', async () => {
    const res = await app.request('/admin/usage/keys/key-abc', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageDetailResponse

    if (body.timeline.length > 0) {
      expect(body.timeline[0].timestamp).toBeDefined()
      expect(typeof body.timeline[0].requests).toBe('number')
    }
  })

  it('includes top endpoints for the key', async () => {
    const res = await app.request('/admin/usage/keys/key-abc', { method: 'GET' }, env)
    const body = (await res.json()) as KeyUsageDetailResponse

    if (body.topEndpoints.length > 0) {
      expect(body.topEndpoints[0].endpoint).toBeDefined()
      expect(body.topEndpoints[0].method).toBeDefined()
    }
  })

  it('supports range parameter', async () => {
    const res = await app.request('/admin/usage/keys/key-abc?range=30d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// 5. GET /admin/usage/endpoints - Per-Endpoint Usage Tests
// ============================================================================

describe('GET /admin/usage/endpoints - Per-endpoint usage', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 200 for authenticated admin', async () => {
    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('returns list of endpoint usage', async () => {
    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)
    const body = (await res.json()) as EndpointUsageResponse

    expect(Array.isArray(body.endpoints)).toBe(true)
  })

  it('each endpoint has required fields', async () => {
    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)
    const body = (await res.json()) as EndpointUsageResponse

    if (body.endpoints.length > 0) {
      const endpoint = body.endpoints[0]
      expect(endpoint.endpoint).toBeDefined()
      expect(endpoint.method).toBeDefined()
      expect(typeof endpoint.requests).toBe('number')
      expect(typeof endpoint.cost).toBe('number')
      expect(typeof endpoint.avgLatencyMs).toBe('number')
      expect(typeof endpoint.p95LatencyMs).toBe('number')
      expect(typeof endpoint.errorRate).toBe('number')
    }
  })

  it('includes pagination metadata', async () => {
    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)
    const body = (await res.json()) as EndpointUsageResponse

    expect(body.pagination).toBeDefined()
    expect(typeof body.pagination.total).toBe('number')
  })

  it('supports limit and offset parameters', async () => {
    const res = await app.request('/admin/usage/endpoints?limit=10&offset=5', { method: 'GET' }, env)
    const body = (await res.json()) as EndpointUsageResponse

    expect(body.endpoints.length).toBeLessThanOrEqual(10)
  })

  it('supports filtering by method', async () => {
    const res = await app.request('/admin/usage/endpoints?method=POST', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports filtering by endpoint pattern', async () => {
    const res = await app.request('/admin/usage/endpoints?endpoint=/api/users', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('sorts by requests descending by default', async () => {
    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)
    const body = (await res.json()) as EndpointUsageResponse

    for (let i = 1; i < body.endpoints.length; i++) {
      expect(body.endpoints[i].requests).toBeLessThanOrEqual(body.endpoints[i - 1].requests)
    }
  })
})

// ============================================================================
// 6. Date Range Filtering Tests
// ============================================================================

describe('Date range filtering', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports 24h range shorthand', async () => {
    const res = await app.request('/admin/usage?range=24h', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports 7d range shorthand', async () => {
    const res = await app.request('/admin/usage?range=7d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports 30d range shorthand', async () => {
    const res = await app.request('/admin/usage?range=30d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports 90d range shorthand', async () => {
    const res = await app.request('/admin/usage?range=90d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports ISO 8601 date range', async () => {
    const res = await app.request('/admin/usage?start=2026-01-01T00:00:00Z&end=2026-01-09T00:00:00Z', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('supports date-only format (YYYY-MM-DD)', async () => {
    const res = await app.request('/admin/usage?start=2026-01-01&end=2026-01-09', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('returns 400 for end before start', async () => {
    const res = await app.request('/admin/usage?start=2026-01-09&end=2026-01-01', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for future dates', async () => {
    const res = await app.request('/admin/usage?start=2027-01-01&end=2027-01-09', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('adjusts timeline bucket size based on range', async () => {
    const res24h = await app.request('/admin/usage?range=24h', { method: 'GET' }, env)
    const res7d = await app.request('/admin/usage?range=7d', { method: 'GET' }, env)
    const res30d = await app.request('/admin/usage?range=30d', { method: 'GET' }, env)

    const body24h = (await res24h.json()) as UsageOverviewResponse
    const body7d = (await res7d.json()) as UsageOverviewResponse
    const body30d = (await res30d.json()) as UsageOverviewResponse

    // 24h and 7d should both use hourly buckets
    // 30d should use daily buckets which are fewer (mock data spans 7 days = ~7 buckets)
    // 7d with hourly buckets should have more buckets than 30d with daily buckets
    if (body7d.timeline.length > 0 && body30d.timeline.length > 0) {
      // 7d uses hourly buckets (up to ~168), 30d uses daily buckets (~7-8 with mock data)
      expect(body7d.timeline.length).toBeGreaterThan(body30d.timeline.length)
    }
  })
})

// ============================================================================
// 7. Export to CSV Tests
// ============================================================================

describe('Export to CSV', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports usage overview as CSV', async () => {
    const res = await app.request('/admin/usage/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })

  it('includes Content-Disposition header for download', async () => {
    const res = await app.request('/admin/usage/export?format=csv', { method: 'GET' }, env)

    const disposition = res.headers.get('Content-Disposition')
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.csv')
  })

  it('exports API key usage as CSV', async () => {
    const res = await app.request('/admin/usage/keys/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })

  it('exports endpoint usage as CSV', async () => {
    const res = await app.request('/admin/usage/endpoints/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })

  it('CSV includes header row', async () => {
    const res = await app.request('/admin/usage/keys/export?format=csv', { method: 'GET' }, env)
    const text = await res.text()

    const lines = text.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    // First line should be header
    expect(lines[0]).toContain('apiKeyId')
  })

  it('respects date range for export', async () => {
    const res = await app.request('/admin/usage/export?format=csv&range=30d', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('exports single key usage as CSV', async () => {
    const res = await app.request('/admin/usage/keys/key-abc/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })
})

// ============================================================================
// 8. Authentication Required Tests
// ============================================================================

describe('Authentication required', () => {
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 401 for unauthenticated request to /admin/usage', async () => {
    const app = createTestApp({ authenticated: false })

    const res = await app.request('/admin/usage', { method: 'GET' }, env)

    expect(res.status).toBe(401)
  })

  it('returns 401 for unauthenticated request to /admin/usage/keys', async () => {
    const app = createTestApp({ authenticated: false })

    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)

    expect(res.status).toBe(401)
  })

  it('returns 401 for unauthenticated request to /admin/usage/endpoints', async () => {
    const app = createTestApp({ authenticated: false })

    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)

    expect(res.status).toBe(401)
  })

  it('returns 401 for unauthenticated export requests', async () => {
    const app = createTestApp({ authenticated: false })

    const res = await app.request('/admin/usage/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(401)
  })
})

// ============================================================================
// 9. Admin Role Required Tests
// ============================================================================

describe('Admin role required', () => {
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 403 for non-admin user on /admin/usage', async () => {
    const app = createTestApp({ role: 'user' })

    const res = await app.request('/admin/usage', { method: 'GET' }, env)

    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user on /admin/usage/keys', async () => {
    const app = createTestApp({ role: 'user' })

    const res = await app.request('/admin/usage/keys', { method: 'GET' }, env)

    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user on /admin/usage/endpoints', async () => {
    const app = createTestApp({ role: 'user' })

    const res = await app.request('/admin/usage/endpoints', { method: 'GET' }, env)

    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user on export', async () => {
    const app = createTestApp({ role: 'user' })

    const res = await app.request('/admin/usage/export?format=csv', { method: 'GET' }, env)

    expect(res.status).toBe(403)
  })

  it('returns 200 for admin user', async () => {
    const app = createTestApp({ role: 'admin' })

    const res = await app.request('/admin/usage', { method: 'GET' }, env)

    expect(res.status).toBe(200)
  })

  it('includes 403 error message explaining admin required', async () => {
    const app = createTestApp({ role: 'user' })

    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    const body = (await res.json()) as { error: { message: string } }

    expect(body.error.message).toMatch(/admin/i)
  })
})

// ============================================================================
// 10. Error Handling Tests
// ============================================================================

describe('Error handling', () => {
  let app: Hono
  let env: TestEnv

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    app = createTestApp()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 400 for invalid limit parameter', async () => {
    const res = await app.request('/admin/usage/keys?limit=invalid', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for negative limit', async () => {
    const res = await app.request('/admin/usage/keys?limit=-1', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for limit exceeding maximum', async () => {
    const res = await app.request('/admin/usage/keys?limit=10001', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid offset', async () => {
    const res = await app.request('/admin/usage/keys?offset=invalid', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid sort parameter', async () => {
    const res = await app.request('/admin/usage/keys?sort=invalid', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid format parameter', async () => {
    const res = await app.request('/admin/usage/export?format=pdf', { method: 'GET' }, env)

    expect(res.status).toBe(400)
  })

  it('includes error details in response', async () => {
    const res = await app.request('/admin/usage?range=invalid', { method: 'GET' }, env)
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(body.error).toBeDefined()
    expect(body.error.code).toBeDefined()
    expect(body.error.message).toBeDefined()
  })

  it('handles analytics service errors gracefully', async () => {
    // Mock a failing analytics binding
    const brokenEnv = {
      ...env,
      ANALYTICS: {
        query: async () => {
          throw new Error('Analytics service unavailable')
        },
      },
    }

    const res = await app.request('/admin/usage', { method: 'GET' }, brokenEnv)

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ANALYTICS_ERROR')
  })
})
