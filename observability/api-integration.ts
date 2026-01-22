/**
 * API Integration for Observability
 *
 * Provides observability utilities specifically designed for Hono APIs:
 * - Enhanced middleware with metrics
 * - Route-level tracing
 * - Error tracking
 * - Response time histograms
 *
 * @module observability/api-integration
 */

import type { Context, Next, MiddlewareHandler } from 'hono'
import { createMeter, MetricNames, type Meter, type Counter, type Gauge, type Histogram } from './metrics'
import { createStructuredLogger, type StructuredLogger, type LogContext, LogLevel } from './logger'
import {
  createTracer,
  SpanKind,
  SpanStatusCode,
  extractTraceContext,
  injectTraceContext,
  type Tracer,
  type Span,
  type SpanContext,
} from './tracing'
import {
  createObservabilityContext,
  extractContextFromHeaders,
  runWithContext,
  generateCorrelationId,
  CORRELATION_ID_HEADER,
} from './context'

/**
 * Configuration for API observability
 */
export interface APIObservabilityConfig {
  /** Service name for logs and traces */
  serviceName?: string
  /** Log level */
  logLevel?: LogLevel
  /** Enable request tracing */
  enableTracing?: boolean
  /** Enable metrics collection */
  enableMetrics?: boolean
  /** Enable request logging */
  enableLogging?: boolean
  /** Paths to exclude from observability (e.g., health checks) */
  excludePaths?: string[]
  /** Headers to redact from logs */
  excludeHeaders?: string[]
  /** Custom logger */
  logger?: StructuredLogger
  /** Custom tracer */
  tracer?: Tracer
  /** Custom meter */
  meter?: Meter
}

/**
 * Metrics specific to HTTP APIs
 */
export interface APIMetrics {
  /** Request counter by method and status */
  requestCount: Counter
  /** Request duration histogram */
  requestDuration: Histogram
  /** Active request gauge */
  activeRequests: Gauge
  /** Error counter by type */
  errorCount: Counter
  /** Request size histogram */
  requestSize: Histogram
  /** Response size histogram */
  responseSize: Histogram
}

/**
 * Default paths to exclude from observability
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
 * Default headers to redact
 */
const DEFAULT_EXCLUDE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]

/**
 * Create API-specific metrics
 */
export function createAPIMetrics(meter: Meter): APIMetrics {
  return {
    requestCount: meter.createCounter(MetricNames.RPC_REQUEST_COUNT, {
      description: 'Number of HTTP requests',
      unit: 'requests',
    }),
    requestDuration: meter.createHistogram(MetricNames.HTTP_REQUEST_DURATION, {
      description: 'HTTP request duration',
      unit: 'ms',
      boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    }),
    activeRequests: meter.createGauge(MetricNames.HTTP_ACTIVE_REQUESTS, {
      description: 'Number of active HTTP requests',
      unit: 'requests',
    }),
    errorCount: meter.createCounter(MetricNames.RPC_ERROR_COUNT, {
      description: 'Number of HTTP errors',
      unit: 'errors',
    }),
    requestSize: meter.createHistogram(MetricNames.HTTP_REQUEST_SIZE, {
      description: 'HTTP request body size',
      unit: 'bytes',
      boundaries: [100, 1000, 10000, 100000, 1000000],
    }),
    responseSize: meter.createHistogram(MetricNames.HTTP_RESPONSE_SIZE, {
      description: 'HTTP response body size',
      unit: 'bytes',
      boundaries: [100, 1000, 10000, 100000, 1000000],
    }),
  }
}

/**
 * Get HTTP status category
 */
function getStatusCategory(status: number): string {
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  if (status >= 300) return '3xx'
  if (status >= 200) return '2xx'
  return '1xx'
}

/**
 * Sanitize headers for logging
 */
function sanitizeHeaders(
  headers: Headers,
  excludeHeaders: string[]
): Record<string, string> {
  const result: Record<string, string> = {}
  const excludeSet = new Set(excludeHeaders.map(h => h.toLowerCase()))

  headers.forEach((value, key) => {
    if (excludeSet.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = value
    }
  })

  return result
}

/**
 * Create enhanced observability middleware for Hono APIs
 *
 * This middleware provides:
 * - Request/response logging with correlation IDs
 * - Distributed tracing with W3C Trace Context
 * - Metrics collection (request count, duration, errors)
 * - Context propagation across async boundaries
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createAPIObservabilityMiddleware } from '@dotdo/observability'
 *
 * const app = new Hono()
 * app.use('/*', createAPIObservabilityMiddleware({ serviceName: 'my-api' }))
 * ```
 */
export function createAPIObservabilityMiddleware(
  config: APIObservabilityConfig = {}
): MiddlewareHandler {
  const {
    serviceName = 'dotdo-api',
    logLevel = LogLevel.INFO,
    enableTracing = true,
    enableMetrics = true,
    enableLogging = true,
    excludePaths = DEFAULT_EXCLUDE_PATHS,
    excludeHeaders = DEFAULT_EXCLUDE_HEADERS,
  } = config

  const logger = config.logger ?? createStructuredLogger({ service: serviceName, level: logLevel })
  const tracer = config.tracer ?? createTracer({ name: serviceName })
  const meter = config.meter ?? createMeter({ name: serviceName })
  const metrics = createAPIMetrics(meter)

  return async (c: Context, next: Next) => {
    const startTime = Date.now()
    const { method, url } = c.req
    const parsedUrl = new URL(url)
    const pathname = parsedUrl.pathname

    // Check if path should be excluded
    const isExcluded = excludePaths.some(p =>
      pathname === p || pathname.startsWith(p + '/')
    )

    if (isExcluded) {
      await next()
      return
    }

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

    // Metric attributes
    const baseAttributes = {
      'http.method': method,
      'http.route': pathname,
    }

    // Track active requests
    if (enableMetrics) {
      metrics.activeRequests.add(1, baseAttributes)
    }

    // Create request span
    let span: Span | undefined
    if (enableTracing) {
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

    // Log request start
    if (enableLogging) {
      const childContext: Record<string, unknown> = { correlationId }
      if (span) {
        childContext['traceId'] = span.context().traceId
        childContext['spanId'] = span.context().spanId
      }
      const requestLogger = logger.child(childContext)

      requestLogger.debug(`Request: ${method} ${pathname}`, {
        query: parsedUrl.search,
        headers: sanitizeHeaders(c.req.raw.headers, excludeHeaders),
      })
    }

    // Track request size
    const contentLength = c.req.header('content-length')
    if (enableMetrics && contentLength) {
      metrics.requestSize.record(parseInt(contentLength, 10), baseAttributes)
    }

    let error: Error | undefined

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
      const statusCategory = getStatusCategory(status)

      // Final attributes with status
      const finalAttributes = {
        ...baseAttributes,
        'http.status_code': status,
        'http.status_category': statusCategory,
      }

      // Update metrics
      if (enableMetrics) {
        metrics.activeRequests.add(-1, baseAttributes)
        metrics.requestCount.inc(finalAttributes)
        metrics.requestDuration.record(duration, finalAttributes)

        if (status >= 400) {
          metrics.errorCount.inc({
            ...finalAttributes,
            'error.type': status >= 500 ? 'server_error' : 'client_error',
          })
        }

        // Track response size
        const responseContentLength = c.res?.headers.get('content-length')
        if (responseContentLength) {
          metrics.responseSize.record(parseInt(responseContentLength, 10), finalAttributes)
        }
      }

      // Update span
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
      if (enableLogging) {
        const responseChildContext: Record<string, unknown> = { correlationId }
        if (span) {
          responseChildContext['traceId'] = span.context().traceId
          responseChildContext['spanId'] = span.context().spanId
        }
        const responseLogger = logger.child(responseChildContext)

        const logData = {
          method,
          path: pathname,
          status,
          duration,
          statusCategory,
          ...(error && {
            error: {
              name: error.name,
              message: error.message,
            },
          }),
        }

        if (status >= 500) {
          responseLogger.error(`Response: ${method} ${pathname} ${status}`, logData)
        } else if (status >= 400) {
          responseLogger.warn(`Response: ${method} ${pathname} ${status}`, logData)
        } else {
          responseLogger.info(`Response: ${method} ${pathname} ${status}`, logData)
        }
      }
    }
  }
}

/**
 * Create a route-specific tracer for custom instrumentation
 */
export function createRouteTracer(
  c: Context,
  config: { serviceName?: string; tracer?: Tracer } = {}
): {
  /** Start a span for a specific operation */
  startSpan(name: string, attributes?: Record<string, unknown>): Span
  /** Run a function within a span */
  withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, attributes?: Record<string, unknown>): Promise<T>
} {
  const tracer = config.tracer ?? createTracer({ name: config.serviceName ?? 'dotdo-api' })
  const parentContext = extractTraceContext(c.req.raw.headers)

  return {
    startSpan(name: string, attributes?: Record<string, unknown>): Span {
      const spanOptions: { kind: typeof SpanKind.INTERNAL; parent?: SpanContext; attributes?: Record<string, unknown> } = {
        kind: SpanKind.INTERNAL,
      }
      if (parentContext) {
        spanOptions.parent = parentContext
      }
      if (attributes) {
        spanOptions.attributes = attributes
      }
      return tracer.startSpan(name, spanOptions)
    },

    async withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
      const spanOptions: { kind: typeof SpanKind.INTERNAL; parent?: SpanContext; attributes?: Record<string, unknown> } = {
        kind: SpanKind.INTERNAL,
      }
      if (parentContext) {
        spanOptions.parent = parentContext
      }
      if (attributes) {
        spanOptions.attributes = attributes
      }
      const span = tracer.startSpan(name, spanOptions)

      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()
        return result
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.end()
        throw error
      }
    },
  }
}

/**
 * Metrics endpoint middleware
 *
 * Exposes collected metrics in a simple format for scraping.
 */
export function metricsEndpoint(meter?: Meter): MiddlewareHandler {
  const m = meter ?? createMeter({ name: 'dotdo-api' })

  return async (c: Context) => {
    const metrics = m.collect()

    // Format as simple text
    const lines: string[] = []
    for (const metric of metrics) {
      const labels = Object.entries(metric.attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      const labelStr = labels ? `{${labels}}` : ''
      lines.push(`${metric.name}${labelStr} ${metric.value} ${metric.timestamp}`)
    }

    return c.text(lines.join('\n'))
  }
}
