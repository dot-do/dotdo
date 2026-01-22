/**
 * DataPartStorageVFS.h - VFS-backed IDataPartStorage implementation
 *
 * This class implements the IDataPartStorage interface from ClickHouse
 * but uses the VFS layer for all file operations. This allows MergeTree
 * parts to be read from Cloudflare R2 via the JavaScript VFS bridge.
 *
 * The VFS layer handles:
 *   - File reads via R2 range requests
 *   - Directory listing via R2 list operations
 *   - Metadata from Durable Objects
 *
 * Usage:
 *   auto storage = std::make_shared<DataPartStorageVFS>(
 *       "default",           // database
 *       "events",            // table
 *       "202401",            // partition
 *       "20240115_1_1_0"     // part name
 *   );
 *
 *   auto buf = storage->readFile("data.bin", settings, std::nullopt, std::nullopt);
 *   // Read column data...
 */

#pragma once

#include "MergeTreeStandalone.h"
#include <memory>
#include <string>
#include <vector>

namespace DB
{

/**
 * IDataPartStorage implementation backed by VFS
 *
 * Paths are constructed as: {database}/{table}/data/{partition}/{part_name}/{file}
 * This matches the R2 key structure defined in MERGETREE_VFS_DESIGN.md
 */
class DataPartStorageVFS : public IDataPartStorage
{
public:
    /**
     * Create VFS-backed storage for a part
     *
     * @param database   Database name (e.g., "default")
     * @param table      Table name (e.g., "events")
     * @param partition  Partition key value (e.g., "202401")
     * @param part_name  Part directory name (e.g., "20240115_1_1_0")
     */
    DataPartStorageVFS(
        const String& database,
        const String& table,
        const String& partition,
        const String& part_name);

    /**
     * Create VFS-backed storage for a part with explicit root path
     *
     * @param root_path  Root path (e.g., "default/events/data/202401")
     * @param part_name  Part directory name (e.g., "20240115_1_1_0")
     */
    DataPartStorageVFS(const String& root_path, const String& part_name);

    ~DataPartStorageVFS() override = default;

    // -------------------------------------------------------------------------
    // Type identification
    // -------------------------------------------------------------------------

    MergeTreeDataPartStorageType getType() const override
    {
        return MergeTreeDataPartStorageType::Virtual;
    }

    // -------------------------------------------------------------------------
    // Path methods
    // -------------------------------------------------------------------------

    /// Full path: "database/table/data/partition/part_name"
    std::string getFullPath() const override;

    /// Relative path (same as full path for VFS)
    std::string getRelativePath() const override;

    /// Part directory name: "part_name"
    std::string getPartDirectory() const override;

    /// Full root path: "database/table/data/partition"
    std::string getFullRootPath() const override;

    /// Parent directory (empty or "detached" for detached parts)
    std::string getParentDirectory() const override;

    // -------------------------------------------------------------------------
    // Existence checks
    // -------------------------------------------------------------------------

    /// Check if part directory exists
    bool exists() const override;

    /// Check if file exists within part
    bool existsFile(const std::string& name) const override;

    /// Check if subdirectory exists
    bool existsDirectory(const std::string& name) const override;

    // -------------------------------------------------------------------------
    // File metadata
    // -------------------------------------------------------------------------

    /// Get file size in bytes
    size_t getFileSize(const std::string& file_name) const override;

    // -------------------------------------------------------------------------
    // File reading
    // -------------------------------------------------------------------------

    /// Open file for reading
    std::unique_ptr<ReadBufferFromFileBase> readFile(
        const std::string& name,
        const ReadSettings& settings,
        std::optional<size_t> read_hint,
        std::optional<size_t> file_size) const override;

    // -------------------------------------------------------------------------
    // Disk information
    // -------------------------------------------------------------------------

    std::string getDiskName() const override { return "vfs"; }
    std::string getDiskType() const override { return "vfs"; }
    std::string getDiskPath() const override { return ""; }
    bool supportParallelWrite() const override { return false; }
    bool isBroken() const override { return false; }
    bool isReadonly() const override { return true; }  // VFS is read-only for now
    String getUniqueId() const override;

    // -------------------------------------------------------------------------
    // Projection support (not implemented for WASM)
    // -------------------------------------------------------------------------

    std::shared_ptr<IDataPartStorage> getProjection(const std::string& /*name*/, bool /*use_parent_transaction*/)
    {
        return nullptr;
    }

    std::shared_ptr<const IDataPartStorage> getProjection(const std::string& /*name*/) const
    {
        return nullptr;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// Build full path to a file within the part
    String buildFilePath(const String& file_name) const;

    /// List files in the part directory
    std::vector<String> listFiles() const;

private:
    String database_;
    String table_;
    String partition_;
    String part_name_;
    String root_path_;
};

using DataPartStorageVFSPtr = std::shared_ptr<DataPartStorageVFS>;

} // namespace DB
