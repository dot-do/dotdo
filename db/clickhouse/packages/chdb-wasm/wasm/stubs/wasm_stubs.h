/**
 * wasm_stubs.h - WASM Stub Architecture Header
 *
 * This header provides the interface for the WASM stub architecture that allows
 * ClickHouse to compile for WebAssembly while gracefully handling unsupported features.
 *
 * ARCHITECTURE OVERVIEW
 * =====================
 *
 * The WASM build of ClickHouse uses a stub pattern to exclude heavy features while
 * maintaining compilation compatibility. Stubs throw clear "not supported" exceptions
 * at runtime instead of failing at compile time or silently misbehaving.
 *
 * Benefits:
 * 1. Reduced WASM module size (target: <10MB gzipped for core features)
 * 2. Clear error messages when unsupported features are used
 * 3. Same API surface as full ClickHouse - no code changes needed for queries
 * 4. Gradual enablement - stubs can be replaced with real implementations
 *
 * USAGE
 * =====
 *
 * 1. Define USE_WASM_STUBS in your build:
 *    ```cmake
 *    if(WASM_BUILD)
 *        add_compile_definitions(USE_WASM_STUBS)
 *    endif()
 *    ```
 *
 * 2. Include this header:
 *    ```cpp
 *    #include "wasm_stubs.h"
 *    ```
 *
 * 3. Call registration during initialization:
 *    ```cpp
 *    DB::registerAllWasmStubs();
 *    ```
 *
 * COMPONENT CLASSIFICATION
 * ========================
 *
 * STORAGE ENGINES
 * ---------------
 * KEEP (in-memory/simple):          STUB (external/distributed):
 * - Memory                          - S3
 * - Null                            - Kafka
 * - Log, TinyLog, StripeLog         - PostgreSQL, MySQL, MongoDB
 * - MergeTree (limited)             - Redis, HDFS
 * - Buffer, Set, Join               - Distributed, Replicated*
 * - View                            - URL, File
 * - System tables                   - RabbitMQ, NATS
 *                                   - AzureBlobStorage
 *
 * FUNCTIONS
 * ---------
 * KEEP (core SQL):                  STUB (heavy/external):
 * - Arithmetic, Comparison          - H3 geospatial (~2MB)
 * - String manipulation             - S2 geospatial (~3MB)
 * - Date/Time operations            - ML (CatBoost ~50MB)
 * - Type conversions                - NLP (language models)
 * - Basic aggregates                - External services (S3, URL)
 * - Array operations                - Complex aggregates
 * - JSON functions
 * - Hash functions
 * - Math functions
 *
 * FORMATS
 * -------
 * KEEP (text-based):                STUB (binary/heavy):
 * - TabSeparated, CSV               - Parquet (~15MB Arrow)
 * - JSON, JSONEachRow               - ORC, Arrow
 * - Values, Pretty                  - Avro, Protobuf (~5MB)
 * - Native, RowBinary               - CapnProto, MsgPack
 * - Markdown, XML                   - MySQLDump
 * - Null                            - Template, Regexp
 *
 * SIZE IMPACT ESTIMATES
 * =====================
 *
 * Component sizes (approximate, gzipped):
 *
 * Core ClickHouse (stubbed):    ~5-8MB
 * + Parquet support:            +3-4MB (Arrow library)
 * + H3 functions:               +0.5MB
 * + S2 functions:               +0.8MB
 * + Protobuf support:           +1.2MB
 * + Full ML support:            +10-15MB
 *
 * Target WASM sizes:
 * - Minimal (SQL only):         ~3MB
 * - Standard (+ JSON/formats):  ~5MB
 * - Extended (+ some geo):      ~7MB
 * - Full (everything):          ~20MB+
 *
 * ERROR HANDLING
 * ==============
 *
 * When a stubbed feature is used, an exception is thrown with:
 * - Error code: NOT_IMPLEMENTED (48)
 * - Clear message explaining what's not supported
 * - Suggested alternatives for WASM context
 *
 * Example error:
 * "Storage engine 'S3' is not supported in WASM build.
 *  WASM builds support in-memory engines: Memory, Null, Log, TinyLog, StripeLog, MergeTree (limited)."
 *
 * INTEGRATION PATTERN
 * ===================
 *
 * The recommended pattern for JavaScript integration:
 *
 * ```javascript
 * try {
 *     const result = await clickhouse.query("SELECT * FROM s3('...')");
 * } catch (error) {
 *     if (error.message.includes('not supported in WASM')) {
 *         // Fetch data via JavaScript fetch() and load into Memory table
 *         const data = await fetch(s3Url);
 *         await clickhouse.query(`INSERT INTO memory_table FORMAT JSONEachRow ${data}`);
 *     }
 * }
 * ```
 *
 * VERSIONING
 * ==========
 *
 * Stub version: 1.0.0
 * Based on ClickHouse: 24.x
 * Last updated: 2024
 */

#ifndef CLICKHOUSE_WASM_STUBS_H
#define CLICKHOUSE_WASM_STUBS_H

#ifdef USE_WASM_STUBS

#include <string>
#include <vector>

namespace DB
{

// ============================================================================
// Registration Functions
// ============================================================================

/**
 * Register all WASM storage stubs with the storage factory.
 * Defined in: wasm_storage_stubs.cpp
 */
void registerWasmStorageStubs();

/**
 * Register all WASM function stubs with the function factory.
 * Defined in: wasm_function_stubs.cpp
 */
void registerWasmFunctionStubs();

/**
 * Register all WASM format stubs with the format factory.
 * Defined in: wasm_format_stubs.cpp
 */
void registerWasmFormatStubs();

/**
 * Initialize WASM network stubs.
 * Defined in: wasm_network_stubs.cpp
 * Note: This is a C function, declared in wasm_network_stubs.h
 */
extern "C" void wasm_network_stubs_init(void);

/**
 * Register all WASM stubs. Call this during module initialization.
 */
inline void registerAllWasmStubs()
{
    registerWasmStorageStubs();
    registerWasmFunctionStubs();
    registerWasmFormatStubs();
    wasm_network_stubs_init();
}


// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Check if a function is stubbed (not fully supported) in WASM
 */
bool isFunctionStubbedInWasm(const std::string& name);

/**
 * Check if an input format is stubbed in WASM
 */
bool isInputFormatStubbedInWasm(const std::string& name);

/**
 * Check if an output format is stubbed in WASM
 */
bool isOutputFormatStubbedInWasm(const std::string& name);

/**
 * Get list of all stubbed function names
 */
const std::vector<std::string>& getStubbedFunctionList();

/**
 * Get list of supported input formats
 */
const std::vector<std::string>& getSupportedInputFormats();

/**
 * Get list of supported output formats
 */
const std::vector<std::string>& getSupportedOutputFormats();


// ============================================================================
// Constants
// ============================================================================

/**
 * WASM stub version for compatibility checking
 */
constexpr const char* WASM_STUBS_VERSION = "1.0.0";

/**
 * List of stubbed storage engines
 */
constexpr const char* STUBBED_STORAGES[] = {
    "S3",
    "Kafka",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "HDFS",
    "URL",
    "Distributed",
    "ReplicatedMergeTree",
    "ReplicatedSummingMergeTree",
    "ReplicatedAggregatingMergeTree",
    "ReplicatedReplacingMergeTree",
    "ReplicatedCollapsingMergeTree",
    "ReplicatedVersionedCollapsingMergeTree",
    "ReplicatedGraphiteMergeTree",
    "RabbitMQ",
    "NATS",
    "AzureBlobStorage",
    "File",
    "MaterializedPostgreSQL",
    "MaterializedMySQL",
};

/**
 * List of supported storage engines in WASM
 */
constexpr const char* SUPPORTED_STORAGES[] = {
    "Memory",
    "Null",
    "Log",
    "TinyLog",
    "StripeLog",
    "MergeTree",
    "SummingMergeTree",
    "AggregatingMergeTree",
    "ReplacingMergeTree",
    "CollapsingMergeTree",
    "VersionedCollapsingMergeTree",
    "Buffer",
    "Set",
    "Join",
    "View",
    "MaterializedView",
};

} // namespace DB

#endif // USE_WASM_STUBS

#endif // CLICKHOUSE_WASM_STUBS_H
