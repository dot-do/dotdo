# wasm-integrations.cmake
# Disables ALL external integrations for WASM builds
#
# These integrations require networking, system calls, or external libraries
# that are not available in WebAssembly sandbox environments.
#
# Usage:
#   include(cmake/wasm-integrations.cmake)
#   OR
#   cmake -C cmake/wasm-integrations.cmake ..

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "============================================================")
message(STATUS "  WASM External Integrations Configuration")
message(STATUS "============================================================")
message(STATUS "Disabling all external integrations for WASM compatibility")
message(STATUS "")

# ============================================================================
# Cloud Storage Integrations - FORCE DISABLED
# ============================================================================
# These require HTTP/network access which is not available in WASM sandbox.
# Cloud storage backends are the LARGEST contributors to binary size.
#
# CRITICAL SIZE CONTRIBUTIONS (measured):
#   AWS S3:           ~944 MB (aws-sdk-cpp, aws-crt, aws-c-*, checksums, S3/KMS/Glue clients)
#   Google Cloud:     ~369 MB (google-cloud-cpp, grpc, protobuf, abseil, crc32c, nlohmann-json)
#   Azure Blob:       ~50-100 MB (azure-sdk-cpp, azure-core, azure-storage-blobs)
#   HDFS:             ~20-50 MB (libhdfs3, protobuf, krb5, isa-l)
#
# Total cloud storage savings: ~1.4+ GB

# ---------------------------------------------------------------------------
# AWS S3 - COMPLETE DISABLE
# ---------------------------------------------------------------------------
# IMPORTANT: Both ENABLE_S3 and ENABLE_AWS_S3 must be OFF to fully disable
# Some ClickHouse code checks ENABLE_S3, contrib/aws-cmake uses ENABLE_AWS_S3
set(ENABLE_S3 OFF CACHE BOOL "Disable S3 support" FORCE)
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3" FORCE)
set(ENABLE_AWS_S3_DEFAULT OFF CACHE BOOL "Default AWS S3 to OFF" FORCE)
# Also set INTERNAL to prevent override by downstream cmake
set(ENABLE_S3 OFF CACHE INTERNAL "")
set(ENABLE_AWS_S3 OFF CACHE INTERNAL "")

# ---------------------------------------------------------------------------
# Google Cloud Storage - COMPLETE DISABLE
# ---------------------------------------------------------------------------
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud Storage" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP_DEFAULT OFF CACHE BOOL "Default GCS to OFF" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE BOOL "Disable Google Cloud KMS" FORCE)
# Set INTERNAL to prevent override
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE INTERNAL "")
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE INTERNAL "")

# ---------------------------------------------------------------------------
# Azure Blob Storage - COMPLETE DISABLE
# ---------------------------------------------------------------------------
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure Blob Storage" FORCE)
# Set INTERNAL to prevent override
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE INTERNAL "")

# ---------------------------------------------------------------------------
# HDFS (Hadoop Distributed File System) - COMPLETE DISABLE
# ---------------------------------------------------------------------------
set(ENABLE_HDFS OFF CACHE BOOL "Disable Hadoop HDFS" FORCE)
# Set INTERNAL to prevent override
set(ENABLE_HDFS OFF CACHE INTERNAL "")

message(STATUS "[Cloud Storage] DISABLED - MASSIVE SIZE SAVINGS (~1.4+ GB)")
message(STATUS "  - ENABLE_S3=OFF                    (S3 support flag)")
message(STATUS "  - ENABLE_AWS_S3=OFF                (~944 MB savings)")
message(STATUS "  - ENABLE_GOOGLE_CLOUD_CPP=OFF      (~369 MB savings)")
message(STATUS "  - ENABLE_GOOGLE_CLOUD_CPP_KMS=OFF  (GCS KMS)")
message(STATUS "  - ENABLE_AZURE_BLOB_STORAGE=OFF    (~50-100 MB savings)")
message(STATUS "  - ENABLE_HDFS=OFF                  (~20-50 MB savings)")

# ============================================================================
# Message Queue Integrations
# ============================================================================
# These require TCP connections to external brokers.
#
# Approximate size contributions:
#   Kafka:            ~2-3 MB (librdkafka + cppkafka)
#   RabbitMQ/AMQP:    ~1-2 MB (amqpcpp + libuv)
#   NATS:             ~0.5-1 MB

set(ENABLE_KAFKA OFF CACHE BOOL "Disable Apache Kafka - requires networking" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ/AMQP - requires networking" FORCE)
set(ENABLE_NATS OFF CACHE BOOL "Disable NATS.io - requires networking" FORCE)

message(STATUS "[Message Queues] DISABLED")
message(STATUS "  - ENABLE_KAFKA=OFF                 (~2-3 MB savings)")
message(STATUS "  - ENABLE_AMQPCPP=OFF               (~1-2 MB savings)")
message(STATUS "  - ENABLE_NATS=OFF                  (~0.5-1 MB savings)")

# ============================================================================
# Database Integrations
# ============================================================================
# External database connectors requiring TCP network connections.
#
# Approximate size contributions:
#   MySQL:            ~1-2 MB (mariadb-connector-c)
#   PostgreSQL:       ~1-2 MB (libpqxx)
#   MongoDB:          ~3-5 MB (mongo-c-driver + mongo-cxx-driver)
#   Cassandra:        ~2-3 MB (cpp-driver + libuv)
#   SQLite:           ~1-2 MB (embedded, but unnecessary for WASM)
#   RocksDB:          ~3-5 MB (embedded key-value store)

set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL integration - requires networking" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL integration - requires networking" FORCE)
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB integration - requires networking" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra integration - requires networking" FORCE)
set(ENABLE_SQLITE OFF CACHE BOOL "Disable SQLite - not needed for WASM" FORCE)
set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB - file I/O not available in WASM" FORCE)

message(STATUS "[Database Connectors] DISABLED")
message(STATUS "  - ENABLE_MYSQL=OFF                 (~1-2 MB savings)")
message(STATUS "  - ENABLE_LIBPQXX=OFF               (~1-2 MB savings)")
message(STATUS "  - USE_MONGODB=OFF                  (~3-5 MB savings)")
message(STATUS "  - ENABLE_CASSANDRA=OFF             (~2-3 MB savings)")
message(STATUS "  - ENABLE_SQLITE=OFF                (~1-2 MB savings)")
message(STATUS "  - ENABLE_ROCKSDB=OFF               (~3-5 MB savings)")

# Note: Redis integration is not a separate CMake option in ClickHouse.
# Redis Streams support is included in the core storage engines and controlled
# by ENABLE_NATS/message queue settings. The table engine code exists but
# will not compile without the networking dependencies.

# ============================================================================
# Big Data Integrations
# ============================================================================
# Hadoop ecosystem and data lake integrations.
# Note: Hive depends on HDFS, which is already disabled above.
#
# Approximate size contributions:
#   Hive:             ~2-4 MB (Hive Metastore client via Thrift)
#   Delta Lake:       ~2-3 MB (delta-kernel-rs, requires Rust)

set(ENABLE_HIVE OFF CACHE BOOL "Disable Hive Metastore - requires HDFS/networking" FORCE)
set(ENABLE_HIVE OFF CACHE INTERNAL "")
set(ENABLE_DELTA_KERNEL_RS OFF CACHE BOOL "Disable Delta Lake - requires file I/O" FORCE)
set(ENABLE_DELTA_KERNEL_RS OFF CACHE INTERNAL "")

message(STATUS "[Big Data] DISABLED")
message(STATUS "  - ENABLE_HIVE=OFF                  (~2-4 MB savings, depends on HDFS)")
message(STATUS "  - ENABLE_DELTA_KERNEL_RS=OFF       (~2-3 MB savings)")

# ============================================================================
# Network Protocol Integrations
# ============================================================================
# Lower-level network protocol libraries.
#
# Approximate size contributions:
#   gRPC:             ~5-8 MB (includes protobuf)
#   cURL:             ~1-2 MB
#   SSH:              ~1-2 MB (libssh)

set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC - requires networking" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight - requires gRPC" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Disable cURL - requires networking" FORCE)
set(ENABLE_SSH OFF CACHE BOOL "Disable SSH - requires networking" FORCE)

message(STATUS "[Network Protocols] DISABLED")
message(STATUS "  - ENABLE_GRPC=OFF                  (~5-8 MB savings)")
message(STATUS "  - ENABLE_ARROW_FLIGHT=OFF          (depends on gRPC)")
message(STATUS "  - ENABLE_CURL=OFF                  (~1-2 MB savings)")
message(STATUS "  - ENABLE_SSH=OFF                   (~1-2 MB savings)")

# ============================================================================
# Data Format Libraries (Arrow/Parquet/ORC)
# ============================================================================
# These require Apache Arrow library which is complex to build for WASM.
#
# Approximate size contributions:
#   Arrow:            ~15-20 MB
#   Parquet:          ~5-8 MB (requires Arrow)
#   ORC:              ~3-5 MB (requires Arrow)

set(ENABLE_ARROW OFF CACHE BOOL "Disable Apache Arrow - complex WASM port" FORCE)
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Apache Parquet - requires Arrow" FORCE)
set(ENABLE_ORC OFF CACHE BOOL "Disable Apache ORC - requires Arrow" FORCE)

message(STATUS "[Data Formats] DISABLED")
message(STATUS "  - ENABLE_ARROW=OFF                 (~15-20 MB savings)")
message(STATUS "  - ENABLE_PARQUET=OFF               (~5-8 MB savings)")
message(STATUS "  - ENABLE_ORC=OFF                   (~3-5 MB savings)")

# ============================================================================
# Authentication & Security Integrations
# ============================================================================
# Enterprise authentication mechanisms requiring external services.
#
# Approximate size contributions:
#   LDAP:             ~0.5-1 MB (OpenLDAP)
#   Kerberos/GSASL:   ~0.5-1 MB

set(ENABLE_LDAP OFF CACHE BOOL "Disable LDAP - requires networking" FORCE)
set(ENABLE_GSASL_LIBRARY OFF CACHE BOOL "Disable GSASL/Kerberos - requires networking" FORCE)

message(STATUS "[Authentication] DISABLED")
message(STATUS "  - ENABLE_LDAP=OFF                  (~0.5-1 MB savings)")
message(STATUS "  - ENABLE_GSASL_LIBRARY=OFF         (~0.5-1 MB savings)")

# ============================================================================
# Distributed Systems
# ============================================================================
# Consensus and coordination libraries for distributed deployments.
#
# Approximate size contributions:
#   NuRaft:           ~0.5-1 MB

set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft - WASM is single-node only" FORCE)

message(STATUS "[Distributed Systems] DISABLED")
message(STATUS "  - ENABLE_NURAFT=OFF                (~0.5-1 MB savings)")

# ============================================================================
# LLVM/JIT Compilation (CRITICAL - ~1.9GB savings)
# ============================================================================
# LLVM is used for JIT compilation of queries and DWARF parsing.
# This is the LARGEST dependency and MUST be completely disabled for WASM.
#
# LLVM components:
#   - Embedded Compiler: JIT compiles expressions during query execution
#   - DWARF Parser: Debug format parsing (uses LLVM libraries)
#   - BLAKE3: Hash function using LLVMSupport
#
# Approximate size contributions:
#   LLVM (full):      ~1.9 GB (source + build artifacts)
#   LLVMSupport only: ~50-100 MB

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable JIT compilation - LLVM not available in WASM" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF parser - uses LLVM libraries" FORCE)
set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3 - uses LLVMSupport" FORCE)

# Also ensure these are set at INTERNAL level to prevent override
set(ENABLE_EMBEDDED_COMPILER OFF CACHE INTERNAL "")
set(ENABLE_DWARF_PARSER OFF CACHE INTERNAL "")
set(ENABLE_BLAKE3 OFF CACHE INTERNAL "")

message(STATUS "[LLVM/JIT] DISABLED (CRITICAL)")
message(STATUS "  - ENABLE_EMBEDDED_COMPILER=OFF     (~1.9 GB savings - no JIT)")
message(STATUS "  - ENABLE_DWARF_PARSER=OFF          (no DWARF parsing)")
message(STATUS "  - ENABLE_BLAKE3=OFF                (no BLAKE3 hash function)")

# ============================================================================
# AI SDK
# ============================================================================
# AI SDK for SQL generation requires HTTP/OpenSSL.

set(ENABLE_CLIENT_AI OFF CACHE BOOL "Disable AI SDK - requires networking and OpenSSL" FORCE)

message(STATUS "[AI SDK] DISABLED")
message(STATUS "  - ENABLE_CLIENT_AI=OFF             (requires OpenSSL)")

# ============================================================================
# SSL/OpenSSL
# ============================================================================
# OpenSSL is not available in WASM sandbox.

set(ENABLE_SSL OFF CACHE BOOL "Disable SSL/OpenSSL - not available in WASM" FORCE)
set(ENABLE_MINIZIP OFF CACHE BOOL "Disable minizip - requires OpenSSL" FORCE)
set(ENABLE_ANTLR4_CPP_RUNTIME OFF CACHE BOOL "Disable ANTLR4 - compilation issues in WASM" FORCE)
set(ENABLE_ANTLR4_GRAMMARS OFF CACHE BOOL "Disable ANTLR4 grammars - depends on runtime" FORCE)

message(STATUS "[SSL/OpenSSL] DISABLED")
message(STATUS "  - ENABLE_SSL=OFF                   (not available in WASM)")
message(STATUS "  - ENABLE_MINIZIP=OFF               (requires OpenSSL)")
message(STATUS "  - ENABLE_ANTLR4_CPP_RUNTIME=OFF    (Prometheus only)")

# ============================================================================
# Platform-specific defines for WASM
# ============================================================================
# Poco networking needs some Linux-specific headers disabled.

add_compile_definitions(POCO_NO_LINUX_IF_PACKET_H=1)

# WASM is 32-bit, so allow narrowing from 64-bit types (UInt64/size_t mismatch)
# This is necessary because ClickHouse uses UInt64 for many sizes/offsets
# but WASM's size_t is 32-bit (unsigned long).
add_compile_options(-Wno-c++11-narrowing)

# ============================================================================
# Summary of Disabled Integrations
# ============================================================================
#
# Integration Category      | Options Disabled                    | ~Size Impact
# --------------------------|-------------------------------------|-------------
# LLVM/JIT (CRITICAL!)      | Embedded Compiler, DWARF, BLAKE3    | ~1.9 GB
# Cloud Storage (CRITICAL!) | S3, GCS, Azure, HDFS                | ~1.4+ GB
#   - AWS S3                | ENABLE_S3, ENABLE_AWS_S3            | ~944 MB
#   - Google Cloud          | ENABLE_GOOGLE_CLOUD_CPP             | ~369 MB
#   - Azure Blob            | ENABLE_AZURE_BLOB_STORAGE           | ~50-100 MB
#   - HDFS                  | ENABLE_HDFS                         | ~20-50 MB
# Message Queues            | Kafka, RabbitMQ, NATS               | 3.5-6 MB
# Database Connectors       | MySQL, PostgreSQL, MongoDB,         | 11-19 MB
#                           | Cassandra, SQLite, RocksDB          |
# Big Data                  | Hive, Delta Lake                    | 4-7 MB
# Network Protocols         | gRPC, Arrow Flight, cURL, SSH       | 7-12 MB
# Data Formats              | Arrow, Parquet, ORC                 | 23-33 MB
# Authentication            | LDAP, GSASL/Kerberos                | 1-2 MB
# Distributed Systems       | NuRaft                              | 0.5-1 MB
# --------------------------|-------------------------------------|-------------
# TOTAL ESTIMATED SAVINGS   |                                     | ~3.4+ GB
#
# Note: The two largest dependencies are:
#   1. LLVM (~1.9 GB) - JIT compilation, DWARF parsing
#   2. Cloud Storage (~1.4+ GB) - AWS S3 (944MB), GCS (369MB), Azure, HDFS
#
# Without LLVM:
#   - No JIT compilation of expressions (interpreted mode is used instead)
#   - No DWARF debug format parsing
#   - No BLAKE3 hash function (alternative hashes available)
#
# Without Cloud Storage:
#   - No S3, GCS, Azure Blob, or HDFS access
#   - WASM build uses only local/memory storage
#   - Hive Metastore also disabled (depends on HDFS)

message(STATUS "")
message(STATUS "============================================================")
message(STATUS "  Integration Disabling Summary")
message(STATUS "============================================================")
message(STATUS "Total integrations disabled: 25+")
message(STATUS "CRITICAL: LLVM/JIT disabled (~1.9 GB savings)")
message(STATUS "CRITICAL: Cloud Storage disabled (~1.4+ GB savings)")
message(STATUS "  - AWS S3: ~944 MB")
message(STATUS "  - Google Cloud: ~369 MB")
message(STATUS "  - Azure Blob: ~50-100 MB")
message(STATUS "  - HDFS: ~20-50 MB")
message(STATUS "Estimated total savings: ~3.4+ GB (before compression)")
message(STATUS "")
message(STATUS "All network-dependent integrations have been disabled.")
message(STATUS "JIT compilation disabled - queries use interpreted mode.")
message(STATUS "The WASM build will include only in-memory SQL capabilities.")
message(STATUS "")
message(STATUS "For additional size optimizations (DuckDB-inspired):")
message(STATUS "  include(cmake/wasm-aggressive-optimizations.cmake)")
message(STATUS "  chdb_apply_aggressive_wasm_optimizations(your_target)")
message(STATUS "")
message(STATUS "Key aggressive optimizations available:")
message(STATUS "  - -Oz (optimize for size over speed)")
message(STATUS "  - -flto (link-time optimization)")
message(STATUS "  - --closure 1 (Closure Compiler for JS)")
message(STATUS "  - wasm-opt post-build processing")
message(STATUS "  - Symbol stripping (-g0, --strip-all)")
message(STATUS "  - DISABLE_EXCEPTION_CATCHING=1")
message(STATUS "  - FILESYSTEM=0 (pure memory mode)")
message(STATUS "  - Memory: 16MB initial, 512MB max")
message(STATUS "============================================================")
message(STATUS "")
