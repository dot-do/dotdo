# full.cmake
# Full WASM Build Profile (chdb-full.wasm)
#
# Target: ~25MB+
# Use case: Maximum ClickHouse compatibility
#
# This profile includes everything possible for WASM, providing the most
# complete ClickHouse experience in the browser/worker environment.
#
# Features:
#   - Everything in lakehouse profile
#   - Geo functions (H3, S2)
#   - Full format support (Avro, Protobuf, MsgPack)
#   - Full compression (LZ4, ZSTD, Brotli)
#   - All aggregate functions
#   - All SQL features
#
# NOT included (WASM limitations):
#   - External database connectors (network I/O)
#   - Distributed engine (cluster coordination)
#   - LLVM JIT compilation
#   - Kafka/RabbitMQ (message queues)
#
# Usage:
#   cmake -C cmake/profiles/full.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
#         ..
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  FULL Profile - chdb-full.wasm")
message(STATUS "  Target: ~25MB+")
message(STATUS "  Use case: Maximum compatibility")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Profile Metadata
# ============================================================================

set(CHDB_PROFILE "full" CACHE STRING "Build profile name" FORCE)
set(CHDB_PROFILE_OUTPUT_NAME "chdb-full" CACHE STRING "Output WASM filename" FORCE)
set(CHDB_PROFILE_SIZE_TARGET "~25MB+" CACHE STRING "Target binary size" FORCE)
set(CHDB_PROFILE_DESCRIPTION "All WASM-compatible features" CACHE STRING "" FORCE)

# ============================================================================
# Build Mode: Full Execution
# ============================================================================

set(CHDB_PARSER_ONLY OFF CACHE BOOL "Build full execution engine" FORCE)
set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "Build SQL lexer" FORCE)
set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "Build SQL parser" FORCE)
set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "Build full engine" FORCE)

# ============================================================================
# MASTER SWITCH: Selective Library Enablement
# ============================================================================

set(ENABLE_LIBRARIES OFF CACHE BOOL "Disable all external libraries by default" FORCE)

message(STATUS "[MASTER] ENABLE_LIBRARIES=OFF (selective enablement)")

# ============================================================================
# Enable All Core Execution Components
# ============================================================================

set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "Enable query execution" FORCE)
set(CHDB_ENABLE_STORAGE ON CACHE BOOL "Enable storage engines" FORCE)
set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "Enable function evaluation" FORCE)
set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "Enable aggregate functions" FORCE)
set(CHDB_ENABLE_FORMATS ON CACHE BOOL "Enable data formats" FORCE)

message(STATUS "[Execution] All execution components ENABLED")

# ============================================================================
# Storage Engines - All WASM-Compatible
# ============================================================================

set(CHDB_ENGINE_MEMORY ON CACHE BOOL "Enable Memory engine" FORCE)
set(CHDB_ENGINE_VIEW ON CACHE BOOL "Enable View engine" FORCE)
set(CHDB_ENGINE_NULL ON CACHE BOOL "Enable Null engine" FORCE)
set(CHDB_ENGINE_VALUES ON CACHE BOOL "Enable Values engine" FORCE)
set(CHDB_ENGINE_MERGETREE ON CACHE BOOL "Enable MergeTree engine" FORCE)
set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "Enable System tables" FORCE)
set(CHDB_ENGINE_SET ON CACHE BOOL "Enable Set engine" FORCE)
set(CHDB_ENGINE_JOIN ON CACHE BOOL "Enable Join engine" FORCE)
set(CHDB_ENGINE_BUFFER ON CACHE BOOL "Enable Buffer engine" FORCE)
set(CHDB_ENGINE_LOG ON CACHE BOOL "Enable Log engine" FORCE)
set(CHDB_ENGINE_DICTIONARY ON CACHE BOOL "Enable Dictionary engine" FORCE)
set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "Enable GenerateRandom" FORCE)
set(CHDB_ENGINE_S3 ON CACHE BOOL "Enable S3 table function" FORCE)
set(CHDB_ENGINE_URL ON CACHE BOOL "Enable URL table function" FORCE)

set(CHDB_WASM_ENGINE_LEVEL "custom" CACHE STRING "Engine complexity level" FORCE)

message(STATUS "[Engines] All WASM-compatible engines ENABLED")

# ============================================================================
# Cloud Storage - S3 ENABLED (Minimal SDK)
# ============================================================================

set(ENABLE_S3 ON CACHE BOOL "Enable S3 support" FORCE)
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable full AWS SDK" FORCE)
set(CHDB_S3_MINIMAL ON CACHE BOOL "Use minimal S3 implementation" FORCE)

# Other cloud storage disabled (too large for WASM)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_HDFS OFF CACHE BOOL "Disable HDFS" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure" FORCE)

message(STATUS "[Storage] S3 ENABLED, GCS/HDFS/Azure DISABLED")

# ============================================================================
# HTTP/Networking - For URL and S3 functions
# ============================================================================

set(ENABLE_CURL ON CACHE BOOL "Enable HTTP support" FORCE)
set(CHDB_CURL_EMSCRIPTEN ON CACHE BOOL "Use Emscripten fetch for HTTP" FORCE)

# Disable heavy networking
set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC" FORCE)
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft" FORCE)
set(ENABLE_SSH OFF CACHE BOOL "Disable SSH" FORCE)

message(STATUS "[Networking] HTTP ENABLED, gRPC/SSH DISABLED")

# ============================================================================
# Data Formats - Full Set
# ============================================================================

set(CHDB_FORMAT_JSON ON CACHE BOOL "Enable JSON format" FORCE)
set(CHDB_FORMAT_CSV ON CACHE BOOL "Enable CSV format" FORCE)
set(CHDB_FORMAT_TSV ON CACHE BOOL "Enable TSV format" FORCE)
set(CHDB_FORMAT_NATIVE ON CACHE BOOL "Enable Native format" FORCE)
set(CHDB_FORMAT_PARQUET ON CACHE BOOL "Enable Parquet format" FORCE)
set(CHDB_FORMAT_AVRO ON CACHE BOOL "Enable Avro format" FORCE)

# Enable all formats
set(ENABLE_PARQUET ON CACHE BOOL "Enable Parquet format" FORCE)
set(ENABLE_ARROW ON CACHE BOOL "Enable Arrow format" FORCE)
set(ENABLE_THRIFT ON CACHE BOOL "Enable Thrift" FORCE)
set(ENABLE_AVRO ON CACHE BOOL "Enable Avro format" FORCE)
set(ENABLE_PROTOBUF ON CACHE BOOL "Enable Protocol Buffers" FORCE)
set(ENABLE_CAPNP ON CACHE BOOL "Enable Cap'n Proto" FORCE)
set(ENABLE_MSGPACK ON CACHE BOOL "Enable MessagePack" FORCE)

# Arrow Flight requires gRPC, disabled
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight" FORCE)

message(STATUS "[Formats] ALL formats ENABLED (Parquet, Arrow, Avro, Protobuf, etc.)")

# ============================================================================
# Database Integrations - ALL DISABLED (WASM limitation)
# ============================================================================

set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL" FORCE)
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB" FORCE)
set(ENABLE_KAFKA OFF CACHE BOOL "Disable Kafka" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ/AMQP" FORCE)
set(ENABLE_NATSIO OFF CACHE BOOL "Disable NATS.io" FORCE)
set(ENABLE_SQLITE OFF CACHE BOOL "Disable SQLite" FORCE)
set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB" FORCE)

message(STATUS "[Databases] External database connectors DISABLED (WASM)")

# ============================================================================
# Heavy Compute Features - DISABLED (WASM limitation)
# ============================================================================

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM JIT" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF parser" FORCE)
set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3" FORCE)

message(STATUS "[Compute] JIT and DWARF DISABLED (WASM)")

# ============================================================================
# Specialized Libraries - Geo ENABLED, Others DISABLED
# ============================================================================

# Enable geo libraries for full profile
set(ENABLE_H3 ON CACHE BOOL "Enable H3 geo library" FORCE)
set(ENABLE_S2_GEOMETRY ON CACHE BOOL "Enable S2 geometry" FORCE)

# Disable very large or problematic libraries
set(ENABLE_ICU OFF CACHE BOOL "Disable ICU (very large)" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan" FORCE)
set(ENABLE_DATASKETCHES OFF CACHE BOOL "Disable DataSketches" FORCE)
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust components" FORCE)
set(ENABLE_FASTPFOR OFF CACHE BOOL "Disable FastPFOR" FORCE)
set(ENABLE_SQIDS OFF CACHE BOOL "Disable Sqids" FORCE)
set(ENABLE_ANTLR4_CPP_RUNTIME OFF CACHE BOOL "Disable ANTLR4" FORCE)
set(ENABLE_ANTLR4_GRAMMARS OFF CACHE BOOL "Disable ANTLR4 grammars" FORCE)
set(ENABLE_PROMETHEUS_PROTOBUFS OFF CACHE BOOL "Disable Prometheus" FORCE)

message(STATUS "[Libraries] H3, S2 ENABLED; ICU, NLP DISABLED")

# ============================================================================
# Functions - All Available
# ============================================================================

# Core functions
set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "Enable arithmetic functions" FORCE)
set(CHDB_FUNC_COMPARISON ON CACHE BOOL "Enable comparison functions" FORCE)
set(CHDB_FUNC_LOGICAL ON CACHE BOOL "Enable logical functions" FORCE)
set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "Enable type conversion" FORCE)
set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "Enable IF/CASE functions" FORCE)
set(CHDB_FUNC_NULLABLE ON CACHE BOOL "Enable NULL handling functions" FORCE)

# String functions
set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "Enable basic string functions" FORCE)
set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "Enable advanced string functions" FORCE)
set(CHDB_FUNC_STRING_ENCODING ON CACHE BOOL "Enable encoding functions" FORCE)

# Date/Time functions
set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "Enable basic datetime functions" FORCE)
set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "Enable advanced datetime functions" FORCE)

# Math and utility functions
set(CHDB_FUNC_MATH ON CACHE BOOL "Enable math functions" FORCE)
set(CHDB_FUNC_JSON ON CACHE BOOL "Enable JSON functions" FORCE)
set(CHDB_FUNC_HASH ON CACHE BOOL "Enable hash functions" FORCE)
set(CHDB_FUNC_UUID ON CACHE BOOL "Enable UUID functions" FORCE)
set(CHDB_FUNC_TUPLE ON CACHE BOOL "Enable tuple functions" FORCE)
set(CHDB_FUNC_ENCODING ON CACHE BOOL "Enable encoding functions" FORCE)

# Collection functions
set(CHDB_FUNC_ARRAY ON CACHE BOOL "Enable array functions" FORCE)
set(CHDB_FUNC_MAP ON CACHE BOOL "Enable map functions" FORCE)

# Network functions
set(CHDB_FUNC_IP ON CACHE BOOL "Enable IP address functions" FORCE)

# Geo functions (full profile feature)
set(CHDB_FUNC_GEO ON CACHE BOOL "Enable geo functions" FORCE)

# Window functions
set(CHDB_FUNC_WINDOW ON CACHE BOOL "Enable window functions" FORCE)

# Introspection
set(CHDB_FUNC_INTROSPECTION ON CACHE BOOL "Enable introspection" FORCE)

# ML functions disabled (requires LLVM)
set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "Disable ML functions" FORCE)

set(CHDB_MINIMAL_FUNCTIONS OFF CACHE BOOL "Use full function set" FORCE)

message(STATUS "[Functions] ALL available functions ENABLED (except ML)")

# ============================================================================
# Aggregate Functions - Full Set
# ============================================================================

set(CHDB_AGG_BASIC ON CACHE BOOL "Enable COUNT, SUM, AVG, MIN, MAX" FORCE)
set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "Enable conditional aggregates" FORCE)
set(CHDB_AGG_ADVANCED ON CACHE BOOL "Enable advanced aggregates" FORCE)
set(CHDB_AGG_COMBINATORS ON CACHE BOOL "Enable aggregate combinators" FORCE)
set(CHDB_AGG_STATISTICAL ON CACHE BOOL "Enable statistical aggregates" FORCE)
set(CHDB_AGG_QUANTILE ON CACHE BOOL "Enable quantile aggregates" FORCE)
set(CHDB_AGG_APPROXIMATE ON CACHE BOOL "Enable approximate aggregates" FORCE)
set(CHDB_AGG_HISTOGRAM ON CACHE BOOL "Enable histogram aggregates" FORCE)

message(STATUS "[Aggregates] ALL aggregate functions ENABLED")

# ============================================================================
# SQL Features - Full Set
# ============================================================================

set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "Enable subqueries" FORCE)
set(CHDB_SQL_JOIN ON CACHE BOOL "Enable JOINs" FORCE)
set(CHDB_SQL_JOIN_ADVANCED ON CACHE BOOL "Enable advanced JOINs" FORCE)
set(CHDB_SQL_CTE ON CACHE BOOL "Enable CTEs (WITH clause)" FORCE)
set(CHDB_SQL_UNION ON CACHE BOOL "Enable UNION" FORCE)
set(CHDB_SQL_PREWHERE ON CACHE BOOL "Enable PREWHERE" FORCE)
set(CHDB_SQL_SAMPLE ON CACHE BOOL "Enable SAMPLE" FORCE)
set(CHDB_SQL_WINDOW ON CACHE BOOL "Enable window functions" FORCE)
set(CHDB_SQL_ARRAY_JOIN ON CACHE BOOL "Enable ARRAY JOIN" FORCE)
set(CHDB_SQL_LATERAL ON CACHE BOOL "Enable LATERAL" FORCE)
set(CHDB_SQL_FINAL ON CACHE BOOL "Enable FINAL" FORCE)

message(STATUS "[SQL] Full SQL feature set ENABLED")

# ============================================================================
# Compression - Full Set
# ============================================================================

set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "Enable LZ4 compression" FORCE)
set(CHDB_COMPRESSION_ZSTD ON CACHE BOOL "Enable ZSTD compression" FORCE)
set(CHDB_COMPRESSION_BROTLI ON CACHE BOOL "Enable Brotli compression" FORCE)

message(STATUS "[Compression] LZ4, ZSTD, Brotli ENABLED")

# ============================================================================
# Memory Allocator
# ============================================================================

set(ENABLE_JEMALLOC OFF CACHE BOOL "Disable jemalloc" FORCE)
set(USE_JEMALLOC OFF CACHE BOOL "Disable jemalloc" FORCE)
set(ENABLE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc" FORCE)
set(USE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc" FORCE)

message(STATUS "[Allocator] Using system/emmalloc")

# ============================================================================
# Development/Testing - DISABLED
# ============================================================================

set(ENABLE_TESTS OFF CACHE BOOL "Disable tests" FORCE)
set(ENABLE_EXAMPLES OFF CACHE BOOL "Disable examples" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "Disable benchmarks" FORCE)
set(ENABLE_FUZZING OFF CACHE BOOL "Disable fuzzing" FORCE)

message(STATUS "[Dev] Tests, examples, benchmarks DISABLED")

# ============================================================================
# WASM/Emscripten-Specific Build Settings
# ============================================================================

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "MinSizeRel" CACHE STRING "Build type" FORCE)
endif()

set(CHDB_WASM_COMPILE_FLAGS
    "-Oz"                            # Maximum size optimization
    "-fno-exceptions"                # No C++ exceptions
    "-fno-rtti"                      # No runtime type info
    "-ffunction-sections"            # Enable dead code elimination
    "-fdata-sections"                # Enable dead data elimination
    "-fvisibility=hidden"            # Hide symbols by default
    "-DNDEBUG"                       # Release mode
)

set(CHDB_WASM_FEATURE_FLAGS
    "-msimd128"                      # WASM SIMD
    "-mbulk-memory"                  # Bulk memory operations
    "-mnontrapping-fptoint"          # Non-trapping float-to-int
    "-msign-ext"                     # Sign extension operations
)

set(CHDB_WASM_LINK_FLAGS
    "-Oz"                            # Size optimization in linking
    "-sWASM=1"                       # Output WASM
    "-sASSERTIONS=0"                 # No runtime assertions
    "-sMALLOC=emmalloc"              # Smallest allocator
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching
    "-sNO_EXIT_RUNTIME=1"            # Don't exit runtime
    "-sALLOW_MEMORY_GROWTH=1"        # Allow memory to grow
    "-sFILESYSTEM=1"                 # Enable filesystem
    "-sFETCH=1"                      # Enable fetch API for HTTP
    "-sMODULARIZE=1"                 # ES6 module output
    "-sEXPORT_ES6=1"                 # Export as ES6
    "-sENVIRONMENT='web,worker'"     # Target web and workers
)

message(STATUS "[WASM] Emscripten configured for full feature build")

# ============================================================================
# Compile Definitions
# ============================================================================

add_compile_definitions(
    CHDB_PROFILE_FULL=1
    CHDB_ENABLE_ALL_FEATURES=1
    CHDB_ENABLE_MERGETREE=1
    CHDB_ENABLE_PARQUET=1
    CHDB_ENABLE_ARROW=1
    CHDB_ENABLE_S3=1
    CHDB_ENABLE_URL=1
    CHDB_ENABLE_GEO=1
    CHDB_ENABLE_WINDOW_FUNCTIONS=1
    NDEBUG=1
)

# ============================================================================
# Size Optimization Flags
# ============================================================================

set(CHDB_AGGRESSIVE_SIZE_OPT OFF CACHE BOOL "Moderate size optimizations" FORCE)
set(BUILD_MINIMAL OFF CACHE BOOL "Full build" FORCE)

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  FULL Profile Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Output Name:         chdb-full.wasm")
message(STATUS "Target Size:         ~25MB+")
message(STATUS "")
message(STATUS "ENABLED:")
message(STATUS "  Engines:           ALL WASM-compatible (Memory, MergeTree, S3, URL,")
message(STATUS "                     View, System, Set, Join, Buffer, Log, Dictionary)")
message(STATUS "  Formats:           ALL (JSON, CSV, TSV, Parquet, Arrow, Avro,")
message(STATUS "                     Protobuf, Cap'n Proto, MessagePack)")
message(STATUS "  Functions:         ALL available (String, DateTime, Math, Hash,")
message(STATUS "                     UUID, Array, Map, IP, Geo, Window)")
message(STATUS "  Aggregates:        ALL (basic through approximate)")
message(STATUS "  SQL Features:      ALL (CTEs, UNION, JOINs, Window, ARRAY JOIN,")
message(STATUS "                     LATERAL, FINAL, PREWHERE, SAMPLE)")
message(STATUS "  Compression:       ALL (LZ4, ZSTD, Brotli)")
message(STATUS "  Geo Libraries:     H3, S2")
message(STATUS "  Networking:        HTTP/HTTPS via Emscripten fetch")
message(STATUS "")
message(STATUS "DISABLED (WASM limitations):")
message(STATUS "  - External database connectors (MySQL, PostgreSQL, etc.)")
message(STATUS "  - Message queues (Kafka, RabbitMQ)")
message(STATUS "  - LLVM JIT compilation")
message(STATUS "  - Full AWS/GCS/Azure SDKs")
message(STATUS "  - ICU, NLP, ML functions")
message(STATUS "")
message(STATUS "USE CASES:")
message(STATUS "  - Maximum ClickHouse compatibility in browser")
message(STATUS "  - Complex analytics requiring all features")
message(STATUS "  - Geo-spatial analytics")
message(STATUS "  - Data lake access with full format support")
message(STATUS "  - Production deployments needing feature parity")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
