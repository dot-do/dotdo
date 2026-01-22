# wasm-threading.cmake
# CMake configuration for single-threaded WASM mode threading stubs
#
# This module configures the build to use synchronous/inline threading stubs
# instead of real pthreads. WASM has limited threading support (requires
# SharedArrayBuffer + Web Workers), so we provide a single-threaded fallback.
#
# What this module does:
# 1. Defines WASM_SINGLE_THREADED to enable stub implementations
# 2. Adds the threading stubs directory to include paths
# 3. Configures Emscripten to disable pthreads
# 4. Provides stub implementations that execute tasks synchronously
#
# Usage:
#   include(cmake/wasm-threading.cmake)
#   # Then call wasm_configure_threading() in your CMakeLists.txt
#
# Stub Files:
#   - wasm_threadpool_stub.h  : ThreadPool that runs tasks inline
#   - wasm_thread_stub.h      : std::thread replacement (sync execution)
#   - wasm_mutex_stub.h       : No-op mutex (no contention in single-threaded)

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== WASM Single-Threaded Mode Configuration ===")
message(STATUS "")

# ============================================================================
# Configuration Options
# ============================================================================

option(WASM_SINGLE_THREADED "Build WASM without pthreads (single-threaded)" ON)
option(WASM_THREADING_DEBUG "Enable threading stub debug output" OFF)

# ============================================================================
# Path Configuration
# ============================================================================

# Get the directory containing this cmake file
get_filename_component(WASM_CMAKE_DIR "${CMAKE_CURRENT_LIST_FILE}" DIRECTORY)

# Threading stubs are in the wasm/threading directory relative to cmake/
set(WASM_THREADING_STUBS_DIR "${WASM_CMAKE_DIR}/../wasm/threading")
get_filename_component(WASM_THREADING_STUBS_DIR "${WASM_THREADING_STUBS_DIR}" ABSOLUTE)

# ============================================================================
# Main Configuration Function
# ============================================================================

function(wasm_configure_threading TARGET)
    if(NOT WASM_SINGLE_THREADED)
        message(STATUS "WASM threading: Using real pthreads (multi-threaded mode)")
        return()
    endif()

    message(STATUS "WASM threading: Single-threaded mode ENABLED")
    message(STATUS "  Threading stubs directory: ${WASM_THREADING_STUBS_DIR}")

    # Verify stub files exist
    foreach(STUB_FILE wasm_threadpool_stub.h wasm_thread_stub.h wasm_mutex_stub.h)
        if(NOT EXISTS "${WASM_THREADING_STUBS_DIR}/${STUB_FILE}")
            message(FATAL_ERROR "Missing threading stub: ${WASM_THREADING_STUBS_DIR}/${STUB_FILE}")
        endif()
    endforeach()

    # Add compile definitions
    target_compile_definitions(${TARGET} PRIVATE
        WASM_SINGLE_THREADED=1
        # Disable features that require threads
        CLICKHOUSE_SINGLE_THREAD_MODE=1
    )

    # Add include directory for stubs
    target_include_directories(${TARGET} PRIVATE
        ${WASM_THREADING_STUBS_DIR}
    )

    if(WASM_THREADING_DEBUG)
        target_compile_definitions(${TARGET} PRIVATE
            WASM_THREADING_DEBUG=1
        )
    endif()

    message(STATUS "  Compile definitions: WASM_SINGLE_THREADED, CLICKHOUSE_SINGLE_THREAD_MODE")
    message(STATUS "  Include path added: ${WASM_THREADING_STUBS_DIR}")
endfunction()

# ============================================================================
# Emscripten-Specific Configuration
# ============================================================================

function(wasm_configure_emscripten_threading TARGET)
    if(NOT EMSCRIPTEN)
        message(WARNING "wasm_configure_emscripten_threading called but not building with Emscripten")
        return()
    endif()

    if(NOT WASM_SINGLE_THREADED)
        # Multi-threaded mode - enable pthreads
        message(STATUS "Emscripten: Enabling pthreads support")
        target_compile_options(${TARGET} PRIVATE -pthread)
        target_link_options(${TARGET} PRIVATE
            -pthread
            -sPTHREAD_POOL_SIZE=4
            -sPTHREAD_POOL_SIZE_STRICT=0
        )
    else()
        # Single-threaded mode - disable pthreads
        message(STATUS "Emscripten: Single-threaded mode (no pthreads)")
        target_compile_options(${TARGET} PRIVATE
            -DWASM_SINGLE_THREADED=1
        )
        # Ensure we don't accidentally link pthreads
        target_link_options(${TARGET} PRIVATE
            -sUSE_PTHREADS=0
            -sSINGLE_FILE=0
        )
    endif()
endfunction()

# ============================================================================
# Convenience Function for Full Configuration
# ============================================================================

function(wasm_setup_threading TARGET)
    wasm_configure_threading(${TARGET})
    if(EMSCRIPTEN)
        wasm_configure_emscripten_threading(${TARGET})
    endif()
endfunction()

# ============================================================================
# Global Settings (applied when this file is included)
# ============================================================================

if(WASM_SINGLE_THREADED)
    # Global compile definitions for the entire project
    add_compile_definitions(
        WASM_SINGLE_THREADED=1
    )

    # Add threading stubs to global include path
    include_directories(${WASM_THREADING_STUBS_DIR})

    message(STATUS "Global threading settings applied:")
    message(STATUS "  - WASM_SINGLE_THREADED=1")
    message(STATUS "  - Include: ${WASM_THREADING_STUBS_DIR}")
endif()

# ============================================================================
# Header Replacement Configuration
# ============================================================================
# This section provides macros to conditionally include stub headers
# instead of real threading headers.

# Create a config header that can be included at the top of translation units
set(WASM_THREADING_CONFIG_CONTENT "
/**
 * wasm_threading_config.h - Auto-generated threading configuration
 *
 * This header conditionally includes either real threading headers or
 * WASM stubs based on the build configuration.
 */

#ifndef WASM_THREADING_CONFIG_H
#define WASM_THREADING_CONFIG_H

#ifdef WASM_SINGLE_THREADED

// Include WASM threading stubs
#include \"wasm_threadpool_stub.h\"
#include \"wasm_thread_stub.h\"
#include \"wasm_mutex_stub.h\"

// Macro to replace std::thread with wasm::thread
#define WASM_THREAD wasm::thread

// Macro to replace std::mutex with wasm::mutex
#define WASM_MUTEX wasm::mutex
#define WASM_RECURSIVE_MUTEX wasm::recursive_mutex
#define WASM_SHARED_MUTEX wasm::shared_mutex

// Macro to replace std::condition_variable
#define WASM_CONDITION_VARIABLE wasm::condition_variable

// Macro to use WASM ThreadPool
#define WASM_THREADPOOL DB::WasmThreadPool

#else // !WASM_SINGLE_THREADED

// Use real threading primitives
#include <thread>
#include <mutex>
#include <shared_mutex>
#include <condition_variable>
#include <Common/ThreadPool.h>

#define WASM_THREAD std::thread
#define WASM_MUTEX std::mutex
#define WASM_RECURSIVE_MUTEX std::recursive_mutex
#define WASM_SHARED_MUTEX std::shared_mutex
#define WASM_CONDITION_VARIABLE std::condition_variable
#define WASM_THREADPOOL DB::ThreadPool

#endif // WASM_SINGLE_THREADED

#endif // WASM_THREADING_CONFIG_H
")

# Write the config header
if(WASM_SINGLE_THREADED)
    file(WRITE "${CMAKE_BINARY_DIR}/wasm_threading_config.h" "${WASM_THREADING_CONFIG_CONTENT}")
    message(STATUS "Generated: ${CMAKE_BINARY_DIR}/wasm_threading_config.h")
endif()

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== WASM Threading Configuration Summary ===")
message(STATUS "  Mode: ${WASM_SINGLE_THREADED}")
if(WASM_SINGLE_THREADED)
    message(STATUS "  Threading: Single-threaded (synchronous)")
    message(STATUS "  ThreadPool: Tasks execute inline")
    message(STATUS "  Mutexes: No-op (no contention)")
    message(STATUS "  Condition Variables: Return immediately")
else()
    message(STATUS "  Threading: Multi-threaded (pthreads)")
    message(STATUS "  ThreadPool: Real thread pool")
    message(STATUS "  Mutexes: Real synchronization")
endif()
message(STATUS "")
message(STATUS "Available functions:")
message(STATUS "  wasm_configure_threading(TARGET) - Add threading config to target")
message(STATUS "  wasm_configure_emscripten_threading(TARGET) - Add Emscripten flags")
message(STATUS "  wasm_setup_threading(TARGET) - Combined setup function")
message(STATUS "================================================")
message(STATUS "")
