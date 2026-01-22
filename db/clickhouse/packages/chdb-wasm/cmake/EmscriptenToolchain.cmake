# EmscriptenToolchain.cmake
# Full Emscripten toolchain configuration for chdb WASM compilation
#
# This toolchain file configures the Emscripten compiler for building
# chdb as a WebAssembly module with JavaScript interop.

cmake_minimum_required(VERSION 3.20)

# Verify Emscripten environment
if(NOT DEFINED ENV{EMSDK})
    message(FATAL_ERROR "EMSDK environment variable not set. Please source emsdk_env.sh first.")
endif()

# Set the system name to Emscripten
set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)

# Find Emscripten tools
find_program(EMCC_EXECUTABLE emcc REQUIRED)
find_program(EMCXX_EXECUTABLE em++ REQUIRED)
find_program(EMAR_EXECUTABLE emar REQUIRED)
find_program(EMRANLIB_EXECUTABLE emranlib REQUIRED)

# Set compilers
set(CMAKE_C_COMPILER "${EMCC_EXECUTABLE}")
set(CMAKE_CXX_COMPILER "${EMCXX_EXECUTABLE}")
set(CMAKE_AR "${EMAR_EXECUTABLE}")
set(CMAKE_RANLIB "${EMRANLIB_EXECUTABLE}")

# Compiler identification
set(CMAKE_C_COMPILER_ID "Clang")
set(CMAKE_CXX_COMPILER_ID "Clang")
set(CMAKE_C_COMPILER_FRONTEND_VARIANT "GNU")
set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT "GNU")

# Output file suffix
set(CMAKE_EXECUTABLE_SUFFIX ".js")

# ============================================================================
# WASM Memory Configuration
# ============================================================================

# Initial memory: 64MB (specified in bytes)
set(CHDB_WASM_INITIAL_MEMORY "67108864" CACHE STRING "Initial WASM memory in bytes (64MB default)")

# Maximum memory: 128MB (specified in bytes)
set(CHDB_WASM_MAXIMUM_MEMORY "134217728" CACHE STRING "Maximum WASM memory in bytes (128MB default)")

# Allow memory growth
set(CHDB_WASM_ALLOW_MEMORY_GROWTH ON CACHE BOOL "Allow WASM memory to grow at runtime")

# Memory growth settings
set(CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_STEP "0.20" CACHE STRING "Memory growth geometric step (20%)")
set(CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_CAP "96MB" CACHE STRING "Memory growth geometric cap")

# Stack size: 1MB default
set(CHDB_WASM_STACK_SIZE "1048576" CACHE STRING "WASM stack size in bytes (1MB default)")

# Build memory flags
set(CHDB_WASM_MEMORY_FLAGS "")
list(APPEND CHDB_WASM_MEMORY_FLAGS "-sINITIAL_MEMORY=${CHDB_WASM_INITIAL_MEMORY}")
list(APPEND CHDB_WASM_MEMORY_FLAGS "-sMAXIMUM_MEMORY=${CHDB_WASM_MAXIMUM_MEMORY}")
list(APPEND CHDB_WASM_MEMORY_FLAGS "-sSTACK_SIZE=${CHDB_WASM_STACK_SIZE}")

if(CHDB_WASM_ALLOW_MEMORY_GROWTH)
    list(APPEND CHDB_WASM_MEMORY_FLAGS "-sALLOW_MEMORY_GROWTH=1")
    list(APPEND CHDB_WASM_MEMORY_FLAGS "-sMEMORY_GROWTH_GEOMETRIC_STEP=${CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_STEP}")
    list(APPEND CHDB_WASM_MEMORY_FLAGS "-sMEMORY_GROWTH_GEOMETRIC_CAP=${CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_CAP}")
endif()

# ============================================================================
# Exception Handling Configuration
# ============================================================================

# Check for native WASM exception support (requires Emscripten 3.1.0+)
option(CHDB_WASM_NATIVE_EXCEPTIONS "Use native WASM exceptions (requires browser support)" ON)
option(CHDB_WASM_JS_EXCEPTION_FALLBACK "Fallback to JS exceptions if native not supported" ON)

set(CHDB_WASM_EXCEPTION_FLAGS "")

if(CHDB_WASM_NATIVE_EXCEPTIONS)
    # Native WebAssembly Exception Handling
    # Requires: Chrome 95+, Firefox 100+, Safari 15.2+
    list(APPEND CHDB_WASM_EXCEPTION_FLAGS "-fwasm-exceptions")
    list(APPEND CHDB_WASM_EXCEPTION_FLAGS "-sWASM_EXCEPTIONS=1")
    message(STATUS "chdb-wasm: Using native WASM exception handling")

    if(CHDB_WASM_JS_EXCEPTION_FALLBACK)
        # Enable exception catching for interop with JS
        list(APPEND CHDB_WASM_EXCEPTION_FLAGS "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','UTF8ToString','stringToUTF8','lengthBytesUTF8']")
    endif()
else()
    # JavaScript exception handling fallback
    # More compatible but slower
    list(APPEND CHDB_WASM_EXCEPTION_FLAGS "-fexceptions")
    list(APPEND CHDB_WASM_EXCEPTION_FLAGS "-sDISABLE_EXCEPTION_CATCHING=0")
    message(STATUS "chdb-wasm: Using JavaScript exception handling (fallback mode)")
endif()

# ============================================================================
# JavaScript Interop / Export Settings
# ============================================================================

# Modularize output for easier integration
set(CHDB_WASM_MODULARIZE ON CACHE BOOL "Generate modular ES6 output")
set(CHDB_WASM_MODULE_NAME "ChDB" CACHE STRING "Module name for the WASM module")

# Export name for the factory function
set(CHDB_WASM_EXPORT_NAME "createChDB" CACHE STRING "Factory function name")

# Environment targets
set(CHDB_WASM_ENVIRONMENT "web,webview,worker,node" CACHE STRING "Target environments")

# Functions to export to JavaScript
set(CHDB_WASM_EXPORTED_FUNCTIONS
    "_chdb_query"
    "_chdb_query_free"
    "_chdb_connect"
    "_chdb_disconnect"
    "_chdb_create_session"
    "_chdb_destroy_session"
    "_chdb_session_query"
    "_chdb_get_version"
    "_malloc"
    "_free"
    CACHE STRING "Functions to export to JavaScript"
)

# Runtime methods to export
set(CHDB_WASM_EXPORTED_RUNTIME_METHODS
    "ccall"
    "cwrap"
    "getValue"
    "setValue"
    "UTF8ToString"
    "stringToUTF8"
    "lengthBytesUTF8"
    "allocateUTF8"
    "AsciiToString"
    "stringToAscii"
    "addFunction"
    "removeFunction"
    "FS"
    CACHE STRING "Runtime methods to export"
)

# Build export flags
set(CHDB_WASM_EXPORT_FLAGS "")

if(CHDB_WASM_MODULARIZE)
    list(APPEND CHDB_WASM_EXPORT_FLAGS "-sMODULARIZE=1")
    list(APPEND CHDB_WASM_EXPORT_FLAGS "-sEXPORT_NAME='${CHDB_WASM_EXPORT_NAME}'")
    list(APPEND CHDB_WASM_EXPORT_FLAGS "-sEXPORT_ES6=1")
endif()

# Environment configuration
list(APPEND CHDB_WASM_EXPORT_FLAGS "-sENVIRONMENT='${CHDB_WASM_ENVIRONMENT}'")

# Convert lists to comma-separated strings for Emscripten
string(REPLACE ";" "," EXPORTED_FUNCTIONS_STR "${CHDB_WASM_EXPORTED_FUNCTIONS}")
string(REPLACE ";" "," EXPORTED_RUNTIME_STR "${CHDB_WASM_EXPORTED_RUNTIME_METHODS}")

list(APPEND CHDB_WASM_EXPORT_FLAGS "-sEXPORTED_FUNCTIONS='[\"${EXPORTED_FUNCTIONS_STR}\"]'")
list(APPEND CHDB_WASM_EXPORT_FLAGS "-sEXPORTED_RUNTIME_METHODS='[\"${EXPORTED_RUNTIME_STR}\"]'")

# Allow table growth for dynamic function pointers
list(APPEND CHDB_WASM_EXPORT_FLAGS "-sALLOW_TABLE_GROWTH=1")

# ============================================================================
# Filesystem Configuration
# ============================================================================

# Enable virtual filesystem
option(CHDB_WASM_FILESYSTEM "Enable Emscripten virtual filesystem" ON)
option(CHDB_WASM_NODERAWFS "Enable Node.js raw filesystem access" OFF)
option(CHDB_WASM_FORCE_FILESYSTEM "Force filesystem inclusion even if not detected" ON)

set(CHDB_WASM_FS_FLAGS "")

if(CHDB_WASM_FILESYSTEM)
    if(CHDB_WASM_FORCE_FILESYSTEM)
        list(APPEND CHDB_WASM_FS_FLAGS "-sFORCE_FILESYSTEM=1")
    endif()

    if(CHDB_WASM_NODERAWFS)
        list(APPEND CHDB_WASM_FS_FLAGS "-sNODERAWFS=1")
    endif()

    # Include IDBFS for IndexedDB persistence in browsers
    list(APPEND CHDB_WASM_FS_FLAGS "-lIDBFS.js")

    # Include WORKERFS for worker thread file access
    list(APPEND CHDB_WASM_FS_FLAGS "-lWORKERFS.js")
endif()

# ============================================================================
# Threading Configuration
# ============================================================================

# Note: Threading requires SharedArrayBuffer and COOP/COEP headers
option(CHDB_WASM_PTHREADS "Enable pthread support (requires SharedArrayBuffer)" OFF)
set(CHDB_WASM_PTHREAD_POOL_SIZE "4" CACHE STRING "Number of pthread workers in pool")

set(CHDB_WASM_THREAD_FLAGS "")

if(CHDB_WASM_PTHREADS)
    list(APPEND CHDB_WASM_THREAD_FLAGS "-pthread")
    list(APPEND CHDB_WASM_THREAD_FLAGS "-sPTHREAD_POOL_SIZE=${CHDB_WASM_PTHREAD_POOL_SIZE}")
    list(APPEND CHDB_WASM_THREAD_FLAGS "-sPTHREAD_POOL_SIZE_STRICT=0")
    message(STATUS "chdb-wasm: Pthread support enabled with pool size ${CHDB_WASM_PTHREAD_POOL_SIZE}")
endif()

# ============================================================================
# Additional WASM Features
# ============================================================================

# Enable WASM BigInt support for 64-bit integers
set(CHDB_WASM_BIGINT ON CACHE BOOL "Enable BigInt support for 64-bit integers")

# Asyncify for async operations (may increase binary size)
option(CHDB_WASM_ASYNCIFY "Enable Asyncify for async operations" OFF)
set(CHDB_WASM_ASYNCIFY_STACK_SIZE "8192" CACHE STRING "Asyncify stack size")

set(CHDB_WASM_FEATURE_FLAGS "")

if(CHDB_WASM_BIGINT)
    list(APPEND CHDB_WASM_FEATURE_FLAGS "-sWASM_BIGINT=1")
endif()

if(CHDB_WASM_ASYNCIFY)
    list(APPEND CHDB_WASM_FEATURE_FLAGS "-sASYNCIFY=1")
    list(APPEND CHDB_WASM_FEATURE_FLAGS "-sASYNCIFY_STACK_SIZE=${CHDB_WASM_ASYNCIFY_STACK_SIZE}")
    message(STATUS "chdb-wasm: Asyncify enabled with stack size ${CHDB_WASM_ASYNCIFY_STACK_SIZE}")
endif()

# ============================================================================
# Debug/Release Specific Settings
# ============================================================================

# Debug settings
set(CHDB_WASM_DEBUG_FLAGS
    "-gsource-map"
    "-sASSERTIONS=2"
    "-sSAFE_HEAP=1"
    "-sSTACK_OVERFLOW_CHECK=2"
    "-sDEMANGLE_SUPPORT=1"
)

# Release settings (basic - see WasmOptimizations.cmake for full optimization)
set(CHDB_WASM_RELEASE_FLAGS
    "-sASSERTIONS=0"
    "-sMALLOC='emmalloc'"
)

# ============================================================================
# Aggregate All Flags
# ============================================================================

# Combine all linker flags
set(CHDB_WASM_LINKER_FLAGS "")
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_MEMORY_FLAGS})
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_EXCEPTION_FLAGS})
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_EXPORT_FLAGS})
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_FS_FLAGS})
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_THREAD_FLAGS})
list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_FEATURE_FLAGS})

# Apply based on build type
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_DEBUG_FLAGS})
else()
    list(APPEND CHDB_WASM_LINKER_FLAGS ${CHDB_WASM_RELEASE_FLAGS})
endif()

# Convert list to space-separated string
string(REPLACE ";" " " CHDB_WASM_LINKER_FLAGS_STR "${CHDB_WASM_LINKER_FLAGS}")

# Set CMake flags
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${CHDB_WASM_LINKER_FLAGS_STR}")
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} ${CHDB_WASM_LINKER_FLAGS_STR}")

# ============================================================================
# Helper Function to Apply Toolchain to Target
# ============================================================================

function(chdb_apply_wasm_toolchain target)
    # Apply linker flags to target
    target_link_options(${target} PRIVATE ${CHDB_WASM_LINKER_FLAGS})

    # Set output properties
    set_target_properties(${target} PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
    )

    # Generate .wasm alongside .js
    set_target_properties(${target} PROPERTIES
        LINK_FLAGS "-o ${CMAKE_BINARY_DIR}/dist/${target}.js"
    )

    message(STATUS "Applied chdb WASM toolchain to target: ${target}")
endfunction()

# ============================================================================
# Print Configuration Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== chdb-wasm Emscripten Toolchain Configuration ===")
message(STATUS "  Initial Memory:     ${CHDB_WASM_INITIAL_MEMORY} bytes (${CHDB_WASM_INITIAL_MEMORY} / 1048576 = ~64 MB)")
message(STATUS "  Maximum Memory:     ${CHDB_WASM_MAXIMUM_MEMORY} bytes (~128 MB)")
message(STATUS "  Allow Growth:       ${CHDB_WASM_ALLOW_MEMORY_GROWTH}")
message(STATUS "  Stack Size:         ${CHDB_WASM_STACK_SIZE} bytes (~1 MB)")
message(STATUS "  Native Exceptions:  ${CHDB_WASM_NATIVE_EXCEPTIONS}")
message(STATUS "  JS Fallback:        ${CHDB_WASM_JS_EXCEPTION_FALLBACK}")
message(STATUS "  Modularize:         ${CHDB_WASM_MODULARIZE}")
message(STATUS "  Module Name:        ${CHDB_WASM_MODULE_NAME}")
message(STATUS "  Export Name:        ${CHDB_WASM_EXPORT_NAME}")
message(STATUS "  Environment:        ${CHDB_WASM_ENVIRONMENT}")
message(STATUS "  Filesystem:         ${CHDB_WASM_FILESYSTEM}")
message(STATUS "  Pthreads:           ${CHDB_WASM_PTHREADS}")
message(STATUS "  BigInt:             ${CHDB_WASM_BIGINT}")
message(STATUS "  Asyncify:           ${CHDB_WASM_ASYNCIFY}")
message(STATUS "================================================")
message(STATUS "")
