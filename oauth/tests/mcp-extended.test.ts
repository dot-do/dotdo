/**
 * @dotdo/oauth MCP Flow Extended Tests
 *
 * Extended tests for MCP OAuth flow covering edge cases,
 * error handling, scope validation, and token exchange.
 *
 * @module @dotdo/oauth/tests/mcp-extended
 */

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import type { SessionStore, SessionData } from '../src/storage/interface'
import type { TokenResponse } from '../src/core/types'

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

describe('@dotdo/oauth MCP Flow Extended', () => {
  describe('validateMCPScopes()', () => {
    it('returns valid when all required scopes are present', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse: TokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp:tools mcp:resources read write',
      }

      const result = validateMCPScopes(tokenResponse, ['mcp:tools', 'read'])

      expect(result.valid).toBe(true)
      expect(result.grantedScopes).toContain('mcp:tools')
      expect(result.grantedScopes).toContain('read')
      expect(result.missingScopes).toBeUndefined()
    })

    it('returns invalid when required scopes are missing', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse: TokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read',
      }

      const result = validateMCPScopes(tokenResponse, ['mcp:tools', 'read', 'admin'])

      expect(result.valid).toBe(false)
      expect(result.missingScopes).toContain('mcp:tools')
      expect(result.missingScopes).toContain('admin')
      expect(result.missingScopes).not.toContain('read')
    })

    it('handles empty scope in token response', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse: TokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        // No scope field
      }

      const result = validateMCPScopes(tokenResponse, ['mcp:tools'])

      expect(result.valid).toBe(false)
      expect(result.grantedScopes).toEqual([])
      expect(result.missingScopes).toContain('mcp:tools')
    })

    it('handles empty required scopes', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse: TokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp:tools read',
      }

      const result = validateMCPScopes(tokenResponse, [])

      expect(result.valid).toBe(true)
      expect(result.grantedScopes).toContain('mcp:tools')
      expect(result.grantedScopes).toContain('read')
    })

    it('extracts all granted scopes correctly', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse: TokenResponse = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'mcp:tools mcp:resources mcp:prompts read write admin',
      }

      const result = validateMCPScopes(tokenResponse, ['read'])

      expect(result.grantedScopes).toHaveLength(6)
      expect(result.grantedScopes).toEqual(['mcp:tools', 'mcp:resources', 'mcp:prompts', 'read', 'write', 'admin'])
    })
  })

  describe('createMCPAuthorizeHandler()', () => {
    it('includes resource indicator in authorization URL', async () => {
      const { createMCPAuthorizeHandler } = await import('../src/mcp/mcp-flow')

      let capturedParams: Record<string, string> | undefined

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: (state: string, challenge: string, params?: Record<string, string>) => {
          capturedParams = params
          return `https://oauth.do/authorize?state=${state}&code_challenge=${challenge}`
        },
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const handler = createMCPAuthorizeHandler({
        provider: mockProvider,
        resourceIndicator: 'https://apis.do',
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/mcp', handler)

      await app.request('/auth/mcp')

      expect(capturedParams?.resource).toBe('https://apis.do')
    })

    it('includes scopes in authorization URL', async () => {
      const { createMCPAuthorizeHandler } = await import('../src/mcp/mcp-flow')

      let capturedParams: Record<string, string> | undefined

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: (state: string, challenge: string, params?: Record<string, string>) => {
          capturedParams = params
          return `https://oauth.do/authorize?state=${state}&code_challenge=${challenge}`
        },
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const handler = createMCPAuthorizeHandler({
        provider: mockProvider,
        scopes: ['mcp:tools', 'mcp:resources', 'read'],
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/mcp', handler)

      await app.request('/auth/mcp')

      expect(capturedParams?.scope).toBe('mcp:tools mcp:resources read')
    })

    it('stores redirect URI in state metadata', async () => {
      const { createMCPAuthorizeHandler } = await import('../src/mcp/mcp-flow')
      const { parseStateMetadata } = await import('../src/core/state')

      let storedState: string | undefined

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const handler = createMCPAuthorizeHandler({
        provider: mockProvider,
        storePKCE: async () => {},
        storeState: async (state) => {
          storedState = state
        },
        defaultRedirectUri: '/default',
      })

      const app = new Hono()
      app.get('/auth/mcp', handler)

      await app.request('/auth/mcp?redirect_uri=/custom')

      expect(storedState).toBeDefined()
      const metadata = parseStateMetadata(storedState!)
      expect(metadata?.redirectUri).toBe('/custom')
    })
  })

  describe('createMCPCallbackHandler()', () => {
    it('includes resource indicator in token exchange', async () => {
      const { createMCPCallbackHandler } = await import('../src/mcp/mcp-flow')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      let exchangeParams: Record<string, string> | undefined

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn().mockImplementation(async (code, verifier, params) => {
          exchangeParams = params
          return {
            access_token: 'token',
            token_type: 'Bearer' as const,
            expires_in: 3600,
          }
        }),
        getUser: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: 'user@example.com',
        }),
      }

      const store = createMockSessionStore()

      const handler = createMCPCallbackHandler({
        provider: mockProvider,
        sessionStore: store,
        resourceIndicator: 'https://apis.do',
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(exchangeParams?.resource).toBe('https://apis.do')
    })

    it('stores scope in session metadata', async () => {
      const { createMCPCallbackHandler } = await import('../src/mcp/mcp-flow')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn().mockResolvedValue({
          access_token: 'token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          scope: 'mcp:tools mcp:resources read',
        }),
        getUser: vi.fn().mockResolvedValue({
          id: 'user-123',
          email: 'user@example.com',
        }),
      }

      const store = createMockSessionStore()

      const handler = createMCPCallbackHandler({
        provider: mockProvider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(store.sessions.size).toBe(1)
      const [[, sessionData]] = store.sessions.entries()
      expect(sessionData.metadata?.scope).toBe('mcp:tools mcp:resources read')
    })

    it('handles token exchange failure', async () => {
      const { createMCPCallbackHandler } = await import('../src/mcp/mcp-flow')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/' })

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn().mockRejectedValue(new Error('Token exchange failed')),
        getUser: vi.fn(),
      }

      const store = createMockSessionStore()

      const handler = createMCPCallbackHandler({
        provider: mockProvider,
        sessionStore: store,
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      const res = await app.request(`/callback?code=auth-code&state=${state}`)

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Token exchange failed')
    })
  })

  describe('createMCPTokenEndpoint()', () => {
    it('supports refresh_token grant with resource indicator', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      let refreshParams: Record<string, string> | undefined

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
        refreshToken: vi.fn().mockImplementation(async (token, params) => {
          refreshParams = params
          return {
            access_token: 'new-token',
            token_type: 'Bearer' as const,
            expires_in: 3600,
          }
        }),
      }

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
        sessionStore: store,
        resourceIndicator: 'https://apis.do',
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
      expect(refreshParams?.resource).toBe('https://apis.do')
    })

    it('returns 400 when token exchange not supported', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user',
        accessToken: 'token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
        sessionStore: store,
        supportTokenExchange: false, // Disabled
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('not supported')
    })

    it('supports token exchange grant type', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      let exchangeArgs: unknown[] = []

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
        tokenExchange: vi.fn().mockImplementation(async (...args) => {
          exchangeArgs = args
          return {
            access_token: 'exchanged-token',
            token_type: 'Bearer' as const,
            expires_in: 3600,
          }
        }),
      }

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user',
        accessToken: 'subject-token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
        sessionStore: store,
        resourceIndicator: 'https://apis.do',
        supportTokenExchange: true,
      })

      const app = new Hono()
      app.post('/token', handler)

      const res = await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        }),
      })

      expect(res.status).toBe(200)
      expect(mockProvider.tokenExchange).toHaveBeenCalled()
      expect(exchangeArgs[0]).toBe('subject-token')
      expect(exchangeArgs[1]).toBe('urn:ietf:params:oauth:token-type:access_token')
    })

    it('returns 400 for unsupported grant type', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user',
        accessToken: 'token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
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
        body: JSON.stringify({
          grant_type: 'client_credentials',
        }),
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Unsupported grant_type')
    })

    it('returns 401 when session not found', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
      }

      const store = createMockSessionStore()

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
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

    it('updates session after token exchange', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      const mockProvider = {
        name: 'mcp',
        getAuthorizationUrl: () => 'https://oauth.do/authorize',
        exchangeCode: vi.fn(),
        getUser: vi.fn(),
        tokenExchange: vi.fn().mockResolvedValue({
          access_token: 'exchanged-access-token',
          token_type: 'Bearer' as const,
          expires_in: 7200,
          refresh_token: 'new-refresh-token',
        }),
      }

      const store = createMockSessionStore()
      await store.set('session-123', {
        userId: 'user',
        accessToken: 'old-token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider: mockProvider,
        sessionStore: store,
        supportTokenExchange: true,
      })

      const app = new Hono()
      app.post('/token', handler)

      await app.request('/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'session=session-123',
        },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        }),
      })

      const updatedSession = await store.get('session-123')
      expect(updatedSession?.accessToken).toBe('exchanged-access-token')
      expect(updatedSession?.refreshToken).toBe('new-refresh-token')
      expect(updatedSession?.expiresAt).toBeDefined()
    })
  })

  describe('MCP Metadata Handlers', () => {
    it('createMCPServerMetadataHandler returns valid metadata', async () => {
      const { createMCPServerMetadataHandler } = await import('../src/mcp/server-metadata')

      const handler = createMCPServerMetadataHandler({
        resourceServer: 'https://apis.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        scopesSupported: ['mcp:tools', 'mcp:resources'],
        mcpVersion: '1.0',
      })

      const app = new Hono()
      app.get('/.well-known/mcp-server-metadata', handler)

      const res = await app.request('/.well-known/mcp-server-metadata')

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.resource_server).toBe('https://apis.do')
      expect(json.authorization_endpoint).toBe('https://oauth.do/authorize')
      expect(json.scopes_supported).toContain('mcp:tools')
      expect(json.mcp_version).toBe('1.0')
    })

    it('createAuthServerMetadataHandler returns RFC 8414 compliant metadata', async () => {
      const { createAuthServerMetadataHandler } = await import('../src/mcp/auth-server-metadata')

      const handler = createAuthServerMetadataHandler({
        issuer: 'https://oauth.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        scopesSupported: ['read', 'write'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-authorization-server', handler)

      const res = await app.request('/.well-known/oauth-authorization-server')

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.issuer).toBe('https://oauth.do')
      expect(json.code_challenge_methods_supported).toContain('S256')
      expect(json.grant_types_supported).toContain('authorization_code')
    })

    it('createProtectedResourceMetadataHandler returns RFC 9728 compliant metadata', async () => {
      const { createProtectedResourceMetadataHandler } = await import('../src/mcp/resource-metadata')

      const handler = createProtectedResourceMetadataHandler({
        resource: 'https://apis.do',
        authorizationServers: ['https://oauth.do'],
        scopesSupported: ['read', 'write'],
        bearerMethodsSupported: ['header'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-protected-resource', handler)

      const res = await app.request('/.well-known/oauth-protected-resource')

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.resource).toBe('https://apis.do')
      expect(json.authorization_servers).toEqual(['https://oauth.do'])
      expect(json.bearer_methods_supported).toEqual(['header'])
    })
  })
})
