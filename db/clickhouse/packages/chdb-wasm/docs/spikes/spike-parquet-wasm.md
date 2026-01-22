# Spike: Parquet Format Support in ClickHouse WASM

## Executive Summary

This spike investigates Parquet format support for the chdb-wasm project, examining both native ClickHouse Parquet implementation and alternative approaches. The goal is to enable reading Parquet files from R2 storage and potentially exporting query results as Parquet.

**Key Finding**: Native ClickHouse Parquet is large (~26MB source code for Arrow + Parquet + dependencies) but provides the most complete integration. For minimal builds, `parquet-wasm` (~1.2MB) offers a viable alternative with excellent WASM optimization.

## 1. Native ClickHouse Parquet Implementation

### 1.1 Source Code Location

The Parquet implementation in vendor/chdb is spread across multiple locations:

| Path | Description | Lines of Code |
|------|-------------|---------------|
| `contrib/arrow/cpp/src/parquet/` | Apache Parquet C++ library | ~75,000 |
| `contrib/arrow/cpp/src/arrow/` | Apache Arrow C++ library | ~528,000 |
| `src/Processors/Formats/Impl/Parquet*.cpp` | ClickHouse Parquet adapters | ~130,000 |
| `src/Processors/Formats/Impl/Arrow*.cpp` | Arrow-ClickHouse conversion | ~200,000 |

Total disk size:
- Parquet source: ~3.2MB
- Arrow source: ~23MB

### 1.2 Key Components

**ParquetBlockInputFormat** (`src/Processors/Formats/Impl/ParquetBlockInputFormat.cpp`):
- Reads Parquet files into ClickHouse blocks
- Supports row group filtering via predicates
- Uses Arrow for data type conversion
- Multi-threaded decoding (requires ThreadPool)
- Prefetching for sequential access

**ParquetBlockOutputFormat** (`src/Processors/Formats/Impl/ParquetBlockOutputFormat.cpp`):
- Writes ClickHouse blocks to Parquet format
- Uses Arrow's FileWriter
- Supports compression (Snappy, ZSTD, LZ4, Brotli)

**Arrow Buffered Streams** (`src/Processors/Formats/Impl/ArrowBufferedStreams.cpp`):
- `RandomAccessFileFromSeekableReadBuffer` - Wraps ClickHouse ReadBuffer as Arrow file
- `RandomAccessFileFromRandomAccessReadBuffer` - For random access patterns
- Enables integration with ClickHouse's IO abstraction

### 1.3 Dependencies

From `contrib/arrow-cmake/CMakeLists.txt`:

```cmake
# Parquet depends on:
target_link_libraries(_parquet
    PUBLIC _arrow ch_contrib::thrift
    PRIVATE boost::headers_only boost::regex OpenSSL::Crypto OpenSSL::SSL)

# Arrow depends on:
target_link_libraries(_arrow PRIVATE
    boost::filesystem _flatbuffers ch_contrib::double_conversion
    ch_contrib::lz4 ch_contrib::snappy ch_contrib::zlib
    ch_contrib::zstd ch_contrib::brotli)
```

Required libraries:
- **Apache Thrift** - Parquet uses Thrift for schema encoding
- **Apache Arrow** - In-memory columnar format
- **Compression** - LZ4, Snappy, ZLIB, ZSTD, Brotli
- **Boost** - Regex, filesystem utilities
- **FlatBuffers** - Arrow IPC serialization
- **OpenSSL** - Encryption support (optional)

### 1.4 Build Profile Integration

Current CMakeLists.txt settings:

```cmake
# From build/emscripten/CMakeLists.txt
if(CHDB_PROFILE STREQUAL "minimal")
    set(ENABLE_PARQUET OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW OFF CACHE BOOL "" FORCE)
elseif(CHDB_PROFILE STREQUAL "standard")
    set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
    set(ENABLE_ARROW ON CACHE BOOL "" FORCE)
endif()
```

## 2. WASM Compatibility Analysis

### 2.1 Blocking Issues

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Threading | High | Parquet reader uses ThreadPool for parallel decoding. Requires single-threaded mode or emulation |
| Memory | High | Arrow allocates large buffers. May exceed 128MB limit for large files |
| File I/O | Medium | Uses RandomAccessFile abstraction. Compatible with VFS bridge |
| OpenSSL | Low | Only needed for encryption. Can be disabled |

### 2.2 Threading Concerns

From `ParquetBlockInputFormat.cpp`:
```cpp
pool = std::make_unique<ThreadPool>(
    CurrentMetrics::FormatParsingThreads, ...);
io_pool = std::make_shared<ThreadPool>(
    CurrentMetrics::IOThreads, ...);
```

The Parquet reader creates thread pools for:
1. Parallel row group decoding
2. Async I/O prefetching

**Mitigation**: ClickHouse's `max_decoding_threads = 1` path runs all tasks inline in `read()` without the thread pool.

### 2.3 Memory Requirements

For reading Parquet:
- Compressed row group: typically 100-500MB
- Decompression buffer: 1-10x compression ratio
- Arrow intermediate: columns resident in memory
- ClickHouse blocks: final converted format

Estimated memory per query:
- Small file (< 1MB): 5-10MB working memory
- Medium file (< 100MB): 20-50MB working memory
- Large file (> 100MB): **Exceeds 128MB limit**

### 2.4 VFS Integration

The existing VFS bridge architecture is compatible with Parquet reading:

```
R2 Storage
    |
    v
VFSStorageProvider (vfs-bridge.ts)
    |
    v
SeekableReadBuffer (ClickHouse)
    |
    v
RandomAccessFileFromSeekableReadBuffer (Arrow adapter)
    |
    v
ParquetBlockInputFormat
```

The Parquet reader accesses files via Arrow's `RandomAccessFile` interface, which is already wrapped in `ArrowBufferedStreams.cpp`.

## 3. Querying Parquet from R2

### 3.1 Current Implementation

The project already has Parquet table function support in TypeScript:

From `src/table-engines/parquet.ts`:
```typescript
export type ParquetSourceType = 'local' | 'r2' | 'https' | 'http';

export function parseParquetFunction(sql: string):
  { path: string; sourceType: ParquetSourceType } | null {
  // Parses: SELECT * FROM parquet('r2://bucket/file.parquet')
}
```

This provides SQL parsing and mock data generation but does not use the actual WASM Parquet reader.

### 3.2 R2 Range Request Support

From `spike-5-r2-virtual-memory.md`, R2 supports efficient range requests:

```typescript
const obj = await bucket.get(path, {
  range: { offset, length }
});
```

This enables:
- Reading Parquet footer (last 8 bytes + metadata)
- Selective row group access
- Column pruning (read only needed columns)

### 3.3 Read Pattern for Parquet

1. **Read footer** (8 bytes): Get metadata offset
2. **Read metadata** (variable): Schema, row groups, column offsets
3. **For each required column in each row group**:
   - Read column chunk from R2 (range request)
   - Decompress
   - Decode to Arrow format
   - Convert to ClickHouse format

### 3.4 Implementation Approach

Two options for R2 Parquet access:

**Option A: Native ClickHouse (standard profile)**
```typescript
// VFS already handles R2 abstraction
const result = await chdb.query(`
  SELECT * FROM file('r2://bucket/data.parquet', Parquet)
  WHERE condition
`);
```

**Option B: parquet-wasm + Arrow IPC**
```typescript
// Read Parquet with parquet-wasm
const arrowData = await readParquet(r2Data);
// Convert to JSON/ClickHouse format
const rows = arrowData.toArray();
```

## 4. ClickBench Use Case

### 4.1 Data Format

ClickBench uses a 100M row Parquet file with 105 columns. Current schema from `src/clickbench/schema.ts`:

```typescript
export const HITS_TABLE_METADATA = {
  columnCount: 105,
  approximateRowCount: 99997497,
  approximateCompressedSize: 16 * 1024 * 1024 * 1024, // ~16GB
};
```

### 4.2 WASM Feasibility

The full ClickBench dataset cannot be processed in 128MB memory. Options:

1. **Streaming with paging** (from spike-5): Page 64KB chunks via VFS
2. **Pre-aggregated data**: Store aggregations in R2
3. **Sampling**: Use 1% or 0.1% sample files
4. **Partitioned files**: Split by date/CounterID

### 4.3 Recommended Approach

Store ClickBench as partitioned Parquet files in R2:
```
r2://clickbench-data/
  hits_2021-01.parquet  (~500MB)
  hits_2021-02.parquet  (~500MB)
  ...
```

Query specific partitions to stay within memory limits.

## 5. Export Query Results as Parquet

### 5.1 Native Export

With the standard profile, ClickHouse can export to Parquet:

```sql
SELECT * FROM my_table FORMAT Parquet
```

This writes to the VFS, which can stream to R2.

### 5.2 Memory Considerations

Parquet writing requires buffering a row group in memory:
- Default row group: 1M rows or 128MB
- Can configure smaller row groups for memory-constrained environments

```sql
SET output_format_parquet_row_group_size = 10000;
```

## 6. Alternative: parquet-wasm Library

### 6.1 Overview

[parquet-wasm](https://github.com/kylebarron/parquet-wasm) is a standalone Rust-based Parquet reader compiled to WASM.

| Metric | parquet-wasm | Native ClickHouse |
|--------|--------------|-------------------|
| Bundle size (brotli) | 1.2 MB (full) / 456 KB (read-only) | ~15-25 MB (standard profile) |
| Features | Read/Write, async | Full SQL integration |
| Memory efficiency | Arrow-native | Arrow -> ClickHouse conversion |
| Threading | Single-threaded | Configurable |

### 6.2 Integration Architecture

```
R2 Storage
    |
    v
fetch() / Workers binding
    |
    v
parquet-wasm.readParquet()
    |
    v
Arrow RecordBatch (in WASM memory)
    |
    v
JavaScript conversion
    |
    v
ClickHouse query (in-memory table)
```

### 6.3 Hybrid Approach

Use parquet-wasm for Parquet I/O and ClickHouse for SQL:

```typescript
import { readParquet } from 'parquet-wasm';

// 1. Read Parquet from R2
const parquetBuffer = await env.DATA_BUCKET.get('data.parquet');
const arrowTable = readParquet(parquetBuffer.arrayBuffer());

// 2. Convert to JSON rows
const rows = arrowTable.toArray();

// 3. Create ClickHouse temporary table
await chdb.query(`
  CREATE TEMPORARY TABLE data (
    id UInt64, name String, value Float64
  ) ENGINE = Memory
`);

// 4. Insert data (via VALUES or JSON)
await chdb.query(`INSERT INTO data FORMAT JSONEachRow`, rows);

// 5. Run SQL query
const result = await chdb.query('SELECT * FROM data WHERE value > 100');
```

### 6.4 Custom Build for Minimal Size

parquet-wasm supports custom builds:

```bash
cargo build --no-default-features --features "reader,snappy"
# Results in ~456KB brotli-compressed
```

## 7. Arrow IPC as Alternative

### 7.1 Benefits

Arrow IPC (Inter-Process Communication) format:
- Simpler than Parquet (no encoding/compression layers)
- Native Arrow representation (no conversion)
- Streaming support (record batches)
- Smaller code footprint

### 7.2 Trade-offs

| Aspect | Parquet | Arrow IPC |
|--------|---------|-----------|
| Compression | Built-in (ZSTD, Snappy) | None (apply externally) |
| File size | Smaller (compressed) | Larger (uncompressed) |
| Read speed | Slower (decompress + decode) | Faster (memory-mapped) |
| Ecosystem | Universal | Less common |

### 7.3 Use Case

Arrow IPC is suitable for:
- Internal data transfer (Worker to Worker)
- Cached intermediate results
- When compression is applied at transport layer

## 8. Recommendations

### 8.1 For Minimal Profile

Use **parquet-wasm** as a separate dependency:
1. Add to package.json: `"parquet-wasm": "^0.7.x"`
2. Use custom build with only required compression codecs
3. Convert to JSON for ClickHouse Memory engine queries

**Pros**:
- Minimal bundle size impact (~500KB)
- Independent of ClickHouse build complexity
- Well-tested WASM implementation

**Cons**:
- Extra conversion step
- No predicate pushdown integration

### 8.2 For Standard Profile

Enable **native ClickHouse Parquet**:
1. Set `ENABLE_PARQUET=ON` in CMake
2. Ensure single-threaded mode
3. Configure small row group sizes

**Pros**:
- Full SQL integration
- Predicate pushdown
- Column pruning at format level

**Cons**:
- ~15-20MB additional bundle size
- Requires Arrow + Thrift + compression libs

### 8.3 For ClickBench Specifically

1. **Pre-partition** the data into smaller Parquet files
2. Store in R2 with efficient naming: `hits_{partition}.parquet`
3. Use standard profile with native Parquet
4. Implement paged VFS (spike-5) for large row groups

### 8.4 Implementation Priority

1. **Phase 1**: parquet-wasm integration for minimal profile (1 week)
2. **Phase 2**: Native Parquet in standard profile (2 weeks)
3. **Phase 3**: R2 paging for large files (spike-5 implementation)
4. **Phase 4**: ClickBench partitioned data loading

## 9. Memory Budget Analysis

### 9.1 Minimal Profile with parquet-wasm

```
Total Available:                128MB
-------------------------------------
V8 Runtime Overhead:            ~10MB
Worker Script + Dependencies:    ~3MB
WASM Module (minimal chdb):     ~10MB
parquet-wasm module:             ~5MB
Query Working Memory:           ~50MB
Parquet Row Group Buffer:       ~40MB
Safety Margin:                  ~10MB
```

Maximum safe Parquet file: ~30-40MB compressed

### 9.2 Standard Profile with Native Parquet

```
Total Available:                128MB
-------------------------------------
V8 Runtime Overhead:            ~10MB
Worker Script + Dependencies:    ~3MB
WASM Module (standard chdb):    ~25MB
Query Working Memory:           ~40MB
Parquet Row Group Buffer:       ~40MB
Safety Margin:                  ~10MB
```

Maximum safe Parquet file: ~30MB compressed

## 10. Conclusion

Native ClickHouse Parquet support is feasible for the standard profile but adds significant bundle size (~20MB). For the minimal profile, `parquet-wasm` provides an excellent alternative with smaller footprint.

Key architectural decisions:
1. **Use VFS bridge** for R2 file access (already designed)
2. **Single-threaded mode** for WASM compatibility
3. **Partition large files** to stay within memory limits
4. **Consider parquet-wasm** for minimal builds

The ClickBench use case requires partitioned data regardless of implementation choice due to the 128MB memory constraint.

## References

- [Apache Parquet Format Specification](https://parquet.apache.org/docs/)
- [parquet-wasm GitHub](https://github.com/kylebarron/parquet-wasm)
- [ClickHouse Parquet Documentation](https://clickhouse.com/docs/en/interfaces/formats#parquet)
- [Arrow IPC Format](https://arrow.apache.org/docs/format/IPC.html)
- [spike-5-r2-virtual-memory.md](./spike-5-r2-virtual-memory.md) - R2 paging architecture
