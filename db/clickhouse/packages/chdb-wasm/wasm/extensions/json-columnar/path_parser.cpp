/**
 * path_parser.cpp - JSON Path Parser for Columnar JSON Type
 *
 * This module parses ClickHouse's native JSON path syntax:
 * - data.user.name      - Object key access
 * - data.items[0]       - Array index access
 * - data.items[*]       - Array wildcard (all elements)
 * - data.items[0].price - Mixed access
 *
 * This is the MODERN path syntax, NOT JSONExtract-style.
 *
 * The parser produces a PathExpression that can be used to:
 * 1. Navigate into JSONValue structures
 * 2. Generate column paths for storage
 * 3. Create query execution plans
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
// Forward declarations
// ============================================================================

extern "C" {
    void* malloc(size_t size);
    void* realloc(void* ptr, size_t size);
    void free(void* ptr);
}

// ============================================================================
// Path Component Types
// ============================================================================

/**
 * Type of a path component
 */
typedef enum {
    PATH_ROOT = 0,          // The root of the JSON (implicit)
    PATH_KEY = 1,           // Object key access: .name
    PATH_INDEX = 2,         // Array index access: [0]
    PATH_WILDCARD = 3,      // Array wildcard: [*]
    PATH_RANGE = 4,         // Array range: [0:5] (future)
    PATH_RECURSIVE = 5,     // Recursive descent: .. (future)
} PathComponentType;

/**
 * A single component in a path expression
 */
typedef struct {
    PathComponentType type;
    union {
        struct {
            char* key;
            size_t key_len;
        } key_data;
        struct {
            int64_t index;
        } index_data;
        struct {
            int64_t start;
            int64_t end;    // -1 means to end
        } range_data;
    } data;
} PathComponent;

/**
 * A complete path expression
 */
typedef struct {
    PathComponent* components;
    size_t count;
    size_t capacity;
    char* original;         // Original path string
} PathExpression;

// ============================================================================
// Path Component Operations
// ============================================================================

static PathComponent path_component_root(void) {
    PathComponent c;
    c.type = PATH_ROOT;
    memset(&c.data, 0, sizeof(c.data));
    return c;
}

static PathComponent path_component_key(const char* key, size_t len) {
    PathComponent c;
    c.type = PATH_KEY;
    c.data.key_data.key = (char*)malloc(len + 1);
    if (c.data.key_data.key) {
        memcpy(c.data.key_data.key, key, len);
        c.data.key_data.key[len] = '\0';
        c.data.key_data.key_len = len;
    } else {
        c.data.key_data.key_len = 0;
    }
    return c;
}

static PathComponent path_component_index(int64_t index) {
    PathComponent c;
    c.type = PATH_INDEX;
    c.data.index_data.index = index;
    return c;
}

static PathComponent path_component_wildcard(void) {
    PathComponent c;
    c.type = PATH_WILDCARD;
    memset(&c.data, 0, sizeof(c.data));
    return c;
}

static void path_component_free(PathComponent* c) {
    if (c->type == PATH_KEY && c->data.key_data.key) {
        free(c->data.key_data.key);
        c->data.key_data.key = nullptr;
    }
}

// ============================================================================
// Path Expression Operations
// ============================================================================

extern "C" {

/**
 * Create a new path expression
 */
EMSCRIPTEN_KEEPALIVE
PathExpression* path_expr_create(void) {
    PathExpression* expr = (PathExpression*)malloc(sizeof(PathExpression));
    if (!expr) return nullptr;

    expr->components = nullptr;
    expr->count = 0;
    expr->capacity = 0;
    expr->original = nullptr;

    return expr;
}

/**
 * Free a path expression
 */
EMSCRIPTEN_KEEPALIVE
void path_expr_free(PathExpression* expr) {
    if (!expr) return;

    for (size_t i = 0; i < expr->count; i++) {
        path_component_free(&expr->components[i]);
    }

    if (expr->components) free(expr->components);
    if (expr->original) free(expr->original);
    free(expr);
}

/**
 * Add a component to a path expression
 */
static int path_expr_add(PathExpression* expr, PathComponent component) {
    if (expr->count >= expr->capacity) {
        size_t new_capacity = expr->capacity == 0 ? 8 : expr->capacity * 2;
        PathComponent* new_components = (PathComponent*)realloc(
            expr->components, new_capacity * sizeof(PathComponent)
        );
        if (!new_components) return -1;
        expr->components = new_components;
        expr->capacity = new_capacity;
    }

    expr->components[expr->count++] = component;
    return 0;
}

/**
 * Get the number of components in a path expression
 */
EMSCRIPTEN_KEEPALIVE
size_t path_expr_count(const PathExpression* expr) {
    if (!expr) return 0;
    return expr->count;
}

/**
 * Get a component from a path expression
 */
EMSCRIPTEN_KEEPALIVE
const PathComponent* path_expr_get(const PathExpression* expr, size_t index) {
    if (!expr || index >= expr->count) return nullptr;
    return &expr->components[index];
}

/**
 * Get the original path string
 */
EMSCRIPTEN_KEEPALIVE
const char* path_expr_original(const PathExpression* expr) {
    if (!expr) return nullptr;
    return expr->original;
}

/**
 * Get component type
 */
EMSCRIPTEN_KEEPALIVE
PathComponentType path_component_get_type(const PathComponent* c) {
    if (!c) return PATH_ROOT;
    return c->type;
}

/**
 * Get component key (for PATH_KEY type)
 */
EMSCRIPTEN_KEEPALIVE
const char* path_component_get_key(const PathComponent* c) {
    if (!c || c->type != PATH_KEY) return nullptr;
    return c->data.key_data.key;
}

/**
 * Get component index (for PATH_INDEX type)
 */
EMSCRIPTEN_KEEPALIVE
int64_t path_component_get_index(const PathComponent* c) {
    if (!c || c->type != PATH_INDEX) return -1;
    return c->data.index_data.index;
}

// ============================================================================
// Path Parser
// ============================================================================

/**
 * Parse a path expression from a string.
 *
 * Supported syntax:
 * - Simple key: "name" or "user.name"
 * - Array index: "items[0]" or "items[0].price"
 * - Array wildcard: "items[*]" or "items[*].price"
 * - Quoted keys: "user['complex.key']" (for keys with dots)
 *
 * @param path The path string to parse
 * @return A new PathExpression, or nullptr on error
 */
EMSCRIPTEN_KEEPALIVE
PathExpression* path_parse(const char* path) {
    if (!path) return nullptr;

    PathExpression* expr = path_expr_create();
    if (!expr) return nullptr;

    size_t path_len = strlen(path);
    expr->original = (char*)malloc(path_len + 1);
    if (expr->original) {
        strcpy(expr->original, path);
    }

    // Skip leading $ if present (JSONPath compatibility)
    size_t pos = 0;
    if (path[pos] == '$') {
        pos++;
    }

    // Skip leading dot if present
    if (path[pos] == '.') {
        pos++;
    }

    // Parse components
    while (pos < path_len) {
        char c = path[pos];

        // Skip dots between components
        if (c == '.') {
            pos++;
            continue;
        }

        // Array access: [index] or [*]
        if (c == '[') {
            pos++; // Skip '['

            // Check for wildcard
            if (path[pos] == '*') {
                pos++; // Skip '*'
                if (path[pos] != ']') {
                    path_expr_free(expr);
                    return nullptr; // Invalid: expected ']'
                }
                pos++; // Skip ']'
                path_expr_add(expr, path_component_wildcard());
                continue;
            }

            // Check for quoted string
            if (path[pos] == '\'' || path[pos] == '"') {
                char quote = path[pos++];
                size_t key_start = pos;
                while (pos < path_len && path[pos] != quote) {
                    if (path[pos] == '\\' && pos + 1 < path_len) pos++;
                    pos++;
                }
                size_t key_len = pos - key_start;
                if (path[pos] == quote) pos++;
                if (path[pos] == ']') pos++;
                path_expr_add(expr, path_component_key(path + key_start, key_len));
                continue;
            }

            // Parse numeric index
            bool negative = false;
            if (path[pos] == '-') {
                negative = true;
                pos++;
            }

            int64_t index = 0;
            bool has_digits = false;
            while (pos < path_len && path[pos] >= '0' && path[pos] <= '9') {
                has_digits = true;
                index = index * 10 + (path[pos] - '0');
                pos++;
            }

            if (!has_digits) {
                path_expr_free(expr);
                return nullptr; // Invalid: expected index
            }

            if (path[pos] != ']') {
                path_expr_free(expr);
                return nullptr; // Invalid: expected ']'
            }
            pos++; // Skip ']'

            if (negative) index = -index;
            path_expr_add(expr, path_component_index(index));
            continue;
        }

        // Key access: identifier
        size_t key_start = pos;
        while (pos < path_len && path[pos] != '.' && path[pos] != '[') {
            pos++;
        }
        size_t key_len = pos - key_start;

        if (key_len > 0) {
            path_expr_add(expr, path_component_key(path + key_start, key_len));
        }
    }

    return expr;
}

/**
 * Convert a path expression back to a string
 */
EMSCRIPTEN_KEEPALIVE
char* path_expr_to_string(const PathExpression* expr) {
    if (!expr) return nullptr;

    // Calculate required buffer size
    size_t buf_size = 1; // Null terminator
    for (size_t i = 0; i < expr->count; i++) {
        const PathComponent* c = &expr->components[i];
        switch (c->type) {
            case PATH_KEY:
                if (i > 0) buf_size++; // Dot separator
                buf_size += c->data.key_data.key_len;
                break;
            case PATH_INDEX:
                buf_size += 20; // Max int64 length + brackets
                break;
            case PATH_WILDCARD:
                buf_size += 3; // [*]
                break;
            default:
                break;
        }
    }

    char* result = (char*)malloc(buf_size);
    if (!result) return nullptr;

    size_t pos = 0;
    for (size_t i = 0; i < expr->count; i++) {
        const PathComponent* c = &expr->components[i];
        switch (c->type) {
            case PATH_KEY:
                if (i > 0 && expr->components[i-1].type != PATH_INDEX &&
                    expr->components[i-1].type != PATH_WILDCARD) {
                    result[pos++] = '.';
                }
                memcpy(result + pos, c->data.key_data.key, c->data.key_data.key_len);
                pos += c->data.key_data.key_len;
                break;
            case PATH_INDEX:
                pos += sprintf(result + pos, "[%lld]", (long long)c->data.index_data.index);
                break;
            case PATH_WILDCARD:
                result[pos++] = '[';
                result[pos++] = '*';
                result[pos++] = ']';
                break;
            default:
                break;
        }
    }
    result[pos] = '\0';

    return result;
}

/**
 * Free a string allocated by path functions
 */
EMSCRIPTEN_KEEPALIVE
void path_free_string(char* str) {
    if (str) free(str);
}

// ============================================================================
// Path Navigation
// ============================================================================

/**
 * Navigate a JSONValue using a path expression.
 * Returns a pointer to the value at the path, or nullptr if not found.
 *
 * For wildcards, this returns the first matching element. Use
 * path_navigate_all for collecting all matches.
 */
EMSCRIPTEN_KEEPALIVE
const JSONValue* path_navigate(const JSONValue* root, const PathExpression* path) {
    if (!root || !path) return nullptr;

    const JSONValue* current = root;

    for (size_t i = 0; i < path->count; i++) {
        if (!current) return nullptr;

        const PathComponent* c = &path->components[i];

        switch (c->type) {
            case PATH_KEY:
                if (current->type != JSON_TYPE_OBJECT) return nullptr;
                current = json_value_object_get(current, c->data.key_data.key);
                break;

            case PATH_INDEX: {
                if (current->type != JSON_TYPE_ARRAY) return nullptr;
                int64_t index = c->data.index_data.index;
                size_t array_size = json_value_array_size(current);
                // Handle negative indices
                if (index < 0) {
                    index = (int64_t)array_size + index;
                }
                if (index < 0 || (size_t)index >= array_size) return nullptr;
                current = json_value_array_get(current, (size_t)index);
                break;
            }

            case PATH_WILDCARD:
                // For wildcard, return first element
                if (current->type != JSON_TYPE_ARRAY) return nullptr;
                if (json_value_array_size(current) == 0) return nullptr;
                current = json_value_array_get(current, 0);
                break;

            case PATH_ROOT:
                // Root component, stay at current
                break;

            default:
                return nullptr;
        }
    }

    return current;
}

/**
 * Results container for wildcard navigation
 */
typedef struct {
    JSONValue** values;
    size_t count;
    size_t capacity;
} PathNavigateResults;

EMSCRIPTEN_KEEPALIVE
PathNavigateResults* path_navigate_results_create(void) {
    PathNavigateResults* results = (PathNavigateResults*)malloc(sizeof(PathNavigateResults));
    if (!results) return nullptr;
    results->values = nullptr;
    results->count = 0;
    results->capacity = 0;
    return results;
}

EMSCRIPTEN_KEEPALIVE
void path_navigate_results_free(PathNavigateResults* results) {
    if (!results) return;
    // Note: we don't free the values themselves, just the array
    if (results->values) free(results->values);
    free(results);
}

static int path_navigate_results_add(PathNavigateResults* results, const JSONValue* value) {
    if (results->count >= results->capacity) {
        size_t new_capacity = results->capacity == 0 ? 8 : results->capacity * 2;
        JSONValue** new_values = (JSONValue**)realloc(
            results->values, new_capacity * sizeof(JSONValue*)
        );
        if (!new_values) return -1;
        results->values = new_values;
        results->capacity = new_capacity;
    }
    results->values[results->count++] = (JSONValue*)value;
    return 0;
}

/**
 * Navigate with wildcards, collecting all matching values
 */
static void path_navigate_all_recursive(
    const JSONValue* current,
    const PathExpression* path,
    size_t component_index,
    PathNavigateResults* results
) {
    if (!current || component_index >= path->count) {
        // Reached the end of path, add result
        if (current) {
            path_navigate_results_add(results, current);
        }
        return;
    }

    const PathComponent* c = &path->components[component_index];

    switch (c->type) {
        case PATH_KEY:
            if (current->type == JSON_TYPE_OBJECT) {
                const JSONValue* next = json_value_object_get(current, c->data.key_data.key);
                if (next) {
                    path_navigate_all_recursive(next, path, component_index + 1, results);
                }
            }
            break;

        case PATH_INDEX: {
            if (current->type == JSON_TYPE_ARRAY) {
                int64_t index = c->data.index_data.index;
                size_t array_size = json_value_array_size(current);
                if (index < 0) index = (int64_t)array_size + index;
                if (index >= 0 && (size_t)index < array_size) {
                    const JSONValue* next = json_value_array_get(current, (size_t)index);
                    if (next) {
                        path_navigate_all_recursive(next, path, component_index + 1, results);
                    }
                }
            }
            break;
        }

        case PATH_WILDCARD:
            if (current->type == JSON_TYPE_ARRAY) {
                size_t array_size = json_value_array_size(current);
                for (size_t i = 0; i < array_size; i++) {
                    const JSONValue* elem = json_value_array_get(current, i);
                    if (elem) {
                        path_navigate_all_recursive(elem, path, component_index + 1, results);
                    }
                }
            }
            break;

        case PATH_ROOT:
            path_navigate_all_recursive(current, path, component_index + 1, results);
            break;

        default:
            break;
    }
}

EMSCRIPTEN_KEEPALIVE
PathNavigateResults* path_navigate_all(const JSONValue* root, const PathExpression* path) {
    PathNavigateResults* results = path_navigate_results_create();
    if (!results) return nullptr;

    if (root && path) {
        path_navigate_all_recursive(root, path, 0, results);
    }

    return results;
}

EMSCRIPTEN_KEEPALIVE
size_t path_navigate_results_count(const PathNavigateResults* results) {
    if (!results) return 0;
    return results->count;
}

EMSCRIPTEN_KEEPALIVE
const JSONValue* path_navigate_results_get(const PathNavigateResults* results, size_t index) {
    if (!results || index >= results->count) return nullptr;
    return results->values[index];
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Check if a path contains any wildcards
 */
EMSCRIPTEN_KEEPALIVE
bool path_has_wildcard(const PathExpression* expr) {
    if (!expr) return false;
    for (size_t i = 0; i < expr->count; i++) {
        if (expr->components[i].type == PATH_WILDCARD) {
            return true;
        }
    }
    return false;
}

/**
 * Check if one path is a prefix of another
 */
EMSCRIPTEN_KEEPALIVE
bool path_is_prefix(const PathExpression* prefix, const PathExpression* path) {
    if (!prefix || !path) return false;
    if (prefix->count > path->count) return false;

    for (size_t i = 0; i < prefix->count; i++) {
        const PathComponent* a = &prefix->components[i];
        const PathComponent* b = &path->components[i];

        if (a->type != b->type) return false;

        switch (a->type) {
            case PATH_KEY:
                if (strcmp(a->data.key_data.key, b->data.key_data.key) != 0) {
                    return false;
                }
                break;
            case PATH_INDEX:
                if (a->data.index_data.index != b->data.index_data.index) {
                    return false;
                }
                break;
            default:
                break;
        }
    }

    return true;
}

/**
 * Get the parent path (remove last component)
 */
EMSCRIPTEN_KEEPALIVE
PathExpression* path_parent(const PathExpression* expr) {
    if (!expr || expr->count == 0) return nullptr;

    PathExpression* parent = path_expr_create();
    if (!parent) return nullptr;

    for (size_t i = 0; i < expr->count - 1; i++) {
        const PathComponent* c = &expr->components[i];
        switch (c->type) {
            case PATH_KEY:
                path_expr_add(parent, path_component_key(
                    c->data.key_data.key, c->data.key_data.key_len
                ));
                break;
            case PATH_INDEX:
                path_expr_add(parent, path_component_index(c->data.index_data.index));
                break;
            case PATH_WILDCARD:
                path_expr_add(parent, path_component_wildcard());
                break;
            default:
                break;
        }
    }

    return parent;
}

/**
 * Get the last component (leaf name/index)
 */
EMSCRIPTEN_KEEPALIVE
const PathComponent* path_leaf(const PathExpression* expr) {
    if (!expr || expr->count == 0) return nullptr;
    return &expr->components[expr->count - 1];
}

} // extern "C"
