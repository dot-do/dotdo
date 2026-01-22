# CMakeLists.txt - ext-geo SIDE_MODULE Build Configuration
#
# This CMake configuration builds the ext-geo side module (SIDE_MODULE=2)
# for Emscripten's dynamic linking feature. The module provides geospatial
# functions that can be loaded at runtime via dlopen().
#
# The side module:
# - Imports system functions (malloc, free) from the MAIN_MODULE
# - Imports core utility functions (core_log, core_set_error, etc.)
# - Exports geospatial functions (distance, H3, point-in-polygon, etc.)
# - Shares memory with the MAIN_MODULE
#
# Usage:
#   emcmake cmake -B build/ext-geo wasm/extensions/geo
#   emmake make -C build/ext-geo
#
# Output: ext-geo.wasm

cmake_minimum_required(VERSION 3.16)
project(ext_geo LANGUAGES CXX)

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
set(EXT_GEO_EXPORTED_FUNCTIONS
    # Initialization and metadata
    "_ext_geo_init"
    "_ext_geo_get_name"
    "_ext_geo_get_version"
    "_ext_geo_is_initialized"
    "_ext_geo_get_computation_count"

    # Haversine distance functions
    "_ext_geo_distance"
    "_ext_geo_distance_spheroid"

    # H3 hexagonal indexing (stubbed)
    "_ext_geo_to_h3"
    "_ext_geo_h3_to_geo"
    "_ext_geo_h3_get_resolution"
    "_ext_geo_h3_is_valid"

    # Point-in-polygon testing
    "_ext_geo_point_in_polygon"
    "_ext_geo_point_on_boundary"

    # Polygon area and perimeter
    "_ext_geo_area"
    "_ext_geo_perimeter"

    # Bearing and midpoint
    "_ext_geo_bearing"
    "_ext_geo_midpoint"

    # Bounding box operations
    "_ext_geo_bounding_box"
    "_ext_geo_point_in_bbox"

    # Memory operations
    "_ext_geo_create_polygon"
    "_ext_geo_free_polygon"
)

# Join exported functions into comma-separated string
string(JOIN "," EXT_GEO_EXPORTS_STR ${EXT_GEO_EXPORTED_FUNCTIONS})

# ============================================================================
# Source Files
# ============================================================================

set(EXT_GEO_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/geo.cpp
)

# ============================================================================
# Emscripten SIDE_MODULE Build
# ============================================================================

if(EMSCRIPTEN)
    # Create the side module as a shared library
    add_library(ext-geo SHARED ${EXT_GEO_SOURCES})

    # SIDE_MODULE=2 enables dynamic linking with minimal exports
    # The side module imports functions from the MAIN_MODULE
    set_target_properties(ext-geo PROPERTIES
        PREFIX ""
        SUFFIX ".wasm"
        LINK_FLAGS "\
            -sSIDE_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${EXT_GEO_EXPORTS_STR}] \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(ext-geo PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # ========================================================================
    # Build Information
    # ========================================================================

    message(STATUS "")
    message(STATUS "================================================================")
    message(STATUS "  ext-geo SIDE_MODULE Configuration")
    message(STATUS "================================================================")
    message(STATUS "")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/ext-geo.wasm")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  SIDE_MODULE=2 (dynamic linking with minimal exports)")
    message(STATUS "")
    message(STATUS "Exported Functions:")

    foreach(FN ${EXT_GEO_EXPORTED_FUNCTIONS})
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
        add_library(ext-geo-testlib STATIC ${EXT_GEO_SOURCES})

        target_include_directories(ext-geo-testlib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(ext-geo-testlib PRIVATE
            TEST_BUILD=1
        )

        # Native test executable
        add_executable(test_ext_geo_native
            ${CMAKE_CURRENT_SOURCE_DIR}/test_geo.cpp
        )

        target_link_libraries(test_ext_geo_native PRIVATE ext-geo-testlib)

        target_include_directories(test_ext_geo_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_ext_geo_native PRIVATE
            TEST_BUILD=1
        )

        message(STATUS "")
        message(STATUS "================================================================")
        message(STATUS "  Native Test Build Configuration")
        message(STATUS "================================================================")
        message(STATUS "")
        message(STATUS "  Test executable: test_ext_geo_native")
        message(STATUS "  Library: ext-geo-testlib")
        message(STATUS "")
        message(STATUS "================================================================")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use:")
        message(STATUS "  emcmake cmake -B build/ext-geo wasm/extensions/geo")
        message(STATUS "  emmake make -C build/ext-geo")
        message(STATUS "")
    endif()
endif()
