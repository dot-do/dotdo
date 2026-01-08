import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

/**
 * Auth Middleware with Federation Tests
 *
 * Tests for the auth() Hono middleware that integrates with better-auth
 * and supports federation to parent DO (https://id.org.ai).
 *
 * These tests are expected to FAIL until the auth middleware is implemented.
 *
 * Expected middleware interface:
 * ```typescript
 * import { auth } from '../middleware/auth'
 *
 * app.use('/api/auth/*', auth({
 *   federate: true,
 *   federateTo: 'https://id.org.ai',
 *   providers: { github: { enabled: true } },
 *   oauthProvider: { enabled: false },
 *   oauthProxy: { enabled: true },
 *   organization: { enabled: true },
 * }))
 * ```
 */

// ============================================================================
// Types
// ============================================================================

interface AuthConfig {
  /** Whether to federate auth to parent DO. Default: true */
  federate?: boolean
  /** URL to federate auth to. Default: 'https://id.org.ai' */
  federateTo?: string
  /** OAuth provider configuration */
  providers?: Record<string, ProviderConfig>
  /** OAuth provider plugin config (make this DO an OAuth provider) */
  oauthProvider?: { enabled: boolean; loginPage?: string; consentPage?: string }
  /** OAuth proxy config for cross-domain auth */
  oauthProxy?: { enabled: boolean }
  /** Organization plugin config */
  organization?: { enabled: boolean; allowUserToCreateOrganization?: boolean }
}

interface ProviderConfig {
  enabled: boolean
  clientId?: string
  clientSecret?: string
}

interface SessionData {
  userId: string
  email?: string
  role?: string
  activeOrganizationId?: string
  expiresAt?: Date
}

interface AuthResponse {
  authenticated?: boolean
  user?: {
    id: string
    email?: string
    name?: string
  }
  session?: {
    id: string
    activeOrganizationId?: string
  }
  error?: string
  redirect?: string
}

// ============================================================================
// Mock imports - these will fail until the middleware is implemented
// ============================================================================

// This import should fail until the middleware is implemented
// The middleware should be created at api/middleware/auth-federation.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - auth middleware not yet implemented
import { auth } from '../../middleware/auth-federation'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestApp(config?: AuthConfig) {
  const app = new Hono()

  // Apply auth middleware to auth routes
  app.use('/api/auth/*', auth(config))

  // Test routes
  app.get('/api/auth/session', (c) => {
    const session = c.get('session') as SessionData | undefined
    const user = c.get('user')
    if (!session) {
      return c.json({ authenticated: false }, 401)
    }
    return c.json({
      authenticated: true,
      user,
      session: {
        id: session.userId,
        activeOrganizationId: session.activeOrganizationId,
      },
    })
  })

  app.get('/api/auth/providers', (c) => {
    const providers = c.get('providers') as string[] | undefined
    return c.json({ providers: providers || [] })
  })

  app.post('/api/auth/logout', (c) => {
    return c.json({ success: true })
  })

  return app
}

async function request(
  app: Hono,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    body?: unknown
  } = {},
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }
  return app.request(path, init)
}

// ============================================================================
// 1. Default Federation Behavior Tests
// ============================================================================

describe('Default Federation Behavior', () => {
  let app: Hono

  beforeEach(() => {
    app = createTestApp()
  })

  it('federates auth to parent DO (https://id.org.ai) by default', async () => {
    // When no local providers are configured, auth should federate
    const res = await request(app, 'GET', '/api/auth/signin')

    // Should redirect to federated auth endpoint
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('https://id.org.ai')
  })

  it('uses default federateTo URL when not specified', async () => {
    const res = await request(app, 'GET', '/api/auth/signin/google')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toStartWith('https://id.org.ai/api/auth')
  })

  it('includes return URL in federation redirect', async () => {
    const res = await app.request('/api/auth/signin?return_to=/dashboard', {
      method: 'GET',
      headers: { Origin: 'https://myapp.do' },
    })

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('callback')
    expect(location).toContain(encodeURIComponent('/dashboard'))
  })

  it('federation can be explicitly enabled', async () => {
    const federatedApp = createTestApp({ federate: true })
    const res = await request(federatedApp, 'GET', '/api/auth/signin')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('id.org.ai')
  })

  it('federation can be disabled', async () => {
    const localApp = createTestApp({
      federate: false,
      providers: { google: { enabled: true, clientId: 'test', clientSecret: 'secret' } },
    })
    const res = await request(localApp, 'GET', '/api/auth/signin/google')

    // Should NOT redirect to federated endpoint
    const location = res.headers.get('Location')
    expect(location).not.toContain('id.org.ai')
  })

  it('redirects to custom federate URL when specified', async () => {
    const customApp = createTestApp({
      federate: true,
      federateTo: 'https://auth.mycompany.com',
    })
    const res = await request(customApp, 'GET', '/api/auth/signin')

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('auth.mycompany.com')
  })

  it('passes provider hint to federated auth', async () => {
    const res = await request(app, 'GET', '/api/auth/signin/github')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('github')
  })
})

// ============================================================================
// 2. Custom OAuth Providers Tests
// ============================================================================

describe('Custom OAuth Providers', () => {
  it('can configure local GitHub provider', async () => {
    const app = createTestApp({
      federate: false,
      providers: {
        github: {
          enabled: true,
          clientId: 'gh_client_id',
          clientSecret: 'gh_client_secret',
        },
      },
    })

    const res = await request(app, 'GET', '/api/auth/signin/github')

    // Should initiate OAuth with GitHub directly
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('github.com')
    expect(location).not.toContain('id.org.ai')
  })

  it('can configure local Google provider', async () => {
    const app = createTestApp({
      federate: false,
      providers: {
        google: {
          enabled: true,
          clientId: 'google_client_id',
          clientSecret: 'google_client_secret',
        },
      },
    })

    const res = await request(app, 'GET', '/api/auth/signin/google')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('accounts.google.com')
  })

  it('local provider overrides federation for that provider', async () => {
    const app = createTestApp({
      federate: true,
      federateTo: 'https://id.org.ai',
      providers: {
        github: {
          enabled: true,
          clientId: 'local_gh_id',
          clientSecret: 'local_gh_secret',
        },
      },
    })

    // GitHub should be local
    const ghRes = await request(app, 'GET', '/api/auth/signin/github')
    expect(ghRes.headers.get('Location')).toContain('github.com')

    // Google should still federate
    const googleRes = await request(app, 'GET', '/api/auth/signin/google')
    expect(googleRes.headers.get('Location')).toContain('id.org.ai')
  })

  it('returns error for disabled provider', async () => {
    const app = createTestApp({
      federate: false,
      providers: {
        github: { enabled: false },
      },
    })

    const res = await request(app, 'GET', '/api/auth/signin/github')

    expect(res.status).toBe(400)
    const body = (await res.json()) as AuthResponse
    expect(body.error).toMatch(/provider.*disabled|not.*available/i)
  })

  it('lists available providers', async () => {
    const app = createTestApp({
      providers: {
        github: { enabled: true, clientId: 'id', clientSecret: 'secret' },
        google: { enabled: true, clientId: 'id', clientSecret: 'secret' },
        discord: { enabled: false },
      },
    })

    const res = await request(app, 'GET', '/api/auth/providers')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: string[] }
    expect(body.providers).toContain('github')
    expect(body.providers).toContain('google')
    expect(body.providers).not.toContain('discord')
  })

  it('handles OAuth callback for local provider', async () => {
    const app = createTestApp({
      federate: false,
      providers: {
        github: {
          enabled: true,
          clientId: 'gh_id',
          clientSecret: 'gh_secret',
        },
      },
    })

    // Simulate OAuth callback
    const res = await app.request('/api/auth/callback/github?code=test_code&state=test_state', {
      method: 'GET',
    })

    // Should attempt to exchange code (will fail without proper mock)
    // But the route should exist
    expect([200, 302, 400, 500]).toContain(res.status)
  })
})

// ============================================================================
// 3. Hybrid Mode Tests
// ============================================================================

describe('Hybrid Mode', () => {
  let app: Hono

  beforeEach(() => {
    app = createTestApp({
      federate: true,
      federateTo: 'https://id.org.ai',
      providers: {
        github: {
          enabled: true,
          clientId: 'local_gh_id',
          clientSecret: 'local_gh_secret',
        },
        // google not configured - should federate
      },
    })
  })

  it('uses local provider when configured', async () => {
    const res = await request(app, 'GET', '/api/auth/signin/github')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')!
    expect(location).toContain('github.com')
    expect(location).not.toContain('id.org.ai')
  })

  it('federates unconfigured providers', async () => {
    const res = await request(app, 'GET', '/api/auth/signin/google')

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')!
    expect(location).toContain('id.org.ai')
    expect(location).not.toContain('accounts.google.com')
  })

  it('looks up provider by name correctly', async () => {
    // Should find local github
    const ghRes = await request(app, 'GET', '/api/auth/signin/github')
    expect(ghRes.headers.get('Location')).toContain('github.com')

    // Should federate for unknown provider
    const linkedinRes = await request(app, 'GET', '/api/auth/signin/linkedin')
    expect(linkedinRes.headers.get('Location')).toContain('id.org.ai')
  })

  it('handles callback routing based on provider config', async () => {
    // Local provider callback should be handled locally
    const localRes = await app.request('/api/auth/callback/github?code=abc', {
      method: 'GET',
    })
    // Route should exist (even if it fails without proper mocking)
    expect([200, 302, 400, 500]).toContain(localRes.status)

    // Federated callback should redirect or proxy to federated endpoint
    const federatedRes = await app.request('/api/auth/callback/google?code=abc', {
      method: 'GET',
    })
    expect([302, 400]).toContain(federatedRes.status)
  })

  it('reports correct provider sources in config', async () => {
    // Should be able to query which providers are local vs federated
    const res = await app.request('/api/auth/config', { method: 'GET' })

    if (res.status === 200) {
      const config = (await res.json()) as { local: string[]; federated: string[] }
      expect(config.local).toContain('github')
      expect(config.federated || []).not.toContain('github')
    }
  })
})

// ============================================================================
// 4. Session Handling Tests
// ============================================================================

describe('Session Handling', () => {
  let app: Hono

  beforeEach(() => {
    app = createTestApp({
      federate: false,
      providers: {
        github: { enabled: true, clientId: 'id', clientSecret: 'secret' },
      },
    })
  })

  it('session cookie is set correctly after login', async () => {
    // Simulate successful OAuth callback
    const res = await app.request('/api/auth/callback/github?code=valid_code&state=valid_state', {
      method: 'GET',
    })

    // After successful auth, session cookie should be set
    const setCookie = res.headers.get('Set-Cookie')
    if (res.status === 302 || res.status === 200) {
      expect(setCookie).toBeTruthy()
      expect(setCookie).toMatch(/session/i)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('Secure')
    }
  })

  it('session cookie has correct attributes', async () => {
    // After login, check cookie attributes
    const res = await app.request('/api/auth/callback/github?code=valid&state=valid', {
      method: 'GET',
    })

    const setCookie = res.headers.get('Set-Cookie')
    if (setCookie) {
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toMatch(/SameSite=(Lax|Strict)/i)
      expect(setCookie).toMatch(/Path=\//i)
    }
  })

  it('session validation returns user info', async () => {
    // Request with valid session cookie
    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=valid_session_token',
      },
    })

    // Should return session info (will fail without proper session store)
    if (res.status === 200) {
      const body = (await res.json()) as AuthResponse
      expect(body.authenticated).toBe(true)
      expect(body.user).toBeDefined()
      expect(body.user?.id).toBeDefined()
    }
  })

  it('session validation fails for invalid token', async () => {
    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=invalid_token_12345',
      },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as AuthResponse
    expect(body.authenticated).toBe(false)
  })

  it('session validation fails without cookie', async () => {
    const res = await request(app, 'GET', '/api/auth/session')

    expect(res.status).toBe(401)
    const body = (await res.json()) as AuthResponse
    expect(body.authenticated).toBe(false)
  })

  it('logout clears session cookie', async () => {
    const res = await request(app, 'POST', '/api/auth/logout', {
      headers: {
        Cookie: 'session_token=valid_session',
      },
    })

    expect([200, 302]).toContain(res.status)
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toBeTruthy()
    // Cookie should be cleared (Max-Age=0 or expires in past)
    expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/i)
  })

  it('logout invalidates session in store', async () => {
    // First logout
    await request(app, 'POST', '/api/auth/logout', {
      headers: {
        Cookie: 'session_token=session_to_invalidate',
      },
    })

    // Then try to use the same session
    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=session_to_invalidate',
      },
    })

    expect(res.status).toBe(401)
  })

  it('session includes user role', async () => {
    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=admin_session',
      },
    })

    if (res.status === 200) {
      const body = (await res.json()) as AuthResponse & { user?: { role?: string } }
      expect(body.user?.role).toBeDefined()
    }
  })
})

// ============================================================================
// 5. OAuth Provider Plugin Tests
// ============================================================================

describe('OAuth Provider Plugin', () => {
  it('OAuth provider plugin is disabled by default', async () => {
    const app = createTestApp({
      providers: { github: { enabled: true, clientId: 'id', clientSecret: 'secret' } },
    })

    // OAuth provider endpoints should not exist
    const res = await request(app, 'GET', '/api/auth/oauth/authorize')

    expect(res.status).toBe(404)
  })

  it('OAuth provider plugin enabled when configured', async () => {
    const app = createTestApp({
      oauthProvider: {
        enabled: true,
        loginPage: '/login',
        consentPage: '/consent',
      },
    })

    // OAuth provider authorize endpoint should exist
    const res = await app.request(
      '/api/auth/oauth/authorize?client_id=test&redirect_uri=https://client.app/callback&response_type=code',
      { method: 'GET' },
    )

    // Should redirect to login page or return consent page
    expect([200, 302]).toContain(res.status)
    if (res.status === 302) {
      expect(res.headers.get('Location')).toContain('/login')
    }
  })

  it('OAuth provider token endpoint works', async () => {
    const app = createTestApp({
      oauthProvider: { enabled: true },
    })

    const res = await app.request('/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=test_code&client_id=test&client_secret=secret',
    })

    // Endpoint should exist (will fail validation without proper setup)
    expect([200, 400, 401]).toContain(res.status)
  })

  it('client credentials flow works when configured', async () => {
    const app = createTestApp({
      oauthProvider: { enabled: true },
    })

    const res = await app.request('/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&client_id=machine_client&client_secret=machine_secret',
    })

    // Should handle client credentials grant
    expect([200, 400, 401]).toContain(res.status)
  })

  it('OAuth provider validates redirect_uri', async () => {
    const app = createTestApp({
      oauthProvider: { enabled: true },
    })

    const res = await app.request(
      '/api/auth/oauth/authorize?client_id=test&redirect_uri=https://evil.com/steal&response_type=code',
      { method: 'GET' },
    )

    // Should reject unregistered redirect URI
    expect([400, 401, 403]).toContain(res.status)
  })

  it('OAuth provider supports PKCE', async () => {
    const app = createTestApp({
      oauthProvider: { enabled: true },
    })

    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

    const res = await app.request(
      `/api/auth/oauth/authorize?client_id=test&redirect_uri=https://client.app/cb&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      { method: 'GET' },
    )

    // Should accept PKCE parameters
    expect([200, 302]).toContain(res.status)
  })
})

// ============================================================================
// 6. OAuth Proxy Tests
// ============================================================================

describe('OAuth Proxy', () => {
  it('OAuth proxy is enabled by default', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    const res = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cross_domain_token' }),
    })

    // Endpoint should exist
    expect([200, 400, 401]).toContain(res.status)
  })

  it('OAuth proxy can be disabled', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: false },
    })

    const res = await request(app, 'POST', '/api/auth/proxy/exchange', {
      body: { token: 'test' },
    })

    expect(res.status).toBe(404)
  })

  it('OAuth proxy works for cross-domain auth', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    // Simulate cross-domain token exchange
    const res = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://other-tenant.do',
      },
      body: JSON.stringify({
        token: 'one_time_cross_domain_token',
      }),
    })

    // Should exchange token for session
    expect([200, 400, 401]).toContain(res.status)
  })

  it('token exchange returns session cookie', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    const res = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid_exchange_token' }),
    })

    if (res.status === 200) {
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toBeTruthy()
      expect(setCookie).toContain('session')
    }
  })

  it('token exchange fails for expired token', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    const res = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'expired_token' }),
    })

    expect([400, 401]).toContain(res.status)
    const body = (await res.json()) as AuthResponse
    expect(body.error).toMatch(/expired|invalid/i)
  })

  it('token exchange is one-time use', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    const token = 'single_use_token_' + Date.now()

    // First exchange
    const res1 = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    // Second exchange with same token should fail
    const res2 = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    // At least the second one should fail
    if (res1.status === 200) {
      expect([400, 401]).toContain(res2.status)
    }
  })

  it('proxy validates origin header', async () => {
    const app = createTestApp({
      oauthProxy: { enabled: true },
    })

    const res = await app.request('/api/auth/proxy/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious-site.com',
      },
      body: JSON.stringify({ token: 'test_token' }),
    })

    // Should reject requests from unregistered origins
    expect([400, 401, 403]).toContain(res.status)
  })
})

// ============================================================================
// 7. Organization Plugin Tests
// ============================================================================

describe('Organization Plugin', () => {
  it('organization plugin tracks activeOrganizationId', async () => {
    const app = createTestApp({
      organization: { enabled: true },
    })

    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=session_with_org',
      },
    })

    if (res.status === 200) {
      const body = (await res.json()) as AuthResponse
      expect(body.session?.activeOrganizationId).toBeDefined()
    }
  })

  it('organization plugin is enabled by default', async () => {
    const app = createTestApp({})

    const res = await request(app, 'GET', '/api/auth/organizations')

    // Endpoint should exist (even if empty)
    expect([200, 401]).toContain(res.status)
  })

  it('can switch organizations', async () => {
    const app = createTestApp({
      organization: { enabled: true },
    })

    const res = await app.request('/api/auth/organization/switch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session_token=valid_session',
      },
      body: JSON.stringify({ organizationId: 'org_456' }),
    })

    expect([200, 400, 401, 403]).toContain(res.status)
    if (res.status === 200) {
      const body = (await res.json()) as { activeOrganizationId: string }
      expect(body.activeOrganizationId).toBe('org_456')
    }
  })

  it('switching to unauthorized org fails', async () => {
    const app = createTestApp({
      organization: { enabled: true },
    })

    const res = await app.request('/api/auth/organization/switch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session_token=valid_session',
      },
      body: JSON.stringify({ organizationId: 'org_not_a_member' }),
    })

    expect([400, 403]).toContain(res.status)
  })

  it('organization plugin can be disabled', async () => {
    const app = createTestApp({
      organization: { enabled: false },
    })

    const res = await request(app, 'GET', '/api/auth/organizations')

    expect(res.status).toBe(404)
  })

  it('session includes active organization in response', async () => {
    const app = createTestApp({
      organization: { enabled: true },
    })

    const res = await request(app, 'GET', '/api/auth/session', {
      headers: {
        Cookie: 'session_token=session_with_active_org',
      },
    })

    if (res.status === 200) {
      const body = (await res.json()) as AuthResponse
      expect(body.session).toHaveProperty('activeOrganizationId')
    }
  })

  it('can list user organizations', async () => {
    const app = createTestApp({
      organization: { enabled: true },
    })

    const res = await request(app, 'GET', '/api/auth/organizations', {
      headers: {
        Cookie: 'session_token=valid_session',
      },
    })

    if (res.status === 200) {
      const body = (await res.json()) as { organizations: Array<{ id: string; name: string }> }
      expect(Array.isArray(body.organizations)).toBe(true)
    }
  })

  it('organization creation respects allowUserToCreateOrganization', async () => {
    const app = createTestApp({
      organization: {
        enabled: true,
        allowUserToCreateOrganization: false,
      },
    })

    const res = await app.request('/api/auth/organization', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session_token=valid_session',
      },
      body: JSON.stringify({ name: 'New Org' }),
    })

    // Should be forbidden when creation is disabled
    expect([403]).toContain(res.status)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('handles missing config gracefully', async () => {
    const app = createTestApp(undefined)
    const res = await request(app, 'GET', '/api/auth/session')

    // Should work with defaults
    expect([200, 401]).toContain(res.status)
  })

  it('handles concurrent auth requests', async () => {
    const app = createTestApp({
      providers: { github: { enabled: true, clientId: 'id', clientSecret: 'secret' } },
    })

    const requests = Array.from({ length: 5 }, () => request(app, 'GET', '/api/auth/signin/github'))

    const responses = await Promise.all(requests)

    // All should redirect
    for (const res of responses) {
      expect(res.status).toBe(302)
    }
  })

  it('returns proper error for malformed config', async () => {
    // This should handle gracefully without crashing
    expect(() => {
      createTestApp({
        providers: {
          github: { enabled: true }, // Missing clientId and clientSecret
        },
      })
    }).not.toThrow()
  })

  it('CSRF protection on state parameter', async () => {
    const app = createTestApp({
      providers: { github: { enabled: true, clientId: 'id', clientSecret: 'secret' } },
    })

    // Callback without state should fail
    const res = await app.request('/api/auth/callback/github?code=valid_code', {
      method: 'GET',
    })

    expect([400, 401, 403]).toContain(res.status)
  })

  it('handles provider errors gracefully', async () => {
    const app = createTestApp({
      providers: { github: { enabled: true, clientId: 'id', clientSecret: 'secret' } },
    })

    // Simulate error from provider
    const res = await app.request('/api/auth/callback/github?error=access_denied&error_description=User%20denied', {
      method: 'GET',
    })

    expect([302, 400]).toContain(res.status)
    if (res.status === 302) {
      const location = res.headers.get('Location')
      expect(location).toContain('error')
    }
  })
})
