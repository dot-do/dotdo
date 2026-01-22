# Spike: ClickBench Data Strategy for Cloudflare Workers

## Executive Summary

This spike investigates strategies for running ClickBench benchmarks within Cloudflare Workers' 128MB memory constraint. The full hits.parquet file is approximately 14GB compressed with 100M rows and 105 columns - far exceeding what can fit in memory.

**Key Finding**: A tiered approach combining row sampling (1M row subset), column projection (per-query loading), and R2 range request streaming can enable meaningful ClickBench benchmarks within the memory constraints.

**Recommended Strategy**: Use a 1M row subset (~140MB compressed) partitioned by query column requirements into ~15 column-grouped Parquet files, each under 20MB, loaded on-demand via R2 range requests.

## 1. Current Constraints Analysis

### 1.1 Cloudflare Workers Memory Limit

Per [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/platform/limits/):
- **Hard limit**: 128MB per isolate (includes JS heap + WASM memory)
- **Practical limit**: ~50-65MB for query data after accounting for:
  - V8 runtime overhead: ~10MB
  - Worker script and dependencies: ~3-5MB
  - WASM module instance: ~25-45MB (varies by profile)
  - Safety margin: ~10MB

### 1.2 ClickBench Dataset Characteristics

From `benchmarks/clickbench-schema.sql`:

| Metric | Value |
|--------|-------|
| Total rows | 99,997,497 (~100M) |
| Columns | 105 |
| Compressed size (Parquet) | ~14GB |
| Uncompressed estimate | ~70GB |
| Date range | 2013-07-01 to 2013-07-31 (1 month) |

### 1.3 Partitioned Data Available

The official ClickBench provides [partitioned Parquet files](https://datasets.clickhouse.com/hits_compatible/athena_partitioned/):
- 100 files: `hits_0.parquet` through `hits_99.parquet`
- Each file: ~140MB compressed, ~1M rows
- Total: ~14GB (same as single file)

## 2. Memory Budget Analysis

### 2.1 Per-Row Memory Estimate

Based on column types from `src/clickbench/schema.ts`:

| Column Type | Count | Avg Size (bytes) | Total per Row |
|-------------|-------|------------------|---------------|
| UInt8 | 32 | 1 | 32 |
| UInt16 | 16 | 2 | 32 |
| UInt32 | 17 | 4 | 68 |
| UInt64 | 5 | 8 | 40 |
| Int8 | 2 | 1 | 2 |
| Int16 | 4 | 2 | 8 |
| Int32 | 6 | 4 | 24 |
| Int64 | 1 | 8 | 8 |
| DateTime | 4 | 8 | 32 |
| Date | 1 | 4 | 4 |
| String (avg) | 17 | ~50 | ~850 |
| **Total** | 105 | - | **~1,100 bytes** |

### 2.2 Row Count Feasibility

With 50MB available for query data:

| Row Count | Memory Required | Feasibility |
|-----------|-----------------|-------------|
| 10K | ~11MB | Easy |
| 100K | ~110MB | Exceeds limit |
| 50K | ~55MB | Borderline |
| 45K | ~50MB | Safe with buffer |
| 1M (compressed) | ~140MB Parquet | Requires streaming |

**Observation**: Even 100K rows fully decompressed exceeds memory limits. Column pruning is essential.

### 2.3 Column Pruning Impact

Most ClickBench queries access only 2-8 columns. From `src/clickbench/queries.ts`:

| Query | Columns Used | Est. Per-Row Size |
|-------|--------------|-------------------|
| Q0 | (none - COUNT) | 0 bytes |
| Q1 | AdvEngineID | 1 byte |
| Q2 | AdvEngineID, ResolutionWidth | 3 bytes |
| Q4 | UserID | 8 bytes |
| Q20 | URL | ~100 bytes |
| Q33 | URL | ~100 bytes |
| Q23 | ALL (SELECT *) | ~1,100 bytes |

With column pruning, most queries can handle significantly more rows:

| Columns Loaded | Bytes/Row | Max Rows (50MB) |
|----------------|-----------|-----------------|
| 1 numeric | 4 | 12.5M |
| 3 numeric | 12 | 4.2M |
| 1 string (URL) | 100 | 500K |
| 5 mixed | 50 | 1M |
| All 105 | 1,100 | 45K |

## 3. Data Subset Strategies

### 3.1 Option A: Fixed Row Subset (1M Rows)

Use the first partition file `hits_0.parquet`:
- **Size**: ~140MB compressed
- **Rows**: ~1M (1% of full dataset)
- **Pros**: Simple, already available, statistically representative
- **Cons**: Still too large for single load, query results differ from full benchmark

### 3.2 Option B: Micro Subset (50K Rows)

Create a custom subset:
```sql
COPY (
  SELECT * FROM read_parquet('hits.parquet')
  LIMIT 50000
) TO 'hits_micro.parquet' (FORMAT PARQUET);
```
- **Size**: ~7-10MB compressed
- **Rows**: 50K
- **Pros**: Fits in memory with all columns
- **Cons**: Very small sample, may miss data patterns

### 3.3 Option C: Column-Partitioned Files

Split data by column groups based on query requirements:

```
hits_core.parquet       - WatchID, EventTime, EventDate, CounterID, UserID (~5 cols, 1M rows) - ~15MB
hits_search.parquet     - SearchPhrase, SearchEngineID (~2 cols) - ~8MB
hits_url.parquet        - URL, URLHash, Referer, RefererHash (~4 cols) - ~60MB (string-heavy)
hits_device.parquet     - OS, UserAgent, Resolution*, IsMobile, etc. (~15 cols) - ~12MB
hits_traffic.parquet    - TraficSourceID, AdvEngineID, etc. (~10 cols) - ~8MB
hits_client.parquet     - ClientIP, RegionID, ClientTimeZone, etc. (~10 cols) - ~10MB
hits_metrics.parquet    - All timing and performance columns (~15 cols) - ~12MB
hits_utm.parquet        - UTM*, Openstat* columns (~10 cols) - ~5MB
hits_misc.parquet       - Remaining columns (~30 cols) - ~15MB
```

**Pros**: Load only needed columns, each file fits in memory
**Cons**: Complex query routing, JOIN overhead for multi-group queries

### 3.4 Option D: Hybrid (Recommended)

Combine row sampling with column partitioning:

1. **Base subset**: 1M rows (same as partition 0)
2. **Partitioned by query type**:
   - `hits_1m_agg.parquet` - Columns for aggregate queries (Q0-Q6, Q29)
   - `hits_1m_group.parquet` - Columns for GROUP BY queries (Q7-Q18, Q30-Q35)
   - `hits_1m_string.parquet` - String columns for LIKE queries (Q20-Q28)
   - `hits_1m_counter62.parquet` - Columns for Counter 62 queries (Q36-Q42)

## 4. Per-Query Column Analysis

### 4.1 Column Usage Summary

Extracted from `src/clickbench/queries.ts`:

```
Most Used Columns (by query count):
- UserID: 12 queries
- SearchPhrase: 9 queries
- CounterID: 8 queries
- EventDate: 7 queries
- URL: 7 queries
- ResolutionWidth: 5 queries
- IsRefresh: 5 queries
- AdvEngineID: 4 queries
```

### 4.2 Column Groups by Query

**Group 1: Simple Aggregates (Q0, Q1, Q2, Q3, Q6, Q29)**
```
Columns: AdvEngineID, ResolutionWidth, UserID, EventDate
Est. size: ~15 bytes/row
1M rows: ~15MB
```

**Group 2: COUNT DISTINCT (Q4, Q5)**
```
Columns: UserID, SearchPhrase
Est. size: ~58 bytes/row (UserID=8, SearchPhrase=50 avg)
1M rows: ~55MB
```

**Group 3: Low Cardinality GROUP BY (Q7, Q8, Q9, Q10, Q11)**
```
Columns: AdvEngineID, RegionID, UserID, ResolutionWidth, MobilePhone, MobilePhoneModel
Est. size: ~65 bytes/row
1M rows: ~62MB (borderline)
```

**Group 4: High Cardinality GROUP BY (Q12-Q18, Q30-Q35)**
```
Columns: SearchPhrase, SearchEngineID, UserID, EventTime, ClientIP, WatchID, URL
Est. size: ~200 bytes/row
1M rows: ~190MB (too large, needs streaming or smaller subset)
```

**Group 5: String Filters/LIKE (Q20-Q28)**
```
Columns: URL, Referer, Title, SearchPhrase, CounterID
Est. size: ~250 bytes/row
1M rows: ~240MB (too large)
```

**Group 6: Counter 62 Queries (Q36-Q42)**
```
Columns: CounterID, EventDate, EventTime, URL, Title, DontCountHits, IsRefresh,
         IsLink, IsDownload, TraficSourceID, SearchEngineID, AdvEngineID,
         Referer, URLHash, RefererHash, WindowClient*, URLHash
Est. size: ~180 bytes/row
1M rows: ~170MB (too large)
```

## 5. R2 Streaming Strategy

### 5.1 Range Request Capabilities

Per [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/):

```typescript
const obj = await bucket.get(key, {
  range: { offset: 1000, length: 5000 }
});
```

- Supports byte-range requests
- No limit on range size
- Can read Parquet footer (last 8 bytes + metadata) first
- Enables selective row group and column chunk access

### 5.2 Parquet Structure for Streaming

Parquet file layout:
```
[Row Group 0]
  [Column 0 Chunk] [Column 1 Chunk] ... [Column N Chunk]
[Row Group 1]
  ...
[Footer Metadata]
[Footer Length (4 bytes)]
[Magic "PAR1" (4 bytes)]
```

Streaming approach:
1. Read footer (last 8 bytes to get footer length)
2. Read footer metadata (schema, row groups, column offsets)
3. For each required column, read only needed chunks via range requests

### 5.3 Implementation with parquet-wasm

From `spike-parquet-wasm.md`, parquet-wasm supports:
- Custom read implementations
- Column projection at read time
- Row group filtering

```typescript
import { readParquet, ParquetFile } from 'parquet-wasm';

// Custom async reader for R2
const asyncReader = {
  async read(offset: number, length: number): Promise<Uint8Array> {
    const obj = await bucket.get(key, { range: { offset, length } });
    return new Uint8Array(await obj.arrayBuffer());
  },
  async size(): Promise<number> {
    const head = await bucket.head(key);
    return head.size;
  }
};

// Read with column projection
const table = await readParquet(asyncReader, {
  columns: ['UserID', 'CounterID', 'EventDate'],
  rowGroups: [0, 1, 2] // Only first 3 row groups
});
```

## 6. Recommended Data Layout

### 6.1 Directory Structure in R2

```
r2://clickbench-data/
  metadata.json                  # Schema, statistics, query mappings

  # Full 1M row subset (for development)
  subset/
    hits_1m.parquet              # All columns, 1M rows (~140MB)

  # Column-partitioned files (for production)
  partitioned/
    core.parquet                 # Core identifiers (5 cols, ~15MB)
    numeric.parquet              # All numeric columns (30 cols, ~25MB)
    strings_small.parquet        # Small strings (10 cols, ~15MB)
    strings_url.parquet          # URL, Referer, OriginalURL (3 cols, ~60MB)
    strings_search.parquet       # SearchPhrase only (1 col, ~20MB)
    strings_title.parquet        # Title only (1 col, ~15MB)

  # Pre-computed for specific queries
  precomputed/
    q36_42_counter62.parquet     # Filtered to CounterID=62 (~100KB)
```

### 6.2 Metadata File

```json
{
  "version": "1.0.0",
  "totalRows": 1000000,
  "sourceFile": "hits_0.parquet",
  "files": {
    "core.parquet": {
      "columns": ["WatchID", "EventTime", "EventDate", "CounterID", "UserID"],
      "size": 15728640,
      "rowGroups": 10
    },
    "strings_url.parquet": {
      "columns": ["URL", "Referer", "OriginalURL", "URLHash", "RefererHash"],
      "size": 62914560,
      "rowGroups": 10
    }
  },
  "queryMappings": {
    "Q0": ["core.parquet"],
    "Q1": ["core.parquet", "numeric.parquet"],
    "Q20": ["strings_url.parquet"],
    "Q33": ["strings_url.parquet"]
  }
}
```

### 6.3 Size Estimates

| File | Columns | Est. Size | Fits in Memory |
|------|---------|-----------|----------------|
| core.parquet | 5 | ~15MB | Yes |
| numeric.parquet | 30 | ~25MB | Yes |
| strings_small.parquet | 10 | ~15MB | Yes |
| strings_url.parquet | 3 | ~60MB | Borderline |
| strings_search.parquet | 1 | ~20MB | Yes |
| strings_title.parquet | 1 | ~15MB | Yes |
| **Total** | 50+ | ~150MB | Via streaming |

## 7. Query Execution Strategy

### 7.1 Query Classification

Based on memory requirements:

**Tier 1 - In-Memory (< 30MB loaded)**
- Q0, Q1, Q2, Q3, Q6, Q29 (simple aggregates)
- Q7 (small GROUP BY)
- Q19 (point lookup)
- Load relevant files entirely, execute in WASM

**Tier 2 - Partial Load (30-60MB)**
- Q4, Q5 (COUNT DISTINCT on single column)
- Q8, Q9 (GROUP BY with few columns)
- Q12-Q14 (SearchPhrase grouping)
- Load columns incrementally, stream if needed

**Tier 3 - Streaming Required (> 60MB)**
- Q20-Q28 (string LIKE queries)
- Q30-Q35 (high cardinality GROUP BY)
- Q33, Q34 (URL grouping)
- Stream via row groups, accumulate results

**Tier 4 - Pre-filtered (Counter 62 subset)**
- Q36-Q42 (all filter to CounterID=62)
- Use pre-filtered parquet file (~100KB)
- Load entirely, execute in WASM

### 7.2 Execution Flow

```typescript
async function executeClickBenchQuery(queryId: number): Promise<QueryResult> {
  const query = CLICKBENCH_QUERIES[queryId];
  const tier = classifyQuery(queryId);

  switch (tier) {
    case 1:
      return executeInMemory(query);
    case 2:
      return executePartialLoad(query);
    case 3:
      return executeStreaming(query);
    case 4:
      return executePrefiltered(query);
  }
}

async function executeInMemory(query: ClickBenchQuery): Promise<QueryResult> {
  // Load required files
  const files = getRequiredFiles(query.columns);
  const data = await Promise.all(files.map(loadParquetFile));

  // Execute in WASM/DuckDB
  const result = await chdb.query(query.sql);
  return result;
}

async function executeStreaming(query: ClickBenchQuery): Promise<QueryResult> {
  // Get file metadata
  const meta = await getParquetMetadata(query);

  // Process row groups one at a time
  let accumulator = createAccumulator(query);

  for (const rowGroup of meta.rowGroups) {
    const chunk = await loadRowGroup(rowGroup, query.columns);
    accumulator = updateAccumulator(accumulator, chunk, query);
    chunk.free(); // Release memory
  }

  return finalizeResult(accumulator, query);
}
```

## 8. Implementation Roadmap

### Phase 1: Data Preparation (Week 1)

1. **Download subset**
   ```bash
   ./scripts/download-clickbench.sh subset
   # Downloads hits_0.parquet (~140MB)
   ```

2. **Create column partitions**
   ```bash
   npx tsx scripts/prepare-clickbench.ts \
     --input data/clickbench/hits_subset.parquet \
     --output data/clickbench/partitioned \
     --partition-by-columns
   ```

3. **Generate metadata**
   ```bash
   npx tsx scripts/generate-clickbench-metadata.ts
   ```

4. **Upload to R2**
   ```bash
   wrangler r2 object put clickbench-data/partitioned/ \
     --file data/clickbench/partitioned/
   ```

### Phase 2: Query Router (Week 2)

1. Implement query classification
2. Map queries to required files
3. Build file loading logic with caching
4. Add memory pressure detection

### Phase 3: Streaming Executor (Week 3)

1. Implement row group streaming
2. Add accumulator patterns for aggregates
3. Handle GROUP BY with bounded memory
4. Add prefetching for sequential access

### Phase 4: Benchmarking (Week 4)

1. Run all 43 queries against subset
2. Compare results with full dataset benchmarks
3. Measure latency and memory usage
4. Document limitations and trade-offs

## 9. Trade-offs and Limitations

### 9.1 Statistical Accuracy

| Aspect | Full Dataset | 1M Subset |
|--------|--------------|-----------|
| COUNT(*) | 99,997,497 | ~1,000,000 |
| COUNT(DISTINCT UserID) | ~17.6M | ~200K |
| SearchPhrase patterns | Full | Representative |
| Counter 62 data | ~2M rows | ~20K rows |

**Mitigation**: Document that subset results are for performance benchmarking, not statistical accuracy.

### 9.2 Query Compatibility

Some queries may behave differently:
- **Q27, Q28**: HAVING clauses with thresholds may return fewer results
- **Q38-Q42**: OFFSET 1000+ may exceed subset size
- **Counter 62 queries**: May have no data if CounterID=62 not in subset

**Mitigation**: Create Counter 62-specific subset, adjust OFFSET for subset size.

### 9.3 Performance Characteristics

| Metric | Full Dataset | Subset |
|--------|--------------|--------|
| Cold start | N/A (too large) | 1-3s |
| Simple aggregates | Reference | 10-50ms |
| GROUP BY (low card) | Reference | 50-200ms |
| GROUP BY (high card) | Reference | 200-500ms |
| String LIKE | Reference | 100-500ms |

## 10. Conclusion

Running ClickBench on Cloudflare Workers is feasible with these strategies:

1. **Use 1M row subset** (hits_0.parquet) as base data
2. **Partition by column groups** to keep files under 60MB
3. **Classify queries** into tiers based on memory requirements
4. **Stream large queries** via row group iteration
5. **Pre-filter Counter 62 data** for Q36-Q42

The recommended approach balances:
- **Accuracy**: 1M rows is statistically representative
- **Performance**: Column pruning enables most queries in-memory
- **Compatibility**: All 43 queries can execute with adjustments
- **Complexity**: Moderate implementation effort

### Next Steps

1. Run `scripts/download-clickbench.sh subset` to get base data
2. Create `scripts/partition-clickbench.ts` for column splitting
3. Implement query router in `src/clickbench/executor.ts`
4. Add streaming support in `src/clickbench/streaming.ts`
5. Benchmark and iterate

## References

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [R2 Range Requests](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [ClickBench Repository](https://github.com/ClickHouse/ClickBench)
- [parquet-wasm](https://github.com/kylebarron/parquet-wasm)
- [Parquet Pruning in DataFusion](https://datafusion.apache.org/blog/2025/03/20/parquet-pruning/)
- [DuckDB-WASM Cloudflare Discussion](https://github.com/duckdb/duckdb-wasm/discussions/430)
- [spike-parquet-wasm.md](./spike-parquet-wasm.md)
- [spike-5-r2-virtual-memory.md](./spike-5-r2-virtual-memory.md)
