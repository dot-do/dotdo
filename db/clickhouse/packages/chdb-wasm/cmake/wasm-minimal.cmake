# wasm-minimal.cmake
# CMake preset for building chdb-wasm with all optional features disabled
#
# This configuration produces the smallest possible WASM bundle by disabling
# all optional integrations, formats, and compute features that are not
# essential for core SQL functionality.
#
# Usage:
#   cmake -C cmake/wasm-minimal.cmake ..
#   OR
#   cmake -DCMAKE_TOOLCHAIN_FILE=cmake/wasm-minimal.cmake ..

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== chdb-wasm Minimal Flags Configuration ===")
message(STATUS "Building with all optional features disabled")
message(STATUS "")

# ============================================================================
# Cloud Storage - FORCE DISABLED (~1.4+ GB savings)
# ============================================================================
# These integrations add MASSIVE binary size and are not needed for
# in-browser/in-memory SQL operations.
#
# CRITICAL SIZE CONTRIBUTIONS:
#   - AWS S3:           ~944 MB
#   - Google Cloud:     ~369 MB
#   - Azure Blob:       ~50-100 MB
#   - HDFS:             ~20-50 MB

# AWS S3 - both flags needed for complete disable
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3 support" FORCE)
set(ENABLE_S3 OFF CACHE BOOL "Disable S3 support" FORCE)
set(ENABLE_AWS_S3 OFF CACHE INTERNAL "")
set(ENABLE_S3 OFF CACHE INTERNAL "")

# Google Cloud Storage
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage support" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE BOOL "Disable Google Cloud KMS" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE INTERNAL "")
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE INTERNAL "")

# Azure Blob Storage
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure Blob Storage support" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE INTERNAL "")

# HDFS
set(ENABLE_HDFS OFF CACHE BOOL "Disable Hadoop HDFS support" FORCE)
set(ENABLE_HDFS OFF CACHE INTERNAL "")

# Hive (depends on HDFS)
set(ENABLE_HIVE OFF CACHE BOOL "Disable Hive Metastore" FORCE)
set(ENABLE_HIVE OFF CACHE INTERNAL "")

message(STATUS "Cloud Storage: DISABLED (~1.4+ GB savings)")
message(STATUS "  - AWS S3: OFF (~944 MB)")
message(STATUS "  - Google Cloud: OFF (~369 MB)")
message(STATUS "  - Azure Blob: OFF (~50-100 MB)")
message(STATUS "  - HDFS: OFF (~20-50 MB)")
message(STATUS "  - Hive: OFF (depends on HDFS)")

# ============================================================================
# Database Integrations - Disabled
# ============================================================================
# External database connectors are not applicable for WASM builds and add
# substantial code and dependencies.

set(ENABLE_KAFKA OFF CACHE BOOL "Disable Kafka integration" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra integration" FORCE)
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB integration" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL integration" FORCE)
set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL integration" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ/AMQP integration" FORCE)
set(ENABLE_NATSIO OFF CACHE BOOL "Disable NATS.io integration" FORCE)

message(STATUS "Database Integrations: DISABLED")
message(STATUS "  - Kafka: OFF")
message(STATUS "  - Cassandra: OFF")
message(STATUS "  - MongoDB: OFF")
message(STATUS "  - PostgreSQL: OFF")
message(STATUS "  - MySQL: OFF")
message(STATUS "  - AMQP/RabbitMQ: OFF")
message(STATUS "  - NATS.io: OFF")

# ============================================================================
# Heavy Compute Features - Disabled
# ============================================================================
# JIT compilation and debug symbol parsing add significant complexity and
# are not supported or needed in WASM environments.

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM-based JIT compiler" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF debug parser" FORCE)

message(STATUS "Heavy Compute: DISABLED")
message(STATUS "  - Embedded Compiler (LLVM JIT): OFF")
message(STATUS "  - DWARF Parser: OFF")

# ============================================================================
# Data Formats - Disabled
# ============================================================================
# Heavy serialization formats that require large dependencies. Core formats
# like JSON/CSV remain available through ClickHouse's built-in support.

set(ENABLE_PARQUET OFF CACHE BOOL "Disable Apache Parquet format" FORCE)
set(ENABLE_AVRO OFF CACHE BOOL "Disable Apache Avro format" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protocol Buffers format" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto format" FORCE)

message(STATUS "Data Formats: DISABLED")
message(STATUS "  - Parquet: OFF")
message(STATUS "  - Avro: OFF")
message(STATUS "  - Protobuf: OFF")
message(STATUS "  - Cap'n Proto: OFF")

# ============================================================================
# Networking Features - Disabled
# ============================================================================
# Network protocols and distributed coordination are not applicable for
# client-side WASM execution.

set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC support" FORCE)
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft consensus library" FORCE)

message(STATUS "Networking: DISABLED")
message(STATUS "  - gRPC: OFF")
message(STATUS "  - NuRaft: OFF")

# ============================================================================
# Miscellaneous Features - Disabled
# ============================================================================
# Specialized features that add binary size without providing essential
# SQL functionality for typical WASM use cases.

set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB storage engine" FORCE)
set(ENABLE_S2_GEOMETRY OFF CACHE BOOL "Disable S2 geometry library" FORCE)
set(ENABLE_H3 OFF CACHE BOOL "Disable H3 hexagonal hierarchical geospatial indexing" FORCE)
set(ENABLE_ICU OFF CACHE BOOL "Disable ICU unicode/i18n library" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan regex library" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust-based components" FORCE)
set(ENABLE_TESTS OFF CACHE BOOL "Disable test compilation" FORCE)

message(STATUS "Miscellaneous: DISABLED")
message(STATUS "  - RocksDB: OFF")
message(STATUS "  - S2 Geometry: OFF")
message(STATUS "  - H3: OFF")
message(STATUS "  - ICU: OFF")
message(STATUS "  - Vectorscan: OFF")
message(STATUS "  - NLP: OFF")
message(STATUS "  - Rust Components: OFF")
message(STATUS "  - Tests: OFF")

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== Minimal Flags Summary ===")
message(STATUS "All optional features have been disabled to minimize WASM binary size.")
message(STATUS "Core SQL functionality with Memory/URL table engines remains available.")
message(STATUS "")
message(STATUS "To enable specific features, override them on the command line:")
message(STATUS "  cmake -C cmake/wasm-minimal.cmake -DENABLE_PARQUET=ON ..")
message(STATUS "================================================")
message(STATUS "")
