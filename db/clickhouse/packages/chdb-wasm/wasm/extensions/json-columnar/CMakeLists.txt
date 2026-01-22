# CMakeLists.txt - ext-json-columnar SIDE_MODULE Build Configuration
#
# This CMake configuration builds the ext-json-columnar side module (SIDE_MODULE=2)
# for Emscripten's dynamic linking feature. The module provides native columnar
# JSON storage for ClickHouse's modern JSON data type.
#
# Key features:
# - Columnar storage for JSON (one column per unique path)
# - Path syntax: data.user.name (NOT JSONExtract!)
# - Automatic type inference from JSON samples
# - Array indexing: data.items[0].price
# - Wildcard support: data.items[*].price
#
# Usage:
#   emcmake cmake -B build/ext-json-columnar wasm/extensions/json-columnar
#   emmake make -C build/ext-json-columnar
#
# Output: ext-json-columnar.wasm
#
# Reference: https://clickhouse.com/docs/en/sql-reference/data-types/newjson

cmake_minimum_required(VERSION 3.16)
project(ext_json_columnar LANGUAGES CXX)

# ============================================================================
# Configuration Options
# ============================================================================

option(BUILD_DEBUG "Build with debug information" OFF)
option(BUILD_OPTIMIZED "Build with optimizations" ON)
option(BUILD_TESTS "Build native tests" OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ============================================================================
# Output Directory
# ============================================================================

set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/dist)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/dist)

# ============================================================================
# Common Compile Flags
# ============================================================================

set(COMMON_FLAGS "")

if(BUILD_DEBUG)
    set(COMMON_FLAGS "${COMMON_FLAGS} -g -gsource-map")
endif()

if(BUILD_OPTIMIZED)
    set(COMMON_FLAGS "${COMMON_FLAGS} -O2")
else()
    set(COMMON_FLAGS "${COMMON_FLAGS} -O0")
endif()

# ============================================================================
# Exported Functions
# ============================================================================

# Functions exported by this side module
set(EXT_JSON_COLUMNAR_EXPORTED_FUNCTIONS
    # Initialization and metadata
    "_ext_json_columnar_init"
    "_ext_json_columnar_get_name"
    "_ext_json_columnar_get_version"
    "_ext_json_columnar_is_initialized"
    "_ext_json_columnar_get_inference_count"

    # JSON parsing
    "_ext_json_columnar_parse"
    "_ext_json_columnar_free_value"

    # Schema inference
    "_ext_json_columnar_infer_schema"
    "_ext_json_columnar_schema_field_count"
    "_ext_json_columnar_schema_get_field_path"
    "_ext_json_columnar_schema_get_field_type"
    "_ext_json_columnar_schema_field_is_nullable"
    "_ext_json_columnar_free_schema"

    # Type information
    "_ext_json_columnar_type_name"
    "_ext_json_columnar_type_to_clickhouse"
    "_json_type_coerce"
    "_json_type_can_coerce"
    "_json_type_name"
    "_json_type_to_clickhouse"

    # Path parsing
    "_path_parse"
    "_path_expr_create"
    "_path_expr_free"
    "_path_expr_count"
    "_path_expr_get"
    "_path_expr_original"
    "_path_expr_to_string"
    "_path_free_string"
    "_path_component_get_type"
    "_path_component_get_key"
    "_path_component_get_index"
    "_path_navigate"
    "_path_navigate_all"
    "_path_navigate_results_create"
    "_path_navigate_results_free"
    "_path_navigate_results_count"
    "_path_navigate_results_get"
    "_path_has_wildcard"
    "_path_is_prefix"
    "_path_parent"
    "_path_leaf"

    # JSONValue operations
    "_json_value_init"
    "_json_value_free"
    "_json_value_null"
    "_json_value_bool"
    "_json_value_int64"
    "_json_value_uint64"
    "_json_value_float64"
    "_json_value_string"
    "_json_value_array"
    "_json_value_object"
    "_json_value_array_push"
    "_json_value_array_size"
    "_json_value_array_get"
    "_json_value_object_set"
    "_json_value_object_get"
    "_json_value_object_size"

    # JSONColumn operations
    "_json_column_create"
    "_json_column_free"
    "_json_column_reserve"
    "_json_column_append_null"
    "_json_column_append_bool"
    "_json_column_append_int64"
    "_json_column_append_uint64"
    "_json_column_append_float64"
    "_json_column_append_string"
    "_json_column_append_value"
    "_json_column_is_null"
    "_json_column_get_bool"
    "_json_column_get_int64"
    "_json_column_get_uint64"
    "_json_column_get_float64"
    "_json_column_get_string"
    "_json_column_size"
    "_json_column_path"
    "_json_column_type"
    "_json_column_recommended_compression"

    # Schema operations
    "_json_schema_create"
    "_json_schema_free"
    "_json_schema_add_field"
    "_json_schema_get_field"
    "_json_schema_merge"

    # Columnar storage operations
    "_json_columnar_create"
    "_json_columnar_free"
    "_json_columnar_insert"
    "_json_columnar_insert_value"
    "_json_columnar_query_path"
    "_json_columnar_get_column"
    "_json_columnar_get_paths"
    "_json_columnar_get_schema"
    "_json_columnar_row_count"

    # Extension API for storage
    "_ext_json_columnar_storage_create"
    "_ext_json_columnar_storage_free"
    "_ext_json_columnar_storage_insert"
    "_ext_json_columnar_storage_row_count"
    "_ext_json_columnar_storage_column_count"
    "_ext_json_columnar_storage_get_column_path"
    "_ext_json_columnar_storage_get_column_type"
    "_ext_json_columnar_query_string"
    "_ext_json_columnar_query_int"
    "_ext_json_columnar_query_float"
    "_ext_json_columnar_query_is_null"
)

# Join exported functions into comma-separated string
string(JOIN "," EXT_JSON_COLUMNAR_EXPORTS_STR ${EXT_JSON_COLUMNAR_EXPORTED_FUNCTIONS})

# ============================================================================
# Source Files
# ============================================================================

set(EXT_JSON_COLUMNAR_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/schema_inference.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/path_parser.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/columnar_storage.cpp
)

# ============================================================================
# Emscripten SIDE_MODULE Build
# ============================================================================

if(EMSCRIPTEN)
    # Create the side module as an executable (Emscripten links to WASM)
    add_executable(ext-json-columnar ${EXT_JSON_COLUMNAR_SOURCES})

    # SIDE_MODULE=2 enables dynamic linking with minimal exports
    # The side module imports functions from the MAIN_MODULE
    # Requires -fPIC for position-independent code
    target_compile_options(ext-json-columnar PRIVATE -fPIC)

    set_target_properties(ext-json-columnar PROPERTIES
        SUFFIX ".wasm"
        LINK_FLAGS "\
            -sSIDE_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${EXT_JSON_COLUMNAR_EXPORTS_STR}] \
            -sALLOW_MEMORY_GROWTH=0 \
            -sERROR_ON_UNDEFINED_SYMBOLS=0 \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(ext-json-columnar PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # ========================================================================
    # Build Information
    # ========================================================================

    message(STATUS "")
    message(STATUS "================================================================")
    message(STATUS "  ext-json-columnar SIDE_MODULE Configuration")
    message(STATUS "================================================================")
    message(STATUS "")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/ext-json-columnar.wasm")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  SIDE_MODULE=2 (dynamic linking with minimal exports)")
    message(STATUS "")
    message(STATUS "Features:")
    message(STATUS "  - Native columnar JSON storage")
    message(STATUS "  - Path syntax: data.user.name")
    message(STATUS "  - Automatic type inference")
    message(STATUS "  - Array indexing and wildcards")
    message(STATUS "")
    message(STATUS "Exported Functions: ${CMAKE_CURRENT_SOURCE_DIR}")
    message(STATUS "  Schema inference, path parsing, columnar storage")
    message(STATUS "  Total exports: " )
    list(LENGTH EXT_JSON_COLUMNAR_EXPORTED_FUNCTIONS NUM_EXPORTS)
    message(STATUS "    ${NUM_EXPORTS} functions")
    message(STATUS "")
    message(STATUS "================================================================")

# ============================================================================
# Native Test Build (for development)
# ============================================================================

else()
    if(BUILD_TESTS)
        # For native tests, we need to provide stub implementations of core functions
        add_library(ext-json-columnar-testlib STATIC ${EXT_JSON_COLUMNAR_SOURCES})

        target_include_directories(ext-json-columnar-testlib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(ext-json-columnar-testlib PRIVATE
            TEST_BUILD=1
        )

        # Provide stub implementations for core functions
        target_sources(ext-json-columnar-testlib PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/test_stubs.cpp
        )

        # Native test executable
        add_executable(test_ext_json_columnar_native
            ${CMAKE_CURRENT_SOURCE_DIR}/test_json_columnar.cpp
        )

        target_link_libraries(test_ext_json_columnar_native PRIVATE ext-json-columnar-testlib)

        target_include_directories(test_ext_json_columnar_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_ext_json_columnar_native PRIVATE
            TEST_BUILD=1
        )

        message(STATUS "")
        message(STATUS "================================================================")
        message(STATUS "  Native Test Build Configuration")
        message(STATUS "================================================================")
        message(STATUS "")
        message(STATUS "  Test executable: test_ext_json_columnar_native")
        message(STATUS "  Library: ext-json-columnar-testlib")
        message(STATUS "")
        message(STATUS "================================================================")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use:")
        message(STATUS "  emcmake cmake -B build/ext-json-columnar wasm/extensions/json-columnar")
        message(STATUS "  emmake make -C build/ext-json-columnar")
        message(STATUS "")
    endif()
endif()
