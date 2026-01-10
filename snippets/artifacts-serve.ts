/**
 * Artifact Serve Snippet
 *
 * Serves artifacts from R2 Iceberg with SWR caching.
 * Handles path parsing, extension mapping, and cache control.
 *
 * @module snippets/artifacts-serve
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

import { type ArtifactMetrics, noopMetrics } from './artifacts-ingest'
import type {
  GetRecordOptions,
  AuthContext,
  Visibility,
  PartitionFilter,
} from '../db/iceberg/types'

// Re-export metrics types for external use
export { type ArtifactMetrics, noopMetrics, createDefaultMetrics } from './artifacts-ingest'

// Re-export iceberg types used by consumers
export type { GetRecordOptions, AuthContext, Visibility, PartitionFilter } from '../db/iceberg/types'

// ============================================================================
// Types
// ============================================================================

export interface ParsedPath {
  ns: string
  type: string
  id: string
  ext: string
}

export interface TenantConfig {
  ns: string
  pipelines?: {
    allowedModes?: ('preview' | 'build' | 'bulk')[]
    defaultMode?: 'build' | 'preview' | 'bulk'
  }
  cache: {
    defaultMaxAge: number
    defaultStaleWhileRevalidate: number
    minMaxAge: number
    allowFreshBypass: boolean
  }
  limits?: {
    maxArtifactsPerRequest?: number
    maxBytesPerRequest?: number
    maxRequestsPerMinute?: number
  }
}

export interface CacheControlOverrides {
  maxAge?: number
  visibility?: 'public' | 'private'
  fresh?: boolean
}

/**
 * IcebergReader interface using real types from db/iceberg/types.
 * Supports visibility filtering, auth context, and column projection.
 */
export interface IcebergReader {
  getRecord(options: GetRecordOptions): Promise<Record<string, unknown> | null>
}

export interface ServeOptions {
  config?: TenantConfig
  configLoader?: (ns: string) => Promise<TenantConfig>
  reader: IcebergReader
  /** Optional metrics instance for observability. Uses noopMetrics if not provided. */
  metrics?: ArtifactMetrics
}

/**
 * Result type for integration tests that expect object response.
 */
export interface ServeResult {
  status: number
  body: string
  contentType: string
  headers: Record<string, string>
}

/**
 * Integration test options for handleServe.
 */
export interface IntegrationServeOptions {
  reader: IcebergReader
  cache: {
    match: (key: string) => Promise<Response | undefined>
    put: (key: string, response: Response) => Promise<void>
  }
  tenantConfig?: TenantConfig
  authenticatedNs?: string
  /** Optional metrics instance for observability. Uses noopMetrics if not provided. */
  metrics?: ArtifactMetrics
}

/**
 * Environment bindings (for integration tests).
 */
export interface ServeEnv {
  [key: string]: unknown
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported file extensions and their compound variants.
 * Order matters: compound extensions must be checked first.
 */
const COMPOUND_EXTENSIONS = ['mdast.json', 'hast.json', 'estree.json', 'd.ts']
const SIMPLE_EXTENSIONS = ['md', 'mdx', 'html', 'js', 'mjs', 'css', 'json']
const ALL_EXTENSIONS = [...COMPOUND_EXTENSIONS, ...SIMPLE_EXTENSIONS]

/**
 * Extension to database column mapping.
 */
const EXTENSION_TO_COLUMN: Record<string, string> = {
  'md': 'markdown',
  'mdx': 'mdx',
  'html': 'html',
  'js': 'esm',
  'mjs': 'esm',
  'd.ts': 'dts',
  'css': 'css',
  'json': 'frontmatter',
  'mdast.json': 'mdast',
  'hast.json': 'hast',
  'estree.json': 'estree',
}

/**
 * Extension to Content-Type mapping.
 */
const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  'md': 'text/markdown; charset=utf-8',
  'mdx': 'text/mdx; charset=utf-8',
  'html': 'text/html; charset=utf-8',
  'js': 'application/javascript; charset=utf-8',
  'mjs': 'application/javascript; charset=utf-8',
  'd.ts': 'application/typescript; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'json': 'application/json',
  'mdast.json': 'application/json',
  'hast.json': 'application/json',
  'estree.json': 'application/json',
}

/**
 * Default tenant config used when no config is provided.
 */
const DEFAULT_CONFIG: TenantConfig = {
  ns: 'default',
  cache: {
    defaultMaxAge: 300,
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
}

// ============================================================================
// Path Parsing
// ============================================================================

/**
 * Parse URL path into artifact components.
 *
 * URL Pattern: /$.content/{ns}/{type}/{id}.{ext}
 *
 * Supports:
 * - Simple extensions: .md, .html, .js, .css, .json
 * - Compound extensions: .d.ts, .mdast.json, .hast.json, .estree.json
 * - Nested namespaces: myorg.app.do
 * - URL-encoded characters in id
 *
 * @param url - The request URL to parse
 * @returns Parsed path components or null if invalid
 */
export function parsePath(url: URL): ParsedPath | null {
  // Remove /$.content/ prefix and get the path
  const pathname = decodeURIComponent(url.pathname)
  const prefix = '/$.content/'

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const path = pathname.slice(prefix.length)
  const parts = path.split('/')

  // Need at least 3 parts: ns, type, id.ext
  if (parts.length < 3) {
    return null
  }

  const ns = parts[0]
  const type = parts[1]
  const filenamePart = parts.slice(2).join('/')

  // Try compound extensions first (order matters)
  let ext: string | null = null
  let id: string | null = null

  for (const compoundExt of COMPOUND_EXTENSIONS) {
    const suffix = '.' + compoundExt
    if (filenamePart.endsWith(suffix)) {
      ext = compoundExt
      id = filenamePart.slice(0, -suffix.length)
      break
    }
  }

  // If no compound extension matched, try simple extensions
  if (!ext) {
    const lastDotIdx = filenamePart.lastIndexOf('.')
    if (lastDotIdx === -1 || lastDotIdx === filenamePart.length - 1) {
      return null // No extension
    }

    const potentialExt = filenamePart.slice(lastDotIdx + 1).toLowerCase()
    if (!SIMPLE_EXTENSIONS.includes(potentialExt)) {
      return null // Unknown extension
    }

    ext = potentialExt
    id = filenamePart.slice(0, lastDotIdx)
  }

  // Validate required parts
  if (!ns || !type || !id) {
    return null
  }

  return { ns, type, id, ext }
}

// ============================================================================
// Extension Mapping
// ============================================================================

/**
 * Map file extension to database column name.
 *
 * @param ext - File extension (without leading dot)
 * @returns Database column name
 * @throws Error if extension is unknown
 */
export function getColumnForExtension(ext: string): string {
  const normalizedExt = ext.toLowerCase()
  const column = EXTENSION_TO_COLUMN[normalizedExt]

  if (!column) {
    throw new Error(`Unsupported extension: ${ext}`)
  }

  return column
}

/**
 * Get Content-Type header for file extension.
 *
 * @param ext - File extension (without leading dot)
 * @returns Content-Type header value
 */
export function getContentType(ext: string): string {
  const normalizedExt = ext.toLowerCase()
  return EXTENSION_TO_CONTENT_TYPE[normalizedExt] ?? 'application/octet-stream'
}

// ============================================================================
// Cache Control
// ============================================================================

/**
 * Build Cache-Control header from config and overrides.
 *
 * @param config - Tenant configuration
 * @param overrides - Optional overrides for max-age, visibility, fresh bypass
 * @returns Cache-Control header value
 */
export function buildCacheControl(
  config: TenantConfig,
  overrides?: CacheControlOverrides
): string {
  // Fresh bypass returns no-store immediately
  if (overrides?.fresh) {
    return 'no-store'
  }

  // Determine max-age
  let maxAge = overrides?.maxAge ?? config.cache.defaultMaxAge

  // Enforce minimum
  if (maxAge < config.cache.minMaxAge) {
    maxAge = config.cache.minMaxAge
  }

  // Build header parts
  const visibility = overrides?.visibility ?? 'public'
  const parts = [`${visibility}`, `max-age=${maxAge}`]

  // Add stale-while-revalidate if > 0
  const swr = config.cache.defaultStaleWhileRevalidate
  if (swr > 0) {
    parts.push(`stale-while-revalidate=${swr}`)
  }

  return parts.join(', ')
}

// ============================================================================
// Auth Context Extraction
// ============================================================================

/**
 * Parse a base64url-encoded JWT payload.
 * Does NOT verify signature - verification should be done by auth middleware.
 *
 * @param token - Bearer token string
 * @returns Decoded payload or null if invalid
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = parts[1]
    // Base64url to base64 conversion
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Check if a JWT token has expired.
 *
 * @param payload - Parsed JWT payload
 * @returns true if expired, false otherwise
 */
function isTokenExpired(payload: Record<string, unknown>): boolean {
  const exp = payload.exp
  if (typeof exp !== 'number') return false

  // exp is in seconds since epoch
  return Date.now() / 1000 > exp
}

/**
 * Extract auth context from request headers.
 *
 * Extracts:
 * - userId from JWT payload or X-User-Id header
 * - orgId from X-Org-Id header or JWT payload
 * - roles from JWT payload
 *
 * Supports both:
 * - JWT tokens with claims
 * - Non-JWT tokens with X-User-Id/X-Org-Id headers for testing
 *
 * @param request - The HTTP request
 * @returns AuthContext or undefined if no auth present
 */
export function extractAuthContext(request: Request): AuthContext | undefined {
  const authHeader = request.headers.get('Authorization')

  // Check for X-User-Id and X-Org-Id headers (can work with or without auth)
  const userIdHeader = request.headers.get('X-User-Id')
  const orgIdHeader = request.headers.get('X-Org-Id')

  // If there's no auth header and no X- headers, return undefined
  if (!authHeader && !userIdHeader && !orgIdHeader) {
    return undefined
  }

  const authContext: AuthContext = {}

  // Try to extract from JWT if present
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = parseJwtPayload(token)

    if (payload && !isTokenExpired(payload)) {
      // Extract userId from JWT payload
      if (typeof payload.userId === 'string') {
        authContext.userId = payload.userId
      }

      // Extract orgId from JWT payload
      if (typeof payload.orgId === 'string') {
        authContext.orgId = payload.orgId
      }

      // Extract roles from JWT payload
      if (Array.isArray(payload.roles)) {
        authContext.roles = payload.roles.filter((r): r is string => typeof r === 'string')
      }
    }
  }

  // Override/supplement with X- headers (headers take precedence)
  if (userIdHeader) {
    authContext.userId = userIdHeader
  }
  if (orgIdHeader) {
    authContext.orgId = orgIdHeader
  }

  // If no properties were extracted, return undefined
  if (!authContext.userId && !authContext.orgId && !authContext.roles) {
    return undefined
  }

  return authContext
}

/**
 * Determine the visibility level to request based on auth context.
 *
 * Rules:
 * - No auth context: 'public'
 * - Auth with orgId: 'org'
 * - Auth with userId only: 'user'
 * - For unlisted artifacts: return undefined (accessible by direct ID only)
 *
 * @param authContext - The extracted auth context
 * @param isUnlistedAccess - Whether this is accessing an unlisted artifact
 * @returns Visibility level or undefined for unlisted access
 */
export function determineVisibility(
  authContext: AuthContext | undefined,
  isUnlistedAccess: boolean = false
): Visibility | undefined {
  // Unlisted artifacts don't filter by visibility - they're accessible by direct ID
  if (isUnlistedAccess) return undefined

  if (!authContext) return 'public'

  // If orgId is present, use org visibility
  if (authContext.orgId) return 'org'

  // If userId is present, use user visibility
  if (authContext.userId) return 'user'

  // Default to public
  return 'public'
}

/**
 * Get the columns to request based on file extension.
 * Always includes 'id' for record identification.
 *
 * @param ext - File extension
 * @returns Array of column names to request
 */
export function getColumnsForExtension(ext: string): string[] {
  const column = getColumnForExtension(ext)
  return ['id', column]
}

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Generate a simple hash for ETag from content.
 */
async function generateETag(content: string | object): Promise<string> {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
  return `"${hashHex}"`
}

// ============================================================================
// Response Helpers
// ============================================================================

function jsonError(message: string, status: number, cacheControl?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl
  }
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers,
  })
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Allow': 'GET, HEAD',
    },
  })
}

function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Allow': 'GET, HEAD, OPTIONS',
    },
  })
}

// ============================================================================
// SWR Cache Helpers
// ============================================================================

interface CacheEntry {
  response: Response
  cachedAt: number
  maxAge: number
}

/**
 * Check if a cached response is stale based on its Date header.
 */
function getResponseAge(response: Response): number {
  const dateHeader = response.headers.get('Date')
  if (!dateHeader) return 0

  const cachedAt = new Date(dateHeader).getTime()
  return Math.floor((Date.now() - cachedAt) / 1000)
}

/**
 * Check if response is stale (past max-age but potentially within SWR window).
 */
function isResponseStale(response: Response): boolean {
  const cacheControl = response.headers.get('Cache-Control')
  if (!cacheControl) return false

  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
  if (!maxAgeMatch) return false

  const maxAge = parseInt(maxAgeMatch[1])
  const age = getResponseAge(response)

  return age > maxAge
}


/**
 * Revalidate cache entry in the background.
 */
async function revalidateCache(
  cacheKey: string,
  parsed: ParsedPath,
  config: TenantConfig,
  reader: IcebergReader,
  overrides: CacheControlOverrides
): Promise<void> {
  try {
    const record = await reader.getRecord({
      table: 'do_resources',
      partition: { ns: parsed.ns, type: parsed.type },
      id: parsed.id,
    })

    if (!record) return

    const column = getColumnForExtension(parsed.ext)
    const content = record[column]

    if (content === null || content === undefined) return

    const isJson = parsed.ext.endsWith('.json') || parsed.ext === 'json'
    const body = isJson ? JSON.stringify(content) : String(content)

    const etag = await generateETag(body)
    const contentType = getContentType(parsed.ext)
    const cacheControl = buildCacheControl(config, overrides)
    const contentLength = new TextEncoder().encode(body).length

    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'ETag': etag,
      'X-Artifact-Source': 'cache',
      'Vary': 'Accept-Encoding',
      'Content-Length': String(contentLength),
      'Date': new Date().toUTCString(),
    })

    const response = new Response(body, { status: 200, headers })
    await caches.default.put(cacheKey, response)
  } catch {
    // Ignore revalidation errors
  }
}

// ============================================================================
// Integration Test Handler
// ============================================================================

/**
 * Check if options are for integration test mode.
 */
function isIntegrationOptions(
  options: ServeOptions | IntegrationServeOptions
): options is IntegrationServeOptions {
  return 'cache' in options && typeof options.cache === 'object' && 'match' in options.cache
}

/**
 * Handle artifact serve request - overloaded for integration tests.
 * This version accepts (request, env, ctx, options) signature.
 */
export async function handleServe(
  request: Request,
  envOrCtx: ServeEnv | ExecutionContext,
  ctxOrOptions: ExecutionContext | ServeOptions,
  maybeOptions?: IntegrationServeOptions
): Promise<Response | ServeResult> {
  // Determine which signature was used
  const isIntegrationMode = maybeOptions !== undefined && isIntegrationOptions(maybeOptions)

  if (isIntegrationMode) {
    // Integration test mode: (request, env, ctx, options)
    const ctx = ctxOrOptions as ExecutionContext
    const options = maybeOptions as IntegrationServeOptions
    return handleServeIntegration(request, ctx, options)
  }

  // Original mode: (request, ctx, options)
  const ctx = envOrCtx as ExecutionContext
  const options = ctxOrOptions as ServeOptions
  return handleServeOriginal(request, ctx, options)
}

/**
 * Original handleServe implementation returning Response.
 */
async function handleServeOriginal(
  request: Request,
  ctx: ExecutionContext,
  options: ServeOptions
): Promise<Response> {
  const method = request.method.toUpperCase()
  const metrics = options.metrics ?? noopMetrics
  const startTime = Date.now()

  // Handle OPTIONS for CORS preflight
  if (method === 'OPTIONS') {
    return optionsResponse()
  }

  // Only allow GET and HEAD
  if (method !== 'GET' && method !== 'HEAD') {
    return methodNotAllowed()
  }

  const url = new URL(request.url)

  // Parse path
  const parsed = parsePath(url)
  if (!parsed) {
    return jsonError('Invalid path format', 400)
  }

  const { ns, type, id, ext } = parsed

  // Load config (use provided, load from loader, or default)
  let config: TenantConfig
  if (options.config) {
    config = options.config
  } else if (options.configLoader) {
    try {
      config = await options.configLoader(ns)
    } catch {
      // Fall back to default config on loader error
      config = DEFAULT_CONFIG
    }
  } else {
    config = DEFAULT_CONFIG
  }

  // Parse query params
  const maxAgeParam = url.searchParams.get('max_age')
  const freshParam = url.searchParams.get('fresh')

  // Determine cache overrides
  const overrides: CacheControlOverrides = {}

  // Handle fresh bypass
  if (freshParam === 'true' && config.cache.allowFreshBypass) {
    overrides.fresh = true
  }

  // Handle max_age override
  if (maxAgeParam && !overrides.fresh) {
    const parsedMaxAge = parseInt(maxAgeParam)
    if (!isNaN(parsedMaxAge)) {
      overrides.maxAge = Math.max(parsedMaxAge, 0)
    }
  }

  // Build cache key (without query params)
  const cacheKey = `${url.origin}${url.pathname}`

  // Try cache first (unless fresh bypass)
  if (!overrides.fresh) {
    try {
      const cachedResponse = await caches.default.match(cacheKey)
      if (cachedResponse) {
        const age = getResponseAge(cachedResponse)
        const isStale = isResponseStale(cachedResponse)

        const responseHeaders = new Headers(cachedResponse.headers)
        responseHeaders.set('X-Artifact-Age', String(age))
        responseHeaders.set('X-Artifact-Source', 'cache')

        const cachedETag = cachedResponse.headers.get('ETag')
        const ifNoneMatch = request.headers.get('If-None-Match')
        if (cachedETag && ifNoneMatch === cachedETag) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': cachedETag,
              'Cache-Control': cachedResponse.headers.get('Cache-Control') || buildCacheControl(config, overrides),
            },
          })
        }

        if (isStale) {
          ctx.waitUntil(revalidateCache(cacheKey, parsed, config, options.reader, overrides))
          // Record SWR revalidation
          metrics.recordMetric('serve.swr_revalidation', 1, { ns, type, ext })
          metrics.recordMetric('serve.cache_hit', 1, { ns, type, ext, stale: 'true' })
          metrics.recordLatency('serve.latency', Date.now() - startTime, { ns, type, ext, source: 'cache' })
          return new Response(method === 'HEAD' ? null : cachedResponse.body, {
            status: cachedResponse.status,
            headers: responseHeaders,
          })
        }

        // Fresh cache hit
        metrics.recordMetric('serve.cache_hit', 1, { ns, type, ext, stale: 'false' })
        metrics.recordLatency('serve.latency', Date.now() - startTime, { ns, type, ext, source: 'cache' })
        return new Response(method === 'HEAD' ? null : cachedResponse.body, {
          status: cachedResponse.status,
          headers: responseHeaders,
        })
      }
    } catch {
      // Cache API error, continue to fetch from origin
    }
  }

  // Fetch from IcebergReader
  let record: Record<string, unknown> | null
  try {
    record = await options.reader.getRecord({
      table: 'do_resources',
      partition: { ns, type },
      id,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('connection')) {
      return jsonError('Storage backend unavailable', 502)
    }
    return jsonError('Internal server error', 500)
  }

  // Handle not found
  if (!record) {
    return jsonError('Artifact not found', 404)
  }

  // Get content from the appropriate column
  const column = getColumnForExtension(ext)
  const content = record[column]

  // Handle missing column content
  if (content === null || content === undefined) {
    return jsonError('Artifact format not available', 404)
  }

  // Prepare response body
  const isJson = ext.endsWith('.json') || ext === 'json'
  const body = isJson ? JSON.stringify(content) : String(content)

  // Generate ETag
  const etag = await generateETag(body)

  // Check If-None-Match
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': buildCacheControl(config, overrides),
      },
    })
  }

  // Build response headers
  const contentType = getContentType(ext)
  const cacheControl = buildCacheControl(config, overrides)
  const contentLength = new TextEncoder().encode(body).length

  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'ETag': etag,
    'X-Artifact-Source': 'parquet',
    'Vary': 'Accept-Encoding',
    'Content-Length': String(contentLength),
    'Date': new Date().toUTCString(),
  })

  const response = new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers,
  })

  // Cache the response
  if (!overrides.fresh) {
    try {
      const putResult = caches.default.put(cacheKey, response.clone())
      if (putResult && typeof putResult.then === 'function') {
        ctx.waitUntil(putResult.catch(() => {}))
      }
    } catch {
      // Ignore cache put errors
    }
  }

  // Record cache miss and latency for parquet fetch
  metrics.recordMetric('serve.cache_miss', 1, { ns, type, ext })
  metrics.recordLatency('serve.latency', Date.now() - startTime, { ns, type, ext, source: 'parquet' })

  return response
}

// ============================================================================
// In-Flight Request Management with TTL
// ============================================================================

/**
 * TTL for in-flight request entries in milliseconds.
 * Entries older than this are considered stale and cleaned up.
 */
const IN_FLIGHT_TTL_MS = 30_000

/**
 * Maximum number of entries in the in-flight requests map.
 * Prevents unbounded growth under high load.
 */
const IN_FLIGHT_MAX_SIZE = 10_000

/**
 * Entry in the in-flight requests map with timestamp for TTL cleanup.
 */
interface InFlightEntry {
  promise: Promise<ServeResult>
  createdAt: number
}

/**
 * In-flight requests map for request coalescing.
 * Uses TTL-based cleanup to prevent memory leaks from hung requests.
 */
const inFlightRequests = new Map<string, InFlightEntry>()

/**
 * Cleans up stale entries from the in-flight requests map.
 * Removes entries older than IN_FLIGHT_TTL_MS.
 */
function cleanupStaleEntries(): void {
  const now = Date.now()
  for (const [key, entry] of inFlightRequests) {
    if (now - entry.createdAt > IN_FLIGHT_TTL_MS) {
      inFlightRequests.delete(key)
    }
  }
}

/**
 * Gets the current count of in-flight requests.
 * Exported for testing to verify cleanup behavior.
 */
export function getInFlightRequestCount(): number {
  return inFlightRequests.size
}

/**
 * Clears all in-flight requests.
 * Exported for testing to reset state between tests.
 */
export function clearInFlightRequests(): void {
  inFlightRequests.clear()
}

/**
 * Integration test handleServe implementation returning ServeResult.
 * Uses request coalescing to ensure concurrent requests for the same resource
 * share a single reader call.
 *
 * Includes TTL-based cleanup to prevent memory leaks from hung requests.
 */
async function handleServeIntegration(
  request: Request,
  ctx: ExecutionContext,
  options: IntegrationServeOptions
): Promise<ServeResult> {
  const url = new URL(request.url)
  const cacheKey = url.toString()

  // Lazy cleanup: purge stale entries on each access
  cleanupStaleEntries()

  // Check if there's an in-flight request for the same resource
  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) {
    // Check if the entry is still valid (within TTL)
    const now = Date.now()
    if (now - inFlight.createdAt <= IN_FLIGHT_TTL_MS) {
      // Wait for the in-flight request to complete and return its result
      return inFlight.promise
    }
    // Entry is stale, remove it and proceed with a new request
    inFlightRequests.delete(cacheKey)
  }

  // Enforce max size limit - if at capacity, clean up oldest entries
  if (inFlightRequests.size >= IN_FLIGHT_MAX_SIZE) {
    // Find and remove the oldest entries (LRU-style eviction)
    const entriesToRemove = Math.max(1, Math.floor(IN_FLIGHT_MAX_SIZE * 0.1))
    const sortedEntries = Array.from(inFlightRequests.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
      inFlightRequests.delete(sortedEntries[i][0])
    }
  }

  // Create a promise for this request and store it with timestamp
  const requestPromise = handleServeIntegrationInner(request, ctx, options)
  const entry: InFlightEntry = {
    promise: requestPromise,
    createdAt: Date.now(),
  }
  inFlightRequests.set(cacheKey, entry)

  try {
    const result = await requestPromise
    return result
  } finally {
    // Clean up the in-flight request
    inFlightRequests.delete(cacheKey)
  }
}

/**
 * Inner implementation of handleServeIntegration.
 * Uses real IcebergReader interface with visibility, auth, and columns.
 */
async function handleServeIntegrationInner(
  request: Request,
  ctx: ExecutionContext,
  options: IntegrationServeOptions
): Promise<ServeResult> {
  const url = new URL(request.url)
  const metrics = options.metrics ?? noopMetrics
  const startTime = Date.now()

  // Parse path
  const parsed = parsePath(url)
  if (!parsed) {
    return {
      status: 400,
      body: JSON.stringify({ error: 'Invalid path format' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  const { ns, type, id, ext } = parsed

  // Check extension validity and get column
  let column: string
  try {
    column = getColumnForExtension(ext)
  } catch {
    return {
      status: 400,
      body: JSON.stringify({ error: `Unsupported extension: ${ext}` }),
      contentType: 'application/json',
      headers: {},
    }
  }

  // Use provided config or default
  const config = options.tenantConfig || DEFAULT_CONFIG

  // Parse query params
  const maxAgeParam = url.searchParams.get('max_age')
  const freshParam = url.searchParams.get('fresh')

  // Determine cache overrides
  const overrides: CacheControlOverrides = {}
  if (freshParam === 'true' && config.cache.allowFreshBypass) {
    overrides.fresh = true
  }
  if (maxAgeParam && !overrides.fresh) {
    const parsedMaxAge = parseInt(maxAgeParam)
    if (!isNaN(parsedMaxAge)) {
      overrides.maxAge = Math.max(parsedMaxAge, 0)
    }
  }

  // Build cache key
  const cacheKey = url.toString()

  // Extract auth context from request headers
  const authContext = extractAuthContext(request)

  // Determine visibility based on auth context
  // For unlisted resources, we don't filter by visibility (undefined)
  // This allows direct ID access while still hiding from listings
  const visibility = determineVisibility(authContext)

  // Get columns to request (id + requested column)
  const columns = getColumnsForExtension(ext)

  // Build partition filter with visibility
  const partition: PartitionFilter = { ns, type }
  if (visibility !== undefined) {
    partition.visibility = visibility
  }

  // Check if this is a protected visibility that requires auth
  const requiresAuth = visibility === 'org' || visibility === 'user'

  // Try cache first (unless fresh bypass)
  if (!overrides.fresh) {
    try {
      const cachedResponse = await options.cache.match(cacheKey)
      if (cachedResponse) {
        const age = getResponseAge(cachedResponse)
        const isStale = cachedResponse.headers.get('X-Cache-Stale') === 'true'

        const cacheControl = cachedResponse.headers.get('Cache-Control') || buildCacheControl(config, overrides)
        const headers: Record<string, string> = {
          'Cache-Control': cacheControl,
          'X-Artifact-Source': 'cache',
          'X-Artifact-Age': String(age),
        }

        if (isStale) {
          headers['X-Cache-Stale'] = 'true'
          // Trigger background revalidation
          const revalidatePromise = (async () => {
            const freshRecord = await options.reader.getRecord({
              table: 'do_resources',
              partition,
              id,
              auth: authContext,
              columns,
            })
            if (freshRecord) {
              const content = freshRecord[column]
              if (content !== null && content !== undefined) {
                const isJson = ext.endsWith('.json') || ext === 'json'
                const body = isJson ? JSON.stringify(content) : String(content)
                const cacheControl = buildCacheControl(config, overrides)
                const response = new Response(body, {
                  headers: {
                    'Content-Type': getContentType(ext),
                    'Cache-Control': cacheControl,
                  },
                })
                await options.cache.put(cacheKey, response)
              }
            }
          })()
          ctx.waitUntil(revalidatePromise)
          // Record SWR revalidation
          metrics.recordMetric('serve.swr_revalidation', 1, { ns, type, ext })
        }

        const cachedBody = await cachedResponse.text()
        const contentType = cachedResponse.headers.get('Content-Type') || getContentType(ext)

        // Record cache hit metrics
        metrics.recordMetric('serve.cache_hit', 1, { ns, type, ext, stale: String(isStale) })
        metrics.recordLatency('serve.latency', Date.now() - startTime, { ns, type, ext, source: 'cache' })

        return {
          status: cachedResponse.status,
          body: cachedBody,
          contentType: contentType.split(';')[0].trim(),
          headers,
        }
      }
    } catch {
      // Cache error, continue to fetch from origin
    }
  }

  // Fetch from IcebergReader using real interface
  let record: Record<string, unknown> | null = null
  try {
    record = await options.reader.getRecord({
      table: 'do_resources',
      partition,
      id,
      auth: authContext,
      columns,
    })
  } catch (error) {
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  // Handle visibility-based auth checks
  // The record might be null because visibility doesn't match
  // or because the record doesn't exist

  // If record not found with visibility filter, try without filter
  // This handles:
  // 1. Unlisted artifacts (accessible by direct ID regardless of visibility)
  // 2. Protected artifacts (need to check auth)
  if (!record) {
    // Check if auth is required but not present
    if (requiresAuth && !authContext) {
      return {
        status: 401,
        body: JSON.stringify({ error: 'Authentication required' }),
        contentType: 'application/json',
        headers: {
          'WWW-Authenticate': 'Bearer realm="artifacts"',
        },
      }
    }

    // Try fetching with no visibility filter to check if resource exists
    // Include visibility column to check access control
    const unfilteredColumns = [...columns, 'visibility', 'orgId', 'userId']
    const unfiltered = await options.reader.getRecord({
      table: 'do_resources',
      partition: { ns, type },
      id,
      columns: unfilteredColumns,
    })

    if (unfiltered) {
      const actualVisibility = unfiltered.visibility as Visibility | undefined

      // Unlisted artifacts are accessible by direct ID lookup
      if (actualVisibility === 'unlisted') {
        // Use the unfiltered record
        record = unfiltered
      } else if (actualVisibility === 'org' || actualVisibility === 'user') {
        // Resource exists but is protected
        if (!authContext) {
          return {
            status: 401,
            body: JSON.stringify({ error: 'Authentication required' }),
            contentType: 'application/json',
            headers: {
              'WWW-Authenticate': 'Bearer realm="artifacts"',
            },
          }
        }
        // Auth present but doesn't match - access denied
        return {
          status: 403,
          body: JSON.stringify({ error: 'Access denied' }),
          contentType: 'application/json',
          headers: {},
        }
      } else {
        // Public artifact should have been found earlier - this is unexpected
        record = unfiltered
      }
    }
  }

  // Still no record found
  if (!record) {
    return {
      status: 404,
      body: JSON.stringify({ error: 'Artifact not found' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  const recordVisibility = record.visibility as Visibility | undefined

  // Double-check visibility matches auth
  if (recordVisibility === 'org') {
    const recordOrgId = record.orgId as string | undefined
    if (!authContext?.orgId || (recordOrgId && authContext.orgId !== recordOrgId)) {
      return {
        status: 403,
        body: JSON.stringify({ error: 'Access denied' }),
        contentType: 'application/json',
        headers: {},
      }
    }
  }

  if (recordVisibility === 'user') {
    const recordUserId = record.userId as string | undefined
    if (!authContext?.userId || (recordUserId && authContext.userId !== recordUserId)) {
      return {
        status: 403,
        body: JSON.stringify({ error: 'Access denied' }),
        contentType: 'application/json',
        headers: {},
      }
    }
  }

  // Check legacy visibility === 'private' handling (backward compatibility)
  const legacyVisibility = record.visibility as string | undefined
  if (legacyVisibility === 'private') {
    if (!options.authenticatedNs) {
      return {
        status: 401,
        body: JSON.stringify({ error: 'Authentication required' }),
        contentType: 'application/json',
        headers: {},
      }
    }
    if (options.authenticatedNs !== ns) {
      return {
        status: 403,
        body: JSON.stringify({ error: 'Access denied' }),
        contentType: 'application/json',
        headers: {},
      }
    }
  }

  // Get content from the appropriate column (column already defined above)
  const content = record[column]

  // Handle missing column content
  if (content === null || content === undefined) {
    return {
      status: 404,
      body: JSON.stringify({ error: 'Artifact format not available' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  // Prepare response body
  const isJson = ext.endsWith('.json') || ext === 'json'
  const body = isJson ? JSON.stringify(content) : String(content)

  // Build response headers
  const contentType = getContentType(ext)
  const cacheControl = buildCacheControl(config, overrides)

  const headers: Record<string, string> = {
    'Cache-Control': cacheControl,
    'X-Artifact-Source': 'parquet',
  }

  // Cache the response
  if (!overrides.fresh) {
    try {
      const cacheResponse = new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': cacheControl,
        },
      })
      await options.cache.put(cacheKey, cacheResponse)
    } catch {
      // Ignore cache put errors
    }
  }

  // Record cache miss metrics
  metrics.recordMetric('serve.cache_miss', 1, { ns, type, ext })
  metrics.recordLatency('serve.latency', Date.now() - startTime, { ns, type, ext, source: 'parquet' })

  return {
    status: 200,
    body,
    contentType: contentType.split(';')[0].trim(),
    headers,
  }
}
