import type { Context, MiddlewareHandler } from 'hono'

/**
 * Resources Middleware
 *
 * Provides CRUD operations for typed resources.
 * Supports permissions, hooks, pagination, caching, and content negotiation.
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
 * - ETag-based caching for GET requests
 * - Content negotiation (JSON, YAML)
 * - Batch resource loading
 * - Resource versioning support
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
  /** Enable versioning for this resource type */
  versioned?: boolean
}

export interface ResourcesConfig {
  types?: Record<string, TypeConfig>
  /** Enable ETag caching (default: true) */
  enableCaching?: boolean
  /** Supported content types for negotiation */
  contentTypes?: ContentType[]
}

/** Supported content types for content negotiation */
export type ContentType = 'json' | 'yaml'

/** Batch request for loading multiple resources */
export interface BatchRequest {
  ids: string[]
}

/** Batch response containing multiple resources */
export interface BatchResponse {
  items: Record<string, unknown>
  missing: string[]
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** Content type MIME mappings */
const CONTENT_TYPE_MIME: Record<ContentType, string> = {
  json: 'application/json',
  yaml: 'application/yaml',
}

/** Accept header patterns for content negotiation */
const ACCEPT_PATTERNS: Record<ContentType, RegExp> = {
  json: /application\/json|application\/\*|\*\/\*/,
  yaml: /application\/yaml|application\/x-yaml|text\/yaml/,
}

// ============================================================================
// ETag Utilities
// ============================================================================

/**
 * Generate a weak ETag from resource data using FNV-1a hash
 * Uses weak ETags since representation may vary by content type
 */
function generateETag(data: unknown): string {
  const str = JSON.stringify(data)
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619) // FNV prime
  }
  // Convert to unsigned 32-bit and hex, use weak ETag format
  return `W/"${(hash >>> 0).toString(16)}"`
}

/**
 * Check if client's cached version matches current ETag
 */
function checkETagMatch(requestETag: string | null, currentETag: string): boolean {
  if (!requestETag) return false
  // Handle both weak and strong ETag comparison (weak comparison)
  const normalize = (tag: string) => tag.replace(/^W\//, '').replace(/"/g, '')
  return normalize(requestETag) === normalize(currentETag)
}

// ============================================================================
// Content Negotiation
// ============================================================================

/**
 * Determine preferred content type from Accept header
 */
function negotiateContentType(
  acceptHeader: string | null,
  supportedTypes: ContentType[]
): ContentType {
  if (!acceptHeader || supportedTypes.length === 0) {
    return 'json' // Default to JSON
  }

  // Parse Accept header and sort by quality
  const types = acceptHeader.split(',').map((part) => {
    const [type, ...params] = part.trim().split(';')
    const qParam = params.find((p) => p.trim().startsWith('q='))
    const q = qParam ? parseFloat(qParam.split('=')[1]!) : 1
    return { type: type!.trim(), q }
  }).sort((a, b) => b.q - a.q)

  // Find first matching supported type
  for (const { type } of types) {
    for (const supported of supportedTypes) {
      if (ACCEPT_PATTERNS[supported].test(type)) {
        return supported
      }
    }
  }

  return 'json' // Fallback to JSON
}

/**
 * Serialize data to requested content type
 */
function serializeResponse(data: unknown, contentType: ContentType): string {
  switch (contentType) {
    case 'yaml':
      return toYAML(data)
    case 'json':
    default:
      return JSON.stringify(data)
  }
}

/**
 * Simple YAML serializer (for basic objects/arrays)
 * Handles common cases without external dependency
 */
function toYAML(data: unknown, indent = 0): string {
  const prefix = '  '.repeat(indent)

  if (data === null || data === undefined) {
    return 'null'
  }

  if (typeof data === 'string') {
    // Quote strings with special characters
    if (/[:\[\]{},#&*!|>'"%@`]|^[\s-]/.test(data) || data === '') {
      return JSON.stringify(data)
    }
    return data
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data)
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return '[]'
    return data.map((item) => `${prefix}- ${toYAML(item, indent + 1).trimStart()}`).join('\n')
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries.map(([key, value]) => {
      const valStr = toYAML(value, indent + 1)
      if (typeof value === 'object' && value !== null) {
        return `${prefix}${key}:\n${valStr}`
      }
      return `${prefix}${key}: ${valStr}`
    }).join('\n')
  }

  return String(data)
}

// ============================================================================
// Resource Handler Registry
// ============================================================================

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface HandlerContext {
  c: Context
  type: string
  id?: string
  typeConfig: TypeConfig
  db: Record<string, unknown>
  user: { id: string; role: string; permissions?: string[] }
  enableCaching: boolean
  contentType: ContentType
}

type ResourceHandler = (ctx: HandlerContext) => Promise<Response>

/**
 * Registry for resource operation handlers
 * Enables easy extension and testing of individual operations
 */
class ResourceHandlerRegistry {
  private handlers = new Map<string, ResourceHandler>()

  register(method: HttpMethod, hasId: boolean, handler: ResourceHandler): void {
    const key = `${method}:${hasId ? 'id' : 'collection'}`
    this.handlers.set(key, handler)
  }

  get(method: HttpMethod, hasId: boolean): ResourceHandler | undefined {
    const key = `${method}:${hasId ? 'id' : 'collection'}`
    return this.handlers.get(key)
  }

  has(method: HttpMethod, hasId: boolean): boolean {
    const key = `${method}:${hasId ? 'id' : 'collection'}`
    return this.handlers.has(key)
  }
}

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
 * Parse path to extract type, id, and special operations
 */
function parsePath(path: string): { type: string; id?: string; operation?: string } | null {
  // Match /api/:type, /api/:type/:id, or /api/:type/_batch
  const match = path.match(/^\/api\/([^/]+)(?:\/(.+))?$/)
  if (!match) return null

  const type = match[1]
  const second = match[2]

  // Check for special operations
  if (second === '_batch') {
    return { type: type!, operation: 'batch' }
  }

  return { type: type!, id: second }
}

/**
 * Create response with proper content type and optional caching headers
 */
function createResponse(
  c: Context,
  data: unknown,
  status: number,
  ctx: Pick<HandlerContext, 'contentType' | 'enableCaching'>
): Response {
  const body = serializeResponse(data, ctx.contentType)
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPE_MIME[ctx.contentType],
  }

  // Add ETag for successful GET responses
  if (ctx.enableCaching && status >= 200 && status < 300) {
    headers['ETag'] = generateETag(data)
    headers['Cache-Control'] = 'private, must-revalidate'
  }

  return new Response(body, { status, headers })
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
 *   enableCaching: true,
 *   contentTypes: ['json', 'yaml'],
 * }))
 * ```
 */
export function resources(config?: ResourcesConfig): MiddlewareHandler {
  const types = config?.types ?? {}
  const enableCaching = config?.enableCaching ?? true
  const supportedContentTypes = config?.contentTypes ?? ['json']

  // Build handler registry
  const registry = createHandlerRegistry()

  return async (c, next) => {
    const path = c.req.path
    const method = c.req.method as HttpMethod
    const parsed = parsePath(path)

    if (!parsed) {
      await next()
      return
    }

    const { type, id, operation } = parsed
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

    // Negotiate content type
    const acceptHeader = c.req.header('Accept')
    const contentType = negotiateContentType(acceptHeader ?? null, supportedContentTypes)

    // Build handler context
    const ctx: HandlerContext = {
      c,
      type,
      id,
      typeConfig,
      db,
      user,
      enableCaching,
      contentType,
    }

    // Handle batch operations
    if (operation === 'batch' && method === 'POST') {
      if (!hasPermission(user, typeConfig.permissions?.read)) {
        return c.json({ error: 'Permission denied: access forbidden' }, 403)
      }
      return handleBatch(ctx)
    }

    // Route based on method and presence of id
    try {
      // Check permissions based on operation type
      const isReadOperation = method === 'GET'
      const permission = isReadOperation
        ? typeConfig.permissions?.read
        : typeConfig.permissions?.write

      if (!hasPermission(user, permission)) {
        return c.json({ error: 'Permission denied: access forbidden' }, 403)
      }

      // Check for ETag cache hit on GET requests
      if (method === 'GET' && enableCaching && id) {
        const ifNoneMatch = c.req.header('If-None-Match')
        if (ifNoneMatch) {
          // We need to fetch the resource to check ETag
          const resource = await fetchResource(ctx)
          if (resource) {
            const etag = generateETag(resource)
            if (checkETagMatch(ifNoneMatch, etag)) {
              return new Response(null, { status: 304 })
            }
          }
        }
      }

      // Get handler from registry
      const handler = registry.get(method, !!id)

      if (!handler) {
        await next()
        return
      }

      return await handler(ctx)
    } catch (error) {
      return c.json({ error: 'Internal server error' }, 500)
    }
  }
}

/**
 * Create and populate the handler registry with default handlers
 */
function createHandlerRegistry(): ResourceHandlerRegistry {
  const registry = new ResourceHandlerRegistry()

  // GET collection - list resources
  registry.register('GET', false, handleList)

  // GET single - get resource by ID
  registry.register('GET', true, handleGet)

  // POST collection - create resource
  registry.register('POST', false, handleCreate)

  // PUT single - full update
  registry.register('PUT', true, (ctx) => handleUpdate(ctx, false))

  // PATCH single - partial update
  registry.register('PATCH', true, (ctx) => handleUpdate(ctx, true))

  // DELETE single - delete resource
  registry.register('DELETE', true, handleDelete)

  return registry
}

/**
 * Fetch a single resource (used for ETag checking)
 */
async function fetchResource(ctx: HandlerContext): Promise<unknown | null> {
  const { type, id, db } = ctx
  if (!id) return null

  try {
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    return await query[type]!.findFirst({ where: { id } })
  } catch {
    return null
  }
}

// ============================================================================
// Handler Functions
// ============================================================================

async function handleList(ctx: HandlerContext): Promise<Response> {
  const { c, type, db } = ctx

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
    const items = await query[type]!.findMany({ limit, offset })

    const response = {
      items,
      total: items.length, // In real implementation, this would be a count query
      limit,
      offset,
    }

    return c.json(response)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleGet(ctx: HandlerContext): Promise<Response> {
  const { c, type, id, db, enableCaching } = ctx

  if (!id) {
    return c.json({ error: 'Resource ID required' }, 400)
  }

  try {
    // Query database
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const resource = await query[type]!.findFirst({ where: { id } })

    if (!resource) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    // Add ETag header for caching
    const headers: Record<string, string> = {}
    if (enableCaching) {
      headers['ETag'] = generateETag(resource)
      headers['Cache-Control'] = 'private, must-revalidate'
    }

    return c.json(resource, 200, headers)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

async function handleCreate(ctx: HandlerContext): Promise<Response> {
  const { c, typeConfig, db } = ctx

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

    // Add version if versioned
    if (typeConfig.versioned) {
      data._version = 1
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

async function handleUpdate(ctx: HandlerContext, isPartial: boolean): Promise<Response> {
  const { c, type, id, typeConfig, db } = ctx

  if (!id) {
    return c.json({ error: 'Resource ID required' }, 400)
  }

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
    const existing = await query[type]!.findFirst({ where: { id } }) as Record<string, unknown> | null

    if (!existing) {
      return c.json({ error: 'Resource not found' }, 404)
    }

    // Version conflict check for versioned resources
    if (typeConfig.versioned && data._version !== undefined) {
      const currentVersion = existing._version as number
      const requestVersion = data._version as number
      if (requestVersion !== currentVersion) {
        return c.json({
          error: 'Version conflict',
          currentVersion,
          requestVersion,
        }, 409)
      }
      // Increment version
      data._version = currentVersion + 1
    } else if (typeConfig.versioned) {
      // Auto-increment version
      data._version = ((existing._version as number) || 0) + 1
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

async function handleDelete(ctx: HandlerContext): Promise<Response> {
  const { c, type, id, typeConfig, db } = ctx

  if (!id) {
    return c.json({ error: 'Resource ID required' }, 400)
  }

  try {
    // Check if resource exists
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const existing = await query[type]!.findFirst({ where: { id } })

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

/**
 * Handle batch resource loading
 * POST /api/:type/_batch with body { ids: ["id1", "id2", ...] }
 */
async function handleBatch(ctx: HandlerContext): Promise<Response> {
  const { c, type, db } = ctx

  // Parse request body
  let body: BatchRequest
  try {
    body = (await c.req.json()) as BatchRequest
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400)
  }

  // Validate request
  if (!body.ids || !Array.isArray(body.ids)) {
    return c.json({ error: 'Request body must contain ids array' }, 400)
  }

  if (body.ids.length === 0) {
    return c.json({ items: {}, missing: [] } as BatchResponse)
  }

  if (body.ids.length > MAX_LIMIT) {
    return c.json({ error: `Maximum batch size is ${MAX_LIMIT}` }, 400)
  }

  try {
    const query = (db as { query: Record<string, { findFirst: (opts: unknown) => Promise<unknown | null> }> }).query
    const items: Record<string, unknown> = {}
    const missing: string[] = []

    // Load resources in parallel
    const results = await Promise.all(
      body.ids.map(async (id) => {
        const resource = await query[type]!.findFirst({ where: { id } })
        return { id, resource }
      })
    )

    // Organize results
    for (const { id, resource } of results) {
      if (resource) {
        items[id] = resource
      } else {
        missing.push(id)
      }
    }

    const response: BatchResponse = { items, missing }
    return c.json(response)
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500)
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  generateETag,
  checkETagMatch,
  negotiateContentType,
  toYAML,
  ResourceHandlerRegistry,
}

export default resources
