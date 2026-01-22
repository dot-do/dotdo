# wasm-lto.cmake
# Link Time Optimization (LTO) Configuration for chdb WASM Builds
#
# This configuration properly enables LTO for Emscripten WASM builds.
# LTO can provide 15-25% size reduction by enabling:
#   - Cross-module dead code elimination
#   - Cross-module inlining
#   - Whole-program optimization
#
# Usage:
#   Include this file AFTER wasm-build.cmake or wasm-minimal-correct.cmake:
#   cmake -C cmake/wasm-minimal-correct.cmake -C cmake/wasm-lto.cmake ...
#
# LTO Modes:
#   -flto or -flto=full: Full LTO (recommended by Emscripten, better optimization)
#   -flto=thin: ThinLTO (faster builds, good optimization)
#
# References:
#   - https://emscripten.org/docs/compiling/WebAssembly.html
#   - https://github.com/emscripten-core/emscripten/issues/10868
#   - https://github.com/emscripten-core/emscripten/issues/11143
#
# Note: Emscripten recommends full LTO (-flto) over thin LTO (-flto=thin)
# because full LTO is more thoroughly tested.

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  LTO (Link Time Optimization) Configuration for WASM")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# LTO Mode Selection
# ============================================================================

# Option to choose LTO mode: "full" (default, recommended) or "thin"
set(CHDB_WASM_LTO_MODE "full" CACHE STRING "LTO mode: full (recommended) or thin")
set_property(CACHE CHDB_WASM_LTO_MODE PROPERTY STRINGS "full" "thin")

# Validate LTO mode
if(NOT CHDB_WASM_LTO_MODE MATCHES "^(full|thin)$")
    message(WARNING "Invalid CHDB_WASM_LTO_MODE: ${CHDB_WASM_LTO_MODE}, using 'full'")
    set(CHDB_WASM_LTO_MODE "full")
endif()

# Set the LTO flag based on mode
if(CHDB_WASM_LTO_MODE STREQUAL "thin")
    set(CHDB_LTO_FLAG "-flto=thin")
    message(STATUS "LTO Mode: ThinLTO (-flto=thin)")
    message(STATUS "  - Faster compilation")
    message(STATUS "  - Incremental builds supported")
    message(STATUS "  - Less thoroughly tested with Emscripten")
else()
    set(CHDB_LTO_FLAG "-flto")
    message(STATUS "LTO Mode: Full LTO (-flto)")
    message(STATUS "  - Maximum optimization potential")
    message(STATUS "  - Recommended by Emscripten")
    message(STATUS "  - Better dead code elimination")
endif()

# ============================================================================
# Emscripten Archiver Tools for LTO
# ============================================================================

# Critical: Ensure Emscripten's archiver tools are used for LTO builds
# This fixes the CMAKE_INTERPROCEDURAL_OPTIMIZATION issue where CMake
# incorrectly uses system llvm-ar instead of emar.
# Reference: https://github.com/emscripten-core/emscripten/issues/11143

if(DEFINED ENV{EMSDK})
    set(EMSDK_ROOT "$ENV{EMSDK}/upstream/emscripten")

    # Set main archiver tools
    set(CMAKE_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten archiver" FORCE)
    set(CMAKE_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten ranlib" FORCE)

    # Critical: Set compiler-specific archiver tools for LTO
    # CMake uses these when CMAKE_INTERPROCEDURAL_OPTIMIZATION is enabled
    set(CMAKE_C_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten C archiver for LTO" FORCE)
    set(CMAKE_CXX_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten C++ archiver for LTO" FORCE)
    set(CMAKE_C_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten C ranlib for LTO" FORCE)
    set(CMAKE_CXX_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten C++ ranlib for LTO" FORCE)

    message(STATUS "Emscripten LTO Archiver Tools:")
    message(STATUS "  CMAKE_AR: ${CMAKE_AR}")
    message(STATUS "  CMAKE_RANLIB: ${CMAKE_RANLIB}")
    message(STATUS "  CMAKE_C_COMPILER_AR: ${CMAKE_C_COMPILER_AR}")
    message(STATUS "  CMAKE_CXX_COMPILER_AR: ${CMAKE_CXX_COMPILER_AR}")
else()
    message(WARNING "EMSDK environment variable not set - LTO archiver tools may not be configured correctly")
endif()

# ============================================================================
# CMake Interprocedural Optimization (IPO)
# ============================================================================

# We explicitly set -flto flags rather than using CMAKE_INTERPROCEDURAL_OPTIMIZATION
# because this provides more control and avoids CMake's toolchain detection issues.
# However, we still disable CMAKE_INTERPROCEDURAL_OPTIMIZATION to prevent conflicts.

set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "Using explicit -flto flags" FORCE)
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE OFF CACHE BOOL "Using explicit -flto flags" FORCE)

message(STATUS "CMAKE_INTERPROCEDURAL_OPTIMIZATION: OFF (using explicit -flto flags)")

# ============================================================================
# LTO Compile Flags
# ============================================================================

# LTO must be enabled at BOTH compile AND link time
# All compilation units must use the same LTO flags for bitcode compatibility

# Append LTO flag to existing C/CXX flags
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)

# Also set for specific build types
set(CMAKE_C_FLAGS_RELEASE "${CMAKE_C_FLAGS_RELEASE} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS_MINSIZEREL "${CMAKE_C_FLAGS_MINSIZEREL} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_MINSIZEREL "${CMAKE_CXX_FLAGS_MINSIZEREL} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS_RELWITHDEBINFO "${CMAKE_C_FLAGS_RELWITHDEBINFO} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${CMAKE_CXX_FLAGS_RELWITHDEBINFO} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)

message(STATUS "LTO Compile Flags: ${CHDB_LTO_FLAG} added to C/CXX flags")

# ============================================================================
# LTO Link Flags
# ============================================================================

# LTO flag must also be present at link time
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_MODULE_LINKER_FLAGS "${CMAKE_MODULE_LINKER_FLAGS} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)

# Build-type specific linker flags
set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL "${CMAKE_EXE_LINKER_FLAGS_MINSIZEREL} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO "${CMAKE_EXE_LINKER_FLAGS_RELWITHDEBINFO} ${CHDB_LTO_FLAG}" CACHE STRING "" FORCE)

message(STATUS "LTO Link Flags: ${CHDB_LTO_FLAG} added to linker flags")

# ============================================================================
# Additional LTO-Related Optimizations
# ============================================================================

# Whole-program virtual table optimization (works with LTO)
# This enables devirtualization of C++ virtual calls
set(CHDB_WASM_WHOLE_PROGRAM_VTABLES OFF CACHE BOOL "Enable -fwhole-program-vtables" FORCE)

if(CHDB_WASM_WHOLE_PROGRAM_VTABLES)
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fwhole-program-vtables" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fwhole-program-vtables" CACHE STRING "" FORCE)
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -fwhole-program-vtables" CACHE STRING "" FORCE)
    message(STATUS "Whole-program vtables: ENABLED")
else()
    message(STATUS "Whole-program vtables: DISABLED (can cause issues with some code)")
endif()

# ============================================================================
# ClickHouse ThinLTO Settings
# ============================================================================

# Disable ClickHouse's built-in ThinLTO to avoid conflicts
# We're using our own explicit LTO configuration
set(ENABLE_THINLTO OFF CACHE BOOL "Disable ClickHouse ThinLTO (using explicit LTO)" FORCE)

message(STATUS "ClickHouse ENABLE_THINLTO: OFF (using explicit LTO instead)")

# ============================================================================
# LTO Cache Configuration (ThinLTO only)
# ============================================================================

if(CHDB_WASM_LTO_MODE STREQUAL "thin")
    # ThinLTO supports caching for faster incremental builds
    # Set cache directory if not already set
    if(NOT DEFINED CHDB_WASM_LTO_CACHE_DIR)
        set(CHDB_WASM_LTO_CACHE_DIR "${CMAKE_BINARY_DIR}/lto-cache" CACHE PATH "ThinLTO cache directory")
    endif()

    # Enable ThinLTO caching via linker flags
    # Note: This uses LLVM's ThinLTO cache mechanism
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--thinlto-cache-dir=${CHDB_WASM_LTO_CACHE_DIR}" CACHE STRING "" FORCE)

    message(STATUS "ThinLTO Cache Directory: ${CHDB_WASM_LTO_CACHE_DIR}")
endif()

# ============================================================================
# LTO Job Control
# ============================================================================

# Control parallelism during LTO phase
# This helps prevent out-of-memory issues on machines with limited RAM
set(CHDB_WASM_LTO_JOBS "" CACHE STRING "Number of LTO jobs (empty = auto)")

if(CHDB_WASM_LTO_JOBS)
    if(CHDB_WASM_LTO_MODE STREQUAL "thin")
        set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--thinlto-jobs=${CHDB_WASM_LTO_JOBS}" CACHE STRING "" FORCE)
    else()
        # Full LTO uses a single monolithic optimization pass, but this can help
        set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--lto-jobs=${CHDB_WASM_LTO_JOBS}" CACHE STRING "" FORCE)
    endif()
    message(STATUS "LTO Jobs: ${CHDB_WASM_LTO_JOBS}")
else()
    message(STATUS "LTO Jobs: auto (system default)")
endif()

# ============================================================================
# Function to Apply LTO Settings to a Target
# ============================================================================

function(chdb_apply_lto_settings TARGET)
    message(STATUS "Applying LTO settings to target: ${TARGET}")

    # Add LTO compile flags
    target_compile_options(${TARGET} PRIVATE ${CHDB_LTO_FLAG})

    # Add LTO link flags
    target_link_options(${TARGET} PRIVATE ${CHDB_LTO_FLAG})

    # Add whole-program vtables if enabled
    if(CHDB_WASM_WHOLE_PROGRAM_VTABLES)
        target_compile_options(${TARGET} PRIVATE -fwhole-program-vtables)
        target_link_options(${TARGET} PRIVATE -fwhole-program-vtables)
    endif()
endfunction()

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  LTO Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "LTO Mode:              ${CHDB_WASM_LTO_MODE}")
message(STATUS "LTO Flag:              ${CHDB_LTO_FLAG}")
message(STATUS "Whole-program vtables: ${CHDB_WASM_WHOLE_PROGRAM_VTABLES}")
message(STATUS "")
message(STATUS "Expected Benefits:")
message(STATUS "  - 15-25% binary size reduction")
message(STATUS "  - Cross-module dead code elimination")
message(STATUS "  - Cross-module function inlining")
message(STATUS "  - Better constant propagation")
message(STATUS "")
message(STATUS "Build Time Impact:")
if(CHDB_WASM_LTO_MODE STREQUAL "thin")
    message(STATUS "  - ThinLTO: Moderate increase, supports incremental builds")
else()
    message(STATUS "  - Full LTO: Significant increase, but better optimization")
endif()
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
