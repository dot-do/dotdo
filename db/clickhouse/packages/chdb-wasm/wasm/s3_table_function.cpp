/**
 * s3_table_function.cpp - S3/R2 Table Function for WASM
 *
 * Implements an S3/R2 compatible table function for querying remote storage.
 * This module calls JavaScript for actual HTTP requests, supporting:
 * - R2 URLs (r2://bucket/path)
 * - S3 URLs (s3://bucket/path)
 * - HTTPS URLs (https://...)
 * - Presigned URLs
 * - Glob patterns (*.parquet, data_*.json)
 * - HTTP range requests for partial reads
 *
 * Supported query patterns:
 *   SELECT * FROM s3('r2://bucket/data.json', 'JSON')
 *   SELECT * FROM s3('s3://bucket/logs/*.json', 'JSONEachRow')
 *   SELECT col1, col2 FROM s3('r2://bucket/data.parquet', 'Parquet')
 *   SELECT * FROM s3('https://...', 'access_key', 'secret_key', 'JSON')
 *
 * Build with: emcc -std=c++17 -Os -fno-exceptions
 *
 * Target size: ~60KB as side module
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
#include <unordered_map>
#include <algorithm>
#include <functional>
#include <regex>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// JavaScript Interop - Called from WASM, implemented in JavaScript
// ============================================================================

#ifdef __EMSCRIPTEN__

// These functions are implemented in JavaScript and called from WASM
// They handle actual HTTP requests since WASM cannot do network I/O directly

extern "C" {
    // Fetch a URL and return the content
    // Returns: pointer to data (caller must free), or nullptr on error
    // Sets *out_len to the length of the data
    // Sets *out_error to error message (if any, caller must free)
    extern int js_s3_fetch(
        const char* url,
        size_t url_len,
        const char* access_key,
        size_t access_key_len,
        const char* secret_key,
        size_t secret_key_len,
        int64_t range_start,
        int64_t range_end,
        char** out_data,
        size_t* out_len,
        char** out_error
    );

    // List objects matching a glob pattern
    // Returns: JSON array of URLs, caller must free
    extern int js_s3_list(
        const char* url_pattern,
        size_t url_len,
        const char* access_key,
        size_t access_key_len,
        const char* secret_key,
        size_t secret_key_len,
        char** out_urls_json,
        size_t* out_len,
        char** out_error
    );

    // Get file size without downloading
    extern int js_s3_head(
        const char* url,
        size_t url_len,
        const char* access_key,
        size_t access_key_len,
        const char* secret_key,
        size_t secret_key_len,
        int64_t* out_size,
        char** out_error
    );
}

#else
// Stub implementations for non-WASM builds (for testing)
extern "C" {
    int js_s3_fetch(const char*, size_t, const char*, size_t, const char*, size_t,
                    int64_t, int64_t, char**, size_t*, char**) { return -1; }
    int js_s3_list(const char*, size_t, const char*, size_t, const char*, size_t,
                   char**, size_t*, char**) { return -1; }
    int js_s3_head(const char*, size_t, const char*, size_t, const char*, size_t,
                   int64_t*, char**) { return -1; }
}
#endif

// ============================================================================
// Value Types
// ============================================================================

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
    Int8, Int16, Int32, Int64,
    UInt8, UInt16, UInt32, UInt64,
    Float32, Float64,
    String,
    Boolean,
    Date, DateTime,
    Unknown
};

std::string dataTypeToString(DataType dt) {
    switch (dt) {
        case DataType::Int8: return "Int8";
        case DataType::Int16: return "Int16";
        case DataType::Int32: return "Int32";
        case DataType::Int64: return "Int64";
        case DataType::UInt8: return "UInt8";
        case DataType::UInt16: return "UInt16";
        case DataType::UInt32: return "UInt32";
        case DataType::UInt64: return "UInt64";
        case DataType::Float32: return "Float32";
        case DataType::Float64: return "Float64";
        case DataType::String: return "String";
        case DataType::Boolean: return "Bool";
        case DataType::Date: return "Date";
        case DataType::DateTime: return "DateTime";
        default: return "Unknown";
    }
}

DataType stringToDataType(const std::string& s) {
    std::string upper = s;
    for (char& c : upper) c = toupper(c);

    if (upper == "INT8" || upper == "TINYINT") return DataType::Int8;
    if (upper == "INT16" || upper == "SMALLINT") return DataType::Int16;
    if (upper == "INT32" || upper == "INT" || upper == "INTEGER") return DataType::Int32;
    if (upper == "INT64" || upper == "BIGINT") return DataType::Int64;
    if (upper == "UINT8") return DataType::UInt8;
    if (upper == "UINT16") return DataType::UInt16;
    if (upper == "UINT32") return DataType::UInt32;
    if (upper == "UINT64") return DataType::UInt64;
    if (upper == "FLOAT32" || upper == "FLOAT") return DataType::Float32;
    if (upper == "FLOAT64" || upper == "DOUBLE") return DataType::Float64;
    if (upper == "STRING" || upper == "VARCHAR" || upper == "TEXT") return DataType::String;
    if (upper == "BOOL" || upper == "BOOLEAN") return DataType::Boolean;
    if (upper == "DATE") return DataType::Date;
    if (upper == "DATETIME" || upper == "TIMESTAMP") return DataType::DateTime;
    return DataType::Unknown;
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
// Row Type
// ============================================================================

using Row = std::vector<Value>;

// ============================================================================
// S3 URL Parser
// ============================================================================

struct S3Url {
    std::string scheme;       // "s3", "r2", "https"
    std::string bucket;
    std::string region;       // optional, defaults to "auto"
    std::string key;          // path within bucket
    std::string endpoint;     // for custom S3-compatible endpoints
    bool hasGlob = false;     // true if key contains glob patterns

    std::string toHttpUrl() const {
        if (scheme == "https" || scheme == "http") {
            // Already an HTTP URL
            return scheme + "://" + bucket + "/" + key;
        }

        if (scheme == "r2") {
            // Cloudflare R2 URL format
            // For Workers with R2 bindings, this will be resolved by JS
            return "r2://" + bucket + "/" + key;
        }

        // S3 URL
        if (!endpoint.empty()) {
            return endpoint + "/" + bucket + "/" + key;
        }

        // Default AWS S3 endpoint
        std::string reg = region.empty() ? "us-east-1" : region;
        return "https://" + bucket + ".s3." + reg + ".amazonaws.com/" + key;
    }
};

S3Url parseS3Url(const std::string& url) {
    S3Url result;

    size_t schemeEnd = url.find("://");
    if (schemeEnd == std::string::npos) {
        // Assume it's an S3 path without scheme
        result.scheme = "s3";
        size_t firstSlash = url.find('/');
        if (firstSlash != std::string::npos) {
            result.bucket = url.substr(0, firstSlash);
            result.key = url.substr(firstSlash + 1);
        } else {
            result.bucket = url;
        }
    } else {
        result.scheme = url.substr(0, schemeEnd);
        std::string rest = url.substr(schemeEnd + 3);

        // Convert scheme to lowercase
        for (char& c : result.scheme) c = tolower(c);

        if (result.scheme == "https" || result.scheme == "http") {
            // Full HTTP URL
            size_t firstSlash = rest.find('/');
            if (firstSlash != std::string::npos) {
                result.bucket = rest.substr(0, firstSlash);  // Actually the host
                result.key = rest.substr(firstSlash + 1);
            } else {
                result.bucket = rest;
            }
        } else {
            // S3 or R2 URL
            size_t firstSlash = rest.find('/');
            if (firstSlash != std::string::npos) {
                result.bucket = rest.substr(0, firstSlash);
                result.key = rest.substr(firstSlash + 1);
            } else {
                result.bucket = rest;
            }
        }
    }

    // Check for glob patterns
    result.hasGlob = (result.key.find('*') != std::string::npos ||
                      result.key.find('?') != std::string::npos ||
                      result.key.find('[') != std::string::npos);

    return result;
}

// ============================================================================
// Glob Pattern Matching
// ============================================================================

bool globMatch(const std::string& pattern, const std::string& text) {
    size_t p = 0, t = 0;
    size_t starP = std::string::npos, starT = 0;

    while (t < text.size()) {
        if (p < pattern.size() && (pattern[p] == '?' || pattern[p] == text[t])) {
            p++;
            t++;
        } else if (p < pattern.size() && pattern[p] == '*') {
            starP = p++;
            starT = t;
        } else if (starP != std::string::npos) {
            p = starP + 1;
            t = ++starT;
        } else {
            return false;
        }
    }

    while (p < pattern.size() && pattern[p] == '*') {
        p++;
    }

    return p == pattern.size();
}

// Convert glob pattern to regex pattern
std::string globToRegex(const std::string& glob) {
    std::string regex;
    regex.reserve(glob.size() * 2);

    for (char c : glob) {
        switch (c) {
            case '*': regex += ".*"; break;
            case '?': regex += "."; break;
            case '.': regex += "\\."; break;
            case '[': regex += "["; break;
            case ']': regex += "]"; break;
            case '\\': regex += "\\\\"; break;
            case '^': regex += "\\^"; break;
            case '$': regex += "\\$"; break;
            case '+': regex += "\\+"; break;
            case '|': regex += "\\|"; break;
            case '(': regex += "\\("; break;
            case ')': regex += "\\)"; break;
            case '{': regex += "\\{"; break;
            case '}': regex += "\\}"; break;
            default: regex += c; break;
        }
    }

    return regex;
}

// ============================================================================
// Format Parsers
// ============================================================================

enum class FileFormat {
    JSON,
    JSONEachRow,
    CSV,
    TSV,
    Parquet,
    Unknown
};

FileFormat parseFormat(const std::string& fmt) {
    std::string upper = fmt;
    for (char& c : upper) c = toupper(c);

    if (upper == "JSON") return FileFormat::JSON;
    if (upper == "JSONEACHROW" || upper == "NDJSON" || upper == "JSONL") return FileFormat::JSONEachRow;
    if (upper == "CSV" || upper == "CSVWITHNAMES") return FileFormat::CSV;
    if (upper == "TSV" || upper == "TSVWITHNAMES" || upper == "TABSEPARATED") return FileFormat::TSV;
    if (upper == "PARQUET") return FileFormat::Parquet;

    return FileFormat::Unknown;
}

std::string formatToString(FileFormat fmt) {
    switch (fmt) {
        case FileFormat::JSON: return "JSON";
        case FileFormat::JSONEachRow: return "JSONEachRow";
        case FileFormat::CSV: return "CSV";
        case FileFormat::TSV: return "TSV";
        case FileFormat::Parquet: return "Parquet";
        default: return "Unknown";
    }
}

// ============================================================================
// Simple JSON Parser (for parsing fetched data)
// ============================================================================

class SimpleJSONParser {
public:
    struct JSONValue;
    using JSONObject = std::unordered_map<std::string, std::shared_ptr<JSONValue>>;
    using JSONArray = std::vector<std::shared_ptr<JSONValue>>;

    struct JSONValue {
        enum Type { Null, Bool, Number, String, Array, Object } type;
        bool boolVal;
        double numberVal;
        std::string stringVal;
        JSONArray arrayVal;
        JSONObject objectVal;

        JSONValue() : type(Null), boolVal(false), numberVal(0) {}
    };

    using JSONValuePtr = std::shared_ptr<JSONValue>;

    SimpleJSONParser(const char* data, size_t len)
        : data_(data), len_(len), pos_(0) {}

    JSONValuePtr parse() {
        skipWhitespace();
        return parseValue();
    }

    std::string getError() const { return error_; }

private:
    void skipWhitespace() {
        while (pos_ < len_ && isspace(data_[pos_])) pos_++;
    }

    char peek() {
        return pos_ < len_ ? data_[pos_] : '\0';
    }

    char advance() {
        return pos_ < len_ ? data_[pos_++] : '\0';
    }

    JSONValuePtr parseValue() {
        skipWhitespace();
        char c = peek();

        if (c == '"') return parseString();
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n') return parseNull();
        if (c == '-' || isdigit(c)) return parseNumber();

        error_ = "Unexpected character: " + std::string(1, c);
        return nullptr;
    }

    JSONValuePtr parseString() {
        advance(); // skip opening quote
        std::string str;

        while (pos_ < len_) {
            char c = advance();
            if (c == '"') {
                auto val = std::make_shared<JSONValue>();
                val->type = JSONValue::String;
                val->stringVal = str;
                return val;
            }
            if (c == '\\' && pos_ < len_) {
                char escaped = advance();
                switch (escaped) {
                    case 'n': str += '\n'; break;
                    case 't': str += '\t'; break;
                    case 'r': str += '\r'; break;
                    case '"': str += '"'; break;
                    case '\\': str += '\\'; break;
                    case '/': str += '/'; break;
                    case 'u': {
                        // Parse Unicode escape
                        if (pos_ + 4 <= len_) {
                            std::string hex(data_ + pos_, 4);
                            pos_ += 4;
                            int codepoint = std::stoi(hex, nullptr, 16);
                            if (codepoint < 0x80) {
                                str += static_cast<char>(codepoint);
                            } else if (codepoint < 0x800) {
                                str += static_cast<char>(0xC0 | (codepoint >> 6));
                                str += static_cast<char>(0x80 | (codepoint & 0x3F));
                            } else {
                                str += static_cast<char>(0xE0 | (codepoint >> 12));
                                str += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
                                str += static_cast<char>(0x80 | (codepoint & 0x3F));
                            }
                        }
                        break;
                    }
                    default: str += escaped; break;
                }
            } else {
                str += c;
            }
        }

        error_ = "Unterminated string";
        return nullptr;
    }

    JSONValuePtr parseNumber() {
        size_t start = pos_;
        if (peek() == '-') advance();

        while (pos_ < len_ && isdigit(data_[pos_])) advance();

        if (pos_ < len_ && data_[pos_] == '.') {
            advance();
            while (pos_ < len_ && isdigit(data_[pos_])) advance();
        }

        if (pos_ < len_ && (data_[pos_] == 'e' || data_[pos_] == 'E')) {
            advance();
            if (pos_ < len_ && (data_[pos_] == '+' || data_[pos_] == '-')) advance();
            while (pos_ < len_ && isdigit(data_[pos_])) advance();
        }

        std::string numStr(data_ + start, pos_ - start);
        auto val = std::make_shared<JSONValue>();
        val->type = JSONValue::Number;
        val->numberVal = std::stod(numStr);
        return val;
    }

    JSONValuePtr parseBool() {
        if (pos_ + 4 <= len_ && strncmp(data_ + pos_, "true", 4) == 0) {
            pos_ += 4;
            auto val = std::make_shared<JSONValue>();
            val->type = JSONValue::Bool;
            val->boolVal = true;
            return val;
        }
        if (pos_ + 5 <= len_ && strncmp(data_ + pos_, "false", 5) == 0) {
            pos_ += 5;
            auto val = std::make_shared<JSONValue>();
            val->type = JSONValue::Bool;
            val->boolVal = false;
            return val;
        }
        error_ = "Invalid boolean";
        return nullptr;
    }

    JSONValuePtr parseNull() {
        if (pos_ + 4 <= len_ && strncmp(data_ + pos_, "null", 4) == 0) {
            pos_ += 4;
            auto val = std::make_shared<JSONValue>();
            val->type = JSONValue::Null;
            return val;
        }
        error_ = "Invalid null";
        return nullptr;
    }

    JSONValuePtr parseArray() {
        advance(); // skip '['
        auto val = std::make_shared<JSONValue>();
        val->type = JSONValue::Array;

        skipWhitespace();
        if (peek() == ']') {
            advance();
            return val;
        }

        while (true) {
            auto elem = parseValue();
            if (!elem) return nullptr;
            val->arrayVal.push_back(elem);

            skipWhitespace();
            if (peek() == ']') {
                advance();
                return val;
            }
            if (peek() != ',') {
                error_ = "Expected ',' or ']' in array";
                return nullptr;
            }
            advance();
        }
    }

    JSONValuePtr parseObject() {
        advance(); // skip '{'
        auto val = std::make_shared<JSONValue>();
        val->type = JSONValue::Object;

        skipWhitespace();
        if (peek() == '}') {
            advance();
            return val;
        }

        while (true) {
            skipWhitespace();
            if (peek() != '"') {
                error_ = "Expected string key in object";
                return nullptr;
            }

            auto keyVal = parseString();
            if (!keyVal) return nullptr;
            std::string key = keyVal->stringVal;

            skipWhitespace();
            if (peek() != ':') {
                error_ = "Expected ':' after key";
                return nullptr;
            }
            advance();

            auto value = parseValue();
            if (!value) return nullptr;
            val->objectVal[key] = value;

            skipWhitespace();
            if (peek() == '}') {
                advance();
                return val;
            }
            if (peek() != ',') {
                error_ = "Expected ',' or '}' in object";
                return nullptr;
            }
            advance();
        }
    }

    const char* data_;
    size_t len_;
    size_t pos_;
    std::string error_;
};

// ============================================================================
// Data Reader - Reads and parses data from S3
// ============================================================================

class S3DataReader {
public:
    struct ReadResult {
        std::vector<ColumnDef> columns;
        std::vector<Row> rows;
        bool success = true;
        std::string error;
    };

    ReadResult read(
        const std::string& url,
        FileFormat format,
        const std::string& accessKey,
        const std::string& secretKey,
        const std::vector<ColumnDef>& structure = {}
    ) {
        ReadResult result;

        // Parse the URL
        S3Url s3url = parseS3Url(url);

        // If the URL has a glob pattern, we need to list and read multiple files
        if (s3url.hasGlob) {
            return readGlob(s3url, format, accessKey, secretKey, structure);
        }

        // Single file read
        return readSingle(s3url.toHttpUrl(), format, accessKey, secretKey, structure);
    }

private:
    ReadResult readSingle(
        const std::string& httpUrl,
        FileFormat format,
        const std::string& accessKey,
        const std::string& secretKey,
        const std::vector<ColumnDef>& structure
    ) {
        ReadResult result;

        // Fetch the data from JavaScript
        char* data = nullptr;
        size_t dataLen = 0;
        char* errorMsg = nullptr;

        int rc = js_s3_fetch(
            httpUrl.c_str(), httpUrl.size(),
            accessKey.c_str(), accessKey.size(),
            secretKey.c_str(), secretKey.size(),
            -1, -1,  // No range request
            &data, &dataLen, &errorMsg
        );

        if (rc != 0 || data == nullptr) {
            result.success = false;
            result.error = errorMsg ? std::string(errorMsg) : "Failed to fetch data from " + httpUrl;
            if (errorMsg) free(errorMsg);
            return result;
        }

        // Parse based on format
        switch (format) {
            case FileFormat::JSON:
                result = parseJSON(data, dataLen, structure);
                break;
            case FileFormat::JSONEachRow:
                result = parseJSONEachRow(data, dataLen, structure);
                break;
            case FileFormat::CSV:
                result = parseCSV(data, dataLen, structure, ',');
                break;
            case FileFormat::TSV:
                result = parseCSV(data, dataLen, structure, '\t');
                break;
            case FileFormat::Parquet:
                result.success = false;
                result.error = "Parquet format not yet implemented in WASM";
                break;
            default:
                result.success = false;
                result.error = "Unknown format";
                break;
        }

        free(data);
        return result;
    }

    ReadResult readGlob(
        const S3Url& s3url,
        FileFormat format,
        const std::string& accessKey,
        const std::string& secretKey,
        const std::vector<ColumnDef>& structure
    ) {
        ReadResult result;

        // List matching files via JavaScript
        char* urlsJson = nullptr;
        size_t urlsLen = 0;
        char* errorMsg = nullptr;

        std::string fullUrl = s3url.toHttpUrl();

        int rc = js_s3_list(
            fullUrl.c_str(), fullUrl.size(),
            accessKey.c_str(), accessKey.size(),
            secretKey.c_str(), secretKey.size(),
            &urlsJson, &urlsLen, &errorMsg
        );

        if (rc != 0 || urlsJson == nullptr) {
            result.success = false;
            result.error = errorMsg ? std::string(errorMsg) : "Failed to list files matching pattern";
            if (errorMsg) free(errorMsg);
            return result;
        }

        // Parse the JSON array of URLs
        SimpleJSONParser parser(urlsJson, urlsLen);
        auto urls = parser.parse();
        free(urlsJson);

        if (!urls || urls->type != SimpleJSONParser::JSONValue::Array) {
            result.success = false;
            result.error = "Invalid URL list response";
            return result;
        }

        // Read each file
        bool firstFile = true;
        for (const auto& urlVal : urls->arrayVal) {
            if (urlVal->type != SimpleJSONParser::JSONValue::String) continue;

            ReadResult fileResult = readSingle(
                urlVal->stringVal, format, accessKey, secretKey,
                firstFile ? structure : result.columns
            );

            if (!fileResult.success) {
                // Skip failed files but log warning
                continue;
            }

            if (firstFile) {
                result.columns = fileResult.columns;
                firstFile = false;
            }

            // Append rows
            for (auto& row : fileResult.rows) {
                result.rows.push_back(std::move(row));
            }
        }

        return result;
    }

    ReadResult parseJSON(const char* data, size_t len, const std::vector<ColumnDef>& structure) {
        ReadResult result;

        SimpleJSONParser parser(data, len);
        auto root = parser.parse();

        if (!root) {
            result.success = false;
            result.error = "JSON parse error: " + parser.getError();
            return result;
        }

        // Handle array of objects or single object
        std::vector<SimpleJSONParser::JSONValuePtr> objects;

        if (root->type == SimpleJSONParser::JSONValue::Array) {
            objects = root->arrayVal;
        } else if (root->type == SimpleJSONParser::JSONValue::Object) {
            // Check if it's a ClickHouse JSON format with "data" array
            auto it = root->objectVal.find("data");
            if (it != root->objectVal.end() && it->second->type == SimpleJSONParser::JSONValue::Array) {
                objects = it->second->arrayVal;
            } else {
                objects.push_back(root);
            }
        }

        // Infer schema from first object if no structure provided
        if (structure.empty() && !objects.empty() &&
            objects[0]->type == SimpleJSONParser::JSONValue::Object) {
            for (const auto& [key, val] : objects[0]->objectVal) {
                ColumnDef col;
                col.name = key;
                col.type = inferTypeFromJSON(val);
                result.columns.push_back(col);
            }
        } else {
            result.columns = structure;
        }

        // Convert objects to rows
        for (const auto& obj : objects) {
            if (obj->type != SimpleJSONParser::JSONValue::Object) continue;

            Row row;
            for (const auto& col : result.columns) {
                auto it = obj->objectVal.find(col.name);
                if (it != obj->objectVal.end()) {
                    row.push_back(jsonToValue(it->second));
                } else {
                    row.push_back(std::monostate{});
                }
            }
            result.rows.push_back(std::move(row));
        }

        return result;
    }

    ReadResult parseJSONEachRow(const char* data, size_t len, const std::vector<ColumnDef>& structure) {
        ReadResult result;

        // Split by newlines and parse each line as JSON
        size_t start = 0;
        bool firstRow = true;

        for (size_t i = 0; i <= len; i++) {
            if (i == len || data[i] == '\n') {
                if (i > start) {
                    SimpleJSONParser parser(data + start, i - start);
                    auto obj = parser.parse();

                    if (obj && obj->type == SimpleJSONParser::JSONValue::Object) {
                        // Infer schema from first row
                        if (firstRow) {
                            if (structure.empty()) {
                                for (const auto& [key, val] : obj->objectVal) {
                                    ColumnDef col;
                                    col.name = key;
                                    col.type = inferTypeFromJSON(val);
                                    result.columns.push_back(col);
                                }
                            } else {
                                result.columns = structure;
                            }
                            firstRow = false;
                        }

                        Row row;
                        for (const auto& col : result.columns) {
                            auto it = obj->objectVal.find(col.name);
                            if (it != obj->objectVal.end()) {
                                row.push_back(jsonToValue(it->second));
                            } else {
                                row.push_back(std::monostate{});
                            }
                        }
                        result.rows.push_back(std::move(row));
                    }
                }
                start = i + 1;
            }
        }

        return result;
    }

    ReadResult parseCSV(const char* data, size_t len, const std::vector<ColumnDef>& structure, char delimiter) {
        ReadResult result;

        std::vector<std::vector<std::string>> lines;
        std::vector<std::string> currentLine;
        std::string currentField;
        bool inQuotes = false;

        for (size_t i = 0; i <= len; i++) {
            char c = (i < len) ? data[i] : '\n';

            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < len && data[i + 1] == '"') {
                        currentField += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    currentField += c;
                }
            } else {
                if (c == '"') {
                    inQuotes = true;
                } else if (c == delimiter) {
                    currentLine.push_back(currentField);
                    currentField.clear();
                } else if (c == '\n' || c == '\r') {
                    if (!currentField.empty() || !currentLine.empty()) {
                        currentLine.push_back(currentField);
                        if (!currentLine.empty()) {
                            lines.push_back(currentLine);
                        }
                        currentLine.clear();
                        currentField.clear();
                    }
                    // Skip \r\n sequence
                    if (c == '\r' && i + 1 < len && data[i + 1] == '\n') {
                        i++;
                    }
                } else {
                    currentField += c;
                }
            }
        }

        if (lines.empty()) {
            return result;
        }

        // First line is header (for CSVWithNames/TSVWithNames)
        std::vector<std::string>& header = lines[0];

        // Build columns
        if (structure.empty()) {
            for (const auto& name : header) {
                ColumnDef col;
                col.name = name;
                col.type = DataType::String;  // Default to string, could infer
                result.columns.push_back(col);
            }
        } else {
            result.columns = structure;
        }

        // Parse data rows
        for (size_t r = 1; r < lines.size(); r++) {
            Row row;
            const auto& line = lines[r];

            for (size_t c = 0; c < result.columns.size(); c++) {
                if (c < line.size()) {
                    row.push_back(parseCSVValue(line[c], result.columns[c].type));
                } else {
                    row.push_back(std::monostate{});
                }
            }
            result.rows.push_back(std::move(row));
        }

        return result;
    }

    DataType inferTypeFromJSON(const SimpleJSONParser::JSONValuePtr& val) {
        if (!val) return DataType::Unknown;

        switch (val->type) {
            case SimpleJSONParser::JSONValue::Null:
                return DataType::Unknown;
            case SimpleJSONParser::JSONValue::Bool:
                return DataType::Boolean;
            case SimpleJSONParser::JSONValue::Number:
                // Check if it's an integer
                if (val->numberVal == std::floor(val->numberVal) &&
                    val->numberVal >= INT64_MIN && val->numberVal <= INT64_MAX) {
                    return DataType::Int64;
                }
                return DataType::Float64;
            case SimpleJSONParser::JSONValue::String:
                return DataType::String;
            default:
                return DataType::String;
        }
    }

    Value jsonToValue(const SimpleJSONParser::JSONValuePtr& val) {
        if (!val) return std::monostate{};

        switch (val->type) {
            case SimpleJSONParser::JSONValue::Null:
                return std::monostate{};
            case SimpleJSONParser::JSONValue::Bool:
                return int64_t{val->boolVal ? 1 : 0};
            case SimpleJSONParser::JSONValue::Number:
                if (val->numberVal == std::floor(val->numberVal) &&
                    val->numberVal >= INT64_MIN && val->numberVal <= INT64_MAX) {
                    return static_cast<int64_t>(val->numberVal);
                }
                return val->numberVal;
            case SimpleJSONParser::JSONValue::String:
                return val->stringVal;
            default:
                // For arrays/objects, convert to JSON string
                return val->stringVal;  // Simplified
        }
    }

    Value parseCSVValue(const std::string& str, DataType type) {
        if (str.empty() || str == "NULL" || str == "\\N") {
            return std::monostate{};
        }

        switch (type) {
            case DataType::Int8:
            case DataType::Int16:
            case DataType::Int32:
            case DataType::Int64:
            case DataType::UInt8:
            case DataType::UInt16:
            case DataType::UInt32:
            case DataType::UInt64:
                return static_cast<int64_t>(std::stoll(str));
            case DataType::Float32:
            case DataType::Float64:
                return std::stod(str);
            case DataType::Boolean:
                return int64_t{str == "true" || str == "1" ? 1 : 0};
            default:
                return str;
        }
    }
};

// ============================================================================
// S3 Table Function Arguments Parser
// ============================================================================

struct S3TableFunctionArgs {
    std::string url;
    std::string accessKey;
    std::string secretKey;
    std::string format;
    std::vector<ColumnDef> structure;
    bool valid = false;
    std::string error;
};

S3TableFunctionArgs parseS3Args(const std::string& argsStr) {
    S3TableFunctionArgs result;

    // Parse arguments: s3(url, [access_key, secret_key,] format, [structure])
    // Arguments are comma-separated, strings are quoted

    std::vector<std::string> args;
    std::string current;
    bool inQuotes = false;
    int parenDepth = 0;

    for (size_t i = 0; i < argsStr.size(); i++) {
        char c = argsStr[i];

        if (inQuotes) {
            if (c == '\'' || c == '"') {
                inQuotes = false;
            } else {
                current += c;
            }
        } else {
            if (c == '\'' || c == '"') {
                inQuotes = true;
            } else if (c == '(') {
                parenDepth++;
                current += c;
            } else if (c == ')') {
                if (parenDepth > 0) {
                    parenDepth--;
                    current += c;
                }
            } else if (c == ',' && parenDepth == 0) {
                // Trim whitespace
                size_t start = current.find_first_not_of(" \t\n");
                size_t end = current.find_last_not_of(" \t\n");
                if (start != std::string::npos) {
                    args.push_back(current.substr(start, end - start + 1));
                } else {
                    args.push_back("");
                }
                current.clear();
            } else {
                current += c;
            }
        }
    }

    // Add last argument
    size_t start = current.find_first_not_of(" \t\n");
    size_t end = current.find_last_not_of(" \t\n");
    if (start != std::string::npos) {
        args.push_back(current.substr(start, end - start + 1));
    }

    // Validate argument count
    if (args.empty()) {
        result.error = "s3() requires at least a URL argument";
        return result;
    }

    result.url = args[0];

    // Parse remaining arguments based on count
    // s3(url, format)
    // s3(url, access_key, secret_key, format)
    // s3(url, format, structure)
    // s3(url, access_key, secret_key, format, structure)

    if (args.size() == 2) {
        // s3(url, format)
        result.format = args[1];
    } else if (args.size() == 3) {
        // s3(url, format, structure) - structure is like 'col1 Type, col2 Type'
        result.format = args[1];
        // Parse structure - simplified for now
    } else if (args.size() == 4) {
        // s3(url, access_key, secret_key, format)
        result.accessKey = args[1];
        result.secretKey = args[2];
        result.format = args[3];
    } else if (args.size() >= 5) {
        // s3(url, access_key, secret_key, format, structure)
        result.accessKey = args[1];
        result.secretKey = args[2];
        result.format = args[3];
        // Parse structure
    }

    result.valid = true;
    return result;
}

// ============================================================================
// Query Result Structure
// ============================================================================

struct S3QueryResult {
    std::vector<ColumnDef> columns;
    std::vector<Row> rows;
    std::string message;
    bool success = true;
    std::string error;
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatResultCSV(const S3QueryResult& result) {
    if (!result.success) {
        return "Error: " + result.error + "\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return result.message + "\n";
    }

    std::string output;

    // Header row
    for (size_t i = 0; i < result.columns.size(); i++) {
        if (i > 0) output += ",";
        output += "\"" + result.columns[i].name + "\"";
    }
    output += "\n";

    // Data rows
    for (const auto& row : result.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) output += ",";
            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                std::string s = std::get<std::string>(row[i]);
                output += "\"";
                for (char c : s) {
                    if (c == '"') output += "\"\"";
                    else output += c;
                }
                output += "\"";
            } else {
                output += valueToString(row[i]);
            }
        }
        output += "\n";
    }

    return output;
}

std::string formatResultTSV(const S3QueryResult& result) {
    if (!result.success) {
        return "Error: " + result.error + "\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return result.message + "\n";
    }

    std::string output;

    // Header row
    for (size_t i = 0; i < result.columns.size(); i++) {
        if (i > 0) output += "\t";
        output += result.columns[i].name;
    }
    output += "\n";

    // Data rows
    for (const auto& row : result.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) output += "\t";
            output += valueToString(row[i]);
        }
        output += "\n";
    }

    return output;
}

std::string formatResultJSON(const S3QueryResult& result) {
    if (!result.success) {
        return "{\"error\": \"" + result.error + "\"}\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return "{\"message\": \"" + result.message + "\"}\n";
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
        for (size_t c = 0; c < result.rows[r].size(); c++) {
            if (c > 0) output += ", ";
            output += "\"" + result.columns[c].name + "\": ";
            ValueType t = getValueType(result.rows[r][c]);
            if (t == ValueType::String) {
                output += "\"";
                for (char ch : std::get<std::string>(result.rows[r][c])) {
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
            } else if (t == ValueType::Null) {
                output += "null";
            } else {
                output += valueToString(result.rows[r][c]);
            }
        }
        output += "}";
        if (r < result.rows.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"rows\": " + std::to_string(result.rows.size()) + ",\n";
    output += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(result.rows.size()) + ", \"bytes_read\": 0}\n";
    output += "}\n";

    return output;
}

// ============================================================================
// S3 Context
// ============================================================================

struct S3Context {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;

    S3Context() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~S3Context() {
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
 * Create a new S3 context.
 */
EXPORT
void* s3_create() {
    return new S3Context();
}

/**
 * Destroy an S3 context.
 */
EXPORT
void s3_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<S3Context*>(ctx);
    }
}

/**
 * Execute an S3 table function query.
 *
 * @param ctx S3 context
 * @param url The S3/R2 URL (s3://bucket/key, r2://bucket/key, or https://...)
 * @param url_len Length of URL
 * @param access_key Optional access key (can be null)
 * @param access_key_len Length of access key
 * @param secret_key Optional secret key (can be null)
 * @param secret_key_len Length of secret key
 * @param format Data format: JSON, JSONEachRow, CSV, TSV, Parquet
 * @param format_len Length of format string
 * @param output_format Output format: CSV, TSV, JSON
 * @return 0 on success, -1 on error
 */
EXPORT
int s3_query(
    void* ctx,
    const char* url, size_t url_len,
    const char* access_key, size_t access_key_len,
    const char* secret_key, size_t secret_key_len,
    const char* format, size_t format_len,
    const char* output_format
) {
    if (!ctx || !url || !format) return -1;

    S3Context* s3ctx = static_cast<S3Context*>(ctx);

    std::string urlStr(url, url_len);
    std::string accessKeyStr = access_key ? std::string(access_key, access_key_len) : "";
    std::string secretKeyStr = secret_key ? std::string(secret_key, secret_key_len) : "";
    std::string formatStr(format, format_len);

    FileFormat fileFormat = parseFormat(formatStr);
    if (fileFormat == FileFormat::Unknown) {
        s3ctx->setError("Unknown format: " + formatStr);
        return -1;
    }

    // Read data from S3
    S3DataReader reader;
    auto readResult = reader.read(urlStr, fileFormat, accessKeyStr, secretKeyStr);

    if (!readResult.success) {
        s3ctx->setError(readResult.error);
        return -1;
    }

    // Format output
    S3QueryResult result;
    result.columns = std::move(readResult.columns);
    result.rows = std::move(readResult.rows);

    std::string fmt = output_format ? output_format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatResultJSON(result);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        output = formatResultTSV(result);
    } else {
        output = formatResultCSV(result);
    }

    s3ctx->setResult(output);
    return 0;
}

/**
 * Execute an S3 query with parsed arguments string.
 * Arguments format: s3('url', 'format') or s3('url', 'access', 'secret', 'format')
 */
EXPORT
int s3_query_args(
    void* ctx,
    const char* args, size_t args_len,
    const char* output_format
) {
    if (!ctx || !args) return -1;

    S3Context* s3ctx = static_cast<S3Context*>(ctx);

    std::string argsStr(args, args_len);
    S3TableFunctionArgs parsedArgs = parseS3Args(argsStr);

    if (!parsedArgs.valid) {
        s3ctx->setError(parsedArgs.error);
        return -1;
    }

    return s3_query(
        ctx,
        parsedArgs.url.c_str(), parsedArgs.url.size(),
        parsedArgs.accessKey.empty() ? nullptr : parsedArgs.accessKey.c_str(),
        parsedArgs.accessKey.size(),
        parsedArgs.secretKey.empty() ? nullptr : parsedArgs.secretKey.c_str(),
        parsedArgs.secretKey.size(),
        parsedArgs.format.c_str(), parsedArgs.format.size(),
        output_format
    );
}

/**
 * Get the result buffer from last query.
 */
EXPORT
const char* s3_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<S3Context*>(ctx)->lastResult;
}

/**
 * Get the result length from last query.
 */
EXPORT
size_t s3_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<S3Context*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last query.
 */
EXPORT
const char* s3_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<S3Context*>(ctx)->lastError;
}

/**
 * Parse an S3/R2 URL and return its components as JSON.
 * Useful for JavaScript side to understand the URL structure.
 */
EXPORT
const char* s3_parse_url(const char* url, size_t url_len) {
    static char result[1024];

    std::string urlStr(url, url_len);
    S3Url parsed = parseS3Url(urlStr);

    snprintf(result, sizeof(result),
        "{\"scheme\":\"%s\",\"bucket\":\"%s\",\"key\":\"%s\",\"hasGlob\":%s,\"httpUrl\":\"%s\"}",
        parsed.scheme.c_str(),
        parsed.bucket.c_str(),
        parsed.key.c_str(),
        parsed.hasGlob ? "true" : "false",
        parsed.toHttpUrl().c_str()
    );

    return result;
}

/**
 * Check if a pattern is a glob pattern.
 */
EXPORT
int s3_is_glob(const char* pattern, size_t pattern_len) {
    std::string p(pattern, pattern_len);
    return (p.find('*') != std::string::npos ||
            p.find('?') != std::string::npos ||
            p.find('[') != std::string::npos) ? 1 : 0;
}

/**
 * Match a filename against a glob pattern.
 */
EXPORT
int s3_glob_match(const char* pattern, size_t pattern_len, const char* filename, size_t filename_len) {
    std::string p(pattern, pattern_len);
    std::string f(filename, filename_len);
    return globMatch(p, f) ? 1 : 0;
}

/**
 * Test function to verify the module loaded correctly.
 */
EXPORT
int s3_test() {
    // Test 1: URL parsing
    {
        S3Url url = parseS3Url("s3://mybucket/data/file.json");
        if (url.scheme != "s3" || url.bucket != "mybucket" || url.key != "data/file.json") {
            return -1;
        }
    }

    // Test 2: R2 URL parsing
    {
        S3Url url = parseS3Url("r2://mybucket/data.parquet");
        if (url.scheme != "r2" || url.bucket != "mybucket" || url.key != "data.parquet") {
            return -2;
        }
    }

    // Test 3: HTTPS URL parsing
    {
        S3Url url = parseS3Url("https://mybucket.s3.amazonaws.com/data.json");
        if (url.scheme != "https") {
            return -3;
        }
    }

    // Test 4: Glob detection
    {
        S3Url url = parseS3Url("s3://mybucket/logs/*.json");
        if (!url.hasGlob) {
            return -4;
        }
    }

    // Test 5: Glob matching
    {
        if (!globMatch("*.json", "data.json")) return -5;
        if (!globMatch("data_*.json", "data_2024.json")) return -6;
        if (globMatch("*.json", "data.csv")) return -7;
        if (!globMatch("logs/*/events.json", "logs/2024/events.json")) return -8;
    }

    // Test 6: Format parsing
    {
        if (parseFormat("JSON") != FileFormat::JSON) return -9;
        if (parseFormat("JSONEachRow") != FileFormat::JSONEachRow) return -10;
        if (parseFormat("CSV") != FileFormat::CSV) return -11;
        if (parseFormat("Parquet") != FileFormat::Parquet) return -12;
    }

    // Test 7: Arguments parsing
    {
        auto args = parseS3Args("'s3://bucket/file.json', 'JSON'");
        if (!args.valid || args.url != "s3://bucket/file.json" || args.format != "JSON") {
            return -13;
        }
    }

    // Test 8: Arguments with credentials
    {
        auto args = parseS3Args("'s3://bucket/file.json', 'AKID', 'secret', 'JSONEachRow'");
        if (!args.valid || args.accessKey != "AKID" || args.secretKey != "secret") {
            return -14;
        }
    }

    // Test 9: JSON parsing
    {
        const char* json = R"([{"id": 1, "name": "test"}, {"id": 2, "name": "demo"}])";
        SimpleJSONParser parser(json, strlen(json));
        auto root = parser.parse();
        if (!root || root->type != SimpleJSONParser::JSONValue::Array) return -15;
        if (root->arrayVal.size() != 2) return -16;
    }

    // Test 10: S3 context creation
    {
        S3Context ctx;
        ctx.setResult("test result");
        if (strcmp(ctx.lastResult, "test result") != 0) return -17;
        ctx.setError("test error");
        if (strcmp(ctx.lastError, "test error") != 0) return -18;
    }

    return 0; // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* s3_version() {
    return "chdb-s3 0.1.0 (WASM S3/R2 table function)";
}

} // extern "C"
