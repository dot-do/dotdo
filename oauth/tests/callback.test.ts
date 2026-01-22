/**
 * @dotdo/oauth Callback Handler Tests
 *
 * Extended tests for the callback handler covering edge cases,
 * error handling, cookie generation, and session creation.
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/callback
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createTestProvider, createTestSessionStore } from './test-utils'
import type { SessionData } from '../src/storage/interface'
import type { PKCEPair } from '../src/core/types'

describe('@dotdo/oauth callback handler', () => {
  describe('createCallbackHandler() parameter validation', () => {
    it('returns 400 when code is missing', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider({ trackCalls: true })
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

      expect(provider.calls.exchangeCodeCalls).toHaveLength(1)
      expect(provider.calls.exchangeCodeCalls[0].code).toBe('test-auth-code')
      expect(provider.calls.exchangeCodeCalls[0].verifier).toBe(pkce.verifier)
    })

    it('returns 400 when token exchange fails', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider({
        failExchangeCode: true,
        errorMessage: 'Token exchange error',
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

      const store = createTestSessionStore()
      const provider = createTestProvider({
        failGetUser: true,
        errorMessage: 'User info error',
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

      const store = createTestSessionStore()
      const provider = createTestProvider({
        user: {
          id: 'user-456',
          email: 'user@example.com',
          name: 'John Doe',
          picture: 'https://example.com/avatar.jpg',
        },
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
      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.userId).toBe('user-456')
      expect(storedSession.data.provider).toBe('test')
      expect(storedSession.data.metadata?.email).toBe('user@example.com')
      expect(storedSession.data.metadata?.name).toBe('John Doe')
      expect(storedSession.data.metadata?.picture).toBe('https://example.com/avatar.jpg')
    })

    it('stores refresh token when provided', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider({
        tokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'refresh-token-xyz',
        },
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

      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.refreshToken).toBe('refresh-token-xyz')
    })

    it('sets expiresAt from token response', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider({
        tokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer' as const,
          expires_in: 7200, // 2 hours
        },
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

      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.expiresAt).toBeDefined()
      // Should be approximately 2 hours from now
      expect(storedSession.data.expiresAt).toBeGreaterThan(now + 7000 * 1000)
      expect(storedSession.data.expiresAt).toBeLessThan(now + 7400 * 1000)
    })

    it('does not set optional fields when not provided', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider({
        tokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer' as const,
          // No expires_in, no refresh_token
          expires_in: 0,
        },
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

      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.refreshToken).toBeUndefined()
    })
  })

  describe('createCallbackHandler() cookie handling', () => {
    it('sets session cookie with default name', async () => {
      const { createCallbackHandler } = await import('../src/middleware/callback')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
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

      const store = createTestSessionStore()
      const provider = createTestProvider()
      const pkce = await generatePKCE()
      // Create state without redirectUri
      const state = await createStateWithMetadata({ provider: 'test' })

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

      const store = createTestSessionStore()
      const provider = createTestProvider()
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ provider: 'test' })

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

      const store = createTestSessionStore()
      const provider = createTestProvider({
        user: {
          id: 'user-123',
          email: 'test@example.com',
        },
      })
      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      let capturedSession: SessionData | undefined
      let createSessionTokenCalled = false

      const handler = createCallbackHandler({
        provider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
        createSessionToken: async (session) => {
          createSessionTokenCalled = true
          capturedSession = session
          return 'jwt-token-123'
        },
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(createSessionTokenCalled).toBe(true)
      expect(capturedSession?.userId).toBe('user-123')
    })
  })
})
