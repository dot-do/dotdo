# Cost Estimation Without Table Statistics

**Spike:** `dotdo-ymh9w`
**Date:** 2026-01-13
**Status:** Complete

## Problem Statement

Traditional query optimizers rely on ANALYZE-collected statistics (row counts, distinct counts, histograms) to estimate query costs. In our stateless DO + Iceberg architecture:

1. **No persistent ANALYZE:** DOs are stateless; we cannot maintain statistics tables
2. **Statistics staleness:** Even with statistics, data changes between queries
3. **Cross-DO queries:** Federation requires statistics from multiple sources
4. **Edge constraints:** Limited memory for histogram storage

## Success Criteria

> Estimates within 10x of actual for 90% of queries

This is a realistic target for statisticless estimation. Traditional optimizers with full statistics achieve 2-5x accuracy.

## Research Findings

### 1. The Statistics Challenge

Our current `QueryPlanner` (`db/primitives/query-engine/planner/query-planner.ts`) uses hardcoded defaults:

```typescript
// From getTableStatistics() - line 147
const defaultStats: TableStatistics = {
  rowCount: 1000,  // Magic number
  distinctCounts: new Map([
    ['id', 1000],
    ['email', 950],
    ['status', 5],
    ['category', 20],
  ]),
  // ...
}
```

This leads to estimation errors when:
- Tables are empty or have millions of rows
- Column distributions differ from defaults
- Filters have different selectivity than assumed

### 2. Heuristic-Based Approaches

#### 2.1 Magic Numbers (Current Approach)

```typescript
// Common selectivity heuristics (PostgreSQL-style)
const SELECTIVITY = {
  EQUALITY: 0.1,        // col = 'value'
  INEQUALITY: 0.9,      // col != 'value'
  RANGE: 0.33,          // col > 10
  LIKE_PREFIX: 0.25,    // col LIKE 'foo%'
  LIKE_FULL: 0.1,       // col LIKE '%foo%'
  IN_LIST: 0.1 * n,     // col IN (...)
  IS_NULL: 0.1,         // col IS NULL
  BETWEEN: 0.25,        // col BETWEEN a AND b
}
```

**Problems:**
- Completely wrong for skewed data (e.g., 99% of orders are "pending")
- No adaptation to actual data

#### 2.2 Query Feedback Loop

Idea: Track actual vs estimated cardinalities and adjust heuristics over time.

```typescript
interface CostFeedback {
  queryHash: string
  estimatedRows: number
  actualRows: number
  executionTimeMs: number
  timestamp: Date
}

class AdaptiveEstimator {
  private history: Map<string, CostFeedback[]> = new Map()

  estimate(query: Query, table: string): number {
    const baseEstimate = this.heuristicEstimate(query)
    const feedback = this.history.get(this.hashQuery(query))

    if (feedback && feedback.length > 5) {
      // Calculate correction factor from recent executions
      const avgRatio = feedback
        .slice(-10)
        .reduce((sum, f) => sum + f.actualRows / f.estimatedRows, 0) / 10
      return baseEstimate * avgRatio
    }
    return baseEstimate
  }

  recordFeedback(query: Query, actual: number, estimated: number) {
    // Store for future queries
  }
}
```

**Pros:**
- Self-correcting over time
- No upfront statistics collection needed
- Works well for repeated queries

**Cons:**
- Cold start problem for new queries
- Memory overhead for feedback storage
- Query variability (different parameters)

### 3. Sampling Strategies

#### 3.1 Runtime Sampling

Sample data at query time to estimate selectivity:

```typescript
async function sampleEstimate(
  table: TypedColumnStore,
  predicate: Predicate,
  sampleSize: number = 1000
): Promise<number> {
  // Get random sample
  const sample = await table.randomSample(sampleSize)

  // Apply predicate to sample
  const matching = sample.filter(row => evaluatePredicate(row, predicate))

  // Extrapolate to full table
  const selectivity = matching.length / sampleSize
  const totalRows = await table.approximateRowCount()

  return Math.ceil(totalRows * selectivity)
}
```

**Sample size tradeoffs:**

| Sample Size | Accuracy (95% CI) | Latency | Use Case |
|-------------|-------------------|---------|----------|
| 100 | +/- 20% | <1ms | Quick estimates |
| 1,000 | +/- 6% | ~5ms | Default |
| 10,000 | +/- 2% | ~50ms | Critical queries |

**Bernstein bound:** To achieve error rate `e` with confidence `1-d`:
```
n = (1/2e^2) * ln(2/d)
```
For 10% error with 95% confidence: n = 385 samples

#### 3.2 Stratified Sampling for Joins

For join cardinality, sample both sides and compute join:

```typescript
async function estimateJoinCardinality(
  left: TypedColumnStore,
  right: TypedColumnStore,
  joinKey: { left: string, right: string },
  sampleSize: number = 1000
): Promise<number> {
  const leftSample = await left.randomSample(sampleSize)
  const rightSample = await right.randomSample(sampleSize)

  // Build hash map of right keys
  const rightKeys = new Set(rightSample.map(r => r[joinKey.right]))

  // Count matching left rows
  const matches = leftSample.filter(l => rightKeys.has(l[joinKey.left]))
  const matchRate = matches.length / sampleSize

  // Extrapolate
  const leftTotal = await left.approximateRowCount()
  return Math.ceil(leftTotal * matchRate)
}
```

### 4. Sketch-Based Statistics

#### 4.1 HyperLogLog for Distinct Counts

Already in use (`db/primitives/bloom-filter.ts`). Extend to column-level:

```typescript
class ColumnStatsSketches {
  private distinctSketches: Map<string, HyperLogLog> = new Map()
  private minMax: Map<string, { min: unknown, max: unknown }> = new Map()

  // O(1) update per row
  update(column: string, value: unknown) {
    if (!this.distinctSketches.has(column)) {
      this.distinctSketches.set(column, new HyperLogLog({ precision: 14 }))
    }
    this.distinctSketches.get(column)!.add(value)
    this.updateMinMax(column, value)
  }

  getDistinctCount(column: string): number {
    return this.distinctSketches.get(column)?.count() ?? 0
  }
}
```

**Memory:** 16KB per column (precision 14) gives ~0.81% error.

#### 4.2 Count-Min Sketch for Value Frequencies

For estimating `WHERE col = 'value'` selectivity:

```typescript
class FrequencySketch {
  private sketch: CountMinSketch

  constructor(columns: string[]) {
    // ~128KB total for 4 hash functions, 8192 counters
    this.sketch = new CountMinSketch({ width: 8192, depth: 4 })
  }

  estimateSelectivity(column: string, value: unknown, totalRows: number): number {
    const key = `${column}:${String(value)}`
    const frequency = this.sketch.estimate(key)
    return frequency / totalRows
  }
}
```

#### 4.3 Equi-Depth Histograms (Compact)

Instead of full histograms, store bucket boundaries:

```typescript
interface CompactHistogram {
  column: string
  bucketBoundaries: number[]  // Only 10-20 values
  rowCount: number
}

// Estimate range selectivity
function estimateRangeSelectivity(
  hist: CompactHistogram,
  low: number,
  high: number
): number {
  const totalBuckets = hist.bucketBoundaries.length - 1
  const lowBucket = findBucket(hist.bucketBoundaries, low)
  const highBucket = findBucket(hist.bucketBoundaries, high)

  // Assume uniform distribution within buckets
  const fullBuckets = highBucket - lowBucket - 1
  const selectivity = (fullBuckets + 0.5 + 0.5) / totalBuckets

  return selectivity
}
```

### 5. Adaptive Query Execution (AQE)

Don't commit to a plan upfront; adjust during execution:

```typescript
class AdaptiveExecutor {
  async execute(plan: QueryPlan): Promise<ExecutionResult> {
    // Phase 1: Execute children and measure actual cardinality
    const leftResult = await this.execute(plan.children[0])
    const actualLeftRows = leftResult.rowCount

    // Phase 2: Re-evaluate plan based on actual sizes
    if (plan.type === 'hash_join') {
      const estimatedLeftRows = plan.children[0].estimatedRows

      // Switch join strategy if estimate was wrong by >10x
      if (actualLeftRows > estimatedLeftRows * 10) {
        // Estimated small table is actually large - switch to sort-merge
        return this.executeSortMerge(leftResult, plan.children[1])
      }

      if (actualLeftRows < estimatedLeftRows / 10) {
        // Estimated large table is actually small - use broadcast join
        return this.executeBroadcastJoin(leftResult, plan.children[1])
      }
    }

    // Phase 3: Execute with original plan
    return this.executeOriginalPlan(plan, leftResult)
  }
}
```

**AQE Benefits:**
- Recovers from bad estimates at runtime
- No upfront statistics needed
- Works well for filtered inputs

**AQE Costs:**
- Pipeline breaks (must materialize intermediate results)
- Increased latency for small queries
- Complexity in execution engine

### 6. Iceberg Integration

Iceberg manifests contain column-level statistics:

```typescript
interface IcebergManifestEntry {
  file_path: string
  record_count: number
  column_sizes: Map<string, number>
  lower_bounds: Map<string, Buffer>
  upper_bounds: Map<string, Buffer>
  null_value_counts: Map<string, number>
  nan_value_counts: Map<string, number>
  distinct_counts?: Map<string, number>  // Optional
}
```

**Strategy:** Read manifest statistics on query planning:

```typescript
class IcebergStatsReader {
  async getTableStats(tableId: string): Promise<TableStats> {
    const manifests = await this.loadManifests(tableId)

    let totalRows = 0
    const columnStats = new Map<string, AggregatedColumnStats>()

    for (const manifest of manifests) {
      totalRows += manifest.record_count

      for (const [col, lower] of manifest.lower_bounds) {
        const stats = columnStats.get(col) ?? newColumnStats()
        stats.min = minValue(stats.min, lower)
        stats.max = maxValue(columnStats.get(col)?.max, manifest.upper_bounds.get(col))
        stats.nullCount += manifest.null_value_counts.get(col) ?? 0
        columnStats.set(col, stats)
      }
    }

    return { totalRows, columnStats }
  }
}
```

## Recommended Approach

Based on our constraints (stateless DOs, edge execution, Iceberg backend), recommend a **layered approach**:

### Layer 1: Iceberg Manifest Statistics (Free)

Always available, zero cost. Use for:
- Row counts (exact)
- Min/max bounds (exact)
- Null counts (exact)
- Partition pruning

### Layer 2: Lightweight Runtime Sketches

Maintain during writes with ~100KB overhead per table:
- HyperLogLog for top 10 columns (160KB)
- Count-Min Sketch for value frequencies (32KB)

### Layer 3: Adaptive Query Execution

For queries where estimates matter:
- Materialize first child of joins
- Re-evaluate plan if >5x deviation
- Use broadcast join for small tables (<10K rows)

### Layer 4: Query Feedback (Future)

Store feedback in KV for repeated queries:
- Hash normalized query
- Store actual/estimated ratio
- Apply correction factor for similar queries

## Prototype Implementation Plan

### Test 1: AST Complexity Estimation

```typescript
// Estimate complexity without statistics
function estimateQueryComplexity(ast: QueryNode): ComplexityScore {
  return {
    predicateCount: countPredicates(ast),
    joinCount: countJoins(ast),
    aggregationPresent: hasAggregation(ast),
    // More complex queries need better estimates
    requiresSampling: this.predicateCount > 3 || this.joinCount > 1,
  }
}
```

### Test 2: Actual vs Estimated Tracking

```typescript
describe('Cost Estimation Accuracy', () => {
  it('tracks estimation errors over time', async () => {
    const tracker = new EstimationTracker()
    const queries = loadTestQueries()

    for (const query of queries) {
      const estimated = planner.estimateCardinality(query)
      const actual = await executor.execute(query).rowCount

      tracker.record(query, estimated, actual)
    }

    const stats = tracker.getStats()
    // 90% of queries within 10x
    expect(stats.percentWithin10x).toBeGreaterThan(0.9)
  })
})
```

### Test 3: Sampling Accuracy

```typescript
describe('Sampling Estimation', () => {
  it('achieves target accuracy with sufficient samples', async () => {
    const table = await createTestTable(100000) // 100K rows
    const predicate = eq('status', 'active')

    // Sample-based estimate
    const estimated = await sampleEstimate(table, predicate, 1000)
    const actual = await fullScan(table, predicate)

    // Within 20% with 1000 samples
    expect(estimated).toBeWithinPercent(actual, 20)
  })
})
```

## Conclusion

Cost estimation without traditional statistics is achievable within our 10x accuracy target by:

1. **Leveraging Iceberg:** Manifest statistics provide row counts and bounds
2. **Lightweight sketches:** HyperLogLog + Count-Min in ~200KB total
3. **Adaptive execution:** Recover from bad estimates at runtime
4. **Query feedback:** Learn from execution history

The main tradeoff is increased query latency for the first execution of novel queries, which can be mitigated by conservative initial estimates (assume larger tables).

## References

- PostgreSQL Query Planning: https://www.postgresql.org/docs/current/planner-optimizer.html
- Adaptive Query Execution in Spark: https://spark.apache.org/docs/latest/sql-performance-tuning.html#adaptive-query-execution
- HyperLogLog paper: Flajolet et al., 2007
- Count-Min Sketch paper: Cormode & Muthukrishnan, 2005
- Iceberg spec: https://iceberg.apache.org/spec/
