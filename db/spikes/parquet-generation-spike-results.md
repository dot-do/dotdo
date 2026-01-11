# Parquet Generation in Edge Environments - Spike Results

**Issue:** dotdo-2cmd6
**Date:** 2026-01-11
**Author:** Claude Opus 4.5

## Executive Summary

After evaluating five options for generating Parquet files in Cloudflare Workers:

**Recommendation: Option B (parquet-wasm)** - Already integrated, proven performance, Worker-compatible.

## Options Evaluated

| Option | Name | Bundle Size | Worker Compatible | Streaming | Verdict |
|--------|------|-------------|-------------------|-----------|---------|
| A | DuckDB WASM | ~4.5 MB | No | No | Blocked by Service Worker API |
| B | parquet-wasm | ~1.2 MB | Yes | Yes | **Recommended** |
| C | Arrow JS + parquet-wasm | ~1.4 MB | Yes | Yes | Same as B, explicit schemas |
| D | hyparquet-writer | ~20 KB | Yes | No | Limited compression (Snappy only) |
| E | External Service | 0 KB | Yes | Yes | Adds latency + infrastructure |

## Detailed Analysis

### Option A: DuckDB WASM

**Pros:**
- Full SQL support including `COPY TO` with all Parquet options
- Already integrated via `@dotdo/duckdb-worker`
- Excellent for complex transformations before export

**Cons:**
- **Blocked for Workers**: Requires synchronous XHR for filesystem, not available in Workers
- Large WASM binary (~4.5 MB compressed)
- High memory overhead (4GB limit in browser, less in Workers)

**GitHub Discussion:** [duckdb/duckdb-wasm#430](https://github.com/duckdb/duckdb-wasm/discussions/430)
> "The biggest limitation with Cloudflare Workers is the fact that Cloudflare only implements the Service Worker API. This hinders the use of synchronous XHRs that are a strong prerequisite for DuckDB WASM's web filesystem."

**Verdict:** Not viable for direct Parquet generation in Workers.

---

### Option B: parquet-wasm (RECOMMENDED)

**Pros:**
- High-performance Rust-based WASM (compiled from Apache arrow-rs)
- Reasonable bundle size (1.2 MB with all codecs, 456 KB minimal)
- Full compression support: ZSTD, Snappy, Gzip, Brotli, LZ4
- Streaming API via `transformParquetStream`
- Works in Cloudflare Workers with proper WASM loading
- **Already integrated** in this codebase (`parquet-wasm@0.7.1`)

**Cons:**
- Requires Apache Arrow for data preparation
- WASM initialization overhead (~400-500ms first call)

**Bundle Sizes:**
- Full build (all codecs): **1.2 MB** brotli-compressed
- Minimal (read-only, no compression): **456 KB** brotli-compressed
- Custom builds available via Rust feature flags

**Reference:** [kylebarron/parquet-wasm](https://github.com/kylebarron/parquet-wasm)

**Verdict:** Best balance of performance, features, and Worker compatibility.

---

### Option C: Apache Arrow JS + parquet-wasm

**Pros:**
- Same as Option B with explicit Arrow schema definitions
- Better for complex nested types (FixedSizeList, Struct, etc.)
- Arrow JS provides schema validation and type inference

**Cons:**
- Slightly larger bundle (~200 KB for Arrow JS)
- Same WASM dependency as Option B

**Usage:**
```typescript
import { Schema, Field, Utf8, Float64 } from 'apache-arrow'

const schema = new Schema([
  Field.new('ns', new Utf8()),
  Field.new('value', new Float64()),
])
```

**Verdict:** Use when explicit schema control is needed; otherwise same as Option B.

---

### Option D: hyparquet-writer

**Pros:**
- Pure JavaScript (no WASM)
- **Smallest bundle**: ~20 KB minzipped
- Zero initialization latency
- Simple API

**Cons:**
- Limited compression (Snappy only by default)
- No ZSTD support without additional WASM compressor
- Outputs to JS objects (less memory efficient than Arrow buffers)
- Not as battle-tested as parquet-wasm

**Reference:** [hyparam/hyparquet-writer](https://github.com/hyparam/hyparquet-writer)

**Verdict:** Good for latency-sensitive cold starts where ZSTD isn't required.

---

### Option E: External Service

**Pros:**
- No Worker memory constraints
- Can use any Parquet library (pyarrow, DuckDB, Spark)
- Supports arbitrarily large files

**Cons:**
- Adds network latency (50-200ms)
- Requires additional infrastructure
- More complex deployment

**Implementation:**
```typescript
// Worker sends data to Parquet service
const response = await fetch('https://parquet.dotdo.dev/generate', {
  method: 'POST',
  body: JSON.stringify(data),
})
const parquetBytes = await response.arrayBuffer()
```

**Verdict:** Reserve for very large files or complex transformations.

---

## Benchmark Results

From `packages/duckdb-worker/tests/parquet-write-poc.test.ts`:

### Write Performance (parquet-wasm + ZSTD)

| Rows | Write Time | Output Size | Rows/sec |
|------|------------|-------------|----------|
| 100 | 0.29 ms | 3.2 KB | 343,643 |
| 1,000 | 0.58 ms | 18.0 KB | 1,723,273 |
| 5,000 | 2.47 ms | 88.3 KB | 2,024,258 |
| 10,000 | 4.74 ms | 176.2 KB | 2,110,688 |
| 50,000 | 16.92 ms | 763.3 KB | ~2,950,000 |

### Compression Comparison (1,000 rows)

| Codec | Size | Time | Notes |
|-------|------|------|-------|
| UNCOMPRESSED | 28.7 KB | 0.43 ms | Baseline |
| SNAPPY | 20.9 KB | 0.52 ms | Fast, decent compression |
| **ZSTD** | **14.9 KB** | **0.65 ms** | **Best ratio, recommended** |
| GZIP | 16.5 KB | 2.30 ms | Slower than ZSTD |
| LZ4_RAW | 20.9 KB | 0.51 ms | Similar to Snappy |
| BROTLI | 15.3 KB | 2.23 ms | Good ratio, slow |

### Memory Usage

| Data Size | WASM Memory |
|-----------|-------------|
| 10K rows | 8.0 MB |
| 50K rows | 9.3 MB |

Memory usage is reasonable for Workers (128 MB limit on free plan, 512 MB on paid).

### Special Cases

- **Large strings** (100 KB): Compressed to 1 KB (95.5x ratio)
- **Empty tables**: Handled gracefully
- **Custom metadata**: Preserved in Parquet footer

---

## Implementation

### Existing Implementation

The codebase already has a working implementation in `db/parquet/writer.ts`:

```typescript
import { ParquetBuilder, VECTOR_SCHEMA_1536 } from 'dotdo/db/parquet'

const builder = new ParquetBuilder({
  schema: VECTOR_SCHEMA_1536,
  compression: 'ZSTD',
  rowGroupSize: 2000,
})

for (const vector of vectors) {
  builder.addRow({
    ns: 'tenant.do',
    type: 'Document',
    visibility: 'public',
    id: vector.id,
    embedding: vector.embedding,
    metadata: JSON.stringify(vector.metadata),
    created_at: vector.createdAt,
  })
}

const result = await builder.finish()
await env.R2.put(generateParquetPath('tenant.do', '2026-01-11'), result.buffer)
```

### New POC (db/spikes/parquet-edge-poc.ts)

A simplified wrapper for common use cases:

```typescript
import { ParquetEdgeWriter, writeParquet } from './parquet-edge-poc'

// Simple API
const bytes = await writeParquet({
  id: [1, 2, 3],
  name: ['a', 'b', 'c'],
  value: [1.0, 2.0, 3.0],
})

// Or with configuration
const writer = new ParquetEdgeWriter({
  compression: 'ZSTD',
  rowGroupSize: 2000,
  metadata: { 'schema_version': '1.0.0' },
})

const result = await writer.write(data)
console.log(`Wrote ${result.rowCount} rows in ${result.writeTimeMs}ms`)
```

---

## Recommendations

### Primary: Use parquet-wasm (Option B)

1. **Already integrated** - `parquet-wasm@0.7.1` in package.json
2. **Proven** - Existing tests pass, benchmarks show excellent performance
3. **Worker-compatible** - Works with proper WASM loading
4. **ZSTD support** - Best compression for storage efficiency

### Configuration

```typescript
// Recommended settings for vector data
const writerProps = new parquetWasm.WriterPropertiesBuilder()
  .setCompression(parquetWasm.Compression.ZSTD)
  .setDictionaryEnabled(true)  // For string columns (ns, type, id)
  .setMaxRowGroupSize(2000)    // Balance compression vs random access
  .build()
```

### Fallback: hyparquet-writer (Option D)

Use for cold-start sensitive applications where:
- Bundle size is critical (20 KB vs 1.2 MB)
- ZSTD compression isn't required
- Data is relatively small

### Scale-out: External Service (Option E)

Consider when:
- Files exceed Worker memory limits
- Complex transformations are needed (joins, aggregations)
- Using DuckDB/Spark for processing anyway

---

## Files Created

| File | Purpose |
|------|---------|
| `db/spikes/parquet-benchmark.ts` | Benchmark suite for all options |
| `db/spikes/parquet-edge-poc.ts` | Simplified POC with tests |
| `db/spikes/parquet-generation-spike-results.md` | This document |

---

## Sources

- [parquet-wasm GitHub](https://github.com/kylebarron/parquet-wasm)
- [parquet-wasm npm](https://www.npmjs.com/package/parquet-wasm)
- [hyparquet-writer GitHub](https://github.com/hyparam/hyparquet-writer)
- [DuckDB WASM Workers Discussion](https://github.com/duckdb/duckdb-wasm/discussions/430)
- [Cloudflare Workers Node.js Compatibility](https://blog.cloudflare.com/nodejs-workers-2025/)
- [Hyperparam Blog: Quest for Instant Data](https://blog.hyperparam.app/2025/07/24/quest-for-instant-data/)
