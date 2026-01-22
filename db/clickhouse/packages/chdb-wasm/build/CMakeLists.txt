# CMakeLists.txt - Main CMake configuration for chdb-wasm
# Build ClickHouse/chdb as WebAssembly for Cloudflare Workers

cmake_minimum_required(VERSION 3.20)
project(chdb-wasm VERSION 1.0.0 LANGUAGES C CXX)

# =============================================================================
# Build Configuration
# =============================================================================

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build profile (minimal, standard, full)
if(NOT DEFINED CHDB_WASM_PROFILE)
    set(CHDB_WASM_PROFILE "standard" CACHE STRING "Build profile: minimal, standard, full")
endif()

message(STATUS "Building chdb-wasm with profile: ${CHDB_WASM_PROFILE}")

# Include feature configuration based on profile
include(${CMAKE_CURRENT_SOURCE_DIR}/wasm-features.cmake)

# =============================================================================
# Emscripten Detection and Configuration
# =============================================================================

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "This project requires Emscripten. Use the toolchain.cmake file.")
endif()

# Verify Emscripten version
if(EMSCRIPTEN_VERSION VERSION_LESS "3.1.50")
    message(WARNING "Emscripten version ${EMSCRIPTEN_VERSION} may have issues. Recommend 3.1.50+")
endif()

# =============================================================================
# Optimization Flags
# =============================================================================

# Enable LTO for smaller binary size
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION ON)

# Size optimization flags
set(WASM_OPTIMIZE_FLAGS
    -Oz                          # Aggressive size optimization
    -flto                        # Link-time optimization
    -fno-exceptions              # Disable C++ exceptions (use error codes)
    -fno-rtti                    # Disable RTTI
    -fvisibility=hidden          # Hide symbols by default
    -fvisibility-inlines-hidden  # Hide inline functions
    -ffunction-sections          # Put each function in its own section
    -fdata-sections              # Put each data item in its own section
)

# Apply optimization flags
add_compile_options(${WASM_OPTIMIZE_FLAGS})

# =============================================================================
# Emscripten-specific Link Flags
# =============================================================================

# Memory configuration for Cloudflare Workers (~128MB limit)
set(WASM_MEMORY_FLAGS
    -sINITIAL_MEMORY=67108864     # 64MB initial memory
    -sMAXIMUM_MEMORY=134217728    # 128MB maximum memory
    -sALLOW_MEMORY_GROWTH=1       # Allow memory to grow
    -sSTACK_SIZE=1048576          # 1MB stack
)

# WASM export configuration
set(WASM_EXPORT_FLAGS
    -sEXPORTED_FUNCTIONS=['_malloc','_free','_chdb_query','_chdb_query_v2','_chdb_create','_chdb_destroy','_chdb_get_memory_stats','_chdb_clear_cache']
    -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','getValue','setValue']
    -sMODULARIZE=1
    -sEXPORT_NAME='createChdbModule'
    -sEXPORT_ES6=1
)

# Environment configuration
set(WASM_ENV_FLAGS
    -sENVIRONMENT='web,worker'    # Target web and worker environments
    -sNO_EXIT_RUNTIME=1           # Don't exit runtime after main()
    -sSINGLE_FILE=0               # Keep WASM separate for better caching
    -sWASM=1                      # Output WASM (not asm.js)
    -sWASM_BIGINT=1               # Use BigInt for 64-bit integers
)

# Optimization link flags
set(WASM_LINK_OPTIMIZE_FLAGS
    -Oz
    -flto
    --closure=1                   # Run Closure compiler on JS
    -sASSERTIONS=0                # Disable assertions in release
    -sDISABLE_EXCEPTION_CATCHING=1
    --gc-sections                 # Garbage collect unused sections
)

# Filesystem configuration (minimal by default)
set(WASM_FS_FLAGS
    -sNO_FILESYSTEM=0             # We need minimal filesystem for data handling
    -sFORCE_FILESYSTEM=0          # Don't force full filesystem
)

# Combine all link flags
set(WASM_LINK_FLAGS
    ${WASM_MEMORY_FLAGS}
    ${WASM_EXPORT_FLAGS}
    ${WASM_ENV_FLAGS}
    ${WASM_LINK_OPTIMIZE_FLAGS}
    ${WASM_FS_FLAGS}
)

string(REPLACE ";" " " WASM_LINK_FLAGS_STR "${WASM_LINK_FLAGS}")

# =============================================================================
# Source Files
# =============================================================================

# chdb WASM wrapper source
set(CHDB_WASM_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/chdb_wasm.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/query_executor.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/memory_manager.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/result_serializer.cpp
)

# =============================================================================
# chdb Core Library
# =============================================================================

# Path to chdb source (adjust as needed)
if(NOT DEFINED CHDB_SOURCE_DIR)
    set(CHDB_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../chdb" CACHE PATH "Path to chdb source")
endif()

if(EXISTS ${CHDB_SOURCE_DIR})
    message(STATUS "Using chdb source from: ${CHDB_SOURCE_DIR}")
    add_subdirectory(${CHDB_SOURCE_DIR} ${CMAKE_BINARY_DIR}/chdb EXCLUDE_FROM_ALL)
else()
    message(STATUS "chdb source not found at ${CHDB_SOURCE_DIR}, will use pre-built library")
endif()

# =============================================================================
# WASM Target
# =============================================================================

add_executable(chdb-wasm ${CHDB_WASM_SOURCES})

# Set output name based on profile
set_target_properties(chdb-wasm PROPERTIES
    OUTPUT_NAME "chdb-${CHDB_WASM_PROFILE}"
    SUFFIX ".js"
)

# Apply link flags
set_target_properties(chdb-wasm PROPERTIES
    LINK_FLAGS "${WASM_LINK_FLAGS_STR}"
)

# Include directories
target_include_directories(chdb-wasm PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../src
    ${CMAKE_CURRENT_SOURCE_DIR}/../include
)

# Link chdb components based on profile
if(TARGET chdb-core)
    target_link_libraries(chdb-wasm PRIVATE chdb-core)
endif()

# Add profile-specific libraries
if(CHDB_WASM_PROFILE STREQUAL "minimal")
    target_link_libraries(chdb-wasm PRIVATE
        chdb-engine-memory
        chdb-format-json
        chdb-format-parquet
        chdb-functions-core
    )
elseif(CHDB_WASM_PROFILE STREQUAL "standard")
    target_link_libraries(chdb-wasm PRIVATE
        chdb-engine-memory
        chdb-engine-mergetree
        chdb-engine-url
        chdb-engine-s3
        chdb-format-json
        chdb-format-parquet
        chdb-format-csv
        chdb-format-tsv
        chdb-format-arrow
        chdb-functions-core
        chdb-functions-aggregate
    )
elseif(CHDB_WASM_PROFILE STREQUAL "full")
    target_link_libraries(chdb-wasm PRIVATE
        chdb-all-engines
        chdb-all-formats
        chdb-all-functions
    )
endif()

# =============================================================================
# Profile-specific compile definitions
# =============================================================================

target_compile_definitions(chdb-wasm PRIVATE
    CHDB_WASM=1
    CHDB_PROFILE_${CHDB_WASM_PROFILE_UPPER}=1
    ${CHDB_FEATURE_DEFINES}
)

# =============================================================================
# Post-build: Copy outputs to dist directory
# =============================================================================

set(DIST_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../dist/${CHDB_WASM_PROFILE})

add_custom_command(TARGET chdb-wasm POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${DIST_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:chdb-wasm>
        ${DIST_DIR}/
    COMMAND ${CMAKE_COMMAND} -E copy
        ${CMAKE_BINARY_DIR}/chdb-${CHDB_WASM_PROFILE}.wasm
        ${DIST_DIR}/
    COMMENT "Copying WASM outputs to ${DIST_DIR}"
)

# =============================================================================
# Install
# =============================================================================

install(FILES
    ${CMAKE_BINARY_DIR}/chdb-${CHDB_WASM_PROFILE}.js
    ${CMAKE_BINARY_DIR}/chdb-${CHDB_WASM_PROFILE}.wasm
    DESTINATION ${CMAKE_INSTALL_PREFIX}/lib
)

install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../include/
    DESTINATION ${CMAKE_INSTALL_PREFIX}/include
)

# =============================================================================
# Info Target
# =============================================================================

add_custom_target(info
    COMMAND ${CMAKE_COMMAND} -E echo "chdb-wasm build configuration:"
    COMMAND ${CMAKE_COMMAND} -E echo "  Profile: ${CHDB_WASM_PROFILE}"
    COMMAND ${CMAKE_COMMAND} -E echo "  Initial Memory: 64MB"
    COMMAND ${CMAKE_COMMAND} -E echo "  Maximum Memory: 128MB"
    COMMAND ${CMAKE_COMMAND} -E echo "  LTO: enabled"
    COMMAND ${CMAKE_COMMAND} -E echo "  Optimization: -Oz"
    VERBATIM
)
