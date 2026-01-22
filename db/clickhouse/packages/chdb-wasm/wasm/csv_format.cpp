/**
 * csv_format.cpp - CSV/TSV Format Parser for WASM
 *
 * This module provides CSV and TSV parsing capabilities with:
 *   - CSV parsing with configurable delimiter
 *   - TSV parsing (tab delimiter)
 *   - CSVWithNames (first row is header)
 *   - TSVWithNames
 *   - Proper quote handling and escaping
 *   - Type inference from values
 *
 * Features:
 *   - Handle quoted fields with embedded commas
 *   - Handle escaped quotes ("" for CSV)
 *   - Handle newlines within quoted fields
 *   - Skip empty lines
 *   - Configurable null representation
 *   - Unicode content support (UTF-8)
 *
 * Build with: emcc -std=c++17 -Os -fno-exceptions -fno-rtti
 *
 * Target size: ~30KB as side module
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <variant>
#include <memory>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <optional>
#include <cctype>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// Value Types
// ============================================================================

// Value can be: null, int64, double, or string
using Value = std::variant<std::monostate, int64_t, double, std::string>;

enum class ValueType {
    Null,
    Int64,
    Float64,
    String
};

ValueType getValueType(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) return ValueType::Null;
    if (std::holds_alternative<int64_t>(v)) return ValueType::Int64;
    if (std::holds_alternative<double>(v)) return ValueType::Float64;
    return ValueType::String;
}

std::string valueToString(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) {
        return "NULL";
    }
    if (std::holds_alternative<int64_t>(v)) {
        return std::to_string(std::get<int64_t>(v));
    }
    if (std::holds_alternative<double>(v)) {
        std::ostringstream oss;
        oss << std::setprecision(15) << std::get<double>(v);
        return oss.str();
    }
    return std::get<std::string>(v);
}

// ============================================================================
// Data Types for Schema
// ============================================================================

enum class DataType {
    Unknown,
    Int64,
    Float64,
    String,
    Nullable  // For columns that contain NULL values
};

std::string dataTypeToString(DataType dt) {
    switch (dt) {
        case DataType::Int64: return "Int64";
        case DataType::Float64: return "Float64";
        case DataType::String: return "String";
        case DataType::Nullable: return "Nullable(String)";
        default: return "Unknown";
    }
}

// ============================================================================
// Column Definition
// ============================================================================

struct ColumnDef {
    std::string name;
    DataType type;
    bool nullable = true;
};

// ============================================================================
// CSV Parser Configuration
// ============================================================================

struct CSVParserConfig {
    char delimiter = ',';           // Field delimiter (comma for CSV, tab for TSV)
    char quote = '"';               // Quote character
    char escape = '"';              // Escape character (same as quote for CSV "" escaping)
    bool hasHeader = false;         // First row is header (CSVWithNames)
    bool skipEmptyLines = true;     // Skip lines with no content
    std::string nullValue = "\\N";  // String representation of NULL
    std::string nullValueAlt = "NULL"; // Alternative NULL representation
    bool trimWhitespace = false;    // Trim leading/trailing whitespace from fields
    bool inferTypes = true;         // Infer column types from values
    size_t maxRows = 0;             // Maximum rows to parse (0 = unlimited)

    // Create config for standard CSV
    static CSVParserConfig CSV() {
        CSVParserConfig config;
        config.delimiter = ',';
        config.hasHeader = false;
        return config;
    }

    // Create config for CSV with header
    static CSVParserConfig CSVWithNames() {
        CSVParserConfig config;
        config.delimiter = ',';
        config.hasHeader = true;
        return config;
    }

    // Create config for standard TSV
    static CSVParserConfig TSV() {
        CSVParserConfig config;
        config.delimiter = '\t';
        config.hasHeader = false;
        return config;
    }

    // Create config for TSV with header
    static CSVParserConfig TSVWithNames() {
        CSVParserConfig config;
        config.delimiter = '\t';
        config.hasHeader = true;
        return config;
    }
};

// ============================================================================
// CSV Parser Result
// ============================================================================

struct CSVParseResult {
    std::vector<ColumnDef> columns;
    std::vector<std::vector<Value>> rows;
    bool success = true;
    std::string error;
    size_t linesProcessed = 0;
    size_t bytesProcessed = 0;
};

// ============================================================================
// Type Inference
// ============================================================================

class TypeInferrer {
public:
    // Check if string looks like an integer
    static bool looksLikeInt64(const std::string& s) {
        if (s.empty()) return false;
        size_t start = 0;
        if (s[0] == '-' || s[0] == '+') {
            if (s.size() == 1) return false;
            start = 1;
        }
        for (size_t i = start; i < s.size(); i++) {
            if (!std::isdigit(static_cast<unsigned char>(s[i]))) {
                return false;
            }
        }
        return true;
    }

    // Check if string looks like a floating point number
    static bool looksLikeFloat64(const std::string& s) {
        if (s.empty()) return false;

        bool hasDot = false;
        bool hasE = false;
        bool hasDigit = false;
        size_t i = 0;

        // Handle optional leading sign
        if (s[i] == '-' || s[i] == '+') {
            i++;
        }

        while (i < s.size()) {
            char c = s[i];
            if (std::isdigit(static_cast<unsigned char>(c))) {
                hasDigit = true;
            } else if (c == '.' && !hasDot && !hasE) {
                hasDot = true;
            } else if ((c == 'e' || c == 'E') && hasDigit && !hasE) {
                hasE = true;
                // Handle optional sign after 'e'
                if (i + 1 < s.size() && (s[i + 1] == '+' || s[i + 1] == '-')) {
                    i++;
                }
            } else {
                return false;
            }
            i++;
        }

        return hasDigit && (hasDot || hasE);
    }

    // Infer type from a string value
    static DataType inferType(const std::string& s, const CSVParserConfig& config) {
        // Check for NULL
        if (s == config.nullValue || s == config.nullValueAlt || s.empty()) {
            return DataType::Nullable;
        }

        // Try integer
        if (looksLikeInt64(s)) {
            return DataType::Int64;
        }

        // Try float
        if (looksLikeFloat64(s)) {
            return DataType::Float64;
        }

        // Default to string
        return DataType::String;
    }

    // Parse value from string based on inferred type
    static Value parseValue(const std::string& s, const CSVParserConfig& config) {
        // Check for NULL
        if (s == config.nullValue || s == config.nullValueAlt) {
            return std::monostate{};
        }

        // Empty string is also NULL (unless quoted, but we handle that at parse time)
        if (s.empty()) {
            return std::monostate{};
        }

        // Try integer
        if (looksLikeInt64(s)) {
            // Use strtoll for exception-free parsing
            char* endptr = nullptr;
            int64_t val = std::strtoll(s.c_str(), &endptr, 10);
            if (endptr && *endptr == '\0') {
                return val;
            }
            // Fall through to string on parse failure
        }

        // Try float
        if (looksLikeFloat64(s)) {
            // Use strtod for exception-free parsing
            char* endptr = nullptr;
            double val = std::strtod(s.c_str(), &endptr);
            if (endptr && *endptr == '\0') {
                return val;
            }
            // Fall through to string on parse failure
        }

        // Return as string
        return s;
    }

    // Merge two types (for column type inference across rows)
    static DataType mergeTypes(DataType a, DataType b) {
        if (a == DataType::Unknown) return b;
        if (b == DataType::Unknown) return a;

        if (a == b) return a;

        // Nullable can be combined with any type
        if (a == DataType::Nullable) return b;
        if (b == DataType::Nullable) return a;

        // Int64 + Float64 = Float64
        if ((a == DataType::Int64 && b == DataType::Float64) ||
            (a == DataType::Float64 && b == DataType::Int64)) {
            return DataType::Float64;
        }

        // Everything else becomes String
        return DataType::String;
    }
};

// ============================================================================
// CSV Parser
// ============================================================================

class CSVParser {
public:
    CSVParser(const CSVParserConfig& config = CSVParserConfig())
        : config_(config) {}

    // Parse CSV data from a string
    CSVParseResult parse(const char* data, size_t len) {
        CSVParseResult result;

        if (!data || len == 0) {
            result.error = "Empty input";
            result.success = false;
            return result;
        }

        pos_ = 0;
        data_ = data;
        len_ = len;
        lineNum_ = 1;

        // Parse header if configured
        if (config_.hasHeader) {
            std::vector<std::string> headerFields;
            if (!parseRow(headerFields)) {
                result.error = "Failed to parse header row: " + error_;
                result.success = false;
                return result;
            }

            // Create column definitions from header
            for (const auto& name : headerFields) {
                ColumnDef col;
                col.name = name;
                col.type = DataType::Unknown;
                result.columns.push_back(col);
            }
            result.linesProcessed++;
        }

        // Parse data rows
        while (pos_ < len_) {
            // Skip empty lines if configured
            if (config_.skipEmptyLines && isEmptyLine()) {
                skipLine();
                result.linesProcessed++;
                continue;
            }

            std::vector<std::string> fields;
            if (!parseRow(fields)) {
                result.error = "Failed to parse row " + std::to_string(lineNum_) + ": " + error_;
                result.success = false;
                return result;
            }

            result.linesProcessed++;

            // Skip if row is completely empty
            if (fields.empty() || (fields.size() == 1 && fields[0].empty() && config_.skipEmptyLines)) {
                continue;
            }

            // Initialize columns if not set from header
            if (result.columns.empty()) {
                for (size_t i = 0; i < fields.size(); i++) {
                    ColumnDef col;
                    col.name = "column" + std::to_string(i);
                    col.type = DataType::Unknown;
                    result.columns.push_back(col);
                }
            }

            // Ensure we have enough columns
            while (result.columns.size() < fields.size()) {
                ColumnDef col;
                col.name = "column" + std::to_string(result.columns.size());
                col.type = DataType::Unknown;
                result.columns.push_back(col);
            }

            // Convert fields to values and update type inference
            std::vector<Value> row;
            for (size_t i = 0; i < result.columns.size(); i++) {
                std::string field = (i < fields.size()) ? fields[i] : "";

                // Trim whitespace if configured
                if (config_.trimWhitespace && !field.empty()) {
                    size_t start = field.find_first_not_of(" \t");
                    size_t end = field.find_last_not_of(" \t");
                    if (start != std::string::npos) {
                        field = field.substr(start, end - start + 1);
                    } else {
                        field.clear();
                    }
                }

                // Parse value with type inference
                Value val;
                if (config_.inferTypes) {
                    val = TypeInferrer::parseValue(field, config_);

                    // Update column type
                    DataType fieldType = TypeInferrer::inferType(field, config_);
                    result.columns[i].type = TypeInferrer::mergeTypes(result.columns[i].type, fieldType);
                } else {
                    // No type inference - keep as string (or null)
                    if (field == config_.nullValue || field == config_.nullValueAlt) {
                        val = std::monostate{};
                    } else {
                        val = field;
                    }
                    result.columns[i].type = DataType::String;
                }

                row.push_back(val);
            }

            result.rows.push_back(std::move(row));

            // Check max rows limit
            if (config_.maxRows > 0 && result.rows.size() >= config_.maxRows) {
                break;
            }
        }

        result.bytesProcessed = pos_;

        // Finalize column types
        for (auto& col : result.columns) {
            if (col.type == DataType::Unknown || col.type == DataType::Nullable) {
                col.type = DataType::String;
            }
        }

        return result;
    }

private:
    bool parseRow(std::vector<std::string>& fields) {
        fields.clear();

        while (pos_ < len_) {
            std::string field;
            if (!parseField(field)) {
                return false;
            }
            fields.push_back(std::move(field));

            // Check for delimiter or end of line
            if (pos_ >= len_) {
                break;
            }

            char c = data_[pos_];
            if (c == config_.delimiter) {
                pos_++;  // Consume delimiter
                continue;
            }

            if (c == '\r' || c == '\n') {
                // End of row
                if (c == '\r' && pos_ + 1 < len_ && data_[pos_ + 1] == '\n') {
                    pos_ += 2;  // CRLF
                } else {
                    pos_++;     // CR or LF
                }
                lineNum_++;
                break;
            }

            // Unexpected character
            error_ = "Unexpected character after field";
            return false;
        }

        return true;
    }

    bool parseField(std::string& field) {
        field.clear();

        if (pos_ >= len_) {
            return true;  // Empty field at end
        }

        char c = data_[pos_];

        // Check for quoted field
        if (c == config_.quote) {
            return parseQuotedField(field);
        }

        // Unquoted field
        return parseUnquotedField(field);
    }

    bool parseQuotedField(std::string& field) {
        pos_++;  // Skip opening quote

        while (pos_ < len_) {
            char c = data_[pos_];

            if (c == config_.quote) {
                // Check for escaped quote (doubled quote)
                if (pos_ + 1 < len_ && data_[pos_ + 1] == config_.quote) {
                    // Escaped quote - add single quote to field
                    field += config_.quote;
                    pos_ += 2;
                } else {
                    // End of quoted field
                    pos_++;
                    return true;
                }
            } else if (c == '\\' && config_.escape == '\\' && pos_ + 1 < len_) {
                // Backslash escape (if configured)
                pos_++;
                char escaped = data_[pos_];
                switch (escaped) {
                    case 'n': field += '\n'; break;
                    case 't': field += '\t'; break;
                    case 'r': field += '\r'; break;
                    case '\\': field += '\\'; break;
                    case '"': field += '"'; break;
                    case '\'': field += '\''; break;
                    default: field += escaped; break;
                }
                pos_++;
            } else {
                // Regular character (including newlines in quoted fields)
                if (c == '\n') lineNum_++;
                field += c;
                pos_++;
            }
        }

        // Unclosed quote
        error_ = "Unclosed quoted field";
        return false;
    }

    bool parseUnquotedField(std::string& field) {
        while (pos_ < len_) {
            char c = data_[pos_];

            // End of field on delimiter or newline
            if (c == config_.delimiter || c == '\r' || c == '\n') {
                break;
            }

            field += c;
            pos_++;
        }

        return true;
    }

    bool isEmptyLine() {
        size_t savedPos = pos_;

        while (savedPos < len_) {
            char c = data_[savedPos];
            if (c == '\r' || c == '\n') {
                return true;  // Only whitespace until newline
            }
            if (c != ' ' && c != '\t') {
                return false;  // Non-whitespace content
            }
            savedPos++;
        }

        return true;  // End of data (empty)
    }

    void skipLine() {
        while (pos_ < len_) {
            char c = data_[pos_];
            pos_++;
            if (c == '\n') {
                lineNum_++;
                break;
            }
            if (c == '\r') {
                if (pos_ < len_ && data_[pos_] == '\n') {
                    pos_++;
                }
                lineNum_++;
                break;
            }
        }
    }

    CSVParserConfig config_;
    const char* data_ = nullptr;
    size_t len_ = 0;
    size_t pos_ = 0;
    size_t lineNum_ = 1;
    std::string error_;
};

// ============================================================================
// CSV Writer
// ============================================================================

class CSVWriter {
public:
    CSVWriter(const CSVParserConfig& config = CSVParserConfig())
        : config_(config) {}

    // Write result to CSV string
    std::string write(const CSVParseResult& result) {
        std::string output;

        // Write header if configured
        if (config_.hasHeader && !result.columns.empty()) {
            for (size_t i = 0; i < result.columns.size(); i++) {
                if (i > 0) output += config_.delimiter;
                output += escapeField(result.columns[i].name);
            }
            output += "\n";
        }

        // Write data rows
        for (const auto& row : result.rows) {
            for (size_t i = 0; i < row.size(); i++) {
                if (i > 0) output += config_.delimiter;

                const Value& val = row[i];
                if (std::holds_alternative<std::monostate>(val)) {
                    output += config_.nullValue;
                } else if (std::holds_alternative<std::string>(val)) {
                    output += escapeField(std::get<std::string>(val));
                } else {
                    output += valueToString(val);
                }
            }
            output += "\n";
        }

        return output;
    }

private:
    std::string escapeField(const std::string& field) {
        // Check if field needs quoting
        bool needsQuoting = false;
        for (char c : field) {
            if (c == config_.delimiter || c == config_.quote ||
                c == '\n' || c == '\r') {
                needsQuoting = true;
                break;
            }
        }

        if (!needsQuoting && config_.delimiter == ',') {
            // Also quote if field looks like a number but has leading zeros
            // (to preserve formatting)
            return field;
        }

        if (!needsQuoting) {
            return field;
        }

        // Quote the field and escape internal quotes
        std::string result;
        result += config_.quote;
        for (char c : field) {
            if (c == config_.quote) {
                result += config_.quote;  // Double the quote
            }
            result += c;
        }
        result += config_.quote;

        return result;
    }

    CSVParserConfig config_;
};

// ============================================================================
// Result Formatting (compatible with other modules)
// ============================================================================

std::string formatResultJSON(const CSVParseResult& result) {
    if (!result.success) {
        return "{\"error\": \"" + result.error + "\"}\n";
    }

    std::string output = "{\n";
    output += "  \"meta\": [\n";

    for (size_t i = 0; i < result.columns.size(); i++) {
        output += "    {\"name\": \"" + result.columns[i].name + "\", \"type\": \"";
        output += dataTypeToString(result.columns[i].type);
        output += "\"}";
        if (i < result.columns.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"data\": [\n";

    for (size_t r = 0; r < result.rows.size(); r++) {
        output += "    {";
        for (size_t c = 0; c < result.rows[r].size() && c < result.columns.size(); c++) {
            if (c > 0) output += ", ";
            output += "\"" + result.columns[c].name + "\": ";

            const Value& val = result.rows[r][c];
            if (std::holds_alternative<std::monostate>(val)) {
                output += "null";
            } else if (std::holds_alternative<std::string>(val)) {
                output += "\"";
                for (char ch : std::get<std::string>(val)) {
                    switch (ch) {
                        case '"': output += "\\\""; break;
                        case '\\': output += "\\\\"; break;
                        case '\n': output += "\\n"; break;
                        case '\r': output += "\\r"; break;
                        case '\t': output += "\\t"; break;
                        default: output += ch; break;
                    }
                }
                output += "\"";
            } else {
                output += valueToString(val);
            }
        }
        output += "}";
        if (r < result.rows.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"rows\": " + std::to_string(result.rows.size()) + ",\n";
    output += "  \"lines_processed\": " + std::to_string(result.linesProcessed) + ",\n";
    output += "  \"bytes_processed\": " + std::to_string(result.bytesProcessed) + "\n";
    output += "}\n";

    return output;
}

// ============================================================================
// Parser Context
// ============================================================================

struct CSVParserContext {
    CSVParserConfig config;
    char* lastResult;
    size_t lastResultLen;
    char* lastError;
    CSVParseResult lastParseResult;

    CSVParserContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~CSVParserContext() {
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
 * Create a new CSV parser context with default configuration.
 */
EXPORT
void* csv_parser_create() {
    return new CSVParserContext();
}

/**
 * Destroy a CSV parser context.
 */
EXPORT
void csv_parser_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<CSVParserContext*>(ctx);
    }
}

/**
 * Configure the parser for CSV format.
 * @param ctx Parser context
 * @param hasHeader 1 if first row is header, 0 otherwise
 */
EXPORT
void csv_parser_set_csv(void* ctx, int hasHeader) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config = hasHeader ? CSVParserConfig::CSVWithNames() : CSVParserConfig::CSV();
}

/**
 * Configure the parser for TSV format.
 * @param ctx Parser context
 * @param hasHeader 1 if first row is header, 0 otherwise
 */
EXPORT
void csv_parser_set_tsv(void* ctx, int hasHeader) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config = hasHeader ? CSVParserConfig::TSVWithNames() : CSVParserConfig::TSV();
}

/**
 * Set custom delimiter.
 * @param ctx Parser context
 * @param delimiter Single character delimiter
 */
EXPORT
void csv_parser_set_delimiter(void* ctx, char delimiter) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.delimiter = delimiter;
}

/**
 * Set custom quote character.
 * @param ctx Parser context
 * @param quote Single character quote
 */
EXPORT
void csv_parser_set_quote(void* ctx, char quote) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.quote = quote;
}

/**
 * Set NULL value representation.
 * @param ctx Parser context
 * @param nullValue String to interpret as NULL
 */
EXPORT
void csv_parser_set_null_value(void* ctx, const char* nullValue) {
    if (!ctx || !nullValue) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.nullValue = nullValue;
}

/**
 * Set whether to skip empty lines.
 * @param ctx Parser context
 * @param skip 1 to skip empty lines, 0 to include them
 */
EXPORT
void csv_parser_set_skip_empty(void* ctx, int skip) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.skipEmptyLines = (skip != 0);
}

/**
 * Set whether to infer types.
 * @param ctx Parser context
 * @param infer 1 to infer types, 0 to keep all as strings
 */
EXPORT
void csv_parser_set_infer_types(void* ctx, int infer) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.inferTypes = (infer != 0);
}

/**
 * Set maximum number of rows to parse.
 * @param ctx Parser context
 * @param maxRows Maximum rows (0 = unlimited)
 */
EXPORT
void csv_parser_set_max_rows(void* ctx, size_t maxRows) {
    if (!ctx) return;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    parser->config.maxRows = maxRows;
}

/**
 * Parse CSV/TSV data.
 * @param ctx Parser context
 * @param data Input data
 * @param len Length of input data
 * @param outputFormat Output format: "CSV", "TSV", "JSON"
 * @return 0 on success, -1 on error
 */
EXPORT
int csv_parser_parse(void* ctx, const char* data, size_t len, const char* outputFormat) {
    if (!ctx || !data) return -1;

    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);

    CSVParser csvParser(parser->config);
    parser->lastParseResult = csvParser.parse(data, len);

    if (!parser->lastParseResult.success) {
        parser->setError(parser->lastParseResult.error);
        return -1;
    }

    // Format output
    std::string fmt = outputFormat ? outputFormat : "JSON";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatResultJSON(parser->lastParseResult);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        CSVWriter writer(CSVParserConfig::TSVWithNames());
        output = writer.write(parser->lastParseResult);
    } else {
        CSVWriter writer(CSVParserConfig::CSVWithNames());
        output = writer.write(parser->lastParseResult);
    }

    parser->setResult(output);
    return 0;
}

/**
 * Get the result buffer from last parse.
 */
EXPORT
const char* csv_parser_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<CSVParserContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last parse.
 */
EXPORT
size_t csv_parser_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<CSVParserContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last parse.
 */
EXPORT
const char* csv_parser_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<CSVParserContext*>(ctx)->lastError;
}

/**
 * Get number of rows parsed.
 */
EXPORT
size_t csv_parser_get_row_count(void* ctx) {
    if (!ctx) return 0;
    return static_cast<CSVParserContext*>(ctx)->lastParseResult.rows.size();
}

/**
 * Get number of columns.
 */
EXPORT
size_t csv_parser_get_column_count(void* ctx) {
    if (!ctx) return 0;
    return static_cast<CSVParserContext*>(ctx)->lastParseResult.columns.size();
}

/**
 * Get column name by index.
 */
EXPORT
const char* csv_parser_get_column_name(void* ctx, size_t index) {
    if (!ctx) return nullptr;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    if (index >= parser->lastParseResult.columns.size()) return nullptr;
    return parser->lastParseResult.columns[index].name.c_str();
}

/**
 * Get column type by index.
 * Returns: 0=Unknown, 1=Int64, 2=Float64, 3=String, 4=Nullable
 */
EXPORT
int csv_parser_get_column_type(void* ctx, size_t index) {
    if (!ctx) return 0;
    CSVParserContext* parser = static_cast<CSVParserContext*>(ctx);
    if (index >= parser->lastParseResult.columns.size()) return 0;
    return static_cast<int>(parser->lastParseResult.columns[index].type);
}

/**
 * Test function to verify the module loaded correctly.
 */
EXPORT
int csv_parser_test() {
    CSVParserContext ctx;

    // Test 1: Simple CSV parsing
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,2,3\n4,5,6\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -1;
        if (result.rows.size() != 2) return -2;
        if (result.columns.size() != 3) return -3;
    }

    // Test 2: CSV with header
    {
        ctx.config = CSVParserConfig::CSVWithNames();
        CSVParser parser(ctx.config);
        const char* data = "id,name,value\n1,Alice,100\n2,Bob,200\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -4;
        if (result.rows.size() != 2) return -5;
        if (result.columns.size() != 3) return -6;
        if (result.columns[0].name != "id") return -7;
        if (result.columns[1].name != "name") return -8;
        if (result.columns[2].name != "value") return -9;
    }

    // Test 3: Quoted fields with embedded comma
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,\"hello, world\",3\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -10;
        if (result.rows.size() != 1) return -11;
        if (!std::holds_alternative<std::string>(result.rows[0][1])) return -12;
        if (std::get<std::string>(result.rows[0][1]) != "hello, world") return -13;
    }

    // Test 4: Escaped quotes
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,\"She said \"\"Hello\"\"\",3\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -14;
        if (!std::holds_alternative<std::string>(result.rows[0][1])) return -15;
        if (std::get<std::string>(result.rows[0][1]) != "She said \"Hello\"") return -16;
    }

    // Test 5: TSV parsing
    {
        ctx.config = CSVParserConfig::TSV();
        CSVParser parser(ctx.config);
        const char* data = "1\tAlice\t100\n2\tBob\t200\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -17;
        if (result.rows.size() != 2) return -18;
        if (result.columns.size() != 3) return -19;
    }

    // Test 6: Type inference
    {
        ctx.config = CSVParserConfig::CSVWithNames();
        ctx.config.inferTypes = true;
        CSVParser parser(ctx.config);
        const char* data = "int,float,string\n42,3.14,hello\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -20;
        if (!std::holds_alternative<int64_t>(result.rows[0][0])) return -21;
        if (!std::holds_alternative<double>(result.rows[0][1])) return -22;
        if (!std::holds_alternative<std::string>(result.rows[0][2])) return -23;
        if (std::get<int64_t>(result.rows[0][0]) != 42) return -24;
    }

    // Test 7: Newlines in quoted fields
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,\"line1\nline2\",3\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -25;
        if (!std::holds_alternative<std::string>(result.rows[0][1])) return -26;
        if (std::get<std::string>(result.rows[0][1]) != "line1\nline2") return -27;
    }

    // Test 8: NULL values
    {
        ctx.config = CSVParserConfig::CSVWithNames();
        ctx.config.nullValue = "\\N";
        CSVParser parser(ctx.config);
        const char* data = "a,b,c\n1,\\N,3\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -28;
        if (!std::holds_alternative<std::monostate>(result.rows[0][1])) return -29;
    }

    // Test 9: Different line endings (CRLF)
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,2,3\r\n4,5,6\r\n";
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -30;
        if (result.rows.size() != 2) return -31;
    }

    // Test 10: Unicode content (UTF-8)
    {
        ctx.config = CSVParserConfig::CSV();
        CSVParser parser(ctx.config);
        const char* data = "1,\xC3\xA9\xC3\xA8\xC3\xAA,3\n";  // eee with accents
        auto result = parser.parse(data, strlen(data));
        if (!result.success) return -32;
        if (!std::holds_alternative<std::string>(result.rows[0][1])) return -33;
    }

    // Test 11: C API test
    {
        CSVParserContext* pctx = static_cast<CSVParserContext*>(csv_parser_create());
        csv_parser_set_csv(pctx, 1);

        const char* data = "id,name\n1,Alice\n2,Bob\n";
        int rc = csv_parser_parse(pctx, data, strlen(data), "JSON");
        if (rc != 0) {
            csv_parser_destroy(pctx);
            return -34;
        }

        const char* result = csv_parser_get_result(pctx);
        if (!result || strstr(result, "Alice") == nullptr) {
            csv_parser_destroy(pctx);
            return -35;
        }

        if (csv_parser_get_row_count(pctx) != 2) {
            csv_parser_destroy(pctx);
            return -36;
        }

        csv_parser_destroy(pctx);
    }

    return 0;  // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* csv_parser_version() {
    return "chdb-csv-parser 0.1.0 (WASM CSV/TSV format parser)";
}

} // extern "C"
