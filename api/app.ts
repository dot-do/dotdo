// Hono app setup - see do-7rf.7.1
// Route handlers are thin - they delegate to services for business logic
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'
import { authMiddleware } from '../auth/middleware'
import { getErrorMessage } from '../rpc/errors'
import { HealthService, DiscoveryService } from './services'

export interface APIOptions {
  basePath?: string
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

    // Simple console logging (would be replaced with structured logging in production)
    console.log(
      JSON.stringify({
        requestId,
        method,
        url,
        status,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      })
    )
  }
}

export function createAPI(options?: APIOptions) {
  const { basePath = '', auth } = options || {}

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
    console.error('Unhandled error:', error)
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
