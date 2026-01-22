# Spike: Apache Hudi Table Format Support for ClickHouse WASM

## Executive Summary

This spike investigates Apache Hudi table format support in ClickHouse and its feasibility for the chdb-wasm project. Hudi is one of the three major open table formats alongside Apache Iceberg and Delta Lake, designed for large-scale data lakes with incremental processing capabilities.

**Key Findings**:
- ClickHouse has basic Hudi support via `hudi()` table function (S3 only)
- Implementation is simpler than Iceberg/Delta Lake (no transaction log parsing)
- Only reads base files (Parquet), no log file support for merge-on-read
- No schema evolution or write support
- **WASM Feasibility**: Simpler implementation makes Hudi more viable than Iceberg for minimal profiles, but S3 dependency is a blocker

## 1. Apache Hudi Fundamentals

### 1.1 Overview

Apache Hudi (Hadoop Upserts Deletes and Incrementals) is an open table format designed for:
- **Upserts and Deletes**: Efficient updates to large datasets
- **Incremental Processing**: Query only changed data since last checkpoint
- **Time Travel**: Access historical versions of data
- **Stream Processing**: Near real-time data ingestion

### 1.2 Table Types

Hudi supports two table types:

| Type | Copy-on-Write (CoW) | Merge-on-Read (MoR) |
|------|---------------------|---------------------|
| **Write Pattern** | Synchronous merge during write | Async compaction |
| **Read Performance** | Fast (pre-merged Parquet) | Slower (merge at read time) |
| **Write Latency** | Higher | Lower |
| **File Types** | Base files only | Base files + log files |
| **Use Case** | Read-heavy workloads | Write-heavy workloads |

### 1.3 File Layout

Hudi organizes data with a specific naming convention:

```
tablePath/
├── .hoodie/
│   ├── metadata/            # Table metadata (optional)
│   ├── hoodie.properties    # Table configuration
│   └── <instant_time>.*     # Timeline events
├── partition=A/
│   ├── <fileId>_<writeToken>_<timestamp>.parquet  # Base files
│   └── .<fileId>_<writeToken>_<timestamp>.log     # Log files (MoR only)
└── partition=B/
    └── ...
```

**File naming format**: `[File ID]_[File Write Token]_[Transaction timestamp].[File Extension]`

Example: `a1b2c3d4_0-0-0_20240101120000.parquet`

### 1.4 Timeline Metadata

Hudi's timeline tracks table state changes:

| Component | Description |
|-----------|-------------|
| **Instant Time** | Monotonically increasing timestamp |
| **Action** | commit, deltacommit, compaction, clean, etc. |
| **State** | requested, inflight, completed |

Unlike Iceberg/Delta Lake, Hudi does NOT require parsing timeline for basic reads when data files follow the naming convention.

## 2. ClickHouse Hudi Implementation

### 2.1 Source Code Location

The Hudi implementation in vendor/chdb is minimal compared to Iceberg:

| Path | Description | Lines |
|------|-------------|-------|
| `src/Storages/ObjectStorage/DataLakes/HudiMetadata.h` | Header file | ~65 |
| `src/Storages/ObjectStorage/DataLakes/HudiMetadata.cpp` | Implementation | ~110 |
| `src/Storages/ObjectStorage/DataLakes/DataLakeConfiguration.h` | Configuration | (shared) |
| `src/TableFunctions/TableFunctionObjectStorage.*` | Table function | (shared) |

**Total Hudi-specific code**: ~175 lines

### 2.2 Key Implementation Details

From `HudiMetadata.cpp`:

```cpp
/**
 * Hudi tables store metadata files and data files.
 * Metadata files are stored in .hoodie/metadata directory. Though unlike
 * DeltaLake and Iceberg, metadata is not required in order to understand
 * which files we need to read, moreover, for Hudi metadata does not always exist.
 *
 * There can be two types of data files:
 * 1. base files (columnar file formats like Apache Parquet/Orc)
 * 2. log files
 * Currently we support reading only `base files`.
 */
```

**File Discovery Algorithm**:

```cpp
Strings HudiMetadata::getDataFilesImpl() const
{
    // List all files matching the format extension
    const auto keys = listFiles(*object_storage, *configuration_ptr, "",
                                Poco::toLower(configuration_ptr->format));

    // Parse file names to extract: file_id, write_token, timestamp
    for (const auto & key : keys) {
        // File format: [FileId]_[WriteToken]_[Timestamp].[ext]
        splitInto<'_'>(file_parts, stem);

        const auto & file_id = file_parts[0];
        const auto timestamp = parse<UInt64>(file_parts[2]);

        // Keep only latest version per file group (file_id)
        if (file_info.timestamp < timestamp) {
            file_info.key = key;
            file_info.timestamp = timestamp;
        }
    }
    return result;
}
```

### 2.3 Table Function and Storage Engine

**Table Function** (`hudi()`):

```sql
-- Basic usage
SELECT * FROM hudi('s3://bucket/path/to/hudi_table', 'access_key', 'secret_key')

-- With format specification (default: Parquet)
SELECT * FROM hudi('s3://bucket/path/', 'key', 'secret', 'Parquet')
```

**Storage Engine** (`Hudi`):

```sql
CREATE TABLE hudi_table
ENGINE = Hudi('s3://bucket/path/', 'access_key', 'secret_key')
```

### 2.4 Configuration and Registration

From `DataLakeConfiguration.h`:

```cpp
#if USE_AWS_S3
using StorageS3HudiConfiguration = DataLakeConfiguration<StorageS3Configuration, HudiMetadata>;
#endif
```

**Note**: Hudi support is **S3-only**. Unlike Iceberg which supports Azure, HDFS, and Local storage, Hudi is limited to S3.

Registration requires `USE_AWS_S3` compile flag:

```cpp
// From registerStorageObjectStorage.cpp
void registerStorageHudi(StorageFactory & factory)
{
#if USE_AWS_S3
    factory.registerStorage(
        HudiDefinition::storage_engine_name,  // "Hudi"
        [&](const StorageFactory::Arguments & args) { ... },
        { .supports_settings = false, .supports_schema_inference = true, ... });
#endif
}
```

## 3. Comparison with Iceberg and Delta Lake

### 3.1 Feature Matrix

| Feature | Hudi | Iceberg | Delta Lake |
|---------|------|---------|------------|
| **ClickHouse Read Support** | Basic | Comprehensive | Comprehensive |
| **Write Support** | No | Yes | No |
| **Schema Evolution** | No | Yes | No |
| **Time Travel** | No | Yes | Yes |
| **Partition Pruning** | No | Yes | Yes |
| **Predicate Pushdown** | No | Yes | Yes |
| **Storage Backends** | S3 only | S3, Azure, HDFS, Local | S3, Azure, Local |
| **Delete Support** | No | Yes | No |
| **Metadata Parsing** | None (file listing) | Avro manifests | JSON transaction log |
| **Dependencies** | USE_AWS_S3 | USE_AVRO | USE_PARQUET + delta-rs |

### 3.2 Implementation Complexity

```
Complexity (lines of code):
Hudi:      ~175 lines (simplest)
Delta:     ~3,000 lines (uses delta-kernel-rs)
Iceberg:   ~10,000+ lines (most comprehensive)
```

### 3.3 Use Case Fit

| Use Case | Best Format |
|----------|-------------|
| Read-only analytics from S3 | Hudi (simplest) |
| Schema evolution needed | Iceberg |
| Write support needed | Iceberg |
| Multiple storage backends | Iceberg or Delta Lake |
| Streaming CDC | Hudi (with full implementation) |
| ACID transactions | Iceberg |

## 4. WASM Compatibility Analysis

### 4.1 Current Blockers

| Blocker | Severity | Description |
|---------|----------|-------------|
| **S3 Dependency** | Critical | Hudi only supports S3, not local/VFS |
| **AWS SDK** | Critical | USE_AWS_S3 pulls in AWS C++ SDK |
| **No Schema** | Medium | `getTableSchema()` returns empty |
| **No Write Support** | Low | Read-only is acceptable for analytics |

### 4.2 Why S3-Only is a Problem

The chdb-wasm architecture uses R2 storage via VFS bridge:

```
Current Architecture:
R2 Storage → VFS Bridge → ClickHouse File I/O → Parquet Reader

Hudi Requirement:
S3 Storage → AWS SDK → ClickHouse S3 ObjectStorage → HudiMetadata
```

Hudi's implementation is tightly coupled to S3ObjectStorage, not the generic IObjectStorage interface used by VFS.

### 4.3 Potential Solutions

**Option A: Add Local Storage Support to Hudi**

Modify `DataLakeConfiguration.h` to support local storage:

```cpp
// Current (S3 only)
#if USE_AWS_S3
using StorageS3HudiConfiguration = DataLakeConfiguration<StorageS3Configuration, HudiMetadata>;
#endif

// Potential addition
using StorageLocalHudiConfiguration = DataLakeConfiguration<StorageLocalConfiguration, HudiMetadata>;
```

**Effort**: Low (~50 lines) but requires testing file listing on local FS.

**Option B: R2 as S3-Compatible Storage**

Cloudflare R2 is S3-compatible. If AWS SDK can be configured for R2:

```cpp
// Configure S3 client with R2 endpoint
S3Configuration config;
config.endpoint = "https://<account>.r2.cloudflarestorage.com";
config.region = "auto";
```

**Effort**: Medium - requires AWS SDK in WASM and R2 credential management.

**Option C: Implement Hudi-Style File Discovery in TypeScript**

Since Hudi doesn't require metadata parsing, implement file discovery in TypeScript:

```typescript
async function listHudiFiles(r2: R2Bucket, prefix: string): Promise<HudiFile[]> {
  const objects = await r2.list({ prefix });
  const fileGroups = new Map<string, HudiFile>();

  for (const obj of objects.objects) {
    // Parse: fileId_writeToken_timestamp.parquet
    const [fileId, writeToken, timestamp] = parseHudiFilename(obj.key);

    const existing = fileGroups.get(fileId);
    if (!existing || existing.timestamp < timestamp) {
      fileGroups.set(fileId, { key: obj.key, fileId, timestamp });
    }
  }

  return Array.from(fileGroups.values());
}
```

**Effort**: Low - but loses native ClickHouse integration.

### 4.4 Memory Considerations

Hudi's memory footprint is lower than Iceberg:
- No Avro parsing (Iceberg requires Avro for manifests)
- No transaction log parsing (Delta Lake requires JSON parsing)
- Simple file listing only

Estimated additional memory for Hudi support: **Minimal** (beyond Parquet reader)

## 5. Recommendations

### 5.1 For chdb-wasm Project

**Short Term**: Do not prioritize Hudi support

Reasons:
1. S3-only limitation is a significant blocker
2. Iceberg provides more features with existing implementation
3. Limited real-world use cases for Hudi in edge/WASM environments

**Medium Term**: Consider if R2-as-S3 becomes viable

If AWS SDK can be compiled for WASM with R2 compatibility, Hudi becomes trivial to add.

### 5.2 If Hudi Support is Needed

Implement Option C (TypeScript file discovery) as a fallback:

```typescript
// In src/table-engines/hudi.ts
export async function readHudiTable(
  r2: R2Bucket,
  path: string,
  query: string
): Promise<QueryResult> {
  // 1. List files and find latest versions
  const files = await listHudiFiles(r2, path);

  // 2. Read each Parquet file
  const allData = [];
  for (const file of files) {
    const data = await readParquetFile(r2, file.key);
    allData.push(...data);
  }

  // 3. Create temporary table and query
  await chdb.query(`CREATE TEMPORARY TABLE hudi_data ENGINE = Memory AS ${toSelectValues(allData)}`);
  return await chdb.query(query);
}
```

### 5.3 Priority Order for Table Formats

For chdb-wasm, prioritize table format support in this order:

1. **Parquet** (direct files) - Already supported via VFS
2. **Iceberg** - Comprehensive features, multiple backends
3. **Delta Lake** - Good features, delta-kernel-rs integration
4. **Hudi** - Only if S3/R2 compatibility is resolved

## 6. Technical Deep Dive: Hudi vs Iceberg Implementation

### 6.1 Metadata Interface Comparison

**HudiMetadata** (minimal):

```cpp
class HudiMetadata final : public IDataLakeMetadata, private WithContext
{
public:
    // Returns empty - no schema from metadata
    NamesAndTypesList getTableSchema() const override { return {}; }

    // Simple file listing
    ObjectIterator iterate(...) const override;

private:
    Strings getDataFilesImpl() const;  // Core logic: list + filter by timestamp
};
```

**IcebergMetadata** (comprehensive):

```cpp
class IcebergMetadata : public IDataLakeMetadata
{
public:
    // Full schema from Avro manifests
    NamesAndTypesList getTableSchema() const override;

    // Schema evolution
    std::shared_ptr<NamesAndTypesList> getInitialSchemaByPath(...) const override;
    std::shared_ptr<const ActionsDAG> getSchemaTransformer(...) const override;
    bool supportsSchemaEvolution() const override { return true; }

    // Time travel and updates
    bool supportsUpdate() const override { return true; }
    bool update(const ContextPtr &) override;

    // Write support
    bool supportsWrites() const override { return true; }
    SinkToStoragePtr write(...) override;

    // Delete/mutation support
    bool supportsDelete() const override { return true; }
    void mutate(...) override;

private:
    // Complex state management
    IcebergSchemaProcessor schema_processor;
    ManifestFileCacheKeys manifest_list;
    // ... many more fields
};
```

### 6.2 Why Hudi is Simpler

Hudi's design philosophy differs from Iceberg:

1. **Self-Describing File Names**: Version info embedded in filename
2. **No Manifest Parsing**: File listing is sufficient for basic reads
3. **Timestamp-Based Versioning**: Latest version = highest timestamp per file group

This simplicity means:
- No Avro dependency (unlike Iceberg)
- No transaction log parsing (unlike Delta Lake)
- Works with any file system that supports listing

## 7. Hudi Ecosystem Context

### 7.1 Real-World Usage

Hudi is primarily used for:
- **CDC Ingestion**: Uber (creator), data lake ingestion pipelines
- **Incremental ETL**: Streaming data processing
- **Data Lake ACID**: Before Iceberg became dominant

### 7.2 Industry Trends

The open table format landscape is consolidating:
- **Iceberg**: Becoming the de facto standard (Snowflake, Databricks support)
- **Delta Lake**: Strong in Databricks ecosystem
- **Hudi**: Declining relative popularity, specialized CDC use cases

### 7.3 Implications for chdb-wasm

For a WASM-based analytics engine on Cloudflare Workers:
- Iceberg provides the most value (broad ecosystem support)
- Hudi's CDC strengths are less relevant for edge analytics
- Focus resources on Iceberg/Parquet integration

## 8. Conclusion

Apache Hudi support in ClickHouse is basic but functional for S3-based read-only analytics. The implementation is remarkably simple (~175 lines) because Hudi's file naming convention eliminates the need for metadata parsing.

**For chdb-wasm**, Hudi support is **not recommended as a priority** due to:
1. S3-only limitation conflicts with R2/VFS architecture
2. Limited feature set compared to Iceberg
3. Declining ecosystem relevance

If Hudi support becomes necessary, the simplest approach is TypeScript-based file discovery using Hudi's naming conventions, feeding into the existing Parquet reader.

**Key Insight**: Hudi's simplicity is both its strength (easy to implement) and weakness (limited features). For a modern data lakehouse on WASM, Iceberg's comprehensive feature set justifies its additional complexity.

## References

- [Apache Hudi Documentation](https://hudi.apache.org/docs/)
- [Hudi Technical Specifications](https://hudi.apache.org/tech-specs/)
- [Hudi File Layouts](https://hudi.apache.org/docs/file_layouts/)
- [ClickHouse Hudi Documentation](https://clickhouse.com/docs/en/engines/table-engines/integrations/hudi)
- [Open Table Format Comparison](https://www.onehouse.ai/blog/apache-hudi-vs-delta-lake-vs-apache-iceberg-lakehouse-feature-comparison)
- [spike-parquet-wasm.md](./spike-parquet-wasm.md) - Parquet format analysis
- [spike-catalog-metadata.md](./spike-catalog-metadata.md) - Metadata architecture
