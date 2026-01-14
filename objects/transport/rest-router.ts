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
import { buildResponse, buildErrorResponse, type ErrorCode } from '../../lib/response/linked-data'
import { buildCollectionResponse as buildCollectionResponseShape } from '../../lib/response/collection'
import { buildItemLinks } from '../../lib/response/links'
import { buildItemActionsClickable } from '../../lib/response/actions'

// ============================================================================
// ERROR RESPONSE HELPER
// ============================================================================

/**
 * Create a JSON Response with JSON-LD formatted error
 *
 * @param code - Error code (e.g., 'NOT_FOUND', 'BAD_REQUEST')
 * @param message - Human-readable error message
 * @param status - HTTP status code
 * @param headers - Optional additional headers
 */
function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  headers?: Record<string, string>
): Response {
  return Response.json(buildErrorResponse(code, message), {
    status,
    headers,
  })
}

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
  count: number  // Total count of items (standardized field name)
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
  links: Record<string, string>
  collections: Record<string, CollectionInfo>
}

/**
 * REST Router context
 */
export interface RestRouterContext {
  /** Things store for CRUD operations */
  things: ThingsStore
  /** Namespace URL (e.g., 'https://example.com.ai') - derived from request origin */
  ns: string
  /** Parent namespace URL for root $context (e.g., 'https://Startups.Studio') */
  parent?: string
  /** Available noun types (optional, for index generation) */
  nouns?: Array<{ noun: string; plural: string }>
  /** DO class type (e.g., 'Startup', 'DO') for index response */
  doType?: string
}

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

/**
 * Format a single thing as JSON-LD response with full linked data shape
 * Includes $context, $type, $id, links, and actions
 */
export function formatThingAsJsonLd(
  thing: ThingEntity,
  ns: string,
  options?: { includeLinksActions?: boolean }
): JsonLdResponse {
  // Extract the type from $type (could be full URL or just the noun)
  const type = thing.$type.includes('/')
    ? thing.$type.split('/').pop()!
    : thing.$type

  // Build data object
  const data: Record<string, unknown> = {
    name: thing.name ?? undefined,
    ...(thing.data ?? {}),
  }

  // Use buildResponse to construct proper linked data shape
  const response = buildResponse(data, {
    ns,
    type,
    id: thing.$id,
  })

  // Add links and actions if requested (for single item GET)
  if (options?.includeLinksActions) {
    const links = buildItemLinks({ ns, type, id: thing.$id })
    const actions = buildItemActionsClickable({ ns, type, id: thing.$id })
    return {
      ...response,
      links: {
        self: response.$id,
        ...links,
      },
      actions,
    }
  }

  return response
}

/**
 * Format a list of things as JSON-LD collection with full response shape
 */
export function formatCollectionAsJsonLd(
  things: ThingEntity[],
  type: string,
  ns: string,
  options?: {
    totalCount?: number
    pagination?: {
      after?: string
      hasNext?: boolean
    }
  }
): ReturnType<typeof buildCollectionResponseShape> {
  // Transform things to items with id field required by buildCollectionResponseShape
  const items = things.map(thing => {
    const thingType = thing.$type.includes('/')
      ? thing.$type.split('/').pop()!
      : thing.$type

    return {
      id: thing.$id,
      name: thing.name ?? undefined,
      ...(thing.data ?? {}),
    }
  })

  // Use the total count if provided, otherwise use items length
  const count = options?.totalCount ?? things.length

  // Build collection response with full shape
  return buildCollectionResponseShape(items, count, {
    ns,
    type,
    pagination: options?.pagination ? {
      after: options.pagination.after,
      hasNext: options.pagination.hasNext,
    } : undefined,
  })
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
      return parts[0]!  // Return first part as namespace
    }
    return hostname
  } catch {
    // Not a URL, return as-is
    return ns
  }
}

/**
 * Generate HATEOAS index with available collections
 *
 * Root response shape:
 * - $context: parent namespace (if provided), otherwise default schema
 * - $type: ns (the namespace URL itself is the type)
 * - $id: ns (same as $type for root)
 * - links: navigation links (self, and collection links)
 * - collections: Record with collection info including counts
 */
export function generateIndex(
  ns: string,
  nouns: Array<{ noun: string; plural: string }>,
  options?: {
    parent?: string
    collectionCounts?: Record<string, number>
  }
): IndexResponse {
  // For root, $context is the parent (or default schema if no parent)
  const $context = options?.parent ?? 'https://schema.org.ai'

  // Build links - self plus links to each collection
  const links: Record<string, string> = {
    self: ns,
  }

  // Build collections as Record with counts
  const collections: Record<string, CollectionInfo> = {}
  for (const { noun, plural } of nouns) {
    const pluralLower = plural.toLowerCase()
    const collectionUrl = `${ns}/${pluralLower}`
    collections[pluralLower] = {
      $id: collectionUrl,
      $type: 'Collection',
      count: options?.collectionCounts?.[pluralLower] ?? 0,
    }
    // Also add link to the collection
    links[pluralLower] = collectionUrl
  }

  return {
    $context,
    $id: ns,
    $type: ns,
    ns: extractNamespace(ns),
    links,
    collections,
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Determine content type based on Accept header.
 * JSON only - no HTML rendering.
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
 * Derive the namespace URL from the request origin
 *
 * Uses the request URL's origin (protocol + hostname) to construct
 * consistent URLs for $context, $type, and $id fields.
 *
 * @param request - The incoming request
 * @param fallbackNs - Fallback namespace if request is unavailable
 * @returns The namespace URL (e.g., 'https://acme.do')
 */
function deriveNamespaceFromRequest(request: Request | undefined, fallbackNs: string): string {
  if (!request) {
    return fallbackNs
  }

  try {
    const url = new URL(request.url)
    return url.origin
  } catch {
    return fallbackNs
  }
}

/**
 * Handle GET / - Return HATEOAS index
 *
 * Derives namespace from request origin for consistent URL construction
 */
export async function handleGetIndex(ctx: RestRouterContext, request?: Request): Promise<Response> {
  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)
  const nouns = ctx.nouns ?? []
  const contentType = getContentType(request)

  // Get collection counts using efficient count() method if available
  const collectionCounts: Record<string, number> = {}

  // Use Promise.all for parallel counting (faster for multiple types)
  const countPromises = nouns.map(async ({ noun, plural }) => {
    try {
      // Use count() if available (more efficient), fall back to list().length
      const count = typeof ctx.things.count === 'function'
        ? await ctx.things.count({ type: noun })
        : (await ctx.things.list({ type: noun, limit: 1000 })).length
      return { plural: plural.toLowerCase(), count }
    } catch {
      return { plural: plural.toLowerCase(), count: 0 }
    }
  })

  const counts = await Promise.all(countPromises)
  for (const { plural, count } of counts) {
    collectionCounts[plural] = count
  }

  const index = generateIndex(ns, nouns, {
    parent: ctx.parent,
    collectionCounts,
  })

  return Response.json(index, {
    headers: { 'Content-Type': contentType },
  })
}

/**
 * Check if a type is valid.
 * Always returns true - permissive mode allows any type.
 * Custom types are auto-created on first insert.
 */
function isTypeRegistered(_ctx: RestRouterContext, _type: string): boolean {
  return true // Permissive mode - any type allowed
}

/**
 * Handle GET /:type - List items of a type
 *
 * Returns collection with full response shape including:
 * - $context, $type, $id
 * - count (total items)
 * - links (home, first, prev, next)
 * - actions (create)
 * - items (with full $context/$type/$id shape)
 */
export async function handleListByType(
  ctx: RestRouterContext,
  type: string,
  options?: { limit?: number; offset?: number; after?: string },
  request?: Request
): Promise<Response> {
  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)
  const contentType = getContentType(request)
  const limit = options?.limit ?? 100

  // Check if type is registered (if nouns are defined)
  if (!isTypeRegistered(ctx, type)) {
    return errorResponse('NOT_FOUND', `Unknown type: ${type}`, 404)
  }

  try {
    // Get paginated results and total count in parallel for better performance
    // Use count() method if available (more efficient than fetching all)
    const [things, totalCount] = await Promise.all([
      ctx.things.list({
        type,
        limit: limit + 1, // Fetch one extra to detect hasNext
        offset: options?.offset,
        after: options?.after,
      }),
      // Use count() if available, otherwise we'll calculate from list
      typeof ctx.things.count === 'function'
        ? ctx.things.count({ type })
        : Promise.resolve(-1), // Sentinel value to indicate count not available
    ])

    // If count() wasn't available, we need to fall back to a separate list query
    // But only if we need the count and pagination is being used
    let actualTotalCount = totalCount
    if (totalCount === -1) {
      // Fall back: count is not critical for response, use items.length as estimate
      // If there are more items (hasNext), the count is at least limit + 1
      actualTotalCount = things.length
    }

    // Determine if there are more items
    const hasNext = things.length > limit
    const paginatedThings = hasNext ? things.slice(0, limit) : things

    // Get the cursor for next page (last item's ID)
    const afterCursor = paginatedThings.length > 0
      ? paginatedThings[paginatedThings.length - 1]!.$id
      : undefined

    const collection = formatCollectionAsJsonLd(paginatedThings, type, ns, {
      totalCount: actualTotalCount,
      pagination: hasNext ? {
        after: afterCursor,
        hasNext: true,
      } : undefined,
    })

    return Response.json(collection, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // For list operations, treat errors as empty results
    // This handles cases where DB isn't available
    const collection = formatCollectionAsJsonLd([], type, ns, { totalCount: 0 })
    return Response.json(collection, {
      headers: { 'Content-Type': contentType },
    })
  }
}

/**
 * Handle GET /:type/:id - Get single item
 *
 * Returns item with full response shape including:
 * - $context, $type, $id
 * - links (self, collection, edit)
 * - actions (update, delete)
 * - item data
 */
export async function handleGetById(
  ctx: RestRouterContext,
  type: string,
  id: string,
  request?: Request
): Promise<Response> {
  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)
  const contentType = getContentType(request)

  try {
    const thing = await ctx.things.get(id)

    if (!thing) {
      return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
    }

    // Verify type matches
    const thingType = thing.$type.includes('/')
      ? thing.$type.split('/').pop()!
      : thing.$type

    if (thingType.toLowerCase() !== type.toLowerCase()) {
      return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
    }

    // Format with links and actions for GET /:type/:id
    const formatted = formatThingAsJsonLd(thing, ns, { includeLinksActions: true })

    return Response.json(formatted, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // Return 404 for get failures - item not found or DB unavailable
    return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
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
  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)
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

    // Format with links and actions for created item
    const formatted = formatThingAsJsonLd(thing, ns, { includeLinksActions: true })

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
      return errorResponse('DUPLICATE', message, 409)
    }

    return errorResponse('CREATE_FAILED', message, 500)
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
  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)
  const contentType = getContentType(request)

  try {
    // Verify item exists
    const existing = await ctx.things.get(id)
    if (!existing) {
      return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
    }

    const { $id: _, $type: __, $context: ___, ...restData } = data

    const thing = await ctx.things.update(id, {
      name: restData.name as string | undefined,
      data: restData,
    }, { merge: options?.merge ?? false })

    // Format with links and actions for updated item
    const formatted = formatThingAsJsonLd(thing, ns, { includeLinksActions: true })

    return Response.json(formatted, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    // Return 404 for update failures - item not found or DB unavailable
    return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
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
      return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
    }

    await ctx.things.delete(id)

    return new Response(null, { status: 204 })
  } catch {
    // Return 404 for delete failures - item not found or DB unavailable
    return errorResponse('NOT_FOUND', `${type} not found: ${id}`, 404)
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
 * Parsed route result with optional action
 */
export interface ParsedRoute {
  type: string
  id?: string
  action?: 'edit'
}

/**
 * Parse route path to extract type, id, and optional action
 * Supports:
 * - /customers → { type: 'Customer', id: undefined }
 * - /customers/cust-1 → { type: 'Customer', id: 'cust-1' }
 * - /customers/cust-1/edit → { type: 'Customer', id: 'cust-1', action: 'edit' }
 *
 * Returns null for system routes (health, rpc, mcp, sync, etc.)
 */
export function parseRestRoute(pathname: string): ParsedRoute | null {
  // Remove leading slash and split
  const segments = pathname.slice(1).split('/').filter(Boolean)

  if (segments.length === 0) {
    return null
  }

  // Exclude system routes
  const firstSegment = segments[0]!.toLowerCase()
  if (SYSTEM_ROUTES.has(firstSegment)) {
    return null
  }

  if (segments.length === 1) {
    // /customers → Customer
    const type = singularize(segments[0]!)
    return { type }
  }

  if (segments.length === 2) {
    // /customers/cust-1 → Customer, cust-1
    const type = singularize(segments[0]!)
    const id = segments[1]!
    return { type, id }
  }

  if (segments.length === 3 && segments[2]!.toLowerCase() === 'edit') {
    // /customers/cust-1/edit → Customer, cust-1, edit
    const type = singularize(segments[0]!)
    const id = segments[1]!
    return { type, id, action: 'edit' }
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

  const { type, id, action } = route

  // Derive namespace from request origin
  const ns = deriveNamespaceFromRequest(request, ctx.ns)

  // Edit action removed - JSON only API
  if (action === 'edit') {
    return errorResponse('NOT_FOUND', 'Edit UI not available - use API directly', 404)
  }

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
          const code = result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST'
          return errorResponse(code, result.error, result.status)
        }
        return handleCreate(ctx, type, result.data, request)
      }

      default:
        return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { 'Allow': 'GET, POST' })
    }
  }

  // Item routes: /:type/:id
  switch (method) {
    case 'GET':
      return handleGetById(ctx, type, id, request)

    case 'PUT': {
      const result = await parseRequestBody(request)
      if (!result.success) {
        const code = result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST'
        return errorResponse(code, result.error, result.status)
      }
      return handleUpdate(ctx, type, id, result.data, { merge: false }, request)
    }

    case 'PATCH': {
      const result = await parseRequestBody(request)
      if (!result.success) {
        const code = result.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST'
        return errorResponse(code, result.error, result.status)
      }
      return handleUpdate(ctx, type, id, result.data, { merge: true }, request)
    }

    case 'DELETE':
      return handleDelete(ctx, type, id)

    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { 'Allow': 'GET, PUT, PATCH, DELETE' })
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
