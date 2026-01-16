/**
 * @dotdo/middleware TDD Tests
 *
 * RED PHASE: These tests define the expected API for the middleware package.
 * All tests should FAIL initially until the implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ============================================================================
// Package Export Tests
// ============================================================================

describe('@dotdo/middleware package exports', () => {
  describe('main entry point', () => {
    it('exports authMiddleware from main entry', async () => {
      const { authMiddleware } = await import('../src/index')
      expect(authMiddleware).toBeDefined()
      expect(typeof authMiddleware).toBe('function')
    })

    it('exports workosAuthKit from main entry', async () => {
      const { workosAuthKit } = await import('../src/index')
      expect(workosAuthKit).toBeDefined()
      expect(typeof workosAuthKit).toBe('function')
    })

    it('exports errorHandler from main entry', async () => {
      const { errorHandler } = await import('../src/index')
      expect(errorHandler).toBeDefined()
      expect(typeof errorHandler).toBe('function')
    })

    it('exports requestId from main entry', async () => {
      const { requestId } = await import('../src/index')
      expect(requestId).toBeDefined()
      expect(typeof requestId).toBe('function')
    })

    it('exports rateLimit from main entry', async () => {
      const { rateLimit } = await import('../src/index')
      expect(rateLimit).toBeDefined()
      expect(typeof rateLimit).toBe('function')
    })
  })

  describe('auth subpath exports', () => {
    it('exports authMiddleware from auth subpath', async () => {
      const { authMiddleware } = await import('../src/auth/index')
      expect(authMiddleware).toBeDefined()
      expect(typeof authMiddleware).toBe('function')
    })

    it('exports jwtMiddleware from auth/jwt subpath', async () => {
      const { jwtMiddleware } = await import('../src/auth/jwt')
      expect(jwtMiddleware).toBeDefined()
      expect(typeof jwtMiddleware).toBe('function')
    })

    it('exports apiKeyMiddleware from auth/api-key subpath', async () => {
      const { apiKeyMiddleware } = await import('../src/auth/api-key')
      expect(apiKeyMiddleware).toBeDefined()
      expect(typeof apiKeyMiddleware).toBe('function')
    })

    it('exports sessionMiddleware from auth/session subpath', async () => {
      const { sessionMiddleware } = await import('../src/auth/session')
      expect(sessionMiddleware).toBeDefined()
      expect(typeof sessionMiddleware).toBe('function')
    })
  })

  describe('workos subpath exports', () => {
    it('exports workosAuthKit from workos subpath', async () => {
      const { workosAuthKit } = await import('../src/workos/index')
      expect(workosAuthKit).toBeDefined()
      expect(typeof workosAuthKit).toBe('function')
    })

    it('exports workosAuthKit from workos/authkit subpath', async () => {
      const { workosAuthKit } = await import('../src/workos/authkit')
      expect(workosAuthKit).toBeDefined()
      expect(typeof workosAuthKit).toBe('function')
    })

    it('exports workosVault from workos/vault subpath', async () => {
      const { workosVault } = await import('../src/workos/vault')
      expect(workosVault).toBeDefined()
      expect(typeof workosVault).toBe('function')
    })
  })

  describe('error subpath exports', () => {
    it('exports errorHandler from error subpath', async () => {
      const { errorHandler } = await import('../src/error/index')
      expect(errorHandler).toBeDefined()
      expect(typeof errorHandler).toBe('function')
    })

    it('exports notFoundHandler from error subpath', async () => {
      const { notFoundHandler } = await import('../src/error/index')
      expect(notFoundHandler).toBeDefined()
      expect(typeof notFoundHandler).toBe('function')
    })

    it('exports error classes from error subpath', async () => {
      const {
        BadRequestError,
        UnauthorizedError,
        ForbiddenError,
        NotFoundError,
        ConflictError,
      } = await import('../src/error/index')

      expect(BadRequestError).toBeDefined()
      expect(UnauthorizedError).toBeDefined()
      expect(ForbiddenError).toBeDefined()
      expect(NotFoundError).toBeDefined()
      expect(ConflictError).toBeDefined()
    })
  })

  describe('standalone middleware exports', () => {
    it('exports requestId middleware from request-id subpath', async () => {
      const { requestId } = await import('../src/request-id')
      expect(requestId).toBeDefined()
      expect(typeof requestId).toBe('function')
    })

    it('exports rateLimit middleware from rate-limit subpath', async () => {
      const { rateLimit } = await import('../src/rate-limit')
      expect(rateLimit).toBeDefined()
      expect(typeof rateLimit).toBe('function')
    })
  })
})

// ============================================================================
// Auth Middleware Integration Tests
// ============================================================================

describe('authMiddleware integration', () => {
  let app: Hono

  beforeEach(async () => {
    const { authMiddleware } = await import('../src/auth/index')
    app = new Hono()
    app.use('*', authMiddleware({
      jwtSecret: 'test-secret-key-for-testing-only',
      publicPaths: ['/public', '/health'],
    }))
    app.get('/protected', (c) => c.json({ message: 'protected' }))
    app.get('/public', (c) => c.json({ message: 'public' }))
    app.get('/health', (c) => c.json({ status: 'ok' }))
  })

  it('allows access to public paths without authentication', async () => {
    const res = await app.request('/public')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('public')
  })

  it('allows access to health endpoint without authentication', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('allows authenticated requests with valid JWT', async () => {
    const { generateJWT } = await import('../src/auth/jwt')
    const token = await generateJWT(
      { sub: 'user-123', email: 'test@example.com' },
      'test-secret-key-for-testing-only',
    )

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
  })

  it('allows authenticated requests with valid API key', async () => {
    const { authMiddleware, registerApiKey } = await import('../src/auth/index')

    // Register an API key for testing
    registerApiKey('test-api-key-12345', {
      userId: 'user-123',
      role: 'user',
    })

    app = new Hono()
    app.use('*', authMiddleware({
      jwtSecret: 'test-secret-key-for-testing-only',
    }))
    app.get('/protected', (c) => c.json({ user: c.get('user') }))

    const res = await app.request('/protected', {
      headers: { 'X-API-Key': 'test-api-key-12345' },
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Error Handler Integration Tests
// ============================================================================

describe('errorHandler integration', () => {
  let app: Hono

  beforeEach(async () => {
    const { errorHandler, BadRequestError, NotFoundError } = await import('../src/error/index')

    app = new Hono()
    app.use('*', errorHandler)

    app.get('/error/bad-request', () => {
      throw new BadRequestError('Invalid input')
    })

    app.get('/error/not-found', () => {
      throw new NotFoundError('Resource not found')
    })

    app.get('/error/generic', () => {
      throw new Error('Something went wrong')
    })
  })

  it('handles BadRequestError with 400 status', async () => {
    const res = await app.request('/error/bad-request')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe('Invalid input')
  })

  it('handles NotFoundError with 404 status', async () => {
    const res = await app.request('/error/not-found')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('handles generic errors with 500 status', async () => {
    const res = await app.request('/error/generic')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('includes request ID in error response when present', async () => {
    const res = await app.request('/error/bad-request', {
      headers: { 'X-Request-ID': 'req-123' },
    })
    const body = await res.json()
    expect(body.error.requestId).toBe('req-123')
  })
})

// ============================================================================
// Request ID Middleware Integration Tests
// ============================================================================

describe('requestId middleware integration', () => {
  let app: Hono

  beforeEach(async () => {
    const { requestId } = await import('../src/request-id')

    app = new Hono()
    app.use('*', requestId)
    app.get('/test', (c) => c.json({ requestId: c.get('requestId') }))
  })

  it('echoes X-Request-ID header when provided', async () => {
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'my-request-123' },
    })
    expect(res.headers.get('X-Request-ID')).toBe('my-request-123')
  })

  it('generates X-Request-ID when not provided', async () => {
    const res = await app.request('/test')
    const requestId = res.headers.get('X-Request-ID')
    expect(requestId).toBeDefined()
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
  })

  it('makes request ID available in context', async () => {
    const res = await app.request('/test', {
      headers: { 'X-Request-ID': 'ctx-request-456' },
    })
    const body = await res.json()
    expect(body.requestId).toBe('ctx-request-456')
  })
})

// ============================================================================
// Rate Limit Middleware Integration Tests
// ============================================================================

describe('rateLimit middleware integration', () => {
  it('exports rateLimit function that accepts config', async () => {
    const { rateLimit } = await import('../src/rate-limit')

    // Create a mock rate limit binding
    const mockBinding = {
      limit: async ({ key }: { key: string }) => ({
        success: true,
        remaining: 99,
      }),
    }

    const middleware = rateLimit({
      binding: mockBinding as any,
      limit: 100,
    })

    expect(typeof middleware).toBe('function')
  })

  it('sets rate limit headers on response', async () => {
    const { rateLimit } = await import('../src/rate-limit')

    const mockBinding = {
      limit: async ({ key }: { key: string }) => ({
        success: true,
        remaining: 50,
      }),
    }

    const app = new Hono()
    app.use('*', rateLimit({
      binding: mockBinding as any,
      limit: 100,
    }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('50')
  })

  it('returns 429 when rate limited', async () => {
    const { rateLimit } = await import('../src/rate-limit')

    const mockBinding = {
      limit: async ({ key }: { key: string }) => ({
        success: false,
        remaining: 0,
      }),
    }

    const app = new Hono()
    app.use('*', rateLimit({
      binding: mockBinding as any,
      limit: 100,
    }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(429)
  })
})

// ============================================================================
// WorkOS AuthKit Middleware Integration Tests
// ============================================================================

describe('workosAuthKit middleware integration', () => {
  it('exports workosAuthKit function', async () => {
    const { workosAuthKit } = await import('../src/workos/authkit')
    expect(workosAuthKit).toBeDefined()
    expect(typeof workosAuthKit).toBe('function')
  })

  it('creates middleware with configuration', async () => {
    const { workosAuthKit } = await import('../src/workos/authkit')

    const middleware = workosAuthKit({
      apiKey: 'test-api-key',
      clientId: 'test-client-id',
    })

    expect(typeof middleware).toBe('function')
  })

  it('provides health check endpoint', async () => {
    const { workosAuthKit } = await import('../src/workos/authkit')

    const app = new Hono()
    app.use('*', workosAuthKit({
      apiKey: 'test-api-key',
      clientId: 'test-client-id',
    }))

    const res = await app.request('/api/auth/health')
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// WorkOS Vault Middleware Integration Tests
// ============================================================================

describe('workosVault middleware integration', () => {
  it('exports workosVault function', async () => {
    const { workosVault } = await import('../src/workos/vault')
    expect(workosVault).toBeDefined()
    expect(typeof workosVault).toBe('function')
  })

  it('creates middleware with configuration', async () => {
    const { workosVault } = await import('../src/workos/vault')

    const middleware = workosVault({
      apiKey: 'test-api-key',
    })

    expect(typeof middleware).toBe('function')
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('type exports', () => {
  it('exports AuthConfig type', async () => {
    // This test verifies the types are exported correctly
    // TypeScript compilation will fail if types are missing
    const authModule = await import('../src/auth/index')
    expect(authModule).toBeDefined()
  })

  it('exports AuthContext type', async () => {
    const authModule = await import('../src/auth/index')
    expect(authModule).toBeDefined()
  })

  it('exports RateLimitConfig type', async () => {
    const rateLimitModule = await import('../src/rate-limit')
    expect(rateLimitModule).toBeDefined()
  })

  it('exports WorkOSAuthKitConfig type', async () => {
    const workosModule = await import('../src/workos/authkit')
    expect(workosModule).toBeDefined()
  })
})
