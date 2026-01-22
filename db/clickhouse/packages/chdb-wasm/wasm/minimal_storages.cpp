/**
 * minimal_storages.cpp - Minimal storage engine registration for WASM builds
 *
 * This file provides a drop-in replacement for registerStorages.cpp when building
 * ClickHouse/chDB as a minimal WASM module. It only registers essential storage
 * engines that work entirely in-memory without external dependencies.
 *
 * NOTE: This file must be compiled as part of the ClickHouse/chDB build system.
 * The include paths (e.g., <Storages/...>) are resolved via CMake from vendor/chdb/src.
 * It will NOT compile standalone - it requires the chDB source tree include paths.
 *
 * ============================================================================
 * INCLUDED STORAGE ENGINES:
 * ============================================================================
 *
 * Memory - In-memory storage, primary data storage engine for WASM
 *   - Stores all data in RAM
 *   - No external dependencies
 *   - Full read/write support
 *
 * Null - Discards all written data, returns nothing on read
 *   - Useful for testing and benchmarking
 *   - Zero storage overhead
 *
 * View - Virtual table based on SELECT query
 *   - Essential for SQL compatibility
 *   - No storage, just query wrapping
 *
 * ============================================================================
 * EXCLUDED STORAGE ENGINES:
 * ============================================================================
 *
 * MergeTree family:
 *   - MergeTree, ReplacingMergeTree, SummingMergeTree, AggregatingMergeTree
 *   - Requires filesystem for data parts, background merges
 *   - Complex threading model incompatible with WASM
 *
 * Log family:
 *   - Log, TinyLog, StripeLog
 *   - Requires persistent filesystem
 *
 * File-based:
 *   - File - Requires local filesystem access
 *   - URL - Requires HTTP client (network I/O)
 *
 * External services:
 *   - S3, HDFS, AzureBlobStorage - Cloud storage SDKs + network
 *   - Kafka, RabbitMQ, NATS - Message queue clients + network
 *   - MySQL, PostgreSQL, MongoDB, Redis - Database clients + network
 *   - ODBC, JDBC - External driver dependencies
 *
 * Distributed/Cluster:
 *   - Distributed - Requires inter-node communication
 *   - Replicated* variants - Requires ZooKeeper coordination
 *
 * Complex/Special:
 *   - Dictionary - May require external data sources
 *   - MaterializedView - Triggers background processing
 *   - LiveView, WindowView - Complex state management
 *   - Buffer, Merge - Depends on other potentially unavailable engines
 *   - Set, Join - Could be included but adds complexity
 *   - GenerateRandom - Could be included but not essential
 *   - Executable - Security risk, requires process spawning
 *   - KeeperMap - Requires Keeper/ZooKeeper
 *   - EmbeddedRocksDB - Requires RocksDB library
 *   - TimeSeries - Complex, newer engine
 *
 * ============================================================================
 * USAGE:
 * ============================================================================
 *
 * In your CMakeLists.txt for WASM builds:
 *
 *   if(CHDB_WASM_MINIMAL)
 *       # Exclude the original registerStorages.cpp
 *       list(REMOVE_ITEM STORAGE_SOURCES
 *           ${CLICKHOUSE_SRC}/Storages/registerStorages.cpp)
 *       # Include this minimal version
 *       list(APPEND STORAGE_SOURCES
 *           ${PROJECT_SOURCE_DIR}/wasm/minimal_storages.cpp)
 *       add_compile_definitions(CHDB_WASM_MINIMAL)
 *   endif()
 *
 * Or compile with:
 *   -DCHDB_WASM_MINIMAL
 *
 * ============================================================================
 * BUILD SIZE IMPACT:
 * ============================================================================
 *
 * This minimal configuration significantly reduces binary size by excluding:
 * - AWS SDK (~10+ MB)
 * - Network libraries (curl, poco HTTP)
 * - Database client libraries (libpq, mysqlclient, etc.)
 * - Message queue libraries (rdkafka, amqp-cpp)
 * - MergeTree implementation (~several MB of code)
 * - Background merge/compaction logic
 *
 * Expected size reduction: 50-80% compared to full build
 *
 * ============================================================================
 */

#include <Storages/StorageFactory.h>
#include <Storages/registerStorages.h>

// Note: config.h may define feature flags, but we don't need them for minimal build
// #include "config.h"

namespace DB
{

// ============================================================================
// Essential Storage Engine Declarations
// ============================================================================

/**
 * Memory storage - In-memory table storage
 * Location: src/Storages/StorageMemory.cpp
 *
 * Features:
 * - Stores data in RAM as blocks
 * - Supports settings: compress, max_rows_to_keep, max_bytes_to_keep
 * - Parallel insert support
 * - Full backup/restore support
 */
void registerStorageMemory(StorageFactory & factory);

/**
 * Null storage - Discards all data
 * Location: src/Storages/StorageNull.cpp
 *
 * Features:
 * - Write operations succeed but discard data
 * - Read operations return empty result
 * - Useful for testing write performance
 * - Parallel insert support
 */
void registerStorageNull(StorageFactory & factory);

/**
 * View storage - Virtual table from SELECT query
 * Location: src/Storages/StorageView.cpp
 *
 * Features:
 * - No actual data storage
 * - Wraps SELECT query as table
 * - Supports parameterized views
 * - Essential for SQL compatibility
 */
void registerStorageView(StorageFactory & factory);


// ============================================================================
// Conditional Storage Declarations (for extended minimal builds)
// ============================================================================

#ifdef CHDB_WASM_EXTENDED
/**
 * Extended storage engines that could be optionally included.
 * These have no external dependencies but add code size.
 * Enable with -DCHDB_WASM_EXTENDED
 */

// GenerateRandom - Generates random data, useful for testing
void registerStorageGenerateRandom(StorageFactory & factory);

// Set - In-memory set storage for subqueries
void registerStorageSet(StorageFactory & factory);

// Join - In-memory join storage
void registerStorageJoin(StorageFactory & factory);

// Buffer - Buffers writes to another table (needs underlying engine)
// void registerStorageBuffer(StorageFactory & factory);

// Merge - Virtual table merging multiple tables (needs underlying engines)
// void registerStorageMerge(StorageFactory & factory);

#endif // CHDB_WASM_EXTENDED


// ============================================================================
// Main Registration Function
// ============================================================================

/**
 * Register minimal set of storage engines for WASM builds.
 *
 * This function replaces the full registerStorages() when building with
 * CHDB_WASM_MINIMAL defined. It only registers engines that:
 *
 * 1. Work entirely in-memory (no filesystem or network I/O)
 * 2. Have no external library dependencies
 * 3. Are compatible with single-threaded/limited-threading WASM execution
 * 4. Are essential for basic SQL functionality
 *
 * The registered engines are sufficient for:
 * - Creating in-memory tables (Memory)
 * - Testing/benchmarking (Null)
 * - SQL view definitions (View)
 * - Basic query processing and result handling
 */
void registerStorages()
{
    auto & factory = StorageFactory::instance();

    // ========================================================================
    // Core Essential Engines
    // ========================================================================

    // Memory: Primary data storage for WASM - stores data in RAM
    // Usage: CREATE TABLE t (x Int32) ENGINE = Memory
    registerStorageMemory(factory);

    // Null: Black hole storage - accepts writes, returns nothing
    // Usage: CREATE TABLE t (x Int32) ENGINE = Null
    registerStorageNull(factory);

    // View: SQL views - essential for complex queries
    // Usage: CREATE VIEW v AS SELECT ...
    registerStorageView(factory);

    // ========================================================================
    // Extended Engines (Optional)
    // ========================================================================

#ifdef CHDB_WASM_EXTENDED
    // GenerateRandom: Useful for testing with synthetic data
    // Usage: CREATE TABLE t (x Int32) ENGINE = GenerateRandom(1, 5, 3)
    registerStorageGenerateRandom(factory);

    // Set: In-memory set for IN subqueries
    // Usage: CREATE TABLE t (x Int32) ENGINE = Set
    registerStorageSet(factory);

    // Join: In-memory join table
    // Usage: CREATE TABLE t (x Int32) ENGINE = Join(ANY, LEFT, x)
    registerStorageJoin(factory);
#endif

    // ========================================================================
    // Engines NOT Registered in Minimal Build
    // ========================================================================
    //
    // The following are explicitly NOT registered to reduce binary size
    // and avoid dependencies that don't work in WASM:
    //
    // File system dependent:
    // - registerStorageLog(factory);
    // - registerStorageStripeLog(factory);
    // - registerStorageMergeTree(factory);
    // - registerStorageFile(factory);
    //
    // Network dependent:
    // - registerStorageURL(factory);
    // - registerStorageS3(factory);        // #if USE_AWS_S3
    // - registerStorageHDFS(factory);      // #if USE_HDFS
    // - registerStorageKafka(factory);     // #if USE_RDKAFKA
    // - registerStorageRabbitMQ(factory);  // #if USE_AMQPCPP
    // - registerStorageNATS(factory);      // #if USE_NATSIO
    // - registerStorageMySQL(factory);     // #if USE_MYSQL
    // - registerStoragePostgreSQL(factory);// #if USE_LIBPQXX
    // - registerStorageMongoDB(factory);   // #if USE_MONGODB
    // - registerStorageRedis(factory);
    // - registerStorageODBC(factory);
    // - registerStorageJDBC(factory);
    //
    // Complex/Cluster dependent:
    // - registerStorageDistributed(factory);
    // - registerStorageDictionary(factory);
    // - registerStorageBuffer(factory);
    // - registerStorageMerge(factory);
    // - registerStorageMaterializedView(factory);
    // - registerStorageLiveView(factory);
    // - registerStorageWindowView(factory);
    // - registerStorageKeeperMap(factory);
    // - registerStorageObjectStorage(factory);
    //
    // Special purpose:
    // - registerStorageExecutable(factory);
    // - registerStorageFuzzQuery(factory);
    // - registerStorageFuzzJSON(factory);
    // - registerStorageLoop(factory);
    // - registerStorageTimeSeries(factory);
}

} // namespace DB


// ============================================================================
// Stub Declarations for Linker Compatibility (Optional)
// ============================================================================
//
// If the build system still links against code that references excluded
// storage registration functions, uncomment and implement stubs below.
// These provide empty implementations to satisfy the linker.
//

#ifdef CHDB_WASM_PROVIDE_STUBS

namespace DB
{

// Provide no-op stubs for storage engines that might be referenced elsewhere
// but shouldn't actually be available in WASM builds.

void registerStorageLog(StorageFactory &) {}
void registerStorageStripeLog(StorageFactory &) {}
void registerStorageMergeTree(StorageFactory &) {}
void registerStorageFile(StorageFactory &) {}
void registerStorageURL(StorageFactory &) {}
void registerStorageDistributed(StorageFactory &) {}
void registerStorageDictionary(StorageFactory &) {}
void registerStorageBuffer(StorageFactory &) {}
void registerStorageMerge(StorageFactory &) {}
void registerStorageMaterializedView(StorageFactory &) {}
void registerStorageLiveView(StorageFactory &) {}
void registerStorageWindowView(StorageFactory &) {}
void registerStorageExecutable(StorageFactory &) {}
void registerStorageFuzzQuery(StorageFactory &) {}
void registerStorageLoop(StorageFactory &) {}
void registerStorageTimeSeries(StorageFactory &) {}
void registerStorageODBC(StorageFactory &) {}
void registerStorageJDBC(StorageFactory &) {}
void registerStorageRedis(StorageFactory &) {}
void registerStorageKeeperMap(StorageFactory &) {}
void registerStorageObjectStorage(StorageFactory &) {}

#ifndef CHDB_WASM_EXTENDED
void registerStorageGenerateRandom(StorageFactory &) {}
void registerStorageSet(StorageFactory &) {}
void registerStorageJoin(StorageFactory &) {}
#endif

} // namespace DB

#endif // CHDB_WASM_PROVIDE_STUBS
