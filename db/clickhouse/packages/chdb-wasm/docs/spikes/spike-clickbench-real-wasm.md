# Spike: Running Real ClickBench Queries Through WASM

## Executive Summary

This spike investigates the gap between current WASM executor capabilities and the requirements for running real ClickBench benchmark queries. The current bundled executor is a **minimal expression evaluator** (~188KB) designed for simple expressions and aggregates over in-memory data, not a full SQL engine capable of reading from storage.

**Key Finding**: Running real ClickBench queries requires either:
1. The **full chdb.wasm** build (~130MB) which includes complete ClickHouse SQL engine
2. A **hybrid architecture** using parquet-wasm + JavaScript executor
3. **Progressive enhancement** of the minimal WASM with storage capabilities

## 1. Current Executor Capabilities Analysis

### 1.1 Bundled Executor (executor.wasm - 188KB)

Located at: `/packages/chdb-wasm/wasm/dist/executor.wasm`

**Source**: `wasm/executor_bindings.cpp`

**Supported SQL**:
```sql
-- Literals and expressions
SELECT 1 + 2 * 3
SELECT 'hello' AS greeting

-- Aggregates over inline data
SELECT COUNT(*) FROM (SELECT 1 UNION ALL SELECT 2)
SELECT SUM(x), AVG(x), MIN(x), MAX(x) FROM (SELECT 10 AS x UNION ALL SELECT 20 AS x)

-- Table functions
SELECT * FROM numbers(100)

-- GROUP BY
SELECT x, COUNT(*) FROM (SELECT 1 AS x UNION ALL SELECT 1 AS x) GROUP BY x
```

**NOT Supported**:
- Reading from external storage (no file/Parquet support)
- Reading from tables (no MergeTree, no Memory engine storage)
- Complex SQL: JOINs, subqueries in FROM with storage, CTEs
- String functions: LIKE, REGEXP_REPLACE, length()
- Date functions: DATE_TRUNC, extract()
- HAVING clauses
- OFFSET in LIMIT

### 1.2 chDB Backend (chdb-backend.ts)

Located at: `/packages/chdb-wasm/src/chdb-backend.ts`

**Purpose**: Loads full chdb.wasm from R2 storage for complete ClickHouse functionality.

**WASM Size**: 130MB (at `/packages/chdb-wasm/build-wasm/dist/chdb.wasm`)

**Capabilities**: Full ClickHouse SQL including:
- All data types and functions
- Parquet reading (if enabled in build)
- MergeTree engine
- Complete query planner

**Limitation**: Far exceeds Cloudflare Workers 128MB memory limit for practical deployment.

### 1.3 Other WASM Modules Available

| Module | Size | Purpose |
|--------|------|---------|
| `executor.wasm` | 188KB | Expression evaluation + basic aggregates |
| `aggregates.wasm` | 169KB | Aggregate functions (COUNT, SUM, AVG, MIN, MAX, UNIQ) |
| `parser.wasm` | 23KB | SQL tokenization/parsing |
| `real_parser.wasm` | 31KB | Enhanced SQL parser |
| `mergetree.wasm` | 291KB | MergeTree format reader (VFS-based) |
| `parquet_reader.cpp` | Source | Custom minimal Parquet reader |
| `memory_engine.wasm` | 166KB | In-memory table storage |
| `json_format.wasm` | 144KB | JSON input/output formatting |
| `csv_format.wasm` | 140KB | CSV input/output formatting |

### 1.4 ClickBench Executor (TypeScript)

Located at: `/packages/chdb-wasm/src/clickbench/executor.ts`

**Purpose**: JavaScript-based query executor for ClickBench queries.

**Capabilities**:
- Parses ClickBench SQL queries
- Extracts WHERE, GROUP BY, ORDER BY, LIMIT
- Performs aggregates in JavaScript (COUNT, SUM, AVG, MIN, MAX, COUNT DISTINCT)
- Reads from MergeTree parts via `mergetree-loader`

**Limitation**: Currently uses **sample data generation**, not real MergeTree data:
```cpp
// From executor.ts line 721:
// TODO: Replace with real MergeTree column data reading
private getSampleValue(colDef: ColumnDefinition, rowIndex: number): unknown {
  switch (colDef.type) {
    case 'UInt8': return rowIndex % 256;
    // ... generates fake data
  }
}
```

## 2. ClickBench Query Requirements

### 2.1 Query Feature Matrix

Analysis of all 43 ClickBench queries:

| Feature | Queries Using | Example |
|---------|---------------|---------|
| COUNT(*) | 22 | Q0: `SELECT COUNT(*) FROM hits` |
| COUNT(DISTINCT) | 11 | Q4: `SELECT COUNT(DISTINCT UserID) FROM hits` |
| SUM/AVG | 14 | Q2: `SELECT SUM(AdvEngineID), AVG(ResolutionWidth) FROM hits` |
| MIN/MAX | 6 | Q6: `SELECT MIN(EventDate), MAX(EventDate) FROM hits` |
| WHERE | 27 | Q1: `SELECT COUNT(*) FROM hits WHERE AdvEngineID <> 0` |
| GROUP BY | 27 | Q7: `SELECT AdvEngineID, COUNT(*) FROM hits GROUP BY AdvEngineID` |
| ORDER BY | 29 | Q8: `SELECT RegionID, COUNT(DISTINCT UserID) ORDER BY u DESC` |
| LIMIT | 32 | Q9: `... LIMIT 10` |
| OFFSET | 6 | Q38: `... LIMIT 10 OFFSET 1000` |
| LIKE | 5 | Q20: `WHERE URL LIKE '%google%'` |
| HAVING | 3 | Q27: `HAVING COUNT(*) > 100000` |
| DATE functions | 3 | Q42: `DATE_TRUNC('minute', EventTime)` |
| EXTRACT | 1 | Q18: `extract(minute FROM EventTime)` |
| REGEXP_REPLACE | 1 | Q28: regex domain extraction |
| CASE | 1 | Q39: `CASE WHEN ... THEN ... ELSE ... END` |
| length() | 2 | Q27: `AVG(length(URL))` |

### 2.2 Query Complexity Distribution

```
Simple (6 queries):     Q0-Q6 - Basic aggregates, no GROUP BY
Medium (8 queries):     Q7-Q17 - GROUP BY with single aggregates
Complex (29 queries):   Q18-Q42 - Multi-column GROUP BY, string filters, date functions
```

### 2.3 Data Requirements

From `/packages/chdb-wasm/src/clickbench/schema.ts`:

```typescript
export const HITS_TABLE_METADATA = {
  columnCount: 105,
  approximateRowCount: 99_997_497,
  approximateCompressedSize: 16 * 1024 * 1024 * 1024, // ~16GB compressed
  approximateUncompressedSize: 70 * 1024 * 1024 * 1024, // ~70GB uncompressed
};
```

**Column types**: UInt8, UInt16, UInt32, UInt64, Int8, Int16, Int32, Int64, Float32, Float64, String, Date, DateTime

## 3. Gap Analysis: Current vs Required

### 3.1 Executor Gaps

| Requirement | executor.wasm | aggregates.wasm | JS Executor |
|-------------|---------------|-----------------|-------------|
| Read from storage | No | No | Partial (mock) |
| Parquet support | No | No | No |
| LIKE patterns | No | No | Yes |
| HAVING clause | No | No | No |
| DATE_TRUNC | No | No | No |
| EXTRACT | No | No | No |
| REGEXP_REPLACE | No | No | No |
| length() | No | No | No |
| 105-column schema | N/A | N/A | Yes (defined) |

### 3.2 Data Access Gaps

| Component | Status | Notes |
|-----------|--------|-------|
| Parquet reading | Partial | `parquet_reader.cpp` exists but not integrated |
| MergeTree reading | Partial | `mergetree.wasm` exists, needs column decoding |
| R2 storage access | Yes | VFS bridge implemented |
| Column projection | No | Would need to read all columns |
| Predicate pushdown | No | All filtering in JS |

### 3.3 Memory Constraints

**Cloudflare Workers Limit**: 128MB

**Data size implications**:
- 1M rows with 105 columns: ~1-5GB uncompressed
- Even 10K rows sample: ~50-100MB
- Parquet row group: typically 100-500MB

**Conclusion**: Full ClickBench dataset cannot fit in memory. Must use:
- Sampling (0.01% = 10K rows)
- Partitioned access
- Streaming aggregation

## 4. Options for Running Real ClickBench

### 4.1 Option A: Full chdb.wasm (Blocked)

**Approach**: Load the complete 130MB ClickHouse WASM build.

**Pros**:
- Full SQL compatibility
- Native Parquet support (if built with ENABLE_PARQUET=ON)
- Optimized C++ execution

**Cons**:
- Exceeds 128MB Workers memory limit
- R2 streaming load too slow (~10-30 seconds)
- Not practical for production

**Status**: **Not Viable** for Cloudflare Workers

### 4.2 Option B: Hybrid parquet-wasm + JS Executor

**Approach**:
1. Use `parquet-wasm` library (~1.2MB) to read Parquet
2. Convert to Arrow/JSON in JavaScript
3. Execute queries in TypeScript (extend current clickbench/executor.ts)

**Architecture**:
```
R2 Storage (partitioned Parquet)
    |
    v
parquet-wasm.readParquet()
    |
    v
Arrow RecordBatch (in WASM)
    |
    v
JavaScript Array conversion
    |
    v
TypeScript ClickBench Executor (enhanced)
    - WHERE filtering
    - GROUP BY aggregation
    - ORDER BY sorting
    - LIMIT/OFFSET
    |
    v
JSON Result
```

**Implementation Required**:
1. Integrate parquet-wasm as dependency
2. Add missing functions to JS executor:
   - LIKE pattern matching (regex)
   - DATE_TRUNC, EXTRACT
   - length(), REGEXP_REPLACE
   - HAVING clause support
3. Partition ClickBench data into smaller files
4. Implement column projection

**Pros**:
- Fits within 128MB memory
- Real data reading from R2
- Can be incrementally enhanced

**Cons**:
- JavaScript execution slower than native
- Requires data partitioning
- Manual function implementation

**Estimated Effort**: 2-3 weeks

### 4.3 Option C: Enhanced Minimal WASM + Storage Bridge

**Approach**: Extend `executor.wasm` with storage access via VFS callbacks.

**Architecture**:
```
R2 Storage
    |
    v
VFS Bridge (JavaScript)
    |
    v (via imported functions)
Enhanced executor.wasm
    - Parquet footer parsing
    - Column chunk reading
    - Aggregation
    |
    v
Result
```

**Implementation Required**:
1. Add VFS import functions to executor.wasm
2. Implement Parquet metadata parsing in C++
3. Add column chunk decoding
4. Extend SQL parser for missing features
5. Add date/string functions

**Pros**:
- Native WASM speed
- Reuses existing executor code
- Can be bundled into Workers

**Cons**:
- Significant C++ development
- Must implement Parquet format
- Testing complexity

**Estimated Effort**: 4-6 weeks

### 4.4 Option D: MergeTree Format with mergetree.wasm

**Approach**: Store ClickBench data as MergeTree parts in R2, use existing mergetree.wasm to read.

**Architecture**:
```
R2 Storage (MergeTree parts)
    |
    v
mergetree.wasm (291KB)
    |
    v
VFS Bridge callbacks
    |
    v
JavaScript aggregation (clickbench/executor.ts)
```

**Implementation Required**:
1. Convert ClickBench Parquet to MergeTree format
2. Complete column reading in MergeTreeLoader
3. Integrate with JS executor

**Pros**:
- MergeTree format optimized for analytics
- Column compression built-in
- Existing WASM module

**Cons**:
- Requires format conversion
- MergeTree reader incomplete
- Additional storage cost

**Estimated Effort**: 3-4 weeks

## 5. Recommendations

### 5.1 Short-term (1-2 weeks): JavaScript Executor Enhancement

**Goal**: Run simple ClickBench queries (Q0-Q6) against sample data.

**Tasks**:
1. Create sampled ClickBench dataset (10K rows) as JSON
2. Load into Memory engine via existing executor
3. Enhance JS executor with:
   - Proper WHERE clause evaluation
   - All aggregate functions

**Queries Achievable**: Q0-Q6 (6 of 43)

### 5.2 Medium-term (3-4 weeks): parquet-wasm Integration

**Goal**: Run medium complexity queries against partitioned Parquet.

**Tasks**:
1. Add parquet-wasm dependency
2. Create partitioned ClickBench files (by date)
3. Implement LIKE, date functions in JS
4. Add HAVING support

**Queries Achievable**: Q0-Q26 (27 of 43)

### 5.3 Long-term (6-8 weeks): Full WASM Implementation

**Goal**: Run all 43 ClickBench queries.

**Tasks**:
1. Implement Option C (enhanced WASM) or Option D (MergeTree)
2. Add REGEXP_REPLACE, CASE expressions
3. Optimize aggregation for large datasets
4. Add predicate pushdown

**Queries Achievable**: All 43

## 6. Data Preparation Strategy

### 6.1 Dataset Sizes for R2

| Sample Size | Rows | Estimated Size | Use Case |
|-------------|------|----------------|----------|
| Full | 100M | 16GB (parquet) | Reference only |
| 1% | 1M | 160MB | Too large for memory |
| 0.1% | 100K | 16MB | Development testing |
| 0.01% | 10K | 2MB | Unit tests, quick demos |

### 6.2 Partitioning Strategy

Partition by `EventDate` (spans 2013-07-01 to 2013-08-31):

```
r2://clickbench/
  hits_2013-07-01.parquet (~250MB)
  hits_2013-07-02.parquet (~250MB)
  ...
  hits_2013-08-31.parquet (~250MB)
```

Or by `CounterID` buckets for queries that filter on CounterID.

### 6.3 Column Projection

Most queries use subset of 105 columns. Create projection files:

```
r2://clickbench/projections/
  basic.parquet (WatchID, UserID, RegionID, CounterID, EventDate, EventTime)
  search.parquet (SearchPhrase, SearchEngineID, URL, Title)
  geo.parquet (RegionID, ClientIP, RemoteIP, BrowserCountry)
```

## 7. Performance Expectations

### 7.1 JavaScript Executor (Current)

| Operation | Rows/sec | Notes |
|-----------|----------|-------|
| COUNT(*) | 10M+ | Simple counter |
| GROUP BY (low cardinality) | 500K | Hash table |
| GROUP BY (high cardinality) | 50K | Memory pressure |
| String LIKE | 100K | Regex overhead |
| ORDER BY | 100K | Array.sort() |

### 7.2 Expected with parquet-wasm

| Operation | Rows/sec | Notes |
|-----------|----------|-------|
| Parquet scan | 1-5M | Depends on columns |
| Column projection | 5M+ | Skip unused columns |
| Predicate pushdown | 10M+ | Skip row groups |

### 7.3 Latency Targets

| Query Type | Target | Notes |
|------------|--------|-------|
| Simple aggregate (Q0-Q6) | <100ms | Sample data |
| Medium GROUP BY (Q7-Q17) | <500ms | Partitioned |
| Complex (Q18-Q42) | <2000ms | Multiple partitions |

## 8. Conclusion

Running real ClickBench queries through WASM is feasible but requires:

1. **Data partitioning**: Full dataset won't fit in 128MB memory
2. **Hybrid architecture**: parquet-wasm for I/O + JS/WASM for execution
3. **Feature completion**: Missing SQL functions in current executor

**Recommended Path**: Option B (parquet-wasm + JS) provides the best balance of:
- Time to implementation (2-3 weeks)
- Coverage (27 of 43 queries in medium term)
- Practical deployability (fits in Workers)

The full WASM executor (Option C/D) should be considered for long-term if JavaScript performance becomes a bottleneck.

## References

- `/packages/chdb-wasm/src/bundled-executor.ts` - Current bundled executor
- `/packages/chdb-wasm/src/chdb-backend.ts` - Full chdb WASM loader
- `/packages/chdb-wasm/src/clickbench/` - ClickBench schema and queries
- `/packages/chdb-wasm/wasm/executor_bindings.cpp` - WASM executor source
- `/packages/chdb-wasm/wasm/parquet_reader.cpp` - Parquet reader source
- `/packages/chdb-wasm/docs/spikes/spike-parquet-wasm.md` - Parquet spike
- [ClickBench GitHub](https://github.com/ClickHouse/ClickBench)
- [parquet-wasm](https://github.com/kylebarron/parquet-wasm)
