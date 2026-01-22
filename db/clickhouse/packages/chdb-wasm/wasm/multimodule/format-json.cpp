/**
 * format-json.cpp - JSON Format Module (Lazily Loaded)
 *
 * This module handles JSON parsing and serialization for the multi-module
 * architecture. It is loaded on-demand when a query requires JSON format.
 *
 * Supported formats:
 *   - JSON (full JSON document with metadata)
 *   - JSONEachRow (newline-delimited JSON objects)
 *   - JSONCompact (arrays instead of objects)
 *
 * Build with: emcc -Os -s EXPORTED_FUNCTIONS="['_malloc','_free','_format_as_json','_format_as_json_each_row','_format_as_json_compact','_parse_json','_get_error','_json_version']" -s EXPORTED_RUNTIME_METHODS="['cwrap','ccall','UTF8ToString','stringToUTF8','lengthBytesUTF8']" -o format-json.wasm format-json.cpp
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>
#include <cmath>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT extern "C"
#endif

// ============================================================================
// Error handling
// ============================================================================

static std::string g_last_error;

EXPORT const char* get_error() {
    return g_last_error.c_str();
}

static void set_error(const std::string& msg) {
    g_last_error = msg;
}

static void clear_error() {
    g_last_error.clear();
}

// ============================================================================
// Output Buffer
// ============================================================================

static std::vector<uint8_t> g_output_buffer;

EXPORT uint8_t* get_output_buffer() {
    return g_output_buffer.empty() ? nullptr : g_output_buffer.data();
}

EXPORT int get_output_size() {
    return static_cast<int>(g_output_buffer.size());
}

// ============================================================================
// JSON String Escaping
// ============================================================================

static std::string escape_json_string(const std::string& s) {
    std::ostringstream ss;
    for (char c : s) {
        switch (c) {
            case '"':  ss << "\\\""; break;
            case '\\': ss << "\\\\"; break;
            case '\b': ss << "\\b"; break;
            case '\f': ss << "\\f"; break;
            case '\n': ss << "\\n"; break;
            case '\r': ss << "\\r"; break;
            case '\t': ss << "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    ss << "\\u" << std::hex << std::setfill('0')
                       << std::setw(4) << static_cast<int>(c);
                } else {
                    ss << c;
                }
        }
    }
    return ss.str();
}

// ============================================================================
// Data Row Structure
// ============================================================================

// Simple row representation for data exchange
// Format: column_count | (col_name_len | col_name)* | row_count | (col_value_len | col_value)*
// Each value is prefixed with a type byte: 0=null, 1=int, 2=float, 3=string, 4=bool

enum class ValueType : uint8_t {
    Null = 0,
    Int = 1,
    Float = 2,
    String = 3,
    Bool = 4
};

// ============================================================================
// JSON Format - Full JSON Document
// ============================================================================

/**
 * Format data as a JSON document.
 *
 * Input format (binary):
 *   - uint32: column count
 *   - For each column: uint32 name_len, char* name
 *   - uint32: row count
 *   - For each row, for each column:
 *     - uint8: value type (0=null, 1=int, 2=float, 3=string, 4=bool)
 *     - value data (depends on type)
 *
 * Output: JSON document string
 *
 * @param data Input data buffer
 * @param size Input data size
 * @return Size of output, or -1 on error
 */
EXPORT int format_as_json(const uint8_t* data, int size) {
    clear_error();

    if (!data || size < 8) {
        set_error("Invalid input data");
        return -1;
    }

    const uint8_t* ptr = data;
    const uint8_t* end = data + size;

    // Read column count
    if (ptr + 4 > end) {
        set_error("Truncated column count");
        return -1;
    }
    uint32_t col_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Read column names
    std::vector<std::string> columns;
    for (uint32_t i = 0; i < col_count; i++) {
        if (ptr + 4 > end) {
            set_error("Truncated column name length");
            return -1;
        }
        uint32_t name_len = *reinterpret_cast<const uint32_t*>(ptr);
        ptr += 4;

        if (ptr + name_len > end) {
            set_error("Truncated column name");
            return -1;
        }
        columns.emplace_back(reinterpret_cast<const char*>(ptr), name_len);
        ptr += name_len;
    }

    // Read row count
    if (ptr + 4 > end) {
        set_error("Truncated row count");
        return -1;
    }
    uint32_t row_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Build JSON output
    std::ostringstream json;
    json << "{\n";
    json << "  \"meta\": [\n";
    for (uint32_t i = 0; i < col_count; i++) {
        json << "    {\"name\": \"" << escape_json_string(columns[i]) << "\", \"type\": \"String\"}";
        if (i < col_count - 1) json << ",";
        json << "\n";
    }
    json << "  ],\n";
    json << "  \"data\": [\n";

    // Read and format rows
    for (uint32_t row = 0; row < row_count; row++) {
        json << "    {";
        for (uint32_t col = 0; col < col_count; col++) {
            if (ptr >= end) {
                set_error("Truncated row data");
                return -1;
            }

            json << "\"" << escape_json_string(columns[col]) << "\": ";

            ValueType type = static_cast<ValueType>(*ptr++);

            switch (type) {
                case ValueType::Null:
                    json << "null";
                    break;

                case ValueType::Int: {
                    if (ptr + 8 > end) {
                        set_error("Truncated int value");
                        return -1;
                    }
                    int64_t val = *reinterpret_cast<const int64_t*>(ptr);
                    ptr += 8;
                    json << val;
                    break;
                }

                case ValueType::Float: {
                    if (ptr + 8 > end) {
                        set_error("Truncated float value");
                        return -1;
                    }
                    double val = *reinterpret_cast<const double*>(ptr);
                    ptr += 8;
                    if (std::isnan(val)) {
                        json << "null";
                    } else if (std::isinf(val)) {
                        json << (val > 0 ? "\"Inf\"" : "\"-Inf\"");
                    } else {
                        json << std::setprecision(15) << val;
                    }
                    break;
                }

                case ValueType::String: {
                    if (ptr + 4 > end) {
                        set_error("Truncated string length");
                        return -1;
                    }
                    uint32_t str_len = *reinterpret_cast<const uint32_t*>(ptr);
                    ptr += 4;
                    if (ptr + str_len > end) {
                        set_error("Truncated string value");
                        return -1;
                    }
                    std::string str(reinterpret_cast<const char*>(ptr), str_len);
                    ptr += str_len;
                    json << "\"" << escape_json_string(str) << "\"";
                    break;
                }

                case ValueType::Bool: {
                    if (ptr >= end) {
                        set_error("Truncated bool value");
                        return -1;
                    }
                    bool val = *ptr++;
                    json << (val ? "true" : "false");
                    break;
                }

                default:
                    set_error("Unknown value type");
                    return -1;
            }

            if (col < col_count - 1) json << ", ";
        }
        json << "}";
        if (row < row_count - 1) json << ",";
        json << "\n";
    }

    json << "  ],\n";
    json << "  \"rows\": " << row_count << ",\n";
    json << "  \"statistics\": {\"elapsed\": 0.0, \"rows_read\": " << row_count
         << ", \"bytes_read\": " << size << "}\n";
    json << "}\n";

    std::string output = json.str();
    g_output_buffer.assign(output.begin(), output.end());
    return static_cast<int>(g_output_buffer.size());
}

// ============================================================================
// JSONEachRow Format
// ============================================================================

/**
 * Format data as JSONEachRow (newline-delimited JSON objects).
 * Same input format as format_as_json.
 */
EXPORT int format_as_json_each_row(const uint8_t* data, int size) {
    clear_error();

    if (!data || size < 8) {
        set_error("Invalid input data");
        return -1;
    }

    const uint8_t* ptr = data;
    const uint8_t* end = data + size;

    // Read column count
    if (ptr + 4 > end) {
        set_error("Truncated column count");
        return -1;
    }
    uint32_t col_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Read column names
    std::vector<std::string> columns;
    for (uint32_t i = 0; i < col_count; i++) {
        if (ptr + 4 > end) {
            set_error("Truncated column name length");
            return -1;
        }
        uint32_t name_len = *reinterpret_cast<const uint32_t*>(ptr);
        ptr += 4;

        if (ptr + name_len > end) {
            set_error("Truncated column name");
            return -1;
        }
        columns.emplace_back(reinterpret_cast<const char*>(ptr), name_len);
        ptr += name_len;
    }

    // Read row count
    if (ptr + 4 > end) {
        set_error("Truncated row count");
        return -1;
    }
    uint32_t row_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Build JSONEachRow output
    std::ostringstream json;

    // Read and format rows
    for (uint32_t row = 0; row < row_count; row++) {
        json << "{";
        for (uint32_t col = 0; col < col_count; col++) {
            if (ptr >= end) {
                set_error("Truncated row data");
                return -1;
            }

            json << "\"" << escape_json_string(columns[col]) << "\":";

            ValueType type = static_cast<ValueType>(*ptr++);

            switch (type) {
                case ValueType::Null:
                    json << "null";
                    break;

                case ValueType::Int: {
                    if (ptr + 8 > end) {
                        set_error("Truncated int value");
                        return -1;
                    }
                    int64_t val = *reinterpret_cast<const int64_t*>(ptr);
                    ptr += 8;
                    json << val;
                    break;
                }

                case ValueType::Float: {
                    if (ptr + 8 > end) {
                        set_error("Truncated float value");
                        return -1;
                    }
                    double val = *reinterpret_cast<const double*>(ptr);
                    ptr += 8;
                    if (std::isnan(val)) {
                        json << "null";
                    } else if (std::isinf(val)) {
                        json << (val > 0 ? "\"Inf\"" : "\"-Inf\"");
                    } else {
                        json << std::setprecision(15) << val;
                    }
                    break;
                }

                case ValueType::String: {
                    if (ptr + 4 > end) {
                        set_error("Truncated string length");
                        return -1;
                    }
                    uint32_t str_len = *reinterpret_cast<const uint32_t*>(ptr);
                    ptr += 4;
                    if (ptr + str_len > end) {
                        set_error("Truncated string value");
                        return -1;
                    }
                    std::string str(reinterpret_cast<const char*>(ptr), str_len);
                    ptr += str_len;
                    json << "\"" << escape_json_string(str) << "\"";
                    break;
                }

                case ValueType::Bool: {
                    if (ptr >= end) {
                        set_error("Truncated bool value");
                        return -1;
                    }
                    bool val = *ptr++;
                    json << (val ? "true" : "false");
                    break;
                }

                default:
                    set_error("Unknown value type");
                    return -1;
            }

            if (col < col_count - 1) json << ",";
        }
        json << "}\n";
    }

    std::string output = json.str();
    g_output_buffer.assign(output.begin(), output.end());
    return static_cast<int>(g_output_buffer.size());
}

// ============================================================================
// JSONCompact Format
// ============================================================================

/**
 * Format data as JSONCompact (arrays instead of objects).
 * Same input format as format_as_json.
 */
EXPORT int format_as_json_compact(const uint8_t* data, int size) {
    clear_error();

    if (!data || size < 8) {
        set_error("Invalid input data");
        return -1;
    }

    const uint8_t* ptr = data;
    const uint8_t* end = data + size;

    // Read column count
    if (ptr + 4 > end) {
        set_error("Truncated column count");
        return -1;
    }
    uint32_t col_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Read column names
    std::vector<std::string> columns;
    for (uint32_t i = 0; i < col_count; i++) {
        if (ptr + 4 > end) {
            set_error("Truncated column name length");
            return -1;
        }
        uint32_t name_len = *reinterpret_cast<const uint32_t*>(ptr);
        ptr += 4;

        if (ptr + name_len > end) {
            set_error("Truncated column name");
            return -1;
        }
        columns.emplace_back(reinterpret_cast<const char*>(ptr), name_len);
        ptr += name_len;
    }

    // Read row count
    if (ptr + 4 > end) {
        set_error("Truncated row count");
        return -1;
    }
    uint32_t row_count = *reinterpret_cast<const uint32_t*>(ptr);
    ptr += 4;

    // Build JSONCompact output
    std::ostringstream json;
    json << "{\n";
    json << "  \"meta\": [\n";
    for (uint32_t i = 0; i < col_count; i++) {
        json << "    {\"name\": \"" << escape_json_string(columns[i]) << "\", \"type\": \"String\"}";
        if (i < col_count - 1) json << ",";
        json << "\n";
    }
    json << "  ],\n";
    json << "  \"data\": [\n";

    // Read and format rows as arrays
    for (uint32_t row = 0; row < row_count; row++) {
        json << "    [";
        for (uint32_t col = 0; col < col_count; col++) {
            if (ptr >= end) {
                set_error("Truncated row data");
                return -1;
            }

            ValueType type = static_cast<ValueType>(*ptr++);

            switch (type) {
                case ValueType::Null:
                    json << "null";
                    break;

                case ValueType::Int: {
                    if (ptr + 8 > end) {
                        set_error("Truncated int value");
                        return -1;
                    }
                    int64_t val = *reinterpret_cast<const int64_t*>(ptr);
                    ptr += 8;
                    json << val;
                    break;
                }

                case ValueType::Float: {
                    if (ptr + 8 > end) {
                        set_error("Truncated float value");
                        return -1;
                    }
                    double val = *reinterpret_cast<const double*>(ptr);
                    ptr += 8;
                    if (std::isnan(val)) {
                        json << "null";
                    } else if (std::isinf(val)) {
                        json << (val > 0 ? "\"Inf\"" : "\"-Inf\"");
                    } else {
                        json << std::setprecision(15) << val;
                    }
                    break;
                }

                case ValueType::String: {
                    if (ptr + 4 > end) {
                        set_error("Truncated string length");
                        return -1;
                    }
                    uint32_t str_len = *reinterpret_cast<const uint32_t*>(ptr);
                    ptr += 4;
                    if (ptr + str_len > end) {
                        set_error("Truncated string value");
                        return -1;
                    }
                    std::string str(reinterpret_cast<const char*>(ptr), str_len);
                    ptr += str_len;
                    json << "\"" << escape_json_string(str) << "\"";
                    break;
                }

                case ValueType::Bool: {
                    if (ptr >= end) {
                        set_error("Truncated bool value");
                        return -1;
                    }
                    bool val = *ptr++;
                    json << (val ? "true" : "false");
                    break;
                }

                default:
                    set_error("Unknown value type");
                    return -1;
            }

            if (col < col_count - 1) json << ", ";
        }
        json << "]";
        if (row < row_count - 1) json << ",";
        json << "\n";
    }

    json << "  ],\n";
    json << "  \"rows\": " << row_count << ",\n";
    json << "  \"statistics\": {\"elapsed\": 0.0, \"rows_read\": " << row_count
         << ", \"bytes_read\": " << size << "}\n";
    json << "}\n";

    std::string output = json.str();
    g_output_buffer.assign(output.begin(), output.end());
    return static_cast<int>(g_output_buffer.size());
}

// ============================================================================
// JSON Parsing (for input data)
// ============================================================================

/**
 * Parse JSON string and extract to binary format.
 * This is useful for importing JSON data.
 *
 * @param json_str Input JSON string
 * @param len Length of JSON string
 * @return Size of output in binary format, or -1 on error
 */
EXPORT int parse_json(const char* json_str, int len) {
    clear_error();

    if (!json_str || len <= 0) {
        set_error("Invalid JSON input");
        return -1;
    }

    // Simple JSON array parsing for JSONEachRow format
    // Expected input: [{"col1": val1, ...}, ...]

    std::string input(json_str, len);
    g_output_buffer.clear();

    // Skip whitespace
    size_t pos = 0;
    while (pos < input.size() && isspace(input[pos])) pos++;

    // Check for array start
    if (pos >= input.size() || input[pos] != '[') {
        set_error("Expected JSON array");
        return -1;
    }
    pos++;

    // For this spike, we'll output a placeholder
    // Real implementation would parse the JSON and emit binary format
    set_error("JSON parsing not fully implemented in spike");
    return -1;
}

// ============================================================================
// Version and Info
// ============================================================================

EXPORT const char* json_version() {
    return "1.0.0-spike";
}

EXPORT const char* json_info() {
    return "chdb-wasm JSON format module (JSON/JSONEachRow/JSONCompact)";
}
