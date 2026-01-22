# wasm-build.cmake
# Comprehensive WASM build configuration for chdb-wasm
#
# This preset combines all necessary settings for building chdb as WebAssembly:
# - WASM architecture and target configuration
# - Minimal feature set (jemalloc, LLVM JIT, external formats disabled)
# - Emscripten-specific compiler/linker flags
# - Single-threaded mode configuration
# - Appropriate memory limits for WASM environments
# - Aggressive size optimizations (DuckDB-inspired)
#
# Usage:
#   cmake -C cmake/wasm-build.cmake -DCMAKE_TOOLCHAIN_FILE=/path/to/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake ..
#   OR
#   cmake -C cmake/wasm-build.cmake ..  (if toolchain is set elsewhere)
#
# Size Optimization Options:
#   -DCHDB_WASM_AGGRESSIVE_SIZE=ON  Enable most aggressive size optimizations
#   -DCHDB_WASM_USE_CLOSURE=ON      Enable Closure Compiler for JS minification
#   -DCHDB_WASM_USE_WASM_OPT=ON     Enable wasm-opt post-processing
#   -DCHDB_WASM_NO_FILESYSTEM=ON    Disable filesystem for pure memory mode

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "  chdb-wasm Complete Build Configuration")
message(STATUS "===============================================================")
message(STATUS "")

# ============================================================================
# WASM Architecture and Target Configuration
# ============================================================================

# Target system configuration
set(CMAKE_SYSTEM_NAME Emscripten CACHE STRING "Target system name" FORCE)
set(CMAKE_SYSTEM_PROCESSOR wasm32 CACHE STRING "Target processor" FORCE)
set(CMAKE_CROSSCOMPILING ON CACHE BOOL "Cross compiling" FORCE)

# Set target triple for WASM
set(TARGET_TRIPLE "wasm32-unknown-emscripten" CACHE STRING "Target triple" FORCE)

# Compiler identification - Emscripten uses Clang
set(CMAKE_C_COMPILER_ID Clang CACHE STRING "C compiler ID" FORCE)
set(CMAKE_CXX_COMPILER_ID Clang CACHE STRING "C++ compiler ID" FORCE)
set(CMAKE_C_COMPILER_FRONTEND_VARIANT GNU CACHE STRING "C compiler frontend" FORCE)
set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT GNU CACHE STRING "C++ compiler frontend" FORCE)

# Set archiver tools for Emscripten
if(DEFINED ENV{EMSDK})
    set(EMSDK_ROOT "$ENV{EMSDK}/upstream/emscripten")
    set(CMAKE_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten archiver" FORCE)
    set(CMAKE_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten ranlib" FORCE)
    set(CMAKE_C_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten C archiver" FORCE)
    set(CMAKE_CXX_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten C++ archiver" FORCE)
    set(CMAKE_C_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten C ranlib" FORCE)
    set(CMAKE_CXX_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten C++ ranlib" FORCE)
    message(STATUS "Emscripten Archiver Tools:")
    message(STATUS "  AR: ${CMAKE_AR}")
    message(STATUS "  RANLIB: ${CMAKE_RANLIB}")
endif()

# Executable suffix for WASM output
set(CMAKE_EXECUTABLE_SUFFIX ".js" CACHE STRING "Executable suffix" FORCE)

message(STATUS "WASM Architecture:")
message(STATUS "  System Name: ${CMAKE_SYSTEM_NAME}")
message(STATUS "  Processor: ${CMAKE_SYSTEM_PROCESSOR}")
message(STATUS "  Target Triple: ${TARGET_TRIPLE}")

# ============================================================================
# Memory Allocator Configuration - Disable jemalloc
# ============================================================================

# CRITICAL: jemalloc is not compatible with WASM/Emscripten
# Use Emscripten's built-in allocator (emmalloc) instead
set(ENABLE_JEMALLOC OFF CACHE BOOL "Disable jemalloc for WASM" FORCE)
set(USE_JEMALLOC OFF CACHE BOOL "Disable jemalloc for WASM" FORCE)
set(ENABLE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc for WASM" FORCE)
set(USE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc for WASM" FORCE)
set(ENABLE_MIMALLOC OFF CACHE BOOL "Disable mimalloc for WASM" FORCE)

message(STATUS "Memory Allocator: emmalloc (WASM-native)")
message(STATUS "  - jemalloc: DISABLED")
message(STATUS "  - tcmalloc: DISABLED")
message(STATUS "  - mimalloc: DISABLED")

# ============================================================================
# LLVM JIT Compilation - Disabled
# ============================================================================

# LLVM JIT is not supported in WASM environments
set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM-based JIT compiler" FORCE)
set(USE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM-based JIT compiler" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF debug parser" FORCE)

message(STATUS "JIT Compilation: DISABLED")
message(STATUS "  - Embedded Compiler (LLVM JIT): OFF")
message(STATUS "  - DWARF Parser: OFF")

# ============================================================================
# External Formats - All Disabled
# ============================================================================

# Heavy serialization formats that require large dependencies
# Core formats like JSON/CSV are available through built-in support
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Apache Parquet format" FORCE)
set(ENABLE_ARROW OFF CACHE BOOL "Disable Apache Arrow format" FORCE)
set(ENABLE_ORC OFF CACHE BOOL "Disable Apache ORC format" FORCE)
set(ENABLE_AVRO OFF CACHE BOOL "Disable Apache Avro format" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers format" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto format" FORCE)
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack format" FORCE)

message(STATUS "External Data Formats: DISABLED")
message(STATUS "  - Parquet: OFF")
message(STATUS "  - Arrow: OFF")
message(STATUS "  - ORC: OFF")
message(STATUS "  - Avro: OFF")
message(STATUS "  - Protobuf: OFF")
message(STATUS "  - Cap'n Proto: OFF")
message(STATUS "  - MessagePack: OFF")

# ============================================================================
# External Integrations - All Disabled
# ============================================================================

# Cloud Storage - CRITICAL SIZE SAVINGS (~1.4+ GB)
# AWS S3 (~944 MB) - both flags needed for complete disable
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3 support" FORCE)
set(ENABLE_S3 OFF CACHE BOOL "Disable S3 support" FORCE)
set(ENABLE_AWS_S3 OFF CACHE INTERNAL "")
set(ENABLE_S3 OFF CACHE INTERNAL "")

# Google Cloud Storage (~369 MB)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE BOOL "Disable Google Cloud KMS" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE INTERNAL "")
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE INTERNAL "")

# Azure Blob Storage (~50-100 MB)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure Blob Storage" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE INTERNAL "")

# HDFS (~20-50 MB)
set(ENABLE_HDFS OFF CACHE BOOL "Disable Hadoop HDFS support" FORCE)
set(ENABLE_HDFS OFF CACHE INTERNAL "")

# Hive (depends on HDFS)
set(ENABLE_HIVE OFF CACHE BOOL "Disable Hive Metastore" FORCE)
set(ENABLE_HIVE OFF CACHE INTERNAL "")

# Database Integrations
set(ENABLE_KAFKA OFF CACHE BOOL "Disable Kafka integration" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra integration" FORCE)
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB integration" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL integration" FORCE)
set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL integration" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ/AMQP integration" FORCE)
set(ENABLE_NATSIO OFF CACHE BOOL "Disable NATS.io integration" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Disable Redis integration" FORCE)
set(ENABLE_ODBC OFF CACHE BOOL "Disable ODBC integration" FORCE)

# Networking
set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC support" FORCE)
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft consensus library" FORCE)
set(ENABLE_SSL OFF CACHE BOOL "Disable SSL support" FORCE)
set(ENABLE_LDAP OFF CACHE BOOL "Disable LDAP support" FORCE)
set(ENABLE_KERBEROS OFF CACHE BOOL "Disable Kerberos support" FORCE)

message(STATUS "External Integrations: DISABLED")
message(STATUS "  Cloud: S3, Azure, GCS, HDFS - OFF")
message(STATUS "  Databases: Kafka, Cassandra, MongoDB, PostgreSQL, MySQL, RabbitMQ, NATS, Redis, ODBC - OFF")
message(STATUS "  Networking: gRPC, NuRaft, SSL, LDAP, Kerberos - OFF")

# ============================================================================
# Miscellaneous Features - Disabled for Minimal WASM Build
# ============================================================================

set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB storage engine" FORCE)
set(ENABLE_S2_GEOMETRY OFF CACHE BOOL "Disable S2 geometry library" FORCE)
set(ENABLE_H3 OFF CACHE BOOL "Disable H3 hexagonal indexing" FORCE)
set(ENABLE_ICU OFF CACHE BOOL "Disable ICU unicode/i18n library" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan regex library" FORCE)
set(ENABLE_HYPERSCAN OFF CACHE BOOL "Disable Hyperscan regex library" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust-based components" FORCE)
set(ENABLE_TESTS OFF CACHE BOOL "Disable test compilation" FORCE)
set(ENABLE_EXAMPLES OFF CACHE BOOL "Disable examples" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "Disable benchmarks" FORCE)
set(ENABLE_UTILS OFF CACHE BOOL "Disable utilities" FORCE)
set(ENABLE_FUZZING OFF CACHE BOOL "Disable fuzzing support" FORCE)
set(ENABLE_THINLTO OFF CACHE BOOL "Disable ThinLTO for WASM" FORCE)

message(STATUS "Miscellaneous Features: DISABLED")
message(STATUS "  - RocksDB, S2 Geometry, H3, ICU, Vectorscan, NLP, Rust: OFF")
message(STATUS "  - Tests, Examples, Benchmarks, Utils, Fuzzing: OFF")

# ============================================================================
# Single-Threaded Mode Configuration
# ============================================================================

# WASM in most environments (browsers, workers) is single-threaded
# SharedArrayBuffer requires special COOP/COEP headers
set(ENABLE_MULTITHREADING OFF CACHE BOOL "Disable multithreading for WASM" FORCE)
set(PARALLEL_COMPILE_JOBS 1 CACHE STRING "Single compile job" FORCE)
set(PARALLEL_LINK_JOBS 1 CACHE STRING "Single link job" FORCE)

# CMake threading configuration
set(THREADS_PREFER_PTHREAD_FLAG OFF CACHE BOOL "Disable pthread preference" FORCE)
set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "No thread libs" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY OFF CACHE BOOL "No threads library" FORCE)
set(CMAKE_USE_WIN32_THREADS_INIT OFF CACHE BOOL "No Win32 threads" FORCE)
set(CMAKE_USE_PTHREADS_INIT OFF CACHE BOOL "No pthreads" FORCE)

message(STATUS "Threading: SINGLE-THREADED")
message(STATUS "  - Multithreading: DISABLED")
message(STATUS "  - pthreads: DISABLED")

# ============================================================================
# WASM Memory Configuration
# ============================================================================

# Memory limits appropriate for WASM environments
# Cloudflare Workers: 128MB limit
# Browsers: varies, but typically 2-4GB addressable
set(CHDB_WASM_INITIAL_MEMORY "67108864" CACHE STRING "Initial WASM memory: 64MB" FORCE)
set(CHDB_WASM_MAXIMUM_MEMORY "134217728" CACHE STRING "Maximum WASM memory: 128MB" FORCE)
set(CHDB_WASM_STACK_SIZE "1048576" CACHE STRING "WASM stack size: 1MB" FORCE)
set(CHDB_WASM_ALLOW_MEMORY_GROWTH ON CACHE BOOL "Allow memory growth" FORCE)

# Memory growth settings for gradual expansion
set(CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_STEP "0.20" CACHE STRING "20% memory growth step" FORCE)
set(CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_CAP "96MB" CACHE STRING "96MB growth cap" FORCE)

message(STATUS "WASM Memory Configuration:")
message(STATUS "  - Initial Memory: 64MB")
message(STATUS "  - Maximum Memory: 128MB")
message(STATUS "  - Stack Size: 1MB")
message(STATUS "  - Allow Growth: ON")
message(STATUS "  - Growth Step: 20%")

# ============================================================================
# Emscripten-Specific Compiler Flags
# ============================================================================

# Size optimization flags
# Note: LTO (-flto) is now enabled by default for maximum size reduction.
# LTO provides 15-25% binary size savings through cross-module optimization.
# If you experience bitcode compatibility issues, disable with: -DCHDB_WASM_ENABLE_LTO=OFF
option(CHDB_WASM_ENABLE_LTO "Enable Link Time Optimization for WASM builds" ON)

set(CHDB_WASM_COMPILE_FLAGS
    "-Oz"                            # Aggressive size optimization
    "-fno-exceptions"                # Disable C++ exceptions
    "-fno-rtti"                      # Disable runtime type information
    "-fno-unwind-tables"             # No unwind tables needed
    "-fno-asynchronous-unwind-tables"
    "-fvisibility=hidden"            # Hide symbols by default
    "-fvisibility-inlines-hidden"    # Hide inline functions
    "-ffunction-sections"            # Enable dead code elimination
    "-fdata-sections"                # Enable unused data elimination
    "-fmerge-all-constants"          # Merge identical constants
    "-fno-math-errno"                # Don't set errno for math functions
    "-fno-signed-zeros"              # Allow optimizations ignoring signed zeros
    "-fno-trapping-math"             # Allow optimizations assuming no traps
)

# Add LTO flag if enabled
if(CHDB_WASM_ENABLE_LTO)
    list(APPEND CHDB_WASM_COMPILE_FLAGS "-flto")
    message(STATUS "LTO: ENABLED (-flto)")
else()
    message(STATUS "LTO: DISABLED")
endif()

# WASM-specific feature flags (for modern browsers)
set(CHDB_WASM_FEATURE_FLAGS
    "-msimd128"                      # Enable SIMD (128-bit)
    "-mbulk-memory"                  # Enable bulk memory operations
    "-mnontrapping-fptoint"          # Non-trapping float-to-int conversions
    "-msign-ext"                     # Sign extension operations
)

# Join flags into strings for CMake
string(REPLACE ";" " " CHDB_WASM_COMPILE_FLAGS_STR "${CHDB_WASM_COMPILE_FLAGS}")
string(REPLACE ";" " " CHDB_WASM_FEATURE_FLAGS_STR "${CHDB_WASM_FEATURE_FLAGS}")

# Set CMake compiler flags
set(CMAKE_C_FLAGS_INIT "${CHDB_WASM_COMPILE_FLAGS_STR} ${CHDB_WASM_FEATURE_FLAGS_STR}" CACHE STRING "C flags" FORCE)
set(CMAKE_CXX_FLAGS_INIT "${CHDB_WASM_COMPILE_FLAGS_STR} ${CHDB_WASM_FEATURE_FLAGS_STR}" CACHE STRING "C++ flags" FORCE)

# Release flags
set(CMAKE_C_FLAGS_RELEASE "-DNDEBUG" CACHE STRING "C Release flags" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "-DNDEBUG" CACHE STRING "C++ Release flags" FORCE)

# Debug flags (less optimization for debugging)
set(CMAKE_C_FLAGS_DEBUG "-O0 -g3 -gsource-map" CACHE STRING "C Debug flags" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g3 -gsource-map" CACHE STRING "C++ Debug flags" FORCE)

message(STATUS "Compiler Flags:")
message(STATUS "  - Optimization: -Oz (size)")
message(STATUS "  - LTO: enabled")
message(STATUS "  - Exceptions: disabled")
message(STATUS "  - RTTI: disabled")
message(STATUS "  - SIMD: enabled (128-bit)")
message(STATUS "  - Bulk Memory: enabled")

# ============================================================================
# Emscripten-Specific Linker Flags
# ============================================================================

# Memory flags
set(CHDB_WASM_MEMORY_LINK_FLAGS
    "-sINITIAL_MEMORY=${CHDB_WASM_INITIAL_MEMORY}"
    "-sMAXIMUM_MEMORY=${CHDB_WASM_MAXIMUM_MEMORY}"
    "-sSTACK_SIZE=${CHDB_WASM_STACK_SIZE}"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMEMORY_GROWTH_GEOMETRIC_STEP=${CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_STEP}"
    "-sMEMORY_GROWTH_GEOMETRIC_CAP=${CHDB_WASM_MEMORY_GROWTH_GEOMETRIC_CAP}"
)

# Output configuration
set(CHDB_WASM_OUTPUT_FLAGS
    "-sWASM=1"                       # Output WebAssembly
    "-sWASM_BIGINT=1"                # Use BigInt for i64
    "-sMODULARIZE=1"                 # Create ES module
    "-sEXPORT_ES6=1"                 # Export as ES6 module
    "-sEXPORT_NAME='createChDB'"     # Factory function name
    "-sENVIRONMENT='web,worker'"     # Target environments
    "-sSINGLE_FILE=0"                # Keep WASM separate for caching
)

# Export configuration
# These are the required chdb C API functions for WASM export
set(CHDB_WASM_EXPORT_FLAGS
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_chdb_query','_chdb_query_v2','_chdb_create','_chdb_destroy','_chdb_get_version','_chdb_get_memory_stats','_chdb_clear_cache','_chdb_embedded_server_initialized','_chdb_wasm_init','_chdb_wasm_shutdown','_chdb_wasm_query','_chdb_wasm_result_free','_chdb_wasm_result_buffer','_chdb_wasm_result_length','_chdb_wasm_result_error']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','getValue','setValue','FS']"
    "-sALLOW_TABLE_GROWTH=1"
)

# Runtime configuration
set(CHDB_WASM_RUNTIME_FLAGS
    "-sNO_EXIT_RUNTIME=1"            # Don't exit after main()
    "-sABORTING_MALLOC=0"            # Return null on malloc failure
    "-sSUPPORT_LONGJMP=0"            # Disable longjmp (not needed)
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching
)

# Optimization link flags
# Note: --gc-sections is NOT supported by wasm-ld (emscripten linker)
# Dead code elimination is handled by -Oz and -sELIMINATE_DUPLICATE_FUNCTIONS instead
set(CHDB_WASM_OPT_LINK_FLAGS
    "-Oz"                            # Size optimization
    "--closure=1"                    # Closure compiler for JS
    "-sASSERTIONS=0"                 # Disable assertions
    "-sEVAL_CTORS=1"                 # Evaluate constructors at compile time
    "-sMALLOC=emmalloc"              # Use emmalloc (smaller, single-threaded)
    "-sELIMINATE_DUPLICATE_FUNCTIONS=1"  # Remove duplicate functions
)

# Add LTO to linker flags if enabled
if(CHDB_WASM_ENABLE_LTO)
    list(APPEND CHDB_WASM_OPT_LINK_FLAGS "-flto")
endif()

# Minimal filesystem (needed for data handling)
set(CHDB_WASM_FS_FLAGS
    "-sNO_FILESYSTEM=0"              # We need basic filesystem
    "-sFORCE_FILESYSTEM=0"           # Don't force full filesystem
)

# Combine all linker flags
set(CHDB_WASM_LINK_FLAGS
    ${CHDB_WASM_MEMORY_LINK_FLAGS}
    ${CHDB_WASM_OUTPUT_FLAGS}
    ${CHDB_WASM_EXPORT_FLAGS}
    ${CHDB_WASM_RUNTIME_FLAGS}
    ${CHDB_WASM_OPT_LINK_FLAGS}
    ${CHDB_WASM_FS_FLAGS}
)

string(REPLACE ";" " " CHDB_WASM_LINK_FLAGS_STR "${CHDB_WASM_LINK_FLAGS}")

# Set CMake linker flags
set(CMAKE_EXE_LINKER_FLAGS_INIT "${CHDB_WASM_LINK_FLAGS_STR}" CACHE STRING "Exe linker flags" FORCE)
set(CMAKE_SHARED_LINKER_FLAGS_INIT "${CHDB_WASM_LINK_FLAGS_STR}" CACHE STRING "Shared linker flags" FORCE)

message(STATUS "Linker Flags:")
message(STATUS "  - Closure Compiler: enabled")
message(STATUS "  - Assertions: disabled")
message(STATUS "  - Exception Catching: disabled")
message(STATUS "  - Allocator: emmalloc")

# ============================================================================
# Build Type Configuration
# ============================================================================

# Default to Release for production WASM builds
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

# Disable IPO (interprocedural optimization) to avoid CMAKE_CXX_COMPILER_AR issues
# We use explicit -flto flag instead, which works better with Emscripten
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "Disable IPO for WASM" FORCE)
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE OFF CACHE BOOL "Disable IPO for WASM Release" FORCE)

message(STATUS "Build Configuration:")
message(STATUS "  - Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  - LTO: enabled")

# ============================================================================
# CMake Find Root Path Configuration
# ============================================================================

# Cross-compilation settings
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER CACHE STRING "Don't search for host programs" FORCE)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY CACHE STRING "Only search target libraries" FORCE)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY CACHE STRING "Only search target includes" FORCE)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY CACHE STRING "Only search target packages" FORCE)

# ============================================================================
# Include Minimal Feature Configuration
# ============================================================================

# Include the minimal flags configuration for additional feature disabling
include(${CMAKE_CURRENT_LIST_DIR}/wasm-minimal.cmake OPTIONAL)

# Include minimal storage engine configuration (Memory, Null, View, Values only)
include(${CMAKE_CURRENT_LIST_DIR}/wasm-storage-minimal.cmake OPTIONAL)

# Include aggressive optimizations for maximum size reduction
include(${CMAKE_CURRENT_LIST_DIR}/wasm-aggressive-optimizations.cmake OPTIONAL)

# ============================================================================
# Helper Function: Apply WASM Settings to Target
# ============================================================================

function(chdb_apply_wasm_build_settings target)
    message(STATUS "Applying WASM build settings to target: ${target}")

    # Apply compile flags
    target_compile_options(${target} PRIVATE
        ${CHDB_WASM_COMPILE_FLAGS}
        ${CHDB_WASM_FEATURE_FLAGS}
    )

    # Apply compile definitions
    target_compile_definitions(${target} PRIVATE
        CHDB_WASM=1
        CHDB_SINGLE_THREADED=1
        NDEBUG
    )

    # Apply linker flags
    target_link_options(${target} PRIVATE
        ${CHDB_WASM_LINK_FLAGS}
    )

    # Set output properties
    set_target_properties(${target} PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
    )
endfunction()

# ============================================================================
# Configuration Summary
# ============================================================================

message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "  chdb-wasm Build Configuration Summary")
message(STATUS "===============================================================")
message(STATUS "")
message(STATUS "Architecture:")
message(STATUS "  Target:          wasm32-unknown-emscripten")
message(STATUS "  Threading:       Single-threaded")
message(STATUS "")
message(STATUS "Memory:")
message(STATUS "  Initial:         64MB")
message(STATUS "  Maximum:         128MB")
message(STATUS "  Stack:           1MB")
message(STATUS "  Growth:          Enabled (20% step)")
message(STATUS "")
message(STATUS "Disabled Features:")
message(STATUS "  - jemalloc (using emmalloc)")
message(STATUS "  - LLVM JIT Compiler")
message(STATUS "  - External Formats (Parquet, Arrow, ORC)")
message(STATUS "  - External Integrations (S3, Kafka, MySQL, etc.)")
message(STATUS "  - Multithreading/pthreads")
message(STATUS "")
message(STATUS "Optimizations:")
message(STATUS "  Size:            -Oz (aggressive)")
message(STATUS "  LTO:             Enabled")
message(STATUS "  Closure:         Enabled")
message(STATUS "  SIMD:            Enabled (128-bit)")
message(STATUS "")
message(STATUS "Output:")
message(STATUS "  Module:          ES6 (modularized)")
message(STATUS "  Environment:     web,worker")
message(STATUS "")
message(STATUS "===============================================================")
message(STATUS "")
