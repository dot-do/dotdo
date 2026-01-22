# CMakeLists.txt - ext-math-native SIDE_MODULE Build Configuration
#
# This CMake configuration builds the ext-math-native side module (SIDE_MODULE=2)
# for Emscripten's dynamic linking feature. The module provides native math
# functions (from <cmath>) that match ClickHouse's math function signatures.
#
# This is Option B from Spike 2: Simple scalar wrappers around standard library
# math functions, packaged as a dynamically-loadable SIDE_MODULE.
#
# Usage:
#   emcmake cmake -B build/ext-math-native wasm/extensions/math-native
#   emmake make -C build/ext-math-native
#
# Output: ext-math-native.wasm

cmake_minimum_required(VERSION 3.16)
project(ext_math_native LANGUAGES CXX)

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
set(EXT_MATH_NATIVE_EXPORTED_FUNCTIONS
    # Initialization and metadata
    "_ext_math_native_init"
    "_ext_math_native_get_name"
    "_ext_math_native_get_version"
    "_ext_math_native_is_initialized"
    "_ext_math_native_get_call_count"

    # Trigonometric functions
    "_ch_sin"
    "_ch_cos"
    "_ch_tan"

    # Inverse trigonometric functions
    "_ch_asin"
    "_ch_acos"
    "_ch_atan"
    "_ch_atan2"

    # Hyperbolic functions
    "_ch_sinh"
    "_ch_cosh"
    "_ch_tanh"
    "_ch_asinh"
    "_ch_acosh"
    "_ch_atanh"

    # Exponential and logarithmic functions
    "_ch_exp"
    "_ch_exp2"
    "_ch_exp10"
    "_ch_log"
    "_ch_log2"
    "_ch_log10"
    "_ch_log1p"

    # Power and root functions
    "_ch_sqrt"
    "_ch_cbrt"
    "_ch_pow"
    "_ch_hypot"

    # Error and gamma functions
    "_ch_erf"
    "_ch_erfc"
    "_ch_lgamma"
    "_ch_tgamma"

    # Special functions
    "_ch_sigmoid"
    "_ch_degrees"
    "_ch_radians"

    # Comparison and utility functions
    "_ch_abs"
    "_ch_min2"
    "_ch_max2"

    # Mathematical constants
    "_ch_e"
    "_ch_pi"

    # Integer versions
    "_ch_abs_int"
)

# Join exported functions into comma-separated string
string(JOIN "," EXT_MATH_NATIVE_EXPORTS_STR ${EXT_MATH_NATIVE_EXPORTED_FUNCTIONS})

# ============================================================================
# Source Files
# ============================================================================

set(EXT_MATH_NATIVE_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/math_native.cpp
)

# ============================================================================
# Emscripten SIDE_MODULE Build
# ============================================================================

if(EMSCRIPTEN)
    # Create the side module as a shared library
    add_library(ext-math-native SHARED ${EXT_MATH_NATIVE_SOURCES})

    # SIDE_MODULE=2 enables dynamic linking with minimal exports
    # The side module imports functions from the MAIN_MODULE
    set_target_properties(ext-math-native PROPERTIES
        PREFIX ""
        SUFFIX ".wasm"
        LINK_FLAGS "\
            -sSIDE_MODULE=2 \
            -sEXPORTED_FUNCTIONS=[${EXT_MATH_NATIVE_EXPORTS_STR}] \
            ${COMMON_FLAGS} \
        "
    )

    target_include_directories(ext-math-native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

    # ========================================================================
    # Build Information
    # ========================================================================

    message(STATUS "")
    message(STATUS "================================================================")
    message(STATUS "  ext-math-native SIDE_MODULE Configuration")
    message(STATUS "================================================================")
    message(STATUS "")
    message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
    message(STATUS "  Debug: ${BUILD_DEBUG}")
    message(STATUS "  Optimized: ${BUILD_OPTIMIZED}")
    message(STATUS "  Output: ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/ext-math-native.wasm")
    message(STATUS "")
    message(STATUS "Emscripten Settings:")
    message(STATUS "  SIDE_MODULE=2 (dynamic linking with minimal exports)")
    message(STATUS "")
    message(STATUS "Exported Functions: ${CMAKE_CURRENT_LIST_DIR}")

    list(LENGTH EXT_MATH_NATIVE_EXPORTED_FUNCTIONS FUNC_COUNT)
    message(STATUS "  Total: ${FUNC_COUNT} functions")
    message(STATUS "")
    message(STATUS "================================================================")

# ============================================================================
# Native Test Build (for development)
# ============================================================================

else()
    if(BUILD_TESTS)
        # For native tests, we provide stub implementations of core functions
        add_executable(test_ext_math_native
            ${CMAKE_CURRENT_SOURCE_DIR}/math_native.cpp
            ${CMAKE_CURRENT_SOURCE_DIR}/test_math_native.cpp
        )

        target_include_directories(test_ext_math_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

        target_compile_definitions(test_ext_math_native PRIVATE
            TEST_BUILD=1
        )

        # Link math library
        target_link_libraries(test_ext_math_native PRIVATE m)

        message(STATUS "")
        message(STATUS "================================================================")
        message(STATUS "  Native Test Build Configuration")
        message(STATUS "================================================================")
        message(STATUS "")
        message(STATUS "  Test executable: test_ext_math_native")
        message(STATUS "")
        message(STATUS "================================================================")
    else()
        message(STATUS "")
        message(STATUS "Non-Emscripten build detected.")
        message(STATUS "Use -DBUILD_TESTS=ON to build native tests.")
        message(STATUS "For WASM build, use:")
        message(STATUS "  emcmake cmake -B build/ext-math-native wasm/extensions/math-native")
        message(STATUS "  emmake make -C build/ext-math-native")
        message(STATUS "")
    endif()
endif()
