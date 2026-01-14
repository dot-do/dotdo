/**
 * UnifiedStorageMetrics - Observability and metrics for unified storage components
 *
 * Provides comprehensive metrics collection for:
 * - InMemoryStateManager: Entry counts, memory usage, cache performance, evictions
 * - PipelineEmitter: Event emission, batching, flush latency, errors
 * - LazyCheckpointer: Checkpoint counts, latency, row writes, triggers
 * - ColdStartRecovery: Recovery duration, source type, loaded entities
 *
 * @module objects/unified-storage/metrics
 */

// ============================================================================
// METRIC TYPES
// ============================================================================

/**
 * Counter metric - monotonically increasing value
 */
export interface Counter {
  /** Current value */
  value: number
  /** Increment by amount (default: 1) */
  inc(amount?: number): void
  /** Reset to zero */
  reset(): void
}

/**
 * Gauge metric - can increase or decrease
 */
export interface Gauge {
  /** Current value */
  value: number
  /** Set to specific value */
  set(value: number): void
  /** Increment by amount (default: 1) */
  inc(amount?: number): void
  /** Decrement by amount (default: 1) */
  dec(amount?: number): void
}

/**
 * Histogram metric - tracks distribution of values
 */
export interface Histogram {
  /** Record a value */
  observe(value: number): void
  /** Get count of observations */
  count: number
  /** Get sum of all observations */
  sum: number
  /** Get mean of observations */
  mean: number
  /** Get min value */
  min: number
  /** Get max value */
  max: number
  /** Get percentile value (0-100) */
  percentile(p: number): number
  /** Reset histogram */
  reset(): void
}

// ============================================================================
// STATE MANAGER METRICS
// ============================================================================

/**
 * Metrics for InMemoryStateManager
 */
export interface StateManagerMetrics {
  /** Current number of entries */
  readonly entriesCount: Gauge
  /** Current memory usage in bytes */
  readonly entriesBytes: Gauge
  /** Number of dirty entries pending checkpoint */
  readonly dirtyCount: Gauge
  /** Cache hit count */
  readonly cacheHits: Counter
  /** Cache miss count */
  readonly cacheMisses: Counter
  /** Total eviction count */
  readonly evictionsCount: Counter
  /** Bytes evicted */
  readonly evictionsBytes: Counter
}

// ============================================================================
// PIPELINE EMITTER METRICS
// ============================================================================

/**
 * Metrics for PipelineEmitter
 */
export interface PipelineEmitterMetrics {
  /** Total events emitted */
  readonly eventsEmitted: Counter
  /** Events waiting in buffer */
  readonly eventsBatched: Gauge
  /** Number of flush operations */
  readonly flushCount: Counter
  /** Flush latency distribution in ms */
  readonly flushLatency: Histogram
  /** Failed emission count */
  readonly errorsCount: Counter
  /** Dead letter queue sends */
  readonly dlqCount: Counter
  /** Retry attempts */
  readonly retryCount: Counter
}

// ============================================================================
// CHECKPOINTER METRICS
// ============================================================================

/**
 * Checkpoint trigger type for metrics
 */
export type MetricCheckpointTrigger = 'timer' | 'threshold' | 'hibernation' | 'manual' | 'count' | 'memory'

/**
 * Metrics for LazyCheckpointer
 */
export interface CheckpointerMetrics {
  /** Total checkpoint count */
  readonly checkpointCount: Counter
  /** Checkpoint latency distribution in ms */
  readonly checkpointLatency: Histogram
  /** SQLite rows written */
  readonly rowsWritten: Counter
  /** Bytes written to SQLite */
  readonly bytesWritten: Counter
  /** Columnar writes (efficient single-row collections) */
  readonly columnarWrites: Counter
  /** Normalized writes (individual rows) */
  readonly normalizedWrites: Counter
  /** Checkpoint triggers by type */
  readonly triggerCounts: Record<MetricCheckpointTrigger, Counter>
}

// ============================================================================
// RECOVERY METRICS
// ============================================================================

/**
 * Recovery source type for metrics
 */
export type MetricRecoverySource = 'sqlite' | 'iceberg' | 'empty'

/**
 * Metrics for ColdStartRecovery
 */
export interface RecoveryMetrics {
  /** Total recovery duration in ms */
  readonly duration: Histogram
  /** Recovery count by source */
  readonly sourceCount: Record<MetricRecoverySource, Counter>
  /** Things loaded from recovery */
  readonly thingsLoaded: Counter
  /** Events replayed from Iceberg */
  readonly eventsReplayed: Counter
  /** Recovery errors */
  readonly errorsCount: Counter
}

// ============================================================================
// UNIFIED STORAGE METRICS
// ============================================================================

/**
 * Complete metrics interface for UnifiedStoreDO
 */
export interface UnifiedStorageMetrics {
  /** State manager metrics */
  readonly state: StateManagerMetrics
  /** Pipeline emitter metrics */
  readonly pipeline: PipelineEmitterMetrics
  /** Checkpointer metrics */
  readonly checkpoint: CheckpointerMetrics
  /** Recovery metrics */
  readonly recovery: RecoveryMetrics
  /** Get snapshot of all metrics */
  snapshot(): MetricsSnapshot
  /** Reset all metrics */
  reset(): void
}

/**
 * Serializable snapshot of all metrics
 */
export interface MetricsSnapshot {
  timestamp: number
  state: {
    entries: { count: number; bytes: number }
    dirty: { count: number }
    cache: { hits: number; misses: number; hitRate: number }
    evictions: { count: number; bytes: number }
  }
  pipeline: {
    events: { emitted: number; batched: number }
    flushes: { count: number; latency: { mean: number; p50: number; p95: number; p99: number } }
    errors: { count: number; dlq: number; retries: number }
  }
  checkpoint: {
    count: number
    latency: { mean: number; p50: number; p95: number; p99: number }
    rows: { written: number; columnar: number; normalized: number }
    bytes: number
    triggers: Record<MetricCheckpointTrigger, number>
  }
  recovery: {
    latency: { mean: number; p50: number; p95: number; p99: number }
    sources: Record<MetricRecoverySource, number>
    things: number
    events: number
    errors: number
  }
}

// ============================================================================
// METRIC IMPLEMENTATIONS
// ============================================================================

/**
 * Simple counter implementation
 */
class SimpleCounter implements Counter {
  private _value = 0

  get value(): number {
    return this._value
  }

  inc(amount = 1): void {
    this._value += amount
  }

  reset(): void {
    this._value = 0
  }
}

/**
 * Simple gauge implementation
 */
class SimpleGauge implements Gauge {
  private _value = 0

  get value(): number {
    return this._value
  }

  set(value: number): void {
    this._value = value
  }

  inc(amount = 1): void {
    this._value += amount
  }

  dec(amount = 1): void {
    this._value -= amount
  }
}

/**
 * Simple histogram implementation with reservoir sampling
 */
class SimpleHistogram implements Histogram {
  private values: number[] = []
  private _count = 0
  private _sum = 0
  private _min = Infinity
  private _max = -Infinity
  private readonly maxSamples: number

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples
  }

  observe(value: number): void {
    this._count++
    this._sum += value
    this._min = Math.min(this._min, value)
    this._max = Math.max(this._max, value)

    // Reservoir sampling for bounded memory
    if (this.values.length < this.maxSamples) {
      this.values.push(value)
    } else {
      const idx = Math.floor(Math.random() * this._count)
      if (idx < this.maxSamples) {
        this.values[idx] = value
      }
    }
  }

  get count(): number {
    return this._count
  }

  get sum(): number {
    return this._sum
  }

  get mean(): number {
    return this._count === 0 ? 0 : this._sum / this._count
  }

  get min(): number {
    return this._count === 0 ? 0 : this._min
  }

  get max(): number {
    return this._count === 0 ? 0 : this._max
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0
    const sorted = [...this.values].sort((a, b) => a - b)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]
  }

  reset(): void {
    this.values = []
    this._count = 0
    this._sum = 0
    this._min = Infinity
    this._max = -Infinity
  }
}

// ============================================================================
// METRICS COLLECTOR
// ============================================================================

/**
 * Metrics collector for unified storage components
 *
 * @example
 * ```typescript
 * const metrics = new MetricsCollector()
 *
 * // Record state manager metrics
 * metrics.state.entriesCount.set(100)
 * metrics.state.cacheHits.inc()
 *
 * // Record pipeline metrics
 * metrics.pipeline.eventsEmitted.inc(10)
 * metrics.pipeline.flushLatency.observe(15.5)
 *
 * // Get snapshot for export
 * const snapshot = metrics.snapshot()
 * console.log(snapshot.state.cache.hitRate)
 * ```
 */
export class MetricsCollector implements UnifiedStorageMetrics {
  readonly state: StateManagerMetrics
  readonly pipeline: PipelineEmitterMetrics
  readonly checkpoint: CheckpointerMetrics
  readonly recovery: RecoveryMetrics

  constructor() {
    // Initialize state manager metrics
    this.state = {
      entriesCount: new SimpleGauge(),
      entriesBytes: new SimpleGauge(),
      dirtyCount: new SimpleGauge(),
      cacheHits: new SimpleCounter(),
      cacheMisses: new SimpleCounter(),
      evictionsCount: new SimpleCounter(),
      evictionsBytes: new SimpleCounter(),
    }

    // Initialize pipeline emitter metrics
    this.pipeline = {
      eventsEmitted: new SimpleCounter(),
      eventsBatched: new SimpleGauge(),
      flushCount: new SimpleCounter(),
      flushLatency: new SimpleHistogram(),
      errorsCount: new SimpleCounter(),
      dlqCount: new SimpleCounter(),
      retryCount: new SimpleCounter(),
    }

    // Initialize checkpointer metrics
    this.checkpoint = {
      checkpointCount: new SimpleCounter(),
      checkpointLatency: new SimpleHistogram(),
      rowsWritten: new SimpleCounter(),
      bytesWritten: new SimpleCounter(),
      columnarWrites: new SimpleCounter(),
      normalizedWrites: new SimpleCounter(),
      triggerCounts: {
        timer: new SimpleCounter(),
        threshold: new SimpleCounter(),
        hibernation: new SimpleCounter(),
        manual: new SimpleCounter(),
        count: new SimpleCounter(),
        memory: new SimpleCounter(),
      },
    }

    // Initialize recovery metrics
    this.recovery = {
      duration: new SimpleHistogram(),
      sourceCount: {
        sqlite: new SimpleCounter(),
        iceberg: new SimpleCounter(),
        empty: new SimpleCounter(),
      },
      thingsLoaded: new SimpleCounter(),
      eventsReplayed: new SimpleCounter(),
      errorsCount: new SimpleCounter(),
    }
  }

  /**
   * Get a serializable snapshot of all metrics
   */
  snapshot(): MetricsSnapshot {
    const cacheTotal = this.state.cacheHits.value + this.state.cacheMisses.value
    const hitRate = cacheTotal === 0 ? 0 : this.state.cacheHits.value / cacheTotal

    return {
      timestamp: Date.now(),
      state: {
        entries: {
          count: this.state.entriesCount.value,
          bytes: this.state.entriesBytes.value,
        },
        dirty: {
          count: this.state.dirtyCount.value,
        },
        cache: {
          hits: this.state.cacheHits.value,
          misses: this.state.cacheMisses.value,
          hitRate,
        },
        evictions: {
          count: this.state.evictionsCount.value,
          bytes: this.state.evictionsBytes.value,
        },
      },
      pipeline: {
        events: {
          emitted: this.pipeline.eventsEmitted.value,
          batched: this.pipeline.eventsBatched.value,
        },
        flushes: {
          count: this.pipeline.flushCount.value,
          latency: {
            mean: this.pipeline.flushLatency.mean,
            p50: this.pipeline.flushLatency.percentile(50),
            p95: this.pipeline.flushLatency.percentile(95),
            p99: this.pipeline.flushLatency.percentile(99),
          },
        },
        errors: {
          count: this.pipeline.errorsCount.value,
          dlq: this.pipeline.dlqCount.value,
          retries: this.pipeline.retryCount.value,
        },
      },
      checkpoint: {
        count: this.checkpoint.checkpointCount.value,
        latency: {
          mean: this.checkpoint.checkpointLatency.mean,
          p50: this.checkpoint.checkpointLatency.percentile(50),
          p95: this.checkpoint.checkpointLatency.percentile(95),
          p99: this.checkpoint.checkpointLatency.percentile(99),
        },
        rows: {
          written: this.checkpoint.rowsWritten.value,
          columnar: this.checkpoint.columnarWrites.value,
          normalized: this.checkpoint.normalizedWrites.value,
        },
        bytes: this.checkpoint.bytesWritten.value,
        triggers: {
          timer: this.checkpoint.triggerCounts.timer.value,
          threshold: this.checkpoint.triggerCounts.threshold.value,
          hibernation: this.checkpoint.triggerCounts.hibernation.value,
          manual: this.checkpoint.triggerCounts.manual.value,
          count: this.checkpoint.triggerCounts.count.value,
          memory: this.checkpoint.triggerCounts.memory.value,
        },
      },
      recovery: {
        latency: {
          mean: this.recovery.duration.mean,
          p50: this.recovery.duration.percentile(50),
          p95: this.recovery.duration.percentile(95),
          p99: this.recovery.duration.percentile(99),
        },
        sources: {
          sqlite: this.recovery.sourceCount.sqlite.value,
          iceberg: this.recovery.sourceCount.iceberg.value,
          empty: this.recovery.sourceCount.empty.value,
        },
        things: this.recovery.thingsLoaded.value,
        events: this.recovery.eventsReplayed.value,
        errors: this.recovery.errorsCount.value,
      },
    }
  }

  /**
   * Reset all metrics to initial values
   */
  reset(): void {
    // Reset state metrics
    ;(this.state.entriesCount as SimpleGauge).set(0)
    ;(this.state.entriesBytes as SimpleGauge).set(0)
    ;(this.state.dirtyCount as SimpleGauge).set(0)
    this.state.cacheHits.reset()
    this.state.cacheMisses.reset()
    this.state.evictionsCount.reset()
    this.state.evictionsBytes.reset()

    // Reset pipeline metrics
    this.pipeline.eventsEmitted.reset()
    ;(this.pipeline.eventsBatched as SimpleGauge).set(0)
    this.pipeline.flushCount.reset()
    ;(this.pipeline.flushLatency as SimpleHistogram).reset()
    this.pipeline.errorsCount.reset()
    this.pipeline.dlqCount.reset()
    this.pipeline.retryCount.reset()

    // Reset checkpoint metrics
    this.checkpoint.checkpointCount.reset()
    ;(this.checkpoint.checkpointLatency as SimpleHistogram).reset()
    this.checkpoint.rowsWritten.reset()
    this.checkpoint.bytesWritten.reset()
    this.checkpoint.columnarWrites.reset()
    this.checkpoint.normalizedWrites.reset()
    Object.values(this.checkpoint.triggerCounts).forEach((c) => c.reset())

    // Reset recovery metrics
    ;(this.recovery.duration as SimpleHistogram).reset()
    Object.values(this.recovery.sourceCount).forEach((c) => c.reset())
    this.recovery.thingsLoaded.reset()
    this.recovery.eventsReplayed.reset()
    this.recovery.errorsCount.reset()
  }
}

/**
 * No-op metrics collector for when metrics are disabled
 */
export class NoOpMetricsCollector implements UnifiedStorageMetrics {
  private readonly noOpCounter: Counter = {
    value: 0,
    inc: () => {},
    reset: () => {},
  }
  private readonly noOpGauge: Gauge = {
    value: 0,
    set: () => {},
    inc: () => {},
    dec: () => {},
  }
  private readonly noOpHistogram: Histogram = {
    observe: () => {},
    count: 0,
    sum: 0,
    mean: 0,
    min: 0,
    max: 0,
    percentile: () => 0,
    reset: () => {},
  }

  readonly state: StateManagerMetrics = {
    entriesCount: this.noOpGauge,
    entriesBytes: this.noOpGauge,
    dirtyCount: this.noOpGauge,
    cacheHits: this.noOpCounter,
    cacheMisses: this.noOpCounter,
    evictionsCount: this.noOpCounter,
    evictionsBytes: this.noOpCounter,
  }

  readonly pipeline: PipelineEmitterMetrics = {
    eventsEmitted: this.noOpCounter,
    eventsBatched: this.noOpGauge,
    flushCount: this.noOpCounter,
    flushLatency: this.noOpHistogram,
    errorsCount: this.noOpCounter,
    dlqCount: this.noOpCounter,
    retryCount: this.noOpCounter,
  }

  readonly checkpoint: CheckpointerMetrics = {
    checkpointCount: this.noOpCounter,
    checkpointLatency: this.noOpHistogram,
    rowsWritten: this.noOpCounter,
    bytesWritten: this.noOpCounter,
    columnarWrites: this.noOpCounter,
    normalizedWrites: this.noOpCounter,
    triggerCounts: {
      timer: this.noOpCounter,
      threshold: this.noOpCounter,
      hibernation: this.noOpCounter,
      manual: this.noOpCounter,
      count: this.noOpCounter,
      memory: this.noOpCounter,
    },
  }

  readonly recovery: RecoveryMetrics = {
    duration: this.noOpHistogram,
    sourceCount: {
      sqlite: this.noOpCounter,
      iceberg: this.noOpCounter,
      empty: this.noOpCounter,
    },
    thingsLoaded: this.noOpCounter,
    eventsReplayed: this.noOpCounter,
    errorsCount: this.noOpCounter,
  }

  snapshot(): MetricsSnapshot {
    return {
      timestamp: Date.now(),
      state: {
        entries: { count: 0, bytes: 0 },
        dirty: { count: 0 },
        cache: { hits: 0, misses: 0, hitRate: 0 },
        evictions: { count: 0, bytes: 0 },
      },
      pipeline: {
        events: { emitted: 0, batched: 0 },
        flushes: { count: 0, latency: { mean: 0, p50: 0, p95: 0, p99: 0 } },
        errors: { count: 0, dlq: 0, retries: 0 },
      },
      checkpoint: {
        count: 0,
        latency: { mean: 0, p50: 0, p95: 0, p99: 0 },
        rows: { written: 0, columnar: 0, normalized: 0 },
        bytes: 0,
        triggers: { timer: 0, threshold: 0, hibernation: 0, manual: 0, count: 0, memory: 0 },
      },
      recovery: {
        latency: { mean: 0, p50: 0, p95: 0, p99: 0 },
        sources: { sqlite: 0, iceberg: 0, empty: 0 },
        things: 0,
        events: 0,
        errors: 0,
      },
    }
  }

  reset(): void {
    // No-op
  }
}
