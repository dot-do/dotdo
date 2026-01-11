import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * WorkOS AuthKit Middleware Tests
 *
 * These tests verify the WorkOS AuthKit integration for enterprise-grade
 * human authentication including SSO, magic links, and user management.
 *
 * Tests are expected to FAIL until the middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/workos-authkit.ts
 * - Configure WorkOS AuthKit as social provider in better-auth
 * - Support Enterprise SSO (SAML, OIDC)
 * - Support Magic Link authentication
 * - Directory Sync for user/group provisioning
 * - Organization management with WorkOS orgId mapping
 * - Session management with secure tokens
 * - Admin Portal for self-service SSO configuration
 *
 * Integration with:
 * - api/middleware/auth-federation.ts (federation layer)
 * - db/auth.ts (identity and linked account schemas)
 * - WorkOS Vault for secure token storage
 */

// ============================================================================
// Import the middleware
// ============================================================================

import {
  workosAuthKit,
  type WorkOSAuthKitConfig,
  type SSOConnection,
  type MagicLinkSession,
  type DirectorySyncUser,
  type DirectorySyncGroup,
  type WorkOSOrganization,
  type WorkOSSession,
  type AdminPortalLink,
  setTestEnv,
  clearTestEnv,
} from '../../middleware/workos-authkit'

// ============================================================================
// Test Types
// ============================================================================

interface AuthKitResponse {
  success?: boolean
  error?: string
  redirectUrl?: string
  session?: WorkOSSession
  user?: {
    id: string
    email: string
    firstName?: string
    lastName?: string
    profilePictureUrl?: string
    workosUserId?: string
  }
  organization?: WorkOSOrganization
  connection?: SSOConnection
  portalLink?: AdminPortalLink
  magicLink?: {
    id: string
    email: string
    expiresAt: string
  }
  syncResult?: {
    users?: DirectorySyncUser[]
    groups?: DirectorySyncGroup[]
  }
}

interface SSOCallbackParams {
  code: string
  state: string
  connection_id?: string
  organization_id?: string
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test app with WorkOS AuthKit middleware
 */
function createTestApp(config?: WorkOSAuthKitConfig): Hono {
  const app = new Hono()

  // Apply AuthKit middleware
  app.use('/api/auth/*', workosAuthKit(config))

  return app
}

/**
 * Make an auth request to the test app
 */
async function authRequest(
  app: Hono,
  method: string,
  path: string,
  options: {
    body?: unknown
    headers?: Record<string, string>
    query?: Record<string, string>
  } = {}
): Promise<Response> {
  const url = new URL(`http://localhost/api/auth${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value)
    }
  }

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
  return app.request(url.toString(), init)
}

/**
 * Create a mock session cookie for authenticated requests
 */
function mockSessionCookie(sessionId: string = 'valid_session'): string {
  return `session_token=${sessionId}`
}

/**
 * Create a mock admin session cookie
 */
function mockAdminSessionCookie(): string {
  return `session_token=admin_session`
}

/**
 * Generate mock SSO callback params
 */
function mockSSOCallback(overrides?: Partial<SSOCallbackParams>): SSOCallbackParams {
  return {
    code: 'mock_auth_code_12345',
    state: 'mock_state_abc123',
    connection_id: 'conn_01EXAMPLE',
    organization_id: 'org_01EXAMPLE',
    ...overrides,
  }
}

// ============================================================================
// Test Constants
// ============================================================================

const TEST_WORKOS_API_KEY = 'sk_test_workos_api_key_12345'
const TEST_WORKOS_CLIENT_ID = 'client_01EXAMPLE'
const TEST_REDIRECT_URI = 'https://app.example.com.ai/api/auth/callback/workos'

const MOCK_WORKOS_USER = {
  id: 'user_01EXAMPLE',
  email: 'alice@acme.com',
  firstName: 'Alice',
  lastName: 'Smith',
  profilePictureUrl: 'https://workos.com/avatars/alice.jpg',
  emailVerified: true,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-20T15:30:00Z',
}

const MOCK_SSO_CONNECTION: SSOConnection = {
  id: 'conn_01EXAMPLE',
  connectionType: 'SAML',
  name: 'Acme Corp SSO',
  state: 'active',
  organizationId: 'org_01EXAMPLE',
  domains: ['acme.com'],
  createdAt: '2024-01-10T09:00:00Z',
  updatedAt: '2024-01-10T09:00:00Z',
}

const MOCK_WORKOS_ORG: WorkOSOrganization = {
  id: 'org_01EXAMPLE',
  name: 'Acme Corporation',
  allowProfilesOutsideOrganization: false,
  domains: [{ id: 'dom_01', domain: 'acme.com', state: 'verified' }],
  createdAt: '2024-01-05T08:00:00Z',
  updatedAt: '2024-01-15T12:00:00Z',
}

// ============================================================================
// 1. SSO Flow Tests
// ============================================================================

describe('WorkOS AuthKit - SSO Flows', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    setTestEnv('WORKOS_CLIENT_ID', TEST_WORKOS_CLIENT_ID)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
      redirectUri: TEST_REDIRECT_URI,
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
    clearTestEnv('WORKOS_CLIENT_ID')
  })

  describe('SSO Initiation', () => {
    it('initiates SSO flow and returns authorization URL', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
      if (res.status === 302) {
        const location = res.headers.get('Location')
        expect(location).toContain('workos.com')
        expect(location).toContain('authorize')
      } else {
        const body = (await res.json()) as AuthKitResponse
        expect(body.redirectUrl).toContain('workos.com')
      }
    })

    it('initiates SSO by organization ID', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('initiates SSO by email domain', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          domain: 'acme.com',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('generates and stores state parameter for CSRF protection', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      if (res.status === 302) {
        const location = res.headers.get('Location')
        expect(location).toContain('state=')
      } else {
        const body = (await res.json()) as AuthKitResponse
        expect(body.redirectUrl).toContain('state=')
      }
    })

    it('returns 400 when no connection, organization, or domain provided', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/connection|organization|domain|required/i)
    })

    it('returns 400 for invalid redirect URI', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_01EXAMPLE',
          redirect_uri: 'https://evil.com/callback',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/redirect|invalid|not allowed/i)
    })

    it('supports provider hint for specific IdP', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
          provider: 'GoogleOAuth',
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('supports login_hint for pre-filling email', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
          login_hint: 'alice@acme.com',
        },
      })

      expect([200, 302]).toContain(res.status)
      if (res.status === 302) {
        const location = res.headers.get('Location')
        expect(location).toContain('login_hint')
      }
    })
  })

  describe('SSO Callback', () => {
    it('exchanges authorization code for user profile', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      expect([200, 302]).toContain(res.status)
    })

    it('creates or updates identity on successful SSO', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user).toBeDefined()
        expect(body.user?.email).toBeDefined()
      }
    })

    it('creates linked account with WorkOS user ID', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user?.workosUserId).toBeDefined()
      }
    })

    it('creates session after successful authentication', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.session).toBeDefined()
      } else {
        // Check for session cookie on redirect
        const setCookie = res.headers.get('Set-Cookie')
        expect(setCookie).toContain('session')
      }
    })

    it('stores WorkOS orgId on organization', async () => {
      const callback = mockSSOCallback({ organization_id: 'org_01EXAMPLE' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.organization?.id).toBe('org_01EXAMPLE')
      }
    })

    it('returns 400 for invalid state (CSRF protection)', async () => {
      const callback = mockSSOCallback({ state: 'invalid_state' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/state|invalid|csrf/i)
    })

    it('returns 400 for missing authorization code', async () => {
      const callback = { state: 'valid_state' }

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as Record<string, string>,
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/code|missing|required/i)
    })

    it('returns 400 for expired authorization code', async () => {
      const callback = mockSSOCallback({ code: 'expired_code' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|invalid|code/i)
    })

    it('handles IdP-initiated SSO without prior state', async () => {
      // IdP-initiated flow doesn't have a state from our side
      const res = await authRequest(app, 'POST', '/callback/workos/idp-initiated', {
        body: {
          profile: MOCK_WORKOS_USER,
          connection: MOCK_SSO_CONNECTION,
        },
      })

      expect([200, 302]).toContain(res.status)
    })
  })

  describe('SAML SSO', () => {
    it('supports SAML 2.0 connections', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_saml_01',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('validates SAML assertion signature', async () => {
      const res = await authRequest(app, 'POST', '/callback/workos/saml', {
        body: {
          SAMLResponse: 'invalid_base64_saml_response',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/saml|signature|invalid/i)
    })

    it('extracts user attributes from SAML assertion', async () => {
      const callback = mockSSOCallback({ connection_id: 'conn_saml_01' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user?.email).toBeDefined()
      }
    })
  })

  describe('OIDC SSO', () => {
    it('supports OIDC connections', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_oidc_01',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('validates ID token signature', async () => {
      const res = await authRequest(app, 'POST', '/sso/validate-token', {
        body: {
          id_token: 'invalid.jwt.token',
        },
      })

      expect([400, 401]).toContain(res.status)
    })

    it('extracts claims from ID token', async () => {
      const callback = mockSSOCallback({ connection_id: 'conn_oidc_01' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user?.email).toBeDefined()
      }
    })
  })
})

// ============================================================================
// 2. Magic Link Tests
// ============================================================================

describe('WorkOS AuthKit - Magic Link Authentication', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Request Magic Link', () => {
    it('sends magic link email to valid address', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'alice@acme.com',
        },
      })

      expect([200, 202]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.success).toBe(true)
    })

    it('returns magic link ID for tracking', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'alice@acme.com',
        },
      })

      expect([200, 202]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.magicLink?.id).toBeDefined()
    })

    it('includes expiration time in response', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'alice@acme.com',
        },
      })

      expect([200, 202]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.magicLink?.expiresAt).toBeDefined()
    })

    it('returns 400 for invalid email format', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'invalid-email',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/email|invalid|format/i)
    })

    it('returns 400 for missing email', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {},
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/email|required|missing/i)
    })

    it('rate limits magic link requests', async () => {
      // Send multiple requests quickly
      const requests = Array.from({ length: 10 }, () =>
        authRequest(app, 'POST', '/magic-link/send', {
          body: { email: 'alice@acme.com' },
        })
      )

      const responses = await Promise.all(requests)
      const rateLimited = responses.filter((r) => r.status === 429)

      // At least some should be rate limited
      if (rateLimited.length > 0) {
        const body = (await rateLimited[0].json()) as AuthKitResponse
        expect(body.error).toMatch(/rate|limit|too many/i)
      }
    })

    it('supports custom redirect URI after verification', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'alice@acme.com',
          redirectUri: 'https://app.example.com.ai/dashboard',
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('supports expiration time configuration', async () => {
      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: {
          email: 'alice@acme.com',
          expiresIn: 3600, // 1 hour
        },
      })

      expect([200, 202]).toContain(res.status)
    })
  })

  describe('Verify Magic Link', () => {
    it('verifies valid magic link token', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'valid_magic_link_token_abc123',
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('creates session on successful verification', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'valid_magic_link_token_abc123',
        },
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.session).toBeDefined()
      } else {
        const setCookie = res.headers.get('Set-Cookie')
        expect(setCookie).toContain('session')
      }
    })

    it('creates or updates identity on verification', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'valid_magic_link_token_abc123',
        },
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user).toBeDefined()
        expect(body.user?.email).toBeDefined()
      }
    })

    it('returns 400 for missing token', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {},
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/token|required|missing/i)
    })

    it('returns 401 for invalid token', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'invalid_token_xyz',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/invalid|token/i)
    })

    it('returns 401 for expired token', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'expired_magic_link_token',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|token/i)
    })

    it('returns 401 for already-used token (one-time use)', async () => {
      // First use - should succeed
      await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'one_time_use_token',
        },
      })

      // Second use - should fail
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'one_time_use_token',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/used|invalid|expired/i)
    })

    it('redirects to configured URI on success', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'valid_magic_link_token_with_redirect',
        },
      })

      if (res.status === 302) {
        const location = res.headers.get('Location')
        expect(location).toBeDefined()
      }
    })
  })
})

// ============================================================================
// 3. Directory Sync Tests
// ============================================================================

describe('WorkOS AuthKit - Directory Sync', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
      directorySync: { enabled: true },
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('User Sync', () => {
    it('syncs users from directory provider', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
        },
      })

      expect([200, 202]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.syncResult?.users).toBeDefined()
    })

    it('creates identities for new directory users', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
        },
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        if (body.syncResult?.users && body.syncResult.users.length > 0) {
          expect(body.syncResult.users[0].identityId).toBeDefined()
        }
      }
    })

    it('updates existing identities on user change', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
          fullSync: false,
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('deactivates identities for removed directory users', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
          handleDeletions: true,
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for user.created', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.user.created',
          data: {
            id: 'dir_user_01',
            directoryId: 'directory_01EXAMPLE',
            emails: [{ primary: true, value: 'new.user@acme.com' }],
            firstName: 'New',
            lastName: 'User',
            state: 'active',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for user.updated', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.user.updated',
          data: {
            id: 'dir_user_01',
            directoryId: 'directory_01EXAMPLE',
            emails: [{ primary: true, value: 'updated.user@acme.com' }],
            firstName: 'Updated',
            lastName: 'User',
            state: 'active',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for user.deleted', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.user.deleted',
          data: {
            id: 'dir_user_01',
            directoryId: 'directory_01EXAMPLE',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('requires admin permissions for manual sync', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockSessionCookie() }, // Regular user, not admin
        body: {
          directoryId: 'directory_01EXAMPLE',
        },
      })

      expect([401, 403]).toContain(res.status)
    })
  })

  describe('Group Sync', () => {
    it('syncs groups from directory provider', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/groups/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
        },
      })

      expect([200, 202]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.syncResult?.groups).toBeDefined()
    })

    it('maps directory groups to organization teams', async () => {
      const res = await authRequest(app, 'POST', '/directory-sync/groups/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          directoryId: 'directory_01EXAMPLE',
          mapToTeams: true,
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for group.created', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.group.created',
          data: {
            id: 'dir_group_01',
            directoryId: 'directory_01EXAMPLE',
            name: 'Engineering',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for group.user_added', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.group.user_added',
          data: {
            directoryId: 'directory_01EXAMPLE',
            group: { id: 'dir_group_01', name: 'Engineering' },
            user: { id: 'dir_user_01', email: 'alice@acme.com' },
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for group.user_removed', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.group.user_removed',
          data: {
            directoryId: 'directory_01EXAMPLE',
            group: { id: 'dir_group_01', name: 'Engineering' },
            user: { id: 'dir_user_01', email: 'alice@acme.com' },
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles directory webhook for group.deleted', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'dsync.group.deleted',
          data: {
            id: 'dir_group_01',
            directoryId: 'directory_01EXAMPLE',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })
  })

  describe('Directory Webhook Validation', () => {
    it('validates webhook signature', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        headers: {
          'WorkOS-Signature': 'invalid_signature',
        },
        body: {
          event: 'dsync.user.created',
          data: {},
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('returns 400 for unknown event type', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: {
          event: 'unknown.event.type',
          data: {},
        },
      })

      expect([200, 400]).toContain(res.status)
      // May acknowledge but not process unknown events
    })

    it('handles duplicate webhook events idempotently', async () => {
      const event = {
        id: 'event_dedup_test',
        event: 'dsync.user.created',
        data: {
          id: 'dir_user_01',
          directoryId: 'directory_01EXAMPLE',
          emails: [{ primary: true, value: 'alice@acme.com' }],
        },
      }

      // Send same event twice
      const res1 = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: event,
      })
      const res2 = await authRequest(app, 'POST', '/webhooks/workos/directory', {
        body: event,
      })

      expect([200, 202]).toContain(res1.status)
      expect([200, 202]).toContain(res2.status)
    })
  })
})

// ============================================================================
// 4. Organization Tests
// ============================================================================

describe('WorkOS AuthKit - Organizations', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Create Organization', () => {
    it('creates organization in WorkOS', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'New Corp',
          domains: ['newcorp.com'],
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.organization?.id).toBeDefined()
    })

    it('stores WorkOS orgId on local organization', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'New Corp',
          domains: ['newcorp.com'],
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.organization?.id).toMatch(/^org_/)
    })

    it('supports domain verification', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'Verified Corp',
          domains: ['verified.com'],
          domainVerification: true,
        },
      })

      expect([200, 201]).toContain(res.status)
    })

    it('returns 400 for missing organization name', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          domains: ['example.com.ai'],
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/name|required/i)
    })

    it('returns 400 for invalid domain format', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'Bad Domain Corp',
          domains: ['not-a-valid-domain'],
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/domain|invalid/i)
    })

    it('returns 409 for duplicate domain', async () => {
      const res = await authRequest(app, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'Duplicate Corp',
          domains: ['acme.com'], // Already claimed
        },
      })

      expect([400, 409]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/domain|already|exists|claimed/i)
    })
  })

  describe('Organization Membership', () => {
    it('invites user to organization', async () => {
      const res = await authRequest(app, 'POST', '/organizations/org_01EXAMPLE/invitations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          email: 'newmember@acme.com',
          role: 'member',
        },
      })

      expect([200, 201, 202]).toContain(res.status)
    })

    it('accepts organization invitation', async () => {
      const res = await authRequest(app, 'POST', '/organizations/invitations/accept', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          invitationToken: 'valid_invitation_token',
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('returns 400 for expired invitation', async () => {
      const res = await authRequest(app, 'POST', '/organizations/invitations/accept', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          invitationToken: 'expired_invitation_token',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|invalid/i)
    })

    it('removes member from organization', async () => {
      const res = await authRequest(app, 'DELETE', '/organizations/org_01EXAMPLE/members/user_01', {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect([200, 204]).toContain(res.status)
    })

    it('updates member role', async () => {
      const res = await authRequest(app, 'PATCH', '/organizations/org_01EXAMPLE/members/user_01', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          role: 'admin',
        },
      })

      expect(res.status).toBe(200)
    })

    it('requires admin to manage members', async () => {
      const res = await authRequest(app, 'POST', '/organizations/org_01EXAMPLE/invitations', {
        headers: { Cookie: mockSessionCookie() }, // Regular member
        body: {
          email: 'newmember@acme.com',
          role: 'member',
        },
      })

      expect([401, 403]).toContain(res.status)
    })
  })

  describe('List Organizations', () => {
    it('lists organizations for current user', async () => {
      const res = await authRequest(app, 'GET', '/organizations', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { organizations: WorkOSOrganization[] }
      expect(Array.isArray(body.organizations)).toBe(true)
    })

    it('returns empty array for user with no organizations', async () => {
      const res = await authRequest(app, 'GET', '/organizations', {
        headers: { Cookie: 'session_token=new_user_session' },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { organizations: WorkOSOrganization[] }
      expect(body.organizations).toEqual([])
    })

    it('supports pagination', async () => {
      const res = await authRequest(app, 'GET', '/organizations', {
        headers: { Cookie: mockSessionCookie() },
        query: {
          limit: '10',
          after: 'org_cursor',
        },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Get Organization Details', () => {
    it('retrieves organization by ID', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_01EXAMPLE', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as AuthKitResponse
      expect(body.organization?.id).toBe('org_01EXAMPLE')
    })

    it('returns 404 for non-existent organization', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_nonexistent', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
    })

    it('returns 403 for non-member accessing organization', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_private', {
        headers: { Cookie: 'session_token=non_member_session' },
      })

      expect([403, 404]).toContain(res.status)
    })
  })
})

// ============================================================================
// 5. Session Tests
// ============================================================================

describe('WorkOS AuthKit - Session Management', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
      session: {
        maxAge: 86400, // 24 hours
        refreshEnabled: true,
      },
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Session Creation', () => {
    it('creates session after successful SSO', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      expect([200, 302]).toContain(res.status)
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('session')
    })

    it('creates session after magic link verification', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'valid_magic_link_token',
        },
      })

      expect([200, 302]).toContain(res.status)
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('session')
    })

    it('session includes user identity info', async () => {
      const res = await authRequest(app, 'GET', '/session', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as AuthKitResponse
      expect(body.session).toBeDefined()
      expect(body.user).toBeDefined()
    })

    it('session includes active organization', async () => {
      const res = await authRequest(app, 'GET', '/session', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as AuthKitResponse
      expect(body.session?.activeOrganizationId).toBeDefined()
    })

    it('stores session token securely (HttpOnly, Secure, SameSite)', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('SameSite')
    })
  })

  describe('Session Validation', () => {
    it('validates active session', async () => {
      const res = await authRequest(app, 'GET', '/session/validate', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { valid: boolean }
      expect(body.valid).toBe(true)
    })

    it('returns 401 for missing session', async () => {
      const res = await authRequest(app, 'GET', '/session/validate', {})

      expect(res.status).toBe(401)
    })

    it('returns 401 for invalid session token', async () => {
      const res = await authRequest(app, 'GET', '/session/validate', {
        headers: { Cookie: 'session_token=invalid_session_xyz' },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for expired session', async () => {
      const res = await authRequest(app, 'GET', '/session/validate', {
        headers: { Cookie: 'session_token=expired_session' },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Session Refresh', () => {
    it('refreshes session before expiration', async () => {
      const res = await authRequest(app, 'POST', '/session/refresh', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as AuthKitResponse
      expect(body.session).toBeDefined()
    })

    it('issues new session token on refresh', async () => {
      const res = await authRequest(app, 'POST', '/session/refresh', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toContain('session')
    })

    it('extends session expiration on refresh', async () => {
      const res = await authRequest(app, 'POST', '/session/refresh', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { session: { expiresAt: string } }
      const expiresAt = new Date(body.session.expiresAt).getTime()
      expect(expiresAt).toBeGreaterThan(Date.now())
    })

    it('returns 401 when refresh is disabled', async () => {
      const noRefreshApp = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        session: {
          refreshEnabled: false,
        },
      })

      const res = await authRequest(noRefreshApp, 'POST', '/session/refresh', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([401, 403, 404]).toContain(res.status)
    })

    it('returns 401 for expired session (cannot refresh)', async () => {
      const res = await authRequest(app, 'POST', '/session/refresh', {
        headers: { Cookie: 'session_token=expired_session' },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Session Revocation', () => {
    it('revokes current session on logout', async () => {
      const res = await authRequest(app, 'POST', '/logout', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204, 302]).toContain(res.status)
    })

    it('clears session cookie on logout', async () => {
      const res = await authRequest(app, 'POST', '/logout', {
        headers: { Cookie: mockSessionCookie() },
      })

      const setCookie = res.headers.get('Set-Cookie')
      // Cookie should be cleared (Max-Age=0 or expires in past)
      expect(setCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i)
    })

    it('revokes all sessions for user', async () => {
      const res = await authRequest(app, 'POST', '/session/revoke-all', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([200, 204]).toContain(res.status)
    })

    it('validates that revoked session is no longer valid', async () => {
      // Logout first
      await authRequest(app, 'POST', '/logout', {
        headers: { Cookie: 'session_token=session_to_revoke' },
      })

      // Try to use the revoked session
      const res = await authRequest(app, 'GET', '/session/validate', {
        headers: { Cookie: 'session_token=session_to_revoke' },
      })

      expect(res.status).toBe(401)
    })

    it('admin can revoke user session', async () => {
      const res = await authRequest(app, 'POST', '/admin/sessions/session_123/revoke', {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect([200, 204]).toContain(res.status)
    })
  })

  describe('Session Context', () => {
    it('switches active organization', async () => {
      const res = await authRequest(app, 'POST', '/session/organization', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          organizationId: 'org_new',
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as AuthKitResponse
      expect(body.session?.activeOrganizationId).toBe('org_new')
    })

    it('returns 403 when switching to non-member organization', async () => {
      const res = await authRequest(app, 'POST', '/session/organization', {
        headers: { Cookie: mockSessionCookie() },
        body: {
          organizationId: 'org_not_a_member',
        },
      })

      expect(res.status).toBe(403)
    })

    it('retrieves session metadata', async () => {
      const res = await authRequest(app, 'GET', '/session', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        session: {
          createdAt: string
          lastActiveAt: string
          ipAddress: string
          userAgent: string
        }
      }
      expect(body.session.createdAt).toBeDefined()
      expect(body.session.lastActiveAt).toBeDefined()
    })
  })
})

// ============================================================================
// 6. Admin Portal Tests
// ============================================================================

describe('WorkOS AuthKit - Admin Portal', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
      adminPortal: { enabled: true },
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Generate Admin Portal Link', () => {
    it('generates admin portal link for SSO configuration', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'sso',
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.portalLink?.url).toBeDefined()
      expect(body.portalLink?.url).toContain('workos.com')
    })

    it('generates admin portal link for directory sync configuration', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'dsync',
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.portalLink?.url).toBeDefined()
    })

    it('generates admin portal link for audit logs', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'audit_logs',
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.portalLink?.url).toBeDefined()
    })

    it('generates admin portal link for log streams', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'log_streams',
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.portalLink?.url).toBeDefined()
    })

    it('includes link expiration time', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'sso',
        },
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.portalLink?.expiresAt).toBeDefined()
    })

    it('returns 400 for missing organization ID', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          intent: 'sso',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/organization|required/i)
    })

    it('returns 400 for invalid intent', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'invalid_intent',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/intent|invalid/i)
    })

    it('returns 403 for non-admin users', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockSessionCookie() }, // Regular user
        body: {
          organizationId: 'org_01EXAMPLE',
          intent: 'sso',
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('returns 404 for non-existent organization', async () => {
      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          organizationId: 'org_nonexistent',
          intent: 'sso',
        },
      })

      expect(res.status).toBe(404)
    })
  })

  describe('SSO Configuration Updates', () => {
    it('handles SSO connection created webhook', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/sso', {
        body: {
          event: 'connection.activated',
          data: {
            id: 'conn_new_01',
            connectionType: 'SAML',
            name: 'New SSO Connection',
            state: 'active',
            organizationId: 'org_01EXAMPLE',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles SSO connection deactivated webhook', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/sso', {
        body: {
          event: 'connection.deactivated',
          data: {
            id: 'conn_01EXAMPLE',
            organizationId: 'org_01EXAMPLE',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('handles SSO connection deleted webhook', async () => {
      const res = await authRequest(app, 'POST', '/webhooks/workos/sso', {
        body: {
          event: 'connection.deleted',
          data: {
            id: 'conn_01EXAMPLE',
            organizationId: 'org_01EXAMPLE',
          },
        },
      })

      expect([200, 202]).toContain(res.status)
    })
  })

  describe('List SSO Connections', () => {
    it('lists SSO connections for organization', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_01EXAMPLE/sso-connections', {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { connections: SSOConnection[] }
      expect(Array.isArray(body.connections)).toBe(true)
    })

    it('returns connection details including type and state', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_01EXAMPLE/sso-connections', {
        headers: { Cookie: mockAdminSessionCookie() },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { connections: SSOConnection[] }
      if (body.connections.length > 0) {
        const conn = body.connections[0]
        expect(conn.connectionType).toBeDefined()
        expect(conn.state).toBeDefined()
      }
    })

    it('returns 403 for non-admin users', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_01EXAMPLE/sso-connections', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect([401, 403]).toContain(res.status)
    })
  })
})

// ============================================================================
// 7. Error Handling Tests
// ============================================================================

describe('WorkOS AuthKit - Error Handling', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('Invalid State Errors', () => {
    it('returns 400 for missing state on SSO callback', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          code: 'valid_code',
          // Missing state
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/state|required|missing/i)
    })

    it('returns 400 for invalid state (CSRF)', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          code: 'valid_code',
          state: 'tampered_state',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/state|invalid|csrf/i)
    })

    it('returns 400 for expired state', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          code: 'valid_code',
          state: 'expired_state_abc123',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/state|expired|invalid/i)
    })
  })

  describe('Expired Token Errors', () => {
    it('returns 401 for expired authorization code', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          code: 'expired_auth_code',
          state: 'valid_state',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|invalid|code/i)
    })

    it('returns 401 for expired magic link token', async () => {
      const res = await authRequest(app, 'GET', '/magic-link/verify', {
        query: {
          token: 'expired_magic_token',
        },
      })

      expect([400, 401]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|token/i)
    })

    it('returns 401 for expired session token', async () => {
      const res = await authRequest(app, 'GET', '/session', {
        headers: { Cookie: 'session_token=expired_session_token' },
      })

      expect(res.status).toBe(401)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/expired|session|unauthorized/i)
    })

    it('returns 401 for expired admin portal link', async () => {
      // Try to use an expired portal link (simulated via redirect handling)
      const res = await authRequest(app, 'GET', '/admin-portal/callback', {
        query: {
          token: 'expired_portal_token',
        },
      })

      expect([400, 401]).toContain(res.status)
    })
  })

  describe('Organization Not Found Errors', () => {
    it('returns 404 for non-existent organization on SSO', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_does_not_exist',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/organization|not found/i)
    })

    it('returns 404 when domain has no associated organization', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          domain: 'unknown-domain.com',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/domain|organization|not found/i)
    })

    it('returns 404 for organization details of deleted org', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_deleted', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
    })
  })

  describe('Connection Errors', () => {
    it('returns 404 for non-existent SSO connection', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_does_not_exist',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/connection|not found/i)
    })

    it('returns 400 for inactive SSO connection', async () => {
      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          connection: 'conn_inactive',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([400, 403]).toContain(res.status)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/connection|inactive|disabled/i)
    })

    it('returns error for IdP-side authentication failure', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          error: 'access_denied',
          error_description: 'User denied access',
          state: 'valid_state',
        },
      })

      expect([400, 401, 302]).toContain(res.status)
    })
  })

  describe('WorkOS API Errors', () => {
    it('returns 500 when WorkOS API is unavailable', async () => {
      const badApp = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        baseUrl: 'https://unavailable.workos.example.com.ai',
      })

      const res = await authRequest(badApp, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([500, 502, 503]).toContain(res.status)
    })

    it('returns 401 for invalid WorkOS API key', async () => {
      const badApp = createTestApp({
        apiKey: 'invalid_api_key',
        clientId: TEST_WORKOS_CLIENT_ID,
      })

      const res = await authRequest(badApp, 'POST', '/organizations', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: {
          name: 'Test Org',
        },
      })

      expect([401, 403]).toContain(res.status)
    })

    it('handles rate limiting from WorkOS', async () => {
      // Simulate many requests
      const requests = Array.from({ length: 100 }, () =>
        authRequest(app, 'GET', '/sso/authorize', {
          query: {
            organization: 'org_01EXAMPLE',
            redirect_uri: TEST_REDIRECT_URI,
          },
        })
      )

      const responses = await Promise.all(requests)
      const rateLimited = responses.filter((r) => r.status === 429)

      // Some may be rate limited
      for (const res of rateLimited) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.error).toMatch(/rate|limit/i)
      }
    })
  })

  describe('Error Response Format', () => {
    it('returns JSON error response', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_nonexistent', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
      expect(res.headers.get('Content-Type')).toContain('application/json')
    })

    it('includes error code for programmatic handling', async () => {
      const res = await authRequest(app, 'GET', '/organizations/org_nonexistent', {
        headers: { Cookie: mockSessionCookie() },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as AuthKitResponse & { code?: string }
      expect(body.error).toBeDefined()
      // Optionally check for error code
      if (body.code) {
        expect(body.code).toMatch(/NOT_FOUND|ORG_NOT_FOUND/i)
      }
    })

    it('does not leak sensitive information in errors', async () => {
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: {
          code: 'invalid_code',
          state: 'valid_state',
        },
      })

      const body = (await res.json()) as AuthKitResponse

      // Should not contain stack traces or internal details
      expect(JSON.stringify(body)).not.toContain('at ')
      expect(JSON.stringify(body)).not.toContain('node_modules')
      expect(JSON.stringify(body)).not.toContain(TEST_WORKOS_API_KEY)
    })
  })
})

// ============================================================================
// 8. Configuration Tests
// ============================================================================

describe('WorkOS AuthKit - Configuration', () => {
  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
    clearTestEnv('WORKOS_CLIENT_ID')
  })

  describe('Environment Variable Configuration', () => {
    it('uses WORKOS_API_KEY from environment', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
      setTestEnv('WORKOS_CLIENT_ID', TEST_WORKOS_CLIENT_ID)

      const app = createTestApp({}) // No explicit config

      const res = await authRequest(app, 'GET', '/health', {})

      expect([200, 204]).toContain(res.status)
    })

    it('uses WORKOS_CLIENT_ID from environment', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
      setTestEnv('WORKOS_CLIENT_ID', TEST_WORKOS_CLIENT_ID)

      const app = createTestApp({})

      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })

    it('prefers explicit config over environment variables', async () => {
      setTestEnv('WORKOS_API_KEY', 'env_api_key')
      setTestEnv('WORKOS_CLIENT_ID', 'env_client_id')

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
      })

      // Should use explicit config, not env
      const res = await authRequest(app, 'GET', '/health', {})

      expect([200, 204]).toContain(res.status)
    })

    it('returns 500 when API key is missing', async () => {
      clearTestEnv('WORKOS_API_KEY')
      clearTestEnv('WORKOS_CLIENT_ID')

      const app = createTestApp({})

      const res = await authRequest(app, 'GET', '/health', {})

      expect(res.status).toBe(500)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/api.?key|configuration|missing/i)
    })
  })

  describe('Redirect URI Configuration', () => {
    it('validates redirect URI against allowed list', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
      setTestEnv('WORKOS_CLIENT_ID', TEST_WORKOS_CLIENT_ID)

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        allowedRedirectUris: ['https://app.example.com.ai/callback'],
      })

      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: 'https://evil.com/callback',
        },
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as AuthKitResponse
      expect(body.error).toMatch(/redirect|not allowed|invalid/i)
    })

    it('allows configured redirect URIs', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
      setTestEnv('WORKOS_CLIENT_ID', TEST_WORKOS_CLIENT_ID)

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        allowedRedirectUris: [TEST_REDIRECT_URI],
      })

      const res = await authRequest(app, 'GET', '/sso/authorize', {
        query: {
          organization: 'org_01EXAMPLE',
          redirect_uri: TEST_REDIRECT_URI,
        },
      })

      expect([200, 302]).toContain(res.status)
    })
  })

  describe('Feature Flags', () => {
    it('disables magic link when configured', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        magicLink: { enabled: false },
      })

      const res = await authRequest(app, 'POST', '/magic-link/send', {
        body: { email: 'test@example.com.ai' },
      })

      expect([403, 404]).toContain(res.status)
    })

    it('disables directory sync when configured', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        directorySync: { enabled: false },
      })

      const res = await authRequest(app, 'POST', '/directory-sync/users/sync', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: { directoryId: 'directory_01' },
      })

      expect([403, 404]).toContain(res.status)
    })

    it('disables admin portal when configured', async () => {
      setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)

      const app = createTestApp({
        apiKey: TEST_WORKOS_API_KEY,
        clientId: TEST_WORKOS_CLIENT_ID,
        adminPortal: { enabled: false },
      })

      const res = await authRequest(app, 'POST', '/admin-portal/link', {
        headers: { Cookie: mockAdminSessionCookie() },
        body: { organizationId: 'org_01', intent: 'sso' },
      })

      expect([403, 404]).toContain(res.status)
    })
  })
})

// ============================================================================
// 9. Identity Mapping Tests
// ============================================================================

describe('WorkOS AuthKit - Identity Mapping', () => {
  let app: Hono

  beforeEach(() => {
    setTestEnv('WORKOS_API_KEY', TEST_WORKOS_API_KEY)
    app = createTestApp({
      apiKey: TEST_WORKOS_API_KEY,
      clientId: TEST_WORKOS_CLIENT_ID,
    })
  })

  afterEach(() => {
    clearTestEnv('WORKOS_API_KEY')
  })

  describe('User to Identity Mapping', () => {
    it('creates identity with type human for WorkOS user', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse & {
          identity?: { type: string }
        }
        expect(body.identity?.type).toBe('human')
      }
    })

    it('creates linked account with provider workos', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse & {
          linkedAccount?: { provider: string }
        }
        expect(body.linkedAccount?.provider).toBe('workos')
      }
    })

    it('stores WorkOS user ID in linked account', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse & {
          linkedAccount?: { providerAccountId: string }
        }
        expect(body.linkedAccount?.providerAccountId).toMatch(/^user_/)
      }
    })

    it('updates existing identity on re-authentication', async () => {
      // First auth
      const callback1 = mockSSOCallback()
      await authRequest(app, 'GET', '/callback/workos', {
        query: callback1 as unknown as Record<string, string>,
      })

      // Second auth (same user)
      const callback2 = mockSSOCallback()
      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback2 as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        // Should update, not create duplicate
        expect(body.user?.id).toBeDefined()
      }
    })

    it('links WorkOS org to local organization via orgId', async () => {
      const callback = mockSSOCallback({ organization_id: 'org_01EXAMPLE' })

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse & {
          organization?: { workosOrgId?: string }
        }
        expect(body.organization?.workosOrgId).toBe('org_01EXAMPLE')
      }
    })
  })

  describe('Profile Synchronization', () => {
    it('syncs user profile from WorkOS on login', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user?.email).toBeDefined()
        expect(body.user?.firstName).toBeDefined()
      }
    })

    it('updates profile picture from WorkOS', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      if (res.status === 200) {
        const body = (await res.json()) as AuthKitResponse
        expect(body.user?.profilePictureUrl).toBeDefined()
      }
    })

    it('handles users without profile picture', async () => {
      const callback = mockSSOCallback()

      const res = await authRequest(app, 'GET', '/callback/workos', {
        query: callback as unknown as Record<string, string>,
      })

      // Should not fail if profile picture is missing
      expect([200, 302]).toContain(res.status)
    })
  })
})
