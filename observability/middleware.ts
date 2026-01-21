/**
 * Hono Middleware for Observability
 *
 * Provides request-scoped observability with:
 * - Automatic trace context extraction and propagation
 * - Request/response logging
 * - Span creation for HTTP requests
 * - Correlation ID management
 * - Timing metrics
 *
 * @module observability/middleware
 */

import type { Context, Next, MiddlewareHandler } from 'hono'
import { createStructuredLogger, type StructuredLogger, LogLevel } from './logger'
import {
  createTracer,
  extractTraceContext,
  injectTraceContext,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from './tracing'
import {
  createObservabilityContext,
  extractContextFromHeaders,
  injectContextToHeaders,
  runWithContext,
  CORRELATION_ID_HEADER,
  generateCorrelationId,
} from './context'

/**
 * Options for the observability middleware
 */
export interface ObservabilityMiddlewareOptions {
  /** Service name for logging and tracing */
  service?: string
  /** Log level for request logging */
  logLevel?: LogLevel
  /** Whether to log request bodies (default: false) */
  logRequestBody?: boolean
  /** Whether to log response bodies (default: false) */
  logResponseBody?: boolean
  /** Maximum body length to log (default: 1000) */
  maxBodyLogLength?: number
  /** Headers to exclude from logging (lowercased) */
  excludeHeaders?: string[]
  /** Paths to exclude from tracing (e.g., health checks) */
  excludePaths?: string[]
  /** Custom logger instance */
  logger?: StructuredLogger
  /** Custom tracer instance */
  tracer?: Tracer
  /** Whether to create spans for requests (default: true) */
  enableTracing?: boolean
  /** Whether to enable request logging (default: true) */
  enableLogging?: boolean
}

/**
 * Default headers to exclude from logging
 */
const DEFAULT_EXCLUDE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]

/**
 * Default paths to exclude from tracing
 */
const DEFAULT_EXCLUDE_PATHS = [
  '/health',
  '/healthz',
  '/ready',
  '/readyz',
  '/live',
  '/livez',
  '/metrics',
  '/favicon.ico',
]

/**
 * Sanitize headers for logging
 */
function sanitizeHeaders(
  headers: Headers,
  excludeHeaders: string[]
): Record<string, string> {
  const result: Record<string, string> = {}

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (excludeHeaders.includes(lowerKey)) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = value
    }
  })

  return result
}

/**
 * Truncate body for logging
 */
function truncateBody(body: string, maxLength: number): string {
  if (body.length <= maxLength) return body
  return body.slice(0, maxLength) + `... [truncated, ${body.length} chars total]`
}

/**
 * Get HTTP status category
 */
function getStatusCategory(status: number): string {
  if (status >= 500) return 'server_error'
  if (status >= 400) return 'client_error'
  if (status >= 300) return 'redirect'
  if (status >= 200) return 'success'
  return 'informational'
}

/**
 * Create observability middleware for Hono
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { observability } from '@dotdo/observability'
 *
 * const app = new Hono()
 * app.use('/*', observability({ service: 'my-api' }))
 * ```
 */
export function observability(
  options: ObservabilityMiddlewareOptions = {}
): MiddlewareHandler {
  const {
    service = 'dotdo',
    logLevel = LogLevel.INFO,
    logRequestBody = false,
    logResponseBody = false,
    maxBodyLogLength = 1000,
    excludeHeaders = DEFAULT_EXCLUDE_HEADERS,
    excludePaths = DEFAULT_EXCLUDE_PATHS,
    enableTracing = true,
    enableLogging = true,
  } = options

  const logger = options.logger ?? createStructuredLogger({ service, level: logLevel })
  const tracer = options.tracer ?? createTracer({ name: service })

  return async (c: Context, next: Next) => {
    const startTime = Date.now()
    const { method, url } = c.req
    const pathname = new URL(url).pathname

    // Check if path should be excluded
    const isExcluded = excludePaths.some(p => pathname === p || pathname.startsWith(p + '/'))

    // Extract context from incoming headers
    const incomingTraceContext = extractTraceContext(c.req.raw.headers)
    const incomingContext = extractContextFromHeaders(c.req.raw.headers)

    // Create observability context
    const correlationId = incomingContext.correlationId ?? generateCorrelationId()
    const observabilityContext = createObservabilityContext({
      correlationId,
      ...(incomingTraceContext && { traceContext: incomingTraceContext }),
      ...(incomingContext.baggage && { baggage: incomingContext.baggage }),
    })

    // Set correlation ID in response headers
    c.header(CORRELATION_ID_HEADER, correlationId)

    // Create request span if tracing is enabled
    let span: Span | undefined
    if (enableTracing && !isExcluded) {
      span = tracer.startSpan(`${method} ${pathname}`, {
        kind: SpanKind.SERVER,
        ...(incomingTraceContext && { parent: incomingTraceContext }),
        attributes: {
          'http.method': method,
          'http.url': url,
          'http.route': pathname,
          'http.user_agent': c.req.header('user-agent') ?? '',
          'correlation.id': correlationId,
        },
      })
      observabilityContext.activeSpan = span

      // Inject trace context into response headers
      const spanContext = span.context()
      const responseHeaders = new Headers()
      injectTraceContext(responseHeaders, spanContext)
      responseHeaders.forEach((value, key) => {
        c.header(key, value)
      })
    }

    // Log request start if logging is enabled
    if (enableLogging && !isExcluded) {
      const requestLogger = logger.child({
        correlationId,
        traceId: span?.context().traceId,
        spanId: span?.context().spanId,
      })

      const requestLog: Record<string, unknown> = {
        method,
        path: pathname,
        query: new URL(url).search,
        headers: sanitizeHeaders(c.req.raw.headers, excludeHeaders),
      }

      if (logRequestBody && c.req.raw.body) {
        try {
          const body = await c.req.text()
          requestLog['body'] = truncateBody(body, maxBodyLogLength)
        } catch {
          requestLog['body'] = '[unreadable]'
        }
      }

      requestLogger.info(`Request: ${method} ${pathname}`, requestLog)
    }

    // Run handler with observability context
    let error: Error | undefined
    let response: Response | undefined

    try {
      await runWithContext(observabilityContext, async () => {
        await next()
      })
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
      throw e
    } finally {
      const duration = Date.now() - startTime
      const status = c.res?.status ?? 500

      // Record span data
      if (span) {
        span.setAttribute('http.status_code', status)
        span.setAttribute('http.response_time_ms', duration)

        if (error) {
          span.recordException(error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        } else if (status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` })
        } else {
          span.setStatus({ code: SpanStatusCode.OK })
        }

        span.end()
      }

      // Log response
      if (enableLogging && !isExcluded) {
        const responseLogger = logger.child({
          correlationId,
          traceId: span?.context().traceId,
          spanId: span?.context().spanId,
        })

        const responseLog: Record<string, unknown> = {
          method,
          path: pathname,
          status,
          duration,
          statusCategory: getStatusCategory(status),
        }

        if (error) {
          responseLog['error'] = {
            name: error.name,
            message: error.message,
          }
        }

        if (logResponseBody && c.res?.body) {
          try {
            const clonedRes = c.res.clone()
            const body = await clonedRes.text()
            responseLog['body'] = truncateBody(body, maxBodyLogLength)
          } catch {
            responseLog['body'] = '[unreadable]'
          }
        }

        if (status >= 500) {
          responseLogger.error(`Response: ${method} ${pathname} ${status}`, responseLog)
        } else if (status >= 400) {
          responseLogger.warn(`Response: ${method} ${pathname} ${status}`, responseLog)
        } else {
          responseLogger.info(`Response: ${method} ${pathname} ${status}`, responseLog)
        }
      }
    }
  }
}

/**
 * Create a request-scoped logger from Hono context
 *
 * @example
 * ```typescript
 * app.get('/users', (c) => {
 *   const log = getRequestLogger(c, 'users-handler')
 *   log.info('Fetching users')
 *   // ...
 * })
 * ```
 */
export function getRequestLogger(
  c: Context,
  name?: string,
  options: { service?: string } = {}
): StructuredLogger {
  const correlationId = c.req.header(CORRELATION_ID_HEADER) ?? c.res.headers.get(CORRELATION_ID_HEADER)
  const traceContext = extractTraceContext(c.req.raw.headers)

  const logger = createStructuredLogger({
    service: options.service ?? name ?? 'dotdo',
  })

  return logger.child({
    correlationId: correlationId ?? undefined,
    traceId: traceContext?.traceId,
    spanId: traceContext?.spanId,
  })
}

/**
 * Timing middleware - adds X-Response-Time header
 */
export function timing(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const start = Date.now()
    await next()
    const duration = Date.now() - start
    c.header('X-Response-Time', `${duration}ms`)
  }
}

/**
 * Request ID middleware - ensures every request has a correlation ID
 */
export function requestId(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const existing = c.req.header(CORRELATION_ID_HEADER)
    const id = existing ?? generateCorrelationId()
    c.header(CORRELATION_ID_HEADER, id)
    await next()
  }
}
