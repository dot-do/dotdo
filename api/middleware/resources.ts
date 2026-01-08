import type { Context, MiddlewareHandler } from 'hono'

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
// Constants
// ============================================================================

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates a resource type name - only allow alphanumeric and hyphen/underscore
 */
function isValidTypeName(type: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(type)
}

/**
 * Generate a unique ID for new resources
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Check if user has required permission
 */
function hasPermission(
  user: { id: string; role: string; permissions?: string[] } | undefined,
  permission: Permission | undefined
): boolean {
  if (!user) return false
  if (!permission) return true // No permission requirement means allowed

  // If permission is a role string, check user role
  if (typeof permission === 'string') {
    // Allow if user role matches or if user has specific permission
    return user.role === permission || user.permissions?.includes(permission) || false
  }

  // If permission is an array, check if user has any of the required permissions
  if (Array.isArray(permission)) {
    return permission.some((p) => user.permissions?.includes(p))
  }

  return false
}

/**
 * Parse path to extract type and id
 */
function parsePath(path: string): { type: string; id?: string } | null {
  // Match /api/:type or /api/:type/:id
  const match = path.match(/^\/api\/([^/]+)(?:\/(.+))?$/)
  if (!match) return null
  return { type: match[1], id: match[2] }
}

// ============================================================================
// Middleware Factory
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
export function resources(config?: ResourcesConfig): MiddlewareHandler {
  const types = config?.types ?? {}

  return async (c, next) => {
    const path = c.req.path
    const method = c.req.method
    const parsed = parsePath(path)

    if (!parsed) {
      await next()
      return
    }

    const { type, id } = parsed
    const user = c.get('user') as { id: string; role: string; permissions?: string[] } | undefined
    const db = c.get('db') as Record<string, unknown>

    // Check authentication first
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401, {
        'WWW-Authenticate': 'Bearer',
      })
    }

    // Validate type name
    if (!isValidTypeName(type)) {
      return c.json({ error: 'Resource type not found' }, 404)
    }

    // Check if type is configured
    const typeConfig = types[type]
    if (!typeConfig) {
      return c.json({ error: 'Resource type not found' }, 404)
    }

    // Validate ID if present (check for path traversal)
    if (id && (id.includes('/') || id.includes('..'))) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    // Route based on method and presence of id
    try {
      // ============================================================================
      // GET - List or Get Single
      // ============================================================================
      if (method === 'GET') {
        // Check read permission
        if (!hasPermission(user, typeConfig.permissions?.read)) {
          return c.json({ error: 'Permission denied: access forbidden' }, 403)
        }

        if (id) {
          // GET /:type/:id - Get single resource
          return await handleGet(c, type, id, db)
        } else {
          // GET /:type - List resources
          return await handleList(c, type, db)
        }
      }

      // ============================================================================
      // POST - Create
      // ============================================================================
      if (method === 'POST' && !id) {
        // Check write permission
        if (!hasPermission(user, typeConfig.permissions?.write)) {
          return c.json({ error: 'Permission denied: access forbidden' }, 403)
        }

        return await handleCreate(c, type, typeConfig, db)
      }

      // ============================================================================
      // PUT - Full Update
      // ============================================================================
      if (method === 'PUT' && id) {
        // Check write permission
        if (!hasPermission(user, typeConfig.permissions?.write)) {
          return c.json({ error: 'Permission denied: access forbidden' }, 403)
        }

        return await handleUpdate(c, type, id, typeConfig, db, false)
      }

      // ============================================================================
      // PATCH - Partial Update
      // ============================================================================
      if (method === 'PATCH' && id) {
        // Check write permission
        if (!hasPermission(user, typeConfig.permissions?.write)) {
          return c.json({ error: 'Permission denied: access forbidden' }, 403)
        }

        return await handleUpdate(c, type, id, typeConfig, db, true)
      }

      // ============================================================================
      // DELETE - Delete
      // ============================================================================
      if (method === 'DELETE' && id) {
        // Check write permission
        if (!hasPermission(user, typeConfig.permissions?.write)) {
          return c.json({ error: 'Permission denied: access forbidden' }, 403)
        }

        return await handleDelete(c, type, id, typeConfig, db)
      }

      // Method not allowed or invalid route
      await next()
    } catch (error) {
      return c.json({ error: 'Internal server error' }, 500)
    }
  }
}

// ============================================================================
// Handler Functions
// ============================================================================

async function handleList(
  c: Context,
  type: string,
  db: Record<string, unknown>
): Promise<Response> {
  // Parse pagination params
  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')

  let limit = DEFAULT_LIMIT
  let offset = 0

  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10)
    if (!isNaN(parsed)) {
      limit = Math.min(Math.max(1, parsed), MAX_LIMIT)
    }
  }

  if (offsetParam !== undefined) {
    const parsed = parseInt(offsetParam, 10)
    if (!isNaN(parsed)) {
      offset = Math.max(0, parsed)
    }
  }

  try {
    // Query database
    const query = (db as { query: Record<string, { findMany: (opts: unknown) => Promise<unknown[]> }> }).query
    const items = await query[type].findMany({ limit, offset })

    return c.json({
      items,
      total: items.length, // In real implementation, this would be a count query
      limit,
      offset,
    })
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleGet(
  c: Context,
  type: string,
  id: string,
  db: Record<string, unknown>
): Promise<Response> {
  try {
    // Query database
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const resource = await query[type].findFirst({ where: { id } })

    if (!resource) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    return c.json(resource)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleCreate(
  c: Context,
  type: string,
  typeConfig: TypeConfig,
  db: Record<string, unknown>
): Promise<Response> {
  // Parse request body
  let data: Record<string, unknown>
  try {
    data = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400)
  }

  // Validate required fields
  if (typeConfig.requiredFields) {
    for (const field of typeConfig.requiredFields) {
      if (data[field] === undefined || data[field] === null) {
        return c.json({ error: `Required field missing: ${field}` }, 400)
      }
    }
  }

  // Check for empty body with required fields
  if (typeConfig.requiredFields?.length && Object.keys(data).length === 0) {
    return c.json({ error: 'Required fields missing: ' + typeConfig.requiredFields.join(', ') }, 400)
  }

  try {
    // Run beforeCreate hook
    if (typeConfig.hooks?.beforeCreate) {
      try {
        data = (await typeConfig.hooks.beforeCreate(data, c)) as Record<string, unknown>
      } catch (error) {
        return c.json({ error: 'Validation error' }, 400)
      }
    }

    // Generate ID if not provided
    if (!data.id) {
      data.id = generateId()
    }

    // Insert into database
    const insert = db.insert as (data: unknown) => Promise<unknown>
    const resource = await insert(data)

    // Run afterCreate hook
    if (typeConfig.hooks?.afterCreate) {
      await typeConfig.hooks.afterCreate(resource, c)
    }

    return c.json(resource, 201)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleUpdate(
  c: Context,
  type: string,
  id: string,
  typeConfig: TypeConfig,
  db: Record<string, unknown>,
  isPartial: boolean
): Promise<Response> {
  // Parse request body
  let data: Record<string, unknown>
  try {
    data = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400)
  }

  try {
    // Check if resource exists
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const existing = await query[type].findFirst({ where: { id } })

    if (!existing) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    // Run beforeUpdate hook
    if (typeConfig.hooks?.beforeUpdate) {
      try {
        data = (await typeConfig.hooks.beforeUpdate(data, c)) as Record<string, unknown>
      } catch (error) {
        return c.json({ error: 'Validation error' }, 400)
      }
    }

    // Update in database
    const update = db.update as (data: unknown) => Promise<unknown>
    const resource = await update({ ...data, id })

    // Run afterUpdate hook
    if (typeConfig.hooks?.afterUpdate) {
      await typeConfig.hooks.afterUpdate(resource, c)
    }

    return c.json(resource)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleDelete(
  c: Context,
  type: string,
  id: string,
  typeConfig: TypeConfig,
  db: Record<string, unknown>
): Promise<Response> {
  try {
    // Check if resource exists
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const existing = await query[type].findFirst({ where: { id } })

    if (!existing) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    // Run beforeDelete hook
    if (typeConfig.hooks?.beforeDelete) {
      try {
        await typeConfig.hooks.beforeDelete(existing, c)
      } catch (error) {
        return c.json({ error: 'Deletion prevented' }, 400)
      }
    }

    // Delete from database
    const del = db.delete as (opts: unknown) => Promise<unknown>
    await del({ id })

    // Run afterDelete hook
    if (typeConfig.hooks?.afterDelete) {
      await typeConfig.hooks.afterDelete(existing, c)
    }

    return c.body(null, 204)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

export default resources
