# wasm-formats.cmake
# CMake configuration to strip heavy binary formats for minimal WASM builds
#
# Heavy binary formats (Parquet, Arrow, ORC, Avro, Protobuf) add 16-37MB to the
# final WASM bundle. This configuration disables them while keeping essential
# text-based formats (JSON, CSV, TSV, Native, Values) that are lightweight and
# commonly needed for web-based data processing.
#
# Usage:
#   cmake -C cmake/wasm-formats.cmake ..
#   OR include(cmake/wasm-formats.cmake) in your CMakeLists.txt
#
# Reference: Issue clickhouse-kbc - Strip Parquet/Arrow/ORC formats for minimal WASM

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== WASM Format Configuration ===")
message(STATUS "Stripping heavy binary formats for minimal WASM build")
message(STATUS "")

# ============================================================================
# Format-related CMake Options Reference
# ============================================================================
# The following CMake options control format support in ClickHouse/chdb:
#
# From vendor/chdb/contrib/arrow-cmake/CMakeLists.txt:
#   - ENABLE_PARQUET: Controls Apache Parquet format support
#     Depends on: Arrow, Thrift, Protobuf (for ORC within Arrow)
#
# From vendor/chdb/contrib/arrow-cmake/flight.cmake:
#   - ENABLE_ARROW_FLIGHT: Controls Arrow Flight RPC protocol
#
# From vendor/chdb/contrib/avro-cmake/CMakeLists.txt:
#   - ENABLE_AVRO: Controls Apache Avro format support
#     Depends on: Boost, Snappy
#
# From vendor/chdb/contrib/google-protobuf-cmake/CMakeLists.txt:
#   - ENABLE_PROTOBUF: Controls Protocol Buffers format support
#     Depends on: Abseil, zlib
#
# From vendor/chdb/contrib/capnproto-cmake/CMakeLists.txt:
#   - ENABLE_CAPNP: Controls Cap'n Proto format support
#
# From vendor/chdb/contrib/msgpack-c-cmake/CMakeLists.txt:
#   - ENABLE_MSGPACK: Controls MessagePack format support
#
# From vendor/chdb/contrib/thrift-cmake/CMakeLists.txt:
#   - ENABLE_THRIFT: Controls Apache Thrift (required by Parquet)
#
# From vendor/chdb/cmake/target.cmake:
#   - Platform-specific overrides for ENABLE_PARQUET, ENABLE_ARROW_FLIGHT

# ============================================================================
# Size Impact Analysis (Estimated Binary Savings)
# ============================================================================
#
# Format          | Source Size | Contrib Size | Est. WASM Impact | Dependencies
# ----------------|-------------|--------------|------------------|------------------
# Parquet         | ~704 KB     | Arrow+Thrift | ~16-20 MB        | Arrow, ORC, Thrift, Protobuf
# Arrow           | ~160 KB     | ~large       | ~8-12 MB         | Flatbuffers, compression libs
# ORC             | ~136 KB     | ~moderate    | ~4-6 MB          | Protobuf, compression libs
# Avro            | ~100 KB     | ~small       | ~2-3 MB          | Boost, Snappy
# Protobuf        | ~40 KB      | ~large       | ~3-5 MB          | Abseil
# Cap'n Proto     | ~20 KB      | ~moderate    | ~1-2 MB          | -
# MsgPack         | ~48 KB      | ~small       | ~0.5-1 MB        | -
# ----------------|-------------|--------------|------------------|------------------
# TOTAL SAVINGS   |             |              | ~16-37 MB        |
#
# Essential formats (kept enabled):
# Format          | Source Size | Est. WASM Impact | Notes
# ----------------|-------------|------------------|------------------
# JSON            | ~232 KB     | ~1-2 MB          | Essential for web APIs
# CSV/TSV         | ~68 KB      | ~0.5-1 MB        | Universal text format
# Native          | ~144 KB     | ~0.5-1 MB        | ClickHouse internal format
# Values          | (incl.)     | (incl.)          | SQL VALUES syntax
# TabSeparated    | (incl.)     | (incl.)          | TSV variants
#
# Note: WASM impact estimates include:
#   - Source code compiled to WASM
#   - Required contrib libraries
#   - Transitive dependencies
#   - Code that cannot be tree-shaken due to format registration

# ============================================================================
# HEAVY FORMATS - DISABLED
# ============================================================================
# These formats add significant binary size due to complex codecs and
# external library dependencies that are not suitable for WASM deployment.

# --- Apache Parquet (16-20 MB) ---
# Columnar storage format requiring Arrow, ORC adapters, Thrift, and Protobuf.
# Source files: ParquetBlockInputFormat, ParquetBlockOutputFormat,
#               ParquetMetadataInputFormat, ParquetV3BlockInputFormat, etc.
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Parquet format (saves ~16-20 MB)" FORCE)
message(STATUS "  Parquet: DISABLED (saves ~16-20 MB)")

# --- Apache Arrow (8-12 MB) ---
# Arrow Flight is the RPC protocol; Arrow itself is implicitly disabled with Parquet.
# Source files: ArrowBlockInputFormat, ArrowBlockOutputFormat,
#               ArrowColumnToCHColumn, CHColumnToArrowColumn, etc.
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight RPC (saves ~8-12 MB)" FORCE)
message(STATUS "  Arrow Flight: DISABLED (saves ~8-12 MB)")

# --- Apache ORC (4-6 MB) ---
# ORC is bundled with Arrow in the ClickHouse build system.
# Disabling Parquet also disables ORC support.
# Source files: ORCBlockInputFormat, ORCBlockOutputFormat,
#               NativeORCBlockInputFormat
# Note: ORC is controlled via ENABLE_PARQUET, no separate option
message(STATUS "  ORC: DISABLED (via Parquet, saves ~4-6 MB)")

# --- Apache Avro (2-3 MB) ---
# Schema-based serialization format with Boost and Snappy dependencies.
# Source files: AvroRowInputFormat, AvroRowOutputFormat
set(ENABLE_AVRO OFF CACHE BOOL "Disable Avro format (saves ~2-3 MB)" FORCE)
message(STATUS "  Avro: DISABLED (saves ~2-3 MB)")

# --- Protocol Buffers (3-5 MB) ---
# Google's serialization format with Abseil dependency.
# Source files: ProtobufRowInputFormat, ProtobufRowOutputFormat,
#               ProtobufListInputFormat, ProtobufListOutputFormat
# Note: Protobuf is also required by ORC, so this reinforces the ORC disable.
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protobuf format (saves ~3-5 MB)" FORCE)
message(STATUS "  Protobuf: DISABLED (saves ~3-5 MB)")

# --- Cap'n Proto (1-2 MB) ---
# Zero-copy serialization format.
# Source files: CapnProtoRowInputFormat, CapnProtoRowOutputFormat
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto format (saves ~1-2 MB)" FORCE)
message(STATUS "  Cap'n Proto: DISABLED (saves ~1-2 MB)")

# --- MessagePack (0.5-1 MB) ---
# Binary JSON-like format.
# Source files: MsgPackRowInputFormat, MsgPackRowOutputFormat
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack format (saves ~0.5-1 MB)" FORCE)
message(STATUS "  MsgPack: DISABLED (saves ~0.5-1 MB)")

# --- Apache Thrift ---
# Required by Parquet; disabled implicitly but set explicitly for clarity.
set(ENABLE_THRIFT OFF CACHE BOOL "Disable Thrift (required by Parquet)" FORCE)
message(STATUS "  Thrift: DISABLED (Parquet dependency)")

# ============================================================================
# ESSENTIAL FORMATS - ENABLED (Built-in, no external dependencies)
# ============================================================================
# These formats are lightweight and essential for WASM data processing.
# They are built into ClickHouse core and do not require separate CMake options.

message(STATUS "")
message(STATUS "Essential formats (built-in, always enabled):")
message(STATUS "  JSON: ENABLED (~232 KB source)")
message(STATUS "    - JSONEachRow, JSONCompact, JSONColumns, JSONObjectEachRow")
message(STATUS "    - JSONAsString, JSONStrings variants")
message(STATUS "  CSV: ENABLED (~24 KB source)")
message(STATUS "    - CSV, CSVWithNames, CSVWithNamesAndTypes")
message(STATUS "  TSV/TabSeparated: ENABLED (~44 KB source)")
message(STATUS "    - TSV, TabSeparated, TabSeparatedWithNames")
message(STATUS "    - TabSeparatedWithNamesAndTypes, TabSeparatedRaw")
message(STATUS "  Native: ENABLED (~144 KB source)")
message(STATUS "    - ClickHouse native binary format")
message(STATUS "  Values: ENABLED (included in core)")
message(STATUS "    - SQL VALUES syntax format")

# ============================================================================
# Format Processor Source Files Reference
# ============================================================================
# Location: vendor/chdb/src/Processors/Formats/Impl/
#
# Heavy formats (disabled):
#   - Parquet/: Directory with additional Parquet components
#   - ParquetBlockInputFormat.cpp (55 KB)
#   - ParquetBlockOutputFormat.cpp (21 KB)
#   - ParquetMetadataInputFormat.cpp (24 KB)
#   - ParquetV3BlockInputFormat.cpp (6 KB)
#   - ArrowBlockInputFormat.cpp (10 KB)
#   - ArrowBlockOutputFormat.cpp (5 KB)
#   - ArrowBufferedStreams.cpp (12 KB)
#   - ArrowColumnToCHColumn.cpp (80 KB)
#   - CHColumnToArrowColumn.cpp (55 KB)
#   - ORCBlockInputFormat.cpp (10 KB)
#   - ORCBlockOutputFormat.cpp (23 KB)
#   - NativeORCBlockInputFormat.cpp (85 KB)
#   - AvroRowInputFormat.cpp (59 KB)
#   - AvroRowOutputFormat.cpp (27 KB)
#   - ProtobufRowInputFormat.cpp (6 KB)
#   - ProtobufRowOutputFormat.cpp (3 KB)
#   - ProtobufListInputFormat.cpp (5 KB)
#   - ProtobufListOutputFormat.cpp (2 KB)
#   - CapnProtoRowInputFormat.cpp (6 KB)
#   - CapnProtoRowOutputFormat.cpp (2 KB)
#   - MsgPackRowInputFormat.cpp (24 KB)
#   - MsgPackRowOutputFormat.cpp (13 KB)
#
# Essential formats (enabled):
#   - JSONEachRowRowInputFormat.cpp (15 KB)
#   - JSONEachRowRowOutputFormat.cpp (4 KB)
#   - JSONRowInputFormat.cpp (5 KB)
#   - JSONRowOutputFormat.cpp (5 KB)
#   - JSONColumnsBlockInputFormat.cpp, etc.
#   - CSVRowInputFormat.cpp (20 KB)
#   - CSVRowOutputFormat.cpp (3 KB)
#   - TabSeparatedRowInputFormat.cpp (18 KB)
#   - TabSeparatedRowOutputFormat.cpp (3 KB)
#   - NativeFormat.cpp (4 KB)
#   - ValuesBlockInputFormat.cpp (27 KB)
#   - ValuesRowOutputFormat.cpp (1 KB)

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== WASM Format Configuration Summary ===")
message(STATUS "Heavy formats DISABLED: Parquet, Arrow, ORC, Avro, Protobuf, Cap'n Proto, MsgPack")
message(STATUS "Essential formats ENABLED: JSON, CSV, TSV, Native, Values")
message(STATUS "Estimated binary savings: 16-37 MB")
message(STATUS "")
message(STATUS "To enable a specific format, override on command line:")
message(STATUS "  cmake -C cmake/wasm-formats.cmake -DENABLE_PARQUET=ON ..")
message(STATUS "")
message(STATUS "Note: Enabling Parquet will also enable Arrow, ORC, Thrift, and Protobuf")
message(STATUS "==============================================")
message(STATUS "")
