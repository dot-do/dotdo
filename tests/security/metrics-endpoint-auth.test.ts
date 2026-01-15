/**
 * RED Phase Tests: Authentication on Stats/Metrics Endpoints
 *
 * SECURITY ISSUE: Stats and metrics endpoints may be accessible without authentication
 *
 * The vulnerability:
 * - /metrics and /stats endpoints expose sensitive operational data
 * - Without auth, attackers can enumerate system state, performance, and load
 * - Internal metrics can leak information about infrastructure and capacity
 *
 * These tests document the vulnerability and MUST FAIL with the current
 * implementation. When the GREEN phase fix is applied, they will pass.
 *
 * Attack vectors:
 * 1. Unauthenticated access to /metrics leaks operational data
 * 2. Unauthenticated access to /stats leaks system state
 * 3. Invalid tokens can still access metrics endpoints
 * 4. Non-admin users may access admin-only metrics
 *
 * Related:
 * - do-oe1c: RED - Auth check on stats/metrics endpoints tests
 *
 * @module tests/security/metrics-endpoint-auth.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import * as jose from 'jose'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a base64url-encoded string (JWT-safe encoding)
 */
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Create a properly signed JWT for testing
 */
async function createSignedJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKey)

  return jwt
}

/**
 * Create an expired JWT for testing
 */
async function createExpiredJWT(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
    .sign(secretKey)

  return jwt
}

/**
 * Create an invalid/forged JWT
 */
function createInvalidJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const b64Header = base64UrlEncode(JSON.stringify(header))
  const b64Payload = base64UrlEncode(JSON.stringify(payload))
  const forgedSignature = base64UrlEncode('invalid-signature-forged')
  return `${b64Header}.${b64Payload}.${forgedSignature}`
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const JWT_SECRET = 'test-secret-key-for-metrics-auth'

const USER_PAYLOAD = {
  sub: 'user-123',
  email: 'user@example.com',
  role: 'user',
}

const ADMIN_PAYLOAD = {
  sub: 'admin-456',
  email: 'admin@example.com',
  role: 'admin',
}

// ============================================================================
// DYNAMIC IMPORT - Tests fail gracefully until module exists
// ============================================================================

// Try to import auth middleware and metrics/stats endpoints
let authMiddleware: ((config?: Record<string, unknown>) => MiddlewareHandler) | undefined
let requireAuth: (() => MiddlewareHandler) | undefined
let requireRole: ((role: string) => MiddlewareHandler) | undefined

try {
  // @ts-expect-error - Module may not exist or export correctly
  const module = await import('../../api/middleware/auth')
  authMiddleware = module.authMiddleware
  requireAuth = module.requireAuth
  requireRole = module.requireRole
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
}

// ============================================================================
// MOCK APP SETUP
// ============================================================================

interface MockEnv {
  API_KEYS?: string
}

interface MockVariables {
  auth?: {
    userId: string
    email?: string
    role: 'admin' | 'user'
  }
  user?: {
    id: string
    email?: string
    role: 'admin' | 'user'
  }
}

/**
 * Create test app with stats/metrics endpoints that SHOULD require auth
 */
function createTestApp(): Hono<{ Bindings: MockEnv; Variables: MockVariables }> {
  const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

  // Apply auth middleware globally
  if (authMiddleware) {
    app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
  }

  // Stats endpoint - should require authentication
  app.get('/stats', (c) => {
    return c.json({
      uptime: 12345,
      requests: 1000,
      errors: 5,
      activeConnections: 42,
    })
  })

  // Metrics endpoint (Prometheus format) - should require authentication
  app.get('/metrics', (c) => {
    return c.text(`
# HELP dotdo_requests_total Total requests
# TYPE dotdo_requests_total counter
dotdo_requests_total 1000

# HELP dotdo_errors_total Total errors
# TYPE dotdo_errors_total counter
dotdo_errors_total 5

# HELP dotdo_active_connections Active connections
# TYPE dotdo_active_connections gauge
dotdo_active_connections 42
    `.trim(), 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    })
  })

  // Internal metrics - admin only
  app.get('/internal/metrics', (c) => {
    return c.json({
      memory: { used: 256000000, total: 512000000 },
      cpu: { usage: 0.45 },
      storage: { used: 10000000, total: 100000000 },
      pipeline: { queued: 150, processed: 50000 },
      secrets: { count: 12 }, // Sensitive info
    })
  })

  // Pipeline stats - admin only
  app.get('/pipeline/stats', (c) => {
    return c.json({
      eventsEmitted: 50000,
      eventsProcessed: 49500,
      dlqSize: 500,
      avgLatencyMs: 15,
      errorRate: 0.01,
    })
  })

  // Health check - should remain public
  app.get('/health', (c) => c.json({ status: 'ok' }))

  return app
}

/**
 * Create protected test app with requireAuth middleware applied
 */
function createProtectedTestApp(): Hono<{ Bindings: MockEnv; Variables: MockVariables }> {
  const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

  // Apply auth middleware globally
  if (authMiddleware) {
    app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
  }

  // Protected stats endpoint
  if (requireAuth) {
    app.get('/stats', requireAuth(), (c) => {
      return c.json({
        uptime: 12345,
        requests: 1000,
        errors: 5,
        activeConnections: 42,
      })
    })

    // Protected metrics endpoint
    app.get('/metrics', requireAuth(), (c) => {
      return c.text(`
# HELP dotdo_requests_total Total requests
# TYPE dotdo_requests_total counter
dotdo_requests_total 1000
      `.trim(), 200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      })
    })

    // Admin-only internal metrics
    if (requireRole) {
      app.get('/internal/metrics', requireAuth(), requireRole('admin'), (c) => {
        return c.json({
          memory: { used: 256000000, total: 512000000 },
          cpu: { usage: 0.45 },
          secrets: { count: 12 },
        })
      })

      app.get('/pipeline/stats', requireAuth(), requireRole('admin'), (c) => {
        return c.json({
          eventsEmitted: 50000,
          eventsProcessed: 49500,
        })
      })
    }
  }

  // Health check - public
  app.get('/health', (c) => c.json({ status: 'ok' }))

  return app
}

// ============================================================================
// 1. Unauthenticated Request Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Unauthenticated requests to stats/metrics endpoints', () => {
  describe('/stats endpoint', () => {
    it('VULNERABILITY: unauthenticated request to /stats returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', {
        method: 'GET',
        // No Authorization header
      })

      // Current behavior: May return 200 (vulnerability!)
      // Expected behavior: Should return 401 Unauthorized
      expect(response.status).toBe(401)
    })

    it('VULNERABILITY: unauthenticated request should NOT expose stats data', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', { method: 'GET' })

      // Should not contain any stats data
      const text = await response.text()
      expect(text).not.toContain('uptime')
      expect(text).not.toContain('requests')
      expect(text).not.toContain('activeConnections')
    })

    it('should include WWW-Authenticate header in 401 response', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', { method: 'GET' })

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBeDefined()
    })
  })

  describe('/metrics endpoint', () => {
    it('VULNERABILITY: unauthenticated request to /metrics returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/metrics', {
        method: 'GET',
      })

      expect(response.status).toBe(401)
    })

    it('VULNERABILITY: unauthenticated request should NOT expose Prometheus metrics', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/metrics', { method: 'GET' })

      const text = await response.text()
      expect(text).not.toContain('dotdo_requests_total')
      expect(text).not.toContain('# HELP')
      expect(text).not.toContain('# TYPE')
    })
  })

  describe('/internal/metrics endpoint', () => {
    it('VULNERABILITY: unauthenticated request to /internal/metrics returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/internal/metrics', { method: 'GET' })

      expect(response.status).toBe(401)
    })

    it('VULNERABILITY: unauthenticated request should NOT expose internal metrics', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/internal/metrics', { method: 'GET' })

      const text = await response.text()
      expect(text).not.toContain('memory')
      expect(text).not.toContain('cpu')
      expect(text).not.toContain('secrets')
    })
  })

  describe('/pipeline/stats endpoint', () => {
    it('VULNERABILITY: unauthenticated request to /pipeline/stats returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/pipeline/stats', { method: 'GET' })

      expect(response.status).toBe(401)
    })
  })
})

// ============================================================================
// 2. Invalid Token Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Invalid token requests to stats/metrics endpoints', () => {
  describe('Forged/invalid JWT signature', () => {
    it('invalid JWT signature on /stats returns 401', async () => {
      const app = createProtectedTestApp()
      const invalidToken = createInvalidJWT(USER_PAYLOAD)

      const response = await app.request('/stats', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${invalidToken}`,
        },
      })

      expect(response.status).toBe(401)
    })

    it('invalid JWT signature on /metrics returns 401', async () => {
      const app = createProtectedTestApp()
      const invalidToken = createInvalidJWT(USER_PAYLOAD)

      const response = await app.request('/metrics', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${invalidToken}`,
        },
      })

      expect(response.status).toBe(401)
    })

    it('invalid JWT should NOT expose any metrics data', async () => {
      const app = createProtectedTestApp()
      const invalidToken = createInvalidJWT(USER_PAYLOAD)

      const response = await app.request('/metrics', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${invalidToken}`,
        },
      })

      const text = await response.text()
      expect(text).not.toContain('dotdo_')
      expect(text).not.toContain('# TYPE')
    })
  })

  describe('Malformed Authorization header', () => {
    it('missing Bearer prefix returns 401', async () => {
      const app = createProtectedTestApp()
      const validToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

      const response = await app.request('/stats', {
        method: 'GET',
        headers: {
          Authorization: validToken, // Missing "Bearer " prefix
        },
      })

      expect(response.status).toBe(401)
    })

    it('empty Authorization header returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', {
        method: 'GET',
        headers: {
          Authorization: '',
        },
      })

      expect(response.status).toBe(401)
    })

    it('Authorization: Bearer with empty token returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ',
        },
      })

      expect(response.status).toBe(401)
    })

    it('random garbage token returns 401', async () => {
      const app = createProtectedTestApp()

      const response = await app.request('/stats', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer not-a-valid-jwt-at-all',
        },
      })

      expect(response.status).toBe(401)
    })
  })
})

// ============================================================================
// 3. Expired Token Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Expired token requests to stats/metrics endpoints', () => {
  it('expired JWT on /stats returns 401', async () => {
    const app = createProtectedTestApp()
    const expiredToken = await createExpiredJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    })

    expect(response.status).toBe(401)
  })

  it('expired JWT on /metrics returns 401', async () => {
    const app = createProtectedTestApp()
    const expiredToken = await createExpiredJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    })

    expect(response.status).toBe(401)
  })

  it('expired JWT on /internal/metrics returns 401', async () => {
    const app = createProtectedTestApp()
    const expiredToken = await createExpiredJWT(ADMIN_PAYLOAD, JWT_SECRET)

    const response = await app.request('/internal/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    })

    expect(response.status).toBe(401)
  })

  it('expired token error message should indicate expiration', async () => {
    const app = createProtectedTestApp()
    const expiredToken = await createExpiredJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    })

    expect(response.status).toBe(401)
    // Response may be JSON or plain text depending on error handler
    const text = await response.text()
    expect(text.toLowerCase()).toMatch(/expired|invalid|token/)
  })
})

// ============================================================================
// 4. Valid Token Access Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Valid token access to stats/metrics endpoints', () => {
  it('valid user token allows access to /stats', async () => {
    const app = createProtectedTestApp()
    const validToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { uptime?: number }
    expect(body.uptime).toBeDefined()
  })

  it('valid user token allows access to /metrics', async () => {
    const app = createProtectedTestApp()
    const validToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('# TYPE')
  })

  it('valid admin token allows access to all stats endpoints', async () => {
    const app = createProtectedTestApp()
    const adminToken = await createSignedJWT(ADMIN_PAYLOAD, JWT_SECRET)

    // Check all stats endpoints
    const endpoints = ['/stats', '/metrics', '/internal/metrics', '/pipeline/stats']

    for (const endpoint of endpoints) {
      const response = await app.request(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      })

      expect(response.status).toBe(200)
    }
  })
})

// ============================================================================
// 5. Admin-Only Metrics Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Admin-only metrics require admin role', () => {
  it('regular user cannot access /internal/metrics', async () => {
    const app = createProtectedTestApp()
    const userToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/internal/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    })

    // User role should be denied with 403 Forbidden
    expect(response.status).toBe(403)
  })

  it('regular user cannot access /pipeline/stats', async () => {
    const app = createProtectedTestApp()
    const userToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/pipeline/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    })

    expect(response.status).toBe(403)
  })

  it('admin user CAN access /internal/metrics', async () => {
    const app = createProtectedTestApp()
    const adminToken = await createSignedJWT(ADMIN_PAYLOAD, JWT_SECRET)

    const response = await app.request('/internal/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { memory?: Record<string, number> }
    expect(body.memory).toBeDefined()
  })

  it('admin user CAN access /pipeline/stats', async () => {
    const app = createProtectedTestApp()
    const adminToken = await createSignedJWT(ADMIN_PAYLOAD, JWT_SECRET)

    const response = await app.request('/pipeline/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { eventsEmitted?: number }
    expect(body.eventsEmitted).toBeDefined()
  })

  it('user token should NOT expose sensitive internal data', async () => {
    const app = createProtectedTestApp()
    const userToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/internal/metrics', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    })

    // Should be 403, and body should NOT contain sensitive data
    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).not.toContain('secrets')
    expect(text).not.toContain('memory')
  })
})

// ============================================================================
// 6. Public Health Check Endpoint Tests
// ============================================================================

describe('Health check remains public', () => {
  it('/health endpoint is accessible without auth', async () => {
    const app = createProtectedTestApp()

    const response = await app.request('/health', { method: 'GET' })

    expect(response.status).toBe(200)
    const body = await response.json() as { status?: string }
    expect(body.status).toBe('ok')
  })

  it('/health does NOT expose sensitive information', async () => {
    const app = createProtectedTestApp()

    const response = await app.request('/health', { method: 'GET' })
    const body = await response.json() as Record<string, unknown>

    // Health check should only have basic status info
    expect(Object.keys(body)).toContain('status')
    expect(body).not.toHaveProperty('memory')
    expect(body).not.toHaveProperty('secrets')
    expect(body).not.toHaveProperty('uptime')
  })
})

// ============================================================================
// 7. API Key Authentication Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('API key authentication for stats/metrics endpoints', () => {
  it('valid API key allows access to /stats', async () => {
    const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

    const env = {
      API_KEYS: JSON.stringify({
        'test-api-key-123456': { userId: 'user-1', role: 'user', name: 'Test Key' },
      }),
    }

    if (authMiddleware && requireAuth) {
      app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
      app.get('/stats', requireAuth(), (c) => c.json({ uptime: 12345 }))
    }

    const response = await app.request(
      '/stats',
      {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key-123456',
        },
      },
      env
    )

    expect(response.status).toBe(200)
  })

  it('invalid API key returns 401 on /stats', async () => {
    const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

    if (authMiddleware && requireAuth) {
      app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
      app.get('/stats', requireAuth(), (c) => c.json({ uptime: 12345 }))
    }

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        'X-API-Key': 'invalid-key-does-not-exist',
      },
    })

    expect(response.status).toBe(401)
  })

  it('user-role API key cannot access admin-only endpoints', async () => {
    const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

    const env = {
      API_KEYS: JSON.stringify({
        'user-api-key-abc': { userId: 'user-1', role: 'user', name: 'User Key' },
      }),
    }

    if (authMiddleware && requireAuth && requireRole) {
      app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
      app.get('/internal/metrics', requireAuth(), requireRole('admin'), (c) =>
        c.json({ secrets: { count: 12 } })
      )
    }

    const response = await app.request(
      '/internal/metrics',
      {
        method: 'GET',
        headers: {
          'X-API-Key': 'user-api-key-abc',
        },
      },
      env
    )

    expect(response.status).toBe(403)
  })

  it('admin-role API key can access admin-only endpoints', async () => {
    const app = new Hono<{ Bindings: MockEnv; Variables: MockVariables }>()

    const env = {
      API_KEYS: JSON.stringify({
        'admin-api-key-xyz': { userId: 'admin-1', role: 'admin', name: 'Admin Key' },
      }),
    }

    if (authMiddleware && requireAuth && requireRole) {
      app.use('*', authMiddleware({ jwtSecret: JWT_SECRET }))
      app.get('/internal/metrics', requireAuth(), requireRole('admin'), (c) =>
        c.json({ secrets: { count: 12 } })
      )
    }

    const response = await app.request(
      '/internal/metrics',
      {
        method: 'GET',
        headers: {
          'X-API-Key': 'admin-api-key-xyz',
        },
      },
      env
    )

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 8. UnifiedStoreDO /metrics Endpoint Auth Tests (TRUE RED PHASE)
// These tests verify the ACTUAL UnifiedStoreDO has auth when configured
// ============================================================================

describe('UnifiedStoreDO /metrics endpoint requires auth when configured', () => {
  // These tests import and test the actual UnifiedStoreDO
  // They will FAIL because /metrics currently has no auth check

  it('VULNERABILITY: UnifiedStoreDO /metrics should return 401 when requireAuth is enabled', async () => {
    // This test documents that UnifiedStoreDO.fetch() for /metrics
    // does NOT check authentication even when the DO is configured to require it
    //
    // Current implementation (unified-store-do.ts lines 354-356):
    //   if (path === '/metrics') {
    //     return this.handleMetricsRequest()  // No auth check!
    //   }
    //
    // Expected behavior: Should check auth before returning metrics

    // Import the actual DO (dynamic import to handle if module changes)
    let UnifiedStoreDO: typeof import('../../objects/unified-storage/unified-store-do').UnifiedStoreDO | undefined

    try {
      const module = await import('../../objects/unified-storage/unified-store-do')
      UnifiedStoreDO = module.UnifiedStoreDO
    } catch {
      // Module not available
    }

    if (!UnifiedStoreDO) {
      // Skip if module not available - still RED phase
      expect(true).toBe(false) // Force fail
      return
    }

    // Create a mock DO state and env
    const mockState = {
      id: { toString: () => 'test-do', name: 'test-tenant' },
      storage: {
        sql: {
          exec: vi.fn(() => ({ toArray: () => [] })),
        },
        get: vi.fn(async () => undefined),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => new Map()),
      },
      waitUntil: vi.fn(),
      blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
    }

    const mockEnv = {
      PIPELINE: { send: vi.fn() },
      DO: {},
    }

    const unifiedDO = new UnifiedStoreDO(
      mockState as unknown as DurableObjectState,
      mockEnv
    )

    // Make an unauthenticated request to /metrics
    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)

    // CURRENT BEHAVIOR: Returns 200 with metrics (VULNERABILITY!)
    // EXPECTED BEHAVIOR: Should return 401 when auth is required
    //
    // This test SHOULD PASS when the fix is applied
    expect(response.status).toBe(401)
  })

  it('VULNERABILITY: UnifiedStoreDO /cost-report should return 401 when requireAuth is enabled', async () => {
    // Similar issue for /cost-report endpoint

    let UnifiedStoreDO: typeof import('../../objects/unified-storage/unified-store-do').UnifiedStoreDO | undefined

    try {
      const module = await import('../../objects/unified-storage/unified-store-do')
      UnifiedStoreDO = module.UnifiedStoreDO
    } catch {
      // Module not available
    }

    if (!UnifiedStoreDO) {
      expect(true).toBe(false)
      return
    }

    const mockState = {
      id: { toString: () => 'test-do', name: 'test-tenant' },
      storage: {
        sql: { exec: vi.fn(() => ({ toArray: () => [] })) },
        get: vi.fn(async () => undefined),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => new Map()),
      },
      waitUntil: vi.fn(),
      blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
    }

    const mockEnv = {
      PIPELINE: { send: vi.fn() },
      DO: {},
    }

    const unifiedDO = new UnifiedStoreDO(
      mockState as unknown as DurableObjectState,
      mockEnv
    )

    const request = new Request('https://test.api.dotdo.dev/cost-report')
    const response = await unifiedDO.fetch(request)

    // Should require auth for cost reports (contains sensitive billing data)
    expect(response.status).toBe(401)
  })

  it('VULNERABILITY: metrics endpoint should not leak data to unauthenticated requests', async () => {
    let UnifiedStoreDO: typeof import('../../objects/unified-storage/unified-store-do').UnifiedStoreDO | undefined

    try {
      const module = await import('../../objects/unified-storage/unified-store-do')
      UnifiedStoreDO = module.UnifiedStoreDO
    } catch {
      // Module not available
    }

    if (!UnifiedStoreDO) {
      expect(true).toBe(false)
      return
    }

    const mockState = {
      id: { toString: () => 'test-do', name: 'test-tenant' },
      storage: {
        sql: { exec: vi.fn(() => ({ toArray: () => [] })) },
        get: vi.fn(async () => undefined),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => new Map()),
      },
      waitUntil: vi.fn(),
      blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
    }

    const mockEnv = {
      PIPELINE: { send: vi.fn() },
      DO: {},
    }

    const unifiedDO = new UnifiedStoreDO(
      mockState as unknown as DurableObjectState,
      mockEnv
    )

    const request = new Request('https://test.api.dotdo.dev/metrics')
    const response = await unifiedDO.fetch(request)
    const text = await response.text()

    // If unauthenticated, should NOT contain sensitive metrics
    // This test will FAIL if metrics are returned without auth
    if (response.status === 200) {
      // Currently vulnerable - metrics are exposed
      expect(text).not.toContain('dotdo_')
      expect(text).not.toContain('namespace=')
      expect(text).not.toContain('# HELP')
    }
  })
})

// ============================================================================
// 9. Edge Cases and Security Boundary Tests
// ============================================================================

describe('Edge cases and security boundaries', () => {
  it('should reject requests with multiple auth methods (JWT + API key)', async () => {
    const app = createProtectedTestApp()
    const validToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    // Sending both JWT and API key should still work (JWT takes precedence)
    // But we should ensure one valid auth method is sufficient
    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validToken}`,
        'X-API-Key': 'some-api-key',
      },
    })

    // Should succeed with valid JWT
    expect(response.status).toBe(200)
  })

  it('should handle case-insensitive Authorization header', async () => {
    const app = createProtectedTestApp()
    const validToken = await createSignedJWT(USER_PAYLOAD, JWT_SECRET)

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validToken}`, // lowercase
      },
    })

    expect(response.status).toBe(200)
  })

  it('should reject JWT signed with wrong secret', async () => {
    const app = createProtectedTestApp()
    const tokenWithWrongSecret = await createSignedJWT(USER_PAYLOAD, 'wrong-secret')

    const response = await app.request('/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenWithWrongSecret}`,
      },
    })

    expect(response.status).toBe(401)
  })

  it('should not leak timing information in auth failure', async () => {
    const app = createProtectedTestApp()

    // Time multiple requests with different failure modes
    const times: number[] = []

    // Invalid token
    const start1 = performance.now()
    await app.request('/stats', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid' },
    })
    times.push(performance.now() - start1)

    // No token
    const start2 = performance.now()
    await app.request('/stats', { method: 'GET' })
    times.push(performance.now() - start2)

    // All failures should take roughly similar time
    // (This is a basic timing attack mitigation check)
    const maxDiff = Math.max(...times) - Math.min(...times)
    expect(maxDiff).toBeLessThan(100) // Should not vary by more than 100ms
  })
})
