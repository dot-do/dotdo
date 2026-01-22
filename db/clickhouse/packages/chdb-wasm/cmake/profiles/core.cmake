# core.cmake
# Parser/Lexer Only WASM Build Profile
#
# Target: ~1MB uncompressed, ~300KB gzipped
# Use case: SQL validation, syntax checking, AST generation
#
# This profile builds ONLY the SQL parser and lexer components.
# No query execution, no storage engines, no data processing.
#
# Features:
#   - SQL Parser and Lexer
#   - AST generation and serialization
#   - SQL formatting/pretty-printing
#   - Syntax error reporting
#
# NOT included:
#   - Query execution engine
#   - Storage engines
#   - Data processing pipelines
#   - Functions (only parsing, no evaluation)
#   - Data formats (except SQL parsing)
#
# Usage:
#   cmake -C cmake/profiles/core.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
#         ../vendor/chdb
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  CORE Profile - Parser/Lexer Only")
message(STATUS "  Target: ~1MB uncompressed, ~300KB gzipped")
message(STATUS "  Use case: SQL validation, syntax checking")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Profile Metadata
# ============================================================================

set(CHDB_PROFILE "core" CACHE STRING "Build profile name" FORCE)
set(CHDB_PROFILE_SIZE_TARGET "~1MB" CACHE STRING "Target binary size" FORCE)
set(CHDB_PROFILE_DESCRIPTION "Parser/Lexer only - SQL validation" CACHE STRING "" FORCE)

# ============================================================================
# Build Mode: Parser Only
# ============================================================================
# This is the key setting that enables parser-only mode.
# When enabled, only the SQL parsing components are built.

set(CHDB_PARSER_ONLY ON CACHE BOOL "Build parser/lexer only, no execution" FORCE)
set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "Build SQL lexer" FORCE)
set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "Build SQL parser" FORCE)
set(CHDB_WASM_BUILD_FULL OFF CACHE BOOL "Disable full build" FORCE)

# ============================================================================
# MASTER SWITCH: Disable All External Libraries
# ============================================================================

set(ENABLE_LIBRARIES OFF CACHE BOOL "Disable all external libraries" FORCE)

message(STATUS "[MASTER] ENABLE_LIBRARIES=OFF")

# ============================================================================
# Disable Execution Components
# ============================================================================
# The parser-only build doesn't need any execution infrastructure.

set(CHDB_ENABLE_EXECUTION OFF CACHE BOOL "Disable query execution" FORCE)
set(CHDB_ENABLE_STORAGE OFF CACHE BOOL "Disable storage engines" FORCE)
set(CHDB_ENABLE_FUNCTIONS OFF CACHE BOOL "Disable function evaluation" FORCE)
set(CHDB_ENABLE_AGGREGATES OFF CACHE BOOL "Disable aggregate functions" FORCE)
set(CHDB_ENABLE_FORMATS OFF CACHE BOOL "Disable data formats" FORCE)

message(STATUS "[Execution] All execution components DISABLED")

# ============================================================================
# Disable All Storage Engines
# ============================================================================

set(CHDB_ENGINE_MEMORY OFF CACHE BOOL "Disable Memory engine" FORCE)
set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "Disable MergeTree engine" FORCE)
set(CHDB_ENGINE_VIEW OFF CACHE BOOL "Disable View engine" FORCE)
set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "Disable System tables" FORCE)
set(CHDB_ENGINE_NULL OFF CACHE BOOL "Disable Null engine" FORCE)
set(CHDB_ENGINE_VALUES OFF CACHE BOOL "Disable Values engine" FORCE)
set(CHDB_ENGINE_SET OFF CACHE BOOL "Disable Set engine" FORCE)
set(CHDB_ENGINE_JOIN OFF CACHE BOOL "Disable Join engine" FORCE)
set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "Disable Buffer engine" FORCE)
set(CHDB_ENGINE_LOG OFF CACHE BOOL "Disable Log engine" FORCE)
set(CHDB_ENGINE_DICTIONARY OFF CACHE BOOL "Disable Dictionary engine" FORCE)
set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "Disable GenerateRandom engine" FORCE)

message(STATUS "[Engines] All storage engines DISABLED")

# ============================================================================
# Cloud Storage - DISABLED
# ============================================================================

set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_HDFS OFF CACHE BOOL "Disable HDFS" FORCE)

message(STATUS "[Storage] Cloud integrations DISABLED")

# ============================================================================
# Data Formats - ALL DISABLED
# ============================================================================
# Parser-only build doesn't process data, only SQL text.

set(ENABLE_PARQUET OFF CACHE BOOL "Disable Parquet" FORCE)
set(ENABLE_AVRO OFF CACHE BOOL "Disable Avro" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto" FORCE)
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack" FORCE)
set(ENABLE_THRIFT OFF CACHE BOOL "Disable Thrift" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight" FORCE)

message(STATUS "[Formats] All data formats DISABLED")

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

set(ENABLE_ICU OFF CACHE BOOL "Disable ICU" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan" FORCE)
set(ENABLE_H3 OFF CACHE BOOL "Disable H3" FORCE)
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

# Aggressive size optimization flags for parser-only build
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

message(STATUS "[WASM] Emscripten flags configured for minimal parser output")

# ============================================================================
# Compile Definitions
# ============================================================================

add_compile_definitions(
    CHDB_PROFILE_CORE=1
    CHDB_PARSER_ONLY=1
    CHDB_NO_EXECUTION=1
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
message(STATUS "  CORE Profile Configuration Summary")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Build Mode:          Parser/Lexer only")
message(STATUS "Target Size:         ~1MB uncompressed, ~300KB gzipped")
message(STATUS "")
message(STATUS "ENABLED:")
message(STATUS "  - SQL Parser and Lexer")
message(STATUS "  - AST generation")
message(STATUS "  - SQL syntax validation")
message(STATUS "  - SQL pretty-printing")
message(STATUS "")
message(STATUS "DISABLED:")
message(STATUS "  - Query execution")
message(STATUS "  - All storage engines")
message(STATUS "  - All data formats")
message(STATUS "  - All functions")
message(STATUS "  - All external libraries")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
