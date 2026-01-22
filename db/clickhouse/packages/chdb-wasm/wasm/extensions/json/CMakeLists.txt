# CMakeLists.txt - ext-json SIDE_MODULE Build Configuration
#
# This CMake configuration builds the ext-json side module (SIDE_MODULE=2)
# for Emscripten's dynamic linking feature. The module provides advanced
# JSON functions that can be loaded at runtime via dlopen().
#
# The side module:
# - Imports system functions (malloc, free) from the MAIN_MODULE
# - Imports core utility functions (core_log, core_set_error, etc.)
# - Exports its own JSON functions
# - Shares memory with the MAIN_MODULE
#
# Usage:
#   emcmake cmake -B build/ext-json wasm/extensions/json
#   emmake make -C build/ext-json
#
# Output: ext-json.wasm

cmake_minimum_required(VERSION 3.16)
project(ext_json LANGUAGES CXX)

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
set(EXT_JSON_EXPORTED_FUNCTIONS
    # Initialization and metadata
    "_ext_json_init"
    "_ext_json_get_name"
    "_ext_json_get_version"
    "_ext_json_is_initialized"
    "_ext_json_get_operation_count"

    # Core JSON extraction functions
    "_ext_json_extract"
    "_ext_json_extract_string"
    "_ext_json_extract_int"
    "_ext_json_extract_float"

    # JSON utilities
    "_ext_json_length"
    "_ext_json_has"
    "_ext_json_keys"
    "_ext_json_values"
    "_ext_json_path"

    # Memory management
    "_ext_json_free"
)

# Join exported functions into comma-separated string
string(JOIN "," EXT_JSON_EXPORTS_STR ${EXT_JSON_EXPORTED_FUNCTIONS})

# ============================================================================
# Source Files
# ============================================================================

set(EXT_JSON_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/json.cpp
)

# ============================================================================
# Emscripten SIDE_MODULE Build
# ============================================================================

if(EMSCRIPTEN)
    # Create the side module as an executable (Emscripten links to WASM)
    add_executable(ext-json ${EXT_JSON_SOURCES})

    # SIDE_MODULE=2 enables dynamic linking with minimal exports
    # The side module imports functions from the MAIN_MODULE
    # Requires -fPIC for position-independent code
    target_compile_options(ext-json PRIVATE -fPIC)

    set_target_properties(ext-json PROPERTIES
        SUFFIX ".wasm"
        LINK_FLAGS "\
            -sSIDE_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${EXT_JSON_EXPORTS_STR}] \
            -sALLOW_MEMORY_GROWTH=0 \
            -sERROR_ON_UNDEFINED_SYMBOLS=0 \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(ext-json PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # ========================================================================
    # Build Information
    # ========================================================================

    message(STATUS "")
    message(STATUS "================================================================")
    message(STATUS "  ext-json SIDE_MODULE Configuration")
    message(STATUS "================================================================")
    message(STATUS "")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/ext-json.wasm")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  SIDE_MODULE=2 (dynamic linking with minimal exports)")
    message(STATUS "")
    message(STATUS "Exported Functions:")

    foreach(FN ${EXT_JSON_EXPORTED_FUNCTIONS})
        message(STATUS "    ${FN}")
    endforeach()

    message(STATUS "")
    message(STATUS "================================================================")

# ============================================================================
# Native Test Build (for development)
# ============================================================================

else()
    if(BUILD_TESTS)
        # For native tests, we need to provide stub implementations of core functions
        add_library(ext-json-testlib STATIC ${EXT_JSON_SOURCES})

        target_include_directories(ext-json-testlib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(ext-json-testlib PRIVATE
            TEST_BUILD=1
        )

        # Native test executable
        add_executable(test_ext_json_native
            ${CMAKE_CURRENT_SOURCE_DIR}/test_json.cpp
        )

        target_link_libraries(test_ext_json_native PRIVATE ext-json-testlib)

        target_include_directories(test_ext_json_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_ext_json_native PRIVATE
            TEST_BUILD=1
        )

        message(STATUS "")
        message(STATUS "================================================================")
        message(STATUS "  Native Test Build Configuration")
        message(STATUS "================================================================")
        message(STATUS "")
        message(STATUS "  Test executable: test_ext_json_native")
        message(STATUS "  Library: ext-json-testlib")
        message(STATUS "")
        message(STATUS "================================================================")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use:")
        message(STATUS "  emcmake cmake -B build/ext-json wasm/extensions/json")
        message(STATUS "  emmake make -C build/ext-json")
        message(STATUS "")
    endif()
endif()
