/**
 * Cost-Based Source Selection for Federated Queries
 *
 * Implements cost estimation and optimal source selection when data is
 * replicated across multiple sources. Uses both static configuration and
 * historical performance data to make intelligent routing decisions.
 *
 * ## Key Features
 * - Cost estimation per source (I/O, network, compute)
 * - Data locality and freshness consideration
 * - Source capabilities awareness (indexes, pushdown support)
 * - Adaptive selection based on historical performance
 * - Load balancing for similarly-priced sources
 * - Health-aware failover
 *
 * @see dotdo-70jpo
 * @module db/primitives/federated-query/cost-estimator
 */

import type {
  Catalog,
  QueryFragment,
  TableStats,
} from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Cost estimate for a query against a source
 */
export interface CostEstimate {
  /** Total estimated cost (unitless, for comparison) */
  totalCost: number
  /** Cost of scanning data */
  scanCost: number
  /** Cost of network transfer */
  networkCost: number
  /** Estimated rows to be returned */
  estimatedRows: number
  /** Estimated bytes to transfer */
  estimatedBytes: number
  /** Estimated latency in milliseconds */
  latencyMs: number
  /** Estimated scan time in milliseconds */
  scanTimeMs: number
  /** Estimated transfer time in milliseconds */
  transferTimeMs: number
  /** Detailed cost breakdown */
  breakdown?: CostBreakdown
}

/**
 * Detailed cost breakdown for monitoring
 */
export interface CostBreakdown {
  scanCost: number
  networkCost: number
  latencyMs: number
  estimatedDurationMs: number
}

/**
 * Configuration for a source's cost characteristics
 */
export interface SourceCostConfig {
  /** Network latency to source in milliseconds */
  latencyMs?: number
  /** Bandwidth in megabytes per second */
  bandwidthMBps?: number
  /** Whether this source is local (no network cost) */
  isLocal?: boolean
  /** Throughput in rows per second */
  throughputRowsPerSec?: number
  /** Cost multiplier for this source type */
  costMultiplier?: number
}

/**
 * Health status for a source
 */
export interface SourceHealth {
  /** Whether the source is healthy */
  healthy: boolean
  /** Whether the source is degraded (operational but not ideal) */
  degraded?: boolean
  /** Current error rate (0-1) */
  errorRate?: number
  /** Last error message */
  lastError?: string
  /** Timestamp of last error */
  lastErrorTime?: number
  /** Number of consecutive successes */
  consecutiveSuccesses?: number
  /** Number of consecutive failures */
  consecutiveFailures?: number
  /** Average response time in milliseconds */
  avgResponseTimeMs?: number
}

/**
 * Result of source selection
 */
export interface SourceSelectionResult {
  /** Selected source name */
  source: string
  /** Cost estimate for the selected source */
  cost: CostEstimate
  /** Alternative sources ranked by cost */
  alternatives: Array<{
    source: string
    cost: CostEstimate
  }>
}

/**
 * Load balancing configuration
 */
export interface LoadBalancingConfig {
  /** Maximum cost difference ratio to enable load balancing */
  costDifferenceThreshold: number
  /** Whether to use weighted random selection */
  weightedRandom?: boolean
}

/**
 * Performance metrics for a source-table combination
 */
export interface PerformanceMetrics {
  /** Total number of executions */
  totalExecutions: number
  /** Average duration in milliseconds */
  avgDurationMs: number
  /** Success rate (0-1) */
  successRate: number
  /** 50th percentile duration */
  p50DurationMs: number
  /** 95th percentile duration */
  p95DurationMs: number
  /** 99th percentile duration */
  p99DurationMs: number
}

/**
 * Options for retrieving metrics
 */
export interface MetricsOptions {
  /** Weight recent data more heavily */
  recentBias?: boolean
  /** Time window in milliseconds for recent data */
  windowMs?: number
}

/**
 * Performance trend direction
 */
export type TrendDirection = 'improving' | 'stable' | 'degrading'

/**
 * Performance trend analysis
 */
export interface PerformanceTrend {
  /** Trend direction */
  direction: TrendDirection
  /** Percentage change */
  percentChange: number
}

/**
 * Source performance comparison
 */
export interface PerformanceComparison {
  /** Fastest source */
  fastest: string
  /** Sources ranked by performance */
  ranking: string[]
  /** Speedup ratio of fastest vs slowest */
  speedupRatio: number
}

/**
 * Comparison options
 */
export interface ComparisonOptions {
  /** Include reliability in ranking */
  includeReliability?: boolean
}

/**
 * Anomaly detection result
 */
export interface AnomalyResult {
  /** Whether the value is anomalous */
  isAnomaly: boolean
  /** Type of anomaly */
  type?: 'latency_spike' | 'error_spike' | 'throughput_drop'
  /** Number of standard deviations from mean */
  deviationsFromMean?: number
}

/**
 * Execution sample for performance tracking
 */
export interface ExecutionSample {
  /** Duration in milliseconds */
  durationMs: number
  /** Whether execution succeeded */
  success: boolean
  /** Timestamp of execution */
  timestamp: number
  /** Number of rows returned */
  rowsReturned?: number
  /** Bytes transferred */
  bytesTransferred?: number
}

/**
 * Execution record input
 */
export interface ExecutionRecord {
  durationMs: number
  success: boolean
  rowsReturned?: number
  bytesTransferred?: number
}

/**
 * Exported performance data format
 */
export interface ExportedPerformanceData {
  [source: string]: {
    [table: string]: {
      samples: ExecutionSample[]
    }
  }
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

const DEFAULT_SELECTIVITY: Record<string, number> = {
  '=': 0.1,
  '!=': 0.9,
  '>': 0.3,
  '<': 0.3,
  '>=': 0.35,
  '<=': 0.35,
  'LIKE': 0.2,
  'IN': 0.15,
  'NOT IN': 0.85,
}

const DEFAULT_ROW_COUNT = 10000
const DEFAULT_ROW_SIZE_BYTES = 500
const DEFAULT_THROUGHPUT_ROWS_PER_SEC = 500_000
const DEFAULT_LATENCY_MS = 1
const DEFAULT_BANDWIDTH_MBPS = 1000

// =============================================================================
// COST ESTIMATOR
// =============================================================================

/**
 * CostEstimator - Estimates query execution cost for a source
 *
 * Factors in:
 * - Table statistics (row count, size)
 * - Predicate selectivity
 * - Network characteristics (latency, bandwidth)
 * - Source throughput
 * - Historical performance data (optional)
 */
export class CostEstimator {
  private configs = new Map<string, SourceCostConfig>()
  private performanceTracker?: PerformanceTracker
  private useHistoricalData: boolean

  constructor(
    private catalog: Catalog,
    options?: {
      performanceTracker?: PerformanceTracker
      useHistoricalData?: boolean
    }
  ) {
    this.performanceTracker = options?.performanceTracker
    this.useHistoricalData = options?.useHistoricalData ?? false
  }

  /**
   * Configure cost characteristics for a source
   */
  configure(sourceName: string, config: SourceCostConfig): void {
    const existing = this.configs.get(sourceName) ?? {}
    this.configs.set(sourceName, { ...existing, ...config })
  }

  /**
   * Get configuration for a source
   */
  getConfig(sourceName: string): SourceCostConfig | undefined {
    return this.configs.get(sourceName)
  }

  /**
   * Estimate the cost of executing a query against a source
   */
  estimate(sourceName: string, query: QueryFragment): CostEstimate {
    const config = this.configs.get(sourceName) ?? {}
    const stats = this.getTableStats(sourceName, query.table)

    // Calculate estimated rows after applying predicates
    const baseRows = stats.rowCount
    const selectivity = this.calculateSelectivity(query)
    let estimatedRows = Math.max(1, Math.floor(baseRows * selectivity))

    // Apply limit if present
    if (query.limit !== undefined && query.limit < estimatedRows) {
      estimatedRows = query.limit
    }

    // Calculate estimated bytes
    const avgRowSize = stats.sizeBytes / Math.max(1, stats.rowCount)
    const projectionRatio = this.calculateProjectionRatio(query, stats)
    const estimatedBytes = Math.floor(estimatedRows * avgRowSize * projectionRatio)

    // Calculate network cost
    const isLocal = config.isLocal ?? true
    const latencyMs = config.latencyMs ?? DEFAULT_LATENCY_MS
    const bandwidthMBps = config.bandwidthMBps ?? DEFAULT_BANDWIDTH_MBPS

    // Transfer time: bytes / bandwidth
    const transferTimeMs = isLocal
      ? 0
      : (estimatedBytes / (bandwidthMBps * 1024 * 1024)) * 1000

    // Network cost includes latency (always) plus transfer time (if remote)
    // Latency applies even for "local" sources as there's always some overhead
    const networkCost = latencyMs + transferTimeMs

    // Calculate scan cost
    const throughput = config.throughputRowsPerSec ?? DEFAULT_THROUGHPUT_ROWS_PER_SEC
    const scanTimeMs = (estimatedRows / throughput) * 1000
    const scanCost = scanTimeMs

    // Adjust based on historical performance if available
    let adjustedScanCost = scanCost
    if (this.useHistoricalData && this.performanceTracker) {
      const metrics = this.performanceTracker.getMetrics(sourceName, query.table)
      if (metrics.totalExecutions > 0) {
        // Blend estimated and actual performance
        adjustedScanCost = (scanCost + metrics.avgDurationMs) / 2
      }
    }

    // Calculate total cost with optional multiplier
    const costMultiplier = config.costMultiplier ?? 1.0
    const totalCost = (adjustedScanCost + networkCost) * costMultiplier

    return {
      totalCost,
      scanCost: adjustedScanCost,
      networkCost,
      estimatedRows,
      estimatedBytes,
      latencyMs,
      scanTimeMs: adjustedScanCost,
      transferTimeMs,
      breakdown: {
        scanCost: adjustedScanCost,
        networkCost,
        latencyMs,
        estimatedDurationMs: adjustedScanCost + networkCost,
      },
    }
  }

  /**
   * Get table statistics for a source
   */
  private getTableStats(sourceName: string, tableName: string): TableStats {
    const sourceStats = this.catalog.getStatistics(sourceName)
    const tableStats = sourceStats?.tables[tableName]

    if (tableStats) {
      return tableStats
    }

    // Return defaults if no statistics available
    return {
      rowCount: DEFAULT_ROW_COUNT,
      sizeBytes: DEFAULT_ROW_COUNT * DEFAULT_ROW_SIZE_BYTES,
    }
  }

  /**
   * Calculate combined selectivity from predicates
   */
  private calculateSelectivity(query: QueryFragment): number {
    if (!query.predicates || query.predicates.length === 0) {
      return 1.0
    }

    let selectivity = 1.0

    for (const pred of query.predicates) {
      const opSelectivity = DEFAULT_SELECTIVITY[pred.op] ?? 0.5

      // IN operator selectivity depends on number of values
      if (pred.op === 'IN' && Array.isArray(pred.value)) {
        selectivity *= Math.min(opSelectivity * pred.value.length, 0.5)
      } else {
        selectivity *= opSelectivity
      }
    }

    return Math.max(0.001, selectivity)
  }

  /**
   * Calculate projection ratio (fraction of columns selected)
   */
  private calculateProjectionRatio(query: QueryFragment, stats: TableStats): number {
    if (!query.columns || query.columns.length === 0) {
      return 1.0
    }

    // Estimate based on number of columns
    // Assume average table has 10 columns
    const estimatedTotalColumns = stats.distinctCounts
      ? Object.keys(stats.distinctCounts).length
      : 10

    return Math.min(1.0, query.columns.length / estimatedTotalColumns)
  }
}

// =============================================================================
// SOURCE SELECTOR
// =============================================================================

/**
 * SourceSelector - Selects optimal source when data is replicated
 *
 * Considers:
 * - Estimated query cost
 * - Source health status
 * - Load balancing for similar costs
 * - Recent failure history
 */
export class SourceSelector {
  private healthStatus = new Map<string, SourceHealth>()
  private loadBalancingConfig?: LoadBalancingConfig
  private failureCounts = new Map<string, number>()
  private lastSelectionIndex = 0

  constructor(
    private catalog: Catalog,
    private estimator: CostEstimator
  ) {}

  /**
   * Select the optimal source for a query
   */
  selectSource(sources: string[], query: QueryFragment): SourceSelectionResult {
    // Filter to sources that have the table and are healthy
    const availableSources = this.filterAvailableSources(sources, query.table)

    if (availableSources.length === 0) {
      throw new Error(`No available sources for table: ${query.table}`)
    }

    // Estimate cost for each source
    const estimates = availableSources.map((source) => ({
      source,
      cost: this.estimator.estimate(source, query),
    }))

    // Apply health-based cost penalties
    for (const estimate of estimates) {
      const health = this.healthStatus.get(estimate.source)
      if (health?.degraded) {
        // Apply penalty for degraded sources
        const errorPenalty = (health.errorRate ?? 0) * 100
        estimate.cost.totalCost *= (1 + errorPenalty)
      }

      // Apply penalty for recent failures
      const failures = this.failureCounts.get(estimate.source) ?? 0
      if (failures > 0) {
        estimate.cost.totalCost *= (1 + failures * 0.5)
      }
    }

    // Sort by cost
    estimates.sort((a, b) => a.cost.totalCost - b.cost.totalCost)

    // Handle load balancing for similar costs
    let selected = estimates[0]!

    if (this.loadBalancingConfig && estimates.length > 1) {
      const threshold = this.loadBalancingConfig.costDifferenceThreshold
      const lowestCost = selected.cost.totalCost

      // Find sources within threshold
      const similarSources = estimates.filter(
        (e) => (e.cost.totalCost - lowestCost) / lowestCost <= threshold
      )

      if (similarSources.length > 1) {
        // Round-robin among similar sources
        this.lastSelectionIndex = (this.lastSelectionIndex + 1) % similarSources.length
        selected = similarSources[this.lastSelectionIndex]!
      }
    }

    // Build alternatives list
    const alternatives = estimates
      .filter((e) => e.source !== selected.source)
      .map((e) => ({ source: e.source, cost: e.cost }))

    return {
      source: selected.source,
      cost: selected.cost,
      alternatives,
    }
  }

  /**
   * Filter to sources that are available and have the table
   */
  private filterAvailableSources(sources: string[], tableName: string): string[] {
    return sources.filter((source) => {
      // Check health
      const health = this.healthStatus.get(source)
      if (health && !health.healthy) {
        return false
      }

      // Check if source has the table
      const stats = this.catalog.getStatistics(source)
      if (stats) {
        // Source has statistics - only include if it has this table
        return stats.tables[tableName] !== undefined
      }

      // If no stats registered at all, check if the source is even registered
      const sourceEntry = this.catalog.getSource(source)
      return sourceEntry !== undefined
    })
  }

  /**
   * Set health status for a source
   */
  setSourceHealth(sourceName: string, health: SourceHealth): void {
    this.healthStatus.set(sourceName, health)
  }

  /**
   * Get health status for a source
   */
  getSourceHealth(sourceName: string): SourceHealth {
    return this.healthStatus.get(sourceName) ?? {
      healthy: true,
    }
  }

  /**
   * Enable load balancing
   */
  enableLoadBalancing(config: LoadBalancingConfig): void {
    this.loadBalancingConfig = config
  }

  /**
   * Disable load balancing
   */
  disableLoadBalancing(): void {
    this.loadBalancingConfig = undefined
  }

  /**
   * Record a failure for a source
   */
  recordFailure(sourceName: string): void {
    const current = this.failureCounts.get(sourceName) ?? 0
    this.failureCounts.set(sourceName, current + 1)

    // Update health status if we have too many failures
    if (current + 1 >= 3) {
      this.setSourceHealth(sourceName, {
        healthy: false,
        consecutiveFailures: current + 1,
      })
    }
  }

  /**
   * Record a success for a source
   */
  recordSuccess(sourceName: string): void {
    this.failureCounts.set(sourceName, 0)

    const health = this.healthStatus.get(sourceName)
    if (health && !health.healthy) {
      this.setSourceHealth(sourceName, {
        healthy: true,
        consecutiveSuccesses: 1,
      })
    }
  }

  /**
   * Clear failure history
   */
  clearFailures(): void {
    this.failureCounts.clear()
  }
}

// =============================================================================
// PERFORMANCE TRACKER
// =============================================================================

/**
 * PerformanceTracker - Tracks historical query performance
 *
 * Features:
 * - Rolling averages and percentiles
 * - Time-weighted metrics (recent bias)
 * - Trend detection
 * - Anomaly detection
 * - Source comparison
 */
export class PerformanceTracker {
  private samples = new Map<string, Map<string, ExecutionSample[]>>()
  private maxSamplesPerTable = 1000

  /**
   * Record an execution
   */
  recordExecution(
    sourceName: string,
    tableName: string,
    record: ExecutionRecord
  ): void {
    if (!this.samples.has(sourceName)) {
      this.samples.set(sourceName, new Map())
    }

    const sourceSamples = this.samples.get(sourceName)!
    if (!sourceSamples.has(tableName)) {
      sourceSamples.set(tableName, [])
    }

    const tableSamples = sourceSamples.get(tableName)!
    tableSamples.push({
      ...record,
      timestamp: Date.now(),
    })

    // Trim if too many samples
    if (tableSamples.length > this.maxSamplesPerTable) {
      tableSamples.shift()
    }
  }

  /**
   * Get metrics for a source-table combination
   */
  getMetrics(
    sourceName: string,
    tableName: string,
    options?: MetricsOptions
  ): PerformanceMetrics {
    let samples = this.getSamples(sourceName, tableName)

    // Apply time window if specified
    if (options?.windowMs) {
      const cutoff = Date.now() - options.windowMs
      samples = samples.filter((s) => s.timestamp >= cutoff)
    }

    if (samples.length === 0) {
      return {
        totalExecutions: 0,
        avgDurationMs: 0,
        successRate: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
      }
    }

    // Calculate metrics
    const durations = samples.map((s) => s.durationMs)
    const successCount = samples.filter((s) => s.success).length

    let avgDuration: number
    if (options?.recentBias) {
      // Weight recent samples more heavily
      const weights = samples.map((_, i) => Math.pow(2, i / samples.length))
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      avgDuration = samples.reduce(
        (sum, s, i) => sum + s.durationMs * weights[i]!,
        0
      ) / totalWeight
    } else {
      avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
    }

    // Sort for percentiles
    const sortedDurations = [...durations].sort((a, b) => a - b)

    return {
      totalExecutions: samples.length,
      avgDurationMs: avgDuration,
      successRate: successCount / samples.length,
      p50DurationMs: this.percentile(sortedDurations, 0.5),
      p95DurationMs: this.percentile(sortedDurations, 0.95),
      p99DurationMs: this.percentile(sortedDurations, 0.99),
    }
  }

  /**
   * Get raw samples
   */
  private getSamples(sourceName: string, tableName: string): ExecutionSample[] {
    return this.samples.get(sourceName)?.get(tableName) ?? []
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0

    const index = Math.ceil(sorted.length * p) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!
  }

  /**
   * Detect performance trend
   */
  getTrend(sourceName: string, tableName: string): PerformanceTrend {
    const samples = this.getSamples(sourceName, tableName)

    if (samples.length < 4) {
      return { direction: 'stable', percentChange: 0 }
    }

    // Split into first half and second half
    const midpoint = Math.floor(samples.length / 2)
    const firstHalf = samples.slice(0, midpoint)
    const secondHalf = samples.slice(midpoint)

    const firstAvg = firstHalf.reduce((sum, s) => sum + s.durationMs, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.durationMs, 0) / secondHalf.length

    const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100

    // Determine direction based on significant change (>20%)
    let direction: TrendDirection = 'stable'
    if (percentChange > 20) {
      direction = 'degrading'
    } else if (percentChange < -20) {
      direction = 'improving'
    }

    return { direction, percentChange }
  }

  /**
   * Compare performance across sources for a table
   */
  comparePerformance(
    tableName: string,
    sources: string[],
    options?: ComparisonOptions
  ): PerformanceComparison {
    const sourceMetrics = sources.map((source) => ({
      source,
      metrics: this.getMetrics(source, tableName),
    }))

    // Filter to sources with data
    const withData = sourceMetrics.filter((s) => s.metrics.totalExecutions > 0)

    if (withData.length === 0) {
      return {
        fastest: sources[0] ?? '',
        ranking: sources,
        speedupRatio: 1,
      }
    }

    // Calculate effective score
    const scored = withData.map((s) => {
      let score = s.metrics.avgDurationMs

      // Factor in reliability if requested
      if (options?.includeReliability) {
        // Higher error rate = much higher effective latency
        // At 50% error rate, effective latency should be 5x higher
        const errorRate = 1 - s.metrics.successRate
        const reliabilityPenalty = 1 + errorRate * 10
        score *= reliabilityPenalty
      }

      return { source: s.source, score }
    })

    // Sort by score (lower is better)
    scored.sort((a, b) => a.score - b.score)

    const fastest = scored[0]!
    const slowest = scored[scored.length - 1]!
    const speedupRatio = slowest.score / fastest.score

    return {
      fastest: fastest.source,
      ranking: scored.map((s) => s.source),
      speedupRatio,
    }
  }

  /**
   * Detect anomaly for a given value
   */
  detectAnomaly(
    sourceName: string,
    tableName: string,
    value: number
  ): AnomalyResult {
    const samples = this.getSamples(sourceName, tableName)

    if (samples.length < 10) {
      return { isAnomaly: false }
    }

    const durations = samples.map((s) => s.durationMs)
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length
    const stdDev = Math.sqrt(variance)

    const deviationsFromMean = Math.abs(value - mean) / stdDev

    // Consider anomaly if more than 3 standard deviations
    if (deviationsFromMean > 3) {
      return {
        isAnomaly: true,
        type: value > mean ? 'latency_spike' : 'throughput_drop',
        deviationsFromMean,
      }
    }

    return { isAnomaly: false }
  }

  /**
   * Prune old data beyond retention period
   */
  pruneOldData(retentionMs: number): void {
    const cutoff = Date.now() - retentionMs

    for (const [sourceName, sourceSamples] of this.samples) {
      for (const [tableName, tableSamples] of sourceSamples) {
        const filtered = tableSamples.filter((s) => s.timestamp >= cutoff)
        sourceSamples.set(tableName, filtered)
      }
    }
  }

  /**
   * Export performance data
   */
  export(): ExportedPerformanceData {
    const result: ExportedPerformanceData = {}

    for (const [sourceName, sourceSamples] of this.samples) {
      result[sourceName] = {}
      for (const [tableName, samples] of sourceSamples) {
        result[sourceName][tableName] = { samples }
      }
    }

    return result
  }

  /**
   * Import performance data
   */
  import(data: ExportedPerformanceData): void {
    for (const [sourceName, sourceData] of Object.entries(data)) {
      if (!this.samples.has(sourceName)) {
        this.samples.set(sourceName, new Map())
      }

      const sourceSamples = this.samples.get(sourceName)!

      for (const [tableName, tableData] of Object.entries(sourceData)) {
        sourceSamples.set(tableName, tableData.samples)
      }
    }
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.samples.clear()
  }
}

