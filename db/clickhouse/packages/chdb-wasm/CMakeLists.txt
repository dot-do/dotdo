# CMakeLists.txt - chdb-wasm Wrapper Build Configuration
#
# This wrapper CMakeLists.txt configures all necessary CMAKE variables for building
# chdb as a WebAssembly library using Emscripten. It sets up the WASM environment,
# includes all custom cmake configuration files, overrides platform detection,
# and then includes vendor/chdb as a subdirectory with appropriate options.
#
# Usage:
#   # Standard WASM build:
#   cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
#   cmake --build build
#
#   # Or use the preset:
#   cmake -S . -B build --preset wasm-release
#
# The wrapper performs these steps:
#   1. Sets CMAKE_SYSTEM_NAME and CMAKE_SYSTEM_PROCESSOR for WASM
#   2. Pre-sets ARCH_WASM=1, OS_EMSCRIPTEN=1 to bypass platform checks
#   3. Includes all cmake/*.cmake configuration files
#   4. Adds vendor/chdb subdirectory with chdb library target only
#   5. Configures the final WASM output linking

cmake_minimum_required(VERSION 3.25)

# ============================================================================
# Early WASM Detection and Configuration
# ============================================================================
# These MUST be set before project() to ensure proper toolchain detection

# Detect if we're being configured with Emscripten toolchain
if(DEFINED ENV{EMSDK} OR CMAKE_TOOLCHAIN_FILE MATCHES "Emscripten")
    set(BUILDING_FOR_WASM TRUE)
else()
    set(BUILDING_FOR_WASM FALSE)
    message(WARNING "Emscripten toolchain not detected. Set EMSDK env or use -DCMAKE_TOOLCHAIN_FILE")
endif()

# Force WASM system identification before project() call
# This ensures CMake's platform detection uses the correct values
if(BUILDING_FOR_WASM)
    set(CMAKE_SYSTEM_NAME Emscripten CACHE STRING "Target system" FORCE)
    set(CMAKE_SYSTEM_PROCESSOR wasm32 CACHE STRING "Target processor" FORCE)
    set(CMAKE_CROSSCOMPILING ON CACHE BOOL "Cross-compiling" FORCE)
endif()

# ============================================================================
# Project Declaration
# ============================================================================

project(chdb-wasm
    VERSION 0.1.0
    DESCRIPTION "chdb compiled to WebAssembly for browser/Node.js usage"
    LANGUAGES C CXX
)

message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "  chdb-wasm Build System v${PROJECT_VERSION}")
message(STATUS "===============================================================")
message(STATUS "")

# ============================================================================
# Architecture and Target Pre-Configuration
# ============================================================================
# These variables MUST be set BEFORE vendor/chdb is included so that
# cmake/arch.cmake and cmake/target.cmake in vendor/chdb see them

# Set architecture flags to indicate WASM target
set(ARCH_WASM 1 CACHE BOOL "Building for WebAssembly" FORCE)
set(ARCH_WASM32 1 CACHE BOOL "Building for wasm32" FORCE)

# Set OS flags to indicate Emscripten environment
set(OS_EMSCRIPTEN 1 CACHE BOOL "Building for Emscripten" FORCE)
set(OS_WASM 1 CACHE BOOL "Building for WebAssembly OS layer" FORCE)

# Explicitly NOT other architectures (prevents misdetection)
set(ARCH_AMD64 0 CACHE BOOL "" FORCE)
set(ARCH_AARCH64 0 CACHE BOOL "" FORCE)
set(ARCH_PPC64LE 0 CACHE BOOL "" FORCE)
set(ARCH_S390X 0 CACHE BOOL "" FORCE)
set(ARCH_RISCV64 0 CACHE BOOL "" FORCE)
set(ARCH_LOONGARCH64 0 CACHE BOOL "" FORCE)

# Explicitly NOT other operating systems
set(OS_LINUX 0 CACHE BOOL "" FORCE)
set(OS_DARWIN 0 CACHE BOOL "" FORCE)
set(OS_FREEBSD 0 CACHE BOOL "" FORCE)
set(OS_ANDROID 0 CACHE BOOL "" FORCE)
set(OS_SUNOS 0 CACHE BOOL "" FORCE)

# Add definitions for the preprocessor
add_definitions(-D OS_EMSCRIPTEN=1)
add_definitions(-D OS_WASM=1)
add_definitions(-D ARCH_WASM=1)
add_definitions(-D __EMSCRIPTEN__=1)

message(STATUS "Platform Configuration:")
message(STATUS "  ARCH_WASM: ${ARCH_WASM}")
message(STATUS "  ARCH_WASM32: ${ARCH_WASM32}")
message(STATUS "  OS_EMSCRIPTEN: ${OS_EMSCRIPTEN}")
message(STATUS "  CMAKE_SYSTEM_NAME: ${CMAKE_SYSTEM_NAME}")
message(STATUS "  CMAKE_SYSTEM_PROCESSOR: ${CMAKE_SYSTEM_PROCESSOR}")

# ============================================================================
# WASM-Specific Architecture Settings
# ============================================================================

# WASM is little-endian
set(LITTLE_ENDIAN 1 CACHE BOOL "WASM is little-endian" FORCE)

# Disable native SIMD by default (can be enabled with -msimd128 in compile flags)
set(NO_SIMD 1 CACHE BOOL "Disable SIMD by default for WASM" FORCE)

# WASM uses 32-bit pointers
set(SIZEOF_VOID_P 4 CACHE STRING "WASM uses 32-bit pointers" FORCE)

# ============================================================================
# Build Configuration
# ============================================================================

# Default to Release build for WASM (size matters)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

# Use compile_commands.json for IDE support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# C++ standard (ClickHouse requires C++23)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# C standard
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

# ============================================================================
# Path Configuration
# ============================================================================

# Get the directory containing this CMakeLists.txt
get_filename_component(CHDB_WASM_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}" ABSOLUTE)
set(CHDB_WASM_CMAKE_DIR "${CHDB_WASM_SOURCE_DIR}/cmake")

# Project root (two levels up from packages/chdb-wasm)
get_filename_component(PROJECT_ROOT "${CHDB_WASM_SOURCE_DIR}/../.." ABSOLUTE)

# Vendor chdb location (at project root vendor/chdb)
set(CHDB_VENDOR_DIR "${PROJECT_ROOT}/vendor/chdb" CACHE PATH "chdb vendor directory")

# Verify vendor/chdb exists
if(NOT EXISTS "${CHDB_VENDOR_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "vendor/chdb not found at ${CHDB_VENDOR_DIR}. Please initialize git submodules.")
endif()

message(STATUS "Path Configuration:")
message(STATUS "  Source Dir: ${CHDB_WASM_SOURCE_DIR}")
message(STATUS "  CMake Dir: ${CHDB_WASM_CMAKE_DIR}")
message(STATUS "  Project Root: ${PROJECT_ROOT}")
message(STATUS "  Vendor chdb: ${CHDB_VENDOR_DIR}")

# ============================================================================
# Build Profile Selection
# ============================================================================
# Choose the build profile based on size/feature requirements.
#
# Multi-Profile Build System (pglite-inspired):
#   - core:       Parser/Lexer only (~50KB) - SQL validation, AST generation
#   - minimal:    Memory engine + basics (~5-10MB) - Simple in-memory analytics
#   - standard:   + MergeTree + Parquet (~15-25MB) - Typical OLAP workloads
#   - analytics:  + Window funcs + full aggs (~30-40MB) - Complex analytics
#   - full:       All WASM-compatible features (~50MB+) - Maximum compatibility
#
# Usage:
#   cmake -DCHDB_PROFILE=minimal ..
#   cmake -DCHDB_PROFILE=standard ..
#
# Legacy options (still supported for backwards compatibility):
option(BUILD_ULTRA_MINIMAL "Build ultra-minimal WASM for <15MB target (Cloudflare Workers)" OFF)
option(BUILD_MINIMAL "Build minimal WASM with reduced features" OFF)

# Include the new multi-profile build system
include("${CHDB_WASM_CMAKE_DIR}/build-profiles.cmake")

# Legacy profile mapping (for backwards compatibility)
# If CHDB_PROFILE is not set but legacy options are, map them
if(NOT DEFINED CHDB_PROFILE OR CHDB_PROFILE STREQUAL "")
    if(BUILD_ULTRA_MINIMAL)
        set(CHDB_PROFILE "minimal" CACHE STRING "Build profile" FORCE)
        set(CHDB_WASM_BUILD_PROFILE "ultra-minimal" CACHE STRING "Legacy profile" FORCE)
        message(STATUS "")
        message(STATUS "*** ULTRA-MINIMAL BUILD (Legacy) -> MINIMAL PROFILE ***")
        message(STATUS "Note: Use -DCHDB_PROFILE=minimal for new builds")
        message(STATUS "")
    elseif(BUILD_MINIMAL)
        set(CHDB_PROFILE "minimal" CACHE STRING "Build profile" FORCE)
        set(CHDB_WASM_BUILD_PROFILE "minimal" CACHE STRING "Legacy profile" FORCE)
        message(STATUS "")
        message(STATUS "*** MINIMAL BUILD (Legacy) -> MINIMAL PROFILE ***")
        message(STATUS "Note: Use -DCHDB_PROFILE=minimal for new builds")
        message(STATUS "")
    else()
        # Default to minimal for WASM builds if no profile specified
        set(CHDB_PROFILE "minimal" CACHE STRING "Build profile" FORCE)
        set(CHDB_WASM_BUILD_PROFILE "minimal" CACHE STRING "Default profile" FORCE)
    endif()
else()
    # Map new CHDB_PROFILE to legacy CHDB_WASM_BUILD_PROFILE for compatibility
    set(CHDB_WASM_BUILD_PROFILE "${CHDB_PROFILE}" CACHE STRING "Build profile" FORCE)
endif()

# Display profile summary
message(STATUS "")
message(STATUS "*** BUILD PROFILE: ${CHDB_PROFILE} ***")
if(CHDB_PROFILE STREQUAL "core")
    message(STATUS "Target: ~50KB uncompressed, ~15KB gzipped")
    message(STATUS "Use case: SQL validation, AST generation")
elseif(CHDB_PROFILE STREQUAL "minimal")
    message(STATUS "Target: ~5-10MB uncompressed, ~2-3MB gzipped")
    message(STATUS "Use case: Simple in-memory analytics")
elseif(CHDB_PROFILE STREQUAL "standard")
    message(STATUS "Target: ~15-25MB uncompressed, ~5-8MB gzipped")
    message(STATUS "Use case: Typical OLAP workloads")
elseif(CHDB_PROFILE STREQUAL "analytics")
    message(STATUS "Target: ~30-40MB uncompressed, ~10-15MB gzipped")
    message(STATUS "Use case: Complex analytics, BI tools")
elseif(CHDB_PROFILE STREQUAL "full")
    message(STATUS "Target: ~50MB+ uncompressed, ~15-20MB gzipped")
    message(STATUS "Use case: Maximum ClickHouse compatibility")
endif()
message(STATUS "")

# ============================================================================
# Include WASM Configuration Files
# ============================================================================
# These files configure all the WASM-specific settings. They are included
# BEFORE vendor/chdb so that all cache variables are pre-set.

message(STATUS "")
message(STATUS "Including WASM configuration modules...")
message(STATUS "")

# For core/minimal profiles or legacy ultra-minimal builds, load size optimizations FIRST
# This sets the most aggressive restrictions before other configs run
if(CHDB_PROFILE STREQUAL "core" OR CHDB_PROFILE STREQUAL "minimal" OR BUILD_ULTRA_MINIMAL)
    if(CHDB_PROFILE STREQUAL "core")
        message(STATUS "Loading core profile optimizations (parser-only)...")
    else()
        message(STATUS "Loading minimal profile optimizations...")
    endif()
    if(EXISTS "${CHDB_WASM_CMAKE_DIR}/wasm-ultra-minimal.cmake")
        include("${CHDB_WASM_CMAKE_DIR}/wasm-ultra-minimal.cmake")
    endif()
endif()

# Core WASM build configuration (compiler/linker flags, memory settings)
include("${CHDB_WASM_CMAKE_DIR}/wasm-build.cmake")

# Memory allocator configuration (disable jemalloc, use emmalloc)
include("${CHDB_WASM_CMAKE_DIR}/wasm-malloc.cmake")

# Threading configuration (single-threaded stubs)
include("${CHDB_WASM_CMAKE_DIR}/wasm-threading.cmake")

# JIT compilation disabled
include("${CHDB_WASM_CMAKE_DIR}/wasm-no-jit.cmake")

# External integrations disabled (S3, Kafka, databases, etc.)
include("${CHDB_WASM_CMAKE_DIR}/wasm-integrations.cmake")

# Storage engines configuration
include("${CHDB_WASM_CMAKE_DIR}/wasm-engines.cmake")

# Heavy formats disabled (Parquet, Arrow, ORC, etc.)
include("${CHDB_WASM_CMAKE_DIR}/wasm-formats.cmake")

# Minimal feature flags
include("${CHDB_WASM_CMAKE_DIR}/wasm-minimal.cmake")

# Aggressive size optimizations (DuckDB-inspired)
# This provides functions for applying the most aggressive size optimizations
include("${CHDB_WASM_CMAKE_DIR}/wasm-aggressive-optimizations.cmake")

# ============================================================================
# ClickHouse/chdb Build Options
# ============================================================================
# These options control what gets built. We want ONLY the chdb library,
# not clickhouse-server, clickhouse-client, or other executables.

# Disable all server/client components - we only want the library
set(ENABLE_CLICKHOUSE_SERVER OFF CACHE BOOL "Disable server" FORCE)
set(ENABLE_CLICKHOUSE_CLIENT OFF CACHE BOOL "Disable client" FORCE)
set(ENABLE_CLICKHOUSE_LOCAL OFF CACHE BOOL "Disable local" FORCE)
set(ENABLE_CLICKHOUSE_BENCHMARK OFF CACHE BOOL "Disable benchmark" FORCE)
set(ENABLE_CLICKHOUSE_COPIER OFF CACHE BOOL "Disable copier" FORCE)
set(ENABLE_CLICKHOUSE_EXTRACT_FROM_CONFIG OFF CACHE BOOL "Disable config extractor" FORCE)
set(ENABLE_CLICKHOUSE_COMPRESSOR OFF CACHE BOOL "Disable compressor" FORCE)
set(ENABLE_CLICKHOUSE_FORMAT OFF CACHE BOOL "Disable format tool" FORCE)
set(ENABLE_CLICKHOUSE_OBFUSCATOR OFF CACHE BOOL "Disable obfuscator" FORCE)
set(ENABLE_CLICKHOUSE_ODBC_BRIDGE OFF CACHE BOOL "Disable ODBC bridge" FORCE)
set(ENABLE_CLICKHOUSE_LIBRARY_BRIDGE OFF CACHE BOOL "Disable library bridge" FORCE)
set(ENABLE_CLICKHOUSE_INSTALL OFF CACHE BOOL "Disable install target" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER OFF CACHE BOOL "Disable keeper" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER_CONVERTER OFF CACHE BOOL "Disable keeper converter" FORCE)
set(ENABLE_CLICKHOUSE_KEEPER_CLIENT OFF CACHE BOOL "Disable keeper client" FORCE)
set(ENABLE_CLICKHOUSE_SELF_EXTRACTING OFF CACHE BOOL "Disable self-extracting" FORCE)
set(ENABLE_CLICKHOUSE_GIT_IMPORT OFF CACHE BOOL "Disable git import" FORCE)
set(ENABLE_CLICKHOUSE_STATIC_FILES_DISK_UPLOADER OFF CACHE BOOL "Disable disk uploader" FORCE)
set(ENABLE_CLICKHOUSE_SU OFF CACHE BOOL "Disable su" FORCE)
set(ENABLE_CLICKHOUSE_DISKS OFF CACHE BOOL "Disable disks tool" FORCE)

# Disable tests, examples, benchmarks, and utilities
set(ENABLE_TESTS OFF CACHE BOOL "Disable tests" FORCE)
set(ENABLE_EXAMPLES OFF CACHE BOOL "Disable examples" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "Disable benchmarks" FORCE)
set(ENABLE_UTILS OFF CACHE BOOL "Disable utilities" FORCE)

# Enable the library target
set(ENABLE_CLICKHOUSE_LIBRARY ON CACHE BOOL "Build as library" FORCE)

# Chdb/Python bindings options
set(ENABLE_PYTHON OFF CACHE BOOL "Disable Python bindings (we use WASM)" FORCE)
set(USE_PYTHON OFF CACHE BOOL "Disable Python" FORCE)

message(STATUS "")
message(STATUS "Build Target Configuration:")
message(STATUS "  ENABLE_CLICKHOUSE_LIBRARY: ON")
message(STATUS "  ENABLE_CLICKHOUSE_SERVER: OFF")
message(STATUS "  ENABLE_CLICKHOUSE_CLIENT: OFF")
message(STATUS "  ENABLE_TESTS: OFF")
message(STATUS "")

# ============================================================================
# Compiler and Linker Configuration Overrides
# ============================================================================
# Additional configuration that needs to happen before including vendor/chdb

# Don't use ccache in WASM builds (Emscripten has its own caching)
set(COMPILER_CACHE "" CACHE STRING "Disable ccache" FORCE)

# Disable heavy debug symbols for smaller WASM output
set(OMIT_HEAVY_DEBUG_SYMBOLS ON CACHE BOOL "Omit heavy debug symbols" FORCE)

# No glibc compatibility needed in WASM
set(GLIBC_COMPATIBILITY OFF CACHE BOOL "Disable glibc compatibility" FORCE)

# Position independent code (not needed for WASM, but set for consistency)
set(CMAKE_POSITION_INDEPENDENT_CODE OFF CACHE BOOL "" FORCE)

# Disable LTO during development (enable for production)
option(CHDB_WASM_ENABLE_LTO "Enable LTO for WASM build" OFF)
if(NOT CHDB_WASM_ENABLE_LTO)
    set(ENABLE_THINLTO OFF CACHE BOOL "Disable ThinLTO" FORCE)
endif()

# Disable error on unsupported option combinations (some options don't apply to WASM)
set(FAIL_ON_UNSUPPORTED_OPTIONS_COMBINATION OFF CACHE BOOL "Allow unsupported combinations" FORCE)

# Disable binary hash (not applicable for WASM)
set(USE_BINARY_HASH 0 CACHE STRING "Disable binary hash" FORCE)

# Colored build output
set(ENABLE_COLORED_BUILD ON CACHE BOOL "Enable colored output" FORCE)

# Disable Werror for easier development
option(CHDB_WASM_WERROR "Treat warnings as errors" OFF)
set(WERROR ${CHDB_WASM_WERROR} CACHE BOOL "Werror setting" FORCE)

# ============================================================================
# Override chdb CMake Modules
# ============================================================================
# We provide our own arch.cmake and target.cmake that already have WASM support.
# However, vendor/chdb might have been patched too. To ensure our settings take
# precedence, we override the CMAKE_MODULE_PATH.

# Prepend our cmake directory to module path so our overrides are found first
set(CMAKE_MODULE_PATH "${CHDB_WASM_CMAKE_DIR}" ${CMAKE_MODULE_PATH})

# Also set the ClickHouse source dir for includes
set(ClickHouse_SOURCE_DIR "${CHDB_VENDOR_DIR}" CACHE PATH "" FORCE)

# ============================================================================
# Stub Targets for WASM
# ============================================================================
# WASM doesn't have native threads or certain libraries. Create stub IMPORTED
# targets so that CMake doesn't fail when libraries try to link against them.

# Create Threads::Threads stub (WASM doesn't have pthreads by default)
if(NOT TARGET Threads::Threads)
    add_library(Threads::Threads INTERFACE IMPORTED GLOBAL)
    # No-op for WASM - threading is either disabled or handled by Emscripten
    message(STATUS "Created Threads::Threads stub for WASM")
endif()

# Create ch_contrib::parquet stub since we disabled Parquet
if(NOT TARGET ch_contrib::parquet)
    add_library(ch_contrib::parquet INTERFACE IMPORTED GLOBAL)
    message(STATUS "Created ch_contrib::parquet stub for WASM")
endif()

# Create ch_contrib::arrow stub since we disabled Arrow
if(NOT TARGET ch_contrib::arrow)
    add_library(ch_contrib::arrow INTERFACE IMPORTED GLOBAL)
    message(STATUS "Created ch_contrib::arrow stub for WASM")
endif()

# ============================================================================
# WASM Stubs Include Path
# ============================================================================
# Add stubs directory FIRST in include path to override system headers
# that are unavailable in WASM (e.g., ares.h for c-ares DNS library)

include_directories(BEFORE SYSTEM "${CHDB_WASM_SOURCE_DIR}/wasm/stubs")
message(STATUS "Added WASM stubs include path: ${CHDB_WASM_SOURCE_DIR}/wasm/stubs")

# ============================================================================
# Add vendor/chdb Subdirectory
# ============================================================================
# Now that all configuration is in place, add vendor/chdb as a subdirectory.
# The EXCLUDE_FROM_ALL option means only targets we explicitly depend on will build.

message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "  Adding vendor/chdb subdirectory")
message(STATUS "===============================================================")
message(STATUS "")

# Add vendor/chdb with EXCLUDE_FROM_ALL to only build what we need
add_subdirectory("${CHDB_VENDOR_DIR}" "${CMAKE_BINARY_DIR}/vendor/chdb" EXCLUDE_FROM_ALL)

# ============================================================================
# chdb WASM Library Target
# ============================================================================
# Create our own library target that links against the chdb components we need.

# First, check if the expected targets exist
# (They may have different names depending on chdb version)
set(CHDB_CORE_LIBRARIES "")

# Try to find the main dbms target
if(TARGET dbms)
    list(APPEND CHDB_CORE_LIBRARIES dbms)
elseif(TARGET clickhouse-lib)
    list(APPEND CHDB_CORE_LIBRARIES clickhouse-lib)
elseif(TARGET clickhouse_common_io)
    # Fallback to individual components
    list(APPEND CHDB_CORE_LIBRARIES clickhouse_common_io)
endif()

# Add other components if they exist
# Note: We DON'T add clickhouse_functions_obj here - it's an OBJECT library
# and will be linked via $<TARGET_OBJECTS:> to avoid duplicate symbols
foreach(component IN ITEMS
    clickhouse_common_config
    clickhouse_compression
    clickhouse_parsers
    clickhouse_interpreter
    clickhouse_processors
    clickhouse_storages
    clickhouse_functions
    clickhouse_aggregate_functions
    clickhouse_table_functions
)
    if(TARGET ${component})
        list(APPEND CHDB_CORE_LIBRARIES ${component})
    endif()
endforeach()

message(STATUS "Found chdb core libraries: ${CHDB_CORE_LIBRARIES}")

# ============================================================================
# Build Mode Selection
# ============================================================================
# We support two build modes:
#   1. FULL: Complete chdb with vendor/chdb (when available and working)
#   2. MINIMAL: Lexer/Parser only using wasm/ subdirectory (for incremental development)

option(CHDB_WASM_BUILD_FULL "Build full chdb WASM (requires working vendor/chdb build)" OFF)
option(CHDB_WASM_BUILD_LEXER "Build standalone lexer WASM module" ON)
option(CHDB_WASM_BUILD_PARSER "Build parser WASM module" ON)

# ============================================================================
# Minimal Build Mode: Lexer/Parser Only
# ============================================================================
# This builds the standalone lexer and parser without requiring the full
# vendor/chdb compilation. Useful for incremental development.

if(CHDB_WASM_BUILD_LEXER OR CHDB_WASM_BUILD_PARSER)
    # Lexer sources
    set(LEXER_SOURCES
        "${CHDB_VENDOR_DIR}/src/Parsers/Lexer.cpp"
    )

    # Parser bindings source (if it exists)
    set(PARSER_BINDINGS_SOURCE "${CHDB_WASM_SOURCE_DIR}/wasm/parser_bindings.cpp")
    set(LEXER_BINDINGS_SOURCE "${CHDB_WASM_SOURCE_DIR}/wasm/lexer_bindings.cpp")

    # Build lexer module
    if(CHDB_WASM_BUILD_LEXER AND EXISTS "${LEXER_BINDINGS_SOURCE}")
        add_executable(lexer-module
            ${LEXER_BINDINGS_SOURCE}
            ${LEXER_SOURCES}
        )

        target_include_directories(lexer-module PRIVATE
            "${CHDB_VENDOR_DIR}/src"
            "${CHDB_WASM_SOURCE_DIR}/wasm/include"
        )

        target_compile_definitions(lexer-module PRIVATE
            LEXER_STANDALONE_BUILD
        )

        target_compile_options(lexer-module PRIVATE
            -Os
            -fno-exceptions
            -fno-rtti
        )

        if(EMSCRIPTEN)
            set_target_properties(lexer-module PROPERTIES
                SUFFIX ".js"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
            )

            target_link_options(lexer-module PRIVATE
                -Os
                -sWASM=1
                -sMODULARIZE=1
                "-sEXPORT_NAME='createLexerModule'"
                "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','getValue','setValue']"
                "-sEXPORTED_FUNCTIONS=['_malloc','_free','_lexer_create','_lexer_destroy','_lexer_next_token','_token_type_name']"
                -sALLOW_MEMORY_GROWTH=1
                -sINITIAL_MEMORY=1048576
                "-sENVIRONMENT='node,web'"
                -sEXPORT_ES6=0
                --no-entry
            )
        endif()

        message(STATUS "Created lexer-module target")
    endif()

    # Build parser module
    if(CHDB_WASM_BUILD_PARSER AND EXISTS "${PARSER_BINDINGS_SOURCE}")
        # Parser requires more ClickHouse sources
        set(PARSER_SOURCES
            ${LEXER_SOURCES}
            "${CHDB_VENDOR_DIR}/src/Parsers/TokenIterator.cpp"
        )

        add_executable(parser-module
            ${PARSER_BINDINGS_SOURCE}
            ${PARSER_SOURCES}
        )

        target_include_directories(parser-module PRIVATE
            "${CHDB_VENDOR_DIR}/src"
            "${CHDB_WASM_SOURCE_DIR}/wasm/include"
            "${CHDB_WASM_SOURCE_DIR}/wasm"
        )

        target_compile_definitions(parser-module PRIVATE
            LEXER_STANDALONE_BUILD
            PARSER_STANDALONE_BUILD
        )

        target_compile_options(parser-module PRIVATE
            -Os
            -fno-exceptions
            -fno-rtti
        )

        if(EMSCRIPTEN)
            set_target_properties(parser-module PROPERTIES
                SUFFIX ".js"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
            )

            target_link_options(parser-module PRIVATE
                -Os
                -sWASM=1
                -sMODULARIZE=1
                "-sEXPORT_NAME='createParserModule'"
                "-sEXPORTED_FUNCTIONS=['_malloc','_free','_parser_create','_parser_destroy','_parser_get_token_count','_parser_check_balanced','_parser_get_unmatched_paren_pos','_parser_validate_tokens','_parser_get_error_pos','_parser_get_token','_parser_test']"
                "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','getValue','setValue']"
                -sALLOW_MEMORY_GROWTH=1
                -sINITIAL_MEMORY=2097152
                "-sENVIRONMENT='node,web'"
                -sEXPORT_ES6=0
                --no-entry
            )
        endif()

        message(STATUS "Created parser-module target")
    endif()
endif()

# ============================================================================
# Full Build Mode: Complete chdb WASM
# ============================================================================
# This builds the complete chdb library as WASM. Requires vendor/chdb to
# compile successfully with Emscripten.

if(CHDB_WASM_BUILD_FULL)
    # WASM API Source Files
    set(CHDB_WASM_SOURCES
        "${CHDB_WASM_SOURCE_DIR}/wasm/chdb_wasm.cpp"
    )

    # Check if the source file exists
    if(EXISTS "${CHDB_WASM_SOURCE_DIR}/wasm/chdb_wasm.cpp")
        add_executable(chdb-wasm-full ${CHDB_WASM_SOURCES})

        # Link against chdb core libraries
        if(CHDB_CORE_LIBRARIES)
            target_link_libraries(chdb-wasm-full PRIVATE ${CHDB_CORE_LIBRARIES})
        endif()

        # Include directories
        # Note: stubs directory comes FIRST to override system headers for WASM
        target_include_directories(chdb-wasm-full PRIVATE
            "${CHDB_WASM_SOURCE_DIR}/wasm/stubs"
            "${CHDB_WASM_SOURCE_DIR}/src"
            "${CHDB_WASM_SOURCE_DIR}/include"
            "${CHDB_WASM_SOURCE_DIR}/wasm/include"
            "${CHDB_VENDOR_DIR}/src"
            "${CHDB_VENDOR_DIR}/base"
            "${CHDB_VENDOR_DIR}/programs"
        )

        # Apply WASM-specific settings
        target_compile_definitions(chdb-wasm-full PRIVATE
            CHDB_WASM=1
            CHDB_VERSION="${PROJECT_VERSION}"
        )

        # Set output properties for WASM
        set_target_properties(chdb-wasm-full PROPERTIES
            OUTPUT_NAME "chdb"
            SUFFIX ".js"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
        )

        # Apply Emscripten linking flags
        if(EMSCRIPTEN)
            target_link_options(chdb-wasm-full PRIVATE
                ${CHDB_WASM_LINK_FLAGS}
            )
        endif()

        message(STATUS "Created chdb-wasm-full target")
    else()
        message(STATUS "")
        message(STATUS "Note: Full WASM API source not found. To enable full build:")
        message(STATUS "  1. Create wasm/chdb_wasm.cpp with WASM API implementation")
        message(STATUS "  2. Re-run cmake configuration with -DCHDB_WASM_BUILD_FULL=ON")
        message(STATUS "")
    endif()
endif()

# ============================================================================
# Ultra-Minimal Build Mode
# ============================================================================
# This builds the absolute smallest chdb WASM binary targeting <15MB.
# Suitable for Cloudflare Workers and other edge environments.

if(BUILD_ULTRA_MINIMAL AND CHDB_WASM_BUILD_FULL)
    # Ultra-minimal uses the same source but different compile/link settings
    if(EXISTS "${CHDB_WASM_SOURCE_DIR}/wasm/chdb_wasm.cpp")
        add_executable(chdb-wasm-ultra-minimal ${CHDB_WASM_SOURCES})

        # Link against chdb core libraries
        if(CHDB_CORE_LIBRARIES)
            target_link_libraries(chdb-wasm-ultra-minimal PRIVATE ${CHDB_CORE_LIBRARIES})
        endif()

        # Include directories
        target_include_directories(chdb-wasm-ultra-minimal PRIVATE
            "${CHDB_WASM_SOURCE_DIR}/wasm/stubs"
            "${CHDB_WASM_SOURCE_DIR}/src"
            "${CHDB_WASM_SOURCE_DIR}/include"
            "${CHDB_WASM_SOURCE_DIR}/wasm/include"
            "${CHDB_VENDOR_DIR}/src"
            "${CHDB_VENDOR_DIR}/base"
            "${CHDB_VENDOR_DIR}/programs"
        )

        # Apply ultra-minimal settings from wasm-ultra-minimal.cmake
        if(COMMAND chdb_apply_ultra_minimal_settings)
            chdb_apply_ultra_minimal_settings(chdb-wasm-ultra-minimal)
        else()
            # Fallback: Apply basic ultra-minimal settings manually
            target_compile_definitions(chdb-wasm-ultra-minimal PRIVATE
                CHDB_WASM=1
                CHDB_ULTRA_MINIMAL=1
                CHDB_SINGLE_THREADED=1
                CHDB_VERSION="${PROJECT_VERSION}"
                NDEBUG=1
            )

            target_compile_options(chdb-wasm-ultra-minimal PRIVATE
                -Oz
                -fno-exceptions
                -fno-rtti
                -ffunction-sections
                -fdata-sections
                -fvisibility=hidden
            )

            set_target_properties(chdb-wasm-ultra-minimal PROPERTIES
                OUTPUT_NAME "chdb-ultra-minimal"
                SUFFIX ".js"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist/ultra-minimal"
            )

            if(EMSCRIPTEN)
                target_link_options(chdb-wasm-ultra-minimal PRIVATE
                    -Oz
                    --closure=1
                    -sASSERTIONS=0
                    -sMALLOC=emmalloc
                    -sELIMINATE_DUPLICATE_FUNCTIONS=1
                    --gc-sections
                    -sSUPPORT_LONGJMP=0
                    -sDISABLE_EXCEPTION_CATCHING=1
                    -sNO_FILESYSTEM=1
                    -sINITIAL_MEMORY=16777216
                    -sMAXIMUM_MEMORY=134217728
                    -sSTACK_SIZE=524288
                    -sALLOW_MEMORY_GROWTH=1
                    -sWASM=1
                    -sWASM_BIGINT=1
                    -sMODULARIZE=1
                    -sEXPORT_ES6=1
                    "-sEXPORT_NAME='createChDBUltraMinimal'"
                    "-sENVIRONMENT='web,worker'"
                    -sSINGLE_FILE=0
                    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_chdb_query','_chdb_query_v2','_chdb_create','_chdb_destroy','_chdb_get_version','_chdb_get_memory_stats','_chdb_clear_cache','_chdb_embedded_server_initialized','_chdb_wasm_init','_chdb_wasm_shutdown','_chdb_wasm_query','_chdb_wasm_result_free','_chdb_wasm_result_buffer','_chdb_wasm_result_length','_chdb_wasm_result_error']"
                    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','getValue','setValue']"
                )
            endif()
        endif()

        message(STATUS "Created chdb-wasm-ultra-minimal target (target: <15MB)")
    endif()
endif()

# ============================================================================
# Build Summary
# ============================================================================

message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "  chdb-wasm Configuration Summary")
message(STATUS "===============================================================")
message(STATUS "")
message(STATUS "Target System:       Emscripten/WebAssembly")
message(STATUS "Architecture:        wasm32")
message(STATUS "Build Type:          ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ Standard:        ${CMAKE_CXX_STANDARD}")
message(STATUS "Build Profile:       ${CHDB_WASM_BUILD_PROFILE}")
message(STATUS "")

# Profile-specific summary (using new multi-profile system)
if(CHDB_PROFILE STREQUAL "core")
    message(STATUS "CORE PROFILE:")
    message(STATUS "  Target Size:       ~50KB uncompressed, ~15KB gzipped")
    message(STATUS "  Use Case:          SQL validation, AST generation")
    message(STATUS "")
    message(STATUS "  Features:")
    message(STATUS "    - SQL Parser and Lexer")
    message(STATUS "    - AST generation and serialization")
    message(STATUS "    - SQL formatting/pretty-printing")
    message(STATUS "    - Syntax error reporting")
    message(STATUS "")
    message(STATUS "  NOT Included:")
    message(STATUS "    - No query execution")
    message(STATUS "    - No storage engines")
    message(STATUS "    - No data processing")
    message(STATUS "")
elseif(CHDB_PROFILE STREQUAL "minimal")
    message(STATUS "MINIMAL PROFILE:")
    message(STATUS "  Target Size:       ~5-10MB uncompressed, ~2-3MB gzipped")
    message(STATUS "  Use Case:          Simple in-memory analytics")
    message(STATUS "")
    message(STATUS "  Features:")
    message(STATUS "    - Memory storage engine")
    message(STATUS "    - Basic functions (arithmetic, comparison, string)")
    message(STATUS "    - JSON/CSV formats")
    message(STATUS "    - Core SQL: SELECT, WHERE, GROUP BY, ORDER BY, LIMIT")
    message(STATUS "    - Basic JOINs")
    message(STATUS "")
    message(STATUS "  NOT Included:")
    message(STATUS "    - MergeTree/persistent storage")
    message(STATUS "    - Parquet/Arrow formats")
    message(STATUS "    - Window functions")
    message(STATUS "    - Date/time functions")
    message(STATUS "")
elseif(CHDB_PROFILE STREQUAL "standard")
    message(STATUS "STANDARD PROFILE:")
    message(STATUS "  Target Size:       ~15-25MB uncompressed, ~5-8MB gzipped")
    message(STATUS "  Use Case:          Typical OLAP workloads")
    message(STATUS "")
    message(STATUS "  Features:")
    message(STATUS "    - Everything in Minimal")
    message(STATUS "    - MergeTree storage engine")
    message(STATUS "    - Parquet format support")
    message(STATUS "    - Date/time functions")
    message(STATUS "    - CTEs (WITH clause)")
    message(STATUS "    - UNION operations")
    message(STATUS "")
elseif(CHDB_PROFILE STREQUAL "analytics")
    message(STATUS "ANALYTICS PROFILE:")
    message(STATUS "  Target Size:       ~30-40MB uncompressed, ~10-15MB gzipped")
    message(STATUS "  Use Case:          Complex analytics, BI tools")
    message(STATUS "")
    message(STATUS "  Features:")
    message(STATUS "    - Everything in Standard")
    message(STATUS "    - Window functions (ROW_NUMBER, RANK, LAG, LEAD)")
    message(STATUS "    - Full aggregate functions (quantiles, histograms)")
    message(STATUS "    - Array/Map functions")
    message(STATUS "    - Statistical functions")
    message(STATUS "    - Advanced JOINs")
    message(STATUS "")
elseif(CHDB_PROFILE STREQUAL "full")
    message(STATUS "FULL PROFILE:")
    message(STATUS "  Target Size:       ~50MB+ uncompressed, ~15-20MB gzipped")
    message(STATUS "  Use Case:          Maximum ClickHouse compatibility")
    message(STATUS "")
    message(STATUS "  Features:")
    message(STATUS "    - Everything in Analytics")
    message(STATUS "    - Geo functions (H3, S2)")
    message(STATUS "    - Machine learning functions")
    message(STATUS "    - All WASM-compatible formats")
    message(STATUS "    - All compression codecs")
    message(STATUS "")
else()
    # Legacy fallback
    message(STATUS "PROFILE: ${CHDB_PROFILE}")
    message(STATUS "  (Unknown profile, using default settings)")
    message(STATUS "")
endif()

message(STATUS "Build Targets:")
if(CHDB_WASM_BUILD_LEXER)
    message(STATUS "  [x] Lexer Module         (standalone tokenizer)")
endif()
if(CHDB_WASM_BUILD_PARSER)
    message(STATUS "  [x] Parser Module        (SQL parser)")
endif()
if(CHDB_WASM_BUILD_FULL)
    message(STATUS "  [x] Full chdb            (complete SQL engine)")
else()
    if(CHDB_PROFILE STREQUAL "core")
        message(STATUS "  [ ] Full chdb            (core profile: parser-only)")
    else()
        message(STATUS "  [ ] Full chdb            (use -DCHDB_WASM_BUILD_FULL=ON)")
    endif()
endif()
message(STATUS "")

message(STATUS "Disabled Features (profile: ${CHDB_PROFILE}):")
message(STATUS "  - jemalloc (using emmalloc)")
message(STATUS "  - LLVM JIT compiler")
if(CHDB_PROFILE STREQUAL "core" OR CHDB_PROFILE STREQUAL "minimal")
    message(STATUS "  - Parquet/Arrow/ORC formats")
endif()
message(STATUS "  - S3/Azure/GCS cloud storage")
message(STATUS "  - Kafka/RabbitMQ/NATS messaging")
message(STATUS "  - MySQL/PostgreSQL/MongoDB connectors")
message(STATUS "  - Multithreading (single-threaded mode)")
if(CHDB_PROFILE STREQUAL "core")
    message(STATUS "  - Query execution (parser-only)")
    message(STATUS "  - Storage engines")
    message(STATUS "  - All functions")
elseif(CHDB_PROFILE STREQUAL "minimal")
    message(STATUS "  - MergeTree engine")
    message(STATUS "  - System tables")
    message(STATUS "  - Date/time functions")
    message(STATUS "  - Window functions")
endif()
message(STATUS "")

message(STATUS "Enabled Features (profile: ${CHDB_PROFILE}):")
if(CHDB_PROFILE STREQUAL "core")
    message(STATUS "  - SQL Parser and Lexer")
    message(STATUS "  - AST generation")
else()
    message(STATUS "  - Memory storage engine")
    message(STATUS "  - JSON/CSV/TSV formats")
    message(STATUS "  - Core SQL functionality")
    if(NOT CHDB_PROFILE STREQUAL "minimal")
        message(STATUS "  - System tables")
        message(STATUS "  - MergeTree engine")
        message(STATUS "  - Date/time functions")
    endif()
    if(CHDB_PROFILE STREQUAL "standard" OR CHDB_PROFILE STREQUAL "analytics" OR CHDB_PROFILE STREQUAL "full")
        message(STATUS "  - Parquet format")
        message(STATUS "  - CTEs and UNION")
    endif()
    if(CHDB_PROFILE STREQUAL "analytics" OR CHDB_PROFILE STREQUAL "full")
        message(STATUS "  - Window functions")
        message(STATUS "  - Full aggregates")
        message(STATUS "  - Array/Map functions")
    endif()
    if(CHDB_PROFILE STREQUAL "full")
        message(STATUS "  - Geo functions")
        message(STATUS "  - ML functions")
        message(STATUS "  - All formats")
    endif()
endif()
message(STATUS "")

message(STATUS "Size Optimizations (DuckDB-inspired):")
message(STATUS "  - -Oz:              Aggressive size optimization")
message(STATUS "  - LTO:              Link-time optimization enabled")
message(STATUS "  - Closure:          JS minification (--closure=1)")
message(STATUS "  - wasm-opt:         Post-build optimization")
message(STATUS "  - Exceptions:       Disabled (DISABLE_EXCEPTION_CATCHING=1)")
message(STATUS "  - Allocator:        emmalloc (smallest)")
message(STATUS "  - Symbols:          Stripped (-g0)")
message(STATUS "")

message(STATUS "Output Directory:    ${CMAKE_BINARY_DIR}/dist")
message(STATUS "Profile Directory:   ${CMAKE_BINARY_DIR}/dist/${CHDB_PROFILE}")
message(STATUS "")

message(STATUS "Build Commands:")
message(STATUS "")
message(STATUS "  # Using build-profile.sh (recommended):")
message(STATUS "  ./scripts/build-profile.sh ${CHDB_PROFILE}")
message(STATUS "")
message(STATUS "  # Or with CMake directly:")
message(STATUS "  cmake -S . -B build-${CHDB_PROFILE} -DCHDB_PROFILE=${CHDB_PROFILE} \\")
message(STATUS "        -DCMAKE_TOOLCHAIN_FILE=$EMSDK/.../Emscripten.cmake")
message(STATUS "  cmake --build build-${CHDB_PROFILE}")
message(STATUS "")
message(STATUS "  # Available profiles:")
message(STATUS "    core       (~50KB)    - Parser/Lexer only")
message(STATUS "    minimal    (~5-10MB)  - Memory engine + basic functions")
message(STATUS "    standard   (~15-25MB) - + MergeTree + Parquet")
message(STATUS "    analytics  (~30-40MB) - + Window functions + full aggs")
message(STATUS "    full       (~50MB+)   - All WASM-compatible features")
message(STATUS "")
message(STATUS "  # Build targets:")
if(CHDB_PROFILE STREQUAL "core")
    message(STATUS "  cmake --build build --target lexer-module")
    message(STATUS "  cmake --build build --target parser-module")
else()
    message(STATUS "  cmake --build build --target lexer-module")
    message(STATUS "  cmake --build build --target parser-module")
    if(CHDB_WASM_BUILD_FULL)
        message(STATUS "  cmake --build build --target chdb-wasm-full")
    endif()
endif()
message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "")
