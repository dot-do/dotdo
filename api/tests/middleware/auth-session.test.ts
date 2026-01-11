/**
 * Session Authentication Tests
 *
 * TDD tests for authenticateSession() in api/middleware/auth.ts
 *
 * Issue: dotdo-6tm1 - Mock session validation accepting 'valid-session' token
 *
 * These tests verify:
 * 1. Session validation requires validateSession config
 * 2. Rejection of mock 'valid-session' token (no longer works)
 * 3. Proper session cookie parsing
 * 4. Session expiration handling
 * 5. KV caching for performance (REFACTOR phase)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import {
  authMiddleware,
  requireAuth,
  createSessionValidator,
  type AuthConfig,
  type SessionValidator,
  type SessionDatabase,
} from '../../middleware/auth'

// ============================================================================
// Types
// ============================================================================

interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
}

interface User {
  id: string
  email?: string
  name?: string
  role: 'admin' | 'user'
}

interface AuthResponse {
  message?: string
  error?: string
  user?: User
  authenticated?: boolean
}

// Variables available in Hono context after auth middleware
type AppVariables = {
  user?: User
  auth?: AuthContext
}

// ============================================================================
// Mock Database Setup
// ============================================================================

// Mock session database (simulates better-auth sessions table)
const mockSessions = new Map<
  string,
  {
    id: string
    userId: string
    token: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
  }
>()

// Mock users database
const mockUsers = new Map<
  string,
  {
    id: string
    email: string
    name: string
    role: 'admin' | 'user'
    emailVerified: boolean
  }
>()

// Mock KV namespace for session caching
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}

// ============================================================================
// Mock Session Validator
// ============================================================================

/**
 * Create a mock session validator that uses our in-memory mock database.
 * This simulates what createSessionValidator would do with a real database.
 */
function createMockSessionValidator(): SessionValidator {
  return async (token: string) => {
    const session = mockSessions.get(token)

    if (!session) {
      return null
    }

    // Check expiration
    if (session.expiresAt <= new Date()) {
      return null
    }

    const user = mockUsers.get(session.userId)
    if (!user) {
      return null
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      expiresAt: session.expiresAt,
    }
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

interface TestAppConfig extends Omit<AuthConfig, 'validateSession'> {
  /**
   * Whether to include a session validator.
   * Default: true (uses mock validator)
   * Set to false to test behavior without validator (mock rejection tests)
   */
  withValidator?: boolean
}

function createTestApp(config: TestAppConfig = {}) {
  const { withValidator = true, ...authConfig } = config

  const app = new Hono<{ Variables: AppVariables }>()

  app.use(
    '*',
    authMiddleware({
      cookieName: 'session',
      validateSession: withValidator ? createMockSessionValidator() : undefined,
      sessionCache: config.sessionCache,
      ...authConfig,
    }),
  )

  // Public route
  app.get('/public', (c) => c.json({ message: 'public' }))

  // Protected route
  app.get('/protected', requireAuth(), (c) =>
    c.json({
      message: 'protected',
      user: c.get('user'),
      auth: c.get('auth'),
    }),
  )

  // Session info route
  app.get('/session-info', requireAuth(), (c) => {
    const auth = c.get('auth')
    return c.json({
      userId: auth?.userId,
      method: auth?.method,
      role: auth?.role,
    })
  })

  return app
}

async function request(
  app: Hono,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    cookie?: string
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (options.cookie) {
    headers['Cookie'] = options.cookie
  }

  return app.request(path, { method, headers })
}

function createValidSession(
  userId: string,
  token: string,
  options: { expiresIn?: number; role?: 'admin' | 'user' } = {},
) {
  const expiresIn = options.expiresIn ?? 7 * 24 * 60 * 60 * 1000 // 7 days default
  const sessionId = `session-${crypto.randomUUID()}`

  const session = {
    id: sessionId,
    userId,
    token,
    expiresAt: new Date(Date.now() + expiresIn),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  mockSessions.set(token, session)

  // Also create a user for this session
  if (!mockUsers.has(userId)) {
    mockUsers.set(userId, {
      id: userId,
      email: `${userId}@example.com.ai`,
      name: `User ${userId}`,
      role: options.role ?? 'user',
      emailVerified: true,
    })
  }

  return session
}

function createExpiredSession(userId: string, token: string) {
  const sessionId = `session-${crypto.randomUUID()}`

  const session = {
    id: sessionId,
    userId,
    token,
    expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  }

  mockSessions.set(token, session)

  // Create user too
  if (!mockUsers.has(userId)) {
    mockUsers.set(userId, {
      id: userId,
      email: `${userId}@example.com.ai`,
      name: `User ${userId}`,
      role: 'user',
      emailVerified: true,
    })
  }

  return session
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockSessions.clear()
  mockUsers.clear()
  mockKV.get.mockReset()
  mockKV.put.mockReset()
  mockKV.delete.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Mock Token Rejection Tests
// ============================================================================

describe('Mock Token Rejection', () => {
  it('should REJECT the mock "valid-session" token when validateSession is configured', async () => {
    // With the new implementation, 'valid-session' is NOT a valid token
    // because it doesn't exist in our mock database
    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: 'session=valid-session',
    })

    // The mock 'valid-session' should NOT work - it's not in our database
    expect(res.status).toBe(401)
  })

  it('should reject when no validateSession is configured', async () => {
    // Without a validator, session auth should fail
    const app = createTestApp({ withValidator: false })

    const res = await request(app, 'GET', '/protected', {
      cookie: 'session=any-token',
    })

    expect(res.status).toBe(401)
  })

  it('should not authenticate with arbitrary session token without database entry', async () => {
    // No session in database, should fail even with a real-looking token
    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: 'session=some-random-token-123',
    })

    expect(res.status).toBe(401)
  })
})

// ============================================================================
// Database Integration Tests
// ============================================================================

describe('Better-Auth Database Integration', () => {
  it('should validate session against database', async () => {
    // Create a real session in our mock database
    const token = `real-session-${crypto.randomUUID()}`
    createValidSession('user-db-1', token)

    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: `session=${token}`,
    })

    // Should succeed because session exists in database
    expect(res.status).toBe(200)

    const body = (await res.json()) as AuthResponse
    expect(body.user?.id).toBe('user-db-1')
  })

  it('should return user info from database when session is valid', async () => {
    const token = `session-${crypto.randomUUID()}`
    createValidSession('user-info-1', token)

    const app = createTestApp()

    const res = await request(app, 'GET', '/session-info', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.userId).toBe('user-info-1')
    expect(body.method).toBe('session')
  })

  it('should set auth method to "session" for cookie-based auth', async () => {
    const token = `session-method-${crypto.randomUUID()}`
    createValidSession('user-method-1', token)

    const app = createTestApp()

    const res = await request(app, 'GET', '/session-info', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.method).toBe('session')
  })
})

// ============================================================================
// Session Cookie Parsing Tests
// ============================================================================

describe('Session Cookie Parsing', () => {
  it('should extract session from default "session" cookie name', async () => {
    const token = `session-cookie-${crypto.randomUUID()}`
    createValidSession('user-cookie-1', token)

    const app = createTestApp({ cookieName: 'session' })

    const res = await request(app, 'GET', '/protected', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)
  })

  it('should extract session from custom cookie name', async () => {
    const token = `custom-cookie-${crypto.randomUUID()}`
    createValidSession('user-custom-cookie', token)

    const app = createTestApp({ cookieName: 'auth_token' })

    const res = await request(app, 'GET', '/protected', {
      cookie: `auth_token=${token}`,
    })

    expect(res.status).toBe(200)
  })

  it('should handle multiple cookies and extract the correct one', async () => {
    const token = `multi-cookie-${crypto.randomUUID()}`
    createValidSession('user-multi', token)

    const app = createTestApp({ cookieName: 'session' })

    const res = await request(app, 'GET', '/protected', {
      cookie: `other=value; session=${token}; another=test`,
    })

    expect(res.status).toBe(200)
  })

  it('should reject when session cookie is missing', async () => {
    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      // No cookie header
    })

    expect(res.status).toBe(401)
  })

  it('should reject when session cookie is empty', async () => {
    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: 'session=',
    })

    expect(res.status).toBe(401)
  })
})

// ============================================================================
// Session Expiration Handling Tests
// ============================================================================

describe('Session Expiration Handling', () => {
  it('should reject expired sessions', async () => {
    const token = `expired-session-${crypto.randomUUID()}`
    createExpiredSession('user-expired', token)

    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(401)
  })

  it('should accept sessions that have not yet expired', async () => {
    const token = `valid-expiry-${crypto.randomUUID()}`
    // Create session that expires in 1 hour
    createValidSession('user-valid-expiry', token, { expiresIn: 60 * 60 * 1000 })

    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)
  })

  it('should reject sessions that expire exactly now', async () => {
    const token = `boundary-session-${crypto.randomUUID()}`
    // Create session with -1ms expiry (already expired)
    createValidSession('user-boundary', token, { expiresIn: -1 })

    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(401)
  })
})

// ============================================================================
// KV Session Caching Tests (REFACTOR Phase)
// ============================================================================

describe('Session Caching - REFACTOR Phase', () => {
  describe('KV Cache Integration', () => {
    it('should check KV cache before database lookup', async () => {
      const token = `cached-session-${crypto.randomUUID()}`
      const userId = 'user-cached'

      // Pre-populate cache
      mockKV.get.mockResolvedValue(
        JSON.stringify({
          userId,
          role: 'user',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      )

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
      })

      const res = await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      // Should use cached value
      expect(res.status).toBe(200)
      expect(mockKV.get).toHaveBeenCalledWith(`session:${token}`, 'json')
    })

    it('should cache session after successful database lookup', async () => {
      const token = `to-cache-${crypto.randomUUID()}`
      createValidSession('user-to-cache', token)

      mockKV.get.mockResolvedValue(null) // Not in cache

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
      })

      const res = await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      expect(res.status).toBe(200)

      // Should have stored in cache
      expect(mockKV.put).toHaveBeenCalledWith(
        `session:${token}`,
        expect.any(String),
        expect.objectContaining({ expirationTtl: expect.any(Number) }),
      )
    })

    it('should invalidate cache for expired sessions', async () => {
      const token = `invalidate-cache-${crypto.randomUUID()}`

      // Cache has session but it's expired
      mockKV.get.mockResolvedValue({
        userId: 'user-invalidate',
        role: 'user',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
      })

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
      })

      const res = await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      expect(res.status).toBe(401)

      // Should delete from cache
      expect(mockKV.delete).toHaveBeenCalledWith(`session:${token}`)
    })

    it('should set appropriate TTL when caching sessions', async () => {
      const token = `ttl-session-${crypto.randomUUID()}`
      const expiresIn = 2 * 60 * 60 * 1000 // 2 hours
      createValidSession('user-ttl', token, { expiresIn })

      mockKV.get.mockResolvedValue(null)

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
        sessionCacheTtl: 300, // 5 minutes
      })

      await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      // Should have cached with specified TTL
      expect(mockKV.put).toHaveBeenCalledWith(
        `session:${token}`,
        expect.any(String),
        expect.objectContaining({
          expirationTtl: 300,
        }),
      )
    })

    it('should fallback to database when KV is unavailable', async () => {
      const token = `fallback-${crypto.randomUUID()}`
      createValidSession('user-fallback', token)

      mockKV.get.mockRejectedValue(new Error('KV unavailable'))

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
      })

      const res = await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      // Should still work via database fallback
      expect(res.status).toBe(200)
    })
  })

  describe('Cache Key Format', () => {
    it('should use consistent cache key format: session:{token}', async () => {
      const token = `key-format-${crypto.randomUUID()}`
      createValidSession('user-key', token)

      mockKV.get.mockResolvedValue(null)

      const app = createTestApp({
        sessionCache: mockKV as unknown as KVNamespace,
      })

      await request(app, 'GET', '/protected', {
        cookie: `session=${token}`,
      })

      expect(mockKV.get).toHaveBeenCalledWith(`session:${token}`, 'json')
    })
  })
})

// ============================================================================
// User Role Tests
// ============================================================================

describe('Session User Role', () => {
  it('should retrieve user role from database', async () => {
    const token = `admin-role-${crypto.randomUUID()}`
    createValidSession('user-admin', token, { role: 'admin' })

    const app = createTestApp()

    const res = await request(app, 'GET', '/session-info', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.role).toBe('admin')
  })

  it('should default to "user" role when not specified', async () => {
    const token = `default-role-${crypto.randomUUID()}`
    createValidSession('user-default-role', token)

    const app = createTestApp()

    const res = await request(app, 'GET', '/session-info', {
      cookie: `session=${token}`,
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.role).toBe('user')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Session Error Handling', () => {
  it('should return generic error message for invalid sessions', async () => {
    const app = createTestApp()

    const res = await request(app, 'GET', '/protected', {
      cookie: 'session=invalid-token-xyz',
    })

    expect(res.status).toBe(401)
  })

  it('should handle validator errors gracefully', async () => {
    // Create a validator that throws
    const errorValidator: SessionValidator = async () => {
      throw new Error('Database connection failed')
    }

    const app = new Hono<{ Variables: AppVariables }>()
    app.use(
      '*',
      authMiddleware({
        cookieName: 'session',
        validateSession: errorValidator,
      }),
    )
    app.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

    const res = await app.request('/protected', {
      method: 'GET',
      headers: { Cookie: 'session=test-token' },
    })

    // Should fail gracefully, not crash
    expect(res.status).toBe(401)
  })
})

// ============================================================================
// createSessionValidator Factory Tests
// ============================================================================

describe('createSessionValidator factory', () => {
  it('should create a validator function', () => {
    const mockDb: SessionDatabase = {
      query: {
        sessions: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
    }

    const validator = createSessionValidator(mockDb)
    expect(typeof validator).toBe('function')
  })

  it('should return null for non-existent sessions', async () => {
    const mockDb: SessionDatabase = {
      query: {
        sessions: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
    }

    const validator = createSessionValidator(mockDb)
    const result = await validator('non-existent-token')

    expect(result).toBeNull()
  })

  it('should return user data for valid sessions', async () => {
    const mockSession = {
      id: 'session-123',
      userId: 'user-123',
      token: 'valid-token',
      expiresAt: new Date(Date.now() + 60000),
    }

    const mockUser = {
      id: 'user-123',
      email: 'test@example.com.ai',
      role: 'admin',
    }

    const mockDb: SessionDatabase = {
      query: {
        sessions: {
          findFirst: vi.fn().mockResolvedValue(mockSession),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue(mockUser),
        },
      },
    }

    const validator = createSessionValidator(mockDb)
    const result = await validator('valid-token')

    expect(result).toEqual({
      userId: 'user-123',
      email: 'test@example.com.ai',
      role: 'admin',
      expiresAt: mockSession.expiresAt,
    })
  })

  it('should return null when user not found for session', async () => {
    const mockSession = {
      id: 'session-123',
      userId: 'user-123',
      token: 'orphan-session',
      expiresAt: new Date(Date.now() + 60000),
    }

    const mockDb: SessionDatabase = {
      query: {
        sessions: {
          findFirst: vi.fn().mockResolvedValue(mockSession),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue(undefined), // User not found
        },
      },
    }

    const validator = createSessionValidator(mockDb)
    const result = await validator('orphan-session')

    expect(result).toBeNull()
  })
})
