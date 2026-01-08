/**
 * Auth Handler for Multi-Domain OAuth
 *
 * This handler runs on BOTH:
 *   1. The central auth domain (auth.headless.ly)
 *   2. Each tenant domain (crm.acme.com, acme.crm.headless.ly)
 *
 * The handler detects which domain it's on and routes accordingly.
 */

import { createAuth, handleTenantAuthCallback, exchangeCrossDomainToken } from './config'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db'

// ============================================================================
// ENVIRONMENT
// ============================================================================

export interface AuthEnv {
  DB: D1Database
  AUTH_DOMAIN: string // 'auth.headless.ly'
  ALLOWED_DOMAIN_PATTERNS: string // '*.headless.ly,*.do'
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string

  // DO bindings for tenant resolution
  TENANT?: DurableObjectNamespace
}

// ============================================================================
// HANDLER
// ============================================================================

export async function handleAuthRequest(request: Request, env: AuthEnv, db: DrizzleD1Database<typeof schema>): Promise<Response> {
  const url = new URL(request.url)
  const currentDomain = url.host
  const isAuthDomain = currentDomain === env.AUTH_DOMAIN

  // =========================================================================
  // AUTH DOMAIN ROUTES
  // =========================================================================

  if (isAuthDomain) {
    // Create auth instance for central domain
    const auth = createAuth({
      db,
      authDomain: env.AUTH_DOMAIN,
      allowedDomainPatterns: env.ALLOWED_DOMAIN_PATTERNS.split(','),
      resolveTenantNs: async (domain) => {
        // Look up custom domain in customDomains table
        const customDomain = await db.query.customDomains.findFirst({
          where: (t, { eq, and }) => and(eq(t.domain, domain), eq(t.verified, true)),
        })
        return customDomain?.tenantNs || null
      },
    })

    // Let better-auth handle the request
    return auth.handler(request)
  }

  // =========================================================================
  // TENANT DOMAIN ROUTES
  // =========================================================================

  // Handle auth callback (token exchange)
  if (url.pathname === '/auth/callback') {
    return handleTenantAuthCallback(request, db)
  }

  // Handle login redirect (send to auth domain)
  if (url.pathname === '/auth/login') {
    const provider = url.searchParams.get('provider') || 'google'
    const returnTo = url.searchParams.get('return_to') || '/'

    // Build auth domain URL with return info
    const authUrl = new URL(`https://${env.AUTH_DOMAIN}/api/auth/signin/${provider}`)
    authUrl.searchParams.set('callbackURL', `https://${currentDomain}/auth/callback?return_to=${encodeURIComponent(returnTo)}`)

    return Response.redirect(authUrl.toString(), 302)
  }

  // Handle logout
  if (url.pathname === '/auth/logout') {
    const headers = new Headers()
    // Clear session cookie
    headers.set('Set-Cookie', 'session_token=; Path=/; HttpOnly; Secure; Max-Age=0')
    headers.set('Location', '/')
    return new Response(null, { status: 302, headers })
  }

  // Handle session check (API)
  if (url.pathname === '/auth/session') {
    const session = await getSessionFromRequest(request, db)
    if (!session) {
      return Response.json({ authenticated: false }, { status: 401 })
    }

    // Get user info
    const user = await db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, session.userId),
    })

    return Response.json({
      authenticated: true,
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          }
        : null,
      session: {
        id: session.id,
        activeOrganizationId: session.activeOrganizationId,
      },
    })
  }

  // Not an auth route
  return new Response('Not Found', { status: 404 })
}

// ============================================================================
// SESSION HELPERS
// ============================================================================

/**
 * Get session from request cookies.
 */
export async function getSessionFromRequest(request: Request, db: DrizzleD1Database<typeof schema>) {
  const cookies = parseCookies(request.headers.get('Cookie') || '')
  const token = cookies['session_token']

  if (!token) return null

  const session = await db.query.sessions.findFirst({
    where: (t, { eq, and, gt }) => and(eq(t.token, token), gt(t.expiresAt, new Date())),
  })

  return session
}

/**
 * Middleware to require authentication.
 */
export async function requireAuth(
  request: Request,
  db: DrizzleD1Database<typeof schema>,
): Promise<{ session: typeof schema.sessions.$inferSelect; user: typeof schema.users.$inferSelect } | Response> {
  const session = await getSessionFromRequest(request, db)

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await db.query.users.findFirst({
    where: (t, { eq }) => eq(t.id, session.userId),
  })

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 401 })
  }

  return { session, user }
}

/**
 * Middleware to require organization membership.
 */
export async function requireOrgMembership(
  request: Request,
  db: DrizzleD1Database<typeof schema>,
  organizationId: string,
): Promise<{ session: typeof schema.sessions.$inferSelect; user: typeof schema.users.$inferSelect; member: typeof schema.members.$inferSelect } | Response> {
  const authResult = await requireAuth(request, db)
  if (authResult instanceof Response) return authResult

  const { session, user } = authResult

  const member = await db.query.members.findFirst({
    where: (t, { eq, and }) => and(eq(t.userId, user.id), eq(t.organizationId, organizationId)),
  })

  if (!member) {
    return Response.json({ error: 'Not a member of this organization' }, { status: 403 })
  }

  return { session, user, member }
}

// ============================================================================
// UTILITIES
// ============================================================================

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key && value) {
      cookies[key] = decodeURIComponent(value)
    }
  }
  return cookies
}
