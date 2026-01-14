/**
 * REST Router for Core
 *
 * Provides HTTP routing using Hono for Durable Objects.
 * This is a simplified router focused on the core routing functionality
 * needed by @dotdo/core.
 *
 * Features:
 * - Route registration with HTTP methods
 * - Path parameter extraction
 * - JSON request/response handling
 * - Error response formatting
 *
 * @module @dotdo/core/rpc/router
 */

import { Hono } from 'hono'
import type { Context as HonoContext } from 'hono'

// ============================================================================
// TYPES
// ============================================================================

/**
 * HTTP methods supported by the router
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

/**
 * Route configuration
 */
export interface RouteConfig {
  /** HTTP method */
  method: HttpMethod
  /** URL path pattern (e.g., '/users/:id') */
  path: string
  /** Handler method name on the DO instance */
  handler: string
  /** Optional middleware */
  middleware?: RouteMiddleware[]
}

/**
 * Route middleware function
 */
export type RouteMiddleware = (
  ctx: RouteContext,
  next: () => Promise<Response>
) => Promise<Response>

/**
 * Route context passed to handlers
 */
export interface RouteContext {
  /** The original request */
  request: Request
  /** Path parameters extracted from URL */
  params: Record<string, string>
  /** Query parameters */
  query: Record<string, string>
  /** Request body (for POST/PUT/PATCH) */
  body?: unknown
  /** Request headers */
  headers: Headers
}

/**
 * Router options
 */
export interface RouterOptions {
  /** Base path prefix for all routes */
  basePath?: string
  /** Enable debug mode (include stack traces) */
  debug?: boolean
  /** Error handler */
  onError?: (error: Error, ctx: RouteContext) => Response
}

/**
 * JSON-LD response shape
 */
export interface JsonLdResponse {
  $context?: string
  $id?: string
  $type?: string
  [key: string]: unknown
}

/**
 * Error response shape
 */
export interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
    stack?: string
  }
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Create a JSON response
 *
 * @param data - Response data
 * @param status - HTTP status code
 * @param headers - Additional headers
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Create an error response
 *
 * @param code - Error code
 * @param message - Error message
 * @param status - HTTP status code
 * @param options - Additional options
 */
export function errorResponse(
  code: string,
  message: string,
  status = 500,
  options?: { details?: unknown; debug?: boolean; error?: Error }
): Response {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      ...(options?.details && { details: options.details }),
      ...(options?.debug && options?.error && { stack: options.error.stack }),
    },
  }
  return jsonResponse(body, status)
}

/**
 * Create a 404 Not Found response
 */
export function notFoundResponse(message = 'Not found'): Response {
  return errorResponse('NOT_FOUND', message, 404)
}

/**
 * Create a 400 Bad Request response
 */
export function badRequestResponse(message: string, details?: unknown): Response {
  return errorResponse('BAD_REQUEST', message, 400, { details })
}

/**
 * Create a 500 Internal Server Error response
 */
export function serverErrorResponse(message: string, error?: Error, debug = false): Response {
  return errorResponse('INTERNAL_ERROR', message, 500, { debug, error })
}

// ============================================================================
// REST ROUTER CLASS
// ============================================================================

/**
 * REST Router for Durable Objects
 *
 * Creates a Hono-based router that can be used to handle HTTP requests
 * in a Durable Object's fetch method.
 *
 * @example
 * ```typescript
 * class MyDO extends DurableObject {
 *   private router: RestRouter
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.router = new RestRouter({
 *       basePath: '/api',
 *     })
 *
 *     // Register routes
 *     this.router.get('/users/:id', 'getUser')
 *     this.router.post('/users', 'createUser')
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     return this.router.handle(request, this)
 *   }
 *
 *   async getUser(ctx: RouteContext) {
 *     const { id } = ctx.params
 *     return { id, name: 'Alice' }
 *   }
 *
 *   async createUser(ctx: RouteContext) {
 *     const data = ctx.body as { name: string }
 *     return { id: 'new-id', ...data }
 *   }
 * }
 * ```
 */
export class RestRouter {
  private app: Hono
  private options: RouterOptions
  private routes: RouteConfig[] = []

  constructor(options: RouterOptions = {}) {
    this.options = options
    this.app = new Hono()

    // Apply base path if specified
    if (options.basePath) {
      this.app = this.app.basePath(options.basePath)
    }
  }

  /**
   * Register a GET route
   */
  get(path: string, handler: string, middleware?: RouteMiddleware[]): this {
    return this.route('GET', path, handler, middleware)
  }

  /**
   * Register a POST route
   */
  post(path: string, handler: string, middleware?: RouteMiddleware[]): this {
    return this.route('POST', path, handler, middleware)
  }

  /**
   * Register a PUT route
   */
  put(path: string, handler: string, middleware?: RouteMiddleware[]): this {
    return this.route('PUT', path, handler, middleware)
  }

  /**
   * Register a DELETE route
   */
  delete(path: string, handler: string, middleware?: RouteMiddleware[]): this {
    return this.route('DELETE', path, handler, middleware)
  }

  /**
   * Register a PATCH route
   */
  patch(path: string, handler: string, middleware?: RouteMiddleware[]): this {
    return this.route('PATCH', path, handler, middleware)
  }

  /**
   * Register a route with any HTTP method
   */
  route(
    method: HttpMethod,
    path: string,
    handler: string,
    middleware?: RouteMiddleware[]
  ): this {
    this.routes.push({ method, path, handler, middleware })
    return this
  }

  /**
   * Get all registered routes
   */
  getRoutes(): RouteConfig[] {
    return [...this.routes]
  }

  /**
   * Handle an incoming request
   *
   * @param request - The incoming HTTP request
   * @param instance - The DO instance containing handler methods
   * @returns HTTP response
   */
  async handle(request: Request, instance: Record<string, unknown>): Promise<Response> {
    // Build Hono routes from registered routes
    const app = new Hono()

    // Apply base path if specified
    const router = this.options.basePath
      ? app.basePath(this.options.basePath)
      : app

    for (const route of this.routes) {
      const honoMethod = route.method.toLowerCase() as Lowercase<HttpMethod>

      router[honoMethod](route.path, async (c: HonoContext) => {
        // Build route context
        const ctx = await this.buildContext(c, request)

        // Apply middleware chain
        const handler = async (): Promise<Response> => {
          const method = instance[route.handler]
          if (typeof method !== 'function') {
            return notFoundResponse(`Handler '${route.handler}' not found`)
          }

          try {
            const result = await method.call(instance, ctx)

            // If result is already a Response, return it
            if (result instanceof Response) {
              return result
            }

            // Determine status based on method
            const status = route.method === 'POST' ? 201 : 200
            return jsonResponse(result, status)
          } catch (error) {
            return this.handleError(error as Error, ctx)
          }
        }

        // Execute middleware chain if present
        if (route.middleware && route.middleware.length > 0) {
          return this.executeMiddleware(route.middleware, ctx, handler)
        }

        return handler()
      })
    }

    // Add 404 handler
    router.notFound(() => notFoundResponse())

    // Handle request
    return router.fetch(request)
  }

  /**
   * Build route context from Hono context
   */
  private async buildContext(c: HonoContext, request: Request): Promise<RouteContext> {
    const url = new URL(request.url)

    // Parse query parameters
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })

    // Parse body for POST/PUT/PATCH
    let body: unknown = undefined
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const contentType = request.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        try {
          body = await request.json()
        } catch {
          // Invalid JSON - leave body undefined
        }
      }
    }

    return {
      request,
      params: c.req.param() as Record<string, string>,
      query,
      body,
      headers: request.headers,
    }
  }

  /**
   * Execute middleware chain
   */
  private async executeMiddleware(
    middleware: RouteMiddleware[],
    ctx: RouteContext,
    finalHandler: () => Promise<Response>
  ): Promise<Response> {
    let index = 0

    const next = async (): Promise<Response> => {
      if (index < middleware.length) {
        const mw = middleware[index++]!
        return mw(ctx, next)
      }
      return finalHandler()
    }

    return next()
  }

  /**
   * Handle errors
   */
  private handleError(error: Error, ctx: RouteContext): Response {
    if (this.options.onError) {
      return this.options.onError(error, ctx)
    }

    // Check for status code on error
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    const code = (error as Error & { code?: string }).code

    if (statusCode) {
      return errorResponse(
        code || 'ERROR',
        error.message,
        statusCode,
        { debug: this.options.debug, error }
      )
    }

    return serverErrorResponse(error.message, error, this.options.debug)
  }
}

// ============================================================================
// STATIC ROUTE CONFIGURATION
// ============================================================================

/**
 * Method configuration from static $rest property
 */
export interface RestMethodConfig {
  /** HTTP method */
  method: HttpMethod
  /** URL path pattern */
  path: string
  /** Query parameters to extract */
  queryParams?: string[]
  /** Authentication required */
  auth?: boolean
  /** Required roles */
  roles?: string[]
}

/**
 * DO class with optional static $rest configuration
 */
export interface DOClassWithRest {
  new (...args: unknown[]): unknown
  $rest?: Record<string, RestMethodConfig>
}

/**
 * Get REST routes from a DO class's static $rest configuration
 *
 * @param DOClass - The DO class to analyze
 * @returns Array of route configurations
 */
export function getRestRoutes(DOClass: DOClassWithRest): RouteConfig[] {
  const routes: RouteConfig[] = []

  const staticRest = DOClass.$rest
  if (staticRest) {
    for (const [methodName, config] of Object.entries(staticRest)) {
      routes.push({
        method: config.method,
        path: config.path,
        handler: methodName,
      })
    }
  }

  return routes
}

/**
 * Create a router from a DO class's static $rest configuration
 *
 * @param DOClass - The DO class with $rest configuration
 * @param options - Router options
 * @returns Configured RestRouter
 */
export function createRouterFromClass(
  DOClass: DOClassWithRest,
  options?: RouterOptions
): RestRouter {
  const router = new RestRouter(options)
  const routes = getRestRoutes(DOClass)

  for (const route of routes) {
    router.route(route.method, route.path, route.handler)
  }

  return router
}
