# wasm-engines.cmake
# Storage Engine Configuration for WASM Build
#
# This module configures which ClickHouse storage engines are included in the WASM build.
# MergeTree and other heavy engines use mmap/file I/O incompatible with WASM.
# Memory engine is pure RAM and fully compatible.
#
# Usage:
#   include(wasm-engines.cmake)
#   chdb_configure_wasm_engines()

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Storage Engine Classification
# ============================================================================
#
# ESSENTIAL ENGINES (included in WASM build):
# - Memory:           Pure RAM storage, fully WASM compatible (~27KB source)
# - View:             SQL view definition, no storage (~14KB source)
# - System:           Read-only metadata tables (~1.5MB total, but critical)
# - Null:             /dev/null equivalent, useful for testing (~2.7KB source)
#
# OPTIONAL LIGHT ENGINES (configurable):
# - Set:              In-memory set storage (~10KB source)
# - Join:             In-memory join storage (~30KB source)
# - Buffer:           In-memory buffer (~52KB source)
# - GenerateRandom:   Random data generator (~28KB source)
# - Values:           Inline values storage (~2.6KB source)
#
# DISABLED HEAVY ENGINES (stubbed):
#
# MergeTree Family (4.3MB source):
# - MergeTree, ReplicatedMergeTree, SummingMergeTree, etc.
# - Reason: Uses mmap, file I/O, complex threading
# - Size savings: ~4.3MB source, ~2-3MB compiled
#
# Distributed/Cluster (~148KB source):
# - Distributed, IStorageCluster
# - Reason: Network I/O, cluster coordination
# - Size savings: ~100-200KB compiled
#
# Message Queues (~556KB source):
# - Kafka (~312KB), RabbitMQ (~140KB), NATS (~104KB)
# - Reason: External library dependencies, network I/O
# - Size savings: ~500KB-1MB compiled + external libs
#
# Object Storage (~1.1MB source):
# - S3, AzureBlobStorage, HDFS, ObjectStorage
# - Reason: AWS/Azure SDKs, network I/O
# - Size savings: ~1-2MB compiled + SDK dependencies (~5-10MB)
#
# External Databases (~440KB source):
# - PostgreSQL (~152KB), MySQL (~20KB), MongoDB, Redis, SQLite
# - Reason: Database client libraries, network I/O
# - Size savings: ~300-500KB compiled + client libs (~2-5MB)
#
# File-based Engines (~180KB source):
# - File (~96KB), FileLog (~104KB)
# - Reason: Local filesystem access
# - Size savings: ~100-150KB compiled
#
# Complex Views (~248KB source):
# - MaterializedView (~96KB), LiveView (~60KB), WindowView (~88KB)
# - Reason: Background processing, complex state
# - Size savings: ~150-250KB compiled
#
# Other Heavy Engines:
# - Log (~44KB), StripeLog (~25KB) - File I/O
# - TimeSeries (~192KB) - Complex indexing
# - Dictionary (~17KB) - External data sources
# - RocksDB (~84KB) - External storage engine
# - Hive (~116KB) - HDFS dependency
# - KeeperMap (~62KB) - ZooKeeper dependency
#
# ============================================================================
# Size Impact Summary
# ============================================================================
#
# Component               | Source Size | Est. Compiled | Dependencies
# ------------------------+-------------+---------------+---------------
# MergeTree family        | 4.3 MB      | 2-3 MB        | -
# Object Storage          | 1.1 MB      | 1-2 MB        | 5-10 MB (SDKs)
# System tables           | 1.5 MB      | 0.5-1 MB      | - (essential)
# Message queues          | 556 KB      | 500 KB-1 MB   | 3-5 MB (libs)
# External databases      | 440 KB      | 300-500 KB    | 2-5 MB (libs)
# Complex views           | 248 KB      | 150-250 KB    | -
# File-based              | 180 KB      | 100-150 KB    | -
# ------------------------+-------------+---------------+---------------
# TOTAL SAVINGS           | ~8.3 MB     | ~5-8 MB       | ~15-25 MB
# Essential only          | ~35 KB      | ~20-30 KB     | - (Memory+View+Null)
#
# ============================================================================
# Configuration Options
# ============================================================================

# Engine inclusion levels
set(CHDB_WASM_ENGINE_LEVEL "essential" CACHE STRING "Storage engine inclusion level")
set_property(CACHE CHDB_WASM_ENGINE_LEVEL PROPERTY STRINGS
    "minimal"     # Memory only
    "essential"   # Memory, View, System, Null
    "light"       # + Set, Join, Buffer, GenerateRandom, Values
    "custom"      # Manual selection
)

# Individual engine toggles (for custom level)
option(CHDB_ENGINE_MEMORY "Include Memory storage engine" ON)
option(CHDB_ENGINE_VIEW "Include View storage engine" ON)
option(CHDB_ENGINE_SYSTEM "Include System tables" ON)
option(CHDB_ENGINE_NULL "Include Null storage engine" ON)
option(CHDB_ENGINE_SET "Include Set storage engine" OFF)
option(CHDB_ENGINE_JOIN "Include Join storage engine" OFF)
option(CHDB_ENGINE_BUFFER "Include Buffer storage engine" OFF)
option(CHDB_ENGINE_GENERATE_RANDOM "Include GenerateRandom storage engine" OFF)
option(CHDB_ENGINE_VALUES "Include Values storage engine" OFF)

# Heavy engines (always disabled in WASM)
option(CHDB_ENGINE_MERGETREE "Include MergeTree family engines" OFF)
option(CHDB_ENGINE_DISTRIBUTED "Include Distributed engine" OFF)
option(CHDB_ENGINE_KAFKA "Include Kafka engine" OFF)
option(CHDB_ENGINE_RABBITMQ "Include RabbitMQ engine" OFF)
option(CHDB_ENGINE_NATS "Include NATS engine" OFF)
option(CHDB_ENGINE_S3 "Include S3 storage engine" OFF)
option(CHDB_ENGINE_AZURE "Include Azure Blob Storage engine" OFF)
option(CHDB_ENGINE_HDFS "Include HDFS storage engine" OFF)
option(CHDB_ENGINE_POSTGRESQL "Include PostgreSQL engine" OFF)
option(CHDB_ENGINE_MYSQL "Include MySQL engine" OFF)
option(CHDB_ENGINE_MONGODB "Include MongoDB engine" OFF)
option(CHDB_ENGINE_REDIS "Include Redis engine" OFF)
option(CHDB_ENGINE_SQLITE "Include SQLite engine" OFF)
option(CHDB_ENGINE_FILE "Include File engine" OFF)
option(CHDB_ENGINE_URL "Include URL engine" OFF)
option(CHDB_ENGINE_LOG "Include Log/StripeLog engines" OFF)
option(CHDB_ENGINE_MATERIALIZED_VIEW "Include MaterializedView engine" OFF)
option(CHDB_ENGINE_LIVE_VIEW "Include LiveView engine" OFF)
option(CHDB_ENGINE_WINDOW_VIEW "Include WindowView engine" OFF)
option(CHDB_ENGINE_TIMESERIES "Include TimeSeries engine" OFF)
option(CHDB_ENGINE_DICTIONARY "Include Dictionary engine" OFF)
option(CHDB_ENGINE_ROCKSDB "Include RocksDB engine" OFF)
option(CHDB_ENGINE_HIVE "Include Hive engine" OFF)
option(CHDB_ENGINE_KEEPER_MAP "Include KeeperMap engine" OFF)

# ============================================================================
# Engine Level Macros
# ============================================================================

macro(chdb_apply_engine_level_minimal)
    message(STATUS "WASM Engines: Applying 'minimal' level (Memory only)")

    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES OFF CACHE BOOL "" FORCE)

    # Heavy engines always off
    chdb_disable_heavy_engines()
endmacro()

macro(chdb_apply_engine_level_essential)
    message(STATUS "WASM Engines: Applying 'essential' level (Memory, View, System, Null)")

    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES OFF CACHE BOOL "" FORCE)

    # Heavy engines always off
    chdb_disable_heavy_engines()
endmacro()

macro(chdb_apply_engine_level_light)
    message(STATUS "WASM Engines: Applying 'light' level (all in-memory engines)")

    set(CHDB_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SYSTEM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SET ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_BUFFER ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_GENERATE_RANDOM ON CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_VALUES ON CACHE BOOL "" FORCE)

    # Heavy engines always off
    chdb_disable_heavy_engines()
endmacro()

macro(chdb_disable_heavy_engines)
    # These engines are NEVER included in WASM builds
    set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_DISTRIBUTED OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_KAFKA OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_RABBITMQ OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_NATS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_AZURE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_HDFS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_POSTGRESQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MYSQL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MONGODB OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_REDIS OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_SQLITE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_FILE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_URL OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_LOG OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_MATERIALIZED_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_LIVE_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_WINDOW_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_TIMESERIES OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_DICTIONARY OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_ROCKSDB OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_HIVE OFF CACHE BOOL "" FORCE)
    set(CHDB_ENGINE_KEEPER_MAP OFF CACHE BOOL "" FORCE)
endmacro()

# ============================================================================
# Apply Configuration
# ============================================================================

function(chdb_configure_wasm_engines)
    if(CHDB_WASM_ENGINE_LEVEL STREQUAL "minimal")
        chdb_apply_engine_level_minimal()
    elseif(CHDB_WASM_ENGINE_LEVEL STREQUAL "essential")
        chdb_apply_engine_level_essential()
    elseif(CHDB_WASM_ENGINE_LEVEL STREQUAL "light")
        chdb_apply_engine_level_light()
    elseif(CHDB_WASM_ENGINE_LEVEL STREQUAL "custom")
        message(STATUS "WASM Engines: Using 'custom' level (manual configuration)")
        chdb_disable_heavy_engines()  # Still disable heavy engines
    else()
        message(WARNING "Unknown engine level '${CHDB_WASM_ENGINE_LEVEL}', using 'essential'")
        chdb_apply_engine_level_essential()
    endif()
endfunction()

# ============================================================================
# Storage Source File Lists
# ============================================================================

# Essential storage sources (always included)
set(CHDB_WASM_ESSENTIAL_STORAGE_SOURCES
    # Memory engine
    StorageMemory.cpp
    MemorySettings.cpp

    # View engine
    StorageView.cpp

    # Null engine
    StorageNull.cpp

    # Values (inline data)
    StorageValues.cpp

    # Core infrastructure
    IStorage.cpp
    StorageFactory.cpp
    StorageInMemoryMetadata.cpp
    StorageSnapshot.cpp
    ColumnsDescription.cpp
    ColumnDefault.cpp
    ColumnDependency.cpp
    KeyDescription.cpp
    ConstraintsDescription.cpp
    IndicesDescription.cpp
    ProjectionsDescription.cpp
    StatisticsDescription.cpp
    SelectQueryDescription.cpp
    SelectQueryInfo.cpp
    TTLDescription.cpp
    VirtualColumnsDescription.cpp
    VirtualColumnUtils.cpp
    AlterCommands.cpp
    MutationCommands.cpp
    PartitionCommands.cpp
)

# Light storage sources (optional in-memory engines)
set(CHDB_WASM_LIGHT_STORAGE_SOURCES
    # Set engine
    StorageSet.cpp
    SetSettings.cpp

    # Join engine
    StorageJoin.cpp

    # Buffer engine
    StorageBuffer.cpp

    # GenerateRandom
    StorageGenerateRandom.cpp
)

# MergeTree sources (EXCLUDED - uses mmap/file I/O)
set(CHDB_WASM_MERGETREE_EXCLUDED_SOURCES
    # Main engines
    StorageMergeTree.cpp          # 2936 lines, ~122KB
    StorageReplicatedMergeTree.cpp # 11308 lines, ~504KB
    StorageMergeTreeIndex.cpp     # 454 lines, ~17KB

    # MergeTree directory - entire directory (~4.3MB)
    # Contains 280+ files for:
    # - Data parts management
    # - Merge operations
    # - Mutations
    # - Projections
    # - Indexes (primary, skip, full-text)
    # - Compression
    # - Replication protocol
)

# Distributed sources (EXCLUDED - network I/O)
set(CHDB_WASM_DISTRIBUTED_EXCLUDED_SOURCES
    StorageDistributed.cpp        # 2202 lines, ~90KB

    # Distributed directory (~148KB)
    # Contains:
    # - Shard routing
    # - Async inserts
    # - Cluster coordination
)

# Message queue sources (EXCLUDED - external libs + network)
set(CHDB_WASM_MESSAGEQUEUE_EXCLUDED_SOURCES
    # Kafka directory (~312KB)
    # RabbitMQ directory (~140KB)
    # NATS directory (~104KB)
    # FileLog directory (~104KB)
)

# Object storage sources (EXCLUDED - SDKs + network)
set(CHDB_WASM_OBJECTSTORAGE_EXCLUDED_SOURCES
    # ObjectStorage directory (~1.1MB)
    # Contains S3, Azure, HDFS integrations
)

# External database sources (EXCLUDED - client libs + network)
set(CHDB_WASM_EXTERNAL_DB_EXCLUDED_SOURCES
    StoragePostgreSQL.cpp         # 648 lines
    StorageMySQL.cpp              # 398 lines
    StorageMongoDB.cpp            # 615 lines
    StorageRedis.cpp              # 675 lines
    StorageSQLite.cpp             # 210 lines

    # PostgreSQL directory (~152KB)
    # MySQL directory (~20KB)
)

# File-based sources (EXCLUDED - filesystem access)
set(CHDB_WASM_FILE_EXCLUDED_SOURCES
    StorageFile.cpp               # 2411 lines, ~96KB
    StorageURL.cpp                # 1757 lines, ~67KB
    StorageFileCluster.cpp
    StorageURLCluster.cpp
)

# Complex view sources (EXCLUDED - background processing)
set(CHDB_WASM_COMPLEXVIEW_EXCLUDED_SOURCES
    StorageMaterializedView.cpp   # 988 lines, ~44KB

    # MaterializedView directory (~96KB)
    # LiveView directory (~60KB)
    # WindowView directory (~88KB)
)

# ============================================================================
# Stub Registration
# ============================================================================

# List of engines that need stub registration
set(CHDB_WASM_STUBBED_ENGINES
    # MergeTree family
    "MergeTree"
    "ReplicatedMergeTree"
    "SummingMergeTree"
    "ReplicatedSummingMergeTree"
    "AggregatingMergeTree"
    "ReplicatedAggregatingMergeTree"
    "ReplacingMergeTree"
    "ReplicatedReplacingMergeTree"
    "CollapsingMergeTree"
    "ReplicatedCollapsingMergeTree"
    "VersionedCollapsingMergeTree"
    "ReplicatedVersionedCollapsingMergeTree"
    "GraphiteMergeTree"
    "ReplicatedGraphiteMergeTree"

    # Distributed
    "Distributed"

    # Message queues
    "Kafka"
    "RabbitMQ"
    "NATS"
    "FileLog"

    # Object storage
    "S3"
    "S3Queue"
    "AzureBlobStorage"
    "AzureQueue"
    "HDFS"
    "Hudi"
    "DeltaLake"
    "Iceberg"

    # External databases
    "PostgreSQL"
    "MaterializedPostgreSQL"
    "MySQL"
    "MongoDB"
    "Redis"
    "SQLite"

    # File-based
    "File"
    "URL"

    # Complex views
    "MaterializedView"
    "LiveView"
    "WindowView"

    # Other
    "Log"
    "TinyLog"
    "StripeLog"
    "TimeSeries"
    "Dictionary"
    "EmbeddedRocksDB"
    "Hive"
    "KeeperMap"
    "Executable"
    "ExecutablePool"
    "Loop"
    "Merge"
    "FuzzQuery"
    "FuzzJSON"
    "ArrowFlight"
    "ODBC"
    "JDBC"
    "PrometheusQuery"
    "XDBC"
    "YTsaurus"
)

# ============================================================================
# Compile Definitions
# ============================================================================

function(chdb_apply_engine_definitions TARGET)
    # Add compile definitions based on engine configuration
    if(CHDB_ENGINE_MEMORY)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_MEMORY=1)
    endif()
    if(CHDB_ENGINE_VIEW)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_VIEW=1)
    endif()
    if(CHDB_ENGINE_SYSTEM)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_SYSTEM=1)
    endif()
    if(CHDB_ENGINE_NULL)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_NULL=1)
    endif()
    if(CHDB_ENGINE_SET)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_SET=1)
    endif()
    if(CHDB_ENGINE_JOIN)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_JOIN=1)
    endif()
    if(CHDB_ENGINE_BUFFER)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_BUFFER=1)
    endif()
    if(CHDB_ENGINE_GENERATE_RANDOM)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_GENERATE_RANDOM=1)
    endif()
    if(CHDB_ENGINE_VALUES)
        target_compile_definitions(${TARGET} PRIVATE CHDB_ENGINE_VALUES=1)
    endif()

    # Add stub indicator
    target_compile_definitions(${TARGET} PRIVATE USE_WASM_ENGINE_STUBS=1)
endfunction()

# ============================================================================
# Summary Output
# ============================================================================

function(chdb_print_engine_summary)
    message(STATUS "")
    message(STATUS "=== WASM Storage Engine Configuration ===")
    message(STATUS "")
    message(STATUS "Engine Level: ${CHDB_WASM_ENGINE_LEVEL}")
    message(STATUS "")
    message(STATUS "INCLUDED ENGINES:")
    if(CHDB_ENGINE_MEMORY)
        message(STATUS "  [x] Memory          (pure RAM, ~27KB source)")
    endif()
    if(CHDB_ENGINE_VIEW)
        message(STATUS "  [x] View            (SQL views, ~14KB source)")
    endif()
    if(CHDB_ENGINE_SYSTEM)
        message(STATUS "  [x] System          (metadata tables, ~1.5MB source)")
    endif()
    if(CHDB_ENGINE_NULL)
        message(STATUS "  [x] Null            (discard sink, ~3KB source)")
    endif()
    if(CHDB_ENGINE_SET)
        message(STATUS "  [x] Set             (in-memory set, ~10KB source)")
    endif()
    if(CHDB_ENGINE_JOIN)
        message(STATUS "  [x] Join            (in-memory join, ~30KB source)")
    endif()
    if(CHDB_ENGINE_BUFFER)
        message(STATUS "  [x] Buffer          (in-memory buffer, ~52KB source)")
    endif()
    if(CHDB_ENGINE_GENERATE_RANDOM)
        message(STATUS "  [x] GenerateRandom  (test data, ~28KB source)")
    endif()
    if(CHDB_ENGINE_VALUES)
        message(STATUS "  [x] Values          (inline values, ~3KB source)")
    endif()
    message(STATUS "")
    message(STATUS "EXCLUDED (stubbed) - Size savings:")
    message(STATUS "  [ ] MergeTree family     ~4.3MB source, ~2-3MB compiled")
    message(STATUS "  [ ] Distributed          ~148KB source, ~100-200KB compiled")
    message(STATUS "  [ ] Object Storage       ~1.1MB source + 5-10MB SDKs")
    message(STATUS "  [ ] Message Queues       ~556KB source + 3-5MB libs")
    message(STATUS "  [ ] External Databases   ~440KB source + 2-5MB libs")
    message(STATUS "  [ ] File-based           ~180KB source")
    message(STATUS "  [ ] Complex Views        ~248KB source")
    message(STATUS "")
    message(STATUS "TOTAL ESTIMATED SAVINGS: ~8MB source, ~20-30MB compiled+deps")
    message(STATUS "")
endfunction()

# ============================================================================
# Auto-configure on include
# ============================================================================

# Apply configuration when this file is included
chdb_configure_wasm_engines()

# Print summary
chdb_print_engine_summary()
