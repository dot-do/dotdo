// Hono app setup - see do-7rf.7.1
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { MiddlewareHandler } from 'hono'
import { authMiddleware } from '../auth/middleware'
import { getErrorMessage } from '../rpc/errors'

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
    const defaultSkipPaths = ['/health', '/']
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

  // Health check endpoint
  routeApp.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'dotdo-api',
      timestamp: new Date().toISOString()
    })
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
          title: 'Health check endpoint'
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
