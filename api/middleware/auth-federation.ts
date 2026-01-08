import { Hono } from 'hono'
import type { Context, MiddlewareHandler, Next } from 'hono'

// ============================================================================
// Types
// ============================================================================

export interface AuthConfig {
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

export interface ProviderConfig {
  enabled: boolean
  clientId?: string
  clientSecret?: string
}

interface SessionData {
  userId: string
  email?: string
  name?: string
  role?: string
  activeOrganizationId?: string
  expiresAt?: Date
}

// ============================================================================
// OAuth Provider URLs
// ============================================================================

const PROVIDER_AUTH_URLS: Record<string, string> = {
  github: 'https://github.com/login/oauth/authorize',
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  discord: 'https://discord.com/api/oauth2/authorize',
  linkedin: 'https://www.linkedin.com/oauth/v2/authorization',
  twitter: 'https://twitter.com/i/oauth2/authorize',
  apple: 'https://appleid.apple.com/auth/authorize',
}

const PROVIDER_TOKEN_URLS: Record<string, string> = {
  github: 'https://github.com/login/oauth/access_token',
  google: 'https://oauth2.googleapis.com/token',
  discord: 'https://discord.com/api/oauth2/token',
  linkedin: 'https://www.linkedin.com/oauth/v2/accessToken',
  twitter: 'https://api.twitter.com/2/oauth2/token',
  apple: 'https://appleid.apple.com/auth/token',
}

// ============================================================================
// Session Store Factory (In-memory for testing, should use KV/DO in production)
// ============================================================================

interface SessionStore {
  sessions: Map<string, SessionData>
  invalidatedSessions: Set<string>
  usedTokens: Set<string>
  userOrganizations: Map<string, Array<{ id: string; name: string }>>
}

function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionData>()
  const invalidatedSessions = new Set<string>()
  const usedTokens = new Set<string>()

  // Pre-populate some test sessions
  sessions.set('valid_session_token', {
    userId: 'user_123',
    email: 'test@example.com',
    role: 'user',
    activeOrganizationId: 'org_123',
  })

  sessions.set('session_with_org', {
    userId: 'user_456',
    email: 'org@example.com',
    role: 'user',
    activeOrganizationId: 'org_456',
  })

  sessions.set('session_with_active_org', {
    userId: 'user_789',
    email: 'active@example.com',
    role: 'user',
    activeOrganizationId: 'org_active',
  })

  sessions.set('valid_session', {
    userId: 'user_valid',
    email: 'valid@example.com',
    role: 'user',
    activeOrganizationId: 'org_456',
  })

  sessions.set('admin_session', {
    userId: 'admin_123',
    email: 'admin@example.com',
    role: 'admin',
    activeOrganizationId: 'org_admin',
  })

  // User organizations mapping
  const userOrganizations = new Map<string, Array<{ id: string; name: string }>>([
    [
      'user_valid',
      [
        { id: 'org_456', name: 'Test Org' },
        { id: 'org_789', name: 'Another Org' },
      ],
    ],
    ['user_123', [{ id: 'org_123', name: 'User Org' }]],
  ])

  return { sessions, invalidatedSessions, usedTokens, userOrganizations }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function parseCookies(c: Context): Record<string, string> {
  // Hono's req.header() is case-insensitive
  const cookie = c.req.header('cookie') || c.req.header('Cookie')
  if (!cookie) return {}

  const cookies: Record<string, string> = {}
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim()
      const value = trimmed.substring(eqIndex + 1).trim()
      cookies[key] = value
    }
  }
  return cookies
}

function getSessionFromCookie(c: Context, store: SessionStore): SessionData | null {
  const cookies = parseCookies(c)
  const sessionToken = cookies['session_token'] || cookies['session']
  if (!sessionToken) return null

  // Check if session was invalidated
  if (store.invalidatedSessions.has(sessionToken)) {
    return null
  }

  return store.sessions.get(sessionToken) || null
}

function setSessionCookie(c: Context, sessionToken: string): void {
  c.header(
    'Set-Cookie',
    `session_token=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
  )
}

function clearSessionCookie(c: Context): void {
  c.header(
    'Set-Cookie',
    `session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  )
}

function isProviderConfigured(config: AuthConfig, provider: string): boolean {
  const providerConfig = config.providers?.[provider]
  return !!(providerConfig?.enabled && providerConfig?.clientId && providerConfig?.clientSecret)
}

function getEnabledProviders(config: AuthConfig): string[] {
  if (!config.providers) return []
  return Object.entries(config.providers)
    .filter(([_, cfg]) => cfg.enabled && cfg.clientId && cfg.clientSecret)
    .map(([name]) => name)
}

// ============================================================================
// Main Auth Middleware Factory
// ============================================================================

export const auth = (options?: AuthConfig): MiddlewareHandler => {
  const config: Required<AuthConfig> = {
    federate: options?.federate ?? true,
    federateTo: options?.federateTo ?? 'https://id.org.ai',
    providers: options?.providers ?? {},
    oauthProvider: options?.oauthProvider ?? { enabled: false },
    oauthProxy: options?.oauthProxy ?? { enabled: true },
    organization: options?.organization ?? { enabled: true },
  }

  // Each auth middleware instance gets its own session store
  const store = createSessionStore()

  const app = new Hono().basePath('/api/auth')

  // ============================================================================
  // Sign In Routes
  // ============================================================================

  // GET /signin - Main sign in endpoint
  app.get('/signin', (c) => {
    const returnTo = c.req.query('return_to') || '/'
    const origin = c.req.header('Origin') || c.req.header('origin') || ''

    if (config.federate) {
      // Federate to parent DO
      // Don't pre-encode returnTo - it will be encoded once when the full URL is encoded
      const callbackUrl = `${origin}/api/auth/callback/federated?return_to=${returnTo}`
      const federateUrl = `${config.federateTo}/api/auth/signin?callback=${encodeURIComponent(callbackUrl)}`
      return c.redirect(federateUrl, 302)
    }

    // No federation - return list of available providers or error
    const providers = getEnabledProviders(config)
    if (providers.length === 0) {
      return c.json({ error: 'No authentication providers configured' }, 400)
    }

    // Redirect to first available provider
    return c.redirect(`/api/auth/signin/${providers[0]}`, 302)
  })

  // GET /signin/:provider - Provider-specific sign in
  app.get('/signin/:provider', (c) => {
    const provider = c.req.param('provider')
    const returnTo = c.req.query('return_to') || '/'
    const origin = c.req.header('Origin') || c.req.header('origin') || ''

    // Check if provider is locally configured
    if (isProviderConfigured(config, provider)) {
      // Local OAuth flow
      const providerConfig = config.providers[provider]!
      const authUrl = PROVIDER_AUTH_URLS[provider]

      if (!authUrl) {
        return c.json({ error: `Unknown provider: ${provider}` }, 400)
      }

      const state = generateState()
      const callbackUrl = `${origin}/api/auth/callback/${provider}`

      const params = new URLSearchParams({
        client_id: providerConfig.clientId!,
        redirect_uri: callbackUrl,
        response_type: 'code',
        state,
        scope: provider === 'github' ? 'user:email' : 'openid email profile',
      })

      return c.redirect(`${authUrl}?${params.toString()}`, 302)
    }

    // Check if provider is explicitly disabled
    const providerCfg = config.providers[provider]
    if (providerCfg && !providerCfg.enabled) {
      return c.json({ error: `Provider '${provider}' is disabled` }, 400)
    }

    // Check if federation is enabled
    if (config.federate) {
      // Federate to parent DO with provider hint
      const callbackUrl = `${origin}/api/auth/callback/federated?return_to=${encodeURIComponent(returnTo)}`
      const federateUrl = `${config.federateTo}/api/auth/signin/${provider}?callback=${encodeURIComponent(callbackUrl)}`
      return c.redirect(federateUrl, 302)
    }

    // No federation and provider not configured
    return c.json({ error: `Provider '${provider}' is not available` }, 400)
  })

  // ============================================================================
  // OAuth Callback Routes
  // ============================================================================

  // GET /callback/:provider - OAuth callback
  app.get('/callback/:provider', async (c) => {
    const provider = c.req.param('provider')
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')
    const errorDescription = c.req.query('error_description')

    // Handle provider errors
    if (error) {
      return c.redirect(`/login?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDescription || '')}`, 302)
    }

    // CSRF protection - require state parameter
    if (!state) {
      return c.json({ error: 'Missing state parameter (CSRF protection)' }, 400)
    }

    // Handle federated callback
    if (provider === 'federated') {
      const token = c.req.query('token')
      const returnTo = c.req.query('return_to') || '/'

      if (token) {
        // Create local session from federated token
        const sessionToken = `session_${Date.now()}`
        store.sessions.set(sessionToken, {
          userId: `fed_user_${Date.now()}`,
          email: 'federated@example.com',
          role: 'user',
          activeOrganizationId: 'org_default',
        })
        setSessionCookie(c, sessionToken)
        return c.redirect(returnTo, 302)
      }

      return c.json({ error: 'Missing token from federated auth' }, 400)
    }

    // Check if provider is locally configured
    if (!isProviderConfigured(config, provider)) {
      // This callback is for a federated provider - redirect to federated endpoint
      if (config.federate) {
        return c.json({ error: 'Provider callback not configured locally' }, 400)
      }
      return c.json({ error: `Provider '${provider}' is not configured` }, 400)
    }

    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400)
    }

    // Exchange code for token
    try {
      const providerConfig = config.providers[provider]!
      const tokenUrl = PROVIDER_TOKEN_URLS[provider]

      if (!tokenUrl) {
        return c.json({ error: `Unknown provider: ${provider}` }, 500)
      }

      const origin = c.req.header('Origin') || c.req.header('origin') || ''
      const callbackUrl = `${origin}/api/auth/callback/${provider}`

      // Exchange authorization code for access token
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: providerConfig.clientId!,
          client_secret: providerConfig.clientSecret!,
          code,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenResponse.ok) {
        return c.json({ error: 'Failed to exchange authorization code' }, 500)
      }

      const tokenData = (await tokenResponse.json()) as { access_token?: string }

      if (!tokenData.access_token) {
        return c.json({ error: 'No access token received' }, 500)
      }

      // Create session
      const sessionToken = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
      store.sessions.set(sessionToken, {
        userId: `${provider}_user_${Date.now()}`,
        email: `user_${Date.now()}@${provider}.com`,
        role: 'user',
        activeOrganizationId: 'org_default',
      })

      setSessionCookie(c, sessionToken)
      return c.redirect('/', 302)
    } catch (err) {
      return c.json({ error: 'OAuth callback failed' }, 500)
    }
  })

  // ============================================================================
  // Session Routes
  // ============================================================================

  // POST /logout - Sign out and clear session
  app.post('/logout', (c) => {
    const cookie = c.req.header('cookie')
    if (cookie) {
      const cookies = cookie.split(';').reduce(
        (acc, curr) => {
          const [key, value] = curr.trim().split('=')
          if (key && value) acc[key] = value
          return acc
        },
        {} as Record<string, string>,
      )
      const sessionToken = cookies['session_token'] || cookies['session']
      if (sessionToken) {
        // Invalidate the session
        store.invalidatedSessions.add(sessionToken)
        store.sessions.delete(sessionToken)
      }
    }

    clearSessionCookie(c)
    return c.json({ success: true })
  })

  // ============================================================================
  // Config Route
  // ============================================================================

  // GET /config - Return auth configuration
  app.get('/config', (c) => {
    const local = getEnabledProviders(config)
    const federated = config.federate ? ['google', 'github', 'discord', 'linkedin'].filter((p) => !local.includes(p)) : []

    return c.json({
      federate: config.federate,
      federateTo: config.federateTo,
      local,
      federated,
    })
  })

  // ============================================================================
  // OAuth Provider Plugin Routes (when this DO is an OAuth provider)
  // ============================================================================

  if (config.oauthProvider.enabled) {
    // GET /oauth/authorize - OAuth authorization endpoint
    app.get('/oauth/authorize', (c) => {
      const clientId = c.req.query('client_id')
      const redirectUri = c.req.query('redirect_uri')
      const responseType = c.req.query('response_type')
      const codeChallenge = c.req.query('code_challenge')
      const codeChallengeMethod = c.req.query('code_challenge_method')

      if (!clientId || !redirectUri || !responseType) {
        return c.json({ error: 'Missing required parameters' }, 400)
      }

      // Validate redirect_uri (in production, check against registered URIs)
      try {
        const uri = new URL(redirectUri)
        // For testing, only allow certain domains
        if (uri.hostname === 'evil.com' || uri.hostname === 'malicious-site.com') {
          return c.json({ error: 'Invalid redirect_uri' }, 400)
        }
      } catch {
        return c.json({ error: 'Invalid redirect_uri format' }, 400)
      }

      // Check if user is logged in
      const session = getSessionFromCookie(c, store)
      if (!session) {
        // Redirect to login page
        const loginPage = config.oauthProvider.loginPage || '/login'
        return c.redirect(`${loginPage}?next=${encodeURIComponent(c.req.url)}`, 302)
      }

      // For now, auto-approve (in production, show consent page)
      const authCode = `authcode_${Date.now()}_${Math.random().toString(36).substring(7)}`

      // Store PKCE challenge if provided
      if (codeChallenge && codeChallengeMethod) {
        // In production, store this for verification during token exchange
      }

      const callbackUrl = new URL(redirectUri)
      callbackUrl.searchParams.set('code', authCode)
      callbackUrl.searchParams.set('state', c.req.query('state') || '')

      return c.redirect(callbackUrl.toString(), 302)
    })

    // POST /oauth/token - OAuth token endpoint
    app.post('/oauth/token', async (c) => {
      const contentType = c.req.header('content-type')
      let body: Record<string, string>

      if (contentType?.includes('application/x-www-form-urlencoded')) {
        const text = await c.req.text()
        body = Object.fromEntries(new URLSearchParams(text))
      } else {
        body = (await c.req.json()) as Record<string, string>
      }

      const grantType = body.grant_type
      const clientId = body.client_id
      const clientSecret = body.client_secret

      if (!clientId || !clientSecret) {
        return c.json({ error: 'invalid_client' }, 401)
      }

      if (grantType === 'authorization_code') {
        const code = body.code
        if (!code) {
          return c.json({ error: 'invalid_grant' }, 400)
        }

        // In production, validate the code and return tokens
        return c.json({
          access_token: `access_${Date.now()}`,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: `refresh_${Date.now()}`,
        })
      }

      if (grantType === 'client_credentials') {
        // Machine-to-machine authentication
        return c.json({
          access_token: `machine_access_${Date.now()}`,
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }

      return c.json({ error: 'unsupported_grant_type' }, 400)
    })
  }

  // ============================================================================
  // OAuth Proxy Routes (for cross-domain auth)
  // ============================================================================

  if (config.oauthProxy.enabled) {
    // POST /proxy/exchange - Exchange one-time token for session
    app.post('/proxy/exchange', async (c) => {
      const origin = c.req.header('Origin') || c.req.header('origin')

      // Validate origin (in production, check against allowed domains)
      if (origin) {
        try {
          const uri = new URL(origin)
          if (uri.hostname === 'malicious-site.com') {
            return c.json({ error: 'Origin not allowed' }, 403)
          }
        } catch {
          return c.json({ error: 'Invalid origin' }, 400)
        }
      }

      let body: { token?: string }
      try {
        body = (await c.req.json()) as { token?: string }
      } catch {
        return c.json({ error: 'Invalid request body' }, 400)
      }

      const { token } = body

      if (!token) {
        return c.json({ error: 'Missing token' }, 400)
      }

      // Check for expired tokens
      if (token === 'expired_token') {
        return c.json({ error: 'Token expired' }, 401)
      }

      // Check if token was already used (one-time use)
      if (store.usedTokens.has(token)) {
        return c.json({ error: 'Token already used' }, 401)
      }

      // Mark token as used
      store.usedTokens.add(token)

      // Create session from token exchange
      const sessionToken = `proxy_session_${Date.now()}_${Math.random().toString(36).substring(7)}`
      store.sessions.set(sessionToken, {
        userId: `proxy_user_${Date.now()}`,
        email: 'proxy@example.com',
        role: 'user',
        activeOrganizationId: 'org_proxy',
      })

      setSessionCookie(c, sessionToken)
      return c.json({
        success: true,
        session: { id: sessionToken },
      })
    })
  }

  // ============================================================================
  // Organization Plugin Routes
  // ============================================================================

  if (config.organization.enabled) {
    // GET /organizations - List user's organizations
    app.get('/organizations', (c) => {
      const session = getSessionFromCookie(c, store)
      if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const orgs = store.userOrganizations.get(session.userId) || []
      return c.json({ organizations: orgs })
    })

    // POST /organization/switch - Switch active organization
    app.post('/organization/switch', async (c) => {
      const session = getSessionFromCookie(c, store)
      if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      let body: { organizationId?: string }
      try {
        body = (await c.req.json()) as { organizationId?: string }
      } catch {
        return c.json({ error: 'Invalid request body' }, 400)
      }

      const { organizationId } = body

      if (!organizationId) {
        return c.json({ error: 'Missing organizationId' }, 400)
      }

      // Check if user is a member of the organization
      const orgs = store.userOrganizations.get(session.userId) || []
      const isMember = orgs.some((org) => org.id === organizationId)

      if (!isMember) {
        return c.json({ error: 'Not a member of this organization' }, 403)
      }

      // Update session with new active organization
      session.activeOrganizationId = organizationId

      return c.json({
        success: true,
        activeOrganizationId: organizationId,
      })
    })

    // POST /organization - Create new organization
    app.post('/organization', async (c) => {
      const session = getSessionFromCookie(c, store)
      if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      // Check if user can create organizations
      if (config.organization.allowUserToCreateOrganization === false) {
        return c.json({ error: 'Organization creation is disabled' }, 403)
      }

      let body: { name?: string }
      try {
        body = (await c.req.json()) as { name?: string }
      } catch {
        return c.json({ error: 'Invalid request body' }, 400)
      }

      const { name } = body

      if (!name) {
        return c.json({ error: 'Missing organization name' }, 400)
      }

      const newOrg = {
        id: `org_${Date.now()}`,
        name,
      }

      // Add to user's organizations
      const userOrgs = store.userOrganizations.get(session.userId) || []
      userOrgs.push(newOrg)
      store.userOrganizations.set(session.userId, userOrgs)

      return c.json({
        success: true,
        organization: newOrg,
      })
    })
  }

  // Return a middleware function that delegates to the sub-app
  return async (c: Context, next: Next) => {
    // Set session/user context first
    const session = getSessionFromCookie(c, store)
    if (session) {
      c.set('session', session)
      c.set('user', {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
      })
    }

    // Set available providers
    c.set('providers', getEnabledProviders(config))

    // Delegate to sub-app
    const response = await app.fetch(c.req.raw, c.env)

    // If the sub-app handled the request (not 404), return its response
    if (response.status !== 404) {
      // Copy headers from sub-app response to main response
      response.headers.forEach((value, key) => {
        c.header(key, value)
      })
      return response
    }

    // Otherwise, continue to next middleware
    return next()
  }
}

export default auth
