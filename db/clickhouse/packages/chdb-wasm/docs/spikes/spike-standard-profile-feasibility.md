# Spike: Standard Profile Feasibility (MergeTree + Parquet)

## Goal

Determine if we can build a standard profile (~15-25MB) that includes MergeTree and Parquet support for WASM.

## Executive Summary

**FEASIBILITY: PARTIALLY FEASIBLE with significant engineering effort**

Building a standard profile with MergeTree + Parquet is technically possible but faces substantial challenges:

| Component | Feasibility | Size Impact | Blocking Issues |
|-----------|-------------|-------------|-----------------|
| MergeTree | Medium | +2-4MB | File I/O abstraction needed |
| Parquet | High | +8-15MB | Arrow dependency is large |
| Combined | Medium-Low | 15-25MB | Total dependencies cascade |

**Recommendation:** Prioritize Parquet first (higher value, fewer blockers), then tackle MergeTree if there's demand for persistent storage in WASM.

---

## 1. Existing Build Configuration Analysis

### Current Profile System

The project already has a sophisticated multi-profile build system in `/packages/chdb-wasm/cmake/build-profiles.cmake`:

| Profile | Target Size | MergeTree | Parquet | Status |
|---------|-------------|-----------|---------|--------|
| core | ~50KB | No | No | Working (parser only) |
| minimal | ~5-10MB | No | No | Partially working |
| **standard** | ~15-25MB | **Yes** | **Yes** | **Target of this spike** |
| analytics | ~30-40MB | Yes | Yes | Not attempted |
| full | ~50MB+ | Yes | Yes | Not attempted |

### Standard Profile Configuration (from `build-profiles.cmake`)

```cmake
# Storage engines: Memory + MergeTree
set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
set(CHDB_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)

# Formats: JSON, CSV, Parquet
set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
set(CHDB_FORMAT_PARQUET ON CACHE BOOL "" FORCE)
```

---

## 2. MergeTree Analysis

### Source Size

```
/vendor/chdb/src/Storages/MergeTree/: 4.3MB
  - 160 .cpp files
  - Complex indexing, merging, mutations, replication
```

### MergeTree Dependencies

| Dependency | Required For | WASM Compatible |
|------------|--------------|-----------------|
| File I/O (mmap) | Data parts storage | **No** - needs VFS |
| Threading | Background merges | **Partial** - single-threaded mode |
| Compression (LZ4/ZSTD) | Column compression | **Yes** |
| Hashing | Checksums | **Yes** |
| ZooKeeper | Replication | **No** - network I/O |

### MergeTree WASM Challenges

1. **File System Operations**
   - MergeTree uses `mmap()` for memory-mapped files
   - Direct file I/O for data parts
   - **Solution:** Emscripten MEMFS or IndexedDB backend

2. **Background Processing**
   - Merge operations run in background threads
   - Mutations require async processing
   - **Solution:** Single-threaded mode with explicit flush

3. **Data Part Management**
   - Complex directory structure
   - Mark files, primary indexes
   - **Solution:** Virtual filesystem abstraction

### Estimated MergeTree WASM Size

| Component | Source | Est. WASM |
|-----------|--------|-----------|
| Core MergeTree | 2.5MB | 1.5-2MB |
| Indexing | 800KB | 500KB |
| Compression | 500KB | 300KB |
| **Total** | **4.3MB** | **2-3MB** |

---

## 3. Parquet/Arrow Analysis

### Source Sizes

```
/vendor/chdb/contrib/arrow/: 125MB (full Apache Arrow)
/vendor/chdb/contrib/thrift/: 21MB (Parquet dependency)
```

### Arrow-cmake Configuration

From `/vendor/chdb/contrib/arrow-cmake/CMakeLists.txt`:

- Uses custom build (not upstream Arrow CMake)
- Builds: Arrow core + Parquet + ORC adapters
- Dependencies: Flatbuffers, Boost, Thrift, compression libs

### Parquet Dependencies Chain

```
Parquet
  -> Arrow (core types, compute, IPC)
       -> Flatbuffers (~200KB)
       -> Double-conversion (~100KB)
       -> Compression (LZ4, ZSTD, Snappy, Brotli, zlib)
  -> Thrift (serialization)
       -> Boost (partial)
       -> zlib
  -> ORC (optional, bundled with Arrow)
       -> Protobuf
```

### Dependencies Already Available

| Dependency | Source Size | WASM Status |
|------------|-------------|-------------|
| LZ4 | 2.1MB | Compatible |
| ZSTD | 9.5MB | Compatible |
| zlib-ng | 7.7MB | Compatible |
| Snappy | 8.6MB | Compatible |
| Boost (partial) | 888MB total | Filesystem subset used |
| OpenSSL | 73MB | **Optional for encryption** |
| double-conversion | 19MB | Compatible |

### Estimated Parquet WASM Size

From `wasm-formats.cmake` analysis:

| Component | Est. WASM Size |
|-----------|----------------|
| Arrow core | 4-6MB |
| Parquet reader/writer | 3-5MB |
| ORC (optional) | 2-3MB |
| Thrift | 1-2MB |
| Compression libs | 2-3MB |
| **Total (Parquet only)** | **8-12MB** |
| **Total (with ORC)** | **12-16MB** |

### Parquet WASM Challenges

1. **Threading in Arrow**
   - Arrow uses thread pools for parallel reads
   - **Solution:** Disable `ARROW_ENABLE_THREADING`

2. **Memory Pool**
   - Arrow has its own memory management
   - jemalloc integration
   - **Solution:** Use emmalloc, disable jemalloc

3. **HDFS Adapter**
   - Arrow includes HDFS I/O
   - **Solution:** Exclude in build (already done in chdb)

---

## 4. Size Estimation for Standard Profile

### Component Breakdown

| Component | Min Size | Max Size | Notes |
|-----------|----------|----------|-------|
| Base Engine | 5MB | 8MB | Core interpreter, types |
| Memory Engine | 200KB | 400KB | Already working |
| MergeTree | 2MB | 4MB | Needs VFS abstraction |
| Parquet/Arrow | 8MB | 15MB | Largest component |
| JSON/CSV | 500KB | 1MB | Lightweight |
| Basic Functions | 1MB | 2MB | Already in minimal |
| **Total** | **~17MB** | **~30MB** | |

### Optimized Build Estimate

With aggressive optimization (-Oz, LTO, wasm-opt):

| Metric | Value |
|--------|-------|
| Uncompressed WASM | 18-25MB |
| Gzipped | 6-10MB |
| Brotli compressed | 5-8MB |

---

## 5. WASM Blocking Dependencies

### Current Blockers (from BUILD_RESULTS.md)

1. **Architecture Detection**
   - `cmake/arch.cmake` rejects wasm32
   - **Status:** Already patched in chdb-wasm

2. **Threading**
   - Full ClickHouse requires pthreads
   - **Status:** Single-threaded stubs available

3. **File I/O**
   - MergeTree needs filesystem
   - **Solution:** Emscripten MEMFS + IDBFS

### MergeTree-Specific Blockers

| Issue | Severity | Workaround |
|-------|----------|------------|
| mmap() calls | High | Replace with malloc/read |
| Background threads | High | Single-threaded mode |
| Replication | Low | Disable (local only) |
| File watching | Medium | Disable (no auto-refresh) |

### Parquet-Specific Blockers

| Issue | Severity | Workaround |
|-------|----------|------------|
| Thread pool | Medium | Disable threading |
| HDFS I/O | Low | Already excluded |
| Memory pool | Medium | Use emmalloc |
| Encryption | Low | Disable OpenSSL features |

---

## 6. Build Attempt Plan

### Phase 1: Parquet Only (Recommended First)

```bash
cmake -S . -B build-standard \
  -DCHDB_PROFILE=standard \
  -DENABLE_PARQUET=ON \
  -DCHDB_ENGINE_MERGETREE=OFF \  # Disable MergeTree first
  -DCMAKE_TOOLCHAIN_FILE=$EMSDK/.../Emscripten.cmake
```

Expected outcome:
- Parquet read/write for in-memory data
- ~15-20MB WASM

### Phase 2: Add MergeTree

```bash
cmake -S . -B build-standard \
  -DCHDB_PROFILE=standard \
  -DENABLE_PARQUET=ON \
  -DCHDB_ENGINE_MERGETREE=ON \
  -DCHDB_MERGETREE_USE_MEMFS=ON \  # Use memory filesystem
  -DCMAKE_TOOLCHAIN_FILE=$EMSDK/.../Emscripten.cmake
```

Expected outcome:
- MergeTree with in-memory storage
- ~20-25MB WASM

### Phase 3: Persistent Storage

Add IndexedDB backing for MergeTree:
- Store data parts in browser IndexedDB
- Restore on page load
- ~25-30MB WASM

---

## 7. Required Engineering Work

### For Parquet (Estimated: 2-3 days)

1. **Arrow build integration**
   - Verify Emscripten compatibility
   - Disable threading
   - Test memory allocation

2. **Format registration**
   - Enable ParquetBlockInputFormat
   - Enable ParquetBlockOutputFormat
   - Test read/write cycle

### For MergeTree (Estimated: 5-10 days)

1. **VFS abstraction layer** (2-3 days)
   - Create Emscripten-compatible file operations
   - Map to MEMFS or IDBFS

2. **Single-threaded mode** (1-2 days)
   - Disable background merge threads
   - Add explicit flush() API
   - Remove mutation background processing

3. **Simplified part management** (2-3 days)
   - Remove replication code paths
   - Simplify data part lifecycle
   - Remove ZooKeeper dependencies

4. **Testing** (1-2 days)
   - Basic CRUD operations
   - Data persistence with IndexedDB

---

## 8. Roadmap

### Priority Order

1. **Parquet Format** (High Value, Medium Effort)
   - Most requested feature for analytics
   - Well-defined scope
   - Fewer WASM-specific issues

2. **MergeTree Engine** (Medium Value, High Effort)
   - Enables persistent storage
   - Complex VFS requirements
   - May need significant refactoring

### Blockers to Resolve

| Blocker | Priority | Effort | Owner |
|---------|----------|--------|-------|
| Arrow/Parquet WASM build | P0 | 2-3 days | - |
| Single-threaded Arrow | P0 | 1 day | - |
| MergeTree VFS | P1 | 3-5 days | - |
| Background thread stubs | P1 | 1-2 days | - |
| IndexedDB integration | P2 | 2-3 days | - |

---

## 9. Alternative Approaches

### Option A: Parquet Only (No MergeTree)

- Enable Parquet for data import/export
- Keep Memory engine for runtime
- ~15-18MB WASM
- **Recommended for MVP**

### Option B: Lightweight Persistence

- Use Log engine instead of MergeTree
- Simpler file I/O requirements
- ~12-15MB WASM
- Lower functionality

### Option C: External File System

- Use worker-level file abstraction
- OPFS (Origin Private File System) for persistence
- ~18-22MB WASM
- Browser-specific

---

## 10. Conclusion

**Building the standard profile (~15-25MB) with MergeTree + Parquet is feasible but requires significant engineering effort.**

### Summary

| Feature | Feasibility | Effort | Recommendation |
|---------|-------------|--------|----------------|
| Parquet | **HIGH** | 2-3 days | Do first |
| MergeTree | **MEDIUM** | 5-10 days | Do if needed |
| Combined | **MEDIUM** | 8-14 days | Phase approach |

### Immediate Next Steps

1. Attempt Parquet-only standard build
2. Measure actual WASM output size
3. Test Parquet read/write in Workers
4. If successful, evaluate MergeTree need

### Target Metrics

| Metric | Goal | Stretch |
|--------|------|---------|
| WASM Size | 20MB | 15MB |
| Gzipped | 8MB | 5MB |
| Cold Start | <500ms | <200ms |
| Query Time | <100ms | <50ms |

---

## References

- `/packages/chdb-wasm/cmake/build-profiles.cmake` - Profile definitions
- `/packages/chdb-wasm/cmake/wasm-formats.cmake` - Format configuration
- `/packages/chdb-wasm/cmake/wasm-engines.cmake` - Engine configuration
- `/packages/chdb-wasm/SIZE_ANALYSIS.md` - Detailed size analysis
- `/packages/chdb-wasm/BUILD_RESULTS.md` - Previous build attempts
- `/vendor/chdb/contrib/arrow-cmake/CMakeLists.txt` - Arrow build config
