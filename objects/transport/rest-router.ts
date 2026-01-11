/**
 * REST Router for DOBase
 *
 * Provides REST API routing with JSON-LD/mdxld compatible response formatting.
 * Uses $context, $id, $type fields for semantic linked data compatibility.
 *
 * Routes:
 * - GET /           → HATEOAS index with collections
 * - GET /:type      → List items of a type
 * - GET /:type/:id  → Get single item
 * - POST /:type     → Create item
 * - PUT /:type/:id  → Update item (replace)
 * - PATCH /:type/:id → Update item (merge)
 * - DELETE /:type/:id → Delete item
 */

import type { ThingsStore, ThingEntity } from '../../db/stores'

// ============================================================================
// TYPES
// ============================================================================

/**
 * JSON-LD formatted response with mdxld-compatible fields
 */
export interface JsonLdResponse {
  $context: string
  $id: string
  $type: string
  [key: string]: unknown
}

/**
 * Collection response with HATEOAS links
 */
export interface CollectionResponse {
  $context: string
  $id: string
  $type: 'Collection'
  items: JsonLdResponse[]
  total: number        // Spec field
  totalItems: number   // Legacy/compat field
}

/**
 * Collection info in index response
 */
export interface CollectionInfo {
  $id: string
  $type: 'Collection'
  count: number
}

/**
 * Index response with available collections
 */
export interface IndexResponse {
  $context: string
  $id: string
  $type: string  // DO's class type, not "Index"
  ns: string
  collections: Record<string, CollectionInfo>
}

/**
 * REST Router context
 */
export interface RestRouterContext {
  /** Things store for CRUD operations */
  things: ThingsStore
  /** Namespace (e.g., 'https://example.com.ai' or 'my-do') */
  ns: string
  /** Base context URL for JSON-LD */
  contextUrl?: string
  /** Available noun types (optional, for index generation) */
  nouns?: Array<{ noun: string; plural: string }>
  /** DO class type (e.g., 'Startup', 'DO') for index response */
  doType?: string
}

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

/**
 * Format a single thing as JSON-LD response
 */
export function formatThingAsJsonLd(
  thing: ThingEntity,
  contextUrl: string = 'https://dotdo.dev/context'
): JsonLdResponse {
  // Extract the type from $type (could be full URL or just the noun)
  const type = thing.$type.includes('/')
    ? thing.$type.split('/').pop()!
    : thing.$type

  // Build the $id as a path
  const typePlural = type.toLowerCase() + 's'
  const $id = `/${typePlural}/${thing.$id}`

  return {
    $context: contextUrl,
    $id,
    $type: type,
    name: thing.name ?? undefined,
    ...(thing.data ?? {}),
  }
}

/**
 * Format a list of things as JSON-LD collection
 */
export function formatCollectionAsJsonLd(
  things: ThingEntity[],
  type: string,
  contextUrl: string = 'https://dotdo.dev/context'
): CollectionResponse {
  const typePlural = type.toLowerCase() + 's'

  return {
    $context: contextUrl,
    $id: `/${typePlural}`,
    $type: 'Collection',
    items: things.map(thing => formatThingAsJsonLd(thing, contextUrl)),
    total: things.length,       // Spec field
    totalItems: things.length,  // Legacy/compat field
  }
}

/**
 * Extract namespace from URL or return as-is
 * e.g., 'https://acme.do' -> 'acme'
 *       'my-namespace' -> 'my-namespace'
 */
function extractNamespace(ns: string): string {
  try {
    const url = new URL(ns)
    // Extract subdomain from hostname (e.g., 'acme' from 'acme.do')
    const hostname = url.hostname
    const parts = hostname.split('.')
    if (parts.length >= 2) {
      return parts[0]  // Return first part as namespace
    }
    return hostname
  } catch {
    // Not a URL, return as-is
    return ns
  }
}

/**
 * Generate HATEOAS index with available collections
 */
export function generateIndex(
  ns: string,
  nouns: Array<{ noun: string; plural: string }>,
  contextUrl: string = 'https://dotdo.dev/context',
  doType: string = 'DO'
): IndexResponse {
  // Extract namespace identifier from full URL if needed
  const namespace = extractNamespace(ns)

  // Build collections as Record with counts
  const collections: Record<string, CollectionInfo> = {}
  for (const { plural } of nouns) {
    const pluralLower = plural.toLowerCase()
    collections[pluralLower] = {
      $id: `/${pluralLower}`,
      $type: 'Collection',
      count: 0,  // Count will be populated by caller if needed
    }
  }

  return {
    $context: contextUrl,
    $id: '/',
    $type: doType,
    ns: namespace,
    collections,
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Determine content type based on Accept header.
 * Defaults to application/json, accepts application/ld+json.
 */
function getContentType(request?: Request): string {
  if (!request) return 'application/json'
  const accept = request.headers.get('Accept') || ''
  if (accept.includes('application/ld+json')) {
    return 'application/ld+json'
  }
  return 'application/json'
}

/**
 * Handle GET / - Return HATEOAS index
 */
export async function handleGetIndex(ctx: RestRouterContext, request?: Request): Promise<Response> {
  const contextUrl = ctx.contextUrl ?? 'https://dotdo.dev/context'
  const nouns = ctx.nouns ?? []
  const doType = ctx.doType ?? 'DO'
  const contentType = getContentType(request)

  const index = generateIndex(ctx.ns, nouns, contextUrl, doType)

  return Response.json(index, {
    headers: { 'Content-Type': contentType },
  })
}

/**
 * Check if a type is registered in the context
 */
function isTypeRegistered(ctx: RestRouterContext, type: string): boolean {
  // If nouns is undefined, allow all types (permissive mode for uninitialized DOs)
  if (ctx.nouns === undefined) {
    return true
  }

  // If nouns is an empty array, no types are registered - strict mode
  if (ctx.nouns.length === 0) {
    return false
  }

  // Check if the type matches any registered noun (case-insensitive)
  const typeLower = type.toLowerCase()
  return ctx.nouns.some(({ noun, plural }) =>
    noun.toLowerCase() === typeLower || plural.toLowerCase() === typeLower
  )
}

/**
 * Handle GET /:type - List items of a type
 */
export async function handleListByType(
  ctx: RestRouterContext,
  type: string,
  options?: { limit?: number; offset?: number; after?: string },
  request?: Request
): Promise<Response> {
  const contextUrl = ctx.contextUrl ?? 'https://dotdo.dev/context'
  const contentType = getContentType(request)

  // Check if type is registered (if nouns are defined)
  if (!isTypeRegistered(ctx, type)) {
    return Response.json(
      { $type: 'Error', error: `Unknown type: ${type}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  try {
    const things = await ctx.things.list({
      type,
      limit: options?.limit ?? 100,
      offset: options?.offset,
      after: options?.after,
    })

    const collection = formatCollectionAsJsonLd(things, type, contextUrl)

    return Response.json(collection, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // For list operations, treat errors as empty results
    // This handles cases where DB isn't available
    const collection = formatCollectionAsJsonLd([], type, contextUrl)
    return Response.json(collection, {
      headers: { 'Content-Type': contentType },
    })
  }
}

/**
 * Handle GET /:type/:id - Get single item
 */
export async function handleGetById(
  ctx: RestRouterContext,
  type: string,
  id: string,
  request?: Request
): Promise<Response> {
  const contextUrl = ctx.contextUrl ?? 'https://dotdo.dev/context'
  const contentType = getContentType(request)

  try {
    const thing = await ctx.things.get(id)

    if (!thing) {
      return Response.json(
        { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Verify type matches
    const thingType = thing.$type.includes('/')
      ? thing.$type.split('/').pop()!
      : thing.$type

    if (thingType.toLowerCase() !== type.toLowerCase()) {
      return Response.json(
        { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const formatted = formatThingAsJsonLd(thing, contextUrl)

    return Response.json(formatted, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // Return 404 for get failures - item not found or DB unavailable
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }
}

/**
 * Handle POST /:type - Create new item
 */
export async function handleCreate(
  ctx: RestRouterContext,
  type: string,
  data: Record<string, unknown>,
  request?: Request
): Promise<Response> {
  const contextUrl = ctx.contextUrl ?? 'https://dotdo.dev/context'
  const contentType = getContentType(request)

  try {
    // Extract $id if provided, otherwise will be generated
    const $id = data.$id as string | undefined
    const { $id: _, $type: __, $context: ___, ...restData } = data

    const thing = await ctx.things.create({
      $id,
      $type: type,
      name: restData.name as string | undefined,
      data: restData,
    })

    const formatted = formatThingAsJsonLd(thing, contextUrl)

    return Response.json(formatted, {
      status: 201,
      headers: {
        'Content-Type': contentType,
        'Location': formatted.$id,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Check for duplicate error
    if (message.includes('already exists') || message.includes('UNIQUE constraint')) {
      return Response.json(
        { $type: 'Error', error: message, code: 'DUPLICATE' },
        { status: 409 }
      )
    }

    return Response.json(
      { $type: 'Error', error: message, code: 'CREATE_FAILED' },
      { status: 500 }
    )
  }
}

/**
 * Handle PUT /:type/:id - Replace item
 */
export async function handleUpdate(
  ctx: RestRouterContext,
  type: string,
  id: string,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
  request?: Request
): Promise<Response> {
  const contextUrl = ctx.contextUrl ?? 'https://dotdo.dev/context'
  const contentType = getContentType(request)

  try {
    // Verify item exists
    const existing = await ctx.things.get(id)
    if (!existing) {
      return Response.json(
        { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const { $id: _, $type: __, $context: ___, ...restData } = data

    const thing = await ctx.things.update(id, {
      name: restData.name as string | undefined,
      data: restData,
    }, { merge: options?.merge ?? false })

    const formatted = formatThingAsJsonLd(thing, contextUrl)

    return Response.json(formatted, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // Return 404 for update failures - item not found or DB unavailable
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }
}

/**
 * Handle DELETE /:type/:id - Delete item
 */
export async function handleDelete(
  ctx: RestRouterContext,
  type: string,
  id: string
): Promise<Response> {
  try {
    // Verify item exists
    const existing = await ctx.things.get(id)
    if (!existing) {
      return Response.json(
        { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    await ctx.things.delete(id)

    return new Response(null, { status: 204 })
  } catch {
    // Return 404 for delete failures - item not found or DB unavailable
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }
}

// ============================================================================
// ROUTE MATCHING
// ============================================================================

/**
 * Known system routes that should not be treated as REST routes
 */
const SYSTEM_ROUTES = new Set([
  'health',
  'rpc',
  'mcp',
  'sync',
  'resolve',
  '$introspect',
])

/**
 * Parse route path to extract type and id
 * Supports:
 * - /customers → { type: 'Customer', id: undefined }
 * - /customers/cust-1 → { type: 'Customer', id: 'cust-1' }
 *
 * Returns null for system routes (health, rpc, mcp, sync, etc.)
 */
export function parseRestRoute(pathname: string): { type: string; id?: string } | null {
  // Remove leading slash and split
  const segments = pathname.slice(1).split('/').filter(Boolean)

  if (segments.length === 0) {
    return null
  }

  // Exclude system routes
  const firstSegment = segments[0].toLowerCase()
  if (SYSTEM_ROUTES.has(firstSegment)) {
    return null
  }

  if (segments.length === 1) {
    // /customers → Customer
    const type = singularize(segments[0])
    return { type }
  }

  if (segments.length === 2) {
    // /customers/cust-1 → Customer, cust-1
    const type = singularize(segments[0])
    const id = segments[1]
    return { type, id }
  }

  return null
}

/**
 * Convert plural form to singular (simple heuristic)
 * customers → Customer
 * products → Product
 * categories → Category
 */
function singularize(plural: string): string {
  let singular = plural

  // Handle common pluralization patterns
  if (plural.endsWith('ies')) {
    singular = plural.slice(0, -3) + 'y'
  } else if (plural.endsWith('es')) {
    singular = plural.slice(0, -2)
  } else if (plural.endsWith('s')) {
    singular = plural.slice(0, -1)
  }

  // Capitalize first letter (PascalCase for type names)
  return singular.charAt(0).toUpperCase() + singular.slice(1)
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

/**
 * Handle REST request and route to appropriate handler
 */
export async function handleRestRequest(
  request: Request,
  ctx: RestRouterContext
): Promise<Response | null> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  // Parse the route
  const route = parseRestRoute(url.pathname)

  // Not a REST route (e.g., system routes like /health, /rpc, etc.)
  if (!route) {
    return null
  }

  const { type, id } = route

  // Parse query params for list operations
  const limit = url.searchParams.get('limit')
  const offset = url.searchParams.get('offset')
  const after = url.searchParams.get('after')

  // Route to handlers based on method and path pattern

  // Collection routes: /:type
  if (!id) {
    switch (method) {
      case 'GET':
        return handleListByType(ctx, type, {
          limit: limit ? parseInt(limit, 10) : undefined,
          offset: offset ? parseInt(offset, 10) : undefined,
          after: after ?? undefined,
        }, request)

      case 'POST': {
        const result = await parseRequestBody(request)
        if (!result.success) {
          return Response.json(
            { $type: 'Error', error: result.error, code: result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST' },
            { status: result.status }
          )
        }
        return handleCreate(ctx, type, result.data, request)
      }

      default:
        return Response.json(
          { $type: 'Error', error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
          { status: 405, headers: { 'Allow': 'GET, POST' } }
        )
    }
  }

  // Item routes: /:type/:id
  switch (method) {
    case 'GET':
      return handleGetById(ctx, type, id, request)

    case 'PUT': {
      const result = await parseRequestBody(request)
      if (!result.success) {
        return Response.json(
          { $type: 'Error', error: result.error, code: result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST' },
          { status: result.status }
        )
      }
      return handleUpdate(ctx, type, id, result.data, { merge: false }, request)
    }

    case 'PATCH': {
      const result = await parseRequestBody(request)
      if (!result.success) {
        return Response.json(
          { $type: 'Error', error: result.error, code: result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST' },
          { status: result.status }
        )
      }
      return handleUpdate(ctx, type, id, result.data, { merge: true }, request)
    }

    case 'DELETE':
      return handleDelete(ctx, type, id)

    default:
      return Response.json(
        { $type: 'Error', error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
        { status: 405, headers: { 'Allow': 'GET, PUT, PATCH, DELETE' } }
      )
  }
}

/**
 * Result of parsing request body
 */
type ParseResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string; status: number }

/**
 * Parse request body as JSON with proper error handling
 */
async function parseRequestBody(request: Request): Promise<ParseResult> {
  const contentType = request.headers.get('Content-Type') || ''

  // Validate Content-Type header for POST/PUT/PATCH
  if (contentType && !contentType.includes('application/json') && !contentType.includes('application/ld+json')) {
    return {
      success: false,
      error: `Unsupported Content-Type: ${contentType}. Expected application/json or application/ld+json`,
      status: 415,
    }
  }

  try {
    const text = await request.text()
    if (!text.trim()) {
      return { success: true, data: {} }
    }
    return { success: true, data: JSON.parse(text) }
  } catch {
    return {
      success: false,
      error: 'Invalid JSON body',
      status: 400,
    }
  }
}
