// Hono app setup - see do-7rf.7.1
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'
import { authMiddleware } from '@dotdo/auth'
import { getErrorMessage } from '@dotdo/rpc'
import { createLogger } from '../utils/logger'
import { generateAPIRoot, generateErrorLinks } from './hateoas'
import { getAllResources } from './resource'

const logger = createLogger('[API]')

export interface CORSOptions {
  /**
   * Allowed origins for CORS requests.
   * - Provide an array of specific origins: ['https://app.example.com', 'https://dashboard.example.com']
   * - Use ['*'] to allow all origins (not recommended for production)
   * - Default: [] (no origins allowed - restrictive by default)
   */
  allowedOrigins?: string[]
}

export interface APIOptions {
  basePath?: string
  cors?: CORSOptions
  auth?: {
    enabled?: boolean
    skipPaths?: string[]
    issuer?: string
    audience?: string
    secret?: string
    publicKey?: string
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

// Generate a unique request ID
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

// Request ID middleware
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

// Logging middleware
function loggingMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    const { method, url } = c.req

    await next()

    const duration = Date.now() - start
    const status = c.res.status
    const requestId = c.get('requestId')

    // Structured request logging
    logger.info(`${method} ${url} ${status} ${duration}ms`, {
      requestId,
      method,
      url,
      status,
      duration,
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * Builds a CORS origin function that validates against allowed origins.
 * Returns the origin if allowed, or null if not allowed.
 */
function buildCorsOrigin(allowedOrigins: string[]): string | ((origin: string) => string | null) {
  // If wildcard is explicitly allowed, return '*'
  if (allowedOrigins.includes('*')) {
    return '*'
  }

  // If no origins specified, return a function that rejects all
  if (allowedOrigins.length === 0) {
    return () => null
  }

  // Return a function that validates against the allowed list
  return (origin: string) => {
    if (allowedOrigins.includes(origin)) {
      return origin
    }
    return null
  }
}

export function createAPI(options?: APIOptions) {
  const { basePath = '', cors: corsOptions, auth } = options || {}
  const allowedOrigins = corsOptions?.allowedOrigins ?? []

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
    logger.error('Unhandled error:', error)
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

  // CORS middleware with configurable origins
  baseApp.use(
    '*',
    cors({
      origin: buildCorsOrigin(allowedOrigins),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'],
      exposeHeaders: ['X-Request-ID'],
      maxAge: 86400,
      credentials: true
    })
  )

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
  // Used by load balancers/orchestrators to check if the process is alive
  // Returns 200 if the process is running, regardless of downstream dependencies
  routeApp.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'dotdo-api',
      timestamp: new Date().toISOString(),
      uptime: typeof process !== 'undefined' && process.uptime ? process.uptime() : undefined
    })
  })

  // Readiness check endpoint (readiness probe)
  // Used by load balancers to determine if the service can accept traffic
  // Returns 200 when ready, 503 when not ready
  routeApp.get('/ready', (c) => {
    // In a worker/DO environment, if we can respond, we're ready
    // This endpoint can be extended to check downstream dependencies
    const checks: Record<string, boolean> = {
      api: true
      // Add more checks here as needed:
      // database: await checkDatabase(),
      // cache: await checkCache(),
    }

    const allReady = Object.values(checks).every(Boolean)
    const status = allReady ? 'ready' : 'not_ready'

    return c.json(
      {
        status,
        service: 'dotdo-api',
        timestamp: new Date().toISOString(),
        checks
      },
      allReady ? 200 : 503
    )
  })

  // Root endpoint with API discovery (HATEOAS)
  routeApp.get('/', (c) => {
    const baseUrl = new URL(c.req.url).origin + basePath

    return c.json({
      name: 'dotdo API',
      version: '1.0.0',
      description: 'Self-describing HATEOAS API',
      _links: {
        self: {
          href: `${baseUrl}/`,
          rel: 'self',
          method: 'GET'
        },
        health: {
          href: `${baseUrl}/health`,
          rel: 'health',
          method: 'GET',
          title: 'Liveness check endpoint'
        },
        ready: {
          href: `${baseUrl}/ready`,
          rel: 'ready',
          method: 'GET',
          title: 'Readiness check endpoint'
        }
      }
    })
  })

  // Mount routes (either at root or under basePath)
  if (basePath) {
    baseApp.route(basePath, routeApp)
  } else {
    baseApp.route('', routeApp)
  }

  // 404 handler for the base app (handles all not found routes)
  baseApp.notFound((c) => {
    const requestId = c.get('requestId') || 'unknown'
    return c.json(
      {
        error: 'Not Found',
        status: 404,
        path: c.req.path,
        requestId
      },
      404
    )
  })

  return baseApp
}
