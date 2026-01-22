# wasm-mergetree.cmake
# CMake configuration for building a full MergeTree WASM module
#
# This configuration builds a complete MergeTree reader for WASM, including:
# - Full MergeTreeReader (Wide and Compact parts)
# - Compression codecs (LZ4, ZSTD, None)
# - Mark file handling (.mrk2, .mrk3)
# - Primary index reading
# - VFS bridge for Cloudflare R2/Durable Objects
# - MergeTree variants (Replacing, Summing, Aggregating, Collapsing, etc.)
#
# Supported MergeTree Variants:
# - MergeTree (Ordinary) - Base engine, no special merge behavior
# - ReplacingMergeTree - Deduplication by version column
# - SummingMergeTree - Automatic summation of numeric columns
# - AggregatingMergeTree - Pre-aggregation with aggregate function states
# - CollapsingMergeTree - Row collapsing by sign column
# - VersionedCollapsingMergeTree - Versioned row collapsing
# - GraphiteMergeTree - Time series aggregation for Graphite
# - CoalescingMergeTree - Like Summing but keeps non-null values
#
# Current Status:
# - mergetree.wasm (284KB) uses MergeTreeStandalone.h stubs
# - This config defines requirements for full MergeTree integration
#
# Usage:
#   include(cmake/wasm-mergetree.cmake)
#   # Then call build_mergetree_wasm() in your CMakeLists.txt
#
# See also:
#   - wasm/docs/MERGETREE_BUILD.md (full documentation)
#   - wasm/docs/MERGETREE_VFS_DESIGN.md (VFS architecture)

cmake_minimum_required(VERSION 3.20)

# =============================================================================
# Configuration Options
# =============================================================================

# Build level options
option(MERGETREE_WASM_STANDALONE "Build with standalone stubs (current)" ON)
option(MERGETREE_WASM_FULL "Build with full ClickHouse MergeTree sources" OFF)
option(MERGETREE_WASM_COMPRESSION "Include compression codecs (LZ4, ZSTD)" OFF)

# Feature toggles
option(MERGETREE_ENABLE_WIDE_PARTS "Support Wide part format" ON)
option(MERGETREE_ENABLE_COMPACT_PARTS "Support Compact part format" ON)
option(MERGETREE_ENABLE_MARKS_V3 "Support .mrk3 adaptive marks" ON)
option(MERGETREE_ENABLE_PRIMARY_INDEX "Support primary index reading" ON)

# MergeTree variant toggles (all ON by default for read support)
option(MERGETREE_VARIANT_REPLACING "Support ReplacingMergeTree (deduplication)" ON)
option(MERGETREE_VARIANT_SUMMING "Support SummingMergeTree (auto-sum)" ON)
option(MERGETREE_VARIANT_AGGREGATING "Support AggregatingMergeTree (pre-aggregation)" ON)
option(MERGETREE_VARIANT_COLLAPSING "Support CollapsingMergeTree (row collapse)" ON)
option(MERGETREE_VARIANT_VERSIONED_COLLAPSING "Support VersionedCollapsingMergeTree" ON)
option(MERGETREE_VARIANT_GRAPHITE "Support GraphiteMergeTree (time series)" ON)
option(MERGETREE_VARIANT_COALESCING "Support CoalescingMergeTree" ON)

# Compression codec options (if MERGETREE_WASM_COMPRESSION=ON)
option(MERGETREE_CODEC_LZ4 "Include LZ4 compression" ON)
option(MERGETREE_CODEC_ZSTD "Include ZSTD compression" ON)
option(MERGETREE_CODEC_NONE "Include None/passthrough codec" ON)
option(MERGETREE_CODEC_DELTA "Include Delta encoding" OFF)
option(MERGETREE_CODEC_DOUBLE_DELTA "Include DoubleDelta encoding" OFF)
option(MERGETREE_CODEC_GORILLA "Include Gorilla encoding" OFF)
option(MERGETREE_CODEC_T64 "Include T64 encoding" OFF)

# =============================================================================
# Source Paths
# =============================================================================

# Base paths (relative to cmake directory)
set(CHDB_WASM_DIR "${CMAKE_CURRENT_LIST_DIR}/..")
set(CHDB_SOURCE_DIR "${CHDB_WASM_DIR}/../../../vendor/chdb")
set(MERGETREE_WASM_DIR "${CHDB_WASM_DIR}/wasm/mergetree")
set(VFS_WASM_DIR "${CHDB_WASM_DIR}/wasm/vfs")

# Verify paths exist
if(MERGETREE_WASM_FULL AND NOT EXISTS "${CHDB_SOURCE_DIR}/src/Storages/MergeTree")
    message(WARNING "chdb MergeTree source not found at ${CHDB_SOURCE_DIR}/src/Storages/MergeTree")
    message(WARNING "Full MergeTree build will fail - falling back to standalone mode")
    set(MERGETREE_WASM_FULL OFF CACHE BOOL "" FORCE)
    set(MERGETREE_WASM_STANDALONE ON CACHE BOOL "" FORCE)
endif()

# =============================================================================
# Source File Lists
# =============================================================================

# Standalone mode sources (current implementation)
set(MERGETREE_STANDALONE_SOURCES
    ${MERGETREE_WASM_DIR}/mergetree_bindings.cpp
    ${MERGETREE_WASM_DIR}/DataPartStorageVFS.cpp
    ${VFS_WASM_DIR}/vfs_impl.cpp
)

# Headers for standalone mode
set(MERGETREE_STANDALONE_HEADERS
    ${MERGETREE_WASM_DIR}/MergeTreeStandalone.h
    ${MERGETREE_WASM_DIR}/MergeTreeVariants.h
    ${MERGETREE_WASM_DIR}/DataPartStorageVFS.h
    ${VFS_WASM_DIR}/vfs.h
)

# =============================================================================
# Full MergeTree Sources (for future full build)
# =============================================================================

if(MERGETREE_WASM_FULL)
    # Core MergeTree reader components
    set(MERGETREE_READER_SOURCES
        # Base interfaces
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/IMergeTreeReader.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/IMergeTreeDataPart.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/IDataPartStorage.h

        # Reader implementations
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeReaderStream.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeRangeReader.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeMarksLoader.cpp

        # Index granularity
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeIndexGranularity.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeIndexGranularityConstant.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeIndexGranularityAdaptive.cpp
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeIndexGranularityInfo.cpp

        # Mark handling
        ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MarkRange.cpp
    )

    # Wide part reader (separate .bin files per column)
    if(MERGETREE_ENABLE_WIDE_PARTS)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeReaderWide.cpp
        )
    endif()

    # Compact part reader (all columns in data.bin)
    if(MERGETREE_ENABLE_COMPACT_PARTS)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeReaderCompact.cpp
            ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeReaderCompactSingleBuffer.cpp
        )
    endif()

    # Primary index reader
    if(MERGETREE_ENABLE_PRIMARY_INDEX)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/MergeTreeIndexReader.cpp
            ${CHDB_SOURCE_DIR}/src/Storages/MergeTree/KeyCondition.cpp
        )
    endif()

    # =========================================================================
    # MergeTree Variant Sources (for full build)
    # =========================================================================
    # Note: Variant support requires merge-time algorithms. For read operations,
    # these files provide metadata interpretation for variant-specific columns.

    # ReplacingMergeTree - version column handling
    if(MERGETREE_VARIANT_REPLACING)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/ReplacingSortedAlgorithm.cpp
        )
    endif()

    # SummingMergeTree - column summation metadata
    if(MERGETREE_VARIANT_SUMMING)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/SummingSortedAlgorithm.cpp
        )
    endif()

    # AggregatingMergeTree - aggregate state handling
    if(MERGETREE_VARIANT_AGGREGATING)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/AggregatingSortedAlgorithm.cpp
        )
    endif()

    # CollapsingMergeTree - sign column handling
    if(MERGETREE_VARIANT_COLLAPSING)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/CollapsingSortedAlgorithm.cpp
        )
    endif()

    # VersionedCollapsingMergeTree - versioned collapse
    if(MERGETREE_VARIANT_VERSIONED_COLLAPSING)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/VersionedCollapsingAlgorithm.cpp
        )
    endif()

    # GraphiteMergeTree - Graphite rollup
    if(MERGETREE_VARIANT_GRAPHITE)
        list(APPEND MERGETREE_READER_SOURCES
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/GraphiteRollupSortedAlgorithm.cpp
            ${CHDB_SOURCE_DIR}/src/Processors/Merges/Algorithms/Graphite.cpp
        )
    endif()

    # Compression codecs
    if(MERGETREE_WASM_COMPRESSION)
        set(COMPRESSION_SOURCES
            ${CHDB_SOURCE_DIR}/src/Compression/CompressedReadBuffer.cpp
            ${CHDB_SOURCE_DIR}/src/Compression/CompressedReadBufferBase.cpp
            ${CHDB_SOURCE_DIR}/src/Compression/CompressedReadBufferFromFile.cpp
        )

        if(MERGETREE_CODEC_LZ4)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecLZ4.cpp
            )
        endif()

        if(MERGETREE_CODEC_ZSTD)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecZSTD.cpp
            )
        endif()

        if(MERGETREE_CODEC_NONE)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecNone.cpp
            )
        endif()

        if(MERGETREE_CODEC_DELTA)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecDelta.cpp
            )
        endif()

        if(MERGETREE_CODEC_DOUBLE_DELTA)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecDoubleDelta.cpp
            )
        endif()

        if(MERGETREE_CODEC_GORILLA)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecGorilla.cpp
            )
        endif()

        if(MERGETREE_CODEC_T64)
            list(APPEND COMPRESSION_SOURCES
                ${CHDB_SOURCE_DIR}/src/Compression/CompressionCodecT64.cpp
            )
        endif()
    endif()

    # Data types and columns needed for deserialization
    set(DATATYPE_SOURCES
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeFactory.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeString.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypesNumber.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeDate.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeDateTime.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeArray.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeNullable.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/DataTypeLowCardinality.cpp
    )

    # Serialization (for column deserialization)
    set(SERIALIZATION_SOURCES
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationNumber.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationString.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationDate.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationDateTime.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationArray.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationNullable.cpp
        ${CHDB_SOURCE_DIR}/src/DataTypes/Serializations/SerializationLowCardinality.cpp
    )

    # Columns
    set(COLUMN_SOURCES
        ${CHDB_SOURCE_DIR}/src/Columns/IColumn.cpp
        ${CHDB_SOURCE_DIR}/src/Columns/ColumnVector.cpp
        ${CHDB_SOURCE_DIR}/src/Columns/ColumnString.cpp
        ${CHDB_SOURCE_DIR}/src/Columns/ColumnArray.cpp
        ${CHDB_SOURCE_DIR}/src/Columns/ColumnNullable.cpp
        ${CHDB_SOURCE_DIR}/src/Columns/ColumnLowCardinality.cpp
    )

    # IO primitives
    set(IO_SOURCES
        ${CHDB_SOURCE_DIR}/src/IO/ReadBuffer.cpp
        ${CHDB_SOURCE_DIR}/src/IO/WriteBuffer.cpp
        ${CHDB_SOURCE_DIR}/src/IO/ReadHelpers.cpp
        ${CHDB_SOURCE_DIR}/src/IO/WriteHelpers.cpp
        ${CHDB_SOURCE_DIR}/src/IO/ReadBufferFromFileBase.cpp
        ${CHDB_SOURCE_DIR}/src/IO/MMappedFile.cpp
        ${CHDB_SOURCE_DIR}/src/IO/HashingReadBuffer.cpp
    )
endif()

# =============================================================================
# Compile Definitions
# =============================================================================

set(MERGETREE_WASM_DEFINITIONS
    MERGETREE_STANDALONE_BUILD
    MERGETREE_VARIANTS_IMPLEMENTATION
    CHDB_WASM=1
    CHDB_SINGLE_THREADED=1
    NDEBUG
)

# Add variant support flags
if(MERGETREE_VARIANT_REPLACING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_REPLACING=1)
endif()
if(MERGETREE_VARIANT_SUMMING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_SUMMING=1)
endif()
if(MERGETREE_VARIANT_AGGREGATING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_AGGREGATING=1)
endif()
if(MERGETREE_VARIANT_COLLAPSING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_COLLAPSING=1)
endif()
if(MERGETREE_VARIANT_VERSIONED_COLLAPSING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_VERSIONED_COLLAPSING=1)
endif()
if(MERGETREE_VARIANT_GRAPHITE)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_GRAPHITE=1)
endif()
if(MERGETREE_VARIANT_COALESCING)
    list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_VARIANT_COALESCING=1)
endif()

if(MERGETREE_WASM_FULL)
    # Remove standalone flag for full build
    list(REMOVE_ITEM MERGETREE_WASM_DEFINITIONS MERGETREE_STANDALONE_BUILD)

    # Add feature flags
    if(MERGETREE_ENABLE_WIDE_PARTS)
        list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_ENABLE_WIDE_PARTS=1)
    endif()
    if(MERGETREE_ENABLE_COMPACT_PARTS)
        list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_ENABLE_COMPACT_PARTS=1)
    endif()
    if(MERGETREE_WASM_COMPRESSION)
        list(APPEND MERGETREE_WASM_DEFINITIONS MERGETREE_ENABLE_COMPRESSION=1)
    endif()
endif()

# =============================================================================
# Compile Flags
# =============================================================================

set(MERGETREE_WASM_COMPILE_FLAGS
    -std=c++17
    -Os                              # Size optimization
    -fno-exceptions                  # Disable exceptions
    -fno-rtti                        # Disable RTTI
    -fvisibility=hidden              # Hide symbols
    -ffunction-sections              # Dead code elimination
    -fdata-sections                  # Unused data elimination
)

# =============================================================================
# Emscripten Link Flags
# =============================================================================

set(MERGETREE_WASM_LINK_FLAGS
    -s WASM=1
    -s MODULARIZE=1
    -s EXPORT_NAME='createMergeTreeModule'
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]'
    -s ALLOW_MEMORY_GROWTH=1
    -s INITIAL_MEMORY=4194304        # 4MB initial
    -s MAXIMUM_MEMORY=134217728      # 128MB max (Cloudflare Workers limit)
    -s ENVIRONMENT='node,web,worker'
    -s EXPORT_ES6=0
    -s ASYNCIFY                      # For async VFS operations
)

# Exported functions for JavaScript
set(MERGETREE_EXPORTED_FUNCTIONS
    _malloc
    _free
    _mergetree_reader_create
    _mergetree_reader_destroy
    _mergetree_reader_get_row_count
    _mergetree_reader_get_column_count
    _mergetree_reader_get_mark_count
    _mergetree_reader_get_column_name
    _mergetree_reader_get_column_type
    _mergetree_reader_read_marks
    _mergetree_reader_read_column_raw
    _mergetree_get_result
    _mergetree_get_result_len
    _mergetree_get_error
    _mergetree_version
    _mergetree_test
    # MergeTree variant functions
    _mergetree_mode_from_name
    _mergetree_mode_to_name
    _mergetree_mode_get_features
    _mergetree_mode_has_feature
    _mergetree_mode_description
    _mergetree_variant_is_supported
    _mergetree_get_supported_variants
    _mergetree_reader_get_variant_mode
    _mergetree_reader_get_sign_column
    _mergetree_reader_get_version_column
    _mergetree_reader_set_variant
)

# Full build exports additional functions
if(MERGETREE_WASM_FULL)
    list(APPEND MERGETREE_EXPORTED_FUNCTIONS
        _mergetree_reader_read_column_decompressed
        _mergetree_reader_read_primary_key
        _mergetree_reader_seek_to_granule
        _mergetree_get_compression_info
    )
endif()

# Convert list to comma-separated string
string(REPLACE ";" "," MERGETREE_EXPORTS_STR "${MERGETREE_EXPORTED_FUNCTIONS}")
list(APPEND MERGETREE_WASM_LINK_FLAGS
    "-s EXPORTED_FUNCTIONS='[\"${MERGETREE_EXPORTS_STR}\"]'"
)

# Asyncify imports (VFS async functions)
set(MERGETREE_ASYNCIFY_IMPORTS
    js_vfs_open
    js_vfs_close
    js_vfs_read
    js_vfs_write
    js_vfs_stat
    js_vfs_fstat
    js_vfs_mkdir
    js_vfs_opendir
    js_vfs_readdir
    js_vfs_closedir
    js_vfs_unlink
    js_vfs_rmdir
    js_vfs_rename
    js_vfs_fsync
    js_vfs_init
    js_vfs_shutdown
)
string(REPLACE ";" "," ASYNCIFY_IMPORTS_STR "${MERGETREE_ASYNCIFY_IMPORTS}")
list(APPEND MERGETREE_WASM_LINK_FLAGS
    "-s ASYNCIFY_IMPORTS='[\"${ASYNCIFY_IMPORTS_STR}\"]'"
)

# =============================================================================
# Include Paths
# =============================================================================

set(MERGETREE_WASM_INCLUDE_DIRS
    ${MERGETREE_WASM_DIR}
    ${VFS_WASM_DIR}
    ${CHDB_WASM_DIR}/wasm
)

if(MERGETREE_WASM_FULL)
    list(APPEND MERGETREE_WASM_INCLUDE_DIRS
        ${CHDB_SOURCE_DIR}/src
        ${CHDB_SOURCE_DIR}/base
        ${CHDB_SOURCE_DIR}/contrib/lz4/lib
        ${CHDB_SOURCE_DIR}/contrib/zstd/lib
    )
endif()

# =============================================================================
# External Dependencies (for full build)
# =============================================================================

if(MERGETREE_WASM_FULL)
    # LZ4 library
    if(MERGETREE_CODEC_LZ4)
        set(LZ4_SOURCES
            ${CHDB_SOURCE_DIR}/contrib/lz4/lib/lz4.c
            ${CHDB_SOURCE_DIR}/contrib/lz4/lib/lz4hc.c
        )
    endif()

    # ZSTD library
    if(MERGETREE_CODEC_ZSTD)
        # ZSTD is more complex - may need subset of files
        file(GLOB ZSTD_COMMON_SOURCES
            ${CHDB_SOURCE_DIR}/contrib/zstd/lib/common/*.c)
        file(GLOB ZSTD_DECOMPRESS_SOURCES
            ${CHDB_SOURCE_DIR}/contrib/zstd/lib/decompress/*.c)
        set(ZSTD_SOURCES ${ZSTD_COMMON_SOURCES} ${ZSTD_DECOMPRESS_SOURCES})
    endif()
endif()

# =============================================================================
# Build Function
# =============================================================================

function(build_mergetree_wasm TARGET_NAME)
    if(MERGETREE_WASM_STANDALONE)
        message(STATUS "Building MergeTree WASM in STANDALONE mode")
        set(SOURCES ${MERGETREE_STANDALONE_SOURCES})
    else()
        message(STATUS "Building MergeTree WASM in FULL mode")
        set(SOURCES
            ${MERGETREE_READER_SOURCES}
            ${COMPRESSION_SOURCES}
            ${DATATYPE_SOURCES}
            ${SERIALIZATION_SOURCES}
            ${COLUMN_SOURCES}
            ${IO_SOURCES}
            ${LZ4_SOURCES}
            ${ZSTD_SOURCES}
            # Still need VFS and bindings
            ${MERGETREE_WASM_DIR}/mergetree_bindings.cpp
            ${MERGETREE_WASM_DIR}/DataPartStorageVFS.cpp
            ${VFS_WASM_DIR}/vfs_impl.cpp
        )
    endif()

    # Create executable (Emscripten outputs .js + .wasm)
    add_executable(${TARGET_NAME} ${SOURCES})

    # Include directories
    target_include_directories(${TARGET_NAME} PRIVATE ${MERGETREE_WASM_INCLUDE_DIRS})

    # Compile definitions
    target_compile_definitions(${TARGET_NAME} PRIVATE ${MERGETREE_WASM_DEFINITIONS})

    # Compile options
    target_compile_options(${TARGET_NAME} PRIVATE ${MERGETREE_WASM_COMPILE_FLAGS})

    # Link flags
    string(REPLACE ";" " " LINK_FLAGS_STR "${MERGETREE_WASM_LINK_FLAGS}")
    set_target_properties(${TARGET_NAME} PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "${LINK_FLAGS_STR}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
    )
endfunction()

# =============================================================================
# Size Estimates
# =============================================================================

message(STATUS "")
message(STATUS "=== MergeTree WASM Build Configuration ===")
message(STATUS "")
message(STATUS "Build Mode: ${MERGETREE_WASM_STANDALONE} standalone, ${MERGETREE_WASM_FULL} full")
message(STATUS "")
message(STATUS "Estimated Sizes:")
message(STATUS "  Current (standalone):     ~284KB")
message(STATUS "  + Compression (LZ4/ZSTD): ~500KB-1MB")
message(STATUS "  + Full reader:            ~2-3MB")
message(STATUS "  + DataTypes/Columns:      ~1-2MB")
message(STATUS "  Full build target:        <5MB compressed")
message(STATUS "")
message(STATUS "Features:")
message(STATUS "  Wide parts:    ${MERGETREE_ENABLE_WIDE_PARTS}")
message(STATUS "  Compact parts: ${MERGETREE_ENABLE_COMPACT_PARTS}")
message(STATUS "  Marks v3:      ${MERGETREE_ENABLE_MARKS_V3}")
message(STATUS "  Primary index: ${MERGETREE_ENABLE_PRIMARY_INDEX}")
message(STATUS "")
message(STATUS "MergeTree Variants:")
message(STATUS "  Replacing:            ${MERGETREE_VARIANT_REPLACING}")
message(STATUS "  Summing:              ${MERGETREE_VARIANT_SUMMING}")
message(STATUS "  Aggregating:          ${MERGETREE_VARIANT_AGGREGATING}")
message(STATUS "  Collapsing:           ${MERGETREE_VARIANT_COLLAPSING}")
message(STATUS "  VersionedCollapsing:  ${MERGETREE_VARIANT_VERSIONED_COLLAPSING}")
message(STATUS "  Graphite:             ${MERGETREE_VARIANT_GRAPHITE}")
message(STATUS "  Coalescing:           ${MERGETREE_VARIANT_COALESCING}")
message(STATUS "")
if(MERGETREE_WASM_COMPRESSION)
    message(STATUS "Compression Codecs:")
    message(STATUS "  LZ4:         ${MERGETREE_CODEC_LZ4}")
    message(STATUS "  ZSTD:        ${MERGETREE_CODEC_ZSTD}")
    message(STATUS "  None:        ${MERGETREE_CODEC_NONE}")
    message(STATUS "  Delta:       ${MERGETREE_CODEC_DELTA}")
    message(STATUS "  DoubleDelta: ${MERGETREE_CODEC_DOUBLE_DELTA}")
    message(STATUS "  Gorilla:     ${MERGETREE_CODEC_GORILLA}")
    message(STATUS "  T64:         ${MERGETREE_CODEC_T64}")
    message(STATUS "")
endif()
message(STATUS "===========================================")
message(STATUS "")
