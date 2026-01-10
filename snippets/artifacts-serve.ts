/**
 * Artifact Serve Snippet
 *
 * Serves artifacts from R2 Iceberg with SWR caching.
 * Handles path parsing, extension mapping, and cache control.
 *
 * @module snippets/artifacts-serve
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

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

export interface IcebergReader {
  getRecord(options: {
    table: string
    partition: { ns: string; type: string }
    id: string
  }): Promise<Record<string, unknown> | null>
}

export interface ServeOptions {
  config?: TenantConfig
  configLoader?: (ns: string) => Promise<TenantConfig>
  reader: IcebergReader
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
          return new Response(method === 'HEAD' ? null : cachedResponse.body, {
            status: cachedResponse.status,
            headers: responseHeaders,
          })
        }

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

  return response
}

// In-flight requests map for request coalescing
const inFlightRequests = new Map<string, Promise<ServeResult>>()

/**
 * Integration test handleServe implementation returning ServeResult.
 * Uses request coalescing to ensure concurrent requests for the same resource
 * share a single reader call.
 */
async function handleServeIntegration(
  request: Request,
  ctx: ExecutionContext,
  options: IntegrationServeOptions
): Promise<ServeResult> {
  const url = new URL(request.url)
  const cacheKey = url.toString()

  // Check if there's an in-flight request for the same resource
  const inFlight = inFlightRequests.get(cacheKey)
  if (inFlight) {
    // Wait for the in-flight request to complete and return its result
    return inFlight
  }

  // Create a promise for this request and store it
  const requestPromise = handleServeIntegrationInner(request, ctx, options)
  inFlightRequests.set(cacheKey, requestPromise)

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
 */
async function handleServeIntegrationInner(
  request: Request,
  ctx: ExecutionContext,
  options: IntegrationServeOptions
): Promise<ServeResult> {
  const url = new URL(request.url)

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

  // Check extension validity
  try {
    getColumnForExtension(ext)
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

  // Check visibility for private artifacts
  let record: Record<string, unknown> | null = null

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
              partition: { ns, type },
              id,
            })
            if (freshRecord) {
              const column = getColumnForExtension(ext)
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
        }

        const cachedBody = await cachedResponse.text()
        const contentType = cachedResponse.headers.get('Content-Type') || getContentType(ext)

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

  // Fetch from IcebergReader
  try {
    record = await options.reader.getRecord({
      table: 'do_resources',
      partition: { ns, type },
      id,
    })
  } catch (error) {
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  // Handle not found
  if (!record) {
    return {
      status: 404,
      body: JSON.stringify({ error: 'Artifact not found' }),
      contentType: 'application/json',
      headers: {},
    }
  }

  // Check visibility and authentication
  const visibility = record.visibility as string | undefined
  if (visibility === 'private') {
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

  // Get content from the appropriate column
  const column = getColumnForExtension(ext)
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

  return {
    status: 200,
    body,
    contentType: contentType.split(';')[0].trim(),
    headers,
  }
}
