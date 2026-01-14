# Pre-Aggregation Storage Strategy

**Issue**: dotdo-60sbd
**Priority**: P0 (Critical)
**Labels**: analytics, derisk, semantic, spike
**Status**: COMPLETE
**Date**: 2026-01-13

## Executive Summary

This spike explores pre-aggregation storage strategies for the dotdo analytics and semantic layer, focusing on achieving low-latency analytics queries in the Durable Objects (DO) context. The recommended approach is a **tiered pre-aggregation system** that leverages DO SQLite for hot aggregates, R2 Parquet/Iceberg for warm/cold aggregates, with query routing through the existing semantic layer.

## Background

### The Problem

Analytics queries over large datasets are inherently expensive. A typical funnel analysis or rollup query might scan millions of rows, taking 500ms-2s even with optimized storage. For dotdo's edge-first architecture, this latency is unacceptable for interactive dashboards and real-time decision-making.

### Current State

dotdo already has several relevant components:

1. **AnalyticsCollector** (`db/primitives/analytics-collector/`) - Segment-compatible event collection with batching
2. **SemanticLayer** (`db/primitives/semantic-layer/`) - Cube-based metrics abstraction with pre-aggregation support
3. **PreAggregationManager** (`db/primitives/semantic-layer/pre-aggregation.ts`) - Rollup definitions, refresh strategies, query routing
4. **Iceberg integration** (`db/iceberg/`) - Direct Iceberg navigation for point lookups (50-150ms)
5. **TieredStorageManager** (`objects/persistence/tiered-storage-manager.ts`) - Hot/warm/cold storage tiers

## Research Findings

### Pre-Aggregation Patterns

#### 1. OLAP Cubes (Multidimensional)

Traditional OLAP cubes pre-compute all possible dimension combinations ("cells").

**Characteristics**:
- Complete pre-computation of all dimension combinations
- Optimal query time (O(1) lookup)
- Storage explosion for high-cardinality dimensions (N^D cells)
- Full refresh required on data changes

**Applicability to dotdo**: Limited. The high-cardinality nature of event properties and the edge deployment model make full cube materialization impractical.

#### 2. Materialized Views / Rollups

Summary tables that pre-aggregate data at specific granularities.

**Characteristics**:
- Targeted pre-computation for known query patterns
- Linear storage growth
- Supports incremental refresh
- Query routing required to use rollups

**Applicability to dotdo**: Strong fit. The existing `PreAggregationManager` implements this pattern.

#### 3. Hybrid Approaches (Cube.js / Druid Style)

Combine raw data storage with strategic rollups, using query-time optimization.

**Characteristics**:
- Store raw events for flexibility
- Build rollups based on query patterns (auto-detection)
- Query router selects optimal source (rollup vs raw)
- Incremental refresh with invalidation

**Applicability to dotdo**: Best fit. Aligns with existing semantic layer architecture.

### Storage Options Analysis

#### Option A: DO SQLite Only

Store pre-aggregates directly in DO's SQLite storage.

**Pros**:
- Lowest latency (<10ms read)
- Transactional consistency with source data
- No additional infrastructure
- Natural fit for hot aggregates

**Cons**:
- 10GB storage limit per DO
- Single-region (no global replication)
- Memory pressure for large aggregates
- No columnar optimization

**Best for**: Hot/recent aggregates, small-medium datasets

#### Option B: R2 Parquet Files

Store pre-aggregates as Parquet files in R2.

**Pros**:
- Unlimited storage capacity
- Columnar format optimized for analytics
- Global edge caching via R2
- Compression reduces storage costs
- Compatible with external tools (DuckDB, Spark)

**Cons**:
- Higher latency (50-200ms)
- No transactional updates (append-only)
- Requires manifest management

**Best for**: Warm/cold aggregates, historical data

#### Option C: R2 Iceberg Tables

Store pre-aggregates in Iceberg format on R2.

**Pros**:
- All Parquet benefits plus versioning
- Time-travel queries (snapshot-based)
- Schema evolution support
- Partition pruning for efficient scans
- Industry standard for data lakes

**Cons**:
- Metadata overhead (manifest chain)
- Higher latency than raw Parquet (metadata reads)
- More complex refresh logic

**Best for**: Large-scale aggregates requiring versioning and partition management

#### Option D: Hybrid Tiered Approach

Combine DO SQLite (hot) + R2 Parquet (warm) + R2 Iceberg (cold).

**Pros**:
- Optimal latency for each access pattern
- Cost-efficient storage (hot data is small)
- Graceful degradation (fallback to source data)
- Leverages existing TieredStorageManager patterns

**Cons**:
- Most complex implementation
- Cache coherence challenges
- Multiple code paths

**Best for**: Production analytics workloads with mixed access patterns

## Existing Code Analysis

### PreAggregationManager

The existing `PreAggregationManager` in `db/primitives/semantic-layer/pre-aggregation.ts` provides:

```typescript
// Rollup definition
interface RollupDefinition {
  name: string
  cubeName: string
  measures: string[]
  dimensions: string[]
  timeDimension?: RollupTimeDimension
  partitionGranularity?: Granularity
  refreshKey?: RollupRefreshKey
  indexes?: Record<string, RollupIndex>
  dependsOn?: string[]
}

// Key classes
- RefreshStrategy: Manages refresh timing (interval-based, SQL-based, incremental)
- StorageBackend: Abstracts storage location (in-db, separate-table, external)
- PartitionConfig: Manages time-based partitions
- RollupMatcher: Matches queries to compatible rollups
- QueryRouter: Routes queries to optimal data source
- InvalidationManager: Handles CDC-based invalidation
- AutoRollupDetector: Suggests rollups from query patterns
```

**Key Gap**: The `StorageBackend` supports `external` type with `parquet | iceberg | delta` but lacks implementation.

### TieredStorageManager

The existing `TieredStorageManager` in `objects/persistence/tiered-storage-manager.ts` provides:

```typescript
// Tiers
type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

// Key features
- Hot tier: In-memory + SQLite
- Warm/Cold tiers: R2 with optional compression
- Automatic promotion/demotion based on access patterns
- Configurable thresholds (hotRetentionMs, hotAccessThreshold)
```

**Key Gap**: Not integrated with semantic layer pre-aggregations.

### IcebergSnapshotWriter

The existing `IcebergSnapshotWriter` in `db/iceberg/snapshot-writer.ts` provides:

```typescript
// Snapshot creation from SQLite
- Queries sqlite_master for user tables
- Exports to Parquet format
- Creates Iceberg v2 manifest
- Supports parent snapshot tracking (time-travel)
```

**Key Gap**: Designed for DO state persistence, not analytics aggregates.

## Proposed Architecture

### Layer 1: Hot Aggregates (DO SQLite)

Store frequently-accessed, recent aggregates in DO SQLite.

```typescript
// Hot aggregate table schema
CREATE TABLE rollup_{cube}_{rollup} (
  partition_key TEXT,           -- Time bucket key
  dimension_values TEXT,        -- JSON encoded dimensions
  measure_values TEXT,          -- JSON encoded measures
  row_count INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (partition_key, dimension_values)
);

// Characteristics
- Time window: Last 24-48 hours
- Granularity: Minute to hour
- Size limit: ~100MB per rollup
- Refresh: On event flush (near real-time)
```

### Layer 2: Warm Aggregates (R2 Parquet)

Store moderately-accessed, recent aggregates as Parquet in R2.

```typescript
// Parquet file organization
/aggregates/{cube}/{rollup}/{partition_date}/data.parquet

// Characteristics
- Time window: Last 30-90 days
- Granularity: Hour to day
- Size limit: None (partitioned)
- Refresh: Scheduled (every 15-60 minutes)
```

### Layer 3: Cold Aggregates (R2 Iceberg)

Store infrequently-accessed, historical aggregates in Iceberg format.

```typescript
// Iceberg table location
/iceberg/aggregates/{cube}_{rollup}/metadata/metadata.json

// Characteristics
- Time window: 90+ days
- Granularity: Day to month
- Size limit: None
- Refresh: Daily batch
- Features: Time-travel, partition pruning
```

### Query Router Enhancement

Extend `QueryRouter` to support tiered storage:

```typescript
class TieredQueryRouter extends QueryRouter {
  async rewriteQuery(query: SemanticQuery): Promise<RewrittenQuery> {
    // 1. Check hot tier (DO SQLite)
    const hotRollup = this.findHotRollup(query);
    if (hotRollup && this.isInHotWindow(query)) {
      return this.rewriteForSQLite(query, hotRollup);
    }

    // 2. Check warm tier (Parquet)
    const warmRollup = this.findWarmRollup(query);
    if (warmRollup && this.isInWarmWindow(query)) {
      return this.rewriteForParquet(query, warmRollup);
    }

    // 3. Check cold tier (Iceberg)
    const coldRollup = this.findColdRollup(query);
    if (coldRollup) {
      return this.rewriteForIceberg(query, coldRollup);
    }

    // 4. Fall back to source data
    return this.rewriteForSource(query);
  }
}
```

### Refresh Strategy

```typescript
// Hot tier: Event-driven refresh
$.on.Analytics.flushed(async ({ events }) => {
  const affected = this.detectAffectedRollups(events);
  for (const rollup of affected) {
    await this.incrementalRefreshHot(rollup, events);
  }
});

// Warm tier: Scheduled refresh
$.every.15.minutes(async () => {
  for (const rollup of this.warmRollups) {
    if (this.needsRefresh(rollup)) {
      await this.refreshWarmRollup(rollup);
    }
  }
});

// Cold tier: Daily batch
$.every.day.at('2am')(async () => {
  for (const rollup of this.coldRollups) {
    await this.compactAndArchive(rollup);
  }
});
```

### Invalidation Strategy

```typescript
class TieredInvalidationManager extends InvalidationManager {
  async notifyDataChange(change: DataChangeNotification) {
    // Hot tier: Immediate invalidation
    await this.invalidateHotTier(change);

    // Warm tier: Partition-level invalidation
    if (this.affectsWarmPartition(change)) {
      await this.markWarmPartitionStale(change);
    }

    // Cold tier: Lazy invalidation (handled in daily batch)
    this.queueColdInvalidation(change);
  }
}
```

## Implementation Phases

### Phase 1: Hot Tier Foundation (1-2 weeks)

1. Extend `StorageBackend` with `createHotTable()` and `insertHotRow()` methods
2. Implement incremental refresh for hot tier (event-driven)
3. Add hot tier query rewriting to `QueryRouter`
4. Unit tests with mock SQLite

### Phase 2: Warm Tier (2-3 weeks)

1. Implement Parquet writer for rollups (adapt `IcebergSnapshotWriter`)
2. Add R2 storage operations for warm tier
3. Implement partition-based refresh for warm tier
4. Add warm tier query rewriting (requires Parquet reader integration)

### Phase 3: Cold Tier (2-3 weeks)

1. Extend Iceberg integration for aggregate tables
2. Implement daily compaction job
3. Add time-travel query support
4. Integrate with existing `IcebergReader` for reads

### Phase 4: Auto-Detection & Optimization (1-2 weeks)

1. Enhance `AutoRollupDetector` with tier recommendations
2. Implement automatic tier migration based on access patterns
3. Add monitoring and alerting for rollup health

## Tradeoffs

### Storage Cost vs Query Latency

| Tier | Storage Cost | Query Latency | Freshness |
|------|--------------|---------------|-----------|
| Hot (SQLite) | High (per-DO) | <10ms | <1 min |
| Warm (Parquet) | Medium | 50-200ms | 15-60 min |
| Cold (Iceberg) | Low | 100-500ms | Daily |

### Complexity vs Flexibility

- **Simple**: Single-tier (SQLite only) - Limited scale, easiest implementation
- **Moderate**: Two-tier (SQLite + Parquet) - Good balance for most use cases
- **Complex**: Three-tier (SQLite + Parquet + Iceberg) - Maximum flexibility, highest complexity

### Consistency vs Performance

- **Strong consistency**: Refresh on every write - Lowest throughput
- **Eventual consistency**: Batched refresh - Better throughput, some staleness
- **Hybrid**: Hot tier near-real-time, others batched - Best balance

## Recommendations

### Short-term (Now)

1. **Implement Hot Tier** using existing DO SQLite infrastructure
2. **Extend StorageBackend** to support hot tier storage
3. **Add simple refresh** on analytics flush (piggyback on existing batching)

### Medium-term (Q1)

1. **Add Warm Tier** using R2 Parquet with existing Parquet infrastructure
2. **Implement QueryRouter** tiering logic
3. **Build scheduled refresh** using existing workflow infrastructure

### Long-term (Q2+)

1. **Evaluate Cold Tier** need based on data volumes
2. **Consider Iceberg** if versioning/time-travel becomes important
3. **Build auto-detection** to reduce manual rollup configuration

## Open Questions

1. **Parquet read path**: How to read Parquet in Workers? Options:
   - parquet-wasm (current approach, limited)
   - DuckDB WASM (feature-complete but large bundle)
   - R2 SQL (simpler but higher latency)

2. **Cross-DO aggregates**: How to aggregate across multiple DOs?
   - Option A: Aggregate DO that receives events from child DOs
   - Option B: R2-based aggregation with worker coordination
   - Option C: External compute (Workflows + R2 SQL)

3. **Schema evolution**: How to handle rollup schema changes?
   - Option A: Version rollups, migrate on read
   - Option B: Rebuild rollups on schema change
   - Option C: Use Iceberg's schema evolution

## Industry Patterns Research

### ClickHouse Pre-Aggregation Patterns

ClickHouse's approach to pre-aggregation offers several patterns applicable to dotdo's edge-first architecture:

#### 1. AggregatingMergeTree Engine

ClickHouse stores **intermediate aggregation states** rather than final values, enabling incremental updates:

```sql
-- ClickHouse pattern
CREATE TABLE daily_metrics
ENGINE = AggregatingMergeTree()
ORDER BY (date, user_segment)
AS SELECT
    toDate(timestamp) as date,
    user_segment,
    uniqState(user_id) as unique_users,      -- Stores HyperLogLog state
    sumState(revenue) as total_revenue,      -- Stores partial sum
    avgState(session_duration) as avg_session -- Stores count + sum
FROM events
GROUP BY date, user_segment
```

**dotdo adaptation**: Store aggregation states in DO SQLite for hot tier:

```typescript
// Proposed state-based aggregation for hot tier
interface AggregateState {
  count: number
  sum: number
  sumSquares: number  // For variance/stddev
  min: number
  max: number
  hll?: Uint8Array    // HyperLogLog for cardinality
}

// Merge states from different partitions/DOs
function mergeStates(states: AggregateState[]): AggregateState {
  return {
    count: states.reduce((a, b) => a + b.count, 0),
    sum: states.reduce((a, b) => a + b.sum, 0),
    sumSquares: states.reduce((a, b) => a + b.sumSquares, 0),
    min: Math.min(...states.map(s => s.min)),
    max: Math.max(...states.map(s => s.max)),
    hll: mergeHLL(states.map(s => s.hll).filter(Boolean)),
  }
}
```

#### 2. State Combinators (*State/*Merge functions)

ClickHouse provides function pairs for incremental aggregation:

| Function | *State variant | *Merge variant |
|----------|---------------|----------------|
| sum | sumState | sumMerge |
| avg | avgState | avgMerge |
| uniq | uniqState | uniqMerge |
| quantile | quantileState | quantileMerge |

**dotdo adaptation**: Implement state combinators in the semantic layer:

```typescript
// State combinator interface for semantic layer
interface StateCombinator<TState, TValue, TResult> {
  // Create initial state from single value
  init(value: TValue): TState
  // Accumulate value into state
  accumulate(state: TState, value: TValue): TState
  // Merge multiple states
  merge(states: TState[]): TState
  // Finalize state to result
  finalize(state: TState): TResult
  // Serialize for storage
  serialize(state: TState): Uint8Array
  deserialize(bytes: Uint8Array): TState
}

// Example: Count distinct using HyperLogLog
const countDistinct: StateCombinator<HLLState, string, number> = {
  init: (v) => HLL.create().add(v),
  accumulate: (s, v) => s.add(v),
  merge: (states) => HLL.merge(states),
  finalize: (s) => s.cardinality(),
  serialize: (s) => s.toBytes(),
  deserialize: (b) => HLL.fromBytes(b),
}
```

#### 3. Incremental vs Refreshable Materialized Views

ClickHouse distinguishes between:

- **Incremental**: New rows immediately update aggregates (LIVE VIEW)
- **Refreshable**: Periodic full or delta refresh (REFRESH MATERIALIZED VIEW)

**dotdo mapping**:

| ClickHouse | dotdo Hot Tier | dotdo Warm/Cold Tier |
|------------|----------------|----------------------|
| Incremental | Event-driven refresh on analytics flush | N/A (too expensive) |
| Refreshable (full) | Hourly rebuild | Daily rebuild |
| Refreshable (delta) | N/A | Partition-level refresh |

### DuckDB WASM Edge Computing Patterns

DuckDB WASM enables SQL analytics directly in the browser/edge worker, relevant for dotdo's edge-first architecture:

#### 1. Client-Side Materialized Views

```typescript
// DuckDB WASM pattern for edge analytics
const db = await DuckDB.create()

// Create materialized view from Parquet on R2
await db.query(`
  CREATE TABLE daily_summary AS
  SELECT
    date_trunc('day', timestamp) as day,
    event_type,
    count(*) as event_count,
    sum(value) as total_value
  FROM read_parquet('r2://bucket/events/*.parquet')
  GROUP BY 1, 2
`)

// Query pre-aggregated data locally
const result = await db.query(`
  SELECT * FROM daily_summary
  WHERE day >= current_date - interval '7 days'
`)
```

**dotdo adaptation**: Use DuckDB for warm tier queries in Workers:

```typescript
// Proposed warm tier query pattern
class WarmTierReader {
  private db: DuckDB

  async queryWarmRollup(rollup: RollupDefinition, query: SemanticQuery) {
    // Load relevant Parquet partitions
    const partitions = this.selectPartitions(rollup, query)

    await this.db.query(`
      CREATE VIEW ${rollup.name} AS
      SELECT * FROM read_parquet([${partitions.map(p => `'${p}'`).join(',')}])
    `)

    // Execute rewritten query against Parquet
    return this.db.query(this.rewriteQuery(query, rollup))
  }
}
```

#### 2. Lazy Materialization

DuckDB's lazy execution model enables "virtual" materialized views:

```typescript
// Views are virtual until accessed
await db.query(`CREATE VIEW user_metrics AS ...`)

// Only materializes when actually queried
// Useful for rarely-accessed rollups
```

**dotdo adaptation**: Lazy rollup materialization for cold tier:

```typescript
// Cold tier lazy materialization
class ColdTierManager {
  async ensureMaterialized(rollup: string, dateRange: DateRange) {
    const status = await this.getStatus(rollup)

    if (status.state === 'virtual') {
      // Materialize on first access
      await this.materialize(rollup, dateRange)
    }
  }
}
```

#### 3. Parquet Predicate Pushdown

DuckDB pushes filters down to Parquet row groups:

```sql
-- Only reads relevant row groups
SELECT * FROM read_parquet('events.parquet')
WHERE date >= '2025-01-01' AND user_segment = 'enterprise'
```

**dotdo adaptation**: Structure Parquet files for optimal pushdown:

```typescript
// Parquet partitioning strategy for warm tier
const parquetConfig = {
  // Row group size optimized for edge
  rowGroupSize: 100_000,  // ~10MB compressed

  // Partition columns for pruning
  partitionBy: ['date', 'user_segment'],

  // Sort within row groups for stats
  sortBy: ['timestamp'],

  // Enable bloom filters for high-cardinality columns
  bloomFilters: ['user_id', 'session_id'],
}
```

### Recommended Pattern Adoption

Based on the research, these patterns should be adopted in priority order:

| Pattern | Source | Priority | Phase |
|---------|--------|----------|-------|
| State combinators | ClickHouse | High | Phase 1 (Hot) |
| Incremental refresh | ClickHouse | High | Phase 1 (Hot) |
| Parquet predicate pushdown | DuckDB | Medium | Phase 2 (Warm) |
| Lazy materialization | DuckDB | Low | Phase 3 (Cold) |
| HyperLogLog states | ClickHouse | Medium | Phase 2 |

## Conclusion and Decision

### Recommended Approach: Option D (Hybrid Tiered)

After analyzing the existing codebase, industry patterns, and dotdo's edge-first requirements, the **Hybrid Tiered Approach** is recommended:

1. **Hot Tier (DO SQLite)**: Near-real-time aggregates with ClickHouse-style state combinators
2. **Warm Tier (R2 Parquet)**: Recent historical aggregates with DuckDB-style predicate pushdown
3. **Cold Tier (R2 Iceberg)**: Long-term aggregates with time-travel capabilities

### Key Implementation Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hot tier storage | DO SQLite tables | Lowest latency (<10ms), transactional with source |
| Warm tier format | Parquet | Columnar, compressed, compatible with DuckDB |
| Cold tier format | Iceberg | Versioning, partition pruning, time-travel |
| Aggregation model | State combinators | Enables incremental updates across tiers |
| Refresh strategy | Event-driven (hot), scheduled (warm/cold) | Balance freshness vs cost |
| Query routing | Automatic via semantic layer | Transparent to application code |

### Next Steps

1. **Create implementation issues** for each phase (see Implementation Phases above)
2. **Implement state combinator interface** in `db/primitives/semantic-layer/`
3. **Extend StorageBackend** with hot tier support
4. **Add TieredQueryRouter** to semantic layer

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Hot tier query latency | <10ms p50 | Benchmark suite |
| Warm tier query latency | <200ms p50 | Benchmark suite |
| Aggregate freshness (hot) | <1 minute | Time from event to queryable |
| Storage efficiency | 10:1 compression | Raw vs aggregated size |

## Related Spikes

- [Cross-DO Join Latency](./cross-do-join-latency.md) - Latency budgets for federated queries across DOs

## References

- [Cube.js Pre-Aggregations](https://cube.dev/docs/caching/pre-aggregations)
- [Apache Druid Rollups](https://druid.apache.org/docs/latest/ingestion/rollup.html)
- [Iceberg Spec v2](https://iceberg.apache.org/spec/)
- [ClickHouse AggregatingMergeTree](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/aggregatingmergetree)
- [ClickHouse Materialized Views](https://clickhouse.com/docs/en/guides/developer/cascading-materialized-views)
- [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview)
- [DuckDB Parquet](https://duckdb.org/docs/data/parquet/overview)
- dotdo Semantic Layer: `db/primitives/semantic-layer/`
- dotdo Iceberg: `db/iceberg/`
- dotdo Tiered Storage: `objects/persistence/tiered-storage-manager.ts`
