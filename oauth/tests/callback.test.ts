/**
 * @dotdo/oauth Callback Handler Tests
 *
 * Extended tests for the callback handler covering edge cases,
 * error handling, cookie generation, and session creation.
 *
 * @module @dotdo/oauth/tests/callback
 */

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import type { OAuthProvider, UserInfo } from '../src/providers/interface'
import type { SessionStore, SessionData } from '../src/storage/interface'
import type { TokenResponse, PKCEPair } from '../src/core/types'

// Mock session store
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

// Mock OAuth provider
function createMockProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    name: 'mock',
    getAuthorizationUrl: vi.fn(),
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

describe('@dotdo/oauth callback handler', () => {
  describe('createCallbackHandler() parameter validation', () => {
    it('returns 400 when code is missing', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?state=${state}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('code')
    })

    it('returns 400 when state is missing', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request('/callback?code=auth-code')

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('state')
    })

    it('returns 400 when state does not match stored state', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const storedState = await createStateWithMetadata({ redirectUri: '/' })
      const differentState = await createStateWithMetadata({ redirectUri: '/other' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => storedState,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${differentState}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('state')
    })
  })

  describe('createCallbackHandler() token exchange', () => {
    it('calls exchangeCode with code and verifier', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=test-auth-code&state=${state}`)

      expect(provider.exchangeCode).toHaveBeenCalledWith('test-auth-code', pkce.verifier)
    })

    it('returns 400 when token exchange fails', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        exchangeCode: vi.fn().mockRejectedValue(new Error('Token exchange error')),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

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
      expect(json.error).toContain('Token exchange error')
    })

    it('returns 400 when getUser fails', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        getUser: vi.fn().mockRejectedValue(new Error('User info error')),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('User info error')
    })
  })

  describe('createCallbackHandler() session creation', () => {
    it('creates session with user data', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        getUser: vi.fn().mockResolvedValue({
          id: 'user-456',
          email: 'user@example.com',
          name: 'John Doe',
          picture: 'https://example.com/avatar.jpg',
        }),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(store.sessions.size).toBe(1)
      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.userId).toBe('user-456')
      expect(sessionData.provider).toBe('mock')
      expect(sessionData.metadata?.email).toBe('user@example.com')
      expect(sessionData.metadata?.name).toBe('John Doe')
      expect(sessionData.metadata?.picture).toBe('https://example.com/avatar.jpg')
    })

    it('stores refresh token when provided', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        exchangeCode: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refresh-token-xyz',
        }),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.refreshToken).toBe('refresh-token-xyz')
    })

    it('sets expiresAt from token response', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        exchangeCode: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 7200, // 2 hours
        }),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const now = Date.now()
      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.expiresAt).toBeDefined()
      // Should be approximately 2 hours from now
      expect(sessionData.expiresAt).toBeGreaterThan(now + 7000 * 1000)
      expect(sessionData.expiresAt).toBeLessThan(now + 7400 * 1000)
    })

    it('does not set optional fields when not provided', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider({
        exchangeCode: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          token_type: 'Bearer',
          // No expires_in, no refresh_token
        }),
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.refreshToken).toBeUndefined()
      expect(sessionData.expiresAt).toBeUndefined()
    })
  })

  describe('createCallbackHandler() cookie handling', () => {
    it('sets session cookie with default name', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('session=')
      expect(setCookie).toContain('HttpOnly')
    })

    it('uses custom cookie name', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        cookieName: 'my_session',
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('my_session=')
    })

    it('applies cookie options', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        cookieOptions: {
          secure: true,
          sameSite: 'Strict',
          path: '/app',
          domain: '.example.com',
          maxAge: 86400,
        },
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('SameSite=Strict')
      expect(setCookie).toContain('Path=/app')
      expect(setCookie).toContain('Domain=.example.com')
      expect(setCookie).toContain('Max-Age=86400')
    })
  })

  describe('createCallbackHandler() redirect behavior', () => {
    it('redirects to stored redirect URI', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/my-dashboard' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/my-dashboard')
    })

    it('uses default redirect when state has no redirect URI', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      // Create state without redirectUri
      const state = await createStateWithMetadata({ provider: 'mock' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        defaultRedirect: '/home',
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/home')
    })

    it('defaults to "/" when no redirect is configured', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ provider: 'mock' })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/')
    })
  })

  describe('createCallbackHandler() JWT creation', () => {
    it('calls createSessionToken when provided', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createMockSessionStore()
      const provider = createMockProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      let capturedSession: SessionData | undefined
      const createSessionToken = vi.fn().mockImplementation(async (session) => {
        capturedSession = session
        return 'jwt-token-123'
      })

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        createSessionToken,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(createSessionToken).toHaveBeenCalled()
      expect(capturedSession?.userId).toBe('user-123')
    })
  })
})
