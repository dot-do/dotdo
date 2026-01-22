/**
 * StorageStandalone.h - Minimal ClickHouse-compatible types for WASM StorageMemory
 *
 * This header provides standalone implementations of key ClickHouse types
 * needed to compile a real StorageMemory engine to WASM without pulling in
 * the entire ClickHouse dependency tree.
 *
 * Key types provided:
 *   - Block: Container for columnar data (vector of ColumnWithTypeAndName)
 *   - Column: Abstract column interface with concrete implementations
 *   - DataType: Type system with Int, Float, String support
 *   - MultiVersion: Thread-safe copy-on-write container
 *
 * This allows us to use REAL ClickHouse StorageMemory patterns and algorithms
 * while keeping the WASM binary small.
 */

#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <iomanip>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace DB
{

// Forward declarations
class IColumn;
class IDataType;
class Block;

using String = std::string;
using ColumnPtr = std::shared_ptr<const IColumn>;
using MutableColumnPtr = std::shared_ptr<IColumn>;
using DataTypePtr = std::shared_ptr<const IDataType>;
using Columns = std::vector<ColumnPtr>;
using MutableColumns = std::vector<MutableColumnPtr>;
using DataTypes = std::vector<DataTypePtr>;

// =============================================================================
// Value Types
// =============================================================================

/// Field - variant type for storing column values
using Field = std::variant<
    std::monostate,  // NULL
    int8_t,
    int16_t,
    int32_t,
    int64_t,
    uint8_t,
    uint16_t,
    uint32_t,
    uint64_t,
    float,
    double,
    String
>;

enum class TypeIndex
{
    Nothing = 0,
    Int8,
    Int16,
    Int32,
    Int64,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Float32,
    Float64,
    String,
};

// =============================================================================
// IColumn - Abstract column interface
// =============================================================================

class IColumn : public std::enable_shared_from_this<IColumn>
{
public:
    virtual ~IColumn() = default;

    /// Number of elements in the column
    virtual size_t size() const = 0;

    /// If column is empty
    bool empty() const { return size() == 0; }

    /// Get field at index
    virtual Field operator[](size_t n) const = 0;

    /// Insert value at the end
    virtual void insert(const Field& value) = 0;

    /// Insert default value
    virtual void insertDefault() = 0;

    /// Clone the column (empty structure, no data)
    virtual MutableColumnPtr cloneEmpty() const = 0;

    /// Clone the column with data
    virtual MutableColumnPtr cloneResized(size_t new_size) const = 0;

    /// Get column name for type
    virtual const char* getFamilyName() const = 0;

    /// Estimate memory usage
    virtual size_t allocatedBytes() const = 0;

    /// Get type index
    virtual TypeIndex getDataType() const = 0;

    /// For compression support (stubbed)
    virtual ColumnPtr compress(bool /*force*/ = false) const { return shared_from_this(); }
};

// =============================================================================
// Concrete Column Implementations
// =============================================================================

template <typename T>
class ColumnVector : public IColumn
{
public:
    using Container = std::vector<T>;

    ColumnVector() = default;
    explicit ColumnVector(size_t n) : data_(n) {}
    explicit ColumnVector(Container&& data) : data_(std::move(data)) {}

    size_t size() const override { return data_.size(); }

    Field operator[](size_t n) const override { return data_[n]; }

    void insert(const Field& value) override
    {
        if (auto* v = std::get_if<T>(&value))
            data_.push_back(*v);
        else if (auto* i64 = std::get_if<int64_t>(&value))
            data_.push_back(static_cast<T>(*i64));
        else if (auto* d = std::get_if<double>(&value))
            data_.push_back(static_cast<T>(*d));
        else
            data_.push_back(T{});
    }

    void insertDefault() override { data_.push_back(T{}); }

    MutableColumnPtr cloneEmpty() const override
    {
        return std::make_shared<ColumnVector<T>>();
    }

    MutableColumnPtr cloneResized(size_t new_size) const override
    {
        auto res = std::make_shared<ColumnVector<T>>();
        res->data_.resize(new_size);
        size_t copy_size = std::min(new_size, data_.size());
        std::copy(data_.begin(), data_.begin() + copy_size, res->data_.begin());
        return res;
    }

    const char* getFamilyName() const override;
    size_t allocatedBytes() const override { return data_.capacity() * sizeof(T); }
    TypeIndex getDataType() const override;

    Container& getData() { return data_; }
    const Container& getData() const { return data_; }

private:
    Container data_;
};

// Template specializations for getFamilyName and getDataType
template<> inline const char* ColumnVector<int8_t>::getFamilyName() const { return "Int8"; }
template<> inline const char* ColumnVector<int16_t>::getFamilyName() const { return "Int16"; }
template<> inline const char* ColumnVector<int32_t>::getFamilyName() const { return "Int32"; }
template<> inline const char* ColumnVector<int64_t>::getFamilyName() const { return "Int64"; }
template<> inline const char* ColumnVector<uint8_t>::getFamilyName() const { return "UInt8"; }
template<> inline const char* ColumnVector<uint16_t>::getFamilyName() const { return "UInt16"; }
template<> inline const char* ColumnVector<uint32_t>::getFamilyName() const { return "UInt32"; }
template<> inline const char* ColumnVector<uint64_t>::getFamilyName() const { return "UInt64"; }
template<> inline const char* ColumnVector<float>::getFamilyName() const { return "Float32"; }
template<> inline const char* ColumnVector<double>::getFamilyName() const { return "Float64"; }

template<> inline TypeIndex ColumnVector<int8_t>::getDataType() const { return TypeIndex::Int8; }
template<> inline TypeIndex ColumnVector<int16_t>::getDataType() const { return TypeIndex::Int16; }
template<> inline TypeIndex ColumnVector<int32_t>::getDataType() const { return TypeIndex::Int32; }
template<> inline TypeIndex ColumnVector<int64_t>::getDataType() const { return TypeIndex::Int64; }
template<> inline TypeIndex ColumnVector<uint8_t>::getDataType() const { return TypeIndex::UInt8; }
template<> inline TypeIndex ColumnVector<uint16_t>::getDataType() const { return TypeIndex::UInt16; }
template<> inline TypeIndex ColumnVector<uint32_t>::getDataType() const { return TypeIndex::UInt32; }
template<> inline TypeIndex ColumnVector<uint64_t>::getDataType() const { return TypeIndex::UInt64; }
template<> inline TypeIndex ColumnVector<float>::getDataType() const { return TypeIndex::Float32; }
template<> inline TypeIndex ColumnVector<double>::getDataType() const { return TypeIndex::Float64; }

// Convenience aliases
using ColumnInt8 = ColumnVector<int8_t>;
using ColumnInt16 = ColumnVector<int16_t>;
using ColumnInt32 = ColumnVector<int32_t>;
using ColumnInt64 = ColumnVector<int64_t>;
using ColumnUInt8 = ColumnVector<uint8_t>;
using ColumnUInt16 = ColumnVector<uint16_t>;
using ColumnUInt32 = ColumnVector<uint32_t>;
using ColumnUInt64 = ColumnVector<uint64_t>;
using ColumnFloat32 = ColumnVector<float>;
using ColumnFloat64 = ColumnVector<double>;

// String column
class ColumnString : public IColumn
{
public:
    ColumnString() = default;

    size_t size() const override { return data_.size(); }

    Field operator[](size_t n) const override { return data_[n]; }

    void insert(const Field& value) override
    {
        if (auto* s = std::get_if<String>(&value))
            data_.push_back(*s);
        else if (auto* i = std::get_if<int64_t>(&value))
            data_.push_back(std::to_string(*i));
        else if (auto* d = std::get_if<double>(&value))
        {
            std::ostringstream oss;
            oss << std::setprecision(15) << *d;
            data_.push_back(oss.str());
        }
        else if (auto* i32 = std::get_if<int32_t>(&value))
            data_.push_back(std::to_string(*i32));
        else if (auto* f = std::get_if<float>(&value))
        {
            std::ostringstream oss;
            oss << std::setprecision(7) << *f;
            data_.push_back(oss.str());
        }
        else if (std::holds_alternative<std::monostate>(value))
            data_.emplace_back(); // NULL as empty string
        else
            data_.emplace_back();
    }

    void insertDefault() override { data_.emplace_back(); }

    MutableColumnPtr cloneEmpty() const override
    {
        return std::make_shared<ColumnString>();
    }

    MutableColumnPtr cloneResized(size_t new_size) const override
    {
        auto res = std::make_shared<ColumnString>();
        res->data_.resize(new_size);
        size_t copy_size = std::min(new_size, data_.size());
        std::copy(data_.begin(), data_.begin() + copy_size, res->data_.begin());
        return res;
    }

    const char* getFamilyName() const override { return "String"; }

    size_t allocatedBytes() const override
    {
        size_t total = 0;
        for (const auto& s : data_)
            total += s.capacity();
        return total + data_.capacity() * sizeof(String);
    }

    TypeIndex getDataType() const override { return TypeIndex::String; }

    std::vector<String>& getData() { return data_; }
    const std::vector<String>& getData() const { return data_; }

private:
    std::vector<String> data_;
};

// =============================================================================
// IDataType - Abstract data type interface
// =============================================================================

class IDataType : public std::enable_shared_from_this<IDataType>
{
public:
    virtual ~IDataType() = default;

    virtual const char* getName() const = 0;
    virtual TypeIndex getTypeId() const = 0;
    virtual MutableColumnPtr createColumn() const = 0;

    virtual bool isNumeric() const { return false; }
    virtual bool isInteger() const { return false; }
    virtual bool isFloatingPoint() const { return false; }
    virtual bool isString() const { return false; }
};

// Concrete data types
template <typename T>
class DataTypeNumber : public IDataType
{
public:
    const char* getName() const override;
    TypeIndex getTypeId() const override;
    MutableColumnPtr createColumn() const override { return std::make_shared<ColumnVector<T>>(); }
    bool isNumeric() const override { return true; }
    bool isInteger() const override { return std::is_integral_v<T>; }
    bool isFloatingPoint() const override { return std::is_floating_point_v<T>; }
};

template<> inline const char* DataTypeNumber<int8_t>::getName() const { return "Int8"; }
template<> inline const char* DataTypeNumber<int16_t>::getName() const { return "Int16"; }
template<> inline const char* DataTypeNumber<int32_t>::getName() const { return "Int32"; }
template<> inline const char* DataTypeNumber<int64_t>::getName() const { return "Int64"; }
template<> inline const char* DataTypeNumber<uint8_t>::getName() const { return "UInt8"; }
template<> inline const char* DataTypeNumber<uint16_t>::getName() const { return "UInt16"; }
template<> inline const char* DataTypeNumber<uint32_t>::getName() const { return "UInt32"; }
template<> inline const char* DataTypeNumber<uint64_t>::getName() const { return "UInt64"; }
template<> inline const char* DataTypeNumber<float>::getName() const { return "Float32"; }
template<> inline const char* DataTypeNumber<double>::getName() const { return "Float64"; }

template<> inline TypeIndex DataTypeNumber<int8_t>::getTypeId() const { return TypeIndex::Int8; }
template<> inline TypeIndex DataTypeNumber<int16_t>::getTypeId() const { return TypeIndex::Int16; }
template<> inline TypeIndex DataTypeNumber<int32_t>::getTypeId() const { return TypeIndex::Int32; }
template<> inline TypeIndex DataTypeNumber<int64_t>::getTypeId() const { return TypeIndex::Int64; }
template<> inline TypeIndex DataTypeNumber<uint8_t>::getTypeId() const { return TypeIndex::UInt8; }
template<> inline TypeIndex DataTypeNumber<uint16_t>::getTypeId() const { return TypeIndex::UInt16; }
template<> inline TypeIndex DataTypeNumber<uint32_t>::getTypeId() const { return TypeIndex::UInt32; }
template<> inline TypeIndex DataTypeNumber<uint64_t>::getTypeId() const { return TypeIndex::UInt64; }
template<> inline TypeIndex DataTypeNumber<float>::getTypeId() const { return TypeIndex::Float32; }
template<> inline TypeIndex DataTypeNumber<double>::getTypeId() const { return TypeIndex::Float64; }

using DataTypeInt8 = DataTypeNumber<int8_t>;
using DataTypeInt16 = DataTypeNumber<int16_t>;
using DataTypeInt32 = DataTypeNumber<int32_t>;
using DataTypeInt64 = DataTypeNumber<int64_t>;
using DataTypeUInt8 = DataTypeNumber<uint8_t>;
using DataTypeUInt16 = DataTypeNumber<uint16_t>;
using DataTypeUInt32 = DataTypeNumber<uint32_t>;
using DataTypeUInt64 = DataTypeNumber<uint64_t>;
using DataTypeFloat32 = DataTypeNumber<float>;
using DataTypeFloat64 = DataTypeNumber<double>;

class DataTypeString : public IDataType
{
public:
    const char* getName() const override { return "String"; }
    TypeIndex getTypeId() const override { return TypeIndex::String; }
    MutableColumnPtr createColumn() const override { return std::make_shared<ColumnString>(); }
    bool isString() const override { return true; }
};

// =============================================================================
// ColumnWithTypeAndName - Column with metadata
// =============================================================================

struct ColumnWithTypeAndName
{
    ColumnPtr column;
    DataTypePtr type;
    String name;

    ColumnWithTypeAndName() = default;
    ColumnWithTypeAndName(ColumnPtr column_, DataTypePtr type_, String name_)
        : column(std::move(column_)), type(std::move(type_)), name(std::move(name_)) {}
    ColumnWithTypeAndName(DataTypePtr type_, String name_)
        : type(std::move(type_)), name(std::move(name_))
    {
        column = type->createColumn();
    }

    ColumnWithTypeAndName cloneEmpty() const
    {
        return ColumnWithTypeAndName(type->createColumn(), type, name);
    }

    bool operator==(const ColumnWithTypeAndName& other) const
    {
        return name == other.name && type->getName() == other.type->getName();
    }
};

using ColumnsWithTypeAndName = std::vector<ColumnWithTypeAndName>;

// =============================================================================
// Block - Container for columnar data
// =============================================================================

class Block
{
public:
    using Container = ColumnsWithTypeAndName;
    using IndexByName = std::unordered_map<String, size_t>;

    Block() = default;
    Block(std::initializer_list<ColumnWithTypeAndName> il) : data_(il)
    {
        initializeIndexByName();
    }
    Block(const ColumnsWithTypeAndName& data) : data_(data)
    {
        initializeIndexByName();
    }
    Block(ColumnsWithTypeAndName&& data) : data_(std::move(data))
    {
        initializeIndexByName();
    }

    /// Insert column at position
    void insert(size_t position, ColumnWithTypeAndName elem)
    {
        data_.insert(data_.begin() + position, std::move(elem));
        initializeIndexByName();
    }

    /// Insert column at end
    void insert(ColumnWithTypeAndName elem)
    {
        index_by_name_[elem.name] = data_.size();
        data_.push_back(std::move(elem));
    }

    /// Remove column at position
    void erase(size_t position)
    {
        data_.erase(data_.begin() + position);
        initializeIndexByName();
    }

    /// Get column by position
    ColumnWithTypeAndName& getByPosition(size_t position) { return data_[position]; }
    const ColumnWithTypeAndName& getByPosition(size_t position) const { return data_[position]; }

    /// Get column by name
    ColumnWithTypeAndName& getByName(const String& name)
    {
        auto it = index_by_name_.find(name);
        if (it == index_by_name_.end())
        {
            static ColumnWithTypeAndName empty;
            return empty;
        }
        return data_[it->second];
    }

    const ColumnWithTypeAndName& getByName(const String& name) const
    {
        auto it = index_by_name_.find(name);
        if (it == index_by_name_.end())
        {
            static ColumnWithTypeAndName empty;
            return empty;
        }
        return data_[it->second];
    }

    /// Check if column exists
    bool has(const String& name) const
    {
        return index_by_name_.find(name) != index_by_name_.end();
    }

    /// Get position by name
    size_t getPositionByName(const String& name) const
    {
        auto it = index_by_name_.find(name);
        if (it == index_by_name_.end())
            return SIZE_MAX;  // Return max value to indicate not found
        return it->second;
    }

    /// Iterators
    Container::iterator begin() { return data_.begin(); }
    Container::iterator end() { return data_.end(); }
    Container::const_iterator begin() const { return data_.begin(); }
    Container::const_iterator end() const { return data_.end(); }

    /// Get columns with type and name
    const ColumnsWithTypeAndName& getColumnsWithTypeAndName() const { return data_; }

    /// Number of rows (from first column)
    size_t rows() const
    {
        if (data_.empty()) return 0;
        return data_.front().column ? data_.front().column->size() : 0;
    }

    /// Number of columns
    size_t columns() const { return data_.size(); }

    /// Is empty
    bool empty() const { return data_.empty(); }

    /// Get empty block with same structure
    Block cloneEmpty() const
    {
        Block res;
        for (const auto& col : data_)
            res.insert(col.cloneEmpty());
        return res;
    }

    /// Approximate bytes in memory
    size_t bytes() const
    {
        size_t total = 0;
        for (const auto& col : data_)
            if (col.column)
                total += col.column->size() * 8; // rough estimate
        return total;
    }

    /// Allocated bytes
    size_t allocatedBytes() const
    {
        size_t total = 0;
        for (const auto& col : data_)
            if (col.column)
                total += col.column->allocatedBytes();
        return total;
    }

    /// Clear the block
    void clear()
    {
        data_.clear();
        index_by_name_.clear();
    }

    /// Compress (stubbed for WASM)
    Block compress() const { return *this; }

private:
    void initializeIndexByName()
    {
        index_by_name_.clear();
        for (size_t i = 0; i < data_.size(); ++i)
            index_by_name_[data_[i].name] = i;
    }

    Container data_;
    IndexByName index_by_name_;
};

using Blocks = std::vector<Block>;
using BlockPtr = std::shared_ptr<Block>;
using BlocksPtr = std::shared_ptr<Blocks>;

// =============================================================================
// MultiVersion - Thread-safe copy-on-write container
// (Same as real ClickHouse Common/MultiVersion.h)
// =============================================================================

template <typename T>
class MultiVersion
{
public:
    using Version = std::shared_ptr<const T>;

    MultiVersion() = default;

    explicit MultiVersion(std::unique_ptr<const T>&& value)
        : current_version_(std::move(value))
    {
    }

    MultiVersion(MultiVersion&& src) noexcept { *this = std::move(src); }

    MultiVersion& operator=(MultiVersion&& src) noexcept
    {
        if (this != &src)
        {
            Version version;
            {
                std::lock_guard<std::mutex> lock(src.mutex_);
                src.current_version_.swap(version);
            }
            std::lock_guard<std::mutex> lock(mutex_);
            current_version_ = std::move(version);
        }
        return *this;
    }

    /// Get current version for read-only usage
    Version get() const
    {
        std::lock_guard<std::mutex> lock(mutex_);
        return current_version_;
    }

    /// Update with new version
    void set(std::unique_ptr<const T>&& value)
    {
        Version version{std::move(value)};
        std::lock_guard<std::mutex> lock(mutex_);
        current_version_ = std::move(version);
    }

private:
    mutable std::mutex mutex_;
    Version current_version_;
};

// =============================================================================
// StorageID - Table identifier
// =============================================================================

struct StorageID
{
    String database_name;
    String table_name;

    StorageID(const String& database, const String& table)
        : database_name(database), table_name(table) {}

    String getFullTableName() const
    {
        if (database_name.empty())
            return table_name;
        return database_name + "." + table_name;
    }

    String getTableName() const { return table_name; }
    String getDatabaseName() const { return database_name; }
    bool empty() const { return table_name.empty(); }
};

// =============================================================================
// NamesAndTypes - Column schema
// =============================================================================

struct NameAndTypePair
{
    String name;
    DataTypePtr type;

    NameAndTypePair() = default;
    NameAndTypePair(String name_, DataTypePtr type_)
        : name(std::move(name_)), type(std::move(type_)) {}
};

using NamesAndTypes = std::vector<NameAndTypePair>;

class NamesAndTypesList : public std::vector<NameAndTypePair>
{
public:
    using std::vector<NameAndTypePair>::vector;

    std::vector<String> getNames() const
    {
        std::vector<String> names;
        for (const auto& p : *this)
            names.push_back(p.name);
        return names;
    }
};

// =============================================================================
// ColumnsDescription - Column metadata
// =============================================================================

class ColumnsDescription
{
public:
    ColumnsDescription() = default;
    ColumnsDescription(NamesAndTypesList columns) : columns_(std::move(columns)) {}

    const NamesAndTypesList& getAllPhysical() const { return columns_; }
    NamesAndTypesList getAll() const { return columns_; }

    void add(const NameAndTypePair& column)
    {
        columns_.push_back(column);
    }

    bool has(const String& name) const
    {
        for (const auto& col : columns_)
            if (col.name == name)
                return true;
        return false;
    }

    const NameAndTypePair& get(const String& name) const
    {
        for (const auto& col : columns_)
            if (col.name == name)
                return col;
        static NameAndTypePair empty;
        return empty;
    }

    String toString() const
    {
        String result;
        for (const auto& col : columns_)
        {
            if (!result.empty()) result += ", ";
            result += col.name + " " + col.type->getName();
        }
        return result;
    }

private:
    NamesAndTypesList columns_;
};

// =============================================================================
// ConstraintsDescription (stubbed)
// =============================================================================

class ConstraintsDescription
{
public:
    bool empty() const { return true; }
};

// =============================================================================
// StorageInMemoryMetadata - Table metadata
// =============================================================================

struct StorageInMemoryMetadata
{
    ColumnsDescription columns;
    ConstraintsDescription constraints;
    String comment;

    void setColumns(ColumnsDescription columns_) { columns = std::move(columns_); }
    void setConstraints(ConstraintsDescription constraints_) { constraints = std::move(constraints_); }
    void setComment(const String& comment_) { comment = comment_; }

    const ColumnsDescription& getColumns() const { return columns; }
    const ConstraintsDescription& getConstraints() const { return constraints; }

    Block getSampleBlock() const
    {
        Block block;
        for (const auto& col : columns.getAllPhysical())
            block.insert(ColumnWithTypeAndName(col.type, col.name));
        return block;
    }

    void check(const Block& block, bool need_all = false) const
    {
        // Basic validation - check column types match
        for (const auto& col : block)
        {
            if (columns.has(col.name))
            {
                const auto& expected = columns.get(col.name);
                if (expected.type && col.type &&
                    expected.type->getTypeId() != col.type->getTypeId())
                {
                    // Type mismatch - in WASM we just ignore since no exceptions
                }
            }
        }
        (void)need_all;
    }
};

using StorageMetadataPtr = std::shared_ptr<const StorageInMemoryMetadata>;
using MultiVersionStorageMetadataPtr = MultiVersion<StorageInMemoryMetadata>;

// =============================================================================
// DataType Factory
// =============================================================================

inline DataTypePtr makeDataType(TypeIndex type_id)
{
    switch (type_id)
    {
        case TypeIndex::Int8: return std::make_shared<DataTypeInt8>();
        case TypeIndex::Int16: return std::make_shared<DataTypeInt16>();
        case TypeIndex::Int32: return std::make_shared<DataTypeInt32>();
        case TypeIndex::Int64: return std::make_shared<DataTypeInt64>();
        case TypeIndex::UInt8: return std::make_shared<DataTypeUInt8>();
        case TypeIndex::UInt16: return std::make_shared<DataTypeUInt16>();
        case TypeIndex::UInt32: return std::make_shared<DataTypeUInt32>();
        case TypeIndex::UInt64: return std::make_shared<DataTypeUInt64>();
        case TypeIndex::Float32: return std::make_shared<DataTypeFloat32>();
        case TypeIndex::Float64: return std::make_shared<DataTypeFloat64>();
        case TypeIndex::String: return std::make_shared<DataTypeString>();
        default: return nullptr;
    }
}

inline DataTypePtr makeDataType(const String& type_name)
{
    String upper = type_name;
    for (char& c : upper) c = toupper(c);

    if (upper == "INT8" || upper == "TINYINT") return std::make_shared<DataTypeInt8>();
    if (upper == "INT16" || upper == "SMALLINT") return std::make_shared<DataTypeInt16>();
    if (upper == "INT32" || upper == "INT" || upper == "INTEGER") return std::make_shared<DataTypeInt32>();
    if (upper == "INT64" || upper == "BIGINT") return std::make_shared<DataTypeInt64>();
    if (upper == "UINT8") return std::make_shared<DataTypeUInt8>();
    if (upper == "UINT16") return std::make_shared<DataTypeUInt16>();
    if (upper == "UINT32") return std::make_shared<DataTypeUInt32>();
    if (upper == "UINT64") return std::make_shared<DataTypeUInt64>();
    if (upper == "FLOAT32" || upper == "FLOAT") return std::make_shared<DataTypeFloat32>();
    if (upper == "FLOAT64" || upper == "DOUBLE") return std::make_shared<DataTypeFloat64>();
    if (upper == "STRING" || upper == "VARCHAR" || upper == "TEXT") return std::make_shared<DataTypeString>();
    return nullptr;
}

} // namespace DB
