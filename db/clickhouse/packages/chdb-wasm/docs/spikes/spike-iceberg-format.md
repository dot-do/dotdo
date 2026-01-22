# Spike: Apache Iceberg Table Format Support for ClickHouse WASM

## Executive Summary

This spike investigates Apache Iceberg table format support for the chdb-wasm project, examining ClickHouse's native Iceberg implementation and its feasibility for WASM deployment. The goal is to determine if Iceberg tables stored on R2/S3-compatible storage can be queried from Cloudflare Workers.

**Key Finding**: ClickHouse has comprehensive Iceberg support (~10,000 LOC) with read and write capabilities. However, Iceberg depends on Avro for metadata parsing and S3 SDK for cloud storage access. For WASM, a simplified read-only approach using IcebergLocal with VFS abstraction is most feasible.

## 1. Apache Iceberg Fundamentals

### 1.1 What is Apache Iceberg?

Apache Iceberg is an open table format for huge analytic datasets. It is not a storage format itself but a **table format** - a specification for how to organize data files, track schema evolution, and manage snapshots.

Key characteristics:
- **Table format, not file format**: Uses Parquet, ORC, or Avro as underlying storage
- **Schema evolution**: Add, drop, rename columns without rewriting data
- **Time travel**: Query historical snapshots of data
- **ACID transactions**: Atomic commits with snapshot isolation
- **Hidden partitioning**: Partition data without exposing partition columns in queries

### 1.2 Three-Layer Architecture

| Layer | Component | Format | Purpose |
|-------|-----------|--------|---------|
| Catalog | Pointer file | Text/JSON | Maps table name to current metadata file |
| Metadata | Metadata file | JSON | Schema, partitions, current snapshot |
| | Manifest list | Avro | List of manifest files for a snapshot |
| | Manifest files | Avro | List of data files with statistics |
| Data | Data files | Parquet/ORC/Avro | Actual row data |

### 1.3 File Organization

```
iceberg_table/
  metadata/
    version-hint.text              # Points to current metadata version
    v1.metadata.json               # Table metadata (schema, snapshots)
    v2.metadata.json
    snap-123456-manifest-list.avro # Manifest list for snapshot 123456
    abc-m0.avro                    # Manifest file (data file list)
    abc-m1.avro
  data/
    partition=2024-01/
      00001.parquet                # Actual data
      00002.parquet
    partition=2024-02/
      00003.parquet
```

### 1.4 Metadata Structure

**Metadata JSON file** contains:
- Table UUID and location
- Current and previous schema versions
- Partition specifications
- Sort orders
- Snapshots (current and historical)
- Current snapshot ID

**Manifest List** (Avro) contains:
- List of manifest file paths
- Partition summary for each manifest
- Added/existing/deleted file counts

**Manifest File** (Avro) contains:
- Data file paths
- File format (Parquet/ORC/Avro)
- Partition values
- Column-level statistics (min, max, null count)
- File size and row count

## 2. ClickHouse Iceberg Implementation

### 2.1 Source Code Location

The Iceberg implementation in vendor/chdb is extensive:

| Path | Description | Lines of Code |
|------|-------------|---------------|
| `src/Storages/ObjectStorage/DataLakes/Iceberg/` | Core Iceberg implementation | ~10,000 |
| `src/Databases/DataLake/` | Catalog integrations | ~3,000 |
| `src/TableFunctions/TableFunctionObjectStorage.cpp` | Table function | ~500 |

### 2.2 Key Components

**IcebergMetadata** (`IcebergMetadata.h`):
- Parses metadata JSON files
- Manages snapshots and schema versions
- Supports schema evolution
- Write support (INSERT, DELETE, UPDATE)

**ManifestFile** (`ManifestFile.h`):
- Parses Avro manifest files
- Extracts data file paths and statistics
- Handles partition pruning
- Supports position and equality deletes

**AvroForIcebergDeserializer** (`AvroForIcebergDeserializer.h`):
- Custom Avro parser for manifest files
- Extracts metadata from Avro headers
- Handles nested Avro types

### 2.3 Storage Engines and Table Functions

ClickHouse provides multiple Iceberg access methods:

| Engine/Function | Storage | Use Case |
|-----------------|---------|----------|
| `IcebergS3` | S3/R2 | Tables in S3-compatible storage |
| `IcebergAzure` | Azure Blob | Tables in Azure storage |
| `IcebergHDFS` | HDFS | Tables in Hadoop |
| `IcebergLocal` | Local filesystem | Local Iceberg tables |
| `iceberg()` | Auto-detect | Table function syntax |

### 2.4 Catalog Support

ClickHouse supports these Iceberg catalogs:

| Catalog | Status | Dependencies |
|---------|--------|--------------|
| REST Catalog | Full support | HTTP client |
| AWS Glue | Full support | AWS SDK |
| Hive Metastore | Partial | Thrift client |
| Filesystem | Full support | Direct file access |

### 2.5 Read vs Write Support

**Read Support** (Mature):
- Schema inference from metadata
- Partition pruning
- Column pruning
- Predicate pushdown
- Time travel queries
- Schema evolution handling

**Write Support** (Experimental):
- INSERT operations
- DELETE operations (position deletes)
- UPDATE operations
- Table creation
- Metadata updates

From the source code:
```cpp
bool supportsUpdate() const override { return true; }
bool supportsWrites() const override { return true; }
bool supportsDelete() const override { return true; }
```

## 3. WASM Compatibility Analysis

### 3.1 Dependencies

| Dependency | Purpose | WASM Status |
|------------|---------|-------------|
| Avro | Manifest/metadata parsing | **Blocking** - requires C++ Avro library |
| Parquet | Data file reading | Requires Arrow |
| S3 SDK | Cloud storage access | **Blocking** - not WASM compatible |
| HTTP Client | REST catalog | Compatible via fetch shim |
| JSON Parser (Poco) | Metadata JSON | Already included |

### 3.2 Blocking Issues

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Avro Library | High | Include `contrib/avro` (~1.5MB source) |
| S3 SDK | High | Replace with VFS bridge to R2 |
| Threading | Medium | Single-threaded mode |
| Memory | Medium | Streaming metadata loading |

### 3.3 IcebergLocal as WASM Strategy

The `IcebergLocal` configuration is most promising for WASM:

```cpp
// From DataLakeConfiguration.h
using StorageLocalIcebergConfiguration =
    DataLakeConfiguration<StorageLocalConfiguration, IcebergMetadata>;
```

This uses `LocalObjectStorage` which can be adapted to use VFS:
```cpp
ObjectStoragePtr createObjectStorage(ContextPtr, bool readonly) override
{
    return std::make_shared<LocalObjectStorage>(
        LocalObjectStorageSettings("/", readonly));
}
```

### 3.4 VFS Integration Architecture

```
R2 Storage (Cloudflare)
    |
    v
VFS Bridge (TypeScript)
    |
    v
VirtualFileSystem (WASM)
    |
    v
LocalObjectStorage
    |
    v
StorageLocalIcebergConfiguration
    |
    v
IcebergMetadata (parse JSON + Avro)
    |
    v
ParquetBlockInputFormat (read data)
```

### 3.5 Build Configuration

To enable Iceberg in WASM, the CMake configuration needs:

```cmake
# Required for Iceberg
set(ENABLE_AVRO ON CACHE BOOL "" FORCE)
set(USE_AVRO ON CACHE BOOL "" FORCE)

# Required for data reading
set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
set(ENABLE_ARROW ON CACHE BOOL "" FORCE)

# Disable cloud-specific implementations
set(ENABLE_S3 OFF CACHE BOOL "" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "" FORCE)
```

## 4. Memory and Size Impact

### 4.1 Code Size Analysis

| Component | Source Size | Estimated WASM Impact |
|-----------|-------------|----------------------|
| Iceberg core | ~10,000 LOC | ~500KB |
| Avro library | 1.5MB source | ~300KB |
| Parquet (if needed) | ~3.2MB source | ~1.5MB |
| Arrow (if needed) | ~23MB source | ~8MB |
| **Total (minimal)** | | **~800KB** |
| **Total (with Parquet)** | | **~10MB** |

### 4.2 Memory Requirements

Reading Iceberg metadata:
- Metadata JSON: 1-100KB per table
- Manifest list: 1-10KB per snapshot
- Manifest files: 10KB-1MB per manifest
- Working memory: ~5-10MB for parsing

For the 128MB Workers limit:
```
Total Available:                128MB
-------------------------------------
V8 Runtime Overhead:            ~10MB
WASM Module (with Iceberg):     ~25MB
Metadata Parsing:               ~10MB
Parquet Row Group:              ~40MB
Query Working Memory:           ~30MB
Safety Margin:                  ~13MB
```

## 5. Use Cases for Iceberg on R2

### 5.1 Data Lakehouse Architecture

Iceberg on R2 enables a modern data lakehouse pattern:

```
                    +-------------------+
                    |   Data Sources    |
                    | (Spark/Flink/etc) |
                    +--------+----------+
                             |
                             v
                    +-------------------+
                    |  Iceberg Tables   |
                    |    on R2/S3       |
                    +--------+----------+
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
     +-----------+    +-----------+    +-----------+
     | ClickHouse|    |   Trino   |    |  Spark    |
     |   WASM    |    |           |    |           |
     +-----------+    +-----------+    +-----------+
```

### 5.2 Query Patterns

**Read-Only Analytics** (Recommended for WASM):
```sql
-- Query Iceberg table on R2
SELECT
    date,
    count(*) as events,
    sum(amount) as total
FROM icebergLocal('r2://bucket/iceberg/events')
WHERE date >= '2024-01-01'
GROUP BY date
```

**Time Travel Queries**:
```sql
-- Query specific snapshot
SELECT *
FROM icebergLocal('r2://bucket/iceberg/events',
    SETTINGS iceberg_snapshot_id = 123456789)
```

### 5.3 Interoperability Benefits

| System | Iceberg Support | Interop with WASM |
|--------|-----------------|-------------------|
| Apache Spark | Native | Read tables written by Spark |
| Apache Flink | Native | Real-time data ingestion |
| Trino/Presto | Native | Federated queries |
| Snowflake | Native | Enterprise data sharing |
| Databricks | Native | Unity Catalog integration |
| DuckDB | Read support | Alternative query engine |

### 5.4 Typical Workflow

1. **Write**: External system (Spark/Flink) writes Iceberg tables to R2
2. **Catalog**: Table metadata registered in filesystem catalog
3. **Query**: ClickHouse WASM reads metadata and data files via VFS
4. **Results**: Return query results to client

## 6. Implementation Approaches

### 6.1 Option A: Full Native Iceberg (Standard Profile)

**Approach**: Include full Iceberg support with Avro and VFS-based file access.

**Pros**:
- Full schema evolution support
- Partition pruning
- Statistics-based filtering
- Consistent with ClickHouse behavior

**Cons**:
- Requires Avro library (~300KB)
- Complex build configuration
- Larger WASM module

**Implementation**:
1. Enable `USE_AVRO` in WASM build
2. Implement VFS adapter for LocalObjectStorage
3. Register `IcebergLocal` engine
4. Map R2 paths to VFS

### 6.2 Option B: Metadata-Only Parser (Minimal Profile)

**Approach**: Parse Iceberg metadata in TypeScript, pass data file list to ClickHouse.

**Pros**:
- Smaller WASM module
- No Avro dependency in WASM
- Flexible metadata handling

**Cons**:
- Duplicate parsing logic
- No predicate pushdown to manifest files
- Manual schema handling

**Implementation**:
```typescript
// TypeScript-side metadata parsing
import { parseIcebergMetadata } from './iceberg-parser';

async function queryIceberg(sql: string, tablePath: string) {
    // 1. Read metadata JSON from R2
    const metadata = await r2.get(`${tablePath}/metadata/v1.metadata.json`);
    const icebergMeta = parseIcebergMetadata(metadata);

    // 2. Parse manifest list (need Avro parser)
    const manifestList = await parseManifestList(icebergMeta.currentSnapshot);

    // 3. Get relevant data files
    const dataFiles = await getDataFilesFromManifests(manifestList);

    // 4. Query Parquet files directly
    for (const file of dataFiles) {
        await chdb.query(`
            INSERT INTO _temp SELECT * FROM file('${file}', Parquet)
        `);
    }

    return await chdb.query(sql);
}
```

### 6.3 Option C: iceberg-js Library

**Approach**: Use a JavaScript Iceberg library for metadata parsing.

**Pros**:
- Well-tested implementation
- TypeScript native
- Active community

**Cons**:
- Additional dependency
- Still need Avro parsing
- Data passes through JS/WASM boundary

**Libraries**:
- `@apache-iceberg/iceberg-core` (official, but JVM-focused)
- No mature JavaScript implementation available

### 6.4 Recommended Approach

**For Standard Profile**: Option A (Full Native Iceberg)
- Enable Avro in build
- Use IcebergLocal with VFS bridge
- Full feature support

**For Minimal Profile**: Option B (Metadata Parser)
- TypeScript metadata parsing
- Direct Parquet file queries
- Simpler but limited features

## 7. Technical Implementation Details

### 7.1 VFS Adapter for IcebergLocal

```cpp
// Custom ObjectStorage for VFS
class VFSObjectStorage : public LocalObjectStorage
{
public:
    std::unique_ptr<ReadBufferFromFileBase> readObject(
        const StoredObject & object,
        ...) override
    {
        // Route reads through VFS bridge
        return std::make_unique<VFSReadBuffer>(object.path);
    }

    ObjectMetadata getObjectMetadata(const String & path) override
    {
        // Get metadata via VFS
        return vfs_bridge->getMetadata(path);
    }
};
```

### 7.2 Avro Manifest Parsing

The manifest files are Avro format with specific schema:

```avro
{
  "type": "record",
  "name": "manifest_entry",
  "fields": [
    {"name": "status", "type": "int"},
    {"name": "snapshot_id", "type": ["null", "long"]},
    {"name": "data_file", "type": {
      "type": "record",
      "name": "data_file",
      "fields": [
        {"name": "file_path", "type": "string"},
        {"name": "file_format", "type": "string"},
        {"name": "partition", "type": ...},
        {"name": "record_count", "type": "long"},
        {"name": "file_size_in_bytes", "type": "long"},
        {"name": "column_sizes", "type": ...},
        {"name": "value_counts", "type": ...},
        {"name": "null_value_counts", "type": ...},
        {"name": "lower_bounds", "type": ...},
        {"name": "upper_bounds", "type": ...}
      ]
    }}
  ]
}
```

### 7.3 R2 Path Mapping

```typescript
// Map Iceberg table paths to R2 objects
function mapIcebergPath(icebergPath: string): R2Path {
    // icebergPath: /warehouse/db/table/metadata/v1.metadata.json
    // r2Path: warehouse/db/table/metadata/v1.metadata.json
    return {
        bucket: env.DATA_BUCKET,
        key: icebergPath.replace(/^\//, '')
    };
}
```

## 8. Recommendations

### 8.1 Phase 1: Read-Only IcebergLocal (Weeks 1-2)

1. Enable Avro in WASM build configuration
2. Implement VFS adapter for LocalObjectStorage
3. Register IcebergLocal table function
4. Test with pre-created Iceberg tables on R2

### 8.2 Phase 2: Metadata Caching (Week 3)

1. Implement metadata cache in WASM memory
2. Cache manifest files to avoid repeated R2 reads
3. Invalidate cache on snapshot change detection

### 8.3 Phase 3: Query Optimization (Week 4)

1. Implement partition pruning from WHERE clauses
2. Use column statistics for file skipping
3. Optimize manifest file loading order

### 8.4 Future Considerations

- **Write Support**: Not recommended for WASM initially due to complexity
- **Catalog Integration**: REST catalog via fetch shim
- **Multiple Tables**: Require careful memory management

## 9. Conclusion

Apache Iceberg support is feasible for ClickHouse WASM with the following constraints:

1. **Use IcebergLocal**: Filesystem-based access via VFS bridge
2. **Read-Only Initially**: Write support adds significant complexity
3. **Avro Required**: Must include Avro library for manifest parsing
4. **Memory Aware**: Careful management of metadata caching

The main architectural decision is whether to parse Iceberg metadata natively in WASM (recommended for standard profile) or in TypeScript (for minimal profile).

Iceberg support enables powerful data lakehouse use cases where ClickHouse WASM can query tables created by external systems (Spark, Flink, Trino) without data copying or format conversion.

## References

- [Apache Iceberg Specification](https://iceberg.apache.org/spec/)
- [ClickHouse Iceberg Documentation](https://clickhouse.com/docs/sql-reference/table-functions/iceberg)
- [Climbing the Iceberg with ClickHouse](https://clickhouse.com/blog/climbing-the-iceberg-with-clickhouse)
- [Apache Iceberg Metadata Explained](https://olake.io/blog/2025/10/03/iceberg-metadata/)
- [Structure of an Apache Iceberg Table](https://www.dremio.com/blog/a-hands-on-look-at-the-structure-of-an-apache-iceberg-table/)
- [spike-parquet-wasm.md](./spike-parquet-wasm.md) - Parquet format support analysis
- [spike-5-r2-virtual-memory.md](./spike-5-r2-virtual-memory.md) - VFS bridge architecture
