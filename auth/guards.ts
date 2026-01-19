// Permission guards - composable auth checks
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AuthUser } from './middleware'

// Require authentication (user must be set)
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as AuthUser | undefined
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    return next()
  }
}

// Require specific role(s)
export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as AuthUser | undefined
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

// Require specific scope(s)
export function requireScope(...scopes: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as AuthUser | undefined
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

// Require ownership of resource
export function requireOwner(
  getResourceOwnerId: (c: Context) => string | Promise<string>
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as AuthUser | undefined
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
        guard(c, async () => { resolve() })
          .catch(reject)
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
    if (errors.length > 0 && errors[0] instanceof HTTPException) {
      throw errors[0]
    }

    // All guards failed
    throw new HTTPException(403, { message: 'Access denied' })
  }
}
