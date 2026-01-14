/**
 * Vercel Edge Router for Durable Objects
 *
 * Routes requests to the appropriate DO handler at the edge.
 * Uses consistent hashing for DO affinity and integrates with
 * ConsistencyGuard for concurrency control.
 *
 * @module deploy/vercel/edge-router
 *
 * @example
 * ```typescript
 * // api/do/[...path].ts
 * import { edgeRouter } from 'dotdo/deploy/vercel'
 * import { Business, Agent } from 'dotdo/objects'
 *
 * export const config = { runtime: 'edge' }
 *
 * export default edgeRouter({
 *   classes: { Business, Agent },
 *   defaultClass: Business,
 * })
 * ```
 */

import type { VercelEnv } from './env.d'
import { getEnv, isDebug, isConsistencyGuardEnabled, getLockTtl } from './env.d'
import { createVercelDoHandler, type VercelDoHandler, type DOClass } from './do-adapter'
import { createMiddlewareChain, type MiddlewareContext } from './middleware'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Edge router configuration
 */
export interface EdgeRouterConfig {
  /**
   * DO class constructors by type name
   */
  classes: Record<string, DOClass>

  /**
   * Default DO class when type is not specified
   */
  defaultClass?: DOClass

  /**
   * Custom path pattern for extracting DO ID
   * @default '/do/:id/:path*'
   */
  pathPattern?: string

  /**
   * Enable request logging
   * @default false
   */
  logging?: boolean

  /**
   * Custom middleware functions
   */
  middleware?: Array<(ctx: MiddlewareContext, next: () => Promise<Response>) => Promise<Response>>
}

/**
 * Parsed path result
 */
interface ParsedPath {
  /** DO identifier */
  doId: string
  /** DO type (optional) */
  doType?: string
  /** Remaining path after DO ID */
  remainingPath: string
}

// ============================================================================
// PATH PARSING
// ============================================================================

/**
 * Extract DO ID and path from URL
 *
 * Supports multiple patterns:
 * - /do/:id/:path*        -> doId from :id
 * - /do/:type/:id/:path*  -> doType and doId
 * - /:id/:path*           -> doId from first segment
 */
function parsePath(pathname: string, pattern?: string): ParsedPath | null {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return null
  }

  // Default pattern: /do/:id/:path*
  if (!pattern || pattern === '/do/:id/:path*') {
    // Expect: ['do', id, ...path]
    if (segments[0] === 'do' && segments.length >= 2) {
      return {
        doId: segments[1],
        remainingPath: '/' + segments.slice(2).join('/'),
      }
    }
    return null
  }

  // Pattern with type: /do/:type/:id/:path*
  if (pattern === '/do/:type/:id/:path*') {
    // Expect: ['do', type, id, ...path]
    if (segments[0] === 'do' && segments.length >= 3) {
      return {
        doType: segments[1],
        doId: segments[2],
        remainingPath: '/' + segments.slice(3).join('/'),
      }
    }
    return null
  }

  // Simple pattern: /:id/:path*
  if (pattern === '/:id/:path*') {
    return {
      doId: segments[0],
      remainingPath: '/' + segments.slice(1).join('/'),
    }
  }

  // Fallback: treat first segment as DO ID
  return {
    doId: segments[0],
    remainingPath: '/' + segments.slice(1).join('/'),
  }
}

/**
 * Extract DO ID from request header (alternative routing)
 */
function getDoIdFromHeader(request: Request): string | null {
  return request.headers.get('x-do-id') || request.headers.get('x-dotdo-id')
}

/**
 * Extract DO type from request header
 */
function getDoTypeFromHeader(request: Request): string | null {
  return request.headers.get('x-do-type') || request.headers.get('x-dotdo-type')
}

// ============================================================================
// HANDLER CACHE
// ============================================================================

/**
 * Cache of DO handlers by class name
 * Reuse handlers to avoid recreating them for each request
 */
const handlerCache = new Map<string, VercelDoHandler>()

/**
 * Get or create a DO handler for the given class
 */
function getHandler(
  className: string,
  DoClass: DOClass,
  env: VercelEnv
): VercelDoHandler {
  const cacheKey = `${className}:${env.TURSO_URL}`

  let handler = handlerCache.get(cacheKey)
  if (!handler) {
    handler = createVercelDoHandler(DoClass, env)
    handlerCache.set(cacheKey, handler)
  }

  return handler
}

// ============================================================================
// ERROR RESPONSES
// ============================================================================

/**
 * Create JSON error response
 */
function errorResponse(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = {
    error: message,
    status,
  }

  if (details) {
    body.details = details
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

// ============================================================================
// EDGE ROUTER
// ============================================================================

/**
 * Create an edge router for Durable Objects
 *
 * @param config - Router configuration
 * @returns Edge function handler
 */
export function edgeRouter(config: EdgeRouterConfig) {
  const {
    classes,
    defaultClass,
    pathPattern = '/do/:id/:path*',
    logging = false,
    middleware = [],
  } = config

  // Create middleware chain
  const middlewareChain = createMiddlewareChain(middleware)

  return async function handler(request: Request): Promise<Response> {
    const startTime = Date.now()
    const url = new URL(request.url)

    // Get environment
    let env: VercelEnv
    try {
      env = getEnv(process.env as Record<string, string | undefined>)
    } catch (error) {
      return errorResponse(500, 'Configuration error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    const debug = isDebug(env)

    // Parse DO ID from path or header
    let doId = getDoIdFromHeader(request)
    let doType = getDoTypeFromHeader(request)
    let remainingPath = url.pathname

    if (!doId) {
      const parsed = parsePath(url.pathname, pathPattern)
      if (!parsed) {
        return errorResponse(404, 'DO ID not found', {
          path: url.pathname,
          pattern: pathPattern,
        })
      }
      doId = parsed.doId
      doType = parsed.doType || doType
      remainingPath = parsed.remainingPath
    }

    // Resolve DO class
    const className = doType || env.DEFAULT_DO_CLASS || 'DO'
    const DoClass = classes[className] || defaultClass

    if (!DoClass) {
      return errorResponse(400, `Unknown DO type: ${className}`, {
        availableTypes: Object.keys(classes),
      })
    }

    // Get handler
    const doHandler = getHandler(className, DoClass, env)

    // Create middleware context
    const ctx: MiddlewareContext = {
      request,
      env,
      doId,
      doType: className,
      remainingPath,
      startTime,
    }

    // Execute middleware chain
    try {
      const response = await middlewareChain(ctx, async () => {
        // Build forwarded request
        const forwardUrl = new URL(remainingPath + url.search, url.origin)
        const forwardRequest = new Request(forwardUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          // @ts-expect-error - duplex is valid for streaming
          duplex: 'half',
        })

        // Add DO context headers
        forwardRequest.headers.set('x-do-id', doId)
        forwardRequest.headers.set('x-do-type', className)
        forwardRequest.headers.set('x-vercel-region', env.VERCEL_REGION || 'unknown')

        // Execute DO handler
        return doHandler.fetch(forwardRequest, doId)
      })

      // Add timing header in debug mode
      if (debug || logging) {
        const duration = Date.now() - startTime
        response.headers.set('x-response-time', `${duration}ms`)
      }

      return response
    } catch (error) {
      console.error('[EdgeRouter] Error:', error)

      if (debug) {
        return errorResponse(500, 'Internal Server Error', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })
      }

      return errorResponse(500, 'Internal Server Error')
    }
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Create a simple edge router with a single DO class
 */
export function simpleRouter(DoClass: DOClass): ReturnType<typeof edgeRouter> {
  return edgeRouter({
    classes: { [DoClass.name]: DoClass },
    defaultClass: DoClass,
    pathPattern: '/:id/:path*',
  })
}

export { edgeRouter as default }

/**
 * Export config for Vercel edge runtime
 */
export const config = {
  runtime: 'edge',
}
