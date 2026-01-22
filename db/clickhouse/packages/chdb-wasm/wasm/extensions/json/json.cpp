/**
 * json.cpp - SIDE_MODULE JSON Extension for Emscripten Dynamic Linking
 *
 * This is a side module extension that provides advanced JSON functions
 * for ClickHouse-compatible JSON extraction and manipulation. It can be
 * loaded at runtime via dlopen() and shares memory with the core MAIN_MODULE.
 *
 * The extension provides:
 * - JSONExtract: Extract value at JSONPath and return as string
 * - JSONExtractString: Extract string value at path
 * - JSONExtractInt: Extract integer value at path
 * - JSONExtractFloat: Extract float value at path
 * - JSONPath: Query JSON using path syntax
 * - JSONLength: Get length of JSON array or object
 * - JSONHas: Check if path exists in JSON
 * - JSONKeys: Get keys of JSON object
 * - JSONValues: Get values of JSON object as array
 *
 * Path syntax supports:
 * - $.key - Object key access
 * - $.array[0] - Array index access
 * - $.nested.path.to.value - Nested access
 *
 * Build with:
 *   emcmake cmake -B build/ext-json wasm/extensions/json
 *   emmake make -C build/ext-json
 *
 * Output: ext-json.wasm
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
// For native testing, define EMSCRIPTEN_KEEPALIVE as empty
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <stddef.h>
#include <stdint.h>

// ============================================================================
// Forward declarations for core module functions
// These are imported from the MAIN_MODULE at link time
// ============================================================================

extern "C" {
    // Memory management from core
    void* malloc(size_t size);
    void free(void* ptr);

    // Core module wrappers (for logging and error handling)
    void core_log(const char* message);
    void core_set_error(const char* error);
    int core_get_version();
    void core_increment_query_count();
}

// ============================================================================
// Extension State
// ============================================================================

static int g_initialized = 0;
static int g_operation_count = 0;

// Extension name constant
static const char* EXT_JSON_NAME = "ext-json";
static const int EXT_JSON_VERSION = 1;

// ============================================================================
// Helper Functions for JSON Parsing
// ============================================================================

/**
 * Skip whitespace characters in JSON string.
 */
static const char* skip_whitespace(const char* json) {
    if (!json) return nullptr;
    while (*json == ' ' || *json == '\t' || *json == '\n' || *json == '\r') {
        json++;
    }
    return json;
}

/**
 * Parse a JSON string value (after the opening quote).
 * Returns pointer to the position after the closing quote.
 * Writes the string to output buffer and sets output_len.
 */
static const char* parse_string(const char* json, char* output, size_t max_output, size_t* output_len) {
    if (!json || !output || !output_len) return nullptr;

    *output_len = 0;
    size_t len = 0;

    // Skip opening quote if present
    if (*json == '"') json++;

    while (*json && *json != '"' && len < max_output - 1) {
        if (*json == '\\' && *(json + 1)) {
            json++;
            switch (*json) {
                case '"': output[len++] = '"'; break;
                case '\\': output[len++] = '\\'; break;
                case '/': output[len++] = '/'; break;
                case 'b': output[len++] = '\b'; break;
                case 'f': output[len++] = '\f'; break;
                case 'n': output[len++] = '\n'; break;
                case 'r': output[len++] = '\r'; break;
                case 't': output[len++] = '\t'; break;
                case 'u':
                    // Unicode escape - simplified handling
                    output[len++] = '?';
                    if (json[1] && json[2] && json[3] && json[4]) json += 4;
                    break;
                default:
                    output[len++] = *json;
            }
        } else {
            output[len++] = *json;
        }
        json++;
    }

    output[len] = '\0';
    *output_len = len;

    if (*json == '"') json++;
    return json;
}

/**
 * Parse a JSON number value.
 * Returns pointer to position after the number.
 */
static const char* parse_number(const char* json, double* out_value, int64_t* out_int_value, int* is_float) {
    if (!json || !out_value || !out_int_value || !is_float) return nullptr;

    *is_float = 0;
    *out_value = 0.0;
    *out_int_value = 0;

    int negative = 0;
    if (*json == '-') {
        negative = 1;
        json++;
    }

    // Parse integer part
    int64_t int_part = 0;
    while (*json >= '0' && *json <= '9') {
        int_part = int_part * 10 + (*json - '0');
        json++;
    }

    double frac_part = 0.0;
    double frac_mult = 0.1;

    // Parse fractional part
    if (*json == '.') {
        *is_float = 1;
        json++;
        while (*json >= '0' && *json <= '9') {
            frac_part += (*json - '0') * frac_mult;
            frac_mult *= 0.1;
            json++;
        }
    }

    // Parse exponent
    int exp = 0;
    int exp_negative = 0;
    if (*json == 'e' || *json == 'E') {
        *is_float = 1;
        json++;
        if (*json == '-') {
            exp_negative = 1;
            json++;
        } else if (*json == '+') {
            json++;
        }
        while (*json >= '0' && *json <= '9') {
            exp = exp * 10 + (*json - '0');
            json++;
        }
    }

    double result = (double)int_part + frac_part;

    // Apply exponent
    for (int i = 0; i < exp; i++) {
        if (exp_negative) result /= 10.0;
        else result *= 10.0;
    }

    if (negative) {
        result = -result;
        int_part = -int_part;
    }

    *out_value = result;
    *out_int_value = int_part;

    return json;
}

/**
 * Skip a JSON value (string, number, object, array, bool, null).
 * Returns pointer to position after the value.
 */
static const char* skip_value(const char* json) {
    if (!json) return nullptr;
    json = skip_whitespace(json);

    switch (*json) {
        case '"': {
            // String - find closing quote
            json++;
            while (*json && *json != '"') {
                if (*json == '\\' && *(json + 1)) json++;
                json++;
            }
            if (*json == '"') json++;
            break;
        }
        case '{': {
            // Object - find matching closing brace
            json++;
            int depth = 1;
            while (*json && depth > 0) {
                if (*json == '{') depth++;
                else if (*json == '}') depth--;
                else if (*json == '"') {
                    json++;
                    while (*json && *json != '"') {
                        if (*json == '\\' && *(json + 1)) json++;
                        json++;
                    }
                }
                if (*json) json++;
            }
            break;
        }
        case '[': {
            // Array - find matching closing bracket
            json++;
            int depth = 1;
            while (*json && depth > 0) {
                if (*json == '[') depth++;
                else if (*json == ']') depth--;
                else if (*json == '"') {
                    json++;
                    while (*json && *json != '"') {
                        if (*json == '\\' && *(json + 1)) json++;
                        json++;
                    }
                }
                if (*json) json++;
            }
            break;
        }
        case 't': // true
            if (json[1] == 'r' && json[2] == 'u' && json[3] == 'e') json += 4;
            break;
        case 'f': // false
            if (json[1] == 'a' && json[2] == 'l' && json[3] == 's' && json[4] == 'e') json += 5;
            break;
        case 'n': // null
            if (json[1] == 'u' && json[2] == 'l' && json[3] == 'l') json += 4;
            break;
        default:
            // Number
            if (*json == '-' || (*json >= '0' && *json <= '9')) {
                if (*json == '-') json++;
                while (*json >= '0' && *json <= '9') json++;
                if (*json == '.') {
                    json++;
                    while (*json >= '0' && *json <= '9') json++;
                }
                if (*json == 'e' || *json == 'E') {
                    json++;
                    if (*json == '+' || *json == '-') json++;
                    while (*json >= '0' && *json <= '9') json++;
                }
            }
            break;
    }

    return json;
}

/**
 * Find a value in JSON by path.
 * Path format: $.key.subkey[0].another_key
 * Returns pointer to the start of the value, or nullptr if not found.
 */
static const char* find_by_path(const char* json, const char* path) {
    if (!json || !path) return nullptr;

    json = skip_whitespace(json);

    // Skip leading $. or $ in path
    if (*path == '$') {
        path++;
        if (*path == '.') path++;
    }

    // Empty path returns the root
    if (*path == '\0') return json;

    // Parse path components
    while (*path) {
        json = skip_whitespace(json);

        // Check for array index: [N]
        if (*path == '[') {
            path++;

            // Parse index
            int index = 0;
            while (*path >= '0' && *path <= '9') {
                index = index * 10 + (*path - '0');
                path++;
            }
            if (*path == ']') path++;
            if (*path == '.') path++;

            // JSON must be an array
            if (*json != '[') return nullptr;
            json++;
            json = skip_whitespace(json);

            // Skip to the index-th element
            for (int i = 0; i < index; i++) {
                if (*json == ']') return nullptr; // Out of bounds
                json = skip_value(json);
                json = skip_whitespace(json);
                if (*json == ',') {
                    json++;
                    json = skip_whitespace(json);
                }
            }

            // Found the element
            if (*path == '\0') return json;
            continue;
        }

        // Parse key name
        char key[256];
        size_t key_len = 0;

        while (*path && *path != '.' && *path != '[' && key_len < 255) {
            key[key_len++] = *path++;
        }
        key[key_len] = '\0';

        if (*path == '.') path++;

        // JSON must be an object
        if (*json != '{') return nullptr;
        json++;
        json = skip_whitespace(json);

        // Search for key in object
        int found = 0;
        while (*json && *json != '}') {
            json = skip_whitespace(json);

            // Parse key
            if (*json != '"') return nullptr;
            json++;

            // Check if this key matches
            const char* key_start = json;
            size_t i = 0;
            int match = 1;

            while (*json && *json != '"') {
                if (*json == '\\' && *(json + 1)) {
                    json++;
                }
                if (i < key_len && *json != key[i]) {
                    match = 0;
                }
                json++;
                i++;
            }

            if (i != key_len) match = 0;

            if (*json == '"') json++;
            json = skip_whitespace(json);

            // Skip colon
            if (*json == ':') {
                json++;
                json = skip_whitespace(json);
            }

            if (match) {
                // Found the key
                found = 1;
                break;
            }

            // Skip this value
            json = skip_value(json);
            json = skip_whitespace(json);

            if (*json == ',') {
                json++;
                json = skip_whitespace(json);
            }
        }

        if (!found) return nullptr;

        // If there's more path to process, continue
        if (*path == '\0') return json;
    }

    return json;
}

/**
 * Get the length of a JSON value start.
 * For strings: returns the length from current position to end quote.
 * For arrays/objects: returns the length from current position to closing bracket/brace.
 */
static size_t get_value_length(const char* json) {
    if (!json) return 0;

    const char* start = json;
    const char* end = skip_value(json);

    return end ? (end - start) : 0;
}

// ============================================================================
// Extension Initialization and Metadata
// ============================================================================

extern "C" {

/**
 * Initialize the JSON extension.
 * Verifies core module compatibility and sets up extension state.
 *
 * @return 0 on success, -1 on failure
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_init() {
    if (g_initialized) {
        core_log("ext-json: Already initialized");
        return 0;
    }

    // Check core module version
    int core_version = core_get_version();
    if (core_version < 1) {
        core_set_error("ext-json requires core module version >= 1");
        return -1;
    }

    // Initialize state
    g_initialized = 1;
    g_operation_count = 0;

    core_log("ext-json: Initialized successfully");
    return 0;
}

/**
 * Get the extension name.
 *
 * @return Pointer to the extension name string
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_json_get_name() {
    return EXT_JSON_NAME;
}

/**
 * Get the extension version.
 *
 * @return Version number
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_get_version() {
    return EXT_JSON_VERSION;
}

/**
 * Check if the extension is initialized.
 *
 * @return 1 if initialized, 0 otherwise
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_is_initialized() {
    return g_initialized;
}

/**
 * Get the count of operations performed.
 *
 * @return Number of JSON operations performed since initialization
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_get_operation_count() {
    return g_operation_count;
}

// ============================================================================
// JSON Functions
// ============================================================================

/**
 * Extract a value from JSON at the given path.
 * Returns the value as a JSON string representation.
 *
 * @param json The JSON string to query
 * @param path The JSONPath (e.g., "$.name", "$.items[0].id")
 * @return Allocated string containing the extracted value, or nullptr on error
 *         Caller must free the returned string with ext_json_free()
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_extract(const char* json, const char* path) {
    g_operation_count++;
    core_increment_query_count();

    if (!json || !path) {
        core_set_error("ext_json_extract: null input");
        return nullptr;
    }

    const char* value = find_by_path(json, path);
    if (!value) {
        return nullptr; // Path not found
    }

    // Determine value length and allocate output
    size_t len = get_value_length(value);
    if (len == 0) return nullptr;

    char* result = (char*)malloc(len + 1);
    if (!result) {
        core_set_error("ext_json_extract: allocation failed");
        return nullptr;
    }

    // Copy the value
    for (size_t i = 0; i < len; i++) {
        result[i] = value[i];
    }
    result[len] = '\0';

    return result;
}

/**
 * Extract a string value from JSON at the given path.
 *
 * @param json The JSON string to query
 * @param path The JSONPath (e.g., "$.name")
 * @return Allocated string containing the extracted value (unquoted), or nullptr on error
 *         Caller must free the returned string with ext_json_free()
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_extract_string(const char* json, const char* path) {
    g_operation_count++;
    core_increment_query_count();

    if (!json || !path) {
        core_set_error("ext_json_extract_string: null input");
        return nullptr;
    }

    const char* value = find_by_path(json, path);
    if (!value) {
        return nullptr; // Path not found
    }

    value = skip_whitespace(value);

    // Must be a string
    if (*value != '"') {
        return nullptr;
    }

    // Allocate output buffer
    char* result = (char*)malloc(4096);
    if (!result) {
        core_set_error("ext_json_extract_string: allocation failed");
        return nullptr;
    }

    size_t len;
    parse_string(value, result, 4096, &len);

    return result;
}

/**
 * Extract an integer value from JSON at the given path.
 *
 * @param json The JSON string to query
 * @param path The JSONPath (e.g., "$.count")
 * @return The integer value, or 0 on error
 */
EMSCRIPTEN_KEEPALIVE
int64_t ext_json_extract_int(const char* json, const char* path) {
    g_operation_count++;
    core_increment_query_count();

    if (!json || !path) {
        core_set_error("ext_json_extract_int: null input");
        return 0;
    }

    const char* value = find_by_path(json, path);
    if (!value) {
        return 0; // Path not found
    }

    value = skip_whitespace(value);

    // Parse as number
    double float_value;
    int64_t int_value;
    int is_float;

    parse_number(value, &float_value, &int_value, &is_float);

    if (is_float) {
        return (int64_t)float_value;
    }
    return int_value;
}

/**
 * Extract a float value from JSON at the given path.
 *
 * @param json The JSON string to query
 * @param path The JSONPath (e.g., "$.price")
 * @return The float value, or 0.0 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_json_extract_float(const char* json, const char* path) {
    g_operation_count++;
    core_increment_query_count();

    if (!json || !path) {
        core_set_error("ext_json_extract_float: null input");
        return 0.0;
    }

    const char* value = find_by_path(json, path);
    if (!value) {
        return 0.0; // Path not found
    }

    value = skip_whitespace(value);

    // Parse as number
    double float_value;
    int64_t int_value;
    int is_float;

    parse_number(value, &float_value, &int_value, &is_float);

    return float_value;
}

/**
 * Get the length of a JSON array or object.
 *
 * @param json The JSON string to query
 * @return The number of elements (array) or keys (object), or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_length(const char* json) {
    g_operation_count++;
    core_increment_query_count();

    if (!json) {
        core_set_error("ext_json_length: null input");
        return -1;
    }

    json = skip_whitespace(json);

    if (*json == '[') {
        // Array
        json++;
        json = skip_whitespace(json);

        if (*json == ']') return 0; // Empty array

        int count = 0;
        while (*json && *json != ']') {
            count++;
            json = skip_value(json);
            json = skip_whitespace(json);
            if (*json == ',') {
                json++;
                json = skip_whitespace(json);
            }
        }
        return count;
    }

    if (*json == '{') {
        // Object
        json++;
        json = skip_whitespace(json);

        if (*json == '}') return 0; // Empty object

        int count = 0;
        while (*json && *json != '}') {
            // Skip key
            if (*json == '"') {
                json++;
                while (*json && *json != '"') {
                    if (*json == '\\' && *(json + 1)) json++;
                    json++;
                }
                if (*json == '"') json++;
            }
            json = skip_whitespace(json);

            // Skip colon
            if (*json == ':') json++;
            json = skip_whitespace(json);

            // Skip value
            json = skip_value(json);
            json = skip_whitespace(json);

            count++;

            if (*json == ',') {
                json++;
                json = skip_whitespace(json);
            }
        }
        return count;
    }

    // Not an array or object
    return -1;
}

/**
 * Check if a path exists in JSON.
 *
 * @param json The JSON string to query
 * @param path The JSONPath to check
 * @return 1 if path exists, 0 if not
 */
EMSCRIPTEN_KEEPALIVE
int ext_json_has(const char* json, const char* path) {
    g_operation_count++;
    core_increment_query_count();

    if (!json || !path) {
        return 0;
    }

    const char* value = find_by_path(json, path);
    return value != nullptr ? 1 : 0;
}

/**
 * Get the keys of a JSON object.
 *
 * @param json The JSON string (must be an object)
 * @return Allocated JSON array string of keys, or nullptr on error
 *         Caller must free the returned string with ext_json_free()
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_keys(const char* json) {
    g_operation_count++;
    core_increment_query_count();

    if (!json) {
        core_set_error("ext_json_keys: null input");
        return nullptr;
    }

    json = skip_whitespace(json);

    if (*json != '{') {
        core_set_error("ext_json_keys: not an object");
        return nullptr;
    }

    // Allocate output buffer
    size_t buffer_size = 4096;
    char* result = (char*)malloc(buffer_size);
    if (!result) {
        core_set_error("ext_json_keys: allocation failed");
        return nullptr;
    }

    size_t pos = 0;
    result[pos++] = '[';

    json++;
    json = skip_whitespace(json);

    int first = 1;
    while (*json && *json != '}' && pos < buffer_size - 10) {
        if (!first) {
            result[pos++] = ',';
        }
        first = 0;

        // Copy key including quotes
        if (*json == '"') {
            result[pos++] = *json++;
            while (*json && *json != '"' && pos < buffer_size - 5) {
                if (*json == '\\' && *(json + 1)) {
                    result[pos++] = *json++;
                }
                result[pos++] = *json++;
            }
            if (*json == '"') {
                result[pos++] = *json++;
            }
        }

        json = skip_whitespace(json);

        // Skip colon and value
        if (*json == ':') json++;
        json = skip_whitespace(json);
        json = skip_value(json);
        json = skip_whitespace(json);

        if (*json == ',') {
            json++;
            json = skip_whitespace(json);
        }
    }

    result[pos++] = ']';
    result[pos] = '\0';

    return result;
}

/**
 * Get the values of a JSON object.
 *
 * @param json The JSON string (must be an object)
 * @return Allocated JSON array string of values, or nullptr on error
 *         Caller must free the returned string with ext_json_free()
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_values(const char* json) {
    g_operation_count++;
    core_increment_query_count();

    if (!json) {
        core_set_error("ext_json_values: null input");
        return nullptr;
    }

    json = skip_whitespace(json);

    if (*json != '{') {
        core_set_error("ext_json_values: not an object");
        return nullptr;
    }

    // Allocate output buffer
    size_t buffer_size = 8192;
    char* result = (char*)malloc(buffer_size);
    if (!result) {
        core_set_error("ext_json_values: allocation failed");
        return nullptr;
    }

    size_t pos = 0;
    result[pos++] = '[';

    json++;
    json = skip_whitespace(json);

    int first = 1;
    while (*json && *json != '}' && pos < buffer_size - 10) {
        // Skip key
        if (*json == '"') {
            json++;
            while (*json && *json != '"') {
                if (*json == '\\' && *(json + 1)) json++;
                json++;
            }
            if (*json == '"') json++;
        }

        json = skip_whitespace(json);

        // Skip colon
        if (*json == ':') json++;
        json = skip_whitespace(json);

        if (!first) {
            result[pos++] = ',';
        }
        first = 0;

        // Copy value
        const char* value_start = json;
        json = skip_value(json);
        size_t value_len = json - value_start;

        if (pos + value_len < buffer_size - 5) {
            for (size_t i = 0; i < value_len; i++) {
                result[pos++] = value_start[i];
            }
        }

        json = skip_whitespace(json);

        if (*json == ',') {
            json++;
            json = skip_whitespace(json);
        }
    }

    result[pos++] = ']';
    result[pos] = '\0';

    return result;
}

/**
 * Query JSON using JSONPath (alias for ext_json_extract).
 *
 * @param json The JSON string to query
 * @param path The JSONPath expression
 * @return Allocated string containing the result, or nullptr on error
 *         Caller must free the returned string with ext_json_free()
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_path(const char* json, const char* path) {
    return ext_json_extract(json, path);
}

/**
 * Free a string allocated by ext_json functions.
 *
 * @param ptr Pointer to the string to free
 */
EMSCRIPTEN_KEEPALIVE
void ext_json_free(char* ptr) {
    if (ptr) {
        free(ptr);
    }
}

} // extern "C"
