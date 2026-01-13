/**
 * Flag Analytics - Exposure Event Tracking and Evaluation Metrics
 *
 * Provides comprehensive analytics for feature flag systems:
 * - **Exposure Tracking**: Record when users are exposed to flag variants
 * - **Evaluation Metrics**: Count evaluations, measure latency, track errors
 * - **Usage Dashboards**: Aggregate data for dashboards and reporting
 * - **Performance Impact**: Track evaluation performance over time
 *
 * Designed for integration with experiment platforms and analytics systems.
 *
 * @module db/primitives/feature-flags/analytics
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Exposure event - records when a user is exposed to a feature flag variant
 */
export interface ExposureEvent {
  /** Unique event ID */
  id: string
  /** Flag key that was evaluated */
  flagKey: string
  /** User ID who saw the flag */
  userId: string
  /** Anonymous ID if userId not available */
  anonymousId?: string
  /** Session ID for session-scoped experiments */
  sessionId?: string
  /** The variant the user was assigned to */
  variant: string
  /** The value that was returned */
  value: unknown
  /** Bucket number (0-100 or 0-10000) for debugging */
  bucket?: number
  /** Reason for this evaluation result */
  reason: ExposureReason
  /** Flag evaluation latency in milliseconds */
  evaluationLatencyMs: number
  /** When the exposure occurred */
  timestamp: Date
  /** User attributes at time of exposure */
  attributes?: Record<string, unknown>
  /** Environment where exposure occurred */
  environment?: string
  /** Additional context/metadata */
  metadata?: Record<string, unknown>
}

/**
 * Reason why this exposure occurred
 */
export type ExposureReason =
  | 'MATCH' // User matched targeting rules
  | 'ROLLOUT' // User was in percentage rollout
  | 'VARIANT_SELECTED' // User was bucketed into a variant
  | 'DEFAULT' // No rules matched, default returned
  | 'FLAG_DISABLED' // Flag was disabled
  | 'FLAG_NOT_FOUND' // Flag doesn't exist
  | 'FLAG_EXPIRED' // Flag has expired
  | 'KILL_SWITCH' // Kill switch is active
  | 'ENVIRONMENT_MISMATCH' // Wrong environment
  | 'PREREQUISITE_NOT_MET' // Prerequisite flag not met
  | 'NOT_IN_ROLLOUT' // User not in percentage rollout
  | 'OVERRIDE' // User has an override
  | 'ERROR' // Evaluation error occurred

/**
 * Evaluation metrics for a single flag
 */
export interface FlagMetrics {
  /** Flag key */
  flagKey: string
  /** Total number of evaluations */
  totalEvaluations: number
  /** Unique users exposed */
  uniqueUsers: number
  /** Unique sessions exposed */
  uniqueSessions: number
  /** Evaluations per variant */
  variantCounts: Record<string, number>
  /** Evaluations per reason */
  reasonCounts: Record<ExposureReason, number>
  /** Evaluation latency statistics */
  latency: LatencyMetrics
  /** Error count */
  errorCount: number
  /** Metrics by environment */
  byEnvironment?: Record<string, EnvironmentMetrics>
  /** First evaluation timestamp */
  firstEvaluation: Date
  /** Last evaluation timestamp */
  lastEvaluation: Date
  /** Time period for these metrics */
  period: MetricsPeriod
}

/**
 * Latency metrics
 */
export interface LatencyMetrics {
  /** Minimum latency in ms */
  min: number
  /** Maximum latency in ms */
  max: number
  /** Average latency in ms */
  avg: number
  /** Median latency in ms (p50) */
  p50: number
  /** 90th percentile latency in ms */
  p90: number
  /** 95th percentile latency in ms */
  p95: number
  /** 99th percentile latency in ms */
  p99: number
  /** Total latency samples */
  sampleCount: number
}

/**
 * Environment-specific metrics
 */
export interface EnvironmentMetrics {
  /** Environment name */
  environment: string
  /** Total evaluations in this environment */
  totalEvaluations: number
  /** Unique users in this environment */
  uniqueUsers: number
  /** Variant distribution in this environment */
  variantCounts: Record<string, number>
  /** Latency metrics for this environment */
  latency: LatencyMetrics
}

/**
 * Time period for metrics aggregation
 */
export interface MetricsPeriod {
  /** Start of period */
  start: Date
  /** End of period */
  end: Date
  /** Granularity of aggregation */
  granularity: 'minute' | 'hour' | 'day' | 'week' | 'month'
}

/**
 * Time series data point for dashboards
 */
export interface TimeSeriesPoint {
  /** Timestamp for this data point */
  timestamp: Date
  /** Total evaluations in this period */
  evaluations: number
  /** Unique users in this period */
  uniqueUsers: number
  /** Average latency in this period */
  avgLatency: number
  /** Error count in this period */
  errors: number
  /** Breakdown by variant */
  byVariant?: Record<string, number>
}

/**
 * Dashboard data for a flag
 */
export interface FlagDashboardData {
  /** Flag key */
  flagKey: string
  /** Current flag status */
  status: 'active' | 'disabled' | 'expired' | 'archived'
  /** Current rollout percentage */
  rolloutPercentage?: number
  /** Summary metrics */
  summary: FlagMetrics
  /** Time series data for charts */
  timeSeries: TimeSeriesPoint[]
  /** Top variants by evaluation count */
  topVariants: VariantSummary[]
  /** Performance trend (improving, degrading, stable) */
  performanceTrend: 'improving' | 'degrading' | 'stable'
  /** Alerts/warnings for this flag */
  alerts: FlagAlert[]
}

/**
 * Variant summary for dashboard
 */
export interface VariantSummary {
  /** Variant key */
  variant: string
  /** Variant value */
  value: unknown
  /** Number of users seeing this variant */
  userCount: number
  /** Percentage of total users */
  percentage: number
  /** Expected percentage (from weights) */
  expectedPercentage?: number
}

/**
 * Alert for flag issues
 */
export interface FlagAlert {
  /** Alert severity */
  severity: 'info' | 'warning' | 'error'
  /** Alert type */
  type: AlertType
  /** Human-readable message */
  message: string
  /** When alert was generated */
  timestamp: Date
  /** Additional data */
  data?: Record<string, unknown>
}

/**
 * Types of alerts
 */
export type AlertType =
  | 'HIGH_LATENCY' // Evaluation latency is above threshold
  | 'HIGH_ERROR_RATE' // Error rate is above threshold
  | 'EXPIRING_SOON' // Flag expires soon
  | 'STALE_FLAG' // Flag hasn't been evaluated recently
  | 'VARIANT_IMBALANCE' // Variant distribution differs from expected
  | 'PREREQUISITE_FAILURE' // Prerequisite flag issues
  | 'LOW_SAMPLE_SIZE' // Not enough data for reliable metrics

/**
 * Configuration for the analytics collector
 */
export interface FlagAnalyticsConfig {
  /** Maximum number of exposures to buffer before flushing */
  flushAt?: number
  /** Interval to flush buffered exposures (ms) */
  flushInterval?: number
  /** Maximum buffer size before dropping events */
  maxBufferSize?: number
  /** Enable deduplication of exposures within window */
  dedupWindow?: number
  /** Callback when exposures are flushed */
  onFlush?: (exposures: ExposureEvent[]) => Promise<void> | void
  /** Callback on errors */
  onError?: (error: Error) => void
  /** Sample rate for exposure tracking (0-1, default 1) */
  sampleRate?: number
  /** Latency percentiles to track */
  percentiles?: number[]
  /** Alert thresholds */
  alertThresholds?: AlertThresholds
}

/**
 * Thresholds for generating alerts
 */
export interface AlertThresholds {
  /** Latency threshold in ms (default: 100) */
  highLatencyMs?: number
  /** Error rate threshold (0-1, default: 0.01) */
  highErrorRate?: number
  /** Days before expiry to warn (default: 7) */
  expiryWarningDays?: number
  /** Days without evaluation to mark stale (default: 30) */
  staleDays?: number
  /** Allowed deviation from expected variant distribution (0-1, default: 0.1) */
  variantImbalanceThreshold?: number
  /** Minimum samples for reliable metrics (default: 100) */
  minSampleSize?: number
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface LatencyBuffer {
  values: number[]
  sum: number
  min: number
  max: number
}

interface UserTracker {
  users: Set<string>
  sessions: Set<string>
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      id += '-'
    }
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)]!
}

/**
 * Merge latency buffers
 */
function mergeLatencyBuffers(buffers: LatencyBuffer[]): LatencyBuffer {
  if (buffers.length === 0) {
    return { values: [], sum: 0, min: Infinity, max: -Infinity }
  }

  const allValues: number[] = []
  let sum = 0
  let min = Infinity
  let max = -Infinity

  for (const buffer of buffers) {
    allValues.push(...buffer.values)
    sum += buffer.sum
    min = Math.min(min, buffer.min)
    max = Math.max(max, buffer.max)
  }

  return { values: allValues, sum, min, max }
}

/**
 * Calculate latency metrics from buffer
 */
function calculateLatencyMetrics(buffer: LatencyBuffer): LatencyMetrics {
  if (buffer.values.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      sampleCount: 0,
    }
  }

  const sorted = [...buffer.values].sort((a, b) => a - b)

  return {
    min: buffer.min,
    max: buffer.max,
    avg: buffer.sum / buffer.values.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    sampleCount: buffer.values.length,
  }
}

// =============================================================================
// FLAG ANALYTICS COLLECTOR
// =============================================================================

/**
 * FlagAnalytics - Collects and aggregates feature flag analytics
 *
 * Tracks exposure events, evaluation metrics, and generates dashboard data.
 */
export class FlagAnalytics {
  private readonly config: Required<
    Pick<
      FlagAnalyticsConfig,
      'flushAt' | 'flushInterval' | 'maxBufferSize' | 'dedupWindow' | 'sampleRate' | 'percentiles'
    >
  > &
    Pick<FlagAnalyticsConfig, 'onFlush' | 'onError' | 'alertThresholds'>

  private buffer: ExposureEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  // Deduplication
  private seenExposures: Map<string, number> = new Map()

  // Metrics aggregation
  private flagMetrics: Map<string, FlagMetricsAccumulator> = new Map()
  private timeSeriesData: Map<string, TimeSeriesAccumulator> = new Map()

  constructor(config: FlagAnalyticsConfig = {}) {
    this.config = {
      flushAt: config.flushAt ?? 100,
      flushInterval: config.flushInterval ?? 10000,
      maxBufferSize: config.maxBufferSize ?? 10000,
      dedupWindow: config.dedupWindow ?? 60000,
      sampleRate: config.sampleRate ?? 1,
      percentiles: config.percentiles ?? [50, 90, 95, 99],
      onFlush: config.onFlush,
      onError: config.onError,
      alertThresholds: config.alertThresholds,
    }

    this.startFlushTimer()
  }

  private startFlushTimer(): void {
    if (this.config.flushInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
        })
      }, this.config.flushInterval)
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Track an exposure event
   */
  trackExposure(event: Omit<ExposureEvent, 'id' | 'timestamp'>): ExposureEvent {
    if (this.closed) {
      throw new Error('FlagAnalytics is closed')
    }

    // Apply sampling
    if (this.config.sampleRate < 1 && Math.random() > this.config.sampleRate) {
      // Still create the event for return, but don't track it
      return {
        ...event,
        id: generateId(),
        timestamp: new Date(),
      }
    }

    const exposure: ExposureEvent = {
      ...event,
      id: generateId(),
      timestamp: new Date(),
    }

    // Check deduplication
    const dedupKey = this.getDedupKey(exposure)
    const lastSeen = this.seenExposures.get(dedupKey)
    const now = Date.now()

    if (lastSeen && now - lastSeen < this.config.dedupWindow) {
      // Still update metrics but don't add to buffer
      this.updateMetrics(exposure)
      return exposure
    }

    this.seenExposures.set(dedupKey, now)

    // Add to buffer
    this.addToBuffer(exposure)

    // Update metrics
    this.updateMetrics(exposure)

    return exposure
  }

  /**
   * Create an exposure from evaluation result (convenience method)
   */
  createExposure(
    flagKey: string,
    userId: string,
    result: {
      value: unknown
      variant?: string
      reason: ExposureReason
      bucket?: number
    },
    context?: {
      anonymousId?: string
      sessionId?: string
      attributes?: Record<string, unknown>
      environment?: string
      metadata?: Record<string, unknown>
    },
    evaluationLatencyMs: number = 0
  ): ExposureEvent {
    return this.trackExposure({
      flagKey,
      userId,
      anonymousId: context?.anonymousId,
      sessionId: context?.sessionId,
      variant: result.variant ?? 'default',
      value: result.value,
      bucket: result.bucket,
      reason: result.reason,
      evaluationLatencyMs,
      attributes: context?.attributes,
      environment: context?.environment,
      metadata: context?.metadata,
    })
  }

  private getDedupKey(exposure: ExposureEvent): string {
    return `${exposure.flagKey}:${exposure.userId || exposure.anonymousId}:${exposure.variant}`
  }

  private addToBuffer(exposure: ExposureEvent): void {
    // Enforce max buffer size
    while (this.buffer.length >= this.config.maxBufferSize) {
      this.buffer.shift()
    }

    this.buffer.push(exposure)

    // Auto-flush if batch size reached
    if (this.buffer.length >= this.config.flushAt) {
      this.flush().catch((err) => {
        this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
      })
    }
  }

  private updateMetrics(exposure: ExposureEvent): void {
    // Get or create flag metrics accumulator
    let metrics = this.flagMetrics.get(exposure.flagKey)
    if (!metrics) {
      metrics = new FlagMetricsAccumulator(exposure.flagKey)
      this.flagMetrics.set(exposure.flagKey, metrics)
    }

    metrics.record(exposure)

    // Update time series
    const hourKey = this.getHourKey(exposure.timestamp)
    const seriesKey = `${exposure.flagKey}:${hourKey}`
    let series = this.timeSeriesData.get(seriesKey)
    if (!series) {
      series = new TimeSeriesAccumulator(this.getHourStart(exposure.timestamp))
      this.timeSeriesData.set(seriesKey, series)
    }

    series.record(exposure)
  }

  private getHourKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`
  }

  private getHourStart(date: Date): Date {
    const start = new Date(date)
    start.setMinutes(0, 0, 0)
    return start
  }

  /**
   * Flush buffered exposures
   */
  async flush(): Promise<{ count: number; errors: number }> {
    if (this.buffer.length === 0) {
      return { count: 0, errors: 0 }
    }

    const batch = [...this.buffer]
    this.buffer = []

    let errors = 0

    if (this.config.onFlush) {
      try {
        await this.config.onFlush(batch)
      } catch (err) {
        errors++
        this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }

    // Clean up old dedup entries
    this.cleanupDedupCache()

    return { count: batch.length, errors }
  }

  private cleanupDedupCache(): void {
    const now = Date.now()
    const cutoff = now - this.config.dedupWindow * 2

    for (const [key, timestamp] of this.seenExposures) {
      if (timestamp < cutoff) {
        this.seenExposures.delete(key)
      }
    }
  }

  /**
   * Get metrics for a specific flag
   */
  getMetrics(flagKey: string): FlagMetrics | null {
    const accumulator = this.flagMetrics.get(flagKey)
    if (!accumulator) return null

    return accumulator.toMetrics()
  }

  /**
   * Get metrics for all flags
   */
  getAllMetrics(): FlagMetrics[] {
    return Array.from(this.flagMetrics.values()).map((acc) => acc.toMetrics())
  }

  /**
   * Get time series data for a flag
   */
  getTimeSeries(flagKey: string, hours: number = 24): TimeSeriesPoint[] {
    const points: TimeSeriesPoint[] = []
    const now = new Date()

    for (let i = hours - 1; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000)
      const hourKey = this.getHourKey(hour)
      const seriesKey = `${flagKey}:${hourKey}`

      const series = this.timeSeriesData.get(seriesKey)
      if (series) {
        points.push(series.toPoint())
      } else {
        // Add zero point for missing hours
        points.push({
          timestamp: this.getHourStart(hour),
          evaluations: 0,
          uniqueUsers: 0,
          avgLatency: 0,
          errors: 0,
        })
      }
    }

    return points
  }

  /**
   * Get dashboard data for a flag
   */
  getDashboardData(
    flagKey: string,
    options?: {
      timeSeriesHours?: number
      flagStatus?: 'active' | 'disabled' | 'expired' | 'archived'
      rolloutPercentage?: number
      expectedVariantWeights?: Record<string, number>
    }
  ): FlagDashboardData | null {
    const metrics = this.getMetrics(flagKey)
    if (!metrics) return null

    const timeSeries = this.getTimeSeries(flagKey, options?.timeSeriesHours ?? 24)

    // Calculate top variants
    const topVariants: VariantSummary[] = Object.entries(metrics.variantCounts)
      .map(([variant, count]) => ({
        variant,
        value: variant, // In practice, we'd store the actual value
        userCount: count,
        percentage: (count / metrics.totalEvaluations) * 100,
        expectedPercentage: options?.expectedVariantWeights?.[variant],
      }))
      .sort((a, b) => b.userCount - a.userCount)

    // Calculate performance trend
    const recentLatency = timeSeries.slice(-6).map((p) => p.avgLatency)
    const olderLatency = timeSeries.slice(-12, -6).map((p) => p.avgLatency)
    const avgRecent = recentLatency.reduce((a, b) => a + b, 0) / (recentLatency.length || 1)
    const avgOlder = olderLatency.reduce((a, b) => a + b, 0) / (olderLatency.length || 1)

    let performanceTrend: 'improving' | 'degrading' | 'stable' = 'stable'
    if (avgOlder > 0) {
      const change = (avgRecent - avgOlder) / avgOlder
      if (change < -0.1) performanceTrend = 'improving'
      else if (change > 0.1) performanceTrend = 'degrading'
    }

    // Generate alerts
    const alerts = this.generateAlerts(flagKey, metrics, topVariants, options)

    return {
      flagKey,
      status: options?.flagStatus ?? 'active',
      rolloutPercentage: options?.rolloutPercentage,
      summary: metrics,
      timeSeries,
      topVariants,
      performanceTrend,
      alerts,
    }
  }

  private generateAlerts(
    flagKey: string,
    metrics: FlagMetrics,
    variants: VariantSummary[],
    options?: { expectedVariantWeights?: Record<string, number> }
  ): FlagAlert[] {
    const alerts: FlagAlert[] = []
    const thresholds = this.config.alertThresholds ?? {}

    // High latency alert
    const highLatencyMs = thresholds.highLatencyMs ?? 100
    if (metrics.latency.p95 > highLatencyMs) {
      alerts.push({
        severity: 'warning',
        type: 'HIGH_LATENCY',
        message: `P95 latency (${metrics.latency.p95.toFixed(1)}ms) exceeds threshold (${highLatencyMs}ms)`,
        timestamp: new Date(),
        data: { p95: metrics.latency.p95, threshold: highLatencyMs },
      })
    }

    // High error rate alert
    const highErrorRate = thresholds.highErrorRate ?? 0.01
    const errorRate = metrics.errorCount / (metrics.totalEvaluations || 1)
    if (errorRate > highErrorRate) {
      alerts.push({
        severity: 'error',
        type: 'HIGH_ERROR_RATE',
        message: `Error rate (${(errorRate * 100).toFixed(2)}%) exceeds threshold (${(highErrorRate * 100).toFixed(2)}%)`,
        timestamp: new Date(),
        data: { errorRate, threshold: highErrorRate },
      })
    }

    // Low sample size alert
    const minSampleSize = thresholds.minSampleSize ?? 100
    if (metrics.totalEvaluations < minSampleSize) {
      alerts.push({
        severity: 'info',
        type: 'LOW_SAMPLE_SIZE',
        message: `Sample size (${metrics.totalEvaluations}) is below minimum (${minSampleSize}) for reliable metrics`,
        timestamp: new Date(),
        data: { sampleSize: metrics.totalEvaluations, minimum: minSampleSize },
      })
    }

    // Variant imbalance alert
    const imbalanceThreshold = thresholds.variantImbalanceThreshold ?? 0.1
    if (options?.expectedVariantWeights && metrics.totalEvaluations >= minSampleSize) {
      for (const variant of variants) {
        if (variant.expectedPercentage !== undefined) {
          const deviation = Math.abs(variant.percentage - variant.expectedPercentage) / 100
          if (deviation > imbalanceThreshold) {
            alerts.push({
              severity: 'warning',
              type: 'VARIANT_IMBALANCE',
              message: `Variant "${variant.variant}" distribution (${variant.percentage.toFixed(1)}%) differs from expected (${variant.expectedPercentage.toFixed(1)}%)`,
              timestamp: new Date(),
              data: {
                variant: variant.variant,
                actual: variant.percentage,
                expected: variant.expectedPercentage,
                deviation,
              },
            })
          }
        }
      }
    }

    // Stale flag alert
    const staleDays = thresholds.staleDays ?? 30
    const daysSinceEval = (Date.now() - metrics.lastEvaluation.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceEval > staleDays) {
      alerts.push({
        severity: 'info',
        type: 'STALE_FLAG',
        message: `Flag hasn't been evaluated in ${Math.floor(daysSinceEval)} days`,
        timestamp: new Date(),
        data: { daysSinceEvaluation: Math.floor(daysSinceEval) },
      })
    }

    return alerts
  }

  /**
   * Get buffer size
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Close the analytics collector
   */
  async close(): Promise<void> {
    if (this.closed) return

    this.stopFlushTimer()
    await this.flush()
    this.closed = true
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.buffer = []
    this.seenExposures.clear()
    this.flagMetrics.clear()
    this.timeSeriesData.clear()
  }
}

// =============================================================================
// INTERNAL ACCUMULATORS
// =============================================================================

class FlagMetricsAccumulator {
  flagKey: string
  totalEvaluations = 0
  userIds: Set<string> = new Set()
  sessionIds: Set<string> = new Set()
  variantCounts: Record<string, number> = {}
  reasonCounts: Partial<Record<ExposureReason, number>> = {}
  latencyBuffer: LatencyBuffer = { values: [], sum: 0, min: Infinity, max: -Infinity }
  errorCount = 0
  environmentMetrics: Map<string, EnvironmentAccumulator> = new Map()
  firstEvaluation: Date | null = null
  lastEvaluation: Date | null = null

  constructor(flagKey: string) {
    this.flagKey = flagKey
  }

  record(exposure: ExposureEvent): void {
    this.totalEvaluations++

    // Track users and sessions
    if (exposure.userId) {
      this.userIds.add(exposure.userId)
    }
    if (exposure.sessionId) {
      this.sessionIds.add(exposure.sessionId)
    }

    // Track variants
    this.variantCounts[exposure.variant] = (this.variantCounts[exposure.variant] ?? 0) + 1

    // Track reasons
    this.reasonCounts[exposure.reason] = (this.reasonCounts[exposure.reason] ?? 0) + 1

    // Track latency
    this.latencyBuffer.values.push(exposure.evaluationLatencyMs)
    this.latencyBuffer.sum += exposure.evaluationLatencyMs
    this.latencyBuffer.min = Math.min(this.latencyBuffer.min, exposure.evaluationLatencyMs)
    this.latencyBuffer.max = Math.max(this.latencyBuffer.max, exposure.evaluationLatencyMs)

    // Track errors
    if (exposure.reason === 'ERROR') {
      this.errorCount++
    }

    // Track timestamps
    if (!this.firstEvaluation || exposure.timestamp < this.firstEvaluation) {
      this.firstEvaluation = exposure.timestamp
    }
    if (!this.lastEvaluation || exposure.timestamp > this.lastEvaluation) {
      this.lastEvaluation = exposure.timestamp
    }

    // Track by environment
    if (exposure.environment) {
      let envMetrics = this.environmentMetrics.get(exposure.environment)
      if (!envMetrics) {
        envMetrics = new EnvironmentAccumulator(exposure.environment)
        this.environmentMetrics.set(exposure.environment, envMetrics)
      }
      envMetrics.record(exposure)
    }
  }

  toMetrics(): FlagMetrics {
    const now = new Date()
    return {
      flagKey: this.flagKey,
      totalEvaluations: this.totalEvaluations,
      uniqueUsers: this.userIds.size,
      uniqueSessions: this.sessionIds.size,
      variantCounts: { ...this.variantCounts },
      reasonCounts: this.reasonCounts as Record<ExposureReason, number>,
      latency: calculateLatencyMetrics(this.latencyBuffer),
      errorCount: this.errorCount,
      byEnvironment:
        this.environmentMetrics.size > 0
          ? Object.fromEntries(
              Array.from(this.environmentMetrics.entries()).map(([env, acc]) => [env, acc.toMetrics()])
            )
          : undefined,
      firstEvaluation: this.firstEvaluation ?? now,
      lastEvaluation: this.lastEvaluation ?? now,
      period: {
        start: this.firstEvaluation ?? now,
        end: this.lastEvaluation ?? now,
        granularity: 'hour',
      },
    }
  }
}

class EnvironmentAccumulator {
  environment: string
  totalEvaluations = 0
  userIds: Set<string> = new Set()
  variantCounts: Record<string, number> = {}
  latencyBuffer: LatencyBuffer = { values: [], sum: 0, min: Infinity, max: -Infinity }

  constructor(environment: string) {
    this.environment = environment
  }

  record(exposure: ExposureEvent): void {
    this.totalEvaluations++

    if (exposure.userId) {
      this.userIds.add(exposure.userId)
    }

    this.variantCounts[exposure.variant] = (this.variantCounts[exposure.variant] ?? 0) + 1

    this.latencyBuffer.values.push(exposure.evaluationLatencyMs)
    this.latencyBuffer.sum += exposure.evaluationLatencyMs
    this.latencyBuffer.min = Math.min(this.latencyBuffer.min, exposure.evaluationLatencyMs)
    this.latencyBuffer.max = Math.max(this.latencyBuffer.max, exposure.evaluationLatencyMs)
  }

  toMetrics(): EnvironmentMetrics {
    return {
      environment: this.environment,
      totalEvaluations: this.totalEvaluations,
      uniqueUsers: this.userIds.size,
      variantCounts: { ...this.variantCounts },
      latency: calculateLatencyMetrics(this.latencyBuffer),
    }
  }
}

class TimeSeriesAccumulator {
  timestamp: Date
  evaluations = 0
  userIds: Set<string> = new Set()
  latencySum = 0
  errors = 0
  byVariant: Record<string, number> = {}

  constructor(timestamp: Date) {
    this.timestamp = timestamp
  }

  record(exposure: ExposureEvent): void {
    this.evaluations++

    if (exposure.userId) {
      this.userIds.add(exposure.userId)
    }

    this.latencySum += exposure.evaluationLatencyMs

    if (exposure.reason === 'ERROR') {
      this.errors++
    }

    this.byVariant[exposure.variant] = (this.byVariant[exposure.variant] ?? 0) + 1
  }

  toPoint(): TimeSeriesPoint {
    return {
      timestamp: this.timestamp,
      evaluations: this.evaluations,
      uniqueUsers: this.userIds.size,
      avgLatency: this.evaluations > 0 ? this.latencySum / this.evaluations : 0,
      errors: this.errors,
      byVariant: Object.keys(this.byVariant).length > 0 ? { ...this.byVariant } : undefined,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new FlagAnalytics instance
 */
export function createFlagAnalytics(config?: FlagAnalyticsConfig): FlagAnalytics {
  return new FlagAnalytics(config)
}

// =============================================================================
// INTEGRATION HELPERS
// =============================================================================

/**
 * Create an exposure tracking middleware for flag evaluators
 *
 * This can be used to wrap a flag evaluator to automatically track exposures.
 */
export function createExposureTracker(
  analytics: FlagAnalytics,
  options?: {
    includeAttributes?: boolean
    includeMetadata?: boolean
    defaultEnvironment?: string
  }
): <T>(
  flagKey: string,
  userId: string,
  evaluate: () => Promise<{ value: T; variant?: string; reason: ExposureReason; bucket?: number }>,
  context?: {
    anonymousId?: string
    sessionId?: string
    attributes?: Record<string, unknown>
    environment?: string
    metadata?: Record<string, unknown>
  }
) => Promise<{ value: T; variant?: string; reason: ExposureReason; bucket?: number; exposure: ExposureEvent }> {
  return async (flagKey, userId, evaluate, context) => {
    const startTime = performance.now()

    const result = await evaluate()

    const evaluationLatencyMs = performance.now() - startTime

    const exposure = analytics.createExposure(
      flagKey,
      userId,
      result,
      {
        anonymousId: context?.anonymousId,
        sessionId: context?.sessionId,
        attributes: options?.includeAttributes ? context?.attributes : undefined,
        environment: context?.environment ?? options?.defaultEnvironment,
        metadata: options?.includeMetadata ? context?.metadata : undefined,
      },
      evaluationLatencyMs
    )

    return {
      ...result,
      exposure,
    }
  }
}

/**
 * Create a segment analytics destination for exposures
 */
export function createSegmentDestination(options: { writeKey: string; endpoint?: string }): {
  send: (exposures: ExposureEvent[]) => Promise<void>
} {
  return {
    send: async (exposures: ExposureEvent[]) => {
      const events = exposures.map((e) => ({
        type: 'track',
        event: '$experiment_exposure',
        userId: e.userId,
        anonymousId: e.anonymousId,
        properties: {
          flag_key: e.flagKey,
          variant: e.variant,
          value: e.value,
          bucket: e.bucket,
          reason: e.reason,
          evaluation_latency_ms: e.evaluationLatencyMs,
          environment: e.environment,
          ...e.attributes,
        },
        timestamp: e.timestamp.toISOString(),
      }))

      const endpoint = options.endpoint ?? 'https://api.segment.io/v1/batch'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${options.writeKey}:`)}`,
        },
        body: JSON.stringify({ batch: events }),
      })

      if (!response.ok) {
        throw new Error(`Segment request failed: ${response.status} ${response.statusText}`)
      }
    },
  }
}
