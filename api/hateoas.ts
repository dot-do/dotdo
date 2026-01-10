/**
 * HATEOAS Response Wrapper
 *
 * Implements apis.vin-style self-documenting, clickable REST APIs.
 * Wraps DO responses with navigation links, discoverable endpoints,
 * and action descriptors.
 */

import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * API metadata section
 */
export interface APIInfo {
  /** Name of the API or DO instance */
  name?: string
  /** API version */
  version?: string
  /** Fully qualified URL of the DO namespace */
  $context: string
  /** Collection name (simple string, NOT a URL) */
  $type?: string
  /** Instance identifier */
  $id?: string
}

/**
 * Action descriptor for mutating operations
 */
export interface ActionDescriptor {
  /** HTTP method for this action */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Endpoint URL (relative or absolute) */
  href: string
  /** Form fields for POST/PUT actions (can be simple strings or full descriptors) */
  fields?: Array<string | { name: string; type: string; required?: boolean }>
  /** Whether the URL is a template (e.g., has {query} placeholders) */
  templated?: boolean
  /** Protocol hint for non-HTTP actions */
  protocol?: 'websocket' | 'sse'
}

/**
 * User/request context
 */
export interface UserContext {
  /** Whether the user is authenticated */
  authenticated: boolean
  /** User ID if authenticated */
  id?: string
  /** User email if authenticated */
  email?: string
  /** User roles/permissions */
  roles?: string[]
  /** Client IP address */
  ip?: string
  /** Request latency in ms */
  latency?: number
}

/**
 * Full HATEOAS response structure (apis.vin-style)
 */
export interface HATEOASResponse<T = unknown> {
  /** API metadata */
  api: APIInfo
  /** Navigation links */
  links: Record<string, string>
  /** Discoverable endpoints (built-in collections) */
  discover?: Record<string, string>
  /** Dynamic noun collections from registered $types */
  collections?: Record<string, string>
  /** Schema tables (better-auth, drizzle) */
  schema?: Record<string, string>
  /** Available actions on this resource */
  actions?: Record<string, ActionDescriptor>
  /** Relationship navigation (for instance responses) */
  relationships?: Record<string, string>
  /** Available verbs for this noun type */
  verbs?: string[]
  /** The actual response data */
  data: T
  /** User/request context */
  user?: UserContext
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const ActionDescriptorSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  href: z.string(),
  fields: z.array(z.union([
    z.string(),
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean().optional(),
    }),
  ])).optional(),
  templated: z.boolean().optional(),
  protocol: z.enum(['websocket', 'sse']).optional(),
})

export const UserContextSchema = z.object({
  authenticated: z.boolean(),
  id: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.string()).optional(),
  ip: z.string().optional(),
  latency: z.number().optional(),
})

export const APIInfoSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  $context: z.string().url(),
  $type: z.string().optional(),
  $id: z.string().optional(),
})

export const HATEOASResponseSchema = z.object({
  api: APIInfoSchema,
  links: z.record(z.string()),
  discover: z.record(z.string()).optional(),
  collections: z.record(z.string()).optional(),
  schema: z.record(z.string()).optional(),
  actions: z.record(ActionDescriptorSchema).optional(),
  relationships: z.record(z.string()).optional(),
  verbs: z.array(z.string()).optional(),
  data: z.unknown(),
  user: UserContextSchema.optional(),
})

// ============================================================================
// Constants
// ============================================================================

/** Built-in collections that are always discoverable */
const BUILT_IN_COLLECTIONS = [
  'things',
  'actions',
  'events',
  'functions',
  'workflows',
  'agents',
  'site',
  'app',
  'docs',
] as const

// ============================================================================
// Options Interfaces
// ============================================================================

export interface WrapOptions {
  $context: string
  $type?: string
  $id?: string
  request?: Request
}

export interface RootOptions {
  $context: string
  name?: string
  version?: string
  nouns?: string[]
  schemaTables?: string[]
  request?: Request
}

export interface CollectionOptions {
  $context: string
  $type: string
  verbs?: string[]
  request?: Request
}

export interface InstanceOptions {
  $context: string
  $type: string
  $id: string
  verbs?: string[]
  relationships?: Record<string, string>
  request?: Request
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates that $context is a valid URL
 */
function validateContext(context: string): void {
  if (!context) {
    throw new Error('$context is required')
  }
  try {
    new URL(context)
  } catch {
    throw new Error('$context must be a valid URL')
  }
}

/**
 * Extracts user context from a request
 */
function extractUserContext(request?: Request): UserContext | undefined {
  if (!request) {
    return undefined
  }

  const startTime = Date.now()
  const hasAuth = request.headers.has('Authorization')
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For') ||
             request.headers.get('X-Real-IP') ||
             undefined

  return {
    authenticated: hasAuth,
    ip,
    latency: Date.now() - startTime,
  }
}

/**
 * Generates discover section with built-in collections
 */
function generateBuiltInDiscover(): Record<string, string> {
  const discover: Record<string, string> = {}
  for (const collection of BUILT_IN_COLLECTIONS) {
    discover[collection] = `/${collection}/`
  }
  return discover
}

/**
 * Generates collections section from noun list
 */
function generateCollections(nouns?: string[]): Record<string, string> | undefined {
  if (!nouns || nouns.length === 0) {
    return undefined
  }
  const collections: Record<string, string> = {}
  for (const noun of nouns) {
    collections[noun] = `/${noun}/`
  }
  return collections
}

/**
 * Generates schema section from table list
 */
function generateSchema(tables?: string[]): Record<string, string> | undefined {
  if (!tables || tables.length === 0) {
    return undefined
  }
  const schema: Record<string, string> = {}
  for (const table of tables) {
    schema[table] = `/${table}/`
  }
  return schema
}

/**
 * Generates verb actions for an instance
 */
function generateVerbActions(verbs?: string[]): Record<string, ActionDescriptor> {
  const actions: Record<string, ActionDescriptor> = {}
  if (verbs) {
    for (const verb of verbs) {
      actions[verb] = {
        method: 'POST',
        href: `./${verb}`,
      }
    }
  }
  return actions
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Wrap any data with HATEOAS envelope
 */
export function wrapResponse<T>(data: T, options: WrapOptions): HATEOASResponse<T> {
  validateContext(options.$context)

  const api: APIInfo = {
    $context: options.$context,
  }

  if (options.$type) {
    api.$type = options.$type
  }

  if (options.$id) {
    api.$id = options.$id
  }

  // Build self link based on what we have
  let selfLink = '/'
  if (options.$type) {
    selfLink = `/${options.$type}/`
    if (options.$id) {
      selfLink = `/${options.$type}/${options.$id}`
    }
  }

  const response: HATEOASResponse<T> = {
    api,
    links: {
      self: selfLink,
      home: '/',
    },
    data,
  }

  // Add user context if request is provided
  const user = extractUserContext(options.request)
  if (user) {
    response.user = user
  }

  return response
}

/**
 * Create root discovery response (GET /)
 */
export function createRootResponse(options: RootOptions): HATEOASResponse<null> {
  validateContext(options.$context)

  const api: APIInfo = {
    $context: options.$context,
  }

  if (options.name) {
    api.name = options.name
  }

  if (options.version) {
    api.version = options.version
  }

  const response: HATEOASResponse<null> = {
    api,
    links: {
      self: '/',
      home: '/',
    },
    discover: generateBuiltInDiscover(),
    actions: {
      rpc: {
        method: 'POST',
        href: '/rpc',
      },
      mcp: {
        method: 'POST',
        href: '/mcp',
      },
      sync: {
        method: 'GET',
        href: '/sync',
        protocol: 'websocket',
      },
    },
    data: null,
  }

  // Add collections from nouns
  const collections = generateCollections(options.nouns)
  if (collections) {
    response.collections = collections
  }

  // Add schema tables
  const schema = generateSchema(options.schemaTables)
  if (schema) {
    response.schema = schema
  }

  // Add user context if request is provided
  const user = extractUserContext(options.request)
  if (user) {
    response.user = user
  }

  return response
}

/**
 * Create collection response (GET /:noun/)
 */
export function createCollectionResponse<T extends { $id?: string }>(
  items: T[],
  options: CollectionOptions
): HATEOASResponse<T[]> {
  validateContext(options.$context)

  const api: APIInfo = {
    $context: options.$context,
    $type: options.$type,
  }

  // Generate discover section from items
  const discover: Record<string, string> = {}
  for (const item of items) {
    if (item.$id) {
      discover[item.$id] = `/${options.$type}/${item.$id}`
    }
  }

  const response: HATEOASResponse<T[]> = {
    api,
    links: {
      self: `/${options.$type}/`,
      home: '/',
    },
    discover,
    actions: {
      create: {
        method: 'POST',
        href: './',
        fields: ['name', 'data'],
      },
      search: {
        method: 'GET',
        href: './?q={query}',
        templated: true,
      },
    },
    data: items,
  }

  // Add verbs if provided
  if (options.verbs && options.verbs.length > 0) {
    response.verbs = options.verbs
  }

  // Add user context if request is provided
  const user = extractUserContext(options.request)
  if (user) {
    response.user = user
  }

  return response
}

/**
 * Create instance response (GET /:noun/:id)
 */
export function createInstanceResponse<T>(
  item: T,
  options: InstanceOptions
): HATEOASResponse<T> {
  validateContext(options.$context)

  const api: APIInfo = {
    $context: options.$context,
    $type: options.$type,
    $id: options.$id,
  }

  // Build actions with CRUD operations
  const actions: Record<string, ActionDescriptor> = {
    update: {
      method: 'PUT',
      href: './',
    },
    delete: {
      method: 'DELETE',
      href: './',
    },
    ...generateVerbActions(options.verbs),
  }

  const response: HATEOASResponse<T> = {
    api,
    links: {
      self: `/${options.$type}/${options.$id}`,
      collection: `/${options.$type}/`,
      home: '/',
    },
    actions,
    data: item,
  }

  // Add relationships if provided
  if (options.relationships) {
    response.relationships = options.relationships
  }

  // Add user context if request is provided
  const user = extractUserContext(options.request)
  if (user) {
    response.user = user
  }

  return response
}
