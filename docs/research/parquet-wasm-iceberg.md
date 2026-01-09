# parquet-wasm Research for Iceberg Write Path

Research findings for using parquet-wasm (v0.7.1) in the Iceberg write path for unified analytics.

## Executive Summary

**Verdict: parquet-wasm is suitable for Iceberg write path in Cloudflare Workers with important caveats.**

| Capability | Status | Notes |
|------------|--------|-------|
| Generate Parquet files | **Yes** | All column types supported |
| ZSTD compression | **Yes** | Best compression/speed ratio |
| Workers compatibility | **Partial** | 6.3MB WASM bundle, requires lazy loading |
| Memory footprint | **Acceptable** | 8-10MB base, scales with data |
| Performance | **Excellent** | 2M+ rows/sec for simple schemas |

## 1. Capabilities

### 1.1 Parquet File Generation

parquet-wasm can generate valid Parquet files from Arrow tables. The workflow:

```typescript
import { tableFromArrays, tableToIPC } from 'apache-arrow'
import * as parquet from 'parquet-wasm/bundler'

// 1. Create Arrow table
const arrowTable = tableFromArrays({
  ns: ['tenant.do', 'tenant.do'],
  type: ['Document', 'Chunk'],
  id: ['vec_001', 'vec_002'],
  created_at: [BigInt(Date.now()), BigInt(Date.now())],
})

// 2. Convert to IPC stream for parquet-wasm
const ipcBuffer = tableToIPC(arrowTable, 'stream')

// 3. Load into WASM memory
const wasmTable = parquet.Table.fromIPCStream(ipcBuffer)

// 4. Configure writer properties
const writerProps = new parquet.WriterPropertiesBuilder()
  .setCompression(parquet.Compression.ZSTD)
  .setDictionaryEnabled(true)
  .setMaxRowGroupSize(2000)
  .setKeyValueMetadata(new Map([
    ['dotdo:schema_version', '1.0.0'],
  ]))
  .build()

// 5. Write Parquet file
const parquetBytes = parquet.writeParquet(wasmTable, writerProps)
```

### 1.2 Supported Column Types

All Apache Arrow types are supported via IPC interchange:

| Arrow Type | Parquet Equivalent | Notes |
|------------|-------------------|-------|
| Utf8 | STRING | Dictionary encoding recommended |
| Int32, Int64 | INT32, INT64 | Native support |
| Float32, Float64 | FLOAT, DOUBLE | Native support |
| FixedSizeList | FIXED_LEN_BYTE_ARRAY | For embeddings |
| TimestampMillisecond | INT64 (TIMESTAMP) | Preserves precision |
| Binary | BYTE_ARRAY | For blobs |
| Boolean | BOOLEAN | Native support |
| Struct | GROUP | Nested data |
| List | LIST | Variable-length arrays |

### 1.3 Compression Options

All standard Parquet compression codecs are supported:

| Codec | File Size | Write Time | Best For |
|-------|-----------|------------|----------|
| UNCOMPRESSED | 28.7 KB | 0.40ms | Debugging |
| SNAPPY | 20.9 KB | 0.54ms | Fast reads |
| **ZSTD** | **14.9 KB** | **0.61ms** | **Best default** |
| GZIP | 16.4 KB | 2.66ms | Compatibility |
| LZ4_RAW | 20.9 KB | 0.48ms | Very fast |
| BROTLI | 15.3 KB | 2.15ms | Max compression |

*Benchmarks: 1000 rows with 4 columns (id, name, value, timestamp)*

**Recommendation**: Use ZSTD for Iceberg data files. It provides the best compression ratio while maintaining fast write speeds.

## 2. Bundle Size Impact

### 2.1 WASM Binary Size

```
parquet_wasm_bg.wasm: 6.3 MB (uncompressed)
                      ~1.2 MB (brotli compressed for transfer)
```

This is the full bundle with all compression codecs. Custom builds could reduce this but lose codec support.

### 2.2 Workers Deployment Strategy

The 6.3MB WASM bundle exceeds Cloudflare's 3MB Worker limit for inline WASM. Two approaches:

#### Option A: WASM Binding (Recommended)

```jsonc
// wrangler.jsonc
{
  "wasm_modules": {
    "PARQUET_WASM": "node_modules/parquet-wasm/bundler/parquet_wasm_bg.wasm"
  }
}
```

```typescript
// worker.ts
import * as parquet from 'parquet-wasm/bundler'

export default {
  async fetch(request, env) {
    // WASM is available via binding
    // ...
  }
}
```

#### Option B: Lazy Load from R2

```typescript
async function loadParquetWasm(env: Env) {
  const wasmObj = await env.R2.get('wasm/parquet_wasm_bg.wasm')
  const wasmBytes = await wasmObj!.arrayBuffer()
  const module = await WebAssembly.compile(wasmBytes)
  // Initialize parquet-wasm with compiled module
}
```

## 3. Memory Requirements

### 3.1 Base Memory

| Component | Size |
|-----------|------|
| WASM module | ~8 MB |
| Arrow tables | ~4 bytes per float, ~2 bytes per char |
| IPC buffer | 2x data size (serialization overhead) |

### 3.2 Scaling with Data

| Row Count | WASM Memory | Write Time | Output Size |
|-----------|-------------|------------|-------------|
| 100 | 8 MB | 0.3ms | 3.2 KB |
| 1,000 | 8 MB | 0.6ms | 18 KB |
| 10,000 | 8 MB | 3.5ms | 157 KB |
| 50,000 | 9.3 MB | 16.6ms | 763 KB |

**Key Finding**: Memory scales modestly. The 128MB Worker limit supports writes of 100K+ rows per request.

### 3.3 Memory for Vector Embeddings

For 1536-dimension embeddings (OpenAI default):

```
Per vector: 1536 * 4 bytes = 6,144 bytes
1000 vectors: ~6 MB data + 8 MB WASM = ~14 MB
10000 vectors: ~60 MB data + 8 MB WASM = ~68 MB
```

**Recommendation**: Batch size of 5,000-10,000 vectors per Parquet file to stay well under memory limits.

## 4. Row Group Sizing

Row groups determine granularity of predicate pushdown and parallelism in readers.

| Row Group Size | File Size | Write Time | Use Case |
|----------------|-----------|------------|----------|
| 100 | 102 KB | 5.7ms | Fine-grained filtering |
| 500 | 76 KB | 2.6ms | Balanced |
| **1,000** | **73 KB** | **2.9ms** | **Iceberg default** |
| 2,000 | 74 KB | 2.1ms | Large scans |
| 5,000 | 77 KB | 1.7ms | Bulk analytics |

**Recommendation for Iceberg**: Use row group size of 1,000-2,000 to balance:
- Predicate pushdown efficiency
- Column statistic granularity
- Write performance

## 5. Integration Approach with R2

### 5.1 Iceberg Write Path Flow

```
┌─────────────────┐
│ TransactionDO   │
│ (WAL Buffer)    │
└────────┬────────┘
         │ commit threshold
         ▼
┌─────────────────┐
│ Parquet Writer  │  ← parquet-wasm
│ (In Memory)     │
└────────┬────────┘
         │ Uint8Array
         ▼
┌─────────────────┐
│ R2.put()        │
│ data/{table}/   │
│ {timestamp}.parquet
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ R2 Data Catalog │
│ Iceberg Commit  │
└─────────────────┘
```

### 5.2 Code Example

```typescript
// db/iceberg/writer.ts

import * as parquet from 'parquet-wasm/bundler'
import { tableFromArrays, tableToIPC } from 'apache-arrow'

export class IcebergWriter {
  constructor(
    private env: Env,
    private table: string
  ) {}

  async writeDataFile(records: Record<string, unknown>[]): Promise<string> {
    // 1. Build Arrow table from records
    const arrowTable = this.recordsToArrow(records)

    // 2. Convert to Parquet
    const ipcBuffer = tableToIPC(arrowTable, 'stream')
    const wasmTable = parquet.Table.fromIPCStream(ipcBuffer)

    const props = new parquet.WriterPropertiesBuilder()
      .setCompression(parquet.Compression.ZSTD)
      .setMaxRowGroupSize(2000)
      .setStatisticsEnabled(parquet.EnabledStatistics.Chunk)
      .setKeyValueMetadata(new Map([
        ['iceberg.schema', JSON.stringify(this.icebergSchema)],
        ['row-count', String(records.length)],
      ]))
      .build()

    const parquetBytes = parquet.writeParquet(wasmTable, props)

    // 3. Upload to R2
    const path = `data/${this.table}/${Date.now()}.parquet`
    await this.env.R2.put(path, parquetBytes)

    return path
  }
}
```

### 5.3 Metadata for Iceberg

Include these Parquet key-value metadata entries for Iceberg compatibility:

```typescript
const metadata = new Map([
  // Iceberg standard metadata
  ['iceberg.schema', JSON.stringify(icebergSchema)],

  // dotdo extensions
  ['dotdo:schema_version', '1.0.0'],
  ['dotdo:namespace', namespace],
  ['dotdo:vector_count', String(rowCount)],
  ['dotdo:min_timestamp', String(minTs)],
  ['dotdo:max_timestamp', String(maxTs)],
])
```

## 6. Blockers and Limitations

### 6.1 Critical Issues

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Bundle size (6.3MB) | High | Use WASM binding or R2 lazy load |
| No streaming write | Medium | Buffer in memory, batch writes |
| Node.js ESM issues | Low | Use bundler entry point |

### 6.2 Missing Features

1. **Compression level configuration**: ZSTD level not configurable (uses default level 3)
2. **Bloom filters**: Not supported for predicate pushdown optimization
3. **Column-level compression**: Can only set global compression, not per-column
4. **Incremental writes**: Must buffer all data before writing (no append)

### 6.3 Workarounds

**Streaming/Large Files**: Split into multiple Parquet files:
```typescript
async function writeInChunks(records: any[], chunkSize = 10000) {
  const paths: string[] = []
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)
    const path = await writer.writeDataFile(chunk)
    paths.push(path)
  }
  return paths
}
```

## 7. Alternative Libraries

### 7.1 Comparison

| Library | Bundle Size | Workers Support | Features |
|---------|-------------|-----------------|----------|
| **parquet-wasm** | 6.3 MB | Via binding | Full read/write |
| parquetjs | 2.5 MB | No (Node.js only) | Limited types |
| DuckDB-WASM | 4.2 MB | Yes | SQL + Parquet |
| hyparquet | 150 KB | Yes | Read-only |

### 7.2 Recommendations

1. **Use parquet-wasm** for Iceberg write path (full feature support)
2. **Consider hyparquet** for read-only cases (much smaller)
3. **Use DuckDB-WASM** when SQL queries are needed (already integrated)

## 8. Performance Summary

### 8.1 Write Performance

```
┌─────────┬───────┬──────────┬────────────┬────────────┐
│  Rows   │ Time  │ Size     │ Rows/sec   │ MB/sec     │
├─────────┼───────┼──────────┼────────────┼────────────┤
│   100   │ 0.3ms │ 3.2 KB   │  327,000   │ 10.4       │
│  1,000  │ 0.6ms │ 18 KB    │ 1,645,000  │ 29.3       │
│  5,000  │ 2.3ms │ 88 KB    │ 2,186,000  │ 38.4       │
│ 10,000  │ 4.5ms │ 176 KB   │ 2,207,000  │ 38.9       │
└─────────┴───────┴──────────┴────────────┴────────────┘
```

### 8.2 Workers CPU Time Estimate

| Operation | CPU Time |
|-----------|----------|
| WASM init (first call) | ~10ms |
| Arrow table creation | ~0.5ms per 1000 rows |
| IPC serialization | ~0.2ms per 1000 rows |
| Parquet write | ~0.5ms per 1000 rows |
| R2 upload | ~5-20ms |
| **Total (1000 rows)** | **~15-30ms** |

This fits well within Workers' 30-second CPU time limit, allowing ~1M rows per request.

## 9. Recommendations for Iceberg Implementation

### 9.1 Configuration

```typescript
const ICEBERG_PARQUET_CONFIG = {
  compression: 'ZSTD',
  rowGroupSize: 2000,
  dictionaryEnabled: true,
  statisticsEnabled: 'Chunk', // For predicate pushdown
}
```

### 9.2 File Size Guidelines

| Data Type | Target File Size | Rows (estimate) |
|-----------|-----------------|-----------------|
| Vector embeddings (1536d) | 10-50 MB | 1,500-8,000 |
| Event logs | 50-100 MB | 100K-500K |
| Metrics | 10-50 MB | 500K-2M |

### 9.3 Implementation Priority

1. **Phase 1**: Basic Parquet write with ZSTD compression
2. **Phase 2**: Iceberg manifest generation
3. **Phase 3**: Column statistics for predicate pushdown
4. **Phase 4**: Compaction (merge small files)

## 10. References

- [parquet-wasm GitHub](https://github.com/kylebarron/parquet-wasm)
- [parquet-wasm API Docs](https://kylebarron.dev/parquet-wasm/)
- [Apache Parquet Spec](https://parquet.apache.org/docs/)
- [Iceberg Table Spec](https://iceberg.apache.org/spec/)
- [Proof-of-Concept Tests](/packages/duckdb-worker/tests/parquet-write-poc.test.ts)
