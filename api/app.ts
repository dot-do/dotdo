// Hono app setup - see do-7rf.7.1
// Route handlers are thin - they delegate to services for business logic
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'
import { authMiddleware } from '@dotdo/auth'
import { getErrorMessage } from '@dotdo/rpc'
import { HealthService, DiscoveryService } from './services'
import { rateLimitMiddleware, type RateLimitConfig, type RateLimitTier } from './middleware/rate-limit'
import { bodySizeLimitMiddleware, DEFAULT_MAX_BODY_SIZE } from './middleware/body-size-limit'
import { createStructuredLogger } from '@dotdo/observability'

// Create a structured logger for the API
const logger = createStructuredLogger({ service: 'dotdo-api' })

export interface APIOptions {
  basePath?: string
  cors?: {
    allowedOrigins?: string[]
  }
  auth?: {
    enabled?: boolean
    skipPaths?: string[]
    issuer?: string
    audience?: string
    secret?: string
    publicKey?: string
  }
  rateLimit?: {
    /** Enable rate limiting (default: false) */
    enabled?: boolean
    /** Key strategy for rate limiting: 'ip' (default), 'tenant', 'user', 'tenant+user' */
    keyStrategy?: RateLimitConfig['keyStrategy']
    /** Default tier for rate limiting (default: 'free') */
    defaultTier?: string
    /** Custom tier configurations */
    tiers?: Record<string, RateLimitTier>
    /** Override limits for specific tenants */
    tenantOverrides?: Record<string, Partial<RateLimitTier>>
    /** Override limits for specific users */
    userOverrides?: Record<string, Partial<RateLimitTier>>
    /** Paths to skip rate limiting (default: ['/health', '/ready']) */
    skipPaths?: string[]
    /** Fail open on storage errors (default: true) */
    failOpen?: boolean
    /** Window strategy: 'sliding' (default) or 'fixed' */
    windowStrategy?: 'sliding' | 'fixed'
  }
  bodyLimit?: {
    /** Enable body size limiting (default: true) */
    enabled?: boolean
    /** Maximum body size in bytes (default: 1MB) */
    maxSize?: number
    /** Paths to skip body size limiting */
    skipPaths?: string[]
    /** HTTP methods to skip body size limiting (default: ['GET', 'HEAD', 'OPTIONS']) */
    skipMethods?: string[]
    /** Per-method size limits */
    methodLimits?: Record<string, number>
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

/**
 * Generates a unique request ID for request tracing.
 *
 * The ID format is `{timestamp}-{random}` where timestamp is milliseconds
 * since epoch and random is a base36 string for uniqueness.
 *
 * @returns A unique request ID string
 *
 * @example
 * ```typescript
 * const id = generateRequestId()
 * // Returns something like: "1705320000000-abc123def456"
 * ```
 *
 * @internal
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Middleware that assigns and tracks request IDs for distributed tracing.
 *
 * This middleware:
 * - Uses the `X-Request-ID` header if provided by the client
 * - Generates a new unique ID if none is provided
 * - Stores the ID in Hono's context for downstream handlers
 * - Adds the ID to the response `X-Request-ID` header
 *
 * @returns A Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 * app.use('*', requestIdMiddleware())
 *
 * app.get('/test', (c) => {
 *   const requestId = c.get('requestId')
 *   return c.json({ requestId })
 * })
 * ```
 */
function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Use provided request ID or generate new one
    const requestId = c.req.header('X-Request-ID') || generateRequestId()
    c.set('requestId', requestId)

    await next()

    // Add to response headers
    c.res.headers.set('X-Request-ID', requestId)
  }
}

/**
 * Middleware that logs HTTP requests with timing and status information.
 *
 * This middleware:
 * - Records the start time before processing
 * - Passes control to downstream handlers
 * - Logs the completed request with method, URL, status, and duration
 * - Uses structured logging via the observability package
 *
 * The middleware depends on `requestIdMiddleware` being applied first
 * to include the request ID in log entries.
 *
 * @returns A Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 * app.use('*', requestIdMiddleware())
 * app.use('*', loggingMiddleware())
 *
 * // All requests will be logged with timing info
 * ```
 */
function loggingMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    const { method, url } = c.req

    await next()

    const duration = Date.now() - start
    const status = c.res.status
    const requestId = c.get('requestId')

    // Structured logging with observability
    logger.info('Request completed', {
      requestId,
      method,
      url,
      status,
      duration: `${duration}ms`,
    })
  }
}

/**
 * Creates a self-describing HATEOAS API with Hono.
 *
 * The API includes built-in support for:
 * - Health and readiness endpoints
 * - CORS configuration
 * - JWT/API key authentication
 * - Rate limiting
 * - Request body size limits
 * - Automatic request ID tracking
 * - Structured logging
 *
 * @param options - Configuration options for the API
 * @returns A configured Hono app instance
 *
 * @example
 * ```typescript
 * import { createAPI } from '@dotdo/api'
 *
 * // Basic usage
 * const api = createAPI()
 *
 * // With authentication and rate limiting
 * const api = createAPI({
 *   basePath: '/api/v1',
 *   auth: {
 *     enabled: true,
 *     secret: process.env.JWT_SECRET,
 *     skipPaths: ['/health']
 *   },
 *   rateLimit: {
 *     enabled: true,
 *     keyStrategy: 'tenant+user',
 *     defaultTier: 'free'
 *   }
 * })
 *
 * // Add custom routes
 * api.get('/users', (c) => c.json({ users: [] }))
 *
 * export default api
 * ```
 */
export function createAPI(options?: APIOptions) {
  const { basePath = '', auth, rateLimit, bodyLimit } = options || {}

  // Create services (business logic layer)
  const healthService = new HealthService({ serviceName: 'dotdo-api' })
  const discoveryService = new DiscoveryService({
    name: 'dotdo API',
    version: '1.0.0',
    description: 'Self-describing HATEOAS API'
  })

  // Create base app
  const baseApp = new Hono()

  // Global error handler using onError hook
  baseApp.onError((error, c) => {
    const requestId = c.get('requestId') || 'unknown'

    // Handle HTTPException from Hono
    if (error instanceof HTTPException) {
      const status = error.status
      return c.json(
        {
          error: error.message,
          status,
          requestId
        },
        status
      )
    }

    // Handle all other errors as 500
    logger.error('Unhandled error', error instanceof Error ? error : new Error(String(error)))
    return c.json(
      {
        error: getErrorMessage(error),
        status: 500,
        requestId
      },
      500
    )
  })

  // Apply global middleware (before basePath)
  baseApp.use('*', requestIdMiddleware())
  baseApp.use('*', loggingMiddleware())

  // CORS middleware
  baseApp.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'],
      exposeHeaders: [
        'X-Request-ID',
        // Legacy rate limit headers
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        // Standard rate limit headers (IETF draft)
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'RateLimit-Policy',
        // Retry header
        'Retry-After',
      ],
      maxAge: 86400,
      credentials: true
    })
  )

  // Body size limit middleware (enabled by default)
  if (bodyLimit?.enabled !== false) {
    const defaultSkipPaths = ['/health', '/ready']
    const skipPaths = [...defaultSkipPaths, ...(bodyLimit?.skipPaths || [])]

    baseApp.use(
      '*',
      bodySizeLimitMiddleware({
        maxSize: bodyLimit?.maxSize ?? DEFAULT_MAX_BODY_SIZE,
        skipPaths,
        skipMethods: bodyLimit?.skipMethods ?? ['GET', 'HEAD', 'OPTIONS'],
        ...(bodyLimit?.methodLimits && { methodLimits: bodyLimit.methodLimits }),
      })
    )
  }

  // Rate limiting middleware (optional)
  if (rateLimit?.enabled) {
    const defaultSkipPaths = ['/health', '/ready']
    const skipPaths = [...defaultSkipPaths, ...(rateLimit.skipPaths || [])]

    baseApp.use(
      '*',
      rateLimitMiddleware({
        keyStrategy: rateLimit.keyStrategy ?? 'ip',
        defaultTier: rateLimit.defaultTier ?? 'free',
        ...(rateLimit.tiers && { tiers: rateLimit.tiers }),
        ...(rateLimit.tenantOverrides && { tenantOverrides: rateLimit.tenantOverrides }),
        ...(rateLimit.userOverrides && { userOverrides: rateLimit.userOverrides }),
        skipPaths,
        failOpen: rateLimit.failOpen ?? true,
        windowStrategy: rateLimit.windowStrategy ?? 'sliding',
      })
    )
  }

  // Auth middleware (optional)
  if (auth?.enabled) {
    const defaultSkipPaths = ['/health', '/ready', '/']
    const skipPaths = [...defaultSkipPaths, ...(auth.skipPaths || [])]

    baseApp.use(
      '*',
      authMiddleware({
        skipPaths,
        issuer: auth.issuer,
        audience: auth.audience,
        secret: auth.secret,
        publicKey: auth.publicKey
      })
    )
  }

  // Create a route app (either with basePath or without)
  const routeApp = new Hono()

  // Health check endpoint (liveness probe)
  // Route handler is thin - delegates to HealthService for business logic
  routeApp.get('/health', (c) => {
    const health = healthService.getHealth()
    return c.json(health)
  })

  // Readiness check endpoint (readiness probe)
  // Route handler is thin - delegates to HealthService for business logic
  routeApp.get('/ready', async (c) => {
    const readiness = await healthService.getReadiness()
    const statusCode = readiness.status === 'ready' ? 200 : 503
    return c.json(readiness, statusCode)
  })

  // Root endpoint with API discovery (HATEOAS)
  // Route handler is thin - delegates to DiscoveryService for business logic
  routeApp.get('/', (c) => {
    const baseUrl = new URL(c.req.url).origin + basePath
    const apiRoot = discoveryService.getAPIRoot(baseUrl)
    return c.json(apiRoot)
  })

  // Mount routes (either at root or under basePath)
  if (basePath) {
    baseApp.route(basePath, routeApp)
  } else {
    baseApp.route('', routeApp)
  }

  // 404 handler for the base app (handles all not found routes)
  // Route handler is thin - delegates to DiscoveryService for business logic
  baseApp.notFound((c) => {
    const requestId = c.get('requestId') || 'unknown'
    const baseUrl = new URL(c.req.url).origin + basePath
    const errorResponse = discoveryService.getNotFoundError(baseUrl, c.req.path, requestId)
    return c.json(errorResponse, 404)
  })

  return baseApp
}
