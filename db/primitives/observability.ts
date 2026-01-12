/**
 * Observability - Metrics hooks for primitive operations
 *
 * Provides a unified metrics collection interface for all primitives:
 * - Latency tracking for operations
 * - Counter metrics for events (duplicates, late data, etc.)
 * - Gauge metrics for current state (version counts, window counts, etc.)
 *
 * Default is noopMetrics - zero overhead when not configured.
 */

/**
 * Labels for metric dimensions (e.g., operation type, status)
 */
export type MetricLabels = Record<string, string>

/**
 * Interface for collecting metrics from primitives
 *
 * Implementations can forward to Prometheus, OpenTelemetry, Cloudflare Analytics,
 * or any other metrics backend.
 */
export interface MetricsCollector {
  /**
   * Record operation latency in milliseconds
   * @param operation - Name of the operation (e.g., 'temporal_store.get', 'window_manager.process')
   * @param durationMs - Duration in milliseconds
   * @param labels - Optional labels for dimensions
   */
  recordLatency(operation: string, durationMs: number, labels?: MetricLabels): void

  /**
   * Increment a counter metric
   * @param name - Counter name (e.g., 'exactly_once.duplicates', 'window_manager.late_data')
   * @param labels - Optional labels for dimensions
   * @param delta - Amount to increment (default: 1)
   */
  incrementCounter(name: string, labels?: MetricLabels, delta?: number): void

  /**
   * Record a gauge value (point-in-time measurement)
   * @param name - Gauge name (e.g., 'temporal_store.version_count', 'window_manager.active_windows')
   * @param value - Current value
   * @param labels - Optional labels for dimensions
   */
  recordGauge(name: string, value: number, labels?: MetricLabels): void
}

/**
 * No-op metrics collector - zero overhead when metrics are not needed
 */
export const noopMetrics: MetricsCollector = {
  recordLatency(): void {
    // No-op
  },
  incrementCounter(): void {
    // No-op
  },
  recordGauge(): void {
    // No-op
  },
}

/**
 * In-memory metrics collector for testing
 * Stores all recorded metrics for assertions
 */
export interface RecordedMetric {
  type: 'latency' | 'counter' | 'gauge'
  name: string
  value: number
  labels?: MetricLabels
  timestamp: number
}

export class TestMetricsCollector implements MetricsCollector {
  public readonly metrics: RecordedMetric[] = []

  recordLatency(operation: string, durationMs: number, labels?: MetricLabels): void {
    this.metrics.push({
      type: 'latency',
      name: operation,
      value: durationMs,
      labels,
      timestamp: Date.now(),
    })
  }

  incrementCounter(name: string, labels?: MetricLabels, delta: number = 1): void {
    this.metrics.push({
      type: 'counter',
      name,
      value: delta,
      labels,
      timestamp: Date.now(),
    })
  }

  recordGauge(name: string, value: number, labels?: MetricLabels): void {
    this.metrics.push({
      type: 'gauge',
      name,
      value,
      labels,
      timestamp: Date.now(),
    })
  }

  /**
   * Get all metrics of a specific type
   */
  getByType(type: RecordedMetric['type']): RecordedMetric[] {
    return this.metrics.filter((m) => m.type === type)
  }

  /**
   * Get all metrics with a specific name
   */
  getByName(name: string): RecordedMetric[] {
    return this.metrics.filter((m) => m.name === name)
  }

  /**
   * Get total count for a counter
   */
  getCounterTotal(name: string): number {
    return this.getByName(name)
      .filter((m) => m.type === 'counter')
      .reduce((sum, m) => sum + m.value, 0)
  }

  /**
   * Get all latency recordings for an operation
   */
  getLatencies(operation: string): number[] {
    return this.getByName(operation)
      .filter((m) => m.type === 'latency')
      .map((m) => m.value)
  }

  /**
   * Get the latest gauge value
   */
  getLatestGauge(name: string): number | undefined {
    const gauges = this.getByName(name).filter((m) => m.type === 'gauge')
    return gauges.length > 0 ? gauges[gauges.length - 1]!.value : undefined
  }

  /**
   * Clear all recorded metrics
   */
  clear(): void {
    this.metrics.length = 0
  }
}

/**
 * Metric names used by primitives
 *
 * These constants help ensure consistency across the codebase
 * and provide documentation for available metrics.
 */
export const MetricNames = {
  // TemporalStore metrics
  TEMPORAL_STORE_GET_LATENCY: 'temporal_store.get.latency',
  TEMPORAL_STORE_PUT_LATENCY: 'temporal_store.put.latency',
  TEMPORAL_STORE_GET_AS_OF_LATENCY: 'temporal_store.get_as_of.latency',
  TEMPORAL_STORE_SNAPSHOT_LATENCY: 'temporal_store.snapshot.latency',
  TEMPORAL_STORE_RESTORE_LATENCY: 'temporal_store.restore.latency',
  TEMPORAL_STORE_PRUNE_LATENCY: 'temporal_store.prune.latency',
  TEMPORAL_STORE_VERSION_COUNT: 'temporal_store.version_count',
  TEMPORAL_STORE_KEY_COUNT: 'temporal_store.key_count',
  TEMPORAL_STORE_SNAPSHOT_COUNT: 'temporal_store.snapshot_count',
  TEMPORAL_STORE_VERSIONS_PRUNED: 'temporal_store.versions_pruned',

  // WindowManager metrics
  WINDOW_MANAGER_PROCESS_LATENCY: 'window_manager.process.latency',
  WINDOW_MANAGER_ADVANCE_WATERMARK_LATENCY: 'window_manager.advance_watermark.latency',
  WINDOW_MANAGER_WINDOW_CREATED: 'window_manager.window_created',
  WINDOW_MANAGER_WINDOW_TRIGGERED: 'window_manager.window_triggered',
  WINDOW_MANAGER_WINDOW_CLOSED: 'window_manager.window_closed',
  WINDOW_MANAGER_LATE_DATA: 'window_manager.late_data',
  WINDOW_MANAGER_ACTIVE_WINDOWS: 'window_manager.active_windows',
  WINDOW_MANAGER_ELEMENTS_PROCESSED: 'window_manager.elements_processed',

  // ExactlyOnceContext metrics
  EXACTLY_ONCE_PROCESS_LATENCY: 'exactly_once.process.latency',
  EXACTLY_ONCE_TRANSACTION_LATENCY: 'exactly_once.transaction.latency',
  EXACTLY_ONCE_FLUSH_LATENCY: 'exactly_once.flush.latency',
  EXACTLY_ONCE_DUPLICATES: 'exactly_once.duplicates',
  EXACTLY_ONCE_PROCESSED: 'exactly_once.processed',
  EXACTLY_ONCE_TRANSACTIONS: 'exactly_once.transactions',
  EXACTLY_ONCE_TRANSACTION_ROLLBACKS: 'exactly_once.transaction_rollbacks',
  EXACTLY_ONCE_EVENTS_EMITTED: 'exactly_once.events_emitted',
  EXACTLY_ONCE_EVENTS_DELIVERED: 'exactly_once.events_delivered',
  EXACTLY_ONCE_BUFFERED_EVENTS: 'exactly_once.buffered_events',
  EXACTLY_ONCE_PROCESSED_IDS: 'exactly_once.processed_ids',
} as const

/**
 * Helper to measure async operation latency
 */
export async function measureLatency<T>(
  metrics: MetricsCollector,
  operation: string,
  fn: () => Promise<T>,
  labels?: MetricLabels
): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const durationMs = performance.now() - start
    metrics.recordLatency(operation, durationMs, labels)
  }
}

/**
 * Helper to measure sync operation latency
 */
export function measureLatencySync<T>(
  metrics: MetricsCollector,
  operation: string,
  fn: () => T,
  labels?: MetricLabels
): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    const durationMs = performance.now() - start
    metrics.recordLatency(operation, durationMs, labels)
  }
}
