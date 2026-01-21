/**
 * @dotdo/oauth Callback Handler
 *
 * Hono handler for OAuth callback endpoint. Exchanges authorization code
 * for tokens using PKCE verifier and creates a session.
 *
 * @module @dotdo/oauth/middleware/callback
 */

import type { Handler } from 'hono'
import type { OAuthProvider } from '../providers/interface'
import type { SessionStore, SessionData } from '../storage/interface'
import type { PKCEPair } from '../core/types'
import { validateState, parseStateMetadata } from '../core/state'

/**
 * Cookie options for session cookie
 */
export interface CookieOptions {
  /** Secure flag (HTTPS only) */
  secure?: boolean
  /** SameSite attribute */
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** Path for cookie */
  path?: string
  /** Domain for cookie */
  domain?: string
  /** Max age in seconds */
  maxAge?: number
}

/**
 * Options for the callback handler
 */
export interface CallbackHandlerOptions {
  /** OAuth provider to use for code exchange */
  provider: OAuthProvider
  /** Session store for persisting sessions */
  sessionStore: SessionStore
  /** Function to retrieve stored PKCE pair */
  getStoredPKCE: (c: unknown) => Promise<PKCEPair>
  /** Function to retrieve stored state token */
  getStoredState: (c: unknown) => Promise<string>
  /** Default redirect URI after successful auth */
  defaultRedirect?: string
  /** Cookie name for session ID */
  cookieName?: string
  /** Cookie options */
  cookieOptions?: CookieOptions
  /** Validate CSRF token in state */
  validateCsrf?: boolean
  /** Function to create a JWT session token */
  createSessionToken?: (session: SessionData) => Promise<string>
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Create a cookie string from options
 */
function createCookieString(
  name: string,
  value: string,
  options: CookieOptions = {}
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

  // Always HttpOnly for security
  parts.push('HttpOnly')

  return parts.join('; ')
}

/**
 * Create an OAuth callback handler
 *
 * Handles the OAuth callback by:
 * 1. Validating the state parameter
 * 2. Exchanging the authorization code for tokens using PKCE
 * 3. Fetching user information
 * 4. Creating a session
 * 5. Redirecting to the stored redirect URI
 *
 * @example
 * ```typescript
 * const callbackHandler = createCallbackHandler({
 *   provider: googleProvider,
 *   sessionStore: new MemorySessionStore(),
 *   getStoredPKCE: async (c) => getPKCEFromSession(c),
 *   getStoredState: async (c) => getStateFromSession(c),
 * })
 *
 * app.get('/auth/callback', callbackHandler)
 * ```
 */
export function createCallbackHandler(options: CallbackHandlerOptions): Handler {
  const {
    provider,
    sessionStore,
    getStoredPKCE,
    getStoredState,
    defaultRedirect = '/',
    cookieName = 'session',
    cookieOptions = {},
    validateCsrf = false,
    createSessionToken,
  } = options

  return async (c) => {
    // Extract code and state from query params
    const url = new URL(c.req.url)
    const code = url.searchParams.get('code')
    const receivedState = url.searchParams.get('state')

    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400)
    }

    if (!receivedState) {
      return c.json({ error: 'Missing state parameter' }, 400)
    }

    // Get stored state and validate
    const storedState = await getStoredState(c)

    if (!validateState(receivedState, storedState)) {
      return c.json({ error: 'Invalid state parameter' }, 400)
    }

    // Get stored PKCE pair
    const pkce = await getStoredPKCE(c)

    // Exchange code for tokens
    let tokens
    try {
      tokens = await provider.exchangeCode(code, pkce.verifier)
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
        picture: userInfo.picture,
      },
    }

    // Only set optional properties if they have values
    if (tokens.refresh_token) {
      sessionData.refreshToken = tokens.refresh_token
    }
    if (tokens.expires_in) {
      sessionData.expiresAt = Date.now() + tokens.expires_in * 1000
    }

    // Generate session ID and store session
    const sessionId = generateSessionId()
    await sessionStore.set(sessionId, sessionData)

    // Create JWT token if function provided
    if (createSessionToken) {
      await createSessionToken(sessionData)
    }

    // Parse state metadata to get redirect URI
    const stateMetadata = parseStateMetadata(storedState)
    const redirectUri = (stateMetadata?.['redirectUri'] as string) || defaultRedirect

    // Set session cookie
    const cookie = createCookieString(cookieName, sessionId, {
      path: '/',
      ...cookieOptions,
    })

    // Set cookie header and redirect
    c.header('Set-Cookie', cookie)
    return c.redirect(redirectUri, 302)
  }
}
