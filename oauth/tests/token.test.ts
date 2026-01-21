/**
 * @dotdo/oauth Token Endpoint Tests
 *
 * Extended tests for the token endpoint handler covering refresh token flow,
 * session updates, error handling, and authentication.
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/token
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createTestProvider, createTestSessionStore, type TestProviderConfig } from './test-utils'
import type { TokenResponse } from '../src/core/types'

/**
 * Create a test provider with refresh token support configured.
 */
function createRefreshableProvider(config: TestProviderConfig = {}) {
  return createTestProvider({
    name: 'mock',
    refreshTokenResponse: {
      access_token: 'new-access-token',
      token_type: 'Bearer' as const,
      expires_in: 3600,
      refresh_token: 'new-refresh-token',
    },
    ...config,
  })
}

describe('@dotdo/oauth token endpoint', () => {
  describe('createTokenEndpoint() authentication', () => {
    it('returns 401 when no session identifier provided', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      const provider = createRefreshableProvider()

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
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 when session does not exist', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      const provider = createRefreshableProvider()

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
          Cookie: 'session=nonexistent-session',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(401)
    })

    it('accepts session from Authorization header', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-from-header', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
          Authorization: 'Bearer session-from-header',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
    })

    it('accepts session from cookie', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-from-cookie', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
          Cookie: 'session=session-from-cookie',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
    })

    it('uses custom cookie name', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('my-session-id', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
        cookieName: 'my_custom_session',
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'my_custom_session=my-session-id',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
    })
  })

  describe('createTokenEndpoint() request validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'token',
        refreshToken: 'refresh',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
        body: 'invalid json',
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid request')
    })

    it('returns 400 for unsupported grant_type', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'token',
        refreshToken: 'refresh',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('grant_type')
    })
  })

  describe('createTokenEndpoint() refresh token validation', () => {
    it('returns 400 when session has no refresh token', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'token',
        // No refresh token
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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

    it('returns 400 when provider does not support refresh', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()
      // Remove refreshToken method
      delete (provider as Record<string, unknown>).refreshToken

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
  })

  describe('createTokenEndpoint() token refresh', () => {
    it('calls provider.refreshToken with stored refresh token', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'stored-refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      // Verify refreshToken was called with correct arguments using call tracking
      expect(provider.calls.refreshTokenCalls).toHaveLength(1)
      expect(provider.calls.refreshTokenCalls[0].refreshToken).toBe('stored-refresh-token')
    })

    it('returns 400 when refresh fails', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'invalid-refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider({
        failRefresh: true,
        errorMessage: 'Refresh failed',
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
      expect(json.error).toContain('Refresh failed')
    })
  })

  describe('createTokenEndpoint() session update', () => {
    it('updates session with new access token', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider({
        refreshTokenResponse: {
          access_token: 'brand-new-access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
        },
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.accessToken).toBe('brand-new-access-token')
    })

    it('updates refresh token when new one is provided', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider({
        refreshTokenResponse: {
          access_token: 'new-access',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'rotated-refresh-token',
        },
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.refreshToken).toBe('rotated-refresh-token')
    })

    it('keeps old refresh token when new one is not provided', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'original-refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider({
        refreshTokenResponse: {
          access_token: 'new-access',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          // No refresh_token in response
        },
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.refreshToken).toBe('original-refresh-token')
    })

    it('updates expiresAt from token response', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000, // Already expired
        provider: 'mock',
      })

      const now = Date.now()
      const provider = createRefreshableProvider({
        refreshTokenResponse: {
          access_token: 'new-access',
          token_type: 'Bearer' as const,
          expires_in: 7200, // 2 hours
        },
      })

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.expiresAt).toBeGreaterThan(now + 7000 * 1000)
    })

    it('preserves session metadata', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
        metadata: { role: 'admin', email: 'user@example.com' },
      })

      const provider = createRefreshableProvider()

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.metadata).toEqual({ role: 'admin', email: 'user@example.com' })
    })

    it('preserves userId and provider', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'original-user-id',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'original-provider',
      })

      const provider = createRefreshableProvider()

      const handler = createTokenEndpoint({
        provider,
        sessionStore: store,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.userId).toBe('original-user-id')
      expect(updatedSession?.provider).toBe('original-provider')
    })
  })

  describe('createTokenEndpoint() response', () => {
    it('returns success response with expires_in', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider({
        refreshTokenResponse: {
          access_token: 'new-access',
          token_type: 'Bearer' as const,
          expires_in: 7200,
        },
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
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.expires_in).toBe(7200)
    })

    it('does not expose tokens in response', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'user-123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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

      const json = await res.json()
      expect(json.access_token).toBeUndefined()
      expect(json.refresh_token).toBeUndefined()
    })
  })

  describe('Cookie parsing edge cases', () => {
    it('handles multiple cookies', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('correct-session', {
        userId: 'user-123',
        accessToken: 'token',
        refreshToken: 'refresh',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
          Cookie: 'other=value; session=correct-session; another=cookie',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
    })

    it('handles cookies with special characters', async () => {
      const { createTokenEndpoint } = await import('../src/middleware/token')

      const store = createTestSessionStore()
      await store.set('session-id=with=equals', {
        userId: 'user-123',
        accessToken: 'token',
        refreshToken: 'refresh',
        provider: 'mock',
      })

      const provider = createRefreshableProvider()

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
          Cookie: 'session=session-id=with=equals',
        },
        body: JSON.stringify({ grant_type: 'refresh_token' }),
      })

      expect(res.status).toBe(200)
    })
  })
})
