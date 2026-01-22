# Spike: Remote Parquet Query without Full Download

## Executive Summary

This spike investigates approaches for querying remote Parquet files (specifically the ClickBench `hits.parquet` at 14GB) without downloading the full file. The key enabler is HTTP Range requests, which allow reading specific byte ranges from a remote file.

**Key Finding**: Remote Parquet querying is technically feasible using HTTP Range requests to read the footer metadata first, then selectively fetch only needed column chunks and row groups. However, implementation complexity varies significantly by approach, and Cloudflare Workers has specific caveats around Range request caching.

**Recommended Approach**: Use the partitioned dataset (`hits_0.parquet` through `hits_99.parquet` at ~140MB each) rather than the single 14GB file, combined with column pruning and JavaScript-based Parquet readers like hyparquet.

## 1. Source URLs

### Primary Dataset
- **Single file**: `https://datasets.clickhouse.com/hits_compatible/hits.parquet` (~14GB)
- **Partitioned**: `https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_{0..99}.parquet` (100 files, ~140MB each)

### Alternative Formats
- CSV: `https://datasets.clickhouse.com/hits_compatible/hits.csv.gz`
- TSV: `https://datasets.clickhouse.com/hits_compatible/hits.tsv.gz`
- JSON: `https://datasets.clickhouse.com/hits_compatible/hits.json.gz`

## 2. ClickHouse URL Table Function

### 2.1 How It Works

ClickHouse supports querying remote Parquet files via the `url()` table function:

```sql
SELECT count(*)
FROM url('https://datasets.clickhouse.com/hits_compatible/hits.parquet', 'Parquet')
```

When querying remote Parquet:
1. ClickHouse first issues a HEAD request to get `Content-Length`
2. Reads the Parquet footer (last 8 bytes + metadata) via Range request
3. Parses schema and row group offsets from metadata
4. For each required column, fetches only needed chunks via Range requests

### 2.2 HTTP Request Behavior

From [ClickHouse GitHub Issue #49028](https://github.com/ClickHouse/ClickHouse/issues/49028):

> Currently, ClickHouse makes two HTTP requests during SELECT data from engine=URL() and url() table function: first a HEAD request to receive Content-Length header and decide to allow parallel download, and second a GET request.

For some endpoints, this HEAD request may not be supported. A `make_head_request=0` setting was proposed.

### 2.3 Parallel Processing

ClickHouse can parallelize Parquet processing across CPU cores when reading locally. For remote files, parallel range requests can be used:

```sql
SET max_download_threads = 4;
SELECT * FROM url('...hits.parquet', 'Parquet') WHERE condition;
```

### 2.4 Limitations

- **Memory**: Still needs to decompress row groups into memory
- **Full scan queries**: `SELECT count(*)` can use metadata, but most queries need data
- **Large files**: The 14GB file may timeout or exceed limits

## 3. HTTP Range Requests for Parquet

### 3.1 Parquet File Structure

```
[Row Group 0]
  [Column 0 Chunk] [Column 1 Chunk] ... [Column N Chunk]
[Row Group 1]
  ...
[Row Group N]
[Footer Metadata]      <-- Schema, row group offsets, column statistics
[Footer Length: 4 bytes]
[Magic "PAR1": 4 bytes]
```

### 3.2 Reading Strategy

**Step 1: Read footer size (last 8 bytes)**
```
Range: bytes=-8
```

**Step 2: Read footer metadata**
```
footer_offset = file_size - 8 - footer_length
Range: bytes={footer_offset}-{file_size}
```

**Step 3: Parse metadata to get column chunk offsets**

**Step 4: Read only needed column chunks**
```
Range: bytes={chunk_offset}-{chunk_offset + chunk_size}
```

### 3.3 Benefits

| Query Type | Without Range | With Range |
|------------|---------------|------------|
| `SELECT count(*)` | 14GB | ~1KB (metadata only) |
| `SELECT avg(col1)` | 14GB | ~200MB (single column) |
| `SELECT * LIMIT 100` | 14GB | ~100MB (first row group) |
| `SELECT * WHERE date = '2023-01-01'` | 14GB | ~500MB (filtered row groups) |

### 3.4 Server Requirements

The remote server must support:
- `Accept-Ranges: bytes` header
- `Content-Length` header
- Responding to `Range` requests with `206 Partial Content`

The ClickHouse datasets server supports all of these.

## 4. chdb Remote Parquet Support

### 4.1 S3 Table Function

chdb supports the `s3()` table function for remote files:

```python
import chdb

result = chdb.query("""
    SELECT count(*)
    FROM s3('https://datasets.clickhouse.com/hits_compatible/hits.parquet')
""")
```

### 4.2 URL Table Function

For non-S3 HTTP URLs:

```python
result = chdb.query("""
    SELECT count(*)
    FROM url('https://example.com/data.parquet', 'Parquet')
""")
```

### 4.3 Column Projection

chdb pushes column selection down to the Parquet reader:

```python
# Only reads UserID and EventDate columns
result = chdb.query("""
    SELECT UserID, EventDate
    FROM s3('https://datasets.clickhouse.com/hits_compatible/hits.parquet')
    LIMIT 1000
""")
```

### 4.4 WASM Considerations

For chdb-wasm, remote file access depends on:
- Available network APIs (fetch in Workers)
- Memory constraints (128MB limit)
- Single-threaded execution

Native chdb can handle larger files; WASM requires careful memory management.

## 5. Cloudflare Workers Approach

### 5.1 Basic Fetch with Range Headers

```typescript
async function readParquetFooter(url: string): Promise<ArrayBuffer> {
  // First, get file size
  const headResponse = await fetch(url, { method: 'HEAD' });
  const fileSize = parseInt(headResponse.headers.get('content-length') || '0');

  // Read last 8 bytes to get footer length
  const footerSizeResponse = await fetch(url, {
    headers: { 'Range': `bytes=${fileSize - 8}-${fileSize - 1}` }
  });
  const footerSizeBuffer = await footerSizeResponse.arrayBuffer();
  const footerLength = new DataView(footerSizeBuffer).getInt32(0, true);

  // Read full footer
  const footerStart = fileSize - 8 - footerLength;
  const footerResponse = await fetch(url, {
    headers: { 'Range': `bytes=${footerStart}-${fileSize - 1}` }
  });
  return footerResponse.arrayBuffer();
}
```

### 5.2 Caching Caveats

From [Cloudflare Community](https://community.cloudflare.com/t/range-requests-and-the-cache-api/263252):

> When a client specifies the Range header in a request for a cacheable resource, Cloudflare fetches the entire resource and serves the specified range.

**Key issues**:
- First Range request may return full file before caching completes
- Cache API cannot store partial responses (206 status)
- Workaround: Use `cf: { cacheEverything: false }` to bypass cache for initial requests

```typescript
const response = await fetch(url, {
  headers: { 'Range': `bytes=0-1000` },
  cf: { cacheEverything: false }  // Bypass Cloudflare cache
});
```

### 5.3 R2 Direct Access

For files stored in R2, use native range requests:

```typescript
async function readFromR2(bucket: R2Bucket, key: string, offset: number, length: number) {
  const object = await bucket.get(key, {
    range: { offset, length }
  });
  return object?.arrayBuffer();
}
```

R2 range requests are more reliable than external HTTP range requests.

### 5.4 Memory Constraints

Cloudflare Workers have a 128MB memory limit. For the 14GB hits.parquet:

| Component | Memory |
|-----------|--------|
| Worker runtime | ~10MB |
| WASM module | ~25-45MB |
| Decompressed row group | ~100-500MB |
| **Problem** | Exceeds limit |

**Conclusion**: Cannot query full 14GB file in Workers. Must use partitioned files or pre-aggregated data.

## 6. JavaScript Parquet Readers

### 6.1 hyparquet

[hyparquet](https://github.com/hyparam/hyparquet) is a pure JavaScript Parquet reader designed for browser use:

```typescript
import { parquetMetadataAsync, parquetRead } from 'hyparquet';

// Read metadata only (very fast)
const file = await asyncBufferFromUrl('https://example.com/data.parquet');
const metadata = await parquetMetadataAsync(file);
console.log(metadata.num_rows, metadata.row_groups.length);

// Read specific columns/rows
const data = await parquetRead({
  file,
  columns: ['UserID', 'EventDate'],
  rowStart: 0,
  rowEnd: 1000
});
```

**Pros**:
- Zero dependencies (9.2KB minified+gzipped)
- HTTP Range requests built-in via `asyncBufferFromUrl`
- Supports all Parquet encodings and compression codecs
- TypeScript definitions included

**Cons**:
- Read-only (no writing)
- Still requires decompression in memory

### 6.2 parquet-wasm

[parquet-wasm](https://github.com/kylebarron/parquet-wasm) is a Rust-based Parquet library compiled to WASM:

```typescript
import { readParquet } from 'parquet-wasm';

const asyncReader = {
  async read(offset: number, length: number): Promise<Uint8Array> {
    const response = await fetch(url, {
      headers: { 'Range': `bytes=${offset}-${offset + length - 1}` }
    });
    return new Uint8Array(await response.arrayBuffer());
  },
  async size(): Promise<number> {
    const head = await fetch(url, { method: 'HEAD' });
    return parseInt(head.headers.get('content-length') || '0');
  }
};

const table = await readParquet(asyncReader, {
  columns: ['UserID', 'CounterID'],
  rowGroups: [0, 1]  // Only first 2 row groups
});
```

**Pros**:
- Fast decompression (native WASM)
- Arrow-native output
- Supports custom async readers

**Cons**:
- Larger bundle (~1.2MB full, ~456KB read-only)
- More complex setup

### 6.3 DuckDB-WASM

[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) can query remote Parquet:

```typescript
import * as duckdb from '@duckdb/duckdb-wasm';

const conn = await duckdb.connect();
const result = await conn.query(`
  SELECT count(*)
  FROM read_parquet('https://datasets.clickhouse.com/hits_compatible/hits.parquet')
`);
```

DuckDB uses HTTP Range requests automatically for remote Parquet files.

**Pros**:
- Full SQL support
- Automatic query optimization with predicate pushdown
- Can skip row groups based on statistics

**Cons**:
- Large bundle (~35MB)
- May still load too much data for complex queries
- Known issues with some S3 pre-signed URLs

## 7. Smaller ClickBench Subsets

### 7.1 Available Partitioned Files

The official ClickBench provides 100 partitioned files:

```
https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_0.parquet
https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_1.parquet
...
https://datasets.clickhouse.com/hits_compatible/athena_partitioned/hits_99.parquet
```

Each file is ~140MB with ~1M rows (1% of full dataset).

### 7.2 Recommended Subset Strategy

For Cloudflare Workers with 128MB memory:

| Subset Size | File | Compressed | Uncompressed | Feasibility |
|-------------|------|------------|--------------|-------------|
| 1M rows | `hits_0.parquet` | ~140MB | ~1.1GB | Too large |
| 100K rows | Custom | ~14MB | ~110MB | Borderline |
| 50K rows | Custom | ~7MB | ~55MB | Safe |
| 10K rows | Custom | ~1.4MB | ~11MB | Easy |

**Recommendation**: Create a custom 50K row subset with column partitioning.

### 7.3 Creating Custom Subsets

Using DuckDB or ClickHouse:

```sql
-- Create 50K row micro subset
COPY (
  SELECT * FROM read_parquet('hits_0.parquet')
  ORDER BY rand()
  LIMIT 50000
) TO 'hits_50k.parquet' (FORMAT PARQUET);

-- Create column-specific subsets
COPY (
  SELECT UserID, CounterID, EventDate, EventTime
  FROM read_parquet('hits_0.parquet')
) TO 'hits_core_columns.parquet' (FORMAT PARQUET);
```

### 7.4 Column-Partitioned Files

As detailed in [spike-clickbench-data-strategy.md](./spike-clickbench-data-strategy.md):

```
r2://clickbench-data/partitioned/
  core.parquet           # 5 cols, ~15MB
  numeric.parquet        # 30 cols, ~25MB
  strings_small.parquet  # 10 cols, ~15MB
  strings_url.parquet    # 3 cols, ~60MB
  strings_search.parquet # 1 col, ~20MB
```

## 8. Practical Implementation for Workers

### 8.1 Architecture

```
                                   +-----------------+
                                   |  R2 Storage     |
                                   |  (partitioned   |
                                   |   parquet)      |
                                   +-----------------+
                                          |
                                          | Range requests
                                          v
+-------------+    HTTP    +--------------------------+
|   Client    | ---------> |   Cloudflare Worker      |
+-------------+            |                          |
                           |  1. Parse SQL query      |
                           |  2. Identify columns     |
                           |  3. Fetch from R2        |
                           |  4. Execute with chdb    |
                           |  5. Return results       |
                           +--------------------------+
```

### 8.2 Recommended Stack

1. **Data Storage**: R2 with column-partitioned Parquet files
2. **Parquet Reader**: hyparquet (lightweight, browser-native)
3. **SQL Engine**: chdb-wasm for complex queries
4. **Memory Strategy**: Load only required columns per query

### 8.3 Example Implementation

```typescript
import { parquetMetadataAsync, parquetRead } from 'hyparquet';
import { asyncBufferFromUrl } from 'hyparquet';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const columns = url.searchParams.get('columns')?.split(',') || [];

    // Determine which partition file(s) to load based on columns
    const files = mapColumnsToFiles(columns);

    // Load data from R2 with range requests
    const data = await Promise.all(
      files.map(async (file) => {
        const buffer = await asyncBufferFromR2(env.DATA_BUCKET, file);
        return parquetRead({
          file: buffer,
          columns: columns.filter(c => fileContainsColumn(file, c))
        });
      })
    );

    // Execute query on loaded data
    const result = await executeQuery(data, url.searchParams.get('sql'));

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

## 9. Conclusion and Recommendations

### 9.1 Can We Query Remote Parquet via URL Function?

**Yes**, with caveats:
- ClickHouse and chdb support `url()` and `s3()` table functions
- HTTP Range requests enable partial reads
- Memory limits are the primary constraint in Workers

### 9.2 Does It Work with Range Requests?

**Yes**, for servers that support it:
- ClickHouse datasets server supports Range requests
- Footer can be read with ~10KB of data
- Column chunks can be selectively fetched
- R2 has native range request support

### 9.3 Cloudflare Workers Feasibility

**Partially feasible**:
- Cannot query 14GB file directly (memory limit)
- Can query partitioned files (~140MB each) with column pruning
- Best approach: Pre-partition data in R2, use hyparquet for reading

### 9.4 Recommended Next Steps

1. **Immediate**: Use partitioned dataset (`hits_0.parquet` to `hits_99.parquet`)
2. **Short-term**: Create custom column-partitioned subsets in R2
3. **Medium-term**: Implement streaming query execution with row group iteration
4. **Long-term**: Explore Parquet + WebAssembly decompression optimization

### 9.5 Decision Matrix

| Approach | Complexity | Memory Usage | Query Speed | Recommendation |
|----------|------------|--------------|-------------|----------------|
| Full 14GB file | Low | Exceeds limit | N/A | Not viable |
| Partitioned files (140MB) | Medium | High | Medium | Development only |
| Column-partitioned (20-60MB) | High | Medium | Fast | Production |
| Pre-aggregated subsets | High | Low | Very fast | Best for benchmarks |

## References

- [ClickHouse URL Table Function](https://clickhouse.com/docs/en/sql-reference/table-functions/url)
- [chdb Querying S3 Guide](https://clickhouse.com/docs/chdb/guides/querying-s3)
- [hyparquet GitHub](https://github.com/hyparam/hyparquet)
- [parquet-wasm](https://github.com/kylebarron/parquet-wasm)
- [DuckDB-WASM HTTP Import](https://duckdb.org/docs/stable/guides/network_cloud_storage/http_import)
- [Cloudflare Workers Range Requests](https://community.cloudflare.com/t/how-do-http-range-requests-work-with-workers/263031)
- [Parquet Format Specification](https://parquet.apache.org/docs/)
- [Hyparquet Blog: Quest for Instant Data](https://blog.hyperparam.app/2025/07/24/quest-for-instant-data/)
- [ClickBench GitHub](https://github.com/ClickHouse/ClickBench)
- [spike-parquet-wasm.md](./spike-parquet-wasm.md)
- [spike-clickbench-data-strategy.md](./spike-clickbench-data-strategy.md)
