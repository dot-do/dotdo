/**
 * @dotdo/oauth Middleware Tests
 *
 * Tests for Hono middleware and OAuth callback handlers.
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/middleware
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestProvider, createTestSessionStore, createMinimalProvider } from './test-utils'
import type { TokenResponse } from '../src/core/types'

describe('@dotdo/oauth middleware', () => {
  describe('oauthMiddleware()', () => {
    it('validates session from cookie', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

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
      const store = createTestSessionStore()

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
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')

      expect(res.status).toBe(401)
    })

    it('returns 401 when session does not exist in store', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

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
      const store = createTestSessionStore()

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
      const store = createTestSessionStore()

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

      const store = createTestSessionStore()
      const provider = createTestProvider({ trackCalls: true })

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

      expect(provider.calls.exchangeCodeCalls).toHaveLength(1)
      expect(provider.calls.exchangeCodeCalls[0].code).toBe('auth-code-123')
      expect(provider.calls.exchangeCodeCalls[0].verifier).toBe(pkce.verifier)
    })

    it('creates session in store after successful exchange', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider({
        tokenResponse: {
          access_token: 'mock-access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
        },
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
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

      await app.request(`/callback?code=auth-code-123&state=${state}`)

      // Verify session was created
      expect(store.sessions.size).toBe(1)
      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.userId).toBe('user-123')
      expect(storedSession.data.accessToken).toBe('mock-access-token')
      expect(storedSession.data.provider).toBe('test')
    })

    it('returns error when state is invalid', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider()

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

      const store = createTestSessionStore()
      const provider = createTestProvider({
        failExchangeCode: true,
        errorMessage: 'Invalid code',
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

      const store = createTestSessionStore()
      const provider = createTestProvider()

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

      const store = createTestSessionStore()
      const provider = createTestProvider()

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

      const provider = createTestProvider()
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
      expect(location).toContain('test.provider.test/authorize')
      expect(location).toContain('state=')
      expect(location).toContain('code_challenge=')

      // Verify PKCE and state were stored
      expect(storedPKCE).toBeDefined()
      expect(storedState).toBeDefined()
    })

    it('includes redirect URI in state metadata', async () => {
      const { createAuthorizeHandler } = await import('../src/middleware/authorize')
      const { parseStateMetadata } = await import('../src/core/state')

      const provider = createTestProvider()
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

      const provider = createTestProvider()
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

      const googleProvider = createTestProvider({ name: 'google' })
      const githubProvider = createTestProvider({ name: 'github' })

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

      const provider = createTestProvider({
        refreshTokenResponse: {
          access_token: 'new-access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
        },
      })

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'old-token',
        refreshToken: 'old-refresh-token',
        provider: 'test',
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
      expect(provider.calls.refreshTokenCalls).toHaveLength(1)
      expect(provider.calls.refreshTokenCalls[0].refreshToken).toBe('old-refresh-token')

      // Verify session was updated
      const updatedSession = await store.get('session-123')
      expect(updatedSession?.accessToken).toBe('new-access-token')
    })

    it('returns error when refresh token is missing', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const provider = createTestProvider()
      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'token',
        provider: 'test',
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

      // Create a provider without the refreshToken method
      const provider = createMinimalProvider({ noRefreshToken: true })

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-456',
        accessToken: 'token',
        refreshToken: 'refresh-token',
        provider: 'test',
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

      const provider = createTestProvider()
      const store = createTestSessionStore()

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

      const store = createTestSessionStore()
      const provider = createTestProvider()

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
      const store = createTestSessionStore()

      // Use a Map for valid tokens instead of mocking
      const validTokens = new Map<string, Record<string, unknown>>([
        ['valid-jwt-token', { sub: 'user-from-jwt', email: 'jwt@example.com' }],
      ])

      const verifyJwt = async (token: string) => {
        return validTokens.get(token) ?? null
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

      const store = createTestSessionStore()
      const provider = createTestProvider()

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

      const store = createTestSessionStore()
      const provider = createTestProvider()

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
