/**
 * json_type.h - Native Columnar JSON Type for ClickHouse WASM
 *
 * This header defines the core types and structures for ClickHouse's
 * modern columnar JSON data type. This is NOT the legacy JSONExtract
 * approach - it implements native JSON columns with automatic type
 * inference and path-based access.
 *
 * Key features:
 * - JSON stored in columnar format (one column per unique path)
 * - Automatic type inference from JSON samples
 * - Path syntax: data.user.name (NOT JSONExtract!)
 * - Array indexing: data.items[0].price
 * - Wildcard support: data.items[*].price
 *
 * Reference: https://clickhouse.com/docs/en/sql-reference/data-types/newjson
 */

#ifndef CHDB_WASM_JSON_COLUMNAR_JSON_TYPE_H
#define CHDB_WASM_JSON_COLUMNAR_JSON_TYPE_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// JSON Type Enumeration
// ============================================================================

/**
 * JSON value types as stored in the columnar format.
 * These correspond to JSON Schema types with additional
 * ClickHouse-specific optimizations.
 */
typedef enum {
    JSON_TYPE_NULL = 0,      // null value
    JSON_TYPE_BOOL = 1,      // true/false
    JSON_TYPE_INT64 = 2,     // Integer (stored as Int64)
    JSON_TYPE_UINT64 = 3,    // Unsigned integer (stored as UInt64)
    JSON_TYPE_FLOAT64 = 4,   // Floating point (stored as Float64)
    JSON_TYPE_STRING = 5,    // String (stored as String)
    JSON_TYPE_ARRAY = 6,     // Array (nested columnar storage)
    JSON_TYPE_OBJECT = 7,    // Object (nested columnar storage)
    JSON_TYPE_DYNAMIC = 8,   // Mixed types (fallback to string)
} JSONType;

/**
 * Get the string name of a JSON type
 */
const char* json_type_name(JSONType type);

/**
 * Get the ClickHouse SQL type name for a JSON type
 */
const char* json_type_to_clickhouse(JSONType type);

// ============================================================================
// JSON Value Union
// ============================================================================

/**
 * JSONValue - A discriminated union representing a single JSON value.
 * Used during parsing and for intermediate storage.
 */
typedef struct {
    JSONType type;
    union {
        bool bool_value;
        int64_t int64_value;
        uint64_t uint64_value;
        double float64_value;
        struct {
            char* data;
            size_t length;
        } string_value;
        struct {
            struct JSONValue* items;
            size_t count;
            size_t capacity;
        } array_value;
        struct {
            char** keys;
            struct JSONValue* values;
            size_t count;
            size_t capacity;
        } object_value;
    } value;
} JSONValue;

/**
 * Initialize a JSONValue as null
 */
void json_value_init(JSONValue* v);

/**
 * Free memory associated with a JSONValue
 */
void json_value_free(JSONValue* v);

/**
 * Create a JSONValue from different types
 */
JSONValue json_value_null(void);
JSONValue json_value_bool(bool b);
JSONValue json_value_int64(int64_t i);
JSONValue json_value_uint64(uint64_t u);
JSONValue json_value_float64(double f);
JSONValue json_value_string(const char* s, size_t len);
JSONValue json_value_array(void);
JSONValue json_value_object(void);

/**
 * Array operations
 */
int json_value_array_push(JSONValue* arr, JSONValue item);
size_t json_value_array_size(const JSONValue* arr);
const JSONValue* json_value_array_get(const JSONValue* arr, size_t index);

/**
 * Object operations
 */
int json_value_object_set(JSONValue* obj, const char* key, JSONValue value);
const JSONValue* json_value_object_get(const JSONValue* obj, const char* key);
size_t json_value_object_size(const JSONValue* obj);

// ============================================================================
// JSON Column - Columnar Storage for JSON
// ============================================================================

/**
 * JSONColumnType - Storage strategy for a JSON column
 */
typedef enum {
    JSON_COL_NULL,      // All nulls
    JSON_COL_BOOL,      // UInt8 (0/1)
    JSON_COL_INT64,     // Int64
    JSON_COL_UINT64,    // UInt64
    JSON_COL_FLOAT64,   // Float64
    JSON_COL_STRING,    // String (offsets + data)
    JSON_COL_NESTED,    // Nested columns (for objects)
    JSON_COL_ARRAY,     // Array column (offsets + element column)
    JSON_COL_DYNAMIC,   // Mixed types (discriminated union)
} JSONColumnType;

/**
 * JSONColumn - A single column in the columnar JSON storage.
 * One column is created for each unique JSON path.
 */
typedef struct JSONColumn {
    /** Path to this column (e.g., "user.name", "items[*].price") */
    char* path;

    /** Storage type for this column */
    JSONColumnType col_type;

    /** Number of rows in this column */
    size_t row_count;

    /** Null bitmap (1 bit per row, 1=null) */
    uint8_t* null_bitmap;
    size_t null_bitmap_size;

    /** Storage based on col_type */
    union {
        struct {
            uint8_t* data;
            size_t capacity;
        } bool_data;

        struct {
            int64_t* data;
            size_t capacity;
        } int64_data;

        struct {
            uint64_t* data;
            size_t capacity;
        } uint64_data;

        struct {
            double* data;
            size_t capacity;
        } float64_data;

        struct {
            /** String offsets (row_count + 1 entries) */
            uint64_t* offsets;
            size_t offsets_capacity;
            /** Concatenated string data */
            char* data;
            size_t data_size;
            size_t data_capacity;
        } string_data;

        struct {
            /** Nested columns for object fields */
            struct JSONColumn** columns;
            size_t column_count;
            size_t column_capacity;
        } nested_data;

        struct {
            /** Array offsets (row_count + 1 entries) */
            uint64_t* offsets;
            size_t offsets_capacity;
            /** Element storage (single column) */
            struct JSONColumn* elements;
        } array_data;

        struct {
            /** Type tags (one per row) */
            uint8_t* type_tags;
            /** String representation (fallback) */
            uint64_t* offsets;
            size_t offsets_capacity;
            char* data;
            size_t data_size;
            size_t data_capacity;
        } dynamic_data;
    } storage;
} JSONColumn;

/**
 * Create a new JSON column
 */
JSONColumn* json_column_create(const char* path, JSONColumnType type);

/**
 * Free a JSON column and all its storage
 */
void json_column_free(JSONColumn* col);

/**
 * Reserve capacity for a certain number of rows
 */
int json_column_reserve(JSONColumn* col, size_t row_count);

/**
 * Append a value to the column
 */
int json_column_append_null(JSONColumn* col);
int json_column_append_bool(JSONColumn* col, bool value);
int json_column_append_int64(JSONColumn* col, int64_t value);
int json_column_append_uint64(JSONColumn* col, uint64_t value);
int json_column_append_float64(JSONColumn* col, double value);
int json_column_append_string(JSONColumn* col, const char* value, size_t len);
int json_column_append_value(JSONColumn* col, const JSONValue* value);

/**
 * Read a value from the column
 */
bool json_column_is_null(const JSONColumn* col, size_t row);
bool json_column_get_bool(const JSONColumn* col, size_t row);
int64_t json_column_get_int64(const JSONColumn* col, size_t row);
uint64_t json_column_get_uint64(const JSONColumn* col, size_t row);
double json_column_get_float64(const JSONColumn* col, size_t row);
const char* json_column_get_string(const JSONColumn* col, size_t row, size_t* out_len);

/**
 * Get column metadata
 */
size_t json_column_size(const JSONColumn* col);
const char* json_column_path(const JSONColumn* col);
JSONColumnType json_column_type(const JSONColumn* col);

// ============================================================================
// JSON Schema - Inferred Type Information
// ============================================================================

/**
 * JSONSchemaField - A single field in the inferred schema
 */
typedef struct JSONSchemaField {
    /** Field path (e.g., "user.name") */
    char* path;

    /** Inferred type */
    JSONType type;

    /** Whether this field is nullable */
    bool nullable;

    /** For arrays: element type */
    JSONType element_type;

    /** For objects: nested fields */
    struct JSONSchemaField** nested_fields;
    size_t nested_count;
} JSONSchemaField;

/**
 * JSONSchema - Complete schema for a JSON column
 */
typedef struct {
    /** Root fields */
    JSONSchemaField** fields;
    size_t field_count;
    size_t field_capacity;

    /** All unique paths discovered */
    char** paths;
    size_t path_count;
    size_t path_capacity;
} JSONSchema;

/**
 * Create an empty schema
 */
JSONSchema* json_schema_create(void);

/**
 * Free a schema
 */
void json_schema_free(JSONSchema* schema);

/**
 * Add or update a field in the schema
 */
int json_schema_add_field(JSONSchema* schema, const char* path, JSONType type, bool nullable);

/**
 * Get a field by path
 */
const JSONSchemaField* json_schema_get_field(const JSONSchema* schema, const char* path);

/**
 * Merge another schema into this one (for type coercion)
 */
int json_schema_merge(JSONSchema* dest, const JSONSchema* src);

// ============================================================================
// JSON Columnar Storage - Complete Storage for JSON Type
// ============================================================================

/**
 * JSONColumnarStorage - Full columnar storage for a JSON column.
 * This is the main data structure that stores JSON in columnar format.
 */
typedef struct {
    /** Inferred schema */
    JSONSchema* schema;

    /** Columns indexed by path */
    JSONColumn** columns;
    size_t column_count;
    size_t column_capacity;

    /** Total row count */
    size_t row_count;

    /** Original JSON strings (for fallback) */
    uint64_t* json_offsets;
    char* json_data;
    size_t json_data_size;
    size_t json_data_capacity;
    bool store_original;
} JSONColumnarStorage;

/**
 * Create a new columnar storage
 */
JSONColumnarStorage* json_columnar_create(bool store_original);

/**
 * Free columnar storage
 */
void json_columnar_free(JSONColumnarStorage* storage);

/**
 * Insert a JSON value into the storage
 */
int json_columnar_insert(JSONColumnarStorage* storage, const char* json, size_t len);

/**
 * Insert a parsed JSON value
 */
int json_columnar_insert_value(JSONColumnarStorage* storage, const JSONValue* value);

/**
 * Query by path (e.g., "data.user.name")
 * Returns a new column containing the extracted values
 */
JSONColumn* json_columnar_query_path(const JSONColumnarStorage* storage, const char* path);

/**
 * Get a column by path
 */
const JSONColumn* json_columnar_get_column(const JSONColumnarStorage* storage, const char* path);

/**
 * Get all column paths
 */
const char* const* json_columnar_get_paths(const JSONColumnarStorage* storage, size_t* out_count);

/**
 * Get the schema
 */
const JSONSchema* json_columnar_get_schema(const JSONColumnarStorage* storage);

/**
 * Get row count
 */
size_t json_columnar_row_count(const JSONColumnarStorage* storage);

// ============================================================================
// Type Coercion
// ============================================================================

/**
 * Determine the common type for two JSON types.
 * Used when the same path has different types in different rows.
 *
 * Coercion rules:
 * - int64 + uint64 -> int64 (if no overflow) or float64
 * - int/uint + float -> float64
 * - any + string -> string (via to_string)
 * - different types -> dynamic
 */
JSONType json_type_coerce(JSONType a, JSONType b);

/**
 * Can type 'from' be coerced to type 'to' without loss?
 */
bool json_type_can_coerce(JSONType from, JSONType to);

// ============================================================================
// Compression Hints
// ============================================================================

/**
 * Compression type hints for columnar storage
 */
typedef enum {
    JSON_COMPRESS_NONE = 0,    // No compression
    JSON_COMPRESS_LZ4 = 1,     // LZ4 compression
    JSON_COMPRESS_ZSTD = 2,    // ZSTD compression
    JSON_COMPRESS_DELTA = 3,   // Delta encoding (for sorted integers)
    JSON_COMPRESS_DICT = 4,    // Dictionary compression (for low-cardinality strings)
} JSONCompressionType;

/**
 * Get recommended compression for a column type
 */
JSONCompressionType json_column_recommended_compression(const JSONColumn* col);

#ifdef __cplusplus
}
#endif

#endif // CHDB_WASM_JSON_COLUMNAR_JSON_TYPE_H
