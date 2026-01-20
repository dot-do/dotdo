/**
 * Tests for DO-level Authentication Guards
 *
 * Tests the trust boundaries for:
 * - Worker-to-DO calls (internal trust)
 * - User-to-DO calls (JWT validation)
 * - DO-to-DO calls (internal trust with DO ID verification)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  detectCallerType,
  extractCallerInfo,
  createDOAuthGuard,
  doAuthMiddleware,
  requireWorkerCaller,
  requireDOCaller,
  requireUserCaller,
  requireInternalCaller,
  requireDOSource,
  addDOSourceHeaders,
  createDOToDoHeaders,
  addWorkerHeaders,
  CF_WORKER_HEADER,
  WORKER_NAME_HEADER,
  DO_SOURCE_HEADER,
  DO_SOURCE_ID_HEADER,
  CORRELATION_ID_HEADER,
  type CallerType,
  type DOAuthGuard,
} from '../auth'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a base64-encoded JWT-like token (for testing without jose)
 */
function createTestToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const signature = btoa('fake-signature')
  return `${header}.${body}.${signature}`
}

/**
 * Create a request with specific headers
 */
function createRequest(
  url: string,
  options: {
    headers?: Record<string, string>
    method?: string
  } = {}
): Request {
  return new Request(url, {
    method: options.method || 'GET',
    headers: options.headers,
  })
}

// ============================================================================
// Caller Detection Tests
// ============================================================================

describe('detectCallerType', () => {
  it('should detect DO-to-DO calls', () => {
    const request = createRequest('https://do/', {
      headers: { [DO_SOURCE_HEADER]: 'true' },
    })
    expect(detectCallerType(request)).toBe('do')
  })

  it('should detect Worker-to-DO calls via CF header', () => {
    const request = createRequest('https://do/', {
      headers: { [CF_WORKER_HEADER]: 'my-worker' },
    })
    expect(detectCallerType(request)).toBe('worker')
  })

  it('should detect Worker-to-DO calls via custom header', () => {
    const request = createRequest('https://do/', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })
    expect(detectCallerType(request)).toBe('worker')
  })

  it('should detect User-to-DO calls', () => {
    const request = createRequest('https://do/', {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(detectCallerType(request)).toBe('user')
  })

  it('should return unknown for unidentified callers', () => {
    const request = createRequest('https://do/')
    expect(detectCallerType(request)).toBe('unknown')
  })

  it('should prioritize DO source over worker', () => {
    const request = createRequest('https://do/', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [WORKER_NAME_HEADER]: 'my-worker',
      },
    })
    expect(detectCallerType(request)).toBe('do')
  })

  it('should prioritize worker over user', () => {
    const request = createRequest('https://do/', {
      headers: {
        [WORKER_NAME_HEADER]: 'my-worker',
        Authorization: 'Bearer test-token',
      },
    })
    expect(detectCallerType(request)).toBe('worker')
  })
})

describe('extractCallerInfo', () => {
  it('should extract DO caller info', () => {
    const request = createRequest('https://do/', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'source-do-123',
      },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('do')
    expect(info.id).toBe('source-do-123')
    expect(info.sourceDoId).toBe('source-do-123')
    expect(info.trusted).toBe(true)
  })

  it('should extract worker caller info', () => {
    const request = createRequest('https://do/', {
      headers: { [WORKER_NAME_HEADER]: 'api-worker' },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('worker')
    expect(info.id).toBe('api-worker')
    expect(info.trusted).toBe(true)
  })

  it('should extract user caller info', () => {
    const request = createRequest('https://do/', {
      headers: { Authorization: 'Bearer test-token' },
    })

    const info = extractCallerInfo(request)
    expect(info.type).toBe('user')
    expect(info.id).toBeNull() // Will be populated after token validation
    expect(info.trusted).toBe(false)
  })

  it('should extract unknown caller info', () => {
    const request = createRequest('https://do/')

    const info = extractCallerInfo(request)
    expect(info.type).toBe('unknown')
    expect(info.id).toBeNull()
    expect(info.trusted).toBe(false)
  })
})

// ============================================================================
// DOAuthGuard Tests
// ============================================================================

describe('createDOAuthGuard', () => {
  let guard: DOAuthGuard

  beforeEach(() => {
    guard = createDOAuthGuard()
  })

  describe('canAccess', () => {
    it('should allow DO-to-DO calls by default', async () => {
      const request = createRequest('https://do/', {
        headers: { [DO_SOURCE_HEADER]: 'true' },
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should deny DO-to-DO calls when trustDoToDo is false', async () => {
      const strictGuard = createDOAuthGuard({ trustDoToDo: false })
      const request = createRequest('https://do/', {
        headers: { [DO_SOURCE_HEADER]: 'true' },
      })

      const result = await strictGuard.canAccess(request, 'target-do')
      expect(result).toBe(false)
    })

    it('should allow worker-to-DO calls by default', async () => {
      const request = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'my-worker' },
      })

      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should restrict worker-to-DO calls when trustedWorkers is set', async () => {
      const restrictedGuard = createDOAuthGuard({
        trustedWorkers: ['trusted-worker'],
      })

      const untrustedRequest = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'untrusted-worker' },
      })
      expect(await restrictedGuard.canAccess(untrustedRequest, 'target-do')).toBe(false)

      const trustedRequest = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'trusted-worker' },
      })
      expect(await restrictedGuard.canAccess(trustedRequest, 'target-do')).toBe(true)
    })

    it('should deny unknown callers by default', async () => {
      const request = createRequest('https://do/')
      const result = await guard.canAccess(request, 'target-do')
      expect(result).toBe(false)
    })

    it('should allow anonymous when allowAnonymous is true', async () => {
      const anonymousGuard = createDOAuthGuard({ allowAnonymous: true })
      const request = createRequest('https://do/')
      const result = await anonymousGuard.canAccess(request, 'target-do')
      expect(result).toBe(true)
    })

    it('should use custom trust check when provided', async () => {
      const customGuard = createDOAuthGuard({
        customTrustCheck: async (request, callerInfo) => {
          // Only allow specific DO
          return callerInfo.sourceDoId === 'allowed-do'
        },
      })

      const allowedRequest = createRequest('https://do/', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'allowed-do',
        },
      })
      expect(await customGuard.canAccess(allowedRequest, 'target-do')).toBe(true)

      const deniedRequest = createRequest('https://do/', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'denied-do',
        },
      })
      expect(await customGuard.canAccess(deniedRequest, 'target-do')).toBe(false)
    })
  })

  describe('getCallerId', () => {
    it('should get caller ID from DO source header', () => {
      const request = createRequest('https://do/', {
        headers: {
          [DO_SOURCE_HEADER]: 'true',
          [DO_SOURCE_ID_HEADER]: 'source-do-123',
        },
      })

      expect(guard.getCallerId(request)).toBe('source-do-123')
    })

    it('should get caller ID from worker name header', () => {
      const request = createRequest('https://do/', {
        headers: { [WORKER_NAME_HEADER]: 'my-worker' },
      })

      expect(guard.getCallerId(request)).toBe('my-worker')
    })

    it('should get caller ID from JWT token', () => {
      const token = createTestToken({ sub: 'user-123' })
      const request = createRequest('https://do/', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(guard.getCallerId(request)).toBe('user-123')
    })

    it('should return null for unknown caller', () => {
      const request = createRequest('https://do/')
      expect(guard.getCallerId(request)).toBeNull()
    })
  })

  describe('validateToken', () => {
    it('should decode token without verification when no secret configured', async () => {
      // Suppress console warning for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const token = createTestToken({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['user'],
      })

      const payload = await guard.validateToken(token)
      expect(payload).not.toBeNull()
      expect(payload?.sub).toBe('user-123')
      expect(payload?.email).toBe('test@example.com')

      warnSpy.mockRestore()
    })

    it('should return null for invalid token format', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const payload = await guard.validateToken('invalid-token')
      expect(payload).toBeNull()

      warnSpy.mockRestore()
    })
  })
})

// ============================================================================
// Hono Middleware Tests
// ============================================================================

describe('doAuthMiddleware', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
  })

  it('should set callerInfo in context', async () => {
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
    app.get('/test', (c) => {
      const callerInfo = c.get('callerInfo')
      return c.json({ type: callerInfo.type })
    })

    const request = createRequest('https://do/test', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.type).toBe('worker')
  })

  it('should skip auth for specified paths', async () => {
    app.use('/*', doAuthMiddleware({ skipPaths: ['/health', '/'] }))
    app.get('/', (c) => c.json({ status: 'root' }))
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.get('/other', (c) => c.json({ status: 'ok' }))

    // Health endpoint should be accessible without auth
    const healthResponse = await app.fetch(createRequest('https://do/health'))
    expect(healthResponse.status).toBe(200)

    // Root endpoint should also be skipped
    const rootResponse = await app.fetch(createRequest('https://do/'))
    expect(rootResponse.status).toBe(200)

    // Other endpoints should require auth
    const otherResponse = await app.fetch(createRequest('https://do/other'))
    expect(otherResponse.status).toBe(401)
  })

  it('should reject unauthenticated requests by default', async () => {
    app.use('/*', doAuthMiddleware({ skipPaths: [] }))
    app.get('/protected', (c) => c.json({ status: 'ok' }))

    const response = await app.fetch(createRequest('https://do/protected'))
    expect(response.status).toBe(401)
  })

  it('should allow worker requests', async () => {
    app.use('/*', doAuthMiddleware({ skipPaths: [] }))
    app.get('/protected', (c) => c.json({ status: 'ok' }))

    const request = createRequest('https://do/protected', {
      headers: { [WORKER_NAME_HEADER]: 'api-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should allow DO-to-DO requests', async () => {
    app.use('/*', doAuthMiddleware({ skipPaths: [] }))
    app.get('/protected', (c) => c.json({ status: 'ok' }))

    const request = createRequest('https://do/protected', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'source-do',
      },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should populate auth for user requests', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    app.use('/*', doAuthMiddleware({ skipPaths: [], allowAnonymous: false }))
    app.get('/user', (c) => {
      const callerInfo = c.get('callerInfo')
      return c.json({
        type: callerInfo.type,
        id: callerInfo.id,
        auth: callerInfo.auth,
      })
    })

    const token = createTestToken({ sub: 'user-456', email: 'test@example.com' })
    const request = createRequest('https://do/user', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.type).toBe('user')
    expect(data.id).toBe('user-456')
    expect(data.auth.email).toBe('test@example.com')

    warnSpy.mockRestore()
  })
})

// ============================================================================
// Specialized Guard Tests
// ============================================================================

describe('requireWorkerCaller', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
  })

  it('should allow worker callers', async () => {
    app.get('/internal', requireWorkerCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/internal', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should reject non-worker callers', async () => {
    app.get('/internal', requireWorkerCaller(), (c) => c.json({ ok: true }))

    const response = await app.fetch(createRequest('https://do/internal'))
    expect(response.status).toBe(403)
  })
})

describe('requireDOCaller', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
  })

  it('should allow DO callers', async () => {
    app.get('/do-only', requireDOCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/do-only', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'other-do',
      },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should reject non-DO callers', async () => {
    app.get('/do-only', requireDOCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/do-only', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(403)
  })
})

describe('requireUserCaller', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    // Suppress warnings for token validation
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should allow authenticated user callers', async () => {
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
    app.get('/user-only', requireUserCaller(), (c) => c.json({ ok: true }))

    const token = createTestToken({ sub: 'user-123' })
    const request = createRequest('https://do/user-only', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should reject non-user callers', async () => {
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
    app.get('/user-only', requireUserCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/user-only', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(403)
  })
})

describe('requireInternalCaller', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
  })

  it('should allow worker callers', async () => {
    app.get('/internal', requireInternalCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/internal', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should allow DO callers', async () => {
    app.get('/internal', requireInternalCaller(), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/internal', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'other-do',
      },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should reject user callers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    app.get('/internal', requireInternalCaller(), (c) => c.json({ ok: true }))

    const token = createTestToken({ sub: 'user-123' })
    const request = createRequest('https://do/internal', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(403)
  })
})

describe('requireDOSource', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    app.use('/*', doAuthMiddleware({ allowAnonymous: true }))
  })

  it('should allow specified DO sources', async () => {
    app.get('/restricted', requireDOSource('allowed-do-1', 'allowed-do-2'), (c) =>
      c.json({ ok: true })
    )

    const request = createRequest('https://do/restricted', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'allowed-do-1',
      },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)
  })

  it('should reject unspecified DO sources', async () => {
    app.get('/restricted', requireDOSource('allowed-do'), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/restricted', {
      headers: {
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'other-do',
      },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(403)
  })

  it('should reject non-DO callers', async () => {
    app.get('/restricted', requireDOSource('allowed-do'), (c) => c.json({ ok: true }))

    const request = createRequest('https://do/restricted', {
      headers: { [WORKER_NAME_HEADER]: 'my-worker' },
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(403)
  })
})

// ============================================================================
// Header Helper Tests
// ============================================================================

describe('addDOSourceHeaders', () => {
  it('should add DO source headers', () => {
    const headers = new Headers()
    addDOSourceHeaders(headers, 'my-do-id')

    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
    expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('my-do-id')
  })

  it('should preserve existing headers', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    addDOSourceHeaders(headers, 'my-do-id')

    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
  })
})

describe('createDOToDoHeaders', () => {
  it('should create headers for DO-to-DO calls', () => {
    const headers = createDOToDoHeaders('source-do-123')

    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get(DO_SOURCE_HEADER)).toBe('true')
    expect(headers.get(DO_SOURCE_ID_HEADER)).toBe('source-do-123')
  })

  it('should include correlation ID when provided', () => {
    const headers = createDOToDoHeaders('source-do', 'corr-123')

    expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-123')
  })

  it('should not include correlation ID when not provided', () => {
    const headers = createDOToDoHeaders('source-do')

    expect(headers.get(CORRELATION_ID_HEADER)).toBeNull()
  })
})

describe('addWorkerHeaders', () => {
  it('should add worker name header', () => {
    const headers = new Headers()
    addWorkerHeaders(headers, 'api-worker')

    expect(headers.get(WORKER_NAME_HEADER)).toBe('api-worker')
  })

  it('should preserve existing headers', () => {
    const headers = new Headers({ Authorization: 'Bearer token' })
    addWorkerHeaders(headers, 'api-worker')

    expect(headers.get('Authorization')).toBe('Bearer token')
    expect(headers.get(WORKER_NAME_HEADER)).toBe('api-worker')
  })
})
