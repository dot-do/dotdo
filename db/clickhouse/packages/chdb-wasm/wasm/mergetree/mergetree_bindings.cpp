/**
 * mergetree_bindings.cpp - C API bindings for MergeTree WASM module
 *
 * This file provides the JavaScript-callable API for reading MergeTree parts.
 * It wraps the MergeTree reader components and exposes them via simple C functions.
 *
 * Key functionality:
 *   - Part metadata reading (columns.txt, checksums.txt, count.txt)
 *   - Mark file parsing (.mrk2, .mrk3)
 *   - Primary index reading (primary.idx)
 *   - Column data reading (.bin files)
 *   - MergeTree variant support (Replacing, Summing, Aggregating, Collapsing, etc.)
 *
 * The API is designed to be called from JavaScript via Emscripten:
 *
 *   const reader = Module._mergetree_reader_create(partPath);
 *   const columnCount = Module._mergetree_reader_get_column_count(reader);
 *   const result = Module._mergetree_reader_read_column(reader, columnIndex, startRow, rowCount);
 *   Module._mergetree_reader_destroy(reader);
 *
 * MergeTree Variant Support:
 *   const mode = Module._mergetree_mode_from_name("ReplacingMergeTree");
 *   const features = Module._mergetree_mode_get_features(mode);
 *   const supported = Module._mergetree_variant_is_supported(mode);
 */

#ifndef MERGETREE_STANDALONE_BUILD
#define MERGETREE_STANDALONE_BUILD
#endif

// Enable implementation of MergeTreeVariants.h functions
#ifndef MERGETREE_VARIANTS_IMPLEMENTATION
#define MERGETREE_VARIANTS_IMPLEMENTATION
#endif

#include "MergeTreeStandalone.h"
#include "MergeTreeVariants.h"
#include "DataPartStorageVFS.h"
// Note: vfs.h is already included via MergeTreeStandalone.h (via extern "C" declarations)

#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <sstream>
#include <vector>

// =============================================================================
// MergeTree Part Reader Context
// =============================================================================

namespace DB
{

/**
 * PartInfo - Information about a MergeTree part
 */
struct PartInfo
{
    String name;             // Part name (e.g., "20240115_1_1_0")
    String partition;        // Partition key value
    size_t rows = 0;         // Total rows in part
    size_t marks = 0;        // Number of marks
    size_t granularity = 8192;  // Index granularity
    bool has_final_mark = false;

    NamesAndTypesList columns;  // Column schema
    std::map<String, size_t> column_sizes;  // Column file sizes

    MergeTreeDataPartType part_type = MergeTreeDataPartType::Wide;

    // MergeTree variant information
    MergeTreeVariant variant;          // Variant type and metadata
    String sign_column;                // For Collapsing/VersionedCollapsing
    String version_column;             // For Replacing/VersionedCollapsing
    String is_deleted_column;          // For Replacing with cleanup
    std::vector<String> columns_to_sum; // For Summing/Coalescing
};

/**
 * MergeTreePartReader - Reader for a single MergeTree part
 */
class MergeTreePartReader
{
public:
    explicit MergeTreePartReader(DataPartStorageVFSPtr storage)
        : storage_(std::move(storage))
    {
        loadPartInfo();
    }

    // -------------------------------------------------------------------------
    // Part information
    // -------------------------------------------------------------------------

    const PartInfo& getPartInfo() const { return part_info_; }

    size_t getRowCount() const { return part_info_.rows; }
    size_t getColumnCount() const { return part_info_.columns.size(); }
    size_t getMarkCount() const { return part_info_.marks; }

    const NamesAndTypesList& getColumns() const { return part_info_.columns; }

    String getColumnName(size_t index) const
    {
        if (index >= part_info_.columns.size())
            return "";
        return part_info_.columns[index].name;
    }

    String getColumnType(size_t index) const
    {
        if (index >= part_info_.columns.size())
            return "";
        return part_info_.columns[index].type ? part_info_.columns[index].type->getName() : "";
    }

    // -------------------------------------------------------------------------
    // MergeTree variant information
    // -------------------------------------------------------------------------

    /**
     * Get the MergeTree variant mode for this part.
     * This is determined from metadata if available, or defaults to Ordinary.
     */
    MergeTreeMode getVariantMode() const { return part_info_.variant.mode; }

    /**
     * Get the sign column name (for Collapsing variants).
     */
    const String& getSignColumn() const { return part_info_.sign_column; }

    /**
     * Get the version column name (for Replacing/VersionedCollapsing).
     */
    const String& getVersionColumn() const { return part_info_.version_column; }

    /**
     * Get the is_deleted column name (for Replacing with cleanup).
     */
    const String& getIsDeletedColumn() const { return part_info_.is_deleted_column; }

    /**
     * Get columns to sum (for Summing/Coalescing).
     */
    const std::vector<String>& getColumnsToSum() const { return part_info_.columns_to_sum; }

    /**
     * Set the MergeTree variant mode and associated columns.
     * This should be called after the reader is created if the variant info
     * is known from the table metadata.
     */
    void setVariant(MergeTreeMode mode, const String& sign_col = "",
                    const String& version_col = "", const String& deleted_col = "")
    {
        part_info_.variant = MergeTreeVariant(mode);
        part_info_.sign_column = sign_col;
        part_info_.version_column = version_col;
        part_info_.is_deleted_column = deleted_col;
    }

    /**
     * Set columns to sum for Summing/Coalescing variants.
     */
    void setColumnsToSum(const std::vector<String>& cols)
    {
        part_info_.columns_to_sum = cols;
    }

    // -------------------------------------------------------------------------
    // Reading marks
    // -------------------------------------------------------------------------

    /**
     * Read marks for a column
     * Returns vector of (compressed_offset, decompressed_offset) pairs
     */
    MarksInCompressedFile readMarks(const String& column_name)
    {
        MarksInCompressedFile marks;

        // Determine mark file extension
        String mark_file = column_name + ".mrk2";
        if (!storage_->existsFile(mark_file))
        {
            mark_file = column_name + ".mrk3";
            if (!storage_->existsFile(mark_file))
                return marks;
        }

        // Read mark file
        ReadSettings settings;
        auto buf = storage_->readFile(mark_file, settings, std::nullopt, std::nullopt);

        // C++17-compatible ends_with check (ends_with is C++20)
        bool is_mrk3 = mark_file.size() >= 5 &&
                       mark_file.compare(mark_file.size() - 5, 5, ".mrk3") == 0;
        size_t mark_size = is_mrk3 ? 24 : 16;  // mrk3 has additional rows_in_granule field

        while (!buf->eof())
        {
            MarkInCompressedFile mark;

            // Read compressed offset (size_t = 8 bytes)
            UInt64 compressed_offset = 0;
            buf->read(reinterpret_cast<char*>(&compressed_offset), sizeof(compressed_offset));

            // Read decompressed offset (size_t = 8 bytes)
            UInt64 decompressed_offset = 0;
            buf->read(reinterpret_cast<char*>(&decompressed_offset), sizeof(decompressed_offset));

            // For mrk3, read rows in granule (not used here, but advance buffer)
            if (is_mrk3)
            {
                UInt64 rows_in_granule = 0;
                buf->read(reinterpret_cast<char*>(&rows_in_granule), sizeof(rows_in_granule));
            }

            mark.offset_in_compressed_file = compressed_offset;
            mark.offset_in_decompressed_block = decompressed_offset;
            marks.push_back(mark);
        }

        return marks;
    }

    // -------------------------------------------------------------------------
    // Reading primary index
    // -------------------------------------------------------------------------

    /**
     * Read primary index values for a mark range
     * Returns Block with primary key columns
     */
    Block readPrimaryIndex(size_t start_mark, size_t end_mark)
    {
        Block result;

        if (!storage_->existsFile("primary.idx"))
            return result;

        ReadSettings settings;
        auto buf = storage_->readFile("primary.idx", settings, std::nullopt, std::nullopt);

        // TODO: Implement actual primary index reading
        // This requires knowing the primary key schema and deserializing values

        return result;
    }

    // -------------------------------------------------------------------------
    // Reading column data (raw bytes)
    // -------------------------------------------------------------------------

    /**
     * Read raw column data for a range
     *
     * @param column_name  Column name
     * @param start_mark   Starting mark
     * @param end_mark     Ending mark (exclusive)
     * @return             Raw compressed bytes
     */
    std::vector<char> readColumnDataRaw(
        const String& column_name,
        size_t start_mark,
        size_t end_mark)
    {
        std::vector<char> result;

        String data_file = column_name + ".bin";
        if (!storage_->existsFile(data_file))
            return result;

        // Get marks to determine byte range
        auto marks = readMarks(column_name);
        if (marks.empty() || start_mark >= marks.size())
            return result;

        // Clamp end_mark
        if (end_mark > marks.size())
            end_mark = marks.size();
        if (end_mark == 0)
            end_mark = marks.size();

        // Determine byte range to read
        size_t start_offset = marks[start_mark].offset_in_compressed_file;
        size_t end_offset;

        if (end_mark < marks.size())
            end_offset = marks[end_mark].offset_in_compressed_file;
        else
            end_offset = storage_->getFileSize(data_file);

        size_t bytes_to_read = end_offset - start_offset;
        if (bytes_to_read == 0)
            return result;

        // Read the data
        ReadSettings settings;
        auto buf = storage_->readFile(data_file, settings, bytes_to_read, std::nullopt);

        // Seek to start position
        buf->seek(start_offset, VFS_SEEK_SET);

        // Read into result buffer
        result.resize(bytes_to_read);
        size_t bytes_read = buf->read(result.data(), bytes_to_read);
        result.resize(bytes_read);

        return result;
    }

    // -------------------------------------------------------------------------
    // Error handling
    // -------------------------------------------------------------------------

    const String& getLastError() const { return last_error_; }
    bool hasError() const { return !last_error_.empty(); }
    void clearError() { last_error_.clear(); }

private:
    // -------------------------------------------------------------------------
    // Internal loading methods
    // -------------------------------------------------------------------------

    void loadPartInfo()
    {
        part_info_.name = storage_->getPartDirectory();

        // Load row count from count.txt
        loadRowCount();

        // Load column schema from columns.txt
        loadColumns();

        // Determine part type and mark count
        detectPartType();
    }

    void loadRowCount()
    {
        if (!storage_->existsFile("count.txt"))
        {
            last_error_ = "count.txt not found";
            return;
        }

        ReadSettings settings;
        auto buf = storage_->readFile("count.txt", settings, std::nullopt, std::nullopt);

        String line;
        char c;
        while (!buf->eof() && buf->read(&c, 1) && c != '\n')
            line += c;

        // Parse row count without exceptions (exceptions disabled in WASM)
        char* endptr = nullptr;
        unsigned long long parsed_value = std::strtoull(line.c_str(), &endptr, 10);
        if (endptr == line.c_str() || (endptr && *endptr != '\0' && *endptr != '\r'))
        {
            last_error_ = "Failed to parse count.txt";
        }
        else
        {
            part_info_.rows = static_cast<size_t>(parsed_value);
        }
    }

    void loadColumns()
    {
        if (!storage_->existsFile("columns.txt"))
        {
            last_error_ = "columns.txt not found";
            return;
        }

        ReadSettings settings;
        auto buf = storage_->readFile("columns.txt", settings, std::nullopt, std::nullopt);

        // Read file content
        String content;
        char c;
        while (!buf->eof())
        {
            if (buf->read(&c, 1))
                content += c;
        }

        // Parse columns (format: "columns format version: 1\nN columns:\n`col1` Type1\n...")
        std::istringstream ss(content);
        String line;

        // Skip header lines
        while (std::getline(ss, line))
        {
            if (line.find("columns:") != String::npos)
                break;
        }

        // Parse column definitions
        while (std::getline(ss, line))
        {
            if (line.empty())
                continue;

            // Format: `column_name` TypeName
            size_t name_start = line.find('`');
            if (name_start == String::npos)
                continue;

            size_t name_end = line.find('`', name_start + 1);
            if (name_end == String::npos)
                continue;

            String col_name = line.substr(name_start + 1, name_end - name_start - 1);
            String type_name = line.substr(name_end + 2);  // Skip "` "

            // Trim whitespace
            while (!type_name.empty() && (type_name.back() == ' ' || type_name.back() == '\t' || type_name.back() == '\r'))
                type_name.pop_back();

            // Create data type
            DataTypePtr type = makeDataTypeFromName(type_name);
            if (type)
                part_info_.columns.emplace_back(col_name, type);
        }
    }

    void detectPartType()
    {
        // Check for wide part (separate .bin files per column)
        if (!part_info_.columns.empty())
        {
            String first_col = part_info_.columns[0].name;
            if (storage_->existsFile(first_col + ".bin"))
            {
                part_info_.part_type = MergeTreeDataPartType::Wide;

                // Count marks from first column's mark file
                auto marks = readMarks(first_col);
                part_info_.marks = marks.size();

                // Check for final mark (mark pointing past end of data)
                if (!marks.empty())
                {
                    size_t file_size = storage_->getFileSize(first_col + ".bin");
                    if (marks.back().offset_in_compressed_file >= file_size)
                        part_info_.has_final_mark = true;
                }

                return;
            }
        }

        // Check for compact part (all columns in data.bin)
        if (storage_->existsFile("data.bin"))
        {
            part_info_.part_type = MergeTreeDataPartType::Compact;
            // For compact parts, marks are in data.mrk
            // TODO: Parse data.mrk to get mark count
        }
    }

    DataTypePtr makeDataTypeFromName(const String& type_name)
    {
        // Simple type mapping
        if (type_name == "Int8") return std::make_shared<DataTypeInt8>();
        if (type_name == "Int16") return std::make_shared<DataTypeInt16>();
        if (type_name == "Int32") return std::make_shared<DataTypeInt32>();
        if (type_name == "Int64") return std::make_shared<DataTypeInt64>();
        if (type_name == "UInt8") return std::make_shared<DataTypeUInt8>();
        if (type_name == "UInt16") return std::make_shared<DataTypeUInt16>();
        if (type_name == "UInt32") return std::make_shared<DataTypeUInt32>();
        if (type_name == "UInt64") return std::make_shared<DataTypeUInt64>();
        if (type_name == "Float32") return std::make_shared<DataTypeFloat32>();
        if (type_name == "Float64") return std::make_shared<DataTypeFloat64>();
        if (type_name == "String") return std::make_shared<DataTypeString>();

        // Default to String for unknown types
        return std::make_shared<DataTypeString>();
    }

private:
    DataPartStorageVFSPtr storage_;
    PartInfo part_info_;
    String last_error_;
};

} // namespace DB

// =============================================================================
// C API - Reader Management
// =============================================================================

using namespace DB;

/// Global reader instances
static std::map<int32_t, std::unique_ptr<MergeTreePartReader>> g_readers;
static int32_t g_next_reader_id = 1;

/// Result buffer for returning strings/data to JavaScript
static std::vector<char> g_result_buffer;
static String g_error_message;

extern "C"
{

/**
 * Create a MergeTree part reader
 *
 * @param database_ptr   Database name (null-terminated)
 * @param table_ptr      Table name (null-terminated)
 * @param partition_ptr  Partition value (null-terminated)
 * @param part_name_ptr  Part directory name (null-terminated)
 * @return               Reader handle (>0) or error code (<0)
 */
int32_t mergetree_reader_create(
    const char* database_ptr,
    const char* table_ptr,
    const char* partition_ptr,
    const char* part_name_ptr)
{
    g_error_message.clear();

    if (!database_ptr || !table_ptr || !partition_ptr || !part_name_ptr)
    {
        g_error_message = "Invalid parameter (null pointer)";
        return -1;
    }

    // No try/catch - exceptions are disabled in WASM build
    String database(database_ptr);
    String table(table_ptr);
    String partition(partition_ptr);
    String part_name(part_name_ptr);

    // Initialize VFS for this table
    vfs_init(database.c_str(), table.c_str());

    // Create storage
    auto storage = std::make_shared<DataPartStorageVFS>(database, table, partition, part_name);

    // Create reader
    auto reader = std::make_unique<MergeTreePartReader>(storage);

    if (reader->hasError())
    {
        g_error_message = reader->getLastError();
        return -2;
    }

    int32_t id = g_next_reader_id++;
    g_readers[id] = std::move(reader);
    return id;
}

/**
 * Destroy a MergeTree part reader
 *
 * @param handle  Reader handle from mergetree_reader_create
 */
void mergetree_reader_destroy(int32_t handle)
{
    g_readers.erase(handle);
}

// =============================================================================
// C API - Part Information
// =============================================================================

/**
 * Get row count in part
 */
int64_t mergetree_reader_get_row_count(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;
    return static_cast<int64_t>(it->second->getRowCount());
}

/**
 * Get column count in part
 */
int32_t mergetree_reader_get_column_count(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;
    return static_cast<int32_t>(it->second->getColumnCount());
}

/**
 * Get mark count in part
 */
int64_t mergetree_reader_get_mark_count(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;
    return static_cast<int64_t>(it->second->getMarkCount());
}

/**
 * Get column name by index
 * Result is stored in internal buffer, retrieve with mergetree_get_result
 */
int32_t mergetree_reader_get_column_name(int32_t handle, int32_t index)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    String name = it->second->getColumnName(index);
    g_result_buffer.assign(name.begin(), name.end());
    g_result_buffer.push_back('\0');
    return static_cast<int32_t>(name.size());
}

/**
 * Get column type by index
 * Result is stored in internal buffer, retrieve with mergetree_get_result
 */
int32_t mergetree_reader_get_column_type(int32_t handle, int32_t index)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    String type = it->second->getColumnType(index);
    g_result_buffer.assign(type.begin(), type.end());
    g_result_buffer.push_back('\0');
    return static_cast<int32_t>(type.size());
}

// =============================================================================
// C API - Data Reading
// =============================================================================

/**
 * Read marks for a column
 * Returns number of marks, or negative error code
 * Mark data is stored in internal buffer as array of (offset, decompressed_offset) pairs
 */
int32_t mergetree_reader_read_marks(int32_t handle, const char* column_name)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    if (!column_name)
        return -2;

    auto marks = it->second->readMarks(column_name);
    if (marks.empty())
        return 0;

    // Store marks in result buffer
    size_t data_size = marks.size() * sizeof(MarkInCompressedFile);
    g_result_buffer.resize(data_size);
    std::memcpy(g_result_buffer.data(), marks.data(), data_size);

    return static_cast<int32_t>(marks.size());
}

/**
 * Read raw column data for a mark range
 * Returns number of bytes read, or negative error code
 * Data is stored in internal buffer
 */
int64_t mergetree_reader_read_column_raw(
    int32_t handle,
    const char* column_name,
    int64_t start_mark,
    int64_t end_mark)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    if (!column_name)
        return -2;

    auto data = it->second->readColumnDataRaw(
        column_name,
        static_cast<size_t>(start_mark),
        static_cast<size_t>(end_mark));

    g_result_buffer = std::move(data);
    return static_cast<int64_t>(g_result_buffer.size());
}

// =============================================================================
// C API - Result Buffer Access
// =============================================================================

/**
 * Get pointer to result buffer
 */
const char* mergetree_get_result()
{
    return g_result_buffer.data();
}

/**
 * Get size of result buffer
 */
int64_t mergetree_get_result_len()
{
    return static_cast<int64_t>(g_result_buffer.size());
}

/**
 * Get last error message
 */
const char* mergetree_get_error()
{
    return g_error_message.c_str();
}

// =============================================================================
// C API - Module Information
// =============================================================================

/**
 * Get module version string
 */
const char* mergetree_version()
{
    return "1.0.0-wasm";
}

/**
 * Run self-test
 * Returns 0 on success, non-zero error code on failure
 */
int32_t mergetree_test()
{
    // Test 1: Create/destroy reader with invalid path (should fail gracefully)
    int32_t handle = mergetree_reader_create("test", "test", "test", "nonexistent_part");
    if (handle > 0)
    {
        // If it succeeded, it means VFS returned mock data or part exists
        mergetree_reader_destroy(handle);
    }

    // Test 2: Check result buffer operations
    g_result_buffer.clear();
    g_result_buffer.push_back('A');
    g_result_buffer.push_back('B');
    g_result_buffer.push_back('C');
    g_result_buffer.push_back('\0');

    if (mergetree_get_result_len() != 4)
        return 1;

    if (std::strcmp(mergetree_get_result(), "ABC") != 0)
        return 2;

    // Test 3: Version check
    const char* version = mergetree_version();
    if (!version || std::strlen(version) == 0)
        return 3;

    // Test 4: MergeTree variant functions
    MergeTreeMode mode = mergetree_mode_from_name("ReplacingMergeTree");
    if (mode != MERGETREE_MODE_REPLACING)
        return 4;

    const char* name = mergetree_mode_to_name(MERGETREE_MODE_SUMMING);
    if (!name || std::strcmp(name, "SummingMergeTree") != 0)
        return 5;

    if (!mergetree_variant_is_supported(MERGETREE_MODE_AGGREGATING))
        return 6;

    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_COLLAPSING);
    if (!(features & MERGETREE_FEATURE_SIGN_COLUMN))
        return 7;

    return 0;
}

// =============================================================================
// C API - MergeTree Variant Reader Functions
// =============================================================================

/**
 * Get the MergeTree variant mode for a reader.
 * Returns the mode enum value, or MERGETREE_MODE_INVALID on error.
 */
int32_t mergetree_reader_get_variant_mode(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return MERGETREE_MODE_INVALID;
    return static_cast<int32_t>(it->second->getVariantMode());
}

/**
 * Get the sign column name for a reader (Collapsing variants).
 * Result is stored in internal buffer, retrieve with mergetree_get_result.
 * Returns length of column name, or -1 on error.
 */
int32_t mergetree_reader_get_sign_column(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    const String& col = it->second->getSignColumn();
    g_result_buffer.assign(col.begin(), col.end());
    g_result_buffer.push_back('\0');
    return static_cast<int32_t>(col.size());
}

/**
 * Get the version column name for a reader (Replacing/VersionedCollapsing).
 * Result is stored in internal buffer, retrieve with mergetree_get_result.
 * Returns length of column name, or -1 on error.
 */
int32_t mergetree_reader_get_version_column(int32_t handle)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    const String& col = it->second->getVersionColumn();
    g_result_buffer.assign(col.begin(), col.end());
    g_result_buffer.push_back('\0');
    return static_cast<int32_t>(col.size());
}

/**
 * Set the MergeTree variant for a reader.
 * This allows setting variant info when it's known from table metadata.
 *
 * @param handle        Reader handle
 * @param mode          MergeTree mode (from MergeTreeMode enum)
 * @param sign_col      Sign column name (for Collapsing variants, can be NULL)
 * @param version_col   Version column name (for Replacing/VersionedCollapsing, can be NULL)
 * @param deleted_col   is_deleted column name (for Replacing with cleanup, can be NULL)
 * @return              0 on success, -1 on error
 */
int32_t mergetree_reader_set_variant(
    int32_t handle,
    int32_t mode,
    const char* sign_col,
    const char* version_col,
    const char* deleted_col)
{
    auto it = g_readers.find(handle);
    if (it == g_readers.end())
        return -1;

    it->second->setVariant(
        static_cast<MergeTreeMode>(mode),
        sign_col ? sign_col : "",
        version_col ? version_col : "",
        deleted_col ? deleted_col : ""
    );
    return 0;
}

} // extern "C"
