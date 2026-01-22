/**
 * url_table_function.cpp - URL Table Function for WASM
 *
 * Implements a url() table function that fetches data from URLs using
 * JavaScript fetch() via Emscripten, parses various formats, and returns
 * rows that can be queried with SQL.
 *
 * Supported syntax:
 *   SELECT * FROM url('https://example.com/data.json', 'JSON')
 *   SELECT * FROM url('https://example.com/data.json', 'JSONEachRow')
 *   SELECT * FROM url('https://example.com/data.csv', 'CSV')
 *   SELECT * FROM url('https://example.com/data.tsv', 'TSV')
 *   SELECT col1, col2 FROM url(...) WHERE condition
 *
 * The function bridges to JavaScript fetch() using EM_JS macros.
 *
 * Build with: emcc -fexceptions -DURL_TABLE_FUNCTION_BUILD
 *
 * Target size: ~50KB as side module
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

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// JavaScript Fetch Bridge using EM_JS
// ============================================================================

#ifdef __EMSCRIPTEN__

// Synchronous fetch that blocks until complete (using Asyncify or sync XHR)
// Returns a pointer to the response body, or nullptr on error
// The caller must free the returned memory using free()
EM_JS(char*, js_fetch_url_sync, (const char* url_ptr), {
    const url = UTF8ToString(url_ptr);

    // Use synchronous XMLHttpRequest (works in Workers and main thread)
    // Note: In modern browsers, sync XHR is deprecated on main thread but works in Workers
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);  // false = synchronous
        xhr.send(null);

        if (xhr.status >= 200 && xhr.status < 300) {
            const response = xhr.responseText;
            const len = lengthBytesUTF8(response) + 1;
            const ptr = _malloc(len);
            stringToUTF8(response, ptr, len);
            return ptr;
        } else {
            console.error('Fetch failed with status:', xhr.status, xhr.statusText);
            return 0;  // nullptr
        }
    } catch (e) {
        console.error('Fetch error:', e.message || e);
        return 0;  // nullptr
    }
});

// Get the last fetch error message
EM_JS(const char*, js_get_fetch_error, (), {
    // Return a static error message for now
    // Could be enhanced to store actual error messages
    const msg = "Fetch failed";
    const len = lengthBytesUTF8(msg) + 1;
    const ptr = _malloc(len);
    stringToUTF8(msg, ptr, len);
    return ptr;
});

#else
// Stubs for non-Emscripten builds (for testing compilation)
char* js_fetch_url_sync(const char* url_ptr) {
    (void)url_ptr;
    return nullptr;
}

const char* js_get_fetch_error() {
    return "Fetch not available outside WASM";
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
// Data Type Definitions
// ============================================================================

enum class DataType {
    Int8, Int16, Int32, Int64,
    UInt8, UInt16, UInt32, UInt64,
    Float32, Float64,
    String,
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
// Row Type
// ============================================================================

using Row = std::vector<Value>;

// ============================================================================
// JSON Parser (minimal, handles common cases)
// ============================================================================

class JSONParser {
public:
    JSONParser(const std::string& json) : json_(json), pos_(0) {}

    // Parse a single JSON value (object, array, string, number, bool, null)
    Value parseValue() {
        skipWhitespace();
        if (pos_ >= json_.size()) return std::monostate{};

        char c = json_[pos_];

        if (c == '"') return parseString();
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n') return parseNull();
        if (c == '-' || isdigit(c)) return parseNumber();

        return std::monostate{};
    }

    // Parse a JSON object into a row with columns
    bool parseObjectAsRow(std::vector<ColumnDef>& columns, Row& row, bool inferSchema) {
        skipWhitespace();
        if (pos_ >= json_.size() || json_[pos_] != '{') return false;
        pos_++; // Skip '{'

        std::unordered_map<std::string, size_t> columnIndex;
        if (!inferSchema) {
            for (size_t i = 0; i < columns.size(); i++) {
                columnIndex[columns[i].name] = i;
            }
            row.resize(columns.size(), std::monostate{});
        }

        skipWhitespace();
        if (pos_ < json_.size() && json_[pos_] == '}') {
            pos_++;
            return true;
        }

        while (pos_ < json_.size()) {
            // Parse key
            skipWhitespace();
            if (json_[pos_] != '"') return false;
            std::string key = std::get<std::string>(parseString());

            // Skip ':'
            skipWhitespace();
            if (pos_ >= json_.size() || json_[pos_] != ':') return false;
            pos_++;

            // Parse value
            Value val = parseValue();

            if (inferSchema) {
                ColumnDef col;
                col.name = key;
                col.type = inferType(val);
                columns.push_back(col);
                row.push_back(val);
            } else {
                auto it = columnIndex.find(key);
                if (it != columnIndex.end()) {
                    row[it->second] = val;
                }
            }

            // Check for comma or end
            skipWhitespace();
            if (pos_ >= json_.size()) return false;
            if (json_[pos_] == '}') {
                pos_++;
                return true;
            }
            if (json_[pos_] == ',') {
                pos_++;
                continue;
            }
            return false;
        }
        return false;
    }

    // Parse JSON array
    bool parseArrayOfObjects(std::vector<ColumnDef>& columns, std::vector<Row>& rows) {
        skipWhitespace();
        if (pos_ >= json_.size() || json_[pos_] != '[') return false;
        pos_++; // Skip '['

        skipWhitespace();
        if (pos_ < json_.size() && json_[pos_] == ']') {
            pos_++;
            return true;
        }

        bool firstRow = true;
        while (pos_ < json_.size()) {
            Row row;
            if (!parseObjectAsRow(columns, row, firstRow)) return false;
            rows.push_back(std::move(row));
            firstRow = false;

            skipWhitespace();
            if (pos_ >= json_.size()) return false;
            if (json_[pos_] == ']') {
                pos_++;
                return true;
            }
            if (json_[pos_] == ',') {
                pos_++;
                continue;
            }
            return false;
        }
        return false;
    }

    // Parse a single JSON object (for single-object responses)
    bool parseSingleObject(std::vector<ColumnDef>& columns, std::vector<Row>& rows) {
        Row row;
        if (!parseObjectAsRow(columns, row, true)) return false;
        rows.push_back(std::move(row));
        return true;
    }

    void reset() { pos_ = 0; }
    size_t getPos() const { return pos_; }

private:
    void skipWhitespace() {
        while (pos_ < json_.size() && isspace(json_[pos_])) {
            pos_++;
        }
    }

    Value parseString() {
        if (pos_ >= json_.size() || json_[pos_] != '"') return std::monostate{};
        pos_++; // Skip opening quote

        std::string result;
        while (pos_ < json_.size()) {
            char c = json_[pos_];
            if (c == '"') {
                pos_++;
                return result;
            }
            if (c == '\\' && pos_ + 1 < json_.size()) {
                pos_++;
                char escaped = json_[pos_];
                switch (escaped) {
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    case '/': result += '/'; break;
                    case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break;
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case 'u': {
                        // Unicode escape (simplified - just skip 4 hex chars)
                        if (pos_ + 4 < json_.size()) {
                            pos_ += 4;
                        }
                        result += '?'; // Placeholder
                        break;
                    }
                    default: result += escaped; break;
                }
                pos_++;
            } else {
                result += c;
                pos_++;
            }
        }
        return std::monostate{}; // Unclosed string
    }

    Value parseNumber() {
        size_t start = pos_;
        bool isFloat = false;

        if (pos_ < json_.size() && json_[pos_] == '-') pos_++;
        while (pos_ < json_.size() && isdigit(json_[pos_])) pos_++;

        if (pos_ < json_.size() && json_[pos_] == '.') {
            isFloat = true;
            pos_++;
            while (pos_ < json_.size() && isdigit(json_[pos_])) pos_++;
        }

        if (pos_ < json_.size() && (json_[pos_] == 'e' || json_[pos_] == 'E')) {
            isFloat = true;
            pos_++;
            if (pos_ < json_.size() && (json_[pos_] == '+' || json_[pos_] == '-')) pos_++;
            while (pos_ < json_.size() && isdigit(json_[pos_])) pos_++;
        }

        std::string numStr = json_.substr(start, pos_ - start);
        if (isFloat) {
            return std::stod(numStr);
        } else {
            return static_cast<int64_t>(std::stoll(numStr));
        }
    }

    Value parseBool() {
        if (json_.substr(pos_, 4) == "true") {
            pos_ += 4;
            return int64_t{1};
        }
        if (json_.substr(pos_, 5) == "false") {
            pos_ += 5;
            return int64_t{0};
        }
        return std::monostate{};
    }

    Value parseNull() {
        if (json_.substr(pos_, 4) == "null") {
            pos_ += 4;
            return std::monostate{};
        }
        return std::monostate{};
    }

    Value parseObject() {
        // For nested objects, return as JSON string
        size_t start = pos_;
        int depth = 0;
        while (pos_ < json_.size()) {
            char c = json_[pos_];
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) {
                    pos_++;
                    return json_.substr(start, pos_ - start);
                }
            }
            else if (c == '"') {
                // Skip strings to avoid counting braces inside them
                pos_++;
                while (pos_ < json_.size() && json_[pos_] != '"') {
                    if (json_[pos_] == '\\') pos_++;
                    pos_++;
                }
            }
            pos_++;
        }
        return std::monostate{};
    }

    Value parseArray() {
        // For nested arrays, return as JSON string
        size_t start = pos_;
        int depth = 0;
        while (pos_ < json_.size()) {
            char c = json_[pos_];
            if (c == '[') depth++;
            else if (c == ']') {
                depth--;
                if (depth == 0) {
                    pos_++;
                    return json_.substr(start, pos_ - start);
                }
            }
            else if (c == '"') {
                pos_++;
                while (pos_ < json_.size() && json_[pos_] != '"') {
                    if (json_[pos_] == '\\') pos_++;
                    pos_++;
                }
            }
            pos_++;
        }
        return std::monostate{};
    }

    DataType inferType(const Value& v) {
        if (std::holds_alternative<int64_t>(v)) return DataType::Int64;
        if (std::holds_alternative<double>(v)) return DataType::Float64;
        if (std::holds_alternative<std::string>(v)) return DataType::String;
        return DataType::String;
    }

    std::string json_;
    size_t pos_;
};

// ============================================================================
// CSV Parser
// ============================================================================

class CSVParser {
public:
    CSVParser(const std::string& csv, char delimiter = ',')
        : csv_(csv), pos_(0), delimiter_(delimiter) {}

    bool parseHeader(std::vector<ColumnDef>& columns) {
        std::vector<std::string> fields;
        if (!parseLine(fields)) return false;

        for (const auto& field : fields) {
            ColumnDef col;
            col.name = field;
            col.type = DataType::String;  // Will infer from first data row
            columns.push_back(col);
        }
        return true;
    }

    bool parseRows(std::vector<ColumnDef>& columns, std::vector<Row>& rows) {
        bool firstRow = true;
        while (pos_ < csv_.size()) {
            std::vector<std::string> fields;
            if (!parseLine(fields)) break;
            if (fields.empty()) continue;

            // Ensure we have enough columns
            while (columns.size() < fields.size()) {
                ColumnDef col;
                col.name = "column" + std::to_string(columns.size());
                col.type = DataType::String;
                columns.push_back(col);
            }

            Row row;
            for (size_t i = 0; i < columns.size(); i++) {
                if (i < fields.size()) {
                    Value val = parseFieldValue(fields[i]);
                    row.push_back(val);
                    // Infer type from first row
                    if (firstRow) {
                        columns[i].type = inferType(val);
                    }
                } else {
                    row.push_back(std::monostate{});
                }
            }
            rows.push_back(std::move(row));
            firstRow = false;
        }
        return true;
    }

private:
    bool parseLine(std::vector<std::string>& fields) {
        fields.clear();

        // Skip empty lines
        while (pos_ < csv_.size() && (csv_[pos_] == '\n' || csv_[pos_] == '\r')) {
            pos_++;
        }
        if (pos_ >= csv_.size()) return false;

        while (pos_ < csv_.size()) {
            std::string field;

            if (csv_[pos_] == '"') {
                // Quoted field
                pos_++;
                while (pos_ < csv_.size()) {
                    if (csv_[pos_] == '"') {
                        if (pos_ + 1 < csv_.size() && csv_[pos_ + 1] == '"') {
                            field += '"';
                            pos_ += 2;
                        } else {
                            pos_++;
                            break;
                        }
                    } else {
                        field += csv_[pos_];
                        pos_++;
                    }
                }
            } else {
                // Unquoted field
                while (pos_ < csv_.size() && csv_[pos_] != delimiter_ &&
                       csv_[pos_] != '\n' && csv_[pos_] != '\r') {
                    field += csv_[pos_];
                    pos_++;
                }
            }

            fields.push_back(field);

            if (pos_ >= csv_.size() || csv_[pos_] == '\n' || csv_[pos_] == '\r') {
                // Skip line ending
                while (pos_ < csv_.size() && (csv_[pos_] == '\n' || csv_[pos_] == '\r')) {
                    pos_++;
                }
                break;
            }

            if (csv_[pos_] == delimiter_) {
                pos_++;
            }
        }

        return !fields.empty();
    }

    Value parseFieldValue(const std::string& field) {
        if (field.empty() || field == "NULL" || field == "null") {
            return std::monostate{};
        }

        // Try to parse as number
        bool isNumber = true;
        bool hasDecimal = false;
        bool hasSign = false;

        for (size_t i = 0; i < field.size(); i++) {
            char c = field[i];
            if (i == 0 && (c == '-' || c == '+')) {
                hasSign = true;
                continue;
            }
            if (c == '.') {
                if (hasDecimal) { isNumber = false; break; }
                hasDecimal = true;
                continue;
            }
            if (!isdigit(c)) {
                isNumber = false;
                break;
            }
        }

        if (isNumber && !field.empty() && field != "-" && field != "+") {
            try {
                if (hasDecimal) {
                    return std::stod(field);
                } else {
                    return static_cast<int64_t>(std::stoll(field));
                }
            } catch (...) {
                // Fall through to string
            }
        }

        return field;
    }

    DataType inferType(const Value& v) {
        if (std::holds_alternative<int64_t>(v)) return DataType::Int64;
        if (std::holds_alternative<double>(v)) return DataType::Float64;
        if (std::holds_alternative<std::string>(v)) return DataType::String;
        return DataType::String;
    }

    std::string csv_;
    size_t pos_;
    char delimiter_;
};

// ============================================================================
// JSONEachRow Parser (newline-delimited JSON)
// ============================================================================

class JSONEachRowParser {
public:
    JSONEachRowParser(const std::string& data) : data_(data), pos_(0) {}

    bool parse(std::vector<ColumnDef>& columns, std::vector<Row>& rows) {
        bool firstRow = true;

        while (pos_ < data_.size()) {
            // Skip whitespace and newlines
            while (pos_ < data_.size() && (isspace(data_[pos_]))) {
                pos_++;
            }
            if (pos_ >= data_.size()) break;

            // Find end of line
            size_t lineStart = pos_;
            while (pos_ < data_.size() && data_[pos_] != '\n') {
                pos_++;
            }
            size_t lineEnd = pos_;
            if (pos_ < data_.size()) pos_++; // Skip newline

            // Skip empty lines
            if (lineEnd == lineStart) continue;

            // Parse the JSON object on this line
            std::string line = data_.substr(lineStart, lineEnd - lineStart);
            // Trim trailing whitespace
            while (!line.empty() && isspace(line.back())) {
                line.pop_back();
            }
            if (line.empty()) continue;

            JSONParser lineParser(line);
            Row row;
            if (lineParser.parseObjectAsRow(columns, row, firstRow)) {
                rows.push_back(std::move(row));
                firstRow = false;
            }
        }

        return !rows.empty();
    }

private:
    std::string data_;
    size_t pos_;
};

// ============================================================================
// URL Fetcher and Parser
// ============================================================================

enum class FormatType {
    JSON,
    JSONEachRow,
    CSV,
    TSV,
    Unknown
};

FormatType parseFormat(const std::string& fmt) {
    std::string upper = fmt;
    for (char& c : upper) c = toupper(c);

    if (upper == "JSON") return FormatType::JSON;
    if (upper == "JSONEACHROW" || upper == "NDJSON") return FormatType::JSONEachRow;
    if (upper == "CSV") return FormatType::CSV;
    if (upper == "TSV" || upper == "TABSEPARATED") return FormatType::TSV;

    return FormatType::Unknown;
}

class URLFetcher {
public:
    struct FetchResult {
        bool success;
        std::vector<ColumnDef> columns;
        std::vector<Row> rows;
        std::string error;
    };

    static FetchResult fetch(const std::string& url, FormatType format) {
        FetchResult result;
        result.success = false;

        // Fetch the URL
        char* response = js_fetch_url_sync(url.c_str());
        if (!response) {
            result.error = "Failed to fetch URL: " + url;
            return result;
        }

        std::string data(response);
        free(response);

        // Parse based on format
        switch (format) {
            case FormatType::JSON:
                result.success = parseJSON(data, result.columns, result.rows, result.error);
                break;
            case FormatType::JSONEachRow:
                result.success = parseJSONEachRow(data, result.columns, result.rows, result.error);
                break;
            case FormatType::CSV:
                result.success = parseCSV(data, ',', result.columns, result.rows, result.error);
                break;
            case FormatType::TSV:
                result.success = parseCSV(data, '\t', result.columns, result.rows, result.error);
                break;
            default:
                result.error = "Unknown format";
                break;
        }

        return result;
    }

private:
    static bool parseJSON(const std::string& data, std::vector<ColumnDef>& columns,
                          std::vector<Row>& rows, std::string& error) {
        JSONParser parser(data);

        // Try to determine if it's an array or single object
        size_t pos = 0;
        while (pos < data.size() && isspace(data[pos])) pos++;

        if (pos >= data.size()) {
            error = "Empty JSON response";
            return false;
        }

        if (data[pos] == '[') {
            // Array of objects
            if (!parser.parseArrayOfObjects(columns, rows)) {
                error = "Failed to parse JSON array";
                return false;
            }
        } else if (data[pos] == '{') {
            // Single object - return as one row
            if (!parser.parseSingleObject(columns, rows)) {
                error = "Failed to parse JSON object";
                return false;
            }
        } else {
            error = "Invalid JSON: expected array or object";
            return false;
        }

        return true;
    }

    static bool parseJSONEachRow(const std::string& data, std::vector<ColumnDef>& columns,
                                  std::vector<Row>& rows, std::string& error) {
        JSONEachRowParser parser(data);
        if (!parser.parse(columns, rows)) {
            error = "Failed to parse JSONEachRow data";
            return false;
        }
        return true;
    }

    static bool parseCSV(const std::string& data, char delimiter,
                         std::vector<ColumnDef>& columns, std::vector<Row>& rows,
                         std::string& error) {
        CSVParser parser(data, delimiter);

        if (!parser.parseHeader(columns)) {
            error = "Failed to parse CSV header";
            return false;
        }

        if (!parser.parseRows(columns, rows)) {
            error = "Failed to parse CSV rows";
            return false;
        }

        return true;
    }
};

// ============================================================================
// Tokenizer
// ============================================================================

enum class TokenKind {
    End,
    Number,
    String,
    Identifier,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    // Keywords
    As,
    Select,
    From,
    Where,
    And,
    Or,
    Not,
    Null,
    True_,
    False_,
    Url,  // url keyword/function
    Error
};

struct Token {
    TokenKind kind;
    std::string text;
    size_t pos;
};

class Lexer {
public:
    Lexer(const char* input, size_t len)
        : input_(input), len_(len), pos_(0) {}

    Token next() {
        skipWhitespace();

        if (pos_ >= len_) {
            return {TokenKind::End, "", pos_};
        }

        char c = input_[pos_];
        size_t startPos = pos_;

        // Two-character operators
        if (pos_ + 1 < len_) {
            char c2 = input_[pos_ + 1];
            if (c == '!' && c2 == '=') { pos_ += 2; return {TokenKind::Ne, "!=", startPos}; }
            if (c == '<' && c2 == '>') { pos_ += 2; return {TokenKind::Ne, "<>", startPos}; }
            if (c == '<' && c2 == '=') { pos_ += 2; return {TokenKind::Le, "<=", startPos}; }
            if (c == '>' && c2 == '=') { pos_ += 2; return {TokenKind::Ge, ">=", startPos}; }
        }

        // Single character tokens
        switch (c) {
            case '+': pos_++; return {TokenKind::Plus, "+", startPos};
            case '-': pos_++; return {TokenKind::Minus, "-", startPos};
            case '*': pos_++; return {TokenKind::Star, "*", startPos};
            case '/': pos_++; return {TokenKind::Slash, "/", startPos};
            case '%': pos_++; return {TokenKind::Percent, "%", startPos};
            case '(': pos_++; return {TokenKind::LParen, "(", startPos};
            case ')': pos_++; return {TokenKind::RParen, ")", startPos};
            case ',': pos_++; return {TokenKind::Comma, ",", startPos};
            case ';': pos_++; return {TokenKind::Semicolon, ";", startPos};
            case '.': pos_++; return {TokenKind::Dot, ".", startPos};
            case '=': pos_++; return {TokenKind::Eq, "=", startPos};
            case '<': pos_++; return {TokenKind::Lt, "<", startPos};
            case '>': pos_++; return {TokenKind::Gt, ">", startPos};
        }

        // String literal
        if (c == '\'' || c == '"') {
            return scanString(c);
        }

        // Number
        if (isdigit(c) || (c == '.' && pos_ + 1 < len_ && isdigit(input_[pos_ + 1]))) {
            return scanNumber();
        }

        // Identifier or keyword
        if (isalpha(c) || c == '_') {
            return scanIdentifier();
        }

        pos_++;
        return {TokenKind::Error, std::string(1, c), startPos};
    }

    Token peek() {
        size_t savedPos = pos_;
        Token t = next();
        pos_ = savedPos;
        return t;
    }

private:
    void skipWhitespace() {
        while (pos_ < len_ && isspace(input_[pos_])) {
            pos_++;
        }
        // Skip single-line comments
        if (pos_ + 1 < len_ && input_[pos_] == '-' && input_[pos_ + 1] == '-') {
            while (pos_ < len_ && input_[pos_] != '\n') pos_++;
            skipWhitespace();
        }
    }

    Token scanString(char quote) {
        size_t startPos = pos_;
        pos_++;
        std::string value;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (c == quote) {
                if (pos_ + 1 < len_ && input_[pos_ + 1] == quote) {
                    value += quote;
                    pos_ += 2;
                } else {
                    pos_++;
                    return {TokenKind::String, value, startPos};
                }
            } else if (c == '\\' && pos_ + 1 < len_) {
                pos_++;
                char escaped = input_[pos_];
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '\'': value += '\''; break;
                    case '"': value += '"'; break;
                    default: value += escaped; break;
                }
                pos_++;
            } else {
                value += c;
                pos_++;
            }
        }

        return {TokenKind::Error, "unclosed string", startPos};
    }

    Token scanNumber() {
        size_t startPos = pos_;
        std::string num;
        bool hasDot = false;
        bool hasE = false;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (isdigit(c)) {
                num += c;
                pos_++;
            } else if (c == '.' && !hasDot && !hasE) {
                hasDot = true;
                num += c;
                pos_++;
            } else if ((c == 'e' || c == 'E') && !hasE) {
                hasE = true;
                num += c;
                pos_++;
                if (pos_ < len_ && (input_[pos_] == '+' || input_[pos_] == '-')) {
                    num += input_[pos_];
                    pos_++;
                }
            } else {
                break;
            }
        }

        return {TokenKind::Number, num, startPos};
    }

    Token scanIdentifier() {
        size_t startPos = pos_;
        std::string ident;

        while (pos_ < len_ && (isalnum(input_[pos_]) || input_[pos_] == '_')) {
            ident += input_[pos_];
            pos_++;
        }

        std::string upper = ident;
        for (char& c : upper) c = toupper(c);

        if (upper == "SELECT") return {TokenKind::Select, ident, startPos};
        if (upper == "FROM") return {TokenKind::From, ident, startPos};
        if (upper == "WHERE") return {TokenKind::Where, ident, startPos};
        if (upper == "AND") return {TokenKind::And, ident, startPos};
        if (upper == "OR") return {TokenKind::Or, ident, startPos};
        if (upper == "NOT") return {TokenKind::Not, ident, startPos};
        if (upper == "AS") return {TokenKind::As, ident, startPos};
        if (upper == "NULL") return {TokenKind::Null, ident, startPos};
        if (upper == "TRUE") return {TokenKind::True_, ident, startPos};
        if (upper == "FALSE") return {TokenKind::False_, ident, startPos};
        if (upper == "URL") return {TokenKind::Url, ident, startPos};

        return {TokenKind::Identifier, ident, startPos};
    }

    const char* input_;
    size_t len_;
    size_t pos_;
};

// ============================================================================
// Expression AST
// ============================================================================

struct Expr;
using ExprPtr = std::shared_ptr<Expr>;

enum class ExprKind {
    Literal,
    ColumnRef,
    BinaryOp,
    UnaryOp,
    Star
};

struct Expr {
    ExprKind kind;
    Value literalValue;
    std::string columnName;
    char op;
    std::string compareOp;
    ExprPtr left;
    ExprPtr right;

    static ExprPtr makeLiteral(Value v) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Literal;
        e->literalValue = std::move(v);
        return e;
    }

    static ExprPtr makeColumnRef(const std::string& name) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::ColumnRef;
        e->columnName = name;
        return e;
    }

    static ExprPtr makeStar() {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Star;
        return e;
    }

    static ExprPtr makeBinaryOp(char op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->op = op;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeCompareOp(const std::string& op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->compareOp = op;
        e->op = 0;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeUnaryOp(char op, ExprPtr operand) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::UnaryOp;
        e->op = op;
        e->right = std::move(operand);
        return e;
    }

    static ExprPtr makeLogicalOp(const std::string& op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->compareOp = op;
        e->op = 0;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }
};

// ============================================================================
// Select Column
// ============================================================================

struct SelectColumn {
    ExprPtr expr;
    std::string alias;
};

// ============================================================================
// URL Table Function Definition
// ============================================================================

struct URLTableFunc {
    std::string url;
    FormatType format;
};

// ============================================================================
// Parser
// ============================================================================

class Parser {
public:
    Parser(Lexer& lexer) : lexer_(lexer) {
        advance();
    }

    // Parse url() table function
    bool parseURLFunction(URLTableFunc& func, std::string& error) {
        // Expect URL identifier (already consumed)
        // Current token should be '('
        if (current_.kind != TokenKind::LParen) {
            error = "Expected '(' after url";
            return false;
        }
        advance();

        // First argument: URL string
        if (current_.kind != TokenKind::String) {
            error = "Expected URL string as first argument";
            return false;
        }
        func.url = current_.text;
        advance();

        // Second argument: format (optional, defaults to JSON)
        func.format = FormatType::JSON;
        if (current_.kind == TokenKind::Comma) {
            advance();
            if (current_.kind != TokenKind::String && current_.kind != TokenKind::Identifier) {
                error = "Expected format string as second argument";
                return false;
            }
            func.format = parseFormat(current_.text);
            if (func.format == FormatType::Unknown) {
                error = "Unknown format: " + current_.text;
                return false;
            }
            advance();
        }

        // Close paren
        if (current_.kind != TokenKind::RParen) {
            error = "Expected ')' after url arguments";
            return false;
        }
        advance();

        return true;
    }

    // Parse expression
    ExprPtr parseExpr() {
        return parseOr();
    }

    ExprPtr parseOr() {
        ExprPtr left = parseAnd();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Or) {
            advance();
            ExprPtr right = parseAnd();
            if (!right) return nullptr;
            left = Expr::makeLogicalOp("OR", left, right);
        }
        return left;
    }

    ExprPtr parseAnd() {
        ExprPtr left = parseComparison();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::And) {
            advance();
            ExprPtr right = parseComparison();
            if (!right) return nullptr;
            left = Expr::makeLogicalOp("AND", left, right);
        }
        return left;
    }

    ExprPtr parseComparison() {
        ExprPtr left = parseAddSub();
        if (!left) return nullptr;

        std::string op;
        switch (current_.kind) {
            case TokenKind::Eq: op = "="; break;
            case TokenKind::Ne: op = "!="; break;
            case TokenKind::Lt: op = "<"; break;
            case TokenKind::Le: op = "<="; break;
            case TokenKind::Gt: op = ">"; break;
            case TokenKind::Ge: op = ">="; break;
            default: return left;
        }

        advance();
        ExprPtr right = parseAddSub();
        if (!right) return nullptr;
        return Expr::makeCompareOp(op, left, right);
    }

    ExprPtr parseAddSub() {
        ExprPtr left = parseMulDiv();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Plus || current_.kind == TokenKind::Minus) {
            char op = (current_.kind == TokenKind::Plus) ? '+' : '-';
            advance();
            ExprPtr right = parseMulDiv();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    ExprPtr parseMulDiv() {
        ExprPtr left = parseUnary();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Star ||
               current_.kind == TokenKind::Slash ||
               current_.kind == TokenKind::Percent) {
            char op;
            switch (current_.kind) {
                case TokenKind::Star: op = '*'; break;
                case TokenKind::Slash: op = '/'; break;
                case TokenKind::Percent: op = '%'; break;
                default: op = '?'; break;
            }
            advance();
            ExprPtr right = parseUnary();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    ExprPtr parseUnary() {
        if (current_.kind == TokenKind::Minus) {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('-', operand);
        }
        if (current_.kind == TokenKind::Plus) {
            advance();
            return parseUnary();
        }
        if (current_.kind == TokenKind::Not) {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('!', operand);
        }
        return parsePrimary();
    }

    ExprPtr parsePrimary() {
        if (current_.kind == TokenKind::Number) {
            std::string numStr = current_.text;
            advance();
            if (numStr.find('.') != std::string::npos ||
                numStr.find('e') != std::string::npos ||
                numStr.find('E') != std::string::npos) {
                return Expr::makeLiteral(std::stod(numStr));
            } else {
                return Expr::makeLiteral(static_cast<int64_t>(std::stoll(numStr)));
            }
        }

        if (current_.kind == TokenKind::String) {
            std::string str = current_.text;
            advance();
            return Expr::makeLiteral(str);
        }

        if (current_.kind == TokenKind::Null) {
            advance();
            return Expr::makeLiteral(std::monostate{});
        }

        if (current_.kind == TokenKind::True_) {
            advance();
            return Expr::makeLiteral(int64_t{1});
        }

        if (current_.kind == TokenKind::False_) {
            advance();
            return Expr::makeLiteral(int64_t{0});
        }

        if (current_.kind == TokenKind::Star) {
            advance();
            return Expr::makeStar();
        }

        if (current_.kind == TokenKind::Identifier || current_.kind == TokenKind::Url) {
            std::string ident = current_.text;
            advance();
            return Expr::makeColumnRef(ident);
        }

        if (current_.kind == TokenKind::LParen) {
            advance();
            ExprPtr expr = parseExpr();
            if (!expr) return nullptr;
            if (current_.kind != TokenKind::RParen) {
                error_ = "Expected closing parenthesis";
                return nullptr;
            }
            advance();
            return expr;
        }

        error_ = "Unexpected token: " + current_.text;
        return nullptr;
    }

    bool parseSelectList(std::vector<SelectColumn>& columns, std::string& error) {
        do {
            SelectColumn col;
            col.expr = parseExpr();
            if (!col.expr) {
                error = error_.empty() ? "Failed to parse expression" : error_;
                return false;
            }

            if (current_.kind == TokenKind::As) {
                advance();
                if (current_.kind != TokenKind::Identifier) {
                    error = "Expected identifier after AS";
                    return false;
                }
                col.alias = current_.text;
                advance();
            } else if (current_.kind == TokenKind::Identifier &&
                       current_.kind != TokenKind::From &&
                       current_.kind != TokenKind::Where) {
                col.alias = current_.text;
                advance();
            }

            columns.push_back(std::move(col));

        } while (current_.kind == TokenKind::Comma && (advance(), true));

        return true;
    }

    Token current() const { return current_; }
    void advance() { current_ = lexer_.next(); }
    std::string getError() const { return error_; }

private:
    Lexer& lexer_;
    Token current_;
    std::string error_;
};

// ============================================================================
// Expression Evaluator
// ============================================================================

class ExprEvaluator {
public:
    ExprEvaluator(const std::vector<ColumnDef>* columns = nullptr, const Row* row = nullptr)
        : columns_(columns), row_(row) {
        if (columns_) {
            for (size_t i = 0; i < columns_->size(); i++) {
                columnIndex_[(*columns_)[i].name] = i;
            }
        }
    }

    Value evaluate(const ExprPtr& expr) {
        if (!expr) return std::monostate{};

        switch (expr->kind) {
            case ExprKind::Literal:
                return expr->literalValue;

            case ExprKind::ColumnRef: {
                if (!columns_ || !row_) {
                    return std::monostate{};
                }
                auto it = columnIndex_.find(expr->columnName);
                if (it == columnIndex_.end()) {
                    // Case-insensitive search
                    std::string lower = expr->columnName;
                    for (char& c : lower) c = tolower(c);
                    for (size_t i = 0; i < columns_->size(); i++) {
                        std::string colLower = (*columns_)[i].name;
                        for (char& c : colLower) c = tolower(c);
                        if (colLower == lower) {
                            return (*row_)[i];
                        }
                    }
                    return std::monostate{};
                }
                size_t idx = it->second;
                if (idx >= row_->size()) return std::monostate{};
                return (*row_)[idx];
            }

            case ExprKind::Star:
                return std::monostate{};

            case ExprKind::UnaryOp: {
                Value operand = evaluate(expr->right);
                if (expr->op == '-') {
                    if (std::holds_alternative<int64_t>(operand)) {
                        return -std::get<int64_t>(operand);
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return -std::get<double>(operand);
                    }
                }
                if (expr->op == '!') {
                    if (std::holds_alternative<int64_t>(operand)) {
                        return int64_t{std::get<int64_t>(operand) == 0 ? 1 : 0};
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return int64_t{std::get<double>(operand) == 0.0 ? 1 : 0};
                    }
                }
                return operand;
            }

            case ExprKind::BinaryOp: {
                Value left = evaluate(expr->left);
                Value right = evaluate(expr->right);

                if (!expr->compareOp.empty()) {
                    return evalCompareOp(expr->compareOp, left, right);
                }

                return evalBinaryOp(expr->op, left, right);
            }
        }

        return std::monostate{};
    }

    bool evaluateBool(const ExprPtr& expr) {
        Value v = evaluate(expr);
        if (std::holds_alternative<int64_t>(v)) {
            return std::get<int64_t>(v) != 0;
        }
        if (std::holds_alternative<double>(v)) {
            return std::get<double>(v) != 0.0;
        }
        if (std::holds_alternative<std::string>(v)) {
            return !std::get<std::string>(v).empty();
        }
        return false;
    }

private:
    Value evalBinaryOp(char op, const Value& left, const Value& right) {
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        if (op == '+' && (std::holds_alternative<std::string>(left) ||
                         std::holds_alternative<std::string>(right))) {
            return valueToString(left) + valueToString(right);
        }

        bool leftIsDouble = std::holds_alternative<double>(left);
        bool rightIsDouble = std::holds_alternative<double>(right);
        bool leftIsInt = std::holds_alternative<int64_t>(left);
        bool rightIsInt = std::holds_alternative<int64_t>(right);

        if ((leftIsDouble || leftIsInt) && (rightIsDouble || rightIsInt)) {
            if (leftIsDouble || rightIsDouble) {
                double l = leftIsDouble ? std::get<double>(left)
                                        : static_cast<double>(std::get<int64_t>(left));
                double r = rightIsDouble ? std::get<double>(right)
                                         : static_cast<double>(std::get<int64_t>(right));
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/':
                        if (r != 0) return l / r;
                        return Value{std::monostate{}};
                    case '%':
                        if (r != 0) return std::fmod(l, r);
                        return Value{std::monostate{}};
                }
            } else {
                int64_t l = std::get<int64_t>(left);
                int64_t r = std::get<int64_t>(right);
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/':
                        if (r != 0) return l / r;
                        return Value{std::monostate{}};
                    case '%':
                        if (r != 0) return l % r;
                        return Value{std::monostate{}};
                }
            }
        }

        return std::monostate{};
    }

    Value evalCompareOp(const std::string& op, const Value& left, const Value& right) {
        if (op == "AND") {
            bool lb = valueToBool(left);
            bool rb = valueToBool(right);
            return int64_t{lb && rb ? 1 : 0};
        }
        if (op == "OR") {
            bool lb = valueToBool(left);
            bool rb = valueToBool(right);
            return int64_t{lb || rb ? 1 : 0};
        }

        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        int cmp = compareValues(left, right);
        bool result = false;

        if (op == "=") result = (cmp == 0);
        else if (op == "!=") result = (cmp != 0);
        else if (op == "<") result = (cmp < 0);
        else if (op == "<=") result = (cmp <= 0);
        else if (op == ">") result = (cmp > 0);
        else if (op == ">=") result = (cmp >= 0);

        return int64_t{result ? 1 : 0};
    }

    bool valueToBool(const Value& v) {
        if (std::holds_alternative<int64_t>(v)) return std::get<int64_t>(v) != 0;
        if (std::holds_alternative<double>(v)) return std::get<double>(v) != 0.0;
        if (std::holds_alternative<std::string>(v)) return !std::get<std::string>(v).empty();
        return false;
    }

    int compareValues(const Value& left, const Value& right) {
        if (std::holds_alternative<std::string>(left) ||
            std::holds_alternative<std::string>(right)) {
            std::string ls = valueToString(left);
            std::string rs = valueToString(right);
            return ls.compare(rs);
        }

        double l = 0, r = 0;
        if (std::holds_alternative<int64_t>(left)) l = static_cast<double>(std::get<int64_t>(left));
        else if (std::holds_alternative<double>(left)) l = std::get<double>(left);

        if (std::holds_alternative<int64_t>(right)) r = static_cast<double>(std::get<int64_t>(right));
        else if (std::holds_alternative<double>(right)) r = std::get<double>(right);

        if (l < r) return -1;
        if (l > r) return 1;
        return 0;
    }

    const std::vector<ColumnDef>* columns_;
    const Row* row_;
    std::unordered_map<std::string, size_t> columnIndex_;
};

// ============================================================================
// Query Result
// ============================================================================

struct QueryResult {
    std::vector<ColumnDef> columns;
    std::vector<Row> rows;
    std::string message;
    bool success = true;
    std::string error;
};

// ============================================================================
// Query Executor for URL Table Function
// ============================================================================

class URLQueryExecutor {
public:
    QueryResult execute(const char* query, size_t len) {
        QueryResult result;
        Lexer lexer(query, len);
        Parser parser(lexer);

        Token first = parser.current();

        if (first.kind != TokenKind::Select) {
            result.success = false;
            result.error = "Only SELECT queries are supported";
            return result;
        }

        return executeSelect(parser);
    }

private:
    QueryResult executeSelect(Parser& parser) {
        QueryResult result;

        // Skip SELECT
        parser.advance();

        // Parse select list
        std::vector<SelectColumn> selectCols;
        std::string error;
        if (!parser.parseSelectList(selectCols, error)) {
            result.success = false;
            result.error = error;
            return result;
        }

        // Check for FROM clause
        URLTableFunc urlFunc;
        bool hasURLTable = false;

        if (parser.current().kind == TokenKind::From) {
            parser.advance();

            // Check if it's url() function
            if (parser.current().kind == TokenKind::Url ||
                (parser.current().kind == TokenKind::Identifier &&
                 (parser.current().text == "url" || parser.current().text == "URL"))) {
                parser.advance();
                if (!parser.parseURLFunction(urlFunc, error)) {
                    result.success = false;
                    result.error = error;
                    return result;
                }
                hasURLTable = true;
            } else {
                result.success = false;
                result.error = "Only url() table function is supported in FROM clause";
                return result;
            }
        }

        // Parse WHERE clause
        ExprPtr whereExpr = nullptr;
        if (parser.current().kind == TokenKind::Where) {
            parser.advance();
            whereExpr = parser.parseExpr();
            if (!whereExpr) {
                result.success = false;
                result.error = parser.getError().empty() ? "Failed to parse WHERE condition" : parser.getError();
                return result;
            }
        }

        if (!hasURLTable) {
            result.success = false;
            result.error = "url() table function required in FROM clause";
            return result;
        }

        // Fetch and parse data from URL
        auto fetchResult = URLFetcher::fetch(urlFunc.url, urlFunc.format);
        if (!fetchResult.success) {
            result.success = false;
            result.error = fetchResult.error;
            return result;
        }

        // Handle SELECT *
        bool hasStar = false;
        for (const auto& col : selectCols) {
            if (col.expr->kind == ExprKind::Star) {
                hasStar = true;
                break;
            }
        }

        if (hasStar) {
            std::vector<SelectColumn> expanded;
            for (const auto& col : selectCols) {
                if (col.expr->kind == ExprKind::Star) {
                    for (const auto& tcol : fetchResult.columns) {
                        SelectColumn sc;
                        sc.expr = Expr::makeColumnRef(tcol.name);
                        sc.alias = tcol.name;
                        expanded.push_back(sc);
                    }
                } else {
                    expanded.push_back(col);
                }
            }
            selectCols = std::move(expanded);
        }

        // Build result columns
        for (size_t i = 0; i < selectCols.size(); i++) {
            ColumnDef col;
            if (!selectCols[i].alias.empty()) {
                col.name = selectCols[i].alias;
            } else if (selectCols[i].expr->kind == ExprKind::ColumnRef) {
                col.name = selectCols[i].expr->columnName;
            } else {
                col.name = "column" + std::to_string(i);
            }
            col.type = DataType::String;
            result.columns.push_back(col);
        }

        // Filter and project rows
        for (const auto& srcRow : fetchResult.rows) {
            ExprEvaluator eval(&fetchResult.columns, &srcRow);

            // Check WHERE condition
            if (whereExpr && !eval.evaluateBool(whereExpr)) {
                continue;
            }

            // Evaluate SELECT expressions
            Row outRow;
            for (const auto& col : selectCols) {
                outRow.push_back(eval.evaluate(col.expr));
            }
            result.rows.push_back(std::move(outRow));
        }

        return result;
    }
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatResultCSV(const QueryResult& result) {
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

std::string formatResultTSV(const QueryResult& result) {
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

std::string formatResultJSON(const QueryResult& result) {
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
// Context
// ============================================================================

struct URLContext {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;

    URLContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~URLContext() {
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
 * Create a new URL query context.
 */
EXPORT
void* url_query_create() {
    return new URLContext();
}

/**
 * Destroy a URL query context.
 */
EXPORT
void url_query_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<URLContext*>(ctx);
    }
}

/**
 * Execute a SQL query with url() table function.
 * @param ctx Query context
 * @param query SQL query string (e.g., "SELECT * FROM url('https://...', 'JSON')")
 * @param query_len Length of query
 * @param format Output format: "CSV", "TSV", "JSON"
 * @return 0 on success, -1 on error
 */
EXPORT
int url_query_execute(void* ctx, const char* query, size_t query_len, const char* format) {
    if (!ctx || !query) return -1;

    URLContext* urlCtx = static_cast<URLContext*>(ctx);
    URLQueryExecutor executor;

    QueryResult result = executor.execute(query, query_len);

    if (!result.success) {
        urlCtx->setError(result.error);
        return -1;
    }

    // Format result
    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatResultJSON(result);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        output = formatResultTSV(result);
    } else {
        output = formatResultCSV(result);
    }

    urlCtx->setResult(output);
    return 0;
}

/**
 * Get the result buffer from last query.
 */
EXPORT
const char* url_query_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<URLContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last query.
 */
EXPORT
size_t url_query_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<URLContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last query.
 */
EXPORT
const char* url_query_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<URLContext*>(ctx)->lastError;
}

/**
 * Test function to verify the module loaded correctly.
 * Note: Full fetch tests require a running server or mock.
 */
EXPORT
int url_query_test() {
    // Test 1: Parser test
    {
        const char* sql = "SELECT * FROM url('https://example.com/data.json', 'JSON')";
        Lexer lexer(sql, strlen(sql));
        Parser parser(lexer);

        // Should parse SELECT
        if (parser.current().kind != TokenKind::Select) return -1;
        parser.advance();

        // Should parse *
        auto expr = parser.parseExpr();
        if (!expr || expr->kind != ExprKind::Star) return -2;

        // Should parse FROM
        if (parser.current().kind != TokenKind::From) return -3;
        parser.advance();

        // Should parse url()
        if (parser.current().kind != TokenKind::Url) return -4;
        parser.advance();

        URLTableFunc func;
        std::string error;
        if (!parser.parseURLFunction(func, error)) return -5;
        if (func.url != "https://example.com/data.json") return -6;
        if (func.format != FormatType::JSON) return -7;
    }

    // Test 2: JSON parser test
    {
        std::string json = R"([{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}])";
        JSONParser parser(json);
        std::vector<ColumnDef> columns;
        std::vector<Row> rows;

        if (!parser.parseArrayOfObjects(columns, rows)) return -10;
        if (columns.size() != 2) return -11;
        if (rows.size() != 2) return -12;
    }

    // Test 3: CSV parser test
    {
        std::string csv = "name,age\nAlice,30\nBob,25\n";
        CSVParser parser(csv);
        std::vector<ColumnDef> columns;
        std::vector<Row> rows;

        if (!parser.parseHeader(columns)) return -20;
        if (columns.size() != 2) return -21;
        if (columns[0].name != "name") return -22;
        if (columns[1].name != "age") return -23;

        if (!parser.parseRows(columns, rows)) return -24;
        if (rows.size() != 2) return -25;
    }

    // Test 4: Expression evaluator test
    {
        std::vector<ColumnDef> columns = {
            {"name", DataType::String, true},
            {"age", DataType::Int64, true}
        };
        Row row = {std::string("Alice"), int64_t{30}};

        ExprEvaluator eval(&columns, &row);

        auto nameExpr = Expr::makeColumnRef("name");
        Value nameVal = eval.evaluate(nameExpr);
        if (!std::holds_alternative<std::string>(nameVal)) return -30;
        if (std::get<std::string>(nameVal) != "Alice") return -31;

        auto ageExpr = Expr::makeColumnRef("age");
        Value ageVal = eval.evaluate(ageExpr);
        if (!std::holds_alternative<int64_t>(ageVal)) return -32;
        if (std::get<int64_t>(ageVal) != 30) return -33;

        // Test comparison
        auto cmpExpr = Expr::makeCompareOp(">", ageExpr, Expr::makeLiteral(int64_t{25}));
        if (!eval.evaluateBool(cmpExpr)) return -34;
    }

    return 0; // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* url_query_version() {
    return "chdb-url-table-function 0.1.0 (WASM URL table function)";
}

} // extern "C"
