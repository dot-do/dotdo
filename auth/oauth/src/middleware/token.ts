/**
 * @dotdo/oauth Token Endpoint Handler
 *
 * Hono handler for token refresh endpoint.
 * Handles refresh token flow to get new access tokens.
 *
 * @module @dotdo/oauth/middleware/token
 */

import type { Handler } from 'hono'
import { parseCookies } from '@dotdo/utils/cookies'
import type { OAuthProvider } from '../providers/interface'
import type { SessionStore, SessionData } from '../storage/interface'

/**
 * Options for the token endpoint handler
 */
export interface TokenEndpointOptions {
  /** OAuth provider for token refresh */
  provider: OAuthProvider
  /** Session store for looking up and updating sessions */
  sessionStore: SessionStore
  /** Cookie name for session ID (default: 'session') */
  cookieName?: string
}

/**
 * Token request body
 */
interface TokenRequestBody {
  grant_type: 'refresh_token'
}

/**
 * Extract session ID from request (cookie or Authorization header)
 */
function extractSessionId(request: Request, cookieName: string): string | null {
  // Try cookie first for token refresh
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader)
    const sessionId = cookies[cookieName]
    if (sessionId) {
      return sessionId
    }
  }

  // Try Authorization header
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
 * Create a token endpoint handler
 *
 * Handles token refresh requests by:
 * 1. Validating the session
 * 2. Using the refresh token to get new tokens
 * 3. Updating the session with new tokens
 *
 * Request body:
 * ```json
 * { "grant_type": "refresh_token" }
 * ```
 *
 * @example
 * ```typescript
 * const tokenHandler = createTokenEndpoint({
 *   provider: googleProvider,
 *   sessionStore: new MemorySessionStore(),
 * })
 *
 * app.post('/auth/token', tokenHandler)
 * ```
 */
export function createTokenEndpoint(options: TokenEndpointOptions): Handler {
  const { provider, sessionStore, cookieName = 'session' } = options

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
    let body: TokenRequestBody
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid request body' }, 400)
    }

    // Validate grant type
    if (body.grant_type !== 'refresh_token') {
      return c.json({ error: 'Unsupported grant_type' }, 400)
    }

    // Check if refresh token exists
    if (!session.refreshToken) {
      return c.json({ error: 'No refresh token available' }, 400)
    }

    // Check if provider supports refresh
    if (!provider.refreshToken) {
      return c.json({ error: 'Token refresh not supported by provider' }, 400)
    }

    // Refresh tokens
    let tokens
    try {
      tokens = await provider.refreshToken(session.refreshToken)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: `Failed to refresh token: ${message}` }, 400)
    }

    // Update session with new tokens
    const updatedSession: SessionData = {
      userId: session.userId,
      accessToken: tokens.access_token,
      provider: session.provider,
    }

    // Only set optional properties if they have values
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

    // Return success response (without exposing tokens)
    return c.json({
      success: true,
      expires_in: tokens.expires_in,
    })
  }
}
