/**
 * wasm_format_stubs.cpp - Stub implementations for heavy data formats not supported in WASM
 *
 * This file provides stub implementations for ClickHouse input/output formats that are
 * too resource-intensive or require external libraries not suitable for WASM builds.
 *
 * STUB vs KEEP Decision Matrix:
 * =============================
 *
 * STUB (exclude from WASM):
 * -------------------------
 * Binary/Columnar formats with heavy dependencies:
 * - Parquet - Requires Arrow library (~15MB), heavy compression
 * - ORC - Requires ORC library, complex columnar format
 * - Arrow/ArrowStream - Requires Arrow library (~15MB)
 * - Avro - Requires Avro library, schema registry support
 *
 * Compression formats:
 * - CapnProto - Requires Cap'n Proto library
 * - Protobuf/ProtobufSingle - Requires Protobuf library (~5MB)
 * - MsgPack - Requires MsgPack library
 *
 * Database-specific formats:
 * - MySQLDump - MySQL compatibility format, heavy parsing
 * - PostgreSQL formats - PostgreSQL compatibility
 *
 * Complex formats:
 * - Template - Complex template parsing
 * - Regexp - Complex regex-based parsing
 * - CustomSeparated with expressions - Expression evaluation overhead
 *
 * Heavy image/media formats:
 * - PNG, JPEG output - Requires image libraries
 *
 * KEEP (include in WASM):
 * -----------------------
 * Text-based formats (essential):
 * - TabSeparated (TSV) - Simple, widely used
 * - TabSeparatedWithNames - TSV with header
 * - TabSeparatedRaw - No escaping
 * - CSV/CSVWithNames - Common interchange format
 * - JSONEachRow - JSON lines format (essential for JS interop)
 * - JSON - Full JSON output
 * - JSONCompact - Compact JSON arrays
 * - JSONColumns - Columnar JSON
 * - Values - SQL VALUES format
 * - Vertical - Pretty output
 * - Pretty/PrettyCompact/PrettySpace - Human readable
 * - Markdown - Documentation friendly
 * - XML - Standard interchange
 *
 * Native formats (consider keeping):
 * - Native - ClickHouse native binary (efficient, simple structure)
 * - RowBinary - Simple row-based binary
 * - RowBinaryWithNames - RowBinary with schema
 *
 * Null format:
 * - Null - Discards output, useful for testing
 *
 * Usage:
 * ======
 * Define USE_WASM_STUBS to enable these stub implementations.
 */

#ifdef USE_WASM_STUBS

#include <stdexcept>
#include <string>
#include <vector>
#include <cstdint>

namespace DB
{

// Error codes
namespace ErrorCodes
{
    extern const int NOT_IMPLEMENTED;
    extern const int SUPPORT_IS_DISABLED;
    extern const int FORMAT_IS_NOT_SUITABLE_FOR_INPUT;
    extern const int FORMAT_IS_NOT_SUITABLE_FOR_OUTPUT;
}

// If not already defined
#ifndef WASM_NOT_SUPPORTED
class Exception : public std::runtime_error
{
public:
    Exception(int code, const std::string& message)
        : std::runtime_error(message), error_code(code) {}
    int code() const { return error_code; }
private:
    int error_code;
};
#endif

/**
 * Helper macro for format not-supported exceptions
 */
#define WASM_FORMAT_NOT_SUPPORTED(format_name, reason) \
    throw Exception(ErrorCodes::NOT_IMPLEMENTED, \
        "Format '" + std::string(format_name) + "' is not supported in WASM build. " \
        "Reason: " + std::string(reason) + ". " \
        "Supported formats: TabSeparated, CSV, JSON, JSONEachRow, Values, Pretty, Native, RowBinary.")


// ============================================================================
// Base interfaces for formats
// ============================================================================

/**
 * Mock IInputFormat interface (simplified)
 * Real version: src/Processors/Formats/IInputFormat.h
 */
class IInputFormat
{
public:
    virtual ~IInputFormat() = default;
    virtual std::string getName() const = 0;
    virtual void read() = 0;
};

/**
 * Mock IOutputFormat interface (simplified)
 * Real version: src/Processors/Formats/IOutputFormat.h
 */
class IOutputFormat
{
public:
    virtual ~IOutputFormat() = default;
    virtual std::string getName() const = 0;
    virtual void write() = 0;
    virtual void finalize() {}
};


// ============================================================================
// Parquet Format Stubs
// ============================================================================

/**
 * ParquetBlockInputFormat - Apache Parquet columnar format reader
 *
 * Stubbed because:
 * - Requires Apache Arrow library (~15MB compiled)
 * - Complex columnar decoding with compression
 * - Heavy memory requirements for column buffers
 * - Would significantly increase WASM module size
 *
 * Alternative: Convert Parquet to JSON/CSV before loading into WASM
 */

class ParquetBlockInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Parquet"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Parquet",
            "Requires Apache Arrow library (~15MB). "
            "Convert Parquet to JSON or CSV before loading into WASM, "
            "or use JavaScript libraries like parquet-wasm for client-side parsing");
    }
};

class ParquetBlockOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Parquet"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Parquet",
            "Requires Apache Arrow library (~15MB). "
            "Export as JSON or CSV and convert to Parquet outside WASM");
    }
};


// ============================================================================
// ORC Format Stubs
// ============================================================================

/**
 * ORCBlockInputFormat - Apache ORC columnar format
 *
 * Stubbed because:
 * - Requires ORC C++ library
 * - Complex columnar format with multiple compression codecs
 * - Significant library size
 */

class ORCBlockInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "ORC"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("ORC",
            "Requires ORC library with complex compression support. "
            "Convert ORC to JSON or CSV for WASM processing");
    }
};

class ORCBlockOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "ORC"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("ORC",
            "Requires ORC library. Export as JSON or CSV instead");
    }
};


// ============================================================================
// Arrow Format Stubs
// ============================================================================

/**
 * ArrowBlockInputFormat - Apache Arrow IPC format
 *
 * Stubbed because:
 * - Requires Apache Arrow library (~15MB)
 * - Complex IPC protocol
 *
 * Note: Arrow is actually a good fit for WASM in theory (zero-copy),
 * but the library size is prohibitive. Consider arrow-js for JS interop.
 */

class ArrowBlockInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Arrow"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Arrow",
            "Requires Apache Arrow library (~15MB). "
            "Consider using arrow-js in JavaScript for Arrow interop, "
            "then passing data to WASM as JSON or typed arrays");
    }
};

class ArrowBlockOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Arrow"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Arrow",
            "Requires Apache Arrow library (~15MB). "
            "Export as JSON and use arrow-js if Arrow format is needed");
    }
};

class ArrowStreamBlockInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "ArrowStream"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("ArrowStream",
            "Requires Apache Arrow library (~15MB)");
    }
};

class ArrowStreamBlockOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "ArrowStream"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("ArrowStream",
            "Requires Apache Arrow library (~15MB)");
    }
};


// ============================================================================
// Avro Format Stubs
// ============================================================================

/**
 * AvroRowInputFormat - Apache Avro format
 *
 * Stubbed because:
 * - Requires Avro C++ library
 * - Schema registry integration
 * - Complex schema evolution handling
 */

class AvroRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Avro"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Avro",
            "Requires Avro library and schema handling. "
            "Convert Avro to JSON before WASM processing");
    }
};

class AvroRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Avro"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Avro",
            "Requires Avro library. Export as JSON instead");
    }
};


// ============================================================================
// Cap'n Proto Format Stubs
// ============================================================================

/**
 * CapnProtoRowInputFormat - Cap'n Proto serialization format
 *
 * Stubbed because:
 * - Requires Cap'n Proto library
 * - Schema compilation needed
 */

class CapnProtoRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "CapnProto"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("CapnProto",
            "Requires Cap'n Proto library. Convert to JSON for WASM processing");
    }
};

class CapnProtoRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "CapnProto"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("CapnProto",
            "Requires Cap'n Proto library. Export as JSON instead");
    }
};


// ============================================================================
// Protocol Buffers Format Stubs
// ============================================================================

/**
 * ProtobufRowInputFormat - Google Protocol Buffers format
 *
 * Stubbed because:
 * - Requires Protobuf library (~5MB)
 * - Schema (proto files) compilation
 * - Dynamic message handling
 */

class ProtobufRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Protobuf"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Protobuf",
            "Requires Protocol Buffers library (~5MB). "
            "Consider using protobuf-js and converting to JSON for WASM");
    }
};

class ProtobufRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Protobuf"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Protobuf",
            "Requires Protocol Buffers library (~5MB). Export as JSON instead");
    }
};

class ProtobufSingleRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "ProtobufSingle"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("ProtobufSingle",
            "Requires Protocol Buffers library (~5MB)");
    }
};


// ============================================================================
// MsgPack Format Stubs
// ============================================================================

/**
 * MsgPackRowInputFormat - MessagePack binary format
 *
 * Stubbed because:
 * - Requires MsgPack library
 * - Though small, adds complexity
 *
 * Note: MsgPack could potentially be enabled as it's relatively lightweight.
 * Stubbed for initial WASM build to minimize size.
 */

class MsgPackRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "MsgPack"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("MsgPack",
            "Requires MsgPack library. Use JSON for similar functionality");
    }
};

class MsgPackRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "MsgPack"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("MsgPack",
            "Requires MsgPack library. Use JSON or JSONCompact instead");
    }
};


// ============================================================================
// MySQL Format Stubs
// ============================================================================

/**
 * MySQLDumpInputFormat - MySQL dump format
 *
 * Stubbed because:
 * - Complex MySQL SQL dialect parsing
 * - Heavy parser requirements
 */

class MySQLDumpInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "MySQLDump"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("MySQLDump",
            "Complex MySQL dialect parsing. "
            "Convert MySQL dump to CSV or JSON before WASM processing");
    }
};

class MySQLOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "MySQL"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("MySQL",
            "MySQL wire protocol format not supported. Use TabSeparated or JSON");
    }
};


// ============================================================================
// Template Format Stubs
// ============================================================================

/**
 * TemplateRowInputFormat - Template-based parsing
 *
 * Stubbed because:
 * - Complex template expression evaluation
 * - User-defined format strings require dynamic parsing
 */

class TemplateRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Template"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Template",
            "Complex template parsing. Use CSV with custom separator settings");
    }
};

class TemplateRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Template"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Template",
            "Complex template formatting. Use CSV or JSON and post-process");
    }
};


// ============================================================================
// Regexp Format Stubs
// ============================================================================

/**
 * RegexpRowInputFormat - Regex-based parsing
 *
 * Stubbed because:
 * - Requires full regex engine
 * - Complex pattern matching
 * - Potential performance issues with bad patterns
 *
 * Note: Simple regex support in match() function is kept.
 * This is for complex multi-capture group parsing.
 */

class RegexpRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "Regexp"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Regexp",
            "Complex regex parsing. Pre-process with regex in JavaScript, "
            "then load structured data into WASM");
    }
};


// ============================================================================
// Image Output Format Stubs
// ============================================================================

/**
 * PNGOutputFormat - PNG image output (for heatmaps, etc.)
 *
 * Stubbed because:
 * - Requires libpng or similar
 * - Image encoding is heavyweight
 */

class PNGOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "PNG"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("PNG",
            "Image encoding requires libpng. "
            "Export data as JSON and render images in JavaScript using Canvas API");
    }
};


// ============================================================================
// BSON Format Stubs
// ============================================================================

/**
 * BSONRowInputFormat - Binary JSON (MongoDB format)
 *
 * Stubbed because:
 * - Requires BSON library
 * - MongoDB-specific optimizations
 */

class BSONRowInputFormat : public IInputFormat
{
public:
    std::string getName() const override { return "BSONEachRow"; }

    void read() override
    {
        WASM_FORMAT_NOT_SUPPORTED("BSONEachRow",
            "Requires BSON library. Convert BSON to JSON before WASM processing");
    }
};

class BSONRowOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "BSONEachRow"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("BSONEachRow",
            "Requires BSON library. Use JSONEachRow instead");
    }
};


// ============================================================================
// Npy Format Stubs (NumPy)
// ============================================================================

/**
 * NpyOutputFormat - NumPy array format
 *
 * Stubbed because:
 * - Specialized NumPy format
 * - Limited use outside Python ecosystem
 */

class NpyOutputFormat : public IOutputFormat
{
public:
    std::string getName() const override { return "Npy"; }

    void write() override
    {
        WASM_FORMAT_NOT_SUPPORTED("Npy",
            "NumPy format. Export as JSON and convert to NumPy in Python, "
            "or use JavaScript typed arrays for similar functionality");
    }
};


// ============================================================================
// Format Information
// ============================================================================

/**
 * Complete list of stubbed formats
 */
static const std::vector<std::string> STUBBED_INPUT_FORMATS = {
    "Parquet",
    "ORC",
    "Arrow",
    "ArrowStream",
    "Avro",
    "CapnProto",
    "Protobuf",
    "ProtobufSingle",
    "ProtobufList",
    "MsgPack",
    "MySQLDump",
    "Template",
    "TemplateIgnoreSpaces",
    "Regexp",
    "BSONEachRow",
    "LineAsString",  // Could potentially be kept, stubbed for simplicity
};

static const std::vector<std::string> STUBBED_OUTPUT_FORMATS = {
    "Parquet",
    "ORC",
    "Arrow",
    "ArrowStream",
    "Avro",
    "CapnProto",
    "Protobuf",
    "ProtobufSingle",
    "MsgPack",
    "MySQL",
    "PostgreSQLWire",
    "Template",
    "BSONEachRow",
    "Npy",
    "PNG",
};

/**
 * Supported input formats in WASM build
 */
static const std::vector<std::string> SUPPORTED_INPUT_FORMATS = {
    // Tab-separated
    "TabSeparated",
    "TabSeparatedRaw",
    "TabSeparatedWithNames",
    "TabSeparatedWithNamesAndTypes",
    "TSV",
    "TSVRaw",
    "TSVWithNames",
    "TSVWithNamesAndTypes",

    // CSV
    "CSV",
    "CSVWithNames",
    "CSVWithNamesAndTypes",

    // JSON
    "JSON",
    "JSONAsString",
    "JSONAsObject",
    "JSONColumns",
    "JSONColumnsWithMetadata",
    "JSONCompact",
    "JSONCompactColumns",
    "JSONEachRow",
    "JSONStringsEachRow",
    "JSONCompactEachRow",
    "JSONCompactEachRowWithNames",
    "JSONCompactEachRowWithNamesAndTypes",
    "JSONCompactStringsEachRow",
    "JSONCompactStringsEachRowWithNames",
    "JSONCompactStringsEachRowWithNamesAndTypes",
    "JSONObjectEachRow",

    // Values
    "Values",

    // Native binary
    "Native",
    "RowBinary",
    "RowBinaryWithNames",
    "RowBinaryWithNamesAndTypes",

    // Other text formats
    "CustomSeparated",
    "CustomSeparatedWithNames",
    "CustomSeparatedWithNamesAndTypes",
};

/**
 * Supported output formats in WASM build
 */
static const std::vector<std::string> SUPPORTED_OUTPUT_FORMATS = {
    // Tab-separated
    "TabSeparated",
    "TabSeparatedRaw",
    "TabSeparatedWithNames",
    "TabSeparatedWithNamesAndTypes",
    "TSV",
    "TSVRaw",
    "TSVWithNames",
    "TSVWithNamesAndTypes",

    // CSV
    "CSV",
    "CSVWithNames",
    "CSVWithNamesAndTypes",

    // JSON
    "JSON",
    "JSONColumns",
    "JSONColumnsWithMetadata",
    "JSONCompact",
    "JSONCompactColumns",
    "JSONEachRow",
    "JSONStringsEachRow",
    "JSONCompactEachRow",
    "JSONCompactEachRowWithNames",
    "JSONCompactEachRowWithNamesAndTypes",
    "JSONCompactStringsEachRow",
    "JSONCompactStringsEachRowWithNames",
    "JSONCompactStringsEachRowWithNamesAndTypes",
    "JSONObjectEachRow",
    "JSONStrings",
    "JSONCompactStrings",

    // Values
    "Values",

    // Native binary
    "Native",
    "RowBinary",
    "RowBinaryWithNames",
    "RowBinaryWithNamesAndTypes",

    // Pretty print
    "Pretty",
    "PrettyCompact",
    "PrettyCompactMonoBlock",
    "PrettyNoEscapes",
    "PrettyCompactNoEscapes",
    "PrettySpace",
    "PrettySpaceNoEscapes",

    // Other text formats
    "CustomSeparated",
    "CustomSeparatedWithNames",
    "CustomSeparatedWithNamesAndTypes",
    "Markdown",
    "Vertical",
    "XML",
    "Null",

    // SQL
    "SQLInsert",
};


/**
 * Check if a format is stubbed (not supported) in WASM build
 */
bool isInputFormatStubbedInWasm(const std::string& name)
{
    for (const auto& stubbed : STUBBED_INPUT_FORMATS)
    {
        if (stubbed == name) return true;
    }
    return false;
}

bool isOutputFormatStubbedInWasm(const std::string& name)
{
    for (const auto& stubbed : STUBBED_OUTPUT_FORMATS)
    {
        if (stubbed == name) return true;
    }
    return false;
}


/**
 * Get list of supported formats (for introspection)
 */
const std::vector<std::string>& getSupportedInputFormats()
{
    return SUPPORTED_INPUT_FORMATS;
}

const std::vector<std::string>& getSupportedOutputFormats()
{
    return SUPPORTED_OUTPUT_FORMATS;
}


/**
 * Register all stubbed formats with the format factory.
 * Call this during WASM module initialization.
 */
void registerWasmFormatStubs()
{
    // In real implementation, would register with FormatFactory
    // FormatFactory::instance().registerInputFormat("Parquet", ...);
    // etc.
}

} // namespace DB

#endif // USE_WASM_STUBS
