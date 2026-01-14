import { Hono } from 'hono'
import type { Env } from '../types'

// Default timeout for DO fetch calls (30 seconds)
const DO_FETCH_TIMEOUT_MS = 30000

/**
 * Structured error response for DO errors
 */
interface DOErrorResponse {
  error: {
    code: string
    message: string
    context?: {
      requestId?: string
      source?: string
      originalError?: string
    }
  }
}

/**
 * Create a structured error response for DO fetch failures
 */
function createDOErrorResponse(
  code: string,
  message: string,
  context?: { source?: string; originalError?: string; requestId?: string }
): DOErrorResponse {
  return {
    error: {
      code,
      message,
      ...(context && { context }),
    },
  }
}

/**
 * Wrap a fetch call with timeout
 */
async function fetchWithTimeout(
  stub: { fetch: (request: Request) => Promise<Response> },
  request: Request,
  timeoutMs: number = DO_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Clone request with abort signal
    // Need to use duplex: 'half' in Node.js environments when body is a ReadableStream
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body
    const requestWithSignal = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: hasBody ? request.body : undefined,
      signal: controller.signal,
      // @ts-expect-error - duplex is required for Node.js but not in types
      duplex: hasBody ? 'half' : undefined,
    })
    return await stub.fetch(requestWithSignal)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * REST Routes - Routes REST-like paths to the default DO namespace
 *
 * This router forwards REST-like requests (e.g., /customers, /orders/123)
 * to the default DO namespace with id 'default'. The DOBase inside handles
 * routing via rest-router.
 *
 * NOTE: For multi-tenant routing, use the API() factory from workers/api.ts:
 *   - Hostname mode: tenant.api.dotdo.dev -> DO('https://tenant.api.dotdo.dev')
 *   - Path mode: api.dotdo.dev/:org -> DO('https://api.dotdo.dev/org')
 *
 * The old /DO/:id/* pattern has been removed as it exposed internal binding
 * names in URLs. Use hostname-based or path-based routing instead.
 */

export const doRoutes = new Hono<{ Bindings: Env }>()

/**
 * Default REST routes - Route REST-like paths to the default DO namespace
 *
 * Matches paths that look like REST API endpoints:
 * - /:type (e.g., /customers) - list collection
 * - /:type/:id (e.g., /customers/alice) - get/update/delete item
 * - /:type/:id/edit (e.g., /customers/alice/edit) - edit UI
 *
 * These are forwarded to the default 'DO' namespace with id 'default'.
 * The DOBase inside handles routing via rest-router.
 */

// Known prefixes that should NOT be treated as REST types
// These are reserved for built-in routes and should not be forwarded to the default DO
const RESERVED_PREFIXES = new Set([
  'api',
  'auth',
  'admin',
  'docs',
  'mcp',
  'rpc',
  'health',
  'sync',
  'resolve',
  '$introspect',
])

/**
 * Check if a path looks like a REST route (not a reserved prefix)
 */
function isRestPath(pathname: string): boolean {
  const firstSegment = pathname.slice(1).split('/')[0]?.toLowerCase() || ''
  // Skip empty paths and reserved prefixes
  if (!firstSegment || RESERVED_PREFIXES.has(firstSegment) || RESERVED_PREFIXES.has(firstSegment.toUpperCase())) {
    return false
  }
  return true
}

/**
 * Catch-all for REST-like paths that route to the default DO
 *
 * Handles: /customers, /customers/alice, /customers/alice/edit, etc.
 */
doRoutes.all('*', async (c) => {
  const pathname = c.req.path

  // Skip if not a REST-like path
  if (!isRestPath(pathname)) {
    return c.notFound()
  }

  // Check if env exists (may be undefined in tests without bindings)
  if (!c.env) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'DO namespace not available' } },
      404
    )
  }

  // Get the default DO namespace
  const namespace = c.env.DO as DurableObjectNamespace | undefined
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'DO namespace not configured' } },
      404
    )
  }

  // Get default DO stub
  const doId = namespace.idFromName('default')
  const stub = namespace.get(doId)

  // Forward request to DO with original path
  try {
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    const request = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: hasBody ? c.req.raw.body : undefined,
      // @ts-expect-error - duplex is required for Node.js but not in types
      duplex: hasBody ? 'half' : undefined,
    })

    const response = await fetchWithTimeout(stub, request)
    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check for timeout (AbortError)
    if (error instanceof Error && error.name === 'AbortError') {
      return c.json(
        createDOErrorResponse('DO_FETCH_TIMEOUT', 'Request to Durable Object timed out', {
          source: 'default',
          originalError: errorMessage,
        }),
        504
      )
    }

    // Generic DO fetch error
    return c.json(
      createDOErrorResponse('DO_FETCH_ERROR', 'Failed to communicate with Durable Object', {
        source: 'default',
        originalError: errorMessage,
      }),
      502
    )
  }
})

export default doRoutes
