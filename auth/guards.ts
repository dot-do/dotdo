/**
 * Permission Guards - Composable Auth Checks
 *
 * Provides reusable middleware for enforcing authentication, authorization,
 * and ownership checks. All guards fail closed - any authentication or
 * authorization failure results in an HTTP exception.
 *
 * @module @dotdo/auth/guards
 */
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
// Side-effect import for module augmentation
import './middleware'
import { ROLE_HIERARCHY, isRoleAtLeast, userHasAtLeastRole, type BuiltInRole, type UserContext } from './rbac'

/**
 * Require that a user is authenticated.
 *
 * This guard checks that a user is present in the request context.
 * If no user is found, responds with 401 Unauthorized.
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { authMiddleware, requireAuth } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // First apply authentication
 * app.use('/*', authMiddleware({ secret: process.env.JWT_SECRET }))
 *
 * // Then require auth on specific routes
 * app.use('/api/*', requireAuth())
 *
 * app.get('/api/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id })
 * })
 * ```
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    return next()
  }
}

/**
 * Require that a user has one or more specific roles.
 *
 * This guard checks that the authenticated user has at least one of the
 * specified roles. Responds with 403 Forbidden if the user lacks all
 * required roles. Also enforces authentication (401 Unauthorized).
 *
 * @param roles - One or more role names to check (e.g., 'admin', 'editor')
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Require 'admin' role
 * app.delete('/api/users/:id', requireRole('admin'), (c) => {
 *   return c.json({ deleted: true })
 * })
 *
 * // Accept multiple roles (OR logic)
 * app.use('/api/admin/*', requireRole('admin', 'moderator'))
 *
 * app.get('/api/admin/logs', (c) => {
 *   const user = c.get('user')
 *   return c.json({ logs: [...] })
 * })
 * ```
 */
export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const hasRole = roles.some(role => user.roles?.includes(role))
    if (!hasRole) {
      throw new HTTPException(403, {
        message: `Required role: ${roles.join(' or ')}`
      })
    }

    return next()
  }
}

/**
 * Require that a user has one or more specific OAuth scopes.
 *
 * This guard checks that the authenticated user has at least one of the
 * specified scopes. Supports wildcard matching (e.g., 'users:*' matches
 * 'users:read'). Responds with 403 Forbidden if the user lacks all
 * required scopes.
 *
 * Scope matching rules:
 * - Direct match: exact scope required (e.g., 'users:read')
 * - Resource wildcard: 'resource:*' matches any 'resource:*' scope
 * - Global wildcard: '*' matches any scope
 *
 * @param scopes - One or more scopes to check
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Require 'users:read' scope
 * app.get('/api/users', requireScope('users:read'), (c) => {
 *   return c.json({ users: [...] })
 * })
 *
 * // Accept multiple scopes (OR logic)
 * app.post('/api/posts', requireScope('posts:write', 'admin'), (c) => {
 *   return c.json({ created: true })
 * })
 *
 * // Wildcard matching
 * // A user with 'users:*' scope will pass requireScope('users:read')
 * // A user with '*' scope will pass any scope check
 * ```
 */
export function requireScope(...scopes: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const userScopes = user.scopes || []

    // Check if user has required scope or wildcard
    const hasScope = scopes.some(scope => {
      // Direct match
      if (userScopes.includes(scope)) return true

      // Wildcard match (e.g., "users:*" matches "users:read")
      const [resource] = scope.split(':')
      if (userScopes.includes(`${resource}:*`)) return true
      if (userScopes.includes('*')) return true

      return false
    })

    if (!hasScope) {
      throw new HTTPException(403, {
        message: `Required scope: ${scopes.join(' or ')}`
      })
    }

    return next()
  }
}

/**
 * Require that the authenticated user owns a specific resource.
 *
 * This guard calls a custom function to determine the resource owner's ID,
 * then checks that the authenticated user matches. Also allows admins to
 * bypass the ownership check.
 *
 * @param getResourceOwnerId - Function that extracts the owner ID from the request
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Check that user is editing their own profile
 * app.patch('/api/users/:id', requireOwner(async (c) => {
 *   return c.req.param('id')
 * }), (c) => {
 *   return c.json({ updated: true })
 * })
 *
 * // Check from database
 * app.delete('/api/posts/:id', requireOwner(async (c) => {
 *   const postId = c.req.param('id')
 *   const post = await db.posts.get(postId)
 *   return post?.userId
 * }), (c) => {
 *   return c.json({ deleted: true })
 * })
 * ```
 */
export function requireOwner(
  getResourceOwnerId: (c: Context) => string | Promise<string>
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const ownerId = await getResourceOwnerId(c)

    // Admins can access any resource
    if (user.roles?.includes('admin')) {
      return next()
    }

    if (user.id !== ownerId) {
      throw new HTTPException(403, { message: 'Access denied - not owner' })
    }

    return next()
  }
}

/**
 * Combine multiple guards where ALL must pass (AND logic).
 *
 * This guard chains multiple guards together and only proceeds if all of them
 * succeed. If any guard fails, the request is rejected with that guard's error.
 *
 * @param guards - One or more middleware guards to check
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Require both 'admin' role AND 'admin:*' scope
 * app.delete('/api/critical', requireAll(
 *   requireRole('admin'),
 *   requireScope('admin:*')
 * ), (c) => {
 *   return c.json({ deleted: true })
 * })
 * ```
 */
export function requireAll(...guards: MiddlewareHandler[]): MiddlewareHandler {
  return async (c, next) => {
    for (const guard of guards) {
      await new Promise<void>((resolve, reject) => {
        guard(c, async () => { resolve() })
          .catch(reject)
      })
    }
    return next()
  }
}

/**
 * Combine multiple guards where ANY can pass (OR logic).
 *
 * This guard chains multiple guards together and proceeds if at least one of them
 * succeeds. If all guards fail, the request is rejected with the first guard's error.
 *
 * @param guards - One or more middleware guards to check
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Accept either 'admin' role OR 'api:*' scope
 * app.get('/api/data', requireAny(
 *   requireRole('admin'),
 *   requireScope('api:*')
 * ), (c) => {
 *   return c.json({ data: [...] })
 * })
 * ```
 */
export function requireAny(...guards: MiddlewareHandler[]): MiddlewareHandler {
  return async (c, next) => {
    const errors: Error[] = []

    for (const guard of guards) {
      try {
        await new Promise<void>((resolve, reject) => {
          guard(c, async () => { resolve() })
            .catch(reject)
        })
        // If any guard passes, continue
        return next()
      } catch (error) {
        errors.push(error as Error)
      }
    }

    // All guards failed - throw the first error to preserve the original status code
    const firstError = errors[0]
    if (firstError instanceof HTTPException) {
      throw firstError
    }

    // All guards failed
    throw new HTTPException(403, { message: 'Access denied' })
  }
}

/**
 * Require that a user has at least a certain role level in the hierarchy.
 *
 * Unlike `requireRole()` which checks for exact role matches, this guard
 * uses the role hierarchy to allow higher-privileged roles to pass.
 * For example, if 'editor' is required, 'admin' and 'super_admin' will also pass.
 *
 * Role hierarchy (lowest to highest):
 * guest < viewer < api < editor < owner < admin < super_admin
 *
 * @param minimumRole - The minimum role level required
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * // Require at least 'editor' level (admin and super_admin also pass)
 * app.post('/api/posts', requireRoleLevel('editor'), (c) => {
 *   return c.json({ created: true })
 * })
 *
 * // Require at least 'admin' level
 * app.delete('/api/users/:id', requireRoleLevel('admin'), (c) => {
 *   return c.json({ deleted: true })
 * })
 * ```
 */
export function requireRoleLevel(minimumRole: BuiltInRole | string): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const userRoles = user.roles || []
    const userContext: UserContext = {
      id: user.id,
      roles: userRoles
    }

    if (!userHasAtLeastRole(userContext, minimumRole)) {
      throw new HTTPException(403, {
        message: `Required role level: ${minimumRole} or higher`
      })
    }

    return next()
  }
}

/**
 * Require the user to be a super admin.
 * Shorthand for requireRoleLevel('super_admin').
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.delete('/api/system/reset', requireSuperAdmin(), (c) => {
 *   return c.json({ reset: true })
 * })
 * ```
 */
export function requireSuperAdmin(): MiddlewareHandler {
  return requireRoleLevel('super_admin')
}

/**
 * Require the user to be an admin (or higher).
 * Shorthand for requireRoleLevel('admin').
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/admin/*', requireAdmin())
 * ```
 */
export function requireAdmin(): MiddlewareHandler {
  return requireRoleLevel('admin')
}

/**
 * Require the user to have at least editor privileges.
 * Shorthand for requireRoleLevel('editor').
 *
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.post('/api/posts', requireEditor(), (c) => {
 *   return c.json({ created: true })
 * })
 * ```
 */
export function requireEditor(): MiddlewareHandler {
  return requireRoleLevel('editor')
}

// Re-export role hierarchy utilities for convenience
export { ROLE_HIERARCHY, isRoleAtLeast, userHasAtLeastRole }
