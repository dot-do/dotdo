/**
 * MetricsCollector Types
 * Core type definitions for the metrics collection system
 */

/** Types of metrics that can be collected */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary'

/** Labels attached to metrics for dimensionality */
export type MetricLabels = Record<string, string>

/** A single metric data point */
export interface Metric {
  name: string
  type: MetricType
  value: number
  labels: MetricLabels
  timestamp: number
}

/** Configuration for creating a metric */
export interface MetricConfig {
  name: string
  type: MetricType
  description?: string
  labels?: string[]
  /** Bucket boundaries for histograms */
  buckets?: number[]
  /** Percentiles to calculate for summaries (e.g., [0.5, 0.9, 0.99]) */
  percentiles?: number[]
}

/** A snapshot of all metrics at a point in time */
export interface MetricSnapshot {
  metrics: Metric[]
  timestamp: number
}

/** Aggregated metric with statistical summaries */
export interface AggregatedMetric {
  name: string
  labels: MetricLabels
  count: number
  sum: number
  min: number
  max: number
  avg: number
  percentiles: Record<number, number>
}

/** Supported export formats */
export type ExportFormat = 'prometheus' | 'json' | 'statsd' | 'opentelemetry'

/** Histogram bucket data */
export interface HistogramBucket {
  le: number // less than or equal
  count: number
}

/** Histogram metric data */
export interface HistogramData {
  buckets: HistogramBucket[]
  sum: number
  count: number
}

/** Summary metric data */
export interface SummaryData {
  values: number[]
  sum: number
  count: number
}

/** Timer stop function that returns elapsed time in milliseconds */
export type TimerStopFn = () => number

/** Options for MetricsCollector */
export interface MetricsCollectorOptions {
  /** Default histogram buckets */
  defaultBuckets?: number[]
  /** Default summary percentiles */
  defaultPercentiles?: number[]
  /** Prefix for all metric names */
  prefix?: string
  /** Default labels applied to all metrics */
  defaultLabels?: MetricLabels
}
