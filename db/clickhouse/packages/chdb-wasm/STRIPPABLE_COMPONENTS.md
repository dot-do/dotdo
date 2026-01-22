# Strippable Components for Minimal WASM Build

This document identifies ClickHouse components that can be stripped or disabled to reduce the WASM binary size for basic analytical queries.

---

## Summary

| Category | Total Size | Strippable | Priority |
|----------|-----------|------------|----------|
| contrib/ (External Dependencies) | ~6.5GB | ~5GB | HIGH |
| src/Functions/ | 11MB | ~8MB | HIGH |
| src/Storages/ | 12MB | ~9MB | HIGH |
| src/Interpreters/ | 6.7MB | ~4MB | MEDIUM |
| src/Processors/ | 5.5MB | ~2MB | MEDIUM |
| src/AggregateFunctions/ | 1.9MB | ~1MB | MEDIUM |
| src/Dictionaries/ | 1.3MB | ~1MB | MEDIUM |
| src/Backups/ | 872KB | 872KB | HIGH |
| src/Coordination/ | 992KB | 992KB | HIGH |

---

## 1. External Dependencies (contrib/)

### CRITICAL - Remove These First (Largest Impact)

| Component | Size | Needed | How to Disable |
|-----------|------|--------|----------------|
| **llvm-project** | 1.9GB | NO (JIT compilation) | `-DENABLE_EMBEDDED_COMPILER=OFF` |
| **aws (S3)** | 944MB | NO | `-DENABLE_S3=OFF` or `-DUSE_AWS_S3=OFF` |
| **boost** | 888MB | PARTIAL | Minimal subset via custom cmake |
| **rust_vendor** | 440MB | NO | `-DENABLE_RUST=OFF` |
| **google-cloud-cpp** | 369MB | NO | `-DENABLE_GOOGLE_CLOUD_CPP=OFF` |
| **icu** | 311MB | PARTIAL | `-DUSE_ICU=OFF` (loses locale functions) |
| **croaring** | 295MB | MAYBE | Used for bitmap indexes |
| **icudata** | 287MB | NO | Disable with ICU |
| **sysroot** | 213MB | NO | Cross-compilation only |
| **postgres** | 140MB | NO | `-DENABLE_LIBPQXX=OFF` |
| **arrow/parquet** | 125MB | MAYBE | `-DUSE_PARQUET=OFF -DUSE_ARROW=OFF` |
| **google-protobuf** | 93MB | PARTIAL | `-DUSE_PROTOBUF=OFF` |
| **grpc** | 87MB | NO | `-DUSE_GRPC=OFF` |
| **ai-sdk-cpp** | 81MB | NO | `-DENABLE_CLIENT_AI=OFF` |
| **openssl** | 73MB | MAYBE | `-DENABLE_SSL=OFF` |

### MEDIUM Priority - Consider Removing

| Component | Size | Needed | How to Disable |
|-----------|------|--------|----------------|
| **simde** | 57MB | MAYBE | SIMD emulation |
| **h3** | 45MB | NO | `-DUSE_H3=OFF` |
| **rocksdb** | 43MB | NO | `-DUSE_ROCKSDB=OFF` |
| **libxml2** | 37MB | PARTIAL | XML format support |
| **brotli** | 35MB | MAYBE | Compression codec |
| **orc** | 34MB | NO | `-DUSE_ORC=OFF` |
| **openldap** | 31MB | NO | `-DUSE_LDAP=OFF` |
| **qpl** | 28MB | NO | Intel-specific |
| **krb5** | 28MB | NO | Kerberos auth |
| **curl** | 27MB | MAYBE | HTTP client |
| **azure** | 23MB | NO | `-DUSE_AZURE_BLOB_STORAGE=OFF` |
| **thrift** | 21MB | NO | Hive support |
| **NuRaft** | 21MB | NO | `-DUSE_NURAFT=OFF` |
| **cassandra** | 21MB | NO | `-DUSE_CASSANDRA=OFF` |

### LOW Priority - Keep or Minimal

| Component | Size | Needed | Notes |
|-----------|------|--------|-------|
| **zstd** | 9.5MB | YES | Essential compression |
| **lz4** | ~5MB | YES | Essential compression |
| **re2** | ~8MB | YES | Regex support |
| **double-conversion** | ~3MB | YES | Number parsing |
| **simdjson** | 13MB | YES | JSON parsing |

---

## 2. Storage Engines (src/Storages/)

### Essential (Keep)

| Engine | Files | Notes |
|--------|-------|-------|
| **Memory** | StorageMemory.cpp (28KB) | In-memory tables |
| **Values** | StorageValues.cpp (2.5KB) | Literal values |
| **Null** | StorageNull.cpp (2.7KB) | /dev/null equivalent |
| **View** | StorageView.cpp (14KB) | Basic views |

### Strippable (High Impact)

| Engine | Size | CMake Guard | Notes |
|--------|------|-------------|-------|
| **StorageReplicatedMergeTree** | 504KB + 55KB header | Built-in | Replication logic |
| **StorageDistributed** | 89KB + 12KB header | Built-in | Cluster distribution |
| **StorageFile** | 96KB | Built-in | File system access |
| **StorageMerge** | 74KB | Built-in | Merging tables |
| **StorageBuffer** | 52KB | Built-in | Write buffering |
| **StorageKeeperMap** | 62KB | Built-in | ZooKeeper storage |
| **StorageMergeTree** | 122KB | Built-in | Full MergeTree |
| **StorageURL** | 67KB | Built-in | HTTP(S) tables |
| **MergeTree/** | 4.3MB directory | Built-in | Full MergeTree engine |

### Conditionally Compiled (Already Guarded)

| Engine | CMake Flag | Notes |
|--------|------------|-------|
| StorageKafka | `USE_RDKAFKA` | Kafka integration |
| StorageRabbitMQ | `USE_AMQPCPP` | RabbitMQ integration |
| StorageNATS | `USE_NATSIO` | NATS integration |
| StoragePostgreSQL | `USE_LIBPQXX` | PostgreSQL integration |
| StorageMySQL | `USE_MYSQL` | MySQL integration |
| StorageMongoDB | `USE_MONGODB` | MongoDB integration |
| StorageHive | `USE_HDFS && USE_HIVE` | Hive integration |
| StorageRocksDB | `USE_ROCKSDB` | RocksDB integration |
| StorageSQLite | `USE_SQLITE` | SQLite integration |
| StorageS3/Hudi/DeltaLake | `USE_AWS_S3` | S3-based storage |
| StorageIceberg | `USE_AVRO` | Iceberg tables |
| StorageFileLog | `USE_FILELOG` | Linux only |

### Recommended Minimal Storage Set

```cmake
# Keep only these storage engines for minimal WASM:
# - Memory (required)
# - Values (required)
# - Null (useful)
# - View (useful)
# - MergeTree (optional, if persistence needed)

# Disable everything else via cmake flags
```

---

## 3. Functions (src/Functions/)

**Total: 618+ function files, 11MB**

### Essential Core Functions (Keep)

| Category | Files | Notes |
|----------|-------|-------|
| Comparison | equals, notEquals, less, greater, etc. | Basic comparisons |
| Logical | FunctionsLogical.cpp | AND, OR, NOT |
| Conversion | FunctionsConversion*.cpp | Type casting |
| Control Flow | if.cpp, multiIf.cpp | Conditionals |
| Arithmetic | plus, minus, multiply, divide | Math ops |
| String basics | concat, length, substring | Basic string |

### Strippable Function Categories

| Category | Estimated Size | CMake Guard | Notes |
|----------|---------------|-------------|-------|
| **H3 Geo Functions** | ~60 files, ~150KB | `USE_H3` | h3*.cpp |
| **S2 Geo Functions** | ~15 files, ~50KB | `USE_S2_GEOMETRY` | s2*.cpp |
| **URL Functions** | URL/ directory, ~40 files | Built-in | URL parsing |
| **Encryption** | ~7 files, ~50KB | `USE_SSL` | AES, encrypt/decrypt |
| **NLP Functions** | ~5 files | `USE_NLP` | lemmatize, stem |
| **ML Functions** | ~3 files | Built-in | catboost, evalML |
| **BSON Functions** | bsonExtract*.cpp | `USE_BSON` | MongoDB BSON |
| **Array Functions** | array/ directory, 84 files | Built-in | Complex array ops |

### Existing Minimal Functions Mode

The CMakeLists.txt already has a `CHDB_MINIMAL_FUNCTIONS` option:

```cmake
option(CHDB_MINIMAL_FUNCTIONS "Build with minimal SQL functions for chdb" OFF)
```

When enabled, it includes only:
- IFunction.cpp, FunctionFactory.cpp, FunctionHelpers.cpp
- FunctionsLogical.cpp, if.cpp, multiIf.cpp
- CastOverloadResolver.cpp, FunctionsConversion*.cpp
- Comparison functions (equals, notEquals, less, greater, etc.)
- searchAnyAll.cpp, multiMatchAny.cpp

**Recommendation**: Enable this flag for minimal builds.

---

## 4. Interpreters (src/Interpreters/)

**Total: 6.7MB**

### Strippable Components

| Component | Files | Size Est. | Notes |
|-----------|-------|-----------|-------|
| **Cluster/Distributed** | Cluster*.cpp, *Distributed*.cpp | ~200KB | Cluster coordination |
| **ZooKeeper Logs** | ZooKeeper*.cpp | ~30KB | ZK logging |
| **Backups** | Backup*.cpp | ~50KB | Backup coordination |
| **DDL on Cluster** | executeDDLQueryOnCluster.cpp | ~20KB | Distributed DDL |
| **Async Insert Queue** | AsynchronousInsertQueue.cpp | ~46KB | Async inserts |
| **Aggregator** | Aggregator.cpp | ~147KB | Heavy aggregation |

### Cluster-Related Files (Can Be Stripped)

```
Cluster.cpp (35KB)
ClusterDiscovery.cpp (28KB)
ClusterFunctionReadTask.cpp
ClusterProxy/
DDLOnClusterQueryStatusSource.cpp
DistributedQueryStatusSource.cpp
executeDDLQueryOnCluster.cpp
getClusterName.cpp
getCustomKeyFilterForParallelReplicas.cpp
removeOnClusterClauseIfNeeded.cpp
ReplicatedDatabaseQueryStatusSource.cpp
ZooKeeperConnectionLog.cpp
ZooKeeperLog.cpp
```

---

## 5. Processors (src/Processors/)

**Total: 5.5MB**

### Keep (Essential)

- IProcessor.h/cpp - Base processor
- ISource.h/cpp - Data source base
- ISink.h/cpp - Data sink base
- Port.h/cpp - Data ports
- Chunk.h/cpp - Data chunks
- LimitTransform - LIMIT clause
- FilterTransform - WHERE clause
- ExpressionTransform - SELECT expressions

### Strippable

| Component | Directory/Files | Notes |
|-----------|-----------------|-------|
| **TTL Processors** | TTL/ | Time-to-live |
| **Merges** | Merges/ | MergeTree merging |
| **Heavy Transforms** | Various in Transforms/ | Specialized transforms |
| **QueryPlan Optimizations** | QueryPlan/Optimizations/ | Query optimization |

---

## 6. Aggregate Functions (src/AggregateFunctions/)

**Total: 1.9MB, 100 files**

### Essential (Keep)

| Function | Notes |
|----------|-------|
| count | Basic counting |
| sum | Summation |
| avg | Average |
| min/max | Extremes |
| any | First value |
| argMin/argMax | With argument |

### Strippable (Advanced)

| Category | Functions | Notes |
|----------|-----------|-------|
| Statistical | AggregateFunctionCorr, Covar, etc. | Correlation |
| Quantile | AggregateFunctionQuantile*.cpp (~20 files) | Percentiles |
| Histogram | AggregateFunctionHistogram.cpp | Histograms |
| ML | AggregateFunctionMLMethod.cpp | Machine learning |
| Bitmap | AggregateFunctionGroupBitmap.cpp | Bitmap ops |
| Sequence | AggregateFunctionSequence*.cpp | Pattern matching |

---

## 7. Other Components

### Backups (src/Backups/) - 872KB

**Can be completely disabled for WASM**

All backup functionality is unnecessary for in-memory/browser WASM usage.

### Coordination (src/Coordination/) - 992KB

**Can be completely disabled for WASM**

Keeper/ZooKeeper coordination is server-side only.

```cmake
# Disable by not having NuRaft target
-DUSE_NURAFT=OFF
```

### Dictionaries (src/Dictionaries/) - 1.3MB

Most dictionary sources can be stripped:
- Remote dictionaries (HTTP, Cassandra, MongoDB, etc.)
- Keep only flat/hashed dictionary implementations

---

## 8. Recommended CMake Configuration for Minimal WASM

```cmake
# Disable external integrations
-DENABLE_LIBRARIES=OFF
-DENABLE_S3=OFF
-DUSE_AWS_S3=OFF
-DENABLE_GOOGLE_CLOUD_CPP=OFF
-DUSE_AZURE_BLOB_STORAGE=OFF
-DENABLE_LIBPQXX=OFF
-DUSE_MYSQL=OFF
-DUSE_MONGODB=OFF
-DUSE_ROCKSDB=OFF
-DUSE_RDKAFKA=OFF
-DUSE_AMQPCPP=OFF
-DUSE_NATSIO=OFF
-DUSE_HDFS=OFF
-DUSE_HIVE=OFF
-DUSE_CASSANDRA=OFF
-DUSE_SQLITE=OFF
-DUSE_LDAP=OFF
-DUSE_GRPC=OFF
-DUSE_NURAFT=OFF

# Disable optional features
-DENABLE_EMBEDDED_COMPILER=OFF  # No JIT
-DENABLE_RUST=OFF
-DENABLE_NLP=OFF
-DUSE_H3=OFF
-DUSE_S2_GEOMETRY=OFF
-DUSE_ICU=OFF
-DENABLE_SSL=OFF  # If not needed
-DUSE_PARQUET=OFF
-DUSE_ARROW=OFF
-DUSE_ORC=OFF
-DUSE_AVRO=OFF
-DENABLE_CLIENT_AI=OFF

# Enable minimal mode
-DCHDB_MINIMAL_FUNCTIONS=ON

# Build options
-DENABLE_TESTS=OFF
-DENABLE_EXAMPLES=OFF
-DENABLE_BENCHMARKS=OFF
-DBUILD_STANDALONE_KEEPER=OFF
```

---

## 9. Size Reduction Estimates

| Configuration | Estimated Size |
|---------------|----------------|
| Full Build | 200-500MB |
| Without LLVM/JIT | -50MB |
| Without AWS/Cloud | -40MB |
| Without External DBs | -30MB |
| Minimal Functions | -20MB |
| Without Full MergeTree | -15MB |
| Without Backups/Coordination | -5MB |
| **Minimal WASM Target** | **30-50MB** |

---

## 10. Implementation Strategy

### Phase 1: Disable External Dependencies
1. Disable LLVM/JIT compilation
2. Disable all cloud storage (S3, Azure, GCP)
3. Disable all external database connections
4. Disable NuRaft/ZooKeeper

### Phase 2: Reduce Storage Engines
1. Keep only Memory, Values, Null, View
2. Optionally keep simplified MergeTree
3. Remove all distributed/replicated functionality

### Phase 3: Minimize Functions
1. Enable CHDB_MINIMAL_FUNCTIONS
2. Add only required functions incrementally
3. Remove geo, NLP, encryption functions

### Phase 4: Strip Unused Code
1. Remove Backups module entirely
2. Remove Coordination module entirely
3. Reduce Interpreters to non-cluster code
4. Minimize aggregate functions to essentials

---

## Notes

- Some components have interdependencies that may require careful handling
- The `configure_config.cmake` file shows all USE_* flags that control compilation
- Many guards already exist via `#if USE_*` preprocessor directives
- Test thoroughly after each stripping phase to ensure core functionality works
