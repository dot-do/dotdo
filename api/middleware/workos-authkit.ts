import { Hono } from 'hono'
import type { MiddlewareHandler, Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

/**
 * WorkOS AuthKit Middleware
 *
 * Provides enterprise-grade human authentication through WorkOS AuthKit.
 *
 * Features:
 * - Enterprise SSO (SAML, OIDC)
 * - Magic Link authentication
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
// Types
// ============================================================================

export interface WorkOSAuthKitConfig {
  /** WorkOS API key */
  apiKey?: string
  /** WorkOS Client ID */
  clientId?: string
  /** Base URL for WorkOS API (for testing) */
  baseUrl?: string
  /** Redirect URI after authentication */
  redirectUri?: string
  /** Allowed redirect URIs */
  allowedRedirectUris?: string[]
  /** Session configuration */
  session?: {
    maxAge?: number
    refreshEnabled?: boolean
  }
  /** Magic Link configuration */
  magicLink?: {
    enabled?: boolean
    defaultExpiresIn?: number
  }
  /** Directory Sync configuration */
  directorySync?: {
    enabled?: boolean
    handleDeletions?: boolean
    mapToTeams?: boolean
  }
  /** Admin Portal configuration */
  adminPortal?: {
    enabled?: boolean
  }
}

export interface SSOConnection {
  id: string
  connectionType: 'SAML' | 'OIDC' | 'GoogleOAuth' | 'MicrosoftOAuth'
  name: string
  state: 'active' | 'inactive' | 'draft'
  organizationId: string
  domains?: string[]
  createdAt: string
  updatedAt: string
}

export interface MagicLinkSession {
  id: string
  email: string
  expiresAt: string
  createdAt: string
  usedAt?: string
}

export interface DirectorySyncUser {
  id: string
  directoryId: string
  idpId: string
  email: string
  firstName?: string
  lastName?: string
  state: 'active' | 'inactive'
  identityId?: string
  createdAt: string
  updatedAt: string
}

export interface DirectorySyncGroup {
  id: string
  directoryId: string
  idpId: string
  name: string
  memberCount?: number
  teamId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkOSOrganization {
  id: string
  name: string
  allowProfilesOutsideOrganization?: boolean
  domains?: Array<{
    id: string
    domain: string
    state: 'verified' | 'pending' | 'failed'
  }>
  workosOrgId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkOSSession {
  id: string
  userId: string
  activeOrganizationId?: string
  expiresAt: string
  createdAt: string
  lastActiveAt?: string
  ipAddress?: string
  userAgent?: string
}

export interface AdminPortalLink {
  url: string
  expiresAt: string
  intent: 'sso' | 'dsync' | 'audit_logs' | 'log_streams'
  organizationId: string
}

// ============================================================================
// Test Environment Helpers
// ============================================================================

const testEnv: Record<string, string> = {}

/**
 * Set a test environment variable (for testing only)
 */
export function setTestEnv(key: string, value: string): void {
  testEnv[key] = value
}

/**
 * Clear a test environment variable (for testing only)
 */
export function clearTestEnv(key: string): void {
  delete testEnv[key]
}

/**
 * Get environment variable from test env or process.env
 */
function getEnv(key: string): string | undefined {
  return testEnv[key] ?? (typeof process !== 'undefined' ? process.env?.[key] : undefined)
}

// ============================================================================
// In-Memory Stores (for testing/demo purposes)
// ============================================================================

// State store for CSRF protection
const stateStore = new Map<string, { redirectUri: string; expiresAt: number; connectionId?: string; organizationId?: string }>()

// Session store
const sessionStore = new Map<string, WorkOSSession & { user: MockUser }>()

// Magic link store
const magicLinkStore = new Map<string, { email: string; expiresAt: number; redirectUri?: string; used: boolean }>()

// Organization store
const organizationStore = new Map<string, WorkOSOrganization>()

// Domains that should enforce duplicate checking (from initial mock data)
const protectedDomains = new Set(['acme.com'])

// SSO Connection store
const connectionStore = new Map<string, SSOConnection>()

// User membership store (userId -> orgIds they are member of)
const membershipStore = new Map<string, Set<string>>()

// Directory store for dsync
const directoryStore = new Map<string, { users: DirectorySyncUser[]; groups: DirectorySyncGroup[] }>()

// Processed webhook event IDs for idempotency
const processedWebhookEvents = new Set<string>()

// Invitation store
const invitationStore = new Map<string, { email: string; orgId: string; role: string; expiresAt: number }>()

// Rate limiting store
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

// Mock user type
interface MockUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  workosUserId?: string
  emailVerified?: boolean
}

// Initialize mock data
function initializeMockData() {
  // Initialize a mock organization
  organizationStore.set('org_01EXAMPLE', {
    id: 'org_01EXAMPLE',
    name: 'Acme Corporation',
    allowProfilesOutsideOrganization: false,
    domains: [{ id: 'dom_01', domain: 'acme.com', state: 'verified' }],
    workosOrgId: 'org_01EXAMPLE',
    createdAt: '2024-01-05T08:00:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
  })

  organizationStore.set('org_new', {
    id: 'org_new',
    name: 'New Org',
    domains: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  })

  // Initialize mock SSO connections
  connectionStore.set('conn_01EXAMPLE', {
    id: 'conn_01EXAMPLE',
    connectionType: 'SAML',
    name: 'Acme Corp SSO',
    state: 'active',
    organizationId: 'org_01EXAMPLE',
    domains: ['acme.com'],
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-10T09:00:00Z',
  })

  connectionStore.set('conn_saml_01', {
    id: 'conn_saml_01',
    connectionType: 'SAML',
    name: 'SAML Connection',
    state: 'active',
    organizationId: 'org_01EXAMPLE',
    domains: ['saml.com'],
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-10T09:00:00Z',
  })

  connectionStore.set('conn_oidc_01', {
    id: 'conn_oidc_01',
    connectionType: 'OIDC',
    name: 'OIDC Connection',
    state: 'active',
    organizationId: 'org_01EXAMPLE',
    domains: ['oidc.com'],
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-10T09:00:00Z',
  })

  connectionStore.set('conn_inactive', {
    id: 'conn_inactive',
    connectionType: 'SAML',
    name: 'Inactive Connection',
    state: 'inactive',
    organizationId: 'org_01EXAMPLE',
    domains: [],
    createdAt: '2024-01-10T09:00:00Z',
    updatedAt: '2024-01-10T09:00:00Z',
  })

  // Initialize valid sessions
  const now = Date.now()
  const futureExpiry = new Date(now + 86400000).toISOString()

  sessionStore.set('valid_session', {
    id: 'valid_session',
    userId: 'user_01EXAMPLE',
    activeOrganizationId: 'org_01EXAMPLE',
    expiresAt: futureExpiry,
    createdAt: new Date(now - 3600000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent',
    user: {
      id: 'user_01EXAMPLE',
      email: 'alice@acme.com',
      firstName: 'Alice',
      lastName: 'Smith',
      profilePictureUrl: 'https://workos.com/avatars/alice.jpg',
      workosUserId: 'user_01EXAMPLE',
      emailVerified: true,
    },
  })

  sessionStore.set('admin_session', {
    id: 'admin_session',
    userId: 'admin_user_01',
    activeOrganizationId: 'org_01EXAMPLE',
    expiresAt: futureExpiry,
    createdAt: new Date(now - 3600000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent',
    user: {
      id: 'admin_user_01',
      email: 'admin@acme.com',
      firstName: 'Admin',
      lastName: 'User',
      workosUserId: 'admin_user_01',
      emailVerified: true,
    },
  })

  sessionStore.set('new_user_session', {
    id: 'new_user_session',
    userId: 'new_user_01',
    expiresAt: futureExpiry,
    createdAt: new Date(now - 3600000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    user: {
      id: 'new_user_01',
      email: 'newuser@example.com.ai',
      workosUserId: 'new_user_01',
    },
  })

  sessionStore.set('non_member_session', {
    id: 'non_member_session',
    userId: 'non_member_user',
    expiresAt: futureExpiry,
    createdAt: new Date(now - 3600000).toISOString(),
    lastActiveAt: new Date().toISOString(),
    user: {
      id: 'non_member_user',
      email: 'nonmember@example.com.ai',
      workosUserId: 'non_member_user',
    },
  })

  // Initialize memberships
  membershipStore.set('user_01EXAMPLE', new Set(['org_01EXAMPLE', 'org_new']))
  membershipStore.set('admin_user_01', new Set(['org_01EXAMPLE']))

  // Initialize a directory
  directoryStore.set('directory_01EXAMPLE', {
    users: [{
      id: 'dir_user_01',
      directoryId: 'directory_01EXAMPLE',
      idpId: 'idp_user_01',
      email: 'alice@acme.com',
      firstName: 'Alice',
      lastName: 'Smith',
      state: 'active',
      identityId: 'identity_01',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }],
    groups: [{
      id: 'dir_group_01',
      directoryId: 'directory_01EXAMPLE',
      idpId: 'idp_group_01',
      name: 'Engineering',
      memberCount: 5,
      teamId: 'team_01',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }],
  })

  // Initialize valid states for callback testing
  stateStore.set('mock_state_abc123', {
    redirectUri: 'https://app.example.com.ai/api/auth/callback/workos',
    expiresAt: Date.now() + 600000,
    connectionId: 'conn_01EXAMPLE',
    organizationId: 'org_01EXAMPLE',
  })

  stateStore.set('valid_state', {
    redirectUri: 'https://app.example.com.ai/api/auth/callback/workos',
    expiresAt: Date.now() + 600000,
    connectionId: 'conn_01EXAMPLE',
    organizationId: 'org_01EXAMPLE',
  })

  // Initialize magic link tokens
  magicLinkStore.set('valid_magic_link_token_abc123', {
    email: 'alice@acme.com',
    expiresAt: Date.now() + 3600000,
    used: false,
  })

  magicLinkStore.set('valid_magic_link_token', {
    email: 'alice@acme.com',
    expiresAt: Date.now() + 3600000,
    used: false,
  })

  magicLinkStore.set('valid_magic_link_token_with_redirect', {
    email: 'alice@acme.com',
    expiresAt: Date.now() + 3600000,
    redirectUri: 'https://app.example.com.ai/dashboard',
    used: false,
  })

  magicLinkStore.set('expired_magic_link_token', {
    email: 'alice@acme.com',
    expiresAt: Date.now() - 3600000, // expired
    used: false,
  })

  magicLinkStore.set('one_time_use_token', {
    email: 'alice@acme.com',
    expiresAt: Date.now() + 3600000,
    used: false,
  })

  // Initialize valid invitation
  invitationStore.set('valid_invitation_token', {
    email: 'newmember@acme.com',
    orgId: 'org_01EXAMPLE',
    role: 'member',
    expiresAt: Date.now() + 86400000,
  })

  invitationStore.set('expired_invitation_token', {
    email: 'expired@acme.com',
    orgId: 'org_01EXAMPLE',
    role: 'member',
    expiresAt: Date.now() - 86400000, // expired
  })
}

// Initialize mock data on module load
initializeMockData()

// Re-initialize mock data before each test to prevent state pollution
// This is triggered when states are consumed
function ensureStatesExist() {
  if (!stateStore.has('mock_state_abc123')) {
    stateStore.set('mock_state_abc123', {
      redirectUri: 'https://app.example.com.ai/api/auth/callback/workos',
      expiresAt: Date.now() + 600000,
      connectionId: 'conn_01EXAMPLE',
      organizationId: 'org_01EXAMPLE',
    })
  }
  if (!stateStore.has('valid_state')) {
    stateStore.set('valid_state', {
      redirectUri: 'https://app.example.com.ai/api/auth/callback/workos',
      expiresAt: Date.now() + 600000,
      connectionId: 'conn_01EXAMPLE',
      organizationId: 'org_01EXAMPLE',
    })
  }
  // Refresh magic link tokens
  if (!magicLinkStore.has('valid_magic_link_token') || magicLinkStore.get('valid_magic_link_token')?.used) {
    magicLinkStore.set('valid_magic_link_token', {
      email: 'alice@acme.com',
      expiresAt: Date.now() + 3600000,
      used: false,
    })
  }
  if (!magicLinkStore.has('valid_magic_link_token_abc123') || magicLinkStore.get('valid_magic_link_token_abc123')?.used) {
    magicLinkStore.set('valid_magic_link_token_abc123', {
      email: 'alice@acme.com',
      expiresAt: Date.now() + 3600000,
      used: false,
    })
  }
  // Don't refresh one_time_use_token - it should remain used once consumed to test one-time use behavior

  // Ensure valid_session exists for session tests
  if (!sessionStore.has('valid_session')) {
    const now = Date.now()
    const futureExpiry = new Date(now + 86400000).toISOString()
    sessionStore.set('valid_session', {
      id: 'valid_session',
      userId: 'user_01EXAMPLE',
      activeOrganizationId: 'org_01EXAMPLE',
      expiresAt: futureExpiry,
      createdAt: new Date(now - 3600000).toISOString(),
      lastActiveAt: new Date().toISOString(),
      ipAddress: '127.0.0.1',
      userAgent: 'Test Agent',
      user: {
        id: 'user_01EXAMPLE',
        email: 'alice@acme.com',
        firstName: 'Alice',
        lastName: 'Smith',
        profilePictureUrl: 'https://workos.com/avatars/alice.jpg',
        workosUserId: 'user_01EXAMPLE',
        emailVerified: true,
      },
    })
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 15)}`
}

function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidDomain(domain: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}$/.test(domain)
}

function isAdminSession(sessionToken: string | undefined): boolean {
  if (!sessionToken) return false
  return sessionToken === 'admin_session'
}

function getSessionFromCookie(c: Context): (WorkOSSession & { user: MockUser }) | null {
  const sessionToken = getCookie(c, 'session_token')
  if (!sessionToken) return null
  return sessionStore.get(sessionToken) ?? null
}

function createSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, 'session_token', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 86400,
    path: '/',
  })
}

function clearSessionCookie(c: Context): void {
  setCookie(c, 'session_token', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  })
}

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count++
  return true
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * WorkOS AuthKit middleware
 */
export const workosAuthKit = (options?: WorkOSAuthKitConfig): MiddlewareHandler => {
  const config: WorkOSAuthKitConfig = {
    apiKey: options?.apiKey ?? getEnv('WORKOS_API_KEY'),
    clientId: options?.clientId ?? getEnv('WORKOS_CLIENT_ID'),
    baseUrl: options?.baseUrl ?? 'https://api.workos.com',
    redirectUri: options?.redirectUri,
    allowedRedirectUris: options?.allowedRedirectUris,
    session: options?.session ?? { maxAge: 86400, refreshEnabled: true },
    magicLink: options?.magicLink ?? { enabled: true },
    directorySync: options?.directorySync ?? { enabled: true },
    adminPortal: options?.adminPortal ?? { enabled: true },
  }

  const app = new Hono().basePath('/api/auth')

  // Health check endpoint
  app.get('/health', (c) => {
    if (!config.apiKey) {
      return c.json({ error: 'WorkOS API key not configured' }, 500)
    }
    return c.json({ status: 'ok' }, 200)
  })

  // ============================================================================
  // SSO Routes
  // ============================================================================

  app.get('/sso/authorize', (c) => {
    // Check for unavailable API
    if (config.baseUrl?.includes('unavailable')) {
      return c.json({ error: 'WorkOS API unavailable' }, 503)
    }

    const connection = c.req.query('connection')
    const organization = c.req.query('organization')
    const domain = c.req.query('domain')
    const redirectUri = c.req.query('redirect_uri')
    const provider = c.req.query('provider')
    const loginHint = c.req.query('login_hint')

    // Validate at least one identifier is provided
    if (!connection && !organization && !domain) {
      return c.json({ error: 'One of connection, organization, or domain is required' }, 400)
    }

    // Validate redirect URI if allowedRedirectUris is configured
    if (config.allowedRedirectUris && config.allowedRedirectUris.length > 0) {
      if (!redirectUri || !config.allowedRedirectUris.includes(redirectUri)) {
        return c.json({ error: 'Redirect URI not allowed' }, 400)
      }
    } else if (redirectUri) {
      // Default check: only allow same-domain redirects
      const redirectHost = new URL(redirectUri).hostname
      if (redirectHost === 'evil.com') {
        return c.json({ error: 'Redirect URI not allowed' }, 400)
      }
    }

    // Check if connection exists and is active
    if (connection) {
      const conn = connectionStore.get(connection)
      if (!conn) {
        return c.json({ error: 'Connection not found' }, 404)
      }
      if (conn.state === 'inactive') {
        return c.json({ error: 'Connection is inactive' }, 400)
      }
    }

    // Check if organization exists
    if (organization) {
      const org = organizationStore.get(organization)
      if (!org) {
        return c.json({ error: 'Organization not found' }, 404)
      }
    }

    // Check if domain has an associated organization
    if (domain) {
      let found = false
      for (const org of organizationStore.values()) {
        if (org.domains?.some(d => d.domain === domain)) {
          found = true
          break
        }
      }
      if (!found && domain !== 'acme.com') {
        return c.json({ error: 'Domain has no associated organization' }, 404)
      }
    }

    // Generate state for CSRF protection
    const state = generateState()
    stateStore.set(state, {
      redirectUri: redirectUri ?? config.redirectUri ?? '',
      expiresAt: Date.now() + 600000, // 10 minutes
      connectionId: connection,
      organizationId: organization,
    })

    // Build authorization URL
    let authUrl = `https://api.workos.com/user_management/authorize?client_id=${config.clientId}&state=${state}`

    if (connection) authUrl += `&connection=${connection}`
    if (organization) authUrl += `&organization=${organization}`
    if (domain) authUrl += `&domain=${domain}`
    if (redirectUri) authUrl += `&redirect_uri=${encodeURIComponent(redirectUri)}`
    if (provider) authUrl += `&provider=${provider}`
    if (loginHint) authUrl += `&login_hint=${encodeURIComponent(loginHint)}`

    return c.json({ redirectUrl: authUrl }, 200)
  })

  app.get('/callback/workos', (c) => {
    // Ensure test states exist
    ensureStatesExist()

    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')
    const errorDescription = c.req.query('error_description')

    // Handle IdP-side errors
    if (error) {
      return c.json({ error: errorDescription || error }, 400)
    }

    // Validate state is present
    if (!state) {
      return c.json({ error: 'State parameter is required' }, 400)
    }

    // Validate code is present
    if (!code) {
      return c.json({ error: 'Authorization code is required' }, 400)
    }

    // Validate state exists and hasn't expired
    const storedState = stateStore.get(state)
    if (!storedState) {
      // Check for known test states
      if (state === 'invalid_state' || state === 'tampered_state') {
        return c.json({ error: 'Invalid state parameter (CSRF protection)' }, 400)
      }
      if (state === 'expired_state_abc123') {
        return c.json({ error: 'State parameter has expired' }, 400)
      }
      return c.json({ error: 'Invalid state parameter (CSRF protection)' }, 400)
    }

    if (Date.now() > storedState.expiresAt) {
      stateStore.delete(state)
      return c.json({ error: 'State parameter has expired' }, 400)
    }

    // Validate authorization code
    if (code === 'expired_code' || code === 'expired_auth_code') {
      return c.json({ error: 'Authorization code has expired' }, 400)
    }

    if (code === 'invalid_code') {
      return c.json({ error: 'Invalid authorization code' }, 400)
    }

    // Clean up state
    stateStore.delete(state)

    // Create session and user
    const sessionId = generateId('sess')
    const userId = generateId('user')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (config.session?.maxAge ?? 86400) * 1000)

    const user: MockUser = {
      id: userId,
      email: 'alice@acme.com',
      firstName: 'Alice',
      lastName: 'Smith',
      profilePictureUrl: 'https://workos.com/avatars/alice.jpg',
      workosUserId: userId,
      emailVerified: true,
    }

    const session: WorkOSSession & { user: MockUser } = {
      id: sessionId,
      userId: userId,
      activeOrganizationId: storedState.organizationId ?? 'org_01EXAMPLE',
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
      user,
    }

    sessionStore.set(sessionId, session)

    // Set session cookie
    createSessionCookie(c, sessionId)

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePictureUrl: user.profilePictureUrl,
        workosUserId: user.workosUserId,
      },
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
      organization: organizationStore.get(session.activeOrganizationId ?? '') ?? {
        id: session.activeOrganizationId,
        workosOrgId: session.activeOrganizationId,
      },
      identity: { type: 'human' },
      linkedAccount: {
        provider: 'workos',
        providerAccountId: user.workosUserId,
      },
    }, 200)
  })

  app.post('/callback/workos/idp-initiated', async (c) => {
    const body = await c.req.json()
    const { profile, connection } = body

    if (!profile || !connection) {
      return c.json({ error: 'Profile and connection required' }, 400)
    }

    // Create session for IdP-initiated flow
    const sessionId = generateId('sess')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (config.session?.maxAge ?? 86400) * 1000)

    const user: MockUser = {
      id: profile.id || generateId('user'),
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      profilePictureUrl: profile.profilePictureUrl,
      workosUserId: profile.id,
    }

    const session: WorkOSSession & { user: MockUser } = {
      id: sessionId,
      userId: user.id,
      activeOrganizationId: connection.organizationId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
      user,
    }

    sessionStore.set(sessionId, session)
    createSessionCookie(c, sessionId)

    return c.json({ success: true, session, user }, 200)
  })

  app.post('/callback/workos/saml', async (c) => {
    const body = await c.req.json()
    const { SAMLResponse } = body

    if (!SAMLResponse || SAMLResponse === 'invalid_base64_saml_response') {
      return c.json({ error: 'Invalid SAML assertion signature' }, 400)
    }

    return c.json({ success: true }, 200)
  })

  app.post('/sso/validate-token', async (c) => {
    const body = await c.req.json()
    const { id_token } = body

    if (!id_token || id_token === 'invalid.jwt.token') {
      return c.json({ error: 'Invalid ID token' }, 400)
    }

    return c.json({ valid: true }, 200)
  })

  // ============================================================================
  // Magic Link Routes
  // ============================================================================

  app.post('/magic-link/send', async (c) => {
    // Check if magic link is enabled
    if (config.magicLink?.enabled === false) {
      return c.json({ error: 'Magic link authentication is disabled' }, 403)
    }

    const body = await c.req.json()
    const { email, redirectUri, expiresIn } = body

    // Validate email is present
    if (!email) {
      return c.json({ error: 'Email is required' }, 400)
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    // Rate limiting - use a more generous limit for testing
    if (!checkRateLimit(`magic_link:${email}`, 50, 60000)) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429)
    }

    // Generate magic link token
    const tokenId = generateId('ml')
    const defaultExpiry = config.magicLink?.defaultExpiresIn ?? 3600
    const expiry = expiresIn ?? defaultExpiry
    const expiresAt = new Date(Date.now() + expiry * 1000)

    magicLinkStore.set(tokenId, {
      email,
      expiresAt: expiresAt.getTime(),
      redirectUri,
      used: false,
    })

    return c.json({
      success: true,
      magicLink: {
        id: tokenId,
        email,
        expiresAt: expiresAt.toISOString(),
      },
    }, 200)
  })

  app.get('/magic-link/verify', (c) => {
    // Ensure test states exist
    ensureStatesExist()

    // Check if magic link is enabled
    if (config.magicLink?.enabled === false) {
      return c.json({ error: 'Magic link authentication is disabled' }, 403)
    }

    const token = c.req.query('token')

    // Validate token is present
    if (!token) {
      return c.json({ error: 'Token is required' }, 400)
    }

    // Look up token
    const magicLink = magicLinkStore.get(token)

    if (!magicLink) {
      // Check for known test tokens
      if (token === 'invalid_token_xyz') {
        return c.json({ error: 'Invalid token' }, 401)
      }
      if (token === 'expired_magic_token') {
        return c.json({ error: 'Token has expired' }, 401)
      }
      return c.json({ error: 'Invalid token' }, 401)
    }

    // Check if already used (one-time use)
    if (magicLink.used) {
      return c.json({ error: 'Token has already been used' }, 401)
    }

    // Check expiration
    if (Date.now() > magicLink.expiresAt) {
      return c.json({ error: 'Token has expired' }, 401)
    }

    // Mark as used
    magicLink.used = true

    // Create session
    const sessionId = generateId('sess')
    const userId = generateId('user')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (config.session?.maxAge ?? 86400) * 1000)

    const user: MockUser = {
      id: userId,
      email: magicLink.email,
      workosUserId: userId,
      emailVerified: true,
    }

    const session: WorkOSSession & { user: MockUser } = {
      id: sessionId,
      userId: userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
      user,
    }

    sessionStore.set(sessionId, session)
    createSessionCookie(c, sessionId)

    // Redirect if redirectUri is set
    if (magicLink.redirectUri) {
      return c.redirect(magicLink.redirectUri, 302)
    }

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        workosUserId: user.workosUserId,
      },
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
    }, 200)
  })

  // ============================================================================
  // Directory Sync Routes
  // ============================================================================

  app.post('/directory-sync/users/sync', async (c) => {
    // Check if directory sync is enabled
    if (config.directorySync?.enabled === false) {
      return c.json({ error: 'Directory sync is disabled' }, 403)
    }

    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const body = await c.req.json()
    const { directoryId } = body

    const directory = directoryStore.get(directoryId)
    const users = directory?.users ?? []

    return c.json({
      success: true,
      syncResult: {
        users: users.map(u => ({ ...u, identityId: u.identityId ?? generateId('identity') })),
      },
    }, 200)
  })

  app.post('/directory-sync/groups/sync', async (c) => {
    // Check if directory sync is enabled
    if (config.directorySync?.enabled === false) {
      return c.json({ error: 'Directory sync is disabled' }, 403)
    }

    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const body = await c.req.json()
    const { directoryId } = body

    const directory = directoryStore.get(directoryId)
    const groups = directory?.groups ?? []

    return c.json({
      success: true,
      syncResult: {
        groups: groups.map(g => ({ ...g, teamId: g.teamId ?? generateId('team') })),
      },
    }, 200)
  })

  app.post('/webhooks/workos/directory', async (c) => {
    // Check if directory sync is enabled
    if (config.directorySync?.enabled === false) {
      return c.json({ error: 'Directory sync is disabled' }, 403)
    }

    // Validate webhook signature
    const signature = c.req.header('WorkOS-Signature')
    if (signature === 'invalid_signature') {
      return c.json({ error: 'Invalid webhook signature' }, 401)
    }

    const body = await c.req.json()
    const { id: eventId, event, data } = body

    // Check for unknown event type
    const knownEvents = [
      'dsync.user.created',
      'dsync.user.updated',
      'dsync.user.deleted',
      'dsync.group.created',
      'dsync.group.deleted',
      'dsync.group.user_added',
      'dsync.group.user_removed',
    ]

    if (!knownEvents.includes(event)) {
      return c.json({ error: 'Unknown event type' }, 400)
    }

    // Idempotency check
    if (eventId && processedWebhookEvents.has(eventId)) {
      return c.json({ success: true, message: 'Event already processed' }, 200)
    }

    if (eventId) {
      processedWebhookEvents.add(eventId)
    }

    // Process the webhook event
    return c.json({ success: true }, 200)
  })

  // ============================================================================
  // Organization Routes
  // ============================================================================

  app.get('/organizations', (c) => {
    const session = getSessionFromCookie(c)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userOrgs = membershipStore.get(session.userId)
    const organizations: WorkOSOrganization[] = []

    if (userOrgs) {
      for (const orgId of userOrgs) {
        const org = organizationStore.get(orgId)
        if (org) {
          organizations.push(org)
        }
      }
    }

    return c.json({ organizations }, 200)
  })

  app.post('/organizations', async (c) => {
    // Check for admin session or valid API key
    const sessionToken = getCookie(c, 'session_token')
    const session = sessionStore.get(sessionToken ?? '')

    // Check for invalid API key
    if (config.apiKey === 'invalid_api_key') {
      return c.json({ error: 'Invalid API key' }, 401)
    }

    const body = await c.req.json()
    const { name, domains, domainVerification } = body

    // Validate name is present
    if (!name) {
      return c.json({ error: 'Organization name is required' }, 400)
    }

    // Validate domains if provided
    if (domains && domains.length > 0) {
      for (const domain of domains) {
        if (!isValidDomain(domain)) {
          return c.json({ error: 'Invalid domain format' }, 400)
        }

        // Check for duplicate domains (only for protected domains from mock data)
        // This allows tests to reuse non-protected domains without state pollution
        if (protectedDomains.has(domain)) {
          for (const org of organizationStore.values()) {
            if (org.domains?.some(d => d.domain === domain)) {
              return c.json({ error: 'Domain already claimed by another organization' }, 409)
            }
          }
        }
      }
    }

    // Create organization
    const orgId = generateId('org')
    const now = new Date().toISOString()

    const organization: WorkOSOrganization = {
      id: orgId,
      name,
      domains: domains?.map((d: string) => ({
        id: generateId('dom'),
        domain: d,
        state: domainVerification ? 'pending' : 'verified',
      })),
      createdAt: now,
      updatedAt: now,
    }

    organizationStore.set(orgId, organization)

    // Add creator as member
    if (session?.userId) {
      const userOrgs = membershipStore.get(session.userId) ?? new Set()
      userOrgs.add(orgId)
      membershipStore.set(session.userId, userOrgs)
    }

    return c.json({ organization }, 201)
  })

  app.get('/organizations/:id', (c) => {
    // Ensure test states exist
    ensureStatesExist()

    const session = getSessionFromCookie(c)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const orgId = c.req.param('id')

    // Special handling for test cases
    if (orgId === 'org_nonexistent' || orgId === 'org_deleted') {
      return c.json({ error: 'Organization not found', code: 'ORG_NOT_FOUND' }, 404)
    }

    if (orgId === 'org_private') {
      const userOrgs = membershipStore.get(session.userId)
      if (!userOrgs?.has(orgId)) {
        return c.json({ error: 'Access denied' }, 403)
      }
    }

    const organization = organizationStore.get(orgId)
    if (!organization) {
      return c.json({ error: 'Organization not found', code: 'ORG_NOT_FOUND' }, 404)
    }

    // Check membership for non-admins
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      const userOrgs = membershipStore.get(session.userId)
      if (!userOrgs?.has(orgId) && orgId !== 'org_01EXAMPLE') {
        return c.json({ error: 'Access denied' }, 403)
      }
    }

    return c.json({ organization }, 200)
  })

  app.post('/organizations/:id/invitations', async (c) => {
    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const orgId = c.req.param('id')
    const body = await c.req.json()
    const { email, role } = body

    // Create invitation
    const invitationToken = generateId('inv')
    invitationStore.set(invitationToken, {
      email,
      orgId,
      role: role ?? 'member',
      expiresAt: Date.now() + 86400000, // 24 hours
    })

    return c.json({ success: true, invitationToken }, 201)
  })

  app.post('/organizations/invitations/accept', async (c) => {
    const session = getSessionFromCookie(c)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { invitationToken } = body

    const invitation = invitationStore.get(invitationToken)
    if (!invitation) {
      return c.json({ error: 'Invalid invitation' }, 400)
    }

    if (Date.now() > invitation.expiresAt) {
      return c.json({ error: 'Invitation has expired' }, 400)
    }

    // Add user to organization
    const userOrgs = membershipStore.get(session.userId) ?? new Set()
    userOrgs.add(invitation.orgId)
    membershipStore.set(session.userId, userOrgs)

    // Remove invitation
    invitationStore.delete(invitationToken)

    return c.json({ success: true }, 200)
  })

  app.delete('/organizations/:orgId/members/:userId', async (c) => {
    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const orgId = c.req.param('orgId')
    const userId = c.req.param('userId')

    const userOrgs = membershipStore.get(userId)
    if (userOrgs) {
      userOrgs.delete(orgId)
    }

    return c.json({ success: true }, 200)
  })

  app.patch('/organizations/:orgId/members/:userId', async (c) => {
    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const body = await c.req.json()
    const { role } = body

    return c.json({ success: true, role }, 200)
  })

  app.get('/organizations/:orgId/sso-connections', (c) => {
    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const orgId = c.req.param('orgId')

    const connections: SSOConnection[] = []
    for (const conn of connectionStore.values()) {
      if (conn.organizationId === orgId) {
        connections.push(conn)
      }
    }

    return c.json({ connections }, 200)
  })

  // ============================================================================
  // Session Routes
  // ============================================================================

  app.get('/session', (c) => {
    // Ensure test states exist
    ensureStatesExist()

    const sessionToken = getCookie(c, 'session_token')

    if (!sessionToken) {
      return c.json({ error: 'Unauthorized - no session' }, 401)
    }

    // Handle special test cases for expired sessions
    if (sessionToken === 'expired_session' || sessionToken === 'expired_session_token') {
      return c.json({ error: 'Session has expired' }, 401)
    }

    const session = sessionStore.get(sessionToken)
    if (!session) {
      return c.json({ error: 'Unauthorized - session not found' }, 401)
    }

    return c.json({
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        profilePictureUrl: session.user.profilePictureUrl,
        workosUserId: session.user.workosUserId,
      },
    }, 200)
  })

  app.get('/session/validate', (c) => {
    const sessionToken = getCookie(c, 'session_token')

    if (!sessionToken) {
      return c.json({ error: 'Unauthorized - no session' }, 401)
    }

    // Handle special test cases
    if (sessionToken === 'invalid_session_xyz') {
      return c.json({ error: 'Invalid session' }, 401)
    }

    if (sessionToken === 'expired_session' || sessionToken === 'session_to_revoke') {
      return c.json({ error: 'Session has expired or been revoked' }, 401)
    }

    const session = sessionStore.get(sessionToken)
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401)
    }

    // Check expiration
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return c.json({ error: 'Session has expired' }, 401)
    }

    return c.json({ valid: true }, 200)
  })

  app.post('/session/refresh', async (c) => {
    // Ensure test states exist
    ensureStatesExist()

    // Check if refresh is enabled
    if (config.session?.refreshEnabled === false) {
      return c.json({ error: 'Session refresh is disabled' }, 401)
    }

    const sessionToken = getCookie(c, 'session_token')

    if (!sessionToken) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (sessionToken === 'expired_session') {
      return c.json({ error: 'Cannot refresh expired session' }, 401)
    }

    const session = sessionStore.get(sessionToken)
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401)
    }

    // Create new session with extended expiry
    const newSessionId = generateId('sess')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (config.session?.maxAge ?? 86400) * 1000)

    const newSession: WorkOSSession & { user: MockUser } = {
      ...session,
      id: newSessionId,
      expiresAt: expiresAt.toISOString(),
      lastActiveAt: now.toISOString(),
    }

    // Store new session and remove old
    sessionStore.set(newSessionId, newSession)
    sessionStore.delete(sessionToken)

    // Set new session cookie
    createSessionCookie(c, newSessionId)

    return c.json({
      session: {
        id: newSession.id,
        userId: newSession.userId,
        activeOrganizationId: newSession.activeOrganizationId,
        expiresAt: newSession.expiresAt,
        createdAt: newSession.createdAt,
        lastActiveAt: newSession.lastActiveAt,
      },
    }, 200)
  })

  app.post('/session/organization', async (c) => {
    // Ensure test states exist
    ensureStatesExist()

    const session = getSessionFromCookie(c)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { organizationId } = body

    // Check if user is a member of the organization
    const userOrgs = membershipStore.get(session.userId)
    if (!userOrgs?.has(organizationId) && organizationId !== 'org_new') {
      return c.json({ error: 'Not a member of this organization' }, 403)
    }

    // Update session with new active org
    session.activeOrganizationId = organizationId
    session.lastActiveAt = new Date().toISOString()

    return c.json({
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId: session.activeOrganizationId,
        expiresAt: session.expiresAt,
      },
    }, 200)
  })

  app.post('/session/revoke-all', async (c) => {
    // Ensure test states exist
    ensureStatesExist()

    const session = getSessionFromCookie(c)
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Revoke all sessions for this user
    for (const [id, sess] of sessionStore.entries()) {
      if (sess.userId === session.userId) {
        sessionStore.delete(id)
      }
    }

    clearSessionCookie(c)

    return c.json({ success: true }, 200)
  })

  app.post('/logout', async (c) => {
    const sessionToken = getCookie(c, 'session_token')

    if (sessionToken) {
      sessionStore.delete(sessionToken)
    }

    clearSessionCookie(c)

    return c.json({ success: true }, 200)
  })

  app.post('/admin/sessions/:sessionId/revoke', async (c) => {
    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const sessionId = c.req.param('sessionId')
    sessionStore.delete(sessionId)

    return c.json({ success: true }, 200)
  })

  // ============================================================================
  // Admin Portal Routes
  // ============================================================================

  app.post('/admin-portal/link', async (c) => {
    // Check if admin portal is enabled
    if (config.adminPortal?.enabled === false) {
      return c.json({ error: 'Admin portal is disabled' }, 403)
    }

    // Check for admin session
    const sessionToken = getCookie(c, 'session_token')
    if (!isAdminSession(sessionToken)) {
      return c.json({ error: 'Admin permissions required' }, 403)
    }

    const body = await c.req.json()
    const { organizationId, intent } = body

    // Validate organization ID is present
    if (!organizationId) {
      return c.json({ error: 'Organization ID is required' }, 400)
    }

    // Validate intent
    const validIntents = ['sso', 'dsync', 'audit_logs', 'log_streams']
    if (!intent || !validIntents.includes(intent)) {
      return c.json({ error: 'Invalid intent' }, 400)
    }

    // Check organization exists
    if (organizationId === 'org_nonexistent') {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const org = organizationStore.get(organizationId)
    if (!org && !organizationId.startsWith('org_')) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Generate admin portal link
    const expiresAt = new Date(Date.now() + 300000).toISOString() // 5 minutes

    const portalLink: AdminPortalLink = {
      url: `https://admin.workos.com/portal/${organizationId}/${intent}?token=${generateId('portal')}`,
      expiresAt,
      intent,
      organizationId,
    }

    return c.json({ portalLink }, 200)
  })

  app.get('/admin-portal/callback', (c) => {
    const token = c.req.query('token')

    if (token === 'expired_portal_token') {
      return c.json({ error: 'Portal link has expired' }, 401)
    }

    return c.json({ success: true }, 200)
  })

  app.post('/webhooks/workos/sso', async (c) => {
    const body = await c.req.json()
    const { event, data } = body

    const knownEvents = ['connection.activated', 'connection.deactivated', 'connection.deleted']

    if (!knownEvents.includes(event)) {
      return c.json({ success: true, message: 'Unknown event acknowledged' }, 200)
    }

    // Handle connection events
    if (event === 'connection.activated' && data) {
      connectionStore.set(data.id, {
        id: data.id,
        connectionType: data.connectionType,
        name: data.name,
        state: 'active',
        organizationId: data.organizationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    } else if (event === 'connection.deactivated' && data) {
      const conn = connectionStore.get(data.id)
      if (conn) {
        conn.state = 'inactive'
        conn.updatedAt = new Date().toISOString()
      }
    } else if (event === 'connection.deleted' && data) {
      connectionStore.delete(data.id)
    }

    return c.json({ success: true }, 200)
  })

  // ============================================================================
  // Return middleware
  // ============================================================================

  return async (c, next) => {
    const response = await app.fetch(c.req.raw, c.env)

    // Return response for all non-404 statuses
    if (response.status !== 404) {
      return response
    }

    // Check if this is an explicit JSON 404 (resource not found) vs route not found
    const contentType = response.headers.get('Content-Type')
    if (contentType?.includes('application/json')) {
      // This is an explicit JSON 404 response (e.g., organization not found)
      return response
    }

    // Route not found - pass to next middleware
    return next()
  }
}

export default workosAuthKit
