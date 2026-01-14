/**
 * Auth Configuration for Multi-Tenant Cross-Domain OAuth
 *
 * Supports:
 *   - Same domain: crm.headless.ly/acme
 *   - Subdomains: acme.crm.headless.ly
 *   - Custom domains: crm.acme.com
 *
 * All OAuth callbacks route through the central auth domain,
 * then redirect to the tenant domain with a one-time token.
 *
 * ## Storage Backend
 *
 * The auth system uses **GraphAuthAdapter** as the primary storage backend.
 * Auth entities (User, Session, Account) are stored as Things in the graph model.
 *
 * @see auth/adapters/graph.ts - GraphAuthAdapter implementation
 * @see db/auth.ts - DEPRECATED Drizzle schema (kept for migration only)
 *
 * To migrate from Drizzle to Graph:
 * @see auth/migration.ts - Migration utilities
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, admin, apiKey } from 'better-auth/plugins'
// Note: sso and oauthProvider are not available in better-auth@1.4.10
// import { sso, oauthProvider } from 'better-auth/plugins'
import { stripe } from '@better-auth/stripe'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../db'
import { validateAuthEnv, isAuthEnvValidated } from './env-validation'
import { safeJsonParse } from '../lib/safe-stringify'
// Graph adapter for DO-based auth storage - PRIMARY storage backend
import { graphAuthAdapter } from './adapters/graph'
import type { GraphStore } from '../db/graph/types'

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AuthConfig {
  db: DrizzleD1Database<typeof schema>
  stripeClient?: unknown
  stripeWebhookSecret?: string

  /**
   * The central auth domain where OAuth callbacks are registered.
   * e.g., 'auth.headless.ly' or 'crm.headless.ly'
   */
  authDomain: string

  /**
   * Allowed tenant domain patterns.
   * Used to validate return URLs and prevent open redirects.
   */
  allowedDomainPatterns: string[]

  /**
   * Get the tenant DO namespace for a given domain.
   * Maps custom domains to tenant namespaces.
   */
  resolveTenantNs: (domain: string) => Promise<string | null>
}

/**
 * Configuration for graph-backed auth.
 * Uses GraphStore instead of Drizzle/D1 for storing auth entities.
 */
export interface GraphAuthConfig {
  /**
   * GraphStore instance for storing auth entities as Things.
   * Auth entities (User, Session, Account) are stored as Things in the graph.
   */
  graphStore: GraphStore

  /**
   * Optional Drizzle database for cross-domain tokens and custom domains.
   * If not provided, cross-domain functionality will be limited.
   */
  db?: DrizzleD1Database<typeof schema>

  stripeClient?: unknown
  stripeWebhookSecret?: string

  /**
   * The central auth domain where OAuth callbacks are registered.
   * e.g., 'auth.headless.ly' or 'crm.headless.ly'
   */
  authDomain: string

  /**
   * Allowed tenant domain patterns.
   * Used to validate return URLs and prevent open redirects.
   */
  allowedDomainPatterns: string[]

  /**
   * Get the tenant DO namespace for a given domain.
   * Maps custom domains to tenant namespaces.
   */
  resolveTenantNs: (domain: string) => Promise<string | null>
}

// ============================================================================
// AUTH INSTANCE FACTORY - LEGACY (Drizzle)
// ============================================================================

/**
 * Create a better-auth instance backed by Drizzle/D1.
 *
 * @deprecated Use `createAuthWithGraph()` instead. This function is kept for
 * backward compatibility during the migration period. It will be removed in
 * a future release.
 *
 * Migration guide:
 * 1. Switch to `createAuthWithGraph()` which uses GraphAuthAdapter
 * 2. Run migration to copy existing data from Drizzle to Graph
 * 3. Remove usage of `createAuth()`
 *
 * @see createAuthWithGraph - New preferred method using Graph storage
 * @see auth/migration.ts - Migration utilities
 */
export function createAuth(config: AuthConfig) {
  // Validate OAuth environment variables before using them
  // This provides clear error messages if configuration is missing
  if (!isAuthEnvValidated()) {
    validateAuthEnv()
  }

  const { db, authDomain, allowedDomainPatterns, resolveTenantNs, stripeClient, stripeWebhookSecret } = config

  const baseURL = `https://${authDomain}`

  return betterAuth({
    baseURL,

    // Use drizzleAdapter for D1/SQLite or graphAuthAdapter for GraphStore
    // To use GraphStore instead:
    //   database: graphAuthAdapter(graphStore),
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
    }),

    // =========================================================================
    // SOCIAL PROVIDERS
    // =========================================================================
    // All callbacks go to the central auth domain

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectURI: `${baseURL}/api/auth/callback/google`,
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        redirectURI: `${baseURL}/api/auth/callback/github`,
      },
    },

    // =========================================================================
    // SESSION CONFIGURATION
    // =========================================================================

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours

      // Generate cross-domain session tokens
      // These can be exchanged for session cookies on tenant domains
      generateSessionToken: () => {
        return crypto.randomUUID() + '-' + Date.now().toString(36)
      },
    },

    // =========================================================================
    // ADVANCED: Cross-Domain Session Handling
    // =========================================================================

    advanced: {
      // Allow cross-origin requests from tenant domains
      crossSubDomainCookies: {
        enabled: true,
        domain: extractRootDomain(authDomain),
      },

      // Custom redirect handling for cross-domain OAuth
      generateState: async ({ callbackURL }: { callbackURL: string }) => {
        // Store the return URL in state for cross-domain redirect
        const state = {
          id: crypto.randomUUID(),
          returnTo: callbackURL,
          timestamp: Date.now(),
        }
        return Buffer.from(JSON.stringify(state)).toString('base64url')
      },
    },

    // =========================================================================
    // PLUGINS
    // =========================================================================

    plugins: [
      // Organization (multi-tenancy)
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        creatorRole: 'owner',
        membershipLimit: 100,

        // Auto-provision tenant DO when org is created
        async onOrganizationCreate({ organization }: { organization: { id: string; name: string } }) {
          // This hook would create the tenant DO
          // Implementation depends on your DO creation logic
        },
      }),

      // Admin
      admin({
        defaultRole: 'user',
        adminRoles: ['admin', 'owner'],
      }),

      // API Keys
      apiKey({
        defaultPrefix: 'sk_',
        rateLimit: {
          enabled: true,
          timeWindow: 1000 * 60 * 60, // 1 hour
          maxRequests: 1000,
        },
      }),

      // SSO (Enterprise SAML/OIDC per org)
      // Note: sso() is not available in better-auth@1.4.10
      // sso(),

      // OAuth Provider (your app as OAuth provider for MCP/AI agents)
      // Note: oauthProvider is not available in better-auth@1.4.10
      // oauthProvider({
      //   loginPage: '/login',
      //   consentPage: '/consent',
      // }),

      // Stripe (if configured)
      ...(stripeClient && stripeWebhookSecret
        ? [
            stripe({
              stripeClient: stripeClient as any,
              stripeWebhookSecret,
              createCustomerOnSignUp: true,
              subscription: {
                enabled: true,
                plans: [
                  { name: 'free', priceId: 'price_free', limits: { seats: 1 } },
                  { name: 'pro', priceId: 'price_pro', limits: { seats: 10 } },
                  { name: 'enterprise', priceId: 'price_enterprise', limits: { seats: -1 } },
                ],
              },
            }),
          ]
        : []),
    ],

    // =========================================================================
    // CALLBACKS
    // =========================================================================

    callbacks: {
      // After OAuth completes, handle cross-domain redirect
      async onOAuthSuccess({ user, session, state }: { user: unknown; session: unknown; state: string }) {
        // Decode state to get return URL (safely parse to prevent crashes from malformed/tampered state)
        const decodedState = Buffer.from(state || '', 'base64url').toString()
        const stateData = safeJsonParse<{ id?: string; returnTo?: string; timestamp?: number }>(
          decodedState,
          null,
          { context: 'onOAuthSuccess.state' }
        )
        const returnTo = stateData?.returnTo

        if (returnTo) {
          // Validate return URL against allowed patterns
          const returnDomain = new URL(returnTo).host
          const isAllowed = await validateDomain(returnDomain, allowedDomainPatterns, resolveTenantNs)

          if (isAllowed) {
            // Generate one-time token for cross-domain session
            const token = await generateCrossDomainToken(db, session.id)

            // Return redirect URL with token
            const redirectUrl = new URL(returnTo)
            redirectUrl.searchParams.set('auth_token', token)
            return { redirect: redirectUrl.toString() }
          }
        }

        // Default: stay on auth domain
        return {}
      },
    },
  })
}

// ============================================================================
// GRAPH-BACKED AUTH INSTANCE FACTORY (PREFERRED)
// ============================================================================

/**
 * Create a better-auth instance backed by GraphStore.
 *
 * **This is the preferred method for creating auth instances.**
 *
 * Uses GraphAuthAdapter to store auth entities (User, Session, Account, etc.)
 * as Things in the graph model. This enables:
 * - Unified storage with other domain entities
 * - Graph relationships between auth and business entities
 * - Query across auth and domain data using graph traversal
 * - Consistency with the rest of the DO architecture
 *
 * Benefits over Drizzle adapter:
 * - Auth entities are Things, just like all other entities in the system
 * - Relationships (Session belongsTo User, Account linkedTo User) are
 *   native graph relationships, enabling graph traversal queries
 * - Single storage model for all data (no separate auth tables)
 * - Better integration with human-in-the-loop workflows
 *
 * @example
 * ```typescript
 * import { createAuthWithGraph } from './auth/config'
 * import { SQLiteGraphStore } from '../db/graph/stores'
 *
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const auth = createAuthWithGraph({
 *   graphStore: store,
 *   authDomain: 'auth.example.com',
 *   allowedDomainPatterns: ['*.example.com'],
 *   resolveTenantNs: async (domain) => 'default',
 * })
 * ```
 */
export function createAuthWithGraph(config: GraphAuthConfig) {
  // Validate OAuth environment variables before using them
  // This provides clear error messages if configuration is missing
  if (!isAuthEnvValidated()) {
    validateAuthEnv()
  }

  const { graphStore, db, authDomain, allowedDomainPatterns, resolveTenantNs, stripeClient, stripeWebhookSecret } = config

  const baseURL = `https://${authDomain}`

  return betterAuth({
    baseURL,

    // Use GraphAuthAdapter backed by GraphStore
    database: graphAuthAdapter(graphStore),

    // =========================================================================
    // SOCIAL PROVIDERS
    // =========================================================================
    // All callbacks go to the central auth domain

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectURI: `${baseURL}/api/auth/callback/google`,
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        redirectURI: `${baseURL}/api/auth/callback/github`,
      },
    },

    // =========================================================================
    // SESSION CONFIGURATION
    // =========================================================================

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours

      // Generate cross-domain session tokens
      // These can be exchanged for session cookies on tenant domains
      generateSessionToken: () => {
        return crypto.randomUUID() + '-' + Date.now().toString(36)
      },
    },

    // =========================================================================
    // ADVANCED: Cross-Domain Session Handling
    // =========================================================================

    advanced: {
      // Allow cross-origin requests from tenant domains
      crossSubDomainCookies: {
        enabled: true,
        domain: extractRootDomain(authDomain),
      },

      // Custom redirect handling for cross-domain OAuth
      generateState: async ({ callbackURL }: { callbackURL: string }) => {
        // Store the return URL in state for cross-domain redirect
        const state = {
          id: crypto.randomUUID(),
          returnTo: callbackURL,
          timestamp: Date.now(),
        }
        return Buffer.from(JSON.stringify(state)).toString('base64url')
      },
    },

    // =========================================================================
    // PLUGINS
    // =========================================================================

    plugins: [
      // Organization (multi-tenancy)
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        creatorRole: 'owner',
        membershipLimit: 100,

        // Auto-provision tenant DO when org is created
        async onOrganizationCreate({ organization }: { organization: { id: string; name: string } }) {
          // This hook would create the tenant DO
          // Implementation depends on your DO creation logic
        },
      }),

      // Admin
      admin({
        defaultRole: 'user',
        adminRoles: ['admin', 'owner'],
      }),

      // API Keys
      apiKey({
        defaultPrefix: 'sk_',
        rateLimit: {
          enabled: true,
          timeWindow: 1000 * 60 * 60, // 1 hour
          maxRequests: 1000,
        },
      }),

      // Stripe (if configured)
      ...(stripeClient && stripeWebhookSecret
        ? [
            stripe({
              stripeClient: stripeClient as any,
              stripeWebhookSecret,
              createCustomerOnSignUp: true,
              subscription: {
                enabled: true,
                plans: [
                  { name: 'free', priceId: 'price_free', limits: { seats: 1 } },
                  { name: 'pro', priceId: 'price_pro', limits: { seats: 10 } },
                  { name: 'enterprise', priceId: 'price_enterprise', limits: { seats: -1 } },
                ],
              },
            }),
          ]
        : []),
    ],

    // =========================================================================
    // CALLBACKS
    // =========================================================================

    callbacks: {
      // After OAuth completes, handle cross-domain redirect
      async onOAuthSuccess({ user, session, state }: { user: unknown; session: unknown; state: string }) {
        // Decode state to get return URL (safely parse to prevent crashes from malformed/tampered state)
        const decodedState = Buffer.from(state || '', 'base64url').toString()
        const stateData = safeJsonParse<{ id?: string; returnTo?: string; timestamp?: number }>(
          decodedState,
          null,
          { context: 'onOAuthSuccess.state' }
        )
        const returnTo = stateData?.returnTo

        if (returnTo && db) {
          // Validate return URL against allowed patterns
          const returnDomain = new URL(returnTo).host
          const isAllowed = await validateDomain(returnDomain, allowedDomainPatterns, resolveTenantNs)

          if (isAllowed) {
            // Generate one-time token for cross-domain session
            const token = await generateCrossDomainToken(db, session.id)

            // Return redirect URL with token
            const redirectUrl = new URL(returnTo)
            redirectUrl.searchParams.set('auth_token', token)
            return { redirect: redirectUrl.toString() }
          }
        }

        // Default: stay on auth domain
        return {}
      },
    },
  })
}

// ============================================================================
// CROSS-DOMAIN TOKEN HANDLING
// ============================================================================

/**
 * Generate a one-time token for cross-domain session transfer.
 * Token is stored in verifications table with short expiry.
 */
async function generateCrossDomainToken(db: DrizzleD1Database<typeof schema>, sessionId: string): Promise<string> {
  const token = crypto.randomUUID()

  await db.insert(schema.verifications).values({
    id: crypto.randomUUID(),
    identifier: `cross_domain:${token}`,
    value: sessionId,
    expiresAt: new Date(Date.now() + 60 * 1000), // 1 minute
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return token
}

/**
 * Exchange a cross-domain token for a session.
 * Call this on the tenant domain to establish a session cookie.
 */
export async function exchangeCrossDomainToken(db: DrizzleD1Database<typeof schema>, token: string): Promise<{ sessionId: string } | null> {
  const verification = await db.query.verifications.findFirst({
    where: (t, { eq, and, gt }) => and(eq(t.identifier, `cross_domain:${token}`), gt(t.expiresAt, new Date())),
  })

  if (!verification) {
    return null
  }

  // Delete the token (one-time use)
  await db.delete(schema.verifications).where(eq(schema.verifications.id, verification.id))

  return { sessionId: verification.value }
}

// ============================================================================
// DOMAIN VALIDATION
// ============================================================================

/**
 * Validate that a domain is allowed for cross-domain redirect.
 */
async function validateDomain(domain: string, patterns: string[], resolveTenantNs: (domain: string) => Promise<string | null>): Promise<boolean> {
  // Check against patterns (e.g., '*.headless.ly', 'crm.*.com')
  for (const pattern of patterns) {
    if (matchDomainPattern(domain, pattern)) {
      return true
    }
  }

  // Check if it's a registered custom domain
  const tenantNs = await resolveTenantNs(domain)
  return tenantNs !== null
}

/**
 * Match a domain against a wildcard pattern.
 */
function matchDomainPattern(domain: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$')
  return regex.test(domain)
}

/**
 * Extract root domain from a hostname.
 * e.g., 'auth.headless.ly' → '.headless.ly'
 */
function extractRootDomain(domain: string): string {
  const parts = domain.split('.')
  if (parts.length >= 2) {
    return '.' + parts.slice(-2).join('.')
  }
  return domain
}

// ============================================================================
// TENANT DOMAIN HANDLER
// ============================================================================

/**
 * Handler for tenant domain auth callback.
 * Call this at /auth/callback on each tenant domain.
 */
export async function handleTenantAuthCallback(request: Request, db: DrizzleD1Database<typeof schema>): Promise<Response> {
  const url = new URL(request.url)
  const token = url.searchParams.get('auth_token')

  if (!token) {
    return new Response('Missing auth token', { status: 400 })
  }

  // Exchange token for session
  const result = await exchangeCrossDomainToken(db, token)

  if (!result) {
    return new Response('Invalid or expired token', { status: 401 })
  }

  // Get the session
  const session = await db.query.sessions.findFirst({
    where: (t, { eq }) => eq(t.id, result.sessionId),
  })

  if (!session) {
    return new Response('Session not found', { status: 401 })
  }

  // Set session cookie on this domain
  const headers = new Headers()
  headers.set('Set-Cookie', `session_token=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`)

  // Redirect to dashboard or intended page
  const returnTo = url.searchParams.get('return_to') || '/'
  headers.set('Location', returnTo)

  return new Response(null, { status: 302, headers })
}

// ============================================================================
// CUSTOM DOMAIN REGISTRATION
// ============================================================================

/**
 * Register a custom domain for a tenant.
 * Creates entry in customDomains table with verification token.
 */
export async function registerCustomDomain(
  db: DrizzleD1Database<typeof schema>,
  organizationId: string,
  domain: string,
): Promise<{ verificationToken: string }> {
  // Get org to find tenantNs
  const org = await db.query.organizations.findFirst({
    where: (t, { eq }) => eq(t.id, organizationId),
  })

  if (!org?.tenantNs) {
    throw new Error('Organization has no tenant namespace')
  }

  // Generate DNS verification token
  const verificationToken = `do-verify-${crypto.randomUUID().slice(0, 8)}`

  // Create custom domain record
  await db.insert(schema.customDomains).values({
    id: crypto.randomUUID(),
    domain,
    organizationId,
    tenantNs: org.tenantNs,
    verified: false,
    verificationToken,
    verificationMethod: 'dns_txt',
    sslStatus: 'pending',
    createdAt: new Date(),
  })

  return { verificationToken }
}

/**
 * Verify a custom domain via DNS TXT record.
 */
export async function verifyCustomDomain(db: DrizzleD1Database<typeof schema>, domainId: string): Promise<boolean> {
  const customDomain = await db.query.customDomains.findFirst({
    where: (t, { eq }) => eq(t.id, domainId),
  })

  if (!customDomain) return false

  // Check DNS TXT record at _do-verify.{domain}
  // In production, use DNS lookup or Cloudflare API:
  //
  // const dnsName = `_do-verify.${customDomain.domain}`
  // const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${dnsName}&type=TXT`, {
  //   headers: { 'Accept': 'application/dns-json' }
  // })
  // const data = await response.json()
  // const verified = data.Answer?.some(a => a.data.includes(customDomain.verificationToken))

  // For now, assume verified (implement actual DNS check)
  const verified = true

  if (verified) {
    await db
      .update(schema.customDomains)
      .set({
        verified: true,
        verifiedAt: new Date(),
        sslStatus: 'active',
      })
      .where(eq(schema.customDomains.id, domainId))
  }

  return verified
}

/**
 * Look up tenant namespace by custom domain.
 */
export async function lookupCustomDomain(db: DrizzleD1Database<typeof schema>, domain: string): Promise<string | null> {
  const customDomain = await db.query.customDomains.findFirst({
    where: (t, { eq, and }) => and(eq(t.domain, domain), eq(t.verified, true)),
  })

  return customDomain?.tenantNs || null
}
