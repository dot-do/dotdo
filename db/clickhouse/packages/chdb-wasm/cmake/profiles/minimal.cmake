# minimal.cmake
# Minimal WASM Build Profile - Memory Engine with Basic Functions
#
# Target: ~5-10MB uncompressed, ~2-3MB gzipped
# Use case: Simple in-memory analytics, data exploration, simple dashboards
#
# This profile provides a lightweight SQL execution environment suitable for
# basic analytics workloads that can run entirely in memory.
#
# Features:
#   - Memory storage engine (in-RAM tables)
#   - Basic aggregate functions (COUNT, SUM, AVG, MIN, MAX)
#   - Basic string functions (concat, substring, length, etc.)
#   - Basic math functions (arithmetic, rounding, etc.)
#   - CSV, JSON, TSV formats
#   - Core SQL: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT
#   - Basic JOINs (INNER, LEFT, RIGHT)
#   - Subqueries
#
# NOT included:
#   - MergeTree engine (no persistence)
#   - Parquet/Arrow formats
#   - Window functions
#   - Advanced aggregates (quantiles, histograms, statistical)
#   - Date/time functions (only basic)
#   - Array/Map/Tuple complex type functions
#   - Geo functions
#   - ML functions
#
# Usage:
#   cmake -C cmake/profiles/minimal.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
#         ../vendor/chdb
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  MINIMAL Profile - Memory Engine + Basic Functions")
message(STATUS "  Target: ~5-10MB uncompressed, ~2-3MB gzipped")
message(STATUS "  Use case: Simple in-memory analytics")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Profile Metadata
# ============================================================================

set(CHDB_PROFILE "minimal" CACHE STRING "Build profile name" FORCE)
set(CHDB_PROFILE_SIZE_TARGET "~5-10MB" CACHE STRING "Target binary size" FORCE)
set(CHDB_PROFILE_DESCRIPTION "Memory engine + basic functions" CACHE STRING "" FORCE)

# ============================================================================
# Build Mode: Full Execution with Minimal Features
# ============================================================================

set(CHDB_PARSER_ONLY OFF CACHE BOOL "Build full execution engine" FORCE)
set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "Build SQL lexer" FORCE)
set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "Build SQL parser" FORCE)
set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "Build full engine" FORCE)

# ============================================================================
# MASTER SWITCH: Disable All External Libraries
# ============================================================================
# Start with everything disabled, then selectively enable what we need.

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
# Storage Engines - Memory Only
# ============================================================================
# Only enable lightweight in-memory engines.

set(CHDB_ENGINE_MEMORY ON CACHE BOOL "Enable Memory engine" FORCE)
set(CHDB_ENGINE_VIEW ON CACHE BOOL "Enable View engine" FORCE)
set(CHDB_ENGINE_NULL ON CACHE BOOL "Enable Null engine" FORCE)
set(CHDB_ENGINE_VALUES ON CACHE BOOL "Enable Values engine" FORCE)

# Disable heavier engines
set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "Disable MergeTree engine" FORCE)
set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "Disable System tables" FORCE)
set(CHDB_ENGINE_SET OFF CACHE BOOL "Disable Set engine" FORCE)
set(CHDB_ENGINE_JOIN OFF CACHE BOOL "Disable Join engine" FORCE)
set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "Disable Buffer engine" FORCE)
set(CHDB_ENGINE_LOG OFF CACHE BOOL "Disable Log engine" FORCE)
set(CHDB_ENGINE_DICTIONARY OFF CACHE BOOL "Disable Dictionary engine" FORCE)
set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "Disable GenerateRandom engine" FORCE)

set(CHDB_WASM_ENGINE_LEVEL "minimal" CACHE STRING "Engine complexity level" FORCE)

message(STATUS "[Engines] Memory, View, Null, Values ENABLED")
message(STATUS "[Engines] MergeTree, System, heavy engines DISABLED")

# ============================================================================
# Cloud Storage - DISABLED
# ============================================================================

set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_HDFS OFF CACHE BOOL "Disable HDFS" FORCE)

message(STATUS "[Storage] Cloud integrations DISABLED")

# ============================================================================
# Data Formats - Basic Only (JSON, CSV, TSV)
# ============================================================================
# Enable lightweight built-in formats only.

set(CHDB_FORMAT_JSON ON CACHE BOOL "Enable JSON format" FORCE)
set(CHDB_FORMAT_CSV ON CACHE BOOL "Enable CSV format" FORCE)
set(CHDB_FORMAT_TSV ON CACHE BOOL "Enable TSV format" FORCE)
set(CHDB_FORMAT_NATIVE ON CACHE BOOL "Enable Native format" FORCE)

# Disable heavy formats that require external dependencies
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Parquet (saves ~3MB)" FORCE)
set(ENABLE_AVRO OFF CACHE BOOL "Disable Avro" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto" FORCE)
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack" FORCE)
set(ENABLE_THRIFT OFF CACHE BOOL "Disable Thrift" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight" FORCE)

message(STATUS "[Formats] JSON, CSV, TSV, Native ENABLED")
message(STATUS "[Formats] Parquet, Avro, Protobuf DISABLED")

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

message(STATUS "[Networking] gRPC and consensus DISABLED")

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
# These add significant binary size for specialized functionality.

set(ENABLE_ICU OFF CACHE BOOL "Disable ICU (saves ~2MB)" FORCE)
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

message(STATUS "[Libraries] Specialized libs DISABLED (ICU, NLP, Geo, etc.)")

# ============================================================================
# Functions - Basic Set Only
# ============================================================================
# Enable only the essential functions for simple analytics.

set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "Enable arithmetic functions" FORCE)
set(CHDB_FUNC_COMPARISON ON CACHE BOOL "Enable comparison functions" FORCE)
set(CHDB_FUNC_LOGICAL ON CACHE BOOL "Enable logical functions" FORCE)
set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "Enable type conversion" FORCE)
set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "Enable basic string functions" FORCE)
set(CHDB_FUNC_MATH ON CACHE BOOL "Enable math functions" FORCE)
set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "Enable IF/CASE functions" FORCE)
set(CHDB_FUNC_NULLABLE ON CACHE BOOL "Enable NULL handling functions" FORCE)
set(CHDB_FUNC_JSON ON CACHE BOOL "Enable JSON functions" FORCE)

# Disable advanced/specialized functions
set(CHDB_FUNC_STRING_ADVANCED OFF CACHE BOOL "Disable advanced string functions" FORCE)
set(CHDB_FUNC_STRING_ENCODING OFF CACHE BOOL "Disable encoding functions" FORCE)
set(CHDB_FUNC_DATETIME_BASIC OFF CACHE BOOL "Disable basic datetime functions" FORCE)
set(CHDB_FUNC_DATETIME_ADVANCED OFF CACHE BOOL "Disable advanced datetime functions" FORCE)
set(CHDB_FUNC_ARRAY OFF CACHE BOOL "Disable array functions" FORCE)
set(CHDB_FUNC_MAP OFF CACHE BOOL "Disable map functions" FORCE)
set(CHDB_FUNC_TUPLE OFF CACHE BOOL "Disable tuple functions" FORCE)
set(CHDB_FUNC_HASH OFF CACHE BOOL "Disable hash functions" FORCE)
set(CHDB_FUNC_UUID OFF CACHE BOOL "Disable UUID functions" FORCE)
set(CHDB_FUNC_IP OFF CACHE BOOL "Disable IP address functions" FORCE)
set(CHDB_FUNC_GEO OFF CACHE BOOL "Disable geo functions" FORCE)
set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "Disable introspection" FORCE)
set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "Disable ML functions" FORCE)
set(CHDB_FUNC_WINDOW OFF CACHE BOOL "Disable window functions" FORCE)
set(CHDB_FUNC_ENCODING OFF CACHE BOOL "Disable encoding functions" FORCE)

set(CHDB_MINIMAL_FUNCTIONS ON CACHE BOOL "Use minimal function set" FORCE)

message(STATUS "[Functions] Basic set ENABLED (arithmetic, string, math, JSON)")
message(STATUS "[Functions] Advanced set DISABLED (datetime, array, map, window)")

# ============================================================================
# Aggregate Functions - Basic Only
# ============================================================================
# Enable only COUNT, SUM, AVG, MIN, MAX and variants.

set(CHDB_AGG_BASIC ON CACHE BOOL "Enable COUNT, SUM, AVG, MIN, MAX" FORCE)
set(CHDB_AGG_CONDITIONAL OFF CACHE BOOL "Disable conditional aggregates" FORCE)
set(CHDB_AGG_ADVANCED OFF CACHE BOOL "Disable advanced aggregates" FORCE)
set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "Disable statistical aggregates" FORCE)
set(CHDB_AGG_QUANTILE OFF CACHE BOOL "Disable quantile aggregates" FORCE)
set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "Disable approximate aggregates" FORCE)
set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "Disable histogram aggregates" FORCE)
set(CHDB_AGG_COMBINATORS OFF CACHE BOOL "Disable aggregate combinators" FORCE)

message(STATUS "[Aggregates] Basic ENABLED (COUNT, SUM, AVG, MIN, MAX)")
message(STATUS "[Aggregates] Advanced DISABLED (quantile, histogram, statistical)")

# ============================================================================
# SQL Features - Core Only
# ============================================================================

set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "Enable subqueries" FORCE)
set(CHDB_SQL_JOIN ON CACHE BOOL "Enable basic JOINs" FORCE)

# Disable advanced SQL features
set(CHDB_SQL_WINDOW OFF CACHE BOOL "Disable window functions" FORCE)
set(CHDB_SQL_CTE OFF CACHE BOOL "Disable CTEs (WITH clause)" FORCE)
set(CHDB_SQL_UNION OFF CACHE BOOL "Disable UNION" FORCE)
set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "Disable advanced JOINs" FORCE)
set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "Disable ARRAY JOIN" FORCE)
set(CHDB_SQL_LATERAL OFF CACHE BOOL "Disable LATERAL" FORCE)
set(CHDB_SQL_PREWHERE OFF CACHE BOOL "Disable PREWHERE" FORCE)
set(CHDB_SQL_SAMPLE OFF CACHE BOOL "Disable SAMPLE" FORCE)
set(CHDB_SQL_FINAL OFF CACHE BOOL "Disable FINAL" FORCE)

message(STATUS "[SQL] Subqueries, basic JOINs ENABLED")
message(STATUS "[SQL] Window, CTEs, UNION, advanced JOINs DISABLED")

# ============================================================================
# Compression - LZ4 Only
# ============================================================================
# LZ4 is the lightest compression option.

set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "Enable LZ4 compression" FORCE)
set(CHDB_COMPRESSION_ZSTD OFF CACHE BOOL "Disable ZSTD (saves ~500KB)" FORCE)
set(CHDB_COMPRESSION_BROTLI OFF CACHE BOOL "Disable Brotli" FORCE)

message(STATUS "[Compression] LZ4 ENABLED, ZSTD/Brotli DISABLED")

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

# Note: --gc-sections is NOT supported by wasm-ld (emscripten linker)
# Dead code elimination is handled by -Oz instead
set(CHDB_WASM_LINK_FLAGS
    "-Oz"                            # Size optimization in linking
    "-sWASM=1"                       # Output WASM
    "-sASSERTIONS=0"                 # No runtime assertions
    "-sMALLOC=emmalloc"              # Smallest allocator
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching
    "-sNO_EXIT_RUNTIME=1"            # Don't exit runtime
    "-sALLOW_MEMORY_GROWTH=1"        # Allow memory to grow
    "-sFILESYSTEM=0"                 # No filesystem
    "-sMODULARIZE=1"                 # ES6 module output
    "-sEXPORT_ES6=1"                 # Export as ES6
    "-sENVIRONMENT='web,worker'"     # Target web and workers
)

message(STATUS "[WASM] Emscripten flags configured for minimal output")

# ============================================================================
# Compile Definitions
# ============================================================================

add_compile_definitions(
    CHDB_PROFILE_MINIMAL=1
    CHDB_MINIMAL_BUILD=1
    NDEBUG=1
)

# ============================================================================
# Size Optimization Flags
# ============================================================================

set(CHDB_AGGRESSIVE_SIZE_OPT ON CACHE BOOL "Enable aggressive size optimizations" FORCE)
set(BUILD_MINIMAL ON CACHE BOOL "Build minimal binary" FORCE)

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  MINIMAL Profile Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Target Size:         ~5-10MB uncompressed, ~2-3MB gzipped")
message(STATUS "")
message(STATUS "ENABLED:")
message(STATUS "  Engines:           Memory, View, Null, Values")
message(STATUS "  Formats:           JSON, CSV, TSV, Native")
message(STATUS "  Functions:         Arithmetic, String (basic), Math, JSON")
message(STATUS "  Aggregates:        COUNT, SUM, AVG, MIN, MAX")
message(STATUS "  SQL Features:      SELECT, FROM, WHERE, GROUP BY, ORDER BY")
message(STATUS "                     LIMIT, HAVING, DISTINCT, JOINs, Subqueries")
message(STATUS "  Compression:       LZ4")
message(STATUS "")
message(STATUS "DISABLED:")
message(STATUS "  Engines:           MergeTree, System tables")
message(STATUS "  Formats:           Parquet, Avro, Protobuf")
message(STATUS "  Functions:         DateTime, Array, Map, Window, Geo, ML")
message(STATUS "  Aggregates:        Quantile, Histogram, Statistical")
message(STATUS "  SQL Features:      CTEs, UNION, ARRAY JOIN, Window functions")
message(STATUS "  Libraries:         ICU, NLP, H3, S2, DataSketches")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
