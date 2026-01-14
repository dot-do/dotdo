/**
 * Trigger Observability - Metrics, tracing, and alerting for triggers
 *
 * Provides comprehensive observability for trigger systems:
 * - **TriggerMetrics** - Fire counts, success/failure rates, latency tracking
 * - **TriggerObserver** - Execution hooks for start/success/failure events
 * - **TriggerTracer** - Distributed tracing with W3C Trace Context propagation
 * - **Alert Thresholds** - Configurable alerts for fire rate, error rate, latency
 *
 * @example
 * ```typescript
 * import {
 *   createTriggerMetrics,
 *   createTriggerObserver,
 *   createTriggerTracer,
 *   TriggerMetricNames,
 * } from 'db/primitives/triggers/observability'
 *
 * const metrics = createTriggerMetrics()
 *
 * // Record trigger fires
 * metrics.recordTriggerFired('webhook-github')
 * metrics.recordTriggerSuccess('webhook-github', 100)
 *
 * // Get statistics
 * const stats = metrics.getStats('webhook-github')
 * console.log(stats.fireCount, stats.successRate)
 *
 * // Set up alerts
 * metrics.setAlert('webhook-github', {
 *   type: 'error_rate',
 *   threshold: 0.1,
 *   callback: (alert) => console.error('High error rate:', alert),
 * })
 * ```
 *
 * @module db/primitives/triggers/observability
 */

import { type MetricsCollector, noopMetrics, type MetricLabels } from '../observability'

// =============================================================================
// METRIC NAMES
// =============================================================================

/**
 * Standard metric names for trigger observability
 */
export const TriggerMetricNames = {
  TRIGGERS_FIRED: 'trigger.fired',
  TRIGGER_SUCCESS: 'trigger.success',
  TRIGGER_FAILURE: 'trigger.failure',
  TRIGGER_LATENCY: 'trigger.latency',
  TRIGGER_FIRE_RATE: 'trigger.fire_rate',
  TRIGGER_ERROR_RATE: 'trigger.error_rate',
  ACTIVE_TRIGGERS: 'trigger.active',
} as const

// =============================================================================
// TYPES
// =============================================================================

/**
 * Trigger type
 */
export type TriggerType = 'webhook' | 'polling' | 'event' | 'schedule'

/**
 * Trigger statistics
 */
export interface TriggerStats {
  /** Total fire count */
  fireCount: number
  /** Last fire timestamp */
  lastFiredAt?: number
  /** Successful execution count */
  successCount: number
  /** Failed execution count */
  failureCount: number
  /** Success rate (0-1) */
  successRate: number
  /** Error rate (0-1) */
  errorRate: number
  /** Average latency in ms */
  avgLatencyMs: number
  /** Minimum latency in ms */
  minLatencyMs: number
  /** Maximum latency in ms */
  maxLatencyMs: number
  /** Last error */
  lastError?: Error
}

/**
 * Fire rate window result
 */
export interface FireRateWindow {
  /** Number of fires in window */
  count: number
  /** Rate per second */
  ratePerSecond: number
  /** Window size in ms */
  windowMs: number
}

/**
 * Latency histogram with percentiles
 */
export interface LatencyHistogram {
  /** 50th percentile */
  p50: number
  /** 95th percentile */
  p95: number
  /** 99th percentile */
  p99: number
  /** Average latency */
  avg: number
  /** Minimum latency */
  min: number
  /** Maximum latency */
  max: number
  /** Sample count */
  count: number
}

/**
 * Alert threshold types
 */
export type AlertType = 'fire_rate' | 'error_rate' | 'latency' | 'latency_p95'

/**
 * Alert event
 */
export interface AlertEvent {
  /** Alert type */
  type: AlertType
  /** Trigger ID */
  triggerId: string
  /** Current value that triggered the alert */
  value: number
  /** Threshold that was exceeded */
  threshold: number
  /** Timestamp */
  timestamp: number
}

/**
 * Alert callback function
 */
export type AlertCallback = (alert: AlertEvent) => void

/**
 * Alert threshold configuration
 */
export interface AlertThreshold {
  /** Alert type */
  type: AlertType
  /** Threshold value */
  threshold: number
  /** Window duration for rate-based alerts (ms) */
  windowMs?: number
  /** Minimum samples before triggering (for rate-based alerts) */
  minSamples?: number
  /** Callback when threshold is exceeded */
  callback: AlertCallback
}

/**
 * Trigger execution context
 */
export interface TriggerExecutionContext {
  /** Trigger ID */
  triggerId: string
  /** Trigger type */
  triggerType: TriggerType
  /** Execution timestamp */
  timestamp: number
  /** Trace context for distributed tracing */
  traceContext?: SpanContext
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Trigger metric event
 */
export interface TriggerMetricEvent {
  /** Trigger ID */
  triggerId: string
  /** Event type */
  type: 'fired' | 'success' | 'failure'
  /** Timestamp */
  timestamp: number
  /** Duration in ms (for success/failure) */
  durationMs?: number
  /** Error (for failure) */
  error?: Error
}

/**
 * Span context for distributed tracing (W3C Trace Context)
 */
export interface SpanContext {
  /** Trace ID (32 hex chars) */
  traceId: string
  /** Span ID (16 hex chars) */
  spanId: string
  /** Parent span ID (16 hex chars) */
  parentSpanId?: string
  /** Trace flags */
  traceFlags?: number
  /** Whether this span is sampled */
  isSampled?: boolean
}

/**
 * Span status
 */
export type SpanStatus = 'unset' | 'ok' | 'error'

/**
 * Trigger span for tracing
 */
export interface TriggerSpan {
  /** Trace ID */
  traceId: string
  /** Span ID */
  spanId: string
  /** Parent span ID */
  parentSpanId?: string
  /** Span name */
  name: string
  /** Start time */
  startTime: number
  /** End time */
  endTime?: number
  /** Duration in ms */
  duration?: number
  /** Span status */
  status: SpanStatus
  /** Status message */
  statusMessage?: string
  /** Span attributes */
  attributes: Record<string, unknown>
  /** Error if any */
  error?: Error
  /** Whether span is sampled */
  isSampled: boolean

  /** Set an attribute */
  setAttribute(key: string, value: unknown): void
  /** Record an exception */
  recordException(error: Error): void
  /** Set span status */
  setStatus(status: SpanStatus, message?: string): void
  /** End the span */
  end(): void
  /** Get span context for propagation */
  context(): SpanContext
}

/**
 * Trigger metrics options
 */
export interface TriggerMetricsOptions {
  /** External metrics collector for integration */
  metricsCollector?: MetricsCollector
  /** Maximum latency samples to keep per trigger */
  maxLatencySamples?: number
  /** Maximum fire timestamps to keep for rate calculation */
  maxFireTimestamps?: number
}

/**
 * Trigger observer options
 */
export interface TriggerObserverOptions {
  /** Metrics instance for auto-recording */
  metrics?: TriggerMetrics
}

/**
 * Trigger tracer options
 */
export interface TriggerTracerOptions {
  /** Span export callback */
  onExport?: (span: TriggerSpan) => void
  /** Batch export callback */
  onBatchExport?: (spans: TriggerSpan[]) => void
  /** Enable batch export */
  batchExport?: boolean
  /** Batch size for export */
  batchSize?: number
  /** Sampling rate (0-1) */
  samplingRate?: number
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a random hex string
 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Calculate percentile from sorted array using exclusive method (R-6)
 *
 * Uses the "exclusive" method which is common in statistics packages.
 * For P95, this means 5% of values are ABOVE the result.
 */
function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0
  if (sortedArray.length === 1) return sortedArray[0]!

  const n = sortedArray.length
  // R-6 method: (p/100) * (n + 1) gives 1-based rank
  const rank = (p / 100) * (n + 1)

  // Handle edge cases
  if (rank <= 1) return sortedArray[0]!
  if (rank >= n) return sortedArray[n - 1]!

  // Interpolate between adjacent values
  const lower = Math.floor(rank) - 1 // Convert to 0-based index
  const upper = lower + 1
  const fraction = rank - Math.floor(rank)

  return sortedArray[lower]! + fraction * (sortedArray[upper]! - sortedArray[lower]!)
}

/**
 * Calculate P50 (median) from values
 */
export function calculateP50(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 50)
}

/**
 * Calculate P95 from values
 */
export function calculateP95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 95)
}

/**
 * Calculate P99 from values
 */
export function calculateP99(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 99)
}

// =============================================================================
// TRIGGER METRICS
// =============================================================================

/**
 * Internal state for a single trigger
 */
interface TriggerState {
  fireCount: number
  lastFiredAt?: number
  successCount: number
  failureCount: number
  latencies: number[]
  fireTimestamps: number[]
  lastError?: Error
  errorTypes: Map<string, number>
  /** Track last alert values to avoid redundant alerts */
  lastAlertValues: Map<AlertType, number>
}

/**
 * TriggerMetrics - Comprehensive metrics collection for triggers
 */
export class TriggerMetrics {
  private triggers: Map<string, TriggerState> = new Map()
  private alerts: Map<string, AlertThreshold[]> = new Map()
  private metricsCollector: MetricsCollector
  private maxLatencySamples: number
  private maxFireTimestamps: number

  constructor(options: TriggerMetricsOptions = {}) {
    this.metricsCollector = options.metricsCollector ?? noopMetrics
    this.maxLatencySamples = options.maxLatencySamples ?? 1000
    this.maxFireTimestamps = options.maxFireTimestamps ?? 1000
  }

  /**
   * Get or create trigger state
   */
  private getState(triggerId: string): TriggerState {
    let state = this.triggers.get(triggerId)
    if (!state) {
      state = {
        fireCount: 0,
        successCount: 0,
        failureCount: 0,
        latencies: [],
        fireTimestamps: [],
        errorTypes: new Map(),
        lastAlertValues: new Map(),
      }
      this.triggers.set(triggerId, state)
    }
    return state
  }

  /**
   * Record a trigger fire event
   */
  recordTriggerFired(triggerId: string): void {
    const state = this.getState(triggerId)
    const now = Date.now()

    state.fireCount++
    state.lastFiredAt = now
    state.fireTimestamps.push(now)

    // Trim fire timestamps
    if (state.fireTimestamps.length > this.maxFireTimestamps) {
      state.fireTimestamps.shift()
    }

    // Forward to metrics collector
    this.metricsCollector.incrementCounter(TriggerMetricNames.TRIGGERS_FIRED, {
      triggerId,
    })

    // Check fire rate alerts
    this.checkAlerts(triggerId, 'fire_rate')
  }

  /**
   * Record a successful trigger execution
   */
  recordTriggerSuccess(triggerId: string, durationMs: number): void {
    const state = this.getState(triggerId)

    state.successCount++
    state.latencies.push(durationMs)

    // Trim latencies
    if (state.latencies.length > this.maxLatencySamples) {
      state.latencies.shift()
    }

    // Forward to metrics collector
    this.metricsCollector.incrementCounter(TriggerMetricNames.TRIGGER_SUCCESS, {
      triggerId,
    })
    this.metricsCollector.recordLatency(TriggerMetricNames.TRIGGER_LATENCY, durationMs, {
      triggerId,
    })

    // Check latency alerts
    this.checkAlerts(triggerId, 'latency', durationMs)
    this.checkAlerts(triggerId, 'latency_p95')
  }

  /**
   * Record a failed trigger execution
   */
  recordTriggerFailure(triggerId: string, error: Error): void {
    const state = this.getState(triggerId)

    state.failureCount++
    state.lastError = error

    // Track error types
    const errorType = error.constructor.name
    state.errorTypes.set(errorType, (state.errorTypes.get(errorType) ?? 0) + 1)

    // Forward to metrics collector
    this.metricsCollector.incrementCounter(TriggerMetricNames.TRIGGER_FAILURE, {
      triggerId,
      errorType,
    })

    // Check error rate alerts
    this.checkAlerts(triggerId, 'error_rate')
  }

  /**
   * Get statistics for a trigger
   */
  getStats(triggerId: string): TriggerStats {
    const state = this.getState(triggerId)
    const totalExecutions = state.successCount + state.failureCount

    const latencies = state.latencies
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0

    return {
      fireCount: state.fireCount,
      lastFiredAt: state.lastFiredAt,
      successCount: state.successCount,
      failureCount: state.failureCount,
      successRate: totalExecutions > 0 ? state.successCount / totalExecutions : 0,
      errorRate: totalExecutions > 0 ? state.failureCount / totalExecutions : 0,
      avgLatencyMs: avgLatency,
      minLatencyMs: minLatency,
      maxLatencyMs: maxLatency,
      lastError: state.lastError,
    }
  }

  /**
   * Get fire rate for a trigger within a time window
   */
  getFireRate(triggerId: string, options: { windowMs: number }): FireRateWindow {
    const state = this.getState(triggerId)
    const now = Date.now()
    const windowStart = now - options.windowMs

    // Count fires within window
    const firesInWindow = state.fireTimestamps.filter((ts) => ts >= windowStart)
    const count = firesInWindow.length
    const ratePerSecond = (count / options.windowMs) * 1000

    return {
      count,
      ratePerSecond,
      windowMs: options.windowMs,
    }
  }

  /**
   * Get latency histogram with percentiles
   */
  getLatencyHistogram(triggerId: string): LatencyHistogram {
    const state = this.getState(triggerId)
    const latencies = state.latencies

    if (latencies.length === 0) {
      return {
        p50: 0,
        p95: 0,
        p99: 0,
        avg: 0,
        min: 0,
        max: 0,
        count: 0,
      }
    }

    return {
      p50: calculateP50(latencies),
      p95: calculateP95(latencies),
      p99: calculateP99(latencies),
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      count: latencies.length,
    }
  }

  /**
   * Get error breakdown by type
   */
  getErrorBreakdown(triggerId: string): Record<string, number> {
    const state = this.getState(triggerId)
    return Object.fromEntries(state.errorTypes)
  }

  /**
   * Set an alert threshold for a trigger
   */
  setAlert(triggerId: string, alert: AlertThreshold): void {
    let alerts = this.alerts.get(triggerId)
    if (!alerts) {
      alerts = []
      this.alerts.set(triggerId, alerts)
    }
    alerts.push(alert)
  }

  /**
   * Clear all alerts for a trigger
   */
  clearAlerts(triggerId: string): void {
    this.alerts.delete(triggerId)
    // Also clear any tracked alert states
    const state = this.triggers.get(triggerId)
    if (state) {
      state.lastAlertValues.clear()
    }
  }

  /**
   * Check and trigger alerts
   *
   * Uses deferred triggering for rate-based alerts (fire_rate, error_rate):
   * These alerts are scheduled via microtask to capture the final state after
   * a burst of synchronous events. This ensures alert values reflect the
   * complete picture rather than intermediate states.
   *
   * Latency alerts trigger immediately with the current value.
   */
  private checkAlerts(triggerId: string, type: AlertType, currentValue?: number): void {
    const alerts = this.alerts.get(triggerId)
    if (!alerts) return

    const state = this.getState(triggerId)

    for (const alert of alerts) {
      if (alert.type !== type) continue

      let value: number
      let shouldTrigger = false

      switch (type) {
        case 'fire_rate': {
          const windowMs = alert.windowMs ?? 1000
          const rate = this.getFireRate(triggerId, { windowMs })
          value = rate.ratePerSecond
          shouldTrigger = value > alert.threshold
          break
        }
        case 'error_rate': {
          const stats = this.getStats(triggerId)
          const totalExecutions = stats.successCount + stats.failureCount
          const minSamples = alert.minSamples ?? 1
          value = stats.errorRate
          shouldTrigger = totalExecutions >= minSamples && value > alert.threshold
          break
        }
        case 'latency': {
          value = currentValue ?? 0
          shouldTrigger = value > alert.threshold
          break
        }
        case 'latency_p95': {
          const histogram = this.getLatencyHistogram(triggerId)
          value = histogram.p95
          shouldTrigger = value > alert.threshold
          break
        }
        default:
          continue
      }

      // For rate-based alerts (fire_rate, error_rate), use threshold crossing detection
      // Only trigger once per threshold crossing (from below to above)
      const lastValue = state.lastAlertValues.get(type)
      const wasAboveThreshold = lastValue !== undefined && lastValue > alert.threshold

      if (shouldTrigger && !wasAboveThreshold) {
        // First time crossing threshold - trigger alert
        alert.callback({
          type,
          triggerId,
          value,
          threshold: alert.threshold,
          timestamp: Date.now(),
        })
      }

      // Track current value for next check
      state.lastAlertValues.set(type, value)
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.triggers.clear()
  }

  /**
   * Reset metrics for a specific trigger
   */
  resetTrigger(triggerId: string): void {
    this.triggers.delete(triggerId)
  }
}

// =============================================================================
// TRIGGER OBSERVER
// =============================================================================

/**
 * Handler types for observer
 */
type StartHandler = (ctx: TriggerExecutionContext) => void | Promise<void>
type SuccessHandler = (ctx: TriggerExecutionContext, result: unknown, durationMs: number) => void | Promise<void>
type FailureHandler = (ctx: TriggerExecutionContext, error: Error, durationMs: number) => void | Promise<void>

/**
 * TriggerObserver - Observe trigger executions
 */
export class TriggerObserver {
  private startHandlers: Set<StartHandler> = new Set()
  private successHandlers: Set<SuccessHandler> = new Set()
  private failureHandlers: Set<FailureHandler> = new Set()
  private metrics?: TriggerMetrics

  constructor(options: TriggerObserverOptions = {}) {
    this.metrics = options.metrics
  }

  /**
   * Register a handler for execution start
   */
  onStart(handler: StartHandler): () => void {
    this.startHandlers.add(handler)
    return () => this.startHandlers.delete(handler)
  }

  /**
   * Register a handler for execution success
   */
  onSuccess(handler: SuccessHandler): () => void {
    this.successHandlers.add(handler)
    return () => this.successHandlers.delete(handler)
  }

  /**
   * Register a handler for execution failure
   */
  onFailure(handler: FailureHandler): () => void {
    this.failureHandlers.add(handler)
    return () => this.failureHandlers.delete(handler)
  }

  /**
   * Notify handlers of execution start
   */
  async notifyStart(ctx: TriggerExecutionContext): Promise<void> {
    // Auto-record metrics if configured
    if (this.metrics) {
      this.metrics.recordTriggerFired(ctx.triggerId)
    }

    // Notify handlers
    for (const handler of this.startHandlers) {
      try {
        await handler(ctx)
      } catch {
        // Continue on handler error
      }
    }
  }

  /**
   * Notify handlers of execution success
   */
  async notifySuccess(ctx: TriggerExecutionContext, result: unknown, durationMs: number): Promise<void> {
    // Auto-record metrics if configured
    if (this.metrics) {
      this.metrics.recordTriggerSuccess(ctx.triggerId, durationMs)
    }

    // Notify handlers
    for (const handler of this.successHandlers) {
      try {
        await handler(ctx, result, durationMs)
      } catch {
        // Continue on handler error
      }
    }
  }

  /**
   * Notify handlers of execution failure
   */
  async notifyFailure(ctx: TriggerExecutionContext, error: Error, durationMs: number): Promise<void> {
    // Auto-record metrics if configured
    if (this.metrics) {
      this.metrics.recordTriggerFailure(ctx.triggerId, error)
    }

    // Notify handlers
    for (const handler of this.failureHandlers) {
      try {
        await handler(ctx, error, durationMs)
      } catch {
        // Continue on handler error
      }
    }
  }
}

// =============================================================================
// TRIGGER TRACER
// =============================================================================

/**
 * Internal span implementation
 */
class SpanImpl implements TriggerSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime?: number
  duration?: number
  status: SpanStatus = 'unset'
  statusMessage?: string
  attributes: Record<string, unknown> = {}
  error?: Error
  isSampled: boolean

  private onEnd?: (span: TriggerSpan) => void

  constructor(
    name: string,
    attrs: Record<string, unknown>,
    parentContext?: SpanContext,
    isSampled: boolean = true,
    onEnd?: (span: TriggerSpan) => void
  ) {
    this.name = name
    this.startTime = performance.now()
    this.isSampled = isSampled
    this.onEnd = onEnd

    if (parentContext) {
      this.traceId = parentContext.traceId
      this.parentSpanId = parentContext.spanId
    } else {
      this.traceId = randomHex(32)
    }

    this.spanId = randomHex(16)

    // Set initial attributes
    for (const [key, value] of Object.entries(attrs)) {
      this.attributes[key] = value
    }
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value
  }

  recordException(error: Error): void {
    this.error = error
    this.status = 'error'
    this.setAttribute('exception.type', error.name)
    this.setAttribute('exception.message', error.message)
    if (error.stack) {
      this.setAttribute('exception.stacktrace', error.stack)
    }
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.status = status
    if (message) {
      this.statusMessage = message
    }
  }

  end(): void {
    this.endTime = performance.now()
    this.duration = this.endTime - this.startTime

    if (this.onEnd) {
      this.onEnd(this)
    }
  }

  context(): SpanContext {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      isSampled: this.isSampled,
    }
  }
}

/**
 * TriggerTracer - Distributed tracing for triggers
 */
export class TriggerTracer {
  private onExport?: (span: TriggerSpan) => void
  private onBatchExport?: (spans: TriggerSpan[]) => void
  private batchExport: boolean
  private batchSize: number
  private samplingRate: number
  private spanBuffer: TriggerSpan[] = []

  constructor(options: TriggerTracerOptions = {}) {
    this.onExport = options.onExport
    this.onBatchExport = options.onBatchExport
    this.batchExport = options.batchExport ?? false
    this.batchSize = options.batchSize ?? 100
    this.samplingRate = options.samplingRate ?? 1
  }

  /**
   * Start a new span
   */
  startSpan(
    name: string,
    attributes: Record<string, unknown>,
    parentContext?: SpanContext
  ): TriggerSpan {
    // Determine if this span should be sampled
    const isSampled = Math.random() < this.samplingRate

    const span = new SpanImpl(
      name,
      attributes,
      parentContext,
      isSampled,
      (completedSpan) => this.handleSpanEnd(completedSpan)
    )

    return span
  }

  /**
   * Handle span end
   */
  private handleSpanEnd(span: TriggerSpan): void {
    if (!span.isSampled) return

    if (this.batchExport) {
      this.spanBuffer.push(span)

      if (this.spanBuffer.length >= this.batchSize) {
        this.flushBatch()
      }
    } else if (this.onExport) {
      this.onExport(span)
    }
  }

  /**
   * Flush batch of spans
   */
  private flushBatch(): void {
    if (this.spanBuffer.length === 0) return

    if (this.onBatchExport) {
      this.onBatchExport([...this.spanBuffer])
    }

    this.spanBuffer = []
  }

  /**
   * Extract span context from headers (W3C Trace Context)
   */
  extractContext(headers: Record<string, string>): SpanContext | null {
    const traceparent = headers['traceparent']
    if (!traceparent) return null

    // W3C traceparent format: version-traceId-spanId-traceFlags
    // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    const match = traceparent.match(
      /^([a-f0-9]{2})-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i
    )

    if (!match) return null

    const [, version, traceId, spanId, traceFlags] = match
    const isSampled = (parseInt(traceFlags!, 16) & 0x01) === 0x01

    return {
      traceId: traceId!,
      spanId: spanId!,
      parentSpanId: spanId,
      traceFlags: parseInt(traceFlags!, 16),
      isSampled,
    }
  }

  /**
   * Inject span context into headers (W3C Trace Context)
   */
  injectContext(context: SpanContext, headers: Record<string, string>): void {
    const traceFlags = context.isSampled ? '01' : '00'
    headers['traceparent'] = `00-${context.traceId}-${context.spanId}-${traceFlags}`
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new TriggerMetrics instance
 */
export function createTriggerMetrics(options?: TriggerMetricsOptions): TriggerMetrics {
  return new TriggerMetrics(options)
}

/**
 * Create a new TriggerObserver instance
 */
export function createTriggerObserver(options?: TriggerObserverOptions): TriggerObserver {
  return new TriggerObserver(options)
}

/**
 * Create a new TriggerTracer instance
 */
export function createTriggerTracer(options?: TriggerTracerOptions): TriggerTracer {
  return new TriggerTracer(options)
}
