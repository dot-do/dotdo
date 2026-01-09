/**
 * DOAuth Capability Tests
 *
 * Tests for the DOAuth capability that provides Hono-based authentication
 * routes for Durable Objects.
 *
 * Features tested:
 * - DOAuth instantiation and configuration
 * - Auth route handling (/api/auth/*)
 * - Session management
 * - Federation configuration
 * - OAuth provider/proxy plugin configuration
 * - Integration with base DO class
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { DOAuth, createDOAuth, type DOAuthConfig } from '../DOAuth'
import { DO, type Env } from '../DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean> => {
      if (Array.isArray(key)) {
        let deleted = false
        for (const k of key) {
          deleted = storage.delete(k) || deleted
        }
        return deleted
      }
      return storage.delete(key)
    }),
    list: vi.fn(async <T>(_options?: { prefix?: string }): Promise<Map<string, T>> => {
      return new Map() as Map<string, T>
    }),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockDOState() {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: {
      toString: () => 'test-do-id-12345',
      equals: (other: unknown) => other?.toString?.() === 'test-do-id-12345',
      name: 'test-do',
    },
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockDOState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all properties
  return new DO(state, env)
}

// ============================================================================
// DOAuth INSTANTIATION TESTS
// ============================================================================

describe('DOAuth Instantiation', () => {
  let doInstance: DO

  beforeEach(() => {
    doInstance = createTestDO()
  })

  it('creates DOAuth instance with default config', () => {
    const auth = new DOAuth(doInstance)
    expect(auth).toBeInstanceOf(DOAuth)
  })

  it('creates DOAuth instance with custom config', () => {
    const config: DOAuthConfig = {
      federate: false,
      federateTo: 'https://custom.auth.com',
      cookieName: 'my_session',
    }
    const auth = new DOAuth(doInstance, config)

    const resultConfig = auth.getConfig()
    expect(resultConfig.federate).toBe(false)
    expect(resultConfig.federateTo).toBe('https://custom.auth.com')
    expect(resultConfig.cookieName).toBe('my_session')
  })

  it('creates DOAuth via factory function', () => {
    const auth = createDOAuth(doInstance, { federate: true })
    expect(auth).toBeInstanceOf(DOAuth)
    expect(auth.getConfig().federate).toBe(true)
  })

  it('uses default federation URL when not specified', () => {
    const auth = new DOAuth(doInstance)
    expect(auth.getConfig().federateTo).toBe('https://id.org.ai')
  })

  it('enables federation by default', () => {
    const auth = new DOAuth(doInstance)
    expect(auth.getConfig().federate).toBe(true)
  })

  it('enables OAuth proxy by default', () => {
    const auth = new DOAuth(doInstance)
    expect(auth.getConfig().oauthProxy?.enabled).toBe(true)
  })

  it('enables organization support by default', () => {
    const auth = new DOAuth(doInstance)
    expect(auth.getConfig().organization?.enabled).toBe(true)
  })

  it('disables OAuth provider by default', () => {
    const auth = new DOAuth(doInstance)
    expect(auth.getConfig().oauthProvider?.enabled).toBe(false)
  })
})

// ============================================================================
// DOAuth ROUTE HANDLING TESTS
// ============================================================================

describe('DOAuth Route Handling', () => {
  let doInstance: DO
  let auth: DOAuth

  beforeEach(() => {
    doInstance = createTestDO()
    auth = new DOAuth(doInstance)
  })

  it('returns null for non-auth routes', async () => {
    const request = new Request('https://example.com/api/things')
    const response = await auth.handle(request)
    expect(response).toBeNull()
  })

  it('handles /api/auth/* routes', async () => {
    const request = new Request('https://example.com/api/auth/session')
    const response = await auth.handle(request)
    expect(response).not.toBeNull()
    expect(response).toBeInstanceOf(Response)
  })

  it('returns session info from /api/auth/session', async () => {
    const request = new Request('https://example.com/api/auth/session')
    const response = await auth.handle(request)
    expect(response).not.toBeNull()

    const body = await response!.json()
    // Without a session cookie, should return unauthenticated
    expect(body).toHaveProperty('authenticated')
  })

  it('returns 401 for /api/auth/me without auth', async () => {
    const request = new Request('https://example.com/api/auth/me')
    const response = await auth.handle(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(401)
  })

  it('handles /api/auth/signin route', async () => {
    const request = new Request('https://example.com/api/auth/signin', {
      headers: { Origin: 'https://example.com' },
    })
    const response = await auth.handle(request)
    expect(response).not.toBeNull()
    // With federation enabled, should redirect to federation URL
    // or return provider options
    expect([200, 302, 400]).toContain(response!.status)
  })

  it('handles /api/auth/logout route', async () => {
    const request = new Request('https://example.com/api/auth/logout', {
      method: 'POST',
    })
    const response = await auth.handle(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('handles /api/auth/config route', async () => {
    const request = new Request('https://example.com/api/auth/config')
    const response = await auth.handle(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)

    const body = await response!.json()
    expect(body).toHaveProperty('federate')
    expect(body).toHaveProperty('federateTo')
  })
})

// ============================================================================
// DOAuth MIDDLEWARE CREATION TESTS
// ============================================================================

describe('DOAuth Middleware Creation', () => {
  let doInstance: DO
  let auth: DOAuth

  beforeEach(() => {
    doInstance = createTestDO()
    auth = new DOAuth(doInstance, {
      jwtSecret: 'test-secret',
      publicPaths: ['/public', '/health'],
    })
  })

  it('creates auth middleware', () => {
    const middleware = auth.createMiddleware()
    expect(typeof middleware).toBe('function')
  })

  it('creates requireAuth middleware', () => {
    const middleware = auth.requireAuth()
    expect(typeof middleware).toBe('function')
  })

  it('creates requireRole middleware', () => {
    const middleware = auth.requireRole('admin')
    expect(typeof middleware).toBe('function')
  })

  it('middleware can be used with Hono', async () => {
    const app = new Hono()
    app.use('*', auth.createMiddleware())
    app.get('/test', (c) => c.json({ ok: true }))

    const response = await app.request('/test')
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// DOAuth CONTEXT HELPERS TESTS
// ============================================================================

describe('DOAuth Context Helpers', () => {
  let doInstance: DO
  let auth: DOAuth

  beforeEach(() => {
    doInstance = createTestDO()
    auth = new DOAuth(doInstance)
  })

  it('getAuth returns undefined when not authenticated', async () => {
    const app = new Hono()
    let authResult: unknown

    app.get('/test', (c) => {
      authResult = auth.getAuth(c)
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(authResult).toBeUndefined()
  })

  it('getUser returns undefined when not authenticated', async () => {
    const app = new Hono()
    let userResult: unknown

    app.get('/test', (c) => {
      userResult = auth.getUser(c)
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(userResult).toBeUndefined()
  })

  it('isAuthenticated returns false when not authenticated', async () => {
    const app = new Hono()
    let isAuth: boolean = true

    app.get('/test', (c) => {
      isAuth = auth.isAuthenticated(c)
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(isAuth).toBe(false)
  })

  it('hasRole returns false when not authenticated', async () => {
    const app = new Hono()
    let hasAdminRole: boolean = true

    app.get('/test', (c) => {
      hasAdminRole = auth.hasRole(c, 'admin')
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(hasAdminRole).toBe(false)
  })

  it('hasPermission returns false when not authenticated', async () => {
    const app = new Hono()
    let hasPermission: boolean = true

    app.get('/test', (c) => {
      hasPermission = auth.hasPermission(c, 'read')
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(hasPermission).toBe(false)
  })
})

// ============================================================================
// DOAuth CONFIGURATION UPDATE TESTS
// ============================================================================

describe('DOAuth Configuration Updates', () => {
  let doInstance: DO
  let auth: DOAuth

  beforeEach(() => {
    doInstance = createTestDO()
    auth = new DOAuth(doInstance)
  })

  it('updates configuration at runtime', () => {
    expect(auth.getConfig().federate).toBe(true)

    auth.updateConfig({ federate: false })

    expect(auth.getConfig().federate).toBe(false)
  })

  it('preserves other config when updating', () => {
    auth.updateConfig({ federate: false })

    expect(auth.getConfig().federateTo).toBe('https://id.org.ai')
    expect(auth.getConfig().oauthProxy?.enabled).toBe(true)
  })

  it('returns immutable config copy', () => {
    const config1 = auth.getConfig()
    const config2 = auth.getConfig()

    expect(config1).not.toBe(config2)
    expect(config1).toEqual(config2)
  })
})

// ============================================================================
// DOAuth HONO APP ACCESS TESTS
// ============================================================================

describe('DOAuth Hono App Access', () => {
  let doInstance: DO
  let auth: DOAuth

  beforeEach(() => {
    doInstance = createTestDO()
    auth = new DOAuth(doInstance)
  })

  it('provides access to internal Hono app', () => {
    const app = auth.getApp()
    expect(app).toBeInstanceOf(Hono)
  })

  it('Hono app handles auth routes', async () => {
    const app = auth.getApp()
    const response = await app.request('/api/auth/config')
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// DO BASE CLASS HONO INTEGRATION TESTS
// ============================================================================

describe('DO Base Class Hono Integration', () => {
  it('DO has optional app property', () => {
    const doInstance = createTestDO()
    expect(doInstance).toHaveProperty('app')
  })

  it('DO.handleFetch handles /health route', async () => {
    const doInstance = createTestDO()
    const request = new Request('https://example.com/health')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('status', 'ok')
  })

  it('DO.handleFetch handles /resolve route', async () => {
    const doInstance = createTestDO()
    const request = new Request('https://example.com/resolve?path=Thing/123')
    const response = await doInstance.fetch(request)

    // Should return 404 if thing not found or error
    expect([200, 400, 404]).toContain(response.status)
  })

  it('DO.handleFetch returns 400 for /resolve without path', async () => {
    const doInstance = createTestDO()
    const request = new Request('https://example.com/resolve')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('path')
  })

  it('DO.handleFetch returns 404 for unknown routes', async () => {
    const doInstance = createTestDO()
    const request = new Request('https://example.com/unknown')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(404)
  })
})

// ============================================================================
// DOAuth WITH DO INTEGRATION TESTS
// ============================================================================

describe('DOAuth with DO Integration', () => {
  /**
   * Custom DO class that uses DOAuth
   */
  class AuthenticatedDO extends DO {
    private auth: DOAuth

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      this.auth = new DOAuth(this, { federate: true })

      // Set up Hono app with auth routes
      this.app = new Hono()
        .get('/api/things', (c) => c.json({ things: [] }))
    }

    async fetch(request: Request): Promise<Response> {
      // Try auth routes first
      const authResponse = await this.auth.handle(request)
      if (authResponse) return authResponse

      // Fall back to Hono app and default handling
      return this.handleFetch(request)
    }
  }

  function createAuthenticatedDO(): AuthenticatedDO {
    const state = createMockDOState()
    const env = createMockEnv()
    // @ts-expect-error - Mock state doesn't have all properties
    return new AuthenticatedDO(state, env)
  }

  it('handles auth routes via DOAuth', async () => {
    const do_ = createAuthenticatedDO()
    const request = new Request('https://example.com/api/auth/session')
    const response = await do_.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('authenticated')
  })

  it('handles custom routes via Hono app', async () => {
    const do_ = createAuthenticatedDO()
    const request = new Request('https://example.com/api/things')
    const response = await do_.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('things')
  })

  it('handles built-in routes', async () => {
    const do_ = createAuthenticatedDO()
    const request = new Request('https://example.com/health')
    const response = await do_.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('status', 'ok')
  })

  it('returns 404 for unhandled routes', async () => {
    const do_ = createAuthenticatedDO()
    const request = new Request('https://example.com/unknown')
    const response = await do_.fetch(request)

    expect(response.status).toBe(404)
  })
})
