# wasm-minimal-correct.cmake
# Ultra-Minimal WASM Build Configuration using CORRECT ClickHouse CMake Flags
#
# This configuration file uses the REAL CMake options defined in ClickHouse's
# build system, verified against the actual CMakeLists.txt files in vendor/chdb.
#
# Key mechanisms:
#   - ENABLE_LIBRARIES=OFF: Master switch that disables all external libraries by default
#   - Individual ENABLE_* flags for fine-grained control
#   - Emscripten-specific compile and link flags for WASM output
#
# Usage:
#   cmake -C cmake/wasm-minimal-correct.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
#         ../vendor/chdb
#
# Target: <15MB uncompressed WASM, <5MB gzipped (Cloudflare Workers compatible)

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Emscripten Archiver Tools for LTO Support
# ============================================================================
# Critical: These settings ensure CMake uses Emscripten's emar/emranlib
# instead of system tools when LTO is enabled. This fixes the issue where
# CMAKE_INTERPROCEDURAL_OPTIMIZATION causes CMake to use system llvm-ar.
# Reference: https://github.com/emscripten-core/emscripten/issues/11143

if(DEFINED ENV{EMSDK})
    set(EMSDK_ROOT "$ENV{EMSDK}/upstream/emscripten")
    set(CMAKE_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "Emscripten archiver" FORCE)
    set(CMAKE_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "Emscripten ranlib" FORCE)
    set(CMAKE_C_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "C archiver for LTO" FORCE)
    set(CMAKE_CXX_COMPILER_AR "${EMSDK_ROOT}/emar" CACHE FILEPATH "C++ archiver for LTO" FORCE)
    set(CMAKE_C_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "C ranlib for LTO" FORCE)
    set(CMAKE_CXX_COMPILER_RANLIB "${EMSDK_ROOT}/emranlib" CACHE FILEPATH "C++ ranlib for LTO" FORCE)
    message(STATUS "[LTO] Emscripten archiver tools configured for LTO support")
endif()

# Disable CMAKE_INTERPROCEDURAL_OPTIMIZATION - we use explicit -flto flags instead
# This avoids CMake toolchain detection issues with Emscripten
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "Using explicit -flto" FORCE)
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE OFF CACHE BOOL "Using explicit -flto" FORCE)

# ============================================================================
# Threads Stub Variables for WASM (No Real Threading Support)
# ============================================================================
# abseil-cpp and xz link to Threads::Threads which doesn't exist in WASM.
# The actual Threads::Threads target is created in the main CMakeLists.txt
# when EMSCRIPTEN or ARCH_WASM is detected. Here we just set the cache variables.

set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "")
set(CMAKE_HAVE_THREADS_LIBRARY 1 CACHE BOOL "")
set(CMAKE_USE_WIN32_THREADS_INIT 0 CACHE BOOL "")
set(CMAKE_USE_PTHREADS_INIT 0 CACHE BOOL "")
set(Threads_FOUND TRUE CACHE BOOL "")

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  Ultra-Minimal WASM Build - Using Correct ClickHouse CMake Flags")
message(STATUS "  Target: <15MB uncompressed, <5MB gzipped")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# MASTER SWITCH: Disable All External Libraries
# ============================================================================
# This is the PRIMARY mechanism in ClickHouse for disabling optional features.
# Located in vendor/chdb/CMakeLists.txt line 413:
#   option(ENABLE_LIBRARIES "Enable all external libraries by default" ON)
#
# When OFF, all libraries that use ${ENABLE_LIBRARIES} as their default
# will be disabled unless explicitly enabled.

set(ENABLE_LIBRARIES OFF CACHE BOOL "Disable all external libraries by default" FORCE)

message(STATUS "[MASTER] ENABLE_LIBRARIES=OFF (disables all optional libraries)")

# ============================================================================
# Cloud Storage - DISABLED
# ============================================================================
# These are the largest contributors to binary size.
# AWS S3 alone can add ~10+ MB of compiled code with its dependencies.

# AWS S3 - From vendor/chdb/contrib/aws-cmake/CMakeLists.txt
# option(ENABLE_AWS_S3 "Enable AWS S3" ${ENABLE_AWS_S3_DEFAULT})
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3 support" FORCE)

# Google Cloud Storage - From vendor/chdb/contrib/CMakeLists.txt line 257
# option(ENABLE_GOOGLE_CLOUD_CPP "Enable Google Cloud Cpp" ${ENABLE_GOOGLE_CLOUD_CPP_DEFAULT})
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)

# Azure Blob Storage - Uses ENABLE_LIBRARIES default
# (No explicit option, controlled by cmake target conditionals)

# HDFS - From vendor/chdb/contrib/libhdfs3-cmake/CMakeLists.txt
# option(ENABLE_HDFS "Enable HDFS" ${ENABLE_LIBRARIES})
set(ENABLE_HDFS OFF CACHE BOOL "Disable Hadoop HDFS support" FORCE)

message(STATUS "[Storage] Cloud integrations DISABLED (S3, GCS, Azure, HDFS)")

# ============================================================================
# Data Formats - Heavy Formats DISABLED
# ============================================================================
# Parquet/Arrow/ORC add significant binary size due to their dependencies.

# Parquet - From vendor/chdb/contrib/arrow-cmake/CMakeLists.txt line 20
# option (ENABLE_PARQUET "Enable parquet" ${ENABLE_PARQUET_DEFAULT})
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Apache Parquet format" FORCE)

# Avro - From vendor/chdb/contrib/avro-cmake/CMakeLists.txt line 2
# option (ENABLE_AVRO "Enable Avro" ${ENABLE_LIBRARIES})
set(ENABLE_AVRO OFF CACHE BOOL "Disable Apache Avro format" FORCE)

# Protocol Buffers - From vendor/chdb/contrib/google-protobuf-cmake/CMakeLists.txt
# option(ENABLE_PROTOBUF "Enable protobuf" ${ENABLE_LIBRARIES})
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers" FORCE)

# Cap'n Proto - From vendor/chdb/contrib/capnproto-cmake/CMakeLists.txt
# option (ENABLE_CAPNP "Enable Cap'n Proto" ${ENABLE_LIBRARIES})
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto format" FORCE)

# MessagePack - From vendor/chdb/contrib/msgpack-c-cmake/CMakeLists.txt
# option (ENABLE_MSGPACK "Enable msgpack library" ${ENABLE_LIBRARIES})
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack format" FORCE)

message(STATUS "[Formats] Heavy formats DISABLED (Parquet, Avro, Protobuf, Cap'n Proto)")

# ============================================================================
# Database Integrations - ALL DISABLED
# ============================================================================
# External database connectors are not applicable for WASM execution.

# MySQL - From vendor/chdb/contrib/mariadb-connector-c-cmake/CMakeLists.txt
# option(ENABLE_MYSQL "Enable MySQL" ${ENABLE_LIBRARIES})
set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL integration" FORCE)

# PostgreSQL - From vendor/chdb/contrib/CMakeLists.txt line 156
# option(ENABLE_LIBPQXX "Enable PostgreSQL" ${ENABLE_LIBRARIES})
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL integration" FORCE)

# MongoDB - From vendor/chdb/contrib/CMakeLists.txt line 170
# option(USE_MONGODB "Enable MongoDB support" ${ENABLE_LIBRARIES})
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB integration" FORCE)

# Kafka - From vendor/chdb/contrib/librdkafka-cmake/CMakeLists.txt
# option (ENABLE_KAFKA "Enable kafka" ${ENABLE_LIBRARIES})
set(ENABLE_KAFKA OFF CACHE BOOL "Disable Kafka integration" FORCE)

# Cassandra - Uses ENABLE_LIBRARIES default
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra integration" FORCE)

# RabbitMQ/AMQP - From vendor/chdb/contrib/amqpcpp-cmake/CMakeLists.txt
# option(ENABLE_AMQPCPP "Enable AMQP-CPP" ${ENABLE_LIBRARIES})
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ/AMQP integration" FORCE)

# NATS.io - Uses ENABLE_LIBRARIES default
set(ENABLE_NATSIO OFF CACHE BOOL "Disable NATS.io integration" FORCE)

# SQLite - From vendor/chdb/contrib/sqlite-cmake/CMakeLists.txt
# option(ENABLE_SQLITE "Enable sqlite" ${ENABLE_LIBRARIES})
set(ENABLE_SQLITE OFF CACHE BOOL "Disable SQLite integration" FORCE)

# RocksDB - From vendor/chdb/contrib/rocksdb-cmake/CMakeLists.txt
# option (ENABLE_ROCKSDB "Enable RocksDB" ${ENABLE_LIBRARIES})
set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB storage engine" FORCE)

message(STATUS "[Databases] External integrations DISABLED (MySQL, PostgreSQL, MongoDB, Kafka, etc.)")

# ============================================================================
# Networking & RPC - DISABLED
# ============================================================================
# Not applicable for client-side WASM execution.

# gRPC - From vendor/chdb/contrib/grpc-cmake/CMakeLists.txt
# option(ENABLE_GRPC "Use gRPC" ${ENABLE_GRPC_DEFAULT})
set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC support" FORCE)

# NuRaft (consensus) - Uses ENABLE_LIBRARIES default
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft consensus library" FORCE)

message(STATUS "[Networking] gRPC and consensus DISABLED")

# ============================================================================
# Heavy Compute Features - DISABLED
# ============================================================================
# JIT compilation and debug parsing are not supported in WASM.

# Embedded Compiler (LLVM JIT) - From vendor/chdb/contrib/llvm-project-cmake/CMakeLists.txt line 11
# option (ENABLE_EMBEDDED_COMPILER "Enable support for JIT compilation..." ${ENABLE_EMBEDDED_COMPILER_DEFAULT})
set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM-based JIT compiler" FORCE)

# DWARF Parser - From vendor/chdb/contrib/llvm-project-cmake/CMakeLists.txt line 13
# option (ENABLE_DWARF_PARSER "Enable support for DWARF input format..." ${ENABLE_DWARF_PARSER_DEFAULT})
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF debug symbol parser" FORCE)

# BLAKE3 (uses LLVM) - From vendor/chdb/contrib/llvm-project-cmake/CMakeLists.txt line 15
# option (ENABLE_BLAKE3 "Enable BLAKE3 function" ${ENABLE_LIBRARIES})
set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3 hash function" FORCE)

message(STATUS "[Compute] JIT and DWARF parsing DISABLED")

# ============================================================================
# Specialized Libraries - DISABLED
# ============================================================================
# These add features not essential for basic SQL operations.

# ICU (Unicode/i18n) - From vendor/chdb/contrib/icu-cmake/CMakeLists.txt
# option(ENABLE_ICU "Enable ICU" ${ENABLE_LIBRARIES})
set(ENABLE_ICU OFF CACHE BOOL "Disable ICU unicode/i18n library" FORCE)

# NLP Functions - From vendor/chdb/contrib/CMakeLists.txt line 176
# option(ENABLE_NLP "Enable NLP functions support" ${ENABLE_LIBRARIES})
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions (stemming, lemmatization)" FORCE)

# USearch (Vector Search) - From vendor/chdb/contrib/CMakeLists.txt line 227
# option(ENABLE_USEARCH "Enable USearch" ${ENABLE_LIBRARIES})
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch vector similarity search" FORCE)

# Vectorscan (Regex) - From vendor/chdb/contrib/vectorscan-cmake/CMakeLists.txt line 3
# option (ENABLE_VECTORSCAN "Enable vectorscan" ${ENABLE_LIBRARIES})
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan regex library" FORCE)

# H3 (Geospatial) - From vendor/chdb/contrib/h3-cmake/CMakeLists.txt
# option (ENABLE_H3 "Enable H3" ${ENABLE_LIBRARIES})
set(ENABLE_H3 OFF CACHE BOOL "Disable H3 hexagonal geospatial indexing" FORCE)

# S2 Geometry - From vendor/chdb/contrib/s2geometry-cmake/CMakeLists.txt
# option(ENABLE_S2_GEOMETRY "Enable S2 Geometry" ${ENABLE_LIBRARIES})
set(ENABLE_S2_GEOMETRY OFF CACHE BOOL "Disable S2 geometry library" FORCE)

# DataSketches - From vendor/chdb/contrib/datasketches-cpp-cmake/CMakeLists.txt
# option (ENABLE_DATASKETCHES "Enable DataSketches" ${ENABLE_LIBRARIES})
set(ENABLE_DATASKETCHES OFF CACHE BOOL "Disable DataSketches probabilistic data structures" FORCE)

# Rust Components - From vendor/chdb/contrib/corrosion-cmake/CMakeLists.txt line 65
# option(ENABLE_RUST "Enable rust" ${DEFAULT_ENABLE_RUST})
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust-based components" FORCE)

# FastPFOR - From vendor/chdb/contrib/CMakeLists.txt line 274
# option(ENABLE_FASTPFOR "Enable FastPFOR" ${ENABLE_LIBRARIES})
set(ENABLE_FASTPFOR OFF CACHE BOOL "Disable FastPFOR integer compression" FORCE)

# Sqids - From vendor/chdb/contrib/sqids-cpp-cmake/CMakeLists.txt
# option(ENABLE_SQIDS "Enable sqids support" ${ENABLE_LIBRARIES})
set(ENABLE_SQIDS OFF CACHE BOOL "Disable Sqids ID encoding" FORCE)

# ANTLR4 (Parser) - From vendor/chdb/contrib/antlr4-cpp-runtime-cmake/CMakeLists.txt
# option(ENABLE_ANTLR4_CPP_RUNTIME "Use ANTLR4 C++ runtime" ${ENABLE_ANTLR4_CPP_RUNTIME_DEFAULT})
set(ENABLE_ANTLR4_CPP_RUNTIME OFF CACHE BOOL "Disable ANTLR4 parser runtime" FORCE)
set(ENABLE_ANTLR4_GRAMMARS OFF CACHE BOOL "Disable ANTLR4 grammars" FORCE)

# Prometheus - From vendor/chdb/contrib/prometheus-protobufs-cmake/CMakeLists.txt
# option(ENABLE_PROMETHEUS_PROTOBUFS "Enable Prometheus Protobufs" ${ENABLE_PROTOBUF})
set(ENABLE_PROMETHEUS_PROTOBUFS OFF CACHE BOOL "Disable Prometheus protobufs" FORCE)

message(STATUS "[Libraries] Specialized libs DISABLED (ICU, NLP, USearch, Geo, etc.)")

# ============================================================================
# Memory Allocator - System/emmalloc for WASM
# ============================================================================
# jemalloc and tcmalloc are not compatible with WASM.

set(ENABLE_JEMALLOC OFF CACHE BOOL "Disable jemalloc (not WASM compatible)" FORCE)
set(USE_JEMALLOC OFF CACHE BOOL "Disable jemalloc" FORCE)
set(ENABLE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc (not WASM compatible)" FORCE)
set(USE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc" FORCE)

message(STATUS "[Allocator] Using system/emmalloc (jemalloc/tcmalloc disabled)")

# ============================================================================
# Development/Testing - DISABLED for Production Build
# ============================================================================

# Tests - From vendor/chdb/CMakeLists.txt line 179
# option(ENABLE_TESTS "Provide unit_test_dbms target with Google.Test unit tests" ON)
set(ENABLE_TESTS OFF CACHE BOOL "Disable test compilation" FORCE)

# Examples - From vendor/chdb/CMakeLists.txt line 180
# option(ENABLE_EXAMPLES "Build all example programs" OFF)
set(ENABLE_EXAMPLES OFF CACHE BOOL "Disable example programs" FORCE)

# Benchmarks - From vendor/chdb/CMakeLists.txt line 181
# option(ENABLE_BENCHMARKS "Build all benchmark programs" OFF)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "Disable benchmark programs" FORCE)

# Fuzzing
set(ENABLE_FUZZING OFF CACHE BOOL "Disable fuzzing support" FORCE)

# Fault Injection Unit (testing/debug feature)
set(ENABLE_FIU OFF CACHE BOOL "Disable fault injection unit" FORCE)

message(STATUS "[Dev] Tests, examples, benchmarks, FIU DISABLED")

# ============================================================================
# Size Optimization - Additional Flags for WASM
# ============================================================================

# Disable multi-target code generation (generates SIMD versions for multiple CPUs)
# For WASM, we only need one target (WASM SIMD)
set(ENABLE_MULTITARGET_CODE OFF CACHE BOOL "Disable multi-target code (only WASM target needed)" FORCE)

# Use minimal SQL functions (whitelisted set of essential functions only)
# This dramatically reduces binary size by excluding hundreds of specialized functions
set(CHDB_MINIMAL_FUNCTIONS ON CACHE BOOL "Build with minimal SQL functions" FORCE)

message(STATUS "[Size] Multi-target code OFF, Minimal functions ON")

# ============================================================================
# WASM/Emscripten-Specific Build Settings
# ============================================================================

# Disable -Werror for WASM builds (Emscripten's clang has stricter warnings)
# Thread Safety Analysis attributes don't work properly with std::mutex in WASM
set(WERROR OFF CACHE BOOL "Disable -Werror for WASM build" FORCE)

message(STATUS "[WASM] -Werror disabled (Emscripten has stricter warnings)")

# Build type for size optimization - FORCE MinSizeRel regardless of existing value
# This ensures -Oz is used consistently
set(CMAKE_BUILD_TYPE "MinSizeRel" CACHE STRING "Build type" FORCE)

# Override the MinSizeRel flags to use -Oz (maximum size optimization) instead of -Os
# Emscripten's -Oz is more aggressive than -Os for WASM output
# NOTE: Keep exceptions enabled - boost and replxx require them
set(CMAKE_C_FLAGS_MINSIZEREL "-Oz -DNDEBUG -ffunction-sections -fdata-sections -flto" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Oz -DNDEBUG -ffunction-sections -fdata-sections -flto" CACHE STRING "" FORCE)

# Linker flags for MinSizeRel - critical for size reduction
# Note: Emscripten settings use -s prefix (e.g., -sWASM=1)
# ASSERTIONS=0 removes runtime checks, LTO handles dead code elimination
# Note: --gc-sections doesn't work with emcc, LTO handles this instead
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL "-Oz -flto -sASSERTIONS=0" CACHE STRING "" FORCE)

# LTO Configuration
# LTO (Link Time Optimization) provides 15-25% size reduction through:
#   - Cross-module dead code elimination
#   - Cross-module function inlining
#   - Whole-program optimization
# Disable with: -DCHDB_WASM_ENABLE_LTO=OFF if you encounter bitcode issues
option(CHDB_WASM_ENABLE_LTO "Enable Link Time Optimization" ON)

# Compile flags for WASM (applied when using Emscripten toolchain)
set(CHDB_WASM_COMPILE_FLAGS
    "-Oz"                            # Maximum size optimization
    "-fno-exceptions"                # No C++ exceptions (reduces size)
    "-fno-rtti"                      # No runtime type info (reduces size)
    "-ffunction-sections"            # Enable dead code elimination
    "-fdata-sections"                # Enable dead data elimination
    "-fvisibility=hidden"            # Hide symbols by default
    "-fmerge-all-constants"          # Merge identical constants
    "-DNDEBUG"                       # Release mode
    "-Wno-c++11-narrowing"           # Allow narrowing (32-bit WASM vs 64-bit offsets)
    "-Wno-error"                     # Don't treat warnings as errors
)

# Add LTO flag if enabled (must be in both compile AND link flags)
if(CHDB_WASM_ENABLE_LTO)
    list(APPEND CHDB_WASM_COMPILE_FLAGS "-flto")
    message(STATUS "[LTO] Link Time Optimization ENABLED (-flto)")
else()
    message(STATUS "[LTO] Link Time Optimization DISABLED")
endif()

# WASM feature flags (compatible with all modern browsers)
set(CHDB_WASM_FEATURE_FLAGS
    "-msimd128"                      # WASM SIMD
    "-mbulk-memory"                  # Bulk memory operations
    "-mnontrapping-fptoint"          # Non-trapping float-to-int
    "-msign-ext"                     # Sign extension operations
)

# Linker flags for minimal WASM output
# Note: --gc-sections is NOT supported by wasm-ld (emscripten linker)
# Dead code elimination is handled by -Oz and -flto instead
set(CHDB_WASM_LINK_FLAGS
    "-Oz"                            # Size optimization in linking
    "-sWASM=1"                       # Output WASM
    "-sASSERTIONS=0"                 # No runtime assertions
    "-sMALLOC=emmalloc"              # Smallest allocator
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching
    "-sNO_EXIT_RUNTIME=1"            # Don't exit runtime
    "-sALLOW_MEMORY_GROWTH=1"        # Allow memory to grow
    "-sFILESYSTEM=0"                 # No filesystem (pure memory)
    "-sMODULARIZE=1"                 # ES6 module output
    "-sEXPORT_ES6=1"                 # Export as ES6
    "-sENVIRONMENT='web,worker'"     # Target web and workers
    "-sSTRICT=1"                     # Strict mode (removes legacy compatibility)
)

# Add LTO to linker flags if enabled (required for LTO to work properly)
if(CHDB_WASM_ENABLE_LTO)
    list(APPEND CHDB_WASM_LINK_FLAGS "-flto")
endif()

# ============================================================================
# WASM Stubs for Missing POSIX Functions
# ============================================================================
# WASM doesn't support all POSIX functions. We provide stubs for:
# - sched_get_priority_min/max (thread scheduling)
# - pthread_setschedparam (thread scheduling)
# - posix_spawnp (process spawning)
get_filename_component(_WASM_STUBS_FILE "${CMAKE_CURRENT_LIST_DIR}/wasm-stubs.cpp" ABSOLUTE)
if(EXISTS "${_WASM_STUBS_FILE}")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${_WASM_STUBS_FILE}" CACHE STRING "" FORCE)
    message(STATUS "[WASM] Added POSIX function stubs: ${_WASM_STUBS_FILE}")
else()
    message(WARNING "[WASM] Stubs file not found: ${_WASM_STUBS_FILE}")
endif()

message(STATUS "[WASM] Emscripten flags configured for minimal output")

# ============================================================================
# WASM-Specific Compile Definitions (Global)
# ============================================================================
# These definitions are applied globally to fix platform-specific issues

# Disable Linux-specific headers in Poco
add_compile_definitions(POCO_NO_LINUX_IF_PACKET_H=1)
add_compile_definitions(POCO_NO_INOTIFY=1)

message(STATUS "[WASM] POCO Linux-specific features disabled")

# Global compile flags for WASM - suppress narrowing errors (32-bit WASM vs 64-bit offsets)
# Using cache variables since add_compile_options doesn't work in -C files
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-c++11-narrowing -Wno-error" CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-c++11-narrowing -Wno-error" CACHE STRING "" FORCE)

message(STATUS "[WASM] Narrowing conversion warnings suppressed for 32-bit WASM")

# ============================================================================
# Function to Apply Settings to a Target
# ============================================================================

function(chdb_apply_wasm_minimal_settings TARGET)
    message(STATUS "Applying WASM minimal settings to target: ${TARGET}")

    # Only apply if using Emscripten
    if(EMSCRIPTEN)
        target_compile_options(${TARGET} PRIVATE
            ${CHDB_WASM_COMPILE_FLAGS}
            ${CHDB_WASM_FEATURE_FLAGS}
        )

        target_compile_definitions(${TARGET} PRIVATE
            CHDB_WASM=1
            CHDB_MINIMAL=1
            NDEBUG=1
            POCO_NO_LINUX_IF_PACKET_H=1     # Disable Linux-specific network headers
            POCO_NO_INOTIFY=1               # Disable inotify (Linux-specific)
        )

        target_link_options(${TARGET} PRIVATE
            ${CHDB_WASM_LINK_FLAGS}
        )
    endif()
endfunction()

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  WASM Minimal Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "DISABLED Components:")
message(STATUS "  Cloud Storage:     S3, GCS, Azure, HDFS")
message(STATUS "  Heavy Formats:     Parquet, Avro, Protobuf, Cap'n Proto")
message(STATUS "  Databases:         MySQL, PostgreSQL, MongoDB, Kafka, etc.")
message(STATUS "  Networking:        gRPC, NuRaft")
message(STATUS "  Heavy Compute:     LLVM JIT, DWARF Parser")
message(STATUS "  Specialized:       ICU, NLP, USearch, H3, S2, Vectorscan")
message(STATUS "  Development:       Tests, Examples, Benchmarks, FIU")
message(STATUS "")
message(STATUS "SIZE OPTIMIZATIONS:")
message(STATUS "  Multi-target Code: OFF (WASM only needs single target)")
message(STATUS "  Minimal Functions: ON (whitelisted essential functions)")
message(STATUS "  Build Type:        MinSizeRel (-Oz)")
if(CHDB_WASM_ENABLE_LTO)
    message(STATUS "  LTO:               ENABLED (-flto, 15-25% size reduction)")
else()
    message(STATUS "  LTO:               DISABLED (enable with -DCHDB_WASM_ENABLE_LTO=ON)")
endif()
message(STATUS "")
message(STATUS "ENABLED (via ClickHouse core):")
message(STATUS "  SQL Engine:        Full SQL parser and executor")
message(STATUS "  Storage:           Memory table engine")
message(STATUS "  Formats:           JSON, CSV, TSV (built-in)")
message(STATUS "  Functions:         Core SQL functions")
message(STATUS "  Compression:       LZ4 (lightweight)")
message(STATUS "")
message(STATUS "POST-PROCESSING (recommended):")
message(STATUS "  Run: wasm-opt -Oz --strip-debug --strip-dwarf --strip-producers <input>.wasm -o <output>.wasm")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
