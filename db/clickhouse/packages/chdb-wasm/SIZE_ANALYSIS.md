# chdb-wasm Size Analysis Report

## Executive Summary

This report analyzes strategies to reduce chdb (ClickHouse) WASM binary size to fit within Cloudflare Workers' ~10-15MB limit. Based on analysis of the chdb codebase and DuckDB WASM's successful approach (~17MB full, ~6MB stripped core), we identify actionable cuts to achieve a minimal ~10MB build.

**Current Status:** Full chdb compilation to WASM faces fundamental architecture constraints (see BUILD_RESULTS.md). This analysis assumes those constraints are addressed and focuses on size optimization.

**Target:** ~10MB uncompressed WASM (~3-4MB gzipped/brotli compressed)

---

## Part 1: DuckDB WASM Reference Analysis

### DuckDB WASM Size Metrics

| Variant | Raw Size | Compressed | Notes |
|---------|----------|------------|-------|
| Full (all features) | ~17-18 MB | ~6-7 MB | Includes all extensions bundled |
| EH variant | ~33 MB | ~12 MB | Exception handling build |
| Core (stripped) | ~6.4 MB | ~2.5 MB | Extensions loaded dynamically |
| sql.js (SQLite) | ~599 KB | ~200 KB | Reference point |

Sources: [DuckDB WASM GitHub](https://github.com/duckdb/duckdb-wasm), [DuckDB WASM Discussions](https://github.com/duckdb/duckdb-wasm/discussions/1469)

### How DuckDB Achieved Small Size

1. **Extension Lazy Loading**
   - Core extensions (Parquet, JSON, ICU, autocomplete) are NOT bundled
   - Extensions fetched at runtime via Emscripten's `dlopen`
   - Extensions served pre-compressed with Brotli
   - URL pattern: `extensions.duckdb.org/duckdb-wasm/$version/$platform/$name.wasm`

2. **Build Optimizations**
   - Multiple build variants (MVP, EH, COI) for different browser capabilities
   - Aggressive LTO (Link-Time Optimization)
   - wasm-opt post-processing with Binaryen
   - Closure Compiler for JavaScript

3. **Architecture Decisions**
   - Single-threaded by default (threading optional with SharedArrayBuffer)
   - Apache Arrow for data exchange (zero-copy reads)
   - Virtual filesystem abstraction
   - HTTP layer in JavaScript, not native code

### Key Takeaway

DuckDB's approach: **Small core + dynamic extension loading** = ~6MB initial download

---

## Part 2: chdb/ClickHouse Source Size Analysis

### Source Directory Breakdown

| Directory | Size | Description | WASM Feasibility |
|-----------|------|-------------|------------------|
| `/src/Storages/` | 12 MB | Storage engines | Mostly excludable |
| `/src/Functions/` | 11 MB | SQL functions | Highly reducible |
| `/src/Interpreters/` | 6.7 MB | Query execution | Core required |
| `/src/Common/` | 6.1 MB | Utilities | Partially required |
| `/src/Processors/` | 5.5 MB | Query pipeline | Core required |
| `/src/Parsers/` | 3.7 MB | SQL parsing | Required |
| `/src/IO/` | 2.3 MB | I/O operations | Partially required |
| `/src/DataTypes/` | 2.0 MB | Type system | Required |
| `/src/Client/` | 2.0 MB | Client interface | Excludable |
| `/src/AggregateFunctions/` | 1.9 MB | Aggregates | Reducible |
| **Total /src/** | **68 MB** | | |

### Storage Engine Size Impact

| Engine Category | Source Size | Est. Compiled | Exclusion Savings |
|-----------------|-------------|---------------|-------------------|
| MergeTree family | 4.3 MB | 2-3 MB | **High priority** |
| System tables | 1.5 MB | 0.5-1 MB | Keep minimal set |
| Object Storage (S3/Azure/HDFS) | 1.1 MB | 1-2 MB + 5-10 MB SDKs | **High priority** |
| Message Queues (Kafka/RabbitMQ/NATS) | 556 KB | 500 KB-1 MB + 3-5 MB libs | **High priority** |
| External DBs (PostgreSQL/MySQL/MongoDB) | 440 KB | 300-500 KB + 2-5 MB libs | **High priority** |
| Distributed | 148 KB | 100-200 KB | **High priority** |
| Complex Views | 248 KB | 150-250 KB | Medium priority |
| File-based | 180 KB | 100-150 KB | Medium priority |
| **Essential (Memory/View/Null)** | **~35 KB** | **~20-30 KB** | Keep |

### Function Size Impact

| Category | Source Files | Source Size | Est. Compiled |
|----------|--------------|-------------|---------------|
| Full Functions | ~618 files | 11 MB | 4-6 MB |
| Full AggregateFunctions | ~100 files | 1.9 MB | 1-2 MB |
| **Minimal whitelist** | **~80 files** | **~500 KB** | **~200-400 KB** |

### Contrib Library Impact (Massive)

| Library | Source Size | Est. Compiled | Impact |
|---------|-------------|---------------|--------|
| llvm-project | 1.9 GB | 10-20 MB | JIT compiler - **EXCLUDE** |
| AWS SDK | 944 MB | 8-12 MB | S3 support - **EXCLUDE** |
| Boost | 888 MB | 2-4 MB | Partial use - **MINIMIZE** |
| Rust vendor | 440 MB | 2-5 MB | Delta Lake etc - **EXCLUDE** |
| Google Cloud | 369 MB | 3-5 MB | GCS support - **EXCLUDE** |
| ICU | 311+287 MB | 5-8 MB | Unicode - **EXCLUDE** |
| Arrow | 125 MB | 15-20 MB | Parquet/Arrow - **EXCLUDE** |
| Protobuf | 93 MB | 3-5 MB | Protobuf format - **EXCLUDE** |
| gRPC | 87 MB | 5-8 MB | Arrow Flight - **EXCLUDE** |
| PostgreSQL client | 140 MB | 1-2 MB | PG engine - **EXCLUDE** |
| RocksDB | 43 MB | 3-5 MB | RocksDB engine - **EXCLUDE** |
| H3 | 45 MB | 1-2 MB | Geo indexing - **EXCLUDE** |

---

## Part 3: Existing Minimal Build Configuration

The `/packages/chdb-wasm/cmake/` directory already contains comprehensive profiles:

### wasm-minimal.cmake (Current)

Disables:
- Cloud Storage (S3, Azure, GCS, HDFS)
- Database Integrations (Kafka, Cassandra, MongoDB, PostgreSQL, MySQL, AMQP, NATS)
- Heavy Compute (LLVM JIT, DWARF parser)
- Data Formats (Parquet, Avro, Protobuf, Cap'n Proto)
- Networking (gRPC, NuRaft)
- Misc (RocksDB, S2 Geometry, H3, ICU, Vectorscan, NLP, Rust components)

**Estimated savings:** ~44-73 MB (before compression)

### wasm-engines.cmake (Current)

Engine levels:
- **minimal**: Memory only (~27KB source)
- **essential**: Memory, View, System, Null (~1.5MB source)
- **light**: + Set, Join, Buffer, GenerateRandom, Values

**Heavy engines excluded:** MergeTree family, Distributed, all Message Queues, all Object Storage, all External Databases

**Estimated savings:** ~8MB source, ~20-30MB compiled + dependencies

### wasm-formats.cmake (Current)

Disabled formats:
- Parquet (~16-20 MB)
- Arrow (~8-12 MB)
- ORC (~4-6 MB)
- Avro (~2-3 MB)
- Protobuf (~3-5 MB)
- Cap'n Proto (~1-2 MB)
- MessagePack (~0.5-1 MB)

**Kept formats:** JSON, CSV, TSV, Native, Values

**Estimated savings:** 16-37 MB

### minimal-functions.cmake (Current)

Whitelist includes:
- Arithmetic: +, -, *, /, %, abs, negate, greatest, least
- Comparison: =, !=, <, >, <=, >=
- Logical: AND, OR, NOT, XOR, IF, CASE WHEN
- Strings: length, substring, concat, lower, upper, trim, replace, position
- Conversion: CAST, toString, toInt*, toFloat*, toDate*
- Null handling: isNull, coalesce, ifNull, nullIf
- Date/Time: now, today, toYear, toMonth, toDate, toDateTime
- Aggregates: COUNT, SUM, AVG, MIN, MAX, ANY
- Arrays: array, length, element access, indexOf, has

**Estimated savings:** 2-4 MB uncompressed, 500KB-1MB gzipped

---

## Part 4: Recommended Cuts for ~10MB Build

### Tier 1: Critical Exclusions (MUST DO)

| Component | Raw Savings | Gzipped Savings | Priority |
|-----------|-------------|-----------------|----------|
| LLVM/JIT Compiler | 10-20 MB | 4-8 MB | P0 |
| AWS SDK | 8-12 MB | 3-5 MB | P0 |
| Google Cloud SDK | 3-5 MB | 1-2 MB | P0 |
| Apache Arrow/Parquet | 15-20 MB | 5-8 MB | P0 |
| MergeTree Engine | 2-3 MB | 1 MB | P0 |
| ICU Unicode | 5-8 MB | 2-3 MB | P0 |
| gRPC | 5-8 MB | 2-3 MB | P0 |
| Protobuf | 3-5 MB | 1-2 MB | P0 |
| **Tier 1 Total** | **~51-81 MB** | **~19-31 MB** | |

### Tier 2: Important Exclusions (SHOULD DO)

| Component | Raw Savings | Gzipped Savings | Priority |
|-----------|-------------|-----------------|----------|
| RocksDB | 3-5 MB | 1-2 MB | P1 |
| Database Connectors (all) | 5-10 MB | 2-4 MB | P1 |
| Message Queues (all) | 3-5 MB | 1-2 MB | P1 |
| H3 Geo Indexing | 1-2 MB | 500 KB | P1 |
| S2 Geometry | 1-2 MB | 500 KB | P1 |
| Advanced Functions (~500) | 3-5 MB | 1-2 MB | P1 |
| Advanced Aggregates (~80) | 1-2 MB | 500 KB | P1 |
| **Tier 2 Total** | **~17-31 MB** | **~6.5-12 MB** | |

### Tier 3: Additional Optimizations (NICE TO HAVE)

| Technique | Raw Savings | Gzipped Savings | Priority |
|-----------|-------------|-----------------|----------|
| -Oz optimization | 10-20% | 5-10% | P2 |
| LTO (Link-Time Optimization) | 5-15% | 5-10% | P2 |
| wasm-opt post-processing | 10-20% | 5-15% | P2 |
| Closure Compiler (JS) | N/A | 20-50% JS | P2 |
| Strip debug symbols | 30-50% | 10-20% | P2 |
| emmalloc allocator | 50 KB | 20 KB | P2 |

---

## Part 5: Feature Comparison with DuckDB WASM

| Feature | DuckDB WASM | chdb-wasm (Proposed Minimal) | Notes |
|---------|-------------|------------------------------|-------|
| **Core SQL** | Full | Full | Both support standard SQL |
| **Storage** | In-memory + extensions | Memory only | DuckDB loads extensions dynamically |
| **Formats - JSON** | Extension (lazy) | Built-in | chdb simpler |
| **Formats - CSV** | Built-in | Built-in | Equivalent |
| **Formats - Parquet** | Extension (lazy) | Not included | Could add as extension later |
| **Aggregates** | Full | Minimal (COUNT/SUM/AVG/MIN/MAX) | DuckDB has more |
| **Window Functions** | Full | Limited/None | Major gap |
| **CTEs** | Full | Limited | Gap |
| **Joins** | Full | Full (Memory engine) | Equivalent |
| **Subqueries** | Full | Full | Equivalent |
| **Types** | Standard SQL + extensions | ClickHouse types | Different type systems |
| **Threading** | Single (default) + optional multi | Single only | Equivalent for WASM |
| **Initial Download** | ~6 MB (core) | ~10 MB (target) | chdb slightly larger |
| **Extension Loading** | Dynamic | Not planned | Future improvement |

### chdb Advantages Over DuckDB WASM

1. **ClickHouse SQL Compatibility** - Native support for ClickHouse dialect
2. **Column-oriented from ground up** - Not an add-on
3. **Rich type system** - LowCardinality, Nested, Tuple, Map
4. **ClickHouse functions** - arrayJoin, groupArray, etc.

### chdb Disadvantages vs DuckDB WASM

1. **Larger base size** - More complex codebase
2. **No extension system** - All features must be bundled
3. **Threading assumptions** - Harder to strip
4. **64-bit assumptions** - WASM32 compatibility issues

---

## Part 6: Proposed Build Profile

### chdb-wasm "Cloudflare" Profile

```cmake
# Profile: cloudflare-minimal
# Target: ~10MB raw, ~3-4MB gzipped

# === Storage Engines ===
set(CHDB_WASM_ENGINE_LEVEL "essential")  # Memory, View, System, Null

# === Data Formats ===
set(ENABLE_PARQUET OFF)
set(ENABLE_ARROW OFF)
set(ENABLE_AVRO OFF)
set(ENABLE_PROTOBUF OFF)
set(ENABLE_CAPNP OFF)
set(ENABLE_MSGPACK OFF)
# Keep: JSON, CSV, TSV, Native, Values

# === Functions ===
set(CHDB_MINIMAL_FUNCTIONS ON)
# ~80 essential function files vs 618 full

# === External Integrations ===
set(ENABLE_AWS_S3 OFF)
set(ENABLE_AZURE_BLOB_STORAGE OFF)
set(ENABLE_GOOGLE_CLOUD_CPP OFF)
set(ENABLE_HDFS OFF)
set(ENABLE_KAFKA OFF)
set(ENABLE_AMQPCPP OFF)
set(ENABLE_NATS OFF)
set(ENABLE_MYSQL OFF)
set(ENABLE_LIBPQXX OFF)
set(USE_MONGODB OFF)
set(ENABLE_CASSANDRA OFF)
set(ENABLE_ROCKSDB OFF)
set(ENABLE_GRPC OFF)
set(ENABLE_SSL OFF)  # Not available in WASM anyway

# === Heavy Features ===
set(ENABLE_EMBEDDED_COMPILER OFF)  # LLVM JIT
set(ENABLE_DWARF_PARSER OFF)
set(ENABLE_ICU OFF)
set(ENABLE_H3 OFF)
set(ENABLE_S2_GEOMETRY OFF)
set(ENABLE_VECTORSCAN OFF)
set(ENABLE_NLP OFF)
set(ENABLE_RUST OFF)

# === Build Optimizations ===
set(CMAKE_BUILD_TYPE MinSizeRel)
set(CHDB_WASM_OPTIMIZE_SIZE ON)
set(CHDB_WASM_ULTRA_SIZE_OPT ON)  # -Oz
set(CHDB_WASM_LTO ON)
set(CHDB_WASM_DCE ON)
set(CHDB_WASM_CLOSURE_COMPILER ON)
set(CHDB_WASM_BINARYEN_OPTS ON)
set(CHDB_WASM_BINARYEN_LEVEL "z")  # Maximum size reduction
```

### Estimated Final Size

| Stage | Size |
|-------|------|
| After Tier 1 exclusions | ~30-40 MB |
| After Tier 2 exclusions | ~15-25 MB |
| After -Oz + LTO | ~10-18 MB |
| After wasm-opt | ~8-15 MB |
| **Target range** | **~10 MB raw** |
| **Gzipped** | **~3-4 MB** |
| **Brotli compressed** | **~2.5-3.5 MB** |

---

## Part 7: Alternative Approaches

### Option A: Hybrid Architecture (Recommended for Production)

1. **chdb Parser WASM** (~30KB) - Client-side SQL validation
2. **DuckDB WASM** (~6MB) - Client-side execution for simple queries
3. **chdb Server** - Server-side for complex queries

**Advantages:**
- Immediate implementation
- Best-in-class for each layer
- Fallback for unsupported features

### Option B: SQL Translation Layer

1. Parse SQL with chdb parser
2. Translate to DuckDB-compatible SQL
3. Execute on DuckDB WASM
4. Transform results back

**Challenges:**
- Type system differences
- Function compatibility
- ClickHouse-specific syntax

### Option C: Incremental Subsystem Extraction

1. Extract ClickHouse Type System (~200KB)
2. Add Memory Storage Engine (~300KB)
3. Add Core Functions (~500KB)
4. Add Basic Interpreter (~1MB)
5. Add Query Pipeline (~1.5MB)

**Total:** ~3.5MB for basic functionality

---

## Part 8: Action Items

### Immediate (Week 1)

1. [ ] Verify cmake profile `wasm-minimal.cmake` compiles successfully
2. [ ] Measure actual binary sizes with current exclusions
3. [ ] Identify remaining architecture blockers (arch.cmake, target.cmake)
4. [ ] Create patches for WASM platform support

### Short-term (Week 2-3)

1. [ ] Implement Emscripten toolchain integration
2. [ ] Add WASM-specific code paths for threading
3. [ ] Create minimal system tables subset
4. [ ] Test with Memory engine only

### Medium-term (Month 1-2)

1. [ ] Profile binary for additional size cuts
2. [ ] Implement extension-like lazy loading
3. [ ] Add optional Parquet support as separate WASM module
4. [ ] Performance benchmarking vs DuckDB WASM

---

## References

- [DuckDB WASM Overview](https://duckdb.org/docs/stable/clients/wasm/overview)
- [DuckDB WASM GitHub](https://github.com/duckdb/duckdb-wasm)
- [DuckDB WASM Binary Size Discussion](https://github.com/duckdb/duckdb-wasm/discussions/1469)
- [DuckDB WASM Extensions](https://duckdb.org/docs/stable/clients/wasm/extensions)
- [DuckDB-Wasm: Efficient Analytical SQL in the Browser](https://duckdb.org/2021/10/29/duckdb-wasm)
- [DeepWiki DuckDB WASM Analysis](https://deepwiki.com/duckdb/duckdb-wasm)

---

## Appendix A: Complete CMake Flag Reference

See individual cmake files for detailed documentation:
- `/packages/chdb-wasm/cmake/wasm-minimal.cmake`
- `/packages/chdb-wasm/cmake/wasm-engines.cmake`
- `/packages/chdb-wasm/cmake/wasm-formats.cmake`
- `/packages/chdb-wasm/cmake/wasm-integrations.cmake`
- `/packages/chdb-wasm/cmake/minimal-functions.cmake`
- `/packages/chdb-wasm/cmake/WasmOptimizations.cmake`

## Appendix B: Size Calculation Methodology

Estimates based on:
1. Source file sizes (du -sh)
2. Typical C++ to WASM compilation ratios (1:0.3 to 1:0.5)
3. LTO effectiveness (~15-30% reduction)
4. wasm-opt effectiveness (~10-20% reduction)
5. Compression ratios (gzip ~35-40%, brotli ~25-30%)

Actual sizes may vary based on compiler version, optimization settings, and code structure.
