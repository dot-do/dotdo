import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { canView, type Actor, type Visibility, type ThingData } from '../../types/Thing'

// ============================================================================
// Types
// ============================================================================

/**
 * Extended auth context that includes org membership information
 */
export interface VisibilityAuthContext {
  userId?: string
  orgId?: string
  role?: 'admin' | 'user'
}

/**
 * Session context from better-auth
 */
export interface SessionContext {
  userId?: string
  activeOrganizationId?: string
}

/**
 * Configuration options for visibility middleware
 */
export interface VisibilityConfig {
  /**
   * Paths that allow public access regardless of thing visibility
   * Default: []
   */
  publicPaths?: string[]

  /**
   * Whether to allow admin users to bypass visibility checks
   * Default: true
   */
  adminBypass?: boolean

  /**
   * Custom function to check org membership
   * If not provided, org checks use activeOrganizationId from session
   */
  checkOrgMembership?: (userId: string, orgId: string) => Promise<boolean>
}

/**
 * Result of a visibility check
 */
export interface VisibilityCheckResult {
  allowed: boolean
  reason?: string
  visibility?: Visibility
}

// ============================================================================
// Actor Extraction
// ============================================================================

/**
 * Extract actor context from Hono request context.
 * Pulls userId and orgId from session and auth context.
 *
 * @param c - Hono context
 * @returns Actor object with userId and orgId if available
 */
export function extractActor(c: Context): Actor {
  // Try to get session context (from auth-federation or better-auth)
  const session = c.get('session') as SessionContext | undefined

  // Try to get auth context (from auth middleware)
  const auth = c.get('auth') as VisibilityAuthContext | undefined

  // Build actor from available sources
  const actor: Actor = {}

  // Get userId from either source
  if (auth?.userId) {
    actor.userId = auth.userId
  } else if (session?.userId) {
    actor.userId = session.userId
  }

  // Get orgId from either source
  if (auth?.orgId) {
    actor.orgId = auth.orgId
  } else if (session?.activeOrganizationId) {
    actor.orgId = session.activeOrganizationId
  }

  return actor
}

/**
 * Check if the current user has admin role
 *
 * @param c - Hono context
 * @returns true if user is admin
 */
export function isAdmin(c: Context): boolean {
  const auth = c.get('auth') as VisibilityAuthContext | undefined
  return auth?.role === 'admin'
}

// ============================================================================
// Visibility Checking
// ============================================================================

/**
 * Check if an actor can view a thing based on its visibility settings.
 *
 * Visibility rules:
 * - 'public': Anyone can view
 * - 'unlisted': Anyone with the link can view (same as public for API access)
 * - 'org': Only members of the thing's organization can view
 * - 'user': Only the owner can view
 *
 * @param thing - The thing to check visibility for
 * @param actor - The actor attempting to view
 * @param options - Optional configuration
 * @returns VisibilityCheckResult with allowed status and reason
 */
export function checkVisibility(
  thing: ThingData,
  actor: Actor,
  options?: { adminBypass?: boolean; isAdmin?: boolean }
): VisibilityCheckResult {
  const visibility = thing.visibility ?? 'user'

  // Admin bypass if enabled
  if (options?.adminBypass && options?.isAdmin) {
    return {
      allowed: true,
      reason: 'Admin bypass',
      visibility,
    }
  }

  // Use the canView helper from Thing.ts
  const allowed = canView(thing, actor)

  if (!allowed) {
    // Provide specific reason based on visibility
    let reason: string
    switch (visibility) {
      case 'org':
        reason = 'Organization membership required'
        break
      case 'user':
        reason = 'Owner access required'
        break
      default:
        reason = 'Access denied'
    }

    return {
      allowed: false,
      reason,
      visibility,
    }
  }

  return {
    allowed: true,
    visibility,
  }
}

/**
 * Check if an actor can view a thing, returning a boolean.
 * Simple wrapper around checkVisibility for convenience.
 *
 * @param thing - The thing to check visibility for
 * @param actor - The actor attempting to view
 * @returns true if the actor can view the thing
 */
export function canViewThing(thing: ThingData, actor: Actor): boolean {
  return checkVisibility(thing, actor).allowed
}

// ============================================================================
// Visibility Filter for Lists
// ============================================================================

/**
 * Filter a list of things based on visibility and actor context.
 * Useful for filtering query results before returning to the client.
 *
 * @param things - Array of things to filter
 * @param actor - The actor viewing the list
 * @param options - Optional configuration
 * @returns Filtered array of things the actor can view
 */
export function filterByVisibility<T extends ThingData>(
  things: T[],
  actor: Actor,
  options?: { adminBypass?: boolean; isAdmin?: boolean }
): T[] {
  return things.filter((thing) => {
    const result = checkVisibility(thing, actor, options)
    return result.allowed
  })
}

/**
 * Get the visibility levels an actor can access.
 * Useful for building database queries.
 *
 * @param actor - The actor to check
 * @param options - Optional configuration
 * @returns Array of visibility levels the actor can access
 */
export function getAccessibleVisibilities(
  actor: Actor,
  options?: { adminBypass?: boolean; isAdmin?: boolean }
): Visibility[] {
  // Admin bypass - can see everything
  if (options?.adminBypass && options?.isAdmin) {
    return ['public', 'unlisted', 'org', 'user']
  }

  // Everyone can see public and unlisted
  const visibilities: Visibility[] = ['public', 'unlisted']

  // Authenticated users in an org can see org-visible things
  if (actor.orgId) {
    visibilities.push('org')
  }

  // Authenticated users can potentially see their own user-visible things
  // (but this requires further owner checking at the item level)
  if (actor.userId) {
    visibilities.push('user')
  }

  return visibilities
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Visibility enforcement middleware.
 *
 * This middleware extracts actor context from the request and makes it
 * available for downstream handlers. It does NOT automatically block
 * requests - that should be done by route handlers using the visibility
 * helpers.
 *
 * For automatic enforcement, use requireVisibility() middleware on
 * specific routes.
 *
 * @param config - Configuration options
 * @returns Hono middleware handler
 */
export function visibilityMiddleware(config: VisibilityConfig = {}): MiddlewareHandler {
  const { publicPaths = [] } = config

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip visibility processing for public paths
    if (publicPaths.some((p) => path.startsWith(p))) {
      return next()
    }

    // Extract actor and set on context for downstream use
    const actor = extractActor(c)
    c.set('actor', actor)

    // Set admin status for convenience
    c.set('isAdmin', isAdmin(c))

    return next()
  }
}

/**
 * Require visibility check middleware.
 *
 * This middleware should be applied AFTER a route handler that fetches
 * a thing and sets it on context. It will check visibility and return
 * 403 if the actor cannot view the thing.
 *
 * The thing should be set on context as 'thing' before this middleware runs.
 *
 * @param config - Configuration options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.get('/things/:id',
 *   async (c, next) => {
 *     const thing = await getThing(c.req.param('id'))
 *     c.set('thing', thing)
 *     return next()
 *   },
 *   requireVisibility(),
 *   (c) => c.json(c.get('thing'))
 * )
 * ```
 */
export function requireVisibility(config: VisibilityConfig = {}): MiddlewareHandler {
  const { adminBypass = true } = config

  return async (c: Context, next: Next) => {
    const thing = c.get('thing') as ThingData | undefined

    // If no thing on context, skip visibility check
    // (the route handler should have set it)
    if (!thing) {
      return next()
    }

    // Get actor (should be set by visibilityMiddleware)
    const actor = (c.get('actor') as Actor | undefined) ?? extractActor(c)
    const isAdminUser = c.get('isAdmin') as boolean | undefined ?? isAdmin(c)

    // Check visibility
    const result = checkVisibility(thing, actor, {
      adminBypass,
      isAdmin: isAdminUser,
    })

    if (!result.allowed) {
      throw new HTTPException(403, {
        message: result.reason ?? 'Access denied',
      })
    }

    return next()
  }
}

/**
 * Require specific visibility level middleware.
 *
 * Use this when you know the required visibility level ahead of time
 * (e.g., admin-only routes).
 *
 * @param requiredVisibility - The visibility level(s) required
 * @param config - Configuration options
 * @returns Hono middleware handler
 */
export function requireVisibilityLevel(
  requiredVisibility: Visibility | Visibility[],
  config: VisibilityConfig = {}
): MiddlewareHandler {
  const { adminBypass = true } = config
  const required = Array.isArray(requiredVisibility) ? requiredVisibility : [requiredVisibility]

  return async (c: Context, next: Next) => {
    const actor = (c.get('actor') as Actor | undefined) ?? extractActor(c)
    const isAdminUser = c.get('isAdmin') as boolean | undefined ?? isAdmin(c)

    // Admin bypass
    if (adminBypass && isAdminUser) {
      return next()
    }

    // Get accessible visibilities for this actor
    const accessible = getAccessibleVisibilities(actor, { adminBypass, isAdmin: isAdminUser })

    // Check if any required visibility is accessible
    const hasAccess = required.some((v) => accessible.includes(v))

    if (!hasAccess) {
      throw new HTTPException(403, {
        message: `Visibility level '${required.join(' or ')}' required`,
      })
    }

    return next()
  }
}

// ============================================================================
// DO Integration Helpers
// ============================================================================

/**
 * Helper to check visibility at the DO boundary.
 * Use this in DO methods before returning things to clients.
 *
 * @param thing - The thing to check
 * @param actor - The actor requesting access
 * @param options - Optional configuration
 * @throws Error if access is denied
 */
export function assertVisibility(
  thing: ThingData,
  actor: Actor,
  options?: { adminBypass?: boolean; isAdmin?: boolean }
): void {
  const result = checkVisibility(thing, actor, options)

  if (!result.allowed) {
    throw new Error(result.reason ?? 'Access denied')
  }
}

/**
 * Helper to wrap a thing for safe return from DO.
 * Checks visibility and returns the thing if allowed, null otherwise.
 *
 * @param thing - The thing to return (or null if not found)
 * @param actor - The actor requesting access
 * @param options - Optional configuration
 * @returns The thing if visible, null otherwise
 */
export function visibleOrNull<T extends ThingData>(
  thing: T | null | undefined,
  actor: Actor,
  options?: { adminBypass?: boolean; isAdmin?: boolean }
): T | null {
  if (!thing) {
    return null
  }

  const result = checkVisibility(thing, actor, options)
  return result.allowed ? thing : null
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Hono variable types for visibility middleware
 */
export interface VisibilityVariables {
  actor: Actor
  isAdmin: boolean
  thing?: ThingData
}

export default visibilityMiddleware
