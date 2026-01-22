# CMakeLists.txt - Emscripten build configuration for chdb-wasm
#
# This CMakeLists.txt compiles vendor/chdb to WebAssembly using Emscripten.
# Configured for Cloudflare Workers constraints (128MB memory, single-threaded, no filesystem).
#
# Usage:
#   mkdir build && cd build
#   emcmake cmake -S .. -B . -DCMAKE_BUILD_TYPE=Release
#   cmake --build . --parallel
#
# Or use the build.sh script:
#   ./build.sh
#
# Target Environment:
#   - Cloudflare Workers (128MB memory limit)
#   - Single-threaded execution
#   - No persistent filesystem (use custom VFS)
#   - WebAssembly output only (not asm.js)

cmake_minimum_required(VERSION 3.20)

# =============================================================================
# Early Emscripten Detection
# =============================================================================

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR
        "This project requires Emscripten. Please use emcmake or specify the toolchain:\n"
        "  emcmake cmake -S . -B build\n"
        "  # or\n"
        "  cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=/path/to/toolchain.cmake"
    )
endif()

# =============================================================================
# Project Declaration
# =============================================================================

project(chdb-wasm-emscripten
    VERSION 0.1.0
    DESCRIPTION "chdb compiled to WebAssembly via Emscripten for Cloudflare Workers"
    LANGUAGES C CXX
)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  chdb-wasm Emscripten Build Configuration")
message(STATUS "================================================================")
message(STATUS "  Emscripten Version: ${EMSCRIPTEN_VERSION}")
message(STATUS "  Target: WebAssembly for Cloudflare Workers")
message(STATUS "  Constraints: 128MB memory, single-threaded, no FS")
message(STATUS "================================================================")
message(STATUS "")

# =============================================================================
# Path Configuration
# =============================================================================

# This file is at packages/chdb-wasm/build/emscripten/CMakeLists.txt
get_filename_component(EMSCRIPTEN_BUILD_DIR "${CMAKE_CURRENT_SOURCE_DIR}" ABSOLUTE)
get_filename_component(BUILD_DIR "${EMSCRIPTEN_BUILD_DIR}/.." ABSOLUTE)
get_filename_component(CHDB_WASM_DIR "${BUILD_DIR}/.." ABSOLUTE)
get_filename_component(PACKAGES_DIR "${CHDB_WASM_DIR}/.." ABSOLUTE)
get_filename_component(PROJECT_ROOT "${PACKAGES_DIR}/.." ABSOLUTE)

# Vendor chdb location
set(CHDB_VENDOR_DIR "${PROJECT_ROOT}/vendor/chdb" CACHE PATH "Path to vendor/chdb")

if(NOT EXISTS "${CHDB_VENDOR_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
        "vendor/chdb not found at ${CHDB_VENDOR_DIR}\n"
        "Please ensure the chdb submodule is initialized:\n"
        "  git submodule update --init --recursive"
    )
endif()

message(STATUS "Paths:")
message(STATUS "  Project Root: ${PROJECT_ROOT}")
message(STATUS "  Vendor chdb: ${CHDB_VENDOR_DIR}")
message(STATUS "  Output: ${CMAKE_BINARY_DIR}/dist")
message(STATUS "")

# =============================================================================
# C++ Configuration
# =============================================================================

# ClickHouse requires C++23
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Default to Release for minimal binary size
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

# =============================================================================
# Build Profile Selection
# =============================================================================
# Profiles control which features are included in the final WASM.
#
#   minimal  - Parser/Lexer + Memory engine only (~5-10MB)
#   standard - + MergeTree + common formats (~15-25MB)
#   full     - All WASM-compatible features (~50MB+)

set(CHDB_PROFILE "minimal" CACHE STRING "Build profile: minimal, standard, full")
set_property(CACHE CHDB_PROFILE PROPERTY STRINGS minimal standard full)

message(STATUS "Build Profile: ${CHDB_PROFILE}")

# =============================================================================
# WASM/Emscripten Compiler Flags
# =============================================================================

# Base optimization flags for size
set(WASM_COMPILE_FLAGS
    -Oz                              # Aggressive size optimization
    -fno-exceptions                  # Disable C++ exceptions (required for smallest size)
    -fno-rtti                        # Disable RTTI
    -fvisibility=hidden              # Hide symbols by default
    -fvisibility-inlines-hidden      # Hide inline functions
    -ffunction-sections              # Enable dead code elimination
    -fdata-sections                  # Enable unused data elimination
    -fmerge-all-constants            # Merge identical constants
    -fno-math-errno                  # Don't set errno for math functions
    -fno-signed-zeros                # Allow optimizations ignoring signed zeros
    -fno-unwind-tables               # Don't generate unwind tables
    -fno-asynchronous-unwind-tables  # Don't generate async unwind tables
)

# WASM feature flags (supported by Workers)
set(WASM_FEATURE_FLAGS
    -msimd128                        # Enable SIMD128 (Workers compatible)
    -mbulk-memory                    # Bulk memory operations
    -mnontrapping-fptoint            # Non-trapping float-to-int
    -msign-ext                       # Sign extension operations
)

# Debug vs Release flags
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(WASM_DEBUG_FLAGS -O0 -g3 -gsource-map)
    list(REMOVE_ITEM WASM_COMPILE_FLAGS -Oz)
else()
    set(WASM_DEBUG_FLAGS -DNDEBUG)
endif()

# Apply compile flags
add_compile_options(${WASM_COMPILE_FLAGS} ${WASM_FEATURE_FLAGS} ${WASM_DEBUG_FLAGS})

# =============================================================================
# WASM/Emscripten Linker Flags
# =============================================================================

# Memory configuration for Cloudflare Workers (128MB limit)
set(WASM_MEMORY_FLAGS
    "-sALLOW_MEMORY_GROWTH=1"        # Required: Workers don't pre-allocate
    "-sINITIAL_MEMORY=16777216"      # 16MB initial (grows as needed)
    "-sMAXIMUM_MEMORY=134217728"     # 128MB maximum (Workers limit)
    "-sSTACK_SIZE=1048576"           # 1MB stack
    "-sABORTING_MALLOC=0"            # Return null on OOM instead of aborting
)

# Output configuration
set(WASM_OUTPUT_FLAGS
    "-sWASM=1"                       # Output WASM (not asm.js)
    "-sWASM_BIGINT=1"                # Use BigInt for i64 (required for modern APIs)
    "-sMODULARIZE=1"                 # Create a module factory function
    "-sEXPORT_ES6=1"                 # ES6 module output
    "-sEXPORT_NAME='createChDBModule'" # Module factory name
    "-sENVIRONMENT='web,worker'"     # Target web and worker environments
    "-sSINGLE_FILE=0"                # Separate .wasm file for caching
)

# Threading: Single-threaded mode for Workers
set(WASM_THREADING_FLAGS
    "-sSUPPORT_LONGJMP=0"            # No setjmp/longjmp support
    "-sPTHREAD_POOL_SIZE=0"          # No thread pool
    # Note: We don't use -sUSE_PTHREADS because Workers are single-threaded
)

# Filesystem: Disabled (use custom VFS instead)
set(WASM_FS_FLAGS
    "-sNO_FILESYSTEM=1"              # No Emscripten filesystem
    "-sFORCE_FILESYSTEM=0"           # Don't force filesystem inclusion
)

# Runtime configuration
set(WASM_RUNTIME_FLAGS
    "-sNO_EXIT_RUNTIME=1"            # Don't exit after main()
    "-sALLOW_TABLE_GROWTH=1"         # Allow indirect function table growth
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching (matches -fno-exceptions)
    "-sASSERTIONS=0"                 # No runtime assertions (release mode)
    "-sMALLOC=emmalloc"              # Use emmalloc (smallest allocator)
)

# Exported functions (query execution entry points)
set(WASM_EXPORTS
    "_malloc"
    "_free"
    "_chdb_wasm_init"
    "_chdb_wasm_shutdown"
    "_chdb_wasm_query"
    "_chdb_wasm_query_with_format"
    "_chdb_wasm_result_free"
    "_chdb_wasm_result_data"
    "_chdb_wasm_result_length"
    "_chdb_wasm_result_error"
    "_chdb_wasm_version"
)
string(REPLACE ";" "','" WASM_EXPORTS_STR "${WASM_EXPORTS}")
set(WASM_EXPORT_FLAGS
    "-sEXPORTED_FUNCTIONS=['${WASM_EXPORTS_STR}']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','getValue','setValue']"
)

# Optimization link flags
set(WASM_LINK_OPTIMIZE_FLAGS
    "-Oz"                            # Size optimization
    "-flto"                          # Link-time optimization
    "--gc-sections"                  # Remove unused sections
)

# Closure compiler (for JS minification) - only in Release
if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND WASM_LINK_OPTIMIZE_FLAGS "--closure=1")
endif()

# Combine all link flags
set(WASM_LINK_FLAGS
    ${WASM_MEMORY_FLAGS}
    ${WASM_OUTPUT_FLAGS}
    ${WASM_THREADING_FLAGS}
    ${WASM_FS_FLAGS}
    ${WASM_RUNTIME_FLAGS}
    ${WASM_EXPORT_FLAGS}
    ${WASM_LINK_OPTIMIZE_FLAGS}
)

# =============================================================================
# Pre-set ClickHouse/chdb Configuration
# =============================================================================
# These variables must be set BEFORE adding vendor/chdb as a subdirectory.
# They disable features incompatible with WASM and reduce binary size.

# Architecture flags for WASM
set(ARCH_WASM 1 CACHE BOOL "" FORCE)
set(ARCH_WASM32 1 CACHE BOOL "" FORCE)
set(OS_EMSCRIPTEN 1 CACHE BOOL "" FORCE)
set(OS_WASM 1 CACHE BOOL "" FORCE)

# Disable other architectures
set(ARCH_AMD64 0 CACHE BOOL "" FORCE)
set(ARCH_AARCH64 0 CACHE BOOL "" FORCE)
set(ARCH_PPC64LE 0 CACHE BOOL "" FORCE)
set(ARCH_S390X 0 CACHE BOOL "" FORCE)
set(ARCH_RISCV64 0 CACHE BOOL "" FORCE)
set(ARCH_LOONGARCH64 0 CACHE BOOL "" FORCE)

# Disable other OSes
set(OS_LINUX 0 CACHE BOOL "" FORCE)
set(OS_DARWIN 0 CACHE BOOL "" FORCE)
set(OS_FREEBSD 0 CACHE BOOL "" FORCE)

# Disable all executables - library only
set(ENABLE_CLICKHOUSE_SERVER OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_CLIENT OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_LOCAL OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_BENCHMARK OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_COPIER OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_EXTRACT_FROM_CONFIG OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_COMPRESSOR OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_FORMAT OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_OBFUSCATOR OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_ODBC_BRIDGE OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_LIBRARY_BRIDGE OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER_CONVERTER OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER_CLIENT OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_SELF_EXTRACTING OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_DISKS OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_GIT_IMPORT OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_STATIC_FILES_DISK_UPLOADER OFF CACHE BOOL "" FORCE)
set(ENABLE_CLICKHOUSE_SU OFF CACHE BOOL "" FORCE)

# Enable library target
set(ENABLE_CLICKHOUSE_LIBRARY ON CACHE BOOL "" FORCE)

# Disable tests/examples
set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(ENABLE_UTILS OFF CACHE BOOL "" FORCE)

# Disable Python bindings
set(ENABLE_PYTHON OFF CACHE BOOL "" FORCE)
set(USE_PYTHON OFF CACHE BOOL "" FORCE)

# Memory allocator: Use Emscripten's emmalloc (smallest)
set(ENABLE_JEMALLOC OFF CACHE BOOL "" FORCE)
set(ENABLE_MIMALLOC OFF CACHE BOOL "" FORCE)

# Disable threading
set(ENABLE_MULTITHREADING OFF CACHE BOOL "" FORCE)

# Disable JIT compiler (not supported in WASM)
set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "" FORCE)

# Disable network-related features (Workers handle networking differently)
set(ENABLE_GRPC OFF CACHE BOOL "" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)
set(ENABLE_HDFS OFF CACHE BOOL "" FORCE)
set(ENABLE_MYSQL OFF CACHE BOOL "" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "" FORCE)
set(ENABLE_ODBC OFF CACHE BOOL "" FORCE)
set(ENABLE_LDAP OFF CACHE BOOL "" FORCE)
set(ENABLE_KAFKA OFF CACHE BOOL "" FORCE)
set(ENABLE_NATS OFF CACHE BOOL "" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "" FORCE)
set(ENABLE_MONGODB OFF CACHE BOOL "" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "" FORCE)

# Disable cloud storage (Workers access via fetch, not native SDKs)
set(ENABLE_S3 OFF CACHE BOOL "" FORCE)
set(ENABLE_AWS_S3 OFF CACHE BOOL "" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "" FORCE)
set(ENABLE_HIVE OFF CACHE BOOL "" FORCE)

# Disable Rust (not supported with Emscripten)
set(ENABLE_RUST OFF CACHE BOOL "" FORCE)

# Disable OpenSSL assembly (use portable C)
set(OPENSSL_NO_ASM ON CACHE BOOL "" FORCE)

# Glibc compatibility not needed
set(GLIBC_COMPATIBILITY OFF CACHE BOOL "" FORCE)

# Disable heavy features based on profile
if(CHDB_PROFILE STREQUAL "minimal")
    # Minimal: Only Memory engine + basic formats
    set(ENABLE_PARQUET OFF CACHE BOOL "" FORCE)
    set(ENABLE_ORC OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW OFF CACHE BOOL "" FORCE)
    set(ENABLE_ICU OFF CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF OFF CACHE BOOL "" FORCE)
    set(ENABLE_BLAKE3 OFF CACHE BOOL "" FORCE)
    set(ENABLE_FASTOPS OFF CACHE BOOL "" FORCE)
    message(STATUS "Minimal profile: Parquet/Arrow/ORC disabled")
elseif(CHDB_PROFILE STREQUAL "standard")
    # Standard: Add MergeTree + Parquet
    set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
    set(ENABLE_ORC OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW ON CACHE BOOL "" FORCE)
    message(STATUS "Standard profile: Parquet/Arrow enabled")
else()
    # Full: All WASM-compatible features
    message(STATUS "Full profile: All compatible features enabled")
endif()

# Disable error on unsupported combinations
set(FAIL_ON_UNSUPPORTED_OPTIONS_COMBINATION OFF CACHE BOOL "" FORCE)

# Disable ccache (Emscripten has its own caching)
set(COMPILER_CACHE "" CACHE STRING "" FORCE)

# Omit heavy debug symbols
set(OMIT_HEAVY_DEBUG_SYMBOLS ON CACHE BOOL "" FORCE)

# Disable Werror for easier development
set(WERROR OFF CACHE BOOL "" FORCE)

# =============================================================================
# Add vendor/chdb
# =============================================================================

message(STATUS "")
message(STATUS "Adding vendor/chdb subdirectory...")
message(STATUS "")

# Set the ClickHouse source directory for includes
set(ClickHouse_SOURCE_DIR "${CHDB_VENDOR_DIR}" CACHE PATH "" FORCE)

# Add vendor/chdb (EXCLUDE_FROM_ALL to only build needed targets)
add_subdirectory("${CHDB_VENDOR_DIR}" "${CMAKE_BINARY_DIR}/vendor/chdb" EXCLUDE_FROM_ALL)

# =============================================================================
# WASM Entry Point
# =============================================================================

# Source file for WASM bindings
set(WASM_ENTRY_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/chdb_wasm_entry.cpp")

# Create placeholder if it doesn't exist
if(NOT EXISTS "${WASM_ENTRY_SOURCE}")
    file(WRITE "${WASM_ENTRY_SOURCE}" [[
// chdb_wasm_entry.cpp - WASM entry point for chdb
// This file provides the C API exported to JavaScript.
//
// Generated placeholder - replace with actual implementation.

#include <cstdint>
#include <cstdlib>
#include <cstring>

extern "C" {

// Version information
const char* chdb_wasm_version() {
    return "0.1.0-wasm";
}

// Initialize the WASM module
int chdb_wasm_init() {
    // TODO: Initialize ClickHouse local server
    return 0;
}

// Shutdown the WASM module
void chdb_wasm_shutdown() {
    // TODO: Cleanup
}

// Execute a SQL query
// Returns a handle to the result (0 on error)
void* chdb_wasm_query(const char* sql) {
    // TODO: Execute query using ClickHouse LocalServer
    return nullptr;
}

// Execute a SQL query with specific output format
void* chdb_wasm_query_with_format(const char* sql, const char* format) {
    // TODO: Execute query with format
    return nullptr;
}

// Free query result
void chdb_wasm_result_free(void* result) {
    // TODO: Free result memory
}

// Get result data pointer
const char* chdb_wasm_result_data(void* result) {
    // TODO: Return result data
    return nullptr;
}

// Get result data length
size_t chdb_wasm_result_length(void* result) {
    // TODO: Return result length
    return 0;
}

// Get error message (nullptr if no error)
const char* chdb_wasm_result_error(void* result) {
    // TODO: Return error message
    return nullptr;
}

} // extern "C"
]])
    message(STATUS "Created placeholder WASM entry point: ${WASM_ENTRY_SOURCE}")
endif()

# Find chdb core libraries
set(CHDB_LINK_LIBRARIES "")

if(TARGET dbms)
    list(APPEND CHDB_LINK_LIBRARIES dbms)
elseif(TARGET clickhouse_common_io)
    list(APPEND CHDB_LINK_LIBRARIES clickhouse_common_io)
endif()

foreach(lib IN ITEMS
    clickhouse_parsers
    clickhouse_common_config
    clickhouse_compression
)
    if(TARGET ${lib})
        list(APPEND CHDB_LINK_LIBRARIES ${lib})
    endif()
endforeach()

message(STATUS "Found chdb libraries: ${CHDB_LINK_LIBRARIES}")

# =============================================================================
# Build Target: chdb-wasm
# =============================================================================

add_executable(chdb-wasm ${WASM_ENTRY_SOURCE})

target_include_directories(chdb-wasm PRIVATE
    "${CHDB_VENDOR_DIR}/src"
    "${CHDB_VENDOR_DIR}/base"
    "${CHDB_VENDOR_DIR}/programs"
    "${CMAKE_CURRENT_SOURCE_DIR}"
)

target_compile_definitions(chdb-wasm PRIVATE
    CHDB_WASM=1
    CHDB_VERSION="${PROJECT_VERSION}"
    OS_EMSCRIPTEN=1
    __EMSCRIPTEN__=1
)

if(CHDB_LINK_LIBRARIES)
    target_link_libraries(chdb-wasm PRIVATE ${CHDB_LINK_LIBRARIES})
endif()

# Apply WASM link flags
string(REPLACE ";" " " WASM_LINK_FLAGS_STR "${WASM_LINK_FLAGS}")
set_target_properties(chdb-wasm PROPERTIES
    OUTPUT_NAME "chdb"
    SUFFIX ".js"
    LINK_FLAGS "${WASM_LINK_FLAGS_STR}"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
)

# =============================================================================
# Post-Build: wasm-opt Optimization
# =============================================================================

find_program(WASM_OPT wasm-opt
    PATHS "$ENV{EMSDK}/upstream/bin"
    NO_DEFAULT_PATH
)

if(WASM_OPT AND NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_custom_command(TARGET chdb-wasm POST_BUILD
        COMMAND ${WASM_OPT} -Oz
            --enable-simd
            --enable-bulk-memory
            --enable-sign-ext
            --enable-nontrapping-float-to-int
            --strip-debug
            --strip-dwarf
            --strip-producers
            --vacuum
            --duplicate-function-elimination
            --merge-similar-functions
            "${CMAKE_BINARY_DIR}/dist/chdb.wasm"
            -o "${CMAKE_BINARY_DIR}/dist/chdb.wasm"
        COMMENT "Running wasm-opt for additional size optimization"
    )
endif()

# =============================================================================
# Build Summary
# =============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  Build Configuration Summary")
message(STATUS "================================================================")
message(STATUS "  Profile:         ${CHDB_PROFILE}")
message(STATUS "  Build Type:      ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ Standard:    ${CMAKE_CXX_STANDARD}")
message(STATUS "  Output:          ${CMAKE_BINARY_DIR}/dist/chdb.js")
message(STATUS "                   ${CMAKE_BINARY_DIR}/dist/chdb.wasm")
message(STATUS "")
message(STATUS "  Memory Config:")
message(STATUS "    Initial:       16MB")
message(STATUS "    Maximum:       128MB (Cloudflare Workers limit)")
message(STATUS "    Stack:         1MB")
message(STATUS "")
message(STATUS "  Disabled for WASM:")
message(STATUS "    - Threading (single-threaded)")
message(STATUS "    - Filesystem (use custom VFS)")
message(STATUS "    - JIT compiler")
message(STATUS "    - Cloud storage SDKs")
message(STATUS "    - Database connectors")
message(STATUS "    - jemalloc (using emmalloc)")
message(STATUS "")
message(STATUS "  Build with:")
message(STATUS "    cmake --build . --parallel")
message(STATUS "================================================================")
message(STATUS "")
