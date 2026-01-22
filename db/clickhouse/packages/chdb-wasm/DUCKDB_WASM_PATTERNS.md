# DuckDB WASM Patterns: Lessons for chdb-wasm

This document summarizes how DuckDB achieved their successful WASM build and identifies patterns applicable to chdb.

## Executive Summary

DuckDB-WASM achieves a **~3.2-3.5 MB compressed** download for their shell demo, with the core WASM module being approximately **17 MB uncompressed** (full featured) or smaller with optimizations. For comparison, sql.js (SQLite WASM) achieves ~400-600 KB. The key to DuckDB's success is their **modular architecture with lazy-loaded extensions** rather than a single monolithic binary.

## Binary Size Analysis

| Component | Size (Compressed) | Notes |
|-----------|-------------------|-------|
| DuckDB-WASM Shell (full) | ~3.2 MB | With extension loading |
| DuckDB-WASM Core | ~1.8 MB gzipped | Base WASM module |
| sql.js (SQLite) | ~400-600 KB | Much simpler feature set |
| DuckDB Full Binary | ~17 MB | All features bundled |

### Why DuckDB is Larger Than SQLite

DuckDB includes:
- Vectorized columnar execution engine (OLAP optimized)
- Apache Arrow integration (zero-copy data transfer)
- Parquet reader/writer support
- Advanced query optimizer
- Multiple file format parsers (CSV, JSON, Parquet)

## Key Architecture Patterns

### 1. Extension-Based Modularity

DuckDB's most important size optimization is **lazy-loaded extensions via dlopen**:

```
Core extensions (JSON, Parquet, ICU, autocomplete) are NOT bundled
in the WASM binary. They are autoloaded at runtime on first use.
```

**How it works:**
- Extensions are compiled as separate WASM modules
- Loaded via Emscripten's `dlopen` implementation
- `INSTALL` is a no-op (no durable storage in browser)
- `LOAD` fetches, validates signature, and links dynamically
- Extensions are served pre-compressed with Brotli

**URL Pattern:**
```
extensions.duckdb.org/duckdb-wasm/$version/$platform/$name.duckdb_extension.wasm
```

### 2. Multiple WASM Variants

DuckDB produces **three build variants** optimized for different browser capabilities:

| Variant | Features | Use Case |
|---------|----------|----------|
| **MVP** | Basic WebAssembly only | Maximum compatibility |
| **EH** | Exception handling support | Modern browsers, better performance |
| **COI** | Threads + SIMD + Bulk Memory | Highest performance (requires Cross-Origin Isolation) |

**Build flags for variants:**
```cmake
MVP:  Basic compilation (no special flags)
EH:   -DWITH_WASM_EXCEPTIONS=1
COI:  -DWITH_WASM_THREADS=1 -DWITH_WASM_SIMD=1 -DWITH_WASM_BULK_MEMORY=1
```

### 3. Build System Configuration

**Makefile targets:**
```bash
wasm_build_lib.sh relsize ${TARGET}  # Size-optimized release build
```

**CMake flags used:**
- `DUCKDB_PLATFORM=wasm_${TARGET}`
- `DUCKDB_WASM_LOADABLE_EXTENSIONS=1`
- `WASM_MIN_SIZE=1` for relsize builds

**DuckDB's SMALLER_BINARY flag:**
```cmake
option(SMALLER_BINARY "Produce a smaller binary by trimming specialized code paths" FALSE)
```

When enabled, this removes template specializations and unified aggregate implementations.

### 4. Emscripten Optimization Flags

**Recommended flags for size optimization:**

```bash
# Optimization level
-Os              # Size-focused optimization (recommended)
-Oz              # More aggressive size reduction
-O3              # Performance (larger code)

# Feature disabling
-fno-rtti        # Disable RTTI (~15% reduction)
-fno-exceptions  # Disable C++ exceptions (if not needed)
-sFILESYSTEM=0   # Remove filesystem support (if not needed)
-sENVIRONMENT=web  # Only target web (saves ~2KB)
-sMALLOC=emmalloc  # Smaller allocator (slower than dlmalloc)

# Assertions and debug
-sASSERTIONS=0   # Disable runtime assertions
-DNDEBUG         # Disable debug code

# Runtime optimization
-sNO_EXIT_RUNTIME=1  # No cleanup on exit

# Link-time optimization
-flto            # Enable LTO for cross-unit inlining

# Closure compiler
--closure 1      # Minify JavaScript support code
```

### 5. Export Symbol Management

DuckDB uses **wasm2wat** to analyze and filter exported symbols:

```bash
# Filter out unnecessary exports
# Remove: _Unwind_* functions, Arrow library symbols
update_exported_list target
```

### 6. Threading Approach

**Default: Single-threaded**
- SharedArrayBuffer restrictions post-Spectre/Meltdown
- Most websites won't enable Cross-Origin Isolation
- Single-threaded mode works everywhere

**Optional: Multi-threaded (COI variant)**
- Requires HTTP headers:
  ```
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  ```
- Enables pthreads via SharedArrayBuffer
- 2-5x performance improvement for large datasets

### 7. Async Execution Model

DuckDB-WASM is **not fully async during I/O**:
- Queries run in Web Workers to avoid blocking UI
- HTTP reads use synchronous XHR (blocking within worker)
- Full async would require major query execution changes

**Architecture:**
```
Main Thread <---> AsyncDuckDB API <---> Web Worker <---> WASM Module
                    (messages)              (sync)
```

### 8. Data Exchange Format

**Apache Arrow** as the primary data protocol:
- Zero-copy data transfer across WASM boundary
- Avoids expensive serialization/deserialization
- Arrow Tables or streaming record batches

## Cloudflare Workers Challenges

DuckDB-WASM has significant limitations for Cloudflare Workers:

1. **Bundle size cap**: Workers limited to 1 MB; DuckDB gzipped is ~1.8 MB
2. **Service Worker API only**: No synchronous XHR support
3. **Blocking HTTP reads**: DuckDB's filesystem requires sync XHR

**Result**: DuckDB-WASM does not officially support Cloudflare Workers.

## Lessons for chdb-wasm

### Immediate Wins

1. **Lazy Extension Loading**
   - Don't bundle all features in core WASM
   - Load format parsers (Parquet, JSON, etc.) on demand
   - Use Emscripten's dlopen for dynamic linking

2. **Multiple Build Variants**
   - MVP: Maximum compatibility, smallest size
   - EH: Better error handling, moderate browsers
   - COI: Full threading for isolated environments

3. **SMALLER_BINARY Flag**
   - Strip template specializations
   - Remove unused aggregate implementations
   - Trade runtime performance for binary size

4. **Emscripten Optimization**
   ```bash
   -Os -fno-rtti -fno-exceptions -sASSERTIONS=0 -DNDEBUG
   -flto --closure 1 -sENVIRONMENT=web -sNO_EXIT_RUNTIME=1
   ```

5. **Export Symbol Filtering**
   - Only export necessary functions
   - Remove internal symbols, unwind functions

### Architecture Decisions

1. **Accept Single-Threaded Default**
   - Don't rely on SharedArrayBuffer
   - Threading as optional enhancement (COI variant)

2. **Web Worker Execution**
   - Run WASM in dedicated worker
   - Async API for main thread
   - Blocking operations don't freeze UI

3. **Arrow for Data Exchange**
   - Efficient cross-boundary data transfer
   - Avoids JS object serialization overhead

### What to Strip for Size

Based on DuckDB's approach, consider removing from core build:

| Feature | Impact | Notes |
|---------|--------|-------|
| ICU (Unicode) | Large | Load on demand |
| Parquet | Medium | Extension if analytics-focused |
| JSON functions | Small | Extension |
| Full-text search | Medium | Extension |
| HTTP/S3 filesystem | Medium | Extension |
| Advanced aggregates | Small | Use SMALLER_BINARY flag |

### Target Sizes

Based on DuckDB's experience:

| Goal | Size | Approach |
|------|------|----------|
| Minimal core | ~1-2 MB gzipped | SELECT/INSERT only, no formats |
| Standard | ~3-4 MB gzipped | Core + lazy extensions |
| Full featured | ~8-10 MB gzipped | Everything bundled |

### For Cloudflare Workers

If Workers support is required:
1. Keep WASM under 1 MB (very aggressive stripping)
2. Use async-compatible I/O patterns
3. Consider server-side rendering or hybrid approach
4. Stream large WASM modules from external storage

## References

- [DuckDB-WASM GitHub](https://github.com/duckdb/duckdb-wasm)
- [DuckDB WASM Documentation](https://duckdb.org/docs/stable/clients/wasm/overview)
- [DuckDB-Wasm VLDB Paper](https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf)
- [Extensions for DuckDB-Wasm](https://duckdb.org/2023/12/18/duckdb-extensions-in-wasm)
- [DuckDB Build Configuration](https://duckdb.org/docs/stable/dev/building/build_configuration)
- [Emscripten Optimization Guide](https://emscripten.org/docs/optimizing/Optimizing-Code.html)
- [DeepWiki DuckDB-WASM Analysis](https://deepwiki.com/duckdb/duckdb-wasm)
