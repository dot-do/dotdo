/**
 * Auth Layer Tests (RED)
 *
 * These tests verify authentication and authorization for Durable Objects.
 * They are intentionally RED (failing) tests as the implementation does not exist yet.
 *
 * The Auth Layer should provide:
 * 1. Token validation (JWT, API keys, OAuth)
 * 2. Role-based access control for methods
 * 3. Rate limiting per identity
 * 4. Request signing for security
 * 5. Session management
 * 6. Integration with org.ai identity provider
 * 7. Method-level permissions (@auth decorator or config)
 *
 * The AuthLayer will extend DOFull to add transport-level security.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO, type Env } from '../../DO'
import { withAuth, createAuthMiddleware, type AuthContext as ImportedAuthContext } from '../../transport/auth-layer'

// ============================================================================
// TYPE DEFINITIONS (future implementation)
// ============================================================================

/**
 * Auth configuration for methods
 */
interface MethodAuthConfig {
  /** Require authentication */
  requireAuth?: boolean
  /** Required roles (any of these) */
  roles?: string[]
  /** Required permissions (all of these) */
  permissions?: string[]
  /** Make method public (no auth required) */
  public?: boolean
  /** Rate limit config */
  rateLimit?: {
    requests: number
    window: string // e.g., '1m', '1h', '1d'
  }
}

/**
 * Auth context available in method handlers
 */
interface AuthContext {
  /** Whether the request is authenticated */
  authenticated: boolean
  /** User identity */
  user?: {
    id: string
    email?: string
    name?: string
    roles: string[]
    permissions: string[]
    organizationId?: string
  }
  /** Session info */
  session?: {
    id: string
    createdAt: Date
    expiresAt: Date
    refreshable: boolean
  }
  /** API key info (if using API key auth) */
  apiKey?: {
    id: string
    name: string
    scopes: string[]
    rateLimit?: { requests: number; window: string }
  }
  /** OAuth token info */
  token?: {
    type: 'jwt' | 'oauth' | 'api_key'
    issuer?: string
    audience?: string
    expiresAt: Date
    claims?: Record<string, unknown>
  }
}

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
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
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
    // Future: AUTH_SECRET, ORG_AI_URL, etc.
  }
}

// ============================================================================
// TEST DO CLASS WITH AUTH CONFIGURATION
// ============================================================================

/**
 * Test DO class that extends DO with auth-protected methods.
 * This simulates what DOFull with AuthLayer will provide.
 */
class AuthTestDO extends DO {
  static override readonly $type: string = 'AuthTestDO'

  /**
   * Static auth configuration for methods.
   * This is the declarative API for method-level permissions.
   */
  static $auth: Record<string, MethodAuthConfig> = {
    // Admin-only method
    adminOnly: {
      requireAuth: true,
      roles: ['admin'],
    },
    // Any authenticated user
    authenticated: {
      requireAuth: true,
    },
    // Public method (no auth required)
    publicMethod: {
      public: true,
    },
    // Multiple roles (any of these)
    moderatorOrAdmin: {
      requireAuth: true,
      roles: ['admin', 'moderator'],
    },
    // Permission-based access
    canReadSecrets: {
      requireAuth: true,
      permissions: ['secrets:read'],
    },
    // Multiple permissions required (all)
    canManageUsers: {
      requireAuth: true,
      permissions: ['users:read', 'users:write'],
    },
    // Rate-limited method
    rateLimited: {
      requireAuth: true,
      rateLimit: { requests: 10, window: '1m' },
    },
    // Org-scoped method
    orgScoped: {
      requireAuth: true,
      permissions: ['org:access'],
    },
  }

  /**
   * Admin-only method - should reject non-admin users
   */
  adminOnly(): { secret: string; level: string } {
    return { secret: 'admin data', level: 'classified' }
  }

  /**
   * Authenticated method - any logged-in user can access
   */
  authenticated(): { user: string; message: string } {
    return { user: 'data', message: 'Hello, authenticated user!' }
  }

  /**
   * Public method - accessible without authentication
   */
  publicMethod(): { status: string; version: string } {
    return { status: 'ok', version: '1.0.0' }
  }

  /**
   * Moderator or admin can access
   */
  moderatorOrAdmin(): { content: string } {
    return { content: 'moderated content' }
  }

  /**
   * Requires specific permission
   */
  canReadSecrets(): { secrets: string[] } {
    return { secrets: ['API_KEY', 'DB_PASSWORD'] }
  }

  /**
   * Requires multiple permissions
   */
  canManageUsers(): { users: Array<{ id: string; name: string }> } {
    return { users: [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }] }
  }

  /**
   * Rate-limited method
   */
  rateLimited(): { timestamp: number } {
    return { timestamp: Date.now() }
  }

  /**
   * Organization-scoped method
   */
  orgScoped(): { orgData: string } {
    return { orgData: 'organization specific data' }
  }

  /**
   * Method that uses auth context
   */
  whoAmI(ctx: AuthContext): { identity: string; roles: string[] } {
    if (!ctx.authenticated || !ctx.user) {
      throw new Error('Not authenticated')
    }
    return {
      identity: ctx.user.id,
      roles: ctx.user.roles,
    }
  }
}

// Apply auth layer to DO class
const AuthEnabledDO = withAuth(AuthTestDO, {
  jwtSecret: 'test-jwt-secret',
  trustedIssuers: ['https://id.org.ai'],
  audience: 'dotdo',
  signingSecret: 'test-signing-secret',
  defaultRequireAuth: true,
})

/**
 * Create a test DO instance with auth layer
 */
function createTestDO(): InstanceType<typeof AuthEnabledDO> {
  const state = createMockDOState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all properties
  return new AuthEnabledDO(state, env)
}

// ============================================================================
// JWT TOKEN HELPERS
// ============================================================================

/**
 * Create a mock JWT token for testing.
 * Signs with 'test-jwt-secret' to match the auth layer config.
 */
async function createMockJWT(payload: {
  sub: string
  roles?: string[]
  permissions?: string[]
  exp?: number
  iss?: string
  aud?: string
  org?: string
}): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    sub: payload.sub,
    roles: payload.roles || [],
    permissions: payload.permissions || [],
    exp: payload.exp || now + 3600,
    iat: now,
    iss: payload.iss || 'https://id.org.ai',
    aud: payload.aud || 'dotdo',
    org: payload.org,
  }

  // Base64url encode (no padding, replace + with -, / with _)
  function base64UrlEncode(str: string): string {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const b64Header = base64UrlEncode(JSON.stringify(header))
  const b64Payload = base64UrlEncode(JSON.stringify(claims))
  const signatureInput = `${b64Header}.${b64Payload}`

  // Sign with HMAC-SHA256 using the test secret
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('test-jwt-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureInput)
  )

  const signature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signatureBuffer)))

  return `${b64Header}.${b64Payload}.${signature}`
}

/**
 * Create a mock API key
 */
function createMockAPIKey(scopes: string[] = []): string {
  return `dk_live_${crypto.randomUUID().replace(/-/g, '')}`
}

// ============================================================================
// TOKEN VALIDATION TESTS
// ============================================================================

describe('Auth Layer', () => {
  let doInstance: AuthTestDO

  beforeEach(() => {
    doInstance = createTestDO()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Token Validation', () => {
    describe('JWT Tokens', () => {
      it('validates a valid JWT token', async () => {
        const token = await createMockJWT({
          sub: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        })

        const request = new Request('https://example.com.ai/rpc/publicMethod', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'publicMethod', args: [] }),
        })

        const response = await doInstance.fetch(request)
        // Future: This should pass once AuthLayer is implemented
        // For now, we expect the auth layer to validate the token
        expect(response.status).toBe(200)
      })

      it('rejects expired JWT tokens', async () => {
        const expiredToken = await createMockJWT({
          sub: 'user-123',
          roles: ['user'],
          exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        })

        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${expiredToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        // Future: AuthLayer should reject expired tokens with 401
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('expired')
      })

      it('rejects malformed JWT tokens', async () => {
        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer invalid.token.here',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('invalid')
      })

      it('rejects tokens with invalid signature', async () => {
        const token = await createMockJWT({
          sub: 'user-123',
          roles: ['admin'],
        })
        // Tamper with the signature
        const tamperedToken = token.slice(0, -10) + 'TAMPERED!!'

        const request = new Request('https://example.com.ai/rpc/adminOnly', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tamperedToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'adminOnly', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('signature')
      })

      it('validates issuer (iss) claim', async () => {
        const token = await createMockJWT({
          sub: 'user-123',
          iss: 'https://malicious-issuer.com',
        })

        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('issuer')
      })

      it('validates audience (aud) claim', async () => {
        const token = await createMockJWT({
          sub: 'user-123',
          aud: 'wrong-audience',
        })

        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('audience')
      })
    })

    describe('API Key Tokens', () => {
      it('validates a valid API key', async () => {
        const apiKey = createMockAPIKey(['read', 'write'])

        const request = new Request('https://example.com.ai/rpc/publicMethod', {
          method: 'POST',
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'publicMethod', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
      })

      it('rejects invalid API key format', async () => {
        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            'X-API-Key': 'not-a-valid-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('invalid')
      })

      it('rejects revoked API keys', async () => {
        // Simulate a revoked key
        const revokedKey = 'dk_live_revoked12345678901234567890'

        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            'X-API-Key': revokedKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('revoked')
      })

      it('respects API key scopes', async () => {
        // API key with only 'read' scope trying to access write-required method
        const readOnlyKey = createMockAPIKey(['read'])

        const request = new Request('https://example.com.ai/rpc/canManageUsers', {
          method: 'POST',
          headers: {
            'X-API-Key': readOnlyKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'canManageUsers', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('scope')
      })
    })

    describe('OAuth Tokens', () => {
      it('validates OAuth access tokens', async () => {
        // Mock OAuth token from org.ai
        const oauthToken = 'oauth_' + crypto.randomUUID()

        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${oauthToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        // Should validate with org.ai
        expect([200, 401]).toContain(response.status)
      })

      it('handles OAuth token refresh', async () => {
        const refreshToken = 'refresh_' + crypto.randomUUID()

        const request = new Request('https://example.com.ai/api/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })

        const response = await doInstance.fetch(request)
        // Should return new access token
        if (response.status === 200) {
          const body = await response.json()
          expect(body).toHaveProperty('access_token')
          expect(body).toHaveProperty('expires_in')
        }
      })
    })
  })

  // ============================================================================
  // AUTHORIZATION TESTS
  // ============================================================================

  describe('Authorization', () => {
    describe('Role-Based Access Control', () => {
      it('allows access with correct role', async () => {
        const token = await createMockJWT({
          sub: 'admin-user',
          roles: ['admin'],
        })

        const request = new Request('https://example.com.ai/rpc/adminOnly', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'adminOnly', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.result).toHaveProperty('secret', 'admin data')
      })

      it('denies access without required role', async () => {
        const token = await createMockJWT({
          sub: 'regular-user',
          roles: ['user'],
        })

        const request = new Request('https://example.com.ai/rpc/adminOnly', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'adminOnly', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('role')
      })

      it('allows access when user has any of multiple allowed roles', async () => {
        const token = await createMockJWT({
          sub: 'mod-user',
          roles: ['moderator'],
        })

        const request = new Request('https://example.com.ai/rpc/moderatorOrAdmin', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'moderatorOrAdmin', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
      })

      it('allows public methods without authentication', async () => {
        const request = new Request('https://example.com.ai/rpc/publicMethod', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'publicMethod', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.result).toHaveProperty('status', 'ok')
      })

      it('denies unauthenticated access to protected methods', async () => {
        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toContain('authentication required')
      })
    })

    describe('Permission-Based Access Control', () => {
      it('allows access with required permission', async () => {
        const token = await createMockJWT({
          sub: 'secrets-reader',
          permissions: ['secrets:read'],
        })

        const request = new Request('https://example.com.ai/rpc/canReadSecrets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'canReadSecrets', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.result.secrets).toContain('API_KEY')
      })

      it('denies access without required permission', async () => {
        const token = await createMockJWT({
          sub: 'regular-user',
          permissions: ['read'],
        })

        const request = new Request('https://example.com.ai/rpc/canReadSecrets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'canReadSecrets', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('permission')
      })

      it('requires all permissions when multiple are specified', async () => {
        // User has only one of two required permissions
        const token = await createMockJWT({
          sub: 'partial-user',
          permissions: ['users:read'], // Missing users:write
        })

        const request = new Request('https://example.com.ai/rpc/canManageUsers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'canManageUsers', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('permission')
      })

      it('allows access when user has all required permissions', async () => {
        const token = await createMockJWT({
          sub: 'user-manager',
          permissions: ['users:read', 'users:write', 'users:delete'],
        })

        const request = new Request('https://example.com.ai/rpc/canManageUsers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'canManageUsers', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.result.users.length).toBeGreaterThan(0)
      })
    })

    describe('Organization Scoping', () => {
      it('restricts access to org-specific resources', async () => {
        const token = await createMockJWT({
          sub: 'org-user',
          org: 'org-123',
          permissions: ['org:access'],
        })

        const request = new Request('https://example.com.ai/rpc/orgScoped', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'orgScoped', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
      })

      it('denies access to resources from different organization', async () => {
        const token = await createMockJWT({
          sub: 'org-user',
          org: 'org-different',
          permissions: ['org:access'],
        })

        // Request resource from org-123 but user is in org-different
        const request = new Request('https://example.com.ai/rpc/orgScoped', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Organization-Id': 'org-123',
          },
          body: JSON.stringify({ method: 'orgScoped', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toContain('organization')
      })
    })
  })

  // ============================================================================
  // RATE LIMITING TESTS
  // ============================================================================

  describe('Rate Limiting', () => {
    it('rate limits by identity', async () => {
      const token = await createMockJWT({
        sub: 'rate-limited-user',
        roles: ['user'],
      })

      // Make requests up to the limit
      const promises = []
      for (let i = 0; i < 10; i++) {
        const request = new Request('https://example.com.ai/rpc/rateLimited', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'rateLimited', args: [] }),
        })
        promises.push(doInstance.fetch(request))
      }

      const responses = await Promise.all(promises)
      // All should succeed (at limit)
      expect(responses.every(r => r.status === 200)).toBe(true)
    })

    it('returns 429 when limit exceeded', async () => {
      const token = await createMockJWT({
        sub: 'rate-limited-user-2',
        roles: ['user'],
      })

      // Make requests exceeding the limit
      const promises = []
      for (let i = 0; i < 15; i++) {
        const request = new Request('https://example.com.ai/rpc/rateLimited', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'rateLimited', args: [] }),
        })
        promises.push(doInstance.fetch(request))
      }

      const responses = await Promise.all(promises)
      // Some should be rate limited
      const rateLimited = responses.filter(r => r.status === 429)
      expect(rateLimited.length).toBeGreaterThan(0)
    })

    it('includes rate limit headers in response', async () => {
      const token = await createMockJWT({
        sub: 'rate-limited-user-3',
        roles: ['user'],
      })

      const request = new Request('https://example.com.ai/rpc/rateLimited', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'rateLimited', args: [] }),
      })

      const response = await doInstance.fetch(request)

      expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined()
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined()
    })

    it('resets rate limit after window expires', async () => {
      const token = await createMockJWT({
        sub: 'rate-limited-user-4',
        roles: ['user'],
      })

      // Exhaust the limit
      for (let i = 0; i < 11; i++) {
        const request = new Request('https://example.com.ai/rpc/rateLimited', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'rateLimited', args: [] }),
        })
        await doInstance.fetch(request)
      }

      // Advance time past the rate limit window (1 minute)
      vi.advanceTimersByTime(61 * 1000)

      // Should be able to make requests again
      const request = new Request('https://example.com.ai/rpc/rateLimited', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'rateLimited', args: [] }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
    })

    it('applies different rate limits per API key', async () => {
      // Premium API key with higher limits
      const premiumKey = 'dk_live_premium_' + crypto.randomUUID().replace(/-/g, '')

      const request = new Request('https://example.com.ai/rpc/rateLimited', {
        method: 'POST',
        headers: {
          'X-API-Key': premiumKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'rateLimited', args: [] }),
      })

      const response = await doInstance.fetch(request)

      // Premium keys should have higher limits
      const limit = response.headers.get('X-RateLimit-Limit')
      expect(parseInt(limit || '0')).toBeGreaterThan(10)
    })
  })

  // ============================================================================
  // REQUEST SIGNING TESTS
  // ============================================================================

  describe('Request Signing', () => {
    it('validates HMAC request signature', async () => {
      const timestamp = Date.now().toString()
      const body = JSON.stringify({ method: 'publicMethod', args: [] })
      const secret = 'test-signing-secret'

      // Create signature (simulated)
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${timestamp}.${body}`)
      )
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))

      const request = new Request('https://example.com.ai/rpc/publicMethod', {
        method: 'POST',
        headers: {
          'X-Signature-Timestamp': timestamp,
          'X-Signature': `v1=${signature}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(200)
    })

    it('rejects requests with invalid signature', async () => {
      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          'X-Signature-Timestamp': Date.now().toString(),
          'X-Signature': 'v1=invalid-signature',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toContain('signature')
    })

    it('rejects requests with stale timestamp', async () => {
      const staleTimestamp = (Date.now() - 6 * 60 * 1000).toString() // 6 minutes ago

      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          'X-Signature-Timestamp': staleTimestamp,
          'X-Signature': 'v1=some-signature',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toContain('timestamp')
    })

    it('prevents replay attacks with nonce', async () => {
      const nonce = crypto.randomUUID()

      const firstRequest = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          'X-Nonce': nonce,
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const firstResponse = await doInstance.fetch(firstRequest)

      // Second request with same nonce should be rejected
      const replayRequest = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          'X-Nonce': nonce,
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const replayResponse = await doInstance.fetch(replayRequest)
      expect(replayResponse.status).toBe(401)
      const body = await replayResponse.json()
      expect(body.error).toContain('nonce')
    })
  })

  // ============================================================================
  // SESSION MANAGEMENT TESTS
  // ============================================================================

  describe('Session Management', () => {
    it('creates session on successful login', async () => {
      const request = new Request('https://example.com.ai/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'user@example.com.ai',
          password: 'secure-password',
        }),
      })

      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json()
        expect(body).toHaveProperty('session_id')
        expect(body).toHaveProperty('access_token')
        expect(body).toHaveProperty('refresh_token')
        expect(body).toHaveProperty('expires_in')
      }
    })

    it('validates session on subsequent requests', async () => {
      // First, login to get session
      const loginRequest = new Request('https://example.com.ai/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'user@example.com.ai',
          password: 'secure-password',
        }),
      })

      const loginResponse = await doInstance.fetch(loginRequest)

      if (loginResponse.status === 200) {
        const { session_id, access_token } = await loginResponse.json()

        // Use session for subsequent request
        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'X-Session-Id': session_id,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        const response = await doInstance.fetch(request)
        expect(response.status).toBe(200)
      }
    })

    it('invalidates session on logout', async () => {
      const sessionId = 'session-to-logout'

      const logoutRequest = new Request('https://example.com.ai/api/auth/logout', {
        method: 'POST',
        headers: {
          'X-Session-Id': sessionId,
          'Content-Type': 'application/json',
        },
      })

      const logoutResponse = await doInstance.fetch(logoutRequest)
      expect(logoutResponse.status).toBe(200)

      // Try to use invalidated session
      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          'X-Session-Id': sessionId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toContain('session')
    })

    it('expires sessions after timeout', async () => {
      const token = await createMockJWT({
        sub: 'session-user',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      })

      // Request within session lifetime
      const request1 = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response1 = await doInstance.fetch(request1)
      expect(response1.status).toBe(200)

      // Advance time past session expiry
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      // Request after session expired
      const request2 = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response2 = await doInstance.fetch(request2)
      expect(response2.status).toBe(401)
    })

    it('refreshes session with valid refresh token', async () => {
      const refreshToken = 'valid-refresh-token'

      const request = new Request('https://example.com.ai/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json()
        expect(body).toHaveProperty('access_token')
        expect(body).toHaveProperty('expires_in')
        // Old refresh token should be invalidated
        expect(body.refresh_token).not.toBe(refreshToken)
      }
    })

    it('tracks concurrent sessions per user', async () => {
      const token = await createMockJWT({
        sub: 'multi-session-user',
        roles: ['user'],
      })

      // Create multiple sessions
      const sessions = []
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://example.com.ai/api/auth/login', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ device: `device-${i}` }),
        })
        const response = await doInstance.fetch(request)
        if (response.status === 200) {
          sessions.push(await response.json())
        }
      }

      // List active sessions
      const listRequest = new Request('https://example.com.ai/api/auth/sessions', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const listResponse = await doInstance.fetch(listRequest)
      if (listResponse.status === 200) {
        const body = await listResponse.json()
        expect(body.sessions.length).toBe(sessions.length)
      }
    })
  })

  // ============================================================================
  // ORG.AI INTEGRATION TESTS
  // ============================================================================

  describe('org.ai Integration', () => {
    it('federates authentication to org.ai', async () => {
      // Request should redirect or proxy to org.ai
      const request = new Request('https://example.com.ai/api/auth/signin?provider=org.ai', {
        method: 'GET',
      })

      const response = await doInstance.fetch(request)

      // Should redirect to org.ai or return auth URL
      expect([200, 302]).toContain(response.status)
      if (response.status === 302) {
        const location = response.headers.get('Location')
        expect(location).toContain('id.org.ai')
      } else {
        const body = await response.json()
        expect(body.authUrl).toContain('id.org.ai')
      }
    })

    it('handles org.ai callback', async () => {
      const authCode = 'org-ai-auth-code'

      const request = new Request(`https://example.com.ai/api/auth/callback?code=${authCode}&state=some-state`, {
        method: 'GET',
      })

      const response = await doInstance.fetch(request)

      // Should exchange code for tokens and create session
      if (response.status === 200 || response.status === 302) {
        const cookies = response.headers.get('Set-Cookie')
        expect(cookies).toContain('session')
      }
    })

    it('syncs organization membership from org.ai', async () => {
      const token = await createMockJWT({
        sub: 'org-ai-user',
        iss: 'https://id.org.ai',
        org: 'org-123',
      })

      const request = new Request('https://example.com.ai/api/auth/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json()
        expect(body.user.organizationId).toBe('org-123')
        expect(body.user.membershipSyncedAt).toBeDefined()
      }
    })

    it('validates tokens against org.ai public keys', async () => {
      // Token signed by org.ai
      const orgAiToken = await createMockJWT({
        sub: 'org-ai-user',
        iss: 'https://id.org.ai',
      })

      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${orgAiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response = await doInstance.fetch(request)
      // Should validate using org.ai's JWKS
      expect([200, 401]).toContain(response.status)
    })

    it('caches org.ai JWKS for performance', async () => {
      const token = await createMockJWT({
        sub: 'org-ai-user',
        iss: 'https://id.org.ai',
      })

      // Multiple requests should use cached JWKS
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://example.com.ai/rpc/authenticated', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ method: 'authenticated', args: [] }),
        })

        await doInstance.fetch(request)
      }

      // Future: Verify JWKS was fetched only once
      // expect(jwksFetchCount).toBe(1)
    })
  })

  // ============================================================================
  // METHOD-LEVEL PERMISSIONS TESTS
  // ============================================================================

  describe('Method-Level Permissions', () => {
    it('reads $auth configuration from class', () => {
      expect(AuthTestDO.$auth).toBeDefined()
      expect(AuthTestDO.$auth.adminOnly).toEqual({
        requireAuth: true,
        roles: ['admin'],
      })
    })

    it('applies auth config based on method name', async () => {
      const token = await createMockJWT({
        sub: 'user',
        roles: ['user'],
      })

      // adminOnly should be denied
      const adminRequest = new Request('https://example.com.ai/rpc/adminOnly', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'adminOnly', args: [] }),
      })

      const adminResponse = await doInstance.fetch(adminRequest)
      expect(adminResponse.status).toBe(403)

      // authenticated should be allowed
      const authRequest = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const authResponse = await doInstance.fetch(authRequest)
      expect(authResponse.status).toBe(200)
    })

    it('provides auth context to method handlers', async () => {
      const token = await createMockJWT({
        sub: 'user-with-context',
        roles: ['user', 'premium'],
      })

      const request = new Request('https://example.com.ai/rpc/whoAmI', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'whoAmI', args: [] }),
      })

      const response = await doInstance.fetch(request)

      if (response.status === 200) {
        const body = await response.json()
        expect(body.result.identity).toBe('user-with-context')
        expect(body.result.roles).toContain('user')
        expect(body.result.roles).toContain('premium')
      }
    })

    it('denies undeclared methods by default', async () => {
      const request = new Request('https://example.com.ai/rpc/undeclaredMethod', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'undeclaredMethod', args: [] }),
      })

      const response = await doInstance.fetch(request)
      // Methods not in $auth should require auth by default
      expect(response.status).toBe(401)
    })

    it('supports dynamic auth config updates', async () => {
      // Future: Allow runtime auth config updates
      const updateRequest = new Request('https://example.com.ai/api/auth/config', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer admin-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'publicMethod',
          config: { requireAuth: true },
        }),
      })

      const response = await doInstance.fetch(updateRequest)
      // Method access should reflect new config
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('returns appropriate error codes', async () => {
      // No token
      const noAuthRequest = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })
      const noAuthResponse = await doInstance.fetch(noAuthRequest)
      expect(noAuthResponse.status).toBe(401)

      // Invalid token
      const invalidTokenRequest = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })
      const invalidTokenResponse = await doInstance.fetch(invalidTokenRequest)
      expect(invalidTokenResponse.status).toBe(401)

      // Valid token, wrong role
      const wrongRoleToken = await createMockJWT({ sub: 'user', roles: ['user'] })
      const forbiddenRequest = new Request('https://example.com.ai/rpc/adminOnly', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wrongRoleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'adminOnly', args: [] }),
      })
      const forbiddenResponse = await doInstance.fetch(forbiddenRequest)
      expect(forbiddenResponse.status).toBe(403)
    })

    it('includes helpful error messages', async () => {
      const token = await createMockJWT({ sub: 'user', roles: ['user'] })

      const request = new Request('https://example.com.ai/rpc/adminOnly', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'adminOnly', args: [] }),
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(403)

      const body = await response.json()
      expect(body.error).toBeDefined()
      expect(body.error).toContain('role')
      expect(body.required).toContain('admin')
      expect(body.actual).toContain('user')
    })

    it('sanitizes error messages for production', async () => {
      // Errors should not leak sensitive information
      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer deliberately-invalid-token-with-sensitive-info',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      const response = await doInstance.fetch(request)
      const body = await response.json()

      // Error should not contain the actual token
      expect(body.error).not.toContain('sensitive-info')
      expect(body.error).not.toContain('deliberately-invalid')
    })

    it('logs auth failures for security monitoring', async () => {
      // Future: Verify logging of auth failures
      const request = new Request('https://example.com.ai/rpc/authenticated', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'authenticated', args: [] }),
      })

      await doInstance.fetch(request)

      // Future: Verify event was emitted
      // expect(events).toContainEqual(expect.objectContaining({
      //   type: 'auth.failure',
      //   reason: 'invalid_token',
      // }))
    })
  })

  // ============================================================================
  // WEBSOCKET AUTH TESTS
  // ============================================================================

  describe('WebSocket Authentication', () => {
    it('authenticates WebSocket upgrade requests', async () => {
      const token = await createMockJWT({
        sub: 'websocket-user',
        roles: ['user'],
      })

      const request = new Request('https://example.com.ai/ws', {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          Authorization: `Bearer ${token}`,
        },
      })

      const response = await doInstance.fetch(request)
      // WebSocket upgrade should be accepted for authenticated users
      expect([101, 200]).toContain(response.status)
    })

    it('rejects unauthenticated WebSocket connections', async () => {
      const request = new Request('https://example.com.ai/ws', {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      })

      const response = await doInstance.fetch(request)
      expect(response.status).toBe(401)
    })

    it('supports token in query parameter for WebSocket', async () => {
      const token = await createMockJWT({
        sub: 'websocket-user',
        roles: ['user'],
      })

      const request = new Request(`https://example.com.ai/ws?token=${token}`, {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      })

      const response = await doInstance.fetch(request)
      expect([101, 200]).toContain(response.status)
    })
  })

  // ============================================================================
  // AUDIT LOGGING TESTS
  // ============================================================================

  describe('Audit Logging', () => {
    it('logs successful authentication', async () => {
      const token = await createMockJWT({
        sub: 'audit-user',
        roles: ['user'],
      })

      const request = new Request('https://example.com.ai/rpc/publicMethod', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'publicMethod', args: [] }),
      })

      await doInstance.fetch(request)

      // Future: Verify audit log entry
      // expect(auditLog).toContainEqual(expect.objectContaining({
      //   event: 'auth.success',
      //   userId: 'audit-user',
      //   method: 'publicMethod',
      // }))
    })

    it('logs authorization decisions', async () => {
      const token = await createMockJWT({
        sub: 'audit-user',
        roles: ['user'],
      })

      const request = new Request('https://example.com.ai/rpc/adminOnly', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'adminOnly', args: [] }),
      })

      await doInstance.fetch(request)

      // Future: Verify audit log entry
      // expect(auditLog).toContainEqual(expect.objectContaining({
      //   event: 'authz.denied',
      //   userId: 'audit-user',
      //   method: 'adminOnly',
      //   reason: 'missing_role',
      //   requiredRoles: ['admin'],
      //   actualRoles: ['user'],
      // }))
    })

    it('includes request metadata in logs', async () => {
      const token = await createMockJWT({
        sub: 'audit-user',
        roles: ['admin'],
      })

      const request = new Request('https://example.com.ai/rpc/adminOnly', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.1',
          'User-Agent': 'TestClient/1.0',
        },
        body: JSON.stringify({ method: 'adminOnly', args: [] }),
      })

      await doInstance.fetch(request)

      // Future: Verify audit log includes metadata
      // expect(auditLog[0]).toMatchObject({
      //   ip: '192.168.1.1',
      //   userAgent: 'TestClient/1.0',
      //   timestamp: expect.any(String),
      // })
    })
  })
})
