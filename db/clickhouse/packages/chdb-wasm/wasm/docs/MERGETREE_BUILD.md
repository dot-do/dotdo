# MergeTree WASM Build Guide

This document describes how to build a complete MergeTree reader for WebAssembly, including what's currently implemented and what's needed for a full build.

## Current State

### mergetree.wasm (284KB)

The current build uses **standalone stubs** from `MergeTreeStandalone.h` which provide:

- Basic type definitions (String, UInt64, etc.)
- Minimal Column and DataType interfaces
- Simple Arena memory allocator
- No-op Logger
- Single-threaded ThreadPool stub
- Mark structures (MarkInCompressedFile, MarkRange)
- ReadBuffer/WriteBuffer interfaces
- VFS-backed file reading

### What's Working

1. **Part metadata reading**
   - `columns.txt` parsing (column names and types)
   - `count.txt` parsing (row count)
   - Part type detection (Wide vs Compact)

2. **Mark file handling**
   - `.mrk2` format (16-byte marks)
   - `.mrk3` format (24-byte marks with rows_in_granule)

3. **Raw data reading**
   - Byte-level access to `.bin` files
   - Mark-based seeking for range reads

4. **VFS bridge**
   - Async file operations via Emscripten ASYNCIFY
   - Integration with Cloudflare R2/Durable Objects

### What's Missing (for full MergeTree support)

1. **Compression codecs** - Data in `.bin` files is compressed
2. **Column deserialization** - Converting bytes to typed values
3. **Primary index reading** - For predicate pushdown
4. **Full MergeTree reader logic** - Granule-based reading

## Architecture

```
+----------------------------------+
|         JavaScript API           |
+----------------------------------+
              |
              v
+----------------------------------+
|    mergetree_bindings.cpp        |  C API for WASM exports
+----------------------------------+
              |
              v
+----------------------------------+
|    MergeTreePartReader           |  High-level reader (standalone)
|    (mergetree_bindings.cpp)      |  - OR -
|          - OR -                  |  IMergeTreeReader (full build)
|    IMergeTreeReader              |
+----------------------------------+
              |
              v
+----------------------------------+
|    DataPartStorageVFS            |  IDataPartStorage implementation
+----------------------------------+
              |
              v
+----------------------------------+
|         VFS Layer                |  vfs.h / vfs_impl.cpp
|    (vfs_open, vfs_read, etc.)    |
+----------------------------------+
              |
              v
+----------------------------------+
|    JavaScript VFSBridge          |  vfs_bridge.ts
|    (R2/Durable Objects)          |
+----------------------------------+
```

## File Structure

```
packages/chdb-wasm/
├── cmake/
│   ├── wasm-mergetree.cmake      # MergeTree-specific build config
│   ├── wasm-build.cmake          # General WASM build settings
│   └── wasm-engines.cmake        # Storage engine configuration
├── wasm/
│   ├── mergetree/
│   │   ├── MergeTreeStandalone.h       # Standalone type stubs
│   │   ├── DataPartStorageVFS.h        # VFS-backed storage interface
│   │   ├── DataPartStorageVFS.cpp      # VFS implementation
│   │   ├── mergetree_bindings.cpp      # C API and reader logic
│   │   └── test_mergetree_reader.cpp   # Unit tests
│   ├── vfs/
│   │   ├── vfs.h                       # VFS C interface
│   │   ├── vfs_impl.cpp                # Emscripten EM_ASYNC_JS bindings
│   │   └── vfs_bridge.ts               # JavaScript VFS bridge
│   ├── docs/
│   │   ├── MERGETREE_BUILD.md          # This file
│   │   └── MERGETREE_VFS_DESIGN.md     # VFS architecture
│   └── dist/
│       ├── mergetree.js                # Generated JS glue
│       └── mergetree.wasm              # Generated WASM (284KB)
```

## Building

### Current (Standalone) Build

```bash
cd packages/chdb-wasm/wasm
./build.sh mergetree
```

This produces:
- `dist/mergetree.js` - JavaScript module loader
- `dist/mergetree.wasm` - WebAssembly binary (~284KB)

### Full Build (Future)

The full build requires these ClickHouse components:

```bash
# Set environment variables
export CHDB_SOURCE=/path/to/vendor/chdb

# Build with CMake
cd packages/chdb-wasm
mkdir build && cd build
cmake -DMERGETREE_WASM_FULL=ON \
      -DMERGETREE_WASM_COMPRESSION=ON \
      -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
      ..
cmake --build .
```

## Components Needed for Full Build

### 1. Compression Codecs (~500KB-1MB)

MergeTree stores column data compressed. Required codecs:

| Codec | Source File | Size Est. | Priority |
|-------|-------------|-----------|----------|
| LZ4 | `CompressionCodecLZ4.cpp` + contrib/lz4 | ~100KB | High |
| ZSTD | `CompressionCodecZSTD.cpp` + contrib/zstd | ~300KB | High |
| None | `CompressionCodecNone.cpp` | ~5KB | Required |
| Delta | `CompressionCodecDelta.cpp` | ~10KB | Optional |
| DoubleDelta | `CompressionCodecDoubleDelta.cpp` | ~20KB | Optional |
| Gorilla | `CompressionCodecGorilla.cpp` | ~20KB | Optional |
| T64 | `CompressionCodecT64.cpp` | ~30KB | Optional |

The decompression flow:
```cpp
// Current (raw bytes)
auto data = reader->readColumnDataRaw("column_name", start_mark, end_mark);

// Full (decompressed values)
auto column = reader->readColumn("column_name", data_type, start_row, num_rows);
```

### 2. MergeTree Readers (~1-2MB)

| Component | Source Files | Description |
|-----------|--------------|-------------|
| IMergeTreeReader | `IMergeTreeReader.cpp` | Base reader interface |
| MergeTreeReaderWide | `MergeTreeReaderWide.cpp` | Wide part format reader |
| MergeTreeReaderCompact | `MergeTreeReaderCompact.cpp` | Compact part format reader |
| MergeTreeReaderStream | `MergeTreeReaderStream.cpp` | Column stream reader |
| MergeTreeMarksLoader | `MergeTreeMarksLoader.cpp` | Mark file loader with caching |
| MergeTreeRangeReader | `MergeTreeRangeReader.cpp` | Range-based reading |

### 3. Data Types & Serialization (~1MB)

For deserializing column data:

| Component | Description |
|-----------|-------------|
| DataTypeNumber | Int8/16/32/64, UInt8/16/32/64, Float32/64 |
| DataTypeString | String and FixedString |
| DataTypeDate | Date and Date32 |
| DataTypeDateTime | DateTime and DateTime64 |
| DataTypeArray | Array types |
| DataTypeNullable | Nullable wrapper |
| DataTypeLowCardinality | Dictionary encoding |

### 4. Column Classes (~500KB)

| Column Type | Description |
|-------------|-------------|
| ColumnVector | Numeric columns |
| ColumnString | String column |
| ColumnArray | Array column |
| ColumnNullable | Nullable wrapper |
| ColumnLowCardinality | Dictionary-encoded |

### 5. IO Primitives (~200KB)

| Component | Description |
|-----------|-------------|
| CompressedReadBuffer | Decompression wrapper |
| CompressedReadBufferBase | Base decompression |
| HashingReadBuffer | Checksum verification |
| ReadHelpers | Binary deserialization |

## Size Budget

Target: **<5MB compressed** for Cloudflare Workers

| Component | Uncompressed | Compressed Est. |
|-----------|--------------|-----------------|
| Current standalone | 284KB | ~100KB |
| + LZ4 | +100KB | +40KB |
| + ZSTD | +300KB | +120KB |
| + MergeTree readers | +1.5MB | +500KB |
| + Data types | +1MB | +350KB |
| + Columns | +500KB | +180KB |
| + IO | +200KB | +70KB |
| **Total** | ~4MB | ~1.4MB |

## Testing

### Unit Tests

```bash
# Compile and run native tests
cd wasm/mergetree
g++ -std=c++17 -o test_mergetree test_mergetree_reader.cpp -I.
./test_mergetree
```

### WASM Integration Tests

```bash
# Test WASM module
./build.sh test-mergetree
```

### Manual Testing

```javascript
const createMergeTreeModule = require('./dist/mergetree.js');

const Module = await createMergeTreeModule({
    vfsBridge: myVfsBridgeInstance
});

// Get version
const version = Module.UTF8ToString(Module._mergetree_version());

// Run self-test
const testResult = Module._mergetree_test();

// Create reader
const reader = Module._mergetree_reader_create(dbPtr, tablePtr, partitionPtr, partPtr);
if (reader > 0) {
    const rows = Module._mergetree_reader_get_row_count(reader);
    const cols = Module._mergetree_reader_get_column_count(reader);
    Module._mergetree_reader_destroy(reader);
}
```

## Implementation Phases

### Phase 1: Standalone Reader (DONE)
- [x] MergeTreeStandalone.h type stubs
- [x] DataPartStorageVFS implementation
- [x] mergetree_bindings.cpp C API
- [x] VFS bridge (EM_ASYNC_JS)
- [x] Part metadata reading
- [x] Mark file parsing
- [x] Raw data reading

### Phase 2: Compression Support
- [ ] Add lz4 contrib library
- [ ] Add zstd contrib library
- [ ] CompressedReadBuffer integration
- [ ] CompressionCodecLZ4
- [ ] CompressionCodecZSTD
- [ ] CompressionCodecNone

### Phase 3: Column Deserialization
- [ ] Basic numeric types (Int*, UInt*, Float*)
- [ ] String type
- [ ] Date/DateTime types
- [ ] Binary serialization format support

### Phase 4: Full Reader Integration
- [ ] IMergeTreeReader interface
- [ ] MergeTreeReaderWide
- [ ] MergeTreeReaderCompact (optional)
- [ ] Mark caching
- [ ] Primary index support

### Phase 5: Optimization
- [ ] wasm-opt post-processing
- [ ] Dead code elimination
- [ ] Size profiling
- [ ] Performance benchmarks

## Configuration Options

See `cmake/wasm-mergetree.cmake` for all options:

```cmake
# Build mode
MERGETREE_WASM_STANDALONE=ON  # Current: use stubs
MERGETREE_WASM_FULL=OFF       # Future: use real ClickHouse sources

# Features
MERGETREE_ENABLE_WIDE_PARTS=ON
MERGETREE_ENABLE_COMPACT_PARTS=ON
MERGETREE_ENABLE_MARKS_V3=ON
MERGETREE_ENABLE_PRIMARY_INDEX=ON

# Compression
MERGETREE_WASM_COMPRESSION=OFF
MERGETREE_CODEC_LZ4=ON
MERGETREE_CODEC_ZSTD=ON
```

## Dependencies

### For Standalone Build
- Emscripten SDK (3.1.x+)
- No external dependencies

### For Full Build
- Emscripten SDK
- lz4 library (from ClickHouse contrib)
- zstd library (from ClickHouse contrib)
- ClickHouse/chdb source tree

## References

- [ClickHouse MergeTree](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree)
- [MergeTree Part Format](https://clickhouse.com/docs/en/development/architecture#merge-tree)
- [Emscripten ASYNCIFY](https://emscripten.org/docs/porting/asyncify.html)
- [MERGETREE_VFS_DESIGN.md](./MERGETREE_VFS_DESIGN.md)
