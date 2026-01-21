/**
 * @dotdo/oauth Middleware Tests
 *
 * Tests for Hono middleware and OAuth callback handlers.
 * Following TDD Red-Green-Refactor methodology.
 *
 * @module @dotdo/oauth/tests/middleware
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { SessionStore, SessionData } from '../src/storage/interface'
import type { OAuthProvider, UserInfo } from '../src/providers/interface'
import type { TokenResponse } from '../src/core/types'

// Mock session store for testing
function createMockSessionStore(): SessionStore & { sessions: Map<string, SessionData> } {
  const sessions = new Map<string, SessionData>()
  return {
    sessions,
    async get(sessionId: string) {
      return sessions.get(sessionId) ?? null
    },
    async set(sessionId: string, data: SessionData) {
      sessions.set(sessionId, data)
    },
    async delete(sessionId: string) {
      sessions.delete(sessionId)
    },
  }
}

// Mock OAuth provider for testing
function createMockProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    name: 'mock',
    getAuthorizationUrl: (state: string, challenge: string) =>
      `https://mock.provider/auth?state=${state}&code_challenge=${challenge}`,
    exchangeCode: vi.fn().mockResolvedValue({
      access_token: 'mock-access-token',
      token_type: 'Bearer' as const,
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
    } satisfies TokenResponse),
    getUser: vi.fn().mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
    } satisfies UserInfo),
    ...overrides,
  }
}

describe('@dotdo/oauth middleware', () => {
  describe('oauthMiddleware()', () => {
    it('validates session from cookie', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      // Pre-populate session
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'token-abc',
        provider: 'github',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store, cookieName: 'session' }))
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=session-123' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-456')
    })

    it('validates session from Authorization header', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      await store.set('session-789', {
        userId: 'user-abc',
        accessToken: 'token-xyz',
        provider: 'google',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer session-789' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-abc')
    })

    it('returns 401 when session is missing', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')

      expect(res.status).toBe(401)
    })

    it('returns 401 when session does not exist in store', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=nonexistent' },
      })

      expect(res.status).toBe(401)
    })

    it('skips validation for excluded paths', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          excludePaths: ['/public', '/health'],
        })
      )
      app.get('/public', (c) => c.json({ public: true }))
      app.get('/health', (c) => c.json({ healthy: true }))

      const res1 = await app.request('/public')
      const res2 = await app.request('/health')

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
    })

    it('sets session data in context', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      const sessionData = {
        userId: 'user-xyz',
        accessToken: 'token-123',
        refreshToken: 'refresh-456',
        provider: 'microsoft',
        metadata: { role: 'admin' },
      }
      await store.set('session-full', sessionData)

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/me', (c) => {
        const session = c.get('session')
        return c.json(session)
      })

      const res = await app.request('/me', {
        headers: { Cookie: 'session=session-full' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toEqual(sessionData)
    })
  })

  describe('createCallbackHandler()', () => {
    it('exchanges code using PKCE verifier', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${state}`)

      expect(provider.exchangeCode).toHaveBeenCalledWith('auth-code-123', pkce.verifier)
    })

    it('creates session in store after successful exchange', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code-123&state=${state}`)

      // Verify session was created
      expect(store.sessions.size).toBe(1)
      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.userId).toBe('user-123')
      expect(sessionData.accessToken).toBe('mock-access-token')
      expect(sessionData.provider).toBe('mock')
    })

    it('returns error when state is invalid', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const storedState = await createStateWithMetadata({ redirectUri: '/dashboard' })
      const wrongState = await createStateWithMetadata({ redirectUri: '/other' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => storedState,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${wrongState}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('state')
    })

    it('returns error when code exchange fails', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        exchangeCode: vi.fn().mockRejectedValue(new Error('Invalid code')),
      })

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=invalid-code&state=${state}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('code')
    })

    it('redirects to stored redirect URI on success', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        defaultRedirect: '/home',
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${state}`)

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/dashboard')
    })

    it('sets session cookie on success', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        cookieName: 'auth_session',
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${state}`)

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('auth_session=')
      expect(setCookie).toContain('HttpOnly')
    })
  })

  describe('createAuthorizeHandler()', () => {
    it('redirects to provider with state and challenge', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')

      const provider = createMockProvider()
      let storedPKCE: unknown
      let storedState: unknown

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async (pkce) => {
          storedPKCE = pkce
        },
        storeState: async (state) => {
          storedState = state
        },
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login?redirect_uri=/dashboard')

      expect(res.status).toBe(302)
      const location = res.headers.get('Location')
      expect(location).toContain('mock.provider/auth')
      expect(location).toContain('state=')
      expect(location).toContain('code_challenge=')

      // Verify PKCE and state were stored
      expect(storedPKCE).toBeDefined()
      expect(storedState).toBeDefined()
    })

    it('includes redirect URI in state metadata', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createMockProvider()
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login?redirect_uri=/custom-path')

      expect(storedState).toBeDefined()
      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/custom-path')
    })

    it('uses default redirect URI when not provided', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createMockProvider()
      let storedState: string | undefined

      const handler = createAuthorizeHandler({
        provider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
        defaultRedirectUri: '/home',
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      await app.request('/auth/login')

      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/home')
    })

    it('supports provider selection via query param', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { ProviderRegistry } = await import('../src/providers/registry')

      const googleProvider = createMockProvider({ name: 'google' })
      const githubProvider = createMockProvider({ name: 'github' })

      // Override getAuthorizationUrl to include provider name in URL
      googleProvider.getAuthorizationUrl = (state, challenge) =>
        `https://google.com/auth?state=${state}&code_challenge=${challenge}`
      githubProvider.getAuthorizationUrl = (state, challenge) =>
        `https://github.com/auth?state=${state}&code_challenge=${challenge}`

      const registry = new ProviderRegistry()
      registry.register(googleProvider)
      registry.register(githubProvider)

      const handler = createAuthorizeHandler({
        registry,
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/login', handler)

      const res = await app.request('/auth/login?provider=github')

      expect(res.status).toBe(302)
      const location = res.headers.get('Location')
      expect(location).toContain('github.com')
    })
  })

  describe('createTokenEndpoint()', () => {
    it('handles refresh token flow', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const provider = createMockProvider({
        refreshToken: vi.fn().mockResolvedValue({
          access_token: 'new-access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
        } satisfies TokenResponse),
      })

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'old-token',
        refreshToken: 'old-refresh-token',
        provider: 'mock',
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
      expect(provider.refreshToken).toHaveBeenCalledWith('old-refresh-token')

      // Verify session was updated
      const updatedSession = await store.get('session-123')
      expect(updatedSession?.accessToken).toBe('new-access-token')
    })

    it('returns error when refresh token is missing', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const provider = createMockProvider()
      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'token',
        provider: 'mock',
        // No refresh token
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('refresh')
    })

    it('returns error when provider does not support refresh', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const provider = createMockProvider()
      // Remove refreshToken method
      delete (provider as Record<string, unknown>).refreshToken

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('not supported')
    })

    it('returns 401 when session is invalid', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const provider = createMockProvider()
      const store = createMockSessionStore()

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=nonexistent',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Integration with @dotdo/auth JWT verification', () => {
    it('can create JWT session token', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      let generatedToken: string | undefined

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        createSessionToken: async (session) => {
          // Simulate JWT creation
          generatedToken = `jwt.${btoa(JSON.stringify({ sub: session.userId }))}.sig`
          return generatedToken
        },
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${state}`)

      expect(res.status).toBe(302)
      expect(generatedToken).toBeDefined()
      expect(generatedToken).toContain('jwt.')
    })

    it('middleware can verify JWT from @dotdo/auth', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createMockSessionStore()

      // Simulate a JWT verification function
      const verifyJwt = async (token: string) => {
        if (token === 'valid-jwt-token') {
          return { sub: 'user-from-jwt', email: 'jwt@example.com' }
        }
        return null
      }

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          verifyToken: verifyJwt,
        })
      )
      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json({ userId: user?.sub })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer valid-jwt-token' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-from-jwt')
    })
  })

  describe('CSRF Protection', () => {
    it('validates CSRF token in state', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ csrfToken: 'csrf-123', redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        validateCsrf: true,
      })

      const app = new Hono()
      app.get('/callback', handler)

      // Valid state should work
      const res = await app.request(`/callback?code=auth-code&state=${state}`)
      expect(res.status).toBe(302)
    })
  })

  describe('Cookie Options', () => {
    it('sets secure cookie options in production', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        cookieOptions: {
          secure: true,
          sameSite: 'Strict',
          path: '/',
        },
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code-123&state=${state}`)

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('SameSite=Strict')
    })
  })
})
