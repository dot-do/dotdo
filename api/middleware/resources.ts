import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

/**
 * Resources Middleware
 *
 * Provides CRUD operations for typed resources.
 * Supports permissions, hooks, and pagination.
 *
 * Features:
 * - List resources with pagination (GET /api/:type)
 * - Get single resource (GET /api/:type/:id)
 * - Create resource (POST /api/:type)
 * - Update resource (PUT/PATCH /api/:type/:id)
 * - Delete resource (DELETE /api/:type/:id)
 * - Type-based permissions (read/write)
 * - Lifecycle hooks (beforeCreate, afterCreate, etc.)
 * - Authentication required
 *
 * NOT YET IMPLEMENTED - This is a stub for TDD.
 */

// ============================================================================
// Types
// ============================================================================

export type Permission = string | string[]

export interface ResourcePermissions {
  read?: Permission
  write?: Permission
}

export interface ResourceHooks {
  beforeCreate?: (data: unknown, c: Context) => unknown | Promise<unknown>
  afterCreate?: (resource: unknown, c: Context) => void | Promise<void>
  beforeUpdate?: (data: unknown, c: Context) => unknown | Promise<unknown>
  afterUpdate?: (resource: unknown, c: Context) => void | Promise<void>
  beforeDelete?: (resource: unknown, c: Context) => void | Promise<void>
  afterDelete?: (resource: unknown, c: Context) => void | Promise<void>
}

export interface TypeConfig {
  permissions?: ResourcePermissions
  hooks?: ResourceHooks
  requiredFields?: string[]
}

export interface ResourcesConfig {
  types?: Record<string, TypeConfig>
}

// ============================================================================
// Middleware Factory (Stub)
// ============================================================================

/**
 * Creates a resources middleware for handling CRUD operations.
 *
 * @param config - Resources configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/:type/*', resources({
 *   types: {
 *     tasks: {
 *       permissions: { read: 'user', write: 'admin' },
 *       hooks: {
 *         beforeCreate: async (data, c) => data,
 *         afterCreate: async (resource, c) => {},
 *       },
 *     },
 *   },
 * }))
 * ```
 */
export function resources(_config?: ResourcesConfig): MiddlewareHandler {
  // TODO: Implement resources middleware
  // This is a stub that will cause all tests to fail

  const app = new Hono()

  // Stub routes that return 501 Not Implemented
  app.get('/:type', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  app.get('/:type/:id', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  app.post('/:type', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  app.put('/:type/:id', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  app.patch('/:type/:id', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  app.delete('/:type/:id', (c) => {
    return c.json({ error: 'Resources middleware not implemented' }, 501)
  })

  return async (c, next) => {
    // Stub: just pass through to next middleware
    // The actual implementation would handle resource routing
    await next()
  }
}

export default resources
