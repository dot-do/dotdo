# ChdbWasmConfig.cmake
# Find and configure chdb components for WASM compilation
#
# This module provides:
# - chdb component discovery
# - Include path configuration
# - Library linking setup
# - Feature detection

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Package Information
# ============================================================================

set(CHDB_WASM_VERSION_MAJOR 0)
set(CHDB_WASM_VERSION_MINOR 1)
set(CHDB_WASM_VERSION_PATCH 0)
set(CHDB_WASM_VERSION "${CHDB_WASM_VERSION_MAJOR}.${CHDB_WASM_VERSION_MINOR}.${CHDB_WASM_VERSION_PATCH}")

# ============================================================================
# Path Configuration
# ============================================================================

# Project root paths
get_filename_component(CHDB_WASM_CMAKE_DIR "${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
get_filename_component(CHDB_WASM_ROOT_DIR "${CHDB_WASM_CMAKE_DIR}/.." ABSOLUTE)
get_filename_component(PACKAGES_DIR "${CHDB_WASM_ROOT_DIR}/.." ABSOLUTE)
get_filename_component(PROJECT_ROOT "${PACKAGES_DIR}/.." ABSOLUTE)

# ClickHouse source directories
set(CLICKHOUSE_SOURCE_DIR "${PACKAGES_DIR}/clickhouse" CACHE PATH "ClickHouse source directory")
set(CHDB_SOURCE_DIR "${PACKAGES_DIR}/chdb" CACHE PATH "chdb source directory")

# Output directories
set(CHDB_WASM_BUILD_DIR "${CHDB_WASM_ROOT_DIR}/build" CACHE PATH "Build output directory")
set(CHDB_WASM_DIST_DIR "${CHDB_WASM_ROOT_DIR}/dist" CACHE PATH "Distribution output directory")

# ============================================================================
# Component Discovery
# ============================================================================

# Function to find chdb component
function(chdb_find_component component_name)
    set(options REQUIRED)
    set(oneValueArgs HEADER_FILE LIBRARY_NAME)
    set(multiValueArgs PATHS)
    cmake_parse_arguments(ARG "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

    # Search paths for headers
    set(SEARCH_PATHS
        "${CHDB_SOURCE_DIR}"
        "${CHDB_SOURCE_DIR}/include"
        "${CHDB_SOURCE_DIR}/src"
        "${CLICKHOUSE_SOURCE_DIR}"
        "${CLICKHOUSE_SOURCE_DIR}/src"
        ${ARG_PATHS}
    )

    # Find header
    if(ARG_HEADER_FILE)
        find_path(CHDB_${component_name}_INCLUDE_DIR
            NAMES ${ARG_HEADER_FILE}
            PATHS ${SEARCH_PATHS}
            PATH_SUFFIXES include src
            NO_DEFAULT_PATH
        )

        if(CHDB_${component_name}_INCLUDE_DIR)
            set(CHDB_${component_name}_FOUND TRUE PARENT_SCOPE)
            set(CHDB_${component_name}_INCLUDE_DIR ${CHDB_${component_name}_INCLUDE_DIR} PARENT_SCOPE)
            message(STATUS "Found ${component_name} headers: ${CHDB_${component_name}_INCLUDE_DIR}")
        elseif(ARG_REQUIRED)
            message(FATAL_ERROR "Required chdb component ${component_name} not found (looking for ${ARG_HEADER_FILE})")
        else()
            set(CHDB_${component_name}_FOUND FALSE PARENT_SCOPE)
            message(STATUS "chdb component ${component_name} not found")
        endif()
    endif()
endfunction()

# ============================================================================
# Include Path Configuration
# ============================================================================

# Core include directories
set(CHDB_WASM_INCLUDE_DIRS "")

# ClickHouse core includes
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CLICKHOUSE_SOURCE_DIR}")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CLICKHOUSE_SOURCE_DIR}/src")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CLICKHOUSE_SOURCE_DIR}/base")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CLICKHOUSE_SOURCE_DIR}/contrib")

# chdb-specific includes
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_SOURCE_DIR}")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_SOURCE_DIR}/include")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_SOURCE_DIR}/src")

# chdb-wasm includes
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_WASM_ROOT_DIR}/include")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_WASM_ROOT_DIR}/src")

# Build-generated includes
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_WASM_BUILD_DIR}")
list(APPEND CHDB_WASM_INCLUDE_DIRS "${CHDB_WASM_BUILD_DIR}/generated")

# Filter to only existing directories
set(CHDB_WASM_INCLUDE_DIRS_FILTERED "")
foreach(dir ${CHDB_WASM_INCLUDE_DIRS})
    if(EXISTS "${dir}")
        list(APPEND CHDB_WASM_INCLUDE_DIRS_FILTERED "${dir}")
    endif()
endforeach()
set(CHDB_WASM_INCLUDE_DIRS ${CHDB_WASM_INCLUDE_DIRS_FILTERED})

# ============================================================================
# Library Configuration
# ============================================================================

# ClickHouse library components needed for chdb
set(CHDB_CLICKHOUSE_LIBRARIES
    "clickhouse_common_io"
    "clickhouse_common_config"
    "clickhouse_compression"
    "clickhouse_parsers"
    "clickhouse_interpreter"
    "clickhouse_processors"
    "clickhouse_storages"
    "clickhouse_functions"
    "clickhouse_aggregate_functions"
    "clickhouse_table_functions"
    "clickhouse_dictionaries"
    CACHE STRING "ClickHouse library components"
)

# Third-party dependencies
set(CHDB_THIRD_PARTY_LIBRARIES
    "poco"
    "boost"
    "lz4"
    "zstd"
    "xxhash"
    "cityhash"
    "farmhash"
    "roaring"
    "fmt"
    "simdjson"
    "re2"
    CACHE STRING "Third-party library dependencies"
)

# Function to configure library linking
function(chdb_configure_linking target)
    set(options STATIC SHARED)
    set(oneValueArgs "")
    set(multiValueArgs EXTRA_LIBS)
    cmake_parse_arguments(ARG "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

    # For WASM builds, we typically use static linking
    if(ARG_STATIC OR EMSCRIPTEN)
        set(LINK_TYPE STATIC)
    else()
        set(LINK_TYPE SHARED)
    endif()

    # Link ClickHouse libraries
    foreach(lib ${CHDB_CLICKHOUSE_LIBRARIES})
        # Check if library target exists
        if(TARGET ${lib})
            target_link_libraries(${target} PRIVATE ${lib})
        else()
            # Try to find as imported library
            find_library(${lib}_LIBRARY
                NAMES ${lib} lib${lib}
                PATHS
                    "${CLICKHOUSE_SOURCE_DIR}/build/src"
                    "${CHDB_WASM_BUILD_DIR}/lib"
                PATH_SUFFIXES Release Debug
                NO_DEFAULT_PATH
            )
            if(${lib}_LIBRARY)
                target_link_libraries(${target} PRIVATE ${${lib}_LIBRARY})
            endif()
        endif()
    endforeach()

    # Link extra libraries
    if(ARG_EXTRA_LIBS)
        target_link_libraries(${target} PRIVATE ${ARG_EXTRA_LIBS})
    endif()

    message(STATUS "Configured linking for ${target}")
endfunction()

# ============================================================================
# Feature Detection
# ============================================================================

# Detect ClickHouse features
function(chdb_detect_features)
    # Check for essential headers
    include(CheckIncludeFileCXX)

    set(CMAKE_REQUIRED_INCLUDES ${CHDB_WASM_INCLUDE_DIRS})

    # Check Core headers
    check_include_file_cxx("Common/config.h" HAVE_CLICKHOUSE_CONFIG)
    check_include_file_cxx("Core/Types.h" HAVE_CLICKHOUSE_TYPES)
    check_include_file_cxx("Parsers/parseQuery.h" HAVE_CLICKHOUSE_PARSERS)
    check_include_file_cxx("Interpreters/executeQuery.h" HAVE_CLICKHOUSE_INTERPRETER)

    # Set feature flags
    if(HAVE_CLICKHOUSE_CONFIG AND HAVE_CLICKHOUSE_TYPES)
        set(CHDB_HAS_CORE TRUE PARENT_SCOPE)
    else()
        set(CHDB_HAS_CORE FALSE PARENT_SCOPE)
    endif()

    if(HAVE_CLICKHOUSE_PARSERS)
        set(CHDB_HAS_PARSERS TRUE PARENT_SCOPE)
    else()
        set(CHDB_HAS_PARSERS FALSE PARENT_SCOPE)
    endif()

    if(HAVE_CLICKHOUSE_INTERPRETER)
        set(CHDB_HAS_INTERPRETER TRUE PARENT_SCOPE)
    else()
        set(CHDB_HAS_INTERPRETER FALSE PARENT_SCOPE)
    endif()
endfunction()

# ============================================================================
# WASM-Specific Configuration
# ============================================================================

# Compiler definitions for WASM builds
set(CHDB_WASM_DEFINITIONS
    "CHDB_WASM=1"
    "CLICKHOUSE_WASM=1"
    "CHDB_VERSION=\"${CHDB_WASM_VERSION}\""
    "NDEBUG"
    "NO_SSE"
    "NO_AVX"
    "NO_AVX2"
    "NO_AVX512"
    "DISABLE_THREADS"
    CACHE STRING "WASM build definitions"
)

# Additional definitions for size optimization
set(CHDB_WASM_SIZE_DEFINITIONS
    "CHDB_MINIMAL=1"
    "NO_UNDO_REDO"
    "DISABLE_LOGGING"
    CACHE STRING "Size optimization definitions"
)

# Function to apply WASM configuration to target
function(chdb_apply_wasm_config target)
    set(options MINIMAL DEBUG)
    cmake_parse_arguments(ARG "${options}" "" "" ${ARGN})

    # Set include directories
    target_include_directories(${target} PRIVATE ${CHDB_WASM_INCLUDE_DIRS})

    # Set compile definitions
    target_compile_definitions(${target} PRIVATE ${CHDB_WASM_DEFINITIONS})

    if(ARG_MINIMAL)
        target_compile_definitions(${target} PRIVATE ${CHDB_WASM_SIZE_DEFINITIONS})
    endif()

    if(ARG_DEBUG)
        target_compile_definitions(${target} PRIVATE
            "DEBUG"
            "CHDB_DEBUG=1"
        )
        target_compile_definitions(${target} PRIVATE $<$<CONFIG:Debug>:_DEBUG>)
    endif()

    # Set C++ standard
    target_compile_features(${target} PRIVATE cxx_std_20)

    # WASM-specific compile options
    target_compile_options(${target} PRIVATE
        -fno-strict-aliasing
        -fno-omit-frame-pointer
    )

    message(STATUS "Applied WASM configuration to ${target}")
endfunction()

# ============================================================================
# Imported Target Creation
# ============================================================================

# Create imported target for chdb-wasm
if(NOT TARGET chdb::wasm)
    add_library(chdb::wasm INTERFACE IMPORTED)
    set_target_properties(chdb::wasm PROPERTIES
        INTERFACE_INCLUDE_DIRECTORIES "${CHDB_WASM_INCLUDE_DIRS}"
        INTERFACE_COMPILE_DEFINITIONS "${CHDB_WASM_DEFINITIONS}"
    )
endif()

# ============================================================================
# Utility Functions
# ============================================================================

# Function to generate version header
function(chdb_generate_version_header output_file)
    file(WRITE "${output_file}"
"// Auto-generated version header
#pragma once

#define CHDB_WASM_VERSION_MAJOR ${CHDB_WASM_VERSION_MAJOR}
#define CHDB_WASM_VERSION_MINOR ${CHDB_WASM_VERSION_MINOR}
#define CHDB_WASM_VERSION_PATCH ${CHDB_WASM_VERSION_PATCH}
#define CHDB_WASM_VERSION \"${CHDB_WASM_VERSION}\"

namespace chdb {
    constexpr int VERSION_MAJOR = ${CHDB_WASM_VERSION_MAJOR};
    constexpr int VERSION_MINOR = ${CHDB_WASM_VERSION_MINOR};
    constexpr int VERSION_PATCH = ${CHDB_WASM_VERSION_PATCH};
    constexpr const char* VERSION = \"${CHDB_WASM_VERSION}\";
}
"
    )
    message(STATUS "Generated version header: ${output_file}")
endfunction()

# Function to add chdb WASM executable
function(chdb_add_wasm_executable target)
    set(options MINIMAL OPTIMIZED)
    set(oneValueArgs OUTPUT_NAME)
    set(multiValueArgs SOURCES DEPENDS)
    cmake_parse_arguments(ARG "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

    # Create executable
    add_executable(${target} ${ARG_SOURCES})

    # Apply WASM configuration
    if(ARG_MINIMAL)
        chdb_apply_wasm_config(${target} MINIMAL)
    else()
        chdb_apply_wasm_config(${target})
    endif()

    # Configure linking
    if(ARG_DEPENDS)
        chdb_configure_linking(${target} STATIC EXTRA_LIBS ${ARG_DEPENDS})
    else()
        chdb_configure_linking(${target} STATIC)
    endif()

    # Set output name
    if(ARG_OUTPUT_NAME)
        set_target_properties(${target} PROPERTIES OUTPUT_NAME ${ARG_OUTPUT_NAME})
    endif()

    # Set output directory
    set_target_properties(${target} PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CHDB_WASM_DIST_DIR}"
    )

    message(STATUS "Created chdb WASM executable: ${target}")
endfunction()

# ============================================================================
# Configuration Validation
# ============================================================================

function(chdb_validate_config)
    set(CONFIG_VALID TRUE)
    set(MISSING_COMPONENTS "")

    # Check essential directories
    if(NOT EXISTS "${CHDB_WASM_ROOT_DIR}")
        list(APPEND MISSING_COMPONENTS "CHDB_WASM_ROOT_DIR")
        set(CONFIG_VALID FALSE)
    endif()

    # Check for Emscripten in WASM builds
    if(EMSCRIPTEN)
        if(NOT DEFINED ENV{EMSDK})
            message(WARNING "EMSDK environment not set - some features may not work")
        endif()
    endif()

    # Report validation results
    if(CONFIG_VALID)
        message(STATUS "chdb WASM configuration validated successfully")
    else()
        message(WARNING "chdb WASM configuration has issues: ${MISSING_COMPONENTS}")
    endif()

    set(CHDB_CONFIG_VALID ${CONFIG_VALID} PARENT_SCOPE)
endfunction()

# ============================================================================
# Print Configuration Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== chdb-wasm Configuration ===")
message(STATUS "  Version:           ${CHDB_WASM_VERSION}")
message(STATUS "  Root Directory:    ${CHDB_WASM_ROOT_DIR}")
message(STATUS "  ClickHouse Source: ${CLICKHOUSE_SOURCE_DIR}")
message(STATUS "  chdb Source:       ${CHDB_SOURCE_DIR}")
message(STATUS "  Build Directory:   ${CHDB_WASM_BUILD_DIR}")
message(STATUS "  Dist Directory:    ${CHDB_WASM_DIST_DIR}")
message(STATUS "  Include Paths:     ${CHDB_WASM_INCLUDE_DIRS}")
message(STATUS "================================")
message(STATUS "")

# Run validation
chdb_validate_config()
