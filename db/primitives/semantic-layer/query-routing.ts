/**
 * Query Routing - Intelligent routing between real-time and cached data sources
 *
 * Routes queries based on:
 * - Query freshness requirements (staleness budget)
 * - Cache availability and age
 * - Pre-aggregation availability
 * - Query cost estimation
 * - Historical query patterns
 *
 * @see dotdo-qy64m
 */

import type { SemanticQuery, QueryResult, QueryExecutor } from './index'
import type { RollupDefinition } from './pre-aggregation'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Freshness level for query routing
 */
export type FreshnessLevel =
  | 'real-time'      // <1 second staleness, bypass cache
  | 'near-real-time' // 1-60 second staleness
  | 'dashboard'      // 1-5 minute staleness (default)
  | 'analytical'     // 1-24 hour staleness
  | 'archival'       // Days to weeks staleness

/**
 * Staleness configuration for query routing
 */
export interface StalenessConfig {
  /** Maximum acceptable staleness in milliseconds */
  maxStalenessMs: number

  /** Freshness requirement category */
  freshnessLevel: FreshnessLevel

  /** Allow serving stale data while revalidating in background */
  staleWhileRevalidate: boolean

  /** Force bypass cache and query source directly */
  forceRealTime: boolean
}

/**
 * Default staleness configurations by freshness level
 */
export const DEFAULT_STALENESS_CONFIGS: Record<FreshnessLevel, Omit<StalenessConfig, 'freshnessLevel'>> = {
  'real-time': {
    maxStalenessMs: 0,
    staleWhileRevalidate: false,
    forceRealTime: true,
  },
  'near-real-time': {
    maxStalenessMs: 30_000,     // 30 seconds
    staleWhileRevalidate: true,
    forceRealTime: false,
  },
  'dashboard': {
    maxStalenessMs: 300_000,   // 5 minutes
    staleWhileRevalidate: true,
    forceRealTime: false,
  },
  'analytical': {
    maxStalenessMs: 86_400_000, // 24 hours
    staleWhileRevalidate: true,
    forceRealTime: false,
  },
  'archival': {
    maxStalenessMs: 604_800_000, // 7 days
    staleWhileRevalidate: true,
    forceRealTime: false,
  },
}

/**
 * Routing hints for semantic queries
 */
export interface QueryRoutingHints {
  /** Staleness configuration */
  staleness?: Partial<StalenessConfig>

  /** Preferred data source */
  preferSource?: 'cache' | 'pre-aggregation' | 'source'

  /** Allow automatic source selection */
  autoRoute?: boolean

  /** Cache the result after querying */
  cacheResult?: boolean

  /** Override default cache TTL */
  cacheTTLMs?: number
}

/**
 * Extended semantic query with routing hints
 */
export interface SemanticQueryWithRouting extends SemanticQuery {
  /** Routing configuration */
  routing?: QueryRoutingHints
}

/**
 * Data source type for routing decisions
 */
export type DataSource = 'cache' | 'pre-aggregation' | 'source'

/**
 * Routing decision result
 */
export interface RoutingDecision {
  /** Selected data source */
  source: DataSource

  /** Query result data */
  result: QueryResult

  /** Name of rollup used (if pre-aggregation) */
  rollupName?: string

  /** Routing metadata */
  metadata: RoutingMetadata
}

/**
 * Routing metadata
 */
export interface RoutingMetadata {
  /** Total latency in milliseconds */
  latencyMs: number

  /** Cache entry age (if cache hit) */
  cacheAge?: number

  /** Whether cache entry was stale */
  stale?: boolean

  /** Whether background revalidation was triggered */
  revalidating?: boolean

  /** Pre-aggregation age (if pre-agg used) */
  preAggAge?: number

  /** Reason for routing decision */
  reason?: string
}

/**
 * Cache check result
 */
export interface CacheCheckResult {
  /** Whether cache entry was found */
  hit: boolean

  /** Cached data (if hit) */
  data?: unknown

  /** Age of cache entry in milliseconds */
  age?: number

  /** Whether entry is considered stale */
  stale?: boolean

  /** Whether entry is within staleness budget */
  withinBudget: boolean
}

/**
 * Pre-aggregation check result
 */
export interface PreAggCheckResult {
  /** Whether a matching pre-aggregation is available */
  available: boolean

  /** Matching rollup definition */
  rollup?: RollupDefinition

  /** Age of pre-aggregation data */
  age?: number

  /** Whether pre-agg is within staleness budget */
  withinBudget: boolean

  /** Whether pre-agg is marked as stale */
  stale?: boolean
}

/**
 * Routing pattern for analysis
 */
export interface RoutingPattern {
  /** Measures in the query */
  measures: string[]

  /** Dimensions in the query */
  dimensions: string[]

  /** Time dimension configuration */
  timeDimension?: {
    dimension: string
    granularity: string
  }

  /** Number of times this pattern was seen */
  count: number

  /** Cache hit rate for this pattern (0-1) */
  cacheHitRate: number

  /** Average latency for cache hits */
  avgCacheLatencyMs: number

  /** Average latency for source queries */
  avgSourceLatencyMs: number

  /** Inferred freshness requirement */
  inferredFreshnessLevel?: FreshnessLevel
}

/**
 * Routing metrics
 */
export interface RoutingMetrics {
  /** Total queries routed */
  totalQueries: number

  /** Queries served from cache */
  cacheHits: number

  /** Queries served from pre-aggregations */
  preAggHits: number

  /** Queries served from source */
  sourceQueries: number

  /** Average latency by source */
  avgLatencyBySource: Record<DataSource, number>

  /** Staleness budget violations */
  budgetViolations: number

  /** Background revalidations triggered */
  revalidations: number
}

/**
 * Query routing configuration
 */
export interface QueryRoutingConfig {
  /** Default freshness level for queries without explicit config */
  defaultFreshnessLevel: FreshnessLevel

  /** Override staleness by query pattern */
  patternOverrides?: Array<{
    pattern: string | RegExp
    freshnessLevel: FreshnessLevel
  }>

  /** Enable automatic routing based on pattern analysis */
  autoRouting: boolean

  /** Minimum pattern observations before enabling auto-routing */
  autoRoutingThreshold: number

  /** Enable stale-while-revalidate globally */
  staleWhileRevalidate: boolean

  /** Maximum concurrent background revalidations */
  maxConcurrentRevalidations: number
}

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: QueryRoutingConfig = {
  defaultFreshnessLevel: 'dashboard',
  autoRouting: true,
  autoRoutingThreshold: 100,
  staleWhileRevalidate: true,
  maxConcurrentRevalidations: 5,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get staleness configuration for a query
 */
export function getStalenessConfig(
  query: SemanticQueryWithRouting,
  config: QueryRoutingConfig = DEFAULT_ROUTING_CONFIG
): StalenessConfig {
  // Check for explicit staleness configuration
  const explicit = query.routing?.staleness

  // Determine freshness level
  const level = explicit?.freshnessLevel || config.defaultFreshnessLevel

  // Get defaults for this level
  const defaults = DEFAULT_STALENESS_CONFIGS[level]

  // Merge explicit overrides
  return {
    freshnessLevel: level,
    maxStalenessMs: explicit?.maxStalenessMs ?? defaults.maxStalenessMs,
    staleWhileRevalidate:
      explicit?.staleWhileRevalidate ?? defaults.staleWhileRevalidate ?? config.staleWhileRevalidate,
    forceRealTime: explicit?.forceRealTime ?? defaults.forceRealTime,
  }
}

/**
 * Check if data age is within staleness budget
 */
export function isWithinBudget(ageMs: number, staleness: StalenessConfig): boolean {
  if (staleness.forceRealTime) {
    return false
  }
  return ageMs <= staleness.maxStalenessMs
}

/**
 * Check if data is considered stale (beyond 50% of budget)
 */
export function isStale(ageMs: number, staleness: StalenessConfig): boolean {
  if (staleness.forceRealTime) {
    return true
  }
  // Consider stale at 50% of budget to trigger proactive refresh
  return ageMs > (staleness.maxStalenessMs * 0.5)
}

/**
 * Get pattern key for a query
 */
export function getQueryPatternKey(query: SemanticQuery): string {
  const measures = [...(query.measures || [])].sort().join(',')
  const dimensions = [...(query.dimensions || [])].sort().join(',')
  const timeDim = query.timeDimensions?.[0]
  const timeKey = timeDim ? `${timeDim.dimension}:${timeDim.granularity || 'none'}` : ''

  return `${measures}|${dimensions}|${timeKey}`
}

/**
 * Extract cube name from a semantic query
 */
export function extractCubeName(query: SemanticQuery): string | null {
  if (query.measures?.length) {
    const parts = query.measures[0].split('.')
    return parts[0] || null
  }
  if (query.dimensions?.length) {
    const parts = query.dimensions[0].split('.')
    return parts[0] || null
  }
  if (query.timeDimensions?.length) {
    const parts = query.timeDimensions[0].dimension.split('.')
    return parts[0] || null
  }
  return null
}

// =============================================================================
// ROUTING PATTERN ANALYZER
// =============================================================================

/**
 * RoutingPatternAnalyzer - Analyzes query patterns for routing optimization
 */
export class RoutingPatternAnalyzer {
  private patterns: Map<string, RoutingPattern> = new Map()
  private config: QueryRoutingConfig

  constructor(config: QueryRoutingConfig = DEFAULT_ROUTING_CONFIG) {
    this.config = config
  }

  /**
   * Record a query execution for pattern analysis
   */
  recordExecution(
    query: SemanticQuery,
    source: DataSource,
    latencyMs: number
  ): void {
    const key = getQueryPatternKey(query)
    const existing = this.patterns.get(key)

    if (existing) {
      existing.count++

      // Update rolling averages
      const prevCount = existing.count - 1

      if (source === 'cache') {
        existing.cacheHitRate = (existing.cacheHitRate * prevCount + 1) / existing.count
        existing.avgCacheLatencyMs =
          (existing.avgCacheLatencyMs * prevCount + latencyMs) / existing.count
      } else {
        existing.cacheHitRate = (existing.cacheHitRate * prevCount) / existing.count
        if (source === 'source') {
          existing.avgSourceLatencyMs =
            (existing.avgSourceLatencyMs * prevCount + latencyMs) / existing.count
        }
      }

      // Update inferred freshness level
      existing.inferredFreshnessLevel = this.inferFreshnessLevel(existing)
    } else {
      const newPattern: RoutingPattern = {
        measures: (query.measures || []).map(m =>
          m.includes('.') ? m.split('.')[1]! : m
        ),
        dimensions: (query.dimensions || []).map(d =>
          d.includes('.') ? d.split('.')[1]! : d
        ),
        count: 1,
        cacheHitRate: source === 'cache' ? 1 : 0,
        avgCacheLatencyMs: source === 'cache' ? latencyMs : 0,
        avgSourceLatencyMs: source === 'source' ? latencyMs : 0,
      }

      if (query.timeDimensions?.length) {
        const td = query.timeDimensions[0]
        newPattern.timeDimension = {
          dimension: td.dimension.includes('.') ? td.dimension.split('.')[1]! : td.dimension,
          granularity: td.granularity || 'none',
        }
      }

      this.patterns.set(key, newPattern)
    }
  }

  /**
   * Get all recorded patterns
   */
  getPatterns(): RoutingPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Get patterns with sufficient observations for auto-routing
   */
  getQualifiedPatterns(): RoutingPattern[] {
    return this.getPatterns()
      .filter(p => p.count >= this.config.autoRoutingThreshold)
  }

  /**
   * Get recommended freshness level for a query
   */
  recommendFreshnessLevel(query: SemanticQuery): FreshnessLevel {
    const key = getQueryPatternKey(query)
    const pattern = this.patterns.get(key)

    // Not enough data - use default
    if (!pattern || pattern.count < this.config.autoRoutingThreshold) {
      return this.config.defaultFreshnessLevel
    }

    return pattern.inferredFreshnessLevel || this.inferFreshnessLevel(pattern)
  }

  /**
   * Infer freshness level from pattern statistics
   */
  private inferFreshnessLevel(pattern: RoutingPattern): FreshnessLevel {
    // High cache hit rate suggests stale-tolerant queries
    if (pattern.cacheHitRate > 0.9) {
      return 'archival'
    }
    if (pattern.cacheHitRate > 0.7) {
      return 'analytical'
    }

    // Low cache hit with fast source suggests real-time need
    if (pattern.cacheHitRate < 0.2 && pattern.avgSourceLatencyMs < 50) {
      return 'near-real-time'
    }

    // Check for time dimension patterns
    if (pattern.timeDimension) {
      const granularity = pattern.timeDimension.granularity
      if (granularity === 'minute' || granularity === 'second') {
        return 'near-real-time'
      }
      if (granularity === 'day' || granularity === 'week') {
        return 'analytical'
      }
    }

    return 'dashboard'
  }

  /**
   * Get patterns that would benefit from pre-aggregation
   */
  getPreAggregationCandidates(minCount = 10): RoutingPattern[] {
    return this.getPatterns()
      .filter(p =>
        p.count >= minCount &&
        p.cacheHitRate < 0.5 &&
        p.avgSourceLatencyMs > 500
      )
  }

  /**
   * Clear all recorded patterns
   */
  clear(): void {
    this.patterns.clear()
  }
}

// =============================================================================
// ROUTING METRICS COLLECTOR
// =============================================================================

/**
 * RoutingMetricsCollector - Collects routing metrics
 */
export class RoutingMetricsCollector {
  private metrics: RoutingMetrics = {
    totalQueries: 0,
    cacheHits: 0,
    preAggHits: 0,
    sourceQueries: 0,
    avgLatencyBySource: {
      cache: 0,
      'pre-aggregation': 0,
      source: 0,
    },
    budgetViolations: 0,
    revalidations: 0,
  }

  private latencySamples: Record<DataSource, number[]> = {
    cache: [],
    'pre-aggregation': [],
    source: [],
  }

  private maxSamples = 1000

  /**
   * Record a cache hit
   */
  recordCacheHit(latencyMs: number): void {
    this.metrics.totalQueries++
    this.metrics.cacheHits++
    this.recordLatency('cache', latencyMs)
  }

  /**
   * Record a pre-aggregation hit
   */
  recordPreAggHit(latencyMs: number): void {
    this.metrics.totalQueries++
    this.metrics.preAggHits++
    this.recordLatency('pre-aggregation', latencyMs)
  }

  /**
   * Record a source query
   */
  recordSourceQuery(latencyMs: number): void {
    this.metrics.totalQueries++
    this.metrics.sourceQueries++
    this.recordLatency('source', latencyMs)
  }

  /**
   * Record a staleness budget violation
   */
  recordBudgetViolation(): void {
    this.metrics.budgetViolations++
  }

  /**
   * Record a background revalidation
   */
  recordRevalidation(): void {
    this.metrics.revalidations++
  }

  /**
   * Get current metrics
   */
  getMetrics(): RoutingMetrics {
    return { ...this.metrics }
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    if (this.metrics.totalQueries === 0) return 0
    return this.metrics.cacheHits / this.metrics.totalQueries
  }

  /**
   * Get pre-aggregation hit rate
   */
  getPreAggHitRate(): number {
    if (this.metrics.totalQueries === 0) return 0
    return this.metrics.preAggHits / this.metrics.totalQueries
  }

  /**
   * Get source query rate
   */
  getSourceQueryRate(): number {
    if (this.metrics.totalQueries === 0) return 0
    return this.metrics.sourceQueries / this.metrics.totalQueries
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = {
      totalQueries: 0,
      cacheHits: 0,
      preAggHits: 0,
      sourceQueries: 0,
      avgLatencyBySource: {
        cache: 0,
        'pre-aggregation': 0,
        source: 0,
      },
      budgetViolations: 0,
      revalidations: 0,
    }
    this.latencySamples = {
      cache: [],
      'pre-aggregation': [],
      source: [],
    }
  }

  private recordLatency(source: DataSource, latencyMs: number): void {
    const samples = this.latencySamples[source]
    samples.push(latencyMs)

    // Limit sample size
    if (samples.length > this.maxSamples) {
      samples.shift()
    }

    // Update average
    this.metrics.avgLatencyBySource[source] =
      samples.reduce((a, b) => a + b, 0) / samples.length
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  // Re-export types that are needed externally
  type QueryResult,
  type QueryExecutor,
  type SemanticQuery,
}
