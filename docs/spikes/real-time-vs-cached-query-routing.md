# Real-time vs Cached Query Routing

**Issue**: dotdo-qy64m
**Priority**: P1
**Labels**: analytics, derisk, semantic, spike
**Status**: COMPLETE
**Date**: 2026-01-13

## Executive Summary

This spike investigates intelligent query routing between real-time and cached data sources in dotdo's semantic layer. The goal is to automatically route queries to the optimal data source based on freshness requirements, query cost estimation, and staleness budgets while maintaining the performance targets of <100ms for cached queries and <2s for real-time queries.

## Background

### The Problem

Analytics workloads have varying freshness requirements:
- **Dashboard widgets**: Can tolerate 1-5 minute staleness for better performance
- **Real-time metrics**: Need sub-second freshness (active users, live revenue)
- **Historical analysis**: Can use day-old pre-aggregations
- **Ad-hoc exploration**: May need exact current data

Without intelligent routing, every query hits the source data, leading to:
1. Unnecessary latency for stale-tolerant queries
2. Wasted compute on redundant aggregations
3. Poor user experience for latency-sensitive dashboards
4. Inconsistent query performance

### Current State

dotdo already has several components that can be leveraged:

1. **QueryCacheLayer** (`db/primitives/query-cache/index.ts`)
   - Multi-tier caching (memory, KV, R2)
   - Query fingerprinting for cache keys
   - TTL-based expiration
   - Event-driven invalidation

2. **SemanticLayer** (`db/primitives/semantic-layer/index.ts`)
   - Cube-based metrics abstraction
   - Pre-aggregation definitions
   - SQL generation from semantic queries

3. **PreAggregationManager** (`db/primitives/semantic-layer/pre-aggregation.ts`)
   - Rollup definitions and matching
   - QueryRouter for rollup selection
   - RefreshStrategy for staleness detection
   - InvalidationManager for CDC-based invalidation

4. **SemanticQueryEngine** (`db/primitives/semantic-layer/query-engine-integration.ts`)
   - Unified query planning
   - Index optimization
   - Query explain/analyze

## Research Findings

### Freshness Requirements Classification

| Query Type | Acceptable Staleness | Examples |
|------------|---------------------|----------|
| Real-time | <1 second | Active users, live transactions |
| Near-real-time | 1-60 seconds | Recent signups, ongoing campaigns |
| Dashboard | 1-5 minutes | KPI widgets, summary charts |
| Analytical | 1-24 hours | Historical trends, cohort analysis |
| Archival | Days to weeks | Year-over-year comparisons |

### Cache Staleness Detection Strategies

#### 1. Time-Based TTL (Current Implementation)

```typescript
// Current approach in QueryCacheLayer
interface CacheEntry {
  expiresAt: number
  createdAt: number
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() >= entry.expiresAt
}
```

**Pros**: Simple, predictable
**Cons**: Not data-aware, may serve stale data after mutations

#### 2. Version-Based Invalidation

```typescript
// Track data version per table/cube
interface VersionedCache {
  dataVersion: number
  queryVersion: number
}

function isStale(entry: VersionedCache, currentVersion: number): boolean {
  return entry.dataVersion < currentVersion
}
```

**Pros**: Accurate invalidation after writes
**Cons**: Requires version tracking infrastructure

#### 3. Change Detection (CDC-Based)

```typescript
// From InvalidationManager
async checkSourceDataChanged(cubeName: string): Promise<boolean> {
  const sql = `SELECT MAX(updated_at) as max_updated FROM ${cubeName}`
  const result = await executor.execute(sql)
  const newKey = String(Object.values(result.data[0])[0])
  return lastKey !== newKey
}
```

**Pros**: Precise invalidation, works with existing CDC
**Cons**: Requires query to detect changes

#### 4. Staleness Budget

```typescript
// New approach: allow queries to specify acceptable staleness
interface StalenessConfig {
  maxStalenessMs: number
  preferFresh: boolean  // Hint for router
}

function withinBudget(entry: CacheEntry, config: StalenessConfig): boolean {
  const age = Date.now() - entry.createdAt
  return age <= config.maxStalenessMs
}
```

**Pros**: Query-aware, flexible
**Cons**: Requires API changes

### Query Cost Estimation

Building on the existing `SemanticQueryEngine.calculateCost()`:

```typescript
// Current cost model
private calculateCost(query: SemanticQuery, estimatedRows: number): number {
  let cost = estimatedRows  // Base scan cost

  // Aggregation cost
  if (query.measures?.length > 0) {
    cost += estimatedRows * 0.1 * query.measures.length
  }

  // Sort cost
  if (query.order?.length > 0) {
    cost += estimatedRows * Math.log2(Math.max(2, estimatedRows)) * 0.1
  }

  // Join cost
  const cubeNames = this.getCubeNames(query)
  if (cubeNames.length > 1) {
    cost *= cubeNames.length
  }

  return Math.max(1, Math.floor(cost))
}
```

### Query Pattern Analysis

The existing `AutoRollupDetector` records query patterns:

```typescript
interface QueryPattern {
  measures: string[]
  dimensions: string[]
  timeDimension?: {
    dimension: string
    granularity: Granularity
  }
  count: number
  averageExecutionTimeMs?: number
}
```

This can be extended for routing decisions:

```typescript
interface RoutingPattern extends QueryPattern {
  cacheHitRate: number
  avgCacheLatencyMs: number
  avgSourceLatencyMs: number
  freshnessRequirement?: 'real-time' | 'near-real-time' | 'dashboard' | 'analytical'
}
```

## Proposed Architecture

### Query Routing Flow

```
SemanticQuery
     |
     v
+----------------+
| FreshnessHint? |---> Extract from query metadata
+----------------+
     |
     v
+------------------+
| Cache Lookup     |---> Check QueryCacheLayer
+------------------+
     |
     +-- HIT + Fresh ---> Return cached result
     |
     +-- HIT + Stale ---> Check staleness budget
     |       |
     |       +-- Within budget ---> Return cached (stale-while-revalidate)
     |       |
     |       +-- Exceeds budget ---> Continue to source selection
     |
     +-- MISS ---> Continue to source selection
     |
     v
+------------------+
| Source Selection |
+------------------+
     |
     +-- Pre-aggregation available + fresh ---> Use rollup
     |
     +-- Pre-aggregation available + stale ---> Check staleness budget
     |       |
     |       +-- Within budget ---> Use rollup (schedule refresh)
     |       |
     |       +-- Exceeds budget ---> Query source
     |
     +-- No pre-aggregation ---> Query source
     |
     v
+------------------+
| Execute Query    |
+------------------+
     |
     v
+------------------+
| Cache Result     |---> Store with metadata
+------------------+
```

### Staleness Budget Interface

```typescript
/**
 * Staleness configuration for query routing
 */
export interface StalenessConfig {
  /** Maximum acceptable staleness in milliseconds */
  maxStalenessMs: number

  /** Freshness requirement category */
  freshnessLevel: 'real-time' | 'near-real-time' | 'dashboard' | 'analytical' | 'archival'

  /** Allow serving stale data while revalidating in background */
  staleWhileRevalidate?: boolean

  /** Force bypass cache and query source directly */
  forceRealTime?: boolean
}

/**
 * Default staleness configurations by level
 */
export const DEFAULT_STALENESS_CONFIGS: Record<StalenessConfig['freshnessLevel'], Omit<StalenessConfig, 'freshnessLevel'>> = {
  'real-time': {
    maxStalenessMs: 0,
    staleWhileRevalidate: false,
    forceRealTime: true,
  },
  'near-real-time': {
    maxStalenessMs: 30_000,     // 30 seconds
    staleWhileRevalidate: true,
  },
  'dashboard': {
    maxStalenessMs: 300_000,   // 5 minutes
    staleWhileRevalidate: true,
  },
  'analytical': {
    maxStalenessMs: 86_400_000, // 24 hours
    staleWhileRevalidate: true,
  },
  'archival': {
    maxStalenessMs: 604_800_000, // 7 days
    staleWhileRevalidate: true,
  },
}
```

### Extended Semantic Query

```typescript
/**
 * Extended semantic query with routing hints
 */
export interface SemanticQueryWithRouting extends SemanticQuery {
  /** Routing configuration */
  routing?: {
    /** Staleness configuration */
    staleness?: Partial<StalenessConfig>

    /** Prefer specific data source */
    preferSource?: 'cache' | 'pre-aggregation' | 'source'

    /** Allow automatic source selection */
    autoRoute?: boolean

    /** Cache the result */
    cacheResult?: boolean

    /** Cache TTL override */
    cacheTTLMs?: number
  }
}
```

### Intelligent Query Router

```typescript
/**
 * QuerySourceRouter - Routes queries to optimal data source
 */
export class QuerySourceRouter {
  private cacheLayer: QueryCacheLayer
  private preAggManager: PreAggregationManager
  private rollupMatcher: RollupMatcher
  private patternAnalyzer: RoutingPatternAnalyzer
  private metrics: RoutingMetrics

  constructor(config: QuerySourceRouterConfig) {
    this.cacheLayer = config.cacheLayer
    this.preAggManager = config.preAggManager
    this.rollupMatcher = new RollupMatcher()
    this.patternAnalyzer = new RoutingPatternAnalyzer()
    this.metrics = new RoutingMetrics()
  }

  /**
   * Route a query to the optimal data source
   */
  async route(
    query: SemanticQueryWithRouting,
    executor: QueryExecutor
  ): Promise<RoutingDecision> {
    const startTime = performance.now()

    // 1. Extract routing configuration
    const staleness = this.getStalenessConfig(query)

    // 2. Force real-time if configured
    if (staleness.forceRealTime) {
      return this.routeToSource(query, executor, 'force-real-time')
    }

    // 3. Check query cache
    const cacheResult = await this.checkCache(query, staleness)
    if (cacheResult.hit && cacheResult.withinBudget) {
      this.metrics.recordCacheHit(query, performance.now() - startTime)
      return {
        source: 'cache',
        result: cacheResult.data,
        metadata: {
          latencyMs: performance.now() - startTime,
          cacheAge: cacheResult.age,
          stale: cacheResult.stale,
        },
      }
    }

    // 4. Start background revalidation if stale-while-revalidate
    if (cacheResult.hit && cacheResult.stale && staleness.staleWhileRevalidate) {
      this.scheduleRevalidation(query, executor)
      return {
        source: 'cache',
        result: cacheResult.data,
        metadata: {
          latencyMs: performance.now() - startTime,
          cacheAge: cacheResult.age,
          stale: true,
          revalidating: true,
        },
      }
    }

    // 5. Check pre-aggregations
    const preAggResult = await this.checkPreAggregation(query, staleness)
    if (preAggResult.available && preAggResult.withinBudget) {
      const result = await this.queryPreAggregation(query, preAggResult.rollup, executor)
      this.metrics.recordPreAggHit(query, performance.now() - startTime)

      // Cache the result
      if (query.routing?.cacheResult !== false) {
        await this.cacheResult(query, result, staleness)
      }

      return {
        source: 'pre-aggregation',
        rollupName: preAggResult.rollup.name,
        result,
        metadata: {
          latencyMs: performance.now() - startTime,
          preAggAge: preAggResult.age,
        },
      }
    }

    // 6. Query source data
    return this.routeToSource(query, executor, 'no-cache-or-preagg')
  }

  private getStalenessConfig(query: SemanticQueryWithRouting): StalenessConfig {
    const level = query.routing?.staleness?.freshnessLevel || 'dashboard'
    const defaults = DEFAULT_STALENESS_CONFIGS[level]

    return {
      freshnessLevel: level,
      ...defaults,
      ...query.routing?.staleness,
    }
  }

  private async checkCache(
    query: SemanticQuery,
    staleness: StalenessConfig
  ): Promise<CacheCheckResult> {
    const fingerprint = fingerprintQuery(
      { sql: JSON.stringify(query), params: [] },
      {}
    )

    const entry = await this.cacheLayer.getEntryStats(
      { sql: JSON.stringify(query), params: [] },
      {}
    )

    if (!entry) {
      return { hit: false, withinBudget: false }
    }

    const age = Date.now() - entry.createdAt
    const stale = age > (staleness.maxStalenessMs * 0.5)  // 50% threshold for "stale"
    const withinBudget = age <= staleness.maxStalenessMs

    return {
      hit: true,
      data: entry.value,
      age,
      stale,
      withinBudget,
    }
  }

  private async checkPreAggregation(
    query: SemanticQuery,
    staleness: StalenessConfig
  ): Promise<PreAggCheckResult> {
    const cubeName = this.extractCubeName(query)
    if (!cubeName) {
      return { available: false, withinBudget: false }
    }

    const rollups = this.preAggManager.getRollupsForCube(cubeName)

    for (const rollup of rollups) {
      if (this.rollupMatcher.queryMatchesRollup(query, rollup)) {
        const status = this.preAggManager.getStatus(cubeName, rollup.name)

        if (status.state === 'built') {
          const age = status.lastRefreshAt
            ? Date.now() - status.lastRefreshAt.getTime()
            : Infinity

          const withinBudget = age <= staleness.maxStalenessMs

          return {
            available: true,
            rollup,
            age,
            withinBudget,
            stale: status.isStale,
          }
        }
      }
    }

    return { available: false, withinBudget: false }
  }

  private async routeToSource(
    query: SemanticQueryWithRouting,
    executor: QueryExecutor,
    reason: string
  ): Promise<RoutingDecision> {
    const startTime = performance.now()

    // Generate SQL and execute
    const sql = this.generateSQL(query)
    const result = await executor.execute(sql)

    const latencyMs = performance.now() - startTime
    this.metrics.recordSourceQuery(query, latencyMs)

    // Cache the result if configured
    const staleness = this.getStalenessConfig(query)
    if (query.routing?.cacheResult !== false) {
      await this.cacheResult(query, result, staleness)
    }

    return {
      source: 'source',
      result,
      metadata: {
        latencyMs,
        reason,
      },
    }
  }

  private scheduleRevalidation(
    query: SemanticQueryWithRouting,
    executor: QueryExecutor
  ): void {
    // Fire-and-forget background refresh
    setImmediate(async () => {
      try {
        await this.routeToSource(query, executor, 'revalidation')
      } catch (error) {
        // Log but don't throw - this is background work
        console.error('Background revalidation failed:', error)
      }
    })
  }

  private extractCubeName(query: SemanticQuery): string | null {
    if (query.measures?.length) {
      return query.measures[0].split('.')[0] || null
    }
    if (query.dimensions?.length) {
      return query.dimensions[0].split('.')[0] || null
    }
    return null
  }
}
```

### Routing Pattern Analyzer

```typescript
/**
 * RoutingPatternAnalyzer - Analyzes query patterns for routing optimization
 */
export class RoutingPatternAnalyzer {
  private patterns: Map<string, RoutingPattern> = new Map()

  /**
   * Record a query execution for pattern analysis
   */
  recordExecution(
    query: SemanticQuery,
    source: 'cache' | 'pre-aggregation' | 'source',
    latencyMs: number
  ): void {
    const key = this.getPatternKey(query)
    const existing = this.patterns.get(key)

    if (existing) {
      existing.count++

      switch (source) {
        case 'cache':
          existing.cacheHitRate =
            (existing.cacheHitRate * (existing.count - 1) + 1) / existing.count
          existing.avgCacheLatencyMs =
            (existing.avgCacheLatencyMs * (existing.count - 1) + latencyMs) / existing.count
          break
        case 'source':
          existing.cacheHitRate =
            (existing.cacheHitRate * (existing.count - 1)) / existing.count
          existing.avgSourceLatencyMs =
            ((existing.avgSourceLatencyMs || 0) * (existing.count - 1) + latencyMs) / existing.count
          break
      }
    } else {
      this.patterns.set(key, {
        measures: query.measures || [],
        dimensions: query.dimensions || [],
        count: 1,
        cacheHitRate: source === 'cache' ? 1 : 0,
        avgCacheLatencyMs: source === 'cache' ? latencyMs : 0,
        avgSourceLatencyMs: source === 'source' ? latencyMs : 0,
      })
    }
  }

  /**
   * Get recommended freshness level based on query patterns
   */
  recommendFreshnessLevel(query: SemanticQuery): StalenessConfig['freshnessLevel'] {
    const key = this.getPatternKey(query)
    const pattern = this.patterns.get(key)

    if (!pattern) {
      return 'dashboard'  // Default
    }

    // High cache hit rate suggests dashboard-level freshness is acceptable
    if (pattern.cacheHitRate > 0.8) {
      return 'analytical'
    }

    // Low cache hit rate with high source latency suggests near-real-time need
    if (pattern.cacheHitRate < 0.2 && (pattern.avgSourceLatencyMs || 0) < 100) {
      return 'near-real-time'
    }

    return 'dashboard'
  }

  /**
   * Get patterns that would benefit from pre-aggregation
   */
  getPreAggregationCandidates(): RoutingPattern[] {
    return Array.from(this.patterns.values())
      .filter(p =>
        p.count >= 10 &&
        p.cacheHitRate < 0.5 &&
        (p.avgSourceLatencyMs || 0) > 500
      )
      .sort((a, b) => b.count - a.count)
  }

  private getPatternKey(query: SemanticQuery): string {
    const measures = [...(query.measures || [])].sort().join(',')
    const dimensions = [...(query.dimensions || [])].sort().join(',')
    return `${measures}|${dimensions}`
  }
}
```

### Configuration Schema

```typescript
/**
 * Query routing configuration
 */
export interface QueryRoutingConfig {
  /** Default staleness level for queries without explicit config */
  defaultFreshnessLevel: StalenessConfig['freshnessLevel']

  /** Override staleness by query pattern (regex on stringified query) */
  patternOverrides?: Array<{
    pattern: string | RegExp
    freshnessLevel: StalenessConfig['freshnessLevel']
  }>

  /** Enable automatic routing based on pattern analysis */
  autoRouting: boolean

  /** Minimum cache entries before enabling auto-routing */
  autoRoutingThreshold: number

  /** Enable stale-while-revalidate globally */
  staleWhileRevalidate: boolean

  /** Maximum concurrent background revalidations */
  maxConcurrentRevalidations: number

  /** Metrics collection interval */
  metricsIntervalMs: number
}

export const DEFAULT_ROUTING_CONFIG: QueryRoutingConfig = {
  defaultFreshnessLevel: 'dashboard',
  autoRouting: true,
  autoRoutingThreshold: 100,
  staleWhileRevalidate: true,
  maxConcurrentRevalidations: 5,
  metricsIntervalMs: 60_000,
}
```

## Implementation Approach

### Phase 1: Staleness Budget Foundation (Immediate)

1. **Add staleness configuration to SemanticQuery**
   - Extend `SemanticQuery` interface with `routing` field
   - Implement `DEFAULT_STALENESS_CONFIGS`
   - Add staleness extraction in `QueryRouter`

2. **Extend QueryCacheLayer**
   - Add `getEntryStats()` method for age checking
   - Implement staleness budget checking in `get()`
   - Add `staleWhileRevalidate` support

3. **Unit tests**
   - Test staleness budget calculation
   - Test cache hit with various freshness levels
   - Test stale-while-revalidate behavior

### Phase 2: Intelligent Router Integration (Week 1)

1. **Implement QuerySourceRouter**
   - Integrate with existing `QueryCacheLayer`
   - Integrate with existing `PreAggregationManager`
   - Implement routing decision logic

2. **Add pattern analysis**
   - Extend `AutoRollupDetector` with routing patterns
   - Implement `recommendFreshnessLevel()`
   - Add metrics collection

3. **Integration with SemanticQueryEngine**
   - Add routing as first step in `execute()`
   - Preserve existing explain/analyze functionality

### Phase 3: Configuration and Monitoring (Week 2)

1. **Configuration system**
   - Pattern-based overrides
   - Per-tenant routing configuration
   - Runtime configuration updates

2. **Monitoring dashboard**
   - Cache hit rates by freshness level
   - Latency distribution by source
   - Staleness budget utilization

3. **Auto-optimization**
   - Automatic freshness level adjustment
   - Pre-aggregation candidate detection
   - Alert on high cache miss rates

## Tradeoffs

### Simplicity vs Accuracy

| Approach | Implementation Complexity | Accuracy | Latency Overhead |
|----------|---------------------------|----------|------------------|
| Time-based TTL only | Low | Medium | None |
| Staleness budget | Medium | High | <1ms |
| Version-based | High | Highest | 5-10ms (version check) |
| CDC-based | High | Highest | 10-50ms (CDC query) |

**Recommendation**: Start with staleness budget (Phase 1), add version-based for critical queries.

### Cache Hit Rate vs Data Freshness

| Freshness Level | Expected Cache Hit Rate | Max Staleness |
|-----------------|-------------------------|---------------|
| Real-time | 0% | 0 |
| Near-real-time | 10-30% | 30s |
| Dashboard | 60-80% | 5m |
| Analytical | 90%+ | 24h |

### Memory vs Latency

| Configuration | Memory Usage | Cache Latency | Source Latency Reduction |
|---------------|--------------|---------------|--------------------------|
| Aggressive caching | High | <5ms | 80-95% |
| Moderate caching | Medium | <10ms | 50-70% |
| Conservative caching | Low | <20ms | 20-40% |

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Cached query latency | <100ms p50 | Response time for cache hits |
| Real-time query latency | <2s p95 | Response time for source queries |
| Cache hit rate (dashboard) | >70% | Hits / total queries |
| Staleness budget violations | <1% | Queries exceeding budget |
| Auto-routing accuracy | >90% | Correct routing decisions |

## Open Questions

1. **Multi-tenant routing policies**: Should each tenant have its own freshness configuration, or should it be query-pattern based?
   - Recommendation: Per-tenant defaults with query-level overrides

2. **Cross-DO cache coherence**: How do we handle cache invalidation across multiple DOs serving the same cube?
   - Options:
     - A) Broadcast invalidation via DO namespace
     - B) Shared cache in KV/R2
     - C) Short TTLs for hot data

3. **Pre-aggregation refresh scheduling**: Should routing trigger pre-aggregation refresh, or should it be separate?
   - Recommendation: Separate - routing should be read-only for predictable latency

4. **WebSocket real-time updates**: How does routing interact with WebSocket-based real-time subscriptions?
   - Need to investigate integration with existing WebSocket infrastructure

## Related Work

- [Pre-Aggregation Storage Strategy](./pre-aggregation-storage.md) - Tiered storage for pre-aggregations
- [Multi-Tenant Semantic Isolation](./multi-tenant-semantic-isolation.md) - Tenant isolation patterns
- SemanticLayer: `db/primitives/semantic-layer/index.ts`
- QueryCacheLayer: `db/primitives/query-cache/index.ts`
- PreAggregationManager: `db/primitives/semantic-layer/pre-aggregation.ts`

## Conclusion

The proposed staleness budget approach provides a flexible, query-aware routing system that can deliver:

1. **<100ms latency** for cached/pre-aggregated queries with acceptable staleness
2. **<2s latency** for real-time queries against source data
3. **Automatic optimization** based on query patterns
4. **Configuration flexibility** for different use cases

The phased implementation allows immediate value from staleness budgets while building toward a fully intelligent routing system.

## Next Steps

1. Create implementation issues for each phase
2. Implement `StalenessConfig` interface in semantic layer
3. Extend `QueryCacheLayer` with staleness budget checking
4. Add routing hints to `SemanticQuery` type
5. Integrate `QuerySourceRouter` with `SemanticQueryEngine`
