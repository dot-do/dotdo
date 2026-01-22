# Spike: JSON Path Indexing in ClickHouse

## Overview

This document investigates how JSON fields can be indexed for fast lookups in ClickHouse, with particular attention to WASM deployment considerations.

## 1. JSON Column Indexing in ClickHouse

### 1.1 The New JSON Data Type (v25.3+)

ClickHouse introduced a powerful native JSON data type that provides true column-oriented storage. Key features:

- **Columnar Storage**: Each JSON path is stored as a separate subcolumn file (e.g., `data.user.id.bin`)
- **Variant Type Foundation**: Values of different types for the same path are stored in separate subcolumns with a discriminator
- **Dynamic Type Discovery**: Types are automatically inferred during insertion
- **Configurable Limits**:
  - `max_dynamic_paths` (default 1024): Maximum paths stored as separate columns
  - `max_dynamic_types` (default 32): Maximum type variants per path before String fallback

```sql
CREATE TABLE events (
  data JSON(
    max_dynamic_paths=1024,
    max_dynamic_types=32,
    user.id UInt64,           -- Type hint for better performance
    SKIP internal_debug,       -- Exclude specific paths
    SKIP REGEXP '^_.*'        -- Exclude paths matching pattern
  )
) ENGINE = MergeTree()
ORDER BY data.timestamp;
```

### 1.2 Skip Indices on JSON Paths

Skip indices (also called data-skipping indices) allow ClickHouse to bypass data blocks that cannot contain matching values. They work at the granule level (default 8192 rows).

#### Types of Skip Indices

| Index Type | Use Case | Parameters |
|------------|----------|------------|
| `minmax` | Range queries on scalar values | None |
| `set(N)` | Low-cardinality columns | Max set size |
| `bloom_filter(fp)` | Exact match lookups | False positive rate (default 0.025) |
| `tokenbf_v1(size, hashes, seed)` | Text search, tokenized | Bloom filter params |
| `ngrambf_v1(n, size, hashes, seed)` | Substring search | N-gram size + bloom params |

#### Creating Skip Index on JSON Extraction

```sql
-- Using JSONExtract function in index expression
CREATE TABLE logs (
  timestamp DateTime,
  data String,
  INDEX idx_user_id (JSONExtractUInt(data, 'user', 'id')) TYPE bloom_filter GRANULARITY 4,
  INDEX idx_event_type (JSONExtractString(data, 'event_type')) TYPE set(100) GRANULARITY 4
) ENGINE = MergeTree()
ORDER BY timestamp;
```

### 1.3 Bloom Filters for JSON

Bloom filters are probabilistic data structures that test set membership with possible false positives but no false negatives.

**Advantages:**
- Space-efficient (configurable size)
- Fast O(k) lookups where k = number of hash functions
- Works with exact matches and array `has()` functions

**Limitations:**
- Cannot be used with negative operators (`!=`, `NOT LIKE`)
- False positives cause unnecessary block reads
- Only effective when filtering for rare values

```sql
-- Bloom filter on JSON array contents
CREATE TABLE events (
  data String,
  INDEX idx_tags (JSONExtractArrayRaw(data, 'tags')) TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE = MergeTree()
ORDER BY timestamp;
```

### 1.4 Materialized Columns from JSON

Materialized columns extract JSON values at insert time, storing them as dedicated columns.

```sql
CREATE TABLE events (
  timestamp DateTime,
  data String,
  user_id UInt64 MATERIALIZED JSONExtractUInt(data, 'user', 'id'),
  event_type String MATERIALIZED JSONExtractString(data, 'event_type')
) ENGINE = MergeTree()
ORDER BY (event_type, timestamp);

-- Query using materialized column (no JSON parsing at query time)
SELECT * FROM events WHERE user_id = 12345;
```

**Benefits:**
- Up to 25x faster reads compared to runtime JSON extraction
- Can be used in ORDER BY for primary index benefits
- Automatic population during INSERT

**Trade-offs:**
- Increased storage (though ClickHouse compression helps)
- Requires backfilling for existing data via `OPTIMIZE TABLE`
- Schema must be defined upfront

## 2. Secondary Indices

### 2.1 Index on `$.user.id`

**Option A: Using JSON Type with ORDER BY (Recommended for v24.12+)**

```sql
CREATE TABLE users (
  data JSON(user.id UInt64)
)
ENGINE = MergeTree()
ORDER BY data.user.id;

-- Query automatically uses primary index
SELECT * FROM users WHERE data.user.id = 12345;
```

**Option B: Materialized Column with Primary Key**

```sql
CREATE TABLE users (
  data String,
  user_id UInt64 MATERIALIZED JSONExtractUInt(data, 'user', 'id')
)
ENGINE = MergeTree()
ORDER BY user_id;
```

**Option C: Skip Index for Secondary Lookups**

```sql
CREATE TABLE users (
  data String,
  INDEX idx_user_id (JSONExtractUInt(data, 'user', 'id')) TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp;
```

### 2.2 Index on Nested Arrays

```sql
CREATE TABLE events (
  data String,
  -- Index for checking if array contains a value
  INDEX idx_tags (JSONExtractArrayRaw(data, 'tags')) TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp;

-- Query using has() function
SELECT * FROM events WHERE has(JSONExtract(data, 'tags', 'Array(String)'), 'important');
```

For arrays of objects, use Array of Tuples:

```sql
CREATE TABLE events (
  items Array(Tuple(id UInt64, name String)),
  INDEX idx_item_ids (arrayMap(x -> x.1, items)) TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp;
```

### 2.3 Full-Text Search on JSON Strings

**Using tokenbf_v1 for Word Search:**

```sql
CREATE TABLE logs (
  data String,
  INDEX idx_message (JSONExtractString(data, 'message')) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp;

-- Word-based search (alphanumeric tokenization)
SELECT * FROM logs WHERE hasToken(JSONExtractString(data, 'message'), 'error');
```

**Using ngrambf_v1 for Substring Search:**

```sql
CREATE TABLE logs (
  data String,
  INDEX idx_message (JSONExtractString(data, 'message')) TYPE ngrambf_v1(4, 32768, 3, 0) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp;

-- Substring search
SELECT * FROM logs WHERE JSONExtractString(data, 'message') LIKE '%timeout%';
```

## 3. Query Optimization

### 3.1 How JSON Path Queries Are Optimized

1. **Native JSON Type**: Paths are stored as separate subcolumns, enabling direct columnar reads
2. **Type Inference**: Automatic type detection allows vectorized processing
3. **Sparse Storage**: Missing paths don't consume storage (no NULL entries)
4. **Discriminator Optimization**: Uniform-type granules serialize compactly

### 3.2 Predicate Pushdown

ClickHouse supports predicate pushdown, but with caveats:

```sql
-- Enable for views
SET enable_optimize_predicate_expression = 1;

-- Predicates on primary key columns are pushed down
SELECT * FROM events WHERE data.timestamp > '2024-01-01';
```

**Limitations:**
- Not automatic for all view types
- ARRAY JOIN in views may prevent pushdown
- Manual predicate placement may be needed for complex joins

### 3.3 Partition Pruning with JSON

Partition pruning works when JSON values are used in partition keys:

```sql
CREATE TABLE events (
  data JSON(event_date Date)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(data.event_date)
ORDER BY data.timestamp;

-- Partition pruning applies to this query
SELECT * FROM events WHERE data.event_date >= '2024-06-01';
```

**Best Practice**: Use materialized columns for partition keys to ensure consistent types.

## 4. WASM Considerations

### 4.1 Index Size and Memory Impact

**WebAssembly Memory Constraints:**
- wasm32: Maximum 4GB addressable memory
- Mobile browsers: Often limited to 300-500MB practical usage
- iOS Safari: Issues with 2GB+ memory allocations

**Index Memory Requirements:**
| Index Type | Memory Formula | Example (1M rows) |
|------------|----------------|-------------------|
| minmax | 2 * sizeof(type) per granule | ~16KB (UInt64) |
| set(100) | Up to N * sizeof(type) per granule | ~800KB |
| bloom_filter | size_bytes per granule | Configurable |

**Recommendations for WASM:**
1. Use smaller bloom filter sizes (e.g., 1024-4096 bytes)
2. Increase granularity to reduce index entries (e.g., GRANULARITY 16)
3. Limit `max_dynamic_paths` for JSON type (e.g., 128)
4. Use type hints to avoid Dynamic type overhead

### 4.2 Build-Time Index Creation

For read-only WASM deployments, indices can be pre-built:

1. **Export with Indices**: Build tables with skip indices on the server
2. **Format Compatibility**: Ensure WASM runtime supports the index format
3. **Memory Mapping**: Consider mmap-style access for index files if supported

**Simplified Index Strategy for WASM:**

```sql
-- Prefer minmax (smallest memory footprint)
CREATE TABLE events (
  data JSON(
    max_dynamic_paths=64,
    timestamp DateTime,
    user_id UInt32
  ),
  INDEX idx_ts (data.timestamp) TYPE minmax GRANULARITY 16,
  INDEX idx_user (data.user_id) TYPE set(1000) GRANULARITY 16
)
ENGINE = MergeTree()
ORDER BY data.timestamp;
```

### 4.3 Alternative Approaches for WASM

1. **Client-Side Filtering**: For small datasets, filter in JavaScript
2. **Pre-Computed Aggregates**: Use materialized views to reduce query scope
3. **Partition-Based Access**: Load only required partitions
4. **Projection Tables**: Create lightweight projections for common queries

## 5. Summary and Recommendations

### For General Use

| Requirement | Recommended Approach |
|-------------|---------------------|
| Fast point lookups | JSON subcolumn in ORDER BY |
| Secondary filters | Bloom filter skip index |
| Text search | tokenbf_v1 or ngrambf_v1 |
| Range queries | minmax skip index |
| High-performance reads | Materialized columns |

### For WASM Deployment

| Constraint | Mitigation |
|------------|------------|
| Memory < 512MB | Reduce `max_dynamic_paths`, increase granularity |
| Index size | Prefer minmax over bloom filters |
| Startup time | Pre-build indices, minimize dynamic discovery |
| Query patterns | Use projections for known query patterns |

### Best Practices

1. **Profile First**: Use `EXPLAIN indexes = 1` to verify index usage
2. **Correlation Matters**: Skip indices work best when indexed values correlate with ORDER BY
3. **Test False Positives**: Bloom filters may not help if data is scattered
4. **Consider Projections**: Often more effective than skip indices for known query patterns
5. **Monitor Memory**: Track index memory with system tables

## References

- [ClickHouse JSON Data Type Documentation](https://clickhouse.com/docs/sql-reference/data-types/newjson)
- [ClickHouse Skip Indexes Guide](https://clickhouse.com/docs/optimize/skipping-indexes)
- [Building a Powerful JSON Data Type for ClickHouse](https://clickhouse.com/blog/a-new-powerful-json-data-type-for-clickhouse)
- [Accelerating ClickHouse Queries on JSON Data](https://clickhouse.com/blog/accelerating-clickhouse-json-queries-for-fast-bluesky-dashboards)
- [Streaming Secondary Indices](https://clickhouse.com/blog/streaming-secondary-indices)
- [Altinity: All About JSON and ClickHouse](https://altinity.com/wp-content/uploads/2024/03/All-About-JSON-and-ClickHouse-Tips-Tricks-and-New-Features.pdf)
- [WebAssembly Memory Limits](https://v8.dev/blog/4gb-wasm-memory)
