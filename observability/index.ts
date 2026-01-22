/**
 * @dotdo/observability - Structured Logging and Distributed Tracing
 *
 * Provides comprehensive observability for dotdo applications:
 *
 * - **Structured Logging**: JSON-formatted logs with levels, context, and sanitization
 * - **Distributed Tracing**: W3C Trace Context compatible spans with hierarchies
 * - **Context Propagation**: Request-scoped context across async boundaries
 * - **Hono Middleware**: Automatic request tracing and logging
 *
 * @example
 * ```typescript
 * import {
 *   createStructuredLogger,
 *   createTracer,
 *   observability,
 *   runWithContext,
 * } from '@dotdo/observability'
 *
 * // Structured logging
 * const logger = createStructuredLogger({ service: 'my-service' })
 * logger.info('User created', { userId: '123', email: 'user@example.com' })
 *
 * // Distributed tracing
 * const tracer = createTracer({ name: 'my-service' })
 * tracer.startActiveSpan('processOrder', (span) => {
 *   span.setAttribute('order.id', orderId)
 *   // ... process order
 * })
 *
 * // Hono middleware
 * const app = new Hono()
 * app.use('/*', observability({ service: 'my-api' }))
 * ```
 *
 * @module @dotdo/observability
 */

// Structured logging
export {
  LogLevel,
  parseLogLevel,
  configureLogger,
  getLoggerConfig,
  createStructuredLogger,
  logger,
  type LogFormat,
  type LoggerConfig,
  type LogEntry,
  type LogContext,
  type StructuredLogger,
} from './logger'

// Distributed tracing
export {
  generateTraceId,
  generateSpanId,
  SpanStatusCode,
  SpanKind,
  createTracer,
  getTracer,
  setGlobalTracer,
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext,
  createConsoleExporter,
  createBatchSpanProcessor,
  instrument,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
  type SpanStatus,
  type SpanEvent,
  type SpanLink,
  type SpanContext,
  type SpanData,
  type Span,
  type SpanOptions,
  type Tracer,
  type TracerConfig,
  type SpanExporter,
  type SpanProcessor,
} from './tracing'

// Context propagation
export {
  generateCorrelationId,
  createObservabilityContext,
  getContext,
  getOrCreateContext,
  runWithContext,
  runInNewContext,
  runWithChildContext,
  getCorrelationId,
  getTraceContext,
  getActiveSpan,
  setActiveSpan,
  getBaggageItem,
  setBaggageItem,
  getAllBaggage,
  getMetadata,
  setMetadata,
  parseBaggage,
  formatBaggage,
  extractContextFromHeaders,
  injectContextToHeaders,
  createContextHolder,
  resetContextStack,
  BAGGAGE_HEADER,
  CORRELATION_ID_HEADER,
  type Baggage,
  type ObservabilityContext,
  type ContextHolder,
} from './context'

// Hono middleware
export {
  observability,
  getRequestLogger,
  timing,
  requestId,
  type ObservabilityMiddlewareOptions,
} from './middleware'

// Metrics collection
export {
  MetricType,
  createMeter,
  getMeter,
  setGlobalMeter,
  createConsoleMetricsExporter,
  createPeriodicReporter,
  MetricNames,
  type MetricAttributes,
  type MetricDataPoint,
  type HistogramBuckets,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
  type MetricOptions,
  type HistogramOptions,
  type MeterConfig,
  type MetricsExporter,
} from './metrics'

// Durable Object integration
export {
  createDOObservability,
  createDOMetrics,
  extractDOContextFromHeaders,
  injectDOContextToHeaders,
  createStorageTracker,
  type DOObservabilityConfig,
  type DOObservabilityContext,
  type DOMetrics,
} from './do-integration'

// API integration
export {
  createAPIObservabilityMiddleware,
  createAPIMetrics,
  createRouteTracer,
  metricsEndpoint,
  type APIObservabilityConfig,
  type APIMetrics,
} from './api-integration'
