/**
 * @dotdo/datadog - Type Definitions
 *
 * Core types for Datadog SDK compatibility layer.
 *
 * @module @dotdo/datadog/types
 */

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Metric type for Datadog.
 */
export type MetricType = 'count' | 'gauge' | 'histogram' | 'distribution' | 'rate' | 'set'

/**
 * A single metric point.
 */
export interface MetricPoint {
  /** Timestamp in seconds */
  timestamp: number
  /** Metric value */
  value: number
}

/**
 * A metric series to submit.
 */
export interface MetricSeries {
  /** Metric name */
  metric: string
  /** Metric type */
  type: MetricType
  /** Data points */
  points: MetricPoint[]
  /** Host name */
  host?: string
  /** Tags */
  tags?: string[]
  /** Metric unit */
  unit?: MetricUnit
  /** Interval in seconds (for rate metrics) */
  interval?: number
}

/**
 * Metric unit types.
 */
export type MetricUnit =
  | 'byte'
  | 'kilobyte'
  | 'megabyte'
  | 'gigabyte'
  | 'terabyte'
  | 'petabyte'
  | 'exabyte'
  | 'bit'
  | 'percent'
  | 'nanosecond'
  | 'microsecond'
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'request'
  | 'operation'
  | 'error'
  | 'connection'
  | 'thread'
  | 'process'
  | 'query'
  | 'message'
  | 'record'
  | 'object'
  | 'file'
  | 'dollar'
  | 'cent'
  | 'euro'
  | 'pound'
  | 'yen'
  | 'page'
  | 'session'
  | 'user'

// =============================================================================
// Logging Types
// =============================================================================

/**
 * Log level for Datadog logs.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical'

/**
 * Log status mapping.
 */
export type LogStatus = 'debug' | 'info' | 'warning' | 'error' | 'critical'

/**
 * A structured log entry.
 */
export interface LogEntry {
  /** Log message */
  message: string
  /** Log level/status */
  status?: LogStatus
  /** Service name */
  service?: string
  /** Hostname */
  hostname?: string
  /** Additional attributes */
  [key: string]: unknown
  /** Timestamp (ISO format or unix) */
  '@timestamp'?: string
  /** DD tags */
  ddtags?: string
}

/**
 * Log context that persists across log calls.
 */
export interface LogContext {
  service?: string
  hostname?: string
  env?: string
  version?: string
  source?: string
  tags?: string[]
  [key: string]: unknown
}

// =============================================================================
// APM Tracing Types
// =============================================================================

/**
 * Span context for distributed tracing.
 */
export interface SpanContext {
  /** Trace ID (64-bit or 128-bit hex) */
  traceId: string
  /** Span ID (64-bit hex) */
  spanId: string
  /** Parent span ID */
  parentId?: string
  /** Sampling priority */
  samplingPriority?: number
  /** Origin tag */
  origin?: string
  /** Baggage items */
  baggage?: Record<string, string>
}

/**
 * Span type categorizing the span.
 */
export type SpanType = 'web' | 'http' | 'sql' | 'cache' | 'custom' | 'worker'

/**
 * Span status for error tracking.
 */
export type SpanStatus = 'ok' | 'error'

/**
 * Span options for creating spans.
 */
export interface SpanOptions {
  /** Operation name */
  name: string
  /** Service name */
  service?: string
  /** Resource name */
  resource?: string
  /** Span type */
  type?: SpanType
  /** Tags */
  tags?: Record<string, string | number | boolean>
  /** Start time (timestamp in ms) */
  startTime?: number
  /** Parent span */
  childOf?: Span | SpanContext
  /** Error flag */
  error?: boolean
}

/**
 * A trace span.
 */
export interface Span {
  /** Span context */
  context(): SpanContext
  /** Set a tag on the span */
  setTag(key: string, value: unknown): Span
  /** Add multiple tags */
  addTags(tags: Record<string, unknown>): Span
  /** Set operation name */
  setOperationName(name: string): Span
  /** Log an event */
  log(data: Record<string, unknown>): Span
  /** Finish the span */
  finish(endTime?: number): void
  /** Get the trace ID */
  traceId(): string
  /** Get the span ID */
  spanId(): string
  /** Get the service name */
  service(): string
  /** Get the resource name */
  resource(): string
  /** Set error on span */
  setError(error: Error | string): Span
  /** Get span duration */
  duration(): number | undefined
  /** Check if span is finished */
  isFinished(): boolean
}

/**
 * Tracer configuration options.
 */
export interface TracerOptions {
  /** Service name */
  service?: string
  /** Environment */
  env?: string
  /** Version */
  version?: string
  /** Sample rate (0-1) */
  sampleRate?: number
  /** Enable runtime metrics */
  runtimeMetrics?: boolean
  /** Log injection */
  logInjection?: boolean
  /** Debug mode */
  debug?: boolean
  /** Tags to add to all spans */
  tags?: Record<string, string>
  /** Hostname */
  hostname?: string
}

/**
 * Tracer interface for creating spans.
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: Partial<SpanOptions>): Span
  /** Inject context into headers */
  inject(context: SpanContext, format: string, carrier: Record<string, string>): void
  /** Extract context from headers */
  extract(format: string, carrier: Record<string, string>): SpanContext | null
  /** Get the currently active span */
  activeSpan(): Span | null
  /** Wrap a function with a span */
  wrap<T extends (...args: any[]) => any>(name: string, fn: T, options?: Partial<SpanOptions>): T
  /** Trace a promise */
  trace<T>(name: string, fn: (span: Span) => Promise<T>, options?: Partial<SpanOptions>): Promise<T>
  /** Get tracer scope */
  scope(): TracerScope
}

/**
 * Tracer scope for managing active spans.
 */
export interface TracerScope {
  /** Get active span */
  active(): Span | null
  /** Activate a span */
  activate<T>(span: Span, fn: () => T): T
  /** Bind a function to current context */
  bind<T extends (...args: any[]) => any>(fn: T): T
}

// =============================================================================
// Service Catalog Types
// =============================================================================

/**
 * Service definition for the service catalog.
 */
export interface ServiceDefinition {
  /** Service name (required) */
  'dd-service': string
  /** Schema version */
  'schema-version'?: string
  /** Team owning the service */
  team?: string
  /** Service description */
  description?: string
  /** Application type */
  application?: string
  /** Tier (critical, high, medium, low) */
  tier?: 'critical' | 'high' | 'medium' | 'low'
  /** Lifecycle stage */
  lifecycle?: 'production' | 'staging' | 'development' | 'deprecated'
  /** Contacts */
  contacts?: ServiceContact[]
  /** Links */
  links?: ServiceLink[]
  /** Tags */
  tags?: string[]
  /** External resources */
  'external-resources'?: ServiceExternalResource[]
}

/**
 * Service contact information.
 */
export interface ServiceContact {
  /** Contact name */
  name: string
  /** Contact type */
  type: 'email' | 'slack' | 'pagerduty' | 'opsgenie' | 'ms-teams'
  /** Contact value */
  contact: string
}

/**
 * Service link.
 */
export interface ServiceLink {
  /** Link name */
  name: string
  /** Link type */
  type: 'doc' | 'runbook' | 'repo' | 'dashboard' | 'other'
  /** URL */
  url: string
}

/**
 * External resource reference.
 */
export interface ServiceExternalResource {
  /** Provider name */
  provider: string
  /** Resource type */
  type: string
  /** External ID */
  'external-id': string
}

// =============================================================================
// Dashboard & Monitor Types
// =============================================================================

/**
 * Dashboard definition.
 */
export interface Dashboard {
  /** Dashboard ID */
  id?: string
  /** Dashboard title */
  title: string
  /** Dashboard description */
  description?: string
  /** Layout type */
  layout_type: 'ordered' | 'free'
  /** Widgets */
  widgets: DashboardWidget[]
  /** Template variables */
  template_variables?: TemplateVariable[]
  /** Is read only */
  is_read_only?: boolean
  /** Notify list */
  notify_list?: string[]
  /** Reflow type */
  reflow_type?: 'fixed' | 'auto'
}

/**
 * Dashboard widget.
 */
export interface DashboardWidget {
  /** Widget ID */
  id?: number
  /** Widget definition */
  definition: WidgetDefinition
  /** Widget layout */
  layout?: WidgetLayout
}

/**
 * Widget layout.
 */
export interface WidgetLayout {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Widget definition (simplified).
 */
export interface WidgetDefinition {
  /** Widget type */
  type: string
  /** Title */
  title?: string
  /** Requests */
  requests?: WidgetRequest[]
  /** Custom unit */
  custom_unit?: string
  /** Time */
  time?: WidgetTime
  [key: string]: unknown
}

/**
 * Widget request.
 */
export interface WidgetRequest {
  /** Query */
  q?: string
  /** Queries */
  queries?: WidgetQuery[]
  /** Display type */
  display_type?: 'line' | 'area' | 'bars'
  /** Style */
  style?: WidgetStyle
  /** Aggregator */
  aggregator?: 'avg' | 'sum' | 'min' | 'max' | 'last'
  /** Formulas */
  formulas?: WidgetFormula[]
}

/**
 * Widget query.
 */
export interface WidgetQuery {
  /** Data source */
  data_source: 'metrics' | 'logs' | 'apm_stats'
  /** Query string */
  query: string
  /** Name */
  name?: string
}

/**
 * Widget style.
 */
export interface WidgetStyle {
  palette?: string
  line_type?: 'solid' | 'dashed' | 'dotted'
  line_width?: 'normal' | 'thin' | 'thick'
}

/**
 * Widget time.
 */
export interface WidgetTime {
  live_span?: string
}

/**
 * Widget formula.
 */
export interface WidgetFormula {
  formula: string
  alias?: string
}

/**
 * Template variable.
 */
export interface TemplateVariable {
  name: string
  prefix?: string
  available_values?: string[]
  default?: string
}

/**
 * Monitor definition.
 */
export interface Monitor {
  /** Monitor ID */
  id?: number
  /** Monitor name */
  name: string
  /** Monitor type */
  type: MonitorType
  /** Query */
  query: string
  /** Message */
  message?: string
  /** Tags */
  tags?: string[]
  /** Priority */
  priority?: 1 | 2 | 3 | 4 | 5
  /** Options */
  options?: MonitorOptions
  /** Overall state */
  overall_state?: MonitorState
  /** Creator */
  creator?: { name: string; email: string }
}

/**
 * Monitor type.
 */
export type MonitorType =
  | 'metric alert'
  | 'query alert'
  | 'service check'
  | 'event alert'
  | 'log alert'
  | 'process alert'
  | 'rum alert'
  | 'trace-analytics alert'
  | 'slo alert'
  | 'event-v2 alert'
  | 'audit alert'
  | 'ci-pipelines alert'
  | 'ci-tests alert'
  | 'error-tracking alert'

/**
 * Monitor state.
 */
export type MonitorState = 'OK' | 'Alert' | 'Warn' | 'No Data' | 'Unknown' | 'Ignored' | 'Skipped'

/**
 * Monitor options.
 */
export interface MonitorOptions {
  /** Thresholds */
  thresholds?: MonitorThresholds
  /** Notify no data */
  notify_no_data?: boolean
  /** No data timeframe (minutes) */
  no_data_timeframe?: number
  /** Notify audit */
  notify_audit?: boolean
  /** Timeout (hours) */
  timeout_h?: number
  /** Include tags */
  include_tags?: boolean
  /** Renotify interval (minutes) */
  renotify_interval?: number
  /** Escalation message */
  escalation_message?: string
  /** Require full window */
  require_full_window?: boolean
  /** Evaluation delay (seconds) */
  evaluation_delay?: number
  /** New group delay (seconds) */
  new_group_delay?: number
  /** New host delay (seconds) */
  new_host_delay?: number
  /** Groupby simple monitor */
  groupby_simple_monitor?: boolean
}

/**
 * Monitor thresholds.
 */
export interface MonitorThresholds {
  critical?: number
  critical_recovery?: number
  warning?: number
  warning_recovery?: number
  ok?: number
}

// =============================================================================
// Client Types
// =============================================================================

/**
 * Datadog client configuration.
 */
export interface DatadogConfig {
  /** API key */
  apiKey?: string
  /** Application key (for some APIs) */
  appKey?: string
  /** Site (e.g., 'datadoghq.com', 'datadoghq.eu') */
  site?: string
  /** Service name */
  service?: string
  /** Environment */
  env?: string
  /** Version */
  version?: string
  /** Default tags */
  tags?: string[]
  /** Hostname */
  hostname?: string
  /** Enable batching */
  batching?: boolean
  /** Batch size */
  batchSize?: number
  /** Flush interval (ms) */
  flushInterval?: number
  /** Debug mode */
  debug?: boolean
}

/**
 * API response from Datadog.
 */
export interface DatadogResponse<T = unknown> {
  /** Response data */
  data?: T
  /** Errors */
  errors?: string[]
  /** Status */
  status?: 'ok' | 'error'
}

/**
 * Transport interface for sending data to Datadog.
 */
export interface Transport {
  /** Send metrics */
  sendMetrics(series: MetricSeries[]): Promise<DatadogResponse>
  /** Send logs */
  sendLogs(logs: LogEntry[]): Promise<DatadogResponse>
  /** Send traces */
  sendTraces(spans: SerializedSpan[]): Promise<DatadogResponse>
  /** Flush pending data */
  flush(): Promise<void>
}

/**
 * Serialized span for transport.
 */
export interface SerializedSpan {
  trace_id: string
  span_id: string
  parent_id?: string
  name: string
  service: string
  resource: string
  type: string
  start: number
  duration: number
  error: number
  meta: Record<string, string>
  metrics: Record<string, number>
}
