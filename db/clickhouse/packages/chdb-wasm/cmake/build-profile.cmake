# build-profile.cmake
# Master Profile Selector for chdb-wasm WASM Build
#
# This module provides a unified interface for selecting and applying
# build profiles based on the CHDB_PROFILE variable.
#
# Usage:
#   cmake -DCHDB_PROFILE=dashboard ..
#   cmake -DCHDB_PROFILE=analytics ..
#
# Profiles (6 Core WASM Build Profiles):
#
#   Profile         | Target Size  | Use Case
#   ----------------+--------------+------------------------------------------
#   parser          | ~300KB       | SQL validation, IDE integration
#   dashboard       | ~3MB         | Simple dashboards, small data
#   analytics       | ~8MB         | ClickBench-style analytics
#   etl             | ~12-15MB     | Data transformation pipelines
#   lakehouse       | ~18-20MB     | Query data lakes directly (S3/R2)
#   full            | ~25MB+       | Maximum ClickHouse compatibility
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Profile Selection
# ============================================================================

set(CHDB_PROFILE "dashboard" CACHE STRING "Build profile for chdb-wasm")
set_property(CACHE CHDB_PROFILE PROPERTY STRINGS
    "parser"
    "dashboard"
    "analytics"
    "etl"
    "lakehouse"
    "full"
)

# ============================================================================
# Profile Size Targets
# ============================================================================
#
# Profile      | Target Size | Gzipped   | Primary Use Case
# -------------+-------------+-----------+------------------------------------------
# parser       | ~300KB      | ~100KB    | SQL validation, IDE syntax checking
# dashboard    | ~3MB        | ~1MB      | Simple dashboards, small datasets
# analytics    | ~8MB        | ~2.5MB    | ClickBench-style OLAP analytics
# etl          | ~12-15MB    | ~4-5MB    | Data transformation with Parquet/Arrow
# lakehouse    | ~18-20MB    | ~6-7MB    | Query S3/R2/URL data sources directly
# full         | ~25MB+      | ~8MB+     | Maximum ClickHouse WASM compatibility
#
# ============================================================================

# ============================================================================
# Profile 1: PARSER (~300KB)
# ============================================================================
# SQL lexer and parser only - no execution engine
# Use case: SQL validation, IDE integration, syntax checking
#
# Features:
#   - SQL Lexer (tokenization)
#   - SQL Parser (AST generation)
#   - Syntax validation
#   - SQL formatting/pretty-printing
#   - Query type detection
#
# NOT included:
#   - No query execution
#   - No storage engines
#   - No data formats
#   - No functions

macro(chdb_apply_profile_parser)
    message(STATUS "")
    message(STATUS "=== Applying PARSER Profile ===")
    message(STATUS "Target: ~300KB uncompressed")
    message(STATUS "Use case: SQL validation, IDE integration")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "parser" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-parser" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~300KB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "SQL lexer and parser only" CACHE STRING "" FORCE)

    # Include the detailed profile configuration
    include(${CMAKE_CURRENT_LIST_DIR}/profiles/parser.cmake)
endmacro()

# ============================================================================
# Profile 2: DASHBOARD (~3MB)
# ============================================================================
# Memory engine with basic aggregates for simple dashboards
# Use case: Simple dashboards, small data visualization
#
# Features:
#   - Memory storage engine
#   - Basic aggregates (COUNT, SUM, AVG, MIN, MAX)
#   - JSON, CSV, TSV formats
#   - Basic string and math functions
#   - Core SQL features
#
# NOT included:
#   - No MergeTree (no persistence)
#   - No Parquet/Arrow
#   - No window functions
#   - No advanced aggregates

macro(chdb_apply_profile_dashboard)
    message(STATUS "")
    message(STATUS "=== Applying DASHBOARD Profile ===")
    message(STATUS "Target: ~3MB uncompressed")
    message(STATUS "Use case: Simple dashboards, small data")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "dashboard" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-dashboard" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~3MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "Memory engine + basic aggregates" CACHE STRING "" FORCE)

    include(${CMAKE_CURRENT_LIST_DIR}/profiles/dashboard.cmake)
endmacro()

# ============================================================================
# Profile 3: ANALYTICS (~8MB)
# ============================================================================
# MergeTree read + all aggregates for OLAP analytics
# Use case: ClickBench-style analytics, time-series, log analysis
#
# Features:
#   - Memory + MergeTree (all variants)
#   - All aggregate functions
#   - Full date/time functions
#   - JSON, CSV, TSV formats
#   - CTEs, UNION, advanced JOINs
#
# NOT included:
#   - No Parquet/Arrow (see ETL profile)
#   - No window functions
#   - No S3/URL table functions

macro(chdb_apply_profile_analytics)
    message(STATUS "")
    message(STATUS "=== Applying ANALYTICS Profile ===")
    message(STATUS "Target: ~8MB uncompressed")
    message(STATUS "Use case: ClickBench-style analytics")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "analytics" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-analytics" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~8MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "MergeTree + all aggregates" CACHE STRING "" FORCE)

    include(${CMAKE_CURRENT_LIST_DIR}/profiles/analytics.cmake)
endmacro()

# ============================================================================
# Profile 4: ETL (~12-15MB)
# ============================================================================
# Analytics + Parquet/Arrow for data transformation pipelines
# Use case: ETL workloads, Parquet processing, data conversion
#
# Features:
#   - Everything in analytics
#   - Parquet reader/writer
#   - Arrow format support
#   - Array/Map functions
#   - Window functions
#
# NOT included:
#   - No S3/URL table functions (see lakehouse)
#   - No geo functions

macro(chdb_apply_profile_etl)
    message(STATUS "")
    message(STATUS "=== Applying ETL Profile ===")
    message(STATUS "Target: ~12-15MB uncompressed")
    message(STATUS "Use case: Data transformation pipelines")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "etl" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-etl" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~12-15MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "Parquet/Arrow for ETL" CACHE STRING "" FORCE)

    include(${CMAKE_CURRENT_LIST_DIR}/profiles/etl.cmake)
endmacro()

# ============================================================================
# Profile 5: LAKEHOUSE (~18-20MB)
# ============================================================================
# ETL + S3/R2/URL table functions for data lake access
# Use case: Query data lakes directly from browser/worker
#
# Features:
#   - Everything in ETL
#   - S3 table function (works with R2, MinIO)
#   - URL table function
#   - HTTP/HTTPS support
#   - IP address functions
#
# NOT included:
#   - No geo functions
#   - No full AWS SDK

macro(chdb_apply_profile_lakehouse)
    message(STATUS "")
    message(STATUS "=== Applying LAKEHOUSE Profile ===")
    message(STATUS "Target: ~18-20MB uncompressed")
    message(STATUS "Use case: Query data lakes directly")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "lakehouse" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-lakehouse" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~18-20MB" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "S3/R2/URL table functions" CACHE STRING "" FORCE)

    include(${CMAKE_CURRENT_LIST_DIR}/profiles/lakehouse.cmake)
endmacro()

# ============================================================================
# Profile 6: FULL (~25MB+)
# ============================================================================
# Everything possible for maximum ClickHouse WASM compatibility
# Use case: Maximum feature parity, complex analytics, geo
#
# Features:
#   - Everything in lakehouse
#   - Geo functions (H3, S2)
#   - All format support (Avro, Protobuf, MsgPack)
#   - All compression (LZ4, ZSTD, Brotli)
#   - All SQL features
#
# NOT included (WASM limitations):
#   - No external database connectors
#   - No LLVM JIT
#   - No message queues

macro(chdb_apply_profile_full)
    message(STATUS "")
    message(STATUS "=== Applying FULL Profile ===")
    message(STATUS "Target: ~25MB+ uncompressed")
    message(STATUS "Use case: Maximum ClickHouse compatibility")
    message(STATUS "")

    set(CHDB_PROFILE_NAME "full" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_OUTPUT_NAME "chdb-full" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_SIZE_TARGET "~25MB+" CACHE STRING "" FORCE)
    set(CHDB_PROFILE_DESCRIPTION "All WASM-compatible features" CACHE STRING "" FORCE)

    include(${CMAKE_CURRENT_LIST_DIR}/profiles/full.cmake)
endmacro()

# ============================================================================
# Profile Application
# ============================================================================

function(chdb_apply_build_profile)
    message(STATUS "")
    message(STATUS "===============================================================")
    message(STATUS "  Applying Build Profile: ${CHDB_PROFILE}")
    message(STATUS "===============================================================")

    if(CHDB_PROFILE STREQUAL "parser")
        chdb_apply_profile_parser()
    elseif(CHDB_PROFILE STREQUAL "dashboard")
        chdb_apply_profile_dashboard()
    elseif(CHDB_PROFILE STREQUAL "analytics")
        chdb_apply_profile_analytics()
    elseif(CHDB_PROFILE STREQUAL "etl")
        chdb_apply_profile_etl()
    elseif(CHDB_PROFILE STREQUAL "lakehouse")
        chdb_apply_profile_lakehouse()
    elseif(CHDB_PROFILE STREQUAL "full")
        chdb_apply_profile_full()
    else()
        message(WARNING "Unknown profile '${CHDB_PROFILE}', defaulting to 'dashboard'")
        chdb_apply_profile_dashboard()
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
    message(STATUS "Output Name:         ${CHDB_PROFILE_OUTPUT_NAME}.wasm")
    message(STATUS "Target Size:         ${CHDB_PROFILE_SIZE_TARGET}")
    message(STATUS "Description:         ${CHDB_PROFILE_DESCRIPTION}")
    message(STATUS "")
endfunction()

function(chdb_print_all_profiles)
    message(STATUS "")
    message(STATUS "=== Available Build Profiles (6 Core Profiles) ===")
    message(STATUS "")
    message(STATUS "Profile      | Target Size  | Output Name          | Use Case")
    message(STATUS "-------------+--------------+----------------------+----------------------------")
    message(STATUS "parser       | ~300KB       | chdb-parser.wasm     | SQL validation, IDE")
    message(STATUS "dashboard    | ~3MB         | chdb-dashboard.wasm  | Simple dashboards")
    message(STATUS "analytics    | ~8MB         | chdb-analytics.wasm  | ClickBench-style OLAP")
    message(STATUS "etl          | ~12-15MB     | chdb-etl.wasm        | Parquet/Arrow ETL")
    message(STATUS "lakehouse    | ~18-20MB     | chdb-lakehouse.wasm  | S3/R2 data lakes")
    message(STATUS "full         | ~25MB+       | chdb-full.wasm       | Max compatibility")
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
    message(STATUS "Feature                 | parser | dashboard | analytics | etl | lakehouse | full")
    message(STATUS "------------------------+--------+-----------+-----------+-----+-----------+------")
    message(STATUS "SQL Parser/Lexer        |   Y    |     Y     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "Query Execution         |   -    |     Y     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "Memory Engine           |   -    |     Y     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "MergeTree Engine        |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "System Tables           |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "JSON/CSV/TSV            |   -    |     Y     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "Parquet/Arrow           |   -    |     -     |     -     |  Y  |     Y     |   Y")
    message(STATUS "Avro/Protobuf           |   -    |     -     |     -     |  -  |     -     |   Y")
    message(STATUS "Basic Functions         |   -    |     Y     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "DateTime Functions      |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "Array/Map Functions     |   -    |     -     |     -     |  Y  |     Y     |   Y")
    message(STATUS "Window Functions        |   -    |     -     |     -     |  Y  |     Y     |   Y")
    message(STATUS "All Aggregates          |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "IP Functions            |   -    |     -     |     -     |  -  |     Y     |   Y")
    message(STATUS "Geo Functions           |   -    |     -     |     -     |  -  |     -     |   Y")
    message(STATUS "S3/URL Table Functions  |   -    |     -     |     -     |  -  |     Y     |   Y")
    message(STATUS "CTEs (WITH clause)      |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "UNION                   |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "Advanced JOINs          |   -    |     -     |     Y     |  Y  |     Y     |   Y")
    message(STATUS "ARRAY JOIN              |   -    |     -     |     -     |  Y  |     Y     |   Y")
    message(STATUS "")
    message(STATUS "Y = Included, - = Not included")
    message(STATUS "")
endfunction()

# ============================================================================
# Profile Selection by Use Case
# ============================================================================

function(chdb_recommend_profile USE_CASE)
    message(STATUS "")
    message(STATUS "=== Profile Recommendation ===")
    message(STATUS "")

    if(USE_CASE STREQUAL "sql-validation" OR USE_CASE STREQUAL "ide")
        message(STATUS "For ${USE_CASE}: Use 'parser' profile (~300KB)")
        message(STATUS "  cmake -DCHDB_PROFILE=parser ..")
    elseif(USE_CASE STREQUAL "simple-dashboard" OR USE_CASE STREQUAL "small-data")
        message(STATUS "For ${USE_CASE}: Use 'dashboard' profile (~3MB)")
        message(STATUS "  cmake -DCHDB_PROFILE=dashboard ..")
    elseif(USE_CASE STREQUAL "olap" OR USE_CASE STREQUAL "clickbench" OR USE_CASE STREQUAL "time-series")
        message(STATUS "For ${USE_CASE}: Use 'analytics' profile (~8MB)")
        message(STATUS "  cmake -DCHDB_PROFILE=analytics ..")
    elseif(USE_CASE STREQUAL "etl" OR USE_CASE STREQUAL "parquet" OR USE_CASE STREQUAL "data-pipeline")
        message(STATUS "For ${USE_CASE}: Use 'etl' profile (~12-15MB)")
        message(STATUS "  cmake -DCHDB_PROFILE=etl ..")
    elseif(USE_CASE STREQUAL "data-lake" OR USE_CASE STREQUAL "s3" OR USE_CASE STREQUAL "r2")
        message(STATUS "For ${USE_CASE}: Use 'lakehouse' profile (~18-20MB)")
        message(STATUS "  cmake -DCHDB_PROFILE=lakehouse ..")
    elseif(USE_CASE STREQUAL "full-compatibility" OR USE_CASE STREQUAL "geo" OR USE_CASE STREQUAL "production")
        message(STATUS "For ${USE_CASE}: Use 'full' profile (~25MB+)")
        message(STATUS "  cmake -DCHDB_PROFILE=full ..")
    else()
        message(STATUS "Unknown use case '${USE_CASE}'")
        message(STATUS "Available use cases: sql-validation, ide, simple-dashboard, small-data,")
        message(STATUS "                     olap, clickbench, time-series, etl, parquet,")
        message(STATUS "                     data-pipeline, data-lake, s3, r2, full-compatibility,")
        message(STATUS "                     geo, production")
    endif()

    message(STATUS "")
endfunction()

# ============================================================================
# Auto-apply profile when included
# ============================================================================

# Apply the selected profile
chdb_apply_build_profile()

# Print summary
chdb_print_profile_summary()
