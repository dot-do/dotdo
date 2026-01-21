// Permission guards - composable auth checks
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
// Side-effect import for module augmentation
import './middleware'
import { ROLE_HIERARCHY, isRoleAtLeast, userHasAtLeastRole, type BuiltInRole, type UserContext } from './rbac'

/**
 * Function type for getting the resource owner ID from the request context.
 * Used with requireOwner() guard for DO auth integration.
 */
export type GetResourceOwnerIdFn = (c: Context) => string | Promise<string>

// Require authentication (user must be set)
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    return next()
  }
}

// Require specific role(s)
export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const hasRole = roles.some((role) => user.roles?.includes(role))
    if (!hasRole) {
      throw new HTTPException(403, {
        message: `Required role: ${roles.join(' or ')}`,
      })
    }

    return next()
  }
}

// Require specific scope(s)
export function requireScope(...scopes: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.var.user
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const userScopes = user.scopes || []

    // Check if user has required scope or wildcard
    const hasScope = scopes.some((scope) => {
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
        message: `Required scope: ${scopes.join(' or ')}`,
      })
    }

    return next()
  }
}

// Require ownership of resource
export function requireOwner(getResourceOwnerId: GetResourceOwnerIdFn): MiddlewareHandler {
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

// Combine multiple guards (all must pass)
export function requireAll(...guards: MiddlewareHandler[]): MiddlewareHandler {
  return async (c, next) => {
    for (const guard of guards) {
      await new Promise<void>((resolve, reject) => {
        guard(c, async () => {
          resolve()
        }).catch(reject)
      })
    }
    return next()
  }
}

// Combine multiple guards (any must pass)
export function requireAny(...guards: MiddlewareHandler[]): MiddlewareHandler {
  return async (c, next) => {
    const errors: Error[] = []

    for (const guard of guards) {
      try {
        await new Promise<void>((resolve, reject) => {
          guard(c, async () => {
            resolve()
          }).catch(reject)
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
      roles: userRoles,
    }

    if (!userHasAtLeastRole(userContext, minimumRole)) {
      throw new HTTPException(403, {
        message: `Required role level: ${minimumRole} or higher`,
      })
    }

    return next()
  }
}

/**
 * Require the user to be a super admin.
 * Shorthand for requireRoleLevel('super_admin').
 */
export function requireSuperAdmin(): MiddlewareHandler {
  return requireRoleLevel('super_admin')
}

/**
 * Require the user to be an admin (or higher).
 * Shorthand for requireRoleLevel('admin').
 */
export function requireAdmin(): MiddlewareHandler {
  return requireRoleLevel('admin')
}

/**
 * Require the user to have at least editor privileges.
 * Shorthand for requireRoleLevel('editor').
 */
export function requireEditor(): MiddlewareHandler {
  return requireRoleLevel('editor')
}

// Re-export role hierarchy utilities for convenience
export { ROLE_HIERARCHY, isRoleAtLeast, userHasAtLeastRole }
