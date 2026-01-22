/**
 * schema_inference.cpp - JSON Schema Inference for Columnar Storage
 *
 * This module infers the schema from JSON samples, determining the
 * optimal column types for each unique path. It handles:
 * - Type detection from JSON values
 * - Type coercion for mixed-type paths
 * - Nullable detection
 * - Nested object/array handling
 * - Path flattening for columnar storage
 *
 * Reference: https://clickhouse.com/docs/en/sql-reference/data-types/newjson
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "json_type.h"

// ============================================================================
// Forward declarations for core module functions
// ============================================================================

extern "C" {
    void* malloc(size_t size);
    void* realloc(void* ptr, size_t size);
    void free(void* ptr);
    void core_log(const char* message);
    void core_set_error(const char* error);
}

// ============================================================================
// JSON Parser State
// ============================================================================

typedef struct {
    const char* input;
    size_t pos;
    size_t len;
    char* error;
} JSONParser;

// ============================================================================
// Helper Functions
// ============================================================================

static void parser_init(JSONParser* p, const char* json, size_t len) {
    p->input = json;
    p->pos = 0;
    p->len = len;
    p->error = nullptr;
}

static void parser_skip_whitespace(JSONParser* p) {
    while (p->pos < p->len) {
        char c = p->input[p->pos];
        if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
        p->pos++;
    }
}

static bool parser_match(JSONParser* p, char c) {
    parser_skip_whitespace(p);
    if (p->pos < p->len && p->input[p->pos] == c) {
        p->pos++;
        return true;
    }
    return false;
}

static bool parser_match_keyword(JSONParser* p, const char* keyword) {
    parser_skip_whitespace(p);
    size_t len = strlen(keyword);
    if (p->pos + len <= p->len && strncmp(p->input + p->pos, keyword, len) == 0) {
        p->pos += len;
        return true;
    }
    return false;
}

static char* parser_parse_string(JSONParser* p) {
    if (!parser_match(p, '"')) return nullptr;

    size_t start = p->pos;
    size_t capacity = 64;
    size_t len = 0;
    char* result = (char*)malloc(capacity);
    if (!result) return nullptr;

    while (p->pos < p->len && p->input[p->pos] != '"') {
        if (len + 2 >= capacity) {
            capacity *= 2;
            char* new_result = (char*)realloc(result, capacity);
            if (!new_result) {
                free(result);
                return nullptr;
            }
            result = new_result;
        }

        if (p->input[p->pos] == '\\' && p->pos + 1 < p->len) {
            p->pos++;
            char c = p->input[p->pos];
            switch (c) {
                case '"': result[len++] = '"'; break;
                case '\\': result[len++] = '\\'; break;
                case '/': result[len++] = '/'; break;
                case 'b': result[len++] = '\b'; break;
                case 'f': result[len++] = '\f'; break;
                case 'n': result[len++] = '\n'; break;
                case 'r': result[len++] = '\r'; break;
                case 't': result[len++] = '\t'; break;
                case 'u':
                    // Unicode escape - simplified
                    result[len++] = '?';
                    if (p->pos + 4 < p->len) p->pos += 4;
                    break;
                default:
                    result[len++] = c;
            }
        } else {
            result[len++] = p->input[p->pos];
        }
        p->pos++;
    }

    if (!parser_match(p, '"')) {
        free(result);
        return nullptr;
    }

    result[len] = '\0';
    return result;
}

static bool parser_parse_number(JSONParser* p, JSONValue* out) {
    parser_skip_whitespace(p);
    size_t start = p->pos;

    bool negative = false;
    if (p->pos < p->len && p->input[p->pos] == '-') {
        negative = true;
        p->pos++;
    }

    // Parse integer part
    bool has_digits = false;
    uint64_t int_part = 0;
    while (p->pos < p->len && p->input[p->pos] >= '0' && p->input[p->pos] <= '9') {
        has_digits = true;
        int_part = int_part * 10 + (p->input[p->pos] - '0');
        p->pos++;
    }

    if (!has_digits) {
        p->pos = start;
        return false;
    }

    // Check for decimal point or exponent
    bool is_float = false;
    double frac_part = 0.0;
    double frac_mult = 0.1;

    if (p->pos < p->len && p->input[p->pos] == '.') {
        is_float = true;
        p->pos++;
        while (p->pos < p->len && p->input[p->pos] >= '0' && p->input[p->pos] <= '9') {
            frac_part += (p->input[p->pos] - '0') * frac_mult;
            frac_mult *= 0.1;
            p->pos++;
        }
    }

    int exp = 0;
    bool exp_negative = false;
    if (p->pos < p->len && (p->input[p->pos] == 'e' || p->input[p->pos] == 'E')) {
        is_float = true;
        p->pos++;
        if (p->pos < p->len && p->input[p->pos] == '-') {
            exp_negative = true;
            p->pos++;
        } else if (p->pos < p->len && p->input[p->pos] == '+') {
            p->pos++;
        }
        while (p->pos < p->len && p->input[p->pos] >= '0' && p->input[p->pos] <= '9') {
            exp = exp * 10 + (p->input[p->pos] - '0');
            p->pos++;
        }
    }

    if (is_float) {
        double result = (double)int_part + frac_part;
        for (int i = 0; i < exp; i++) {
            if (exp_negative) result /= 10.0;
            else result *= 10.0;
        }
        if (negative) result = -result;
        out->type = JSON_TYPE_FLOAT64;
        out->value.float64_value = result;
    } else if (negative) {
        out->type = JSON_TYPE_INT64;
        out->value.int64_value = -(int64_t)int_part;
    } else {
        // Use uint64 for large positive numbers
        if (int_part > (uint64_t)INT64_MAX) {
            out->type = JSON_TYPE_UINT64;
            out->value.uint64_value = int_part;
        } else {
            out->type = JSON_TYPE_INT64;
            out->value.int64_value = (int64_t)int_part;
        }
    }

    return true;
}

// Forward declaration
static bool parser_parse_value(JSONParser* p, JSONValue* out);

static bool parser_parse_array(JSONParser* p, JSONValue* out) {
    if (!parser_match(p, '[')) return false;

    *out = json_value_array();

    parser_skip_whitespace(p);
    if (parser_match(p, ']')) return true; // Empty array

    do {
        JSONValue item;
        if (!parser_parse_value(p, &item)) {
            json_value_free(out);
            return false;
        }
        if (json_value_array_push(out, item) != 0) {
            json_value_free(&item);
            json_value_free(out);
            return false;
        }
    } while (parser_match(p, ','));

    if (!parser_match(p, ']')) {
        json_value_free(out);
        return false;
    }

    return true;
}

static bool parser_parse_object(JSONParser* p, JSONValue* out) {
    if (!parser_match(p, '{')) return false;

    *out = json_value_object();

    parser_skip_whitespace(p);
    if (parser_match(p, '}')) return true; // Empty object

    do {
        char* key = parser_parse_string(p);
        if (!key) {
            json_value_free(out);
            return false;
        }

        if (!parser_match(p, ':')) {
            free(key);
            json_value_free(out);
            return false;
        }

        JSONValue value;
        if (!parser_parse_value(p, &value)) {
            free(key);
            json_value_free(out);
            return false;
        }

        if (json_value_object_set(out, key, value) != 0) {
            free(key);
            json_value_free(&value);
            json_value_free(out);
            return false;
        }

        free(key);
    } while (parser_match(p, ','));

    if (!parser_match(p, '}')) {
        json_value_free(out);
        return false;
    }

    return true;
}

static bool parser_parse_value(JSONParser* p, JSONValue* out) {
    parser_skip_whitespace(p);

    if (p->pos >= p->len) return false;

    char c = p->input[p->pos];

    // null
    if (parser_match_keyword(p, "null")) {
        *out = json_value_null();
        return true;
    }

    // true
    if (parser_match_keyword(p, "true")) {
        *out = json_value_bool(true);
        return true;
    }

    // false
    if (parser_match_keyword(p, "false")) {
        *out = json_value_bool(false);
        return true;
    }

    // string
    if (c == '"') {
        char* str = parser_parse_string(p);
        if (str) {
            *out = json_value_string(str, strlen(str));
            free(str);
            return true;
        }
        return false;
    }

    // number
    if (c == '-' || (c >= '0' && c <= '9')) {
        return parser_parse_number(p, out);
    }

    // array
    if (c == '[') {
        return parser_parse_array(p, out);
    }

    // object
    if (c == '{') {
        return parser_parse_object(p, out);
    }

    return false;
}

// ============================================================================
// JSONValue Implementation
// ============================================================================

extern "C" {

void json_value_init(JSONValue* v) {
    v->type = JSON_TYPE_NULL;
    memset(&v->value, 0, sizeof(v->value));
}

void json_value_free(JSONValue* v) {
    if (!v) return;

    switch (v->type) {
        case JSON_TYPE_STRING:
            if (v->value.string_value.data) {
                free(v->value.string_value.data);
            }
            break;

        case JSON_TYPE_ARRAY:
            for (size_t i = 0; i < v->value.array_value.count; i++) {
                json_value_free(&v->value.array_value.items[i]);
            }
            if (v->value.array_value.items) {
                free(v->value.array_value.items);
            }
            break;

        case JSON_TYPE_OBJECT:
            for (size_t i = 0; i < v->value.object_value.count; i++) {
                if (v->value.object_value.keys[i]) {
                    free(v->value.object_value.keys[i]);
                }
                json_value_free(&v->value.object_value.values[i]);
            }
            if (v->value.object_value.keys) {
                free(v->value.object_value.keys);
            }
            if (v->value.object_value.values) {
                free(v->value.object_value.values);
            }
            break;

        default:
            break;
    }

    json_value_init(v);
}

JSONValue json_value_null(void) {
    JSONValue v;
    json_value_init(&v);
    return v;
}

JSONValue json_value_bool(bool b) {
    JSONValue v;
    v.type = JSON_TYPE_BOOL;
    v.value.bool_value = b;
    return v;
}

JSONValue json_value_int64(int64_t i) {
    JSONValue v;
    v.type = JSON_TYPE_INT64;
    v.value.int64_value = i;
    return v;
}

JSONValue json_value_uint64(uint64_t u) {
    JSONValue v;
    v.type = JSON_TYPE_UINT64;
    v.value.uint64_value = u;
    return v;
}

JSONValue json_value_float64(double f) {
    JSONValue v;
    v.type = JSON_TYPE_FLOAT64;
    v.value.float64_value = f;
    return v;
}

JSONValue json_value_string(const char* s, size_t len) {
    JSONValue v;
    v.type = JSON_TYPE_STRING;
    v.value.string_value.data = (char*)malloc(len + 1);
    if (v.value.string_value.data) {
        memcpy(v.value.string_value.data, s, len);
        v.value.string_value.data[len] = '\0';
        v.value.string_value.length = len;
    } else {
        v.type = JSON_TYPE_NULL;
    }
    return v;
}

JSONValue json_value_array(void) {
    JSONValue v;
    v.type = JSON_TYPE_ARRAY;
    v.value.array_value.items = nullptr;
    v.value.array_value.count = 0;
    v.value.array_value.capacity = 0;
    return v;
}

JSONValue json_value_object(void) {
    JSONValue v;
    v.type = JSON_TYPE_OBJECT;
    v.value.object_value.keys = nullptr;
    v.value.object_value.values = nullptr;
    v.value.object_value.count = 0;
    v.value.object_value.capacity = 0;
    return v;
}

int json_value_array_push(JSONValue* arr, JSONValue item) {
    if (arr->type != JSON_TYPE_ARRAY) return -1;

    if (arr->value.array_value.count >= arr->value.array_value.capacity) {
        size_t new_capacity = arr->value.array_value.capacity == 0 ? 8 : arr->value.array_value.capacity * 2;
        JSONValue* new_items = (JSONValue*)realloc(arr->value.array_value.items, new_capacity * sizeof(JSONValue));
        if (!new_items) return -1;
        arr->value.array_value.items = new_items;
        arr->value.array_value.capacity = new_capacity;
    }

    arr->value.array_value.items[arr->value.array_value.count++] = item;
    return 0;
}

size_t json_value_array_size(const JSONValue* arr) {
    if (arr->type != JSON_TYPE_ARRAY) return 0;
    return arr->value.array_value.count;
}

const JSONValue* json_value_array_get(const JSONValue* arr, size_t index) {
    if (arr->type != JSON_TYPE_ARRAY) return nullptr;
    if (index >= arr->value.array_value.count) return nullptr;
    return &arr->value.array_value.items[index];
}

int json_value_object_set(JSONValue* obj, const char* key, JSONValue value) {
    if (obj->type != JSON_TYPE_OBJECT) return -1;

    // Check if key already exists
    for (size_t i = 0; i < obj->value.object_value.count; i++) {
        if (strcmp(obj->value.object_value.keys[i], key) == 0) {
            json_value_free(&obj->value.object_value.values[i]);
            obj->value.object_value.values[i] = value;
            return 0;
        }
    }

    // Add new key
    if (obj->value.object_value.count >= obj->value.object_value.capacity) {
        size_t new_capacity = obj->value.object_value.capacity == 0 ? 8 : obj->value.object_value.capacity * 2;
        char** new_keys = (char**)realloc(obj->value.object_value.keys, new_capacity * sizeof(char*));
        JSONValue* new_values = (JSONValue*)realloc(obj->value.object_value.values, new_capacity * sizeof(JSONValue));
        if (!new_keys || !new_values) {
            if (new_keys) obj->value.object_value.keys = new_keys;
            return -1;
        }
        obj->value.object_value.keys = new_keys;
        obj->value.object_value.values = new_values;
        obj->value.object_value.capacity = new_capacity;
    }

    char* key_copy = (char*)malloc(strlen(key) + 1);
    if (!key_copy) return -1;
    strcpy(key_copy, key);

    obj->value.object_value.keys[obj->value.object_value.count] = key_copy;
    obj->value.object_value.values[obj->value.object_value.count] = value;
    obj->value.object_value.count++;
    return 0;
}

const JSONValue* json_value_object_get(const JSONValue* obj, const char* key) {
    if (obj->type != JSON_TYPE_OBJECT) return nullptr;
    for (size_t i = 0; i < obj->value.object_value.count; i++) {
        if (strcmp(obj->value.object_value.keys[i], key) == 0) {
            return &obj->value.object_value.values[i];
        }
    }
    return nullptr;
}

size_t json_value_object_size(const JSONValue* obj) {
    if (obj->type != JSON_TYPE_OBJECT) return 0;
    return obj->value.object_value.count;
}

// ============================================================================
// Type Information
// ============================================================================

const char* json_type_name(JSONType type) {
    switch (type) {
        case JSON_TYPE_NULL: return "Null";
        case JSON_TYPE_BOOL: return "Bool";
        case JSON_TYPE_INT64: return "Int64";
        case JSON_TYPE_UINT64: return "UInt64";
        case JSON_TYPE_FLOAT64: return "Float64";
        case JSON_TYPE_STRING: return "String";
        case JSON_TYPE_ARRAY: return "Array";
        case JSON_TYPE_OBJECT: return "Object";
        case JSON_TYPE_DYNAMIC: return "Dynamic";
        default: return "Unknown";
    }
}

const char* json_type_to_clickhouse(JSONType type) {
    switch (type) {
        case JSON_TYPE_NULL: return "Nullable(Nothing)";
        case JSON_TYPE_BOOL: return "UInt8";
        case JSON_TYPE_INT64: return "Int64";
        case JSON_TYPE_UINT64: return "UInt64";
        case JSON_TYPE_FLOAT64: return "Float64";
        case JSON_TYPE_STRING: return "String";
        case JSON_TYPE_ARRAY: return "Array";
        case JSON_TYPE_OBJECT: return "Tuple";
        case JSON_TYPE_DYNAMIC: return "String";
        default: return "Unknown";
    }
}

// ============================================================================
// Type Coercion
// ============================================================================

JSONType json_type_coerce(JSONType a, JSONType b) {
    if (a == b) return a;

    // Null can be combined with anything (makes it nullable)
    if (a == JSON_TYPE_NULL) return b;
    if (b == JSON_TYPE_NULL) return a;

    // Numeric type coercion
    if ((a == JSON_TYPE_INT64 || a == JSON_TYPE_UINT64 || a == JSON_TYPE_FLOAT64) &&
        (b == JSON_TYPE_INT64 || b == JSON_TYPE_UINT64 || b == JSON_TYPE_FLOAT64)) {
        // If any is float, result is float
        if (a == JSON_TYPE_FLOAT64 || b == JSON_TYPE_FLOAT64) {
            return JSON_TYPE_FLOAT64;
        }
        // int64 + uint64 -> int64 (might lose precision for very large uint64)
        return JSON_TYPE_INT64;
    }

    // Bool can be promoted to int
    if ((a == JSON_TYPE_BOOL && (b == JSON_TYPE_INT64 || b == JSON_TYPE_UINT64)) ||
        (b == JSON_TYPE_BOOL && (a == JSON_TYPE_INT64 || a == JSON_TYPE_UINT64))) {
        return JSON_TYPE_INT64;
    }

    // String as fallback for different scalar types
    if ((a == JSON_TYPE_STRING && b != JSON_TYPE_ARRAY && b != JSON_TYPE_OBJECT) ||
        (b == JSON_TYPE_STRING && a != JSON_TYPE_ARRAY && a != JSON_TYPE_OBJECT)) {
        return JSON_TYPE_STRING;
    }

    // Fall back to dynamic for incompatible types
    return JSON_TYPE_DYNAMIC;
}

bool json_type_can_coerce(JSONType from, JSONType to) {
    if (from == to) return true;
    if (from == JSON_TYPE_NULL) return true; // null can be coerced to anything

    switch (to) {
        case JSON_TYPE_STRING:
            // Anything can be converted to string
            return from != JSON_TYPE_ARRAY && from != JSON_TYPE_OBJECT;

        case JSON_TYPE_FLOAT64:
            return from == JSON_TYPE_INT64 || from == JSON_TYPE_UINT64 || from == JSON_TYPE_BOOL;

        case JSON_TYPE_INT64:
            return from == JSON_TYPE_BOOL || from == JSON_TYPE_UINT64;

        case JSON_TYPE_UINT64:
            return from == JSON_TYPE_BOOL;

        case JSON_TYPE_DYNAMIC:
            return true;

        default:
            return false;
    }
}

// ============================================================================
// Schema Implementation
// ============================================================================

JSONSchema* json_schema_create(void) {
    JSONSchema* schema = (JSONSchema*)malloc(sizeof(JSONSchema));
    if (!schema) return nullptr;

    schema->fields = nullptr;
    schema->field_count = 0;
    schema->field_capacity = 0;
    schema->paths = nullptr;
    schema->path_count = 0;
    schema->path_capacity = 0;

    return schema;
}

static void json_schema_field_free(JSONSchemaField* field) {
    if (!field) return;
    if (field->path) free(field->path);
    for (size_t i = 0; i < field->nested_count; i++) {
        json_schema_field_free(field->nested_fields[i]);
        free(field->nested_fields[i]);
    }
    if (field->nested_fields) free(field->nested_fields);
}

void json_schema_free(JSONSchema* schema) {
    if (!schema) return;

    for (size_t i = 0; i < schema->field_count; i++) {
        json_schema_field_free(schema->fields[i]);
        free(schema->fields[i]);
    }
    if (schema->fields) free(schema->fields);

    for (size_t i = 0; i < schema->path_count; i++) {
        if (schema->paths[i]) free(schema->paths[i]);
    }
    if (schema->paths) free(schema->paths);

    free(schema);
}

int json_schema_add_field(JSONSchema* schema, const char* path, JSONType type, bool nullable) {
    // Check if field already exists
    for (size_t i = 0; i < schema->field_count; i++) {
        if (strcmp(schema->fields[i]->path, path) == 0) {
            // Update type via coercion
            schema->fields[i]->type = json_type_coerce(schema->fields[i]->type, type);
            schema->fields[i]->nullable = schema->fields[i]->nullable || nullable;
            return 0;
        }
    }

    // Add new field
    if (schema->field_count >= schema->field_capacity) {
        size_t new_capacity = schema->field_capacity == 0 ? 8 : schema->field_capacity * 2;
        JSONSchemaField** new_fields = (JSONSchemaField**)realloc(schema->fields, new_capacity * sizeof(JSONSchemaField*));
        if (!new_fields) return -1;
        schema->fields = new_fields;
        schema->field_capacity = new_capacity;
    }

    JSONSchemaField* field = (JSONSchemaField*)malloc(sizeof(JSONSchemaField));
    if (!field) return -1;

    field->path = (char*)malloc(strlen(path) + 1);
    if (!field->path) {
        free(field);
        return -1;
    }
    strcpy(field->path, path);
    field->type = type;
    field->nullable = nullable;
    field->element_type = JSON_TYPE_NULL;
    field->nested_fields = nullptr;
    field->nested_count = 0;

    schema->fields[schema->field_count++] = field;

    // Also add to paths list
    if (schema->path_count >= schema->path_capacity) {
        size_t new_capacity = schema->path_capacity == 0 ? 8 : schema->path_capacity * 2;
        char** new_paths = (char**)realloc(schema->paths, new_capacity * sizeof(char*));
        if (!new_paths) return 0; // Path list is optional, don't fail
        schema->paths = new_paths;
        schema->path_capacity = new_capacity;
    }

    char* path_copy = (char*)malloc(strlen(path) + 1);
    if (path_copy) {
        strcpy(path_copy, path);
        schema->paths[schema->path_count++] = path_copy;
    }

    return 0;
}

const JSONSchemaField* json_schema_get_field(const JSONSchema* schema, const char* path) {
    for (size_t i = 0; i < schema->field_count; i++) {
        if (strcmp(schema->fields[i]->path, path) == 0) {
            return schema->fields[i];
        }
    }
    return nullptr;
}

int json_schema_merge(JSONSchema* dest, const JSONSchema* src) {
    for (size_t i = 0; i < src->field_count; i++) {
        if (json_schema_add_field(dest, src->fields[i]->path, src->fields[i]->type, src->fields[i]->nullable) != 0) {
            return -1;
        }
    }
    return 0;
}

// ============================================================================
// Schema Inference from JSON Values
// ============================================================================

/**
 * Internal: recursively infer schema from a JSON value
 */
static int schema_infer_value(JSONSchema* schema, const char* prefix, const JSONValue* value) {
    char path_buffer[1024];

    switch (value->type) {
        case JSON_TYPE_NULL:
        case JSON_TYPE_BOOL:
        case JSON_TYPE_INT64:
        case JSON_TYPE_UINT64:
        case JSON_TYPE_FLOAT64:
        case JSON_TYPE_STRING:
            return json_schema_add_field(schema, prefix, value->type, value->type == JSON_TYPE_NULL);

        case JSON_TYPE_ARRAY: {
            // Add the array itself
            json_schema_add_field(schema, prefix, JSON_TYPE_ARRAY, false);

            // Infer element type with wildcard path
            for (size_t i = 0; i < value->value.array_value.count; i++) {
                snprintf(path_buffer, sizeof(path_buffer), "%s[*]", prefix);
                schema_infer_value(schema, path_buffer, &value->value.array_value.items[i]);
            }
            return 0;
        }

        case JSON_TYPE_OBJECT: {
            // Add the object itself
            json_schema_add_field(schema, prefix, JSON_TYPE_OBJECT, false);

            // Infer nested fields
            for (size_t i = 0; i < value->value.object_value.count; i++) {
                const char* key = value->value.object_value.keys[i];
                const JSONValue* nested = &value->value.object_value.values[i];

                if (prefix[0] == '\0') {
                    snprintf(path_buffer, sizeof(path_buffer), "%s", key);
                } else {
                    snprintf(path_buffer, sizeof(path_buffer), "%s.%s", prefix, key);
                }

                if (schema_infer_value(schema, path_buffer, nested) != 0) {
                    return -1;
                }
            }
            return 0;
        }

        default:
            return json_schema_add_field(schema, prefix, JSON_TYPE_DYNAMIC, false);
    }
}

// ============================================================================
// Extension API
// ============================================================================

static int g_initialized = 0;
static int g_inference_count = 0;

EMSCRIPTEN_KEEPALIVE
int ext_json_columnar_init(void) {
    if (g_initialized) {
        return 0;
    }
    g_initialized = 1;
    g_inference_count = 0;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* ext_json_columnar_get_name(void) {
    return "ext-json-columnar";
}

EMSCRIPTEN_KEEPALIVE
int ext_json_columnar_get_version(void) {
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int ext_json_columnar_is_initialized(void) {
    return g_initialized;
}

EMSCRIPTEN_KEEPALIVE
int ext_json_columnar_get_inference_count(void) {
    return g_inference_count;
}

/**
 * Parse a JSON string into a JSONValue
 */
EMSCRIPTEN_KEEPALIVE
JSONValue* ext_json_columnar_parse(const char* json, size_t len) {
    if (!json) return nullptr;
    if (len == 0) len = strlen(json);

    JSONValue* result = (JSONValue*)malloc(sizeof(JSONValue));
    if (!result) return nullptr;

    JSONParser parser;
    parser_init(&parser, json, len);

    if (!parser_parse_value(&parser, result)) {
        free(result);
        return nullptr;
    }

    return result;
}

/**
 * Free a parsed JSONValue
 */
EMSCRIPTEN_KEEPALIVE
void ext_json_columnar_free_value(JSONValue* value) {
    if (value) {
        json_value_free(value);
        free(value);
    }
}

/**
 * Infer schema from a JSON string
 */
EMSCRIPTEN_KEEPALIVE
JSONSchema* ext_json_columnar_infer_schema(const char* json, size_t len) {
    if (!json) return nullptr;

    JSONValue* value = ext_json_columnar_parse(json, len);
    if (!value) return nullptr;

    JSONSchema* schema = json_schema_create();
    if (!schema) {
        ext_json_columnar_free_value(value);
        return nullptr;
    }

    if (schema_infer_value(schema, "", value) != 0) {
        json_schema_free(schema);
        ext_json_columnar_free_value(value);
        return nullptr;
    }

    ext_json_columnar_free_value(value);
    g_inference_count++;

    return schema;
}

/**
 * Get the number of fields in a schema
 */
EMSCRIPTEN_KEEPALIVE
size_t ext_json_columnar_schema_field_count(const JSONSchema* schema) {
    if (!schema) return 0;
    return schema->field_count;
}

/**
 * Get a field path from a schema
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_json_columnar_schema_get_field_path(const JSONSchema* schema, size_t index) {
    if (!schema || index >= schema->field_count) return nullptr;
    return schema->fields[index]->path;
}

/**
 * Get a field type from a schema
 */
EMSCRIPTEN_KEEPALIVE
JSONType ext_json_columnar_schema_get_field_type(const JSONSchema* schema, size_t index) {
    if (!schema || index >= schema->field_count) return JSON_TYPE_NULL;
    return schema->fields[index]->type;
}

/**
 * Check if a field is nullable
 */
EMSCRIPTEN_KEEPALIVE
bool ext_json_columnar_schema_field_is_nullable(const JSONSchema* schema, size_t index) {
    if (!schema || index >= schema->field_count) return false;
    return schema->fields[index]->nullable;
}

/**
 * Free a schema
 */
EMSCRIPTEN_KEEPALIVE
void ext_json_columnar_free_schema(JSONSchema* schema) {
    json_schema_free(schema);
}

/**
 * Get type name as string
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_json_columnar_type_name(JSONType type) {
    return json_type_name(type);
}

/**
 * Get ClickHouse type name
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_json_columnar_type_to_clickhouse(JSONType type) {
    return json_type_to_clickhouse(type);
}

} // extern "C"
