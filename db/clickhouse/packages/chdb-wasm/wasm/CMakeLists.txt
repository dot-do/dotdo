# CMakeLists.txt - WASM build configuration for chdb-wasm
#
# This builds minimal components from ClickHouse/chdb for WebAssembly.
# Strategy:
#   1. Lexer (standalone, no deps) - Proven to work in ClickHouse
#   2. Parser (depends on Lexer) - Add incrementally
#   3. Minimal executor (future) - Memory engine only
#
# Build with Emscripten:
#   emcmake cmake -B build -S .
#   cmake --build build

cmake_minimum_required(VERSION 3.16)
project(chdb-wasm VERSION 0.1.0 LANGUAGES CXX)

# Emscripten detection
if(EMSCRIPTEN)
    message(STATUS "Building for WebAssembly with Emscripten")
    message(STATUS "Emscripten SDK: ${EMSCRIPTEN_ROOT}")
else()
    message(WARNING "Not building with Emscripten - use 'emcmake cmake' for WASM output")
endif()

# C++ standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)


# =============================================================================
# Optimization Flags (Tree-Shaking)
# =============================================================================
# These flags implement aggressive tree-shaking and dead code elimination
# for 20-45% WASM size reduction. See docs/spikes/spike-4-tree-shaking.md

set(OPT_COMPILE_FLAGS "-Oz -flto -fdata-sections -ffunction-sections")
set(OPT_LINK_FLAGS "-flto -Wl,--gc-sections --closure 1 -sEVAL_CTORS=1")
# Path to ClickHouse/chdb sources (relative to monorepo root)
get_filename_component(REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(CHDB_SOURCE_DIR "${REPO_ROOT}/vendor/chdb")

if(NOT EXISTS "${CHDB_SOURCE_DIR}/src/Parsers/Lexer.cpp")
    message(FATAL_ERROR "chdb source not found at ${CHDB_SOURCE_DIR}")
endif()

message(STATUS "chdb source: ${CHDB_SOURCE_DIR}")

# =============================================================================
# Component 1: Lexer (Standalone WASM)
# =============================================================================
# This compiles without any dependencies using LEXER_STANDALONE_BUILD.
# The Lexer.cpp file includes LexerStandalone.h which provides all needed
# helper functions (find_first_symbols, isNumericASCII, etc.)

set(LEXER_SOURCES
    ${CHDB_SOURCE_DIR}/src/Parsers/Lexer.cpp
)

add_library(lexer-wasm STATIC ${LEXER_SOURCES})

target_include_directories(lexer-wasm PRIVATE
    ${CHDB_SOURCE_DIR}/src
)

# Standalone build flags - no deps, minimal size
target_compile_definitions(lexer-wasm PRIVATE
    LEXER_STANDALONE_BUILD
)

target_compile_options(lexer-wasm PRIVATE
    -Oz                   # Aggressive size optimization
    -fno-exceptions       # No exceptions (saves space)
    -fno-rtti             # No RTTI (saves space)
)

# =============================================================================
# Lexer WASM Module with JavaScript Bindings
# =============================================================================
# Creates lexer.js + lexer.wasm with embind for easy JS usage

if(EMSCRIPTEN)
    # Create wrapper for embind
    add_executable(lexer-module
        ${CMAKE_CURRENT_SOURCE_DIR}/lexer_bindings.cpp
        ${LEXER_SOURCES}
    )

    target_include_directories(lexer-module PRIVATE
        ${CHDB_SOURCE_DIR}/src
    )

    target_compile_definitions(lexer-module PRIVATE
        LEXER_STANDALONE_BUILD
    )

    target_compile_options(lexer-module PRIVATE
        -Oz -flto -fdata-sections -ffunction-sections
        -fno-exceptions
        -fno-rtti
    )

    # Emscripten-specific link flags
    set_target_properties(lexer-module PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "-flto -Wl,--gc-sections --closure 1 -sEVAL_CTORS=1 \
            -Os \
            -s WASM=1 \
            -s MODULARIZE=1 \
            -s EXPORT_NAME='createLexerModule' \
            -s EXPORTED_RUNTIME_METHODS='[\"ccall\",\"cwrap\",\"UTF8ToString\",\"stringToUTF8\",\"getValue\",\"setValue\"]' \
            -s EXPORTED_FUNCTIONS='[\"_malloc\",\"_free\",\"_lexer_create\",\"_lexer_destroy\",\"_lexer_next_token\",\"_token_type_name\"]' \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=1048576 \
            -s ENVIRONMENT='node,web' \
            -s EXPORT_ES6=0 \
            --no-entry \
        "
    )

    # Also build the raw WASM without JS (like ClickHouse's Lexer.wasm)
    add_custom_command(
        OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/Lexer.wasm
        COMMAND ${CMAKE_CXX_COMPILER}
            -Os -fno-exceptions -fno-rtti
            -DLEXER_STANDALONE_BUILD
            --target=wasm32
            -flto
            -nostdlib
            -I${CHDB_SOURCE_DIR}/src
            -Wl,--no-entry -Wl,--export-all
            ${CHDB_SOURCE_DIR}/src/Parsers/Lexer.cpp
            -o ${CMAKE_CURRENT_BINARY_DIR}/Lexer.wasm
        DEPENDS ${CHDB_SOURCE_DIR}/src/Parsers/Lexer.cpp
        COMMENT "Building standalone Lexer.wasm (ClickHouse-style)"
    )

    add_custom_target(lexer-standalone ALL
        DEPENDS ${CMAKE_CURRENT_BINARY_DIR}/Lexer.wasm
    )
endif()

# =============================================================================
# Installation
# =============================================================================

install(TARGETS lexer-wasm
    ARCHIVE DESTINATION lib
)

if(EMSCRIPTEN)
    install(FILES
        ${CMAKE_CURRENT_BINARY_DIR}/lexer-module.js
        ${CMAKE_CURRENT_BINARY_DIR}/lexer-module.wasm
        ${CMAKE_CURRENT_BINARY_DIR}/Lexer.wasm
        DESTINATION dist
        OPTIONAL
    )
endif()

# =============================================================================
# Status Report
# =============================================================================

message(STATUS "")
message(STATUS "=== chdb-wasm Build Configuration ===")
message(STATUS "Components to build:")
message(STATUS "  [x] Lexer (standalone WASM)")
message(STATUS "  [ ] Parser (TODO)")
message(STATUS "  [ ] Minimal executor (TODO)")
message(STATUS "")
