/**
 * wasm_storage_stubs.cpp - Stub implementations for storage engines not supported in WASM
 *
 * This file provides stub implementations for ClickHouse storage engines that cannot
 * or should not be compiled into the WASM build. These stubs allow the codebase to
 * compile while throwing clear "not supported" errors at runtime.
 *
 * STUB vs KEEP Decision Matrix:
 * =============================
 *
 * STUB (exclude from WASM):
 * - External service connections: S3, Kafka, RabbitMQ, NATS, PostgreSQL, MySQL, MongoDB, Redis
 * - Distributed/cluster storage: Distributed, ReplicatedMergeTree, all Replicated* variants
 * - File system storage requiring OS features: HDFS, File (local filesystem)
 * - Complex external integrations: MaterializedPostgreSQL, MaterializedMySQL
 * - Network-dependent: URL, RemoteHTTP, S3Queue, AzureBlobStorage
 * - Resource-intensive: Dictionary (with external sources), MaterializedView (complex)
 *
 * KEEP (include in WASM):
 * - In-memory storage: Memory, Set, Join, Buffer
 * - Simple table engines: Null, Log, TinyLog, StripeLog
 * - Merge family (non-replicated): MergeTree, SummingMergeTree, AggregatingMergeTree
 *   (with in-memory/minimal disk simulation)
 * - View engines: View (simple), LiveView (potentially)
 * - System tables: System (read-only metadata)
 *
 * Usage:
 * ======
 * Define USE_WASM_STUBS to enable these stub implementations.
 * The build system should exclude the real implementations and include this file instead.
 *
 * Example CMake:
 *   if(WASM_BUILD)
 *       add_compile_definitions(USE_WASM_STUBS)
 *       # Exclude real storage sources
 *       # Include wasm_storage_stubs.cpp
 *   endif()
 */

#ifdef USE_WASM_STUBS

#include <stdexcept>
#include <string>

// Mock exception class for standalone compilation
// In real ClickHouse build, use: #include <Common/Exception.h>
namespace DB
{

// Error codes (subset from ErrorCodes.h)
namespace ErrorCodes
{
    extern const int NOT_IMPLEMENTED = 48;
    extern const int SUPPORT_IS_DISABLED = 672;
}

/**
 * Base exception class (simplified for stubs)
 * In real build, this comes from Common/Exception.h
 */
class Exception : public std::runtime_error
{
public:
    Exception(int code, const std::string& message)
        : std::runtime_error(message), error_code(code) {}

    int code() const { return error_code; }

private:
    int error_code;
};

/**
 * Helper macro for throwing WASM not-supported exceptions
 */
#define WASM_NOT_SUPPORTED(component_name) \
    throw Exception(ErrorCodes::NOT_IMPLEMENTED, \
        std::string(component_name) + " is not supported in WASM build")

#define WASM_STORAGE_NOT_SUPPORTED(storage_name) \
    throw Exception(ErrorCodes::NOT_IMPLEMENTED, \
        "Storage engine '" + std::string(storage_name) + "' is not supported in WASM build. " \
        "WASM builds support in-memory engines: Memory, Null, Log, TinyLog, StripeLog, MergeTree (limited).")


// ============================================================================
// Forward declarations / Mock base classes
// These would come from real ClickHouse headers in actual build
// ============================================================================

/**
 * Mock IStorage interface (simplified)
 * Real version: src/Storages/IStorage.h
 */
class IStorage
{
public:
    virtual ~IStorage() = default;

    // Core operations that stubs will override
    virtual void read() { WASM_NOT_SUPPORTED("IStorage::read"); }
    virtual void write() { WASM_NOT_SUPPORTED("IStorage::write"); }
    virtual void startup() {}
    virtual void shutdown() {}
    virtual std::string getName() const = 0;
};


// ============================================================================
// S3 Storage Stub
// ============================================================================

/**
 * StorageS3 - Object storage access
 *
 * Stubbed because:
 * - Requires AWS SDK
 * - Network I/O not available in WASM sandbox
 * - Complex credential management
 */
class StorageS3 : public IStorage
{
public:
    std::string getName() const override { return "S3"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("S3");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("S3");
    }

    static void registerStorage()
    {
        // Registration stub - would register with StorageFactory in real build
    }
};


// ============================================================================
// Kafka Storage Stub
// ============================================================================

/**
 * StorageKafka - Kafka message queue integration
 *
 * Stubbed because:
 * - Requires librdkafka
 * - Network I/O not available
 * - Complex threading model incompatible with WASM
 */
class StorageKafka : public IStorage
{
public:
    std::string getName() const override { return "Kafka"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Kafka");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Kafka");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// PostgreSQL Storage Stub
// ============================================================================

/**
 * StoragePostgreSQL - PostgreSQL database integration
 *
 * Stubbed because:
 * - Requires libpq
 * - Network I/O not available
 * - External database connections not possible in WASM
 */
class StoragePostgreSQL : public IStorage
{
public:
    std::string getName() const override { return "PostgreSQL"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("PostgreSQL");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("PostgreSQL");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// MySQL Storage Stub
// ============================================================================

/**
 * StorageMySQL - MySQL database integration
 *
 * Stubbed because:
 * - Requires MySQL client library
 * - Network I/O not available
 */
class StorageMySQL : public IStorage
{
public:
    std::string getName() const override { return "MySQL"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MySQL");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MySQL");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// MongoDB Storage Stub
// ============================================================================

/**
 * StorageMongoDB - MongoDB database integration
 *
 * Stubbed because:
 * - Requires MongoDB C++ driver
 * - Network I/O not available
 */
class StorageMongoDB : public IStorage
{
public:
    std::string getName() const override { return "MongoDB"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MongoDB");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MongoDB");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// Redis Storage Stub
// ============================================================================

/**
 * StorageRedis - Redis key-value store integration
 *
 * Stubbed because:
 * - Requires hiredis library
 * - Network I/O not available
 */
class StorageRedis : public IStorage
{
public:
    std::string getName() const override { return "Redis"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Redis");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Redis");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// HDFS Storage Stub
// ============================================================================

/**
 * StorageHDFS - Hadoop Distributed File System integration
 *
 * Stubbed because:
 * - Requires HDFS client library
 * - Network I/O not available
 * - Complex distributed filesystem operations
 */
class StorageHDFS : public IStorage
{
public:
    std::string getName() const override { return "HDFS"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("HDFS");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("HDFS");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// URL Storage Stub
// ============================================================================

/**
 * StorageURL - HTTP/HTTPS URL access
 *
 * Stubbed because:
 * - Requires HTTP client (curl/poco)
 * - Network I/O not available in WASM sandbox
 *
 * Note: Could potentially be implemented with fetch() API in browser context,
 * but would require significant JavaScript interop.
 */
class StorageURL : public IStorage
{
public:
    std::string getName() const override { return "URL"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("URL");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("URL");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// Distributed Storage Stub
// ============================================================================

/**
 * StorageDistributed - Distributed table across shards
 *
 * Stubbed because:
 * - Requires cluster coordination
 * - Network I/O for inter-node communication
 * - Complex distributed query execution
 */
class StorageDistributed : public IStorage
{
public:
    std::string getName() const override { return "Distributed"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Distributed");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("Distributed");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// Replicated MergeTree Storage Stub
// ============================================================================

/**
 * StorageReplicatedMergeTree - Replicated table with ZooKeeper coordination
 *
 * Stubbed because:
 * - Requires ZooKeeper client
 * - Complex replication protocol
 * - Network I/O for coordination
 */
class StorageReplicatedMergeTree : public IStorage
{
public:
    std::string getName() const override { return "ReplicatedMergeTree"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("ReplicatedMergeTree");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("ReplicatedMergeTree");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// RabbitMQ Storage Stub
// ============================================================================

/**
 * StorageRabbitMQ - RabbitMQ message queue integration
 *
 * Stubbed because:
 * - Requires AMQP client library
 * - Network I/O not available
 */
class StorageRabbitMQ : public IStorage
{
public:
    std::string getName() const override { return "RabbitMQ"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("RabbitMQ");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("RabbitMQ");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// NATS Storage Stub
// ============================================================================

/**
 * StorageNATS - NATS message queue integration
 *
 * Stubbed because:
 * - Requires NATS client library
 * - Network I/O not available
 */
class StorageNATS : public IStorage
{
public:
    std::string getName() const override { return "NATS"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("NATS");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("NATS");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// Azure Blob Storage Stub
// ============================================================================

/**
 * StorageAzureBlobStorage - Azure Blob Storage integration
 *
 * Stubbed because:
 * - Requires Azure SDK
 * - Network I/O not available
 */
class StorageAzureBlobStorage : public IStorage
{
public:
    std::string getName() const override { return "AzureBlobStorage"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("AzureBlobStorage");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("AzureBlobStorage");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// File Storage Stub
// ============================================================================

/**
 * StorageFile - Local filesystem file access
 *
 * Stubbed because:
 * - Requires filesystem access
 * - WASM has sandboxed virtual filesystem only
 *
 * Note: Could potentially be implemented with Emscripten's virtual filesystem,
 * but would require careful memory management for large files.
 */
class StorageFile : public IStorage
{
public:
    std::string getName() const override { return "File"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("File");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("File");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// MaterializedPostgreSQL Storage Stub
// ============================================================================

/**
 * StorageMaterializedPostgreSQL - PostgreSQL logical replication
 *
 * Stubbed because:
 * - Requires PostgreSQL replication protocol
 * - Continuous network I/O
 * - Complex state management
 */
class StorageMaterializedPostgreSQL : public IStorage
{
public:
    std::string getName() const override { return "MaterializedPostgreSQL"; }

    void read() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MaterializedPostgreSQL");
    }

    void write() override
    {
        WASM_STORAGE_NOT_SUPPORTED("MaterializedPostgreSQL");
    }

    static void registerStorage()
    {
        // Registration stub
    }
};


// ============================================================================
// Storage Registration Function
// ============================================================================

/**
 * Register all stubbed storage engines with the storage factory.
 * Call this during WASM module initialization.
 */
void registerWasmStorageStubs()
{
    StorageS3::registerStorage();
    StorageKafka::registerStorage();
    StoragePostgreSQL::registerStorage();
    StorageMySQL::registerStorage();
    StorageMongoDB::registerStorage();
    StorageRedis::registerStorage();
    StorageHDFS::registerStorage();
    StorageURL::registerStorage();
    StorageDistributed::registerStorage();
    StorageReplicatedMergeTree::registerStorage();
    StorageRabbitMQ::registerStorage();
    StorageNATS::registerStorage();
    StorageAzureBlobStorage::registerStorage();
    StorageFile::registerStorage();
    StorageMaterializedPostgreSQL::registerStorage();
}

} // namespace DB

#endif // USE_WASM_STUBS
