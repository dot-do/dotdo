# MinimalProfile.cmake
# Minimal build configuration for ~3MB gzipped target
#
# This profile applies aggressive optimizations to achieve the smallest possible
# WASM bundle size while maintaining core SQL functionality.

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Size Target
# ============================================================================

set(CHDB_MINIMAL_SIZE_TARGET "3MB" CACHE STRING "Target gzipped size for minimal build")
message(STATUS "chdb-wasm Minimal Profile: Target size ${CHDB_MINIMAL_SIZE_TARGET} gzipped")

# ============================================================================
# Aggressive Size Optimization Flags
# ============================================================================

# Use -Os for optimal size/performance balance (or -Oz for maximum size reduction)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Os -flto")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Os -flto")

# Disable exceptions (use aborts) - saves significant code size
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-exceptions -fno-rtti")

# Strip symbols from final binary
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -s")

# Additional size reduction flags
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-unwind-tables -fno-asynchronous-unwind-tables")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -ffunction-sections -fdata-sections")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-common -fmerge-all-constants")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fvisibility=hidden -fvisibility-inlines-hidden")

# ============================================================================
# WASM-Specific Emscripten Optimizations
# ============================================================================

set(EMSCRIPTEN_FLAGS "-s MINIMAL_RUNTIME=1")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s FILESYSTEM=0")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s DISABLE_EXCEPTION_CATCHING=1")

# Additional WASM size optimizations
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s ENVIRONMENT='web,worker'")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s MODULARIZE=1")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s EXPORT_ES6=1")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s SINGLE_FILE=0")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s WASM=1")

# Use emmalloc for smaller allocator footprint
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s MALLOC='emmalloc'")

# Disable features not needed for minimal build
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s SUPPORT_LONGJMP=0")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s SUPPORT_ERRNO=0")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s NO_EXIT_RUNTIME=1")
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s NODERAWFS=0")

# Aggressive dead code elimination
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} -s ELIMINATE_DUPLICATE_FUNCTIONS=1")

# Closure compiler for JS minification (level 1 for compatibility)
set(EMSCRIPTEN_FLAGS "${EMSCRIPTEN_FLAGS} --closure 1")

# Apply to linker flags
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_FLAGS}")

# ============================================================================
# Feature Gates for Minimal Build
# ============================================================================

# Core minimal build flag
add_definitions(-DCHDB_MINIMAL_BUILD)

# Disable advanced SQL features to reduce code size
add_definitions(-DCHDB_NO_WINDOW_FUNCTIONS)
add_definitions(-DCHDB_NO_CTE)
add_definitions(-DCHDB_NO_ADVANCED_AGGREGATES)

# Disable optional features
add_definitions(-DCHDB_NO_FULL_TEXT_SEARCH)
add_definitions(-DCHDB_NO_GEO_FUNCTIONS)
add_definitions(-DCHDB_NO_MACHINE_LEARNING)
add_definitions(-DCHDB_NO_BITMAP_FUNCTIONS)
add_definitions(-DCHDB_NO_ENCRYPTION_FUNCTIONS)

# Disable non-essential table engines
add_definitions(-DCHDB_NO_MERGETREE_ENGINE)
add_definitions(-DCHDB_NO_S3_ENGINE)
add_definitions(-DCHDB_NO_KAFKA_ENGINE)
add_definitions(-DCHDB_NO_RABBITMQ_ENGINE)

# Disable non-essential formats
add_definitions(-DCHDB_NO_AVRO_FORMAT)
add_definitions(-DCHDB_NO_PROTOBUF_FORMAT)
add_definitions(-DCHDB_NO_MSGPACK_FORMAT)
add_definitions(-DCHDB_NO_ORC_FORMAT)

# Disable compression codecs (keep only LZ4)
add_definitions(-DCHDB_NO_ZSTD)
add_definitions(-DCHDB_NO_BROTLI)
add_definitions(-DCHDB_NO_SNAPPY)

# Disable debugging and logging
add_definitions(-DNDEBUG)
add_definitions(-DCHDB_NO_LOGGING)
add_definitions(-DCHDB_NO_PROFILING)
add_definitions(-DCHDB_NO_TRACING)

# ============================================================================
# Include Profile Configuration
# ============================================================================

# Include the minimal profile settings
include(${CMAKE_CURRENT_LIST_DIR}/profiles/minimal.cmake)

# ============================================================================
# Function to Apply Minimal Profile to Target
# ============================================================================

function(chdb_apply_minimal_profile target)
    # Apply compile definitions
    target_compile_definitions(${target} PRIVATE
        CHDB_MINIMAL_BUILD
        CHDB_NO_WINDOW_FUNCTIONS
        CHDB_NO_CTE
        CHDB_NO_ADVANCED_AGGREGATES
        CHDB_NO_FULL_TEXT_SEARCH
        CHDB_NO_GEO_FUNCTIONS
        NDEBUG
    )

    # Apply compile options
    target_compile_options(${target} PRIVATE
        -Os
        -flto
        -fno-exceptions
        -fno-rtti
        -fno-unwind-tables
        -ffunction-sections
        -fdata-sections
        -fvisibility=hidden
    )

    # Apply link options for Emscripten
    if(EMSCRIPTEN)
        target_link_options(${target} PRIVATE
            -s MINIMAL_RUNTIME=1
            -s FILESYSTEM=0
            -s DISABLE_EXCEPTION_CATCHING=1
            -s MALLOC='emmalloc'
            -s ELIMINATE_DUPLICATE_FUNCTIONS=1
            --closure=1
        )
    endif()

    message(STATUS "Applied minimal profile to ${target}")
endfunction()

# ============================================================================
# Print Minimal Profile Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== chdb-wasm Minimal Profile Configuration ===")
message(STATUS "  Size Target:          ${CHDB_MINIMAL_SIZE_TARGET} gzipped")
message(STATUS "  Optimization:         -Os -flto")
message(STATUS "  Exceptions:           Disabled (-fno-exceptions)")
message(STATUS "  RTTI:                 Disabled (-fno-rtti)")
message(STATUS "  Minimal Runtime:      Enabled")
message(STATUS "  Filesystem:           Disabled")
message(STATUS "  Closure Compiler:     Level 1")
message(STATUS "  Disabled Features:")
message(STATUS "    - Window Functions")
message(STATUS "    - Common Table Expressions")
message(STATUS "    - Advanced Aggregates")
message(STATUS "    - Geo/ML/Encryption Functions")
message(STATUS "    - Non-essential Engines")
message(STATUS "    - Non-essential Formats")
message(STATUS "================================================")
message(STATUS "")
