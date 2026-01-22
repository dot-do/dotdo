# CMakeLists.txt - Core MAIN_MODULE Build Configuration
#
# This CMake configuration builds the core MAIN_MODULE for Emscripten's
# dynamic linking feature. The core module provides:
# - System library functions (malloc, free) for side modules
# - VFS (Virtual File System) abstraction
# - Extension registry for dynamic loading
# - Shared memory and function table
#
# Usage:
#   emcmake cmake -B build/core wasm/core
#   emmake make -C build/core
#
# Or for verbose output:
#   emmake make -C build/core VERBOSE=1

cmake_minimum_required(VERSION 3.16)
project(chdb_core_module LANGUAGES CXX)

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

# Core module exports - these are available to side modules and JavaScript
set(CORE_EXPORTED_FUNCTIONS
    # Main function (required for MAIN_MODULE)
    "_main"

    # Core initialization and version
    "_core_init"
    "_core_get_version"

    # Memory management wrappers
    "_core_alloc"
    "_core_free"

    # Logging and error handling
    "_core_log"
    "_core_set_error"
    "_core_get_error"

    # Extension registry
    "_core_register_extension"
    "_core_get_extension_count"
    "_extension_register"
    "_extension_call"

    # Query tracking
    "_core_increment_query_count"
    "_core_get_query_count"

    # Utility functions
    "_core_add"
    "_core_multiply"
    "_core_process_buffer"

    # VFS functions
    "_vfs_open"
    "_vfs_read"
    "_vfs_write"
    "_vfs_close"
    "_vfs_seek"
    "_vfs_size"

    # System functions (required by side modules)
    "_malloc"
    "_free"
)

# Join exported functions into comma-separated string
string(JOIN "," CORE_EXPORTS_STR ${CORE_EXPORTED_FUNCTIONS})

# ============================================================================
# Exported Runtime Methods
# ============================================================================

# JavaScript runtime methods needed for dynamic loading and interop
set(CORE_EXPORTED_RUNTIME_METHODS
    # Function calling utilities
    "ccall"
    "cwrap"

    # Function pointer management (for ALLOW_TABLE_GROWTH)
    "addFunction"
    "removeFunction"

    # String utilities
    "UTF8ToString"
    "stringToUTF8"

    # Memory access
    "getValue"
    "setValue"
    "HEAPU8"
    "HEAP8"
    "HEAP16"
    "HEAP32"
    "HEAPU16"
    "HEAPU32"
    "HEAPF32"
    "HEAPF64"

    # Dynamic library loading
    "loadDynamicLibrary"

    # Table and memory access
    "wasmTable"
    "wasmMemory"
)

string(JOIN "," CORE_RUNTIME_STR ${CORE_EXPORTED_RUNTIME_METHODS})

# ============================================================================
# Source Files
# ============================================================================

set(CORE_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/core.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/vfs_exports.cpp
)

set(CORE_HEADERS
    ${CMAKE_CURRENT_SOURCE_DIR}/exports.h
)

# ============================================================================
# Core Module Target (Emscripten WASM build)
# ============================================================================

if(EMSCRIPTEN)
    add_executable(core ${CORE_SOURCES} ${CORE_HEADERS})

    # MAIN_MODULE=2 enables dynamic linking with dead code elimination
    # ALLOW_TABLE_GROWTH=1 allows side modules to add functions to the table
    # ALLOW_MEMORY_GROWTH=1 allows memory to grow beyond initial size
    set_target_properties(core PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "\
            -sMAIN_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${CORE_EXPORTS_STR}] \
            -sEXPORTED_RUNTIME_METHODS=[${CORE_RUNTIME_STR}] \
            -sALLOW_TABLE_GROWTH=1 \
            -sALLOW_MEMORY_GROWTH=1 \
            -sINITIAL_MEMORY=16777216 \
            -sMAXIMUM_MEMORY=268435456 \
            -sSTACK_SIZE=1048576 \
            -sMODULARIZE=1 \
            -sEXPORT_NAME='createCoreModule' \
            -sENVIRONMENT='web,node' \
            -sNO_EXIT_RUNTIME=1 \
            -sALLOW_TABLE_GROWTH=1 \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(core PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # Generate package.json for CommonJS compatibility
    # This is needed because parent directories may have "type": "module"
    # which causes Node.js to treat .js files as ESM
    add_custom_command(
        TARGET core POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E echo "{ \"type\": \"commonjs\" }" > ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/package.json
        COMMENT "Generating package.json for CommonJS compatibility"
    )

    message(STATUS "")
    message(STATUS "Core MAIN_MODULE Configuration:")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/core.js")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  MAIN_MODULE=2 (dynamic linking with DCE)")
    message(STATUS "  ALLOW_TABLE_GROWTH=1 (for function pointers)")
    message(STATUS "  ALLOW_MEMORY_GROWTH=1 (for large allocations)")
    message(STATUS "  INITIAL_MEMORY=16MB")
    message(STATUS "  MAXIMUM_MEMORY=256MB")
    message(STATUS "")

# ============================================================================
# Native Test Build (for development)
# ============================================================================

else()
    if(BUILD_TESTS)
        # Native test executable
        add_executable(test_core_native
            ${CORE_SOURCES}
            ${CMAKE_CURRENT_SOURCE_DIR}/test_core.cpp
        )

        target_include_directories(test_core_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_core_native PRIVATE
            TEST_BUILD=1
        )

        message(STATUS "")
        message(STATUS "Native Test Build Configuration:")
        message(STATUS "  Executable: test_core_native")
        message(STATUS "")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use: emcmake cmake -B build/core wasm/core")
        message(STATUS "")
    endif()
endif()

# ============================================================================
# Summary
# ============================================================================

message(STATUS "================================================================")
message(STATUS "  Core MAIN_MODULE")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Exported Functions: ${CORE_EXPORTS_STR}")
message(STATUS "")
message(STATUS "Runtime Methods: ${CORE_RUNTIME_STR}")
message(STATUS "")
message(STATUS "================================================================")
