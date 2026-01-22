# Spike: Native JSON Column vs String + JSONExtract Performance

## Goal

Benchmark and analyze the two primary JSON handling approaches in ClickHouse to provide recommendations for when to use each.

## Status: INVESTIGATION COMPLETE

## Executive Summary

The **native JSON column type** (introduced v24.8, production-ready v25.8) provides significant performance advantages for most analytical workloads, achieving **6x faster queries** and **58x faster selective reads** compared to String + JSONExtract. However, String + JSONExtract remains preferable for unpredictable high-cardinality JSON paths or when storage efficiency is critical.

## Two Approaches Compared

### 1. Native JSON Column Type

```sql
CREATE TABLE logs_native (
    id UInt64,
    timestamp DateTime,
    data JSON  -- Native JSON type
) ENGINE = MergeTree()
ORDER BY (timestamp, id);

-- Query with dot syntax
SELECT data.user.id, data.action
FROM logs_native
WHERE data.status = 'error';
```

### 2. String + JSONExtract Functions

```sql
CREATE TABLE logs_string (
    id UInt64,
    timestamp DateTime,
    data String  -- JSON stored as compressed string
) ENGINE = MergeTree()
ORDER BY (timestamp, id);

-- Query with JSONExtract
SELECT
    JSONExtractString(data, 'user', 'id') as user_id,
    JSONExtractString(data, 'action') as action
FROM logs_string
WHERE JSONExtractString(data, 'status') = 'error';
```

## Storage Efficiency

### How Native JSON Column is Stored Internally

The native JSON type uses a sophisticated **subcolumn architecture**:

1. **Path-based decomposition**: Each unique JSON key path is stored in its own subcolumn
2. **Type inference**: ClickHouse automatically infers and stores native types (Int64, Float64, String, etc.)
3. **Discriminator column**: A UInt8 tracks which concrete type each row contains (max 254 types + NULL)
4. **Dynamic paths**: Paths without explicit type hints use the Dynamic data type
5. **Typed paths**: Paths with type hints are stored as regular column files

```sql
-- Type hints for optimal storage
CREATE TABLE events (
    data JSON(
        user_id UInt64,        -- Always stored as UInt64
        timestamp DateTime64,  -- Always stored as DateTime64
        SKIP some.rarely.used.path  -- Excluded from typed storage
    )
) ENGINE = MergeTree() ORDER BY tuple();
```

### Storage Configuration Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `max_dynamic_paths` | 1024 | Max separately-stored paths |
| `max_dynamic_types` | 32 | Max type variants per path |

Paths/types exceeding limits are compressed into shared data files using binary encoding.

### Compression Comparison

| Aspect | Native JSON | String + JSONExtract |
|--------|-------------|---------------------|
| **Per-path compression** | Optimal (columnar) | N/A (whole document) |
| **Type-specific encoding** | Yes (native codecs) | No (string compression only) |
| **Null handling** | Dense (no redundant NULLs) | Nulls in JSON string |
| **Overhead** | Subcolumn metadata | ZSTD compression overhead |

**Key finding**: Native JSON achieves better compression ratios for structured data because each path uses type-appropriate codecs. String storage relies solely on ZSTD compression of the entire JSON document.

### Storage Overhead Consideration

The advanced serialization format (v25.8) maintains a duplicate copy in `Map(String, String)` format for compatibility, effectively **doubling storage** but preserving performance for full-column reads and merges.

## Query Performance

### Benchmark Results

#### Standard Queries (11.2M rows)

| Approach | Time | Data Processed | Throughput |
|----------|------|----------------|------------|
| String + JSONExtract | 2.101s | 3.73 GB | 3.55 million rows/sec |
| Native JSON | 0.331s | 642 MB | 33.8 million rows/sec |

**Result: 6x faster with native JSON**

#### Selective Reads (200k rows, 10k paths/document)

| Approach | Time | Memory |
|----------|------|--------|
| Original shared data format | baseline | 12.53 GiB |
| Map with buckets | intermediate | 403.55 MiB |
| Advanced serialization (v25.8) | 58x faster | 3.89 MiB |

**Result: 58x faster, 3,300x less memory**

### JSON Path Access Speed

| Operation | Native JSON | String + JSONExtract |
|-----------|-------------|---------------------|
| Direct path access (`data.user.id`) | Subcolumn read (fast) | Parse entire string (slow) |
| Nested path access | Same as direct | Parse, navigate, extract |
| Multiple fields | Parallel subcolumn reads | Multiple parse passes |

**Native JSON advantage**: Reading `data.user.id` reads only that subcolumn (~MB), not the entire JSON column (~GB).

### Aggregation Over JSON Fields

```sql
-- Native JSON: reads only status subcolumn
SELECT data.status, COUNT(*)
FROM logs_native
GROUP BY data.status;

-- String: must parse every row
SELECT JSONExtractString(data, 'status'), COUNT(*)
FROM logs_string
GROUP BY JSONExtractString(data, 'status');
```

Native JSON is dramatically faster for aggregations because it only reads the relevant subcolumn.

### Filter Pushdown Capabilities

| Feature | Native JSON | String + JSONExtract |
|---------|-------------|---------------------|
| Primary key support | Via typed paths | Via materialized columns |
| Skip index support | Yes (with limitations) | Via materialized columns |
| PREWHERE optimization | Subcolumn-level | Full string required |
| Partition pruning | Via typed paths | Via materialized columns |

**Limitations noted**: Skip indexes do NOT work when using `CAST()` on JSON fields. Access fields directly without casting for index utilization.

```sql
-- Working skip index
CREATE TABLE logs (
  ts DateTime64(3),
  data JSON(message String),
  INDEX idx1 data.message TYPE ngrambf_v1(4, 16000, 2, 0) GRANULARITY 1
);
```

## Memory Usage

### Parsing Overhead

| Scenario | Native JSON | String + JSONExtract |
|----------|-------------|---------------------|
| Query-time parsing | None (pre-parsed) | Per-row parsing required |
| Insert-time parsing | Yes (schema inference) | Minimal validation |
| Memory per query | Subcolumn size | Full column + parse buffers |

### Column Loading Comparison

From real-world benchmarks:

| Metric | Native JSON | String (JSONExtract) |
|--------|-------------|---------------------|
| Memory during query | 17.92 GB | 8.13 GB |
| I/O required | Subcolumn only | Full string column |

**Important caveat**: When selecting the entire JSON object (not specific paths), native JSON requires reading all subcolumns, which can be **less efficient** than reading a single compressed String column.

```sql
-- This is SLOWER with native JSON
SELECT labels FROM logs_native;  -- Reads all subcolumns

-- This is FASTER with native JSON
SELECT labels.job, labels.region FROM logs_native;  -- Reads 2 subcolumns only
```

### Memory-Optimized Configuration (v25.8)

```sql
CREATE TABLE logs (
    data JSON SETTINGS
        max_dynamic_paths = 1024,
        max_dynamic_types = 32,
        -- Use advanced serialization for high-cardinality
        use_advanced_serialization = true
);
```

## Index Possibilities

### Native JSON Indexing

```sql
CREATE TABLE events (
    data JSON(
        user_id UInt64,
        event_type LowCardinality(String)
    ),
    -- Skip index on typed path
    INDEX user_idx data.user_id TYPE bloom_filter GRANULARITY 1,
    INDEX event_idx data.event_type TYPE set(100) GRANULARITY 4
) ENGINE = MergeTree()
ORDER BY tuple();
```

### String + Materialized Columns (Traditional)

```sql
CREATE TABLE events (
    data String,
    -- Materialized columns for indexing
    user_id UInt64 MATERIALIZED JSONExtractUInt64(data, 'user_id'),
    event_type String MATERIALIZED JSONExtractString(data, 'event_type'),
    -- Indexes on materialized columns
    INDEX user_idx user_id TYPE bloom_filter GRANULARITY 1
) ENGINE = MergeTree()
ORDER BY (user_id);
```

## Recommendations

### When to Use Native JSON

**Best for:**
- Analytics on semi-structured data with predictable key paths
- Dashboards filtering/aggregating specific JSON fields
- High query volume on the same paths
- Type consistency matters (numeric aggregations, date comparisons)
- Query performance is priority over storage

**Configuration tips:**
- Use type hints for frequently-queried paths
- Set appropriate `max_dynamic_paths` based on schema variability
- Enable `use_advanced_serialization` for high-cardinality paths (v25.8+)

### When to Use String + JSONExtract

**Best for:**
- Unpredictable or high-cardinality JSON paths (e.g., user-defined attributes)
- Log ingestion with arbitrary JSON structures
- Storage efficiency is priority over query speed
- Infrequent queries that don't justify subcolumn overhead
- Scenarios where full JSON document is typically read

**Optimization tips:**
- Create materialized columns for frequently-queried fields
- Use ZSTD compression for string column
- Consider a two-tier approach (see below)

### Two-Tier Hybrid Approach (SigNoz Pattern)

For complex workloads, combine both approaches:

```sql
CREATE TABLE logs_hybrid (
    id UInt64,
    timestamp DateTime,
    -- Tier 1: Frequently-queried paths as native JSON
    structured_data JSON(
        level LowCardinality(String),
        service String,
        trace_id String
    ) SETTINGS max_dynamic_paths = 256,
    -- Tier 2: Full payload as compressed string
    raw_payload String CODEC(ZSTD(3))
) ENGINE = MergeTree()
ORDER BY (timestamp, id);
```

This provides:
- Fast filtering/aggregation on common paths (Tier 1)
- Full data availability for deep inspection (Tier 2)
- Optimal storage efficiency

## Performance Summary Table

| Metric | Native JSON | String + JSONExtract | Winner |
|--------|-------------|---------------------|--------|
| Single-path query | 6x faster | Baseline | Native JSON |
| Multi-path query | 10-58x faster | Baseline | Native JSON |
| Full document read | Slower (all subcolumns) | Faster (single column) | String |
| Storage (typed paths) | More efficient | Less efficient | Native JSON |
| Storage (dynamic paths) | ~2x overhead (v25.8) | Compact | String |
| Insert throughput | Lower (schema inference) | Higher | String |
| Memory (selective reads) | 3,300x less | Baseline | Native JSON |
| Memory (full document) | Higher | Lower | String |
| Index support | Native (with caveats) | Via materialized columns | Tie |

## Version Requirements

| Feature | Minimum Version |
|---------|-----------------|
| Native JSON type | v24.8 (experimental) |
| Advanced serialization | v25.8 |
| Sub-100ms JSON analytics | v25.3+ |
| JSON skip indexes | v24.12+ (with limitations) |

## References

- [How we built a new powerful JSON data type for ClickHouse](https://clickhouse.com/blog/a-new-powerful-json-data-type-for-clickhouse)
- [Making complex JSON 58x faster, use 3,300x less memory](https://clickhouse.com/blog/json-data-type-gets-even-better)
- [Building a high-performance log store (SigNoz)](https://signoz.io/blog/building-a-high-performance-log-store/)
- [GitHub Issue #37519: JSONExtractString vs JSON Object type](https://github.com/ClickHouse/ClickHouse/issues/37519)
- [GitHub Issue #73703: Skip indexes on JSON fields](https://github.com/ClickHouse/ClickHouse/issues/73703)
- [ClickHouse JSON Data Type Documentation](https://clickhouse.com/docs/sql-reference/data-types/newjson)

## Conclusion

The native JSON column type represents a significant advancement for ClickHouse's JSON handling capabilities. For most analytical workloads involving semi-structured data, native JSON provides substantial performance improvements (6-58x faster queries) with significantly lower memory consumption for selective reads.

However, String + JSONExtract remains the better choice for:
1. Highly unpredictable JSON schemas with thousands of unique paths
2. Workloads that primarily read complete documents rather than specific fields
3. Storage-constrained environments
4. High-throughput ingestion pipelines where insert performance is critical

For production deployments, consider the **two-tier hybrid approach** which combines the strengths of both methods: native JSON for frequently-queried paths and compressed strings for complete data preservation.
