# wasm-malloc.cmake
# Memory allocator configuration for chdb WASM builds
#
# This file configures the memory allocator for WebAssembly builds by:
# 1. Disabling jemalloc (which requires mmap and is incompatible with WASM)
# 2. Configuring Emscripten's default allocator (emmalloc or dlmalloc)
# 3. Setting up necessary preprocessor defines for allocator compatibility
#
# jemalloc is incompatible with WASM because:
# - It relies heavily on mmap/munmap for memory management
# - It uses OS-specific thread-local storage mechanisms
# - It has architecture-specific optimizations (x86, ARM)
# - It requires direct control over virtual memory layout
#
# Emscripten provides two allocator options:
# - emmalloc: Smaller and simpler, optimized for code size (~1KB)
# - dlmalloc: Doug Lea's malloc, more full-featured (~4KB)
#
# For WASM builds we use emmalloc by default as it's optimized for size.
#
# Usage:
#   include(cmake/wasm-malloc.cmake)
#   OR add to cmake invocation:
#   cmake -C cmake/wasm-malloc.cmake ..

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== chdb-wasm Memory Allocator Configuration ===")

# ============================================================================
# Disable jemalloc and tcmalloc
# ============================================================================
# These allocators are not compatible with WebAssembly:
# - jemalloc: Requires mmap, munmap, and OS-specific memory management
# - tcmalloc: Google's allocator also requires OS-level memory control
# - mimalloc: Microsoft's allocator has similar OS dependencies

set(ENABLE_JEMALLOC OFF CACHE BOOL "Disable jemalloc (incompatible with WASM)" FORCE)
set(ENABLE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc (incompatible with WASM)" FORCE)
set(ENABLE_MIMALLOC OFF CACHE BOOL "Disable mimalloc (incompatible with WASM)" FORCE)

message(STATUS "  jemalloc: DISABLED (requires mmap, incompatible with WASM)")
message(STATUS "  tcmalloc: DISABLED (requires OS memory management)")
message(STATUS "  mimalloc: DISABLED (requires OS memory management)")

# ============================================================================
# Emscripten Allocator Selection
# ============================================================================
# Emscripten provides built-in allocators that work with WASM memory model:
#
# emmalloc (default for size-optimized builds):
#   - Very small footprint (~1KB added code)
#   - Simple design optimized for small allocations
#   - Good for applications with moderate memory usage
#   - Slightly slower for complex allocation patterns
#
# dlmalloc (default for performance):
#   - Doug Lea's allocator, battle-tested
#   - Larger footprint (~4KB) but more features
#   - Better for complex allocation patterns
#   - Good for applications with heavy memory usage

option(CHDB_WASM_USE_EMMALLOC "Use emmalloc (smaller) instead of dlmalloc (faster)" ON)

if(CHDB_WASM_USE_EMMALLOC)
    set(CHDB_WASM_MALLOC_TYPE "emmalloc")
    message(STATUS "  Allocator: emmalloc (optimized for code size)")
else()
    set(CHDB_WASM_MALLOC_TYPE "dlmalloc")
    message(STATUS "  Allocator: dlmalloc (optimized for performance)")
endif()

# ============================================================================
# Allocator Linker Flags
# ============================================================================
# These flags configure Emscripten's allocator behavior

set(CHDB_WASM_MALLOC_FLAGS "")

# Select the allocator
list(APPEND CHDB_WASM_MALLOC_FLAGS "-sMALLOC='${CHDB_WASM_MALLOC_TYPE}'")

# Malloc failure behavior
# When OFF, malloc returns NULL on failure (recommended for graceful handling)
# When ON, malloc aborts on failure (easier debugging but less graceful)
option(CHDB_WASM_ABORTING_MALLOC "Abort on malloc failure instead of returning NULL" OFF)

if(CHDB_WASM_ABORTING_MALLOC)
    list(APPEND CHDB_WASM_MALLOC_FLAGS "-sABORTING_MALLOC=1")
    message(STATUS "  On malloc failure: ABORT")
else()
    list(APPEND CHDB_WASM_MALLOC_FLAGS "-sABORTING_MALLOC=0")
    message(STATUS "  On malloc failure: Return NULL")
endif()

# ============================================================================
# Preprocessor Defines for ClickHouse Allocator Compatibility
# ============================================================================
# These defines configure how ClickHouse's allocation code behaves when
# jemalloc is disabled. The key areas affected are:
#
# 1. src/Common/Allocator.cpp - Uses __real_malloc/__real_free macros
# 2. src/Common/memory.h - New/delete overrides
# 3. src/Common/AllocationInterceptors.h - Allocation wrapping
#
# When USE_JEMALLOC=0:
# - __real_malloc maps to standard ::malloc
# - __real_free maps to standard ::free
# - Memory tracking still works via MemoryTracker
# - Size queries fall back to malloc_usable_size (if available)

set(CHDB_WASM_MALLOC_DEFINES "")

# Core allocator selection define
# This is the main switch that controls allocator selection in ClickHouse code
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DUSE_JEMALLOC=0")

# Disable jemalloc rename feature (not applicable when jemalloc is disabled)
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DJEMALLOC_NO_RENAME=0")

# Disable Arrow's jemalloc integration (if Arrow is enabled)
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DARROW_JEMALLOC=0")

# Disable GWP-ASan (requires jemalloc integration)
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DUSE_GWP_ASAN=0")

# ============================================================================
# WASM-Specific Memory Configuration
# ============================================================================
# Additional defines for WASM memory model compatibility

# Mark this as a WASM build for any platform-specific code paths
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DCHDB_WASM=1")

# Emscripten provides its own malloc_usable_size equivalent
# This helps with memory tracking accuracy
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DHAVE_MALLOC_USABLE_SIZE=1")

# Disable features that require mmap (already handled by ClickHouse's
# Allocator.cpp but explicit for clarity)
list(APPEND CHDB_WASM_MALLOC_DEFINES "-DNO_MREMAP=1")

# ============================================================================
# Apply Configuration
# ============================================================================

# Convert lists to space-separated strings
string(REPLACE ";" " " CHDB_WASM_MALLOC_FLAGS_STR "${CHDB_WASM_MALLOC_FLAGS}")
string(REPLACE ";" " " CHDB_WASM_MALLOC_DEFINES_STR "${CHDB_WASM_MALLOC_DEFINES}")

# Add to compiler flags (these affect all code including dependencies)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${CHDB_WASM_MALLOC_DEFINES_STR}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${CHDB_WASM_MALLOC_DEFINES_STR}" CACHE STRING "" FORCE)

# Add to linker flags (these affect the final WASM output)
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${CHDB_WASM_MALLOC_FLAGS_STR}" CACHE STRING "" FORCE)
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} ${CHDB_WASM_MALLOC_FLAGS_STR}" CACHE STRING "" FORCE)

# ============================================================================
# Helper Function
# ============================================================================
# Apply malloc configuration to a specific target

function(chdb_apply_wasm_malloc target)
    # Apply defines
    target_compile_definitions(${target} PRIVATE
        USE_JEMALLOC=0
        JEMALLOC_NO_RENAME=0
        ARROW_JEMALLOC=0
        USE_GWP_ASAN=0
        CHDB_WASM=1
        HAVE_MALLOC_USABLE_SIZE=1
        NO_MREMAP=1
    )

    # Apply linker options
    target_link_options(${target} PRIVATE
        "-sMALLOC='${CHDB_WASM_MALLOC_TYPE}'"
    )

    if(CHDB_WASM_ABORTING_MALLOC)
        target_link_options(${target} PRIVATE "-sABORTING_MALLOC=1")
    else()
        target_link_options(${target} PRIVATE "-sABORTING_MALLOC=0")
    endif()

    message(STATUS "Applied WASM malloc configuration to target: ${target}")
endfunction()

# ============================================================================
# Compatibility Shim Interface
# ============================================================================
# For WASM builds, we may need to provide shims for certain jemalloc-specific
# functions that ClickHouse code might reference conditionally.
#
# The following functions need shims when jemalloc is disabled:
# - je_malloc_usable_size -> use emscripten's malloc_usable_size
# - je_mallctl -> return error (not available)
# - je_malloc_stats_print -> no-op (not available)
#
# These shims are defined in wasm-malloc-shims.cpp (if needed)

option(CHDB_WASM_INCLUDE_MALLOC_SHIMS "Include compatibility shims for jemalloc functions" ON)

if(CHDB_WASM_INCLUDE_MALLOC_SHIMS)
    set(CHDB_WASM_MALLOC_SHIMS_SOURCE "${CMAKE_CURRENT_LIST_DIR}/wasm-malloc-shims.cpp")
    if(EXISTS "${CHDB_WASM_MALLOC_SHIMS_SOURCE}")
        message(STATUS "  Malloc shims: Enabled (${CHDB_WASM_MALLOC_SHIMS_SOURCE})")
    else()
        message(STATUS "  Malloc shims: Source file not found, will use compile-time guards")
    endif()
endif()

# ============================================================================
# Documentation: Preprocessor Defines Reference
# ============================================================================
#
# The following preprocessor defines control memory allocation in ClickHouse:
#
# USE_JEMALLOC (0 or 1)
#   - Main switch for jemalloc usage
#   - When 0: Uses standard malloc/free via __real_* macros
#   - When 1: Uses je_malloc/je_free directly
#   - Affects: Allocator.cpp, memory.h, AllocationInterceptors.cpp
#
# JEMALLOC_NO_RENAME (0 or 1)
#   - Controls whether jemalloc symbols are prefixed with "je_"
#   - When 0: Use standard names (malloc, free)
#   - When 1: Use prefixed names (je_malloc, je_free)
#   - Only relevant when USE_JEMALLOC=1
#
# ARROW_JEMALLOC (0 or 1)
#   - Controls Apache Arrow's jemalloc integration
#   - When 0: Arrow uses system allocator
#   - When 1: Arrow uses jemalloc
#   - Should match USE_JEMALLOC setting
#
# USE_GWP_ASAN (0 or 1)
#   - Controls GWP-ASan (probabilistic memory safety)
#   - Requires jemalloc, so must be 0 when USE_JEMALLOC=0
#
# CHDB_WASM (0 or 1)
#   - Custom define to identify WASM builds
#   - Can be used for WASM-specific code paths
#
# HAVE_MALLOC_USABLE_SIZE (0 or 1)
#   - Indicates availability of malloc_usable_size()
#   - Emscripten provides this function
#   - Used for accurate memory tracking
#
# NO_MREMAP (0 or 1)
#   - Disables mremap usage in allocator
#   - mremap is not available in WASM
#
# ============================================================================

message(STATUS "")
message(STATUS "=== WASM Malloc Configuration Summary ===")
message(STATUS "  Allocator type:     ${CHDB_WASM_MALLOC_TYPE}")
message(STATUS "  Aborting malloc:    ${CHDB_WASM_ABORTING_MALLOC}")
message(STATUS "  Compiler defines:   ${CHDB_WASM_MALLOC_DEFINES_STR}")
message(STATUS "  Linker flags:       ${CHDB_WASM_MALLOC_FLAGS_STR}")
message(STATUS "==========================================")
message(STATUS "")
