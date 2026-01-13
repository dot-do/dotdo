/**
 * @dotdo/datadog - Datadog SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for Datadog SDKs backed by Durable Objects
 * with edge-native performance and zero cold start impact.
 *
 * Features:
 * - Metrics API (counters, gauges, histograms, distributions)
 * - Structured logging with DD tags
 * - APM distributed tracing
 * - Dashboards and monitors API
 * - Service catalog
 *
 * @example Basic Metrics
 * ```typescript
 * import { MetricsClient } from '@dotdo/datadog'
 *
 * const metrics = new MetricsClient({
 *   service: 'my-api',
 *   env: 'production',
 * })
 *
 * // Count requests
 * metrics.increment('http.requests', 1, {
 *   tags: ['method:GET', 'path:/api/users'],
 * })
 *
 * // Track latency
 * metrics.histogram('http.latency', 125.5, {
 *   tags: ['service:api'],
 *   unit: 'millisecond',
 * })
 *
 * // Set a gauge
 * metrics.gauge('system.memory', 1024, {
 *   unit: 'megabyte',
 * })
 * ```
 *
 * @example Structured Logging
 * ```typescript
 * import { Logger } from '@dotdo/datadog'
 *
 * const logger = new Logger({
 *   service: 'my-api',
 *   env: 'production',
 * })
 *
 * logger.info('Request received', {
 *   method: 'POST',
 *   path: '/api/users',
 *   userId: 'user-123',
 * })
 *
 * logger.error('Database connection failed', {
 *   error: { kind: 'ConnectionError', message: 'Timeout' },
 * })
 * ```
 *
 * @example APM Tracing
 * ```typescript
 * import { init, tracer } from '@dotdo/datadog/tracing'
 *
 * init({ service: 'my-api', env: 'production' })
 *
 * const span = tracer().startSpan('http.request', {
 *   resource: 'GET /api/users',
 *   type: 'web',
 * })
 *
 * try {
 *   // ... handle request
 *   span.setTag('http.status_code', 200)
 * } catch (error) {
 *   span.setError(error)
 * } finally {
 *   span.finish()
 * }
 * ```
 *
 * @example Monitors
 * ```typescript
 * import { createMonitor, metricAlert, MonitorsClient } from '@dotdo/datadog'
 *
 * const client = new MonitorsClient()
 *
 * // Create a metric alert
 * const monitor = await client.create(
 *   metricAlert('High Error Rate', 'avg:error.rate{*}', {
 *     critical: 0.05,
 *     warning: 0.01,
 *   })
 * )
 *
 * // Or use the fluent builder
 * const custom = createMonitor()
 *   .name('API Latency')
 *   .type('metric alert')
 *   .query('avg(last_5m):avg:http.latency{service:api} > 1000')
 *   .critical(1000)
 *   .warning(500)
 *   .notifyNoData(10)
 *   .build()
 * ```
 *
 * @see https://docs.datadoghq.com/api/
 */

// =============================================================================
// Metrics API
// =============================================================================

export {
  MetricsClient,
  createMetricsClient,
  getDefaultClient,
  setDefaultClient,
  clearDefaultClient,
  increment,
  decrement,
  gauge,
  histogram,
  distribution,
  timing,
  type MetricOptions,
  type HistogramStats,
} from './metrics.js'

// =============================================================================
// Logs API
// =============================================================================

export {
  Logger,
  createLogger,
  getDefaultLogger,
  setDefaultLogger,
  clearDefaultLogger,
  debug,
  info,
  warn,
  error,
  critical,
  type LoggerConfig,
  type LogHandler,
} from './logs.js'

// =============================================================================
// APM Tracing API
// =============================================================================

export {
  Tracer,
  Span,
  Scope,
  createTracer,
  init as initTracer,
  tracer,
  _clear as _clearTracer,
} from './tracing.js'

// =============================================================================
// Monitors & Dashboards API
// =============================================================================

export {
  // Monitor builders
  MonitorBuilder,
  createMonitor,
  metricAlert,
  logAlert,
  serviceCheck,
  apmErrorRate,
  latencyMonitor,

  // Dashboard builders
  DashboardBuilder,
  createDashboard,

  // Clients
  MonitorsClient,
  DashboardsClient,
  ServiceCatalogClient,
  createMonitorsClient,
  createDashboardsClient,
  createServiceCatalogClient,
} from './monitors.js'

// =============================================================================
// Types
// =============================================================================

export type {
  // Metrics
  MetricType,
  MetricPoint,
  MetricSeries,
  MetricUnit,

  // Logging
  LogLevel,
  LogStatus,
  LogEntry,
  LogContext,

  // Tracing
  SpanContext,
  SpanType,
  SpanStatus,
  SpanOptions,
  Span as SpanInterface,
  Tracer as TracerInterface,
  TracerOptions,
  TracerScope,
  SerializedSpan,

  // Monitors
  Monitor,
  MonitorType,
  MonitorState,
  MonitorOptions,
  MonitorThresholds,

  // Dashboards
  Dashboard,
  DashboardWidget,
  WidgetDefinition,
  WidgetRequest,
  WidgetQuery,
  WidgetLayout,
  WidgetStyle,
  WidgetTime,
  WidgetFormula,
  TemplateVariable,

  // Service Catalog
  ServiceDefinition,
  ServiceContact,
  ServiceLink,
  ServiceExternalResource,

  // Config
  DatadogConfig,
  DatadogResponse,
  Transport,
} from './types.js'
