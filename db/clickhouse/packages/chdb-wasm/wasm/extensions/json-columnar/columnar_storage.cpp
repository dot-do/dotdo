/**
 * columnar_storage.cpp - Columnar Storage for JSON Type
 *
 * This module implements the core columnar storage for ClickHouse's
 * native JSON type. JSON data is stored as columns, with one column
 * per unique path discovered in the data.
 *
 * Key features:
 * - Automatic column creation for new paths
 * - Type-specific storage (Int64, Float64, String, etc.)
 * - Null bitmap for sparse data
 * - Efficient array storage with offsets
 * - Query by path with type-safe extraction
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
#include <stdio.h>

#include "json_type.h"

// ============================================================================
// Forward declarations
// ============================================================================

extern "C" {
    void* malloc(size_t size);
    void* realloc(void* ptr, size_t size);
    void free(void* ptr);

    // From path_parser.cpp
    typedef struct PathExpression PathExpression;
    PathExpression* path_parse(const char* path);
    void path_expr_free(PathExpression* expr);
    size_t path_expr_count(const PathExpression* expr);
    const void* path_expr_get(const PathExpression* expr, size_t index);
    char* path_expr_to_string(const PathExpression* expr);
    void path_free_string(char* str);
    const JSONValue* path_navigate(const JSONValue* root, const PathExpression* path);

    // From schema_inference.cpp
    JSONValue* ext_json_columnar_parse(const char* json, size_t len);
    void ext_json_columnar_free_value(JSONValue* value);
}

// ============================================================================
// Null Bitmap Helpers
// ============================================================================

static uint8_t* null_bitmap_create(size_t row_count) {
    size_t byte_count = (row_count + 7) / 8;
    uint8_t* bitmap = (uint8_t*)malloc(byte_count);
    if (bitmap) {
        memset(bitmap, 0, byte_count); // 0 = not null
    }
    return bitmap;
}

static void null_bitmap_set(uint8_t* bitmap, size_t row, bool is_null) {
    size_t byte_idx = row / 8;
    size_t bit_idx = row % 8;
    if (is_null) {
        bitmap[byte_idx] |= (1 << bit_idx);
    } else {
        bitmap[byte_idx] &= ~(1 << bit_idx);
    }
}

static bool null_bitmap_get(const uint8_t* bitmap, size_t row) {
    size_t byte_idx = row / 8;
    size_t bit_idx = row % 8;
    return (bitmap[byte_idx] & (1 << bit_idx)) != 0;
}

// ============================================================================
// JSONColumn Implementation
// ============================================================================

extern "C" {

JSONColumn* json_column_create(const char* path, JSONColumnType type) {
    JSONColumn* col = (JSONColumn*)malloc(sizeof(JSONColumn));
    if (!col) return nullptr;

    memset(col, 0, sizeof(JSONColumn));

    if (path) {
        col->path = (char*)malloc(strlen(path) + 1);
        if (col->path) {
            strcpy(col->path, path);
        }
    }

    col->col_type = type;
    col->row_count = 0;
    col->null_bitmap = nullptr;
    col->null_bitmap_size = 0;

    return col;
}

void json_column_free(JSONColumn* col) {
    if (!col) return;

    if (col->path) free(col->path);
    if (col->null_bitmap) free(col->null_bitmap);

    switch (col->col_type) {
        case JSON_COL_BOOL:
            if (col->storage.bool_data.data) free(col->storage.bool_data.data);
            break;
        case JSON_COL_INT64:
            if (col->storage.int64_data.data) free(col->storage.int64_data.data);
            break;
        case JSON_COL_UINT64:
            if (col->storage.uint64_data.data) free(col->storage.uint64_data.data);
            break;
        case JSON_COL_FLOAT64:
            if (col->storage.float64_data.data) free(col->storage.float64_data.data);
            break;
        case JSON_COL_STRING:
            if (col->storage.string_data.offsets) free(col->storage.string_data.offsets);
            if (col->storage.string_data.data) free(col->storage.string_data.data);
            break;
        case JSON_COL_NESTED:
            for (size_t i = 0; i < col->storage.nested_data.column_count; i++) {
                json_column_free(col->storage.nested_data.columns[i]);
            }
            if (col->storage.nested_data.columns) free(col->storage.nested_data.columns);
            break;
        case JSON_COL_ARRAY:
            if (col->storage.array_data.offsets) free(col->storage.array_data.offsets);
            if (col->storage.array_data.elements) json_column_free(col->storage.array_data.elements);
            break;
        case JSON_COL_DYNAMIC:
            if (col->storage.dynamic_data.type_tags) free(col->storage.dynamic_data.type_tags);
            if (col->storage.dynamic_data.offsets) free(col->storage.dynamic_data.offsets);
            if (col->storage.dynamic_data.data) free(col->storage.dynamic_data.data);
            break;
        default:
            break;
    }

    free(col);
}

int json_column_reserve(JSONColumn* col, size_t row_count) {
    if (!col) return -1;

    // Reserve null bitmap
    size_t byte_count = (row_count + 7) / 8;
    if (byte_count > col->null_bitmap_size) {
        uint8_t* new_bitmap = (uint8_t*)realloc(col->null_bitmap, byte_count);
        if (!new_bitmap) return -1;
        // Clear new bytes
        memset(new_bitmap + col->null_bitmap_size, 0, byte_count - col->null_bitmap_size);
        col->null_bitmap = new_bitmap;
        col->null_bitmap_size = byte_count;
    }

    // Reserve type-specific storage
    switch (col->col_type) {
        case JSON_COL_BOOL:
            if (row_count > col->storage.bool_data.capacity) {
                size_t new_capacity = row_count > 0 ? row_count : 8;
                uint8_t* new_data = (uint8_t*)realloc(col->storage.bool_data.data, new_capacity);
                if (!new_data) return -1;
                col->storage.bool_data.data = new_data;
                col->storage.bool_data.capacity = new_capacity;
            }
            break;

        case JSON_COL_INT64:
            if (row_count > col->storage.int64_data.capacity) {
                size_t new_capacity = row_count > 0 ? row_count : 8;
                int64_t* new_data = (int64_t*)realloc(col->storage.int64_data.data, new_capacity * sizeof(int64_t));
                if (!new_data) return -1;
                col->storage.int64_data.data = new_data;
                col->storage.int64_data.capacity = new_capacity;
            }
            break;

        case JSON_COL_UINT64:
            if (row_count > col->storage.uint64_data.capacity) {
                size_t new_capacity = row_count > 0 ? row_count : 8;
                uint64_t* new_data = (uint64_t*)realloc(col->storage.uint64_data.data, new_capacity * sizeof(uint64_t));
                if (!new_data) return -1;
                col->storage.uint64_data.data = new_data;
                col->storage.uint64_data.capacity = new_capacity;
            }
            break;

        case JSON_COL_FLOAT64:
            if (row_count > col->storage.float64_data.capacity) {
                size_t new_capacity = row_count > 0 ? row_count : 8;
                double* new_data = (double*)realloc(col->storage.float64_data.data, new_capacity * sizeof(double));
                if (!new_data) return -1;
                col->storage.float64_data.data = new_data;
                col->storage.float64_data.capacity = new_capacity;
            }
            break;

        case JSON_COL_STRING:
            if (row_count + 1 > col->storage.string_data.offsets_capacity) {
                size_t new_capacity = row_count + 1 > 8 ? row_count + 1 : 8;
                uint64_t* new_offsets = (uint64_t*)realloc(col->storage.string_data.offsets, new_capacity * sizeof(uint64_t));
                if (!new_offsets) return -1;
                col->storage.string_data.offsets = new_offsets;
                col->storage.string_data.offsets_capacity = new_capacity;
                // Initialize first offset if needed
                if (col->row_count == 0) {
                    col->storage.string_data.offsets[0] = 0;
                }
            }
            break;

        default:
            break;
    }

    return 0;
}

int json_column_append_null(JSONColumn* col) {
    if (!col) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    null_bitmap_set(col->null_bitmap, row, true);

    // Append default value based on type
    switch (col->col_type) {
        case JSON_COL_BOOL:
            col->storage.bool_data.data[row] = 0;
            break;
        case JSON_COL_INT64:
            col->storage.int64_data.data[row] = 0;
            break;
        case JSON_COL_UINT64:
            col->storage.uint64_data.data[row] = 0;
            break;
        case JSON_COL_FLOAT64:
            col->storage.float64_data.data[row] = 0.0;
            break;
        case JSON_COL_STRING:
            col->storage.string_data.offsets[row + 1] = col->storage.string_data.offsets[row];
            break;
        default:
            break;
    }

    col->row_count++;
    return 0;
}

int json_column_append_bool(JSONColumn* col, bool value) {
    if (!col || col->col_type != JSON_COL_BOOL) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    null_bitmap_set(col->null_bitmap, row, false);
    col->storage.bool_data.data[row] = value ? 1 : 0;

    col->row_count++;
    return 0;
}

int json_column_append_int64(JSONColumn* col, int64_t value) {
    if (!col || col->col_type != JSON_COL_INT64) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    null_bitmap_set(col->null_bitmap, row, false);
    col->storage.int64_data.data[row] = value;

    col->row_count++;
    return 0;
}

int json_column_append_uint64(JSONColumn* col, uint64_t value) {
    if (!col || col->col_type != JSON_COL_UINT64) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    null_bitmap_set(col->null_bitmap, row, false);
    col->storage.uint64_data.data[row] = value;

    col->row_count++;
    return 0;
}

int json_column_append_float64(JSONColumn* col, double value) {
    if (!col || col->col_type != JSON_COL_FLOAT64) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    null_bitmap_set(col->null_bitmap, row, false);
    col->storage.float64_data.data[row] = value;

    col->row_count++;
    return 0;
}

int json_column_append_string(JSONColumn* col, const char* value, size_t len) {
    if (!col || col->col_type != JSON_COL_STRING) return -1;

    size_t row = col->row_count;
    if (json_column_reserve(col, row + 1) != 0) return -1;

    // Expand string data if needed
    size_t new_data_size = col->storage.string_data.data_size + len;
    if (new_data_size > col->storage.string_data.data_capacity) {
        size_t new_capacity = new_data_size > col->storage.string_data.data_capacity * 2 ?
            new_data_size : col->storage.string_data.data_capacity * 2;
        if (new_capacity < 64) new_capacity = 64;
        char* new_data = (char*)realloc(col->storage.string_data.data, new_capacity);
        if (!new_data) return -1;
        col->storage.string_data.data = new_data;
        col->storage.string_data.data_capacity = new_capacity;
    }

    // Copy string data
    if (value && len > 0) {
        memcpy(col->storage.string_data.data + col->storage.string_data.data_size, value, len);
    }

    null_bitmap_set(col->null_bitmap, row, false);
    col->storage.string_data.offsets[row + 1] = col->storage.string_data.data_size + len;
    col->storage.string_data.data_size += len;

    col->row_count++;
    return 0;
}

int json_column_append_value(JSONColumn* col, const JSONValue* value) {
    if (!col || !value) return -1;

    if (value->type == JSON_TYPE_NULL) {
        return json_column_append_null(col);
    }

    switch (col->col_type) {
        case JSON_COL_BOOL:
            if (value->type == JSON_TYPE_BOOL) {
                return json_column_append_bool(col, value->value.bool_value);
            }
            break;

        case JSON_COL_INT64:
            if (value->type == JSON_TYPE_INT64) {
                return json_column_append_int64(col, value->value.int64_value);
            }
            if (value->type == JSON_TYPE_UINT64) {
                return json_column_append_int64(col, (int64_t)value->value.uint64_value);
            }
            break;

        case JSON_COL_UINT64:
            if (value->type == JSON_TYPE_UINT64) {
                return json_column_append_uint64(col, value->value.uint64_value);
            }
            if (value->type == JSON_TYPE_INT64 && value->value.int64_value >= 0) {
                return json_column_append_uint64(col, (uint64_t)value->value.int64_value);
            }
            break;

        case JSON_COL_FLOAT64:
            if (value->type == JSON_TYPE_FLOAT64) {
                return json_column_append_float64(col, value->value.float64_value);
            }
            if (value->type == JSON_TYPE_INT64) {
                return json_column_append_float64(col, (double)value->value.int64_value);
            }
            if (value->type == JSON_TYPE_UINT64) {
                return json_column_append_float64(col, (double)value->value.uint64_value);
            }
            break;

        case JSON_COL_STRING:
            if (value->type == JSON_TYPE_STRING) {
                return json_column_append_string(col, value->value.string_value.data, value->value.string_value.length);
            }
            break;

        default:
            break;
    }

    // Type mismatch - append null
    return json_column_append_null(col);
}

bool json_column_is_null(const JSONColumn* col, size_t row) {
    if (!col || row >= col->row_count || !col->null_bitmap) return true;
    return null_bitmap_get(col->null_bitmap, row);
}

bool json_column_get_bool(const JSONColumn* col, size_t row) {
    if (!col || col->col_type != JSON_COL_BOOL || row >= col->row_count) return false;
    if (json_column_is_null(col, row)) return false;
    return col->storage.bool_data.data[row] != 0;
}

int64_t json_column_get_int64(const JSONColumn* col, size_t row) {
    if (!col || col->col_type != JSON_COL_INT64 || row >= col->row_count) return 0;
    if (json_column_is_null(col, row)) return 0;
    return col->storage.int64_data.data[row];
}

uint64_t json_column_get_uint64(const JSONColumn* col, size_t row) {
    if (!col || col->col_type != JSON_COL_UINT64 || row >= col->row_count) return 0;
    if (json_column_is_null(col, row)) return 0;
    return col->storage.uint64_data.data[row];
}

double json_column_get_float64(const JSONColumn* col, size_t row) {
    if (!col || col->col_type != JSON_COL_FLOAT64 || row >= col->row_count) return 0.0;
    if (json_column_is_null(col, row)) return 0.0;
    return col->storage.float64_data.data[row];
}

const char* json_column_get_string(const JSONColumn* col, size_t row, size_t* out_len) {
    if (!col || col->col_type != JSON_COL_STRING || row >= col->row_count) {
        if (out_len) *out_len = 0;
        return nullptr;
    }
    if (json_column_is_null(col, row)) {
        if (out_len) *out_len = 0;
        return nullptr;
    }

    uint64_t start = col->storage.string_data.offsets[row];
    uint64_t end = col->storage.string_data.offsets[row + 1];

    if (out_len) *out_len = end - start;
    return col->storage.string_data.data + start;
}

size_t json_column_size(const JSONColumn* col) {
    if (!col) return 0;
    return col->row_count;
}

const char* json_column_path(const JSONColumn* col) {
    if (!col) return nullptr;
    return col->path;
}

JSONColumnType json_column_type(const JSONColumn* col) {
    if (!col) return JSON_COL_NULL;
    return col->col_type;
}

// ============================================================================
// Compression Hints
// ============================================================================

JSONCompressionType json_column_recommended_compression(const JSONColumn* col) {
    if (!col) return JSON_COMPRESS_NONE;

    switch (col->col_type) {
        case JSON_COL_INT64:
        case JSON_COL_UINT64:
            // For sorted data, delta encoding works well
            // For now, suggest LZ4 as a default
            return JSON_COMPRESS_LZ4;

        case JSON_COL_FLOAT64:
            // Floats compress reasonably with LZ4
            return JSON_COMPRESS_LZ4;

        case JSON_COL_STRING:
            // Strings often benefit from dictionary encoding
            // Check cardinality in production
            return JSON_COMPRESS_DICT;

        case JSON_COL_BOOL:
            // Bools are already compact
            return JSON_COMPRESS_NONE;

        default:
            return JSON_COMPRESS_LZ4;
    }
}

// ============================================================================
// JSONColumnarStorage Implementation
// ============================================================================

JSONColumnarStorage* json_columnar_create(bool store_original) {
    JSONColumnarStorage* storage = (JSONColumnarStorage*)malloc(sizeof(JSONColumnarStorage));
    if (!storage) return nullptr;

    storage->schema = json_schema_create();
    if (!storage->schema) {
        free(storage);
        return nullptr;
    }

    storage->columns = nullptr;
    storage->column_count = 0;
    storage->column_capacity = 0;
    storage->row_count = 0;
    storage->json_offsets = nullptr;
    storage->json_data = nullptr;
    storage->json_data_size = 0;
    storage->json_data_capacity = 0;
    storage->store_original = store_original;

    return storage;
}

void json_columnar_free(JSONColumnarStorage* storage) {
    if (!storage) return;

    if (storage->schema) json_schema_free(storage->schema);

    for (size_t i = 0; i < storage->column_count; i++) {
        json_column_free(storage->columns[i]);
    }
    if (storage->columns) free(storage->columns);

    if (storage->json_offsets) free(storage->json_offsets);
    if (storage->json_data) free(storage->json_data);

    free(storage);
}

/**
 * Map JSONType to JSONColumnType
 */
static JSONColumnType json_type_to_col_type(JSONType type) {
    switch (type) {
        case JSON_TYPE_NULL: return JSON_COL_NULL;
        case JSON_TYPE_BOOL: return JSON_COL_BOOL;
        case JSON_TYPE_INT64: return JSON_COL_INT64;
        case JSON_TYPE_UINT64: return JSON_COL_UINT64;
        case JSON_TYPE_FLOAT64: return JSON_COL_FLOAT64;
        case JSON_TYPE_STRING: return JSON_COL_STRING;
        case JSON_TYPE_ARRAY: return JSON_COL_ARRAY;
        case JSON_TYPE_OBJECT: return JSON_COL_NESTED;
        case JSON_TYPE_DYNAMIC: return JSON_COL_DYNAMIC;
        default: return JSON_COL_NULL;
    }
}

/**
 * Find or create a column for a path
 */
static JSONColumn* json_columnar_get_or_create_column(JSONColumnarStorage* storage, const char* path, JSONType type) {
    // Check existing columns
    for (size_t i = 0; i < storage->column_count; i++) {
        if (strcmp(storage->columns[i]->path, path) == 0) {
            return storage->columns[i];
        }
    }

    // Create new column
    if (storage->column_count >= storage->column_capacity) {
        size_t new_capacity = storage->column_capacity == 0 ? 8 : storage->column_capacity * 2;
        JSONColumn** new_columns = (JSONColumn**)realloc(
            storage->columns, new_capacity * sizeof(JSONColumn*)
        );
        if (!new_columns) return nullptr;
        storage->columns = new_columns;
        storage->column_capacity = new_capacity;
    }

    JSONColumnType col_type = json_type_to_col_type(type);
    JSONColumn* col = json_column_create(path, col_type);
    if (!col) return nullptr;

    // Backfill with nulls for existing rows
    for (size_t i = 0; i < storage->row_count; i++) {
        json_column_append_null(col);
    }

    storage->columns[storage->column_count++] = col;

    // Add to schema
    json_schema_add_field(storage->schema, path, type, true);

    return col;
}

/**
 * Recursively insert a JSON value into columnar storage
 */
static int json_columnar_insert_recursive(
    JSONColumnarStorage* storage,
    const char* prefix,
    const JSONValue* value
) {
    char path_buffer[1024];

    switch (value->type) {
        case JSON_TYPE_NULL:
        case JSON_TYPE_BOOL:
        case JSON_TYPE_INT64:
        case JSON_TYPE_UINT64:
        case JSON_TYPE_FLOAT64:
        case JSON_TYPE_STRING: {
            JSONColumn* col = json_columnar_get_or_create_column(storage, prefix, value->type);
            if (!col) return -1;
            return json_column_append_value(col, value);
        }

        case JSON_TYPE_ARRAY: {
            // For arrays, we create a column for each element's path
            // Using wildcard notation: items[*].price
            for (size_t i = 0; i < value->value.array_value.count; i++) {
                const JSONValue* elem = &value->value.array_value.items[i];

                // For scalar array elements
                if (elem->type != JSON_TYPE_OBJECT && elem->type != JSON_TYPE_ARRAY) {
                    snprintf(path_buffer, sizeof(path_buffer), "%s[*]", prefix);
                    JSONColumn* col = json_columnar_get_or_create_column(storage, path_buffer, elem->type);
                    if (!col) return -1;
                    json_column_append_value(col, elem);
                } else {
                    // For nested structures
                    snprintf(path_buffer, sizeof(path_buffer), "%s[%zu]", prefix, i);
                    json_columnar_insert_recursive(storage, path_buffer, elem);
                }
            }
            return 0;
        }

        case JSON_TYPE_OBJECT: {
            // For objects, recurse into each field
            for (size_t i = 0; i < value->value.object_value.count; i++) {
                const char* key = value->value.object_value.keys[i];
                const JSONValue* field = &value->value.object_value.values[i];

                if (prefix[0] == '\0') {
                    snprintf(path_buffer, sizeof(path_buffer), "%s", key);
                } else {
                    snprintf(path_buffer, sizeof(path_buffer), "%s.%s", prefix, key);
                }

                if (json_columnar_insert_recursive(storage, path_buffer, field) != 0) {
                    return -1;
                }
            }
            return 0;
        }

        default:
            return -1;
    }
}

int json_columnar_insert(JSONColumnarStorage* storage, const char* json, size_t len) {
    if (!storage || !json) return -1;

    // Parse JSON
    JSONValue* value = ext_json_columnar_parse(json, len);
    if (!value) return -1;

    // Store original if requested
    if (storage->store_original) {
        if (len == 0) len = strlen(json);

        // Ensure offset array capacity
        if (storage->row_count + 1 >= storage->column_capacity) {
            size_t new_capacity = storage->column_capacity == 0 ? 8 : storage->column_capacity * 2;
            uint64_t* new_offsets = (uint64_t*)realloc(
                storage->json_offsets, (new_capacity + 1) * sizeof(uint64_t)
            );
            if (!new_offsets) {
                ext_json_columnar_free_value(value);
                return -1;
            }
            storage->json_offsets = new_offsets;
            if (storage->row_count == 0) {
                storage->json_offsets[0] = 0;
            }
        }

        // Ensure data capacity
        if (storage->json_data_size + len > storage->json_data_capacity) {
            size_t new_capacity = storage->json_data_size + len > storage->json_data_capacity * 2 ?
                storage->json_data_size + len : storage->json_data_capacity * 2;
            if (new_capacity < 1024) new_capacity = 1024;
            char* new_data = (char*)realloc(storage->json_data, new_capacity);
            if (!new_data) {
                ext_json_columnar_free_value(value);
                return -1;
            }
            storage->json_data = new_data;
            storage->json_data_capacity = new_capacity;
        }

        memcpy(storage->json_data + storage->json_data_size, json, len);
        storage->json_offsets[storage->row_count + 1] = storage->json_data_size + len;
        storage->json_data_size += len;
    }

    // Insert into columnar storage
    int result = json_columnar_insert_recursive(storage, "", value);

    // Increment row count
    storage->row_count++;

    // Backfill nulls for columns that didn't get a value this row
    for (size_t i = 0; i < storage->column_count; i++) {
        JSONColumn* col = storage->columns[i];
        while (col->row_count < storage->row_count) {
            json_column_append_null(col);
        }
    }

    ext_json_columnar_free_value(value);
    return result;
}

int json_columnar_insert_value(JSONColumnarStorage* storage, const JSONValue* value) {
    if (!storage || !value) return -1;

    int result = json_columnar_insert_recursive(storage, "", value);

    storage->row_count++;

    // Backfill nulls
    for (size_t i = 0; i < storage->column_count; i++) {
        JSONColumn* col = storage->columns[i];
        while (col->row_count < storage->row_count) {
            json_column_append_null(col);
        }
    }

    return result;
}

JSONColumn* json_columnar_query_path(const JSONColumnarStorage* storage, const char* path) {
    if (!storage || !path) return nullptr;

    // Check for exact match first
    for (size_t i = 0; i < storage->column_count; i++) {
        if (strcmp(storage->columns[i]->path, path) == 0) {
            // Return a copy of the column
            JSONColumn* result = json_column_create(path, storage->columns[i]->col_type);
            if (!result) return nullptr;

            for (size_t row = 0; row < storage->columns[i]->row_count; row++) {
                if (json_column_is_null(storage->columns[i], row)) {
                    json_column_append_null(result);
                } else {
                    switch (result->col_type) {
                        case JSON_COL_BOOL:
                            json_column_append_bool(result, json_column_get_bool(storage->columns[i], row));
                            break;
                        case JSON_COL_INT64:
                            json_column_append_int64(result, json_column_get_int64(storage->columns[i], row));
                            break;
                        case JSON_COL_UINT64:
                            json_column_append_uint64(result, json_column_get_uint64(storage->columns[i], row));
                            break;
                        case JSON_COL_FLOAT64:
                            json_column_append_float64(result, json_column_get_float64(storage->columns[i], row));
                            break;
                        case JSON_COL_STRING: {
                            size_t len;
                            const char* str = json_column_get_string(storage->columns[i], row, &len);
                            json_column_append_string(result, str, len);
                            break;
                        }
                        default:
                            json_column_append_null(result);
                            break;
                    }
                }
            }

            return result;
        }
    }

    return nullptr;
}

const JSONColumn* json_columnar_get_column(const JSONColumnarStorage* storage, const char* path) {
    if (!storage || !path) return nullptr;

    for (size_t i = 0; i < storage->column_count; i++) {
        if (strcmp(storage->columns[i]->path, path) == 0) {
            return storage->columns[i];
        }
    }

    return nullptr;
}

const char* const* json_columnar_get_paths(const JSONColumnarStorage* storage, size_t* out_count) {
    if (!storage || !out_count) {
        if (out_count) *out_count = 0;
        return nullptr;
    }

    *out_count = storage->schema->path_count;
    return (const char* const*)storage->schema->paths;
}

const JSONSchema* json_columnar_get_schema(const JSONColumnarStorage* storage) {
    if (!storage) return nullptr;
    return storage->schema;
}

size_t json_columnar_row_count(const JSONColumnarStorage* storage) {
    if (!storage) return 0;
    return storage->row_count;
}

// ============================================================================
// Extension API for Columnar Storage
// ============================================================================

EMSCRIPTEN_KEEPALIVE
JSONColumnarStorage* ext_json_columnar_storage_create(bool store_original) {
    return json_columnar_create(store_original);
}

EMSCRIPTEN_KEEPALIVE
void ext_json_columnar_storage_free(JSONColumnarStorage* storage) {
    json_columnar_free(storage);
}

EMSCRIPTEN_KEEPALIVE
int ext_json_columnar_storage_insert(JSONColumnarStorage* storage, const char* json, size_t len) {
    return json_columnar_insert(storage, json, len);
}

EMSCRIPTEN_KEEPALIVE
size_t ext_json_columnar_storage_row_count(const JSONColumnarStorage* storage) {
    return json_columnar_row_count(storage);
}

EMSCRIPTEN_KEEPALIVE
size_t ext_json_columnar_storage_column_count(const JSONColumnarStorage* storage) {
    if (!storage) return 0;
    return storage->column_count;
}

EMSCRIPTEN_KEEPALIVE
const char* ext_json_columnar_storage_get_column_path(const JSONColumnarStorage* storage, size_t index) {
    if (!storage || index >= storage->column_count) return nullptr;
    return storage->columns[index]->path;
}

EMSCRIPTEN_KEEPALIVE
JSONColumnType ext_json_columnar_storage_get_column_type(const JSONColumnarStorage* storage, size_t index) {
    if (!storage || index >= storage->column_count) return JSON_COL_NULL;
    return storage->columns[index]->col_type;
}

/**
 * Query by path and return value as string (for TypeScript interop)
 */
EMSCRIPTEN_KEEPALIVE
char* ext_json_columnar_query_string(const JSONColumnarStorage* storage, const char* path, size_t row) {
    if (!storage || !path || row >= storage->row_count) return nullptr;

    const JSONColumn* col = json_columnar_get_column(storage, path);
    if (!col || row >= col->row_count) return nullptr;

    if (json_column_is_null(col, row)) return nullptr;

    char buffer[256];
    switch (col->col_type) {
        case JSON_COL_BOOL:
            snprintf(buffer, sizeof(buffer), "%s", json_column_get_bool(col, row) ? "true" : "false");
            break;
        case JSON_COL_INT64:
            snprintf(buffer, sizeof(buffer), "%lld", (long long)json_column_get_int64(col, row));
            break;
        case JSON_COL_UINT64:
            snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)json_column_get_uint64(col, row));
            break;
        case JSON_COL_FLOAT64:
            snprintf(buffer, sizeof(buffer), "%g", json_column_get_float64(col, row));
            break;
        case JSON_COL_STRING: {
            size_t len;
            const char* str = json_column_get_string(col, row, &len);
            if (!str) return nullptr;
            char* result = (char*)malloc(len + 1);
            if (result) {
                memcpy(result, str, len);
                result[len] = '\0';
            }
            return result;
        }
        default:
            return nullptr;
    }

    char* result = (char*)malloc(strlen(buffer) + 1);
    if (result) {
        strcpy(result, buffer);
    }
    return result;
}

/**
 * Query by path and return integer value
 */
EMSCRIPTEN_KEEPALIVE
int64_t ext_json_columnar_query_int(const JSONColumnarStorage* storage, const char* path, size_t row) {
    if (!storage || !path || row >= storage->row_count) return 0;

    const JSONColumn* col = json_columnar_get_column(storage, path);
    if (!col || row >= col->row_count) return 0;

    if (json_column_is_null(col, row)) return 0;

    switch (col->col_type) {
        case JSON_COL_INT64:
            return json_column_get_int64(col, row);
        case JSON_COL_UINT64:
            return (int64_t)json_column_get_uint64(col, row);
        case JSON_COL_FLOAT64:
            return (int64_t)json_column_get_float64(col, row);
        case JSON_COL_BOOL:
            return json_column_get_bool(col, row) ? 1 : 0;
        default:
            return 0;
    }
}

/**
 * Query by path and return float value
 */
EMSCRIPTEN_KEEPALIVE
double ext_json_columnar_query_float(const JSONColumnarStorage* storage, const char* path, size_t row) {
    if (!storage || !path || row >= storage->row_count) return 0.0;

    const JSONColumn* col = json_columnar_get_column(storage, path);
    if (!col || row >= col->row_count) return 0.0;

    if (json_column_is_null(col, row)) return 0.0;

    switch (col->col_type) {
        case JSON_COL_FLOAT64:
            return json_column_get_float64(col, row);
        case JSON_COL_INT64:
            return (double)json_column_get_int64(col, row);
        case JSON_COL_UINT64:
            return (double)json_column_get_uint64(col, row);
        default:
            return 0.0;
    }
}

/**
 * Check if a value is null
 */
EMSCRIPTEN_KEEPALIVE
bool ext_json_columnar_query_is_null(const JSONColumnarStorage* storage, const char* path, size_t row) {
    if (!storage || !path || row >= storage->row_count) return true;

    const JSONColumn* col = json_columnar_get_column(storage, path);
    if (!col || row >= col->row_count) return true;

    return json_column_is_null(col, row);
}

} // extern "C"
