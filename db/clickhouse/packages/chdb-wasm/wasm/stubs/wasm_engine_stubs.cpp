/**
 * wasm_engine_stubs.cpp - Storage Engine Stubs for WASM Build
 *
 * This file provides stub implementations for ClickHouse storage engines that are
 * disabled in the WASM build. These stubs register with the StorageFactory and
 * throw clear "not supported" errors when a user attempts to use a disabled engine.
 *
 * WASM COMPATIBILITY RATIONALE
 * ============================
 *
 * MergeTree and most storage engines are incompatible with WASM because:
 * 1. mmap() - Memory-mapped files not supported in WASM sandbox
 * 2. File I/O - No direct filesystem access (only Emscripten virtual FS)
 * 3. Threading - Complex multi-threaded operations limited
 * 4. Network I/O - No socket access, external libs unavailable
 * 5. External Dependencies - AWS SDK, librdkafka, etc. not WASM-compatible
 *
 * KEPT ENGINES
 * ============
 * - Memory:     Pure RAM storage, fully WASM compatible
 * - View:       SQL view definition, no storage backend
 * - System:     Read-only metadata (selectively included)
 * - Null:       /dev/null equivalent, no storage
 * - Set/Join:   In-memory, optional
 * - Buffer:     In-memory, optional
 *
 * STUBBED ENGINES (this file)
 * ===========================
 *
 * MergeTree Family (~4.3MB source):
 *   - MergeTree, ReplicatedMergeTree
 *   - SummingMergeTree, AggregatingMergeTree
 *   - ReplacingMergeTree, CollapsingMergeTree
 *   - VersionedCollapsingMergeTree, GraphiteMergeTree
 *   - All Replicated* variants
 *
 * Distributed (~148KB source):
 *   - Distributed
 *
 * Message Queues (~556KB source):
 *   - Kafka, RabbitMQ, NATS, FileLog
 *
 * Object Storage (~1.1MB source):
 *   - S3, S3Queue, AzureBlobStorage, AzureQueue
 *   - HDFS, Hudi, DeltaLake, Iceberg
 *
 * External Databases (~440KB source):
 *   - PostgreSQL, MaterializedPostgreSQL
 *   - MySQL, MongoDB, Redis, SQLite
 *
 * File-based (~180KB source):
 *   - File, URL, FileCluster, URLCluster
 *
 * Complex Views (~248KB source):
 *   - MaterializedView, LiveView, WindowView
 *
 * Other:
 *   - Log, TinyLog, StripeLog (file I/O)
 *   - TimeSeries, Dictionary, RocksDB, Hive
 *   - KeeperMap, Executable, Loop, Merge
 *   - FuzzQuery, FuzzJSON, ArrowFlight
 *   - ODBC, JDBC, XDBC, YTsaurus
 *
 * USAGE
 * =====
 *
 * 1. Compile with USE_WASM_ENGINE_STUBS defined
 * 2. Call registerWasmEngineStubs() during initialization
 * 3. Users get clear error messages when trying to use disabled engines
 *
 * Example error:
 *   "Storage engine 'MergeTree' is not supported in WASM build.
 *    Reason: Requires mmap and file I/O incompatible with WASM sandbox.
 *    Use the Memory engine for in-memory data storage."
 */

#ifdef USE_WASM_ENGINE_STUBS

#include <Storages/StorageFactory.h>
#include <Interpreters/Context_fwd.h>
#include <Parsers/ASTCreateQuery.h>
#include <Common/Exception.h>

#include <string>
#include <vector>

namespace DB
{

namespace ErrorCodes
{
    extern const int NOT_IMPLEMENTED;
    extern const int SUPPORT_IS_DISABLED;
}

// ============================================================================
// Stub Registration Helper
// ============================================================================

namespace
{

/**
 * Information about a stubbed engine
 */
struct StubbedEngineInfo
{
    const char* name;
    const char* reason;
    const char* alternative;
    size_t estimated_size_kb;  // Estimated compiled size savings in KB
};

/**
 * Create a stub storage factory registration
 */
void registerStubbedEngine(
    StorageFactory& factory,
    const StubbedEngineInfo& info)
{
    factory.registerStorage(info.name, [info](const StorageFactory::Arguments& args) -> StoragePtr
    {
        throw Exception(
            ErrorCodes::NOT_IMPLEMENTED,
            "Storage engine '{}' is not supported in WASM build.\n"
            "Reason: {}\n"
            "Alternative: {}",
            info.name,
            info.reason,
            info.alternative);
    });
}

// ============================================================================
// Stubbed Engine Definitions
// ============================================================================

/**
 * MergeTree family engines
 * Total savings: ~2-3MB compiled
 */
const std::vector<StubbedEngineInfo> MERGETREE_ENGINES = {
    {
        "MergeTree",
        "Requires mmap and file I/O incompatible with WASM sandbox",
        "Use the Memory engine for in-memory data storage",
        2048  // ~2MB for base MergeTree
    },
    {
        "ReplicatedMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use the Memory engine for single-node in-memory storage",
        512
    },
    {
        "SummingMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine with manual aggregation queries",
        64
    },
    {
        "ReplicatedSummingMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine with manual aggregation queries",
        64
    },
    {
        "AggregatingMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine with -State aggregate functions",
        64
    },
    {
        "ReplicatedAggregatingMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine with -State aggregate functions",
        64
    },
    {
        "ReplacingMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine with DISTINCT or GROUP BY",
        64
    },
    {
        "ReplicatedReplacingMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine with DISTINCT or GROUP BY",
        64
    },
    {
        "CollapsingMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine with WHERE sign = 1",
        64
    },
    {
        "ReplicatedCollapsingMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine with WHERE sign = 1",
        64
    },
    {
        "VersionedCollapsingMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine with argMax for latest versions",
        64
    },
    {
        "ReplicatedVersionedCollapsingMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine with argMax for latest versions",
        64
    },
    {
        "GraphiteMergeTree",
        "Requires MergeTree infrastructure with file I/O",
        "Use Memory engine for metrics data",
        64
    },
    {
        "ReplicatedGraphiteMergeTree",
        "Requires ZooKeeper/Keeper coordination and file I/O",
        "Use Memory engine for metrics data",
        64
    },
};

/**
 * Distributed engine
 * Savings: ~100-200KB compiled
 */
const std::vector<StubbedEngineInfo> DISTRIBUTED_ENGINES = {
    {
        "Distributed",
        "Requires network I/O for cluster coordination",
        "Use Memory engine - data must be loaded locally in WASM",
        150
    },
};

/**
 * Message queue engines
 * Savings: ~500KB-1MB compiled + external library dependencies
 */
const std::vector<StubbedEngineInfo> MESSAGEQUEUE_ENGINES = {
    {
        "Kafka",
        "Requires librdkafka and network I/O",
        "Fetch data via JavaScript and INSERT into Memory table",
        400
    },
    {
        "RabbitMQ",
        "Requires AMQP client library and network I/O",
        "Fetch data via JavaScript and INSERT into Memory table",
        200
    },
    {
        "NATS",
        "Requires NATS client library and network I/O",
        "Fetch data via JavaScript and INSERT into Memory table",
        150
    },
    {
        "FileLog",
        "Requires filesystem access for log tailing",
        "Use Memory engine with data loaded via JavaScript",
        100
    },
};

/**
 * Object storage engines
 * Savings: ~1-2MB compiled + 5-10MB SDK dependencies
 */
const std::vector<StubbedEngineInfo> OBJECTSTORAGE_ENGINES = {
    {
        "S3",
        "Requires AWS SDK and network I/O",
        "Fetch data via JavaScript fetch() and INSERT into Memory table",
        500
    },
    {
        "S3Queue",
        "Requires AWS SDK and continuous network polling",
        "Use Memory engine with periodic JavaScript fetches",
        200
    },
    {
        "AzureBlobStorage",
        "Requires Azure SDK and network I/O",
        "Fetch data via JavaScript fetch() and INSERT into Memory table",
        500
    },
    {
        "AzureQueue",
        "Requires Azure SDK and continuous network polling",
        "Use Memory engine with periodic JavaScript fetches",
        200
    },
    {
        "HDFS",
        "Requires HDFS client library and network I/O",
        "Use Memory engine with data loaded externally",
        300
    },
    {
        "Hudi",
        "Requires S3/HDFS access for Hudi table format",
        "Use Memory engine with pre-processed data",
        100
    },
    {
        "DeltaLake",
        "Requires S3/HDFS access for Delta Lake format",
        "Use Memory engine with pre-processed data",
        100
    },
    {
        "Iceberg",
        "Requires S3/HDFS access for Iceberg table format",
        "Use Memory engine with pre-processed data",
        100
    },
};

/**
 * External database engines
 * Savings: ~300-500KB compiled + 2-5MB client libraries
 */
const std::vector<StubbedEngineInfo> EXTERNAL_DB_ENGINES = {
    {
        "PostgreSQL",
        "Requires libpq and network I/O",
        "Query PostgreSQL via JavaScript/server and INSERT results into Memory",
        200
    },
    {
        "MaterializedPostgreSQL",
        "Requires PostgreSQL replication protocol",
        "Not available - use Memory with periodic data refresh",
        150
    },
    {
        "MySQL",
        "Requires MySQL client library and network I/O",
        "Query MySQL via JavaScript/server and INSERT results into Memory",
        150
    },
    {
        "MongoDB",
        "Requires MongoDB C++ driver and network I/O",
        "Query MongoDB via JavaScript/server and INSERT results into Memory",
        150
    },
    {
        "Redis",
        "Requires hiredis library and network I/O",
        "Query Redis via JavaScript/server and INSERT results into Memory",
        100
    },
    {
        "SQLite",
        "Requires SQLite library and filesystem access",
        "Use Memory engine - SQLite data must be loaded into memory",
        100
    },
};

/**
 * File-based engines
 * Savings: ~100-150KB compiled
 */
const std::vector<StubbedEngineInfo> FILE_ENGINES = {
    {
        "File",
        "Requires filesystem access unavailable in WASM sandbox",
        "Load file content via JavaScript and INSERT into Memory",
        100
    },
    {
        "URL",
        "Requires HTTP client library and network I/O",
        "Fetch URL via JavaScript fetch() and INSERT into Memory",
        80
    },
};

/**
 * Complex view engines
 * Savings: ~150-250KB compiled
 */
const std::vector<StubbedEngineInfo> COMPLEXVIEW_ENGINES = {
    {
        "MaterializedView",
        "Requires background refresh and persistent storage",
        "Use View for SQL aliasing, or Memory for cached results",
        100
    },
    {
        "LiveView",
        "Requires background event processing",
        "Use View with periodic query refresh in JavaScript",
        80
    },
    {
        "WindowView",
        "Requires window-based background processing",
        "Use Window functions in regular queries",
        80
    },
};

/**
 * Log family engines (file-based)
 * Savings: ~50-100KB compiled
 */
const std::vector<StubbedEngineInfo> LOG_ENGINES = {
    {
        "Log",
        "Requires filesystem access for data files",
        "Use Memory engine for in-memory storage",
        50
    },
    {
        "TinyLog",
        "Requires filesystem access for data files",
        "Use Memory engine for small datasets",
        30
    },
    {
        "StripeLog",
        "Requires filesystem access for data files",
        "Use Memory engine for columnar in-memory storage",
        40
    },
};

/**
 * Other specialized engines
 */
const std::vector<StubbedEngineInfo> OTHER_ENGINES = {
    {
        "TimeSeries",
        "Requires complex indexing and potentially MergeTree backend",
        "Use Memory engine with time-based columns",
        200
    },
    {
        "Dictionary",
        "May require external data sources",
        "Use Memory engine and JOIN operations",
        50
    },
    {
        "EmbeddedRocksDB",
        "Requires RocksDB library and filesystem access",
        "Use Memory engine for key-value lookups",
        100
    },
    {
        "Hive",
        "Requires HDFS client and Hive metastore access",
        "Use Memory engine with pre-loaded data",
        100
    },
    {
        "KeeperMap",
        "Requires ZooKeeper/Keeper coordination",
        "Use Memory engine for in-memory maps",
        80
    },
    {
        "Executable",
        "Requires process spawning unavailable in WASM",
        "Process data in JavaScript before loading into Memory",
        50
    },
    {
        "ExecutablePool",
        "Requires process spawning unavailable in WASM",
        "Process data in JavaScript before loading into Memory",
        30
    },
    {
        "Loop",
        "Reads from same table in loop - memory usage concerns",
        "Use CTEs or temporary Memory tables",
        20
    },
    {
        "Merge",
        "Merges multiple tables - may involve non-Memory engines",
        "Use UNION ALL queries or JOIN operations",
        40
    },
    {
        "FuzzQuery",
        "Testing engine for fuzzing queries",
        "Not needed in production WASM builds",
        30
    },
    {
        "FuzzJSON",
        "Testing engine for fuzzing JSON",
        "Not needed in production WASM builds",
        30
    },
    {
        "ArrowFlight",
        "Requires Arrow Flight RPC and network I/O",
        "Use Memory engine with data loaded via JavaScript",
        100
    },
    {
        "ODBC",
        "Requires ODBC driver manager and drivers",
        "Use Memory engine with data fetched via JavaScript",
        50
    },
    {
        "JDBC",
        "Requires JVM bridge - not available in WASM",
        "Use Memory engine with data fetched via JavaScript",
        50
    },
    {
        "XDBC",
        "Generic ODBC/JDBC bridge",
        "Use Memory engine with data fetched via JavaScript",
        30
    },
    {
        "PrometheusQuery",
        "Requires HTTP client for Prometheus queries",
        "Query Prometheus via JavaScript and load into Memory",
        40
    },
    {
        "YTsaurus",
        "Requires YTsaurus client and network I/O",
        "Use Memory engine with data loaded externally",
        80
    },
};

} // anonymous namespace

// ============================================================================
// Public Registration Function
// ============================================================================

/**
 * Register all stubbed storage engines with the StorageFactory.
 * Call this during WASM module initialization.
 *
 * This function registers stub implementations that throw clear error messages
 * when users attempt to use storage engines that are not supported in WASM.
 */
void registerWasmEngineStubs()
{
    auto& factory = StorageFactory::instance();

    // Register all stubbed engines
    auto registerEngineSet = [&factory](const std::vector<StubbedEngineInfo>& engines)
    {
        for (const auto& engine : engines)
        {
            registerStubbedEngine(factory, engine);
        }
    };

    // MergeTree family (~2-3MB savings)
    registerEngineSet(MERGETREE_ENGINES);

    // Distributed (~100-200KB savings)
    registerEngineSet(DISTRIBUTED_ENGINES);

    // Message queues (~500KB-1MB savings + libs)
    registerEngineSet(MESSAGEQUEUE_ENGINES);

    // Object storage (~1-2MB savings + SDKs)
    registerEngineSet(OBJECTSTORAGE_ENGINES);

    // External databases (~300-500KB savings + libs)
    registerEngineSet(EXTERNAL_DB_ENGINES);

    // File-based (~100-150KB savings)
    registerEngineSet(FILE_ENGINES);

    // Complex views (~150-250KB savings)
    registerEngineSet(COMPLEXVIEW_ENGINES);

    // Log family (~50-100KB savings)
    registerEngineSet(LOG_ENGINES);

    // Other specialized engines
    registerEngineSet(OTHER_ENGINES);
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Get list of all stubbed (unsupported) engine names
 */
std::vector<std::string> getStubbedEngineNames()
{
    std::vector<std::string> names;

    auto addEngines = [&names](const std::vector<StubbedEngineInfo>& engines)
    {
        for (const auto& engine : engines)
        {
            names.push_back(engine.name);
        }
    };

    addEngines(MERGETREE_ENGINES);
    addEngines(DISTRIBUTED_ENGINES);
    addEngines(MESSAGEQUEUE_ENGINES);
    addEngines(OBJECTSTORAGE_ENGINES);
    addEngines(EXTERNAL_DB_ENGINES);
    addEngines(FILE_ENGINES);
    addEngines(COMPLEXVIEW_ENGINES);
    addEngines(LOG_ENGINES);
    addEngines(OTHER_ENGINES);

    return names;
}

/**
 * Get list of supported (non-stubbed) engine names
 */
std::vector<std::string> getSupportedEngineNames()
{
    return {
        "Memory",
        "View",
        "Null",
        "Set",
        "Join",
        "Buffer",
        "GenerateRandom",
        "Values",
    };
}

/**
 * Check if an engine name is stubbed (not supported in WASM)
 */
bool isEngineStubbedInWasm(const std::string& name)
{
    auto checkEngines = [&name](const std::vector<StubbedEngineInfo>& engines) -> bool
    {
        for (const auto& engine : engines)
        {
            if (name == engine.name)
                return true;
        }
        return false;
    };

    return checkEngines(MERGETREE_ENGINES)
        || checkEngines(DISTRIBUTED_ENGINES)
        || checkEngines(MESSAGEQUEUE_ENGINES)
        || checkEngines(OBJECTSTORAGE_ENGINES)
        || checkEngines(EXTERNAL_DB_ENGINES)
        || checkEngines(FILE_ENGINES)
        || checkEngines(COMPLEXVIEW_ENGINES)
        || checkEngines(LOG_ENGINES)
        || checkEngines(OTHER_ENGINES);
}

/**
 * Get estimated size savings for all stubbed engines in KB
 */
size_t getEstimatedSizeSavingsKB()
{
    size_t total = 0;

    auto addSavings = [&total](const std::vector<StubbedEngineInfo>& engines)
    {
        for (const auto& engine : engines)
        {
            total += engine.estimated_size_kb;
        }
    };

    addSavings(MERGETREE_ENGINES);
    addSavings(DISTRIBUTED_ENGINES);
    addSavings(MESSAGEQUEUE_ENGINES);
    addSavings(OBJECTSTORAGE_ENGINES);
    addSavings(EXTERNAL_DB_ENGINES);
    addSavings(FILE_ENGINES);
    addSavings(COMPLEXVIEW_ENGINES);
    addSavings(LOG_ENGINES);
    addSavings(OTHER_ENGINES);

    return total;
}

} // namespace DB

#endif // USE_WASM_ENGINE_STUBS
