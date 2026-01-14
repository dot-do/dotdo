/**
 * Auth Routes - better-auth integration for API
 *
 * Wires up the auth/handler.ts to Hono for handling:
 * - /auth/callback - OAuth token exchange from central auth domain
 * - /auth/login - Redirect to auth domain for OAuth
 * - /auth/logout - Clear session and redirect
 * - /auth/session - Get current session info (API)
 *
 * @see auth/handler.ts for route implementations
 * @see auth/config.ts for better-auth configuration
 */

import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { handleAuthRequest } from '../../auth'
import type { AuthEnv } from '../../auth'
import * as schema from '../../db'
import type { Env } from '../types'

/**
 * Extended environment with auth-specific bindings
 */
interface AuthRouteEnv extends Env {
  /** D1 database for sessions/users */
  DB: D1Database
  /** Central auth domain (e.g., auth.headless.ly) */
  AUTH_DOMAIN?: string
  /** Allowed domain patterns for CORS */
  ALLOWED_DOMAIN_PATTERNS?: string
  /** Google OAuth credentials */
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** GitHub OAuth credentials */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Stripe credentials for billing integration */
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
}

// Create auth router
export const authRoutes = new Hono<{ Bindings: AuthRouteEnv }>()

/**
 * Catch-all handler for /auth/* routes
 *
 * Delegates to handleAuthRequest which routes based on pathname:
 * - /auth/callback - Token exchange
 * - /auth/login - Redirect to auth domain
 * - /auth/logout - Clear session
 * - /auth/session - Get session info
 */
authRoutes.all('/*', async (c) => {
  const env = c.env

  // Validate required DB binding
  if (!env.DB) {
    return c.json(
      {
        error: {
          status: 500,
          message: 'Database not configured',
        },
      },
      500
    )
  }

  // Create Drizzle instance
  const db = drizzle(env.DB, { schema })

  // Build AuthEnv from worker bindings
  const authEnv: AuthEnv = {
    DB: env.DB,
    AUTH_DOMAIN: env.AUTH_DOMAIN || 'auth.dotdo.dev',
    ALLOWED_DOMAIN_PATTERNS: env.ALLOWED_DOMAIN_PATTERNS || '*.dotdo.dev,*.do',
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '',
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID || '',
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET || '',
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
  }

  // Delegate to auth handler
  return handleAuthRequest(c.req.raw, authEnv, db)
})

export default authRoutes
