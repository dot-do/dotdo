import { Hono } from 'hono'
import type { Env } from '../index'

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
    const requestWithSignal = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    return await stub.fetch(requestWithSignal)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * DO Router - Routes requests to individual Durable Object instances
 *
 * Pattern: /:doClass/:id/*
 *
 * This router forwards requests to specific DO instances based on:
 * - doClass: The DO namespace binding name (e.g., 'DO', 'TEST_DO', 'BROWSER_DO')
 * - id: The identifier used with idFromName() to get the DO instance
 * - *: The remaining path to forward to the DO
 *
 * Example:
 *   GET /DO/user-123/profile
 *   -> Gets DO namespace 'DO' from env
 *   -> Gets stub via idFromName('user-123')
 *   -> Forwards request with path '/profile' to the DO
 */

export const doRoutes = new Hono<{ Bindings: Env }>()

/**
 * Route all HTTP methods to DO instances
 *
 * Matches: /:doClass/:id, /:doClass/:id/, /:doClass/:id/*
 */
doRoutes.all('/:doClass/:id/*', async (c) => {
  const { doClass, id } = c.req.param()
  const requestId = c.req.header('x-request-id') || crypto.randomUUID()
  const source = `${doClass}/${id}`

  // Get DO namespace binding by class name
  const namespace = c.env[doClass as keyof Env] as DurableObjectNamespace | undefined
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Unknown DO class: ${doClass}` } },
      404
    )
  }

  // Get DO stub using idFromName
  const doId = namespace.idFromName(id)
  const stub = namespace.get(doId)

  // Rewrite path: remove /:doClass/:id prefix
  // Original path: /DO/user-123/some/path -> DO receives: /some/path
  const originalPath = c.req.path
  const prefixPattern = new RegExp(`^/${doClass}/${encodeURIComponent(id)}`)
  const rewrittenPath = originalPath.replace(prefixPattern, '') || '/'

  // Build the URL for the DO request
  const url = new URL(c.req.url)
  url.pathname = rewrittenPath

  // Forward request to DO with original headers and body, wrapped in try-catch
  try {
    const request = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    })

    const response = await fetchWithTimeout(stub, request)

    // Handle non-JSON error responses from DO
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await response.text()
        return c.json(
          createDOErrorResponse('DO_ERROR', text || 'Unknown error', {
            source,
            requestId,
          }),
          response.status as 400 | 500 | 502 | 503 | 504
        )
      }
    }

    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check for timeout (AbortError)
    if (error instanceof Error && error.name === 'AbortError') {
      return c.json(
        createDOErrorResponse('DO_FETCH_TIMEOUT', 'Request to Durable Object timed out', {
          source,
          requestId,
          originalError: errorMessage,
        }),
        504
      )
    }

    // Generic DO fetch error
    return c.json(
      createDOErrorResponse('DO_FETCH_ERROR', 'Failed to communicate with Durable Object', {
        source,
        requestId,
        originalError: errorMessage,
      }),
      502
    )
  }
})

/**
 * Handle requests without wildcard path (e.g., /DO/user-123)
 * Routes to the root path of the DO instance
 */
doRoutes.all('/:doClass/:id', async (c) => {
  const { doClass, id } = c.req.param()
  const requestId = c.req.header('x-request-id') || crypto.randomUUID()
  const source = `${doClass}/${id}`

  // Get DO namespace binding by class name
  const namespace = c.env[doClass as keyof Env] as DurableObjectNamespace | undefined
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Unknown DO class: ${doClass}` } },
      404
    )
  }

  // Get DO stub using idFromName
  const doId = namespace.idFromName(id)
  const stub = namespace.get(doId)

  // Build the URL for the DO request (root path)
  const url = new URL(c.req.url)
  url.pathname = '/'

  // Forward request to DO with original headers and body, wrapped in try-catch
  try {
    const request = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    })

    const response = await fetchWithTimeout(stub, request)

    // Handle non-JSON error responses from DO
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await response.text()
        return c.json(
          createDOErrorResponse('DO_ERROR', text || 'Unknown error', {
            source,
            requestId,
          }),
          response.status as 400 | 500 | 502 | 503 | 504
        )
      }
    }

    return response
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check for timeout (AbortError)
    if (error instanceof Error && error.name === 'AbortError') {
      return c.json(
        createDOErrorResponse('DO_FETCH_TIMEOUT', 'Request to Durable Object timed out', {
          source,
          requestId,
          originalError: errorMessage,
        }),
        504
      )
    }

    // Generic DO fetch error
    return c.json(
      createDOErrorResponse('DO_FETCH_ERROR', 'Failed to communicate with Durable Object', {
        source,
        requestId,
        originalError: errorMessage,
      }),
      502
    )
  }
})

export default doRoutes
