/**
 * Prometheus Metrics Exporter
 *
 * Converts MetricsCollector data to Prometheus text exposition format.
 * Supports counter, gauge, and histogram metric types with proper labels.
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 * @module objects/unified-storage/prometheus-exporter
 */

import type { MetricsSnapshot, MetricCheckpointTrigger, MetricRecoverySource } from './metrics'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Prometheus metric type
 */
export type PrometheusMetricType = 'counter' | 'gauge' | 'histogram' | 'summary'

/**
 * Label set for a metric
 */
export type Labels = Record<string, string>

/**
 * Metric definition with metadata
 */
export interface MetricDefinition {
  name: string
  help: string
  type: PrometheusMetricType
}

/**
 * Configuration for PrometheusExporter
 */
export interface PrometheusExporterConfig {
  /** DO namespace/tenant identifier */
  namespace: string
  /** Maximum cardinality for entity_type labels (default: 50) */
  maxEntityTypeCardinality?: number
}

/**
 * Tracked operation for labeled metrics
 */
export interface TrackedOperation {
  operationType: 'create' | 'read' | 'update' | 'delete'
  entityType: string
  count: number
  durationSum: number
  durationCount: number
  durationBuckets: Map<number, number>
}

/**
 * Tracked event for labeled metrics
 */
export interface TrackedEvent {
  eventType: string
  count: number
}

/**
 * Tracked checkpoint for labeled metrics
 */
export interface TrackedCheckpoint {
  triggerType: MetricCheckpointTrigger
  count: number
  durationSum: number
  durationCount: number
  durationBuckets: Map<number, number>
}

/**
 * Tracked recovery for labeled metrics
 */
export interface TrackedRecovery {
  recoverySource: MetricRecoverySource
  count: number
  durationSum: number
  durationCount: number
  durationBuckets: Map<number, number>
}

/**
 * Interface for metrics provider
 */
export interface MetricsProvider {
  snapshot(): MetricsSnapshot
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard histogram buckets for latency (in seconds)
 */
const LATENCY_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

/**
 * Standard histogram buckets for batch sizes
 */
const BATCH_SIZE_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]

// ============================================================================
// METRIC DEFINITIONS
// ============================================================================

const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Info metric
  { name: 'dotdo_info', help: 'Information about the dotdo instance', type: 'gauge' },

  // Counter metrics
  { name: 'dotdo_writes_total', help: 'Total number of write operations to the unified store', type: 'counter' },
  { name: 'dotdo_reads_total', help: 'Total number of read operations from the unified store', type: 'counter' },
  { name: 'dotdo_cache_hits_total', help: 'Total number of cache hits for read operations', type: 'counter' },
  { name: 'dotdo_events_emitted_total', help: 'Total number of events emitted to the pipeline', type: 'counter' },
  { name: 'dotdo_checkpoints_total', help: 'Total number of checkpoint operations to SQLite persistence', type: 'counter' },

  // Histogram metrics
  { name: 'dotdo_operation_duration_seconds', help: 'Duration of operations in seconds by operation type', type: 'histogram' },
  { name: 'dotdo_batch_size', help: 'Size of batched operations during checkpoint or pipeline flush', type: 'histogram' },
  { name: 'dotdo_checkpoint_duration_seconds', help: 'Duration of checkpoint operations to SQLite in seconds', type: 'histogram' },
  { name: 'dotdo_recovery_duration_seconds', help: 'Duration of cold start recovery from SQLite or Iceberg in seconds', type: 'histogram' },

  // Gauge metrics
  { name: 'dotdo_buffer_size', help: 'Current number of entries waiting in buffer for flush', type: 'gauge' },
  { name: 'dotdo_dirty_entries_count', help: 'Current number of dirty entries pending checkpoint to SQLite', type: 'gauge' },
  { name: 'dotdo_entries_count', help: 'Current total number of entries in memory state', type: 'gauge' },
  { name: 'dotdo_entries_bytes', help: 'Current memory usage of entries in bytes', type: 'gauge' },
  { name: 'dotdo_replication_lag_seconds', help: 'Current replication lag in seconds', type: 'gauge' },
  { name: 'dotdo_cache_hit_ratio', help: 'Current cache hit ratio between 0 and 1', type: 'gauge' },
]

// ============================================================================
// PROMETHEUS EXPORTER
// ============================================================================

/**
 * PrometheusExporter - Exports metrics in Prometheus text exposition format
 *
 * @example
 * ```typescript
 * const exporter = new PrometheusExporter(metricsCollector, { namespace: 'tenant-1' })
 *
 * // Track operations with labels
 * exporter.trackOperation('create', 'Customer', 0.005)
 *
 * // Export all metrics
 * const text = exporter.export()
 * // # HELP dotdo_writes_total Total number of write operations
 * // # TYPE dotdo_writes_total counter
 * // dotdo_writes_total{namespace="tenant-1",operation_type="create",entity_type="Customer"} 1
 * ```
 */
export class PrometheusExporter {
  private config: Required<PrometheusExporterConfig>
  private metricsProvider: MetricsProvider

  // Tracked labeled metrics
  private operations: Map<string, TrackedOperation> = new Map()
  private events: Map<string, TrackedEvent> = new Map()
  private checkpoints: Map<string, TrackedCheckpoint> = new Map()
  private recoveries: Map<string, TrackedRecovery> = new Map()
  private cacheReads: Map<string, { hits: number; misses: number }> = new Map()

  // Batch tracking
  private batchOperations: Array<{ type: string; size: number }> = []

  // Entity type cardinality tracking
  private entityTypeCounts: Map<string, number> = new Map()

  constructor(metricsProvider: MetricsProvider, config: PrometheusExporterConfig) {
    this.metricsProvider = metricsProvider
    this.config = {
      namespace: config.namespace,
      maxEntityTypeCardinality: config.maxEntityTypeCardinality ?? 50,
    }
  }

  // ==========================================================================
  // TRACKING METHODS
  // ==========================================================================

  /**
   * Track an operation with labels
   */
  trackOperation(
    operationType: 'create' | 'read' | 'update' | 'delete',
    entityType: string,
    durationSeconds: number
  ): void {
    const normalizedEntityType = this.normalizeEntityType(entityType)
    const key = `${operationType}:${normalizedEntityType}`

    let op = this.operations.get(key)
    if (!op) {
      op = {
        operationType,
        entityType: normalizedEntityType,
        count: 0,
        durationSum: 0,
        durationCount: 0,
        durationBuckets: new Map(LATENCY_BUCKETS.map(b => [b, 0])),
      }
      this.operations.set(key, op)
    }

    op.count++
    op.durationSum += durationSeconds
    op.durationCount++

    // Update histogram buckets
    for (const bucket of LATENCY_BUCKETS) {
      if (durationSeconds <= bucket) {
        op.durationBuckets.set(bucket, (op.durationBuckets.get(bucket) ?? 0) + 1)
      }
    }
  }

  /**
   * Track a read operation with cache status
   */
  trackRead(entityType: string, cacheHit: boolean): void {
    const normalizedEntityType = this.normalizeEntityType(entityType)
    const key = normalizedEntityType

    let cache = this.cacheReads.get(key)
    if (!cache) {
      cache = { hits: 0, misses: 0 }
      this.cacheReads.set(key, cache)
    }

    if (cacheHit) {
      cache.hits++
    } else {
      cache.misses++
    }
  }

  /**
   * Track an emitted event
   */
  trackEvent(eventType: string): void {
    const key = eventType

    let event = this.events.get(key)
    if (!event) {
      event = { eventType, count: 0 }
      this.events.set(key, event)
    }

    event.count++
  }

  /**
   * Track a checkpoint operation
   */
  trackCheckpoint(triggerType: MetricCheckpointTrigger, durationSeconds: number): void {
    const key = triggerType

    let checkpoint = this.checkpoints.get(key)
    if (!checkpoint) {
      checkpoint = {
        triggerType,
        count: 0,
        durationSum: 0,
        durationCount: 0,
        durationBuckets: new Map(LATENCY_BUCKETS.map(b => [b, 0])),
      }
      this.checkpoints.set(key, checkpoint)
    }

    checkpoint.count++
    checkpoint.durationSum += durationSeconds
    checkpoint.durationCount++

    // Update histogram buckets
    for (const bucket of LATENCY_BUCKETS) {
      if (durationSeconds <= bucket) {
        checkpoint.durationBuckets.set(bucket, (checkpoint.durationBuckets.get(bucket) ?? 0) + 1)
      }
    }
  }

  /**
   * Track a recovery operation
   */
  trackRecovery(recoverySource: MetricRecoverySource, durationSeconds: number): void {
    const key = recoverySource

    let recovery = this.recoveries.get(key)
    if (!recovery) {
      recovery = {
        recoverySource,
        count: 0,
        durationSum: 0,
        durationCount: 0,
        durationBuckets: new Map(LATENCY_BUCKETS.map(b => [b, 0])),
      }
      this.recoveries.set(key, recovery)
    }

    recovery.count++
    recovery.durationSum += durationSeconds
    recovery.durationCount++

    // Update histogram buckets
    for (const bucket of LATENCY_BUCKETS) {
      if (durationSeconds <= bucket) {
        recovery.durationBuckets.set(bucket, (recovery.durationBuckets.get(bucket) ?? 0) + 1)
      }
    }
  }

  /**
   * Track a batch operation
   */
  trackBatch(type: 'checkpoint' | 'pipeline', size: number): void {
    this.batchOperations.push({ type, size })
  }

  // ==========================================================================
  // EXPORT METHODS
  // ==========================================================================

  /**
   * Export all metrics in Prometheus text exposition format
   */
  export(): string {
    const lines: string[] = []
    const snapshot = this.metricsProvider.snapshot()

    // Export info metric
    this.exportInfoMetric(lines)

    // Export counter metrics
    this.exportWritesTotal(lines, snapshot)
    this.exportReadsTotal(lines, snapshot)
    this.exportCacheHitsTotal(lines, snapshot)
    this.exportEventsEmittedTotal(lines, snapshot)
    this.exportCheckpointsTotal(lines, snapshot)

    // Export histogram metrics
    this.exportOperationDurationSeconds(lines, snapshot)
    this.exportBatchSize(lines)
    this.exportCheckpointDurationSeconds(lines, snapshot)
    this.exportRecoveryDurationSeconds(lines, snapshot)

    // Export gauge metrics
    this.exportBufferSize(lines, snapshot)
    this.exportDirtyEntriesCount(lines, snapshot)
    this.exportEntriesCount(lines, snapshot)
    this.exportEntriesBytes(lines, snapshot)
    this.exportReplicationLagSeconds(lines, snapshot)
    this.exportCacheHitRatio(lines, snapshot)

    return lines.join('\n')
  }

  /**
   * Export a single metric by name
   */
  exportMetric(name: string): string | null {
    const lines: string[] = []
    const snapshot = this.metricsProvider.snapshot()

    const baseName = name.replace(/_bucket$|_sum$|_count$|_total$/, '')

    switch (baseName) {
      case 'dotdo_info':
        this.exportInfoMetric(lines)
        break
      case 'dotdo_writes':
        this.exportWritesTotal(lines, snapshot)
        break
      case 'dotdo_reads':
        this.exportReadsTotal(lines, snapshot)
        break
      case 'dotdo_cache_hits':
        this.exportCacheHitsTotal(lines, snapshot)
        break
      case 'dotdo_events_emitted':
        this.exportEventsEmittedTotal(lines, snapshot)
        break
      case 'dotdo_checkpoints':
        this.exportCheckpointsTotal(lines, snapshot)
        break
      case 'dotdo_operation_duration_seconds':
        this.exportOperationDurationSeconds(lines, snapshot)
        break
      case 'dotdo_batch_size':
        this.exportBatchSize(lines)
        break
      case 'dotdo_checkpoint_duration_seconds':
        this.exportCheckpointDurationSeconds(lines, snapshot)
        break
      case 'dotdo_recovery_duration_seconds':
        this.exportRecoveryDurationSeconds(lines, snapshot)
        break
      case 'dotdo_buffer_size':
        this.exportBufferSize(lines, snapshot)
        break
      case 'dotdo_dirty_entries_count':
        this.exportDirtyEntriesCount(lines, snapshot)
        break
      case 'dotdo_entries_count':
        this.exportEntriesCount(lines, snapshot)
        break
      case 'dotdo_entries_bytes':
        this.exportEntriesBytes(lines, snapshot)
        break
      case 'dotdo_replication_lag_seconds':
        this.exportReplicationLagSeconds(lines, snapshot)
        break
      case 'dotdo_cache_hit_ratio':
        this.exportCacheHitRatio(lines, snapshot)
        break
      default:
        return null
    }

    return lines.length > 0 ? lines.join('\n') : null
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    return METRIC_DEFINITIONS.map(d => d.name)
  }

  /**
   * Serialize state for persistence (hibernation survival)
   */
  serialize(): string {
    return JSON.stringify({
      operations: Array.from(this.operations.entries()).map(([k, v]) => [
        k,
        { ...v, durationBuckets: Array.from(v.durationBuckets.entries()) },
      ]),
      events: Array.from(this.events.entries()),
      checkpoints: Array.from(this.checkpoints.entries()).map(([k, v]) => [
        k,
        { ...v, durationBuckets: Array.from(v.durationBuckets.entries()) },
      ]),
      recoveries: Array.from(this.recoveries.entries()).map(([k, v]) => [
        k,
        { ...v, durationBuckets: Array.from(v.durationBuckets.entries()) },
      ]),
      cacheReads: Array.from(this.cacheReads.entries()),
      batchOperations: this.batchOperations,
      entityTypeCounts: Array.from(this.entityTypeCounts.entries()),
    })
  }

  /**
   * Deserialize state from persistence
   */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data)

      if (parsed.operations) {
        this.operations = new Map(
          parsed.operations.map(([k, v]: [string, TrackedOperation & { durationBuckets: [number, number][] }]) => [
            k,
            { ...v, durationBuckets: new Map(v.durationBuckets) },
          ])
        )
      }

      if (parsed.events) {
        this.events = new Map(parsed.events)
      }

      if (parsed.checkpoints) {
        this.checkpoints = new Map(
          parsed.checkpoints.map(([k, v]: [string, TrackedCheckpoint & { durationBuckets: [number, number][] }]) => [
            k,
            { ...v, durationBuckets: new Map(v.durationBuckets) },
          ])
        )
      }

      if (parsed.recoveries) {
        this.recoveries = new Map(
          parsed.recoveries.map(([k, v]: [string, TrackedRecovery & { durationBuckets: [number, number][] }]) => [
            k,
            { ...v, durationBuckets: new Map(v.durationBuckets) },
          ])
        )
      }

      if (parsed.cacheReads) {
        this.cacheReads = new Map(parsed.cacheReads)
      }

      if (parsed.batchOperations) {
        this.batchOperations = parsed.batchOperations
      }

      if (parsed.entityTypeCounts) {
        this.entityTypeCounts = new Map(parsed.entityTypeCounts)
      }
    } catch {
      // Ignore deserialization errors, start fresh
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Normalize entity type with cardinality limiting
   */
  private normalizeEntityType(entityType: string): string {
    // Track entity type counts
    const count = (this.entityTypeCounts.get(entityType) ?? 0) + 1
    this.entityTypeCounts.set(entityType, count)

    // If we have too many entity types, aggregate lesser-used ones
    // Use >= to trigger limiting at exactly max (leaving room for 'other')
    if (this.entityTypeCounts.size >= this.config.maxEntityTypeCardinality) {
      // Get the top N-1 entity types by count (leaving 1 slot for 'other')
      const sortedTypes = Array.from(this.entityTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.config.maxEntityTypeCardinality - 1)
        .map(([type]) => type)

      if (!sortedTypes.includes(entityType)) {
        return 'other'
      }
    }

    return entityType
  }

  /**
   * Format labels for Prometheus output
   */
  private formatLabels(labels: Labels): string {
    const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`)
    return parts.length > 0 ? `{${parts.join(',')}}` : ''
  }

  /**
   * Write HELP and TYPE comments
   */
  private writeMetricHeader(lines: string[], name: string): void {
    const def = METRIC_DEFINITIONS.find(d => d.name === name)
    if (def) {
      lines.push(`# HELP ${def.name} ${def.help}`)
      lines.push(`# TYPE ${def.name} ${def.type}`)
    }
  }

  /**
   * Export dotdo_info gauge
   */
  private exportInfoMetric(lines: string[]): void {
    this.writeMetricHeader(lines, 'dotdo_info')
    const labels = this.formatLabels({
      namespace: this.config.namespace,
      version: '1.0.0',
    })
    lines.push(`dotdo_info${labels} 1`)
  }

  /**
   * Export dotdo_writes_total counter
   */
  private exportWritesTotal(lines: string[], _snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_writes_total')

    // Export tracked operations by type and entity
    for (const [, op] of this.operations) {
      if (op.operationType !== 'read') {
        const labels = this.formatLabels({
          namespace: this.config.namespace,
          operation_type: op.operationType,
          entity_type: op.entityType,
        })
        lines.push(`dotdo_writes_total${labels} ${op.count}`)
      }
    }

    // Ensure at least one line if no operations tracked
    if (this.operations.size === 0 || !Array.from(this.operations.values()).some(op => op.operationType !== 'read')) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        operation_type: 'create',
        entity_type: 'unknown',
      })
      lines.push(`dotdo_writes_total${labels} 0`)
    }
  }

  /**
   * Export dotdo_reads_total counter
   */
  private exportReadsTotal(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_reads_total')

    // Export with cache_status labels
    for (const [entityType, cache] of this.cacheReads) {
      if (cache.hits > 0) {
        const hitLabels = this.formatLabels({
          namespace: this.config.namespace,
          entity_type: entityType,
          cache_status: 'hit',
        })
        lines.push(`dotdo_reads_total${hitLabels} ${cache.hits}`)
      }

      if (cache.misses > 0) {
        const missLabels = this.formatLabels({
          namespace: this.config.namespace,
          entity_type: entityType,
          cache_status: 'miss',
        })
        lines.push(`dotdo_reads_total${missLabels} ${cache.misses}`)
      }
    }

    // Fallback to snapshot data
    const totalReads = snapshot.state.cache.hits + snapshot.state.cache.misses
    if (this.cacheReads.size === 0 && totalReads > 0) {
      const hitLabels = this.formatLabels({
        namespace: this.config.namespace,
        cache_status: 'hit',
      })
      lines.push(`dotdo_reads_total${hitLabels} ${snapshot.state.cache.hits}`)

      const missLabels = this.formatLabels({
        namespace: this.config.namespace,
        cache_status: 'miss',
      })
      lines.push(`dotdo_reads_total${missLabels} ${snapshot.state.cache.misses}`)
    }

    // Ensure at least one line
    if (this.cacheReads.size === 0 && totalReads === 0) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        cache_status: 'hit',
      })
      lines.push(`dotdo_reads_total${labels} 0`)
    }
  }

  /**
   * Export dotdo_cache_hits_total counter
   */
  private exportCacheHitsTotal(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_cache_hits_total')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    lines.push(`dotdo_cache_hits_total${labels} ${snapshot.state.cache.hits}`)
  }

  /**
   * Export dotdo_events_emitted_total counter
   */
  private exportEventsEmittedTotal(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_events_emitted_total')

    // Export by event type
    for (const [, event] of this.events) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        event_type: event.eventType,
      })
      lines.push(`dotdo_events_emitted_total${labels} ${event.count}`)
    }

    // Fallback to snapshot
    if (this.events.size === 0) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        event_type: 'thing.created',
      })
      lines.push(`dotdo_events_emitted_total${labels} ${snapshot.pipeline.events.emitted}`)
    }
  }

  /**
   * Export dotdo_checkpoints_total counter
   */
  private exportCheckpointsTotal(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_checkpoints_total')

    // Export by trigger type
    for (const [, checkpoint] of this.checkpoints) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        trigger_type: checkpoint.triggerType,
      })
      lines.push(`dotdo_checkpoints_total${labels} ${checkpoint.count}`)
    }

    // Fallback to snapshot triggers
    if (this.checkpoints.size === 0) {
      for (const [trigger, count] of Object.entries(snapshot.checkpoint.triggers)) {
        if (count > 0) {
          const labels = this.formatLabels({
            namespace: this.config.namespace,
            trigger_type: trigger,
          })
          lines.push(`dotdo_checkpoints_total${labels} ${count}`)
        }
      }
    }

    // Ensure at least one line
    const totalCheckpoints = Array.from(this.checkpoints.values()).reduce((sum, c) => sum + c.count, 0)
    if (totalCheckpoints === 0 && snapshot.checkpoint.count === 0) {
      const labels = this.formatLabels({
        namespace: this.config.namespace,
        trigger_type: 'manual',
      })
      lines.push(`dotdo_checkpoints_total${labels} 0`)
    }
  }

  /**
   * Export dotdo_operation_duration_seconds histogram
   */
  private exportOperationDurationSeconds(lines: string[], _snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_operation_duration_seconds')

    for (const [, op] of this.operations) {
      const baseLabels = {
        namespace: this.config.namespace,
        operation_type: op.operationType,
        entity_type: op.entityType,
      }

      // Export buckets
      let cumulative = 0
      for (const bucket of LATENCY_BUCKETS) {
        cumulative += op.durationBuckets.get(bucket) ?? 0
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_operation_duration_seconds_bucket${bucketLabels} ${cumulative}`)
      }

      // +Inf bucket
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_operation_duration_seconds_bucket${infLabels} ${op.durationCount}`)

      // Sum and count
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_operation_duration_seconds_sum${labels} ${op.durationSum}`)
      lines.push(`dotdo_operation_duration_seconds_count${labels} ${op.durationCount}`)
    }

    // Ensure at least one entry
    if (this.operations.size === 0) {
      const baseLabels = {
        namespace: this.config.namespace,
        operation_type: 'create',
        entity_type: 'unknown',
      }
      for (const bucket of LATENCY_BUCKETS) {
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_operation_duration_seconds_bucket${bucketLabels} 0`)
      }
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_operation_duration_seconds_bucket${infLabels} 0`)
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_operation_duration_seconds_sum${labels} 0`)
      lines.push(`dotdo_operation_duration_seconds_count${labels} 0`)
    }
  }

  /**
   * Export dotdo_batch_size histogram
   */
  private exportBatchSize(lines: string[]): void {
    this.writeMetricHeader(lines, 'dotdo_batch_size')

    // Aggregate by batch type
    const byType = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>()

    for (const batch of this.batchOperations) {
      let entry = byType.get(batch.type)
      if (!entry) {
        entry = { sum: 0, count: 0, buckets: new Map(BATCH_SIZE_BUCKETS.map(b => [b, 0])) }
        byType.set(batch.type, entry)
      }
      entry.sum += batch.size
      entry.count++

      for (const bucket of BATCH_SIZE_BUCKETS) {
        if (batch.size <= bucket) {
          entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1)
        }
      }
    }

    for (const [batchType, data] of byType) {
      const baseLabels = {
        namespace: this.config.namespace,
        batch_type: batchType,
      }

      // Export buckets
      let cumulative = 0
      for (const bucket of BATCH_SIZE_BUCKETS) {
        cumulative += data.buckets.get(bucket) ?? 0
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_batch_size_bucket${bucketLabels} ${cumulative}`)
      }

      // +Inf bucket
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_batch_size_bucket${infLabels} ${data.count}`)

      // Sum and count
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_batch_size_sum${labels} ${data.sum}`)
      lines.push(`dotdo_batch_size_count${labels} ${data.count}`)
    }

    // Ensure at least one entry
    if (byType.size === 0) {
      const baseLabels = {
        namespace: this.config.namespace,
        batch_type: 'checkpoint',
      }
      for (const bucket of BATCH_SIZE_BUCKETS) {
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_batch_size_bucket${bucketLabels} 0`)
      }
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_batch_size_bucket${infLabels} 0`)
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_batch_size_sum${labels} 0`)
      lines.push(`dotdo_batch_size_count${labels} 0`)
    }
  }

  /**
   * Export dotdo_checkpoint_duration_seconds histogram
   */
  private exportCheckpointDurationSeconds(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_checkpoint_duration_seconds')

    for (const [, checkpoint] of this.checkpoints) {
      const baseLabels = {
        namespace: this.config.namespace,
        trigger_type: checkpoint.triggerType,
      }

      // Export buckets
      let cumulative = 0
      for (const bucket of LATENCY_BUCKETS) {
        cumulative += checkpoint.durationBuckets.get(bucket) ?? 0
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_checkpoint_duration_seconds_bucket${bucketLabels} ${cumulative}`)
      }

      // +Inf bucket
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_checkpoint_duration_seconds_bucket${infLabels} ${checkpoint.durationCount}`)

      // Sum and count
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_checkpoint_duration_seconds_sum${labels} ${checkpoint.durationSum}`)
      lines.push(`dotdo_checkpoint_duration_seconds_count${labels} ${checkpoint.durationCount}`)
    }

    // Fallback for when we don't have detailed tracking
    if (this.checkpoints.size === 0 && snapshot.checkpoint.count > 0) {
      const baseLabels = {
        namespace: this.config.namespace,
        trigger_type: 'unknown',
      }

      // Estimate from snapshot
      const avgLatency = snapshot.checkpoint.latency.mean / 1000 // Convert ms to seconds

      for (const bucket of LATENCY_BUCKETS) {
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        // Estimate bucket counts based on mean
        const count = avgLatency <= bucket ? snapshot.checkpoint.count : 0
        lines.push(`dotdo_checkpoint_duration_seconds_bucket${bucketLabels} ${count}`)
      }

      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_checkpoint_duration_seconds_bucket${infLabels} ${snapshot.checkpoint.count}`)

      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_checkpoint_duration_seconds_sum${labels} ${avgLatency * snapshot.checkpoint.count}`)
      lines.push(`dotdo_checkpoint_duration_seconds_count${labels} ${snapshot.checkpoint.count}`)
    }

    // Ensure at least one entry
    if (this.checkpoints.size === 0 && snapshot.checkpoint.count === 0) {
      const baseLabels = {
        namespace: this.config.namespace,
        trigger_type: 'manual',
      }
      for (const bucket of LATENCY_BUCKETS) {
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_checkpoint_duration_seconds_bucket${bucketLabels} 0`)
      }
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_checkpoint_duration_seconds_bucket${infLabels} 0`)
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_checkpoint_duration_seconds_sum${labels} 0`)
      lines.push(`dotdo_checkpoint_duration_seconds_count${labels} 0`)
    }
  }

  /**
   * Export dotdo_recovery_duration_seconds histogram
   */
  private exportRecoveryDurationSeconds(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_recovery_duration_seconds')

    for (const [, recovery] of this.recoveries) {
      const baseLabels = {
        namespace: this.config.namespace,
        recovery_source: recovery.recoverySource,
      }

      // Export buckets
      let cumulative = 0
      for (const bucket of LATENCY_BUCKETS) {
        cumulative += recovery.durationBuckets.get(bucket) ?? 0
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_recovery_duration_seconds_bucket${bucketLabels} ${cumulative}`)
      }

      // +Inf bucket
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_recovery_duration_seconds_bucket${infLabels} ${recovery.durationCount}`)

      // Sum and count
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_recovery_duration_seconds_sum${labels} ${recovery.durationSum}`)
      lines.push(`dotdo_recovery_duration_seconds_count${labels} ${recovery.durationCount}`)
    }

    // Determine recovery source from snapshot
    if (this.recoveries.size === 0) {
      let source: MetricRecoverySource = 'empty'
      let totalRecoveries = 0

      for (const [src, count] of Object.entries(snapshot.recovery.sources)) {
        if (count > 0) {
          source = src as MetricRecoverySource
          totalRecoveries += count
        }
      }

      if (totalRecoveries > 0) {
        const baseLabels = {
          namespace: this.config.namespace,
          recovery_source: source,
        }

        const avgLatency = snapshot.recovery.latency.mean / 1000

        for (const bucket of LATENCY_BUCKETS) {
          const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
          const count = avgLatency <= bucket ? totalRecoveries : 0
          lines.push(`dotdo_recovery_duration_seconds_bucket${bucketLabels} ${count}`)
        }

        const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
        lines.push(`dotdo_recovery_duration_seconds_bucket${infLabels} ${totalRecoveries}`)

        const labels = this.formatLabels(baseLabels)
        lines.push(`dotdo_recovery_duration_seconds_sum${labels} ${avgLatency * totalRecoveries}`)
        lines.push(`dotdo_recovery_duration_seconds_count${labels} ${totalRecoveries}`)
      }
    }

    // Ensure at least one entry
    const totalRecoveries = this.recoveries.size > 0
      ? Array.from(this.recoveries.values()).reduce((sum, r) => sum + r.count, 0)
      : Object.values(snapshot.recovery.sources).reduce((sum, c) => sum + c, 0)

    if (totalRecoveries === 0) {
      const baseLabels = {
        namespace: this.config.namespace,
        recovery_source: 'empty',
      }
      for (const bucket of LATENCY_BUCKETS) {
        const bucketLabels = this.formatLabels({ ...baseLabels, le: bucket.toString() })
        lines.push(`dotdo_recovery_duration_seconds_bucket${bucketLabels} 0`)
      }
      const infLabels = this.formatLabels({ ...baseLabels, le: '+Inf' })
      lines.push(`dotdo_recovery_duration_seconds_bucket${infLabels} 0`)
      const labels = this.formatLabels(baseLabels)
      lines.push(`dotdo_recovery_duration_seconds_sum${labels} 0`)
      lines.push(`dotdo_recovery_duration_seconds_count${labels} 0`)
    }
  }

  /**
   * Export dotdo_buffer_size gauge
   */
  private exportBufferSize(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_buffer_size')

    // Pipeline buffer
    const pipelineLabels = this.formatLabels({
      namespace: this.config.namespace,
      buffer_type: 'pipeline',
    })
    lines.push(`dotdo_buffer_size${pipelineLabels} ${snapshot.pipeline.events.batched}`)

    // Checkpoint buffer (dirty entries)
    const checkpointLabels = this.formatLabels({
      namespace: this.config.namespace,
      buffer_type: 'checkpoint',
    })
    lines.push(`dotdo_buffer_size${checkpointLabels} ${snapshot.state.dirty.count}`)
  }

  /**
   * Export dotdo_dirty_entries_count gauge
   */
  private exportDirtyEntriesCount(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_dirty_entries_count')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    lines.push(`dotdo_dirty_entries_count${labels} ${snapshot.state.dirty.count}`)
  }

  /**
   * Export dotdo_entries_count gauge
   */
  private exportEntriesCount(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_entries_count')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    lines.push(`dotdo_entries_count${labels} ${snapshot.state.entries.count}`)
  }

  /**
   * Export dotdo_entries_bytes gauge
   */
  private exportEntriesBytes(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_entries_bytes')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    lines.push(`dotdo_entries_bytes${labels} ${snapshot.state.entries.bytes}`)
  }

  /**
   * Export dotdo_replication_lag_seconds gauge
   */
  private exportReplicationLagSeconds(lines: string[], _snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_replication_lag_seconds')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    // Currently static, would be updated by replication manager
    lines.push(`dotdo_replication_lag_seconds${labels} 0`)
  }

  /**
   * Export dotdo_cache_hit_ratio gauge
   */
  private exportCacheHitRatio(lines: string[], snapshot: MetricsSnapshot): void {
    this.writeMetricHeader(lines, 'dotdo_cache_hit_ratio')
    const labels = this.formatLabels({ namespace: this.config.namespace })
    lines.push(`dotdo_cache_hit_ratio${labels} ${snapshot.state.cache.hitRate}`)
  }
}
