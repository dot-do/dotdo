/**
 * @dotdo/datadog - Metrics Module
 *
 * Datadog-compatible metrics API for counters, gauges, histograms, and distributions.
 *
 * @module @dotdo/datadog/metrics
 */

import type {
  MetricType,
  MetricPoint,
  MetricSeries,
  MetricUnit,
  DatadogConfig,
  DatadogResponse,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for recording a metric.
 */
export interface MetricOptions {
  /** Tags to attach */
  tags?: string[]
  /** Host name */
  host?: string
  /** Metric unit */
  unit?: MetricUnit
  /** Timestamp (defaults to now) */
  timestamp?: number
}

/**
 * Histogram summary statistics.
 */
export interface HistogramStats {
  count: number
  sum: number
  min: number
  max: number
  avg: number
  median: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
}

// =============================================================================
// Metrics Client
// =============================================================================

/**
 * Datadog-compatible metrics client.
 */
export class MetricsClient {
  private readonly config: Required<Pick<DatadogConfig, 'service' | 'env' | 'hostname'>> & DatadogConfig
  private readonly buffer: MetricSeries[] = []
  private readonly histogramValues: Map<string, number[]> = new Map()
  private readonly gaugeValues: Map<string, { value: number; timestamp: number }> = new Map()
  private readonly setValues: Map<string, Set<string | number>> = new Map()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private enabled = true

  constructor(config: DatadogConfig = {}) {
    this.config = {
      service: config.service ?? 'unknown',
      env: config.env ?? 'development',
      hostname: config.hostname ?? 'localhost',
      batching: config.batching ?? true,
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 10000,
      ...config,
    }

    if (this.config.batching && this.config.flushInterval > 0) {
      this.startAutoFlush()
    }
  }

  // ===========================================================================
  // Counter Metrics
  // ===========================================================================

  /**
   * Increment a counter metric.
   */
  count(metric: string, value: number = 1, options: MetricOptions = {}): void {
    if (!this.enabled) return

    const point = this.createPoint(value, options.timestamp)
    const series = this.createSeries(metric, 'count', [point], options)
    this.addToBuffer(series)
  }

  /**
   * Increment a counter (alias for count).
   */
  increment(metric: string, value: number = 1, options: MetricOptions = {}): void {
    this.count(metric, value, options)
  }

  /**
   * Decrement a counter.
   */
  decrement(metric: string, value: number = 1, options: MetricOptions = {}): void {
    this.count(metric, -value, options)
  }

  // ===========================================================================
  // Gauge Metrics
  // ===========================================================================

  /**
   * Record a gauge value (point-in-time measurement).
   */
  gauge(metric: string, value: number, options: MetricOptions = {}): void {
    if (!this.enabled) return

    const timestamp = options.timestamp ?? Date.now() / 1000
    const key = this.getMetricKey(metric, options.tags)

    // Store latest gauge value for aggregation
    this.gaugeValues.set(key, { value, timestamp })

    const point = this.createPoint(value, options.timestamp)
    const series = this.createSeries(metric, 'gauge', [point], options)
    this.addToBuffer(series)
  }

  /**
   * Get the last recorded gauge value.
   */
  getGauge(metric: string, tags?: string[]): number | undefined {
    const key = this.getMetricKey(metric, tags)
    return this.gaugeValues.get(key)?.value
  }

  // ===========================================================================
  // Histogram Metrics
  // ===========================================================================

  /**
   * Record a histogram value for distribution tracking.
   */
  histogram(metric: string, value: number, options: MetricOptions = {}): void {
    if (!this.enabled) return

    const key = this.getMetricKey(metric, options.tags)
    const values = this.histogramValues.get(key) ?? []
    values.push(value)
    this.histogramValues.set(key, values)

    const point = this.createPoint(value, options.timestamp)
    const series = this.createSeries(metric, 'histogram', [point], options)
    this.addToBuffer(series)
  }

  /**
   * Get histogram statistics for a metric.
   */
  getHistogramStats(metric: string, tags?: string[]): HistogramStats | null {
    const key = this.getMetricKey(metric, tags)
    const values = this.histogramValues.get(key)

    if (!values || values.length === 0) {
      return null
    }

    const sorted = [...values].sort((a, b) => a - b)
    const count = sorted.length
    const sum = sorted.reduce((acc, v) => acc + v, 0)
    const min = sorted[0]!
    const max = sorted[count - 1]!

    return {
      count,
      sum,
      min,
      max,
      avg: sum / count,
      median: this.percentile(sorted, 50),
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    }
  }

  /**
   * Clear histogram values for a metric.
   */
  clearHistogram(metric: string, tags?: string[]): void {
    const key = this.getMetricKey(metric, tags)
    this.histogramValues.delete(key)
  }

  // ===========================================================================
  // Distribution Metrics
  // ===========================================================================

  /**
   * Record a distribution value (globally aggregated histogram).
   */
  distribution(metric: string, value: number, options: MetricOptions = {}): void {
    if (!this.enabled) return

    const point = this.createPoint(value, options.timestamp)
    const series = this.createSeries(metric, 'distribution', [point], options)
    this.addToBuffer(series)
  }

  // ===========================================================================
  // Rate Metrics
  // ===========================================================================

  /**
   * Record a rate value (count per second).
   */
  rate(metric: string, value: number, options: MetricOptions & { interval?: number } = {}): void {
    if (!this.enabled) return

    const point = this.createPoint(value, options.timestamp)
    const series = this.createSeries(metric, 'rate', [point], options)
    series.interval = options.interval ?? 1
    this.addToBuffer(series)
  }

  // ===========================================================================
  // Set Metrics
  // ===========================================================================

  /**
   * Add a value to a set (counts unique values).
   */
  set(metric: string, value: string | number, options: MetricOptions = {}): void {
    if (!this.enabled) return

    const key = this.getMetricKey(metric, options.tags)
    const values = this.setValues.get(key) ?? new Set()
    values.add(value)
    this.setValues.set(key, values)

    // Set metrics are typically sent as the count of unique values
    const point = this.createPoint(values.size, options.timestamp)
    const series = this.createSeries(metric, 'set', [point], options)
    this.addToBuffer(series)
  }

  /**
   * Get the count of unique values in a set.
   */
  getSetSize(metric: string, tags?: string[]): number {
    const key = this.getMetricKey(metric, tags)
    return this.setValues.get(key)?.size ?? 0
  }

  /**
   * Clear set values for a metric.
   */
  clearSet(metric: string, tags?: string[]): void {
    const key = this.getMetricKey(metric, tags)
    this.setValues.delete(key)
  }

  // ===========================================================================
  // Timer Metrics
  // ===========================================================================

  /**
   * Start a timer and return a function to stop it.
   */
  timer(metric: string, options: MetricOptions = {}): () => number {
    const startTime = performance.now()

    return () => {
      const duration = performance.now() - startTime
      this.histogram(metric, duration, {
        ...options,
        unit: options.unit ?? 'millisecond',
      })
      return duration
    }
  }

  /**
   * Time an async function execution.
   */
  async time<T>(
    metric: string,
    fn: () => Promise<T>,
    options: MetricOptions = {}
  ): Promise<T> {
    const stop = this.timer(metric, options)
    try {
      return await fn()
    } finally {
      stop()
    }
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /**
   * Submit multiple metric series at once.
   */
  submit(series: MetricSeries[]): void {
    if (!this.enabled) return

    for (const s of series) {
      this.addToBuffer(s)
    }
  }

  /**
   * Get all buffered metrics.
   */
  getBuffer(): MetricSeries[] {
    return [...this.buffer]
  }

  /**
   * Clear the metrics buffer.
   */
  clearBuffer(): void {
    this.buffer.length = 0
  }

  // ===========================================================================
  // Flush & Lifecycle
  // ===========================================================================

  /**
   * Flush buffered metrics (simulate sending to Datadog).
   */
  async flush(): Promise<DatadogResponse> {
    if (this.buffer.length === 0) {
      return { status: 'ok', data: { series_count: 0 } }
    }

    const series = [...this.buffer]
    this.buffer.length = 0

    // In a real implementation, this would send to Datadog API
    // For now, we return success with the count
    return {
      status: 'ok',
      data: { series_count: series.length },
    }
  }

  /**
   * Close the client and flush remaining metrics.
   */
  async close(): Promise<void> {
    this.enabled = false
    this.stopAutoFlush()
    await this.flush()
  }

  /**
   * Disable the client (no-op mode).
   */
  disable(): void {
    this.enabled = false
    this.stopAutoFlush()
  }

  /**
   * Enable the client.
   */
  enable(): void {
    this.enabled = true
    if (this.config.batching && this.config.flushInterval > 0) {
      this.startAutoFlush()
    }
  }

  /**
   * Check if client is enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get the current configuration.
   */
  getConfig(): DatadogConfig {
    return { ...this.config }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private createPoint(value: number, timestamp?: number): MetricPoint {
    return {
      timestamp: timestamp ?? Math.floor(Date.now() / 1000),
      value,
    }
  }

  private createSeries(
    metric: string,
    type: MetricType,
    points: MetricPoint[],
    options: MetricOptions
  ): MetricSeries {
    const tags = [
      ...(this.config.tags ?? []),
      ...(options.tags ?? []),
      `service:${this.config.service}`,
      `env:${this.config.env}`,
    ]

    return {
      metric,
      type,
      points,
      host: options.host ?? this.config.hostname,
      tags,
      unit: options.unit,
    }
  }

  private addToBuffer(series: MetricSeries): void {
    this.buffer.push(series)

    // Auto-flush if buffer is full
    if (this.buffer.length >= (this.config.batchSize ?? 100)) {
      this.flush().catch(() => {
        // Silently ignore flush errors
      })
    }
  }

  private getMetricKey(metric: string, tags?: string[]): string {
    const tagStr = tags?.sort().join(',') ?? ''
    return `${metric}:${tagStr}`
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!
  }

  private startAutoFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore flush errors
      })
    }, this.config.flushInterval)
  }

  private stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new metrics client.
 */
export function createMetricsClient(config?: DatadogConfig): MetricsClient {
  return new MetricsClient(config)
}

// =============================================================================
// Statsd-style Helper Functions
// =============================================================================

let defaultClient: MetricsClient | null = null

/**
 * Get or create the default metrics client.
 */
export function getDefaultClient(): MetricsClient {
  if (!defaultClient) {
    defaultClient = new MetricsClient()
  }
  return defaultClient
}

/**
 * Set the default metrics client.
 */
export function setDefaultClient(client: MetricsClient): void {
  defaultClient = client
}

/**
 * Clear the default metrics client.
 */
export function clearDefaultClient(): void {
  defaultClient = null
}

// Convenience functions using default client
export const increment = (metric: string, value?: number, options?: MetricOptions) =>
  getDefaultClient().increment(metric, value, options)

export const decrement = (metric: string, value?: number, options?: MetricOptions) =>
  getDefaultClient().decrement(metric, value, options)

export const gauge = (metric: string, value: number, options?: MetricOptions) =>
  getDefaultClient().gauge(metric, value, options)

export const histogram = (metric: string, value: number, options?: MetricOptions) =>
  getDefaultClient().histogram(metric, value, options)

export const distribution = (metric: string, value: number, options?: MetricOptions) =>
  getDefaultClient().distribution(metric, value, options)

export const timing = (metric: string, value: number, options?: MetricOptions) =>
  getDefaultClient().histogram(metric, value, { ...options, unit: 'millisecond' })
