/**
 * parquet_reader.cpp - Minimal Parquet Reader for WASM
 *
 * A lightweight Parquet file reader designed for WebAssembly environments.
 * Implements the Apache Parquet format with support for:
 *   - Footer metadata parsing (Thrift Compact Protocol)
 *   - Schema parsing and column projection
 *   - Row group statistics for predicate pushdown
 *   - HTTP range request integration for streaming
 *   - Decompression: Uncompressed, Snappy
 *
 * File Format Overview:
 *   - Magic: 4 bytes "PAR1"
 *   - Row Groups: Column chunks with data pages
 *   - Footer: FileMetaData (Thrift compact encoded)
 *   - Footer Length: 4 bytes (little-endian i32)
 *   - Magic: 4 bytes "PAR1"
 *
 * Build with: emcc -std=c++17 -Os -fno-exceptions -fno-rtti
 *
 * Target size: ~150-200KB
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <variant>
#include <optional>
#include <functional>
#include <algorithm>
#include <unordered_map>
#include <sstream>
#include <iomanip>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// Parquet Format Constants
// ============================================================================

static const uint8_t PARQUET_MAGIC[4] = {'P', 'A', 'R', '1'};
static const uint8_t PARQUET_MAGIC_ENCRYPTED[4] = {'P', 'A', 'R', 'E'};

// Parquet physical types (from parquet.thrift)
enum class ParquetType : int32_t {
    BOOLEAN = 0,
    INT32 = 1,
    INT64 = 2,
    INT96 = 3,  // Deprecated, used for timestamps in some systems
    FLOAT = 4,
    DOUBLE = 5,
    BYTE_ARRAY = 6,
    FIXED_LEN_BYTE_ARRAY = 7
};

// Parquet encodings
enum class Encoding : int32_t {
    PLAIN = 0,
    PLAIN_DICTIONARY = 2,
    RLE = 3,
    BIT_PACKED = 4,
    DELTA_BINARY_PACKED = 5,
    DELTA_LENGTH_BYTE_ARRAY = 6,
    DELTA_BYTE_ARRAY = 7,
    RLE_DICTIONARY = 8,
    BYTE_STREAM_SPLIT = 9
};

// Compression codecs
enum class CompressionCodec : int32_t {
    UNCOMPRESSED = 0,
    SNAPPY = 1,
    GZIP = 2,
    LZO = 3,
    BROTLI = 4,
    LZ4 = 5,
    ZSTD = 6,
    LZ4_RAW = 7
};

// Page types
enum class PageType : int32_t {
    DATA_PAGE = 0,
    INDEX_PAGE = 1,
    DICTIONARY_PAGE = 2,
    DATA_PAGE_V2 = 3
};

// Converted types (logical types)
enum class ConvertedType : int32_t {
    NONE = -1,
    UTF8 = 0,
    MAP = 1,
    MAP_KEY_VALUE = 2,
    LIST = 3,
    ENUM = 4,
    DECIMAL = 5,
    DATE = 6,
    TIME_MILLIS = 7,
    TIME_MICROS = 8,
    TIMESTAMP_MILLIS = 9,
    TIMESTAMP_MICROS = 10,
    UINT_8 = 11,
    UINT_16 = 12,
    UINT_32 = 13,
    UINT_64 = 14,
    INT_8 = 15,
    INT_16 = 16,
    INT_32 = 17,
    INT_64 = 18,
    JSON = 19,
    BSON = 20,
    INTERVAL = 21
};

// ============================================================================
// Thrift Compact Protocol Parser
// ============================================================================

// Thrift compact protocol type IDs
enum ThriftType : uint8_t {
    THRIFT_STOP = 0,
    THRIFT_BOOL_TRUE = 1,
    THRIFT_BOOL_FALSE = 2,
    THRIFT_I8 = 3,
    THRIFT_I16 = 4,
    THRIFT_I32 = 5,
    THRIFT_I64 = 6,
    THRIFT_DOUBLE = 7,
    THRIFT_BINARY = 8,  // Also used for strings
    THRIFT_LIST = 9,
    THRIFT_SET = 10,
    THRIFT_MAP = 11,
    THRIFT_STRUCT = 12,
    THRIFT_UUID = 13
};

class ThriftReader {
public:
    ThriftReader(const uint8_t* data, size_t len)
        : data_(data), len_(len), pos_(0), lastFieldId_(0) {}

    bool hasMore() const { return pos_ < len_; }
    size_t position() const { return pos_; }
    size_t remaining() const { return len_ - pos_; }
    void setPosition(size_t pos) { pos_ = pos; lastFieldId_ = 0; }

    // Read a single byte
    uint8_t readByte() {
        if (pos_ >= len_) return 0;
        return data_[pos_++];
    }

    // Read raw bytes
    void readBytes(uint8_t* dest, size_t count) {
        size_t toRead = std::min(count, remaining());
        memcpy(dest, data_ + pos_, toRead);
        pos_ += toRead;
    }

    // Read varint (ULEB128)
    uint64_t readVarint() {
        uint64_t result = 0;
        int shift = 0;
        uint8_t byte;
        do {
            if (pos_ >= len_) break;
            byte = data_[pos_++];
            result |= static_cast<uint64_t>(byte & 0x7F) << shift;
            shift += 7;
        } while (byte & 0x80);
        return result;
    }

    // Zigzag decode
    static int32_t zigzagToInt(uint32_t n) {
        return static_cast<int32_t>((n >> 1) ^ -(n & 1));
    }

    static int64_t zigzagToLong(uint64_t n) {
        return static_cast<int64_t>((n >> 1) ^ -(n & 1));
    }

    // Read zigzag-encoded int32
    int32_t readZigZagInt() {
        return zigzagToInt(static_cast<uint32_t>(readVarint()));
    }

    // Read zigzag-encoded int64
    int64_t readZigZagLong() {
        return zigzagToLong(readVarint());
    }

    // Read i8 (single byte)
    int8_t readI8() {
        return static_cast<int8_t>(readByte());
    }

    // Read i16 (zigzag varint)
    int16_t readI16() {
        return static_cast<int16_t>(readZigZagInt());
    }

    // Read i32 (zigzag varint)
    int32_t readI32() {
        return readZigZagInt();
    }

    // Read i64 (zigzag varint)
    int64_t readI64() {
        return readZigZagLong();
    }

    // Read double (8 bytes, little-endian IEEE 754)
    double readDouble() {
        if (remaining() < 8) return 0.0;
        uint64_t bits = 0;
        for (int i = 0; i < 8; i++) {
            bits |= static_cast<uint64_t>(data_[pos_++]) << (i * 8);
        }
        double result;
        memcpy(&result, &bits, sizeof(double));
        return result;
    }

    // Read binary/string
    std::string readBinary() {
        uint64_t len = readVarint();
        if (len > remaining()) len = remaining();
        std::string result(reinterpret_cast<const char*>(data_ + pos_), len);
        pos_ += len;
        return result;
    }

    // Read field header, returns (field_id, type) or (0, THRIFT_STOP) for stop field
    std::pair<int16_t, ThriftType> readFieldHeader() {
        uint8_t header = readByte();
        if (header == 0) {
            return {0, THRIFT_STOP};
        }

        ThriftType type = static_cast<ThriftType>(header & 0x0F);
        int16_t delta = (header >> 4) & 0x0F;
        int16_t fieldId;

        if (delta == 0) {
            // Long form: field ID follows
            fieldId = readI16();
        } else {
            // Short form: delta from last field
            fieldId = lastFieldId_ + delta;
        }

        lastFieldId_ = fieldId;
        return {fieldId, type};
    }

    // Skip a field of given type
    void skipField(ThriftType type) {
        switch (type) {
            case THRIFT_STOP:
                break;
            case THRIFT_BOOL_TRUE:
            case THRIFT_BOOL_FALSE:
                break;
            case THRIFT_I8:
                pos_++;
                break;
            case THRIFT_I16:
            case THRIFT_I32:
            case THRIFT_I64:
                readVarint();
                break;
            case THRIFT_DOUBLE:
                pos_ += 8;
                break;
            case THRIFT_BINARY:
                pos_ += readVarint();
                break;
            case THRIFT_LIST:
            case THRIFT_SET: {
                uint8_t header = readByte();
                uint32_t size = (header >> 4) & 0x0F;
                ThriftType elemType = static_cast<ThriftType>(header & 0x0F);
                if (size == 15) {
                    size = static_cast<uint32_t>(readVarint());
                }
                for (uint32_t i = 0; i < size; i++) {
                    skipField(elemType);
                }
                break;
            }
            case THRIFT_MAP: {
                uint32_t size = static_cast<uint32_t>(readVarint());
                if (size > 0) {
                    uint8_t types = readByte();
                    ThriftType keyType = static_cast<ThriftType>((types >> 4) & 0x0F);
                    ThriftType valType = static_cast<ThriftType>(types & 0x0F);
                    for (uint32_t i = 0; i < size; i++) {
                        skipField(keyType);
                        skipField(valType);
                    }
                }
                break;
            }
            case THRIFT_STRUCT:
                skipStruct();
                break;
            default:
                break;
        }
    }

    // Skip an entire struct
    void skipStruct() {
        while (true) {
            auto [fieldId, type] = readFieldHeader();
            if (type == THRIFT_STOP) break;
            skipField(type);
        }
    }

    // Read list header, returns (size, element_type)
    std::pair<uint32_t, ThriftType> readListHeader() {
        uint8_t header = readByte();
        uint32_t size = (header >> 4) & 0x0F;
        ThriftType elemType = static_cast<ThriftType>(header & 0x0F);
        if (size == 15) {
            size = static_cast<uint32_t>(readVarint());
        }
        return {size, elemType};
    }

    // Reset field ID tracking (call when entering a new struct)
    void resetFieldId() {
        lastFieldId_ = 0;
    }

private:
    const uint8_t* data_;
    size_t len_;
    size_t pos_;
    int16_t lastFieldId_;
};

// ============================================================================
// Parquet Metadata Structures
// ============================================================================

// Statistics for a column chunk
struct ColumnStatistics {
    bool hasMinMax = false;
    std::string min;    // Raw bytes
    std::string max;    // Raw bytes
    std::optional<int64_t> nullCount;
    std::optional<int64_t> distinctCount;

    // Type-specific accessors
    template<typename T>
    std::optional<T> minAs() const {
        if (!hasMinMax || min.size() < sizeof(T)) return std::nullopt;
        T val;
        memcpy(&val, min.data(), sizeof(T));
        return val;
    }

    template<typename T>
    std::optional<T> maxAs() const {
        if (!hasMinMax || max.size() < sizeof(T)) return std::nullopt;
        T val;
        memcpy(&val, max.data(), sizeof(T));
        return val;
    }
};

// Schema element (column definition)
struct SchemaElement {
    std::optional<ParquetType> type;
    std::string name;
    std::optional<int32_t> numChildren;
    std::optional<ConvertedType> convertedType;
    std::optional<int32_t> typeLength;  // For FIXED_LEN_BYTE_ARRAY
    std::optional<int32_t> precision;   // For decimals
    std::optional<int32_t> scale;       // For decimals
};

// Column metadata within a row group
struct ColumnMetaData {
    ParquetType type = ParquetType::BYTE_ARRAY;
    std::vector<Encoding> encodings;
    std::vector<std::string> pathInSchema;
    CompressionCodec codec = CompressionCodec::UNCOMPRESSED;
    int64_t numValues = 0;
    int64_t totalUncompressedSize = 0;
    int64_t totalCompressedSize = 0;
    int64_t dataPageOffset = 0;
    std::optional<int64_t> indexPageOffset;
    std::optional<int64_t> dictionaryPageOffset;
    ColumnStatistics statistics;
};

// Column chunk (column within a row group)
struct ColumnChunk {
    std::optional<std::string> filePath;  // For external files
    int64_t fileOffset = 0;
    std::optional<ColumnMetaData> metaData;

    // Crypto metadata would go here for encrypted files
};

// Row group
struct RowGroup {
    std::vector<ColumnChunk> columns;
    int64_t totalByteSize = 0;
    int64_t numRows = 0;
    int64_t fileOffset = 0;
    std::optional<int64_t> totalCompressedSize;
    std::optional<int16_t> ordinal;
};

// File metadata
struct FileMetaData {
    int32_t version = 0;
    std::vector<SchemaElement> schema;
    int64_t numRows = 0;
    std::vector<RowGroup> rowGroups;
    std::optional<std::string> createdBy;

    // Get leaf column names (columns with data, not groups)
    std::vector<std::string> getColumnNames() const {
        std::vector<std::string> names;
        for (const auto& elem : schema) {
            if (elem.type.has_value()) {  // Leaf node has a type
                names.push_back(elem.name);
            }
        }
        return names;
    }

    // Find column index by name
    int findColumnIndex(const std::string& name) const {
        int leafIdx = 0;
        for (const auto& elem : schema) {
            if (elem.type.has_value()) {
                if (elem.name == name) return leafIdx;
                leafIdx++;
            }
        }
        return -1;
    }
};

// Page header
struct PageHeader {
    PageType type = PageType::DATA_PAGE;
    int32_t uncompressedPageSize = 0;
    int32_t compressedPageSize = 0;
    int32_t numValues = 0;  // For data pages
    Encoding encoding = Encoding::PLAIN;
    Encoding definitionLevelEncoding = Encoding::RLE;
    Encoding repetitionLevelEncoding = Encoding::RLE;
};

// ============================================================================
// Thrift Metadata Parser
// ============================================================================

class ParquetMetadataParser {
public:
    // Parse Statistics struct
    static ColumnStatistics parseStatistics(ThriftReader& reader) {
        ColumnStatistics stats;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // max (deprecated, use max_value)
                    if (!stats.hasMinMax) stats.max = reader.readBinary();
                    else reader.skipField(type);
                    break;
                case 2:  // min (deprecated, use min_value)
                    if (!stats.hasMinMax) stats.min = reader.readBinary();
                    else reader.skipField(type);
                    break;
                case 3:  // null_count
                    stats.nullCount = reader.readI64();
                    break;
                case 4:  // distinct_count
                    stats.distinctCount = reader.readI64();
                    break;
                case 5:  // max_value
                    stats.max = reader.readBinary();
                    stats.hasMinMax = true;
                    break;
                case 6:  // min_value
                    stats.min = reader.readBinary();
                    stats.hasMinMax = true;
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        if (!stats.min.empty() || !stats.max.empty()) {
            stats.hasMinMax = true;
        }

        return stats;
    }

    // Parse SchemaElement struct
    static SchemaElement parseSchemaElement(ThriftReader& reader) {
        SchemaElement elem;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // type
                    elem.type = static_cast<ParquetType>(reader.readI32());
                    break;
                case 2:  // type_length
                    elem.typeLength = reader.readI32();
                    break;
                case 4:  // name
                    elem.name = reader.readBinary();
                    break;
                case 5:  // num_children
                    elem.numChildren = reader.readI32();
                    break;
                case 6:  // converted_type
                    elem.convertedType = static_cast<ConvertedType>(reader.readI32());
                    break;
                case 7:  // scale
                    elem.scale = reader.readI32();
                    break;
                case 8:  // precision
                    elem.precision = reader.readI32();
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return elem;
    }

    // Parse ColumnMetaData struct
    static ColumnMetaData parseColumnMetaData(ThriftReader& reader) {
        ColumnMetaData meta;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // type
                    meta.type = static_cast<ParquetType>(reader.readI32());
                    break;
                case 2: {  // encodings
                    auto [size, elemType] = reader.readListHeader();
                    for (uint32_t i = 0; i < size; i++) {
                        meta.encodings.push_back(static_cast<Encoding>(reader.readI32()));
                    }
                    break;
                }
                case 3: {  // path_in_schema
                    auto [size, elemType] = reader.readListHeader();
                    for (uint32_t i = 0; i < size; i++) {
                        meta.pathInSchema.push_back(reader.readBinary());
                    }
                    break;
                }
                case 4:  // codec
                    meta.codec = static_cast<CompressionCodec>(reader.readI32());
                    break;
                case 5:  // num_values
                    meta.numValues = reader.readI64();
                    break;
                case 6:  // total_uncompressed_size
                    meta.totalUncompressedSize = reader.readI64();
                    break;
                case 7:  // total_compressed_size
                    meta.totalCompressedSize = reader.readI64();
                    break;
                case 9:  // data_page_offset
                    meta.dataPageOffset = reader.readI64();
                    break;
                case 10:  // index_page_offset
                    meta.indexPageOffset = reader.readI64();
                    break;
                case 11:  // dictionary_page_offset
                    meta.dictionaryPageOffset = reader.readI64();
                    break;
                case 12:  // statistics
                    meta.statistics = parseStatistics(reader);
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return meta;
    }

    // Parse ColumnChunk struct
    static ColumnChunk parseColumnChunk(ThriftReader& reader) {
        ColumnChunk chunk;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // file_path
                    chunk.filePath = reader.readBinary();
                    break;
                case 2:  // file_offset
                    chunk.fileOffset = reader.readI64();
                    break;
                case 3:  // meta_data
                    chunk.metaData = parseColumnMetaData(reader);
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return chunk;
    }

    // Parse RowGroup struct
    static RowGroup parseRowGroup(ThriftReader& reader) {
        RowGroup rowGroup;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1: {  // columns
                    auto [size, elemType] = reader.readListHeader();
                    for (uint32_t i = 0; i < size; i++) {
                        rowGroup.columns.push_back(parseColumnChunk(reader));
                    }
                    break;
                }
                case 2:  // total_byte_size
                    rowGroup.totalByteSize = reader.readI64();
                    break;
                case 3:  // num_rows
                    rowGroup.numRows = reader.readI64();
                    break;
                case 5:  // file_offset
                    rowGroup.fileOffset = reader.readI64();
                    break;
                case 6:  // total_compressed_size
                    rowGroup.totalCompressedSize = reader.readI64();
                    break;
                case 7:  // ordinal
                    rowGroup.ordinal = reader.readI16();
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return rowGroup;
    }

    // Parse FileMetaData struct
    static FileMetaData parseFileMetaData(ThriftReader& reader) {
        FileMetaData meta;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // version
                    meta.version = reader.readI32();
                    break;
                case 2: {  // schema
                    auto [size, elemType] = reader.readListHeader();
                    for (uint32_t i = 0; i < size; i++) {
                        meta.schema.push_back(parseSchemaElement(reader));
                    }
                    break;
                }
                case 3:  // num_rows
                    meta.numRows = reader.readI64();
                    break;
                case 4: {  // row_groups
                    auto [size, elemType] = reader.readListHeader();
                    for (uint32_t i = 0; i < size; i++) {
                        meta.rowGroups.push_back(parseRowGroup(reader));
                    }
                    break;
                }
                case 6:  // created_by
                    meta.createdBy = reader.readBinary();
                    break;
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return meta;
    }

    // Parse PageHeader struct
    static PageHeader parsePageHeader(ThriftReader& reader) {
        PageHeader header;
        reader.resetFieldId();

        while (true) {
            auto [fieldId, type] = reader.readFieldHeader();
            if (type == THRIFT_STOP) break;

            switch (fieldId) {
                case 1:  // type
                    header.type = static_cast<PageType>(reader.readI32());
                    break;
                case 2:  // uncompressed_page_size
                    header.uncompressedPageSize = reader.readI32();
                    break;
                case 3:  // compressed_page_size
                    header.compressedPageSize = reader.readI32();
                    break;
                case 5: {  // data_page_header
                    // Parse inline DataPageHeader
                    reader.resetFieldId();
                    while (true) {
                        auto [fid, ftype] = reader.readFieldHeader();
                        if (ftype == THRIFT_STOP) break;
                        switch (fid) {
                            case 1: header.numValues = reader.readI32(); break;
                            case 2: header.encoding = static_cast<Encoding>(reader.readI32()); break;
                            case 3: header.definitionLevelEncoding = static_cast<Encoding>(reader.readI32()); break;
                            case 4: header.repetitionLevelEncoding = static_cast<Encoding>(reader.readI32()); break;
                            default: reader.skipField(ftype); break;
                        }
                    }
                    break;
                }
                case 7: {  // data_page_header_v2
                    reader.resetFieldId();
                    while (true) {
                        auto [fid, ftype] = reader.readFieldHeader();
                        if (ftype == THRIFT_STOP) break;
                        switch (fid) {
                            case 1: header.numValues = reader.readI32(); break;
                            case 3: header.encoding = static_cast<Encoding>(reader.readI32()); break;
                            default: reader.skipField(ftype); break;
                        }
                    }
                    break;
                }
                default:
                    reader.skipField(type);
                    break;
            }
        }

        return header;
    }
};

// ============================================================================
// Snappy Decompression (Minimal Implementation)
// ============================================================================

class SnappyDecoder {
public:
    // Decompress Snappy data
    // Returns true on success, false on failure
    static bool decompress(const uint8_t* input, size_t inputLen,
                           uint8_t* output, size_t outputLen) {
        if (inputLen == 0) return false;

        size_t srcPos = 0;
        size_t dstPos = 0;

        // Read uncompressed length (varint)
        size_t uncompressedLen = readVarint(input, inputLen, srcPos);
        if (uncompressedLen > outputLen) return false;

        while (srcPos < inputLen && dstPos < uncompressedLen) {
            uint8_t tag = input[srcPos++];
            uint8_t tagType = tag & 0x03;

            if (tagType == 0) {
                // Literal
                size_t len = (tag >> 2) + 1;
                if (len > 60) {
                    // Extended length
                    size_t extraBytes = len - 60;
                    len = 0;
                    for (size_t i = 0; i < extraBytes && srcPos < inputLen; i++) {
                        len |= static_cast<size_t>(input[srcPos++]) << (i * 8);
                    }
                    len++;
                }
                if (srcPos + len > inputLen || dstPos + len > outputLen) return false;
                memcpy(output + dstPos, input + srcPos, len);
                srcPos += len;
                dstPos += len;
            } else {
                // Copy (back-reference)
                size_t len, offset;
                switch (tagType) {
                    case 1:
                        // 1-byte offset
                        len = ((tag >> 2) & 0x07) + 4;
                        offset = ((tag >> 5) << 8);
                        if (srcPos >= inputLen) return false;
                        offset |= input[srcPos++];
                        break;
                    case 2:
                        // 2-byte offset
                        len = (tag >> 2) + 1;
                        if (srcPos + 2 > inputLen) return false;
                        offset = input[srcPos] | (static_cast<size_t>(input[srcPos + 1]) << 8);
                        srcPos += 2;
                        break;
                    case 3:
                        // 4-byte offset
                        len = (tag >> 2) + 1;
                        if (srcPos + 4 > inputLen) return false;
                        offset = input[srcPos] |
                                (static_cast<size_t>(input[srcPos + 1]) << 8) |
                                (static_cast<size_t>(input[srcPos + 2]) << 16) |
                                (static_cast<size_t>(input[srcPos + 3]) << 24);
                        srcPos += 4;
                        break;
                    default:
                        return false;
                }

                if (offset == 0 || offset > dstPos || dstPos + len > outputLen) {
                    return false;
                }

                // Copy with overlap handling
                size_t srcOff = dstPos - offset;
                for (size_t i = 0; i < len; i++) {
                    output[dstPos++] = output[srcOff++];
                }
            }
        }

        return dstPos == uncompressedLen;
    }

    // Get uncompressed length from Snappy data
    static size_t getUncompressedLength(const uint8_t* input, size_t inputLen) {
        size_t pos = 0;
        return readVarint(input, inputLen, pos);
    }

private:
    static size_t readVarint(const uint8_t* data, size_t len, size_t& pos) {
        size_t result = 0;
        int shift = 0;
        while (pos < len) {
            uint8_t byte = data[pos++];
            result |= static_cast<size_t>(byte & 0x7F) << shift;
            if ((byte & 0x80) == 0) break;
            shift += 7;
        }
        return result;
    }
};

// ============================================================================
// Value Type for Results
// ============================================================================

using ParquetValue = std::variant<
    std::monostate,  // null
    bool,
    int32_t,
    int64_t,
    float,
    double,
    std::string  // for BYTE_ARRAY
>;

std::string valueToString(const ParquetValue& v) {
    if (std::holds_alternative<std::monostate>(v)) return "NULL";
    if (std::holds_alternative<bool>(v)) return std::get<bool>(v) ? "true" : "false";
    if (std::holds_alternative<int32_t>(v)) return std::to_string(std::get<int32_t>(v));
    if (std::holds_alternative<int64_t>(v)) return std::to_string(std::get<int64_t>(v));
    if (std::holds_alternative<float>(v)) {
        std::ostringstream oss;
        oss << std::setprecision(7) << std::get<float>(v);
        return oss.str();
    }
    if (std::holds_alternative<double>(v)) {
        std::ostringstream oss;
        oss << std::setprecision(15) << std::get<double>(v);
        return oss.str();
    }
    return std::get<std::string>(v);
}

// ============================================================================
// Predicate for Row Group Filtering
// ============================================================================

enum class PredicateOp {
    EQ,   // =
    NE,   // !=
    LT,   // <
    LE,   // <=
    GT,   // >
    GE    // >=
};

struct ColumnPredicate {
    std::string columnName;
    PredicateOp op;
    ParquetValue value;
};

// ============================================================================
// HTTP Range Request Interface (for WASM JS interop)
// ============================================================================

// Callback type for async HTTP fetch
using FetchCallback = std::function<void(const uint8_t* data, size_t len, bool success)>;

// Interface for data fetching (implemented by JS)
class DataFetcher {
public:
    virtual ~DataFetcher() = default;

    // Synchronous read (for in-memory data)
    virtual bool read(size_t offset, size_t length, uint8_t* buffer) = 0;

    // Get total file size
    virtual size_t fileSize() const = 0;
};

// In-memory data fetcher (for fully loaded files)
class MemoryDataFetcher : public DataFetcher {
public:
    MemoryDataFetcher(const uint8_t* data, size_t size)
        : data_(data), size_(size) {}

    bool read(size_t offset, size_t length, uint8_t* buffer) override {
        if (offset + length > size_) return false;
        memcpy(buffer, data_ + offset, length);
        return true;
    }

    size_t fileSize() const override { return size_; }

private:
    const uint8_t* data_;
    size_t size_;
};

// ============================================================================
// Parquet Reader
// ============================================================================

class ParquetReader {
public:
    ParquetReader() = default;

    // Initialize with in-memory data
    bool init(const uint8_t* data, size_t size) {
        fetcher_ = std::make_unique<MemoryDataFetcher>(data, size);
        return parseFooter();
    }

    // Initialize with custom fetcher (for HTTP range requests)
    bool init(std::unique_ptr<DataFetcher> fetcher) {
        fetcher_ = std::move(fetcher);
        return parseFooter();
    }

    // Get parsed metadata
    const FileMetaData& metadata() const { return metadata_; }

    // Get column names
    std::vector<std::string> getColumnNames() const {
        return metadata_.getColumnNames();
    }

    // Get row group count
    size_t rowGroupCount() const { return metadata_.rowGroups.size(); }

    // Get total row count
    int64_t totalRows() const { return metadata_.numRows; }

    // Check if a row group might contain matching rows based on statistics
    bool rowGroupMatchesPredicate(size_t rowGroupIdx, const ColumnPredicate& pred) const {
        if (rowGroupIdx >= metadata_.rowGroups.size()) return false;

        const auto& rowGroup = metadata_.rowGroups[rowGroupIdx];
        int colIdx = metadata_.findColumnIndex(pred.columnName);
        if (colIdx < 0 || colIdx >= static_cast<int>(rowGroup.columns.size())) {
            return true;  // Column not found, can't skip
        }

        const auto& chunk = rowGroup.columns[colIdx];
        if (!chunk.metaData.has_value()) return true;

        const auto& stats = chunk.metaData->statistics;
        if (!stats.hasMinMax) return true;  // No stats, can't skip

        // Get column type
        ParquetType type = chunk.metaData->type;

        // Perform predicate pushdown based on column type
        return evaluateStatistics(stats, type, pred);
    }

    // Read a column chunk's data
    std::vector<ParquetValue> readColumn(size_t rowGroupIdx, const std::string& columnName) {
        std::vector<ParquetValue> values;

        if (rowGroupIdx >= metadata_.rowGroups.size()) return values;

        const auto& rowGroup = metadata_.rowGroups[rowGroupIdx];
        int colIdx = metadata_.findColumnIndex(columnName);
        if (colIdx < 0 || colIdx >= static_cast<int>(rowGroup.columns.size())) {
            return values;
        }

        const auto& chunk = rowGroup.columns[colIdx];
        if (!chunk.metaData.has_value()) return values;

        const auto& meta = *chunk.metaData;

        // Determine read offset
        int64_t offset = meta.dataPageOffset;
        if (meta.dictionaryPageOffset.has_value()) {
            offset = std::min(offset, *meta.dictionaryPageOffset);
        }

        // Read column data
        size_t readSize = static_cast<size_t>(meta.totalCompressedSize);
        std::vector<uint8_t> compressedData(readSize);

        if (!fetcher_->read(static_cast<size_t>(offset), readSize, compressedData.data())) {
            return values;
        }

        // Parse pages and extract values
        return parseColumnPages(compressedData.data(), readSize, meta);
    }

    // Read selected columns from a row group
    std::vector<std::vector<ParquetValue>> readRowGroup(
        size_t rowGroupIdx,
        const std::vector<std::string>& columns
    ) {
        std::vector<std::vector<ParquetValue>> result;
        result.reserve(columns.size());

        for (const auto& col : columns) {
            result.push_back(readColumn(rowGroupIdx, col));
        }

        return result;
    }

    // Get last error message
    const std::string& lastError() const { return lastError_; }

private:
    bool parseFooter() {
        size_t fileSize = fetcher_->fileSize();
        if (fileSize < 12) {  // Minimum: magic(4) + footer_len(4) + magic(4)
            lastError_ = "File too small to be a valid Parquet file";
            return false;
        }

        // Read footer (last 8 bytes: footer_length + magic)
        uint8_t footer[8];
        if (!fetcher_->read(fileSize - 8, 8, footer)) {
            lastError_ = "Failed to read footer";
            return false;
        }

        // Verify magic
        if (memcmp(footer + 4, PARQUET_MAGIC, 4) != 0) {
            if (memcmp(footer + 4, PARQUET_MAGIC_ENCRYPTED, 4) == 0) {
                lastError_ = "Encrypted Parquet files are not supported";
            } else {
                lastError_ = "Invalid Parquet magic bytes";
            }
            return false;
        }

        // Read footer length (little-endian i32)
        uint32_t footerLen = footer[0] | (footer[1] << 8) |
                            (footer[2] << 16) | (footer[3] << 24);

        if (footerLen + 8 > fileSize) {
            lastError_ = "Footer length exceeds file size";
            return false;
        }

        // Read footer metadata
        size_t metadataOffset = fileSize - 8 - footerLen;
        std::vector<uint8_t> metadataBuffer(footerLen);
        if (!fetcher_->read(metadataOffset, footerLen, metadataBuffer.data())) {
            lastError_ = "Failed to read footer metadata";
            return false;
        }

        // Parse FileMetaData
        ThriftReader reader(metadataBuffer.data(), footerLen);
        metadata_ = ParquetMetadataParser::parseFileMetaData(reader);

        return true;
    }

    std::vector<ParquetValue> parseColumnPages(
        const uint8_t* data,
        size_t dataLen,
        const ColumnMetaData& meta
    ) {
        std::vector<ParquetValue> values;
        values.reserve(meta.numValues);

        size_t pos = 0;
        bool hasDictionary = false;
        std::vector<ParquetValue> dictionary;

        while (pos < dataLen && values.size() < static_cast<size_t>(meta.numValues)) {
            // Parse page header
            ThriftReader reader(data + pos, dataLen - pos);
            PageHeader pageHeader = ParquetMetadataParser::parsePageHeader(reader);
            pos += reader.position();

            if (pos + pageHeader.compressedPageSize > dataLen) break;

            // Get page data
            const uint8_t* pageData = data + pos;
            size_t pageDataLen = pageHeader.compressedPageSize;

            // Decompress if needed
            std::vector<uint8_t> decompressedData;
            if (meta.codec != CompressionCodec::UNCOMPRESSED) {
                size_t uncompressedSize = pageHeader.uncompressedPageSize;
                decompressedData.resize(uncompressedSize);

                bool decompressOk = false;
                switch (meta.codec) {
                    case CompressionCodec::SNAPPY:
                        decompressOk = SnappyDecoder::decompress(
                            pageData, pageDataLen,
                            decompressedData.data(), uncompressedSize
                        );
                        break;
                    default:
                        // Unsupported codec
                        pos += pageDataLen;
                        continue;
                }

                if (!decompressOk) {
                    pos += pageDataLen;
                    continue;
                }

                pageData = decompressedData.data();
                pageDataLen = uncompressedSize;
            }

            // Process page based on type
            if (pageHeader.type == PageType::DICTIONARY_PAGE) {
                // Parse dictionary
                dictionary = decodePlainValues(pageData, pageDataLen, meta.type, pageHeader.numValues);
                hasDictionary = true;
            } else if (pageHeader.type == PageType::DATA_PAGE ||
                       pageHeader.type == PageType::DATA_PAGE_V2) {
                // Decode data page
                std::vector<ParquetValue> pageValues;

                if (hasDictionary &&
                    (pageHeader.encoding == Encoding::RLE_DICTIONARY ||
                     pageHeader.encoding == Encoding::PLAIN_DICTIONARY)) {
                    pageValues = decodeRLEDictValues(
                        pageData, pageDataLen, dictionary, pageHeader.numValues
                    );
                } else if (pageHeader.encoding == Encoding::PLAIN) {
                    pageValues = decodePlainValues(
                        pageData, pageDataLen, meta.type, pageHeader.numValues
                    );
                }

                values.insert(values.end(), pageValues.begin(), pageValues.end());
            }

            pos += pageHeader.compressedPageSize;
        }

        return values;
    }

    std::vector<ParquetValue> decodePlainValues(
        const uint8_t* data,
        size_t len,
        ParquetType type,
        int32_t numValues
    ) {
        std::vector<ParquetValue> values;
        values.reserve(numValues);

        size_t pos = 0;

        for (int32_t i = 0; i < numValues && pos < len; i++) {
            switch (type) {
                case ParquetType::BOOLEAN: {
                    size_t byteIdx = i / 8;
                    size_t bitIdx = i % 8;
                    if (byteIdx < len) {
                        bool val = (data[byteIdx] >> bitIdx) & 1;
                        values.push_back(val);
                    }
                    break;
                }
                case ParquetType::INT32: {
                    if (pos + 4 <= len) {
                        int32_t val;
                        memcpy(&val, data + pos, 4);
                        values.push_back(val);
                        pos += 4;
                    }
                    break;
                }
                case ParquetType::INT64: {
                    if (pos + 8 <= len) {
                        int64_t val;
                        memcpy(&val, data + pos, 8);
                        values.push_back(val);
                        pos += 8;
                    }
                    break;
                }
                case ParquetType::FLOAT: {
                    if (pos + 4 <= len) {
                        float val;
                        memcpy(&val, data + pos, 4);
                        values.push_back(val);
                        pos += 4;
                    }
                    break;
                }
                case ParquetType::DOUBLE: {
                    if (pos + 8 <= len) {
                        double val;
                        memcpy(&val, data + pos, 8);
                        values.push_back(val);
                        pos += 8;
                    }
                    break;
                }
                case ParquetType::BYTE_ARRAY: {
                    if (pos + 4 <= len) {
                        uint32_t strLen;
                        memcpy(&strLen, data + pos, 4);
                        pos += 4;
                        if (pos + strLen <= len) {
                            values.push_back(std::string(
                                reinterpret_cast<const char*>(data + pos), strLen
                            ));
                            pos += strLen;
                        }
                    }
                    break;
                }
                case ParquetType::INT96: {
                    // Skip INT96 (deprecated timestamp format)
                    if (pos + 12 <= len) {
                        pos += 12;
                        values.push_back(std::monostate{});
                    }
                    break;
                }
                case ParquetType::FIXED_LEN_BYTE_ARRAY: {
                    // Need type_length from schema, skip for now
                    values.push_back(std::monostate{});
                    break;
                }
            }
        }

        return values;
    }

    std::vector<ParquetValue> decodeRLEDictValues(
        const uint8_t* data,
        size_t len,
        const std::vector<ParquetValue>& dictionary,
        int32_t numValues
    ) {
        std::vector<ParquetValue> values;
        values.reserve(numValues);

        if (len < 4 || dictionary.empty()) return values;

        // Skip definition/repetition levels (simplified - assumes all values present)
        size_t pos = 0;

        // Read bit width
        uint8_t bitWidth = data[pos++];
        if (bitWidth == 0 || bitWidth > 32) return values;

        // RLE/Bit-packed hybrid decoding
        while (pos < len && values.size() < static_cast<size_t>(numValues)) {
            // Read header varint
            uint32_t header = 0;
            int shift = 0;
            while (pos < len) {
                uint8_t byte = data[pos++];
                header |= (byte & 0x7F) << shift;
                if ((byte & 0x80) == 0) break;
                shift += 7;
            }

            if (header & 1) {
                // Bit-packed run
                uint32_t count = (header >> 1) * 8;
                uint32_t bytesNeeded = (count * bitWidth + 7) / 8;

                if (pos + bytesNeeded > len) break;

                // Decode bit-packed values
                uint64_t buffer = 0;
                int bitsInBuffer = 0;

                for (uint32_t i = 0; i < count && values.size() < static_cast<size_t>(numValues); i++) {
                    while (bitsInBuffer < static_cast<int>(bitWidth) && pos < len) {
                        buffer |= static_cast<uint64_t>(data[pos++]) << bitsInBuffer;
                        bitsInBuffer += 8;
                    }

                    uint32_t idx = buffer & ((1ULL << bitWidth) - 1);
                    buffer >>= bitWidth;
                    bitsInBuffer -= bitWidth;

                    if (idx < dictionary.size()) {
                        values.push_back(dictionary[idx]);
                    } else {
                        values.push_back(std::monostate{});
                    }
                }
            } else {
                // RLE run
                uint32_t count = header >> 1;
                uint32_t bytesForValue = (bitWidth + 7) / 8;

                if (pos + bytesForValue > len) break;

                uint32_t idx = 0;
                for (uint32_t i = 0; i < bytesForValue; i++) {
                    idx |= static_cast<uint32_t>(data[pos++]) << (i * 8);
                }

                for (uint32_t i = 0; i < count && values.size() < static_cast<size_t>(numValues); i++) {
                    if (idx < dictionary.size()) {
                        values.push_back(dictionary[idx]);
                    } else {
                        values.push_back(std::monostate{});
                    }
                }
            }
        }

        return values;
    }

    bool evaluateStatistics(
        const ColumnStatistics& stats,
        ParquetType type,
        const ColumnPredicate& pred
    ) const {
        // Compare predicate value against min/max statistics
        // Returns true if the row group MIGHT contain matching rows

        switch (type) {
            case ParquetType::INT32: {
                auto minVal = stats.minAs<int32_t>();
                auto maxVal = stats.maxAs<int32_t>();
                if (!minVal || !maxVal) return true;

                if (!std::holds_alternative<int32_t>(pred.value) &&
                    !std::holds_alternative<int64_t>(pred.value)) {
                    return true;
                }

                int32_t predVal = std::holds_alternative<int32_t>(pred.value)
                    ? std::get<int32_t>(pred.value)
                    : static_cast<int32_t>(std::get<int64_t>(pred.value));

                switch (pred.op) {
                    case PredicateOp::EQ: return predVal >= *minVal && predVal <= *maxVal;
                    case PredicateOp::NE: return true;  // Can't eliminate
                    case PredicateOp::LT: return *minVal < predVal;
                    case PredicateOp::LE: return *minVal <= predVal;
                    case PredicateOp::GT: return *maxVal > predVal;
                    case PredicateOp::GE: return *maxVal >= predVal;
                }
                break;
            }
            case ParquetType::INT64: {
                auto minVal = stats.minAs<int64_t>();
                auto maxVal = stats.maxAs<int64_t>();
                if (!minVal || !maxVal) return true;

                if (!std::holds_alternative<int64_t>(pred.value) &&
                    !std::holds_alternative<int32_t>(pred.value)) {
                    return true;
                }

                int64_t predVal = std::holds_alternative<int64_t>(pred.value)
                    ? std::get<int64_t>(pred.value)
                    : static_cast<int64_t>(std::get<int32_t>(pred.value));

                switch (pred.op) {
                    case PredicateOp::EQ: return predVal >= *minVal && predVal <= *maxVal;
                    case PredicateOp::NE: return true;
                    case PredicateOp::LT: return *minVal < predVal;
                    case PredicateOp::LE: return *minVal <= predVal;
                    case PredicateOp::GT: return *maxVal > predVal;
                    case PredicateOp::GE: return *maxVal >= predVal;
                }
                break;
            }
            case ParquetType::DOUBLE: {
                auto minVal = stats.minAs<double>();
                auto maxVal = stats.maxAs<double>();
                if (!minVal || !maxVal) return true;

                if (!std::holds_alternative<double>(pred.value) &&
                    !std::holds_alternative<float>(pred.value)) {
                    return true;
                }

                double predVal = std::holds_alternative<double>(pred.value)
                    ? std::get<double>(pred.value)
                    : static_cast<double>(std::get<float>(pred.value));

                switch (pred.op) {
                    case PredicateOp::EQ: return predVal >= *minVal && predVal <= *maxVal;
                    case PredicateOp::NE: return true;
                    case PredicateOp::LT: return *minVal < predVal;
                    case PredicateOp::LE: return *minVal <= predVal;
                    case PredicateOp::GT: return *maxVal > predVal;
                    case PredicateOp::GE: return *maxVal >= predVal;
                }
                break;
            }
            default:
                return true;  // Can't filter for other types
        }

        return true;
    }

    std::unique_ptr<DataFetcher> fetcher_;
    FileMetaData metadata_;
    std::string lastError_;
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatParquetResultCSV(
    const std::vector<std::string>& columns,
    const std::vector<std::vector<ParquetValue>>& data
) {
    std::string result;

    // Header row
    for (size_t i = 0; i < columns.size(); i++) {
        if (i > 0) result += ",";
        result += "\"" + columns[i] + "\"";
    }
    result += "\n";

    // Determine row count
    size_t rowCount = 0;
    for (const auto& col : data) {
        rowCount = std::max(rowCount, col.size());
    }

    // Data rows
    for (size_t r = 0; r < rowCount; r++) {
        for (size_t c = 0; c < data.size(); c++) {
            if (c > 0) result += ",";
            if (r < data[c].size()) {
                const auto& val = data[c][r];
                if (std::holds_alternative<std::string>(val)) {
                    result += "\"";
                    for (char ch : std::get<std::string>(val)) {
                        if (ch == '"') result += "\"\"";
                        else result += ch;
                    }
                    result += "\"";
                } else {
                    result += valueToString(val);
                }
            } else {
                result += "NULL";
            }
        }
        result += "\n";
    }

    return result;
}

std::string formatParquetResultJSON(
    const std::vector<std::string>& columns,
    const std::vector<std::vector<ParquetValue>>& data
) {
    std::string result = "{\n";
    result += "  \"meta\": [\n";

    for (size_t i = 0; i < columns.size(); i++) {
        result += "    {\"name\": \"" + columns[i] + "\", \"type\": \"String\"}";
        if (i < columns.size() - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"data\": [\n";

    size_t rowCount = 0;
    for (const auto& col : data) {
        rowCount = std::max(rowCount, col.size());
    }

    for (size_t r = 0; r < rowCount; r++) {
        result += "    {";
        for (size_t c = 0; c < data.size(); c++) {
            if (c > 0) result += ", ";
            result += "\"" + columns[c] + "\": ";
            if (r < data[c].size()) {
                const auto& val = data[c][r];
                if (std::holds_alternative<std::monostate>(val)) {
                    result += "null";
                } else if (std::holds_alternative<std::string>(val)) {
                    result += "\"";
                    for (char ch : std::get<std::string>(val)) {
                        switch (ch) {
                            case '"': result += "\\\""; break;
                            case '\\': result += "\\\\"; break;
                            case '\n': result += "\\n"; break;
                            case '\r': result += "\\r"; break;
                            case '\t': result += "\\t"; break;
                            default: result += ch; break;
                        }
                    }
                    result += "\"";
                } else if (std::holds_alternative<bool>(val)) {
                    result += std::get<bool>(val) ? "true" : "false";
                } else {
                    result += valueToString(val);
                }
            } else {
                result += "null";
            }
        }
        result += "}";
        if (r < rowCount - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"rows\": " + std::to_string(rowCount) + ",\n";
    result += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(rowCount) + ", \"bytes_read\": 0}\n";
    result += "}\n";

    return result;
}

// ============================================================================
// Reader Context
// ============================================================================

struct ParquetReaderContext {
    std::unique_ptr<ParquetReader> reader;
    char* lastResult = nullptr;
    size_t lastResultLen = 0;
    char* lastError = nullptr;

    ~ParquetReaderContext() {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const std::string& result) {
        if (lastResult) free(lastResult);
        if (lastError) {
            free(lastError);
            lastError = nullptr;
        }
        lastResultLen = result.size();
        lastResult = static_cast<char*>(malloc(lastResultLen + 1));
        memcpy(lastResult, result.c_str(), lastResultLen + 1);
    }

    void setError(const std::string& error) {
        if (lastError) free(lastError);
        lastError = strdup(error.c_str());
        lastResultLen = 0;
        if (lastResult) {
            free(lastResult);
            lastResult = nullptr;
        }
    }
};

// ============================================================================
// C API
// ============================================================================

extern "C" {

/**
 * Create a new Parquet reader context.
 */
EXPORT
void* parquet_reader_create() {
    return new ParquetReaderContext();
}

/**
 * Destroy a Parquet reader context.
 */
EXPORT
void parquet_reader_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<ParquetReaderContext*>(ctx);
    }
}

/**
 * Initialize reader with in-memory Parquet data.
 * @param ctx Reader context
 * @param data Pointer to Parquet file data
 * @param data_len Length of data
 * @return 0 on success, -1 on error
 */
EXPORT
int parquet_reader_init(void* ctx, const uint8_t* data, size_t data_len) {
    if (!ctx || !data || data_len == 0) return -1;

    auto* context = static_cast<ParquetReaderContext*>(ctx);
    context->reader = std::make_unique<ParquetReader>();

    if (!context->reader->init(data, data_len)) {
        context->setError(context->reader->lastError());
        return -1;
    }

    return 0;
}

/**
 * Get metadata as JSON.
 */
EXPORT
int parquet_reader_get_metadata(void* ctx) {
    if (!ctx) return -1;

    auto* context = static_cast<ParquetReaderContext*>(ctx);
    if (!context->reader) {
        context->setError("Reader not initialized");
        return -1;
    }

    const auto& meta = context->reader->metadata();

    std::string result = "{\n";
    result += "  \"version\": " + std::to_string(meta.version) + ",\n";
    result += "  \"num_rows\": " + std::to_string(meta.numRows) + ",\n";
    result += "  \"row_group_count\": " + std::to_string(meta.rowGroups.size()) + ",\n";

    if (meta.createdBy) {
        result += "  \"created_by\": \"" + *meta.createdBy + "\",\n";
    }

    result += "  \"columns\": [\n";
    auto columns = context->reader->getColumnNames();
    for (size_t i = 0; i < columns.size(); i++) {
        result += "    \"" + columns[i] + "\"";
        if (i < columns.size() - 1) result += ",";
        result += "\n";
    }
    result += "  ],\n";

    result += "  \"row_groups\": [\n";
    for (size_t i = 0; i < meta.rowGroups.size(); i++) {
        const auto& rg = meta.rowGroups[i];
        result += "    {\"num_rows\": " + std::to_string(rg.numRows) +
                  ", \"total_byte_size\": " + std::to_string(rg.totalByteSize) + "}";
        if (i < meta.rowGroups.size() - 1) result += ",";
        result += "\n";
    }
    result += "  ]\n";

    result += "}\n";

    context->setResult(result);
    return 0;
}

/**
 * Read selected columns from a row group.
 * @param ctx Reader context
 * @param row_group_idx Row group index
 * @param column_names Comma-separated column names (or "*" for all)
 * @param format Output format: "CSV", "JSON"
 * @return 0 on success, -1 on error
 */
EXPORT
int parquet_reader_read(void* ctx, size_t row_group_idx,
                        const char* column_names, const char* format) {
    if (!ctx) return -1;

    auto* context = static_cast<ParquetReaderContext*>(ctx);
    if (!context->reader) {
        context->setError("Reader not initialized");
        return -1;
    }

    // Parse column names
    std::vector<std::string> columns;
    std::string colStr = column_names ? column_names : "*";

    if (colStr == "*") {
        columns = context->reader->getColumnNames();
    } else {
        size_t start = 0;
        size_t end;
        while ((end = colStr.find(',', start)) != std::string::npos) {
            std::string col = colStr.substr(start, end - start);
            // Trim whitespace
            while (!col.empty() && isspace(col.front())) col.erase(0, 1);
            while (!col.empty() && isspace(col.back())) col.pop_back();
            if (!col.empty()) columns.push_back(col);
            start = end + 1;
        }
        std::string col = colStr.substr(start);
        while (!col.empty() && isspace(col.front())) col.erase(0, 1);
        while (!col.empty() && isspace(col.back())) col.pop_back();
        if (!col.empty()) columns.push_back(col);
    }

    // Read data
    auto data = context->reader->readRowGroup(row_group_idx, columns);

    // Format result
    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string result;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        result = formatParquetResultJSON(columns, data);
    } else {
        result = formatParquetResultCSV(columns, data);
    }

    context->setResult(result);
    return 0;
}

/**
 * Read all data from all row groups.
 */
EXPORT
int parquet_reader_read_all(void* ctx, const char* column_names, const char* format) {
    if (!ctx) return -1;

    auto* context = static_cast<ParquetReaderContext*>(ctx);
    if (!context->reader) {
        context->setError("Reader not initialized");
        return -1;
    }

    // Parse column names
    std::vector<std::string> columns;
    std::string colStr = column_names ? column_names : "*";

    if (colStr == "*") {
        columns = context->reader->getColumnNames();
    } else {
        size_t start = 0;
        size_t end;
        while ((end = colStr.find(',', start)) != std::string::npos) {
            std::string col = colStr.substr(start, end - start);
            while (!col.empty() && isspace(col.front())) col.erase(0, 1);
            while (!col.empty() && isspace(col.back())) col.pop_back();
            if (!col.empty()) columns.push_back(col);
            start = end + 1;
        }
        std::string col = colStr.substr(start);
        while (!col.empty() && isspace(col.front())) col.erase(0, 1);
        while (!col.empty() && isspace(col.back())) col.pop_back();
        if (!col.empty()) columns.push_back(col);
    }

    // Read all row groups
    std::vector<std::vector<ParquetValue>> allData(columns.size());

    for (size_t rg = 0; rg < context->reader->rowGroupCount(); rg++) {
        auto rgData = context->reader->readRowGroup(rg, columns);
        for (size_t c = 0; c < columns.size() && c < rgData.size(); c++) {
            allData[c].insert(allData[c].end(), rgData[c].begin(), rgData[c].end());
        }
    }

    // Format result
    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string result;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        result = formatParquetResultJSON(columns, allData);
    } else {
        result = formatParquetResultCSV(columns, allData);
    }

    context->setResult(result);
    return 0;
}

/**
 * Get the result buffer from last operation.
 */
EXPORT
const char* parquet_reader_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<ParquetReaderContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last operation.
 */
EXPORT
size_t parquet_reader_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<ParquetReaderContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last operation.
 */
EXPORT
const char* parquet_reader_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<ParquetReaderContext*>(ctx)->lastError;
}

/**
 * Get row group count.
 */
EXPORT
size_t parquet_reader_row_group_count(void* ctx) {
    if (!ctx) return 0;
    auto* context = static_cast<ParquetReaderContext*>(ctx);
    if (!context->reader) return 0;
    return context->reader->rowGroupCount();
}

/**
 * Get total row count.
 */
EXPORT
int64_t parquet_reader_total_rows(void* ctx) {
    if (!ctx) return 0;
    auto* context = static_cast<ParquetReaderContext*>(ctx);
    if (!context->reader) return 0;
    return context->reader->totalRows();
}

/**
 * Self-test function.
 */
EXPORT
int parquet_reader_test() {
    // Test Thrift reader
    {
        // Test varint decoding
        uint8_t data[] = {0xAC, 0x02};  // 300 as varint
        ThriftReader reader(data, 2);
        uint64_t val = reader.readVarint();
        if (val != 300) return -1;
    }

    {
        // Test zigzag decoding
        if (ThriftReader::zigzagToInt(0) != 0) return -2;
        if (ThriftReader::zigzagToInt(1) != -1) return -3;
        if (ThriftReader::zigzagToInt(2) != 1) return -4;
        if (ThriftReader::zigzagToInt(3) != -2) return -5;
    }

    // Test Snappy decompression (simple literal)
    {
        // Snappy compressed "hello"
        // Length: 5, Literal of 5 bytes
        uint8_t compressed[] = {0x05, 0x10, 'h', 'e', 'l', 'l', 'o'};
        uint8_t decompressed[5];

        if (!SnappyDecoder::decompress(compressed, 7, decompressed, 5)) {
            return -6;
        }

        if (memcmp(decompressed, "hello", 5) != 0) {
            return -7;
        }
    }

    // Test ParquetValue
    {
        ParquetValue v1 = 42;
        ParquetValue v2 = std::string("test");
        ParquetValue v3 = 3.14;

        if (valueToString(v1) != "42") return -8;
        if (valueToString(v2) != "test") return -9;
    }

    return 0;  // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* parquet_reader_version() {
    return "chdb-parquet-reader 0.1.0 (minimal WASM Parquet reader)";
}

} // extern "C"
