# ClickBench Performance Targets

This document outlines expected performance targets for chdb-WASM on Cloudflare Workers, benchmarked against DuckDB-WASM and native ClickHouse results.

## Reference Systems

### Official ClickBench Results (c6a.4xlarge, 16 vCPU, 32GB RAM)

| System | Total Time (Hot) | Notes |
|--------|-----------------|-------|
| ClickHouse | ~3s | Native, optimized storage engine |
| DuckDB (native) | ~20s | Single-threaded, in-memory |
| DuckDB-WASM (Browser) | ~120-180s | WebAssembly overhead, limited memory |
| SQLite-WASM | ~600s+ | Not optimized for analytics |

### Cloudflare Workers Constraints

| Resource | Limit | Impact |
|----------|-------|--------|
| Memory | 128MB | Limits dataset size, affects large GROUP BY |
| CPU Time | 30s (50ms incremental) | May timeout on complex queries |
| Duration | 30s default | Longer queries need streaming |
| Startup | ~50-200ms | WASM initialization overhead |

## Per-Query Performance Targets

Based on DuckDB-WASM browser benchmarks and adjusted for Cloudflare Workers constraints.

### Tier 1: Fast Queries (<1s target)

| Query | Description | DuckDB-WASM | WASM Target | Notes |
|-------|-------------|-------------|-------------|-------|
| Q0 | COUNT(*) | 0.5-1s | <1s | Simple full scan |
| Q6 | MIN/MAX dates | 0.3-0.5s | <0.5s | Columnar efficient |
| Q7 | GROUP BY filter | 0.5-1s | <1s | Low cardinality |
| Q19 | Point lookup | 0.1-0.3s | <0.5s | Specific UserID |

### Tier 2: Medium Queries (1-5s target)

| Query | Description | DuckDB-WASM | WASM Target | Notes |
|-------|-------------|-------------|-------------|-------|
| Q1 | COUNT with filter | 1-2s | <2s | AdvEngineID filter |
| Q2 | SUM/COUNT/AVG | 1-2s | <2s | Multiple aggregations |
| Q3 | AVG on BIGINT | 1-2s | <2s | Large integer math |
| Q8 | GROUP BY DISTINCT | 2-4s | <5s | RegionID grouping |
| Q20 | LIKE filter | 2-4s | <5s | String pattern match |
| Q24-26 | ORDER BY | 2-4s | <5s | Sorting operations |

### Tier 3: Slow Queries (5-30s target)

| Query | Description | DuckDB-WASM | WASM Target | Notes |
|-------|-------------|-------------|-------------|-------|
| Q4 | COUNT DISTINCT UserID | 5-10s | <15s | High cardinality |
| Q5 | COUNT DISTINCT SearchPhrase | 8-15s | <20s | Variable length strings |
| Q9 | Multi-aggregation | 5-10s | <15s | Complex GROUP BY |
| Q12-14 | SearchPhrase GROUP BY | 5-10s | <15s | String grouping |
| Q15-18 | UserID GROUP BY | 8-15s | <20s | Very high cardinality |
| Q27 | HAVING with STRLEN | 5-10s | <15s | String function |
| Q29 | 90-column SUM | 3-8s | <10s | Wide aggregation |

### Tier 4: Very Slow Queries (30s+ / may timeout)

| Query | Description | DuckDB-WASM | WASM Target | Notes |
|-------|-------------|-------------|-------------|-------|
| Q21-23 | Complex LIKE + GROUP | 15-30s | <45s | Multiple conditions |
| Q28 | REGEXP GROUP BY | 20-40s | <60s | Regular expressions |
| Q31-32 | WatchID GROUP BY | 30-60s | May timeout | ~100M distinct |
| Q33-34 | URL GROUP BY | 20-40s | <60s | Very high cardinality |

### Tier 5: Date-Filtered Queries (Fast due to filtering)

| Query | Description | DuckDB-WASM | WASM Target | Notes |
|-------|-------------|-------------|-------------|-------|
| Q36-42 | Date range queries | 1-5s | <10s | Filtered subset |

## Memory Requirements

### Per-Query Memory Estimates

| Query Type | Memory Need | Notes |
|------------|-------------|-------|
| Simple aggregation | ~10-50MB | Low overhead |
| COUNT DISTINCT | ~100-500MB | Hash table for uniques |
| GROUP BY (low card) | ~50-100MB | Small hash table |
| GROUP BY (high card) | ~200MB-1GB | May exceed limits |
| String operations | ~100-300MB | String buffer overhead |
| ORDER BY (full sort) | ~500MB+ | Full materialization |

### Recommended Configurations

#### Cloudflare Workers (128MB limit)

```typescript
const workerConfig = {
  memoryLimit: 100 * 1024 * 1024, // 100MB usable
  queryTimeout: 25000, // 25s to stay under 30s limit
  maxResultRows: 10000, // Limit result size
  suitableQueries: [0, 1, 2, 3, 6, 7, 19, 24, 25, 26, 36, 37, 38, 39, 40, 41, 42],
};
```

#### Browser (512MB-2GB available)

```typescript
const browserConfig = {
  memoryLimit: 512 * 1024 * 1024, // 512MB
  queryTimeout: 120000, // 2 minutes
  maxResultRows: 100000,
  suitableQueries: 'all', // Can attempt all queries
};
```

## Optimization Strategies

### 1. Data Sampling for Workers

For Cloudflare Workers with memory constraints:

```sql
-- Use 1% sample for COUNT DISTINCT estimation
SELECT COUNT(DISTINCT UserID) * 100 AS estimated_users
FROM hits
USING SAMPLE 1 PERCENT;
```

### 2. Pre-aggregated Views

Create materialized views for common queries:

```sql
-- Daily aggregates
CREATE TABLE hits_daily AS
SELECT
  EventDate,
  CounterID,
  COUNT(*) AS hits,
  COUNT(DISTINCT UserID) AS users,
  COUNT(DISTINCT SearchPhrase) AS searches
FROM hits
GROUP BY EventDate, CounterID;
```

### 3. Query Rewriting

Transform expensive queries:

```sql
-- Original Q4 (expensive)
SELECT COUNT(DISTINCT UserID) FROM hits;

-- Rewritten using HyperLogLog approximation (DuckDB)
SELECT approx_count_distinct(UserID) FROM hits;
```

### 4. Streaming Results

For large result sets, stream instead of materializing:

```typescript
// Instead of fetching all results
const results = await db.query('SELECT * FROM hits WHERE ...');

// Stream results in chunks
const stream = await db.queryStream('SELECT * FROM hits WHERE ...', {
  chunkSize: 1000,
});
for await (const chunk of stream) {
  yield chunk;
}
```

## Benchmark Scenarios

### Scenario 1: Quick Health Check (5 queries, ~30s)

```bash
npx tsx benchmarks/run-clickbench.ts --queries 0,2,6,7,19
```

Expected results with 1M row sample:
- Total time: ~5-10s
- Memory peak: ~50MB
- Suitable for: CI/CD validation

### Scenario 2: Mini Benchmark (10 queries, ~2min)

```bash
npx tsx benchmarks/run-clickbench.ts --queries 0,2,4,8,12,20,27,33,36,42
```

Expected results with 1M row sample:
- Total time: ~30-60s
- Memory peak: ~200MB
- Suitable for: Development testing

### Scenario 3: Full Benchmark (43 queries, ~15-30min)

```bash
npx tsx benchmarks/run-clickbench.ts
```

Expected results with full dataset:
- Total time: ~10-30min (DuckDB-WASM)
- Memory peak: ~1-2GB
- Suitable for: Release validation, comparison

## Comparison with Other WASM Databases

| System | Best Use Case | ClickBench Performance |
|--------|---------------|------------------------|
| DuckDB-WASM | Analytics | ~120s total (good) |
| SQLite-WASM | Transactions | ~600s total (poor) |
| chdb-WASM | ClickHouse SQL | Target: ~60-120s |

## Cloudflare Workers Specific Targets

Given the 128MB memory and 30s CPU time limits:

### Feasible Queries (should complete in Workers)

| Query IDs | Type | Expected Time |
|-----------|------|---------------|
| Q0, Q1, Q2, Q3 | Aggregations | <5s each |
| Q6, Q7 | Simple GROUP BY | <5s each |
| Q19 | Point lookup | <1s |
| Q24, Q25, Q26 | ORDER BY LIMIT | <5s each |
| Q36-Q42 | Date-filtered | <10s each |

### Potentially Feasible (depends on data)

| Query IDs | Type | Risk |
|-----------|------|------|
| Q8, Q9 | GROUP BY DISTINCT | Memory |
| Q10-Q14 | String GROUP BY | Memory + Time |
| Q20-Q23 | LIKE patterns | Time |

### Likely to Fail (need optimization)

| Query IDs | Type | Issue |
|-----------|------|-------|
| Q4, Q5 | COUNT DISTINCT | Memory (17M+ uniques) |
| Q15-Q18 | High cardinality | Memory |
| Q28 | REGEXP | CPU time |
| Q31-Q34 | Very high cardinality | Memory |

## Performance Monitoring

### Key Metrics to Track

1. **Cold Start Time**: WASM initialization + data loading
2. **Query Execution Time**: Actual SQL processing
3. **Memory High Water Mark**: Peak memory usage
4. **Result Serialization Time**: JSON/Arrow encoding

### Logging Template

```typescript
const metrics = {
  queryId: 'Q4',
  coldStartMs: 150,
  executionMs: 8500,
  totalMs: 8650,
  memoryPeakMb: 95,
  rowsReturned: 1,
  resultSizeBytes: 24,
  status: 'success',
};
```

## References

- [ClickBench Official Results](https://benchmark.clickhouse.com/)
- [DuckDB-WASM Paper (VLDB 2022)](https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [DuckDB Performance Guide](https://duckdb.org/docs/guides/performance/benchmarks)
