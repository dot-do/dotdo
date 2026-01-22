# CMakeLists.txt - ext-math SIDE_MODULE Build Configuration
#
# This CMake configuration builds the ext-math side module (SIDE_MODULE=2)
# for Emscripten's dynamic linking feature. The module provides mathematical
# functions that can be loaded at runtime via dlopen().
#
# The side module:
# - Imports system functions (malloc, free) from the MAIN_MODULE
# - Imports core utility functions (core_log, core_set_error, etc.)
# - Exports its own math functions
# - Shares memory with the MAIN_MODULE
#
# Usage:
#   emcmake cmake -B build/ext-math wasm/extensions/math
#   emmake make -C build/ext-math
#
# Output: ext-math.wasm

cmake_minimum_required(VERSION 3.16)
project(ext_math LANGUAGES CXX)

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
set(EXT_MATH_EXPORTED_FUNCTIONS
    # Initialization and metadata
    "_ext_math_init"
    "_ext_math_get_name"
    "_ext_math_get_version"
    "_ext_math_is_initialized"
    "_ext_math_get_computation_count"

    # Core math functions
    "_ext_math_factorial"
    "_ext_math_fibonacci"
    "_ext_math_is_prime"
    "_ext_math_gcd"
    "_ext_math_sqrt"

    # Additional math functions
    "_ext_math_lcm"
    "_ext_math_power"
    "_ext_math_abs"
    "_ext_math_count_primes"

    # Array/memory operations
    "_ext_math_sum_array"
    "_ext_math_create_sequence"
    "_ext_math_free_buffer"
)

# Join exported functions into comma-separated string
string(JOIN "," EXT_MATH_EXPORTS_STR ${EXT_MATH_EXPORTED_FUNCTIONS})

# ============================================================================
# Source Files
# ============================================================================

set(EXT_MATH_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/math.cpp
)

# ============================================================================
# Emscripten SIDE_MODULE Build
# ============================================================================

if(EMSCRIPTEN)
    # Create the side module as a shared library
    add_library(ext-math SHARED ${EXT_MATH_SOURCES})

    # SIDE_MODULE=2 enables dynamic linking with minimal exports
    # The side module imports functions from the MAIN_MODULE
    set_target_properties(ext-math PROPERTIES
        PREFIX ""
        SUFFIX ".wasm"
        LINK_FLAGS "\
            -sSIDE_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${EXT_MATH_EXPORTS_STR}] \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(ext-math PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # ========================================================================
    # Build Information
    # ========================================================================

    message(STATUS "")
    message(STATUS "================================================================")
    message(STATUS "  ext-math SIDE_MODULE Configuration")
    message(STATUS "================================================================")
    message(STATUS "")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/ext-math.wasm")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  SIDE_MODULE=2 (dynamic linking with minimal exports)")
    message(STATUS "")
    message(STATUS "Exported Functions:")

    foreach(FN ${EXT_MATH_EXPORTED_FUNCTIONS})
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
        add_library(ext-math-testlib STATIC ${EXT_MATH_SOURCES})

        target_include_directories(ext-math-testlib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(ext-math-testlib PRIVATE
            TEST_BUILD=1
        )

        # Native test executable
        add_executable(test_ext_math_native
            ${CMAKE_CURRENT_SOURCE_DIR}/test_math.cpp
        )

        target_link_libraries(test_ext_math_native PRIVATE ext-math-testlib)

        target_include_directories(test_ext_math_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_ext_math_native PRIVATE
            TEST_BUILD=1
        )

        message(STATUS "")
        message(STATUS "================================================================")
        message(STATUS "  Native Test Build Configuration")
        message(STATUS "================================================================")
        message(STATUS "")
        message(STATUS "  Test executable: test_ext_math_native")
        message(STATUS "  Library: ext-math-testlib")
        message(STATUS "")
        message(STATUS "================================================================")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use:")
        message(STATUS "  emcmake cmake -B build/ext-math wasm/extensions/math")
        message(STATUS "  emmake make -C build/ext-math")
        message(STATUS "")
    endif()
endif()
