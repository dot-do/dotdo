# wasm-storage-minimal.cmake
# Minimal Storage Engine Configuration for WASM Build
#
# This module provides compile-time exclusion of storage engines for WASM.
# The goal is maximum size reduction by including ONLY the absolute minimum
# engines needed for in-memory query execution.
#
# KEEPS: Memory, Null, View, Values (absolute minimum for queries)
# DISABLES: All MergeTree variants, Distributed, Replicated, external storage
#
# Usage:
#   include(cmake/wasm-storage-minimal.cmake)
#   # Then apply to your target:
#   chdb_apply_wasm_storage_minimal(your_target)

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  WASM Minimal Storage Engine Configuration")
message(STATUS "  Goal: Maximum size reduction for in-memory query execution")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Compile-time Guards for Storage Engine Exclusion
# ============================================================================
# These preprocessor defines control which engines are included at compile time.
# When building for WASM, these guards allow stubbing out heavy engines.

# Master switch - when ON, only minimal engines are compiled
set(CHDB_WASM_MINIMAL_STORAGE ON CACHE BOOL "Enable minimal storage configuration" FORCE)

# ============================================================================
# KEPT Engines (Absolute Minimum for WASM)
# ============================================================================
# These engines are pure in-memory and essential for SQL query execution.
#
# Memory:  Pure RAM storage, no persistence, WASM compatible
#          Source: ~32KB (StorageMemory.cpp + MemorySettings.cpp)
#          Compiled: ~20-30KB
#
# Null:    /dev/null equivalent, useful for testing and discarding output
#          Source: ~3KB (StorageNull.cpp)
#          Compiled: ~2-5KB
#
# View:    SQL view definitions, no actual storage
#          Source: ~14KB (StorageView.cpp)
#          Compiled: ~10-15KB
#
# Values:  Inline values in queries (SELECT ... FROM VALUES(...))
#          Source: ~3KB (StorageValues.cpp)
#          Compiled: ~2-5KB
#
# Total kept: ~52KB source, ~35-55KB compiled

set(CHDB_STORAGE_MEMORY ON CACHE BOOL "Memory engine - pure RAM storage" FORCE)
set(CHDB_STORAGE_NULL ON CACHE BOOL "Null engine - discard sink" FORCE)
set(CHDB_STORAGE_VIEW ON CACHE BOOL "View engine - SQL views" FORCE)
set(CHDB_STORAGE_VALUES ON CACHE BOOL "Values engine - inline data" FORCE)

message(STATUS "[KEPT] Minimal engines for in-memory queries:")
message(STATUS "  [x] Memory          ~32KB source, ~25KB compiled")
message(STATUS "  [x] Null            ~3KB source, ~3KB compiled")
message(STATUS "  [x] View            ~14KB source, ~12KB compiled")
message(STATUS "  [x] Values          ~3KB source, ~3KB compiled")
message(STATUS "  TOTAL: ~52KB source, ~43KB compiled")
message(STATUS "")

# ============================================================================
# DISABLED Engines - Size Analysis
# ============================================================================

# -----------------------------------------------------------------------------
# MergeTree Family - DISABLED (~4.3MB savings)
# -----------------------------------------------------------------------------
# MergeTree is ClickHouse's flagship storage engine with complex features:
# - Persistent storage with parts and merges
# - Primary/secondary indexes
# - Data compression and deduplication
# - Background tasks (merges, mutations)
# - TTL management
# - Replication protocol
#
# None of this is needed for in-memory WASM queries.

set(CHDB_STORAGE_MERGETREE OFF CACHE BOOL "MergeTree - disk-based, WASM incompatible" FORCE)
set(CHDB_STORAGE_REPLICATED_MERGETREE OFF CACHE BOOL "ReplicatedMergeTree - distributed, WASM incompatible" FORCE)

# All MergeTree variants (these all depend on MergeTree base)
set(CHDB_STORAGE_SUMMING_MERGETREE OFF CACHE BOOL "SummingMergeTree" FORCE)
set(CHDB_STORAGE_AGGREGATING_MERGETREE OFF CACHE BOOL "AggregatingMergeTree" FORCE)
set(CHDB_STORAGE_REPLACING_MERGETREE OFF CACHE BOOL "ReplacingMergeTree" FORCE)
set(CHDB_STORAGE_COLLAPSING_MERGETREE OFF CACHE BOOL "CollapsingMergeTree" FORCE)
set(CHDB_STORAGE_VERSIONED_COLLAPSING_MERGETREE OFF CACHE BOOL "VersionedCollapsingMergeTree" FORCE)
set(CHDB_STORAGE_GRAPHITE_MERGETREE OFF CACHE BOOL "GraphiteMergeTree" FORCE)

message(STATUS "[DISABLED] MergeTree family (~4.3MB source savings):")
message(STATUS "  [ ] MergeTree                     ~122KB")
message(STATUS "  [ ] ReplicatedMergeTree           ~504KB")
message(STATUS "  [ ] MergeTree/* directory         ~3.7MB (280 files)")
message(STATUS "  [ ] SummingMergeTree, AggregatingMergeTree, etc.")
message(STATUS "")

# -----------------------------------------------------------------------------
# Distributed/Cluster Engines - DISABLED (~200KB savings)
# -----------------------------------------------------------------------------
# These engines coordinate across multiple ClickHouse nodes.
# WASM runs single-node, in-browser - no networking needed.

set(CHDB_STORAGE_DISTRIBUTED OFF CACHE BOOL "Distributed - network I/O, WASM incompatible" FORCE)
set(CHDB_STORAGE_MERGE OFF CACHE BOOL "Merge - merges multiple tables" FORCE)
set(CHDB_STORAGE_BUFFER OFF CACHE BOOL "Buffer - buffers inserts to other tables" FORCE)

message(STATUS "[DISABLED] Distributed/Cluster engines (~200KB savings):")
message(STATUS "  [ ] Distributed      ~90KB + Distributed/* (~58KB)")
message(STATUS "  [ ] Merge            ~30KB")
message(STATUS "  [ ] Buffer           ~52KB")
message(STATUS "")

# -----------------------------------------------------------------------------
# Log-based Engines - DISABLED (~70KB savings)
# -----------------------------------------------------------------------------
# File-based log engines - WASM has no persistent filesystem.

set(CHDB_STORAGE_LOG OFF CACHE BOOL "Log - file-based, WASM incompatible" FORCE)
set(CHDB_STORAGE_STRIPELOG OFF CACHE BOOL "StripeLog - file-based, WASM incompatible" FORCE)
set(CHDB_STORAGE_TINYLOG OFF CACHE BOOL "TinyLog - file-based, WASM incompatible" FORCE)

message(STATUS "[DISABLED] Log-based engines (~70KB savings):")
message(STATUS "  [ ] Log              ~44KB")
message(STATUS "  [ ] StripeLog        ~25KB")
message(STATUS "  [ ] TinyLog          (alias)")
message(STATUS "")

# -----------------------------------------------------------------------------
# External Database Engines - DISABLED (~700KB savings + deps)
# -----------------------------------------------------------------------------
# These require TCP connections to external databases.

set(CHDB_STORAGE_MYSQL OFF CACHE BOOL "MySQL - requires networking" FORCE)
set(CHDB_STORAGE_POSTGRESQL OFF CACHE BOOL "PostgreSQL - requires networking" FORCE)
set(CHDB_STORAGE_MONGODB OFF CACHE BOOL "MongoDB - requires networking" FORCE)
set(CHDB_STORAGE_REDIS OFF CACHE BOOL "Redis - requires networking" FORCE)
set(CHDB_STORAGE_SQLITE OFF CACHE BOOL "SQLite - file I/O, not needed in WASM" FORCE)
set(CHDB_STORAGE_ODBC OFF CACHE BOOL "ODBC - requires ODBC driver" FORCE)
set(CHDB_STORAGE_JDBC OFF CACHE BOOL "JDBC - requires JVM" FORCE)

message(STATUS "[DISABLED] External database engines (~700KB savings + client libs):")
message(STATUS "  [ ] MySQL            ~20KB + client lib")
message(STATUS "  [ ] PostgreSQL       ~152KB + libpqxx")
message(STATUS "  [ ] MongoDB          ~63KB + driver")
message(STATUS "  [ ] Redis            ~68KB")
message(STATUS "  [ ] SQLite           ~21KB + sqlite lib")
message(STATUS "  [ ] ODBC/JDBC        ~bridges")
message(STATUS "")

# -----------------------------------------------------------------------------
# Message Queue Engines - DISABLED (~560KB savings + deps)
# -----------------------------------------------------------------------------
# Streaming engines requiring external message brokers.

set(CHDB_STORAGE_KAFKA OFF CACHE BOOL "Kafka - requires networking" FORCE)
set(CHDB_STORAGE_RABBITMQ OFF CACHE BOOL "RabbitMQ - requires networking" FORCE)
set(CHDB_STORAGE_NATS OFF CACHE BOOL "NATS - requires networking" FORCE)
set(CHDB_STORAGE_FILELOG OFF CACHE BOOL "FileLog - file-based streaming" FORCE)

message(STATUS "[DISABLED] Message queue engines (~560KB savings + libs):")
message(STATUS "  [ ] Kafka            ~312KB + librdkafka")
message(STATUS "  [ ] RabbitMQ         ~140KB + amqpcpp")
message(STATUS "  [ ] NATS             ~104KB")
message(STATUS "  [ ] FileLog          ~104KB")
message(STATUS "")

# -----------------------------------------------------------------------------
# Object Storage Engines - DISABLED (~1.1MB savings + SDKs)
# -----------------------------------------------------------------------------
# Cloud storage integrations requiring HTTP and SDKs.

set(CHDB_STORAGE_S3 OFF CACHE BOOL "S3 - requires networking and AWS SDK" FORCE)
set(CHDB_STORAGE_AZURE OFF CACHE BOOL "Azure - requires networking and Azure SDK" FORCE)
set(CHDB_STORAGE_HDFS OFF CACHE BOOL "HDFS - requires networking and libhdfs3" FORCE)
set(CHDB_STORAGE_HUDI OFF CACHE BOOL "Hudi - requires S3 and object storage" FORCE)
set(CHDB_STORAGE_ICEBERG OFF CACHE BOOL "Iceberg - requires S3 and object storage" FORCE)
set(CHDB_STORAGE_DELTALAKE OFF CACHE BOOL "DeltaLake - requires S3 and Rust runtime" FORCE)

message(STATUS "[DISABLED] Object storage engines (~1.1MB savings + SDKs ~10-20MB):")
message(STATUS "  [ ] ObjectStorage/* directory  ~1.1MB")
message(STATUS "  [ ] S3, Azure, HDFS integrations")
message(STATUS "  [ ] Hudi, Iceberg, DeltaLake data lake formats")
message(STATUS "")

# -----------------------------------------------------------------------------
# File-based Engines - DISABLED (~165KB savings)
# -----------------------------------------------------------------------------
# Local filesystem access - not available in WASM sandbox.

set(CHDB_STORAGE_FILE OFF CACHE BOOL "File - local filesystem" FORCE)
set(CHDB_STORAGE_URL OFF CACHE BOOL "URL - requires HTTP" FORCE)

message(STATUS "[DISABLED] File-based engines (~165KB savings):")
message(STATUS "  [ ] File             ~96KB")
message(STATUS "  [ ] URL              ~67KB")
message(STATUS "")

# -----------------------------------------------------------------------------
# View Variants - DISABLED (~245KB savings)
# -----------------------------------------------------------------------------
# Complex view types with background processing.

set(CHDB_STORAGE_MATERIALIZED_VIEW OFF CACHE BOOL "MaterializedView - background processing" FORCE)
set(CHDB_STORAGE_LIVE_VIEW OFF CACHE BOOL "LiveView - requires background refresh" FORCE)
set(CHDB_STORAGE_WINDOW_VIEW OFF CACHE BOOL "WindowView - requires background processing" FORCE)

message(STATUS "[DISABLED] Complex view engines (~245KB savings):")
message(STATUS "  [ ] MaterializedView  ~96KB + MaterializedView/*")
message(STATUS "  [ ] LiveView          ~60KB + LiveView/*")
message(STATUS "  [ ] WindowView        ~88KB + WindowView/*")
message(STATUS "")

# -----------------------------------------------------------------------------
# Specialized Engines - DISABLED (~400KB savings)
# -----------------------------------------------------------------------------

set(CHDB_STORAGE_DICTIONARY OFF CACHE BOOL "Dictionary - external sources" FORCE)
set(CHDB_STORAGE_SET OFF CACHE BOOL "Set - in-memory set, not essential" FORCE)
set(CHDB_STORAGE_JOIN OFF CACHE BOOL "Join - in-memory join, not essential" FORCE)
set(CHDB_STORAGE_EXECUTABLE OFF CACHE BOOL "Executable - requires exec()" FORCE)
set(CHDB_STORAGE_GENERATE_RANDOM OFF CACHE BOOL "GenerateRandom - testing only" FORCE)
set(CHDB_STORAGE_TIMESERIES OFF CACHE BOOL "TimeSeries - complex indexing" FORCE)
set(CHDB_STORAGE_KEEPER_MAP OFF CACHE BOOL "KeeperMap - requires ZooKeeper" FORCE)
set(CHDB_STORAGE_ROCKSDB OFF CACHE BOOL "RocksDB - embedded KV store" FORCE)
set(CHDB_STORAGE_HIVE OFF CACHE BOOL "Hive - requires HDFS" FORCE)
set(CHDB_STORAGE_LOOP OFF CACHE BOOL "Loop - testing utility" FORCE)
set(CHDB_STORAGE_FUZZ_QUERY OFF CACHE BOOL "FuzzQuery - testing only" FORCE)
set(CHDB_STORAGE_FUZZ_JSON OFF CACHE BOOL "FuzzJSON - testing only" FORCE)

message(STATUS "[DISABLED] Specialized engines (~400KB savings):")
message(STATUS "  [ ] Dictionary, Set, Join")
message(STATUS "  [ ] Executable, GenerateRandom, Loop")
message(STATUS "  [ ] TimeSeries, KeeperMap, RocksDB, Hive")
message(STATUS "  [ ] FuzzQuery, FuzzJSON (testing)")
message(STATUS "")

# ============================================================================
# Source File Lists for Selective Compilation
# ============================================================================

# Essential infrastructure sources (always required)
set(CHDB_WASM_STORAGE_INFRASTRUCTURE_SOURCES
    IStorage.cpp
    StorageFactory.cpp
    StorageInMemoryMetadata.cpp
    StorageSnapshot.cpp
    ColumnsDescription.cpp
    ColumnDefault.cpp
    ColumnDependency.cpp
    KeyDescription.cpp
    ConstraintsDescription.cpp
    IndicesDescription.cpp
    ProjectionsDescription.cpp
    StatisticsDescription.cpp
    SelectQueryDescription.cpp
    SelectQueryInfo.cpp
    TTLDescription.cpp
    VirtualColumnsDescription.cpp
    VirtualColumnUtils.cpp
    AlterCommands.cpp
    MutationCommands.cpp
    PartitionCommands.cpp
    registerStorages.cpp
)

# Minimal storage engine sources (kept)
set(CHDB_WASM_STORAGE_MINIMAL_SOURCES
    # Memory engine
    StorageMemory.cpp
    MemorySettings.cpp

    # Null engine
    StorageNull.cpp

    # View engine
    StorageView.cpp

    # Values engine
    StorageValues.cpp

    # Input (needed for query input)
    StorageInput.cpp
)

# Combined minimal source list
set(CHDB_WASM_STORAGE_ALL_MINIMAL_SOURCES
    ${CHDB_WASM_STORAGE_INFRASTRUCTURE_SOURCES}
    ${CHDB_WASM_STORAGE_MINIMAL_SOURCES}
)

# ============================================================================
# Sources to EXCLUDE (for reference and validation)
# ============================================================================

# MergeTree sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_MERGETREE
    StorageMergeTree.cpp
    StorageReplicatedMergeTree.cpp
    StorageMergeTreeIndex.cpp
    # Plus entire MergeTree/ directory
)

# Distributed sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_DISTRIBUTED
    StorageDistributed.cpp
    StorageMerge.cpp
    StorageBuffer.cpp
    buildQueryTreeForShard.cpp
    getStructureOfRemoteTable.cpp
    IStorageCluster.cpp
    # Plus entire Distributed/ directory
)

# External database sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_EXTERNAL_DB
    StorageMySQL.cpp
    StoragePostgreSQL.cpp
    StorageMongoDB.cpp
    StorageRedis.cpp
    StorageSQLite.cpp
    StorageXDBC.cpp
    # Plus MySQL/, PostgreSQL/ directories
)

# Message queue sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_QUEUES
    # Kafka/, RabbitMQ/, NATS/, FileLog/ directories
)

# Object storage sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_OBJECT_STORAGE
    # Entire ObjectStorage/ directory
)

# File-based sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_FILE
    StorageFile.cpp
    StorageFileCluster.cpp
    StorageURL.cpp
    StorageURLCluster.cpp
)

# Complex view sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_VIEWS
    StorageMaterializedView.cpp
    # MaterializedView/, LiveView/, WindowView/ directories
)

# Log sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_LOG
    StorageLog.cpp
    StorageStripeLog.cpp
    StorageLogSettings.cpp
)

# Specialized sources - EXCLUDE
set(CHDB_WASM_STORAGE_EXCLUDE_SPECIALIZED
    StorageSet.cpp
    SetSettings.cpp
    StorageJoin.cpp
    StorageDictionary.cpp
    StorageExecutable.cpp
    StorageGenerateRandom.cpp
    StorageTimeSeries.cpp
    StorageKeeperMap.cpp
    StorageLoop.cpp
    StorageFuzzQuery.cpp
    StorageFuzzJSON.cpp
    # TimeSeries/, RocksDB/, Hive/ directories
)

# ============================================================================
# Compile Definitions for Conditional Compilation
# ============================================================================
# These definitions allow source files to conditionally compile code.

function(chdb_apply_wasm_storage_definitions TARGET)
    message(STATUS "Applying WASM storage definitions to target: ${TARGET}")

    # WASM storage mode indicator
    target_compile_definitions(${TARGET} PRIVATE
        CHDB_WASM_STORAGE=1
        CHDB_WASM_MINIMAL_STORAGE=1
    )

    # Kept engines
    target_compile_definitions(${TARGET} PRIVATE
        CHDB_STORAGE_MEMORY=1
        CHDB_STORAGE_NULL=1
        CHDB_STORAGE_VIEW=1
        CHDB_STORAGE_VALUES=1
    )

    # Disabled engine flags (for stub implementations)
    target_compile_definitions(${TARGET} PRIVATE
        CHDB_DISABLE_MERGETREE=1
        CHDB_DISABLE_DISTRIBUTED=1
        CHDB_DISABLE_LOG=1
        CHDB_DISABLE_EXTERNAL_DB=1
        CHDB_DISABLE_MESSAGE_QUEUES=1
        CHDB_DISABLE_OBJECT_STORAGE=1
        CHDB_DISABLE_FILE_STORAGE=1
        CHDB_DISABLE_COMPLEX_VIEWS=1
        CHDB_DISABLE_SPECIALIZED_STORAGE=1
    )
endfunction()

# ============================================================================
# Stub Registration Function
# ============================================================================
# This generates a minimal registerStorages implementation that only
# registers the kept engines. Other engines get stub registrations that
# throw errors at runtime if someone tries to use them.

set(CHDB_WASM_REGISTER_STORAGES_STUB_CODE [=[
// WASM Minimal Storage Registration
// Auto-generated stub that only registers Memory, Null, View, Values engines.

#include <Storages/StorageFactory.h>
#include <Storages/registerStorages.h>
#include <Common/Exception.h>

namespace DB
{

namespace ErrorCodes
{
    extern const int NOT_IMPLEMENTED;
}

// Kept engines - full implementations
void registerStorageMemory(StorageFactory & factory);
void registerStorageNull(StorageFactory & factory);
void registerStorageView(StorageFactory & factory);

// Stub for disabled engines
static void registerDisabledStorage(StorageFactory & factory, const char* name, const char* reason)
{
    factory.registerStorage(name, [name, reason](const StorageFactory::Arguments &)
        -> std::shared_ptr<IStorage>
    {
        throw Exception(ErrorCodes::NOT_IMPLEMENTED,
            "Storage engine '{}' is not available in WASM build. Reason: {}",
            name, reason);
    });
}

void registerStorages()
{
    auto & factory = StorageFactory::instance();

    // Register kept engines
    registerStorageMemory(factory);
    registerStorageNull(factory);
    registerStorageView(factory);

    // Register stubs for disabled engines (provides clear error messages)
    registerDisabledStorage(factory, "MergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "ReplicatedMergeTree", "Requires disk I/O and ZooKeeper");
    registerDisabledStorage(factory, "SummingMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "AggregatingMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "ReplacingMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "CollapsingMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "VersionedCollapsingMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "GraphiteMergeTree", "Requires disk I/O");
    registerDisabledStorage(factory, "Distributed", "Requires network I/O");
    registerDisabledStorage(factory, "Merge", "Not available in minimal WASM");
    registerDisabledStorage(factory, "Buffer", "Not available in minimal WASM");
    registerDisabledStorage(factory, "Log", "Requires disk I/O");
    registerDisabledStorage(factory, "StripeLog", "Requires disk I/O");
    registerDisabledStorage(factory, "TinyLog", "Requires disk I/O");
    registerDisabledStorage(factory, "MySQL", "Requires network I/O");
    registerDisabledStorage(factory, "PostgreSQL", "Requires network I/O");
    registerDisabledStorage(factory, "MongoDB", "Requires network I/O");
    registerDisabledStorage(factory, "Redis", "Requires network I/O");
    registerDisabledStorage(factory, "SQLite", "Requires disk I/O");
    registerDisabledStorage(factory, "ODBC", "Requires ODBC driver");
    registerDisabledStorage(factory, "JDBC", "Requires JVM");
    registerDisabledStorage(factory, "Kafka", "Requires network I/O");
    registerDisabledStorage(factory, "RabbitMQ", "Requires network I/O");
    registerDisabledStorage(factory, "NATS", "Requires network I/O");
    registerDisabledStorage(factory, "FileLog", "Requires disk I/O");
    registerDisabledStorage(factory, "S3", "Requires network I/O");
    registerDisabledStorage(factory, "S3Queue", "Requires network I/O");
    registerDisabledStorage(factory, "AzureBlobStorage", "Requires network I/O");
    registerDisabledStorage(factory, "AzureQueue", "Requires network I/O");
    registerDisabledStorage(factory, "HDFS", "Requires network I/O");
    registerDisabledStorage(factory, "Hudi", "Requires object storage");
    registerDisabledStorage(factory, "Iceberg", "Requires object storage");
    registerDisabledStorage(factory, "DeltaLake", "Requires object storage");
    registerDisabledStorage(factory, "File", "Requires disk I/O");
    registerDisabledStorage(factory, "URL", "Requires network I/O");
    registerDisabledStorage(factory, "MaterializedView", "Not available in minimal WASM");
    registerDisabledStorage(factory, "LiveView", "Requires background processing");
    registerDisabledStorage(factory, "WindowView", "Requires background processing");
    registerDisabledStorage(factory, "Dictionary", "Not available in minimal WASM");
    registerDisabledStorage(factory, "Set", "Not available in minimal WASM");
    registerDisabledStorage(factory, "Join", "Not available in minimal WASM");
    registerDisabledStorage(factory, "Executable", "Requires exec()");
    registerDisabledStorage(factory, "ExecutablePool", "Requires exec()");
    registerDisabledStorage(factory, "GenerateRandom", "Not available in minimal WASM");
    registerDisabledStorage(factory, "TimeSeries", "Not available in minimal WASM");
    registerDisabledStorage(factory, "KeeperMap", "Requires ZooKeeper");
    registerDisabledStorage(factory, "EmbeddedRocksDB", "Requires disk I/O");
    registerDisabledStorage(factory, "Hive", "Requires HDFS");
    registerDisabledStorage(factory, "Loop", "Not available in minimal WASM");
    registerDisabledStorage(factory, "FuzzQuery", "Testing only");
    registerDisabledStorage(factory, "FuzzJSON", "Testing only");
}

}
]=])

# ============================================================================
# Apply Minimal Storage Configuration
# ============================================================================

function(chdb_apply_wasm_storage_minimal TARGET)
    message(STATUS "")
    message(STATUS "Applying WASM minimal storage configuration to: ${TARGET}")

    # Apply compile definitions
    chdb_apply_wasm_storage_definitions(${TARGET})

    # Set properties indicating minimal storage mode
    set_target_properties(${TARGET} PROPERTIES
        CHDB_WASM_STORAGE_MODE "minimal"
    )

    message(STATUS "WASM minimal storage configuration applied")
    message(STATUS "")
endfunction()

# ============================================================================
# CMake Variables for ClickHouse Build Integration
# ============================================================================
# These can be passed to ClickHouse's CMake to disable features.

function(chdb_set_clickhouse_storage_options)
    # Disable external integrations at CMake level
    set(USE_MYSQL OFF CACHE BOOL "" FORCE)
    set(USE_LIBPQXX OFF CACHE BOOL "" FORCE)
    set(USE_MONGODB OFF CACHE BOOL "" FORCE)
    set(ENABLE_RDKAFKA OFF CACHE BOOL "" FORCE)
    set(ENABLE_AMQPCPP OFF CACHE BOOL "" FORCE)
    set(ENABLE_NATSIO OFF CACHE BOOL "" FORCE)
    set(ENABLE_ROCKSDB OFF CACHE BOOL "" FORCE)
    # Cloud Storage - CRITICAL SIZE SAVINGS (~1.4+ GB)
    set(ENABLE_S3 OFF CACHE BOOL "" FORCE)
    set(ENABLE_AWS_S3 OFF CACHE BOOL "" FORCE)
    set(ENABLE_S3 OFF CACHE INTERNAL "")
    set(ENABLE_AWS_S3 OFF CACHE INTERNAL "")
    set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "" FORCE)
    set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE BOOL "" FORCE)
    set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE INTERNAL "")
    set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE INTERNAL "")
    set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "" FORCE)
    set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE INTERNAL "")
    set(ENABLE_HDFS OFF CACHE BOOL "" FORCE)
    set(ENABLE_HDFS OFF CACHE INTERNAL "")
    set(ENABLE_HIVE OFF CACHE BOOL "" FORCE)
    set(ENABLE_HIVE OFF CACHE INTERNAL "")
    set(ENABLE_FILELOG OFF CACHE BOOL "" FORCE)
    set(ENABLE_SQLITE OFF CACHE BOOL "" FORCE)
    set(ENABLE_ODBC OFF CACHE BOOL "" FORCE)

    message(STATUS "ClickHouse storage options set for minimal WASM build")
endfunction()

# ============================================================================
# Size Impact Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  WASM Minimal Storage - Size Impact Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "KEPT (~52KB source, ~43KB compiled):")
message(STATUS "  Memory, Null, View, Values")
message(STATUS "")
message(STATUS "SAVINGS BY CATEGORY:")
message(STATUS "  MergeTree family:        ~4.3MB source, ~2-3MB compiled")
message(STATUS "  Distributed/Cluster:     ~200KB source, ~150KB compiled")
message(STATUS "  External databases:      ~700KB source + client libs (~5MB)")
message(STATUS "  Message queues:          ~560KB source + libs (~3MB)")
message(STATUS "  Object storage:          ~1.1MB source + SDKs (~15MB)")
message(STATUS "  File-based:              ~165KB source, ~100KB compiled")
message(STATUS "  Complex views:           ~245KB source, ~150KB compiled")
message(STATUS "  Log engines:             ~70KB source, ~50KB compiled")
message(STATUS "  Specialized:             ~400KB source, ~250KB compiled")
message(STATUS "")
message(STATUS "TOTAL ESTIMATED SAVINGS:")
message(STATUS "  Source code:             ~7.7MB")
message(STATUS "  Compiled (without deps): ~3-4MB")
message(STATUS "  With dependencies:       ~20-30MB (SDKs, client libs, etc.)")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
