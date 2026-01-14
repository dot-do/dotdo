/**
 * ShardMetrics - Hot shard detection and metrics collection
 *
 * Provides comprehensive metrics collection for shard routing and hot spot detection:
 * - Per-shard request counts, reads, writes, bytes transferred
 * - Latency tracking and distribution
 * - Hot spot detection with configurable thresholds
 * - Distribution scoring for uniformity analysis
 *
 * @module objects/unified-storage/shard-metrics
 */

import type { Counter, Gauge, Histogram } from './metrics'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metrics tracked per shard
 */
export interface ShardMetrics {
  /** Shard identifier */
  shardIndex: number
  /** Total request count */
  requestCount: number
  /** Read operation count */
  readCount: number
  /** Write operation count */
  writeCount: number
  /** Total bytes transferred (in + out) */
  bytesTransferred: number
  /** Latency observations for percentile calculations */
  latencyMs: number[]
  /** Last activity timestamp */
  lastActivityAt: number
}

/**
 * Snapshot of shard metrics for export
 */
export interface ShardMetricsSnapshot {
  shardIndex: number
  requestCount: number
  readCount: number
  writeCount: number
  bytesTransferred: number
  averageLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  lastActivityAt: number
}

/**
 * Hot shard info returned by detector
 */
export interface HotShardInfo {
  shardIndex: number
  requestCount: number
  loadRatio: number // Ratio compared to average
  reason: 'request_count' | 'write_count' | 'byte_size' | 'latency'
}

/**
 * Distribution score result
 */
export interface DistributionScore {
  /** Overall uniformity score (0-1, 1 = perfectly uniform) */
  score: number
  /** Coefficient of variation (lower = more uniform) */
  coefficientOfVariation: number
  /** Standard deviation of request counts */
  standardDeviation: number
  /** Mean request count across shards */
  meanRequestCount: number
  /** Min request count */
  minRequestCount: number
  /** Max request count */
  maxRequestCount: number
  /** Shard with most requests */
  hottestShard: number
  /** Shard with fewest requests */
  coldestShard: number
}

/**
 * Hot spot detector configuration
 */
export interface HotSpotDetectorConfig {
  /** Threshold multiplier for hot shard detection (default: 2.0 = 2x average) */
  hotThresholdMultiplier?: number
  /** Minimum requests before considering a shard hot (default: 10) */
  minRequestsForHotDetection?: number
  /** Window size in ms for sliding window metrics (default: 60000 = 1 minute) */
  windowMs?: number
  /** Enable alerting callbacks */
  enableAlerts?: boolean
}

/**
 * Request type for metric recording
 */
export type RequestType = 'read' | 'write' | 'other'

/**
 * Operation record for detailed tracking
 */
export interface OperationRecord {
  shardIndex: number
  type: RequestType
  bytes: number
  latencyMs: number
  timestamp: number
}

/**
 * Hot spot event for callbacks
 */
export interface HotSpotEvent {
  type: 'hot_spot_detected' | 'hot_spot_resolved' | 'distribution_warning'
  shardIndex?: number
  loadRatio?: number
  distributionScore?: number
  timestamp: number
  details: string
}

/**
 * Callback type for hot spot events
 */
export type HotSpotCallback = (event: HotSpotEvent) => void

// ============================================================================
// SHARD METRICS COLLECTOR
// ============================================================================

/**
 * ShardMetricsCollector - Collects per-shard metrics for routing operations
 *
 * Tracks request counts, read/write operations, bytes transferred, and latency
 * per shard for analysis and hot spot detection.
 *
 * @example
 * ```typescript
 * const collector = new ShardMetricsCollector({ shardCount: 16 })
 *
 * // Record operations
 * collector.recordOperation(5, 'read', 1024, 15.5)
 * collector.recordOperation(5, 'write', 2048, 25.0)
 *
 * // Get metrics
 * const metrics = collector.getShardMetrics(5)
 * console.log(metrics.requestCount) // 2
 *
 * // Get snapshot
 * const snapshot = collector.snapshot()
 * ```
 */
export class ShardMetricsCollector {
  private readonly shardCount: number
  private readonly metrics: Map<number, ShardMetrics> = new Map()
  private readonly windowMs: number
  private readonly maxLatencySamples: number

  // Sliding window records for time-based analysis
  private readonly recentOperations: OperationRecord[] = []
  private readonly maxRecentOperations: number = 10000

  constructor(config: { shardCount: number; windowMs?: number; maxLatencySamples?: number }) {
    this.shardCount = config.shardCount
    this.windowMs = config.windowMs ?? 60000 // 1 minute default
    this.maxLatencySamples = config.maxLatencySamples ?? 1000

    // Initialize metrics for all shards
    for (let i = 0; i < this.shardCount; i++) {
      this.initializeShard(i)
    }
  }

  /**
   * Initialize metrics for a shard
   */
  private initializeShard(shardIndex: number): void {
    this.metrics.set(shardIndex, {
      shardIndex,
      requestCount: 0,
      readCount: 0,
      writeCount: 0,
      bytesTransferred: 0,
      latencyMs: [],
      lastActivityAt: 0,
    })
  }

  /**
   * Record an operation on a shard
   */
  recordOperation(
    shardIndex: number,
    type: RequestType,
    bytes: number,
    latencyMs: number
  ): void {
    const metrics = this.metrics.get(shardIndex)
    if (!metrics) {
      // Auto-initialize if shard count changed
      this.initializeShard(shardIndex)
      return this.recordOperation(shardIndex, type, bytes, latencyMs)
    }

    const now = Date.now()

    // Update counters
    metrics.requestCount++
    metrics.bytesTransferred += bytes
    metrics.lastActivityAt = now

    if (type === 'read') {
      metrics.readCount++
    } else if (type === 'write') {
      metrics.writeCount++
    }

    // Track latency with reservoir sampling
    if (metrics.latencyMs.length < this.maxLatencySamples) {
      metrics.latencyMs.push(latencyMs)
    } else {
      // Reservoir sampling for bounded memory
      const idx = Math.floor(Math.random() * metrics.requestCount)
      if (idx < this.maxLatencySamples) {
        metrics.latencyMs[idx] = latencyMs
      }
    }

    // Track in sliding window
    const record: OperationRecord = {
      shardIndex,
      type,
      bytes,
      latencyMs,
      timestamp: now,
    }
    this.recentOperations.push(record)

    // Prune old records
    this.pruneRecentOperations()
  }

  /**
   * Prune old records from sliding window
   */
  private pruneRecentOperations(): void {
    const cutoff = Date.now() - this.windowMs
    while (this.recentOperations.length > 0 && this.recentOperations[0].timestamp < cutoff) {
      this.recentOperations.shift()
    }

    // Also cap at max size
    while (this.recentOperations.length > this.maxRecentOperations) {
      this.recentOperations.shift()
    }
  }

  /**
   * Get metrics for a specific shard
   */
  getShardMetrics(shardIndex: number): ShardMetrics | undefined {
    return this.metrics.get(shardIndex)
  }

  /**
   * Get snapshot of a shard's metrics
   */
  getShardSnapshot(shardIndex: number): ShardMetricsSnapshot | undefined {
    const metrics = this.metrics.get(shardIndex)
    if (!metrics) return undefined

    const sortedLatencies = [...metrics.latencyMs].sort((a, b) => a - b)
    const avgLatency =
      sortedLatencies.length > 0
        ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
        : 0

    return {
      shardIndex: metrics.shardIndex,
      requestCount: metrics.requestCount,
      readCount: metrics.readCount,
      writeCount: metrics.writeCount,
      bytesTransferred: metrics.bytesTransferred,
      averageLatencyMs: avgLatency,
      p50LatencyMs: this.percentile(sortedLatencies, 50),
      p95LatencyMs: this.percentile(sortedLatencies, 95),
      p99LatencyMs: this.percentile(sortedLatencies, 99),
      lastActivityAt: metrics.lastActivityAt,
    }
  }

  /**
   * Get metrics within the sliding window
   */
  getWindowMetrics(): Map<number, ShardMetrics> {
    const cutoff = Date.now() - this.windowMs
    const windowMetrics = new Map<number, ShardMetrics>()

    // Initialize window metrics for all shards
    for (let i = 0; i < this.shardCount; i++) {
      windowMetrics.set(i, {
        shardIndex: i,
        requestCount: 0,
        readCount: 0,
        writeCount: 0,
        bytesTransferred: 0,
        latencyMs: [],
        lastActivityAt: 0,
      })
    }

    // Aggregate recent operations
    for (const op of this.recentOperations) {
      if (op.timestamp >= cutoff) {
        const metrics = windowMetrics.get(op.shardIndex)
        if (metrics) {
          metrics.requestCount++
          metrics.bytesTransferred += op.bytes
          metrics.lastActivityAt = Math.max(metrics.lastActivityAt, op.timestamp)
          metrics.latencyMs.push(op.latencyMs)

          if (op.type === 'read') {
            metrics.readCount++
          } else if (op.type === 'write') {
            metrics.writeCount++
          }
        }
      }
    }

    return windowMetrics
  }

  /**
   * Get snapshot of all shards
   */
  snapshot(): ShardMetricsSnapshot[] {
    const snapshots: ShardMetricsSnapshot[] = []
    for (let i = 0; i < this.shardCount; i++) {
      const snap = this.getShardSnapshot(i)
      if (snap) {
        snapshots.push(snap)
      }
    }
    return snapshots
  }

  /**
   * Get total request count across all shards
   */
  getTotalRequestCount(): number {
    let total = 0
    for (const metrics of Array.from(this.metrics.values())) {
      total += metrics.requestCount
    }
    return total
  }

  /**
   * Get average request count per shard
   */
  getAverageRequestCount(): number {
    const total = this.getTotalRequestCount()
    return this.shardCount > 0 ? total / this.shardCount : 0
  }

  /**
   * Calculate percentile from sorted values
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0
    const idx = Math.ceil((p / 100) * sortedValues.length) - 1
    return sortedValues[Math.max(0, idx)]
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    for (let i = 0; i < this.shardCount; i++) {
      this.initializeShard(i)
    }
    this.recentOperations.length = 0
  }

  /**
   * Get shard count
   */
  getShardCount(): number {
    return this.shardCount
  }
}

// ============================================================================
// HOT SPOT DETECTOR
// ============================================================================

/**
 * HotSpotDetector - Identifies hot (overloaded) shards for rebalancing
 *
 * Uses configurable thresholds to detect shards that are receiving
 * disproportionate traffic compared to the average.
 *
 * @example
 * ```typescript
 * const collector = new ShardMetricsCollector({ shardCount: 16 })
 * const detector = new HotSpotDetector(collector, {
 *   hotThresholdMultiplier: 2.0, // 2x average = hot
 * })
 *
 * // Record operations...
 * collector.recordOperation(5, 'read', 1024, 15.5)
 *
 * // Detect hot shards
 * const hotShards = detector.getHotShards()
 * if (hotShards.length > 0) {
 *   console.log('Hot shards detected:', hotShards)
 * }
 *
 * // Get distribution score
 * const score = detector.getDistributionScore()
 * console.log(`Distribution uniformity: ${score.score}`)
 * ```
 */
export class HotSpotDetector {
  private readonly collector: ShardMetricsCollector
  private readonly config: Required<HotSpotDetectorConfig>
  private readonly callbacks: Set<HotSpotCallback> = new Set()
  private readonly knownHotShards: Set<number> = new Set()
  private lastDistributionScore: number = 1.0

  constructor(collector: ShardMetricsCollector, config: HotSpotDetectorConfig = {}) {
    this.collector = collector
    this.config = {
      hotThresholdMultiplier: config.hotThresholdMultiplier ?? 2.0,
      minRequestsForHotDetection: config.minRequestsForHotDetection ?? 10,
      windowMs: config.windowMs ?? 60000,
      enableAlerts: config.enableAlerts ?? false,
    }
  }

  /**
   * Register a callback for hot spot events
   */
  onHotSpot(callback: HotSpotCallback): void {
    this.callbacks.add(callback)
  }

  /**
   * Remove a hot spot callback
   */
  offHotSpot(callback: HotSpotCallback): void {
    this.callbacks.delete(callback)
  }

  /**
   * Emit a hot spot event
   */
  private emit(event: HotSpotEvent): void {
    if (!this.config.enableAlerts) return

    for (const callback of Array.from(this.callbacks)) {
      try {
        callback(event)
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Get list of hot shards
   *
   * A shard is considered "hot" if its request count exceeds
   * the average by the configured threshold multiplier.
   */
  getHotShards(): HotShardInfo[] {
    const hotShards: HotShardInfo[] = []
    const windowMetrics = this.collector.getWindowMetrics()

    // Calculate average across window
    let totalRequests = 0
    let totalWrites = 0
    let totalBytes = 0
    const shardCount = this.collector.getShardCount()

    for (const metrics of Array.from(windowMetrics.values())) {
      totalRequests += metrics.requestCount
      totalWrites += metrics.writeCount
      totalBytes += metrics.bytesTransferred
    }

    const avgRequests = shardCount > 0 ? totalRequests / shardCount : 0
    const avgWrites = shardCount > 0 ? totalWrites / shardCount : 0
    const avgBytes = shardCount > 0 ? totalBytes / shardCount : 0

    // Skip if not enough data
    if (totalRequests < this.config.minRequestsForHotDetection) {
      return hotShards
    }

    const threshold = this.config.hotThresholdMultiplier
    const newHotShards = new Set<number>()

    for (const metrics of Array.from(windowMetrics.values())) {
      // Check request count threshold
      if (avgRequests > 0 && metrics.requestCount > avgRequests * threshold) {
        const loadRatio = metrics.requestCount / avgRequests
        hotShards.push({
          shardIndex: metrics.shardIndex,
          requestCount: metrics.requestCount,
          loadRatio,
          reason: 'request_count',
        })
        newHotShards.add(metrics.shardIndex)
        continue
      }

      // Check write count threshold (writes are more expensive)
      if (avgWrites > 0 && metrics.writeCount > avgWrites * threshold) {
        const loadRatio = metrics.writeCount / avgWrites
        hotShards.push({
          shardIndex: metrics.shardIndex,
          requestCount: metrics.requestCount,
          loadRatio,
          reason: 'write_count',
        })
        newHotShards.add(metrics.shardIndex)
        continue
      }

      // Check byte size threshold
      if (avgBytes > 0 && metrics.bytesTransferred > avgBytes * threshold) {
        const loadRatio = metrics.bytesTransferred / avgBytes
        hotShards.push({
          shardIndex: metrics.shardIndex,
          requestCount: metrics.requestCount,
          loadRatio,
          reason: 'byte_size',
        })
        newHotShards.add(metrics.shardIndex)
      }
    }

    // Emit events for new hot shards
    for (const shardIndex of Array.from(newHotShards)) {
      if (!this.knownHotShards.has(shardIndex)) {
        const hotShard = hotShards.find((h) => h.shardIndex === shardIndex)
        if (hotShard) {
          this.emit({
            type: 'hot_spot_detected',
            shardIndex,
            loadRatio: hotShard.loadRatio,
            timestamp: Date.now(),
            details: `Shard ${shardIndex} detected as hot with ${hotShard.loadRatio.toFixed(2)}x average load (${hotShard.reason})`,
          })
        }
      }
    }

    // Emit events for resolved hot shards
    for (const shardIndex of Array.from(this.knownHotShards)) {
      if (!newHotShards.has(shardIndex)) {
        this.emit({
          type: 'hot_spot_resolved',
          shardIndex,
          timestamp: Date.now(),
          details: `Shard ${shardIndex} is no longer hot`,
        })
      }
    }

    // Update known hot shards
    this.knownHotShards.clear()
    for (const shardIndex of Array.from(newHotShards)) {
      this.knownHotShards.add(shardIndex)
    }

    return hotShards
  }

  /**
   * Get distribution score (0-1, where 1 = perfectly uniform)
   *
   * Uses coefficient of variation to measure distribution uniformity.
   * Lower CV = more uniform distribution = higher score.
   */
  getDistributionScore(): DistributionScore {
    const windowMetrics = this.collector.getWindowMetrics()
    const requestCounts: number[] = []

    for (const metrics of Array.from(windowMetrics.values())) {
      requestCounts.push(metrics.requestCount)
    }

    if (requestCounts.length === 0) {
      return {
        score: 1.0,
        coefficientOfVariation: 0,
        standardDeviation: 0,
        meanRequestCount: 0,
        minRequestCount: 0,
        maxRequestCount: 0,
        hottestShard: 0,
        coldestShard: 0,
      }
    }

    // Calculate statistics
    const sum = requestCounts.reduce((a, b) => a + b, 0)
    const mean = sum / requestCounts.length
    const min = Math.min(...requestCounts)
    const max = Math.max(...requestCounts)

    // Find hottest and coldest shards
    let hottestShard = 0
    let coldestShard = 0
    let hottestCount = -1
    let coldestCount = Infinity

    for (const metrics of Array.from(windowMetrics.values())) {
      if (metrics.requestCount > hottestCount) {
        hottestCount = metrics.requestCount
        hottestShard = metrics.shardIndex
      }
      if (metrics.requestCount < coldestCount) {
        coldestCount = metrics.requestCount
        coldestShard = metrics.shardIndex
      }
    }

    // Calculate standard deviation
    const squaredDiffs = requestCounts.map((x) => Math.pow(x - mean, 2))
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / requestCounts.length
    const stdDev = Math.sqrt(variance)

    // Calculate coefficient of variation (CV)
    // CV = stdDev / mean (lower = more uniform)
    const cv = mean > 0 ? stdDev / mean : 0

    // Convert CV to a 0-1 score
    // CV of 0 = perfectly uniform = score of 1
    // CV of 1 = very uneven = score of ~0.37
    // CV of 2 = extremely uneven = score of ~0.14
    const score = Math.exp(-cv)

    // Emit distribution warning if score drops significantly
    if (score < 0.5 && this.lastDistributionScore >= 0.5) {
      this.emit({
        type: 'distribution_warning',
        distributionScore: score,
        timestamp: Date.now(),
        details: `Distribution score dropped to ${score.toFixed(3)} (CV: ${cv.toFixed(3)})`,
      })
    }
    this.lastDistributionScore = score

    return {
      score,
      coefficientOfVariation: cv,
      standardDeviation: stdDev,
      meanRequestCount: mean,
      minRequestCount: min,
      maxRequestCount: max,
      hottestShard,
      coldestShard,
    }
  }

  /**
   * Check if a specific shard is hot
   */
  isShardHot(shardIndex: number): boolean {
    const hotShards = this.getHotShards()
    return hotShards.some((h) => h.shardIndex === shardIndex)
  }

  /**
   * Get the load ratio for a specific shard (compared to average)
   */
  getShardLoadRatio(shardIndex: number): number {
    const avg = this.collector.getAverageRequestCount()
    if (avg === 0) return 1.0

    const metrics = this.collector.getShardMetrics(shardIndex)
    if (!metrics) return 0

    return metrics.requestCount / avg
  }

  /**
   * Get current hot spot count
   */
  getHotSpotCount(): number {
    return this.getHotShards().length
  }

  /**
   * Check if the distribution needs rebalancing
   */
  needsRebalancing(): boolean {
    const score = this.getDistributionScore()
    // Suggest rebalancing if score < 0.5 (high variance) or any hot spots
    return score.score < 0.5 || this.getHotSpotCount() > 0
  }

  /**
   * Get configuration
   */
  getConfig(): HotSpotDetectorConfig {
    return { ...this.config }
  }
}

// ============================================================================
// INSTRUMENTED SHARD ROUTER
// ============================================================================

/**
 * Type for creating an instrumented forward function
 */
export type ForwardFunction = (
  partitionKey: string,
  request: Request
) => Promise<Response>

/**
 * Create an instrumented forward function that collects metrics
 *
 * @example
 * ```typescript
 * const collector = new ShardMetricsCollector({ shardCount: 16 })
 * const router = new ShardRouter({ ... })
 *
 * // Create instrumented forward
 * const instrumentedForward = createInstrumentedForward(
 *   (key, req) => router.forward(key, req),
 *   (key) => router.getShardIndex(key),
 *   collector
 * )
 *
 * // Use instrumented forward
 * const response = await instrumentedForward('customer-123', request)
 * ```
 */
export function createInstrumentedForward(
  forward: ForwardFunction,
  getShardIndex: (key: string) => number,
  collector: ShardMetricsCollector
): ForwardFunction {
  return async (partitionKey: string, request: Request): Promise<Response> => {
    const shardIndex = getShardIndex(partitionKey)
    const startTime = performance.now()

    // Determine request type from method
    const type: RequestType =
      request.method === 'GET' || request.method === 'HEAD'
        ? 'read'
        : request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE'
          ? 'write'
          : 'other'

    try {
      const response = await forward(partitionKey, request)
      const latencyMs = performance.now() - startTime

      // Estimate bytes from content-length or default
      const requestBytes = parseInt(request.headers.get('content-length') || '0', 10)
      const responseBytes = parseInt(response.headers.get('content-length') || '0', 10)
      const totalBytes = requestBytes + responseBytes

      collector.recordOperation(shardIndex, type, totalBytes, latencyMs)

      return response
    } catch (error) {
      const latencyMs = performance.now() - startTime
      // Still record the failed operation
      collector.recordOperation(shardIndex, type, 0, latencyMs)
      throw error
    }
  }
}

