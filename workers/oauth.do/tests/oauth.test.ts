/**
 * OAuth 2.0 Authorization Server Tests (TDD)
 *
 * Tests for oauth.do - an OAuth 2.0/OIDC provider for dotdo apps.
 * Implements RFC 6749 (OAuth 2.0) and OpenID Connect Core 1.0.
 *
 * Test Coverage:
 * - OpenID Connect Discovery
 * - JWKS Endpoint
 * - Authorization Code Flow
 * - PKCE Extension (RFC 7636)
 * - Token Exchange
 * - Token Refresh
 * - Token Revocation
 * - UserInfo Endpoint
 */

import { describe, it, expect } from 'vitest'
import { createOAuthServer } from '../index'
import type { OAuthServerConfig } from '../types'
import * as jose from 'jose'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock database for testing
 */
function createMockDb() {
  const clients = new Map<string, {
    id: string
    clientId: string
    clientSecret: string
    name: string
    redirectUris: string[]
    scopes: string[]
    grantTypes: string[]
    public: boolean
    skipConsent: boolean
    userId: string
  }>()

  const authCodes = new Map<string, {
    code: string
    clientId: string
    userId: string
    redirectUri: string
    scopes: string[]
    codeChallenge?: string
    codeChallengeMethod?: string
    expiresAt: Date
    used: boolean
  }>()

  const tokens = new Map<string, {
    id: string
    token: string
    clientId: string
    userId: string
    scopes: string[]
    expiresAt: Date
    revoked: boolean
  }>()

  const refreshTokens = new Map<string, {
    id: string
    token: string
    clientId: string
    userId: string
    scopes: string[]
    expiresAt: Date
    revoked: boolean
  }>()

  const consents = new Map<string, {
    userId: string
    clientId: string
    scopes: string[]
  }>()

  const users = new Map<string, {
    id: string
    email: string
    name: string
    emailVerified: boolean
    image?: string
  }>()

  return {
    clients,
    authCodes,
    tokens,
    refreshTokens,
    consents,
    users,

    // Helper to seed test data
    seedClient(data: Parameters<typeof clients.set>[1]) {
      clients.set(data.clientId, data)
    },

    seedUser(data: Parameters<typeof users.set>[1]) {
      users.set(data.id, data)
    },
  }
}

/**
 * Create test config
 */
function createTestConfig(): OAuthServerConfig {
  return {
    issuer: 'https://oauth.dotdo.dev',
    signingKey: 'test-signing-key-at-least-32-chars',
    accessTokenTtl: 3600,
    refreshTokenTtl: 86400 * 30,
    authorizationCodeTtl: 600,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  }
}

/**
 * Generate PKCE challenge
 */
function generatePKCE() {
  const verifier = crypto.randomUUID() + crypto.randomUUID()
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)

  return crypto.subtle.digest('SHA-256', data).then(hash => {
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return { verifier, challenge }
  })
}

/**
 * Parse URL fragment as params
 */
function parseFragment(url: string): URLSearchParams {
  const fragment = new URL(url).hash.slice(1)
  return new URLSearchParams(fragment)
}

// ============================================================================
// OpenID Connect Discovery Tests
// ============================================================================

describe('OpenID Connect Discovery', () => {
  it('should return well-known OpenID configuration', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/.well-known/openid-configuration')
    const response = await server.fetch(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const discovery = await response.json() as Record<string, unknown>

    // Required fields per OpenID Connect Discovery 1.0
    expect(discovery.issuer).toBe('https://oauth.dotdo.dev')
    expect(discovery.authorization_endpoint).toBe('https://oauth.dotdo.dev/authorize')
    expect(discovery.token_endpoint).toBe('https://oauth.dotdo.dev/token')
    expect(discovery.userinfo_endpoint).toBe('https://oauth.dotdo.dev/userinfo')
    expect(discovery.jwks_uri).toBe('https://oauth.dotdo.dev/.well-known/jwks.json')
    expect(discovery.response_types_supported).toContain('code')
    expect(discovery.subject_types_supported).toContain('public')
    expect(discovery.id_token_signing_alg_values_supported).toContain('RS256')

    // PKCE support
    expect(discovery.code_challenge_methods_supported).toContain('S256')
    expect(discovery.code_challenge_methods_supported).toContain('plain')

    // Token endpoint auth methods
    expect(discovery.token_endpoint_auth_methods_supported).toContain('client_secret_basic')
    expect(discovery.token_endpoint_auth_methods_supported).toContain('client_secret_post')

    // Scopes
    expect(discovery.scopes_supported).toContain('openid')
    expect(discovery.scopes_supported).toContain('profile')
    expect(discovery.scopes_supported).toContain('email')

    // Grant types
    expect(discovery.grant_types_supported).toContain('authorization_code')
    expect(discovery.grant_types_supported).toContain('refresh_token')

    // Claims
    expect(discovery.claims_supported).toContain('sub')
    expect(discovery.claims_supported).toContain('iss')
    expect(discovery.claims_supported).toContain('aud')
    expect(discovery.claims_supported).toContain('exp')
    expect(discovery.claims_supported).toContain('iat')
    expect(discovery.claims_supported).toContain('email')
    expect(discovery.claims_supported).toContain('name')
  })

  it('should support introspection and revocation endpoints', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/.well-known/openid-configuration')
    const response = await server.fetch(request)

    const discovery = await response.json() as Record<string, unknown>

    expect(discovery.introspection_endpoint).toBe('https://oauth.dotdo.dev/introspect')
    expect(discovery.revocation_endpoint).toBe('https://oauth.dotdo.dev/revoke')
  })
})

// ============================================================================
// JWKS Endpoint Tests
// ============================================================================

describe('JWKS Endpoint', () => {
  it('should return valid JWKS', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/.well-known/jwks.json')
    const response = await server.fetch(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toContain('max-age=')

    const jwks = await response.json() as { keys: jose.JWK[] }

    expect(jwks.keys).toBeInstanceOf(Array)
    expect(jwks.keys.length).toBeGreaterThan(0)

    const key = jwks.keys[0]
    expect(key.kty).toBe('RSA')
    expect(key.use).toBe('sig')
    expect(key.alg).toBe('RS256')
    expect(key.kid).toBeDefined()
    expect(key.n).toBeDefined()
    expect(key.e).toBeDefined()
  })

  it('should support key rotation', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/.well-known/jwks.json')
    const response = await server.fetch(request)

    const jwks = await response.json() as { keys: jose.JWK[] }

    // Should have at least one key, could have multiple for rotation
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1)

    // Each key should have a unique kid
    const kids = jwks.keys.map(k => k.kid)
    expect(new Set(kids).size).toBe(kids.length)
  })
})

// ============================================================================
// Authorization Endpoint Tests
// ============================================================================

describe('Authorization Endpoint', () => {
  it('should redirect to login for valid authorization request', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email'],
      grantTypes: ['authorization_code', 'refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/callback',
          scope: 'openid profile',
          state: 'random-state-123',
        }).toString()
    )

    const response = await server.fetch(request)

    // Should redirect to login page with auth request stored
    expect(response.status).toBe(302)
    const location = response.headers.get('Location')
    expect(location).toContain('/login')
  })

  it('should reject invalid redirect_uri', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'https://evil.com/callback',
          scope: 'openid',
        }).toString()
    )

    const response = await server.fetch(request)

    // Should return error page, NOT redirect to evil.com
    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_redirect_uri')
  })

  it('should reject unknown client_id', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'unknown-client',
          redirect_uri: 'https://app.example.com/callback',
          scope: 'openid',
        }).toString()
    )

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_client')
  })

  it('should require response_type parameter', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/callback',
          scope: 'openid',
        }).toString()
    )

    const response = await server.fetch(request)

    // Should redirect back to client with error
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.searchParams.get('error')).toBe('invalid_request')
  })
})

// ============================================================================
// PKCE Tests (RFC 7636)
// ============================================================================

describe('PKCE Extension (RFC 7636)', () => {
  it('should require code_challenge for public clients', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'public-client',
      clientSecret: '',
      name: 'Public App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: true,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'public-client',
          redirect_uri: 'https://app.example.com/callback',
          scope: 'openid',
        }).toString()
    )

    const response = await server.fetch(request)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('error_description')).toContain('code_challenge')
  })

  it('should accept S256 code_challenge_method', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'public-client',
      clientSecret: '',
      name: 'Public App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: true,
      skipConsent: false,
      userId: 'user-1',
    })

    const { challenge } = await generatePKCE()

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'public-client',
          redirect_uri: 'https://app.example.com/callback',
          scope: 'openid',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString()
    )

    const response = await server.fetch(request)

    // Should proceed to login, not error
    expect(response.status).toBe(302)
    const location = response.headers.get('Location')!
    expect(location).not.toContain('error=')
  })

  it('should reject token request without code_verifier for PKCE flow', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'public-client',
      clientSecret: '',
      name: 'Public App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: true,
      skipConsent: false,
      userId: 'user-1',
    })

    const { challenge, verifier } = await generatePKCE()

    // Simulate an auth code that was issued with PKCE
    db.authCodes.set('test-code', {
      code: 'test-code',
      clientId: 'public-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid'],
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    // Token request WITHOUT code_verifier
    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'https://app.example.com/callback',
        client_id: 'public-client',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('should validate code_verifier against code_challenge', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'public-client',
      clientSecret: '',
      name: 'Public App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: true,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    const { challenge, verifier } = await generatePKCE()

    db.authCodes.set('test-code', {
      code: 'test-code',
      clientId: 'public-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid'],
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    // Token request WITH correct code_verifier
    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'https://app.example.com/callback',
        client_id: 'public-client',
        code_verifier: verifier,
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json() as { access_token: string }
    expect(body.access_token).toBeDefined()
  })
})

// ============================================================================
// Token Endpoint Tests
// ============================================================================

describe('Token Endpoint', () => {
  it('should exchange authorization code for tokens', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email'],
      grantTypes: ['authorization_code', 'refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.authCodes.set('valid-code', {
      code: 'valid-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid', 'profile'],
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'valid-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Pragma')).toBe('no-cache')

    const body = await response.json() as {
      access_token: string
      token_type: string
      expires_in: number
      refresh_token?: string
      id_token?: string
      scope: string
    }

    expect(body.access_token).toBeDefined()
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(3600)
    expect(body.scope).toBe('openid profile')
  })

  it('should include id_token when openid scope is requested', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.authCodes.set('oidc-code', {
      code: 'oidc-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid', 'email'],
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'oidc-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)
    const body = await response.json() as { id_token: string }

    expect(body.id_token).toBeDefined()

    // Verify id_token structure (JWT)
    const parts = body.id_token.split('.')
    expect(parts.length).toBe(3)

    // Decode and verify claims
    const payload = JSON.parse(atob(parts[1])) as {
      iss: string
      sub: string
      aud: string
      exp: number
      iat: number
      email?: string
    }

    expect(payload.iss).toBe('https://oauth.dotdo.dev')
    expect(payload.sub).toBe('user-1')
    expect(payload.aud).toBe('test-client')
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000)
    expect(payload.iat).toBeLessThanOrEqual(Date.now() / 1000)
    expect(payload.email).toBe('user@example.com')
  })

  it('should include refresh_token when offline_access scope is requested', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.authCodes.set('offline-code', {
      code: 'offline-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid', 'offline_access'],
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'offline-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)
    const body = await response.json() as { refresh_token: string }

    expect(body.refresh_token).toBeDefined()
  })

  it('should reject expired authorization code', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.authCodes.set('expired-code', {
      code: 'expired-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() - 1000), // Expired
      used: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'expired-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('should reject reused authorization code', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.authCodes.set('used-code', {
      code: 'used-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 600000),
      used: true, // Already used
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'used-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('should authenticate client via Basic auth', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'correct-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.authCodes.set('test-code', {
      code: 'test-code',
      clientId: 'test-client',
      userId: 'user-1',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    // Wrong secret
    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:wrong-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'https://app.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(401)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_client')
  })
})

// ============================================================================
// Token Refresh Tests
// ============================================================================

describe('Token Refresh', () => {
  it('should refresh access token with valid refresh token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.refreshTokens.set('valid-refresh', {
      id: 'rt-1',
      token: 'valid-refresh',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid', 'profile'],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      access_token: string
      token_type: string
      expires_in: number
      refresh_token?: string
    }

    expect(body.access_token).toBeDefined()
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(3600)
    // May issue new refresh token (rotation)
  })

  it('should reject expired refresh token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.refreshTokens.set('expired-refresh', {
      id: 'rt-1',
      token: 'expired-refresh',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() - 1000), // Expired
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'expired-refresh',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('should reject revoked refresh token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.refreshTokens.set('revoked-refresh', {
      id: 'rt-1',
      token: 'revoked-refresh',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: true,
    })

    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'revoked-refresh',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })
})

// ============================================================================
// Token Revocation Tests (RFC 7009)
// ============================================================================

describe('Token Revocation (RFC 7009)', () => {
  it('should revoke access token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.tokens.set('active-token', {
      id: 'at-1',
      token: 'active-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'active-token',
        token_type_hint: 'access_token',
      }).toString(),
    })

    const response = await server.fetch(request)

    // RFC 7009: revocation endpoint always returns 200
    expect(response.status).toBe(200)

    // Token should now be revoked
    expect(db.tokens.get('active-token')?.revoked).toBe(true)
  })

  it('should revoke refresh token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['refresh_token'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.refreshTokens.set('active-refresh', {
      id: 'rt-1',
      token: 'active-refresh',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 86400000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'active-refresh',
        token_type_hint: 'refresh_token',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)
    expect(db.refreshTokens.get('active-refresh')?.revoked).toBe(true)
  })

  it('should return 200 for unknown token (RFC 7009 compliance)', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request('https://oauth.dotdo.dev/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'unknown-token',
      }).toString(),
    })

    const response = await server.fetch(request)

    // RFC 7009: server responds 200 even for invalid tokens
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// Token Introspection Tests (RFC 7662)
// ============================================================================

describe('Token Introspection (RFC 7662)', () => {
  it('should return active=true for valid token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.tokens.set('valid-token', {
      id: 'at-1',
      token: 'valid-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid', 'profile'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/introspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'valid-token',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      active: boolean
      scope: string
      client_id: string
      sub: string
      exp: number
      token_type: string
    }

    expect(body.active).toBe(true)
    expect(body.scope).toBe('openid profile')
    expect(body.client_id).toBe('test-client')
    expect(body.sub).toBe('user-1')
    expect(body.token_type).toBe('Bearer')
    expect(body.exp).toBeGreaterThan(Date.now() / 1000)
  })

  it('should return active=false for expired token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.tokens.set('expired-token', {
      id: 'at-1',
      token: 'expired-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() - 1000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/introspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'expired-token',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as { active: boolean }
    expect(body.active).toBe(false)
  })

  it('should return active=false for revoked token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.tokens.set('revoked-token', {
      id: 'at-1',
      token: 'revoked-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: true,
    })

    const request = new Request('https://oauth.dotdo.dev/introspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('test-client:test-secret'),
      },
      body: new URLSearchParams({
        token: 'revoked-token',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as { active: boolean }
    expect(body.active).toBe(false)
  })
})

// ============================================================================
// UserInfo Endpoint Tests
// ============================================================================

describe('UserInfo Endpoint', () => {
  it('should return user info for valid access token', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
      image: 'https://example.com/avatar.jpg',
    })

    db.tokens.set('valid-token', {
      id: 'at-1',
      token: 'valid-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid', 'profile', 'email'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/userinfo', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      sub: string
      name: string
      email: string
      email_verified: boolean
      picture?: string
    }

    expect(body.sub).toBe('user-1')
    expect(body.name).toBe('Test User')
    expect(body.email).toBe('user@example.com')
    expect(body.email_verified).toBe(true)
    expect(body.picture).toBe('https://example.com/avatar.jpg')
  })

  it('should filter claims based on scope', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    // Token only has 'openid' scope, not 'email' or 'profile'
    db.tokens.set('limited-token', {
      id: 'at-1',
      token: 'limited-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/userinfo', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer limited-token',
      },
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as {
      sub: string
      name?: string
      email?: string
    }

    expect(body.sub).toBe('user-1')
    // Should NOT include email or profile claims
    expect(body.email).toBeUndefined()
    expect(body.name).toBeUndefined()
  })

  it('should reject request without token', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/userinfo', {
      method: 'GET',
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
  })

  it('should reject request with invalid token', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/userinfo', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
    expect(response.headers.get('WWW-Authenticate')).toContain('invalid_token')
  })

  it('should support POST method', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.tokens.set('valid-token', {
      id: 'at-1',
      token: 'valid-token',
      clientId: 'test-client',
      userId: 'user-1',
      scopes: ['openid', 'profile'],
      expiresAt: new Date(Date.now() + 3600000),
      revoked: false,
    })

    const request = new Request('https://oauth.dotdo.dev/userinfo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(200)

    const body = await response.json() as { sub: string; name: string }
    expect(body.sub).toBe('user-1')
    expect(body.name).toBe('Test User')
  })
})

// ============================================================================
// Client Registration Tests (Dynamic Client Registration)
// ============================================================================

describe('Client Registration', () => {
  it('should register a new client', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'My App',
        redirect_uris: ['https://myapp.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid profile email',
      }),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(201)

    const body = await response.json() as {
      client_id: string
      client_secret: string
      client_name: string
      redirect_uris: string[]
      grant_types: string[]
      response_types: string[]
    }

    expect(body.client_id).toBeDefined()
    expect(body.client_secret).toBeDefined()
    expect(body.client_name).toBe('My App')
    expect(body.redirect_uris).toContain('https://myapp.com/callback')
  })

  it('should reject registration without redirect_uris', async () => {
    const config = createTestConfig()
    const server = createOAuthServer(config)

    const request = new Request('https://oauth.dotdo.dev/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'My App',
        grant_types: ['authorization_code'],
      }),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_client_metadata')
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  it('should enforce HTTPS for redirect_uri in production', async () => {
    const config = { ...createTestConfig(), enforceHttps: true }
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['http://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    const request = new Request(
      'https://oauth.dotdo.dev/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'http://app.example.com/callback',
          scope: 'openid',
        }).toString()
    )

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_redirect_uri')
  })

  it('should prevent authorization code injection', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    // Client A
    db.seedClient({
      id: 'client-a',
      clientId: 'client-a',
      clientSecret: 'secret-a',
      name: 'App A',
      redirectUris: ['https://a.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    // Client B
    db.seedClient({
      id: 'client-b',
      clientId: 'client-b',
      clientSecret: 'secret-b',
      name: 'App B',
      redirectUris: ['https://b.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    // Auth code issued to client-a
    db.authCodes.set('code-for-a', {
      code: 'code-for-a',
      clientId: 'client-a',
      userId: 'user-1',
      redirectUri: 'https://a.example.com/callback',
      scopes: ['openid'],
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    })

    // Client B tries to use client A's code
    const request = new Request('https://oauth.dotdo.dev/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa('client-b:secret-b'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'code-for-a',
        redirect_uri: 'https://a.example.com/callback',
      }).toString(),
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('invalid_grant')
  })

  it('should validate state parameter is returned', async () => {
    const config = createTestConfig()
    const db = createMockDb()
    const server = createOAuthServer(config, db)

    db.seedClient({
      id: 'client-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      name: 'Test App',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      public: false,
      skipConsent: false,
      userId: 'user-1',
    })

    db.seedUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      emailVerified: true,
    })

    db.consents.set('user-1:test-client', {
      userId: 'user-1',
      clientId: 'test-client',
      scopes: ['openid'],
    })

    // Simulate post-consent callback with state
    const request = new Request(
      'https://oauth.dotdo.dev/authorize/callback?' +
        new URLSearchParams({
          auth_request_id: 'req-123',
          user_id: 'user-1',
          consent: 'granted',
        }).toString()
    )

    // Mock the stored auth request
    server.storeAuthRequest('req-123', {
      response_type: 'code',
      client_id: 'test-client',
      redirect_uri: 'https://app.example.com/callback',
      scope: 'openid',
      state: 'csrf-protection-state',
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.searchParams.get('state')).toBe('csrf-protection-state')
  })
})
