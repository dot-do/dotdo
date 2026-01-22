/**
 * DataPartStorageVFS.cpp - VFS-backed IDataPartStorage implementation
 *
 * This file implements the DataPartStorageVFS class which provides file
 * access to MergeTree parts via the VFS layer.
 */

#include "DataPartStorageVFS.h"
#include <sstream>

namespace DB
{

// =============================================================================
// Constructor
// =============================================================================

DataPartStorageVFS::DataPartStorageVFS(
    const String& database,
    const String& table,
    const String& partition,
    const String& part_name)
    : database_(database)
    , table_(table)
    , partition_(partition)
    , part_name_(part_name)
{
    // Build root path: database/table/data/partition
    std::ostringstream ss;
    ss << database << "/" << table << "/data/" << partition;
    root_path_ = ss.str();
}

DataPartStorageVFS::DataPartStorageVFS(const String& root_path, const String& part_name)
    : part_name_(part_name)
    , root_path_(root_path)
{
    // Parse database/table/partition from root_path if possible
    // Format: database/table/data/partition
    size_t pos = 0;
    size_t next = root_path.find('/');
    if (next != String::npos)
    {
        database_ = root_path.substr(pos, next - pos);
        pos = next + 1;
        next = root_path.find('/', pos);
        if (next != String::npos)
        {
            table_ = root_path.substr(pos, next - pos);
            pos = next + 1;
            // Skip "data/"
            next = root_path.find('/', pos);
            if (next != String::npos)
            {
                pos = next + 1;
                partition_ = root_path.substr(pos);
            }
        }
    }
}

// =============================================================================
// Path methods
// =============================================================================

std::string DataPartStorageVFS::getFullPath() const
{
    return root_path_ + "/" + part_name_;
}

std::string DataPartStorageVFS::getRelativePath() const
{
    // For VFS, relative path is same as full path (no local disk path)
    return getFullPath();
}

std::string DataPartStorageVFS::getPartDirectory() const
{
    return part_name_;
}

std::string DataPartStorageVFS::getFullRootPath() const
{
    return root_path_;
}

std::string DataPartStorageVFS::getParentDirectory() const
{
    // Empty for normal parts, "detached" for detached parts
    return "";
}

// =============================================================================
// Existence checks
// =============================================================================

bool DataPartStorageVFS::exists() const
{
    vfs_stat_t st;
    String path = getFullPath();
    return vfs_stat(path.c_str(), &st) == VFS_OK;
}

bool DataPartStorageVFS::existsFile(const std::string& name) const
{
    vfs_stat_t st;
    String path = buildFilePath(name);
    if (vfs_stat(path.c_str(), &st) != VFS_OK)
        return false;
    return (st.mode & VFS_S_IFREG) != 0;
}

bool DataPartStorageVFS::existsDirectory(const std::string& name) const
{
    vfs_stat_t st;
    String path = buildFilePath(name);
    if (vfs_stat(path.c_str(), &st) != VFS_OK)
        return false;
    return (st.mode & VFS_S_IFDIR) != 0;
}

// =============================================================================
// File metadata
// =============================================================================

size_t DataPartStorageVFS::getFileSize(const std::string& file_name) const
{
    vfs_stat_t st;
    String path = buildFilePath(file_name);
    if (vfs_stat(path.c_str(), &st) != VFS_OK)
        return 0;
    return static_cast<size_t>(st.size);
}

// =============================================================================
// File reading
// =============================================================================

std::unique_ptr<ReadBufferFromFileBase> DataPartStorageVFS::readFile(
    const std::string& name,
    const ReadSettings& settings,
    std::optional<size_t> /*read_hint*/,
    std::optional<size_t> /*file_size*/) const
{
    String path = buildFilePath(name);
    size_t buf_size = settings.local_fs_buffer_size;
    if (buf_size == 0)
        buf_size = 65536;

    return std::make_unique<ReadBufferFromVFS>(path, buf_size);
}

// =============================================================================
// Disk information
// =============================================================================

String DataPartStorageVFS::getUniqueId() const
{
    // Generate a unique ID based on the full path
    std::ostringstream ss;
    ss << "vfs:" << getFullPath();
    return ss.str();
}

// =============================================================================
// Internal helpers
// =============================================================================

String DataPartStorageVFS::buildFilePath(const String& file_name) const
{
    return getFullPath() + "/" + file_name;
}

std::vector<String> DataPartStorageVFS::listFiles() const
{
    std::vector<String> result;

    String path = getFullPath();
    vfs_handle_t dir = vfs_opendir(path.c_str());
    if (dir < 0)
        return result;

    vfs_dirent_t entry;
    while (vfs_readdir(dir, &entry) == VFS_OK)
    {
        if (entry.type == VFS_S_IFREG)
            result.emplace_back(entry.name);
    }

    vfs_closedir(dir);
    return result;
}

} // namespace DB
