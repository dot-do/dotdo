/**
 * json_format.cpp - JSON Format Parser Module for WASM
 *
 * This provides JSON parsing and extraction functions compatible with ClickHouse's
 * JSON functions, designed as a lightweight WASM module.
 *
 * Supported formats:
 *   - JSON (full JSON documents)
 *   - JSONEachRow (newline-delimited JSON)
 *   - JSONCompact (arrays instead of objects)
 *
 * Supported functions:
 *   - JSONExtractString(json, path)
 *   - JSONExtractInt(json, path)
 *   - JSONExtractFloat(json, path)
 *   - JSONExtractBool(json, path)
 *   - JSONExtractArrayRaw(json, path)
 *   - JSONHas(json, path)
 *   - JSONLength(json)
 *   - JSONType(json, path)
 *
 * Build with: emcc -Os -fno-exceptions -DJSON_FORMAT_BUILD
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <cerrno>
#include <string>
#include <vector>
#include <variant>
#include <memory>
#include <sstream>
#include <iomanip>
#include <cctype>
#include <cmath>
#include <map>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// JSON Value Types
// ============================================================================

enum class JSONType {
    Null,
    Bool,
    Int,
    Float,
    String,
    Array,
    Object
};

const char* jsonTypeName(JSONType type) {
    switch (type) {
        case JSONType::Null:   return "Null";
        case JSONType::Bool:   return "Bool";
        case JSONType::Int:    return "Int";
        case JSONType::Float:  return "Float";
        case JSONType::String: return "String";
        case JSONType::Array:  return "Array";
        case JSONType::Object: return "Object";
        default:               return "Unknown";
    }
}

// Forward declarations
struct JSONValue;
using JSONValuePtr = std::shared_ptr<JSONValue>;
using JSONArray = std::vector<JSONValuePtr>;
using JSONObject = std::map<std::string, JSONValuePtr>;

struct JSONValue {
    JSONType type;

    // Value storage (using union-like semantics via variant)
    bool boolVal;
    int64_t intVal;
    double floatVal;
    std::string stringVal;
    JSONArray arrayVal;
    JSONObject objectVal;

    JSONValue() : type(JSONType::Null), boolVal(false), intVal(0), floatVal(0.0) {}

    static JSONValuePtr makeNull() {
        return std::make_shared<JSONValue>();
    }

    static JSONValuePtr makeBool(bool v) {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::Bool;
        val->boolVal = v;
        return val;
    }

    static JSONValuePtr makeInt(int64_t v) {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::Int;
        val->intVal = v;
        return val;
    }

    static JSONValuePtr makeFloat(double v) {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::Float;
        val->floatVal = v;
        return val;
    }

    static JSONValuePtr makeString(const std::string& v) {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::String;
        val->stringVal = v;
        return val;
    }

    static JSONValuePtr makeArray() {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::Array;
        return val;
    }

    static JSONValuePtr makeObject() {
        auto val = std::make_shared<JSONValue>();
        val->type = JSONType::Object;
        return val;
    }
};

// ============================================================================
// Lightweight JSON Parser
// ============================================================================

class JSONParser {
public:
    JSONParser(const char* input, size_t len)
        : input_(input), len_(len), pos_(0) {}

    JSONValuePtr parse() {
        skipWhitespace();
        if (pos_ >= len_) {
            error_ = "Empty input";
            return nullptr;
        }

        auto result = parseValue();

        if (result) {
            skipWhitespace();
            // Allow trailing content (for JSONEachRow compatibility)
        }

        return result;
    }

    std::string getError() const { return error_; }
    size_t getPosition() const { return pos_; }

private:
    void skipWhitespace() {
        while (pos_ < len_ && std::isspace(static_cast<unsigned char>(input_[pos_]))) {
            pos_++;
        }
    }

    char peek() const {
        return pos_ < len_ ? input_[pos_] : '\0';
    }

    char advance() {
        return pos_ < len_ ? input_[pos_++] : '\0';
    }

    bool match(char expected) {
        skipWhitespace();
        if (peek() == expected) {
            advance();
            return true;
        }
        return false;
    }

    bool matchKeyword(const char* keyword) {
        size_t klen = strlen(keyword);
        if (pos_ + klen > len_) return false;

        for (size_t i = 0; i < klen; i++) {
            if (input_[pos_ + i] != keyword[i]) return false;
        }
        pos_ += klen;
        return true;
    }

    JSONValuePtr parseValue() {
        skipWhitespace();

        char c = peek();

        if (c == '"' || c == '\'') {
            return parseString();
        }
        if (c == '{') {
            return parseObject();
        }
        if (c == '[') {
            return parseArray();
        }
        if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) {
            return parseNumber();
        }
        if (c == 't' || c == 'f') {
            return parseBool();
        }
        if (c == 'n') {
            return parseNull();
        }

        error_ = std::string("Unexpected character: ") + c;
        return nullptr;
    }

    JSONValuePtr parseString() {
        char quote = advance(); // consume opening quote
        std::string result;

        while (pos_ < len_) {
            char c = advance();

            if (c == quote) {
                return JSONValue::makeString(result);
            }

            if (c == '\\') {
                if (pos_ >= len_) {
                    error_ = "Unexpected end of string escape";
                    return nullptr;
                }
                char escaped = advance();
                switch (escaped) {
                    case '"':  result += '"'; break;
                    case '\'': result += '\''; break;
                    case '\\': result += '\\'; break;
                    case '/':  result += '/'; break;
                    case 'b':  result += '\b'; break;
                    case 'f':  result += '\f'; break;
                    case 'n':  result += '\n'; break;
                    case 'r':  result += '\r'; break;
                    case 't':  result += '\t'; break;
                    case 'u': {
                        // Unicode escape \uXXXX
                        if (pos_ + 4 > len_) {
                            error_ = "Invalid unicode escape";
                            return nullptr;
                        }
                        char hex[5] = {0};
                        for (int i = 0; i < 4; i++) {
                            hex[i] = advance();
                        }
                        unsigned int codepoint = 0;
                        if (sscanf(hex, "%4x", &codepoint) != 1) {
                            error_ = "Invalid unicode escape";
                            return nullptr;
                        }
                        // Simple UTF-8 encoding for BMP characters
                        if (codepoint < 0x80) {
                            result += static_cast<char>(codepoint);
                        } else if (codepoint < 0x800) {
                            result += static_cast<char>(0xC0 | (codepoint >> 6));
                            result += static_cast<char>(0x80 | (codepoint & 0x3F));
                        } else {
                            result += static_cast<char>(0xE0 | (codepoint >> 12));
                            result += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
                            result += static_cast<char>(0x80 | (codepoint & 0x3F));
                        }
                        break;
                    }
                    default:
                        result += escaped;
                        break;
                }
            } else {
                result += c;
            }
        }

        error_ = "Unclosed string";
        return nullptr;
    }

    JSONValuePtr parseNumber() {
        size_t start = pos_;
        bool isFloat = false;

        // Handle negative sign
        if (peek() == '-') advance();

        // Integer part
        if (peek() == '0') {
            advance();
        } else if (std::isdigit(static_cast<unsigned char>(peek()))) {
            while (std::isdigit(static_cast<unsigned char>(peek()))) {
                advance();
            }
        } else {
            error_ = "Invalid number";
            return nullptr;
        }

        // Fractional part
        if (peek() == '.') {
            isFloat = true;
            advance();
            if (!std::isdigit(static_cast<unsigned char>(peek()))) {
                error_ = "Invalid number: expected digit after decimal point";
                return nullptr;
            }
            while (std::isdigit(static_cast<unsigned char>(peek()))) {
                advance();
            }
        }

        // Exponent part
        if (peek() == 'e' || peek() == 'E') {
            isFloat = true;
            advance();
            if (peek() == '+' || peek() == '-') {
                advance();
            }
            if (!std::isdigit(static_cast<unsigned char>(peek()))) {
                error_ = "Invalid number: expected digit in exponent";
                return nullptr;
            }
            while (std::isdigit(static_cast<unsigned char>(peek()))) {
                advance();
            }
        }

        std::string numStr(input_ + start, pos_ - start);

        if (isFloat) {
            return JSONValue::makeFloat(strtod(numStr.c_str(), nullptr));
        } else {
            // Check if it fits in int64_t using strtoll
            char* endptr = nullptr;
            errno = 0;
            long long val = strtoll(numStr.c_str(), &endptr, 10);
            if (errno == ERANGE) {
                // Fall back to float for very large numbers
                return JSONValue::makeFloat(strtod(numStr.c_str(), nullptr));
            }
            return JSONValue::makeInt(static_cast<int64_t>(val));
        }
    }

    JSONValuePtr parseBool() {
        if (matchKeyword("true")) {
            return JSONValue::makeBool(true);
        }
        if (matchKeyword("false")) {
            return JSONValue::makeBool(false);
        }
        error_ = "Invalid boolean value";
        return nullptr;
    }

    JSONValuePtr parseNull() {
        if (matchKeyword("null")) {
            return JSONValue::makeNull();
        }
        error_ = "Invalid null value";
        return nullptr;
    }

    JSONValuePtr parseArray() {
        advance(); // consume '['

        auto arr = JSONValue::makeArray();

        skipWhitespace();
        if (peek() == ']') {
            advance();
            return arr;
        }

        while (true) {
            auto elem = parseValue();
            if (!elem) return nullptr;

            arr->arrayVal.push_back(elem);

            skipWhitespace();
            if (peek() == ']') {
                advance();
                return arr;
            }
            if (peek() != ',') {
                error_ = "Expected ',' or ']' in array";
                return nullptr;
            }
            advance(); // consume ','
        }
    }

    JSONValuePtr parseObject() {
        advance(); // consume '{'

        auto obj = JSONValue::makeObject();

        skipWhitespace();
        if (peek() == '}') {
            advance();
            return obj;
        }

        while (true) {
            skipWhitespace();

            // Parse key (must be a string)
            if (peek() != '"' && peek() != '\'') {
                error_ = "Expected string key in object";
                return nullptr;
            }

            auto keyVal = parseString();
            if (!keyVal) return nullptr;
            std::string key = keyVal->stringVal;

            skipWhitespace();
            if (peek() != ':') {
                error_ = "Expected ':' after object key";
                return nullptr;
            }
            advance();

            auto value = parseValue();
            if (!value) return nullptr;

            obj->objectVal[key] = value;

            skipWhitespace();
            if (peek() == '}') {
                advance();
                return obj;
            }
            if (peek() != ',') {
                error_ = "Expected ',' or '}' in object";
                return nullptr;
            }
            advance(); // consume ','
        }
    }

    const char* input_;
    size_t len_;
    size_t pos_;
    std::string error_;
};

// ============================================================================
// Path Navigation
// ============================================================================

// Parse a JSONPath-like path: "key1.key2[0].key3" or just "key"
// Returns the value at that path, or nullptr if not found
JSONValuePtr navigatePath(const JSONValuePtr& root, const char* path, size_t pathLen) {
    if (!root || pathLen == 0) return root;

    JSONValuePtr current = root;
    size_t pos = 0;

    while (pos < pathLen && current) {
        // Skip leading dots or spaces
        while (pos < pathLen && (path[pos] == '.' || path[pos] == ' ')) {
            pos++;
        }
        if (pos >= pathLen) break;

        // Check for array index [n]
        if (path[pos] == '[') {
            pos++; // skip '['

            // Parse index
            size_t indexStart = pos;
            while (pos < pathLen && std::isdigit(static_cast<unsigned char>(path[pos]))) {
                pos++;
            }

            if (pos < pathLen && path[pos] == ']') {
                std::string indexStr(path + indexStart, pos - indexStart);
                size_t index = std::stoul(indexStr);
                pos++; // skip ']'

                if (current->type != JSONType::Array || index >= current->arrayVal.size()) {
                    return nullptr;
                }
                current = current->arrayVal[index];
            } else {
                return nullptr; // malformed path
            }
        } else {
            // Parse key name
            size_t keyStart = pos;
            while (pos < pathLen && path[pos] != '.' && path[pos] != '[') {
                pos++;
            }

            if (pos > keyStart) {
                std::string key(path + keyStart, pos - keyStart);

                if (current->type != JSONType::Object) {
                    return nullptr;
                }

                auto it = current->objectVal.find(key);
                if (it == current->objectVal.end()) {
                    return nullptr;
                }
                current = it->second;
            }
        }
    }

    return current;
}

// ============================================================================
// Type Coercion
// ============================================================================

// Forward declaration for serializeJSON (used by coerceToString)
std::string serializeJSON(const JSONValuePtr& val);

int64_t coerceToInt(const JSONValuePtr& val, bool& success) {
    success = true;
    if (!val) {
        success = false;
        return 0;
    }

    switch (val->type) {
        case JSONType::Int:
            return val->intVal;
        case JSONType::Float:
            return static_cast<int64_t>(val->floatVal);
        case JSONType::Bool:
            return val->boolVal ? 1 : 0;
        case JSONType::String: {
            // Safely parse integer without exceptions
            const char* str = val->stringVal.c_str();
            char* endptr = nullptr;
            errno = 0;
            long long result = strtoll(str, &endptr, 10);
            if (errno == 0 && endptr != str && *endptr == '\0') {
                return static_cast<int64_t>(result);
            }
            // Try as float then convert
            errno = 0;
            double d = strtod(str, &endptr);
            if (errno == 0 && endptr != str && *endptr == '\0') {
                return static_cast<int64_t>(d);
            }
            success = false;
            return 0;
        }
        default:
            success = false;
            return 0;
    }
}

double coerceToFloat(const JSONValuePtr& val, bool& success) {
    success = true;
    if (!val) {
        success = false;
        return 0.0;
    }

    switch (val->type) {
        case JSONType::Int:
            return static_cast<double>(val->intVal);
        case JSONType::Float:
            return val->floatVal;
        case JSONType::Bool:
            return val->boolVal ? 1.0 : 0.0;
        case JSONType::String: {
            // Safely parse float without exceptions
            const char* str = val->stringVal.c_str();
            char* endptr = nullptr;
            errno = 0;
            double result = strtod(str, &endptr);
            if (errno == 0 && endptr != str && *endptr == '\0') {
                return result;
            }
            success = false;
            return 0.0;
        }
        default:
            success = false;
            return 0.0;
    }
}

std::string coerceToString(const JSONValuePtr& val) {
    if (!val) return "";

    switch (val->type) {
        case JSONType::Null:
            return "null";
        case JSONType::Bool:
            return val->boolVal ? "true" : "false";
        case JSONType::Int:
            return std::to_string(val->intVal);
        case JSONType::Float: {
            std::ostringstream oss;
            oss << std::setprecision(15) << val->floatVal;
            return oss.str();
        }
        case JSONType::String:
            return val->stringVal;
        case JSONType::Array:
        case JSONType::Object:
            // Return JSON representation
            return serializeJSON(val);
        default:
            return "";
    }
}

bool coerceToBool(const JSONValuePtr& val, bool& success) {
    success = true;
    if (!val) {
        success = false;
        return false;
    }

    switch (val->type) {
        case JSONType::Bool:
            return val->boolVal;
        case JSONType::Int:
            return val->intVal != 0;
        case JSONType::Float:
            return val->floatVal != 0.0;
        case JSONType::String: {
            std::string lower = val->stringVal;
            for (char& c : lower) c = std::tolower(static_cast<unsigned char>(c));
            if (lower == "true" || lower == "1") return true;
            if (lower == "false" || lower == "0" || lower.empty()) return false;
            success = false;
            return false;
        }
        case JSONType::Null:
            return false;
        default:
            success = false;
            return false;
    }
}

std::string serializeJSON(const JSONValuePtr& val) {
    if (!val) return "null";

    switch (val->type) {
        case JSONType::Null:
            return "null";
        case JSONType::Bool:
            return val->boolVal ? "true" : "false";
        case JSONType::Int:
            return std::to_string(val->intVal);
        case JSONType::Float: {
            std::ostringstream oss;
            oss << std::setprecision(15) << val->floatVal;
            return oss.str();
        }
        case JSONType::String: {
            std::string result = "\"";
            for (char c : val->stringVal) {
                switch (c) {
                    case '"':  result += "\\\""; break;
                    case '\\': result += "\\\\"; break;
                    case '\b': result += "\\b"; break;
                    case '\f': result += "\\f"; break;
                    case '\n': result += "\\n"; break;
                    case '\r': result += "\\r"; break;
                    case '\t': result += "\\t"; break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20) {
                            char buf[8];
                            snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                            result += buf;
                        } else {
                            result += c;
                        }
                        break;
                }
            }
            result += "\"";
            return result;
        }
        case JSONType::Array: {
            std::string result = "[";
            for (size_t i = 0; i < val->arrayVal.size(); i++) {
                if (i > 0) result += ",";
                result += serializeJSON(val->arrayVal[i]);
            }
            result += "]";
            return result;
        }
        case JSONType::Object: {
            std::string result = "{";
            bool first = true;
            for (const auto& kv : val->objectVal) {
                if (!first) result += ",";
                first = false;
                result += "\"" + kv.first + "\":" + serializeJSON(kv.second);
            }
            result += "}";
            return result;
        }
        default:
            return "null";
    }
}

// ============================================================================
// Schema Inference
// ============================================================================

struct ColumnSchema {
    std::string name;
    std::string type;
};

std::string inferType(const JSONValuePtr& val) {
    if (!val) return "Nullable(Nothing)";

    switch (val->type) {
        case JSONType::Null:   return "Nullable(Nothing)";
        case JSONType::Bool:   return "UInt8";  // ClickHouse style
        case JSONType::Int:    return "Int64";
        case JSONType::Float:  return "Float64";
        case JSONType::String: return "String";
        case JSONType::Array: {
            if (val->arrayVal.empty()) {
                return "Array(Nothing)";
            }
            // Infer element type from first non-null element
            for (const auto& elem : val->arrayVal) {
                if (elem && elem->type != JSONType::Null) {
                    return "Array(" + inferType(elem) + ")";
                }
            }
            return "Array(Nothing)";
        }
        case JSONType::Object: {
            // For nested objects, we could use Tuple or nested structure
            // Simplified: return as JSON string
            return "String";  // Nested JSON as string
        }
        default:
            return "String";
    }
}

std::vector<ColumnSchema> inferSchemaFromObject(const JSONValuePtr& obj) {
    std::vector<ColumnSchema> schema;

    if (!obj || obj->type != JSONType::Object) {
        return schema;
    }

    for (const auto& kv : obj->objectVal) {
        ColumnSchema col;
        col.name = kv.first;
        col.type = inferType(kv.second);
        schema.push_back(col);
    }

    return schema;
}

// Infer schema from JSONEachRow format (multiple JSON objects)
std::vector<ColumnSchema> inferSchemaFromJSONEachRow(const char* input, size_t len) {
    std::map<std::string, std::string> mergedSchema;

    size_t pos = 0;
    while (pos < len) {
        // Skip whitespace and newlines
        while (pos < len && (std::isspace(static_cast<unsigned char>(input[pos])))) {
            pos++;
        }
        if (pos >= len) break;

        // Parse one JSON object
        JSONParser parser(input + pos, len - pos);
        auto obj = parser.parse();

        if (obj && obj->type == JSONType::Object) {
            for (const auto& kv : obj->objectVal) {
                std::string inferredType = inferType(kv.second);
                auto it = mergedSchema.find(kv.first);
                if (it == mergedSchema.end()) {
                    mergedSchema[kv.first] = inferredType;
                } else {
                    // Merge types (simple: prefer more general type)
                    // String > Float64 > Int64 > UInt8 > Nullable
                    if (inferredType == "String" || it->second == "String") {
                        it->second = "String";
                    } else if (inferredType == "Float64" || it->second == "Float64") {
                        it->second = "Float64";
                    }
                    // Otherwise keep existing type
                }
            }
        }

        pos += parser.getPosition();

        // Skip to next line
        while (pos < len && input[pos] != '\n') pos++;
        if (pos < len) pos++; // skip newline
    }

    std::vector<ColumnSchema> result;
    for (const auto& kv : mergedSchema) {
        result.push_back({kv.first, kv.second});
    }
    return result;
}

// ============================================================================
// JSONEachRow Parser
// ============================================================================

struct JSONEachRowParser {
    std::vector<JSONValuePtr> rows;
    std::string error;

    bool parse(const char* input, size_t len) {
        rows.clear();
        error.clear();

        size_t pos = 0;
        int lineNum = 1;

        while (pos < len) {
            // Skip whitespace
            while (pos < len && std::isspace(static_cast<unsigned char>(input[pos]))) {
                if (input[pos] == '\n') lineNum++;
                pos++;
            }
            if (pos >= len) break;

            // Parse one JSON value (usually an object)
            JSONParser parser(input + pos, len - pos);
            auto row = parser.parse();

            if (!row) {
                error = "Line " + std::to_string(lineNum) + ": " + parser.getError();
                return false;
            }

            rows.push_back(row);
            pos += parser.getPosition();

            // Skip to next line or comma (for JSON array of objects)
            while (pos < len && input[pos] != '\n' && input[pos] != ',') {
                if (!std::isspace(static_cast<unsigned char>(input[pos]))) {
                    // Unexpected character
                    break;
                }
                pos++;
            }
            if (pos < len && (input[pos] == '\n' || input[pos] == ',')) {
                if (input[pos] == '\n') lineNum++;
                pos++;
            }
        }

        return true;
    }
};

// ============================================================================
// JSONCompact Parser (arrays instead of object keys)
// ============================================================================

struct JSONCompactParser {
    std::vector<std::string> columnNames;
    std::vector<std::vector<JSONValuePtr>> rows;
    std::string error;

    bool parse(const char* input, size_t len) {
        rows.clear();
        columnNames.clear();
        error.clear();

        JSONParser parser(input, len);
        auto root = parser.parse();

        if (!root) {
            error = parser.getError();
            return false;
        }

        // JSONCompact format:
        // {
        //   "meta": [{"name": "col1", "type": "..."}, ...],
        //   "data": [[val1, val2], [val1, val2], ...]
        // }

        if (root->type != JSONType::Object) {
            error = "Expected object at root";
            return false;
        }

        // Parse meta
        auto metaIt = root->objectVal.find("meta");
        if (metaIt != root->objectVal.end() && metaIt->second->type == JSONType::Array) {
            for (const auto& col : metaIt->second->arrayVal) {
                if (col->type == JSONType::Object) {
                    auto nameIt = col->objectVal.find("name");
                    if (nameIt != col->objectVal.end() && nameIt->second->type == JSONType::String) {
                        columnNames.push_back(nameIt->second->stringVal);
                    }
                }
            }
        }

        // Parse data
        auto dataIt = root->objectVal.find("data");
        if (dataIt != root->objectVal.end() && dataIt->second->type == JSONType::Array) {
            for (const auto& row : dataIt->second->arrayVal) {
                if (row->type == JSONType::Array) {
                    rows.push_back(row->arrayVal);
                }
            }
        }

        return true;
    }
};

// ============================================================================
// JSON Format Context
// ============================================================================

struct JSONFormatContext {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;
    JSONValuePtr parsedValue;
    std::vector<ColumnSchema> inferredSchema;

    JSONFormatContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~JSONFormatContext() {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const std::string& result) {
        if (lastResult) free(lastResult);
        if (lastError) { free(lastError); lastError = nullptr; }
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
 * Create a new JSON format context.
 */
EXPORT
void* json_format_create() {
    return new JSONFormatContext();
}

/**
 * Destroy a JSON format context.
 */
EXPORT
void json_format_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<JSONFormatContext*>(ctx);
    }
}

/**
 * Parse a JSON document.
 * @return 0 on success, -1 on error
 */
EXPORT
int json_parse(void* ctx, const char* json, size_t json_len) {
    if (!ctx || !json) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);

    JSONParser parser(json, json_len);
    jctx->parsedValue = parser.parse();

    if (!jctx->parsedValue) {
        jctx->setError(parser.getError());
        return -1;
    }

    return 0;
}

/**
 * Parse JSONEachRow format (newline-delimited JSON).
 * @return Number of rows parsed, or -1 on error
 */
EXPORT
int json_parse_each_row(void* ctx, const char* json, size_t json_len,
                        void** rows_out, size_t* row_count_out) {
    if (!ctx || !json) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);

    JSONEachRowParser parser;
    if (!parser.parse(json, json_len)) {
        jctx->setError(parser.error);
        return -1;
    }

    // Store as array for subsequent operations
    auto arr = JSONValue::makeArray();
    arr->arrayVal = parser.rows;
    jctx->parsedValue = arr;

    return static_cast<int>(parser.rows.size());
}

/**
 * Extract a string value at the given path.
 * Path can be: "key", "key1.key2", "key[0]", "key1.key2[0].key3"
 */
EXPORT
int json_extract_string(void* ctx, const char* path, size_t path_len) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);
    if (!val) {
        jctx->setResult("");
        return 0;
    }

    jctx->setResult(coerceToString(val));
    return 0;
}

/**
 * Extract an integer value at the given path.
 * Returns the integer in the result buffer.
 */
EXPORT
int json_extract_int(void* ctx, const char* path, size_t path_len, int64_t* value_out) {
    if (!ctx || !value_out) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);

    bool success;
    *value_out = coerceToInt(val, success);

    if (!success) {
        jctx->setError("Cannot convert to integer");
        return -1;
    }

    return 0;
}

/**
 * Extract a float value at the given path.
 */
EXPORT
int json_extract_float(void* ctx, const char* path, size_t path_len, double* value_out) {
    if (!ctx || !value_out) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);

    bool success;
    *value_out = coerceToFloat(val, success);

    if (!success) {
        jctx->setError("Cannot convert to float");
        return -1;
    }

    return 0;
}

/**
 * Extract a boolean value at the given path.
 */
EXPORT
int json_extract_bool(void* ctx, const char* path, size_t path_len, int* value_out) {
    if (!ctx || !value_out) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);

    bool success;
    bool result = coerceToBool(val, success);
    *value_out = result ? 1 : 0;

    if (!success) {
        jctx->setError("Cannot convert to boolean");
        return -1;
    }

    return 0;
}

/**
 * Extract an array as raw JSON at the given path.
 */
EXPORT
int json_extract_array_raw(void* ctx, const char* path, size_t path_len) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);
    if (!val || val->type != JSONType::Array) {
        jctx->setResult("[]");
        return 0;
    }

    jctx->setResult(serializeJSON(val));
    return 0;
}

/**
 * Check if a path exists in the JSON.
 * @return 1 if exists, 0 if not exists, -1 on error
 */
EXPORT
int json_has(void* ctx, const char* path, size_t path_len) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        return -1;
    }

    JSONValuePtr val = navigatePath(jctx->parsedValue, path, path_len);
    return val ? 1 : 0;
}

/**
 * Get the length of an array or object at the given path.
 * For arrays: number of elements
 * For objects: number of keys
 * For strings: string length
 * @return Length, or -1 on error
 */
EXPORT
int json_length(void* ctx, const char* path, size_t path_len) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        return -1;
    }

    JSONValuePtr val;
    if (path_len == 0) {
        val = jctx->parsedValue;
    } else {
        val = navigatePath(jctx->parsedValue, path, path_len);
    }

    if (!val) return -1;

    switch (val->type) {
        case JSONType::Array:
            return static_cast<int>(val->arrayVal.size());
        case JSONType::Object:
            return static_cast<int>(val->objectVal.size());
        case JSONType::String:
            return static_cast<int>(val->stringVal.length());
        default:
            return 1;  // Scalars have length 1
    }
}

/**
 * Get the type of the value at the given path.
 * Result is stored in the result buffer.
 */
EXPORT
int json_type(void* ctx, const char* path, size_t path_len) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    JSONValuePtr val;
    if (path_len == 0) {
        val = jctx->parsedValue;
    } else {
        val = navigatePath(jctx->parsedValue, path, path_len);
    }

    if (!val) {
        jctx->setResult("Null");
        return 0;
    }

    jctx->setResult(jsonTypeName(val->type));
    return 0;
}

/**
 * Infer schema from JSON (single object).
 * Result is stored as comma-separated "name:type" pairs.
 */
EXPORT
int json_infer_schema(void* ctx) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    auto schema = inferSchemaFromObject(jctx->parsedValue);
    jctx->inferredSchema = schema;

    // Format as string
    std::string result;
    for (size_t i = 0; i < schema.size(); i++) {
        if (i > 0) result += ", ";
        result += schema[i].name + " " + schema[i].type;
    }

    jctx->setResult(result);
    return static_cast<int>(schema.size());
}

/**
 * Infer schema from JSONEachRow format.
 * @param json Multiple JSON objects, one per line
 */
EXPORT
int json_infer_schema_each_row(void* ctx, const char* json, size_t json_len) {
    if (!ctx || !json) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);

    auto schema = inferSchemaFromJSONEachRow(json, json_len);
    jctx->inferredSchema = schema;

    // Format as string
    std::string result;
    for (size_t i = 0; i < schema.size(); i++) {
        if (i > 0) result += ", ";
        result += schema[i].name + " " + schema[i].type;
    }

    jctx->setResult(result);
    return static_cast<int>(schema.size());
}

/**
 * Parse JSONCompact format.
 * @return Number of data rows, or -1 on error
 */
EXPORT
int json_parse_compact(void* ctx, const char* json, size_t json_len) {
    if (!ctx || !json) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);

    JSONCompactParser parser;
    if (!parser.parse(json, json_len)) {
        jctx->setError(parser.error);
        return -1;
    }

    // Store column names in result
    std::string colNames;
    for (size_t i = 0; i < parser.columnNames.size(); i++) {
        if (i > 0) colNames += ",";
        colNames += parser.columnNames[i];
    }
    jctx->setResult(colNames);

    // Convert to array of objects for subsequent extraction
    auto arr = JSONValue::makeArray();
    for (const auto& row : parser.rows) {
        auto obj = JSONValue::makeObject();
        for (size_t i = 0; i < row.size() && i < parser.columnNames.size(); i++) {
            obj->objectVal[parser.columnNames[i]] = row[i];
        }
        arr->arrayVal.push_back(obj);
    }
    jctx->parsedValue = arr;

    return static_cast<int>(parser.rows.size());
}

/**
 * Get the result buffer from last operation.
 */
EXPORT
const char* json_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<JSONFormatContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last operation.
 */
EXPORT
size_t json_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<JSONFormatContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last operation.
 */
EXPORT
const char* json_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<JSONFormatContext*>(ctx)->lastError;
}

/**
 * Serialize the current parsed value back to JSON.
 */
EXPORT
int json_serialize(void* ctx) {
    if (!ctx) return -1;

    JSONFormatContext* jctx = static_cast<JSONFormatContext*>(ctx);
    if (!jctx->parsedValue) {
        jctx->setError("No JSON parsed");
        return -1;
    }

    jctx->setResult(serializeJSON(jctx->parsedValue));
    return 0;
}

/**
 * Test function to verify the module loaded correctly.
 */
EXPORT
int json_format_test() {
    // Test 1: Parse simple object
    {
        JSONFormatContext ctx;
        const char* json = "{\"name\":\"Alice\",\"age\":30}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -1;

        int64_t age;
        if (json_extract_int(&ctx, "age", 3, &age) != 0) return -2;
        if (age != 30) return -3;

        if (json_extract_string(&ctx, "name", 4) != 0) return -4;
        if (strcmp(ctx.lastResult, "Alice") != 0) return -5;
    }

    // Test 2: Parse nested object
    {
        JSONFormatContext ctx;
        const char* json = "{\"user\":{\"name\":\"Bob\",\"scores\":[95,87,92]}}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -6;

        if (json_extract_string(&ctx, "user.name", 9) != 0) return -7;
        if (strcmp(ctx.lastResult, "Bob") != 0) return -8;

        int64_t score;
        if (json_extract_int(&ctx, "user.scores[1]", 14, &score) != 0) return -9;
        if (score != 87) return -10;
    }

    // Test 3: Type coercion
    {
        JSONFormatContext ctx;
        const char* json = "{\"str_num\":\"42\",\"float_num\":3.14}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -11;

        int64_t num;
        if (json_extract_int(&ctx, "str_num", 7, &num) != 0) return -12;
        if (num != 42) return -13;

        double fnum;
        if (json_extract_float(&ctx, "float_num", 9, &fnum) != 0) return -14;
        if (fnum < 3.13 || fnum > 3.15) return -15;
    }

    // Test 4: JSONHas
    {
        JSONFormatContext ctx;
        const char* json = "{\"a\":{\"b\":1}}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -16;

        if (json_has(&ctx, "a.b", 3) != 1) return -17;
        if (json_has(&ctx, "a.c", 3) != 0) return -18;
    }

    // Test 5: JSONLength
    {
        JSONFormatContext ctx;
        const char* json = "[1,2,3,4,5]";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -19;

        if (json_length(&ctx, "", 0) != 5) return -20;
    }

    // Test 6: JSONType
    {
        JSONFormatContext ctx;
        const char* json = "{\"num\":42,\"str\":\"hello\",\"arr\":[1,2]}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -21;

        if (json_type(&ctx, "num", 3) != 0) return -22;
        if (strcmp(ctx.lastResult, "Int") != 0) return -23;

        if (json_type(&ctx, "str", 3) != 0) return -24;
        if (strcmp(ctx.lastResult, "String") != 0) return -25;

        if (json_type(&ctx, "arr", 3) != 0) return -26;
        if (strcmp(ctx.lastResult, "Array") != 0) return -27;
    }

    // Test 7: Schema inference
    {
        JSONFormatContext ctx;
        const char* json = "{\"id\":1,\"name\":\"test\",\"active\":true,\"score\":95.5}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -28;

        int numCols = json_infer_schema(&ctx);
        if (numCols != 4) return -29;
    }

    // Test 8: Boolean extraction
    {
        JSONFormatContext ctx;
        const char* json = "{\"active\":true,\"disabled\":false}";
        if (json_parse(&ctx, json, strlen(json)) != 0) return -30;

        int active;
        if (json_extract_bool(&ctx, "active", 6, &active) != 0) return -31;
        if (active != 1) return -32;

        int disabled;
        if (json_extract_bool(&ctx, "disabled", 8, &disabled) != 0) return -33;
        if (disabled != 0) return -34;
    }

    return 0; // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* json_format_version() {
    return "chdb-json-format 0.1.0 (WASM JSON parser)";
}

} // extern "C"
