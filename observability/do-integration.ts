/**
 * Durable Object Integration for Observability
 *
 * Provides observability utilities specifically designed for Durable Objects:
 * - Request tracing across DO boundaries
 * - Storage operation metrics
 * - Alarm execution tracking
 * - WebSocket connection monitoring
 *
 * @module observability/do-integration
 */

import { createMeter, MetricNames, type Meter, type Counter, type Gauge, type Histogram } from './metrics'
import { createStructuredLogger, type StructuredLogger, type LogContext } from './logger'
import {
  createTracer,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type Span,
  type SpanContext,
} from './tracing'
import {
  createObservabilityContext,
  runWithContext,
  type ObservabilityContext,
} from './context'

/**
 * Configuration for DO observability
 */
export interface DOObservabilityConfig {
  /** Service name for logs and traces */
  serviceName?: string
  /** Durable Object ID (string or DurableObjectId) */
  doId?: string | { toString(): string }
  /** Durable Object class name */
  doClassName?: string
  /** Enable request tracing */
  enableTracing?: boolean
  /** Enable metrics collection */
  enableMetrics?: boolean
  /** Enable structured logging */
  enableLogging?: boolean
}

/**
 * DO observability context - passed to DO methods
 */
export interface DOObservabilityContext {
  /** Structured logger with DO context */
  logger: StructuredLogger
  /** Tracer for creating spans */
  tracer: Tracer
  /** Meter for metrics */
  meter: Meter
  /** Current correlation ID */
  correlationId: string
  /** Current trace context */
  traceContext?: SpanContext
  /** Active span (if any) */
  span?: Span
}

/**
 * Metrics specific to Durable Objects
 */
export interface DOMetrics {
  /** Request counter by method */
  requestCount: Counter
  /** Request duration histogram */
  requestDuration: Histogram
  /** Error counter */
  errorCount: Counter
  /** Storage operation counter */
  storageOperations: Counter
  /** Alarm execution counter */
  alarmExecutions: Counter
  /** WebSocket connection gauge */
  websocketConnections: Gauge
}

/**
 * Create DO-specific metrics
 */
export function createDOMetrics(meter: Meter): DOMetrics {
  return {
    requestCount: meter.createCounter(MetricNames.RPC_REQUEST_COUNT, {
      description: 'Number of DO requests',
      unit: 'requests',
    }),
    requestDuration: meter.createHistogram(MetricNames.DO_REQUEST_DURATION, {
      description: 'DO request duration',
      unit: 'ms',
      boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    }),
    errorCount: meter.createCounter(MetricNames.RPC_ERROR_COUNT, {
      description: 'Number of DO errors',
      unit: 'errors',
    }),
    storageOperations: meter.createCounter(MetricNames.DO_STORAGE_OPERATIONS, {
      description: 'Number of storage operations',
      unit: 'operations',
    }),
    alarmExecutions: meter.createCounter(MetricNames.DO_ALARM_EXECUTIONS, {
      description: 'Number of alarm executions',
      unit: 'executions',
    }),
    websocketConnections: meter.createGauge(MetricNames.DO_WEBSOCKET_CONNECTIONS, {
      description: 'Number of active WebSocket connections',
      unit: 'connections',
    }),
  }
}

/**
 * Create a complete DO observability setup
 */
export function createDOObservability(config: DOObservabilityConfig = {}): {
  logger: StructuredLogger
  tracer: Tracer
  meter: Meter
  metrics: DOMetrics
  /** Create context for a request */
  createRequestContext(correlationId?: string, parentTraceContext?: SpanContext): DOObservabilityContext
  /** Wrap a DO method with observability */
  wrapMethod<T>(name: string, fn: () => T | Promise<T>, context?: DOObservabilityContext): Promise<T>
  /** Track a storage operation */
  trackStorageOperation(operation: string, attributes?: Record<string, string | number | boolean>): void
  /** Track alarm execution */
  trackAlarmExecution(success: boolean, duration: number): void
  /** Update WebSocket connection count */
  updateWebSocketCount(delta: number): void
} {
  const {
    serviceName = 'dotdo-do',
    doId,
    doClassName,
    enableTracing = true,
    enableMetrics = true,
    enableLogging = true,
  } = config

  const doIdStr = doId?.toString() ?? 'unknown'

  // Create base context for all logs
  const baseLogContext: LogContext = {
    doId: doIdStr,
  }
  if (doClassName) {
    baseLogContext['doClass'] = doClassName
  }

  // Create observability components
  const logger = createStructuredLogger({ service: serviceName })
  logger.withContext(baseLogContext)

  const tracer = createTracer({ name: serviceName })
  const meter = createMeter({ name: serviceName })
  const metrics = createDOMetrics(meter)

  return {
    logger,
    tracer,
    meter,
    metrics,

    createRequestContext(correlationId?: string, parentTraceContext?: SpanContext): DOObservabilityContext {
      const obsCtx = createObservabilityContext({
        ...(correlationId !== undefined && { correlationId }),
        ...(parentTraceContext !== undefined && { traceContext: parentTraceContext }),
      })

      const requestLogger = logger.child({
        correlationId: obsCtx.correlationId,
        ...(parentTraceContext?.traceId && { traceId: parentTraceContext.traceId }),
      })

      const result: DOObservabilityContext = {
        logger: requestLogger,
        tracer,
        meter,
        correlationId: obsCtx.correlationId,
      }
      if (parentTraceContext !== undefined) {
        result.traceContext = parentTraceContext
      }
      return result
    },

    async wrapMethod<T>(name: string, fn: () => T | Promise<T>, context?: DOObservabilityContext): Promise<T> {
      const startTime = Date.now()
      const attributes = {
        'do.id': doIdStr,
        'do.method': name,
        ...(doClassName && { 'do.class': doClassName }),
      }

      // Track request count
      if (enableMetrics) {
        metrics.requestCount.inc(attributes)
      }

      // Create span if tracing is enabled
      let span: Span | undefined
      if (enableTracing) {
        span = tracer.startSpan(`DO.${name}`, {
          kind: SpanKind.SERVER,
          attributes,
          ...(context?.traceContext && { parent: context.traceContext }),
        })
      }

      // Log method invocation
      if (enableLogging && context) {
        context.logger.debug(`DO method: ${name}`)
      }

      try {
        const result = await fn()

        // Record success
        if (span) {
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()
        }

        // Record duration
        if (enableMetrics) {
          const duration = Date.now() - startTime
          metrics.requestDuration.record(duration, attributes)
        }

        return result
      } catch (error) {
        // Record error
        if (enableMetrics) {
          metrics.errorCount.inc({
            ...attributes,
            'error.type': error instanceof Error ? error.name : 'UnknownError',
          })
        }

        if (span) {
          span.recordException(error instanceof Error ? error : new Error(String(error)))
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })
          span.end()
        }

        if (enableLogging && context) {
          context.logger.error(`DO method failed: ${name}`, error instanceof Error ? error : { error: String(error) })
        }

        throw error
      }
    },

    trackStorageOperation(operation: string, attributes?: Record<string, string | number | boolean>): void {
      if (enableMetrics) {
        metrics.storageOperations.inc({
          'do.id': doIdStr,
          'storage.operation': operation,
          ...(doClassName && { 'do.class': doClassName }),
          ...attributes,
        })
      }
    },

    trackAlarmExecution(success: boolean, duration: number): void {
      if (enableMetrics) {
        metrics.alarmExecutions.inc({
          'do.id': doIdStr,
          ...(doClassName && { 'do.class': doClassName }),
          'alarm.success': success,
        })
      }

      if (enableLogging) {
        if (success) {
          logger.info(`Alarm executed`, { duration, success })
        } else {
          logger.warn(`Alarm failed`, { duration, success })
        }
      }
    },

    updateWebSocketCount(delta: number): void {
      if (enableMetrics) {
        metrics.websocketConnections.add(delta, {
          'do.id': doIdStr,
          ...(doClassName && { 'do.class': doClassName }),
        })
      }
    },
  }
}

/**
 * Extract DO observability context from request headers
 */
export function extractDOContextFromHeaders(headers: Headers): Partial<{
  correlationId: string
  traceContext: SpanContext
}> {
  const result: Partial<{ correlationId: string; traceContext: SpanContext }> = {}

  // Extract correlation ID
  const correlationId = headers.get('x-correlation-id')
  if (correlationId) {
    result.correlationId = correlationId
  }

  // Extract trace context from traceparent header
  const traceparent = headers.get('traceparent')
  if (traceparent) {
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(traceparent)
    if (match) {
      result.traceContext = {
        traceId: match[1]!,
        spanId: match[2]!,
        traceFlags: parseInt(match[3]!, 16),
      }
    }
  }

  return result
}

/**
 * Inject DO observability context into request headers
 */
export function injectDOContextToHeaders(
  headers: Headers,
  context: DOObservabilityContext
): void {
  // Inject correlation ID
  headers.set('x-correlation-id', context.correlationId)

  // Inject trace context
  if (context.traceContext) {
    const flags = context.traceContext.traceFlags.toString(16).padStart(2, '0')
    headers.set(
      'traceparent',
      `00-${context.traceContext.traceId}-${context.traceContext.spanId}-${flags}`
    )
  }
}

/**
 * Create a storage operation tracker for common DO storage patterns
 */
export function createStorageTracker(
  observability: ReturnType<typeof createDOObservability>
): {
  trackGet(key: string): void
  trackPut(key: string): void
  trackDelete(key: string): void
  trackList(prefix?: string): void
  trackTransaction(operationCount: number): void
} {
  return {
    trackGet(key: string): void {
      observability.trackStorageOperation('get', { 'storage.key_prefix': key.split('/')[0] ?? 'root' })
    },
    trackPut(key: string): void {
      observability.trackStorageOperation('put', { 'storage.key_prefix': key.split('/')[0] ?? 'root' })
    },
    trackDelete(key: string): void {
      observability.trackStorageOperation('delete', { 'storage.key_prefix': key.split('/')[0] ?? 'root' })
    },
    trackList(prefix?: string): void {
      observability.trackStorageOperation('list', { 'storage.key_prefix': prefix ?? 'all' })
    },
    trackTransaction(operationCount: number): void {
      observability.trackStorageOperation('transaction', { 'storage.operation_count': operationCount })
    },
  }
}
