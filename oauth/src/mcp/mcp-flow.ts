/**
 * MCP OAuth Flow Helpers
 *
 * MCP-specific OAuth 2.1 flow helpers with support for:
 * - Resource Indicators (RFC 8707)
 * - MCP-specific scopes
 * - Token exchange grant type
 *
 * @module @dotdo/oauth/mcp/mcp-flow
 */

import type { Handler } from 'hono'
import type { PKCEPair, TokenResponse } from '../core/types'
import type { SessionStore, SessionData } from '../storage/interface'
import { generatePKCE } from '../core/pkce'
import { createStateWithMetadata, validateState, parseStateMetadata } from '../core/state'

/**
 * Extended OAuth provider interface for MCP with additional params support.
 */
export interface MCPOAuthProvider {
  /** Provider name */
  name: string
  /** Generate authorization URL with optional additional params */
  getAuthorizationUrl(
    state: string,
    codeChallenge: string,
    params?: Record<string, string>
  ): string
  /** Exchange code for tokens with optional additional params */
  exchangeCode(
    code: string,
    codeVerifier: string,
    params?: Record<string, string>
  ): Promise<TokenResponse>
  /** Get user info */
  getUser(accessToken: string): Promise<{ id: string; email?: string; name?: string }>
  /** Refresh token with optional params */
  refreshToken?(refreshToken: string, params?: Record<string, string>): Promise<TokenResponse>
  /** Token exchange grant (RFC 8693) */
  tokenExchange?(
    subjectToken: string,
    subjectTokenType: string,
    params?: Record<string, string>
  ): Promise<TokenResponse>
}

/**
 * Options for the MCP authorize handler.
 */
export interface MCPAuthorizeHandlerOptions {
  /** OAuth provider */
  provider: MCPOAuthProvider
  /** Resource indicator URL (RFC 8707) */
  resourceIndicator?: string
  /** Scopes to request */
  scopes?: string[]
  /** Function to store PKCE pair */
  storePKCE: (pkce: PKCEPair, c: unknown) => Promise<void>
  /** Function to store state */
  storeState: (state: string, c: unknown) => Promise<void>
  /** Default redirect URI */
  defaultRedirectUri?: string
}

/**
 * Options for the MCP callback handler.
 */
export interface MCPCallbackHandlerOptions {
  /** OAuth provider */
  provider: MCPOAuthProvider
  /** Session store */
  sessionStore: SessionStore
  /** Resource indicator URL (RFC 8707) */
  resourceIndicator?: string
  /** Function to retrieve stored PKCE */
  getStoredPKCE: (c: unknown) => Promise<PKCEPair>
  /** Function to retrieve stored state */
  getStoredState: (c: unknown) => Promise<string>
  /** Default redirect URI */
  defaultRedirect?: string
  /** Cookie name */
  cookieName?: string
  /** Cookie options */
  cookieOptions?: {
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    path?: string
    domain?: string
    maxAge?: number
  }
}

/**
 * Options for the MCP token endpoint handler.
 */
export interface MCPTokenEndpointOptions {
  /** OAuth provider */
  provider: MCPOAuthProvider
  /** Session store */
  sessionStore: SessionStore
  /** Resource indicator URL (RFC 8707) */
  resourceIndicator?: string
  /** Cookie name (default: 'session') */
  cookieName?: string
  /** Enable token exchange grant type */
  supportTokenExchange?: boolean
}

/**
 * Result of MCP scope validation.
 */
export interface MCPScopeValidationResult {
  /** Whether all required scopes are present */
  valid: boolean
  /** Scopes that were granted */
  grantedScopes: string[]
  /** Scopes that were requested but not granted */
  missingScopes?: string[]
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Create a cookie string from options.
 */
function createCookieString(
  name: string,
  value: string,
  options: MCPCallbackHandlerOptions['cookieOptions'] = {}
): string {
  const parts = [`${name}=${value}`]

  if (options.secure) {
    parts.push('Secure')
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`)
  }

  if (options.path) {
    parts.push(`Path=${options.path}`)
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`)
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`)
  }

  parts.push('HttpOnly')

  return parts.join('; ')
}

/**
 * Extract session ID from request.
 */
function extractSessionId(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    for (const cookie of cookieHeader.split(';')) {
      const [name, ...rest] = cookie.split('=')
      if (name?.trim() === cookieName && rest.length > 0) {
        return rest.join('=').trim()
      }
    }
  }

  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1]
    }
  }

  return null
}

/**
 * Creates an MCP-specific authorize handler with resource indicator support.
 *
 * @param options - Configuration options
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createMCPAuthorizeHandler({
 *   provider: mcpProvider,
 *   resourceIndicator: 'https://apis.do',
 *   scopes: ['mcp:tools', 'mcp:resources', 'read'],
 *   storePKCE: async (pkce) => { ... },
 *   storeState: async (state) => { ... },
 * })
 * ```
 */
export function createMCPAuthorizeHandler(options: MCPAuthorizeHandlerOptions): Handler {
  const {
    provider,
    resourceIndicator,
    scopes = [],
    storePKCE,
    storeState,
    defaultRedirectUri = '/',
  } = options

  return async (c) => {
    const url = new URL(c.req.url)
    const redirectUri = url.searchParams.get('redirect_uri') || defaultRedirectUri

    // Generate PKCE pair
    const pkce = await generatePKCE()

    // Create state with metadata
    const state = await createStateWithMetadata({
      redirectUri,
      provider: provider.name,
    })

    // Store PKCE and state
    await storePKCE(pkce, c)
    await storeState(state, c)

    // Build additional params for MCP
    const params: Record<string, string> = {}

    // Add resource indicator (RFC 8707)
    if (resourceIndicator) {
      params['resource'] = resourceIndicator
    }

    // Add scopes
    if (scopes.length > 0) {
      params['scope'] = scopes.join(' ')
    }

    // Generate authorization URL with MCP params
    const authUrl = provider.getAuthorizationUrl(state, pkce.challenge, params)

    return c.redirect(authUrl, 302)
  }
}

/**
 * Creates an MCP-specific callback handler with resource indicator support.
 *
 * @param options - Configuration options
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createMCPCallbackHandler({
 *   provider: mcpProvider,
 *   sessionStore: store,
 *   resourceIndicator: 'https://apis.do',
 *   getStoredPKCE: async () => { ... },
 *   getStoredState: async () => { ... },
 * })
 * ```
 */
export function createMCPCallbackHandler(options: MCPCallbackHandlerOptions): Handler {
  const {
    provider,
    sessionStore,
    resourceIndicator,
    getStoredPKCE,
    getStoredState,
    defaultRedirect = '/',
    cookieName = 'session',
    cookieOptions = {},
  } = options

  return async (c) => {
    const url = new URL(c.req.url)
    const code = url.searchParams.get('code')
    const receivedState = url.searchParams.get('state')

    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400)
    }

    if (!receivedState) {
      return c.json({ error: 'Missing state parameter' }, 400)
    }

    // Validate state
    const storedState = await getStoredState(c)

    if (!validateState(receivedState, storedState)) {
      return c.json({ error: 'Invalid state parameter' }, 400)
    }

    // Get PKCE pair
    const pkce = await getStoredPKCE(c)

    // Build exchange params with resource indicator
    const params: Record<string, string> = {}
    if (resourceIndicator) {
      params['resource'] = resourceIndicator
    }

    // Exchange code for tokens
    let tokens
    try {
      tokens = await provider.exchangeCode(code, pkce.verifier, params)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: `Failed to exchange code: ${message}` }, 400)
    }

    // Get user info
    let userInfo
    try {
      userInfo = await provider.getUser(tokens.access_token)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: `Failed to get user info: ${message}` }, 400)
    }

    // Create session data
    const sessionData: SessionData = {
      userId: userInfo.id,
      accessToken: tokens.access_token,
      provider: provider.name,
      metadata: {
        email: userInfo.email,
        name: userInfo.name,
      },
    }

    if (tokens.refresh_token) {
      sessionData.refreshToken = tokens.refresh_token
    }
    if (tokens.expires_in) {
      sessionData.expiresAt = Date.now() + tokens.expires_in * 1000
    }
    if (tokens.scope) {
      sessionData.metadata = {
        ...sessionData.metadata,
        scope: tokens.scope,
      }
    }

    // Generate session ID and store
    const sessionId = generateSessionId()
    await sessionStore.set(sessionId, sessionData)

    // Get redirect URI from state
    const stateMetadata = parseStateMetadata(storedState)
    const redirectToUri = (stateMetadata?.['redirectUri'] as string) || defaultRedirect

    // Set cookie and redirect
    const cookie = createCookieString(cookieName, sessionId, {
      path: '/',
      ...cookieOptions,
    })

    c.header('Set-Cookie', cookie)
    return c.redirect(redirectToUri, 302)
  }
}

/**
 * Validates that required MCP scopes are present in the token response.
 *
 * @param tokenResponse - The token response from the OAuth server
 * @param requiredScopes - Array of scopes that must be present
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateMCPScopes(tokenResponse, ['mcp:tools', 'read'])
 * if (!result.valid) {
 *   console.log('Missing scopes:', result.missingScopes)
 * }
 * ```
 */
export function validateMCPScopes(
  tokenResponse: TokenResponse,
  requiredScopes: string[]
): MCPScopeValidationResult {
  const grantedScopes = tokenResponse.scope?.split(' ') || []

  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope))

  const result: MCPScopeValidationResult = {
    valid: missingScopes.length === 0,
    grantedScopes,
  }

  if (missingScopes.length > 0) {
    result.missingScopes = missingScopes
  }

  return result
}

/**
 * Creates an MCP-specific token endpoint with resource indicator and token exchange support.
 *
 * @param options - Configuration options
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createMCPTokenEndpoint({
 *   provider: mcpProvider,
 *   sessionStore: store,
 *   resourceIndicator: 'https://apis.do',
 *   supportTokenExchange: true,
 * })
 * ```
 */
export function createMCPTokenEndpoint(options: MCPTokenEndpointOptions): Handler {
  const {
    provider,
    sessionStore,
    resourceIndicator,
    cookieName = 'session',
    supportTokenExchange = false,
  } = options

  return async (c) => {
    // Extract session ID
    const sessionId = extractSessionId(c.req.raw, cookieName)

    if (!sessionId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Look up session
    const session = await sessionStore.get(sessionId)

    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Parse request body
    let body: {
      grant_type: string
      subject_token_type?: string
      resource?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid request body' }, 400)
    }

    // Handle token exchange grant (RFC 8693)
    if (body.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
      if (!supportTokenExchange) {
        return c.json({ error: 'Token exchange not supported' }, 400)
      }

      if (!provider.tokenExchange) {
        return c.json({ error: 'Token exchange not supported by provider' }, 400)
      }

      const params: Record<string, string> = {}
      if (body.resource) {
        params['resource'] = body.resource
      } else if (resourceIndicator) {
        params['resource'] = resourceIndicator
      }

      let tokens
      try {
        tokens = await provider.tokenExchange(
          session.accessToken,
          body.subject_token_type || 'urn:ietf:params:oauth:token-type:access_token',
          params
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return c.json({ error: `Token exchange failed: ${message}` }, 400)
      }

      // Update session with new tokens
      const updatedSession: SessionData = {
        ...session,
        accessToken: tokens.access_token,
      }

      if (tokens.refresh_token) {
        updatedSession.refreshToken = tokens.refresh_token
      }
      if (tokens.expires_in) {
        updatedSession.expiresAt = Date.now() + tokens.expires_in * 1000
      }

      await sessionStore.set(sessionId, updatedSession)

      return c.json({
        success: true,
        expires_in: tokens.expires_in,
      })
    }

    // Handle refresh token grant
    if (body.grant_type === 'refresh_token') {
      if (!session.refreshToken) {
        return c.json({ error: 'No refresh token available' }, 400)
      }

      if (!provider.refreshToken) {
        return c.json({ error: 'Token refresh not supported by provider' }, 400)
      }

      const params: Record<string, string> = {}
      if (resourceIndicator) {
        params['resource'] = resourceIndicator
      }

      let tokens
      try {
        tokens = await provider.refreshToken(session.refreshToken, params)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return c.json({ error: `Failed to refresh token: ${message}` }, 400)
      }

      // Update session
      const updatedSession: SessionData = {
        userId: session.userId,
        accessToken: tokens.access_token,
        provider: session.provider,
      }

      if (session.metadata) {
        updatedSession.metadata = session.metadata
      }
      const refreshToken = tokens.refresh_token || session.refreshToken
      if (refreshToken) {
        updatedSession.refreshToken = refreshToken
      }
      if (tokens.expires_in) {
        updatedSession.expiresAt = Date.now() + tokens.expires_in * 1000
      } else if (session.expiresAt) {
        updatedSession.expiresAt = session.expiresAt
      }

      await sessionStore.set(sessionId, updatedSession)

      return c.json({
        success: true,
        expires_in: tokens.expires_in,
      })
    }

    return c.json({ error: 'Unsupported grant_type' }, 400)
  }
}
