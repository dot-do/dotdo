# Spike: Delta Lake Support for ClickHouse WASM

## Executive Summary

This spike investigates Delta Lake table format support in ClickHouse and its feasibility for the chdb-wasm project. Delta Lake is one of the three major open table formats (alongside Iceberg and Hudi) for data lakes, offering ACID transactions, time travel, and schema evolution.

**Key Findings**:
- ClickHouse has comprehensive Delta Lake support via the `deltaLake()` table function
- Two implementation paths exist: native JSON parser (always available) and delta-kernel-rs (Rust, experimental)
- The delta-kernel-rs dependency requires Rust and is **not compatible with WASM** (Linux x86_64/aarch64 only)
- Native Delta Lake support requires Parquet (USE_PARQUET), which adds ~20MB bundle size
- For WASM, a fallback to direct Parquet file access is more feasible

## 1. Delta Lake Fundamentals

### 1.1 What is Delta Lake?

Delta Lake is an open-source storage framework that brings ACID transactions to Apache Spark and big data workloads. Key features:

| Feature | Description |
|---------|-------------|
| ACID Transactions | Serializable isolation level, optimistic concurrency |
| Time Travel | Query data at any historical version |
| Schema Evolution | Add/change/delete columns without breaking pipelines |
| Audit History | Full transaction log for compliance |
| DML Operations | INSERT, UPDATE, DELETE, MERGE support |

### 1.2 Delta Lake Architecture

```
delta_table/
  _delta_log/                    # Transaction log directory
    00000000000000000000.json    # Version 0 transaction
    00000000000000000001.json    # Version 1 transaction
    00000000000000000002.json    # Version 2 transaction
    ...
    00000000000000000010.checkpoint.parquet  # Checkpoint (every 10 commits by default)
    _last_checkpoint            # Points to latest checkpoint
  part-00000-xxx.parquet        # Data files (Parquet format)
  part-00001-xxx.parquet
  ...
```

### 1.3 Transaction Log (_delta_log)

Each JSON file in `_delta_log` contains atomic actions:

```json
{"commitInfo":{"timestamp":1679424650713,"operation":"WRITE",...}}
{"protocol":{"minReaderVersion":2,"minWriterVersion":5}}
{"metaData":{"id":"uuid","format":{"provider":"parquet"},"schemaString":"..."}}
{"add":{"path":"part-00000.parquet","partitionValues":{},"size":2560,...}}
{"remove":{"path":"old-part.parquet","deletionTimestamp":1679424649000,...}}
```

Action types:
- **metaData**: Table schema, partition columns, configuration
- **protocol**: Reader/writer version requirements
- **add**: New data file added to table
- **remove**: Data file removed (soft delete for time travel)
- **txn**: Transaction identifier for idempotent writes

### 1.4 Checkpoints

Checkpoints consolidate the transaction log state into a Parquet file:
- Created every 10 commits by default
- Contains snapshot of all `add`, `remove`, and `metaData` actions
- Enables efficient reads without replaying entire log
- `_last_checkpoint` file points to latest checkpoint version

## 2. ClickHouse Delta Lake Implementation

### 2.1 Source Code Location

The Delta Lake implementation in `vendor/chdb` spans multiple directories:

| Path | Description |
|------|-------------|
| `src/Storages/ObjectStorage/DataLakes/DeltaLakeMetadata.cpp` | Native JSON-based implementation |
| `src/Storages/ObjectStorage/DataLakes/DeltaLakeMetadataDeltaKernel.cpp` | delta-kernel-rs integration |
| `src/Storages/ObjectStorage/DataLakes/DeltaLake/` | Advanced features (writes, partitions, etc.) |
| `src/TableFunctions/TableFunctionObjectStorage.cpp` | Table function registration |
| `contrib/delta-kernel-rs/` | Rust library for Delta protocol |

### 2.2 Two Implementation Paths

ClickHouse provides two ways to read Delta Lake tables:

**Path 1: Native JSON Parser** (`DeltaLakeMetadata`)
```cpp
// From DeltaLakeMetadata.cpp
// Parses _delta_log/*.json files directly
// Reads checkpoints as Parquet
// Limited to read-only operations
```

- Always available when `USE_PARQUET=ON`
- Parses JSON transaction logs with Poco::JSON
- Reads checkpoint Parquet files with Arrow
- No external Rust dependencies
- Read-only support

**Path 2: delta-kernel-rs** (`DeltaLakeMetadataDeltaKernel`)
```cpp
// From DeltaLakeMetadataDeltaKernel.h
#if USE_PARQUET && USE_DELTA_KERNEL_RS
class DeltaLakeMetadataDeltaKernel : public IDataLakeMetadata {
    bool supportsWrites() const override { return true; }
    // Full Delta protocol support via Rust FFI
};
#endif
```

- Requires `USE_DELTA_KERNEL_RS=ON`
- Rust library compiled via Cargo/Corrosion
- Supports reads AND writes
- Full Delta protocol compliance
- Experimental (controlled by `allow_experimental_delta_kernel_rs` setting)

### 2.3 Table Function Usage

```sql
-- Read Delta Lake table from S3
SELECT * FROM deltaLake('s3://bucket/path/to/delta_table/', 'access_key', 'secret_key')

-- With NOSIGN for public buckets
SELECT * FROM deltaLake('https://bucket.s3.amazonaws.com/delta_table/', NOSIGN)

-- Local file system
SELECT * FROM deltaLake('file:///path/to/delta_table/')
```

### 2.4 Storage Configuration

From `src/Storages/ObjectStorage/DataLakes/DataLakeConfiguration.h`:

```cpp
// Storage backends supported
#if USE_PARQUET
#if USE_AWS_S3
using StorageS3DeltaLakeConfiguration = DataLakeConfiguration<StorageS3Configuration, DeltaLakeMetadata>;
#endif
#if USE_AZURE_BLOB_STORAGE
using StorageAzureDeltaLakeConfiguration = DataLakeConfiguration<StorageAzureConfiguration, DeltaLakeMetadata>;
#endif
using StorageLocalDeltaLakeConfiguration = DataLakeConfiguration<StorageLocalConfiguration, DeltaLakeMetadata>;
#endif
```

Supported storage backends:
- **S3** (AWS S3, MinIO, R2, etc.)
- **Azure Blob Storage**
- **Local filesystem**

## 3. delta-kernel-rs Analysis

### 3.1 What is delta-kernel-rs?

delta-kernel-rs is an official Delta Lake project providing a Rust/C library for building Delta connectors:

From `contrib/delta-kernel-rs/README.md`:
> Delta-kernel-rs is an experimental Delta implementation focused on interoperability with a wide range of query engines. It currently supports reads and (experimental) writes.

### 3.2 CMake Integration

From `contrib/delta-kernel-rs-cmake/CMakeLists.txt`:

```cmake
# Platform restrictions
if (NOT ENABLE_LIBRARIES OR NOT OS_LINUX OR (NOT ARCH_AMD64 AND NOT ARCH_AARCH64)
    OR (SANITIZE STREQUAL "memory") OR NO_ARMV81_OR_HIGHER)
  message(STATUS "Disabling delta kernel because of incompatible platform or Rust is disabled")
  set(USE_DELTA_KERNEL_RS 0)
endif()

# Build configuration
clickhouse_import_crate(
    MANIFEST_PATH "${DELTA_KERNEL_RS_SOURCE_DIR}/ffi/Cargo.toml"
    FEATURES "default-engine, test-ffi, tracing"
)
```

### 3.3 Platform Compatibility

| Platform | delta-kernel-rs Support |
|----------|------------------------|
| Linux x86_64 | Yes |
| Linux aarch64 | Yes |
| macOS (Darwin) | No (requires system frameworks) |
| Windows | No |
| **WASM/Emscripten** | **No** |

The library depends on:
- Rust toolchain
- OpenSSL (native bindings)
- AWS SDK (for S3 access)
- System libraries for HTTP/networking

### 3.4 FFI Interface

The delta-kernel-rs library exposes a C FFI for use from C++:

```cpp
// From DeltaLake/KernelHelper.h
namespace ffi {
    struct EngineBuilder;
}

class IKernelHelper {
public:
    virtual const std::string & getTableLocation() const = 0;
    virtual ffi::EngineBuilder * createBuilder() const = 0;
};
```

The FFI uses Arrow for data exchange, making it efficient but tightly coupled to the Rust runtime.

## 4. Comparison: Delta Lake vs Iceberg

### 4.1 Feature Comparison

| Feature | Delta Lake | Iceberg |
|---------|------------|---------|
| Transaction Log | JSON files + Parquet checkpoints | Avro manifest files |
| Schema Storage | Embedded in metaData action | Separate schema files |
| Partition Evolution | Limited | Full support |
| Hidden Partitioning | No | Yes |
| Time Travel | Version numbers | Snapshots |
| Write Support in ClickHouse | With delta-kernel-rs | Native |
| ClickHouse Maturity | Newer, experimental | More mature |

### 4.2 ClickHouse Implementation Comparison

| Aspect | Delta Lake | Iceberg |
|--------|------------|---------|
| Dependency | USE_PARQUET, optionally USE_DELTA_KERNEL_RS | USE_AVRO |
| Read Support | Both implementations | Native |
| Write Support | Only with delta-kernel-rs | Native |
| Schema Evolution | Limited | Full |
| Catalog Integration | Unity Catalog | REST, Glue, HMS |
| Code Complexity | Moderate | Higher |

### 4.3 Ecosystem Compatibility

**Delta Lake**:
- Primary: Databricks, Spark
- Also: Trino, Presto, Flink, Hive
- Cloud: Azure Synapse, Databricks on all clouds
- Catalog: Unity Catalog (Databricks)

**Iceberg**:
- Primary: Netflix, Apple, LinkedIn
- Also: Spark, Trino, Flink, Dremio, StarRocks
- Cloud: AWS Athena, Snowflake, Google BigQuery
- Catalog: REST, AWS Glue, Hive Metastore

## 5. WASM Compatibility Analysis

### 5.1 Current Build Configuration

From `src/configure_config.cmake`:

```cmake
if (TARGET ch_contrib::parquet AND NOT ARCH_WASM AND NOT OS_EMSCRIPTEN)
    set(USE_PARQUET 1)
    set(USE_ARROW 1)
    set(USE_ORC 1)
endif()
```

**Critical Finding**: Parquet is explicitly disabled for WASM builds.

### 5.2 Blocking Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| delta-kernel-rs requires Rust | Critical | Cannot compile to WASM |
| Parquet disabled for WASM | Critical | Even native Delta parsing unavailable |
| OpenSSL dependency | High | delta-kernel-rs needs native OpenSSL |
| S3 client in delta-kernel-rs | High | Rust AWS SDK not WASM-compatible |
| Memory for transaction log | Medium | Large tables have many log files |

### 5.3 Native Delta Lake Parser (without delta-kernel-rs)

Even without delta-kernel-rs, the native JSON parser could work IF Parquet were enabled:

```cpp
// From DeltaLakeMetadata.cpp
#if USE_PARQUET
// Native implementation available
DeltaLakeMetadata::DeltaLakeMetadata(...) {
    auto impl = DeltaLakeMetadataImpl(object_storage_, configuration_, context_);
    auto result = impl.processMetadataFiles();
    // Parses JSON logs and Parquet checkpoints
}
#endif
```

Requirements:
1. Enable Parquet for WASM (adds ~20MB)
2. JSON parsing (already available via Poco)
3. Arrow for checkpoint reading (included with Parquet)

### 5.4 Feasibility Assessment

| Approach | WASM Feasibility | Effort | Notes |
|----------|-----------------|--------|-------|
| delta-kernel-rs | Not Possible | N/A | Rust FFI not WASM-compatible |
| Native with Parquet | Possible | High | Requires enabling Parquet for WASM |
| Direct Parquet access | Easy | Low | Read data files without Delta metadata |
| Custom JS implementation | Possible | Medium | Parse _delta_log in JavaScript |

## 6. Recommended Approach for WASM

### 6.1 Short-term: Direct Parquet Access

For MVP, bypass Delta Lake metadata and read Parquet files directly:

```typescript
// Read specific Parquet file from Delta table
const result = await chdb.query(`
  SELECT * FROM file('r2://bucket/delta_table/part-00000.parquet', Parquet)
  WHERE condition
`);
```

Limitations:
- No automatic file discovery
- No schema evolution
- No time travel
- No partition pruning

### 6.2 Medium-term: JavaScript Delta Reader

Implement a lightweight Delta Lake reader in JavaScript/TypeScript:

```typescript
// delta-reader.ts
export class DeltaLakeReader {
  async listDataFiles(path: string): Promise<string[]> {
    // 1. Read _last_checkpoint
    const lastCheckpoint = await this.readLastCheckpoint(path);

    // 2. Read checkpoint parquet (if exists)
    const checkpointFiles = lastCheckpoint
      ? await this.readCheckpoint(path, lastCheckpoint.version)
      : new Set<string>();

    // 3. Read JSON logs after checkpoint
    const logFiles = await this.readJsonLogs(path, lastCheckpoint?.version || 0);

    // 4. Apply add/remove actions
    return this.computeActiveFiles(checkpointFiles, logFiles);
  }
}
```

This approach:
- Parses `_delta_log` JSON files in JavaScript
- Requires parquet-wasm for checkpoint reading
- Provides file list to ClickHouse for querying
- Supports time travel by version number

### 6.3 Long-term: Enable Parquet for WASM

If Parquet support becomes available for WASM (per spike-parquet-wasm.md):

1. The native `DeltaLakeMetadata` implementation would work
2. Full `deltaLake()` table function available
3. Automatic schema inference
4. Partition pruning

## 7. Implementation Plan

### Phase 1: Direct Parquet (1 day)
- Document how to manually query Delta Lake data files
- Add utility to list Parquet files in a Delta table directory

### Phase 2: JS Delta Reader (1 week)
- Implement `DeltaLakeReader` class
- Parse `_last_checkpoint` and JSON logs
- Integrate with parquet-wasm for checkpoints
- Return file list for ClickHouse queries

### Phase 3: Full Integration (depends on Parquet WASM)
- Enable Parquet in standard WASM profile
- Native `deltaLake()` table function
- Test with R2 storage

## 8. Memory Budget for Delta Lake

### 8.1 Transaction Log Size Estimates

| Table Size | Approx Log Files | Log Size | Checkpoint Size |
|------------|------------------|----------|-----------------|
| 10 files | 10-20 | ~50KB | ~5KB |
| 100 files | 50-100 | ~500KB | ~50KB |
| 1000 files | 200-500 | ~5MB | ~500KB |
| 10000 files | 1000+ | ~50MB | ~5MB |

### 8.2 WASM Memory Requirements

```
Total Available:                128MB
----------------------------------------
V8 Runtime Overhead:            ~10MB
Worker Script + Dependencies:    ~5MB
WASM Module (minimal):          ~15MB
Delta Log Parsing:               ~5MB (for moderate tables)
Parquet File Buffer:            ~40MB
Query Working Memory:           ~40MB
Safety Margin:                  ~13MB
```

Maximum safe Delta table: ~1000 data files

## 9. Test Data and Validation

### 9.1 Public Delta Lake Datasets

From `tests/test_delta_lake.py`:

```python
# Public S3 dataset for testing
SELECT * FROM deltaLake(
    'https://clickhouse-public-datasets.s3.amazonaws.com/delta_lake/hits/',
    NOSIGN
)
```

### 9.2 Creating Test Data

Using the utility script `utils/data-lakes-importer.py`:

```bash
# Convert Parquet to Delta Lake format
./data-lakes-importer.py delta input.parquet /path/to/delta_table
```

## 10. Conclusion

Delta Lake support in ClickHouse WASM faces significant challenges:

1. **delta-kernel-rs is not WASM-compatible** - The Rust library cannot be compiled to WebAssembly due to dependencies on native libraries and the Rust runtime.

2. **Native parser requires Parquet** - The pure C++ implementation depends on Parquet being enabled, which is currently disabled for WASM.

3. **Recommended approach** - Implement a JavaScript-based Delta Lake reader that parses the transaction log and provides file lists to ClickHouse for direct Parquet queries.

For users who need Delta Lake support today, the best option is to:
- Use the standard Parquet file access pattern
- Manually handle file discovery
- Consider preprocessing Delta tables to plain Parquet on the server side

Long-term, enabling Parquet for WASM would unlock native Delta Lake read support without requiring delta-kernel-rs.

## References

- [Delta Lake Protocol](https://github.com/delta-io/delta/blob/master/PROTOCOL.md)
- [delta-kernel-rs GitHub](https://github.com/delta-io/delta-kernel-rs)
- [ClickHouse Delta Lake Documentation](https://clickhouse.com/docs/en/integrations/data-ingestion/data-formats/parquet/deltalake)
- [Databricks Unity Catalog](https://docs.databricks.com/data-governance/unity-catalog/index.html)
- [spike-parquet-wasm.md](./spike-parquet-wasm.md) - Parquet support analysis
