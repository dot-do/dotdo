/**
 * MetricsCollector - A comprehensive metrics collection system
 * Supports counters, gauges, histograms, summaries, and timers
 */

import type {
  MetricType,
  MetricLabels,
  Metric,
  MetricSnapshot,
  AggregatedMetric,
  ExportFormat,
  HistogramData,
  SummaryData,
  TimerStopFn,
  MetricsCollectorOptions,
} from './types'

// Re-export types
export * from './types'

// ============================================================================
// Utility Functions
// ============================================================================

/** Default histogram buckets (similar to Prometheus defaults) */
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

/** Default summary percentiles */
const DEFAULT_PERCENTILES = [0.5, 0.9, 0.99]

/** Generate a unique key for label combinations */
function labelsToKey(labels: MetricLabels): string {
  const sortedKeys = Object.keys(labels).sort()
  return sortedKeys.map((k) => `${k}=${labels[k]}`).join(',')
}

/** Parse a labels key string back into labels object */
function keyToLabels(key: string): MetricLabels {
  if (!key) return {}
  const labels: MetricLabels = {}
  for (const pair of key.split(',')) {
    const [k, v] = pair.split('=')
    if (k && v !== undefined) {
      labels[k] = v
    }
  }
  return labels
}

/** Calculate percentile from sorted array */
function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

// ============================================================================
// Base Metric Class
// ============================================================================

/** Base class for metrics with label support */
abstract class BaseMetric {
  protected readonly name: string

  constructor(name: string) {
    this.name = name
  }

  protected mergeLabels(
    defaultLabels: MetricLabels,
    key: string
  ): MetricLabels {
    return { ...defaultLabels, ...keyToLabels(key) }
  }

  abstract getMetrics(defaultLabels?: MetricLabels): Metric[]
  abstract reset(): void
}

// ============================================================================
// Counter
// ============================================================================

/**
 * Counter - Increment-only metric
 * Use for values that only go up: requests, errors, completed tasks
 */
export class Counter extends BaseMetric {
  private values = new Map<string, number>()

  /** Increment counter by specified amount (default: 1) */
  inc(amount: number = 1, labels: MetricLabels = {}): void {
    if (amount < 0) {
      throw new Error('Counter cannot be decremented')
    }
    const key = labelsToKey(labels)
    this.values.set(key, (this.values.get(key) || 0) + amount)
  }

  /** Get current counter value for given labels */
  value(labels: MetricLabels = {}): number {
    return this.values.get(labelsToKey(labels)) || 0
  }

  getMetrics(defaultLabels: MetricLabels = {}): Metric[] {
    const now = Date.now()
    return Array.from(this.values.entries()).map(([key, value]) => ({
      name: this.name,
      type: 'counter' as MetricType,
      value,
      labels: this.mergeLabels(defaultLabels, key),
      timestamp: now,
    }))
  }

  reset(): void {
    this.values.clear()
  }
}

// ============================================================================
// Gauge
// ============================================================================

/**
 * Gauge - Set/increment/decrement metric
 * Use for values that can go up and down: temperature, memory, connections
 */
export class Gauge extends BaseMetric {
  private values = new Map<string, number>()

  /** Set gauge to specific value */
  set(value: number, labels: MetricLabels = {}): void {
    this.values.set(labelsToKey(labels), value)
  }

  /** Increment gauge by amount (default: 1) */
  inc(amount: number = 1, labels: MetricLabels = {}): void {
    const key = labelsToKey(labels)
    this.values.set(key, (this.values.get(key) || 0) + amount)
  }

  /** Decrement gauge by amount (default: 1) */
  dec(amount: number = 1, labels: MetricLabels = {}): void {
    const key = labelsToKey(labels)
    this.values.set(key, (this.values.get(key) || 0) - amount)
  }

  /** Get current gauge value for given labels */
  value(labels: MetricLabels = {}): number {
    return this.values.get(labelsToKey(labels)) || 0
  }

  getMetrics(defaultLabels: MetricLabels = {}): Metric[] {
    const now = Date.now()
    return Array.from(this.values.entries()).map(([key, value]) => ({
      name: this.name,
      type: 'gauge' as MetricType,
      value,
      labels: this.mergeLabels(defaultLabels, key),
      timestamp: now,
    }))
  }

  reset(): void {
    this.values.clear()
  }
}

// ============================================================================
// Histogram
// ============================================================================

interface HistogramState {
  bucketCounts: Map<number, number>
  sum: number
  count: number
}

/**
 * Histogram - Value distribution with buckets
 * Use for measuring distributions: request duration, response size
 */
export class Histogram extends BaseMetric {
  private readonly buckets: number[]
  private state = new Map<string, HistogramState>()

  constructor(name: string, options: { buckets?: number[] } = {}) {
    super(name)
    this.buckets = options.buckets || DEFAULT_BUCKETS
  }

  /** Record an observation */
  observe(value: number, labels: MetricLabels = {}): void {
    const key = labelsToKey(labels)

    if (!this.state.has(key)) {
      const bucketCounts = new Map<number, number>()
      for (const bucket of [...this.buckets, Infinity]) {
        bucketCounts.set(bucket, 0)
      }
      this.state.set(key, { bucketCounts, sum: 0, count: 0 })
    }

    const state = this.state.get(key)!

    // Update cumulative bucket counts
    for (const bucket of [...this.buckets, Infinity]) {
      if (value <= bucket) {
        state.bucketCounts.set(bucket, (state.bucketCounts.get(bucket) || 0) + 1)
      }
    }

    state.sum += value
    state.count += 1
  }

  /** Get histogram data for given labels */
  data(labels: MetricLabels = {}): HistogramData {
    const state = this.state.get(labelsToKey(labels))
    if (!state) {
      return {
        buckets: [...this.buckets, Infinity].map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      }
    }

    return {
      buckets: [...this.buckets, Infinity].map((le) => ({
        le,
        count: state.bucketCounts.get(le) || 0,
      })),
      sum: state.sum,
      count: state.count,
    }
  }

  getMetrics(defaultLabels: MetricLabels = {}): Metric[] {
    const metrics: Metric[] = []
    const now = Date.now()

    for (const [key, state] of this.state) {
      const baseLabels = this.mergeLabels(defaultLabels, key)

      // Bucket metrics
      for (const [le, count] of state.bucketCounts) {
        metrics.push({
          name: `${this.name}_bucket`,
          type: 'histogram',
          value: count,
          labels: { ...baseLabels, le: le === Infinity ? '+Inf' : String(le) },
          timestamp: now,
        })
      }

      // Sum and count metrics
      metrics.push(
        {
          name: `${this.name}_sum`,
          type: 'histogram',
          value: state.sum,
          labels: baseLabels,
          timestamp: now,
        },
        {
          name: `${this.name}_count`,
          type: 'histogram',
          value: state.count,
          labels: baseLabels,
          timestamp: now,
        }
      )
    }

    return metrics
  }

  reset(): void {
    this.state.clear()
  }
}

// ============================================================================
// Summary
// ============================================================================

interface SummaryState {
  values: number[]
  sum: number
  count: number
}

/**
 * Summary - Percentile calculations
 * Use when you need accurate percentiles: P50, P90, P99 latencies
 */
export class Summary extends BaseMetric {
  private readonly percentiles: number[]
  private state = new Map<string, SummaryState>()

  constructor(name: string, options: { percentiles?: number[] } = {}) {
    super(name)
    this.percentiles = options.percentiles || DEFAULT_PERCENTILES
  }

  /** Record an observation */
  observe(value: number, labels: MetricLabels = {}): void {
    const key = labelsToKey(labels)

    if (!this.state.has(key)) {
      this.state.set(key, { values: [], sum: 0, count: 0 })
    }

    const state = this.state.get(key)!
    state.values.push(value)
    state.sum += value
    state.count += 1
  }

  /** Get summary data for given labels */
  data(labels: MetricLabels = {}): SummaryData & { percentiles: Record<number, number> } {
    const state = this.state.get(labelsToKey(labels))
    if (!state) {
      return {
        values: [],
        sum: 0,
        count: 0,
        percentiles: Object.fromEntries(this.percentiles.map((p) => [p, 0])),
      }
    }

    const sorted = [...state.values].sort((a, b) => a - b)
    const percentiles: Record<number, number> = {}
    for (const p of this.percentiles) {
      percentiles[p] = calculatePercentile(sorted, p)
    }

    return {
      values: state.values,
      sum: state.sum,
      count: state.count,
      percentiles,
    }
  }

  getMetrics(defaultLabels: MetricLabels = {}): Metric[] {
    const metrics: Metric[] = []
    const now = Date.now()

    for (const [key, state] of this.state) {
      const baseLabels = this.mergeLabels(defaultLabels, key)
      const sorted = [...state.values].sort((a, b) => a - b)

      // Percentile metrics
      for (const p of this.percentiles) {
        metrics.push({
          name: this.name,
          type: 'summary',
          value: calculatePercentile(sorted, p),
          labels: { ...baseLabels, quantile: String(p) },
          timestamp: now,
        })
      }

      // Sum and count metrics
      metrics.push(
        {
          name: `${this.name}_sum`,
          type: 'summary',
          value: state.sum,
          labels: baseLabels,
          timestamp: now,
        },
        {
          name: `${this.name}_count`,
          type: 'summary',
          value: state.count,
          labels: baseLabels,
          timestamp: now,
        }
      )
    }

    return metrics
  }

  reset(): void {
    this.state.clear()
  }
}

// ============================================================================
// Timer
// ============================================================================

/**
 * Timer - Duration measurement utility
 * Standalone timer for measuring elapsed time
 */
export class Timer {
  private startTime = 0

  /** Start the timer */
  start(): void {
    this.startTime = Date.now()
  }

  /** Stop the timer and return elapsed milliseconds */
  stop(): number {
    return Date.now() - this.startTime
  }
}

// ============================================================================
// MetricsExporter
// ============================================================================

const SUPPORTED_FORMATS: ExportFormat[] = ['prometheus', 'json', 'statsd', 'opentelemetry']

/**
 * MetricsExporter - Export metrics in various formats
 * Supports Prometheus, JSON, StatsD, and OpenTelemetry formats
 */
export class MetricsExporter {
  /** Check if a format is supported */
  supports(format: ExportFormat): boolean {
    return SUPPORTED_FORMATS.includes(format)
  }

  /** Export metrics in the specified format */
  export(metrics: Metric[], format: ExportFormat, timestamp: number): string {
    switch (format) {
      case 'prometheus':
        return this.toPrometheus(metrics)
      case 'json':
        return this.toJson(metrics, timestamp)
      case 'statsd':
        return this.toStatsd(metrics)
      case 'opentelemetry':
        return this.toOpenTelemetry(metrics, timestamp)
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  private toPrometheus(metrics: Metric[]): string {
    return metrics
      .map((m) => {
        const labels = this.formatPrometheusLabels(m.labels)
        return `${m.name}${labels} ${m.value}`
      })
      .join('\n')
  }

  private formatPrometheusLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels)
    if (entries.length === 0) return ''
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`
  }

  private toJson(metrics: Metric[], timestamp: number): string {
    return JSON.stringify({ metrics, timestamp })
  }

  private toStatsd(metrics: Metric[]): string {
    const lines: string[] = []
    const seen = new Set<string>()

    // Collect histogram sums for timing metrics
    const histogramSums = new Map<string, number>()
    for (const m of metrics) {
      if (m.name.endsWith('_sum') && m.type === 'histogram') {
        const baseName = m.name.replace(/_sum$/, '')
        histogramSums.set(`${baseName}:${labelsToKey(m.labels)}`, m.value)
      }
    }

    // Process regular metrics
    for (const m of metrics) {
      // Skip derivative metrics
      if (m.name.endsWith('_bucket') || m.name.endsWith('_sum') || m.name.endsWith('_count')) {
        continue
      }

      const key = `${m.name}:${labelsToKey(m.labels)}`
      if (seen.has(key)) continue
      seen.add(key)

      const typeChar =
        m.type === 'counter' ? 'c' : m.type === 'gauge' ? 'g' : 'ms'
      lines.push(`${m.name}:${m.value}|${typeChar}`)
    }

    // Add histogram timing metrics
    for (const [key, value] of histogramSums) {
      if (!seen.has(key)) {
        const baseName = key.split(':')[0]
        lines.push(`${baseName}:${value}|ms`)
        seen.add(key)
      }
    }

    return lines.join('\n')
  }

  private toOpenTelemetry(metrics: Metric[], timestamp: number): string {
    return JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: metrics.map((m) => ({
                name: m.name,
                unit: '',
                description: '',
                data: {
                  dataPoints: [
                    {
                      asDouble: m.value,
                      attributes: Object.entries(m.labels).map(([k, v]) => ({
                        key: k,
                        value: { stringValue: v },
                      })),
                      timeUnixNano: timestamp * 1000000,
                    },
                  ],
                },
              })),
            },
          ],
        },
      ],
    })
  }
}

// ============================================================================
// MetricsAggregator
// ============================================================================

/**
 * MetricsAggregator - Aggregate metrics over time
 * Calculates statistics like min, max, avg, and percentiles
 */
export class MetricsAggregator {
  private data = new Map<string, Metric[]>()
  private readonly percentiles: number[]

  constructor(options: { percentiles?: number[] } = {}) {
    this.percentiles = options.percentiles || DEFAULT_PERCENTILES
  }

  /** Add a metric to the aggregator */
  add(metric: Metric): void {
    const key = `${metric.name}:${labelsToKey(metric.labels)}`
    if (!this.data.has(key)) {
      this.data.set(key, [])
    }
    this.data.get(key)!.push(metric)
  }

  /** Aggregate metrics and compute statistics */
  aggregate(name: string, labels: MetricLabels = {}): AggregatedMetric {
    const key = `${name}:${labelsToKey(labels)}`
    const metrics = this.data.get(key) || []

    if (metrics.length === 0) {
      return {
        name,
        labels,
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        percentiles: {},
      }
    }

    const values = metrics.map((m) => m.value)
    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)

    const percentiles: Record<number, number> = {}
    for (const p of this.percentiles) {
      percentiles[p] = calculatePercentile(sorted, p)
    }

    return {
      name,
      labels,
      count: values.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      percentiles,
    }
  }

  /** Reset aggregator state */
  reset(): void {
    this.data.clear()
  }
}

// ============================================================================
// MetricsCollector
// ============================================================================

/**
 * MetricsCollector - Main class for collecting metrics
 *
 * Example usage:
 * ```typescript
 * const collector = new MetricsCollector({ prefix: 'myapp_' })
 *
 * // Counter
 * collector.counter('requests_total', { method: 'GET' })
 *
 * // Gauge
 * collector.gauge('connections_active', 42)
 *
 * // Histogram
 * collector.histogram('request_duration_seconds', 0.25)
 *
 * // Timer
 * const stop = collector.timer('db_query_duration')
 * // ... do work
 * stop()
 *
 * // Export
 * console.log(collector.export('prometheus'))
 * ```
 */
export class MetricsCollector {
  private counters = new Map<string, Counter>()
  private gauges = new Map<string, Gauge>()
  private histograms = new Map<string, Histogram>()
  private summaries = new Map<string, Summary>()

  private readonly options: Required<MetricsCollectorOptions>
  private readonly exporter = new MetricsExporter()

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      defaultBuckets: options.defaultBuckets || DEFAULT_BUCKETS,
      defaultPercentiles: options.defaultPercentiles || DEFAULT_PERCENTILES,
      prefix: options.prefix || '',
      defaultLabels: options.defaultLabels || {},
    }
  }

  private prefixName(name: string): string {
    return this.options.prefix ? `${this.options.prefix}${name}` : name
  }

  /** Increment a counter metric */
  counter(name: string, labels: MetricLabels = {}, amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Counter cannot be decremented')
    }

    const prefixedName = this.prefixName(name)
    if (!this.counters.has(prefixedName)) {
      this.counters.set(prefixedName, new Counter(prefixedName))
    }
    this.counters.get(prefixedName)!.inc(amount, labels)
  }

  /** Set a gauge metric value */
  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    const prefixedName = this.prefixName(name)
    if (!this.gauges.has(prefixedName)) {
      this.gauges.set(prefixedName, new Gauge(prefixedName))
    }
    this.gauges.get(prefixedName)!.set(value, labels)
  }

  /** Record a histogram observation */
  histogram(name: string, value: number, labels: MetricLabels = {}): void {
    const prefixedName = this.prefixName(name)
    if (!this.histograms.has(prefixedName)) {
      this.histograms.set(
        prefixedName,
        new Histogram(prefixedName, { buckets: this.options.defaultBuckets })
      )
    }
    this.histograms.get(prefixedName)!.observe(value, labels)
  }

  /** Record a summary observation */
  summary(name: string, value: number, labels: MetricLabels = {}): void {
    const prefixedName = this.prefixName(name)
    if (!this.summaries.has(prefixedName)) {
      this.summaries.set(
        prefixedName,
        new Summary(prefixedName, { percentiles: this.options.defaultPercentiles })
      )
    }
    this.summaries.get(prefixedName)!.observe(value, labels)
  }

  /** Start a timer that records to a histogram when stopped */
  timer(name: string, labels: MetricLabels = {}): TimerStopFn {
    const startTime = Date.now()
    return () => {
      const elapsed = Date.now() - startTime
      this.histogram(name, elapsed, labels)
      return elapsed
    }
  }

  /** Get a snapshot of all metrics */
  snapshot(): MetricSnapshot {
    const defaultLabels = this.options.defaultLabels
    const metrics: Metric[] = [
      ...Array.from(this.counters.values()).flatMap((c) => c.getMetrics(defaultLabels)),
      ...Array.from(this.gauges.values()).flatMap((g) => g.getMetrics(defaultLabels)),
      ...Array.from(this.histograms.values()).flatMap((h) => h.getMetrics(defaultLabels)),
      ...Array.from(this.summaries.values()).flatMap((s) => s.getMetrics(defaultLabels)),
    ]

    return { metrics, timestamp: Date.now() }
  }

  /** Export metrics in the specified format */
  export(format: ExportFormat): string {
    const { metrics, timestamp } = this.snapshot()
    return this.exporter.export(metrics, format, timestamp)
  }

  /** Reset all metrics */
  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.summaries.clear()
  }
}
