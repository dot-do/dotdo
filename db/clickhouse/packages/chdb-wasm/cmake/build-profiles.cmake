# build-profiles.cmake
# Multi-Profile WASM Build System for chdb-wasm
#
# This module provides five distinct build profiles with different combinations
# of features, similar to pglite's approach. Each profile targets a specific
# use case and binary size.
#
# Usage:
#   cmake -DCHDB_PROFILE=minimal ..
#   cmake -DCHDB_PROFILE=standard ..
#
# Profiles:
#   - core:      Parser/Lexer only (~50KB) - SQL validation, AST generation
#   - minimal:   Core + Memory engine (~5-10MB) - Simple in-memory analytics
#   - standard:  Minimal + MergeTree + Parquet (~15-25MB) - Typical OLAP
#   - analytics: Standard + full aggregates + window functions (~30-40MB)
#   - full:      All engines, formats, functions (~50MB+) - Max compatibility
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Profile Selection
# ============================================================================

set(CHDB_PROFILE "minimal" CACHE STRING "Build profile for chdb-wasm")
set_property(CACHE CHDB_PROFILE PROPERTY STRINGS
    "core"
    "minimal"
    "standard"
    "analytics"
    "full"
)

# ============================================================================
# Profile Size Targets
# ============================================================================
#
# Profile    | Target Size | Gzipped  | Use Case
# -----------+-------------+----------+----------------------------------
# core       | ~50KB       | ~15KB    | SQL validation, AST generation
# minimal    | ~5-10MB     | ~2-3MB   | Simple in-memory analytics
# standard   | ~15-25MB    | ~5-8MB   | Typical OLAP workloads
# analytics  | ~30-40MB    | ~10-15MB | Complex analytics with window funcs
# full       | ~50MB+      | ~15-20MB | Maximum ClickHouse compatibility
#
# ============================================================================

# ============================================================================
# Profile 1: CORE (~50KB)
# ============================================================================
# Parser/Lexer only - no execution engine
# Use case: SQL validation, AST generation, syntax checking
#
# Features:
#   - SQL Parser and Lexer
#   - AST generation and serialization
#   - SQL formatting/pretty-printing
#   - Syntax error reporting
#
# NOT included:
#   - No query execution
#   - No storage engines
#   - No data processing
#   - No functions (only parsing)

macro(chdb_apply_profile_core)
    message(STATUS "")
    message(STATUS "=== Applying CORE Profile ===")
    message(STATUS "Target: ~50KB uncompressed, ~15KB gzipped")
    message(STATUS "Use case: SQL validation, AST generation")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "core" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~50KB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "Parser/Lexer only" CACHE STRING "" FORCE)

    # Build mode: parser-only
    set(CHDB_WASM_BUILD_FULL OFF CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "" FORCE)
    set(CHDB_PARSER_ONLY ON CACHE BOOL "Build parser/lexer only" FORCE)

    # Disable all execution components
    set(CHDB_ENABLE_EXECUTION OFF CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_STORAGE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_AGGREGATES OFF CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMATS OFF CACHE BOOL "" FORCE)

    # Disable all engines
    set(CHDB_ENGINE_MEMORY OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL OFF CACHE BOOL "" FORCE)

    # Disable all formats
    set(ENABLE_PARQUET OFF CACHE BOOL "" FORCE)
    set(ENABLE_AVRO OFF CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF OFF CACHE BOOL "" FORCE)
    set(ENABLE_CAPNP OFF CACHE BOOL "" FORCE)
    set(ENABLE_MSGPACK OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)

    # Aggressive size optimizations
    set(CHDB_AGGRESSIVE_SIZE_OPT ON CACHE BOOL "" FORCE)

    # Compile definitions
    add_compile_definitions(
        CHDB_PROFILE_CORE=1
        CHDB_PARSER_ONLY=1
        CHDB_NO_EXECUTION=1
    )
endmacro()

# ============================================================================
# Profile 2: MINIMAL (~5-10MB)
# ============================================================================
# Core + Memory engine with basic functions
# Use case: Simple in-memory analytics, data exploration
#
# Features:
#   - Memory storage engine (in-RAM tables)
#   - Basic functions (arithmetic, comparison, string basics)
#   - JSON and CSV formats only
#   - Core SQL: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT
#   - Basic JOINs
#
# NOT included:
#   - No MergeTree (no persistence)
#   - No Parquet/Arrow formats
#   - No window functions
#   - No advanced aggregates
#   - No date/time functions beyond basics

macro(chdb_apply_profile_minimal)
    message(STATUS "")
    message(STATUS "=== Applying MINIMAL Profile ===")
    message(STATUS "Target: ~5-10MB uncompressed, ~2-3MB gzipped")
    message(STATUS "Use case: Simple in-memory analytics")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "minimal" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~5-10MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "Memory engine + basic functions" CACHE STRING "" FORCE)

    # Build mode: full but minimal
    set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "" FORCE)

    # Enable execution with minimal features
    set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_STORAGE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMATS ON CACHE BOOL "" FORCE)

    # Storage engines: Memory only
    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "" FORCE)
    set(CHDB_WASM_ENGINE_LEVEL "minimal" CACHE STRING "" FORCE)

    # Formats: JSON and CSV only
    set(ENABLE_PARQUET OFF CACHE BOOL "" FORCE)
    set(ENABLE_AVRO OFF CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF OFF CACHE BOOL "" FORCE)
    set(ENABLE_CAPNP OFF CACHE BOOL "" FORCE)
    set(ENABLE_MSGPACK OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)
    set(ENABLE_THRIFT OFF CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_NATIVE ON CACHE BOOL "" FORCE)

    # Functions: Basic set only
    set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_COMPARISON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_LOGICAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_MINIMAL_FUNCTIONS ON CACHE BOOL "" FORCE)

    # Aggregates: Basic only
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)      # COUNT, SUM, AVG, MIN, MAX
    set(CHDB_AGG_CONDITIONAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS OFF CACHE BOOL "" FORCE)

    # SQL features: Core only
    set(CHDB_SQL_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "" FORCE)

    # Compression: LZ4 only
    set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_ZSTD OFF CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_BROTLI OFF CACHE BOOL "" FORCE)

    # Size optimizations
    set(CHDB_AGGRESSIVE_SIZE_OPT ON CACHE BOOL "" FORCE)
    set(BUILD_MINIMAL ON CACHE BOOL "" FORCE)

    # Compile definitions
    add_compile_definitions(
        CHDB_PROFILE_MINIMAL=1
        CHDB_MINIMAL_BUILD=1
    )
endmacro()

# ============================================================================
# Profile 3: STANDARD (~15-25MB)
# ============================================================================
# Minimal + MergeTree engine + Parquet format + date/time functions
# Use case: Typical OLAP workloads with persistence
#
# Features:
#   - Everything in Minimal
#   - MergeTree storage engine (persistent storage)
#   - Parquet format support
#   - Date/time functions
#   - CTEs (WITH clause)
#   - UNION operations
#   - More string functions
#
# NOT included:
#   - No window functions
#   - No advanced aggregates (quantiles, histograms)
#   - No array/map functions
#   - No geo/ML functions

macro(chdb_apply_profile_standard)
    message(STATUS "")
    message(STATUS "=== Applying STANDARD Profile ===")
    message(STATUS "Target: ~15-25MB uncompressed, ~5-8MB gzipped")
    message(STATUS "Use case: Typical OLAP workloads")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "standard" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~15-25MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "MergeTree + Parquet + Date/Time" CACHE STRING "" FORCE)

    # Build mode
    set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "" FORCE)

    # Enable all core components
    set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_STORAGE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMATS ON CACHE BOOL "" FORCE)

    # Storage engines: Memory + MergeTree
    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_ENGINE_LEVEL "light" CACHE STRING "" FORCE)

    # Disable external storage engines
    set(CHDB_ENGINE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_AZURE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_HDFS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_KAFKA OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_RABBITMQ OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_POSTGRESQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MYSQL OFF CACHE BOOL "" FORCE)

    # Formats: JSON, CSV, Parquet
    set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
    set(ENABLE_AVRO OFF CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF OFF CACHE BOOL "" FORCE)
    set(ENABLE_CAPNP OFF CACHE BOOL "" FORCE)
    set(ENABLE_MSGPACK OFF CACHE BOOL "" FORCE)
    set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_NATIVE ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_PARQUET ON CACHE BOOL "" FORCE)

    # Functions: Basic + DateTime
    set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_COMPARISON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_LOGICAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_MINIMAL_FUNCTIONS OFF CACHE BOOL "" FORCE)

    # Aggregates: Basic + Conditional
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # SQL features: Core + CTE + UNION
    set(CHDB_SQL_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE OFF CACHE BOOL "" FORCE)

    # Compression: LZ4 + ZSTD
    set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_ZSTD ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_BROTLI OFF CACHE BOOL "" FORCE)

    # Moderate size optimizations
    set(CHDB_AGGRESSIVE_SIZE_OPT OFF CACHE BOOL "" FORCE)
    set(BUILD_MINIMAL OFF CACHE BOOL "" FORCE)

    # Compile definitions
    add_compile_definitions(
        CHDB_PROFILE_STANDARD=1
        CHDB_ENABLE_MERGETREE=1
        CHDB_ENABLE_PARQUET=1
    )
endmacro()

# ============================================================================
# Profile 4: ANALYTICS (~30-40MB)
# ============================================================================
# Standard + full aggregate functions + window functions + array functions
# Use case: Complex analytics, BI tools, data science workloads
#
# Features:
#   - Everything in Standard
#   - Window functions (ROW_NUMBER, RANK, LAG, LEAD, etc.)
#   - Full aggregate functions (quantiles, histograms, statistics)
#   - Array functions
#   - Map functions
#   - Statistical functions
#   - IP address functions
#   - Advanced JOIN types
#
# NOT included:
#   - No geo functions
#   - No ML functions
#   - No external database connectors

macro(chdb_apply_profile_analytics)
    message(STATUS "")
    message(STATUS "=== Applying ANALYTICS Profile ===")
    message(STATUS "Target: ~30-40MB uncompressed, ~10-15MB gzipped")
    message(STATUS "Use case: Complex analytics, BI tools")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "analytics" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~30-40MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "Full aggregates + window functions" CACHE STRING "" FORCE)

    # Build mode
    set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "" FORCE)

    # Enable all core components
    set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_STORAGE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMATS ON CACHE BOOL "" FORCE)

    # Storage engines: All in-memory compatible
    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_ENGINE_LEVEL "light" CACHE STRING "" FORCE)

    # Disable external storage engines
    set(CHDB_ENGINE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_AZURE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_HDFS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_KAFKA OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_RABBITMQ OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_POSTGRESQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MYSQL OFF CACHE BOOL "" FORCE)

    # Formats: JSON, CSV, Parquet, Arrow
    set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
    set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)
    set(ENABLE_AVRO OFF CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF OFF CACHE BOOL "" FORCE)
    set(ENABLE_CAPNP OFF CACHE BOOL "" FORCE)
    set(ENABLE_MSGPACK ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_NATIVE ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_PARQUET ON CACHE BOOL "" FORCE)

    # Functions: All except geo/ML
    set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_COMPARISON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_LOGICAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_MINIMAL_FUNCTIONS OFF CACHE BOOL "" FORCE)

    # Aggregates: Full set
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # SQL features: Full analytics
    set(CHDB_SQL_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL ON CACHE BOOL "" FORCE)

    # Compression: All
    set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_ZSTD ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_BROTLI OFF CACHE BOOL "" FORCE)

    # No aggressive size optimizations
    set(CHDB_AGGRESSIVE_SIZE_OPT OFF CACHE BOOL "" FORCE)
    set(BUILD_MINIMAL OFF CACHE BOOL "" FORCE)

    # Compile definitions
    add_compile_definitions(
        CHDB_PROFILE_ANALYTICS=1
        CHDB_ENABLE_WINDOW_FUNCTIONS=1
        CHDB_ENABLE_FULL_AGGREGATES=1
    )
endmacro()

# ============================================================================
# Profile 5: FULL (~50MB+)
# ============================================================================
# All engines, all formats, all functions
# Use case: Maximum ClickHouse compatibility
#
# Features:
#   - Everything in Analytics
#   - Geo functions (H3, S2, etc.)
#   - Machine learning functions
#   - All format support
#   - All compression codecs
#   - MaterializedView support (where WASM-compatible)
#   - Dictionary support (local)
#
# NOT included (WASM limitations):
#   - External database connectors (network I/O)
#   - Cloud storage (S3, Azure, GCS)
#   - Message queues (Kafka, RabbitMQ)
#   - Distributed engine (cluster coordination)

macro(chdb_apply_profile_full)
    message(STATUS "")
    message(STATUS "=== Applying FULL Profile ===")
    message(STATUS "Target: ~50MB+ uncompressed, ~15-20MB gzipped")
    message(STATUS "Use case: Maximum ClickHouse compatibility")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "full" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~50MB+" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "All WASM-compatible features" CACHE STRING "" FORCE)

    # Build mode
    set(CHDB_WASM_BUILD_FULL ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_LEXER ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_BUILD_PARSER ON CACHE BOOL "" FORCE)

    # Enable all components
    set(CHDB_ENABLE_EXECUTION ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_STORAGE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_AGGREGATES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMATS ON CACHE BOOL "" FORCE)

    # Storage engines: All WASM-compatible
    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_LOG ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_DICTIONARY ON CACHE BOOL "" FORCE)
    set(CHDB_WASM_ENGINE_LEVEL "custom" CACHE STRING "" FORCE)

    # External engines still disabled (WASM limitations)
    set(CHDB_ENGINE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_AZURE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_HDFS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_KAFKA OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_RABBITMQ OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_POSTGRESQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MYSQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_DISTRIBUTED OFF CACHE BOOL "" FORCE)

    # Formats: All WASM-compatible
    set(ENABLE_PARQUET ON CACHE BOOL "" FORCE)
    set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "" FORCE)  # Requires network
    set(ENABLE_AVRO ON CACHE BOOL "" FORCE)
    set(ENABLE_PROTOBUF ON CACHE BOOL "" FORCE)
    set(ENABLE_CAPNP ON CACHE BOOL "" FORCE)
    set(ENABLE_MSGPACK ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_NATIVE ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_PARQUET ON CACHE BOOL "" FORCE)
    set(CHDB_FORMAT_AVRO ON CACHE BOOL "" FORCE)

    # Functions: All
    set(CHDB_FUNC_ARITHMETIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_COMPARISON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_LOGICAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NLP OFF CACHE BOOL "" FORCE)  # Very large
    set(CHDB_MINIMAL_FUNCTIONS OFF CACHE BOOL "" FORCE)

    # Aggregates: Full set
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # SQL features: All
    set(CHDB_SQL_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL ON CACHE BOOL "" FORCE)

    # Compression: All
    set(CHDB_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_ZSTD ON CACHE BOOL "" FORCE)
    set(CHDB_COMPRESSION_BROTLI ON CACHE BOOL "" FORCE)

    # No size optimizations - prioritize features
    set(CHDB_AGGRESSIVE_SIZE_OPT OFF CACHE BOOL "" FORCE)
    set(BUILD_MINIMAL OFF CACHE BOOL "" FORCE)

    # Compile definitions
    add_compile_definitions(
        CHDB_PROFILE_FULL=1
        CHDB_ENABLE_ALL_FEATURES=1
    )
endmacro()

# ============================================================================
# Profile Application
# ============================================================================

function(chdb_apply_build_profile)
    message(STATUS "")
    message(STATUS "===============================================================")
    message(STATUS "  Applying Build Profile: ${CHDB_PROFILE}")
    message(STATUS "===============================================================")

    if(CHDB_PROFILE STREQUAL "core")
        chdb_apply_profile_core()
    elseif(CHDB_PROFILE STREQUAL "minimal")
        chdb_apply_profile_minimal()
    elseif(CHDB_PROFILE STREQUAL "standard")
        chdb_apply_profile_standard()
    elseif(CHDB_PROFILE STREQUAL "analytics")
        chdb_apply_profile_analytics()
    elseif(CHDB_PROFILE STREQUAL "full")
        chdb_apply_profile_full()
    else()
        message(WARNING "Unknown profile '${CHDB_PROFILE}', defaulting to 'minimal'")
        chdb_apply_profile_minimal()
    endif()
endfunction()

# ============================================================================
# Profile Summary Functions
# ============================================================================

function(chdb_print_profile_summary)
    message(STATUS "")
    message(STATUS "=== Profile Configuration Summary ===")
    message(STATUS "")
    message(STATUS "Profile Name:        ${CHDB_PROFILE_NAME}")
    message(STATUS "Target Size:         ${CHDB_PROFILE_SIZE_TARGET}")
    message(STATUS "Description:         ${CHDB_PROFILE_DESCRIPTION}")
    message(STATUS "")
endfunction()

function(chdb_print_all_profiles)
    message(STATUS "")
    message(STATUS "=== Available Build Profiles ===")
    message(STATUS "")
    message(STATUS "Profile    | Target Size  | Description                    | Use Case")
    message(STATUS "-----------+--------------+--------------------------------+---------------------------")
    message(STATUS "core       | ~50KB        | Parser/Lexer only              | SQL validation, AST gen")
    message(STATUS "minimal    | ~5-10MB      | Memory engine + basic funcs    | Simple in-memory analytics")
    message(STATUS "standard   | ~15-25MB     | + MergeTree + Parquet + Date   | Typical OLAP workloads")
    message(STATUS "analytics  | ~30-40MB     | + Window funcs + full aggs     | Complex analytics, BI")
    message(STATUS "full       | ~50MB+       | All WASM-compatible features   | Max compatibility")
    message(STATUS "")
    message(STATUS "Current profile: ${CHDB_PROFILE}")
    message(STATUS "")
    message(STATUS "To change profile: cmake -DCHDB_PROFILE=<name> ..")
    message(STATUS "")
endfunction()

# ============================================================================
# Profile Feature Comparison
# ============================================================================

function(chdb_print_profile_features)
    message(STATUS "")
    message(STATUS "=== Profile Feature Comparison ===")
    message(STATUS "")
    message(STATUS "Feature                  | core | minimal | standard | analytics | full")
    message(STATUS "-------------------------+------+---------+----------+-----------+------")
    message(STATUS "Parser/Lexer             |  Y   |    Y    |    Y     |     Y     |  Y")
    message(STATUS "Query Execution          |  -   |    Y    |    Y     |     Y     |  Y")
    message(STATUS "Memory Engine            |  -   |    Y    |    Y     |     Y     |  Y")
    message(STATUS "MergeTree Engine         |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "System Tables            |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "JSON/CSV Formats         |  -   |    Y    |    Y     |     Y     |  Y")
    message(STATUS "Parquet Format           |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "Avro/Protobuf Formats    |  -   |    -    |    -     |     -     |  Y")
    message(STATUS "Basic Functions          |  -   |    Y    |    Y     |     Y     |  Y")
    message(STATUS "Date/Time Functions      |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "Array/Map Functions      |  -   |    -    |    -     |     Y     |  Y")
    message(STATUS "Window Functions         |  -   |    -    |    -     |     Y     |  Y")
    message(STATUS "Statistical Aggregates   |  -   |    -    |    -     |     Y     |  Y")
    message(STATUS "Geo Functions            |  -   |    -    |    -     |     -     |  Y")
    message(STATUS "ML Functions             |  -   |    -    |    -     |     -     |  Y")
    message(STATUS "CTEs (WITH clause)       |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "UNION                    |  -   |    -    |    Y     |     Y     |  Y")
    message(STATUS "Advanced JOINs           |  -   |    -    |    -     |     Y     |  Y")
    message(STATUS "ARRAY JOIN               |  -   |    -    |    -     |     Y     |  Y")
    message(STATUS "")
    message(STATUS "Y = Included, - = Not included")
    message(STATUS "")
endfunction()

# ============================================================================
# Auto-apply profile when included
# ============================================================================

# Apply the selected profile
chdb_apply_build_profile()

# Print summary
chdb_print_profile_summary()
