/**
 * @dotdo/oauth MCP OAuth 2.1 Tests (RFC 9728)
 *
 * Tests for MCP Server Metadata, OAuth Authorization Server Metadata (RFC 8414),
 * Resource Indicator support (RFC 8707), and Protected Resource Metadata (RFC 9728).
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/mcp
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { TestProvider, createTestProvider, createTestSessionStore } from './test-utils'

describe('@dotdo/oauth MCP OAuth 2.1 (RFC 9728)', () => {
  describe('MCP Server Metadata Endpoint', () => {
    it('returns valid MCP server metadata at /.well-known/mcp-server-metadata', async () => {
      const { createMCPServerMetadataHandler } = await import('../src/mcp/server-metadata')

      const handler = createMCPServerMetadataHandler({
        resourceServer: 'https://apis.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
      })

      const app = new Hono()
      app.get('/.well-known/mcp-server-metadata', handler)

      const res = await app.request('/.well-known/mcp-server-metadata')

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('application/json')

      const json = await res.json()
      expect(json.resource_server).toBe('https://apis.do')
      expect(json.authorization_endpoint).toBe('https://oauth.do/authorize')
      expect(json.token_endpoint).toBe('https://oauth.do/token')
    })

    it('includes optional MCP metadata fields', async () => {
      const { createMCPServerMetadataHandler } = await import('../src/mcp/server-metadata')

      const handler = createMCPServerMetadataHandler({
        resourceServer: 'https://apis.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        registrationEndpoint: 'https://oauth.do/register',
        revocationEndpoint: 'https://oauth.do/revoke',
        introspectionEndpoint: 'https://oauth.do/introspect',
        resourceIndicator: 'https://apis.do',
        scopesSupported: ['read', 'write', 'admin', 'mcp:tools', 'mcp:resources'],
        mcpVersion: '1.0',
      })

      const app = new Hono()
      app.get('/.well-known/mcp-server-metadata', handler)

      const res = await app.request('/.well-known/mcp-server-metadata')
      const json = await res.json()

      expect(json.registration_endpoint).toBe('https://oauth.do/register')
      expect(json.revocation_endpoint).toBe('https://oauth.do/revoke')
      expect(json.introspection_endpoint).toBe('https://oauth.do/introspect')
      expect(json.resource_indicator).toBe('https://apis.do')
      expect(json.scopes_supported).toEqual(['read', 'write', 'admin', 'mcp:tools', 'mcp:resources'])
      expect(json.mcp_version).toBe('1.0')
    })

    it('includes CORS headers for MCP client access', async () => {
      const { createMCPServerMetadataHandler } = await import('../src/mcp/server-metadata')

      const handler = createMCPServerMetadataHandler({
        resourceServer: 'https://apis.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        enableCors: true,
      })

      const app = new Hono()
      app.get('/.well-known/mcp-server-metadata', handler)

      const res = await app.request('/.well-known/mcp-server-metadata')

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    })
  })

  describe('OAuth Authorization Server Metadata (RFC 8414)', () => {
    it('returns valid AS metadata at /.well-known/oauth-authorization-server', async () => {
      const { createAuthServerMetadataHandler } = await import('../src/mcp/auth-server-metadata')

      const handler = createAuthServerMetadataHandler({
        issuer: 'https://oauth.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        scopesSupported: ['read', 'write', 'admin'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-authorization-server', handler)

      const res = await app.request('/.well-known/oauth-authorization-server')

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('application/json')

      const json = await res.json()
      expect(json.issuer).toBe('https://oauth.do')
      expect(json.authorization_endpoint).toBe('https://oauth.do/authorize')
      expect(json.token_endpoint).toBe('https://oauth.do/token')
      expect(json.scopes_supported).toEqual(['read', 'write', 'admin'])
    })

    it('includes required OAuth 2.1 metadata fields', async () => {
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
      const json = await res.json()

      // OAuth 2.1 requires PKCE
      expect(json.code_challenge_methods_supported).toContain('S256')
      // OAuth 2.1 only supports authorization code grant
      expect(json.grant_types_supported).toContain('authorization_code')
      expect(json.response_types_supported).toContain('code')
      // Token endpoint auth methods
      expect(json.token_endpoint_auth_methods_supported).toBeDefined()
    })

    it('includes optional RFC 8414 fields when provided', async () => {
      const { createAuthServerMetadataHandler } = await import('../src/mcp/auth-server-metadata')

      const handler = createAuthServerMetadataHandler({
        issuer: 'https://oauth.do',
        authorizationEndpoint: 'https://oauth.do/authorize',
        tokenEndpoint: 'https://oauth.do/token',
        scopesSupported: ['read', 'write'],
        jwksUri: 'https://oauth.do/.well-known/jwks.json',
        registrationEndpoint: 'https://oauth.do/register',
        revocationEndpoint: 'https://oauth.do/revoke',
        introspectionEndpoint: 'https://oauth.do/introspect',
        serviceDocumentation: 'https://docs.oauth.do',
        uiLocalesSupported: ['en', 'es'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-authorization-server', handler)

      const res = await app.request('/.well-known/oauth-authorization-server')
      const json = await res.json()

      expect(json.jwks_uri).toBe('https://oauth.do/.well-known/jwks.json')
      expect(json.registration_endpoint).toBe('https://oauth.do/register')
      expect(json.revocation_endpoint).toBe('https://oauth.do/revoke')
      expect(json.introspection_endpoint).toBe('https://oauth.do/introspect')
      expect(json.service_documentation).toBe('https://docs.oauth.do')
      expect(json.ui_locales_supported).toEqual(['en', 'es'])
    })

    it('supports path-specific issuer with /:issuer suffix', async () => {
      const { createAuthServerMetadataHandler } = await import('../src/mcp/auth-server-metadata')

      const handler = createAuthServerMetadataHandler({
        issuer: 'https://oauth.do/tenant-123',
        authorizationEndpoint: 'https://oauth.do/tenant-123/authorize',
        tokenEndpoint: 'https://oauth.do/tenant-123/token',
        scopesSupported: ['read'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-authorization-server/:issuer', handler)

      const res = await app.request('/.well-known/oauth-authorization-server/tenant-123')
      const json = await res.json()

      expect(json.issuer).toBe('https://oauth.do/tenant-123')
    })
  })

  describe('Protected Resource Metadata (RFC 9728)', () => {
    it('returns valid protected resource metadata at /.well-known/oauth-protected-resource', async () => {
      const { createProtectedResourceMetadataHandler } = await import('../src/mcp/resource-metadata')

      const handler = createProtectedResourceMetadataHandler({
        resource: 'https://apis.do',
        authorizationServers: ['https://oauth.do'],
        scopesSupported: ['read', 'write'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-protected-resource', handler)

      const res = await app.request('/.well-known/oauth-protected-resource')

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('application/json')

      const json = await res.json()
      expect(json.resource).toBe('https://apis.do')
      expect(json.authorization_servers).toEqual(['https://oauth.do'])
      expect(json.scopes_supported).toEqual(['read', 'write'])
    })

    it('includes bearer token methods per RFC 9728', async () => {
      const { createProtectedResourceMetadataHandler } = await import('../src/mcp/resource-metadata')

      const handler = createProtectedResourceMetadataHandler({
        resource: 'https://apis.do',
        authorizationServers: ['https://oauth.do'],
        scopesSupported: ['read', 'write'],
        bearerMethodsSupported: ['header', 'body', 'query'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-protected-resource', handler)

      const res = await app.request('/.well-known/oauth-protected-resource')
      const json = await res.json()

      expect(json.bearer_methods_supported).toEqual(['header', 'body', 'query'])
    })

    it('includes resource documentation URL', async () => {
      const { createProtectedResourceMetadataHandler } = await import('../src/mcp/resource-metadata')

      const handler = createProtectedResourceMetadataHandler({
        resource: 'https://apis.do',
        authorizationServers: ['https://oauth.do'],
        scopesSupported: ['read'],
        resourceDocumentation: 'https://docs.apis.do',
      })

      const app = new Hono()
      app.get('/.well-known/oauth-protected-resource', handler)

      const res = await app.request('/.well-known/oauth-protected-resource')
      const json = await res.json()

      expect(json.resource_documentation).toBe('https://docs.apis.do')
    })

    it('supports multiple authorization servers', async () => {
      const { createProtectedResourceMetadataHandler } = await import('../src/mcp/resource-metadata')

      const handler = createProtectedResourceMetadataHandler({
        resource: 'https://apis.do',
        authorizationServers: ['https://oauth.do', 'https://auth.example.com'],
        scopesSupported: ['read'],
      })

      const app = new Hono()
      app.get('/.well-known/oauth-protected-resource', handler)

      const res = await app.request('/.well-known/oauth-protected-resource')
      const json = await res.json()

      expect(json.authorization_servers).toHaveLength(2)
      expect(json.authorization_servers).toContain('https://oauth.do')
      expect(json.authorization_servers).toContain('https://auth.example.com')
    })
  })

  describe('Resource Indicator Support (RFC 8707)', () => {
    it('adds resource parameter to authorization URL', async () => {
      const { createMCPAuthorizeHandler } = await import('../src/mcp/mcp-flow')

      let capturedUrl: string | undefined

      const provider = createTestProvider({
        name: 'mcp',
        trackCalls: true,
      })

      // Override getAuthorizationUrl to capture the URL
      const originalGetAuthUrl = provider.getAuthorizationUrl.bind(provider)
      provider.getAuthorizationUrl = (state: string, challenge: string, params?: Record<string, string>) => {
        const url = new URL('https://oauth.do/authorize')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', challenge)
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value)
          }
        }
        capturedUrl = url.toString()
        return capturedUrl
      }

      const handler = createMCPAuthorizeHandler({
        provider,
        resourceIndicator: 'https://apis.do',
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/mcp', handler)

      const res = await app.request('/auth/mcp?redirect_uri=/dashboard')

      expect(res.status).toBe(302)
      expect(capturedUrl).toContain('resource=https%3A%2F%2Fapis.do')
    })

    it('includes resource in token exchange request', async () => {
      const { createMCPCallbackHandler } = await import('../src/mcp/mcp-flow')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata } = await import('../src/core/state')

      const pkce = await generatePKCE()
      const state = await createStateWithMetadata({ redirectUri: '/dashboard' })

      let exchangeParams: Record<string, string> | undefined

      const provider = createTestProvider({
        name: 'mcp',
        trackCalls: true,
        tokenResponse: {
          access_token: 'mcp-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
        },
        user: {
          id: 'mcp-user',
          email: 'mcp@example.com',
        },
      })

      // Override exchangeCode to capture params
      const originalExchange = provider.exchangeCode.bind(provider)
      provider.exchangeCode = async (code: string, verifier: string, params?: Record<string, string>) => {
        exchangeParams = params
        return originalExchange(code, verifier, params)
      }

      const store = createTestSessionStore()

      const handler = createMCPCallbackHandler({
        provider,
        sessionStore: store,
        resourceIndicator: 'https://apis.do',
        getStoredPKCE: async () => pkce,
        getStoredState: async () => state,
      })

      const app = new Hono()
      app.get('/callback', handler)

      await app.request(`/callback?code=auth-code&state=${state}`)

      expect(provider.calls.exchangeCodeCalls.length).toBeGreaterThan(0)
      expect(exchangeParams?.resource).toBe('https://apis.do')
    })
  })

  describe('MCP Client Auth Flow', () => {
    it('supports MCP-specific scopes', async () => {
      const { createMCPAuthorizeHandler } = await import('../src/mcp/mcp-flow')

      let capturedUrl: string | undefined

      const provider = createTestProvider({ name: 'mcp' })

      provider.getAuthorizationUrl = (state: string, challenge: string, params?: Record<string, string>) => {
        const url = new URL('https://oauth.do/authorize')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', challenge)
        if (params?.scope) {
          url.searchParams.set('scope', params.scope)
        }
        capturedUrl = url.toString()
        return capturedUrl
      }

      const handler = createMCPAuthorizeHandler({
        provider,
        scopes: ['mcp:tools', 'mcp:resources', 'read'],
        storePKCE: async () => {},
        storeState: async () => {},
      })

      const app = new Hono()
      app.get('/auth/mcp', handler)

      await app.request('/auth/mcp')

      expect(capturedUrl).toContain('scope=mcp%3Atools')
      expect(capturedUrl).toContain('mcp%3Aresources')
      expect(capturedUrl).toContain('read')
    })

    it('validates MCP scopes in token response', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse = {
        access_token: 'token',
        token_type: 'Bearer' as const,
        expires_in: 3600,
        scope: 'mcp:tools mcp:resources read',
      }

      const result = validateMCPScopes(tokenResponse, ['mcp:tools', 'read'])

      expect(result.valid).toBe(true)
      expect(result.grantedScopes).toContain('mcp:tools')
      expect(result.grantedScopes).toContain('read')
    })

    it('returns error when required MCP scopes are missing', async () => {
      const { validateMCPScopes } = await import('../src/mcp/mcp-flow')

      const tokenResponse = {
        access_token: 'token',
        token_type: 'Bearer' as const,
        expires_in: 3600,
        scope: 'read',
      }

      const result = validateMCPScopes(tokenResponse, ['mcp:tools', 'read'])

      expect(result.valid).toBe(false)
      expect(result.missingScopes).toContain('mcp:tools')
    })
  })

  describe('Token Exchange with MCP Resource Indicator', () => {
    it('refreshes token with resource indicator', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      let refreshParams: Record<string, string> | undefined

      const provider = createTestProvider({
        name: 'mcp',
        refreshTokenResponse: {
          access_token: 'new-mcp-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'new-refresh',
        },
      })

      // Override refreshToken to capture params
      provider.refreshToken = async (token: string, params?: Record<string, string>) => {
        refreshParams = params
        return {
          access_token: 'new-mcp-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'new-refresh',
        }
      }

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'mcp-user',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider,
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

    it('supports token exchange grant type for MCP', async () => {
      const { createMCPTokenEndpoint } = await import('../src/mcp/mcp-flow')

      const provider = createTestProvider({
        name: 'mcp',
        tokenExchangeResponse: {
          access_token: 'exchanged-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
        },
      })

      const store = createTestSessionStore()
      await store.set('session-123', {
        userId: 'mcp-user',
        accessToken: 'subject-token',
        provider: 'mcp',
      })

      const handler = createMCPTokenEndpoint({
        provider,
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
          resource: 'https://apis.do',
        }),
      })

      expect(res.status).toBe(200)
      expect(provider.calls.tokenExchangeCalls.length).toBeGreaterThan(0)
    })
  })

  describe('MCP Metadata Type Exports', () => {
    it('exports MCPServerMetadata type', async () => {
      const { SampleMCPServerMetadata } = await import('../src/mcp')
      // Type-only check - if this compiles, the type exists
      const metadata: typeof SampleMCPServerMetadata = {
        resource_server: 'https://apis.do',
        authorization_endpoint: 'https://oauth.do/authorize',
        token_endpoint: 'https://oauth.do/token',
      }
      expect(metadata.resource_server).toBeDefined()
    })

    it('exports AuthServerMetadata type', async () => {
      const { SampleAuthServerMetadata } = await import('../src/mcp')
      const metadata: typeof SampleAuthServerMetadata = {
        issuer: 'https://oauth.do',
        authorization_endpoint: 'https://oauth.do/authorize',
        token_endpoint: 'https://oauth.do/token',
      }
      expect(metadata.issuer).toBeDefined()
    })

    it('exports ProtectedResourceMetadata type', async () => {
      const { SampleProtectedResourceMetadata } = await import('../src/mcp')
      const metadata: typeof SampleProtectedResourceMetadata = {
        resource: 'https://apis.do',
        authorization_servers: ['https://oauth.do'],
      }
      expect(metadata.resource).toBeDefined()
    })
  })

  describe('Integration: Full MCP OAuth Flow', () => {
    it('completes full MCP OAuth flow with resource indicator', async () => {
      const { createMCPAuthorizeHandler, createMCPCallbackHandler } = await import('../src/mcp/mcp-flow')
      const { generatePKCE } = await import('../src/core/pkce')
      const { createStateWithMetadata, parseStateMetadata } = await import('../src/core/state')

      // Storage
      const store = createTestSessionStore()
      const pkceStore = new Map()
      const stateStore = new Map()

      let authState: string | undefined

      const provider = createTestProvider({
        name: 'mcp',
        trackCalls: true,
        tokenResponse: {
          access_token: 'mcp-access-token',
          token_type: 'Bearer' as const,
          expires_in: 3600,
          refresh_token: 'mcp-refresh-token',
          scope: 'mcp:tools mcp:resources read',
        },
        user: {
          id: 'mcp-user-123',
          email: 'mcp@example.com',
          name: 'MCP User',
        },
      })

      // Override getAuthorizationUrl to capture state
      provider.getAuthorizationUrl = (state: string, challenge: string, params?: Record<string, string>) => {
        authState = state
        const url = new URL('https://oauth.do/authorize')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', challenge)
        url.searchParams.set('code_challenge_method', 'S256')
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value)
          }
        }
        return url.toString()
      }

      const app = new Hono()

      // Set up authorize endpoint
      app.get(
        '/auth/mcp',
        createMCPAuthorizeHandler({
          provider,
          resourceIndicator: 'https://apis.do',
          scopes: ['mcp:tools', 'mcp:resources', 'read'],
          storePKCE: async (pkce) => {
            pkceStore.set('current', pkce)
          },
          storeState: async (state) => {
            stateStore.set('current', state)
          },
        })
      )

      // Set up callback endpoint
      app.get(
        '/callback',
        createMCPCallbackHandler({
          provider,
          sessionStore: store,
          resourceIndicator: 'https://apis.do',
          getStoredPKCE: async () => pkceStore.get('current'),
          getStoredState: async () => stateStore.get('current'),
        })
      )

      // Step 1: Start authorization
      const authRes = await app.request('/auth/mcp?redirect_uri=/dashboard')
      expect(authRes.status).toBe(302)

      const authLocation = authRes.headers.get('Location')!
      expect(authLocation).toContain('oauth.do/authorize')
      expect(authLocation).toContain('resource=https%3A%2F%2Fapis.do')
      expect(authLocation).toContain('scope=')

      // Step 2: Simulate callback with auth code
      const storedState = stateStore.get('current')
      const callbackRes = await app.request(`/callback?code=mcp-auth-code&state=${storedState}`)

      expect(callbackRes.status).toBe(302)
      expect(callbackRes.headers.get('Location')).toBe('/dashboard')

      // Verify session was created
      expect(store.sessions.size).toBe(1)
      const [[, storedSession]] = store.sessions.entries()
      expect(storedSession.data.userId).toBe('mcp-user-123')
      expect(storedSession.data.accessToken).toBe('mcp-access-token')
      expect(storedSession.data.provider).toBe('mcp')
    })
  })
})
