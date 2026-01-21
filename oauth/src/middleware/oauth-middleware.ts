/**
 * @dotdo/oauth Session Validation Middleware
 *
 * Hono middleware for validating OAuth sessions from cookies or Authorization headers.
 * Supports both session store lookups and JWT verification.
 *
 * @module @dotdo/oauth/middleware/oauth-middleware
 */

import type { MiddlewareHandler } from 'hono'
import { parseCookies } from '@dotdo/utils/cookies'
import type { SessionStore, SessionData } from '../storage/interface'

/**
 * JWT payload returned from verification
 */
export interface JwtPayload {
  sub: string
  email?: string
  [key: string]: unknown
}

/**
 * Options for the OAuth middleware
 */
export interface OAuthMiddlewareOptions {
  /** Session store for looking up sessions */
  sessionStore: SessionStore
  /** Cookie name for session ID (default: 'session') */
  cookieName?: string
  /** Paths to exclude from authentication (e.g., '/public', '/health') */
  excludePaths?: string[]
  /** Optional JWT verification function for token-based auth */
  verifyToken?: (token: string) => Promise<JwtPayload | null>
}

/**
 * Extract session ID from request (cookie or Authorization header)
 */
function extractSessionId(request: Request, cookieName: string): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1]
    }
  }

  // Try cookie
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader)
    const sessionId = cookies[cookieName]
    if (sessionId) {
      return sessionId
    }
  }

  return null
}


/**
 * OAuth session validation middleware
 *
 * Validates session from cookie or Authorization header and sets
 * session data in the Hono context.
 *
 * @example
 * ```typescript
 * const app = new Hono()
 *
 * app.use('*', oauthMiddleware({
 *   sessionStore: new MemorySessionStore(),
 *   excludePaths: ['/public', '/health'],
 * }))
 *
 * app.get('/protected', (c) => {
 *   const session = c.get('session')
 *   return c.json({ userId: session.userId })
 * })
 * ```
 */
export function oauthMiddleware(options: OAuthMiddlewareOptions): MiddlewareHandler {
  const { sessionStore, cookieName = 'session', excludePaths = [], verifyToken } = options

  return async (c, next) => {
    // Check if path is excluded
    const path = c.req.path
    if (excludePaths.some((excluded) => path.startsWith(excluded))) {
      return next()
    }

    // Extract session ID or token
    const sessionIdOrToken = extractSessionId(c.req.raw, cookieName)

    if (!sessionIdOrToken) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // If JWT verification function is provided, try that first
    if (verifyToken) {
      const payload = await verifyToken(sessionIdOrToken)
      if (payload) {
        c.set('user', payload)
        return next()
      }
    }

    // Look up session in store
    const session = await sessionStore.get(sessionIdOrToken)

    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Set session in context
    c.set('session', session)

    return next()
  }
}
