# etl.cmake
# ETL WASM Build Profile (chdb-etl.wasm)
#
# Target: ~12-15MB
# Use case: Data transformation pipelines, ETL workloads
#
# This profile extends the analytics profile with Parquet reader/writer
# and Arrow format support for data transformation pipelines.
#
# Features:
#   - Everything in analytics profile
#   - Parquet reader and writer
#   - Arrow format support
#   - Array functions
#   - Map functions
#   - Window functions (for ETL transforms)
#
# NOT included:
#   - S3/R2 table functions (see lakehouse profile)
#   - URL engine
#   - Geo functions
#   - ML functions
#
# Usage:
#   cmake -C cmake/profiles/etl.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
#         ..
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  ETL Profile - chdb-etl.wasm")
message(STATUS "  Target: ~12-15MB")
message(STATUS "  Use case: Data transformation pipelines")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Profile Metadata
# ============================================================================

set(CHDB_PROFILE "etl" CACHE STRING "Build profile name" FORCE)
set(CHDB_PROFILE_OUTPUT_NAME "chdb-etl" CACHE STRING "Output WASM filename" FORCE)
set(CHDB_PROFILE_SIZE_TARGET "~12-15MB" CACHE STRING "Target binary size" FORCE)
set(CHDB_PROFILE_DESCRIPTION "Analytics + Parquet/Arrow for ETL" CACHE STRING "" FORCE)

# ============================================================================
# Build Mode: Full Execution
# ============================================================================

set(CHDB_PARSER_ONLY OFF CACHE BOOL "Build full execution engine" FORCE)
set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "Build SQL lexer" FORCE)
set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "Build SQL parser" FORCE)
set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "Build full engine" FORCE)

# ============================================================================
# MASTER SWITCH: Disable All External Libraries by Default
# ============================================================================

set(ENABLE_LIBRARIES OFF CACHE BOOL "Disable all external libraries by default" FORCE)

message(STATUS "[MASTER] ENABLE_LIBRARIES=OFF (selective enablement)")

# ============================================================================
# Enable Core Execution Components
# ============================================================================

set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "Enable query execution" FORCE)
set(CHDB_ENABLE_STORAGE ON CACHE BOOL "Enable storage engines" FORCE)
set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "Enable function evaluation" FORCE)
set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "Enable aggregate functions" FORCE)
set(CHDB_ENABLE_FORMATS ON CACHE BOOL "Enable data formats" FORCE)

message(STATUS "[Execution] Core execution components ENABLED")

# ============================================================================
# Storage Engines - Memory + MergeTree
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
set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "Enable GenerateRandom" FORCE)

# Disable external storage engines
set(CHDB_ENGINE_LOG OFF CACHE BOOL "Disable Log engine" FORCE)
set(CHDB_ENGINE_DICTIONARY OFF CACHE BOOL "Disable Dictionary engine" FORCE)
set(CHDB_ENGINE_S3 OFF CACHE BOOL "Disable S3 engine (see lakehouse)" FORCE)
set(CHDB_ENGINE_URL OFF CACHE BOOL "Disable URL engine (see lakehouse)" FORCE)

set(CHDB_WASM_ENGINE_LEVEL "light" CACHE STRING "Engine complexity level" FORCE)

message(STATUS "[Engines] Memory, MergeTree, Buffer, View, System ENABLED")
message(STATUS "[Engines] S3, URL DISABLED (see lakehouse profile)")

# ============================================================================
# Cloud Storage - DISABLED (see lakehouse profile)
# ============================================================================

set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3 (see lakehouse)" FORCE)
set(ENABLE_S3 OFF CACHE BOOL "Disable S3 (see lakehouse)" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_HDFS OFF CACHE BOOL "Disable HDFS" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure" FORCE)

message(STATUS "[Storage] Cloud integrations DISABLED (see lakehouse profile)")

# ============================================================================
# Data Formats - JSON, CSV, TSV, Parquet, Arrow
# ============================================================================

set(CHDB_FORMAT_JSON ON CACHE BOOL "Enable JSON format" FORCE)
set(CHDB_FORMAT_CSV ON CACHE BOOL "Enable CSV format" FORCE)
set(CHDB_FORMAT_TSV ON CACHE BOOL "Enable TSV format" FORCE)
set(CHDB_FORMAT_NATIVE ON CACHE BOOL "Enable Native format" FORCE)
set(CHDB_FORMAT_PARQUET ON CACHE BOOL "Enable Parquet format" FORCE)

# Enable Parquet and Arrow (ETL key feature)
set(ENABLE_PARQUET ON CACHE BOOL "Enable Parquet format" FORCE)
set(ENABLE_ARROW ON CACHE BOOL "Enable Arrow format" FORCE)
set(ENABLE_THRIFT ON CACHE BOOL "Enable Thrift (required by Parquet)" FORCE)

# Disable other heavy formats
set(ENABLE_AVRO OFF CACHE BOOL "Disable Avro" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto" FORCE)
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight" FORCE)

message(STATUS "[Formats] JSON, CSV, TSV, Native, Parquet, Arrow ENABLED")
message(STATUS "[Formats] Avro, Protobuf, MsgPack DISABLED")

# ============================================================================
# Database Integrations - ALL DISABLED
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

message(STATUS "[Databases] External integrations DISABLED")

# ============================================================================
# Networking & RPC - DISABLED
# ============================================================================

set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC" FORCE)
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Disable cURL" FORCE)
set(ENABLE_SSH OFF CACHE BOOL "Disable SSH" FORCE)

message(STATUS "[Networking] gRPC and networking DISABLED")

# ============================================================================
# Heavy Compute Features - DISABLED
# ============================================================================

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM JIT" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF parser" FORCE)
set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3" FORCE)

message(STATUS "[Compute] JIT and DWARF parsing DISABLED")

# ============================================================================
# Specialized Libraries - DISABLED
# ============================================================================

set(ENABLE_ICU OFF CACHE BOOL "Disable ICU" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan" FORCE)
set(ENABLE_H3 OFF CACHE BOOL "Disable H3 geo library" FORCE)
set(ENABLE_S2_GEOMETRY OFF CACHE BOOL "Disable S2 geometry" FORCE)
set(ENABLE_DATASKETCHES OFF CACHE BOOL "Disable DataSketches" FORCE)
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust components" FORCE)
set(ENABLE_FASTPFOR OFF CACHE BOOL "Disable FastPFOR" FORCE)
set(ENABLE_SQIDS OFF CACHE BOOL "Disable Sqids" FORCE)
set(ENABLE_ANTLR4_CPP_RUNTIME OFF CACHE BOOL "Disable ANTLR4" FORCE)
set(ENABLE_ANTLR4_GRAMMARS OFF CACHE BOOL "Disable ANTLR4 grammars" FORCE)
set(ENABLE_PROMETHEUS_PROTOBUFS OFF CACHE BOOL "Disable Prometheus" FORCE)

message(STATUS "[Libraries] Specialized libs DISABLED")

# ============================================================================
# Functions - Full Set for ETL
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

# Array and Map functions (important for ETL transforms)
set(CHDB_FUNC_ARRAY ON CACHE BOOL "Enable array functions" FORCE)
set(CHDB_FUNC_MAP ON CACHE BOOL "Enable map functions" FORCE)

# Disable heavyweight functions
set(CHDB_FUNC_IP OFF CACHE BOOL "Disable IP address functions" FORCE)
set(CHDB_FUNC_GEO OFF CACHE BOOL "Disable geo functions" FORCE)
set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "Disable introspection" FORCE)
set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "Disable ML functions" FORCE)

# Window functions enabled for ETL transforms
set(CHDB_FUNC_WINDOW ON CACHE BOOL "Enable window functions" FORCE)

set(CHDB_MINIMAL_FUNCTIONS OFF CACHE BOOL "Use extended function set" FORCE)

message(STATUS "[Functions] String, DateTime, Math, Hash, UUID, Array, Map, Window ENABLED")
message(STATUS "[Functions] IP, Geo, ML DISABLED")

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
# SQL Features - Full Set with Window Functions
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
set(CHDB_SQL_FINAL OFF CACHE BOOL "Disable FINAL" FORCE)

message(STATUS "[SQL] CTEs, UNION, JOINs, Window, ARRAY JOIN, LATERAL ENABLED")

# ============================================================================
# Compression - LZ4 + ZSTD
# ============================================================================

set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "Enable LZ4 compression" FORCE)
set(CHDB_COMPRESSION_ZSTD ON CACHE BOOL "Enable ZSTD compression" FORCE)
set(CHDB_COMPRESSION_BROTLI OFF CACHE BOOL "Disable Brotli" FORCE)

message(STATUS "[Compression] LZ4, ZSTD ENABLED")

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
    "-sFILESYSTEM=1"                 # Enable filesystem for MergeTree/Parquet
    "-sMODULARIZE=1"                 # ES6 module output
    "-sEXPORT_ES6=1"                 # Export as ES6
    "-sENVIRONMENT='web,worker'"     # Target web and workers
)

message(STATUS "[WASM] Emscripten flags configured with filesystem support")

# ============================================================================
# Compile Definitions
# ============================================================================

add_compile_definitions(
    CHDB_PROFILE_ETL=1
    CHDB_ENABLE_MERGETREE=1
    CHDB_ENABLE_PARQUET=1
    CHDB_ENABLE_ARROW=1
    CHDB_ENABLE_WINDOW_FUNCTIONS=1
    NDEBUG=1
)

# ============================================================================
# Size Optimization Flags
# ============================================================================

set(CHDB_AGGRESSIVE_SIZE_OPT OFF CACHE BOOL "Moderate size optimizations" FORCE)
set(BUILD_MINIMAL OFF CACHE BOOL "Standard build" FORCE)

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  ETL Profile Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Output Name:         chdb-etl.wasm")
message(STATUS "Target Size:         ~12-15MB")
message(STATUS "")
message(STATUS "ENABLED:")
message(STATUS "  Engines:           Memory, MergeTree, Buffer, View, System")
message(STATUS "  Formats:           JSON, CSV, TSV, Native, Parquet, Arrow")
message(STATUS "  Functions:         String, DateTime, Math, Hash, UUID, Array, Map")
message(STATUS "  Window Functions:  ROW_NUMBER, RANK, LAG, LEAD, etc.")
message(STATUS "  Aggregates:        ALL (basic through approximate)")
message(STATUS "  SQL Features:      CTEs, UNION, JOINs, Window, ARRAY JOIN, LATERAL")
message(STATUS "  Compression:       LZ4, ZSTD")
message(STATUS "")
message(STATUS "DISABLED:")
message(STATUS "  Engines:           S3, URL (see lakehouse profile)")
message(STATUS "  Formats:           Avro, Protobuf, MsgPack")
message(STATUS "  Functions:         IP, Geo, ML")
message(STATUS "  Libraries:         ICU, NLP, H3, S2, DataSketches")
message(STATUS "")
message(STATUS "USE CASES:")
message(STATUS "  - Parquet file transformation")
message(STATUS "  - Data pipeline processing")
message(STATUS "  - ETL workloads in browser/worker")
message(STATUS "  - CSV to Parquet conversion")
message(STATUS "  - Data cleaning and normalization")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
