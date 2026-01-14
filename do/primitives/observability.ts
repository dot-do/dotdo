/**
 * Observability utilities for primitives.
 *
 * Provides a metrics interface for tracking performance, counts, and gauges
 * across all primitive implementations. Includes a noop implementation for
 * zero-overhead production use and a test implementation for verification.
 *
 * @module primitives/observability
 */

// =============================================================================
// METRIC NAMES
// =============================================================================

/**
 * Standard metric names used across primitives.
 */
export const MetricNames = {
  // TemporalStore metrics
  TEMPORAL_STORE_PUT_LATENCY: 'temporal_store.put.latency',
  TEMPORAL_STORE_GET_LATENCY: 'temporal_store.get.latency',
  TEMPORAL_STORE_GET_AS_OF_LATENCY: 'temporal_store.get_as_of.latency',
  TEMPORAL_STORE_SNAPSHOT_LATENCY: 'temporal_store.snapshot.latency',
  TEMPORAL_STORE_RESTORE_LATENCY: 'temporal_store.restore.latency',
  TEMPORAL_STORE_PRUNE_LATENCY: 'temporal_store.prune.latency',
  TEMPORAL_STORE_KEY_COUNT: 'temporal_store.keys.count',
  TEMPORAL_STORE_VERSION_COUNT: 'temporal_store.versions.count',
  TEMPORAL_STORE_SNAPSHOT_COUNT: 'temporal_store.snapshots.count',
  TEMPORAL_STORE_VERSIONS_PRUNED: 'temporal_store.versions.pruned',

  // WindowManager metrics
  WINDOW_MANAGER_PROCESS_LATENCY: 'window_manager.process.latency',
  WINDOW_MANAGER_ADVANCE_WATERMARK_LATENCY: 'window_manager.advance_watermark.latency',
  WINDOW_MANAGER_ACTIVE_WINDOWS: 'window_manager.windows.active',
  WINDOW_MANAGER_WINDOW_CREATED: 'window_manager.windows.created',
  WINDOW_MANAGER_WINDOW_TRIGGERED: 'window_manager.windows.triggered',
  WINDOW_MANAGER_WINDOW_CLOSED: 'window_manager.windows.closed',
  WINDOW_MANAGER_ELEMENTS_PROCESSED: 'window_manager.elements.processed',
  WINDOW_MANAGER_LATE_DATA: 'window_manager.late_data.count',

  // ExactlyOnce metrics
  EXACTLY_ONCE_PROCESS_LATENCY: 'exactly_once.process.latency',
  EXACTLY_ONCE_TRANSACTION_LATENCY: 'exactly_once.transaction.latency',
  EXACTLY_ONCE_FLUSH_LATENCY: 'exactly_once.flush.latency',
  EXACTLY_ONCE_DUPLICATES: 'exactly_once.duplicates.count',
  EXACTLY_ONCE_PROCESSED: 'exactly_once.processed.count',
  EXACTLY_ONCE_PROCESSED_IDS: 'exactly_once.processed_ids.count',
  EXACTLY_ONCE_TRANSACTIONS: 'exactly_once.transactions.count',
  EXACTLY_ONCE_TRANSACTION_ROLLBACKS: 'exactly_once.transactions.rollbacks',
  EXACTLY_ONCE_EVENTS_EMITTED: 'exactly_once.events.emitted',
  EXACTLY_ONCE_EVENTS_DELIVERED: 'exactly_once.events.delivered',
  EXACTLY_ONCE_BUFFERED_EVENTS: 'exactly_once.events.buffered',

  // AuditLog metrics
  AUDIT_LOG_APPEND_LATENCY: 'audit_log.append.latency',
  AUDIT_LOG_VERIFY_LATENCY: 'audit_log.verify.latency',
  AUDIT_LOG_ENTRY_COUNT: 'audit_log.entries.count',
  AUDIT_LOG_TAMPER_DETECTED: 'audit_log.tamper.detected',
  AUDIT_LOG_ENTRIES_PRUNED: 'audit_log.entries.pruned',

  // SchemaEvolution metrics
  SCHEMA_EVOLUTION_VERSION_COUNT: 'schema_evolution.versions.count',
  SCHEMA_EVOLUTION_COMPATIBILITY_CHECK_LATENCY: 'schema_evolution.compatibility_check.latency',
  SCHEMA_EVOLUTION_BREAKING_CHANGES: 'schema_evolution.breaking_changes.count',
} as const

export type MetricName = (typeof MetricNames)[keyof typeof MetricNames]

// =============================================================================
// METRICS INTERFACE
// =============================================================================

/**
 * Optional tags for metric context.
 */
export interface MetricTags {
  [key: string]: string | number | boolean | undefined
}

/**
 * Interface for collecting metrics from primitives.
 *
 * Implement this interface to integrate with your metrics backend
 * (e.g., Prometheus, DataDog, CloudWatch).
 */
export interface MetricsCollector {
  /**
   * Record a latency measurement in milliseconds.
   */
  recordLatency(name: string, value: number, tags?: MetricTags): void

  /**
   * Record a gauge value (point-in-time measurement).
   */
  recordGauge(name: string, value: number, tags?: MetricTags): void

  /**
   * Increment a counter.
   */
  incrementCounter(name: string, tags?: MetricTags, delta?: number): void
}

// =============================================================================
// NOOP IMPLEMENTATION
// =============================================================================

/**
 * No-op metrics collector for production use when metrics are not needed.
 * All methods are no-ops with zero overhead.
 */
export const noopMetrics: MetricsCollector = {
  recordLatency: () => {},
  recordGauge: () => {},
  incrementCounter: () => {},
}

// =============================================================================
// TEST IMPLEMENTATION
// =============================================================================

/**
 * Recorded metric entry for test assertions.
 */
export interface RecordedMetric {
  name: string
  value: number
  tags?: MetricTags
  timestamp: number
}

/**
 * Test metrics collector that records all metrics for verification.
 *
 * @example
 * ```typescript
 * const metrics = new TestMetricsCollector()
 * const store = new TemporalStore({ metrics })
 *
 * store.put('key', 'value', Date.now())
 *
 * // Verify metrics were recorded
 * expect(metrics.getLatencies('temporal_store.put.latency')).toHaveLength(1)
 * ```
 */
export class TestMetricsCollector implements MetricsCollector {
  private latencies: RecordedMetric[] = []
  private gauges: RecordedMetric[] = []
  private counters: Map<string, number> = new Map()
  private counterHistory: RecordedMetric[] = []

  recordLatency(name: string, value: number, tags?: MetricTags): void {
    this.latencies.push({ name, value, tags, timestamp: Date.now() })
  }

  recordGauge(name: string, value: number, tags?: MetricTags): void {
    this.gauges.push({ name, value, tags, timestamp: Date.now() })
  }

  incrementCounter(name: string, tags?: MetricTags, delta = 1): void {
    const current = this.counters.get(name) ?? 0
    this.counters.set(name, current + delta)
    this.counterHistory.push({ name, value: delta, tags, timestamp: Date.now() })
  }

  // Test utilities

  getLatencies(name?: string): RecordedMetric[] {
    return name ? this.latencies.filter((m) => m.name === name) : this.latencies
  }

  getGauges(name?: string): RecordedMetric[] {
    return name ? this.gauges.filter((m) => m.name === name) : this.gauges
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0
  }

  getCounterHistory(name?: string): RecordedMetric[] {
    return name ? this.counterHistory.filter((m) => m.name === name) : this.counterHistory
  }

  getLastGauge(name: string): number | undefined {
    const matching = this.gauges.filter((m) => m.name === name)
    return matching.length > 0 ? matching[matching.length - 1].value : undefined
  }

  reset(): void {
    this.latencies = []
    this.gauges = []
    this.counters.clear()
    this.counterHistory = []
  }
}
