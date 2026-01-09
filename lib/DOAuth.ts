/**
 * DOAuth - Authentication capability for Durable Objects
 *
 * Provides Hono-based auth routes that can be mounted on any DO:
 * - /api/auth/* - Authentication routes (sign-in, sign-out, callbacks)
 * - Federation to parent DO by default
 * - OAuth provider and proxy plugins
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   private auth: DOAuth
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.auth = new DOAuth(this, { federate: true })
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     // Try auth routes first
 *     const authResponse = await this.auth.handle(request)
 *     if (authResponse) return authResponse
 *
 *     // Handle other routes
 *     return super.fetch(request)
 *   }
 * }
 * ```
 */

import { Hono } from 'hono'
import type { Context as HonoContext, MiddlewareHandler } from 'hono'
import { auth as authFederation } from '../api/middleware/auth-federation'
import { authMiddleware, requireAuth, requireRole } from '../api/middleware/auth'
import type { DO } from '../objects/DO'

// ============================================================================
// Hono App Type with Variables
// ============================================================================

/**
 * Variables available in Hono context after auth middleware
 */
interface AuthVariables {
  user?: {
    id: string
    email?: string
    role?: string
  }
  session?: SessionData
  auth?: DOAuthContext
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for DOAuth
 */
export interface DOAuthConfig {
  /** Whether to federate auth to parent DO. Default: true */
  federate?: boolean
  /** URL to federate auth to. Default: derives from parent DO ns */
  federateTo?: string
  /** OAuth provider configuration */
  providers?: Record<string, ProviderConfig>
  /** Make this DO an OAuth provider */
  oauthProvider?: { enabled: boolean; loginPage?: string; consentPage?: string }
  /** Enable OAuth proxy for cross-domain auth */
  oauthProxy?: { enabled: boolean }
  /** Enable organization management */
  organization?: { enabled: boolean; allowUserToCreateOrganization?: boolean }
  /** JWT secret for token verification */
  jwtSecret?: string
  /** JWKS URL for token verification */
  jwksUrl?: string
  /** Custom session cookie name */
  cookieName?: string
  /** Public paths that don't require auth */
  publicPaths?: string[]
  /** Session validator function */
  validateSession?: (token: string) => Promise<SessionData | null>
  /** KV namespace for session caching */
  sessionCache?: KVNamespace
}

export interface ProviderConfig {
  enabled: boolean
  clientId?: string
  clientSecret?: string
}

export interface SessionData {
  userId: string
  email?: string
  role?: 'admin' | 'user'
  expiresAt?: Date
  activeOrganizationId?: string
}

/**
 * Auth context available after authentication
 */
export interface DOAuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
  activeOrganizationId?: string
}

// ============================================================================
// DOAuth Class
// ============================================================================

/**
 * DOAuth provides authentication capabilities for Durable Objects.
 *
 * Features:
 * - Hono-based routing for /api/auth/* endpoints
 * - Federation to parent DO (id.org.ai by default)
 * - OAuth provider plugin (make your DO an OAuth provider)
 * - OAuth proxy for cross-domain authentication
 * - Organization management
 * - Session management with KV caching
 */
export class DOAuth {
  /** The Hono app handling auth routes */
  private app: Hono<{ Variables: AuthVariables }>

  /** Reference to the parent DO */
  private do: DO

  /** Configuration */
  private config: Required<DOAuthConfig>

  /** Current auth context (set during request handling) */
  private currentAuth: DOAuthContext | null = null

  constructor(doInstance: DO, config: DOAuthConfig = {}) {
    this.do = doInstance

    // Merge with defaults
    this.config = {
      federate: config.federate ?? true,
      federateTo: config.federateTo ?? 'https://id.org.ai',
      providers: config.providers ?? {},
      oauthProvider: config.oauthProvider ?? { enabled: false },
      oauthProxy: config.oauthProxy ?? { enabled: true },
      organization: config.organization ?? { enabled: true, allowUserToCreateOrganization: true },
      jwtSecret: config.jwtSecret ?? '',
      jwksUrl: config.jwksUrl ?? '',
      cookieName: config.cookieName ?? 'session',
      publicPaths: config.publicPaths ?? ['/health', '/public'],
      validateSession: config.validateSession ?? null as unknown as (token: string) => Promise<SessionData | null>,
      sessionCache: config.sessionCache ?? undefined as unknown as KVNamespace,
    }

    // Create the Hono app
    this.app = this.createApp()
  }

  /**
   * Create the Hono app with auth routes
   */
  private createApp(): Hono<{ Variables: AuthVariables }> {
    const app = new Hono<{ Variables: AuthVariables }>()

    // Mount the auth federation middleware
    app.use(
      '/api/auth/*',
      authFederation({
        federate: this.config.federate,
        federateTo: this.config.federateTo,
        providers: this.config.providers,
        oauthProvider: this.config.oauthProvider,
        oauthProxy: this.config.oauthProxy,
        organization: this.config.organization,
      })
    )

    // Add session endpoint
    app.get('/api/auth/session', async (c) => {
      const session = c.get('session')
      const user = c.get('user')

      if (!session || !user) {
        return c.json({ authenticated: false }, 200)
      }

      return c.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role || 'user',
        },
        session: {
          activeOrganizationId: session.activeOrganizationId,
        },
      })
    })

    // Add me endpoint (requires auth)
    app.get('/api/auth/me', (c) => {
      const user = c.get('user')

      if (!user) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      return c.json({
        id: user.id,
        email: user.email,
        role: user.role || 'user',
      })
    })

    return app
  }

  /**
   * Handle an incoming request.
   * Returns a Response if the request was handled by auth routes,
   * or null if the request should be passed to other handlers.
   */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)

    // Only handle /api/auth/* routes
    if (!url.pathname.startsWith('/api/auth')) {
      return null
    }

    // Process through Hono app
    const response = await this.app.fetch(request)

    // Check if we got a 404 (route not found in auth app)
    if (response.status === 404) {
      return null
    }

    return response
  }

  /**
   * Create a middleware that authenticates requests.
   * Can be used with Hono or as a standalone middleware.
   */
  createMiddleware(): MiddlewareHandler {
    const config = this.config
    const self = this

    return authMiddleware({
      jwtSecret: config.jwtSecret,
      jwksUrl: config.jwksUrl,
      publicPaths: config.publicPaths,
      cookieName: config.cookieName,
      validateSession: config.validateSession,
      sessionCache: config.sessionCache,
    })
  }

  /**
   * Create a middleware that requires authentication.
   * Returns 401 if not authenticated.
   */
  requireAuth(): MiddlewareHandler {
    return requireAuth()
  }

  /**
   * Create a middleware that requires a specific role.
   * Returns 403 if role doesn't match.
   */
  requireRole(role: 'admin' | 'user'): MiddlewareHandler {
    return requireRole(role)
  }

  /**
   * Get the current auth context from a Hono context.
   */
  getAuth(c: HonoContext): DOAuthContext | undefined {
    return c.get('auth') as DOAuthContext | undefined
  }

  /**
   * Get the current user from a Hono context.
   */
  getUser(c: HonoContext): { id: string; email?: string; role: string; permissions?: string[] } | undefined {
    return c.get('user') as { id: string; email?: string; role: string; permissions?: string[] } | undefined
  }

  /**
   * Get the current session from a Hono context.
   */
  getSession(c: HonoContext): SessionData | undefined {
    return c.get('session') as SessionData | undefined
  }

  /**
   * Check if the current request is authenticated.
   */
  isAuthenticated(c: HonoContext): boolean {
    return !!this.getAuth(c)
  }

  /**
   * Check if the current user has a specific role.
   */
  hasRole(c: HonoContext, role: 'admin' | 'user'): boolean {
    const auth = this.getAuth(c)
    if (!auth) return false
    if (auth.role === 'admin') return true // Admin has all roles
    return auth.role === role
  }

  /**
   * Check if the current user has a specific permission.
   */
  hasPermission(c: HonoContext, permission: string): boolean {
    const auth = this.getAuth(c)
    if (!auth) return false
    if (auth.role === 'admin') return true // Admin has all permissions
    return auth.permissions?.includes(permission) ?? false
  }

  /**
   * Get the Hono app for direct mounting.
   * Useful when you want to compose with other Hono apps.
   */
  getApp(): Hono<{ Variables: AuthVariables }> {
    return this.app
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<DOAuthConfig>): void {
    Object.assign(this.config, config)
    // Recreate the app with new config
    this.app = this.createApp()
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<DOAuthConfig> {
    return { ...this.config }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a DOAuth instance for a Durable Object.
 *
 * @example
 * ```typescript
 * const auth = createDOAuth(this, {
 *   federate: true,
 *   federateTo: 'https://id.org.ai',
 * })
 * ```
 */
export function createDOAuth(doInstance: DO, config?: DOAuthConfig): DOAuth {
  return new DOAuth(doInstance, config)
}

// ============================================================================
// Exports
// ============================================================================

export default DOAuth
