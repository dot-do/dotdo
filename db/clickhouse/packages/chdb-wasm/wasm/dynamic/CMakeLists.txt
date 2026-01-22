# CMakeLists.txt - Emscripten Dynamic Linking POC
#
# This CMake configuration demonstrates building a MAIN_MODULE and SIDE_MODULE
# for Emscripten's dynamic linking feature.
#
# Usage:
#   mkdir build && cd build
#   emcmake cmake ..
#   emmake make
#
# Or use the build.sh script for a simpler approach.

cmake_minimum_required(VERSION 3.16)
project(emscripten_dynamic_linking_poc)

# ============================================================================
# Configuration Options
# ============================================================================

option(BUILD_DEBUG "Build with debug information" OFF)
option(BUILD_OPTIMIZED "Build with optimizations" ON)

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
# Core Module (MAIN_MODULE)
# ============================================================================

# Exported functions from core module that side modules can use
set(CORE_EXPORTED_FUNCTIONS
    "_main"
    "_core_init"
    "_core_get_version"
    "_core_alloc"
    "_core_free"
    "_core_log"
    "_core_set_error"
    "_core_get_error"
    "_core_get_shared_state"
    "_core_register_extension"
    "_core_get_extension_count"
    "_core_increment_query_count"
    "_core_get_query_count"
    "_core_add"
    "_core_multiply"
    "_core_process_buffer"
    # Emscripten runtime functions needed by side modules
    "_malloc"
    "_free"
)

# Join exported functions into a comma-separated string
string(JOIN "," CORE_EXPORTS_STR ${CORE_EXPORTED_FUNCTIONS})

# Runtime methods to export to JavaScript
set(CORE_EXPORTED_RUNTIME_METHODS
    "ccall"
    "cwrap"
    "addFunction"
    "removeFunction"
    "UTF8ToString"
    "stringToUTF8"
    "getValue"
    "setValue"
    "loadDynamicLibrary"
    "wasmTable"
)
string(JOIN "," CORE_RUNTIME_STR ${CORE_EXPORTED_RUNTIME_METHODS})

add_executable(core core.cpp)

set_target_properties(core PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "\
        -sMAIN_MODULE=2 \
        -sEXPORTED_FUNCTIONS=[${CORE_EXPORTS_STR}] \
        -sEXPORTED_RUNTIME_METHODS=[${CORE_RUNTIME_STR}] \
        -sALLOW_TABLE_GROWTH=1 \
        -sALLOW_MEMORY_GROWTH=1 \
        -sINITIAL_MEMORY=16777216 \
        -sSTACK_SIZE=1048576 \
        -sMODULARIZE=1 \
        -sEXPORT_NAME='createCoreModule' \
        -sENVIRONMENT='web,node' \
        -sNO_EXIT_RUNTIME=1 \
        ${COMMON_FLAGS} \
    "
)

# ============================================================================
# Extension Module (SIDE_MODULE)
# ============================================================================

# Exported functions from extension module
set(EXTENSION_EXPORTED_FUNCTIONS
    "_extension_init"
    "_extension_get_name"
    "_extension_get_version"
    "_extension_is_initialized"
    "_extension_factorial"
    "_extension_fibonacci"
    "_extension_power"
    "_extension_sum_array"
    "_extension_create_sequence"
    "_extension_free_buffer"
    "_extension_get_computation_count"
    "_extension_is_prime"
    "_extension_count_primes"
)
string(JOIN "," EXTENSION_EXPORTS_STR ${EXTENSION_EXPORTED_FUNCTIONS})

add_library(extension SHARED extension.cpp)

set_target_properties(extension PROPERTIES
    SUFFIX ".wasm"
    PREFIX ""
    LINK_FLAGS "\
        -sSIDE_MODULE=2 \
        -sEXPORTED_FUNCTIONS=[${EXTENSION_EXPORTS_STR}] \
        ${COMMON_FLAGS} \
    "
)

# ============================================================================
# Build Information
# ============================================================================

message(STATUS "")
message(STATUS "Emscripten Dynamic Linking POC Configuration:")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Debug build: ${BUILD_DEBUG}")
message(STATUS "  Optimized build: ${BUILD_OPTIMIZED}")
message(STATUS "")
message(STATUS "Core module exports: ${CORE_EXPORTS_STR}")
message(STATUS "Extension exports: ${EXTENSION_EXPORTS_STR}")
message(STATUS "")
